<template>
  <!-- ══ 全站唯一弹窗骨架（v691 · 2026-10-26 全量收编 18 个手写弹窗）══════════════
       迁移前状况（v690 审计实测）：全站 18 页各自手写「遮罩 + 卡片 + hd/body/ft」，
       五套圆角（12/14/16/18/radius-lg）、七套层级（60 / 900 / 950 / 961 / 980 / 1000 / token）、
       六套遮罩透明度（.3/.32/.35/.4/.42/.45）、三种垂直偏移（top 44%/45%/50%），
       且 16 页**没有** ESC 关闭 / 焦点陷阱 / 背景滚动锁。

       本组件的分工边界（很重要，别越界）：
         ✅ 负责「骨架」：遮罩层、卡片定位、层级、圆角、阴影、hd/body/ft 三段结构、
            遮罩点击关闭、ESC、Tab 焦点陷阱、打开锁背景滚动、关闭归还焦点。
         ✅ 负责「关闭前的数据保护」：`guardClose` 开启时，用户在弹窗里敲过键盘
            再点关闭（X / ESC / 遮罩任一路径）会先提示一次，第二下才真关。
            见下方 guardClose 的注释 —— 这是收编带来的**唯一行为变化**，必须补齐。
         ✅ 负责「结构语义」：role=dialog / aria-modal / aria-labelledby。
         ❌ 不负责「弹窗里长什么样」：字段布局、标签字号、控件高度、表格密度
            一律留在各页自己的 class 里（通过 *Class 透传保留）。

       为什么用「类名透传」而不是「一把推平」：
         各页 scoped CSS 大量使用 `.xx-modal .xx-field { … }` 这类**后代选择器**，
         直接把外层类名换掉会让这些规则整片失效 —— 表单会瞬间塌掉且界面看不出报错。
         透传原类名 ⇒ 后代选择器照旧命中 ⇒ 迁移是「纯结构替换」，视觉零变化；
         真正的视觉收敛（宽度/内边距/字号）再按各页内容密度逐项决定，不搞一刀切。

       宽度**故意不统一**：小表单 420-460px、标准表单 580px、宽表格 900-960px
         是按内容密度定的，压成同一个数会让宽表格挤成一团、小表单留一大片空白。
         统一的是「由组件 width 参数控制」这个机制，不是「数值一样」。 -->
  <teleport to="body">
    <template v-if="show">
      <transition :name="overlayTransition">
        <div :class="overlayClasses" @click.self="onOverlayClick"></div>
      </transition>
      <transition :name="panelTransition" appear>
        <div ref="panel" :class="panelClasses" :style="cardStyle"
             role="dialog" aria-modal="true" :aria-labelledby="title ? titleId : undefined"
             tabindex="-1">
          <!-- 头部：默认渲染「标题 + 关闭」。`#header` **只替换标题区**，
               右上角关闭按钮始终由组件渲染 —— 否则每个自定义头部的页面都得自己
               再写一个关闭按钮，又回到「18 种写法」的老路。 -->
          <div :class="headerClasses">
            <slot name="header"><b :id="titleId">{{ title }}</b></slot>
            <button v-if="closable" type="button" :class="closeClasses"
                    aria-label="关闭" @click="requestClose">
              <Icon name="close" :size="18" />
            </button>
          </div>

          <!-- `@input` / `@change` 只用来标记「用户真的动过这里」，不做任何数据干预。
               原生事件在 div 上冒泡即可捕获，页面的 v-model 照常工作。 -->
          <div :class="bodyClasses" @input="markTouched" @change="markTouched"><slot /></div>

          <!-- 关闭前一次性确认提示：与 SupplierArchive 的 `.sup-hint` 同一套交互语言，
               位置在正文与底栏之间，不遮挡任何字段、不推动布局（flex-shrink:0）。 -->
          <div v-if="hintVisible" class="ui-modal-guard" role="alert">{{ guardHint }}</div>

          <div v-if="$slots.footer" :class="footerClasses"><slot name="footer" /></div>
        </div>
      </transition>
    </template>
  </teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // 卡片宽度（px）。0 = 用 580px 默认值。
  width: { type: Number, default: 0 },
  /* 各段类名透传：调用方把**原来的** `.xx-modal` / `.xx-overlay` 传进来，
     页面 scoped 的后代选择器（`.xx-modal .xx-field`）才不会失效。
     传了就以传入的为准（不再叠加默认 ui-modal-*，避免两套规则互相抢）。 */
  overlayClass: { type: [String, Array, Object], default: '' },
  panelClass: { type: [String, Array, Object], default: '' },
  headerClass: { type: [String, Array, Object], default: '' },
  bodyClass: { type: [String, Array, Object], default: '' },
  footerClass: { type: [String, Array, Object], default: '' },
  closeClass: { type: [String, Array, Object], default: '' },
  // 点遮罩是否关闭。有未保存改动的弹窗传 false（避免误触丢数据）。
  closeOnOverlay: { type: Boolean, default: true },
  /* ── 关闭前一次性确认（v691）──────────────────────────────────────────────
     背景：全量收编前，20 页里只有 SupplierArchive 自己做了「未保存就再问一次」，
     其余 18 页**连 ESC / 遮罩关闭都没有**。收编后组件统一提供了这些入口，
     等于给 18 个表单页凭空加了一条「一按就关、改动全丢」的路 —— 这是本轮
     唯一真实的行为变化，必须在这里补齐，否则是拿数据安全换一致性。

     为什么不要求各页自己传 isDirty：那等于把 SupplierArchive 那个
     「基线未归一化 ⇒ isDirty 恒真」的 bug 复制 18 遍，且每页字段不同、极易算错。
     改为组件内做**纯 DOM 级脏检测**：打开时把 body 内所有表单控件当前值拍快照，
     之后只要用户在弹窗里真正敲过键盘（input/change 冒泡上来）才算「动过」。
     ⇒ 零页面代码、全站同一口径；纯查看型弹窗（详情/报告/体检）没有控件，
        永远不会被拦。

     为什么默认 false：ProductArchive / SupplierArchive 已有自己的确认流程，
     组件再拦一次会变成「点三次才关」。默认关 = 迁移不改变这两页的既有行为。 */
  guardClose: { type: Boolean, default: false },
  guardHint: { type: String, default: '有未保存的改动 —— 再点一次就关闭，不会保存' },
  // 是否显示右上角关闭按钮
  closable: { type: Boolean, default: true },
  // 动画名，沿用页面原来的 fade / pop，迁移后动画观感不变
  overlayTransition: { type: String, default: 'ui-fade' },
  panelTransition: { type: String, default: 'ui-pop' }
})
const emit = defineEmits(['close'])

const cardStyle = computed(() => (props.width ? { width: props.width + 'px' } : {}))

/* 关闭确认状态：每次打开都从零开始（在下面的 show watch 里重置），
   `confirmed` 只在**本次打开周期内**有效 —— 关掉再开要重新问一次。 */
const touched = ref(false)
const confirmed = ref(false)
const hintVisible = ref(false)
let hintTimer = null

/* 类名解析：传了自定义类 → 用它（不叠默认）；没传 → 用默认 ui-modal-*。
   注意 panel 即使传了自定义类，也仍需要组件提供的「定位 + 层级」基础样式，
   所以传自定义类时加了 `ui-modal-base`（只含 position/transform/z-index 等骨架声明）。 */
const pick = (custom, fallback) => (custom ? ['ui-modal-slotted', fallback, custom] : [fallback])

const overlayClasses = computed(() => pick(props.overlayClass, 'ui-modal-overlay'))
const panelClasses = computed(() => pick(props.panelClass, 'ui-modal-card'))
const headerClasses = computed(() => pick(props.headerClass, 'ui-modal-hd'))
const bodyClasses = computed(() => pick(props.bodyClass, 'ui-modal-body'))
const footerClasses = computed(() => pick(props.footerClass, 'ui-modal-ft'))
const closeClasses = computed(() => pick(props.closeClass, 'ui-modal-close'))

/* 三个关闭入口（X / ESC / 点遮罩）全部走这一个函数 —— 拦截逻辑只此一处，
   避免「X 拦了、ESC 没拦」这种半拉子保护。页面自己调 `show = false` 不受影响
   （那是程序化关闭，不经过 emit），所以「保存成功后自动关闭」不会被拦。 */
function requestClose() {
  if (!props.guardClose) { emit('close'); return }
  if (!touched.value || confirmed.value) { emit('close'); return }
  confirmed.value = true            // 本次打开内只问一次：第二下就真关
  hintVisible.value = true
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hintVisible.value = false }, 6000)
}

/* 「用户动过这里」的判据 = 只有真实 input/change 事件。程序化赋值不触发事件，
   所以「打开弹窗时带出上次的值」「选客户自动填充部门」这类都不算改动。 */
function markTouched() {
  if (!props.guardClose) return
  touched.value = true
}

function onOverlayClick() {
  if (props.closeOnOverlay) requestClose()
}

// 每个实例唯一标题 id，供 aria-labelledby 引用
let seq = 0
const titleId = 'ui-modal-title-' + (++seq)

const panel = ref(null)
let lastFocused = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables() {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null)
}

function onKeydown(e) {
  // Esc 关闭：任何位置都生效（含焦点在弹窗内的输入框里）
  if (e.key === 'Escape') {
    e.preventDefault()
    requestClose()
    return
  }
  // Tab 焦点陷阱：只在弹窗内循环
  if (e.key === 'Tab') {
    const f = focusables()
    if (!f.length) {
      e.preventDefault()
      if (panel.value) panel.value.focus()
      return
    }
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => props.show,
  async (v) => {
    if (v) {
      // 每次打开都从干净状态起算，避免「上次关过所以这次不提醒」
      touched.value = false
      confirmed.value = false
      hintVisible.value = false
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
      lastFocused = document.activeElement
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onKeydown, true)
      await nextTick()
      /* v618：焦点优先给**声明了 `data-autofocus` 的元素**（例如「填天数」这类
         "打开就是要输入"的弹窗），否则才退到第一个可聚焦元素（通常是关闭按钮）。
         为什么不让调用方自己 nextTick().focus()：本 watch 也在 nextTick 之后执行，
         谁后跑谁赢 —— 两边赛跑的结果不稳定（实测调用方先跑、被这里覆盖成关闭按钮）。
         声明式只有一个焦点决策点，全站行为一致；没标 data-autofocus 的弹窗零变化。 */
      const auto = panel.value && panel.value.querySelector('[data-autofocus]')
      if (auto && typeof auto.focus === 'function') {
        auto.focus()
        if (typeof auto.select === 'function') { try { auto.select() } catch (e) { /* 非输入框，忽略 */ } }
      } else {
        const f = focusables()
        if (f.length) f[0].focus()
        else if (panel.value) panel.value.focus()
      }
    } else {
      window.removeEventListener('keydown', onKeydown, true)
      document.body.style.overflow = ''
      hintVisible.value = false
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
      // 关闭后把焦点还给触发元素，避免焦点丢到 body
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus() } catch (e) { /* 触发元素可能已卸载，忽略 */ }
      }
      lastFocused = null
    }
  },
  /* immediate：全局确认宿主（App.vue）是 `v-if + :show="true"` 挂载，挂载时 show 已为 true，
     不 immediate 则焦点陷阱 / ESC / 背景锁**永远不会初始化**（Phase 0 全局 confirm 排查出的坑）。
     对 show=false 挂载的普通用法，immediate 触发一次 else 清理 —— removeEventListener 不存在的
     监听 + overflow='' 都是幂等的，无副作用。 */
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  document.body.style.overflow = ''
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
})
</script>

<style scoped>
/* 🔴 v617：层级必须用**页面级模态 token**（1125 / 1130），不能写 1000/1001。
   成因（v136 已在本仓踩过、这里复发过一次）：工具栏 `.tb-pop` 的常态 z-index 曾是 **1120**
   （为了「弹层开着时能直接点别的触发按钮做互斥切换」而特意抬高的；v678 起已降到 1101），
   而本组件 Teleport 到 body、祖先链不创建 stacking context ⇒ 直接根层比较：
   1120 > 1001，只要按钮矩形与弹窗重叠，品牌/导出/复制报单这些**触发按钮就浮在模态之上**，
   模态正文被压住一截（v617 真机截图：第一行说明文字尾部被「期次 ⌄」盖掉）。
   取值与 `.imp-overlay/.imp-modal`（导入弹窗）、`.al-*`（别名弹窗）保持同一对 token，
   全站模态只有一个层级口径；且 1130 远低于 toast 9999 / 空闲超时 9998。

   v691 补充：迁移前 7 套层级里 **.pc-mask 只有 60**（远低于 .tb-pop 的 1120）、
   cron-overlay 950、cc/dl 961、vc/rs 900 —— 这些页面弹窗打开时工具栏按钮会浮在上面。
   全量迁移后所有弹窗统一走这一对 token，此类层级倒挂一次性消除。 */

/* overlay 与 card 是**兄弟节点**（迁移前各页都是这个结构，照抄不引入变化）。
   fixed 定位不依赖 overlay 做父容器 ⇒ 视觉与「card 在 overlay 内」完全一致。 */
.ui-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:var(--z-page-modal-overlay)}

.ui-modal-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:580px;
  max-width:92vw;max-height:88vh;overflow:hidden;background:var(--bg);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:var(--z-page-modal);
  display:flex;flex-direction:column}

/* 透传模式下的骨架：调用方带了自定义 panelClass 时，仍需要这些声明，
   否则卡片会退回文档流、尺寸和位置全错（页面自己那份 CSS 已被清理掉）。
   🔴 用 `!important` 是刻意的：页面 scoped 规则（.ba-modal 等）与本组件的
      同特异性（class + scope attr），谁生效取决于样式表加载顺序 —— 不可控。
      骨架级声明（定位/层级/圆角/结构）必须由组件独占，故强制。 */
.ui-modal-slotted{position:fixed!important;left:50%!important;top:50%!important;
  transform:translate(-50%,-50%)!important;max-width:92vw;max-height:88vh;overflow:hidden;
  z-index:var(--z-page-modal)!important;display:flex;flex-direction:column;
  background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg)}
/* 遮罩层透传：同样由组件独占定位与层级 */
.ui-modal-slotted.ui-modal-overlay{position:fixed!important;inset:0!important;
  left:0!important;top:0!important;transform:none!important;width:auto!important;
  max-width:none;max-height:none;border-radius:0;box-shadow:none;display:block;
  background:rgba(0,0,0,.4);z-index:var(--z-page-modal-overlay)!important}

.ui-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;
  border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.ui-modal-hd b{font-size:16px;font-weight:600;color:var(--t1)}
.ui-modal-close{border:none;background:none;color:var(--t3);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;
  border-radius:var(--radius-sm);transition:background .15s,color .15s}
.ui-modal-close:hover{background:var(--bg2);color:var(--t1)}
.ui-modal-body{padding:18px 20px;overflow-y:auto}
/* 关闭前确认提示：正文与底栏之间的一条琥珀色横条。
   flex-shrink:0 保证正文再长也不会把它挤没（它出现时正是要拦人的时候）。 */
.ui-modal-guard{padding:9px 20px;background:var(--warn-amber-bg);color:var(--warn-amber);
  font-size:12.5px;line-height:1.5;border-top:1px solid var(--border-subtle);flex-shrink:0}
.ui-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;
  border-top:1px solid var(--border-subtle);flex-shrink:0}

/* 透传模式下 hd/body/ft 只补「三段结构」必需的声明，内边距交回页面自己控制 ——
   宽表格弹窗（900/960px）压不动内边距，一律 18px 会真的把表格挤爆。 */
.ui-modal-slotted.ui-modal-hd{padding:16px 20px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.ui-modal-slotted.ui-modal-body{overflow-y:auto}
.ui-modal-slotted.ui-modal-ft{padding:14px 20px;border-top:1px solid var(--border-subtle);flex-shrink:0}

/* 动画：与各页原有的 `.fade` / `.pop` 同名同参，迁移后观感不变 */
.ui-fade-enter-active,.ui-fade-leave-active{transition:opacity .16s ease}
.ui-fade-enter-from,.ui-fade-leave-to{opacity:0}
.ui-pop-enter-active{transition:opacity .18s ease,transform .18s cubic-bezier(.2,.8,.3,1)}
.ui-pop-leave-active{transition:opacity .12s ease,transform .12s ease}
.ui-pop-enter-from,.ui-pop-leave-to{opacity:0;transform:translate(-50%,-46%) scale(.97)}
</style>
