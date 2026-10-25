<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div class="ipn-hd-t">
        <h2>{{ cfg.title }}</h2>
        <span v-if="cfg.sub" class="page-sub">{{ cfg.sub }}</span>
      </div>
      <div class="ipn-acts">
        <!-- v450：附件入口（对齐舟谱建单页右上角「上传附件」；与采购订单建单页 v438 同款）。
             🔴 建单页**还没有退货单 id**，附件无法即时落库 ⇒ 选完先「暂存」在本页，
                点保存拿到 id 后随单上传（之后在详情页「附件」里可见 / 可下）。
             ⚠️ 只在**模式 B（不挂原单）**给入口：模式 A 的单据归属不同
                （走 `/purchase-orders/{oid}/return`），不猜、不埋暗坑。 -->
        <template v-if="!isAttached">
          <button class="btn btn-ghost btn-sm" :disabled="saving" @click="pickAttachments">
            <Icon name="upload" :size="14" />上传附件<span v-if="stagedFiles.length" class="ipn-at-badge">{{ stagedFiles.length }}</span>
          </button>
          <!-- 隐藏的 file input：真正「选文件」由上面的按钮触发。
               ⚠️ 不能用 `display:none`（部分浏览器 `.click()` 不触发）；多选：一次可挑多张。 -->
          <input ref="attFileEl" type="file" multiple class="ipn-at-file" @change="onAttachPick" />
        </template>
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════════
         模式 A：**挂原采购单**（`?from_po=N`）—— 从采购单详情页的
         「转单为 → 采购退货」进来。
         🔴 为什么这一支**必须保留**（不能统一成下面那种自己填的形态）：
            它走的是 `POST /api/psi/purchase-orders/{oid}/return`，那条端点在**后端**
            用可退预览重算上限并强制「退货数量 ≤ 可退量」（v414）。
            换成不挂原单的通道 = 把一个**有服务端上限**的流程降级成没有上限的流程，
            而退货是**不可逆**的库存动作 —— 多退的货在账上凭空消失。
         所以这里是「两条并存的通道」，由**入口**决定走哪条，不是让用户选。
         ════════════════════════════════════════════════════════════════════════ -->
    <template v-if="isAttached">
      <div class="ipn-hd ipn-hd-flat hd-box">
        <div class="ipn-f ipn-f-po">
          <label class="ipn-lb">原采购单</label>
          <!-- 🔴 这里**不给搜索 + 下拉**了：本模式只可能从某一张采购单的详情页进来
               （`?from_po=N`），再让人在下拉里重选一张只会选出一张与 URL 不符的单。
               要换原单 ⇒ 回那张单的详情页点「转单为」。 -->
          <span class="ipn-ro">{{ srcOrderNo }}</span>
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

      <p class="ipn-hint">
        这张单的供应商与退货仓库<b>跟着原采购单</b>走，改不了。能退的商品与数量由系统按
        「<b>已入库 − 已退</b>」现算，只列还有货可退的行。
      </p>

      <div class="ipn-strip">
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

      <div class="ipn-body">
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
        <div v-else-if="!canReturn" class="state-empty">{{ retBlockReason }}</div>

        <div v-else class="table-wrap">
          <table class="tbl ipn-tbl ipn-ret-tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th class="ipn-c-prod" :style="retW('prod')">商品<ColResizeHandle col="prod" :start="retResize" :reset="retReset" /></th>
                <th class="ipn-ret-unit" :style="retW('unit')">单位<ColResizeHandle col="unit" :start="retResize" :reset="retReset" /></th>
                <th class="num ipn-c-stk" :style="retW('recv')">已入库<ColResizeHandle col="recv" :start="retResize" :reset="retReset" /></th>
                <th class="num ipn-c-stk" :style="retW('ret')">已退<ColResizeHandle col="ret" :start="retResize" :reset="retReset" /></th>
                <th class="num ipn-c-stk" :style="retW('can')">可退<ColResizeHandle col="can" :start="retResize" :reset="retReset" /></th>
                <th class="num ipn-c-qty" :style="retW('qty')"><span class="ipn-req">*</span>退货数量<ColResizeHandle col="qty" :start="retResize" :reset="retReset" /></th>
                <th class="num ipn-c-price" :style="retW('price')">退货单价<ColResizeHandle col="price" :start="retResize" :reset="retReset" /></th>
                <th class="num ipn-c-amt" :style="retW('amt')">退货金额<ColResizeHandle col="amt" :start="retResize" :reset="retReset" /></th>
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

      <div class="ipn-bottom">
        <span class="ipn-total">退货合计 <b>¥{{ fmtMoney(retTotal) }}</b></span>
        <input v-model.trim="retReason" maxlength="200" class="input ipn-ret-reason"
               placeholder="退货原因（选填，如：破损 / 临期 / 多订）" />
        <div class="ipn-save">
          <button class="btn btn-primary btn-sm ipn-save-main"
                  :disabled="saving || !canReturn" @click="submitAttached">
            <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存退货单' }}
          </button>
        </div>
      </div>
    </template>

    <!-- ════════════════════════════════════════════════════════════════════════
         模式 B：**不挂原单**（默认）—— 老板 2026-10-11 口径：
         「退货单不需要选原采购单，退货仓库要可以指定」。
         提交走 `POST /api/psi/purchase-return-orders`（v449 新端点）。
         ════════════════════════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="ipn-hd ipn-hd-flat hd-box">
        <div class="ipn-f ipn-f-sup">
          <label class="ipn-lb"><span class="ipn-req">*</span>{{ cfg.partnerLabel }}</label>
          <!-- v428：供应商搜索 + 选择合一的组合框（单一来源：SupplierCombo.vue，
               与采购订单页共用，保证两页供应商输入框外观 / 尺寸 / 占位 / 下拉 / 交互逐像素一致）。
               本地按「名称 或 编号」模糊匹配（suppliers 已由 reinit 的 loadRefs 拉全），
               不再单独打接口搜索。 -->
          <SupplierCombo v-model="form.supplier_id" :suppliers="suppliers" placeholder="输入名称或编号搜索供应商" />
        </div>
        <div class="ipn-f">
          <label class="ipn-lb">经办人</label>
          <span class="ipn-ro">{{ operatorName }}</span>
        </div>
        <!-- v451（L3）：部门 —— 舟谱退货单头的 `*部门`（截图实见，紧跟在经办人之后）。
             🔴 数据源 `psi_refs(kind='departments')`（后端 **已存在**，无需新端点）；
                与采购订单页共用同一个下拉数据源（`departments` 表，`is_active=1` 才可选）。
             ⚠️ `0 = 不指定`（不是"总部"）：后端只在 `department_id > 0` 时才落库，
                所以这里给 `0` 一个「请选择」选项，且**不做必填**（舟谱标 `*`，
                但我方 v451 口径是"选填、不阻塞建单"——见 docTypes.js 的说明）。 -->
        <div class="ipn-f">
          <label class="ipn-lb">部门</label>
          <select v-model.number="form.department_id" class="input ipn-sel">
            <option :value="0">请选择</option>
            <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>
        <div class="ipn-f">
          <label class="ipn-lb"><span class="ipn-req">*</span>{{ cfg.whLabel }}</label>
          <select v-model.number="form.warehouse_id" class="input ipn-sel">
            <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <div class="ipn-f">
          <label class="ipn-lb">单据日期</label>
          <input type="date" v-model="form.order_date" class="input ipn-date" />
        </div>
        <div class="ipn-f ipn-f-grow">
          <label class="ipn-lb">备注</label>
          <input v-model.trim="form.note" maxlength="500" class="input ipn-note-in" />
        </div>
      </div>

      <!-- v450：附件暂存条 —— 建单页没有退货单 id，附件不能即时落库。
           选完先列在这里，点「保存」拿到 id 后随单上传（之后在详情页「附件」里可见 / 可下）。
           🔴 文案如实写「保存后随单上传」：不假装已经传上去；不保存就离开 ⇒ 这几个文件丢弃。
           与采购订单建单页 v438 逐字同源（`.ipn-at-*` 样式块本就与那边共用，视觉自动一致）。 -->
      <div v-if="(stagedFiles.length || attMsg)" class="ipn-at-bar">
        <span class="ipn-at-hd">
          <Icon name="file" :size="14" />
          本次新增附件<template v-if="stagedFiles.length">（{{ stagedFiles.length }}）</template>
          <em class="ipn-at-tip">保存后随单上传</em>
        </span>
        <ul v-if="stagedFiles.length" class="ipn-at-list">
          <li v-for="s in stagedFiles" :key="s.key">
            <span class="ipn-at-nm" :title="s.name">{{ s.name }}</span>
            <span class="ipn-at-sz">{{ fmtSize(s.size) }}</span>
            <button class="ipn-at-x" type="button" title="移除" @click="removeStaged(s.key)">
              <Icon name="close" :size="12" />
            </button>
          </li>
        </ul>
        <p v-if="attMsg" class="ipn-at-msg">{{ attMsg }}</p>
      </div>

      <p v-if="cfg.hint" class="ipn-hint">{{ cfg.hint }}</p>

      <!-- v684：自由退货提醒。
           🔴 **只提示、不拦截**：这里没有任何 `disabled` / `return` 绑到它。
              老板 2026-10-25 口径：没有历史采购的商品也允许退（跨渠道调货、跨期老货都真实存在）。
           🔴 接口没读出来时显示 `histNote`（如实说"没读到，本次不提醒"），
              而不是把每一行都标成"没有历史" —— 假警告比不提醒更糟。 -->
      <p v-if="histWarn || histNote" class="ipn-hist-warn">
        <Icon name="alert" :size="14" />
        <span>{{ histWarn || histNote }}</span>
      </p>

      <div v-if="selSupplier" class="ipn-strip">
        <span class="ipn-si">
          <span class="ipn-sk">供应商</span><b>{{ selSupplier.name }}</b>
        </span>
        <span class="ipn-si">
          <span class="ipn-sk">已录商品</span><b>{{ filledRows.length }} 项</b>
        </span>
        <span class="ipn-si">
          <span class="ipn-sk">退货合计</span><b class="ipn-strip-amt">¥{{ fmtMoney(totalAmount) }}</b>
        </span>
        <span class="ipn-si">
          <span class="ipn-sk">应付余额</span><b>¥{{ fmtMoney(supplierBal ? Number(supplierBal.payable) : 0) }}</b>
        </span>
        <span class="ipn-si">
          <span class="ipn-sk">预付余额</span><b>¥{{ fmtMoney(supplierBal ? Number(supplierBal.prepaid) : 0) }}</b>
        </span>
      </div>

      <div class="ipn-body">
        <div class="ipn-bar">
          <b>{{ cfg.tblTitle }}</b>
          <span class="ipn-cnt">{{ filledRows.length }} 项</span>
          <!-- v683：原先这里是「按小单位采购」勾选框（勾上锁小单位、取消才放开三档）。
               🔴 为什么去掉这个开关：它与商品档案里的「默认开单单位」是**同一件事的
                  两个入口** —— 一个全局开关 + 一个逐商品配置，用户永远说不清"到底谁生效"。
                  现在统一成：单位列**恒为下拉**，默认选哪一档由商品档案的
                  `default_purchase_unit` 决定（没配则回退最小单位 = 退货的老口径）。
                  老口径不会变：大多数商品档案没配默认单位 ⇒ 退货仍然默认按小单位退。 -->
        </div>

        <p v-if="cfg.tip" class="ipn-tip">
          <Icon name="lightbulb" :size="14" />
          <span>{{ cfg.tip }}</span>
        </p>

        <div v-if="!items.length" class="state-empty">还没有明细，点击任意行末尾的 + 按钮添加一行。</div>

        <div v-else class="table-wrap">
          <table class="tbl ipn-tbl">
            <thead>
              <tr>
                <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
                <th class="ipn-c-prod" :style="wStyle('prod')"><span class="ipn-req">*</span>商品<ColResizeHandle col="prod" :start="startResize" :reset="resetColW" /></th>
                <th class="num ipn-c-qty" :style="wStyle('qty')"><span class="ipn-req">*</span>退货数量<ColResizeHandle col="qty" :start="startResize" :reset="resetColW" /></th>
                <th class="ipn-c-unit" v-if="isVisible('unit')" :style="wStyle('unit')">单位<ColResizeHandle col="unit" :start="startResize" :reset="resetColW" /></th>
                <th class="num ipn-c-price" :style="wStyle('price')"><span class="ipn-req">*</span>{{ cfg.priceLabel }}<ColResizeHandle col="price" :start="startResize" :reset="resetColW" /></th>
                <th class="num ipn-c-amt" v-if="isVisible('amt')" :style="wStyle('amt')">退货金额<ColResizeHandle col="amt" :start="startResize" :reset="resetColW" /></th>
                <th class="ipn-c-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in items" :key="row.uid" :data-uid="row.uid">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td class="ipn-c-prod">
                  <ProductCombo :row="row" :products="products" @pick="onPick" />
                  <!-- v684：该供应商从没采购过这个商品时挂个角标（绝对定位 ⇒ 不占行高、
                       不挤商品列宽）。仍可正常提交，这里只是提醒。 -->
                  <span v-if="isHistMissing(row)" class="ipn-hist-dot"
                        :title="`该供应商的历史采购记录里没有「${productNameOf(row) || '这个商品'}」。仍可正常退货，这里只是提醒。`">⚠</span>
                </td>
                <td>
                  <input v-model="row.quantity" class="input ipn-in num" inputmode="decimal" placeholder="0" />
                </td>
                <td v-if="isVisible('unit')" class="ipn-c-unit">
                  <!-- v683：单位**恒为下拉**（可选项 = 商品档案里配的可用单位）。
                       ⚠️ 选项里没有中/大档的商品（档案没维护）只会有小档一项 ——
                          这是常态（生产实测 449 个商品只有 74 个中/大档齐全），不是缺陷。
                       🔴 `:value` + 事件取值，不用 `v-model` + `@change`：v-model 会在
                          change 派发**前**改掉 row.unit，事件里就再也说不出"从哪档到哪档"。 -->
                  <select v-if="unitOptionsOf(row).length"
                          :value="row.unit" class="input ipn-in ipn-unit-sel"
                          :title="unitTitle(row)" @change="onUnitChange(row, $event)">
                    <option v-for="o in unitOptionsOf(row)" :key="o.key" :value="o.name">{{ o.name }}</option>
                  </select>
                  <span v-else-if="row.unit" class="ipn-unit">{{ row.unit }}</span>
                  <span v-else class="ipn-unit none"></span>
                  <div v-if="unitHint(row)" class="ipn-conv">{{ unitHint(row) }}</div>
                </td>
                <td>
                  <input v-model="row.unit_price" class="input ipn-in num" inputmode="decimal" placeholder="0.00"
                         :title="priceTitle(row)" />
                </td>
                <td class="num ipn-amt" v-if="isVisible('amt')">¥{{ fmtMoney(rowAmount(row)) }}</td>
                <td class="ipn-c-op">
                  <button class="btn-row-ic" title="在下面插入一行" @click="insertAfter(i)">
                    <Icon name="plus" :size="14" />
                  </button>
                  <button class="btn-row-ic danger" title="删除这一行" @click="removeRow(i)">
                    <Icon name="trash" :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ColMenuPanel ref="panel" :col-list="DOC_COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />
      </div>

      <div class="ipn-bottom">
        <span class="ipn-total">退货合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
        <input v-model.trim="reason" maxlength="200" class="input ipn-ret-reason"
               placeholder="退货原因（选填，如：破损 / 临期 / 多订）" />
        <div class="ipn-save">
          <!-- v451（L3）：双下拉 —— 「保存」（落**草稿**，不扣库存/不冲应付，待审核）
               ｜ 「保存并审核」（建草稿后立即过账）。结构照抄采购订单建单页
               （`.ipn-dd` / `.ipn-dd-main` / `.ipn-dd-caret` / `.ipn-caret` / `.ipn-menu`
                样式块本就与那边逐字节共用 ⇒ 视觉自动一致，不新增 CSS）。 -->
          <div class="ipn-dd">
            <button class="btn btn-ghost btn-sm ipn-dd-main" :disabled="saving" @click="submitStandalone('save')">
              {{ saving ? '提交中…' : cfg.saveLabel }}
            </button>
            <button class="btn btn-ghost btn-sm ipn-dd-caret" :disabled="saving"
                    title="更多保存方式" @click.stop="saveOpen = !saveOpen">
              <span class="ipn-caret" :class="{ up: saveOpen }"></span>
            </button>
            <div v-if="saveOpen" class="ipn-menu" @click.stop>
              <button class="ipn-mi" @click="submitStandalone('save')">保存（存草稿，待审核）</button>
              <button class="ipn-mi" @click="submitStandalone('saveNew')">保存并新增</button>
            </div>
          </div>
          <div class="ipn-dd">
            <button class="btn btn-primary btn-sm ipn-dd-main" :disabled="saving" @click="submitStandalone('approve')">
              {{ saving ? '提交中…' : '保存并审核' }}
            </button>
            <button class="btn btn-primary btn-sm ipn-dd-caret" :disabled="saving"
                    title="更多审核方式" @click.stop="approveOpen = !approveOpen">
              <span class="ipn-caret" :class="{ up: approveOpen }"></span>
            </button>
            <div v-if="approveOpen" class="ipn-menu" @click.stop>
              <button class="ipn-mi" @click="submitStandalone('approve')">保存并审核</button>
              <button class="ipn-mi" @click="submitStandalone('approveNew')">审核并新增</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 采购退货单建单内核（v449 独立页面）。
   ═══════════════════════════════════════════════════════════════════════════════
   🔴 **两种模式，两条通道**（这是本文件最需要先看清的一件事）：

     | 入口                         | 表头                     | 商品/数量           | 提交端点                                   | 服务端上限 |
     |------------------------------|--------------------------|---------------------|--------------------------------------------|-----------|
     | 侧栏「采购退货单 › ＋」       | 供应商 + 退货仓库（自选）| 自己挑、自己填       | `POST /api/psi/purchase-return-orders`     | **无**     |
     | 采购单详情页「转单为 →退货」  | 原采购单（只读）          | 由可退预览给定       | `POST /api/psi/purchase-orders/{oid}/return` | **有**     |

     为什么「无上限」那一支是对的：老板 2026-10-11 口径「退货单**不需要**选原采购单」。
     没有原单就没有「可退」这个量 —— 这不是漏了一道校验，是**语义变了**。
     为什么另一支必须留着：那条通道的上限校验是**后端**在拦（`psi_purchase_return`
     用可退预览重算），把它并到新通道 = 悄悄削弱一道真实存在的护栏。

   🔴 **单位口径（最容易出错的地方）**：两条通道的 `quantity` 都是**小单位**口径
     （`purchase_return_create` 把 `quantity` 直接交给 `inventory_adjust` 扣库存，
     不乘任何 ratio）。所以本页「单位」列显示的是商品的**基础单位**（`products.unit`），
     而**不是**报单单位 —— 显示报单单位会让用户按「2 箱」填数，系统扣掉 2 袋，
     而且**零报错**。前端**不做**任何换算（那是第二份实现；唯一权威在
     `products.large_ratio` / `medium_ratio` 与后端折算）。

   🔴 页面里**不出现**标题 / 仓库标签 / 伙伴标签 / 价格列名 / 列表落点 / 提示语的字面量
     —— 一律走 `purchaseDocConfig()`（见 `docTypes.js`）。加一种单据只改配置。

   🔴 已知差距（有意不做，登记在案）：`purchase_returns` 表**没有**部门列
     （经办人列 `operator_id` 已存在，L1 已只读显示当前登录用户，见表头经办人格）。
     ⇒ 部门格这里不摆。舟谱的退货单头有 `*部门`，要补得先建部门主数据 + 加列 + 打通端点。
     详见 `docTypes.js` 的「已知差距」。
   ═══════════════════════════════════════════════════════════════════════════════ */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../../components/Icon.vue'
import ColMenuPanel from '../../../components/ColMenuPanel.vue'
import { useColSettings } from '../../../composables/useColSettings.js'
import { useColResize } from '../../../composables/useColResize.js'
import ColResizeHandle from '../../../components/ColResizeHandle.vue'
import { psiApi } from '../../../api/psi'
import { toast, store, confirm } from '../../../store'
import { fmtMoney, PO_STATUS, textOf } from '../../../constants/psiLabels'
import { purchaseDocConfig, PURCHASE_DOC_TYPES } from './docTypes.js'
import SupplierCombo from './SupplierCombo.vue'
import ProductCombo from './ProductCombo.vue'
import {
  applyPricingToRow, applyUnitChange, createPricingCache, unitOptionsOf, PRICE_SOURCE_LABEL,
} from './unitPricing.js'
/* v684：自由退货的「这行商品在该供应商那儿有没有历史采购」提醒（唯一入口，只提醒不拦截）。 */
import { createHistoryChecker, historyWarnText, HISTORY_NOTE } from './partnerHistory.js'

const props = defineProps({
  /* 单据类型键，见 `docTypes.js` 的 `PURCHASE_DOC_TYPES`。本内核只承载采购退货单。 */
  type: { type: String, default: PURCHASE_DOC_TYPES.PURCHASE_RETURN },
})
const router = useRouter()
const route = useRoute()
const cfg = computed(() => purchaseDocConfig(props.type))

/** 模式判据：URL 上带 `?from_po=` ⇒ 挂原单（模式 A）；否则独立退货（模式 B）。
 *  🔴 必须是 computed（不能取一次性常量）：见下面 `watch` 那段。 */
const fromPo = computed(() => Number((route.query && route.query.from_po) || 0) || 0)
const isAttached = computed(() => fromPo.value > 0)

const saving = ref(false)

/* ══ 模式 B 的状态 ═══════════════════════════════════════════════════════════════ */
const suppliers = ref([])
const warehouses = ref([])
const products = ref([])
/* v451（L3）：部门下拉的数据源。`psi_refs(kind='departments')` **后端已存在**
   （v408 P0-5 为采购订单页加的），这里只是同一份数据的第二个消费方 —— 不新增端点。 */
const departments = ref([])
const reason = ref('')
/* v451（L3）：「保存 / 保存并审核」两个下拉菜单的开合态（与采购订单建单页同名同义）。 */
const saveOpen = ref(false)
const approveOpen = ref(false)
const form = ref({
  supplier_id: 0, warehouse_id: 0, department_id: 0, order_date: '', note: '',
})

/** 列设置：**新的云端偏好键** `purchase-return-new`。
 *  🔴 不复用采购订单页的 `purchase-new`：那是另一种单据的列（条码 / 批次 / 库存），
 *     共用一份偏好会让两页的列显隐互相顶掉。 */
const DOC_COLS = [
  { key: 'prod',  label: '商品',     core: true },
  { key: 'qty',   label: '退货数量', core: true },
  { key: 'unit',  label: '单位',     core: false },
  { key: 'price', label: '退货价',   core: true },
  { key: 'amt',   label: '退货金额', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('purchase-return-new', DOC_COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }
const { wStyle, startResize, resetColW } = useColResize('purchase-return-new', DOC_COLS)

/* ══ 模式 A 的状态（自 v414 的 `InvPurchaseNew.vue` 原样搬来，语义一字未改）═══════ */
const retPreview = ref(null)
const retRows = ref([])
const retReason = ref('')
const retLoading = ref(false)
const retError = ref('')

const RET_COLS = [
  { key: 'prod',  label: '商品' },
  { key: 'unit',  label: '单位' },
  { key: 'recv',  label: '已入库' },
  { key: 'ret',   label: '已退' },
  { key: 'can',   label: '可退' },
  { key: 'qty',   label: '退货数量' },
  { key: 'price', label: '退货单价' },
  { key: 'amt',   label: '退货金额' },
]
const { wStyle: retW, startResize: retResize, resetColW: retReset } =
  useColResize('purchase-new-ret', RET_COLS)

const retOrder = computed(() => (retPreview.value && retPreview.value.order) || null)
const srcOrderNo = computed(() => (retOrder.value && retOrder.value.order_no) || `#${fromPo.value}`)
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

/* ══ 共用小工具 ═════════════════════════════════════════════════════════════════ */
function todayISO () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** 整数不带小数点（与销售报表口径一致），非整数保留 2 位。 */
function fmtQty (v) {
  const n = Number(v || 0)
  if (!isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/* ══ 模式 B 的逻辑 ═══════════════════════════════════════════════════════════════ */
let _uid = 0
const items = ref([])
/** v444 规范 §4.1：建单页明细表的**出厂预设空行数**（三个建单内核同值）。 */
const PRESET_ROWS = 15

const selSupplier = computed(() =>
  suppliers.value.find(s => Number(s.id) === Number(form.value.supplier_id)) || null)
/* L1（B方案·舟谱创建页对齐）：经办人 = 当前登录用户，只读展示（operator_id 已落库于
   `purchase_returns.operator_id`，后端从登录态自动带；这里只显示、不引入选人逻辑）。 */
const operatorName = computed(() => (store.user && store.user.name) ? store.user.name : '—')
/** L1（B方案）：选供应商后拉该供应商应付/预付余额，对齐舟谱创建页「应付金额 / 预付金额」读数。
    复用现成 `GET /api/psi/suppliers/{sid}/balance`（psi.js:181），只读、不动后端、不动表。 */
const supplierBal = ref(null)
watch(() => form.value.supplier_id, async (sid) => {
  if (!sid) { supplierBal.value = null; return }
  try { supplierBal.value = await psiApi.supplierBalance(Number(sid)) }
  catch (e) { supplierBal.value = null }
})
const filledRows = computed(() => items.value.filter(r => Number(r.product_id) > 0))
const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  return (q && p) ? Math.round(q * p * 100) / 100 : 0
}
function blankRow () {
  return { uid: ++_uid, product_id: 0, quantity: '', unit: '', unit_price: '',
           unitOptions: [], convText: '', baseUnit: '', barcode: '',
           // v683：默认档 / 价格来源 —— 后端定价下发，前端不算
           defaultUnit: '', priceSource: '' }
}
function insertAfter (i) {
  const r = blankRow()
  items.value.splice(i + 1, 0, r)
  scrollRowIntoView(r.uid)
}
function removeRow (i) { items.value.splice(i, 1) }
function scrollRowIntoView (uid) {
  nextTick(() => {
    const el = document.querySelector(`.ipn-tbl tbody tr[data-uid="${uid}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

/* v683：单位与价格**全部来自后端定价接口**（`GET /api/psi/product-pricing`，kind='purchase_return'）。
   🔴 后端对 `purchase_return` 的默认档回退是**最小档**（不是采购单的"最大档"）：
      退货按小单位退才对得上"已退量"，这是老板拍板的「保持各页现状」。
   🔴 换供应商 ⇒ 归属价变了 ⇒ 缓存清空重取。 */
const pricingCache = createPricingCache(id =>
  psiApi.productPricing(id, 'purchase_return', { supplier_id: Number(form.value.supplier_id) || 0 }))
watch(() => form.value.supplier_id, (now, before) => {
  if (Number(now) === Number(before)) return
  pricingCache.clear()
})

/* ══ v684：自由退货提醒 ══════════════════════════════════════════════════════════
   老板 2026-10-25 口径：本页**不再以「按原单退货」为主入口**（列表行 / 工具栏进来都走自由退货），
   选到「该供应商从没供过」的商品**只提醒、不拦截** —— 现实里退的货常常是上次从
   别的渠道调的，或跨期老货。
   🔴 判定「什么算历史采购」只在后端 `db/queries/partner_history.py`（哪些单据状态算数），
      前端只负责显示；不许在这里补一条 SQL 或加一个 `if (missing) return`。
   🔴 `histCount` **不参与** `validateStandalone()` —— 一参与就从「提醒」变成「拦截」。
   ══════════════════════════════════════════════════════════════════════════════ */
const histMissing = ref(new Set())
const histNote = ref('')
const history = createHistoryChecker(psiApi.partnerProductHistory, (miss, meta) => {
  histMissing.value = miss
  histNote.value = (meta && meta.failed) ? HISTORY_NOTE.failed : ''
})
const histCount = computed(() => items.value.filter(
  r => Number(r.product_id) > 0 && histMissing.value.has(Number(r.product_id))).length)
const histWarn = computed(() => historyWarnText('purchase', histCount.value))
function isHistMissing (row) {
  return Number(row.product_id) > 0 && histMissing.value.has(Number(row.product_id))
}
/** 行上没有 `product_name` 字段（ProductCombo 只写 product_id）⇒ 从 products 现查。
    只用于提示文案，不参与任何计算。 */
function productNameOf (row) {
  const p = products.value.find(x => Number(x.id) === Number(row.product_id))
  return (p && p.name) || ''
}
/* 供应商或**商品集合**一变就重查（防抖在 checker 里：连续改行只打一次接口）。
   🔴 watch 源用「商品 id 拼接串」，不用 `watch(items)`：后者在改数量/单位时也触发，
      而那两件事跟「有没有历史采购」无关 —— 会让每敲一个数字打一次接口。 */
watch([
  () => form.value.supplier_id,
  () => items.value.map(r => Number(r.product_id) || 0).join(','),
], () => {
  history.check('purchase', Number(form.value.supplier_id) || 0,
    items.value.map(r => Number(r.product_id) || 0))
})
/* 切模式（挂原单 ⇄ 自由退货）必须清掉提醒：模式 A 的明细来自原单，不存在"没有历史"。 */
watch(isAttached, () => history.clear())

/** 从商品档案带出单位 / 条码 / 换算式提示 / 该档单价。
    🔴 落库口径不变：后端仍把 `quantity`/`unit_price` 折成小单位存（`purchase_return_items`
       的历史铁律，见 `erp_db.py::purchase_return_create` docstring）。本页只负责
       让用户能选档，并把"所选档的价"正确带出来。 */
async function applyProduct (row) {
  const p = products.value.find(x => Number(x.id) === Number(row.product_id))
  if (!p) {
    row.unitOptions = []; row.convText = ''; row.baseUnit = ''; row.barcode = ''
    row.unit = ''; row.defaultUnit = ''; row.priceSource = ''
    return
  }
  row.barcode = String(p.barcode || '')
  try {
    const pricing = await pricingCache.get(row.product_id)
    if (pricing) applyPricingToRow(row, pricing)
  } catch (e) {
    row.unitOptions = Array.isArray(p.unit_options) ? p.unit_options : []
    row.convText = String(p.conv_text || '')
    row.baseUnit = String(p.unit || '')
    if (!row.unit) row.unit = row.baseUnit
    const pp = Number(p.purchase_price || p.cost_price || 0)
    if (!row.unit_price && pp > 0) row.unit_price = String(pp)
    toast('单位/价格没取到，已按商品档案兜底：' + (e && e.message ? e.message : e))
  }
}

/** v683 切档：**数量不动，只重算单价**（老板拍板，四页统一）。 */
function onUnitChange (row, ev) {
  const want = String((ev && ev.target && ev.target.value) || '')
  if (!want) return
  applyUnitChange(row, want)
}

/** 单位格说明：换算关系 + 该档价来自哪里。 */
function unitTitle (row) {
  const base = row.convText || row.unit || ''
  const o = unitOptionsOf(row).find(x => x.name === row.unit)
  if (!o) return base
  const src = PRICE_SOURCE_LABEL[o.price_source] || ''
  return src ? `${base}｜该单位价来自：${src}` : base
}

/** 单价格说明：这个价从哪来 —— 用户要能判断对不对，不能只给一个数。 */
function priceTitle (row) {
  const src = PRICE_SOURCE_LABEL[row.priceSource] || ''
  if (!src) return ''
  const o = unitOptionsOf(row).find(x => x.name === row.unit)
  const parts = [`价格来源：${src}`]
  if (o && Number(o.archive_price) > 0) parts.push(`档案价 ¥${o.archive_price}/${o.name}`)
  if (row.priceSource === 'none') parts.push('可以直接改')
  return parts.join('｜')
}

/** 单位格上的换算提示：选了比小单位大的档时，直接告出「折多少小单位」。
    数据全部取自后端下发的 `unit_options[].ratio`（唯一权威），前端只做乘法显示。 */
function unitHint (row) {
  const opts = Array.isArray(row.unitOptions) ? row.unitOptions : []
  const o = opts.find(x => x.name === row.unit)
  const q = Number(row.quantity || 0)
  if (o && Number(o.ratio) > 1 && row.baseUnit) {
    return q > 0
      ? `= ${fmtQty(q * Number(o.ratio))} ${row.baseUnit}`
      : `1${row.unit} = ${fmtQty(o.ratio)}${row.baseUnit}`
  }
  return row.convText || ''
}

function onPick (row) {
  applyProduct(row)
}

function validateStandalone () {
  if (!form.value.supplier_id) return `请先选择${cfg.value.partnerLabel}`
  if (!form.value.warehouse_id) return `请选择${cfg.value.whLabel}`
  if (!filledRows.value.length) return '请至少添加一行商品明细'
  const rows = filledRows.value
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const at = `第 ${items.value.indexOf(r) + 1} 行`
    if (!(Number(r.quantity) > 0)) return `${at}：退货数量要大于 0`
    if (r.unit_price === '' || Number(r.unit_price) < 0) return `${at}：请填写${cfg.value.priceLabel}`
  }
  return ''
}

/** 提交。`mode`（v451）：
 *    `save`        保存 → 落**草稿**（不扣库存/不冲应付），完事回列表待审核
 *    `saveNew`     保存并新增 → 同上，但留在本页重置明细
 *    `approve`     保存并审核 → 建草稿后**立即过账**（扣库存 + 冲应付 + 回写源单）
 *    `approveNew`  审核并新增 → 同上，但留在本页重置明细
 *  🔴 两条路径都是「先建草稿、再（可选）过账」—— **同一条通道**，不在前端分叉出
 *     第二套建单逻辑；审核走后端 `purchase_return_post`，与"建单即过账"共用同一个效果实现。
 *  🔴 审核失败**不丢单**：草稿已经落库（退货单是主体），此时如实报「已存为草稿，
 *     但审核未通过：<后端的原话>」并把用户留在列表里 —— 绝不谎报成"保存失败"。 */
async function submitStandalone (mode = 'save') {
  saveOpen.value = false
  approveOpen.value = false
  const bad = validateStandalone()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  const wantApprove = mode === 'approve' || mode === 'approveNew'
  const stayOnPage = mode === 'saveNew' || mode === 'approveNew'
  saving.value = true
  try {
    const r = await psiApi.createPurchaseReturn({
      supplier_id: Number(form.value.supplier_id),
      warehouse_id: Number(form.value.warehouse_id),
      // v451（L3）：部门（0 = 不指定，后端不落库）+ 草稿标记。
      department_id: Number(form.value.department_id || 0),
      order_date: form.value.order_date || '',
      note: form.value.note || '',
      reason: reason.value.trim(),
      // 🔴 恒以 `draft:true` 建单：要审核就紧接着调 approve（同一条通道）。
      //    这样"保存"与"保存并审核"的**建单部分**逐字同款，差别只在多一次过账调用。
      draft: true,
      items: filledRows.value.map(x => ({
        product_id: x.product_id,
        product_name: (products.value.find(p => Number(p.id) === Number(x.product_id)) || {}).name || '',
        quantity: Number(x.quantity),
        unit_price: Number(x.unit_price),
        // v451：所选档位名（勾了「按小单位采购」时恒为基础单位名）。后端据此折小单位落库。
        unit: x.unit || '',
      })),
    })
    /* 后端返回 `{success, id, total, status}`（`purchase_return_create`）⇒ 取 `id` 作单据号。
       ⚠️ 原来这里读的是 `r.return_id` —— 该键后端从不返回 ⇒ 提示里的单号一直是空的（恒不显示）。
       顺手改成 `r.return_id || r.id`：对后端任一命名都成立。 */
    const rid = Number((r && (r.return_id || r.id)) || 0)
    /* v450：单据已落库、`rid` 到手 ⇒ 把暂存的附件随单上传。
       🔴 放在「保存成功」之后、「跳转」之前：只有单据真建成了才有 id 可挂。
       🔴 `uploadStaged` 自己吞异常 ⇒ 上传失败**不会**走到下面的 catch 去报「保存失败」。 */
    const attRes = await uploadStaged(rid)
    /* v451：要审核就立刻过账。**失败不回滚草稿**（单据是主体），只如实报出来。 */
    let approveErr = ''
    if (wantApprove && rid) {
      try { await psiApi.approvePurchaseReturn(rid) }
      catch (e) { approveErr = (e && e.message) || '审核失败' }
    }
    /* v450：附件上传结果**单独报**（不并入单据结果）—— 单据成功与附件失败是两件事。 */
    if (attRes.fail.length) {
      toast(`${attRes.fail.length} 个附件上传失败：${attRes.fail.join('；')}`, 'warn')
    } else if (attRes.ok) {
      toast(`已上传 ${attRes.ok} 个附件`, 'success')
    }
    const no = rid ? '（#' + rid + '）' : ''
    if (wantApprove) {
      if (approveErr) toast(`已存为草稿${no}，但审核未通过：${approveErr}`, 'warn')
      else toast(`退货单已审核${no}`, 'success')
    } else {
      toast(`已存为草稿${no}，待审核`, 'success')
    }
    if (stayOnPage) resetForNew()
    else router.push({ path: cfg.value.listPath, query: cfg.value.listQuery || {} })
  } catch (e) {
    // 后端 detail 原样显示（例如「请指定退货供应商」「库存不足」）
    toast(e.message || '退货失败', 'error')
  } finally {
    saving.value = false
  }
}

/** 「保存并新增 / 审核并新增」用的重置：明细清回出厂预设行 + 清掉单据级临时态。
    表头（供应商 / 仓库 / 部门 / 日期）**刻意保留** —— 同一供应商连续退多张是常态。 */
function resetForNew () {
  items.value = []
  for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
  reason.value = ''
  stagedFiles.value = []
  attMsg.value = ''
}

/* ══ v450 附件（建单页 · 模式 B）══════════════════════════════════════════════════
   🔴 为什么是「先暂存、保存后上传」而不是选完即传：附件接口是
      `/api/psi/purchase-return-orders/{id}/attachments`，**要退货单 id**；而本页在
      点保存之前**没有 id**（id 由 `createPurchaseReturn` 生成）⇒ 选完无处可挂。
      所以：选中 → 先列在本页（`stagedFiles`）→ 保存拿到 `rid` → 逐个上传。
   🔴 **不假装已上传**：文案如实写「保存后随单上传」；不保存就离开 ⇒ 这几个文件丢弃
      （暂存是本页内存态，不是服务端草稿）。
   🔴 上传失败**不回滚单据**：单据是主体、附件是附属，不能因为一张图失败就把建好的单撤了；
      改为把失败的文件留在列表里如实报出来（后端同名会拒绝，这类原因必须让用户看到）。
   ⚠️ 与采购订单建单页（v438）**同一份实现**；`.ipn-at-*` 样式块本就与那边逐字节同源。
   ══════════════════════════════════════════════════════════════════════════════ */
const ATT_MAX_MB = 20          // 与后端同口径（列表端点另下发 max_mb，此处用默认值兜底）
const attFileEl = ref(null)
const stagedFiles = ref([])    // [{ key, name, size, file }]
const attMsg = ref('')
let attSeq = 0

function fmtSize (n) {
  const b = Number(n) || 0
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
  if (b >= 1024) return Math.round(b / 1024) + ' KB'
  return b + ' B'
}

function pickAttachments () {
  attMsg.value = ''
  if (attFileEl.value) { attFileEl.value.value = ''; attFileEl.value.click() }
}

/** File → base64（**去掉** `data:...;base64,` 前缀 —— 后端只接受裸 base64）。 */
function readFileAsBase64 (f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.onerror = () => reject(new Error('文件读取失败，请重试'))
    r.readAsDataURL(f)
  })
}

function onAttachPick (ev) {
  const el = ev.target
  const picked = Array.from(el.files || [])
  el.value = ''                       // 清空 ⇒ 再选同一个文件仍会触发 change
  const tooBig = []
  picked.forEach(f => {
    if (f.size > ATT_MAX_MB * 1024 * 1024) { tooBig.push(f.name); return }
    stagedFiles.value = stagedFiles.value.concat([{ key: ++attSeq, name: f.name, size: f.size, file: f }])
  })
  attMsg.value = tooBig.length ? `超过 ${ATT_MAX_MB}MB 未加入：${tooBig.join('、')}` : ''
}

function removeStaged (key) {
  stagedFiles.value = stagedFiles.value.filter(x => x.key !== key)
}

/** 保存拿到 rid 后把暂存文件逐个上传。**自己吞异常**（不能连累外层 try：单据已经建好了）。
 *  @returns {{ok:number, fail:string[]}} 失败的留在 `stagedFiles` 里供用户看见。 */
async function uploadStaged (rid) {
  if (!rid || !stagedFiles.value.length) return { ok: 0, fail: [] }
  let ok = 0
  const fail = []
  const left = []
  for (const s of stagedFiles.value) {
    try {
      const b64 = await readFileAsBase64(s.file)
      await psiApi.uploadReturnAttachment(rid, s.name, b64)
      ok++
    } catch (e) {
      fail.push(`${s.name}（${e.message || '上传失败'}）`)
      left.push(s)
    }
  }
  stagedFiles.value = left
  return { ok, fail }
}

/* ══ 模式 A 的逻辑（原样搬移）════════════════════════════════════════════════════ */
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

async function submitAttached () {
  const bad = validateReturn()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  const no = srcOrderNo.value
  /* 🔴 二次确认**必须留**：这一支会扣库存并把原单标成「已退货」，不可撤销。
     那句「可撤销」的话术是给用户判断用的，不是装饰。 */
  if (!await confirm(`确认对采购单 ${no} 退货 ¥${fmtMoney(retTotal.value)} 吗？\n\n`
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
    router.replace({ path: cfg.value.listPath, query: cfg.value.listQuery || {} })
  } catch (e) {
    // 后端 detail 原样显示（例如「退货数量 X 超过可退数量 Y」）
    toast(e.message || '退货失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ══ 基础资料 / 初始化 ═══════════════════════════════════════════════════════════ */
async function loadRefs () {
  try {
    const d = await psiApi.refs('warehouses,suppliers,products,departments', '', 500)
    warehouses.value = d.warehouses || []
    suppliers.value = d.suppliers || []
    products.value = d.products || []
    // v451（L3）：部门下拉。后端读不到时**返回空数组/不返回这个键** ⇒ 回落 `[]`
    //   （下拉只剩「请选择」）—— 与采购订单页同款降级，不抛错。
    departments.value = d.departments || []
    // 默认仓：优先 is_default，其次第一个（两个 is_default 时取 id 最小，仅作默认值，用户可改）
    const defs = warehouses.value.filter(w => w.is_default)
    const pick = (defs.length ? defs : warehouses.value).slice().sort((a, b) => a.id - b.id)[0]
    if (pick) form.value.warehouse_id = pick.id
  } catch (e) {
    toast(e.message || '基础资料读取失败', 'error')
  }
}

function back () {
  router.push({ path: cfg.value.listPath, query: cfg.value.listQuery || {} })
}

/** 按当前 URL 把页面重置到对应模式。
 *  🔴 必须是**可重入**的：`/inventory/purchase/return/new` 是同一条 path，
 *     `?from_po=N` 的有无会让 vue-router 复用同一个组件实例 ⇒ 只写一个 `onMounted`
 *     的话在两种模式间切换会停在旧数据上，而且**零报错**。 */
async function reinit () {
  if (isAttached.value) {
    items.value = []
    retReason.value = ''
    retError.value = ''
    await loadPreview(fromPo.value)
    return
  }
  retPreview.value = null
  retRows.value = []
  retReason.value = ''
  items.value = []
  for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
  await loadRefs()
  /* v684：列表行「退货」跳过来时带 `?supplier_id=` —— 自由退货不再挂原单，
     供应商只能从这里补上下文（不然用户还得重选一遍）。
     🔴 必须校验该 id **真的在 suppliers 下拉里**：URL 用户可改，带个不存在/被停用的 id
        会让 SupplierCombo 显示空白、而 `form.supplier_id` 仍是脏值 ⇒ 提交时后端 400
        「请先选择退货供应商」，用户看着界面有供应商却报错，无从下手。 */
  const sq = Number((route.query && route.query.supplier_id) || 0) || 0
  form.value.supplier_id = (sq > 0 && suppliers.value.some(x => Number(x.id) === sq)) ? sq : 0
}

onMounted(() => {
  form.value.order_date = todayISO()
  reinit()
})
watch([fromPo], () => { reinit() })
</script>

<style scoped>
/* 🔴 本样式块与 `PurchaseOrderForm.vue` 的 `.ipn-*` 块**同源**（都来自 v448 的
   `InvPurchaseNew.vue`），保证两个采购建单页在字号 / 行高 / 内距 / 控件宽高上共用
   同一份数值（《进销存建单页开发规范》§R 的视觉基准）。
   ⚠️ 为什么是**复制**而不是抽成一个共享 css 文件：`<style scoped>` 编译后会给每条
      规则加上 `[data-v-xxx]`（特异性 0,2,0）；抽成全局文件后掉回 (0,1,0)
      ⇒ 会被其它全局规则盖住，§R 的基准**静默漂移**。
   ⚠️ 本文件与采购订单页**共用**「操作列」`.ipn-c-op`（sticky + 64px 宽），
      那条规则已在共享块里（与采购订单页同源）；末尾不再挂 `.ipn-c-del` / `.ipn-prod-kw`
      —— 退货明细表已随 v454 升级为「插行 + 删除」双按钮操作列、并撤掉商品筛选框。
   ⚠️ 块内还留着一些**本页用不到**的规则（`.ipn-sup-combo` / `.ipn-batch-pop` /
      `.ipn-dd` / `.ipn-at-bar` …）。留着不删是有意的：删它们不影响任何渲染，
      而整块保持与 `PurchaseOrderForm.vue` 逐字节相同 ⇒ 将来比对两份样式时
      一眼就能看出差异，不用逐条筛"哪些是共享的、哪些是本页特有的"。 */

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
/* v431：让 `.ipn-body` 成为**唯一占满剩余高度**的滚动容器，表格在内部滚动；
   其它兄弟元素只取内容高度，不再分走空间（覆盖 InventoryShell `:deep(*)` 的 `flex:1 1 auto`）。
   这样新增行永远落在 `.ipn-body` 滚动区内，不会被底部合计条盖住。 */
.inv-page > .page-hd,
.inv-page > .ipn-hd,
.inv-page > .ipn-strip,
.inv-page > .ipn-bottom { flex: 0 0 auto }
.ipn-acts { display: flex; gap: 8px; flex-wrap: wrap }
.ipn-body {
  display: flex; flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.ipn-body > .ipn-bar,
.ipn-body > .ipn-tip,
.ipn-body > .state-empty { flex: 0 0 auto }
.ipn-body > .table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 0;
  border-radius: 0;
}

/* v417d（对照舟谱：单屏行数 ↑）页头单行 —— 标题与副标题回到**同一基线行**（原为竖排两行）。
   全局 `.page-hd` 的「内联 / 堆叠」由模板结构分派：外面包一层 div 就会回落到两行，
   故这里只给内层容器定对齐，**不动全局类**（16~17 个页面共用它）。 */
.ipn-hd-t { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0 }

/* 表单头。v438（复刻舟谱）：`align-items` 由 flex-end 改 center —— 标签改与框同行后，
   一行内没有「底部对齐」可言，居中才齐。 */
.ipn-hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px }
/* v417d 去卡片包裹：本页「单头表单 / 明细」两块不再套 `.card` 的框。
   页面底 `.content{background:var(--bg)}` 与 `.card{background:var(--bg)}` 同色 ——
   那个框本来只是 border+shadow，去掉不影响配色（深色同理）。
   scoped 属性把特异性抬到 0,2,0 > 全局 `.card` 的 0,1,0，覆盖必然生效（无需 !important）。 */
.ipn-hd-flat { padding: 0; background: transparent; border: 0; border-radius: 0; box-shadow: none }
/* v438（复刻舟谱）：「标签 + 输入框」排**同一行**（原为标签在上、框在下两层）。
   🔴 这一改是**单头高度的主要来源**：每格由「12px 标签 + 4px 间距 + 32px 框 ≈ 48px」
      压到 32px，且一行能并更多字段 —— 舟谱建单页那排紧凑感就来自这里。
   `flex-wrap: wrap` 保留：退货模式那格里带 `.ipn-hint`（flex-basis:100%）要靠它换行。
   🔴 v439 补 `flex: none`：**这一格是原子的，不许被外层压缩** —— 少了它，`flex-shrink`
      会把「经办人 / 部门 / 入库仓库」这类没有 min-width 的格挤窄，格内的
      「标签 + 下拉」随即被 `flex-wrap` **拆成上下两行**（老板报障的正是这三格）。
      改成 flex:none 后，宽度放不下时整格换行，永不把标签与框拆开。 */
.ipn-f { display: flex; flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap; flex: none }
/* v439：各格宽度按「6 格一行放得下」重新配平（实测：原宽合计 1480px，
   1412px 内容宽就挤掉「备注」换行）。现在合计 ≈1250px，1440 屏也一行放得下，
   宽屏则由「备注」吃掉余量（它是唯一 flex:1 的格）。 */
.ipn-f-grow { flex: 1; min-width: 160px }
.ipn-f-sup { min-width: 260px }
/* v439：退货模式「原采购单」格必须**给死宽度**。它带一句 `.ipn-hint`
   （`flex-basis:100%`）—— 百分比基会把这一格的 max-content 撑到 691px（实测），
   而 v439 给 `.ipn-f` 加了 `flex: none`（不再回缩）⇒ 右侧会留一大片空白，
   把后面「供应商 / 退货仓库 / 原单状态」推到半屏外。380px = 标签 + 选择器（348）+ 余量。 */
.ipn-f-po { width: 380px }
.ipn-lb { font-size: 12px; color: var(--t3); white-space: nowrap; flex: none }
/* 必填标记。v439 改版：由「必填」两个字改成**红 `*`**（对齐舟谱的 `*供应商：`）——
   每个必填格省下 2 个字的宽度，一行更容易并下全部字段。
   `.ipn-opt`（原「选填」弱色标记）已随本轮**整体撤除**（舟谱那边选填不打标），
   故那条规则一并删掉，不留死 CSS。 */
.ipn-req { color: var(--dan); font-size: 13px; line-height: 1; margin-right: 2px }

/* ══ v439（复刻舟谱·字段框）════════════════════════════════════════════════
   舟谱建单头那排是「**一个描边框**里左边标签、右边值」（`*供应商: 🔍`｜`*经办人: 请选择 ▾`），
   不是「标签在框外、旁边再放一个框」。这里把 `.ipn-f` 本身做成那个框：
     · 框 = 底色 + 1px 描边 + 圆角 + 左右内距，标签与值都是框内的 flex 子项；
     · 框内控件**必须去掉自己的边框 / 底色 / 内距** —— 否则「框里再套一个框」。
       🔴 全局 `.input` 是 `width:100%`：在横排框里会解析成「撑满整框」并把标签挤出去
          ⇒ 这里一律 `width:auto`，宽度由各控件自己的类显式给（`.ipn-sel`/`.ipn-date`/…）。
     · 高度：框内控件收到 30px ⇒ 框 = 30 + 上下 1px 边框 = **32px**，与全站输入框同高。
     · 聚焦高亮**上移到框**（`:focus-within`，色值照抄全局 `.input:focus`）；
       框内控件的 focus 环要关掉，否则一大一小两层环。
     · 标签的冒号（`*供应商：`）由 `::after` 生成，**不改模板文案**；
       必填的 `*` 是模板里的 `<span class="ipn-req">*</span>`（红字，在标签最前）。
   🔴 v448 起**退单模式也挂**（原先刻意不挂，理由已随本轮作废：那排有只读格 ——
      处理方式见下方 `.ipn-ro` 的框式覆盖规则）。同一个建单页的两种模式必须是同一套界面。 */
/* v462：上述 5 条结构性规则已抽到全局 variables.css 的 `.hd-box`（单一来源），本页容器改挂 `.hd-box`，不再重复定义 */
/* 框内控件宽度（覆盖全局 `.input{width:100%}`——见上）。
   v439：112 / 120 是**实测**值 —— 本租户仓名「东津仓」3 字、日期串「2026/10/10」
   都在此宽度内完整显示；再窄会把日期控件的日历图标挤掉。 */
.hd-box .ipn-f .ipn-sel { width: 112px }
.hd-box .ipn-f .ipn-date { width: 120px }
.hd-box .ipn-f .ipn-note-in { flex: 1; width: auto; min-width: 120px }
.hd-box .ipn-f .ipn-cf-in { width: 160px }
/* 供应商组合框：撑满框内剩余宽度（`.ipn-sup-input` 已经是 100%，这里管住外层）*/
.hd-box .ipn-f .ipn-sup-combo { flex: 1; min-width: 0 }
.hd-box .ipn-f .ipn-sup-input { width: 100% }

/* v414（P2-6）退货模式：表单头下的说明（「只列出进过货的单」）—— 弱色小字。
   v438：`.ipn-f` 改横向排布后，这条说明要**独占一行**（flex-basis:100%），
   否则会挤在「原采购单」标签与选择器之间，把那一格撑歪。 */
/* 退货模式的说明（v448：由「原采购单」格内**移到表单头外**）。
   留在框里会把那一格撑到 78px 高、四个框永远不等高；移出后表单头 = 四个 32px 等高的框。
   `max-width` 由 340 放到 900：它现在占整行，不必再挤在 380px 的格里反复换行。
   `-6px` 上边距用来抵掉表单头那 12px 的下外边距，让说明贴着它说明的那个头。 */
.ipn-hint { font-size: 11px; color: var(--t3); line-height: 1.4; max-width: 900px; margin: -6px 0 12px }
.ipn-hint b { color: var(--t2) }
/* 只读值（退货模式的供应商 / 退货仓库 / 原单状态）：由原单带出，**改不了**
   （刻意不用 disabled input —— 那会让人以为点开能改）。
   v448：退单头改框式后，它**进框成为「值」** —— 与框内控件同款（30px 高 / 无边框 /
   无底色 / 内距 `0 2px` / 14px），只差不能输入。
   🔴 撤掉原先的 `1px dashed + --bg2` 虚线框：那套「虚框 = 不可改」是**自造语义**
      （虚框既不是禁用也不是可编辑的既有表示），放进框式头更像「少画了一半的框」。
      不可改这件事交回它该在的地方 —— 点不动、没有下拉箭头。
   `min-width: 112px` = §R.4 里下拉的宽度：**不取下限的话**格宽由值的长短决定
   （没选原单时值是 `—`，整格只有 86px；一选中又被撑宽）⇒ 表头跟着来回跳。
   `max-width` + 省略号：供应商 / 仓名的长度不可控，别让它把这一格撑爆。 */
.ipn-ro {
  display: flex; align-items: center; height: 30px; padding: 0 2px;
  min-width: 112px; max-width: 260px; flex: none;
  font-size: 14px; color: var(--t1); background: transparent; border: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 「原采购单」格宽度放宽到 420px：框式头有 16px 左右内距，且框内控件收掉了全局
   `.input` 的 `width:100%`（见下条），380px 装不下「标签 + 搜索框 + 下拉」。
   v448：说明行已挪到框外 ⇒ 这一格与其余三格同是 32px 等高，不再需要 `flex-wrap: wrap`。 */
.hd-box .ipn-f-po { width: 420px }
/* 🔴 框式头里 `.hd-box .ipn-f .input { width: auto }`（0,3,0）会**吃掉**
   `.ipn-kw{width:130px}` / `.ipn-sel{min-width:140px}`（0,1,0）⇒ 显式写回。
   只限定在「原采购单」格：订单模式那排的控件宽一个都不动。 */
.hd-box .ipn-f-po .ipn-kw { width: 130px }
.hd-box .ipn-f-po .ipn-sel { width: 200px; min-width: 0 }
/* 退货明细的工具条（全部可退 / 清零）：推到右侧，不与「退货明细」标题挤在一起 */
.ipn-ret-quick { display: flex; gap: 8px; margin-left: auto }
/* 退货明细列少（9 列 vs 采购单 15 列）⇒ 表宽比采购单小一档，别跟着留 1758px 的横向滚动。
   🔴 v448 提权重到 `.ipn-tbl.ipn-ret-tbl`：原先写单类 `.ipn-ret-tbl`（0,1,0），
      在文件里排在 `.ipn-tbl { min-width: 1372px }`（同为 0,1,0）**之前** ⇒ 被静默吃掉，
      退货表实际一直按 1372px 渲染（"列少一档"从未生效）。同权重靠顺序取胜是隐式的，
      谁把这两条换个位置就又翻回去 —— 所以这里用两个类把意图写死。 */
.ipn-tbl.ipn-ret-tbl { min-width: 900px }
.ipn-ret-unit { width: 72px; color: var(--t2) }
/* 底部「退货原因」：吃掉左侧以外的空白，把右侧的保存按钮顶到最右 */
.ipn-ret-reason { flex: 1; min-width: 220px; height: 32px }
.ipn-cnt { color: var(--t3); font-variant-numeric: tabular-nums; flex: none }
/* v451（L3）：明细工具条里的「按小单位采购」勾选框 —— 推到最右，与左侧
   「退货明细 + 项数」分开（`margin-left:auto` 在同排 flex 里就是推到右端）。
   ⚠️ 不要给它加第 4 个宽度约束：`.ipn-bar` 是 `flex-wrap:wrap`，窄屏它会自己换行。 */
.ipn-chk {
  display: inline-flex; align-items: center; gap: 6px;
  margin-left: auto; font-size: 12px; color: var(--t2);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.ipn-chk input { margin: 0; cursor: pointer }
/* v415（P2-7）自定义字段的输入框：固定宽度（字段名 ≤12 字 + 值 ≤200 字，160px 够看一屏），
   不跟着 `.ipn-f-grow` 撑满 —— 它们是一组等宽的短字段，不是主字段。 */
.ipn-cf-in { width: 160px; height: 32px }
/* 退货模式「原采购单」搜索框 + 下拉：仍是两框并列（与采购单供应商组合框不同，这里保留旧式）。
   v428 把采购单的供应商选择改成了组合框，但原采购单选择器不动。 */
.ipn-sup-pick { display: flex; gap: 6px }
/* v428：供应商组合框样式已抽到 SupplierCombo.vue（与采购订单页共用，单一来源）。
   本页只保留框式头里对组合框的**布局**控制：`.hd-box .ipn-f .ipn-sup-combo` / `.ipn-sup-input`。 */
/* v428：备注框与同排其它输入框同高（全局 .input 默认 40px，会高低不齐）。
   v438：`.ipn-f` 改横向后，备注框要自己**吃掉剩余宽度**（flex:1），否则只按
   原生 size 撑一小截，右半行留白。 */
.ipn-note-in { flex: 1; min-width: 140px; height: 32px; padding: 0 10px }
/* v430：商品组合框（名称 + 条码 模糊查找），样式对齐供应商组合框（同用 --bg/--bd/--t1 变量） */
.ipn-prod-combo { position: relative; flex: 1; min-width: 0 }
.ipn-prod-combo .ipn-in { width: 100% }
.ipn-prod-list {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
  margin: 0; padding: 4px; list-style: none; max-height: 240px; overflow-y: auto;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipn-prod-list li {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--t1);
}
.ipn-prod-list li.active, .ipn-prod-list li:hover { background: var(--bg2) }
.ipn-prod-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipn-prod-bar { flex: none; font-size: 12px; color: var(--t3); font-variant-numeric: tabular-nums }
.ipn-prod-empty {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
  padding: 10px; background: var(--bg); border: 1px solid var(--bd);
  border-radius: var(--radius-md); box-shadow: var(--shadow-md); font-size: 12px; color: var(--t3);
}
.ipn-kw { width: 130px; height: 32px }
/* v438：下拉 / 日期框各收窄 20~30px —— 标签同行后每格宽度 = 标签 + 6px + 控件，
   控件不瘦身则 7 格换 3 行，「省空间」落空。140px 容得下本租户的仓名 / 部门名。 */
.ipn-sel { min-width: 140px; height: 32px }
.ipn-date { width: 140px; height: 32px }

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

/* ---- 附件暂存条（v438）----------------------------------------------------
   与「供应商信息条」同族观感（浅底 + 细边 + 圆角），但语义不同：那条是**已有数据**，
   这条是**尚未落库的待传文件** ⇒ 底色用中性 --bg2 而不是品牌色 --p-bg，
   不让它看起来像"已生效"。 */
.ipn-at-bar {
  display: flex; flex-direction: column; gap: 6px;
  margin-bottom: 12px; padding: 9px 16px;
  background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--radius-md);
  font-size: 13px; color: var(--t1);
}
.ipn-at-hd { display: inline-flex; align-items: center; gap: 6px; color: var(--t2); font-size: 12px }
.ipn-at-tip { color: var(--t3); font-style: normal; margin-left: 2px }
.ipn-at-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px }
.ipn-at-list li {
  display: inline-flex; align-items: center; gap: 6px; max-width: 280px;
  padding: 2px 4px 2px 10px; background: var(--bg); border: 1px solid var(--bd);
  border-radius: 999px; font-size: 12px; color: var(--t1);
}
.ipn-at-nm { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipn-at-sz { color: var(--t3); font-variant-numeric: tabular-nums; flex: none }
.ipn-at-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 0; background: transparent;
  color: var(--t3); cursor: pointer; border-radius: 50%; flex: none;
}
.ipn-at-x:hover { background: var(--bg2); color: var(--dan) }
.ipn-at-msg { margin: 0; font-size: 12px; color: var(--dan) }
/* 页头按钮上的个数角标（对齐详情页附件入口的角标做法） */
.ipn-at-badge {
  margin-left: 5px; padding: 0 6px; border-radius: 8px;
  background: var(--bg2); color: var(--t2); border: 1px solid var(--bd);
  font-size: 11px; font-variant-numeric: tabular-nums;
}
/* 隐藏的 file input：**不能用 display:none** —— 部分浏览器下 `.click()` 不触发。 */
.ipn-at-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none }

/* 明细卡 */
/* v417d：明细工具条由「两行」（工具条 + 口径提示）压成「一行」——
   筛选框与「加一行」上移到页头，这里只留「商品明细 + 项数 + 口径说明（默认折叠）」。
   折叠态下明细上方只占这一行，展开才补回说明文字（省约 26px ≈ 0.7 行）。 */
.ipn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px }
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
   数量右对齐成一列才好扫读。 */
/* v417g：列宽整体收窄（对齐舟谱「操作列永远可见、无横向滚动」）——
   min-width 1758 → ~1600，1920 屏（侧栏+页边距后可视 ~1670px）放得下 15 列；
   同时单元格横向 padding 12→8px（纵向不动，v417e 的 33px 行高不受影响）。 */
/* v417i：批次三列合一 ⇒ 少 2 列（原 1604px ⇒ 1372px），配合列宽收窄，横向滚动消失。 */
.ipn-tbl { min-width: 1372px }
/* v417g：单元格横向 padding 12→8px（纵向不动 —— v417e 的 33px 行高不受影响）。
   🔴 选择器**必须**带 `table.ipn-tbl`：写成 `.ipn-tbl td` 的 specificity 低于全局
      `table.tbl td{padding:10px 14px}`（variables.css:530），会**静默失效**
      （样式看着写了、实际没生效）。 */
table.ipn-tbl th { padding: 4px 8px }
table.ipn-tbl td { padding: 2px 8px }
table.tbl.ipn-tbl td.seq-cell { padding: 2px 4px }
.ipn-c-stk { width: 78px; font-variant-numeric: tabular-nums; white-space: nowrap }
/* 「实际有货、一件都不可售（全过期）」——必须扎眼，否则用户以为有货能卖 */
.ipn-c-stk .danger { color: var(--danger-txt) }
.ipn-c-prod { min-width: 240px; position: relative }
.ipn-c-code { width: 100px; color: var(--t2); font-variant-numeric: tabular-nums }
/* v409（P2-1）：单位列 64→92px 是给「下拉 + 换算浮层」的；v417g 浮层已不占宽，收到 84px。 */
.ipn-c-unit { width: 84px }
.ipn-unit-sel { height: 22px; padding: 0 4px }
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
.ipn-c-ref { width: 86px; color: var(--t2) }
.ipn-c-price, .ipn-c-qty { width: 86px }
.ipn-c-amt { width: 92px }
/* v417i：原来 118(批次号) + 132×2(两个日期) = 382px ⇒ 现在一列 150px 装摘要 + 小面板入口 */
.ipn-c-batch { width: 150px }
/* v442：`.has-val` 在模板里被绑定（`:class="{ 'has-val': batchText(row) }"`），
   但**全仓没有任何 `.has-val` 规则** —— 是 UI-SPEC §7.1「类差集审计」查出来的
   「零样式定义」类（构建零报错、肉眼也看不出，因为没效果）。
   这里按它当初的意图补上：没填批次时格内那两个字是**占位**（"填写"），要比真值弱一档。
   ⚠️ 不删这个绑定：它承载的「这格填了没有」语义是模板作者写下的意图，
      删掉就再也看不出来；补一条规则才是把意图落地。
      与 `.ipn-v.is-ph`、`.isn-unit.none` 对占位文字的处理同一条口径（`var(--t3)`）。 */
.ipn-c-batch:not(.has-val) .ipn-batch-txt { color: var(--t3) }
/* v417g：未选商品的行，日期输入淡显（浏览器自带的「年/月/日」占位没法改色，
   只能整体降透明度；选中商品即恢复，输入不受影响）。 */
.ipn-in.ipn-dim { opacity: .38 }
/* v408（P1-2）行备注：选填短文本，给足宽度但不抢主列 */
.ipn-c-note { width: 150px }
/* v417g：操作列 **sticky 右贴** —— 即便窄屏出横向滚动，「新增/删除」也永远够得着
   （对齐舟谱：操作列永远可见）。border-collapse:collapse 下 sticky 边框会丢，
   用 inset box-shadow 当左边分割线；行悬停时跟着换 bg2，不然悬停行上这块是「洞」。 */
.ipn-tbl th.ipn-c-op, .ipn-tbl td.ipn-c-op {
  position: sticky; right: 0; z-index: 2;
  background: var(--bg);
  box-shadow: inset 1px 0 0 var(--border-subtle);
  /* v680：禁止按钮换行（第二道保险，配合上面的 76px 固定宽） */
  white-space: nowrap;
}
.ipn-tbl th.ipn-c-op { background: var(--bg2) }
.ipn-tbl tbody tr:hover td.ipn-c-op { background: var(--bg2) }
/* v431：明细行在 `.ipn-body` 滚动容器内滚入可见区时，底部留给「合计」条 ~32px 的留白，
   否则 scrollIntoView 会把行底顶到底、正好被合计条盖住。 */
.ipn-tbl tbody tr { scroll-margin-bottom: 32px }
/* v447：把**从全局 `.input` 继承来的**三处值显式写成与「文本态 `.ipn-v`」相同 ——
   修掉「点激活」那一刻的视觉跳变（真机实测原值：字号 13 → 14、内距 `0 4px` → `0 14px`、
   圆角 8 → 12，三项**同时**跳，点下去像换了个控件）。
   🔴 根因是**继承**：`.ipn-in` 只写了 `width/height`，其余走全局 `.input`
      （`.input{height:40px;padding:0 14px;border-radius:var(--radius-md)}` + 字号由 body 继承 14px）
      ⇒ 光看本页 CSS 完全看不出这三个数是多少，必须真机 `getComputedStyle` 才量得出来。
   🔴 方向是「输入态向文本态靠」：文本态是用户首屏看到的形态、也是 §R 的正文口径（13px），
      点进去应该只多一个「可编辑」的框，而不是换一套字号和内距。
   🔴 `border-radius` 用 `--radius-sm`(8) 与 `.ipn-v` 一致：22px 高的框配 `--radius-md`(12)
      偏胶囊，收成 8 才是 §R 的控件圆角档。
   ⚠️ `padding` 用 3px 不是 4px：输入态有**真边框 1px**（占位），而文本态 `.ipn-v` 的描边是
      `inset box-shadow`（不占位）⇒ 1 + 3 = 4px，与文本态内距逐像素对齐，点激活时文字左右不动。
      同理左侧（input 有 border、span 没有），右侧（文字右对齐时按 padding-right 算）。
      两态对齐后文字位置完全一致，肉眼零跳动。 */
.ipn-in { width: 100%; height: 22px; font-size: 13px; padding: 0 3px; border-radius: var(--radius-sm) }
/* v417h（对照舟谱·行密度）：**浏览态扁平化** —— 仍铺与表单头「供应商框」一致的底色（var(--bg3)）、只留极淡描边，
   整行看起来像「一排文���」，鼠标指向或键盘聚焦才浮起成可编辑的框。
   🔴 不这么做的代价：15 列全画成带底色的输入框，视觉噪音重、扫读时找不到当前行；
      但格子**仍是 input**（不是换成文本再切换），可点可键盘 Tab，零交互回归风险。 */
/* v444：底色撤掉（原 `var(--bg3)` ⇒ `transparent`，理由见下面 `.ipn-v` 那段注释）。
   保留这条规则本身（而不是删掉整行）：全局 `.input{background:var(--bg3)}` 仍在，
   只有**显式写 transparent** 才能真的撤掉；删规则会让输入框退回全局的灰底 —— 那正是
   「以为改了、其实没改」的静默失效。 */
table.ipn-tbl .ipn-in:not(:focus) { background: transparent; border-color: transparent }
/* ══ v445：明细表输入框「默认无框」 —— v444 撤底色之后的第二步 ══════════════════
   默认态连淡描边一起撤掉（整行就是一排文字），**鼠标指到 / 键盘聚焦才浮出框**。
   🔴 三条硬约束（改错任何一条都会留下难查的坑）：
     ① 用 `border-color: transparent` 而**不是** `border: none`：边框宽度仍是 1px、
        盒模型一字不变，hover ⇄ focus 切换时**零尺寸抖动、零行位移**。写 `border:none`
        输入框会宽高各缩 2px，整行文字跟着跳一下 —— 在 15 行 × 13 列的网格里非常明显。
     ② focus 的「更清晰」靠**品牌色描边 + 外发光 box-shadow** 叠加，**不加粗 border**
        （加粗同样改盒模型 ⇒ 同样抖）。外发光不占布局，是这里唯一安全的加强手段。
     ③ 「默认透明」的 specificity 是 (0,3,1)，会**压过**全局 `.input.err`(0,2,0) 的红色
        校验框 ⇒ 错误提示会被一起变没（典型静默失效）。所以下面必须显式写回 `.err`、
        `:disabled`、`[readonly]` 三条例外。 */
/* 悬浮：淡灰描边，**整行一起浮起**（扫读时一眼知道"这一行能填"，与舟谱同感）。
   🔴 必须排除 `:disabled` / `[readonly]`：退货明细的「退货数量」在无可退量时是
   disabled，给它浮框等于承诺"这格能填"，点了没反应。 */
table.ipn-tbl tr:hover .ipn-in:not(:focus):not(:disabled):not([readonly]) { border-color: var(--bd) }
/* 聚焦：品牌青描边 + 淡青外发光（与全局 `.input:focus` 同一视觉语言，但把"正在输入
   这一格"明确标出来 —— 与上面的灰色 hover 是**颜色 + 发光**双重区分，不是深浅之分）。 */
table.ipn-tbl .ipn-in:focus { border-color: var(--p-dark); box-shadow: 0 0 0 3px var(--p-bg) }
/* 禁用 / 只读：任何状态都不浮框（全局已给 `cursor:not-allowed` 与弱化字色来表意） */
table.ipn-tbl .ipn-in:disabled,
table.ipn-tbl .ipn-in[readonly] { border-color: transparent; box-shadow: none }
/* 校验错误：红框**默认就要可见**（它是提示不是装饰），不能被"默认无框"吃掉。
   🔴 连 `:focus` 的外发光也要写回红色 —— 否则上面那条青色发光 (0,3,1) 会盖住
   全局 `.input.err:focus` (0,3,0) 的红发光，变成"红框 + 青光"的错配色。 */
table.ipn-tbl .ipn-in.err,
table.ipn-tbl .ipn-in.err:focus { border-color: var(--dan) }
table.ipn-tbl .ipn-in.err:focus { box-shadow: 0 0 0 3px var(--dan-bg) }
/* v417j 文本态（未激活的格）：行高比输入框态矮约 5px —— 这就是本档密度收益的来源。
   🔴 不加 `overflow:hidden + ellipsis` 会怎样：商品名一长就把列撑宽、把表格推出横向滚动，
      等于把刚省下的宽度又吐回去了。 */
/* v436①：可编辑格的**浏览态**也铺与表单头「供应商框」一致的底色 + 极淡描边
   （var(--bg3) 底 + var(--bd) 边），使「哪里能填」一眼可辨 —— 可编辑格有框、
   只读格（库存/金额/条码…）无框，两态一眼可分。
   🔴 描边用 `inset box-shadow` 而非真 `border`：不占盒模型、不改行高，
      `[data-density=compact]` 下 min-height:16 也不会把文字上下切掉（v417e 密度不受影响）。 */
/* v444：**撤掉**明细表输入框的底色（`var(--bg3)` ⇒ `transparent`）。
   v436 加底色的初衷是「让『哪里能填』一眼可辨」，但 15 行 × 13 列铺下来是**满屏灰底方块**，
   实测下来压过了数据本身（老板原话：「全屏输入框给人感觉确实有点压抑」）。
   🔴 改成 `transparent` 而**不是**换一个更浅的底色：更浅的灰在深色/浅色主题下都要再调一遍，
      而「无底 + 极淡描边」在两套主题下都成立，也不会再引入一个要维护的色值。
   「哪里能填」改由**描边 + hover/focus 反馈**承载（下面两条），不再靠底色。 */
.ipn-v {
  display: block; min-height: 18px; line-height: 18px; padding: 0 4px;
  font-size: 13px; color: var(--t1); cursor: text;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  /* v445：描边也撤掉（原 `inset 0 0 0 1px var(--bd)`）—— 与 `.ipn-in` 同一口径：
     默认态**既无底也无框**，「这格能填」完全交给 hover / focus 反馈承载。 */
  background: transparent; box-shadow: none; border-radius: var(--radius-sm);
}
/* 悬浮：淡灰描边（与 `.ipn-in` 的行 hover 同步浮起，两种态视觉上必须一致 ——
   否则同一行里 input 格有框、文本格没框，看着像两批控件）。 */
table.ipn-tbl tr:hover .ipn-v { box-shadow: inset 0 0 0 1px var(--bd) }
/* 聚焦：品牌青描边 + 淡青外发光（比 hover 多一层外发光 ⇒ 区分靠"颜色 + 发光"两处，
   不是靠深浅，深浅在深色/浅色两套主题下总有一边看不出来）。
   🔴 描边仍用 `inset box-shadow` 不用真 border：`.ipn-v` 是 span，加 border 会把
   行高顶起来（v417e 紧凑档 min-height:16 会切字），inset 描边不占盒模型 ⇒ 零抖动。 */
.ipn-v:focus { outline: none; box-shadow: inset 0 0 0 1px var(--p-dark), 0 0 0 3px var(--p-bg) }
.ipn-v.num { text-align: right; font-variant-numeric: tabular-nums }
.ipn-v.is-ph { color: var(--t3) }
/* v417k：本页自带更紧的行高（scoped specificity 高于全局），故紧凑档要**在这里**再收一档，
   否则开关对采购页无效（全局那条打不破 scoped 规则）—— 这是「开关全局生效」最容易漏的一处。 */
[data-density="compact"] table.ipn-tbl td { padding: 1px 8px }
[data-density="compact"] table.ipn-tbl th { padding: 3px 8px }
[data-density="compact"] .ipn-v { min-height: 16px; line-height: 16px }
/* 行内控件三处**一并**收（只收 .ipn-in 会让单位下拉/批次按钮仍撑着行高 = 半截生效） */
[data-density="compact"] .ipn-in,
[data-density="compact"] .ipn-unit-sel,
[data-density="compact"] .ipn-batch-btn { height: 20px }
/* v417i 批次格：常显摘要 + 点开小面板 */
.ipn-c-batch { position: relative }
.ipn-batch-btn {
  display: flex; align-items: center; gap: 4px;
  width: 100%; height: 22px; padding: 0 4px;
  border: 1px solid transparent; border-radius: var(--radius-sm);
  background: none; cursor: pointer; font-size: 13px; color: var(--t1);
}
.ipn-batch-btn:hover { border-color: var(--bd) }
.ipn-batch-btn:disabled { cursor: default; opacity: .45 }
.ipn-batch-txt { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipn-batch-pop {
  position: absolute; z-index: 20; right: 0; top: calc(100% - 2px); width: 236px;
  padding: 8px; background: var(--bg); border: 1px solid var(--bd);
  border-radius: var(--radius-md); box-shadow: var(--shadow-sm);
}
.ipn-bp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px }
.ipn-bp-lb { flex: none; width: 52px; font-size: 12px; color: var(--t3) }
.ipn-bp-tip { margin: 0 0 6px; font-size: 11px; line-height: 1.4; color: var(--t3) }
.ipn-bp-done {
  width: 100%; height: 26px; border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg2); cursor: pointer; font-size: 12px; color: var(--t1);
}
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
/* v447：行内图标按钮（新增行 / 删除行）**上提为全局 `.btn-row-ic`**
   （`styles/variables.css`）—— 原先这里是本页 scoped 的 `.ipn-ic`，而销售建单页
   用的是全局 `.btn-icon`(30×30)，同一个「删除这一行」在两页既不同尺寸也不同外观，
   且 30px 把销售页数据行顶高到 35px（基准 31.8）。收敛成一处实现后两页逐值一致。 */

/* v431 底部动作条：改为普通 flex 项，由 `.inv-page` 布局推到 `.ipn-body` 下方。
   之前用 sticky 是因为 `.ipn-body` 没有独立滚动区，内容超一屏时动作条必须 sticky 才能贴底；
   现在 `.ipn-body` 自己滚动占满剩余高度，动作条自然落在它下面，无需 sticky，也不会盖住表格最后一行。
   负边距仍用于抵消 Shell `.view-wrap{padding:20px}`。 */
.ipn-bottom {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  flex: 0 0 auto;
  margin: auto -20px -20px -20px; padding: 4px 20px;
  background: var(--bg); border-top: 1px solid var(--border-subtle);
}
.ipn-total { font-size: 14px }
.ipn-total b { font-size: 18px; font-variant-numeric: tabular-nums }
.ipn-warn { font-size: 12px; color: var(--war) }

/* v684：自由退货提醒条 + 行内「无历史采购」角标。
   🔴 角标必须绝对定位：写成行内第二行会把数据行高从 29.8px 顶到 40+（契约 ⑰ 的判据）；
      写成列内 flex 会挤掉商品输入框宽度。 */
.ipn-hist-warn {
  display: flex; align-items: flex-start; gap: 6px;
  margin: 0 0 12px; padding: 7px 10px; max-width: 900px;
  font-size: 12px; line-height: 1.5; color: var(--t1);
  background: rgba(var(--war-rgb), .1);
  border: 1px solid rgba(var(--war-rgb), .35);
  border-radius: 6px;
}
.ipn-hist-warn svg { flex: 0 0 auto; margin-top: 2px; color: var(--war) }
.ipn-hist-dot {
  position: absolute; right: 5px; top: 2px;
  font-size: 11px; line-height: 1; color: var(--war);
  cursor: help;
}
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
  .ipn-bottom { margin-inline: 0; padding-inline: 0 }
  /* v439：窄屏下框内控件要跟着撑满 —— 不写这几条，上面 v439 的定宽规则
     特异性更高（`.hd-box .ipn-f .ipn-sel` 0,3,0 > `.ipn-sel` 0,1,0），
     会把媒体查询的「全宽」顶掉，留下 140px 的短框 + 右半行空白。 */
  .hd-box .ipn-f { width: 100% }
  .hd-box .ipn-f .ipn-sel,
  .hd-box .ipn-f .ipn-date,
  /* v448：退货模式「原采购单」格新增了定宽 `.ipn-kw`（见上方框式覆盖规则），
     这里必须一起放开 —— 否则窄屏下它被 130px 钉死，右边留半行空白。 */
  .hd-box .ipn-f .ipn-kw { width: auto; flex: 1; min-width: 0 }
}

/* v442：本页的 `.col-gear-th` / `.col-cfg.gear` / `.col-menu*` scoped 样式块**已删除**。
   那段是 v432 之前的本地拷贝；v432 起全站唯一实现是 `src/styles/col-menu.css`
   （与本页原那份逐字节相同，故收敛后视觉零变化）。
   🔴 不要在本页（或任何页面）再写回这几个类 —— 见《进销存建单页开发规范》§4 与
      UI-SPEC §2.6.1「三、」。 */

/* ---- 本页与采购订单页**共用**的「操作列」宽度（采购订单页也有 `.ipn-c-op`）---- */

/* v680：操作列 **64px → 76px**（本页与销售 / 调拨建单页同批修正）。
   🔴 64px 是**错的**：净宽 = 64 − 8×2 = 48px，而行内两个 26×26 图标按钮 + 4px 间距
      = **56px** ⇒ 按钮装不下就**换行成两行** ⇒ 数据行高 29.8px 直接翻成 56.6px。
      基准页（采购订货单）此前不限宽、按内容自适应，所以一直是单行；本页硬写成 64px
      才暴露出来 —— 这是"抄列宽"比"抄机制"更危险的一个例子。
   取 76px（56 净宽 + 16 内距 + 4 余量）⇒ 与基准页同宽、同行高。
   sticky 吸右规则见上方 `table.ipn-tbl th.ipn-c-op`（与采购订单页同源抄来）。 */
.ipn-c-op { width: 76px; min-width: 76px }

</style>
