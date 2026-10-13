<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div class="ipn-hd-t">
        <h2>{{ pageTitle }}</h2>
        <!-- v455：必填项图例（复刻舟谱创建页右上角那枚橙色小标）。
             表单头与明细表里的红 `*` 在这里得到统一解释 —— 不写这句，从舟谱迁来的
             用户会以为 `*` 是装饰，或者反过来以为「经办人没填不让存」。 -->
        <span class="ipn-legend"><i class="ipn-req">*</i>必填项</span>
      </div>
      <div class="ipn-acts">
        <!-- v438：附件入口（对齐舟谱建单页右上角的「上传附件」）。
             🔴 建单页**还没有单据 id**，附件无法即时落库 ⇒ 这里选完先「暂存」在本页，
                点保存拿到 id 后再随单上传（新单 / 编辑态都走同一条路）。
                退货模式的单据归属不同，先不给入口（不猜、不埋暗坑）。 -->
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="pickAttachments">
          <Icon name="upload" :size="14" />上传附件<span v-if="stagedFiles.length" class="ipn-at-badge">{{ stagedFiles.length }}</span>
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
        <!-- 隐藏的 file input：真正「选文件」由上面的按钮触发。
             ⚠️ 不能用 `display:none`（部分浏览器 `.click()` 不触发）；
             ⚠️ 多选：一次可挑多张图片 / 多个文件。 -->
        <input ref="attFileEl" type="file" multiple class="ipn-at-file" @change="onAttachPick" />
      </div>
    </div>

    <!-- 表单头（对齐舟谱：*供应商 / *仓库 / 单据日期 / 预计到货 / 备注 0-500）
         v439：外层加 `.hd-box` —— 把每格渲染成**舟谱那样的字段框**：
         描边框内左侧是标签、右侧是值（原为标签在框外）。见全局 `.hd-box` 样式块。 -->
    <div class="ipn-hd ipn-hd-flat hd-box">
      <div class="ipn-f ipn-f-sup">
        <label class="ipn-lb"><span class="ipn-req">*</span>供应商</label>
        <!-- v428：搜索框 + 下拉选择**合并为单个组合框**。输入即按「名称 或 编号」本地
             模糊匹配（编号来自 refs 新增的 `code` 字段），下拉直接点选；未从下拉点选时
             失焦自动还原成「当前已选供应商名」，不允许留下无对应供应商的自由文本。 -->
        <!-- v428：供应商搜索 + 选择合一的组合框（单一来源：SupplierCombo.vue，
             与采购退货单页共用，保证两页供应商输入框外观 / 交互逐像素一致）。 -->
        <SupplierCombo v-model="form.supplier_id" :suppliers="suppliers" />
      </div>
      <!-- v408（P0-5）经办人 / 部门 —— 对齐舟谱建单表单里的 `*经办人` / `*部门`。
           🔴 做成**选填**（舟谱那边标了 `*`＝必填）：存量单（舟谱导入 79 张）都没有这两个值，
              强制必填会在老板快速建单时直接卡住；且这两个字段眼下只用于归属/统计，
              不是单据成立的前提。要改成必填只需给 `form.handler` 加非空校验 —— 不涉及后端。
           v439：**不再挂「选填」小字**（老板要求去掉）—— 无 `*` 即选填是通行读法，
              与「有 `*`＝必填」配成一对；这不改变上面的校验行为（它们**仍然不是**必填）。 -->
      <div class="ipn-f">
        <label class="ipn-lb">经办人</label>
        <select v-model="form.handler" class="input ipn-sel">
          <option value="">不指定</option>
          <option v-for="u in users" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">部门</label>
        <select v-model.number="form.department_id" class="input ipn-sel">
          <option :value="0">不指定</option>
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
      <!-- v439：撤掉「预计到货日期」输入框（老板拍板：本页不需要）。
           🔴 `form.expected_date` **照旧加载、照旧提交**（编辑既有单时必须原样写回，
              整单重写少一个键就等于把原单据的到货日期清空）。只是不再给编辑入口。 -->
      <div class="ipn-f ipn-f-grow">
        <label class="ipn-lb">备注</label>
        <!-- v428：同排其它输入框都是 32px（.ipn-sel/.ipn-date/.ipn-kw），备注框原本只用
             全局 .input（默认 40px）⇒ 整行高低不齐。补 ipn-note-in 收成 32px，对齐。 -->
        <input v-model.trim="form.note" maxlength="500" class="input ipn-note-in" />
        <!-- v439：字数计数**从标签里挪到框尾**（对齐舟谱：0/500 挂在框内最右）。
             留在标签里会挤成「备注：0/500」出现在框左，被读成标签的一部分。 -->
        <span class="ipn-cnt">{{ (form.note || '').length }}/500</span>
      </div>
    </div>

    <!-- v438：附件暂存条 —— 建单页没有单据 id，附件不能即时落库。
         选完先列在这里，点「保存」拿到 id 后随单上传（详情页「附件」里可见 / 可下）。
         🔴 文案如实写「保存后随单上传」：不假装已经传上去了；不保存就离开 ⇒ 这几个文件丢弃。 -->
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

    <!-- 供应商信息条（舟谱那一条「应付余额 / 预付余额」的位置；这里只放**真有的数据**）。
         v417g：未选供应商时整条隐藏 —— 空态下「供应商:未选择 / 已录 N 项 / 合计」
         与上方表单、明细标题行、底部合计**三处重复**，白占一行（对齐舟谱：那行的
         存在意义就是余额，没供应商就没有余额可看）。选中后即出现。 -->
    <div v-if="selSupplier" class="ipn-strip">
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
    <div v-if="cfDefs.length" class="ipn-hd ipn-hd-flat hd-box">
      <div v-for="c in cfDefs" :key="c.key" class="ipn-f">
        <label class="ipn-lb">{{ c.label }}</label>
        <input v-model="extra[c.key]" class="input ipn-cf-in"
               :inputmode="c.num ? 'decimal' : 'text'"
               :placeholder="c.num ? '数字，选填' : '选填'" />
      </div>
    </div>
    <!-- 定义读失败 ⇒ 如实说一句。**不能静默**：用户上次建过字段、这次开单看不到，
         会读成「我的字段没了」；真相是"没读到"，而且建好后仍可在详情页补填。 -->
    <p v-else-if="cfLoaded && !cfOk" class="ipn-tip ipn-tip-stk">
      <Icon name="alert" :size="14" />
      <span>补充信息字段没读到（{{ cfErr || '原因未知' }}）；这张单先存不了它们，建好后可在详情页补填。</span>
    </p>

    <!-- 明细 -->
    <div class="ipn-body">
      <div class="ipn-bar">
        <b>{{ cfg.tblTitle }}</b>
        <span class="ipn-cnt">{{ items.length }} 项</span>
        <!-- v455：「按小单位采购」总闸（复刻舟谱表格工具栏同款开关）。
             默认关 = 按大单位进货（老板 2026-10-13 口径）；开 ⇒ 全表切成小单位，
             每行已填的采购价 / 数量按各自比例换算（金额、折小数量都不变）。
             偏好写 localStorage，下次开单还是这个状态。 -->
        <label class="ipn-unitsw" :class="{ on: smallUnitMode }"
               :title="smallUnitMode ? '当前按小单位采购；点一下切回大单位' : '当前按大单位采购；点一下切成小单位'">
          <input type="checkbox" v-model="smallUnitMode" @change="onSmallUnitMode" />
          <span class="ipn-unitsw-tx">按小单位采购</span>
        </label>
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

      <div v-if="!items.length" class="state-empty">还没有明细，点击任意行末尾的 <Icon name="plus" :size="14" /> 按钮添加一行。</div>

      <div v-else class="table-wrap">
        <table class="tbl ipn-tbl">
          <thead>
            <tr>
              <th class="seq-th col-gear-th">
                <button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button>
              </th>
              <!-- v444：必填三列（商品 / 采购价 / 订单数量）打红 `*`，与表单头
                   「供应商」同一枚 `.ipn-req`；判据 = `validate()` 里实际拦的字段。 -->
              <th class="ipn-c-prod" :style="wStyle('prod')"><span class="ipn-req">*</span>商品<ColResizeHandle col="prod" :start="startResize" :reset="resetColW" /></th>
              <th v-if="isVisible('code')" class="ipn-c-code" :style="wStyle('code')">条码<ColResizeHandle col="code" :start="startResize" :reset="resetColW" /></th>
              <th class="ipn-c-unit" :style="wStyle('unit')">单位<ColResizeHandle col="unit" :start="startResize" :reset="resetColW" /></th>
              <!-- v455：列序对齐舟谱 —— 参考成本价紧邻采购价（订价时对照着看），
                   库存两列（参考信息）移到订单金额之后。见 DETAIL_COLS 的注释。 -->
              <th v-if="isVisible('ref')" class="num ipn-c-ref" :style="wStyle('ref')">参考成本价<ColResizeHandle col="ref" :start="startResize" :reset="resetColW" /></th>
              <th class="num ipn-c-price" :style="wStyle('price')"><span class="ipn-req">*</span>{{ cfg.priceLabel }}<ColResizeHandle col="price" :start="startResize" :reset="resetColW" /></th>
              <th class="num ipn-c-qty" :style="wStyle('qty')"><span class="ipn-req">*</span>订单数量<ColResizeHandle col="qty" :start="startResize" :reset="resetColW" /></th>
              <th class="num ipn-c-amt" :style="wStyle('amt')">订单金额<ColResizeHandle col="amt" :start="startResize" :reset="resetColW" /></th>
              <!-- v408（P1-1）库存两列：口径 = **本页所选「入库仓库」**（不是全部仓的合计）。
                   数量来自 `/api/psi/stock/by-product`，按商品聚合（不是批次级）。 -->
              <th v-if="isVisible('stk')" class="num ipn-c-stk" :style="wStyle('stk')" title="可销售的库存（已过期批次须报损，不计入）">可用库存<ColResizeHandle col="stk" :start="startResize" :reset="resetColW" /></th>
              <th v-if="isVisible('stk2')" class="num ipn-c-stk" :style="wStyle('stk2')" title="该仓全部批次的数量合计（含已过期）">实际库存<ColResizeHandle col="stk2" :start="startResize" :reset="resetColW" /></th>
              <!-- v417i：批次三列（批次号 / 到期日 / 生产日期）合并成一列「批次信息」，
                   点开小面板填写 —— 15 列 ⇒ 13 列，横向滚动彻底消失。
                   三者都是**低频选填**字段（v417 已把批次号、到期日改为选填）：
                   常驻占 3 列宽，换来的是每次开单都要横向滚动找它们。 -->
              <th v-if="isVisible('batch')" class="ipn-c-batch" :style="wStyle('batch')">批次信息<ColResizeHandle col="batch" :start="startResize" :reset="resetColW" /></th>
              <!-- v408（P1-2）行备注：**记在明细行上**（不是整单备注）。舟谱同列。 -->
              <th v-if="isVisible('note')" class="ipn-c-note" :style="wStyle('note')">行备注<ColResizeHandle col="note" :start="startResize" :reset="resetColW" /></th>
              <th class="ipn-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="row.uid" :data-uid="row.uid">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td class="ipn-c-prod" @click="openProd(row)">
                <div v-if="isCellOn(row, 'prod')" class="ipn-prod-combo">
                  <input :value="row._pkw" class="input ipn-in" placeholder="输入名称或条码搜索"
                         v-focus @input="onProdKw(row, $event)"
                         @keydown.down.prevent="pkMove(row, 1)" @keydown.up.prevent="pkMove(row, -1)"
                         @keydown.enter.prevent="pkEnter(row)" @keydown.esc.prevent="pkBlur(row)"
                         @blur="pkBlur(row)" />
                  <ul v-if="row._popen && prodMatches(row).length" class="ipn-prod-list">
                    <li v-for="(p, i) in prodMatches(row)" :key="p.id" :class="{ active: i === row._pactive }"
                        @mousedown.prevent="pkChoose(row, p)" @mouseenter="row._pactive = i">
                      <span class="ipn-prod-name">{{ p.name }}</span>
                      <span v-if="p.barcode" class="ipn-prod-bar">{{ p.barcode }}</span>
                    </li>
                  </ul>
                  <div v-else-if="row._popen && row._pkw && !prodMatches(row).length" class="ipn-prod-empty">没有匹配的商品</div>
                </div>
                <span v-else class="ipn-v" tabindex="0" :class="{ 'is-ph': !row.product_id }"
                      @keydown.enter.prevent="openProd(row)">{{ prodName(row) }}</span>
              </td>
              <td v-if="isVisible('code')" class="ipn-c-code">{{ row.barcode || (row.product_id ? '—' : '') }}</td>
              <td class="ipn-c-unit" @click="cellOn(row, 'unit')">
                <!-- v455：@change 走 onUnitChange —— 换档位时**按比例换算已填的采购价与数量**，
                     否则「10 箱 × 100 元/箱」换成「瓶」会静默变成「10 瓶 × 100 元/瓶」：
                     金额数字不变、意思全变，后端折小单位数量还会少记一整个量级（真金白银）。
                     🔴 `$event` **必须显式传**：v-model 与 @change 同监听 change，
                        写 `onUnitChange(row)` 时第二个参数是 undefined ⇒ 新档位读不到 ⇒
                        换算整段静默跳过（v455 探针实测抓到过，单位变了、价量没换）。 -->
                <select v-if="isCellOn(row, 'unit') && unitOptionsOf(row).length" v-model="row.unit" v-focus
                        class="input ipn-in ipn-unit-sel" :title="row.convText || row.unit"
                        @change="onUnitChange(row, $event)" @blur="cellOff" @keydown.esc="cellOff">
                  <option v-for="o in unitOptionsOf(row)" :key="o.key" :value="o.name">{{ o.name }}</option>
                </select>
                <span v-else class="ipn-v" tabindex="0" :class="{ 'is-ph': !row.unit }"
                      @keydown.enter.prevent="cellOn(row, 'unit')">{{ row.unit || (row.product_id ? '—' : '') }}</span>
                <div v-if="row.convText" class="ipn-conv">{{ row.convText }}</div>
              </td>
              <!-- v455：列序对齐舟谱（参考成本价→采购价→数量→金额→可用/实际库存）。
                   详见表头与 DETAIL_COLS 的注释；这里只搬格子的先后，逻辑一字未动。 -->
              <td v-if="isVisible('ref')" class="num ipn-c-ref">
                <span v-if="row.product_id && refPriceOf(row)">¥{{ fmtMoney(refPriceOf(row)) }}</span>
                <!-- v455：换了档位就显示档案原价的单位，让「参考成本价为什么变了」有处可查 -->
                <div v-if="row.product_id && refConvText(row)" class="ipn-conv">{{ refConvText(row) }}</div>
              </td>
              <td class="ipn-c-price" @click="cellOn(row, 'price')">
                <input v-if="isCellOn(row, 'price')" v-model="row.unit_price" v-focus
                       class="input ipn-in num" inputmode="decimal" @blur="cellOff" @keydown.esc="cellOff" />
                <span v-else class="ipn-v num" tabindex="0"
                      @keydown.enter.prevent="cellOn(row, 'price')">{{ row.unit_price || '' }}</span>
                <!-- v409（P2-1）双单位采购价：舟谱是「100 / 5/箱」两行，这里在所选档单价下面
                     补一行折小单位价。**只在所选档不是小档时显示**（是小档时两行数字相同）。 -->
                <div v-if="ratioOf(row) > 1 && basePriceOf(row)" class="ipn-conv">
                  折 {{ fmtMoney(basePriceOf(row)) }} 元/{{ row.baseUnit || '小单位' }}
                </div>
              </td>
              <td class="ipn-c-qty" @click="cellOn(row, 'qty')">
                <input v-if="isCellOn(row, 'qty')" v-model="row.quantity" v-focus
                       class="input ipn-in num" inputmode="decimal" @blur="cellOff" @keydown.esc="cellOff" />
                <span v-else class="ipn-v num" tabindex="0"
                      @keydown.enter.prevent="cellOn(row, 'qty')">{{ row.quantity || '' }}</span>
                <!-- v409：折小单位数量 —— 让用户**下单时就看见**库存会进多少（不是事后才发现）。 -->
                <div v-if="ratioOf(row) > 1 && baseQtyOf(row)" class="ipn-conv">
                  = {{ baseQtyOf(row) }} {{ row.baseUnit || '小单位' }}
                </div>
              </td>
              <td class="num ipn-amt">{{ row.product_id ? '¥' + fmtMoney(rowAmount(row)) : '' }}</td>
              <!-- v417g：空行不再铺「先选商品」占位（对齐舟谱空行干净）——
                   选商品前的引导只在单位格留一处，库存两列空着。 -->
              <td v-if="isVisible('stk')" class="num ipn-c-stk">
                <span v-if="row.product_id" :class="{ danger: isAllExpired(row) }" :title="stockTitle(row)">{{ stockText(row, 'saleable_quantity') }}</span>
              </td>
              <td v-if="isVisible('stk2')" class="num ipn-c-stk">
                <span v-if="row.product_id" :title="stockTitle(row)">{{ stockText(row, 'quantity') }}</span>
              </td>
              <!-- v417i：批次三字段收进这一格的小面板。格内**常显摘要**（有批次号显示批次号、
                   有到期日显示「到期 xxxx-xx-xx」），一眼能看出这行有没有填批次，不用点开才知道。 -->
              <td v-if="isVisible('batch')" class="ipn-c-batch" :class="{ 'has-val': batchText(row), 'batch-open': batchOpen === row.uid }">
                <button type="button" class="ipn-batch-btn" :disabled="!row.product_id"
                        :title="batchText(row) || '点开填写批次号 / 到期日 / 生产日期（选填）'"
                        @click.stop="toggleBatch(row)">
                  <span class="ipn-batch-txt">{{ batchText(row) || (row.product_id ? '填写' : '') }}</span>
                  <span class="ipn-batch-caret"><Icon name="chevron-down" :size="12" /></span>
                </button>
                <div v-if="batchOpen === row.uid" class="ipn-batch-pop" @click.stop>
                  <label class="ipn-bp-row">
                    <span class="ipn-bp-lb">批次号</span>
                    <input v-model.trim="row.batch_no" v-focus class="input ipn-in" placeholder="如 20261101" />
                  </label>
                  <label class="ipn-bp-row">
                    <span class="ipn-bp-lb">到期日</span>
                    <input type="date" v-model="row.expiry_date" class="input ipn-in" />
                  </label>
                  <label class="ipn-bp-row">
                    <span class="ipn-bp-lb">生产日期</span>
                    <input type="date" v-model="row.production_date" class="input ipn-in" />
                  </label>
                  <p class="ipn-bp-tip">空着也能保存：系统会给这批自动编号，无到期日的批次在出库时排最后。</p>
                  <button type="button" class="ipn-bp-done" @click.stop="batchOpen = ''">完成</button>
                </div>
              </td>
              <td v-if="isVisible('note')" class="ipn-c-note" @click="cellOn(row, 'note')">
                <input v-if="isCellOn(row, 'note')" v-model.trim="row.note" v-focus maxlength="200"
                       class="input ipn-in" @blur="cellOff" @keydown.esc="cellOff" />
                <span v-else class="ipn-v" tabindex="0"
                      @keydown.enter.prevent="cellOn(row, 'note')">{{ row.note || '' }}</span>
              </td>
              <td class="ipn-c-op">
                <button class="btn-row-ic" title="在这一行下面插一行" @click="insertAfter(i)"><Icon name="plus" :size="14" /></button>
                <button class="btn-row-ic danger" title="删除这一行" @click="removeRow(i)"><Icon name="trash" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 列设置面板（共享组件 · 《进销存建单页开发规范》§4）。
           v442：原先是本页**内联**的 overlay + 面板 + 一份 scoped 的 `.col-menu*` 样式
           （40 行）。v432 起这套已上提为全站唯一实现（`styles/col-menu.css` + `ColMenuPanel.vue`
           + `useColSettings`）—— 那份全局 CSS 与本页原 scoped 版本**逐字节相同**，
           故收敛后视觉与交互零变化，只是不再留第二份拷贝。
           定位/限高由组件内部的 useColMenu 按齿轮 `getBoundingClientRect()` 现算。 -->
      <ColMenuPanel ref="panel" :col-list="DETAIL_COLS" :is-visible="isVisible"
                    :toggle-col="toggleCol" :reset-cols="resetCols" />
    </div>

    <!-- 底部动作条（对齐舟谱：合计在左、动作在右下）。
         🔴 sticky 贴住滚动容器底边；`margin-inline:-20px` 抵消 Shell 的 `.view-wrap{padding:20px}`
            ⇒ 动作条满宽。若那份 padding 改了，这里要跟着改（两处唯一的耦合点）。 -->
    <div class="ipn-bottom">
      <span class="ipn-total">合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
      <!-- v455：快捷键提示（复刻舟谱底部那行 Ctrl+S / Ctrl+Enter）。真快捷键，
           不是装饰 —— 见脚本层 onHotkey。 -->
      <span class="ipn-kbd-hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> 保存<em>·</em><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 保存并审核</span>
      <span v-if="totalAmount >= 5000" class="ipn-warn">
        金额较大时，保存后会先进入「待审批」，审批通过才能确认入库。
      </span>
      <div class="ipn-save">
        <!-- 保存 ▾ -->
        <div class="ipn-dd">
          <button class="btn btn-ghost btn-sm ipn-dd-main" :disabled="saving" @click="submit('save')">
            {{ saving ? '提交中…' : '保存' }}
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
            {{ saving ? '提交中…' : '保存并审核' }}
          </button>
          <button class="btn btn-primary btn-sm ipn-dd-caret" :disabled="saving"
                  title="更多审核方式" @click.stop="approveOpen = !approveOpen">
            <span class="ipn-caret" :class="{ up: approveOpen }"></span>
          </button>
          <div v-if="approveOpen" class="ipn-menu" @click.stop>
            <button class="ipn-mi" @click="submit('approve')">保存并审核</button>
            <button class="ipn-mi" @click="submit('approveNew')">审核并新增</button>
            <button class="ipn-mi" @click="submit('approvePrint')">审核并打印</button>
            <button class="ipn-mi" @click="submit('approveIssue')">审核并发单</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 采购订单建单内核 —— 数据源：`POST /api/psi/purchase-orders`（委派既有建单逻辑）。

   ── v449（2026-10-11）拆页面 ────────────────────────────────────────────────
   本文件原来是 `InvPurchaseNew.vue`，一个组件靠 `?kind=order|return` 承载**两种单据**
   （2191 行）。老板拍板「为每一种不同类型的单据分别建立独立的页面」⇒ 按
   「薄页面 + 配置化内核」拆开：
     · **订单**（本文件）：保留原来的全部能力（供应商组合框 / 经办人 / 部门 /
       附件暂存 / 自定义字段 / 库存两列 / 批次小面板 / 三档单位 / 双下拉保存）。
     · **退货** → `PurchaseReturnForm.vue`（不挂原单的新形态 + 保留 `?from_po=` 那条
       带可退上限的老通道）。
   🔴 拆分方式是**逐段搬移**（模板块 / 脚本段按原样剪过来），不是重写 —— 样式块、
      模板结构、脚本逻辑都**逐字节保留**，所以 §R 视觉基准零漂移。
   🔴 页面里**不出现**标题 / 仓库标签 / 价格列名 / 列表落点的字面量 —— 一律走
      `purchaseDocConfig()`（见 `docTypes.js`）。这些字面量原来散在模板与 `pageTitle`
      里，加一种单据就要改三处。
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../../components/Icon.vue'
import { psiApi } from '../../../api/psi'
import { toast } from '../../../store'
/* ⚠️ v449 拆页面后这里**不再**导入 `PO_STATUS` / `textOf` —— 它们只用于「原采购单」
   那一格里的状态文案（`poStatusText`），已随退货模式搬到 `PurchaseReturnForm.vue`。
   留着不删会变成"看起来还在用"的死导入。 */
import { PSI_NOTES, fmtMoney } from '../../../constants/psiLabels'
/* v415（P2-7）采购单自定义字段。定义与值读取抽在 composable 里（列表页 / 详情页共用），
   本页只用它的「定义」与「类型」两件事：按类型给文本框 / 数字框。 */
import { usePurchaseCustomFields } from '../../../composables/purchaseCustomFields.js'
import { useColSettings } from '../../../composables/useColSettings.js'
import ColMenuPanel from '../../../components/ColMenuPanel.vue'
/* v444：列宽拖动。与「列显隐」是**两件事**（宽度跟屏幕走、显隐跟租户走），
   故是独立 composable，理由见 `useColResize.js` 文件头。 */
import { useColResize } from '../../../composables/useColResize.js'
import ColResizeHandle from '../../../components/ColResizeHandle.vue'
/* v449：单据类型配置（标题 / 仓库标签 / 价格列名 / 列表落点）。**唯一来源** —— 页面里
   不再出现这些文案的第二份。 */
import { purchaseDocConfig, PURCHASE_DOC_TYPES } from './docTypes.js'
import SupplierCombo from './SupplierCombo.vue'

const router = useRouter()
const route = useRoute()

/* 单据类型：本内核当前只承载**采购订单**一种（采购退货单已独立成
   `PurchaseReturnForm.vue`）。`type` 仍做成 prop —— 与另外两个内核同形，
   将来真要再分类型只加配置、不动模板。 */
const props = defineProps({
  type: { type: String, default: PURCHASE_DOC_TYPES.PURCHASE_ORDER },
})
const cfg = computed(() => purchaseDocConfig(props.type))

const saving = ref(false)
const saveOpen = ref(false)
/* v417j 激活格（对照舟谱最终档）：**点哪格，哪格才是输入框**；其余格渲染成文本。
   🔴 为什么不用「整行激活」：整行切换会让鼠标扫过的行高忽高忽低（抖动），
      而舟谱实际也是**格级**激活。格级切换时行高恒定（文本行高），密度收益才拿得到。
   ⚠️ 已知边界：Tab 键顺序导航会退化（只有激活格是 input，Tab 出去即失焦退出编辑）。
      本页是鼠标为主的单据填报（老板场景），Enter/Esc 与点击均可进出编辑态。 */
const activeCell = ref('')
const cellKey = (row, f) => `${row.uid}:${f}`
const isCellOn = (row, f) => activeCell.value === cellKey(row, f)
function cellOn (row, f) {
  /* v455：激活「单位」格时先快照旧档位 —— 换档换算（onUnitChange）要拿它当旧值。
     这里是单位下拉出现的**唯一入口**，快照放这儿不会漏。 */
  if (f === 'unit') row._prevUnit = row.unit
  activeCell.value = cellKey(row, f)
}
function cellOff () { activeCell.value = '' }

/* 明细表「列设置」齿轮（《进销存建单页开发规范》§4）。
   把原「序号」表头格换成标准化的列设置齿轮；面板可勾选**可选列**的显隐，
   固定列（商品 / 单位 / 采购价 / 订单数量 / 订单金额 / 操作）恒定显示、不可关。
   v442：收敛到全站共享实现 —— `useColSettings`（列清单 + 可见性 + 云端持久化）
   ＋ `ColMenuPanel.vue`（面板 + 现算定位）＋ `styles/col-menu.css`（长相）。
   云端偏好键**仍是 `purchase-new`**（useColSettings 把它透传给 useColPrefs）
   ⇒ 用户已保存的列显隐设置原样保留，不会因为这次收敛被重置。
   收敛前本页自带一份 `useColMenu` + `useColPrefs` + colVis/isVisible 的手写实现，
   与本 composable 逻辑等价（逐行核对过）但**是第二份**。 */
const DETAIL_COLS = [
  { key: 'prod',  label: '商品',     core: true },
  { key: 'code',  label: '条码',     core: false },
  { key: 'unit',  label: '单位',     core: true },
  /* v455：列序对齐舟谱创建页 —— 舟谱是
       商品名称 | 条形码 | 单位 | 参考成本价 | 采购价 | 订单数量 | 订单金额 | 可用库存 | 实际库存 | 备注 | 操作
     原来把「可用/实际库存」插在单位与参考成本价之间（v408 加库存列时的位置），
     与舟谱逐列对不上。库存两列是**参考信息**（看还有多少货），放到金额之后更合读表逻辑：
     先看这行订了多少、多少钱，再看仓库还有多少。
     ⚠️ 只改顺序、不改 key ⇒ 用户已保存的列显隐 / 列宽偏好不受影响（按 key 存）。 */
  { key: 'ref',   label: '参考成本价', core: false },
  { key: 'price', label: '采购价',   core: true },
  { key: 'qty',   label: '订单数量', core: true },
  { key: 'amt',   label: '订单金额', core: true },
  { key: 'stk',   label: '可用库存', core: false },
  { key: 'stk2',  label: '实际库存', core: false },
  { key: 'batch', label: '批次信息', core: false },
  { key: 'note',  label: '行备注',   core: false },
  { key: 'op',    label: '操作',     core: true },
]
const { isVisible, toggleCol, resetCols } = useColSettings('purchase-new', DETAIL_COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

const { wStyle, startResize, resetColW } = useColResize('purchase-new', DETAIL_COLS)

/** 非激活态要显示商品名（不是 product_id）—— 从下拉的同一份清单取，避免另存一份名字导致两处不同步。 */
function prodName (row) {
  const p = prodOptions.value.find(x => Number(x.id) === Number(row.product_id))
  return p ? p.name : ''
}
// v417i：批次小面板当前打开在哪一行（存 uid；'' = 都没开）
const batchOpen = ref('')
/* v417j 激活格：元素一挂载就聚焦 —— 配合 v-if「点哪格哪格才变输入框」，
   省掉 nextTick + querySelector 那一套（那些写法会因为时序问题漏焦）。 */
const vFocus = { mounted: el => { try { el.focus() } catch (_) {} } }
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
/* 建单页的两种「非新建」入口 —— `?copy=` 复制、`?edit=` 编辑。
   🔴 v449 拆页面后本页**只承载采购订单**：原来的 `?kind=order|return` 那对
      `kind` / `isReturn` / `fromPoQ` 三个 computed 已随退货模式一起搬到
      `PurchaseReturnForm.vue`。
   🔴 仍然必须是 **computed + watch**（不能取一次性常量）：`/inventory/purchase/new`
      还是**同一条 path**，`?copy=1` ↔ `?copy=2` 切换时 vue-router 复用同一个组件实例
      ⇒ `onMounted` 不会再跑，页面会停在上一张单的数据上，而且**零报错**。 */
const copyId = computed(() => Number((route.query && route.query.copy) || 0) || 0)
/* P1-4：编辑一张已存采购单。`?edit=oid` 来自详情页的「编辑」按钮；只有状态 ∈ 可编辑三态
   （draft / pending_approval / cancelled）才允许编辑，其余状态在 `loadEdit` 里拦下并退回详情页。 */
const editId = computed(() => Number((route.query && route.query.edit) || 0) || 0)

const pageTitle = computed(() => editId.value ? cfg.value.editTitle
  : (copyId.value ? cfg.value.copyTitle : cfg.value.title))
/* 🔴 v459：原副标题（sub/copySub/editSub）已从 docTypes 移除，pageSub 计算属性随之删除（避免死代码）。 */

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

const prodOptions = computed(() => products.value)
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
/* v449：原来这里的守卫是 `if (isReturn.value) return`（退货模式下不查供应商余额）。
   退货模式已整体搬到 `PurchaseReturnForm.vue` ⇒ 本内核恒为采购订单，守卫是死代码；
   且 `isReturn` 这个 computed 已随之删除，留着会抛 ReferenceError。 */
watch(() => form.value.supplier_id, (v) => { loadSupplierBalance(v) })

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

/** v417i：批次格常显摘要 —— 有批次号显示批次号，否则显示到期日，都没有则空（由调用方显示「填写」）。
    🔴 不这么做：三字段收进面板后，用户在表格上**看不出这行填没填批次**，必须逐行点开才知道 ——
       这正是「把信息藏起来换密度」最常见的代价，故摘要必须常显。 */
function batchText (row) {
  if (row.batch_no) return row.batch_no
  if (row.expiry_date) return `到期 ${row.expiry_date}`
  return ''
}

function toggleBatch (row) {
  batchOpen.value = batchOpen.value === row.uid ? '' : row.uid
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

/* ══ v455：采购价单位窗口（老板口径 2026-10-13）══════════════════════════════════
   「进货是按大单位进货，默认采购价格是大单位，但要给用户自己选择的窗口。」
   落地成两件东西：
     ① **总闸**：表格工具栏「按小单位采购」开关（复刻舟谱同款）—— 默认关 = 按大单位；
     ② **细调**：每行单位下拉（v409 就有的三档），关掉总闸也能逐行改。
   两处都走同一个 `switchRowUnit`，换算规则只有一份。                                            */

/** 「按小单位采购」总闸。默认关（大单位）；偏好存 localStorage —— 老板天天开单，
    每次重选一遍是纯浪费。读失败（隐私模式等）退回 false，不报错。 */
const smallUnitMode = ref((() => {
  try { return localStorage.getItem('ipn_small_unit_mode') === '1' } catch (_) { return false }
})())

/** 某一行的**默认档名**：总闸开着 ⇒ 小档；否则 ⇒ 现有最大档（`unit_options` 按 小→中→大 排）。
    🔴 取「最后一个」而不是找 `key==='large'`：两级商品（没有大档）必须落到中档或小档，
       写死 large 会让这些商品拿到空单位名。 */
function defaultUnitOf (row) {
  const opts = unitOptionsOf(row)
  if (!opts.length) return ''
  return smallUnitMode.value ? opts[0].name : opts[opts.length - 1].name
}

/** 把行单位换成 `newName`，并**按比例换算已填的采购价与数量**。
    🔴 为什么必须换算（这是本函数存在的全部理由）：金额 = 价 × 数量。
       只换单位不换数，「10 箱 × 100 元/箱」点成「组」会静默变成「10 组 × 100 元/组」——
       金额数字不变、货少了 12 倍，后端折小单位数量也跟着少记（真金白银，且零报错）。
    🔴 方向（v455 探针实测抓到我第一版写反了，特此算式化，别再凭直觉改）：
        1 旧档 = old_ratio 个小单位，1 新档 = new_ratio 个小单位
        ⇒ 1 旧档 = (old_ratio / new_ratio) 个新档
        ⇒ **价**（元/档）×(new_ratio / old_ratio)；**量**×(old_ratio / new_ratio)
        验算：100 元/箱（1箱=12组）→ 组：价 100×1/12 = 8.3333，量 10×12 = 120 ✅
    🔴 精度（v455 探针实测：价若 rounding 到 2 位，100÷12=8.33、×120=999.60，
       切回箱又变 99.96 —— 来回切一次丢 4 分，是个**鼠牙**）⇒ 价保留 **4 位**、
       量保留 **4 位**。金额列仍按 2 位显示（8.3333×120=999.996 → ¥1,000.00），
       所以「屏幕上看到的金额」在换档前后不变，往返也不漂。
    🔴 换算比一律用后端下发的 `ratio`（小→该档），本函数不出现第二种换算算法。
    🔴 算不出比（档位缺失 / ratio≤0）⇒ **只换单位、不换算**，交给用户自己看；
       绝不猜一个 1 顶上去（猜 1 = 把一箱当成一个）。 */
function switchRowUnit (row, newName) {
  const oldName = row.unit
  row.unit = newName || ''
  row._prevUnit = row.unit
  if (!oldName || !newName || oldName === newName) return
  const o = unitOptionsOf(row).find(x => x.name === oldName)
  const n = unitOptionsOf(row).find(x => x.name === newName)
  if (!o || !n || !(Number(o.ratio) > 0) || !(Number(n.ratio) > 0)) return
  const k = Number(n.ratio) / Number(o.ratio)          // 价 × k、量 ÷ k ⇒ 金额与折小量都不变
  const p = Number(row.unit_price || 0)
  if (p > 0) row.unit_price = String(Math.round(p * k * 10000) / 10000)
  const q = Number(row.quantity || 0)
  if (q > 0) row.quantity = String(Math.round(q / k * 10000) / 10000)
}

/** 行内单位下拉的 @change。
    🔴 旧档位取 `row._prevUnit`（`cellOn(row,'unit')` 时快照的），**不读 `row.unit`：
       `<select>` 上 v-model 与 @change 同时监听 change，两者触发顺序不写在任何规范里，
       读 row.unit 有半开概率拿到「已经是新值」—— 那这次换算就静默失效（正是要防的那类 bug）。
    🔴 必须操作 **row 本体**：`{...row}` 副本上的赋值不会写回响应式行（v455 初版犯过，
       症状是下拉变了、价量没换算，而且不报错）。 */
function onUnitChange (row, ev) {
  const want = String((ev && ev.target && ev.target.value) || '')
  if (!want) return
  row.unit = row._prevUnit || row.unit   // 先还原旧档，switchRowUnit 才能按「旧→新」换算
  switchRowUnit(row, want)
}

/** 总闸切换：全表所有**已选商品**的行一次切到目标档（空行不带单位，跳过）。
    🔴 走 `switchRowUnit` ⇒ 每行已填的价 / 量按各自的比例换算，金额与折小数量保持不变。
    🔴 行内若有人为某行单独选过档，这一下会把它也带过来 —— 舟谱的总闸同样是全表生效，
       这是「开关」该有的语义；要保留个别行就切完总闸再去行内改回来。 */
function applyUnitMode () {
  const want = smallUnitMode.value ? 'small' : 'large'
  for (const row of items.value) {
    if (!row.product_id) continue
    const opts = unitOptionsOf(row)
    if (!opts.length) continue
    const target = want === 'small' ? opts[0].name : opts[opts.length - 1].name
    if (row.unit === target) continue
    switchRowUnit(row, target)
  }
}
/** 总闸的 @change：落盘偏好 + 全表换算。 */
function onSmallUnitMode () {
  try { localStorage.setItem('ipn_small_unit_mode', smallUnitMode.value ? '1' : '0') } catch (_) {}
  applyUnitMode()
}

/** 参考成本价按**本行所选档位**折算后显示。
    🔴 口径（老板 2026-10-13）：档案里的采购价按**大单位**理解（默认按大单位进货）。
       行内换成小档时这一列必须一起折算 —— 否则「参考成本价 ¥86/箱」摆在
       「采购价 __ 元/组」旁边，两个数差 12 倍，根本没法对照着填。
    🔴 方向（与 switchRowUnit 同一条算式，别各写一份）：
        档案价是「元/大单位」，当前档是「元/ratio 个小单位」
        ⇒ 显示价 = 档案价 × (当前档 ratio / 大档 ratio)
        验算：7.22 元/箱（1箱=12组）→ 组：7.22×1/12 = 0.60 元/组 ✅
        （v455 探针实测：我第一版写成 ×大/当前，算出 86.67 —— 大了 144 倍。）
    🔴 没有大档的商品**不折算**（档案价是哪个单位的无从判断 ⇒ 不猜，本仓铁律：缺值不编）。
    🔴 这与 `onPick` 的预填同源：预填值就是折算后的档案价，两者必须永远同一个单位。 */
function refPriceOf (row) {
  const p = Number(row.purchase_price || 0)
  if (!p) return 0
  const big = unitOptionsOf(row).find(o => o.key === 'large')
  if (!big) return p
  const r = ratioOf(row)
  if (!(r > 0) || r === Number(big.ratio)) return p
  return Math.round(p * r / Number(big.ratio) * 100) / 100
}
/** 折算提示：只在**真的折算过**时出现，写清档案原价和它的单位 —— 可审计，不是静默改数。 */
function refConvText (row) {
  const p = Number(row.purchase_price || 0)
  const big = unitOptionsOf(row).find(o => o.key === 'large')
  if (!p || !big) return ''
  const r = ratioOf(row)
  if (!(r > 0) || r === Number(big.ratio)) return ''
  return `档案价 ¥${fmtMoney(p)}/${big.name}`
}

/** v444：建单页明细表的**出厂预设空行数**。规范 §4.1 —— 两页（采购 / 销售）必须同值。 */
const PRESET_ROWS = 15

function blankRow () {
  return {
    uid: ++_uid, product_id: 0, quantity: '', unit: '',
    // v455：`_prevUnit` = 打开单位下拉时的旧档位。换档位要**按比例换算已填的价/量**
    //   （否则金额不变、货少一个量级），而 `<select>` 的 change 事件里只能读到新值，
    //   旧值必须在这里先存一份。不参与提交。
    _prevUnit: '',
    unit_price: '', barcode: '', purchase_price: 0,
    // v430：商品组合框 per-row 临时状态（不参与提交；输入框词 / 下拉开关 / 高亮项）
    _pkw: '', _popen: false, _pactive: 0,
    batch_no: '', expiry_date: '', production_date: '',
    // v408（P1-2）行备注。**刻意不参与 `validate()`**：它是选填，且后端是
    // 「空则不加列」⇒ 不填时 SQL 与改动前逐字一致。
    note: '',
    // v409（P1-2→P2-1）三档单位：档位清单 / 换算文案 / 档案小单位名，都由后端随商品下发。
    unitOptions: [], convText: '', baseUnit: '',
  }
}
function addRow () { items.value.push(blankRow()) }
function insertAfter (i) {
  const r = blankRow()
  items.value.splice(i + 1, 0, r)
  // v430：新增行后把新行滚入可见区 —— 否则底部 sticky 的「合计」条会盖住刚加的那一行
  //   （插入后浏览器不自动滚动，新行落在被合计条遮住的底部视口带里）。
  scrollRowIntoView(r.uid)
}
function removeRow (i) { items.value.splice(i, 1) }

// 把指定 uid 的明细行滚入视口（贴着底部 sticky 合计条上方留白处，不被它盖住）。
function scrollRowIntoView (uid) {
  nextTick(() => {
    const el = document.querySelector(`.ipn-tbl tbody tr[data-uid="${uid}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

/** 从商品档案带出单位 / 条码 / 参考成本价（价格可改）。
    v409（P2-1）单位改成**三档可选**（小 / 中 / 大），档位清单由后端 `unit_options` 下发。
    v455（老板口径 2026-10-13）：默认档从「`order_unit` 命中档 / 小档」改为
      · 「按小单位采购」开关**开着** ⇒ 小档；
      · 否则 ⇒ **现有最大档**（没有大档就取中档，再没有就只有小档）。
      🔴 为什么改：老板原话「进货是按大单位进货，默认采购价格是大单位」。
         旧默认（order_unit / 小档）与档案价（大单位价）**差一整个量级** ——
         预填的采购价会被读成「一箱 86 元」而实际是「一组 7.2 元」这类错。
      ⚠️ 已有单位（复制旧单 / 编辑）且在档位里 ⇒ **保留**，不要被默认值顶掉。 */
function applyProduct (row) {
  const p = products.value.find(x => x.id === row.product_id)
  if (!p) {
    row.barcode = ''; row.purchase_price = 0
    row.unitOptions = []; row.convText = ''; row.baseUnit = ''; row.unit = ''
    row._prevUnit = ''
    return
  }
  row.unitOptions = Array.isArray(p.unit_options) ? p.unit_options : []
  row.convText = String(p.conv_text || '')
  row.baseUnit = String(p.unit || '')
  // 已有单位（复制旧单 / 编辑）且在档位里 ⇒ **保留**，不要被档案默认值顶掉。
  const keep = row.unit && row.unitOptions.some(o => o.name === row.unit)
  if (!keep) row.unit = defaultUnitOf(row)
  row._prevUnit = row.unit
  row.barcode = String(p.barcode || '')
  row.purchase_price = Number(p.purchase_price || 0)
}
function onPick (row) {
  applyProduct(row)
  /* v455：预填值走 `refPriceOf`（按本行当前档位折算），不再直接取档案原价。
     🔴 为什么：总闸「按小单位采购」开着时默认档是小档，此时把**大单位**的档案价
        原样填进小档的采购价框，一上来就差一整个量级（老板会被这个预填带偏）。
        走 refPriceOf 后，预填值与「参考成本价」列永远是同一个单位、同一个数。 */
  if (!row.unit_price && row.purchase_price > 0) row.unit_price = String(refPriceOf(row))
}

/* v430：商品「名称 + 条码」模糊查找组合框（行内 per-row 临时状态，避免多行实例互相串）。
   🔴 与供应商组合框同一范式：本地 includes 匹配（商品全量由 loadRefs 拉全）、键盘 ↑/↓/Enter/Esc、
      li 用 mousedown.prevent 防 input blur 掉下拉。
   🔴 选中后走既有 onPick(row) —— 单位 / 条码 / 采购价等完整信息由 applyProduct 一次性带出，
      与改前「选 <select> 选项触发 @change=onPick」行为完全一致。 */
function openProd (row) {
  cellOn(row, 'prod')
  row._pkw = prodName(row) || ''   // 已选商品 ⇒ 默认词即其名（便于继续搜）；空行 ⇒ 空，列全部
  row._popen = true
  row._pactive = 0
}
function onProdKw (row, e) { row._pkw = e.target.value; row._pactive = 0; row._popen = true }
function prodMatches (row) {
  const q = (row._pkw || '').trim().toLowerCase()
  const list = products.value
  if (!q) return list.slice(0, 50)
  // 包含式模糊匹配：名称或条码任一含关键词即命中
  return list.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.barcode || '').toLowerCase().includes(q)
  ).slice(0, 50)
}
function pkMove (row, d) {
  const m = prodMatches(row); const n = m.length
  if (!n) return
  let i = row._pactive + d
  if (i < 0) i = n - 1
  if (i >= n) i = 0
  row._pactive = i
}
function pkChoose (row, p) {
  if (!p) return
  row.product_id = p.id
  onPick(row)              // 带出单位/条码/采购价等完整信息
  row._pkw = ''
  row._popen = false
  cellOff()
}
function pkEnter (row) {
  const m = prodMatches(row)
  if (m.length) pkChoose(row, m[row._pactive] || m[0])
}
function pkBlur (row) { row._popen = false; cellOff() }

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
    // v428：组合框输入框文字由 SupplierCombo 的 watch(modelValue) 自动回填成已选供应商名
    //        （suppliers 已在 reinit 里 loadRefs 拉全）；这里只设 supplier_id 即可。
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
    // v428：组合框输入框文字由 SupplierCombo 的 watch(modelValue) 自动回填成已选供应商名
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

/* v417h：**哪些行算明细**的唯一判据 —— 选了商品的行才算（预设/手动加的空行不算）。
   🔴 为什么要单独抽一个函数：有了预设空行后，「校验哪些行」和「提交哪些行」必须同源。
      两处各写一份过滤 ⇒ 改一处漏一处：要么用户被要求填满 15 行才能保存，
      要么 15 条空明细落库（后端不拦空行）。校验与提交都调它。 */
function pickedRows () {
  const out = []
  items.value.forEach((r, i) => { if (Number(r.product_id) > 0) out.push({ r, idx: i + 1 }) })
  return out
}

function validate () {
  if (!form.value.supplier_id) return '请先选择供应商'
  if (!form.value.warehouse_id) return '请选择入库仓库'
  if (form.value.order_date && !DATE_RE.test(form.value.order_date)) return '单据日期格式不正确，请用日期选择器选'
  // v439：本页已撤掉「预计到货日期」输入框 ⇒ 这里只拦**原单据带来的坏值**
  // （不能再说「请用日期选择器选」，本页已经没有任何选择器可点）。
  if (form.value.expected_date && !DATE_RE.test(form.value.expected_date)) return '预计到货日期格式不正确（该值来自原单据）'
  // v417h：预设空行不参与校验（否则用户必须填满 15 行才能保存）。
  //   但「填了数量/价格却没选商品」是半截操作 ⇒ 明确报错，不静默丢弃。
  for (let i = 0; i < items.value.length; i++) {
    const r = items.value[i]
    if (Number(r.product_id) > 0) continue
    if (Number(r.quantity) > 0 || (r.unit_price !== '' && r.unit_price != null)) {
      return `第 ${i + 1} 行：填了数量或采购价，但还没选商品`
    }
  }
  const picked = pickedRows()
  if (!picked.length) return '请至少选一行商品明细：选商品、填数量与采购价'
  for (const { r, idx } of picked) {
    const at = `第 ${idx} 行`
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

/* ══ v438 附件（建单页）══════════════════════════════════════════════════════
   🔴 为什么是「先暂存、保存后上传」而不是选完即传：
      附件接口是 `/api/psi/purchase-orders/{id}/attachments`，**要单据 id**；而本页在
      点保存之前**没有 id**（id 由 `createPurchase` 生成）⇒ 选完无处可挂。
      所以：选中 → 先列在本页（`stagedFiles`）→ 保存拿到 `oid` → 逐个上传。
   🔴 **不假装已上传**：文案如实写「保存后随单上传」；不保存就离开 ⇒ 这几个文件丢弃
      （暂存是本页内存态，不是服务端草稿）。
   🔴 上传失败**不回滚单据**：单据是主体、附件是附属，不能因为一张图失败就把建好的单撤了；
      改为把失败的文件留在列表里如实报出来（后端同名会拒绝，这类原因必须让用户看到）。
   ══════════════════════════════════════════════════════════════════════════ */
const ATT_MAX_MB = 20          // 与后端同口径（详情页由服务端下发 max_mb，这里用默认值兜底）
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

/** 保存拿到 id 后把暂存文件逐个上传。**自己吞异常**（不能连累外层 try：单据已经建好了）。
 *  @returns {{ok:number, fail:string[]}} 失败的留在 `stagedFiles` 里供用户看见。 */
async function uploadStaged (oid) {
  if (!oid || !stagedFiles.value.length) return { ok: 0, fail: [] }
  let ok = 0
  const fail = []
  const left = []
  for (const s of stagedFiles.value) {
    try {
      const b64 = await readFileAsBase64(s.file)
      await psiApi.uploadPurchaseAttachment(oid, s.name, b64)
      ok++
    } catch (e) {
      fail.push(`${s.name}（${e.message || '上传失败'}）`)
      left.push(s)
    }
  }
  stagedFiles.value = left
  return { ok, fail }
}

function resetForNext () {
  const keep = { supplier_id: form.value.supplier_id, warehouse_id: form.value.warehouse_id,
    // v439：`expected_date` 不再随单继承 —— 它已没有编辑入口，继承 = 悄悄把上一张的
    // 到货日期塞进新单（静默错值，比留空危险）。留空。
    order_date: form.value.order_date, expected_date: '', note: '',
    // v408（P0-5）：连着建几张单，经办人 / 部门通常不变 ⇒ 保留（与供应商、仓库同理）
    handler: form.value.handler, department_id: form.value.department_id }
  form.value = keep
  items.value = [blankRow()]
  // v415：自定义字段是**这一张单**的信息（如厂家结算单号）⇒ 连开下一张时清空，
  // 不沿用 —— 沿用会让新单继承上一单的事实，比留空更危险。
  extra.value = {}
  // v438：暂存附件同理 —— 它属于**刚保存的那张单**。留着会让下一张单"继承"上一张的
  // 附件（静默挂错单，比丢失更难发现）。失败的几个已在保存时用 toast 报过，这里如实清掉。
  stagedFiles.value = []
  attMsg.value = ''
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
      // v417h：只提交选了商品的行（预设空行不落库）—— 与 validate 同源，都走 pickedRows()
      items: pickedRows().map(({ r }) => ({
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

    /* v438：单据已落库、`oid` 到手 ⇒ 把暂存的附件随单上传。
       🔴 放在「保存成功」之后、「跳转」之前：只有单据真的建成了才有 id 可挂。
       🔴 `uploadStaged` 自己吞异常 ⇒ 上传失败**不会**走到下面的 catch 去报「保存失败」
          （那会把已经建好的单说成没建成，是谎报）。 */
    const attRes = await uploadStaged(oid)

    if (isApprove) {
      if (editId.value) {
        /* 编辑态：走「更新 + 同一个审核原语」（update 不支持直接 confirmed），
           先把单推到已审核，与新建态一致的业务语义；失败如实报出来。 */
        let note = ''
        try {
          const b = await psiApi.batchPurchases('approve', [oid])
          const f = (b.results || []).find(x => !x.ok)
          if (b.ok_count) note = '，已审核'
          else note = `，但审核未成功：${(f && f.reason) || '未说明原因'}`
        } catch (e) {
          note = `，但审核未成功：${e.message || '接口报错'}`
        }
        // v481（P2-②）：编辑态「审核并发单」—— 先审过（上一步已 confirmed），再发单给供应商。
        let issueNote = ''
        if (isIssue) {
          try {
            const ir = await psiApi.issuePurchase(oid)
            issueNote = (ir && ir.ok) ? '，已发单' : `，但发单未成功：${(ir && ir.reason) || '未说明原因'}`
          } catch (e) {
            issueNote = `，但发单未成功：${e.message || '接口报错'}`
          }
        }
        toast(`采购单已保存（${no}）${note}${issueNote}`,
              (note.includes('未成功') || issueNote.includes('未成功')) ? 'warn' : 'success')
      } else {
        // v417（B 语义）：新建/复制态已在 body 里带 `status='confirmed'` 一步建为已审核，
        // 自己保存自己审核，无需二次调审核接口。v481：此刻单已是 confirmed，直接发单。
        let tail = '，待入库'   // 新建/复制态默认「待入库」
        if (isIssue && oid) {
          try {
            const ir = await psiApi.issuePurchase(oid)
            tail = (ir && ir.ok) ? '，已发单' : `，但发单未成功：${(ir && ir.reason) || '未说明原因'}`
          } catch (e) {
            tail = `，但发单未成功：${e.message || '接口报错'}`
          }
        }
        toast(`采购单已保存并审核（${no}）${tail}`, 'success')
      }
    } else if (isPrint) {
      /* v412（P2-5）：打印对话框由详情页在数据就位后拉起 —— 这里先说清"接下来会发生什么"，
         否则用户会盯着这张还在编辑态的表单猜「打印怎么还没出来」。 */
      toast(`采购单已保存（${no}），正在打开打印`, 'success')
    } else {
      toast(`采购单已保存（${no}）`, 'success')
    }

    /* v438：附件上传结果**单独报**（不并入上面那句「已保存」）——
       单据成功与附件失败是两件事，混成一句会让失败被"已保存"盖过去。 */
    if (attRes.fail.length) {
      toast(`${attRes.fail.length} 个附件上传失败：${attRes.fail.join('；')}`, 'warn')
    } else if (attRes.ok) {
      toast(`已上传 ${attRes.ok} 个附件`, 'success')
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

/** 基础资料是否已就绪（同一实例在 `?copy=` / `?edit=` 之间切换时不重复拉 500 条下拉数据）。 */
const refsOk = ref(false)

function back () { router.push('/inventory/purchase') }
function onDocClick () { saveOpen.value = false; approveOpen.value = false; batchOpen.value = '' }

/** 基础资料（供应商 / 商品 / 仓库 / 部门 / 主库账号）。

    🔴 `kind` 只取本页真正要用的几类：拉 customers 会连 702 个客户的资料一起解密返回，
       开采购单根本用不到（少一次无谓的 PII 出库）。
       v408 追加 `departments`（部门下拉）与 `users`（经办人下拉）。
    ⚠️ `users` 主库读不到时后端**不返回该键** ⇒ 判存在；不拿员工档案顶替（见 refs 注释）。
    ⚠️ v449 起本页**只有订单模式**，「退货不需要这些下拉 ⇒ 不在那条路径上调它」那条
       省流量的考量随之失效（退货已独立成 `PurchaseReturnForm.vue`）。
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

/** 按当前 URL（`copy` / `edit`）把页面重置到对应「来源」。

    🔴 v449 拆页面后这里**不再分模式**（订单 / 退货已是两条路由、两个组件），
       但**仍必须是可重入**的：`/inventory/purchase/new` 还是同一条 path，
       `?copy=1` ↔ `?edit=2` 互换时 vue-router 复用同一个实例 ⇒ 只写一个
       `onMounted` 的话页面会停在上一张单的数据上，而且**零报错**。
    🔴 每次重入都清空明细与自定义字段：不清就会出现「复制出来的页面上挂着上一张单的明细」。
*/
async function reinit () {
  saveOpen.value = false
  items.value = []
  extra.value = {}          // v415：切模式 / 换单 ⇒ 自定义字段的清空（不留上一单的值）
  supBal.value = null       // P1-1：切模式 / 换单 ⇒ 供应商余额复位（重新选供应商会再拉）
  if (!refsOk.value) await loadRefs()
  if (editId.value) await loadEdit(editId.value)
  else if (copyId.value) await loadCopy(copyId.value)
  // v417h：预设 15 行（原 5 行、v417h 改 10 行）—— 舟谱同屏 14 行的观感；配合行高
  //       33→约 27px，单屏可见行数 5 → 约 15 行。空行不落库（submit 前会过滤掉没选商品的行）。
  // v444：数字收进 `PRESET_ROWS` 常量 —— 规范 §4.1 要求**建单页出厂一律 15 行**，
  //       两页同值。散着写必然出现「改一页忘另一页」，而这类偏差肉眼很难发现。
  else for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
}

/* v455：快捷键（复刻舟谱：Ctrl+S 保存 / Ctrl+Enter 保存并审核）。
   🔴 必须 `preventDefault()`：不拦的话 Ctrl+S 会弹出浏览器「存储此网页」对话框，
      用户看到的是"没反应"（其实浏览器弹了自己的一套）。
   🔴 Ctrl 与 Meta（macOS ⌘）都认 —— 老板用 Mac，⌘+S 是肌肉记忆。
   🔴 `saving` 期间不再触发：重复提交会建出两张单（后端没有幂等键）。 */
function onHotkey (e) {
  if (!(e.ctrlKey || e.metaKey)) return
  const k = String(e.key || '').toLowerCase()
  if (k === 's') {
    e.preventDefault()
    if (!saving.value) submit('save')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (!saving.value) submit('approve')
  }
}

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onHotkey)
  await reinit()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onHotkey)
})
/* 🔴 只监听 `copyId`：`?kind=` / `?from_po=` 现在是**另一条路由**（`PurchaseReturnForm`
   那条），不会再在同一条 path 上变化 ⇒ 监听它们已无意义（v449 拆页面时移除）。 */
watch([copyId], () => { reinit() })
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
/* v455：必填项图例（复刻舟谱创建页右上角那枚）。钉在标题右侧，
   让表单头 / 明细表里散落的红 `*` 有一个统一的解释处。 */
.ipn-legend {
  display: inline-flex; align-items: center; gap: 3px;
  margin-left: 10px; padding: 2px 8px;
  border: 1px solid var(--border-subtle); border-radius: 999px;
  background: var(--bg2, #f7f8fa);
  font-size: 12px; color: var(--t2); vertical-align: middle;
  transform: translateY(1px);
}
.ipn-legend .ipn-req { font-size: 12px; margin-right: 0 }

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
/* v415（P2-7）自定义字段的输入框：固定宽度（字段名 ≤12 字 + 值 ≤200 字，160px 够看一屏），
   不跟着 `.ipn-f-grow` 撑满 —— 它们是一组等宽的短字段，不是主字段。 */
.ipn-cf-in { width: 160px; height: 32px }
/* 退货模式「原采购单」搜索框 + 下拉：仍是两框并列（与采购单供应商组合框不同，这里保留旧式）。
   v428 把采购单的供应商选择改成了组合框，但原采购单选择器不动。 */
.ipn-sup-pick { display: flex; gap: 6px }
/* v428：供应商组合框样式已抽到 SupplierCombo.vue（与采购退货单页共用，单一来源）。
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
/* v455：「按小单位采购」总闸（复刻舟谱表格工具栏同款开关）。
   🔴 用**原生 checkbox** 而不是自绘开关：设置页 / 权限页全是原生勾选框，
      同页两套开关长相等于让用户学两次。`accent-color` 让它跟主题色走，
      不用写一行 transform 动画。 */
.ipn-unitsw {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--t2); cursor: pointer; user-select: none;
  white-space: nowrap;
}
.ipn-unitsw input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--p, #1677ff) }
.ipn-unitsw:hover { color: var(--t1) }
.ipn-unitsw.on { color: var(--t1) }
.ipn-unitsw.on .ipn-unitsw-tx { font-weight: 500 }
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
table.ipn-tbl td.seq-cell { padding: 2px 4px }
.ipn-c-stk { width: 78px; font-variant-numeric: tabular-nums; white-space: nowrap }
/* 「实际有货、一件都不可售（全过期）」——必须扎眼，否则用户以为有货能卖 */
.ipn-c-stk .danger { color: var(--danger-txt) }
.ipn-c-prod { min-width: 240px }
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
/* v460：批次格下拉箭头默认隐藏，hover / 聚焦 / 面板打开时显示（仅隐藏默认态，toggleBatch 交互逻辑不变） */
.ipn-batch-caret { display: none; flex: none; color: var(--t3) }
.ipn-batch-btn:not(:disabled):hover .ipn-batch-caret,
.ipn-c-batch:focus-within .ipn-batch-caret,
.ipn-c-batch.batch-open .ipn-batch-caret { display: inline-flex }
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
/* v455：底部快捷键提示（复刻舟谱那行 Ctrl+S / Ctrl+Enter）。弱一档字色 ——
   它是「说明」，不是主操作；真快捷键见脚本层 onHotkey。 */
.ipn-kbd-hint { font-size: 12px; color: var(--t3); white-space: nowrap }
.ipn-kbd-hint kbd {
  display: inline-block; padding: 1px 5px;
  border: 1px solid var(--border-subtle); border-radius: 4px;
  background: var(--bg2, #f7f8fa);
  font-family: inherit; font-size: 11px; line-height: 1.5; color: var(--t2);
}
.ipn-kbd-hint em { margin: 0 6px; font-style: normal; color: var(--t3) }
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
</style>
