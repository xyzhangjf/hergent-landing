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
/* v685：候选「可辨识 + 可用优先」——同名档案不再长得一模一样（唯一实现在 productPick.js）。
   生产实测 130 组重名里 119 组是「一条多档、其余单档无价」，点错就表现为「单位不能选」。 */
import { pickMatches, pickBadge, pickSummary } from './productPick.js'

const props = defineProps({
  row: { type: Object, required: true },
  products: { type: Array, required: true },
  /* v686：**未选供应商/客户时锁定本格**（老板口径 2026-10-25：没选往来单位就不许挑商品，
     也不许开单）。锁定时不进入搜索态，改为 emit('blocked') 让父页给一句可读的提示 ——
     「点了没反应」是最容易被当成 bug 的交互，所以这里**必须**有出声的地方。
     ⚠️ 这是**真拦截**（不是 v684 那种「只提醒」），所以放在交互入口上是对的；
        但它不参与 `validate()` 的必填判定 —— 校验里另有一条「请先选择供应商/客户」。 */
  disabled: { type: Boolean, default: false },
  /** 锁定时占位文案。父页按单据类型传「先选供应商」/「先选客户」。 */
  disabledHint: { type: String, default: '请先选择往来单位' },
})
const emit = defineEmits(['pick', 'blocked'])

const editing = ref(false)
const kw = ref('')
const active = ref(0)

const vFocus = { mounted: el => { try { el.focus() } catch (_) {} } }

const matches = computed(() => pickMatches(props.products, kw.value, 50))

function currentName () {
  const p = (props.products || []).find(x => Number(x.id) === Number(props.row.product_id))
  return p ? p.name : ''
}

function open () {
  /* v686：未选往来单位 ⇒ 不进搜索态，出声提示（见 props.disabled 注释）。 */
  if (props.disabled) { emit('blocked'); return }
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
          :title="pickSummary(p)"
          @mousedown.prevent="choose(p)" @mouseenter="active = i">
        <span class="ipn-prod-name">{{ p.name }}</span>
        <!-- v685：档位徽标 —— 同名档案的唯一区分点（多档 `杯·组·件` / 单档 `仅件` / 无价标红） -->
        <span class="ipn-prod-tier" :class="{ 'is-muted': pickBadge(p).muted, 'is-warn': pickBadge(p).warn }">
          {{ pickBadge(p).text }}<template v-if="pickBadge(p).warn"> · 无价</template>
        </span>
        <span v-if="p.barcode" class="ipn-prod-bar">{{ p.barcode }}</span>
      </li>
    </ul>
    <div v-else-if="editing && kw && !matches.length" class="ipn-prod-empty">没有匹配的商品</div>
    <!-- v686：锁定态（未选供应商/客户）—— 显示「先选供应商」而不是空白，
         点一下会经 `blocked` 让父页 toast 出声。已选过商品的行**照旧显示商品名**
         （那是事实，不该被锁掉），只是不能再改。 -->
    <span v-else class="ipn-v" :class="{ 'is-ph': !row.product_id, 'is-locked': disabled }"
          :title="disabled ? disabledHint : ''" tabindex="0"
          @click="open" @keydown.enter.prevent="open">{{ row.product_id ? currentName() : (disabled ? disabledHint : '') }}</span>
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
/* v685：档位徽标。`flex:none` 且不换行 —— 它是"用来分辨同名商品"的信息，
   被省略号吃掉就等于没有。单档灰、无价红。 */
.ipn-prod-tier {
  flex: none; font-size: 11px; line-height: 16px; padding: 0 5px; border-radius: 4px;
  color: var(--t2); background: var(--bg2); font-variant-numeric: tabular-nums; white-space: nowrap;
}
.ipn-prod-tier.is-muted { color: var(--t3) }
.ipn-prod-tier.is-warn { color: var(--danger-txt, var(--war, #c0392b)) }
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
/* v686：锁定态 —— `not-allowed` 光标 + 去掉 hover 的「可点」边框（否则看起来像能点）。 */
.ipn-v.is-locked { color: var(--t3); cursor: not-allowed }
.ipn-v.is-locked:hover { box-shadow: none }
.ipn-v:focus, .ipn-v:hover { box-shadow: inset 0 0 0 1px var(--bd); border-radius: 4px }
</style>
