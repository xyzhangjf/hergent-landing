<template>
  <div class="vc">
    <div class="vc-kpis">
      <div class="vc-kpi">
        <span class="num" :class="{ warn: s.open_amount > 0 }">{{ money(s.open_amount) }}</span>
        <span class="lbl">待兑现合计（元）</span>
      </div>
      <div class="vc-kpi">
        <span class="num" :class="{ bad: s.overdue_count > 0 }">{{ money(s.overdue_amount) }}</span>
        <span class="lbl">其中已逾期（{{ s.overdue_count }} 笔）</span>
      </div>
      <div class="vc-kpi">
        <span class="num">{{ money(s.soon_amount) }}</span>
        <span class="lbl">30 天内到期（{{ s.soon_count }} 笔）</span>
      </div>
      <div class="vc-kpi">
        <span class="num ok">{{ money(s.done_amount) }}</span>
        <span class="lbl">累计已兑现（元）</span>
      </div>
    </div>

    <div class="vc-bar">
      <p class="vc-tip">
        这里记<b>业务员口头答应、还没落到单据上的事</b> —— 返利、陈列费、赠品、费用支持。
        通用 ERP 不会管这些（它不是单据、没有流水号），但这部分钱对不上，往往就是利润差额。
      </p>
      <div class="vc-bar-acts">
        <button class="btn btn-ghost" :disabled="loading" @click="load">刷新</button>
        <button class="btn btn-primary" @click="openForm(null)">新增承诺</button>
      </div>
    </div>

    <div v-if="loading && !loaded" class="vc-skel">
      <div class="skel-line" style="width:60%"></div>
      <div class="skel-line" style="width:80%;margin-top:8px"></div>
    </div>

    <div v-else-if="!items.length" class="state-empty">
      <p>还没有记录任何厂家承诺。</p>
      <p class="vc-empty-sub">
        业务员说「下个月给你补陈列费」「这批货返两个点」，先记在这里 ——
        到日子没兑现，系统会在通知中心提醒你。
      </p>
      <button class="btn btn-primary btn-sm" style="display:block;margin:12px auto 0" @click="openForm(null)">
        记第一笔承诺
      </button>
    </div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>状态</th><th>承诺人</th><th>承诺内容</th>
            <th class="num">金额（元）</th><th>兑现截止</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id" :class="{ 'vc-faded': it.display_status === 'done' || it.display_status === 'void' }">
            <td><span class="vc-st" :class="'vc-st-' + it.display_status">{{ stLabel(it.display_status) }}</span></td>
            <td>
              {{ it.promisor || '—' }}
              <span v-if="it.brand" class="vc-brand">{{ it.brand }}</span>
            </td>
            <td class="vc-content">
              {{ it.content }}
              <span v-if="it.kind" class="vc-kind">{{ it.kind }}</span>
              <div v-if="it.caliber" class="vc-caliber">口径：{{ it.caliber }}</div>
            </td>
            <td class="num">{{ money(it.amount) }}</td>
            <td>
              {{ (it.due_date || '—') }}
              <div v-if="it.days_left !== null && it.display_status === 'open'" class="vc-days">
                {{ it.days_left >= 0 ? ('还剩 ' + it.days_left + ' 天') : ('已逾期 ' + (-it.days_left) + ' 天') }}
              </div>
            </td>
            <td class="vc-acts">
              <button v-if="it.display_status !== 'done' && it.display_status !== 'void'"
                      class="btn btn-ghost btn-sm" @click="settle(it)">已兑现</button>
              <button class="btn btn-ghost btn-sm" @click="openForm(it)">编辑</button>
              <button class="btn btn-ghost btn-sm" @click="removeOne(it)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="formOpen" class="vc-overlay" @click="formOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="formOpen" class="vc-modal">
          <div class="vc-modal-hd">
            <b>{{ form.id ? '编辑承诺' : '新增厂家承诺' }}</b>
            <button class="vc-x" @click="formOpen = false"><Icon name="close"/></button>
          </div>
          <div class="vc-modal-body">
            <div class="vc-grid">
              <label class="vc-fld">
                <span>谁承诺的</span>
                <input v-model="form.promisor" class="input" placeholder="如：蒙牛区域经理 王XX / 业务员小刘">
              </label>
              <label class="vc-fld">
                <span>品牌</span>
                <input v-model="form.brand" class="input" placeholder="如：蒙牛 / 特仑苏">
              </label>
              <label class="vc-fld vc-wide">
                <span>承诺内容 <i class="req">*</i></span>
                <input v-model="form.content" class="input" placeholder="如：8 月陈列费补 3000 元">
              </label>
              <label class="vc-fld">
                <span>类型</span>
                <select v-model="form.kind" class="input">
                  <option value="">未分类</option>
                  <option v-for="k in kinds" :key="k" :value="k">{{ k }}</option>
                </select>
              </label>
              <label class="vc-fld">
                <span>金额（元）</span>
                <!-- 不用 type=number：中文输入法打出的全角数字/句号会被浏览器静默丢弃 -->
                <input v-model="form.amount" class="input" type="text" inputmode="decimal" placeholder="例如 3000">
              </label>
              <label class="vc-fld">
                <span>承诺日期</span>
                <input v-model="form.promised_at" class="input" type="date">
              </label>
              <label class="vc-fld">
                <span>兑现截止日</span>
                <input v-model="form.due_date" class="input" type="date">
              </label>
              <label class="vc-fld vc-wide">
                <span>口径（怎么算、什么时候给）</span>
                <input v-model="form.caliber" class="input" placeholder="如：按 8 月实际进货额 2% 结算，随 9 月账期抵">
              </label>
              <label class="vc-fld vc-wide">
                <span>凭证 / 备注</span>
                <input v-model="form.evidence" class="input" placeholder="如：8/12 微信聊天记录；或写清对方原话">
              </label>
            </div>
            <p class="vc-form-tip">
              兑现截止日不填也能存 —— 只是到期提醒需要它才知道什么时候该提醒你。
            </p>
          </div>
          <div class="vc-modal-ft">
            <button class="btn btn-ghost" :disabled="saving" @click="formOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { toast } from '../store'
import { commitmentsApi } from '../api/modules'
import Icon from './Icon.vue'

/* 厂家承诺台账（v303）—— **作为「目标与返利」页的第 5 个页签**，不新增侧栏。
 *
 * 为什么挂在这里而不是新开一级菜单：老板想起"返利对不对得上"的那一刻，几乎必然
 * 同时想起"他还答应给我补陈列费"。两者是同一件事的两半（该给我的钱），分开就都想不起来。
 * 侧栏每多一个入口，每多一次"这个功能到底在哪"的犹豫。
 */
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const items = ref([])
const kinds = ref([])
const s = ref({ open_amount: 0, overdue_amount: 0, overdue_count: 0, soon_amount: 0, soon_count: 0, done_amount: 0 })
const formOpen = ref(false)

const EMPTY = {
  id: 0, promisor: '', brand: '', content: '', kind: '', amount: '',
  caliber: '', promised_at: '', due_date: '', evidence: '', note: '',
}
const form = ref({ ...EMPTY })

function money(v) {
  return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const ST_LABEL = { open: '待兑现', overdue: '已逾期', done: '已兑现', void: '已作废' }
function stLabel(k) { return ST_LABEL[k] || k }

function normNum(v) {
  let x = String(v == null ? '' : v)
  try { x = x.normalize('NFKC') } catch (e) { /* 忽略 */ }
  return x.replace(/[，,、\s]/g, '').replace(/[。．]/g, '.')
}

async function load() {
  loading.value = true
  try {
    const d = await commitmentsApi.list()
    items.value = (d && d.items) || []
    kinds.value = (d && d.kinds) || []
    const sum = await commitmentsApi.summary()
    if (sum) s.value = { ...s.value, ...sum }
    loaded.value = true
  } catch (e) {
    items.value = []
    if (e && e.message) console.warn('承诺台账加载失败：', e.message)
  } finally {
    loading.value = false
  }
}

function openForm(it) {
  form.value = it
    ? {
        id: it.id, promisor: it.promisor || '', brand: it.brand || '', content: it.content || '',
        kind: it.kind || '', amount: it.amount ? String(it.amount) : '',
        caliber: it.caliber || '', promised_at: it.promised_at || '', due_date: it.due_date || '',
        evidence: it.evidence || '', note: it.note || '',
      }
    : { ...EMPTY }
  formOpen.value = true
}

async function save() {
  if (!String(form.value.content || '').trim()) { toast('请填写承诺内容', 'err'); return }
  saving.value = true
  try {
    const payload = { ...form.value, amount: Number(normNum(form.value.amount) || 0) }
    if (payload.id) await commitmentsApi.update(payload.id, payload)
    else await commitmentsApi.create(payload)
    toast('已保存', 'ok')
    formOpen.value = false
    await load()
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    saving.value = false
  }
}

async function settle(it) {
  try {
    await commitmentsApi.done(it.id, { status: 'done' })
    toast(`已标记兑现：${it.content}`, 'ok')
    await load()
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  }
}

async function removeOne(it) {
  if (!window.confirm(`删除这条承诺记录？\n\n${it.content}\n\n删除后不可恢复。`)) return
  try {
    await commitmentsApi.remove(it.id)
    toast('已删除', 'ok')
    await load()
  } catch (e) {
    toast(e.message || '删除失败', 'err')
  }
}

onMounted(load)
</script>

<style scoped>
.vc{display:flex;flex-direction:column;gap:14px}
.vc-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.vc-kpi{background:var(--bg2);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:2px}
.vc-kpi .num{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}
.vc-kpi .num.ok{color:var(--ok-green)}
.vc-kpi .num.warn{color:var(--war)}
.vc-kpi .num.bad{color:var(--err-red, #d9534f)}
.vc-kpi .lbl{font-size:12px;color:var(--t2)}
.vc-bar{display:flex;align-items:flex-start;gap:14px}
.vc-tip{font-size:12.5px;color:var(--t2);line-height:1.75;margin:0;flex:1}
.vc-bar-acts{display:flex;gap:8px;flex-shrink:0}
.vc-skel{padding:8px 0}
.vc-empty-sub{font-size:12.5px;color:var(--t3);max-width:560px;margin:6px auto 0;line-height:1.7}
.vc-st{display:inline-block;padding:1px 8px;border-radius:8px;font-size:11.5px;white-space:nowrap;background:var(--bg2);color:var(--t2)}
.vc-st-overdue{background:var(--warn-amber-bg);color:var(--warn-amber)}
.vc-st-done{background:var(--ok-green-bg);color:var(--ok-green)}
.vc-st-void{background:var(--bg2);color:var(--t3)}
.vc-faded td{opacity:.62}
.vc-brand{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;font-size:11px;background:var(--bg2);color:var(--t2)}
.vc-content{max-width:420px}
.vc-kind{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;font-size:11px;background:var(--p-bg);color:var(--p-dark)}
.vc-caliber{font-size:11.5px;color:var(--t3);margin-top:2px}
.vc-days{font-size:11.5px;color:var(--t3);margin-top:2px}
.vc-acts{white-space:nowrap;text-align:right}
.tbl .num{text-align:right;font-variant-numeric:tabular-nums}

.vc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:900}
.vc-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:901;
  width:min(720px,92vw);max-height:88vh;overflow:auto;background:var(--bg);border-radius:16px;
  box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column}
.vc-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.vc-x{border:none;background:none;cursor:pointer;color:var(--t2);display:flex}
.vc-modal-body{padding:18px 20px}
.vc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.vc-fld{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.vc-fld .input{height:34px;font-size:13px}
.vc-fld .req{color:var(--war);font-style:normal}
.vc-wide{grid-column:1/-1}
.vc-form-tip{font-size:12px;color:var(--t3);margin:12px 0 0}
.vc-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.fade-enter-active,.fade-leave-active{transition:opacity .16s ease}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:opacity .16s ease,transform .16s ease}
.pop-enter-from,.pop-leave-to{opacity:0;transform:translate(-50%,-46%) scale(.97)}
@media (max-width:900px){
  .vc-kpis{grid-template-columns:repeat(2,1fr)}
  .vc-grid{grid-template-columns:1fr}
  .vc-bar{flex-direction:column}
}
</style>
