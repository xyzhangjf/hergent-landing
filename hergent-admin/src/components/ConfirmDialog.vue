<template>
  <Modal :show="show" :title="title" @close="$emit('cancel')">
    <div class="cd-main">{{ text }}</div>
    <div v-if="consequence" class="cd-cons">{{ consequence }}</div>
    <div v-if="requireText" class="field cd-field">
      <label for="cd-confirm-input">请输入「{{ requireText }}」以确认</label>
      <input
        id="cd-confirm-input"
        class="input"
        v-model="typed"
        :placeholder="requireText"
        autocomplete="off"
        @keyup.enter="onEnter"
      />
    </div>
    <template #footer>
      <button class="btn ghost" @click="$emit('cancel')">{{ cancelLabel }}</button>
      <button class="btn cd-danger" :disabled="busy || !confirmEnabled" @click="$emit('confirm')">
        {{ busy ? '处理中…' : confirmLabel }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Modal from './Modal.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  text: { type: String, default: '' },
  // 后果说明：写清操作生效后会发生什么，降低误操作
  consequence: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  cancelLabel: { type: String, default: '取消' },
  busy: { type: Boolean, default: false },
  // 传入后要求用户原样输入该字符串才能确认（对标 Stripe 删除项目前的二次确认）
  requireText: { type: String, default: '' },
})
const emit = defineEmits(['confirm', 'cancel'])

const typed = ref('')
const confirmEnabled = computed(
  () => !props.requireText || typed.value.trim() === props.requireText
)

// 每次打开清空输入，避免上次残留直接把确认按钮解锁
watch(
  () => props.show,
  (v) => { if (v) typed.value = '' }
)

function onEnter() {
  if (confirmEnabled.value && !props.busy) emit('confirm')
}
</script>

<style scoped>
.cd-main { font-size: 14px; color: var(--text); line-height: 1.6; }
.cd-cons {
  margin-top: 12px; font-size: 13px; line-height: 1.6;
  /* 前景取深档：原 --danger 于浅红底仅 ≈3.4:1，未达 AA */
  color: var(--badge-danger-fg); background: var(--danger-bg);
  padding: 9px 12px; border-radius: var(--radius-sm);
}
.cd-field { margin-top: 14px; margin-bottom: 0; }
.cd-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.cd-danger:hover { filter: brightness(0.93); color: #fff; }
.cd-danger:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
