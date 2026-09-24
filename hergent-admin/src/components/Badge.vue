<template>
  <span class="badge" :class="variant">
    <span v-if="dot" class="dot"></span><slot />
  </span>
</template>

<script setup>
// 全站统一状态徽标：收敛原先 .badge / .pill / .tag / 手写 span 的多套写法。
// variant: success(启用/正常) | danger(停用/异常) | warning(关注) | info(进行中) | neutral(中性)
defineProps({
  variant: {
    type: String,
    default: 'neutral',
    validator: (v) => ['success', 'danger', 'warning', 'info', 'neutral'].includes(v),
  },
  dot: { type: Boolean, default: true },
})
</script>
