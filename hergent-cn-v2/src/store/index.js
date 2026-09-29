/* ============================================================
   store.js — Pinia 全局状态（A5 迁移自 Vue reactive 单例）
   分区：ui / user / chat，避免扁平互相污染（蓝图 4.3）

   A5 说明：
   - 用 Pinia setup store 承载同一份状态，获得 devtools / 模块化 / SSR 安全。
   - 为向后兼容，仍导出 `store` 单例（指向 Pinia store 实例）与原有具名函数，
     现有 20+ 处 `store.ui.x` / `store.chat.x` 调用点无需改动。
   - demo 为 ref，`store.demo` 读写自动解包，行为与 reactive 一致。
   ============================================================ */
import { createPinia, defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { api, auth } from '../api/client'

/* Pinia 实例在模块级创建，main.js 复用同一实例 app.use(pinia)。
   这样 store/index.js 可在 createApp 之前被 import（setTheme 等）。 */
export const pinia = createPinia()

export const useAppStore = defineStore('app', () => {
  // ---- state ----
  const ui = reactive({
    sidebarOpen: true,     // 桌面侧栏
    theme: 'light',
    mobileDrawer: false,   // 手机"更多"抽屉
    copilotOpen: false,    // AI 副驾全局抽屉
    toast: null
  })
  const user = reactive({
    name: '',
    role: '',
    roles: []              // v266：全部角色（主角色 + 兼任角色），由 loadPerms 落
  })
  const demo = ref(false)
  /* v206 (2026-09-19)：本账号在**当前租户**下的模块权限（如 payroll / hr / data…）。
     三条设计约束，缺一条就会做错事：
     ① `null` = **还不知道**（未登录 / 请求失败）⇒ `canModule()` 一律返回 true，
        即「不知道就不隐藏」。菜单隐藏只是体验优化，**权限边界永远在后端**；
        反过来写成 fail-closed，一次接口抖动就会把老板的菜单藏起来。
     ② 权限表已**按租户分叉**，故必须记住「这份权限属于哪个租户」（`permsTenant`），
        租户一变就重取 —— 否则切租户后会按上一个租户的权限显示菜单（串味）。
     ③ 只认后端 `/api/auth/permissions` 返回的模块名，**不另抄一份角色表**（那正是漂移源）。 */
  const perms = ref(null)
  const permsTenant = ref('')
  /* v296（2026-09-27）：权限**联动**用的两件东西，都来自 `/api/auth/permissions`（只加字段）。
     为什么需要它们：老板在「设置 › 权限」改完保存后，**别的会话 / 别的设备 / 已开着的标签页**
     仍按旧权限显示菜单，直到那个人重新登录 —— 用户看到的就是「权限改了没生效」。
     前端只知道自己那份缓存，**无从判断服务端那份变没变**，所以要一个可比对的东西。
       · `permsRev`    本租户自定义权限表的**内容指纹**（后端 `core.perms_rev`）。
                       与 `refreshPermsIfChanged()` 配对：只有指纹不同才重拉整份权限。
       · `customRoles` 本租户**真实改过**权限的角色名（后端 `core.custom_roles`）。
                       页面判据用它决定「内置 roles 门槛是否让位」（`constants/pages.js`）。
     🔴 `customRoles` 的三态与 `perms` 刻意不同：
          `null` = 不知道 ⇒ **不让位**（按内置门槛收紧）。方向与 `perms` 相反，理由见
          `constants/pages.js` 文件头 §四 —— 拉不到时"藏菜单"只少几个入口，
          "放行"却会让每个角色凭空多出「定时任务 / AI 团队」，看起来就像权限失效。 */
  const permsRev = ref('')
  const customRoles = ref(null)
  /* v266 套餐与能力（来自 `/api/auth/permissions` 的 `plan` / `capabilities`）。
     权威源在后端 `core._PLAN_CAPS`，前端**不另抄一份能力表**（那正是漂移源）。
     用途：决定「带走类」能力是否可用（批量导出 / API 拉取）。
     🔴 与 `perms` 同一条方向：`null` = 还不知道 ⇒ 一律放行（fail-open）。
        理由不是「这不重要」，而是「一次接口抖动不能把老板已有的导出按钮藏起来」；
        而且本层只是**界面门禁** —— 真正的边界在后端（详见 `core._PLAN_CAPS` 注释）。 */
  const plan = ref('')
  const caps = ref(null)
  const chat = reactive({
    messages: [],          // {role:'user'|'assistant', content}
    streaming: false,
    error: '',
    sessions: [],          // 历史会话 [{id, title, messages, updated_at}]
    sessionsLoading: false,// 正在向服务端拉会话列表（历史视图显示"加载中"）
    currentId: '',         // 当前会话 id（'' = 新对话）
    roles: [],             // AI 团队列表（来自 /api/ai/roles）
    currentRole: ''        // 当前团队 role_id（默认 copilot）
  })

  // ---- actions ----
  function toast(msg, type = 'info') {
    ui.toast = { msg, type, id: Date.now() }
    setTimeout(() => { ui.toast = null }, 3000)
  }

  function setTheme(t) {
    ui.theme = t
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(t)
    localStorage.setItem('hergent_theme', t)
  }

  /* ---- 模块权限：拉取 / 判定（v206）------------------------------------------
     调用点只需 `await store.loadPerms()`（幂等：同一租户只拉一次），
     再用 `store.canModule('payroll')` 决定入口是否渲染。 */
  async function loadPerms(force = false) {
    const tid = String(auth.tenant || '')
    if (!force && perms.value !== null && permsTenant.value === tid) return perms.value
    try {
      const d = await api('/api/auth/permissions')
      const list = Array.isArray(d && d.permissions) ? d.permissions : []
      perms.value = list
      permsTenant.value = tid
      const r = d && d.user && d.user.role
      if (r) user.role = r          // 顺带把角色落到 store（此前全仓无人赋值）
      const rs = d && d.user && d.user.roles
      if (Array.isArray(rs) && rs.length) user.roles = rs
      plan.value = (d && d.plan) || ''
      caps.value = (d && d.capabilities) || null
      // v296：权限联动的两个派生字段（后端"只加不改"地追加在同一条响应里）
      permsRev.value = String((d && d.perms_rev) || '')
      const cr = d && d.custom_roles
      customRoles.value = Array.isArray(cr) ? cr.map(String) : []
      if (d && d.user && !user.name) {
        user.name = d.user.display_name || d.user.username || user.name
      }
    } catch (e) {
      // 🔴 拉不到 ≠ 没权限。保持「未知」（fail-open），别把菜单错误地藏起来。
      perms.value = null
      permsTenant.value = ''
      // 能力同理：未知 ⇒ `canCap()` 放行（不因一次抖动藏掉导出按钮）。
      caps.value = null
      // v296：`customRoles` 的"未知"刻意走**相反方向**（null ⇒ 不让位 ⇒ 按内置门槛收紧），
      //       理由见 state 注释里那段三态说明。这里**不要**图省事写成 `[]`：
      //       `[]` 的含义是"已确认没有任何角色被改过"，与"不知道"是两回事。
      customRoles.value = null
      permsRev.value = ''
    }
    return perms.value
  }

  /** 该模块在当前租户下是否授权。未知（未加载/失败）⇒ true（不隐藏）。 */
  function canModule(m) {
    const p = perms.value
    if (!p) return true
    return p.indexOf('*') >= 0 || p.indexOf(m) >= 0
  }

  /* ---- v296 权限联动：权限被别处改过时，本会话自动跟上 -------------------------------
     🔴 缺陷原样：老板改完权限保存，**只有他自己这台机器**的菜单会变（保存后前端强制重拉
        一次）。别的会话、别的设备、已经开着的标签页**一直按旧权限显示**，直到重新登录
        —— 用户看到的就是「权限改了没生效」，而系统里没有任何一处能自证这件事。
     解法：拿一个**几十字节**的版本号做比对，不同才重拉整份权限。
        · `rev` 相同 ⇒ 什么都不做（绝大多数情况，零渲染、零状态变化）。
        · `rev` 不同 ⇒ `loadPerms(true)` ⇒ `perms / role / roles / customRoles / plan / caps`
          全部刷新，侧栏 24 处 `canSee()`、命令面板、页内跳转判据一起重算（都是响应式的）。
     调用时机（三处，缺一不可，各自覆盖一种"人回来的时刻"）：
        ① 设置页保存成功后 —— 立刻、同步地（`Settings.vue::savePerms`，不用等轮询）；
        ② 每次路由导航 —— 不 await（不让导航多等一次往返），下一次导航生效；
        ③ 切回标签页 / 每 60 秒轮询 —— `Shell.vue`，覆盖"人一直停在某个页面"的情形。
     🔴 节流 20 秒：`②` 的触发频率 = 用户点菜单的频率。不节流的话，每次点导航都发一个请求
        —— 那是把一个"零成本的正确性检查"变成持续的背景流量。
     🔴 401/网络失败一律**静默**（`silent401` + 空 catch）：这是个体验优化，
        绝不能让它在网络抖动时打断用户，更不能把会话踢掉。 */
  const REV_CHECK_MIN_INTERVAL_MS = 20000
  let _revCheckedAt = 0
  let _revInflight = null

  /**
   * 若服务端权限版本与本地不同则重拉权限。
   * @param {boolean} force 跳过 20 秒节流（切回标签页 / 轮询用；导航用默认值即可）
   * @returns {Promise<boolean>} true = 检测到变更并已重拉
   */
  async function refreshPermsIfChanged(force = false) {
    // 还没加载过权限 ⇒ 不在这里补：那是 `loadPerms()` 的职责（本函数只做"增量比对"）。
    // 在 `perms === null` 时去比对，会把"首次加载"误判成"变更"，两条路各自发请求。
    if (!perms.value) return false
    const now = Date.now()
    if (!force && now - _revCheckedAt < REV_CHECK_MIN_INTERVAL_MS) return false
    _revCheckedAt = now
    if (_revInflight) return _revInflight
    const p = (async () => {
      try {
        const d = await api('/api/auth/perms-rev', { silent401: true })
        const rev = String((d && d.perms_rev) || '')
        if (rev && rev !== permsRev.value) {
          await loadPerms(true)
          return true
        }
      } catch (_) { /* 静默：拉不到就下次再比 */ }
      return false
    })()
    _revInflight = p
    p.then(() => { if (_revInflight === p) _revInflight = null },
           () => { if (_revInflight === p) _revInflight = null })
    return p
  }

  /* v291（2026-09-27）：**清空权限缓存**。登录成功与登出都必须调。
     🔴 为什么必须（这是本轮「按角色收窄菜单」功能的前提）：
        缓存的键只有**租户**（`permsTenant`），不含账号 —— 见上方 state 注释②
        "租户一变就重取"。但**同租户内换账号**时租户没变 ⇒ `loadPerms()` 命中上一个
        账号的缓存 ⇒「菜单按**上一个账号**的权限显示」。老板登出、员工登录，员工会
        看到老板的全套菜单。反过来（员工先登、老板后登）会把老板的菜单砍掉。
        既然本轮的门禁判据读的就是这份权限，拿错权限就等于整个功能失效。
     🔴 为什么用"清缓存"而不是"把缓存键改成 租户+账号"：后者需要 `user.id/username`，
        而 `loadPerms()` 从接口回填的 `d.user` 只落到 role/roles/name（没有 id/username）
        ⇒ 要先改后端返回结构。登录/登出本来就该重置会话内一切派生状态，
        清缓存是等价且改动更小的做法（同时也顺手清掉 caps/plan，避免套餐串味）。 */
  function resetPerms() {
    perms.value = null
    permsTenant.value = ''
    caps.value = null
    plan.value = ''
    user.role = ''
    user.roles = []
    // v296：联动的两件东西同样必须清 —— 否则换账号后 `customRoles` 还是上一个人的租户
    // 那份（决定"内置 roles 要不要让位"），`permsRev` 也是上一个租户的指纹，
    // 会让 `refreshPermsIfChanged()` 认为"没变过"从而永不重拉。串味方式与 perms 同族。
    permsRev.value = ''
    customRoles.value = null
  }

  /** v266 该套餐能力是否可用（如 `bulk_export` / `api`）。未知（未加载/失败）⇒ true。 */
  function canCap(k) {
    const c = caps.value
    if (!c) return true
    return c[k] === true
  }

  /* ---- AI 会话持久化 — localStorage 按会话分组，刷新不丢，可接着聊 ---- */
  const CHAT_KEY = 'hergent_chat_sessions_v1'

  function saveSessions() {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(chat.sessions.slice(0, 30)))
    } catch { /* 超限静默 */ }
  }

  function loadSessions() {
    // ① 本地缓存先渲染，秒开、离线可看
    try {
      const raw = localStorage.getItem(CHAT_KEY)
      const arr = raw ? JSON.parse(raw) : null
      if (Array.isArray(arr)) chat.sessions = arr
    } catch { chat.sessions = [] }
    // ② 无论本地有没有，都向服务端对齐一次 —— 跨设备可见的前提。
    //    旧实现此处是 `if (raw) return`：本机只要存过任何会话（哪怕内容是 []），
    //    就永不再请求服务端，于是"另一台设备看不到历史会话"。(2026-09-11 修)
    loadSessionsFromServer()
  }

  /* 服务端会话同步（第三期 P1-③）：本地优先，服务端兜底 + 双写。
     静默失败，绝不因网络/未登录干扰副驾本地使用。 */
  function syncSessionToServer(s) {
    if (!s || !s.id) return
    try {
      api('/api/ai/sessions', {
        method: 'POST', silent401: true,
        // v320：带上会话归属（空串 = 不属于任何角色）。后端对空串是「保持原值」，
        // 所以旧客户端/本地缓存缺 roleId 时的补推也不会把服务端已记的归属清掉。
        body: { session_id: s.id, title: s.title || '', messages: s.messages || [], role_id: s.roleId || '' }
      }).catch(() => {})
    } catch (_) {}
  }

  /* 时间戳归一：本地存的是 Date.now() 数字，服务端回的是 'YYYY-MM-DD HH:MM:SS' 字符串 */
  function tsNum(v) {
    if (v == null || v === '') return 0
    if (typeof v === 'number') return v
    const n = Date.parse(String(v).replace(' ', 'T'))
    return isNaN(n) ? 0 : n
  }

  /* 拉服务端会话列表并与本地合并：服务端为准，本地独有的（尚未同步成功）保留在后 */
  async function loadSessionsFromServer() {
    chat.sessionsLoading = true
    try {
      const d = await api('/api/ai/sessions', { silent401: true })
      const list = d && d.sessions
      if (!Array.isArray(list)) return
      const local = new Map(chat.sessions.map(s => [s.id, s]))
      const serverIds = new Set(list.map(s => s.session_id))
      const merged = list.map(s => {
        const l = local.get(s.session_id)
        return {
          id: s.session_id,
          title: s.title || (l && l.title) || '(无标题)',
          // 服务端只回标题，全文按需再拉（见 openChatSession）
          messages: (l && Array.isArray(l.messages)) ? l.messages : [],
          updated_at: s.updated_at || (l && l.updated_at) || '',
          // v320：归属以**服务端**为准（本机缓存可能还没有这个字段）
          roleId: s.role_id || (l && l.roleId) || ''
        }
      })
      for (const s of chat.sessions) if (!serverIds.has(s.id)) merged.push(s)
      merged.sort((a, b) => tsNum(b.updated_at) - tsNum(a.updated_at))
      chat.sessions = merged
      // 可靠性补推（2026-09-23）：本地有、服务端没有的会话，趁本次登录态有效补推一次，
      // 修复此前因 401/网络中断漏同步的会话，保证跨设备最终一致。
      for (const s of merged) {
        if (!serverIds.has(s.id) && s.messages && s.messages.length) syncSessionToServer(s)
      }
    } catch (_) {
    } finally {
      chat.sessionsLoading = false
    }
  }

  /* v320：「接着上次聊」的目标 —— 该角色名下**最近**的一条会话。
     🔴 刻意**不存"每个角色的当前会话指针"**：指针是隐式状态，多端之间必然不同步
       （A 端切了角色，B 端还指着旧的）。这里每次**从会话列表现算** ⇒
       每端从同一份（服务端对齐后的）列表算出同一个答案：零新状态、零漂移。
     🔴 归属为空串的会话（存量会话、旧客户端产生）**不属于任何角色** ⇒ 谁都不会"认领"它，
       所以不会出现"点接着聊，结果跳到一段陌生会话"这种最坏情况。 */
  function latestSessionOfRole(rid) {
    if (!rid) return null
    const cands = (chat.sessions || []).filter(s => s && s.roleId === rid)
    if (!cands.length) return null
    return cands.reduce((a, b) => (tsNum(b.updated_at) >= tsNum(a.updated_at) ? b : a))
  }

  /* 退出登录时清掉本地会话缓存：会话按账号存服务端，
     本地若跨账号残留，会让下一个登录的人看到上一个人的对话。 */
  function clearChatCache() {
    try { localStorage.removeItem(CHAT_KEY) } catch (_) {}
    chat.sessions = []
    chat.messages = []
    chat.currentId = ''
    chat.error = ''
  }

  function saveCurrentSession() {
    const msgs = chat.messages.filter(m => m.content)
    if (!msgs.length) return
    // 🔴 v320b 修复（本轮生产探针当场抓到，不是推测）：
    //   **标题必须来自真实对话，不能被"切换角色"分隔标记占用。**
    //   分隔标记的 `content` 非空（"已切换角色 · 以上由「X」，以下由「Y」回答"），
    //   而落盘会被很多东西触发（切标签页 visibilitychange / 开历史 / 关页 / 换会话）。
    //   于是「在**空会话**里先切角色、然后切走标签页」就会产出一条
    //   标题=分隔文本、且**只有分隔标记**的会话 —— 真机上实测到了（历史列表里
    //   多出一条叫「已切换角色 · 以上由「经营副驾」，以下由「会计…」的对话）。
    //   ⇒ 只有分隔标记时**直接不保存**（没有真内容可存，就不该产生会话）。
    //   ⚠️ 已保存的 `s.messages` 仍**保留** isSwitch —— 它是会话的一部分（重开时能看见
    //      "从哪条换了人"），只是不参与标题、也不单独构成一条会话。
    const real = msgs.filter(m => !m.isSwitch)
    if (!real.length) return
    const now = Date.now()
    if (chat.currentId) {
      const s = chat.sessions.find(x => x.id === chat.currentId)
      if (s) {
        s.messages = msgs
        s.updated_at = now
      }
    } else {
      chat.currentId = 's' + now
      chat.sessions.unshift({
        id: chat.currentId,
        title: real[0].content.slice(0, 24) + (real[0].content.length > 24 ? '…' : ''),
        messages: msgs,
        updated_at: now,
        // v320：**新会话记下"谁开的"**（= 创建那一刻的角色）。之后换角色继续聊同一段，
        // 归属**不变** —— 「谁开的算谁的」，比"随最后一次发言的角色漂移"可预期得多。
        // ⚠️ 已有会话走上面的分支，只更新 messages/updated_at，**不动归属**（与后端"只增不减"一致）。
        roleId: chat.currentRole || ''
      })
    }
    saveSessions()
    syncSessionToServer(chat.sessions.find(x => x.id === chat.currentId))
  }

  function newChatSession() {
    saveCurrentSession()
    chat.messages = []
    chat.currentId = ''
    chat.error = ''
  }

  function openChatSession(id) {
    saveCurrentSession()
    const s = chat.sessions.find(x => x.id === id)
    if (!s) return
    chat.currentId = id
    chat.error = ''
    if (s.messages && s.messages.length) {
      chat.messages = s.messages.map(m => ({ ...m }))
    } else {
      // 服务端会话（本地无全文，如换设备）→ 拉完整 messages
      chat.messages = []
      try {
        api(`/api/ai/sessions/${id}`, { silent401: true }).then(d => {
          const msgs = d && d.session && d.session.messages
          if (Array.isArray(msgs)) {
            chat.messages = msgs.map(m => ({ ...m }))
            s.messages = msgs
          }
        }).catch(() => {})
      } catch (_) {}
    }
  }

  function deleteChatSession(id) {
    chat.sessions = chat.sessions.filter(x => x.id !== id)
    if (chat.currentId === id) {
      chat.currentId = ''
      chat.messages = []
    }
    saveSessions()
    try {
      api(`/api/ai/sessions/${id}`, { method: 'DELETE', silent401: true }).catch(() => {})
    } catch (_) {}
  }

  /* ---- AI 团队（角色定位）多租户配置 ---- */
  async function loadAiRoles() {
    try {
      const d = await api('/api/ai/roles')
      const roles = (d && d.roles) || []
      chat.roles = roles
      const saved = localStorage.getItem('hergent_role') || 'copilot'
      const ok = roles.some(r => r.role_id === saved && r.is_active !== 0)
      const first = roles.find(r => r.is_active !== 0)
      chat.currentRole = ok ? saved : (first ? first.role_id : 'copilot')
    } catch (e) {
      chat.roles = []
      chat.currentRole = 'copilot'
    }
  }

  function setAiRole(rid) {
    chat.currentRole = rid
    try { localStorage.setItem('hergent_role', rid) } catch {}
  }

  /* 跨设备/重开保护（2026-09-23）：
     此前只在 AI 完整回复后才落盘；若中途关盖休眠 / 切走 / 关页，进行中的副驾对话只活在内存，
     换设备 / 重开就丢了（用户公司电脑关盖时 AI 正在流式回复，整段对话未落盘，回家看不到）。
     监听 visibilitychange(hidden) + pagehide，页面一隐藏就立即落盘当前对话（含流式进行中）。 */
  if (typeof window !== 'undefined') {
    const _persistOnHide = () => saveCurrentSession()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') _persistOnHide()
    })
    window.addEventListener('pagehide', _persistOnHide)
  }

  return {
    ui, user, demo, chat,
    toast, setTheme,
    perms, permsTenant, loadPerms, canModule, resetPerms,
    permsRev, customRoles, refreshPermsIfChanged,
    plan, caps, canCap,
    loadSessions, loadSessionsFromServer, saveCurrentSession, newChatSession, openChatSession, deleteChatSession,
    clearChatCache,
    loadAiRoles, setAiRole, latestSessionOfRole
  }
})

/* ============================================================
   向后兼容导出（现有调用点无需改动）
   ============================================================ */
export const store = useAppStore(pinia)

// 具名函数导出：委托到单例 store 上的同名 action
export const toast = (...a) => store.toast(...a)
export const setTheme = (...a) => store.setTheme(...a)
export const loadSessions = (...a) => store.loadSessions(...a)
export const saveCurrentSession = (...a) => store.saveCurrentSession(...a)
export const loadSessionsFromServer = (...a) => store.loadSessionsFromServer(...a)
export const latestSessionOfRole = (...a) => store.latestSessionOfRole(...a)
export const newChatSession = (...a) => store.newChatSession(...a)
export const openChatSession = (...a) => store.openChatSession(...a)
export const deleteChatSession = (...a) => store.deleteChatSession(...a)
export const clearChatCache = (...a) => store.clearChatCache(...a)
export const loadAiRoles = (...a) => store.loadAiRoles(...a)
export const setAiRole = (...a) => store.setAiRole(...a)
