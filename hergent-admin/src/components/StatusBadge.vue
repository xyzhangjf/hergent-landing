<template>
  <Badge :variant="active ? 'success' : 'danger'">{{ active ? '启用' : '停用' }}</Badge>
</template>

<script setup>
import Badge from './Badge.vue'

defineProps({ active: { type: [Boolean, Number], default: true } })
</script>
