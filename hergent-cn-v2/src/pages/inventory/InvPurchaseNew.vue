<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div class="ipn-hd-t">
        <h2>{{ pageTitle }}</h2>
        <span class="page-sub">{{ pageSub }}</span>
      </div>
      <div class="ipn-acts">
        <template v-if="!isReturn">
          <input v-model.trim="prodKw" class="input ipn-prod-kw" placeholder="输入商品名筛选下面的商品下拉" />
          <button class="btn btn-ghost btn-sm" @click="addRow()"><Icon name="plus" :size="14" />加一行</button>
        </template>
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
      </div>
    </div>

    <!-- ══ v414（P2-6）退货模式：原采购单 + 只读的供应商 / 仓库 ══════════════════
         为什么退货页**长在采购单建单页里**（`?kind=return`）而不是另开一个页面：
         「退货」与「采购」共用同一套页面骨架、基础资料与明细表样式，另开一页等于把
         这些再抄一份（本仓铁律：同一条规则抄多份 ⇒ 漏抄那份整页崩）。
         ⚠️ 两套内容的**列与校验差异很大**（退货没有批次 / 效期 / 库存 / 三档单位，
            也不能挑商品），所以模板里是两条并列分支，而不是一堆 `v-if` 混在一张表上。

         退货**必须**挂一张原采购单 —— 后端 `purchase_return_create` 要用它取供应商与
         仓库，所以这里不是"可选的关联"，而是整张单据的入口：没选原单就没有可退明细。 -->
    <div v-if="isReturn" class="ipn-hd ipn-hd-flat">
      <div class="ipn-f ipn-f-sup">
        <label class="ipn-lb">原采购单 <span class="ipn-req">必填</span></label>
        <div class="ipn-sup-pick">
          <input v-model.trim="poKw" class="input ipn-kw" placeholder="单号 / 供应商"
                 @keyup.enter="loadPoOptions" />
          <select v-model.number="fromPo" class="input ipn-sel" @change="onPickPo">
            <option :value="0" disabled>请选择原采购单</option>
            <option v-for="o in poOptions" :key="o.id" :value="o.id">
              {{ o.order_no }} · {{ o.supplier_name || '—' }} · {{ poStatusText(o.status) }}
            </option>
          </select>
        </div>
        <div class="ipn-hint">
          只列出<b>进过货</b>的单；草稿 / 待审批 / 已取消的没有货可退，不在这里。
        </div>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">供应商</label>
        <span class="ipn-ro">{{ retOrder ? (retOrder.supplier_name || '—') : '—' }}</span>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">退货仓库</label>
        <span class="ipn-ro">{{ retOrder ? (retOrder.warehouse_name || '—') : '—' }}</span>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">原单状态</label>
        <span class="ipn-ro">{{ retOrder ? poStatusText(retOrder.status) : '—' }}</span>
      </div>
    </div>

    <!-- 退货模式的读数条（与采购单那条位置一致：合计 / 金额在左） -->
    <div v-if="isReturn" class="ipn-strip">
      <span class="ipn-si">
        <span class="ipn-sk">可退商品</span>
        <b>{{ retRows.length }} 项<template v-if="retDoneCount">（{{ retDoneCount }} 项已退完）</template></b>
      </span>
      <span class="ipn-si">
        <span class="ipn-sk">本次退货</span><b>{{ retActiveCount }} 项</b>
      </span>
      <span class="ipn-si">
        <span class="ipn-sk">退货金额</span><b class="ipn-strip-amt">¥{{ fmtMoney(retTotal) }}</b>
      </span>
    </div>

    <!-- 退货明细：商品 / 单位由后端的可退预览**给定**，用户只填「退多少」。
         🔴 商品列不可选 —— 能退的只有这张单买过的货；给个商品下拉等于允许退没买过的东西。 -->
    <div v-if="isReturn" class="ipn-body">
      <div class="ipn-bar">
        <b>退货明细</b>
        <div class="ipn-ret-quick">
          <button class="btn btn-ghost btn-sm" :disabled="!canReturn" @click="fillAll">全部可退</button>
          <button class="btn btn-ghost btn-sm" :disabled="!canReturn" @click="clearAll">清零</button>
        </div>
      </div>

      <p class="ipn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>{{ retNote }}</span>
      </p>

      <div v-if="retLoading" class="state-empty">正在读取这张单的可退明细…</div>
      <div v-else-if="retError" class="state-empty">{{ retError }}</div>
      <div v-else-if="!fromPo" class="state-empty">先在上面选一张原采购单。</div>
      <div v-else-if="!canReturn" class="state-empty">{{ retBlockReason }}</div>

      <div v-else class="table-wrap">
        <table class="tbl ipn-tbl ipn-ret-tbl">
          <thead>
            <tr>
              <th class="seq-th">序号</th>
              <th class="ipn-c-prod">商品</th>
              <th class="ipn-ret-unit">单位</th>
              <th class="num ipn-c-stk">已入库</th>
              <th class="num ipn-c-stk">已退</th>
              <th class="num ipn-c-stk">可退</th>
              <th class="num ipn-c-qty">退货数量</th>
              <th class="num ipn-c-price">退货单价</th>
              <th class="num ipn-c-amt">退货金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in retRows" :key="row.product_id + '-' + i">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td class="ipn-c-prod">
                {{ row.product_name || '—' }}
                <div v-if="row.quantity" class="ipn-conv">
                  原单 {{ fmtQty(row.quantity) }} {{ row.unit || '' }}
                </div>
              </td>
              <td class="ipn-ret-unit">{{ row.base_unit || '—' }}</td>
              <td class="num ipn-c-stk">{{ fmtQty(row.received_qty) }}</td>
              <td class="num ipn-c-stk">{{ fmtQty(row.returned_qty) }}</td>
              <td class="num ipn-c-stk"><b>{{ fmtQty(row.returnable_qty) }}</b></td>
              <td class="ipn-c-qty">
                <input v-model="row.ret_qty" class="input ipn-in num" inputmode="decimal"
                       :disabled="!Number(row.returnable_qty)" />
              </td>
              <td class="ipn-c-price">
                <input v-model="row.ret_price" class="input ipn-in num" inputmode="decimal" />
              </td>
              <td class="num ipn-amt">¥{{ fmtMoney(retRowAmount(row)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="isReturn" class="ipn-bottom">
      <span class="ipn-total">退货合计 <b>¥{{ fmtMoney(retTotal) }}</b></span>
      <input v-model.trim="retReason" maxlength="200" class="input ipn-ret-reason"
             placeholder="退货原因（选填，如：破损 / 临期 / 多订）" />
      <div class="ipn-save">
        <button class="btn btn-primary btn-sm ipn-save-main"
                :disabled="saving || !canReturn" @click="submitReturn">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存退货单' }}
        </button>
      </div>
    </div>

    <!-- 表单头（对齐舟谱：*供应商 / *仓库 / 单据日期 / 预计到货 / 备注 0-500） -->
    <div v-if="!isReturn" class="ipn-hd ipn-hd-flat">
      <div class="ipn-f ipn-f-sup">
        <label class="ipn-lb">供应商 <span class="ipn-req">必填</span></label>
        <div class="ipn-sup-pick">
          <input v-model.trim="supKw" class="input ipn-kw" placeholder="输入名称搜索"
                 @keyup.enter="loadSuppliers" />
          <select v-model.number="form.supplier_id" class="input ipn-sel">
            <option :value="0" disabled>请选择供应商</option>
            <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <!-- v408（P0-5）经办人 / 部门 —— 对齐舟谱建单表单里的 `*经办人` / `*部门`。
           🔴 做成**选填**（舟谱那边是必填）：存量单（舟谱导入 79 张）都没有这两个值，
              强制必填会在老板快速建单时直接卡住；且这两个字段眼下只用于归属/统计，
              不是单据成立的前提。**如实标注「选填」**，不假装必填、也不偷偷默认一个值。
              要改成必填只需给 `form.handler` 加非空校验并改这两个标签 —— 不涉及后端。 -->
      <div class="ipn-f">
        <label class="ipn-lb">经办人 <span class="ipn-opt">选填</span></label>
        <select v-model="form.handler" class="input ipn-sel">
          <option value="">不指定</option>
          <option v-for="u in users" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">部门 <span class="ipn-opt">选填</span></label>
        <select v-model.number="form.department_id" class="input ipn-sel">
          <option :value="0">不指定</option>
          <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">入库仓库 <span class="ipn-req">必填</span></label>
        <select v-model.number="form.warehouse_id" class="input ipn-sel">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">单据日期</label>
        <input type="date" v-model="form.order_date" class="input ipn-date" />
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">预计到货日期</label>
        <input type="date" v-model="form.expected_date" class="input ipn-date" />
      </div>
      <div class="ipn-f ipn-f-grow">
        <label class="ipn-lb">备注 <span class="ipn-cnt">{{ (form.note || '').length }}/500</span></label>
        <input v-model.trim="form.note" maxlength="500" class="input" placeholder="选填" />
      </div>
    </div>

    <!-- 供应商信息条（舟谱那一条「应付余额 / 预付余额」的位置；这里只放**真有的数据**） -->
    <div v-if="!isReturn" class="ipn-strip">
      <span class="ipn-si">
        <span class="ipn-sk">供应商</span>
        <b>{{ selSupplier ? selSupplier.name : '未选择' }}</b>
      </span>
      <!-- P1-1：选了供应商即显示它的**跨单**应付 / 预付余额，开单前就知道「还欠这供应商多少 / 预先付了多少」。
           读取中显示 `…`；读失败 / 没读到显示 `—`（「不知道」，不编成 0，本仓铁律）；读到了即便 ¥0.00 也照实显示。 -->
      <span v-if="selSupplier" class="ipn-si">
        <span class="ipn-sk">应付余额</span>
        <b class="ipn-strip-amt">{{ supBalLoading ? '…' : (supBal ? '¥' + fmtMoney(supBal.payable) : '—') }}</b>
      </span>
      <span v-if="selSupplier" class="ipn-si">
        <span class="ipn-sk">预付余额</span>
        <b class="ipn-strip-amt">{{ supBalLoading ? '…' : (supBal ? '¥' + fmtMoney(supBal.prepaid) : '—') }}</b>
      </span>
      <span v-if="selSupplier && Number(selSupplier.credit_days) > 0" class="ipn-si">
        <span class="ipn-sk">账期</span><b>{{ Number(selSupplier.credit_days) }} 天</b>
      </span>
      <span class="ipn-si">
        <span class="ipn-sk">已录商品</span><b>{{ items.length }} 项</b>
      </span>
      <span class="ipn-si">
        <span class="ipn-sk">合计</span><b class="ipn-strip-amt">¥{{ fmtMoney(totalAmount) }}</b>
      </span>
    </div>

    <!-- ══ v415（P2-7）自定义字段（**整单**维度，不是明细行维度）═══════════════
         ① 只在**这个租户真的建过字段**时出现 —— 没建过一个格子都不渲染，不给空表单；
         ② 字段清单来自服务端注册表，本页**不预置任何字段名**；
         ③ 类型只有文本 / 数字两种，数字框用 `inputmode=decimal` 唤起数字键盘
            （**不在前端判"是不是数字"**：判据唯一实现在后端，这里判一遍就是第二份，
             而两份在边界上必然分岔 —— 发原字符串、由后端 400 报人话）。 -->
    <div v-if="!isReturn && cfDefs.length" class="ipn-hd ipn-hd-flat">
      <div v-for="c in cfDefs" :key="c.key" class="ipn-f">
        <label class="ipn-lb">{{ c.label }}</label>
        <input v-model="extra[c.key]" class="input ipn-cf-in"
               :inputmode="c.num ? 'decimal' : 'text'"
               :placeholder="c.num ? '数字，选填' : '选填'" />
      </div>
    </div>
    <!-- 定义读失败 ⇒ 如实说一句。**不能静默**：用户上次建过字段、这次开单看不到，
         会读成「我的字段没了」；真相是"没读到"，而且建好后仍可在详情页补填。 -->
    <p v-else-if="!isReturn && cfLoaded && !cfOk" class="ipn-tip ipn-tip-stk">
      <Icon name="alert" :size="14" />
      <span>补充信息字段没读到（{{ cfErr || '原因未知' }}）；这张单先存不了它们，建好后可在详情页补填。</span>
    </p>

    <!-- 明细 -->
    <div v-if="!isReturn" class="ipn-body">
      <div class="ipn-bar">
        <b>商品明细</b>
        <span class="ipn-cnt">{{ items.length }} 项</span>
        <button class="ipn-tip-link" type="button" @click="showNotes = !showNotes">
          口径说明 {{ showNotes ? '收起' : '展开' }}
        </button>
      </div>

      <p v-if="showNotes" class="ipn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>{{ PSI_NOTES.unit }} {{ PSI_NOTES.expiry }}</span>
      </p>
      <!-- v408（P1-1）：库存两列的**仓口径**，默认折叠，点「展开」才显示 —— 对齐舟谱「一行小字」的疏朗感。
           🔴 不写会发生什么：用户默认它是「全部仓合计」（舟谱那种），于是在总仓 / 临期仓
              之间看到「同一个商品两个数」，得出「系统算错了」的结论 —— 正是要避免的
              「同屏两个数对不上」。仓名跟着「入库仓库」下拉实时变。 -->
      <p v-if="showNotes" class="ipn-tip ipn-tip-stk">
        <Icon name="package" :size="14" />
        <span v-if="stockState === 'err'">
          库存读取失败：可用 / 实际库存两列显示 <b>—</b>，意思是「不知道」，不是 0。
        </span>
        <span v-else>
          可用 / 实际库存 = <b>{{ stockWarehouseLabel }}</b> 的库存。「可用」只算可销售批次，
          过期批次要走报损、不计入。
        </span>
      </p>

      <div v-if="!items.length" class="state-empty">还没有明细，点右上角「加一行」开始。</div>

      <div v-else class="table-wrap">
        <table class="tbl ipn-tbl">
          <thead>
            <tr>
              <th class="seq-th">序号</th>
              <th class="ipn-c-prod">商品</th>
              <th class="ipn-c-code">条码</th>
              <th class="ipn-c-unit">单位</th>
              <!-- v408（P1-1）库存两列：口径 = **本页所选「入库仓库」**（不是全部仓的合计）。
                   数量来自 `/api/psi/stock/by-product`，按商品聚合（不是批次级）。 -->
              <th class="num ipn-c-stk" title="可销售的库存（已过期批次须报损，不计入）">可用库存</th>
              <th class="num ipn-c-stk" title="该仓全部批次的数量合计（含已过期）">实际库存</th>
              <th class="num ipn-c-ref">参考成本价</th>
              <th class="num ipn-c-price">采购价</th>
              <th class="num ipn-c-qty">订单数量</th>
              <th class="num ipn-c-amt">订单金额</th>
              <th class="ipn-c-batch">批次号 <span class="ipn-opt">选填</span></th>
              <th class="ipn-c-date">到期日 <span class="ipn-opt">选填</span></th>
              <th class="ipn-c-date">生产日期</th>
              <!-- v408（P1-2）行备注：**记在明细行上**（不是整单备注）。舟谱同列。 -->
              <th class="ipn-c-note">行备注</th>
              <th class="ipn-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="row.uid">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td class="ipn-c-prod">
                <select v-model.number="row.product_id" class="input ipn-in" @change="onPick(row)">
                  <option :value="0" disabled>请选择商品</option>
                  <option v-for="p in prodOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td class="ipn-c-code">{{ row.barcode || '—' }}</td>
              <td class="ipn-c-unit">
                <!-- v409（P2-1）：单位改成**三档下拉**（小 / 中 / 大）。档位清单来自后端
                     `unit_options`（商品档案里真正存在的档，缺一档就少一项 —— 不给空档位）。 -->
                <select v-if="unitOptionsOf(row).length" v-model="row.unit"
                        class="input ipn-in ipn-unit-sel" :title="row.convText || row.unit">
                  <option v-for="o in unitOptionsOf(row)" :key="o.key" :value="o.name">{{ o.name }}</option>
                </select>
                <span v-else class="ipn-unit none">先选商品</span>
                <div v-if="row.convText" class="ipn-conv">{{ row.convText }}</div>
              </td>
              <td class="num ipn-c-stk">
                <span v-if="!row.product_id" class="ipn-stk-none">先选商品</span>
                <span v-else :class="{ danger: isAllExpired(row) }" :title="stockTitle(row)">{{ stockText(row, 'saleable_quantity') }}</span>
              </td>
              <td class="num ipn-c-stk">
                <span v-if="!row.product_id" class="ipn-stk-none">先选商品</span>
                <span v-else :title="stockTitle(row)">{{ stockText(row, 'quantity') }}</span>
              </td>
              <td class="num ipn-c-ref">{{ row.purchase_price ? '¥' + fmtMoney(row.purchase_price) : '—' }}</td>
              <td class="ipn-c-price">
                <input v-model="row.unit_price" class="input ipn-in num" inputmode="decimal" placeholder="0.00" />
                <!-- v409（P2-1）双单位采购价：舟谱是「100 / 5/箱」两行，这里在所选档单价下面
                     补一行折小单位价。**只在所选档不是小档时显示**（是小档时两行数字相同）。 -->
                <div v-if="ratioOf(row) > 1 && basePriceOf(row)" class="ipn-conv">
                  折 {{ fmtMoney(basePriceOf(row)) }} 元/{{ row.baseUnit || '小单位' }}
                </div>
              </td>
              <td class="ipn-c-qty">
                <input v-model="row.quantity" class="input ipn-in num" inputmode="decimal" placeholder="0" />
                <!-- v409：折小单位数量 —— 让用户**下单时就看见**库存会进多少（不是事后才发现）。 -->
                <div v-if="ratioOf(row) > 1 && baseQtyOf(row)" class="ipn-conv">
                  = {{ baseQtyOf(row) }} {{ row.baseUnit || '小单位' }}
                </div>
              </td>
              <td class="num ipn-amt">¥{{ fmtMoney(rowAmount(row)) }}</td>
              <td class="ipn-c-batch">
                <input v-model.trim="row.batch_no" class="input ipn-in" placeholder="如 20261101" />
              </td>
              <td class="ipn-c-date"><input type="date" v-model="row.expiry_date" class="input ipn-in" /></td>
              <td class="ipn-c-date"><input type="date" v-model="row.production_date" class="input ipn-in" /></td>
              <td class="ipn-c-note">
                <input v-model.trim="row.note" maxlength="200" class="input ipn-in" placeholder="选填" />
              </td>
              <td class="ipn-c-op">
                <button class="ipn-ic" title="在这一行下面插一行" @click="insertAfter(i)"><Icon name="plus" :size="14" /></button>
                <button class="ipn-ic danger" title="删除这一行" @click="removeRow(i)"><Icon name="trash" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 底部动作条（对齐舟谱：合计在左、动作在右下）。
         🔴 sticky 贴住滚动容器底边；`margin-inline:-20px` 抵消 Shell 的 `.view-wrap{padding:20px}`
            ⇒ 动作条满宽。若那份 padding 改了，这里要跟着改（两处唯一的耦合点）。 -->
    <div v-if="!isReturn" class="ipn-bottom">
      <span class="ipn-total">合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
      <span v-if="totalAmount >= 5000" class="ipn-warn">
        金额较大时，保存后会先进入「待审批」，审批通过才能确认入库。
      </span>
      <div class="ipn-save">
        <!-- 保存 ▾ -->
        <div class="ipn-dd">
          <button class="btn btn-ghost btn-sm ipn-dd-main" :disabled="saving" @click="submit('save')">
            <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
          </button>
          <button class="btn btn-ghost btn-sm ipn-dd-caret" :disabled="saving"
                  title="更多保存方式" @click.stop="saveOpen = !saveOpen">
            <span class="ipn-caret" :class="{ up: saveOpen }"></span>
          </button>
          <div v-if="saveOpen" class="ipn-menu" @click.stop>
            <button class="ipn-mi" @click="submit('save')">保存</button>
            <button class="ipn-mi" @click="submit('new')">保存并新增</button>
            <button class="ipn-mi" @click="submit('print')">保存并打印</button>
          </div>
        </div>
        <!-- 保存并审核 ▾（主按钮，对齐舟谱双下拉） -->
        <div class="ipn-dd">
          <button class="btn btn-primary btn-sm ipn-dd-main" :disabled="saving" @click="submit('approve')">
            <Icon name="check" :size="14" />{{ saving ? '提交中…' : '保存并审核' }}
          </button>
          <button class="btn btn-primary btn-sm ipn-dd-caret" :disabled="saving"
                  title="更多审核方式" @click.stop="approveOpen = !approveOpen">
            <span class="ipn-caret" :class="{ up: approveOpen }"></span>
          </button>
          <div v-if="approveOpen" class="ipn-menu" @click.stop>
            <button class="ipn-mi" @click="submit('approve')">保存并审核</button>
            <button class="ipn-mi" @click="submit('approveNew')">审核并新增</button>
            <button class="ipn-mi" @click="submit('approvePrint')">审核并打印</button>
            <button class="ipn-mi ipn-mi-disabled" @click="submit('approveIssue')">审核并发单 <span class="ipn-mi-tag">待接口</span></button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 新建采购单 —— 数据源：`POST /api/psi/purchase-orders`（委派既有建单逻辑）。
   ------------------------------------------------------------------
   🔴 v417：「批次号 + 到期日」改为**选填**（不是 UI 偏好变化，是后端已兜住）：
      原担心「批次号为空 ⇒ batch_in 每行新建」——该问题 v392 已在后端修掉：
      `purchases.py` 的 confirm 在批次号为空时自动生成默认批次号 `today-oid`，
      故留空不再写出空批次、也不会出现重复行。
      到期日留空 ⇒ 该批次进「无到期日」桶（FEFO 排最后），临期预警对它不生效 —— 属可接受语义。
      只有「填了到期日却格式非法」才在前端拦截（见 validate()）。

   🔴 v409（P2-1）单位**三档全给**（小 / 中 / 大，档位由后端 `unit_options` 下发）：
      默认取商品档案的「报单单位」，没设则回落**小单位**并显弱色（不静默）。
      换算比**不在这里算** —— 由后端 `db/queries/units.py` 唯一实现，本页只读 `ratio`
      做「折小单位价 / 折小数量」两行提示；**入库折多少由后端按档案现算并快照进明细行**
      （`base_ratio` / `base_qty`），前端传的只有单位名。
      ⚠️ 这推翻了 v408 之前的「不做跨单位换算」口径：那时只存数量不存单位，按大单位下单
      会让库存少记一整个量级；现在量纲统一到小单位，三档才敢放开给。

   🔴 v403 修掉一个「填了等于没填」：`expected_date` 以前**不在后端 Pydantic 模型里**，
      前端传了被 `extra='ignore'` 静默丢弃。本页把「单据日期 / 预计到货日期」都做成真实
      落库的字段（单据日期可由用户改，用来补录昨天的到货单）。

   ⚠️ 审批阈值（5000）在**后端**读 `system_config`；这里那句提示只用于「提前告知」，
      不参与任何判断（判断在后端，改了阈值这里不会错拦）。
   ⚠️ 「保存并审核」= 建单成功后再走**同一个审核原语**（`/batch` 的 approve），
      不在这里重写审核规则；审核失败（例如单据已被别人审过）会如实报出来。
   🔴 为什么必须新开端点：`/api/psi/stock` 是**批次级 + limit(200)**，前端自己累加会
         在批次多时被截断，得到偏小的数且零报错；`/api/psi/stock/summary` 是全仓 KPI、不分商品。
      🔴 我方「可用」≠ 舟谱「可用」：舟谱扣「被订单占用」，本系统**没有占用/锁定概念**
         （销售单在 `deliver` 时才扣库存）⇒ 此处「可用」= **可销售**（唯一不可售来源 = 过期批次）。
   ✅ v408（P1-2）起「行备注」列**已实现**（此前这段注释说没有，已过期）：
      `purchase_order_items.note`（`_safe_migrate` + 租户清单**两处**成对加列），
      明细 INSERT 走「**空则不加列**」⇒ 不填时 SQL 与改动前逐字一致。
      ⚠️ 与表头的整单「备注」**不是一回事**：前者是"这一行为什么这么订"，后者是"整单说明"。 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { toast } from '../../store'
import { PSI_NOTES, fmtMoney, PO_STATUS, textOf } from '../../constants/psiLabels'
/* v415（P2-7）采购单自定义字段。定义与值读取抽在 composable 里（列表页 / 详情页共用），
   本页只用它的「定义」与「类型」两件事：按类型给文本框 / 数字框。 */
import { usePurchaseCustomFields } from '../../composables/purchaseCustomFields.js'

const router = useRouter()
const route = useRoute()

const saving = ref(false)
const saveOpen = ref(false)
const approveOpen = ref(false)
const suppliers = ref([])
const warehouses = ref([])
const products = ref([])
/* v408（P0-5）「经办人 / 部门」两个下拉的数据源。
   🔴 `users` 读**主库账号**（`refs?kind=users`）。主库不可读时后端**不返回这个键**
      ⇒ 必须 `Array.isArray` 判存在、缺了就留空数组（下拉只剩「不指定」），
      **不要**改用 `hr_employees` 顶替：两表是不同编号（users id=2=张俊峰 /
      hr_employees id=2=王老板），同一个 id 会显示成另一个人、选出来归属是错的且零报错。 */
const users = ref([])
const departments = ref([])
const supKw = ref('')
const prodKw = ref('')
/* v414（P2-6）：`kind` / `from_po` / `copy` **全部走 computed + watch**，不取一次性常量。
   🔴 为什么：`/inventory/purchase/new` 是**同一条 path**，`?kind=order` ↔ `?kind=return`
      切换时 vue-router **复用同一个组件实例**（path 没变）⇒ `onMounted` 不会再跑，
      页面会停在旧模式 / 旧数据上，而且**零报错**。
      （与 v403 的 `oid` / `kind` 必须 computed + watch 是同一类坑。） */
const kind = computed(() => String((route.query && route.query.kind) || 'order'))
const isReturn = computed(() => kind.value === 'return')
const fromPoQ = computed(() => Number((route.query && route.query.from_po) || 0) || 0)
const copyId = computed(() => Number((route.query && route.query.copy) || 0) || 0)
/* P1-4：编辑一张已存采购单。`?edit=oid` 来自详情页的「编辑」按钮；只有状态 ∈ 可编辑三态
   （draft / pending_approval / cancelled）才允许编辑，其余状态在 `loadEdit` 里拦下并退回详情页。 */
const editId = computed(() => Number((route.query && route.query.edit) || 0) || 0)

const pageTitle = computed(() => isReturn.value
  ? '新建采购退货单'
  : (editId.value ? '编辑采购单'
                  : (copyId.value ? '复制采购单' : '新建采购单')))
const pageSub = computed(() => isReturn.value
  ? '对已入库的采购单退货：按可退数量填，提交后扣库存并把原单标记为「已退货」'
  : (editId.value
       ? '可改供应商、明细与备注；已入库 / 在途的单不能在此改，请到详情页处理'
       : (copyId.value ? '按原单带出商品与价格，批次与到期日按这次到货重填'
                       : '进货登记，到货后按这里的批次与到期日入库')))

function todayISO () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = ref({
  supplier_id: 0, warehouse_id: 0,
  order_date: todayISO(), expected_date: '', note: '',
  /* v408（P0-5）：`handler` 存**主库 users.id 的字符串**（与 `operator_id` 同取值域，
     但**不是**同一个东西 —— 那是"谁建的"、这是"归谁办"）；`department_id` 存
     `departments.id`，**0 = 不指定**（不是"总部"，总部是 1）。 */
  handler: '', department_id: 0,
})
/* `uid` 只用于 `v-for` 的 key —— 用下标当 key 时，删中间一行会让后面所有行的
   DOM 复用错位（输入框内容跟着串行）。 */
let _uid = 0
const items = ref([])

/* ══ v415（P2-7）自定义字段（整单维度，不是明细行维度）═══════════════════════
   🔴 为什么值**随建单一起提交**、而不是建完再调 `/extra` 写一遍：
      分两次写会出现「单建成了、自定义字段没落库」的半截状态，而用户看到的是"保存成功"
      （静默半截）。后端 `purchase_order_create` 接 `extra` 并与单据**同事务**落库。
   🔴 为什么值一律按**字符串**发出（数字字段也不 `Number()` 一下）：
      `Number('abc')` = `NaN`，而 `JSON.stringify({a: NaN})` = `{"a":null}` ——
      后端 `_coerce(None)` 会把它当**清空**处理 ⇒ 用户填了乱字符、保存后字段是空的、
      零报错。发原字符串则由后端唯一实现报 400「「abc」不是数字」，错误可见。
   🔴 `extra` 里**只放非空值**：空 ⇒ 不发这个键（≡ 没填）。后端那边也是"空则不写列"
      ⇒ 一个字段都不填时，建单 SQL 与这次改动前**逐字一致**（第六次用这个范式）。 */
const { defs: cfDefs, ok: cfOk, err: cfErr, loaded: cfLoaded,
        loadDefs: loadCfDefs } = usePurchaseCustomFields()
const extra = ref({})

/** 提交体里的 `extra`：只发**填了内容**的键。 */
const cfPayload = computed(() => {
  const o = {}
  cfDefs.value.forEach(c => {
    const v = extra.value[c.key]
    if (v === undefined || v === null) return
    const s = String(v).trim()
    if (s === '') return
    o[c.key] = s
  })
  return o
})

const prodOptions = computed(() => {
  const k = prodKw.value.trim().toLowerCase()
  if (!k) return products.value
  return products.value.filter(p => (p.name || '').toLowerCase().includes(k))
})
const selSupplier = computed(() => suppliers.value.find(s => s.id === form.value.supplier_id) || null)
const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

/* P1-1：选了供应商即拉它的**跨单**应付 / 预付余额（后端 `supplier_balance`），开单前就知道
   「还欠这供应商多少 / 预先付了多少」。
   🔴 `supBal` 为 null = 没读到 / 读失败 ⇒ 界面显示 `—`（「不知道」不编成 0，本仓铁律）；
      读取中显示 `…`；读成功才显示金额（含 ¥0.00，那是真·不欠，与「不知道」是两回事）。
   🔴 退货模式不显示这条、也不发请求（仓库下拉都没必要拉余额）。 */
const supBal = ref(null)
const supBalLoading = ref(false)
// v417：商品明细上方的「库存口径」提示默认折叠（首屏更疏朗，对齐舟谱），点「展开」才显示
const showNotes = ref(false)
async function loadSupplierBalance (sid) {
  supBal.value = null
  const id = Number(sid || 0)
  if (!id) return
  supBalLoading.value = true
  try {
    const d = await psiApi.supplierBalance(id)
    supBal.value = { payable: Number(d.payable || 0), prepaid: Number(d.prepaid || 0) }
  } catch (e) {
    supBal.value = null   // 如实显示 —，不假装 0
  } finally {
    supBalLoading.value = false
  }
}
watch(() => form.value.supplier_id, (v) => { if (isReturn.value) return; loadSupplierBalance(v) })

/* ══ v408（P1-1）可用库存 / 实际库存 ═══════════════════════════════════════
   🔴 口径（用户已拍定）：「**用户在页面选的什么仓库就显示该仓库的可用库存**」
      ⇒ 请求带上 `form.warehouse_id`；用户改仓库时两列会跟着重取（下面有 watch）。
   🔴 `stockState` 存在的唯一理由：区分「**是 0**」与「**不知道**」。
      · `err`  ⇒ 两列显示 `—`（本仓铁律：缺值不编，绝不用 0 冒充）
      · `ok`   ⇒ rows 里没有该商品 = 查过了、该仓确实 0 ⇒ 显示 `0`
      少了这个状态，接口一失败就会满屏 0，看起来像"仓库空了"。
   ══════════════════════════════════════════════════════════════════════ */
const stockMap = ref({})
const stockState = ref('ok')
const stockWarehouseLabel = computed(() => {
  const w = warehouses.value.find(x => x.id === Number(form.value.warehouse_id))
  return w ? w.name : '全部仓库'
})

/** 整数不带小数点（与销售报表口径一致），非整数保留 2 位。 */
function fmtQty (v) {
  const n = Number(v || 0)
  if (!isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function stockText (row, key) {
  if (stockState.value !== 'ok') return '—'
  const r = stockMap.value[Number(row.product_id)]
  return fmtQty(r ? r[key] : 0)
}

/** 实际有货、但一件都不可售（全过期）—— 值得在界面上点出来，否则用户会以为"有货能卖"。 */
function isAllExpired (row) {
  if (stockState.value !== 'ok') return false
  const r = stockMap.value[Number(row.product_id)]
  return !!r && Number(r.quantity) > 0 && Number(r.saleable_quantity) <= 0
}

function stockTitle (row) {
  if (stockState.value !== 'ok') return '库存没读到（接口失败），不代表是 0'
  const r = stockMap.value[Number(row.product_id)]
  const w = stockWarehouseLabel.value
  if (!r) return `${w}：没有这个商品的库存`
  const parts = [`${w}：实际 ${fmtQty(r.quantity)}、可用 ${fmtQty(r.saleable_quantity)}`]
  if (Number(r.expired_quantity) > 0) parts.push(`其中 ${fmtQty(r.expired_quantity)} 已过期（须报损）`)
  if (Number(r.no_expiry_quantity) > 0) parts.push(`${fmtQty(r.no_expiry_quantity)} 没有到期日`)
  if (Number(r.batch_rows) > 0) parts.push(`${r.batch_rows} 个批次`)
  return parts.join('；')
}

/* 请求序号：用户连续选商品时会并发多次请求，**慢的那个后到就会盖掉新数据**
   （界面显示上一次的结果、零报错）。只认最后一次发出的响应。 */
let _stockSeq = 0
async function loadStock () {
  const ids = [...new Set(items.value.map(r => Number(r.product_id) || 0).filter(x => x > 0))]
  if (!ids.length) { stockMap.value = {}; stockState.value = 'ok'; return }
  const seq = ++_stockSeq
  try {
    const d = await psiApi.stockByProduct(ids, Number(form.value.warehouse_id) || 0)
    if (seq !== _stockSeq) return
    const m = {}
    for (const r of (d.rows || [])) m[Number(r.product_id)] = r
    stockMap.value = m
    stockState.value = 'ok'
  } catch (e) {
    if (seq !== _stockSeq) return
    stockMap.value = {}
    stockState.value = 'err'
    toast(e.message || '库存读取失败', 'error')
  }
}

/* 🔴 用 watch 而不是在 `onPick` / `removeRow` / `loadCopy` / `resetForNext` 里各调一次：
   那四处（将来还会更多）**漏一处就是静默显示旧库存**。watch 的输入就是"当前需要查哪些
   商品 + 哪个仓"，任何一条路径改了它们都会自动重取，不存在漏点。
   ⚠️ key 用 join(',') 的字符串而不是数组：数组每次都是新引用，会让 watch 无脑触发。 */
const _stockKey = computed(() => items.value.map(r => Number(r.product_id) || 0).join(','))
watch([_stockKey, () => form.value.warehouse_id], () => { loadStock() })

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  if (!q || !p) return 0
  return Math.round(q * p * 100) / 100
}

/* v409（P2-1）三档单位：下拉的档位**由后端下发**（`unit_options`），前端不自己算换算比。
   🔴 为什么：`medium_ratio / large_ratio` 在库里是**混类型列**（有 191 行是空串），
      `'' > 0` 在 SQLite 为真、在 JS 为假 —— 同一条规则两端结论相反，前端再判一次
      就是「第二份实现」。判定只有一份，在 `server/db/queries/units.py`。 */
function unitOptionsOf (row) {
  return Array.isArray(row.unitOptions) ? row.unitOptions : []
}
/** 当前所选档位的换算比（1 该档 = ratio 个小单位）。没选 / 单档 ⇒ 1。 */
function ratioOf (row) {
  const o = unitOptionsOf(row).find(x => x.name === row.unit)
  return Number(o && o.ratio) || 1
}
/** 折小单位数量（只用于提示，真正入库的折算在后端做）。 */
function baseQtyOf (row) {
  const q = Number(row.quantity || 0)
  if (!q) return 0
  return Math.round(q * ratioOf(row) * 10000) / 10000
}
/** 折小单位单价（元/小单位）—— 舟谱的「采购价双单位」就是这个第二行。 */
function basePriceOf (row) {
  const p = Number(row.unit_price || 0)
  if (!p) return 0
  return Math.round((p / ratioOf(row)) * 100) / 100
}

function blankRow () {
  return {
    uid: ++_uid, product_id: 0, quantity: '', unit: '', unitFromBase: false,
    unit_price: '', barcode: '', purchase_price: 0,
    batch_no: '', expiry_date: '', production_date: '',
    // v408（P1-2）行备注。**刻意不参与 `validate()`**：它是选填，且后端是
    // 「空则不加列」⇒ 不填时 SQL 与改动前逐字一致。
    note: '',
    // v409（P1-2→P2-1）三档单位：档位清单 / 换算文案 / 档案小单位名，都由后端随商品下发。
    unitOptions: [], convText: '', baseUnit: '',
  }
}
function addRow () { items.value.push(blankRow()) }
function insertAfter (i) { items.value.splice(i + 1, 0, blankRow()) }
function removeRow (i) { items.value.splice(i, 1) }

/** 从商品档案带出单位 / 条码 / 参考成本价（价格可改）。
    v409（P2-1）：单位改成**三档可选**（小 / 中 / 大），档位清单由后端 `unit_options` 下发。
      · 默认档 = `order_unit`（报单单位）命中的那一档；没设 / 没命中 ⇒ **小档**。
        ⚠️ 这里按**单位名**匹配（与后端 `units.default_tier` 同一条规则、同一顺序），
        不是"再算一遍换算" —— 换算比一律读后端给的 `ratio`，本文件不出现 `× ratio` 之外
        的第二份换算（乘 ≠ 判定：`ratio` 本身就是后端算好的）。
      · `unitFromBase` 语义随之变化：旧 =「档案没设报单单位、回落基础单位」；
        现在 =「没设报单单位，默认按小单位」（回落仍发生，但不再是"异常"）。 */
function applyProduct (row) {
  const p = products.value.find(x => x.id === row.product_id)
  if (!p) {
    row.barcode = ''; row.purchase_price = 0
    row.unitOptions = []; row.convText = ''; row.baseUnit = ''; row.unit = ''
    row.unitFromBase = false
    return
  }
  row.unitOptions = Array.isArray(p.unit_options) ? p.unit_options : []
  row.convText = String(p.conv_text || '')
  row.baseUnit = String(p.unit || '')
  const ou = String(p.order_unit || '').trim()
  const hit = row.unitOptions.find(o => o.name === ou)
  // 已有单位（复制旧单 / 编辑）且在档位里 ⇒ **保留**，不要被档案默认值顶掉。
  const keep = row.unit && row.unitOptions.some(o => o.name === row.unit)
  if (!keep) {
    row.unit = hit ? hit.name : (row.unitOptions[0] ? row.unitOptions[0].name : '')
    row.unitFromBase = !hit && !!row.unit
  }
  row.barcode = String(p.barcode || '')
  row.purchase_price = Number(p.purchase_price || 0)
}
function onPick (row) {
  applyProduct(row)
  if (!row.unit_price && row.purchase_price > 0) row.unit_price = String(row.purchase_price)
}

async function loadSuppliers () {
  try {
    const d = await psiApi.refs('suppliers', supKw.value, 200)
    suppliers.value = d.suppliers || []
  } catch (e) {
    toast(e.message || '供应商读取失败', 'error')
  }
}

/* ---- 复制：按原单带出商品与价格。**批次三列刻意不带** ----------------------------
   🔴 复制一张旧单去买新的一批货，批次号/到期日一定是**新的** —— 沿用旧值会让
      这批货在库里被并进上次那个批次（批次号相同 ⇒ `batch_in` 累加），库存与效期都错。
      所以这里清空并要求重填，并显式告知用户（不静默）。 */
async function loadCopy (oid) {
  try {
    const d = await psiApi.getPurchase(oid)
    const o = d.order || {}
    form.value.supplier_id = Number(o.supplier_id || 0)
    form.value.warehouse_id = Number(o.warehouse_id || 0)
    form.value.note = o.note || ''
    // v408（P0-5）：经办人 / 部门是**业务归属**，复制一张单多半还是同一个人办、
    // 同一个部门 ⇒ 一并带出（可改）。⚠️ 用 `??` 不用 `||`：`department_id` 为 0
    // 是合法值（"不指定"），`||` 会把它当假值吞掉 —— 结果一样但语义会误导后来人。
    form.value.handler = String(o.handler ?? '')
    form.value.department_id = Number(o.department_id ?? 0)
    items.value = (d.items || []).map(it => {
      const r = blankRow()
      r.product_id = Number(it.product_id || 0)
      r.quantity = it.quantity === null || it.quantity === undefined ? '' : String(it.quantity)
      r.unit_price = it.unit_price === null || it.unit_price === undefined ? '' : String(it.unit_price)
      r.unit = String(it.unit || '')
      // v408（P1-2）：行备注照带（复制一张单，"这一行为什么这么订"往往仍然成立，可改）。
      r.note = String(it.note || '')
      applyProduct(r)
      return r
    })
    if (!items.value.length) addRow()
    /* v415：自定义字段**刻意不带** —— 它是"这一张单"的事实（厂家结算单号、承运人等），
       复制一张旧单去买新一批货时，那些值属于上一单。带了就是编数据。
       显式说出来，免得用户以为复制漏了东西。 */
    toast('已按原单带出商品与价格；批次号、到期日和自定义字段要按这一单重新登记', 'info')
  } catch (e) {
    toast(e.message || '原单读取失败', 'error')
    addRow()
  }
}

/* ---- 编辑：按已存单带出**全部可编辑字段**（含批次 / 到期日 / 自定义字段） -----------------
   🔴 与复制模式刻意不同：复制是「买新一批货」，批次三列与自定义字段**刻意不带**（那是上一单的事实）；
      而编辑是「改这一单」，所以批次 / 到期日**照带可改**（用户要改的是这一批货的批次），自定义字段也照带保留。
   🔴 闸门在前端先拦一遍：只有可编辑三态（draft / pending_approval / cancelled）才允许进来；
      已入库等状态后端 `purchase_order_update` 也会 400 拒，但先拦能给明白话、避免白拉数据。
   🔴 自定义字段：从 `order.extra` 预填进 `extra.value`（只填仍在注册表里的键），保存时随 `cfPayload`
      一并发出 ⇒ 不会因"没重新填"就把原值清空（后端 `extra={}` 会清空 extra_json，必须预填）。 */
async function loadEdit (oid) {
  try {
    const d = await psiApi.getPurchase(oid)
    const o = d.order || {}
    const editable = ['draft', 'pending_approval', 'cancelled']
    if (!editable.includes(o.status)) {
      toast(`这张单是「${poStatusText(o.status || '')}」，已入库 / 在途，不能在本页编辑；要改请走「退货」或回详情页`, 'warn')
      router.replace('/inventory/purchase/' + oid)
      return
    }
    form.value.supplier_id = Number(o.supplier_id || 0)
    form.value.warehouse_id = Number(o.warehouse_id || 0)
    form.value.order_date = o.order_date || todayISO()
    form.value.expected_date = o.expected_date || ''
    form.value.note = o.note || ''
    form.value.handler = String(o.handler ?? '')
    form.value.department_id = Number(o.department_id ?? 0)
    items.value = (d.items || []).map(it => {
      const r = blankRow()
      r.product_id = Number(it.product_id || 0)
      r.quantity = it.quantity === null || it.quantity === undefined ? '' : String(it.quantity)
      r.unit_price = it.unit_price === null || it.unit_price === undefined ? '' : String(it.unit_price)
      r.unit = String(it.unit || '')
      r.batch_no = String(it.batch_no || '')
      r.expiry_date = it.expiry_date || ''
      r.production_date = it.production_date || ''
      r.note = String(it.note || '')
      applyProduct(r)
      return r
    })
    if (!items.value.length) addRow()
    // v415：自定义字段照带（仅仍在注册表里的键）
    const ex = (o.extra && typeof o.extra === 'object') ? o.extra : {}
    const e = {}
    cfDefs.value.forEach(c => {
      const v = ex[c.key]
      if (v !== undefined && v !== null && String(v).trim() !== '') e[c.key] = String(v)
    })
    extra.value = e
    toast('已载入这张单，修改后保存即可', 'info')
  } catch (e) {
    toast(e.message || '原单读取失败', 'error')
    addRow()
  }
}

/* ---- 提交前校验：**逐项显式报错**，不静默放过任何一行 --------------------------
   ⚠️ 日期格式在这里也校验一次：后端会 400（脏日期会让按日期筛选与排序静默出错），
      但等到提交后才报错、还要用户回头找是哪一行，是没必要的往返。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate () {
  if (!form.value.supplier_id) return '请先选择供应商'
  if (!form.value.warehouse_id) return '请选择入库仓库'
  if (form.value.order_date && !DATE_RE.test(form.value.order_date)) return '单据日期格式不正确，请用日期选择器选'
  if (form.value.expected_date && !DATE_RE.test(form.value.expected_date)) return '预计到货日期格式不正确，请用日期选择器选'
  if (!items.value.length) return '请至少添加一行商品明细'
  for (let i = 0; i < items.value.length; i++) {
    const r = items.value[i]
    const at = `第 ${i + 1} 行`
    if (!r.product_id) return `${at}：请选择商品`
    if (!(Number(r.quantity) > 0)) return `${at}：数量要大于 0`
    if (Number(r.unit_price) < 0 || r.unit_price === '') return `${at}：请填写采购价`
    // v417：批次号 + 到期日改为**选填**（老板快速建单不必每次都填）。
    //   · 批次号留空 ⇒ 后端 confirm 自动生成默认批次号（today-oid），不会写出空批次；
    //   · 到期日留空 ⇒ 该批次进「无到期日」桶（FEFO 排最后），临期预警对它不生效；
    //   · 只有「填了到期日却格式非法」才拦截，避免把非法字符串送后端。
    if (r.expiry_date && !DATE_RE.test(r.expiry_date)) return `${at}：到期日格式不正确，请用日期选择器选`
    if (r.production_date && !DATE_RE.test(r.production_date)) return `${at}：生产日期格式不正确`
  }
  return ''
}

function resetForNext () {
  const keep = { supplier_id: form.value.supplier_id, warehouse_id: form.value.warehouse_id,
    order_date: form.value.order_date, expected_date: form.value.expected_date, note: '',
    // v408（P0-5）：连着建几张单，经办人 / 部门通常不变 ⇒ 保留（与供应商、仓库同理）
    handler: form.value.handler, department_id: form.value.department_id }
  form.value = keep
  items.value = [blankRow()]
  prodKw.value = ''
  // v415：自定义字段是**这一张单**的信息（如厂家结算单号）⇒ 连开下一张时清空，
  // 不沿用 —— 沿用会让新单继承上一单的事实，比留空更危险。
  extra.value = {}
}

async function submit (mode) {
  saveOpen.value = false
  const bad = validate()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  saving.value = true
  try {
    const body = {
      supplier_id: form.value.supplier_id,
      warehouse_id: form.value.warehouse_id,
      order_date: form.value.order_date || '',
      expected_date: form.value.expected_date || '',
      note: form.value.note || '',
      // v408（P0-5）：选填，不填就传空 ⇒ 后端「空则不加列」，SQL 与改动前逐字一致
      handler: form.value.handler || '',
      department_id: Number(form.value.department_id) || 0,
      /* v415（P2-7）自定义字段：**随单同事务**落库（不另调 /extra，避免"单成了、字段没了"
         的半截状态）。一个都没填 ⇒ `{}` ⇒ 后端「空则不加列」⇒ 建单 SQL 与改动前逐字一致。 */
      extra: cfPayload.value,
      /* v417（B 语义「保存并审核」）：新建/复制态直接建为已审核 confirmed（自己保存自己审核，
         一步到位，不再二次调审核接口）；编辑态不加 status，保留 update + 批量审核原语。 */
      status: ((mode === 'approve' || mode === 'approveNew' || mode === 'approvePrint' || mode === 'approveIssue') && !editId.value) ? 'confirmed' : '',
      items: items.value.map(r => ({
        product_id: r.product_id,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price),
        unit: r.unit || '',
        batch_no: String(r.batch_no).trim(),
        expiry_date: r.expiry_date,
        production_date: r.production_date || '',
        // v408（P1-2）行备注：选填，空串 ⇒ 后端「空则不加列」
        note: String(r.note || '').trim(),
      })),
    }
    /* P1-4：编辑模式走 `updatePurchase`（整单重写，已入库由后端 400 拒）；新建 / 复制走 `createPurchase`。
       `no` 在编辑态取不到 order_no ⇒ 用 oid 兜底，提示串照常成立。 */
    let r, oid, no
    const isApprove = mode === 'approve' || mode === 'approveNew' || mode === 'approvePrint' || mode === 'approveIssue'
    const isPrint = mode === 'print' || mode === 'approvePrint'
    const isNew = mode === 'new' || mode === 'approveNew'
    const isIssue = mode === 'approveIssue'
    if (editId.value) {
      r = await psiApi.updatePurchase(Number(editId.value), body)
      oid = Number(editId.value) || 0
    } else {
      r = await psiApi.createPurchase(body)
      oid = r && (r.order_id || r.id)
    }
    no = (r && r.order_no) || oid || ''

    if (isApprove) {
      if (editId.value) {
        /* 编辑态：仍走「更新 + 同一个审核原语」（update 不支持直接 confirmed），
           把单推到已审核，与新建态一致的业务语义；失败如实报出来。 */
        let note = ''
        try {
          const b = await psiApi.batchPurchases('approve', [oid])
          const f = (b.results || []).find(x => !x.ok)
          if (b.ok_count) note = '，已审核'
          else note = `，但审核未成功：${(f && f.reason) || '未说明原因'}`
        } catch (e) {
          note = `，但审核未成功：${e.message || '接口报错'}`
        }
        const tail = isIssue ? '，发单功能待后端接口' : ''
        toast(`采购单已保存（${no}）${note}${tail}`, note.includes('未成功') ? 'warn' : 'success')
      } else {
        // v417（B 语义）：新建/复制态已在 body 里带 `status='confirmed'` 一步建为已审核，
        // 自己保存自己审核，无需二次调审核接口。
        const tail = isIssue ? '，发单功能待后端接口' : '，待入库'
        toast(`采购单已保存并审核（${no}）${tail}`, 'success')
      }
    } else if (isPrint) {
      /* v412（P2-5）：打印对话框由详情页在数据就位后拉起 —— 这里先说清"接下来会发生什么"，
         否则用户会盯着这张还在编辑态的表单猜「打印怎么还没出来」。 */
      toast(`采购单已保存（${no}），正在打开打印`, 'success')
    } else {
      toast(`采购单已保存（${no}）`, 'success')
    }

    if (isNew) {
      // 编辑态下「再开一张」应跳出编辑上下文（否则路由仍带 ?edit= 会改到同一张单）
      if (editId.value) { router.replace('/inventory/purchase/new'); return }
      resetForNext(); return
    }
    /* v412（P2-5）「保存并打印」：打印对象是**详情页那张单据**（单头 / 明细 / 合计 / 供应商
       都在那儿），所以这里只带一个 `?print=1` 过去，由详情页在数据**加载完成后**触发打印。
       🔴 不能在这一页直接 `window.print()`：本页是**编辑态表单**（输入框 / 下拉 / 按钮 /
          空行都在），印出来是「屏幕」不是「单据」；供应商名与合计也要等保存回读才准。 */
    const _q = isPrint ? '?print=1' : ''
    if (oid) router.replace('/inventory/purchase/' + oid + _q)
    else router.replace('/inventory/purchase')
  } catch (e) {
    // 后端 detail 原样显示（例如「批次日期格式不正确：…」）
    toast(e.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ══ v414（P2-6）退货模式 ════════════════════════════════════════════════════
   退货的「数量」与「单价」**必须成对是「小单位」口径**（数量折小单位、单价折元/小单位），
   而且这一对值**由后端的可退预览给定** —— 本页**不做任何折算**。
   🔴 为什么不在前端算：后端 `purchase_return_create` 拿 `quantity` 直接扣库存
      （小单位量纲）；若前端自己 `× ratio`，那就是**第二份实现**，而 ratio 的来源列
      是混类型（空串）⇒ 两端判定会相反、必然分岔 —— 而退货是**不可逆**的库存动作。
   🔴 默认填**全部可退量**：「转单为退货」的正常语义就是把这批货退回去。省事靠默认值，
      误操作靠提交前的二次确认拦（不是靠让用户对着 0 一个个填）。
   ══════════════════════════════════════════════════════════════════════════ */
const poKw = ref('')
const poOptions = ref([])
const fromPo = ref(0)
const retPreview = ref(null)
const retRows = ref([])
const retReason = ref('')
const retLoading = ref(false)
const retError = ref('')
/** 基础资料是否已就绪（同一实例切模式时不重复拉 500 条下拉数据）。 */
const refsOk = ref(false)

const retOrder = computed(() => (retPreview.value && retPreview.value.order) || null)
const canReturn = computed(() =>
  !!(retPreview.value && retPreview.value.can_return) && retRows.value.length > 0)
const retBlockReason = computed(() => (retPreview.value && retPreview.value.reason) || '')
const retNote = computed(() => (retPreview.value && retPreview.value.note)
  || '数量按小单位填；可退 = 已入库 − 已退。')
const retRowsActive = computed(() => retRows.value.filter(r => Number(r.ret_qty) > 0))
const retActiveCount = computed(() => retRowsActive.value.length)
const retDoneCount = computed(() => retRows.value.filter(r => !(Number(r.returnable_qty) > 0)).length)
const retTotal = computed(() => retRows.value.reduce((s, r) => s + retRowAmount(r), 0))

function poStatusText (s) { return textOf(PO_STATUS, s) }
function retRowAmount (r) {
  const q = Number(r.ret_qty || 0)
  const p = Number(r.ret_price || 0)
  if (!q || !p) return 0
  return Math.round(q * p * 100) / 100
}

/** 可选原单：只列**进过货**的单（`returnable=1`）。没入库的单没有货可退。 */
function loadPoOptions () {
  return psiApi.listPurchases({ keyword: poKw.value.trim(), returnable: 1, limit: 100 })
    .then(d => { poOptions.value = d.orders || [] })
    .catch(e => { poOptions.value = []; toast(e.message || '原采购单读取失败', 'error') })
}

async function onPickPo () {
  retReason.value = ''
  await loadPreview(Number(fromPo.value) || 0)
}

async function loadPreview (oid) {
  retPreview.value = null; retRows.value = []; retError.value = ''
  if (!oid) return
  retLoading.value = true
  try {
    const d = await psiApi.returnPreview(oid)
    retPreview.value = d
    retRows.value = (d.items || []).map(x => ({
      ...x,
      // 默认 = 全部可退量（可改）。已退完的行给**空串**而不是 '0' —— 后者看起来像"要退 0"。
      ret_qty: Number(x.returnable_qty) > 0 ? String(x.returnable_qty) : '',
      // 单价 = 折小单位进货价（与 `ret_qty` 是同一量纲的一对，别再乘除一次）
      ret_price: x.base_unit_price ? String(x.base_unit_price) : '',
    }))
    if (!d.can_return && d.reason) toast(d.reason, 'warn')
  } catch (e) {
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
   （`psi_purchase_return` 拿可退预览重算上限）。它拦不住直接打接口的人。 */
function validateReturn () {
  if (!fromPo.value) return '请先选择原采购单'
  if (!retPreview.value) return '可退明细还没读出来'
  if (!retPreview.value.can_return) return retBlockReason.value || '这张单没有可退的货'
  for (const r of retRows.value) {
    const q = Number(r.ret_qty || 0)
    if (q < 0) return `「${r.product_name || '某商品'}」的退货数量不能是负数`
    if (q > Number(r.returnable_qty) + 1e-6) {
      return `「${r.product_name || '某商品'}」退货数量 ${q} 超过可退数量 ${r.returnable_qty}`
    }
  }
  if (!retRowsActive.value.length) return '请至少填一行退货数量'
  return ''
}

async function submitReturn () {
  const bad = validateReturn()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  const no = (retOrder.value && retOrder.value.order_no) || fromPo.value
  if (!window.confirm(`确认对采购单 ${no} 退货 ¥${fmtMoney(retTotal.value)} 吗？\n\n`
    + '提交后会扣减库存，并把这张单标记为「已退货」。此操作不可撤销。')) return
  saving.value = true
  try {
    await psiApi.returnPurchase(Number(fromPo.value), {
      reason: retReason.value.trim(),
      items: retRowsActive.value.map(r => ({
        product_id: r.product_id,
        product_name: r.product_name,
        quantity: Number(r.ret_qty),
        unit_price: Number(r.ret_price || 0),
      })),
    })
    toast(`退货单已生成（原采购单 ${no}）`, 'success')
    // 回「采购退货单」列表：原单已被标记「已退货」，它就在那张列表里
    router.replace('/inventory/purchase?kind=return')
  } catch (e) {
    // 后端 detail 原样显示（例如「退货数量 X 超过可退数量 Y」）
    toast(e.message || '退货失败', 'error')
  } finally {
    saving.value = false
  }
}

function back () { router.push('/inventory/purchase') }
function onDocClick () { saveOpen.value = false; approveOpen.value = false }

/** 基础资料（供应商 / 商品 / 仓库 / 部门 / 主库账号）。

    🔴 `kind` 只取本页真正要用的几类：拉 customers 会连 702 个客户的资料一起解密返回，
       开采购单根本用不到（少一次无谓的 PII 出库）。
       v408 追加 `departments`（部门下拉）与 `users`（经办人下拉）。
    ⚠️ `users` 主库读不到时后端**不返回该键** ⇒ 判存在；不拿员工档案顶替（见 refs 注释）。
    ⚠️ 退货模式**不需要**这些下拉，所以不在那条路径上调它（省一次 500 条的大查询）。
*/
async function loadRefs () {
  try {
    const d = await psiApi.refs('warehouses,suppliers,products,departments,users', '', 500)
    warehouses.value = d.warehouses || []
    suppliers.value = d.suppliers || []
    products.value = d.products || []
    departments.value = Array.isArray(d.departments) ? d.departments : []
    users.value = Array.isArray(d.users) ? d.users : []
    // 默认仓：优先 is_default，其次第一个（两个 is_default 时取 id 最小，仅作默认值，用户可改）
    const defs = warehouses.value.filter(w => w.is_default)
    const pick = (defs.length ? defs : warehouses.value).slice().sort((a, b) => a.id - b.id)[0]
    if (pick) form.value.warehouse_id = pick.id
    refsOk.value = true
  } catch (e) {
    toast(e.message || '基础资料读取失败', 'error')
  }
  /* v415：自定义字段定义**独立加载**，刻意放在上面那个 `try` **之外** ——
     基础资料读失败（suppliers / products 那 500 条）时，字段定义仍应照常尝试；
     两者的失败原因无关，串在一个 try 里会让一次失败连带另一样悄悄跳过。 */
  await loadCfDefs()
}

/** 按当前 URL（`kind` / `from_po` / `copy`）把页面重置到对应模式。

    🔴 必须是**可重入**的：两种模式共用同一个组件实例（见 `kind` 的注释），
       只写一个 `onMounted` 的话，切模式时页面会停在旧数据上且零报错。
    🔴 切模式时**清空对方的状态**（退货的明细 / 采购单的明细）：不清就会出现
       「退货页面上挂着几张采购明细」这种自相矛盾的屏幕。
*/
async function reinit () {
  saveOpen.value = false
  if (isReturn.value) {
    items.value = []
    prodKw.value = ''
    poKw.value = ''
    retReason.value = ''
    retError.value = ''
    poOptions.value = []
    retPreview.value = null
    retRows.value = []
    fromPo.value = fromPoQ.value
    if (fromPo.value) await loadPreview(fromPo.value)
    else await loadPoOptions()
    return
  }
  fromPo.value = 0
  retReason.value = ''
  retPreview.value = null
  retRows.value = []
  poOptions.value = []
  items.value = []
  extra.value = {}          // v415：切模式 / 换单 ⇒ 自定义字段的清空（不留上一单的值）
  supBal.value = null       // P1-1：切模式 / 换单 ⇒ 供应商余额复位（重新选供应商会再拉）
  if (!refsOk.value) await loadRefs()
  if (editId.value) await loadEdit(editId.value)
  else if (copyId.value) await loadCopy(copyId.value)
  else for (let i = 0; i < 5; i++) items.value.push(blankRow())
}

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  await reinit()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
watch([kind, fromPoQ, copyId], () => { reinit() })
</script>

<style scoped>
/* 🔴 竖排 + 底部条 `margin-top:auto` 两件套：目的是让底部动作条在**内容不足一屏时
   也钉在视口底部**（对齐舟谱：合计与保存在最底一行），内容超一屏时 `sticky bottom:0` 接管
   ⇒ 两种情况下位置都对。

   这里只需负责「本页是竖排容器」（`margin-top:auto` 在块布局里不生效，必须 flex）。
   真正让本页**长到一屏高**的是容器 `InventoryShell` 的 `.page{display:flex;flex-direction:column;
   min-height:100%}` + `.page > * { flex:1 1 auto }` —— 高度链的确定性在那一层打通。
   v403 实测：改前中间层高度 auto ⇒ 百分比链断开、动作条紧贴明细表（不在一屏底沿）；
   两处必须**成对**存在，只改一边就会退回原状。

   ⚠️ 若 `InventoryShell` 的容器契约改了（`.page` 不再是竖排 flex），这里要一起看。 */
.inv-page { display: flex; flex-direction: column; min-height: 100% }
.ipn-acts { display: flex; gap: 8px; flex-wrap: wrap }

/* v417d（对照舟谱：单屏行数 ↑）页头单行 —— 标题与副标题回到**同一基线行**（原为竖排两行）。
   全局 `.page-hd` 的「内联 / 堆叠」由模板结构分派：外面包一层 div 就会回落到两行，
   故这里只给内层容器定对齐，**不动全局类**（16~17 个页面共用它）。 */
.ipn-hd-t { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0 }

/* 表单头 */
.ipn-hd { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
/* v417d 去卡片包裹：本页「单头表单 / 明细」两块不再套 `.card` 的框。
   页面底 `.content{background:var(--bg)}` 与 `.card{background:var(--bg)}` 同色 ——
   那个框本来只是 border+shadow，去掉不影响配色（深色同理）。
   scoped 属性把特异性抬到 0,2,0 > 全局 `.card` 的 0,1,0，覆盖必然生效（无需 !important）。 */
.ipn-hd-flat { padding: 0; background: transparent; border: 0; border-radius: 0; box-shadow: none }
.ipn-f { display: flex; flex-direction: column; gap: 4px }
.ipn-f-grow { flex: 1; min-width: 180px }
.ipn-f-sup { min-width: 300px }
.ipn-lb { font-size: 12px; color: var(--t3) }
.ipn-req { color: var(--dan); font-size: 11px }
/* v408（P0-5）「选填」标记：弱于「必填」的红字 —— 它是提示不是警告 */
.ipn-opt { color: var(--t3); font-size: 11px }
/* v414（P2-6）退货模式：表单头下的说明（「只列出进过货的单」）—— 弱色小字 */
.ipn-hint { font-size: 11px; color: var(--t3); line-height: 1.4; max-width: 340px }
.ipn-hint b { color: var(--t2) }
/* 只读值（退货模式的供应商 / 退货仓库 / 原单状态）：与输入框**同高同位置**，
   看起来是表单里的一栏，但虚框表示不可改（不要用 disabled input —— 那会让人以为能点开） */
.ipn-ro {
  display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px;
  min-width: 120px; border: 1px dashed var(--bd); border-radius: var(--radius-sm);
  font-size: 13px; color: var(--t1); background: var(--bg2);
}
/* 退货明细的工具条（全部可退 / 清零）：推到右侧，不与「退货明细」标题挤在一起 */
.ipn-ret-quick { display: flex; gap: 8px; margin-left: auto }
/* 退货明细列少（9 列 vs 采购单 15 列）⇒ 表宽比采购单小一档，别跟着留 1758px 的横向滚动 */
.ipn-ret-tbl { min-width: 900px }
.ipn-ret-unit { width: 72px; color: var(--t2) }
/* 底部「退货原因」：吃掉左侧以外的空白，把右侧的保存按钮顶到最右 */
.ipn-ret-reason { flex: 1; min-width: 220px; height: 32px }
.ipn-cnt { color: var(--t3); font-variant-numeric: tabular-nums }
/* v415（P2-7）自定义字段的输入框：固定宽度（字段名 ≤12 字 + 值 ≤200 字，160px 够看一屏），
   不跟着 `.ipn-f-grow` 撑满 —— 它们是一组等宽的短字段，不是主字段。 */
.ipn-cf-in { width: 160px; height: 32px }
.ipn-sup-pick { display: flex; gap: 6px }
.ipn-kw { width: 130px; height: 32px }
.ipn-sel { min-width: 170px; height: 32px }
.ipn-date { height: 32px }

/* 供应商信息条（舟谱「应付/预付余额」的位置） */
.ipn-strip {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 9px 16px;
  background: var(--p-bg); border: 1px solid var(--p-border);
  border-radius: var(--radius-md); font-size: 13px; color: var(--t1);
}
.ipn-si { display: inline-flex; align-items: center; gap: 6px }
.ipn-sk { color: var(--t3); font-size: 12px }
.ipn-strip-amt { color: var(--p-ink); font-variant-numeric: tabular-nums }

/* 明细卡 */
/* v417d：明细工具条由「两行」（工具条 + 口径提示）压成「一行」——
   筛选框与「加一行」上移到页头，这里只留「商品明细 + 项数 + 口径说明（默认折叠）」。
   折叠态下明细上方只占这一行，展开才补回说明文字（省约 26px ≈ 0.7 行）。 */
.ipn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px }
/* 上移到页头后的商品筛选框（原在明细工具条内，靠 margin-left:auto 靠右；现在不需要） */
.ipn-prod-kw { width: 240px; height: 30px }
.ipn-tip {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12px; color: var(--t2); margin: 0 0 10px;
}
.ipn-tip svg { color: var(--p-dark); flex: none; margin-top: 1px }
/* v417：库存口径「展开/收起」链接按钮（无边框、像文字链接，对齐舟谱一行小字的疏朗感） */
.ipn-tip-link {
  margin-left: auto; padding: 0 2px; border: 0; background: none; cursor: pointer;
  font-size: 12px; color: var(--p-dark); text-decoration: underline dotted;
  white-space: nowrap;
}
.ipn-tip-link:hover { color: var(--p-ink) }
/* v408（P1-1）库存口径说明行：紧贴上一行提示，视觉上算同一组 */
.ipn-tip-stk { margin-top: -6px }
.ipn-tip-stk svg { color: var(--t3) }
.ipn-tip-stk b { color: var(--t1) }

/* v408（P1-1）库存两列 + v409（P2-1）单位列加宽（64→92px）。等宽数字 + 不换行：
   数量右对齐成一列才好扫读。`min-width` 相应放大：1730 → 1758px（单位列 +28px）。 */
.ipn-tbl { min-width: 1758px }
/* v417c：明细表**紧凑行高**（对照舟谱：单屏可见行数 5 → 8）。
   全局 `table.tbl td{padding:10px 14px}`（variables.css:530）是给「读数表」定的，
   填报网格要更密 —— 纵向 10→5px、行内控件 30→28px ⇒ 单行 ≈51 → ≈39px。
   🔴 选择器**必须**带 `table.ipn-tbl`：写成 `.ipn-tbl td` 的 specificity 低于全局
      `table.tbl td`，会**静默失效**（样式看着写了、实际没生效）。 */
table.ipn-tbl th { padding: 5px 12px }
table.ipn-tbl td { padding: 3px 12px }
table.ipn-tbl td.seq-cell { padding: 3px 4px }
.ipn-c-stk { width: 88px; font-variant-numeric: tabular-nums; white-space: nowrap }
.ipn-stk-none { color: var(--t3); font-size: 12px }
/* 「实际有货、一件都不可售（全过期）」——必须扎眼，否则用户以为有货能卖 */
.ipn-c-stk .danger { color: var(--danger-txt) }
.ipn-c-prod { min-width: 260px }
.ipn-c-code { width: 116px; color: var(--t2); font-variant-numeric: tabular-nums }
/* v409（P2-1）：单位列从 64px 放到 92px —— 里面现在是一个下拉 + 一行换算小字，
   64px 会让「件」这种单字单位的下拉被挤成 40px，点开选项时文字被截断。 */
.ipn-c-unit { width: 92px }
.ipn-unit-sel { height: 26px; padding: 0 4px }
/* 换算 / 折价小字：**弱化色 + 不换行**，它是解释不是数据（数据仍以输入框里的为准）。
   ⚠️ 不加 `white-space: nowrap` 时「= 40 袋」会在窄列里断成两行，把行高顶起来。 */
/* v417c：换算小字从「行内第二行」改为「指向该格才浮出的浮层」。
   原来三格（单位 / 采购价 / 订单数量）各自多一行 ⇒ 多档单位商品一选中，
   行高 51→66px、单屏行数掉三成。改成绝对定位浮层后**不占行高**：
   鼠标指向该格或键盘聚焦才出现，`pointer-events:none` 不挡点击。 */
.ipn-c-unit, .ipn-c-price, .ipn-c-qty { position: relative }
.ipn-conv {
  display: none; position: absolute; z-index: 6;
  left: 2px; top: calc(100% - 4px);
  padding: 1px 6px; white-space: nowrap; pointer-events: none;
  font-size: 11px; color: var(--t2); font-variant-numeric: tabular-nums;
  background: var(--bg); border: 1px solid var(--bd);
  border-radius: var(--radius-sm); box-shadow: var(--shadow-sm);
}
.ipn-c-unit:hover .ipn-conv, .ipn-c-unit:focus-within .ipn-conv,
.ipn-c-price:hover .ipn-conv, .ipn-c-price:focus-within .ipn-conv,
.ipn-c-qty:hover .ipn-conv, .ipn-c-qty:focus-within .ipn-conv { display: block }
.ipn-c-ref { width: 96px; color: var(--t2) }
.ipn-c-price, .ipn-c-qty { width: 94px }
.ipn-c-amt { width: 104px }
.ipn-c-batch { width: 124px }
.ipn-c-date { width: 142px }
/* v408（P1-2）行备注：选填短文本，给足宽度但不抢主列 */
.ipn-c-note { width: 180px }
.ipn-c-op { width: 104px; white-space: nowrap }
.ipn-in { width: 100%; height: 26px }
.ipn-in.num { text-align: right; font-variant-numeric: tabular-nums }
.ipn-amt { font-variant-numeric: tabular-nums; white-space: nowrap }
.ipn-unit { font-size: 13px; color: var(--t1) }
/* 档案没设报单单位时的回落值 —— 用弱化色标注，不静默 */
.ipn-unit.fallback { color: var(--t3) }
.ipn-unit.none { color: var(--t3) }
.ipn-link {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer;
}
.ipn-link + .ipn-link { margin-left: 10px }
.ipn-link:hover { text-decoration: underline }
.ipn-link.danger { color: var(--danger-txt) }
/* v417b：行内「新增 / 删除」由文字链接改**图标按钮** —— 对齐舟谱逐行操作的密度：
   15 列表格里文字链接让「操作」列变宽、且扫读时和行备注混在一起。 */
.ipn-ic {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; cursor: pointer;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg2); color: var(--t2);
}
.ipn-ic + .ipn-ic { margin-left: 4px }
.ipn-ic:hover { color: var(--t1); border-color: var(--t3) }
.ipn-ic.danger { color: var(--danger-txt) }

/* 底部动作条。四条外边距各司其职，缺一条都会退化成「浮在页面中间」：

   `margin-top:auto`  —— **短内容时的推底主力**：在竖排 flex 里吸走所有富余空间，
                         把动作条压到容器底边。块布局下 `auto` 无效，所以父级必须是 flex。
   `margin-inline:-20px` / `margin-bottom:-20px`
                      —— 与 Shell 的 `.view-wrap{padding:20px}`（Shell.vue:1165）**是一对**：
                         左右 -20px 让动作条满宽（不然左右各留 20px 白边）；
                         底部 -20px 让粘住时真的贴到滚动容器下沿、不留 20px 空隙
                         （`sticky` 的可移动范围被 containing block 限死，不给负底边距就贴不到底）。
                         那份 padding 改了这里必须跟着改 —— 两处唯一的耦合点。

   两种情形分工：内容不足一屏 ⇒ `margin-top:auto` 生效（靠 InventoryShell 打通的高度链）；
                内容超一屏   ⇒ `auto` 无富余空间可吸，`sticky bottom:0` 接管。 */
.ipn-bottom {
  position: sticky; bottom: 0; z-index: var(--z-sticky);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: auto -20px -20px -20px; padding: 12px 20px;
  background: var(--bg); border-top: 1px solid var(--border-subtle);
}
.ipn-total { font-size: 14px }
.ipn-total b { font-size: 18px; font-variant-numeric: tabular-nums }
.ipn-warn { font-size: 12px; color: var(--war) }
.ipn-save { position: relative; display: inline-flex; margin-left: auto }
.ipn-save-main { border-top-right-radius: 0; border-bottom-right-radius: 0 }
.ipn-save-caret {
  width: 28px; padding: 0; border-left: 1px solid rgba(255, 255, 255, .35);
  border-top-left-radius: 0; border-bottom-left-radius: 0;
}
/* v417b：双下拉（保存 ▾ / 保存并审核 ▾）—— 每个 `.ipn-dd` 自成一个「主按钮 + caret」组，
   菜单定位相对**自己这一组**（不是相对整个动作条），否则两个菜单会叠在同一处。 */
.ipn-dd { position: relative; display: inline-flex }
.ipn-dd-main { border-top-right-radius: 0; border-bottom-right-radius: 0 }
.ipn-dd-caret {
  width: 28px; padding: 0; margin-left: -1px;
  border-top-left-radius: 0; border-bottom-left-radius: 0;
}
/* 「待接口」的菜单项：**能点但说明白没实现** —— 不隐藏（隐藏会让人以为从没有这功能），
   也不伪装成已可用（点了没反应才是真静默失效）。 */
.ipn-mi-disabled { color: var(--t3); cursor: default }
.ipn-mi-tag {
  margin-left: 4px; padding: 0 4px; font-size: 10px; color: var(--t3);
  border: 1px solid var(--bd); border-radius: 6px;
}
.ipn-caret {
  width: 0; height: 0;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor; transition: transform .15s;
}
.ipn-caret.up { transform: rotate(180deg) }
.ipn-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); z-index: var(--z-dropdown);
  min-width: 160px; padding: 4px;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipn-mi {
  display: block; width: 100%; padding: 8px 12px; border: none; background: none;
  border-radius: var(--radius-sm); text-align: left; font-size: 13px; color: var(--t1);
}
.ipn-mi:hover { background: var(--bg2) }

@media (max-width: 640px) {
  .ipn-hd { align-items: stretch }
  .ipn-f, .ipn-kw, .ipn-sel, .ipn-date { width: 100%; min-width: 0 }
  .ipn-sup-pick { flex-direction: column }
  .ipn-prod-kw { width: 100% }
  .ipn-bottom { margin-inline: 0; padding-inline: 0 }
}
</style>
