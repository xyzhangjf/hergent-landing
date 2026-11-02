<template>
  <!-- 统一折叠卡：报单配置页「运行参数」区的三块（报单自动化 / 报单提醒 / 模板参数）
       共用同一形态 —— 折叠头始终显示 标题 + 状态芯片 + 一句话摘要，展开才显详情。
       复用 variables.css 令牌，深色模式自动适配；外部用 v-model 控制开合。 -->
  <div class="cfg-card" :class="{ collapsed: !isOpen }">
    <div class="cfg-hd" @click="toggle">
      <div class="cfg-titles">
        <b class="cfg-title">{{ title }}</b>
        <span v-if="subtitle" class="cfg-sub">{{ subtitle }}</span>
      </div>
      <div class="cfg-side">
        <slot name="chip" />
        <slot name="summary" />
        <span class="cfg-toggle">
          <Icon :name="isOpen ? 'chevron-up' : 'chevron-down'" />
        </span>
      </div>
    </div>
    <div v-show="isOpen" class="cfg-body">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Icon from '../Icon.vue'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  modelValue: { type: Boolean, default: true }, // 开合状态（v-model）
})
const emit = defineEmits(['update:modelValue'])
const isOpen = computed(() => props.modelValue)
function toggle() { emit('update:modelValue', !isOpen.value) }
</script>

<style scoped>
.cfg-card{
  margin-bottom:var(--sp-3);padding:0;overflow:hidden;
  background:var(--bg);border:1px solid var(--border-subtle);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);
  transition:box-shadow var(--dur-base) ease,border-color var(--dur-base) ease;
}
.cfg-card:hover{box-shadow:var(--shadow-md);border-color:var(--bd)}
.cfg-hd{
  display:flex;align-items:center;gap:var(--sp-h10);padding:11px var(--sp-4);cursor:pointer;flex-wrap:wrap;
  user-select:none;
}
.cfg-titles{display:flex;flex-direction:column;gap:var(--sp-h2);min-width:0}
.cfg-title{font-size:var(--fs-base);font-weight:600;color:var(--t1)}
.cfg-sub{font-size:var(--fs-sm);color:var(--t3);line-height:var(--lh-tight)}
.cfg-side{
  display:flex;align-items:center;gap:var(--sp-2);margin-left:auto;flex-wrap:wrap;justify-content:flex-end;
}
.cfg-toggle{color:var(--p-ink);display:inline-flex;align-items:center}
.cfg-toggle :deep(svg){width:16px;height:16px}
.cfg-body{padding:0 var(--sp-4) var(--sp-4);border-top:1px solid var(--border-subtle)}

/* ⚠️ chip / summary 由父组件经 slot 传入，其元素带父组件 scope，必须用 :deep 穿透样式化 */
/* 状态芯片：on=绿（已开启/自动），off=灰（已关闭/手动），warn=琥珀（异常提示） */
.cfg-side :deep(.cfg-chip){font-size:var(--fs-xs);padding:1px 9px;border-radius:var(--radius-sm);font-weight:500;white-space:nowrap}
.cfg-side :deep(.cfg-chip.on){background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.cfg-side :deep(.cfg-chip.off){background:var(--bg2);color:var(--t3)}
.cfg-side :deep(.cfg-chip.warn){background:rgba(var(--war-rgb),.12);color:var(--war);border:1px solid rgba(var(--war-rgb),.35)}
.cfg-side :deep(.cfg-summary){font-size:var(--fs-sm);color:var(--t2);line-height:var(--lh-tight)}
</style>
