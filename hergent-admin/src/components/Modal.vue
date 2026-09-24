<template>
  <teleport to="body">
    <div class="modal-mask" v-if="show" @click.self="emit('close')">
      <div
        ref="panel"
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <div class="modal-head">
          <span :id="titleId">{{ title }}</span>
          <button type="button" class="close" aria-label="关闭" @click="emit('close')">×</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div class="modal-foot" v-if="$slots.footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({ show: Boolean, title: String })
const emit = defineEmits(['close'])

// 每个实例的唯一标题 id，用于 aria-labelledby
let seq = 0
const titleId = 'modal-title-' + (++seq)

const panel = ref(null)
let lastFocused = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables() {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null
  )
}

function onKeydown(e) {
  // Esc 关闭：任何位置都生效，不要求焦点落在弹窗内
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  // Tab 焦点陷阱：只在弹窗内循环
  if (e.key === 'Tab') {
    const f = focusables()
    if (f.length === 0) {
      e.preventDefault()
      if (panel.value) panel.value.focus()
      return
    }
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => props.show,
  async (v) => {
    if (v) {
      lastFocused = document.activeElement
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onKeydown, true)
      await nextTick()
      const f = focusables()
      if (f.length) f[0].focus()
      else if (panel.value) panel.value.focus()
    } else {
      window.removeEventListener('keydown', onKeydown, true)
      document.body.style.overflow = ''
      // 关闭后把焦点还给触发它的元素，避免焦点丢失到 body
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus() } catch (e) { /* 元素可能已卸载，忽略 */ }
      }
      lastFocused = null
    }
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  document.body.style.overflow = ''
})
</script>
