/* ============================================================================
   tabTitles.js —— 「子页签标题」唯一源（v396，2026-10-08）
   ============================================================================

   用途：全局标签栏（`components/TabBar.vue`）给**同一个 path、不同 `?tab=`** 的
   页面起名字。没有它，`/rebate?tab=achv` 与 `/rebate?tab=rules` 会**同名**
   （都叫「目标与返利」）⇒ 标签栏里两条一模一样的标签，分不清谁是谁。

   ---------------------------------------------------------------------------
   🔴 与 `pages.js::pageTitle(path)` 的分工（**不要**互相抄）
   ---------------------------------------------------------------------------
     · 主标题（按 path）  → `constants/pages.js` 的 `PAGE_RULES[path].title`，
                            经 `pageTitle(path)` 读。**那里是权威，本文件不重复登记。**
     · 子页标题（按 tab） → 本文件。键 = `path`，值 = `{ tabKey: '中文名', _default: '…' }`。

   取标题的唯一入口是 `tabTitle(path, query, metaTitle)` —— **实现在 `composables/useTabs.js`**
   （本文件只供数据，不定义函数）—— 调用方**不要**自己
   先查 `SUB_TITLES` 再回落 `pageTitle`，那样"回落顺序"就会出现第二份实现。

   🔴 `_default` 的含义：该 path **不带 `tab` 参数**时落在哪个子页 ——
       注意它写的是**子页 key**（不是中文名），这样一处定义同时服务三件事：
         · 标签标题回落（`tabTitle('/rebate', {})` → SUB_TITLES['/rebate']['dashboard'] = '仪表盘'）；
         · 标签 key 归一（`/rebate` 与 `/rebate?tab=dashboard` **必须是同一个标签**，
           否则点弹窗「仪表盘」进来会看到两条同名标签）；
         · 侧栏当前项高亮（URL 省略 tab 时，仍要认出停在哪个子页，见 `effTab`）。
       若某 path 没有 `_default` ⇒ 它没有子视图，回落主标题（`pageTitle`）。

   🔴 tabKey 必须与页面里 `?tab=` 的**实际取值逐字一致**（改任一侧都要同步）：
       · `Rebate.vue`        的 `mainTab`   —— dashboard / rules / achv / contracts / settle / promises
       · `LossAccounting.vue` 的 `mainTab`   —— dashboard / fill
       · `Print.vue`         的 `TABS`      —— templates / settings / logs
       · `Forecast.vue`      的 `TAB_KEYS`  —— summary / history / config /
                                             config-auto / config-remind / config-template / target
         ⚠️ v424（2026-10-10）：`config` 由「报单配置」改名为「**报单对象**」——
            报单配置已从一张长页面拆成四个子页（见 `Shell.vue::NAV`「报单配置」分组），
            四页的标题必须**互不相同**，否则标签栏里会并排出现四条「报单配置」，
            分不清谁是谁（本文件存在的理由，见文件头）。`config` 这个 **URL 键不许改**：
            它是旧深链的落点（`ProductTarget` / `EmployeeArchive` 的「去修配置」写死 `?tab=config`）。
       写错的后果是**静默**的：标签只会显示主标题（看着"也能用"），
       直到同 path 开第二个标签才发现两条同名。
   ========================================================================= */

export const SUB_TITLES = {
  '/rebate': {
    _default: 'dashboard',
    dashboard: '仪表盘',
    rules: '目标配置',
    achv: '达成填报',
    contracts: '返利结算',
    settle: '结算节奏',
    promises: '厂家承诺'
  },
  '/loss-accounting': {
    _default: 'dashboard',
    dashboard: '货损核算',
    fill: '货损填报'
  },
  '/print': {
    _default: 'templates',
    templates: '打印模板',
    settings: '打印设置',
    logs: '打印记录'
  },
  '/forecast': {
    _default: 'summary',
    summary: '本期预报',
    history: '历史期次',
    // v424：「报单配置」拆成四页后，四个标题必须互不相同（原 `config` 叫「报单配置」）
    config: '报单对象',
    'config-auto': '报单自动化',
    'config-remind': '报单提醒设置',
    'config-template': '模板参数',
    target: '商品目标'
  },
  /* v427（2026-10-10）：「AI 引擎」/「设置」由单入口拆成独立子页（与 v424 同构）。
     v428（2026-10-10）：「连接器」再拆成 连接手机/配对审批/业务数据源 三个子页（从「AI 能力」组挪出新建「连接与集成」组）。
     v429（2026-10-10）：「业务数据源」再拆成 ERP 数据源/数据台账/MCP 连接 三个子页（沿用 v427/v428 同构）。
     tabKey 必须逐字对齐 `ConnectCenter.vue::CONNECT_TABS` 与 `Settings.vue::SETTINGS_TABS`，
     以及 `Shell.vue::NAV` 里各条目的 `tab`。四套取值任一改了都要同步。 */
  '/connect': {
    _default: 'im',
    im: '连接手机',
    pairing: '配对审批',
    erp: 'ERP 数据源',
    datasource: '数据台账',
    mcp: 'MCP 连接',
    expert: 'AI 团队',
    skill: '技能库',
    evolution: '进化日志',
    output: '产出与用量'
  },
  '/settings': {
    _default: 'account',
    account: '账号与组织',
    perm: '权限管理',
    ai: 'AI 配置',
    aiops: 'AI 运维',
    system: '数据与系统'
  }
}

/** path → 默认子页 key（只从上面的 `_default` 派生，不再手抄第二份名单）。 */
export const DEFAULT_SUB_KEY = Object.keys(SUB_TITLES).reduce(function (m, p) {
  const d = SUB_TITLES[p]._default
  if (d) m[p] = d
  return m
}, {})

/**
 * 「**有效 tab**」—— 把 URL 省略的默认 tab 补全后再比较。
 *
 * 🔴 为什么必须有它：`/rebate`（无 tab）实际渲染的就是仪表盘，而侧栏「仪表盘」那条的
 *    `to` 是 `/rebate?tab=dashboard`。若高亮直接拿 `''` 和 `'dashboard'` 比 ⇒
 *    **两条都不亮**（用户站在仪表盘上，侧栏却不告诉他"你在这")。
 *    同理标签 key 也要归一，否则同一个页面会开出两个标签。
 * ⚠️ 没有子页的 path（绝大多数）两边都返回 `''` ⇒ 退化成原行为，不受影响。
 */
export function effTab(path, tab) {
  const t = String(tab || '')
  if (t) return t
  return DEFAULT_SUB_KEY[path] || ''
}

/** 该 path 是不是「有子页签的页」（用于探针与文档自证，不参与渲染判据）。 */
export function hasSubTabs(path) {
  return !!SUB_TITLES[path]
}
