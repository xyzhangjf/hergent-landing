<template>
  <!-- v465e（仓配 P1）：通用弹窗外壳。
       🔴 为什么收成一个组件：入库单 / 出库单 / 其它出入库单三页都要「新建」浮层，
          各写一份 = 三份定位与观感，改一处必然漏两处（本仓一类专项缺陷）。
       🔴 遮罩点击关闭 + Esc 关闭 + 关闭按钮，三条口径与全站既有浮层一致。 -->
  <div class="whd-mask" @click.self="close">
    <div class="whd-dlg" :style="{ width }" role="dialog" aria-modal="true">
      <div class="whd-hd">
        <span class="whd-title">{{ title }}</span>
        <button class="whd-x" title="关闭（Esc）" @click="close"><Icon name="close" :size="16" /></button>
      </div>
      <div class="whd-bd"><slot /></div>
      <div class="whd-ft"><slot name="footer" /></div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import Icon from '../../components/Icon.vue'

defineProps({
  title: { type: String, default: '' },
  /** 弹窗宽度（含单位）。默认 min() 保证窄屏不被撑破。 */
  width: { type: String, default: 'min(880px, 94vw)' },
})
const emit = defineEmits(['close'])
function close() { emit('close') }

function onKey(e) { if (e.key === 'Escape') close() }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<style scoped>
.whd-mask {
  position: fixed; inset: 0; z-index: var(--z-modal);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 6vh 0 4vh; overflow-y: auto;
  background: rgba(0, 0, 0, .35);
}
.whd-dlg {
  max-width: 96vw;
  background: var(--bg); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; max-height: 90vh;
}
.whd-hd {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid var(--border-subtle);
}
.whd-title { flex: 1; min-width: 0; font-size: var(--fs-h4, 15px); font-weight: 600; color: var(--t1) }
.whd-x {
  flex: none; width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: var(--radius-sm);
  color: var(--t3); cursor: pointer;
}
.whd-x:hover { background: var(--bg2); color: var(--t1) }
.whd-bd { padding: 16px 18px; overflow-y: auto }
.whd-ft {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--border-subtle);
}
</style>
