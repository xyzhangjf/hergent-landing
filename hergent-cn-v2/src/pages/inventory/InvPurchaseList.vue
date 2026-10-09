<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>{{ isReturn ? '采购退货单' : '采购单' }}</h2>
        <span class="page-sub">{{ isReturn ? '退给供应商的退货单据' : '向供应商进货的单据' }}</span>
      </div>
      <div class="ipl-acts">
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="goNew()">
          <Icon name="plus" :size="14" />{{ isReturn ? '新建采购退货单' : '新建采购单' }}
        </button>
      </div>
    </div>

    <!-- 筛选：常用项一行 + 「更多选项」展开（对齐舟谱工具栏） -->
    <div class="card ipl-filter">
      <div class="ipl-frow">
        <div class="ipl-f ipl-f-kw">
          <label class="ipl-lb">搜索</label>
          <input v-model.trim="f.keyword" class="input ipl-kw"
                 placeholder="单号 / 供应商 / 备注" @keyup.enter="load()" />
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">供应商</label>
          <select v-model.number="f.supplier_id" class="input ipl-sel" @change="load()">
            <option :value="0">全部供应商</option>
            <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">单据日期从</label>
          <input type="date" v-model="f.date_from" class="input ipl-date" @change="load()" />
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">至</label>
          <input type="date" v-model="f.date_to" class="input ipl-date" @change="load()" />
        </div>
        <div class="ipl-fbtns">
          <button class="btn btn-primary btn-sm" :disabled="loading" @click="load()">
            <Icon name="search" :size="14" />查询
          </button>
          <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
          <button class="btn btn-ghost btn-sm" :class="{ on: more }" @click="more = !more">
            更多选项<span class="ipl-caret" :class="{ up: more }"></span>
          </button>
        </div>
      </div>

      <div v-if="more" class="ipl-frow ipl-frow-sub">
        <div class="ipl-f">
          <label class="ipl-lb">入库仓库</label>
          <select v-model.number="f.warehouse_id" class="input ipl-sel" @change="load()">
            <option :value="0">全部仓库</option>
            <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <div v-if="creators.length" class="ipl-f">
          <label class="ipl-lb">创建人</label>
          <select v-model="f.creator" class="input ipl-sel" @change="load()">
            <option value="">全部创建人</option>
            <option v-for="u in creators" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
          </select>
        </div>
        <label class="check-item ipl-chk-mark">
          <input type="checkbox" v-model="f.only_marked" @change="load()" />只看已标记
        </label>
        <!-- v408（P1-3）单据来源 / 打印状态 / 商品 三个筛选。
             🔴 三者的「全部」值都是**空串**（不是 0）—— `psi.js` 的 `qs()` 会把空串、
                0、false 一律**不发**该参数，后端默认值也是空 ⇒ 语义一致。
             ⚠️ 这里**没有**「审核人」筛选 —— 不是因为没有数据：v408（P1-7）起后端
                已经记 `auditor_id` 了。是**本轮只做列不做筛**（报告只要求列），且真要加
                必须先定「审核人为空的历史单怎么筛」（占绝大多数 ⇒ 需要一个「未标注」选项）。
                见 `baseFilter()` 里的同期注释。 -->
        <div class="ipl-f">
          <label class="ipl-lb">单据来源</label>
          <select v-model="f.source" class="input ipl-sel" @change="load()">
            <option v-for="o in PO_SOURCE_OPTIONS" :key="o.value || 'all'" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">打印状态</label>
          <select v-model="f.print_state" class="input ipl-sel" @change="load()">
            <option value="">全部</option>
            <option value="printed">已打印</option>
            <option value="unprinted">未打印</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">商品</label>
          <input v-model.trim="f.product_keyword" class="input ipl-sel"
                 placeholder="商品名 / 条码" @keyup.enter="load()" />
        </div>
        <!-- P1-3：部门 / 经办人 / 审核人 / 标记内容 四个筛选。全部默认空 = 不筛（与后端默认值一致）。 -->
        <div class="ipl-f">
          <label class="ipl-lb">部门</label>
          <select v-model.number="f.department_id" class="input ipl-sel" @change="load()">
            <option :value="0">全部部门</option>
            <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">经办人</label>
          <select v-model="f.handler" class="input ipl-sel" @change="load()">
            <option value="">全部经办人</option>
            <option v-for="u in creators" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">审核人</label>
          <select v-model="f.auditor" class="input ipl-sel" @change="load()">
            <option value="">全部审核人</option>
            <option value="__none__">未标注</option>
            <option v-for="u in creators" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">标记内容</label>
          <input v-model.trim="f.mark" class="input ipl-sel"
                 placeholder="标记含关键字" @keyup.enter="load()" />
        </div>
        <!-- 🔴 「只看已标记」必须留在**最后**：它的样式是 `margin-left:auto`
             （推到本行最右）。插在它后面的控件会被一起推到右侧、跟前面几项断开。 -->
        <label class="check-item ipl-chk-mark">
          <input type="checkbox" v-model="f.only_marked" @change="load()" />只看已标记
        </label>
      </div>
    </div>

    <!-- 状态页签（计数来自服务端 counts：忽略状态筛选、保留其它筛选 ⇒ 切页签数字不漂移） -->
    <div v-if="tabs.length > 1" class="main-tabs ipl-tabs">
      <button v-for="t in tabs" :key="t.value || 'all'" class="main-tab"
              :class="{ on: f.status === t.value }" @click="pickTab(t.value)">
        {{ t.text }}<span class="ipl-tabn">{{ t.count }}</span>
      </button>
    </div>

    <!-- 工具栏 -->
    <div class="ipl-tb">
      <div class="ipl-tb-l">
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="selectAll">全选</button>
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="invertSel">反选</button>
        <span class="ipl-selinfo">
          已选择 <b>{{ selected.length }}</b> 条
          <button v-if="selected.length" class="ipl-link" @click="selected = []">清空</button>
        </span>
      </div>
      <div class="ipl-tb-r">
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="doExport">
          <Icon name="download" :size="14" />导出
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="doPrint()">
          <Icon name="print" :size="14" />打印
        </button>
        <div class="ipl-mw">
          <button class="btn btn-ghost btn-sm" :class="{ on: batchOpen }"
                  :disabled="!canWrite" @click.stop="toggleBatch">
            批量操作<span class="ipl-caret" :class="{ up: batchOpen }"></span>
          </button>
          <div v-if="batchOpen" class="ipl-menu" @click.stop>
            <button v-for="a in BATCH_ACTIONS" :key="a.op" class="ipl-mi"
                    :class="{ danger: a.danger }" @click="pickBatch(a)">{{ a.text }}</button>
          </div>
        </div>
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="goNew()">
          <Icon name="plus" :size="14" />新建
        </button>
      </div>
    </div>

    <!-- 批量结果（逐单回报：失败必须带原因，否则用户无法行动） -->
    <div v-if="lastBatch" class="ipl-result" :class="{ warn: lastBatch.fail_count }">
      <span class="ipl-rsum">
        {{ lastBatch.op_label }}：成功 <b>{{ lastBatch.ok_count }}</b> 张<template v-if="lastBatch.fail_count">，
        失败 <b class="dan">{{ lastBatch.fail_count }}</b> 张</template>
      </span>
      <ul v-if="lastBatch.fails.length" class="ipl-rlist">
        <li v-for="x in lastBatch.fails" :key="x.id">#{{ x.id }} — {{ x.reason || '未说明原因' }}</li>
      </ul>
      <button class="ipl-link" @click="lastBatch = null">知道了</button>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="inbox" :size="22" /></div>
        <p>{{ hasFilter || f.status ? '当前条件下没有单据。' : (isReturn ? '还没有退过货。' : '还没有单据。') }}</p>
        <!-- v414（P2-6）退货页签的**空态出口**：退货不能凭空建 —— 它必须挂一张**已入库**的采购单。
             不给这句，用户在这个空页面上只能看到「还没有退过货」，而侧栏那个「新建」进去也要先选原单
             ⇒ 两头都不说，等于没路。这里直接把那条路写出来。 -->
        <p v-if="isReturn && !hasFilter && !f.status"
           style="margin-top:6px;font-size:12px;color:var(--t3);line-height:1.5">
          退货单是从一张<b>已入库</b>的采购单转出来的：打开那张单，点「转单为 → 采购退货」。
        </p>
        <button v-if="canWrite && !isReturn" class="btn btn-primary btn-sm" style="margin-top:12px"
                @click="goNew()">
          <Icon name="plus" :size="14" />新建采购单
        </button>
      </div>
    </div>

    <div v-else class="card ipl-card">
      <div class="table-wrap">
        <table class="tbl ipl-tbl" :class="{ 'print-one': !!printOnly }">
          <!-- 列宽**权威来源**（本表 table-layout:fixed ⇒ 声明值即硬值）。
               左侧冻结区的 sticky 偏移 0 / 36 / 82 / 212 依赖这三个宽度不被内容撑开。
               ⛔ 别在 scoped CSS 里再给这些列写 width —— 那就是第二个真相来源。 -->
          <colgroup>
            <col :style="{ width: CHK_W + 'px' }" />
            <col :style="{ width: SEQ_W + 'px' }" />
            <col v-for="c in visibleCols" :key="'cg-' + c.key" :style="{ width: c.w + 'px' }" />
            <col :style="{ width: OP_W + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <th class="ipl-c-chk ipl-frz-chk">
                <input ref="headChk" type="checkbox" :checked="allChecked" title="全选本页" @change="toggleAll" />
              </th>
              <!-- 🔴 §2.6.1「一、」：齿轮长在**序号列表头**格子里、是该格**唯一**的按钮，
                   包在 `.th-in` 里（`.th-in > .col-cfg{margin-inline:auto}` 把它拉回格子正中）。
                   ⛔ 不放工具栏、⛔ 不放别的表头列。 -->
              <th class="seq-th ipl-frz-seq">
                <div class="th-in">
                  <button class="col-cfg gear" @click.stop="toggleColMenu" title="列设置"><Icon name="settings" /></button>
                </div>
              </th>
              <th v-for="c in visibleCols" :key="c.key"
                  :class="[{ num: c.num, 'ipl-clip': c.clip,
                             'ipl-frz-key': c.key === FIXED_FROZEN, 'ipl-frz-x': isFrz2(c) }]">{{ c.label }}</th>
              <th class="ipl-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id"
                :class="{ 'print-target': printOnly === r.id, 'ipl-on': selected.includes(r.id) }">
              <td class="ipl-c-chk ipl-frz-chk">
                <input type="checkbox" :value="r.id" v-model="selected" />
              </td>
              <!-- §2.6.1「二、」：序号 = 服务端分页 ⇒ 必须 `offset + i + 1`（写 i+1 第 2 页会从 1 重来） -->
              <td class="seq-cell ipl-frz-seq"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td v-for="c in visibleCols" :key="c.key"
                  :class="[{ num: c.num, 'ipl-clip': c.clip,
                             'ipl-frz-key': c.key === FIXED_FROZEN, 'ipl-frz-x': isFrz2(c) }]">
                <template v-if="c.key === 'order_no'">
                  <a class="ipl-link strong" @click.prevent="go('/inventory/purchase/' + r.id)"
                     :href="'#/inventory/purchase/' + r.id">{{ r.order_no || ('#' + r.id) }}</a>
                  <span v-if="r.mark" class="ipl-mark" :title="'标记：' + r.mark">
                    <Icon name="target" :size="12" />
                  </span>
                </template>
                <template v-else-if="c.key === 'status'">
                  <span class="tag" :class="tagOf(PO_STATUS, r.status)">{{ textOf(PO_STATUS, r.status) }}</span>
                </template>
                <template v-else-if="c.key === 'source'">
                  <span v-if="r.source" class="tag" :class="tagOf(PO_SOURCE, r.source)">{{ textOf(PO_SOURCE, r.source) }}</span>
                  <span v-else>—</span>
                </template>
                <template v-else-if="MONEY_COLS.includes(c.key)">{{ moneyCell(r, c.key) }}</template>
                <template v-else>{{ cellVal(r, c.key) }}</template>
              </td>
              <td class="ipl-c-op">
                <button class="ipl-link" :disabled="printing" @click="rowPrint(r)">打印</button>
                <button class="ipl-link" :disabled="!canWrite" @click="rowCopy(r)">复制</button>
              </td>
            </tr>
          </tbody>
          <!-- 合计行**跟随列设置**：每个可见列都出一格，金额列落值、其余留空。
               写死 colspan 会在列被隐藏/重排后错位（原来就是 colspan="8" / "6"）。 -->
          <tfoot>
            <tr>
              <td :colspan="2" class="ipl-ft-lb ipl-frz-span2">总计</td>
              <td v-for="c in visibleCols" :key="'ft-' + c.key"
                  :class="[{ num: c.num, 'ipl-ft-num': MONEY_COLS.includes(c.key),
                             'ipl-frz-key': c.key === FIXED_FROZEN, 'ipl-frz-x': isFrz2(c) }]">
                <template v-if="c.key === 'total_amount'">¥{{ fmtMoney(summary.order_amount) }}</template>
                <template v-else-if="c.key === 'received_amount'">¥{{ fmtMoney(summary.received_amount) }}</template>
                <template v-else-if="c.key === 'paid_amount'">¥{{ fmtMoney(summary.paid_amount) }}</template>
                <template v-else-if="c.key === 'unpaid'">¥{{ fmtMoney(summary.unpaid_amount) }}</template>
              </td>
              <td class="ipl-c-op"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="ipl-pager">
        <span class="ipl-pg-cnt">共 {{ total }} 条记录</span>
        <div class="ipl-pg-nums">
          <button class="ipl-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
          <button v-for="p in pageNums" :key="p" class="ipl-pg" :class="{ on: p === page }"
                  @click="goPage(p)">{{ p }}</button>
          <button class="ipl-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
        </div>
        <select v-model.number="limit" class="input ipl-pg-size" @change="goPage(1)">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
        </select>
        <span class="ipl-pg-jump">
          跳至
          <input v-model.number="jumpTo" class="input ipl-pg-in" inputmode="numeric"
                 @keyup.enter="doJump" />
          页
        </span>
      </div>
    </div>

    <!-- 列设置面板（UI-SPEC §2.6.1「三、」）——
         类名 / 结构与 `/forecast` **逐字一致**（`.col-menu` + `.col-menu-hd` + `.col-menu-view`
         + `.col-menu-list` + `.col-menu-reset`），样式已上提全局 ⇒ 两页观感同源。
         位置与限高由 `useColMenu` 按齿轮 `getBoundingClientRect()` 现算（inline top/left/maxHeight），
         所以这层的 DOM 位置不影响布局。 -->
    <div v-if="showColMenu" class="col-menu-overlay" @click="showColMenu = false"></div>
    <div v-if="showColMenu" ref="colMenuEl" class="col-menu" :style="colMenuStyle" @click.stop>
      <div class="col-menu-hd">
        <span>显示列（拖拽排序）</span>
        <button class="col-menu-x" @click="showColMenu = false" title="关闭"><Icon name="close" /></button>
      </div>
      <div class="col-menu-view">
        <label class="basis-toggle">冻结列
          <select v-model="frozenKey" @change="onFreezeChange" aria-label="冻结列">
            <option v-for="o in FREEZE_OPTIONS" :key="o.key" :value="o.key">{{ o.label }}</option>
          </select>
        </label>
      </div>
      <ul class="col-menu-list">
        <template v-for="(k, ci) in colOrder" :key="k">
          <li v-if="colMap[k]"
              :class="{ locked: k === FIXED_FROZEN, hidden: colVis[k] === false }"
              :draggable="k !== FIXED_FROZEN"
              @dragstart="onColDragStart(ci)" @dragover.prevent @drop="onColDrop(ci)">
            <span class="drag">⠿</span>
            <label><input type="checkbox" :checked="colVis[k] !== false" :disabled="k === FIXED_FROZEN"
                          @click.prevent="toggleCol(k)"> {{ colMap[k].label }}</label>
            <!-- v415：自定义字段的改名 / 删除，长在**它自己那一行**里 ——
                 本页没有表头右键菜单，面板是列管理唯一的家（§2.6.1 也不许往工具栏加按钮）。 -->
            <template v-if="colMap[k].custom">
              <input v-if="renameKey === k" :ref="setRenameEl" v-model.trim="renameVal"
                     class="ipl-cm-in" placeholder="字段名称（≤12 字）" maxlength="12"
                     @click.stop @keyup.enter="applyRename(k)" @keyup.esc="cancelRename" />
              <template v-else>
                <button class="ipl-cm-i" title="改字段名（已经填过的值不受影响）"
                        @click.stop="startRename(k)">改名</button>
                <button v-if="canDelCol" class="col-menu-del" title="删除字段（连同所有单据上已填的值）"
                        @click.stop="delField(k)"><Icon name="close" /></button>
              </template>
            </template>
          </li>
        </template>
      </ul>
      <!-- v415（P2-7）自定义字段：新增入口。
           🔴 读定义失败时**不给表单**，只说明原因 —— 判据（名字长度 / 重名 / 配额）全在服务端，
              读不到定义时新增必然失败，让用户在一个注定失败的表单上填东西是不诚实的。
           🔴 「新增字段」与「新增一行列」不是一回事：这里建的是**服务端字段**（有稳定 key、
              所有单据共用、换设备还在），不是往当前表格里插一列本地列。 -->
      <div class="col-menu-add">
        <span class="cm-label"><Icon name="plus" /> 自定义字段</span>
        <span v-if="!defsOk" class="ipl-cm-err" :title="defsErr">
          字段配置没读到，暂时不能新增（{{ defsErr || '原因未知' }}）
        </span>
        <template v-else-if="addOpen">
          <input ref="addEl" v-model.trim="addName" class="ipl-cm-in" maxlength="12"
                 placeholder="字段名称（≤12 字）" @keyup.enter="applyAddField" @keyup.esc="cancelAddField" />
          <select v-model="addType" class="ipl-cm-sel" aria-label="字段类型">
            <option value="text">文本</option>
            <option value="number">数字</option>
          </select>
          <button class="btn btn-xs btn-ghost" :disabled="addBusy" @click="applyAddField">
            {{ addBusy ? '提交中…' : '确认' }}
          </button>
          <button class="btn btn-xs btn-ghost" @click="cancelAddField">取消</button>
        </template>
        <button v-else-if="canAddCol" class="btn btn-xs btn-ghost" @click="startAddField">新增字段</button>
        <span v-else class="ipl-cm-err">当前账号没有新增字段的权限</span>
      </div>
      <div class="col-menu-reset">
        <button class="btn btn-ghost btn-xs" @click="resetCols">恢复默认</button>
      </div>
    </div>

    <!-- 批量操作的输入/确认浮层（标记内容 / 备注内容 / 危险动作确认） -->
    <div v-if="dlg.open" class="ipl-mask" @click.self="closeDlg">
      <div class="card ipl-dlg">
        <div class="ipl-dlg-hd">{{ dlg.title }}</div>
        <p v-if="dlg.msg" class="ipl-dlg-msg">{{ dlg.msg }}</p>
        <input v-if="dlg.needInput" v-model="dlg.value" class="input"
               :placeholder="dlg.ph" @keyup.enter="runDlg" />
        <div class="ipl-dlg-ft">
          <button class="btn btn-ghost btn-sm" :disabled="dlg.busy" @click="closeDlg">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="dlg.busy" @click="runDlg">
            {{ dlg.busy ? '处理中…' : '确定' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 采购单列表 —— 数据源：`GET /api/psi/purchase-orders`（v403 重塑，对齐舟谱采购订单列表）。
   ------------------------------------------------------------------
   🔴 状态一律走 `psiLabels` 的中文映射，**不许出现 `received`/`draft` 这类英文值**。

   🔴 v403 三处**不能靠前端凑**的地方（都由服务端给）：
     1. 状态页签的计数 = 后端 `counts`。它**忽略状态筛选、保留其它筛选** ——
        前端拿当前页数据数一遍的话，切页签时所有数字会跟着变，页签就没意义了。
     2. 「采购单 / 采购退货单」的排除 = 后端 `exclude_status`。旧做法是
        **先分页再从当页 filter 掉 returned** ⇒ 每页少几行、`total` 对不上、翻页跳记录。
        服务端分页 + 客户端过滤必然错位，排除必须在 SQL 里做。
     3. 底部合计 = 后端 `summary`（对**全部匹配行**求和，不是只算当前页）。

   🔴 `has_items=false`（历史舟谱导入单只落了表头）的行：「订单数量 / 入库金额 / 未结款」
      是**真没有数据**，显示 `—` 而不是 `0` —— 后者会被读成「入库了 0 元、一分没欠」，
      是把「不知道」伪装成「是 0」。但「已结款」不躲：`paid_amount` 是库里的真实值，
      0 就是 0，藏起来反而会掩盖一笔真实付款。 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { PO_STATUS, PO_SOURCE, PO_SOURCE_OPTIONS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'
import { downloadCsv, localDateStamp } from '../../utils/csv'
/* v408：列设置菜单的开合与定位走**唯一实现**（UI-SPEC §2.6.1「三、」）。
   本页与 `/forecast` 同属齿轮宿主白名单（§2.6.1「五、D」）⇒ 共用同一份契约，不另写一份。 */
import { useColMenu } from '../../composables/useColMenu.js'
// v411（P2-4）：列设置云端持久化。此前只在 localStorage ⇒ 换设备 / 清缓存即丢且零提示。
import { useColPrefs } from '../../composables/useColPrefs.js'
/* v415（P2-7）采购单自定义字段。**列清单不再只有上面那张静态表** ——
   用户自建的字段由服务端注册表下发（唯一源 = `server/db/queries/forecast_columns.py`）。
   归一（服务端定义 → 与 `PO_COLS` 逐字同形的列定义）与取值（`r.extra[key]`）抽在
   composable 里，因为**列表页 / 新建页 / 详情页三处都要**用；
   在页面里各抄一份就是"同一条规则抄多份 ⇒ 漏抄那份出错"（本仓一类专项缺陷）。 */
import { usePurchaseCustomFields, extraVal } from '../../composables/purchaseCustomFields.js'

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08）：侧栏「采购单 / 采购退货单」是**同一条 path、不同 query**，
   这里必须读 URL 预置筛选，否则点哪个进去都一样 ⇒ 入口就是假的。
   · `kind=return` → 只看已退货（`status='returned'`）；
   · `kind=order`  → 服务端**排除**已退货（`exclude_status='returned'`）。

   🔴 **必须是 computed + watch，不能在 setup 里取一次常量**（v403 真机探针抓出来的）：
   两个入口共用同一条路由记录 ⇒ 互相切换时 vue-router **复用同一个组件实例**（不会重跑
   `setup`）。写成一次性常量的话，从「采购单」点到「采购退货单」，`kind` 变了而页面纹丝不动
   —— 显示的还是上一批数据，且**零报错**。所以这里用 computed 跟随，并用 watch 重置筛选后重拉。 */
const kind = computed(() => String((route.query && route.query.kind) || ''))
const isReturn = computed(() => kind.value === 'return')
const excludeReturned = computed(() => kind.value === 'order')

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const summary = ref({ order_amount: 0, received_amount: 0, paid_amount: 0, unpaid_amount: 0, count: 0 })
const counts = ref({})
const suppliers = ref([])
const warehouses = ref([])
const creators = ref([])
const departments = ref([])

const limit = ref(20)
const offset = ref(0)
const jumpTo = ref('')
const selected = ref([])
const more = ref(false)
const batchOpen = ref(false)
const lastBatch = ref(null)
const printing = ref(false)
const printOnly = ref(0)
const headChk = ref(null)

const PAGE_SIZES = [20, 50, 100]

/* ══════════════════════════════════════════════════════════════════════════
   列设置（UI-SPEC **§2.6.1「列设置入口与序号列」**）
   ──────────────────────────────────────────────────────────────────────────
   🔴 规范契合点（逐条对应 §2.6.1）：
     「一、」齿轮 = `<button class="col-cfg gear">` + `<Icon name="settings"/>`（线性，**不是** emoji），
            长在**序号列表头**的 `.th-in` 里、是该格**唯一**按钮；⛔ 不放工具栏。
     「二、」序号列 = `.seq-th` / `.seq-cell` / `.seq-num`（样式唯一源在 variables.css），
            取值 `offset + i + 1`（服务端分页 ⇒ 必须跨页连续）；**不在列清单里**（不可隐藏/拖序/删除）。
     「三、」面板 = `.col-menu` + `.col-menu-list` + `.col-menu-reset`，`position:fixed` 且位置与限高
            由 `useColMenu`（共享件）按齿轮 `getBoundingClientRect()` **现算** —— 不写死 top/left。
     「五、D」宿主页白名单 = `/forecast`（v400 基准）＋ `/inventory/purchase`（v408 起）。
   ──────────────────────────────────────────────────────────────────────────
   🔴 为什么列宽写在**这里**而不是 CSS 里：本表 `table-layout:fixed`，宽度权威来源只能是
      `<colgroup>`（`colW()/c.w`）。CSS 里再写一份 `width` 就是**第二个真相来源**，改一处必然漂移。
      左侧冻结区的 sticky 偏移（0 / 36 / 82）也依赖这三个宽度是**硬值**，不能靠内容撑。

   `on` = 默认是否显示。**默认集 = v403 原有的 15 列** ⇒ 改造前后默认观感零变化；
   新增列（数据早已在库，P0-1 是「后端零改动」）默认**收起**，由用户按需勾选 ——
   对应报告「✗ 明确不做」第 2 条：**不硬编码满列**（满列会让表格失去节奏）。
   ══════════════════════════════════════════════════════════════════════════ */
const PO_COLS = [
  // —— v403 已有的 15 列（`on: true` = 默认显示）——
  { key: 'order_no',          label: '单据编号',   w: 130, on: true },
  { key: 'supplier',          label: '供应商',     w: 150, on: true, clip: true },
  { key: 'supplier_category', label: '供应商类别', w: 96,  on: true, clip: true },
  { key: 'qty',               label: '订单数量',   w: 104, on: true, num: true },
  { key: 'warehouse',         label: '仓库',       w: 88,  on: true },
  { key: 'status',            label: '状态',       w: 84,  on: true },
  { key: 'total_amount',      label: '订单金额',   w: 104, on: true, num: true },
  { key: 'received_amount',   label: '入库金额',   w: 104, on: true, num: true },
  { key: 'paid_amount',       label: '已结款',     w: 96,  on: true, num: true },
  { key: 'unpaid',            label: '未结款',     w: 96,  on: true, num: true },
  // —— P1-5（采购退货单列表）退货金额列：数据来自后端 `return_total`（该单对应退货记录的合计）。
  //   🔴 `returnOnly: true` ⇒ 只在「采购退货单」视图出现（普通采购单没有退货金额概念，
  //      强行显示只会造成满屏 ¥0.00 的假象）；`on` 缺省收起，由 visibleCols 强制在退货视图显示。
  { key: 'return_amount',     label: '退货金额',   w: 104, num: true, returnOnly: true },
  { key: 'audit_time',        label: '审核时间',   w: 108, on: true },
  { key: 'order_date',        label: '单据日期',   w: 108, on: true },
  { key: 'creator_name',      label: '创建人',     w: 84,  on: true },
  { key: 'note',              label: '备注',       w: 150, on: true, clip: true },
  { key: 'print_count',       label: '打印数',     w: 64,  on: true, num: true },
  // —— v408 新增 4 列：数据**早已在库**（`source`/`created_at`/`expected_date`/`mark`），
  //    列表接口 `SELECT po.*` 已回 ⇒ **后端零改动**。默认收起（`on` 缺省 = false），用户自选。
  { key: 'source',            label: '单据来源',   w: 90 },
  { key: 'created_at',        label: '创建时间',   w: 108 },
  { key: 'expected_date',     label: '预计到货',   w: 108 },
  { key: 'mark',              label: '标记',       w: 90,  clip: true },
  // —— v408（P1-7）再补 2 列：入库时间 / 审核人 ——
  //    ⚠️ 两者**都不是**「后端零改动」：
  //      · `received_at`（P0-6 加的列）`SELECT po.*` 已带 ⇒ 这列本身后端零改动；
  //      · `auditor_name` 是**端点层解析出来的**（库里只存 `auditor_id`），且 `auditor_id`
  //        是 P1-7 才加的列 + 两个 approve 调用方才开始传人 ⇒ **前端依赖后端本次改动**。
  //    ⚠️ 因此老后端（未部署 P1-7）上这两列**恒为 `—`** —— 这是可降级的，不是崩溃：
  //       `colText` 对缺值一律返回 `''`，界面显示 `—`（本仓铁律：**「没有」≠「是零」**）。
  //    默认收起：沿用本文件既定规则（新增列默认收起，不硬编码满列）。
  { key: 'received_at',       label: '入库时间',   w: 108 },
  { key: 'auditor_name',      label: '审核人',     w: 84 },
  // —— v410（P2-3）再补 4 列：最后操作人/时间、最后打印人/时间 ——
  //    ⚠️ **全部依赖本次后端改动**（不像 v408 那 4 列是「后端零改动」）：
  //      · `last_op_at` / `last_print_at` 是 v410 新加的列；
  //      · `last_op_name` / `last_print_name` 是端点层现解析出来的（库里只存 id）。
  //    ⇒ 老后端（未部署 v410）上这四列**恒为 `—`**。这是**可降级**的，不是崩溃：
  //      `colText` 对缺值一律返回 `''`，界面显示 `—`（本仓铁律：**「没有」≠「是零」**，
  //      不许显示 `0` 也不许显示当前时间充数）。
  //    🔴 为什么「最后打印」与「打印数」是两列而不是合并：打印数只答「打过几次」，
  //      答不出「谁打的、什么时候打的」—— 老板真正要的是后者（"小李到底打没打"）。
  //    默认收起：沿用本文件既定规则（新增列默认收起，不硬编码满列）。
  { key: 'last_op_at',        label: '最后操作时间', w: 108 },
  { key: 'last_op_name',      label: '最后操作人',   w: 96 },
  { key: 'last_print_at',     label: '最后打印时间', w: 108 },
  { key: 'last_print_name',   label: '最后打印人',   w: 96 },
]
const COL_STORAGE_KEY = 'hergent_purchase_cols_v1'

/* ══ v415（P2-7）自定义字段：列清单 = 静态 21 列 ＋ 服务端下发的自定义列 ══════════
   🔴 「字段的定义」权威在**服务端**（`db/queries/forecast_columns.py`，采购单作用域）。
      前端不造 key、不存定义、也不在本地留一份"哪些字段存在"的判据 ——
      本地造 key（`cust_xxx`）只活在这台浏览器，服务端引用不到，换设备后这一列连同
      它上面的数据一起消失（报单矩阵 v161 之前就是这个行为）。
   🔴 归一后的自定义列与 `PO_COLS` 的项**逐字同形**（`{key,label,w,num,clip,custom}`）
      ⇒ 下面所有"列"的判断（可见性 / 顺序 / 宽度 / 取值 / 导出）**不需要为自定义列分叉**。
      唯一的差别是 `custom:true`（面板里可改名 / 可删）与 `on:false`（默认收起）。
   ⚠️ 读定义失败时 `defsOk=false`：已渲染的列**不清空**（降级但可用），
      但「新增字段」入口会**藏起来并说明原因** —— 判据是服务端的，读不到就不能让用户
      在一个必然失败的表单上填东西（fail-closed）。
   ══════════════════════════════════════════════════════════════════════════ */
const {
  defs: customDefs, ok: defsOk, err: defsErr,
  loadDefs, addField, renameField, removeField,
} = usePurchaseCustomFields()
/** 全部列（静态在前、自定义在后）。**列的一切判断都走它**，不再直接读 `PO_COLS`。 */
const ALL_COLS = computed(() => PO_COLS.concat(customDefs.value))
const colMap = computed(() => Object.fromEntries(ALL_COLS.value.map(c => [c.key, c])))
/** 新增字段 = `inventory` 模块的 create；删字段会**连带清掉**所有单据上的值 ⇒ 用 delete 轴。 */
const canAddCol = computed(() => canDo('inventory', 'create'))
const canDelCol = computed(() => canDo('inventory', 'delete'))

/* 左侧**固定冻结区**（§2.6.1「二、」的冻结约定 + Forecast 的「固定列强制归位」）：
   复选框列 → 序号列 → 单据编号列。三者恒可见、恒冻结，偏移是硬值。
   ⛔ 单据编号不可隐藏：藏了它这张表就只剩金额，无法定位单据（行操作「打印 / 复制」也随之失去锚点）。 */
const CHK_W = 36
const SEQ_W = 46
const OP_W = 96
const FIXED_FROZEN = 'order_no'
const LEFT_CHK = 0
const LEFT_SEQ = CHK_W                                  // 36
const LEFT_FROZEN = CHK_W + SEQ_W                       // 82
const LEFT_FROZEN2 = CHK_W + SEQ_W + 130                // 212 = 82 + 单据编号列宽
/** 「冻结列」下拉的可选项 —— 只列语义上值得左侧常驻的列（金额/日期冻结意义不大）。 */
const FREEZE_OPTIONS = [
  { key: 'none', label: '不冻结' },
  { key: 'supplier', label: '供应商' },
  { key: 'supplier_category', label: '供应商类别' },
  { key: 'source', label: '单据来源' },
  { key: 'warehouse', label: '仓库' },
  { key: 'status', label: '状态' },
  { key: 'note', label: '备注' },
]

const { showColMenu, colMenuEl, colMenuStyle, toggleColMenu } = useColMenu()

function defaultColOrder () {
  /* 🔴 自定义列**也要进默认顺序**（追加在末尾）。为什么不省掉这一步：
     `resetCols()` 与 `applySaved()` 都以它为基准重建 `colOrder`，而 `colOrder` 是列设置面板的
     **唯一数据源** —— 漏了自定义列，「恢复默认」会把它们从面板里整片抹掉
     （要等下次进页面重新拉定义才回来，用户读成「我的字段不见了」）。 */
  return PO_COLS.map(c => c.key).concat(customDefs.value.map(c => c.key))
}
function defaultColVis () {
  const v = {}
  // `on === true` 才默认显示（缺省 = 收起）。**未标注的新列自动落在「收起」** ⇒
  // 升级时老用户不会平白多出几列，需自己勾选。
  PO_COLS.forEach(c => { v[c.key] = c.on === true })
  /* v415：自定义列同样**默认收起**（与静态新增列同一条规则，不硬编码满列）。
     ⚠️ 唯一的例外在 `applyAddField()`：用户在面板里**当场新增**的那个字段会立刻可见 ——
        加了却看不见会被读成"没加上"（静默假成功），与"升级时别平白多出几列"不矛盾：
        这是用户刚刚显式要求的列，不是系统塞给他的。 */
  customDefs.value.forEach(c => { v[c.key] = false })
  return v
}
const colOrder = ref(defaultColOrder())
const colVis = ref(defaultColVis())
const frozenKey = ref(FIXED_FROZEN)
const colDragFrom = ref(-1)

/** 可见列（顺序 = 用户拖拽后的顺序；固定列**强制归位**在最左，第二冻结列紧随其后）。 */
const visibleCols = computed(() => {
  const arr = colOrder.value
    // 固定冻结列**永远可见**：localStorage 里若有脏值把它关掉，会连带齿轮的宿主与行操作锚点一起消失
    .filter(k => {
      const c = colMap.value[k]
      if (!c) return false
      // 🔴 `returnOnly` 列（退货金额）只在「采购退货单」视图出现：普通采购单没有退货金额概念。
      if (c.returnOnly) return isReturn.value
      return k === FIXED_FROZEN || colVis.value[k] !== false
    })
    .map(k => colMap.value[k])
  const head = arr.filter(c => c.key === FIXED_FROZEN)
  let rest = arr.filter(c => c.key !== FIXED_FROZEN)
  const fk = frozenKey.value
  if (fk && fk !== 'none') {
    const hit = rest.find(c => c.key === fk)
    // 冻的那列被隐藏了 ⇒ 不冻（否则会在 212px 处留一个空槽，后续列全被挤开）
    if (hit) rest = [hit].concat(rest.filter(c => c.key !== fk))
  }
  return head.concat(rest)
})
/** 是否落在**第二冻结位**（212px）。固定列自带冻结，不参与这条。 */
function isFrz2 (c) { return frozenKey.value !== 'none' && c.key === frozenKey.value && c.key !== FIXED_FROZEN }

/** 只写 localStorage（**不触发云端推送**）—— 云端值落下来时用它回写本地缓存。 */
function _writeLocal () {
  try {
    localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(_colCfg()))
  } catch (e) { /* 隐私模式 / 配额满：列设置退化为「本次会话有效」，不打断列表使用 */ }
}
/** 当前列配置的**整体**（顺序 + 可见性 + 冻结列三者互相约束，必须一起存）。 */
function _colCfg () {
  return { order: colOrder.value, vis: colVis.value, frozen: frozenKey.value }
}
const colPrefs = useColPrefs('purchase', {
  // 云端那份**整体覆盖**本地：不做逐字段合并 —— 合并会产生"顺序来自 A 设备、
  // 可见性来自 B 设备"的第三种状态，两边都没见过它（见 useColPrefs 文件头）。
  // 🔴 与本地**逐字相同**则直接返回：省一次无谓的表格重排。
  apply: (cfg) => {
    if (JSON.stringify(_colCfg()) === JSON.stringify(cfg)) return
    applySaved(cfg)
    _writeLocal()
  },
  snapshot: _colCfg,
})
function persistCols () {
  _writeLocal()
  colPrefs.push(_colCfg())     // 云端（debounce，失败只留痕不打断）
}
/** 把一份存下来的配置应用到界面。`saved` 为 null/非法 ⇒ 回默认。 */
function applySaved (saved) {
  const defOrder = defaultColOrder()
  if (saved && Array.isArray(saved.order) && saved.order.length) {
    const known = saved.order.filter(k => colMap.value[k])
    // 升级后**新登记的列**追加到末尾，并沿用其默认可见性（老用户不会平白多出几列）
    const added = defOrder.filter(k => !known.includes(k))
    colOrder.value = known.concat(added)
    const v = defaultColVis()
    Object.keys(v).forEach(k => {
      if (saved.vis && typeof saved.vis[k] === 'boolean') v[k] = saved.vis[k]
    })
    colVis.value = v
    frozenKey.value = (typeof saved.frozen === 'string' && saved.frozen) ? saved.frozen : FIXED_FROZEN
  } else {
    colOrder.value = defOrder
    colVis.value = defaultColVis()
    frozenKey.value = FIXED_FROZEN
  }
  // 存下来的冻结列可能已不在可选项里（例如列被撤了）⇒ 退回不冻，避免一个永远不生效的下拉
  if (!FREEZE_OPTIONS.some(o => o.key === frozenKey.value)) frozenKey.value = 'none'
  colVis.value[FIXED_FROZEN] = true      // 固定冻结列恒可见（脏值兜底）
}
function loadCols () {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(COL_STORAGE_KEY) || 'null') } catch (e) { saved = null }
  applySaved(saved)
}
loadCols()

function toggleCol (k) {
  if (k === FIXED_FROZEN) return                 // 固定列不参与显隐（勾选框已 disabled）
  colVis.value = { ...colVis.value, [k]: !(colVis.value[k] !== false) }
  persistCols()
}
function onColDragStart (ci) { colDragFrom.value = ci }
function onColDrop (ci) {
  const from = colDragFrom.value
  colDragFrom.value = -1
  if (from < 0 || from === ci) return
  const a = colOrder.value.slice()
  const [moved] = a.splice(from, 1)
  if (!moved) return
  a.splice(ci, 0, moved)
  colOrder.value = a
  persistCols()
}
/** 恢复默认（顺序 + 显隐 + 冻结列）—— 报告 P0-1 的「恢复默认」。 */
function resetCols () {
  colOrder.value = defaultColOrder()
  colVis.value = defaultColVis()
  frozenKey.value = FIXED_FROZEN
  persistCols()
  toast('列设置已恢复默认', 'success')
}
function onFreezeChange () { persistCols() }
function colW (k) { const c = colMap.value[k]; return c ? c.w : 90 }

/* ══ v415（P2-7）自定义字段：定义加载 + 并入列清单 ══════════════════════════════
   🔴 合并必须是**增量的**（只补缺的），不能重跑 `applySaved()` —— 后者会以本地/云端那份
      配置为基准**整片重建** `colOrder`，而此刻用户可能已经拖过列、勾过列 ⇒ 覆盖 = 静默
      丢用户的调整。
   🔴 显隐只给**本地还没有记录**的键补默认（收起）：
      `colVis` 里已有的值代表用户勾过 / 云端下来的，每次进页面覆盖一遍就是静默重置用户选择。
   ══════════════════════════════════════════════════════════════════════════ */
async function loadCustomCols () {
  await loadDefs()
  mergeCustomCols()
}
function mergeCustomCols () {
  const keys = customDefs.value.map(c => c.key)
  if (!keys.length) return
  const have = new Set(colOrder.value)
  const add = keys.filter(k => !have.has(k))
  if (add.length) colOrder.value = colOrder.value.concat(add)
  const vis = { ...colVis.value }
  let changed = false
  keys.forEach(k => { if (!(k in vis)) { vis[k] = false; changed = true } })
  if (changed) colVis.value = vis
}

/* ══ v415（P2-7）字段管理：新增 / 改名 / 删除 ══════════════════════════════════
   入口**只在列设置面板里** —— 面板本来就是"管列"的地方，且 §2.6.1 规定齿轮是列设置的
   唯一入口（不再往工具栏加按钮）。
   🔴 三件事的判据**全在服务端**（名字非空 / ≤12 字 / 不重名 / 类型合法 / 整个租户 30 个上限）：
      这里只把 400 原文照显，**不预判**。前端再写一份"名字太长了"就是第二份实现。
   🔴 为什么有「改名」：没有它，用户填错一个字段名就只能「删除再新建」，而删除会
      **连带清掉所有单据上已填的值**（不可恢复）。后端 `update_column` 本就支持改名，
      前端不给入口 = 那条能力不可达（「写了 ≠ 可达」）。
   ══════════════════════════════════════════════════════════════════════════ */
const addOpen = ref(false)
const addName = ref('')
const addType = ref('text')
const addBusy = ref(false)
const addEl = ref(null)
const renameKey = ref('')
const renameVal = ref('')
const renameEl = ref(null)
/** `:ref` 的函数式用法：v-for 里用字符串 ref 会收成一个数组，靠它精确拿到那**一个**输入框。 */
function setRenameEl (el) { if (el) renameEl.value = el }

function startAddField () {
  addName.value = ''
  addType.value = 'text'
  addOpen.value = true
  nextTick(() => { if (addEl.value) addEl.value.focus() })
}
function cancelAddField () { addOpen.value = false; addName.value = '' }

async function applyAddField () {
  const name = addName.value.trim()
  if (!name) { toast('请填写字段名称', 'warn'); return }
  if (addBusy.value) return
  addBusy.value = true
  try {
    const col = await addField(name, addType.value)
    /* 新字段**立刻可见**并落在列清单末尾 —— 加了却看不见会被读成"没加上"（静默假成功）。
       ⚠️ 列设置面板本来就在屏幕上（用户是从这里点的），新行会连同勾选框一起出现，
          这里把勾选状态一并置真，语义是"你要的列，给你打开"。 */
    colOrder.value = colOrder.value.concat([col.key])
    colVis.value = { ...colVis.value, [col.key]: true }
    persistCols()
    addOpen.value = false
    addName.value = ''
    toast(`已新增字段「${col.label || name}」，可在表格里直接填写`, 'success')
  } catch (e) {
    toast(e.message || '新增字段失败', 'error')
  } finally {
    addBusy.value = false
  }
}

function startRename (k) {
  const c = colMap.value[k]
  if (!c || !c.custom) return
  renameVal.value = c.label || ''
  renameKey.value = k
  nextTick(() => {
    if (renameEl.value) {
      renameEl.value.focus()
      if (renameEl.value.select) renameEl.value.select()
    }
  })
}
function cancelRename () { renameKey.value = ''; renameVal.value = '' }

async function applyRename (k) {
  const name = renameVal.value.trim()
  if (!name) { toast('字段名称不能为空', 'warn'); return }
  try {
    // `renameField` 内部会**重拉定义**（服务端是唯一源）⇒ 这里不本地改写 label，
    // 免得出现"本地那份"和"服务端那份"两个显示名的来源。
    await renameField(k, name)
    cancelRename()
    toast(`已改名为「${name}」（已填的值不受影响）`, 'success')
  } catch (e) {
    // 后端会拒重名 / 超长（400 + 人话），原样显示
    toast(e.message || '改名失败', 'error')
  }
}

/** 删除字段。**必须确认** —— 服务端在同一事务里清掉所有单据上该字段的值，不可恢复。 */
async function delField (k) {
  const c = colMap.value[k]
  if (!c || !c.custom) return
  if (!window.confirm(`删除字段「${c.label}」？\n\n`
    + '所有采购单上这个字段已经填过的值会一并清除，无法恢复。\n'
    + '（只是想改个名字的话，点「改名」。）')) return
  try {
    const r = await removeField(k)
    colOrder.value = colOrder.value.filter(x => x !== k)
    const vis = { ...colVis.value }
    delete vis[k]
    colVis.value = vis
    // 当前页内存里的值也一并摘掉，避免表里那一列还挂着刚被服务端清掉的残影
    rows.value.forEach(row => {
      if (row.extra && typeof row.extra === 'object') delete row.extra[k]
    })
    persistCols()
    /* 🔴 `purged_products` 是 **products 时代的历史键名**，语义 = **被清掉该键的采购单张数**。
       必须如实报出来：「删了字段、N 张单上的值也一起没了」是用户要知道的事；
       静默清掉就是数据损失而不告知。别按字面读成"被清理的商品数"。 */
    const n = Number((r && r.purged_products) || 0)
    toast(n ? `已删除字段「${c.label}」，并清除了 ${n} 张单据上该字段的值`
            : `已删除字段「${c.label}」`, 'success')
  } catch (e) {
    toast(e.message || '删除字段失败', 'error')
  }
}

/** 单元格的**纯文本**取值 —— 导出与表格共用同一套口径，避免「同屏两个说法」。 */
function colText (r, k) {
  /* v415：自定义字段的值住在 `purchase_orders.extra_json`，由列表端点解析成 `r.extra`
     （与商品档案同一个 `load_extra`）。**必须先判这一支** —— 自定义键是服务端随机的
     `p_xxxxxxxx`，不可能在下面的 switch 里逐条列举。
     ⚠️ 缺值 `''` ⇒ 界面显示 `—`；数字 `0` **原样返回 0**（不写成 `''`）——
        本仓铁律：**「没有」≠「是零」**，把 0 当空会谎报"没填"。 */
  const _d = colMap.value[k]
  if (_d && _d.custom) return extraVal(r, k)
  switch (k) {
    case 'order_no': return r.order_no || ('#' + r.id)
    case 'supplier': return r.supplier_name || ''
    case 'supplier_category': return r.supplier_category || ''
    case 'source': return r.source ? textOf(PO_SOURCE, r.source) : ''
    case 'qty': return r.has_items
      ? (Number(r.order_qty || 0) + (r.order_unit ? ' ' + r.order_unit : '')) : ''
    case 'warehouse': return whName(r.warehouse_id) === '—' ? '' : whName(r.warehouse_id)
    case 'status': return textOf(PO_STATUS, r.status)
    case 'total_amount': return Number(r.total_amount || 0)
    case 'received_amount': return r.has_items ? Number(r.received_amount || 0) : ''
    case 'paid_amount': return Number(r.paid_amount || 0)
    case 'unpaid': return r.has_items
      ? Number(r.received_amount || 0) - Number(r.paid_amount || 0) : ''
    case 'audit_time': return (r.audit_time || '').slice(0, 10)
    case 'order_date': return (r.order_date || '').slice(0, 10)
    case 'created_at': return (r.created_at || '').replace('T', ' ').slice(0, 16)
    case 'expected_date': return (r.expected_date || '').slice(0, 10)
    // v408（P1-7）两列。⚠️ 缺值一律 `''` ⇒ 模板显示 `—`（**不**显示 `0` / 「无」）。
    //   · `received_at` 取到分钟（与「创建时间」同口径）：它是**动作时刻**，同一天可能到货多次，
    //     只显示日期等于丢掉「什么时候收完的」这个信息；列宽 108 装得下 16 字符。
    //   · `auditor_name` 是**端点层解析出来的**（库里只存 `auditor_id`），老后端上没有这个键 ⇒ `''`。
    case 'received_at': return (r.received_at || '').replace('T', ' ').slice(0, 16)
    case 'auditor_name': return r.auditor_name || ''
    // v410（P2-3）四列。⚠️ 缺值一律 `''` ⇒ 模板显示 `—`（**不**显示 `0` / 「无」/
    //   「未知用户」）。两个时间列取到**分钟**（与「创建时间 / 入库时间」同口径）：
    //   「最后操作」的价值在于定位到**某一次动作**，只显示日期会丢掉「上午改的还是下午改的」。
    case 'last_op_at': return (r.last_op_at || '').replace('T', ' ').slice(0, 16)
    case 'last_op_name': return r.last_op_name || ''
    case 'last_print_at': return (r.last_print_at || '').replace('T', ' ').slice(0, 16)
    case 'last_print_name': return r.last_print_name || ''
    case 'creator_name': return r.creator_name || ''
    case 'note': return r.note || ''
    case 'print_count': return Number(r.print_count || 0)
    case 'mark': return r.mark || ''
    // P1-5：退货金额（仅退货视图出现）。数据 = 后端 `return_total`（该单对应退货记录合计）。
    case 'return_amount': return isReturn.value ? Number(r.return_total || 0) : ''
  }
  return ''
}
/** 表格里的展示值：**空值一律 `—`**（不把「没有」写成 0 / 空串）。金额格由模板单独处理。 */
function cellVal (r, k) {
  const t = colText(r, k)
  return (t === '' || t === null || t === undefined) ? '—' : t
}
/** 金额格统一走 ¥ 前缀；`has_items=false` 的「入库金额 / 未结款」→ `—`（不要伪造 ¥0.00）。 */
const MONEY_COLS = ['total_amount', 'received_amount', 'paid_amount', 'unpaid', 'return_amount']
function moneyCell (r, k) {
  if ((k === 'received_amount' || k === 'unpaid') && !r.has_items) return '—'
  if (k === 'unpaid') return '¥' + fmtMoney(Number(r.received_amount || 0) - Number(r.paid_amount || 0))
  if (k === 'return_amount') return '¥' + fmtMoney(Number(r.return_total || 0))
  return '¥' + fmtMoney(r[k])
}


/** 筛选初值：退货单入口把状态钉在「已退货」（页签条也因此不渲染）。 */
function baseFilter () {
  return {
    status: isReturn.value ? 'returned' : '', supplier_id: 0, date_from: '', date_to: '',
    keyword: '', warehouse_id: 0, creator: '', only_marked: false,
    /* v408（P1-3）三个新筛选。**默认空 = 不筛**，与后端默认值逐一对应：
       `source`（精确）/ `print_state`（printed|unprinted）/ `product_keyword`（商品名或条码）。 */
    source: '', print_state: '', product_keyword: '',
    /* P1-3 再补四个筛选（部门 / 经办人 / 审核人 / 标记内容）。全部默认空 = 不筛，
       与后端 `purchase_order_list` 的默认值逐一对应：
         · `department_id` 精确匹配部门 id（0 = 不筛）
         · `handler`       精确匹配经办人 id（空 = 不筛）
         · `auditor`       精确匹配审核人 id；`__none__` 哨兵 = 只看「未标注审核人」
         · `mark`          标记内容模糊匹配（含子串） */
    department_id: 0, handler: '', auditor: '', mark: '',
  }
}
const f = ref(baseFilter())

/* 入口切换（采购单 ⇄ 采购退货单）⇒ 筛选归零 + 重拉。 */
watch(kind, () => { f.value = baseFilter(); load() })

const canWrite = computed(() => canDo('inventory', 'create'))
const allChecked = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length)
const hasFilter = computed(() => !!(
  f.value.supplier_id || f.value.date_from || f.value.date_to || f.value.keyword ||
  f.value.warehouse_id || f.value.creator || f.value.only_marked ||
  /* v408（P1-3）🔴 三个新筛选**必须**也列进来：`hasFilter` 决定空结果时说
     「还没有采购单」还是「没有符合条件的结果（可清空筛选）」——漏一个就会出现
     「明明筛了商品、页面上说一张单都没有」，用户会以为数据丢了。 */
  f.value.source || f.value.print_state || f.value.product_keyword ||
  /* P1-3 四个新筛选同样必须列进来，理由同上。 */
  f.value.department_id || f.value.handler || f.value.auditor || f.value.mark
))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)

/* 状态页签。顺序 = 业务流：草稿 → 待审批 → 已确认 → 已入库 → 部分入库 → 已退货 → 已取消。
   ⚠️ 每个页签都是**一个真实状态值**（1:1），不发明后端不支持/前端拼出来的复合状态。
   零值也照显（舟谱同样显示 `待审核(0)`）——「这一档现在是空的」本身是信息。 */
const TAB_DEFS = [
  { value: '', text: '全部' },
  { value: 'draft', text: '草稿' },
  { value: 'pending_approval', text: '待审批' },
  { value: 'confirmed', text: '已确认' },
  { value: 'received', text: '已入库' },
  { value: 'partial', text: '部分入库' },
  { value: 'returned', text: '已退货' },
  { value: 'cancelled', text: '已取消' },
]
const tabs = computed(() => {
  if (isReturn.value) return []                   // 退货单入口只有一种状态，页签条没有意义
  return TAB_DEFS
    .filter(t => !(excludeReturned.value && t.value === 'returned'))
    .map(t => ({ ...t, count: t.value ? (counts.value[t.value] || 0) : (counts.value.all || 0) }))
})

/* 批量操作菜单（对齐舟谱「批量操作 ▾」展开后的 7 项）。
   `input` = 需要先填内容；`danger` = 有业务后果，先弹确认。 */
const BATCH_ACTIONS = [
  { op: 'print', text: '单据打印' },
  { op: 'note', text: '添加备注', input: 'note', label: '备注内容', ph: '例如：已催货，周五到' },
  { op: 'mark', text: '单据标记', input: 'mark', label: '标记内容', ph: '例如：加急 / 待对账' },
  { op: 'unmark', text: '删除标记' },
  { op: 'approve', text: '单据审核' },
  { op: 'unapprove', text: '单据反审核' },
  { op: 'cancel', text: '单据取消', danger: true },
]

const whMap = computed(() => {
  const m = {}
  warehouses.value.forEach(w => { m[w.id] = w.name })
  return m
})
function whName (id) { return whMap.value[id] || '—' }

/* ⚠️ 原先这里的 `qtyText` / `moneyOrDash` / `unpaidText` 三个「格内格式化」函数 v408 已删：
   列设置把单元格取值收敛到 `colText`（纯文本，导出复用）＋ `moneyCell`（金额格）两处；
   再留一份页面私有实现就是**第二个真相来源** —— 表格与导出必然漂移。 */
async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const p = { ...f.value, limit: limit.value, offset: offset.value }
    if (excludeReturned.value) p.exclude_status = 'returned'
    const d = await psiApi.listPurchases(p)
    rows.value = d.orders || []
    total.value = Number(d.total || 0)
    counts.value = d.counts || {}
    summary.value = d.summary || {}
    selected.value = []          // 换页/换筛选 ⇒ 选择作废（否则会对着看不见的行做批量操作）
    lastBatch.value = null
  } catch (e) {
    err.value = e.message || '采购单读取失败'
  } finally {
    loading.value = false
    await nextTick()
    syncHead()
  }
}

async function loadBase () {
  try {
    const refs = await psiApi.refs('warehouses,suppliers,users,departments', '', 200)
    warehouses.value = refs.warehouses || []
    suppliers.value = refs.suppliers || []
    /* 🔴 创建人下拉的选项必须来自**后端主库 users**（`operator_id` 存的就是用户 id）。
       拿员工档案顶替是错的 —— `users` 与 `hr_employees` 是**两套编号**（实测
       users id=2 是张俊峰、hr_employees id=2 是王老板，id=7 才是张俊峰）⇒ 同一个 id
       会显示成另一个人，选出来的归属是错的却零报错。后端读不到主库时**不返回 `users` 键**，
       这里保持空数组 ⇒ 页面把这一项藏起来（比放一个假下拉诚实）。 */
    creators.value = Array.isArray(refs.users) ? refs.users : []
    // P1-3：部门下拉。后端 `get_departments()` 自带 `is_active=1` ⇒ 只列在用的部门。
    departments.value = Array.isArray(refs.departments) ? refs.departments : []
  } catch (e) {
    // 基础资料拉不到不阻塞列表 —— 但要说出来，不静默
    toast(e.message || '基础资料读取失败', 'error')
  }
}

function resetFilter () { f.value = baseFilter(); load() }
function pickTab (v) { f.value.status = v; load() }
function goNew () {
  router.push(isReturn.value ? '/inventory/purchase/new?kind=return' : '/inventory/purchase/new')
}
function go (p) { router.push(p) }

function goPage (p) {
  const n = Math.min(Math.max(1, p), pageCount.value)
  offset.value = (n - 1) * limit.value
  load(false)
}
function doJump () {
  const n = parseInt(jumpTo.value, 10)
  jumpTo.value = ''
  if (!Number.isFinite(n)) return
  goPage(n)
}

/* ---- 选择 ---- */
function selectAll () { selected.value = rows.value.map(r => r.id) }
function invertSel () {
  const s = new Set(selected.value)
  selected.value = rows.value.map(r => r.id).filter(id => !s.has(id))
}
function toggleAll (e) { selected.value = e.target.checked ? rows.value.map(r => r.id) : [] }
/* 表头复选框的「部分选中」态只能通过 DOM 属性表达（无对应 HTML 属性），
   漏了它会出现「3 选 1 但表头看着像是全选」的误读。 */
function syncHead () {
  if (headChk.value) {
    headChk.value.indeterminate = selected.value.length > 0 && selected.value.length < rows.value.length
  }
}
watch(selected, syncHead, { deep: true })

/* ---- 批量操作 ---- */
const dlg = ref({ open: false, title: '', msg: '', needInput: false, ph: '', value: '', busy: false, action: null })

function toggleBatch () {
  if (!canWrite.value) return
  batchOpen.value = !batchOpen.value
}
function pickBatch (a) {
  batchOpen.value = false
  if (!selected.value.length) { toast('请先勾选要操作的单据', 'warn'); return }
  if (a.input) {
    dlg.value = { open: true, title: `${a.text}（${selected.value.length} 张）`, msg: '',
      needInput: true, ph: a.ph, value: '', busy: false, action: () => runBatch(a.op, { [a.input]: dlg.value.value }) }
    return
  }
  if (a.danger) {
    dlg.value = { open: true, title: `确认${a.text}？`, msg: `将${a.text}已勾选的 ${selected.value.length} 张单据。已入库的单据不会被取消，需要走退货单。`,
      needInput: false, ph: '', value: '', busy: false, action: () => runBatch(a.op, {}) }
    return
  }
  runBatch(a.op, {})
}
function closeDlg () { if (!dlg.value.busy) dlg.value.open = false }
async function runDlg () {
  const fn = dlg.value.action
  if (!fn) return
  dlg.value.busy = true
  try { await fn() } finally { dlg.value.busy = false }
}

async function runBatch (op, extra) {
  const ids = [...selected.value]
  if (!ids.length) { toast('请先勾选要操作的单据', 'warn'); return }
  try {
    const d = await psiApi.batchPurchases(op, ids, extra)
    const fails = (d.results || []).filter(x => !x.ok)
    lastBatch.value = { op_label: d.op_label || op, ok_count: Number(d.ok_count || 0),
      fail_count: Number(d.fail_count || 0), fails }
    dlg.value.open = false
    if (d.fail_count) {
      toast(`${d.op_label}：成功 ${d.ok_count} 张，失败 ${d.fail_count} 张 —— 失败原因见列表上方`, 'warn')
    } else {
      toast(`${d.op_label}完成：${d.ok_count} 张`, 'success')
    }
    await load(false)             // 状态/标记/备注都变了，重拉当前页（计数与合计一并更新）
  } catch (e) {
    toast(e.message || '批量操作失败', 'error')
  }
}

/* ---- 打印（只记数 + 浏览器打印）----
   🔴 「打印数」必须落库：只在前端打印不记数的话刷新就归 0，那一列等于假的。
      真正的打印由 `window.print()` 完成，这里只负责把计数更新到最新值。 */
async function bumpPrint (ids) {
  try {
    const d = await psiApi.batchPurchases('print', ids)
    const c = (d && d.counts) || {}
    rows.value.forEach(r => {
      const v = c[r.id]
      if (v !== undefined && v !== null) r.print_count = v
    })
  } catch (e) {
    toast(e.message || '打印计数未记录', 'error')
  }
}
async function doPrint () {
  const ids = selected.value.length ? [...selected.value] : rows.value.map(r => r.id)
  if (!ids.length) return
  await bumpPrint(ids)
  printOnly.value = 0
  await nextTick()
  window.print()
}
async function rowPrint (r) {
  if (printing.value) return
  printing.value = true
  try {
    await bumpPrint([r.id])
    printOnly.value = r.id
    await nextTick()
    window.print()
    setTimeout(() => { printOnly.value = 0 }, 800)
  } finally {
    printing.value = false
  }
}
function rowCopy (r) { router.push(`/inventory/purchase/new?copy=${r.id}`) }

/* ---- 导出（当前勾选，未勾选则导出当前页）----
   🔴 v408：导出**跟随列设置**（顺序 + 显隐）—— 表里看到什么就导出什么。
      写死一份固定列会出现「表里没有的列被导出」与「表里有的列导不出」两个说法，
      而「同屏两个说法互相打脸」正是本仓一类专项缺陷。取值一律走 `colText`（唯一口径）。
   🔴 v408（P1-5）：CSV 的转义 / BOM / 文件名日期戳**上提到 `utils/csv.js`** ——
      详情页这一轮也要导出，规则留在页面里就变成两份（漏抄那份会静默输出乱码）。
      顺带修掉一个真问题：原先文件名用 `toISOString()`（**UTC**）⇒ 北京时间凌晨 0–8 点
      导出的文件标的是**前一天**，用户按文件名归档会以为导错了。改用 `localDateStamp()`。 */
function doExport () {
  const list = selected.value.length
    ? rows.value.filter(r => selected.value.includes(r.id))
    : rows.value
  if (!list.length) return
  const cols = visibleCols.value
  if (!cols.length) { toast('当前没有可导出的列，请先在列设置里勾选', 'warn'); return }
  const head = cols.map(c => c.label)
  const body = list.map(r => cols.map(c => colText(r, c.key)))
  downloadCsv(`采购单-${localDateStamp()}.csv`, [head, ...body])
}

/* 分页器的页码窗（当前页居中，最多 7 个） */
const pageNums = computed(() => {
  const n = pageCount.value, cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  let s = Math.max(1, cur - 3)
  s = Math.min(s, n - 6)
  return Array.from({ length: 7 }, (_, i) => s + i)
})

function onDocClick () { batchOpen.value = false }
onMounted(async () => {
  document.addEventListener('click', onDocClick)
  /* 🔴 v415：**先**拉自定义字段定义，**再**同步云端列配置。
     反过来的话会有一条静默的丢列路径：`applySaved()` 以"已知列"过滤云端那份顺序，
     而此刻 `colMap` 里还没有自定义键 ⇒ 它们在 `known` 里被滤掉，只能作为"新增列"补到
     末尾（顺序丢了，且不会报错）。先拿定义，云端那份的顺序就被完整认下来。 */
  await loadCustomCols()
  // v411：云端列配置优先。**刻意不 await** —— 列设置的同步不该拖慢列表首屏；
  // 本地那份已经在 `loadCols()` 里应用过了，云端到了再覆盖（覆盖时列顺序会闪一次，
  // 但换来的是"换设备也一致"）。
  colPrefs.syncFromCloud()
  await loadBase()
  await load()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.inv-page { display: block }
.ipl-acts { display: flex; gap: 8px; flex-wrap: wrap }

/* 筛选 */
.ipl-filter { margin-bottom: 12px }
.ipl-frow { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap }
.ipl-frow-sub { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-subtle) }
.ipl-f { display: flex; flex-direction: column; gap: 4px }
.ipl-lb { font-size: 12px; color: var(--t3) }
.ipl-f-kw { min-width: 220px }
.ipl-kw { height: 32px }
.ipl-sel { min-width: 150px; height: 32px }
.ipl-date { height: 32px }
.ipl-fbtns { display: flex; align-items: center; gap: 8px; margin-left: auto }
.ipl-chk-mark { align-self: flex-end; height: 32px; margin-left: auto }

/* 「更多选项 / 批量操作」的下拉箭头（无 chevron 图标，用 CSS 三角） */
.ipl-caret {
  width: 0; height: 0; margin-left: 2px;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor; transition: transform .15s;
}
.ipl-caret.up { transform: rotate(180deg) }

/* 状态页签：复用全局 .main-tabs / .main-tab，这里只加计数小胶囊 */
.ipl-tabs { flex-wrap: wrap }
.ipl-tabn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 17px; padding: 0 5px; margin-left: 6px;
  border-radius: 9px; background: var(--bg4); color: var(--t2);
  font-size: 11px; font-weight: 600; line-height: 1;
}
.main-tab.on .ipl-tabn { background: var(--p-bg); color: var(--p-ink) }

/* 工具栏 */
.ipl-tb {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin: 0 0 12px;
}
.ipl-tb-l, .ipl-tb-r { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap }
.ipl-selinfo { font-size: 12px; color: var(--t2) }
.ipl-selinfo b { color: var(--p-ink); font-variant-numeric: tabular-nums }
.ipl-mw { position: relative }
.ipl-menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: var(--z-dropdown);
  min-width: 150px; padding: 4px;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipl-mi {
  display: block; width: 100%; padding: 8px 12px; border: none; background: none;
  border-radius: var(--radius-sm); text-align: left; font-size: 13px; color: var(--t1);
}
.ipl-mi:hover { background: var(--bg2) }
.ipl-mi.danger { color: var(--danger-txt) }
.ipl-mi.danger:hover { background: var(--danger-bg) }

.ipl-link {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer;
}
.ipl-link:hover { text-decoration: underline }
.ipl-link.strong { font-weight: 500; font-variant-numeric: tabular-nums }
.ipl-link:disabled { color: var(--t3); cursor: default; text-decoration: none }
.ipl-c-op .ipl-link + .ipl-link { margin-left: 10px }

/* 批量结果条 */
.ipl-result {
  display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
  margin: 0 0 12px; padding: 10px 14px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--suc);
  border-radius: var(--radius-md); background: var(--bg2); font-size: 13px;
}
.ipl-result.warn { border-left-color: var(--war) }
.ipl-rsum b { font-variant-numeric: tabular-nums }
.ipl-rsum .dan, .ipl-rlist { color: var(--danger-txt) }
.ipl-rlist { margin: 0; padding-left: 18px; width: 100% }
.ipl-result .ipl-link { margin-left: auto }

/* 表格
   🔴 v408：列宽**不再写在这里** —— 本表 `table-layout:fixed`，宽度权威来源是模板里的
      `<colgroup>`（见脚本「列设置」段）。原先每个 `.ipl-c-*` 各写一份 `width`，与 colgroup
      并存就是**第二个真相来源**（改一处必然漂移），且内容一撑就会把列撑宽、错开冻结偏移。
      这里只留**排版语义**（对齐 / 裁剪）。 */
.ipl-card { padding: 0; overflow: hidden }
.ipl-tbl { min-width: 1700px; table-layout: fixed }
/* fixed 布局下声明宽度即硬值 ⇒ 内容超出只能裁，不让任何一格把列撑宽 */
.ipl-tbl th, .ipl-tbl td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipl-clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipl-c-chk { text-align: center }
.ipl-c-op { text-align: right }
.ipl-tbl td.num { font-variant-numeric: tabular-nums }

/* ---- 左侧冻结区（UI-SPEC §2.6.1「二、」的冻结约定）----
   偏移是**硬值**：复选框 0 / 序号 36 / 固定冻结列（单据编号）82 / 第二冻结列 212。
   表头 z-index **必须高于**表体，否则横滚过来的普通表头会盖住冻结表头。 */
.ipl-frz-chk   { position: sticky; left: 0;     z-index: 6 }
.ipl-frz-seq   { position: sticky; left: 36px;  z-index: 6 }
.ipl-frz-key   { position: sticky; left: 82px;  z-index: 6 }
.ipl-frz-x     { position: sticky; left: 212px; z-index: 6 }
.ipl-frz-span2 { position: sticky; left: 0;     z-index: 6 }
.ipl-tbl thead th.ipl-frz-chk, .ipl-tbl thead th.ipl-frz-seq,
.ipl-tbl thead th.ipl-frz-key, .ipl-tbl thead th.ipl-frz-x { z-index: 9 }
/* 表体冻结格必须有**自己的底色**（`td` 本身透明 ⇒ 滚过去的内容会从底下透出来）。
   三种态各自覆盖：常态 `--bg` / 行 hover `--bg2` / 已勾选 `--p-bg`。 */
.ipl-tbl tbody td.ipl-frz-chk, .ipl-tbl tbody td.ipl-frz-seq,
.ipl-tbl tbody td.ipl-frz-key, .ipl-tbl tbody td.ipl-frz-x { background: var(--bg) }
.ipl-tbl tbody tr:hover td.ipl-frz-chk, .ipl-tbl tbody tr:hover td.ipl-frz-seq,
.ipl-tbl tbody tr:hover td.ipl-frz-key, .ipl-tbl tbody tr:hover td.ipl-frz-x { background: var(--bg2) }
.ipl-tbl tbody tr.ipl-on td.ipl-frz-chk, .ipl-tbl tbody tr.ipl-on td.ipl-frz-seq,
.ipl-tbl tbody tr.ipl-on td.ipl-frz-key, .ipl-tbl tbody tr.ipl-on td.ipl-frz-x { background: var(--p-bg) }
/* 合计行在最底层叠里，取 7（低于表头的 9、高于普通格） */
.ipl-tbl tfoot td.ipl-frz-span2, .ipl-tbl tfoot td.ipl-frz-key,
.ipl-tbl tfoot td.ipl-frz-x { z-index: 7 }

.ipl-on { background: var(--p-bg) }
.ipl-mark { display: inline-flex; margin-left: 4px; color: var(--war); vertical-align: middle }

.ipl-tbl tfoot td {
  padding: 10px 14px; background: var(--bg2); font-weight: 600;
  border-top: 1px solid var(--bd); font-variant-numeric: tabular-nums;
}
.ipl-ft-lb { text-align: center; color: var(--t1) }
.ipl-ft-num { color: var(--t1) }

/* ══ v415（P2-7）列设置面板里的「自定义字段」块 ══════════════════════════════
   外壳 `.col-menu-add` / `.col-menu-del` / `.cm-label` 是**全局层已有**的件
   （`variables.css`，与 `/forecast` 面板同源）⇒ 直接复用，不另抄一份定位。
   这里只补三样本页独有的小件：行内输入框 / 类型下拉 / 失败说明。
   🔴 不复用 `.col-menu-schemes .scheme-name-ipt`：它被**后代选择器**限定在
      `.col-menu-schemes` 容器内，放到 `.col-menu-add` 里不会生效（引用了会假绿）。 */
.ipl-cm-in {
  flex: 1; min-width: 0; height: 24px; padding: 0 6px; font-size: 12px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1);
}
.ipl-cm-in:focus { border-color: var(--p); outline: 2px solid var(--p); outline-offset: -2px }
.ipl-cm-sel {
  height: 24px; padding: 0 4px; font-size: 12px; flex: none;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1);
}
/* 行内「改名」按钮：比照 `.col-menu-del` 的体量，但**不用**它的红色 hover ——
   改名不是破坏性动作，染红会让人以为改个名也会丢数据。 */
.ipl-cm-i {
  border: none; background: none; color: var(--t3); cursor: pointer;
  font-size: 11px; padding: 1px 4px; border-radius: var(--radius-sm); flex: none;
}
.ipl-cm-i:hover { color: var(--p-dark); background: var(--bg2) }
/* 读定义失败 / 无权限的说明：**必须显式**（藏起来用户会以为这页没有这个功能） */
.ipl-cm-err { font-size: 11px; color: var(--danger-txt); line-height: 1.4; flex-basis: 100% }

/* 分页器（对齐舟谱：共 N 条记录 + 页码 + 每页条数 + 跳至） */
.ipl-pager {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border-top: 1px solid var(--border-subtle);
}
.ipl-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.ipl-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.ipl-pg {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1); font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.ipl-pg:hover:not(:disabled) { border-color: var(--p); color: var(--p-dark) }
.ipl-pg:disabled { opacity: .45; cursor: not-allowed }
.ipl-pg.on { background: var(--p-dark); border-color: var(--p-dark); color: #fff }
.ipl-pg-size { width: auto; height: 28px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-sm) }
.ipl-pg-jump { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t3) }
.ipl-pg-in { width: 52px; height: 28px; padding: 0 6px; text-align: center; border-radius: var(--radius-sm) }

/* 批量操作浮层 */
.ipl-mask {
  position: fixed; inset: 0; z-index: var(--z-modal);
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .35);
}
.ipl-dlg { width: min(400px, 92vw); padding: 18px }
.ipl-dlg-hd { font-size: var(--fs-h4); font-weight: 600; margin-bottom: 10px }
.ipl-dlg-msg { font-size: 13px; color: var(--t2); margin-bottom: 12px }
.ipl-dlg .input { margin-bottom: 14px }
.ipl-dlg-ft { display: flex; justify-content: flex-end; gap: 8px }

/* 打印：只留数据表；单张打印时只留那一行。合计行在打印稿里略去（复选框/操作列被隐藏，
   tfoot 的 colspan 会错位 ⇒ 与其印一行错位的数字，不如不印）。 */
@media print {
  .page-hd, .ipl-filter, .ipl-tabs, .ipl-tb, .ipl-result, .ipl-pager, .ipl-mask,
  .col-menu, .col-menu-overlay { display: none !important }
  .ipl-card { border: none; box-shadow: none }
  .ipl-card .table-wrap { overflow: visible; border: none; border-radius: 0 }
  /* 打印稿一次性摊开 ⇒ 回到 auto 布局按纸张宽度收缩；fixed + colgroup 硬宽会溢出纸面 */
  .ipl-tbl { min-width: 0; width: 100%; table-layout: auto }
  .ipl-c-chk, .ipl-c-op { display: none !important }
  .ipl-tbl tfoot, .ipl-mark { display: none !important }
  /* 冻结是屏幕上的滚动手感；打印时 sticky 只会把几列叠在一起 */
  .ipl-frz-chk, .ipl-frz-seq, .ipl-frz-key, .ipl-frz-x, .ipl-frz-span2 { position: static !important }
  .ipl-tbl.print-one tbody tr:not(.print-target) { display: none !important }
  .ipl-on { background: transparent !important }
}

@media (max-width: 640px) {
  .ipl-frow { align-items: stretch }
  .ipl-f, .ipl-kw, .ipl-sel, .ipl-date { width: 100%; min-width: 0 }
  .ipl-fbtns { margin-left: 0 }
  .ipl-chk-mark { margin-left: 0 }
}
</style>
