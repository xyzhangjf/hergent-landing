<template>
  <div class="page">
    <!-- Bento 布局 -->
    <div class="bento">
      <!-- KPI 横条（顶部紧凑统计带） -->
      <div class="card kpi-strip">
        <div class="kpi" v-for="k in kpis" :key="k.label">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-val" :class="k.cls">{{ k.val }}</div>
          <div class="kpi-sub">{{ k.sub }}</div>
        </div>
      </div>

      <!-- 空账套引导：KPI 全 0 且无任何业务信号时出现（新注册租户 / 尚未导入数据）。
           上传能力与注册后的「上传第一份数据」弹窗**同一个接口**（importApi.oneShot），
           避免出现两套导入入口。 -->
      <div class="card import-guide" v-if="isEmptyTenant">
        <div class="ig-ic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/></svg>
        </div>
        <div class="ig-txt">
          <div class="ig-title">还没有数据？先导入一份 Excel</div>
          <div class="ig-sub">从舟谱或你现在的系统导出（应收、商品、订单都可以），选文件后 AI 自动识别入库，马上就能看到经营分析。</div>
        </div>
        <div class="ig-acts">
          <label class="btn btn-primary ig-pick" :class="{ busy: igBusy }">
            <input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="igFile">
            {{ igBusy ? 'AI 识别中…' : '选择 Excel 文件' }}
          </label>
          <span v-if="igMsg" class="ig-msg" :class="{ ok: igOk }">{{ igMsg }}</span>
        </div>
      </div>

      <!-- 今日待办（AI 替你盯着的，等你拍板） -->
      <div class="card todo-panel" v-if="todoItems.length">
        <div class="panel-hd">
          <b>今日待办</b>
          <span class="badge badge-blue">等你拍板</span>
          <span v-if="todoLoading" class="page-sub">加载中…</span>
        </div>
        <div class="todo-list">
          <div v-for="(t, i) in todoItems" :key="i" class="todo-item" :class="'prio-' + t.prio" @click="goTodo(t)">
            <span class="todo-ic">{{ t.icon }}</span>
            <div class="todo-main">
              <div class="todo-title">{{ t.title }}</div>
              <div class="todo-sub">{{ t.sub }}</div>
            </div>
            <span class="todo-go">去处理 →</span>
          </div>
        </div>
      </div>

      <!-- 今日经营要务（主块，占最大面积）。
           ⚠️ v190：近效期预警不在时本块铺满整行 —— 否则右侧 4 列会留空（下方 expiry-card 同理）。 -->
      <div class="card today-panel" :class="{ 'span-all': !expiryData.length }" v-if="todayCards.length">
        <div class="panel-hd">
          <b>今日经营要务</b>
          <span class="badge badge-blue">主动副驾 · 每日自动生成</span>
        </div>
        <div class="today-list">
          <div v-for="(c,i) in todayCards" :key="i" class="today-card" :class="'prio-' + (c.priority || 'info')">
            <span class="tag" :class="cardTag(c)">{{ cardTypeLabel(c.type) }}</span>
            <div class="tc-body">
              <div class="tc-title">{{ c.title }}</div>
              <div class="tc-text">{{ c.body }}</div>
            </div>
            <div class="tc-acts" v-if="c.actions && c.actions.length">
              <button v-for="a in c.actions" :key="a.label" class="btn btn-ghost" @click="cardAction(a)">{{ a.label }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 近效期预警（右侧 · 与「今日经营要务」并排并拉满其两行高度）。
           ⚠️ v190：今日经营要务不在时本块铺满整行，否则右侧 8 列会留空。 -->
      <div class="card expiry-card" :class="{ 'span-all': !todayCards.length }" v-if="expiryData.length">
        <div class="panel-hd">
          <b>近效期预警</b>
          <span class="tag bad">{{ expiryData.length }} 条</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>商品</th><th>库存</th><th>效期</th><th>剩余</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="e in expiryData.slice(0,6)" :key="e.product_id + '-' + (e.batch_no||'')">
                <td>{{ e.product_name || e.name || '—' }}</td>
                <td class="num">{{ e.quantity ?? e.stock ?? '—' }}</td>
                <td>{{ e.expiry_date || '—' }}</td>
                <td class="num">{{ e.days_left ?? '—' }}</td>
                <td><span class="tag" :class="expiryTag(e.days_left)">{{ expiryText(e.days_left) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- AI 晨报（底部整行） -->
      <div class="card report-panel">
        <div class="panel-hd"><b>AI 晨报</b><span class="badge badge-blue">Hermes</span></div>
        <div v-if="!aiText && !aiLoading" class="state-empty">
          <div class="se-ic">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
          </div>
          <p>每天早上由 Hermes 生成经营晨报</p>
          <button class="btn btn-ghost" style="margin-top:12px" :disabled="aiLoading" @click="loadMorning">生成今日晨报</button>
        </div>
        <div v-if="aiLoading" class="ai-loading">
          <div class="skel-line" style="width:90%"></div>
          <div class="skel-line" style="width:70%;margin-top:8px"></div>
          <div class="skel-line" style="width:85%;margin-top:8px"></div>
          <div class="skel-line" style="width:60%;margin-top:8px"></div>
        </div>
        <div v-if="aiText && !aiLoading" class="ai-report" v-html="mdText"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { toast } from '../store'
import { hermesChat } from '../api/client'
import { stripAllFences } from '../composables/useCardTrigger'
import { dashboardApi, expiryApi, todayApi, importApi } from '../api/modules'

/* ---- 日期 ---- */
const todayStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })

/* ---- KPI 数据 ---- */
const dashData = ref(null)
const expiryData = ref([])
const todayData = ref(null)

const todayCards = computed(() => todayData.value?.cards || [])

function cardTypeLabel(t) {
  return { churn_risk: '流失风险', low_stock: '库存预警', overdue_ar: '应收逾期', opportunity: '机会发现', expiry: '临期' }[t] || t
}
function cardTag(c) {
  if (c.priority === 'critical') return 'bad'
  if (c.priority === 'warning') return 'warn'
  return 'ok'
}
function cardAction(a) {
  if (a.type === 'view_detail' || a.type === 'view_supplier' || a.type === 'view_product') {
    toast('详情页开发中', 'info')
  } else {
    toast(a.label + '：功能完善中', 'info')
  }
}

const kpis = computed(() => {
  const d = dashData.value
  if (!d) return [
    { label: '今日销售额', val: '¥—', sub: '加载中', cls: '' },
    { label: '今日毛利', val: '¥—', sub: '', cls: '' },
    { label: '今日单数', val: '—', sub: '', cls: '' },
    { label: '今日回款', val: '¥—', sub: '', cls: '' },
    { label: '近效期预警', val: expiryData.value.length || '—', sub: expiryData.value.length ? '需处理' : '', cls: expiryData.value.length ? 'val-warn' : '' },
  ]
  return [
    { label: '今日销售额', val: '¥' + fmt(d.sales), sub: '', cls: '' },
    { label: '今日毛利', val: '¥' + fmt(d.profit), sub: d.sales > 0 ? '毛利率 ' + pct(d.profit, d.sales) : '', cls: d.profit >= 0 ? 'val-ok' : 'val-bad' },
    { label: '今日单数', val: d.orders, sub: d.orders > 0 ? '均价 ¥' + Math.round(d.sales / d.orders) : '', cls: '' },
    { label: '今日回款', val: '¥' + fmt(d.payment), sub: d.sales > 0 ? '回款率 ' + pct(d.payment, d.sales) : '', cls: '' },
    { label: '近效期预警', val: expiryData.value.length || 0, sub: expiryData.value.length ? '需处理' : '无预警', cls: expiryData.value.length ? 'val-warn' : 'val-ok' },
  ]
})

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function pct(a, b) {
  if (!b) return '—'
  return Math.round((a / b) * 100) + '%'
}

/* ---- 近效期 ---- */
function expiryTag(days) {
  if (days == null) return ''
  if (days <= 0) return 'bad'
  if (days <= 7) return 'bad'
  if (days <= 14) return 'warn'
  return 'ok'
}
function expiryText(days) {
  if (days == null) return '—'
  if (days <= 0) return '已过期'
  if (days <= 7) return days + '天到期'
  if (days <= 14) return days + '天到期'
  return '安全'
}

/* ---- AI 晨报 ---- */
const aiText = ref('')
const aiLoading = ref(false)
const mdText = ref('')

function renderMd(t) {
  // 晨报同样是 Hermes 输出，可能附带 ```card / ```cards 控制标记 —— 先剥干净再渲染
  return stripAllFences(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^- /gm, '<span style="color:var(--p-dark)">•</span> ')
    .replace(/\n/g, '<br>')
}

async function loadMorning() {
  aiLoading.value = true
  aiText.value = ''
  mdText.value = ''
  const msg = { role: 'user', content: '你是我的 AI 经营副驾。请基于当前业务数据，生成今天早上的经营晨报：今日待办、需要关注的风险（货损/返利）、建议动作。请用简洁的要点列出。' }
  let full = ''
  try {
    await hermesChat([msg], {
      onDelta: (d, f) => { full = f; aiText.value = f; mdText.value = renderMd(f) }
    })
  } catch (e) {
    aiText.value = '晨报生成失败：' + (e.message || 'Hermes 未连接')
    mdText.value = aiText.value
  } finally {
    aiLoading.value = false
  }
}

/* ---- 空账套引导 ---- */
const recentActions = ref([])
const igBusy = ref(false)
const igMsg = ref('')
const igOk = ref(false)

/* 判据：今日 KPI 全 0 **且** 无任何业务信号（无待办卡片、无效期预警、无历史业务动作）。
   刻意不用「客户/商品数为 0」——那要多打一次档案接口；这四条同时成立已足以区分
   「空账套」与「今天恰好没开单」（后者会有历史动作或效期数据）。
   ⚠️ recentActions 必须已在加载时剔除 auth 动作，否则新用户一注册就被判成"有数据"。
   dashData 未加载完时返回 false，避免引导卡闪烁。 */
const isEmptyTenant = computed(() => {
  const d = dashData.value
  if (!d) return false
  const flat = !Number(d.sales) && !Number(d.orders) && !Number(d.payment) && !Number(d.profit)
  return flat && !expiryData.value.length && !todayCards.value.length && !recentActions.value.length
})

async function igFile(ev) {
  const f = ev.target.files?.[0]
  ev.target.value = ''
  if (!f) return
  igBusy.value = true
  igMsg.value = ''
  try {
    const r = await importApi.oneShot(f)
    if (r && r.success) {
      const label = { receivables: '应收', products: '商品', orders: '订单' }[r.category] || '数据'
      igOk.value = true
      igMsg.value = `${label}已识别 · ${r.success} 条入库`
      await loadData()   // 拉回真实数据：引导卡会因 KPI 不再全 0 而自行消失
    } else {
      igOk.value = false
      igMsg.value = (r && r.message) || '未能自动识别，请确认表头含商品/客户名称与数量或金额'
    }
  } catch (e) {
    igOk.value = false
    igMsg.value = e.message || '导入失败，请稍后重试'
  } finally {
    igBusy.value = false
  }
}

/* ---- 初始化加载 ---- */
async function loadData() {
  try {
    const d = await dashboardApi.todayProfit()
    dashData.value = d
  } catch (e) { /* 后端未启动时静默 */ }
  try {
    const e = await expiryApi.scan()
    // v157：后端 items 含**全部档位**（含正常档）。「近效期预警」只认需要动手的三档
    //   已过期/红/橙（口径 = 货损配方 threshold_days）；yellow 是「仅关注」，不计入。
    //   旧版把全量 items 直接塞进来，效期一录全就会显示「预警 54 条」——把正常批次
    //   也算成了预警（同屏口径不同源的又一例）。
    const RISK_TIERS = ['expired', 'red', 'orange']
    expiryData.value = (e.items || []).filter(it => it && RISK_TIERS.includes(it.tier))
  } catch (e) { /* 静默 */ }
  try {
    const t = await todayApi.get()
    todayData.value = t
  } catch (e) { /* 静默 */ }
  try {
    // 仅用于判定「是否空账套」：有历史**业务**动作 = 用户已经开始用系统，不该显示导入引导。
    // ⚠️ 必须排除 module==='auth' —— 注册/登录本身就会写一条动作记录（实测新注册租户的
    // recent-actions 恰好就是「自助注册: XXX」），不过滤会把每个新用户都判成"有数据"，
    // 引导卡永远不出现。limit 取大一些，避免连续登录把业务动作挤出窗口。
    const ra = await dashboardApi.recentActions(20)
    const arr = Array.isArray(ra) ? ra : (ra?.items || ra?.data || [])
    recentActions.value = arr.filter(a => a && a.module !== 'auth')
  } catch (e) { recentActions.value = [] }
  loadTodo()
}

/* ---- 今日待办：临期预警 + AI 建议（AI 替你盯着的） ---- */
const todoItems = ref([])
const todoLoading = ref(false)

async function loadTodo() {
  todoLoading.value = true
  const items = []
  // 临期预警 —— expiryData 已是风险档（已过期/红/橙，口径 = 配方阈值），
  //   旧版按后端从不返回的 status/is_near 过滤，导致这条待办永远不出现。
  const near = expiryData.value || []
  if (near.length) {
    // 措辞按实际数据分：这批里可能全是「已过期」，笼统说「临近效期」会让老板低估紧迫度。
    const expiredCnt = near.filter(x => (x.days_left ?? 0) < 0).length
    const expiringCnt = near.length - expiredCnt
    const title = expiredCnt && expiringCnt
      ? `${expiredCnt} 批已过期 · ${expiringCnt} 批临近效期`
      : (expiredCnt ? `${expiredCnt} 批已过期，需立即处置` : `${expiringCnt} 批临近效期`)
    items.push({
      icon: '临',
      title,
      sub: '需尽快处置，避免过期报损',
      prio: 'amber', path: '/loss',
    })
  }
  items.push({ icon: '聊', title: '问问 AI 今天该做什么', sub: '打开对话，AI 副驾随时待命', prio: 'blue', path: '/chat' })
  todoItems.value = items.slice(0, 5)
  todoLoading.value = false
}

function goTodo(t) {
  if (t.path === '/chat') return
  // hash 路由跳转
  window.location.hash = '#' + t.path
}

onMounted(loadData)
</script>

<style scoped>
/* .bento / .kpi-strip 及 KPI 子元素样式已上提全局层（src/styles/variables.css），
   此处只保留本页模块占位与局部组件。 */
.todo-panel{grid-column:1/-1}
.todo-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.todo-item{display:flex;align-items:center;gap:12px;border:1px solid var(--bd);border-radius:12px;padding:12px 14px;cursor:pointer;transition:background .15s}
.todo-item:hover{background:var(--bg2)}
.todo-item.prio-red{border-color:rgba(255,59,48,.35);background:rgba(255,59,48,.04)}
.todo-item.prio-amber{border-color:rgba(255,149,0,.3)}
.todo-item.prio-blue{border-color:rgba(6,182,212,.25)}
.todo-ic{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:500;background:var(--bg2);color:var(--p-dark);flex-shrink:0}
.todo-main{flex:1;min-width:0}
.todo-title{font-size:14px;font-weight:500;color:var(--t1)}
.todo-sub{font-size:12px;color:var(--t3);margin-top:2px}
.todo-go{font-size:12px;color:var(--p-dark);flex-shrink:0}
/* Bento 模块布局
   v190：删除「近 7 天销售趋势」面板（trend-card）后，右侧只剩「近效期预警」一块 ——
     原本 today-panel(8 列 × 2 行) + trend-card(4 列 × 1 行) 拼满第 1 行、today-panel
     独自续占第 2 行左半，右侧 4 列由 trend-card 顶住。直接删 trend-card 后第 2 行
     右侧会**留 4 列空洞**（today-panel 的 grid-row:span 2 仍在）。故让 expiry-card
     拉满右侧两行（grid-row:span 2），与 today-panel 的跨度对齐，12 列完整填满。
   ⚠️ 两张条件卡（均 v-if）互为对方的「空洞来源」：today-panel 不在时 expiry 只占
     4 列、expiry-card 不在时 today-panel 只占 8 列，各自都会露出空位。
     .span-all 让两者互斥铺满（对方不在 ⇒ 我占整行），四种显隐组合均无空位。
     ⚠️ 不要改用 :has() —— scoped 样式 + 全局 .bento 的组合下可读性差且难排查。 */
.today-panel{grid-column:span 8;grid-row:span 2;padding:18px;min-height:280px}
.expiry-card{grid-column:span 4;grid-row:span 2}
.report-panel{grid-column:1/-1}
.today-panel.span-all,.expiry-card.span-all{grid-column:1/-1}

/* 空账套导入引导 —— 占整行，横向三段：图标 / 文案 / 操作 */
.import-guide{grid-column:1/-1;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px dashed var(--bd)}
.ig-ic{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--bg2);color:var(--p-dark);flex-shrink:0}
.ig-txt{flex:1;min-width:220px}
.ig-title{font-size:14px;font-weight:500;color:var(--t1)}
.ig-sub{font-size:12.5px;color:var(--t3);margin-top:3px;line-height:1.55}
.ig-acts{display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap}
.ig-pick{display:inline-flex;align-items:center;cursor:pointer}
.ig-pick.busy{opacity:.7;cursor:default}
.ig-msg{font-size:12px;color:var(--dan)}
.ig-msg.ok{color:var(--p-dark)}

.today-list{display:flex;flex-direction:column;gap:10px}
.today-card{position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px 16px 14px 18px;border:1px solid var(--border-subtle);border-radius:14px;background:var(--bg);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.today-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:var(--bd)}
.today-card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 2px 2px 0}
.today-card.prio-critical::before{background:var(--dan)}
.today-card.prio-warning::before{background:var(--war)}
.today-card.prio-info::before{background:var(--p)}
.today-card .tag{flex-shrink:0;margin-top:1px;white-space:nowrap}
.tc-body{flex:1;min-width:0}
.tc-title{font-size:13.5px;font-weight:500;color:var(--t1);margin-bottom:3px;letter-spacing:.1px}
.tc-text{font-size:12.5px;color:var(--t2);line-height:1.55}
.tc-acts{flex-shrink:0;display:flex;gap:6px}
.tc-acts .btn{height:28px;padding:0 12px;font-size:12px;border-radius:8px}
.ai-report{font-size:13px;color:var(--t1);line-height:1.8;max-height:none;overflow-y:auto}
.ai-loading{padding:12px 0}

@media(max-width:1200px){
  /* 网格降为 6 列（见 styles/variables.css）。today-panel 整行；expiry-card 也必须整行 ——
     它原为 span 3、与已删的 trend-card(span 3) 并排拼成一行，只剩自己会在右侧空 3 列。 */
  .today-panel{grid-column:span 6;grid-row:span 1}
  .expiry-card{grid-column:1/-1;grid-row:span 1}
}
@media(max-width:768px){
  .today-panel,.expiry-card,.report-panel{grid-column:1/-1;grid-row:auto}
}
</style>
