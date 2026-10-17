<template>
  <!-- ══ 输入弹窗（Phase 0 · 组件复用治理 · 2026-10-17）═══════════════════
       全站输入类二次确认的统一宿主：经 `store.prompt()` 命令式触发（App.vue 全局挂载），
       替换原生 `window.prompt`（进销存 3 处「驳回理由」已收敛；Forecast 高风险件 4 处待 Phase 3）。
       语义对齐 window.prompt：确认返回输入字符串、取消 / ESC 返回 null。
       交互能力由 Modal 继承：teleport body + role=dialog + ESC 关闭 + Tab 焦点陷阱
             + 背景滚动锁 + 关闭后焦点归还触发元素。
       默认单行 input（Enter 确认，与原生 prompt 习惯一致）；multiline 时用 textarea，
            此时 Enter 换行、Cmd/Ctrl+Enter 确认。 -->
  <Modal :show="show" :title="title" @close="emit('cancel')">
    <div class="ui-pd-text">{{ text }}</div>
    <textarea v-if="multiline" class="input ui-pd-input" v-model="val" :placeholder="placeholder"
              rows="3" @keydown.ctrl.enter.prevent="onConfirm" @keydown.meta.enter.prevent="onConfirm" />
    <input v-else class="input ui-pd-input" v-model="val" :placeholder="placeholder"
           autocomplete="off" @keyup.enter="onConfirm" />
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="emit('cancel')">{{ cancelLabel }}</button>
      <button type="button" class="btn btn-primary" @click="onConfirm">{{ confirmLabel }}</button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, watch } from 'vue'
import Modal from './Modal.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '输入' },
  text: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  defaultValue: { type: String, default: '' },
  multiline: { type: Boolean, default: false },
  confirmLabel: { type: String, default: '确定' },
  cancelLabel: { type: String, default: '取消' }
})
const emit = defineEmits(['confirm', 'cancel'])

const val = ref('')

// 每次打开用 defaultValue 初始化，避免上次残留值带入
watch(() => props.show, (v) => { if (v) val.value = props.defaultValue || '' })

function onConfirm() {
  emit('confirm', val.value)
}
</script>

<style scoped>
.ui-pd-text{font-size:14px;color:var(--t1);line-height:1.6;margin-bottom:12px;white-space:pre-line}
.ui-pd-input{width:100%}
</style>
