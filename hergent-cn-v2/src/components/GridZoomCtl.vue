<template>
  <div class="zoom-group" :class="{ 'zoom-compact': compact }">
    <span class="zb-label">缩放</span>
    <button class="zb-btn" type="button" :disabled="modelValue<=50" @click="set(modelValue-10)" title="缩小" aria-label="缩小">－</button>
    <input class="zb-range" type="range" min="50" max="200" step="10" :value="modelValue" @input="set(Number($event.target.value))" aria-label="缩放比例">
    <span class="zb-val">{{ modelValue }}%</span>
    <button class="zb-btn" type="button" :disabled="modelValue>=200" @click="set(modelValue+10)" title="放大" aria-label="放大">＋</button>
    <button class="zb-btn zb-reset" type="button" :disabled="modelValue===100" @click="set(100)" title="重置 100%" aria-label="重置缩放"><Icon name="refresh"/></button>
  </div>
</template>

<script setup>
import Icon from './Icon.vue'
/* v209：compact = 紧凑形态（去掉「缩放」二字、滑杆 100→64px），供全屏表格工具行使用 ——
   全屏那一行要塞进整个编辑组（取消/回退/查错/补录商品/保存 + 状态条），实测 1280 档位很紧。
   能力不丢：－/＋（10% 步进）、百分比、重置 100% 全在，只是滑杆短一些。
   ⚠️ 不改成「父组件用 CSS 覆盖」—— 本组件是 <style scoped>，.zb-label/.zb-range 带的是
      本组件的 scope id，父组件的选择器（哪怕加 :deep 之外的写法）选不中，静默失效。 */
const props = defineProps({
  modelValue: { type: Number, default: 100 },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
function set(v) {
  const n = Math.min(200, Math.max(50, Math.round(v / 10) * 10))
  if (n !== props.modelValue) emit('update:modelValue', n)
}
</script>

<style scoped>
/* P1-6：缩放控件从 Forecast.vue 抽出复用（原只读态/编辑态各写一份，完全相同） */
.zoom-group{display:inline-flex;align-items:center;gap:6px;margin-left:0;font-size:12px}
.zoom-group .zb-label{color:var(--t2);white-space:nowrap;font-size:12px}
.zoom-group .zb-btn{
  width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--bd);background:var(--bg);color:var(--t1);border-radius:8px;cursor:pointer;
  font-size:15px;line-height:1;padding:0;
}
.zoom-group .zb-btn:hover:not(:disabled){background:var(--bg2);color:var(--p)}
.zoom-group .zb-btn:disabled{opacity:.35;cursor:default}
.zoom-group .zb-reset{font-size:14px}
.zoom-group .zb-range{width:100px;accent-color:var(--p);cursor:pointer}
.zoom-group .zb-val{min-width:38px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums;color:var(--t1)}
/* v209 compact：全屏表格工具行专用。省 30(label) + 36(滑杆) = 66px。
   「缩放」二字去掉后仍有 － / 100% / ＋ / 重置 四个控件自证用途，title 与 aria-label 保留。 */
.zoom-group.zoom-compact .zb-label{display:none}
.zoom-group.zoom-compact .zb-range{width:64px}
</style>
