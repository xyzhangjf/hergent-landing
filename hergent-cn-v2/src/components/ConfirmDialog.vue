<template>
  <!-- ══ 危险操作确认弹窗（Phase 0 · 组件复用治理第一批 · 2026-10-17）═══════════════
       统一全站危险操作二次确认，替换原生 `window.confirm`（此前 48 处 / 22 文件割裂）。
       能力对齐 hergent-admin 的 ConfirmDialog.vue：
         - consequence 后果说明（浅红底，写清生效后果，降低误操作）
         - requireText 输入原串二次确认（对标 Stripe 删除项目）
         - busy 防重复点击 + 危险按钮红色实底
       视觉对齐 cn-v2 既有确认弹窗（Rebate.vue v112 R20 的红色危险按钮覆盖）。 -->
  <Modal :show="show" :title="title" @close="emit('cancel')">
    <div class="ui-cd-text">{{ text }}</div>
    <div v-if="consequence" class="ui-cd-cons">{{ consequence }}</div>
    <div v-if="requireText" class="ui-cd-field">
      <label class="ui-cd-label" for="ui-cd-input">请输入「{{ requireText }}」以确认</label>
      <input id="ui-cd-input" class="input" v-model="typed" :placeholder="requireText"
             autocomplete="off" @keyup.enter="onEnter" />
    </div>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="emit('cancel')">{{ cancelLabel }}</button>
      <button type="button" class="btn btn-primary ui-cd-danger" :disabled="busy || !confirmEnabled" @click="emit('confirm')">
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
  // 传入后要求用户原样输入该字符串才能确认
  requireText: { type: String, default: '' }
})
const emit = defineEmits(['confirm', 'cancel'])

const typed = ref('')
const confirmEnabled = computed(
  () => !props.requireText || typed.value.trim() === props.requireText
)

// 每次打开清空输入，避免上次残留直接把确认按钮解锁
watch(() => props.show, (v) => { if (v) typed.value = '' })

function onEnter() {
  if (confirmEnabled.value && !props.busy) emit('confirm')
}
</script>

<style scoped>
.ui-cd-text{font-size:14px;color:var(--t1);line-height:1.6;white-space:pre-line}
.ui-cd-cons{font-size:13px;line-height:1.6;color:var(--danger-txt);background:var(--danger-bg);
  padding:9px 12px;border-radius:var(--radius-sm)}
.ui-cd-field{display:flex;flex-direction:column;gap:6px}
.ui-cd-label{font-size:13px;color:var(--t2)}
.ui-cd-danger{background:var(--dan);border-color:var(--dan);color:#fff}
.ui-cd-danger:hover:not(:disabled){background:var(--dan);filter:brightness(.93);color:#fff}
.ui-cd-danger:disabled{opacity:.45;cursor:not-allowed}
</style>
