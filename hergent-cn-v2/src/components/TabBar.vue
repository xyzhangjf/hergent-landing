<template>
  <!-- ══ 全局标签栏（v396，2026-10-08；2026-10-10 恢复独立成行）════════════════════════════
       布局：**独立成行**，渲染在 `Shell.vue` 的 `.content` 内、滚动区 `.view-wrap` **之前**。
         这样它仍是「滚动区之外」（v396 约束：长页面滚动时标签不跟着滚走），
         同时恢复「顶栏单独一行 + 标签栏单独一行」的两行布局（对齐产品早期版本）。
       语义 = 「**我打开过哪些页**」（对齐舟谱），**不是**「这个模块有哪些页」。
       数据在 `composables/useTabs.js`（模块级单例），本组件只负责排版与交互。

       每个标签 = `[⟳ 刷新] 标题 [× 关闭]`（Q1 A：刷新放名称左侧 —— 舟谱实证）。
       激活态：白底 + 主色刷新钮；非激活：透明底 + 灰字（舟谱像素实证：
       条底亮 228、激活标签亮 255）。

       ⚠️ `≤768px` 整条隐藏（Q6 A：手机端维持现状，抽屉/底部栏不变）。 -->
  <div v-if="tabs.length" class="tabbar">
    <div class="tb-strip" ref="stripEl">
      <!-- 全集渲染、超出部分由 `.tb-strip` 的 overflow 裁掉；
           被裁掉的索引由 `measure()` 算出来，列进右侧「更多」下拉（Q5 B）。
           用 v-for 渲染全部（而不是只渲染可见的 n 个）是**测量前提**：
           被裁的元素仍有布局宽度，`offsetWidth` 才读得到。 -->
      <button v-for="t in tabs" :key="t.key" type="button" class="tab-item"
              :class="{ on: t.key === activeKey }" :title="t.title" @click="go(t)">
        <span class="tab-ic tab-refresh" role="button" :aria-label="'刷新' + t.title"
              :title="'刷新「' + t.title + '」'" @click.stop="refresh(t)">
          <Icon name="refresh" :size="12" />
        </span>
        <span class="tab-title">{{ t.title }}</span>
        <span class="tab-ic tab-close" role="button" :aria-label="'关闭' + t.title"
              :title="'关闭「' + t.title + '」'" @click.stop="close(t)">
          <Icon name="close" :size="12" />
        </span>
      </button>
    </div>

    <!-- 放不下的标签收进这里（Q5 B）。数量角标让人知道"还有几个没显示"。 -->
    <div v-if="hidden.length" class="tab-more">
      <button type="button" class="tab-more-btn" :aria-expanded="moreOpen" @click.stop="moreOpen = !moreOpen">
        <span>更多</span><span class="tab-more-n">{{ hidden.length }}</span>
      </button>
      <div v-if="moreOpen" class="tab-more-menu" @click.stop>
        <div v-for="t in hidden" :key="t.key" class="tab-more-row">
          <button type="button" class="tab-more-item" :class="{ on: t.key === activeKey }" @click="go(t)">
            <span class="tab-title">{{ t.title }}</span>
          </button>
          <span class="tab-ic" role="button" :title="'刷新「' + t.title + '」'" @click="refresh(t)">
            <Icon name="refresh" :size="12" />
          </span>
          <span class="tab-ic" role="button" :title="'关闭「' + t.title + '」'" @click="close(t)">
            <Icon name="close" :size="12" />
          </span>
        </div>
      </div>
    </div>
    <div v-if="moreOpen" class="tab-more-mask" @click="moreOpen = false"></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { useTabs } from '../composables/useTabs'

const emit = defineEmits(['refresh'])

const { tabs, activeKey, closeTab } = useTabs()
const route = useRoute()
const router = useRouter()

const stripEl = ref(null)
const moreOpen = ref(false)

/* ---------------------------------------------------------------------------
   溢出测量（Q5 B）
   ---------------------------------------------------------------------------
   🔴 只认**几何**，不按"个数"拍脑袋（同 v395：横向判据看真实几何）：
      逐个累加标签的 `offsetWidth`，第一个放不下的位置 = 可见条数。
   ⚠️ 有隐藏项时要**预留**「更多」按钮的宽度（MORE_W），否则会出现
      "算出来放得下 ⇒ 更多按钮不渲染 ⇒ 宽度够 ⇒ …" 的来回抖动。
      预留常量偏保守，宁可早一点收进更多，也不要抖。
   --------------------------------------------------------------------------- */
const GAP = 4
const MORE_W = 92
const visCount = ref(999)

const hidden = computed(function () {
  return tabs.value.slice(visCount.value)
})

function measure() {
  const el = stripEl.value
  if (!el) { visCount.value = tabs.value.length; return }
  const kids = Array.from(el.children)
  const cw = el.clientWidth
  let sum = 0
  const ws = kids.map(function (k) {
    const w = k.offsetWidth + GAP
    sum += w
    return w
  })
  if (!kids.length || sum <= cw) { visCount.value = kids.length; return }
  const avail = Math.max(0, cw - MORE_W)
  let used = 0
  let n = 0
  for (let i = 0; i < ws.length; i++) {
    if (used + ws[i] > avail) break
    used += ws[i]
    n++
  }
  visCount.value = Math.max(1, n)
}

let ro = null
function schedule() { nextTick(measure) }

onMounted(function () {
  if (typeof ResizeObserver !== 'undefined' && stripEl.value) {
    ro = new ResizeObserver(function () { measure() })
    ro.observe(stripEl.value)
  } else {
    window.addEventListener('resize', measure)
  }
  schedule()
})

onBeforeUnmount(function () {
  if (ro) ro.disconnect()
  else window.removeEventListener('resize', measure)
})

/* 标签增减 / 标题变化 ⇒ 重测。 */
watch(function () { return tabs.value.map(function (t) { return t.key + '|' + t.title }).join(',') }, schedule)
/* 切页时收起「更多」（否则下拉会浮在新页面上）。 */
watch(function () { return route.fullPath }, function () { moreOpen.value = false })

/* ---------------------------------------------------------------------------
   交互
   ---------------------------------------------------------------------------
   `go`     —— 切标签（当前标签点了不动，避免无意义导航）。
   `refresh`—— **只重载这一个标签的内容**：当前标签直接让 Shell 重建组件；
               非当前标签先切过去（切换即重建），因此不需要额外刷新手势。
   `close`  —— 关当前标签由 Shell 决定"看邻居还是回首页"（Q2 B）。
   --------------------------------------------------------------------------- */
function nav(t) {
  return { path: t.path, query: t.query && Object.keys(t.query).length ? t.query : undefined }
}

function go(t) {
  moreOpen.value = false
  if (t.key === activeKey.value) return
  router.push(nav(t))
}

function refresh(t) {
  moreOpen.value = false
  emit('refresh', t.key)
}

function close(t) {
  moreOpen.value = false
  emit('close', t.key)
}
</script>

<style scoped>
/* 独立成行 ⇒ 通栏底色 + 底分隔线（对齐早期版本的两行布局）。
   `.content` 是 flex 纵向容器，`.tabbar` 作为它的一个 `flex-shrink:0` 子项，
   自然撑满整行；这里只补「通栏底色 + 底分隔线 + 内边距」。
   🔴 **不要**给 `.tabbar` 加 `overflow:hidden`：右侧「更多」的下拉是
      `position:absolute`，会被它裁掉（裁剪发生在 `.tb-strip` 上就够了）。 */
.tabbar{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:6px 20px;background:var(--bg2);border-bottom:1px solid var(--border-subtle);position:relative}
.tb-strip{flex:1;min-width:0;display:flex;gap:4px;overflow:hidden}

.tab-item{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:28px;
  padding:0 7px 0 5px;border:1px solid transparent;border-radius:8px;background:transparent;
  color:var(--t2);font-size:12.5px;cursor:pointer;max-width:200px;
  transition:background .15s,color .15s,border-color .15s}
.tab-item:hover{background:var(--bg3);color:var(--t1)}
.tab-item.on{background:var(--bg);color:var(--t1);border-color:var(--border-subtle);
  box-shadow:var(--shadow-sm);font-weight:600}
.tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.tab-ic{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;
  border-radius:5px;color:var(--t3);flex-shrink:0;cursor:pointer;transition:background .15s,color .15s}
.tab-ic:hover{background:var(--p-bg);color:var(--p-dark)}
.tab-item.on .tab-refresh{color:var(--p-dark)}
.tab-item.on .tab-close{color:var(--t3)}

.tab-more{flex:0 0 auto;position:relative}
.tab-more-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;
  border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg);color:var(--t2);
  font-size:12.5px;cursor:pointer;transition:background .15s,color .15s}
.tab-more-btn:hover{background:var(--bg3);color:var(--t1)}
.tab-more-n{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;
  padding:0 4px;border-radius:8px;background:var(--p-bg);color:var(--p-dark);font-size:11px;font-weight:600}
.tab-more-menu{position:absolute;top:34px;right:0;min-width:180px;max-height:320px;overflow-y:auto;
  background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:6px;
  box-shadow:0 8px 24px rgba(0,0,0,.14);z-index:40}
.tab-more-row{display:flex;align-items:center;gap:4px;border-radius:7px;padding:0 4px 0 6px}
.tab-more-row:hover{background:var(--bg2)}
.tab-more-item{flex:1;min-width:0;display:flex;align-items:center;height:28px;border:none;
  background:none;color:var(--t2);font-size:12.5px;cursor:pointer;text-align:left;padding:0}
.tab-more-item.on{color:var(--p-dark);font-weight:600}
.tab-more-mask{position:fixed;inset:0;z-index:30}

/* Q6 A：手机端维持现状 —— 不出标签栏（抽屉 + 底部栏不变）。 */
@media(max-width:768px){ .tabbar{display:none} }
/* 打印时标签栏不参与排版（与各页隐藏 `.main-tabs` 的既有纪律一致）。 */
@media print{ .tabbar{display:none} }
</style>
