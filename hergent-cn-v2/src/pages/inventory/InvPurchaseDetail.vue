<template>
  <div class="inv-page ipd">
    <!-- 页头 -->
    <div class="page-hd split ipd-noprint">
      <div>
        <h2>采购单详情</h2>
        <span class="page-sub">
          {{ o.order_no || ('#' + oid) }}
          <span v-if="o.status" class="tag" :class="tagOf(PO_STATUS, o.status)">{{ textOf(PO_STATUS, o.status) }}</span>
        </span>
      </div>
      <div class="ipd-acts">
        <button class="btn btn-ghost btn-sm" @click="back">返回列表</button>
        <button class="btn btn-ghost btn-sm" :disabled="busy" @click="doCopy">
          <Icon name="copy" :size="14" />复制
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="busy" @click="doPrint">
          <Icon name="print" :size="14" />打印
        </button>
        <button v-if="canWrite && canReceive" class="btn btn-ghost btn-sm" :disabled="busy"
                @click="showRecv = !showRecv">
          <Icon name="inbox" :size="14" />分批到货
        </button>
        <button v-if="canWrite && canConfirm" class="btn btn-primary btn-sm" :disabled="busy" @click="doConfirm">
          <Icon name="check" :size="14" />{{ busy ? '处理中…' : '确认入库' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadAll">重试</button>
    </div>

    <template v-else-if="o.id">
      <!-- 页内三页签（与「货损核算」等页面同一套全局样式，不另写一份） -->
      <div class="main-tabs ipd-noprint">
        <button v-for="t in TABS" :key="t.key" class="main-tab"
                :class="{ on: tab === t.key }" @click="pickTab(t.key)">{{ t.text }}</button>
      </div>

      <!-- ══════════ 采购订单详情 ══════════ -->
      <div v-if="tab === 'detail'" class="tab-pane">
        <div class="card ipd-hd">
          <div class="ipd-f"><span class="ipd-lb">供应商</span><span>{{ o.supplier_name || '—' }}</span></div>
          <div class="ipd-f"><span class="ipd-lb">供应商类别</span><span>{{ o.supplier_category || '—' }}</span></div>
          <div class="ipd-f"><span class="ipd-lb">仓库</span><span>{{ o.warehouse_name || ('仓库 ' + (o.warehouse_id || '—')) }}</span></div>
          <div class="ipd-f"><span class="ipd-lb">单据日期</span><span>{{ (o.order_date || '').slice(0, 10) || '—' }}</span></div>
          <div class="ipd-f"><span class="ipd-lb">预计到货</span><span>{{ o.expected_date || '—' }}</span></div>
          <div class="ipd-f"><span class="ipd-lb">创建人</span><span>{{ o.creator_name || '—' }}</span></div>
          <div class="ipd-f"><span class="ipd-lb">审核时间</span><span>{{ o.audit_time || '—' }}</span></div>
          <div v-if="o.note" class="ipd-f ipd-f-grow"><span class="ipd-lb">备注</span><span>{{ o.note }}</span></div>
        </div>

        <!-- 金额条：只列我们真的有来源的两项（「预算金额」我们没有这个概念，不造） -->
        <div class="card ipd-money">
          <div class="ipd-m">
            <span class="ipd-lb">订单金额</span>
            <b class="ipd-amt">¥{{ fmtMoney(o.total_amount) }}</b>
          </div>
          <div class="ipd-m">
            <span class="ipd-lb">入库金额</span>
            <b class="ipd-amt">{{ moneyOrDash(o.received_amount, hasItems) }}</b>
          </div>
          <div class="ipd-m">
            <span class="ipd-lb">应付金额</span>
            <b class="ipd-amt">{{ apAmountText }}</b>
          </div>
        </div>

        <!-- 状态说明：告诉用户「现在能不能入库、为什么不能」 -->
        <div v-if="statusHint" class="card ipd-hint ipd-noprint">
          <Icon name="lightbulb" :size="16" /><span>{{ statusHint }}</span>
        </div>

        <!-- 分批到货面板（默认收起） -->
        <div v-if="showRecv && canReceive" class="card ipd-recv ipd-noprint">
          <div class="ipd-recv-hd">
            <b>分批到货</b>
            <span class="ipd-note">填这次实际到了多少，可以分几次填完。</span>
          </div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th class="seq-th">序号</th><th>商品</th><th class="num">订购</th><th class="num">已到</th><th class="num">这次到货</th></tr>
              </thead>
              <tbody>
                <tr v-for="(g, i) in recvGroups" :key="g.product_id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td>{{ g.name }}</td>
                  <td class="num">{{ fmtQty(g.ordered) }}</td>
                  <td class="num">{{ fmtQty(g.received) }}</td>
                  <td><input v-model="recv[g.product_id]" class="input ipd-in num" inputmode="decimal" placeholder="0" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="ipd-recv-ft">
            <span class="ipd-note">这次到货只增加在库数量；批次号与到期日以「确认入库」时登记的为准。</span>
            <button class="btn btn-ghost btn-sm" @click="showRecv = false">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="busy" @click="doReceive">提交到货</button>
          </div>
        </div>

        <!-- 商品明细 -->
        <div class="card">
          <div class="ipd-bar">
            <b>商品明细</b>
            <span class="ipd-note">共 {{ items.length }} 行</span>
          </div>
          <div v-if="!items.length" class="state-empty">
            这张单没有商品明细。历史导入的单只存了表头，可以从它「复制」一张新单再补明细。
          </div>
          <div v-else class="table-wrap">
            <table class="tbl ipd-tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>商品名称</th>
                  <th>规格</th>
                  <th>条形码</th>
                  <th>单位</th>
                  <th class="num">参考成本价</th>
                  <th class="num">采购价</th>
                  <th class="num">订单数量</th>
                  <th class="num">订单金额</th>
                  <th>批次号</th>
                  <th>到期日</th>
                  <th class="num">已到货</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in items" :key="it.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td class="ipd-c-name">{{ it.product_name || ('商品 ' + it.product_id) }}</td>
                  <td>{{ it.spec || '—' }}</td>
                  <td class="ipd-mono">{{ it.product_barcode || '—' }}</td>
                  <td>{{ it.unit_label || '—' }}</td>
                  <td class="num">¥{{ fmtMoney(it.product_purchase_price) }}</td>
                  <td class="num">¥{{ fmtMoney(it.unit_price) }}</td>
                  <td class="num">{{ fmtQty(it.quantity) }}</td>
                  <td class="num">¥{{ fmtMoney(it.amount) }}</td>
                  <td>
                    <span v-if="it.batch_no">{{ it.batch_no }}</span>
                    <span v-else class="tag warn">未登记</span>
                  </td>
                  <td>
                    <span v-if="it.expiry_date">{{ it.expiry_date }}</span>
                    <span v-else class="tag warn">未登记</span>
                  </td>
                  <td class="num">{{ fmtQty(it.received_qty) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="7">合计</td>
                  <td class="num">{{ fmtQty(sumQty) }}</td>
                  <td class="num">¥{{ fmtMoney(sumAmount) }}</td>
                  <td colspan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <!-- ══════════ 货款 ══════════ -->
      <div v-else-if="tab === 'payments'" class="tab-pane">
        <div class="ipd-pay">
          <!-- 订单信息 -->
          <div class="card ipd-info">
            <div class="ipd-info-hd">订单信息</div>
            <div class="ipd-row"><span class="ipd-lb">订单编号</span><span class="ipd-mono">{{ pay.order_no || '—' }}</span></div>
            <div class="ipd-row"><span class="ipd-lb">供应商名称</span><span>{{ pay.supplier_name || '—' }}</span></div>
            <div class="ipd-row"><span class="ipd-lb">已预付</span><span>¥{{ fmtMoney(pay.prepaid_amount) }}</span></div>
            <div class="ipd-row"><span class="ipd-lb">订单金额</span><span>¥{{ fmtMoney(pay.total_amount) }}</span></div>
            <div class="ipd-row"><span class="ipd-lb">入库金额</span><span>{{ moneyOrDash(pay.received_amount, hasItems) }}</span></div>
            <div class="ipd-row"><span class="ipd-lb">应付金额</span><span>{{ apAmountText }}</span></div>
            <div class="ipd-row"><span class="ipd-lb">已结金额</span><span>¥{{ fmtMoney(pay.paid_amount) }}</span></div>
            <div class="ipd-row ipd-row-b"><span class="ipd-lb">未结金额</span><b class="ipd-amt" :class="{ 'ipd-amt-due': hasDue }">¥{{ fmtMoney(pay.unpaid_amount) }}</b></div>

            <div v-if="apMismatch" class="ipd-warn">
              <Icon name="alert" :size="15" />
              <span>往来账里的应付余额（¥{{ fmtMoney(pay.ap_unpaid_amount) }}）与这里的未结金额对不上，
                以本页为准；建议到「往来账」核对这一单。</span>
            </div>

            <button class="btn btn-primary ipd-paybtn" :disabled="!canWrite || payBusy || !canPay"
                    @click="openPay">
              <Icon name="payment" :size="15" />付款
            </button>
            <p v-if="!canPay && pay.unpaid_amount >= 0" class="ipd-note ipd-payhint">{{ payHint }}</p>
          </div>

          <!-- 付款信息 -->
          <div class="card ipd-flows">
            <div class="ipd-info-hd">付款信息</div>
            <div v-if="!payments.length" class="ipd-empty">
              <div class="ipd-empty-ic"><Icon name="receipt" :size="26" /></div>
              <p>还没有付款记录。</p>
              <p v-if="canPay" class="ipd-note">这张单还有 ¥{{ fmtMoney(pay.unpaid_amount) }} 未结，点左侧「付款」登记一笔。</p>
            </div>
            <div v-else class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr><th>付款时间</th><th class="num">金额</th><th>账户</th><th>经手人</th><th>备注</th></tr>
                </thead>
                <tbody>
                  <tr v-for="p in payments" :key="p.id">
                    <td>{{ (p.created_at || '').slice(0, 16) || '—' }}</td>
                    <td class="num">¥{{ fmtMoney(p.amount) }}</td>
                    <td>{{ p.account || '—' }}</td>
                    <td>{{ p.operator_name || '—' }}</td>
                    <td>{{ p.note || '—' }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td>合计</td>
                    <td class="num">¥{{ fmtMoney(pay.paid_amount) }}</td>
                    <td colspan="3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- ══════════ 入库单 ══════════ -->
      <div v-else class="tab-pane">
        <div v-if="inb.empty" class="card ipd-empty">
          <div class="ipd-empty-ic"><Icon name="inbox" :size="26" /></div>
          <p>{{ inb.reason || '这张单还没有到货记录。' }}</p>
        </div>
        <template v-else>
          <div class="card ipd-hd">
            <div class="ipd-f"><span class="ipd-lb">入库单号</span><span class="ipd-mono">{{ inb.head.inbound_no || '—' }}</span></div>
            <div class="ipd-f"><span class="ipd-lb">源订单号</span><span class="ipd-mono">{{ inb.head.src_order_no || '—' }}</span></div>
            <div class="ipd-f"><span class="ipd-lb">订单类型</span><span>{{ inb.head.order_type || '采购订单' }}</span></div>
            <div class="ipd-f"><span class="ipd-lb">供应商</span><span>{{ inb.head.supplier_name || '—' }}</span></div>
            <div class="ipd-f"><span class="ipd-lb">入库仓库</span><span>{{ inb.head.warehouse_name || '—' }}</span></div>
            <div class="ipd-f"><span class="ipd-lb">入库人</span><span>{{ inb.head.operator_name || '—' }}</span></div>
            <div class="ipd-f"><span class="ipd-lb">入库时间</span><span>{{ inb.head.audit_time || '—' }}</span></div>
          </div>
          <p class="ipd-note ipd-inbnote">本页是这张单的到货入库明细，入库单号由源订单号生成。</p>

          <div class="card">
            <div class="ipd-bar">
              <b>商品明细</b>
              <span class="ipd-note">共 {{ inb.items.length }} 行</span>
            </div>
            <div v-if="!inb.items.length" class="state-empty">这张单没有商品明细。</div>
            <div v-else class="table-wrap">
              <table class="tbl ipd-tbl-wide">
                <thead>
                  <tr>
                    <th class="seq-th">序号</th>
                    <th>生产批号</th>
                    <th>商品名称</th>
                    <th>小单位条码</th>
                    <th>大单位条码</th>
                    <th>单位换算</th>
                    <th>单位</th>
                    <th>入库仓库</th>
                    <th class="num">订单数量</th>
                    <th class="num">订单金额</th>
                    <th class="num">入库数量</th>
                    <th>生产日期</th>
                    <th class="num">入库金额</th>
                    <th class="num">差异数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, i) in inb.items" :key="it.id">
                    <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                    <td>
                      <span v-if="it.batch_no">{{ it.batch_no }}</span>
                      <span v-else class="tag warn">未登记</span>
                    </td>
                    <td class="ipd-c-name">{{ it.product_name || ('商品 ' + it.product_id) }}</td>
                    <td class="ipd-mono">{{ it.barcode || '—' }}</td>
                    <td class="ipd-mono">{{ it.large_barcode || '—' }}</td>
                    <td>{{ it.spec || '—' }}</td>
                    <td>{{ it.unit_label || '—' }}</td>
                    <td>{{ inb.head.warehouse_name || '—' }}</td>
                    <td class="num">{{ fmtQty(it.order_qty) }}</td>
                    <td class="num">¥{{ fmtMoney(it.order_amount) }}</td>
                    <td class="num">{{ fmtQty(it.received_qty) }}</td>
                    <td>{{ it.production_date || '—' }}</td>
                    <td class="num">¥{{ fmtMoney(it.recv_amount) }}</td>
                    <td class="num" :class="{ 'ipd-diff': Number(it.diff_qty) !== 0 }">{{ fmtQty(it.diff_qty) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="10">合计</td>
                    <td class="num">{{ fmtQty(inb.summary.recv_qty) }}</td>
                    <td></td>
                    <td class="num">¥{{ fmtMoney(inb.summary.recv_amount) }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- 付款弹层 -->
    <div v-if="payOpen" class="ipd-mask" @click.self="closePay">
      <div class="card ipd-dlg">
        <div class="ipd-dlg-hd">登记付款</div>
        <p class="ipd-dlg-msg">
          {{ o.order_no }} · {{ o.supplier_name || '供应商' }} —— 未结 ¥{{ fmtMoney(pay.unpaid_amount) }}
        </p>
        <label class="ipd-fl"><span class="ipd-lb">付款金额（元）</span>
          <input v-model="payForm.amount" class="input ipd-in num" inputmode="decimal" placeholder="0.00" />
        </label>
        <label class="ipd-fl"><span class="ipd-lb">付款账户</span>
          <select v-model="payForm.account" class="input ipd-in">
            <option v-for="a in ACCOUNTS" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
        <label class="ipd-fl"><span class="ipd-lb">备注（选填）</span>
          <input v-model="payForm.note" class="input ipd-in" placeholder="例如：银行转账" />
        </label>
        <p v-if="payErr" class="ipd-dlgerr">{{ payErr }}</p>
        <div class="ipd-dlg-ft">
          <button class="btn btn-ghost btn-sm" :disabled="payBusy" @click="closePay">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="payBusy" @click="doPay">
            {{ payBusy ? '处理中…' : '确认付款' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 采购单详情 —— 三页签（采购订单详情 / 货款 / 入库单），对齐舟谱的详情页结构。
   数据源：`GET /api/psi/purchase-orders/{id}`（基础+明细）、`.../payments`（货款）、
   `.../inbound`（入库单），写操作 `.../confirm`、`.../receive`、`.../payments`。

   🔴 三条必须遵守的纪律（都在这一个文件里落地，改动时别破坏）：

   ① **`oid` 必须随路由参数变**。vue-router 对「同一 route record、只有 params 不同」的跳转
      **复用组件实例、不重跑 setup** ⇒ 若把 id 读成一次性常量（`Number(route.params.id)` 直接
      赋给 const），从 A 单点到 B 单时页面还显示 A 单的数据，且**零报错**。
      这里用 `computed` + `watch(oid, loadAll)` 处理。

   ② **英文枚举一律经词表**。`o.status` / `inb.head.status` 这类后端值绝不许直接插值 ——
      与「状态列印出 `received`」是同一类泄漏（见 `psiLabels.js` 的立场声明）。

   ③ **「没有」≠「是零」**。舟谱导入的历史单（生产 79 张）**只有表头、零明细**，
      它没有「订单数量」，也**没有应付记录** ⇒ 这些格子显示 `—` 而不是 `¥0.00`，
      否则老板会读成「这笔欠款是零」。判据 = `hasItems` / `ap_amount === null`。

   ⚠️ 「应付金额」来自后端 `payments.order.ap_amount`，可能是 `null`（= 没有应付记录）。
      **不在前端拿 total_amount 兜底** —— 那会把「没有应付」伪装成「应付 = 订单金额」。
*/
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { PO_STATUS, textOf, tagOf, PSI_NOTES, fmtMoney } from '../../constants/psiLabels'

const route = useRoute()
const router = useRouter()

/* ① 见文件头注释：必须是 computed（同 route record 换 params 时组件实例被复用） */
const oid = computed(() => Number(route.params.id))

/* 页签 = URL 上的 `?tab=`。用 query 而不是本地 state：这样「发给同事一个链接」能直接到那一页，
   而且浏览器后退能回到上一个页签。缺省 = 采购订单详情。 */
const TABS = [
  { key: 'detail', text: '采购订单详情' },
  { key: 'payments', text: '货款' },
  { key: 'inbound', text: '入库单' },
]
const tab = computed(() => {
  const k = String((route.query && route.query.tab) || '')
  return TABS.some(t => t.key === k) ? k : 'detail'
})
function pickTab (k) {
  router.replace({ path: route.path, query: k === 'detail' ? {} : { tab: k } })
}

const ACCOUNTS = ['现金', '微信', '支付宝', '银行']

const loading = ref(true)
const busy = ref(false)
const err = ref('')
const o = ref({})
const items = ref([])
const pay = ref({})
const payments = ref([])
const inb = ref({ empty: true, reason: '', head: {}, items: [], summary: {} })
const showRecv = ref(false)
const recv = ref({})

const payOpen = ref(false)
const payBusy = ref(false)
const payErr = ref('')
const payForm = ref({ amount: '', account: '现金', note: '' })

const canWrite = computed(() => canDo('inventory', 'create'))
/* 判据与后端逐字对齐：`purchase_order_confirm` 只接受 `status IN ('draft','approved')` */
const canConfirm = computed(() => ['draft', 'approved'].includes(o.value.status))
const canReceive = computed(() => ['draft', 'approved', 'partial'].includes(o.value.status))

/* ③ 「有明细」是一等事实：零明细的历史导入单，数量/金额格子一律显示 `—` */
const hasItems = computed(() => items.value.length > 0)

/* 「应付金额」：后端给 `null` = 没有应付记录 ⇒ 显示 `—`（**不用订单金额兜底**） */
const apAmountText = computed(() => {
  const v = pay.value.ap_amount
  return (v === null || v === undefined) ? '—' : ('¥' + fmtMoney(v))
})
/* 两处记账（往来账的应付 vs 采购单的未结）分叉时**必须说出来**，不静默 */
const apMismatch = computed(() => {
  const a = pay.value.ap_unpaid_amount
  if (a === null || a === undefined) return false
  return Math.abs(Number(a) - Number(pay.value.unpaid_amount || 0)) > 0.01
})

/* 🔴 v404b：「已入库」**不等于**「应付已生成」。
   历史导入单（`CD…` 开头）只存了表头，`confirm` 从没在它们身上跑过 ⇒ 库里没有应付行
   （`pay.ap_exists === false`）。所以下面两句都**必须先看 `ap_exists`**，
   不能拿状态一句话概括 —— 否则同一屏上会出现「应付都已生成」与「应付金额 —」互相打脸。 */
const apExists = computed(() => pay.value.ap_exists === true)

/* 🔴 v404b：**真欠钱才染红**。`¥0.00` 涂成 `--danger` 是在喊「告急」，
   而同一屏的提示恰好写着「不用登记付款」—— 又是一处同屏自相矛盾。 */
const hasDue = computed(() => Number(pay.value.unpaid_amount || 0) > 0.005)

const canPay = computed(() => apExists.value && hasDue.value)
const payHint = computed(() => {
  if (!canWrite.value) return '当前账号没有登记付款的权限。'
  if (!apExists.value) return '这张单没有对应的应付单，不用登记付款。'
  if (!canPay.value) return '这张单已经结清，没有需要付的金额。'
  return ''
})

const statusHint = computed(() => {
  const s = o.value.status
  if (s === 'received') {
    return apExists.value
      ? '这批货已经入库，库存和应付都已生成。'
      : '这批货已经入库，库存已生成；这张单没有对应的应付单，不用登记付款。'
  }
  if (s === 'cancelled') return '这张单已取消，不能再入库。'
  if (s === 'returned') return '这张单已退货。'
  if (s === 'pending_approval') return '这张单还在等审批。审批通过后才能确认入库。'
  if (s === 'partial') return '已经到过一部分货。剩下的到齐后点「确认入库」把批次与到期日补齐。'
  return ''
})

/* 明细合计。⚠️ 这是「把屏幕上方那一列加总」，不是重算业务金额 ——
   `amount` 本身是权威金额（外部系统给的），这里只是把它逐行相加，与舟谱一致。 */
const sumQty = computed(() => items.value.reduce((a, x) => a + Number(x.quantity || 0), 0))
const sumAmount = computed(() => items.value.reduce((a, x) => a + Number(x.amount || 0), 0))

/* 分批到货：按**商品**聚合（后端按 (order_id, product_id) 找行，同一商品多行只会更新第一行
   ⇒ 前端先把多行合并成一项，语义才与后端一致，不会出现「填了没生效」）。 */
const recvGroups = computed(() => {
  const m = new Map()
  for (const it of items.value) {
    const k = it.product_id
    if (!m.has(k)) m.set(k, { product_id: k, name: it.product_name || ('商品 ' + k), ordered: 0, received: 0 })
    const g = m.get(k)
    g.ordered += Number(it.quantity || 0)
    g.received = Math.max(g.received, Number(it.received_qty || 0))
  }
  return [...m.values()]
})

/* 金额格子：「没有明细」时显示 `—`，而不是 `¥0.00` */
function moneyOrDash (v, hasRow) {
  return hasRow ? ('¥' + fmtMoney(v)) : '—'
}
function fmtQty (n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }

async function loadAll () {
  if (!oid.value) { err.value = '缺少采购单编号'; loading.value = false; return }
  loading.value = true
  err.value = ''
  try {
    /* 三块数据一次并发取。都是按主键/外键查几行，没有懒加载的必要；
       并发也能保证「应付金额」「入库金额」这些跨 tab 的读数同时就位、不会先显示一个空的。 */
    const [d, p, b] = await Promise.all([
      psiApi.getPurchase(oid.value),
      psiApi.getPurchasePayments(oid.value),
      psiApi.getPurchaseInbound(oid.value),
    ])
    o.value = (d && d.order) || {}
    items.value = (d && d.items) || []
    pay.value = (p && p.order) || {}
    payments.value = (p && p.payments) || []
    inb.value = b || { empty: true, reason: '', head: {}, items: [], summary: {} }
  } catch (e) {
    err.value = e.message || '采购单读取失败'
  } finally {
    loading.value = false
  }
}

/* ① 路由参数变化 ⇒ 重新取数（组件实例被 vue-router 复用，不会重跑 setup） */
watch(oid, loadAll)

async function doConfirm () {
  if (busy.value) return
  const withBatch = items.value.filter(it => it.batch_no && it.expiry_date).length
  const noBatch = items.value.length - withBatch
  const ok = window.confirm(
    `确认这一单的货已经到齐并入库？\n\n` +
    `${PSI_NOTES.confirmIn}\n\n` +
    (noBatch
      ? `⚠️ 有 ${noBatch} 行明细没有登记批次号或到期日 —— 入库后这些库存进不了临期预警和「先出最早到期」。\n\n`
      : `本单 ${withBatch} 行明细都已登记批次号与到期日。\n\n`) +
    `确定入库吗？`
  )
  if (!ok) return
  busy.value = true
  try {
    const r = await psiApi.confirmPurchase(oid.value)
    if (r && r.error) throw new Error(r.error)
    toast('已入库：库存增加、应付已生成', 'success')
    await loadAll()
  } catch (e) {
    toast(e.message || '入库失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doReceive () {
  if (busy.value) return
  const list = recvGroups.value
    .map(g => ({ product_id: g.product_id, quantity: Number(recv.value[g.product_id] || 0) }))
    .filter(x => x.quantity > 0)
  if (!list.length) { toast('请填写这次到货的数量', 'warn'); return }
  busy.value = true
  try {
    const r = await psiApi.receivePurchase(oid.value, { items: list })
    if (r && r.error) throw new Error(r.error)
    toast('已记录这次到货', 'success')
    recv.value = {}
    showRecv.value = false
    await loadAll()
  } catch (e) {
    toast(e.message || '到货登记失败', 'error')
  } finally {
    busy.value = false
  }
}

function doCopy () {
  router.push('/inventory/purchase/new?copy=' + oid.value)
}

/* 打印 = 「记一次打印数」+ 浏览器打印。记数必须落库：刷新后那个数字还在，
   才是判断「这张单打没打给供应商」的依据（与列表页同一口径，后端同一端点）。 */
async function doPrint () {
  if (busy.value) return
  busy.value = true
  try {
    await psiApi.printPurchase(oid.value)
    await nextTick()
    window.print()
  } catch (e) {
    toast(e.message || '打印失败', 'error')
  } finally {
    busy.value = false
  }
}

function openPay () {
  payErr.value = ''
  payForm.value = { amount: String(pay.value.unpaid_amount || ''), account: '现金', note: '' }
  payOpen.value = true
}
function closePay () {
  if (payBusy.value) return
  payOpen.value = false
}

async function doPay () {
  if (payBusy.value) return
  const amt = Number(payForm.value.amount)
  if (!Number.isFinite(amt) || amt <= 0) { payErr.value = '请填写大于 0 的付款金额。'; return }
  payBusy.value = true
  payErr.value = ''
  try {
    /* 🔴 超付 / 期间已关闭 / 没有应付记录这三道判据**只在后端**，这里不预判 ——
       拿到 400 的中文原因原样显示在弹层里，用户当场就能改。 */
    const r = await psiApi.createPurchasePayment(oid.value, {
      amount: amt,
      account: payForm.value.account,
      note: payForm.value.note,
    })
    if (r && r.error) throw new Error(r.error)
    toast('付款已登记', 'success')
    payOpen.value = false
    await loadAll()
  } catch (e) {
    payErr.value = e.message || '付款登记失败'
  } finally {
    payBusy.value = false
  }
}

function back () { router.push('/inventory/purchase') }
onMounted(loadAll)
</script>

<style scoped>
.inv-page { display: block }
.ipd-acts { display: flex; gap: 8px; flex-wrap: wrap }

.ipd-hd { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; align-items: baseline }
.ipd-f { display: flex; flex-direction: column; gap: 4px }
.ipd-f-grow { flex: 1; min-width: 200px }
.ipd-lb { font-size: 12px; color: var(--t3) }
.ipd-amt { font-size: 16px; font-variant-numeric: tabular-nums }
.ipd-amt-due { color: var(--danger) }
.ipd-mono { font-variant-numeric: tabular-nums; font-family: var(--font-mono) }

/* 金额条：三项并排（订单 / 入库 / 应付） */
.ipd-money { display: flex; gap: 32px; flex-wrap: wrap; margin-bottom: 12px }
.ipd-m { display: flex; flex-direction: column; gap: 4px }

.ipd-hint {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  border-left: 3px solid var(--p); font-size: 13px; color: var(--t1);
}
.ipd-hint svg { color: var(--p-dark); flex: none }

.ipd-recv { margin-bottom: 12px }
.ipd-recv-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap }
.ipd-recv-ft { display: flex; align-items: center; gap: 8px; padding-top: 12px; flex-wrap: wrap }
.ipd-in { height: 30px; width: 110px }
.ipd-in.num { text-align: right; font-variant-numeric: tabular-nums }

.ipd-bar { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap }
.ipd-note { font-size: 12px; color: var(--t3) }
.ipd-recv-ft .ipd-note { margin-right: auto }

.ipd-tbl { min-width: 1500px }
.ipd-tbl-wide { min-width: 1900px }
.ipd-c-name { min-width: 220px }
.ipd-diff { color: var(--danger); font-weight: 600 }
tfoot td { font-weight: 600 }

/* ---- 货款 ---- */
.ipd-pay { display: grid; grid-template-columns: minmax(300px, 380px) 1fr; gap: 12px; align-items: start }
.ipd-info { display: flex; flex-direction: column; gap: 10px }
.ipd-info-hd { font-size: var(--fs-h4); font-weight: 600; color: var(--t1) }
.ipd-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px }
.ipd-row > span:last-child, .ipd-row > b { text-align: right }
.ipd-row-b { border-top: 1px solid var(--border-subtle); padding-top: 10px; margin-top: 2px }
.ipd-warn {
  display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.6;
  color: var(--t1); background: var(--warn-amber-bg);
  border-radius: var(--radius-md); padding: 10px 12px;
}
.ipd-warn svg { flex: none; margin-top: 2px; color: var(--warn) }
.ipd-paybtn { justify-content: center; margin-top: 4px }
.ipd-payhint { margin-top: -4px }

.ipd-flows { min-width: 0 }
.ipd-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 12px; text-align: center }
.ipd-empty-ic { color: var(--t3) }
.ipd-empty p { font-size: 13px; color: var(--t2); margin: 0 }
.ipd-inbnote { margin: -4px 0 12px }

/* ---- 付款弹层 ---- */
.ipd-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  z-index: var(--z-page-modal-overlay);
}
.ipd-dlg { width: min(420px, 92vw); padding: 18px; position: relative; z-index: var(--z-page-modal) }
.ipd-dlg-hd { font-size: var(--fs-h4); font-weight: 600; margin-bottom: 8px }
.ipd-dlg-msg { font-size: 12px; color: var(--t3); margin-bottom: 14px }
.ipd-fl { display: block; margin-bottom: 12px }
.ipd-fl .ipd-lb { display: block; margin-bottom: 6px }
.ipd-fl .input { width: 100% }
.ipd-dlgerr { font-size: 12px; color: var(--danger); margin-bottom: 10px }
.ipd-dlg-ft { display: flex; justify-content: flex-end; gap: 8px }

/* 打印：只留当前页签的数据表。页签条 / 动作区 / 提示条 / 弹层一律不印
   —— 打印出来的应该是单据本身，不是界面外壳。 */
@media print {
  .ipd-noprint, .ipd-mask { display: none !important }
  .card { border: none; box-shadow: none; padding: 0 }
  .table-wrap { overflow: visible; border: none; border-radius: 0 }
  .ipd-tbl, .ipd-tbl-wide { min-width: 0; width: 100% }
  .ipd-c-name { min-width: 0 }
}

@media (max-width: 900px) {
  .ipd-pay { grid-template-columns: 1fr }
}

@media (max-width: 640px) {
  .ipd-hd { gap: 14px }
  .ipd-money { gap: 18px }
  .ipd-recv-ft .ipd-note { width: 100%; margin-right: 0 }
}
</style>
