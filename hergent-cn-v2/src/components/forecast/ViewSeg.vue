<template>
  <!-- v621：从「视图切换独占一行」改成「并进表格工具行」。抽成组件是因为它现在有**两个落点**：
       · 汇总表视图 → 表格工具行首位（「缩放」左边）
       · 逐单补录视图 → 报单草稿卡的标题栏
       ⚠️ 必须两处都有：`.cross-area` 是 `v-if="viewMode === 'cross'"`，只放里面的话
          切到「逐单补录」会连切换器一起卸载 —— 用户就回不去了（真机验收抓到过这一版）。
       两个落点共用这一份模板与样式，不会出现"两处长得不一样"的老问题。 -->
  <span class="view-seg-wrap">
    <span class="view-seg" role="group" aria-label="填报视图切换">
      <button type="button" :class="{ on: mode === 'cross' }" @click="pick('cross')">汇总表</button>
      <button type="button" :class="{ on: mode === 'list' }" @click="pick('list')">逐单补录</button>
    </span>
    <!-- 用法提示：常隐，悬停 / 键盘聚焦才出。
         原来它是常显的一整句（60 字）挂在切换器右边，占着那行的绝大部分宽度 ——
         第二次看就没价值了，却是这一行唯一"贵"的原因，故改成浮层。
         ⚠️ 定位锚点必须是 .view-seg-wrap（position:relative）；挂到 static 的父级上
            会以更外层为包含块，`top:100%` 直接跑到屏幕外。
         ⚠️ pointer-events:none 不可省：浮层盖在表头上，能命中就会抢走 :hover ⇒ 闪烁。 -->
    <span class="seg-tip" role="tooltip">
      <span class="st-row"><b>汇总表</b>批量粘贴 · 整表改量 · 增删商品（再点「改单」）</span>
      <span class="st-row"><b>逐单补录</b>少量补录 · 按商品搜索加购</span>
    </span>
  </span>
</template>

<script setup>
/* v621：几何与同行控件同构（v599）—— 外框 32px 高、13px 字、1px 透明边、radius 8，
   与 .tb-toggle / .btn-sm 顶边与高度零差（真机量：topΔ=0 hΔ=0）。
   ⚠️ 不要再给它 margin-bottom：它已经不在独立一行里了（原来那 12px 是给 .view-seg-row 的）。 */
const props = defineProps({
  mode: { type: String, default: 'cross' },   // 'cross' 汇总表 | 'list' 逐单补录
})
const emit = defineEmits(['change'])
function pick(m) {
  if (m !== props.mode) emit('change', m)
}
</script>

<style scoped>
.view-seg-wrap{position:relative;display:inline-flex;flex:0 0 auto}
.view-seg{display:inline-flex;gap:var(--sp-1);background:var(--bg3);border-radius:var(--radius-sm);padding:var(--sp-h2)}
.view-seg button{border:1px solid transparent;background:transparent;padding:3px var(--sp-3);border-radius:var(--radius-sm);font-size:var(--fs-base);line-height:1.45;color:var(--t2);cursor:pointer;white-space:nowrap}
.view-seg button:hover:not(.on){color:var(--p-dark)}
.view-seg button.on{background:var(--bg4);color:var(--p-ink);box-shadow:var(--shadow-sm);border-color:var(--p);font-weight:500}
.seg-tip{position:absolute;left:0;top:calc(100% + 6px);z-index:1240;width:340px;
  padding:var(--sp-2) var(--sp-h10);border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--bd);
  box-shadow:var(--shadow-md);font-size:var(--fs-sm);line-height:1.6;color:var(--t2);
  opacity:0;visibility:hidden;pointer-events:none;
  transition:opacity var(--dur-fast) ease var(--dur-base),visibility 0s linear .28s}
.seg-tip .st-row{display:block}
.seg-tip .st-row+.st-row{margin-top:var(--sp-1)}
.seg-tip b{color:var(--t1);font-weight:600;margin-right:var(--sp-h6)}
.view-seg-wrap:hover>.seg-tip,.view-seg-wrap:focus-within>.seg-tip{opacity:1;visibility:visible;transition-delay:.16s,0s}
</style>
