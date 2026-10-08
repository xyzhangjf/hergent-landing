/* ============================================================================
   useTabs.js —— 全局「打开过的页面」标签栏状态（v396，2026-10-08）
   ============================================================================

   需求原话（老板）：「点击弹窗中的单个字段，只打开该字段对应的**一个**导航标签及其
   对应页面，不展示其他模块标签」—— 对齐舟谱（截图库 `/Users/zhangjunfeng/Documents/舟谱截图/`，
   实证见 memory `topics/competitor-zhoupudata.md §6`）。

   ---------------------------------------------------------------------------
   🔴 两种语义必须分清（本轮改造的全部理由）
   ---------------------------------------------------------------------------
     · 模块内固定页签（**旧**）= 「**这个模块有哪些页**」
         ⇒ 点任何一个条目进来，都会看到整组页签（老板说的"错误行为"）。
     · 打开历史标签栏（**新**）= 「**我打开过哪些页**」
         ⇒ 点一个开一个、累积、每个可单独关、关到 0 个就是空态。

   本轮把后者立起来，并把前者的 **5 处**退役（进销存容器 / 档案管理 / 打印 /
   目标与返利 / 货损核算）。保留的是**表单内分区**页签（如商品档案编辑弹窗的
   「基本信息 / 包装单位 / 价格 / 库存效期」）—— 那不是模块导航，是同一张表单的几块。

   ---------------------------------------------------------------------------
   老板拍板（2026-10-08，Q1–Q6）
   ---------------------------------------------------------------------------
     Q1 **A** 刷新按钮放名称**左侧**（舟谱那个圆环图标确认就是刷新）
     Q2 **B** 关掉最后一个标签 ⇒ **回首页**（等于又开一个「经营工作台」）
     Q3 **A** 模块内页签**退役**
     Q4 **A** 刷新浏览器后**只还原当前那一个** ⇒ **内存态，不落 localStorage**
     Q5 **B** 放不下时收进「更多」下拉；**上限 18 个**，超出淘汰**最久未激活**的
     Q6 **A** 手机端维持现状（`≤768px` 不出标签栏）

   ---------------------------------------------------------------------------
   🔴 状态为什么是「模块级单例」而不是 `provide/inject`
   ---------------------------------------------------------------------------
   `Shell.vue`（渲染标签栏 + 决定导航）与 `TabBar.vue`（渲染条目）都要读写它。
   本仓既有范式是薄 composable（`useNotiPrefs` / `useMonthlyAchv`），照此办理：
   模块级 `ref` ⇒ 两个组件 import 同一份，不存在"两份状态各自漂移"。
   ⚠️ 单例是**会话内存**，刷新页面即清零（Q4 A 要的正是这个）。
   ========================================================================= */

import { ref } from 'vue'

/** 上限（Q5：18）。超出淘汰最久未激活的那一个。 */
export const MAX_TABS = 18

/** 打开顺序 + 激活时钟。`at` 单调递增 ⇒ 淘汰时取最小的（= 最久没被激活）。 */
const tabs = ref([])          // [{ key, path, query, title, at }]
const activeKey = ref('')
let _clock = 0

/* ---------------------------------------------------------------------------
   哪些 query 算「页面身份」
   ---------------------------------------------------------------------------
   🔴 只认得**页面状态**参数；**必须**排除下面这些"路过"的参数 ——
      它们会让同一个页面算出两个不同的 key ⇒ 标签栏里冒出重复标签：
        · `__r`    —— 只读探针强制新文档用的时间戳（每次都不同）
        · `denied` —— 路由守卫被拒后挂的提示位（`Shell.vue` 会立刻清掉它）
        · `edit_rule` —— 「改节奏」深链的一次性编辑指令（Rebate 用，消费即失效）
   --------------------------------------------------------------------------- */
const EPHEMERAL = ['__r', 'denied', 'edit_rule']

function cleanQuery(query) {
  const out = {}
  const q = query || {}
  for (const k of Object.keys(q)) {
    if (EPHEMERAL.indexOf(k) >= 0) continue
    const v = q[k]
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

/** 稳定化的 key：query 按**键名排序**后拼接 —— 参数顺序不同不应产生两个标签。 */
export function tabKey(path, query) {
  const q = cleanQuery(query)
  const ks = Object.keys(q).sort()
  if (!ks.length) return path
  return path + '?' + ks.map(function (k) { return k + '=' + q[k] }).join('&')
}

/* 子页标题：唯一源 = `constants/tabTitles.js`（主标题唯一源仍是 `pages.js::pageTitle`）。
   这里**只做一次回落**，绝不把回落逻辑散到调用点（那会变成第二份实现）。 */
import { SUB_TITLES, DEFAULT_SUB_KEY } from '../constants/tabTitles'
import { PAGE_RULES, pageTitle } from '../constants/pages'

export function tabTitle(path, query, metaTitle) {
  const t = String((query && query.tab) || '')
  const map = SUB_TITLES[path]
  if (map) {
    if (t && map[t]) return map[t]
    /* `_default` 存的是**子页 key**（见 tabTitles.js 头），所以这里要再查一次表，
       而不是直接拿它当标题 —— 否则标签会显示成 'dashboard' 这种英文枚举。 */
    const d = map._default
    if (d && map[d]) return map[d]
  }
  /* 🔴 必须用 `PAGE_RULES[path]` **精确**命中，不能直接 `pageTitle(path)`：
     `pageTitle` 走 `ruleFor`（**逐级去尾**），对 `/inventory/purchase` 会继承到
     `/inventory` 的「进销存」—— 于是「采购单 / 销售单 / 库存查询」三个标签**同名**，
     标签栏就失去了"我在哪一页"的意义（真机探针 P10 就是这么抓出来的）。
     这些子页的准确名字在路由 `meta.title` 里（`router/index.js` 逐条写了）⇒ 用它。
     ⚠️ 反过来，`/archive/products` 在 `PAGE_RULES` 里**有**精确行（「商品档案」），
        而它的 `meta.title` 只是笼统的「档案管理」⇒ 精确行必须**优先**于 meta。 */
  const exact = PAGE_RULES[path]
  if (exact && exact.title) return exact.title
  return metaTitle || pageTitle(path) || path
}

/* ---------------------------------------------------------------------------
   打开 / 激活
   ---------------------------------------------------------------------------
   由 `Shell.vue` 的 `watch(route.fullPath)` 驱动 —— **路由是唯一真相**：
   只要 URL 变了就确保有对应标签；标签点了就走 `router.push`，
   不在本文件里碰 router（导航决策留在 Shell，这里只维护数据）。
   --------------------------------------------------------------------------- */
export function openTab(route) {
  if (!route || !route.path) return null
  const path = route.path
  /* 登录页不是"打开过的页"；根路径会被 redirect 掉，不该留痕。 */
  if (path === '/login' || path === '/') return null

  const query = cleanQuery(route.query)
  /* 🔴 归一：URL 省略了 `?tab=` 时补上**默认子页** ——
     否则 `/rebate` 与 `/rebate?tab=dashboard` 会算出两个 key，
     表现为"点弹窗『仪表盘』进来，标签栏里出现两条一模一样的『仪表盘』"。 */
  const def = DEFAULT_SUB_KEY[path]
  if (def && !query.tab) query.tab = def
  const key = tabKey(path, query)
  let t = tabs.value.find(function (x) { return x.key === key })
  if (t) {
    t.at = ++_clock                     // 已存在 ⇒ 只更新"最近激活时间"
    t.title = tabTitle(path, query, route.meta && route.meta.title)   // 标题保持新鲜（常量可能被改）
  } else {
    t = { key: key, path: path, query: query, title: tabTitle(path, query, route.meta && route.meta.title), at: ++_clock }
    tabs.value.push(t)
    activeKey.value = key               // ⚠️ 先激活再淘汰：淘汰规则要保护当前标签
    if (tabs.value.length > MAX_TABS) evictOldest()
  }
  activeKey.value = key
  return t
}

/** 淘汰最久未激活的一个（**永不淘汰当前**）。 */
function evictOldest() {
  let idx = -1
  let min = Infinity
  tabs.value.forEach(function (t, i) {
    if (t.key === activeKey.value) return
    if (t.at < min) { min = t.at; idx = i }
  })
  if (idx >= 0) tabs.value.splice(idx, 1)
}

/* ---------------------------------------------------------------------------
   关闭
   ---------------------------------------------------------------------------
   返回 `{ removed, wasActive, next }`：
     · `next` 有值 ⇒ 调用方 `router.push` 到它；
     · `next` 为 null 且 `wasActive` ⇒ 全关完了 ⇒ 调用方回首页（Q2 B）。
   🔴 关**非当前**标签时返回的 `next` 是 null —— 调用方据此**不要**导航
      （否则点一下别的标签的 ×，人就被踢走了）。
   --------------------------------------------------------------------------- */
export function closeTab(key) {
  const i = tabs.value.findIndex(function (t) { return t.key === key })
  if (i < 0) return { removed: false, wasActive: false, next: null }
  const wasActive = activeKey.value === key
  tabs.value.splice(i, 1)
  if (!wasActive) return { removed: true, wasActive: false, next: null }
  /* 右邻优先、其次左邻（与浏览器标签一致：关掉中间那个，看右边那个）。 */
  const next = tabs.value[i] || tabs.value[i - 1] || null
  activeKey.value = next ? next.key : ''
  return { removed: true, wasActive: true, next: next }
}

/** 登出 / 切换租户时清空（`Shell.vue::doLogout` 调用）。 */
export function resetTabs() {
  tabs.value = []
  activeKey.value = ''
  _clock = 0
}

export function useTabs() {
  return {
    tabs: tabs,
    activeKey: activeKey,
    MAX_TABS: MAX_TABS,
    openTab: openTab,
    closeTab: closeTab,
    resetTabs: resetTabs
  }
}
