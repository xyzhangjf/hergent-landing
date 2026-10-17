<template>
  <!-- ══ 通用模态弹窗（Phase 0 · 组件复用治理第一批 · 2026-10-17）═══════════════════
       视觉：收敛全站已验证的 `.modal-overlay/.modal-card/.modal-hd/.modal-body/.modal-ft`
             弹窗体系（此前各页面 scoped 各手写一份，见 Rebate.vue 3438-3444），
             此处为唯一实现。header/footer 固定、body 独立滚动（比旧版整卡滚动更稳）。
       交互：teleport 到 body + role=dialog/aria-modal + ESC 关闭 + Tab 焦点陷阱
             + 打开锁背景滚动 + 关闭后焦点归还触发元素（对齐 hergent-admin 的
             Modal.vue 成熟实现，不重造轮子）。
       ⚠️ class 统一 `ui-modal-` 前缀：与各页面 scoped 里仍残留的 `.modal-*` 隔离；
          后续逐步用本组件替换页面手写弹窗，手写 `.modal-*` 即告淘汰。 -->
  <teleport to="body">
    <div v-if="show" class="ui-modal-overlay" @click.self="emit('close')">
      <div ref="panel" class="ui-modal-card" :style="cardStyle"
           role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <div class="ui-modal-hd">
          <b :id="titleId">{{ title }}</b>
          <button type="button" class="ui-modal-close" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </div>
        <div class="ui-modal-body"><slot /></div>
        <div v-if="$slots.footer" class="ui-modal-ft"><slot name="footer" /></div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // 覆盖默认 580px 宽度（传数字 = px）
  width: { type: Number, default: 0 }
})
const emit = defineEmits(['close'])

const cardStyle = computed(() => (props.width ? { width: props.width + 'px' } : {}))

// 每个实例唯一标题 id，供 aria-labelledby 引用
let seq = 0
const titleId = 'ui-modal-title-' + (++seq)

const panel = ref(null)
let lastFocused = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables() {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null)
}

function onKeydown(e) {
  // Esc 关闭：任何位置都生效
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  // Tab 焦点陷阱：只在弹窗内循环
  if (e.key === 'Tab') {
    const f = focusables()
    if (!f.length) {
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
      // 关闭后把焦点还给触发元素，避免焦点丢到 body
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus() } catch (e) { /* 触发元素可能已卸载，忽略 */ }
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

<style scoped>
.ui-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000}
.ui-modal-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:580px;
  max-width:92vw;max-height:88vh;overflow:hidden;background:var(--bg);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:1001;
  display:flex;flex-direction:column}
.ui-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;
  border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.ui-modal-hd b{font-size:16px;font-weight:600;color:var(--t1)}
.ui-modal-close{border:none;background:none;color:var(--t3);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;
  border-radius:var(--radius-sm);transition:background .15s,color .15s}
.ui-modal-close:hover{background:var(--bg2);color:var(--t1)}
.ui-modal-body{padding:20px;overflow-y:auto}
.ui-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;
  border-top:1px solid var(--border-subtle);flex-shrink:0}
</style>
