<template>
  <div class="page">
    <!-- Bento 布局：v496 P0 由 10 卡平权重组为 7 区，三层信息架构（L1 钱 / L2 事 / L3 AI）。
         空账套态只留 A 定位栏 + 导入引导（B~G 均带 v-if="!isEmptyTenant"）。 -->
    <div class="bento">
      <!-- A · 定位栏（新增）：问候 + 日期 + 今日状态一句话 —— 打开第一眼回答
           「我在哪、今天周几、今天怎么样」。日期串启用此前定义未渲染的 todayStr。 -->
      <div class="card wb-head">
        <span class="wb-hi">{{ greeting }}，{{ whoName }}</span>
        <span class="wb-date">{{ todayStr }}</span>
        <span class="wb-status">{{ wbStatus }}</span>
      </div>

      <!-- B · 经营概览（L1 核心指标）。
           v349：KPI 条数据源归 `dashboard` 模块，默认只给老板/管理员。
           v651：无权限时**直接不渲染**（撤销 v496 P0-6 的降级说明条）—— 不向无权限者
                 主动曝光「仅老板/管理员可见」，隐藏即可；空账套时一并隐藏。 -->
      <div class="card kpi-strip" v-if="store.canModule('dashboard') && !isEmptyTenant">
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

      <!-- C · 今日要务（L2 主行动区）—— v496 P0-2：合并原「今日待办」与「今日经营要务」
           （两个面板原本答同一个问题），统一按紧急度排序：critical → warning → info。
           每行一个来源：AI 要务卡（带 actions）或本地待办（跳页面），不再同一数据多处平权。 -->
      <div class="card wb-tasks" v-if="!isEmptyTenant">
        <div class="panel-hd">
          <b>今日要务</b>
          <span class="badge" :class="taskBadgeCls">{{ mergedTasks.length }} 项待处理</span>
        </div>
        <div class="task-list">
          <div v-for="(t, i) in mergedTasks" :key="i" class="task-row" :class="'prio-' + t.prio">
            <span v-if="t.kind === 'card'" class="tag" :class="t.tag">{{ t.tagText }}</span>
            <span v-else class="task-ic">{{ t.icon }}</span>
            <div class="task-main">
              <div class="task-title">{{ t.title }}</div>
              <div class="task-sub">{{ t.sub }}</div>
            </div>
            <div class="task-acts">
              <button v-for="a in t.actions" :key="a.label" class="btn btn-ghost" @click="cardAction(a)">{{ a.label }}</button>
              <span v-if="t.kind === 'todo'" class="task-go" @click="goTodo(t)">去处理 →</span>
            </div>
          </div>
        </div>
      </div>

      <!-- D · 近效期预警（L2 明细）：与 C 同行拉满右侧 4 列。
           v496：撤掉 v190 的 span-all 互斥补丁 —— 本卡空时显示空态卡而非消失，栅格不塌。 -->
      <div class="card expiry-card" v-if="!isEmptyTenant">
        <div class="panel-hd">
          <b>近效期预警</b>
          <span v-if="expiryData.length" class="tag bad">{{ expiryData.length }} 条</span>
        </div>
        <div v-if="expiryData.length" class="table-wrap">
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
        <div v-else class="state-empty">
          <div class="se-ic"><Icon name="check" :size="22" /></div>
          <p>近 14 天无临期批次，保持节奏</p>
        </div>
      </div>

      <!-- 补货建议（v259：本周建议订购清单 · 直接消费既有 /api/ai/replenishment 算层，
           零 AI 推理成本，且每条带口径披露 reason。占整行，不扰动今日/效期 8/4 栅格） -->
      <div class="card repl-panel" v-if="replItems.length || replLoading">
        <div class="panel-hd">
          <b>本周建议订购清单</b>
          <span class="panel-note">基于安全库存 · 在途扣减</span>
          <span class="repl-head-actions">
            <button class="btn btn-primary repl-docx" :disabled="downloadingDocx" @click="downloadWeeklyDocx">生成经营周报（Word）</button>
            <button class="btn btn-ghost repl-refresh" :disabled="replLoading" @click="loadReplenishment">刷新</button>
          </span>
        </div>
        <div v-if="replLoading" class="ai-loading">
          <div class="skel-line" style="width:90%"></div>
          <div class="skel-line" style="width:70%;margin-top:8px"></div>
          <div class="skel-line" style="width:85%;margin-top:8px"></div>
        </div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead><tr><th>商品</th><th class="num">现有库存</th><th class="num">在途</th><th class="num">建议补</th><th>口径</th></tr></thead>
            <tbody>
              <tr v-for="r in replItems" :key="r.product_id">
                <td>{{ r.product_name || '—' }}</td>
                <td class="num">{{ fmt(r.current_stock) }}</td>
                <td class="num">{{ fmt(r.on_order) }}</td>
                <td class="num val-warn">{{ fmt(r.suggest_qty) }}</td>
                <td class="repl-reason">{{ r.reason }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="replItems.length" class="repl-foot">共 {{ replItems.length }} 个单品需补货 · 仅作建议，实际下单请结合促销/临期情况拍板</div>
        </div>
      </div>

      <!-- F · 客户回款（v303）：整合进工作台，不新增侧栏 ——
           老板每天在这页看「今天欠多少 / 该催谁」，收款与催收本是同一动作的两半。 -->
      <CollectionsCard />

      <!-- G · AI 洞察（L3）—— v496 P0-3：经营研判 / 经验闭环 / AI 晨报三张整行卡收敛为
           一个 tab 区（默认「今日研判」，让最强的 AI 能力有点击曝光），卡头保留唯一 AI 徽标。
           三块内容原样搬入、逻辑零改动；徽标由 6 个 badge-blue 收敛到卡头 1 个（P0-4）。
           权限判据沿用 v325：整卡按 store.canUseAi() 收窄（唯一定义处见 store/index.js）。 -->
      <div class="card ai-insight" v-if="!isEmptyTenant && store.canUseAi()">
        <div class="panel-hd">
          <b>AI 洞察</b>
          <span class="badge badge-blue">AI 副驾</span>
          <div class="ai-tabs">
            <button class="ai-tab" :class="{ active: aiTab === 'judge' }" @click="aiTab = 'judge'">今日研判</button>
            <button class="ai-tab" :class="{ active: aiTab === 'loop' }" @click="aiTab = 'loop'">经验闭环</button>
            <button class="ai-tab" :class="{ active: aiTab === 'report' }" @click="aiTab = 'report'">AI 晨报</button>
          </div>
        </div>

        <!-- tab 1 · 今日研判（默认）：掉量归因 + 先出哪批权衡，全部只读、真实数据兜底 -->
        <div v-if="aiTab === 'judge'" class="ai-pane">
          <div class="pane-cta">
            <span class="panel-note">AI 研判 · 只读建议</span>
            <button class="btn btn-primary" :disabled="judgeLoading" @click="loadDecline">诊断近期掉量商品</button>
          </div>
          <div v-if="declineAnchor" class="judge-anchor">对比窗口锚定：数据最新日 {{ declineAnchor }}（按最近一个 {{ declinePeriod }} 天 vs 上一个同长窗口）</div>

          <!-- A：掉量归因 -->
          <div v-if="judgeLoading" class="ai-loading">
            <div class="skel-line" style="width:90%"></div>
            <div class="skel-line" style="width:70%;margin-top:8px"></div>
            <div class="skel-line" style="width:85%;margin-top:8px"></div>
          </div>
          <div v-else-if="declineItems.length" class="judge-list">
            <div v-for="d in declineItems" :key="d.product_id" class="judge-row">
              <div class="judge-row-hd">
                <span class="j-name">{{ d.product_name }}</span>
                <span class="j-drop">↓{{ d.drop_pct }}%（{{ d.qty_recent }}/{{ d.qty_prior }} 件）</span>
              </div>
              <div class="j-grounded">库存 {{ d.grounded.stock }} · 安全库存 {{ d.grounded.safety_stock }} · 在途 {{ d.grounded.on_order }} · 7天临期 {{ d.grounded.near_expiry_qty }}</div>
              <div v-if="d.ai_ok && d.diagnosis" class="j-diag" v-html="renderMd(d.diagnosis)"></div>
              <div v-else-if="!d.ai_ok" class="j-diag j-diag-warn">AI 研判暂不可用（真实数据已上表），联网后可重试</div>
            </div>
          </div>
          <div v-else-if="judgeReady && noSalesData" class="state-empty"><p>暂无可对比的销售数据（销售历史为空或尚未录入）</p></div>
          <div v-else-if="judgeReady" class="state-empty"><p>最近一个 {{ declinePeriod }} 天窗口暂无显著掉量商品</p></div>

          <!-- B：先出哪批（多目标权衡） -->
          <div class="judge-tradeoff">
            <div class="j-tradeoff-hd">
              <span>先出哪批（临期 vs 新鲜度 vs 利润）</span>
              <span class="j-pick">
                <select v-model.number="tradeoffProductId" class="j-select">
                  <option :value="0">选择商品…</option>
                  <option v-for="p in productOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <button class="btn btn-ghost" :disabled="tradeoffLoading || !tradeoffProductId" @click="loadTradeoff">研判</button>
              </span>
            </div>
            <div v-if="tradeoffLoading" class="ai-loading">
              <div class="skel-line" style="width:80%"></div>
              <div class="skel-line" style="width:60%;margin-top:8px"></div>
            </div>
            <div v-else-if="tradeoffData && tradeoffData.no_batch_data" class="j-diag j-diag-warn">
              该商品暂未录入批次 / 效期信息，无法做批次级出库权衡。当前总库存 {{ tradeoffData.grounded.total_stock }} 件、毛利率 {{ tradeoffData.grounded.margin_pct }}%。在库存中补录批号与效期后可自动启用。
            </div>
            <div v-else-if="tradeoffData" class="j-tradeoff-body">
              <table class="tbl">
                <thead><tr><th>批号</th><th>效期</th><th class="num">数量</th><th class="num">成本</th></tr></thead>
                <tbody>
                  <tr v-for="(b,i) in tradeoffData.batches" :key="i">
                    <td>{{ b.batch_no || '无' }}</td>
                    <td>{{ b.expiry_date || '未录' }}</td>
                    <td class="num">{{ fmt(b.quantity) }}</td>
                    <td class="num">{{ b.cost_price }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="j-grounded">毛利率 {{ tradeoffData.grounded.margin_pct }}% · 总库存 {{ tradeoffData.grounded.total_stock }} 件 · 在途 {{ tradeoffData.grounded.on_order }} 件</div>
              <div v-if="tradeoffData.ai_ok && tradeoffData.tradeoff" class="j-diag" v-html="renderMd(tradeoffData.tradeoff)"></div>
              <div v-else-if="!tradeoffData.ai_ok" class="j-diag j-diag-warn">AI 权衡暂不可用（真实批次已上表），联网后可重试</div>
            </div>
          </div>
        </div>

        <!-- tab 2 · 经验闭环（越用越聪明 · P2-4）：只读健康看板 + 三项验收指标，全量 soft-fail -->
        <div v-else-if="aiTab === 'loop'" class="ai-pane">
          <div class="pane-cta">
            <span class="panel-note">AI 自进化底座 · 只读</span>
            <button class="btn btn-ghost" :disabled="loopLoading" @click="loadLoopStatus">刷新</button>
          </div>
          <div v-if="loopLoading" class="ai-loading">
            <div class="skel-line" style="width:80%"></div>
            <div class="skel-line" style="width:60%;margin-top:8px"></div>
          </div>
          <div v-else-if="loopStatus" class="loop-body">
            <div class="loop-kpis">
              <div class="loop-kpi"><span class="num">{{ loopStatus.captured_overrides }}</span><span class="lbl">已捕获覆写</span></div>
              <div class="loop-kpi"><span class="num">{{ loopStatus.cross_tenant_caliber_entries }}</span><span class="lbl">跨租户口径</span></div>
              <div class="loop-kpi"><span class="num">{{ loopStatus.acceptance.loop_proposals_total }}</span><span class="lbl">自动提案</span></div>
              <div class="loop-kpi"><span class="num" :class="loopStatus.red_line_blocked ? 'warn' : 'ok'">{{ loopStatus.red_line_blocked }}</span><span class="lbl">红线拦截</span></div>
            </div>
            <div class="loop-accept">
              <div class="la-row"><span>可追溯率（每条都有来源依据）</span><b>{{ loopStatus.acceptance.source_ref_nonempty_rate }}%</b></div>
              <div class="la-row"><span>跨 ≥2 场景复用</span><b>{{ loopStatus.acceptance.cross_tenant_reused_scenarios }}</b></div>
              <div class="la-row"><span>提案否决率（回归风险）</span><b>{{ loopStatus.acceptance.loop_proposal_rejection_rate }}%</b></div>
            </div>
            <div class="loop-note">只共享算法口径（参数名 + 量级桶）；金额 / 工资 / 客户 / 进货价 / 返利费率等商业秘密一律不跨租户。</div>
          </div>
          <div v-else class="state-empty"><p>经验闭环指标暂不可用</p></div>
        </div>

        <!-- tab 3 · AI 晨报（v496 P0-5：当日缓存 + 进页自动生成一次，文案与行为一致） -->
        <div v-else class="ai-pane">
          <div class="pane-cta">
            <span class="panel-note">每天早上自动生成 · 当日缓存</span>
            <button class="btn btn-ghost" :disabled="aiLoading" @click="loadMorning(true)">重新生成</button>
          </div>
          <div v-if="!aiText && !aiLoading" class="state-empty">
            <div class="se-ic"><Icon name="sun" :size="22" /></div>
            <p>今日晨报还没有生成</p>
            <button class="btn btn-ghost" style="margin-top:12px" :disabled="aiLoading" @click="loadMorning(true)">生成今日晨报</button>
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { toast, store } from '../store'
/* v291：待办项也会指向受权限保护的页面 ⇒ 入口同判据（见 goTodo）。 */
import { canSee, pageTitle } from '../constants/pages'
import { hermesChat, auth } from '../api/client'
import { stripAllFences } from '../composables/useCardTrigger'
import { dashboardApi, expiryApi, todayApi, importApi, aiJudgementApi, aiExperienceApi, productsApi } from '../api/modules'
import CollectionsCard from '../components/CollectionsCard.vue'
import Icon from '../components/Icon.vue'

/* ---- 日期 ---- */
const todayStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })

/* ---- A 定位栏（v496 P0-1）：问候 + 名称 + 今日状态一句话 ---- */
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})
const whoName = computed(() => (store.user && store.user.name) || '老板')

/* ---- G AI 洞察 tab（v496 P0-3）：默认「今日研判」，让最强的 AI 能力有点击曝光 ---- */
const aiTab = ref('judge')

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

/* ---- 本周建议订购清单（v259：消费 /api/ai/replenishment 既有算层） ---- */
const replItems = ref([])
const replLoading = ref(false)
const downloadingDocx = ref(false)

/* ---- 经营研判（判层 · P1-2b）：掉量归因 + 先出哪批权衡，全部只读 ---- */
const judgeReady = ref(false)
const judgeLoading = ref(false)
const declineItems = ref([])
const declinePeriod = ref(30)
const declineAnchor = ref('')
const noSalesData = ref(false)
const tradeoffLoading = ref(false)
const tradeoffData = ref(null)
const tradeoffProductId = ref(0)
const productOptions = ref([])

/* ---- 经验闭环（越用越聪明 · P2-4）：只读健康看板 ---- */
const loopStatus = ref(null)
const loopLoading = ref(false)

async function loadLoopStatus() {
  loopLoading.value = true
  try {
    const r = await aiExperienceApi.loopStatus()
    loopStatus.value = r || null
  } catch (e) {
    loopStatus.value = null
  } finally {
    loopLoading.value = false
  }
}

async function loadProducts() {
  try {
    const r = await productsApi.grid()
    const rows = (r && r.rows) || []
    productOptions.value = rows.map((p) => ({ id: p.id, name: p.name || ('#' + p.id) }))
  } catch (e) {
    productOptions.value = []
  }
}

async function loadDecline() {
  judgeLoading.value = true
  judgeReady.value = false
  declineItems.value = []
  declineAnchor.value = ''
  noSalesData.value = false
  try {
    const r = await aiJudgementApi.decline(30, 8)
    declinePeriod.value = (r && r.period_days) || 30
    declineAnchor.value = (r && r.anchor_date) || ''
    noSalesData.value = !!(r && r.no_sales_data)
    declineItems.value = (r && r.items) || []
  } catch (e) {
    declineItems.value = []
    toast('掉量诊断失败，请稍后重试', 'warn')
  } finally {
    judgeReady.value = true
    judgeLoading.value = false
  }
}

async function loadTradeoff() {
  if (!tradeoffProductId.value) return
  tradeoffLoading.value = true
  tradeoffData.value = null
  try {
    const r = await aiJudgementApi.batchTradeoff(tradeoffProductId.value, 1)
    tradeoffData.value = r || null
  } catch (e) {
    tradeoffData.value = null
    toast('批次权衡失败，请稍后重试', 'warn')
  } finally {
    tradeoffLoading.value = false
  }
}

async function loadReplenishment() {
  replLoading.value = true
  try {
    const r = await dashboardApi.replenishment(1, 20)
    replItems.value = (r && r.suggestions) || []
  } catch (e) {
    replItems.value = []
  } finally {
    replLoading.value = false
  }
}

async function downloadWeeklyDocx() {
  downloadingDocx.value = true
  try {
    const headers = {
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(auth.tenant ? { 'X-Tenant-Id': String(auth.tenant) } : {}),
    }
    const res = await fetch('/api/meeting/export-docx', { method: 'GET', headers })
    if (!res.ok) { toast(`生成失败（${res.status}）`, 'warn'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `经营周报_${new Date().toISOString().slice(0, 10)}.docx`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
    toast('经营周报已生成，开始下载', 'success')
  } catch (e) {
    toast('生成失败，请稍后重试', 'warn')
  } finally {
    downloadingDocx.value = false
  }
}

function renderMd(t) {
  // 晨报同样是 Hermes 输出，可能附带 ```card / ```cards 控制标记 —— 先剥干净再渲染
  return stripAllFences(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^- /gm, '<span style="color:var(--p-dark)">•</span> ')
    .replace(/\n/g, '<br>')
}

/* ---- AI 晨报（v496 P0-5）：当日缓存 + 进页自动生成一次 ----
   旧行为：卡片写「每天早上自动生成」却要手点按钮 ⇒ 文案与行为矛盾。
   新行为：当天生成过（localStorage 按日期键）直接展示；没有则生成一次并落缓存；
   用户点「重新生成」才强制重跑（force=true）。一天最多自动烧一次 AI。 */
const morningKey = () => 'wb_morning_' + new Date().toISOString().slice(0, 10)

async function loadMorning(force = false) {
  if (!force) {
    try {
      const cached = localStorage.getItem(morningKey())
      if (cached) {
        aiText.value = cached
        mdText.value = renderMd(cached)
        return
      }
    } catch (e) { /* 隐私模式等场景落不了盘：退化为每次生成 */ }
  }
  aiLoading.value = true
  aiText.value = ''
  mdText.value = ''
  const msg = { role: 'user', content: '你是我的 AI 经营副驾。请基于当前业务数据，生成今天早上的经营晨报：今日待办、需要关注的风险（货损/返利）、建议动作。请用简洁的要点列出。' }
  let full = ''
  try {
    await hermesChat([msg], {
      onDelta: (d, f) => { full = f; aiText.value = f; mdText.value = renderMd(f) }
    })
    if (full) { try { localStorage.setItem(morningKey(), full) } catch (e) { /* 忽略落盘失败 */ } }
  } catch (e) {
    aiText.value = '晨报生成失败：' + (e.message || 'AI 未连接')
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
  loadReplenishment()
  loadProducts()
  loadLoopStatus()
  // v496 P0-5：有 AI 权限且非空账套 ⇒ 进页自动生成一次晨报（当日缓存，不重复烧 AI）。
  // 此时 dashData/expiry/today/recentActions 均已 await 完 ⇒ isEmptyTenant 已定值。
  if (store.canUseAi() && !isEmptyTenant.value) loadMorning()
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
  // v652（2026-10-21）：AI 入口按权限收窄 —— 无 `chat` 模块（= 无 AI 权限）就不生成这条待办。
  //   判据走 store.canUseAi()（唯一定义处见 store/index.js），与顶部栏 / ⌘K / 命令面板 / 预报右键同源。
  //   此前漏了这一处 ⇒ 无 AI 权限的员工在经营工作台看到「问问 AI」且点击能打开副驾（权限缺陷）。
  if (store.canUseAi()) items.push({ icon: '聊', title: '问问 AI 今天该做什么', sub: '打开对话，AI 副驾随时待命', prio: 'blue', path: '/chat' })
  todoItems.value = items.slice(0, 5)
  todoLoading.value = false
}

/* ---- C 今日要务（v496 P0-2）：合并「今日待办」+「今日经营要务」，按紧急度排序 ----
   两个面板原本答同一个问题（今天要处理什么）⇒ 统一为一条流：
     · AI 要务卡（todayCards）：带类型签 + 行内 actions 按钮
     · 本地待办（todoItems）：跳页面（临期 → /loss、问 AI → 副驾抽屉）
   排序 critical → warning/amber → info/blue；今日要务卡已含「临期」类时，
   待办里的临期摘要行跳过（同一问题只留一个入口，不再多处平权重复）。 */
const mergedTasks = computed(() => {
  const tasks = []
  for (const c of todayCards.value) {
    tasks.push({
      kind: 'card',
      prio: c.priority === 'critical' ? 'red' : c.priority === 'warning' ? 'amber' : 'blue',
      rank: c.priority === 'critical' ? 0 : c.priority === 'warning' ? 1 : 2,
      tag: cardTag(c),
      tagText: cardTypeLabel(c.type),
      title: c.title,
      sub: c.body,
      actions: c.actions || [],
    })
  }
  const hasExpiryCard = todayCards.value.some((c) => c.type === 'expiry')
  for (const t of todoItems.value) {
    if (hasExpiryCard && t.prio === 'amber') continue
    tasks.push({
      kind: 'todo',
      prio: t.prio === 'amber' ? 'amber' : 'blue',
      rank: t.prio === 'amber' ? 1 : 2,
      icon: t.icon,
      title: t.title,
      sub: t.sub,
      path: t.path,
      actions: [],
    })
  }
  return tasks.sort((a, b) => a.rank - b.rank)
})

/* v496 P0-4 徽标四语义：红=紧急马上处理 / 琥珀=今天要处理 / 绿=正常。
   全页 badge-blue 只保留在 G 区卡头（AI 副驾）一处。 */
const taskBadgeCls = computed(() =>
  mergedTasks.value.some((t) => t.prio === 'red') ? 'badge-red'
    : mergedTasks.value.some((t) => t.prio === 'amber') ? 'badge-amber' : 'badge-green'
)

/* 定位栏右侧：今日状态一句话（v496 P0-1） */
const wbStatus = computed(() => {
  const d = dashData.value
  if (!d) return '数据加载中…'
  if (isEmptyTenant.value) return '还没有经营数据，先导入一份 Excel'
  return '今日销售 ¥' + fmt(d.sales) + ' · 毛利 ¥' + fmt(d.profit) + ' · ' + mergedTasks.value.length + ' 项要务待处理'
})

function goTodo(t) {
  /* v496：「问问 AI 今天该做什么」原对 '/chat' 直接 return ⇒ 点了没反应（假入口）。
     /chat 并非本仓路由（副驾是全局抽屉 CopilotDrawer）⇒ 开抽屉才是正确动作。 */
  if (t.path === '/chat') { if (store.canUseAi()) store.ui.copilotOpen = true; return }
  /* v291（2026-09-27）：待办项也会指向**受权限保护的页面**（如「临期预警」→ /loss）——
     入口必须与侧栏同一判据，否则司机/导购看到待办、点一下被守卫弹回工作台，
     正是 v267 修过的那类**假入口**。 */
  if (!canSee(t.path)) { toast('你没有访问「' + pageTitle(t.path) + '」的权限', 'warn'); return }
  // hash 路由跳转
  window.location.hash = '#' + t.path
}

onMounted(loadData)
</script>

<style scoped>
/* .bento / .kpi-strip 及 KPI 子元素样式已上提全局层（src/styles/variables.css），
   此处只保留本页模块占位与局部组件。 */
/* 经营研判（判层 · P1-2b）—— 内容现居 G 区「今日研判」tab 内（v496 P0-3），类名未动 */
.judge-anchor{font-size:12px;color:var(--t3);margin-top:6px}
.judge-list{display:flex;flex-direction:column;gap:10px;margin-top:10px}
.judge-row{border:1px solid var(--bd);border-radius:var(--radius-md);padding:12px 14px;background:var(--bg2)}
.judge-row-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.j-name{font-size:14px;font-weight:600;color:var(--t1)}
.j-drop{font-size:12px;color:var(--dan);font-weight:500}
.j-grounded{font-size:12px;color:var(--t3);margin-top:6px}
.j-diag{font-size:13px;color:var(--t2);margin-top:8px;line-height:1.6}
.j-diag-warn{color:var(--war)}
.judge-tradeoff{margin-top:16px;border-top:1px dashed var(--bd);padding-top:14px}
.j-tradeoff-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:14px;font-weight:500;color:var(--t1)}
.j-pick{display:flex;align-items:center;gap:8px}
.j-select{max-width:200px;padding:6px 8px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:13px}
.j-tradeoff-body{margin-top:12px}
.j-tradeoff-body .tbl{margin-bottom:8px}

/* A · 定位栏（v496 P0-1）：问候 + 日期 + 今日状态一句话 */
.wb-head{grid-column:1/-1;display:flex;align-items:baseline;gap:12px;padding:14px 18px;flex-wrap:wrap}
.wb-hi{font-size:20px;font-weight:700;color:var(--t1);letter-spacing:-.3px}
.wb-date{font-size:13px;color:var(--t3)}
.wb-status{margin-left:auto;font-size:13px;color:var(--t2);font-variant-numeric:tabular-nums}
/* 面板内口径说明小字（v496 P0-4）：替代滥用 badge-blue 的说明标 */
.panel-note{font-size:12px;color:var(--t3);font-weight:400}
/* G 区 tab 页内的「说明 + 主操作」行 */
.pane-cta{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}

/* C · 今日要务（v496 P0-2）：原「今日待办 + 经营要务」两套行样式合并为一套。
   紧急度用左侧色条表达（red=马上处理 / amber=今天处理 / blue=仅知悉），
   与卡头徽标（taskBadgeCls）同语义 —— 视觉层级：数字(B) > 要务行(C) > 明细(D)。 */
.wb-tasks{grid-column:span 8;grid-row:span 2;padding:18px;min-height:280px}
.task-list{display:flex;flex-direction:column;gap:10px}
.task-row{position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px 16px 14px 18px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.task-row:hover{transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:var(--bd)}
.task-row::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 2px 2px 0}
.task-row.prio-red::before{background:var(--dan)}
.task-row.prio-amber::before{background:var(--war)}
.task-row.prio-blue::before{background:var(--p)}
.task-row .tag{flex-shrink:0;margin-top:1px;white-space:nowrap}
.task-ic{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:500;background:var(--bg2);color:var(--p-dark);flex-shrink:0}
.task-main{flex:1;min-width:0}
.task-title{font-size:13.5px;font-weight:500;color:var(--t1);margin-bottom:3px;letter-spacing:.1px}
.task-sub{font-size:12.5px;color:var(--t2);line-height:1.55}
.task-acts{flex-shrink:0;display:flex;gap:6px;align-items:center}
.task-acts .btn{height:28px;padding:0 12px;font-size:12px;border-radius:var(--radius-sm)}
.task-go{font-size:12px;color:var(--p-dark);cursor:pointer;white-space:nowrap}

/* G · AI 洞察 tab 区（v496 P0-3）：三张整行卡收敛为一卡三页签 */
.ai-insight{grid-column:1/-1}
.ai-tabs{display:flex;gap:4px;background:var(--bg2);border-radius:var(--radius-sm);padding:3px}
.ai-tab{height:28px;padding:0 14px;border:none;border-radius:var(--radius-xs);background:transparent;color:var(--t2);font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,color .15s;font-family:inherit}
.ai-tab:hover:not(.active){color:var(--t1)}
.ai-tab.active{background:var(--bg);color:var(--t1);box-shadow:var(--shadow-sm)}
.ai-pane{margin-top:2px}

/* Bento 模块布局（v496）
   C 要务 span 8 × 2 行 + D 效期 span 4 × 2 行 拼满第 1 行；C 恒有内容
   （待办流至少一行「问问 AI」），D 空时显示空态卡 ⇒ 无需 v190 的 span-all 补丁。 */
.wb-tasks{grid-column:span 8;grid-row:span 2;padding:18px;min-height:280px}
.expiry-card{grid-column:span 4;grid-row:span 2}
/* v259：本周建议订购清单 —— 占整行，不扰动要务/效期 8/4 栅格 */
.repl-panel{grid-column:1/-1}
.repl-refresh{margin-left:auto;padding:4px 12px;font-size:12px}
.repl-head-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.repl-docx{padding:4px 12px;font-size:12px}
.repl-reason{color:var(--t3);font-size:12px;max-width:340px}
.repl-foot{margin-top:10px;font-size:12px;color:var(--t3)}
/* 经验闭环（内容现居 G 区「经验闭环」tab 内，v496 P0-3） */
.loop-kpis{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px}
.loop-kpi{display:flex;flex-direction:column;align-items:center;min-width:74px;padding:8px 10px;border:1px solid var(--bd);border-radius:var(--radius-md);background:var(--bg)}
.loop-kpi .num{font-size:20px;font-weight:700;color:var(--t1);line-height:1.2}
.loop-kpi .num.ok{color:var(--suc)}
.loop-kpi .num.warn{color:var(--war)}
.loop-kpi .lbl{font-size:12px;color:var(--t3);margin-top:2px}
.loop-accept{display:flex;gap:22px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:var(--t2)}
.loop-accept .la-row{display:flex;gap:6px;align-items:center}
.loop-accept .la-row b{color:var(--t1);font-size:14px}
.loop-note{margin-top:10px;font-size:12px;color:var(--t3);line-height:1.6}

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

.ai-report{font-size:13px;color:var(--t1);line-height:1.8;max-height:none;overflow-y:auto}
.ai-loading{padding:12px 0}

@media(max-width:1200px){
  /* 网格降为 6 列（见 styles/variables.css）：要务整行、效期整行 */
  .wb-tasks{grid-column:span 6;grid-row:span 1}
  .expiry-card{grid-column:1/-1;grid-row:span 1}
}
@media(max-width:768px){
  .wb-tasks,.expiry-card,.repl-panel,.ai-insight{grid-column:1/-1;grid-row:auto}
  .wb-status{margin-left:0;width:100%}
  .wb-hi{font-size:18px}
}
</style>
