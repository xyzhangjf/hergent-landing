<template>
  <!-- v465e（仓配 P1）：单据明细行编辑器 —— 入库单 / 出库单 / 其它出入库单**共用一份**。
       🔴 为什么必须共用：四张单据的明细字段**逐字相同**
          （商品 / 数量 / 批次号 / 到期日 / 成本，见 `db/queries/wh.py::_clean_items`
           与 `erp_db.py::create_inbound_order` 两个后端入口）。
          各页抄一份 = 四份字段与校验，改一处漏三处；且后端只认这一种形状。
       🔴 字段集**不是拍脑袋**：`batch_no` + `expiry_date` 正是 `batch_in` 唯一会落库的两列，
          也是低温奶 FEFO / 效期预警 / 效期补录整条链的上游 ⇒ 入库侧必须能录。
       🔴 与父页的分工：本组件只管「行内编辑 + 行集合增删」，**不管提交**
          （端点、状态机、错误文案都在父页）。父页拿 `validItems()` 得到后端要的形状。 -->
  <div class="whi">
    <div class="whi-hd">
      <span class="whi-title">商品明细</span>
      <span v-if="products.length" class="whi-cnt">已选 {{ validCount }} / {{ rows.length }} 行</span>
      <button class="btn btn-ghost btn-sm" @click="addRow">
        <Icon name="plus" :size="14" />添加一行
      </button>
    </div>

    <div class="table-wrap">
      <table class="tbl whi-tbl">
        <thead>
          <tr>
            <th class="seq-th">序号</th>
            <th style="width:32%">商品</th>
            <th class="num" style="width:12%">数量</th>
            <th style="width:15%">批次号</th>
            <th style="width:16%">到期日</th>
            <th class="num" style="width:12%">单位成本</th>
            <th style="width:56px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="r._k">
            <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
            <td>
              <ProductCombo :row="r" :products="products" />
              <span v-if="unitOf(r)" class="whi-unit">{{ unitOf(r) }}</span>
            </td>
            <td class="num">
              <input v-model.number="r.quantity" class="input whi-in whi-num"
                     type="number" min="0" step="0.01" placeholder="0" />
            </td>
            <td>
              <input v-model.trim="r.batch_no" class="input whi-in" placeholder="选填" />
            </td>
            <td>
              <input v-model="r.expiry_date" class="input whi-in" type="date" />
            </td>
            <td class="num">
              <input v-model.number="r.cost" class="input whi-in whi-num"
                     type="number" min="0" step="0.01" placeholder="0" />
            </td>
            <td>
              <button class="whi-del" :disabled="rows.length <= 1"
                      :title="rows.length <= 1 ? '至少保留一行' : '删除本行'" @click="removeRow(i)">
                <Icon name="trash" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="whi-foot">
      <span v-if="hint">{{ hint }}</span>
      <span v-else>批次号与到期日会原样写进库存批次（出库 FEFO 与效期预警都依赖它）。</span>
    </p>
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import Icon from '../../components/Icon.vue'
/* 🔴 商品组合框复用进销存建单页那一份（本地模糊搜名称/条码）：
   473 个 SKU 用 `<select>` 翻不动；本仓既有四个建单页也都是它，观感同源。 */
import ProductCombo from '../inventory/new/ProductCombo.vue'

const props = defineProps({
  /** 行数组，`v-model`。每行形状 = `{_k, product_id, quantity, batch_no, expiry_date, cost}`。 */
  modelValue: { type: Array, default: () => [] },
  /** 商品全量（父页拉一次传下来，组件内本地搜索，不打接口）。 */
  products: { type: Array, default: () => [] },
  /** 底部说明文字。父页按单据类型注入（如「其它出库不过滤效期」）。 */
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const rows = computed(() => props.modelValue || [])

/* 行 key：**必须稳定唯一**，不能拿 index 当 key ——
   删中间一行时 index-key 会让 Vue 复用 DOM，输入框里的值跟着串位（静默错行）。 */
let _seq = 0
function makeRow () {
  return { _k: ++_seq, product_id: 0, quantity: null, batch_no: '', expiry_date: '', cost: null }
}

function addRow () {
  emit('update:modelValue', (props.modelValue || []).concat([makeRow()]))
}
function removeRow (i) {
  const arr = (props.modelValue || []).slice()
  arr.splice(i, 1)
  emit('update:modelValue', arr)
}

/* 🔴 保证**至少一行**：空表在弹窗里看着像"坏了"，且用户得先找「添加一行」才知道怎么开始。
   父页因此**不需要**在建单时自己塞一行（各页塞一次 = 四份初始化逻辑）。 */
onMounted(() => { if (!rows.value.length) addRow() })
watch(() => rows.value.length, n => { if (!n) addRow() })

/** 商品单位（只作展示提示，不参与提交 —— 单位口径以商品档案为准）。 */
function unitOf (r) {
  const p = props.products.find(x => Number(x.id) === Number(r.product_id))
  return (p && (p.unit || p.order_unit)) || ''
}

const validCount = computed(() => validRows().length)

function validRows () {
  return rows.value.filter(r => Number(r.product_id) > 0 && Number(r.quantity) > 0)
}

/**
 * 提交用载荷：丢掉无效行（没选商品 / 数量 ≤ 0），并统一转成后端要的类型。
 *
 * 🔴 这里**只做形状归一，不做业务校验** —— 「一行都没有」「商品不存在」「库存不足」
 *    一律由后端判（`_clean_items` 会丢无效行并明确报「请至少添加一行有效商品」）。
 *    前端再写一份"够不够"就是第二份判据，必然漂移。
 */
function validItems () {
  return validRows().map(r => ({
    product_id: Number(r.product_id),
    quantity: Number(r.quantity),
    batch_no: (r.batch_no || '').trim(),
    expiry_date: r.expiry_date || '',
    cost: Number(r.cost || 0),
  }))
}

defineExpose({ addRow, validItems, validCount })
</script>

<style scoped>
.whi { display: block }
.whi-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 8px }
.whi-title { font-size: 13px; font-weight: 600; color: var(--t2) }
.whi-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.whi-hd .btn { margin-left: auto }
.whi-cnt + .btn { margin-left: 0 }

.whi-tbl { table-layout: fixed }
.whi-tbl th { white-space: nowrap }
/* 输入框在表格里要**贴满格子**并矮一档（默认 34px 会把 6 行明细撑成两屏） */
.whi-in { width: 100%; height: 30px; padding: 0 8px; font-size: 13px }
.whi-num { text-align: right; font-variant-numeric: tabular-nums }
.whi-unit {
  display: inline-block; margin-top: 2px;
  font-size: 11px; color: var(--t3); line-height: 1.2;
}
/* 🔴 `ProductCombo` 在「未选中」时渲染的是一个**空 `<span class="ipn-v">`**（它没有 placeholder
   prop，只有 `Supplier`/`Customer` 那两个组合框有）⇒ 在本表里看着就是一个**空白单元格**，
   用户不知道那儿可以点。这里用 `:deep()` 把它做成与同排 `input.whi-in` 同款外观 +
   空态占位文案（`.is-ph` 恰好就是「没选商品」这个状态，与 span 为空一一对应）。
   ⚠️ **不改 `ProductCombo.vue` 本体**：它被进销存 4 个建单页共用（采购/退货/调拨/自提），
      给它加 prop 属于跨模块共享件变更，与本轮「避免跨模块冲突」相冲 —— 就地覆盖样式即可达到同样效果。 */
.whi :deep(.ipn-v) {
  min-height: 30px; line-height: 28px; padding: 0 8px;
  border: 1px solid var(--bd); border-radius: var(--radius-md);
  background: var(--bg3); font-size: 13px;
}
.whi :deep(.ipn-v.is-ph)::before { content: '选择商品'; color: var(--t3) }
.whi-del {
  width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: var(--radius-sm);
  color: var(--t3); cursor: pointer;
}
.whi-del:hover:not(:disabled) { background: var(--dan-bg, rgba(220, 60, 60, .1)); color: var(--dan) }
.whi-del:disabled { opacity: .35; cursor: not-allowed }
.whi-foot {
  margin-top: 8px; font-size: 12px; color: var(--t3); line-height: 1.7;
}
</style>
