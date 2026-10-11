<!-- 供应商「搜索 + 选择」合一的组合框（combobox）。
     🔴 单一来源：采购订单页 / 采购退货单页（不挂原单模式）共用本组件，
        保证两页的供应商输入框在外观、尺寸、占位文字、下拉展示、键盘交互上**逐像素一致**。
     🔴 为什么本地过滤、不打接口：供应商全量已由各页 `loadRefs` 一次拉全（≤500），
        本地 includes 瞬时、无网络抖动；编号搜索要靠前端拿到 `code` 才能做。
     🔴 行为：输入即按「名称 或 编号」本地模糊匹配（编号来自 refs 的 `code` 字段），
        下拉直接点选；一旦开始打字 ⇒ 清空旧选择（modelValue=0），validate 才能如实反映
        「还没选」；失焦若没点选则把输入框文字还原成「当前已选供应商名」，不允许留自由文本。
     🔴 下拉最多列 50 条（500 全量里筛）；键盘 ↑/↓ 移动、Enter 选中、Esc 关闭。
     🔴 外部回填（编辑 / 复制带出原单）⇒ 通过 watch modelValue 同步输入框文字。 -->
<template>
  <div class="ipn-sup-combo" ref="comboRef">
    <input
      ref="inputRef"
      :value="supQuery"
      class="input ipn-sup-input"
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
    <ul v-if="open && matches.length" class="ipn-sup-list">
      <li
        v-for="(s, i) in matches"
        :key="s.id"
        :class="{ active: i === active }"
        @mousedown.prevent="choose(s)"
        @mouseenter="active = i"
      >
        <span class="ipn-sup-name">{{ s.name }}</span>
        <span v-if="s.code" class="ipn-sup-code">{{ s.code }}</span>
      </li>
    </ul>
    <div v-else-if="open && supQuery && !matches.length" class="ipn-sup-empty">没有匹配的供应商</div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [Number, String], default: 0 },
  suppliers: { type: Array, default: () => [] },
  placeholder: { type: String, default: '输入名称或编号搜索供应商' },
})
const emit = defineEmits(['update:modelValue'])

const supQuery = ref('')
const open = ref(false)
const active = ref(0)
const comboRef = ref(null)
const inputRef = ref(null)

const matches = computed(() => {
  const q = supQuery.value.trim().toLowerCase()
  const list = props.suppliers || []
  if (!q) return list.slice(0, 50)
  return list.filter(s =>
    (s.name || '').toLowerCase().includes(q) ||
    (s.code || '').toLowerCase().includes(q)
  ).slice(0, 50)
})

function selectedName () {
  const s = (props.suppliers || []).find(x => Number(x.id) === Number(props.modelValue))
  return s ? s.name : ''
}

// 外部回填（编辑 / 复制带出原单）⇒ 同步输入框文字成「当前已选供应商名」
watch(() => props.modelValue, () => { supQuery.value = selectedName() })

function onFocus () { open.value = true; active.value = 0 }
function onInput (e) {
  // 打字 = 重新搜索 ⇒ 清掉旧选择，避免「框里写着 A、实际选着 B」的错配
  supQuery.value = e.target.value
  emit('update:modelValue', 0)
  open.value = true
  active.value = 0
}
function onBlur () {
  // 还原成当前已选供应商名（没选就空着），不让自由文本残留
  supQuery.value = selectedName()
  open.value = false
}
function move (d) {
  if (!open.value) { open.value = true; return }
  const n = matches.value.length
  if (!n) return
  active.value = (active.value + d + n) % n
}
function enter () {
  const s = matches.value[active.value]
  if (s) choose(s)
}
function choose (s) {
  if (!s) return
  emit('update:modelValue', s.id)
  supQuery.value = s.name
  open.value = false
}
function close () { open.value = false }

defineExpose({ focus: () => inputRef.value && inputRef.value.focus() })
</script>

<style scoped>
.ipn-sup-combo { position: relative; flex: 1; min-width: 0 }
.ipn-sup-input { width: 100%; height: 32px; padding: 0 10px }
.ipn-sup-list {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
  margin: 0; padding: 4px; list-style: none; max-height: 240px; overflow-y: auto;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipn-sup-list li {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--t1);
}
.ipn-sup-list li.active, .ipn-sup-list li:hover { background: var(--bg2) }
.ipn-sup-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipn-sup-code { flex: none; font-size: 12px; color: var(--t3); font-variant-numeric: tabular-nums }
.ipn-sup-empty {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
  padding: 10px; background: var(--bg); border: 1px solid var(--bd);
  border-radius: var(--radius-md); box-shadow: var(--shadow-md); font-size: 12px; color: var(--t3);
}
</style>
