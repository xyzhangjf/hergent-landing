<template>
  <!-- v671：全站统一的「全选 / 取消全选」三态复选框 —— **唯一源**。
       原型 = 本期预报编辑态序号列那颗（v615），此前只存在于 Forecast.vue 的模板里，
       其它页面各自复刻 ⇒ 视觉与文案必然漂移。现在上提为本件，全站共用一份。

       🔴 两条硬判据（都踩过，改前先看 tests/colmenu-sync.contract.mjs）：
       ① 必须用 `@change` 且**不要** preventDefault —— Chrome 的 pre-click activation
          会先翻转 DOM 的 checked 再派发 click，`preventDefault()` 之后浏览器在派发
          结束时把翻转**还原**回去，而 Vue 的 patch 只写翻转前的值 ⇒ 勾选态与实际
          状态永久相反，只有重建节点（重开面板）才对齐。
       ② 半选用浏览器原生 `:indeterminate.prop`（不是自绘方块）—— 原生三态在
          Windows/Mac 各主题下都跟系统一致，自绘必然在某个主题下看不出半选。

       🔴 本件只服务「多选场景的全选」：单选、开关、列显隐、权限矩阵各有自己的
          语义与锁定规则，**不要**拿它去替换（v350/v510 的教训：一次改多个勾是危险的）。 -->
  <input
    type="checkbox"
    class="row-pick sa-cb"
    :checked="checked"
    :indeterminate.prop="indeterminate"
    :disabled="disabled"
    :title="tip"
    :aria-label="ariaLabel || tip"
    @change="onChange"
  >
</template>

<script setup>
import { computed, nextTick } from 'vue'

const props = defineProps({
  /** 当前范围内是否已全选 */
  checked: { type: Boolean, default: false },
  /** 是否部分选中（半选）。全选为真时本值被忽略，由调用方保证互斥 */
  indeterminate: { type: Boolean, default: false },
  /** 无可选项时禁用（= 空列表不给出"点一下什么都没发生"的假交互） */
  disabled: { type: Boolean, default: false },
  /** 参与全选的条目数 —— 仅用于拼默认提示文案 */
  count: { type: Number, default: 0 },
  /** 量词：行 / 项 / 个门店 / 个品牌 … 默认「行」 */
  unit: { type: String, default: '行' },
  /** 覆盖默认提示（调用方有更准确的说法时给） */
  title: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['toggle'])

const tip = computed(() => {
  if (props.title) return props.title
  if (props.disabled || !props.count) return `当前没有可选择的${props.unit}`
  return `全选/取消当前显示的 ${props.count} ${props.unit}`
})

function onChange(e) {
  const want = !!e.target.checked
  emit('toggle', want)
  /* 兜底：若调用方因为「全禁用 / 范围为空」没有真的改状态，把 DOM 翻回来 ——
     否则会出现「框是勾上的、但一条都没选」。nextTick 时 props 已是新值。 */
  nextTick(() => {
    if (e.target && e.target.checked !== props.checked) e.target.checked = props.checked
  })
}
</script>
