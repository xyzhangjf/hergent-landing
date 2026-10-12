<template>
  <div class="inv-page ipd">
    <!-- 页头 -->
    <div class="page-hd split ipd-noprint">
      <!-- v453（R9）页头身份信息压一行：标题 / 单号 / 状态原本换行各占一行（h2 是块级，
           副标题被挤到第二行），页头因此吃掉两行高度。这里把左侧改成 flex 基线横排。 -->
      <div class="ipd-hd-l">
        <h2>采购单详情</h2>
        <span class="page-sub">
          {{ o.order_no || ('#' + oid) }}
          <span v-if="o.status" class="tag" :class="tagOf(PO_STATUS, o.status)">{{ textOf(PO_STATUS, o.status) }}</span>
        </span>
      </div>
      <div class="ipd-acts">
        <!-- v452：动作区对齐舟谱口径收敛为「主路径 + 更多 ▾」。
             主路径只留日常必然用到的：返回 / 编辑 / 导出 / 打印组 / 审核组 / 分批到货 / 确认入库；
             「上一条下一条 / 复制 / 转单为 / 查看日志 / 附件」收进本块末尾的「更多 ▾」。
             🔴 上一条 / 下一条**没有删**：它搬了家（更多菜单的「相邻单据」区），
                口径仍逐字是「全部采购单按 id 倒序」，见那个菜单项里的副标题。 -->
        <button class="btn btn-ghost btn-sm" @click="back">返回列表</button>
        <!-- P1-4 独立编辑入口：仅对「尚未入库」的单（草稿 / 待审批 / 已取消）开放。
             ⚠️ 已确认 / 已入库 / 部分入库 / 已退货的单库存与应付已落账，走「编辑」会改已发生的事实
             ⇒ 这里不放按钮（这类单请用「转单为 → 采购退货」）。与后端 `purchase_order_update` 的闸门一致。 -->
        <button v-if="canWrite && canEdit" class="btn btn-ghost btn-sm" :disabled="busy" @click="doEdit">
          <Icon name="edit" :size="14" />编辑
        </button>
        <!-- v408（P1-5）导出明细 CSV。与列表页导出共用 `utils/csv.js`（转义 / BOM / 日期戳
             只此一份）。列与下面那张明细表**同序**（v452：含屏幕默认隐藏的批次/到期 ——
             导出是全量数据场景，屏幕默认值不决定导出行）。 -->
        <button class="btn btn-ghost btn-sm" @click="doExport">
          <Icon name="download" :size="14" />导出
        </button>
        <!-- v453（R6）附件**提回主路径**：原来只有「更多 ▾」菜单里那一项，上传要两步。
             🔴 用**图标按钮**不带文字（遵守「不在主工具栏加文字按钮」的纪律），
                有附件时右上角带数字角标 —— 不用点开菜单也知道这张单有没有附件。 -->
        <button class="btn btn-ghost btn-sm ipd-icobtn" :disabled="busy"
                title="附件（上传 / 管理）" @click="openAttach">
          <Icon name="paperclip" :size="14" />
          <span v-if="attachCount" class="ipd-icobadge">{{ attachCount }}</span>
        </button>
        <!-- v408（P1-4）「打印设置」。
             🔴 为什么做成**菜单**而不是再排两个按钮：动作区已有 6 个按钮，再平铺两个
                （打印 / 直接打印）会让人分不清区别；收进主按钮右侧的小箭头里，
                主按钮仍是「一按就打印」的默认路径（不改老习惯）。
             ⚠️ **没有「选择模板」这一项**：系统里没有打印模板实体（也没有模板表），
                给了就是假功能。等有了模板表再加，这一栏已经留好位置。
             ⚠️ `@click.stop` 必须留着：外层有 document 点击关闭监听，不 stop 的话
                点菜单内部会先把菜单关掉（看起来像"点了没反应"）。 -->
        <div class="ipd-pm" @click.stop>
          <button class="btn btn-ghost btn-sm ipd-pm-main" :disabled="busy" @click="doPrint(true)">
            <Icon name="print" :size="14" />打印
          </button>
          <button class="btn btn-ghost btn-sm ipd-pm-caret" :class="{ on: printOpen }" :disabled="busy"
                  title="打印设置" @click="printOpen = !printOpen">
            <span class="ipd-pm-tri" :class="{ up: printOpen }"></span>
          </button>
          <!-- v452：打印次数从动作区搬进菜单标题行 —— 它是**读数**不是**动作**，
               常驻动作区只会挤占主路径；放进菜单既不丢信息，也不占黄金位。 -->
          <div v-if="printOpen" class="ipd-pm-menu">
            <div class="ipd-pm-hd">打印设置 · 已打印 {{ printCount }} 次</div>
            <button class="ipd-mi" @click="doPrint(true)">
              打印并计数<span class="ipd-mi-n">次数 +1（判断「打没打给供应商」靠它）</span>
            </button>
            <button class="ipd-mi" @click="doPrint(false)">
              直接打印<span class="ipd-mi-n">重打 / 补打用，不计入打印数</span>
            </button>
            <button class="ipd-mi" @click="refreshPrintCount">
              刷新打印次数<span class="ipd-mi-n">从服务器重取（别人打印过时本页会过期）</span>
            </button>
          </div>
        </div>
        <!-- v452：查看日志 / 附件 已收进下方「更多 ▾」（不是删功能）。 -->
        <!-- v412（P2-5）审核动作组：主按钮「审核并打印」＋ 小箭头里的「审核并入库」。
             🔴 `v-if` 判据与后端 `purchase_order_approve` 的 `WHERE status IN (...)`
                **逐字对齐**：后端认的三种状态这里都能点，后端不认的（已入库 / 部分入库 /
                已取消）这里不出现 —— 省掉「点了才知道不行」那一轮。
             🔴 为什么把两个动作收进**一个下拉**而不是平铺两个按钮：动作区本来已有 8 个控件
                （上下条 / 返回 / 复制 / 导出 / 打印组 / 日志 / 附件 / 到货 / 入库），再平铺
                会挤成两行；而「审核并入库」是**低频且危险**的那个（货没到就点会虚增库存）
                ⇒ 收进箭头，主按钮留给日常路径（审核完打给供应商）。
                这里复用打印组那套 `.ipd-pm*` 样式，**不新写一份定位**（§8 同选择器 ≥3 次才上提，
                这两处是同一定位范式的两个实例，先复用类）。 -->
        <div v-if="canWrite && canAudit" class="ipd-pm" @click.stop>
          <button class="btn btn-ghost btn-sm ipd-pm-main" :disabled="busy" @click="doApprovePrint">
            <Icon name="audit" :size="14" />审核并打印
          </button>
          <button class="btn btn-ghost btn-sm ipd-pm-caret" :class="{ on: auditOpen }" :disabled="busy"
                  title="更多审核方式" @click="auditOpen = !auditOpen">
            <span class="ipd-pm-tri" :class="{ up: auditOpen }"></span>
          </button>
          <div v-if="auditOpen" class="ipd-pm-menu">
            <div class="ipd-pm-hd">审核</div>
            <button class="ipd-mi" @click="doApprovePrint">
              审核并打印<span class="ipd-mi-n">审核完直接打印给供应商</span>
            </button>
            <button class="ipd-mi" @click="doApproveReceive">
              审核并入库<span class="ipd-mi-n">审核完接着去确认入库（入库前还要确认一次）</span>
            </button>
          </div>
        </div>
        <button v-if="canWrite && canReceive" class="btn btn-ghost btn-sm" :disabled="busy"
                @click="showRecv = !showRecv">
          <Icon name="inbox" :size="14" />分批到货
        </button>
        <button v-if="canWrite && canConfirm" class="btn btn-primary btn-sm" :disabled="busy" @click="doConfirm">
          <Icon name="check" :size="14" />{{ busy ? '处理中…' : '确认入库' }}
        </button>
        <!-- v452（O1）「更多 ▾」：把低频/辅助动作收进一个菜单，动作区回到一行。
             收录：复制 / 查看日志 / 附件 / 转单为（含两项置灰说明）/ 相邻单据。
             🔴 全部是**原有能力的搬家**，一个都没删 —— 附件角标、转单为的灰显说明、
                相邻单的口径副标题都随功能一起搬（见各项 `ipd-mi-n`）。
             🔴 `@click.stop` 与 `onDocClick` 的配合同打印组：不 stop 的话点菜单内部
                会先被 document 监听关掉（看起来像"点了没反应"）。
             🔴 菜单限高可滚（`.ipd-more-menu`）：9 项 + 4 个分组标题，不设上限会把
                「确认入库」挤出视口。 -->
        <div class="ipd-pm" @click.stop>
          <button class="btn btn-ghost btn-sm ipd-pm-main" @click="moreOpen = !moreOpen">
            <Icon name="bars" :size="14" />更多
          </button>
          <button class="btn btn-ghost btn-sm ipd-pm-caret" :class="{ on: moreOpen }" :disabled="busy"
                  title="更多" @click="moreOpen = !moreOpen">
            <span class="ipd-pm-tri" :class="{ up: moreOpen }"></span>
          </button>
          <div v-if="moreOpen" class="ipd-pm-menu ipd-more-menu">
            <div class="ipd-pm-hd">单据</div>
            <button class="ipd-mi" @click="doCopy">
              复制<span class="ipd-mi-n">照这张单开一张新的</span>
            </button>
            <button class="ipd-mi" @click="openLogsAll()">
              查看日志<span class="ipd-mi-n">建单 / 审核 / 入库 / 付款 / 退货记录</span>
            </button>
            <button class="ipd-mi" @click="openAttach()">
              附件<span class="ipd-mi-n">{{ attachCount ? (attachCount + ' 个，点开管理') : '这张单还没有附件' }}</span>
            </button>
            <div class="ipd-pm-hd">转单为</div>
            <button class="ipd-mi" :disabled="!canTransfer" @click="doTransferReturn">
              采购退货<span class="ipd-mi-n">{{ canTransfer ? '按可退数量生成一张退货单' : transBlockTip }}</span>
            </button>
            <button class="ipd-mi" disabled>
              销售单<span class="ipd-mi-n">采购进货与销售出货之间没有转单关系</span>
            </button>
            <button class="ipd-mi" disabled>
              调拨单<span class="ipd-mi-n">调拨（仓库间移库）还没上线</span>
            </button>
            <!-- 相邻单据：口径逐字保留 v408 那句「全部采购单按 id 倒序」—— 它**不跟随**
                 列表页筛选（详情页可被深链打开，带不全筛选就会"有时跟有时不跟"）。
                 读数取不到时（navErr）标题直接说出来，不让两项灰着让人猜。 -->
            <div class="ipd-pm-hd">相邻单据{{ navErr ? '（读取失败）' : '' }}</div>
            <button class="ipd-mi" :disabled="!nb.has_prev || busy" @click="goNeighbor('prev')">
              上一条<span class="ipd-mi-n">{{ navText || navErr || '更近的一张采购单' }}</span>
            </button>
            <button class="ipd-mi" :disabled="!nb.has_next || busy" @click="goNeighbor('next')">
              下一条<span class="ipd-mi-n">{{ navText || navErr || '更早的一张采购单' }}</span>
            </button>
          </div>
        </div>
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
        <!-- v452（O5）单据信息带：对齐舟谱的「单行 compact bar」。
             原形态是 11 个字段竖排两行的卡片 + 独立金额卡（三层才看到钱）；
             现在主字段一行横排、金额贴在同一行右侧（舟谱把总金额放在信息带右侧），
             次要字段收进「更多信息 ▾」—— 一个都没删，只是换了楼层。
             🔴 保留的两条原纪律：
                ① 「创建人」与「经办人」是两回事（系统事实 vs 业务归属），各自独立显示；
                ② 供应商应付/预付余额取值是 `pay.supplier_payable`（`pay` 本身就是
                    `p.order`，再写一层 `.order` 会恒 undefined ⇒ 永远显示「—」）。 -->
        <div class="ipd-barhd">
          <div class="ipd-bf"><span class="ipd-lb">供应商</span><span class="ipd-bfv">{{ o.supplier_name || '—' }}</span></div>
          <!-- v453（R5）经办人 / 部门 / 仓库 / 单据日期 **就地改**（舟谱同款 ▾ 改）：
               与 备注 / 预计到货 共用同一个「编辑态」开关，一次保存，不用跳编辑页。
               🔴 仓库在**已入库**的单上禁用：货已经进了某个仓，再改单据上的仓库会让
                  「库存实际在哪」与「单据说在哪」分叉，而且不报错 —— 后端同一条闸门。 -->
          <!-- v454（R10）信息带「可编辑字段」标记：对齐舟谱 —— 每个能就地改的字段 label 前带 `*`。
               🔴 只标**真能改**的字段（经办人 / 部门 / 仓库 / 备注）；「供应商」不标 ——
                  本系统改供应商会牵连应付账与结算单，详情页不放开（见 §3.3 不照搬项）。
                  舟谱的 `*` 语义是「必填」，这里是「可改」⇒ 信息带末尾有一句图例把话说清，
                  不让人按舟谱的习惯误读成「不填不让存」。
               🔴 `v-if="canWrite"` 必须带着：无写权限的人看不到铅笔、也改不了，
                  给他们标 `*` 是纯误导。 -->
          <div class="ipd-bf">
            <span class="ipd-lb"><i v-if="canWrite" class="ipd-req" title="本页可直接修改">*</i>经办人</span>
            <template v-if="editHeader">
              <select v-model="editHandler" class="input ipd-edit-sel">
                <option value="">不指定</option>
                <option v-for="u in handlerOpts" :key="u.id" :value="u.id">{{ u.name }}</option>
              </select>
            </template>
            <template v-else><span class="ipd-bfv">{{ o.handler_name || '—' }}</span></template>
          </div>
          <div class="ipd-bf">
            <span class="ipd-lb"><i v-if="canWrite" class="ipd-req" title="本页可直接修改">*</i>部门</span>
            <template v-if="editHeader">
              <select v-model.number="editDepartment" class="input ipd-edit-sel">
                <option :value="0">不指定</option>
                <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
            </template>
            <template v-else><span class="ipd-bfv">{{ o.department_name || '—' }}</span></template>
          </div>
          <div class="ipd-bf">
            <span class="ipd-lb"><i v-if="canWrite" class="ipd-req" title="本页可直接修改">*</i>仓库</span>
            <template v-if="editHeader">
              <select v-model.number="editWarehouse" class="input ipd-edit-sel" :disabled="whLocked"
                      :title="whLocked ? '这张单已经入库，不能改入库仓库（改了库存与单据会对不上）' : '选择入库仓库'">
                <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
            </template>
            <template v-else><span class="ipd-bfv">{{ o.warehouse_name || ('仓库 ' + (o.warehouse_id || '—')) }}</span></template>
          </div>
          <div class="ipd-bf">
            <span class="ipd-lb"><i v-if="canWrite" class="ipd-req" title="本页可直接修改">*</i>备注</span>
            <template v-if="editHeader">
              <input v-model="editNote" class="input ipd-edit-in" maxlength="200" placeholder="选填" />
              <!-- v453（R3）字数计数：`maxlength` 会在 200 字静默截断（不提示、不报错），
                   加一个计数器才看得出「快到顶了」。 -->
              <span class="ipd-edit-count" :class="{ 'ipd-edit-count-max': editNote.length >= 200 }">
                {{ editNote.length }}/200
              </span>
            </template>
            <template v-else>
              <span class="ipd-bfv ipd-bfv-note">{{ o.note || '—' }}</span>
              <button v-if="canWrite" class="ipd-pencil" title="编辑表头字段" @click="startEdit"><Icon name="pencil" :size="13" /></button>
            </template>
          </div>
          <div class="ipd-bf">
            <span class="ipd-lb">单据日期</span>
            <template v-if="editHeader">
              <input type="date" v-model="editOrderDate" class="input ipd-edit-in ipd-edit-in-sm" />
            </template>
            <template v-else><span class="ipd-bfv">{{ (o.order_date || '').slice(0, 10) || '—' }}</span></template>
          </div>
          <!-- v453（R1 配套）预计到货从「更多信息 ▾」搬进信息带：它是**要到货的日子**，
               属于一眼要看到的交期信息，不是次要字段（舟谱信息带里也有交货日期）。 -->
          <div class="ipd-bf">
            <span class="ipd-lb">预计到货</span>
            <template v-if="editHeader">
              <input type="date" v-model="editExpected" class="input ipd-edit-in ipd-edit-in-sm" />
            </template>
            <template v-else><span class="ipd-bfv">{{ o.expected_date || '—' }}</span></template>
          </div>
          <!-- 金额组：本单三项 +（v453 R1）供应商累计两项，中间用竖线分隔。
               三项都真有来源，「预算金额」我们没有这个概念，不造。 -->
          <div class="ipd-bmoney">
            <div class="ipd-bm"><span class="ipd-lb">订单金额</span><b class="ipd-bmv">¥{{ fmtMoney(o.total_amount) }}</b></div>
            <div class="ipd-bm"><span class="ipd-lb">入库金额</span><b class="ipd-bmv">{{ moneyOrDash(o.received_amount, hasItems) }}</b></div>
            <div class="ipd-bm"><span class="ipd-lb">应付金额</span><b class="ipd-bmv">{{ apAmountText }}</b></div>
            <!-- v453（R1）供应商维度余额**常驻**信息带右端（原来收在「更多信息 ▾」里，
                 老板最想看的「还欠这家多少」要展开才见 —— 层级倒挂）。
                 🔴 与本单金额用一条竖线分开，并用弱一档的字色：左边是「这一单」、
                    右边是「这家供应商累计」，两个口径不混读。 -->
            <template v-if="hasSupplierBal">
              <span class="ipd-bm-sep"></span>
              <div class="ipd-bm" title="这家供应商全部单据累计的应付余额（不是本单金额）">
                <span class="ipd-lb">应付余额</span><b class="ipd-bmv ipd-bmv-sub">¥{{ fmtMoney(pay.supplier_payable) }}</b>
              </div>
              <div class="ipd-bm" title="这家供应商全部单据累计的预付余额（不是本单金额）">
                <span class="ipd-lb">预付余额</span><b class="ipd-bmv ipd-bmv-sub">¥{{ fmtMoney(pay.supplier_prepay) }}</b>
              </div>
            </template>
          </div>
        </div>

        <!-- v454（R10）星号图例。舟谱的 `*` 语义是「必填」，这里是「可改」——
             不给图例的话，从舟谱迁过来的用户会以为「不填不让保存」。
             🔴 与信息带分开一行、弱字色，因为它不是数据、是说明；
                打印时隐藏（`ipd-noprint`），纸上不带这句 UI 说明。 -->
        <div v-if="canWrite" class="ipd-reqnote ipd-noprint">
          <i class="ipd-req">*</i>表示该字段可在本页直接修改（其余字段只读）
        </div>

        <!-- v453：编辑态的「保存 / 取消」**常驻在信息带下方**（原来藏在「更多信息 ▾」里）。
             R5 把可改字段搬进信息带后，保存按钮必须跟着在明处，否则改完找不到保存。 -->
        <div v-if="editHeader" class="ipd-edit-actions">
          <button class="btn btn-primary btn-sm" :disabled="saveBusy" @click="saveHeader">保存</button>
          <button class="btn btn-ghost btn-sm" :disabled="saveBusy" @click="cancelEdit">取消</button>
          <span v-if="saveMsg" class="ipd-note" :class="{ 'ipd-err': saveErr }">{{ saveMsg }}</span>
          <span v-if="whLocked" class="ipd-note ipd-edit-lock">这张单已入库，仓库不可改（其余字段仍可改）。</span>
        </div>

        <!-- 更多信息：默认收起。收录原来挤在主卡片里的次要字段 + 补充信息入口。
             🔴 收起态打印时这些字段不出现 —— 单据打印以主信息带为准（舟谱亦然）。 -->
        <div class="ipd-moreinfo ipd-noprint">
          <button class="ipd-moreinfo-tg" @click="moreInfoOpen = !moreInfoOpen">
            更多信息<span class="ipd-moreinfo-tri" :class="{ up: moreInfoOpen }"></span>
          </button>
          <!-- v453：本区只留**真正的次要字段**。搬走的三样（预计到货 → 信息带、
               供应商应付/预付余额 → 信息带右端、保存/取消 → 信息带下方）都是**搬家不是删**，
               见各自新位置的注释。 -->
          <div v-if="moreInfoOpen" class="ipd-moreinfo-body">
            <div v-if="canSeeSupplierCategory" class="ipd-bf"><span class="ipd-lb">供应商类别</span><span class="ipd-bfv">{{ o.supplier_category || '—' }}</span></div>
            <div class="ipd-bf"><span class="ipd-lb">创建人</span><span class="ipd-bfv">{{ o.creator_name || '—' }}</span></div>
            <div class="ipd-bf"><span class="ipd-lb">审核时间</span><span class="ipd-bfv">{{ o.audit_time || '—' }}</span></div>
            <!-- v415（P2-7）补充信息（自定义字段）。**只列有值的** —— 字段可随时加（上限 30 个），
                 全铺出来会淹掉真正要看的。入口仍是行内小链接，不往动作区加按钮。 -->
            <div v-if="cfShow" class="ipd-bf ipd-bf-grow">
              <span class="ipd-lb">
                补充信息
                <button v-if="canWrite" class="ipd-cf-edit" @click="openExtra">
                  {{ cfFilled.length ? '修改' : '填写' }}
                </button>
              </span>
              <span v-if="cfFilled.length" class="ipd-cf-list">
                <span v-for="x in cfFilled" :key="x.key" class="ipd-cf-i">
                  <i>{{ x.label }}</i>{{ x.text }}
                </span>
              </span>
              <span v-else class="ipd-cf-none">未填写</span>
            </div>
            <!-- 字段定义没读到 ⇒ **如实说一句**。不说的话，用户上次建过字段、这次看不见，
                 会读成「我的字段没了」；真相是"没读到"（值还在库里，字段也还在）。 -->
            <div v-else-if="cfLoaded && !cfOk" class="ipd-bf ipd-bf-grow">
              <span class="ipd-lb">补充信息</span>
              <span class="ipd-cf-none" :title="cfErr">字段配置没读到，暂时显示不了</span>
            </div>
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

        <!-- v452（O2/O6/O7）商品明细：**去卡片壳直铺**（舟谱同款密表 —— 卡片 padding 与
             hover 阴影在详情页是纯消耗，首屏一半高度被外壳吃掉）；列序对齐舟谱：
             商品名称 → 条形码 → 单位 → 参考成本价 → 采购价 → 订单数量 → 订单金额 →
             已到货 →（批次号/到期日默认收进列设置）→ 行备注 → 历史。
             🔴 批次号 / 到期日**没有删**：`GOODS_COLS` 里标了 `def:false` ⇒ 默认不占屏幕，
                 要时点表头齿轮打开（云端记住选择）。 -->
        <div class="ipd-plain">
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
                  <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenuGoods" title="列设置"><Icon name="settings" :size="15" /></button></th>
                  <th>商品名称</th>
                  <th v-if="isVisGoods('barcode')">条形码</th>
                  <th>单位</th>
                  <th class="num" v-if="isVisGoods('ref')">参考成本价</th>
                  <th class="num">采购价</th>
                  <th class="num">订单数量</th>
                  <th class="num">订单金额</th>
                  <!-- v452：「已到货」从原第 10 列（到期日之后）前移到订单金额之后 ——
                       舟谱的「入库数量/入库金额」相邻排布，逐行对账时眼睛不用跳列。 -->
                  <th class="num">已到货</th>
                  <!-- v453（R4）入库金额（默认收进列设置，见 GOODS_COLS 注释） -->
                  <th class="num" v-if="isVisGoods('ramt')">入库金额</th>
                  <!-- v454（R12）期望生产日期（默认收进列设置；取值字段待确认，见 GOODS_COLS） -->
                  <th v-if="isVisGoods('epdate')">期望生产日期</th>
                  <th v-if="isVisGoods('batch')">批次号</th>
                  <th v-if="isVisGoods('expiry')">到期日</th>
                  <th v-if="isVisGoods('note')">行备注</th>
                  <!-- v408（P1-6）行历史入口。列宽固定（`ipd-hist-th`），因为按钮本身
                       只有「历史」两个字、宽度恒定。 -->
                  <!-- v454（R11）表头文字对齐舟谱：舟谱这一列叫「操作」（格内是"历史"链接），
                       我方原来直接把列名叫成「历史」。改成「操作」后，列名表达的是
                       「这一列放行级动作」，将来加更多行级动作不用再改列名。
                       ⚠️ 格内按钮文字仍是「历史」—— 动作名没变，只是列名归类。 -->
                  <th class="ipd-hist-th">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in items" :key="it.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <!-- v452（O6）：商品名双行 —— 名称 + 规格小字（舟谱把规格并进商品名，
                       如「每日鲜酷酪…100*8杯（新）」）。独立「规格」列随之删除：
                       它与单位列的换算小字说的是同一句话（「1箱=12提」出现两遍），
                       是双列噪音；规格值一个都没丢（本行小字 + CSV 导出列都在）。 -->
                  <!-- v453（R2）：规格改成**同行内联小字**（原来是 `display:block` 独占第二行）。
                       舟谱把规格并进商品名（「…100*8杯（新）」）就是单行；两行写法让每行多占
                       一行高度，同屏能看的行数直接少一半。外面套一个 `ipd-name-line` 做
                       单行截断 —— 名称特别长时不撑破格子，规格小字跟着一起省略。 -->
                  <td class="ipd-c-name">
                    <span class="ipd-name-line">
                      <span class="ipd-gname">{{ it.product_name || ('商品 ' + it.product_id) }}</span>
                      <span v-if="it.spec" class="ipd-spec">{{ it.spec }}</span>
                    </span>
                  </td>
                  <td class="ipd-mono" v-if="isVisGoods('barcode')">{{ it.product_barcode || '—' }}</td>
                  <!-- v409（P2-1）：只读回显所选单位 + **这条进了多少（小单位）**。
                       折小数量只在「所选档不是小档」时出现（是小档时两个数字相同，写出来是噪音）。
                       这列是全表唯一保留「换算说明」的地方（v452 O6 去重后的落点）。 -->
                  <td>
                    {{ it.unit_label || '—' }}
                    <span v-if="it.conv_text" class="ipd-conv" :title="it.conv_text">{{ it.conv_text }}</span>
                  </td>
                  <td class="num" v-if="isVisGoods('ref')">{{ fmtMoney(it.product_purchase_price) }}</td>
                  <td class="num">
                    {{ fmtMoney(it.unit_price) }}
                    <!-- 双单位采购价：折小单位单价（`base_unit_price` 由后端算好下发）。 -->
                    <span v-if="showBasePrice(it)" class="ipd-conv">
                      折 {{ fmtMoney(it.base_unit_price) }} 元/{{ it.base_unit || '小单位' }}
                    </span>
                  </td>
                  <td class="num">
                    <!-- v452（O4）：数量带单位后缀（舟谱「1件」），不用回头看单位列。 -->
                    {{ qtyText(it) }}
                    <span v-if="showBaseQty(it)" class="ipd-conv">= {{ fmtQty(it.base_qty) }} {{ it.base_unit || '小单位' }}</span>
                  </td>
                  <!-- v452（O3）：明细金额格**去掉 ¥ 前缀**（舟谱同款：货币符号只出现在
                       合计行与底部总额条）。一屏少 10+ 处重复符号，金额列更易比大小。 -->
                  <td class="num">{{ fmtMoney(it.amount) }}</td>
                  <td class="num">{{ qtyText(it, 'received_qty') }}</td>
                  <!-- v453（R4）入库金额 = 已到货数量 × 采购价（本行口径，与「订单金额」同一单价）。
                       🔴 无采购价时显示 `—` 而不是算成 0：`0 元` 会被读成「到了货但没花钱」。 -->
                  <td class="num" v-if="isVisGoods('ramt')">{{ recvAmtText(it) }}</td>
                  <!-- v454（R12）期望生产日期。🔴 取值字段未确认（见 GOODS_COLS 的 TODO）——
                       后端没下发时显示 `—`（本仓铁律：缺值不编），**不拿实际生产日期顶替**
                       （两者是"要求"与"事实"两个口径，顶替会让用户以为供应商按约交了货）。 -->
                  <td v-if="isVisGoods('epdate')">{{ it.expected_production_date || '—' }}</td>
                  <td v-if="isVisGoods('batch')">
                    <span v-if="it.batch_no">{{ it.batch_no }}</span>
                    <!-- v452（O8）：「未登记」从黄 tag 改灰色文字 —— 2 行商品 4 个黄块
                         是纯视觉噪音，且"未登记"是状态说明不是警示。 -->
                    <span v-else class="ipd-none">未登记</span>
                  </td>
                  <td v-if="isVisGoods('expiry')">
                    <span v-if="it.expiry_date">{{ it.expiry_date }}</span>
                    <span v-else class="ipd-none">未登记</span>
                  </td>
                  <!-- v408（P1-2）行备注。空则 `—`（不编「无」以外的任何词）—— 绝大多数
                       存量行都没填过，写"无备注"会让人以为系统里有这个值。 -->
                  <td class="ipd-note-cell" v-if="isVisGoods('note')">{{ it.note || '—' }}</td>
                  <!-- v408（P1-6）行历史。**显式传参**，不要写成 `@click="openLogs"` ——
                       那样 Vue 会把 `MouseEvent` 当第一个实参塞进 `product_id`
                       （`Number(event)` = NaN ⇒ 过滤条件失效、还会静默返回整单日志）。 -->
                  <td class="ipd-hist-cell">
                    <button class="btn btn-ghost btn-sm ipd-hist-btn"
                            :title="'只看这一行的入库 / 退货痕迹：' + (it.product_name || ('商品 ' + it.product_id))"
                            @click="openLogsRow(it.product_id, it.product_name)">
                      <Icon name="history" :size="13" />历史
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <!-- 🔴 v452 重算 colspan（列序与默认显隐都变了，不改就会整体错位）：
                       现在表格 = 8 固定列 + 5 可选列。
                       固定：序号(齿轮) / 商品名称 / 单位 / 采购价 / 订单数量 / 订单金额 / 已到货 / 历史
                       可选：条形码 / 参考成本价 / 批次号 / 到期日 / 行备注
                       合计标签跨「序号…采购价」= 6 − 隐藏的可选列(条码/参考)；
                       数量 / 金额 / 已到货三格各就各位；尾格跨「批次…历史」= 4 − 隐藏的可选列。
                       ⚠️ 以后加列仍要同步这里：错位**不报错**，只是金额对到别的列下面。
                       v453（R4）新增「入库金额」列后：**合计 colspan 公式没变** ——
                       它排在「已到货」之后（合计标签的跨列区间之外），只需在这里多补一格。 -->
                  <td :colspan="6 - (isVisGoods('barcode')?0:1) - (isVisGoods('ref')?0:1)">合计</td>
                  <td class="num">{{ fmtQty(sumQty) }}</td>
                  <td class="num">{{ fmtMoney(sumAmount) }}</td>
                  <!-- v452：合计行补「已到货」合计 —— 订单量 vs 已到货量同屏可比，
                       是到货对账最常看的一组数（舟谱合计行同样两个数量口径并列）。 -->
                  <td class="num">{{ fmtQty(sumRecv) }}</td>
                  <!-- v453（R4）入库金额合计：列序上紧跟「已到货」，这里也必须紧跟它的合计格。 -->
                  <td class="num" v-if="isVisGoods('ramt')">{{ fmtMoney(sumRecvAmt) }}</td>
                  <!-- v454（R12）期望生产日期无合计（日期列）⇒ 空格占位，但**必须存在**，
                       否则其后（批次/到期日/行备注/操作）的合计格整体左移一列、静默错位。 -->
                  <td v-if="isVisGoods('epdate')"></td>
                  <td v-if="isVisGoods('batch')"></td>
                  <td v-if="isVisGoods('expiry')"></td>
                  <td v-if="isVisGoods('note')"></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <ColMenuPanel ref="panelGoods" :col-list="GOODS_COLS" :is-visible="isVisGoods" :toggle-col="toggleGoods" :reset-cols="resetGoods" />

        </div>

        <!-- v453（R8）总额条**移出 `.ipd-plain` 并吸底**（v452 O7 建的「订单总额」横条）。
             🔴 为什么必须移出：`.ipd-plain` 有 `overflow:hidden`，它会成为 sticky 的
                「最近的滚动容器」⇒ 留在里面 `position:sticky;bottom:0` 是**静默失效**的
                （不报错、不崩，就是完全不动）。移出后滚动容器才是视口，吸底才生效。
             ⚠️ 因此它自带边框与圆角 —— 已经不是表格框内的最后一条了。 -->
        <div v-if="items.length" class="ipd-total-bar">
          <span class="ipd-total-lb">订单总额</span>
          <b class="ipd-total-amt">¥{{ fmtMoney(sumAmount) }}</b>
          <span class="ipd-total-note">共 {{ items.length }} 行 · 已到货 {{ fmtQty(sumRecv) }}</span>
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
            <!-- P1-2：本采购单归属的结算单号（可能多张；已作废的标出）。数据来自后端 `pay.settlements`。
                 没被结算过 ⇒ `—`（不是 0、也不是空串伪装）。让老板在货款页一眼看到「这张单进了哪几张结算单」。 -->
            <div class="ipd-row"><span class="ipd-lb">结算单号</span>
              <span v-if="pay.settlements && pay.settlements.length">
                <span v-for="s in pay.settlements" :key="s.id" class="ipd-settle">{{ s.settle_no }}<i v-if="s.status === 'void'" class="ipd-settle-void">（已作废）</i></span>
              </span>
              <span v-else>—</span>
            </div>
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
            <!-- v408（P0-6）：入库时间读 `received_at`（独立列，confirm / partial_receive 写入）。
                 🔴 **不得**回退读 `head.audit_time` —— 那是「审核时间」，先审后到的单两者可差几天；
                    历史单 `received_at` 为空就如实显示 `—`（本仓铁律：缺值不编）。 -->
            <div class="ipd-f"><span class="ipd-lb">入库时间</span><span>{{ inb.head.received_at || '—' }}</span></div>
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
                  <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenuIn" title="列设置"><Icon name="settings" :size="15" /></button></th>
                  <th v-if="isVisIn('batch')">生产批号</th>
                  <th>商品名称</th>
                  <th v-if="isVisIn('barcode')">小单位条码</th>
                  <th v-if="isVisIn('lbarcode')">大单位条码</th>
                  <th v-if="isVisIn('conv')">单位换算</th>
                  <th>单位</th>
                  <th>入库仓库</th>
                  <th class="num">订单数量</th>
                  <th class="num">订单金额</th>
                  <th class="num">入库数量</th>
                  <th v-if="isVisIn('pdate')">生产日期</th>
                  <th class="num">入库金额</th>
                  <th class="num">差异数量</th>
                </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, i) in inb.items" :key="it.id">
                    <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td v-if="isVisIn('batch')">
                    <span v-if="it.batch_no">{{ it.batch_no }}</span>
                    <!-- v452（O8）：与采购明细表同口径，「未登记」改灰色文字（状态说明不是警示）。 -->
                    <span v-else class="ipd-none">未登记</span>
                  </td>
                  <td class="ipd-c-name">{{ it.product_name || ('商品 ' + it.product_id) }}</td>
                  <td class="ipd-mono" v-if="isVisIn('barcode')">{{ it.barcode || '—' }}</td>
                  <td class="ipd-mono" v-if="isVisIn('lbarcode')">{{ it.large_barcode || '—' }}</td>
                  <td v-if="isVisIn('conv')">{{ it.spec || '—' }}</td>
                  <td>{{ it.unit_label || '—' }}</td>
                  <td>{{ inb.head.warehouse_name || '—' }}</td>
                  <td class="num">{{ fmtQty(it.order_qty) }}</td>
                  <td class="num">¥{{ fmtMoney(it.order_amount) }}</td>
                  <td class="num">{{ fmtQty(it.received_qty) }}</td>
                  <td v-if="isVisIn('pdate')">{{ it.production_date || '—' }}</td>
                  <td class="num">¥{{ fmtMoney(it.recv_amount) }}</td>
                  <td class="num" :class="{ 'ipd-diff': Number(it.diff_qty) !== 0 }">{{ fmtQty(it.diff_qty) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                <tr>
                  <td :colspan="10 - (isVisIn('batch')?0:1) - (isVisIn('barcode')?0:1) - (isVisIn('lbarcode')?0:1) - (isVisIn('conv')?0:1)">合计</td>
                  <td class="num">{{ fmtQty(inb.summary.recv_qty) }}</td>
                  <td v-if="isVisIn('pdate')"></td>
                  <td class="num">¥{{ fmtMoney(inb.summary.recv_amount) }}</td>
                  <td></td>
                </tr>
                </tfoot>
              </table>
            </div>

            <ColMenuPanel ref="panelIn" :col-list="INBOUND_COLS" :is-visible="isVisIn" :toggle-col="toggleIn" :reset-cols="resetIn" />

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

    <!-- 补充信息（自定义字段）弹层（v415 P2-7）。
         🔴 表单外壳复用 `登记付款` 那套类名（`.ipd-mask` / `.ipd-dlg` / `.ipd-fl` /
            `.ipd-dlg-ft`）—— 同一页里两个弹层用同一份定位与间距，不另抄一份。
         🔴 字段清单来自服务端（可随时增删），所以这里**必须是 `v-for`**，不能写死几个输入框。
         🔴 「留空即清除」要写在占位符里：空串在后端是**清空**该字段（与"没提交"不同），
            不写出来用户会以为留空 = 保持原值。 -->
    <div v-if="cfOpen" class="ipd-mask" @click.self="cfBusy ? null : (cfOpen = false)">
      <div class="card ipd-dlg ipd-cf-dlg">
        <div class="ipd-dlg-hd">补充信息</div>
        <p class="ipd-dlg-msg">
          {{ o.order_no || ('#' + oid) }} · 这些字段是你们自己定义的，填不填都行。
        </p>
        <label v-for="c in cfDefs" :key="c.key" class="ipd-fl">
          <span class="ipd-lb">{{ c.label }}</span>
          <input v-model="cfForm[c.key]" class="input ipd-in"
                 :inputmode="c.num ? 'decimal' : 'text'"
                 :placeholder="c.num ? '数字，留空即清除' : '留空即清除'" />
        </label>
        <div class="ipd-dlg-ft">
          <button class="btn btn-ghost btn-sm" :disabled="cfBusy" @click="cfOpen = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="cfBusy" @click="saveExtra">
            {{ cfBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 查看日志弹层（对齐舟谱：操作人 / 时间 / 事件 / 详细信息）。
         🔴 「操作人」在「审核」「已入库」两行**恒为 `—`** —— 源头没记是谁做的
            （`audit_time` 只有时间、`batch_trace` 没有操作人列）。这里**不拿创建人顶替**，
            因为那是另一个事实、会让老板以为「是他审的」。
         🔴 `logHint` 必须显示：它讲清「哪些动作没有留痕」。不显示的话，用户会把
            「没有订单修改记录」读成「这张单从没被改过」—— 这是两回事。 -->
    <div v-if="logsOpen" class="ipd-mask" @click.self="logsOpen = false">
      <div class="card ipd-dlg ipd-dlg-wide">
        <div class="ipd-dlg-hd">{{ logsTitle }}</div>
        <p class="ipd-dlg-msg">{{ logsSub }}</p>

        <!-- v454（R13）双页签对齐舟谱。复用全局 `.main-tabs / .main-tab`（与页内三页签同一套），
             不另写一份定位 —— 同页两处页签长得一样，用户不用学两套。
             ⚠️ 行历史态（`logPid`）下不出现：见脚本层 `logTab` 的注释。 -->
        <div v-if="!logPid" class="main-tabs ipd-logtabs">
          <button class="main-tab" :class="{ on: logTab === 'order' }" @click="logTab = 'order'">订单日志</button>
          <button class="main-tab" :class="{ on: logTab === 'logistics' }" @click="logTab = 'logistics'">物流日志</button>
        </div>

        <template v-if="logTab === 'order'">
        <div v-if="logsLoading" class="state-empty">加载中…</div>
        <div v-else-if="logsErr" class="state-error">
          <div class="se-ic"><Icon name="alert" :size="22" /></div>
          <p>{{ logsErr }}</p>
          <button class="btn btn-ghost btn-sm" style="margin-top:10px"
                  @click="openLogs(logPid, logPname)">重试</button>
        </div>
        <div v-else-if="!logs.length" class="state-empty">{{ logsEmpty }}</div>
        <div v-else class="table-wrap ipd-logwrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th class="ipd-log-op">操作人</th>
                <th class="ipd-log-at">时间</th>
                <th class="ipd-log-ev">事件</th>
                <th>详细信息</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in logs" :key="i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td class="ipd-log-op">{{ e.operator_name || '—' }}</td>
                <td class="ipd-log-at">{{ e.at }}</td>
                <td class="ipd-log-ev">{{ e.event }}</td>
                <td class="ipd-log-dt">{{ e.detail || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="logHint" class="ipd-note ipd-loghint">{{ logHint }}</p>
        </template>

        <!-- 物流日志页（v454 R13）。
             TODO(待确认)：本页**无数据源** —— 舟谱这里显示供应商发货 / 运输轨迹，
                 本系统没有承运商、运单号、轨迹任何一张表（`purchase_orders` 也没有相关列）。
                 待确认：① 是否有接入计划（厂家 TMS / 司机上报 / 手工填运单号）；
                 ② 若只做「手工填运单号 + 到货节点」的最小版，字段放采购单头还是新建 `po_shipments`；
                 ③ 在确认之前**保持空态**，不写死任何占位假数据（会让人以为系统在跟车）。 -->
        <div v-else class="ipd-logistics">
          <div class="ipd-empty">
            <div class="ipd-empty-ic"><Icon name="package" :size="26" /></div>
            <p>这张单还没有物流信息。</p>
            <p class="ipd-log-note">
              舟谱在这一页显示供应商发货与运输轨迹。本系统目前还没有物流数据源
              —— 是「还没接」，不是「查不到」。
            </p>
          </div>
        </div>

        <div class="ipd-dlg-ft">
          <button class="btn btn-ghost btn-sm" @click="logsOpen = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 附件弹层（v408 P1-8）。
         🔴 下载**不走** `/uploads/...` 静态 URL：nginx 只挂了 `/static/`，那个路径压根
            打不开 ⇒ 一律按附件 id 走**带鉴权**的下载接口（`apiBlob` 会带 Bearer；
            `<a href>` 带不了，会被后端判 401）。
         🔴 同名附件会被后端**明确拒绝**（磁盘名按文件名拼，同名会覆盖旧文件）⇒
            失败原因必须显示出来，不许静默。 -->
    <div v-if="attOpen" class="ipd-mask" @click.self="attOpen = false">
      <div class="card ipd-dlg">
        <div class="ipd-dlg-hd">附件</div>
        <p class="ipd-dlg-msg">
          {{ o.order_no || ('#' + oid) }} · {{ o.supplier_name || '供应商' }}（{{ attachCount }} 个）
        </p>

        <div v-if="attLoading" class="state-empty">加载中…</div>
        <div v-else-if="!attachCount" class="state-empty">这张单还没有附件。</div>
        <div v-else class="table-wrap ipd-logwrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>文件名</th>
                <th class="ipd-at-by">上传人</th>
                <th class="ipd-log-at">上传时间</th>
                <th class="ipd-at-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(a, i) in attaches" :key="a.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td class="ipd-at-nm">{{ a.filename || '—' }}</td>
                <td class="ipd-at-by">{{ a.operator_name || '—' }}</td>
                <td class="ipd-log-at">{{ (a.created_at || '').slice(0, 16) || '—' }}</td>
                <td class="ipd-at-op">
                  <button class="btn btn-ghost btn-sm" :disabled="attBusy" @click="downloadAttach(a)">
                    <Icon name="download" :size="14" />下载
                  </button>
                  <button v-if="canWrite" class="btn btn-ghost btn-sm" :disabled="attBusy"
                          @click="removeAttach(a)">
                    <Icon name="trash" :size="14" />删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="attMsg" class="ipd-note ipd-loghint">{{ attMsg }}</p>

        <div class="ipd-dlg-ft">
          <!-- 隐藏的 file input：真正的「选文件」由下面那个按钮触发（保持与其它按钮同规格）。
               ⚠️ 选完必须把 value 清掉，否则连续选同一个文件不会再触发 change。 -->
          <input ref="attFileEl" type="file" class="ipd-at-file" @change="onAttachPick" />
          <button v-if="canWrite" class="btn btn-primary btn-sm" :disabled="attBusy" @click="pickAttach">
            <Icon name="upload" :size="14" />{{ attBusy ? '上传中…' : '上传附件' }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="attOpen = false">关闭</button>
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import ColMenuPanel from '../../components/ColMenuPanel.vue'
import { useColSettings } from '../../composables/useColSettings.js'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { PO_STATUS, textOf, tagOf, PSI_NOTES, fmtMoney } from '../../constants/psiLabels'
import { downloadCsv, localDateStamp } from '../../utils/csv'
/* v415（P2-7）采购单自定义字段。定义归一 / 取值读取都在 composable 里
   （列表页与新建页共用同一份）⇒ 本页不重复实现"怎么读一个自定义字段的值"。 */
import { usePurchaseCustomFields, extraValOf } from '../../composables/purchaseCustomFields.js'

/* 列设置：本页有两张独立表格（采购商品明细 / 入库明细），各自一套列清单与显隐状态。
   v452（O2/O6）采购商品明细列序对齐舟谱（11 列口径）：
     · 删「规格」列 —— 规格并进商品名单元格的小字（与单位列换算小字说的是同一句话，
       双列显示是噪音）；规格值本身不丢（单元格小字 + CSV 导出列都在）。
     · 「批次号 / 到期日」标 `def:false` —— **默认收进列设置**（舟谱详情默认也没有），
       要时点表头齿轮打开，选择云端持久。数据一个都没删。 */
const GOODS_COLS = [
  { key: 'name', label: '商品名称', core: true },
  { key: 'barcode', label: '条形码', core: false },
  { key: 'unit', label: '单位', core: true },
  { key: 'ref', label: '参考成本价', core: false },
  { key: 'price', label: '采购价', core: true },
  { key: 'qty', label: '订单数量', core: true },
  { key: 'amt', label: '订单金额', core: true },
  { key: 'rec', label: '已到货', core: true },
  /* v453（R4）入库金额：舟谱明细里「入库数量 / 入库金额」是**相邻两列** —— 部分到货时
     只有数量对不上账，必须看到「已到这部分值多少钱」。
     🔴 `def:false`：**默认收进列设置**（与批次号 / 到期日同档），要时点表头齿轮打开。
        明细列已经很密，这一列不是人人天天看，默认占屏会挤掉更常用的列。
     ⚠️ 加列必须同步表尾 `<tfoot>`：错位**不报错**，只是金额对到别的列下面（静默）。 */
  { key: 'ramt', label: '入库金额', core: false, def: false },
  /* v454（R12）期望生产日期：舟谱采购退货单明细里是**常显列**（截图 17「期望生产日期▾」），
     采购订单明细的列设置里也存在。它表达的是「我方要求供应商哪天生产/交付的货」——
     低温奶临期判定要用「生产日期 + 保质期」，所以这个**期望值**与到货后登记的
     `production_date`（入库单页的实际生产日期）是两个口径，不能互相顶替。
     🔴 `def:false`：**默认收进列设置**，与批次号 / 到期日同一档（上面三列都是"要时再开"）。
     TODO(待确认)：本列取值字段名与数据来源未确认 —— 暂用 `it.expected_production_date`，
        后端（`purchase_order_items` / `psi` 明细投影）当前**未下发**该字段 ⇒ 恒显示 `—`。
        待确认：① 舟谱这个值由谁填（建单时选 / 供应商回填）；② 本系统是否已在某张表存过
        （不应新建字段名前先查 `production_date` 是否复用了同一列）；③ 若确认不采集，
        本列应连同 `GOODS_COLS` 条目一起删掉，不留永久空列。 */
  { key: 'epdate', label: '期望生产日期', core: false, def: false },
  { key: 'batch', label: '批次号', core: false, def: false },
  { key: 'expiry', label: '到期日', core: false, def: false },
  { key: 'note', label: '行备注', core: false },
  { key: 'hist', label: '历史', core: true },
]
const INBOUND_COLS = [
  { key: 'batch', label: '生产批号', core: false },
  { key: 'name', label: '商品名称', core: true },
  { key: 'barcode', label: '小单位条码', core: false },
  { key: 'lbarcode', label: '大单位条码', core: false },
  { key: 'conv', label: '单位换算', core: false },
  { key: 'unit', label: '单位', core: true },
  { key: 'wh', label: '入库仓库', core: true },
  { key: 'oqty', label: '订单数量', core: true },
  { key: 'oamt', label: '订单金额', core: true },
  { key: 'rqty', label: '入库数量', core: true },
  { key: 'pdate', label: '生产日期', core: false },
  { key: 'ramt', label: '入库金额', core: true },
  { key: 'diff', label: '差异数量', core: true },
]
const { isVisible: isVisGoods, toggleCol: toggleGoods, resetCols: resetGoods } = useColSettings('inv-purchase-detail-goods', GOODS_COLS)
const { isVisible: isVisIn,    toggleCol: toggleIn,    resetCols: resetIn    } = useColSettings('inv-purchase-detail-inbound', INBOUND_COLS)
const panelGoods = ref(null)
const panelIn = ref(null)
function openColMenuGoods (e) { if (panelGoods.value) panelGoods.value.open(e) }
function openColMenuIn (e) { if (panelIn.value) panelIn.value.open(e) }

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
/* v452（O5）「更多信息 ▾」展开开关（默认收起：次要字段不占首屏）。 */
const moreInfoOpen = ref(false)

/* v452-followup（O13）：敏感字段「供应商类别（临期货）」按能力隐藏。
   🔴 用既有 capability 体系（`canDo`）收口，而不是手搓角色白名单：
   —— `accounts` 模块只有 boss / admin / accountant 持有（sales / guide / driver / 库管 都没有），
      正好满足「销售员不可见、可信财务/老板可见」的口径，且零后端改动、零迁移脚本。
   —— fail-open 方向取「宽」：`canDo` 在拿不到权限表时返回 true（一次接口抖动不该把老板的字段藏掉）。 */
const canSeeSupplierCategory = computed(() => canDo('accounts', 'read'))

/* v452-followup（O10）／v453（R5）：详情页**行内编辑**表头字段。
   可改 6 个：备注 / 预计到货（O10）＋ 经办人 / 部门 / 仓库 / 单据日期（R5）。
   🔴 全部走同一个窄端点 `PUT /api/psi/purchase-orders/{id}/header` —— 后端**按列逐个校验**，
      与全量编辑端点（改已发生事实必须拦在未入库）分开。
   🔴 仓库是唯一例外：已入库的单禁用（见 `whLocked`），与后端闸门逐字一致。
   🔴 入口只对 `canWrite`（= canDo('inventory','create')，即老板/管理员/会计）可见，销售员看不到。 */
const editHeader = ref(false)
const editNote = ref('')
const editExpected = ref('')
const editHandler = ref('')
const editDepartment = ref(0)
const editWarehouse = ref(0)
const editOrderDate = ref('')
const saveBusy = ref(false)
const saveMsg = ref('')
const saveErr = ref(false)

/* v453（R5）下拉选项：经办人（主库账号）/ 部门 / 仓库。
   🔴 **进入编辑态才拉**：详情页默认是「看」，不该为一次可能根本不发生的编辑
      多打一个接口（建单页必然要选，所以那边是挂载就拉）。
   🔴 与建单页 `PurchaseOrderForm` **同一个数据源**（`psiApi.refs`），不另立一份 ——
      两处口径一旦分叉，「详情里改的部门」和「建单时选的部门」就不是同一套编号了。
   ⚠️ `users` 主库读不到时后端**不返回该键**（见 psi.js refs 注释）⇒ 保持空数组，
      由 `handlerOpts` 把当前值补成唯一选项，不拿员工档案顶替（id 是两套编号）。 */
const warehouses = ref([])
const departments = ref([])
const users = ref([])
let refsLoaded = false
async function loadRefs () {
  if (refsLoaded) return
  try {
    const d = await psiApi.refs('warehouses,departments,users', '', 200)
    warehouses.value = Array.isArray(d && d.warehouses) ? d.warehouses : []
    departments.value = Array.isArray(d && d.departments) ? d.departments : []
    users.value = Array.isArray(d && d.users) ? d.users : []
    refsLoaded = true
  } catch (e) {
    // 不静默：明确说一句「下拉可能不完整」，而不是让三个下拉悄悄变空。
    toast('基础资料读取失败，下拉选项可能不完整', 'warn')
  }
}

/* 经办人下拉：当前值**可能不在**主库账号列表里（历史导入单 / 已停用账号）。
   🔴 一进编辑态如果 v-model 的值没有匹配的 option，`<select>` 会**静默跳到「不指定」** ——
      用户什么都没动、点保存，经办人就被清空了（零报错、最难查的那类）。
      ⇒ 把当前值补成第一项（显示名用已有的 `handler_name`，没有就退回「账号 N」）。 */
const handlerOpts = computed(() => {
  const cur = String(o.value.handler || '')
  const list = users.value.filter(u => u && u.name).map(u => ({ id: String(u.id), name: u.name }))
  if (cur && !list.some(u => u.id === cur)) {
    return [{ id: cur, name: o.value.handler_name || ('账号 ' + cur) }].concat(list)
  }
  return list
})

/* v453（R5）仓库锁：已发生库存动作的单**不能改成另一个仓**。
   🔴 与后端 `_PO_STOCKED_STATUS` **逐字对齐**（received / partial / returned）。
      前端这里只是「不给选」，真正的拒绝在后端 —— 前端禁用能被绕过，后端闸门才是权威。 */
const whLocked = computed(() =>
  ['received', 'partial', 'returned'].includes(String(o.value.status || '')))

/* v453（R1）是否有供应商维度余额可读。没有供应商 ⇒ 两个余额都无从谈起，整组隐藏
   （而不是显示两个「—」占着信息带的黄金位）。 */
const hasSupplierBal = computed(() => !!(pay.value && pay.value.supplier_id))

function startEdit () {
  editNote.value = o.value.note || ''
  editExpected.value = o.value.expected_date || ''
  editHandler.value = String(o.value.handler ?? '')
  editDepartment.value = Number(o.value.department_id ?? 0)
  editWarehouse.value = Number(o.value.warehouse_id || 0)
  editOrderDate.value = (o.value.order_date || '').slice(0, 10)
  editHeader.value = true
  saveMsg.value = ''
  saveErr.value = false
  loadRefs()   // v453：进入编辑态才拉下拉选项（不阻塞，失败也会 toast）
}
function cancelEdit () {
  editHeader.value = false
  editNote.value = ''
  editExpected.value = ''
  editHandler.value = ''
  editDepartment.value = 0
  editWarehouse.value = 0
  editOrderDate.value = ''
}
async function saveHeader () {
  if (saveBusy.value) return
  saveBusy.value = true
  saveMsg.value = ''
  saveErr.value = false
  try {
    const r = await psiApi.updatePurchaseHeader(oid.value, {
      note: editNote.value,
      expected_date: editExpected.value,
      handler: editHandler.value,
      department_id: editDepartment.value,
      warehouse_id: editWarehouse.value,
      order_date: editOrderDate.value,
    })
    if (!r || !r.success) throw new Error((r && r.error) || '保存失败')
    // 本地即时回写，避免整页重拉；与详情页其它本地回写（如确认/付款后）同口径。
    o.value.note = editNote.value
    o.value.expected_date = editExpected.value
    o.value.handler = editHandler.value
    o.value.department_id = editDepartment.value
    o.value.warehouse_id = editWarehouse.value
    o.value.order_date = editOrderDate.value
    /* 🔴 显示名必须跟着回写：后端存的是 id，界面读的是 name。
       不回写的话会「提示保存成功、但显示的还是旧值」，用户只能刷新才看得到 ——
       看起来像没保存成功（这类"半生效"比直接失败更难查）。 */
    const _u = handlerOpts.value.find(x => x.id === editHandler.value)
    o.value.handler_name = _u ? _u.name : ''
    const _d = departments.value.find(x => Number(x.id) === Number(editDepartment.value))
    o.value.department_name = _d ? _d.name : ''
    const _w = warehouses.value.find(x => Number(x.id) === Number(editWarehouse.value))
    o.value.warehouse_name = _w ? _w.name : ''
    editHeader.value = false
    saveMsg.value = '已保存'
    toast('已保存表头字段', 'success')
  } catch (e) {
    saveErr.value = true
    saveMsg.value = (e && e.message) || '保存失败'
  } finally {
    saveBusy.value = false
  }
}


const payOpen = ref(false)

/* v408（P1-4）打印设置。
   🔴 `printCount` 读的是**服务端**记的数（`purchase_orders.print_count`），不是本地计数 ——
      同一张单在列表页打印过、同事打印过，这里都要看得见，否则「已打印几次」是假的。
   🔴 它会过期（别人刚打印过）：所以菜单里给了一个显式的「刷新打印次数」，
      而不是让它看起来永远对。 */
const printOpen = ref(false)
const printCount = computed(() => Number(o.value.print_count || 0))
/* v412（P2-5）审核动作组的下拉开关（主按钮是「审核并打印」，箭头里是「审核并入库」）。
   与 `printOpen` 分开存：两个菜单同时开着会叠在一起，且各自关闭时机不同。 */
const auditOpen = ref(false)
/* v452（O1）「更多 ▾」菜单开关。转单为 / 日志 / 附件 / 相邻单据都搬进了这一个菜单，
   所以 v414 的 `transOpen` 随之退役（删除而非留一个无人设置的开关）。 */
const moreOpen = ref(false)
/* 能退货的单 = **进过货**的单。判据与后端 `purchase_order_list(returnable=True)` 的
   白名单**逐字对齐**（`received` / `partial` / `returned`），也与退货建单页选原单的
   候选范围一致 ⇒ 不会出现「详情页说能退、退货页搜不到这张单」。
   ⚠️ `returned` 必须在里面：v408（P0-3）的口径是「只要有退货就落 returned」，
      部分退货的单也变成 `returned`，把它排除会让「退第二批」无路可走。
   ⚠️ 这只是**粗筛**（还没算余量）：真正「还能退多少」由退货页的可退预览逐行算。 */
const canTransfer = computed(() =>
  canWrite.value && ['received', 'partial', 'returned'].includes(String(o.value.status || '')))
// P1-4：只有未入库的单可编辑（草稿 / 待审批 / 已取消）。已入库等状态在后端的 `purchase_order_update`
// 会被拒，这里同步收起按钮，省掉「点了才知道不行」那一轮（与后端闸门逐字对齐）。
const canEdit = computed(() =>
  canWrite.value && ['draft', 'pending_approval', 'cancelled'].includes(String(o.value.status || '')))
const transBlockTip = computed(() => {
  const s = String(o.value.status || '')
  if (s === 'draft') return '这张单还是草稿，没有入库，没有货可退'
  if (s === 'pending_approval') return '这张单还在待审批，没有入库，没有货可退'
  if (s === 'confirmed') return '这张单还没入库，没有货可退'
  if (s === 'cancelled') return '这张单已取消，没有货可退'
  return '这张单没有可退的货'
})

/** 转单为 → 采购退货：跳**退货建单页**并带上原单号（那一页会预填可退明细）。
    🔴 不在这里做退货本身：退货有自己的一屏（原单 / 可退量 / 数量 / 价格 / 原因），
       塞进这个详情页会变成弹窗套弹窗；而且「转单」的语义就是"去开一张新单"。 */
function doTransferReturn () {
  moreOpen.value = false
  if (!canTransfer.value) { toast(transBlockTip.value, 'warn'); return }
  router.push('/inventory/purchase/new?kind=return&from_po=' + oid.value)
}

/* ---- 上一条 / 下一条（v408 P1-5）--------------------------------------------
   🔴 **口径只有一条：全部采购单按 id 倒序**（= 列表页默认视图的顺序）。它**不跟随**
      列表页的筛选 —— 详情页可以被直接打开（深链 / 同事发来的链接 / 小程序），
      带不全筛选条件就会变成"有时跟、有时不跟"，比不跟更难解释。所以口径**写在界面上**。
   🔴 判据用 `has_prev` / `has_next`，**不用 id 非零**去推：后端把"到头了"编码成 id=0，
      拿 id 推会把「到头」和「数据异常」混成一种情况。
   🔴 `navErr` 单独存：相邻是**辅助信息**，它读失败不许把整页打成错误页（有主数据可看），
      但也不能静默 —— 静默的话按钮会一直灰着，用户以为"就是没有上一条"。 */
const nb = ref({ prev_id: 0, next_id: 0, has_prev: false, has_next: false, pos: 0, total: 0 })
const navErr = ref('')
const navText = computed(() => Number(nb.value.total || 0) > 0
  ? `第 ${nb.value.pos} / ${nb.value.total} 条（全部采购单）` : '')

/* 请求序号：同一 route record 换 params 时组件被复用，前一次请求可能后回来
   ⇒ 会把上一条单的相邻关系画到这一条上（`oid` 不同但界面不报错）。 */
let _navSeq = 0
async function loadNeighbors () {
  const seq = ++_navSeq
  navErr.value = ''
  try {
    const d = await psiApi.getPurchaseNeighbors(oid.value)
    if (seq !== _navSeq) return
    nb.value = d || {}
  } catch (e) {
    if (seq !== _navSeq) return
    nb.value = { prev_id: 0, next_id: 0, has_prev: false, has_next: false, pos: 0, total: 0 }
    navErr.value = e.message || '上一条 / 下一条读取失败'
  }
}

function goNeighbor (dir) {
  const isPrev = dir === 'prev'
  const id = isPrev ? nb.value.prev_id : nb.value.next_id
  if (!(isPrev ? nb.value.has_prev : nb.value.has_next) || !id) return
  router.push(`/inventory/purchase/${id}`)
}

/* ---- 导出明细（v408 P1-5）--------------------------------------------------
   导出的是**这张单的明细**（不是列表）。列序与「采购订单详情」那张表**同序**
   （v452 起：屏幕默认隐藏的批次 / 到期**仍在导出里** —— 导出是全量数据场景，
   屏幕默认值不该决定数据行；规格也保留为独立列，Excel 里筛选比小字更好用）。
   🔴 表里显示 `—` 的格子（条码 / 单位为空、批次未登记）导出**空串**而不是 `—`：
      `—` 会被 Excel 当成文本参与排序筛选，空串才是「没有值」。
   🔴 数量 / 金额导出**纯数字**（不带 `¥`、不带千分位），否则 Excel 里不能求和。 */
function doExport () {
  if (!items.value.length) { toast('这张单没有明细可导出', 'warn'); return }
  const head = ['序号', '商品名称', '规格', '条形码', '单位', '参考成本价', '采购价',
    '订单数量', '订单金额', '已到货', '批次号', '到期日', '行备注']
  const body = items.value.map((it, i) => [
    i + 1,
    it.product_name || ('商品 ' + it.product_id),
    it.spec || '',
    it.product_barcode || '',
    it.unit_label || '',
    Number(it.product_purchase_price || 0),
    Number(it.unit_price || 0),
    Number(it.quantity || 0),
    Number(it.amount || 0),
    Number(it.received_qty || 0),
    it.batch_no || '',
    it.expiry_date || '',
    it.note || '',
  ])
  // 单号进文件名前去掉 Windows/macOS 都不接受的字符（单号是外部系统给的，别假定它干净）
  const safeNo = String(o.value.order_no || oid.value).replace(/[\\/:*?"<>|]/g, '_')
  downloadCsv(`采购单-${safeNo}-${localDateStamp()}.csv`, [head, ...body])
}

/* v408（P0-4）查看日志弹层。四个状态都是**显式**的：
   加载中 / 出错（可重试）/ 空 / 有数据 —— 不允许「空着且不报错」那种静默态。 */
const logsOpen = ref(false)
const logsLoading = ref(false)
const logsErr = ref('')
const logs = ref([])
const logHint = ref('')
const payBusy = ref(false)
const payErr = ref('')
const payForm = ref({ amount: '', account: '现金', note: '' })

const canWrite = computed(() => canDo('inventory', 'create'))
/* 判据与后端逐字对齐：`purchase_order_confirm` 只接受 `status IN ('draft','approved')` */
const canConfirm = computed(() => ['draft', 'approved'].includes(o.value.status))
const canReceive = computed(() => ['draft', 'approved', 'partial'].includes(o.value.status))
/* v412（P2-5）「审核并打印」的可见判据，与后端 `purchase_order_approve` 的
   `WHERE status IN (...)` **逐字对齐**：`pending_approval`（真待审）/ `draft` /
   `confirmed`（免审单补记审核时间与审核人，后端也认）。已入库 / 部分入库 / 已取消
   不在内 —— 后端会拒绝，前端就别摆这个按钮出来。 */
const canAudit = computed(() => ['pending_approval', 'draft', 'confirmed'].includes(o.value.status))

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
/* v452（O7）已到货合计：与订单量合计同屏并列（舟谱合计行同样两个数量口径），
   到货对账时不用自己心算「订了 124、到了多少」。 */
const sumRecv = computed(() => items.value.reduce((a, x) => a + Number(x.received_qty || 0), 0))
/* v453（R4）入库金额 = 已到货数量 × 本行采购价。
   🔴 单价取 `unit_price`（与「订单金额 = 数量 × unit_price」同口径），**不是** `product_purchase_price`
      （那是档案参考成本价，与实付单价不是一回事 —— 拿它算出来的合计会与订单金额对不上）。
   🔴 算不出来时返回 `null` ⇒ 显示 `—`，**不返回 0**：`0 元` 会被读成「到了货但没花钱」。 */
function recvAmt (it) {
  const q = Number(it && it.received_qty || 0)
  const p = Number(it && it.unit_price)
  if (!q || !isFinite(p)) return null
  return q * p
}
function recvAmtText (it) {
  const v = recvAmt(it)
  return v === null ? '—' : fmtMoney(v)
}
const sumRecvAmt = computed(() =>
  items.value.reduce((a, x) => a + (recvAmt(x) || 0), 0))

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

/* v452（O4）数量带单位后缀（舟谱「1件」）：读单位列自己那一格太远，
   数量贴着单位扫读最快。单位缺失（老单）就退回裸数字，不编一个「—」进去。 */
function qtyText (it, key) {
  const q = fmtQty(it[key || 'quantity'])
  const u = it.unit_label
  return u ? (q + ' ' + u) : q
}

/* v409（P2-1）折小单位的两行提示 —— **只在所选档不是小档时显示**。
   🔴 判据用后端下发的 `base_ratio`（换算比快照）而不是前端再算一次：
      小档 ratio 恒为 1，此时「折小数量」与「订单数量」是同一个数，写出来是噪音；
      老单 `base_ratio` = 0（当时没折算）⇒ 也不显示 —— 那不是"折不动"，是"当时没记"，
      显示一个等于订单数量的折算值会让人以为系统折过了（编事实）。 */
function showBasePrice (it) {
  return Number(it.base_ratio) > 1 && Number(it.base_unit_price) > 0
}
function showBaseQty (it) {
  return Number(it.base_ratio) > 1 && Number(it.base_qty) > 0
}

/* ══ v415（P2-7）自定义字段：展示 + 补填 ═════════════════════════════════════════
   ① 展示**只列有值的**：字段可以随时加（上限 30 个），全铺出来会把真正要看的信息淹掉；
   ② 补填入口长在"采购订单详情"那张信息卡里，**不**加到页头动作区 —— 动作区已有十来个
      控件，且「工具栏不新增按钮」是本项目既定偏好；
   ③ 为什么必须有补填：建单时字段可能还没建出来（或那张单就是导入的），
      而不少信息是**事后才到**的（厂家结算单号、承运人、对账批次…）。
      后端 `POST /purchase-orders/{id}/extra` 就是为它准备的。
   ⚠️ 这几个 ref 必须声明在 `loadAll` **之前**：`loadAll` 体内要写 `extra.value`，
      而 `const` 有暂时性死区 —— 虽然实际调用都在 setup 之后（watch / onMounted），
      但把声明压在函数下面会让后来人误判"可以在 setup 阶段调"，是没必要的暗雷。
   ══════════════════════════════════════════════════════════════════════════ */
const { defs: cfDefs, ok: cfOk, err: cfErr, loaded: cfLoaded,
        loadDefs: loadCfDefs } = usePurchaseCustomFields()
const extra = ref({})
const cfOpen = ref(false)
const cfBusy = ref(false)
const cfForm = ref({})

/** 有值的字段（顺序 = 字段定义的顺序）。空值不进 —— 见上方 ①。 */
const cfFilled = computed(() => {
  const out = []
  cfDefs.value.forEach(c => {
    const v = extraValOf(extra.value, c.key)
    if (v === '' || v === null || v === undefined) return
    out.push({ key: c.key, label: c.label, text: String(v) })
  })
  return out
})
/** 那块「补充信息」要不要出现：建过字段 且 （有值可看 或 有权限可填）。 */
const cfShow = computed(() => cfDefs.value.length > 0 && (cfFilled.value.length > 0 || canWrite.value))

function openExtra () {
  // 草稿用**字符串**（输入框的语义），数字字段也先按字符串兜住，类型校验交后端
  const f = {}
  cfDefs.value.forEach(c => {
    const v = extra.value[c.key]
    f[c.key] = (v === null || v === undefined) ? '' : String(v)
  })
  cfForm.value = f
  cfOpen.value = true
}

async function saveExtra () {
  if (cfBusy.value) return
  cfBusy.value = true
  try {
    /* 🔴 送**全部**字段（含空串），不是"只送改动过的"：
       空串在后端是「**清空该字段**」（从 `extra_json` 里删掉该键），而"没提交这个键"是
       「保持原值」。只送改动过的键的话，用户把某格删空后保存，值会一直留在库里
       —— 界面显示空、库里还有，是**静默假成功**（本仓一类专项缺陷）。 */
    const values = {}
    cfDefs.value.forEach(c => {
      const raw = cfForm.value[c.key]
      values[c.key] = (raw === null || raw === undefined) ? '' : String(raw).trim()
    })
    await psiApi.setPurchaseExtra(oid.value, values)
    cfOpen.value = false
    toast('补充信息已保存', 'success')
    await reloadOrder()
  } catch (e) {
    // 后端 detail 原样显示（如「「abc」不是数字」「字段不存在或不是自定义字段：p_xxx」）
    toast(e.message || '保存失败', 'error')
  } finally {
    cfBusy.value = false
  }
}

/** 只重取单据本身（**不动 `loading`**）—— 保存补充信息后刷新用。
    🔴 不用 `loadAll()`：那会让整页闪一下「加载中…」并连带重取货款 / 入库单 / 附件，
       为一个字段不值；也**不**用本地那份刚提交的值直接改界面 —— 后端会按列类型归一
       （`'5.0'` → `5`），本地"应该写进去了什么"是**另一个事实**，用它顶替就是编数据。 */
async function reloadOrder () {
  try {
    const d = await psiApi.getPurchase(oid.value)
    o.value = (d && d.order) || {}
    items.value = (d && d.items) || []
    extra.value = (o.value.extra && typeof o.value.extra === 'object') ? o.value.extra : {}
  } catch (e) {
    // 值其实已经存进去了 ⇒ 不用 error 级别吓人，但**必须说**（否则界面停在旧值上）
    toast('补充信息已保存，但本页刷新失败：' + (e.message || '请手动刷新'), 'warn')
  }
}

async function loadAll () {
  if (!oid.value) { err.value = '缺少采购单编号'; loading.value = false; return }
  loading.value = true
  err.value = ''
  /* 上一条 / 下一条并发发起、**不 await**：它是辅助信息，读失败只让按钮置灰（`navErr`），
     绝不能拖住或打断主数据。但也不能只在 `onMounted` 里调一次 —— `watch(oid, loadAll)`
     会走这里，靠它保证翻到下一单时导航跟着刷新。 */
  loadNeighbors()
  /* v408（P1-8）附件个数同样**不 await**：它只喂页头那个角标，读失败就是角标不显示，
     不该拖住主数据。放进 `loadAll` 是为了让「上一条 / 下一条」翻单时角标跟着换。 */
  loadAttach()
  /* v415（P2-7）自定义字段**定义**（字段名 / 类型）同样不 await：
     它是给"有值的那些字段"配标签用的，晚一拍到只会让那一小块先空着、随后补上；
     读失败也只是那一块显示不出来（`cfOk=false` ⇒ 界面照显原因，不静默）。
     ⚠️ 放进 `loadAll` 是为了翻单时也跟着刷新（本页实例会被 vue-router 复用）。 */
  loadCfDefs()
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
    /* v415：本单的自定义字段值。后端把 `extra_json` 解析成 `extra` 下发（与商品档案同一套）。
       ⚠️ 老后端上**没有这个键** ⇒ 空字典 ⇒ 界面显示「未填写」，**不报错**（可降级）。 */
    extra.value = (o.value.extra && typeof o.value.extra === 'object') ? o.value.extra : {}
  } catch (e) {
    err.value = e.message || '采购单读取失败'
  } finally {
    loading.value = false
    maybeAutoPrint()
  }
}

/* ① 路由参数变化 ⇒ 重新取数（组件实例被 vue-router 复用，不会重跑 setup） */
watch(oid, loadAll)

/* ---- v412（P2-5）「保存并打印」的落地端 ---------------------------------------
   新建页保存成功后跳到这里并带 `?print=1`（见 `InvPurchaseNew.vue` 的 `submit`）。
   🔴 必须**等数据加载完**再打印 —— `window.print()` 截的是此刻的 DOM，早于数据就位
      就会印出一张只剩表头的空单，而用户只会读成「打印功能坏了」。
   🔴 打印前**立刻把参数从 URL 摘掉**：否则用户按一次 F5 就又印一张、`print_count`
      也跟着再 +1 —— 而那个计数正是判断「这批货到底打没打给供应商」的依据。
   ⚠️ 只在**首次加载**认这个参数：翻单走的是 `router.push('/…/id')`（不带 query），
      本来就不会误触发；这个一次性开关是给「同实例被复用」留的双保险。 */
let _autoPrintFired = false
async function maybeAutoPrint () {
  if (_autoPrintFired) return
  if (String((route.query && route.query.print) || '') !== '1') return
  if (err.value) return /* 连数都没读到 ⇒ 不要印一张错误页给供应商 */
  _autoPrintFired = true
  router.replace({ path: route.path, query: tab.value === 'detail' ? {} : { tab: tab.value } })
  await nextTick()
  await doPrint(true)
}

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
// P1-4：跳新建页的 edit 模式（带本单 id 预填），由新建页负责拉单 + 渲染可编辑表单。
function doEdit () {
  router.push('/inventory/purchase/new?edit=' + oid.value)
}

/* 打印 = 浏览器打印 + （可选）记一次打印数。记数必须落库：刷新后那个数字还在，
   才是判断「这张单打没打给供应商」的依据（与列表页同一口径，后端同一端点）。

   🔴 **`count=false` 时绝不发 `printPurchase`**（v408 P1-4 的核心判据）。
      这不是省一次请求，而是**语义**：「重打 / 补打」如果也计数，那个数字就退化成
      「这台电脑点过几次打印」，再也不能用来判断「这张单交出去没有」。
      所以下面用 `if (count)` 把两条路径**分开**，而不是「都发请求再想办法解释」。 */
/** 打印原语（**唯一实现**）：可选计数 + 让菜单先卸载 + `window.print()`。
    ⚠️ **刻意不含 `busy` 守卫** —— 「审核并打印」在外侧已经 `busy=true`，这里若再判一次
       `busy` 就会直接 return，成品是「审核成功了、纸没出来」且零报错（静默半截）。
       互斥由调用方负责：`doPrint` 自己判一次，`doApprovePrint` 用它自己那一层。 */
async function _printNow (count = true) {
  printOpen.value = false
  if (count) await psiApi.printPurchase(oid.value)
  /* `nextTick` 让菜单（`v-if="printOpen"`）先完成一次卸载 —— 否则
     `window.print()` 截取页面时，下拉菜单可能还画在页头上被一起印出来。 */
  await nextTick()
  window.print()
}

async function doPrint (count = true) {
  if (busy.value) return
  busy.value = true
  try {
    await _printNow(count)
  } catch (e) {
    toast(e.message || '打印失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ---- v412（P2-5）「审核并打印」-----------------------------------------------
   把「审核」与「打印」两个动作并成一个（对齐舟谱）。
   🔴 走**同一个审核原语**（列表页「单据审核」用的那条 `/batch`），不在这里重写审核规则 ——
      否则迟早分叉成「详情页审得动、列表页审不动」。
   🔴 审核失败必须**如实报出**且**不打印**：印一张状态还是「待审批」的单给供应商，
      比不打印更糟（供应商会照着没经过审批的量备货）。
   🔴 **先刷新再打印**：审核改的是状态 / 审核时间 / 审核人 —— 不刷就印，
      纸上的状态还写着「待审批」（而库里已经是草稿）。 */
async function doApprovePrint () {
  if (busy.value) return
  auditOpen.value = false
  const pend = o.value.status === 'pending_approval'
  const ok = window.confirm(
    `审核这一单，然后打印？\n\n` +
    (pend
      ? `审核后状态从「待审批」变为「草稿」，就可以确认入库了。\n`
      : `这张单金额没到审批线，本来就不需要审批 —— 审核只补记审核时间与审核人。\n`) +
    `打印会把「打印数」+1（判断这批货到底打没打给供应商，看的就是它）。\n\n确定吗？`
  )
  if (!ok) return
  busy.value = true
  try {
    const b = await psiApi.batchPurchases('approve', [oid.value])
    const f = ((b && b.results) || []).find(x => !x.ok)
    if (!(b && b.ok_count)) throw new Error((f && f.reason) || '审核未成功')
    await loadAll()
    await _printNow(true)
    toast('已审核并打印', 'success')
  } catch (e) {
    toast(e.message || '审核失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ---- v412（P2-5）「审核并入库」—— **刻意不直接写库** --------------------------
   它做的是「审核 → 接着**拉起入库确认**」：用户仍要在入库那一步再确认一次
   （`doConfirm` 自带二次确认与「有几行没登记批次」的提醒）。
   为什么不干脆做成"一键 approve + confirm"：采购单的「审核」发生在**货到之前**
   （审的是价与量），「入库」发生在**货到之后**。合成一个不可逆的动作，
   诱导的就是"货还没到先把账做上" ⇒ **库存虚增**，而且这批库存的批次号 / 到期日
   多半还是空的（临期预警与「先出最早到期」会一起失真）。
   🔴 `busy` 必须在调 `doConfirm` **之前**放开 —— 它自己带 `busy` 守卫，拿着 `true`
      进去会直接 return，成品是「审核好了、入库确认没出来」且**零报错**（静默半截）。 */
async function doApproveReceive () {
  if (busy.value) return
  auditOpen.value = false
  const pend = o.value.status === 'pending_approval'
  const ok = window.confirm(
    `审核这一单，然后去入库？\n\n` +
    (pend
      ? `审核后状态从「待审批」变为「草稿」，就可以确认入库了。\n`
      : `这张单金额没到审批线，本来就不需要审批 —— 审核只补记审核时间与审核人。\n`) +
    `审核完会再弹一次入库确认；货没到齐就别往下点。\n\n确定吗？`
  )
  if (!ok) return
  busy.value = true
  let approved = false
  try {
    const b = await psiApi.batchPurchases('approve', [oid.value])
    const f = ((b && b.results) || []).find(x => !x.ok)
    if (!(b && b.ok_count)) throw new Error((f && f.reason) || '审核未成功')
    approved = true
    /* 先刷新：`canConfirm` 是基于 `o.status` 的 computed，不刷它就还在读审核**前**的状态。 */
    await loadAll()
  } catch (e) {
    toast(e.message || '审核失败', 'error')
  } finally {
    busy.value = false
  }
  if (!approved) return
  /* 审过了、但这张单此刻仍不能入库（后端 `confirm` 只收 `draft` / `approved`）
     ⇒ **如实说**，不去调一个注定失败的入库（那会变成"点了没反应 + 一句看不懂的错"）。 */
  if (!canConfirm.value) {
    toast('已审核；这一单现在的状态还不能入库', 'warn')
    return
  }
  await doConfirm()
}

/* 「刷新打印次数」：只重取这一张单，不动页面其它数据 —— 用户在别处打印过之后，
   要能就地看到新数，而不用刷新整页（刷新整页会丢掉当前页签之外的滚动位置）。
   🔴 失败时**不静默**：toast 说清楚没刷上，并保留旧值（旧值可能过期，但比清空诚实）。 */
async function refreshPrintCount () {
  printOpen.value = false
  try {
    const d = await psiApi.getPurchase(oid.value)
    const fresh = (d && d.order) || {}
    o.value = { ...o.value, print_count: fresh.print_count }
    toast('打印次数已刷新：' + Number(fresh.print_count || 0) + ' 次', 'success')
  } catch (e) {
    toast(e.message || '刷新打印次数失败', 'error')
  }
}

/* ---- 查看日志（v408 P0-4）-------------------------------------------------
   只读派生视图：`GET /api/psi/purchase-orders/{id}/logs`。

   🔴 **每次打开都重新拉，不做缓存**：日志是事实流水，用缓存会让「刚确认入库」
      在弹窗里看不到 —— 那正是「数据不更新且零报错」的老毛病。
   🔴 后端只产出 5 类事件（建单 / 审核 / 已入库 / 登记付款 / 采购退货），`hint` 里
      写明了这件事。**这里不补事件**：不知道的事不许编。
   🔴 `operator_name` 可能是空串（审核 / 已入库源头没记人）⇒ 模板里显示 `—`。
      绝不用 `o.creator_name` 兜底 —— 那会把「不知道是谁」说成「创建人做的」。

   ── v408（P1-6）同一份视图加**行级作用域** ─────────────────────────────
   🔴 只用一个弹层 + 一个作用域变量（`logPid`），**不新开第二个弹层** —— 两份模板
      必然漂移（一份改了另一份忘）。
   🔴 `openLogs` **必须带参数调用**（`openLogs(0, '')` / `openLogs(pid, name)`），
      不许写 `@click="openLogs"`：那样 Vue 会把 `MouseEvent` 当第一个实参塞进来，
      `Number(event)` = `NaN` ⇒ 过滤条件静默失效，还会**照常返回整单日志**（看着有数据）。
   🔴 行级模式下"空"是**正常结果**（整单事件天生不挂行）⇒ 空文案与 `hint` 都换了说法，
      否则用户把「这一行没有入库/退货痕迹」读成「这张单没人动过」。 */
const logPid = ref(0)
const logPname = ref('')
/* v454（R13）日志弹层的页签，对齐舟谱的「订单日志 / 物流日志」两页签。
   🔴 'order' = 现有那套（建单/审核/入库/付款/退货），数据来自 `psiApi.getPurchaseLogs`。
   🔴 'logistics' = **占位**：本系统没有物流数据源（没有承运商 / 运单号 / 轨迹表），
      这一页如实显示"还没接"而不是编几条假轨迹。见模板里的 TODO(待确认)。
   🔴 行历史态（`logPid > 0`）**不显示这两个页签** —— 行的历史只有出入库痕迹，
      对某一行谈"物流轨迹"没有业务含义（整单才有）。 */
const logTab = ref('order')
const logsTitle = computed(() => logPid.value ? '行历史' : '查看日志')
const logsSub = computed(() => {
  const no = o.value.order_no || ('#' + oid.value)
  if (!logPid.value) return no + ' · ' + (o.value.supplier_name || '供应商')
  /* ⚠️ 商品名可能为空（历史单没投影到名字）⇒ 退回「商品 N」，别显示成一个空串。 */
  return no + ' · ' + (logPname.value || ('商品 ' + logPid.value)) + '（只看这一行）'
})
const logsEmpty = computed(() => logPid.value
  ? '这一行没有入库或退货痕迹（建单 / 审核 / 付款是整单事件，不属于某一行）。'
  : '这张单没有可显示的操作记录。')

function openLogsAll () { openLogs(0, '') }
function openLogsRow (pid, pname) { openLogs(pid, pname) }

async function openLogs (pid = 0, pname = '') {
  logPid.value = Number(pid || 0) || 0
  logPname.value = String(pname || '')
  logsOpen.value = true
  logsLoading.value = true
  logsErr.value = ''
  logs.value = []
  logHint.value = ''
  /* v454（R13）每次打开都回到「订单日志」页 —— 上次停在物流页、这次打开还停在那儿，
     用户会以为"日志没了"（其实只是停在另一个页签）。 */
  logTab.value = 'order'
  try {
    const d = await psiApi.getPurchaseLogs(oid.value, logPid.value)
    logs.value = Array.isArray(d.entries) ? d.entries : []
    logHint.value = d.hint || ''
  } catch (e) {
    logsErr.value = e.message || '日志读取失败'
  } finally {
    logsLoading.value = false
  }
}

/* ---- 附件（v408 P1-8）-----------------------------------------------------
   复用后端既有的 `attachments` 表 + `db.attachment_*`；本页只做「选文件 → 上传 → 列/下/删」。
   🔴 三条纪律：
     1. **上传前先按 `max_mb` 预检**：base64 会把体积放大约 1/3，等到服务端才 400，
        用户已经白等一次上传 —— 但预检只是**体验**，服务端另有硬校验，不靠前端兜底。
     2. **失败必须显示**：同名 / 类型 / 大小都会被后端明确拒绝，原因直接显示，
        不许 `catch {}` 吞掉（恒空零报错 = 静默失效的老毛病）。
     3. **下载走 `apiBlob`**：鉴权是 Bearer 头，`<a href>` 带不了 ⇒ 只能 fetch 成 blob。 */
const attOpen = ref(false)
const attLoading = ref(false)
const attBusy = ref(false)
const attMsg = ref('')
const attaches = ref([])
const attachMaxMb = ref(20)          // 服务端下发（`max_mb`），前端默认值只是兜底
const attFileEl = ref(null)
const attachCount = computed(() => attaches.value.length)

async function loadAttach () {
  try {
    const d = await psiApi.getPurchaseAttachments(oid.value)
    attaches.value = Array.isArray(d.items) ? d.items : []
    if (Number(d.max_mb) > 0) attachMaxMb.value = Number(d.max_mb)
  } catch (e) {
    // 列表读不到**不弹错误**：附件不是这张单的主体，不该因为它挡住整个详情页。
    // 但必须留一条可追溯的痕迹（空列表 + 角标消失），不静默。
    attaches.value = []
    attMsg.value = e.message || '附件列表读取失败'
  } finally {
    attLoading.value = false
  }
}

function openAttach () {
  attOpen.value = true
  attMsg.value = ''
  attLoading.value = true
  loadAttach()
}

function pickAttach () {
  if (attFileEl.value) attFileEl.value.click()
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

async function onAttachPick (ev) {
  const el = ev.target
  const f = el.files && el.files[0]
  el.value = ''                       // 清空 ⇒ 再选同一个文件仍会触发 change
  if (!f) return
  if (f.size > attachMaxMb.value * 1024 * 1024) {
    attMsg.value = `「${f.name}」超过 ${attachMaxMb.value}MB 上限（实际 ${(f.size / 1024 / 1024).toFixed(1)}MB）`
    return
  }
  attBusy.value = true
  attMsg.value = ''
  try {
    const b64 = await readFileAsBase64(f)
    const d = await psiApi.uploadPurchaseAttachment(oid.value, f.name, b64)
    attaches.value = Array.isArray(d.items) ? d.items : []
    attMsg.value = '已上传：' + f.name
  } catch (e) {
    attMsg.value = e.message || '上传失败'
  } finally {
    attBusy.value = false
  }
}

async function downloadAttach (a) {
  attBusy.value = true
  attMsg.value = ''
  try {
    const blob = await psiApi.downloadPurchaseAttachment(oid.value, a.id)
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = a.filename || 'attachment'
    document.body.appendChild(el)
    el.click()
    el.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    attMsg.value = e.message || '下载失败'
  } finally {
    attBusy.value = false
  }
}

async function removeAttach (a) {
  const nm = a.filename || '未命名'
  if (!window.confirm(`确定删除附件「${nm}」？删除后不可恢复。`)) return
  attBusy.value = true
  attMsg.value = ''
  try {
    await psiApi.deletePurchaseAttachment(oid.value, a.id)
    attaches.value = attaches.value.filter(x => x.id !== a.id)
    attMsg.value = '已删除：' + nm
  } catch (e) {
    attMsg.value = e.message || '删除失败'
  } finally {
    attBusy.value = false
  }
}

function openPay () {
  payErr.value = ''
  payForm.value = { amount: String(pay.value.unpaid_amount || ''), account: '现金', note: '' }
  payOpen.value = true
}function closePay () {
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

/* 点空白处关掉「打印设置」菜单（与列表页的批量菜单同一套写法）。
   模板上 `.ipd-pm` 有 `@click.stop`，所以菜单内部的点击不会走到这里死循环关自己。 */
/* 点页面空白处收起所有下拉（打印组 / 审核组 / 更多）。几个都要关 ——
   只关一个的话，点打印按钮时审核菜单会挂在原位不动，看起来像"卡住了"。
   v452：更多菜单里的动作（复制 / 日志 / 附件 / 转单 / 翻单）点了也要收起来，
   否则菜单挂在页面上跟着 `window.print()` 一起印出去（打印样式只兜了 `.ipd-pm-menu`，
   但用户视角是"菜单没关"）。 */
function onDocClick () { printOpen.value = false; auditOpen.value = false; moreOpen.value = false }

onMounted(() => {
  document.addEventListener('click', onDocClick)
  loadAll()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.inv-page { display: block }
.ipd-acts { display: flex; gap: 8px; flex-wrap: wrap }
/* v452（O8）页头状态 tag 弱化：原 22px 高 + 12px 字与标题争夺视线。
   状态是单据的属性，不该和「采购单详情」四个字抢主角 —— 收到 20px/11px。 */
.page-sub .tag { height: 20px; padding: 0 7px; font-size: 11px }

/* ---- 打印设置（v408 P1-4）------------------------------------------------
   主按钮 + 小箭头 + 次数读数 + 下拉菜单 = 一个视觉整体：
   `inline-flex` 让三者贴排（`gap:0`），`position:relative` 给菜单当定位锚。
   ⚠️ 变量名走**真实 token**（`--bg`/`--bd`/`--bg2`/`--radius-md`）。
      写成 `--bg-card` 那种不存在的名字**不报错、也不生效**（静默失效），
      所以我先把 `variables.css` 里的真名查出来才下笔。 */
.ipd-pm { position: relative; display: inline-flex; align-items: center; gap: 0 }
/* 两半拼成一个按钮：去掉中间的重复边框与内侧圆角，否则接缝处是双线 */
.ipd-pm-main { border-top-right-radius: 0; border-bottom-right-radius: 0 }
.ipd-pm-caret {
  padding: 0 7px; border-left: 0;
  border-top-left-radius: 0; border-bottom-left-radius: 0;
}
/* 三角用纯 CSS 画（`currentColor` 跟随主题），不引图标字体：
   5 行 CSS 换掉一个额外依赖，且深色模式自动跟着走。 */
.ipd-pm-tri {
  display: block; width: 0; height: 0;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform .15s;
}
.ipd-pm-tri.up { transform: rotate(180deg) }

.ipd-pm-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: var(--z-dropdown);
  min-width: 268px; padding: 4px; text-align: left;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}
/* v452（O1）「更多 ▾」菜单：收录 9 项 + 4 个分组标题 ⇒ 必须限高可滚，
   否则矮窗口下会把「确认入库」主按钮挤出视口（点了没反应的另一种形态）。 */
.ipd-more-menu { min-width: 300px; max-height: 72vh; overflow: auto }
.ipd-pm-hd { padding: 6px 10px 4px; font-size: 12px; color: var(--t3) }
.ipd-mi {
  display: block; width: 100%; padding: 7px 10px; border: none; background: none;
  border-radius: var(--radius-sm); text-align: left; font-size: 13px;
  line-height: 1.45; color: var(--t1); cursor: pointer;
}
.ipd-mi:hover { background: var(--bg2) }
/* 菜单项副标题：解释「这条和那条差在哪」，否则两个「打印」会让人分不清 */
.ipd-mi-n { display: block; margin-top: 2px; font-size: 12px; color: var(--t3) }
/* v414（P2-6）「转单为」菜单里**置灰**的两项（销售单 / 调拨单：没有承接实体）。
   灰显 + 副标题写明原因 —— 比放两个点了没反应的假入口诚实。
   🔴 `:hover` 必须一起压掉：不压的话鼠标划过仍会亮起来，看着像"能点"。 */
.ipd-mi:disabled { color: var(--t3); cursor: not-allowed }
.ipd-mi:disabled:hover { background: none }

/* 注意：`.ipd-hd` / `.ipd-f`（竖排字段卡）**仍被「入库单」页签使用**，不删；
   v452 起「采购订单详情」页签换用下面这套单行横排的 `.ipd-barhd` / `.ipd-bf`。 */
.ipd-hd { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; align-items: baseline }
.ipd-f { display: flex; flex-direction: column; gap: 4px }
.ipd-f-grow { flex: 1; min-width: 200px }

/* v452（O5）单据信息带：单行 compact bar（舟谱同款）。
   主字段横排（label 左 value 右），金额组贴右侧；字段多时自然换行不断裂。
   🔴 底色用 `--bg2` 而不是卡片白底 + 阴影：这是"信息带"不是"卡片"，
      舟谱同款是一条灰底横条，视觉重量低于表格、高于空白。 */
/* v453（R7）信息带**白底去边框**：原来是一个「灰底 + 全边框 + 圆角」的盒子，
   与下面的明细卡片**抢视觉重量** —— 它装的只是一行字段，不需要一个框。
   改成无边框、只留一条下分隔线把它和下面的内容分开。
   🔴 用 `transparent` 而不是写死 `#fff`：深色模式下必须跟着页面走，写死会变一块白斑。 */
.ipd-barhd {
  display: flex; align-items: baseline; flex-wrap: wrap;
  gap: 6px 22px; margin-bottom: 10px; padding: 6px 0 10px;
  background: transparent;
  border: 0; border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
}
.ipd-bf { display: flex; align-items: baseline; gap: 7px; white-space: nowrap }
.ipd-bf-grow { flex: 1; min-width: 220px; white-space: normal }
.ipd-bfv { font-size: 13px; color: var(--t1); font-weight: 500 }
/* 备注可长：限宽省略号，全量仍在 title 与展开区里 —— 不把信息带撑翻。 */
.ipd-bfv-note {
  max-width: 240px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-weight: 400; color: var(--t2);
}
/* v452-followup（O10）：行内编辑 —— 字段旁铅笔图标（不往动作区加按钮，遵守工具栏精简纪律）。 */
.ipd-pencil {
  margin-left: 6px; padding: 2px; border: 0; background: transparent; cursor: pointer;
  color: var(--t3); line-height: 0; border-radius: 5px;
}
.ipd-pencil:hover { color: var(--c-blue, #2f6fed); background: rgba(47, 111, 237, .08) }
.ipd-edit-in {
  width: 220px; max-width: 100%; padding: 4px 8px; font-size: 13px;
  border: 1px solid var(--t3, #cfd6e0); border-radius: 6px; background: #fff; color: var(--t1);
}
/* v453（R5）：下拉（经办人 / 部门 / 仓库）用的窄控件。
   🔴 比 `.ipd-edit-in` 窄一号是刻意的：这四个下拉挤在**同一行信息带**里，
      都用 220px 会把一行撑成三行，信息带就失去"一眼看完"的意义了。 */
.ipd-edit-sel {
  width: 150px; max-width: 100%; padding: 4px 6px; font-size: 13px;
  border: 1px solid var(--t3, #cfd6e0); border-radius: 6px; background: #fff; color: var(--t1);
}
/* 日期输入（单据日期 / 预计到货）：内容宽度固定，比文本输入更窄。 */
.ipd-edit-in-sm { width: 140px }
/* v453（R3）备注字数计数。`maxlength` 到顶是**静默截断**（不提示、不报错），
   加一个计数器才看得出「快到顶了」；满 200 字转红。 */
.ipd-edit-count {
  margin-left: 6px; font-size: 11px; color: var(--t3);
  font-variant-numeric: tabular-nums;
}
.ipd-edit-count-max { color: #d8453b }
/* v453：编辑态的操作行 —— 从「更多信息」里搬到信息带正下方（R5 之后必须常驻可见）。
   ⚠️ 原来那条 `border-top: dashed` 是「卡片内分隔」用的，独立成行后不再需要。 */
.ipd-edit-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 10px }
.ipd-edit-actions .ipd-err { color: #d8453b }
.ipd-edit-lock { color: var(--t3) }
/* 金额组：`margin-left:auto` 永远贴右（舟谱把总金额放在信息带右侧同一行）。 */
.ipd-bmoney { margin-left: auto; display: flex; gap: 26px; flex-wrap: wrap }
.ipd-bm { display: flex; align-items: baseline; gap: 7px; white-space: nowrap }
.ipd-bmv { font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums }
/* v453（R1）供应商余额组：与本单金额之间一条竖线分隔 + 字色弱一档。
   左边三项是「这一单的钱」，右边两项是「这家供应商累计」，口径不同不混读。
   🔴 `.ipd-bmv-sub` 必须写在 `.ipd-bmv` **之后**（同特异度，后来者胜）。 */
.ipd-bm-sep { align-self: stretch; width: 1px; background: var(--border-subtle); margin: 2px 0 }
.ipd-bmv-sub { color: var(--t2); font-size: 13px }

/* v452（O5）更多信息：默认收起的一行次要字段（创建人 / 审核时间 / 预计到货 /
   供应商类别 / 应付预付余额 / 补充信息）。收起 = 不占首屏，也没丢任何一个字段。 */
.ipd-moreinfo { margin-bottom: 12px }
.ipd-moreinfo-tg {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: none; padding: 2px 0;
  font-size: 12px; color: var(--t3); cursor: pointer;
}
.ipd-moreinfo-tg:hover { color: var(--t2) }
.ipd-moreinfo-tri {
  display: block; width: 0; height: 0;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
}
.ipd-moreinfo-tri.up { transform: rotate(180deg) }
.ipd-moreinfo-body {
  display: flex; flex-wrap: wrap; gap: 6px 22px;
  margin-top: 8px; padding: 10px 16px;
  background: var(--bg2); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

/* ---- 以下四条是**原有规则**（v452 改造时一度被误删，已补回）----
      `.ipd-lb` 全页标签共用；`.ipd-amt`/`.ipd-amt-due` 货款页签在用；
      `.ipd-mono` 单号/条码在用；`.ipd-conv` 明细表单位列/采购价/数量的
      折小单位小字在用。删任何一个都是静默失效（样式不报错，只是不生效）。 */
.ipd-lb { font-size: 12px; color: var(--t3) }
/* v454（R10）可编辑字段星号 + 图例。对齐舟谱的 `*` 视觉，但语义是「可改」不是「必填」
   ⇒ 颜色用主题危险色（与「未结」「错误」同一个红），一行图例把话说清。 */
.ipd-req { color: var(--danger-txt); font-style: normal; margin-right: 2px; font-weight: 600 }
.ipd-reqnote {
  margin: -4px 0 10px; padding: 0 2px;
  font-size: 12px; color: var(--t3);
}
.ipd-reqnote .ipd-req { margin-right: 3px }
.ipd-amt { font-size: 16px; font-variant-numeric: tabular-nums }
.ipd-amt-due { color: var(--danger) }
.ipd-mono { font-variant-numeric: tabular-nums; font-family: var(--font-mono) }
/* v409（P2-1）折小单位小字：解释性文案，弱化色 + 单独一行不抢主数字。 */
.ipd-conv {
  display: block; margin-top: 2px;
  font-size: 11px; color: var(--t3); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

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

/* ══ v415（P2-7）补充信息（自定义字段）在信息卡里的展示 ═══════════════════════
   一组 `标签 值` 小胶囊横排、可换行；字段多时不会把卡片撑成一长条。
   「未填写」用弱色 —— 它是状态说明，不是数据。 */
.ipd-cf-list { display: flex; flex-wrap: wrap; gap: 6px 14px }
.ipd-cf-i { font-size: 13px; color: var(--t1); white-space: nowrap }
.ipd-cf-i i { font-style: normal; color: var(--t3); font-size: 12px; margin-right: 5px }
.ipd-cf-none { font-size: 13px; color: var(--t3) }
/* 行内「填写 / 修改」链接：体量与 `.ipd-lb` 同档，不抢信息卡的视线 */
.ipd-cf-edit {
  border: none; background: none; padding: 0 0 0 6px; margin-left: 2px;
  font-size: 12px; color: var(--p-dark); cursor: pointer;
}
.ipd-cf-edit:hover { text-decoration: underline }
/* 字段可能很多（上限 30 个）⇒ 弹层限高可滚，否则「保存」会被顶出屏幕 */
.ipd-cf-dlg { max-height: 78vh; overflow: auto }
.ipd-recv-ft .ipd-note { margin-right: auto }

/* v452（O2）商品明细**去卡片壳直铺**：舟谱同款密表 —— 表格自己带细边框与圆角，
   不再套 `.card`（那 18px padding + hover 阴影在详情页是纯消耗）。
   ⚠️ 去壳后表头底色（`table.tbl th` 的 `--bg2`）与外框同色系，视觉仍是一整张表。 */
.ipd-plain {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 12px;
}
/* v452（O6）商品名单元格里的规格小字：舟谱把规格并进商品名（如「…100*8杯（新）」）。
   小字 + 弱色 + 不换行挤压 —— 主名称永远是这一格的主角。 */
/* v453（R2）规格改**同行内联**：原来是 `display:block`（独占第二行），每行多占一行高度
   ⇒ 同屏能看的行数直接少一半。现在名称与规格同一行、规格是小字弱色。
   🔴 单行截断交给外层 `.ipd-name-line`：直接在 `<td>` 上写 `text-overflow` 对表格单元格
      **不生效**（auto 布局下 td 宽度由内容决定，压根不会被"溢出"），必须再套一层块级元素。 */
.ipd-name-line {
  display: block; max-width: 320px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ipd-spec {
  margin-left: 6px;
  font-size: 11px; color: var(--t3);
}
/* v452（O8）「未登记」灰字：原来是黄 tag，2 行商品 4 个黄块是纯噪音；
   "没登记批次"是状态说明，不是警示（真正的警示走 `ipd-hint` 与确认弹窗）。 */
.ipd-none { font-size: 12px; color: var(--t3) }

/* v452（O7）底部总额条：舟谱表格下方那条「订单总额」横条。
   对账 / 截图 / 打印时有一个明确的总计锚点（原来只有表内合计行）。 */
/* v453（R8）吸底总额条：明细行多的时候，滚到下面也能一直看到「这单多少钱」。
   🔴 `position:sticky` 生效的前提是**最近的滚动容器是视口** —— 所以它必须待在
      `.ipd-plain`（`overflow:hidden`）**外面**（模板里已经搬出来了），
      留在里面会**静默失效**（不报错、不崩，就是完全不动）。
   ⚠️ 搬出来后自带边框与圆角：它已经不是表格框内的最后一条了。 */
.ipd-total-bar {
  position: sticky; bottom: 0; z-index: 6;
  display: flex; align-items: baseline; gap: 10px;
  margin-bottom: 12px; padding: 9px 14px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2);
}
.ipd-total-lb { font-size: 12px; color: var(--t3) }
.ipd-total-amt { font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums }
.ipd-total-note { margin-left: auto; font-size: 12px; color: var(--t3) }

/* v452（O9）表格密度对齐舟谱：默认 8px/12px（原 10px/14px）。
   🔴 排除序号/齿轮两列（它们有自己的窄 padding：全局 `table.tbl th.seq-th` 8px 4px）。
   🔴 必须给 compact 密度开关配套一条：全局 `[data-density="compact"] table.tbl td`
      是 (0,2,2)，与这条同分 ⇒ 不写配套的话 compact 档会被这条盖掉，
      「紧凑模式」用户拿到的是 8px 而不是 4px（静默失效的老形态）。 */
table.tbl.ipd-tbl th:not(.seq-th),
table.tbl.ipd-tbl td:not(.seq-cell) { padding: 8px 12px }
[data-density="compact"] table.tbl.ipd-tbl th:not(.seq-th),
[data-density="compact"] table.tbl.ipd-tbl td:not(.seq-cell) { padding: 4px 10px }

.ipd-tbl { min-width: 1480px }
.ipd-tbl-wide { min-width: 1900px }
.ipd-c-name { min-width: 220px }
/* v408（P1-2）行备注列：可换行、限宽，否则一条长备注会把整张表撑出去 */
.ipd-note-cell { min-width: 160px; max-width: 280px; white-space: normal; word-break: break-word; color: var(--t2) }
/* v408（P1-6）行历史按钮列。宽度钉死（列内文字恒定），`nowrap` 防「历史」被折成两行。 */
.ipd-hist-th { width: 80px }
.ipd-hist-cell { width: 80px; white-space: nowrap }
.ipd-hist-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px }
.ipd-diff { color: var(--danger); font-weight: 600 }
tfoot td { font-weight: 600 }

/* ══ v453 ══════════════════════════════════════════════════════════════
   ①（R6）附件**图标按钮**：上传提回主路径，但不加文字 —— 遵守「不在主工具栏
      加文字按钮」的纪律；有附件时右上角一个数字角标，不点开菜单也知道有没有。
      ②（R9）页头左侧改 flex 基线横排：标题 / 单号 / 状态压成**一行**。
   ═══════════════════════════════════════════════════════════════════ */
.ipd-icobtn { position: relative; padding: 4px 8px }
.ipd-icobadge {
  position: absolute; top: -4px; right: -4px;
  min-width: 15px; height: 15px; padding: 0 3px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; background: var(--p-dark, #2f6fed); color: #fff;
  font-size: 10px; line-height: 1; font-variant-numeric: tabular-nums;
}
/* 🔴 全局 `.page-hd.split` 是 `align-items:flex-start` —— 左侧那个 div 里
   `<h2>` 是块级元素，会把副标题（单号 + 状态）挤到第二行。这里把左侧自己
   变成 flex 基线横排即可压回一行，不动全局规则（其它页面不受影响）。 */
.ipd-hd-l { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px }

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

/* ---- 查看日志弹层（v408 P0-4）----
   🔴 `max-height` + `overflow:auto` 是**必须**的：日志行数随单据年纪增长，
      不设上限时内容会顶出视口，弹层顶部（标题）就**够不到**，用户只能刷新页面。
      两级限高：弹层 ≤78vh，内层表格 ≤50vh（表格自己滚，标题与说明留在视野里）。 */
.ipd-dlg-wide { width: min(820px, 94vw); max-height: 78vh; overflow: auto }
.ipd-logwrap { max-height: 50vh; overflow: auto }
.ipd-log-op { width: 96px; white-space: nowrap }
.ipd-log-at { width: 170px; white-space: nowrap; font-variant-numeric: tabular-nums }
.ipd-log-ev { width: 108px; white-space: nowrap }
.ipd-log-dt { color: var(--t2); word-break: break-all }
.ipd-loghint { margin: 12px 0 0; line-height: 1.6 }
/* v454（R13）日志弹层页签：复用全局 `.main-tabs / .main-tab`，只收一档间距 ——
   弹层里不需要页级页签那么大的上下留白（页级 16px / 10px 18px 在这里会顶掉表体空间）。 */
.ipd-logtabs { margin-bottom: 12px }
.ipd-logtabs .main-tab { padding: 8px 14px; font-size: 13px }
.ipd-logistics { padding: 6px 0 2px }
.ipd-log-note { margin: 4px 0 0; max-width: 460px; font-size: 12px; color: var(--t3); line-height: 1.7 }

/* ---- 附件（v408 P1-8）----
   ⚠️ 这些是**本页私有**样式：附件 UI 目前只有采购单详情页一处。将来第二处要用时，
      按 UI-SPEC §8「同选择器 ≥3 次且逐字同 ⇒ 上提全局类」再上提 —— 现在上提是过度设计。 */
.ipd-at-badge {
  margin-left: 6px; padding: 0 6px; border-radius: 999px;
  background: var(--bg2); color: var(--t2);
  font-size: 11px; font-variant-numeric: tabular-nums;
}
/* 隐藏的 file input：**不能用 `display:none`** —— 部分浏览器下 `.click()` 不触发；
   用「移出视野但保留可点击」的写法，各浏览器行为一致。 */
.ipd-at-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none }
.ipd-at-nm { word-break: break-all }
.ipd-at-by { width: 96px; white-space: nowrap; color: var(--t2) }
.ipd-at-op { width: 168px; white-space: nowrap }
.ipd-at-op .btn + .btn { margin-left: 6px }

/* 打印：只留当前页签的数据表。页签条 / 动作区 / 提示条 / 弹层一律不印
   —— 打印出来的应该是单据本身，不是界面外壳。 */
@media print {
  /* `.ipd-pm-menu` 单列一遍是**有意的冗余**：整个动作区已经在 `.ipd-noprint` 里，
     但它是一个 `position:absolute` 的浮层，一旦将来有人把打印按钮挪出 `.ipd-noprint`，
     菜单就会连同整张单一起印给供应商（而且只在「开着菜单时打印」这一种路径下出现，
     自测极难撞到）。一个选择器换掉这个风险。 */
  .ipd-noprint, .ipd-mask, .ipd-pm-menu { display: none !important }
  .card { border: none; box-shadow: none; padding: 0 }
  /* v452：明细表去壳后（.ipd-plain）打印时同样去边框，与卡片口径一致。 */
  .ipd-plain { border: none; border-radius: 0 }
  .table-wrap { overflow: visible; border: none; border-radius: 0 }
  .ipd-tbl, .ipd-tbl-wide { min-width: 0; width: 100% }
  .ipd-c-name { min-width: 0 }
  /* 总额条要印（舟谱打印稿有「订单总额」），但浅色底纹印不出来 ⇒ 补一条实线。 */
  .ipd-total-bar { background: none; border-top: 1px solid var(--t3) }
}

@media (max-width: 900px) {
  .ipd-pay { grid-template-columns: 1fr }
}

@media (max-width: 640px) {
  .ipd-hd { gap: 14px }
  .ipd-barhd { gap: 6px 14px }
  .ipd-bmoney { margin-left: 0; gap: 18px }
  .ipd-recv-ft .ipd-note { width: 100%; margin-right: 0 }
}
</style>
