<template>
  <div class="inv-page">
    <!-- v501：页头（`.page-hd` = 大标题 + 副标题 + 新建/刷新）**整块退役**，与采购 /
         调拨两页同口径 —— 页面身份收归顶部标签栏（v501 已补 `tabTitles` 按
         `type`+`kind` 取标题，否则本页四个入口的标签会**全部同名**叫「销售单」）。
         「新建 / 刷新」下移到下方状态页签行右侧（`#actions` 插槽），不再是独立一行。 -->

    <!-- 筛选：常用项一行 + 「更多选项」展开（对齐采购单列表的筛选形态）。
         为什么要把「出货方式 / 客户」收进折叠里：本页有 5 个筛选项挤在同一行，
         小屏会折成三行、把列表推到屏幕外。高频的只有「状态 + 下单日期」。 -->
    <div class="card isl-filter">
      <div class="psi-frow">
        <!-- v498：「状态**下拉**」删除 —— 改由筛选区下方的**状态页签**承载（共享件
             StatusTabs，与采购 / 调拨两页同款）。同一个"按状态分类"的诉求，下拉与页签
             两套形态并存，在用户视角就是缺陷；页签还多了各档计数。
             ⚠️ 下拉删除后 `SO_OPTIONS` 一并移除（不再有任何引用）。 -->
        <div class="psi-f">
          <label class="psi-lb">下单起</label>
          <input type="date" v-model="f.date_from" class="input psi-date" @change="onDateManual" />
        </div>
        <div class="psi-f">
          <label class="psi-lb">下单止</label>
          <input type="date" v-model="f.date_to" class="input psi-date" @change="onDateManual" />
        </div>
        <!-- v496：快捷时间档（规范 §3.3）—— 五枚 chip 与采购/调拨列表同源；
             手动改上面两个日期框会经 onDateManual 清掉芯片高亮。 -->
        <QuickRangeChips :range="quickRange" @pick="pickRange" />
        <div class="psi-fbtns">
          <button class="btn btn-primary btn-sm" :disabled="loading" @click="load()">
            <Icon name="search" :size="14" />查询
          </button>
          <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
          <button class="btn btn-ghost btn-sm" :class="{ on: more }" @click="more = !more">
            更多选项<span class="psi-caret" :class="{ up: more }"></span>
          </button>
        </div>
      </div>

      <div v-if="more" class="psi-frow psi-frow-sub">
        <div class="psi-f">
          <label class="psi-lb">出货方式</label>
          <select v-model="f.order_type" class="input psi-sel" @change="load()">
            <option v-for="o in ORDER_TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="psi-f">
          <label class="psi-lb">客户</label>
          <select v-model.number="f.customer_id" class="input psi-sel" @change="load()">
            <option :value="0">全部客户</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <!-- 🔴 这里**没有**「业务员」筛选，不是漏了：后端 `list_sale` 的 B1 数据隔离对
             `role=='sales'` 会**强制**把 `operator_id` 覆盖成本人（见 `routers/sales.py`）。
             放一个对销售员永远不生效的下拉框，就是造「选了没反应、零报错」的假控件
             —— 正是本仓反复付学费的那类。要加必须先解掉「销售员能不能看同事的单」这个业务问题。 -->
      </div>
    </div>

    <!-- v498：状态页签（共享件 StatusTabs，与采购 / 调拨两页同一条）。
         计数来自服务端 `counts`（后端 `sale_order_list` v498 起返回）：忽略 status 筛选、
         保留其余筛选（含订单入口的 `exclude_status='returned'`）⇒ 切页签数字不漂移。 -->
    <StatusTabs :tabs="tabs" :model-value="f.status" @pick="pickTab">
      <!-- v510：动作组收进页签行右侧（共享件 PsiListActions），顺序 导出 → 批量操作 → 新建 → 刷新。
           v532：销售单后端批量端点 `POST /api/psi/sale-orders/batch` 已交付并部署
           （出货 / 签收 / 取消 / 驳回四op）⇒ showBatch 开起来，菜单项由本页 BATCH_ACTIONS 给。
           🔴 **退单视图（kind=return）不开批量**：它查的是真退货表 `return_orders`，
              行 id 与 `sale_orders.id` 是**两套编号空间**，把退货行 id 交给销售单批量端点
              会打到不相干的销售单上（零报错的越界 —— 与 v500 单号链接同一个坑）。
              等后端给出退货单批量端点再开。排序提示经 #status 插槽保留在左侧。 -->
      <template #actions>
        <PsiListActions
          :export-disabled="!rows.length"
          :show-batch="!_kindReturn"
          :batch-items="BATCH_ACTIONS"
          :batch-open="batchOpen"
          :batch-disabled="!canUpdate || busyBatch"
          :show-new="canWrite"
          :new-disabled="!canWrite"
          :new-label="'新建' + title"
          :refresh-disabled="loading"
          @export="doExport"
          @toggle-batch="toggleBatch"
          @batch-pick="pickBatch"
          @new="() => go(newTo)"
          @refresh="load">
          <template #status>
            <!-- v473：排序显式提示（列被隐藏时表头指示器消失，顺序来历变看不见的状态） -->
            <span v-if="sortKey" class="psi-selinfo psi-sortinfo">
              按<b>{{ sortLabel }}</b>{{ sortDir === 'asc' ? '升序' : '降序' }}
              <button class="isl-link" @click="clearSort">清除</button>
            </span>
          </template>
        </PsiListActions>
      </template>
    </StatusTabs>

    <!-- v532：批量结果（逐单回报：失败必须带原因，否则用户无法据此行动）。
         失败行显示**单号**而不是裸 id —— 老板要拿着它去开那张单处理。
         样式走共享 `.psi-bres*`（psi-list.css，三页唯一出处），本页不留第二份。 -->
    <div v-if="lastBatch" class="psi-bres" :class="{ warn: lastBatch.fail_count }">
      <span class="psi-bres-sum">
        {{ lastBatch.op_label }}：成功 <b>{{ lastBatch.ok_count }}</b> 张<template v-if="lastBatch.fail_count">，
        失败 <b class="dan">{{ lastBatch.fail_count }}</b> 张</template>
      </span>
      <ul v-if="lastBatch.fails.length" class="psi-bres-list">
        <li v-for="x in lastBatch.fails" :key="x.id">{{ noOfId(x.id) }} — {{ x.reason || '未说明原因' }}</li>
      </ul>
      <button class="psi-bres-close" @click="lastBatch = null">知道了</button>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <!-- v449：原来写死 `/inventory/sale/new`（不带 `type`）⇒ 在「车销退单」页签下
           点它会建出一张**自提订单**，而且看不出哪里不对。改成跟页签走（`newTo`），
           文案也跟页头一致（`新建车销退单`），而不是笼统的「新建销售单」。 -->
      <EmptyState
        icon="receipt"
        :desc="hasFilter ? '当前条件下没有' + (_kindReturn ? '退货单。' : '销售单。') : (_kindReturn ? '还没有退过货。' : '还没有销售单。')"
        :action-label="canWrite ? '新建' + title : ''"
        action-icon="plus"
        @action="go(newTo)"
      />
    </div>

    <div v-else class="card isl-card">
      <div class="table-wrap">
        <!-- v496：挂 .psi-tbl（全局固定布局 + nowrap/ellipsis，规范 §2.1）+ colgroup
             定宽（宽度唯一权威）+ 冻结序号/单号两列。
             与采购单列表同款：横向滚动由 .table-wrap 负责，列不被内容撑宽。
             v532：勾选列插在序号**前面**（与采购页同序）⇒ 冻结位次整体右移一格
             （勾选 1 / 序号 2 / 单号 3），left 偏移见 LEFT_CHK / LEFT_SEQ / LEFT_FROZEN。 -->
        <table class="tbl isl-tbl psi-tbl" :class="{ 'print-one': !!printOnly }"
               :style="{ '--psi-frz-1': LEFT_CHK + 'px', '--psi-frz-2': LEFT_SEQ + 'px', '--psi-frz-3': LEFT_FROZEN + 'px' }">
          <colgroup>
            <!-- v532：勾选列（批量操作逐行勾选；表头**不给全选框** —— v510 按老板口径删除） -->
            <col :style="{ width: CHK_W + 'px' }" />
            <col :style="{ width: SEQ_W + 'px' }" />
            <col v-for="c in visibleCols" :key="'cg-' + c.key" :style="{ width: c.w + 'px' }" />
            <col :style="{ width: OP_W + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <!-- v671：勾选列表头放**全选三态框**（v532 曾按 v510 口径留空，本轮恢复）。
                   范围 = 当前页，部分选中显示半选 ⇒ 不再有"点一下勾上全表"的误伤。
                   留这一格也是为了与表体列数对齐（table-layout:fixed）。 -->
              <th class="psi-chk psi-frz psi-frz-1">
                <SelectAllCheckbox :checked="pageAllOn" :indeterminate="pageSomeOn"
                                   :disabled="!rows.length" :count="rows.length" unit="张"
                                   @toggle="toggleSelectPage" />
              </th>
              <!-- 齿轮长在**序号列表头**格子里（§2.6.1：不放工具栏、不放别的表头列）。
                   v532：序号列让位给勾选列 ⇒ 冻结位置改 2（psi-frz-2）。 -->
              <th class="seq-th col-gear-th psi-frz psi-frz-2"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <!-- v473：可排序列 = `SORTABLE`。点击三态循环（降 → 升 → 取消），由 `onSort()`
                   重新拉数据（**服务端排序**，不是前端对当前页重排 —— 本页是服务端分页，
                   对当前 50 行重排「看着排好了」，一翻页就散架）。
                   指示器：未排 `sort`（中性 ⇅）→ 升 `arrow-up` → 降 `arrow-down`。
                   v532：单号列冻结位置改 3（psi-frz-3，紧贴序号列右侧）。 -->
              <th v-for="c in visibleCols" :key="c.key"
                  :class="[{ num: c.num, 'isl-sh': canSort(c),
                             'psi-frz': c.key === 'order_no', 'psi-frz-3': c.key === 'order_no' }]"
                  :aria-sort="ariaSortOf(c)"
                  :title="canSort(c) ? '点击排序：降序 → 升序 → 取消' : null"
                  @click="onSort(c)">
                {{ c.label }}<span v-if="canSort(c)" class="isl-sort-ind"><Icon :name="sortInd(c.key)" :size="12" /></span>
              </th>
              <th class="isl-op-hd"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id"
                :class="{ 'print-target': printOnly === r.id, 'psi-on': selected.includes(r.id) }"
                class="isl-row" @click="onRowClick(r)">
              <!-- v532：行勾选列（批量操作逐行勾选，样式走共享 .psi-chk）。
                   🔴 整格 `@click.stop`：本页 `<tr>` 带 `onRowClick`（点行进详情页），
                      不 stop 的话「勾一下就跳走了」，勾选永远留不住。 -->
              <td class="psi-chk psi-frz psi-frz-1" @click.stop>
                <input type="checkbox" :value="r.id" v-model="selected" />
              </td>
              <!-- 序号 = 服务端分页 ⇒ 必须 `offset + i + 1`（写 i+1 第 2 页会从 1 重来）。
                   v532：冻结位置改 2。 -->
              <td class="seq-cell psi-frz psi-frz-2"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td v-for="c in visibleCols" :key="c.key"
                  :class="{ num: c.num, 'psi-frz': c.key === 'order_no', 'psi-frz-3': c.key === 'order_no' }">
                <template v-if="c.key === 'order_no'">
                  <!-- v496：单号改**链接**（与采购单列表同款；行点击仍进同一详情页，
                       link 上 .stop 防止父子两个 handler 各推一次路由）。
                       🔴 v500：**只有销售订单**给详情链接 —— 退货行的 id 属于
                       `return_orders`，与 `sale_orders.id` 是**两套编号空间**，
                       沿用会跳到「另一张不相干的销售单详情」（零报错的越界）。
                       退货单目前没有详情页 ⇒ 只显示编号文本。 -->
                  <template v-if="_kindReturn">{{ r.order_no || ('#' + r.id) }}</template>
                  <a v-else class="isl-link isl-no" :href="'#/inventory/sale/' + r.id"
                     @click.stop.prevent="go('/inventory/sale/' + r.id)">{{ r.order_no || ('#' + r.id) }}</a>
                </template>
                <template v-else-if="c.key === 'customer'">{{ r.customer_name || '—' }}</template>
                <template v-else-if="c.key === 'total_amount'">¥{{ fmtMoney(r.total_amount) }}</template>
                <template v-else-if="c.key === 'status'">
                  <span class="tag" :class="tagOf(SO_STATUS, r.status)">{{ textOf(SO_STATUS, r.status) }}</span>
                </template>
                <template v-else>{{ cellVal(r, c.key) }}</template>
              </td>
              <td class="isl-op">
                <div class="isl-ops">
                  <!-- v500：退单视图的「审核」= 过账草稿（回增库存 + 冲减应收）。
                       只有 `status==='draft'` 才给 —— 已确认的单点它是重复过账。 -->
                  <button v-if="_kindReturn && canUpdate && r.status === 'draft'"
                          class="isl-op-btn" :disabled="approvingId === r.id"
                          @click.stop="approveReturn(r)">
                    {{ approvingId === r.id ? '审核中' : '审核' }}
                  </button>
                  <button v-if="!_kindReturn" class="isl-op-btn" :disabled="printing" @click.stop="rowPrint(r)">打印</button>
                </div>
              </td>
            </tr>
          </tbody>
          <!-- v511（C）：本页合计 —— 跟随列设置，金额列落值、其余留空。
               后端不返回合计 ⇒ 客户端对当前页可见行求和；明确标注「本页合计」，不是全单。 -->
          <tfoot>
            <tr>
              <!-- v532：勾选列的合计格（空）—— 表体多了一列，tfoot 必须同步补一格，
                   否则整行单元格右移一格、合计数字落在错误的列下面。 -->
              <td class="psi-frz psi-frz-1"></td>
              <td class="psi-frz psi-frz-2 ft-lb">本页合计</td>
              <td v-for="c in visibleCols" :key="'ft-' + c.key"
                  :class="{ num: c.num,
                             'psi-frz': c.key === 'order_no', 'psi-frz-3': c.key === 'order_no' }">
                <template v-if="c.num">¥{{ fmtMoney(pageTotals[c.key] || 0) }}</template>
              </td>
              <td class="ft-op"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- v500：列设置面板**跟随当前视图**（订单 / 退单两套列、两套云端配置，见 `SR_COLS`）。 -->
      <ColMenuPanel ref="panel" :col-list="activeCOLS" :is-visible="activeIsVisible"
                    :toggle-col="activeToggleCol" :reset-cols="activeResetCols" />

      <!-- v501：分页器换共享件 `PsiPager`（与采购 / 调拨两页同一条）。
           只有结构与样式换了：`total` / `pageNums` / `pageCount` 仍由本页 computed 算，
           翻页仍走本页 `goPage`，每页条数候选仍是本页 `PAGE_SIZES`。 -->
      <PsiPager :total="total" :from="pageFrom" :to="pageTo" :page="page"
                :page-nums="pageNums" :page-count="pageCount"
                :limit="limit" :sizes="PAGE_SIZES"
                @go="goPage" @size="onSize" />
    </div>
  </div>
</template>

<script setup>
/* 销售单列表 —— 数据源：`GET /api/psi/sale-orders`。
   🔴 「出货方式」（自提 / 调拨 / 车销）筛选是**后端过滤**（v392 给
      `sale_order_list` 追加了 `order_type` 参数）。⚠️ 不要改成前端 filter：
      本页有 2.2 万张单、按页拉 50 行，前端过滤只会作用于当前这一页 ⇒ 用户会看到
      「筛选后还有 50 条」这种假结果。

   v473（2026-10-12）：以**采购单列表页为基准**补齐四项能力（排序 / 导出 / 打印 / 筛选折叠），
   并修掉「下一页是死的」这个既存缺陷。三件事的因果关系值得写下来：
     ① 服务端排序（表头点击 → `order_by` / `order_dir`）**必须先有能用的 offset**，
        否则「第 3 页按金额降序」拿到的是「第 3 页的原始顺序」；
     ② `offset` 原先被 FastAPI **静默丢弃**（`psi.py` 与 `list_sale` 都没声明它），
        所以既有前端的分页按钮一直在改文案、内容却不动；
     ③ 「订单」入口原先在**取回本页 50 行后**用 filter 剔退货行 ⇒ 每页显示不足 50 行而
        `total` 不减。改成服务端 `exclude_status`（同一件事只有一个说法）。
   ⚠️ 「列设置」本页 v432 起已有（`useColSettings` + `ColMenuPanel`），本轮**只扩列**、
      不换组件 —— 换面板会把用户已存的列配置（云端）丢掉一次。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useColSettings } from '../../composables/useColSettings.js'
import ColMenuPanel from '../../components/ColMenuPanel.vue'
import { downloadCsv, localDateStamp } from '../../utils/csv'
import { psiApi } from '../../api/psi'
/* v685：客户筛选下拉也要拉全量 —— 生产 702 个客户，原来 limit=200 会截断
   （筛不到某些客户的单据，且界面完全正常 = 静默失效）。 */
import { REF_LIMIT } from './new/productPick.js'
import { canDo, toast, confirm } from '../../store'
import { SO_STATUS, ORDER_TYPE, ORDER_TYPE_OPTIONS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'
/* v449：`legacySalePath(type, kind)` 把旧入口的 `?type=&kind=` 解析成**拆分后的独立建单页**
   路径（未知组合 / 调拨退单落自提订单，并 `console.warn`）。列表页「＋」直接用它，
   不必再绕一圈旧路径 `/inventory/sale/new`（那条现在只是给旧书签用的重定向）。 */
import { legacySalePath } from './new/docTypes.js'
/* v496：快捷时间档改共享件（进销存列表页统一设计规范 §3.3）—— 与采购/调拨列表
   同一套芯片 + 同一套日期算法，三页不再各写一份。 */
import { useQuickRange } from '../../composables/useQuickRange.js'
import QuickRangeChips from '../../components/QuickRangeChips.vue'
/* v498：状态页签共享件（与采购 / 调拨两页同一条；样式在 psi-list.css 的 .psi-tabs）。 */
import StatusTabs from '../../components/StatusTabs.vue'
/* v671：表头全选（三态）全站统一件，范围 = 当前页。v532 曾按 v510 口径留空，本轮按最新口径恢复。 */
import SelectAllCheckbox from '../../components/SelectAllCheckbox.vue'
/* v501：分页器共享件（采购 / 销售 / 调拨三页同一条）。 */
import PsiPager from '../../components/PsiPager.vue'
/* v510：动作组共享件（导出 → 批量操作 → 新建 → 刷新；收进页签行右侧）。
   v532：销售单后端批量端点已上线（出货 / 签收 / 取消 / 驳回）⇒ 批量菜单开起来，
   仅退单视图关掉（行 id 属另一张表，见 BATCH_ACTIONS 处注释）。 */
import PsiListActions from '../../components/PsiListActions.vue'

/* 🔴 列设置（齿轮）：替换「序号」表头，可选列默认全开，核心列恒显。
   v473：核心列（单号 / 客户 / 金额 / 状态）**进了本清单** —— 表头从写死的 `<th>` 改成
   `v-for="visibleCols"`，排序与导出都需要每列有稳定的 `key`。
   ⚠️ 加进 `core` 的列**不会**进 `colVis`（`useColSettings` 只给非 core 键建项）⇒ 云端
      已存的列配置（`{otype, odate, ddate}`）**逐字不受影响**，用户调过的显隐不丢。
   ⚠️ 可选列的 key 保持 `otype` / `odate` / `ddate` 不改名：它们 v449 就落云端了，改名等于
      把用户调好的配置静默丢一次（云端那份认不出新键 ⇒ 全按默认开）。后端排序键不同名，
      由下面 `SORT_KEY` 显式映射。
   v496：每列补 `w`（列宽）—— 表格改 `table-layout:fixed` 后，宽度权威在 `<colgroup>`
      （规范 §2.1）；与基准页 `PO_COLS` 同构，导出/列菜单/冻结判断全部复用同一份定义。 */
const COLS = [
  { key: 'order_no',     label: '单号',     core: true, w: 150 },
  { key: 'customer',     label: '客户',     core: true, w: 160 },
  { key: 'total_amount', label: '金额',     core: true,  num: true, w: 110 },
  { key: 'status',       label: '状态',     core: true, w: 84 },
  { key: 'otype',        label: '出货方式', core: false, w: 96 },
  { key: 'odate',        label: '下单日期', core: false, w: 110 },
  { key: 'ddate',        label: '交货日期', core: false, w: 110 },
]
/* ── v500：销售**退货**视图的独立列集 ────────────────────────────────────────
   🔴 为什么不能复用 `COLS`：v500 起退货视图查的是**真退货表** `return_orders`
      （此前筛 `sale_orders.status='returned'` —— 那个 `returned` 全系统无人写
      ⇒ 两个退单入口恒空）。两张表字段不同：退货单没有「交货日期」，
      而有「退货原因 / 退货仓库 / 关联销售单」。硬套 `COLS` 会造出满屏 `—`。
   🔴 列设置**另用一个 key**（`INV-SALE-RETURN-LIST`）：两套列的 key 集合不同，
      共用一个键会互相覆盖（在订单页调好的显隐被退单页存的那份冲掉，零报错）。
   ⚠️ key 沿用 `otype` / `odate`（与 `COLS` 同名同义）⇒ 列设置面板的语义不变。 */
const SR_COLS = [
  { key: 'order_no',     label: '退货单号',   core: true, w: 150 },
  { key: 'customer',     label: '客户',       core: true, w: 160 },
  { key: 'total_amount', label: '退货金额',   core: true, num: true, w: 110 },
  { key: 'status',       label: '状态',       core: true, w: 84 },
  { key: 'wh',           label: '退货仓库',   core: false, w: 100 },
  { key: 'odate',        label: '退货日期',   core: false, w: 110 },
  { key: 'srcreason',    label: '退货原因',   core: false, w: 160 },
  { key: 'srcno',        label: '关联销售单', core: false, w: 150 },
  { key: 'otype',        label: '出货方式',   core: false, w: 96 },
]
const { isVisible, toggleCol, resetCols } = useColSettings('INV-SALE-LIST', COLS)
const {
  isVisible: isRetVisible, toggleCol: toggleRetCol, resetCols: resetRetCols,
} = useColSettings('INV-SALE-RETURN-LIST', SR_COLS)
/** 当前视图的列清单 / 显隐函数（模板与导出共用，不写两份）。 */
const activeCOLS = computed(() => (_kindReturn.value ? SR_COLS : COLS))
const activeIsVisible = computed(() => (_kindReturn.value ? isRetVisible : isVisible))
const activeToggleCol = computed(() => (_kindReturn.value ? toggleRetCol : toggleCol))
const activeResetCols = computed(() => (_kindReturn.value ? resetRetCols : resetCols))
const visibleCols = computed(() =>
  activeCOLS.value.filter(c => activeIsVisible.value(c.key)))
/* v511（C）：客户端「本页合计」—— 后端 `/api/psi/sale-orders` 与 `sale-return-orders`
   均不返回合计（真表在 erp 后端仓库，本仓前端只拉当前页行），故这里对**当前页可见行**
   的数值列求和。⚠️ 是"本页"不是"全单"：单据可能跨多页，明确写「本页合计」避免误读成总量。
   合计行跟随列设置（逐个可见数值列落值、其余留空），与采购页全单合计同款跟随口径。 */
const pageTotals = computed(() => {
  const defs = activeCOLS.value
  const t = {}
  for (const c of defs) if (c.num) t[c.key] = 0
  for (const r of rows.value) for (const c of defs) if (c.num) t[c.key] += Number(r[c.key] || 0)
  return t
})
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }
/* v496：序号列宽与全局序号列逐字一致（variables.css `table.tbl th.seq-th{width:46px}`）；
   冻结偏移也用它 —— 改序号宽必须同时改这两处（同一常量，不会漂）。
   操作列 76px = 一枚「打印」按钮 + 单元格 padding 的实测需要宽度。
   v532：勾选列 36px 与采购页 `CHK_W` **同值**（三页勾选框观感一致）；
   左侧冻结偏移改为 勾选0 / 序号36 / 单号82，与采购页同一套算法。 */
const CHK_W = 36
const SEQ_W = 46
const LEFT_CHK = 0                      // 勾选列在最左
const LEFT_SEQ = CHK_W                  // 36
const LEFT_FROZEN = CHK_W + SEQ_W       // 82 = 勾选 + 序号（单号列贴在其右侧）
/* 操作列：订单视图 76px（一枚「打印」）；退单视图 132px（「审核」+ 12px 间隔 + padding）。
   🔴 写死一个数会让退单视图的「审核」被挤出格子（表格是 `table-layout:fixed`，
      列宽权威在 `<colgroup>` ⇒ 这里必须跟着按钮数变）。 */
const OP_W_ORDER = 76
const OP_W_RETURN = 132
const OP_W = computed(() => (_kindReturn.value ? OP_W_RETURN : OP_W_ORDER))

/* ── v473：服务端排序 ──────────────────────────────────────────────────────
   🔴 为什么排序键要**映射**而不是直接用列 key：列 key（`otype`/`odate`/`ddate`）是
      云端列配置的主键，不能动（见上）；而后端白名单 `_SO_ORDER_SQL` 用的是库里的**列名**
      （`order_type` / `order_date` / `delivery_date`）。两边各自命名、这里显式对上。
   🔴 `SORTABLE` 与后端 `_SO_ORDER_SQL` 必须**逐键一致**（前端 ⊆ 后端）。后端对未登记键
      会**静默回落 `so.id DESC`** ⇒ 少登记一个键的症状是「这一列点了没反应、零报错」，
      最难查的一类。后端侧取证脚本：`.workbuddy/tools/v473-so-order-sort-probe.py`。
   ⚠️ 排序**不进** `f`（筛选对象）：它是"怎么看"不是"看哪些" —— 混进筛选会被带进
      `hasFilter`（空结果文案会答错）、也会被「重置」清掉（用户等于白点）。 */
const SORT_KEY = {
  order_no: 'order_no',
  customer: 'customer',
  total_amount: 'total_amount',
  status: 'status',
  otype: 'order_type',
  odate: 'order_date',
  ddate: 'delivery_date',
}
const SORTABLE = new Set(Object.keys(SORT_KEY))
const sortKey = ref('')          // 后端键（如 `total_amount`）
const sortDir = ref('')          // '' | 'asc' | 'desc'
/** 🔴 v500：退货端点**没有** `order_by`（后端未实现排序白名单）⇒ 退单视图一律不可排序。
    不 gate 的话表头照样能点、指示照样变，只是数据纹丝不动 —— 又是「点了没反应零报错」。 */
function canSort (c) { return !_kindReturn.value && SORTABLE.has(c.key) }
/** 表头指示器图标：未排 → 中性 `sort`（提示"这列能点"）；已排 → 升/降箭头。 */
function sortInd (colKey) {
  const k = SORT_KEY[colKey]
  if (!k || sortKey.value !== k) return 'sort'
  return sortDir.value === 'asc' ? 'arrow-up' : 'arrow-down'
}
function ariaSortOf (c) {
  if (!canSort(c) || sortKey.value !== SORT_KEY[c.key]) return 'none'
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}
function onSort (c) {
  if (!canSort(c)) return
  const k = SORT_KEY[c.key]
  // 三态循环：无 → 降序 → 升序 → 无。第一下给**降序**（与"新单在前"的默认观感一致）。
  if (sortKey.value !== k) { sortKey.value = k; sortDir.value = 'desc' }
  else if (sortDir.value === 'desc') { sortDir.value = 'asc' }
  else { sortKey.value = ''; sortDir.value = '' }
  load(true)
}
/* 排序提示里的列名：由后端键反查列 label。取不到（列定义被删）就退回键名 —— 不显示
   「未知列」这种编出来的字，但也不能什么都不显示（那又成了看不见的状态）。 */
const sortLabel = computed(() => {
  const k = sortKey.value
  if (!k) return ''
  const col = COLS.find(c => SORT_KEY[c.key] === k)
  return col ? col.label : k
})
function clearSort () {
  sortKey.value = ''
  sortDir.value = ''
  load(true)
}

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08，v473 改为**响应式**）：单据类型**从 URL 读** —— 侧栏「自提订单 /
   自提退单 / 车销订单 / 车销退单 / 调拨单」五个入口是**同一条 path、不同 query**。
   v473 之前这一段是 setup 里的一次性常量 ⇒ **同 path 换 query 时组件被复用、
   `onMounted` 不再跑**，点侧栏另一个入口页面纹丝不动（零报错，最难查的一类）。
   改成 computed + `watch` 后，五个入口**逐一切换都真的重新筛选**（与采购单页 `watch(kind)` 同款）。
   · `type` → 出货方式（`ORDER_TYPE` 的键）；未知值忽略（不许把脏 query 带进筛选）；
   · `kind=return` → 该出货方式 **且 状态=退货**（服务端 `status='returned'`）；
   · `kind=order` → 服务端**排除**退货行（`exclude_status='returned'`）。 */
const _qType = computed(() => String((route.query && route.query.type) || ''))
const _qKind = computed(() => String((route.query && route.query.kind) || ''))
const _kindOrder = computed(() => _qKind.value === 'order')
/* v500：退单视图（自提退单 / 车销退单）。
   🔴 它的数据源是 `GET /api/psi/sale-return-orders`（真表 `return_orders`），
      不是 `sale-orders` —— 见 `load()` 里的分支注释。 */
const _kindReturn = computed(() => _qKind.value === 'return')

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const counts = ref({})         // v498：状态页签计数（服务端 counts，见 tabs）
const customers = ref([])
const more = ref(false)
const printing = ref(false)
const printOnly = ref(0)
/* v532：行勾选（批量操作）—— 与采购页 `selected` 同构。
   🔴 `load()` 成功后**必须清空**：换页 / 换筛选后旧选择指向看不见的行，
      照着它执行批量 = 对"以为没选中的单据"动手（改库存 / 改钱，不可逆）。 */
const selected = ref([])
/* ---- v671：表头全选（范围 = 当前页）---- */
const pageIds = computed(() => rows.value.map(r => r.id))
const pageAllOn = computed(() => pageIds.value.length > 0 && pageIds.value.every(id => selected.value.includes(id)))
const pageSomeOn = computed(() => !pageAllOn.value && pageIds.value.some(id => selected.value.includes(id)))
function toggleSelectPage (on) {
  const ids = pageIds.value
  if (!ids.length) return
  if (on) {
    const set = new Set(selected.value)
    for (const id of ids) set.add(id)
    selected.value = [...set]
  } else {
    const drop = new Set(ids)
    selected.value = selected.value.filter(id => !drop.has(id))
  }
}
const batchOpen = ref(false)              // 批量菜单展开态（共享件 PsiListActions）
/* v532：上一次批量操作的逐单结果（成功几张 / 失败几张 + 后端给的中文原因）。
   放屏幕上而不是只弹 toast —— 失败原因要留着让用户照着处理，toast 几秒就没了。 */
const lastBatch = ref(null)

/* 分页：服务端分页，`limit` 可调（默认 50 = v473 之前的固定值 ⇒ 首屏观感不变）。 */
const PAGE_SIZES = [20, 50, 100, 200]
const limit = ref(50)
const offset = ref(0)
/* v501：`jumpTo` 删除 —— 「跳至」输入框的状态随分页器搬进共享件 `PsiPager`。 */

/* 筛选初值随入口变（见上方 URL 读取口径） */
function baseFilter () {
  return {
    /* v500：退单视图的状态档改为「全部 / 草稿 / 已确认」—— 它查的是真退货表
       `return_orders`（只有这两档），不再沿用销售单那个**无人写**的 `returned`。 */
    status: '', order_type: ORDER_TYPE[_qType.value] ? _qType.value : '',
    customer_id: 0, date_from: '', date_to: '',
  }
}
const f = ref(baseFilter())

/* v496：快捷时间档（规范 §3.3，共享 composable）。quickRange 只用于芯片高亮，
   真实值落在 f.date_from/date_to；手动改日期框走 onDateManual 清高亮。 */
const { quickRange, setDateRange, clearDateRange, onDateManual, pickRange } = useQuickRange(f, load)

/* 页头随入口变（自提订单 / 车销退单 / 调拨单 …）—— 让人一眼确认筛选真的生效了，
   而不是点五个入口都看到同一张「销售单」。 */
const title = computed(() => {
  const t = f.value.order_type ? textOf(ORDER_TYPE, f.value.order_type, '') : ''
  const k = _qKind.value === 'return' ? '退单' : (_qKind.value === 'order' ? '订单' : '')
  return t ? `${t}${k}` : '销售单'
})
const subTitle = computed(() => title.value === '销售单'
  ? '出货台账' : `按「${title.value}」筛选的出货台账`)
/* 「＋」直达**本入口对应的那张独立建单页**（v449 拆页）。
   · 不再带 `?type=&kind=` 进新建页 —— 每个独立页面已经从 `DOC_TYPE` 常量知道自己是哪种单据，
     再手选一次反而会让人以为「进错了可以改」。
   · `transfer|return` 不给落点（调拨没有退单，老板拍板）⇒ 由 `legacySalePath` 兜到自提订单
     并打 `console.warn`，与旧链接的处理口径完全一致。 */
const newTo = computed(() => ({ path: legacySalePath(_qType.value, _qKind.value) }))

// 新建单据（本页 70/71/104 三处「＋ 新建」）按老板拍板给会计 / 主管 ⇒ 仍走 `create`。
const canWrite = computed(() => canDo('inventory', 'create'))
// 🔴 v517：行内「审核」（= 退单过账）是**状态流转**，属"改" ⇒ 单独用 `update` 收口。
//    老板 / 管理员 list / `["*"]` ⇒ 恒真；会计 / 主管只有 `read` + `create` ⇒ 不显示该按钮。
const canUpdate = computed(() => canDo('inventory', 'update'))
const hasFilter = computed(() => !!(f.value.status || f.value.order_type || f.value.customer_id
  || f.value.date_from || f.value.date_to))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)
const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit.value, total.value))

/* v498：状态页签档位（替换原「状态下拉」的 `SO_OPTIONS`）。
   ⚠️ 每个页签都是**一个真实状态值**（1:1），不发明后端不支持 / 前端拼出来的复合状态；
      零值也照显（`已取消(0)`）——「这一档现在是空的」本身是信息。
   🔴 两处视图差异（与采购页同构）：
      · **退单**入口（`kind=return`）= 只有 `returned` 一种状态 ⇒ `tabs = []`（不渲染条）；
      · **订单**入口（`kind=order`）= 服务端 `exclude_status='returned'` ⇒ 不设「已退货」档
        （摆一档永远 0 的页签是噪音；无 kind 的通用入口才显示它）。 */
const TAB_DEFS = [
  { value: '', text: '全部' },
  { value: 'draft', text: textOf(SO_STATUS, 'draft') },
  { value: 'confirmed', text: textOf(SO_STATUS, 'confirmed') },
  { value: 'delivered', text: textOf(SO_STATUS, 'delivered') },
  { value: 'signed', text: textOf(SO_STATUS, 'signed') },
  { value: 'rejected', text: textOf(SO_STATUS, 'rejected') },
  { value: 'returned', text: textOf(SO_STATUS, 'returned') },
  { value: 'cancelled', text: textOf(SO_STATUS, 'cancelled') },
]
/* v500：退单视图的页签 = 真退货表 `return_orders` 的两档（全部 / 草稿 / 已确认）。
   🔴 为什么不再 `return []`：v500 之前退单筛的是 `sale_orders.status='returned'`
      ⇒ 只有一种状态，"页签没意义"成立；改查真表后它**真的有** `draft` / `confirmed`。 */
const SR_TAB_DEFS = [
  { value: '', text: '全部' },
  { value: 'draft', text: '草稿' },
  { value: 'confirmed', text: '已确认' },
]
const tabs = computed(() => {
  const n = (t) => (t.value ? (counts.value[t.value] || 0) : (counts.value.all || 0))
  if (_kindReturn.value) return SR_TAB_DEFS.map(t => ({ ...t, count: n(t) }))
  if (_qKind.value === 'return') return []      // 兜底：未知 kind 组合仍走旧口径
  return TAB_DEFS
    .filter(t => !(_kindOrder.value && t.value === 'returned'))
    .map(t => ({ ...t, count: n(t) }))
})
function pickTab (v) { f.value.status = v; load() }

/* ── v532：批量操作 ──────────────────────────────────────────────────────
   后端端点 `POST /api/psi/sale-orders/batch`（erp 仓 dc7e6a0 + 2eecc2e，已部署生产）。
   🔴 四个 op **全部**标 `danger` ⇒ 走二次确认：出货 / 签收 / 取消 / 驳回都会动库存或动钱，
      没有一个是"点了可以反悔"的（老板口径：危险操作必须二次确认）。
   🔴 后端**逐单**判否并给中文原因（原样展示，用户据此行动），例如：
        · 「状态错误：只有草稿或已确认状态的订单才能发货」
        · 「不是你创建的单据，无权操作」
      ⇒ 界面必须如实报「成功 N 张，失败 M 张」+ 逐张原因，不能只弹一个"操作成功"。
   ⛔ 退单视图（kind=return）不走这条：行 id 属 `return_orders`，交给销售单端点会打到
      不相干的单上（两套编号空间），见模板 `:show-batch` 处注释。

   🔴 v532c：文案口径 —— **同一个动作只有一个说法**（菜单 / 二次确认 / 结果条 / toast
      四处同一个串）。取值一律用这里的 `text`，**不读**后端 `op_label`：
        · 后端 op_label 是 `deliver=发货 / sign=签收 / cancel=取消 / reject=拒绝`；
        · 本页既有词表是 `SO_STATUS` 的「已发货 / 已签收 / 已取消 / **已驳回**」，
          详情页也写「这一张被驳回了」—— 全系统没有一处说「拒绝」；
        ⇒ 若照后端写「拒绝」，菜单说驳回、结果条说拒绝，又成了同动作两个说法。
      四项里前三项与后端 op_label **天然同字**（发货 / 签收 / 取消），只有 `reject`
      一项是「驳回」（对齐本页状态列）。建议后端把 reject 的 op_label 改成「驳回」
      （只改一个显示串，不影响单张端点语义），改完两边就完全收敛。 */
const BATCH_ACTIONS = [
  { op: 'deliver', text: '发货', danger: true },
  { op: 'sign', text: '签收', danger: true },
  { op: 'cancel', text: '取消', danger: true },
  { op: 'reject', text: '驳回', danger: true },
]

/* 未知出货方式也必须是中文（不许回落英文值） */
function orderTypeText (v) { return textOf(ORDER_TYPE, v, '未标注') }

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    /* v500：退单视图走**真退货表**端点 `/api/psi/sale-return-orders`。
       🔴 为什么换端点：原先筛 `sale_orders.status='returned'`，而那个 `returned`
          **全系统无人写**（后端注释实证 + 生产实测：22505 行销售单里 0 行 returned）
          ⇒ 「自提退单 / 车销退单」建完退货单就看不见，恒空且零报错。
       🔴 `order_type` **必传**：它是区分自提退单 / 车销退单的唯一键；不传的话
          两个入口会看到**同一份**数据（后端不筛），用户读成"我点的入口没生效"。
       ⚠️ 退货端点没有 `order_by` / `exclude_status` ⇒ 这两个键一律不传
          （传了后端静默忽略，见 `canSort`）。 */
    if (_kindReturn.value) {
      const d = await psiApi.listSaleReturns({
        ...f.value, limit: limit.value, offset: offset.value,
      })
      rows.value = d.rows || []
      total.value = Number(d.total || 0)
      counts.value = d.counts || {}
      /* v532：换页 / 换筛选 ⇒ 勾选作废（否则会对着看不见的行做批量操作）。 */
      selected.value = []
      lastBatch.value = null
      return
    }
    const p = { ...f.value, limit: limit.value, offset: offset.value }
    /* v473：排序（服务端）。未排序时这两个键**一个都不加** ⇒ 后端回落 `so.id DESC`，
       与 v473 之前逐字一致（老行为零变化）。 */
    if (sortKey.value) { p.order_by = sortKey.value; p.order_dir = sortDir.value }
    /* v473：「订单」入口排除退货行改由**服务端**做（原先是对本页 50 行 filter ⇒ 每页
       显示不足 50 行而 `total` 不减）。 */
    if (_kindOrder.value) p.exclude_status = 'returned'
    const [d, refs] = await Promise.all([
      psiApi.listSales(p),
      customers.value.length ? Promise.resolve(null) : psiApi.refs('customers', '', REF_LIMIT),
    ])
    rows.value = d.orders || []
    total.value = Number(d.total || 0)
    /* v498：状态页签计数（后端 v498 起返回；忽略 status、保留其余筛选 ⇒ 各档数字不漂移）。
       拿不到就给 `{}` ⇒ 页签全部显示 0（**可降级**：不隐藏页签、不报错）。 */
    counts.value = d.counts || {}
    if (refs && Array.isArray(refs.customers)) customers.value = refs.customers
    /* v532：换页 / 换筛选 ⇒ 勾选作废（见上方退单分支同款注释）。
       ⚠️ `lastBatch` 也在清，但批量执行体是在 `load()` **之后**才写 `lastBatch`
       ⇒ 刚跑完的那次结果不会被自己发起的刷新抹掉。 */
    selected.value = []
    lastBatch.value = null
  } catch (e) {
    err.value = e.message || (_kindReturn.value ? '销售退货单读取失败' : '销售单读取失败')
  } finally {
    loading.value = false
  }
}

/* v498：重置**必须回到 `baseFilter()`**（即"入口初值"）而不是一张写死的空表 ——
   原先这里写 `{status:'', order_type:'', …}`，会**连带把入口自带的筛选也清掉**：
     ① 退单入口（`kind=return`）的 `status='returned'` 被清空 ⇒ 点完「重置」，标题仍是
        「车销退单」，列表却变成**全部状态**（而 v498 起状态由页签承载、退单视图没有页签
        ⇒ 这个错既看不见、也没控件能改回来）；
     ② 车销入口的 `order_type` 被清空 ⇒ 标题从「车销订单」变成「销售单」，等于偷偷换了入口。
   用 `baseFilter()` 与「切换入口」的 watch **逐字同源**（同一件事只有一个说法）：
   重置只清用户自己加的条件（客户 / 日期 / 状态档），不动"我现在在哪个入口"。 */
function resetFilter () {
  f.value = baseFilter()
  sortKey.value = ''
  sortDir.value = ''
  quickRange.value = ''          // v496：重置一并清芯片高亮（否则"日期已清空、芯片还亮着"）
  load()
}

/* 入口切换（自提订单 ⇄ 自提退单 ⇄ 车销退单 …）⇒ 筛选归零 + 重拉。**排序也一并归零**：
   同一个排序键在两个视图里可能语义不同，带着它过去会让新视图一进来就是"莫名其妙的顺序"。
   v496：快捷档高亮同样归零（baseFilter 清掉了日期，芯片不能还亮着）。
   ⚠️ 必须 `watch` 而不是 setup 里读一次：五个入口是**同 path 不同 query**，组件会被复用。 */
watch([_qType, _qKind], () => {
  f.value = baseFilter()
  sortKey.value = ''
  sortDir.value = ''
  quickRange.value = ''
  load()
})

/* ---- 分页 ---- */
function goPage (p) {
  const n = Math.min(Math.max(1, p), pageCount.value)
  offset.value = (n - 1) * limit.value
  load(false)
}
/* v501：「跳至」输入框随分页器搬进共享件 `PsiPager`，本页 `jumpTo` / `doJump` 随之删除。
   改每页条数必须回到第 1 页（offset 还停在第 N 页而总页数已变 ⇒ 会落在空白页）。 */
function onSize (n) {
  limit.value = n
  goPage(1)
}
/* 分页器的页码窗（当前页居中，最多 7 个） */
const pageNums = computed(() => {
  const n = pageCount.value, cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  let s = Math.max(1, cur - 3)
  s = Math.min(s, n - 6)
  return Array.from({ length: 7 }, (_, i) => s + i)
})

/* ---- 单元格取值（**导出与表格共用同一套口径**，避免「同屏两个说法」）----
   ⚠️ 空值一律 `''` ⇒ 模板显示 `—`（**不**显示 `0` / 「无」）：本仓铁律「没有 ≠ 是零」。 */
function colText (r, k) {
  switch (k) {
    case 'order_no': return r.order_no || ('#' + r.id)
    case 'customer': return r.customer_name || ''
    case 'total_amount': return Number(r.total_amount || 0)
    case 'status': return textOf(SO_STATUS, r.status)
    case 'otype': return orderTypeText(r.order_type)
    case 'odate': return (r.order_date || '').slice(0, 10)
    case 'ddate': return (r.delivery_date || '').slice(0, 10)
    // v500 销售退货视图三个键（`SR_COLS` 用；销售订单行没有这些字段 ⇒ 恒 '' → 显示 —）。
    case 'wh': return r.warehouse_name || ''
    case 'srcreason': return r.reason || ''
    case 'srcno': return r.src_order_no || ''
  }
  return ''
}
function cellVal (r, k) {
  const t = colText(r, k)
  return (t === '' || t === null || t === undefined) ? '—' : t
}

/* ---- 导出（当前页 / 跟随列设置）----
   🔴 导出**跟随列设置**（顺序 + 显隐）—— 表里看到什么就导出什么。写死一份固定列会出现
      「表里没有的列被导出」与「表里有的列导不出」两个说法，而「同屏两个说法互相打脸」
      正是本仓一类专项缺陷。取值一律走 `colText`（唯一口径）。
   🔴 v532：导出范围 = **有勾选就导勾选行，没勾选就导当前页**（与采购页同口径）。
      「当前页」而不是「筛选后的全部 2.2 万张」—— 本页是服务端分页，前端手上只有这 50 行。
   ⚠️ CSV 的转义 / BOM / 文件名日期戳走 `utils/csv.js`（v408 上提的唯一实现）——
      文件名日期戳用 `localDateStamp()`（**本地时区**），不用 `toISOString()`：后者是 UTC，
      北京时间凌晨 0–8 点导出的文件会标成前一天，用户按文件名归档会以为导错了。 */
function doExport () {
  const list = selected.value.length
    ? rows.value.filter(r => selected.value.includes(r.id))
    : rows.value
  if (!list.length) return
  const cols = visibleCols.value
  if (!cols.length) { toast('当前没有可导出的列，请先在列设置里勾选', 'warn'); return }
  const head = cols.map(c => c.label)
  const body = list.map(r => cols.map(c => colText(r, c.key)))
  downloadCsv(`${title.value}-${localDateStamp()}.csv`, [head, ...body])
}

/* ---- v500：退单视图的行操作 ----
   🔴 「审核」= 过账草稿销售退货单（回增库存 + 冲减应收），端点
      `POST /api/psi/sale-return-orders/{id}/approve`。与采购侧 `approvePurchaseReturn`
      同款幂等（后端条件 UPDATE 乐观锁）：重复点不会把库存加两次，而是报人话错误。 */
const approvingId = ref(0)
function onRowClick (r) {
  // 退货行没有详情页（且 id 属于另一套编号空间）⇒ 点了什么都不做，不给假跳转。
  if (_kindReturn.value) return
  go('/inventory/sale/' + r.id)
}
async function approveReturn (row) {
  if (approvingId.value) return
  approvingId.value = row.id
  try {
    await psiApi.approveSaleReturn(row.id)
    toast(`退货单 ${row.order_no || ('#' + row.id)} 已审核（已回增库存并冲减应收）`, 'success')
    await load(false)        // 该行从「草稿」档移到「已确认」档
  } catch (e) {
    toast(e.message || '审核失败', 'error')
    await load(false)        // 失败可能是"已被别人审过"⇒ 拉一次让界面回到事实
  } finally {
    approvingId.value = 0
  }
}

/* ---- v532：批量操作的执行体 ----
   🔴 逐单结果**如实告知**（老板硬要求）：后端逐单判否并给中文原因，界面必须报出
      「成功 N 张，失败 M 张」并把每一张失败的原因列出来 —— 只弹一个"操作成功"是撒谎，
      用户会以为 20 张全成了、实际只成了 12 张，剩下的永远没人处理。
   ⚠️ 顺序有讲究：`lastBatch` 在 `load()` **之后**才写 —— `load()` 会清掉它，
      写早了结果条刚出现就被自己发起的刷新抹掉（采购页 `runOp` 就是这个顺序坑，
      本轮不复制）。 */
const busyBatch = ref(false)
function toggleBatch () {
  if (!canUpdate.value) return
  batchOpen.value = !batchOpen.value
}
/** 结果条里的失败行显示**单号**（老板要拿它去开那张单），查不到就退回 `#编号`。 */
function noOfId (id) {
  const r = rows.value.find(x => x.id === id)
  return r ? (r.order_no || ('#' + r.id)) : ('#' + id)
}
async function pickBatch (a) {
  batchOpen.value = false
  if (!canUpdate.value) return
  /* v532c：执行中**先挡在确认框之前** —— 挡在后面的话用户已经点了「确定」，
     再被静默 return，就是"点了没反应"（按钮禁用态同时也在 :batch-disabled 里）。 */
  if (busyBatch.value) return
  if (!selected.value.length) { toast('请先勾选要操作的单据', 'warn'); return }
  /* 二次确认：写清「对已勾选的 N 张执行 XX」，并预告可能部分失败 ——
     让人在按下之前就知道会发生什么，以及"没全成"是正常的。 */
  const n = selected.value.length
  const ok = await confirm(
    `确认${a.text}？\n\n将对已勾选的 ${n} 张单据执行「${a.text}」。` +
    '\n\n状态不符或不是你创建的单据会被逐单拒绝；执行后会如实列出成功几张、失败几张及原因。' +
    '\n\n确定执行吗？')
  if (!ok) return
  runBatch(a.op, a.text)
}
async function runBatch (op, text) {
  const ids = [...selected.value]
  if (!ids.length) { toast('请先勾选要操作的单据', 'warn'); return }
  if (busyBatch.value) return
  busyBatch.value = true
  try {
    const d = await psiApi.batchSales(op, ids)
    await load(false)                  // 状态变了 ⇒ 重拉当前页（页签计数一并同步）
    const fails = (d.results || []).filter(x => !x.ok)
    /* v532c：`op_label` 取本页 `text`（BATCH_ACTIONS 的中文），**不读** `d.op_label`
       —— 后端 reject 的 op_label 是「拒绝」，与菜单「驳回」不是同一个说法（详见
       BATCH_ACTIONS 处注释）。同一个动作从头到尾只显示一个串。 */
    lastBatch.value = {
      op_label: text,
      ok_count: Number(d.ok_count || 0),
      fail_count: Number(d.fail_count || 0),
      fails,
    }
    if (lastBatch.value.fail_count) {
      toast(`${lastBatch.value.op_label}：成功 ${lastBatch.value.ok_count} 张，失败 ${lastBatch.value.fail_count} 张 —— 失败原因见列表上方`, 'warn')
    } else {
      toast(`${lastBatch.value.op_label}完成：${lastBatch.value.ok_count} 张`, 'success')
    }
  } catch (e) {
    toast(e.message || '批量操作失败', 'error')
  } finally {
    busyBatch.value = false
  }
}

/* ---- 打印（浏览器打印，纯前端）----
   🔴 与采购单列表的**唯一差异**：采购单有「打印数」列（后端 `batchPurchases('print')` 记数），
      销售单**没有**这个后端能力 ⇒ 这里不调任何接口、也不显示打印数。⛔ 不要为了"对齐"
      造一个前端自增的假计数：刷新即归零，那一列等于假的。
   打印由 `window.print()` 完成，`@media print` 决定纸上留什么（见文件末）。
   v510：工具栏批量打印入口已移除（与采购页同口径），仅保留操作列逐行 `rowPrint`。 */
async function rowPrint (r) {
  if (printing.value) return
  printing.value = true
  try {
    printOnly.value = r.id
    await nextTick()
    window.print()
    setTimeout(() => { printOnly.value = 0 }, 800)
  } finally {
    printing.value = false
  }
}
function go (p) { router.push(p) }
onMounted(load)
</script>

<style scoped>
/* v511：`.inv-page` 撑满 `.view-wrap` 高度（flex 列），让下方 `.isl-card` 能 flex:1 占满
   剩余空间、再由 `.table-wrap` 自己滚动 ⇒ 表头 / 合计行冻结。三列表页同口径。 */
/* v513：原为 `height:100%`，但父级 `.page`（InventoryShell）是 `min-height:100%`（高度 auto），
   `height:100%` 解析不出确定高度 ⇒ flex 链断裂、`.table-wrap` 从不成为滚动容器、表头/合计行
   不冻结。改为 `flex:1`：内容不足一屏时撑满 `.page`，卡片随之填到底；内容超高时退化为内容高度、
   由 `.table-wrap` 的 max-height 兜底滚动。 */
.inv-page { display: flex; flex-direction: column; min-height: 0; flex: 1 }
/* v501：`.isl-acts`（页头动作组）随 `.page-hd` 一起删除 —— 新建 / 刷新已并入页签行右侧。 */
/* 筛选
   🔴 v501：筛选行 / 标签 / 控件尺寸 / 按钮组 / 下拉三角的样式已上提 `psi-list.css`
      （`.psi-frow` / `.psi-f` / `.psi-lb` / `.psi-sel` / `.psi-date` / `.psi-fbtns` /
      `.psi-caret`），三页唯一出处 ⇒ 这里不再留第二份。
      本页只剩筛选卡外壳 `.isl-filter`（下距是本页值）。 */
.isl-filter { margin-bottom: 12px }

/* 工具栏
   🔴 v510：工具栏 `.psi-tb` 已退役，动作组收进页签行右侧（共享件 PsiListActions）。
      排序提示（`.isl-selinfo` / `.isl-sortinfo`）经 #status 插槽注入，仍由本页提供。 */
.isl-link {
  border: none; background: none; padding: 0 2px; cursor: pointer;
  color: var(--p-dark); font-size: 12px; text-decoration: underline;
}

.isl-card { padding-bottom: 0 }
/* v496：固定布局 + colgroup 定宽（规范 §2.1）。min-width = 序号46 + 七列定宽 + 操作76
   之和（942px，取整 950）；v532 加勾选列 36 ⇒ 986。
   窄屏由 .table-wrap 横向滚动，列不被内容撑宽。 */
.isl-tbl { min-width: 986px }
.isl-row { cursor: pointer }
/* v496：单号是链接（进详情页）。isl-no 保留等宽数字，补 500 字重对齐基准页
   `.ipl-link.strong` 的观感。 */
.isl-no { font-variant-numeric: tabular-nums; font-weight: 500 }
.isl-op { color: var(--p-dark); white-space: nowrap }
/* v496：删 `.isl-op-hd{width:1%}` —— 操作列宽进 colgroup（OP_W=76），
   宽度唯一权威，不在这里留第二份（基准页 v408 同款纪律）。 */
/* 行内操作按钮（v473：单张打印）。⚠️ 销售单**没有**审核 / 取消 / 复制这类行内动作
   —— 后端没有对应接口，摆出来就是点了会报错的假按钮。 */
.isl-ops { display: inline-flex; align-items: center; gap: 6px }
.isl-op-btn {
  border: 1px solid var(--bd); background: var(--bg); color: var(--p-dark);
  border-radius: var(--radius-sm); padding: 2px 8px; font-size: 12px; cursor: pointer;
  white-space: nowrap;
}
.isl-op-btn:hover:not(:disabled) { border-color: var(--p); color: var(--p-ink) }
.isl-op-btn:disabled { opacity: .45; cursor: not-allowed }

/* v473：可排序列的表头 —— 手型 + 指示器 */
.isl-tbl thead th.isl-sh { cursor: pointer; user-select: none; white-space: nowrap }
.isl-tbl thead th.isl-sh:hover { color: var(--p-dark) }
.isl-sort-ind { display: inline-flex; vertical-align: middle; margin-left: 3px; color: var(--t3) }
.isl-tbl thead th.isl-sh:hover .isl-sort-ind { color: var(--p-ink) }
.isl-sort-ind svg.ico { width: 12px; height: 12px }

/* 分页器
   🔴 v501：整段删除 —— 改共享件 `PsiPager.vue`，样式随 `psi-list.css` 的 `.psi-pager`。 */

/* 打印：只留数据表；单张打印时只留那一行。 */
@media print {
  /* v501：`.page-hd` 已删除，`.isl-tb` / `.isl-pager` 已换共享件 ⇒ 三者隐藏规则
     都在 `psi-list.css`（三页唯一出处）。这里只留本页外壳。 */
  .isl-filter, .col-menu, .col-menu-overlay { display: none !important }
  .isl-card { border: none; box-shadow: none; padding-bottom: 0 }
  .isl-card .table-wrap { overflow: visible; border: none; border-radius: 0 }
  /* 打印稿一次性摊开 ⇒ 回到 auto 布局按纸张宽度收缩 */
  .isl-tbl { min-width: 0; width: 100%; table-layout: auto }
  .isl-op-hd, .isl-op { display: none !important }
  /* 🔴 齿轮按钮与排序指示器必须在纸上消失：它们是**交互控件/状态**，印出来读者点不动，
     只会以为"这列坏了"。采购单列表的 print CSS 漏了这一条（齿轮会随序号列印到纸上），
     本页不复制该瑕疵。 */
  .isl-tbl thead .col-cfg, .isl-tbl .isl-sort-ind { display: none !important }
  /* v511：本页合计行在打印稿里略去（只印当前页部分行、合计没有全局含义，且冻结列回静态后
     表头已是静态，合计行再钉底反而错位）。与采购页 `.ipl-tbl tfoot` 同口径。 */
  .isl-tbl tfoot { display: none !important }
  .isl-tbl.print-one tbody tr:not(.print-target) { display: none !important }
}

/* v501：窄屏规则随共享类一起上提 `psi-list.css`（三页唯一出处）——
   本页已无私有的筛选控件需要窄屏规则，故整段删除。 */
</style>
