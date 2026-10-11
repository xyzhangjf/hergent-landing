<!-- 客户「搜索 + 选择」合一的组合框（combobox）。
     🔴 单一来源：自提订单 / 自提退单 / 车销订单 / 车销退单四个页面（共用 `SaleDocForm.vue` 内核）
        均使用本组件，保证四页的「选择客户」与新建采购单页「选择供应商」（`SupplierCombo.vue`）
        在外观、尺寸、占位文字、下拉展示、键盘交互上**逐像素一致**。
     🔴 与 `SupplierCombo.vue` 的惟一差异：语义词「供应商 → 客户」、数据源 `suppliers → customers`、
        占位「输入名称或编号搜索供应商 → 输入名称或编号搜索客户」、空态「没有匹配的供应商 → 没有匹配的客户」。
        其余（本地按名称/编号模糊匹配、下拉点选、打字清空旧选、失焦还原已选名、键盘 ↑/↓/Enter/Esc）逐字照搬。
     🔴 为什么本地过滤、不打接口：客户全量已由 `SaleDocForm.loadRefs` 一次拉全（≤500），
        本地 includes 瞬时、无网络抖动；编号搜索要靠前端拿到 `code` 字段才能做。
     🔴 行为：输入即按「名称 或 编号」本地模糊匹配（编号来自 refs 的 `code` 字段），
        下拉直接点选；一旦开始打字 ⇒ 清空旧选择（modelValue=0），validate 才能如实反映
        「还没选」；失焦若没点选则把输入框文字还原成「当前已选客户名」，不允许留自由文本。
     🔴 下拉最多列 50 条（500 全量里筛）；键盘 ↑/↓ 移动、Enter 选中、Esc 关闭。 -->
<template>
  <div class="ipn-cust-combo" ref="comboRef">
    <input
      ref="inputRef"
      :value="custQuery"
      class="input ipn-cust-input"
      :placeholder="placeholder"
      autocomplete="off"
      @focus="onFocus"
      @input="onInput"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="enter"
      @keydown.esc.prevent="close"
      @blur="onBlur"
    />
    <ul v-if="open && matches.length" class="ipn-cust-list">
      <li
        v-for="(c, i) in matches"
        :key="c.id"
        :class="{ active: i === active }"
        @mousedown.prevent="choose(c)"
        @mouseenter="active = i"
      >
        <span class="ipn-cust-name">{{ c.name }}</span>
        <span v-if="c.code" class="ipn-cust-code">{{ c.code }}</span>
      </li>
    </ul>
    <div v-else-if="open && custQuery && !matches.length" class="ipn-cust-empty">没有匹配的客户</div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [Number, String], default: 0 },
  customers: { type: Array, default: () => [] },
  placeholder: { type: String, default: '输入名称或编号搜索客户' },
})
const emit = defineEmits(['update:modelValue'])

const custQuery = ref('')
const open = ref(false)
const active = ref(0)
const comboRef = ref(null)
const inputRef = ref(null)

const matches = computed(() => {
  const q = custQuery.value.trim().toLowerCase()
  const list = props.customers || []
  if (!q) return list.slice(0, 50)
  return list.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.code || '').toLowerCase().includes(q)
  ).slice(0, 50)
})

function selectedName () {
  const c = (props.customers || []).find(x => Number(x.id) === Number(props.modelValue))
  return c ? c.name : ''
}

// 外部回填（编辑 / 复制带出原单）⇒ 同步输入框文字成「当前已选客户名」
watch(() => props.modelValue, () => { custQuery.value = selectedName() })

function onFocus () { open.value = true; active.value = 0 }
function onInput (e) {
  // 打字 = 重新搜索 ⇒ 清掉旧选择，避免「框里写着 A、实际选着 B」的错配
  custQuery.value = e.target.value
  emit('update:modelValue', 0)
  open.value = true
  active.value = 0
}
function onBlur () {
  // 还原成当前已选客户名（没选就空着），不让自由文本残留
  custQuery.value = selectedName()
  open.value = false
}
function move (d) {
  if (!open.value) { open.value = true; return }
  const n = matches.value.length
  if (!n) return
  active.value = (active.value + d + n) % n
}
function enter () {
  const c = matches.value[active.value]
  if (c) choose(c)
}
function choose (c) {
  if (!c) return
  emit('update:modelValue', c.id)
  custQuery.value = c.name
  open.value = false
}
function close () { open.value = false }

defineExpose({ focus: () => inputRef.value && inputRef.value.focus() })
</script>

<style scoped>
.ipn-cust-combo { position: relative; flex: 1; min-width: 0 }
.ipn-cust-input { width: 100%; height: 32px; padding: 0 10px }
.ipn-cust-list {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
  margin: 0; padding: 4px; list-style: none; max-height: 240px; overflow-y: auto;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipn-cust-list li {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--t1);
}
.ipn-cust-list li.active, .ipn-cust-list li:hover { background: var(--bg2) }
.ipn-cust-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipn-cust-code { flex: none; font-size: 12px; color: var(--t3); font-variant-numeric: tabular-nums }
.ipn-cust-empty {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
  padding: 10px; background: var(--bg); border: 1px solid var(--bd);
  border-radius: var(--radius-md); box-shadow: var(--shadow-md); font-size: 12px; color: var(--t3);
}
</style>
