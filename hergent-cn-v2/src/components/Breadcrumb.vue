<template>
  <!-- v538：面包屑导航。
       items: [{ label, to? }]，最后一项自动作为当前页（不可点 + aria-current）。
       分隔符用「/」（中文后台通用，沿用 admin 同款）。 -->
  <nav class="ui-crumbs" aria-label="面包屑">
    <template v-for="(c, i) in items" :key="i">
      <router-link
        v-if="c.to && i < items.length - 1"
        :to="c.to"
        class="ui-crumb"
      >{{ c.label }}</router-link>
      <span v-else class="ui-crumb ui-crumb-cur" aria-current="page">{{ c.label }}</span>
      <span v-if="i < items.length - 1" class="ui-crumb-sep" aria-hidden="true">/</span>
    </template>
  </nav>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] },
})
</script>

<style scoped>
.ui-crumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.ui-crumb { color: var(--t2); text-decoration: none; transition: color .15s; }
.ui-crumb:hover { color: var(--p-dark); }
.ui-crumb-cur { color: var(--t1); font-weight: 500; }
.ui-crumb-sep { color: var(--t3); }
</style>
