<!--
  已停用记录的显式展开开关（v713）——「显示已停用（N）」。

  ## 为什么抽成组件
  同款控件在 7 个页面出现（报单对象/商品/员工/品牌/价格通道/告警规则/买赠）。
  各页自己写一份的结果就是：几何不一致、有的带计数有的不带、窄屏换行后会孤立靠右。
  这里把 v712 踩过的坑全部固化进去。

  ## 为什么是「纯受控」组件
  它只管 UI（`v-model` + `count`），**不碰数据**。因为两种数据源形态都存在：
    · 全量常驻的页面 → 配合 `useInactiveFilter` 做纯前端过滤（切换零请求）；
    · 服务端分页的页面（商品档案）→ 父组件把 `v-model` 接到自己的查询参数上。
  组件若自作主张去 filter，第二种页面会被写坏（停用记录混进某一页、total 对不上）。

  ## 🔴 三条必须守住的实现细节（每条都对应一次真实事故）
  1. **`@change` + 单向 `:checked`，绝不 `@click.prevent`**（v677）：
     `@click.prevent` 会取消原生激活行为，勾选态与真值永久相反；且 Vue 不会重置 DOM 的
     checked，所以连"下次点击能纠正"的机会都没有。
  2. **文字必须包 `<span>`**（v708）：flex 容器里的裸文本是匿名 flex item，空间不足时会被
     压到 1 字宽 ⇒ 逐字竖排（顶栏「张/俊/峰」就是这么来的）。包 span 才能配合 nowrap。
  3. **不给 span 写 `line-height` 数值**（v710）：写 `1` 会把行盒压到与字号同高、字形上浮
     0.5px；写具体数值等于在字体度量上赌一次。不写即可，`align-items:center` 负责居中。

  ## 🔴 `count === 0` 时不渲染
  一个「显示已停用（0）」的开关是纯噪音。由组件自己判，避免 7 个调用方各写一遍 `v-if`
  而且漏写一两处。
-->
<template>
  <label
    v-if="count > 0"
    class="tb-toggle"
    :class="[{ on: modelValue }, align === 'end' ? 'is-end' : '']"
    :title="title"
  >
    <input
      type="checkbox"
      :checked="modelValue"
      @change="$emit('update:modelValue', $event.target.checked)"
    >
    <span class="tb-toggle-txt">显示已停用（{{ count }}{{ unit ? ' ' + unit : '' }}）</span>
  </label>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 停用记录条数。**为 0 时整个控件不渲染**（见文件头）。 */
  count: { type: Number, default: 0 },
  /** 量词：条 / 个品牌 / 个商品（拼在计数后面，非技术用户读起来更像人话） */
  unit: { type: String, default: '' },
  /** `end` = 在工具行里靠右推（默认）；`inline` = 跟在一排筛选控件后面 */
  align: { type: String, default: 'end' },
  titleOn: { type: String, default: '' },
  titleOff: { type: String, default: '' },
})

defineEmits(['update:modelValue'])

const title = computed(() => {
  if (props.modelValue) {
    return props.titleOn || '收起已停用的记录（它们不会被删除，随时可以再显示）'
  }
  return props.titleOff || '把已停用的记录一并列出来（默认不展示，不影响它们的启用/编辑）'
})
</script>

<style scoped>
/* 几何照抄 `Forecast.vue` 的 `.tb-toggle`（「显示全部商品」「显示空列」用的就是这套）：
   同行的 `.btn-sm` 也是 32 高 / 13px / radius-sm，两者并排时顶边与高度都该是 0 差。
   🔴 不写成 `.btn` 那一档（36 高 / 14px / radius-md）—— 那是主操作按钮，是主次分级差，不是错位。 */
.tb-toggle{
  display:inline-flex;align-items:center;gap:var(--sp-h6);
  font-size:var(--fs-base);font-weight:500;color:var(--t1);
  background:transparent;border:1px solid var(--bd);border-radius:var(--radius-sm);
  height:32px;padding:0 var(--sp-3);white-space:nowrap;cursor:pointer;user-select:none;
  flex:0 0 auto;
}
.tb-toggle:hover{background:var(--bg2)}
.tb-toggle input{width:14px;height:14px;accent-color:var(--p);cursor:pointer;flex:0 0 auto}
/* 文字包了 span 才压得住：裸文本在 flex 里会被挤成 1 字宽逐字换行（v708）。
   🔴 这里**不写 line-height 数值**：写 1 会让字形上浮 0.5px，写 px 等于赌字体度量（v710）。 */
.tb-toggle-txt{white-space:nowrap}
/* 打开态高亮：那颗 14px 复选框太小，不额外染色的话「现在开着还是关着」要靠找勾 */
.tb-toggle.on{background:var(--p-bg);border-color:var(--p);color:var(--p-ink)}

/* 靠右推。🔴 窄屏换行后 `margin-left:auto` 会把控件推到第二行的**最右边**孤零零浮着
   （v712 实测 375 下左边空出 205px）—— 换行即意味着「右对齐」已失效，改左对齐。 */
.tb-toggle.is-end{margin-left:auto}
@media (max-width: 480px) {
  .tb-toggle.is-end{margin-left:0}
}
</style>
