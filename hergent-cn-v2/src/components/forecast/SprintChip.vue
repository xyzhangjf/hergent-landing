<script setup>
/* ---- v585：页脚「返利冲刺胶囊」+ 悬停展开完整看板 ----
   诉求（用户原话）：全屏状态下也要能方便看到冲刺面板，实时根据达成情况调整预报订单。

   🔴 为什么是「胶囊常显数字 + 悬停出面板」，而不是纯图标
     · 用户真正需要实时盯的是 3 个数：几个品牌未达标 / 总缺口 / 均单需报多少；
     · 数字只有**常显**才叫实时；收进图标里就变成"想起来了去查一下"，缺口变大时不会有人注意到；
     · 悬停零点击成本，需要品牌明细时鼠标一停就出，不打断改单。

   🔴 数据只有一份：本组件**自己不算任何数字**，全部来自 RebateSprint 通过 `summary` 事件回传的
     同一批 computed（unmetSprintCount / sprintTotalGap / rebateSprintOrders / sprintTotalGapPerOrder）。
     父级页脚的胶囊与页面顶部卡片因此不可能对不上（v183「同一行数与色不得互相矛盾」同族纪律）。
     编辑态改数量 → cross.rows 行对象原地变 → 看板 computed 重算 → emit → 胶囊同一帧更新。

   🔴 门面元素全在 page 的 flex 流里（v584 教训）：本胶囊挂在 `.pin` / `.edit-summary` 内部，
     这两个容器已在 `.grid-area` 内 ⇒ 全屏层 fixed 遮不住它，无需任何全屏专属分支。

   ⚠️ 浮层必须 Teleport 到 body + position:fixed：页脚在长页面底部，若锚在自身容器上，
     祖先一旦出现 overflow:hidden（v582 合计栏就踩过）整块浮层会被裁掉。 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { fmt } from '../../utils/forecast/format.js'
import Icon from '../Icon.vue'

/* 与父级 Forecast.vue 用的是同一个模块 ⇒ 浏览器只加载一次该 chunk，不会重复下载。
   （父级已 defineAsyncComponent 过它；这里再声明一次不会产生第二份代码，只多一个加载器。） */
const RebateSprint = defineAsyncComponent(() => import('./RebateSprint.vue'))

const props = defineProps({
  summary:  { type: Object,  default: null },
  period:   { type: Object,  default: null },
  rows:     { type: Array,   default: () => [] },
  editMode: { type: Boolean, default: false },
  prodMeta: { type: Object,  default: () => ({}) },
})

const chipRef = ref(null)
const popRef = ref(null)
const open = ref(false)
const everOpened = ref(false)   // 首次悬停才挂载看板 ⇒ 不拖慢进入全屏；之后只切显隐，不重拉数据
const popStyle = ref({})
let openTimer = null
let closeTimer = null

const s = computed(() => props.summary || {})
const hasErr = computed(() => !!s.value.err)
const ruleCount = computed(() => Number(s.value.rules) || 0)
const unmet = computed(() => Number(s.value.unmet) || 0)
const gap = computed(() => Number(s.value.totalGap) || 0)
const orders = computed(() => Number(s.value.orders) || 0)
const perOrder = computed(() => Number(s.value.perOrder) || 0)
/* v587：汇总单位随规则口径走。quantity = 件数；mixed = 一条按金额一条按件，
   两个数相加在任何单位下都不成立 ⇒ 胶囊不打印数额（否则会出现「缺口 ¥X」却是元+件）。 */
const unit = computed(() => s.value.unit || 'amount')
const mixedUnit = computed(() => unit.value === 'mixed')
const uTxt = (v) => unit.value === 'quantity' ? `${fmt(v)} 件` : `¥${fmt(v)}`
const allDone = computed(() => unmet.value === 0)

/* 显示条件：有目标规则才显示；取数失败（403 等）时**也要显示** —— 那正是最该让人看见的状态，
   否则页脚一片空白，用户会以为"本来就没有目标"。 */
const show = computed(() => !!s.value && (hasErr.value || ruleCount.value > 0))

function place () {
  const el = chipRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  const maxH = Math.min(Math.round(vh * 0.62), 560)
  /* 页脚通常在视口底部 ⇒ 向上弹；只有页脚跑到视口上半部（页面很短/未滚动）才改为向下弹，
     避免浮层顶出屏幕。maxH 与实际 CSS max-height 同源，判定才准。 */
  const up = r.top > maxH + 16
  popStyle.value = up
    ? { right: '12px', bottom: (vh - r.top + 6) + 'px', maxHeight: maxH + 'px' }
    : { right: '12px', top: (r.bottom + 6) + 'px', maxHeight: maxH + 'px' }
}

function cancelClose () { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null } }
function doOpen () {
  cancelClose()
  if (open.value) return
  everOpened.value = true
  open.value = true
  nextTick(place)
}
function enter () {
  cancelClose()
  if (openTimer) clearTimeout(openTimer)
  /* 120ms：划过时不至于"路过就弹"，比 v583 问号（无延迟）稍稳，因为浮层面积大得多。 */
  openTimer = setTimeout(doOpen, 120)
}
function leave () {
  if (openTimer) { clearTimeout(openTimer); openTimer = null }
  cancelClose()
  /* 260ms：胶囊与浮层之间隔 6px，鼠标跨空隙时取消计时即可移进去滚动/复制文字。 */
  closeTimer = setTimeout(() => { open.value = false }, 260)
}
function toggle () {
  /* 🔴 点击只负责"打开"，不做 toggle。
     桌面端悬停已经展开，若点击=收起，用户点一下就会把它关掉，而鼠标还停在胶囊上、
     不会重新触发 mouseenter ⇒ 看上去像"点坏了"，只能移开再回来。
     触摸屏没有 hover，点一下打开即可；关闭靠「点页面别处」（onDocClick）或 Esc。 */
  if (!open.value) doOpen()
}
function onDocClick (e) {
  if (!open.value) return
  const t = e.target
  if (chipRef.value && chipRef.value.contains(t)) return
  if (popRef.value && popRef.value.contains(t)) return
  open.value = false
}
function onEsc (e) { if (e.key === 'Escape') { cancelClose(); open.value = false } }

function onViewportChange () { if (open.value) place() }

watch(open, (v) => { if (v) nextTick(place) })
watch(() => props.period, () => { open.value = false })

onMounted(() => {
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
  document.addEventListener('keydown', onEsc)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
  document.removeEventListener('keydown', onEsc)
  document.removeEventListener('click', onDocClick)
  if (openTimer) clearTimeout(openTimer)
  if (closeTimer) clearTimeout(closeTimer)
})
</script>

<template>
  <span
    v-if="show"
    ref="chipRef"
    class="sprint-chip"
    :class="{ on: open, warn: !hasErr && unmet > 0, ok: !hasErr && allDone, err: hasErr }"
    role="button"
    tabindex="0"
    :aria-expanded="open"
    :aria-label="hasErr ? '返利冲刺：数据未读取，悬停查看原因' : '返利冲刺：悬停查看完整看板'"
    @mouseenter="enter"
    @mouseleave="leave"
    @focus="doOpen"
    @click="toggle"
    @keydown.enter.prevent="toggle"
  >
    <Icon name="target" :size="13" />
    <template v-if="hasErr">
      <span class="sc-txt">冲刺 · <b>返利数据未读取</b></span>
    </template>
    <template v-else-if="allDone">
      <span class="sc-txt"><b>{{ ruleCount }}</b> 个品牌目标<span class="sc-ok">全部达成</span></span>
    </template>
    <template v-else>
      <span class="sc-txt">冲刺 <b>{{ unmet }}</b> 个品牌未达标</span>
      <!-- v587：口径混用（元 / 件）时不给合计，避免把两种单位加在一起还标 ¥ -->
      <template v-if="mixedUnit">
        <span class="sc-sep">·</span>
        <span class="sc-txt">目标口径混用</span>
      </template>
      <template v-else>
        <span class="sc-sep">·</span>
        <span class="sc-txt">缺口 <b>{{ uTxt(gap) }}</b></span>
        <template v-if="orders > 0">
          <span class="sc-sep">·</span>
          <span class="sc-txt">均单 <b>{{ uTxt(perOrder) }}</b></span>
        </template>
        <template v-else>
          <span class="sc-sep">·</span>
          <span class="sc-txt">到货窗口已结束</span>
        </template>
      </template>
    </template>
    <span class="sc-caret" aria-hidden="true"></span>
  </span>

  <Teleport to="body">
    <div
      v-if="open && everOpened && period"
      ref="popRef"
      class="sprint-pop"
      :style="popStyle"
      @mouseenter="cancelClose"
      @mouseleave="leave"
      @click.stop
    >
      <RebateSprint
        :period="period"
        :rows="rows"
        :edit-mode="editMode"
        :prod-meta="prodMeta"
        variant="bare"
      />
    </div>
  </Teleport>
</template>

<style scoped>
/* 胶囊本体质感：与页脚其它文字同基线、圆角全圆、静息描边淡、悬停才上品牌色。
   尺寸刻意压到 20px 行高 —— 页脚是 21px 行，胶囊不得把它顶高（v575 行高纪律）。 */
.sprint-chip{
  display:inline-flex;align-items:center;gap:5px;
  height:20px;padding:0 9px;
  border:1px solid var(--bd);border-radius:999px;
  background:var(--bg2);color:var(--t2);
  font-size:12px;line-height:18px;white-space:nowrap;
  cursor:pointer;user-select:none;
  transition:background .15s ease,border-color .15s ease,color .15s ease;
}
.sprint-chip:hover,
.sprint-chip.on{border-color:var(--p);background:var(--p-bg);color:var(--t1)}
.sprint-chip:focus-visible{outline:2px solid var(--p);outline-offset:1px}
.sprint-chip .sc-txt{display:inline-flex;align-items:center;gap:3px}
.sprint-chip b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--t1)}
.sprint-chip.warn b{color:var(--war)}
.sprint-chip.ok b{color:var(--suc)}
.sprint-chip.err{border-color:var(--war)}
.sprint-chip.err b{color:var(--war)}
.sc-ok{color:var(--suc)}
.sc-sep{color:var(--t3)}
/* 小三角指示"可展开"：用 CSS 画，不走 Icon（避免图库里没有该名字静默兜底成齿轮，v453/v557 教训） */
.sc-caret{
  width:0;height:0;margin-left:1px;
  border-left:3.5px solid transparent;border-right:3.5px solid transparent;
  border-bottom:4px solid currentColor;opacity:.5;
  transition:transform .15s ease,opacity .15s ease;
}
.sprint-chip:hover .sc-caret{opacity:.85}
.sprint-chip.on .sc-caret{transform:rotate(180deg)}

/* 浮层：fixed + Teleport（页脚祖先一旦 overflow:hidden 也不会裁它）。
   z-index 1250 > --z-page-fs(1000) ⇒ 全屏层里同样浮在最上面；仍低于模态遮罩类，不会盖住确认框。 */
.sprint-pop{
  position:fixed;z-index:1250;right:12px;
  width:min(1080px,calc(100vw - 24px));
  overflow:auto;overscroll-behavior:contain;
  padding:12px 14px;
  background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius);
  box-shadow:0 12px 32px rgba(15,23,42,.16);
}
</style>
