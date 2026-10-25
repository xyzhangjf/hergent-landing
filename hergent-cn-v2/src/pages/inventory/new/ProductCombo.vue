<script setup>
/* 商品「名称 + 条码」模糊查找组合框（行内 per-row 状态自管理）。
   与供应商 / 客户组合框同一范式：本地 includes 匹配（商品全量由父页拉全）、
   键盘 ↑/↓/Enter/Esc、li 用 mousedown.prevent 防 input blur 掉下拉。
   选中后 emit('pick', row, product)，由父页的 onPick 负责带出单位 / 单价等。
   🔴 样式随组件 scoped（`.ipn-prod-*` 不会泄漏到其它页面）；与采购建单页
      `PurchaseOrderForm.vue` 里的同名组合框视觉一致、但各自独立（不共享实例）。
   🔴 只做「搜 + 选」，不做「带出」—— 带出逻辑留在父页 onPick，避免把四套
      业务口径（采购价 / 售价 / 退货价 / 调拨无价）塞进一个组件里。 */
import { ref, computed } from 'vue'

const props = defineProps({
  row: { type: Object, required: true },
  products: { type: Array, required: true },
})
const emit = defineEmits(['pick'])

const editing = ref(false)
const kw = ref('')
const active = ref(0)

const vFocus = { mounted: el => { try { el.focus() } catch (_) {} } }

const matches = computed(() => {
  const q = (kw.value || '').trim().toLowerCase()
  const list = Array.isArray(props.products) ? props.products : []
  if (!q) return list.slice(0, 50)
  return list.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.barcode || '').toLowerCase().includes(q)
  ).slice(0, 50)
})

function currentName () {
  const p = (props.products || []).find(x => Number(x.id) === Number(props.row.product_id))
  return p ? p.name : ''
}

function open () {
  kw.value = currentName()
  active.value = 0
  editing.value = true
}
function onKw (e) { kw.value = e.target.value; active.value = 0 }
function move (d) {
  const m = matches.value; const n = m.length
  if (!n) return
  let i = active.value + d
  if (i < 0) i = n - 1
  if (i >= n) i = 0
  active.value = i
}
function choose (p) {
  if (!p) return
  props.row.product_id = p.id
  kw.value = ''
  editing.value = false
  emit('pick', props.row, p)
}
function onEnter () {
  const m = matches.value
  if (m.length) choose(m[active.value] || m[0])
}
function onBlur () { editing.value = false }
</script>

<template>
  <div class="ipn-prod-combo">
    <input v-if="editing" :value="kw" class="input ipn-in" placeholder="输入名称或条码搜索"
           v-focus @input="onKw"
           @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
           @keydown.enter.prevent="onEnter" @keydown.esc.prevent="onBlur"
           @blur="onBlur" />
    <ul v-if="editing && matches.length" class="ipn-prod-list">
      <li v-for="(p, i) in matches" :key="p.id" :class="{ active: i === active }"
          @mousedown.prevent="choose(p)" @mouseenter="active = i">
        <span class="ipn-prod-name">{{ p.name }}</span>
        <span v-if="p.barcode" class="ipn-prod-bar">{{ p.barcode }}</span>
      </li>
    </ul>
    <div v-else-if="editing && kw && !matches.length" class="ipn-prod-empty">没有匹配的商品</div>
    <span v-else class="ipn-v" :class="{ 'is-ph': !row.product_id }" tabindex="0"
          @click="open" @keydown.enter.prevent="open">{{ currentName() }}</span>
  </div>
</template>

<style scoped>
.ipn-prod-combo { position: relative; width: 100%; min-width: 0 }
.ipn-prod-combo .ipn-in { width: 100% }
.ipn-prod-list {
  position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 30;
  margin: 0; padding: 4px; list-style: none; max-height: 260px; overflow-y: auto;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-sm);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .12);
}
.ipn-prod-list li {
  display: flex; align-items: center; gap: 8px; padding: 4px 8px;
  border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--t1);
}
.ipn-prod-list li.active, .ipn-prod-list li:hover { background: var(--bg2) }
.ipn-prod-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipn-prod-bar { flex: none; font-size: 12px; color: var(--t3); font-variant-numeric: tabular-nums }
.ipn-prod-empty {
  position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 30;
  padding: 8px 10px; font-size: 13px; color: var(--t3);
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-sm);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .12);
}
/* v680：文本态高度 20px → **18px**，与基准页「新建采购订单」的 `.ipn-v` 逐值一致
   （规范 §R.2「明细格文本态 = 18px」，紧凑档 16px）。
   🔴 为什么改：ProductCombo 被采购退货 / 自提 / 车销 / 调拨四个建单页共用，
      它的 `.ipn-v` 是**组件自带**的 scoped 规则，页面级 CSS 改不动它 ——
      拆页时从基准页抄结构没抄到这个数值，于是四页的商品格比基准页高 2px。
      ⚠️ 这 2px 平时不显形（行高由操作列的 26px 按钮决定），但它让"文本态 18px"
         这条规范在四页上名存实亡。 */
.ipn-v {
  display: block; width: 100%; min-height: 18px; line-height: 18px;
  font-size: 13px; color: var(--t1); cursor: pointer; outline: none;
}
/* 紧凑档再收一档（与基准页同口径：18 → 16） */
[data-density="compact"] .ipn-v { min-height: 16px; line-height: 16px }
.ipn-v.is-ph { color: var(--t3) }
.ipn-v:focus, .ipn-v:hover { box-shadow: inset 0 0 0 1px var(--bd); border-radius: 4px }
</style>
