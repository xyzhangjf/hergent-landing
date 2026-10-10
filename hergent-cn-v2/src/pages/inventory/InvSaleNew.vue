<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div class="isn-hd-t">
        <h2>{{ pageTitle }}</h2>
        <span v-if="pageSub" class="page-sub">{{ pageSub }}</span>
      </div>
      <div class="isn-acts">
        <!-- 附件入口：本页**刻意不给**。采购建单页那一个靠
             `/api/psi/purchase-orders/{id}/attachments` 四个带归属校验的端点；
             销售单这条路**还没有**对应端点 ⇒ 放一个按钮就是假入口（点了必然失败）。
             先不做，而不是做个假的。见《进销存建单页开发规范》§9 落地对照表。 -->
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
        <button v-if="!isReturn" class="btn btn-primary btn-sm" :disabled="saving" @click="submit('save')">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ══ 退货模式：原销售单 + 只读的客户 / 仓库 / 原单状态 ═══════════════════
         为什么退货页**长在销售建单页里**（`?kind=return`）而不是另开一页：
         「退货」与「销售」共用同一套页面骨架、基础资料与明细表样式，另开一页等于把它们
         再抄一份（本仓铁律：同一条规则抄多份 ⇒ 漏抄那份整页崩）。
         ⚠️ 两套内容的**列与校验差异很大**（退货不能挑商品、不能改客户 / 仓库，
            要选原单），所以模板里是两条并列分支，而不是一堆 `v-if` 混在一张表上。
         退货**必须**挂一张原销售单 —— 后端 `return_order_create` 要用它取客户与仓库，
         所以这里不是"可选的关联"，而是整张单据的入口：没选原单就没有可退明细。 -->
    <div v-if="isReturn" class="isn-hd isn-hd-flat">
      <div class="isn-f isn-f-so">
        <label class="isn-lb"><span class="isn-req">*</span>原销售单</label>
        <div class="isn-pick">
          <input v-model.trim="soKw" class="input isn-kw" placeholder="单号 / 客户"
                 @keyup.enter="loadSoOptions" />
          <select v-model.number="fromSo" class="input isn-sel" @change="onPickSo">
            <option :value="0" disabled>请选择原销售单</option>
            <option v-for="o in soMatches" :key="o.id" :value="o.id">
              {{ o.order_no || ('#' + o.id) }} · {{ o.customer_name || '—' }} · {{ soStatusText(o.status) }}
            </option>
          </select>
        </div>
        <div class="isn-hint">
          只列出<b>发过货</b>的单（已发货 / 已签收）；草稿、待确认的还没有货可退，不在这里。
          <template v-if="soLoading"> 正在读取…</template>
          <template v-else>
            已载入 <b>{{ soOptions.length }}</b> 张，共 {{ soTotal }} 张<template v-if="soTruncated">（只列最新的 {{ soOptions.length }} 张）</template>。
            上面的输入框是在<b>已载入的这批</b>里按单号 / 客户名筛，不会重新查一遍。
          </template>
        </div>
      </div>
      <div class="isn-f">
        <label class="isn-lb">客户</label>
        <span class="isn-ro">{{ retOrder ? (retOrder.customer_name || '—') : '—' }}</span>
      </div>
      <div class="isn-f">
        <label class="isn-lb">退货仓库</label>
        <span class="isn-ro">{{ retOrder ? (retOrder.warehouse_name || '—') : '—' }}</span>
      </div>
      <div class="isn-f">
        <label class="isn-lb">原单状态</label>
        <span class="isn-ro">{{ retOrder ? soStatusText(retOrder.status) : '—' }}</span>
      </div>
    </div>

    <!-- 退货模式的读数条（与销售单那条位置一致：合计在右） -->
    <div v-if="isReturn" class="isn-strip">
      <span class="isn-si">
        <span class="isn-sk">可退商品</span>
        <b>{{ retRows.length }} 项<template v-if="retDoneCount">（{{ retDoneCount }} 项已退完）</template></b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">本次退货</span><b>{{ retActiveCount }} 项</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">退货金额</span><b class="isn-strip-amt">¥{{ fmtMoney(retTotal) }}</b>
      </span>
    </div>

    <!-- 退货明细：商品 / 单位由后端的可退预览**给定**，用户只填「退多少」。
         🔴 商品列不可选 —— 能退的只有这张单卖过的货；给个商品下拉等于允许退没卖过的东西。
         🔴 本表**没有**「发货批次 / 效期」列：销售明细表不落换算比，也不按批次退货
            （`return_order_create` 做的是数量级库存回增，批次级还原属 RMA 的职责）。 -->
    <div v-if="isReturn" class="isn-body">
      <div class="isn-bar">
        <b>退货明细</b>
        <div class="isn-ret-quick">
          <button class="btn btn-ghost btn-sm" :disabled="!canReturn" @click="fillAll">全部可退</button>
          <button class="btn btn-ghost btn-sm" :disabled="!canReturn" @click="clearAll">清零</button>
        </div>
      </div>

      <p class="isn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>{{ retNote }}</span>
      </p>

      <div v-if="retLoading" class="state-empty">正在读取这张单的可退明细…</div>
      <div v-else-if="retError" class="state-error"><p>{{ retError }}</p></div>
      <div v-else-if="!fromSo" class="state-empty">先在上面选一张原销售单。</div>
      <div v-else-if="!canReturn" class="state-empty">{{ retBlockReason }}</div>

      <div v-else class="table-wrap">
        <table class="tbl isn-tbl isn-ret-tbl">
          <thead>
            <tr>
              <th class="seq-th">序号</th>
              <th class="isn-c-prod" :style="retW('prod')">商品<ColResizeHandle col="prod" :start="retResize" :reset="retReset" /></th>
              <th class="isn-ret-unit" :style="retW('unit')">单位<ColResizeHandle col="unit" :start="retResize" :reset="retReset" /></th>
              <th class="num isn-c-stk" :style="retW('dlv')">已发货<ColResizeHandle col="dlv" :start="retResize" :reset="retReset" /></th>
              <th class="num isn-c-stk" :style="retW('ret')">已退<ColResizeHandle col="ret" :start="retResize" :reset="retReset" /></th>
              <th class="num isn-c-stk" :style="retW('can')">可退<ColResizeHandle col="can" :start="retResize" :reset="retReset" /></th>
              <!-- v444：必填项统一红 `*`（与表单头「客户」同一枚 `.isn-req`），
                   判据 = `validateReturn()` 里实际拦的字段。 -->
              <th class="num isn-c-qty" :style="retW('qty')"><span class="isn-req">*</span>退货数量<ColResizeHandle col="qty" :start="retResize" :reset="retReset" /></th>
              <th class="num isn-c-price" :style="retW('price')">退货单价<ColResizeHandle col="price" :start="retResize" :reset="retReset" /></th>
              <th class="num isn-c-amt" :style="retW('amt')">退货金额<ColResizeHandle col="amt" :start="retResize" :reset="retReset" /></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in retRows" :key="row.product_id + '-' + i">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td class="isn-c-prod">
                {{ row.product_name || '—' }}
                <!-- 原单那一行的数量：本页没有任何换算（销售明细表无换算比列），
                     这一行只是让用户确认「退的是哪一笔」，不参与计算。 -->
                <div v-if="row.quantity" class="isn-conv">原单 {{ fmtQty(row.quantity) }} {{ row.unit || '' }}</div>
              </td>
              <td class="isn-ret-unit">{{ row.unit || '—' }}</td>
              <td class="num isn-c-stk">{{ fmtQty(row.delivered_qty) }}</td>
              <td class="num isn-c-stk">{{ fmtQty(row.returned_qty) }}</td>
              <td class="num isn-c-stk"><b>{{ fmtQty(row.returnable_qty) }}</b></td>
              <td class="isn-c-qty">
                <input v-model="row.ret_qty" class="input isn-in num" inputmode="decimal"
                       :disabled="!Number(row.returnable_qty)" />
              </td>
              <td class="isn-c-price">
                <input v-model="row.ret_price" class="input isn-in num" inputmode="decimal" />
              </td>
              <td class="num isn-amt">¥{{ fmtMoney(retRowAmount(row)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="isReturn" class="isn-bottom">
      <span class="isn-total">退货合计 <b>¥{{ fmtMoney(retTotal) }}</b></span>
      <input v-model.trim="retReason" maxlength="200" class="input isn-ret-reason"
             placeholder="退货原因（选填，如：破损 / 临期 / 多订）" />
      <div class="isn-save">
        <button class="btn btn-primary btn-sm" :disabled="saving || !canReturn" @click="submitReturn">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存退货单' }}
        </button>
      </div>
    </div>

    <!-- ══ 订单模式：表单头（对齐「创建采购订单」的框式字段）═══════════════════
         v442：外层挂 `isn-hd-box` —— 每格渲染成**舟谱那样的字段框**：描边框内左侧是
         标签、右侧是值（原为标签在框外、框在下一行）。见 `.isn-hd-box` 样式块。 -->
    <div v-if="!isReturn" class="isn-hd isn-hd-flat isn-hd-box">
      <div class="isn-f">
        <label class="isn-lb"><span class="isn-req">*</span>客户</label>
        <input v-model.trim="custKw" class="input isn-kw" placeholder="输入名称搜索客户"
               @keyup.enter="loadCustomers" />
        <select v-model.number="form.customer_id" class="input isn-sel">
          <option :value="0" disabled>请选择客户</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <!-- 出货方式 —— 由 URL 的 `?type=` 预置（见脚本处注释），仍可改。
           🔴 未知 `type` 一律落回自提（与后端默认值一致，不把脏 query 传下去）。 -->
      <div class="isn-f">
        <label class="isn-lb">出货方式</label>
        <select v-model="form.order_type" class="input isn-sel">
          <option v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb"><span class="isn-req">*</span>出货仓库</label>
        <select v-model.number="form.warehouse_id" class="input isn-sel">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb">交货日期</label>
        <input type="date" v-model="form.delivery_date" class="input isn-date" />
      </div>
      <!-- v442：撤掉「交货地址」与「备注」框里的「选填」小字（对齐采购建单页：
           无红 `*` 即选填是通行读法，与「有 `*` ＝必填」配成一对）。 -->
      <div class="isn-f">
        <label class="isn-lb">交货地址</label>
        <input v-model.trim="form.delivery_address" class="input isn-addr" />
      </div>
      <div class="isn-f isn-f-grow">
        <label class="isn-lb">备注</label>
        <input v-model.trim="form.note" maxlength="200" class="input isn-note-in" />
      </div>
    </div>

    <!-- 客户信息条：选中客户后才出现（空态下「客户:未选择 / 已录 0 项 / 合计 ¥0」
         与上方表单、明细标题行、底部合计**三处重复**，白占一行）。
         ⚠️ 「信用额度」是**参照值，不是闸门**：真正的超额度拦截在后端
            （`routers/sales.py::create_sale` 读实时未清应收）。这里显示 `—` 表示
            「档案没设」，**不要**把它当 0 显示（0 会被读成「一点额度都没有」）。 -->
    <div v-if="!isReturn && selCustomer" class="isn-strip">
      <span class="isn-si">
        <span class="isn-sk">客户</span><b>{{ selCustomer.name }}</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">信用额度</span>
        <b class="isn-strip-amt">{{ Number(selCustomer.credit_limit) > 0 ? '¥' + fmtMoney(selCustomer.credit_limit) : '—' }}</b>
      </span>
      <span v-if="Number(selCustomer.credit_days) > 0" class="isn-si">
        <span class="isn-sk">账期</span><b>{{ Number(selCustomer.credit_days) }} 天</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">出货方式</span><b>{{ orderTypeText(form.order_type) }}</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">已录商品</span><b>{{ filledRows.length }} 项</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">合计</span><b class="isn-strip-amt">¥{{ fmtMoney(totalAmount) }}</b>
      </span>
    </div>

    <div v-if="!isReturn" class="isn-body">
      <div class="isn-bar">
        <b>商品明细</b>
        <span class="isn-cnt">{{ filledRows.length }} 项</span>
        <input v-model.trim="prodKw" class="input isn-prod-kw" placeholder="输入商品名筛选下面的商品下拉" />
        <button class="btn btn-ghost btn-sm" @click="addRow"><Icon name="plus" :size="14" />加一行</button>
      </div>

      <p class="isn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>数量按商品档案的「报单单位」填写，发货时会按最早到期的批次自动扣减。</span>
      </p>

      <div v-if="!items.length" class="state-empty">还没有明细，点右上角「加一行」开始。</div>

      <div v-else class="table-wrap">
        <table class="tbl isn-tbl">
          <thead>
            <tr>
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <!-- v444：必填三列（商品 / 数量 / 单价）打红 `*`，与表单头「客户」
                   同一枚 `.isn-req`；判据 = `validate()` 里实际拦的字段。 -->
              <th class="isn-c-prod" :style="wStyle('prod')"><span class="isn-req">*</span>商品<ColResizeHandle col="prod" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-qty" :style="wStyle('qty')"><span class="isn-req">*</span>数量<ColResizeHandle col="qty" :start="startResize" :reset="resetColW" /></th>
              <th class="isn-c-unit" v-if="isVisible('unit')" :style="wStyle('unit')">单位<ColResizeHandle col="unit" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-price" :style="wStyle('price')"><span class="isn-req">*</span>单价<ColResizeHandle col="price" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-amt" v-if="isVisible('amt')" :style="wStyle('amt')">金额<ColResizeHandle col="amt" :start="startResize" :reset="resetColW" /></th>
              <th class="isn-c-del"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="row.uid">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>
                <select v-model.number="row.product_id" class="input isn-in" @change="onPick(row)">
                  <option :value="0" disabled>请选择商品</option>
                  <option v-for="p in prodOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td>
                <input v-model="row.quantity" class="input isn-in num" inputmode="decimal" placeholder="0" />
              </td>
              <td v-if="isVisible('unit')">
                <span v-if="row.unit" class="isn-unit" :class="{ fallback: row.unitFromBase }"
                      :title="row.unitFromBase ? '商品档案里没设「报单单位」，按基础单位显示' : ''">{{ row.unit }}</span>
                <span v-else class="isn-unit none">先选商品</span>
              </td>
              <td>
                <input v-model="row.unit_price" class="input isn-in num" inputmode="decimal" placeholder="0.00" />
              </td>
              <td class="num isn-amt" v-if="isVisible('amt')">¥{{ fmtMoney(rowAmount(row)) }}</td>
              <td class="isn-c-del">
                <button class="btn btn-icon btn-sm" title="删除这一行" @click="removeRow(i)">
                  <Icon name="trash" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ColMenuPanel ref="panel" :col-list="SALE_NEW_COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />
    </div>

    <div v-if="!isReturn" class="isn-bottom">
      <span class="isn-total">合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
      <div class="isn-save">
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="submit('new')">保存并新增</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="submit('save')">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 新建销售单 / 新建销售退货单 —— 一个组件承载**五个入口**：
     自提订单 / 车销订单 / 调拨单（`?type=…&kind=order`）
     自提退单 / 车销退单（`?type=…&kind=return`，v441 起真能建退货单）
   数据源：`POST /api/psi/sale-orders`（委派既有建单逻辑）
          `GET  /api/psi/sale-orders/{oid}/return-preview` + `POST …/return`（v441）

   🔴 **信用额度校验一律交给后端**（计划 §七 页面 6）：判据是「客户账期含『赊』且
      未清应收 + 本单金额 > 信用额度」，它读的是**实时**应收与客户档案 —— 前端拿不到
      （`/api/psi/refs` 只投影信用上限，不含未清应收）⇒ 前端自己算必然算错，且会出现
      「界面说没超、后端 400」这种最伤信任的组合。这里只负责把后端那句原因原样显示。
   🔴 **不传 `status`**：后端空状态 = 草稿，而「发货」只接受草稿状态的单
      （`sale_order_deliver` 的状态前置）。前端擅自传别的值会让新单无法发货。
   🔴 **幂等键**：订单模式进页面生成一次，提交成功后作废 ⇒ 双击 / 网络重试不会开出两张单。
      退货模式在**每次成功退货之后立刻换键** —— 不换的话，第二次退货会被后端当成
      第一次的重放（`idempotency_get` 命中 ⇒ 直接返回原退货单），**静默什么都不做**。
   🔴 **销售数量只有一个量纲**：`sale_order_items` 的 DDL 里没有换算比列（与采购不同，
      采购有 v409 加的 `base_qty` / `base_ratio` 快照）⇒ 本页**不做任何单位换算**，
      「单位」列只是把商品档案的报单单位显示出来，改不了、也不参与计算。
   🔴 **模式切换必须 computed + watch，不能取一次性常量**：`/inventory/sale/new` 是
      **同一条 path**，`?type=` / `?kind=` 变化时 vue-router **复用同一个组件实例**
      （path 没变）⇒ `onMounted` 不会再跑，页面会停在旧模式 / 旧数据上，而且**零报错**。
      （与采购建单页 `?kind=order` ↔ `?kind=return` 是同一类坑。） */
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import ColMenuPanel from '../../components/ColMenuPanel.vue'
import { useColSettings } from '../../composables/useColSettings.js'
/* v444：列宽拖动（与列显隐是两件事 —— 宽度跟屏幕走、显隐跟租户走）。 */
import { useColResize } from '../../composables/useColResize.js'
import ColResizeHandle from '../../components/ColResizeHandle.vue'
import { psiApi } from '../../api/psi'
import { toast } from '../../store'
/* ⚠️ 刻意**不**复用 `PSI_NOTES.unit`：那句讲的是「三档单位任选、换算由系统算」——
   那是**采购**路线的口径（采购明细有换算比快照）。销售明细表没有换算比列，
   这里单位不可选、也不换算，照抄那句会把用户引到错的操作上。 */
import { fmtMoney, SO_STATUS, ORDER_TYPE, textOf } from '../../constants/psiLabels'
const router = useRouter()
const route = useRoute()

/* 列设置：本页是录入网格，商品 / 数量 / 单价 / 删除为录入必需（core），
   单位、金额为派生的展示列，可隐藏。齿轮用全站共享的 useColSettings + ColMenuPanel
   （见《进销存建单页开发规范》§4）。 */
const SALE_NEW_COLS = [
  { key: 'prod', label: '商品', core: true },
  { key: 'qty', label: '数量', core: true },
  { key: 'unit', label: '单位', core: false },
  { key: 'price', label: '单价', core: true },
  { key: 'amt', label: '金额', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('inv-sale-new', SALE_NEW_COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

/* v444 列宽拖动：**订单表与退货表各一份宽度**（两种模式下列不同、语义也不同，
   共用一份 key 会互相顶掉）⇒ 两个实例、两个本地存储键。列宽只存本机（不上云），
   理由见 `useColResize.js` 文件头。 */
const RET_COLS = [
  { key: 'prod',  label: '商品' },
  { key: 'unit',  label: '单位' },
  { key: 'dlv',   label: '已发货' },
  { key: 'ret',   label: '已退' },
  { key: 'can',   label: '可退' },
  { key: 'qty',   label: '退货数量' },
  { key: 'price', label: '退货单价' },
  { key: 'amt',   label: '退货金额' },
]
const { wStyle, startResize, resetColW } = useColResize('inv-sale-new', SALE_NEW_COLS)
const { wStyle: retW, startResize: retResize, resetColW: retReset } =
  useColResize('inv-sale-new-ret', RET_COLS)

/* ---- URL 驱动的模式（全部 computed，见文件头 🔴）----------------------------
   · `?type=`  出货方式：自提 / 车销 / 调拨。**未知值一律不认**（不把脏 query 传下去，
     也不拿它当筛选条件 —— 否则一个拼错的 type 会静默筛出空列表）。
   · `?kind=`  `order`（默认）| `return`。 */
const qType = computed(() => String((route.query && route.query.type) || ''))
const hasQType = computed(() => !!ORDER_TYPE[qType.value])
const kind = computed(() => String((route.query && route.query.kind) || 'order'))
const isReturn = computed(() => kind.value === 'return')

const saving = ref(false)
const customers = ref([])
const warehouses = ref([])
const products = ref([])
const custKw = ref('')
const prodKw = ref('')

const form = ref({
  customer_id: 0, warehouse_id: 0,
  delivery_date: '', delivery_address: '', note: '',
  order_type: 'self_pickup',
})
/* `uid` 只用于 `v-for` 的 key —— 用下标当 key 时，删中间一行会让后面所有行的
   DOM 复用错位（输入框内容跟着串行）。 */
let _uid = 0
const items = ref([])

const pageTitle = computed(() => {
  const t = hasQType.value ? textOf(ORDER_TYPE, qType.value, '') : ''
  if (isReturn.value) return t ? `新建${t}退单` : '新建销售退货单'
  return t ? `新建${t}${qType.value === 'transfer' ? '单' : '订单'}` : '新建销售单'
})
const pageSub = computed(() => isReturn.value
  ? '对已发货的销售单退货：按可退数量填，提交后回增库存并冲减客户应收'
  : '出货登记，发货时按最早到期批次自动扣减')
const TYPE_OPTIONS = Object.entries(ORDER_TYPE).map(([value, v]) => ({ value, text: v.text }))

function todayISO () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* 幂等键：订单模式一次「会话」的标识；提交成功后作废（见文件头 🔴）。 */
let idemKey = newIdemKey()
function newIdemKey (salt = 'sale') {
  return `psi-${salt}-` + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const prodOptions = computed(() => {
  const k = prodKw.value.trim().toLowerCase()
  if (!k) return products.value
  return products.value.filter(p => (p.name || '').toLowerCase().includes(k))
})
const selCustomer = computed(() => customers.value.find(c => Number(c.id) === Number(form.value.customer_id)) || null)
/** 只把**填过商品**的行算作有效行：空行是给用户预备的，不参与校验、不提交、不计项数。
    采购建单页同口径（预设的空行在提交前过滤掉），避免「留着空行就提交不了」。 */
const filledRows = computed(() => items.value.filter(r => Number(r.product_id) > 0))
const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  return (q && p) ? Math.round(q * p * 100) / 100 : 0
}
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
}
function orderTypeText (v) { return textOf(ORDER_TYPE, v, '未标注') }
function soStatusText (s) { return textOf(SO_STATUS, s) }

/** v444：建单页明细表的**出厂预设空行数**。规范 §4.1 —— 两页（采购 / 销售）必须同值。 */
const PRESET_ROWS = 15

function blankRow () {
  return { uid: ++_uid, product_id: 0, quantity: '', unit: '', unitFromBase: false, unit_price: '' }
}
function addRow () { items.value.push(blankRow()) }
function removeRow (i) { items.value.splice(i, 1) }

function onPick (row) {
  const p = products.value.find(x => Number(x.id) === Number(row.product_id))
  if (!p) return
  const ou = String(p.order_unit || '').trim()
  row.unit = ou || String(p.unit || '').trim()
  row.unitFromBase = !ou && !!row.unit
  // 客户专属价由后端在建单时套用；这里只是给个**默认值**让用户少填一次（可改）。
  if (!row.unit_price && Number(p.sale_price || 0) > 0) row.unit_price = String(p.sale_price)
}

async function loadCustomers () {
  try {
    const d = await psiApi.refs('customers', custKw.value, 200)
    customers.value = d.customers || []
  } catch (e) {
    toast(e.message || '客户读取失败', 'error')
  }
}

/* ══ 退货模式 ═══════════════════════════════════════════════════════════════
   候选原单 = 「发过货」的销售单（`delivered` / `signed` 两种状态。
   🔴 为什么是**两种状态各查一次再合并**：列表接口的 `status` 只收**单值**，
      而可退判据（后端 `_SALE_DELIVERED_STATUSES`）认这两个状态。
      只查 `delivered` 会让「已签收」的单在选单器里**搜不到**（静默假否定）。
   ⚠️ 不做关键词直查：`sale_order_list` **没有** keyword 参数（8 个筛选里没有它），
      所以这里的输入框是在**已载入的候选集**里本地筛 —— 界面上如实说明这一点，
      不假装成服务端搜索。候选集上限 300 张 / 每状态，`soTruncated` 为真时明确提示。 */
const RET_PICK_LIMIT = 300
const soKw = ref('')
const soOptions = ref([])
const soTotal = ref(0)
const soLoading = ref(false)
const fromSo = ref(0)
const retPreview = ref(null)
const retRows = ref([])
const retReason = ref('')
const retLoading = ref(false)
const retError = ref('')
let retIdemKey = newIdemKey('saleret')
/* 基础资料是否已就绪（同一实例切模式时不重复拉 500 条下拉数据）。 */
const refsOk = ref(false)

const retOrder = computed(() => (retPreview.value && retPreview.value.order) || null)
const canReturn = computed(() =>
  !!(retPreview.value && retPreview.value.can_return) && retRows.value.length > 0)
const retBlockReason = computed(() => (retPreview.value && retPreview.value.reason) || '')
const retNote = computed(() => (retPreview.value && retPreview.value.note)
  || '数量按原销售单的「单位」列填；可退 = 已发货 − 已退。')
const retRowsActive = computed(() => retRows.value.filter(r => Number(r.ret_qty) > 0))
const retActiveCount = computed(() => retRowsActive.value.length)
const retDoneCount = computed(() => retRows.value.filter(r => !(Number(r.returnable_qty) > 0)).length)
const retTotal = computed(() => retRows.value.reduce((s, r) => s + retRowAmount(r), 0))
const soTruncated = computed(() => soTotal.value > soOptions.value.length)
/** 候选集内的本地按单号 / 客户名筛（见上方 ⚠️：接口没有服务端关键词搜索）。
    🔴 已选中的那张单**必须留在选项里** —— 否则用户选完再敲两个字筛一下，
       `v-model` 的值不在选项里，下拉会**显示成空**（看起来像"选择被清掉了"）。 */
const soMatches = computed(() => {
  const k = soKw.value.trim().toLowerCase()
  if (!k) return soOptions.value
  const hit = o => String(o.order_no || '').toLowerCase().includes(k)
    || String(o.customer_name || '').toLowerCase().includes(k)
  return soOptions.value.filter(o => hit(o) || Number(o.id) === Number(fromSo.value))
})

function retRowAmount (r) {
  const q = Number(r.ret_qty || 0)
  const p = Number(r.ret_price || 0)
  if (!q || !p) return 0
  return Math.round(q * p * 100) / 100
}

function loadSoOptions () {
  soLoading.value = true
  const base = { limit: RET_PICK_LIMIT }
  if (hasQType.value) base.order_type = qType.value
  return Promise.all([
    psiApi.listSales({ ...base, status: 'delivered' }),
    psiApi.listSales({ ...base, status: 'signed' }),
  ]).then(([a, b]) => {
    const map = new Map()
    ;[...(a.orders || []), ...(b.orders || [])].forEach(o => map.set(o.id, o))
    soOptions.value = [...map.values()].sort((x, y) => Number(y.id) - Number(x.id))
    soTotal.value = Number(a.total || 0) + Number(b.total || 0)
  }).catch(e => {
    soOptions.value = []
    soTotal.value = 0
    toast(e.message || '原销售单读取失败', 'error')
  }).finally(() => { soLoading.value = false })
}

async function onPickSo () {
  retReason.value = ''
  retIdemKey = newIdemKey('saleret')          // 换单 ⇒ 换幂等键（不能复用到别的一张单上）
  await loadPreview(Number(fromSo.value) || 0)
}

async function loadPreview (oid, keepFilled = false) {
  if (!oid) { retPreview.value = null; retRows.value = []; retError.value = ''; return }
  retLoading.value = true
  retError.value = ''
  try {
    const d = await psiApi.returnSalePreview(oid)
    retPreview.value = d
    // `keepFilled`：退货成功后就地刷新 —— 只更新「已退 / 可退」，把输入清空
    //   （原来那批数量已经退掉了，留着它会被当成"还要再退一次"）。
    const prev = keepFilled ? retRows.value : []
    retRows.value = (d.items || []).map(x => {
      const old = prev.find(p => Number(p.product_id) === Number(x.product_id))
      return {
        ...x,
        ret_qty: old ? '' : (Number(x.returnable_qty) > 0 ? String(x.returnable_qty) : ''),
        ret_price: String(old && old.ret_price !== '' ? old.ret_price
                          : (Number(x.unit_price) > 0 ? x.unit_price : '')),
      }
    })
    if (!d.can_return && d.reason) toast(d.reason, 'warn')
  } catch (e) {
    retPreview.value = null
    retRows.value = []
    retError.value = e.message || '可退明细读取失败'
    toast(e.message || '可退明细读取失败', 'error')
  } finally {
    retLoading.value = false
  }
}

function fillAll () {
  retRows.value.forEach(r => {
    r.ret_qty = Number(r.returnable_qty) > 0 ? String(r.returnable_qty) : ''
  })
}
function clearAll () { retRows.value.forEach(r => { r.ret_qty = '' }) }

/* 前端这一道校验是**提前告知**，不是权威：唯一强制在后端
   （`psi_sale_return` 拿可退预览重算上限）。它拦不住直接打接口的人。 */
function validateReturn () {
  if (!fromSo.value) return '请先选择原销售单'
  if (!retPreview.value) return '可退明细还没读出来'
  if (!retPreview.value.can_return) return retBlockReason.value || '这张单没有可退的货'
  for (const r of retRows.value) {
    const q = Number(r.ret_qty || 0)
    if (q < 0) return `「${r.product_name || '某商品'}」的退货数量不能是负数`
    if (q > Number(r.returnable_qty) + 1e-6) {
      return `「${r.product_name || '某商品'}」退货数量 ${q} 超过可退数量 ${fmtQty(r.returnable_qty)}`
    }
  }
  if (!retRowsActive.value.length) return '请至少填一行退货数量'
  return ''
}

async function submitReturn () {
  const bad = validateReturn()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  const no = (retOrder.value && retOrder.value.order_no) || fromSo.value
  if (!window.confirm(`确认对销售单 ${no} 退货 ¥${fmtMoney(retTotal.value)} 吗？\n\n`
    + '提交后会回增库存、冲减这张单对应客户的应收。退货不可撤销，但可以在退货记录里作废。')) return
  saving.value = true
  try {
    const r = await psiApi.returnSale(Number(fromSo.value), {
      reason: retReason.value.trim(),
      idempotency_key: retIdemKey,
      items: retRowsActive.value.map(x => ({
        product_id: x.product_id,
        product_name: x.product_name,
        quantity: Number(x.ret_qty),
        unit_price: Number(x.ret_price || 0),
      })),
    })
    // 换键：同一次「选单 → 填量 → 提交」的会话到此结束（见文件头 🔴）
    retIdemKey = newIdemKey('saleret')
    retReason.value = ''
    toast(`退货单已生成（原销售单 ${no}${r && r.return_id ? '，退货单号 #' + r.return_id : ''}）`, 'success')
    // 就地刷新：新填的「已退 / 可退」立刻反映出来。
    //   🔴 不跳「退单列表」——那张列表按 `sale_orders.status='returned'` 筛，
    //      而销售退货**不回写源单状态**（见后端 docstring）⇒ 跳过去会是一张空表。
    await loadPreview(Number(fromSo.value), true)
  } catch (e) {
    // 后端 detail 原样显示（例如「退货数量 X 超过可退数量 Y」）
    toast(e.message || '退货失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ══ 订单模式 ═══════════════════════════════════════════════════════════════ */
function validate () {
  if (!form.value.customer_id) return '请先选择客户'
  if (!form.value.warehouse_id) return '请选择出货仓库'
  if (!filledRows.value.length) return '请至少添加一行商品明细'
  const rows = filledRows.value
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const at = `第 ${items.value.indexOf(r) + 1} 行`
    if (!(Number(r.quantity) > 0)) return `${at}：数量要大于 0`
    if (r.unit_price === '' || Number(r.unit_price) < 0) return `${at}：请填写单价`
  }
  return ''
}

async function submit (act = 'save') {
  const bad = validate()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  saving.value = true
  try {
    const body = {
      customer_id: form.value.customer_id,
      warehouse_id: form.value.warehouse_id,
      delivery_date: form.value.delivery_date || '',
      delivery_address: form.value.delivery_address || '',
      order_type: form.value.order_type || 'self_pickup',
      note: form.value.note || '',
      idempotency_key: idemKey,
      items: filledRows.value.map(r => ({
        product_id: r.product_id,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price),
      })),
    }
    const r = await psiApi.createSale(body)
    idemKey = newIdemKey()                      // 本次已落地，换键避免后续误复用
    const oid = r && (r.order_id || r.id)
    toast(`销售单已保存（${(r && r.order_no) || oid || ''}）`, 'success')
    if (act === 'new') {
      items.value = [blankRow()]
      form.value.delivery_address = ''
      form.value.note = ''
      return
    }
    if (oid) router.replace('/inventory/sale/' + oid)
    else router.replace('/inventory/sale')
  } catch (e) {
    // 后端原因原样显示（例如「超信用额度（可用¥…，本次¥…）」）
    toast(e.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function back () {
  const q = {}
  if (hasQType.value) q.type = qType.value
  if (kind.value && kind.value !== 'order') q.kind = kind.value
  router.push({ path: '/inventory/sale', query: q })
}

/** 按当前 URL（`type` / `kind`）把页面重置到对应模式。
    🔴 必须是**可重入**的（见文件头：同 path 切 query ⇒ 组件实例被复用）。
    🔴 切模式时**清空对方的状态**：不清就会出现「退货页面上挂着几张销售明细」
       这种自相矛盾的屏幕。 */
async function reinit () {
  form.value.delivery_date = todayISO()
  if (isReturn.value) {
    items.value = []
    soKw.value = ''
    retReason.value = ''
    retError.value = ''
    soOptions.value = []
    soTotal.value = 0
    retPreview.value = null
    retRows.value = []
    fromSo.value = 0
    retIdemKey = newIdemKey('saleret')
    await loadSoOptions()
    return
  }
  fromSo.value = 0
  retReason.value = ''
  retPreview.value = null
  retRows.value = []
  retError.value = ''
  soOptions.value = []
  soTotal.value = 0
  if (!refsOk.value) await loadRefs()
  // v444：预设 **15 行**空行（原 5 行）—— 与采购建单页同一口径（规范 §4.1：
  //   建单页出厂一律 15 行，空行不参与校验、不提交，见 `filledRows`）。
  //   🔴 数字写进 `PRESET_ROWS` 常量而不是散在循环里：两页要同值，
  //      散着写必然会出现「改了一页忘另一页」，而这类偏差肉眼很难发现。
  if (!items.value.length) for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
}

async function loadRefs () {
  try {
    // 拉 customers 是本页必需的（要选客户）；不要把 products 的 limit 调太小，否则下拉选不到货
    const d = await psiApi.refs('warehouses,customers,products', '', 500)
    warehouses.value = d.warehouses || []
    customers.value = d.customers || []
    products.value = d.products || []
    const defs = warehouses.value.filter(w => w.is_default)
    const pick = (defs.length ? defs : warehouses.value).slice().sort((a, b) => a.id - b.id)[0]
    if (pick) form.value.warehouse_id = pick.id
    refsOk.value = true
  } catch (e) {
    toast(e.message || '基础资料读取失败', 'error')
  }
}

/* 出货方式只在订单模式下由 URL 预置（退货模式没有"这一单的出货方式"，
   原单的出货方式由预览的 `order.order_type` 给出）。 */
watch([qType, kind], () => {
  const t = hasQType.value ? qType.value : ''
  if (!isReturn.value) form.value.order_type = ORDER_TYPE[t] ? t : 'self_pickup'
}, { immediate: true })
watch([qType, kind], () => { reinit() })

onMounted(async () => {
  await reinit()
})
</script>

<style scoped>
/* 🔴 竖排 + 底部条两件套：目的是让底部动作条在**内容不足一屏时也钉在视口底部**
   （对齐舟谱：合计与保存在最底一行），内容超一屏时由页内滚动区接管。
   高度链 = InventoryShell 的 `.page{display:flex;flex-direction:column;min-height:100%}`
   ＋ 本页的 `.inv-page`；两处必须**成对**存在，只改一边就会退回原状
   （v403 实测：中间层高度 auto ⇒ 百分比链断开、动作条紧贴明细表）。
   ⚠️ 若 `InventoryShell` 的容器契约改了（`.page` 不再是竖排 flex），这里要一起看。 */
.inv-page { display: flex; flex-direction: column; min-height: 100% }
/* 让 `.isn-body` 成为**唯一占满剩余高度**的滚动容器，表格在内部滚动；
   其它兄弟元素只取内容高度，不再分走空间（覆盖 Shell 的 `:deep(*)` 的 `flex:1 1 auto`）。
   这样新增行永远落在 `.isn-body` 滚动区内，不会被底部合计条盖住。 */
.inv-page > .page-hd,
.inv-page > .isn-hd,
.inv-page > .isn-strip,
.inv-page > .isn-bottom { flex: 0 0 auto }
.isn-acts { display: flex; gap: 8px; flex-wrap: wrap }
.isn-body {
  display: flex; flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.isn-body > .isn-bar,
.isn-body > .isn-tip,
.isn-body > .state-empty,
.isn-body > .state-error { flex: 0 0 auto }
.isn-body > .table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 0;
  border-radius: 0;
}

/* 页头单行 —— 标题与副标题回到**同一基线行**（全局 `.page-hd` 的「内联 / 堆叠」
   由模板结构分派：外面包一层 div 就会回落到两行，故这里只给内层容器定对齐）。 */
.isn-hd-t { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0 }

/* 表单头。标签与框**同行**（v438 定的口径）：每格由「12px 标签 + 4px 间距 + 32px 框
   ≈ 48px」压到 32px，且一行能并更多字段 —— 紧凑感就来自这里。 */
.isn-hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px }
/* 去卡片包裹：页面底 `.content{background:var(--bg)}` 与 `.card{background:var(--bg)}`
   同色 —— 那个框本来只是 border+shadow，去掉不影响配色（深色同理）。
   scoped 属性把特异性抬到 0,2,0 > 全局 `.card` 的 0,1,0，覆盖必然生效（无需 !important）。 */
.isn-hd-flat { padding: 0; background: transparent; border: 0; border-radius: 0; box-shadow: none }
/* 🔴 `flex: none` 是**必需的**：少了它，`flex-shrink` 会把没有 min-width 的格挤窄，
   格内的「标签 + 控件」随即被 `flex-wrap` **拆成上下两行**。改成 flex:none 后，
   宽度放不下时整格换行，永不把标签与框拆开。 */
.isn-f { display: flex; flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap; flex: none }
.isn-f-grow { flex: 1; min-width: 160px }
/* 退货模式「原销售单」格必须**给死宽度**：它带一句 `.isn-hint`（`flex-basis:100%`），
   百分比基会把这一格的 max-content 撑得很宽，而 `.isn-f` 是 `flex:none`（不再回缩）
   ⇒ 右侧会留一大片空白，把后面「客户 / 退货仓库 / 原单状态」推到半屏外。 */
.isn-f-so { width: 380px }
.isn-lb { font-size: 12px; color: var(--t3); white-space: nowrap; flex: none }
/* 必填标记：用**红 `*`**（对齐舟谱的 `*供应商：`）—— 每个必填格省下 2 个字的宽度，
   一行更容易并下全部字段。**不用**「必填」两个字，也**不写**「选填」（无 `*` 即选填）。 */
.isn-req { color: var(--dan); font-size: 13px; line-height: 1; margin-right: 2px }

/* ══ 框式字段（复刻舟谱建单头）═════════════════════════════════════════════
   舟谱建单头那排是「**一个描边框**里左边标签、右边值」，不是「标签在框外、旁边再放一个框」。
   这里把 `.isn-f` 本身做成那个框：
     · 框 = 底色 + 1px 描边 + 圆角 + 左右内距，标签与值都是框内的 flex 子项；
     · 框内控件**必须去掉自己的边框 / 底色 / 内距** —— 否则「框里再套一个框」。
       🔴 全局 `.input` 是 `width:100%`：在横排框里会解析成「撑满整框」并把标签挤出去
          ⇒ 这里一律 `width:auto`，宽度由各控件自己的类显式给。
     · 高度：框内控件收到 30px ⇒ 框 = 30 + 上下 1px 边框 = **32px**，与全站输入框同高。
     · 聚焦高亮**上移到框**（`:focus-within`）；框内控件的 focus 环要关掉，
       否则一大一小两层环。
     · 标签的冒号（`*供应商：`）由 `::after` 生成，**不改模板文案**。
   🔴 只挂 `isn-hd-box`（订单模式头）：退货模式那排有**只读格**（`.isn-ro` 的虚框是
      "这格不可改"的既定语义），不在这里顺手改掉它的观感。 */
.isn-hd-box .isn-f {
  flex-wrap: nowrap;
  padding: 0 6px 0 10px; gap: 4px;
  background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--radius-sm);
}
.isn-hd-box .isn-f:focus-within { border-color: var(--p-dark); box-shadow: 0 0 0 3px var(--p-bg) }
.isn-hd-box .isn-lb::after { content: '：' }
.isn-hd-box .isn-f .input {
  width: auto; min-width: 0; height: 30px; padding: 0 2px;
  border: 0; border-radius: 0; background: transparent; box-shadow: none;
}
.isn-hd-box .isn-f .input:focus { border-color: transparent; box-shadow: none }
/* 框内控件宽度（覆盖全局 `.input{width:100%}`——见上）。
   112 / 120 是**实测**值：本租户仓名「东津仓」3 字、日期串「2026/10/10」
   都在此宽度内完整显示；再窄会把日期控件的日历图标挤掉。 */
.isn-hd-box .isn-f .isn-kw { width: 112px }
.isn-hd-box .isn-f .isn-sel { width: 112px }
.isn-hd-box .isn-f .isn-date { width: 120px }
.isn-hd-box .isn-f .isn-addr { width: 150px }
.isn-hd-box .isn-f .isn-note-in { flex: 1; width: auto; min-width: 120px }

/* 退货模式：表单头下的说明 —— 弱色小字，**独占一行**（`flex-basis:100%`），
   否则会挤在标签与选择器之间，把那一格撑歪。 */
.isn-hint { font-size: 11px; color: var(--t3); line-height: 1.4; max-width: 340px; flex-basis: 100% }
.isn-hint b { color: var(--t2) }
/* 只读值：与输入框**同高同位置**，看起来是表单里的一栏，但虚框表示不可改
   （不要用 disabled input —— 那会让人以为能点开）。 */
.isn-ro {
  display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px;
  min-width: 120px; border: 1px dashed var(--bd); border-radius: var(--radius-sm);
  font-size: 13px; color: var(--t1); background: var(--bg2);
}
/* 退货模式「原销售单」搜索框 + 下拉：仍是两框并列 */
.isn-pick { display: flex; gap: 6px }
.isn-kw { width: 130px; height: 32px }
.isn-sel { min-width: 140px; height: 32px }
.isn-date { width: 140px; height: 32px }
.isn-addr { width: 180px; height: 32px }
.isn-note-in { flex: 1; min-width: 140px; height: 32px; padding: 0 10px }

/* 读数条（舟谱「应付/预付余额」那条的位置）—— 品牌色浅底 + 细边 + 圆角 */
.isn-strip {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 9px 16px;
  background: var(--p-bg); border: 1px solid var(--p-border);
  border-radius: var(--radius-md); font-size: 13px; color: var(--t1);
}
.isn-si { display: inline-flex; align-items: center; gap: 6px }
.isn-sk { color: var(--t3); font-size: 12px }
.isn-strip-amt { color: var(--p-ink); font-variant-numeric: tabular-nums }

/* 明细工具条 */
.isn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px }
.isn-cnt { color: var(--t3); font-variant-numeric: tabular-nums; flex: none }
.isn-prod-kw { width: 240px; height: 32px; margin-left: auto }
.isn-tip { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--t2); margin: 0 0 10px }
.isn-tip svg { color: var(--p-dark); flex: none; margin-top: 1px }
.isn-tip b { color: var(--t1) }
/* 退货明细的工具条（全部可退 / 清零）：推到右侧，不与标题挤在一起 */
.isn-ret-quick { display: flex; gap: 8px; margin-left: auto }
/* 退货明细列少（9 列 vs 销售单 7 列）⇒ 表宽给个下限，避免列被压扁 */
.isn-ret-tbl { min-width: 900px }
.isn-ret-unit { width: 72px; color: var(--t2) }
/* 底部「退货原因」：吃掉左侧以外的空白，把右侧的保存按钮顶到最右 */
.isn-ret-reason { flex: 1; min-width: 220px; height: 32px }

/* 明细表列宽。数量 / 单价 / 金额等宽数字 + 右对齐，成列才好扫读。 */
.isn-tbl { min-width: 720px }
.isn-c-prod { min-width: 280px }
.isn-c-qty, .isn-c-price, .isn-c-amt { width: 110px }
.isn-c-unit { width: 76px }
.isn-c-stk { width: 86px; font-variant-numeric: tabular-nums; white-space: nowrap }
.isn-c-del { width: 44px }
.isn-in { width: 100%; height: 28px }
/* v444：**撤掉**明细表输入框的底色 —— 全局 `.input{background:var(--bg3)}` 在 15 行 × 7 列
   铺下来是满屏灰底方块，压过了数据本身（老板原话：「全屏输入框给人感觉确实有点压抑」）。
   🔴 必须**显式写 transparent** 而不是把规则删掉：删了会让输入框退回全局 `.input` 的
      灰底 —— 那正是「样式看着改了、实际没生效」的静默失效。
   「哪里能填」改由 hover / focus 时的描边承载，不再靠底色。
   与采购建单页同一口径（`InvPurchaseNew.vue` 的 `.ipn-in` / `.ipn-v` 两条）。 */
table.isn-tbl .isn-in:not(:focus) { background: transparent }
.isn-in.num { text-align: right; font-variant-numeric: tabular-nums }
.isn-amt { font-variant-numeric: tabular-nums; white-space: nowrap }
/* 换算 / 原单数量小字：它是解释不是数据，弱化色 + 不换行（不加 nowrap 会在窄列里
   断成两行，把行高顶起来）。 */
.isn-conv { font-size: 11px; color: var(--t3); white-space: nowrap }
.isn-unit { font-size: 13px; color: var(--t1) }
/* 档案没设报单单位时的回落值 —— 用弱化色标注，不静默 */
.isn-unit.fallback, .isn-unit.none { color: var(--t3) }

/* 底部动作条：普通 flex 项，由 `.inv-page` 布局推到 `.isn-body` 下方
   （不用 sticky —— `.isn-body` 自己滚动占满剩余高度，动作条自然落在它下面，
   也不会盖住表格最后一行）。负边距用于抵消 Shell 的 `.view-wrap{padding:20px}`。 */
.isn-bottom {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  flex: 0 0 auto;
  margin: auto -20px -20px -20px; padding: 4px 20px;
  background: var(--bg); border-top: 1px solid var(--border-subtle);
}
.isn-total { font-size: 14px }
.isn-total b { font-size: 18px; font-variant-numeric: tabular-nums }
.isn-save { position: relative; display: inline-flex; gap: 8px; margin-left: auto }

@media (max-width: 640px) {
  .isn-hd { align-items: stretch }
  .isn-f, .isn-kw, .isn-sel, .isn-date, .isn-addr { width: 100%; min-width: 0 }
  .isn-pick { flex-direction: column }
  .isn-prod-kw { width: 100%; margin-left: 0 }
  .isn-bottom { margin-inline: 0; padding-inline: 0 }
  /* 窄屏下框内控件要跟着撑满 —— 不写这几条，上面框式规则的定宽特异性更高
     （`.isn-hd-box .isn-f .isn-sel` 0,3,0 > `.isn-sel` 0,1,0），会把媒体查询的
     「全宽」顶掉，留下 112px 的短框 + 右半行空白。 */
  .isn-hd-box .isn-f { width: 100% }
  .isn-hd-box .isn-f .isn-sel,
  .isn-hd-box .isn-f .isn-date,
  .isn-hd-box .isn-f .isn-kw,
  .isn-hd-box .isn-f .isn-addr { width: auto; flex: 1; min-width: 0 }
}
</style>
