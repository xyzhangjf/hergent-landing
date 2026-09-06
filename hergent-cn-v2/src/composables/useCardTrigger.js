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
  const m = text.match(/```card(?!s)\s*([\s\S]*?)```/i)
  if (!m) return null
  try {
    const card = JSON.parse(m[1].trim())
    const content = text.replace(/```card(?!s)\s*[\s\S]*?```/i, '').replace(/^\n+/, '').trim()
    return { card, content }
  } catch (e) { return null }
}

/* ---- AI 自主判断：```cards 意图围栏（隐藏控制信号，不出现在界面） ----
   协议：AI 在回复末尾输出 ```cards {"show":["loss","wage","rebate","forecast"]} ```
   - show 数组 = 要触发的经营卡；show:[] = 纯文字回复不出卡
   - 无该围栏 = AI 未判断 → 由前端弱正则兜底
   老板不需要知道"卡片"，是否出卡完全由 AI 依据问题语义决定。 */
export const CARD_INTENT_RE = /```cards\s*\n?\s*(\{[\s\S]*?\})\s*```/i
// 显式否定（兜底层用）：用户明确要纯文字/不要图表时，即使无意图围栏也不补卡
export const DENY_RE = /(不|别|无需|不用|免|不要).{0,6}(卡片?|图表|卡)|只要(文字|文本|正文|段落)|纯(文字|文本|正文)/i

export function extractCardIntent(text) {
  const m = (text || '').match(CARD_INTENT_RE)
  if (!m) return null
  try {
    const intent = JSON.parse(m[1].trim())
    return { show: Array.isArray(intent.show) ? intent.show : [] }
  } catch (e) { return null }
}
export function stripIntentFence(text) {
  return (text || '').replace(CARD_INTENT_RE, '').replace(/^\n+/, '').trim()
}

/* ---- AI 主动澄清：```clarify 围栏（信息不足时反问 + 结构化选项） ----
   协议：AI 在关键信息缺失或有歧义（客户名匹配到多个、数量/金额缺失、时间范围不清、
   口径有歧义）时，不硬猜、不编造，末尾输出
   ```clarify {"ask":"一句话说清要补什么","options":[{"label":"选项A","query":"补全后的完整问法"},{"label":"选项B","query":"..."}]} ```
   - ask = 要补什么；options = 2~3 个可点选项，第一个放推荐项
   - query = 老板点选后真正发送的完整问题（已补全缺失信息）
   前端解析渲染成可点击选项，围栏本身不出现在正文。 */
export const CLARIFY_RE = /```clarify\s*\n?\s*(\{[\s\S]*?\})\s*```/i

export function extractClarify(text) {
  const m = (text || '').match(CLARIFY_RE)
  if (!m) return null
  try {
    const c = JSON.parse(m[1].trim())
    const ask = typeof c.ask === 'string' ? c.ask : ''
    const options = Array.isArray(c.options)
      ? c.options
          .filter(o => o && (o.label || o.query))
          .map(o => ({ label: o.label || o.query, query: o.query || o.label }))
      : []
    return { ask, options }
  } catch (e) { return null }
}
export function stripClarifyFence(text) {
  return (text || '').replace(CLARIFY_RE, '').replace(/^\n+/, '').trim()
}

/* ---- 意图正则（仅作 AI 未输出意图围栏时的弱兜底） ---- */
export const LOSS_RE = /货损|报损|损耗|临期|过期|破损|报废|损失|近效期|效期|保质期|坏品|烂货/i
export const PAYROLL_RE = /工资|提成|算工资|算提成|发工资|佣金|薪酬|业绩提成|员.?工.?工资/i
export const REBATE_RE = /返利|算返利|返点|返佣|厂家返利|供应商返利|季度返利|年终返利/i
export const FORECAST_RE = /预报|报单|谁没报|还差.*报|订了多少|订货量|下单量|订单汇总|报单进度|催单|订货进度/i

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

  /* 按 AI 意图名单触卡：show:["loss","wage","rebate","forecast"] */
  const CARD_MAP = {
    loss: fetchLossCard, wastage: fetchLossCard,
    wage: fetchPayrollCard, payroll: fetchPayrollCard,
    rebate: fetchRebateCard, forecast: fetchForecastCard
  }
  function fireCards(list, q) {
    const jobs = (list || []).map(k => {
      const f = CARD_MAP[k]
      return f ? f(q) : Promise.resolve()
    })
    return Promise.all(jobs)
  }

  /* 触发所有非复盘卡片（send 完成后调用；AI 未给意图围栏时的弱兜底） */
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
    fireCards
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
