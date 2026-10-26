<template>
  <!-- v465e（仓配 P1）：通用弹窗外壳。
       🔴 为什么收成一个组件：入库单 / 出库单 / 其它出入库单三页都要「新建」浮层，
          各写一份 = 三份定位与观感，改一处必然漏两处（本仓一类专项缺陷）。
       v691（2026-10-26）：本组件改为 `components/Modal.vue` 的薄封装 —— 全站弹窗骨架
          只留一份实现。此前它是「第 19 套手写弹窗」（自己写 mask/dlg/hd/bd/ft +
          自己 addEventListener 管 Esc），在全站收编时一并归到公共 Modal。
          对外 props/事件/slot 一字不改，调用方零改动：
            · title / width（width 仍收字符串，内部取出像素值交给 Modal）
            · 遮罩点击关闭 / Esc 关闭 / 关闭按钮 —— 由 Modal 统一负责
            · 默认 slot = 正文，`#footer` = 底部按钮（有才渲染，避免空条） -->
  <Modal guard-close :show="true" :width="pxWidth" :title="title" @close="close">
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </Modal>
</template>

<script setup>
import { computed } from 'vue'
import Modal from '../../components/Modal.vue'

const props = defineProps({
  title: { type: String, default: '' },
  /** 弹窗宽度（历史上收的是字符串，如 'min(880px, 94vw)'）。这里取出像素值交给 Modal；
      窄屏护栏由 Modal 的 max-width:92vw 统一负责。 */
  width: { type: String, default: 'min(880px, 94vw)' },
})
const emit = defineEmits(['close'])
function close() { emit('close') }

/* 从 'min(880px, 94vw)' / '880px' / '880' 里取第一个整数。
   取不到就退回 880（本组件历史上的默认宽度），保证不会变成 0 宽。 */
const pxWidth = computed(() => {
  const m = String(props.width || '').match(/(\d+)/)
  return m ? Number(m[1]) : 880
})
</script>
