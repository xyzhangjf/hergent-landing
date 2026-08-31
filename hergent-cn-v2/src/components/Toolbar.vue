<template>
  <div class="tb" :class="{ 'tb-compact': compact }">
    <slot />
  </div>
</template>

<script setup>
// 统一工具栏外壳：渲染 .tb 容器，内部用 .tb-group 分组、.tb-sep 分隔。
defineProps({
  compact: { type: Boolean, default: false }
})
</script>
