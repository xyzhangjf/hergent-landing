<template>
  <Modal :show="show" :title="title" @close="$emit('cancel')">
    <div class="cd-main">{{ text }}</div>
    <div v-if="consequence" class="cd-cons">{{ consequence }}</div>
    <template #footer>
      <button class="btn ghost" @click="$emit('cancel')">{{ cancelLabel }}</button>
      <button class="btn cd-danger" :disabled="busy" @click="$emit('confirm')">
        {{ busy ? '处理中…' : confirmLabel }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import Modal from './Modal.vue'

defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  text: { type: String, default: '' },
  // 后果说明：写清操作生效后会发生什么，降低误操作
  consequence: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  cancelLabel: { type: String, default: '取消' },
  busy: { type: Boolean, default: false },
})
defineEmits(['confirm', 'cancel'])
</script>

<style scoped>
.cd-main { font-size: 14px; color: var(--text); line-height: 1.6; }
.cd-cons {
  margin-top: 12px; font-size: 13px; line-height: 1.6;
  color: var(--danger); background: var(--danger-bg);
  padding: 9px 12px; border-radius: var(--radius-sm);
}
.cd-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.cd-danger:hover { filter: brightness(0.93); color: #fff; }
.cd-danger:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
