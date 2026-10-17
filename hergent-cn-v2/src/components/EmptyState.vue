<template>
  <!-- v538：全站统一空态组件。
       由来：`.state-empty` / `.se-ic` 早就是全局 class（variables.css 680-681），
       但「图标 + 标题 + 描述 + 动作按钮」这段三段式模板在 200+ 处被逐页手写，
       尤其 `.se-ic` 里的图标 SVG 每处复制一遍（Icon 组件已存在却没被复用）。
       ⇒ 抽成本组件：复用全局 `.state-empty` / `.se-ic`，图标交给 `<Icon>`，
          只在 scoped 里补 title / desc / action 三段的样式（全局没有这几段）。

       🔴 图标名必须存在于 `Icon.vue` 的 ICONS 表，否则会静默兜底成齿轮
          （v311/v453 教训）。默认 `inbox` 已核对存在。 -->
  <div class="state-empty">
    <div v-if="icon" class="se-ic"><Icon :name="icon" :size="22" /></div>
    <div v-if="title" class="es-title">{{ title }}</div>
    <div v-if="desc" class="es-desc">{{ desc }}</div>
    <slot />
    <button
      v-if="actionLabel"
      type="button"
      class="btn btn-primary btn-sm es-action"
      @click="$emit('action')"
    >{{ actionLabel }}</button>
  </div>
</template>

<script setup>
import Icon from './Icon.vue'

defineProps({
  /** 空态图标名（Icon.vue 的 ICONS 表）。传空串则不显示图标，兼容纯文字空态 */
  icon: { type: String, default: 'inbox' },
  /** 标题（粗体，可选） */
  title: { type: String, default: '' },
  /** 描述（次要文字，可选） */
  desc: { type: String, default: '' },
  /** 底部动作按钮文案（可选，不传则不显示按钮） */
  actionLabel: { type: String, default: '' },
})
defineEmits(['action'])
</script>

<style scoped>
/* 只补「全局 .state-empty 没有」的三段样式，其余（居中/padding/主文字色）复用全局 */
.es-title { font-size: 14px; font-weight: 600; color: var(--t1); }
.es-desc { margin-top: 6px; font-size: 13px; color: var(--t3); line-height: 1.6; }
.es-action { margin-top: 16px; }
</style>
