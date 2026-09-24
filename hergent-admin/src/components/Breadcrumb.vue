<template>
  <nav class="crumbs" aria-label="面包屑">
    <template v-for="(c, i) in items" :key="i">
      <router-link v-if="c.to && i < items.length - 1" :to="c.to" class="crumb">{{ c.label }}</router-link>
      <span v-else class="crumb current" aria-current="page">{{ c.label }}</span>
      <span v-if="i < items.length - 1" class="crumb-sep" aria-hidden="true">/</span>
    </template>
  </nav>
</template>

<script setup>
// items: [{ label, to? }]，最后一项自动作为当前页（不可点、带 aria-current）
defineProps({
  items: { type: Array, default: () => [] },
})
</script>
