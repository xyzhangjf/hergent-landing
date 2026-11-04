/* ============================================================================
   useGoPage —— 「带权限闸门的页内跳转」唯一实现（v768，2026-11-04）
   ============================================================================
   由来：v291 起，全站有 11 处把下面这三行**手抄**了一遍：

       if (!canSee(path)) { toast('你没有访问「X」的权限', 'warn'); return }
       router.push(path)

   抄多份的代价已经实际发生，不是理论风险：

     · **文案漂移**：Settings 写「…的权限，请联系管理员」，其余 10 处不写。
       同一句话两种说法，用户以为权限规则不一样。
     · **写法漂移**：10 处用 `router.push`，`Forecast.goConnect` 一处用
       `location.hash = '#/connect'` —— 后者拿不到 Promise，无法统一 catch
       重复导航，且绕过了 router 的导航失败回调。
     · **页名抄死**：v311「能力中心」更名「AI 引擎」时，必须逐个文件改提示文案，
       漏一个就变成"提示用户去找一个已经不存在的菜单"（v766/v767 两批刚清完
       同一族缺陷：指路指向不存在的地方）。

   ⇒ 收敛成一个函数后，上面三条**结构上不可能再发生**。

   ---------------------------------------------------------------------------
   🔴 页名不手写 —— 一律 `pageTitle(path)` 从页面注册表反查
   ---------------------------------------------------------------------------
   这和 `canSee(path)` 不传 role/canModule 是同一个设计（见 pages.js:1013）：
   **调用点少一个参数，就少一个能写错的地方**。注册表里改名，提示自动跟着改。

   实测反查结果与现有手写文案逐个吻合（`/connect` → 「AI 引擎」即 v311 改过的那个）。

   ---------------------------------------------------------------------------
   🔴 为什么不是 `<GoLink>` —— 两者是一对相反的产品决策
   ---------------------------------------------------------------------------
   GoLink 渲染 `<a>`，走路由守卫；守卫对无权限是
   `return { path:'/workbench', query:{ denied } }` ⇒ **把人弹走**。
   而本函数的语义是「**留在原地** + 一句 toast」。

   判据只有一条：**点完人还在不在这一页**。
     · 还在 ⇒ 用 `goPage()`（按钮、弹窗里的动作）
     · 本来就该消失（导航/指路文案）⇒ 用 `<GoLink>`

   合并成一个组件是错的：GoLink 做不到「原地反馈」，本函数做不到
   「右键新标签页打开 / 中键点击 / 可被搜索引擎与无障碍读屏识别为链接」。

   ---------------------------------------------------------------------------
   🔴 本地实例名用 `goNav`，**不要叫 `goPage`**
   ---------------------------------------------------------------------------
   `SupplierArchive` / `CustomerArchive` / `ProductArchive` / 仓储四个列表页里，
   **`goPage(p)` 是分页函数**（"翻到第 p 页"）。若在这里也起名 `goPage`：

       const goPage = useGoPage()          // 新增
       function goPage(p) { ... }          // 原有分页

   同一作用域内 `const` 与 `function` 同名 ⇒ **SyntaxError: Identifier already
   declared**（构建会红，属于运气好的那种）。真正危险的是反过来：新写的
   函数用 `function` 声明、旧的用 `const`，或分处不同块，那就是**静默覆盖** ——
   按钮全变成"翻到 undefined 页"，不报错。

   ⇒ 定名 `goNav`（全库唯一，已 grep 确认 0 处占用），语义上也不易与"翻页"混。

   ---------------------------------------------------------------------------
   用法
   ---------------------------------------------------------------------------
     const goNav = useGoPage()

     goNav('/data-fill')                                   // 最常用
     goNav('/connect', { before: () => { remindOpen.value = false } })
     goNav({ path: '/forecast', query: { tab: 'config' } }, { replace: true })
     goNav(w.path, { label: w.name })   // 后端下发的动态路径：用调用方手里的插件名

   返回 `true` / `false`（是否真的跳了），调用方可据此做后续动作。
   ========================================================================== */
import { useRouter } from 'vue-router'
import { toast } from '../store'
import { canSee, pageTitle } from '../constants/pages'

/**
 * @returns {(target: string | { path: string, query?: object }, opts?: {
 *   replace?: boolean,
 *   before?: () => void,
 *   label?: string,
 * }) => boolean}
 */
export function useGoPage() {
  const router = useRouter()

  return function goPage(target, opts = {}) {
    const isPath = typeof target === 'string'
    /* 🔴 目标形态两种都要吃：字符串 / `{path, query}`。
       只认一种不报错，而是静默跳到 `undefined` —— 那才是最难查的。 */
    const path = isPath ? target : (target && target.path) || ''
    const query = isPath ? null : (target && target.query) || null

    if (!canSee(path)) {
      /* 页名三级回退：调用方显式给的名字 → 注册表反查 → 路径本身。
         🔴 为什么要 `label` 覆盖：少部分入口的目标是**后端下发的动态路径**
            （如连接中心的工作流，`w.path` 来自 `/api/workflows`），未登记在
            页面注册表里。此时 `pageTitle()` 返回空串，硬退回路径会显示
            「你没有访问「/some/plugin/path」的权限」——不如调用方手里的插件名
            （「畅捷通」）易懂。**只在动态路径场景用**，静态路径一律让注册表说话。 */
      const name = opts.label || pageTitle(path) || path
      toast(`你没有访问「${name}」的权限，请联系管理员`, 'warn')
      return false
    }

    /* `before` 在**判据通过之后、跳转之前**执行 —— 与原 11 处手写代码里
       `remindOpen.value = false` 的位置一致（先判权限，没权限时不动 UI 状态）。 */
    if (typeof opts.before === 'function') opts.before()

    const dest = query ? { path, query } : path
    /* 🔴 必须 catch：vue-router 4 对「导航到当前所在路由」会 reject
       （NavigationDuplicated）。不吞掉就是每次点同一个入口在控制台留一条红字，
       而功能其实正常 —— 典型的"看起来像 bug"。 */
    Promise.resolve(opts.replace ? router.replace(dest) : router.push(dest)).catch(() => {})
    return true
  }
}
