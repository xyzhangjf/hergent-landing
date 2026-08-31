/**
 * useCardTrigger — AI 副驾经营卡触发器（A6 拆分自 CopilotDrawer.vue）
 *
 * 职责：根据用户提问意图（正则命中）拉取对应真实经营卡（货损/工资/返利/预报），
 * 以及经营复盘多卡流水线。所有卡片走只读接口，静默降级绝不干扰主对话。
 *
 * 依赖经参数注入，便于单测与替换数据源（对应 datasource_adapter 解耦方向）。
 */
import { api } from '../api/client'

/* ---- M4 后端卡片协议：从 Hermes 输出抽 ```card 围栏 JSON（前端零改造消费） ---- */
export function extractCard(text) {
  const m = text.match(/```card\s*([\s\S]*?)```/i)
  if (!m) return null
  try {
    const card = JSON.parse(m[1].trim())
    const content = text.replace(/```card\s*[\s\S]*?```/i, '').replace(/^\n+/, '').trim()
    return { card, content }
  } catch (e) { return null }
}

/* ---- 意图正则 ---- */
export const LOSS_RE = /货损|报损|损耗|临期|过期|破损|报废|损失|近效期|效期|保质期|坏品|烂货/i
export const PAYROLL_RE = /工资|提成|算工资|算提成|发工资|佣金|薪酬|业绩提成|员.?工.?工资/i
export const REBATE_RE = /返利|算返利|返点|返佣|厂家返利|供应商返利|季度返利|年终返利/i
export const FORECAST_RE = /预报|报单|谁没报|还差.*报|订了多少|订货量|下单量|订单汇总|报单进度|催单|订货进度/i
export const REVIEW_RE = /复盘|经营分析|经营简报|综合分析|整体经营|经营总览|经营盘点|月度复盘|月度分析|本月经营|经营汇报|数据总览|经营总况/i

export const REVIEW_STEPS = [
  { label: '货损卡', ep: '/api/ai/loss-card', lead: '顺手把这段时间的真实货损核算拉出来了：' },
  { label: '工资卡', ep: '/api/ai/payroll-card', lead: '顺手把本月工资提成核算拉出来了：' },
  { label: '返利卡', ep: '/api/ai/rebate-card', lead: '顺手把当前的返利进度拉出来了：' },
  { label: '汇总报告', ep: '' }
]

/**
 * @param {object} deps
 * @param {object} deps.store            全局响应式 store（用于 push 消息）
 * @param {Function} deps.scrollBottom   滚动到底部
 * @param {Function} deps.saveCurrentSession 落盘当前会话
 */
export function useCardTrigger({ store, scrollBottom, saveCurrentSession, pushRoleReply, getRoleId } = {}) {
  if (!store) throw new Error('useCardTrigger: store is required')
  const scroll = scrollBottom || (() => {})
  const save = saveCurrentSession || (() => {})

  function pushCard(content, card) {
    store.chat.messages.push({ role: 'assistant', content, card })
    scroll()
    save()
    // P2 推送粒度：经营卡落库后，按角色绑定 push_scope 推送（仅 'card'/'all' 生效）；fail-closed
    if (pushRoleReply && getRoleId && card) {
      try {
        const rid = getRoleId()
        if (rid) {
          const ctext = card.summary || card.title || content
          const ctitle = card.title || '经营卡'
          pushRoleReply(rid, ctext, ctitle, 'card')
        }
      } catch (_) { /* 静默，绝不干扰主对话 */ }
    }
  }

  /* 通用单卡抓取工厂：regex 命中 → 拉接口 → push 卡片；静默降级 */
  function makeFetcher(re, endpoint, lead) {
    return function fetchCard(q) {
      if (!re.test(q || '')) return Promise.resolve()
      return api(endpoint)
        .then(res => {
          const card = res && res.card
          if (!card) return
          pushCard(lead, card)
        })
        .catch(() => { /* 静默降级，绝不干扰主对话 */ })
    }
  }

  const fetchLossCard = makeFetcher(LOSS_RE, '/api/ai/loss-card', '顺手把你这段时间的真实货损核算拉出来了：')
  const fetchPayrollCard = makeFetcher(PAYROLL_RE, '/api/ai/payroll-card', '顺手把本月工资提成核算拉出来了：')
  const fetchRebateCard = makeFetcher(REBATE_RE, '/api/ai/rebate-card', '顺手把当前的返利进度拉出来了：')
  const fetchForecastCard = makeFetcher(FORECAST_RE, '/api/ai/forecast-card', '顺手把这期的预报订单进度拉出来了：')

  /* ---- 经营复盘：多卡意图顺序跑三卡 + 进度条 ---- */
  function setStep(progressMsg, i, status) {
    if (!progressMsg || !progressMsg.progress) return
    const steps = progressMsg.progress.steps
    if (steps[i]) steps[i].status = status
    if (status === 'done' && steps[i + 1]) steps[i + 1].status = 'active'
    progressMsg.progress = { steps: steps.map(s => ({ ...s })) }
  }

  function runReviewPipeline(q, progressMsg) {
    return REVIEW_STEPS.reduce((chain, step, i) => {
      return chain.then(() => {
        setStep(progressMsg, i, 'active')
        if (!step.ep) return Promise.resolve().then(() => setStep(progressMsg, i, 'done'))
        return api(step.ep)
          .then(res => {
            const card = res && res.card
            if (card) pushCard(step.lead, card)
          })
          .catch(() => { /* 静默降级，绝不阻断进度条 */ })
          .then(() => setStep(progressMsg, i, 'done'))
      })
    }, Promise.resolve())
  }

  /* 触发所有非复盘卡片（send 完成后调用） */
  function triggerCards(q) {
    return Promise.all([fetchLossCard(q), fetchPayrollCard(q), fetchRebateCard(q), fetchForecastCard(q)])
  }

  return {
    extractCard,
    fetchLossCard,
    fetchPayrollCard,
    fetchRebateCard,
    fetchForecastCard,
    triggerCards,
    runReviewPipeline,
    REVIEW_RE,
    REVIEW_STEPS
  }
}

/* ---- 示例经营卡：让老板先看懂价值再开口问（数据，与组件解耦） ---- */
export function demoCard() {
  return {
    type: 'loss',
    title: '本月货损核算（预估）',
    summary: '8 月低温奶临期/破损预估损失 ¥3,180，主要集中在纯甄与冠益乳两款，建议优先促销清库。',
    metrics: [
      { label: '货损金额', value: '¥3,180', tone: 'bad' },
      { label: '货损率', value: '1.9%', tone: 'warn', hint: '行业警戒 2.5%' },
      { label: '涉及 SKU', value: '12', tone: 'neutral' },
      { label: '可挽回', value: '¥1,240', tone: 'good', hint: '促销可清' }
    ],
    points: [
      { text: '纯甄风味酸奶（批 0820）剩 86 提，8/28 到期，建议门店买赠', tone: 'warn' },
      { text: '冠益乳 LB 81 提临期，已低于成本，建议当日特价', tone: 'bad' },
      { text: '其余 10 个 SKU 货龄健康，无需处理', tone: 'good' }
    ],
    status: 'draft',
    chart: { kind: 'mini', caption: '近 7 日货损(元)', series: [210, 380, 150, 420, 290, 510, 320] },
    actions: [
      { key: 'adopt', label: '采纳建议', primary: true },
      { key: 'detail', label: '查看明细' },
      { key: 'forward', label: '转发' },
      { key: 'reject', label: '驳回' }
    ]
  }
}
