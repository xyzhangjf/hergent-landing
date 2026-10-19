import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { pinia, setTheme } from './store'
import { bootstrapTenantContext } from './api/client'
import { initDensity } from './composables/useDensity'
import './styles/variables.css'
import './styles/col-menu.css'   // 列设置齿轮 + 面板 + 列宽拖动手柄（全站表格页复用，v432 / v444）
import './styles/psi-list.css'   // 进销存列表页统一规范：.psi-tbl 固定布局 / .psi-frz-N 冻结列 / .psi-quick 快捷档（三页共用，v496）
import './styles/chart.css'      // 图表外壳 / 图例 / 三态 / tooltip / 排行条（全站图表复用，v491）
import './styles/forecast-modal.css' // 弹窗壳层共享类：.imp-modal / .imp-hd / .imp-x / .imp-body / .imp-tip / .del-actions / .warn-text（v560：forecast 懒加载子组件共用，必须在入口 chunk）

// 恢复主题
setTheme(localStorage.getItem('hergent_theme') === 'dark' ? 'dark' : 'light')

// 启动时清理可能失效的租户 cookie（老会话/演示残留会让所有业务接口 403）
// 🔴 必须先于 initDensity：密度读的是**租户级**偏好，若带着残留 cookie 先发出去，
//    会读到上一个租户的配置（cookie 残留正是这条清理要对付的毛病）。
bootstrapTenantContext()

// 恢复表格密度（v417k）：本地先即时生效，联网后再用云端对齐（失败不影响本机）
initDensity()

const app = createApp(App)

// 全局错误兜底：捕获组件生命周期/渲染之外的未处理异常，避免静默崩溃（P0 评审清单）。
app.config.errorHandler = (err, instance, info) => {
  console.error('[global error]', err, info)
}

/* v589：全局 `v-focus` 指令 —— 元素挂载即聚焦；数字类输入框**同时全选内容**。
   🔴 为什么必须补：模板里 `v-focus` 已用了 10 处（`Forecast.vue` 只读列表双击进编辑、
      `InvPurchaseNew` / `PurchaseOrderForm` / `ProductCombo` 的建单单元格），但**全仓从未注册过这个指令**
      ⇒ Vue 只 warn 一句 `Failed to resolve directive: focus` 然后**全程静默无效**。
      症状（v589 真机实测）：双击数量格变成输入框后，光标停在**末尾**、内容是追加
      （原 10，键入 7 ⇒ 107），用户以为"填错了数"，也说不出哪里不对。
      这正是「以前改过、后来又被回退」的那类静默丢失：指令没了不报错、构建照样过。
   🔴 只对数字框全选：备注/商品关键字这类文本框要的是"接着打字"，全选会把已有内容一次覆盖掉。
      判据取 inputmode 或 type=number 或 .cell-qty/.cell-num（与表格数字格同源）。
   ⚠️ `<select>` 没有 select() ⇒ 只聚焦；focus 不会展开下拉，安全。 */
app.directive('focus', {
  mounted (el, binding) {
    if (!el || !el.focus) return
    try { el.focus({ preventScroll: true }) } catch (e) { try { el.focus() } catch (e2) { /* 忽略 */ } }
    if (binding.value === false || !el.select || el.tagName !== 'INPUT') return
    const t = String(el.getAttribute('type') || 'text').toLowerCase()
    const mode = String(el.getAttribute('inputmode') || '').toLowerCase()
    const numeric = t === 'number' || mode === 'numeric' || mode === 'decimal'
      || el.classList.contains('cell-qty') || el.classList.contains('cell-num')
    if (!numeric) return
    const pick = () => { try { el.select() } catch (e) { /* 某些输入类型会抛 InvalidStateError */ } }
    pick()
    /* 🔴 必须在**本轮事件默认行为之后**再选一次（v589 实测）：
       「双击数量格进编辑」时，这个 input 是 `dblclick` 处理器里渲染出来的，浏览器双击的默认动作
       （选中光标处的词）发生在我们 select() **之后** ⇒ 刚做好的全选被折叠成"光标停在末尾"，
       于是键入 7 变成 107。放到下一轮事件循环补一次即可盖住它。
       ⚠️ 加 isConnected + activeElement 双重判断：元素已被 v-if 撤掉、或用户已把焦点挪走时不许再抢。 */
    setTimeout(() => {
      if (el.isConnected && document.activeElement === el) pick()
    }, 0)
  }
})

/* v591：前端构建号（**唯一定义处**）。用途只有一个 ——
   部署后「页面没变化」时能一眼分清是「代码没生效」还是「浏览器还在跑老包」：
   长期开着的标签页不会重新拉 index.html，看的永远是旧 chunk（v590 就这样被误判成"没修好"）。
   显示在「预报订单管理 → 修改日志」面板标题旁；也可在控制台 `document.documentElement.dataset.build` 查。
   ⚠️ 每次发版必须手动改这一行（没有 CI 注入），漏改会让版本核对失效。 */
window.__HG_BUILD__ = 'v619'
if (typeof document !== 'undefined') document.documentElement.setAttribute('data-build', window.__HG_BUILD__)
console.info('[HG] 前端构建', window.__HG_BUILD__)

app.use(pinia).use(router).mount('#app')
