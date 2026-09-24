<template>
  <div class="skeleton" role="status" :aria-label="label">
    <div v-for="i in rows" :key="i" class="sk-row">
      <span
        v-for="(w, j) in widths"
        :key="j"
        class="sk-bar"
        :style="{ width: w }"
      ></span>
    </div>
  </div>
</template>

<script setup>
// 列表加载骨架屏：替代单调的「加载中…」文字，降低感知等待。
// 宽度数组用固定百分比而非随机值，避免每次渲染跳动。
defineProps({
  rows: { type: Number, default: 5 },
  widths: {
    type: Array,
    default: () => ['18%', '26%', '16%', '20%', '12%'],
  },
  label: { type: String, default: '加载中' },
})
</script>

<style scoped>
.skeleton { padding: 14px 16px; }
.sk-row { display: flex; gap: 16px; align-items: center; height: 34px; }
.sk-bar {
  display: block; height: 12px; border-radius: 4px;
  background: var(--bg-muted);
  animation: sk-pulse 1.2s ease-in-out infinite;
}
@keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .sk-bar { animation: none; }
}
</style>
