<template>
  <div class="card cr-panel">
    <div class="panel-hd">
      <b>客户回款</b>
      <span class="badge badge-blue">账龄按真实回款算</span>
      <span class="cr-hd-acts">
        <button class="btn btn-ghost" :disabled="loading" @click="load">刷新</button>
        <button class="btn btn-primary" :disabled="!items.length" @click="openForm()">登记回款</button>
      </span>
    </div>

    <div v-if="loading && !loaded" class="cr-skel">
      <div class="skel-line" style="width:50%"></div>
      <div class="skel-line" style="width:70%;margin-top:8px"></div>
    </div>

    <!-- 没有任何未清应收时的空态：要解释**为什么**空，而不是只显示 0。
         「应收全清了」与「从来没录过应收」在数字上都是 0，但对老板的意义完全不同。 -->
    <div v-else-if="!items.length" class="cr-empty">
      <p v-if="aging.total_customers === 0">当前没有未清的客户应收。</p>
      <p>客户欠款来自「应收期初建账」或对账结果。收到钱后在这里登记，账龄和催收提醒才会跟着更新。</p>
    </div>

    <template v-else>
      <div class="cr-kpis">
        <div class="cr-kpi">
          <span class="num">{{ money(aging.total_open) }}</span><span class="lbl">未收回合计（元）</span>
        </div>
        <div class="cr-kpi">
          <span class="num ok">{{ money(aging.this_month_received) }}</span><span class="lbl">本月已登记回款（元）</span>
        </div>
        <div class="cr-kpi">
          <span class="num" :class="{ warn: overdueTotal > 0 }">{{ money(overdueTotal) }}</span><span class="lbl">其中已逾期（元）</span>
        </div>
        <div class="cr-kpi">
          <span class="num">{{ items.length }}</span><span class="lbl">有欠款的客户（户）</span>
        </div>
      </div>

      <!-- 账龄分布。分桶口径与后端 aging_summary 一致（未到期 / 1-30 / 31-60 / 61-90 / 90+） -->
      <div class="cr-aging">
        <div v-for="b in buckets" :key="b.k" class="cr-ab" :class="b.cls">
          <span class="cr-ab-l">{{ b.label }}</span>
          <span class="cr-ab-v">{{ money(b.v) }}</span>
        </div>
      </div>

      <!-- 登记表单：内联展开而不是弹窗 —— 它只有 4 个字段，弹窗会把"看一下上面还欠多少"
           这一动作为了填表而打断。 -->
      <div v-if="formOpen" class="cr-form">
        <label class="cr-fld">
          <span>客户 <i class="req">*</i></span>
          <select v-model="form.contact_id" class="input">
            <option value="">请选择客户</option>
            <option v-for="it in items" :key="it.contact_id" :value="it.contact_id">
              {{ it.contact_name }}（欠 {{ money(it.open_amount) }} 元）
            </option>
          </select>
        </label>
        <label class="cr-fld">
          <span>收到多少钱（元）<i class="req">*</i></span>
          <!-- ⚠️ 不用 type=number：中文输入法打出的全角「５０００」或「。」会被浏览器
               静默丢掉/变成空值（本项目数字格的老病根，见 MEMORY「数字格病根在输入层」）。
               用 text + inputmode 让手机弹数字键盘，同时在后端前先归一化。 -->
          <input v-model="form.amount" class="input" type="text" inputmode="decimal"
                 placeholder="例如 5000" @keyup.enter="submit">
        </label>
        <label class="cr-fld">
          <span>收款日期</span>
          <input v-model="form.paid_at" class="input" type="date">
        </label>
        <label class="cr-fld">
          <span>收款方式</span>
          <select v-model="form.method" class="input">
            <option v-for="m in methods" :key="m" :value="m">{{ m || '未填' }}</option>
          </select>
        </label>
        <label class="cr-fld cr-fld-wide">
          <span>备注</span>
          <input v-model="form.note" class="input" placeholder="例如：微信转账，张三打的">
        </label>
        <div class="cr-form-ft">
          <span class="cr-tip">系统按<b>到期日最早</b>的先冲，自动分摊，不用你选是哪一笔。</span>
          <button class="btn btn-ghost" :disabled="saving" @click="formOpen = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">
            {{ saving ? '登记中…' : '确定登记' }}
          </button>
        </div>
      </div>

      <!-- 登记结果：分摊到哪几笔要说清楚，多出来的钱更要显式说 -->
      <div v-if="lastResult" class="cr-res" :class="{ warn: lastResult.unapplied > 0 }">
        <div class="cr-res-line">
          已登记 {{ lastResult.contact_name }} 回款 {{ money(lastResult.amount) }} 元，
          冲抵 <b>{{ lastResult.allocs.length }}</b> 笔欠款、合计 <b>{{ money(lastResult.allocated) }}</b> 元。
        </div>
        <div v-for="(a, i) in lastResult.allocs" :key="i" class="cr-res-i">
          应收 #{{ a.receivable_id }}<span v-if="a.due_date">（到期 {{ a.due_date }}）</span> 冲 {{ money(a.amount) }} 元
        </div>
        <div v-if="lastResult.unapplied > 0" class="cr-res-warn">
          还有 {{ money(lastResult.unapplied) }} 元没有对应的欠款可冲 —— 可能是多收了，或这位客户的欠款还没建档。
          这笔差额已记在这位客户名下，请核对。
        </div>
      </div>

      <div class="cr-tables">
        <div class="cr-col">
          <div class="cr-col-h">欠款最多的客户</div>
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>客户</th><th class="num">未收回（元）</th><th class="num">逾期天数</th><th></th></tr></thead>
              <tbody>
                <tr v-for="it in items.slice(0, 8)" :key="it.contact_id">
                  <td>{{ it.contact_name }}</td>
                  <td class="num">{{ money(it.open_amount) }}</td>
                  <td class="num" :class="{ warn: it.max_overdue_days > 30 }">
                    {{ it.max_overdue_days > 0 ? it.max_overdue_days : '—' }}
                  </td>
                  <td class="num">
                    <button class="btn btn-ghost btn-sm" @click="openForm(it.contact_id)">收款</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="cr-col">
          <div class="cr-col-h">最近登记的回款</div>
          <div v-if="!payments.length" class="cr-none">还没有登记过回款。</div>
          <div class="table-wrap" v-else>
            <table class="tbl">
              <thead><tr><th>日期</th><th>客户</th><th class="num">金额（元）</th><th></th></tr></thead>
              <tbody>
                <tr v-for="p in payments.slice(0, 8)" :key="p.id">
                  <td>{{ (p.paid_at || '').slice(0, 10) }}</td>
                  <td>{{ p.contact_name }}</td>
                  <td class="num">{{ money(p.amount) }}</td>
                  <td class="num">
                    <button class="btn btn-ghost btn-sm" :disabled="busyId === p.id" @click="undoOne(p)">
                      撤回
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { toast } from '../store'
import { collectionsApi } from '../api/modules'

/* 客户回款（v303）—— 整合进「经营工作台」，**不新增侧栏**。
 *
 * 为什么落在这里：老板每天进的就是这一页（今天欠多少、该催谁）。收款与催收本来就是
 * 同一个动作的两半 —— 提醒他"该收多少"，必须先有"收回来多少"。单独开一个「应收管理」
 * 侧栏入口，等于把一件每天都做的事挪到第二个地方去点。
 *
 * 后端事实（别在前端重算）：`receivables.paid_amount` 在 v303 之前**只有读、没有写**，
 * 账龄与催收话术里的余额因此恒等于期初建账金额。本组件是那个缺失的写入口的界面。
 */
const loading = ref(false)
const loaded = ref(false)
const aging = ref({})
const items = ref([])
const payments = ref([])
const formOpen = ref(false)
const saving = ref(false)
const busyId = ref(0)
const lastResult = ref(null)
const methods = ['', '现金', '微信', '支付宝', '银行转账', '抵扣']

const form = ref({ contact_id: '', amount: '', paid_at: todayStr(), method: '', note: '' })

function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* 金额归一：全角数字 / 中文句号 / 全角逗号 / 空格 一律折成半角 ——
   中文输入法下这些字符几乎必然出现，且 `type=number` 会**静默**把它们丢掉。 */
function normNum(s) {
  let v = String(s == null ? '' : s)
  try { v = v.normalize('NFKC') } catch (e) { /* 老浏览器忽略 */ }
  v = v.replace(/[，,、\s]/g, '').replace(/[。．]/g, '.')
  return v
}

function money(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const overdueTotal = computed(() => {
  const b = (aging.value && aging.value.buckets) || {}
  return (b.d1_30 || 0) + (b.d31_60 || 0) + (b.d61_90 || 0) + (b.d90p || 0)
})

const buckets = computed(() => {
  const b = (aging.value && aging.value.buckets) || {}
  return [
    { k: 'not_due', label: '未到期', v: b.not_due || 0, cls: '' },
    { k: 'd1_30', label: '逾期 1-30 天', v: b.d1_30 || 0, cls: 'warn' },
    { k: 'd31_60', label: '逾期 31-60 天', v: b.d31_60 || 0, cls: 'warn' },
    { k: 'd61_90', label: '逾期 61-90 天', v: b.d61_90 || 0, cls: 'bad' },
    { k: 'd90p', label: '逾期 90 天以上', v: b.d90p || 0, cls: 'bad' },
  ]
})

async function load() {
  loading.value = true
  try {
    const d = await collectionsApi.aging()
    aging.value = d || {}
    items.value = (d && d.items) || []
    const p = await collectionsApi.payments(0, 10)
    payments.value = (p && p.items) || []
    loaded.value = true
  } catch (e) {
    // 静默降级到空态（不弹错）—— 这一页还有别的卡片，一个接口挂了不该打断整页。
    aging.value = {}
    items.value = []
    payments.value = []
    if (e && e.message) console.warn('客户回款加载失败：', e.message)
  } finally {
    loading.value = false
  }
}

function openForm(contactId) {
  form.value = {
    contact_id: contactId || '',
    amount: '',
    paid_at: todayStr(),
    method: '',
    note: '',
  }
  lastResult.value = null
  formOpen.value = true
}

async function submit() {
  const amt = normNum(form.value.amount)
  if (!form.value.contact_id) { toast('请先选择客户', 'err'); return }
  if (!amt || !(Number(amt) > 0)) { toast('请填写收到的金额（元）', 'err'); return }
  saving.value = true
  try {
    const r = await collectionsApi.pay({
      contact_id: Number(form.value.contact_id),
      amount: Number(amt),
      paid_at: form.value.paid_at || todayStr(),
      method: form.value.method || '',
      note: form.value.note || '',
    })
    lastResult.value = { ...r, amount: Number(amt) }
    formOpen.value = false
    toast(`已登记回款 ${money(amt)} 元`, r.unapplied > 0 ? 'warn' : 'ok')
    await load()
  } catch (e) {
    toast(e.message || '登记失败', 'err')
  } finally {
    saving.value = false
  }
}

async function undoOne(p) {
  busyId.value = p.id
  try {
    const r = await collectionsApi.undo(p.id)
    toast(`已撤回这笔回款（回退了 ${r.reverted} 笔欠款的分摊）`, 'ok')
    lastResult.value = null
    await load()
  } catch (e) {
    toast(e.message || '撤回失败', 'err')
  } finally {
    busyId.value = 0
  }
}

onMounted(load)
</script>

<style scoped>
.cr-panel{grid-column:1/-1}
.cr-hd-acts{margin-left:auto;display:flex;gap:8px}
.cr-skel{padding:8px 0}
.cr-empty{font-size:13px;color:var(--t2);line-height:1.8}
.cr-empty p{margin:4px 0}
.cr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
.cr-kpi{background:var(--bg2);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:2px}
.cr-kpi .num{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}
.cr-kpi .num.ok{color:var(--ok-green)}
.cr-kpi .num.warn{color:var(--war)}
.cr-kpi .lbl{font-size:12px;color:var(--t2)}
.cr-aging{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.cr-ab{display:flex;flex-direction:column;gap:2px;padding:7px 12px;border-radius:10px;background:var(--bg2);min-width:110px}
.cr-ab-l{font-size:11.5px;color:var(--t2)}
.cr-ab-v{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.cr-ab.warn .cr-ab-v{color:var(--war)}
.cr-ab.bad .cr-ab-v{color:var(--err-red, #d9534f)}
.cr-form{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg2);margin-bottom:12px}
.cr-fld{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.cr-fld .input{height:32px;font-size:13px}
.cr-fld .req{color:var(--war);font-style:normal}
.cr-fld-wide{grid-column:1/-1}
.cr-form-ft{grid-column:1/-1;display:flex;align-items:center;gap:10px;justify-content:flex-end}
.cr-form-ft .cr-tip{margin-right:auto;font-size:12px;color:var(--t3)}
.cr-res{padding:10px 14px;border-radius:10px;font-size:13px;background:rgba(var(--suc-rgb),.1);color:var(--suc);margin-bottom:12px;display:flex;flex-direction:column;gap:3px}
.cr-res.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}
.cr-res i,.cr-res-i{font-size:12px;color:var(--t2)}
.cr-res-warn{font-size:12px;color:var(--war)}
.cr-tables{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cr-col-h{font-size:12.5px;font-weight:500;color:var(--t2);margin-bottom:6px}
.cr-none{font-size:12.5px;color:var(--t3);padding:8px 0}
.tbl .num{text-align:right;font-variant-numeric:tabular-nums}
.tbl .num.warn{color:var(--war)}
@media (max-width:900px){
  .cr-kpis{grid-template-columns:repeat(2,1fr)}
  .cr-form{grid-template-columns:1fr}
  .cr-tables{grid-template-columns:1fr}
}
</style>
