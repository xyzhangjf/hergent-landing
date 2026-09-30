<template>
  <div class="cc-section">
    <div class="panel-hd">
      <b>数据台账</b>
      <span class="page-sub">
        从舟谱这类系统导出的 Excel 在这里补齐。这张表回答一个问题：
        <b>我的数据全不全、上次是什么时候传的</b>
      </span>
      <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
        <Icon name="refresh"/> {{ loading ? '读取中…' : '刷新' }}
      </button>
    </div>

    <div v-if="loadErr" class="dl-err">
      <Icon name="alert-triangle"/>
      <span>台账读不到：{{ loadErr }}。条数取自后台真实数据，读不到就是读不到 —— 不会显示成 0。</span>
    </div>

    <div v-else class="dl-list">
      <div v-for="it in rows" :key="it.category" class="dl-row">
        <div class="dl-name">
          <div class="dl-title">{{ it.label }}</div>
          <div class="dl-note">{{ metaOf(it.category).note }}</div>
        </div>
        <div class="dl-facts">
          <span class="dl-count" :class="{ dim: !it.count }">
            {{ it.count === null ? '读不到' : fmtNum(it.count) + ' 条' }}
          </span>
          <span class="dl-last" :title="lastTip(it)">{{ lastText(it) }}</span>
        </div>
        <span class="dl-tag" :class="statusOf(it).k" :title="statusOf(it).tip">{{ statusOf(it).t }}</span>
        <button v-if="metaOf(it.category).page" class="dl-btn"
                @click="go(it.category)" :title="'去 ' + metaOf(it.category).page + ' 上传'">
          <Icon name="link"/> 去上传
        </button>
        <button v-else class="dl-btn primary" @click="openUpload(it)">
          <Icon name="upload"/> 上传
        </button>
      </div>
    </div>

    <p class="dl-foot">
      「条数」是从后台真实数据里数出来的，不是上传次数。状态判定（多久算"该更新了"）
      只在本组件这一处定义 —— 换口径改这里即可。
    </p>
  </div>

  <!-- ===== 上传弹窗（选文件 → 列映射确认 → 导入 → 回执/撤销）===== -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="up.open" class="dl-overlay" @click="closeUpload"></div>
    </Transition>
    <Transition name="pop">
      <div v-if="up.open" class="dl-modal">
        <div class="dl-modal-hd">
          <b>上传{{ up.label }}</b>
          <button class="dl-x" @click="closeUpload">
            <Icon name="close"/>
          </button>
        </div>

        <div class="dl-modal-body">
          <p v-if="metaOf(up.cat).risky" class="dl-risk">
            <Icon name="alert-triangle"/>
            <span>
              <b>这一类会直接改账</b>：每一行都会按「到期日先后」自动冲抵这位客户的未清应收。
              第一次建议先用 <b>3~5 行</b>的小样本试一遍，看回执对了再传整份。
              重复导入会重复冲账，所以下面的「跳过已存在的记录」<b>请保持开启</b>。
            </span>
          </p>

          <div class="dl-pick">
            <button class="btn btn-ghost" :disabled="up.busy" @click="downloadTpl">
              <Icon name="download"/> 下载模板
            </button>
            <label class="btn btn-ghost dl-filebtn">
              <Icon name="upload"/> 选择文件
              <input type="file" accept=".xlsx,.xls" style="display:none" @change="onFile">
            </label>
            <span v-if="up.fname" class="dl-fname">{{ up.fname }}</span>
            <button v-if="up.step === 'pick'" class="btn btn-primary"
                    :disabled="!up.file || up.busy" @click="doPreview">
              {{ up.busy ? '识别中…' : '下一步' }}
            </button>
          </div>

          <p class="dl-hint">
            只有 Excel 文件（.xlsx / .xls）能上传。模板里带 <b>红色 *</b> 的列是必填。
          </p>

          <div v-if="up.step === 'map'" class="dl-map">
            <!-- 「跳过已存在的记录」这个勾选框**由 ImportMapping 自己渲染**（`v-model:incremental`）。
                 这里不要再摆第二个 —— 同一件事两个开关，用户勾了一个另一个没变，
                 会以为"我明明勾了"。DataFill.vue 也是同一个用法。 -->
            <ImportMapping v-model="up.mapping" :suggestions="up.suggestions"
                           :field-options="up.fieldOptions" :memory="up.memory"
                           v-model:incremental="up.inc" />
            <div class="dl-pick">
              <button class="btn btn-ghost" :disabled="up.busy" @click="up.step = 'pick'">返回</button>
              <button class="btn btn-primary" :disabled="up.busy" @click="doImport">
                {{ up.busy ? '导入中…' : '确认导入' }}
              </button>
            </div>
          </div>

          <ImportReceipt :result="up.result" @undone="load()" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '../store'
import { importApi } from '../api/modules'
import Icon from './Icon.vue'
import ImportMapping from './ImportMapping.vue'
import ImportReceipt from './ImportReceipt.vue'

/* ============================================================================
   DataLedger.vue —— 数据台账（v304，2026-09-28）
   ============================================================================
   由来（用户诉求原话）：「像舟谱这类没有 API / MCP 的客户，通过手动上传来实现数据上传与归档」。
   但上传这件事**早就建好了**（后端 8 个类目 + 模板 + 预览 + 回执 + 撤销），真正缺的是：
   **用户无从知道自己的数据全不全、上次什么时候传的**。没有这个，上传界面再漂亮也是"传完就忘"。
   所以这里做的不是"再加一个入口"，而是**把已有通道的状态讲清楚**。

   ---------------------------------------------------------------------------
   一、为什么不做成一个独立页面 / 侧栏一级入口（这是本组件形态的全部理由）
   ---------------------------------------------------------------------------
   ① 侧栏那一格 **3 天前刚被撤下来**，理由就写在代码里：
      `routers/zhoupu_documents.py:36-45` ——「用户不认可为一个低频动作占一行侧栏」。
      现在再加一行 = 3 天内自我推翻。
   ② 仓里有明文纪律：「上传能力与『上传第一份数据』**同一个接口** ⇒ **避免出现两套导入入口**」
      （`Workbench.vue:13-15`）。再加一个 = 第三套。
   ③ 这一页（AI 引擎，v311 前叫「能力中心」）本来就有一区叫「ERP 数据源」，标题写着「接入你的业务系统，
      AI 副驾直接读真实数据」—— **数据台账正是那一区的另一半**：上面说"从哪接"，
      下面说"接得全不全"。同类信息放在一起，用户不用在两个页面之间对账。

   ---------------------------------------------------------------------------
   二、职责边界：后端只给事实，本组件独占"判断"
   ---------------------------------------------------------------------------
   后端 `/api/import/ledger` 只回：条数 / 上次上传时间 / 上次条数 / 上传人。
   它**不给建议、不判"够不够"** —— 因为"多少条算少""多久算过期"是产品判断，必须只有一处。
   这里就是那一处（`CAT_META` / `STALE_DAYS` / `statusOf`）。改口径只改本文件。

   ---------------------------------------------------------------------------
   三、哪一类"跳到既有页面"、哪一类"在本弹窗里传"（**刻意不重叠**）
   ---------------------------------------------------------------------------
   有专门导入页面的类目 → 只给「去上传」跳过去，**本组件不再提供一个上传入口**
     · 商品档案 → /archive/products      （ProductArchive.vue 已有完整导入）
     · 员工档案 → /archive/employees     （EmployeeArchive.vue 已有）
     · 库存效期 → /data-fill             （DataFill.vue 已有）
   没有导入界面的类目 → 在本弹窗里传（**这是补洞，不是开第二条路**）
     · 客户 / 供应商（`/archive/customers` 页面自己写着"Excel 导入将在 P1 交付"）
     · 应收 / 应付 · 订单明细 · 客户专属价
     · 收款流水（v304 后端新增类目）
   ⇒ 判定表写在一处（`CAT_META[cat].page`），后端加类目时这里不写 `page` 就自动走弹窗，
     不会出现"新类目没入口"或"两个入口"。
   ============================================================================ */

const router = useRouter()

const rows = ref([])
const loading = ref(false)
const loadErr = ref('')

/* 类目 → 前端表现层。后端加类目时这里没有对应项也能跑（走 `DEF_META`），
   所以后端先上线、前端后补文案不会白屏。 */
const DEF_META = { note: '这一类数据会喂给 AI 副驾与各项经营计算', page: '' }
const CAT_META = {
  products:         { page: '/archive/products',  note: '报单、货损、比价都先读它' },
  contacts:         { page: '',                   note: '客户账期与所属业务员 —— 报单的第一道门槛' },
  employees:        { page: '/archive/employees', note: '算工资与提成的花名册' },
  inventory:        { page: '/data-fill',         note: '批次 + 到期日：临期预警与货损核算的唯一输入' },
  receivables:      { page: '',                   note: '欠款台账 —— 账龄与催收队列的起点' },
  order_items:      { page: '',                   note: '订单明细：业绩、提成、商品排行都从这里算' },
  customer_prices:  { page: '',                   note: '客户专属价 —— 千店千价的依据' },
  payment_receipts: { page: '', risky: true,
                      note: '回款流水：按到期日先后自动冲抵应收，账龄准不准全看它' },
}
function metaOf(cat) { return CAT_META[cat] || DEF_META }

/* 期望的更新节奏（天）。**只对有周期性的类目设**：
   档案类（客户/商品/员工/专属价）是一次性补齐的东西，不设"该更新了" —— 设了就是制造焦虑。
   客户档案给 180 天：新客户会不断开出来，一年没动过通常意味着漏了。 */
const STALE_DAYS = {
  inventory: 45,          // 盘库大约每月一次
  payment_receipts: 45,   // 对账大约每月一次
  receivables: 45,
  order_items: 45,
  contacts: 180,
}

async function load() {
  loading.value = true
  loadErr.value = ''
  try {
    const r = await importApi.ledger()
    rows.value = (r && r.items) || []
    if (!rows.value.length) loadErr.value = '后台没有返回任何数据类目'
  } catch (e) {
    rows.value = []
    loadErr.value = e.message || '请求失败'
  } finally {
    loading.value = false
  }
}

function fmtNum(n) {
  if (typeof n !== 'number') return '—'
  return n.toLocaleString('zh-CN')
}

function daysSince(t) {
  if (!t) return null
  const s = String(t).replace('T', ' ')
  // SQLite 的 localtime 是 "YYYY-MM-DD HH:MM:SS"，不用 Date.parse（Safari 对空格分隔不认）
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today - then) / 86400000)
}

function lastText(it) {
  if (!it.last_at) return it.count ? '没有上传记录' : '从未上传'
  const d = daysSince(it.last_at)
  const day = String(it.last_at).slice(5, 10).replace('-', '月') + '日'
  return `上次 ${day}` + (d === null ? '' : `（${d === 0 ? '今天' : d + ' 天前'}）`)
}
function lastTip(it) {
  const t = []
  if (it.count === null && it.count_error) t.push('无法统计：' + it.count_error)
  if (it.last_at) {
    t.push('上传时间 ' + String(it.last_at).slice(0, 16))
    t.push('本次新增 ' + fmtNum(it.last_count) + ' 条')
    if (it.last_by) t.push('上传人 ' + it.last_by)
    if (it.last_file) t.push('文件 ' + it.last_file)
  } else if (it.count) {
    t.push('这份数据不是通过「上传」进来的（可能手工录入或从 ERP 同步），所以没有上传时间')
  }
  return t.join('\n')
}

function statusOf(it) {
  if (it.count === null) {
    return { k: 'err', t: '读不到', tip: '统计出错：' + (it.count_error || '') }
  }
  if (!it.count) return { k: 'empty', t: '没数据', tip: '一条都还没有 —— 这一类补上，下游才算得动' }
  const stale = STALE_DAYS[it.category]
  const d = daysSince(it.last_at)
  if (stale && d !== null && d > stale) {
    return { k: 'stale', t: `已 ${d} 天没更新`, tip: `这一类大约每 ${stale} 天该来一次新的` }
  }
  return { k: 'ok', t: '有数据', tip: '' }
}

function go(cat) {
  const p = metaOf(cat).page
  if (p) router.push(p)
}

/* ---------- 上传弹窗 ---------- */
const up = reactive({
  open: false, cat: '', label: '', busy: false, step: 'pick',
  file: null, fname: '', suggestions: [], fieldOptions: [], mapping: {}, memory: null,
  inc: true, result: null,
})

function openUpload(it) {
  up.open = true
  up.cat = it.category
  up.label = it.label
  resetUpload()
}
function closeUpload() { up.open = false }

function resetUpload() {
  up.busy = false
  up.step = 'pick'
  up.file = null
  up.fname = ''
  up.suggestions = []
  up.fieldOptions = []
  up.mapping = {}
  up.memory = null
  up.inc = true
  up.result = null
}

function onFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls)$/i.test(f.name)) {
    toast('只支持 Excel 文件（.xlsx / .xls）', 'err')
    ev.target.value = ''
    return
  }
  up.file = f
  up.fname = f ? f.name : ''
  up.result = null
  up.memory = null
  up.step = 'pick'
}

async function downloadTpl() {
  try {
    const blob = await importApi.templateFile(up.cat)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = up.label + '导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) {
    toast(e.message || '模板下载失败', 'err')
  }
}

/** 第一步：只识别，不落库 —— 让用户先看一眼"哪列被认成了什么"再决定导不导。 */
async function doPreview() {
  if (!up.file) return
  up.busy = true
  try {
    const prev = await importApi.preview(up.file, up.cat)
    up.suggestions = prev.suggestions || []
    up.fieldOptions = prev.field_options || []
    up.memory = prev.remembered || null
    if (!up.suggestions.length) {
      toast('没读到任何列，请检查文件', 'err')
      return
    }
    const m = {}
    for (const s of up.suggestions) if (s.suggested_field) m[s.index] = s.suggested_field
    up.mapping = m
    up.step = 'map'
  } catch (e) {
    toast(e.message || '文件解析失败', 'err')
  } finally {
    up.busy = false
  }
}

/** 第二步：按确认过的映射执行。`mode=incremental` 只在勾选时传 ——
    不传时后端行为与改动前一致（小程序 / Hermes / 旧前端的调用方零影响）。 */
async function doImport() {
  if (!up.file) return
  up.busy = true
  try {
    const extra = up.inc ? { mode: 'incremental' } : {}
    const r = await importApi.execute(up.file, up.cat, up.mapping, extra)
    up.result = r
    up.step = 'pick'
    const ok = (r.results && r.results.success) || 0
    const bad = (r.results && r.results.errors) || []
    toast(`导入完成：成功 ${ok} 条` + (bad.length ? `，另有 ${bad.length} 条要你看一眼` : ''),
          bad.length ? 'warn' : 'ok')
    load()
  } catch (e) {
    toast(e.message || '导入失败', 'err')
  } finally {
    up.busy = false
  }
}

onMounted(load)
</script>

<style scoped>
.dl-list{border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--bg)}
.dl-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--border-subtle)}
.dl-row:first-child{border-top:none}
.dl-name{flex:1;min-width:0}
.dl-title{font-size:13.5px;font-weight:500;color:var(--t1)}
.dl-note{font-size:12px;color:var(--t3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dl-facts{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:150px}
.dl-count{font-size:13px;color:var(--t1);font-weight:500}
.dl-count.dim{color:var(--t3);font-weight:400}
.dl-last{font-size:11.5px;color:var(--t3)}
.dl-tag{flex:0 0 auto;font-size:11px;padding:3px 9px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.dl-tag.ok{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.dl-tag.stale{background:rgba(245,158,11,.14);color:#b45309}
.dl-tag.empty,.dl-tag.err{background:rgba(239,68,68,.12);color:#b91c1c}
.dl-btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;
  border-radius:8px;font-size:12px;border:1px solid var(--bd);background:var(--bg);color:var(--t2);cursor:pointer}
.dl-btn:hover{border-color:var(--p-dark);color:var(--p-dark)}
.dl-btn.primary{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.dl-foot{font-size:11.5px;color:var(--t3);line-height:1.7;margin:10px 0 0}
.dl-err{display:flex;align-items:flex-start;gap:8px;padding:12px 14px;border-radius:12px;
  background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);
  font-size:12.5px;color:#b45309;line-height:1.6}

.dl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:960}
.dl-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(620px,94vw);
  max-height:88vh;overflow:auto;background:var(--bg);border-radius:18px;z-index:961;box-shadow:var(--shadow-lg)}
.dl-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;
  border-bottom:1px solid var(--border-subtle);position:sticky;top:0;background:var(--bg);z-index:1}
.dl-modal-hd b{font-size:15px;font-weight:600}
.dl-x{width:28px;height:28px;border:none;background:none;border-radius:8px;display:flex;
  align-items:center;justify-content:center;color:var(--t2);cursor:pointer}
.dl-x:hover{background:var(--bg2)}
.dl-modal-body{padding:18px 20px}
.dl-risk{display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;padding:11px 13px;border-radius:10px;
  background:rgba(245,158,11,.12);color:#b45309;font-size:12.5px;line-height:1.7}
.dl-risk svg{flex:0 0 15px;margin-top:3px}
.dl-pick{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.dl-filebtn{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:5px}
.dl-fname{font-size:12.5px;color:var(--t2);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dl-hint{font-size:12px;color:var(--t3);line-height:1.7;margin:10px 0 0}
.dl-map{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.dl-inc{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--t2);cursor:pointer}

.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:transform .2s ease,opacity .2s ease}
.pop-enter-from,.pop-leave-to{transform:translate(-50%,-48%);opacity:0}

@media(max-width:768px){
  .dl-row{flex-wrap:wrap}
  .dl-facts{align-items:flex-start;min-width:0}
  .dl-name{flex:1 1 100%}
}
</style>
