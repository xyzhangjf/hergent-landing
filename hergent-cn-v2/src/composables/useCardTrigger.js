/**
 * useCardTrigger — AI 副驾经营卡触发器（A6 拆分自 CopilotDrawer.vue）
 *
 * 职责：根据用户提问意图（正则命中）拉取对应真实经营卡（货损/工资/返利/预报），
 * 以及经营复盘多卡流水线。所有卡片走只读接口，静默降级绝不干扰主对话。
 *
 * 依赖经参数注入，便于单测与替换数据源（对应 datasource_adapter 解耦方向）。
 */
import { api } from '../api/client'

/* ---- 协议围栏统一剥离（老板永远不该看见任何控制标记） ----
   协议围栏共 5 种：```card 经营卡 / ```cards 意图 / ```clarify 澄清 /
   ```proposal 提案 / ```reminder 提醒。它们都是「给前端看的控制信号」，不是正文。
   2026-09-11 修：原先只在「本轮首次抽到卡片」时剥离 ```card 围栏，卡片抽到之后的
   后续流式分片走 `last.content = clean` 分支（clean 未剥 card 围栏）→ 整段卡片 JSON
   重新出现在正文末尾。现统一走本函数，一处收口。 */
const PROTOCOL_FENCE_RE = /```(?:cards|card|clarify|proposal|reminder)\s*[\s\S]*?```/gi
// 流式半截：围栏已开头、闭合 ``` 还没到 → 从标记处截断，避免半截 JSON 闪现在正文
const OPEN_PROTOCOL_FENCE_RE = /```(?:cards|card|clarify|proposal|reminder)[\s\S]*$/i
// 任意围栏（语言标签可有可无）：用于识别「模型把 ```card 写成 ```json 或裸 ```」的情况
const ANY_FENCE_RE = /```[a-zA-Z0-9_-]*[ \t]*\n?([\s\S]*?)```/g
// 经营卡已知 type（识别兜底用；与 ResultCard 场景表保持一致）
const CARD_TYPES = ['forecast', 'loss', 'wastage', 'payroll', 'wage', 'rebate', 'reconcile', 'kpi', 'commission']

function asCardJson(body) {
  try {
    const o = JSON.parse(String(body || '').trim())
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    return CARD_TYPES.includes(String(o.type || '').toLowerCase()) ? o : null
  } catch (_) { return null }
}

export function stripAllFences(text) {
  let t = String(text || '').replace(PROTOCOL_FENCE_RE, '')
  // 语言标签写错/漏写的经营卡围栏：内容能解析成经营卡 JSON 才剥，普通 ```json 代码块不动
  t = t.replace(ANY_FENCE_RE, (full, body) => (asCardJson(body) ? '' : full))
  t = t.replace(OPEN_PROTOCOL_FENCE_RE, '')
  // 裸卡片 JSON 兜底：模型漏打围栏时，正文尾部会整段裸着 JSON。
  // 完整对象 → 整段摘掉；流式半截 → 从对象起点截断（避免半截 JSON 逐字闪现）。
  // 2026-09-11 补：原先本函数只剥「带围栏」的，裸 JSON 只有 extractCard 会处理，
  // 而 CopilotDrawer 正文走的是本函数 → 漏围栏时整段 JSON 留在正文，老板直接看到。
  const bare = findBareCard(t)
  if (bare) {
    // 完整 → 精确摘掉 JSON 对象本身，保留其前后正文（模型没把它放末尾时不丢内容）
    // 半截 → 从对象起点截断到末尾
    t = bare.open ? t.slice(0, bare.start) : (t.slice(0, bare.start) + t.slice(bare.end))
  } else {
    // 更早的半截：连 "type" 都还没成形，只有一个孤立的 `{` 挂在尾部
    const openStart = findOpenBareStart(t)
    if (openStart >= 0) t = t.slice(0, openStart)
  }
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/* 无围栏兜底：正文尾部裸着一段经营卡 JSON（模型漏打围栏）→ 找配对右括号 */
function matchBrace(text, objStart) {
  let depth = 0, inStr = false, esc = false
  for (let i = objStart; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/* 裸卡片 JSON 定位（模型漏打围栏 / 围栏被上游吃掉）：
   完整对象 → { card, start, end }；流式半截（有起点、闭合 } 还没到）→ { card:null, start, open:true }。
   半截也必须返回 start，否则流式过程中 JSON 会一段段闪现在正文里。 */
function findBareCard(text) {
  const re = /\{\s*"type"\s*:\s*"([a-zA-Z_-]+)"/g
  const hits = []
  let m
  while ((m = re.exec(text))) hits.push({ start: m.index, type: m[1].toLowerCase() })
  for (let i = hits.length - 1; i >= 0; i--) {
    if (!CARD_TYPES.includes(hits[i].type)) continue
    const end = matchBrace(text, hits[i].start)
    if (end < 0) return { card: null, start: hits[i].start, end: -1, open: true }
    const card = asCardJson(text.slice(hits[i].start, end + 1))
    if (card) return { card, start: hits[i].start, end: end + 1, open: false }
  }
  return null
}

/* 流式刚吐出裸 JSON 的头几个字符（`{` / `{"` / `{"ty`…，type 尚未成形）：
   此时 findBareCard 还识别不到，但那个 `{` 已经会闪现在正文尾部 → 需一并截断。
   仅当 `{` 之后的字符**全是 JSON 语法字符**（无中文、无标点）才认定，
   避免误伤正文里的花括号（如「公式 {a+b}」含 + 与 }，不会命中）。 */
function findOpenBareStart(text) {
  const i = text.lastIndexOf('{')
  if (i < 0) return -1
  const tail = text.slice(i)
  if (tail.length > 40) return -1
  if (tail.includes('}')) return -1
  if (/[^\s"':,\[\]a-zA-Z0-9_\-{}]/.test(tail)) return -1
  return i
}

/* ---- M4 后端卡片协议：从 Hermes 输出抽经营卡 JSON（前端零改造消费） ----
   正文返回值一律走 stripAllFences：抽到卡片的同时把 JSON 从正文彻底摘干净。 */
export function extractCard(text) {
  const src = String(text || '')
  // ① 标准 ```card 围栏
  const m = src.match(/```card(?!s)\s*([\s\S]*?)```/i)
  const fenced = m ? asCardJson(m[1]) : null
  if (fenced) return { card: fenced, content: stripAllFences(src) }
  // ② 兜底：任意围栏里其实是经营卡 JSON（模型把语言标签写成了 json / 漏写）
  ANY_FENCE_RE.lastIndex = 0
  let g
  while ((g = ANY_FENCE_RE.exec(src))) {
    const card = asCardJson(g[1])
    if (card) return { card, content: stripAllFences(src) }
  }
  // ③ 兜底：完全没打围栏，正文尾部裸着一段经营卡 JSON
  // 正文统一走 stripAllFences（现已能剥裸 JSON），与 ①② 分支口径一致，避免围栏残留
  const bare = findBareCard(src)
  if (bare && bare.card) return { card: bare.card, content: stripAllFences(src) }
  return null
}

/* ---- AI 自主判断：```cards 意图围栏（隐藏控制信号，不出现在界面） ----
   协议：AI 在回复末尾输出 ```cards {"show":["loss","wage","rebate","forecast"]} ```
   - show 数组 = 要触发的经营卡；show:[] = 纯文字回复不出卡
   - 无该围栏 = AI 未判断 → 由前端弱正则兜底
   老板不需要知道"卡片"，是否出卡完全由 AI 依据问题语义决定。 */
export const CARD_INTENT_RE = /```cards\s*\n?\s*(\{[\s\S]*?\})\s*```/i
/* v627：DENY_RE（「只要文字/别给卡」的否定词）随兜底一起删除 ——
   它原先只作用在兜底分支，从来没拦到过 AI 自己出的卡；现在没有兜底，它已无作用。
   用户要纯文字时由 AI 依 SOUL.md 判断（「要文字材料 → 纯文字回复」）。 */

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
   前端解析渲染成可点击选项，围栏本身不出现在正文。

   v486 P1-⑥ 扩展「批量结构化决策」—— 一次问**多组**（矩阵式决策）：
   ```clarify {"questions":[{"ask":"选哪个客户？","options":[...]},{"ask":"时间定哪天？","options":[...]}]} ```
   - 旧协议（ask + options）**完全保留**：返回时 questions 显式为 null，
     前端据此走原来的单组渲染，老提示词/老 AI 输出零改造。
   - 新协议优先：只要 questions 里至少有一组带选项，就按多组渲染。 */
export const CLARIFY_RE = /```clarify\s*\n?\s*(\{[\s\S]*?\})\s*```/i

// 一组选项的归一化：过滤空项、label/query 互为兜底
function normOptions(list) {
  return Array.isArray(list)
    ? list
        .filter(o => o && (o.label || o.query))
        .map(o => ({ label: o.label || o.query, query: o.query || o.label }))
    : []
}

export function extractClarify(text) {
  const m = (text || '').match(CLARIFY_RE)
  if (!m) return null
  try {
    const c = JSON.parse(m[1].trim())
    // 新协议：questions 数组（多组决策）
    if (Array.isArray(c.questions)) {
      const qs = c.questions
        .filter(q => q && typeof q === 'object')
        .map(q => ({
          ask: typeof q.ask === 'string' ? q.ask : '',
          options: normOptions(q.options),
        }))
        .filter(q => q.options.length)
      if (qs.length) return { ask: '', options: [], questions: qs }
    }
    // 旧协议：单主题（显式补 questions:null —— 契约明确，前端据此分流）
    const ask = typeof c.ask === 'string' ? c.ask : ''
    const options = normOptions(c.options)
    return { ask, options, questions: null }
  } catch (e) { return null }
}
export function stripClarifyFence(text) {
  return (text || '').replace(CLARIFY_RE, '').replace(/^\n+/, '').trim()
}

/* ---- AI 配方自进化提案：```proposal 围栏（P2-⑦：服务中发现新口径 → 老板审批） ----
   协议：AI 在对话中发现「某口径该改」时（如某客户临期阈值 7→5 天、返利口径变了），
   不擅自改，而是末尾输出
   ```proposal {"module":"loss","title":"临期阈值建议 5 天","changes":{"threshold_days":5},"rationale":"最近多批临期 7 天仍被拒收"} ```
   - module = loss/payroll/forecast/rebate（配方模块）
   - changes = 建议改动的字段映射（object）
   - rationale = 为什么建议（老板判断依据）
   前端渲染成「采纳/忽略」卡片，围栏本身不出现在正文。采纳走「落提案→审批」，
   严守「AI 只建议不擅自下单」铁律。 */
export const PROPOSAL_RE = /```proposal\s*\n?\s*(\{[\s\S]*?\})\s*```/i
const PROPOSAL_MODULES = ['loss', 'payroll', 'forecast', 'rebate']

export function extractProposal(text) {
  const m = (text || '').match(PROPOSAL_RE)
  if (!m) return null
  try {
    const p = JSON.parse(m[1].trim())
    const module = PROPOSAL_MODULES.includes(p.module) ? p.module : ''
    const changes = (p.changes && typeof p.changes === 'object' && !Array.isArray(p.changes)) ? p.changes : null
    const steps = Array.isArray(p.steps) ? p.steps.filter(s => s && typeof s === 'object') : null
    // 计划模式闸门（v483）：带 steps 即为「多步执行计划」——AI 先列清单，用户点「执行」才真调写接口。
    // module 在此分支可选（计划可跨多个模块）。
    if (steps && steps.length) {
      return {
        module,
        title: typeof p.title === 'string' ? p.title : 'AI 执行计划',
        rationale: typeof p.rationale === 'string' ? p.rationale : '',
        steps: steps.map(s => ({
          action: typeof s.action === 'string' ? s.action : (typeof s.do === 'string' ? s.do : ''),
          target: typeof s.target === 'string' ? s.target : '',
          detail: typeof s.detail === 'string' ? s.detail : (typeof s.desc === 'string' ? s.desc : '')
        })),
        changes: null
      }
    }
    // 单条配方提案（原逻辑，向后兼容 P2-⑦）：module + changes 仍为必填
    if (!module) return null
    if (!changes || !Object.keys(changes).length) return null
    return {
      module,
      title: typeof p.title === 'string' ? p.title : '',
      changes,
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
      steps: null
    }
  } catch (e) { return null }
}
export function stripProposalFence(text) {
  return (text || '').replace(PROPOSAL_RE, '').replace(/^\n+/, '').trim()
}

/* ---- AI 待办提醒：```reminder 围栏（第三期 P0-②：AI 识别「要记得/要提醒」→ 结构化落库） ----
   协议：AI 在对话中识别到老板要「记住某件事 / 到点提醒」时，末尾输出
   ```reminder {"title":"周三提醒补货","remind_at":"2026-09-09 09:00","repeat":""} ```
   - title = 提醒内容；remind_at = 到点时间（YYYY-MM-DD HH:MM）；repeat = 空(一次性)/daily/weekly/monthly
   前端渲染成「已记下提醒」卡片，围栏本身不出现在正文。 */
export const REMINDER_RE = /```reminder\s*\n?\s*(\{[\s\S]*?\})\s*```/i
const REMINDER_REPEATS = ['', 'daily', 'weekly', 'monthly']

export function extractReminder(text) {
  const m = (text || '').match(REMINDER_RE)
  if (!m) return null
  try {
    const r = JSON.parse(m[1].trim())
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const remind_at = typeof r.remind_at === 'string' ? r.remind_at.trim() : ''
    if (!title || !/^\d{4}-\d{2}-\d{2}/.test(remind_at)) return null
    const repeat = REMINDER_REPEATS.includes(r.repeat) ? r.repeat : ''
    return { title, remind_at, repeat }
  } catch (e) { return null }
}
export function stripReminderFence(text) {
  return (text || '').replace(REMINDER_RE, '').replace(/^\n+/, '').trim()
}

/* ---- 出卡完全由 AI 判断（v627）----
   🔴 这里原先有 5 条意图正则（LOSS_RE / PAYROLL_RE / REBATE_RE / FORECAST_RE / DENY_RE）
   和 `triggerCards()`：AI 没输出 ```cards 围栏时，前端扫**用户原话**命中关键词就补一张卡。
   2026-10-19 用户报障「关键词触发这个感觉挺奇怪的，只要打了关键词就出卡，非常突兀」，
   v627b 探针在生产复现：AI 按协议不出围栏（= 它判断不需要卡），前端仍然硬插一条
   「📊 经营数据｜顺手把本月工资提成核算拉出来了：」。

   为什么必然冲突：SOUL.md（Web 端唯一判据）要求「**没有卡要展示时，就完全不要输出这个围栏**」
   ⇒ 「无围栏」在协议里表示「不要卡」，而前端把它当成「AI 没表态」。**AI 越守协议，前端越要插话。**

   另外这批正则还反向伤害 AI 的意图：makeFetcher 里的 `if (!re.test(q)) return`
   会把 AI 明确要求的卡也拦掉 —— 用户问「这个月发多少」（不含"工资"二字）时，
   AI 即使输出了 `{"show":["wage"]}`，PAYROLL_RE 不命中 ⇒ 卡压根不拉取。
   ⇒ 两处一起删，fetcher 只负责取数，是否取由 AI 决定。 */

/* ---- 存量自动卡的旧开场白（**仅用于识别历史消息**，不再用于新卡）----
   v627 之前，系统自动补的卡会自带一句拟人开场白「顺手把本月工资提成核算拉出来了：」。
   老板的原话是「给人感觉非常突兀」—— 这句不是 AI 说的，是系统替 AI 说的，
   而且以"顺手"开头像在搭话。v627 起新卡**不带任何正文**（只渲染卡本身），
   但历史会话里躺着的这批消息还要能被认出来（否则它们会跟着当前角色改署名、也躲过产物区折叠）。 */
export const LEGACY_AUTO_LEADS = {
  loss: '顺手把你这段时间的真实货损核算拉出来了：',
  payroll: '顺手把本月工资提成核算拉出来了：',
  rebate: '顺手把当前的返利进度拉出来了：',
  forecast: '顺手把这期的预报订单进度拉出来了：'
}
const AUTO_LEAD_SET = new Set(Object.values(LEGACY_AUTO_LEADS))

/** 这条正文是否属于「系统自动补卡」的**旧文案**（新消息另有 cardAuto 标记） */
export function isAutoCardContent(text) {
  return AUTO_LEAD_SET.has(String(text || '').trim())
}

/** 自动卡的**类别**（loss/payroll/rebate/forecast），拿不到返回 ''。
    用途：右侧「本次产物」里同类自动卡只留最新一张（v626，老板原话「反复问工资就堆一屏」）。
    判据同样走「正文逐字等值」——AI 主回复里可能写着类似的话，模糊匹配会连它一起折叠掉。 */
export function autoCardKind(text) {
  const t = String(text || '').trim()
  for (const k in LEGACY_AUTO_LEADS) if (LEGACY_AUTO_LEADS[k] === t) return k
  return ''
}

/**
 * @param {object} deps
 * @param {object} deps.store            全局响应式 store（用于 push 消息）
 * @param {Function} deps.scrollBottom   滚动到底部
 * @param {Function} deps.saveCurrentSession 落盘当前会话
 * @param {Function} deps.getRoleId      当前角色 role_id（实时读）
 * @param {Function} deps.getRoleMeta    角色快照工厂：rid → {role_id,name,avatar,custom_avatar}
 */
export function useCardTrigger({ store, scrollBottom, saveCurrentSession, pushRoleReply, getRoleId, getRoleMeta } = {}) {
  if (!store) throw new Error('useCardTrigger: store is required')
  const scroll = scrollBottom || (() => {})
  const save = saveCurrentSession || (() => {})
  const rid = () => (getRoleId ? (getRoleId() || '') : '')

  function pushCard(card, ownerRid) {
    // 🔴 v625：卡消息必须**自带角色快照**（与主回复 `roleMetaOf(roleId)` 同源）。
    //   此前只写 role/content/card/created_at —— 而模板的署名是
    //   `m.roleMeta?.name || currentRole.name` ⇒ 缺快照的卡**跟着当前角色漂移**：
    //   在「会计」下问工资、切到「大秘」，那条卡就署上「大秘」，老板看到的是
    //   「大秘突然主动发了条工资核算」——正是用户报的现象（v319 修过主回复这条路径，
    //   兜底卡这条漏了）。
    // 🔴 v627：**不再带正文**（content 留空）。原先正文是固定的一句拟人开场白
    //   「顺手把本月工资提成核算拉出来了：」——老板原话「给人感觉非常突兀」。
    //   卡不是任何人说的话，就谁的口吻都不该用：模板对「有卡无正文」的消息直接只渲染卡。
    store.chat.messages.push({
      role: 'assistant', content: '', card,
      // cardAuto = 这条**不是 AI 说的话**，是系统按 AI 意图拉来的数据卡。
      //   渲染层据此给中性署名（「经营数据」），不冒充任何角色。
      cardAuto: true,
      roleId: ownerRid || '',
      roleMeta: (getRoleMeta && ownerRid) ? getRoleMeta(ownerRid) : null,
      created_at: Date.now()
    })
    scroll()
    save()
    // v156 D：确定性经营卡（后端 /api/ai/*-card 聚合接口产出）**不再推 IM**。
    //   理由：这类卡只做数值聚合，没有 LLM 主回复那套口径披露。一旦判据把「没数据」
    //   读成「零风险」，错误结论会直接进老板企微 —— 2026-09-13 实测发生过
    //   （LLM 主回复说"货损算不出来"，兜底卡却推了「库存健康」到企微）。
    //   推送只保留给 AI 主回复（带口径披露），由 CopilotDrawer 负责。
    //   形参 pushRoleReply 保留以兼容既有调用契约，当前不再使用。
  }

  /* 通用单卡抓取工厂：**只管取数**，要不要取由调用方（AI 意图）决定。
     v627 去掉了 `re` 参数与 `if (!re.test(q)) return` 前置判据 ——
     它会把 AI 明确要求的卡拦掉（问「这个月发多少」不含"工资"，AI 说 show:["wage"] 也拉不到）。 */
  function makeFetcher(endpoint) {
    return function fetchCard() {
      // 🔴 v625：**发起时快照归属（会话 + 角色）**。
      //   卡是异步补的（`fireCards` 不 await），而 pushCard 直接 push 到
      //   `store.chat.messages` —— 请求飞在路上时老板很可能已经切走：
      //   切角色（同一会话里换人答）、切会话、关抽屉另开一段。
      //   回来后无脑 push ⇒ 这条卡**落进切换后的那段对话**，看着就是"AI 主动开口"。
      //   故：归属变了就**丢弃**（它答的是上一段上下文里的问题，不该出现在新上下文里）。
      // 🔴 v626 修正：「会话」的判据是 **messages 数组引用**，不是 currentId。
      //   原先比 currentId，而**新对话第一次提问**时当前 id 还是 ''，卡在飞的时候
      //   `saveCurrentSession()` 才把 id 写成 's<时间戳>' ⇒ 回来 '' !== 's…' ⇒ 第一张卡
      //   被静默丢弃（生产实测：连问 3 次工资只落 2 张）。数组引用能同时满足：
      //   新会话首次提问（引用不变 ⇒ 保留）、切历史/新建对话（store 里 `chat.messages = …`
      //   换引用 ⇒ 丢弃）。
      const ownerArr = store.chat.messages
      const ownerRid = rid()
      return api(endpoint)
        .then(res => {
          const card = res && res.card
          if (!card) return
          if (store.chat.messages !== ownerArr) return        // 已换会话 ⇒ 丢弃
          if (rid() !== ownerRid) return                      // 已换角色 ⇒ 丢弃
          pushCard(card, ownerRid)
        })
        .catch(() => { /* 静默降级，绝不干扰主对话 */ })
    }
  }

  const fetchLossCard = makeFetcher('/api/ai/loss-card')
  const fetchPayrollCard = makeFetcher('/api/ai/payroll-card')
  const fetchRebateCard = makeFetcher('/api/ai/rebate-card')
  const fetchForecastCard = makeFetcher('/api/ai/forecast-card')

  /* 按 AI 意图名单触卡：show:["loss","wage","rebate","forecast"] */
  const CARD_MAP = {
    loss: fetchLossCard, wastage: fetchLossCard,
    wage: fetchPayrollCard, payroll: fetchPayrollCard,
    rebate: fetchRebateCard, forecast: fetchForecastCard
  }
  function fireCards(list) {
    const jobs = (list || []).map(k => {
      const f = CARD_MAP[k]
      return f ? f() : Promise.resolve()
    })
    return Promise.all(jobs)
  }

  return {
    extractCard,
    fetchLossCard,
    fetchPayrollCard,
    fetchRebateCard,
    fetchForecastCard,
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
    // M2：示例卡演示「一卡双图」——近 7 日趋势（折线）+ 货损构成（环形）。
    //   构成三档之和 = 货损金额 ¥3,180，与上方指标自洽。
    chart: [
      { kind: 'mini', caption: '近 7 日货损(元)', series: [210, 380, 150, 420, 290, 510, 320] },
      { kind: 'donut', caption: '货损构成(元)', segments: [
        { label: '纯甄风味酸奶', value: 1480 },
        { label: '冠益乳 LB', value: 980 },
        { label: '其他 10 款', value: 720 }
      ] }
    ],
    actions: [
      { key: 'adopt', label: '采纳建议', primary: true },
      { key: 'detail', label: '查看明细' },
      { key: 'forward', label: '转发' },
      { key: 'reject', label: '驳回' }
    ]
  }
}
