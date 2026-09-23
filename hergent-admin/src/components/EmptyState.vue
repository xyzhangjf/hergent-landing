<template>
  <div class="empty-state">
    <Icon :name="icon" :size="40" class="es-ico" />
    <div class="es-title">{{ title }}</div>
    <div v-if="desc" class="es-desc">{{ desc }}</div>
    <button v-if="actionLabel" class="btn primary sm" @click="$emit('action')">{{ actionLabel }}</button>
  </div>
</template>

<script setup>
import Icon from './Icon.vue'

defineProps({
  icon: { type: String, default: 'inbox' },
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
})
defineEmits(['action'])
</script>

<style scoped>
.empty-state { text-align: center; padding: 36px 16px; }
.es-ico { opacity: 0.35; color: var(--text-3); }
.es-title { font-size: 14px; font-weight: 600; color: var(--text-2); }
.es-desc { margin-top: 6px; font-size: 12px; color: var(--text-3); line-height: 1.6; }
.btn { margin-top: 16px; }
</style>
