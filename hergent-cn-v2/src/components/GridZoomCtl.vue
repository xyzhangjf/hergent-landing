<template>
  <div class="zoom-group">
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
const props = defineProps({ modelValue: { type: Number, default: 100 } })
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
</style>
