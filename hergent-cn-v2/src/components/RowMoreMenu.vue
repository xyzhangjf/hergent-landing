<template>
  <!-- v678：行内「更多操作」菜单（⋯）。由来：采购单列表的「关联 / 操作」两列按钮过多，
       靠 `flex-wrap` 挤成两行 ⇒ 行高从 32.8px 涨到 43~48.6px，一屏少看三行。
       老板口径：不常用的收进 ⋯，常用的仍要在外面直接点。

       🔴 必须 `Teleport to="body"` + `position:fixed`：下拉留在 `<td>` 里会被
          `.card{overflow:hidden}` 与表格容器的 `overflow` **裁掉**（本项目反复踩过的坑，
          同 `useNameSuggest` 的做法）。坐标由 `place()` 按触发按钮的 `getBoundingClientRect()` 现算。
       🔴 组件**只有一根根节点**（`.row-more`）：多根（Fragment）会让父级写的 class 静默丢失
          （v629 踩过），而本件在 `.ipl-op` 的 flex 行里，宽度全靠自己撑。
       🔴 菜单项用 `@click` 而不是 `@mousedown`：触发按钮不是输入框，没有 blur 抢跑问题；
          而在 `mousedown` 阶段就执行动作会让 `rowOp()` 里的 `confirm()` 与外部点击关闭打架。 -->
  <span class="row-more">
    <button ref="btnEl" type="button" class="row-more-btn" :class="{ on: open }"
            :title="label" :aria-expanded="open ? 'true' : 'false'" aria-haspopup="menu"
            @click.stop="toggle"><Icon name="more-horizontal" :size="14" /></button>

    <Teleport to="body">
      <div v-if="open" ref="popEl" class="row-more-pop" role="menu" :style="style" @click.stop>
        <button v-for="it in items" :key="it.key" type="button" role="menuitem"
                class="row-more-mi" :class="{ danger: it.danger }"
                :disabled="it.disabled" :title="it.title || null"
                @click="pick(it)">{{ it.text }}</button>
      </div>
    </Teleport>
  </span>
</template>

<script setup>
/* props / emits —— 本件**只管开合与定位**，动作本身由宿主页执行：
   · items  [{ key, text, danger?, disabled?, title? }]，空数组时宿主页不该渲染本件
   · label  触发按钮的 title（默认「更多操作」）
   · 事件 pick(key) —— 点完自动收起；要不要 confirm 由宿主页决定 */
import { ref, nextTick, onBeforeUnmount, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  label: { type: String, default: '更多操作' },
})
const emit = defineEmits(['pick'])

const open = ref(false)
const btnEl = ref(null)
const popEl = ref(null)
const style = ref({})
const POP_W = 108        // 首帧量不到真实宽度时的兜底（nextTick 后按 offsetWidth 校正）
const GAP = 4            // 菜单与按钮的间距
const PAD = 8            // 与视口边缘的最小距离

function place () {
  const b = btnEl.value
  if (!b) return
  const r = b.getBoundingClientRect()
  const mw = popEl.value ? popEl.value.offsetWidth : POP_W
  const mh = popEl.value ? popEl.value.offsetHeight : 0
  const vw = window.innerWidth
  const vh = window.innerHeight
  /* 水平：菜单**右缘**对齐按钮右缘（操作列在最右边，左对齐会伸进表格中间）。
     越左边界就贴左，越右边界就贴右 —— 两头都要兜，否则窄屏再次被裁。 */
  let left = r.right - mw
  if (left < PAD) left = PAD
  if (left + mw > vw - PAD) left = Math.max(PAD, vw - PAD - mw)
  /* 垂直：优先向下；下方放不下（行常在屏幕底部）就向上翻，且不允许越过视口上沿。 */
  const below = vh - PAD - (r.bottom + GAP)
  const up = r.top - GAP - PAD
  const useBelow = mh ? below >= mh || below >= up : below >= up
  const top = useBelow ? (r.bottom + GAP) : Math.max(PAD, r.top - GAP - mh)
  style.value = { left: left + 'px', top: top + 'px', minWidth: mw + 'px' }
}

async function toggle () {
  if (open.value) { close(); return }
  open.value = true
  await nextTick()
  place()                 // 首帧按兜底宽度摆、再按真实尺寸校正（避免先闪一下）
}
function close () { open.value = false }
function pick (it) {
  if (it.disabled) return
  close()
  emit('pick', it.key)
}

/* —— 关闭时机（少一个就是"菜单关不掉"这类死控件）——
   ① 点菜单与按钮之外的任何地方（capture + mousedown：比 click 早，不会先被宿主行的点击抢走）
   ② Esc
   ③ 滚动 / 改窗口：菜单是 fixed，脱离文档流 ⇒ 一滚就与按钮脱位，直接收起
      （scroll 走**捕获阶段**，一个监听同时覆盖页面滚动与表格内部滚动） */
function onDocDown (e) {
  if (!open.value) return
  const t = e.target
  if (popEl.value && popEl.value.contains(t)) return
  if (btnEl.value && btnEl.value.contains(t)) return
  close()
}
function onKey (e) { if (e.key === 'Escape') close() }
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
  } else {
    document.removeEventListener('mousedown', onDocDown, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', close, true)
    window.removeEventListener('resize', close)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey, true)
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
})
</script>

<style scoped>
/* 触发按钮：与 `.ipl-op-btn` 的**盒高完全一致**（实测文字按钮 13px/line-height:normal = 18px）。
   🔴 这里绝不能写 20px 以上：本件在 `.ipl-op` 的 flex 行里，盒子比文字高就会把那一行的
      行盒顶高 —— 那等于「为了不换行而把行撑高」，白改一场。图标 14px 保证在 18px 盒内不裁。
   hover 才有底色，默认"安静"（不抢常用按钮的视觉）。 */
.row-more { display: inline-flex; align-items: center }
.row-more-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: none; background: none;
  border-radius: 4px; color: var(--t3); cursor: pointer; line-height: 1;
}
.row-more-btn:hover { color: var(--p-dark); background: var(--bg3) }
.row-more-btn.on { color: var(--p-dark); background: var(--bg3) }
</style>

<style>
/* 菜单本体（Teleport 到 body，scoped 属性挂不上 ⇒ 必须非 scoped）。
   层级：`--z-page-menu`(1101) —— 与页面级列菜单同一档；⛔ 不要用 1000 以下，
   会被外壳浮层(1122) 盖住（v674 的教训）。
   v704 校准：工具条触发按钮 `.tb-pop` 已从 1120 降到 1101（面板本体升到 1116），
   故本件与触发按钮**同档**、按 DOM 顺序（teleport 后插入者在上）；仍低于面板 1116 与外壳浮层 1122。
   ⚠️ 副驾抽屉打开时本件要"让位"（z-index:auto），见 `styles/app-layers.css`。 */
.row-more-pop {
  position: fixed; z-index: var(--z-page-menu, 1101);
  display: flex; flex-direction: column; min-width: 96px; padding: 4px;
  background: var(--bg2); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 10px); box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, .12));
  font-size: 13px;
}
.row-more-mi {
  display: block; width: 100%; padding: 6px 10px; border: none; background: none;
  text-align: left; white-space: nowrap; color: var(--t1); cursor: pointer;
  border-radius: 6px; font-size: 13px; line-height: 18px;
}
.row-more-mi:hover { background: var(--bg3) }
.row-more-mi.danger { color: var(--danger-txt) }
.row-more-mi.danger:hover { background: var(--danger-bg) }
.row-more-mi:disabled { color: var(--t3); cursor: default; background: none }
</style>
