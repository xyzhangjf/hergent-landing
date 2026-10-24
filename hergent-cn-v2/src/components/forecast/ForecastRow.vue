<template>
  <!--
    编辑网格的**一行**（v654 从 Forecast.vue 拆出）。
    ============================================================
    为什么要拆：单组件里 `cross.rows` 的任一格变化都会让整个 Forecast 组件的
    render effect 失效 ⇒ **294 行 × 53 列全部重建 vnode + patch**。实测（tenant 1，
    期次 36）停手后一次 flush 为 143~186ms，CPU profile 里 `(program)` 105ms +
    两个模板渲染匿名函数 21ms 全在 patch 上，而 `rowSumOf`／校验扫描合计不到 20ms。

    🔴 拆开的**收益前提**是：本组件只依赖「本行」与「全局且低频」的状态。
       下面三个 computed 刻意在本组件内按本行重算，**不能**改成读父组件的全表数组：
         · issues —— 父组件原先是 `cellIssueIndex`（全表 Map），任一格变则全表失效
         · sum    —— 原先 `rowSumArr[ri]`（全表 computed 数组），同上
         · warn   —— 原先 `rowWarnArr[ri]`，同上
       把它们留在父级 = 所有行一起重渲染 = 拆组件毫无意义。

    🔴 不改渲染结果：本组件产出的 DOM 与拆分前**逐节点一致**（结构 + 计算样式由
       `tests/perf/forecast-style-snapshot.mjs` 在真机逐元素逐属性比对，不是靠肉眼）。
  -->
  <tr :class="{ 'cur-row-hd': ctx.isCurRowHd(ri), 'row-sel': ctx.inRowSpan(ri), 'cond-warn': ctx.condWarnOn && warn === 'low', 'new-row': row._new }" :aria-selected="ctx.inRowSpan(ri) ? 'true' : null" :aria-current="ctx.isCurRowHd(ri) ? 'true' : null" v-show="ctx.rowBaseShown(ri)">
    <td class="td seq-cell" :class="{ 'row-bad': hasIssue }" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">
      <div class="seq-in">
        <!-- v615：`@mousedown.stop` 是硬要求 —— 序号格本身的 mousedown 会启动**整行选择轴**
             （onRowDown），不挡住的话勾一个复选框会连带把整行铺蓝、并搬走焦点。 -->
        <input v-if="ctx.editMode" type="checkbox" class="row-pick" :checked="!!row._sel"
               :title="row._sel ? '已选中：' + (row.name || '（无名称）') : '选中这一行（配合工具栏「批量操作」）'"
               @mousedown.stop @click.stop="ctx.toggleRowSel(ri, row)">
        <span class="seq-num">{{ ri + 1 }}</span>
      </div>
    </td>
    <td v-for="(c,  ci) in ctx.visibleCols" :key="c.key" :class="['td', c.cls, { frozen: c.fixed || c.key === ctx.frozenExtra, selected: ctx.selected.r === ri && ctx.selected.c === ci, 'sel-col': ctx.inColSpan(ci), 'range-sel': ctx.inRange(ri, ci), invalid: issueAt(ci) !== '', flash: flashHere(ci) }]" :style="c.fixed ? 'left:' + ctx.frozenLeftOf(c.key) : (c.key === ctx.frozenExtra ? 'left:' + ctx.frozenRight() : '')" :data-r="ri" :data-c="ci" :title="issueAt(ci) || null" @mousedown="ctx.onCellDown(ri, ci, $event)" @mouseover="ctx.onCellOver(ri, ci)">
      <template v-if="c.key === 'name'">
        <!-- v215：商品名候选**自建面板**（替掉原生 datalist）。
             🔴 为什么必须自建：datalist 的过滤由浏览器定（Safari 只认前缀）、
                只按 value 匹配 ⇒ 条码后四位 / 拼音首字母**无从表达**。
             ⚠️ `@input` 里开面板（datalist 时代没有这一格的输入事件）；
                `@keydown` 上下选 / 回车选中 / Esc 关闭；`@blur` 关闭。 -->
        <input v-model="row.name" class="cell-input cell-name" :placeholder="ctx.namePh" :style="ctx.namePadStyle(row)" :title="row.name || ''" :data-r="ri" :data-c="ci" @focus="ctx.onFocusCell(ri, ci, $event)" @input="ctx.onNameInput(row, ri, ci, $event)" @keydown="ctx.nameSugKey" @blur="ctx.nameSugClose" @change="ctx.onCellChange">
        <!-- v211（P1-1）：商品名称**补全候选** —— 数据源是 /api/products/grid 下发的**全量商品主档**
             （约 428 条），不是本期那 158 行。
             🔴 为什么这一格最值得补：保存时 `prodPayloadOf` 会把 name 一起回写**商品档案**
                （走 productsApi.bulkUpsert）⇒ 名字打歪一次就等于**给档案里添一条错商品**，
                比「打错字」严重得多（下游的对账/返利/统计都会带上它）。
             原实现这一格**既无候选、也没有 @change** —— 后者是个静默缺陷：
                商品名改动不进撤销栈（`_pendingCell` 只在 onCellChange 里消费），
                改了之后 Ctrl+Z / 「回退」都还原不了，也不点亮状态条。
             ⚠️ 照 1026 行同款「**仅首行渲染一份**」：每行都渲染会得到重复 id + 428×行数 个
                option 节点（实测同类做法会让点击展开时标签页卡死）。
             ⚠️ 非编辑态不渲染（查看态没有输入框，白挂 428 个节点）。
             ⚠️ option 的 `label` 在 Chrome 里是**下拉里显示的辅助文字**、`value` 才是填入值
                ⇒ label 放「名称 · 规格」，用户在下拉里看到规格便于区分同名的不同规格。 -->
        <!-- datalist 已由下面的**自建面板**取代（v215）。刻意**不保留空壳 datalist** ——
             留着会被别处的 `list=` 意外命中（v212 数量格那条注释里的同款教训）。 -->
        <div class="name-badges">
          <span v-if="warn === 'low'" class="warn-badge" title="低于安全库存"><Icon name="alert-triangle"/></span>
          <span v-else-if="warn === 'short'" class="warn-badge short" title="短保（保质期≤7天）"><Icon name="alert-triangle"/></span>
          <span v-if="ctx.lossWarn(row)" class="loss-badge" :class="ctx.lossWarn(row)" :title="ctx.lossTip(row)"><Icon name="flame"/></span>
          <span v-if="ctx.rtBadge(row)" class="rt-badge" :class="ctx.rtBadge(row)" :title="ctx.rtBadgeTip(row)"><Icon name="bell"/></span>
          <span v-if="ctx.rowNote(row) && canDo('data', 'update')" class="note-badge" :title="ctx.rowNote(row)" @click="ctx.setRowNote(ri)"><Icon name="message"/></span>
          <span v-else-if="ctx.rowNote(row)" class="note-badge" style="cursor:default" :title="ctx.rowNote(row)"><Icon name="message"/></span>
          <span v-if="ctx.hsMap[row.product_id] !== undefined && ctx.hsMap[row.product_id] < 60" class="hs-badge" :title="'健康分 '+ctx.hsMap[row.product_id]+'（偏低，需补全资料）'"><Icon name="lightbulb"/></span>
          <!-- v613：已点「加入本期清单」但还没保存成功的行必须看得见 ——
               否则保存被校验/冲突拦下后，用户只记得「我点过按钮」，回来却找不到哪些行标记过，
               再点一次按钮数还对不上（候选已排除它们）。 -->
          <span v-if="row._listAdd" class="listadd-badge" title="保存后加入本期清单（小程序里可搜到）">待上架</span>
          <!-- v614：撤下同理，标记必须看得见：保存被拦下后回来看不出哪些行已被标记。 -->
          <span v-if="row._listDel" class="listdel-badge" title="保存后从本期清单撤下（门店在小程序搜不到）">待撤下</span>
        </div>
      </template>
      <template v-else-if="c.edit === 'text' && c.options && c.options.length">
        <input v-model="row[c.key]" class="cell-input cell-wide" :placeholder="c.label" :data-r="ri" :data-c="ci" :list="'opt-' + c.key" @focus="ctx.onFocusCell(ri, ci, $event)" @change="ctx.onCellChange">
        <!-- 共享 datalist：仅首行渲染一份，避免每行重复 id + 海量 option 节点导致点击展开时标签页崩溃 -->
        <datalist v-if="ri === 0" :id="'opt-' + c.key">
          <option v-for="o in c.options" :key="o" :value="o"></option>
        </datalist>
      </template>
      <template v-else-if="c.edit === 'text'">
        <input v-model="row[c.key]" class="cell-input cell-wide" :placeholder="c.label" :data-r="ri" :data-c="ci" @focus="ctx.onFocusCell(ri, ci, $event)" @change="ctx.onCellChange">
      </template>
      <template v-else-if="c.edit === 'num'">
        <input :value="row[c.key] ?? ''" class="cell-input cell-num" type="text" :inputmode="c.num === 'int' ? 'numeric' : 'decimal'" placeholder="·" :data-r="ri" :data-c="ci" @focus="ctx.onFocusCell(ri, ci, $event)" @input="ctx.numInput($event, row, c.key)" @change="ctx.numCommit($event, row, c.key)">
      </template>
      <!-- v184：只读列（edit:'ro'）—— 有**展示**、没有写入口。
           ⚠️ 这里刻意不放 input：本列（到货周期）唯一写入口是「预报导入」，
              后端 bulk_upsert 的字段白名单里没有 arrival_lead_days ⇒
              摆个输入框就是**假旋钮**（用户改了、保存后静默回旧值、且不报错）。
           文案与查看态共用同一个 fmt（masterVal 也走 fmt）⇒ 两态显示必然一致。 -->
      <template v-else-if="c.edit === 'ro'">
        <span class="cell-ro">{{ c.fmt ? c.fmt(row) : (row[c.key] != null && row[c.key] !== '' ? row[c.key] : '—') }}</span>
      </template>
      <!-- v598（D1）：「本次改过」角标（右上角小三角）。单列判定见 cellDirty 注释；
           只对可编辑列显示 —— 只读列（到货周期）永远不会有改动，基线里也没有它。 -->
      <span v-if="c.edit !== 'ro' && ctx.cellDirty(row, 'm:' + c.key)" class="cell-dirty-dot" aria-label="本次改过" title="这一格本次改过（尚未保存）"></span>
      <!-- v211（P1-3）：错误角标 —— **触屏唯一能读到「为什么错」的入口**（td 的 title 要悬停，
           平板/手机没有悬停）。桌面侧它也顺带把「哪一格错了」标得比纯红框显眼。 -->
      <span v-if="issueAt(ci)" class="cell-err-dot" :title="issueAt(ci)" @mousedown.stop.prevent @click.stop="ctx.showCellErr(ri, ci)" aria-label="查看此格的错误原因"><Icon name="alert-triangle"/></span>
      <span v-if="ctx.selAxis === 'cell' && ctx.selected.r === ri && ctx.selected.c === ci" class="fill-handle" @mousedown.prevent.stop="ctx.startFill(ri, ci, $event)" @dblclick.stop.prevent="ctx.autoFillDown(ri, ci)" title="拖拽填充（双击 = 向下填到已报数量的末行）"></span>
    </td>
    <td v-for="(u, ui) in ctx.cross.units" :key="u.name" class="qty-cell" :class="{ selected: ctx.selected.r === ri && ctx.selected.c === ctx.visibleCols.length + ui, 'sel-col': ctx.inColSpan(ctx.visibleCols.length + ui), 'range-sel': ctx.inRange(ri, ctx.visibleCols.length + ui), invalid: issueAt(ctx.visibleCols.length + ui) !== '', 'warn-low': warn === 'low', 'warn-short': warn === 'short', 'diff-chg': ctx.snapCompare && ctx.cellDiff(ri, ui) !== 0, flash: flashHere(ctx.visibleCols.length + ui) }" :style="ctx.heatOf(row, u.name).style" :data-r="ri" :data-c="ctx.visibleCols.length + ui" :title="issueAt(ctx.visibleCols.length + ui) || ctx.heatOf(row, u.name).title || null" @mousedown="ctx.onCellDown(ri, ctx.visibleCols.length + ui, $event)" @mouseover="ctx.onCellOver(ri, ctx.visibleCols.length + ui)">
      <!-- v211（P1-2）：补 `inputmode` —— 触屏设备（平板 / 手机开网页）点这一格直接弹**数字键盘**。
           ⚠️ 不能只靠 `type="number"`：iOS 会弹数字键盘，但部分安卓浏览器不给 ⇒ 加 inputmode 是双保险。
           ⚠️ 只有**数量**用 numeric（整数）；单价有 `step="0.01"`（两位小数）必须用 decimal，
              否则安卓上小数点键会消失，用户永远填不了小数价。 -->
      <!-- v661：`:value` 走 `ctx.qtyCellShown()`（报量 + 分摊），用户手动改这一格即"接管"
           （见 Forecast.vue::qtyCellTakeOver）—— 否则填 60 会被显示成 60+分摊，越改越乱。 -->
      <input :value="ctx.qtyCellShown(row, u.name)" class="cell-input cell-qty" type="text" inputmode="numeric" placeholder="·" :data-r="ri" :data-c="ctx.visibleCols.length + ui" :list="ctx.qtyListFor(ri, ui)" @focus="ctx.onFocusCell(ri, ctx.visibleCols.length + ui, $event)" @input="ctx.onQtyCellInput($event, row, u.name)" @change="ctx.onQtyCellCommit($event, row, u.name)">
      <!-- v598（D1）：数量格的「本次改过」角标 —— 同 master 列，cid 用 `q:` 前缀带客户名。 -->
      <span v-if="ctx.cellDirty(row, 'q:' + u.name)" class="cell-dirty-dot" aria-label="本次改过" title="这一格本次改过（尚未保存）"></span>
      <!-- v211（P1-3）：同主档列的角标。这里用与本格 title **同一个判据**，
           否则角标和悬停会各说一套。 -->
      <span v-if="issueAt(ctx.visibleCols.length + ui)" class="cell-err-dot" :title="issueAt(ctx.visibleCols.length + ui)" @mousedown.stop.prevent @click.stop="ctx.showCellErr(ri, ctx.visibleCols.length + ui)" aria-label="查看此格的错误原因"><Icon name="alert-triangle"/></span>
      <!-- v212（P2-2）：**软警告角标**（黄=疑）—— 只有数量格有。
           三类角标各占一角，互不遮挡：红（一定错）在**左上**、黄（可能错）在**右上**、
           填充柄在**右下**（左下留给「行号格标红」那条视觉通道，不占）。
           ⚠️ `z-index` 必须 < 6（`.seq-cell` / `.frozen` 都是 6）—— 否则横向滚动时
              角标会浮在冻结列**上方**，像贴错了格子。 -->
      <span v-if="softAtUi(ui)" class="cell-soft-dot" :class="'soft-' + softAtUi(ui)" :title="ctx.cellSoftMsg(ri, ui)" @mousedown.stop.prevent @click.stop="ctx.showCellSoft(ri, ui)" aria-label="查看此格的疑点"><Icon name="alert-triangle"/></span>
      <span v-if="ctx.selAxis === 'cell' && ctx.selected.r === ri && ctx.selected.c === ctx.visibleCols.length + ui" class="fill-handle" @mousedown.prevent.stop="ctx.startFill(ri, ctx.visibleCols.length + ui, $event)" @dblclick.stop.prevent="ctx.autoFillDown(ri, ctx.visibleCols.length + ui)" title="拖拽填充（双击 = 向下填到已报数量的末行）"></span>
    </td>
    <td class="num calc sum" :class="[warnCls, ctx.moqWarn(row) === 'below' ? 'moq-below' : '']" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">{{ fmt(sum) }}</td>
    <td class="num calc boxes" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)"><span :class="{ 'miss-price': boxMissing(row) }">{{ boxText(row) }}</span></td>
    <td v-if="ctx.showSuggest" class="num calc suggest" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)" title="配方建议：按「建议算法」面板策略算出">{{ fmt(row.suggest || 0) }}<button class="mini-btn" @click="ctx.adoptSuggestion(ri)" :disabled="!(row.suggest > 0)">采纳</button></td>
    <td class="num calc extra pt-xmtd" :class="ctx.ptExtraCellCls(row)" :data-r="ri"><input :value="row.extraQty ?? ''" class="cell-input cell-qty" :class="{ 'cell-minus': ctx.isMinus(row.extraQty), 'xm-alert': ctx.ptExtraAlert(row) }" type="text" inputmode="numeric" placeholder="·" :data-r="ri" :data-c="ctx.C_EXTRA_INPUT" @focus="ctx.onFocusCell(ri, ctx.C_EXTRA_INPUT, $event)" @input="ctx.numInput($event, row, 'extraQty')" @change="ctx.numCommit($event, row, 'extraQty')" :title="ctx.ptExtraInputTitle(row)"><!-- v318：一键分摊入口。**只在编辑态**出现（比例写档案、加单量回填本行，都属"改单"范畴），
         readonly 态不放开 —— 免得在"只是看一眼"的状态下误写全期目标档案。
         v336：判据从「有目标且有承接人」放宽为「**有人可分**」
         （后端 `alloc_members` 唯一判定：目标承接人 或 本期报单人）。
         且**只有 ≥2 人时才出按钮** —— 只有一个人可承接时分摊是恒等映射，
         弹窗纯属打扰（用户 2026-09-30 拍板方案 B）。
         ⚠️ readonly 态不出按钮，但**悬停说明两种状态都给**（见 ptExtraInputTitle）。
         🔴 @click 参数**直接传 row**：本行 v-for 遍历的正是 cross.rows（编辑态唯一实例）。
         不要再套一层「按 product_id 回查」——**同品多行**时会命中错行，回填加单量就写到别人头上。 -->
      <button v-if="ctx.hasAllocTarget(row)" type="button" class="pt-alloc-btn" :title="ctx.ptAllocBtnTitle(row)" @click.stop.prevent="ctx.openAlloc(row)">分摊</button><b v-if="ctx.ptExtraMark(row)" class="pt-xm-b pt-xm-abs" :class="'has-' + ctx.ptExtraMark(row).kind">{{ ctx.ptExtraMark(row).text }}</b><span v-if="ctx.ptExtraMark(row)" class="tip pt-tip pt-tip-abs"><i v-for="(L, li) in ctx.ptExtraTip(row)" :key="li">{{ L }}</i></span></td>
    <td class="num calc final" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)"><b>{{ fmt(rowFinalQty(row)) }}</b></td>
    <td class="num calc price" :class="{ 'miss-price': pricePerCase(row) == null }" :data-r="ri"><input :value="row.casePrice ?? ''" class="cell-input cell-price" :class="{ 'manual-price': Number(row.casePrice) > 0 }" type="text" inputmode="decimal" :placeholder="pricePh(row)" :title="priceTitle(row)" :data-r="ri" :data-c="ctx.C_PRICE_INPUT" @focus="ctx.onFocusCell(ri, ctx.C_PRICE_INPUT, $event)" @input="ctx.numInput($event, row, 'casePrice')" @change="ctx.onCasePriceChange(row, $event)"></td>
    <td class="num calc amount" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)"><span :class="{ 'miss-price': pricePerCase(row) == null }">{{ amountValue(row) != null ? fmt(amountValue(row)) : (factoryPrice(row) <= 0 ? '缺价' : '缺规格') }}</span></td>
    <td v-if="ctx.compareOn" class="num calc" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">{{ ctx.prevQty(row) != null ? fmt(ctx.prevQty(row)) : '—' }}</td>
    <td v-if="ctx.compareOn" class="num calc delta" :class="ctx.deltaClass(row)" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">{{ ctx.deltaQty(row) == null ? '—' : (ctx.deltaQty(row) > 0 ? '+' : '') + fmt(ctx.deltaQty(row)) }}</td>
    <td v-if="ctx.showSpark" class="spark-td" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">
      <svg v-if="(row.history || []).length >= 2" width="84" height="18"><polyline :points="ctx.sparkPoints(row)" fill="none" :stroke="ctx.sparkColor(row)" stroke-width="1.5"/></svg>
      <span v-else class="muted">—</span>
    </td>
    <td v-if="ctx.yoyOn" class="num calc" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">{{ ctx.yoyQty(row) != null ? fmt(ctx.yoyQty(row)) : '—' }}</td>
    <td v-if="ctx.yoyOn" class="num calc delta" :class="ctx.yoyPct(row) > 0 ? 'up' : (ctx.yoyPct(row) < 0 ? 'down' : '')" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)">{{ ctx.yoyPct(row) == null ? '—' : (ctx.yoyPct(row) > 0 ? '+' : '') + ctx.yoyPct(row) + '%' }}</td>
    <td class="op-th" :data-r="ri" @mousedown="ctx.onRowDown(ri, $event)" @mouseover="ctx.onCellOver(ri, ctx.SEQ_CI)"><button class="btn-del" @click="ctx.delRow(ri)" title="删除该商品行"><Icon name="close"/></button></td>
  </tr>
</template>

<script setup>
import { computed, inject } from 'vue'
import Icon from '../Icon.vue'
import { canDo } from '../../store'
import { fmt } from '../../utils/forecast/format.js'
import { rowSum, rowSumAll, rowFinalQty, factoryPrice, boxMissing, boxText, pricePerCase, pricePh, priceTitle, amountValue } from '../../utils/forecast/calc.js'
import { FC_ROW_CTX } from './rowCtx.js'

const props = defineProps({
  /* 行对象（cross.rows[i] 本身）。**不要**在 setup 里 `const r = props.row` 解构 ——
     那会在组件实例被复用时指向旧对象（过滤/排序后行索引变化），表现为「改的是别的行」。
     模板里直接用 `row` 才是响应式的。 */
  row: { type: Object, required: true },
  ri: { type: Number, required: true },
})

const ctx = inject(FC_ROW_CTX)
if (!ctx) throw new Error('[ForecastRow] 缺少 FC_ROW_CTX 注入')

/* ---- 行内计算（v654）----
   🔴 这三个必须留在**本组件内**按本行重算。它们原先是父组件的全表 computed
      （`cellIssueIndex` / `rowSumArr` / `rowWarnArr`），任一格变化都会让数组/Map 变新，
      于是所有行组件一起重渲染 —— 那样拆组件就一点收益都没有。
   缓存粒度由 Vue 的 computed 保证：只在本行数据或列配置变化时重算。 */
const issues = computed(() => {
  /* 键 = 列序号，值 = 错误说明。只有出错的格才进 Map（绝大多数格是空 ⇒ 零分配）。 */
  const m = new Map()
  const nc = ctx.visibleCols.length + ctx.cross.units.length
  const row = props.row
  if (!row) return m
  for (let ci = 0; ci < nc; ci++) {
    const msg = ctx.cellIssue(props.ri, ci)
    if (msg) m.set(ci, msg)
  }
  return m
})
/** 某格的错误说明（'' = 没错）。模板里同一格会问 2~3 次，走 Map 取值而不是重复算。 */
function issueAt(ci) { return issues.value.get(ci) || '' }
/** 本行是否有错（等价于原先的 `errRowSet.has(ri)`）—— 序号格标红用。 */
const hasIssue = computed(() => issues.value.size > 0)

/** 本行合计（小单位）。原先取自 `rowSumArr[ri]`，现按本行算（O(单位数)，不再是全表 O(行×单位)）。
 *  v661：改用 `rowSumAll`（报量 + 分摊）—— 门店列已经显示分摊后的量，合计必须跟着走，
 *        否则「各门店加起来 220，合计却写 120」，用户一眼就判这是错的。 */
const sum = computed(() => rowSumAll(props.row))
/** 本行库存/效期警告档（'low' | 'short' | ''）。原先取自 `rowWarnArr[ri]`。
    传 `sum.value` 进去 —— 不传的话 rowWarn 内部会走 `rowSumOf` → 全表 `rowSumArr`，
    于是「别的行改了」也会让本行的 warn 失效（等于没拆）。 */
const warn = computed(() => ctx.rowWarn(props.row, sum.value))
/** 合计格的 class（原先 warnClass(ri)）。 */
const warnCls = computed(() => warn.value === 'low' ? 'warn-low' : warn.value === 'short' ? 'warn-short' : '')

/** 本行软警告（黄点）：ui → 'miss' | 'over'。原先取自全表 `softAt`。
    判据本身只有一份（父组件 `softOfRow`），这里只是把它按本行调用。 */
const EMPTY_MAP = new Map()
const soft = computed(() => {
  const cfg = ctx.softWarnCfg
  if (!cfg.overOn && !cfg.missOn) return EMPTY_MAP
  return ctx.softOfRow(props.row, ctx.cross.units, cfg, ctx.softRatio(), ctx.prevUnitMap)
})
/** 某数量格的软警告 kind（'' = 无疑点）。 */
function softAtUi(ui) { return soft.value.get(ui) || '' }

/* 本行是否处于「刚提交、闪一下」状态。
   🔴 为什么不能直接用父组件的 `ctx.isFlash(ri, ci)`：那是个函数，写在模板里等于
      本行 render 直接依赖全局 `flashCell` ref —— 提交任意一格都会让 **294 行全部重渲染**
      （实测 componentRows = 294）。改成行内 computed 后，非本行取到的永远是 `null`，
      computed 的新旧值相等 ⇒ Vue 不通知依赖者 ⇒ 只有「上一次闪的行」和「这一次闪的行」重渲染。 */
const flashHereC = computed(() => {
  const f = ctx.flashCell
  return f && f.r === props.ri ? f : null
})
function flashHere(ci) {
  const f = flashHereC.value
  return !!f && f.c === ci
}
</script>
