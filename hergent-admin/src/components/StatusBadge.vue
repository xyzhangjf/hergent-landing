<template>
  <span class="badge" :class="active ? 'on' : 'off'">
    <span class="dot"></span>{{ active ? '启用' : '停用' }}
  </span>
</template>

<script setup>
defineProps({ active: { type: [Boolean, Number], default: true } })
</script>
