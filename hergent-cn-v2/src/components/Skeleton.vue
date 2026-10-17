<template>
  <!-- v538：列表加载骨架屏。
       由来：Forecast.vue（.tbl-skeleton .sk-row .sk-bar，约 13027 行）与
       Rebate.vue（.skel-line）各手写一份骨架视觉，未抽共享。抽成本组件，
       视觉沿用 Forecast 已验证的「渐变扫光」配方（linear-gradient 400% 位移动画），
       比全局 .skel-line 的单色 pulse 更有质感、老板已看惯。

       🔴 宽度数组用固定百分比（非随机），避免每次渲染跳动（沿用 admin 同款约定）。 -->
  <div class="ui-skeleton" role="status" aria-busy="true" :aria-label="label">
    <div v-for="i in rows" :key="i" class="ui-sk-row">
      <span
        v-for="(w, j) in widths"
        :key="j"
        class="ui-sk-bar"
        :style="{ width: w }"
      ></span>
    </div>
  </div>
</template>

<script setup>
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
.ui-skeleton { padding: 14px 16px; }
.ui-sk-row { display: flex; gap: 12px; align-items: center; height: 32px; }
.ui-sk-bar {
  display: block; height: 14px; border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--bg2) 25%, var(--bg3) 37%, var(--bg2) 63%);
  background-size: 400% 100%;
  animation: ui-sk-pulse 1.2s ease-in-out infinite;
}
@keyframes ui-sk-pulse {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-sk-bar { animation: none; }
}
</style>
