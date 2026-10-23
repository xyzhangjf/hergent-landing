<script setup>
/* v629：工具栏「冲刺看板」按钮 —— 点击从按钮下方**水平居中**向下展开看板浮层。
   诉求（用户原话）：「在改单按钮前面做一个冲刺看板按钮，点击后看板从上往下居中展开，
   这样用户就不用翻到页脚才能看到看板；页脚那份也保留，用于全屏模式下查看」。

   🔴 数据源纪律（与 SprintChip 完全一致）：**本组件自己不算任何数字**。
     浮层里挂的是同一个 `RebateSprint.vue`（variant="bare"）独立实例，与页脚胶囊悬停时
     用的是同一份模板与同一批 computed ⇒ 两边不可能出现两个不同的缺口
     （v183「同一行数与色不得互相矛盾」同族纪律）。
     ⚠️ 别把 Forecast.vue 里那个 `.sprint-src` 隐藏实例搬到这里来：那份是**页脚胶囊的唯一数据源**
     （v628 注释：删了胶囊立刻归零、且不报错），它必须常挂，不能随浮层开关。

   🔴 为什么"两态只在查看态渲染"（父级 v-if 负责，不在本组件判）：
     编辑态工具栏第一行比查看态多一个「工具箱」（实测 89px），加本按钮会把第一行顶折
     （记忆 v619 判据：查看态单行 62 / 编辑态正常两行 100 / 多折一行 138）；
     且编辑态页脚胶囊就在表格正下方（鼠标不用滚动）⇒ 改单时看缺口走页脚，成本本来就近。

   ⚠️ 浮层必须 Teleport 到 body + position:fixed：祖先一旦 overflow:hidden 就会把面板裁掉
     （v582 合计栏踩过同一坑）。
   ⚠️ 本组件模板是 Fragment（button + Teleport）⇒ 必须 inheritAttrs:false + 根节点 v-bind="$attrs"，
     否则父级写的 class **永远不会出现在 DOM 里**（v620 教训：`.pin>.pin-sprint` 空选择器 5 版零报错）。 */
import { ref, watch, nextTick, onMounted, onBeforeUnmount, defineAsyncComponent, inject, computed } from 'vue'
import Icon from '../Icon.vue'
/* v629：与页脚胶囊共用同一条「有没有冲刺数据」判据，两边不许各写一遍。 */
import { sprintHasData } from '../../utils/forecast/sprint.js'

/* 与 SprintChip / 父级 Forecast.vue 用的是同一个模块 ⇒ 浏览器只加载一次该 chunk，
   不会重复下载（三处 defineAsyncComponent 共用一份代码，只多一个加载器）。 */
const RebateSprint = defineAsyncComponent(() => import('./RebateSprint.vue'))

defineOptions({ inheritAttrs: false })

const props = defineProps({
  period:   { type: Object,  default: null },
  rows:     { type: Array,   default: () => [] },
  editMode: { type: Boolean, default: false },
  prodMeta: { type: Object,  default: () => ({}) },
})

/* 🔴 v655：按钮是否显示改由本组件自己 inject sprintSummary 后判（原由父级
   `sprintVisible` 控制）。这样父模板不再订阅 sprintSummary，改格不会触发父重渲染。
   单一数据源纪律不变：summary 仍来自 RebateSprint 的 emit，经父级 provide 注入。 */
const sprintSummary = inject('sprintSummary', ref(null))
const show = computed(() => sprintHasData(sprintSummary && sprintSummary.value))

const btnRef = ref(null)
const popRef = ref(null)
const open = ref(false)
const everOpened = ref(false)   // 首次点击才挂看板 ⇒ 不拖慢进页面；之后只切显隐，不重拉数据
const popStyle = ref({})

/* 浮层高度上限：从按钮下沿往下铺，底部留 22px；矮屏保底 240px（否则 Inhalt 压成一条看不见）。
   v588：水平**居中**（left:50% + translateX(-50%)）—— 与页脚胶囊浮层同一口径，
   两处打开时位置在同一个横向居中轴上，视觉上是"同一个面板从上面/下面出来"。 */
function place () {
  const el = btnRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  const maxH = Math.max(240, Math.min(Math.round(vh * 0.72), vh - r.bottom - 22))
  popStyle.value = { top: (r.bottom + 6) + 'px', maxHeight: maxH + 'px' }
}

function doOpen () {
  everOpened.value = true
  open.value = true
  nextTick(place)
}
function toggle () { open.value ? close() : doOpen() }
function close () { open.value = false }

function onDocClick (e) {
  if (!open.value) return
  const t = e.target
  if (btnRef.value && btnRef.value.contains(t)) return
  if (popRef.value && popRef.value.contains(t)) return
  close()
}
function onEsc (e) { if (e.key === 'Escape') close() }
/* 滚动/改窗口时跟随按钮重定位；按钮本体被滚出视口顶部（r.bottom < 56）就收起 ——
   否则会出现"面板挂在屏幕中间、触发它的按钮已经看不见"的孤儿浮层。 */
function onViewportChange () {
  if (!open.value) return
  const el = btnRef.value
  if (!el) return close()
  const r = el.getBoundingClientRect()
  if (r.bottom < 56) return close()
  place()
}

watch(open, (v) => { if (v) nextTick(place) })
/* 换期次 ⇒ 旧期次的达成数字不再成立，收起避免读到过期结论。 */
watch(() => props.period, () => close())

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
})
</script>

<template>
  <template v-if="show">
    <button
      ref="btnRef"
      v-bind="$attrs"
      class="btn btn-sm btn-ghost sb-btn"
      :class="{ on: open }"
      :disabled="!period"
      aria-label="冲刺看板"
      :aria-expanded="open"
      title="冲刺看板：各品牌返利目标达成率、还差多少、每次到货建议报多少（点击展开，Esc 或点别处收起）"
      @click="toggle"
    >
      <Icon name="target" />
      <span class="tb-board-txt">冲刺看板</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open && everOpened"
        ref="popRef"
        class="sb-pop"
        :style="popStyle"
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
</template>

<style scoped>
/* 按钮本体吃 .btn/.btn-sm 的既有规格（32 高 / 13 字 / 1px 边 / radius 8 / padding 0 12px）
   ⇒ 与同行「修改日志」「改单」天然同构（v599 判据：顶边差 0、高度差 0），这里只加选中态着色。 */
.sb-btn.on{border-color:var(--p);background:var(--p-bg);color:var(--t1)}

/* 🔴 v629 实测容量（注入真实 .btn.btn-sm 克隆件到 .tb-act，量 .toolbar 是否从 62 变 100/102）：
      按钮实宽 100px（含 target 图标 16 + gap 6 + 4 个 13px 汉字）；
      可用余量 1600→154 / 1366→150 / 1440→90 / 1512→66 / 1280→64。
    ⇒ 只有 ≥1540 和 1366 那一段放得下；1440、1512、1280 会把它顶折。
   为什么 1366 反而比 1440 宽 60px：1366 档早已启用「藏两条 .tb-sep + gap 收 5 + 期次选择器收 150」
   这套省 ~80px 的套餐（见 Forecast.vue 的 @media(max-width:1369px)），释放的空间超过屏宽本身少掉的。
   所以下面是三个**非单调**断点，不是随手写的：窄一档（1440）要藏文字，再窄一档（1366）反而能显示。
   宁可这样写，也不要为了让规则看起来"单调"而去动 .sel-period —— 期次名被截是用户能看见的回归。 */
@media(max-width:1539px){ .tb-board-txt{display:none} }
@media(max-width:1369px){ .tb-board-txt{display:inline} }
@media(max-width:1339px){ .tb-board-txt{display:none} }

/* 浮层：fixed + Teleport。
   z-index 1250 —— **与页脚胶囊浮层 .sprint-pop 同值**：同一个面板从两个入口出来必须在同一层，
   否则会出现"从页脚开的能盖住它、从工具栏开的被它盖住"的怪现象。
   1250 > --z-page-fs(1000) ⇒ 全屏层里也能浮在最上；
   ⚠️ 它同时高于 --z-page-modal(1130)（不是低于），所以本浮层打开时若弹确认框，按钮/面板会在模态之上。
   实际不会同时出现：点页面别处会先收起本浮层，且模态遮罩挡住按钮。 */
.sb-pop{
  position:fixed;z-index:1250;
  left:50%;transform:translateX(-50%);
  width:min(1080px,calc(100vw - 24px));
  overflow:auto;overscroll-behavior:contain;
  padding:12px 14px;
  background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius);
  box-shadow:0 12px 32px rgba(15,23,42,.16);
  /* v629「从上往下居中展开」：以顶边为支点轻微下拉，不用横向缩放（看板是宽面板，横向缩放会抖）。 */
  transform-origin:top center;
  animation:sb-drop .16s ease-out;
}
@keyframes sb-drop{
  from{opacity:0;transform:translateX(-50%) translateY(-6px)}
  to{opacity:1;transform:translateX(-50%) translateY(0)}
}
/* 极窄屏：留白压到 8，避免左右两侧合计 24px 的白边把面板挤成竖条。 */
@media(max-width:540px){
  .sb-pop{width:calc(100vw - 16px);padding:10px}
}
</style>
