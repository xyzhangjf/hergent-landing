<template>
  <!-- v129：全屏时给根节点挂 grid-fs-on，用于把主工具栏弹层容器降回普通层级（见样式区注释） -->
  <!-- v135：AI 副驾抽屉打开时挂 copilot-on，同理收掉主工具栏弹层的超高 z-index，避免三个触发按钮浮在抽屉之上 -->
  <div class="page" :class="{ 'grid-fs-on': gridFullscreen, 'copilot-on': store.ui.copilotOpen }">
    <!-- 模块级标签页：本期预报 / 历史期次（历史分析工具改在汇总表工具箱「对比分析」组，见下） -->
    <div class="module-tabs">
      <button :class="{ on: activeTab === 'summary' }" @click="activeTab = 'summary'">本期预报</button>
      <button :class="{ on: activeTab === 'history' }" @click="activeTab = 'history'">历史期次</button>
      <button :class="{ on: activeTab === 'config' }" @click="activeTab = 'config'">报单配置</button>
    </div>

    <template v-if="activeTab === 'summary'">
    <!-- v193（既定方案 §五 阶段 0）：「无进行中期次」时的**常驻**通告 + 就地出口。
         为什么不改成「点了导入才弹错误」：既定方案的判据是
           「📌 **禁用 + 说明好过「点了弹错误」** —— 错误弹窗只在你已经动过手之后才来」。
         判据 noOpenPeriod = **已成功问到后端** && 没有 open 期次（与后端导入硬闸同源，
         见代码区 GATE_MSG / canImport 上方注释）；接口没问到时不显示，避免误报。 -->
    <div v-if="noOpenPeriod" class="gate-bar" role="status">
      <Icon name="calendar"/>
      <span class="gate-txt"><b>{{ GATE_LEAD }}</b>{{ GATE_REST }}</span>
      <button class="btn btn-sm btn-primary" @click="openNewPeriod"
              :title="showNewPeriod ? '收起新建期次表单' : '新建期次：设置期次名称与下单 / 到货日期'"><Icon name="plus"/> 新建期次</button>
    </div>
    <!-- 报单期次选择 -->
    <div class="card toolbar" :class="{ 'tb-dense': editMode }">
      <!-- 工具栏单行布局（2026-09-12）：期次上下文 | 搜索与数据进出 | 决策与编辑，三段以 .tb-sep 分隔。
           原双行结构（.tb-head 行1 / .tb-right 行2）合并为一行；表格级筛选器（仅显示有报单 / 品牌）
           下移到表格卡片顶部的 .grid-ctl-row，贴近其作用的表格。
           v167：「复制报单」随之下移 —— 它与品牌筛选是同一条动作链的两步（先勾品牌，再复制这些品牌的
           厂家编码 / 最终下单数量），品牌在表体上方、复制却在页头，用户勾完要走回头路；且它只对当前
           这张汇总表生效，本就属表格级动作（原挂在"数据进出"段，见 .tb-data 注释）。下移后同行相邻。
           v168：下移后进一步收敛为**只读态专属** —— 编辑态（改单）撤掉复制入口，因草稿未定稿。
           搜索框留在工具栏：findText 跨视图生效（汇总表 / 逐单补录 / 编辑态 / 导出），属全局检索。
           编辑态多出 5 个编辑按钮，故编辑控制组 .tb-edit-group 独占第二行（flex:0 0 100%）。
           v169 校准：原写「6 个」—— v168 撤掉编辑态的「复制报单」后实为 5 个（取消、回退、查错、补录商品、保存）。 -->
      <div class="tb-group tb-ctx">
          <select v-model="curPeriod" class="input sel-period" @change="onPeriodChange">
            <option value="0">— 选择期次 —</option>
            <option v-for="p in periods" :key="p.id" :value="p.id" :title="p.order_start + ' ~ ' + p.order_end">{{ p.name }}</option>
          </select>
          <!-- 2026-09-12：「新建期次」为高频操作，从原「⋯」溢出菜单中提出，直接以按钮常显在期次选择器右侧
               （仍在 .tb-ctx 段内，占用原 ⋯ 的位置）。按钮常显、不依赖 currentPeriod —— 未选期次时也能新建。
               原菜单中的「关闭期次 / 删除期次」属低频且只作用于“当前已选中的那个期次”，
               已由「历史期次」页每行的「关闭 / 删除」按钮承担（ForecastHistory.vue，同样走 askClose / askDelete），
               故移除 ⋯ 菜单不损失任何能力。 -->
          <button class="btn btn-sm btn-ghost" @click="openNewPeriod"
                  :title="showNewPeriod ? '收起新建期次表单' : '新建期次：设置期次名称与下单 / 到货日期'"
                  aria-label="新建期次"><Icon name="plus"/> 新建期次</button>
          <!-- 审批状态属于「期次」上下文，紧随期次选择器（原在行1 尾部、与筛选器混排） -->
          <span v-if="confirmInfo" class="confirm-badge ok"><Icon name="check" /> 已确认{{ confirmInfo.by ? ' · ' + confirmInfo.by : '' }}</span>
          <span v-else class="confirm-badge draft">待审核</span>
      </div>
      <span class="tb-sep"></span>
      <div class="tb-group tb-data">
        <div class="tb-search">
          <Icon name="search"/>
          <input id="gridFind" v-model="findText" @keydown="onFindKey" class="fld" placeholder="搜索商品名 / 条码（后 4 位也行）…" aria-label="筛选商品名或条码">
        </div>
        <!-- v193：导入的前置条件是**已新建期次**（判据与后端落库口径同源，见 openImport 上方注释）。
             未建期次时按钮置灰并说明原因，而不是隐藏 —— 隐藏会让用户以为功能被删了，
             而「新建期次」按钮就在同一行的左侧一格，置灰 + 指路比消失更好懂。 -->
        <button class="btn btn-sm btn-ghost" @click="openImport" :disabled="!canImport"
                :title="canImport ? '从 Excel 导入预报订单汇总表' : importBlockedReason"><Icon name="upload"/> 导入</button>
        <div class="tb-pop">
          <button ref="exportBtn" class="btn btn-sm btn-ghost" :class="{on:exportMenuOpen}" @click="toggleTbPop('export')" title="导出：全部 / 选中行 / 差异"><Icon name="download"/> 导出 <Icon name="chevron-down"/></button>
          <Teleport to="body">
          <div v-if="exportMenuOpen" class="tb-pop-panel" :style="popStyle" @click.stop>
            <button class="grp-btn" @click="exportAllXlsx(); exportMenuOpen=false"><Icon name="download"/> 导出全部（当前汇总表）</button>
            <button class="grp-btn" @click="ctxExportSel(); exportMenuOpen=false"><Icon name="download"/> 导出选中行</button>
            <button class="grp-btn" :disabled="!snapCompare" title="需先在快照对比中选两个期次" @click="exportDiffXlsx(); exportMenuOpen=false"><Icon name="download"/> 导出差异（快照对比）</button>
            <div class="zp-sep"></div>
            <div class="zp-hd">舟谱导入模板<span class="zp-hd-sub">· 按当前期次已导入的下单</span></div>
            <button class="grp-btn" :disabled="!currentPeriod || !!zhoupuBusy" title="生成可直接导入舟谱的自提订单 xlsx（直营/分销客户）" @click="zhoupuGen('zhoupu-pickup')"><Icon name="download"/> 自提订单模板</button>
            <button class="grp-btn" :disabled="!currentPeriod || !!zhoupuBusy" title="生成可直接导入舟谱的调拨订单 xlsx（车销业务员，总仓→业务员仓）" @click="zhoupuGen('zhoupu-transfer')"><Icon name="download"/> 调拨订单模板</button>
            <button class="grp-btn" :disabled="!currentPeriod || !!zhoupuBusy" title="自提+调拨两份打包为 zip，一次下载" @click="zhoupuGen('zhoupu-all')"><Icon name="package"/> 合并包（自提+调拨 zip）</button>
          </div>
          </Teleport>
        </div>
      </div>
      <span class="tb-sep"></span>
      <div class="tb-group tb-act">
        <button class="btn btn-sm btn-ghost" :disabled="!cross.period" @click="onSuggest" title="按体检/货损/返利/起订量生成建议并打开审核"><Icon name="sparkle"/> <span class="tb-ai-txt">AI智能建议</span></button>
        <!-- v209：全屏时让位给表格工具行里那一份（全屏层 fixed/inset:0 把本工具栏整条盖住 ⇒ 这里的按钮点不到）。
             非全屏照旧渲染于此。判据见 fsRowHosting。 -->
        <!-- v219：已定稿（关闭）的期次禁用改单 —— 与后端 save_matrix 闸门同源，避免「能改但保存被拒」 -->
        <button v-if="!editMode && !fsRowHosting" class="btn btn-sm btn-primary" :disabled="loadingEdit || periodClosed"
                :title="periodClosed ? '该期次已定稿（关闭），不可改单；如需改动请到「往期预报」里先点「重开」' : (entryRoleWarn ? '当前角色（' + roleName(bizRole) + '）可能无填报权限，点击会先提示确认' : '改单：进入可编辑网格，支持整表粘贴、批量录入、增删商品行')"
                @click="enterEdit"><Icon name="edit"/> {{ loadingEdit ? '载入中…' : '改单' }}</button>
        <!-- 编辑态：高级工具（审批/推送/打印 + 健康体检/AI工具/协同闭环/更多工具） -->
        <div v-if="editMode" class="tb-pop">
          <button ref="advBtn" class="btn btn-sm btn-ghost" :class="{on:advToolsOpen}" @click="toggleTbPop('adv')">工具箱 <Icon name="chevron-down"/></button>
          <Teleport to="body">
          <div v-if="advToolsOpen" class="tb-pop-panel" :style="popStyle" @click.stop>
            <button class="grp-btn" @click="subOpen=!subOpen"><Icon name="approve"/> 审批流</button>
            <button class="grp-btn" @click="pushForecast" :disabled="pushing"><Icon name="upload"/> 推送企微审批</button>
            <button class="grp-btn" @click="printGrid"><Icon name="print"/> 打印</button>
            <div class="tb-pop-sep"></div>
            <button class="grp-btn" :class="{on:openGroup==='quality'}" @click="openGroup=openGroup==='quality'?null:'quality'">健康体检</button>
            <button class="grp-btn" :class="{on:openGroup==='smart'}" @click="openGroup=openGroup==='smart'?null:'smart'">AI工具</button>
            <button class="grp-btn" :class="{on:openGroup==='collab'}" @click="openGroup=openGroup==='collab'?null:'collab'">协同通知</button>
            <button class="grp-btn" :class="{on:openGroup==='hist'}" @click="openGroup=openGroup==='hist'?null:'hist'" title="对当期汇总表做对比分析：近6期趋势 / 去年同期 / 任选对比期（结果以列形式加进汇总表）">对比分析</button>
            <button class="grp-btn" :class="{on:openGroup==='more'}" @click="openGroup=openGroup==='more'?null:'more'">更多工具</button>
          </div>
          </Teleport>
        </div>
      </div>
      <!-- 编辑控制组：编辑态 6 个按钮独占第二行，紧贴下方表格（视线与鼠标行程最短）。
           v209：全屏时让位给表格工具行里那一份（判据见 fsRowHosting）——全屏层把本行盖住，
           而用户此时**正在改单**，够不着的代价最大。 -->
      <div v-if="editMode && !fsRowHosting" class="tb-edit-group">
        <!-- Q12/Q30：编辑按钮带载入态与权限提示；Q25：校验按钮带待修正角标；Q27：失败后按钮变「重试保存」 -->
        <button class="btn btn-sm btn-ghost" @click="exitEdit">取消</button>
        <!-- v201：可用性与状态条**同源** —— 原为 `:disabled="!lastSavedSnap"`，
             与状态条各判一套：草稿恢复那一态基线为 null，「回退」灰着，而状态条正说
             「有未保存的改动」。现在两者都只看 dirtySinceSave（＝有改动才可回退）。 -->
        <button class="btn btn-sm btn-ghost" :disabled="!dirtySinceSave" title="放弃自上次保存以来的改动，回到起点（上次保存时的内容；本次若从未保存过，则是刚进入编辑时的服务端内容）" @click="undoToLastSaved">回退</button>
        <button class="btn btn-sm btn-ghost" title="全表录入查错：列出类型/必填/上限/条码重复等错误（可点击跳转）" @click="openErrList">
          查错<span v-if="errCount" class="btn-badge err">{{ errCount > 99 ? '99+' : errCount }}</span>
        </button>
        <button class="btn btn-sm btn-ghost" title="在网格末尾新增一行商品（补录商品）" @click="addRow"><Icon name="plus"/> 补录商品</button>
        <button class="btn btn-sm btn-primary" :class="{ 'btn-retry': !!saveFailed }" :disabled="noOpenPeriod"
                :title="noOpenPeriod ? saveBlockedReason : '保存本期报单矩阵'" @click="saveEdits">{{ savingEdit ? '保存中…' : (saveFailed ? '重试保存' : '保存') }}</button>
        <!-- v201：常驻的保存状态。保存成功只弹一条几秒即消失的提示，之后页面与保存前
             长得一模一样 ⇒ 用户无法确认「到底存进去了没有」。这里给一个**一直挂着**的答案
             （保存失败另有红色横幅，两者语义不重叠）。
             v208：保存成功已改为**退出编辑态**（回到带「改单」按钮的只读态），
             状态条随之不再可见 —— 它的受众是「正在编辑、准备再改一轮」的人。 -->
        <span class="save-state" :class="saveState.cls"
              :title="saveState.cls === 'dirty' ? '改动还没提交：点右侧「保存」才会生效'
                     : (saveState.cls === 'saved' ? '内容已提交到服务器；继续改动需再次点「保存」'
                        : '本次进入编辑后还没有任何改动')">
          <i class="ss-dot"></i>{{ saveState.text }}
        </span>
      </div>
      <div v-if="(advToolsOpen && editMode) || exportMenuOpen || brandPopOpen || copyMenuOpen" class="pop-overlay" @click="advToolsOpen=false; exportMenuOpen=false; brandPopOpen=false; copyMenuOpen=false"></div>
    </div>


    <!-- 新建期次表单（紧贴工具条，随时可点，不依赖视图） -->
    <div v-if="showNewPeriod" class="card new-period">
      <div class="np-row">
        <!-- v242e：改成**可见 label**。原先四个字段只靠 placeholder 标识，而 placeholder
             一旦有值就消失 —— 预填改为「今天/明天/明天+4」后**永远有值**，于是打开表单看到的是
             三个光秃秃的日期，分不出哪个是下单开始、哪个是到货。与同页 2252 行那组字段同范式。 -->
        <label class="np-fld np-fld-name"><span>期次名称</span>
          <input v-model="np.name" class="input" placeholder="如 8月25日报单-8月29日到货" @input="onPeriodNameInput"></label>
        <!-- v180：手工改过的字段会被标记 —— 名称解析不再静默覆盖它 -->
        <label class="np-fld"><span>下单开始</span>
          <input v-model="np.order_start" class="input" type="date" @input="markNpTouched('order_start')"></label>
        <label class="np-fld"><span>下单截止</span>
          <input v-model="np.order_end" class="input" type="date" @input="markNpTouched('order_end')"></label>
        <label class="np-fld"><span>预计到货</span>
          <input v-model="np.arrival" class="input" type="date" @input="markNpTouched('arrival')"></label>
        <!-- v180：名称里能识别出日期时才出现。原本「名称 → 日期」是**静默覆盖**，
             现在拆成「自动只填空字段」+「显式按名称重算」两条路。 -->
        <button v-if="npNameDates.length" class="btn btn-sm btn-ghost" @click="applyNameDatesNow"
                title="按名称里的日期重算三个日期（会覆盖你手改过的）"><Icon name="refresh"/> 按名称更新日期</button>
        <!-- v242f：显式「取消」。此前唯一出路是"再点一次工具栏的新建期次"（按钮长得不像开关，
             用户反馈"不想建了只能刷新"）。放主按钮左侧，与全站弹窗底栏「取消 / 主操作」同序。 -->
        <button class="btn btn-sm btn-ghost" @click="cancelNewPeriod">取消</button>
        <!-- v242g：补 btn-sm。原先「创建」是默认档 .btn（36px），而「取消」与
             「按名称更新日期」是 .btn-sm（32px）⇒ 同一行三个按钮两种高度。
             统一到本页既有习惯（工具栏「新建期次」也是 btn-sm）；主次仍靠 btn-primary 的颜色区分，
             不靠尺寸 —— 尺寸只应表达"紧凑/常规"，不该在同一行里分组。 -->
        <button class="btn btn-sm btn-primary" @click="createPeriod">创建</button>
      </div>
      <!-- v242c：口径提示 —— 自动建表用「报单日前一天 ~ 报单日」，手工建期建议一致，
           否则同一种期次的「报单窗口」在列表里显示成两种样子。非阻塞，仅提示。 -->
      <p v-if="npSingleDayWarn" class="np-hint-warn">{{ npSingleDayWarn }}</p>
      <!-- 软警告：同名 / 窗口重叠。硬规则由后端 period_validate 拦截，此处不重复实现 -->
      <ul v-if="npSoftWarn.length" class="np-warn">
        <li v-for="(w, i) in npSoftWarn" :key="i">{{ w }}</li>
      </ul>
    </div>

    <input ref="impFileInput" type="file" accept=".xlsx,.xls" style="display:none" @change="onImportFile">

    <Teleport to="body">
      <Transition name="fade"><div v-if="impOpen" class="imp-overlay" @click="impOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="impOpen" class="imp-modal" :class="{ 'imp-wide': impState === 'preview' }">
          <div class="imp-hd"><b>导入预报订单 Excel</b><button class="imp-x" @click="impOpen = false"><Icon name="close"/></button></div>
          <div v-if="!impState" class="imp-body">
            <p class="imp-tip">选择你现有的订单汇总表（行=商品、列=客户、格=数量）。系统自动识别商品列与客户列，导入后即汇总进交叉表。</p>
            <!-- v180：归属期次前置展示。归到哪个期次是**导入那一刻**由后端定死的，
                 导入后再命名不会把它挪过去 —— 所以这个问题只能在导之前回答。
                 v193：这一支（无期次）**正常流程已不可达** —— 入口按钮已按 canImport 置灰、
                       openImport 里也硬拦。保留它是**兜底**（后端同轮加了硬闸，此支只覆盖
                       「抽屉已开着时期次被别的会话删掉」这类竞态），不是主路径。 -->
            <p class="imp-own" :class="{ warn: !impOwnedPeriodId }">
              <template v-if="impOwnedPeriodId">
                本期归属：<b>{{ impOwnedName }}</b>
              </template>
              <template v-else>
                <b>你现在还没有期次</b> —— 这次导入不会归到任何期次，之后再新建期次它也不会自动跟过去。
                <button class="btn btn-sm btn-ghost" @click="openNewPeriod()"><Icon name="plus"/> 先建一个期次</button>
              </template>
            </p>
            <p v-if="impViewMismatch" class="imp-own warn">
              你正在查看的是「{{ impViewedName }}」，但导入会归到「{{ impOwnedName }}」——
              导入的归属取的是<b>当前进行中的期次</b>，不是你正在看的这一期。
            </p>
            <div class="imp-actions">
              <button class="btn btn-ghost" @click="downloadFcTemplate"><Icon name="download"/> 下载模板</button>
              <button class="btn btn-primary" @click="pickFile">选择文件…</button>
            </div>
            <p v-if="impFileName" class="imp-file">已选择：{{ impFileName }}</p>
          </div>
          <div v-else-if="impState === 'preview'" class="imp-body">
            <p class="imp-tip">系统按列名猜字段，可能猜错（例如把「合计」当成客户列）。核对「识别为」这一列，不对就在下拉里改 —— 标「不导入」的列不会进来。</p>
            <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions" />
            <p v-if="impFactoryMissing" class="imp-gate">没有识别到「进价」列。进价闸门开启时，档案里也没有进价的行会被整行拒收 —— 文件里若有这一列（旧模版里叫「厂价」），请在上表把它改成「进价」。</p>
            <div v-if="impPreview.length" class="imp-matrix">
              <table class="tbl">
                <thead><tr><th v-for="(h, hi) in impHeaders.slice(0, 12)" :key="hi">{{ h }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, ri) in impPreview.slice(0, 4)" :key="ri">
                    <td v-for="(c, ci) in r.slice(0, 12)" :key="ci">{{ c }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="imp-ft">
              <button class="btn btn-ghost" @click="impState = null">重选文件</button>
              <button class="btn btn-primary" :disabled="!impCanExec || importing" @click="doImport">
                {{ importing ? '导入中…' : `确认导入（${impCustomerCount} 个客户）` }}
              </button>
            </div>
          </div>
          <div v-else-if="impState === 'done'" class="imp-body">
            <!-- v179：**四种结局必须分开渲染**。用户 2026-09-16 实测踩中的正是第二格
                 ——「商品都建档了、但一个客户列都没填数量」被旧文案渲染成绿色的
                 「导入成功：0 个客户」，他因此以为整个导入都成功了。
                 判据（有没有建档、有没有生成报单）由后端一次判完（archived_no_qty /
                 product_rows_count），前端不重推规则 —— 同一规则两处实现必然漂移。 -->
            <p v-if="impResult && impResult.results?.archived_no_qty" class="imp-none">
              <b>已建档 / 更新 {{ impResult.results?.products_affected_count || 0 }} 个商品，但没有生成任何报单。</b>
              原因：这份文件里所有客户列的数量都是空的 —— 数量由业务员从小程序报。
              如果你是要用这份模版<u>批量建商品档案</u>，这一步已经完成了，明细见下方「商品档案」。
              <!-- 「行数 ≠ 商品数」必须说清基数，否则用户拿行数对不上会以为漏导：
                   同条码的两行 = 同一商品的两个户头（见 v163 户头口径），登记按商品去重。 -->
              <template v-if="(impResult.results?.product_rows_count || 0) > (impResult.results?.products_affected_count || 0)">
                文件里有 {{ impResult.results?.product_rows_count }} 行商品身份行，
                其中 {{ impResult.results?.product_rows_count - impResult.results?.products_affected_count }} 行与前面的条码相同（同一商品的两个户头），计为同一个商品。
              </template>
            </p>
            <div v-else-if="(impResult?.results?.errors || []).length">
              <p class="imp-warn">导入完成，但有 {{ impResult?.results?.errors?.length || 0 }} 处异常：</p>
              <ul class="imp-errs"><li v-for="(e, i) in (impResult?.results?.errors || []).slice(0, 8)" :key="i">{{ e.msg }}</li></ul>
            </div>
            <p v-else-if="(impResult?.results?.success || 0) > 0" class="imp-ok">导入成功：{{ impResult.results?.success || 0 }} 个客户</p>
            <p v-else class="imp-none">
              这份文件里没有可导入的内容 —— 既没有识别到商品行（商品名称 / 条码），
              也没有任何客户列填了数量。
            </p>
            <!-- v180 归属回执：**仅在真的没归到期次时出现**（判据用后端回传的
                 results.period_id —— 权威值，不用前端预告）。
                 归属正常（>0）时这里什么都不显示：工具栏已有常显的「新建期次」，
                 常态再引导一次纯属噪音。也不做成自动弹窗 —— 导入已完成、数据已落库，
                 弹窗会让人以为「还没结束」而回头重导。 -->
            <div v-if="impResult && !impResultPeriodId" class="imp-arch">
              <div class="imp-arch-hd warn">这次导入没有归到任何期次</div>
              <p class="imp-arch-note">
                数据已经进来了，但你现在还没有期次 —— <b>之后再新建期次，这批商品和报单不会自动跟过去</b>。
                要现在建一个吗？
              </p>
              <button class="btn btn-sm btn-ghost" @click="closeImportAndReload(); openNewPeriod()">
                <Icon name="plus"/> 现在新建期次
              </button>
            </div>
            <!-- v163 导入回执：「导入成功了，但下游会出问题」必须显式给出。
                 判据（用户 2026-09-15）：「导入没有成功要给用户一个回执，说明不成功的原因」。
                 最典型的一条：报单对象不在「报单配置」里 → 生成舟谱单据时缺「客户全称 / 调拨仓」，
                 单据无法导入舟谱。旧实现对此**完全静默**（只显示「成功 N 个客户」），
                 用户要一路做到下单那一步才发现 —— 那时已经不知道是哪一列的问题了。 -->
            <div v-if="impWarnings.length" class="imp-arch">
              <div class="imp-arch-hd warn">需要注意</div>
              <ul class="imp-arch-list warn">
                <li v-for="(w, i) in impWarnings" :key="i">{{ w }}</li>
              </ul>
              <p v-if="impUnmapped.length" class="imp-arch-note">
                这些 Excel 列（共 {{ impUnmapped.length }} 个）不在「报单配置」里：
                <template v-for="(o, i) in impUnmapped.slice(0, 12)" :key="i">
                  <b>{{ o.name }}</b><span v-if="i < Math.min(impUnmapped.length, 12) - 1">、</span>
                </template><span v-if="impUnmapped.length > 12"> …</span>
              </p>
            </div>
            <!-- v157: 零档案建档结果（后端已回传 products_created_count / reused / unmatched / conflicts） -->
            <div v-if="impArchive" class="imp-arch">
              <div class="imp-arch-hd">商品档案</div>
              <div class="imp-arch-line">
                <span class="imp-arch-tag ok">自动建档 <b>{{ impArchive.created }}</b> 个</span>
                <span class="imp-arch-tag muted">复用已有 <b>{{ impArchive.reused }}</b> 个</span>
                <!-- v157：命中已有档案时顺带补进去的空字段（最常见的就是老商品没录进价） -->
                <span v-if="impArchive.backfilled" class="imp-arch-tag ok">补进已有档案 <b>{{ impArchive.backfilled }}</b> 个</span>
              </div>
              <ul v-if="impArchive.backfilledNames.length" class="imp-arch-list">
                <li v-for="(n, i) in impArchive.backfilledNames" :key="i">补录：{{ n }}</li>
              </ul>
              <p v-if="impArchive.backfilled" class="imp-arch-note">
                只有已有档案里<u>空着</u>的字段才会被补上（多为进价/规格），档案里已有的值一律不动。
              </p>
              <ul v-if="impArchive.createdNames.length" class="imp-arch-list">
                <li v-for="(n, i) in impArchive.createdNames" :key="i">新建：{{ n }}</li>
              </ul>
              <p v-if="impArchive.unmatched.length" class="imp-arch-note warn">
                有 {{ impArchive.unmatched.length }} 条商品没能建档（缺名称或缺条码），这些行的数量不会计入汇总：
              </p>
              <ul v-if="impArchive.unmatched.length" class="imp-arch-list">
                <li v-for="(n, i) in impArchive.unmatched.slice(0, 5)" :key="i">{{ n }}</li>
              </ul>
              <p v-if="impArchive.conflicts.length" class="imp-arch-note warn">
                有 {{ impArchive.conflicts.length }} 条条码冲突（同一张条码已存在别的商品名下），系统未覆盖任何已有档案，
                已记入「条码冲突」台账，请人工确认后处理。
              </p>
            </div>
            <!-- v158 进价闸门：连进价都没有的行被拒 —— 「整行不进报单」是硬结果，必须给补价入口指引。
                 闸门关闭时后端回传 factory_price_gate_on=false → 此块不渲染。
                 v165：判据口径已改「进价 → 标准售价」两档（原「厂价列 / 进价列」两列合一），故不再只看 factory_price 一列。 -->
            <div v-if="impFpRejected" class="imp-arch">
              <div class="imp-arch-hd">进价必填（已开启）</div>
              <template v-if="impFpRejected.count">
                <p class="imp-arch-note bad">
                  有 <b>{{ impFpRejected.count }}</b> 个商品因为<u>连进价都没有</u>被拒收，这些行的数量<u>没有</u>进本次报单：
                </p>
                <ul class="imp-arch-list">
                  <li v-for="(n, i) in impFpRejected.names.slice(0, 8)" :key="i">{{ n }}</li>
                </ul>
                <p class="imp-arch-note">
                  进价就是厂家跟你结算的价（元/箱）。请到 <b>商品档案 → 补进价</b> 补上（可「导出待补清单」批量填好再导回），补完重新导入本文件即可。
                </p>
              </template>
              <p v-else class="imp-arch-note">本次导入的商品都有进价，没有行被拒收。</p>
            </div>
            <div class="imp-ft">
              <button class="btn btn-primary" @click="closeImportAndReload">完成，刷新交叉表</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="fade"><div v-if="prodProfile" class="imp-overlay" @click="prodProfile = null"></div></Transition>
      <Transition name="pop">
        <div v-if="prodProfile" class="imp-modal profile-modal">
          <div class="imp-hd"><b>商品档案 · {{ prodProfile.name || '未命名' }}</b><button class="imp-x" @click="prodProfile = null"><Icon name="close"/></button></div>
          <div class="imp-body">
            <div class="pf-grid">
              <div class="pf-item"><span>规格</span><b>{{ prodProfile.spec || '—' }}</b></div>
              <div class="pf-item"><span>单位</span><b>{{ prodProfile.unit || '—' }}</b></div>
              <div class="pf-item"><span>条码</span><b>{{ prodProfile.barcode || '—' }}</b></div>
              <div class="pf-item"><span>分类</span><b>{{ (prodMeta[prodProfile.product_id] || {}).category || '—' }}</b></div>
              <div class="pf-item"><span>品牌</span><b>{{ (prodMeta[prodProfile.product_id] || {}).brand || '—' }}</b></div>
              <div class="pf-item"><span>安全库存</span><b>{{ fmt(prodProfile.safety_stock) }}</b></div>
              <div class="pf-item"><span>起订量</span><b>{{ fmt(prodProfile.moq) }}</b></div>
              <!-- v184：原读 `prodProfile.lead_days` —— 行对象里**没有**这个键（行映射从未带过它），
                   这一格一直是空的；物理列是 `products.arrival_lead_days`。
                   改名的同时接上「到货周期文案」的唯一实现，与主表那一列同口径。 -->
              <div class="pf-item"><span>到货周期</span><b>{{ arrivalCycleText(prodProfile.arrival_lead_days) }}</b></div>
              <div class="pf-item"><span>保质期天</span><b>{{ fmt(prodProfile.expiry_days) }}</b></div>
              <div class="pf-item"><span>标准售价</span><b>{{ prodProfile.sale_price != null ? fmt(prodProfile.sale_price) : '—' }}</b></div>
              <!-- v226b：此前读 `prodProfile.purchase_price` 并叫「进价」 —— 那是**第三个**「进价」实现，
                   且取的正是本页金额**不使用**的那一列（元/小单位、实测等于售价）⇒ 用户在浮层看到
                   「进价 6.99」、回主表却见金额显示「缺价」，无从理解。现与金额基准同源（factoryPrice）
                   并**显式标注量纲**，未录时把后果写出来（不留下"填了却没反应"的悬案）。 -->
              <div class="pf-item"><span>进价(元/箱)</span><b>{{ factoryPrice(prodProfile) > 0 ? fmt(factoryPrice(prodProfile)) : '未录（金额按标准售价估算）' }}</b></div>
              <div class="pf-item"><span>分销价</span><b>{{ prodProfile.dist_price != null ? fmt(prodProfile.dist_price) : '—' }}</b></div>
              <div class="pf-item"><span>健康分</span><b :class="healthClass(prodProfile.product_id)">{{ hsMap[prodProfile.product_id] != null ? hsMap[prodProfile.product_id] : '—' }}</b></div>
              <div class="pf-item"><span>批次资料</span><b :class="gapSet.has(prodProfile.product_id) ? 'pf-warn' : 'pf-ok'">{{ gapSet.has(prodProfile.product_id) ? '缺批次/到期' : '完整' }}</b></div>
              <div class="pf-item pf-note"><span>备注</span><b>{{ notesMap[prodProfile.product_id] || '—' }}</b></div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="fade"><div v-if="auditOpen" class="imp-overlay" @click="auditOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="auditOpen" class="imp-modal audit-modal">
          <div class="imp-hd"><b>智能建议本周期 · {{ cross.period?.name || '' }}</b><button class="imp-x" @click="auditOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <div v-if="!erpLinked" class="imp-tip warn-text audit-erp-note">
              <b><Icon name="alert-triangle"/> 当前未连接 ERP（畅捷通 / 金蝶）。</b>本功能的智能建议需以实时库存与销量为依据；未连接时建议量缺少数据支撑、仅供参考。你可手动核对报单量后直接「确认定稿」，或前往 <button class="link-btn" @click="goConnect">能力中心</button> 连接 ERP，建议才会准确。
            </div>
            <p v-if="auditState === 'loading'" class="imp-tip">正在按「日均销量 × 覆盖天数 − 当前库存」逐 SKU 计算建议量…</p>
            <template v-else-if="auditState === 'done'">
              <p v-if="auditData?.rebate_hint" class="imp-ok">{{ auditData.rebate_hint }}</p>
              <div class="audit-sum">
                <span>{{ auditData.summary?.sku_count || 0 }} 个 SKU</span>
                <span>预报 <b>{{ fmt(auditData.summary?.total_requested) }}</b> 件</span>
                <span>系统建议 <b class="audit-sug">{{ fmt(auditData.summary?.total_suggested) }}</b> 件</span>
                <span v-if="auditData.summary?.missing_count" class="val-bad">缺货 {{ auditData.summary.missing_count }}</span>
                <span v-if="auditData.summary?.excess_count" class="val-warn">积压 {{ auditData.summary.excess_count }}</span>
              </div>
              <p class="legacy-note">本周期经「确认定稿」即为唯一定稿出口；逐单审批为历史流程，仅用于追溯，不生成采购申请。</p>
              <div class="imp-matrix">
                <table class="tbl">
                  <thead><tr><th>商品</th><th class="num">预报</th><th class="num">库存</th><th class="num">日均</th><th class="num">建议</th><th class="num">定稿</th><th>判定</th></tr></thead>
                  <tbody>
                    <tr v-for="a in auditPaged" :key="a.product_id">
                      <td class="audit-name">{{ a.name || '商品#' + a.product_id }}<span v-if="a.spec" class="hint"> {{ a.spec }}</span></td>
                      <td class="num">{{ a.requested_qty != null ? fmt(a.requested_qty) : '—' }}</td>
                      <td class="num">{{ a.current_stock ?? '—' }}</td>
                      <td class="num">{{ a.avg_daily_sales ?? '—' }}</td>
                      <td class="num"><b class="audit-sug">{{ a.suggested_qty != null ? fmt(a.suggested_qty) : '—' }}</b></td>
                      <td class="num"><input v-if="a.final_qty != null" :value="a.final_qty" class="qty-input" type="text" inputmode="numeric" @input="numInput($event, a, 'final_qty')" @change="a.final_qty = parseNumInput($event.target.value)"><span v-else class="hint">—</span></td>
                      <td class="audit-verdict"><span :class="verdictCls(a.error || a.verdict)">{{ a.error || a.verdict }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="auditPaged.length < (auditData.items?.length || 0)" class="audit-more">
                <button class="btn btn-ghost btn-sm" @click="auditPage++">加载更多 SKU（已显示 {{ auditPaged.length }}/{{ auditData.items.length }}）</button>
              </div>
              <div class="imp-ft">
                <button class="btn btn-ghost" @click="auditOpen = false">关闭</button>
                <button class="btn btn-primary" :disabled="adopting" @click="doAdopt">{{ adopting ? '定稿中…' : '确认定稿（人点生效，AI 不下单）' }}</button>
              </div>
            </template>
            <p v-else-if="auditState === 'empty'" class="imp-tip">该周期暂无已匹配主档的报单商品，无法自动审核。</p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 返利冲刺看板（前置到本期预报顶部：选完期次第一眼即看目标达成/缺口/均单建议；有期次即显示，不绑子视图） -->
    <div v-if="cross.period" class="card sprint-card is-pinned">
      <div class="panel-hd">
        <b><Icon name="bar-chart"/> 返利冲刺看板</b>
        <span class="tag hot">副驾建议</span>
        <span class="tag info" v-if="cross.period">本期 · {{ cross.period.name }}</span>
        <!-- 时间进度：与下方进度条的虚线标记同源（口径＝本期到货月），右对齐到本行最右侧 -->
        <span class="sprint-tp" v-if="rebateSprint.length" :title="sprintTimeProgress.shown ? '虚线＝时间进度：进度条超过虚线＝超前，短于虚线＝落后时间进度' : ''">本月时间进度：<b>{{ sprintTimeProgress.pct1 }}%</b></span>
        <button class="imp-x" :style="rebateSprint.length ? null : 'margin-left:auto'" @click="rebateSprintOpen = !rebateSprintOpen"><Icon :name="rebateSprintOpen ? 'chevron-up' : 'chevron-down'"/></button>
      </div>
      <!-- 决策横幅（A2）：看板结论的常驻摘要行 —— 折叠/展开都在，明细只在展开时出现。
           四个数字全部取自既有 computed，且与展开态明细表共用同一个 fmt()（单位同源，勿在摘要上开第二套） -->
      <div v-if="rebateSprint.length" class="sprint-banner">
        <template v-if="unmetSprintCount">
          <b>{{ unmetSprintCount }}</b> 个品牌未达标
          <span class="sep">·</span>总缺口 <b class="val-warn">¥{{ fmt(sprintTotalGap) }}</b>
          <span class="sep">·</span>剩 <b>{{ rebateSprintOrders }}</b> 次到货
          <span class="sep">·</span>均单需报 <b class="val-warn">¥{{ fmt(sprintTotalGapPerOrder) }}</b>
        </template>
        <template v-else>
          <b>{{ rebateSprint.length }}</b> 个品牌目标<span class="val-ok">全部达成</span>
          <span class="sep">·</span>本月时间进度 <b>{{ sprintTimeProgress.pct1 }}%</b>
        </template>
      </div>
      <div v-show="rebateSprintOpen" class="panel-body">
        <template v-if="rebateSprint.length">
          <p class="sprint-sum">
            本期（返利周期截止 <b>{{ rebateCampaignEnd || (cross.period && cross.period.order_end) }}</b>）按默认到货周期（每 {{ rebateGlobalCadence }} 天）约剩 <b>{{ rebateSprintOrders }}</b> 次到货机会；各品牌到货周期不同，下表按各自周期算「建议均单」。
            要补齐以下返利目标缺口，<b>均单需报 ¥{{ fmt(sprintTotalGapPerOrder) }}</b>（按默认周期估算）。
            <span class="muted">（达成按到货月份归属 = 已填报达成 + 本期预报贡献；未填报可在「目标与返利 → 达成填报」补录或 Excel 导入）</span>
          </p>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th>维度</th><th>目标对象</th><th>到货周期</th><th class="num">目标</th><th class="num">已达成(填报)</th><th class="num">本期预报贡献</th><th class="num">距目标还差</th><th class="num">建议均单</th><th>进度</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in rebateSprint" :key="s.key">
                  <td>{{ s.dimLabel }}</td>
                  <td>{{ s.name }}</td>
                  <td>{{ s.cadenceLabel }}</td>
                  <td class="num">¥{{ fmt(s.target) }}<template v-if="s.targetType === 'quantity'"> / 件</template></td>
                  <td class="num">{{ s.reported > 0 ? '¥' + fmt(s.reported) : '—' }}</td>
                  <td class="num">¥{{ fmt(s.contrib) }}</td>
                  <td class="num"><b :class="s.gap > 0 ? 'val-warn' : 'val-ok'">{{ s.gap > 0 ? fmt(s.gap) : '已达成' }}</b></td>
                  <td class="num" v-if="s.gap > 0">¥{{ fmt(s.perOrder) }}</td>
                  <td class="num" v-else>—</td>
                  <td style="min-width:110px">
                    <!-- v183：文案＝「达成率 X%」（不再标注与时间进度的差值）；
                         空间不足时（paceHint 非空）整条进度条挂 hover 提示，文案与提示同源 -->
                    <div class="sp-bar" :title="paceHint(s)">
                      <div class="progress" :class="sprintBarClass(s.ach)"><i :style="{width: Math.min(100, s.ach * 100) + '%'}"></i></div>
                      <span v-if="sprintTimeProgress.shown" class="sp-bar-mark" :style="{left: (sprintTimeProgress.frac * 100) + '%'}" title="时间进度"></span>
                    </div>
                    <span v-if="sprintPaceMap[s.key] && sprintPaceMap[s.key].text" class="sp-pace" :class="[sprintPaceMap[s.key].cls, paceFits[s.key] === false ? 'is-hidden' : '']" :data-k="s.key">{{ sprintPaceMap[s.key].text }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="sprint-suggest" v-if="rebateSprintOrders > 0">
            <b>系统建议：</b>
            <ul>
              <template v-for="s in rebateSprint" :key="'sg' + s.key">
                <li v-if="s.gap > 0">
                  为「{{ s.name }}」补齐返利，剩余 <b>{{ s.orders }}</b> 次到货（{{ s.cadenceLabel }}）中每单需报 <b>¥{{ fmt(s.perOrder) }}</b>；优先加单：
                  <template v-if="!s.topEmpty"><span v-for="p in s.top" :key="p.name" class="sprint-prod">{{ p.name }}（本期已报 ¥{{ fmt(p.contrib) }}）</span></template>
                  <span v-else class="sprint-prod-empty">本期该品牌尚未报单，暂无可推荐加单（先报单或补全商品进货价后再生成建议）</span>
                </li>
              </template>
            </ul>
          </div>
        </template>
        <p v-else class="hint">尚未配置品牌 / 商品返利目标。去「目标与返利」页创建目标后，这里会在你下单时实时显示达成率、缺口与建议均单；实际达成可在「达成填报」补录或 Excel 导入。</p>
      </div>
    </div>

    <!-- 本期预报子视图切换：汇总表（交叉表）/ 逐单补录（搜索商品加入草稿） -->
    <!-- Q1：两条填报路径此前无任何场景说明，用户不知该用哪个入口 -->
    <div class="view-seg-row" v-if="!editMode">
      <div class="view-seg">
        <button :class="{ on: viewMode === 'cross' }" @click="switchView('cross')">汇总表</button>
        <button :class="{ on: viewMode === 'list' }" @click="switchView('list')">逐单补录</button>
      </div>
      <span class="view-seg-tip">批量粘贴 · 整表改量 · 增删商品 → 用「汇总表」再点「改单」；少量补录 · 按商品搜索加购 → 用「逐单补录」</span>
      <!-- 修改日志（原 P9-6「审计」）：汇总表是文员与业务经理多人共改的，出纠纷时要能答
           「这一版是谁、什么时候改的」。原按钮埋在 改单 → 工具箱 → 更多工具 三级之下，
           非编辑态（文员/经理日常看表的默认状态）根本看不到，故 v166 改名并提到这里常显
           ——业务人员不认识"审计"这个词，而"日志"他们一看就懂。
           ⚠️ 为什么不放主工具栏：实测量过，工具栏 1280 宽仅剩 22px、1440 仅剩 69px 余量，
           任何带字按钮都会把单行挤成两行（工具栏单行是 2026-09-12 专门收敛出来的设计）。
           本行是汇总表区最顶一行的常显行，零工具栏代价，且紧贴它描述的这张表。 -->
      <button class="btn btn-sm btn-ghost log-btn" :disabled="!cross.period" :class="{ on: trailOpen }" @click="toggleTrail"><Icon name="list"/> 修改日志</button>
    </div>

    <!-- P9-6 改动留痕审计 → v166 更名「修改日志」：① 每条加「修改人」；② 交还全局操作；
         ③ **搬出编辑态分支**——原实现挂在 `v-if=editMode` 的网格区内，而非编辑态（文员/经理
         日常看汇总表的默认状态）里点了按钮什么都不会出现。
         位置：紧贴「汇总表视图切换行」下方 —— 那行右侧就是常显入口，面板开在触发它的按钮
         正下方（原先放在工具栏下、隔着返利冲刺看板，触发点在页面下半部，视线要跨过一屏）。
         本块不依赖 editMode，故两态都能渲染。 -->
    <div v-if="trailOpen" class="info-panel audit-log-panel">
      <div class="panel-hd">
        <b><Icon name="list"/> 修改日志</b>
        <span class="tag info">{{ auditTrail.length }} 条</span>
        <button class="imp-x" @click="trailOpen=false"><Icon name="close"/></button>
      </div>
      <ul v-if="auditTrail.length" class="health-list at-log">
        <li v-for="(a,i) in auditTrail" :key="i" class="sev-info">
          <span class="sev-dot"></span>
          <span class="at-time">{{ fmtAuditAt(a.at) }}</span> ·
          <b class="at-who">{{ a.by || '系统' }}</b> ·
          <span class="at-act">{{ auditActionLabel(a.action) }}</span> · {{ a.detail }}
        </li>
      </ul>
      <div v-else class="hint">本期暂无修改记录</div>
      <!-- v166：与期次无关的全局操作（进价闸门 / 回写 / 采购单推送 / 异常处置 / AI 根因分析 /
           删除期次）原先写完就再也看不到，这里折叠交还；**不揉进本期时间线**，避免被误读成
           「本期汇总表被改过」。删期次的记录留在该期自己的 audit 键里，删完仍可回溯。 -->
      <div v-if="auditGlobal.length" class="at-global">
        <button class="at-global-hd" @click="atGlobalOpen = !atGlobalOpen">
          <Icon :name="atGlobalOpen ? 'chevron-down' : 'chevron-right'"/>
          全局操作 {{ auditGlobal.length }} 条（与期次无关）
        </button>
        <ul v-if="atGlobalOpen" class="health-list at-log">
          <li v-for="(a,i) in auditGlobal" :key="i" class="sev-info">
            <span class="sev-dot"></span>
            <span class="at-time">{{ fmtAuditAt(a.at) }}</span> ·
            <b class="at-who">{{ a.by || '系统' }}</b> ·
            <span class="at-act">{{ auditActionLabel(a.action) }}</span> · {{ a.detail }}
          </li>
        </ul>
      </div>
    </div>

    <!-- 交叉表视图（P0-1）：行=商品 × 列=报单单元（透视小程序报单 sources） -->
    <div v-if="viewMode === 'cross'" class="cross-area">
      <div class="card cross-card">
        <!-- 列配置条 -->
          <div class="col-config-bar">
            <div v-if="showColMenu && !editMode" class="col-menu-overlay" @click="showColMenu=false"></div>
            <div v-if="showColMenu && !editMode" class="col-menu" @click.stop>
              <div class="col-menu-hd"><span>显示列（拖拽排序，<Icon name="check"/> 显示）</span><button class="col-menu-x" @click="showColMenu=false" title="关闭"><Icon name="close"/></button></div>
              <div class="col-menu-view">
                <label class="basis-toggle">分组
                  <select v-model="groupBy" aria-label="分组方式">
                    <option value="none">不分组</option>
                    <option value="category">按品类</option>
                    <option value="brand">按品牌</option>
                    <option value="product_code">按厂家编码</option>
                    <option value="unit">按单位</option>
                    <option value="spec">按规格</option>
                  </select>
                </label>
                <label class="basis-toggle">冻结列
                  <select v-model="frozenKey" aria-label="冻结列">
                    <option value="name">商品名称</option>
                    <option value="product_code">厂家编码</option>
                    <option value="none">不冻结</option>
                  </select>
                </label>
              </div>
              <ul class="col-menu-list">
                <template v-for="(c, ci) in colOrder" :key="c.key">
                  <!-- v184：判定统一走 isLockedCol()（= name ∪ FROZEN_COLS），不再只看 c.fixed ——
                       菜单的 c 来自 colOrder，那里只有 name 带 fixed，新增的固定列识别不出来
                       ⇒ 会显示成「可拖、可取消勾选」，而实际拖了会被 visibleCols 归位、勾了会被
                       toggleCol 拒绝（点了跟没点一样 = 假控件）。 -->
                  <li v-if="canSeeCol(c.key)" :class="{ locked: isLockedCol(c.key), hidden: colVis[c.key] === false }" :draggable="!isLockedCol(c.key)" @dragstart="onColDragStart(ci)" @dragover.prevent @drop="onColDrop(ci)">
                    <span class="drag">⠿</span>
                    <label><input type="checkbox" :checked="colVis[c.key] !== false" :disabled="isLockedCol(c.key)" @click.prevent="toggleCol(c.key)"> {{ c.label }}</label>
                    <button v-if="!isLockedCol(c.key) && c.deletable" class="col-menu-del" @click="deleteMasterCol(c.key)" title="删除该列"><Icon name="close"/></button>
                  </li>
                </template>
              </ul>
              <div class="col-menu-add">
                <span class="cm-label"><Icon name="plus"/> 添加主档列</span>
                <button v-for="c in addableMasterCols" :key="c.key" class="btn btn-xs btn-ghost" @click="addMasterCol(c.key)">{{ c.label }}</button>
              </div>
              <div class="col-menu-schemes">
                <span class="cm-label">列方案</span>
                <select v-model="schemeName" @change="applyScheme(schemeName)">
                  <option value="">选择方案…</option>
                  <option v-for="s in schemes" :key="s.name" :value="s.name">{{ s.name }}</option>
                </select>
                <div class="scheme-row">
                  <input class="scheme-name-ipt" v-model="schemeSaveName" placeholder="输入方案名" @keyup.enter="saveScheme">
                  <button class="btn btn-ghost btn-xs scheme-btn" @click="saveScheme">保存当前</button>
                  <button class="btn btn-ghost btn-xs scheme-btn" :disabled="!schemeName" @click="delScheme(schemeName)" title="删除所选方案">删除</button>
                </div>
              </div>
              <div class="col-menu-reset">
                <button class="btn btn-ghost btn-xs" @click="resetColWidths" title="清除本地列宽记忆，恢复默认列宽">重置列宽</button>
              </div>
            </div>
          </div>

        <!-- 表体：加载态 / 空态 / 汇总表（虚拟滚动+分组+展开+行操作+键盘a11y） -->
        <div v-if="crossLoading" class="tbl-state tbl-skeleton" aria-busy="true" aria-label="数据加载中">
          <div class="sk-row" v-for="n in 8" :key="n"><span class="sk-bar" v-for="m in 6" :key="m"></span></div>
        </div>
        <!-- v184：这里原来还有一个「只读态 0 行 ⇒ 整块空态」的分支，它**替换掉整张表**
             （连列头都没有）⇒「哪些列不可删除」（提示挂在列头的右键菜单上）在空期次里
             完全不可达，用户被迫先点「改单」才能看到表。现改为「表头保留 + 表体内一行引导」，
             见下方 tbody 里的 .empty-row。 -->
        <div v-else-if="!editMode" class="grid-area" :class="{ 'is-fs': gridFullscreen }">
          <div class="grid-ctl-row">
            <!-- v209：compact 只在全屏生效（去掉「缩放」二字、滑杆收窄）——全屏这一行要塞进整个编辑组。 -->
            <GridZoomCtl v-model="gridZoom" :compact="gridFullscreen"/>
            <!-- 表格级筛选器（原在主工具栏）：作用于本交叉表，下移到表格工具行，缩短「控件—作用对象」距离 -->
            <label class="tb-toggle"><input type="checkbox" v-model="hideZeroReport"> 仅显示有报单</label>
            <!-- v209：全屏时收成图标形态（badge-slim）。文案不丢 —— 完整句子在 title 与 aria-label。
                 它是全屏单行的必要项：本徽标与「另有 N 个」可同时出现，两者实测各约 150–180px。 -->
            <span v-if="hideZeroReport" class="confirm-badge filter" :class="{ 'badge-slim': gridFullscreen }"
                  :title="'已隐藏 ' + zeroReportCount + ' 个零报单（取消勾选「仅显示有报单」即可展开）'"
                  :aria-label="'已隐藏 ' + zeroReportCount + ' 个零报单'"
            ><Icon name="filter" /><template v-if="!gridFullscreen"> 已隐藏 {{ zeroReportCount }} 个零报单</template></span>
            <!-- v179 行底范围：默认只列「本批导入 + 有报单」，勾上回到全量在售商品档案 -->
            <label class="tb-toggle"><input type="checkbox" v-model="showAllProducts"> 显示全部商品</label>
            <!-- v247：查看态默认收起「整列全空」的列（历史期次列 / 档案未填列），勾上才铺开 -->
            <label class="tb-toggle"><input type="checkbox" v-model="showEmptyCols"> 显示空列</label>
            <span v-if="hiddenEmptyCols" class="confirm-badge filter" :class="{ 'badge-slim': gridFullscreen }"
                  :title="'已收起 ' + hiddenEmptyCols + ' 个全空列（勾选「显示空列」即可展开）'"
                  :aria-label="'已收起 ' + hiddenEmptyCols + ' 个全空列'"
            ><Icon name="filter" /><template v-if="!gridFullscreen"> 已收起 {{ hiddenEmptyCols }} 个空列</template></span>
            <!-- v209：同「已隐藏 N 个零报单」，全屏时收成图标形态（实测本条占 180px，是全行最肥的单件） -->
            <span v-if="!showAllProducts && hiddenByRowBase" class="confirm-badge filter" :class="{ 'badge-slim': gridFullscreen }"
                  :title="'另有 ' + hiddenByRowBase + ' 个在售商品未显示（勾选「显示全部商品」即可展开）'"
                  :aria-label="'另有 ' + hiddenByRowBase + ' 个在售商品未显示'"
            ><Icon name="filter" /><template v-if="!gridFullscreen"> 另有 {{ hiddenByRowBase }} 个在售商品未显示</template></span>
            <div class="tb-pop">
              <button ref="brandBtn" class="btn btn-sm btn-ghost" :class="{on:brandPopOpen}" @click="toggleBrandPop"><Icon name="filter"/> 品牌<span v-if="brandSel.length" class="btn-badge">{{ brandSel.length }}</span> <Icon name="chevron-down"/></button>
              <Teleport to="body">
              <div v-if="brandPopOpen" class="tb-pop-panel brand-pop" :style="popStyle" @click.stop>
                <div class="bp-head"><span>按品牌（供货方）筛选报单</span><div class="bp-acts"><button class="link-btn" @click="brandSel = brandCandidates.slice()">全选</button><button class="link-btn" @click="brandSel = []">清空</button></div></div>
                <div class="bp-list">
                  <label v-for="b in brandCandidates" :key="b" class="bp-item"><input type="checkbox" :value="b" v-model="brandSel"> {{ b }}</label>
                  <p v-if="!brandCandidates.length" class="bp-empty">当前汇总表无品牌数据</p>
                </div>
                <p class="bp-tip">只勾选要报单的品牌：表格将只显示这些品牌，复制厂家编码/数量也只针对它们（多品牌合并报单时先勾选再复制）。</p>
              </div>
              </Teleport>
            </div>
            <!-- v167：「复制报单」从主工具栏下移至此，紧邻品牌筛选 —— 用户的动作链是「勾品牌 →
                 复制那些品牌的编码/数量」，同一行内连续完成，不必回页头。弹层定位走共用的
                 positionTbPop()（fixed + 按触发按钮坐标），与位置无关；.tb-pop 容器自带
                 z-index:1120（> .pop-overlay 1100），故与品牌筛选的互斥点击行为完全一致。
                 v168：此处是**唯一**入口 —— 编辑态（改单）已刻意撤掉，理由是草稿数据未定稿。 -->
            <div class="tb-pop">
              <button ref="copyBtn" class="btn btn-sm btn-ghost" :class="{on:copyMenuOpen}" @click="toggleCopyMenu" title="复制本期期次报单：厂家编码 / 最终下单数量（分开复制，粘贴到厂家系统下单）"><Icon name="copy"/> 复制报单 <Icon name="chevron-down"/></button>
              <Teleport to="body">
              <div v-if="copyMenuOpen" class="tb-pop-panel copy-pop" :style="popStyle" @click.stop>
                <div class="cp-title">复制本期报单<span v-if="copyUnitName" class="cp-title-sub"> · {{ copyUnitName }}</span></div>
                <p v-if="brandSel.length" class="cp-tip">已按品牌筛选：{{ brandSel.join('、') }}（只复制这些品牌）</p>
                <p class="cp-tip">有报单 = 「最终下单(箱)」列有数量（合计(箱) + 加单(箱)）；行序与表格一致</p>
                <div class="cp-unit-btns">
                  <button class="grp-btn cp-act" :disabled="!copyCount" title="复制厂家编码（有报单，按行序）" @click="doCopyCodes"><Icon name="barcode"/> 厂家编码</button>
                  <button class="grp-btn cp-act" :disabled="!copyCount" title="复制最终下单数量（与编码行序一致）" @click="doCopyQty"><Icon name="hash"/> 下单数量</button>
                </div>
                <p v-if="copyCount" class="cp-tip ok">共 <b>{{ copyCount }}</b> 个 SKU 有最终下单可复制</p>
                <p v-else class="cp-empty">本期没有「最终下单」有数量的 SKU</p>
              </div>
              </Teleport>
            </div>
            <!-- v209：**全屏专属**「改单」入口。
                 成因：全屏层 `.grid-area.is-fs{position:fixed;inset:0;z-index:1000}` 把主工具栏整条盖住
                 ⇒ 全屏下页头那个「改单」点不到（真机 elementFromPoint 命中到一个无 class 的元素，
                 按钮坐标正常但最上层不是它）。用户在**全屏看表**时想改单，被迫先退出全屏。
                 解法：在**全屏层内部**补一个同源入口，不必退出全屏即可进入改单。
                 非全屏**刻意不渲染**：页头那份本来就在手边，且表格工具行没有多余宽度
                 （实测非全屏 1440 塞入编辑组差 273px、必然折行）—— 这正是「方案 A：全屏专属」的取舍。
                 与主工具栏那份同源（同 :disabled / :title / @click）；两者由 fsRowHosting 保证**同时只有一份**。 -->
            <template v-if="fsRowHosting">
              <span class="tb-sep"></span>
              <!-- v219：同第一处 —— 已定稿期次禁用改单（三处按钮共用 periodClosed 判据） -->
              <button class="btn btn-sm btn-primary" :disabled="loadingEdit || periodClosed"
                      :title="periodClosed ? '该期次已定稿（关闭），不可改单；如需改动请到「往期预报」里先点「重开」' : (entryRoleWarn ? '当前角色（' + roleName(bizRole) + '）可能无填报权限，点击会先提示确认' : '改单：进入可编辑网格，支持整表粘贴、批量录入、增删商品行')"
                      @click="enterEdit"><Icon name="edit"/> {{ loadingEdit ? '载入中…' : '改单' }}</button>
            </template>
          </div>
          <button class="grid-fs-btn" :title="gridFullscreen ? '退出全屏（Esc）' : '全屏查看表格（Esc 退出）'" @click="toggleGridFullscreen" aria-label="表体全屏切换">
            <Icon name="fullscreen" size="16"/>
          </button>
          <div class="filter-row" v-if="colFilter || colFilterSet">
            <span v-if="colFilter" class="filter-chip" :title="'按「' + colLabel(colFilter.key, colFilter.type, colFilter.ui) + '」筛选'">筛选「{{ colLabel(colFilter.key, colFilter.type, colFilter.ui) }}」={{ colFilter.val }} <button class="chip-x" @click="clearColFilter" aria-label="清除列筛选"><Icon name="close"/></button></span>
            <span v-if="colFilterSet" class="filter-chip" :title="'按「' + colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) + '」唯一值筛选'">筛选「{{ colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) }}」∈ {{ colFilterSet.values.length }} 值 <button class="chip-x" @click="clearUniqFilter" aria-label="清除唯一值筛选"><Icon name="close"/></button></span>
            <span v-if="brandSel.length" class="filter-chip" :title="'按品牌（供货方）筛选'">品牌 ∈ {{ brandSel.length }} 个 <button class="chip-x" @click="brandSel = []" aria-label="清除品牌筛选"><Icon name="close"/></button></span>
          </div>
          <div class="table-wrap cross-viewport" ref="scrollEl" @scroll="onScroll">
            <table class="tbl cross-tbl" role="grid" :aria-rowcount="flatItems.length" :aria-colcount="colOrderList.length" :style="{ zoom: gridZoom + '%' }">
            <colgroup>
              <col v-for="col in colOrderList" :key="'cg' + col.key" :style="{ width: colW(col.key) + 'px' }"></col>
            </colgroup>
            <thead>
              <tr>
                <th v-for="(col, ci) in colOrderList" :key="col.key" :class="['th', colCls(col), { frozen: isFrozen(col), sortable: canSort(col) }]" :style="col.fixed ? 'left:' + frozenLeftOf(col.key) : (isFrozen(col) ? 'left:' + frozenRight() : '')" :aria-sort="ariaSort(col)" @click="onHeadClick(col)" @contextmenu.prevent="openHdrCtx($event, col.key, col.type)">
                  <div class="th-in">
                    <template v-if="col.type === 'seq'">
                      <button class="col-cfg gear" @click.stop="showColMenu = !showColMenu" title="列设置"><Icon name="settings"/></button>
                    </template>
                    <template v-else>
                      <span>{{ col.label }}<span v-if="canSort(col)" class="sort-ind"><Icon v-if="sortInd(col.key)" :name="sortInd(col.key)"/></span></span>
                    </template>
                  </div>
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, col.key)" @click.stop></span>
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- v184：本期 0 行时**保留表头**，只在表体内给一行引导。表头在 ⇒ 列设置与
                   列头右键（「该主档列不可删除」的唯一提示出口）都可用了。
                   三个动作 = 三条填数路：手工填 / 从上一期带 / 导入 Excel。 -->
              <tr v-if="!flatItems.length" class="empty-row">
                <td :colspan="colOrderList.length">
                  <!-- v193：这一屏正是「没有进行中期次时用户会落到哪里」—— 旧文案照样招呼他
                       「导入 Excel」，等于把绕流程的入口直接递到手上。现在无进行中期次时只指路
                       「新建期次」：此刻它确实是唯一有意义的动作（另两个动作没有可落的期次）。
                       ⚠️ 分支用 noOpenPeriod（= **已问到** + 确实没有），**不是** !hasOpenPeriod ——
                          后者在期次还没加载完时会误报。 -->
                  <div class="er-ic"><Icon name="inbox"/></div>
                  <div class="er-t">{{ noOpenPeriod ? '当前没有进行中的期次' : '本期还没有商品行' }}</div>
                  <div class="er-s">{{ noOpenPeriod
                    ? '导入和报单都需要先有一个期次 —— 请先新建期次（期次决定这批数据属于哪一期），之后再导入。'
                    : '可以从上一期把清单带过来、导入 Excel，或直接进「改单」手工填写（也能粘贴 Excel 区域）。' }}</div>
                  <div class="er-ops">
                    <template v-if="noOpenPeriod">
                      <button class="btn btn-primary btn-sm" @click="openNewPeriod"><Icon name="plus"/> 新建期次</button>
                    </template>
                    <template v-else>
                      <!-- v219：同上 —— 已定稿期次禁用改单 -->
                      <button class="btn btn-primary btn-sm" :disabled="periodClosed"
                              :title="periodClosed ? '该期次已定稿（关闭），不可改单；如需改动请到「往期预报」里先点「重开」' : '进入可编辑网格填写报单'"
                              @click="enterEdit"><Icon name="edit"/> 改单填写</button>
                      <button class="btn btn-ghost btn-sm" :disabled="seedBusy || !nearestPrevPeriod" @click="seedFromPrev">
                        <Icon name="copy"/> {{ nearestPrevPeriod ? `从「${nearestPrevPeriod.name}」复制清单` : '从上一期复制清单' }}
                      </button>
                      <button class="btn btn-ghost btn-sm" @click="openImport" :disabled="!canImport"
                              :title="canImport ? '从 Excel 导入预报订单汇总表' : importBlockedReason"><Icon name="upload"/> 导入 Excel</button>
                    </template>
                  </div>
                </td>
              </tr>
              <tr class="vs-spacer" :style="{ height: vsWindow.top + 'px' }"><td :colspan="colOrderList.length"></td></tr>
              <template v-for="(it, wi) in vsWindow.items" :key="rowKey(it)">
                <tr v-if="it.kind === 'group'" class="grp-head" @click="toggleGroup(it.key)" role="row">
                  <td :colspan="colOrderList.length" @click.stop="toggleGroup(it.key)">
                    <span class="grp-toggle"><Icon :name="openGroups[it.key] ? 'chevron-down' : 'chevron-right'"/></span>
                    <b>{{ it.label }}</b>
                    <span class="grp-sub-info">小计 {{ fmt(it.subtotal.qty) }} 件 · ¥{{ fmt(it.subtotal.amount) }}</span>
                  </td>
                </tr>
                <tr v-else-if="it.kind === 'row' && openGroups[it.gkey] !== false"
                    :class="['data-row', { zebra: it.zi % 2 === 1, selected: selectedPid === it.r.product_id, 'row-loading': rowState(it.r) === 'loading', 'row-error': rowState(it.r) === 'error', 'row-disabled': rowState(it.r) === 'disabled', 'cond-warn': condWarnOn && rowWarn(it.r) === 'low' }]"
                    role="row" :aria-selected="selectedPid === it.r.product_id" :aria-label="rowAria(it.r)">
                  <td v-for="(col, ci) in colOrderList" :key="col.key"
                      :class="['td', colCls(col), { frozen: isFrozen(col), 'cell-active': cellActive(it, ci) }]"
                      :style="col.fixed ? 'left:' + frozenLeftOf(col.key) : (isFrozen(col) ? 'left:' + frozenRight() : '')"
                      role="gridcell" :tabindex="cellActive(it, ci) ? 0 : -1"
                      :data-cell="ci" :data-pid="it.r.product_id"
                      :aria-label="cellAria(it.r, col)"
                      @click="onCellClick(it, col, ci, $event)"
                      @dblclick="onCellDbl(it, col)"
                      @focus="onCellFocus(it, ci)"
                      @keydown="onBodyKey">
                    <template v-if="col.type === 'seq'"><span class="seq-num">{{ it.seq }}</span></template>
                    <template v-else-if="col.type === 'master' && col.key === 'name'">
                      <span class="exp-chev" @click.stop="toggleExpand(it.r.product_id)" :title="isExpanded(it.r.product_id) ? '收起明细' : '展开明细'"><Icon :name="isExpanded(it.r.product_id) ? 'chevron-down' : 'chevron-right'"/></span>
                      <div class="pname">{{ it.r.name }}<span v-if="it.r.ordering_entity" class="oe-badge" :class="'oe-c' + oeColorIdx(it.r.ordering_entity)">{{ it.r.ordering_entity }}</span><span v-if="it.r.imported" class="oe-badge imp-tag" title="这一行是本期导入的商品（来自导入登记）">导入</span><span v-if="it.r.offArchive" class="oe-badge off-tag" title="这个商品在你的「在售商品档案」里已停用或已删除，但本期数据引用了它。要让它回到档案列表，请到「商品档案」重新启用。">已停用</span></div>
                      <div class="pspec">{{ it.r.spec || '—' }} · {{ it.r.unit }}<span v-if="it.r.people"> · {{ it.r.people }} 人报</span></div>
                      <div v-if="it.r.ai != null" class="ai-hint">系统建议 {{ fmt(it.r.ai) }}{{ it.r.unit }}<span v-if="it.r.aiMethod" class="hint">（{{ it.r.aiMethod }}）</span></div>
                      <span v-if="rowWarn(it.r) === 'low'" class="warn-badge" title="低于安全库存"><Icon name="alert-triangle"/></span>
                      <span v-else-if="rowWarn(it.r) === 'short'" class="warn-badge short" title="短保（保质期≤7天）"><Icon name="alert-triangle"/></span>
                      <span v-if="lossWarn(it.r)" class="loss-badge" :class="lossWarn(it.r)" :title="lossTip(it.r)"><Icon name="flame"/></span>
                      <span v-if="rtBadge(it.r)" class="rt-badge" :class="rtBadge(it.r)" :title="rtBadgeTip(it.r)"><Icon name="bell"/></span>
                      <span v-if="rowNote(it.r)" class="note-badge" :title="rowNote(it.r)" @click.stop="setRowNote(cross.rows.indexOf(it.r))"><Icon name="message"/></span>
                      <span v-if="gapSet.has(it.r.product_id)" class="gap-badge" title="缺批次/到期资料，需补录"><Icon name="alert-triangle"/></span>
                      <span v-if="hsMap[it.r.product_id] !== undefined && hsMap[it.r.product_id] < 60" class="hs-badge" :title="'健康分 ' + hsMap[it.r.product_id] + '（偏低，需补全资料）'"><Icon name="lightbulb"/></span>
                      <span class="row-ops">
                        <button class="rop" @click.stop="viewRow(it.r.product_id)" title="查看/展开明细"><Icon name="search"/></button>
                        <button class="rop" @click.stop="editRow(it.r.product_id)" title="改单"><Icon name="edit"/></button>
                        <button class="rop danger" @click.stop="delRowSoft(it.r.product_id)" title="删除该行"><Icon name="trash"/></button>
                      </span>
                    </template>
                    <template v-else-if="col.type === 'master'"><span :class="{ 'cell-dash': masterVal(it.r, col) === '—' }">{{ masterVal(it.r, col) }}</span></template>
                    <template v-else-if="col.type === 'qty'">
                      <input v-if="editingCell && editingCell.pid === it.r.product_id && editingCell.uname === col.key" class="cell-input cell-qty" type="text" inputmode="numeric" :value="it.r.qtyByUnit[col.key] || 0" v-focus @input="numInput($event, it.r.qtyByUnit, col.key)" @change="commitCell(it.r.product_id, col.key, $event.target.value)" @blur="commitCell(it.r.product_id, col.key, $event.target.value)" @keydown.stop="onCellKey($event, it.r.product_id, col.key)">
                      <span v-else class="qty-num tip-wrap" :style="heatStyle(it.r, col.key)">{{ it.r.qtyByUnit[col.key] }}<span class="tip">¥{{ fmt(displayPrice(it.r) != null ? (it.r.qtyByUnit[col.key] || 0) * displayPrice(it.r) : 0) }}（按行单价估算）</span></span>
                    </template>
                    <template v-else-if="col.key === 'qty'">{{ fmt(it.r.total) }}</template>
                    <template v-else-if="col.key === 'boxes'"><span :class="{ 'miss-price': boxMissing(it.r) }">{{ boxText(it.r) }}</span></template>
                    <template v-else-if="col.key === 'extra'">{{ fmt(rowExtraQty(it.r)) }}</template>
                    <template v-else-if="col.key === 'final'"><b>{{ fmt(rowFinalQty(it.r)) }}</b></template>
                    <template v-else-if="col.key === 'ai'">{{ it.r.ai != null ? fmt(it.r.ai) : '—' }}</template>
                    <template v-else-if="col.key === 'price'"><span :class="{ 'miss-price': pricePerCase(it.r) == null }">{{ pricePerCase(it.r) != null ? pricePerCase(it.r).toFixed(2) + ' /箱' : (factoryPrice(it.r) <= 0 ? '缺价' : '缺规格') }}</span></template>
                    <template v-else-if="col.key === 'amount'"><span :class="{ 'miss-price': pricePerCase(it.r) == null }">{{ amountValue(it.r) != null ? fmt(amountValue(it.r)) : (factoryPrice(it.r) <= 0 ? '缺价' : '缺规格') }}</span></template>
                  </td>
                </tr>
                <tr v-else-if="it.kind === 'detail'" class="det-row" role="row">
                  <td :colspan="colOrderList.length">
                    <div class="det-grid">
                      <div class="det-row2"><span>品类</span><b>{{ it.r.category || '—' }}</b></div>
                      <div class="det-row2"><span>品牌</span><b>{{ it.r.brand || '—' }}</b></div>
                      <div class="det-row2"><span>系统建议</span><b v-if="it.r.ai != null">{{ fmt(it.r.ai) }}{{ it.r.unit }} <i v-if="it.r.aiMethod" class="det-i">{{ it.r.aiMethod }}</i></b><span v-else>—</span></div>
                      <div class="det-row2"><span>备注</span><b>{{ rowNote(it.r) || '—' }}</b></div>
                      <div class="det-row2"><span>风险</span><b :class="riskCls(it.r)">{{ riskText(it.r) }}</b></div>
                      <div class="det-row2 det-units-row"><span>各单元</span>
                        <span class="det-units">
                          <span v-for="u in cross.units" :key="u.name" class="det-unit">{{ u.name }}: {{ it.r.qtyByUnit[u.name] || 0 }}{{ it.r.unit }} <i class="det-i">¥{{ fmt(displayPrice(it.r) != null ? (it.r.qtyByUnit[u.name] || 0) * displayPrice(it.r) : 0) }}</i></span>
                          <span v-if="!cross.units.length" class="muted">无报单单元</span>
                        </span>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr class="vs-spacer" :style="{ height: vsWindow.bottom + 'px' }"><td :colspan="colOrderList.length"></td></tr>
            </tbody>
            </table>
          </div>
          <div ref="crossFoot" class="col-total-bar">
          <table class="tbl cross-tbl" :style="{ zoom: gridZoom + '%' }">
            <colgroup>
              <col v-for="col in colOrderList" :key="'cfg' + col.key" :style="{ width: colW(col.key) + 'px' }"></col>
            </colgroup>
            <tbody>
              <tr class="col-total">
                <td v-for="(col, ci) in colOrderList" :key="'f' + col.key" :class="['td', colCls(col), { frozen: isFrozen(col) }]" :style="col.fixed ? 'left:' + frozenLeftOf(col.key) : (isFrozen(col) ? 'left:' + frozenRight() : '')">
                  <template v-if="col.key === 'name'">合计</template>
                  <template v-else-if="col.type === 'qty'">{{ cross.colTotals[(ci - 1) - visibleCols.length] || '' }}</template>
                  <template v-else-if="col.key === 'qty'">{{ fmt(cross.grand.qty) }}</template>
                  <template v-else-if="col.key === 'boxes'">{{ fmtBox(cross.grand.boxes) }}<span v-if="boxMissingRows.length" class="box-miss">（缺规格 {{ boxMissingRows.length }} 行未计入）</span></template>
                  <template v-else-if="col.key === 'extra'">{{ fmt(liveRows.reduce((s, r) => s + rowExtraQty(r), 0)) }}</template>
                  <template v-else-if="col.key === 'final'">{{ fmt(liveRows.reduce((s, r) => s + rowFinalQty(r), 0)) }}</template>
                  <template v-else-if="col.key === 'amount'">{{ fmt(cross.grand.amount) }}</template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <div class="amt-note-toggle" @click="amtNoteOpen=!amtNoteOpen">口径说明（合计/单价换算口径）{{ amtNoteOpen ? ' ▴' : ' ▾' }}</div>
          <p v-if="amtNoteOpen" class="cross-amt-note">报单金额 = 最终下单数量（箱）× 单价（进价/箱）。<b>单价(进价/箱) = 商品档案的进价</b>（档案里的进价<b>本身就是「元/箱」</b>，不再乘任何换算）；档案进价为空时回退到档案里的历史进价列。<b>每箱数（= 每箱有几个报单单位）</b>取商品档案的单位换算，档案缺则按规格串解析（如「250g*24瓶」=24、纯数字规格「12」=12）。合计(箱) = <b>逐行</b>「报单数量 ÷ 每箱数」，<b>可为小数</b>（如报 3 瓶 ÷ 24 瓶/箱 = 0.125 箱）；最终下单(箱) = <b>合计(箱) 不足一箱按一箱</b>（厂商不拆零发货）<b>+ 加单(箱)</b>。</p>
        </div>

        <!-- 编辑模式：Excel 式可编辑矩阵（选中/方向键/右键行列菜单/填充柄 + 列配置 + 复制） -->
        <div v-else class="grid-area" :class="{ 'is-fs': gridFullscreen }">
          <div class="grid-ctl-row">
            <!-- v209：compact 只在全屏生效（去掉「缩放」二字、滑杆收窄）——全屏这一行要塞进整个编辑组。 -->
            <GridZoomCtl v-model="gridZoom" :compact="gridFullscreen"/>
            <label class="tb-toggle"><input type="checkbox" v-model="hideZeroReport"> 仅显示有报单</label>
            <!-- v209：全屏时收成图标形态（badge-slim）。文案不丢 —— 完整句子在 title 与 aria-label。
                 它是全屏单行的必要项：本徽标与「另有 N 个」可同时出现，两者实测各约 150–180px。 -->
            <span v-if="hideZeroReport" class="confirm-badge filter" :class="{ 'badge-slim': gridFullscreen }"
                  :title="'已隐藏 ' + zeroReportCount + ' 个零报单（取消勾选「仅显示有报单」即可展开）'"
                  :aria-label="'已隐藏 ' + zeroReportCount + ' 个零报单'"
            ><Icon name="filter" /><template v-if="!gridFullscreen"> 已隐藏 {{ zeroReportCount }} 个零报单</template></span>
            <!-- v179 行底范围：默认只列「本批导入 + 有报单」，勾上回到全量在售商品档案 -->
            <label class="tb-toggle"><input type="checkbox" v-model="showAllProducts"> 显示全部商品</label>
            <!-- v247：查看态默认收起「整列全空」的列（历史期次列 / 档案未填列），勾上才铺开 -->
            <label class="tb-toggle"><input type="checkbox" v-model="showEmptyCols"> 显示空列</label>
            <span v-if="hiddenEmptyCols" class="confirm-badge filter" :class="{ 'badge-slim': gridFullscreen }"
                  :title="'已收起 ' + hiddenEmptyCols + ' 个全空列（勾选「显示空列」即可展开）'"
                  :aria-label="'已收起 ' + hiddenEmptyCols + ' 个全空列'"
            ><Icon name="filter" /><template v-if="!gridFullscreen"> 已收起 {{ hiddenEmptyCols }} 个空列</template></span>
            <!-- v209：同「已隐藏 N 个零报单」，全屏时收成图标形态（实测本条占 180px，是全行最肥的单件） -->
            <span v-if="!showAllProducts && hiddenByRowBase" class="confirm-badge filter" :class="{ 'badge-slim': gridFullscreen }"
                  :title="'另有 ' + hiddenByRowBase + ' 个在售商品未显示（勾选「显示全部商品」即可展开）'"
                  :aria-label="'另有 ' + hiddenByRowBase + ' 个在售商品未显示'"
            ><Icon name="filter" /><template v-if="!gridFullscreen"> 另有 {{ hiddenByRowBase }} 个在售商品未显示</template></span>
            <div class="tb-pop">
              <button ref="brandBtn" class="btn btn-sm btn-ghost" :class="{on:brandPopOpen}" @click="toggleBrandPop"><Icon name="filter"/> 品牌<span v-if="brandSel.length" class="btn-badge">{{ brandSel.length }}</span> <Icon name="chevron-down"/></button>
              <Teleport to="body">
              <div v-if="brandPopOpen" class="tb-pop-panel brand-pop" :style="popStyle" @click.stop>
                <div class="bp-head"><span>按品牌（供货方）筛选报单</span><div class="bp-acts"><button class="link-btn" @click="brandSel = brandCandidates.slice()">全选</button><button class="link-btn" @click="brandSel = []">清空</button></div></div>
                <div class="bp-list">
                  <label v-for="b in brandCandidates" :key="b" class="bp-item"><input type="checkbox" :value="b" v-model="brandSel"> {{ b }}</label>
                  <p v-if="!brandCandidates.length" class="bp-empty">当前汇总表无品牌数据</p>
                </div>
                <p class="bp-tip">只勾选要报单的品牌：表格将只显示这些品牌，复制厂家编码/数量也只针对它们（多品牌合并报单时先勾选再复制）。</p>
              </div>
              </Teleport>
            </div>
            <!-- v170：「新增客户」入口 —— 承接从表头撤下的那一格（合计右侧，默认在视口外 2475px
                 且回车在碰过表格后静默失效）。与品牌筛选用完全同构的 .tb-pop + positionTbPop()，
                 零新增定位代码；面板内回车即可提交，弹层常显故不再有"看不见"的问题。 -->
            <div class="tb-pop">
              <button ref="addColBtn" class="btn btn-sm btn-ghost" :class="{on:addColPopOpen}" @click="toggleAddColPop" title="新增客户列（当期新开、从未在报单里出现过的客户/门店）"><Icon name="plus"/> 新增客户 <Icon name="chevron-down"/></button>
              <Teleport to="body">
              <div v-if="addColPopOpen" class="tb-pop-panel addcol-pop" :style="popStyle" @click.stop>
                <div class="ac-head">新增客户列</div>
                <div class="ac-row">
                  <input ref="addColInput" v-model="addColName" class="ac-input" placeholder="客户名（如：永辉超市）" @keyup.enter="confirmAddCol">
                  <button class="btn btn-sm btn-primary" :disabled="!addColName.trim()" @click="confirmAddCol">添加</button>
                </div>
                <p class="ac-tip">历史报单出现过的客户已自动成列；此处只用于「当期新开、从未提报」的客户/门店。加完请点右上角「保存」，才会存到后端。</p>
              </div>
              </Teleport>
            </div>
            <!-- v168：编辑态**刻意不提供**「复制报单」——
                 本态矩阵是**未定稿草稿**，rowFinalQty() 走「合计(箱) + 加单(箱)」口径；此时复制出去的
                 是"还没定稿的数"，很容易被当成最终报单直接粘进厂家系统下单 → 数错。
                 故复制入口**只在只读汇总表**提供（见上方 .grid-ctl-row）。
                 品牌筛选两态都留：它同时是**显示过滤**，改单时按品牌收窄视野仍有意义。 -->
            <!-- v209：**全屏专属**编辑控制组 —— 就是「改单」点击后出现的全部功能按钮 + 常驻保存状态。
                 与主工具栏 .tb-edit-group 那份**同源同文案**（同 :disabled / :title / @click）。
                 ⚠️ 两处必须同步改：任何一处增删按钮，另一处要跟上（本文件里品牌弹层、两态表格工具行
                    也是同样的「同构两处」写法，沿此惯例）。
                 只在全屏渲染的理由同「改单」入口：非全屏时主工具栏那行在手边，
                 而表格工具行没有多余宽度（实测非全屏 1440 塞入编辑组差 273px，必然折行）。 -->
            <template v-if="fsRowHosting">
              <span class="tb-sep"></span>
              <div class="tb-edit-group">
                <!-- Q12/Q30：编辑按钮带载入态与权限提示；Q25：校验按钮带待修正角标；Q27：失败后按钮变「重试保存」 -->
                <button class="btn btn-sm btn-ghost" @click="exitEdit">取消</button>
                <!-- v201：可用性与状态条**同源** —— 两者都只看 dirtySinceSave（＝有改动才可回退） -->
                <button class="btn btn-sm btn-ghost" :disabled="!dirtySinceSave" title="放弃自上次保存以来的改动，回到起点（上次保存时的内容；本次若从未保存过，则是刚进入编辑时的服务端内容）" @click="undoToLastSaved">回退</button>
                <button class="btn btn-sm btn-ghost" title="全表录入查错：列出类型/必填/上限/条码重复等错误（可点击跳转）" @click="openErrList">
                  查错<span v-if="errCount" class="btn-badge err">{{ errCount > 99 ? '99+' : errCount }}</span>
                </button>
                <button class="btn btn-sm btn-ghost" title="在网格末尾新增一行商品（补录商品）" @click="addRow"><Icon name="plus"/> 补录商品</button>
                <button class="btn btn-sm btn-primary" :class="{ 'btn-retry': !!saveFailed }" :disabled="noOpenPeriod"
                :title="noOpenPeriod ? saveBlockedReason : '保存本期报单矩阵'" @click="saveEdits">{{ savingEdit ? '保存中…' : (saveFailed ? '重试保存' : '保存') }}</button>
                <!-- v201/v208：常驻保存状态。三态 see saveState；保存成功后已改为退出编辑态，
                     故本态是「正在编辑、准备再改一轮」的人的常驻答案。 -->
                <span class="save-state" :class="saveState.cls"
                      :title="saveState.cls === 'dirty' ? '改动还没提交：点右侧「保存」才会生效'
                             : (saveState.cls === 'saved' ? '内容已提交到服务器；继续改动需再次点「保存」'
                                : '本次进入编辑后还没有任何改动')">
                  <i class="ss-dot"></i>{{ saveState.text }}
                </span>
              </div>
            </template>
          </div>
          <button class="grid-fs-btn" :title="gridFullscreen ? '退出全屏（Esc）' : '全屏查看表格（Esc 退出）'" @click="toggleGridFullscreen" aria-label="表体全屏切换">
            <Icon name="fullscreen" size="16"/>
          </button>
          <div class="filter-row" v-if="colFilter || colFilterSet">
            <span v-if="colFilter" class="filter-chip" :title="'按「' + colLabel(colFilter.key, colFilter.type, colFilter.ui) + '」筛选'">筛选「{{ colLabel(colFilter.key, colFilter.type, colFilter.ui) }}」={{ colFilter.val }} <button class="chip-x" @click="clearColFilter" aria-label="清除列筛选"><Icon name="close"/></button></span>
            <span v-if="colFilterSet" class="filter-chip" :title="'按「' + colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) + '」唯一值筛选'">筛选「{{ colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) }}」∈ {{ colFilterSet.values.length }} 值 <button class="chip-x" @click="clearUniqFilter" aria-label="清除唯一值筛选"><Icon name="close"/></button></span>
            <span v-if="brandSel.length" class="filter-chip" :title="'按品牌（供货方）筛选'">品牌 ∈ {{ brandSel.length }} 个 <button class="chip-x" @click="brandSel = []" aria-label="清除品牌筛选"><Icon name="close"/></button></span>
          </div>
          <div v-if="showColMenu" class="col-menu-overlay" @click="showColMenu=false"></div>
          <div v-if="showColMenu" class="col-menu edit-col-menu" @click.stop>
            <div class="col-menu-hd"><span>显示列（拖拽排序，<Icon name="check"/> 显示）</span><button class="col-menu-x" @click="showColMenu=false" title="关闭"><Icon name="close"/></button></div>
            <ul class="col-menu-list">
              <!-- v192：判定统一走 isLockedCol()，与查看态菜单、toggleCol、quickHide 同源。
                   此前这里读的是 `c.fixed`，而 `c` 来自 colOrder —— 那里**只有 name 带 fixed**
                   （defaultColOrder / loadCols 都只搬 key/label/cls）⇒ 固定列被识别不出来：
                   复选框不是 disabled、还能拖，点/拖却分别被 toggleCol 与 visibleCols 归位拒绝，
                   成了「点了跟没点一样」的假控件（查看态菜单 v184 已修好，改单态这处漏了）。 -->
              <li v-for="(c, ci) in colOrder" :key="c.key" :class="{ locked: isLockedCol(c.key), hidden: colVis[c.key] === false }" :draggable="!isLockedCol(c.key)" @dragstart="onColDragStart(ci)" @dragover.prevent @drop="onColDrop(ci)">
                <span class="drag">⠿</span>
                <label><input type="checkbox" :checked="colVis[c.key] !== false" :disabled="isLockedCol(c.key)" @click.prevent="toggleCol(c.key)"> {{ c.label }}</label>
                <button v-if="!isLockedCol(c.key) && c.deletable" class="col-menu-del" @click="deleteMasterCol(c.key)" title="删除该列"><Icon name="close"/></button>
              </li>
            </ul>
            <div class="col-menu-add">
              <span class="cm-label"><Icon name="plus"/> 添加主档列</span>
              <button v-for="c in addableMasterCols" :key="c.key" class="btn btn-xs btn-ghost" @click="addMasterCol(c.key)">{{ c.label }}</button>
            </div>
            <div class="col-menu-schemes">
              <span class="cm-label">列方案</span>
              <select v-model="schemeName" @change="applyScheme(schemeName)">
                <option value="">选择方案…</option>
                <option v-for="s in schemes" :key="s.name" :value="s.name">{{ s.name }}</option>
              </select>
              <button class="btn btn-ghost btn-xs" @click="saveScheme">保存当前</button>
              <button class="btn btn-ghost btn-xs" @click="delScheme(schemeName)" :disabled="!schemeName" title="删除所选方案">删除</button>
            </div>
            <div class="col-menu-reset">
              <button class="btn btn-ghost btn-xs" @click="resetColWidths" title="清除本地列宽记忆，恢复默认列宽">重置列宽</button>
            </div>
          </div>
          <div class="table-wrap edit-grid-wrap" @scroll="onEditScroll">
          <table class="tbl cross-tbl edit-tbl" :class="{ dragging }" @paste="onPaste" @keydown="onGridKey" @contextmenu.prevent="onTbCtx" :style="{ zoom: gridZoom + '%' }">
            <colgroup>
              <col v-for="(k, i) in editColKeys" :key="'eg' + k + i" :style="{ width: colW(k) + 'px' }"></col>
            </colgroup>
            <thead>
              <tr>
                <th class="th seq-th">
                  <button class="col-cfg gear" @click.stop="showColMenu = !showColMenu" title="列设置"><Icon name="settings"/></button>
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'seq')" @click.stop></span>
                </th>
                <th v-for="(c, ci) in visibleCols" :key="c.key" :class="['th', c.cls, { frozen: c.fixed || c.key === frozenExtra, 'sel-col': selected.r >= 0 && selected.c === ci }]" :style="c.fixed ? 'left:' + frozenLeftOf(c.key) : (c.key === frozenExtra ? 'left:' + frozenRight() : '')" @contextmenu.prevent="openHdrCtx($event, c.key, 'master')">
                  <div class="th-in">
                    <span>{{ c.label }}</span>
                  </div>
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, c.key)" @click.stop></span>
                </th>
                <th v-for="(u, ui) in cross.units" :key="u.name" class="qty-th" :class="{ 'sel-col': selected.r >= 0 && selected.c === visibleCols.length + ui }" @contextmenu.prevent="openHdrCtx($event, u.name, 'qty', ui)">
                  <div class="cust-hd">
                    <input :value="u.name" class="cell-input cell-cust" @change="renameCol(ui, $event.target.value)" :title="u.role || '报单单元'">
                    <button class="col-del" @click="delCol(ui)" title="删除该客户列"><Icon name="close"/></button>
                  </div>
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, u.name)" @click.stop></span>
                </th>
                <!-- v188：列名自证单位（用户 2026-09-18）——「合计」→「合计(小单位)」、「件数(箱)」→「合计(箱)」。
                     原「合计」二字未标单位、同屏又与按箱的「件数(箱)」并列，易被读成同一个量。 -->
                <th class="num calc-th sum">合计(小单位)<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'sum')" @click.stop></span></th>
                <th class="num calc-th boxes">合计(箱)<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'boxes')" @click.stop></span></th>
                <th v-if="showSuggest" class="num calc-th suggest" title="配方建议：按「建议算法」面板当前策略算出，只受该面板影响">配方建议<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'suggest')" @click.stop></span></th>
                <th class="num calc-th extra">加单(箱)<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'extra')" @click.stop></span></th>
                <th class="num calc-th final">最终下单(箱)<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'final')" @click.stop></span></th>
                <th class="num calc-th price" title="可直接录入：填「元/箱」。留空则**自动沿用上一期录入过的价**（本期之前最近一次填过的，不用重填）；从未填过则按商品档案的进价自动算（档案进价本身就是「元/箱」，直接作为本单价）。录入的价只在本期生效：点「保存」后随本期报单留存，不改商品档案，也不影响其他期次。">单价(进价/箱)<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'price')" @click.stop></span></th>
                <th class="num calc-th amount">下单金额(进价)<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'amount')" @click.stop></span></th>
                <th v-if="compareOn" class="num calc-th">上期量<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'comparePrev')" @click.stop></span></th>
                <th v-if="compareOn" class="num calc-th delta">Δ<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'compareDelta')" @click.stop></span></th>
                <th v-if="showSpark" class="spark-th">趋势<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'spark')" @click.stop></span></th>
                <th v-if="yoyOn" class="num calc-th">去年同期<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'yoyPrev')" @click.stop></span></th>
                <th v-if="yoyOn" class="num calc-th">同比<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'yoyDelta')" @click.stop></span></th>
                <!-- v170：此处原为「客户名」输入框（= 新增客户列入口）。撤除原因（真机实测）：
                     ① 表头总宽 4008px、可视仅 1360px，它默认在视口右界外 2475px，用户基本看不到；
                     ② 回车静默失效 —— <table @keydown="onGridKey"> 在有选区时会 focusCell()，
                        焦点在 keydown 阶段就被搬走，输入框自己的 @keyup.enter 永远收不到。
                     入口已迁到本行工具行的「新增客户」按钮（见上方 .grid-ctl-row），那一列一并撤除。 -->
                <th class="op-th">操作<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'op')" @click.stop></span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, ri) in cross.rows" :key="ri" :class="{ 'sel-row': selected.r === ri, 'cond-warn': condWarnOn && rowWarn(r) === 'low', 'new-row': r._new }" v-show="rowShown(ri)">
                <td class="td seq-cell" :class="{ 'row-bad': errRowSet.has(ri) }" :data-r="ri"><span class="seq-num">{{ ri + 1 }}</span></td>
                <td v-for="(c,  ci) in visibleCols" :key="c.key" :class="['td', c.cls, { frozen: c.fixed || c.key === frozenExtra, selected: selected.r === ri && selected.c === ci, 'range-sel': inRange(ri, ci), invalid: cellInvalid(ri, ci), flash: isFlash(ri, ci) }]" :style="c.fixed ? 'left:' + frozenLeftOf(c.key) : (c.key === frozenExtra ? 'left:' + frozenRight() : '')" :data-r="ri" :data-c="ci" :title="cellIssue(ri, ci) || null" @mousedown="onCellDown(ri, ci, $event)" @mouseover="onCellOver(ri, ci)">
                  <template v-if="c.key === 'name'">
                    <!-- v215：商品名候选**自建面板**（替掉原生 datalist）。
                         🔴 为什么必须自建：datalist 的过滤由浏览器定（Safari 只认前缀）、
                            只按 value 匹配 ⇒ 条码后四位 / 拼音首字母**无从表达**。
                         ⚠️ `@input` 里开面板（datalist 时代没有这一格的输入事件）；
                            `@keydown` 上下选 / 回车选中 / Esc 关闭；`@blur` 关闭。 -->
                    <input v-model="r.name" class="cell-input cell-name" :placeholder="namePh" :style="namePadStyle(r)" :title="r.name || ''" :data-r="ri" :data-c="ci" @focus="onFocusCell(ri, ci, $event)" @input="onNameInput(r, ri, ci, $event)" @keydown="nameSugKey" @blur="nameSugClose" @change="onCellChange">
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
                      <span v-if="rowWarn(r) === 'low'" class="warn-badge" title="低于安全库存"><Icon name="alert-triangle"/></span>
                      <span v-else-if="rowWarn(r) === 'short'" class="warn-badge short" title="短保（保质期≤7天）"><Icon name="alert-triangle"/></span>
                      <span v-if="lossWarn(r)" class="loss-badge" :class="lossWarn(r)" :title="lossTip(r)"><Icon name="flame"/></span>
                      <span v-if="rtBadge(r)" class="rt-badge" :class="rtBadge(r)" :title="rtBadgeTip(r)"><Icon name="bell"/></span>
                      <span v-if="rowNote(r)" class="note-badge" :title="rowNote(r)" @click="setRowNote(ri)"><Icon name="message"/></span>
                      <span v-if="gapSet.has(r.product_id)" class="gap-badge" title="缺批次/到期资料，需补录"><Icon name="alert-triangle"/></span>
                      <span v-if="hsMap[r.product_id] !== undefined && hsMap[r.product_id] < 60" class="hs-badge" :title="'健康分 '+hsMap[r.product_id]+'（偏低，需补全资料）'"><Icon name="lightbulb"/></span>
                    </div>
                  </template>
                  <template v-else-if="c.edit === 'text' && c.options && c.options.length">
                    <input v-model="r[c.key]" class="cell-input cell-wide" :placeholder="c.label" :data-r="ri" :data-c="ci" :list="'opt-' + c.key" @focus="onFocusCell(ri, ci, $event)" @change="onCellChange">
                    <!-- 共享 datalist：仅首行渲染一份，避免每行重复 id + 海量 option 节点导致点击展开时标签页崩溃 -->
                    <datalist v-if="ri === 0" :id="'opt-' + c.key">
                      <option v-for="o in c.options" :key="o" :value="o"></option>
                    </datalist>
                  </template>
                  <template v-else-if="c.edit === 'text'">
                    <input v-model="r[c.key]" class="cell-input cell-wide" :placeholder="c.label" :data-r="ri" :data-c="ci" @focus="onFocusCell(ri, ci, $event)" @change="onCellChange">
                  </template>
                  <template v-else-if="c.edit === 'num'">
                    <input :value="r[c.key] ?? ''" class="cell-input cell-num" type="text" :inputmode="c.num === 'int' ? 'numeric' : 'decimal'" placeholder="·" :data-r="ri" :data-c="ci" @focus="onFocusCell(ri, ci, $event)" @input="numInput($event, r, c.key)" @change="numCommit($event, r, c.key)">
                  </template>
                  <!-- v184：只读列（edit:'ro'）—— 有**展示**、没有写入口。
                       ⚠️ 这里刻意不放 input：本列（到货周期）唯一写入口是「预报导入」，
                          后端 bulk_upsert 的字段白名单里没有 arrival_lead_days ⇒
                          摆个输入框就是**假旋钮**（用户改了、保存后静默回旧值、且不报错）。
                       文案与查看态共用同一个 fmt（masterVal 也走 fmt）⇒ 两态显示必然一致。 -->
                  <template v-else-if="c.edit === 'ro'">
                    <span class="cell-ro">{{ c.fmt ? c.fmt(r) : (r[c.key] != null && r[c.key] !== '' ? r[c.key] : '—') }}</span>
                  </template>
                  <!-- v211（P1-3）：错误角标 —— **触屏唯一能读到「为什么错」的入口**（td 的 title 要悬停，
                       平板/手机没有悬停）。桌面侧它也顺带把「哪一格错了」标得比纯红框显眼。 -->
                  <span v-if="cellIssue(ri, ci)" class="cell-err-dot" :title="cellIssue(ri, ci)" @mousedown.stop.prevent @click.stop="showCellErr(ri, ci)" aria-label="查看此格的错误原因"><Icon name="alert-triangle"/></span>
                  <span v-if="selected.r === ri && selected.c === ci" class="fill-handle" @mousedown.prevent.stop="startFill(ri, ci, $event)" title="拖拽填充"></span>
                </td>
                <td v-for="(u, ui) in cross.units" :key="u.name" class="qty-cell" :class="{ selected: selected.r === ri && selected.c === visibleCols.length + ui, 'range-sel': inRange(ri, visibleCols.length + ui), invalid: cellInvalid(ri, visibleCols.length + ui), 'warn-low': rowWarn(r) === 'low', 'warn-short': rowWarn(r) === 'short', 'diff-chg': snapCompare && cellDiff(ri, ui) !== 0, flash: isFlash(ri, visibleCols.length + ui) }" :style="heatStyle(r, u.name)" :data-r="ri" :data-c="visibleCols.length + ui" :title="cellErrMsg(ri, visibleCols.length + ui) || null" @mousedown="onCellDown(ri, visibleCols.length + ui, $event)" @mouseover="onCellOver(ri, visibleCols.length + ui)">
                  <!-- v211（P1-2）：补 `inputmode` —— 触屏设备（平板 / 手机开网页）点这一格直接弹**数字键盘**。
                       ⚠️ 不能只靠 `type="number"`：iOS 会弹数字键盘，但部分安卓浏览器不给 ⇒ 加 inputmode 是双保险。
                       ⚠️ 只有**数量**用 numeric（整数）；单价有 `step="0.01"`（两位小数）必须用 decimal，
                          否则安卓上小数点键会消失，用户永远填不了小数价。 -->
                  <input :value="r.qtyByUnit[u.name] ?? ''" class="cell-input cell-qty" type="text" inputmode="numeric" placeholder="·" :data-r="ri" :data-c="visibleCols.length + ui" :list="qtyListFor(ri, ui)" @focus="onFocusCell(ri, visibleCols.length + ui, $event)" @input="numInput($event, r.qtyByUnit, u.name)" @change="numCommit($event, r.qtyByUnit, u.name)">
                  <!-- v211（P1-3）：同主档列的角标。这里用 `cellErrMsg` 而非 `cellIssue`：
                       数量格不涉及条码，与 td 自己的 title 保持**同一个判据**（否则角标和悬停会各说一套）。 -->
                  <span v-if="cellErrMsg(ri, visibleCols.length + ui)" class="cell-err-dot" :title="cellErrMsg(ri, visibleCols.length + ui)" @mousedown.stop.prevent @click.stop="showCellErr(ri, visibleCols.length + ui)" aria-label="查看此格的错误原因"><Icon name="alert-triangle"/></span>
                  <!-- v212（P2-2）：**软警告角标**（黄=疑）—— 只有数量格有。
                       三类角标各占一角，互不遮挡：红（一定错）在**左上**、黄（可能错）在**右上**、
                       填充柄在**右下**（左下留给「行号格标红」那条视觉通道，不占）。
                       ⚠️ `z-index` 必须 < 6（`.seq-cell` / `.frozen` 都是 6）—— 否则横向滚动时
                          角标会浮在冻结列**上方**，像贴错了格子。 -->
                  <span v-if="cellSoftIssue(ri, ui)" class="cell-soft-dot" :class="'soft-' + cellSoftIssue(ri, ui)" :title="cellSoftMsg(ri, ui)" @mousedown.stop.prevent @click.stop="showCellSoft(ri, ui)" aria-label="查看此格的疑点"><Icon name="alert-triangle"/></span>
                  <span v-if="selected.r === ri && selected.c === visibleCols.length + ui" class="fill-handle" @mousedown.prevent.stop="startFill(ri, visibleCols.length + ui, $event)" title="拖拽填充"></span>
                </td>
                <td class="num calc sum" :class="[warnClass(ri), moqWarn(r) === 'below' ? 'moq-below' : '']" :data-r="ri">{{ fmt(rowSum(r)) }}</td>
                <td class="num calc boxes" :data-r="ri"><span :class="{ 'miss-price': boxMissing(r) }">{{ boxText(r) }}</span></td>
                <td v-if="showSuggest" class="num calc suggest" :data-r="ri" title="配方建议：按「建议算法」面板策略算出">{{ fmt(r.suggest || 0) }}<button class="mini-btn" @click="adoptSuggestion(ri)" :disabled="!(r.suggest > 0)">采纳</button></td>
                <td class="num calc extra" :data-r="ri"><input :value="r.extraQty ?? ''" class="cell-input cell-qty" type="text" inputmode="numeric" placeholder="·" :data-r="ri" :data-c="C_EXTRA_INPUT" @focus="onFocusCell(ri, C_EXTRA_INPUT, $event)" @input="numInput($event, r, 'extraQty')" @change="numCommit($event, r, 'extraQty')"></td>
                <td class="num calc final" :data-r="ri"><b>{{ fmt(rowFinalQty(r)) }}</b></td>
                <td class="num calc price" :class="{ 'miss-price': pricePerCase(r) == null }" :data-r="ri"><input :value="r.casePrice ?? ''" class="cell-input cell-price" :class="{ 'manual-price': Number(r.casePrice) > 0 }" type="text" inputmode="decimal" :placeholder="pricePh(r)" :title="priceTitle(r)" :data-r="ri" :data-c="C_PRICE_INPUT" @focus="onFocusCell(ri, C_PRICE_INPUT, $event)" @input="numInput($event, r, 'casePrice')" @change="onCasePriceChange(r, $event)"></td>
                <td class="num calc amount" :data-r="ri"><span :class="{ 'miss-price': pricePerCase(r) == null }">{{ amountValue(r) != null ? fmt(amountValue(r)) : (factoryPrice(r) <= 0 ? '缺价' : '缺规格') }}</span></td>
                <td v-if="compareOn" class="num calc" :data-r="ri">{{ prevQty(r) != null ? fmt(prevQty(r)) : '—' }}</td>
                <td v-if="compareOn" class="num calc delta" :class="deltaClass(r)" :data-r="ri">{{ deltaQty(r) == null ? '—' : (deltaQty(r) > 0 ? '+' : '') + fmt(deltaQty(r)) }}</td>
                <td v-if="showSpark" class="spark-td" :data-r="ri">
                  <svg v-if="(r.history || []).length >= 2" width="84" height="18"><polyline :points="sparkPoints(r)" fill="none" :stroke="sparkColor(r)" stroke-width="1.5"/></svg>
                  <span v-else class="muted">—</span>
                </td>
                <td v-if="yoyOn" class="num calc" :data-r="ri">{{ yoyQty(r) != null ? fmt(yoyQty(r)) : '—' }}</td>
                <td v-if="yoyOn" class="num calc delta" :class="yoyPct(r) > 0 ? 'up' : (yoyPct(r) < 0 ? 'down' : '')" :data-r="ri">{{ yoyPct(r) == null ? '—' : (yoyPct(r) > 0 ? '+' : '') + yoyPct(r) + '%' }}</td>
                <td class="op-th" :data-r="ri"><button class="btn-del" @click="delRow(ri)" title="删除该商品行"><Icon name="close"/></button></td>
              </tr>
            </tbody>
            </table>
            <!-- v212（P2-1）：数量格候选的**唯一** datalist（全表共用一个）。
                 🔴 `:key="qtyOptKey"` 是刻意的 —— 换格时**销毁重建**这个元素。
                    只改 <option> 内容而不换节点，`input.list` 的惰性解析可能沿用旧候选，
                    用户会看到上一格的数（本设计唯一的真实风险点）。换 key 即强制新节点。
                 🔴 放在 <table> **外面**：datalist 不是表格内容，塞进 <tr>/<td> 里虽然浏览器
                    容错能渲染，但会让「每行是否都渲染了一份」这种问题在结构上变得难判
                    （v211 的商品名 datalist 放在 td 里是因为它要跟着 ri===0 那行走，
                     本处不需要 —— 只有聚焦格才带 list，其它格谁也引用不到它）。
                 ⚠️ `v-if="editMode && qtyOptKey"`：查看态不渲染；没有任何数量格聚焦时不渲染
                    （避免留一个空壳 datalist，被别处的 `list=` 意外命中）。 -->
            <datalist v-if="editMode && qtyOptKey" id="opt-qty" :key="qtyOptKey">
              <option v-for="o in qtyCellOptions" :key="o.v" :value="o.v" :label="o.l"></option>
            </datalist>
          </div>
          <div ref="editFoot" class="col-total-bar">
          <table class="tbl cross-tbl edit-tbl">
            <colgroup>
              <col v-for="(k, i) in editColKeys" :key="'efg' + k + i" :style="{ width: colW(k) + 'px' }"></col>
            </colgroup>
            <tbody>
              <tr class="foot-row">
                <td class="seq-cell"></td>
                <td v-for="c in visibleCols" :key="'f' + c.key" class="num calc" :class="{ frozen: c.fixed || c.key === frozenExtra }" :style="c.fixed ? 'left:' + frozenLeftOf(c.key) : (c.key === frozenExtra ? 'left:' + frozenRight() : '')">{{ c.key === 'name' ? '合计' : (c.edit === 'num' ? fmt(foot.masterSum[c.key] || 0) : '') }}</td>
                <td v-for="(u, ui) in cross.units" :key="'fu' + u.name" class="num calc">{{ fmt(foot.unitSum[ui] || 0) }}</td>
                <td class="num calc sum">{{ fmt(foot.qty) }}</td>
                <td class="num calc boxes">{{ fmtBox(editTotalBoxes) }}<span v-if="boxMissingRows.length" class="box-miss">（缺规格 {{ boxMissingRows.length }} 行未计入）</span></td>
                <td v-if="showSuggest" class="num calc suggest">{{ fmt(foot.suggest) }}</td>
                <td class="num calc extra">{{ fmt(liveRows.reduce((s, r) => s + (Number(r.extraQty) || 0), 0)) }}</td>
                <td class="num calc final">{{ fmt(liveRows.reduce((s, r) => s + rowFinalQty(r), 0)) }}</td>
                <td class="num calc price">—</td>
                <td class="num calc amount">{{ fmt(foot.amount) }}</td>
                <td v-if="compareOn" class="num calc">—</td>
                <td v-if="compareOn" class="num calc delta">—</td>
                <td v-if="showSpark" class="spark-td"></td>
                <td v-if="yoyOn" class="num calc">—</td>
                <td v-if="yoyOn" class="num calc delta">—</td>
                <td class="op-th"></td>
              </tr>
            </tbody>
          </table>
          </div>
          <div class="amt-note-toggle" @click="amtNoteOpen=!amtNoteOpen">口径说明（下单/单价录入口径）{{ amtNoteOpen ? ' ▴' : ' ▾' }}</div>
          <p v-if="amtNoteOpen" class="cross-amt-note">最终下单(箱) = 合计(箱) <b>不足一箱按一箱</b> + 加单(箱)（厂商不拆零发货）；<b>下单金额(进价) = 最终下单(箱) × 单价(进价/箱)</b>。<b>单价可直接在格子里录入</b>（填「元/箱」）；留空 = <b>自动沿用上一期录入过的价</b>（不用每期重填），从未填过则按商品档案的进价自动算。录入的价<b>只在本期生效</b> —— 点「保存」后留在本期报单里，不改商品档案，也不影响其他期次。</p>
          <!-- ⚠️ v212 两处修正（都是真机探针抓出来的，不是推演出来的）——
               ① 判据从 `selStats` 改成 `selRange`。
                  原写法在**选区里一个数字都没有**时整条不渲染 —— 而「框选一片空格子 → 填同一个数」
                  恰恰是「批量填入」最主要的用法（一个客户这个月每种货都订 10 箱：
                  框选一列空格 → 输 10 → 填入）。结果是**功能在真正需要它的那一步消失**，
                  而且不报错、不出提示（静默缺入口，比报错更难发现）。
               ② 「N 格」提到最外层、恒显示；求和/平均只在**真的有意义**时才显示。
                  理由：这一格的初值大量是 `0`（不是空串）⇒ 逐格算出来的 `sum` 恒为 0，
                  于是恒显示「求和 0 / 平均 0」——对用户是纯噪音，还容易被读成"里面全是 0（有数据）"。
                  格数才是用户在这一刻唯一必须知道的事（**会被写入多少格**）。 -->
          <div v-if="selRange" class="sel-stat">
            <span class="sel-stat-label">选区统计</span>
            <span>共 <b>{{ selCellCount }}</b> 格</span>
            <template v-if="selStats && selStats.sum !== 0">
              <span>有数 <b>{{ selStats.count }}</b> 格</span>
              <span>求和 <b>{{ fmt(selStats.sum) }}</b></span>
              <span>平均 <b>{{ fmt(selStats.avg) }}</b></span>
            </template>
            <!-- v212（P2-3）：**「选区批量填同值」的可见入口**。
                 功能（Ctrl+Enter：选中一片 → 输一个值 → 全部写入）自 Q17 就实现了，
                 但**只活在快捷键里** ⇒ 不记快捷键的用户根本不知道它存在。
                 陈列在选区统计条上是刻意选的位置：这条**只在有选区时出现**，
                 正好是「刚框完一片、正想批量改」的那个瞬间。
                 ⚠️ 与右键菜单里那条共用同一个 `ctxFillVal` / `fillSelectionWith` ——
                    同一份状态、同一个写入口，不做第二套。
                 ⚠️ 输入框必须 `<input type=number>` + `inputmode` 双保险（同数量格的理由）；
                    回车与按钮等价（表单心智：填完回车就走）。 -->
            <span class="sel-fill">
              <span class="sel-fill-label">批量填入</span>
              <input :value="ctxFillVal" class="sel-fill-ipt" type="text" inputmode="numeric" :placeholder="selCellCount + ' 格'" aria-label="批量填入的值" @input="numInput($event, setFillVal)" @keyup.enter="applySelFill">
              <button class="sel-fill-go" :disabled="String(ctxFillVal == null ? '' : ctxFillVal).trim() === ''" @click="applySelFill" title="把该值写入选中区域（等同于 Ctrl+Enter）">填入</button>
            </span>
            <button class="sel-stat-x" @click="selRange = null" title="清除选区"><Icon name="close"/></button>
          </div>
          <div v-if="openGroup" class="grp-row">
            <template v-if="openGroup==='quality'">
              <button class="btn btn-ghost btn-sm" @click="gapOpen=!gapOpen" :disabled="gapLoading"><Icon name="alert-triangle"/> 补录批次资料</button>
              <button class="btn btn-ghost btn-sm" @click="safetyOpen=!safetyOpen" :disabled="safetyLoading"><Icon name="shield"/> 安全库存</button>
              <button class="btn btn-ghost btn-sm" @click="rollingOn=!rollingOn"><Icon name="calendar"/> 滚动预报</button>
              <button class="btn btn-ghost btn-sm" @click="loadVariance" :disabled="varLoading"><Icon name="trending-down"/> 偏差归因</button>
              <button class="btn btn-ghost btn-sm" @click="healthOpen=!healthOpen"><Icon name="activity"/> 体检</button>
              <button class="btn btn-ghost btn-sm" @click="loadHealthScore" :disabled="hsLoading"><Icon name="lightbulb"/> 健康分</button>
            </template>
            <template v-else-if="openGroup==='smart'">
              <button class="btn btn-ghost btn-sm" @click="loadTs" :disabled="tsLoading"><Icon name="bot"/> 运行预测</button>
              <button class="btn btn-ghost btn-sm" @click="openCal"><Icon name="calendar"/> 日历因子</button>
              <button class="btn btn-ghost btn-sm" @click="nlOpen=!nlOpen"><Icon name="message"/> 自然语言改单</button>
              <button class="btn btn-ghost btn-sm" @click="topupOpen=!topupOpen"><Icon name="sparkle"/> 凑单达返利</button>
            </template>
            <template v-else-if="openGroup==='collab'">
              <button class="btn btn-ghost btn-sm" @click="poOpen=!poOpen"><Icon name="package"/> 供应商订单</button>
              <button class="btn btn-ghost btn-sm" @click="loadPo2" :disabled="po2Loading"><Icon name="receipt"/> 采购直发</button>
              <button class="btn btn-ghost btn-sm" @click="loadHeal" :disabled="healLoading"><Icon name="settings"/> 异常修复</button>
              <button class="btn btn-ghost btn-sm" @click="miniInputOpen=!miniInputOpen"><Icon name="smartphone"/> 小程序录单</button>
              <button class="btn btn-ghost btn-sm" @click="miniOpen=!miniOpen"><Icon name="smartphone"/> 小程序审批</button>
              <button class="btn btn-ghost btn-sm" @click="rtWarnOpen=!rtWarnOpen" :disabled="rtWarnLoading"><Icon name="bell"/> 库存预警</button>
              <label class="basis-toggle"><input type="checkbox" v-model="autoAlertOn" @change="maybeAutoAlert"> 主动预警</label>
            </template>
            <template v-else-if="openGroup==='hist'">
              <label class="basis-toggle">对比期
                <select v-model="compareBaseId" @change="loadComparePeriod(compareBaseId)">
                  <option value="">任选…</option>
                  <option v-for="p in compareablePeriods" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
              <button v-if="compareOn" class="btn btn-ghost btn-xs" @click="clearCompare">清除期次对比</button>
              <button class="btn btn-ghost btn-sm" @click="loadHistory" :disabled="historyLoading" title="载入近 6 期趋势，在汇总表加「趋势」迷你图列"><Icon name="trending-up"/> 近6期趋势</button>
              <button class="btn btn-ghost btn-sm" @click="loadYoY" :disabled="historyLoading"><Icon name="calendar"/> 去年同期</button>
            </template>
            <template v-else-if="openGroup==='more'">
              <button class="btn btn-ghost btn-sm" @click="batchMode=!batchMode"><Icon name="grid"/> 批量编辑</button>
              <button class="btn btn-ghost btn-sm" @click="saveSnap"><Icon name="save"/> 保存快照</button>
              <button class="btn btn-ghost btn-sm" @click="loadRebatePush" :disabled="rebatePushLoading"><Icon name="coins"/> 返利缺口</button>
              <button class="btn btn-ghost btn-sm" @click="showMoq=!showMoq"><Icon name="package"/> 起订量</button>
              <button class="btn btn-ghost btn-sm" @click="genSuggestBook" :disabled="suggestBookLoading"><Icon name="file-text"/> 生成下单说明</button>
              <button class="btn btn-ghost btn-sm" @click="loadAccuracy" :disabled="accLoading"><Icon name="target"/> 预报准确率</button>
              <!-- v166：非编辑态的常显入口在「汇总表视图切换行」；编辑态那一行不渲染，故这里
                   保留同一面板的第二个入口（文案与图标与常显入口逐字一致，避免两条路径说两套话）。 -->
              <button class="btn btn-ghost btn-sm" :class="{on:trailOpen}" @click="toggleTrail"><Icon name="list"/> 修改日志</button>
              <button class="btn btn-ghost btn-sm" @click="loadTemplates" :disabled="tmplLoading"><Icon name="book"/> 行业模板</button>
              <button class="btn btn-ghost btn-sm" @click="loadBI" :disabled="biLoading"><Icon name="bar-chart"/> 经营看板</button>
              <button class="btn btn-ghost btn-sm" @click="suggestPanel=!suggestPanel" title="建议量算法：只影响报单汇总表的「配方建议」列，不影响「系统建议」列"><Icon name="settings"/> 建议算法</button>
              <button class="btn btn-ghost btn-sm" @click="pagingOn=!pagingOn"><Icon name="file"/> 分页模式</button>
            </template>
          </div>
          <div v-if="suggestPanel" class="recipe-panel">
            <span class="hint">只影响「配方建议」列</span>
            <span>策略</span>
            <select v-model="suggRecipe.strategy">
              <option value="safety">安全库存法</option>
              <option value="avg">历史均值法</option>
              <option value="trend">趋势外推法</option>
              <option value="blend">加权混合法</option>
            </select>
            <span v-if="suggRecipe.strategy !== 'safety'">覆盖天数<input :value="suggRecipe.coverageDays" type="text" inputmode="numeric" class="recipe-val" @input="numInput($event, suggRecipe, 'coverageDays')"></span>
            <span v-if="suggRecipe.strategy === 'trend'">外推步数<input :value="suggRecipe.trendSteps" type="text" inputmode="numeric" class="recipe-val" @input="numInput($event, suggRecipe, 'trendSteps')"></span>
            <span v-if="suggRecipe.strategy === 'blend'">历史权重<input :value="suggRecipe.trendWeight" type="text" inputmode="decimal" class="recipe-val" @input="numInput($event, suggRecipe, 'trendWeight')"></span>
            <label class="basis-toggle">配方
              <select v-model="recipePick" @change="applySuggestRecipe(recipePick)">
                <option value="">选择…</option>
                <option v-for="s in suggestRecipes" :key="s.name" :value="s.name">{{ s.name }}</option>
              </select>
              <button class="btn btn-ghost btn-xs" @click="saveSuggestRecipe">存</button>
            </label>
            <button class="btn btn-ghost btn-xs" @click="suggestPanel = false">收起</button>
          </div>
          <div v-if="batchMode" class="batch-panel">
            <span>批量应用到选中行：</span>
            <select v-model="batch.col">
              <option value="">选择列…</option>
              <option v-for="c in batchableCols" :key="c.key" :value="c.key">{{ c.label }}</option>
            </select>
            <select v-model="batch.op">
              <option value="mul">× 系数</option>
              <option value="add">+ 加值</option>
              <option value="set">= 设值</option>
            </select>
            <input :value="batch.val" type="text" inputmode="decimal" class="batch-val" placeholder="数值" @input="numInput($event, batch, 'val')">
            <button class="btn btn-primary btn-xs" @click="applyBatch">应用</button>
            <span class="hint">先 Shift+点击 或 拖选多行</span>
          </div>
          <div v-if="snaps.length" class="snap-bar">
            <span>快照对比：</span>
            <button v-for="s in snaps" :key="s.name" class="btn btn-ghost btn-xs" @click="diffSnap(s.name)">对比 {{ s.name }}</button>
            <button class="btn btn-ghost btn-xs" @click="snapCompare = null">清除快照对比</button>
            <button v-if="snapCompare" class="btn btn-primary btn-xs" @click="exportDiffXlsx"><Icon name="download"/> 导出差异</button>
          </div>
          <!-- v174：查错结果面板。
               原实现只把校验结果写进 errList/errListOpen，**模板里没有任何渲染** ⇒
               点「查错」后界面上什么都不出现（连 toast 都没有），用户只看到角标上有个数字
               却不知道错在哪里。本面板把结果落到界面：先按原因分组给出总数，再逐条列出
               「第几行 · 哪个商品 · 哪一列 · 什么错」，点一条即跳到该格。 -->
          <div v-if="editMode && errListOpen" class="info-panel err-panel">
            <div class="panel-hd">
              <b><Icon name="alert-triangle"/> 查错</b>
              <span class="tag" :class="errList.length ? 'warn' : 'ok'">
                {{ errList.length ? errList.length + ' 处待修正' : '全部通过' }}
              </span>
              <button class="imp-x" @click="errListOpen=false"><Icon name="close"/></button>
            </div>
            <template v-if="errList.length">
              <div class="err-grps">
                <button class="err-grp" :class="{ on: errKind === '' }" @click="errKind = ''">全部 {{ errList.length }}</button>
                <button v-for="g in errGroups" :key="g.k" class="err-grp"
                        :class="{ on: errKind === g.k }" @click="errKind = errKind === g.k ? '' : g.k">
                  {{ g.label }} {{ g.n }}
                </button>
              </div>
              <!-- v219 打磨⑤：一键修复入口。只对「原值本身就能算出来」的项可点，
                   其余（重复建档/负数/名称缺失…）明确告知需手工，不给「假装能修」的按钮。 -->
              <div class="err-fixbar">
                <button v-if="fixables.length" class="btn btn-sm btn-primary" @click="openFixPreview">
                  <Icon name="wizard"/> 一键修复 {{ fixables.length }} 处
                </button>
                <span v-if="manualErrs" class="err-fixhint">
                  {{ fixables.length ? '另有 ' : '' }}{{ manualErrs }} 处需手工判断（重复建档 / 负数 / 名称缺失等），不会自动改
                </span>
                <!-- v219 打磨⑥：上限入口就放在「被上限拦下」真正发生的地方 -->
                <button v-if="canEditRules" class="err-rulebtn" @click="openRuleEdit"
                        title="改本租户的数量录入上限：超过它的数量会被标红并在保存时拦下">
                  数量上限 {{ qtyMax }} · 修改
                </button>
              </div>
              <div class="err-list-wrap">
                <ul class="err-list">
                  <li v-for="it in errShown" :key="it.ri + '_' + it.ci" @click="gotoErr(it)">
                    <span class="err-loc">第 {{ it.row }} 行 · {{ it.name || '（无名称）' }} · {{ it.col }}</span>
                    <span class="err-why">{{ it.msg }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="errShown.length < errFiltered.length" class="err-more">
                还有 {{ errFiltered.length - errShown.length }} 处未列出
              </div>
            </template>
            <div v-else class="err-empty">已全部修正，可以保存了</div>
          </div>
          <!-- v219 打磨⑤：一键修复的**预览确认**弹窗。
               存在的理由：批量改数值必须让用户看见每一处「改成什么、依据是什么」，
               不能点了按钮背后悄悄改。用户看过再确认 ⇒ 不是静默改写。 -->
          <Teleport to="body">
            <div v-if="fixPreviewOpen" class="fix-mask" @click.self="fixPreviewOpen = false">
              <div class="fix-dlg">
                <div class="fix-hd">
                  <b><Icon name="wizard"/> 一键修复预览</b>
                  <button class="imp-x" @click="fixPreviewOpen = false"><Icon name="close"/></button>
                </div>
                <p class="fix-tip">
                  以下 <b>{{ fixables.length }}</b> 处将按<b>原值本身就能算出的结果</b>修改（只取值、不猜、不清空）。
                  确认后整批执行，<b>一次 Ctrl+Z 可整批还原</b>。
                </p>
                <div class="fix-list-wrap">
                  <ul class="fix-list">
                    <li v-for="(x, i) in fixables" :key="i">
                      <span class="fix-loc">第 {{ x.row }} 行 · {{ x.name || '（无名称）' }} · {{ x.col }}</span>
                      <span class="fix-chg"><span class="fix-old">{{ x.old || '（空）' }}</span> → <b class="fix-new">{{ x.neu }}</b></span>
                      <span class="fix-how">{{ x.how }}</span>
                    </li>
                  </ul>
                </div>
                <div class="fix-ft">
                  <span v-if="manualErrs" class="fix-rest">另有 {{ manualErrs }} 处需手工处理，本次不会改动</span>
                  <button class="btn btn-sm" @click="fixPreviewOpen = false">取消</button>
                  <button class="btn btn-sm btn-primary" @click="applyFixes">确认修复 {{ fixables.length }} 处</button>
                </div>
              </div>
            </div>
          </Teleport>
          <!-- v219 打磨⑥：数量上限编辑（老板/管理员）。 -->
          <Teleport to="body">
            <div v-if="ruleEditOpen" class="fix-mask" @click.self="ruleEditOpen = false">
              <div class="fix-dlg rule-dlg">
                <div class="fix-hd">
                  <b><Icon name="settings"/> 数量录入上限</b>
                  <button class="imp-x" @click="ruleEditOpen = false"><Icon name="close"/></button>
                </div>
                <p class="fix-tip">
                  超过上限的数量会被标红、并在保存时被服务器拦下（用来挡「手滑多按一位」）。
                  这是<b>本租户</b>的设置：改完立即生效，Web 与小程序两个端同时变。
                </p>
                <div class="rule-body">
                  <label class="rule-label">单个客户 · 单项最大数量</label>
                  <!-- type="text" 而**不是** number：type=number 会静默加工输入（v214 判据） -->
                  <input v-model="ruleQtyMax" class="rule-input" type="text" inputmode="numeric" @keydown.enter="saveRuleEdit">
                  <span class="rule-hint">取值 1 ~ 999999999　·　当前生效 {{ qtyMax }}</span>
                </div>
                <div class="fix-ft">
                  <button class="btn btn-sm" @click="ruleEditOpen = false">取消</button>
                  <button class="btn btn-sm btn-primary" :disabled="ruleSaving" @click="saveRuleEdit">{{ ruleSaving ? '保存中…' : '保存' }}</button>
                </div>
              </div>
            </div>
          </Teleport>
          <div v-if="rebatePushOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="payment"/> 返利缺口提示</b><button class="imp-x" @click="rebatePushOpen=false"><Icon name="close"/></button></div>
            <div v-if="rebatePushLoading" class="hint">加载中…</div>
            <div v-else-if="!rebatePushList.length" class="hint">暂无未结冲档空间（均已达最高档或未配置合同）</div>
            <ul v-else class="push-list">
              <li v-for="p in rebatePushList" :key="p.supplier">供应商 <b>{{ p.supplier }}</b>：再采 ¥{{ fmt(p.gap) }} 冲下一档 <b>{{ p.pct }}%</b>，预计多拿返利 ¥{{ fmt(p.extra) }}</li>
            </ul>
          </div>
          <div v-if="healthOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="activity"/> 体检</b><span class="tag" :class="healthIssues.length ? 'warn' : 'ok'">{{ healthIssues.length }} 项</span><button class="imp-x" @click="healthOpen=false"><Icon name="close"/></button></div>
            <div v-if="!healthIssues.length" class="hint">未发现明显异常，可放心提交</div>
            <ul v-else class="health-list">
              <li v-for="(it, i) in healthIssues" :key="i" :class="'sev-'+it.sev" @click="jumpToRow(it.ri)"><span class="sev-dot"></span>{{ it.msg }}</li>
            </ul>
          </div>
          <div v-if="pagingOn" class="pager">
            <button class="btn btn-ghost btn-xs" :disabled="curPage<=0" @click="pageGo(-1)">← 上一页</button>
            <span class="pager-info">第 {{ curPage+1 }} / {{ totalPages }} 页 · 每页 {{ pageSize }} 行 · 共 {{ cross.rows.length }} SKU</span>
            <button class="btn btn-ghost btn-xs" :disabled="curPage>=totalPages-1" @click="pageGo(1)">下一页 →</button>
            <button class="btn btn-ghost btn-xs" @click="pagingOn=false" title="关闭分页，显示全部行">显示全部</button>
          </div>

          <!-- P8-1 下单说明文档 -->
          <div v-if="suggestBookOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="file-text"/> 下单说明文档</b><button class="imp-x" @click="suggestBookOpen=false"><Icon name="close"/></button></div>
            <textarea class="book-area" v-model="suggestBookText" rows="10"></textarea>
            <div class="imp-ft"><button class="btn btn-primary btn-sm" :disabled="pushing" @click="sendSuggestBook"><Icon name="upload"/> 推送企微审批</button><span class="hint">AI 据体检/货损/MOQ 自动生成，可手改</span></div>
          </div>

          <!-- P8-2 实时库存预警 -->
          <div v-if="rtWarnOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="bell"/> 实时库存预警</b><span class="tag warn">{{ Object.keys(rtWarnMap).length }} 项</span><button class="imp-x" @click="rtWarnOpen=false"><Icon name="close"/></button></div>
            <div v-if="rtWarnLoading" class="hint">加载中…</div>
            <ul v-else-if="Object.keys(rtWarnMap).length" class="push-list">
              <li v-for="(it,pid) in rtWarnMap" :key="pid"><b>{{ it.name }}</b>：{{ it.msg }}</li>
            </ul>
            <div v-else class="hint">实时库存无临期/缺货预警（含批次与到期校验）</div>
          </div>

          <!-- P8-3 预测准确率 -->
          <div v-if="accOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="target"/> 预测准确率</b><span class="tag" :class="accData&&accData.hit_rate!=null?'ok':'warn'">{{ accData? (accData.hit_rate!=null? accData.hit_rate+'%':'数据不足') : '…' }}</span><button class="imp-x" @click="accOpen=false"><Icon name="close"/></button></div>
            <div v-if="accLoading" class="hint">加载中…</div>
            <div v-else-if="accData">
              <div v-if="accData.note" class="imp-tip">{{ accData.note }}</div>
              <table v-if="accData.items && accData.items.length" class="tbl acc-tbl">
                <thead><tr><th>商品</th><th class="num">预报</th><th class="num">实际</th><th class="num">差异</th><th>命中</th></tr></thead>
                <tbody>
                  <tr v-for="(it,i) in accData.items.slice(0,30)" :key="i">
                    <td>{{ it.product }}</td><td class="num">{{ fmt(it.forecast) }}</td><td class="num">{{ fmt(it.actual) }}</td>
                    <td class="num" :class="it.diff>0?'up':(it.diff<0?'down':'')">{{ it.diff>0?'+':'' }}{{ fmt(it.diff) }}</td>
                    <td><Icon :name="it.hit ? 'check' : 'close'"/></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- P9-4 审批流状态机 -->
          <div v-if="subOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="approve"/> 审批流（状态机）</b><span class="tag" :class="'st-'+subStatus">{{ SUB_LABEL[subStatus] }}</span><button class="imp-x" @click="subOpen=false"><Icon name="close"/></button></div>
            <div class="sub-bar">
              <button class="btn btn-sm" :disabled="subStatus!=='draft'&&subStatus!=='revised'" @click="doSubmit">提交审批</button>
              <button class="btn btn-primary btn-sm" :disabled="subStatus!=='submitted'" @click="doApprove">通过</button>
              <button class="btn btn-sm" :disabled="subStatus!=='submitted'" @click="doReject">驳回</button>
              <button class="btn btn-sm" :disabled="subStatus!=='approved'&&subStatus!=='rejected'" @click="doRevise">退回修改</button>
              <button class="btn btn-sm" :disabled="subStatus!=='approved'" @click="doWriteback"><Icon name="link"/> 回写ERP</button>
            </div>
            <div v-if="subBy" class="hint">操作人 {{ subBy }} · {{ subAt }}</div>
            <div v-if="subReason" class="imp-warn">驳回原因：{{ subReason }}</div>
          </div>

          <!-- P10-7 配方行业模板库 -->
          <div v-if="tmplOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="book"/> 配方行业模板库</b><button class="imp-x" @click="tmplOpen=false"><Icon name="close"/></button></div>
            <div v-if="tmplLoading" class="hint">加载中…</div>
            <div v-else>
              <ul v-if="tmplList.length" class="push-list">
                <li v-for="(t,i) in tmplList" :key="i"><b>{{ t.name }}</b> <span class="tag">{{ t.industry||'通用' }}</span> <button class="btn btn-ghost btn-xs" @click="applyTemplate(t)">套用</button><div class="hint">{{ t.desc||'' }}</div></li>
              </ul>
              <div v-else class="hint">暂无模板，可把当前配方存为行业模板</div>
              <div class="tmpl-form">
                <input v-model="tmplName" class="input" placeholder="模板名（如 低温奶-酸奶线）">
                <input v-model="tmplIndustry" class="input" placeholder="行业/品类" style="width:120px">
                <input v-model="tmplDesc" class="input" placeholder="说明（可选）">
                <button class="btn btn-primary btn-xs" @click="saveTemplate">存为模板</button>
              </div>
            </div>
          </div>

          <!-- P10-8 经营看板 BI -->
          <div v-if="biOpen" class="info-panel bi-panel">
            <div class="panel-hd"><b><Icon name="bar-chart"/> 经营看板 BI</b><button class="imp-x" @click="biOpen=false"><Icon name="close"/></button></div>
            <div v-if="biLoading" class="hint">加载中…</div>
            <div v-else-if="biData" class="bi-grid">
              <div class="bi-card"><div class="bi-num">¥{{ fmt(biData.rebate_target||0) }}</div><div class="bi-lbl">返利目标（{{ biData.rebate_contracts||0 }} 合同）</div></div>
              <div class="bi-card"><div class="bi-num">¥{{ fmt(biData.payroll_latest||0) }}</div><div class="bi-lbl">最近工资合计</div></div>
              <div class="bi-card"><div class="bi-num warn">{{ biData.loss_risk_skus||0 }}</div><div class="bi-lbl">货损风险 SKU</div></div>
              <div class="bi-card"><div class="bi-num">{{ biData.forecast_amount!=null? '¥'+fmt(biData.forecast_amount):'—' }}</div><div class="bi-lbl">本期预报金额</div></div>
            </div>
          </div>

          <!-- P10-10 小程序端审批契约 -->
          <div v-if="miniOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="smartphone"/> 小程序审批契约</b><button class="imp-x" @click="miniOpen=false"><Icon name="close"/></button></div>
            <div class="imp-tip">老板可在 <b>forecast-order-miniprogram</b> 手机端批单。契约：小程序调 <code>GET /api/forecast/submission?period_id=</code> 取状态，调 <code>POST /api/forecast/submission</code> 执行 approve/reject（复用本页状态机）。本页「<Icon name="check"/> 审批」通过的操作，小程序实时可见。</div>
          </div>

          <!-- P11-1 数据缺口补录 -->
          <div v-if="gapOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="alert-triangle"/> 补录批次资料</b><span class="tag warn">{{ gapList.length }} 项缺批次/到期</span><button class="imp-x" @click="gapOpen=false"><Icon name="close"/></button></div>
            <div v-if="gapLoading" class="hint">加载中…</div>
            <ul v-else-if="gapList.length" class="push-list">
              <li v-for="g in gapList" :key="g.product_id">
                <b>{{ g.name }}</b> <span class="tag">{{ g.spec }}</span>
                <div class="gap-form">
                  <input class="input" v-model="g._batch" placeholder="批次号" style="width:110px">
                  <input class="input" v-model="g._expiry" placeholder="到期 2026-09-01" style="width:130px">
                  <button class="btn btn-primary btn-xs" :disabled="gapSavingId===g.product_id" @click="saveGap(g)">补录</button>
                  <span v-if="g.has_batch" class="tag ok">已有批次</span>
                  <span v-if="g.has_expiry" class="tag ok">已有到期</span>
                </div>
              </li>
            </ul>
            <div v-else class="hint">全部商品资料完整 （无缺口）</div>
          </div>

          <!-- P11-2 安全库存 AI 建议 -->
          <div v-if="safetyOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="shield"/> 安全库存建议</b><button class="imp-x" @click="safetyOpen=false"><Icon name="close"/></button></div>
            <div v-if="safetyLoading" class="hint">测算中…</div>
            <ul v-else-if="safetyItems.length" class="push-list">
              <li v-for="s in safetyItems" :key="s.product_id">
                <b>{{ s.name }}</b> 当前 {{ s.current }} ·
                <span v-if="s.suggested!=null">建议 <b class="up">{{ s.suggested }}</b></span>
                <span v-else class="tag">历史不足</span>
                <button v-if="s.suggested!=null" class="btn btn-ghost btn-xs" @click="applySafety(s)">采纳</button>
              </li>
            </ul>
            <div v-else class="hint">暂无可测算商品</div>
          </div>

          <!-- P11-3 多期滚动预报 -->
          <div v-if="rollingOn" class="info-panel">
            <div class="panel-hd"><b><Icon name="calendar"/> 多期滚动预报</b><span class="tag info">未来 {{ rollingN }} 期</span><button class="imp-x" @click="rollingOn=false"><Icon name="close"/></button></div>
            <div class="rolling-chips">
              <button v-for="p in rollingPeriods" :key="p.id" class="btn btn-ghost btn-xs" :class="{on: p.id===curPeriod}" @click="gotoPeriod(p.id)">{{ p.name }}</button>
            </div>
            <div class="hint">点击切换期次，网格随预报节奏联动（默认载入最新期）</div>
          </div>

          <!-- P12-4 偏差归因复盘 -->
          <div v-if="varOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="trending-down"/> 偏差归因复盘</b><span class="tag" :class="varData&&varData.hit_rate!=null?'ok':'warn'">{{ varData? (varData.hit_rate!=null? varData.hit_rate+'%':'数据不足'):'…' }}</span><button class="imp-x" @click="varOpen=false"><Icon name="close"/></button></div>
            <div v-if="varLoading" class="hint">加载中…</div>
            <div v-else-if="varData">
              <div v-if="varData.note" class="imp-tip">{{ varData.note }}</div>
              <div v-for="(items, cat) in varByCategory" :key="cat" class="var-cat">
                <div class="var-cat-hd">{{ cat }}（{{ items.length }} 项）</div>
                <table class="tbl acc-tbl">
                  <thead><tr><th>商品</th><th class="num">预报</th><th class="num">实际</th><th class="num">差异</th><th>归因</th></tr></thead>
                  <tbody>
                    <tr v-for="it in items.slice(0,20)" :key="it.product_id">
                      <td>{{ it.product }}</td><td class="num">{{ fmt(it.forecast) }}</td><td class="num">{{ fmt(it.actual) }}</td>
                      <td class="num" :class="it.diff>0?'up':(it.diff<0?'down':'')">{{ it.diff>0?'+':'' }}{{ fmt(it.diff) }}</td>
                      <td><select class="input" style="width:90px" :value="varAttrs[it.product_id]||''" @change="saveVarAttr(it.product_id, $event.target.value)"><option value="">—</option><option v-for="c in varCauses" :key="c" :value="c">{{ c }}</option></select></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- P12-5 自然语言改单 -->
          <div v-if="nlOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="message"/> 自然语言改单</b><button class="imp-x" @click="nlOpen=false"><Icon name="close"/></button></div>
            <div class="nl-row">
              <input class="input" v-model="nlText" placeholder="如：A产品减10箱，因为竞品促销" style="flex:1" @keydown.enter="runNlEdit">
              <button class="btn btn-primary btn-sm" :disabled="nlLoading" @click="runNlEdit">解析</button>
            </div>
            <ul v-if="nlResult.length" class="push-list">
              <li v-for="(e,i) in nlResult" :key="i"><b>#{{ e.product_id }}</b> {{ e.delta>=0?'+':'' }}{{ e.delta }} 箱<button class="btn btn-ghost btn-xs" @click="applyNlEdit(e)">应用到网格</button></li>
            </ul>
            <div v-else class="hint">支持「X产品增/减N箱，因为…」式指令</div>
          </div>

          <!-- P12-6 一键凑单达返利 -->
          <div v-if="topupOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="sparkle"/> 凑单达返利</b><button class="btn btn-primary btn-xs" :disabled="!topupPlan.length" @click="applyTopup">一键凑单</button><button class="imp-x" @click="topupOpen=false"><Icon name="close"/></button></div>
            <ul v-if="topupPlan.length" class="push-list">
              <li v-for="t in topupPlan" :key="t.name"><b>{{ t.name }}</b> 差 ¥{{ fmt(t.gap) }} → 建议 +{{ t.add }} 箱 @¥{{ fmt(t.price) }}</li>
            </ul>
            <div v-else class="hint">无可达返利阈值的凑单项（先点「返利缺口」算缺口）</div>
          </div>

          <!-- P12-7 what-if 配方模拟 -->
          <div v-if="cmp2Open" class="info-panel">
            <div class="panel-hd"><b><Icon name="wizard"/> what-if 配方模拟</b><button class="imp-x" @click="cmp2Open=false"><Icon name="close"/></button></div>
            <div class="nl-row">
              <select class="input" v-model="cmpA"><option value="">配方A…</option><option v-for="t in tmplList" :key="t.name" :value="t.name">{{ t.name }}</option></select>
              <select class="input" v-model="cmpB"><option value="">配方B…</option><option v-for="t in tmplList" :key="t.name" :value="t.name">{{ t.name }}</option></select>
            </div>
            <table v-if="cmpDiff && cmpDiff.rows.length" class="tbl acc-tbl">
              <thead><tr><th>参数</th><th>{{ cmpDiff.aName }}</th><th>{{ cmpDiff.bName }}</th></tr></thead>
              <tbody><tr v-for="d in cmpDiff.rows" :key="d.key"><td>{{ d.key }}</td><td>{{ JSON.stringify(d.a) }}</td><td>{{ JSON.stringify(d.b) }}</td></tr></tbody>
            </table>
            <div v-else-if="cmpDiff" class="hint">两配方参数完全一致</div>
            <div v-else class="hint">选两个行业模板对比参数差异（差异将体现在预警/建议结果上）</div>
          </div>

          <!-- P13-8 供应商 PO 聚合 -->
          <div v-if="poOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="package"/> 供应商订单聚合</b><button class="btn btn-primary btn-xs" :disabled="poLoading" @click="loadPo">聚合</button><button class="btn btn-ghost btn-xs" :disabled="!poData" @click="poWriteback"><Icon name="link"/> 回写ERP</button><button class="imp-x" @click="poOpen=false"><Icon name="close"/></button></div>
            <div v-if="poLoading" class="hint">聚合中…</div>
            <div v-else-if="poData">
              <div v-for="g in poData.pos" :key="g.brand" class="var-cat">
                <div class="var-cat-hd">{{ g.brand }}（{{ g.lines.length }} 项）</div>
                <ul class="push-list"><li v-for="l in g.lines" :key="l.product_id">{{ l.name }} · {{ fmt(l.qty) }} 箱</li></ul>
              </div>
              <div class="imp-tip">按品牌(≈供货方)聚合。真实供应商主档需在商品主档补全（本期未造供应商模块，符合不自研边界）。</div>
            </div>
            <div v-else class="hint">点「聚合」按当前网格生成采购单草稿</div>
          </div>

          <!-- P16-10 移动端预报录入（Web 侧闭环，复用 submitOrder） -->
          <div v-if="miniInputOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="smartphone"/> 小程序录单（Web 侧闭环）</b><button class="imp-x" @click="miniInputOpen=false"><Icon name="close"/></button></div>
            <div class="imp-tip">销售现场录单：选商品 + 数量，提交即写 <code>forecast_orders</code>，Web 端「<Icon name="check"/> 审批」实时可见。小程序工程另立（契约见交付文档）。</div>
            <div class="mini-form">
              <select v-model="miniPid" class="input"><option value="">选商品…</option><option v-for="r in cross.rows" :key="r.product_id" :value="r.product_id">{{ r.name }}</option></select>
              <input :value="miniQty" type="text" inputmode="numeric" class="input" placeholder="数量(箱)" style="width:90px" @input="numInput($event, setMiniQty)">
              <input v-model="miniUnit" class="input" placeholder="单位" title="自动带出该商品的报单默认单位（商品档案 → 包装单位）；可手改" style="width:64px">
              <input v-model="miniNote" class="input" placeholder="备注(选填)">
              <button class="btn btn-primary btn-sm" :disabled="miniSaving" @click="submitMini">提交录单</button>
            </div>
            <div v-if="miniMsg" class="mini-msg">{{ miniMsg }}</div>
          </div>

          <!-- P14-1/2 时间序列预测 + 置信区间 -->
          <div v-if="tsOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="sparkle"/> 销量预测（时间序列 + 置信区间）</b><button class="imp-x" @click="tsOpen=false"><Icon name="close"/></button></div>
            <div v-if="tsLoading" class="imp-tip">预测中…</div>
            <div v-else-if="!tsItems.length" class="imp-tip">无历史销量，暂无法预测（需先产生实际销售数据）</div>
            <template v-else>
              <table class="acc-tbl">
                <thead><tr><th>商品</th><th class="num">预测</th><th class="num">95%区间</th><th class="num">可信度</th><th>方法</th></tr></thead>
                <tbody>
                  <tr v-for="t in tsItems" :key="t.product_id">
                    <td>{{ t.name }}</td>
                    <td class="num">{{ t.predicted == null ? '—' : t.predicted }}</td>
                    <td class="num">{{ t.low != null ? (t.low + '~' + t.high) : '—' }}</td>
                    <td class="num">{{ t.confidence != null ? (t.confidence + '%') : '—' }}</td>
                    <td>{{ t.method }}</td>
                  </tr>
                </tbody>
              </table>
              <button class="btn btn-primary btn-sm" :disabled="tsApplied" @click="applyTs">{{ tsApplied ? '已应用' : '应用到网格' }}</button>
            </template>
          </div>

          <!-- P14-3 节假日/促销日历因子 -->
          <div v-if="calOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="calendar"/> 节假日/促销日历因子</b><button class="imp-x" @click="calOpen=false"><Icon name="close"/></button></div>
            <div class="imp-tip">为节令/促销设置销量放大因子，一键叠加到当前网格预报量。</div>
            <div class="mini-form">
              <select v-model="calFactors.selected" class="input"><option value="">选因子…</option><option v-for="p in calPresets" :key="p" :value="p">{{ p }}</option></select>
              <input :value="calFactors.factors[calFactors.selected]" type="text" inputmode="decimal" class="input" placeholder="倍数" style="width:70px" :disabled="!calFactors.selected" @input="numInput($event, calFactors.factors, calFactors.selected)" @focus="setCalFactor(calFactors.selected)">
              <button class="btn btn-primary btn-sm" @click="applyCal">应用因子</button>
              <button class="btn btn-ghost btn-sm" @click="saveCal">保存</button>
            </div>
            <div class="imp-tip">已设：<span v-for="(v,k) in calFactors.factors" :key="k" class="tag info">{{ k }} ×{{ v }}</span></div>
          </div>

          <!-- P14-4 滞销/临期反向预警 -->
          <div v-if="slowOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="trending-down"/> 滞销/临期反向预警（去库存）</b><button class="imp-x" @click="slowOpen=false"><Icon name="close"/></button></div>
            <div v-if="slowLoading" class="imp-tip">分析中…</div>
            <div v-else-if="!slowItems.length" class="imp-tip">未发现明显滞销/临期商品</div>
            <template v-else>
              <table class="acc-tbl">
                <thead><tr><th>商品</th><th class="num">90天销量</th><th class="num">库存</th><th class="num">临期天数</th><th>建议</th></tr></thead>
                <tbody>
                  <tr v-for="s in slowItems" :key="s.product_id">
                    <td>{{ s.name }}</td><td class="num">{{ s.sales_90d }}</td><td class="num">{{ s.inv_qty }}</td>
                    <td class="num">{{ s.expiry_days_left != null ? s.expiry_days_left : '—' }}</td>
                    <td>{{ s.suggestion }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>

          <!-- P15-5 采购单直发 -->
          <div v-if="po2Open" class="info-panel">
            <div class="panel-hd"><b><Icon name="receipt"/> 采购单直发</b><button class="imp-x" @click="po2Open=false"><Icon name="close"/></button></div>
            <div v-if="po2Loading" class="imp-tip">生成中…</div>
            <template v-else>
              <div v-if="po2Data" class="imp-tip">采购单 #{{ po2Data.id }} · 状态：{{ po2Data.status }} · {{ po2Data.total_lines }} 行</div>
              <table v-if="po2Data" class="acc-tbl">
                <thead><tr><th>品牌(供货方)</th><th>商品</th><th class="num">数量</th></tr></thead>
                <tbody>
                  <template v-for="g in po2Data.pos" :key="g.brand">
                    <tr v-for="l in g.lines" :key="l.product_id"><td>{{ g.brand }}</td><td>{{ l.name }}</td><td class="num">{{ l.qty }}</td></tr>
                  </template>
                </tbody>
              </table>
              <button class="btn btn-primary btn-sm" :disabled="!po2Data" @click="pushPo2">经连接器直推供应商</button>
            </template>
            <div v-if="po2List.length" class="imp-tip">历史采购单：<span v-for="o in po2List" :key="o.id" class="tag" :class="o.status==='pushed'?'ok':'info'">#{{ o.id }} {{ o.status }}</span></div>
          </div>

          <!-- P15-6 异常自愈闭环 -->
          <div v-if="healOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="settings"/> 异常修复闭环</b><button class="imp-x" @click="healOpen=false"><Icon name="close"/></button></div>
            <div v-if="healLoading" class="imp-tip">加载异常…</div>
            <div v-else-if="!healIssues.length" class="imp-tip">当前无待处理异常</div>
            <template v-else>
              <div v-for="it in healIssues" :key="it.id" class="heal-row" :class="it.severity">
                <div><b>{{ it.product }}</b> · <span class="sev-dot" :class="'sev-'+it.severity"></span>{{ it.issue }}</div>
                <div class="imp-tip">建议：{{ it.action }}</div>
                <div class="mini-form">
                  <span class="tag" :class="it.status==='resolved'?'ok':(it.status==='ack'?'info':'warn')">{{ it.status }}</span>
                  <button class="btn btn-ghost btn-xs" @click="setHeal(it.id,'ack')">已知悉</button>
                  <button class="btn btn-primary btn-xs" @click="setHeal(it.id,'resolved')">标记已处理</button>
                </div>
              </div>
            </template>
          </div>

          <!-- P15-7 Hermes 深度联动 -->
          <div v-if="hermesOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="sparkle"/> Hermes 深度联动（异常根因分析）</b><button class="imp-x" @click="hermesOpen=false"><Icon name="close"/></button></div>
            <textarea v-model="hermesCtx" class="book-area" placeholder="描述预报/库存/销售异常，例如：A商品连续3周预测偏高20%，B商品临期积压…"></textarea>
            <div class="mini-form">
              <button class="btn btn-primary btn-sm" :disabled="hermesLoading" @click="runHermes">{{ hermesLoading ? '分析中…' : '让 Hermes 分析' }}</button>
            </div>
            <div v-if="hermesResult" class="imp-tip" style="white-space:pre-wrap">{{ hermesResult }}</div>
          </div>

          <!-- 列统计弹层 -->
          <div v-if="statsOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="bar-chart"/> 列统计 · {{ colStats && colStats.label }}</b><button class="imp-x" @click="statsOpen=false"><Icon name="close"/></button></div>
            <div v-if="colStats" class="stats-body">
              <template v-if="colStats.numeric">
                <div class="stat-row"><span>合计</span><b>{{ statFmt(colStats.key, colStats.sum) }}</b></div>
                <div class="stat-row"><span>平均值</span><b>{{ statFmt(colStats.key, colStats.avg) }}</b></div>
                <div class="stat-row"><span>最大值</span><b>{{ statFmt(colStats.key, colStats.max) }}</b></div>
                <div class="stat-row"><span>最小值</span><b>{{ statFmt(colStats.key, colStats.min) }}</b></div>
                <div class="stat-row"><span>数值个数</span><b>{{ colStats.count }}</b></div>
                <div class="stat-row"><span>空值个数</span><b>{{ colStats.empty }}</b></div>
              </template>
              <template v-else>
                <div class="stat-row"><span>非空个数</span><b>{{ colStats.count }}</b></div>
                <div class="stat-row"><span>空值个数</span><b>{{ colStats.empty }}</b></div>
                <div class="stat-row"><span>不同值数</span><b>{{ colStats.distinct }}</b></div>
                <div class="stat-row stat-sample"><span>示例</span><b>{{ colStats.sample }}</b></div>
              </template>
            </div>
          </div>

          <!-- P16-9 数据健康分 -->
          <div v-if="hsOpen" class="info-panel">
            <div class="panel-hd"><b><Icon name="lightbulb"/> 健康分（每 SKU 评分）</b><button class="imp-x" @click="hsOpen=false"><Icon name="close"/></button></div>
            <div v-if="hsLoading" class="imp-tip">评分中…</div>
            <template v-else>
              <div class="imp-tip">平均健康分：<b>{{ hsAvg != null ? hsAvg : '—' }}</b>（网格中分&lt;60 的商品已标“健康分”图标）</div>
              <table class="acc-tbl">
                <thead><tr><th>商品</th><th class="num">健康分</th><th>缺失项</th></tr></thead>
                <tbody>
                  <tr v-for="h in hsItems" :key="h.product_id">
                    <td>{{ h.name }}</td>
                    <td class="num" :class="h.score<60?'sev-risk':(h.score<80?'sev-warn':'')">{{ h.score }}</td>
                    <td>{{ h.missing.join('、') || '完整' }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>

          <!-- 右键上下文菜单 -->
          <div v-if="ctx.show" class="ctx-overlay" @click="closeCtx" @contextmenu.prevent="closeCtx"></div>
          <div v-if="ctx.show" class="ctx-menu" :style="ctxMenuStyle" ref="ctxMenuEl">
            <button @click="ctxSelectAll" title="选中全部可编辑单元格（商品档案 + 各报单单元数量），之后可复制 / 清空 / 批量填充（或按 Ctrl+A）"><Icon name="check"/> 全选编辑区域</button>
            <div class="ctx-sep"></div>
            <button class="ctx-paste" @click="ctxPaste"><Icon name="paste"/> 粘贴</button>
            <button @click="ctxCopy"><Icon name="copy"/> 复制选区</button>
            <!-- v212（P2-3）：批量填同值 —— 功能（Ctrl+Enter）自 Q17 起就在，只是**没有可见入口**。
                 这里与表格底部的「选区统计」条各放一个：右键是 Excel 用户的肌肉记忆路径，
                 统计条是「刚框完一片」时眼睛正落着的地方。两条共用 state 与写入口。 -->
            <template v-if="ctxMode === 'fill' && selRange">
              <div class="ctx-ipt-row">
                <!-- ⚠️ `ctx-ipt-fill` 是刻意的**区分性类名**：同一个菜单里还有一个
                     `ctx-ipt`（超放量倍数阈值）。两者共用 `.ctx-ipt` 样式，
                     但在 DOM 层必须能分辨 —— 否则「Esc 退回菜单了吗」这类断言
                     会被阈值输入框误命中（v212 真机上就这么假绿过一次）。 -->
                <input ref="ctxFillInput" :value="ctxFillVal" class="ctx-ipt ctx-ipt-fill" type="text" inputmode="numeric" placeholder="填入选中区域的值…" @input="numInput($event, setFillVal)" @keyup.enter="applyCtxBatchFill" @keyup.esc="ctxMode = 'menu'">
                <span class="ctx-ipt-unit">{{ selCellCount }} 格</span>
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyCtxBatchFill">填入</button>
                <button @click="ctxMode = 'menu'">取消</button>
              </div>
            </template>
            <button v-else-if="ctxHasRangeSel" @click="openCtxFill"><Icon name="edit"/> 批量填入相同值…<kbd>Ctrl+Enter</kbd></button>
            <button @click="ctxAskAi"><Icon name="sparkle"/> 让 AI 分析这行</button>
            <button v-if="ctx.type !== 'body'" @click="ctxColStats"><Icon name="list"/> 此列统计</button>
            <button v-if="ctxNumCell" @click="ctxFillSafety"><Icon name="sparkle"/> 按安全库存补齐</button>
            <button v-if="ctx.type === 'master' && ctx.key === 'name'" @click="ctxViewProfile"><Icon name="list"/> 查看商品档案</button>
            <div class="ctx-sep"></div>
            <button @click="ctxInsertRow(true)">↑ 在上方插入行</button>
            <button @click="ctxInsertRow(false)">↓ 在下方插入行</button>
            <button v-if="ctx.type !== 'body'" @click="ctxFillDown">↓ 向下填充</button>
            <button v-if="ctx.type !== 'body'" @click="ctxFillRight">→ 向右填充</button>
            <button class="danger" @click="ctxDeleteRow"><Icon name="trash"/> 删除此行</button>
            <template v-if="ctx.type !== 'body'">
            <div class="ctx-sep"></div>
            <template v-if="ctx.type === 'qty'">
              <button @click="ctxInsertCol(true)">← 在左侧插入列</button>
              <button @click="ctxInsertCol(false)">→ 在右侧插入列</button>
              <button class="danger" @click="ctxDeleteCol"><Icon name="trash"/> 删除此列</button>
            </template>
            <template v-else-if="ctx.type === 'master' && ctx.deletable">
              <button class="danger" @click="ctxDeleteCol"><Icon name="trash"/> 删除此列</button>
            </template>
            <template v-else-if="ctx.type === 'master' && !ctx.deletable">
              <div class="ctx-note">该主档列不可删除（可经列配置隐藏）</div>
            </template>
            </template>
            <div class="ctx-sep"></div>
            <button @click="ctxClear"><Icon name="backspace"/> {{ ctxClearLabel }}<kbd v-if="ctxHasRangeSel">Delete</kbd></button>
            <button @click="ctxSetNote"><Icon name="edit"/> 本行加备注</button>
            <button @click="ctxCopyRow"><Icon name="copy"/> 复制此行到下方</button>
            <button @click="ctxCopyCsv"><Icon name="copy"/> 复制为 CSV</button>
            <button @click="ctxCopyMd"><Icon name="copy"/> 复制为 Markdown</button>
            <button @click="ctxExportSel"><Icon name="download"/> 导出选中行</button>
            <div class="ctx-sep"></div>
            <button :class="{ 'ctx-on': condWarnOn }" @click="toggleCondWarn"><span class="st-dot"></span><Icon v-if="condWarnOn" name="check"/> 高亮库存&lt;安全库存</button>
            <!-- v212（P2-2）：软警告（黄角标）的两个分档开关 + 倍数阈值。
                 与上一行 `.ctx-on` 的既有范式一致（点击即切换 + 打勾）。
                 ⚠️ 阈值做成输入框而不是常量：经销商口味不同（有人 3 倍就慌、有人 10 倍才算异常），
                    写死等于每个租户都得改代码。落 localStorage，随租户/浏览器生效。 -->
            <button :class="{ 'ctx-on': softWarnCfg.missOn }" @click="toggleSoftWarn('miss')"><Icon v-if="softWarnCfg.missOn" name="check"/> 疑漏订角标（上期有量 · 本期 0）</button>
            <button :class="{ 'ctx-on': softWarnCfg.overOn }" @click="toggleSoftWarn('over')"><Icon v-if="softWarnCfg.overOn" name="check"/> 疑超放量角标（≥ 上期几倍）</button>
            <div v-if="softWarnCfg.overOn" class="ctx-ipt-row">
              <span class="ctx-ipt-unit">超放量倍数</span>
              <input :value="softWarnCfg.overRatio" class="ctx-ipt" type="text" inputmode="numeric" style="width:76px" @input="numInput($event, softWarnCfg, 'overRatio'); saveSoftWarnCfg()">
              <span class="ctx-ipt-unit">倍</span>
            </div>
            <div class="ctx-sep"></div>
            <button :disabled="!canUndo" @click="undo"><Icon name="undo"/> 撤销</button>
            <button :disabled="!canRedo" @click="redo"><Icon name="redo"/> 重做</button>
            <!-- v219 打磨②：撤销栈可见 —— 一步步盲退不知道退到哪，点这里看改了哪些、直接退到某一步 -->
            <button :disabled="!undoStack.length" @click="undoPanelOpen = true" title="查看改动记录，可直接回退到某一步"><Icon name="history"/> 改动记录</button>
          </div>
          <div v-if="hdrCtx.show" class="ctx-overlay" @click="closeHdrCtx" @contextmenu.prevent="closeHdrCtx"></div>
          <div v-if="hdrCtx.show" class="ctx-menu" :style="hdrCtxStyle">
            <!-- 内联：重命名 -->
            <template v-if="hdrCtx.mode === 'rename'">
              <div class="ctx-ipt-row">
                <input ref="hdrRenameInput" v-model="hdrRenameVal" class="ctx-ipt" :placeholder="hdrCtx.type === 'qty' ? '客户/单元名称' : '列名称'" @keyup.enter="applyHdrRename" @keyup.esc="hdrCtx.mode='menu'">
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyHdrRename">确认</button>
                <button @click="hdrCtx.mode='menu'">取消</button>
              </div>
            </template>
            <!-- 内联：新增列 -->
            <template v-else-if="hdrCtx.mode === 'add'">
              <div class="ctx-ipt-row">
                <input ref="hdrAddInput" v-model="hdrAddName" class="ctx-ipt" placeholder="新列名称" @keyup.enter="applyHdrAdd" @keyup.esc="hdrCtx.mode='menu'">
                <select v-model="hdrAddType" class="ctx-sel">
                  <option value="text">文本</option>
                  <option value="num">数字</option>
                </select>
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyHdrAdd">确认</button>
                <button @click="hdrCtx.mode='menu'">取消</button>
              </div>
            </template>
            <!-- 主菜单 -->
            <template v-else-if="hdrCtx.mode === 'menu'">
              <template v-if="hdrCtx.type === 'master' || hdrCtx.type === 'qty'">
                <button v-if="hdrCtx.key !== 'name'" @click="startHdrRename"><Icon name="edit"/> 修改字段</button>
                <button @click="startHdrAdd"><Icon name="plus"/> 增加列</button>
                <button v-if="hdrCtx.key !== 'name' && (hdrCtx.type === 'qty' || canDeleteMaster(hdrCtx.key))" class="danger" @click="hdrDeleteCol"><Icon name="close"/> 删除列</button>
                <div v-if="hdrCtx.key !== 'name' && hdrCtx.type === 'master' && !canDeleteMaster(hdrCtx.key)" class="ctx-note">该主档列不可删除（可在列设置中隐藏）</div>
                <div class="ctx-sep"></div>
                <button @click="hdrColStats"><Icon name="list"/> 列统计</button>
                <button @click="startHdrFilter"><Icon name="filter"/> 筛选此列…</button>
                <button @click="startHdrUniq"><Icon name="filter"/> 按唯一值筛选…</button>
                <div class="ctx-sep"></div>
                <template v-if="hdrCtx.type === 'master' && groupableCol(hdrCtx.key)">
                  <button @click="hdrGroupBy"><Icon name="sort"/> 按此列分组小计</button>
                </template>
                <button @click="hdrCopyName"><Icon name="copy"/> 复制列名</button>
                <button @click="startHdrWidth"><Icon name="edit"/> 设置列宽…</button>
                <div v-if="groupBy !== 'none'" class="ctx-sep"></div>
                <button v-if="groupBy !== 'none'" @click="groupBy = 'none'"><Icon name="close"/> 取消分组</button>
                <div class="ctx-sep"></div>
                <button @click="sortByCol('asc')"><Icon name="chevron-down"/> 按此列升序</button>
                <button @click="sortByCol('desc')"><Icon name="chevron-down"/> 按此列降序</button>
                <template v-if="hdrCtx.type === 'master' && hdrCtx.key !== 'name'">
                  <div class="ctx-sep"></div>
                  <button @click="hdrHideCol"><Icon name="close"/> 隐藏此列</button>
                  <!-- v184：固定列不给「冻结此列」开关 —— 它本来就一直冻结，摆一个点了没有变化的
                       按钮就是假旋钮（用户会当成 bug）。改成一句状态说明。 -->
                  <button v-if="!FROZEN_COLS.includes(hdrCtx.key)" @click="hdrFreezeCol"><Icon name="cross"/> {{ frozenExtra === hdrCtx.key ? '取消冻结此列' : '冻结此列' }}</button>
                  <span v-else class="ctx-note">固定列（始终冻结，无需设置）</span>
                </template>
              </template>
              <template v-else>
                <button @click="hdrColStats"><Icon name="list"/> 列统计</button>
                <button @click="startHdrFilter"><Icon name="filter"/> 筛选此列…</button>
                <button @click="startHdrUniq"><Icon name="filter"/> 按唯一值筛选…</button>
                <button @click="hdrCopyName"><Icon name="copy"/> 复制列名</button>
                <button @click="startHdrWidth"><Icon name="edit"/> 设置列宽…</button>
                <div class="ctx-note">系统列，不支持字段编辑/增删</div>
              </template>
            </template>
            <!-- 内联：筛选 -->
            <template v-else-if="hdrCtx.mode === 'filter'">
              <div class="ctx-ipt-row">
                <input ref="hdrFilterInput" v-model="hdrFilterVal" class="ctx-ipt" :placeholder="'筛选「' + colLabel(hdrCtx.key, hdrCtx.type, hdrCtx.ui) + '」包含…'" @keyup.enter="applyHdrFilter" @keyup.esc="hdrCtx.mode='menu'">
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyHdrFilter">应用筛选</button>
                <button v-if="colFilter && colFilter.key === hdrCtx.key && colFilter.type === hdrCtx.type" @click="clearColFilter">清除</button>
                <button @click="hdrCtx.mode='menu'">取消</button>
              </div>
            </template>
            <!-- 内联：唯一值筛选 -->
            <template v-else-if="hdrCtx.mode === 'uniq'">
              <div class="ctx-uniq-hd">按唯一值筛选「{{ colLabel(hdrCtx._fk ? hdrCtx._fk.key : hdrCtx.key, hdrCtx._fk ? hdrCtx._fk.type : hdrCtx.type, hdrCtx._fk ? hdrCtx._fk.ui : hdrCtx.ui) }}」
                <label class="ctx-uniq-all"><input type="checkbox" :checked="uniqAll" @change="uniqAll = !uniqAll; hdrUniqChecked = uniqAll ? hdrUniqVals.slice() : []"> 全选</label>
              </div>
              <div class="ctx-uniq-list">
                <label v-for="v in hdrUniqVals" :key="v" class="ctx-uniq-item"><input type="checkbox" :checked="hdrUniqChecked.includes(v)" @change="toggleUniqVal(v)"> <span class="ctx-uniq-val">{{ v }}</span></label>
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyHdrUniq">应用筛选</button>
                <button v-if="colFilterSet" @click="clearUniqFilter">清除</button>
                <button @click="hdrCtx.mode='menu'">取消</button>
              </div>
            </template>
            <!-- 内联：精确列宽 -->
            <template v-else-if="hdrCtx.mode === 'width'">
              <div class="ctx-ipt-row">
                <input :value="hdrWidthVal" class="ctx-ipt" type="text" inputmode="numeric" style="width:90px" @input="numInput($event, setHdrWidth)" @keyup.enter="applyHdrWidth" @keyup.esc="hdrCtx.mode='menu'"> <span class="ctx-ipt-unit">px</span>
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyHdrWidth">应用</button>
                <button @click="hdrCtx.mode='menu'">取消</button>
              </div>
            </template>
          </div>
        </div>

        <div v-if="cross.rows.length && !editMode" class="pin">
          <!-- v189：原写「总订量 X 件」——X 是 Σ各报单单元数量（小单位，可能是盒/袋/包），
               「件」不对；且同屏没有箱口径，用户无法自证「合计(箱)=合计(小单位)÷规格」。
               两个数并列显示，规则错了一眼可见。 -->
          <span class="big">合计(小单位) <b>{{ fmt(cross.grand.qty) }}</b> · 合计(箱) <b>{{ fmtBox(cross.grand.boxes) }}</b><span v-if="boxMissingRows.length" class="box-miss">（缺规格 {{ boxMissingRows.length }} 行未计入）</span></span>
          <span class="mini">下单金额 <b>¥{{ fmt(cross.grand.amount) }}</b></span>
          <span class="mini">{{ cross.grand.sku }} 个商品 · {{ cross.reportedUnits }} 个报单单元</span>
        </div>
        <!-- Q12：进入编辑要拉全量商品主档，原实现期间白屏无反馈 -->
        <div v-if="editMode && loadingEdit" class="tbl-state tbl-skeleton" aria-busy="true" aria-label="编辑网格加载中">
          <div class="sk-row" v-for="n in 8" :key="n"><span class="sk-bar" v-for="m in 6" :key="m"></span></div>
        </div>
        <div v-if="editMode" class="edit-hint">
          <!-- v187：口径自证 —— 同屏有「分销价」主档列，若只写「金额」会被读成分销价×数量；
               本值实为 amountValue 累加 = 最终下单(箱) × 单价(进价/箱)，与「下单金额(进价)」列逐字同源。 -->
          <!-- v188：此处原写「合计 X 件」——但 editTotalQty 是 Σ各报单单元数量（小单位），
               不是「件」；规格 ≠1 时「件」是错的。随列名一并改为「合计(小单位)」并去掉单位字
               （小单位可能是盒/袋/包，统一写「件」反而误导；列名已自证）。 -->
          <div class="edit-summary">合计(小单位) <b>{{ fmt(editTotalQty) }}</b> · 合计(箱) <b>{{ fmtBox(editTotalBoxes) }}</b><span v-if="boxMissingRows.length" class="box-miss">（缺规格 {{ boxMissingRows.length }} 行未计入）</span> · 下单金额(进价) <b>¥{{ fmt(editTotalAmount) }}</b></div>
          <!-- Q14：如实写明恢复范围，不再笼统称「已恢复未完成数据」（原实现只恢复数量，用户被误导以为全保住了） -->
          <div v-if="draftRestored" class="draft-banner">
            <Icon name="alert-triangle"/> 已从本地草稿恢复：数量 <b>{{ (draftRestoreInfo && draftRestoreInfo.qty) || 0 }}</b> 行 ·
            商品资料改动 <b>{{ (draftRestoreInfo && draftRestoreInfo.master) || 0 }}</b> 行 ·
            本地新增 <b>{{ (draftRestoreInfo && draftRestoreInfo.added) || 0 }}</b> 行（共 {{ cross.rows.length }} 行），「保存」后自动清除；
            <button class="link-btn" @click="clearDraft()">放弃草稿</button>
          </div>
          <!-- Q26/Q27：保存失败分流提示 + 部分成功告知 + 重试入口 -->
          <div v-if="saveFailed" class="save-fail-banner">
            <b><Icon name="alert-triangle"/> 上次保存失败（{{ saveFailed.kind }}）</b>
            <span v-if="saveFailed.prodDone" class="sf-partial">商品资料已保存，数量未保存，请重试</span>
            <span class="sf-msg">{{ saveFailed.msg }}</span>
            <span class="sf-time">{{ saveFailed.at }}</span>
            <button class="btn btn-xs btn-primary" :disabled="noOpenPeriod"
                    :title="noOpenPeriod ? saveBlockedReason : '重新提交本次保存'" @click="saveEdits">重试保存</button>
          </div>
          <!-- Q28：P5-P7 做了大量能力但埋没，用户只会最笨的逐格手输 -->
          <div class="kbd-help">
            <button class="link-btn" @click="toggleKbdHelp">{{ kbdHelpOpen ? '收起快捷键' : '键盘快捷键' }} <Icon :name="kbdHelpOpen ? 'chevron-up' : 'chevron-down'"/></button>
            <div v-if="kbdHelpOpen" class="kbd-grid">
              <span><kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴（Excel 区块 / 客户交叉表）</span>
              <span><kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd> 复制 / 剪切选区</span>
              <span><kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> 撤销 / 重做</span>
              <span><kbd>Ctrl</kbd>+<kbd>D</kbd> 向下填充</span>
              <span><kbd>Ctrl</kbd>+<kbd>A</kbd> 全选 · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 选区批量填充</span>
              <span><kbd>Enter</kbd>/<kbd>Tab</kbd> 下一格（格内按左右键可移动光标改数）</span>
              <span><kbd>Home</kbd>/<kbd>End</kbd> 行首 / 行尾 · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> 翻页</span>
              <span><kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> 跳到本列连续数据首尾</span>
              <span><kbd>Delete</kbd> 清空选区 · 拖单元格右下角圆点填充</span>
              <span>右键：全选 / 复制 / 清空 / 插入删除行列 / 按安全库存补齐</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 商品搜索 + 草稿区 -->
    <div v-show="viewMode === 'list'" class="card draft-section">
      <div class="panel-hd"><b><Icon name="receipt"/> 报单草稿</b><span class="tag info">{{ draft.length }} 个商品</span>
        <span class="ph-actions">
          <button class="btn btn-sm btn-primary" :disabled="!draft.length || auditing" @click="runAudit">{{ auditing ? '审核中…' : '智能审核' }}</button>
          <!-- Q15：去掉无说明的 disabled，改为点击后引导 -->
          <button class="btn btn-sm btn-ghost" @click="saveDraft" :title="auditResults.length ? '保存草稿' : '请先点「智能审核」'">保存草稿</button>
          <!-- Q1：草稿 → 编辑网格 的单向同步入口 -->
          <button class="btn btn-sm btn-ghost" :disabled="!draft.length" @click="syncDraftToGrid" title="把草稿商品带入编辑网格，继续分配到各客户">带入编辑网格</button>
        </span>
      </div>

      <div class="search-row">
        <input v-model="searchQ" class="input" placeholder="搜索商品名称 / 条码（后 4 位也行）…" @input="onSearch">
        <button class="btn btn-ghost" @click="searchQ=''; searchResults=[]">清空</button>
      </div>

      <!-- 搜索结果下拉 -->
      <div v-if="searchResults.length" class="search-dropdown">
        <div v-for="p in searchResults" :key="p.id" class="sd-item">
          <div class="sd-main" @click="addToDraft(p)">
            <div class="sd-name">{{ p.name }} <span class="sd-spec">{{ p.spec || '' }}</span></div>
            <div class="sd-meta">库存 {{ p.current_stock ?? '—' }}{{ p.unit || '' }} · 日均 {{ p.avg_daily_sales ?? '—' }}{{ p.unit || '' }}/天<span v-if="p.barcode" class="sd-bc"> · 条码 {{ p.barcode }}</span></div>
          </div>
          <button class="btn btn-ghost btn-sm sd-alias" @click.stop="openAlias(p)" title="设置商品黑话别名（如：纯甄）"><Icon name="edit"/> 别名</button>
        </div>
      </div>

      <!-- 别名弹窗 -->
      <Teleport to="body">
        <Transition name="fade"><div v-if="aliasOpen" class="al-overlay" @click="aliasOpen = false"></div></Transition>
        <Transition name="pop">
          <div v-if="aliasOpen" class="al-modal">
            <div class="al-hd"><b>商品别名 · {{ aliasTarget?.name }}</b><button class="al-x" @click="aliasOpen = false"><Icon name="close"/></button></div>
            <div class="al-body">
              <p class="al-tip">业务员/客户常用简称（黑话），逗号分隔。员工在预报小程序搜"纯甄"就能找到它。</p>
              <textarea v-model="aliasForm" class="input al-input" rows="2" placeholder="如：纯甄,蒙牛纯甄,chunzhen"></textarea>
              <div v-if="aliasTarget?.alias" class="al-current">当前：{{ aliasTarget.alias }}</div>
            </div>
            <div class="al-ft">
              <button class="btn btn-ghost" @click="aliasOpen = false">取消</button>
              <button class="btn btn-primary" @click="saveAlias">保存</button>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 草稿表格 -->
      <div v-if="draft.length" class="table-wrap" style="margin-top:12px">
        <table class="tbl">
          <thead>
            <tr>
              <th>商品</th><th>规格</th><th>单位</th>
              <th class="num">预报数量</th>
              <th class="num">当前库存</th>
              <th class="num">日均销量</th>
              <th class="num">可销天数</th>
              <th class="num">建议下单量</th>
              <th>审核判定</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(d,i) in draft" :key="d.product_id">
              <td>{{ d.name }}</td>
              <td>{{ d.spec || '—' }}</td>
              <td>{{ d.unit || '—' }}</td>
              <td class="num"><input :value="d.requested_qty" class="qty-input" type="text" inputmode="numeric" @input="numInput($event, d, 'requested_qty')" @change="d.requested_qty = parseNumInput($event.target.value)"></td>
              <td class="num">{{ d.current_stock ?? '—' }}</td>
              <td class="num">{{ d.avg_daily_sales ?? '—' }}</td>
              <td class="num">
                <span v-if="d.days_of_cover != null" class="cover-days" :class="coverClass(d.days_of_cover)">{{ d.days_of_cover }} 天</span>
                <span v-else>—</span>
              </td>
              <td class="num">
                <span class="sug-cell">
                  <b v-if="d.suggested_qty != null" :class="suggestedClass(d)">{{ d.suggested_qty }}</b>
                  <span v-else>—</span>
                  <span v-if="d.suggested_qty != null && d.avg_daily_sales" class="why">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    <span class="why-tip">
                      <div class="why-formula">日均销 {{ d.avg_daily_sales }} 件 × 覆盖 {{ d.coverage_days }} 天</div>
                      <div class="why-formula">+ 安全库存 {{ d.safety_stock }} 件 = 需求 {{ d.required_stock }} 件</div>
                      <div class="why-formula">− 当前库存 {{ d.current_stock }} 件</div>
                      <div class="why-result">= 建议补货 {{ d.suggested_qty }} 件</div>
                    </span>
                  </span>
                </span>
              </td>
              <td><span v-if="d.verdict" class="tag" :class="verdictTag(d.verdict)">{{ d.verdict }}</span></td>
              <td><button class="btn-del" @click="draft.splice(i,1)"><Icon name="close"/></button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">
        <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg></div>
        <p>搜索商品并添加到草稿，然后点击「智能审核」</p>
      </div>
    </div>

    <!-- 返利冲刺看板已前置到本期预报顶部（view-seg 之前） -->

    <!-- 厂家返利汇总（v160：标题原「厂家返利达成」→「厂家返利」。本表数据来自 rebate_contracts
         + purchase_orders（目标额 / 已采额 / 达成率），是**合同采购进度**，不是「达成填报」里
         人工或 Hermes 回写的实际返利金额 —— 叫「实际返利」会指鹿为马，故只去掉与全站重名的
         「达成」二字，「达成率」列按指标名保留。 -->
    <div class="card rebate-section" style="margin-top:14px" v-if="rebateSummary.length">
      <div class="panel-hd"><b><Icon name="coins"/> 厂家返利</b><span class="tag info">{{ rebateSummary.length }} 个合同</span></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr><th>合同ID</th><th>供应商</th><th>年度</th><th class="num">目标额</th><th class="num">已采额</th><th class="num">达成率</th><th>返利比例</th><th>进度</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rebateSummary" :key="r.contract_id">
              <td>#{{ r.contract_id }}</td>
              <td>{{ r.contact_name || '供应商#' + r.contact_id }}</td>
              <td>{{ r.year }}</td>
              <td class="num">¥{{ fmt(r.target_amount) }}</td>
              <td class="num">¥{{ fmt(r.bought_amount) }}</td>
              <td class="num"><b :class="achClass(r.achievement)">{{ r.achievement != null ? Math.round(r.achievement * 100) + '%' : '—' }}</b></td>
              <td>{{ r.rebate_pct ? (r.rebate_pct * 100).toFixed(1) + '%' : '—' }}</td>
              <td style="min-width:100px">
                <div class="progress" :class="achProgressClass(r.achievement)">
                  <i :style="{width: Math.min(100, (r.achievement || 0) * 100) + '%'}"></i>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </template>

    <ForecastHistory v-if="activeTab === 'history'" :key="historyKey" @view="onViewHistory" @delete="onHistoryDelete" @close="onHistoryClose" @reopen="onHistoryReopen" @rename="openPeriodEdit" @copy="openPeriodCopy" />

    <!-- 报单配置（原档案管理独立页，整合为标签页） -->
    <div v-if="activeTab === 'config'" class="config-panel">
      <ReportMapping />
    </div>

    <!-- 删除期次确认弹窗（置于 root 模板内、始终渲染，确保 summary 与 history 两个入口都能唤起） -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="delOpen" class="imp-overlay" @click="delOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="delOpen" class="imp-modal del-modal">
          <div class="imp-hd"><b>删除期次</b><button class="imp-x" @click="delOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <p class="imp-tip warn-text">确认删除期次「{{ delTarget && delTarget.name }}」？该期次及其全部报单、订单、审核定稿、付款记录将一并删除，<b>且不可恢复</b>。</p>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="delOpen = false">取消</button>
              <button class="btn btn-danger" :disabled="deleting" @click="confirmDelete">{{ deleting ? '删除中…' : '确认删除' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v213-B1 并发编辑冲突（乐观锁 409）：
         为什么必须有这个对话框，而不是「保存失败」一句话 ——
         它要回答的是三个不同的问题，缺一个用户就无从下手：
           ① 发生了什么？  → 本期在你打开之后被别人改过（谁、什么时候，都写出来）
           ② 我的改动怎么了？→ **没保存**（不是系统坏了），屏幕上这一份还是你改的
           ③ 我该怎么做？  → 两个出口（重新载入看对方的 / 坚持用我这份覆盖），用户自己选
         ⚠️ 不自动替用户选：「覆盖」会抹掉别人的录入，「放弃」会丢掉用户自己的录入 ——
            两条都不可逆，必须问一次。默认焦点给「重新载入」（更安全的那个）。 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="conflictInfo" class="imp-overlay" @click="conflictInfo = null"></div></Transition>
      <Transition name="pop">
        <div v-if="conflictInfo" class="imp-modal del-modal">
          <div class="imp-hd"><b>本期数据已被别人修改</b><button class="imp-x" @click="conflictInfo = null"><Icon name="close"/></button></div>
          <div class="imp-body">
            <p class="imp-tip warn-text">
              你打开这张表之后，<b>{{ conflictInfo.by || '其他人' }}</b> 在
              <b>{{ conflictInfo.at || '刚才' }}</b> 也保存了本期数据，两边改的不是同一份。
              为避免把对方的改动直接盖掉，<b>这次保存没有执行</b> —— 你屏幕上改的内容还在。
            </p>
            <p class="imp-tip">
              选「重新载入最新数据」会看到对方存进去的内容，但<b>你这次未保存的改动会丢失</b>；
              选「用我这份覆盖」会把对方存进去的内容换成你屏幕上的这一份。
            </p>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="conflictInfo = null">先不处理</button>
              <button class="btn btn-ghost" :disabled="savingEdit" @click="conflictOverride">用我这份覆盖</button>
              <button class="btn btn-primary" :disabled="savingEdit || loadingEdit" autofocus @click="conflictReload">{{ loadingEdit ? '载入中…' : '重新载入最新数据' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 关闭期次确认弹窗（始终渲染，确保两入口可唤起） -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="closeOpen" class="imp-overlay" @click="closeOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="closeOpen" class="imp-modal del-modal">
          <div class="imp-hd"><b>关闭期次</b><button class="imp-x" @click="closeOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <!-- v219：原文案只说「不可再编辑」，**没说**关闭会连带关掉销售的报单通道 ——
                 那是这条操作最容易被忽略的副作用（定稿 = 停止收报单）。同时补上「可重开」，
                 否则「仅可删除」会让人以为关闭不可逆（2026-09-21 前确实不可逆，现在不是了）。 -->
            <p class="imp-tip warn-text">确认关闭期次「{{ closeTarget && closeTarget.name }}」？<b>关闭 = 定稿</b>：该期次不可再编辑，且<b>销售的小程序报单通道会同时关闭</b>（不再接收新报单）。如需改动，可到「往期预报」里点<b>「重开」</b>恢复。</p>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="closeOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="closing" @click="confirmClose">{{ closing ? '关闭中…' : '确认关闭' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v219 打磨②：改动记录（撤销栈可见）。一步步盲退不知道退到哪，这里列出改过什么、可直接退到某一步 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="undoPanelOpen" class="imp-overlay" @click="undoPanelOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="undoPanelOpen" class="imp-modal del-modal">
          <div class="imp-hd"><b>改动记录</b><button class="imp-x" @click="undoPanelOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <p class="imp-tip">共 <b>{{ undoStack.length }}</b> 步可撤销（新的在上）。点某一条 = 回退到这一步<b>之前</b>。</p>
            <div v-if="undoShown.length" class="undo-list">
              <button v-for="it in undoShown" :key="it.i" class="undo-item" @click="undoUpto(it.i)">
                <span class="undo-idx">{{ it.i + 1 }}</span>
                <span class="undo-label">{{ it.label }}</span>
              </button>
            </div>
            <p v-else class="imp-tip">还没有任何改动。</p>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="undoPanelOpen = false">关闭</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v180 改期次弹窗（仅 open 期次可改；入口在「历史期次」页每行 + 未来可复用）
         为什么需要它：期次此前没有「改名」路径，名字打错只能「关闭 → 删除」，
         而删除会级联清掉该期全部报单/明细/定稿/付款/订单。 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="peOpen" class="imp-overlay" @click="peOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="peOpen" class="imp-modal pe-modal">
          <div class="imp-hd"><b>修改期次</b><button class="imp-x" @click="peOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <p class="imp-tip">只提交你改动过的字段，没动的保持原样。<b>改动期次窗口会改变该期的达成 / 返利归属口径</b>，所以每一次改动都会记入修改日志。</p>
            <div class="pe-grid">
              <label>期次名称</label>
              <input v-model="pe.name" class="input" placeholder="如 8月25日报单-8月29日到货">
              <label>下单开始</label>
              <input v-model="pe.order_start" class="input" type="date" @input="markPeTouched('order_start')">
              <label>下单截止</label>
              <input v-model="pe.order_end" class="input" type="date" @input="markPeTouched('order_end')">
              <label>预计到货</label>
              <input v-model="pe.arrival" class="input" type="date" @input="markPeTouched('arrival')">
            </div>
            <ul v-if="peSoftWarn.length" class="np-warn">
              <li v-for="(w, i) in peSoftWarn" :key="i">{{ w }}</li>
            </ul>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="peOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="peSaving" @click="savePeriodEdit">{{ peSaving ? '保存中…' : '保存' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v184 复制期次弹窗（入口：往期预报列表每行的「复制」，源可以是**已关闭**期次）
         默认「整体顺延」不是随手给的默认值 —— 加单与定稿的归属键是
         (period_start, period_end) 日期窗口而非期次 id，沿用旧窗口会让两期共用同一份，
         且同屏不报任何错。名称与窗口一起后移，才谈得上「只改名称即可用」。 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="pcOpen" class="imp-overlay" @click="pcOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="pcOpen" class="imp-modal pe-modal pc-modal">
          <div class="imp-hd"><b>复制期次</b><button class="imp-x" @click="pcOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <p class="imp-own">
              复制自：<b>{{ pcSrc && pcSrc.name }}</b>
              <span class="tag" :class="pcSrc && pcSrc.status === 'open' ? 'ok' : 'info'">{{ pcSrc && pcSrc.status === 'open' ? '进行中' : '已关闭' }}</span>
            </p>
            <div class="pe-grid">
              <label>期次名称</label>
              <input ref="pcNameEl" v-model="pc.name" class="input" placeholder="如 9月22日报单-9月26日到货" @input="onPcNameInput">
              <label>下单开始</label>
              <input v-model="pc.order_start" class="input" type="date">
              <label>下单截止</label>
              <input v-model="pc.order_end" class="input" type="date">
              <label>预计到货</label>
              <input v-model="pc.arrival" class="input" type="date">
            </div>
            <div class="pc-shift">
              <span class="pc-shift-lab">整体顺延</span>
              <button v-for="d in PC_SHIFT_OPTS" :key="d" class="btn btn-sm"
                      :class="pcShiftDays === d ? 'btn-primary' : 'btn-ghost'"
                      @click="applyPcShift(d)">{{ d }} 天</button>
              <span class="pc-shift-tip">名称里的日期会一起改，改完只想微调就直接改日期框</span>
            </div>
            <p class="imp-own">
              将带过来：<b>{{ pcSrcCount == null ? '—' : pcSrcCount }} 个商品</b>
              （不含报单数量、加单、定稿 —— 加单与定稿按<b>日期区间</b>归属，跟过来会和源期串数据）
            </p>
            <ul v-if="pcSoftWarn.length" class="np-warn">
              <li v-for="(w, i) in pcSoftWarn" :key="i">{{ w }}</li>
            </ul>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="pcOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="pcSaving" @click="savePeriodCopy">{{ pcSaving ? '复制中…' : '创建并复制' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v215：商品名候选面板（替掉原生 datalist）。
         🔴 必须用 Teleport 到 body：表格在 `overflow` 容器里、还有 sticky 表头与冻结列，
            浮层留在 `<td>` 内会被裁掉或压住 —— 本项目反复踩过的层级/裁剪问题。
         🔴 候选项绑 `@mousedown.prevent` 而非 `@click`：click 之前先触发 input 的 blur，
            面板已经关了 ⇒ 点上去毫无反应（死按钮形态）。 -->
    <Teleport to="body">
      <div v-if="nameSug.open" class="name-sug-pop"
           :style="{ top: nameSug.top + 'px', left: nameSug.left + 'px', width: nameSug.w + 'px' }">
        <div v-for="(o, i) in nameSug.list" :key="o.v + '@' + i" class="ns-item"
             :class="{ on: i === nameSug.idx }"
             @mousedown.prevent="nameSugPick(o)"
             @mouseenter="nameSug.idx = i">
          <span class="ns-name">{{ o.v }}</span>
          <span v-if="o.l" class="ns-spec">{{ o.l.slice(o.v.length + 3) }}</span>
          <span v-if="o.c" class="ns-code" :title="'条码 ' + o.c">尾号 {{ o.c.slice(-4) }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import * as XLSX from 'xlsx'
import { store, toast } from '../store'
import { auth, api } from '../api/client.js'
import { forecastApi, auditApi, forecastApproveApi, importApi, productsApi, forecastRecipeApi, columnSchemeApi, forecastColumnsApi } from '../api/modules'
import Icon from '../components/Icon.vue'
import ImportMapping from '../components/ImportMapping.vue'
import GridZoomCtl from '../components/GridZoomCtl.vue'
import ForecastHistory from './ForecastHistory.vue'
import ReportMapping from './ReportMapping.vue'
/* v184b：到货周期文案的**唯一实现**移到 utils/arrival.js —— 「商品档案」页也要显示同一个值，
   两处各留一份函数就是第二份拷贝（静默漂移）。本文件只 import，不再定义。 */
import { arrivalCycleText } from '../utils/arrival.js'
import { pyInitials, PY_OK } from '../utils/pinyin.js'
// 角色词汇（规范角色名 + 历史视图令牌归一）—— 前端唯一来源，见文件顶部说明
import { normRole, roleName, isCanonicalRole, ROLE_VIEW_TOKEN_NAMES } from '../constants/roles'
/* v186：「规则在这个月适不适用」只有一处实现 —— useMonthlyAchv.ruleCoversMonth
   （与后端 domain/rebate_period.rule_covers_month 同源）。本文件原有一份本地
   ruleEffectiveInMonth（按生效期逐月裁剪），年度规则 12 个月分解齐全、生效期只写
   一个月时会把其余月份判掉 ⇒ 冲刺看板少行 / 目标柱不画。已删除，改用共享谓词。 */
import { ruleCoversMonth } from '../components/rebate/useMonthlyAchv.js'

const periods = ref([])
const curPeriod = ref(0)
// v180：**归属口径**独立于「当前查看的期次」。
//   curPeriod 会被期次下拉/往期「查看」改写（= 用户正在看哪期），
//   而导入数据的归属是**后端**定的（import_router: forecast_period_current()），
//   前端只能从 GET /periods 的 `current` 拿到，且**不可**随下拉漂移。曾把两者用同一个 ref
//   ⇒ 「归属不一致」提示恒不成立（死分支），且查看往期时会把归属显示成那一期。
const curOpenPeriodId = ref(0)
/* 🔴 v193（2026-09-18）：**进行中（status='open'）的那个期次**，没有则为 0。
   来源 = `GET /api/forecast/periods` 的 **`open`** 字段（= 后端 `forecast_period_current()`）。
   它与 `curOpenPeriodId`（= `current` 字段 = `forecast_period_default()`）**不是一回事，不可互换**：
     · `curOpenPeriodId` 是**展示/归属预告**口径 —— 期次全 closed 时它仍会兜底到一个期次
       （「最近有报单的」/「最新创建的（不限状态）」），它服务默认视图；
     · `openPeriodId`  只认真实进行中的期次 —— **导入的前置条件就是它**。
   据既定方案（`outputs/期次数据流程优化方案-2026-09-17/…§四.1`）：「不是『必须先建期次』，
   而是『必须有一个**进行中**的期次』」，理由② = 事故根因正是「7/8/9/10 期全 closed ⇒ 兜底把
   154 个商品挂到了**已关闭的 9 期**，用户根本看不到」。故闸门必须收窄到 open，否则形同虚设。 */
const openPeriodId = ref(0)
/* 🔴 v193：期次是否**已成功加载过**。
   为什么必须有这个标记，而不是直接判 `openPeriodId > 0`：
   `loadPeriods()` 的 catch 是**静默**的（失败只留注释，不报错）—— 接口抖动 / 401 时
   它停在初始值 **0**，而 0 恰好就是「没有进行中期次」的判据。
   ⇒ 少了这个标记，网络一抖就会把导入入口**锁死**，用户看到的是「功能没了」
   （正是本项目最忌讳的形态：静默失败伪装成能力缺失）。
   故「确实没有进行中期次」与「还没问到」必须严格区分：只有**成功加载过**才启用那道门。 */
const periodsLoaded = ref(false)
const viewPeriod = ref(null) // 往期预报「查看」回载的期次（真实或合成行）
const showNewPeriod = ref(false)
const np = ref({ name: '', order_start: '', order_end: '', arrival: '' })
const activeTab = ref('summary') // 'summary' | 'history' | 'config'

/* ---- P0-1 交叉表视图 ---- */
const viewMode = ref('cross')
/* v199：`hiddenUnits` = **本次要隐去的客户列名**（服务端 `forecast_hidden_units` 的待提交集合）。
   🔴 为什么放在 cross 里而不是单独的 ref：`snapshot()` 是 `clone(cross.value)` 全量深拷贝，
   放进 cross ⇒ **Ctrl+Z 撤销删列时集合自动跟着回退**；若另起一个 ref，用户撤销了删列、
   集合却还留着那个名字，一保存就把列隐掉了 —— 看起来像"撤销没用/系统自己删数据"。
   🔴 为什么用「显式记录删列动作」而不是「保存时算名册差集」：差集会把**改名**也算成删列
   （renameCol 后旧名从 units 消失），用户的意图只是改显示名、并不想动名册 ⇒ 差集方案会误伤。
   显式记录只认「用户真的点了删列」这一个动作，意图精确。
   🔴🔴 v199b（**v199 上线当天就被点崩，用户看到的是整页「页面出错了」**）：
   只要 `cross.value` 还会被**整体替换**，就绝不能假定某个字段一定在。`cross.value = {...}`
   全文有 **5 处**（loadEditGrid 两分支 / 删期次 / 查看态 / 快照恢复），v199 只补了其中一处
   ⇒ 走「有草稿」分支时 `hiddenUnits` 是 `undefined`，`delCol` 里那句 `.includes` 直接抛
   TypeError，被 ErrorBoundary 兜成整页「页面出错了」。同理 `units`：删期次那条路径把 cross
   换成只含 `rows` 的对象，而 `C_EXTRA_INPUT` 在模板里被读、v197 加的 watch 在赋值瞬间即求值
   ⇒ 读 `undefined.length` 同样崩。
   ⇒ 治本两条：① 形状只有**一个**来源（`blankCross()`，别再手写对象字面量）；
              ② 这两类字段的读写一律走 `hiddenUnits()` / `unitCount()` accessor ——
                 替换点再多、将来再加一处，也不会崩页面。 */
function blankCross() {
  return { period: null, units: [], rows: [], colTotals: [], grand: { sku: 0, qty: 0, amount: 0 }, reportedUnits: 0, hiddenUnits: [] }
}
const cross = ref(blankCross())
/* v199b：`hiddenUnits` 的**唯一**读写入口（见上方注释）。读时兜底初始化 ⇒ 无论 cross 被谁
   整体替换过，拿到的都是真数组；最坏也只是「本次没记上」，不会崩页面。 */
function hiddenUnits() {
  if (!Array.isArray(cross.value.hiddenUnits)) cross.value.hiddenUnits = []
  return cross.value.hiddenUnits
}
/* v199b：客户列数的**唯一**读法。`cross.value.units` 同理可能缺失（删期次那条路径就是把
   cross 换成只含 rows 的对象），而它在模板（`C_EXTRA_INPUT`）与 watch 源里都会被立即求值
   ⇒ 读 `undefined.length` 会当场把整页兜成「页面出错了」。
   🔴 2026-09-19 二次修：v199b 的首版把兜底写成了 `? unitCount() : 0` —— **自递归、没有出口**，
   一进预报页就 `RangeError: Maximum call stack size exceeded`，同样被兜成整页「页面出错了」。
   实测生产 `Forecast-*` chunk 里就是 `function X(){return Array.isArray(f.value.units)?X():0}`
   （浏览器栈里 8 层自调用）。本意是「返回客户列个数」⇒ 取 `.length`。
   ⚠️ 教训：给 accessor 写兜底时，兜底分支**绝不能回落到 accessor 自己** ——
      症状与它要防的那个（读 undefined.length）在界面上**长得一模一样**，只会更难查。 */
function unitCount() {
  return Array.isArray(cross.value.units) ? cross.value.units.length : 0
}
// B1 修复 (2026-07-24)：默认只读模式——进入页面先看汇总表，需编辑再点「编辑」
// （原默认 true 直接进入编辑网格，改数量/粘贴/删除等编辑能力对非录入员暴露过早）
const editMode = ref(false)
/* v211（P1-1）：商品名称**补全候选**（数据源 = 全量商品主档，赋值点在 loadCross 两处）。
   v215：**替掉原生 datalist**，改自建候选面板 —— 因为 datalist 的过滤逻辑由浏览器决定，
      各家不一致、也**无法**支持「条码后四位 / 拼音首字母」这两种检索（它只按 value 匹配）。
   🔴 为什么做成「全局一份」而不是「每行一份」：主档约 428 条，按行算就是 428 × 158 ≈ 6.8 万个
      节点 —— 候选与「哪一行」无关，它回答的是「这个名字在档案里应该怎么写」，那是**全局**问题。
   字段：v=名称（填入值）· l=下拉里显示的辅助文字（名称 · 规格）· c=条码 · y=拼音首字母串。
   ⚠️ 拼音串在 `buildNameOptions` 里**一次性算好**（`attachPy`），不在输入时逐字算 ——
      428 条 × 每次按键，光标会卡。 */
const masterNameOptions = ref([])
function buildNameOptions(list) {
  const out = (list || []).map((p) => {
    const name = String(p.name || '')
    const spec = String(p.spec || '').trim()
    return {
      id: String(p.id == null ? '' : p.id),
      v: name,
      l: spec ? name + ' · ' + spec : '',
      c: String(p.barcode || ''),
      y: pyInitials(name),
    }
  }).filter((o) => o.v)
  return out
}
/* pid → 拼音首字母串。给**网格搜索框**用（`rowMatchText`），保证与候选面板同口径。
   ⚠️ 做成 computed 而不是第二份数组：拼音只该有一个来源，重复构建迟早会漂移。 */
const pyMap = computed(() => {
  const m = {}
  for (const o of masterNameOptions.value) if (o.id && o.y) m[o.id] = o.y
  return m
})

/* ---- v215：商品名候选面板 ----
   🔴 原生 datalist 的三个硬伤（这就是要自建的理由）：
      ① 过滤逻辑由浏览器定：Chrome 是「子串 + 模糊」，Safari 早期只认**前缀** ⇒ 同一份数据两种体验；
      ② 只按 `value` 匹配 ⇒ **条码后四位 / 拼音首字母**根本无从表达；
      ③ 无法控制外观与键盘行为（上下键选中项的值在多数浏览器里**读不到**）。
   ⚠️ 定位用 `position:fixed` + Teleport 到 body：表格里有 `overflow` 容器和 sticky 表头，
      浮层留在 `<td>` 里会被**裁掉**（这是本项目反复踩过的层级/裁剪问题，见 zindex 诊断技能）。
   ⚠️ 候选项用 `@mousedown.prevent` 而不是 `@click`：click 之前会先触发 input 的 blur，
      面板已关闭 ⇒ 点了没反应（经典的「死按钮」形态）。 */
const nameSug = ref({ open: false, ri: -1, ci: -1, idx: 0, list: [], top: 0, left: 0, w: 0 })
function nameSugList(q) {
  const f = String(q || '').trim().toLowerCase()
  if (!f) return []
  const pool = masterNameOptions.value
  const hit = []
  for (const o of pool) {
    if (matchMasterOne(o, f)) hit.push(o)
    if (hit.length >= 40) break      // 面板最多 40 条 —— 再多既看不过来也拖慢渲染
  }
  return hit
}
/* 单个候选的匹配口径。**必须与 `rowMatchText` 同源**（名称 / 厂家编码 / 条码后 4 位 / 拼音首字母），
   否则会出现「在筛选框里搜得到、在商品名格里搜不到」这种同屏两套答案。 */
function matchMasterOne(o, f) {
  if (!f) return true
  const name = String(o.v || '').toLowerCase()
  if (name.includes(f)) return true                      // 名称子串（含汉字直接搜）
  if (String(o.code || '').toLowerCase().includes(f)) return true   // 厂家编码
  const bc = String(o.c || '').toLowerCase()
  if (bc && (bc.includes(f) || (f.length >= 3 && bc.endsWith(f)))) return true  // 条码 / 后 4 位
  if (o.y && o.y.toLowerCase().includes(f.toUpperCase().toLowerCase())) return true  // 拼音首字母
  return false
}
function onNameInput(r, ri, ci, e) {
  const el = e && e.target
  const q = el ? el.value : ''
  const rect = el ? el.getBoundingClientRect() : null
  const list = nameSugList(q)
  if (!list.length || !rect) { nameSug.value.open = false; return }
  nameSug.value = {
    open: true, ri, ci, idx: 0, list,
    left: rect.left, w: Math.max(rect.width, 260),
    // 面板放不下就往上翻（贴底时往下会超出视口 ⇒ 用户看不到，等于没弹）
    top: (rect.bottom + 226 < window.innerHeight) ? rect.bottom + 2 : Math.max(8, rect.top - 226),
  }
}
/* 🔴 必须**手动** stopPropagation，且**只在面板打开时**：
      input 在 `<table @keydown="onGridKey">` 内，方向键会冒泡上去被表格当成「跳格」
      ⇒ 焦点在 keydown 阶段就被搬走、面板随即 blur 关闭（真机实测：↓ 后高亮消失、
      回车写入静默失效——看起来像「键盘没反应」，属于死控件那一类）。
      1017 行注释里记的是同一个坑的**回车版**（`focusCell()` 抢焦点导致 @keyup.enter 收不到）。
   ⚠️ 不能写成模板上的 `@keydown.stop`：那样**面板没开时**也拦，方向键跳格就被破坏了。
      所以放在函数里按 `s.open` 条件拦 —— 「只在我要用这几个键的时候才拦」。 */
function nameSugKey(e) {
  const s = nameSug.value
  if (!s.open) return
  e.stopPropagation()
  if (e.key === 'ArrowDown') { s.idx = (s.idx + 1) % s.list.length; e.preventDefault() }
  else if (e.key === 'ArrowUp') { s.idx = (s.idx - 1 + s.list.length) % s.list.length; e.preventDefault() }
  else if (e.key === 'Enter') { nameSugPick(s.list[s.idx]); e.preventDefault() }
  else if (e.key === 'Escape') { s.open = false; e.preventDefault() }
}
function nameSugPick(o) {
  const s = nameSug.value
  if (!o) return
  const r = cross.value.rows[s.ri]
  if (r) {
    r.name = o.v
    onCellChange()          // 🔴 必须：不调它，改名不进撤销栈、也不点亮状态条（v211 修过的老缺陷）
  }
  s.open = false
}
function nameSugClose() { nameSug.value.open = false }
/* 占位文案**按能力给**：环境不支持拼音序时**不提拼音** —— 提了等于承诺一个搜不到的功能。
   （`PY_OK` 由 `utils/pinyin.js` 在加载时用 4 个已知字自检得出，见该文件顶部说明。） */
const namePh = computed(() => (PY_OK ? '商品名称 / 条码后 4 位 / 拼音首字母' : '商品名称 / 条码后 4 位'))

/* ---- 表体优化（P1/P2/P3）：分组/热力图/排序/筛选/风险徽标 ---- */
const prodMeta = ref({})            // pid -> {category, brand}，loadCross 填充
const groupBy = ref('none')         // none | category | brand
const openGroups = ref({})          // 分组折叠状态 key -> true(展开)
const sortKey = ref('none')         // none | name | qty | amount
const sortDir = ref('desc')
const hideZeroReport = ref(false)   // 仅显示有报单（填报数量>0）的商品行
/* v179（2026-09-16）：行底范围开关。
   用户原话：「我需要实现的是模版里有多少产品，导入后就只有那么多产品」——
     他拿预报导入模版**批量建商品档案**（数量由业务员从小程序报），导完 159 行商品后
     主表却铺出 275 行全量在售档案且全是 0，他无法确认「我这 159 个到底进来没有」。
   默认（不勾）= 行底只保留「本期导入登记的商品 ∪ 有报单的商品」；
   勾上 = 回到旧行为（全量在售商品档案），供「翻全量清单挑一个来补报」的场景。
   ⚠️ 与 `hideZeroReport` 是两层不同的东西：那个过滤**已有行**，这个换**行底来源**。 */
const showAllProducts = ref(false)
// v247：查看态默认**收起整列全空的列**（历史期次列 / 档案未填列），勾上才铺开。
// 背景：期次一多，十几列全空的列把「合计(小单位)」挤出视口，有用的信息要横向滚才看得到。
const showEmptyCols = ref(false)
const zeroReportCount = computed(() => cross.value.rows.filter(r => rowSum(r) <= 0).length)
// 行底被收窄时隐藏了多少行 —— 数字必须由**同一份 rows** 现算，不另存计数
// （旧铁律：同屏数字口径必须同源；人工维护的计数必然漂移）。
// 🔴 2026-09-16 口径修正：文案说的是「**在售**商品未显示」，所以被减数只能是**来自在售档案的行**
//   （offArchive === false，由 buildRowBase 显式打标），**不能**用 rows.length ——
//   rows 里还混着两类不属于「在售档案」的行：① 不在在售档案但被本期引用的（实测 5 个：
//   3 个已停用的导入商品 + 2 个已停用的报单商品）② 用户手工补录的新行（offArchive 为 undefined）。
//   用 rows.length 会把它们当成在售商品减掉 → 实测少报 5 个（显示 127，真值 132）。
const hiddenByRowBase = computed(() => {
  const base = cross.value.rowBaseTotal || 0
  const fromArchive = (cross.value.rows || []).filter(r => r.offArchive === false).length
  return Math.max(0, base - fromArchive)
})
/* v179：把「本期引用的商品」归一成与 products/grid 行同形的商品行。
   🔴 为什么必须有这一步：`products/grid` 只返回**在售**商品（实测 285），而本期导入登记与
   报单里都可能出现**已停用**的商品 —— 实测用户真实文件：154 个导入商品里 3 个已停用，
   另有 2 个有报单的商品也已停用。行底若只从 grid 里筛，这 5 个会被**静默丢掉**，
   用户会以为「我导的商品没进来」（正是本轮要修的那个症状）。 */
function asProdRow(src) {
  return {
    id: Number(src.id != null ? src.id : src.product_id) || 0,
    name: src.name || src.product_name || '',
    spec: src.spec || '', unit: src.unit || '件',
    barcode: src.barcode || '', product_code: src.product_code || '',
    dist_price: src.dist_price || 0, sale_price: src.sale_price || 0,
    purchase_price: src.purchase_price || 0,
    /* 🔴 v226b：本函数是**显式白名单**（见下方 v184 注释）—— 漏列即等于该字段在此路径上不存在。
       `factory_price`（元/箱 进价）此前缺失 ⇒ 凡是走本函数进来的行（已停用/已删除但被本期引用、
       以及 summary 的 imported_products）在本页**金额恒缺价**，而库里明明是有的。 */
    factory_price: Number(src.factory_price) || 0,
    safety_stock: src.safety_stock || 0, expiry_days: src.expiry_days || 0,
    category: src.category || '', brand: src.brand || '',
    /* v184：到货周期 —— 本函数搬的是**一份显式白名单**，不在这里列出的字段到此为止。
       ⚠️ 而「不在在售档案」的行（已停用/已删除但被本期引用）**不经过 products/grid**，
          它们只从 summary 的 imported_products / rows 里来 ⇒ 漏了这一行，这些行的
          「到货周期」列恒显示「—」，而库里与导入结果明明是 +3天。
          真机实测已复现：沙箱 tenant_9999 的 pid 1160（已停用，本期登记）DB=3 而页面显示「—」。
          对应的后端下发在 erp_db.py::forecast_submission_summary 的 imported_products 查询。 */
    arrival_lead_days: Number(src.arrival_lead_days) || 0,
    /* v222：三级单位换算（`perCase` 的唯一权威数据源）。两处来源不同，务必分清：
       ① **在售档案行不走本函数** —— `buildRowBase` 的 keep 直接用 `products/grid` 的原对象，
          换算字段由 `routers/data.py::products_grid` 下发；
       ② 本函数只处理「**不在在售档案**」的行（已停用/已删除，靠 summary 的 imported_products/rows）——
          后端那两条查询当前**未下发**换算字段 ⇒ 这里恒为 0/空，`perCase` 回退规格解析（与改动前一致）。
       仍然列在这里：将来后端一旦下发，不会又被这份**显式白名单**吃掉。
       （这份清单就是当年 `arrival_lead_days` 被吃掉、导致停用商品到货周期恒显示「—」的同一个坑。） */
    large_unit: src.large_unit || '', large_ratio: Number(src.large_ratio) || 0,
    medium_unit: src.medium_unit || '', medium_ratio: Number(src.medium_ratio) || 0,
    /* v240：报单默认单位（`products.order_unit`）—— 与上面换算字段同一条「显式白名单」纪律，
       漏列就等于该字段在此路径上不存在 ⇒ 已停用商品的录单单位带不出来（静默回退）。 */
    order_unit: src.order_unit || '',
    extra: src.extra || {},
    offArchive: true,   // 不在「在售档案」里（已停用/已删除）—— 表格据此打「已停用」角标
  }
}
/* v202：**行底原始顺序**（product_id 序列）。
   用途只有一个：`applySort()` 切回「默认（不排序）」时按它恢复 —— 那个分支此前**什么都不做**
   （只处理 asc/desc），于是「按名称升序 → 再切回默认」后顺序停在按名称的结果上，
   回不到导入模板序（用户会认为「排序旋钮坏了」）。
   ⚠️ 存 product_id 而不是行对象引用：行底每次加载都会重建，存引用会指向上一次加载的过期对象。 */
const rowBaseOrder = ref([])
/* v179：行底 = 「在售档案中被本期引用到的」∪「不在在售档案但被本期引用到的」。
   `importedProducts` = summary 的 imported_products（登记台账，含停用商品）；
   `reportRows` = summary 的 rows（本期有报单的商品，同样可能已停用）。
   两路都**来自后端**，前端不自己猜哪些算「本期导入」。 */
function buildRowBase(allProds, importedProducts, reportRows, showAll) {
  const byId = {}
  /* v202：pid -> **导入顺序键**，行底顺序的唯一权威来源。三档（tier 越小越靠前）：
       tier 0 —— 有 `sort_no`：后端登记台账的模板行序（= 批次基准 + 模板行号）⇒ **模板序**
       tier 1 —— 无 `sort_no` 但在 `importedProducts` 里：**存量期次**（v202 之前导入的行，
                迁移补列时一律为 0）或迁移未跑到的库。用**数组下标**作次序 ——
                因为后端那条 SQL 已经按 `(sort_no 是否>0, sort_no, r.id)` 排好，下标即
                「**登记插入序**」。实测 tenant_1：期次 9 与期次 13 的登记序 **154 行逐行相同**
                （同一模板导两次），而它与 `products.id DESC` 恰是反的 ⇒ 登记序就是模板序。
       tier 2 —— 不在 `importedProducts` 里（小程序报单 / 手工新增 / 已删登记）：排在最后。
     🔴 **为什么不做「把存量行 sort_no 按 id 序回填」**：那是对生产库的一次批量数据改写，
        而同样效果在这里用**读端兜底**就能拿到 —— 零数据写入、零回滚风险、对老库同样生效。
        判据：**能用读端口径解决的，就不要动存量数据。** */
  const impOrder = {}
  ;(importedProducts || []).forEach((p, i) => {
    const pid = Number(p.id)
    byId[pid] = byId[pid] || p
    if (pid in impOrder) return
    const sn = Number(p.sort_no) || 0
    impOrder[pid] = sn > 0 ? { t: 0, k: sn } : { t: 1, k: i }
  })
  const reportById = {}
  ;(reportRows || []).forEach(r => { if (r && r.product_id) reportById[Number(r.product_id)] = r })
  const refIds = new Set([...Object.keys(byId).map(Number), ...Object.keys(reportById).map(Number)])
  const gridIds = new Set(allProds.map(p => Number(p.id)))
  const off = []
  refIds.forEach(pid => {
    if (!pid || gridIds.has(pid)) return
    off.push(asProdRow(byId[pid] || reportById[pid] || { id: pid }))
  })
  const keep = showAll ? allProds : allProds.filter(p => refIds.has(Number(p.id)))
  // v179：给「确实来自在售档案」的行显式打 offArchive=false —— hiddenByRowBase 靠这个标记把
  //   「在售档案行」与「档案外的行（true）／用户手工补录行（undefined）」区分开，
  //   否则「另有 N 个在售商品未显示」会多减掉档案外的行（实测少报 5）。
  //   ⚠️ allProds 在本函数之后不再被复用（两处调用点均已核对），就地打标无副作用。
  keep.forEach(p => { p.offArchive = false })
  /* v202（2026-09-19）**按导入模板行序排列** —— 用户诉求原话：
     「预报订单模板导入后，系统中显示的商品名称排序与导入模板中的商品名称排序不一致。
       请调整系统逻辑，使导入后系统中的商品名称排列顺序与导入模板中的商品名称顺序
       完全保持一致，不受其他排序规则影响。」
     🔴 为什么必须在**这里**排（这是本 bug 的根因所在）：行底两个来源各自带一套
        与模板无关的顺序，而 `keep` 的顺序直接决定表格行序（`rowBase.map` 逐行映射）——
        · `allProds` 来自 `/api/products/grid`，是 `ORDER BY id DESC`
          （routers/data.py::products_grid → product_list 的排序）⇒ 顺序 = **建档顺序倒排**。
          模板最后一行若是新商品，它反而顶到最前。**实测 tenant_1 期次 9**：模板首行
          「红桶（福宝下单）」(pid 1475) 沉到末尾，页面首行成了「简爱酸奶吸吸乐…」(pid 1608)。
        · `off` 来自 `refIds` 这个 Set 的插入顺序（= byId 的键序），同样与模板无关。
        ⇒ 前端 `sortedRows` 默认 `sortKey='none'` 原样透传，所以页面**逐行**复现了上面那个错序。
     排序规则（`Array.prototype.sort` 在现代 JS 引擎是**稳定**的）：
        ① 两侧都有顺序键 → 先比 tier（0 在 1 前）、再比次序 k
        ② 只有一侧有 → 有键的在前
        ③ 两侧都没有 → 返回 0，保持原有相对顺序
     为什么「不在登记台账里」的排后面而不是按 id 插进去：它们**不属于这份模板**
        （小程序报单 / 手工新增），插进模板行之间会把「模板顺序」切碎，用户看到的仍是不一致。 */
  const out = keep.concat(off)
  const rank = p => impOrder[Number(p.id)] || null
  out.sort((a, b) => {
    const ao = rank(a), bo = rank(b)
    if (ao && bo) return (ao.t - bo.t) || (ao.k - bo.k)
    if (ao) return -1
    if (bo) return 1
    return 0
  })
  return out
}
/* v179：勾选「显示全部商品」必须**立刻**换行底 —— 否则它就是个假旋钮：
   行底只在 loadCross（查看态）/ loadEditGrid（编辑态）里构建，只改 ref 的话
   勾选框会选中、表格纹丝不动（真机实测：勾上前 158 行、勾上后仍是 158 行）。
   查看态直接重载交叉表（纯读）；编辑态先落草稿再重载，保证未提交的改动不丢。 */
watch(showAllProducts, () => {
  if (editMode.value) { saveDraftNow(); loadEditGrid() } else loadCross()
})
// 统一行匹配：商品名 / 厂家编码 / 条码（含后 4 位末尾片段）
// 口径与小程序商品搜索、后端 _build_product_search 保持一致：数字输入优先命中条码，>=3 位再放宽到末尾匹配
function rowMatchText(r, f) {
  if (!f) return true
  if (!r) return false
  if (String(r.name || '').toLowerCase().includes(f)) return true
  if (String(r.product_code || '').toLowerCase().includes(f)) return true
  const bc = String(r.barcode || '').toLowerCase()
  if (bc && (bc.includes(f) || (f.length >= 3 && bc.endsWith(f)))) return true
  /* v215：补拼音首字母 —— **必须与商品名候选面板同口径**（`matchMasterOne`），
     否则会出现「在筛选框里搜得到、在商品名格搜不到」这种同屏两套答案。
     ⚠️ `f` 已被 lower 过，而 `pyMap` 里存的是大写串 ⇒ 两边都转小写再比。 */
  const py = pyMap.value[String(r.product_id)]
  if (py && py.toLowerCase().includes(f)) return true
  return false
}
function rowVisible(r) {
  const f = (filterText.value || findText.value || '').trim().toLowerCase()
  if (f && !rowMatchText(r, f)) return false
  if (hideZeroReport.value && rowSum(r) <= 0) return false
  if (!passColFilter(r)) return false
  if (brandSel.value.length && !brandSel.value.includes(rowBrand(r))) return false
  return true
}
const maxQty = computed(() => {
  let m = 1
  cross.value.rows.forEach(r => cross.value.units.forEach(u => { const v = parseInt(r.qtyByUnit[u.name]) || 0; if (v > m) m = v }))
  return m
})
function heatStyle(r, uname) {
  const v = parseInt(r.qtyByUnit[uname]) || 0
  if (!v) return {}
  const t = Math.min(1, v / maxQty.value)
  // C1 修复 (2026-07-24)：硬编码 7 色 → variables.css --heat-* 令牌（inline style 中
  // var() 合法，深色模式自动适配，无需在 JS 里做主题分支）
  // v246 降噪：低值档（<0.35）只上**文字色**、不上底色 —— 否则整列同档时会变成一整块
  // 橄榄色，看起来像「被选中/出错」而非热度。底色只留给真正高的值。
  if (t >= 0.85) return { background: 'var(--heat-4-bg)', color: 'var(--heat-4-txt)' }
  if (t >= 0.6) return { background: 'var(--heat-3-bg)', color: 'var(--heat-3-txt)' }
  if (t >= 0.35) return { background: 'var(--heat-2-bg)', color: 'var(--heat-2-txt)' }
  if (t >= 0.15) return { color: 'var(--heat-3-txt)' }
  return { color: 'var(--t3)' }
}
const sortedRows = computed(() => {
  const rows = cross.value.rows
  if (sortKey.value === 'none') return rows
  const arr = [...rows]
  const dir = sortDir.value === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    let av, bv
    if (sortKey.value === 'name') { av = (a.name || ''); bv = (b.name || '') }
    else if (sortKey.value === 'qty') { av = rowSum(a); bv = rowSum(b) }
    else { av = amountValue(a); bv = amountValue(b) }
    if (typeof av === 'string') return av.localeCompare(bv, 'zh') * dir
    return (av - bv) * dir
  })
  return arr
})
const renderModel = computed(() => {
  const base = sortedRows.value.filter(r => rowVisible(r))
  if (groupBy.value === 'none') {
    return base.map((r, i) => ({ kind: 'row', r, zi: i, gkey: '' }))
  }
  const map = new Map()
  const gk = groupBy.value
  base.forEach(r => {
    let key
    if (gk === 'category' || gk === 'brand') { const m = prodMeta.value[r.product_id] || {}; key = (m[gk] || '未分类') }
    else { const v = r[gk]; key = (v != null && v !== '') ? String(v) : '未分类' }
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  })
  const out = []
  let zi = 0
  for (const [key, rs] of map) {
    const sub = { qty: 0, amount: 0 }
    // v184e：小计金额改用 amountValue（进价/箱 × 最终下单箱），与「下单金额(进价)」列同源；qty 仍为合计(小单位) 与「合计(小单位)」列同源。
    rs.forEach(r => { sub.qty += rowSum(r); sub.amount += (amountValue(r) || 0) })
    out.push({ kind: 'group', key, label: key, subtotal: sub })
    rs.forEach(r => out.push({ kind: 'row', r, zi: zi++, gkey: key }))
  }
  return out
})
function toggleGroup(key) { openGroups.value = { ...openGroups.value, [key]: !(openGroups.value[key]) } }
function onSort(key) {
  if (sortKey.value === key) { sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc' }
  else { sortKey.value = key; sortDir.value = 'desc' }
}
function sortInd(key) { return sortKey.value === key ? (sortDir.value === 'asc' ? 'arrow-up' : 'arrow-down') : '' }

/* ============ 表体工程化增强（T1-T8）：选中/内联编辑/展开/虚拟滚动/行状态/行操作/冻结列/空加载态/键盘a11y ============ */
const crossLoading = ref(false)
const selectedPid = ref(null)
const expandedRows = ref({})            // pid -> true 展开明细
const frozenKey = ref('name')           // 冻结列：name | product_code | none
const rowStates = ref({})               // pid -> 'loading' | 'error' | 'disabled'
const editingCell = ref(null)           // { pid, uname }
const activeCell = ref({ pid: '', ci: 0 })   // 键盘漫游激活格
const scrollTop = ref(0)
const viewportH = ref(600)
const scrollEl = ref(null)
const crossFoot = ref(null)   // 合计底栏（只读交叉表）水平滚动同步
const editFoot = ref(null)    // 合计底栏（编辑网格）水平滚动同步
const ROW_H = 34, GRP_H = 30, DET_H = 132
const OVER = 8                            // 虚拟滚动上下缓冲行
const VSCROLL_MIN = 80                    // 行数超过此值才启用虚拟滚动
const vFocus = { mounted: el => { try { el.focus() } catch (e) {} } }

/* v189：**活跃行**唯一判据 —— 所有「合计」的分子分母都必须与被渲染的行同源。
   软删行（`_deleted`，见 delRowSoft）不进任何合计。此前只有 recomputeTotals 做了过滤，
   编辑网格表尾（foot / inline Σ）、编辑态汇总条（editTotalQty / editTotalAmount）都对
   **全量 rows** 求和 ⇒ 同屏两个「合计」对不上（只读表 3 箱、编辑表尾却是别的数）。
   判据只留这一份，别处一律引用，不再各写一遍 filter。 */
const liveRows = computed(() => cross.value.rows.filter(r => !r._deleted))

function recomputeTotals() {
  const rows = liveRows.value
  const units = cross.value.units
  cross.value.colTotals = units.map(u => rows.reduce((s, r) => s + (r.qtyByUnit[u.name] || 0), 0))
  cross.value.grand = {
    sku: rows.length,
    qty: rows.reduce((s, r) => s + (r.total || 0), 0),   // 合计(小单位)
    boxes: rows.reduce((s, r) => s + rowBoxes(r), 0),     // 合计(箱)
    // v184e：报单金额合计 = 最终下单(箱) × 单价(进价/箱)，与只读表「下单金额(进价)」列同源。
    amount: rows.reduce((s, r) => s + (amountValue(r) || 0), 0),
  }
}
/* v207：表尾「合计(箱)」必须说清有多少行**没被算进去**（判据见 boxMissing —— 唯一来源）。
   表尾只是「能换算的行」之和；不报出行数，用户会看到表尾比逐行相加少一截却找不到原因。 */
const boxMissingRows = computed(() => liveRows.value.filter(boxMissing))
function rowState(r) { return rowStates.value[r.product_id] || (r._deleted ? 'disabled' : '') }
function setRowState(pid, s) { rowStates.value = { ...rowStates.value, [pid]: s } }
function toggleExpand(pid) { expandedRows.value = { ...expandedRows.value, [pid]: !expandedRows.value[pid] } }
function isExpanded(pid) { return !!expandedRows.value[pid] }
function viewRow(pid) { if (!isExpanded(pid)) toggleExpand(pid); selectedPid.value = pid; scrollToPid(pid) }
function editRow(pid) {
  const idx = cross.value.rows.findIndex(r => r.product_id === pid && !r._deleted)
  if (idx < 0) return
  editMode.value = true
  nextTick(() => { selectCell(idx, 0, false) })
}
function delRowSoft(pid) {
  // B2 修复 (2026-07-24)：不再只是「视图内隐藏」——标记进入删除清单，
  // saveEdits 保存时随矩阵提交过滤，后端幂等重建即物理删除（保存后重新载入不再出现）。
  if (!window.confirm('确认将该商品行从本期预报中删除？保存后生效（不保存可点「取消」放弃）')) return
  const r = cross.value.rows.find(x => x.product_id === pid)
  if (r) { r._deleted = true; if (selectedPid.value === pid) selectedPid.value = null; recomputeTotals() }
  toast('已加入删除清单，点「保存」生效', 'ok')
}
function editCell(pid, uname) { editingCell.value = { pid, uname } }
function commitCell(pid, uname, val) {
  const r = cross.value.rows.find(x => x.product_id === pid)
  if (!r) { editingCell.value = null; return }
  /* v214 A：`toHalfNum` 与其它数字格同源 —— 原实现 `parseInt("１２")` = NaN ⇒ `|| 0`
     ⇒ 用户在查看态双击输入一个全角数量，保存下来是 **0**（看着像"填了没生效"）。 */
  const v = Math.max(0, parseInt(toHalfNum(val), 10) || 0)
  r.qtyByUnit = { ...r.qtyByUnit, [uname]: v }
  const total = cross.value.units.reduce((s, u) => s + (r.qtyByUnit[u.name] || 0), 0)
  r.total = total
  // v184e：r.amount、boxes 与只读表/导出/列统计同源（箱口径）。r.amount = 最终下单(箱) × 单价(进价/箱)。
  r.amount = amountValue(r) != null ? amountValue(r) : (r.amount || 0)
  // v207：boxes 不再就地取整 —— 唯一实现是 rowBoxes()（内部 boxesOf）。r.total 上一行刚写好，可直接算。
  r.boxes = rowBoxes(r)
  recomputeTotals()
  editingCell.value = null
}
function onCellKey(e, pid, uname) {
  if (e.key === 'Enter') commitCell(pid, uname, e.target.value)
  else if (e.key === 'Escape') editingCell.value = null
}
function onCellClick(it, col, ci, e) {
  if (it.kind !== 'row' || e.target.closest('.row-ops')) return
  activeCell.value = { pid: it.r.product_id, ci }
  selectedPid.value = it.r.product_id
}
function onCellDbl(it, col) { if (it.kind === 'row' && col.type === 'qty') editCell(it.r.product_id, col.key) }
function onCellFocus(it, ci) { if (it.kind === 'row') activeCell.value = { pid: it.r.product_id, ci } }

/* v247 空列判定：整列在所有行里**都没有有效值** ⇒ 判为空列。
   ⚠️ 用 flatItems（全量行）而非 vsWindow（虚拟滚动窗口）—— 窗口内恰好都空会让列
      一闪一闪地出现/消失，判定必须稳定。
   ⚠️ 商品名（name）与固定列永不收起；0 也算「无值」（报 0 = 没报单）。 */
const emptyColSet = computed(() => {
  const rows = flatItems.value.filter(it => it.kind === 'row').map(it => it.r)
  const s = new Set()
  if (!rows.length) return s
  visibleCols.value.forEach(c => {
    if (c.key === 'name' || c.fixed) return
    const has = rows.some(r => {
      const v = c.fmt ? c.fmt(r) : r[c.key]
      return v != null && v !== '' && String(v).trim() !== '' && String(v) !== '0'
    })
    if (!has) s.add('m:' + c.key)
  })
  cross.value.units.forEach(u => {
    const has = rows.some(r => (parseInt(r.qtyByUnit && r.qtyByUnit[u.name]) || 0) !== 0)
    if (!has) s.add('q:' + u.name)
  })
  return s
})
const hiddenEmptyCols = computed(() => (showEmptyCols.value ? 0 : emptyColSet.value.size))

const colOrderList = computed(() => {
  const cols = [{ type: 'seq', key: 'seq', label: '列设置' }]
  // v184：把 fixed 一并带下去 —— 查看态的冻结判定（isFrozen）与 left 计算都要读它。
  //   ⚠️ 此前这里只传 key/label/cls/fmt/deletable，fixed 到不了查看态。
  // v247：收起整列全空的列（勾选「显示空列」后恢复）
  visibleCols.value.forEach(c => {
    if (!showEmptyCols.value && emptyColSet.value.has('m:' + c.key)) return
    cols.push({ type: 'master', key: c.key, label: c.label, cls: c.cls, fmt: c.fmt, deletable: c.deletable, fixed: c.fixed })
  })
  cross.value.units.forEach(u => {
    if (!showEmptyCols.value && emptyColSet.value.has('q:' + u.name)) return
    cols.push({ type: 'qty', key: u.name, label: u.name })
  })
  cols.push({ type: 'calc', key: 'qty', label: '合计(小单位)' })
  cols.push({ type: 'calc', key: 'boxes', label: '合计(箱)' })
  // v184e：系统建议用于辅助决定「加单」填多少，移到「加单」左侧，形成「建议→加单→最终下单」阅读流。
  // ⚠️ 命名纪律：本列是**后端固定口径**（routers/forecast_audit.py 的安全库存/到货周期/提前期常量），
  // 与受「建议算法」面板控制的「配方建议」列**是两个不同的量**，不得同名（改名前叫「AI建议」）。
  if (showSuggest.value) cols.push({ type: 'calc', key: 'ai', label: '系统建议' })
  cols.push({ type: 'calc', key: 'extra', label: '加单(箱)' })
  cols.push({ type: 'calc', key: 'final', label: '最终下单(箱)' })
  cols.push({ type: 'calc', key: 'price', label: '单价(进价/箱)' })
  cols.push({ type: 'calc', key: 'amount', label: '下单金额(进价)' })
  return cols
})
function colCls(col) {
  if (col.type === 'seq') return 'seq-cell'
  if (col.type === 'master') return col.cls || ''
  if (col.type === 'qty') return 'qty-cell'
  if (col.key === 'qty') return 'num calc sum'
  if (col.key === 'boxes') return 'num calc'
  if (col.key === 'extra') return 'num calc extra'
  if (col.key === 'final') return 'num calc final'
  if (col.key === 'ai') return 'num calc suggest'
  if (col.key === 'price') return 'num calc price'
  if (col.key === 'amount') return 'num calc amount'
  return 'num calc'
}
// 列宽拖拽：列宽按关键字存入 colWidths，<colgroup> 据此渲染；拖动右侧手柄实时改宽并存 localStorage
const colWidths = ref({})
// v177：随五列一并移除 safety_stock / expiry_days 的默认列宽（列已不渲染，留着就是死配置）。
/* v178：补 `barcode` —— 它此前不在这张默认表里 ⇒ colDefault 落到兜底 90px，13 位条码
   只显示得下 9 位（对账时看不全，且与「条码重复」判定直接相关：看不到全码就无法人工核对）。
   需要 ~130px 才放得下 13 位数字 + 输入框内边距 + 拖拽手柄。用户若手动拖过该列，
   colWidths 里已有值、仍以用户所拖为准（本默认只对没拖过的用户生效）。 */
/* v187：补 `price` —— 表头「单价(进价/箱)」需 ~91px 才不折行，此前不在默认表里 ⇒
   落到兜底 90px，两态表头都会折成两行。与 `amount`(104) 拉平，两态同宽。 */
/* v188：列名带单位后加宽 —— 「合计(小单位)」需 ~95px（原 `qty`=只读表 / `sum`=编辑网格 都只有 74px）；
   「合计(箱)」由「件数(箱)」缩短，但 70px 仍偏窄 ⇒ 与同排 `extra`/`final`(78) 拉平取 84。
   v207：`boxes` 84 → 100 —— 箱数改为**可为小数**后要放下「1,234.567」这类 9 位（原 84px 只够
   6~7 位整数），且表尾那格还要容纳「（缺规格 N 行未计入）」。`final` 不跟着加：它被
   Math.ceil 过、恒为整数，位数没变。
   ⚠️ 两态同列共用同一 key：只读表的「合计(小单位)」= `qty`，编辑网格的 = `sum`，**两个 key 同一个量**
   （历史命名分裂，改名会牵动 readCellVal/导出/col_defs，本轮不动，只保证宽度一致）。 */
const COL_DEFAULTS = { seq: 46, name: 210, arrival_lead_days: 92, barcode: 132, product_code: 120, category: 90, brand: 90, spec: 90, unit: 70, qty: 104, boxes: 100, extra: 78, final: 78, ai: 84, amount: 104, price: 104, suggest: 80, comparePrev: 80, compareDelta: 80, spark: 92, yoyPrev: 80, yoyDelta: 80, sum: 104, op: 64 }
function colDefault(key) { return COL_DEFAULTS[key] != null ? COL_DEFAULTS[key] : (key === 'seq' ? 46 : 90) }
function colW(key) { return colWidths.value[key] != null ? colWidths.value[key] : colDefault(key) }
// v176：序号列已冻结在 left:0，故**其后每个冻结列的 left 必须整体右移「一个序号列宽」**，
// 否则冻结列会滑到序号列底下与之重叠（只读表的「商品名称」默认就是冻结列，必撞）。
// 六个渲染点（只读表 thead/tbody/表尾 + 编辑表 thead/tbody/表尾）共用本函数，避免 6 份内联
// 表达式各自漂移；序号列宽可被拖拽手柄改（startResize(...,'seq')），故**必须**走 colW('seq')，
// 硬编码 46 会在用户改宽后错位。base = 既有偏移（0 或 200）。
/* v184：左侧冻结区的偏移计算 —— 由「固定列宽度依次累加」得出，**不再硬编码**。
   原实现 `frozenShift(base)` 手工传 0 或 **200**：那个 200 是「商品名称宽」的硬编码猜值，
   而 COL_DEFAULTS.name = 210 ⇒ 只要用户没拖过列宽，第二个冻结列就偏 10px；把名称拖宽后偏更多。
   现改为读实际列宽（colW），且新增固定列时其余冻结列自动右移。 */
const FROZEN_COLS = ['name', 'arrival_lead_days']   // 左侧冻结区，从左到右（序号列另占 left:0）
/* v192：冻结区宽度改由**实际渲染出来的固定列**累加得出（`visibleCols` 已把固定列按 FROZEN_COLS
   次序强制归位到最左 ⇒ 它就是渲染次序的唯一权威）。为什么必须按"渲染出来的"、而不是"定义里的"：
   自 v192 起固定列**允许被隐藏**（「到货周期」= 列设置里可勾掉，见 isLockedCol），被隐藏的固定列
   不再渲染、也就不该再占位 —— 否则它身后的固定列、以及「用户手动冻结列」（left = frozenRight()）
   都会停在空缺的宽度上，表现为凭空多出一段空白（且不报错）。
   ⚠️ 没有任何固定列被隐藏时，本式与旧的「按 FROZEN_COLS 全量累加」**逐字等价** ⇒ 对既有用户零位移。
   这也是不去改 FROZEN_COLS 名单本身的原因：到货周期**仍然是固定列**（依旧钉在左侧、依旧不可删），
   只是多了一个「可隐藏」的许可。 */
function frozenLeftOf(key) {                        // 某固定列的 left
  let x = colW('seq')
  for (const c of visibleCols.value) { if (c.key === key) break; if (c.fixed) x += colW(c.key) }
  return x + 'px'
}
function frozenRight() {                            // 冻结区右界 —— 用户手动冻结的列排在这里
  return (colW('seq') + visibleCols.value.reduce((s, c) => s + (c.fixed ? colW(c.key) : 0), 0)) + 'px'
}
function loadColWidths() { try { const s = localStorage.getItem('hergent-forecast-col-widths'); if (s) colWidths.value = JSON.parse(s) || {} } catch (e) {} }
function resetColWidths() {
  try { localStorage.removeItem('hergent-forecast-col-widths') } catch (e) {}
  colWidths.value = {}
  toast('已恢复默认列宽', 'ok')
}
function startResize(e, key) {
  e.preventDefault(); e.stopPropagation()
  const startX = e.clientX
  const startW = colW(key)
  function onMove(ev) { let w = startW + (ev.clientX - startX); if (w < 40) w = 40; colWidths.value = { ...colWidths.value, [key]: w } }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { localStorage.setItem('hergent-forecast-col-widths', JSON.stringify(colWidths.value)) } catch (e2) {}
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
// 编辑网格表头列顺序（必须与实际 <th>/<td> 顺序一致），供 <colgroup> 与拖拽手柄使用
const editColKeys = computed(() => {
  const keys = ['seq']
  visibleCols.value.forEach(c => keys.push(c.key))
  cross.value.units.forEach(u => keys.push(u.name))
  /* v187：汇总列与「汇总表（只读）」逐列对齐（用户 2026-09-18 要求）——
     报单单元 → 合计(小单位) → 合计(箱) → 配方建议 → 加单(箱) → 最终下单(箱) → 单价(进价/箱) → 下单金额(进价)。
     原实现把「合计」甩到最右、且完全缺「最终下单 / 下单金额(进价)」两列（只在只读表有）。
     ⚠️ 本函数驱动 <colgroup>，改这里必须同步 thead th / tbody td / 表尾 td 四处，否则整表错位。
     v188：列名带单位（合计 → 合计(小单位)，件数(箱) → 合计(箱)），key 不变、本节结构不变。 */
  keys.push('sum')          // 合计(小单位)（= 各报单单元数量之和，紧挨报单单元）
  keys.push('boxes')        // 合计(箱) = 合计(小单位) ÷ 每箱小单位数（v207 起**可为小数**；取整只在「最终下单」）
  if (showSuggest.value) keys.push('suggest')
  keys.push('extra')        // 加单(箱)
  keys.push('final')        // 最终下单(箱) = 取整(合计(箱), 向上) + 加单(箱)
  keys.push('price')        // 单价(进价/箱) = 商品档案的进价本身（v223 起不再乘每箱数，见 priceAuto）
  keys.push('amount')       // 下单金额(进价) = 最终下单(箱) × 单价(进价/箱)
  if (compareOn.value) { keys.push('comparePrev'); keys.push('compareDelta') }
  if (showSpark.value) keys.push('spark')
  if (yoyOn.value) { keys.push('yoyPrev'); keys.push('yoyDelta') }
  // v170：原此处有 keys.push('spacer')（表头「客户名」输入框的占位列），入口迁到工具行后一并撤除。
  keys.push('op')
  return keys
})
/* v187：加单(箱) 输入框的 `data-c` 哨兵值。
   🔴 编辑网格的**选区索引空间只含主档列 + 报单单元**（maxC = visibleCols.length + units.length - 1）；
   calc 列（合计(小单位) / 合计(箱) / 配方建议 / 最终下单 / 单价 / 下单金额）**不参与**键盘导航、填充柄与选区统计
   —— readCellVal / writeCellVal 对 c ≥ master+units 一律返回 '' / false。
   而「加单」是 calc 列里**唯一带输入框**的（v-model 手输加单量），聚焦时必须给 onFocusCell 传一个
   **不会命中任何真实格**的位置，否则会覆盖用户当前选区。
   故传「最后一个报单单元之后」这一越界值 —— 无害空操作：focusCell 查不到元素即 no-op，
   所有 `selected.c === ...` 的比对也永不成立。
   ⚠️ 不要改成 editColKeys.indexOf('extra') - 1：那个值会随 showSuggest 开关漂移，
      且语义并不同源（calc 列压根不在这个索引空间里）。原先硬写成 visibleCols.length + units.length，
      现具名化，免得下次重排列序时误以为它需要跟着变。 */
const C_EXTRA_INPUT = computed(() => visibleCols.value.length + unitCount())
/* v190：改单网格「单价(进价/箱)」录入框的哨兵值 —— 道理同 C_EXTRA_INPUT（calc 列不在单元格
   选区索引空间内），但**故意取不同的值**：若两者同值，`selected.c` 就分不清「正在填单价」
   还是「正在填加单」，日后给这两格加选中态会互相点亮。
   本值对 readCellVal / writeCellVal 同样是越界 ⇒ 返回 '' / false，语义同 C_EXTRA_INPUT。 */
const C_PRICE_INPUT = computed(() => visibleCols.value.length + unitCount() + 1)
/* v184：查看态的冻结列 = **固定列** ∪ 用户在下拉里选的单列（frozenKey）。
   固定列不受 frozenKey 影响 —— 下拉选了别的列时它照样冻结，否则「固定列」名不副实。
   （此前只看 frozenKey，而它默认 'name'、可被用户改掉 ⇒ 加进来的固定列一改下拉就不见了。） */
function isFrozen(col) { return col.fixed === true || (frozenKey.value !== 'none' && col.key === frozenKey.value) }
function canSort(col) { return col.key === 'name' || col.key === 'qty' || col.key === 'amount' }
function ariaSort(col) { return sortKey.value === col.key ? (sortDir.value === 'asc' ? 'ascending' : 'descending') : 'none' }
function onHeadClick(col) { if (canSort(col)) onSort(col.key) }
function masterVal(r, col) { if (col.fmt) return col.fmt(r); const v = r[col.key]; return v != null && v !== '' ? v : '—' }
// v184d：**报单金额的计价基准 = 进价（元/箱）**。
// 🔴 v226b 收紧：只认 `factory_price`，**不再回退 `purchase_price`**。为什么必须收紧：
//   · 量纲：`purchase_price` 是**元/小单位**（生产实测 `factory_price = pp × perCase × 0.9`，46/46 成立），
//     而本函数返回值要乘 `rowFinalQty`（**箱数**）⇒ 回退会让金额**差一个 perCase 倍**（10~36 倍）。
//   · 语义：`purchase_price` 生产实测 **56/56 == `sale_price`**（其中 46/46 还 == `dist_price`）
//     ⇒ 它存的是「卖给门店的价」，压根不是进货成本；拿它当进价是在说假话。
//   · 生产影响：命中 10 个商品，而它们 `pp == sp` 逐个全等 ⇒ **金额数值零变化**
//     （回退 pp 与回退售价本就等价），只是界面从「缺规格」如实改成「缺价」。
// ⚠️ 与「档案完整性」口径的区别（**别把两件事混成一件事**）：
//   `ProductArchive.fpEff()` 与后端 `db.factory_price_sql` **仍保留**回退 —— 它们回答的是
//   「这个商品档案里有没有录过价格信息」（用于列表展示与缺价计数/闸门），**不是**「算金额用多少钱」。
//   同一个词「进价」在两个问题下答案不同，是有意的；改任意一处前先想清问的是哪一个。
function factoryPrice(r) {
  return Number(r?.factory_price || 0)
}
/* v189：规格 → **每箱小单位数**（「合计(箱) = 合计(小单位) ÷ 规格」里那个「规格」的唯一实现）。
   🔴 原四处都写 parseFloat(spec)，取到的是**净含量**、不是每箱数：
        parseFloat('200g*12') = 200（克）、parseFloat('1500ML*6桶') = 1500 ⇒ 箱数被缩小 250 倍。
        生产只读实测（期次 9）：规格 200g*12 的 24 件 → 算出 **0 箱**（正确应为 2；该期合计 0 → 3）。
   🔴 为什么不能「先合计小单位、再除以某个规格」：生产档案 288 个商品里 **192 个规格是描述串**
        （'250g*24瓶' / '90g*8杯*12组' / '210g*10瓶*6提手提装'）、**30 个为空** —— 规格异构时
        该式**没有定义**。成立的唯一定义是**逐行除、再相加**（见 rowBoxes），本函数只负责那一「除」。
   规则（对全量档案逐一验过）：
     ① 取规格串里**最后一个**数字 = 每箱小单位数（250g*24瓶→24、100g*8杯*12组→12、1500ML*6桶→6）；
     ② 报单单位(unit)也在规格里出现、且比末位更靠前（更细）时按层级相乘：
        100g*8杯*12组 且 unit=杯 → 8×12 = 96（1 箱 = 12 组 = 96 杯）；
     ③ 纯数字规格（'12'）即其本身；
     ④ 不含任何数字 → 0（缺规格 ⇒ 不换算，界面走「缺规格」分支，**不静默当 1**）。 */
/* v222（2026-09-21）：换算的**数据源**改为「商品档案优先 → 规格解析回退」——尺度与语义**完全不变**
   （仍返回「1 个大单位 = 多少个小单位」= 每箱小单位数；报单单位落在中/大单位层时按层级折算）。
   🔴 为什么改：规格串是**自由文本**，生产实测三类翻车 ——
      · 净含量被当成装箱数：'340G' ⇒ 340 瓶（与真值 12 差 **28.3 倍**）；
      · 末位数字不是装箱数：'195g×24盒（130g+65g）' 被末位抓成 **65**；
      · 空规格 28 个 ⇒ 连箱数都算不出（界面显示「缺规格」）。
     而 `products.large_ratio/medium_ratio` **结构化、有来源**（import_zhoupu.py 读舟谱「大单位换算」，
      与本轮舟谱档案逐值比对 **96.8% 一致**），且**已被定价引擎消费**（domain/pricing_engine.py）。
   🔴 权威唯一性：这是「1 件 = 24 瓶」在本系统的**唯一权威**；`unit_conversions` / `unit_archive`
      在生产上都是 **0 行空表**、**不得反向写入**（同一事实存两份必然漂移）。
   🔴 判据是 `large_ratio > 0`，**不是** `has_multi_unit` —— 实测该标志位漏标 9 条，拿它当判据会静默漏商品。
   🔴 三级尺度以**档案**为准（规格串只是兜底）：报单单位 == 大单位 ⇒ 1；== 中单位 ⇒ lr/mr；
      其余（更细/未知名）⇒ lr。**回退只在档案无换算时发生**，逐字保留 v189 规则，不做「先猜再看」。
   参数 `arc` = 行对象（含 large_unit/large_ratio/medium_unit/medium_ratio，由 /api/products/grid 下发）；
      **不传 ⇒ 完全回到 v189 行为**（供测试与未配套升级的调用方，不静默按 1 算）。 */
function perCase(spec, unit, arc) {
  // ① 档案换算优先（唯一权威）
  const lr = arc ? (Number(arc.large_ratio) || 0) : 0
  if (lr > 0) {
    const u0 = String(unit == null ? '' : unit).trim()
    const lu = String(arc.large_unit == null ? '' : arc.large_unit).trim()
    const mu = String(arc.medium_unit == null ? '' : arc.medium_unit).trim()
    const mr = Number(arc.medium_ratio) || 0
    if (u0 && lu && u0 === lu) return 1                    // 按大单位（件/箱）报单 ⇒ 1 个 = 1 箱
    if (u0 && mu && u0 === mu && mr > 0) return lr / mr    // 按中单位报单 ⇒ 1 箱 = lr/mr 个中单位
    return lr                                              // 按小单位报单（当前生产全部命中此支）
  }
  // ② 回退：规格串解析（v189 规则，逐字保留）
  const s = String(spec == null ? '' : spec)
  // 「数字 + 紧随其后的单位字串」分段（'*' / 'x' / '×' 只作分隔）
  const segs = []
  const re = /(\d+(?:\.\d+)?)\s*([^\d\s*×xX·]*)/g
  let m
  while ((m = re.exec(s))) {
    const n = parseFloat(m[1])
    if (n > 0) segs.push({ n, u: String(m[2] || '').trim() })
  }
  if (!segs.length) return 0                        // ④ 无数字
  const last = segs[segs.length - 1]
  if (segs.length === 1 && !last.u) return last.n    // ③ 纯数字规格
  if (!last.u) return last.n                         // 末位无单位（'500g*12'）⇒ 它就是每箱数
  const u0 = String(unit == null ? '' : unit).trim()
  if (!u0 || u0 === last.u) return last.n            // ① 同单位 / 报单单位缺失
  const i = segs.findIndex(x => x.u === u0)
  if (i >= 0 && i < segs.length - 1) {               // ② 报单单位更细 ⇒ 层级相乘
    return segs.slice(i).reduce((p, x) => p * x.n, 1)
  }
  return last.n
}
/* v207：箱数换算的**唯一实现**（不含取整）—— rowBoxes / 只读表行构造 / 编辑格子回写共用这一处。
   🔴 为什么去掉 Math.round（原 v184e 写法。用户 2026-09-19 报障：期次 14 / 永辉东津店
       的报单「合计(小单位)」有 9、「合计(箱)」却是 0）：
       报单数量按**最小销售单位**录入（瓶/杯/组/袋），「合计(箱)」= 数量 ÷ 每箱小单位数
       **可以是小数** —— 这是用户 2026-09-13 已拍板的口径（`件数 = 数量 ÷ 规格`，明确可为小数）。
       旧实现先 Math.round ⇒ 不足半箱的行被抹成 **0**；更贵的是连带
       `下单金额 = 最终下单(箱) × 单价(进价/箱)` 一起变 0，而「单价(进价/箱)」列本身不为 0
       ⇒ 用户只看到金额栏凭空归零，看不出是哪一步丢的。
   🔴 取整**只发生在「最终下单」**（见 rowFinalQty），理由：厂商不拆零发货。
   ⚠️ 保留 **3** 位小数（不是 2 位）：185ml×24瓶 报 3 瓶 = 0.125，2 位会显示成 0.13。
      用户自己的报单 Excel 里「件数」就是 3 位（实锤：3.625）⇒ 同精度便于逐行对账。 */
function boxesOf(total, spec, unit, arc) {
  const pc = perCase(spec, unit, arc)
  const t = Number(total) || 0
  if (!(pc > 0) || !t) return 0
  return Math.round(t / pc * 1000) / 1000
}
// v184e / v207：合计(箱) —— 与只读表「合计(箱)」列、rowFinalQty（最终下单）、下单金额同源。
//   v188 仅改列名（原「件数(箱)」），公式与 key(`boxes`) 不变。
//   v189 修「规格」的取法：parseFloat(spec) 取的是净含量 ⇒ 改走 perCase（唯一实现）。
//   v207 去掉取整（抹零元凶）—— 见 boxesOf 上方说明。
function rowBoxes(r) {
  if (!r) return 0
  const total = r.total != null ? (Number(r.total) || 0) : rowSum(r)
  return boxesOf(total, r.spec, r.unit, r)
}
/* v207：某一行的「合计(箱)」**换算不出来**（有报单但商品档案没规格）—— 全站**唯一判据**。
   boxText（单元格文案）、boxMissingRows（表尾未计入行数）、单元格警示样式 全部引用它。
   ⚠️ 绝不在别处再写一遍这个条件：两处判据一旦漂移，就会出现「表尾说有 2 行缺规格、
      单元格却一个都没标」这种自相矛盾的界面。 */
function boxMissing(r) {
  if (!r) return false
  const total = r.total != null ? (Number(r.total) || 0) : rowSum(r)
  return total > 0 && !(perCase(r.spec, r.unit, r) > 0)
}
/* v207：「合计(箱)」的**显示取值** —— 把「缺规格」与「真的是 0」分开。
   缺规格时 perCase 返回 0 ⇒ 根本换算不出来；若照常显示 0，用户看到的就是「报了单却 0 箱」，
   与本次报障**长得一模一样、根因完全不同**（一个是取整抹零、一个是商品档案没规格）。
   与 perCase 规则④「缺规格 ⇒ 不换算，界面走「缺规格」分支，不静默当 1」一致。 */
function boxText(r) {
  if (!r) return '—'
  return boxMissing(r) ? '缺规格' : fmtBox(rowBoxes(r))
}
/* 🔴 v223（2026-09-21）：**单价(进价/箱) = 商品档案的进价本身，不做任何乘除。**
   轨迹 —— 三轮都在调「乘多少」，没人质疑「该不该乘」：
     v184e 写 `进价 × parseFloat(规格)`（取到的是净含量）；v189 把「规格」换成每箱小单位数（1500ML*6桶 由 ×1500 变 ×6）；
     v222 把「每箱小单位数」的数据源从规格解析换成档案换算 —— 三次都没动那个「×」。
   🔴 事实：`products.factory_price` 的单位**就是「元/箱（大单位）」**，不是「元/小单位」。三条**互相独立**的数据逐条吻合：
     ① `进价 ÷ large_ratio` = 每小单位成本，再 `÷ 0.9` = 档案 `dist_price`
        （1494: 75÷15=5.00 → 5.5556 ✓；1454: 124.80÷24=5.20 → 5.7778 ✓；1477: 94.80÷12=7.90 → 8.7778 ✓；1539: 62÷8=7.75 → 8.6111 ✓）
     ② `sale_order_items.unit_price` **逐字等于** `dist_price`（1494 全部 389 行 = 5.5556；1454 227 行 = 5.7778；1539 343 行 = 8.6111）
     ③ 反证：若进价是「元/小单位」，1494 一箱成本 = 75 × 15 = 1125 元，而门店买一箱只付 83.33 元 ⇒ **卖一箱亏 1041 元**，不可能
   旁证（后端同口径）：`domain/pricing_engine._get_standard_price` 写 `大单位价 = sale_price × large_ratio`
     ⇒ **`sale_price` / `purchase_price` / `dist_price` 是「元/小单位」，只有 `factory_price` 是「元/大单位」**。
   ⇒ 再乘 perCase 就是把「元/箱」又乘一次每箱单位数 ⇒ **单价与金额同时被放大 perCase 倍**
     （1454 曾显示 124.80 × 24 = 2995.20，真值 124.80，放大 24 倍）。这正是 v217「价格被放大」诊断出的那个根，v223 才真正修掉。
   ⚠️ 单价**不再依赖 perCase** ⇒ 缺规格的行也照样显示单价；但箱数仍算不出来 ⇒ 金额仍走「缺规格」（见 amountValue 守卫）。
   v190：**自动价** = 换算的唯一实现，供 pricePerCase 与录入框占位提示共用。
     结果归一化到「分」：进价是浮点（`62/0.9` 这类），不归一就会出现
     「界面上写着 3840.00、金额却是 3839.9996 累出来的」——用户拿去对账差几分钱。这是**计价精度**，不是掩盖误差。
   ✅ v226b 已收紧（原遗留项）：`factoryPrice()` 不再回退 `purchase_price`（元/小单位） —— 见其定义处注释。
     命中 10 个商品、`pp == sp` 全等 ⇒ **金额数值零变化**；文案由「缺规格」改为更前置、更准确的「缺价」
     （它们既没箱价、也没规格，先缺的是价）。要让它们能算金额，须在**商品档案**按「元/箱」补一个进价。 */
function priceAuto(r) {
  const fp = factoryPrice(r)
  if (fp <= 0) return null                      // 缺价
  return Math.round(fp * 100) / 100
}
/* v190：「单价(进价/箱)」取值 = **手工录入优先**，否则自动价。
   录入值是权威 —— 直接用它（同样归一到分，钱只到分位），不再经进价回算，
   免得「填 100、保存后显示 99.9996」。
   🔴 2026-09-18 口径变更（用户拍板「**只在本期生效**」）：手工价随报单落进
   `forecast_extra_qty.case_price`（唯一键含 产品×期次）⇒ 只影响本期；
   **不再反推写回商品档案** —— 写档案会改掉**所有期次**的金额。
   要在别期也用这个价，就在那一期自己再填一次。
   🔴 v191b（同日稍晚，用户拍板「**直接延用上一期，不加按钮**」）⇒ 取值链由两级变**三级**：
       ① 本期手工录入（`r.casePrice`，随 save-matrix 落库、只在本期生效）
       ② **沿用**：本期之前**最近一次录入**过的价（`r.casePriceInherit`，后端随 summary 下发）
       ③ 都没有 ⇒ 按商品档案进价自动算（`priceAuto`）
   ②是**只读参考值，绝不落库** —— 不碰档案、也不写本期记录 ⇒「没填」不会被保存成「填过」，
   清空输入框即可撤销（回落到 ②/③）。 */
function priceInherit(r) {
  const iv = Number(r && r.casePriceInherit)
  return iv > 0 ? Math.round(iv * 100) / 100 : null
}
/* v191b：沿用来源的期次标签（后端下发 last_case_period_start/end，形如 2026-08-30 / 2026-09-15）。
   纯展示，不参与任何计算；同一年只给「月/日」，跨年或非本年带上年份。 */
function inheritPeriodLabel(ps, pe) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
    return m ? { y: m[1], t: m[2] + '/' + m[3] } : null
  }
  const a = p(ps)
  const b = p(pe) || a
  if (!a) return '上一期'
  if (b.y === a.y && a.y === String(new Date().getFullYear())) return a.t + '–' + b.t
  return a.y + '/' + a.t + '–' + b.t
}
function pricePerCase(r) {
  const cv = Number(r && r.casePrice)
  if (cv > 0) return Math.round(cv * 100) / 100   // ① 本期手工录入
  const iv = priceInherit(r)
  if (iv != null) return iv                        // ② 沿用上一期录入的价（不落库）
  return priceAuto(r)                              // ③ 按商品档案进价自动算
}
/* v190：录入框灰字占位 —— 未手工录入时显示「**当前实际生效的价**」，让用户一眼知道现在按多少算；
   缺价则直接说明，而不是留一个空白框让人猜。
   ⚠️ v191b：占位值改用 `pricePerCase`（= 生效值）而不是只给 `priceAuto`（自动价）——
   生效值还可能是「沿用上一期录入的价」，只显示自动价会与旁边「下单金额」列对不上（同屏两个口径）。
   来源差异放在 `title` 里说清（见 priceTitle），灰字本身不区分来源。
   ⚠️ v223：单价已不依赖 perCase ⇒ 空态**只剩「缺价」一种**（原「缺规格」分支成了死代码，已删）；
     缺规格的提示仍在「合计(箱)」列（boxText）与金额列（amountValue 守卫）里出现，没有丢信息。 */
function pricePh(r) {
  const eff = pricePerCase(r)
  if (eff != null) return eff.toFixed(2)
  return '缺价，请填'
}
/* v190：来源必须可自证 —— 手工价与自动价不得长得一样。
   v191b：三级来源各一句，且「沿用」态要点名**是哪一期的**录入价（否则老板会以为是自己本期填的）。
   沿用态同样只进灰字占位：不实填、不加粗 ⇒ 一眼能与「本期手工录入」区分开。 */
function priceTitle(r) {
  const a = priceAuto(r)
  const cv = Number(r && r.casePrice)
  const iv = priceInherit(r)
  let head
  if (cv > 0) {
    head = '本期手工录入价（只在本期生效：本次报单按这个价算金额，不写回商品档案，也不影响其他期次）'
  } else if (iv != null) {
    head = '沿用「' + (r.casePriceInheritPeriod || '上一期') + '」录入的价 ¥' + iv.toFixed(2)
      + '/箱 —— 本期不用重填；直接填数即可改，清空则回到档案自动价'
  } else {
    head = '按商品档案的进价：进价本身就是「元/箱」，直接作为单价(进价/箱)。可直接录入覆盖。'
  }
  return head + (a != null ? `\n自动价 ¥${a.toFixed(2)}/箱` : '')
}
/* v190：录入箱价 → 本行立即生效（pricePerCase 优先读它，故「下单金额(进价)」自动跟随：
   下单金额 = 最终下单(箱) × 本列）。清空 = 撤掉手工价，回到档案进价自动算。
   落库发生在「保存」：随 save-matrix 的 case_price 落进 `forecast_extra_qty`
   （按 产品×期次 唯一）⇒ **只在本期生效**，且换浏览器 / 换个人打开本期表看到的都是同一个价。
   录入过程中**不**在行上存任何派生态副本（草稿恢复、复制行都会让副本漂移）。 */
function onCasePriceChange(r, e) {
  /* v214 A：先把编辑期间的中间态收敛成确定值（`"12."` → 12），与数量格同理 ——
     不收敛会被后端 `_NUM_RE` 判「非数字」拒收，而用户填的明明是 12。
     ⚠️ 顺带堵一个静默清除：原实现直接 `Number(r.casePrice)`，若这一格是**全角**的
        （`v-model.number` 在 `type=number` 下虽打不进来，但粘贴/草稿恢复可以），
        `Number("１２")` = NaN ⇒ `!(NaN > 0)` 成立 ⇒ 走「清空 = 回到档案自动价」分支，
        把用户刚输的价**悄悄抹掉**（看起来像「填了没生效」）。归一后不再发生。 */
  if (e && e.target) r.casePrice = parseNumInput(e.target.value)
  const v = Number(r.casePrice)
  if (!(v > 0)) {                    // 清空 = 回到档案自动价
    r.casePrice = null
    saveDraftNow()
    return
  }
  r.casePrice = v
  if (!(perCase(r.spec, r.unit, r) > 0)) {
    /* 缺规格 ⇒ 「最终下单(箱)」换算不出来 ⇒ 金额也随之算不出来。
       ⚠️ v223：原文写「单价填了也只有金额能算」—— 单价口径修好之后**这句话不再成立**
       （amountValue 已补守卫，缺规格直接返回 null 走「缺规格」文案），改掉以免用户以为金额已按他填的价算好。 */
    toast('该商品缺规格：单价已记下，但箱数换算不出来 ⇒ 最终下单与下单金额都算不出来，请先补规格', 'warn')
  }
  saveDraftNow()
}
/* v184e：下单金额(进价)（元）= 最终下单(箱) × 单价(进价/箱)；缺价或缺规格返回 null（界面显示「缺价/缺规格」）。
   🔴 v223 补第二道守卫：单价改回「进价本身」后**不再依赖 perCase**，若这里仍只看 `pricePerCase`，
      缺规格的行会算出 `rowFinalQty(=0) × 单价 = 0.00` —— 与旁边「合计(箱)」写着「缺规格」自相矛盾，
      而且会被当成本期真的一分钱没有。⇒ 与 `perCase` 规则④「缺规格不静默当 1」同判据，显式返回 null。 */
function amountValue(r) {
  const pc = pricePerCase(r)
  if (pc == null) return null
  if (!(perCase(r.spec, r.unit, r) > 0)) return null   // v223：缺规格 ⇒ 箱数无从换算 ⇒ 金额也谈不上
  return rowFinalQty(r) * pc
}
function cellText(r, col) {
  if (col.type === 'qty') return r.qtyByUnit[col.key] || 0
  if (col.type === 'master') return masterVal(r, col)
  if (col.key === 'qty') return fmt(r.total)
  if (col.key === 'boxes') return boxText(r)
  if (col.key === 'extra') return fmt(rowExtraQty(r))
  if (col.key === 'final') return fmt(rowFinalQty(r))
  if (col.key === 'ai') return r.ai != null ? fmt(r.ai) : '—'
  if (col.key === 'price') { const pc = pricePerCase(r); return pc != null ? pc.toFixed(2) + ' /箱' : (factoryPrice(r) <= 0 ? '缺价' : '缺规格') }
  if (col.key === 'amount') { const av = amountValue(r); return av != null ? fmt(av) : (factoryPrice(r) <= 0 ? '缺价' : '缺规格') }
  return ''
}
function cellAria(r, col) { if (col.type === 'seq') return '序号：' + (r.seq || '') ; return col.label + '：' + cellText(r, col) }
function rowAria(r) { const fq = rowFinalQty(r); const av = amountValue(r); return r.name + '，合计 ' + fmt(r.total) + '，加单 ' + fmt(rowExtraQty(r)) + '，最终下单 ' + fmt(fq) + '，下单金额(进价) ¥' + fmt(av != null ? av : 0) }
function rowKey(it) { return it.kind === 'group' ? 'grp-' + it.key : it.kind === 'row' ? 'row-' + it.r.product_id : 'det-' + it.r.product_id }
function cellActive(it, ci) { return it.kind === 'row' && it.r.product_id === activeCell.value.pid && ci === activeCell.value.ci }
function riskText(r) {
  const parts = []
  const w = rowWarn(r); if (w === 'low') parts.push('低于安全库存'); else if (w === 'short') parts.push('短保≤7天')
  const l = lossWarn(r); if (l) parts.push('货损风险')
  const rt = rtBadge(r); if (rt) parts.push('库存预警')
  if (gapSet.value.has(r.product_id)) parts.push('缺批次/到期')
  if (hsMap[r.product_id] !== undefined && hsMap[r.product_id] < 60) parts.push('数据健康偏低')
  return parts.length ? parts.join('、') : '正常'
}
function riskCls(r) { return riskText(r) === '正常' ? 'ok' : 'warn' }

const flatItems = computed(() => {
  const out = []
  let seq = 0
  for (const it of renderModel.value) {
    if (it.kind === 'group') { out.push({ ...it, h: GRP_H }); continue }
    if (it.r._deleted) continue
    seq++
    out.push({ ...it, h: ROW_H, seq })
    if (expandedRows.value[it.r.product_id]) out.push({ kind: 'detail', r: it.r, gkey: it.gkey, h: DET_H, key: 'det-' + it.r.product_id })
  }
  return out
})
const vScrollOn = computed(() => flatItems.value.length > VSCROLL_MIN)
function offsetOf(i) { let h = 0; const arr = flatItems.value; for (let k = 0; k < i; k++) h += arr[k].h || ROW_H; return h }
const vsWindow = computed(() => {
  const arr = flatItems.value
  const total = arr.reduce((s, it) => s + (it.h || ROW_H), 0)
  if (!vScrollOn.value) return { items: arr, top: 0, bottom: 0 }
  let start = 0, acc = 0
  while (start < arr.length && acc + (arr[start].h || ROW_H) < scrollTop.value - OVER * ROW_H) { acc += arr[start].h || ROW_H; start++ }
  let end = start, acc2 = acc
  while (end < arr.length && acc2 < scrollTop.value + viewportH.value + OVER * ROW_H) { acc2 += arr[end].h || ROW_H; end++ }
  return { items: arr.slice(start, end), top: offsetOf(start), bottom: Math.max(0, total - offsetOf(end)) }
})
function onScroll(e) { scrollTop.value = e.target.scrollTop; if (scrollEl.value) viewportH.value = scrollEl.value.clientHeight; const sl = e.target.scrollLeft; if (crossFoot.value) crossFoot.value.style.setProperty('--foot-sl', -sl + 'px') }
function onEditScroll(e) { const sl = e.target.scrollLeft; if (editFoot.value) editFoot.value.style.setProperty('--foot-sl', -sl + 'px') }
function scrollToIndex(ri) {
  if (!vScrollOn.value || !scrollEl.value) return
  const off = offsetOf(ri)
  const h = (flatItems.value[ri] && flatItems.value[ri].h) || ROW_H
  if (off < scrollTop.value) scrollEl.value.scrollTop = Math.max(0, off - ROW_H)
  else if (off + h > scrollTop.value + viewportH.value) scrollEl.value.scrollTop = off + h - viewportH.value + ROW_H
}
function scrollToPid(pid) { const i = flatItems.value.findIndex(it => it.kind === 'row' && it.r.product_id === pid); if (i >= 0) scrollToIndex(i) }
function focusActive() {
  if (!scrollEl.value) return
  const sel = `[data-cell="${activeCell.value.ci}"][data-pid="${activeCell.value.pid}"]`
  const el = scrollEl.value.querySelector(sel)
  if (el && el.focus) el.focus()
  else setTimeout(() => { const e2 = scrollEl.value && scrollEl.value.querySelector(sel); if (e2 && e2.focus) e2.focus() }, 60)
}
function onBodyKey(e) {
  const arr = flatItems.value
  const rowItems = arr.filter(it => it.kind === 'row')
  if (!rowItems.length) return
  let cur = arr.findIndex(it => it.kind === 'row' && it.r.product_id === activeCell.value.pid)
  if (cur < 0) cur = arr.indexOf(rowItems[0])
  let ri = cur, ci = activeCell.value.ci
  const cols = colOrderList.value.length
  if (e.key === 'ArrowDown') { ri = Math.min(arr.length - 1, ri + 1); while (ri < arr.length && arr[ri].kind !== 'row') ri++; e.preventDefault() }
  else if (e.key === 'ArrowUp') { ri = Math.max(0, ri - 1); while (ri >= 0 && arr[ri].kind !== 'row') ri--; e.preventDefault() }
  else if (e.key === 'ArrowRight') { ci = Math.min(cols - 1, ci + 1); e.preventDefault() }
  else if (e.key === 'ArrowLeft') { ci = Math.max(0, ci - 1); e.preventDefault() }
  else if (e.key === 'Enter') {
    const it = arr[ri]
    if (it && it.kind === 'row') {
      const uStart = visibleCols.value.length, uEnd = uStart + unitCount()
      if (ci >= uStart && ci < uEnd) editCell(it.r.product_id, cross.value.units[ci - uStart].name)
      else toggleExpand(it.r.product_id)
    }
    e.preventDefault()
  } else if (e.key === ' ') { const it = arr[ri]; if (it && it.kind === 'row') toggleExpand(it.r.product_id); e.preventDefault() }
  else return
  const it = arr[ri]
  if (it && it.kind === 'row') { activeCell.value = { pid: it.r.product_id, ci }; selectedPid.value = it.r.product_id; scrollToIndex(ri); nextTick(focusActive) }
}

/* ---- 列配置（商品名称固定冻结不可隐藏；其余列可隐藏/删除/拖拽排序，存 localStorage） ---- */
// 主档字段列元数据（除名称外）。name 列固定且不在此列表（单独处理）。
/* v177（2026-09-16）：本表移除五列 —— 标准售价(sale_price) / 安全库存(safety_stock) /
   保质期天(expiry_days) / 起订量(moq) / 到货天数(lead_days)。预报订单场景只需要「报什么、
   报多少」，这五个字段是**商品档案的属性**，不是报单决策的输入；它们的维护入口在
   「商品档案」页，不靠报单网格承担。
   ⚠️ 这里是**唯一**决定「哪些列渲染」的地方（visibleCols / 列设置菜单 / 添加列候选 /
   表尾合计 / 导出 xlsx 全部由它派生），故删这五行 = 五个面同时收起，无需改别处。
   ⚠️ **只删显示列，不删数据字段**：行对象仍带 r.safety_stock / r.expiry_days / r.moq /
   r.lead_days / r.sale_price，商品主档 upsert 载荷(DRAFT_MASTER_KEYS / prodRows)、
   粘贴与导入的表头映射(HEADER_KEYS)、以及依赖这些数据的功能（低于安全库存告警、
   短保告警、安全库存建议、AI 分析这一行）一律保持不变。 */
/* v184：新增「到货周期」**固定列**（诉求：一眼看出每个单品 +几天到货）。
   · 字段来源：`products.arrival_lead_days`（物理列，v109 迁移，DEFAULT 0）。
     ⚠️ 它**不是** `products.lead_time_days`（补货算法的提前期，默认 7，进安全库存/补货点公式），
        也不是品牌级的 `rebate_target_rules.order_cadence_days`（每几天到货一次的**频率**）。
        三者是三个量，别混用；本列 = 「下单后第几天到货」的**提前天数**。
   · 写入口有**两个**（结果落同一列，展示走同一个 `arrivalCycleText`）：
     ① 预报订单导入的「到货周期」列（后端 `_re_rhythm` 解析「+3天」/「+3到货」）；
     ② 「商品档案」页该列的行内编辑（v184b 新增，`PUT /api/products/{id}`）。
     故本网格里本列**只读**（`edit:'ro'`）—— 在网格里摆一个存不下去的输入框就是「假旋钮」；
     要改值去「商品档案」，也就是下面右键提示语让用户去的地方。
   · 展示：`+3天`；空/0 → `—`。**不做「继承品牌默认」**：那会让同一格有两个来源，
     与「同屏数字口径必须同源」冲突；要默认值就在导入时填、或在商品档案里设。
   · 位置：数组首位，使 defaultColOrder 里它紧跟「商品名称」；`visibleCols` 另有**强制归位**
     （固定列必须构成左侧连续区，否则按宽度累加出来的冻结偏移会算到别的列头上）。 */
/* v184b：文案函数已移到 `utils/arrival.js`（本文件顶部 import）——
   商品档案页也要显示同一个值，留两份就是第二份拷贝。 */
const MASTER_COL_DEFS = [
  /* v192：本列**可隐藏**（`hideable: true`）—— 用户要能在列设置里把它勾掉、也能右键「隐藏此列」。
     注意它**仍然是固定列**：依旧钉在左侧、依旧不可删除（`deletable: false`），
     「可隐藏」只解掉「不可隐藏」这一条。隐藏后冻结区不留空缺 —— 偏移由 frozenLeftOf/frozenRight
     按**实际渲染的固定列**累加（见那两处注释），这也是它敢被隐藏的前提。 */
  { key: 'arrival_lead_days', label: '到货周期', cls: 'fc-text fc-cycle', edit: 'ro', fixed: true, hideable: true, deletable: false,
    fmt: r => arrivalCycleText(r.arrival_lead_days) },
  { key: 'brand', label: '品牌', cls: 'fc-text', edit: 'text', deletable: true },
  { key: 'barcode', label: '条码', cls: 'fc-code', edit: 'text', deletable: false },
  { key: 'spec', label: '规格', cls: 'fc-text', edit: 'text', deletable: true },
  { key: 'unit', label: '单位', cls: 'fc-text', edit: 'text', deletable: true, options: ['件', '箱', '提', '杯', '袋', '瓶', '盒', '托', '板', '根'] },
  // v184d：删除原「进价」列（绑 purchase_price）—— 它与「单价(进价)」列显示的是**同一个数**（v226 起两列合一），
  //   属重复列。删列≠删数据：行对象 r.purchase_price / 导入解析 / 草稿 / 保存载荷一律保留，
  //   报单金额仍按进价口径计算（见 factoryPrice）。仅从 MASTER_COL_DEFS 与列权限表移除。
  { key: 'dist_price', label: '分销价', cls: 'fc-num', edit: 'num', deletable: false, fmt: r => r.dist_price ? r.dist_price.toFixed(2) : '—' },
  { key: 'product_code', label: '厂家编码', cls: 'fc-code', edit: 'text', deletable: false },
]
const COL_STORAGE_KEY = 'forecast_cols_v1'
// colOrder: 完整列顺序（含 name）。colVis: key->bool 是否显示。
const defaultColOrder = () => [{ key: 'name', label: '商品名称', fixed: true, cls: 'fc-name' }].concat(
  MASTER_COL_DEFS.map(c => ({ key: c.key, label: c.label, cls: c.cls }))
)
const colOrder = ref(defaultColOrder())
const colVis = ref({ name: true })
const showColMenu = ref(false)

function _persistCols() {
  try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify({ order: colOrder.value, vis: colVis.value })) } catch (e) {}
}
function loadCols() {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY)
    if (!raw) return
    const p = JSON.parse(raw)
    if (p.order && Array.isArray(p.order)) {
      // 合并新增的主档列（若元数据有新增而存储没有）
      const have = new Set(p.order.map(c => c.key))
      const merged = p.order.filter(c => c.key === 'name' || c.custom || MASTER_COL_DEFS.find(m => m.key === c.key))
      /* v184：新列落位分两类 —— **固定列**插到「商品名称」之后（它参与左侧冻结区的宽度累加，
         位置错 = 冻结偏移错），普通新列仍追加到末尾（不打乱用户已排好的顺序）。
         ⚠️ 老用户的 localStorage 里没有新固定列，走的正是这条 splice 分支。 */
      MASTER_COL_DEFS.forEach(m => {
        if (have.has(m.key)) return
        const item = { key: m.key, label: m.label, cls: m.cls }
        if (m.fixed) {
          const ni = merged.findIndex(c => c.key === 'name')
          merged.splice(ni < 0 ? 0 : ni + 1, 0, item)
        } else merged.push(item)
      })
      // 确保 name 在第一且 fixed
      const nameFirst = merged.find(c => c.key === 'name')
      if (nameFirst) { nameFirst.fixed = true; nameFirst.label = '商品名称' }
      colOrder.value = merged
    }
    if (p.vis) colVis.value = Object.assign({ name: true }, p.vis)
  } catch (e) {}
}
loadCols()

// 品牌下拉候选（来自 brands 档案表）：编辑网格品牌列以 datalist 形式提供候选，同时允许手填新建（决策②）
const brandOptions = ref([])
async function loadBrandOptions() {
  try {
    const list = await api('/api/brands?include_inactive=1')
    brandOptions.value = (Array.isArray(list) ? list : []).map(b => b.name).filter(Boolean)
  } catch (e) {}
}

// 当前可见列（按 colOrder 过滤 colVis），用于双视图渲染
const visibleCols = computed(() => {
  const defMap = {}
  MASTER_COL_DEFS.forEach(m => { defMap[m.key] = m })
  const arr = colOrder.value
    .filter(c => c.key === 'name' || colVis.value[c.key] !== false)
    .filter(c => c.key === 'name' || canSeeCol(c.key))   // 列级权限：角色无权的列直接剔除
    .map(c => {
      if (c.key === 'name') return { key: 'name', label: '商品名称', fixed: true, cls: 'fc-name' }
      const m = defMap[c.key] || {}
      const opts = c.key === 'brand' ? (brandOptions.value && brandOptions.value.length ? brandOptions.value : m.options) : m.options
      // v184：fixed 由 MASTER_COL_DEFS 决定（此前写死 false ⇒ 任何新列都进不了冻结区）
      return { key: c.key, label: c.label, cls: c.cls || m.cls, fixed: m.fixed === true,
        edit: c.edit || m.edit, deletable: c.deletable !== undefined ? c.deletable : m.deletable,
        fmt: m.fmt, options: opts, custom: !!c.custom }
    })
  /* v184：固定列**强制归位**到最左侧、且按 FROZEN_COLS 的次序。
     为什么不能只靠 defaultColOrder / loadCols 管顺序：用户可以拖列、老 localStorage 里
     也可能是任意顺序，而冻结偏移是按「固定列宽度依次累加」算的 —— 固定列一旦不连续或
     次序颠倒，left 就会落到别的列头上（冻结列错位/互相遮挡，且不报错）。
     在此排序 = 把「固定」做成**渲染期不变式**，不依赖数据碰巧正确。 */
  const fixedPart = FROZEN_COLS.map(k => arr.find(c => c.key === k)).filter(Boolean)
  const rest = arr.filter(c => !FROZEN_COLS.includes(c.key))
  return [...fixedPart, ...rest]
})
const addableMasterCols = computed(() => MASTER_COL_DEFS.filter(m => !colOrder.value.find(c => c.key === m.key)))

/* ---- 列级权限（角色可见性网关）----
   借鉴企业微信智能表格「字段列级权限」。敏感列(分销价)按业务角色可见。

   🔴 2026-09-19 收敛：本层此前用 owner / finance / promoter / dealer 这套**后端并不存在**的角色名，
      而 `bizRole` 取的却是登录角色／localStorage —— 两套词汇永不相等。后果是：一旦真把登录角色
      接进 `store.user.role`，分销价列会对**所有真实角色（含老板）**隐藏，而且没人能从界面上找回来。
      现统一到后端规范角色名（唯一来源 = src/constants/roles.js，权威源 = 后端 core._DEFAULT_PERMS）；
      历史视图令牌经 `normRole` 归一后照旧命中，行为不变。

   ⚠️ **本层目前是空转的**：全仓**没有任何地方给 `store.user.role` 赋值**（Shell.vue 只同步了
      `user.name`）⇒ `bizRole` 实际只会取到 localStorage('hergent_biz_role') 的遗留值或默认值，
      两者都指向「全可见」。也就是说「列级权限」现在既不隐藏任何列、也不构成任何保护。
      ⇒ 日后若把登录角色接进 `store.user.role`，本表会**立刻生效**：届时需确认各角色该看哪些列（业务决定）。

   ⚠️ 且本层**只是前端展示级隐藏**（列头、导出、接口照旧）——真正的列级隔离必须做在后端
      DataSourceAdapter 的字段过滤上，否则只是安全幻觉。 */
const BIZ_ROLE_KEY = 'hergent_biz_role'
// 只接受「已知令牌」（后端规范角色 或 历史视图令牌）。未知值一律忽略 ——
// 否则一个拼错的遗留值就能静默藏掉一列，且无处可改。
function _knownRoleToken(t) {
  const k = String(t || '').trim()
  if (!k) return ''
  return (isCanonicalRole(k) || Object.prototype.hasOwnProperty.call(ROLE_VIEW_TOKEN_NAMES, k)) ? k : ''
}
const bizRole = ref((store.user && store.user.role) || _knownRoleToken(localStorage.getItem(BIZ_ROLE_KEY)) || 'boss')
function setBizRole(r) {
  // ⚠️ 当前**无 UI 入口**（按身份预览的切换器已撤），保留以备复用。
  //    SOURCE 优先级：store.user.role > localStorage > 'boss' —— 改动此处等于改动上面那行。
  bizRole.value = r
  try { localStorage.setItem(BIZ_ROLE_KEY, r) } catch (e) {}
  if (store.user) store.user.role = r
}
// 列权限：key -> 允许查看的**规范角色名**（见 constants/roles.js）；未列出的列所有人可见
// v184d：purchase_price 的列权限随该列一并移除（v226 起它已不单独成列）—— 列不渲染，权限是死配置。
// 2026-09-19：`owner`/`finance` 两个不存在的角色名 → `boss`/`accountant`（原意「老板 + 会计」），
//   并补 `admin`（后端 `_DEFAULT_PERMS['admin'] = ['*']`，管理员本应全见）。
const COLUMN_PERMISSIONS = {
  dist_price: ['admin', 'boss', 'accountant'],                          // 分销价（毛利相关）
}
function canSeeCol(key) {
  const allow = COLUMN_PERMISSIONS[key]
  if (!allow) return true
  const r = normRole(bizRole.value)
  // 角色未知/未配置 ⇒ **不隐藏**。本层既然不是安全边界（见上），失败方向就取「宁可多显示」：
  // 静默藏掉一列而用户没有任何入口把它找回来，是比多显示更坏的故障。
  if (!isCanonicalRole(r)) return true
  return allow.includes(r)
}

/* v184：**固定列默认不可隐藏、不可删除** —— 左侧冻结区的偏移是「按固定列宽度依次累加」
   算出来的，某列一旦被隐藏，冻结区就出现断层，其后冻结列的 left 会落在不存在的宽度上
   （表现为后面几列错位/互相遮挡）。规则**只此一份**，toggleCol / quickHide / 两个列设置菜单共用。

   v192：新增**例外通道** `hideable` —— 固定列在 MASTER_COL_DEFS 里显式声明 `hideable: true`
   就允许被用户隐藏（本轮：到货周期）。之所以现在才敢开这个口子，是因为冻结区偏移已改为按
   **实际渲染出来的固定列**累加（frozenLeftOf / frozenRight）—— 列被隐藏就不再占位，断层问题
   在根上消掉了；否则「中间那个固定列被藏起来」必然把后面所有冻结列的 left 算错。
   ⚠️ 隐藏 ≠ 解除冻结：重新显示时它照旧钉在原位（left 由 frozenLeftOf 现算）。
   ⚠️ 「可隐藏」不波及「可删除」：能否删除仍单独归 deletable / 服务端注册表管（见 canDeleteMaster）。 */
function isLockedCol(key) {
  if (key === 'name') return true
  if (!FROZEN_COLS.includes(key)) return false
  const m = MASTER_COL_DEFS.find(x => x.key === key)
  return !(m && m.hideable === true)
}
function _colLabel(key) { return (MASTER_COL_DEFS.find(m => m.key === key) || { label: key }).label }
function toggleCol(key) {
  if (isLockedCol(key)) { toast('「' + _colLabel(key) + '」是固定列，不能隐藏', 'warn'); return }
  // colVis[key]: undefined/true=显示, false=隐藏。点击切换为相反态。
  colVis.value[key] = colVis.value[key] === false ? true : false
  _persistCols()
}
function quickHide(key) {
  if (isLockedCol(key)) { toast('「' + _colLabel(key) + '」是固定列，不能隐藏', 'warn'); return }
  const m = MASTER_COL_DEFS.find(x => x.key === key)
  if (m && m.deletable) {
    // 主档可删列：从 colOrder 移除（同时隐藏）
    colOrder.value = colOrder.value.filter(c => c.key !== key)
    delete colVis.value[key]
  } else {
    colVis.value[key] = false
  }
  _persistCols()
}
function addMasterCol(key) {
  if (colOrder.value.find(c => c.key === key)) { colVis.value[key] = true; _persistCols(); return }
  const m = MASTER_COL_DEFS.find(x => x.key === key)
  if (!m) return
  // 插在 name 之后、客户列之前
  const idx = colOrder.value.findIndex(c => c.key === 'name')
  colOrder.value.splice(idx + 1, 0, { key: m.key, label: m.label, cls: m.cls })
  colVis.value[key] = true
  _persistCols()
}
/* v197（P1-2b）：删主档列同样会让「可见列总数」-1 ⇒ 选区/锚点可能落到列号之外。
   这里**不需要**加「至少保留一列」守卫：内置列里只有 品牌/规格/单位 三列 `deletable: true`，
   条码/分销价/厂家编码 由服务端 PROTECTED_COLUMNS 挡住、到货周期 由 canDeleteMaster 的本地
   硬否决挡住、商品名称是固定列不进删除菜单 —— 7 个内置列删不空，表体不会失去「商品」这一维。 */
function deleteMasterCol(key) {
  colOrder.value = colOrder.value.filter(c => c.key !== key)
  delete colVis.value[key]
  _persistCols()
  clampSelection()
}
// 拖拽排序
let _dragFrom = -1
function onColDragStart(ci) { _dragFrom = ci }
function onColDrop(ci) {
  if (_dragFrom < 0 || _dragFrom === ci) return
  const arr = colOrder.value
  const [moved] = arr.splice(_dragFrom, 1)
  arr.splice(ci, 0, moved)
  _dragFrom = -1
  _persistCols()
}


/* ---- 交叉表编辑（改数量/改名/增删行列 → 保存重写本期导入数据） ---- */
// Q12：进入编辑要拉全量商品主档 + 期次汇总，原实现期间按钮无禁用、无骨架屏，
// 大数据量下白屏等待，用户会重复点击。
const loadingEdit = ref(false)
/* Q30：填报权限前置提示。可填报角色白名单（与列级权限同一套角色体系）。
   其余角色不硬禁用（避免误伤有后端权限的账号），改为点击时二次确认 + 说明。
   2026-09-19：白名单改用**后端规范角色名**并补 admin —— 原词表 owner/finance/dealer 在后端都不存在，
   与列级权限同一处漂移；`dealer`（经销商）没有对应后端角色（本租户主体就是经销商）。
   比对前先 normRole 归一，历史视图令牌（owner/finance/…）照旧命中，行为不变。 */
const ENTRY_ROLES = ['admin', 'boss', 'accountant', 'sales']
const entryRoleWarn = computed(() => !ENTRY_ROLES.includes(normRole(bizRole.value) || 'boss'))
/* v219：当期期次是否已定稿（关闭）。三处「改单」按钮与 `enterEdit` 共用**这一个**判据 ——
   判据散在四处迟早会漂移（一处漏判 = 用户能改但保存被拒 = 白干半天）。
   ⚠️ 与后端 `save_matrix` 闸门**同源**：`pid>0 且 status !== 'open'`；
   「今日报单」（无期次，id=0）不算定稿态，照常可改。 */
const periodClosed = computed(() => {
  if (!curPeriod.value) return false
  const _p = periods.value.find(x => Number(x.id) === Number(curPeriod.value))
  return !!(_p && _p.status && _p.status !== 'open')
})

async function enterEdit() {
  /* v219：已定稿（关闭）的期次不许进编辑态。
     后端 `save_matrix` 已有硬闸门（409 + 中文文案），这里是 UX 层提前拦 ——
     否则用户改半天才在保存时被拒，白干。 */
  if (periodClosed.value) {
    toast('该期次已定稿（关闭），不可改单。如需改动，请到「往期预报」里先点「重开」。', 'warn')
    return
  }
  /* v244：没有进行中的期次时**不许进编辑态** —— 否则用户改半小时、点保存才被拒（白干）。
     既定方案的判据同向：「📌 禁用 + 说明好过『点了弹错误』」（§五 阶段 0）。
     后端 `save_matrix` 的 v244 闸是最终约束，这里是同一判据的 UX 层提前拦。 */
  if (noOpenPeriod.value) { toast(saveBlockedReason.value, 'warn'); return }
  // Q30：角色不在填报白名单时前置告知（不阻断，避免误伤）
  if (entryRoleWarn.value) {
    const ok = window.confirm(`当前角色「${roleName(bizRole.value)}」可能没有填报权限，保存时可能被服务器拒绝。\n\n仍要进入编辑吗？`)
    if (!ok) return
  }
  if (loadingEdit.value) return
  // 编辑网格渲染在交叉表区域内，无论从哪个视图点进来都先切到交叉表视图
  viewMode.value = 'cross'
  editMode.value = true
  initKbdHelp()          // Q28：首次进入编辑自动展开一次快捷键说明
  loadingEdit.value = true
  try { await loadEditGrid() } finally { loadingEdit.value = false }
  // 进编辑态即自动跑一次全表校验，让「待修正」角标立即显示，无需手动点「查错」
  errCount.value = validateAll().length
}

async function loadEditGrid() {
  // 编辑网格 = 全量商品主档（叠加本期预报量），让粘贴/新增的商品保存后仍在表里
  let p = null
  if (curPeriod.value) p = periods.value.find(x => Number(x.id) === Number(curPeriod.value)) || null
  if (!p) {
    const _d = new Date()
    const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`
    p = { id: 0, name: '今日报单', order_start: today, order_end: today, arrival_date: '', arrival: '' }
  }
  /* v212（P2-1/P2-2）：上期「按客户」数量的缓存**随期次变** ⇒ 每次重进编辑网格先清空重取。
     （守卫 `prevUnitsLoaded` 的语义是「这一次加载取过了」，不是「这个会话取过了」——
      留着跨期次的旧数会让候选与软警告那**别的期次**的数去比，比不提示更糟。） */
  prevUnitsLoaded.value = false
  prevUnitMap.value = {}
  prevUnitsPeriod.value = ''
  try {
    const [prods, d] = await Promise.all([
      productsApi.grid(),
      forecastApproveApi.summary('', p.order_start || '', p.order_end || '', p.id || 0),
      /* v213：校验规格（上限 + 五类文案）。**并发**取 —— 单加一次串行请求会让「改单」变慢。
         失败由 loadValidationSpec 内部吞掉（沿用默认口径），不会让整个加载失败。 */
      loadValidationSpec(),
    ])
    confirmInfo.value = (d.confirmed || null)
    /* v213-B1：记下「我打开这张矩阵时看到的版本」——保存时原样回传（见 saveEdits 的 base_rev）。
       ⚠️ 必须在这里取（进编辑态的那一刻），不能在保存前现取 —— 现取永远等于当前值，
          那样乐观锁就恒不触发（等于没做）。 */
    matrixRev.value = d.matrix_rev || ''
    matrixAt.value = d.matrix_at || ''
    matrixBy.value = d.matrix_by || ''
    const srcByPid = {}
    const units = []
    const _seenUnit = new Set()
    // ① 跨期持久的客户名册：即使当期无报单，也保留客户列（与后端占位机制互补）
    ;(d.all_units || []).forEach(name => {
      if (name && !_seenUnit.has(name)) { _seenUnit.add(name); units.push({ name, role: '' }) }
    })
    // ② 当期来源：补齐 quantity 与 role（当期有报单的客户优先带角色/数量）
    // 2026-09-13：sources 改为合并而非覆盖（后端已对齐主档单位，同商品正常单行；此处为防御性聚合，
    //   避免同商品多行时后一行覆盖前一行导致各客户报单量丢失）。
    ;(d.rows || []).forEach(r => {
      const prevSrc = srcByPid[r.product_id]
      srcByPid[r.product_id] = prevSrc ? [...prevSrc, ...(r.sources || [])] : (r.sources || [])
      ;(r.sources || []).forEach(s => {
        const name = s.store || s.store_name || '未署名'
        if (!_seenUnit.has(name)) {
          _seenUnit.add(name); units.push({ name, role: s.role || '' })
        } else {
          const u = units.find(u => u.name === name)
          if (u && !u.role && s.role) u.role = s.role
        }
      })
    })
    // 行级加单（业务经理按进度追加）：从 summary 的 extra_qty 注入每行（同商品多行时累加）
    const extraByPid = {}
    ;(d.rows || []).forEach(r => {
      if (r.product_id) extraByPid[r.product_id] = (extraByPid[r.product_id] || 0) + (r.extra_qty || 0)
    })
    /* v190：本期手工单价（元/箱）—— 与加单**同源**（同一个 summary 的 rows / 同一张
       `forecast_extra_qty` 表），同样按期次隔离，这正是「只在本期生效」。
       ⚠️ 取**非空值**而非累加：加单是「量」可以累加，单价是「价」——
       同商品多行累加会算出 2 倍价。前端判据 `> 0` 与后端「非正数归 NULL」一致。 */
    const casePriceByPid = {}
    ;(d.rows || []).forEach(r => {
      const cp = Number(r.case_price)
      if (r.product_id && cp > 0) casePriceByPid[r.product_id] = cp
    })
    /* v191b：**沿用价**（只读参考值）—— 后端 summary 下发的 `last_case_price`
       （= 本期之前最近一次录入过的价）＋ 那条记录的期次标签，供占位与 title 说明来源。
       ⚠️ 与 casePrice **分开两个字段**，因为它：
         · 不进 save-matrix 载荷（**不落库**，「没填」不会被保存成「填过」）；
         · 不进 `DRAFT_MASTER_KEYS`（服务端下发的只读值，不该被本地草稿覆盖）。
       取**非空值**而非累加：价不能累加（同 casePrice 的判据）。 */
    const casePriceInheritByPid = {}
    ;(d.rows || []).forEach(r => {
      const lp = Number(r.last_case_price)
      if (r.product_id && lp > 0 && !casePriceInheritByPid[r.product_id]) {
        casePriceInheritByPid[r.product_id] = {
          v: lp, label: inheritPeriodLabel(r.last_case_period_start, r.last_case_period_end),
        }
      }
    })
    // v179：编辑态行底与查看态**同源**（规则与注释见 loadCross 同段 / buildRowBase）——
    //   只列「本期导入登记的商品 ∪ 有报单的商品」（含已停用的），勾「显示全部商品」回到全量。
    // 🔴 两处必须用同一条规则：查看态看到 158 行、一进编辑却铺 285 行，用户会以为
    //    「改单把表撑大了」—— 这正是「同屏数字口径必须同源」在行底上的形态。
    const allProds = prods.items || []
    /* v211（P1-1）：商品名称补全候选随主档一起落。**两处赋值点缺一不可** ——
       这里是「已导入/有报单」那一支，另一支在默认行底分支（下方同款语句）。
       只喂一处 ⇒ 某些期次进编辑态后候选空着，而用户看不出「为什么这次没提示」。 */
    masterNameOptions.value = buildNameOptions(allProds)
    const importedProducts = d.imported_products || []
    const importedSet = new Set(importedProducts.map(p => Number(p.id)))
    const rowBase = buildRowBase(allProds, importedProducts, d.rows || [], showAllProducts.value)
    // v202：记下行底原始顺序（＝ 导入模板序 + 无导入序那批的稳定尾随）。
    //   `applySort()` 切回「默认」时按它恢复 —— 这是**编辑态**的那个赋值点。
    rowBaseOrder.value = rowBase.map(p => Number(p.id))
    let rows = rowBase.map(pd => {
      const qtyByUnit = {}
      ;(srcByPid[pd.id] || []).forEach(s => {
        const name = s.store || s.store_name || '未署名'
        qtyByUnit[name] = (qtyByUnit[name] || 0) + (s.qty || 0)
      })
      return {
        // v161：自定义列的值随 grid 一起回来（服务端权威，按 product_id）。
        // 放在最前，便于一眼看出"这些键不是写死的列，而是列注册表里的自定义列"。
        ...(pd.extra || {}),
        product_id: pd.id, name: pd.name, barcode: pd.barcode || '', spec: pd.spec || '', unit: pd.unit || '件',
        /* v222：三级单位换算随行带上 —— 它是 `perCase` 的**唯一权威数据源**。
           🔴 **两条加载路径（loadCross / 本处 loadEditGrid）都要带**：漏一处那一态的箱数就退回
              规格串解析，出现「查看态 1 箱、编辑态 0.035 箱」这种同屏两个口径。
           判据是 `large_ratio > 0`，**不是** `has_multi_unit`（实测该标志位漏标 9 条）。 */
        large_unit: pd.large_unit || '', large_ratio: Number(pd.large_ratio) || 0,
        medium_unit: pd.medium_unit || '', medium_ratio: Number(pd.medium_ratio) || 0,
        /* v240：报单默认单位（`products.order_unit`）随行带上 —— 与换算字段同一条「两条加载路径
           都要带」的纪律：漏一处，那一态的新增单据就带不出单位（静默回退档案单位）。 */
        order_unit: pd.order_unit || '',
        sale_price: pd.sale_price || 0, purchase_price: pd.purchase_price || 0,
        /* v190：进价必须随行带上 —— 此前**两处行映射都漏了它**，而 factoryPrice(r) 优先读
           `r.factory_price` ⇒ 前端实际永远回退到进价，与后端 db.factory_price_sql
           （`factory_price` 优先、缺则取 `purchase_price`）不是同一个数：档案里两列不相等的商品，
           本页「单价(进价/箱)」与报单金额都和后端算的对不上。
           ⚠️ 两条加载路径（loadCross / **本处 loadEditGrid**）**都要带**，漏一处就有一态算错。
           本处是**编辑网格**的数据源 —— 没有它，单价框只能退回进价算（自动价整列错）。 */
        factory_price: Number(pd.factory_price) || 0,
        safety_stock: pd.safety_stock || 0, expiry_days: pd.expiry_days || 0,
        product_code: pd.product_code || '', dist_price: pd.dist_price || 0,
        /* v178：品牌/品类是商品档案字段，此前这条行映射里漏了 —— 编辑网格的品牌列**只有「草稿恢复」
           一条路能拿到值**（草稿是 loadCross 存的整份 cross，行里带 brand），一旦草稿被清
           （「放弃修改」/换期次/首次使用）品牌列就整列空白。
           且「条码重复」必须按品牌判定（同产品两个户头不算重复），判据不能建立在本地草稿的残留上。 */
        category: pd.category || '', brand: pd.brand || '',
        /* v184：到货周期 —— 后端 /api/products/grid 下发的 products.arrival_lead_days。
           0 或缺 = 未设置 ⇒ 该格显示「—」。本列只读，**不进 prodRows 的保存载荷**
           （写入口是导入；网格保存的白名单里没有它，带上去也会被后端丢弃）。 */
        arrival_lead_days: Number(pd.arrival_lead_days) || 0,
        price: pd.sale_price || 0, qtyByUnit, extraQty: extraByPid[pd.id] || 0,
        /* v190：本期手工单价 —— 编辑态的**草稿初始值**。没有它，刷新或换个人打开改单网格时
           单价框会回到灰色自动价（明明存过），用户会以为「保存没生效」。 */
        casePrice: casePriceByPid[pd.id] || null,
        /* v191b：**沿用价**（本期未录入时自动带出的「最近一次录入过的价」）＋ 来源期次标签。
           两者都是**只读**：不参与 save-matrix 载荷、不进草稿键 —— 见上方 casePriceInheritByPid 注释。 */
        casePriceInherit: (casePriceInheritByPid[pd.id] || {}).v || null,
        casePriceInheritPeriod: (casePriceInheritByPid[pd.id] || {}).label || '',
        ai: null, suggest: 0, history: [],
        // v179：本行是否来自「本期导入登记」（表格角标用；来源是后端台账，非前端推测）
        imported: importedSet.has(Number(pd.id)),
        // v179：不在「在售档案」里（已停用/已删除）但被本期引用 —— 见 buildRowBase 注释
        offArchive: !!pd.offArchive,
      }
    })
    let colTotals = units.map(u => rows.reduce((s, r) => s + (r.qtyByUnit[u.name] || 0), 0))
    /* v196（P0-2）：抓「服务端权威」基线 —— **必须在草稿合并之前**
       （紧接下面的 loadDraft() 会就地改 rows：`r[k] = d[k]`，还可能有补回来的新增行）。
       ⚠️ 若挪到函数末尾（草稿已合入）再抓：草稿里未提交的商品档案改动会被当成
          "本来就长这样" ⇒ 保存时静默漏发，用户改了名称/条码/品牌，保存完一看没生效。
       ⚠️ 只收 product_id>0 的行：无档案号 = 新增行，基线里不该有它（有就等于"已存在"，
          保存时会被判成"没改过"而漏建商品）。
       ⚠️ 两条分支（有草稿 / 无草稿）共用这一处 —— 别再在下面那个 `cross.value = {` 前补一份。 */
    prodBaseline.value = new Map(
      rows.filter(r => Number(r.product_id) > 0).map(r => [Number(r.product_id), prodPayloadOf(r)])
    )
    cross.value = {
      period: p, units, rows, colTotals,
      rowBaseTotal: allProds.length,   // v179：收窄前行数（= 在售商品档案总数）
      grand: { sku: rows.length, qty: rows.reduce((s, r) => s + Object.values(r.qtyByUnit).reduce((a, b) => a + (parseInt(b) || 0), 0), 0), amount: 0 },
      reportedUnits: units.length,
      /* v199：每次重新加载都从空开始。loadEditGrid 每次**进入编辑态**都会被调用
         （v208 起保存成功后不再重载网格 —— 改为退出编辑态、回只读），
         此时服务端的隐藏名册已生效、`all_units` 里已不含被删的列 ⇒ 待提交集合必须清空，
         否则下一次进编辑再保存会把同一批名字**再提交一遍**（虽然后端幂等、结果一样，
         但语义是错的：「本次界面删了哪些列」是一个**增量**，不是累计状态）。 */
      hiddenUnits: [],
    }
    // 恢复本地草稿（未提交数据），但绝不允许草稿冲掉服务端客户列：
    // 列集始终以服务端 all_units 为准，草稿仅叠加单元格值 + 补回本地新增列。
    const dr = loadDraft()
    /* v201 补：留一份「服务端内容」快照 —— **必须在下面对 rows / units 就地覆盖之前**。
       它就是「回退」按钮在有草稿时的落点（＝放弃本次草稿的全部改动，回到服务端内容）。
       🔴 不能图省事改成"合并完再 `clone(cross.value)`（后置捕获）"：草稿恢复是**就地改**
          rows（`r[k] = d[k]`）并往 units 里补列，赋值对象与这些数组是**同一份引用**，
          事后 clone 拿到的已经是"草稿内容"，拿它当基线 ⇒ 「回退」点了等于没点。
       ⚠️ 只在**真有草稿**时创建：无草稿分支自己会取一份，别在这里白白全表序列化两次
          （428 行 × 30 列）。 */
    const preDraftSnap = (dr && dr.rows && dr.rows.length) ? clone(cross.value) : null
    if (dr && dr.rows && dr.rows.length) {
      // 1) 草稿里服务端没有的本地新增列（如右键加列未提交）补回来
      ;(dr.units || []).forEach(du => {
        const nm = du && du.name ? du.name : du
        if (nm && !_seenUnit.has(nm)) { _seenUnit.add(nm); units.push({ name: nm, role: (du && du.role) || '' }) }
      })
      /* 2) 用草稿值覆盖（草稿 = 用户最新未提交编辑），按列名对齐到服务端列集。
         Q14：原实现只恢复 qtyByUnit 数量，主档字段（名称/规格/价格…）的本地编辑与
         粘贴/新增的商品行在刷新后全部丢失，但横幅却宣称「已恢复未完成数据」→ 误导。
         现补充：① 恢复主档字段；② 草稿里有、服务端商品库没有的新增行追加回来。 */
      const DRAFT_MASTER_KEYS = ['name', 'barcode', 'spec', 'unit', 'sale_price', 'factory_price', 'purchase_price',
        'safety_stock', 'expiry_days', 'product_code', 'dist_price', 'brand', 'moq', 'lead_days', 'extraQty',
        // v190：手工录入的单价也必须随草稿留住 —— 否则用户在改单网格填了箱价、
        //   还没点「保存」就刷新/切期次，填的价会静默消失（金额也跟着变回去）。
        //   `casePrice` 为 null 时不恢复（草稿守卫要求值非空），符合「清空 = 回到自动价」的语义。
        //   ⚠️ 保存成功后草稿会被清掉，此后单价由**服务端**（`forecast_extra_qty.case_price`）
        //   回填 —— 两条路都通，不会出现「保存完刷新反而变回自动价」。
        'casePrice']
      const draftByPid = {}
      const draftByKey = {}
      ;(dr.rows || []).forEach(r => {
        if (r && r.product_id) draftByPid[r.product_id] = r
        const k = String((r && r.name) || '') + '|' + String((r && r.barcode) || '')
        if (!draftByKey[k]) draftByKey[k] = r
      })
      let restoredQty = 0, restoredMaster = 0
      rows.forEach(r => {
        const d = draftByPid[r.product_id] || draftByKey[String(r.name || '') + '|' + String(r.barcode || '')] || null
        const dq = d ? (d.qtyByUnit || {}) : {}
        const merged = {}
        units.forEach(u => {
          const v = (dq[u.name] !== undefined) ? dq[u.name] : (r.qtyByUnit[u.name] || 0)
          merged[u.name] = v
        })
        r.qtyByUnit = merged
        if (d) {
          if (Object.values(merged).some(v => Number(v) > 0)) restoredQty++
          let touched = false
          DRAFT_MASTER_KEYS.forEach(k => {
            if (d[k] !== undefined && d[k] !== '' && String(d[k]) !== String(r[k])) { r[k] = d[k]; touched = true }
          })
          if (touched) restoredMaster++
        }
      })
      // 3) 草稿里有、但服务端商品主档里没有的行（粘贴/新增未保存）补回来
      const haveKeys = new Set(rows.map(r => String(r.product_id || '') + '|' + String(r.name || '') + '|' + String(r.barcode || '')))
      let restoredAdded = 0
      ;(dr.rows || []).forEach(d => {
        if (!d) return
        const k = String(d.product_id || '') + '|' + String(d.name || '') + '|' + String(d.barcode || '')
        if (haveKeys.has(k)) return
        if (!String(d.name || '').trim() && !String(d.barcode || '').trim()) return
        const nr = { ...blankRow(), ...d }
        const q = {}
        units.forEach(u => { q[u.name] = (d.qtyByUnit && d.qtyByUnit[u.name] !== undefined) ? d.qtyByUnit[u.name] : 0 })
        nr.qtyByUnit = q
        nr._new = true
        rows.push(nr)
        haveKeys.add(k)
        restoredAdded++
      })
      colTotals = units.map(u => rows.reduce((s, r) => s + (Number(r.qtyByUnit[u.name]) || 0), 0))
      cross.value = {
        period: p, units, rows, colTotals,
        rowBaseTotal: allProds.length,   // v179：与上方同源（草稿分支也要带上，否则开关一勾数字会跳）
        grand: { sku: rows.length, qty: rows.reduce((s, r) => s + Object.values(r.qtyByUnit).reduce((a, b) => a + (parseInt(b) || 0), 0), 0), amount: 0 },
        reportedUnits: units.length,
        /* v199b 🔴 漏这一行 = v199 上线当天点删列必崩：本分支会**整体替换** cross.value，
           不带上 `hiddenUnits` 它就是 undefined，而 `delCol` 里 `.includes` 直接抛 TypeError。
           ⚠️ 语义与上面那条分支**必须一致**：一次加载 = 待提交集合从空开始（草稿只回放
              单元格值/主档字段/新增行，**不回放 hiddenUnits** —— 它表示「本次界面删了哪些列」，
              是一个增量动作，跨会话累计会把它变成状态，语义就错了）。 */
        hiddenUnits: [],
      }
      draftRestored.value = true
      draftRestoreInfo.value = { qty: restoredQty, master: restoredMaster, added: restoredAdded }
      _ignoreNextWatch = 1
    } else {
      /* v201 补：本次加载**没有**草稿 ⇒ 把"来自草稿"的标记清掉。
         原先不置假：一旦某次加载命中草稿分支，之后即便草稿已被清（另一标签页清、或别的
         清除路径），再加载时横幅仍会宣称「已从本地草稿恢复」—— 状态由**上一次加载的残留**
         决定，而不是本次加载的事实。标记必须和它描述的那次加载同生共死。 */
      draftRestored.value = false
      draftRestoreInfo.value = null
      _ignoreNextWatch = 1
    }
    // v161：自定义列的值已随 grid 的 extra 字段并入上面的行（服务端权威）。
    // 这里只处理一次旧数据迁移：把此前存在本机的值推到服务端 —— **必须 await**，
    // 否则用户紧接着点保存会用空值把刚迁移上去的键删掉（后写覆盖先写）。
    await migrateLegacyCustVals()
    compareOn.value = false
    snapCompare.value = null
    loadSnaps()
    loadSchemes()
    loadSuggestRecipes()
    loadMoq()
    loadNotes()
    loadCloudNotes()
    loadRealtimeWarn()
    /* v212：上期「按客户」数量（候选 + 软警告的共用数据源）。**刻意不 await** ——
       它是参考数据，进编辑网格不该为它多等一次往返；取到后 prevUnitMap 变化会自动驱动
       候选与角标重算，用户感知到的只是「过一下黄角标冒出来」。 */
    loadPrevUnits().catch(() => {})
    loadSubmission()
    loadAuditLog()
    loadGaps()
    loadSafety()
    _alertedThisLoad = false
    /* Q7：编辑态默认分页。原实现强制 pagingOn=false → 全量商品主档（428 行）每行渲染
       约 30 个 input ≈ 1.2 万节点，首屏卡顿、每次输入掉帧。现默认分页（可在分页条切「显示全部」）。 */
    pagingOn.value = true; curPage.value = 0; findIdx.value = -1
    /* v201：给「本次编辑」定一个**起点基线**。
       🔴 为什么必须在这里定，而不是等 saveEdits 时才记：原先只在保存成功后才设基线，
       于是**刚进编辑、什么都没改**时状态条也会显示「有未保存的改动」——
       标记被置真了却没有任何基线能把它比对回来。真机断言 P6 抓到的就是这个：
       进改单立刻显示「有未保存的改动」，而用户一个格子都没动。
       现在起点的语义是**「上次保存时的服务端内容」**，分两态：
         · 没有草稿 / 草稿无实质改动 ⇒ 当前内容就是服务端内容 ⇒ 基线 = 当前内容 ⇒ 「尚未修改」
         · 草稿有实质改动 ⇒ 基线 = 合并草稿**之前**的服务端内容 ⇒ 「有未保存的改动」
       附带两个好处：① 撤销 / 回退回到起点时会自动变干净（refreshDirty 有基线可比）
                    ② 「回退」按钮的可用性改为与状态条**同源**（都看 dirtySinceSave）——
                       不会再出现"状态条说有未保存改动、紧邻的「回退」却是灰的"这种自相矛盾。 */
    if (draftRestored.value) {
      /* ⚠️ 不能因为「读到过草稿」就判脏 —— 草稿内容**完全可能等于服务端内容**：
         进页面时 cross 被填充 → `watch` 800ms 后自动写一份草稿 → 下次进编辑就读到它。
         真机实测正是这种情况：横幅显示「已从本地草稿恢复」，而数量 / 商品资料 / 本地新增
         三项都还是 0（见 `draftRestoreInfo`）。若按"有没有草稿"判，**刚进编辑、什么都没改**
         也会显示「有未保存的改动」（P6 断言抓到的就是这个）。
         ⇒ 改用 `draftRestoreInfo` 的**实质差异计数**判定。 */
      const info = draftRestoreInfo.value || {}
      const real = (Number(info.qty) || 0) + (Number(info.master) || 0) + (Number(info.added) || 0)
      /* 草稿含实质改动 ⇒ 当前内容 ≠ 服务端内容（横幅已如实提示恢复范围）。
         起点基线取**合并草稿之前**的那份服务端快照（preDraftSnap）。
         🔴 这里原先写 `= null`：于是状态条说「有未保存的改动」，紧邻的「回退」（＝丢掉
           这些改动）却是灰的 —— 用户唯一出路只剩"保存"或"取消后重进"，而"取消"并不丢草稿
           （草稿仍在 localStorage，再进来又恢复）。这不是罕见态：**改完没保存就关页面，
           下次进编辑必然命中本分支**。 */
      if (real > 0) {
        lastSavedSnap.value = preDraftSnap
        dirtySinceSave.value = true
      }
    }
    if (!dirtySinceSave.value) {
      /* 走到这里 = 没有草稿，或草稿与服务端完全一致。
         ⚠️ 这两态都**不能**把基线留成 null：refreshDirty() 的前提就是"基线存在"，
            null 会让「撤销回到起点」再也回不到干净态。⇒ 当前内容即服务端内容 ⇒ 基线 = 当前内容。 */
      lastSavedSnap.value = clone(cross.value)
      dirtySinceSave.value = false
    }
  } catch (e) {
    toast('商品清单加载失败: ' + (e.message || ''), 'error')
  }
}

/* v208：退出编辑态的**唯一收口**。两个入口共用，差别只在「要不要问那一句」：
     ① 用户点「取消」 → exitEdit()：有未保存改动时二次确认
     ② 保存成功       → exitEditAfterSave()：**永不确认**（内容刚落库）
   ⚠️ 都是同步返回、**不 await** loadCross()：与「取消」路径保持完全一致的行为。
      若在这里 await，loadCross 的异常会冒泡进 saveEdits 的 try/catch ⇒
      明明保存成功了却弹「保存失败」，是比不刷新严重得多的错。 */
function leaveEdit() {
  editMode.value = false
  loadingEdit.value = false
  errListOpen.value = false   // v174：退出编辑态收起查错面板（否则下次进入会先闪一屏旧结果）
  pagingOn.value = false   // Q7：退出编辑复位分页，read-only 表恢复全量渲染原行为
  loadCross()  // 回到只读 —— 也就是「带『改单』按钮」的那一态
}
function exitEdit() {
  /* Q2：有未保存改动时二次确认，避免误点「取消」让长时间录入白费。
     v201：判据从「撤销栈非空」改为**真实的未保存状态**。原写法在保存成功后仍为真
     （Q5 刻意保留了撤销栈以支持 Ctrl+Z）⇒ 用户保存完点「取消」，会收到
     「放弃本次编辑？未保存的改动将不会提交」—— 改动明明已经提交了，这句是**误导**。 */
  const dirty = dirtySinceSave.value
  if (dirty) {
    const ok = window.confirm('放弃本次编辑？\n\n未保存的改动将不会提交。\n已录入的数量仍存于本地草稿，再次点「编辑」可恢复。')
    if (!ok) return
  }
  leaveEdit()
}
/* v208（2026-09-19 用户拍板）：保存成功 ⇒ 退出编辑态。原话：
   「点击『保存』后，页面应回到带有『改单』按钮的状态，此行为与关闭期次无关……
     可继续点击『改单』，改完再次点击『保存』，支持反复修改，且每次修改都需记录
     并体现在修改日志中。」
   ⚠️ 为什么不复用 exitEdit()：那是「用户主动放弃」的入口，dirty 时会弹
      「放弃本次编辑？未保存的改动将不会提交」—— 内容刚存进去，这句话纯属误导
      （与 v201 修掉的那处是同一个坑，只是入口从「用户点取消」变成「系统自动退出」）。
   ⚠️ 为什么不做成一个带参函数：`@click="exitEdit"` 会把 **MouseEvent** 当第一个实参传进来，
      改签名还得同步改模板，稍不留神就是「取消按钮悄悄跳过确认框」。独立函数零耦合。 */
function exitEditAfterSave() { leaveEdit() }

function rowSum(r) {
  return Object.values(r.qtyByUnit || {}).reduce((s, v) => s + (parseInt(v) || 0), 0)
}

function addRow() {
  snapshot()
  const nr = blankRow()
  nr._new = true                       // Q9：新增行标识（保存后清除）
  cross.value.rows.push(nr)
  const ri = cross.value.rows.length - 1
  /* Q4：原实现把新行 push 到 428 行末尾却既不滚动也不聚焦，
     若开着「仅显示有报单」新行 rowSum=0 还会被直接隐藏 → 用户以为功能坏了。 */
  gotoRowPage(ri)
  nextTick(() => { selectCell(ri, 0); focusCell(ri, 0, { select: true }); scrollRowIntoView(ri) })
  if (hideZeroReport.value) toast('新行已添加（当前开启「仅显示有报单」，填入数量前它属于零报单行）', 'warn')
}

function delRow(ri) {
  const r = cross.value.rows[ri]
  // Q3：原实现无确认直接 splice，误点即丢一行（虽有撤销但用户常不知道）
  if (r && (String(r.name || '').trim() || rowSum(r) > 0)) {
    const ok = window.confirm(`删除商品行「${String(r.name || '').trim() || '（未命名）'}」？\n\n该行的报单数量会一并删除，可用 Ctrl+Z 撤销。`)
    if (!ok) return
  }
  snapshot()
  cross.value.rows.splice(ri, 1)
  // v189：splice 后必须重算 —— 原实现漏了这一步（delRowSoft 有调、delRow 没调），
  //   删行后 grand 会僵在删前的值：同屏「行没了、合计没变」。
  recomputeTotals()
}

/* 新增客户列 —— 全站唯一实现（v170 收敛）
   收敛前有两份拷贝：表头「客户名」输入框的 addCol(ev)，与表头右键「增加列」的
   applyHdrAdd() qty 分支。后者还漏了重名提示（静默 return，用户以为没点上）——
   正是"第二份拷贝 = 静默漂移"的典型。v170 入口从表头迁到工具行「新增客户」弹层，
   两处逻辑一并收敛到本函数。返回是否真的加成功。 */
function addUnit(name) {
  const v = String(name || '').trim()
  if (!v) return false
  if (cross.value.units.find(u => u.name === v)) {
    // Q3：重名原为静默 return，界面毫无反应，用户以为没点上、反复输入
    toast(`客户列「${v}」已存在`, 'warn')
    return false
  }
  snapshot()
  cross.value.units.push({ name: v, role: '' })
  cross.value.rows.forEach(r => { if (!(v in r.qtyByUnit)) r.qtyByUnit[v] = 0 })
  /* v199：**加回列**的入口。若这个名字在「待隐去」集合里 ⇒ 移除它；
     保存时该名会出现在 `customers` 里，后端 save_matrix 反向 DELETE 隐藏记录 ⇒ 列真正回来。
     ⚠️ 这是「删错列」的唯一反悔路径，也是本方案可逆性的关键 —— 必须留在这里，
        否则用户删掉一列后**再也加不回来**（列不在名册里、后端记录也还在）。
     ⚠️ 不用 push 判断「是否已存在」：列本身有重名校验（上方），但集合里可能有**别处**
        留下的同名残留，直接按值剔除最稳。 */
  const hu = hiddenUnits()
  const hi = hu.indexOf(v)
  if (hi >= 0) hu.splice(hi, 1)
  return true
}

function renameCol(ui, newName) {
  const u = cross.value.units[ui]
  const oldName = u ? u.name : ''
  const v = String(newName || '').trim()
  if (!v || v === oldName) return
  if (cross.value.units.find(x => x.name === v)) {
    // Q3：重名静默 return → 用户以为改名没生效
    toast(`客户列「${v}」已存在，改名未生效`, 'warn')
    return
  }
  // 校验通过后才入撤销栈，避免「无变化也产生一条撤销记录」
  snapshot()
  cross.value.rows.forEach(r => {
    if (oldName in r.qtyByUnit) {
      r.qtyByUnit[v] = r.qtyByUnit[oldName]
      delete r.qtyByUnit[oldName]
    }
  })
  u.name = v
}

/* v197（P1-2c）：客户列是这张表**唯一**的「下单对象」维度 —— 删到一列不剩，
   保存载荷的 customers 就成了 `[]`（`saveEdits` 里 `cross.value.units.map(u => u.name)`），
   后端 save_matrix 与小程序报单都会拿到一张「有商品、没有客户」的行集。
   拦在**唯一的删列漏斗**上：三处入口（模板表头 × @899 / 右键菜单 ctxDeleteCol @4116 /
   表头菜单 hdrDeleteCol @4621）全都调本函数 ⇒ 拦一处即全覆盖，这也是不写三份重复判定的原因。
   ⚠️ 顺带补越界守卫：若调用方传进来的 ui 已失效（例如菜单是上一帧渲染的、期间数组被改过），
     `cross.value.units[ui]` 是 undefined，下一行 `u.name` 直接抛异常 —— 而 snapshot() 已经压栈，
     用户按 Ctrl+Z 会撤销掉一个「什么都没发生的快照」，看起来像系统自己乱改数据。 */
function delCol(ui) {
  /* v199b：改用 unitCount() —— `cross.value.units` 在「删期次」等路径上会是 undefined，
     而本函数是三个删列入口的**唯一漏斗**，这里读 `undefined.length` 同样会崩整页。 */
  if (ui < 0 || ui >= unitCount()) return
  if (unitCount() <= 1) {
    toast('至少要保留一列客户列，不能全部删完', 'warn')
    return
  }
  snapshot()
  const u = cross.value.units[ui]
  cross.value.units.splice(ui, 1)
  cross.value.rows.forEach(r => { delete r.qtyByUnit[u.name] })
  /* v199：把这一列记进「待隐去」集合 —— 保存时随 save-matrix 提交，后端落
     `forecast_hidden_units`，`all_units` 名册随之不再下发它（这是「删列」第一次有持久化载体；
     旧实现只删本期 role='导入' 的记录，而列来自**全历史名册** ⇒ 刷新必然回来）。
     ⚠️ snapshot() 在上面 ⇒ 快照里存的还是**没有这个名字**的旧 hiddenUnits，
        所以 Ctrl+Z 撤销删列时集合会一起回退（否则撤销后一保存仍会把列隐掉，看着像"撤销没用"）。
     ⚠️ 去重：正常路径删完该列就不在 units 里、不会重复记；这里防的是「删 → 撤销 → 再删」
        之类的组合把同名记两遍（后端幂等，纯为保持集合语义干净）。 */
  const hu = hiddenUnits()
  if (u.name && !hu.includes(u.name)) hu.push(u.name)
  clampSelection()          // v197：列总数少一列 ⇒ 选区/锚点要跟着夹（见 clampSelection 注释）
}

/* ---- Q16 / Q25：全量校验 + 可点击跳转的错误清单 ----
   原实现保存拦截时只报「存在 N 个单元格录入不合法」，428 行里用肉眼找 N 个红框
   几乎不可能，错误原因还要逐个悬停才看得到。 */
const QTY_MAX = 999999          // 兜底上限（= 后端默认口径；成功取到 spec 后被覆盖）
/* v213（2026-09-20）：数量判据与后端**同源**。
   原先前端写死 QTY_MAX=999999、后端小程序入口写 10000、Web 保存入口毫无上限 —— 同一件事
   四个口径（还有小程序端的 99999）。现在唯一来源是
   `GET /api/forecast-submissions/validation-spec`（后端见 db/queries/forecast_rules.py）：
   **上限与五类文案都由它下发**，前端只负责显示。
   ⚠️ fail-safe：取不到就退回下面这组默认值（与后端默认口径一致）。绝不能因为一次请求失败
      就把表格判成「全部合法」（漏拦）或「全部非法」（变成假红）。
   ⚠️ 这里只是**预检**（让用户当场看见红框），权威判定始终在后端 —— 保存时后端会再判一次，
      不一致时以服务端回执为准（见 saveEdits 的 400/409 分支）。 */
const qtyMax = ref(QTY_MAX)
const SPEC_MSG_FALLBACK = {
  over: '数量过大（上限 {max}）',
  neg: '不能为负数',
  int: '必须为整数',
  num: '必须是数字（当前值无法识别，如「12箱」请改为 12）',
  name: '商品名称必填（该行已填报数量）',
}
const specMsg = ref({ ...SPEC_MSG_FALLBACK })
/* 文案模板里的 {max} 等占位符按当前规则填充。缺项一律回退默认文案 ⇒ 后端多下发一类
   前端不认识的 kind 也不会显示成空串。 */
function specText(kind, repl) {
  let t = specMsg.value[kind] || SPEC_MSG_FALLBACK[kind] || ''
  if (repl) for (const key in repl) t = t.split('{' + key + '}').join(String(repl[key]))
  return t
}
/* 🔴 v213：**整串**数字判据（与后端 normalize_qty 逐字对齐）。
   原来是 `parseFloat(...)` —— **前缀解析**：`parseFloat('12箱')` = 12 ⇒ 前端判「合法、
   不标红、放行」，而后端整串解析直接拒收 ⇒ 那一格被**静默丢弃**（用户以为报上去了 = 漏订货）。
   文案当时写着「必须是数字（当前值无法识别，如「12箱」请改为 12）」—— 承诺了、实现没做到。
   现在同一条判据：NFKC 归一把全角数字转半角 → 去千分位逗号 → 整串正则（**允许记数法**，
   因为 `1e3` 是 Excel 与 JS 都认的合法数字，拒绝它会造出一格假红）。 */
const NUM_RE = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
/* 取一次校验规格（进编辑网格时随另外两个请求并发，不额外增加一次串行等待）。
   失败静默 —— 保留上一次取到的值（首次即默认口径），不打断任何流程。 */
async function loadValidationSpec() {
  try {
    const d = await forecastApproveApi.validationSpec()
    const sp = (d && d.spec) || {}
    const m = Number(sp.qty_max)
    if (Number.isFinite(m) && m > 0) qtyMax.value = m
    const tpl = { ...SPEC_MSG_FALLBACK }
    if (Array.isArray(sp.kinds)) sp.kinds.forEach(k => { if (k && k.k && k.msg) tpl[k.k] = String(k.msg) })
    specMsg.value = tpl
  } catch (e) { /* fail-safe：沿用现有（默认）口径 */ }
}
const errListOpen = ref(false)
const errList = ref([])
/* v174：查错面板的筛选与派生数据。
   errList 存**全量**（不再切 200）—— 分组计数与「还有几处未列出」都要按全量算，
   只在实际渲染时截断，否则角标说 300 处、分组加起来只有 200 处，用户会对不上账。 */
const errKind = ref('')            // '' = 全部；否则是 ERR_KINDS 里的 k
const errFiltered = computed(() => errKind.value ? errList.value.filter(x => x.kind === errKind.value) : errList.value)
const errShown = computed(() => errFiltered.value.slice(0, 300))
const errGroups = computed(() => {
  const m = new Map()
  errList.value.forEach(x => {
    const g = m.get(x.kind) || { k: x.kind, label: x.kindLabel, n: 0 }
    g.n++
    m.set(x.kind, g)
  })
  return [...m.values()].sort((a, b) => b.n - a.n)
})
const saveFailed = ref(null)    // Q26/Q27：{ kind, msg, prodDone, at }
/* Q25：待修正数量角标。全表校验是 428×30≈1.3 万次判断，不能每次输入都算，
   因此在草稿 watch 里以 1.5s 节流更新（与本地草稿同一次 deep watch，不新增 watcher）。 */
const errCount = ref(0)
let _errTimer = null
// Q28：快捷键说明（首次进入编辑自动展开一次，之后记住用户选择）
const KBD_HELP_SEEN_KEY = 'forecast_kbd_help_seen'
const kbdHelpOpen = ref(false)
function toggleKbdHelp() {
  kbdHelpOpen.value = !kbdHelpOpen.value
  try { localStorage.setItem(KBD_HELP_SEEN_KEY, '1') } catch (e) {}
}
function initKbdHelp() {
  let seen = false
  try { seen = localStorage.getItem(KBD_HELP_SEEN_KEY) === '1' } catch (e) {}
  kbdHelpOpen.value = !seen
}
function colNameOf(ci) {
  if (ci < visibleCols.value.length) return (visibleCols.value[ci] || {}).label || ''
  const ui = ci - visibleCols.value.length
  return cross.value.units[ui] ? cross.value.units[ui].name : ''
}
/* v174：把校验消息归成稳定的「原因类型」，供查错面板分组与筛选。
   不能直接拿 msg 分组 —— 「数量过大（上限 999999）」「条码重复（第 7 行 同品牌「蒙牛低温」）」
   都带随行变化的括号说明，同一种错会碎成许多组。 */
const ERR_KINDS = [
  { k: 'over', label: '数量过大', re: /^数量过大/ },
  { k: 'neg', label: '负数', re: /^不能为负数/ },
  { k: 'int', label: '非整数', re: /^必须为整数/ },
  { k: 'num', label: '非数字', re: /^必须是数字/ },
  { k: 'name', label: '商品名称必填', re: /^商品名称必填/ },
  { k: 'dup', label: '条码重复', re: /^条码重复/ },
  { k: 'enum', label: '取值不在候选中', re: /^应为：/ },
]
function errKindOf(msg) {
  for (const e of ERR_KINDS) if (e.re.test(msg)) return e
  return { k: 'other', label: '其他' }
}
function pushErr(list, ri, ci, r, msg) {
  const kd = errKindOf(msg)
  list.push({
    ri, ci, row: ri + 1, col: colNameOf(ci), name: r.name || '', msg,
    kind: kd.k, kindLabel: kd.label,
  })
}
function validateAll() {
  const list = []
  const nc = visibleCols.value.length
  const nu = unitCount()
  // v175：不再单独扫一遍条码 —— 「条码重复」已并入 cellIssue，表格红框与清单同源，
  // 否则又是「清单报了、格子上没标」这种两套规则各自漂移的老毛病
  cross.value.rows.forEach((r, ri) => {
    for (let ci = 0; ci < nc + nu; ci++) {
      const msg = cellIssue(ri, ci)
      if (msg) pushErr(list, ri, ci, r, msg)
    }
  })
  return list
}
/* v174：点一条错误 → 跳到那一格。
   原实现先 `errListOpen = false`（那是为居中弹窗准备的：弹窗盖住表格，不关就看不到目标格）。
   现在的面板内联在表格下方、不遮挡网格，关掉反而丢掉「还剩哪些没改」的上下文 ——
   保持打开，改对后该条会自己消失。 */
/* v211（P1-3）：**触屏可读的错误原因**。
   问题：错误原因一直只挂在 `<td :title>` 上（**悬停**才出来）—— 平板 / 手机根本没有悬停，
   用户只看见一个红框、不知道错在哪；要查原因还得滚到表格下方的「查错」清单。
   做法：有错的格子在角上加一个**可点击**的角标，点它直接弹出完整原因。
   ⚠️ 位置取**左上角**：右侧垂直中线是 `.name-badges` 的地盘、右下角是 `.fill-handle`
      （拖拽填充要用）—— 只有左上角是完全空闲的。
   ⚠️ `mousedown.stop.prevent` + `click.stop` **缺一不可**：少了任一，按下角标会先被 td 的
      `onCellDown` 接走（选中该格 / 起拖框选）⇒ 用户点一下「看原因」，顺手把选区也改了。 */
function showCellErr(ri, ci) {
  const msg = cellIssue(ri, ci)
  if (msg) toast(msg, 'warn')
}
/* v219 打磨④：跳转后让目标格**闪一下**。
   「跳过去了」和「用户看见跳到哪一格」是两件事 —— 428 行表 + 全屏 + 缩放之后，
   光标落在某个格上往往根本看不见，观感仍然是「点了清单没反应」。
   ⚠️ 用 `k` 计数而不是布尔：连续点同一处错误时，布尔不变 ⇒ CSS 动画**不会重放**
   （第二次点等于没闪，又变回「点了没反应」）。改 key 强制重挂载是一种办法，但会连带
   丢焦点；这里改的是 class 的**开关 + 计数**，靠 v-if 之外的 `animation-name` 重放更麻烦
   ⇒ 退而求其次：清一次再置一次（下面的 setTimeout(0) 就是干这个的）。 */
const flashCell = ref({ r: -1, c: -1, k: 0 })
let _flashTimer = null
function isFlash (r, c) {
  return flashCell.value.r === r && flashCell.value.c === c
}
function flashAt (r, c) {
  if (_flashTimer) clearTimeout(_flashTimer)
  flashCell.value = { r: -1, c: -1, k: flashCell.value.k + 1 }   // 先关掉，逼动画重放
  nextTick(() => { flashCell.value = { r, c, k: flashCell.value.k + 1 } })
  _flashTimer = setTimeout(() => { flashCell.value = { r: -1, c: -1, k: flashCell.value.k } }, 1400)
}

function gotoErr(it) {
  gotoRowPage(it.ri)
  nextTick(() => {
    selectCell(it.ri, it.ci); focusCell(it.ri, it.ci, { select: true }); scrollRowIntoView(it.ri)
    flashAt(it.ri, it.ci)
  })
}
/* v174：把面板滚进视野。面板在表格下方，用户在长表中间点「查错」或保存失败时，
   结果可能落在视口之外 —— 那样「点了没反应」的观感其实并没真正消除。 */
function revealErrPanel() {
  nextTick(() => {
    const el = document.querySelector('.err-panel')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  })
}
function openErrList() {
  const list = validateAll()
  if (!list.length) { toast('当前没有需要修正的录入', 'ok'); errListOpen.value = false; return }
  errList.value = list          // 全量存，渲染时才截断（见 errShown）
  errKind.value = ''            // 每次重新打开回到「全部」
  errListOpen.value = true
  revealErrPanel()
}

/* ---- v219 打磨⑤：预检「一键修复」 ----
   起因：清单能**列出**错误、能**跳转**到那一格，但改还得一格一格手改。
   从 Excel / 微信粘一整片进来时，几十处「带单位的数字」（`12箱`）要挨个删字。

   🔴 判据：**只自动修「官方文案自己给出了唯一目标值」的两类** —— 文案承诺什么才做什么
      （文案来自后端 `db/queries/forecast_rules.py`，经 validation-spec 下发、两端逐字同构）：
        · over「数量过大（上限 {max}）」 ⇒ 目标值唯一 = {max}            ✅ 自动修
        · num 「…如「12箱」请改为 12」   ⇒ 目标值唯一 = 串里那个数字      ✅ 自动修
      其余一律**不自动修**，理由逐条（这不是保守，是文案没给答案）：
        · num  串里**没有**数字（「箱」）→ 只能归零，而「这件不报了」是业务决定 ⇒ 不猜
        · num  串里**多个**数字（`12箱24瓶`）→ 哪个是数量无法判定 ⇒ 不猜
        · num  带正负号（`-5箱`）→ 符号有语义，抽掉可能把「要减 5」变成「要加 5」⇒ 不猜
        · int 「必须为整数」    → 12.5 改 12 还是 13？两解 ⇒ 不猜
        · neg 「不能为负数」    → 改 0 / 取绝对值 / 本意是退货（该走退单）？⇒ 不猜
        · name「商品名称必填」  → 选哪个商品是业务决定 ⇒ 不猜
        · dup 「条码重复」      → 档案跨行关系（v196 多规格共码）⇒ 不猜
        · enum「取值不在候选中」→ 多个候选 ⇒ 不猜
      净效果：**只把原值里本就有的信息取出来，绝不凭空造值、绝不清空**。

   为什么敢自动改数值：① 每处改动都在确认弹窗里**逐条列给用户看**（原值 → 新值 → 依据），
   点是用户点的；② 整批只入**一条**撤销记录（一次 Ctrl+Z 整批还原）；③ 全程不静默。 */
function cellNumericMeta(ci) {
  if (ci < visibleCols.value.length) {
    const col = visibleCols.value[ci]
    if (!col || col.edit !== 'num') return null      // 非数字列（名称/条码等）本就不该有数字错
    return { isInt: col.num === 'int' }
  }
  const ui = ci - visibleCols.value.length
  if (ui >= unitCount()) return null
  return { isInt: true }                             // 客户数量列 = 非负整数（同 cellErrMsg）
}
function fixCandidate(ri, ci, msg) {
  const meta = cellNumericMeta(ci)
  if (!meta) return null
  const raw = String(readCellVal(ri, ci))
  const kind = errKindOf(msg).k
  let cand, how
  if (kind === 'over') {
    cand = String(qtyMax.value)
    how = '超出上限，按上限 ' + qtyMax.value + ' 计'
  } else if (kind === 'num') {
    /* 🔴 归一**必须排在符号检查之前**（v219 判据，由本护栏的 B17 用例抓出）：
       `HALF_MAP` 会把 U+2212 数学减号「−」折成 ASCII '-'（从公式或某些输入法复制的
       「负号」常是它）。若先拿**原串**判符号，`−5箱` 会绕过守卫、被抽出 5 ——
       把用户的「减 5」静默改成「加 5」，方向反了，而屏幕上没有任何异常。
       「先查后归一」这个写法在别的字符上是同一类漏洞，别改回原序。 */
    const s = toHalfNum(raw)
    if (/^[+-]/.test(s.trim())) return null
    const ms = s.match(/[0-9]+(?:\.[0-9]+)?/g) || []
    if (ms.length !== 1) return null
    cand = ms[0]
    how = '从「' + raw + '」中取出数字 ' + cand
  } else return null
  /* 自我验证（照着 cellErrMsg 的判据重来一遍）：候选值不合法就**不修** ——
     否则会出现「点了修复、格子还是红的」这种假修复，比不修更糟。 */
  const n = Number(cand)
  if (!Number.isFinite(n) || n < 0) return null
  if (meta.isInt && !Number.isInteger(n)) return null
  if (n > qtyMax.value) return null
  if (raw === cand) return null
  return { v: cand, how }
}
const fixables = computed(() => {
  const out = []
  const seen = new Set()
  const nc = visibleCols.value.length + unitCount()
  for (const it of errList.value) {
    if (it.ci < 0 || it.ci >= nc) continue
    const key = it.ri + '_' + it.ci
    if (seen.has(key)) continue
    /* 🔴 复核这道闸门**不能省**：errList 有两个来源 —— 本地 `validateAll()`（ri/ci 精确）
       与后端 400 回执 `errFromViolations()`（ri/ci 是**推算**的：列名对不上时会退到
       「该行第一个可编辑格」）。拿推算坐标去写数值 = 改错格。
       因此动手前用当前表格状态重算这一格，必须**与清单里那条同类**才认。 */
    const now = cellIssue(it.ri, it.ci)
    if (!now || errKindOf(now).k !== it.kind) continue
    const f = fixCandidate(it.ri, it.ci, now)
    if (!f) continue
    seen.add(key)
    out.push({
      ri: it.ri, ci: it.ci, row: it.row, col: it.col, name: it.name,
      kind: it.kind, kindLabel: it.kindLabel,
      oldRaw: readCellVal(it.ri, it.ci), old: String(readCellVal(it.ri, it.ci)),
      neu: f.v, how: f.how,
    })
  }
  return out
})
const manualErrs = computed(() => errList.value.length - fixables.value.length)
const fixPreviewOpen = ref(false)
function openFixPreview() {
  if (!fixables.value.length) { toast('这类错误需要你手工判断，没有可自动修复的项', 'warn'); return }
  fixPreviewOpen.value = true
}
function applyFixes() {
  const list = fixables.value
  if (!list.length) { fixPreviewOpen.value = false; return }
  /* 先抓 old 再写：pushBatchSnap 存的是 old→new 补丁，写之前 old 必须已经在手。
     ⚠️ `?? ''` 这道兜底不能省：readCellVal 对「从未填过」的格返回 undefined，
        undo 时 writeCellVal(r,c,undefined) 会被 parseNumInput 里的 String(undefined)
        变成字面量 "undefined" 写进格子里 —— 回退反而把数据搞脏。 */
  const cells = list.map(x => ({ r: x.ri, c: x.ci, old: x.oldRaw == null ? '' : x.oldRaw, new: x.neu }))
  for (const x of list) writeCellVal(x.ri, x.ci, x.neu)
  pushBatchSnap(cells)
  fixPreviewOpen.value = false
  refreshDirty()
  const rest = validateAll()
  errList.value = rest
  /* 🔴 角标必须与清单在**同一次**回写：errCount 平时靠 1.5s 节流自更新（见 Q25），
     但「修完还剩几处」是用户正盯着看的结果 —— 只回写 errList 会让角标与面板
     在最长 1.5s 内自相矛盾（角标「1」/ 面板「没有了」）。v219 真机取证抓到的就是这个。 */
  errCount.value = rest.length
  errKind.value = ''
  toast(
    '已修复 ' + list.length + ' 处' + (rest.length ? '，还剩 ' + rest.length + ' 处需手工处理' : '，可以保存了'),
    rest.length ? 'warn' : 'ok'
  )
  if (rest.length) revealErrPanel()
}

/* ---- v219 打磨⑥：数量上限**可配** ----
   在此之前上限是「只读」的：前端按服务端下发的 qtyMax 判红框与文案，
   而租户**没有任何办法改它**（`set_rules` 全仓无 HTTP 调用方，见本轮新增的
   `PUT /api/forecast-submissions/validation-rules`）⇒ 出厂值 99999 用到底，
   遇到「一个正常的量被拦了」只能忍着。
   入口就放在**查错面板**里：这是「被上限拦下」这件事真正发生的地方，
   把「上限是多少、怎么改」放在用户当下正在看的这一屏，比埋进设置页有用。 */
/* 与后端 `_admin`（role ∈ admin/boss）**同判据**。
   ⚠️ 直接用**原始** role 比，不过 `normRole` —— 后端判的就是原始 role，
      两侧归一规则不同会造出「前端给了入口、后端回 403」这个最差组合。
      前端这里只是提前隐藏，**权威判定始终在后端**。 */
const canEditRules = computed(() => ['admin', 'boss'].includes(String(bizRole.value || '')))
const ruleEditOpen = ref(false)
const ruleQtyMax = ref('')
const ruleSaving = ref(false)
function openRuleEdit() {
  ruleQtyMax.value = String(qtyMax.value)
  ruleEditOpen.value = true
}
async function saveRuleEdit() {
  if (ruleSaving.value) return
  const raw = String(ruleQtyMax.value).trim()
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 999999999) {
    toast('数量上限要是 1 ~ 999999999 之间的整数', 'warn')
    return
  }
  ruleSaving.value = true
  try {
    const d = await forecastApproveApi.setValidationRules({ qty_max: n })
    const rr = (d && d.rules) || {}
    const got = Number(rr.qty_max)
    if (Number.isFinite(got) && got > 0) qtyMax.value = got   // 以服务端回执为准，不用本地输入值
    ruleEditOpen.value = false
    /* 放宽上限后可能有格子不再「超上限」、收紧后可能新出现一批 ⇒ 清单必须跟着重算，
       否则面板上留着上一次的结论（用户按它去修，修的是不存在的错）。 */
    const rest = validateAll()
    errList.value = rest
    errKind.value = ''
    toast('数量上限已改为 ' + qtyMax.value + (rest.length ? '，当前还有 ' + rest.length + ' 处待修正' : '，当前录入全部合规'), 'ok')
  } catch (e) {
    toast('保存失败：' + (e.message || ''), 'err')
  } finally {
    ruleSaving.value = false
  }
}

/* v213-B1：把 409 回执里的违规清单式冲突渲染成可行动的清单。
   （400 的 violations 走同一套「点一行跳到那一格」的清单 —— 见 errFromViolations。） */
function errFromViolations(vlist) {
  const list = []
  ;(vlist || []).forEach(v => {
    const ri = Math.max(0, (Number(v.row) || 1) - 1)
    const colName = String(v.col || '')
    /* col 定位：后端给的是**列名**（Web 端 = 客户名；小程序端无客户列维度故恒为「报单数量」）。
       在客户列里按名找；找不到再按主档列名找；都没有就只定位到行（清单仍可点，跳到该行）。 */
    let ci = -1
    if (colName && colName !== '报单数量') {
      const ui = cross.value.units.findIndex(u => String(u.name) === colName)
      if (ui >= 0) ci = visibleCols.value.length + ui
      else ci = visibleCols.value.findIndex(c => String(c.label || '') === colName)
    }
    /* 定位不到具体列时退到「该行第一个可编辑格」，**不留 -1** —— 清单每一行都要能点，
       否则用户点了没反应，比不给清单更糟（回到「400 只报一句数量」的老问题）。 */
    if (ci < 0) ci = unitCount() ? visibleCols.value.length : 0
    const kd = errKindOf(v.msg || '')
    list.push({
      ri, ci, row: Number(v.row) || 0, col: colName,
      name: (cross.value.rows[ri] && cross.value.rows[ri].name) || '',
      msg: String(v.msg || '录入不合法'),
      kind: String(v.kind || kd.k), kindLabel: String(v.label || kd.label) || '录入不合法',
    })
  })
  return list
}

async function saveEdits(opts = {}) {
  /* opts.force：用户在并发冲突对话框上明确选了「用我这份覆盖」⇒ 只给 save-matrix 多带一个
     force=true（后端跳过冲突判定）。
     ⚠️ 复用**同一个函数**而不是在对话框里另写一份提交逻辑：两份载荷字段清单必然漂移
        （本项目已多次吃过「第二份拷贝」的亏）。force 路径下**跳过商品档案那一步** ——
        第一次尝试时已经写过了，重跑只是白白多一次写锁和一条修改日志。 */
  const force = !!opts.force
  const p = cross.value.period
  if (!p) return
  /* v244 期次归属硬守卫（与后端 `save_matrix` 新增的 v244 闸**同源判据**）：
     没有进行中的期次时保存，会产出 `period_id=0` 的孤儿行 —— 看板会把它补成「合成行」
     （`id<0`），而四个行级按钮的判据都是 `Number(row.id)>0` ⇒ 那批数据**既改不了也关不掉**，
     只能人工清库（2026-08-22 那 20 条 / 12,709 件就是这么来的）。
     放在**唯一的提交入口**上，与按钮 disabled 构成两层：按钮态只是提示，挡不住直接调用
     与将来新增的第三个入口。`!p.id` 兜住「拿到的是合成期次（今日报单，id=0）」这一形态
     —— 那时 noOpenPeriod 未必为真（可能只是当前视图没指到真实期次），文案单独兜底。 */
  if (noOpenPeriod.value || !Number(p.id || 0)) {
    toast(saveBlockedReason.value || '当前编辑的不是一个真实期次，无法保存：请先选择一个进行中的期次。', 'warn')
    return
  }
  /* v197（P1-2d）：提交前拦「一个客户列都没有」。
     `delCol` 已加「至少保留一列」守卫（P1-2c），这里是**第二道**，因为能把 units 变成空的路径不止那条：
     套用列方案（applyScheme 整体替换 colOrder/colVis）、本地草稿恢复、以及载入进来的期次本身
     就没有客户列。与其让后端收到 `customers: []` 后报一个说不清的错误（或静默写出一张
     「有商品、没有客户」的矩阵），不如在发请求之前就说人话。
     ⚠️ 放在 validateAll() **之前**：客户列是这张表的**位置**语义（数量按客户名存在 qtyByUnit 里），
        一个客户都没有时逐格校验也在校验一堆无意义的空列，先拦更省事也更好懂。 */
  if (!unitCount()) {
    toast('至少要有一个客户列才能保存：请先点工具行的「新增客户」加回一列', 'warn')
    return
  }
  // Q25：全量校验（单元格类型 + 名称必填 + 数量上限 + 条码重复），失败直接弹清单
  const list = validateAll()
  if (list.length) {
    errList.value = list
    errKind.value = ''
    errListOpen.value = true
    revealErrPanel()
    toast(`存在 ${list.length} 处需要修正，见表格下方清单`, 'err')
    return
  }
  /* Q17：商品主档与数量矩阵必须用「同一份过滤结果」。
     原实现商品侧 .filter(r => r.name || r.barcode)，矩阵侧用未过滤的全量 rows ——
     无名行的商品不建、数量却写进矩阵（或反之），产生孤儿数量 / 数据错位。 */
  // v189：改用 liveRows（活跃行唯一判据）—— 此处原本第二次手写 filter，与合计口径各写一份
  //   ⇒ 判据一改就只改一半（同「第二份拷贝 = 静默漂移」）。保存的行集与合计的行集必须是同一份。
  const kept = liveRows.value
  const usable = kept.filter(r => Number(r.product_id) > 0 || String(r.name || '').trim() || String(r.barcode || '').trim())
  const ignored = kept.length - usable.length
  if (ignored > 0) {
    const ok = window.confirm(`有 ${ignored} 行缺少商品名称/条码，保存时将被忽略（其数量也不会写入）。\n\n继续保存其余 ${usable.length} 行？`)
    if (!ok) return
  }
  savingEdit.value = true
  let prodDone = false
  let prodMsg = ''
  try {
    // 1) 商品主档（网格直编 / 粘贴）—— 先落商品，再落数量矩阵
    /* v196（P0-2）：只提交**与基线不同**的行。
       此前是无脑 upsert 全部 usable（≈154 行），`fields` 字面量**无条件覆盖** ⇒ 纯写放大；
       更要命的是只要其中还有 1 行未注册品牌，就要白等一次写锁（v195 修的是那个自锁，
       本处修的是**规模**：规模不降，"阈值"只是变宽松）。
       ⚠️ 判定与载荷共用 prodPayloadOf **同一个**函数（见其注释：两份字段清单必然漂移）。
       ⚠️ 基线里没有该 pid / 行没有档案号 ⇒ **必发** —— 宁多勿漏。
       ⚠️ 数量矩阵的 payload 仍然走全量 `usable`：本期录入数量是整表语义，不能只发改动行。
       v213-B1：`force`（并发冲突下用户选「用我这份覆盖」）时**整段跳过** —— 商品档案在第一次
       尝试时已经写成功（那一步失败会直接抛错、根本走不到矩阵保存），重跑只会多占一次写锁。 */
    const base = prodBaseline.value
    const prodRows = force ? [] : usable.filter(r => {
      const pid = Number(r.product_id) || 0
      if (!pid) return true                                   // 新增行：档案里还没有它
      const b = base && base.get(pid)
      if (!b) return true                                     // 基线没有 ⇒ 当新行发
      const now = prodPayloadOf(r)
      return Object.keys(now).some(k => String(now[k]) !== String(b[k]))
    }).map(prodPayloadOf)
    if (prodRows.length) {
      /* v196（P0-3）：给这一步单独的**较长**超时（默认 20 秒，见 client.js:184）。
         P0-1 修好后这条正常根本用不到（实测 0.17 秒）；留着是防"某天又慢下来"时，
         用户至少不会在 20 秒被硬掐断却看到一个和超时无关的报错。
         ⚠️ 放宽超时**不解决写锁**，只是让失败来得晚一点、且文案说人话（见下方 catch）。 */
      const pr = await productsApi.bulkUpsert(prodRows, { timeout: 60000 })
      prodMsg = ` · 商品 ${pr.inserted} 新增 / ${pr.updated} 更新`
      /* v197（P2-1）：品牌待审登记失败**不再让整个保存失败**（后端已逐个吞住并计数）。
         但「不失败」不等于「没事」—— 登记失败的那几个品牌不会进 `brand_pending`，
         也就进不了 `brands` 表，而品牌下拉候选正是从 `GET /api/brands` 读的
         ⇒ 用户下次报单会发现「我明明填过这个品牌，怎么选不出来」。
         商品本身这次是存住了（后端事务先提交、登记在提交之后），所以只提醒这一件事。
         ⚠️ 指向的必须是**真实存在**的改法（吃过亏）：品牌档案页有「+ 添加品牌」按钮
            → `POST /api/brands`（BrandArchive.vue:19/241），这条路能真正把品牌补进候选表。 */
      if (pr && pr.brands_failed) {
        toast(`${pr.brands_failed} 个品牌未能登记到待审清单（商品已保存）。可在「档案管理 → 品牌档案」点「+ 添加品牌」补上`, 'warn')
      }
      prodDone = true
    }
    /* v190（2026-09-18 口径变更）：手工录入的「单价(进价/箱)」**只在本期生效** ——
       不再反推写回商品档案的进价（那是当时的另一个选项，用户明确选了「只在本期」）。
       本期价随下面的 saveMatrix 载荷走 `rows[].case_price`，后端落进 `forecast_extra_qty`
       （唯一键含 产品×期次）⇒ 天然按期次隔离，也天然不碰商品档案。
       ⚠️ 不要把它塞进上面的 productsApi.bulkUpsert：那是**商品档案**写通道，
          塞进去就等于「本期单价」和「档案进价」两个不同生命周期的东西共用一张表。
       要改档案进价请去商品档案页（那里有字段级留痕）。 */
    // 2) 数量矩阵（保持原 save_matrix 语义：幂等覆盖本期『导入』数据）
    const payload = {
      start: p.order_start, end: p.order_end,
      // Q28（2026-09-15）：显式传期次号 —— 后端不再靠窗口猜期次
      // （窗口完全相同的两个期次，靠猜会落到 id 最大的那个，可能不是当前正在编辑的这一期）
      period_id: p.id || 0,
      customers: cross.value.units.map(u => u.name),
      /* v199：本次界面**删掉的**客户列名 → 后端落 `forecast_hidden_units`，`all_units` 名册
         随之不再下发它们（否则列在刷新后必然回来 —— 见 save_matrix docstring 的说明）。
         ⚠️ 传**名字数组**（后端按名 INSERT）；传错成数量后端只会静默少隐藏几列。
         ⚠️ 向后兼容：旧后端不认识这个字段会直接忽略，不会 400 —— 前后端各自可独立上线。 */
      hidden_customers: hiddenUnits(),
      rows: usable.map(r => ({
        product_id: r.product_id || 0, product_name: r.name || '', spec: r.spec || '',
        unit: r.unit || '件', price: r.sale_price || 0, qty_by_unit: r.qtyByUnit || {},
        extra_qty: Number(r.extraQty) || 0,
        /* v190：本期手工单价（元/箱）→ 后端落 `forecast_extra_qty.case_price`。
           未录入传 null（**不传 0**：前端判据是「> 0 才算手工录入」，传 0 会让两边判据
           出现「0 vs null」的表述差，虽然结果一样、但读代码的人要重新推一遍）。
           清空后再保存 = 写回 NULL ⇒ 该行回到「按档案进价自动算」。
           🔴 v191b：**只能传 `r.casePrice`（用户真填过的那个）**，绝不把 `casePriceInherit`（沿用的价）
              传上去 —— 传上去等于把「没填」记成「填过」：本期会凭空多出一条价记录，
              且清空后再保存又被写回 ⇒ 用户永远清不掉（沿用值把它带回来）。 */
        case_price: Number(r.casePrice) > 0 ? Number(r.casePrice) : null,
      })),
      /* v213-B1 乐观锁：把「我打开这张矩阵时看到的版本」原样回传。后端与当前指纹比对，
         不一致 ⇒ 409 + conflict（期间有人保存过），本次保存**一个字节都不写**。
         ⚠️ 传空串 = 不判冲突（后端 fail-open 的同一约定）：进编辑态时若 summary 没给
            `matrix_rev`（比如后端还没升级），行为就与 v212 逐字相同 —— 前后端可各自独立上线。 */
      base_rev: matrixRev.value || '',
    }
    if (force) payload.force = true
    const r = await forecastApproveApi.saveMatrix(payload)
    if (!r.success) throw new Error(r.error || '保存失败')
    /* v213-B1：采纳**回执里的新指纹** —— 本次保存已经把库里的内容换成了屏幕上这一份，
       所以「我看到的版本」现在就是它。不采纳的话，用户接着改再保存会 409（自己和自己冲突）。 */
    if (r.matrix_rev) { matrixRev.value = r.matrix_rev; matrixAt.value = r.matrix_at || ''; matrixBy.value = '' }
    syncMoq()
    saveCloudNotes()
    // v166：明细里补上商品主档的增改数——「改单」同时会落商品档案，只报客户/明细数看不出这层。
    // 前缀「保存汇总表」由动作列承担，明细不再重复（面板按 时间·修改人·动作·明细 四段渲染）
    /* v208：改为 **await** —— 用户要求「每次修改都需记录并体现在修改日志中」。
       原实现是「发射后不管」，与随后的「退出编辑态」构成竞态：刚退出就点「修改日志」可能看不到这一条。
       ⚠️ 仍**不阻断保存**：recordAudit 内部自己 catch（失败只告警、不抛出）。
       ⚠️ 必须在 exitEdit() **之前**调 —— 先记痕，再离开编辑态。 */
    await recordAudit('save_changes', `${r.saved_customers} 客户 / ${r.saved_items} 条明细${prodMsg}`)
    toast(`已保存：${r.saved_customers} 个客户 · ${r.saved_items} 条商品明细${prodMsg}`, 'ok')
    clearDraft(true)          // Q11：静默清除草稿，不再弹「已放弃草稿」
    /* v201：记下保存时刻，并把状态条置回「干净」—— 这是让用户**看见**「已经存进去了」的唯一信号。
       ⚠️ `hour12:false` 显式给定：中文 locale 默认可能带「上午/下午」，与 24 小时制混排很啰嗦。 */
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    dirtySinceSave.value = false
    // v161：自定义列的值写回服务端。**必须 await** —— 失败要能被上面的 try/catch 捕获并提示，
    // 自定义列没落库属于"静默丢数据"，不能吞。
    await collectCustVals()
    usable.forEach(rw => { delete rw._new })   // Q9：保存后清除「新增行」标识
    saveFailed.value = null
    /* Q5：不再清空撤销栈；改为记录「上次保存基线」，保存后仍可 Ctrl+Z / 一键回退。
       ⚠️ 位置**必须**在退出编辑态之前 —— `leaveEdit()` 会调 `loadCross()` 把
          `cross.value` 重建为**只读态**对象（字段集与编辑态不同：没有 `_new` /
          `casePrice` 这类编辑态专有字段），之后再 clone 会得到一个残缺基线，
          「回退」就退歪了。 */
    lastSavedSnap.value = clone(cross.value)
    /* v208（2026-09-19 用户拍板）：保存成功 ⇒ **退出编辑态**，回到带「改单」按钮的只读态
       （原实现是 `await loadEditGrid()` 保持编辑态，用户点保存后页面「长得一模一样」）。
       用户原话见 exitEditAfterSave() 的说明。
       ⚠️ 保存**失败**不走这里 —— catch 分支停在编辑态、数据不丢（另有红色横幅）。
       副作用（已核对）：粘贴/新增的商品行不会消失 —— 它们已随本次 saveMatrix 落库，
       只读态 loadCross() 会从服务端把它们读回来。 */
    exitEditAfterSave()
  } catch (e) {
    // Q26：按错误类型分流，并明确告知「商品已落库、数量未保存」的部分成功状态
    const msg = String((e && e.message) || '')
    const nm = String((e && e.name) || '')
    const pay = (e && e.payload) || null
    /* ---- v213-B1：409 并发冲突 —— 单独一条分支，先于所有按文案分类的兜底 ----
       用**状态码**判（client.js 已把 payload 与 status 挂到 Error 上），不猜中文文案。
       这里要做的不是 toast 一句「保存失败」，而是把三件事摆到用户面前：
         · 发生了什么（谁、什么时候改过本期）；
         · 我的改动怎么了（**没保存**，不是系统坏了）；
         · 两个出口（重新载入看对方的 / 坚持用我这份覆盖）由对话框按钮承接。
       ⇒ 弹对话框，不进红色横幅那条道（横幅说的是「失败」，这里语义是「冲突」）。 */
    if (e && e.status === 409 && pay && pay.conflict) {
      conflictInfo.value = pay.conflict
      saveFailed.value = null
      return
    }
    /* ---- v213：400 违规清单 —— 后端与前端同一条判据，把清单原样搬进「查错」面板 ----
       正常情况下 `validateAll()` 已经在保存前拦住了（同一份判据、同一句话）；
       走到这里说明前端预检漏了一格（例如后端租户上限刚被调小、或某列判据前端未覆盖）。
       把服务端给的 `{row, col, kind, msg}` 直接渲染成可点清单，比只说一句「校验未通过」强得多。 */
    if (pay && Array.isArray(pay.violations) && pay.violations.length) {
      errList.value = errFromViolations(pay.violations)
      errKind.value = ''
      errListOpen.value = true
      revealErrPanel()
      saveFailed.value = { kind: '数据校验未通过', msg, prodDone, at: new Date().toLocaleTimeString('zh-CN') }
      toast(`服务端拦下 ${pay.violations.length} 处录入不合法，见表格下方清单（点一行跳到那一格）`, 'err')
      return
    }
    /* v196（P0-3）：**超时优先判定，且按结构化字段判、不靠猜文案**。
       原先只看 message 文本 —— 而 AbortController 到点 abort 抛出的 DOMException，其 message
       是英文（"signal is aborted without reason" / "The user aborted a request."），
       既不含「超时」也不含 timeout/network/fetch ⇒ 一律落到兜底「网络或服务器异常」，
       用户看不出该等一会还是该重试（v194b 真机实测即此形态）。
       client.js 现已把 abort 统一转成 `name='TimeoutError' / timeout=true`，
       这里加一条**最高优先级**分支接住它。 */
    let kind = '网络或服务器异常'
    if (e && (e.timeout || nm === 'TimeoutError' || nm === 'AbortError')) kind = '保存超时'
    else if (/403|权限|forbidden|未授权|无权限/i.test(msg)) kind = '无权限'
    else if (/超时|timeout|network|fetch/i.test(msg)) kind = '网络超时'
    else if (/不合法|校验|invalid/i.test(msg)) kind = '数据校验未通过'
    saveFailed.value = { kind, msg, prodDone, at: new Date().toLocaleTimeString('zh-CN') }
    /* 文案必须**可行动**：告诉用户下一步能做什么，而不是替他猜一个原因。
       ⚠️ 这里是 toast 单行，别写成小作文。 */
    const hint = kind === '保存超时' ? '，请稍后重试；若反复出现请联系我们' : ''
    toast(`保存失败（${kind}）` + (prodDone ? '：商品资料已保存，数量未保存' : '') + hint + (msg ? ` · ${msg}` : ''), 'err')
  } finally {
    savingEdit.value = false
  }
}

/* ---- v213-B1：并发冲突对话框的两个出口 ----
   为什么必须给两个出口、而不是替用户自动选一个：
     · 自动「覆盖」= 把别人的改动**静默抹掉**（改单是几个人协作的活，很可能对方刚录完）；
     · 自动「放弃我的」= 把用户这几分钟的录入无声丢掉。
   两条都不可接受，所以停下来问一次。默认焦点在「重新载入」（更安全的那个）。 */
async function conflictReload() {
  conflictInfo.value = null
  toast('已载入最新数据（你未保存的改动已放弃）', 'warn')
  await loadEditGrid()
}
async function conflictOverride() {
  const info = conflictInfo.value
  conflictInfo.value = null
  if (info) {
    /* 覆盖前记一笔痕：这是一次**有意识的**覆盖 —— 事后有人问「我的数怎么没了」时，
       修改日志里要能看出是「谁在什么时候选择了覆盖」，而不是一条普通的保存记录。 */
    try {
      await recordAudit('conflict_override',
        `覆盖并发改动（对方：${info.by || '其他人'} ${info.at || ''}）`)
    } catch (e) { /* 记痕失败不阻断保存 */ }
  }
  await saveEdits({ force: true })
}

/* Q23：粘贴「商品 × 客户」交叉表。
   原实现 onPaste 只映射商品主档列（名称/条码/规格…），从 Excel 复制的交叉表
   （首列商品名 + 后续各客户数量）粘进来只会建商品主档，数量整块不写入客户列。
   本函数先尝试按「列名 = 客户列」建立映射，命中则按行匹配商品名后写入数量；
   未命中返回 false，由 onPaste 回退到主档粘贴逻辑。 */
function tryPasteCross(block) {
  if (!block.length || block[0].length < 2) return false
  const head = block[0]
  const nameIdx = head.findIndex(h => /名称|品名|货品|商品/.test(String(h == null ? '' : h).trim()))
  if (nameIdx < 0) return false
  const map = []
  head.forEach((h, bi) => {
    if (bi === nameIdx) return
    const key = String(h == null ? '' : h).trim()
    if (!key) return
    const ui = cross.value.units.findIndex(u => u.name === key)
    if (ui >= 0) map.push({ bi, c: visibleCols.value.length + ui })
  })
  if (!map.length) return false
  const dataRows = block.slice(1)
  if (!dataRows.length) return false
  snapshot()
  let added = 0, updated = 0, bad = 0, skipped = 0
  dataRows.forEach(cells => {
    const nm = String(cells[nameIdx] == null ? '' : cells[nameIdx]).trim()
    if (!nm) { skipped++; return }
    let ri = cross.value.rows.findIndex(r => String(r.name || '').trim() === nm)
    if (ri < 0) {
      cross.value.rows.push({ ...blankRow(), name: nm, _new: true })
      ri = cross.value.rows.length - 1
      added++
    } else updated++
    map.forEach(({ bi, c }) => {
      writeCellVal(ri, c, cells[bi])
      if (cellInvalid(ri, c)) bad++
    })
  })
  gotoRowPage(cross.value.rows.length - 1)
  toast(`已按客户列粘贴：新增 ${added} 个商品 · 更新 ${updated} 个商品`
    + (skipped ? ` · 跳过 ${skipped} 行（无商品名称）` : '')
    + (bad ? ` · ${bad} 格不合法（已标红）` : '')
    + '（改完点「保存」落库）', bad || skipped ? 'warn' : 'ok')
  return true
}

function onPaste(e) {
  const cd = e.clipboardData || window.clipboardData
  const text = cd ? cd.getData('text') : ''
  if (!text) return
  // 编辑态且已选中单元格 → 区块单元格粘贴（还原 Excel 选区黏贴体验）
  if (editMode.value && selected.value.r >= 0) {
    e.preventDefault()
    pasteRegion(text)
    return
  }
  e.preventDefault()
  // B3 修复 (2026-07-24)：只读视图不允许粘贴新增商品行——原实现会静默 push 进
  // cross.rows 但保存按钮不可见、loadCross 重载即丢失，用户以为粘贴失败。
  if (!editMode.value) {
    toast('当前为只读视图，请先点「改单」再粘贴数据', 'warn')
    return
  }
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length)
  if (!lines.length) return
  // Q23：先尝试按「商品 × 客户」交叉表粘贴，命中则直接返回
  if (tryPasteCross(lines.map(l => l.split('\t').map(s => s.trim())))) return
  const HEADER_KEYS = {
    '名称': 'name', '商品名称': 'name', '货品': 'name', '条码': 'barcode', '条形码': 'barcode',
    '厂家编码': 'product_code', '永辉代码': 'product_code', '客户代码': 'product_code', '产品编码': 'product_code', '货号': 'product_code',
    '规格': 'spec', '单位': 'unit', '售价': 'sale_price', '单价': 'sale_price', '销售价': 'sale_price',
    '分销价': 'dist_price', '分销价格': 'dist_price', '批发价': 'dist_price',
    /* 🔴 v226b：此处原为 `'进价': 'purchase_price'` —— 与「商品档案页的进价输入框 / 导入模板 /
       后端 import_router 的「进价」列」指向了**不同的物理列**（同一个词、两个列）。后果是
       用户在这里粘了进价，主表金额却仍显示「缺价」（那一列不参与金额）—— 典型的"填了没反应"。
       现统一为 `factory_price`（元/箱），与上述三处同一物理列。
       老列名「厂价」系列一并接住：Excel 列头写「厂价 / 出厂价 / 工厂价」的用户不必改表。 */
    '进价': 'factory_price', '厂价': 'factory_price', '出厂价': 'factory_price', '工厂价': 'factory_price',
    '成本价': 'factory_price', '采购价': 'factory_price',
    '安全库存': 'safety_stock', '库存下限': 'safety_stock', '保质期': 'expiry_days', '保质期天数': 'expiry_days',
  }
  const first = lines[0].split('\t').map(s => s.trim())
  let headerMap = null, startIdx = 0
  const known = first.filter(h => HEADER_KEYS[h]).length
  /* Q20：表头识别阈值收紧。原 `known >= 2` 过于宽松——若首行数据恰好含 2 个表头词
     （例如某商品就叫「规格」），整行会被误当表头丢弃。现要求：
     命中 ≥3 个，或「首行非空单元格全部都能映射到已知表头」。 */
  const nonEmpty = first.filter(h => h).length
  if (known >= 3 || (known >= 2 && nonEmpty > 0 && known === nonEmpty)) {
    headerMap = first.map(h => HEADER_KEYS[h] || null)
    startIdx = 1
  } else {
    // 无表头：默认顺序 名称/条码/规格/单位/售价/分销价/厂家编码/进价(元/箱)/安全库存/保质期
    headerMap = ['name', 'barcode', 'spec', 'unit', 'sale_price', 'dist_price', 'product_code', 'factory_price', 'safety_stock', 'expiry_days']
  }
  let added = 0, skipped = 0
  snapshot()
  for (let i = startIdx; i < lines.length; i++) {
    const cells = lines[i].split('\t')
    const row = { product_id: 0, name: '', barcode: '', spec: '', unit: '件',
      sale_price: 0, factory_price: 0, safety_stock: 0, expiry_days: 0, product_code: '', dist_price: 0,
      price: 0, qtyByUnit: {}, ai: null, _new: true }
    headerMap.forEach((key, ci) => {
      if (!key) return
      const v = (cells[ci] || '').trim()
      if (key === 'sale_price' || key === 'factory_price' || key === 'safety_stock' || key === 'expiry_days' || key === 'dist_price') row[key] = parseNumInput(v)
      else row[key] = v
    })
    // Q19：跳过行必须显式计数并告知，原实现静默 continue → 用户粘 50 行只进 43 行却不知原因
    if (!row.name && !row.barcode) { skipped++; continue }
    cross.value.rows.push(row)
    added++
  }
  gotoRowPage(cross.value.rows.length - 1)
  if (added || skipped)
    toast(`已从 Excel 粘贴 ${added} 行商品`
      + (skipped ? `，跳过 ${skipped} 行（缺少商品名称或条码）` : '')
      + '（改完点「保存」落库）', skipped ? 'warn' : 'ok')
}
const savingEdit = ref(false)
const confirmInfo = ref(null)  // 2026-08-27：期次确认（经理保存汇总表=审批定稿）状态，老板进汇总表一眼看出是否已定稿
/* ---- v213-B1：乐观锁状态（并发编辑冲突） ----
   后端 `GET /summary` 下发 `matrix_rev`（本期矩阵的**内容指纹**，见 erp_db.forecast_matrix_rev）。
   前端把它当作「我打开时看到的版本」，保存时原样回传 ⇒ 不一致即 409。
   语义要点（决定了这里怎么用）：
     · 指纹只由**内容**决定（不按自增 id）⇒ 同一内容重复保存指纹不变，不会「自己和自己冲突」；
     · 覆盖范围 = 后端保存时真正会删改的那些行（导入报单 + 加单/单价 + 删列名册）
       ⇒ 别人改的是小程序报单（role≠'导入'）时**不会**误报冲突（保存也动不到它）；
     · 保存成功回执里带**新的** `matrix_rev`，直接采纳即可继续改，不必重新载入。 */
const matrixRev = ref('')
const matrixAt = ref('')   // 最后写入时刻（仅用于冲突对话框展示）
const matrixBy = ref('')   // 最后写入人显示名
const conflictInfo = ref(null)  // 409 冲突详情：{by, at, current_rev, items}（null = 无冲突）

/* ---- Excel 式交互（单元格选中 / 方向键导航 / 右键行列菜单 / 填充柄） ---- */
// 选中单元格坐标：r=行索引, c=统一列索引（主档列 0..n-1，客户列 n..n+m-1；操作列不参与导航）
const selected = ref({ r: -1, c: -1 })
/* v210（2026-09-20 用户拍板）：单元格**两态模型**。
   用户诉求是两条：「① 单击单元格应选中所有内容，便于快速修改已有内容」「② 要支持键盘方向键在
   不同单元格之间跳转」。这两条**单独看都很容易做，合在一起做就会打架** ——
   焦点落在一个 `<input>` 上时，方向键到底是「跳格」还是「在数字中间移光标」？
   当年 Q21（见 onGridKey 顶部的注释）为了治「想改一位数字却被跳格」，把方向键在输入框内**一律放行**，
   代价是 **② 整个功能等于不存在**：单元格被选中时焦点必定在 input 里 ⇒ 永远走不到跳格分支。
   ⇒ 正解不是二选一，而是像 Excel 那样**分两态**，用一个布尔量显式区分：

     · **导航态** `cellTyping = false`（默认；单击选中 / 键盘跳到的格子）
         - 单击即**全选内容** ⇒ 直接打字就是整体替换（诉求①）
         - 方向键 / Home / End / PageUp·Down **跨格跳转**（诉求②）
     · **输入态** `cellTyping = true`（双击 / F2 / 在**已选中的同一格**上再按一次）
         - 不强制全选，光标落在点击处 ⇒ 想改一位数字就改一位（Q21 的老诉求不丢）
         - 方向键放行给浏览器**在文本内移动光标**

   ⚠️ 本值只描述「当前聚焦格处于哪一态」，是**瞬态**、不入草稿、不参与保存载荷。
   ⚠️ 判定它是否生效必须**同时**看焦点是否真在输入框内（见 onGridKey 里的 `&& editing`），
      否则「拖框选」这类把输入框 blur 掉的操作会让它停留在 true ⇒ 方向键整体失效且不报错。 */
const cellTyping = ref(false)
const ctx = ref({ show: false, x: 0, y: 0, top: 0, r: -1, c: -1, type: '', key: '', ui: -1, deletable: false })
const ctxMenuEl = ref(null)
const fillEnd = ref({ r: -1, c: -1 })
let _fillStart = null
const ctxMenuStyle = computed(() => {
  const ww = typeof window !== 'undefined' ? window.innerWidth : 400
  const top = ctx.value.top != null ? ctx.value.top : ctx.value.y
  return { top: top + 'px', left: Math.min(ctx.value.x, ww - 190) + 'px' }
})
// 右键菜单越界翻转：菜单渲染后测真实高度，若向下溢出视口底部则向上弹，仍不够则贴底留 8px
// （菜单项数量动态，硬编码估算高度会漏算，必须在挂载后按真实 DOM 高度修正）
function fitCtxMenu() {
  nextTick(() => {
    const el = ctxMenuEl.value
    if (!el || !ctx.value.show) return
    const h = el.getBoundingClientRect().height
    const wh = window.innerHeight
    if (ctx.value.y + 6 + h > wh - 8) {
      let t = ctx.value.y - h - 6
      if (t < 8) t = Math.max(8, wh - h - 8)
      ctx.value.top = t
    }
  })
}
// 右键菜单：当前单元格是否为数字列（用于「按安全库存补齐」显隐）
const ctxNumCell = computed(() => {
  const v = ctx.value
  if (v.type === 'qty') return true
  if (v.type === 'master') { const col = visibleCols.value[v.c]; return !!(col && col.edit === 'num') }
  return false
})
// 右键是否落在当前选区上（决定「清空」作用于整片还是单格 / 是否提示 Delete）
const ctxHasRangeSel = computed(() => {
  const sr = selRange.value
  if (!sr) return false
  const { r, c } = ctx.value
  return c >= 0 && r >= sr.r0 && r <= sr.r1 && c >= sr.c0 && c <= sr.c1
})
// 「清空」按钮文案：选区内右键=清空选区；表体空白右键=作用于当前选中/提示先全选；否则=清空单格
const ctxClearLabel = computed(() => {
  if (ctxHasRangeSel.value) return '清空选区'
  if (ctx.value.type === 'body') return selRange.value ? '清空选区' : '清空当前选中'
  return '清空此单元格'
})
// 表头右键菜单状态（隐藏/冻结/排序）
const hdrCtx = ref({ show: false, x: 0, y: 0, key: '', type: 'master', ui: -1, mode: 'menu' })
const hdrRenameVal = ref('')
const hdrAddName = ref('')
const hdrAddType = ref('text')
const hdrRenameInput = ref(null)
const hdrAddInput = ref(null)
const frozenExtra = ref('')   // 商品名称之外额外冻结的列 key（会话级，仅一列）
// 表头右键「筛选」：按某一列的值过滤行（与全局搜索 findText 叠加生效）
const colFilter = ref(null)        // { key, type, ui, val } | null（包含筛选）
const colFilterSet = ref(null)     // { key, type, ui, values:[...] } | null（唯一值筛选：命中集合）
// 品牌（供货方）多选筛选：空数组=不过滤；非空时同时作用于表格显示(rowVisible)与复制动作
const brandSel = ref([])
/* v178：品牌取「**行内值优先、档案兜底**」。原实现档案优先 ⇒ 编辑网格里刚把品牌改成
   「蒙牛低温（恒滋）」的那一行，品牌筛选与「条码重复」判据仍按档案值算，用户刚做的改动
   在判据里不可见（改了却照样报重复）。只读表的行本身就来自档案（loadCross 注入），
   两种顺序结果相同，故本改动对只读面零影响。 */
function rowBrand(r) {
  const own = r && r.brand
  if (own != null && String(own).trim() !== '') return String(own).trim()
  const m = prodMeta.value[r && r.product_id]
  return String((m && m.brand) || '').trim()
}
const brandCandidates = computed(() => {
  const s = new Set()
  cross.value.rows.forEach(r => { const b = rowBrand(r); if (b) s.add(b) })
  return [...s].sort((a, b) => a.localeCompare(b, 'zh'))
})

/* v185：承接跨页品牌上下文（`#/forecast?brand=A,B`）。
   来源页＝「目标与返利 › 仪表盘」达成列表标题行的链接「实时达成（含预报贡献）→」
   （Rebate.vue 的 goSprint）。此前那个链接只做 `location.hash = '#/forecast'`，
   用户刚筛好的品牌到了这页就没了，还得重新勾一遍。
   🔴 两页品牌是**两套词表**：来源页给的是「品牌档案名 / 返利规则 scope_name」，
      本页 brandCandidates 来自「本期报单行的商品档案品牌（供货方）」⇒ 必须**求交集**后再落定。
      交集为空 = 词表对不上 ⇒ **什么都不筛**（静默降级）。宁可不过滤，也不能让用户
      一头撞进一张空表、还以为数据丢了。
   ⚠️ 时机：brandCandidates 由 cross.rows 异步装载，挂载瞬间恒为空 ⇒ 必须 watch 候选集，
      等到有货再判。`brandParamDone` 记住"这个参数值已处理过"，避免候选集每变一次就重筛一次
      （否则用户手动改完筛选会被立刻改回去 = 死控件）。参数被清空时复位，下次同值再来仍生效。 */
const route = useRoute()
const brandParamDone = ref('')
watch([brandCandidates, () => route.query.brand], () => {
  const q = String(route.query.brand || '').trim()
  if (!q) { brandParamDone.value = ''; return }
  if (brandParamDone.value === q) return
  const cand = brandCandidates.value || []
  if (!cand.length) return          // 报单数据未就位，等下一次触发
  const want = q.split(',').map(s => s.trim()).filter(Boolean)
  brandParamDone.value = q
  const hit = want.filter(w => cand.includes(w))
  if (!hit.length) return           // 词表对不上 → 不筛（静默降级，不弹错）
  brandSel.value = hit
  toast(`已按来源页品牌筛选：${hit.join('、')}`, 'success')
}, { immediate: true })

/* v243b：品牌筛选「本地记忆」（仅本页作用域）。
   - 用户勾选的品牌刷新/重进本页后自动恢复，免去重复勾选。
   - 🔴 不覆盖 v185 跨页上下文：`route.query.brand` 存在时由上文 watch 优先落定，本逻辑跳过还原。
   - 🔴 候选集校验：localStorage 里的值必须用当前 brandCandidates 过滤（过期/改名品牌不残留）。
   - 不污染跨页：键名带本页标识，且不写 route，不影响「目标与返利」来源页。 */
const BRAND_SEL_KEY = 'hergent.forecast.brandSel'
const brandRestored = ref(false)
watch(brandCandidates, () => {
  const cand = brandCandidates.value || []
  if (!cand.length) return                              // 报单数据未就位，等下一次触发
  if (brandRestored.value) return                       // 已处理过候选集就绪，避免重复/覆盖用户当前选择
  brandRestored.value = true
  if (String(route.query.brand || '').trim()) return     // 跨页参数优先，跳过本地恢复（写入仍启用）
  let saved = []
  try { saved = JSON.parse(localStorage.getItem(BRAND_SEL_KEY) || '[]') } catch (e) { saved = [] }
  if (!Array.isArray(saved)) saved = []
  const hit = saved.filter(b => cand.includes(b))
  if (hit.length) brandSel.value = hit                  // 仅恢复仍为有效候选的品牌
}, { immediate: true })

// 用户改动后写回本地（仅在已尝试恢复之后启用，避免挂载瞬间把初始 [] 写回覆盖旧值）
watch(brandSel, () => {
  if (!brandRestored.value) return
  try { localStorage.setItem(BRAND_SEL_KEY, JSON.stringify(brandSel.value || [])) } catch (e) {}
}, { deep: true })

const hdrFilterVal = ref('')
const hdrFilterInput = ref(null)
// 取某行在指定列上的「显示值」用于筛选（复用只读表渲染逻辑 cellText，兼容 master/qty/calc/计算列）
function cellValOf(r, key, type) {
  if (!r) return ''
  const col = type === 'qty'
    ? { key, type: 'qty' }
    : (colOrderList.value.find(c => c.key === key)
       || visibleCols.value.find(c => c.key === key)
       || { key, type: type === 'master' ? 'master' : 'calc' })
  return cellText(r, col)
}
// 当前列筛选是否放行该行（无筛选或值为空则放行）
function passColFilter(r) {
  const cf = colFilter.value
  if (cf && cf.val) {
    const v = String(cellValOf(r, cf.key, cf.type)).toLowerCase()
    if (!v.includes(cf.val.trim().toLowerCase())) return false
  }
  const cs = colFilterSet.value
  if (cs && cs.values && cs.values.length) {
    const v = String(cellValOf(r, cs.key, cs.type))
    if (!cs.values.includes(v)) return false
  }
  return true
}
// 由列 key/type/ui 解析可读列名（用于菜单占位与筛选提示）
function colLabel(key, type, ui) {
  if (type === 'qty') {
    const idx = ui >= 0 ? ui : cross.value.units.findIndex(x => x.name === key)
    const u = cross.value.units[idx]; return u ? u.name : key
  }
  const found = visibleCols.value.find(x => x.key === key)
    || colOrder.value.find(x => x.key === key)
    || colOrderList.value.find(x => x.key === key)
  if (found && found.label) return found.label
  const m = MASTER_COL_DEFS.find(x => x.key === key)
  return (m && m.label) || key
}
const hdrCtxStyle = computed(() => {
  const wh = typeof window !== 'undefined' ? window.innerHeight : 800
  const ww = typeof window !== 'undefined' ? window.innerWidth : 400
  return { top: Math.min(hdrCtx.value.y, wh - 180) + 'px', left: Math.min(hdrCtx.value.x, ww - 190) + 'px' }
})
// ===== 右键增强状态 =====
const condWarnOn = ref(false)      // 条件格式：库存<安全库存 整行高亮
const statsOpen = ref(false)       // 列统计弹层
const colStats = ref(null)         // { key, label, numeric, sum, avg, min, max, count, empty, distinct, sample }
/* v207：列统计面板按**列**选小数位 —— 箱数列必须与表格单元格同精度（3 位）。
   否则右键「合计(箱)」列的统计会显示 0.13，而同一屏的单元格写着 0.125 ⇒ 同屏两个精度。
   （用户对「同屏两个数对不上」最敏感，0.13 vs 0.125 正好会让人以为其中一个是错的。） */
function statFmt(key, n) { return key === 'boxes' ? fmtBox(n) : fmt(n) }
const hdrWidthVal = ref(120)       // 精确列宽输入
const uniqAll = ref(false)         // 唯一值筛选：全选
// 列统计：取某行在某列上的「数值」（可统计列返回 number，否则返回 null 视为文本列）
const NUMERIC_MASTER = { sale_price: 1, factory_price: 1, purchase_price: 1, dist_price: 1, safety_stock: 1, expiry_days: 1, moq: 1, lead_days: 1 }
function colStatVal(r, desc) {
  if (!r) return null
  if (desc.type === 'qty') return Number(r.qtyByUnit[desc.key] || 0)
  if (desc.type === 'master') {
    if (desc.edit === 'num' || NUMERIC_MASTER[desc.key]) return Number(r[desc.key] || 0)
    return String(r[desc.key] != null ? r[desc.key] : '')
  }
  // calc 列
  switch (desc.key) {
    case 'amount': { const av = amountValue(r); return av != null ? av : null }
    case 'qty': return Number(r.total || 0)
    case 'boxes': return Number(rowBoxes(r))
    case 'extra': return rowExtraQty(r)
    case 'final': return rowFinalQty(r)
    case 'ai': return r.ai != null ? Number(r.ai) : null
    case 'suggest': return Number(r.suggest || 0)
    case 'comparePrev': return prevQty(r)
    case 'compareDelta': return deltaQty(r)
    case 'yoyPrev': return yoyQty(r)
    case 'yoyDelta': return null
    case 'sum': return rowSum(r)
    default: return null
  }
}
function computeColStats(desc) {
  const nums = [], texts = []
  cross.value.rows.forEach(r => {
    const v = colStatVal(r, desc)
    if (v == null || (typeof v === 'number' && isNaN(v))) { texts.push('') ; return }
    if (typeof v === 'number') nums.push(v)
    else texts.push(String(v))
  })
  if (nums.length) {
    const sum = nums.reduce((a, b) => a + b, 0)
    const avg = sum / nums.length
    colStats.value = {
      key: desc.key, label: desc.label, numeric: true,
      sum, avg, min: Math.min(...nums), max: Math.max(...nums),
      count: nums.length, empty: texts.filter(t => !t).length,
      distinct: 0, sample: ''
    }
  } else {
    const nonEmpty = texts.filter(t => t !== '')
    const dist = new Set(nonEmpty)
    colStats.value = {
      key: desc.key, label: desc.label, numeric: false,
      sum: 0, avg: 0, min: 0, max: 0, count: nonEmpty.length,
      empty: texts.length - nonEmpty.length, distinct: dist.size,
      sample: Array.from(dist).slice(0, 6).join('、')
    }
  }
  statsOpen.value = true
}
// 由编辑表列索引 c 反推列描述（用于单元格右键「此列统计」）
function editColDescAt(c) {
  if (c <= 0) return null
  const vm = visibleCols.value.length
  if (c <= vm) { const m = visibleCols.value[c - 1]; return { type: 'master', key: m.key, label: m.label, edit: m.edit, cls: m.cls } }
  let k = c - vm
  const u = cross.value.units
  if (k < u.length) return { type: 'qty', key: u[k].name, label: u[k].name }
  k -= u.length
  const extra = ['amount']
  if (showSuggest.value) extra.push('suggest')
  if (compareOn.value) { extra.push('comparePrev'); extra.push('compareDelta') }
  if (showSpark.value) extra.push('spark')
  if (yoyOn.value) { extra.push('yoyPrev'); extra.push('yoyDelta') }
  extra.push('sum')
  const key = extra[k]; if (!key) return null
  const lblMap = { amount: '下单金额', suggest: '配方建议', comparePrev: '上期量', compareDelta: 'Δ', spark: '趋势', yoyPrev: '去年同期', yoyDelta: '同比', sum: '合计(小单位)' }
  return { type: 'calc', key, label: lblMap[key] || key }
}
// 分组小计：仅文本型主档列可分组
function groupableCol(key) { return ['product_code', 'unit', 'spec', 'category', 'brand'].includes(key) }

// 商品档案弹层
const prodProfile = ref(null)
/* 选区**面积**（格数）—— 与「有几个数字」是两件事。
   分开算的理由：「批量填入」的入口与提示要看的是**会被写入多少格**（面积），
   而「求和 / 平均 / 计数」看的是**选区里有多少个数字**。
   曾经把两者混成一个 `selStats`（没有数字就返回 null），
   于是框选一片空格子时整条统计条连同入口一起消失 —— v212 真机上抓到。
   面积是唯一的：占位符、菜单里的「N 格」、无数字时的回退文案都取它。 */
const selCellCount = computed(() => {
  const sr = selRange.value
  if (!sr) return 0
  return (sr.r1 - sr.r0 + 1) * (sr.c1 - sr.c0 + 1)
})
// 选区统计（求和/平均/计数）—— **只统计有数字的格**，没有就返回 null
const selStats = computed(() => {
  const sr = selRange.value
  if (!sr) return null
  const nums = []
  for (let r = sr.r0; r <= sr.r1; r++) {
    const rw = cross.value.rows[r]; if (!rw) continue
    for (let c = sr.c0; c <= sr.c1; c++) {
      let v
      if (c < visibleCols.value.length) { const col = visibleCols.value[c]; if (!col || col.edit !== 'num') continue; v = rw[col.key] }
      else { const ui = c - visibleCols.value.length; const u = cross.value.units[ui]; if (!u) continue; v = rw.qtyByUnit[u.name] }
      const n = Number(v)
      if (v !== '' && v != null && !isNaN(n)) nums.push(n)
    }
  }
  if (!nums.length) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return { count: nums.length, sum, avg: sum / nums.length }
})

/* v196（P0-2）：**商品档案字段的唯一映射** —— 保存载荷与「脏行判定」共用它。
   为什么必须唯一：若发载荷写一份字段清单、脏行判定另写一份，日后加字段只改一处，
   就会退化成「改了 A 却不算改动 ⇒ 保存时静默漏发」。这类"第二份拷贝"是本项目的老毛病
   （v189 的合计口径、v175 的校验判据都栽在同一坑上）。
   字段清单与取值写法**逐字沿用** v195 前 `saveEdits` 里的 prodRows 字面量 ⇒ 写入内容一字不变。 */
function prodPayloadOf(r) {
  const x = r || {}
  return {
    name: x.name || '', barcode: x.barcode || '', spec: x.spec || '', unit: x.unit || '件',
    sale_price: x.sale_price || 0, purchase_price: x.purchase_price || 0,
    /* 🔴 v226b：补齐 `factory_price`（元/箱 进价）—— 此前本映射**漏了它**，后果是
       「在预报页粘贴带进价的表 → 那列写进了行对象 → 保存时载荷不带它 → 静默不落库」，
       用户看到进价填了、下期打开又是空的（"填了没反应"的那一族）。
       🔴 **条件带键**（不是无条件 `|| 0`）：本对象同时是**脏行判定与写入载荷**的共用体，
       无条件带键会在 `factory_price` 为空的行上把库里已有的进价**清零**
       （同类缺陷在 `ProductArchive.vue` 的新增弹窗里已修过一次）。*/
    ...(Number(x.factory_price) > 0 ? { factory_price: Number(x.factory_price) } : {}),
    safety_stock: x.safety_stock || 0, expiry_days: x.expiry_days || 0,
    product_code: x.product_code || '', dist_price: x.dist_price || 0,
    brand: x.brand || '',
    moq: x.moq || 0, lead_days: x.lead_days || 0,
  }
}
/* v196（P0-2）：**基线** = 进入编辑态时服务端权威的商品档案值（pid → payload）。
   保存时只把「与基线不同」的行发出去 —— 此前每次保存都无脑 upsert 全部 ≈154 行。 */
const prodBaseline = ref(null)
function blankRow() {
  return { product_id: 0, name: '', barcode: '', spec: '', unit: '件',
    sale_price: 0, factory_price: 0, purchase_price: 0, safety_stock: 0, expiry_days: 0, product_code: '', dist_price: 0,
    price: 0, qtyByUnit: {}, ai: null }
}
function selectCell(r, c, shift) {
  if (shift && selected.value.r >= 0) {
    selAnchor.value = { r: selected.value.r, c: selected.value.c }
    selRange.value = normRange(selAnchor.value.r, selAnchor.value.c, r, c)
  } else {
    selAnchor.value = { r, c }
    selRange.value = null
  }
  selected.value = { r, c }
}
/* v210（需求②的连带缺陷，同批修）：**键盘跳到的格子不能被粘性列 / 粘性表头遮住**。
   🔴 为什么必须显式处理 —— 浏览器原生 focus() 的「滚进视口」是**最小滚动**语义：只把目标格
      送到滚动口的**边缘**就算「已可见」。而本表两处边缘都被粘性元素占据：
        · 左边缘：`.cross-tbl .seq-cell{position:sticky;left:0}`（序号 46px）
                  + `.cross-tbl .frozen{position:sticky;left:0;min-width:200px}`（商品名称）
                  ⇒ 冻结区实测约 250px
        · 上边缘：`.cross-tbl thead th{position:sticky;top:0}`
      浏览器不知道 sticky 会盖住内容 ⇒ 于是「跳过去 = 光标停在冻结列底下」，
      表现是**按了方向键，光标看不见**。这比「没跳」更难排查：格子确实被选中、值也能改，
      但用户看不到，会认为是随机失灵。
   🔴 这条路径是 **v210 新开出来的** —— 改之前方向键在输入框内一律放行，根本不会跳格
      （见 onGridKey 顶部注释），所以老版本不存在这个问题，不能算「历史遗留」。
   ⚠️ 只在**需要时**才滚：已经舒舒服服可见的格子一律不动，否则相邻格之间按方向键会不停抖动。
   ⚠️ 粘性格自身（序号 / 商品名称）**直接跳过**：它按定义永远可见，对它做补偿只会让
      横向滚动条无意义地漂移（按 Home 回首列时表体还停在右边 —— 那才是反直觉的）。 */
function keepCellClear(el) {
  const td = el.closest('td')
  if (td && getComputedStyle(td).position === 'sticky') return
  const wrap = el.closest('.table-wrap')
  if (!wrap) return
  const wr = wrap.getBoundingClientRect()
  /* 冻结区右边界：取本行所有 sticky 格子里最靠右的那个（行内通用，不写死 250px） */
  let leftGuard = wr.left
  const tr = el.closest('tr')
  if (tr) {
    for (const cell of tr.children) {
      if (getComputedStyle(cell).position === 'sticky') {
        const cr = cell.getBoundingClientRect()
        if (cr.right > leftGuard) leftGuard = cr.right
      }
    }
  }
  /* 粘性表头下边界（表头可能是多行，故取最大 bottom） */
  let topGuard = wr.top
  wrap.querySelectorAll('thead th').forEach((th) => {
    if (getComputedStyle(th).position === 'sticky') {
      const hr = th.getBoundingClientRect()
      if (hr.bottom > topGuard) topGuard = hr.bottom
    }
  })
  const M = 6  // 留一点余量，让格子边缘不贴着冻结区
  const r = el.getBoundingClientRect()
  if (r.left < leftGuard + M) wrap.scrollLeft -= (leftGuard + M - r.left)
  else if (r.right > wr.right - M) wrap.scrollLeft += (r.right - (wr.right - M))
  if (r.top < topGuard + M) wrap.scrollTop -= (topGuard + M - r.top)
  else if (r.bottom > wr.bottom - M) wrap.scrollTop += (r.bottom - (wr.bottom - M))
}
function focusCell(r, c, opts) {
  const doSelect = !opts || opts.select !== false
  /* v210：**所有键盘跳格都走这里**（方向键 / Enter / Tab / Home / End / PageUp·Down / Ctrl+方向键，
     以及 F2 与 Ctrl+Z 后的定位）。故「跳到新格 ⇒ 回到导航态」这条语义在此**统一落定**，
     各调用点不必各写一遍 —— 也让「漏了某条跳格路径没复位」这种错不可能发生。
     🔴 必须写在 nextTick **之前**：下面的 el.focus() 会**同步**触发模板上的 @focus（onFocusCell），
        那里面要读 cellTyping 才能决定「要不要全选」。放到 nextTick 里就晚了一步 ⇒
        用 F2 进输入态时会被 @focus 抢先把内容全选掉（正好把 F2 的语义做反）。 */
  cellTyping.value = !doSelect
  nextTick(() => {
    const el = document.querySelector(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) {
      el.focus()
      if (doSelect && el.select) { try { el.select() } catch (e) {} }
      /* 输入态（F2）：光标落到**末尾**，内容不清空 —— Excel 的 F2 就是这个手感。
         ⚠️ 数字输入框上 setSelectionRange 会抛 InvalidStateError（Chrome 至今如此），
            必须 try 包住；失败时保持浏览器默认行为（聚焦即落在末尾），不能让它冒泡中断。 */
      else if (el.setSelectionRange) { try { const n = String(el.value || '').length; el.setSelectionRange(n, n) } catch (e) {} }
      /* v210：跳到的格子若停在粘性列/粘性表头底下（原生 focus 的最小滚动会这样停），
         把它滚出来 —— 否则「按了方向键但光标看不见」。详见 keepCellClear 顶部注释。 */
      keepCellClear(el)
    }
  })
}
// 判断按键是否发生在正在编辑的输入框内（决定该放行给浏览器还是被表格导航拦截）
function isEditingInput(e) {
  const tag = e && e.target && e.target.tagName
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
}
// 键盘导航：Enter 下移 / Shift+Enter 上移 / Tab 右移(到头换下一行) / Shift+Tab 左移 / Esc 取消选中
/* v219 打磨①：整表「已用区域」右下角 —— Ctrl+End 的定位依据。
   行与列**独立**取最大有数据的下标（Excel 同口径）：右下角那一格自己可以是空的。
   ⚠️「空」的判据与全站同源：`'' / null / undefined / 0` 都算空 —— 数量格填 0 表达的就是
      「这一格不报」，把它当有数据会让定位跳到一长串 0 的尾巴上去（等于没跳）。 */
function lastDataPos () {
  const maxR = cross.value.rows.length - 1
  const maxC = visibleCols.value.length + unitCount() - 1
  let lr = -1
  let lc = -1
  for (let i = maxR; i >= 0; i--) {
    for (let j = maxC; j >= 0; j--) {
      const v = readCellVal(i, j)
      if (v === '' || v === null || v === undefined || Number(v) === 0) continue
      if (i > lr) lr = i
      if (j > lc) lc = j
    }
  }
  return { r: lr, c: lc }
}

function onGridKey(e) {
  if (!editMode.value) return
  const editing = isEditingInput(e)
  /* v210（需求②）：方向键 / Home / End / Ctrl+方向键 / PageUp·Down 在**输入态**放行给浏览器（字内移光标），
     在**导航态**则被下面的跳格分支接管 ⇒ 跨单元格跳转。

     🔴 Q21 的老注释（原文保留在此，因为它记录了「为什么当年不敢这么做」）：
        「方向键 / Home / End / Ctrl+方向键 在输入框内一律放行。原实现只对 Delete/Backspace 做了 tag
          判断，方向键没有 —— 导致用户跳格后内容被全选，想按左右键在数字中间改一位，结果直接跳到相邻格
          且新格又被全选，只能整格重输。这是最违背 Excel 心智的手感问题。」
        当年的处置治好了「改一位数字」，但代价是**方向键跳格功能等于不存在**
        （单元格一被选中，焦点必定落在 input 里 ⇒ 这个 return 必然命中 ⇒ 下面所有跳格分支都是死代码）。
        ⇒ v210 把判据从**过粗的「焦点在输入框内」**换成**两态**：`cellTyping` 才是「用户正在改文本」的信号。

     ⚠️ 必须 `&& editing`，不能只判 `cellTyping`：拖框选（onCellOver）会把输入框 blur 掉，
        但 cellTyping 仍是上次的 true ⇒ 只判它会**让拖框选之后方向键整体失效**（不报错、就是不动，
        与「键盘坏了」长得一样）。带上 editing 后，焦点不在输入框里就一律按导航处理，自愈。 */
  if (cellTyping.value && editing && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown')) return
  // Ctrl+A 在输入框内放行（选中本格文本），非编辑态才是「全选表格」
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (editing) return
    e.preventDefault(); selectAll(); return
  }
  const maxC = visibleCols.value.length + unitCount() - 1
  const maxR = cross.value.rows.length - 1
  let { r, c } = selected.value
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    if (selected.value.r >= 0) { e.preventDefault(); copyRegion() }
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    if (selected.value.r < 0) return
    e.preventDefault()
    const sr = selected.value.r, sc = selected.value.c
    const src = readCellVal(sr, sc)
    let er = sr
    if (selRange.value) er = selRange.value.r1
    else {
      /* Q6：无选区时原实现 er = sr，循环 `ri from sr+1 to sr` 不执行 → 按 Ctrl+D 毫无反应。
         现按 Excel 双击填充柄的行为：向下填到「下一个非空行」之前。 */
      let e2 = sr
      while (e2 + 1 <= maxR) {
        const nv = readCellVal(e2 + 1, sc)
        if (nv === '' || nv === null || nv === undefined || Number(nv) === 0) break
        e2++
      }
      er = e2
    }
    if (er === sr) { toast('请先框选填充范围，或确保下方有连续数据可填充', 'warn'); return }
    snapshot()
    for (let ri = sr + 1; ri <= er; ri++) writeCellVal(ri, sc, src)
    toast(`已向下填充 ${er - sr} 格`, 'ok')
    return
  }
  // Q22：Ctrl/Cmd+X 剪切选区（复制后清空），Excel 基本操作
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
    if (editing) return
    if (selected.value.r < 0) return
    e.preventDefault()
    copyRegion()
    clearRange()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (selRange.value) {
      e.preventDefault()
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
      batchWrite(readCellVal(selected.value.r, selected.value.c))
    }
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return   // 正在编辑输入框，放行删除字符
    if (!selRange.value && selected.value.r < 0) return
    e.preventDefault(); clearRange(); return
  }
  if (selected.value.r < 0) return
  if (e.key === 'Enter') {
    e.preventDefault(); r = Math.min(maxR, r + (e.shiftKey ? -1 : 1)); selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'Tab') {
    e.preventDefault(); c = e.shiftKey ? c - 1 : c + 1
    if (c < 0) { c = maxC; r = Math.max(0, r - 1) }
    if (c > maxC) { c = 0; r = Math.min(maxR, r + 1) }
    selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault(); r = Math.min(maxR, r + 1); selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); r = Math.max(0, r - 1); selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault(); c = Math.min(maxC, c + 1); selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault(); c = Math.max(0, c - 1); selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'F2') {
    /* v210：F2 = 进入**输入态**（Excel 同款：光标落末尾、内容保留）。
       原实现是 { select: true } = 全选，与「单击」完全等价 ⇒ 用户按 F2 想改一位数字，
       得到的是整格替换，等于这个键**白给**。 */
    e.preventDefault(); focusCell(r, c, { select: false })
  } else if (e.key === 'Escape') {
    if (errListOpen.value) { errListOpen.value = false; return }
    /* v210：输入态下 Esc 先**退回导航态**（Excel 心智：Esc 退出「正在编辑」）。
       ⚠️ 这里刻意**不回退内容** —— v-model 早已写进 r[c.key]，回退归「回退」按钮与 Ctrl+Z 管；
          在这里顺手还原会把「改到一半按 Esc」变成静默丢数据（而且 `change` 未提交，
          还原逻辑还得自己造一份副本，是纯粹的额外风险面）。只换态，零数据影响。 */
    if (cellTyping.value) { cellTyping.value = false; focusCell(r, c, { select: true }); return }
    selected.value = { r: -1, c: -1 }
  /* ---- Q22：补齐大表定位快捷键（428 行只靠滚轮找商品效率极低） ---- */
  } else if (e.key === 'Home') {
    e.preventDefault(); c = 0; selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'End') {
    e.preventDefault(); c = maxC; selectCell(r, c); focusCell(r, c)
  } else if (e.key === 'PageDown') {
    e.preventDefault(); r = Math.min(maxR, r + 20); selectCell(r, c); focusCell(r, c); gotoRowPage(r)
  } else if (e.key === 'PageUp') {
    e.preventDefault(); r = Math.max(0, r - 20); selectCell(r, c); focusCell(r, c); gotoRowPage(r)
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
    // 跳到当前列连续数据的最后一行（遇空行停），Excel 同款
    e.preventDefault()
    let nr = r
    while (nr + 1 <= maxR) {
      const nv = readCellVal(nr + 1, c)
      if (nv === '' || nv === null || nv === undefined || Number(nv) === 0) break
      nr++
    }
    /* v219 打磨③：Ctrl+**Shift**+方向键 = 从当前格**扩展选区**到连续数据边界（Excel 同款）。
       此前只支持不带 Shift 的跳转 ⇒ 要选一整片连续行只能鼠标拖，428 行表里极易拖过头。 */
    if (e.shiftKey) selectCell(nr, c, true)
    else selectCell(nr, c)
    focusCell(nr, c); gotoRowPage(nr)
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
    e.preventDefault()
    let nr = r
    while (nr - 1 >= 0) {
      const nv = readCellVal(nr - 1, c)
      if (nv === '' || nv === null || nv === undefined || Number(nv) === 0) break
      nr--
    }
    if (e.shiftKey) selectCell(nr, c, true)
    else selectCell(nr, c)
    focusCell(nr, c); gotoRowPage(nr)
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    /* 补齐 Ctrl+左右：原先**只有上下两个方向**，左右没实现 ⇒ 按下去毫无反应，
       与「键盘坏了」长得完全一样（不报错、就是不动）。语义与上下同源：
       跳到本行连续数据的最后一格 / 第一格（遇空格停）。 */
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    let nc = c
    while (nc + step >= 0 && nc + step <= maxC) {
      const nv = readCellVal(r, nc + step)
      if (nv === '' || nv === null || nv === undefined || Number(nv) === 0) break
      nc += step
    }
    if (e.shiftKey) selectCell(r, nc, true)
    else selectCell(r, nc)
    focusCell(r, nc); gotoRowPage(r)
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
    /* v219 打磨①：跳到**最后一处有数据**的格（Excel 的 Ctrl+End）。
       与 Ctrl+方向键的区别：后者只在本列/本行的**连续**数据里走、遇空格就停；
       本键**跨空行空列**，直接定位整张表已用区域的右下角 —— 428 行表里找最后一行报单
       不必滚到底。⚠️ 行列**独立**取最大值（Excel 同口径），不要求右下角那一格自己非空。 */
    e.preventDefault()
    const p = lastDataPos()
    if (p.r < 0) { toast('当前表格还没有填入任何数据', 'warn'); return }
    selectCell(p.r, p.c); focusCell(p.r, p.c); gotoRowPage(p.r)
  }
}
// 右键上下文菜单（插入/删除行、插入/删除列、清空内容）
function openCtx(e, r, c, type) {
  hdrCtx.value.show = false
  // 若右键位置已在当前选区内，保留选区（便于右键复制整片）；否则重置为单格
  const sr = selRange.value
  if (!sr || r < sr.r0 || r > sr.r1 || c < sr.c0 || c > sr.c1) selectCell(r, c)
  let key = '', ui = -1, deletable = false
  if (type === 'master') {
    const col = visibleCols.value[c]
    key = col ? col.key : ''; deletable = col ? !!col.deletable : false
  } else if (type === 'qty') {
    ui = c - visibleCols.value.length
  }
  ctx.value = { show: true, x: e.clientX, y: e.clientY, top: e.clientY, r, c, type, key, ui, deletable }
  fitCtxMenu()
}
/* v212（P2-3）：右键菜单的**内联子模式**。原菜单是纯按钮列表（点一下即关），
   而「批量填入相同值」需要一个输入框 —— 照 hdrCtx.mode 的既有范式加一层模式，
   而不是弹 window.prompt（prompt 会阻塞渲染线程、样式不可控、移动端体验差）。
   ⚠️ `ctxFillVal` 必须在 `closeCtx()` 里清空：菜单是复用的，残留上次输入会让
      第二次打开时输入框里躺着旧数字，用户以为「它默认就是这个值」。 */
const ctxMode = ref('menu')   // 'menu' | 'fill'
const ctxFillVal = ref('')
const ctxFillInput = ref(null)
function openCtxFill() {
  ctxMode.value = 'fill'
  ctxFillVal.value = ''
  /* 进子模式即聚焦（v-focus 指令只跑 mounted 一次，而这里只是模式切换、节点已存在
     ⇒ 必须手动 focus）。try 包住：聚焦失败不该中断右键菜单本身。 */
  nextTick(() => { try { if (ctxFillInput.value) ctxFillInput.value.focus() } catch (e) {} })
}
/* 把输入框里的值铺到整个选区 —— 与 Ctrl+Enter **同一个写入口**（batchWrite）。
   🔴 刻意复用而不是另写一份循环：`Ctrl+Enter` 那条路径已被生产验证（含只读列跳过、
      数值净化、快照入栈、提示文案），另写一份就是「同一条规则两处实现」的经典开局。
   ⚠️ **空值一律拒**：留空点「填入」如果被当成「清空选区」执行，用户会在毫不知情下删掉
      一整片数据（清空有它自己的入口 Delete / 「清空选区」，两者语义必须分开）。 */
function fillSelectionWith(raw) {
  const sr = selRange.value
  if (!sr) { toast('请先框选要填充的区域，再执行批量填入', 'warn'); return }
  const s = String(raw == null ? '' : raw).trim()
  if (s === '') { toast('请输入要填入的值（清空选区请用 Delete 或「清空选区」）', 'warn'); return }
  batchWrite(parseNumInput(s))
}
function applyCtxBatchFill() { const v = ctxFillVal.value; closeCtx(); fillSelectionWith(v) }
function applySelFill() { fillSelectionWith(ctxFillVal.value) }
function closeCtx() { ctxMode.value = 'menu'; ctxFillVal.value = ''; ctx.value.show = false }
// 表体任意位置右键统一入口（table 级冒泡）：
//  - 数据格（td[data-r][data-c]）→ 单元格菜单（master/qty）
//  - 行号 / 只读计算列 / 操作列（仅 data-r）→ 表体菜单（保留当前选中，供全选/复制/清空选区）
function onTbCtx(e) {
  if (!editMode.value) return
  const t = e.target
  const td = t && t.closest ? t.closest('td') : null
  if (!td) return
  const tr = td.parentElement
  if (!tr || !tr.parentElement || tr.parentElement.tagName !== 'TBODY') return  // 表头/合计行走 hdrCtx 或忽略
  const rAttr = td.getAttribute('data-r')
  if (rAttr == null) return
  const ri = parseInt(rAttr, 10)
  if (Number.isNaN(ri) || !cross.value.rows[ri]) return
  const cAttr = td.getAttribute('data-c')
  if (cAttr != null) {
    const ci = parseInt(cAttr, 10)
    openCtx(e, ri, ci, ci < visibleCols.value.length ? 'master' : 'qty')
    return
  }
  openBodyCtx(e, ri)
}
// 表体空白（行号/只读列/操作列）右键：保留当前选中与选区，弹表体级菜单
function openBodyCtx(e, r) {
  hdrCtx.value.show = false
  ctx.value = { show: true, x: e.clientX, y: e.clientY, top: e.clientY, r, c: -1, type: 'body', key: '', ui: -1, deletable: false }
  fitCtxMenu()
}
// 右键菜单「复制选区」：关闭菜单后复制当前选区（保留拖选区域）
function ctxCopy() { closeCtx(); copyRegion() }
// 右键菜单「粘贴」：以右键单元格为锚点，读取系统剪贴板并区块填充（自动进撤销栈）
async function ctxPaste() {
  const ar = ctx.value.r, ac = ctx.value.c
  closeCtx()
  selected.value = { r: ar, c: ac }
  selRange.value = null
  let text = ''
  try {
    if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText()
    else if (window.clipboardData && window.clipboardData.getData) text = window.clipboardData.getData('Text')
  } catch (e) {
    toast('无法读取剪贴板，请改用 Ctrl+V 粘贴', 'warn')
    return
  }
  if (!text || !text.trim()) { toast('剪贴板为空', 'warn'); return }
  pasteRegion(text)
}
function ctxInsertRow(above) {
  snapshot()
  const at = above ? ctx.value.r : ctx.value.r + 1
  cross.value.rows.splice(at, 0, blankRow())
  closeCtx()
}
function ctxDeleteRow() {
  if (ctx.value.r >= 0) { snapshot(); cross.value.rows.splice(ctx.value.r, 1) }
  closeCtx()
}
function ctxInsertCol(left) {
  if (ctx.value.type !== 'qty') return
  snapshot()
  const ui = ctx.value.ui
  const at = left ? ui : ui + 1
  let base = unitCount() + 1, i = 1, name = '新客户' + base
  while (cross.value.units.find(u => u.name === name)) { name = '新客户' + (base + i++); }
  cross.value.units.splice(at, 0, { name, role: '' })
  cross.value.rows.forEach(rw => { if (!(name in rw.qtyByUnit)) rw.qtyByUnit[name] = 0 })
  closeCtx()
}
function ctxDeleteCol() {
  if (ctx.value.type === 'qty') { snapshot(); delCol(ctx.value.ui) }
  else if (ctx.value.type === 'master' && ctx.value.deletable) { snapshot(); deleteMasterCol(ctx.value.key) }
  closeCtx()
}
// 右键「清空」：右键落在现有选区上（或表体空白且已有选区）→ 清空整个选区；否则清空该单元格
function ctxClear() {
  const { r, c, type, key, ui } = ctx.value
  closeCtx()
  const sr = selRange.value
  const inSel = !!(sr && c >= 0 && r >= sr.r0 && r <= sr.r1 && c >= sr.c0 && c <= sr.c1)
  if (sr && (inSel || type === 'body')) { clearRange(); return }   // clearRange 自带 snapshot + 撤销
  if (type === 'body') { toast('请先框选区域或点「全选编辑区域」，再执行清空', 'warn'); return }
  if (r < 0) return
  /* v184：只读列（edit:'ro'，目前是「到货周期」）**不接受清空**。
     本函数是**绕过 writeCellVal 的第二条写路径**（直接 `rw[key] = ''`）⇒ 只在
     writeCellVal 里加闸门不够：右键「清空此单元格」会把 rw.arrival_lead_days 置空，
     界面立刻显示「—」，但网格保存的字段白名单里没有 arrival_lead_days ⇒ 一刷新又变回 +3天。
     「清了会自己回来」比「清不动」更糟 —— 用户会以为系统在丢数据。
     故与 toggleCol / quickHide / hdrFreezeCol 同一处理：显式提示 + 不做，并说清该去哪改。
     🔴 v184b：提示语必须指向**真实存在**的改法 —— 此前只说「由预报导入决定」，
        而现在是两个写入口（导入 / 商品档案），用户拿到的应是「去哪能改」而不是「不能改」。 */
  if (type === 'master' && visibleCols.value[c] && visibleCols.value[c].edit === 'ro') {
    toast('「' + (visibleCols.value[c].label || key) + '」在网格里只读；要改请到「商品档案」页点该商品的到货周期格（或走预报导入）', 'warn')
    return
  }
  snapshot()
  const rw = cross.value.rows[r]
  if (rw) {
    if (type === 'qty') rw.qtyByUnit[cross.value.units[ui].name] = 0
    else if (type === 'master') rw[key] = (visibleCols.value[c] && visibleCols.value[c].edit === 'num') ? 0 : ''
  }
}
// 右键「全选编辑区域」：选中主档可编辑列 + 各报单单元数量列的整块矩形（等价 Ctrl+A）
function ctxSelectAll() {
  closeCtx()
  const mr = cross.value.rows.length - 1
  const mc = visibleCols.value.length + unitCount() - 1
  if (mr < 0 || mc < 0) { toast('表格暂无数据，可先「补录商品」或粘贴导入', 'warn'); return }
  selectAll()
  toast(`已全选 ${mr + 1} 行 × ${mc + 1} 列编辑区 — 可 Ctrl+C 复制 / Delete 清空，或在本菜单选「复制选区 / 清空选区」`, 'ok')
}
// 右键「按安全库存补齐」：把当前数字格填到该商品的安全库存
function ctxFillSafety() {
  snapshot()
  const { r, type, key, ui } = ctx.value
  const rw = cross.value.rows[r]
  if (rw) {
    const tgt = Number(rw.safety_stock) || 0
    if (type === 'qty') rw.qtyByUnit[cross.value.units[ui].name] = tgt
    else if (type === 'master') rw[key] = tgt
  }
  closeCtx()
  toast('已按安全库存补齐', 'ok')
}
// 右键「查看商品档案」：打开只读弹层
function ctxViewProfile() {
  const r = ctx.value.r
  const rw = cross.value.rows[r]
  if (rw) prodProfile.value = rw
  closeCtx()
}
// 右键「复制此行到下方」：克隆整行作为新行（product_id 置 0 避免重复主键），可撤销
function ctxCopyRow() {
  snapshot()
  const at = ctx.value.r + 1
  const src = cross.value.rows[ctx.value.r]
  if (src) {
    const nr = clone(src)
    nr.product_id = 0
    cross.value.rows.splice(at, 0, nr)
  }
  closeCtx()
  toast('已复制此行到下方', 'ok')
}
// 右键「导出选中行」：把选区（或当前行）导出为 xlsx
function ctxExportSel() {
  closeCtx()
  const sr = selRange.value
  let rows
  if (sr) rows = cross.value.rows.slice(sr.r0, sr.r1 + 1)
  else { const rw = cross.value.rows[ctx.value.r]; rows = rw ? [rw] : [] }
  if (!rows.length) { toast('没有可导出的行', 'warn'); return }
  buildXlsx(rows, `${(cross.value.period && cross.value.period.name) || '预报单'}_选中${rows.length}行`)
  toast('已导出选中行', 'ok')
}
// 工具栏「导出」：导出当前预报订单汇总表全部行（受筛选影响，沿用 buildXlsx 口径）
function exportAllXlsx() {
  const rows = cross.value.rows || []
  if (!rows.length) { toast('没有可导出的数据', 'warn'); return }
  buildXlsx(rows, `${(cross.value.period && cross.value.period.name) || '预报单'}_汇总`)
  toast('已导出预报订单汇总表', 'ok')
}
// 舟谱导入模板生成下载（导出下拉三项）：窗口=当前选中期次 order_start~order_end，后端确定性生成（不依赖 LLM）
const zhoupuBusy = ref('')
async function zhoupuGen(tid) {
  const p = currentPeriod.value
  if (!p) { toast('请先在期次下拉选择要导出的报单期次', 'warn'); return }
  const LAB = { 'zhoupu-pickup': '自提订单', 'zhoupu-transfer': '调拨订单', 'zhoupu-all': '合并包' }
  const lab = LAB[tid] || tid
  zhoupuBusy.value = tid
  try {
    const r = await forecastApi.zhoupuGenerate(tid, { start: p.order_start || '', end: p.order_end || '' })
    const url = URL.createObjectURL(r.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.fname || `舟谱${lab}导入模板.xlsx`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    const info = tid === 'zhoupu-all' ? (r.rows || '') : (r.rows ? `${r.rows} 行` : '')
    toast(`已下载${lab}导入文件${info ? '（' + info + '）' : ''}`, 'ok')
    if (r.warnings) toast(`提示：${r.warnings}`, 'warn')
    exportMenuOpen.value = false
  } catch (e) {
    toast(e.message || `生成${lab}导入文件失败`, 'err')
  } finally { zhoupuBusy.value = '' }
}
// 表头右键：打开列操作菜单
function openHdrCtx(e, key, type, ui = -1) {
  ctx.value.show = false
  hdrCtx.value = { show: true, x: e.clientX, y: e.clientY, key, type,
    ui: ui < 0 ? (type === 'qty' ? cross.value.units.findIndex(u => u.name === key) : -1) : ui,
    mode: 'menu' }
}
function closeHdrCtx() { hdrCtx.value.show = false; hdrCtx.value.mode = 'menu' }
// 表头右键 → 筛选：进入内联输入框
function startHdrFilter() {
  const cf = colFilter.value
  hdrFilterVal.value = (cf && cf.key === hdrCtx.value.key && cf.type === hdrCtx.value.type) ? cf.val : ''
  hdrCtx.value.mode = 'filter'
  nextTick(() => { if (hdrFilterInput.value) hdrFilterInput.value.focus() })
}
function applyHdrFilter() {
  const { key, type, ui } = hdrCtx.value
  const v = (hdrFilterVal.value || '').trim()
  if (!v) { clearColFilter(); return }
  colFilter.value = { key, type, ui, val: v }
  closeHdrCtx()
}
function clearColFilter() {
  colFilter.value = null
  if (hdrCtx.value.mode === 'filter') { hdrCtx.value.mode = 'menu'; hdrFilterVal.value = '' }
}
// ===================== 右键增强功能 =====================
// A. 让 AI 分析这一行（调用 Hermes 副驾）
function ctxAskAi() {
  const r = cross.value.rows[ctx.value.r]; if (!r) return
  let hist = ''
  try { (r.history || []).slice(-4).forEach(h => { hist += ` ${h.period}:${h.qty || h.value || ''}` }) } catch (e) {}
  const units = cross.value.units.map(u => `${u.name}:${r.qtyByUnit[u.name] || 0}`).join('，')
  hermesCtx.value = `我是低温奶经销商，请基于以下商品分析本期订货建议，重点说明：是否合理、库存/货损风险、可优化点。\n商品：${r.name}（规格 ${r.spec || '—'} ${r.unit || ''}）\n安全库存：${r.safety_stock || 0}　保质期：${r.expiry_days || 0}天\n各报单单元订量：${units || '无'}\n合计：${r.total || 0}${r.unit || ''}　下单金额：¥${fmt(r.amount)}\n系统建议：${r.ai != null ? r.ai : '—'}\n历史销量：${hist || '无'}`
  hermesOpen.value = true
  closeCtx()
  runHermes()
}
// B. 向下/向右填充
function ctxFillDown() {
  const { r, c } = ctx.value
  snapshot()
  const src = readCellVal(r, c)
  const last = cross.value.rows.length - 1
  for (let i = r + 1; i <= last; i++) writeCellVal(i, c, src)
  recomputeTotals(); closeCtx(); toast('已向下填充', 'ok')
}
function ctxFillRight() {
  const { r, c } = ctx.value
  snapshot()
  const src = readCellVal(r, c)
  const last = visibleCols.value.length + unitCount() - 1
  for (let i = c + 1; i <= last; i++) writeCellVal(r, i, src)
  recomputeTotals(); closeCtx(); toast('已向右填充', 'ok')
}
// C. 此列统计（单元格入口）
function ctxColStats() {
  const d = editColDescAt(ctx.value.c); closeCtx()
  if (!d) { toast('该列不可统计', 'warn'); return }
  computeColStats(d)
}
// G. 此列统计（表头入口）
function hdrColStats() {
  const { key, type, ui } = hdrCtx.value
  let d
  if (type === 'qty') d = { type: 'qty', key, label: (cross.value.units[ui] || { name: key }).name }
  else if (type === 'master') { const m = visibleCols.value.find(x => x.key === key); d = { type: 'master', key, label: colLabel(key, type, ui), edit: m ? m.edit : undefined } }
  else d = { type: 'calc', key, label: colLabel(key, type, ui) }
  closeHdrCtx(); computeColStats(d)
}
// D. 条件格式：库存<安全库存 整行高亮
function toggleCondWarn() { condWarnOn.value = !condWarnOn.value; closeCtx() }
// E. 复制选区为 CSV / Markdown
function colHeaderAt(c) {
  if (c <= 0) return '序号'
  const vm = visibleCols.value.length
  if (c <= vm) return visibleCols.value[c - 1].label
  let k = c - vm
  const u = cross.value.units
  if (k < u.length) return u[k].name
  k -= u.length
  const extra = ['amount']
  if (showSuggest.value) extra.push('suggest')
  if (compareOn.value) { extra.push('comparePrev'); extra.push('compareDelta') }
  if (showSpark.value) extra.push('spark')
  if (yoyOn.value) { extra.push('yoyPrev'); extra.push('yoyDelta') }
  extra.push('sum')
  const m = { amount: '下单金额', suggest: '配方建议', comparePrev: '上期量', compareDelta: 'Δ', spark: '趋势', yoyPrev: '去年同期', yoyDelta: '同比', sum: '合计(小单位)' }
  return m[extra[k]] || extra[k]
}
function regionRect() {
  let r0, c0, r1, c1
  if (selRange.value) { r0 = selRange.value.r0; c0 = selRange.value.c0; r1 = selRange.value.r1; c1 = selRange.value.c1 }
  else { const { r, c } = selected.value; if (r < 0) return null; r0 = r1 = r; c0 = c1 = c }
  return { r0, c0, r1, c1 }
}
function ctxCopyCsv() {
  const rect = regionRect(); if (!rect) { toast('请先选中单元格', 'warn'); return }
  const { r0, c0, r1, c1 } = rect
  const esc = s => { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const head = []; for (let j = c0; j <= c1; j++) head.push(esc(colHeaderAt(j)))
  const lines = [head.join(',')]
  for (let i = r0; i <= r1; i++) { const row = []; for (let j = c0; j <= c1; j++) row.push(esc(readCellVal(i, j))); lines.push(row.join(',')) }
  _copyText(lines.join('\n'), 'CSV', `已复制 ${r1 - r0 + 1}×${c1 - c0 + 1} 为 CSV`)
  closeCtx()
}
function ctxCopyMd() {
  const rect = regionRect(); if (!rect) { toast('请先选中单元格', 'warn'); return }
  const { r0, c0, r1, c1 } = rect
  const head = []; for (let j = c0; j <= c1; j++) head.push(colHeaderAt(j))
  const lines = ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |']
  for (let i = r0; i <= r1; i++) { const row = []; for (let j = c0; j <= c1; j++) row.push(String(readCellVal(i, j))); lines.push('| ' + row.join(' | ') + ' |') }
  _copyText(lines.join('\n'), 'Markdown', `已复制 ${r1 - r0 + 1}×${c1 - c0 + 1} 为 Markdown`)
  closeCtx()
}
// F. 本行加备注
function ctxSetNote() { const ri = ctx.value.r; closeCtx(); setRowNote(ri) }
// H. 唯一值筛选（表头入口）
function startHdrUniq() {
  const { key, type, ui } = hdrCtx.value
  const set = new Set()
  cross.value.rows.forEach(r => { const v = String(cellValOf(r, key, type)); if (v !== '') set.add(v) })
  const vals = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'))
  hdrUniqVals.value = vals; hdrUniqChecked.value = vals.slice(); uniqAll.value = true
  hdrCtx.value.mode = 'uniq'
  hdrCtx.value._fk = { key, type, ui }
}
const hdrUniqVals = ref([])
const hdrUniqChecked = ref([])
function toggleUniqVal(v) {
  const i = hdrUniqChecked.value.indexOf(v)
  if (i >= 0) hdrUniqChecked.value = hdrUniqChecked.value.filter(x => x !== v)
  else hdrUniqChecked.value = [...hdrUniqChecked.value, v]
  uniqAll.value = hdrUniqChecked.value.length === hdrUniqVals.value.length
}
function applyHdrUniq() {
  const fk = hdrCtx.value._fk; if (!fk) return
  if (!hdrUniqChecked.value.length) { clearUniqFilter(); return }
  colFilter.value = null
  colFilterSet.value = { key: fk.key, type: fk.type, ui: fk.ui, values: hdrUniqChecked.value.slice() }
  closeHdrCtx(); toast('已按唯一值筛选', 'ok')
}
function clearUniqFilter() { colFilterSet.value = null; if (hdrCtx.value.mode === 'uniq') hdrCtx.value.mode = 'menu' }
// I. 分组小计（表头入口）
function hdrGroupBy() { const { key } = hdrCtx.value; groupBy.value = key; closeHdrCtx(); toast('已按「' + colLabel(key, 'master', -1) + '」分组', 'ok') }
// J. 复制列名（表头入口）
function hdrCopyName() { const { key, type, ui } = hdrCtx.value; _copyText(colLabel(key, type, ui), '列名', '已复制列名'); closeHdrCtx() }
// K. 精确列宽（表头入口）
function startHdrWidth() { const { key } = hdrCtx.value; hdrWidthVal.value = colW(key); hdrCtx.value.mode = 'width' }
function applyHdrWidth() {
  const { key } = hdrCtx.value
  let w = parseInt(hdrWidthVal.value); if (isNaN(w) || w < 40) w = 40
  colWidths.value = { ...colWidths.value, [key]: w }
  try { localStorage.setItem('hergent-forecast-col-widths', JSON.stringify(colWidths.value)) } catch (e) {}
  closeHdrCtx(); toast('列宽已设为 ' + w + 'px', 'ok')
}
function sortByCol(dir) {
  const { key, type } = hdrCtx.value
  snapshot()
  const arr = cross.value.rows
  const dirN = dir === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    let av, bv
    if (type === 'qty') { av = a.qtyByUnit[key] || 0; bv = b.qtyByUnit[key] || 0 }
    else if (key === 'name') { return dirN * (a.name || '').localeCompare((b.name || ''), 'zh') }
    else { av = a[key] || 0; bv = b[key] || 0 }
    return dirN * (Number(av) - Number(bv))
  })
  cross.value.rows = arr
  saveDraftNow()
  closeHdrCtx()
}
function hdrHideCol() {
  toggleCol(hdrCtx.value.key)
  closeHdrCtx()
}
function hdrFreezeCol() {
  const k = hdrCtx.value.key
  /* v184：固定列（FROZEN_COLS）本就常驻冻结区，不接受「手动冻结」——
     若让 frozenExtra 指向它们，就会与 c.fixed 的 left 争同一个位置（表现为点了没反应 / 错位）。
     ⚠️ 显式提示而非静默 no-op：静默无操作会被当成 bug 反复点（「按钮点了没反应」的经典形态）。 */
  if (FROZEN_COLS.includes(k)) {
    const lb = (visibleCols.value.find(c => c.key === k) || {}).label || k
    toast('「' + lb + '」是固定列，始终冻结', 'warn')
    closeHdrCtx()
    return
  }
  frozenExtra.value = (frozenExtra.value === k) ? '' : k
  closeHdrCtx()
}

/* ---- v161 列注册表：不可删除列由**服务端**决定，自定义列的定义与值也落服务端 ----
   改造前：deletable 由前端 MASTER_COL_DEFS 说了算；自定义列定义存 forecast_cols_v1、
   值存 forecast_customvals_v1（按 `条码::名称` 定位）—— 换设备即丢，商品改名/改条码还会**丢值**。
   现在：GET /api/forecast/columns 下发 system（不可删除）与 custom（自建），
        值走 /api/products/extra-values，按 product_id 定位。 */
const protectedKeys = ref(new Set())   // 服务端下发的不可删除列 key
const registryColumns = ref([])        // 服务端下发的自定义列 [{key,label,type}]
const registryOk = ref(false)          // 注册表是否成功加载（失败时降级，并提示而不是静默）
let _registryWarned = false

async function loadColumnRegistry() {
  try {
    const d = await forecastColumnsApi.list()
    const cols = d && d.columns ? d.columns : {}
    protectedKeys.value = new Set((cols.system || []).map(c => c.key))
    registryColumns.value = (cols.custom || []).map(c => ({ key: c.key, label: c.label, type: c.type }))
    registryOk.value = true
    reconcileCustomColumns()
    return true
  } catch (e) {
    registryOk.value = false
    if (!_registryWarned) {
      _registryWarned = true
      // 降级但不静默：明确告诉用户"这次用的是本地内置规则"，避免把降级误当正常
      toast('列配置未能从服务器加载，本次按内置规则显示（新增/删除列不可用）', 'warn')
    }
    return false
  }
}

/* 主档列是否可删除：自定义列恒可删；内置列以**服务端注册表**为准（加载失败才回落 MASTER_COL_DEFS）。
   v192：补一道**本地硬否决** —— MASTER_COL_DEFS 里显式 `deletable: false` 的内置列一律不可删，
   哪怕服务端注册表没把它列进 PROTECTED_COLUMNS。
   为什么必须有这道否决（实测）：内置列被 deleteMasterCol 从 colOrder 移除后，`loadCols` 的
   「合并新增主档列」会把它当成「元数据里有、本地没有」⇒ **下次刷新原样补回来**。于是
   「右键 → 删除列」成了一条**看着成功、刷新即复原**的死路（同族陷阱：清了会自己回来比清不动更糟，
   用户会以为系统在丢数据）。要让内置列从视野里消失，正解是**隐藏** —— colVis 会被持久化、
   loadCols 也认它（本轮「到货周期」就是这么处理的）。
   ⚠️ 影响面恰好只有「到货周期」一列：其余 `deletable:false` 的内置列（条码/分销价/厂家编码）
   本就在服务端 PROTECTED_COLUMNS 里 ⇒ 本否决对它们等价、零行为变化。 */
function canDeleteMaster(key) {
  const c = colOrder.value.find(x => x.key === key)
  if (c && c.custom) return true
  const m = MASTER_COL_DEFS.find(x => x.key === key)
  if (m && m.deletable === false) return false
  if (registryOk.value) return !protectedKeys.value.has(key)
  return !!(m && m.deletable)
}

// 把服务端的自定义列并入列顺序：服务端有的补进来；服务端已删的本地列剔除。
// 本地只保留"顺序/显隐"这类显示偏好，**不再持有列的存在性**。
function reconcileCustomColumns() {
  const order = colOrder.value.slice()
  const serverKeys = new Set(registryColumns.value.map(c => c.key))
  // ① 服务端已删除的自定义列 → 从本地剔除（数值也一并清）
  for (let i = order.length - 1; i >= 0; i--) {
    if (order[i].custom && !serverKeys.has(order[i].key)) order.splice(i, 1)
  }
  // ② 服务端有、本地没有的自定义列 → 追加到末尾
  const have = new Set(order.map(c => c.key))
  registryColumns.value.forEach(sc => {
    if (!have.has(sc.key)) {
      order.push({ key: sc.key, label: sc.label, cls: sc.type === 'number' ? 'fc-num' : 'fc-text', edit: sc.type === 'number' ? 'num' : 'text', deletable: true, custom: true })
      colVis.value[sc.key] = true
    }
  })
  colOrder.value = order
  _persistCols()
}

// 自定义列的值：**服务端**（products.extra_json，按 product_id）。localStorage 仅作一次性迁移来源。
const CUSTVAL_KEY = 'forecast_customvals_v1'   // ← 仅用于迁移旧数据，迁移后即删
function _loadLegacyCustVals() { try { return JSON.parse(localStorage.getItem(CUSTVAL_KEY) || '{}') } catch (e) { return {} } }
function _legacyProdKeyOf(r) { return (r.barcode || '') + '::' + (r.name || '') }

// 一次性迁移：把旧版存在本机的自定义列值推到服务端（只补服务端为空的商品），成功后清掉本地键。
// 为什么必须迁移：不迁 = 用户此前手工填过的值会**无声消失**（旧键按 条码::名称 定位，服务端对不上）。
async function migrateLegacyCustVals() {
  const custKeys = colOrder.value.filter(c => c.custom).map(c => c.key)
  if (!custKeys.length || !cross.value.rows) return
  const map = _loadLegacyCustVals()
  const keys = Object.keys(map)
  if (!keys.length) return
  const items = []
  cross.value.rows.forEach(r => {
    const m = map[_legacyProdKeyOf(r)]
    if (!m || !r.product_id) return
    const vals = {}
    custKeys.forEach(k => { if (k in m && (r[k] === undefined || r[k] === null || r[k] === '')) vals[k] = m[k] })
    if (Object.keys(vals).length) {
      items.push({ id: r.product_id, values: vals })
      custKeys.forEach(k => { if (k in vals) r[k] = vals[k] })   // 同时反映到当前界面，免得看起来"没迁"
    }
  })
  if (!items.length) { try { localStorage.removeItem(CUSTVAL_KEY) } catch (e) {} return }
  try {
    const res = await productsApi.extraValues(items)
    try { localStorage.removeItem(CUSTVAL_KEY) } catch (e) {}
    toast(`已把本机存的 ${res.updated} 条自定义列数据同步到服务器`, 'ok')
  } catch (e) { /* 迁移失败就保留本地键，下次进页面再试，绝不静默丢弃 */ }
}

// 保存：把当前表格里的自定义列值写回服务端（合并写；空值 = 删除该键）
async function collectCustVals() {
  const custKeys = colOrder.value.filter(c => c.custom).map(c => c.key)
  if (!custKeys.length || !cross.value.rows) return
  const items = []
  cross.value.rows.forEach(r => {
    if (!r.product_id) return
    const vals = {}
    custKeys.forEach(k => { vals[k] = r[k] != null ? r[k] : '' })
    items.push({ id: r.product_id, values: vals })
  })
  if (!items.length) return
  try {
    const res = await productsApi.extraValues(items)
    if (res && (res.skipped || []).length) {
      toast(`有 ${res.skipped.length} 行的自定义列未写入（商品已不存在）`, 'warn')
    }
  } catch (e) {
    // 不能吞：自定义列没落库就是**静默丢数据**，必须让用户知道
    toast('自定义列数据保存失败：' + (e && e.message ? e.message : '请重试'), 'warn')
  }
}

// 修改字段：进入内联重命名
function startHdrRename() {
  const { key, type } = hdrCtx.value
  let cur = ''
  if (type === 'qty') { const u = cross.value.units.find(x => x.name === key); cur = u ? u.name : '' }
  else { const c = colOrder.value.find(x => x.key === key); cur = c ? c.label : '' }
  hdrRenameVal.value = cur
  hdrCtx.value.mode = 'rename'
  nextTick(() => { if (hdrRenameInput.value) hdrRenameInput.value.focus(); if (hdrRenameInput.value) hdrRenameInput.value.select && hdrRenameInput.value.select() })
}
function applyHdrRename() {
  const v = (hdrRenameVal.value || '').trim()
  const { key, type } = hdrCtx.value
  if (v) {
    if (type === 'qty') {
      const ui = cross.value.units.findIndex(u => u.name === key)
      if (ui >= 0) renameCol(ui, v)
    } else {
      const c = colOrder.value.find(x => x.key === key)
      if (c) { c.label = v; _persistCols() }
    }
  }
  closeHdrCtx()
}
// 增加列：进入内联新增（主档列 → 插入自定义字段列；报单单元列 → 新增客户列）
function startHdrAdd() {
  hdrAddName.value = ''
  hdrAddType.value = 'text'
  hdrCtx.value.mode = 'add'
  nextTick(() => { if (hdrAddInput.value) hdrAddInput.value.focus() })
}
async function applyHdrAdd() {
  const v = (hdrAddName.value || '').trim()
  const { type } = hdrCtx.value
  if (v) {
    // v170：客户列统一走 addUnit()（唯一实现，含重名提示）。
    //   原先此处自带一份 push 逻辑、重名时静默不提示，与表头输入框那份已经漂移。
    if (type === 'qty') addUnit(v)
    else await addCustomMasterCol(v, hdrAddType.value)
  }
  closeHdrCtx()
}
// 自定义列：**先在服务端登记拿稳定 key**，再插进列顺序。
// 为什么不能像以前那样本地造 key：本地随机 key（cust_xxx）只活在这台浏览器，
// 服务端引用不到，换设备后这一列连同它上面的数据都会消失（2026-09-15 前的实际行为）。
async function addCustomMasterCol(name, editType) {
  if (!registryOk.value) { toast('列配置未从服务器加载，暂时不能新增列', 'warn'); return }
  let col = null
  try {
    const r = await forecastColumnsApi.add({ label: name, type: editType === 'num' ? 'number' : 'text' })
    col = r && r.column
  } catch (e) {
    toast('新增列失败：' + (e && e.message ? e.message : '请重试'), 'warn')
    return
  }
  if (!col || !col.key) { toast('新增列失败：服务端未返回列标识', 'warn'); return }
  snapshot()
  const key = col.key
  const newCol = { key, label: col.label || name, cls: editType === 'num' ? 'fc-num' : 'fc-text', edit: editType, deletable: true, custom: true }
  const idx = colOrder.value.findIndex(c => c.key === hdrCtx.value.key)
  if (idx >= 0) colOrder.value.splice(idx + 1, 0, newCol)
  else colOrder.value.push(newCol)
  colVis.value[key] = true
  registryColumns.value = [...registryColumns.value, { key, label: newCol.label, type: col.type || 'text' }]
  const def = editType === 'num' ? 0 : ''
  cross.value.rows.forEach(r => { if (!(key in r)) r[key] = def })
  _persistCols()
}
// 删除列
async function hdrDeleteCol() {
  const { key, type } = hdrCtx.value
  if (type === 'qty') {
    const ui = cross.value.units.findIndex(u => u.name === key)
    if (ui >= 0) delCol(ui)
  } else {
    // 自定义列：先在**服务端**注销该列（后端会在同一事务里清掉所有商品上该列的值），
    // 成功才动本地 —— 反过来做会出现"本地没了、服务端还留着列和值"的分叉。
    if (colOrder.value.find(c => c.key === key && c.custom)) {
      if (!registryOk.value) { toast('列配置未从服务器加载，暂时不能删除列', 'warn'); closeHdrCtx(); return }
      try {
        const r = await forecastColumnsApi.remove(key)
        if (r && r.purged_products) toast(`已删除列，并清理了 ${r.purged_products} 个商品上该列的值`, 'ok')
        registryColumns.value = registryColumns.value.filter(c => c.key !== key)
      } catch (e) {
        toast('删除列失败：' + (e && e.message ? e.message : '请重试'), 'warn')
        closeHdrCtx(); return
      }
    }
    deleteMasterCol(key)
  }
  closeHdrCtx()
}
// 数据健康分颜色
function healthClass(pid) {
  const s = hsMap.value[pid]
  if (s == null) return ''
  return s < 60 ? 'pf-warn' : (s < 80 ? 'pf-mid' : 'pf-ok')
}
// 通用 xlsx 构建（导出全部 / 导出选中行复用）
function buildXlsx(rows, fname) {
  if (!rows.length) { toast('没有可导出的数据', 'warn'); return }
  const headers = ['商品名称']
  visibleCols.value.forEach(c => { if (c.key !== 'name') headers.push(c.label) })
  cross.value.units.forEach(u => headers.push(u.name))
  headers.push('下单金额(进价)')
  headers.push('建议')
  const data = [headers]
  rows.forEach(r => {
    const line = []
    line.push(r.name || '')
    visibleCols.value.forEach(c => { if (c.key !== 'name') line.push(c.fmt ? (r[c.key] != null ? r[c.key] : '') : (r[c.key] || '')) })
    cross.value.units.forEach(u => line.push(r.qtyByUnit[u.name] || 0))
    line.push(amountValue(r) || 0)
    line.push(r.suggest || 0)
    data.push(line)
  })
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '预报单')
  XLSX.writeFile(wb, `${fname}.xlsx`)
}
/* ---- v214 A：全角数字自动转半角（输入法容错） ----
   🔴 病根**不在校验层**（`cellErrMsg` 与后端 `normalize_qty` 早已走 NFKC），而在**输入层**。
      而且它的真实行为**不是**「收不到全角字符」（这是我最初的猜测，真机取证推翻了）——
      `<input type="number">` 会**静默加工**你敲进去的东西：
         `１２。５` → `125`   中文句号被删 ⇒ 小数点消失 ⇒ **数量放大 10 倍**
         `12箱`    → `12`    汉字被删 ⇒ 脏值变成合法数字
         `12.`     → `12`    中间态被打断 ⇒ 小数**根本打不出来**
      🔴 用户**看不到任何异常**：没有报错、没有红框、框里显示的就是个"正常数字"。
         这比「输不进去」危险得多 —— 与 v213 已确立的原则完全同向（宁可标红，不要静默丢/改）。
      取证方式：同一台真实 Chrome 里放两个**裸** input，只差 `type`，灌同一批输入（见
      `.workbuddy/tools/v214-browser-input-verify.cjs`）。改 API 或改注释前请先跑它。
   ⚠️ 改成 `type="text"` 后必须自己接住校验责任：`type=text` 会**原样**收下任何字符
      （含 `12箱`、`abc`）—— 所以 `cellErrMsg` 的整串判据是这套设计的**组成部分**，
      不是可选装饰。
   ⚠️ 本表与后端 `db/queries/forecast_rules.py` 的 `_HALF_MAP` 是**同一张表**（逐字同源，
      护栏 `v213-rules-selftest.py` + `v214-halfnum-parity.py` 两侧断言）。改一侧必须改两侧。
   ⚠️ 只收「在数字格内语义唯一」的字符，不做 `O→0` / `l→1` 这类歧义映射 ——
      那会把「真打错的字」静默改成看似合法的数字，比报错贵得多。 */
const HALF_MAP = {
  '。': '.',   // U+3002 表意句号 —— NFKC 不转，本表的核心理由
  '、': ',',   // U+3001 顿号     —— 数字格内只可能是千分位
  '—': '-',    // U+2014 em dash  —— 负号手误
  '–': '-',    // U+2013 en dash
  '\u2212': '-',  // U+2212 数学减号 —— 从公式/某些输入法复制的「负号」常是它，不是 ASCII 的 -
  '．': '.',   // U+FF0E 全角句点（NFKC 已覆盖，显式列出以便与后端逐字比对）
  '，': ',',   // U+FF0C 全角逗号（同上）
  '－': '-',   // U+FF0D 全角连字符（同上）
  '＋': '+',   // U+FF0B 全角加号（同上）
  // 　(U+3000) 表意空格**刻意不在这张表里**：NFKC 会先把它折成**普通空格**，
  //    所以「先 NFKC、再查表」的实现永远匹配不到它（写进来 = 死条目）。
  //    真正兜住它的是 `toHalfNum` 末尾的 `.trim()`（与后端 `.strip()` 同源）。
}
/* 全角 → 半角 + 去千分位逗号。**与后端 `normalize_num_text` 逐字同源**。
   ⚠️ 去逗号刻意放在这里、而不是只放在提交时：`rowSum` 用 `parseInt`，model 里若留着
      `"1,200"`，合计会**当场算成 1**（用户看见数字跳一下再跳回来）。逐字输入时逗号被吃掉
      也符合预期 —— 千分位本来就是给人看的，不是数据的一部分。 */
function toHalfNum(s) {
  let t = String(s == null ? '' : s).normalize('NFKC')
  for (const k in HALF_MAP) if (t.indexOf(k) >= 0) t = t.split(k).join(HALF_MAP[k])
  return t.replace(/,/g, '').trim()
}
/* 数字格的 `@input`：**边打边转**。
   🔴 必须同时做两件事，缺一不可：
      ① 回写 DOM 的 value（用户**看得见**转换 —— 这是本功能的全部价值）；
      ② 显式写 model。不能只让 `v-model` 去写：两者的执行顺序取决于原生监听器的注册次序
         （props 的 `onInput` 先于 `v-modelText` 指令注册 ⇒ 实际是「本处理器先跑、v-model 后跑」），
         **顺序一旦反转就会把全角原串写进 model** —— 而 `parseInt('１２')` = NaN、
         `rowSum` 会对它静默按 0 累加（合计错、没有任何提示）。显式写入让两种顺序都得到正确结果。
   ⚠️ 光标：全角→半角是 1:1（长度不变），但**去逗号会让文本变短** ⇒ 不能沿用原 `selectionStart`
      （会把光标顶到逗号右侧）。按「光标左侧文本转换后的长度」重算。
   ⚠️ IME 组合期（`e.isComposing`）**一律不碰 DOM** —— 改 value 会打断输入法候选框。
      组合结束时浏览器会再补一次 `input`（`isComposing` 已为 false）⇒ 转换不会漏。 */
function numInput(e, obj, key) {
  const el = e && e.target
  if (!el) return
  if (e.isComposing) return
  const before = el.value
  const after = toHalfNum(before)
  if (after !== before) {
    const pos = el.selectionStart == null ? after.length : el.selectionStart
    const newPos = toHalfNum(before.slice(0, pos)).length
    el.value = after
    try { el.setSelectionRange(newPos, newPos) } catch (_) {}
  }
  /* 写入目标：`obj[key]`（对象字段）；`obj` 本身是函数时当 setter 用 —— 供 ref 场景
     （如批量填值框 `ctxFillVal` 是个 ref，没有可写的字段名）。 */
  if (typeof obj === 'function') obj(after)
  else if (obj) obj[key] = after
}
/* 数字格的 `@change`：把编辑期间的中间态收敛成**确定值**。
   ⚠️ 收敛只能在离开这一格时做，**不能**放进 `@input`：`Number("12.")` = 12，边打边收敛
      会让用户**永远打不出小数点**（敲了 `.` 立刻被抹掉）。
   ⚠️ 不收敛会真出错：后端 `normalize_num_text("12.")` 仍返回 `"12."`，而 `_NUM_RE` 要求
      小数点后必须有数字 ⇒ `"12."` 被判「非数字」拒收。用户填的明明是 12，却看到红框。 */
function numCommit(e, obj, key) {
  const el = e && e.target
  obj[key] = parseNumInput(el ? el.value : obj[key])
  onCellChange()
}
/* ref 场景的 setter 集合 —— 模板里 ref 会被**自动解包**，没法把 ref 对象本身传给 `numInput`
   （传进去的是解包后的值，写回无效）。故给每个需要全角容错的 ref 包一层 setter。
   ⚠️ reactive 对象（`suggRecipe` / `calFactors` / `softWarnCfg` / `ref({})` 解包出的 `batch`）
      不需要这一层，直接 `numInput($event, obj, 'key')` 即可。 */
function setFillVal(v) { ctxFillVal.value = v }
function setMiniQty(v) { miniQty.value = v }
function setHdrWidth(v) { hdrWidthVal.value = v }
// 填充柄：从选中单元格拖拽，复制填充到矩形范围（兼容主档列 + 客户数量列）
function readCellVal(r, c) {
  const rw = cross.value.rows[r]; if (!rw) return ''
  if (c < visibleCols.value.length) { const k = visibleCols.value[c].key; return rw[k] ?? '' }
  const ui = c - visibleCols.value.length
  if (ui < unitCount()) return rw.qtyByUnit[cross.value.units[ui].name] || 0
  return ''
}
/* Q18：数值解析不再静默归 0。原实现 `parseFloat(v) || 0` 会把「12箱」「1,234」「abc」
   全部变成 0，用户以为粘上了实际是 0 → 漏订货。现改为：
   - 支持千分位逗号（1,234 → 1234）
   - 解析失败时保留原始字符串 → cellErrMsg 报「必须是数字」并标红，保存时拦截
   - 空串仍按 0 处理（=未填） */
function parseNumInput(v) {
  /* v214 A：补 `toHalfNum` —— 与后端 `normalize_num_text` 同源。
     🔴 原实现只去逗号、不折全角：粘贴（`writeCellVal` 走这里）进来的 `"１２"` 因
        `Number("１２")` = NaN 而被**保留为字符串** `"１２"` 存进 model，随后 `rowSum` 的
        `parseInt("１２")` = NaN ⇒ 按 0 累加 ⇒ **合计静默算少**，且屏幕上一切看起来正常。
     ⚠️ 解析失败时返回**归一后**的原串（而不是用户原始字节）：这样 model 里不残留全角字符，
        标红与保存拦截仍照常生效（`"12箱"` 归一后还是 `"12箱"`）。 */
  const s = toHalfNum(v).trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isNaN(n) ? s : n
}
/* v184：**返回是否真的写进去了**（false = 被拒或越界）。`clearRange` 用它统计实际清掉的
   格数 —— 只读列被跳过后不能再按选区面积报数（否则提示「已清除 12 个」而实际只变 10 个）。 */
function writeCellVal(r, c, v) {
  const rw = cross.value.rows[r]; if (!rw) return false
  if (c < visibleCols.value.length) {
    const col = visibleCols.value[c]
    /* v184：只读列（edit:'ro'）**不接受写入** —— 粘贴与拖拽填充都是「按列位置横扫一整片」，
       没有这道闸门时「到货周期」会被邻居列的数量文案覆盖，而它又存不回去（写入口是导入）
       ⇒ 界面上留下一个假的、刷新即消失的值。 */
    if (col.edit === 'ro') return false
    rw[col.key] = col.edit === 'num' ? parseNumInput(v) : (v == null ? '' : String(v))
    return true
  }
  const ui = c - visibleCols.value.length
  if (ui < unitCount()) { rw.qtyByUnit[cross.value.units[ui].name] = parseNumInput(v); return true }
  return false
}
function startFill(r, c, e) {
  _fillStart = { r, c }; fillEnd.value = { r, c }
  const move = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    const td = el && el.closest ? el.closest('td[data-r]') : null
    if (td) {
      const dr = parseInt(td.getAttribute('data-r')), dc = parseInt(td.getAttribute('data-c'))
      if (!isNaN(dr) && !isNaN(dc)) fillEnd.value = { r: dr, c: dc }
    }
  }
  const up = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    doFill(_fillStart, fillEnd.value)
    _fillStart = null
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}
function doFill(a, b) {
  if (!a) return
  snapshot()
  const r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r)
  const c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c)
  const sv = readCellVal(a.r, a.c)
  for (let ri = r0; ri <= r1; ri++)
    for (let ci = c0; ci <= c1; ci++) writeCellVal(ri, ci, sv)
  toast(`已填充 ${(r1 - r0 + 1) * (c1 - c0 + 1)} 个单元格`, 'ok')
}
// 批量写入：把活动单元格的值铺到整个选区（Ctrl/Cmd+Enter）
function batchWrite(val) {
  const sr = selRange.value; if (!sr) return
  snapshot()
  const { r0, c0, r1, c1 } = sr
  /* v212：按**实际写入成功**的格数报数 —— 与下面 `clearRange` 完全同一口径。
     原实现报的是**选区面积** `(r1-r0+1)*(c1-c0+1)`，而 `writeCellVal` 会**跳过只读列**
     （条码 / 规格 / 单位 / 到货周期 / 厂家编码…）⇒ 提示的个数与实际变化对不上，
     用户会以为「有些格没填进去」而反复重试。
     真机实测：12 格的选区里只有 4 格是数量格，提示却报「已批量写入 12 个单元格」。
     ⚠️ 同一个坑 **v184 已经在「清空」上踩过并修掉**（见 clearRange 的注释），
        这里当时漏了 —— 典型的「同一条规则两处实现、只修一处」。两处现在同口径。 */
  let n = 0
  for (let ri = r0; ri <= r1; ri++)
    for (let ci = c0; ci <= c1; ci++) { if (writeCellVal(ri, ci, val)) n++ }
  toast(`已批量写入 ${n} 个单元格`, 'ok')
}
// 批量清除：清空选区（或单格）内容（Delete / Backspace，非编辑态）
function clearRange() {
  const sr = selRange.value
    ? selRange.value
    : (selected.value.r >= 0 ? { r0: selected.value.r, c0: selected.value.c, r1: selected.value.r, c1: selected.value.c } : null)
  if (!sr) return
  snapshot()
  const { r0, c0, r1, c1 } = sr
  /* v184：按**实际写入成功**的格数报数。原实现是选区面积 (r1-r0+1)*(c1-c0+1)，
     而 writeCellVal 会跳过只读列 ⇒ 提示的个数与实际变化对不上，用户会以为漏清了。 */
  let n = 0
  for (let ri = r0; ri <= r1; ri++)
    for (let ci = c0; ci <= c1; ci++) { if (writeCellVal(ri, ci, '')) n++ }
  toast(`已清除 ${n} 个单元格`, 'ok')
}

/* ---- 一键复制厂家下单文本（厂家编码+数量，直接粘厂家系统） ---- */
function _rowCode(r) {
  // 优先厂家编码，缺则用条码
  return (r.product_code || '').trim() || (r.barcode || '').trim() || ''
}
function _copyText(text, label, okMsg) {
  if (!text) { toast('没有可复制的内容', 'warn'); return }
  const done = () => toast(okMsg || `已复制 ${label}（厂家编码+数量，可直接粘贴厂家系统）`, 'ok')
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done))
  } else {
    fallbackCopy(text, done)
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); done() } catch (e) { toast('复制失败，请手动选择', 'err') }
  document.body.removeChild(ta)
}
// 复制厂家编码（仅含「最终下单」有数量的行；若勾选品牌则只限选中品牌）
function copyCodes() {
  const lines = []
  cross.value.rows.forEach(r => {
    const q = rowFinalQty(r)
    if (q <= 0) return                       // ① 「最终下单」无数量 = 无报单，不复制
    const b = rowBrand(r)
    if (brandSel.value.length && !brandSel.value.includes(b)) return
    const code = _rowCode(r)
    if (!code) return
    lines.push(code)
  })
  if (!lines.length) { toast(brandSel.value.length ? '筛选品牌后本期没有可复制的厂家编码' : '本期没有可复制的厂家编码（最终下单为空）', 'warn'); return }
  const tail = brandSel.value.length ? `（品牌：${brandSel.value.join('、')}）` : ''
  _copyText(lines.join('\n'), 'codes', `已复制 ${lines.length} 个厂家编码${tail}`)
}
// 复制下单数量（与编码列表行序一致：同样跳过无厂家编码的行；数值 = 最终下单，便于分别粘贴到厂家系统不同字段）
function copyQty() {
  const lines = []
  cross.value.rows.forEach(r => {
    const q = rowFinalQty(r)
    if (q <= 0) return
    const b = rowBrand(r)
    if (brandSel.value.length && !brandSel.value.includes(b)) return
    const code = _rowCode(r)
    if (!code) return
    lines.push(String(q))
  })
  if (!lines.length) { toast(brandSel.value.length ? '筛选品牌后本期没有可复制的下单数量' : '本期没有可复制的下单数量（最终下单为空）', 'warn'); return }
  const tail = brandSel.value.length ? `（品牌：${brandSel.value.join('、')}）` : ''
  _copyText(lines.join('\n'), 'qty', `已复制 ${lines.length} 条下单数量${tail}`)
}

/* ---- 增强：撤销/重做 · 校验 · 区域复制 · 金额 · 草稿 · 筛选 · 口径 · 导出 ---- */
// 价格口径：dist=分销价 / sale=标准售价
// v184d：报单金额 / 单价口径统一为「进价」。
//   此前 displayPrice 走 dist/sale_price（受已失效的 priceBasis 开关影响），与「按进价」要求不符，
//   且只读表「单价(进价)」列因无渲染分支而空白、「下单金额(进价)」列误显分销价。现统一改走 factoryPrice。
// 🔴 v226b：本处原写「与后端 db.factory_price_sql 逐字同构（两列同义）」—— **该表述已不成立**，
//   两处口径**有意分家**：本函数（金额基准）只认 `factory_price`（元/箱）；而
//   `db.factory_price_sql` 服务的是「档案里有没有价格信息」（闸门/缺价计数/列表展示），仍含历史列回退。
//   详见 `factoryPrice()` 定义处的长注释。改这条链前请先确认问的是「算钱」还是「有没有录过」。
function displayPrice(r) {
  const v = factoryPrice(r)
  return v > 0 ? v : null
}
// 筛选（商品名）
const filterText = ref('')
function rowShown(ri) {
  const f = (filterText.value || findText.value || '').trim().toLowerCase()
  if (f) {
    const r = cross.value.rows[ri]
    if (!rowMatchText(r, f)) return false
  }
  if (hideZeroReport.value && rowSum(cross.value.rows[ri]) <= 0) return false
  if (!passColFilter(cross.value.rows[ri])) return false
  if (pagingOn.value) {
    const s = curPage.value * pageSize.value
    if (ri < s || ri >= s + pageSize.value) return false
  }
  return true
}
// 排序：none / asc / desc（直接重排 rows，提交按 product_id 无关顺序）
const sortMode = ref('none')
/* v202：切回「默认」时要能**真正回到导入模板序**。
   旧实现只处理 asc/desc，`none` 分支什么都不做（`rows` 原样赋回）⇒ 顺序停在
   「按名称排完」的结果上：旋钮显示「默认」、行序却不是默认，且**没有任何办法回去**
   （再点两下轮回到 none 也还是那个顺序）。这正是用户那句「不受其他排序规则影响」的落点 ——
   默认态必须等于模板序。现按 `rowBaseOrder`（行底原始顺序，＝ buildRowBase 的产出顺序）恢复。
   ⚠️ 不在本函数里重置光标/选区：排序只动行序，`selAnchor` 是 (行, 列) 坐标，排序后它指向
      别的行属于既有行为；本轮只修「顺序」，避免把一次排序变成一次隐性的选区跳转。 */
function applySort() {
  snapshot()
  const rows = cross.value.rows
  if (sortMode.value === 'asc') rows.sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'zh'))
  else if (sortMode.value === 'desc') rows.sort((a, b) => (b.name || '').localeCompare((a.name || ''), 'zh'))
  else {
    // 恢复导入模板序：按行底原始顺序的索引重排；不在原始顺序里的行（草稿恢复出来的新增行）
    // 稳定地留在末尾 —— 与 buildRowBase 对「无导入序」那批的处理一致。
    const ix = {}
    ;(rowBaseOrder.value || []).forEach((pid, i) => { ix[pid] = i })
    rows.sort((a, b) => {
      const ai = ix[a.product_id], bi = ix[b.product_id]
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return 0
    })
  }
  cross.value.rows = rows
  saveDraftNow()
}
function cycleSort() {
  sortMode.value = sortMode.value === 'none' ? 'asc' : sortMode.value === 'asc' ? 'desc' : 'none'
  applySort()
}

// 撤销/重做
const undoStack = ref([])
const redoStack = ref([])
const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)
let _pendingSnap = null
const selAnchor = ref({ r: -1, c: -1 })
const selRange = ref(null)
function clone(o) { return JSON.parse(JSON.stringify(o)) }
/* Q24：撤销栈由「全量深拷贝」改为「结构性操作用全量 + 单元格编辑用增量补丁」。
   原实现每次单元格聚焦都 clone(cross) 全表（428 行 × 30 列 ≈ 1.2 万字段），
   change 时再 clone 一次并 JSON.stringify 全量比较 —— 每点一格两次全表序列化。
   现改为：单格编辑只记录 {r, c, old, new}，撤销时反向写回该格，零深拷贝。
   行/列增删、粘贴、填充等结构性变更仍需全量快照（{ t:'full' }）。 */
const UNDO_LIMIT = 100
function snapshot() {
  dirtySinceSave.value = true          // v201：结构变更 ⇒ 有未保存改动（见 refreshDirty 注释）
  undoStack.value.push({ t: 'full', data: clone(cross.value) })
  if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
  redoStack.value = []
}
function pushCellSnap(r, c, oldVal, newVal) {
  dirtySinceSave.value = true          // v201：单元格改动 ⇒ 有未保存改动
  undoStack.value.push({ t: 'cell', r, c, old: oldVal, new: newVal })
  if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
  redoStack.value = []
}
/* v219 打磨⑤：批量修复入栈（一次 Ctrl+Z 退掉**整批**）。
   为什么不复用 pushCellSnap 逐格入栈：那样「一键修复 40 处」要按 40 次 Ctrl+Z 才退干净，
   而用户的心理模型是「我刚点了一次按钮 ⇒ 一次撤销」。 */
function pushBatchSnap(cells) {
  if (!cells || !cells.length) return
  dirtySinceSave.value = true
  undoStack.value.push({ t: 'batch', cells: cells.map(x => ({ r: x.r, c: x.c, old: x.old, new: x.new })) })
  if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
  redoStack.value = []
}
/* v219 打磨②：`silent` = 批量回退时不逐条 toast（否则连退 8 步刷 8 条提示，
   最后一条盖住前面所有，用户只看到「已撤销」一次 ⇒ 以为只退了一步）。 */
function undo(silent) {
  const s = undoStack.value.pop()
  if (!s) return
  if (s.t === 'cell') {
    redoStack.value.push({ t: 'cell', r: s.r, c: s.c, old: s.old, new: s.new })
    writeCellVal(s.r, s.c, s.old)
  } else if (s.t === 'batch') {
    /* v219 打磨⑤：批量修复的**整批单条**回退（见 pushBatchSnap）。
       倒序写回：一批里同一格不应出现两次（fixList 按 ri+ci 去重过），
       倒序只是让「后写的先还原」这个直觉成立，出现重复也不会出错。 */
    redoStack.value.push({ t: 'batch', cells: s.cells.map(x => ({ r: x.r, c: x.c, old: x.old, new: x.new })) })
    for (let i = s.cells.length - 1; i >= 0; i--) writeCellVal(s.cells[i].r, s.cells[i].c, s.cells[i].old)
  } else {
    redoStack.value.push({ t: 'full', data: clone(cross.value) })
    cross.value = s.data
  }
  clampSelection()
  refreshDirty()          // v201：撤销可能正好回到上次保存的版本 ⇒ 重新比对，别谎报「有未保存改动」
  if (!silent) toast('已撤销', 'ok')
}
function redo() {
  const s = redoStack.value.pop()
  if (!s) return
  if (s.t === 'cell') {
    undoStack.value.push({ t: 'cell', r: s.r, c: s.c, old: s.old, new: s.new })
    writeCellVal(s.r, s.c, s.new)
  } else if (s.t === 'batch') {
    undoStack.value.push({ t: 'batch', cells: s.cells.map(x => ({ r: x.r, c: x.c, old: x.old, new: x.new })) })
    for (const x of s.cells) writeCellVal(x.r, x.c, x.new)
  } else {
    undoStack.value.push({ t: 'full', data: clone(cross.value) })
    cross.value = s.data
  }
  clampSelection()
  refreshDirty()          // v201：同 undo()
  toast('已重做', 'ok')
}
/* v219 打磨②：撤销栈**可见**。
   Ctrl+Z 只能一步一步盲退 —— 用户误操作后真正想知道的是「我刚才到底改了哪几处、
   退到第几步能回到我想要的样子」。栈不可见时只能试，退过头还得重做回去。
   这里把最近 30 步列出来（新的在上），点哪一条就**退到那一步之前**。
   ⚠️ 描述**不改**栈结构（`{t,r,c,old,new}` 原样保留）—— 撤销/重做的正确性靠这个结构，
      为显示去动它不值得；描述是纯派生。 */
const undoPanelOpen = ref(false)
const undoShown = computed(() => {
  const st = undoStack.value
  const out = []
  for (let i = st.length - 1; i >= Math.max(0, st.length - 30); i--) {
    out.push({ i, label: undoLabel(st[i]) })
  }
  return out
})
function colLabelOf (c) {
  const vc = visibleCols.value
  if (c < vc.length) return String((vc[c] && (vc[c].label || vc[c].key)) || ('第' + (c + 1) + '列'))
  const u = (cross.value.units || [])[c - vc.length]
  return u ? String(u.name) : ('第' + (c + 1) + '列')
}
function briefVal (v) {
  if (v === null || v === undefined || v === '') return '（空）'
  const s = String(v)
  return s.length > 10 ? s.slice(0, 10) + '…' : s
}
function undoLabel (s) {
  if (!s) return ''
  if (s.t === 'cell') return `第 ${s.r + 1} 行 · ${colLabelOf(s.c)}：${briefVal(s.old)} → ${briefVal(s.new)}`
  if (s.t === 'batch') return `批量修复 ${s.cells.length} 处（一次撤销可整批还原）`
  return '结构性变更（增删行 / 粘贴 / 填充等）'
}
function undoUpto (i) {
  const n = undoStack.value.length - i
  if (n <= 0) return
  while (undoStack.value.length > i) undo(true)
  undoPanelOpen.value = false
  toast(`已回退 ${n} 步`, 'ok')
}

// Q5：保存成功后不再清空撤销栈（原实现保存后无法 Ctrl+Z 回退）。
// 改为记录「上次保存基线」，并提供「回退到上次保存」入口，避免用户保存后误改无法还原。
const lastSavedSnap = ref(null)

/* v201：把「当前到底存没存」变成**看得见**的状态。
   🔴 起因（用户原话）：「点击保存后整个页面还是在可编辑状态，这样设计对吗」
   当时（v201）的处置是**只补状态可见性、编辑态留着**，因为提示是不对称的：
     · 保存**失败** → 有持久的红色横幅（`save-fail-banner`）
     · 保存**成功** → 只有一条几秒就消失的提示，之后页面与保存前**长得一模一样**
   ⇒ 用户无法确认「到底存没存进去」。补两个值，在编辑工具行常驻显示。
   🔴 v208（2026-09-19 用户拍板）：**编辑态本身也去掉了** —— 保存成功即退出编辑态、
   回到带「改单」按钮的只读态（见 saveEdits 尾部的 exitEditAfterSave()）。
   ⚠️ 但本段这两个状态值**继续保留、不要删** —— 编辑态里反复改单时，「有未保存的改动」
      仍是用户在**离开页面前**唯一能看到的警告（草稿虽在本地，用户并不知道）。 */
const dirtySinceSave = ref(false)   // 自上次保存以来是否改过内容
const lastSavedAt = ref('')         // 上次保存成功的时刻（HH:MM）
/* 改动登记的两个**唯一漏斗**：一切会改内容的动作都经过 snapshot()（结构变更）或
   pushCellSnap()（单元格提交）。已逐个核对：addRow / addUnit / renameCol / delCol /
   粘贴 / 填充 / 右键删除列 / 快照恢复 / 软删行 …… 全部走这两个，无遗漏。
   ⚠️ 视图偏好（列宽、列显隐、分组、排序）**故意不标** —— 它们不改变要落库的内容。 */
function refreshDirty() {
  /* v201：基线由 `loadEditGrid` 在**加载收尾**处写入（＝服务端内容）；保存成功后由
     saveEdits 用「退出编辑态**之前**的编辑态快照」覆盖（v208 —— 必须在 leaveEdit()
    之前取，否则 clone 到的是只读态对象，字段集不同 ⇒ 基线残缺）。
     ⇒ 一进编辑就有基线可比，撤销回到起点时会自动变干净。
     没有基线时（例如网格加载失败）**保持标记不变** —— 偏保守：可能误报「有改动」，
     但不会漏报；漏报会让用户以为已经存好而直接关掉页面，代价大得多。 */
  if (!lastSavedSnap.value) return
  dirtySinceSave.value = JSON.stringify(cross.value) !== JSON.stringify(lastSavedSnap.value)
}
const saveState = computed(() => {
  if (dirtySinceSave.value) return { cls: 'dirty', text: '有未保存的改动' }
  if (lastSavedAt.value) return { cls: 'saved', text: '已保存 ' + lastSavedAt.value }
  return { cls: 'clean', text: '尚未修改' }
})
function undoToLastSaved() {
  if (!lastSavedSnap.value) return
  if (!window.confirm('回退到本次编辑的起点（上次保存时的内容，或刚进入编辑时的内容）？\n\n当前未保存的改动将被丢弃，可用 Ctrl+Z 再撤销回来。')) return
  snapshot()
  cross.value = clone(lastSavedSnap.value)
  clampSelection()
  dirtySinceSave.value = false      // v201：内容已回到基线 ⇒ 状态条回到干净态
  toast('已回退到本次编辑的起点', 'ok')
}
/* v197（P1-2b）：把**矩形选区与拖拽锚点**也一起夹进合法区间。
   改前只夹 selected（单格焦点），漏了 selRange / selAnchor —— 而删列（表头 × / 右键
   「删除此列」）是把客户列从 `cross.units` 里 splice 掉，列总数随之变小，
   此时 selRange.c1 仍指向那个**已经不存在的列号**：
     · inRange() 照旧把越界列当命中 ⇒ 表体画出并不存在的选中底色（`.range-sel`）；
     · 选区求和 / 复制 / 清空按 c0..c1 遍历 ⇒ 读到 undefined，状态栏数字悄悄少算。
   这类问题不报错、不崩溃，只让数字对不上 —— 比崩溃更难发现，所以必须在唯一的夹取入口修。
   ⚠️ 只做**按下标夹取**，不做「删除后整体左移补偿」：后者会让选区语义变成「跳到旁边那一列」，
      用户看到的是「我删了 A 列，怎么选中变成 B 列了」。此处的诉求仅仅是「别读到不存在的列」。 */
function clampSelection() {
  const nr = Math.max(0, cross.value.rows.length - 1)
  const nc = Math.max(0, visibleCols.value.length + unitCount() - 1)
  if (selected.value.r > nr) selected.value.r = nr
  if (selected.value.c > nc) selected.value.c = nc
  if (selected.value.r < 0) selected.value.r = -1
  const sr = selRange.value
  if (sr) {
    const r0 = Math.min(Math.max(sr.r0, 0), nr)
    const r1 = Math.min(Math.max(sr.r1, 0), nr)
    const c0 = Math.min(Math.max(sr.c0, 0), nc)
    const c1 = Math.min(Math.max(sr.c1, 0), nc)
    if (r0 > r1 || c0 > c1) {
      selRange.value = null          // 夹完区间反向 ⇒ 整体作废，界面显示「无选区」而不是留个假选区
    } else if (r0 !== sr.r0 || c0 !== sr.c0 || r1 !== sr.r1 || c1 !== sr.c1) {
      selRange.value = { r0, c0, r1, c1 }   // 只在真的变了才换对象，避免每次空转触发重渲染
    }
  }
  const sa = selAnchor.value
  if (sa && (sa.r > nr || sa.c > nc)) {
    // 锚点是「拖选的起点」，越界后再拖会从不存在的位置开始算 ⇒ 同样夹进合法区
    selAnchor.value = { r: Math.min(sa.r, nr), c: Math.min(sa.c, nc) }
  }
}
/* v197（P1-2b）：列数一变就夹一次选区。
   上面 delCol / deleteMasterCol 里的显式调用只覆盖「删除列」，而**会改变可见列数的路径不止两条**：
     · 列设置里取消勾选 / 右键「隐藏此列」→ toggleCol（colVis 置 false）
     · 右键「隐藏此列」对可删内置列 → quickHide（直接从 colOrder 移除，等同删除）
     · 套用列方案 → applyScheme（顺序 + 显隐一起换）
   补三处调用能治今天，补一个 watch 能治以后 —— 漏一处就是同一类「数字悄悄少算」的复发。
   只在**列数真的变化**时触发（watch 源是两个长度相加），列重排、改名、改标签都不会空转；
   clampSelection 只写 selected/selRange/selAnchor，不写被 watch 的源，无回环风险。 */
watch(
  () => visibleCols.value.length + unitCount(),
  () => clampSelection()
)
function normRange(r0, c0, r1, c1) {
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) }
}
function inRange(r, c) {
  if (!selRange.value) return false
  const { r0, c0, r1, c1 } = selRange.value
  return r >= r0 && r <= r1 && c >= c0 && c <= c1
}
/* Q24：单元格聚焦只记录「这一格的旧值」（O(1)），change 时若值有变则入增量补丁。
   不再 clone/stringify 整表。 */
let _pendingCell = null
function onFocusCell(r, c, e) {
  selectCell(r, c)
  /* v212（P2-1）：**聚焦的那一格**决定候选内容（单实例 datalist，见 syncQtyCellOptions）。
     放在这里而不是 onCellDown：键盘跳格（方向键 / Tab / Enter）**只走 focus**、不走 mousedown，
     挂在 mousedown 上会让「键盘跳过去的那一格没有候选」，两种进格方式行为不一致。 */
  syncQtyCellOptions(r, c)
  /* v210 缺陷修复（与需求①②同路径，一并改）：_pendingCell 必须**每格一套**。
     🔴 原写法是 `if (!_pendingCell)`，有个完全静默的后果：焦点在**没有改动**的格子之间连续移动时
        （从前靠鼠标逐格点，v210 起方向键跳格会让它变成**常态**），_pendingCell 会一直停在**第一个**格子上；
        之后在别处改一格 ⇒ onCellChange 拿它去比对「那个压根没动过的格子」⇒ 两边相等 ⇒
        **直接 return**：这次改动既不进撤销栈（Ctrl+Z / 回退都还原不了），也不点亮状态条
        （refreshDirty 只在 undo/redo 里被调，`dirtySinceSave` 唯一置真的地方就是 pushCellSnap）
        ⇒ 用户明明改了内容，状态条却说「尚未修改」、紧邻的「回退」还是灰的。
     ⚠️ 同格重复 focus 不重记（保持原 old）：方向键在同一格上按左右 / 再次点击都会回到这里，
        若重记，old 会变成「改了一半的值」，撤销就撤不回去了。 */
  if (!_pendingCell || _pendingCell.r !== r || _pendingCell.c !== c) {
    _pendingCell = { r, c, old: readCellVal(r, c) }
  }
  /* v210（需求①）：导航态下「**单击即全选内容**」——
     点一下就能直接打字整体替换，不必三击 / 拖选 / 先删再输。
     ⚠️ 只在导航态全选：输入态（双击 / F2 / 在已选中的格上再按一次）必须放行浏览器的
        「光标落在点击处」，否则「想改一位数字」又变成整格重输 —— Q21 的老病立刻复发。
     ⚠️ try 包住：判断与写法都照抄同文件 focusCell() 里已被生产验证过的那句，
        数字输入框上某些选 API 会抛 InvalidStateError，绝不能让它冒泡中断聚焦。 */
  if (!cellTyping.value && e && e.target && e.target.select) { try { e.target.select() } catch (err) {} }
}
function onCellChange() {
  const p = _pendingCell
  _pendingCell = null
  if (!p) return
  const cur = readCellVal(p.r, p.c)
  if (String(cur) === String(p.old)) return
  pushCellSnap(p.r, p.c, p.old, cur)
}
// 区域复制（TSV，可直接粘 Excel/厂家系统）
function copyRegion() {
  let r0, c0, r1, c1
  if (selRange.value) { r0 = selRange.value.r0; c0 = selRange.value.c0; r1 = selRange.value.r1; c1 = selRange.value.c1 }
  else {
    const { r, c } = selected.value
    if (r < 0) { toast('请先选中单元格', 'warn'); return }
    r0 = r1 = r; c0 = c1 = c
  }
  const lines = []
  for (let i = r0; i <= r1; i++) {
    const row = []
    for (let j = c0; j <= c1; j++) row.push(String(readCellVal(i, j)))
    lines.push(row.join('\t'))
  }
  _copyText(lines.join('\n'), `选区 ${r1 - r0 + 1}×${c1 - c0 + 1}`, `已复制选区 ${r1 - r0 + 1}×${c1 - c0 + 1} 个单元格`)
}
// 鼠标拖拽选区：mousedown 起锚、mouseover 扩展、mouseup 收尾（区分输入框编辑态）
const dragging = ref(false)
let _dragMoved = false
let _dragEditing = false
function onCellDown(ri, ci, e) {
  if (e.button === 2) return          // 右键：不重置选区，交给 openCtx（区域内保留选区、区域外重置单格）
  /* v210：本格这次按下是「选中」还是「进入输入态」。
     判据 = **按下这一刻，该输入框是否已经是 document.activeElement**：
       · 是 ⇒ 在**已选中的同一格**上再按一次（含双击的第二下）⇒ 输入态，
              放行浏览器把光标落在点击处（这就是「想改一位数字」的入口，见需求②的两态注释）
       · 否 ⇒ 新格/未聚焦 ⇒ 导航态：随之触发的 @focus 会全选内容（需求①）
     🔴 判据**不能用 `selected` 比对**代替：键盘跳格后 selected 已指向该格，但焦点未必还在输入框
        （例如拖框选之后焦点在 body）—— 那时单击必须仍是「全选」，不能变成「输入态」。
        只有「焦点此刻真在这个输入框里」才够资格叫「第二次点击」。 */
  const t = e.target
  cellTyping.value = !!(t && t.tagName === 'INPUT' && document.activeElement === t)
  dragging.value = true
  _dragMoved = false
  _dragEditing = !!(e.target && e.target.tagName === 'INPUT')
  if (!_dragEditing && e.preventDefault) e.preventDefault()
  if (e.shiftKey && selected.value.r >= 0) {
    selAnchor.value = { r: selected.value.r, c: selected.value.c }
    selRange.value = normRange(selAnchor.value.r, selAnchor.value.c, ri, ci)
  } else {
    selAnchor.value = { r: ri, c: ci }
    selRange.value = null
    selected.value = { r: ri, c: ci }
  }
}
function onCellOver(ri, ci) {
  if (!dragging.value) return
  if (ri === selAnchor.value.r && ci === selAnchor.value.c) return
  if (!_dragMoved && _dragEditing && document.activeElement && document.activeElement.blur) {
    try { document.activeElement.blur() } catch (e) {}
    /* v210：拖框选会把输入框 blur 掉（焦点回到 body），此时必须**显式回到导航态**。
       虽然 onGridKey 的判据带了 `&& editing` 已能自愈，但留着 true 就是一颗定时炸弹：
       下一个读 cellTyping 而不读“焦点在不在输入框”的地方就会踩雷（onFocusCell 正是这么读的）。
       拖框选后紧接着单击某格 → onCellDown 会重算，所以这里只是把中间态收干净。 */
    cellTyping.value = false
  }
  _dragMoved = true
  selRange.value = normRange(selAnchor.value.r, selAnchor.value.c, ri, ci)
  selected.value = { r: ri, c: ci }
}
function onCellUp() {
  if (!dragging.value) return
  dragging.value = false
  if (!_dragMoved && !_dragEditing) selectCell(selAnchor.value.r, selAnchor.value.c, false)
}
// Ctrl/Cmd+A 全选当前表体
function selectAll() {
  const maxR = cross.value.rows.length - 1
  const maxC = visibleCols.value.length + unitCount() - 1
  if (maxR < 0 || maxC < 0) return
  selAnchor.value = { r: 0, c: 0 }
  selected.value = { r: maxR, c: maxC }
  selRange.value = normRange(0, 0, maxR, maxC)
}
// 解析 Excel 剪贴板文本：\r\n/\r → \n，按 \n 分行、\t 分列，去行尾空行
function parseTSV(text) {
  const norm = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = norm.split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map(l => l.split('\t').map(s => s.trim()))
}
// Q7 配套：编辑态开启分页后，任何按行索引定位的操作（粘贴/新增行/错误跳转）都需先翻到目标行所在页
function gotoRowPage(ri) {
  if (!pagingOn.value) return
  const pp = Math.floor(ri / (pageSize.value || 50))
  const maxP = Math.max(0, Math.ceil(cross.value.rows.length / (pageSize.value || 50)) - 1)
  curPage.value = Math.max(0, Math.min(maxP, pp))
}
// 把某一行滚动到可视区（新增行/错误跳转后定位）
function scrollRowIntoView(ri) {
  nextTick(() => {
    const el = document.querySelector(`td[data-r="${ri}"]`)
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' })
  })
}
// 区块单元格粘贴：从选中格（或选区左上角）起逐格写入，行超界自动补空商品行、列超界截断
function pasteRegion(text) {
  const block = parseTSV(text)
  if (!block.length || !block[0].length) return
  const rows = block.length, cols = block[0].length
  let sr, sc
  if (selRange.value) { sr = selRange.value.r0; sc = selRange.value.c0 }
  else { sr = selected.value.r; sc = selected.value.c }
  if (sr < 0 || sc < 0) return
  const maxC = visibleCols.value.length + unitCount() - 1
  let useCols = cols, truncated = false
  if (sc + cols - 1 > maxC) { useCols = Math.max(0, maxC - sc + 1); truncated = true }
  const needRows = sr + rows
  while (cross.value.rows.length < needRows) cross.value.rows.push(blankRow())
  snapshot()
  // Q13：粘贴后立即统计非法格，不再等到「保存」才告诉用户埋了雷
  let bad = 0
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < useCols; j++) {
      writeCellVal(sr + i, sc + j, block[i][j])
      if (cellInvalid(sr + i, sc + j)) bad++
    }
  gotoRowPage(sr)
  toast(`已粘贴 ${rows}×${useCols}` + (truncated ? '（右侧列超出表格已截断）' : '')
    + (bad ? `，其中 ${bad} 格不合法（已标红，需修正后才能保存）` : ''), bad ? 'warn' : 'ok')
}
onMounted(() => { window.addEventListener('mouseup', onCellUp) })
onBeforeUnmount(() => { window.removeEventListener('mouseup', onCellUp) })
// 列类型校验：返回错误原因（空串=合法）。覆盖 master 数字列与 qty 数量列
function cellErrMsg(r, c) {
  const rw = cross.value.rows[r]; if (!rw) return ''
  let isNum = false, isInt = false, raw
  if (c < visibleCols.value.length) {
    const col = visibleCols.value[c]
    if (col.edit !== 'num') {
      raw = rw[col.key]
      // Q16：商品名称「有数量才必填」——该行已填报单数量却没名字，保存后会变成无名商品/孤儿数量
      if (col.key === 'name' && !String(raw == null ? '' : raw).trim() && rowSum(rw) > 0)
        return specText('name')   // v213：文案与后端同一来源
      // options 仅作输入候选提示（datalist 下拉），不强制校验；如需强制枚举约束的列，设 enforceOptions:true
      if (col.options && col.options.length && col.enforceOptions && raw !== '' && raw != null && raw !== undefined && !col.options.includes(String(raw)))
        return '应为：' + col.options.join('/') + ' 之一'
      return ''                                  // 文本列（无枚举）不校验
    }
    isNum = true; isInt = col.num === 'int'
    raw = rw[col.key]
  } else {
    const ui = c - visibleCols.value.length
    if (ui >= unitCount()) return ''
    const k = cross.value.units[ui].name
    isNum = true; isInt = true                    // 客户数量=非负整数
    raw = rw.qtyByUnit[k]
  }
  if (raw === '' || raw === null || raw === undefined) return ''   // 空=未填=合法(0)
  /* v213：整串判据（原为 parseFloat 前缀解析，见 NUM_RE 注释）。与后端 normalize_qty
     同一套：NFKC 归一并去千分位逗号后**整串**匹配；bool 单独挡掉（`Number(true)=1`
     会让 JSON 里一个 true 静默变成「1 件」）。 */
  let n
  if (typeof raw === 'number') n = raw
  else if (typeof raw === 'boolean') return specText('num')
  else {
    const s = String(raw).trim().normalize('NFKC').replace(/,/g, '').trim()
    if (!NUM_RE.test(s)) return specText('num')
    n = Number(s)
  }
  if (!Number.isFinite(n)) return specText('num')
  if (n < 0) return specText('neg')
  if (isInt && !Number.isInteger(n)) return specText('int')
  // Q16：数量上限（原先前端 999999 / 后端小程序 10000 / Web 无上限 ⇒ 现由服务端下发单源）
  if (n > qtyMax.value) return specText('over', { max: qtyMax.value })
  return ''
}
/* v175：把「某一格到底有没有错、错在哪」收敛成唯一权威 —— 红框标记、悬停提示、
   「查错」清单三处共用同一份判定，不再各写一套。
   此前「条码重复」是行级判断，只进了清单、没进格子 ⇒ 清单报 7 条重复，表格里那 7 格
   却干干净净，标记与清单对不上（用户要的正是「标记准确对应错误所在处」）。
   ⚠️ 条码重复必须用 computed 预建「行号 → 说明」索引：若在 cellErrMsg 里现扫全表，
   模板逐格渲染会退化成 O(N²×M)。 */
const barcodeColIdx = computed(() => visibleCols.value.findIndex(c => c.key === 'barcode'))
/* 条码重复判据（**两度放宽，只认本条**）
   ── v178（2026-09-16 用户定调）：同条码 + **同品牌** 才算重复。
      靠**品牌名**区分两个户头 —— 公司在蒙牛有两个户头，品牌列分别写
      「蒙牛低温（福宝）」「蒙牛低温（恒滋）」，同一产品两个户头都会下单，共码是正常的。
   ── v196（2026-09-19 用户定调，本轮）：**再收窄一层**。两个新事实推翻了 v178 的判据：
      ① 「**多规格本就允许共用条码**」—— 同一商品 200g*10瓶*6组 与 200g*24瓶 共码是正常的
         （生产实测：12 组重复条码里 6 组是这类多规格，另有 5 个赠品杯子共用占位码 8003）；
      ② 用户要求把 福宝/恒滋 **归并**为「蒙牛低温」（该 25 行条码全部唯一，归并零副作用）
         ⇒ 归并后品牌名不再能区分户头，v178 的判据会**大面积误报**。
      现行判据：**同条码 + 同品牌 + 同名 + 同规格 + 双方都还在售** 才算「条码重复」。
      这才是唯一有真实危害的情形：同一商品在档案里被**重复建了两行**——
      无档案号的新行保存时按「条码」匹配商品，两条并存会串档
      （生产实测现存 3 组：每日鲜酪桂花马蹄 1199/1438、青青柚子 1198/1439、阿慕乐黄桃 1219/1451）。
      其余一律放行：品牌不同（两个户头）、名称或规格不同（多规格/同系列不同口味）、
      一方已停用（历史旧档，如友芝友 3 组、赠品 1335/1433）。
   ── 为什么敢 fail-open：条码列自 v178 起有 132px 宽、13 位全码可见，人工能核对；
      而误报的代价是**用户点保存被拦住**（本轮用户实际踩到的就是这条）。
      比较用归一化键（去空白、全角括号统一），显示值不动。 */
function brandKeyOf(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, '')
    .replace(/\(/g, '（').replace(/\)/g, '）')
}
const dupBarcodeAt = computed(() => {
  const m = new Map()
  if (barcodeColIdx.value < 0) return m
  const byBc = new Map()   // 条码 → [{ri, key, off}]（按行序）
  cross.value.rows.forEach((r, ri) => {
    const bc = String((r && r.barcode) || '').trim()
    if (!bc) return
    /* v196 命中判据：品牌 / 名称 / 规格 **三者全同**，且**双方都还在售**。
       ⚠️ 名称里本身常带规格（「…200g*10瓶*6组」）⇒「同名」已强于「同规格」；
          两条同时比是刻意的冗余：名称被手工改短、规格字段留着时仍能判准。
       ⚠️ off = 已停用/已删除的档案行（v179 的 offArchive）。任一方 off ⇒ 不报：
          「停用旧档 + 在用新档」共码是档案演进而非本期录入错误。 */
    const key = [brandKeyOf(rowBrand(r)), String((r && r.name) || '').trim().replace(/\s+/g, ''),
      String((r && r.spec) || '').trim()].join('\u0001')
    const off = !!(r && r.offArchive)
    const prev = byBc.get(bc)
    const hit = prev && prev.find(p => !p.off && !off && p.key === key)
    if (hit) m.set(ri, `条码重复（第 ${hit.ri + 1} 行 同品牌同名同规格）`)
    if (prev) prev.push({ ri, key, off })
    else byBc.set(bc, [{ ri, key, off }])
  })
  return m
})
// 某格的问题说明（空串 = 没问题）。红框、悬停提示、查错清单都走这里
function cellIssue(ri, ci) {
  const msg = cellErrMsg(ri, ci)
  if (msg) return msg
  if (ci === barcodeColIdx.value) return dupBarcodeAt.value.get(ri) || ''
  return ''
}
function cellInvalid(r, c) { return cellIssue(r, c) !== '' }
// 有错的行号集合：行号格标红，「一眼定位」先定位到行、再定位到格
const errRowSet = computed(() => {
  const s = new Set()
  const nc = visibleCols.value.length + unitCount()
  cross.value.rows.forEach((r, ri) => {
    for (let ci = 0; ci < nc; ci++) {
      if (cellInvalid(ri, ci)) { s.add(ri); break }
    }
  })
  return s
})
// v187：编辑态顶部汇总口径与「汇总表（只读）」完全对齐 ——
//   合计(小单位) = 各报单单元数量之和（与「合计(小单位)」列同源）；金额 = amountValue（最终下单箱 × 单价(进价/箱)）。
//   原 rowAmount（分销价 × 合计）已删除：编辑网格不再有分销价口径的「金额」列，分销价仍作为主档可见列存在。
//   v189 三个「合计」的行集一律走 liveRows（软删行不计），与只读表 grand 同一行集。
const editTotalQty = computed(() => liveRows.value.reduce((s, r) => s + rowSum(r), 0))
const editTotalAmount = computed(() => liveRows.value.reduce((s, r) => s + (amountValue(r) || 0), 0))
/* v189：**合计(箱)** 的唯一实现（推送正文 / 汇总条共用）。
   🔴 不可写成「Σ小单位 ÷ 某个规格」—— 生产档案规格异构（288 个里 192 个是描述串、30 个为空），
      该式无定义。必须**逐行除再相加**，且与只读表「合计(箱)」列共用同一个 rowBoxes()。 */
const editTotalBoxes = computed(() => liveRows.value.reduce((s, r) => s + rowBoxes(r), 0))

// 本地草稿：未提交前自动缓存，刷新可恢复；保存后清除
const draftRestored = ref(false)
// Q14：如实记录草稿恢复范围（数量 / 商品资料 / 新增行），横幅按实际范围展示，不再笼统称「已恢复未完成数据」
const draftRestoreInfo = ref(null)   // { qty: n, master: n, added: n }
const DRAFT_KEY = () => 'forecast_draft_' + (cross.value.period ? cross.value.period.id : 'default')
let _ignoreNextWatch = 0
function saveDraftNow() {
  try { localStorage.setItem(DRAFT_KEY(), JSON.stringify(cross.value)) } catch (e) {}
}
// Q11：保存成功路径调用 clearDraft(true) —— 静默清除，避免「已保存」后紧跟「已放弃草稿」的矛盾提示
function clearDraft(silent) {
  try { localStorage.removeItem(DRAFT_KEY()) } catch (e) {}
  draftRestored.value = false
  draftRestoreInfo.value = null
  if (!silent) toast('已放弃草稿', 'ok')
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY())
    if (!raw) return null
    const d = JSON.parse(raw)
    return d && d.rows ? d : null
  } catch (e) { return null }
}
let _draftTimer = null
watch(() => cross.value, () => {
  if (_ignoreNextWatch > 0) { _ignoreNextWatch--; return }
  clearTimeout(_draftTimer); _draftTimer = setTimeout(saveDraftNow, 800)
  // Q25：节流更新「待修正」角标（见 errCount 注释）
  // v174：同一次计算顺带刷新查错面板 —— 面板开着时「改对一条就从清单消失」，
  //       否则用户改完还得手点一次「查错」才知道还剩几处。
  clearTimeout(_errTimer)
  _errTimer = setTimeout(() => {
    if (!editMode.value) { errCount.value = 0; errList.value = []; return }
    const list = validateAll()
    errCount.value = list.length
    if (errListOpen.value) errList.value = list
  }, 1500)
}, { deep: true })

// 导出 Excel（.xlsx）
function exportXlsx() {
  const rows = filteredRowsForExport()
  const pname = (cross.value.period && cross.value.period.name) || '预报单'
  buildXlsx(rows, pname)
}
// 导出用行（受筛选影响，但不受排序重排影响——导出始终全量）
function filteredRowsForExport() {
  const f = (filterText.value || findText.value || '').trim().toLowerCase()
  let rows = cross.value.rows
  if (f) rows = rows.filter(r => rowMatchText(r, f))
  if (colFilter.value && colFilter.value.val) {
    const cf = colFilter.value
    const fv = cf.val.trim().toLowerCase()
    rows = rows.filter(r => String(cellValOf(r, cf.key, cf.type)).toLowerCase().includes(fv))
  }
  if (hideZeroReport.value) rows = rows.filter(r => rowSum(r) > 0)
  return rows
}

/* ===== P3-P4 增强 ===== */
// P3-1 配方化建议引擎（策略可配置；契合「业务规则通过配方可配置」战略；后端 /api/forecast/recipe 就绪钩子）
const showSuggest = ref(true)
const SUGGEST_RECIPE_KEY = () => 'forecast_suggest_recipe_' + (auth.user?.id || 'default')
const suggestPanel = ref(false)
const recipePick = ref('')
const suggestRecipes = ref([])
const suggRecipe = reactive({
  strategy: 'safety',   // safety | avg | trend | blend
  coverageDays: 7,
  trendSteps: 1,
  trendWeight: 0.3,
})
function recipeLabel(s) {
  return ({ safety: '安全库存法', avg: '历史均值法', trend: '趋势外推法', blend: '加权混合法' })[s] || s
}
function computeSuggestion(r, recipe) {
  const current = rowSum(r)
  const strat = (recipe && recipe.strategy) || 'safety'
  if (strat === 'safety') {
    const safety = Number(r.safety_stock) || 0
    return safety > 0 ? Math.max(0, Math.round(safety - current)) : 0
  }
  const hist = r.history || []
  if (hist.length < 2) return 0
  const avg = hist.reduce((s, x) => s + (Number(x) || 0), 0) / hist.length
  if (strat === 'avg') {
    const cov = Number(recipe.coverageDays) || 7
    return Math.max(0, Math.round(avg * cov - current))
  }
  if (strat === 'trend') {
    const n = hist.length
    const slope = hist[n - 1] - hist[n - 2]
    const proj = hist[n - 1] + slope * (Number(recipe.trendSteps) || 1)
    const cov = Number(recipe.coverageDays) || 7
    return Math.max(0, Math.round(proj * cov - current))
  }
  // blend：安全库存与历史均值按权重融合
  const safety = Number(r.safety_stock) || 0
  const w = Number(recipe.trendWeight) || 0.3
  const base = safety > 0 ? Math.round(safety * (1 - w) + avg * w) : Math.round(avg)
  const cov = Number(recipe.coverageDays) || 7
  return Math.max(0, Math.round((base * cov) / 7 - current))
}
async function genSuggestions() {
  const recipe = suggRecipe
  const needHist = recipe.strategy !== 'safety'
  if (needHist && !cross.value.rows.every(r => (r.history || []).length >= 2)) {
    const ok = await fetchHistory()
    if (!ok) { toast('历史不足，无法用「' + recipeLabel(recipe.strategy) + '」计算（先点「历史趋势」）', 'warn'); return }
  }
  snapshot()
  cross.value.rows.forEach(r => { r.suggest = computeSuggestion(r, recipe) })
  toast('已按「' + recipeLabel(recipe.strategy) + '」算出建议量' + (needHist ? '（基于近 6 期趋势）' : ''), 'ok')
}
// 合并入口：原「智能建议」(openAudit) 与前端配方计算 (genSuggestions) 合一，避免两个都算建议量造成混淆
// 点「智能建议」同时：弹后端审核窗（r.ai，定稿）+ 填前端配方建议列（r.suggest，可采纳）
function onSuggest() {
  openAudit()
  genSuggestions().catch(() => {})
}
function adoptSuggestion(ri) {
  const r = cross.value.rows[ri]; if (!r) return
  const s = Number(r.suggest) || 0
  if (s <= 0) { toast('该商品当前无需补货', 'warn'); return }
  snapshot()
  const units = cross.value.units
  if (units.length) {
    const u0 = units[0].name
    r.qtyByUnit[u0] = (parseInt(r.qtyByUnit[u0]) || 0) + s
  }
  r.suggest = 0
  toast('已采纳建议 +' + s, 'ok')
}
const totalSuggest = computed(() => cross.value.rows.reduce((s, r) => s + (Number(r.suggest) || 0), 0))
// 建议配方：命名保存/载入（localStorage 持久化；后端 /api/forecast/recipe 随租户下发就绪）
async function loadSuggestRecipes() {
  try {
    const d = await forecastRecipeApi.get()         // 后端配方（随租户下发）
    if (d && Array.isArray(d.recipes) && d.recipes.length) { suggestRecipes.value = d.recipes; return }
  } catch (e) { /* 后端未部署，回退本地 */ }
  try { suggestRecipes.value = JSON.parse(localStorage.getItem(SUGGEST_RECIPE_KEY()) || '[]') } catch (e) { suggestRecipes.value = [] }
}
async function saveSuggestRecipe() {
  const n = (window.prompt('配方名称：') || '').trim(); if (!n) return
  const list = JSON.parse(localStorage.getItem(SUGGEST_RECIPE_KEY()) || '[]')
  const item = { name: n, recipe: clone(suggRecipe) }
  const i = list.findIndex(x => x.name === n); if (i >= 0) list[i] = item; else list.push(item)
  localStorage.setItem(SUGGEST_RECIPE_KEY(), JSON.stringify(list))   // 本地兜底
  // 云端同步失败不说成成功：本地已落盘，但换设备/清缓存后会丢，须让用户知道
  let cloudOk = true
  try { await forecastRecipeApi.save(list) } catch (e) { cloudOk = false }
  loadSuggestRecipes(); recipePick.value = n
  toast(cloudOk ? '已存为配方「' + n + '」' : '已存到本地，但云端同步失败（换设备不可用）', cloudOk ? 'ok' : 'warn')
}
function applySuggestRecipe(name) {
  const s = suggestRecipes.value.find(x => x.name === name); if (!s) return
  Object.assign(suggRecipe, s.recipe); recipePick.value = name; toast('已载入配方「' + name + '」', 'ok')
}

// P3-2 条件格式告警
function rowWarn(r) {
  if (!r) return ''
  if (r.safety_stock > 0 && rowSum(r) < r.safety_stock) return 'low'
  if (r.expiry_days > 0 && r.expiry_days <= 7) return 'short'
  return ''
}
function warnClass(ri) {
  const w = rowWarn(cross.value.rows[ri])
  return w === 'low' ? 'warn-low' : w === 'short' ? 'warn-short' : ''
}

// P3-3 多期对比（任选基线期；保留「对比上期」快捷）
const compareOn = ref(false)
const compareBaseId = ref('')
const prevMap = ref({})
const prevPeriodName = ref('')
const compareablePeriods = computed(() => {
  const cur = cross.value.period
  return [...periods.value]
    .sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
    .filter(x => !cur || Number(x.id) !== Number(cur.id))
})
async function loadComparePeriod(pid) {
  const cur = cross.value.period
  if (!cur) { toast('请先选定期次', 'warn'); return }
  const base = periods.value.find(x => Number(x.id) === Number(pid))
  if (!base) { toast('请选择对比期', 'warn'); return }
  prevPeriodName.value = base.name
  try {
    const d = await forecastApproveApi.summary('', base.order_start || '', base.order_end || '', base.id || 0)
    const m = {}
    ;(d.rows || []).forEach(r => {
      const name = r.product_name || r.name
      const total = (r.sources || []).reduce((s, x) => s + (parseInt(x.qty) || 0), 0)
      m[name] = (m[name] || 0) + total
    })
    prevMap.value = m
    compareOn.value = true
    toast('已载入「' + base.name + '」对比', 'ok')
  } catch (e) { toast('对比期载入失败', 'err') }
}
function comparePrev() {
  const cur = cross.value.period
  if (!cur || !periods.value.length) { toast('无可用期次', 'warn'); return }
  const sorted = [...periods.value].sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
  const idx = sorted.findIndex(x => Number(x.id) === Number(cur.id))
  const prev = idx > 0 ? sorted[idx - 1] : null
  if (!prev) { toast('没有上一期可对比', 'warn'); return }
  compareBaseId.value = prev.id
  loadComparePeriod(prev.id)
}
function clearCompare() { compareOn.value = false; compareBaseId.value = ''; prevMap.value = {}; prevPeriodName.value = '' }
function prevQty(r) { const v = prevMap.value[r.name]; return v != null ? v : null }
function deltaQty(r) { const p = prevQty(r); if (p == null) return null; return rowSum(r) - p }
function deltaClass(r) { const d = deltaQty(r); if (d == null) return ''; return d > 0 ? 'up' : d < 0 ? 'down' : '' }

/* ==== v212（P2-1 + P2-2）：**上一期「按客户」的数量** —— 一个数据源，喂两个功能 ====
   · 用途①「数量格候选」：点进数量格时给「上期这客户订了多少」（P2-1）。
   · 用途②「软警告分级」：本格 vs 上期同格 ⇒ 疑「超放量」/ 疑「漏订」（P2-2）。

   🔴 为什么必须是**按客户**（per store），不能用现成的 `prevMap`：
      `prevMap`（「上期量」列的数据）是**按商品汇总**的（所有客户合计）。拿它去比**单格**数量
      ⇒ 一个客户订 20、而该商品上期 10 个客户共 200 ⇒ 会被判成「严重漏订」，
      整表满屏黄。**逐格比必须用逐格的数**。
      好在不需要改后端也不需要新接口 —— sources 里本来就带 `store` + `qty`
      （见后端 erp_db.py::forecast_submission_summary 的 by_product 段）。

   ⚠️ 失败**静默降级**（prevUnitMap 留空 ⇒ 候选少一类、软警告不亮），绝不 toast 报错：
      这是**增益信息**；新建期次第一次用时它天然为空，报错就是纯噪音。
   ⚠️ 调用处**不 await**：进编辑网格不该为参考数据多等一次往返。 */
const prevUnitMap = ref({})        // { product_id: { 客户名: 上期数量和 } }
const prevUnitsLoaded = ref(false)  // 已尝试加载（含「加载过但为空」）—— 防重复请求
const prevUnitsPeriod = ref('')    // 上期名字，候选/角标文案里要说明「这些数从哪来」
async function loadPrevUnits() {
  if (prevUnitsLoaded.value) return
  const cur = cross.value.period
  if (!cur || !periods.value.length) return
  const sorted = [...periods.value].sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
  const idx = sorted.findIndex(x => Number(x.id) === Number(cur.id))
  const prev = idx > 0 ? sorted[idx - 1] : null
  if (!prev) return
  prevUnitsLoaded.value = true
  try {
    const d = await forecastApproveApi.summary('', prev.order_start || '', prev.order_end || '', prev.id || 0)
    const m = {}
    ;(d.rows || []).forEach(r => {
      const pid = Number(r.product_id) || 0
      if (!pid) return
      const bucket = m[pid] || (m[pid] = {})
      ;(r.sources || []).forEach(s => {
        const name = s.store || s.store_name || '未署名'
        bucket[name] = (bucket[name] || 0) + (parseInt(s.qty) || 0)
      })
    })
    prevUnitMap.value = m
    prevUnitsPeriod.value = prev.name || ''
  } catch (e) { /* 增益信息：静默降级 */ }
}
function prevUnitQty(r, unitName) {
  const b = prevUnitMap.value[Number(r && r.product_id) || 0]
  if (!b) return null
  const v = b[unitName]
  return v == null ? null : v
}

/* ---- P2-1：数量格「上期值 / 常用值」候选 ----
   候选来源（按优先级）：
     ① **上期同格**（同商品 × 同客户）—— 报单是周期性重复动作，这条命中率最高，
        也是「一键落数」真正省事的一条。
     ② **本期同商品、其它客户列已经填过的值**（纯本地、零请求）—— 同一商品铺货常是同一个量；
        排除 0（0 在这里的意思是「还没填」而不是「填了 0」），按出现次数降序取前 3。

   🔴 为什么是「单实例 datalist + 强制重建」，而不是每格一个：
      数量格有 `行数 × 客户列数` 个（生产实测 158 行 × 21 列 ≈ 3300）。每格自带一份 option
      ⇒ 点击展开直接卡死标签页（v211 商品名补全那段注释里实测过同类做法，428×行数 就够卡死）。
      ⇒ 全局只保留**一个** `#opt-qty`，靠 `:key="qtyOptKey"` 在换格时**销毁重建**：
        · 节点数永远 = 当前格的候选数（通常 1~4 个，不是 3300 个）；
        · 「重建」是刻意的 —— 只改 <option> 内容、不换节点的话，`input.list` 的惰性解析
          可能沿用旧候选，用户会看到**上一格的**候选（这是本设计唯一的真实风险点，真机验过）。
   ⚠️ 只有「当前聚焦的那一格」的 input 才带 `list` 指向它（靠 `qtyOptKey` 比对），
      其它格不带 —— 否则多格共享一个内容会变的 datalist，会互相看到对方的候选。 */
const qtyCellOptions = ref([])
const qtyOptKey = ref('')   // `${ri}-${ui}`；空串 = 没有任何格在聚焦（datalist 不渲染）
function buildQtyCellOptions(ri, ui) {
  const r = cross.value.rows[ri]
  const u = cross.value.units[ui]
  if (!r || !u) return []
  const out = []
  const seen = new Set()
  const pv = prevUnitQty(r, u.name)
  if (pv != null && pv > 0) {
    out.push({ v: String(pv), l: '上期 ' + fmt(pv) + (prevUnitsPeriod.value ? '（' + prevUnitsPeriod.value + '）' : '') })
    seen.add(String(pv))
  }
  const tally = {}
  cross.value.units.forEach(x => {
    if (x.name === u.name) return
    const q = parseInt(r.qtyByUnit[x.name]) || 0
    if (q > 0) tally[q] = (tally[q] || 0) + 1
  })
  Object.keys(tally).map(Number)
    .sort((a, b) => tally[b] - tally[a] || a - b)
    .slice(0, 3)
    .forEach(q => {
      const k = String(q)
      if (seen.has(k)) return
      seen.add(k)
      out.push({ v: k, l: '本期其它客户填 ' + fmt(q) + '（' + tally[q] + ' 个客户）' })
    })
  return out
}

/* 换格时同步候选。`qtyOptKey` 同时干两件事：① datalist 的 `:key`（强制销毁重建）
   ② 只有 key 匹配的那一格才带 `list` 属性（见模板）。
   ⚠️ 非数量格（主档列 / 计算列）必须把 key 清空 —— 否则上一个数量格的 datalist 还挂着，
      用户切到主档列后那个 `#opt-qty` 依然在 DOM 里，属于「看不见但还在」的残留状态。 */
function syncQtyCellOptions(r, c) {
  const vm = visibleCols.value.length
  const ui = c - vm
  if (ui < 0 || ui >= unitCount()) { qtyOptKey.value = ''; qtyCellOptions.value = []; return }
  const key = r + '-' + ui
  if (key === qtyOptKey.value) return
  qtyCellOptions.value = buildQtyCellOptions(r, ui)
  qtyOptKey.value = key
}
function qtyListFor(ri, ui) { return (editMode.value && qtyOptKey.value === (ri + '-' + ui)) ? 'opt-qty' : null }

/* ---- P2-2：软警告分级 —— 「黄 = 疑」 ----
   红框（`cellIssue`）管的是**一定错**：非数字 / 负数 / 非整数 / 超上限 / 条码重复。
   这里管的是**可能错**，两类：
     · `over` 疑超放量：本格 > 0 且 本格 ≥ 上期同格 × overRatio（默认 5 倍）
     · `miss` 疑漏订：上期同格 > 0 而本格 = 0

   🔴 漏订判据**必须带一个前提**：该商品行本期**已经有别的客户填过值**（`rowSum(r) > 0`）。
      否则一进编辑网格（全表数量皆空、视作 0）时，每一格「上期有值」的都会亮黄 ⇒
      满屏黄 = 没人再看。带上前提后语义才对：**这个商品本期确实在报，只是这个客户漏了**。
   ⚠️ 阈值进 `softWarnCfg` 并落 localStorage，**不写死在判据里** ——
      经销商口味不同（有人 3 倍就慌、有人 10 倍才算异常），写死等于每个租户都得改代码。
   ⚠️ 只在**数量格**判。主档数字列（安全库存 / 保质期 / 到货周期…）拿「上期数量」去比
      没有业务含义，判了就是假警报。 */
const SOFTWARN_KEY = () => 'hergent_forecast_softwarn_v1'
const softWarnCfg = reactive({ overOn: true, missOn: true, overRatio: 5 })
try {
  const _sw = JSON.parse(localStorage.getItem(SOFTWARN_KEY()) || 'null')
  if (_sw && typeof _sw === 'object') Object.assign(softWarnCfg, _sw)
} catch (e) { /* 存储不可用：用默认值 */ }
function saveSoftWarnCfg() {
  try {
    localStorage.setItem(SOFTWARN_KEY(), JSON.stringify({
      overOn: softWarnCfg.overOn, missOn: softWarnCfg.missOn, overRatio: softWarnCfg.overRatio,
    }))
  } catch (e) {}
}
function softRatio() { const n = Number(softWarnCfg.overRatio); return n >= 2 ? n : 5 }
/* 🔴 必须是**一次成图的 computed**，不能在单元格里现算 —— 与 `dupBarcodeAt` 同一条理由
   （它的注释里写得很清楚：模板逐格渲染时现扫全表会退化成 O(N²×M)）。
   本页编辑网格量级：428 行 × 21 客户列 ≈ 9k 个数量格；判据里要读「本行本期合计」
   （`rowSum` 本身 O(客户数)）⇒ 现算就是 9k × 21 ≈ 19 万次运算，**每次按键**都会跑一遍。
   成图后：每次变化只扫一遍 rows×units（≈9k 次，快路径下几乎全被 `continue` 跳过），
   模板侧退化为 `Map.get` 的 O(1) 查询。
   ⚠️ 快路径刻意放在最前面：**该行本期一条数量都没填 ⇒ 整行跳过**。
      新建期次进编辑态时这就是绝大多数行的情况（全 0），软警告等于零成本。 */
const softAt = computed(() => {
  const m = new Map()   // `${ri}-${ui}` → 'miss' | 'over'
  if (!softWarnCfg.missOn && !softWarnCfg.overOn) return m
  const rows = cross.value.rows, units = cross.value.units
  if (!rows.length || !units.length) return m
  const ratio = softRatio()
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri]
    const b = prevUnitMap.value[Number(r.product_id) || 0]
    if (!b) continue
    // 本行本期报单合计 —— 同时是 miss 判据的前提，也是本行的快路径开关
    let rowTotal = 0
    for (let ui = 0; ui < units.length; ui++) rowTotal += parseInt(r.qtyByUnit[units[ui].name]) || 0
    if (rowTotal <= 0) continue
    for (let ui = 0; ui < units.length; ui++) {
      const pv = b[units[ui].name]
      if (pv == null || pv <= 0) continue
      const cur = parseFloat(r.qtyByUnit[units[ui].name]) || 0
      if (softWarnCfg.overOn && cur > 0 && cur >= pv * ratio) m.set(ri + '-' + ui, 'over')
      else if (softWarnCfg.missOn && cur === 0) m.set(ri + '-' + ui, 'miss')
    }
  }
  return m
})
function cellSoftIssue(ri, ui) { return softAt.value.get(ri + '-' + ui) || '' }
function cellSoftMsg(ri, ui) {
  const kind = cellSoftIssue(ri, ui)
  if (!kind) return ''
  const r = cross.value.rows[ri]
  const u = cross.value.units[ui]
  if (!r || !u) return ''
  const pv = prevUnitQty(r, u.name) || 0
  const cur = parseFloat(r.qtyByUnit[u.name]) || 0
  const src = prevUnitsPeriod.value ? '「' + prevUnitsPeriod.value + '」' : '上一期'
  if (kind === 'miss') {
    return `疑漏订：${u.name} 在${src}报了 ${fmt(pv)}，本期还是 0（同商品其它客户已报 ${fmt(rowSum(r))}）。确认不订可忽略。`
  }
  return `疑超放量：本期 ${fmt(cur)} 是${src}的 ${fmt(pv)} 的 ${(cur / pv).toFixed(1)} 倍，请确认是否促销 / 新增渠道。`
}
function showCellSoft(ri, ui) { const m = cellSoftMsg(ri, ui); if (m) toast(m, 'warn') }
function toggleSoftWarn(which) {
  if (which === 'miss') softWarnCfg.missOn = !softWarnCfg.missOn
  else softWarnCfg.overOn = !softWarnCfg.overOn
  saveSoftWarnCfg()
  closeCtx()
  toast('软警告「' + (which === 'miss' ? '疑漏订' : '疑超放量') + '」已'
    + ((which === 'miss' ? softWarnCfg.missOn : softWarnCfg.overOn) ? '开启' : '关闭'), 'ok')
}

// P3-4 冻结小计行
const foot = computed(() => {
  const rows = liveRows.value
  const masterSum = {}
  visibleCols.value.forEach(c => { if (c.key !== 'name' && c.edit === 'num') masterSum[c.key] = rows.reduce((s, r) => s + (parseFloat(r[c.key]) || 0), 0) })
  const unitSum = cross.value.units.map(u => rows.reduce((s, r) => s + (parseInt(r.qtyByUnit[u.name]) || 0), 0))
  return { masterSum, unitSum, qty: editTotalQty.value, amount: editTotalAmount.value, suggest: totalSuggest.value }
})

// P3-6 行内 sparkline（近 6 期趋势，按需载入）
const showSpark = ref(false)
// v246：口径说明默认收起，点开才显示（降噪）
const amtNoteOpen = ref(false)
const historyLoading = ref(false)
async function fetchHistory() {
  const cur = cross.value.period
  if (!cur || !periods.value.length) return false
  const sorted = [...periods.value].sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
  const idx = sorted.findIndex(x => Number(x.id) === Number(cur.id))
  const prevs = sorted.slice(Math.max(0, idx - 6), idx)
  if (!prevs.length) return false
  const series = {}
  for (const pp of prevs) {
    const d = await forecastApproveApi.summary('', pp.order_start || '', pp.order_end || '', pp.id || 0)
    ;(d.rows || []).forEach(r => {
      const name = r.product_name || r.name
      const total = (r.sources || []).reduce((s, x) => s + (parseInt(x.qty) || 0), 0)
      if (!series[name]) series[name] = []
      series[name].push(total)
    })
  }
  cross.value.rows.forEach(r => { r.history = series[r.name] || [] })
  return true
}
async function loadHistory() {
  if (!cross.value.period || !periods.value.length) { toast('无可用期次', 'warn'); return }
  historyLoading.value = true
  try {
    const ok = await fetchHistory()
    if (!ok) { toast('不足 6 期历史', 'warn'); return }
    showSpark.value = true
    toast('已载入近 6 期趋势', 'ok')
  } catch (e) { toast('历史载入失败', 'err') }
  finally { historyLoading.value = false }
}
function sparkPoints(r) {
  const a = r.history || []
  if (a.length < 2) return ''
  const w = 84, h = 18, max = Math.max.apply(null, a.concat([1])), min = Math.min.apply(null, a.concat([0]))
  const span = (max - min) || 1
  return a.map((v, i) => {
    const x = (i / (a.length - 1)) * w
    const y = h - ((v - min) / span) * h
    return x.toFixed(1) + ',' + y.toFixed(1)
  }).join(' ')
}
// 迷你折线按趋势方向着色：末值高于首值→涨(红)，否则→跌(绿)，遵循中国涨跌配色约定
function sparkColor(r) {
  const a = r.history || []
  if (a.length < 2) return 'var(--t2)'
  return a[a.length - 1] >= a[0] ? 'var(--dan)' : 'var(--suc)'
}

// P4-7 批量编辑面板
const batchMode = ref(false)
const batch = ref({ col: '', op: 'mul', val: 0 })
const batchableCols = computed(() => {
  const cols = visibleCols.value.filter(c => c.key !== 'name' && c.edit === 'num').map(c => ({ key: c.key, label: c.label }))
  cross.value.units.forEach(u => cols.push({ key: 'unit:' + u.name, label: u.name }))
  return cols
})
function selectedRows() {
  if (selRange.value) { const a = []; for (let i = selRange.value.r0; i <= selRange.value.r1; i++) a.push(i); return a }
  if (selected.value.r >= 0) return [selected.value.r]
  return []
}
function applyBatch() {
  const rows = selectedRows()
  if (!rows.length) { toast('请先选中行（Shift+点击 或 拖选）', 'warn'); return }
  const v = parseFloat(batch.value.val) || 0
  snapshot()
  rows.forEach(ri => {
    const r = cross.value.rows[ri]
    if (batch.value.col.startsWith('unit:')) {
      const un = batch.value.col.slice(5)
      const cur = parseInt(r.qtyByUnit[un]) || 0
      r.qtyByUnit[un] = batch.value.op === 'mul' ? Math.round(cur * v) : batch.value.op === 'add' ? cur + v : v
    } else {
      const cur = parseFloat(r[batch.value.col]) || 0
      r[batch.value.col] = batch.value.op === 'mul' ? Math.round(cur * v) : batch.value.op === 'add' ? cur + v : v
    }
  })
  toast('已对 ' + rows.length + ' 行应用', 'ok')
}

// P4-8 版本快照对比
const SNAP_KEY = () => 'forecast_snaps_' + (cross.value.period ? cross.value.period.id : 'default')
const snaps = ref([])
const snapCompare = ref(null)
function loadSnaps() { try { snaps.value = JSON.parse(localStorage.getItem(SNAP_KEY()) || '[]') } catch (e) { snaps.value = [] } }
function saveSnap() {
  const name = (window.prompt('快照名称：') || '').trim() || ('快照 ' + new Date().toLocaleString())
  const list = JSON.parse(localStorage.getItem(SNAP_KEY()) || '[]')
  list.push({ name, time: Date.now(), data: clone(cross.value) })
  localStorage.setItem(SNAP_KEY(), JSON.stringify(list.slice(-10)))
  loadSnaps(); toast('已保存快照', 'ok')
}
function applySnap(name) {
  const s = snaps.value.find(x => x.name === name); if (!s) return
  snapshot(); cross.value = clone(s.data); toast('已恢复快照「' + name + '」', 'ok')
}
function diffSnap(name) {
  const s = snaps.value.find(x => x.name === name); if (!s) return
  snapCompare.value = name
  const base = {}
  ;(s.data.rows || []).forEach(r => { base[r.name] = r.qtyByUnit || {} })
  cross.value.rows.forEach(r => {
    const b = base[r.name] || {}
    const d = {}
    cross.value.units.forEach(u => { const cur = parseInt(r.qtyByUnit[u.name]) || 0; const was = parseInt(b[u.name]) || 0; if (cur !== was) d[u.name] = cur - was })
    r._diff = d
  })
  toast('已对比快照「' + name + '」', 'ok')
}
function cellDiff(ri, ui) {
  const d = cross.value.rows[ri]._diff; if (!d) return 0
  return d[cross.value.units[ui].name] || 0
}

// P4-8 补充：快照差异导出 Excel
function exportDiffXlsx() {
  if (!snapCompare.value) { toast('请先在快照栏选择对比快照', 'warn'); return }
  const base = snaps.value.find(s => s.name === snapCompare.value)
  if (!base) return
  const units = cross.value.units
  const baseMap = {}
  ;(base.data.rows || []).forEach(r => { baseMap[r.name] = r.qtyByUnit || {} })
  const headers = ['商品', '当前合计', '对比合计', '合计Δ']
  units.forEach(u => headers.push(u.name + ' Δ'))
  const data = [headers]
  cross.value.rows.forEach(r => {
    const cur = rowSum(r)
    let was = 0
    units.forEach(u => { was += parseInt((baseMap[r.name] || {})[u.name]) || 0 })
    const line = [r.name || '', cur, was, cur - was]
    units.forEach(u => {
      const c = parseInt(r.qtyByUnit[u.name]) || 0
      const w = parseInt((baseMap[r.name] || {})[u.name]) || 0
      line.push(c - w)
    })
    data.push(line)
  })
  // 合计行
  const tot = ['合计', 0, 0, 0]
  units.forEach(() => tot.push(0))
  cross.value.rows.forEach(r => {
    tot[1] += rowSum(r)
    let was = 0
    units.forEach(u => { was += parseInt((baseMap[r.name] || {})[u.name]) || 0 })
    tot[2] += was
    tot[3] += rowSum(r) - was
  })
  units.forEach((u, ui) => {
    cross.value.rows.forEach(r => {
      const c = parseInt(r.qtyByUnit[u.name]) || 0
      const w = parseInt((baseMap[r.name] || {})[u.name]) || 0
      tot[4 + ui] += c - w
    })
  })
  data.push(tot)
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '差异对比')
  XLSX.writeFile(wb, `差异对比_${snapCompare.value}.xlsx`)
  toast('已导出差异 Excel', 'ok')
}

// P4-9 打印 / PDF
function printGrid() { window.print() }

// P4-10 配方化列方案（租户隔离 + 云端就绪：后端 /api/forecast/column-schemes 下发，localStorage 兜底）
const SCHEME_KEY = () => 'forecast_col_schemes_' + (auth.user?.id || 'default')
const schemes = ref([])
const schemeName = ref('')
const schemeSaveName = ref('')    // 「保存当前」时输入的新方案名（独立于下拉选中的 schemeName）
async function loadSchemes() {
  try {
    const d = await columnSchemeApi.list()           // 后端随租户配方下发（跨设备同步）
    if (d && Array.isArray(d.schemes)) { schemes.value = d.schemes; return }  // 后端成功即以云端为准（含空数组）
  } catch (e) { /* 后端未部署/出错，回退本地 */ }
  try { schemes.value = JSON.parse(localStorage.getItem(SCHEME_KEY()) || '[]') } catch (e) { schemes.value = [] }
}
async function saveScheme() {
  const n = (schemeSaveName.value || '').trim(); if (!n) { toast('请输入方案名', 'warn'); return }
  const item = { name: n, order: clone(colOrder.value), vis: clone(colVis.value) }
  const i = schemes.value.findIndex(x => x.name === n); if (i >= 0) schemes.value[i] = item; else schemes.value.push(item)
  localStorage.setItem(SCHEME_KEY(), JSON.stringify(schemes.value))   // 本地兜底
  // 云端同步失败不说成成功：本地已落盘，但换设备/清缓存后会丢，须让用户知道
  let cloudOk = true
  try { await columnSchemeApi.save(schemes.value) } catch (e) { cloudOk = false }
  schemeName.value = n          // 保存后下拉自动选中刚保存的方案
  schemeSaveName.value = ''     // 清空输入框
  toast(cloudOk ? '已保存列方案「' + n + '」' : '已存到本地，但云端同步失败（换设备不可用）', cloudOk ? 'ok' : 'warn')
}
function applyScheme(name) {
  const s = schemes.value.find(x => x.name === name); if (!s) return
  colOrder.value = clone(s.order); colVis.value = clone(s.vis); _persistCols(); toast('已应用方案「' + name + '」', 'ok')
}
async function delScheme(name) {
  if (!name) return
  schemes.value = schemes.value.filter(x => x.name !== name)
  localStorage.setItem(SCHEME_KEY(), JSON.stringify(schemes.value)) // 本地兜底
  if (schemeName.value === name) schemeName.value = ''
  let cloudOk = true
  try { await columnSchemeApi.save(schemes.value) } catch (e) { cloudOk = false }
  toast(cloudOk ? '已删除方案「' + name + '」' : '已删除本地方案，但云端同步失败', cloudOk ? 'ok' : 'warn')
}

/* ===== P5 / P6 / P7 下一代增强（前端交付，零后端风险；P6-8/P7-10 后端就绪） ===== */
// P5-1 货损联动告警：短保商品订量明显偏高时提示货损风险
function lossWarn(r) {
  if (!r) return ''
  const exp = Number(r.expiry_days) || 0
  if (exp <= 0) return ''
  const qty = rowSum(r)
  const safety = Number(r.safety_stock) || 0
  if (exp <= 7 && safety > 0 && qty > safety) return 'risk'
  if (exp <= 14 && safety > 0 && qty > safety * 1.5) return 'watch'
  return ''
}
function lossTip(r) {
  const w = lossWarn(r); if (!w) return ''
  return w === 'risk'
    ? `短保(保质期${r.expiry_days}天)且订量 ${rowSum(r)} 超安全库存，货损风险高`
    : `保质期仅${r.expiry_days}天，订量偏高，注意货损`
}

// P5-2 返利行内冲刺提示（复用 rebateGap，填报时前置冲档建议）
const rebatePushOpen = ref(false)
const rebatePushList = ref([])
const rebatePushLoading = ref(false)
async function loadRebatePush() {
  rebatePushLoading.value = true
  try {
    let balances = []
    try { const rb = await forecastApi.rebateGap({ supplier_id: 0, extra_amount: 0 }); balances = rb.balances || [] } catch (e) { balances = [] }
    const list = []
    for (const b of balances) {
      try {
        const r = await forecastApi.rebateGap({ supplier_id: b.supplier_id, extra_amount: 0 })
        const p = r.projection
        if (p && !p.at_max_tier && p.gap_amount > 0) list.push({ supplier: b.supplier_name, pct: p.next_pct, gap: p.gap_amount, extra: p.extra_rebate_estimate || 0 })
      } catch (e) {}
    }
    rebatePushList.value = list
    rebatePushOpen.value = true
  } finally { rebatePushLoading.value = false }
}

// P5-3 MOQ 起订量 + 到货周期（前端 localStorage 配置；行内可编辑，零后端风险）
const MOQ_KEY = () => 'forecast_moq_' + (auth.user?.id || 'default')
const moqMap = reactive({})
function loadMoq() { try { Object.assign(moqMap, JSON.parse(localStorage.getItem(MOQ_KEY()) || '{}')) } catch (e) {} }
function saveMoq() { localStorage.setItem(MOQ_KEY(), JSON.stringify(moqMap)) }
function rowMoq(r) { return Number(moqMap[r.product_id]?.moq) || 0 }
function rowLead(r) { return Number(moqMap[r.product_id]?.lead_days) || 0 }
function moqWarn(r) { const m = rowMoq(r); return m > 0 && rowSum(r) < m ? 'below' : '' }
const showMoq = ref(false)
function syncMoq() {
  cross.value.rows.forEach(r => { if (r.product_id) moqMap[r.product_id] = { moq: Number(r.moq) || 0, lead_days: Number(r.lead_days) || 0 } })
  saveMoq()
}

// P5-4 季节因子同环比（去年同期基线）
const yoyOn = ref(false)
const yoyMap = ref({})
const yoyPeriodName = ref('')
async function loadYoY() {
  const cur = cross.value.period
  if (!cur || !periods.value.length) { toast('请先选定期次', 'warn'); return }
  const sorted = [...periods.value].sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
  const idx = sorted.findIndex(x => Number(x.id) === Number(cur.id))
  const curStart = cur.order_start || ''
  const yStart = (curStart.length >= 4 && curStart.slice(0, 4) !== '0000') ? (parseInt(curStart.slice(0, 4)) - 1) + curStart.slice(4) : ''
  const yoy = yStart ? sorted.find(x => (x.order_start || '').slice(0, 7) === yStart.slice(0, 7)) : null
  if (!yoy) { toast('无去年同期期次（需同名月份期次）', 'warn'); return }
  yoyPeriodName.value = yoy.name
  try {
    const d = await forecastApproveApi.summary('', yoy.order_start || '', yoy.order_end || '', yoy.id || 0)
    const m = {}
    ;(d.rows || []).forEach(r => { const name = r.product_name || r.name; const total = (r.sources || []).reduce((s, x) => s + (parseInt(x.qty) || 0), 0); m[name] = (m[name] || 0) + total })
    yoyMap.value = m; yoyOn.value = true
    toast('已载入去年同期「' + yoy.name + '」', 'ok')
  } catch (e) { toast('去年同期载入失败', 'err') }
}
function yoyQty(r) { const v = yoyMap.value[r.name]; return v != null ? v : null }
function yoyPct(r) { const y = yoyQty(r); if (y == null || y === 0) return null; return Math.round((rowSum(r) - y) / y * 100) }

// P6-5 提交前 AI 体检（异常行扫描）
const healthOpen = ref(false)
const healthIssues = computed(() => {
  const issues = []
  cross.value.rows.forEach((r, ri) => {
    const qty = rowSum(r)
    const safety = Number(r.safety_stock) || 0
    const hist = r.history || []
    const avg = hist.length ? hist.reduce((s, x) => s + (Number(x) || 0), 0) / hist.length : 0
    if (qty === 0 && avg > 0) issues.push({ ri, sev: 'warn', msg: `「${r.name}」订量 0，但历史均值 ${Math.round(avg)}，可能漏订` })
    if (avg > 0 && qty > avg * 2) issues.push({ ri, sev: 'risk', msg: `「${r.name}」订量 ${qty} 暴涨（均值 ${Math.round(avg)} 的 ${(qty / avg).toFixed(1)}×）` })
    if (avg > 0 && qty > 0 && qty < avg * 0.5) issues.push({ ri, sev: 'warn', msg: `「${r.name}」订量 ${qty} 暴跌（均值 ${Math.round(avg)}）` })
    if (safety > 0 && qty > safety * 3) issues.push({ ri, sev: 'warn', msg: `「${r.name}」订量 ${qty} 超安全库存 3 倍（${safety * 3}），注意积压/货损` })
    const lw = lossWarn(r); if (lw === 'risk') issues.push({ ri, sev: 'risk', msg: `「${r.name}」${lossTip(r)}` })
    const mw = moqWarn(r); if (mw === 'below') issues.push({ ri, sev: 'info', msg: `「${r.name}」未达 MOQ ${rowMoq(r)}（当前 ${qty}）` })
  })
  const order = { risk: 0, warn: 1, info: 2 }
  return issues.sort((a, b) => order[a.sev] - order[b.sev])
})
function jumpToRow(ri) {
  const r = cross.value.rows[ri]; if (!r) return
  selectCell(ri, 0); focusCell(ri, 0)
  healthOpen.value = false
  nextTick(() => { const el = document.querySelector(`.edit-tbl [data-r="${ri}"]`); if (el) el.scrollIntoView({ block: 'center' }) })
}

// P6-6 单元格批注（按商品行；localStorage）
const NOTE_KEY = () => 'forecast_notes_' + (auth.user?.id || 'default')
const notesMap = reactive({})
function loadNotes() { try { Object.assign(notesMap, JSON.parse(localStorage.getItem(NOTE_KEY()) || '{}')) } catch (e) {} }
function saveNotes() { localStorage.setItem(NOTE_KEY(), JSON.stringify(notesMap)) }
function rowNote(r) { return notesMap[r.product_id] || '' }
// 商品名输入框右 padding：仅当该行有右侧告警徽标时按数量预留空间，无徽标行文字可用满整框
function namePadStyle(r) {
  let n = 0
  if (rowWarn(r)) n++
  if (lossWarn(r)) n++
  if (rtBadge(r)) n++
  if (rowNote(r)) n++
  if (gapSet.value.has(r.product_id)) n++
  if (hsMap[r.product_id] !== undefined && hsMap[r.product_id] < 60) n++
  return n ? `padding-right:${n * 18 + 8}px` : 'padding-right:6px'
}
function setRowNote(ri) {
  const r = cross.value.rows[ri]; if (!r) return
  const t = window.prompt('批注（商品行备注）：', rowNote(r))
  if (t === null) return
  if (t.trim()) notesMap[r.product_id] = t.trim(); else delete notesMap[r.product_id]
  saveNotes(); saveCloudNotes(); toast('已保存批注', 'ok')
}

// P6-7 网格内搜索（Ctrl+F 聚焦，回车跳下一匹配）
const findText = ref('')
const findIdx = ref(-1)
const findHits = computed(() => {
  const f = (findText.value || '').trim().toLowerCase(); if (!f) return []
  const out = []
  cross.value.rows.forEach((r, i) => { if (rowMatchText(r, f)) out.push(i) })
  return out
})
function focusFind() { const el = document.getElementById('gridFind'); if (el) el.focus() }
function findNext() {
  if (!findHits.value.length) { toast('无匹配', 'warn'); return }
  findIdx.value = (findIdx.value + 1) % findHits.value.length
  const ri = findHits.value[findIdx.value]
  selectCell(ri, 0); focusCell(ri, 0)
  nextTick(() => { const el = document.querySelector(`.edit-tbl [data-r="${ri}"]`); if (el) el.scrollIntoView({ block: 'center' }) })
}
function onFindKey(e) { if (e.key === 'Enter') { e.preventDefault(); findNext() } }
onMounted(() => { window.addEventListener('keydown', onGlobalFind) })
function onGlobalFind(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && editMode.value) { e.preventDefault(); focusFind() }
}

// 表体全屏：一键展开表体至全屏（视觉与 AI 副驾 .cp-icon-btn 全屏按钮对齐）
const gridFullscreen = ref(false)
// 全屏缩放：按比例放大/缩小汇总表，便于查看数据（仅全屏时显示控制条）
const gridZoom = ref(100)
function toggleGridFullscreen() {
  gridFullscreen.value = !gridFullscreen.value
  if (!gridFullscreen.value) gridZoom.value = 100
  // v129：全屏层 z-index:1000 会盖住主工具栏，若此时仍开着下拉（面板 fixed/1101、遮罩 1100 都在全屏层之上）
  // 会留一个浮在表体上的孤儿弹层，进出全屏一律先收起。
  _closePopPanes('')
}
function onFsKey(e) { if (e.key === 'Escape' && gridFullscreen.value) gridFullscreen.value = false }
onMounted(() => { window.addEventListener('keydown', onFsKey) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onFsKey) })

/* P2-⑬ 键盘可达性快捷键（与 Esc 退出全屏一起构成键盘操作层）：
   · Ctrl/Cmd+S → 保存（编辑态下；即使用户焦点在输入框也允许，避免「点了没存」焦虑）；
   · [ / ] → 切换上一/下一期次（仅只读态、且焦点不在输入控件时，避免与正常输入冲突）。
   ⚠️ 与既有 onGlobalFind(Ctrl/Cmd+F) 共存：二者绑定在同一 window keydown，互不重叠。 */
function onKbdShortcuts(e) {
  const ae = document.activeElement
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    if (editMode.value) { e.preventDefault(); saveEdits() }
    return
  }
  if (!typing && !editMode.value && (e.key === '[' || e.key === ']')) {
    const sorted = [...(periods.value || [])].sort((a, b) => (a.order_start || '').localeCompare(b.order_start || ''))
    if (!sorted.length) return
    const idx = sorted.findIndex(x => Number(x.id) === Number(curPeriod.value))
    const ni = e.key === '[' ? idx - 1 : idx + 1
    if (ni >= 0 && ni < sorted.length) { e.preventDefault(); gotoPeriod(sorted[ni].id) }
  }
}
onMounted(() => { window.addEventListener('keydown', onKbdShortcuts) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKbdShortcuts) })

/* v209：全屏态把「改单 / 编辑组」搬进表格工具行后，**主工具栏那一份必须让位**。
   不让位也能用（全屏层是不透明 fixed 且 z-index:1000，会把它整条盖住），但会留下两份 DOM：
   被盖住的那份仍在 Tab 序里、屏幕阅读器也会读两遍 —— 同一个按钮出现两次。
   🔴 **让位判据必须与「全屏层此刻真的挂在屏幕上」严格同源**，即模板里那条 v-if 链
      `crossLoading → !editMode → 编辑态` 中真正渲染 .grid-area 的那两支。
      漏掉 `!crossLoading` 会造出**死按钮**：重新加载期间 .grid-area 整块被骨架替换、全屏层随之消失，
      此时若主工具栏那份已经让位，屏幕上就一个「改单」都没有 —— 点了没反应，且**不报任何错**。
      （这类「一个状态两种含义」的失效形态在本项目已多次复现，故此处显式写死三条件。）
   ⚠️ viewMode 也要判：表格工具行只在汇总表视图里存在（.cross-area 是 v-if），
      逐单补录视图下它不在 DOM 中 —— 若那时仍让位，同样是无入口。 */
const fsRowHosting = computed(() => gridFullscreen.value && viewMode.value === 'cross' && !crossLoading.value)

// P6-8 企微/飞书推送快照（后端就绪 /api/forecast/push；失败降级复制）
const pushing = ref(false)
async function pushForecast() {
  const p = cross.value.period; if (!p) { toast('请先选定期次', 'warn'); return }
  const riskN = healthIssues.value.filter(x => x.sev === 'risk').length
  // v187：金额口径改为与全站「报单金额 = 最终下单(箱) × 单价(进价/箱)」同源（原为分销价 × 合计），标签同步自证。
  // v189：原写「总箱 ${editTotalQty}」—— editTotalQty 是 Σ各报单单元数量（**小单位**），
  //   标签「箱」是错的（同「规格 ≠ 1 时件数错」同一个病）。推送是给审批人看的一句话，
  //   口径必须自证：改标「合计(箱)」并用箱口径 editTotalBoxes（= Σ(行小单位 ÷ 行规格)）。
  // v207：箱数改走 fmtBox —— 它可能是**小数**（如 0.125），`${数字}` 直接插值位数不可控。
  const summary = `【预报单待审批】${p.name}\nSKU ${liveRows.value.length} · 合计(箱) ${fmtBox(editTotalBoxes.value)} · 下单金额(进价) ¥${fmt(editTotalAmount.value)}\n风险项 ${riskN} 条 · 生成于 ${new Date().toLocaleString()}`
  pushing.value = true
  try {
    await forecastApi.push({ period: p.name, summary, total_sku: cross.value.rows.length, total_qty: editTotalQty.value, total_amount: editTotalAmount.value })
    toast('已推送审批通知', 'ok')
  } catch (e) {
    try { await navigator.clipboard.writeText(summary) } catch (e2) {}
    toast('已复制审批摘要到剪贴板（后端推送未部署）', 'warn')
  } finally { pushing.value = false }
}

// P7-9 大数据分页视图（DOM 仅渲染当前页，ri 仍全局索引，交互零错位）
const pagingOn = ref(false)
const pageSize = ref(50)
const curPage = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(cross.value.rows.length / pageSize.value)))
function pageGo(d) { curPage.value = Math.max(0, Math.min(totalPages.value - 1, curPage.value + d)) }
function pageReset() { curPage.value = 0; findIdx.value = -1 }

/* ============================================================
   P8 / P9 / P10 下一代增强（2026-08-23 端到端落地）
   ============================================================ */

// P8-1 下单说明文档（汇总体检+货损+MOQ，一键推送审批）
const suggestBookOpen = ref(false)
const suggestBookText = ref('')
const suggestBookLoading = ref(false)
function buildSuggestBook() {
  const p = cross.value.period
  const risk = healthIssues.value.filter(x => x.sev === 'risk')
  const warn = healthIssues.value.filter(x => x.sev === 'warn')
  const top = healthIssues.value.slice(0, 6).map(x => '· ' + x.msg).join('\n')
  let t = `【${p ? p.name : '本期'} 订货下单说明】\n`
  t += `共 ${liveRows.value.length} 个 SKU，合计(箱) ${fmtBox(editTotalBoxes.value)}，下单金额(进价) ¥${fmt(editTotalAmount.value)}\n`
  if (!healthIssues.value.length) t += '体检：未发现明显异常，可放心定稿。\n'
  else {
    t += `风险提示（${risk.length} 项高危 / ${warn.length} 项注意）：\n${top}\n`
  }
  const lossN = cross.value.rows.filter(r => lossWarn(r) === 'risk').length
  if (lossN) t += `货损：${lossN} 个短保商品订量超安全库存，建议下调或加快周转。\n`
  const moqN = cross.value.rows.filter(r => moqWarn(r) === 'below').length
  if (moqN) t += `MOQ：${moqN} 个商品未达起订量，建议凑单或调起订量。\n`
  t += '\n（系统建议，最终以人定稿为准）'
  return t
}
function genSuggestBook() {
  suggestBookLoading.value = true
  suggestBookText.value = buildSuggestBook()
  suggestBookLoading.value = false
  suggestBookOpen.value = true
}
async function sendSuggestBook() {
  const p = cross.value.period; if (!p) return
  pushing.value = true
  try {
    await forecastApi.push({ period: p.name, message: suggestBookText.value, summary: suggestBookText.value,
      total_sku: cross.value.rows.length, total_qty: editTotalQty.value, total_amount: editTotalAmount.value })
    toast('下单说明已推送审批', 'ok')
  } catch (e) {
    try { await navigator.clipboard.writeText(suggestBookText.value) } catch (e2) {}
    toast('已复制下单说明到剪贴板（后端推送未部署）', 'warn')
  } finally { pushing.value = false }
}

// P8-2 接实时库存的临期/缺货预警（后端 inventory 批次+到期）
const rtWarnMap = reactive({})
const rtWarnOpen = ref(false)
const rtWarnLoading = ref(false)
async function loadRealtimeWarn() {
  rtWarnLoading.value = true
  try {
    const p = cross.value.period
    const r = await forecastApi.realtimeWarn(p ? p.id : 0)
    const m = {}
    ;(r.items || []).forEach(it => { m[it.product_id] = it })
    Object.keys(rtWarnMap).forEach(k => delete rtWarnMap[k])
    Object.assign(rtWarnMap, m)
    if ((r.items || []).length) rtWarnOpen.value = true
  } catch (e) {} finally { rtWarnLoading.value = false }
}
function rtWarn(r) { return rtWarnMap[r.product_id] || null }
function rtBadge(r) { const w = rtWarn(r); return w ? w.warn : '' }
function rtBadgeTip(r) { const w = rtWarn(r); return w ? w.msg : '' }

// P8-3 预测准确率追踪（上期预报 vs 实际销量）
const accOpen = ref(false)
const accData = ref(null)
const accLoading = ref(false)
async function loadAccuracy() {
  accLoading.value = true
  try {
    const p = cross.value.period
    const r = await forecastApi.accuracyByPeriod(p ? p.id : 0)
    accData.value = r; accOpen.value = true
  } catch (e) { toast('预报准确率载入失败', 'err') } finally { accLoading.value = false }
}

// P9-4 审批流回写（预报单状态机）
const subStatus = ref('draft')
const subBy = ref(''); const subAt = ref(''); const subReason = ref('')
const subOpen = ref(false)
const SUB_LABEL = { draft: '草稿', submitted: '待审批', approved: '已通过', rejected: '已驳回', revised: '退回修改' }
async function loadSubmission() {
  try {
    const p = cross.value.period; if (!p) return
    const r = await forecastApi.submissionGet(p.id)
    subStatus.value = r.status || 'draft'; subBy.value = r.by || ''; subAt.value = r.at || ''; subReason.value = r.reason || ''
  } catch (e) {}
}
async function _subAct(action, reason = '') {
  const p = cross.value.period; if (!p) return
  try {
    const r = await forecastApi.submissionPost({ period_id: p.id, action, reason })
    subStatus.value = r.status; subBy.value = r.by; subAt.value = r.at; subReason.value = r.reason || ''
    const map = { submit: '已提交审批', approve: '已通过', reject: '已驳回', revise: '已退回修改' }
    toast(map[action] || '已更新', 'ok')
  } catch (e) { toast('操作失败: ' + (e.message || ''), 'err') }
}
function doSubmit() { _subAct('submit') }
function doApprove() { _subAct('approve') }
function doReject() { const reason = window.prompt('驳回原因：') || ''; _subAct('reject', reason) }
function doRevise() { _subAct('revise') }

// P9-5 云端共享批注（多人共享，localStorage 兜底）
async function loadCloudNotes() {
  try {
    const p = cross.value.period; if (!p) return
    const r = await forecastApi.notesGet(p.id)
    const m = r.notes || {}
    const plain = {}
    Object.keys(m).forEach(k => { plain[k] = typeof m[k] === 'string' ? m[k] : (m[k].text || '') })
    Object.keys(notesMap).forEach(k => delete notesMap[k])
    Object.assign(notesMap, plain)
  } catch (e) { /* 保留本地批注 */ }
}
async function saveCloudNotes() {
  const p = cross.value.period; if (!p) return
  try {
    const payload = {}
    Object.keys(notesMap).forEach(k => {
      if (notesMap[k]) payload[k] = { text: notesMap[k], by: (auth.user && (auth.user.name || auth.user.username)) || 'me', at: new Date().toISOString() }
    })
    await forecastApi.notesPut({ period_id: p.id, notes: payload })
  } catch (e) {}
}

// P9-6 改动留痕审计（per period 追加）→ v166 更名「修改日志」：加修改人 + 交还全局操作
const trailOpen = ref(false)
const auditTrail = ref([])
const auditGlobal = ref([])       // 与期次无关的全局操作（后端 audit:0）
const atGlobalOpen = ref(false)   // 全局区默认折叠，避免喧宾夺主盖过「本期」这条主线
const auditTrailLoading = ref(false)

// 动作码 → 业务话术：raw 的 'submission.revise' 这类点号码对非技术老板没有意义
const AUDIT_ACTION_LABEL = {
  save_changes: '保存汇总表', import: '导入', adopt: '确认定稿', change: '修改',
  'submission.submit': '提交审批', 'submission.approve': '审批通过',
  'submission.reject': '审批驳回', 'submission.revise': '退回修改',
  factory_price_gate: '进价闸门', connector_writeback: '回写ERP',
  purchase_order_push: '推送采购单', intervention: '异常处置',
  hermes_analyze: 'AI根因分析', period_close: '关闭期次', period_delete: '删除期次',
  period_update: '修改期次',
  // v184：复制期次（新建 + 只带商品清单）/ 把某期清单填入已有期次
  period_copy: '复制期次', period_seed: '复制商品清单',
  // v213-B1：并发冲突下用户明确选择「用我这份覆盖」—— 事后有人问「我的数怎么没了」时，
  //   这一条要能一眼看出是**有意识的覆盖**，而不是一条普通保存记录（见 conflictOverride）
  conflict_override: '覆盖并发改动',
}
function auditActionLabel(a) { return AUDIT_ACTION_LABEL[a] || a || '修改' }
function fmtAuditAt(s) { return String(s || '').replace('T', ' ').slice(0, 16) }

async function loadAuditLog() {
  try {
    const p = cross.value.period
    if (!p) { auditTrail.value = []; auditGlobal.value = []; return }
    const r = await forecastApi.auditGet(p.id)
    auditTrail.value = r.items || []
    auditGlobal.value = r.global_items || []
  } catch (e) {}
}
function toggleTrail() {
  trailOpen.value = !trailOpen.value
  if (trailOpen.value) loadAuditLog()   // 打开即刷新：别人刚做的改动要当场看得见
}
async function recordAudit(action, detail, ref_id = '') {
  const p = cross.value.period; if (!p) return
  try {
    await forecastApi.auditPost({ period_id: p.id, action, detail, ref_id })
    /* v208：只在**面板开着**时刷新列表。
       原实现每次记录都无条件 `loadAuditLog()`（白搭一次往返），而保存路径上用户根本看不见
       —— 打开面板时 toggleTrail 本就会拉一次，不依赖这里。 */
    if (trailOpen.value) await loadAuditLog()
  } catch (e) {
    /* v208：**不再完全静默**。用户要求「每次修改都需记录并体现在修改日志中」，
       原来连失败都不留任何痕迹 ⇒ 日志静默少一条，用户只会觉得"我明明改过"。
       仍然**不阻断业务**（保存照常成功），只留一条告警供排查。 */
    console.warn('[forecast] 修改日志写入失败：', e)
  }
}

// P10-7 配方行业模板库（成功客户 recipe 一键套用，护城河变现）
const tmplOpen = ref(false)
const tmplList = ref([])
const tmplLoading = ref(false)
const tmplName = ref(''); const tmplIndustry = ref(''); const tmplDesc = ref('')
async function loadTemplates() {
  tmplLoading.value = true
  try { const r = await forecastApi.recipeTemplatesGet(); tmplList.value = r.templates || []; tmplOpen.value = true }
  catch (e) { toast('模板载入失败', 'err') } finally { tmplLoading.value = false }
}
async function saveTemplate() {
  if (!tmplName.value) { toast('请填写模板名', 'warn'); return }
  const recipes = JSON.parse(JSON.stringify(suggestRecipes.value || []))
  tmplList.value.push({ name: tmplName.value, industry: tmplIndustry.value, desc: tmplDesc.value, recipes })
  try { await forecastApi.recipeTemplatesPut({ templates: tmplList.value }); toast('已存为行业模板', 'ok') }
  catch (e) { toast('模板存储失败', 'err') }
}
function applyTemplate(t) {
  suggestRecipes.value = JSON.parse(JSON.stringify(t.recipes || []))
  if (t.recipes && t.recipes.length) { recipePick.value = t.recipes[0].name; applySuggestRecipe(t.recipes[0].name) }
  toast(`已套用模板「${t.name}」`, 'ok')
}

// P10-8 经营看板 BI（货损/返利/工资/预报 轻量聚合）
const biOpen = ref(false)
const biData = ref(null)
const biLoading = ref(false)
async function loadBI() {
  biLoading.value = true
  try { const p = cross.value.period; const r = await forecastApi.biSummary(p ? p.id : 0); biData.value = r; biOpen.value = true }
  catch (e) { toast('看板载入失败', 'err') } finally { biLoading.value = false }
}

// P10-9 连接器回写（审批通过后，经畅捷通/金蝶/舟谱回写 ERP；战略：回写走连接器不自研）
const writebackLoading = ref(false)
async function doWriteback() {
  const p = cross.value.period; if (!p) return
  if (subStatus.value !== 'approved') { toast('需先审批通过再回写 ERP', 'warn'); return }
  writebackLoading.value = true
  try {
    const items = cross.value.rows.map(r => ({ product_id: r.product_id, name: r.name, qty: rowSum(r) }))
    const r = await forecastApi.connectorWriteback({ period_id: p.id, connector: 'kingdee', items })
    if (r.soft_fail) toast('连接器未配置（已留痕），需配置 DataSourceAdapter', 'warn')
    else toast('已回写 ERP', 'ok')
  } catch (e) { toast('回写失败', 'err') } finally { writebackLoading.value = false }
}

// P10-10 小程序审批契约（复用审批状态机；此处仅给信息面板，契约见交付文档）
const miniOpen = ref(false)
const openGroup = ref(null)
const advToolsOpen = ref(false)   // 高级工具抽屉（编辑模式下收起/展开 4 个分组 + 审批/推送/打印）
const exportMenuOpen = ref(false)  // ★导出统一菜单：全部/选中行/差异 收进一个下拉，主栏只留一个「导出」
// 主工具栏弹层（高级）改为 Teleport+fixed，脱离 .toolbar{overflow:auto} 裁切；用触发按钮坐标定位
const popStyle = reactive({ top: '0px', left: '0px' })
const advBtn = ref(null)
const exportBtn = ref(null)
// 品牌筛选下拉
const brandBtn = ref(null)
const brandPopOpen = ref(false)
// 工具行「新增客户」下拉（v170）：从表头那一格迁来的入口，参与同一套弹层互斥
const addColBtn = ref(null)
const addColPopOpen = ref(false)
const addColName = ref('')
const addColInput = ref(null)
// 主工具栏各下拉互斥：只允许同时开一个（共享 popStyle 定位 + 一个透明遮罩）。
// 触发按钮已提层(z1120 > overlay z1100)，弹层开着时可直接点其它触发按钮做互斥切换，
// 避免用户“先选品牌、再点复制报单”时第一次点击被遮罩吃掉（只关面板不开新面板）。
function _closePopPanes(except) {
  if (except !== 'adv') advToolsOpen.value = false
  if (except !== 'export') exportMenuOpen.value = false
  if (except !== 'brand') brandPopOpen.value = false
  if (except !== 'copy') copyMenuOpen.value = false
  if (except !== 'addcol') addColPopOpen.value = false
}
function toggleBrandPop() {
  const open = !brandPopOpen.value
  _closePopPanes(open ? 'brand' : '')
  brandPopOpen.value = open
  if (open) nextTick(() => positionTbPop(brandBtn.value))
}
// 工具栏「复制」下拉：列出所有期次列，复制该列厂家编码 / 下单数量（分开复制）
const copyBtn = ref(null)
const copyMenuOpen = ref(false)
function toggleCopyMenu() {
  const open = !copyMenuOpen.value
  _closePopPanes(open ? 'copy' : '')
  copyMenuOpen.value = open
  if (open) nextTick(() => positionTbPop(copyBtn.value))
}
// 工具行「新增客户」下拉（v170）—— 与品牌/复制报单共用同一套定位(positionTbPop)与互斥
function toggleAddColPop() {
  const open = !addColPopOpen.value
  _closePopPanes(open ? 'addcol' : '')
  addColPopOpen.value = open
  if (open) {
    nextTick(() => {
      positionTbPop(addColBtn.value)
      // 面板 Teleport 到 body，开面板即聚焦，用户可直接敲名字回车
      const el = addColInput.value || document.querySelector('.addcol-pop .ac-input')
      if (el) el.focus()
    })
  } else {
    addColName.value = ''
  }
}
function confirmAddCol() {
  const v = addColName.value.trim()
  if (!v) return
  // 重名时 addUnit 已给 toast，此处刻意**不关面板**，让用户直接改名字重试
  if (addUnit(v)) {
    addColName.value = ''
    addColPopOpen.value = false
  }
}
// 复制只针对「本期期次」（不按报单单元列拆选）
const copyUnitName = computed(() => (cross.value.period && cross.value.period.name) ? cross.value.period.name : (cross.value.units && cross.value.units[0] ? cross.value.units[0].name : '本期'))
// 「最终下单」唯一口径（用户口径 2026-09-15 订正）：**报单合计 + 加单**，不区分是否定稿。
//   - 基准：只读主表行带后端权威 total（=SUM(quantity)）；编辑态草稿行无 total → 回退 rowSum（单元求和）。
//   - 加单兼容两种存法：只读态 extra_qty（后端 forecast_extra_qty）/ 编辑态 extraQty（本地草稿）。
//   ⚠️ 本函数是全站唯一实现 —— 模板显示 / 列统计 / 列筛选 / aria / 复制报单 / 下单金额 全部走它。
//      改口径只改这里一处。（旧实现按「已定稿取 final_qty、未定稿取 0」分支，与显示口径并不一致。）
const rowExtraQty = (r) => Number(r && (r.extra_qty != null ? r.extra_qty : r.extraQty)) || 0
const rowFinalQty = (r) => {
  if (!r) return 0
  /* v184e：最终下单 = 合计(箱) + 加单(箱)（此前是 合计 + 加单（按件），与「合计(箱)」列脱节）。
     v207：补上**取整** —— 用户 2026-09-13 拍板「取整只发生在最终下单」，方向 = 商品级、默认**向上**。
       理由：**厂商不拆零发货** ⇒ 报了 3 瓶（=0.125 箱）实际下单就是 1 箱。
       不取整会有两个说不通的后果：① 「最终下单」出现小数箱，而这列是要拿去厂家系统下单的；
       ② `下单金额 = 最终下单(箱) × 单价(元/箱)` 会按 0.125 箱算钱 —— 现实中收不到这种货。
       ⚠️ `- 1e-9` 是浮点护栏：24/24 可能算成 1.0000000000000002，Math.ceil 会直接跳到 2 箱。
       ⚠️ 「按商品配置取整方向」**暂未实现** —— 商品档案里没有这个字段（`products` 无取整方向列），
          所以一律按默认向上。将来要支持，就在此处读 `r.round_dir`（'ceil' 向上 / 'floor' 向下）。
       ⚠️ 本函数是全站唯一实现（模板 / 列统计 / 列筛选 / aria / 复制报单 / 下单金额 / 返利达成 全走它）
          ⇒ 改口径只改这一处；但也意味着**改一次，全站一起动**。 */
  return Math.ceil(rowBoxes(r) - 1e-9) + rowExtraQty(r)
}
const copyCount = computed(() => {
  let n = 0
  cross.value.rows.forEach(r => {
    if (rowFinalQty(r) <= 0) return
    const b = rowBrand(r)
    if (brandSel.value.length && !brandSel.value.includes(b)) return
    if (!_rowCode(r)) return
    n++
  })
  return n
})
function doCopyCodes() { copyMenuOpen.value = false; copyCodes() }
function doCopyQty() { copyMenuOpen.value = false; copyQty() }
function positionTbPop(btnEl) {
  if (!btnEl) return
  const r = btnEl.getBoundingClientRect()
  const w = 240
  let left = r.right - w
  if (left < 8) left = 8
  // 防止底部超出视口：若下方空间不足则翻到按钮上方
  const estH = 320
  let top = r.bottom + 6
  if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 6)
  popStyle.top = top + 'px'
  popStyle.left = left + 'px'
}
// 工具栏弹层互斥开关（2026-09-12：'period' 分支已随「⋯」菜单移除，现仅 adv / export 两个触发器）
function toggleTbPop(which) {
  const open = which === 'adv' ? !advToolsOpen.value : !exportMenuOpen.value
  _closePopPanes(open ? which : '')
  if (which === 'adv') {
    advToolsOpen.value = open
    if (open) nextTick(() => positionTbPop(advBtn.value))
  } else {
    exportMenuOpen.value = open
    if (open) nextTick(() => positionTbPop(exportBtn.value))
  }
}

/* ================= P11-P13 第四轮增强 ================= */

// ---------- P11-1 数据缺口补录（缺批次/到期） ----------
const gapOpen = ref(false)
const gapList = ref([])
const gapLoading = ref(false)
const gapSavingId = ref(0)
const gapSet = computed(() => new Set((gapList.value || []).map(g => g.product_id)))
async function loadGaps() {
  gapLoading.value = true
  try { const r = await forecastApi.dataGapsGet(); gapList.value = (r.items || []).map(x => ({ ...x, _batch: '', _expiry: '' })) }
  catch (e) { gapList.value = [] }
  finally { gapLoading.value = false }
}
async function saveGap(g) {
  gapSavingId.value = g.product_id
  const batch = (g._batch || '').trim()
  const exp = (g._expiry || '').trim()
  try {
    await forecastApi.dataGapSave({ product_id: g.product_id, batch_no: batch, expiry_date: exp })
    g.has_batch = !!batch; g.has_expiry = !!exp
    toast('已补录：' + g.name, 'ok')
    if (typeof loadRealtimeWarn === 'function') loadRealtimeWarn()
  } catch (e) { toast('补录失败：' + (e.message || e), 'err') }
  finally { gapSavingId.value = 0 }
}

// ---------- P11-2 安全库存 AI 建议 ----------
const safetyOpen = ref(false)
const safetyItems = ref([])
const safetyLoading = ref(false)
async function loadSafety() {
  safetyLoading.value = true
  try {
    const ids = cross.value.rows.map(r => r.product_id).join(',')
    const r = await forecastApi.safetySuggest(ids)
    safetyItems.value = r.items || []
  } catch (e) { safetyItems.value = [] }
  finally { safetyLoading.value = false }
}
function applySafety(s) {
  const row = cross.value.rows.find(x => x.product_id === s.product_id)
  if (row && s.suggested != null) { row.safety_stock = s.suggested; toast('已采纳安全库存：' + s.name + ' = ' + s.suggested, 'ok') }
}

// ---------- P11-3 多期滚动预报 ----------
const rollingOn = ref(false)
const rollingN = ref(3)
const rollingPeriods = computed(() => (periods.value || []).slice(0, rollingN.value))
function gotoPeriod(pid) {
  curPeriod.value = pid
  if (editMode.value) loadEditGrid(); else loadCross()
}

// ---------- P12-4 偏差归因复盘 ----------
const varOpen = ref(false)
const varData = ref(null)
const varLoading = ref(false)
const varAttrs = reactive({})
const varCauses = ['天气', '促销', '节假日', '竞品', '缺货', '其他']
async function loadVariance() {
  varLoading.value = true
  try {
    const r = await forecastApi.varianceGet(curPeriod.value)
    varData.value = r
    const a = await forecastApi.varianceAttrGet(curPeriod.value)
    Object.assign(varAttrs, a.attrs || {})
  } catch (e) { varData.value = null }
  finally { varLoading.value = false }
}
const varHitRate = computed(() => varData.value ? varData.value.hit_rate : null)
const varByCategory = computed(() => {
  const m = {}
  for (const it of (varData.value ? (varData.value.items || []) : [])) (m[it.category || '未分类'] ||= []).push(it)
  return m
})
async function saveVarAttr(pid, cause) {
  // 留底原值：服务端写失败时回滚，否则归因本地生效而服务端没有，下期重算会丢
  const prevCause = varAttrs[pid]
  varAttrs[pid] = cause
  try {
    await forecastApi.varianceAttrPut({ period_id: curPeriod.value, attrs: JSON.parse(JSON.stringify(varAttrs)) })
  } catch (e) {
    varAttrs[pid] = prevCause
    toast('归因保存失败：' + (e.message || e), 'err')
  }
}

// ---------- P12-5 自然语言改单 ----------
const nlOpen = ref(false)
const nlText = ref('')
const nlLoading = ref(false)
const nlResult = ref([])
async function runNlEdit() {
  nlLoading.value = true; nlResult.value = []
  try {
    const products = cross.value.rows.map(r => ({ product_id: r.product_id, name: r.name }))
    const r = await forecastApi.nlEdit({ text: nlText.value, products })
    if (!r.ok) { toast('AI 解析失败：' + (r.reason || '未知'), 'err'); return }
    nlResult.value = r.edits || []
    if (!nlResult.value.length) toast('未解析出改动，请换种说法', 'warn')
  } catch (e) { toast('解析出错：' + (e.message || e), 'err') }
  finally { nlLoading.value = false }
}
function applyNlEdit(e) {
  const row = cross.value.rows.find(x => x.product_id === e.product_id)
  if (!row) { toast('网格中找不到该商品', 'warn'); return }
  const keys = Object.keys(row.qtyByUnit || {})
  if (!keys.length) { toast('该商品无单位列', 'warn'); return }
  row.qtyByUnit[keys[0]] = (parseInt(row.qtyByUnit[keys[0]]) || 0) + e.delta
  toast(`已${e.delta >= 0 ? '增' : '减'} ${Math.abs(e.delta)} 箱：${row.name}`, 'ok')
}

// ---------- P12-6 一键凑单达返利 ----------
const topupOpen = ref(false)
const topupPlan = computed(() => {
  const plan = []
  for (const it of (rebatePushList.value || [])) {
    const gap = Number(it.gap) || 0
    if (gap <= 0) continue
    const row = cross.value.rows.find(r => r.name === it.name)
    const price = row ? (Number(row.dist_price) || 0) : 0
    if (!price) continue
    plan.push({ name: it.name, gap, price, add: Math.ceil(gap / price) })
  }
  return plan
})
function applyTopup() {
  let n = 0, total = 0
  for (const t of topupPlan.value) {
    const row = cross.value.rows.find(r => r.name === t.name)
    if (!row) continue
    const keys = Object.keys(row.qtyByUnit || {})
    if (!keys.length) continue
    row.qtyByUnit[keys[0]] = (parseInt(row.qtyByUnit[keys[0]]) || 0) + t.add
    n++; total += t.add
  }
  if (n) toast(`已为 ${n} 个商品凑单 +${total} 箱`, 'ok'); else toast('无可用凑单项', 'warn')
}

// ---------- P12-7 what-if 配方模拟 ----------
const cmp2Open = ref(false)
const cmpA = ref(''); const cmpB = ref('')
const cmpDiff = computed(() => {
  const a = (tmplList.value || []).find(t => t.name === cmpA.value)
  const b = (tmplList.value || []).find(t => t.name === cmpB.value)
  if (!a || !b) return null
  const fa = JSON.parse(JSON.stringify(a.recipe || a.params || a))
  const fb = JSON.parse(JSON.stringify(b.recipe || b.params || b))
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)])
  const rows = []
  for (const k of keys) if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) rows.push({ key: k, a: fa[k], b: fb[k] })
  return { aName: cmpA.value, bName: cmpB.value, rows }
})

// ---------- P13-8 供应商 PO 聚合 ----------
const poOpen = ref(false)
const poData = ref(null)
const poLoading = ref(false)
async function loadPo() {
  poLoading.value = true
  try {
    const items = cross.value.rows.map(r => ({ product_id: r.product_id, qty: rowSum(r) }))
    const r = await forecastApi.supplierPo({ items })
    poData.value = r
  } catch (e) { poData.value = null; toast('聚合失败：' + (e.message || e), 'err') }
  finally { poLoading.value = false }
}
async function poWriteback() {
  if (!poData.value) return
  const lines = []
  for (const g of (poData.value.pos || [])) for (const l of g.lines) lines.push({ product_id: l.product_id, qty: l.qty })
  writebackLoading.value = true
  try {
    const r = await forecastApi.connectorWriteback({ connector: 'kingdee', period_id: curPeriod.value, items: lines })
    if (r.ok) toast('已回写ERP', 'ok'); else toast('回写需配置连接器：' + (r.detail || ''), 'warn')
  } catch (e) { toast('回写出错：' + (e.message || e), 'err') }
  finally { writebackLoading.value = false }
}

// ---------- P13-9 移动端预报录入（复用小程序契约） ----------
const miniInputOpen = ref(false)

// ---------- P13-10 主动预警推送 ----------
const autoAlertOn = ref(false)
let _alertedThisLoad = false
function maybeAutoAlert() {
  if (!autoAlertOn.value || _alertedThisLoad || !healthIssues.value.length) return
  _alertedThisLoad = true
  pushForecast()
  toast('已主动推送预警（' + healthIssues.value.length + ' 项异常）', 'ok')
}
watch(healthIssues, () => maybeAutoAlert())

/* ================= P14-P16 第五轮增强 ================= */

// ---------- P14-1/2 时间序列预测 + 置信区间 ----------
const tsOpen = ref(false)
const tsLoading = ref(false)
const tsItems = ref([])
const tsApplied = ref(false)
async function loadTs() {
  tsLoading.value = true; tsOpen.value = true; tsItems.value = []; tsApplied.value = false
  try {
    const ids = cross.value.rows.map(r => r.product_id).join(',')
    const r = await forecastApi.tsForecast(ids, curPeriod.value)
    tsItems.value = r.items || []
    if (!tsItems.value.length) toast('无历史销量，无法预测', 'warn')
  } catch (e) { toast('预测失败：' + (e.message || e), 'err') }
  finally { tsLoading.value = false }
}
function applyTs() {
  let n = 0
  for (const t of tsItems.value) {
    if (t.predicted == null) continue
    const row = cross.value.rows.find(r => r.product_id === t.product_id)
    if (!row) continue
    const keys = Object.keys(row.qtyByUnit || {})
    if (!keys.length) continue
    row.qtyByUnit[keys[0]] = (parseInt(row.qtyByUnit[keys[0]]) || 0) + t.predicted
    n++
  }
  tsApplied.value = true
  toast(`已应用预测到 ${n} 个商品`, 'ok')
}

// ---------- P14-3 节假日/促销日历因子 ----------
const calOpen = ref(false)
const calFactors = reactive({ factors: {}, selected: '' })
const calPresets = ['春节', '元宵', '清明', '端午', '中秋', '国庆', '双11', '店庆', '常规促销']
async function loadCal() {
  try { const r = await forecastApi.calendarFactorsGet(); Object.assign(calFactors, r.factors || { factors: {}, selected: '' }) } catch (e) {}
}
function openCal() { calOpen.value = !calOpen.value; if (calOpen.value) loadCal() }
function setCalFactor(label) { calFactors.factors[label] = calFactors.factors[label] || 1.2 }
function applyCal() {
  const f = parseFloat(calFactors.factors[calFactors.selected])
  if (!calFactors.selected || !(f > 0)) { toast('请选择并设置有因子', 'warn'); return }
  let n = 0
  for (const row of cross.value.rows) {
    const keys = Object.keys(row.qtyByUnit || {})
    if (!keys.length) continue
    const cur = parseInt(row.qtyByUnit[keys[0]]) || 0
    row.qtyByUnit[keys[0]] = Math.round(cur * f)
    n++
  }
  toast(`已按「${calFactors.selected}」×${f} 调整 ${n} 个商品`, 'ok')
}
async function saveCal() {
  try { await forecastApi.calendarFactorsPut({ factors: JSON.parse(JSON.stringify(calFactors.factors)), selected: calFactors.selected }); toast('日历因子已保存', 'ok') } catch (e) { toast('保存失败', 'err') }
}

// ---------- P14-4 滞销/临期反向预警 ----------
const slowOpen = ref(false)
const slowLoading = ref(false)
const slowItems = ref([])
async function loadSlow() {
  slowLoading.value = true; slowOpen.value = true; slowItems.value = []
  try { const r = await forecastApi.slowMovers(); slowItems.value = r.items || [] } catch (e) { toast('加载失败：' + (e.message || e), 'err') }
  finally { slowLoading.value = false }
}

// ---------- P15-5 采购单直发 ----------
const po2Open = ref(false)
const po2Loading = ref(false)
const po2Data = ref(null)
const po2List = ref([])
async function loadPo2() {
  po2Loading.value = true; po2Open.value = true; po2Data.value = null
  try {
    const items = cross.value.rows.map(r => ({ product_id: r.product_id, qty: rowSum(r) }))
    const r = await forecastApi.purchaseOrderCreate({ items })
    po2Data.value = r.po
    toast('已生成采购单 #' + r.po.id, 'ok')
  } catch (e) { toast('生成失败：' + (e.message || e), 'err') }
  finally { po2Loading.value = false }
  loadPo2List()
}
async function loadPo2List() {
  try { const r = await forecastApi.purchaseOrdersList(); po2List.value = r.orders || [] } catch (e) {}
}
async function pushPo2() {
  if (!po2Data.value) return
  try {
    const r = await forecastApi.purchaseOrderPush({ po_id: po2Data.value.id, pos: po2Data.value.pos, connector: 'kingdee' })
    if (r.ok) toast('已推送', 'ok'); else toast('需配置连接器：' + (r.detail || ''), 'warn')
    loadPo2List()
  } catch (e) { toast('推送失败：' + (e.message || e), 'err') }
}

// ---------- P15-6 异常自愈闭环 ----------
const healOpen = ref(false)
const healLoading = ref(false)
const healIssues = ref([])
async function loadHeal() {
  healLoading.value = true; healOpen.value = true; healIssues.value = []
  try { const r = await forecastApi.interventionsGet(); healIssues.value = r.issues || [] } catch (e) { toast('加载失败：' + (e.message || e), 'err') }
  finally { healLoading.value = false }
}
async function setHeal(id, status, note) {
  const it = healIssues.value.find(x => x.id === id)
  // 先留底再改本地：服务端写失败时能原样回滚，避免界面显示"改了一半"
  const prevStatus = it ? it.status : undefined
  const prevNote = it ? it.note : undefined
  if (it) { it.status = status; if (note != null) it.note = note }
  try {
    await forecastApi.interventionsPost({ id, status, note: note || '' })
  } catch (e) {
    if (it) { it.status = prevStatus; it.note = prevNote }
    toast('保存失败：' + (e.message || e), 'err')
  }
}

// ---------- P15-7 Hermes 深度联动 ----------
const hermesOpen = ref(false)
const hermesLoading = ref(false)
const hermesCtx = ref('')
const hermesResult = ref('')
async function runHermes() {
  if (!hermesCtx.value.trim()) { toast('请填写异常上下文', 'warn'); return }
  hermesLoading.value = true; hermesResult.value = ''
  try {
    const r = await forecastApi.hermesAnalyze({ context: hermesCtx.value })
    if (!r.ok) { toast('Hermes 未接通：' + (r.detail || ''), 'warn'); return }
    hermesResult.value = r.analysis || '(无返回)'
  } catch (e) { toast('分析失败：' + (e.message || e), 'err') }
  finally { hermesLoading.value = false }
}

// ---------- 配方市场已下线（2026-09-14）----------
// 原 P16-8「配方市场（行业配方可交易资产）」的按钮/面板/函数已删除：
// ① 产品定调为「不对外分发共享配方」（见 outputs/Hergent-产品形态再评估-2026-09-14.md）；
// ② 其存储只是本租户库内 forecast_config[kind=recipe_market]，并非跨租户市场 —— 名不副实。
// 后端 /api/forecast/recipe-market* 三个端点已无调用方，留待后续一并清理。

// ---------- P16-9 数据健康分 ----------
const hsOpen = ref(false)
const hsLoading = ref(false)
const hsItems = ref([])
const hsAvg = ref(null)
const hsMap = ref({})
async function loadHealthScore() {
  hsLoading.value = true; hsOpen.value = true; hsItems.value = []
  try {
    const r = await forecastApi.dataHealth()
    hsItems.value = r.items || []
    hsAvg.value = r.avg
    const m = {}
    for (const it of hsItems.value) m[it.product_id] = it.score
    hsMap.value = m
  } catch (e) { toast('加载失败：' + (e.message || e), 'err') }
  finally { hsLoading.value = false }
}

// ---------- P16-10 移动端录单（Web 侧闭环，复用 submitOrder） ----------
const miniPid = ref('')
const miniQty = ref(0)
const miniUnit = ref('箱')
const miniNote = ref('')
const miniSaving = ref(false)
const miniMsg = ref('')
/* v240：新增单据时「单位」自动带出该商品在档案里配的**报单默认单位**（`products.order_unit`，
   配置入口：商品档案 → 编辑 → 包装单位 → 默认单位）。
   🔴 取值三级回退：**报单默认单位 → 档案单位 → '箱'**（'箱' 是迁入前的既有默认，不动它）。
   🔴 只做**预填**：输入框仍可手改，submitMini 不再二次覆盖（手改值优先）。 */
watch(miniPid, (pid) => {
  const row = cross.value.rows.find(r => String(r.product_id) === String(pid))
  if (!row) return
  miniUnit.value = String(row.order_unit || '').trim() || String(row.unit || '').trim() || '箱'
})
async function submitMini() {
  if (!curPeriod.value) { toast('请先选择期次', 'warn'); return }
  if (!miniPid.value) { toast('请选择商品', 'warn'); return }
  const row = cross.value.rows.find(r => r.product_id === miniPid.value)
  miniSaving.value = true; miniMsg.value = ''
  try {
    await forecastApi.submitOrder({
      period_id: curPeriod.value,
      submitter_name: 'Web录单',
      submitter_type: 'sales',
      product_name: row ? row.name : '',
      quantity: miniQty.value || 0,
      unit: miniUnit.value || '箱',
      unit_price: row ? (Number(row.dist_price) || 0) : 0,
      notes: miniNote.value || '',
    })
    miniMsg.value = '已提交录单：' + (row ? row.name : '') + ' × ' + (miniQty.value || 0)
    toast('录单成功', 'ok')
    miniQty.value = 0; miniNote.value = ''
  } catch (e) { miniMsg.value = '提交失败：' + (e.message || e); toast('提交失败', 'err') }
  finally { miniSaving.value = false }
}

/* ---- P0-2 Excel 导入（forecast_cross） ---- */
const impOpen = ref(false)
const impState = ref(null)           // null | 'preview' | 'done'
const impFileInput = ref(null)
const impFileObj = ref(null)
const impFileName = ref('')
const impHeaders = ref([])
const impPreview = ref([])
const impMapping = ref({})
const impResult = ref(null)
const importing = ref(false)
/* v178 列映射确认：身份列与客户列都可在界面上改判（此前只读回显，改不了）。
   候选字段由后端 /preview 的 field_options 给 —— 前端不自己写一份键→中文。 */
const impSuggestions = ref([])
const impFieldOptions = ref([])
/* 客户列数从 **实际要提交的 mapping** 派生，不再取后端识别结果 ——
   否则用户在上面把某列改成「不导入」后，按钮仍写着 N 个客户，文案与提交内容两套口径。 */
const impCustomerCount = computed(() => Object.values(impMapping.value).filter(v => v === 'customer').length)
const impCanExec = computed(() => impCustomerCount.value > 0)

/* ---- v180 导入的「本期归属」 ----------------------------------------------------
   归属期次由**后端**在导入那一刻解析（import_router: forecast_period_current() →
   兜底 forecast_period_default()），前端不接受指定 ⇒ 归属必须**前置展示**，
   而不是等导入完成后才问用户「要不要命名期次」（那时数据已经落库、归属已定死）。
   口径对齐：GET /api/forecast/periods 的 `current` 就是同一个 default() ⇒ 前端用
   **curOpenPeriodId**（只由 current 赋值，不随期次下拉/往期查看漂移）即为归属，
   而**不是** curPeriod（= 正在查看的期次）—— 查看往期时点「导入」，数据仍会落到
   当前期次，这个差异要让用户看见（impViewMismatch）。 */
const impOwnedPeriodId = computed(() => Number(curOpenPeriodId.value || 0))
const impOwnedPeriod = computed(
  () => (periods.value || []).find(p => Number(p.id) === impOwnedPeriodId.value) || null
)
const impOwnedName = computed(() => impOwnedPeriod.value?.name || (impOwnedPeriodId.value ? `期次 #${impOwnedPeriodId.value}` : ''))
const impViewMismatch = computed(() => {
  const viewed = Number(cross.value.period?.id || 0)
  return impOwnedPeriodId.value > 0 && viewed > 0 && viewed !== impOwnedPeriodId.value
})
const impViewedName = computed(() => cross.value.period?.name || '')
// 回执里「这次导入到底归到哪」用**后端回传的** results.period_id（权威），
// 不用上面的预告 —— 两者可能因「导入瞬间刚建了期次」而不同。
const impResultPeriodId = computed(() => Number(impResult.value?.results?.period_id || 0))
/* 进价是模版的「条件必填」列：闸门开启时档案里没有进价的行会被整行拒收。
   旧版把这句做成只读回显，用户看到「未识别」也无从下手；现在改成能被改的提示。 */
const impFactoryMissing = computed(() => !Object.values(impMapping.value).some(v => v === 'factory' || v === 'price'))

// v157 零档案建档结果：后端在 results 里回传 products_created_count / products_reused_count /
// products_backfilled_count / unmatched_products，并在顶层回传 barcode_conflicts。
// 没有任何一条时返回 null（不显示空块）。
const impArchive = computed(() => {
  const r = impResult.value
  if (!r) return null
  const rs = r.results || {}
  const created = Number(rs.products_created_count || 0)
  const reused = Number(rs.products_reused_count || 0)
  const backfilled = Number(rs.products_backfilled_count || 0)
  const unmatched = Array.isArray(rs.unmatched_products) ? rs.unmatched_products : []
  const conflicts = Array.isArray(r.barcode_conflicts) ? r.barcode_conflicts : []
  const createdNames = Array.isArray(rs.products_created) ? rs.products_created.slice(0, 5) : []
  const backfilledNames = Array.isArray(rs.products_backfilled) ? rs.products_backfilled.slice(0, 5) : []
  if (!created && !reused && !backfilled && !unmatched.length && !conflicts.length) return null
  return { created, reused, backfilled, unmatched, conflicts, createdNames, backfilledNames }
})

// v158 进价闸门：后端在 results 里回传 products_rejected_no_factory(_count) 与 factory_price_gate_on。
// 只在**闸门开启**时渲染（关闭时两个字段为 0/false → 返回 null，不显示空块）。
// 为什么单列一块：被拒的行是「整行没进报单」，用户最容易误以为「导入成功了」→ 必须点名到商品。
const impFpRejected = computed(() => {
  const rs = impResult.value?.results
  if (!rs || !rs.factory_price_gate_on) return null
  const names = Array.isArray(rs.products_rejected_no_factory) ? rs.products_rejected_no_factory : []
  return { count: Number(rs.products_rejected_no_factory_count || names.length || 0), names }
})

// v163 导入回执的「需要注意」：后端 results.warnings（非致命，但下游会出问题）+ 未配置对象清单。
// 与 errors 分开是有意的 —— errors = 「行根本没进来」，warnings = 「进来了，但你得知道这件事」。
// 旧实现在「报单对象不在报单配置里」时完全静默，用户以为导入成功，直到生成舟谱单据才发现缺客户全称。
const impWarnings = computed(() => {
  const ws = impResult.value?.results?.warnings
  return Array.isArray(ws) ? ws : []
})
const impUnmapped = computed(() => {
  const us = impResult.value?.results?.report_unmapped
  return Array.isArray(us) ? us : []
})

/* ---- v193 导入的前置条件：必须先有「进行中」的期次 ----------------------------------
   用户诉求（2026-09-18 原话）：「我们之前设计的流程是：用户必须先点击『新建期次』，
   之后才能进行导入操作。但目前导入入口直接暴露在页面上，未新建期次也能使用，
   我实测点击后确实可以正常导入，导致整个业务流程被绕过、逻辑混乱。」

   🔴 判据依据 = 既定方案 `outputs/期次数据流程优化方案-2026-09-17/期次数据流程优化方案-2026-09-17.md`：
     · §四.1「**不是『必须先建期次』，而是『必须有一个「进行中」的期次**』」
       理由② **昨天事故的直接根因**：导入时 7/8/9/10 期**全 closed** ⇒ 兜底
         `forecast_period_default()` 把 154 个商品挂到了**已关闭的 9 期**，用户根本看不到；
       理由③ fail-closed：**做不到正确归属，就不要写进去**。
     · §四.1 同时点名：「闸门若只加在『有没有期次』而不收窄这个兜底，**闸门形同虚设**」
       ⇒「导入侧只接受 `status='open'` 的期次」。
     · §五 阶段 0：「无进行中期次 ⇒ 顶部常驻横幅 + 「导入」按钮**禁用**（不是点了才报错），
       hover 说明原因」；「📌 判据：**禁用 + 说明好过「点了弹错误」**」。

   ⚠️ 因此判据**必须**是「有没有 open 期次」（`openPeriodId`），**不能**是「有没有期次」
   （`curOpenPeriodId`）—— 两者在「期次全 closed」这一情形下结论相反，而那正是事故场景。
   本轮的取舍过程值得留档：先按「有没有期次」实现并验证过（沙箱 6/6 + 8/8 全绿），
   但查既定方案后发现方向错，遂连同后端兜底一起收窄。

   🔴 同源保证：`openPeriodId` 来自 `GET /periods` 的 `open` 字段 = 后端
   `forecast_period_current()` = 后端硬闸（import_router）判定归属用的**同一个函数**
   ⇒ 「前端按钮灰不灰」与「后端会不会 400」是同一条件，不可能各算一份而漂移。 */
const hasOpenPeriod = computed(() => Number(openPeriodId.value || 0) > 0)
// 「确认没有进行中期次」= 已**成功问到**后端 + 确实没有。与 canImport 互为反义（同一份判据，不写第二遍）
const noOpenPeriod = computed(() => periodsLoaded.value && !hasOpenPeriod.value)
// 横幅正文 = 既定方案 §五 阶段 0 的原文，**逐字不改**（拆两段只为把首句加粗）。
const GATE_LEAD = '当前没有进行中的期次。'
const GATE_REST = '导入和报单都需要先有一个期次。'
/* 置灰按钮的 hover / 被守卫拦下时的 toast：**原因 + 下一步**。
   与横幅分开写是有意的 —— 横幅里紧邻就有一个「新建期次」按钮，正文再重复一遍「请先新建」
   属冗余；而 tooltip / toast 是**独立语境**（用户可能只看到按钮），必须自带出口。 */
/* v244：同一份文案生成器供**所有**被这道闸挡住的入口复用（导入 / 保存报单）——
   写成函数而不是再抄一份常量：本项目铁律「第二份拷贝 = 静默漂移」（v189/v197/v213 都吃过）。
   尾部的动作短语按入口给（「再导入预报订单」/「再保存报单」），前半句逐字共用。 */
const gateReason = (action) => (noOpenPeriod.value
  ? GATE_LEAD + GATE_REST + '请先点「新建期次」创建期次，再' + action : '')
const importBlockedReason = computed(() => gateReason('导入预报订单'))
/* v244：报单保存被**同一道闸**拦住时的原因（原因 + 下一步）。供保存按钮 tooltip、
   函数内守卫的 toast 共用 —— 三处文案同源，不可能各说一套。 */
const saveBlockedReason = computed(() => gateReason('保存报单'))
const canImport = computed(() => !noOpenPeriod.value)

function openImport() {
  // v193 硬守卫：无论从哪个入口进来（含将来新增的第三个），先过闸。
  //   凭什么是函数内守卫而不只靠按钮 disabled：按钮态只是**提示**，挡不住
  //   直接调用 / 新入口；约束必须落在唯一的执行入口上。
  if (!canImport.value) { toast(importBlockedReason.value, 'warn'); return }
  impOpen.value = true; impState.value = null; impResult.value = null
  impSuggestions.value = []; impFieldOptions.value = []; impMapping.value = {}
}
function pickFile() { impFileInput.value && impFileInput.value.click() }

async function downloadFcTemplate() {
  try {
    const blob = await importApi.templateFile('forecast_cross')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '预报订单导入模板.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('模板已开始下载', 'ok')
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}

async function onImportFile(ev) {
  const f = ev.target.files && ev.target.files[0]
  if (!f) return
  impFileObj.value = f
  impFileName.value = f.name
  impState.value = null
  importing.value = true
  try {
    const prev = await importApi.preview(f, 'forecast_cross')
    impHeaders.value = prev.headers || []
    impPreview.value = prev.preview || []
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    const mapping = {}
    for (const s of impSuggestions.value) {
      if (s.suggested_field) mapping[s.index] = s.suggested_field
    }
    impMapping.value = mapping
    impState.value = 'preview'
  } catch (e) {
    toast(e.message || '文件解析失败', 'err')
    impState.value = null
  } finally {
    importing.value = false
    ev.target.value = ''
  }
}

async function doImport() {
  if (!impFileObj.value || !Object.keys(impMapping.value).length) return
  importing.value = true
  try {
    const od = (cross.value.period && cross.value.period.order_start) || ''
    const r = await importApi.execute(impFileObj.value, 'forecast_cross', impMapping.value, { order_date: od })
    impResult.value = r
    impState.value = 'done'
    // v166：导入会直接改写本期「导入」报单（覆盖式先清后建），是对汇总表的实质改动 → 留痕
    recordAudit('import', `${impFileName.value || '（未命名文件）'}（${r.imported_count || 0} 行 / ${r.results?.success || 0} 个客户）`)
  } catch (e) {
    toast('导入失败: ' + (e.message || ''), 'err')
  } finally {
    importing.value = false
  }
}

function closeImportAndReload() {
  impOpen.value = false
  impState.value = null
  impFileObj.value = null
  impFileName.value = ''
  loadCross()
}

/* ---- P1-1 周期级 AI 审核台 ---- */
const auditOpen = ref(false)
const auditState = ref(null)   // null | 'loading' | 'done' | 'empty'
const auditData = ref(null)
const adopting = ref(false)
const auditPage = ref(1)       // W2: AI 审核分批渲染，避免整周期数百行一次渲染卡顿
const AUDIT_PAGE_SIZE = 50
const auditPaged = computed(() => (auditData.value?.items || []).slice(0, auditPage.value * AUDIT_PAGE_SIZE))

// 2026-08-29：占位功能提示——未连接 ERP 时 AI 建议缺少实时库存/销量依据
const chanjetLinked = ref(false)
const kingdeeLinked = ref(false)
const erpLinked = computed(() => chanjetLinked.value || kingdeeLinked.value)
async function probeErp() {
  try { const s = await api('/api/datasources/v2/chanjet/status'); chanjetLinked.value = !!s.connected } catch { chanjetLinked.value = false }
  try { const s = await api('/api/datasources/v2/kingdee/status'); kingdeeLinked.value = !!s.connected } catch { kingdeeLinked.value = false }
}
function goConnect() { location.hash = '#/connect' }

async function openAudit() {
  if (!cross.value.period) { toast('请先选择期次', 'warn'); return }
  auditOpen.value = true
  auditState.value = 'loading'
  auditData.value = null
  auditPage.value = 1
  try {
    const p = cross.value.period
    const r = await auditApi.auditPeriod({ start: p.order_start, end: p.order_end, period_id: p.id || 0 })
    if (!r.success) { toast(r.error || '审核失败', 'err'); auditOpen.value = false; return }
    ;(r.items || []).forEach(a => { if (a.suggested_qty != null && a.final_qty == null) a.final_qty = a.suggested_qty })
    auditData.value = r
    auditState.value = (r.items || []).length ? 'done' : 'empty'
  } catch (e) {
    toast(e.message || '审核失败', 'err')
    auditOpen.value = false
  }
}

function verdictCls(v) {
  if (!v) return ''
  if (v.includes('缺货')) return 'val-bad'
  if (v.includes('积压')) return 'val-warn'
  if (v.includes('吻合')) return 'val-ok'
  return ''
}

async function doAdopt() {
  const p = cross.value.period
  if (!p || !auditData.value) return
  adopting.value = true
  try {
    const items = (auditData.value.items || [])
      .filter(a => a.product_id && !a.error)
      .map(a => ({
        product_id: a.product_id, product_name: a.name || '', unit: a.unit || '件',
        requested_qty: a.requested_qty || 0, suggested_qty: a.suggested_qty || 0,
        final_qty: a.final_qty ?? a.suggested_qty ?? 0, verdict: a.verdict || '',
      }))
    if (!items.length) { toast('没有可定稿的 SKU（未匹配主档的已跳过）', 'warn'); auditOpen.value = false; return }
    const r = await auditApi.adoptAudit({ start: p.order_start, end: p.order_end, items })
    // v166：定稿决定「最终下单量」，是本页最重的一次改动（原实现无任何留痕）→ 留痕
    recordAudit('adopt', `${r.adopted || 0} 个 SKU`)
    toast(`已定稿 ${r.adopted || 0} 个 SKU（AI 只建议，不自动下单）`, 'ok')
    auditOpen.value = false
    loadCross()
  } catch (e) {
    toast('定稿失败: ' + (e.message || ''), 'err')
  } finally {
    adopting.value = false
  }
}

/* ---- 返利冲刺看板（前置：下单时实时看品牌/商品目标达成、缺口、均单建议） ---- */
// v116 (L2)：全局默认到货周期（天）—— 规则未单独设到货周期时沿用；可在「目标与返利」设置里改，默认 2 天。
const rebateGlobalCadence = ref(2)
async function loadTenantParams() {
  try {
    const r = await api('/api/params')
    const d = (r && r.data) ? r.data : {}
    const c = parseInt(d.default_arrival_cadence_days, 10)
    rebateGlobalCadence.value = (Number.isFinite(c) && c > 0) ? c : 2
  } catch (e) { /* 取默认 2 */ }
}
const rebateRules = ref([])     // 活跃返利目标规则（品牌/商品维度）
// 冲刺看板折叠态（A2 决策横幅）：默认折叠 —— 结论已由卡片内常显的「决策横幅」承载，明细按需展开。
// 编辑态自动折叠：同一块 360px 面板同时挡着「改单」进入点与编辑态「保存」，收起它一次缩短两段距离。
const rebateSprintOpen = ref(false)
watch(editMode, (v) => { if (v) rebateSprintOpen.value = false })

async function loadRebateRules() {
  try {
    const r = await api('/api/rebate-rules')
    const list = (r && r.data) ? r.data : (Array.isArray(r) ? r : [])
    rebateRules.value = (list || []).filter(x => x.is_active !== 0)
  } catch (e) { rebateRules.value = [] }
}

// 填报的达成数据（无 API / 手动上传客户在「目标与返利 → 达成填报」录入或 Excel 导入）
// 此前看板只按"本期预报"当达成，漏算已达成部分导致缺口偏大 —— 这里并入真实填报值。
const rebateAchievements = ref([])

// v116 (L1)：达成按「到货」归属 —— 冲刺月份取当前期次的到货月(arrival_date)，而非下单月(order_start)。
// 返利按实际到货月份统计，预报贡献也计入到货月，避免"下单月≠到货月"导致达成错位。
const rebateSprintMonth = computed(() => {
  const p0 = cross.value.period
  const base0 = (p0 && (p0.arrival_date || p0.order_start || p0.name)) || ''
  const m = (base0 || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7)
})
const sprintAchvMonth = computed(() => rebateSprintMonth.value)

async function loadRebateAchievements() {
  try {
    const list = await api('/api/rebate-achievements?month=' + encodeURIComponent(sprintAchvMonth.value))
    rebateAchievements.value = Array.isArray(list) ? list : []
  } catch (e) { rebateAchievements.value = [] }
}
// 期次切换导致到货月变化时，重新拉取该月填报达成（竞态由 loadAchievements 的 seq 机制同理保护）
watch(rebateSprintMonth, () => { loadRebateAchievements() })

// 返利活动/合同截止日：取当前冲刺所纳入规则的生效期末日最大值（而非单个报单期次的 order_end）。
// 修复：原先误用 cross.period.order_end（当前这一单报单期次的下单截止，如 2026-09-03），
// 导致窗口只剩不足 1 天 → 兜底成 1 次下单、均单被放大到 108 万。正确口径应到返利目标生效期截止。
const rebateCampaignEnd = computed(() => {
  const rules = (rebateRules.value || []).filter(x => x.is_active !== 0 && x.effective_end)
  if (rules.length) {
    return rules.map(r => String(r.effective_end)).sort().slice(-1)[0]
  }
  const p = cross.value.period
  return p && p.order_end ? p.order_end : null
})

// 本期还剩几次到货机会（按全局默认到货周期估算，供表头概览；各品牌精确值见 rebateSprint 每行）
const rebateSprintOrders = computed(() => {
  const endStr = rebateCampaignEnd.value
  if (!endStr) return 1
  const end = new Date(endStr + 'T23:59:59')
  const daysLeft = Math.ceil((end - new Date()) / 86400000)
  if (daysLeft <= 0) return 1
  return Math.max(1, Math.ceil(daysLeft / rebateGlobalCadence.value))
})

// v186：规则适用月份判据统一走 ruleCoversMonth（共享谓词，与后端同源）。
//   原本地 ruleEffectiveInMonth 按生效期逐月裁剪 —— 年度规则「12 个月分解齐全、
//   生效期只写 9 月」时会把 8 月整个判掉：既少一行冲刺行，也让图表的 8 月目标柱消失。

// v118 (L2细化)：到货模式感知的星期解析与剩余窗口计数
// 与后端 domain/arrival_schedule.py 同一契约：arrival_weekdays 存 "2,6"，1=周一..7=周日
const ARR_WEEKDAY_CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }
function parseArrivalWeekdays(raw) {
  if (!raw) return []
  const items = Array.isArray(raw) ? raw : String(raw).split(',').map(s => s.trim()).filter(Boolean)
  const out = []
  for (const it of items) {
    const v = parseInt(it, 10)
    if (!isNaN(v) && v >= 1 && v <= 7 && out.indexOf(v) === -1) out.push(v)
  }
  return out.sort((a, b) => a - b)
}
// 统计 [今天, endStr] 闭区间内命中到货星期的天数（JS getDay: 0=周日..6=周六 → 存值 1=周一..7=周日）
function countWeekdayArrivalsInWindow(weekdays, endStr) {
  if (!weekdays.length || !endStr) return 0
  const set = new Set(weekdays)
  const end = new Date(endStr + 'T23:59:59')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  let cnt = 0
  for (let d = new Date(now); d <= end; d.setDate(d.getDate() + 1)) {
    const jsDow = d.getDay()
    const stored = jsDow === 0 ? 7 : jsDow
    if (set.has(stored)) cnt++
  }
  return cnt
}

// 按「填报达成 + 本期预报贡献」聚合各规则的实际达成、缺口、建议均单
const rebateSprint = computed(() => {
  // v116 (L1)：本期月份按「到货月」归属（arrival_date 优先），而非下单月；与 sprintAchvMonth 一致
  const p0 = cross.value.period
  const base0 = (p0 && (p0.arrival_date || p0.order_start || p0.name)) || ''
  const sprintMonth = /^\d{4}-\d{2}$/.test((base0 || '').slice(0, 7)) ? base0.slice(0, 7) : new Date().toISOString().slice(0, 7)
  // 仅纳入「本期月份有目标可言」的启用规则（ruleCoversMonth，与仪表盘 / 全年图表同源）。
  // v186：原来按生效期逐月裁剪 —— 年度规则 12 个月分解齐全而生效期只写一个月时，
  //   本期即使"当月分解有目标"也会被整行剔除。当月分解无值的情况仍由下方
  //   monthly_amounts[mm2] 的守卫兜住（"没设当月目标却显示"不会回来）。
  const sprintY = Number(sprintMonth.slice(0, 4))
  const sprintM = Number(sprintMonth.slice(5, 7))
  const rules = (rebateRules.value || []).filter(x => x.is_active !== 0 && ruleCoversMonth(x, sprintY, sprintM))
  const rows = cross.value.rows || []
  const meta = prodMeta.value || {}
  // 到货截止日 → 剩余天数（用于按各品牌到货周期算剩余到货次数）
  const endStr = rebateCampaignEnd.value
  const daysLeft = (() => {
    if (!endStr) return 0
    const d = Math.ceil((new Date(endStr + 'T23:59:59') - new Date()) / 86400000)
    return d
  })()
  // 填报达成查表：维度 + 作用对象 → 达成记录（已按到货月加载）
  const achvMap = new Map()
  for (const a of (rebateAchievements.value || [])) {
    achvMap.set(`${a.dimension}::${String(a.scope_key ?? '')}`, a)
  }
  const out = []
  for (const rule of rules) {
    const dim = rule.dimension
    const scope = String(rule.scope_key ?? '')
    let contrib = 0
    const products = []
    for (const r of rows) {
      let match = false
      if (dim === 'brand') {
        const b = (meta[r.product_id] && meta[r.product_id].brand) || r.brand || ''
        match = (b || '').toString() === scope
      } else if (dim === 'product') {
        match = String(r.product_id) === scope
      }
      if (!match) continue
      const fq = rowFinalQty(r)
      const amt = amountValue(r) || 0
      if (rule.target_type === 'quantity') contrib += fq
      else contrib += amt
      products.push({ name: r.name, contrib: amt, qty: fq })
    }
    // 填报达成：金额型规则取金额，数量型规则取数量
    const av = achvMap.get(`${dim}::${scope}`)
    const reported = av
      ? (rule.target_type === 'quantity' ? (Number(av.actual_qty) || 0) : (Number(av.actual_amount) || 0))
      : 0
    // 阶段2: 品牌目标两层结构 —— 规则带 monthly_amounts(月度金额分解)时，当月目标取该月值；
    // 该月未配置金额 = 该月无目标（跳过行，避免把年框当单月目标误导）；老规则回退 target_value。
    const mm2 = sprintMonth.slice(5, 7)
    const isMonthlyRule = !!(rule.monthly_amounts && Object.keys(rule.monthly_amounts).length)
    if (isMonthlyRule && (rule.monthly_amounts[mm2] == null || Number(rule.monthly_amounts[mm2]) <= 0)) continue
    const mAmt = isMonthlyRule ? Number(rule.monthly_amounts[mm2]) : null
    const target = (mAmt != null && mAmt > 0) ? mAmt : (Number(rule.target_value) || 0)
    const achieved = reported + contrib            // 达成 = 已填报 + 本期预报贡献（均按到货月归属）
    const gap = Math.max(0, target - achieved)
    // v118 (L2细化)：尊重 arrival_mode —— 按间隔天数 / 按固定星期 分别计算剩余到货次数与建议均单
    const mode = rule.arrival_mode || 'interval'
    let cadenceLabel, orders
    if (mode === 'weekday') {
      const wds = parseArrivalWeekdays(rule.arrival_weekdays)
      orders = wds.length
        ? Math.max(1, countWeekdayArrivalsInWindow(wds, endStr))
        : (daysLeft > 0 ? Math.max(1, Math.ceil(daysLeft / (rebateGlobalCadence.value || 2))) : 1)
      cadenceLabel = wds.length ? `每周 ${wds.length} 次（${wds.map(w => '周' + ARR_WEEKDAY_CN[w]).join('、')}）` : '未设星期'
    } else {
      const cadence = (Number(rule.arrival_cadence_days) > 0) ? Number(rule.arrival_cadence_days) : rebateGlobalCadence.value
      orders = daysLeft > 0 ? Math.max(1, Math.ceil(daysLeft / cadence)) : 1
      cadenceLabel = `${cadence} 天/次`
    }
    const perOrder = orders > 0 ? gap / orders : gap
    const ach = target > 0 ? achieved / target : 0
    // A+C：优先加单按"本期贡献额"降序取前 3，但先过滤掉 contrib===0 的无效项
    // （无报单或缺失进货价 → 推¥0 无意义且误导）；若匹配品全无有效贡献，top 为空 → 模板显"本期尚未报单"提示
    const top = products.filter(p => p.contrib > 0).sort((a, b) => b.contrib - a.contrib).slice(0, 3)
    const topEmpty = top.length === 0
    out.push({
      key: rule.id,
      dimLabel: dim === 'brand' ? '品牌' : '商品',
      name: rule.scope_name || scope,
      target, targetType: rule.target_type,
      reported, contrib, achieved, gap, perOrder, ach, top, topEmpty,
      cadenceLabel, orders
    })
  }
  return out
})

const sprintTotalGap = computed(() => rebateSprint.value.reduce((s, x) => s + x.gap, 0))
const sprintTotalGapPerOrder = computed(() => rebateSprintOrders.value > 0 ? sprintTotalGap.value / rebateSprintOrders.value : 0)
// 决策横幅（A2）：未达标对象数 —— 唯一实现，模板里不再重复 filter 表达式
const unmetSprintCount = computed(() => rebateSprint.value.filter(s => s.gap > 0).length)

/* v181：1 位小数、整数不带 .0 —— 「时间进度百分比」与「达成率」共用同一格式化，
   保证两者同精度（同屏口径同源，勿各写一套）。 */
function paceNum(v) {
  const r = Math.round(Number(v) * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

// 冲刺看板：时间进度（口径＝本期「到货月」，与 rebateSprintMonth / 后端达成归属完全一致）
// 算法与「目标与返利 → 仪表盘」timeProgress 同源：过去月=100% / 未来月=0% / 当月=今日 ÷ 该月总天数
const sprintTimeProgress = computed(() => {
  const [yy, mm] = String(sprintAchvMonth.value || '').split('-').map(Number)
  if (!yy || !mm) return { frac: 0, pct: 0, pct1: '0', shown: false }
  const totalDays = new Date(yy, mm, 0).getDate()          // 该月总天数（mm 为 1-based）
  const now = new Date()
  const curY = now.getFullYear(), curM = now.getMonth() + 1
  let frac
  if (yy < curY || (yy === curY && mm < curM)) frac = 1
  else if (yy > curY || (yy === curY && mm > curM)) frac = 0
  else frac = Math.min(1, now.getDate() / totalDays)
  // v181：pct1 是 1 位小数版（页头与 hover 提示用）—— 与进度条文案的差值同精度，可互相对账
  return { frac, pct: Math.round(frac * 100), pct1: paceNum(frac * 100), shown: frac > 0 && frac < 1 }   // 虚线只在当月有意义
})

/* v183：本函数**只负责配色判定**，不再产出文案 ——
   用户判据：面板页头已常显「本月时间进度」、进度条上还有虚线标记，读者自己一比就知道超前/落后
   ⇒「落后时间进度 X%」这类差值文案是冗余，删掉，只留「达成率 X%」（见 sprintAchText）。
   ⚠️ 但配色必须仍走这里：颜色与进度条同源，才能保证同一行的「数」与「色」不互相矛盾。
   此前 sprintBarClass 单独写了一份 `ach >= frac`，会让差 0.03 个百分点的一行出现
   「进度条判绿、文案写落后」的自相矛盾 —— 勿再复制第二份判定。
   pp 取 1 位小数的**真实差值**（不是先把两个百分比各自取整再相减）。 */
const PACE_EPS = 0.05       // 低于 0.05 个百分点视为持平
function sprintPaceOf(ach) {
  const tp = sprintTimeProgress.value
  if (ach == null || !(tp.frac > 0)) return null     // 到货月尚未开始 → 不做比较（颜色走中性）
  const pp = (Number(ach) - tp.frac) * 100           // 正 = 超前，负 = 落后
  if (Math.abs(pp) < PACE_EPS) return { state: 'even', pp: 0, cls: 'pace-even' }
  const ahead = pp > 0
  return { state: ahead ? 'ahead' : 'behind', pp, cls: ahead ? 'pace-ahead' : 'pace-behind' }
}

/* v183：进度单元格的文案 —— 只有「达成率 X%」（1 位小数，与页头时间进度同精度）。
   ⚠️ 达成率与时间进度**无关**：到货月尚未开始时（frac = 0）也必须显示。
   （v181/182 曾把文案挂在 sprintPaceOf 上，而它 frac=0 时返回 null ⇒ 那时连达成率一起消失。） */
function sprintAchText(ach) {
  return ach == null ? '' : '达成率 ' + paceNum(Number(ach) * 100) + '%'
}

// 冲刺进度条着色：达成 ≥ 时间进度 → 绿（超前时间进度）；未达 → 红（落后时间进度）
// 与「目标与返利 → 仪表盘 → 返利目标达成」的 paceCls 同口径（v151 起两处统一）
// 到货月尚未开始时（frac<=0）→ 返回空，走中性青，不做"0 达成也判绿"的误判
// v181：改为复用 sprintPaceOf（持平时按「未落后」处理 → 绿，与原 ach>=frac 的边界行为一致）
function sprintBarClass(ach) {
  const p = sprintPaceOf(ach)
  return p ? (p.state === 'behind' ? 'red' : 'green') : ''
}

// 每行的进度单元格展示信息：文案 + 配色类（模板按 key 一次取到，避免在模板里重复调用函数）
const sprintPaceMap = computed(() => {
  const m = {}
  rebateSprint.value.forEach(s => {
    const p = sprintPaceOf(s.ach)
    m[s.key] = { text: sprintAchText(s.ach), cls: p ? p.cls : '' }
  })
  return m
})

/* v181：「文案放不放得下」按**真实列宽**判定。
   （v183 文案缩短为「达成率 X%」= 74px 后，这条降级路径已基本走不到 —— 进度列 1680px 下 168px、
   文案只占 44%，必定放得下。保留它作防御：列宽被外部锁死时仍能优雅降级，不是死代码。）
   ⚠️ 判据必须是「溢出」`scrollWidth > clientWidth`，不是「scrollWidth 等于文字自然宽」——
   浏览器在未溢出时把 scrollWidth 抬平到 clientWidth，所以量不出文字宽（要量文字宽得先约束宽度）。
   放不下 → visibility:hidden（保留占位，行高不跳动）并把同一句文案挂到进度条的 title 上。 */
const paceFits = ref({})
function measureSprintPace() {
  const out = {}
  document.querySelectorAll('.sprint-card .sp-pace').forEach(el => {
    out[el.dataset.k] = el.scrollWidth <= el.clientWidth
  })
  paceFits.value = out
}
// 仅在文案确实放不下时才挂 hover 提示（文字已可见时不再重复提示；提示内容＝同一句文案）
function paceHint(s) {
  const p = sprintPaceMap.value[s.key]
  return (p && p.text && paceFits.value[s.key] === false) ? p.text : ''
}
// 列宽随窗口变化（RO 不可用：v-show 折叠期间宽度为 0 会误判）→ resize 与数据/展开态变化时重测
onMounted(() => {
  nextTick(measureSprintPace)
  window.addEventListener('resize', measureSprintPace)
})
onBeforeUnmount(() => window.removeEventListener('resize', measureSprintPace))
watch([rebateSprint, rebateSprintOpen, sprintTimeProgress], () => { nextTick(measureSprintPace) })

function onPeriodChange() {
  viewPeriod.value = null
  loadOrders()
  if (viewMode.value === 'cross') { if (editMode.value) loadEditGrid(); else loadCross() }
}

function switchView(m) {
  viewMode.value = m
  if (m === 'cross') loadCross()
}

function onViewHistory(row) {
  curPeriod.value = row.id
  viewPeriod.value = row
  activeTab.value = 'summary'
  viewMode.value = 'cross'
  editMode.value = false
  loadCross()
}

// 删除期次（两处入口共用：工具栏「删除期次」+ 往期预报列表「删除」）
const delOpen = ref(false)
const delTarget = ref(null)
const deleting = ref(false)
const historyKey = ref(0)
const currentPeriod = computed(() => (periods.value || []).find(p => p.id === curPeriod.value) || null)

function askDelete(row) {
  delTarget.value = row
  delOpen.value = true
}
function onHistoryDelete(row) {
  askDelete(row)
}
async function confirmDelete() {
  const row = delTarget.value
  if (!row) return
  // A6 防御：合成行（id<0）无真实期次，禁止删除
  if (Number(row.id) <= 0) { delOpen.value = false; delTarget.value = null; toast('合成报单行不可删除', 'warn'); return }
  deleting.value = true
  try {
    await forecastApi.deletePeriod(row.id)
    delOpen.value = false
    delTarget.value = null
    historyKey.value++            // 重挂往期预报，自动重载看板
    await loadPeriods()           // 刷新期次下拉 / 滚动期次
    if (curPeriod.value === row.id) {
      curPeriod.value = 0
      /* v199b：原为 `cross.value = { rows: [] }` —— **只给 rows、没有 units**。
         以前没人立刻读它所以没炸；v197 给列数加了 watch 之后，这次赋值会在同一帧内被
         求值 `undefined.length` ⇒ 删当期期次当场整页「页面出错了」。
         一律走 blankCross()：形状只有一个来源，加字段不会再漏第二处。 */
      cross.value = blankCross()
      viewPeriod.value = null
    }
    toast('已删除期次：' + (row.name || ''), 'ok')
  } catch (e) {
    toast('删除失败: ' + (e.message || ''), 'err')
  } finally {
    deleting.value = false
  }
}

// 关闭期次（两处入口共用：工具栏「关闭期次」+ 往期预报列表「关闭」）
const closeOpen = ref(false)
const closeTarget = ref(null)
const closing = ref(false)

function askClose(row) {
  closeTarget.value = row
  closeOpen.value = true
}
function onHistoryClose(row) {
  askClose(row)
}
async function confirmClose() {
  const row = closeTarget.value
  if (!row) return
  // A6 防御：合成行（id<0）无真实期次记录，关闭会 UPDATE 0 行伪成功
  if (Number(row.id) <= 0) { closeOpen.value = false; closeTarget.value = null; toast('合成报单行不可关闭', 'warn'); return }
  closing.value = true
  try {
    await forecastApi.closePeriod(row.id)
    closeOpen.value = false
    closeTarget.value = null
    historyKey.value++            // 重挂往期预报，状态刷新
    await loadPeriods()           // 刷新期次下拉 / 滚动期次
    toast('已关闭期次：' + (row.name || ''), 'ok')
  } catch (e) {
    toast('关闭失败: ' + (e.message || ''), 'err')
  } finally {
    closing.value = false
  }
}

/* v219：重开期次 —— 「关闭 = 定稿」的**唯一**补救路径。
   为什么必须有：`forecast_period_close` 是单向的，而 open 期次又不许删 ⇒ 在补上本入口之前，
   误关一次 = 永久锁死，且同屏不报任何错。补上之后「关闭」才成为可逆操作。
   ⚠️ 副作用必须当面说清（不能只在日志里记）：重开会让该期次重新出现在小程序 open 列表里
   ⇒ **销售又能报单了**。老板以为只是「改个历史数」，实际是把报单通道重新打开了。 */
const reopening = ref(false)
async function onHistoryReopen (row) {
  if (!row) return
  if (Number(row.id) <= 0) { toast('合成报单行不可重开', 'warn'); return }
  const ok = window.confirm(
    `重开期次「${row.name || ''}」？\n\n` +
    `重开后该期次恢复可编辑，并且【销售的小程序报单通道会重新打开】——销售可以继续报单。\n\n` +
    `如果只是要改历史数据，改完记得再关闭一次。确定重开吗？`
  )
  if (!ok) return
  reopening.value = true
  try {
    await forecastApi.reopenPeriod(row.id)
    historyKey.value++            // 重挂往期预报，状态刷新
    await loadPeriods()           // 刷新期次下拉
    toast('已重开期次：' + (row.name || ''), 'ok')
  } catch (e) {
    toast('重开失败: ' + (e.message || ''), 'err')
  } finally {
    reopening.value = false
  }
}

async function loadCross() {
  let p = null
  if (viewPeriod.value && Number(viewPeriod.value.id) === Number(curPeriod.value)) {
    // 往期预报合成行（无真实期次记录）：直接用行内日期回载，避免回退到「今日」
    p = viewPeriod.value
  } else if (curPeriod.value) {
    p = periods.value.find(x => Number(x.id) === Number(curPeriod.value)) || null
  }
  if (!p) {
    // 无期次：默认「今日报单」窗口——导入/小程序报单的数据立即可见，期次用于正式双日周期管理
    const _d = new Date()
    const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`
    p = { id: 0, name: '今日报单', order_start: today, order_end: today, arrival_date: '', arrival: '' }
  }
  try {
    crossLoading.value = true
    expandedRows.value = {}
    selectedPid.value = null
    scrollTop.value = 0
    const [d, prods] = await Promise.all([
      forecastApproveApi.summary('', p.order_start || '', p.order_end || '', p.id || 0),
      productsApi.grid(),
    ])
    confirmInfo.value = (d.confirmed || null)
    const meta = {}
    ;(prods.items || []).forEach(pd => { meta[pd.id] = { category: pd.category || '', brand: pd.brand || '' } })
    prodMeta.value = meta
    // 报单单元（列）：跨期持久名册打底（即使当期无报单也保留列），当期来源补 role
    const unitMap = new Map()
    ;(d.all_units || []).forEach(name => {
      if (name && !unitMap.has(name)) unitMap.set(name, { name, role: '' })
    })
    ;(d.rows || []).forEach(r => (r.sources || []).forEach(s => {
      const name = s.store || s.store_name || '未署名'
      if (!unitMap.has(name)) unitMap.set(name, { name, role: s.role || '' })
      else if (!unitMap.get(name).role && s.role) unitMap.get(name).role = s.role
    }))
    const units = [...unitMap.values()]
    // 2026-09-13：后端汇总已把名称/规格/单位对齐商品主档，同一 product_id 正常只返回一行。
    //   此处仍做「合并而非覆盖」的防御性聚合 —— 此前 sumById[pid]=r 是单键赋值，
    //   同商品多行时后一行直接覆盖前一行，导致数量静默丢失（实测 pid=1537 的 12 件被 300 件吞掉）。
    const sumById = {}
    ;(d.rows || []).forEach(r => {
      const prev = sumById[r.product_id]
      if (!prev) { sumById[r.product_id] = r; return }
      sumById[r.product_id] = {
        ...prev,
        total_qty: (prev.total_qty || 0) + (r.total_qty || 0),
        total_amount: (prev.total_amount || 0) + (r.total_amount || 0),
        people: (prev.people || 0) + (r.people || 0),
        sources: [...(prev.sources || []), ...(r.sources || [])],
        extra_qty: (prev.extra_qty || 0) + (r.extra_qty || 0),
        final_qty: (prev.final_qty != null ? prev.final_qty : r.final_qty),
        forecast_decided: !!(prev.forecast_decided || r.forecast_decided),
        ai_suggested_qty: (prev.ai_suggested_qty != null ? prev.ai_suggested_qty : r.ai_suggested_qty),
        ai_method: prev.ai_method || r.ai_method || '',
      }
    })
    // v179（2026-09-16）**行底改造**：不再是「全量在售商品档案」。
    // 用户原话「我需要实现的是模版里有多少产品，导入后就只有那么多产品」—— 他拿预报导入
    //   模版批量建商品档案（数量由业务员从小程序报），导完 159 行商品后主表仍铺 275 行
    //   全量档案且全是 0，他无法确认「我这 159 个到底进来没有」。
    // 新行底 = 「本期导入登记的商品」∪「有报单的商品」（含已停用的，见 buildRowBase）；
    //   勾「显示全部商品」回到旧行为（全量在售档案）。
    // ⚠️ 两个来源都**来自后端**（imported_products / rows），前端不自己猜：
    //    「本批导入」这件事只有后端知道（登记台账），前端凭空推导必然与后端漂移。
    const allProds = prods.items || []
    /* v211（P1-1）：商品名称补全候选随主档一起落。**两处赋值点缺一不可** ——
       这里是「已导入/有报单」那一支，另一支在默认行底分支（下方同款语句）。
       只喂一处 ⇒ 某些期次进编辑态后候选空着，而用户看不出「为什么这次没提示」。 */
    masterNameOptions.value = buildNameOptions(allProds)
    const importedProducts = d.imported_products || []
    const importedSet = new Set(importedProducts.map(p => Number(p.id)))
    // 第三参传 summary 的**原始 rows**（不是聚合后的 sumById）：要拿它的 name/spec/unit
    //   给「不在在售档案」的商品补行，聚合后的对象不带 product_name。
    const rowBase = buildRowBase(allProds, importedProducts, d.rows || [], showAllProducts.value)
    // v202：行底原始顺序 —— **查看态**的赋值点（编辑态那份在 loadEditGrid 里）。
    //   两处都必须赋值：只改一处会让「切回默认」在另一态下按上一个态的顺序恢复（静默错序）。
    rowBaseOrder.value = rowBase.map(p => Number(p.id))
    const matrixRows = rowBase.map(pd => {
      const r = sumById[pd.id]
      const qtyByUnit = {}
      let total = 0, amount = 0, price = null, boxes = null
      let ai = null, aiMethod = null, people = 0, final_qty = null, decided = false, extra_qty = 0
      if (r) {
        ;(r.sources || []).forEach(s => {
          const name = s.store || s.store_name || '未署名'
          qtyByUnit[name] = (qtyByUnit[name] || 0) + (s.qty || 0)
        })
        total = r.total_qty || 0
        amount = r.total_amount || 0
        price = total ? amount / total : null
        // v207：与 rowBoxes 同源（不取整）—— 只读汇总表这一列此前也在这里被 Math.round 抹成 0。
        boxes = total ? boxesOf(total, pd.spec, pd.unit, pd) : null
        ai = r.ai_suggested_qty; aiMethod = r.ai_method; people = r.people || 0
        final_qty = r.final_qty != null ? r.final_qty : null; decided = !!r.forecast_decided
        extra_qty = r.extra_qty || 0
      }
      return {
        product_id: pd.id, name: pd.name, spec: pd.spec, unit: pd.unit,
        /* v222：三级单位换算随行带上（同 loadEditGrid —— **两条加载路径缺一不可**）。
           本处是**查看态（只读汇总表）**的数据源：不带它，「合计(箱)」与「下单金额(进价)」
           就会按规格串解析算，与编辑态/保存时看到的不一致。 */
        large_unit: pd.large_unit || '', large_ratio: Number(pd.large_ratio) || 0,
        medium_unit: pd.medium_unit || '', medium_ratio: Number(pd.medium_ratio) || 0,
        // v240：报单默认单位随行带上（同 loadEditGrid —— 两条加载路径缺一不可）。
        order_unit: pd.order_unit || '',
        barcode: pd.barcode || '', product_code: pd.product_code || '', dist_price: pd.dist_price || 0,
        sale_price: pd.sale_price || 0, purchase_price: pd.purchase_price || 0,
        // v190：进价随行带上（同 loadEditGrid —— 两条加载路径都必须带，漏一处该态就算错）。
        //   本行是**查看态（只读汇总表）**的数据源：不带上它，汇总表的「单价(进价/箱)」与
        //   报单金额只能退回进价算，与后端 db.factory_price_sql 的口径不是一个数。
        factory_price: Number(pd.factory_price) || 0,
        safety_stock: pd.safety_stock || 0, expiry_days: pd.expiry_days || 0,
        category: meta[pd.id] ? (meta[pd.id].category || '') : '', brand: meta[pd.id] ? (meta[pd.id].brand || '') : '',
        // v184：到货周期（同 loadCross —— 本处的 pd 同样来自 productsApi.grid）。
        //   ⚠️ 两条加载路径都要带：漏一处会让「本期」显示 +3天 而「往期」全变「—」。
        arrival_lead_days: Number(pd.arrival_lead_days) || 0,
        qtyByUnit, total, boxes, price, amount,
        ai, aiMethod, people, final_qty, decided, extra_qty,
        /* v190：本期手工单价（元/箱）—— 只读汇总表的**金额列要靠它**。
           没有它，老板在查看态看到的「单价(进价/箱)」与「下单金额(进价)」会退回档案自动价，
           与填单人保存时看到的不一致（同屏两个口径打架）。值来自 summary 的 rows（按期次隔离）。
           ⚠️ 这里判 `> 0` 而不是 `!= null`：与前端 `pricePerCase` / 后端「非正数归 NULL」同判据。 */
        casePrice: (r && Number(r.case_price) > 0) ? Number(r.case_price) : null,
        /* v191b：沿用价 + 来源期次标签（**只读参考值**，与 loadEditGrid 同源同判据）——
           两条加载路径都要带：漏一处，「查看态（只读汇总表）」的单价与下单金额就会退回档案自动价，
           与填单人在改单网格里看到的不是同一个数（同屏两个口径打架）。 */
        casePriceInherit: (r && Number(r.last_case_price) > 0) ? Number(r.last_case_price) : null,
        casePriceInheritPeriod: r ? inheritPeriodLabel(r.last_case_period_start, r.last_case_period_end) : '',
        // v179：这一行是不是「本批导入进来的」—— 供表格角标显示（用户要能一眼确认
        //   他那 159 个商品进来了）。来源是后端登记台账，不是前端推测。
        imported: importedSet.has(Number(pd.id)),
        // v179：这一行不在「在售档案」里（已停用/已删除），但本期数据引用了它。
        //   必须显式标出来 —— 否则用户会以为档案列表少了商品。
        offArchive: !!pd.offArchive,
      }
    })
    const colTotals = units.map(u => matrixRows.reduce((s, r) => s + (r.qtyByUnit[u.name] || 0), 0))
    cross.value = {
      period: p,
      units,
      rows: matrixRows,
      colTotals,
      // v179：收窄前有多少行（= 在售商品档案总数）—— 「另有 N 个未显示」由它与 rows.length
      //   现算，不另存一份计数（同屏数字口径必须同源）。
      rowBaseTotal: allProds.length,
      // v184e：grand 初值先占位，随后由 recomputeTotals() 用行级同源函数重算（含 boxes），
      // 保证表尾「合计(箱)」合计与只读表逐行 rowBoxes 完全一致，不在此另写一套累加。
      grand: {
        sku: matrixRows.length,
        qty: matrixRows.reduce((s, r) => s + r.total, 0),
        amount: matrixRows.reduce((s, r) => s + (amountValue(r) || 0), 0),
      },
      reportedUnits: units.length,
    }
    recomputeTotals()   // v184e：装载完成后用唯一权威函数重算 grand（含 boxes）
  } catch (e) {
    toast('交叉表加载失败: ' + (e.message || ''), 'error')
  } finally {
    crossLoading.value = false
  }
}

const searchQ = ref('')
const searchResults = ref([])

/* 别名配置 */
const aliasOpen = ref(false)
const aliasTarget = ref(null)
const aliasForm = ref('')

function openAlias(p) {
  aliasTarget.value = p
  aliasForm.value = p.alias || ''
  aliasOpen.value = true
}

async function saveAlias() {
  try {
    const d = await auditApi.setAlias(aliasTarget.value.id, aliasForm.value.trim())
    aliasTarget.value.alias = d.alias
    toast('别名已保存，员工搜索即生效', 'ok')
    aliasOpen.value = false
  } catch (e) { toast(e.message || '保存失败', 'err') }
}
const draft = ref([])
const auditing = ref(false)
const auditResults = ref([])
const rebateSummary = ref([])

let searchTimer = null

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(doSearch, 300)
}

async function doSearch() {
  const q = searchQ.value.trim()
  if (!q) { searchResults.value = []; return }
  try {
    const data = await auditApi.searchProducts(q)
    // D11 (2026-07-24)：后端改为 {items, total} 结构（total 供分页计数），兼容旧数组形态
    searchResults.value = data.items || data.products || data.data || data || []
  } catch (e) { /* 静默 */ }
}

/* Q1：逐单补录与编辑网格此前完全割裂——草稿里加的商品切到编辑网格后「消失」，
   用户以为数据丢了。这里提供显式的单向同步入口（不自动同步，避免意外覆盖）。 */
async function syncDraftToGrid() {
  if (!draft.value.length) { toast('草稿为空，先搜索加入商品', 'warn'); return }
  const ok = window.confirm(`把草稿中的 ${draft.value.length} 个商品带入编辑网格？\n\n`
    + '说明：草稿不区分客户（只有一个总需求量），带入后数量会填入「加单」列，'
    + '你需要在网格里再分配到各客户列，最后点「保存」。')
  if (!ok) return
  if (!editMode.value) {
    await enterEdit()
    if (!editMode.value) return
  }
  snapshot()
  let added = 0, updated = 0
  draft.value.forEach(d => {
    let r = cross.value.rows.find(x => Number(x.product_id) === Number(d.product_id) && d.product_id)
    if (!r) {
      r = { ...blankRow(), product_id: d.product_id || 0, name: d.name || '', spec: d.spec || '', unit: d.unit || '件', _new: true }
      cross.value.rows.push(r)
      added++
    } else updated++
    const q = Number(d.requested_qty || d.suggested_qty || 0) || 0
    if (q > 0) r.extraQty = (Number(r.extraQty) || 0) + q
  })
  gotoRowPage(cross.value.rows.length - 1)
  toast(`已带入编辑网格：新增 ${added} 个 · 更新 ${updated} 个（数量已填入「加单」列，请在网格内分配到各客户后保存）`, 'ok')
}

function addToDraft(p) {
  if (draft.value.find(d => d.product_id === p.id)) {
    toast('已在草稿中', 'info')
    return
  }
  draft.value.push({
    product_id: p.id,
    name: p.name,
    spec: p.spec,
    unit: p.unit,
    requested_qty: 1,
    current_stock: p.current_stock ?? null,
    avg_daily_sales: p.avg_daily_sales ?? null,
    suggested_qty: null,
    verdict: '',
  })
  searchQ.value = ''
  searchResults.value = []
}

async function runAudit() {
  if (!draft.value.length) return
  auditing.value = true
  try {
    const items = draft.value.map(d => ({ product_id: d.product_id, requested_qty: d.requested_qty }))
    const res = await auditApi.compute(items)
    const results = res.data || res.results || res || []
    auditResults.value = results
    // 合并结果回草稿
    for (const r of results) {
      const d = draft.value.find(x => x.product_id === r.product_id)
      if (d) {
        d.suggested_qty = r.suggested_qty
        d.verdict = r.verdict
        d.current_stock = r.current_stock
        d.avg_daily_sales = r.avg_daily_sales
        d.days_of_cover = r.days_of_cover
        d.safety_stock = r.safety_stock
        d.lead_time_days = r.lead_time_days
        d.coverage_days = r.coverage_days
        d.required_stock = r.required_stock
      }
    }
    toast('智能审核完成', 'success')
  } catch (e) {
    toast('审核失败: ' + (e.message || ''), 'error')
  } finally {
    auditing.value = false
  }
}

async function saveDraft() {
  // Q15：按钮原为 :disabled="!auditResults.length" 且无任何说明，
  // 用户填完数量发现按钮点不动、不知道要先审核。改为可点击 + 明确引导。
  if (!auditResults.value.length) {
    toast('请先点「智能审核」，审核通过后再保存草稿', 'warn')
    return
  }
  try {
    const items = draft.value.map(d => ({ product_id: d.product_id, requested_qty: d.requested_qty }))
    await auditApi.save({ submitter_name: store.user.name || '系统', items })
    toast('草稿已保存', 'success')
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  }
}

async function createPeriod() {
  const b = np.value
  if (!b.name || !b.order_start || !b.order_end || !b.arrival) {
    toast('请填写完整期次信息', 'error')
    return
  }
  try {
    await forecastApi.createPeriod(b)
    toast('期次已创建', 'success')
    showNewPeriod.value = false
    np.value = { name: '', order_start: '', order_end: '', arrival: '' }
    await loadPeriods()
    // v184：loadPeriods() 内部会把 curPeriod 改成新建的这个期次（下拉跟着走），
    // 但它**从不重载表格** ⇒ 画面是「下拉 = 新期次、表格 = 上一期的数据」，
    // 用户会以为没建成功（2026-09-17 那次「导入的品不见了」正是同一个根因）。
    // 复用期次切换的**唯一收口**（onPeriodChange 内部即 loadOrders + loadCross/loadEditGrid），
    // 不新写第二份重载逻辑。
    onPeriodChange()
  } catch (e) {
    toast('创建失败: ' + (e.message || ''), 'error')
  }
}

/* ---- v180 (2026-09-16) 软警告：**一处实现，两处（新建 / 改期次）共用** ----
   硬规则（名称非空 / 窗口不反向 / 到货不早于下单截止）由后端 `period_validate` 拦截并
   返回中文原因 —— 前端**不再写第二份**（两台实现必然漂移）。此处只提示两件「不拦你、
   但你得知道」的事：同名、以及与已有期次窗口重叠。 */
function periodSoftWarn(name, start, end, excludeId) {
  const out = []
  const nm = String(name || '').trim()
  const s = String(start || ''), e = String(end || '')
  const others = (periods.value || []).filter(p => Number(p.id) !== Number(excludeId || 0))
  if (nm && others.some(p => String(p.name || '').trim() === nm)) {
    out.push('已有同名期次 —— 下拉有限宽，两个同名项很难分辨，建议名称里带上日期。')
  }
  if (s && e) {
    const hit = others.find(p => p.order_start && p.order_end && s <= p.order_end && e >= p.order_start)
    if (hit) out.push(`与「${hit.name}」（${hit.order_start} ~ ${hit.order_end}）窗口重叠 —— 同一笔报单可能被两期同时统计。`)
  }
  return out
}
const npSoftWarn = computed(() => periodSoftWarn(np.value?.name, np.value?.order_start, np.value?.order_end, 0))

/* ---- v180 改期次（仅 open 期次；走 PATCH /api/forecast/periods/{pid}） ----
   为什么必须有：此前只有 create / close / delete ⇒ 名字打错唯一修法是「关闭 → 删除」，
   而删除级联清掉该期全部报单/明细/定稿/付款/订单且不可恢复。 */
const peOpen = ref(false)
const peTarget = ref(null)
const peSaving = ref(false)
const pe = ref({ name: '', order_start: '', order_end: '', arrival: '' })
// 改期次表单里手改过的日期字段（同 npTouched，语义一致）
const peTouched = ref({ order_start: false, order_end: false, arrival: false })
function markPeTouched(k) { peTouched.value[k] = true }

function openPeriodEdit(row) {
  if (!row || Number(row.id) <= 0) { toast('这个期次没有可修改的记录', 'warn'); return }
  if (String(row.status || 'open') !== 'open') { toast('已关闭的期次不能修改，如需调整请新建期次', 'warn'); return }
  peTarget.value = row
  pe.value = {
    name: row.name || '',
    order_start: row.order_start || '',
    order_end: row.order_end || '',
    arrival: row.arrival_date || row.arrival || '',
  }
  peTouched.value = { order_start: false, order_end: false, arrival: false }
  peOpen.value = true
}
const peSoftWarn = computed(() => periodSoftWarn(pe.value?.name, pe.value?.order_start, pe.value?.order_end, peTarget.value?.id || 0))

async function savePeriodEdit() {
  const t = peTarget.value
  if (!t) return
  peSaving.value = true
  try {
    // 只提交**真的变了**的字段：后端按「同值重提不留痕」处理，这里先收窄可让回执更准
    const body = {}
    for (const k of ['name', 'order_start', 'order_end', 'arrival']) {
      const old = k === 'arrival' ? (t.arrival_date || t.arrival || '') : (t[k] || '')
      if (String(pe.value[k] || '').trim() !== String(old || '').trim()) body[k] = String(pe.value[k] || '').trim()
    }
    if (!Object.keys(body).length) { toast('没有要修改的内容', 'warn'); peSaving.value = false; return }
    const r = await forecastApi.updatePeriod(t.id, body)
    const n = Object.keys(r?.changed || {}).length
    toast(n ? `已保存（改动 ${n} 处）` : '没有要修改的内容', n ? 'success' : 'warn')
    peOpen.value = false
    // v180 真机实测补：历史期次列表是在子组件里自己 load() 的，改名后不重挂
    // ⇒ 弹窗关了、库里也改了，表格却还显示旧名称，用户会以为没保存成功（真机 D6 命中）。
    if (n) historyKey.value++
    await loadPeriods()
    // 改的是当前选中的期次 ⇒ 它的窗口变了，汇总表必须重取（否则同屏新旧口径打架）
    if (Number(t.id) === Number(curPeriod.value)) { if (editMode.value) loadEditGrid(); else loadCross() }
  } catch (e) {
    toast('保存失败: ' + (e.message || e), 'error')
  } finally {
    peSaving.value = false
  }
}

/* ---- v184 (2026-09-17) 复制期次（入口：往期预报列表每行的「复制」） ----
   为什么默认「整体顺延」：加单（`forecast_submissions.py:462`）与定稿（`erp_db.py:15200`）
   的归属键是 `(period_start, period_end)` **日期窗口**，不是期次 id。沿用旧窗口 ⇒
   两期**共用同一份**加单与定稿（窗口重叠即串期），而同屏不报任何错。
   所以复制时名称与窗口**一起**后移 —— 这样「只改名称即可用」才成立。 */
const pcOpen = ref(false)
const pcSrc = ref(null)
const pcSaving = ref(false)
const pcNameEl = ref(null)
const pc = ref({ name: '', order_start: '', order_end: '', arrival: '' })
const PC_SHIFT_OPTS = [3, 7, 14]   // 天。默认 7 = 低温奶报单的周节奏
const pcShiftDays = ref(7)

function addDaysStr(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return String(iso || '')
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + Number(n || 0))
  return fmtDate(d)
}

// 把期次名里的「M月D日」整体后移 n 天。名称里不带年份 ⇒ 只回写月日（跨年由 Date 自行滚动），
// 年份只用于解析基准，取源期次的下单开始年。
function shiftPeriodNameDates(text, n, baseIso) {
  const s = String(text || '')
  if (!n) return s
  const _y = /^(\d{4})-/.exec(String(baseIso || ''))
  const baseYear = _y ? Number(_y[1]) : new Date().getFullYear()
  return s.replace(/(\d{1,2})月(\d{1,2})[日号]/g, (whole, mo, dd) => {
    const d = new Date(baseYear, Number(mo) - 1, Number(dd))
    if (isNaN(d.getTime())) return whole
    d.setDate(d.getDate() + n)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  })
}

// 按顺延天数重算名称与三个日期。⚠️ 一律**相对源期次**重算，不是相对当前值 ——
// 否则连点两次「+7 天」会叠加成 +14，而按钮上写的是 7。
function applyPcShift(n) {
  const src = pcSrc.value
  if (!src) return
  pcShiftDays.value = Number(n || 0)
  pc.value.name = shiftPeriodNameDates(src.name || '', pcShiftDays.value, src.order_start)
  pc.value.order_start = addDaysStr(src.order_start, pcShiftDays.value)
  pc.value.order_end = addDaysStr(src.order_end, pcShiftDays.value)
  pc.value.arrival = addDaysStr(src.arrival_date || src.arrival, pcShiftDays.value)
}

function openPeriodCopy(row) {
  if (!row || Number(row.id) <= 0) { toast('这个期次没有可复制的记录', 'warn'); return }
  pcSrc.value = row
  applyPcShift(pcShiftDays.value)
  pcOpen.value = true
  // 名称预填后**全选**：点进来直接打字即覆盖，不用先删掉原名（「仅需修改名称即可使用」）
  nextTick(() => { try { pcNameEl.value && pcNameEl.value.select() } catch (e) { /* 忽略 */ } })
}

// 名称 → 日期联动。复制场景里新期次没有「手改保护」的需求，故一律覆盖 ——
// 让「改名称里的日期」真的能带动窗口，这正是「只改名称」成立的前提。
function onPcNameInput() {
  const ds = parsePeriodDates(pc.value.name)
  if (!ds || !ds.length) return
  pc.value.order_start = pc.value.order_end = fmtDate(new Date(ds[0].year, ds[0].month - 1, ds[0].day))
  if (ds.length >= 2) pc.value.arrival = fmtDate(new Date(ds[1].year, ds[1].month - 1, ds[1].day))
}

const pcSoftWarn = computed(() => periodSoftWarn(pc.value && pc.value.name, pc.value && pc.value.order_start, pc.value && pc.value.order_end, 0))
const pcSrcCount = computed(() => {
  const n = pcSrc.value && pcSrc.value.imported_count
  return (n == null) ? null : Number(n)
})

async function savePeriodCopy() {
  const src = pcSrc.value
  if (!src) return
  pcSaving.value = true
  try {
    const r = await forecastApi.copyPeriod(src.id, {
      name: String(pc.value.name || '').trim(),
      order_start: pc.value.order_start,
      order_end: pc.value.order_end,
      arrival: pc.value.arrival,
    })
    toast(`已复制为「${r.name}」，带过来 ${r.copied} 个商品`, 'success')
    pcOpen.value = false
    historyKey.value++      // 往期列表在子组件里自己 load()，不重挂会继续显示旧数据（v180 D6 教训）
    await loadPeriods()
    // 新期次落库后即为 current（loadPeriods 已把 curPeriod 指过去）⇒ 表格必须跟着重载，
    // 否则画面还是源期次的数据，用户会以为复制没生效。
    onPeriodChange()
  } catch (e) {
    toast('复制失败: ' + (e.message || e), 'error')
  } finally {
    pcSaving.value = false
  }
}

/* ---- v184 空期次的「从上一期复制清单」（就地填入，**不新建期次**） ----
   与往期列表的「复制」分工不同：那个会新建一期，这个直接往**当前查看的这一期**里填。
   否则用户在空期次上想补清单，只能「去往期列表复制 → 建出新期 → 再删掉旧的」。 */
const seedBusy = ref(false)
const nearestPrevPeriod = computed(() => {
  const cur = Number(curPeriod.value || 0)
  const pool = (periods.value || [])
    .filter(p => Number(p.id) > 0 && Number(p.id) !== cur && p.order_start && p.order_end)
  if (!pool.length) return null
  const cs = String((cross.value && cross.value.period && cross.value.period.order_start) || '')
  // 优先「窗口在本期之前的最近一期」；本期是首个期次时（没有更早的）退回任意最近一期
  const before = cs ? pool.filter(p => String(p.order_start) < cs) : pool
  const use = before.length ? before : pool
  return use.slice().sort((a, b) => String(b.order_start).localeCompare(String(a.order_start)))[0]
})

async function seedFromPrev() {
  const src = nearestPrevPeriod.value
  const cur = Number(curPeriod.value || 0)
  if (!src) { toast('没有可用的上一期 —— 可以直接导入 Excel，或先建一个期次', 'warn'); return }
  if (cur <= 0) { toast('请先选定一个期次', 'warn'); return }
  seedBusy.value = true
  try {
    const r = await forecastApi.seedPeriod(src.id, { target_period_id: cur })
    toast(`已从「${r.src_name}」填入 ${r.added} 个商品`
      + (r.skipped ? `（跳过 ${r.skipped} 个本期已有的）` : ''), 'success')
    // 🔴 `loadPeriods()` 会把 curPeriod 重设成**后端默认期次**（`forecast_period_default()`，
    //    见 erp_db.py:15261）——它只回答「默认该看哪一期」，**不是**「保持用户当前在看的那一期」。
    //    而 seed 的目标可能是一个**更老的空期次**（这正是「不必先删再建」的用法）：不还原的话，
    //    用户点「从上一期复制清单」后视图会被**甩到另一期**去，同屏不报任何错 ——
    //    真机 E 组当初之所以通过，只因被 seed 的那期恰好是最新的一期（侥幸 PASS）。
    //    对比 `createPeriod()` 里那个同名的 `loadPeriods()`：那里「切到新建的那一期」正是想要的
    //    行为，所以只有 seed 这条路需要守住视图。
    const keep = cur
    await loadPeriods()
    if (keep > 0 && (periods.value || []).some(p => Number(p.id) === keep)) curPeriod.value = keep
    if (editMode.value) loadEditGrid(); else loadCross()
  } catch (e) {
    toast('复制清单失败: ' + (e.message || e), 'error')
  } finally {
    seedBusy.value = false
  }
}

// ---- 新建期次：日期预填 + 名称解析自动填日期（2026-08-26） ----
function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function openNewPeriod() {
  if (showNewPeriod.value) {
    showNewPeriod.value = false
    return
  }
  showNewPeriod.value = true
  // 打开即预填（v242c 统一为**填报窗口**口径；v242d 按用户口径校正锚点）：
  //   报单日 = **明天** ⇒ 下单开始 = 今天、下单截止 = 明天、到货 = 明天 + 4 天
  //   （到货跟着报单日走，保持「到货 = 报单日 + 提前天数」的关系；三项均可手改）
  const t = new Date()
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)
  const arr = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 5)
  np.value.order_start = fmtDate(t)
  np.value.order_end = fmtDate(tomorrow)
  np.value.arrival = fmtDate(arr)
  // v180：预填值不算「手改」，否则名称解析会被自己的预填挡住
  resetNpTouched()
}

// v242f：取消新建 —— 关闭表单并清空已填内容。
//   不弹二次确认：这是用户**主动**放弃，与「误点遮罩」不同族（后者才需要"确认放弃/继续编辑"）。
//   npSoftWarn / npNameDates 都是 computed，跟着 np 自动归零，无需单独重置。
function cancelNewPeriod() {
  showNewPeriod.value = false
  np.value = { name: '', order_start: '', order_end: '', arrival: '' }
  resetNpTouched()
}

// 从名称里提取日期（支持 2026-08-25 / 8月25日 / 8/25 / 8.25 等，年默认今年）
function parsePeriodDates(text) {
  if (!text) return []
  const out = []
  const re = /((\d{4})[-/.年\s]*)?(\d{1,2})[-月.\/](\d{1,2})(?:日|号)?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const year = m[2] ? parseInt(m[2], 10) : new Date().getFullYear()
    const month = parseInt(m[3], 10)
    const day = parseInt(m[4], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      out.push({ year, month, day })
    }
  }
  const dedup = []
  for (const d of out) {
    const last = dedup[dedup.length - 1]
    if (!last || last.year !== d.year || last.month !== d.month || last.day !== d.day) dedup.push(d)
  }
  return dedup
}

// v180 (2026-09-16)：手工改过的日期字段 —— 名称解析不再覆盖它们。
// 原先 `onPeriodNameInput` **无条件**把 order_start/order_end/arrival 全按名称重算，
// 用户先手改日期、再回头改名称 ⇒ 手填值被**静默丢掉**（无任何提示）。属「用户输入被丢弃
// 且无反馈」，与「假旋钮」同族。现在：默认只 **填空字段**；要整体覆盖必须走显式按钮。
const npTouched = ref({ order_start: false, order_end: false, arrival: false })
function markNpTouched(k) { npTouched.value[k] = true }
function resetNpTouched() { npTouched.value = { order_start: false, order_end: false, arrival: false } }

// 名称里能识别出的日期（第一个=下单日、第二个=到货日）——决定「按名称更新日期」按钮是否出现
const npNameDates = computed(() => parsePeriodDates(np.value?.name))

// v242c：报单窗口只有一天时给出与「自动建表」口径对齐的提示（不阻塞创建 —— 后端
//   period_validate 允许 start<=end，且有些客户确实只报一天）
const npSingleDayWarn = computed(() => {
  const a = np.value?.order_start, b = np.value?.order_end
  if (!a || !b || a !== b) return ''
  return '这一期的「报单窗口」只有一天。自动建表用的是「报单日前一天 ~ 报单日」，若要口径一致，请把「下单开始」改成报单日的前一天（或直接在期次名称里写日期，会自动按前一日填）。'
})

// 把识别到的日期写进表单。force=true 时无视「手改过」保护（用户主动点按钮才允许）
function applyPeriodDates(ds, force) {
  if (!ds || !ds.length) return false
  // v242c：名称里第一个日期是**报单日** ⇒ 下单截止 = 它；下单开始 = 它的**前一天**。
  //   原先两个字段同设成 d0（下单开始=下单截止=报单日），与「自动建表」写出的
  //   「填报窗口」(报单日前一天 ~ 报单日) **口径不一致** ⇒ 同一种期次在列表里的
  //   「报单窗口」显示成两种样子。现统一为填报窗口口径（用 Date 归一化做减法，
  //   避免 86400000 毫秒在夏令时边界上偏一天）。
  const _d0 = new Date(ds[0].year, ds[0].month - 1, ds[0].day)
  const d0 = fmtDate(_d0)
  const d0prev = fmtDate(new Date(ds[0].year, ds[0].month - 1, ds[0].day - 1))
  if (force || !npTouched.value.order_end) np.value.order_end = d0
  if (force || !npTouched.value.order_start) np.value.order_start = d0prev
  if (ds.length >= 2) {
    const d1 = fmtDate(new Date(ds[1].year, ds[1].month - 1, ds[1].day))
    if (force || !npTouched.value.arrival) np.value.arrival = d1
  }
  return true
}

// 名称输入时自动补日期（**只填空字段**，不覆盖用户手改过的）
function onPeriodNameInput() { applyPeriodDates(parsePeriodDates(np.value.name), false) }

// 显式「按名称更新日期」：用户主动要求 ⇒ 允许覆盖手填值
function applyNameDatesNow() {
  if (!applyPeriodDates(parsePeriodDates(np.value.name), true)) {
    toast('名称里没有识别到日期（形如「8月25日报单-8月29日到货」）', 'warn')
    return
  }
  resetNpTouched()
  toast('已按名称更新日期', 'success')
}

async function loadPeriods() {
  try {
    const d = await forecastApi.periods()
    periods.value = d.periods || []
    const cid = d.current ? Number(d.current.id || 0) : 0
    if (d.current) {
      curPeriod.value = cid
      // 归属口径记录（= 后端 forecast_period_default()，与导入落库同源）；
      // 之后用户切下拉只看不改它。
    }
    // ⚠️ 必须**无条件**赋值：期次被全部删掉时 current 变 null，若沿用旧值，
    //    pick 步会继续显示一个已经不存在的「本期归属」，而导入实际会落 0。
    curOpenPeriodId.value = cid
    // v193：**进行中**期次（= 后端 forecast_period_current()，导入落库归属的同一判据）。
    // 与上面 cid 分开取 —— cid 来自 `current`（展示兜底口径），可能是一个已关闭的期次。
    openPeriodId.value = d.open ? Number(d.open.id || 0) : 0
    // v193：本次确实问到了后端（无论有没有进行中期次）⇒ 这才允许「没有进行中期次」这个结论成立。
    periodsLoaded.value = true
  } catch (e) { /* 静默 */ }
}

async function loadOrders() {
  if (!curPeriod.value) return
  try {
    const d = await forecastApi.periodOrders(curPeriod.value)
    const orders = d.orders || d || []
    // 把已有报单填入草稿
    draft.value = orders.map(o => ({
      product_id: o.product_id,
      name: o.product_name,
      spec: '',
      unit: o.unit || '',
      requested_qty: o.quantity || 0,
      current_stock: null,
      avg_daily_sales: null,
      suggested_qty: null,
      verdict: '',
    }))
  } catch (e) { /* 静默 */ }
}

async function loadRebate() {
  try {
    const d = await auditApi.rebateSummary()
    rebateSummary.value = d.data || d || []
  } catch (e) { /* 静默 */ }
}

function suggestedClass(d) {
  if (d.suggested_qty == null) return ''
  if (d.requested_qty > d.suggested_qty * 1.2) return 'val-warn'
  if (d.requested_qty < d.suggested_qty * 0.8 && d.suggested_qty > 0) return 'val-bad'
  return 'val-ok'
}
function verdictTag(v) {
  if (v.includes('积压') || v.includes('高于')) return 'warn'
  if (v.includes('缺货') || v.includes('低于')) return 'bad'
  if (v.includes('吻合')) return 'ok'
  return 'info'
}
function coverClass(days) {
  if (days == null) return ''
  if (days < 3) return 'cover-danger'
  if (days < 7) return 'cover-warn'
  return 'cover-ok'
}
/* v207：`maximumFractionDigits` 由 0 改 2 —— 原来是**显示层的二次抹零**，计算层改对了也没用。
   两类量都受益：
     ① 金额：最终下单(箱) × 单价(元/箱) 本来就带分（如 3 箱 × ¥97.36 = ¥292.08），
        旧设置显示成 ¥292 ⇒ 表尾金额与逐行相加对不上（差几角几分）。现在按分显示。
     ② 数量/库存/起订量这类整数：`maximumFractionDigits` 只是**上限**、`minimumFractionDigits`
        仍是 0 ⇒ 整数照旧显示成整数，不会冒出「12.00」。
   ⚠️ 箱数不走这里 —— 它要 3 位小数，见 fmtBox（24 瓶/箱报 3 瓶 = 0.125，2 位会变 0.13）。 */
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
/* v207：**箱数专用**格式（最多 3 位小数）。
   与 fmt 分开的原因：元只到分（2 位）、箱要 3 位，一个函数兜不住两种精度。 */
function fmtBox(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}
/* P1-4 下单主体徽标配色：把主体名稳定散列到 6 色色板（oe-c0..oe-c5）。
   不针对任何具体主体名做特判 —— 主体由租户在「报单配置」里自己定义，
   相同主体恒定同色，不同主体大概率异色。 */
const OE_COLOR_N = 6
function oeColorIdx(name) {
  const s = String(name || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973
  return h % OE_COLOR_N
}
function achClass(ach) {
  if (ach == null) return ''
  if (ach >= 1) return 'val-ok'
  if (ach >= 0.8) return ''
  return 'val-bad'
}
function achProgressClass(ach) {
  if (ach == null) return ''
  if (ach >= 1) return 'green'
  if (ach < 0.7) return 'amber'
  return ''
}

onMounted(async () => {
  loadColWidths()
  loadBrandOptions()
  loadRebate()
  loadRebateRules()
  loadTenantParams()
  loadRebateAchievements()
  probeErp()
  // v161：列注册表要在渲染网格**之前**到位 —— 它决定"哪些列不可删除"以及有哪些自定义列。
  // 失败不阻断页面（降级到内置规则），但 loadColumnRegistry 内部会提示，不静默。
  await loadColumnRegistry()
  await loadPeriods()
  // 默认进入交叉表视图：按默认模式加载报单汇总表，避免空白
  if (viewMode.value === 'cross') {
    if (editMode.value) loadEditGrid(); else loadCross()
  }
})
</script>

<style scoped>
.module-tabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--bd);padding-bottom:2px}
.module-tabs button{border:none;background:transparent;color:var(--t2);font-size:14px;font-weight:500;padding:8px 14px;border-radius:var(--radius-sm) var(--radius-sm) 0 0;cursor:pointer;position:relative}
.module-tabs button:hover{color:var(--p)}
.module-tabs button.on{color:var(--p);font-weight:600}
.module-tabs button.on::after{content:'';position:absolute;left:0;right:0;bottom:-3px;height:2px;background:var(--p);border-radius:2px}
/* 报单配置嵌入为标签页时，去掉其自身 .page 包裹的内边距，并隐藏与标签重复的小标题（独立深链页不受影响） */
.config-panel :deep(.page){padding:0;margin:0}
.config-panel :deep(.page-hd){display:none}
.toolbar{display:flex;align-items:center;justify-content:flex-start;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.tb-left,.tb-right,.toolbar>.tb-group{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.tb-left .btn,.tb-right .btn,.toolbar>.tb-group .btn{flex:0 0 auto;white-space:nowrap}
/* 工具栏单行布局（2026-09-12）：分三段，段间以 .tb-sep 分隔、段内 gap 8
   段1 .tb-ctx  期次上下文（期次选择 / 新建期次 / 审批状态徽标）
   段2 .tb-data 搜索与数据进出（搜索框 / 导入 / 导出）  ← v167：复制报单已下移到表格工具行
   段3 .tb-act  决策与编辑（AI智能建议 / 改单 / 编辑态工具箱）
   容量实测（「新建期次」提为常显按钮后，最坏态＝期次名撑满选择器限宽；余量＝可用内容宽 − 所需内容宽）：
     1440 → +43px（真实态 +67）  1366 → +60   1512 → +115   1680 → +283   1920 → +523   1280 → +8（见 <1360 档）
   表格级筛选器（仅显示有报单 / 品牌）已下移到表格卡片顶部的 .grid-ctl-row。
   v167：「复制报单」从段2 下移到同一行 —— 它与品牌筛选是同一条动作链的两步（先勾品牌、再复制那些
   品牌的编码/数量），且只对当前这张汇总表生效；下移后"勾品牌 → 复制"同行相邻，不必走回页头。
   编辑态多出的 5 个编辑按钮交由 .tb-edit-group 独占第二行（v169 校准：v168 撤掉编辑态「复制报单」后由 6 个减为 5 个），故 toolbar 保留 flex-wrap 作窄屏兜底。
   注：类名用 .tb-dense 而非 .tb-compact —— 后者是 variables.css 的全局类（Toolbar.vue 在用），避免命名碰撞。 */
.toolbar>.tb-group>*{flex:0 0 auto;white-space:nowrap}
/* 编辑控制组：编辑态独占整行（flex-basis 100% 强制换行），且位于工具栏最末 → 最贴近下方表格。
   v209：本组自 v209 起**同时被全屏表格工具行复用**（.grid-ctl-row 内那份，见 fsRowHosting）。
   故必须拆成「共用布局 + 上下文修饰」—— 原为单条 `.toolbar>.tb-edit-group` 同时管这两件事，
   若直接复用会连带继承「独占整行」(flex:0 0 100%)，在表格工具行里立刻被强制折行。 */
.tb-edit-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tb-edit-group>.btn{flex:0 0 auto;white-space:nowrap}
/* v201：编辑工具行的**常驻保存状态**（未修改 / 有未保存的改动 / 已保存 HH:MM）。
   放在「保存」按钮之后 ⇒ 阅读顺序自然变成「点保存 → 往右看结果」。
   三态用「小圆点 + 中文文案」，不依赖图标字体；底色用半透明 ⇒ 浅色与深色主题都可读。 */
.tb-edit-group>.save-state{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  padding:0 10px;height:28px;border-radius:14px;font-size:12px;white-space:nowrap;line-height:1}
/* ① 工具栏内：独占整行（工具栏最末一段，视觉上紧贴下方表格） */
.toolbar>.tb-edit-group{flex:0 0 100%}
/* ② 表格工具行内：与同行控件并列 —— 不占满行、自身也不换行
      （行级换行统一由 .grid-ctl-row 的 flex-wrap 决定，避免「组内换行」产生视觉断层） */
.grid-ctl-row>.tb-edit-group{flex:0 0 auto;flex-wrap:nowrap}
.save-state .ss-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}
.save-state.clean{color:var(--t3);background:var(--bg4)}
.save-state.saved{color:var(--ok-green);background:var(--ok-green-bg)}
.save-state.dirty{color:var(--warn-amber);background:var(--warn-amber-bg)}
.toolbar.tb-dense,.toolbar.tb-dense>.tb-edit-group{gap:6px}
.toolbar.tb-dense .tb-sep{margin:0 3px}
/* 窄屏（<1440）：收紧段间距、AI 按钮只留图标 → 单行在 1366 及以上依然成立（1366 最坏态余量 +60px）。
   1440 及以上保留完整文案与 8px 间距。 */
@media(max-width:1439px){
  .toolbar,.toolbar>.tb-group,.toolbar>.tb-edit-group{gap:6px}
  .toolbar .tb-sep{margin:0 3px}
  .tb-ai-txt{display:none}
}
/* 1280 档（<1360）：唯一放不下的一档 —— 「新建期次」提为常显按钮后，段1 由 226px 涨到 296px，
   1280 可用内容宽仅 958px，而真实所需 962px（含分隔条左右外边距）→ 折行。三条收紧共省 58px：
   ① 隐藏两条 .tb-sep 装饰分隔条 —— 不丢任何信息/控件，仅少掉 1px 竖线（省 2px 宽 + 12px 外边距 + 2 个 gap）；
   ② 段间距 6 → 5（1px，肉眼不可辨；编辑态第一行多一个 89px 的「工具箱」按钮，靠它压住不折行）；
   ③ 期次选择器收到 126px —— 正好是占位文案「— 选择期次 —」的自然宽（再窄连占位都会被截断）。
   1360 及以上完全不动（1366 非编辑态余量 +48px），避免无谓地压缩更宽视口。 */
@media(max-width:1359px){
  .toolbar>.tb-sep{display:none}
  .toolbar,.toolbar>.tb-group,.toolbar>.tb-edit-group{gap:5px}
  .toolbar .sel-period{max-width:126px}
}
/* 期次选择器限宽 150：段1 原来是「选择器(≤220) + ⋯(32)」＝252px 占地，
   2026-09-12 起 ⋯ 换成常显的「新建期次」按钮（102px），故选择器上限收到 150px
   （150 + 102 = 252）以保持段1 占地不变 —— 否则 1440 最坏情况下主工具栏会折行。
   全宽统一 150 也让选择器宽度在任何视口下一致（此前 ≥1440 为 220、<1440 为 150 会跳变）。 */
.sel-period{width:auto;max-width:150px;height:32px;padding:0 8px;flex-shrink:0;appearance:auto;-webkit-appearance:auto;cursor:pointer;position:relative;z-index:2}

/* ---- P0-1 交叉表视图 ---- */
/* 本期预报子视图切换：汇总表 / 逐单补录（移出工具栏，内容区干净分段） */
/* v166：视图切换行改 flex —— 「修改日志」贴右，长提示文字可换行（原本是块级容器 + 行内 span
   的「自然流」，加了按钮后必须显式分配弹性，否则按钮会被长提示挤到下一行）。行高与下方间距
   沿用原值（原来是靠 .view-seg 的 margin-bottom 撑开的 12px）。 */
.view-seg-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.view-seg-row>.view-seg{margin-bottom:0}
.view-seg-row>.view-seg-tip{flex:1 1 260px;min-width:0}
.view-seg-row>.log-btn{margin-left:auto;flex:0 0 auto}
.view-seg{display:inline-flex;gap:4px;background:var(--bg3);border-radius:8px;padding:3px;margin-bottom:12px}
.view-seg button{border:1px solid transparent;background:transparent;padding:5px 16px;border-radius:var(--radius-sm);font-size:13px;color:var(--t2);cursor:pointer}
.view-seg button.on{background:var(--bg4);color:var(--p-dark);box-shadow:var(--shadow-sm);border-color:var(--p);font-weight:500}
.ph-actions{margin-left:auto;display:inline-flex;gap:8px}
/* 2026-08-27 期次确认徽标（经理保存汇总表=审批定稿） */
.confirm-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:8px;font-weight:500;white-space:nowrap}
.confirm-badge.ok{background:rgba(var(--suc-rgb),.14);color:var(--confirm-green)}
.confirm-badge.draft{background:var(--bg3);color:var(--t3)}
.confirm-badge.filter{background:var(--p-bg);color:var(--p-deep)}
/* P0-1 工具栏语义分隔条（筛选/数据/编辑/AI/设置 五簇） */
.tb-sep{display:inline-block;width:1px;height:20px;background:var(--bd);margin:0 5px;flex:0 0 auto;opacity:.65;align-self:center}
/* P0-2 状态徽标曾独立成行（.tb-status-row 已废弃：现直接挂在 .tb-ctx 段内，紧随期次选择器） */
.cross-area{margin-bottom:14px}
.cross-card{padding:0 14px 14px;overflow:hidden}
.cross-tbl{min-width:100%;font-size:12px}
.cross-tbl thead th{position:sticky;top:0;z-index:5;background:var(--bg3);border-bottom:1px solid var(--bd);font-weight:500;color:var(--t2);padding:8px 7px;white-space:nowrap}
.cross-tbl .frozen{position:sticky;left:0;background:var(--bg);z-index:6;min-width:200px;box-shadow:1px 0 0 var(--bd)}
/* v184：到货周期是**固定列**，但比「商品名称」窄得多 —— 覆盖 .frozen 的 200px 宽度下限。
   ⚠️ 位置：排在 `.cross-tbl .frozen` 之后（既然后写者赢，又多了个类 → 特异性更高，双重保险）。
   ⚠️ 本表是 `table-layout:fixed` ⇒ **列宽实际由 colgroup 的 colW() 单独决定**
      （COL_DEFAULTS.arrival_lead_days = 92），这条 min-width 当前不参与计算、属**防御**：
      一旦有人把表改回 auto，它会阻止该列被 `.frozen` 的 200px 下限顶宽。
   ⚠️ 别把 min-width 写回模板的 inline style：inline 优先级最高，会盖掉这条。 */
.cross-tbl .frozen.fc-cycle{min-width:88px}
.cross-tbl thead .frozen{background:var(--bg3)}
.fc-code{min-width:96px;font-variant-numeric:tabular-nums;color:var(--t2);font-size:11px}
.fc-num{min-width:72px;text-align:right;font-variant-numeric:tabular-nums;color:var(--t2)}
.fc-text{min-width:70px;color:var(--t2)}
.fc-name{min-width:200px}
.btn-copy{border:1px solid var(--bd);color:var(--t1)}
.btn-copy:hover{background:var(--bg2)}

/* ---- 列配置条 + 菜单 ---- */
.col-config-bar{position:relative;display:flex;align-items:center;gap:10px;padding:0;flex-wrap:wrap}
.btn-xs{padding:3px 9px;font-size:12px;border-radius:var(--radius-sm)}
.col-menu{position:absolute;top:38px;left:0;z-index:1101;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:10px 12px;min-width:300px;max-height:70vh;overflow:auto}
.col-menu-hd{font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.col-menu-view{margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--bd);display:flex;flex-direction:column;gap:6px;width:72%}
.col-menu-view .basis-toggle{display:grid;grid-template-columns:56px 1fr;align-items:center;gap:8px}
.col-menu-view select{border:1px solid var(--bd);border-radius:var(--radius-sm);padding:2px 6px;font-size:12px;background:var(--bg);color:var(--t1);width:100%}
.col-menu select:focus{border-color:var(--p);outline:2px solid var(--p);outline-offset:-2px}
.col-menu-x{border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;border-radius:var(--radius-sm);flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.col-menu-x:hover{background:var(--bg3);color:var(--p-dark)}
.col-menu-overlay{position:fixed;inset:0;z-index:1100}
.col-menu-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.col-menu-list li{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:var(--radius-sm);font-size:var(--fs-sm)}
.col-menu-list li:hover{background:var(--bg3)}
.col-menu-list li.locked{color:var(--t2);font-weight:500}
.col-menu-list li.hidden{opacity:.5}
.col-menu-list li .drag{cursor:grab;color:var(--t3);font-size:12px;user-select:none}
.col-menu-list li.locked .drag{visibility:hidden}
.col-menu-list label{display:flex;align-items:center;gap:5px;flex:1;cursor:pointer}
.col-menu-list input[type=checkbox]{accent-color:var(--p);width:14px;height:14px;cursor:pointer}
.col-menu-del{border:none;background:none;color:var(--t3);cursor:pointer;font-size:11px;padding:1px 4px;border-radius:var(--radius-sm);display:inline-flex;align-items:center;justify-content:center}
.col-menu-del:hover{color:var(--dan);background:var(--dan-bg)}
.col-menu-add{margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.col-menu-add .cm-label{font-size:11px;color:var(--t3);margin-right:2px}
.col-menu-schemes{margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd);display:flex;flex-direction:column;gap:6px}
.col-menu-schemes .cm-label{font-size:11px;color:var(--t3);margin-right:2px}
.col-menu-schemes select{font-size:12px;padding:3px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--bg);color:var(--t1);width:100%}
.col-menu-schemes .scheme-row{display:flex;gap:6px}
.col-menu-schemes .scheme-name-ipt{flex:1;min-width:0;border:1px solid var(--bd);border-radius:var(--radius-sm);padding:3px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.col-menu-schemes .scheme-name-ipt:focus{border-color:var(--p);outline:2px solid var(--p);outline-offset:-2px}
.col-menu-schemes .scheme-btn{flex:1;justify-content:center}
.edit-col-menu{position:absolute;top:38px;left:0;z-index:1102;max-width:420px}
.col-menu-reset{margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd);display:flex;justify-content:flex-end}
.th-in{display:flex;align-items:center;gap:5px;justify-content:space-between}
.col-cfg{border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:11px;padding:0 2px;line-height:1;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.col-cfg:hover{color:var(--p-dark)}
.col-cfg:hover{color:var(--p-dark)}
/* P1-② 表格去线：去掉表体行分隔线，行区分完全交给斑马纹 + hover（已存在），
   40+ 列大表视觉更透气；表头底线 / 列合计顶线 / 分组头底线保留（结构性分隔）。 */
.cross-tbl tbody td{padding:7px 7px;white-space:nowrap}
.qty-th{text-align:center;min-width:52px}
.qty-cell{text-align:center;color:var(--t3)}
.qty-cell.has{color:var(--t1);font-weight:500}
.calc-th{text-align:right}
.calc-th.sum{background:var(--sum-bg);color:var(--sum-txt)}
.calc-th.final{background:var(--p-bg);color:var(--p-dark)}
.calc-th.final .th-sub{font-weight:400;font-size:var(--fs-xs);opacity:.7}
/* 表体优化 P1/P2/P3：斑马纹/排序/分组/吸底合计 */
.tb-toolbar{display:flex;gap:12px;align-items:center;margin:4px 0 8px;flex-wrap:wrap}
.tb-toolbar .hint{color:var(--t3);font-size:12px}
.cross-tbl tbody tr.data-row.zebra{background:var(--bg2)}
.cross-tbl tbody tr.data-row:hover{background:var(--bg3)}
.cross-tbl.edit-tbl tbody tr:nth-child(even){background:var(--bg2)}
.cross-tbl.edit-tbl tbody tr:hover{background:var(--bg3)}
th.sortable{cursor:pointer;user-select:none}
th.sortable:hover{color:var(--p-dark)}
.sort-ind{font-size:var(--fs-xs);margin-left:2px;color:var(--p)}
.grp-head{background:var(--bg3);cursor:pointer}
.grp-head td{padding:6px 8px;border-bottom:1px solid var(--border-subtle)}
.grp-toggle{display:inline-block;width:14px;color:var(--p-dark)}
.grp-sub-info{margin-left:10px;color:var(--t2);font-size:12px;font-weight:400}

/* 选区统计状态栏 */
/* 🔴 `position:fixed` 是**功能的一部分**，不是装饰。这条为什么必须浮起来：
   ① 表格自己是一个 `max-height:72vh` 的滚动盒（.table-wrap.edit-grid-wrap），
      统计条在它**下面**；整个页面又在 `main.content`（overflow-y:auto）里滚，
      页面比可视区高 ~574px ⇒ 1600×950 视口下统计条落在 y≈1200，**在屏幕外**。
      后果：用户刚框完一片格、正想批量填，入口却在屏幕外，得先往下滚 ——
      而这条统计条存在的**全部意义**就是"框完之后一眼看见"。
   ② 试过 `position:sticky;bottom:0`（真机实测**无效**）：它是 `.grid-area` 的
      **最后一个子元素**，包含块底边就在它下面 ⇒ sticky 无处可移（实测 top 仍是 1200）。
      这条约束是硬性的：页面里任何"把表格改矮"的做法都救不了（页头+工具栏就已经超出视口）。
   `left:var(--sidebar-w)` 让开左侧栏（该变量由 Shell 写在 documentElement 上，
   且侧栏可拖拽调宽 ⇒ 跟随自动生效）。
   `z-index:40` > 粘性列的 6；又远低于各类浮层（ctx-menu 1091 / modal 1130），不抢层级。 */
.sel-stat{display:flex;align-items:center;gap:16px;padding:7px 14px;background:var(--bg3);border-top:1px solid var(--bd);font-size:var(--fs-sm);color:var(--t2);position:fixed;left:var(--sidebar-w,248px);right:0;bottom:0;z-index:40;box-shadow:0 -2px 8px rgba(0,0,0,.07)}
/* 全屏层 `.grid-area.is-fs` 是 `position:fixed;inset:0`，把整个视口（含侧栏位）都占了
   ⇒ 那里必须让统计条铺满全宽，否则左边缘会凭空缺一块。 */
.grid-area.is-fs .sel-stat{left:0}
.sel-stat-label{font-weight:600;color:var(--t1)}
.sel-stat b{color:var(--p-dark);font-weight:600;margin-left:2px}
.sel-stat-x{margin-left:auto;width:22px;height:22px;border:none;background:var(--bg);border-radius:var(--radius-sm);color:var(--t2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.sel-stat-x:hover{background:var(--dan-bg);color:var(--dan)}
/* v212（P2-3）：选区统计条上的「批量填入」可见入口。放在 `margin-left:auto` 的关闭按钮
   **之前** ⇒ 它留在左侧统计数字那一簇里，跟「计数/求和/平均」同一组心智（都作用于选区）。 */
.sel-fill{display:inline-flex;align-items:center;gap:6px;padding-left:14px;border-left:1px solid var(--bd)}
.sel-fill-label{color:var(--t2)}
.sel-fill-ipt{width:88px;padding:3px 7px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:var(--fs-sm);outline:none}
.sel-fill-ipt:focus{border-color:var(--p)}
.sel-fill-ipt::placeholder{color:var(--t3)}
.sel-fill-go{padding:3px 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:var(--fs-sm);cursor:pointer}
.sel-fill-go:hover:not(:disabled){background:var(--bg3)}
.sel-fill-go:disabled{opacity:.45;cursor:default}

/* 商品档案弹层 */
.profile-modal{max-width:480px}
.pf-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--bd);border-radius:var(--radius-sm);overflow:hidden}
.pf-item{display:flex;flex-direction:column;gap:3px;padding:10px 12px;background:var(--bg)}
.pf-item span{font-size:11px;color:var(--t3)}
.pf-item b{font-size:var(--fs-base);color:var(--t1);font-weight:600;word-break:break-all}
.pf-item.pf-note{grid-column:1 / -1}
.pf-warn{color:var(--dan) !important}
.pf-ok{color:var(--suc) !important}
.pf-mid{color:var(--war) !important}
.cross-tbl,.edit-tbl{border-collapse:separate;border-spacing:0;table-layout:fixed}
.cross-tbl>tbody>tr>td,.edit-tbl>tbody>tr>td{position:relative}
.col-resizer{position:absolute;top:0;right:-3px;width:9px;height:100%;cursor:col-resize;z-index:5;touch-action:none}
.col-resizer::after{content:'';position:absolute;right:3px;top:8%;height:84%;width:2px;border-radius:2px;background:var(--resizer-bg)}
.col-resizer:hover::after,.col-resizer.active::after{background:var(--p)}
.table-wrap.edit-grid-wrap{flex:1 1 auto;min-height:0;max-height:72vh;overflow:auto;max-width:100%}
.seq-th{width:42px;min-width:42px;text-align:center;padding:8px 4px;vertical-align:middle}
.seq-cell{width:42px;min-width:42px;text-align:center;padding:6px 4px;vertical-align:middle;color:var(--t3);font-size:12px}
/* 序号列冻结（v176）：横向滚动时保持可见 —— 「商品名称」之前这一列不许被滚走。
   ① 必须 sticky + **不透明**底色：sticky 只改绘制位置，透明底会把滚过来的内容透出来；
   ② 底色与既有冻结列 .frozen 完全一致（表体 var(--bg) / 表头 var(--bg3) / 表尾 var(--bg3)），
      让「序号 + 商品名称」读作**一个整体冻结块**，而不是给序号列单染一条色带；
   ③ 行状态优先级更高、**自动生效无需在此重复**：条件告警行 `.cond-warn>td` 带 !important；
      错误行 `.td.seq-cell.row-bad`(0,3,0) > 本规则(0,2,0)；键盘选中 `.cross-tbl td.cell-active`(0,2,1) 亦然；
      两个表尾的底色由下面第 3 行单独兜回 var(--bg3)，否则会被第 1 行（0,2,0 > .col-total td 的 0,1,1）染白；
   ④ z-index：单元格 6（与 .frozen 同级）、表头 **9** —— 表头必须高于既有 thead th(7) 与 th.frozen(8)，
      否则横向滚过来的普通表头会盖在序号表头上（同为 sticky，z 相同时后出现者胜）；
   ⑤ 权威列宽是 <colgroup> 的 colW('seq')（.cross-tbl/.edit-tbl 为 table-layout:fixed），
      本处的 42px 是陈旧值、不参与布局；冻结列的右移量见 v184 的 frozenLeftOf()。 */
.cross-tbl .seq-th,.cross-tbl .seq-cell{position:sticky;left:0;background:var(--bg);z-index:6}
.cross-tbl thead .seq-th,.cross-tbl thead .seq-cell{background:var(--bg3);z-index:9}
.cross-tbl .col-total .seq-cell,.cross-tbl .foot-row .seq-cell{background:var(--bg3)}
.seq-num{display:inline-block;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}
.gear{padding:2px 4px;border:none;background:transparent;cursor:pointer;font-size:14px;line-height:1;color:var(--t3);border-radius:var(--radius-sm)}
.gear:hover{background:var(--bg3);color:var(--p-dark)}
.col-total-bar{position:relative;z-index:9;background:var(--bg3);border-top:2px solid var(--bd);flex:0 0 auto;width:100%;min-width:0;max-width:100%;overflow:hidden;box-shadow:0 -2px 5px rgba(15,23,42,.06)}
.col-total-bar>table{transform:translateX(var(--foot-sl,0));will-change:transform}
.cross-amt-note{margin:10px 2px 0;font-size:12px;line-height:1.6;color:var(--t3)}
.amt-note-toggle{display:inline-block;margin:8px 2px 0;font-size:12px;color:var(--p-dark);cursor:pointer;user-select:none}
/* v247：档案列空值（—）淡显，与数量格空格子同一套语言 */
.cell-dash{color:var(--t3);opacity:.55}
.cross-amt-note b{color:var(--t1)}
.col-total-bar .frozen{background:var(--bg3)}
/* 表尾「冻结列」反向同步（v176，与序号列冻结同批）：
   表尾是**另一张 table**，靠 `--foot-sl` 整体位移跟随表体（它自己不滚动，所以 sticky 在里面无效）。
   位移对冻结列一视同仁 ⇒ 横向滚动时表尾的「合计」标签会滑出左边界，冻结列下方反而显示**别的列**的表尾格
   （2026-09-16 实测 scrollLeft=600：冻结列下方是 标准售价 / 进价 / 分销价 三格）。
   给冻结格反向位移一份即对齐。⚠️ `--foot-sl=0` 时本规则为 **no-op** ⇒ 不滚动时静态外观零变化。 */
.col-total-bar .frozen,.col-total-bar .seq-cell{transform:translateX(calc(-1 * var(--foot-sl,0px)))}
.miss-price{color:var(--danger-txt);font-weight:500}
/* v207：表尾/汇总条里「有几行没被算进合计(箱)」的补充说明。
   小字 + 警示色，挂在主数字**之后** —— 不抢主数字，但也不允许静默省略。
   （单元格级的「缺规格」直接复用上面的 .miss-price —— 同一个视觉语言：「数据缺」，不另立类。） */
.box-miss{margin-left:4px;font-size:11px;font-weight:400;color:var(--war)}
.calc-th.amount{min-width:80px}
.calc{text-align:right;font-variant-numeric:tabular-nums}
.calc.sum{background:var(--sum-bg);color:var(--sum-txt);font-weight:500}
.calc.final{background:var(--p-bg);color:var(--p-dark);font-weight:600}
.calc.amount{font-weight:600}
.col-total td{background:var(--bg3);font-weight:600;border-top:2px solid var(--bd)}
.col-total .calc.sum{background:var(--sum-col-bg)}
.col-total .calc.final{background:var(--final-bg)}

/* ---- 表体工程化增强（T1-T8：虚拟滚动/选中/展开/行状态/行操作/空加载态/键盘a11y） ---- */
.cross-viewport{flex:1 1 auto;min-height:0;min-width:0;max-height:72vh;overflow:auto;position:relative}
/* 表体全屏按钮：尺寸/图标/颜色/圆角/悬停态与 AI 副驾 .cp-icon-btn 全屏按钮完全对齐 */
.grid-area{position:relative;display:flex;flex-direction:column;gap:10px}
.grid-area.is-fs{position:fixed;inset:0;z-index:1000;background:var(--bg);padding:12px;display:flex;flex-direction:column;gap:10px}
.grid-area.is-fs .cross-viewport,
.grid-area.is-fs .edit-grid-wrap{flex:1 1 auto;min-height:0;max-height:none}
/* 表体控制条：全屏按钮 + 缩放条整合为一行，置于表体上方（flex 流），与表格主体保持间距、互不遮挡（非全屏/全屏均成立） */
.grid-ctl-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:30px;padding:1px 0}
.grid-fs-btn{
  position:absolute;top:8px;right:8px;z-index:30;
  width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
  border:none;background:none;border-radius:8px;color:var(--t2);cursor:pointer;
}
.grid-fs-btn:hover:not(:disabled){background:var(--bg2);color:var(--t1)}
.grid-fs-btn:disabled{opacity:.35;cursor:default}
.grid-area.is-fs .grid-fs-btn{top:14px;right:14px}
/* ===== v209：全屏态把「改单 / 编辑组」搬进表格工具行（方案 A：全屏专属）=====
   背景：全屏层 .grid-area.is-fs 是 position:fixed;inset:0;z-index:1000，把主工具栏整条盖住
   ⇒ 全屏下页头那个「改单」点不到（真机 elementFromPoint 命中到无 class 的元素）。用户在**全屏看表**
   时想改单被迫先退出全屏。解法 = 在**全屏层内部**补同源入口（见模板 fsRowHosting）。
   ⚠️ 下面各条**只在全屏生效**，非全屏表格工具行一个像素都不动（方案 A 的取舍：非全屏页头那份在手边，
      且实测非全屏 1440 塞入编辑组差 273px、必然折行）。 */
/* ① 行尾给右上角全屏按钮**留位**。.grid-fs-btn 是 position:absolute;right:14px（相对全屏层），
      而 .grid-ctl-row 的内容右边界在 视口−12px ⇒ 两者天然重叠最后 28px：内容一长就被按钮压住
      （看着像缺一块，且点不中）。故全屏时行尾预留 34px。 */
.grid-area.is-fs .grid-ctl-row{padding-right:34px;gap:6px}
/* ③ 两个计数徽标收成图标形态（文案不丢：完整句子在 title 与 aria-label 里，见模板）。
      ⚠️ 这是全屏单行的**必要项**，不是美观取舍：徽标实测各约 150–180px，且「已隐藏 N 个零报单」
         与「另有 N 个在售商品未显示」**可同时出现**；再加上状态条宽度随文案变
         （「已保存 12:34」比实测时的「尚未修改」宽 84px）⇒ 全屏最坏态比稳态宽约 230px，
         不收起必然折行。只在全屏收，非全屏保持完整文案。 */
.grid-area.is-fs .confirm-badge.badge-slim{padding:3px 7px;gap:0}
/* v129 修复：全屏时把主工具栏弹层容器降回普通层级。
   .tb-pop 常态 z-index:1120（要高于 .pop-overlay 1100 才能“弹层开着直接点别的触发按钮”），
   但全屏层 .grid-area.is-fs 只有 1000 → 仍在工具栏的「导出」「工具箱」触发器会盖在全屏层上，
   脱离工具栏悬浮在表体中间、遮挡表头与数据行。全屏时置为 auto（< 1000）即可随工具栏一起被覆盖。
   不动 .tb-pop 常态值，退出全屏后普通模式的互斥点击行为完全不变。
   v167 校准：品牌筛选（2026-09-12 下移）与复制报单（v167 下移）现已挂在 .grid-ctl-row 上，
   属全屏层**内部**元素，不再"脱离工具栏悬浮"；本条规则对它们只剩把容器降为 auto 的中性效果。
   v168 补充：复制报单只挂**只读态**那条 .grid-ctl-row（编辑态已撤），但无论哪条都在全屏层内部，
   故上面这条结论不变。 */
.page.grid-fs-on .tb-pop{z-index:auto}
/* ④ 编辑组在全屏再收一档：按钮横向内边距 12→9、组内间距 8→6。仅外观微调，不删任何按钮。 */
.grid-area.is-fs .grid-ctl-row>.tb-edit-group{gap:6px}
.grid-area.is-fs .grid-ctl-row>.tb-edit-group>.btn{padding-left:9px;padding-right:9px}
/* v135 修复：AI 副驾全局抽屉（.copilot z-index:950）打开时，主工具栏 .tb-pop 的常态
   z-index:1120 会浮在抽屉之上——触发按钮（工具栏内「导出 / 期次 / 高级工具」，表体工具行内
   「品牌 / 复制报单」）脱离页面悬浮在副驾抽屉上。与全屏层 .grid-fs-on 同构：副驾打开时统一
   降为 auto（< 950），随页面一起被抽屉遮罩（.cp-overlay 940）覆盖。弹层面板/遮罩一并降级，
   避免抽屉开着时旧弹层仍浮在上层。不动 .tb-pop 常态值，关闭副驾后互斥点击行为完全不变。 */
.page.copilot-on .tb-pop,
.page.copilot-on .tb-pop-panel,
.page.copilot-on .pop-overlay{z-index:auto}
/* 全屏表格层（1000）同理：副驾打开时应让位给抽屉，否则整屏表格会盖住 AI 副驾。 */
.page.copilot-on .grid-area.is-fs{z-index:auto}
/* 主工具栏整合：搜索框 / 表格设置&高级工具 弹层 / 活动筛选行 */
/* 2026-09-12 修复「点击后浮出淡淡品牌色光圈」：
   本控件是「胶囊 + 内层无边框 input」的复合结构，内层 .fld 的 border 被置 none，
   但全局 .fld:focus 的 box-shadow:0 0 0 3px var(--p-bg) 照旧生效 ——
   光晕不贴合胶囊边界，变成凭空浮在胶囊内部的一圈淡青方框（且 input 高 32px 溢出
   容器 30px 内容区，光晕上下还会顶出胶囊）。修法：焦点反馈上移到胶囊整体，
   对齐 CopilotDrawer 的 .cp-composer:focus-within 范式。 */
.tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:var(--bg3);border:1px solid var(--bd);border-radius:8px;color:var(--t2);flex:0 0 auto;transition:border-color .2s,box-shadow .2s}
.tb-search:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 3px var(--p-bg)}
.tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;color:var(--t1);width:150px;height:100%}
.tb-search .fld:focus{box-shadow:none}
.tb-search .fld::placeholder{color:var(--t3)}
.tb-pop{position:relative;display:inline-flex;z-index:1120}/* z 高于 .pop-overlay(1100)：弹层开着时仍可直接点触发按钮做互斥切换 */
.tb-pop-panel{position:fixed;z-index:1101;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:12px;display:flex;flex-direction:column;gap:10px;min-width:220px}
.zp-sep{height:1px;background:var(--bd);margin:2px 0}
.zp-hd{font-size:12px;font-weight:600;color:var(--t3);margin-top:2px}
.zp-hd-sub{font-weight:400;color:var(--t3);margin-left:5px}
.pop-overlay{position:fixed;inset:0;z-index:1100}
.tb-pop-sep{height:1px;background:var(--bd);margin:2px 0}
.filter-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.cross-tbl thead th{position:sticky;top:0;z-index:7}
.cross-tbl thead th.frozen{z-index:8}
.cross-tbl td{position:relative}
.cross-tbl tr.data-row.selected{background:rgba(6,182,212,.10)}
.cross-tbl td.cell-active{outline:2px solid var(--p);outline-offset:-2px;background:var(--p-bg);z-index:4}
.cross-tbl td:focus{outline:2px solid var(--p);outline-offset:-2px}
.cross-tbl tr.data-row.row-loading{opacity:.6}
.cross-tbl tr.data-row.row-loading .pname::after{content:' 加载中…';font-size:11px}
.cross-tbl tr.data-row.row-error{background:var(--danger-bg)}
.cross-tbl tr.data-row.row-error .pname{color:var(--danger-txt)}
.cross-tbl tr.data-row.row-disabled{opacity:.45;filter:grayscale(.6)}
.exp-chev{cursor:pointer;color:var(--p-dark);display:inline-block;width:14px;user-select:none;margin-right:2px}
.row-ops{position:absolute;top:2px;right:4px;display:none;gap:2px;z-index:5}
.cross-tbl tr.data-row:hover .row-ops{display:flex}
.row-ops .rop{border:none;background:var(--bg3);border-radius:var(--radius-sm);cursor:pointer;font-size:12px;line-height:18px;padding:0 4px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.row-ops .rop:hover{background:var(--p-bg);color:var(--p-dark)}
.row-ops .rop.danger:hover{background:var(--dan-bg,rgba(239,68,68,.12));color:var(--dan)}
.det-row{background:var(--bg2)}
.det-grid{display:grid;grid-template-columns:64px 1fr;gap:3px 12px;padding:8px 10px;font-size:12px}
.det-row2{display:contents}
.det-row2>span{color:var(--t3)}
.det-row2>b{font-weight:500}
.det-row2 b.ok{color:var(--suc)}
.det-row2 b.warn{color:var(--dan)}
.det-i{font-style:normal;color:var(--t3);font-size:11px}
.det-units{display:flex;flex-wrap:wrap;gap:4px 10px}
.det-unit{background:var(--bg);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:1px 6px}
.det-units-row{grid-column:1 / -1}
.vs-spacer td{border:none;padding:0;height:0;line-height:0;background:transparent;font-size:0}
.qty-num{display:inline-block;min-width:18px}
.tbl-state{padding:40px 16px;text-align:center}
.tbl-skeleton .sk-row{display:flex;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border-subtle)}
.tbl-skeleton .sk-bar{flex:1;height:14px;border-radius:var(--radius-sm);background:linear-gradient(90deg,var(--bg2) 25%,var(--bg3) 37%,var(--bg2) 63%);background-size:400% 100%;animation:sk 1.2s ease-in-out infinite}
@keyframes sk{0%{background-position:100% 50%}100%{background-position:0 50%}}
.tbl-empty .empty-ico{font-size:40px}
.tbl-empty .empty-t{font-size:15px;font-weight:500;margin-top:8px}
.tbl-empty .empty-s{color:var(--t3);font-size:12px;margin-top:4px}
.tbl-empty .empty-ops{display:flex;gap:10px;justify-content:center;margin-top:14px}
.pname{font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pspec{color:var(--t3);font-size:11px;margin-top:1px}
.ai-hint{color:var(--p-dark);font-size:11px;margin-top:2px;font-weight:500}
.tip-wrap{position:relative;cursor:help;border-bottom:1px dashed var(--bd)}
.tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--bg);color:var(--t1);font-size:11px;padding:7px 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);white-space:nowrap;z-index:20;box-shadow:var(--shadow-md)}
.tip b{color:var(--p-dark)}
.tip-wrap:hover .tip{display:block}
.pin{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--bd)}
.pin .big{font-size:18px;font-weight:500}
.pin .big b{color:var(--p-dark)}
.pin .mini{font-size:12px;color:var(--t2)}
.pin .mini b{color:var(--t1)}

/* ---- 交叉表编辑模式 ---- */
.edit-tbl{min-width:100%}
.edit-tbl thead th{background:var(--bg3)}
.cust-hd{display:flex;align-items:center;gap:4px}
/* v184：只读单元格（edit:'ro'，目前只有「到货周期」）—— 视觉口径与同排的 input 对齐
   （同字号、居中、tabular-nums 让 +3天 / +12天 的数字对齐），但**不是**输入框，
   以免暗示「这里能改」。它只出现于编辑网格的只读列；查看态走 masterVal 的纯文本路径。 */
.cell-ro{display:block;padding:2px 6px;color:var(--t2);font-size:12px;text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
.cell-input{height:26px;padding:0 6px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:12px;outline:none;display:block;width:100%;min-width:0;box-sizing:border-box;text-align:center}
.cell-input:focus{border-color:var(--p)}
/* v246 零值降噪：空格子的占位点（·）淡显，避免「满屏 0」淹没有效数据 */
.cell-input::placeholder{color:var(--t3);opacity:.4}
/* v190：「单价(进价/箱)」录入框。
   ① 手工录入价 —— 必须与「档案进价算出来的自动价」在视觉上区分，否则用户分不清
      「这个价是系统带的还是我填的」（同屏两个来源的数必须能自证，见项目铁律）。
   ② 未录入且缺价/缺规格 —— 灰字占位改用警示色，避免空框看起来像「这一格本来就没数」。 */
.cell-input.cell-price.manual-price{border-color:var(--p);background:var(--p-bg);font-weight:600}
.calc.price.miss-price .cell-input::placeholder{color:var(--danger-txt);font-weight:600;opacity:1}
.cell-name{text-align:left;font-weight:500}
.cell-wide{text-align:left}
.cell-cust{}
.cell-spec{text-align:left}
.cell-unit{}
.cell-price{text-align:right}
.cell-qty{background:var(--bg3)}
.edit-tbl .fc-code .cell-wide{width:100%}
.edit-tbl .fc-num .cell-num{width:100%}
.col-del{border:none;background:none;color:var(--t3);font-size:11px;cursor:pointer;padding:2px;border-radius:var(--radius-sm);flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.col-del:hover{color:var(--dan);background:var(--dan-bg)}
.col-del:hover{color:var(--dan)}
.op-th{text-align:center;min-width:34px}
.edit-hint{font-size:12px;color:var(--t3);margin-top:10px;line-height:1.7;border-top:1px dashed var(--bd);padding-top:8px}

/* ---- Excel 式交互视觉（选中/行列高亮/填充柄/右键菜单） ---- */
.edit-tbl td{position:relative}
.cross-tbl td.selected{outline:2px solid var(--p);outline-offset:-2px;background:var(--p-bg);z-index:3}
.cross-tbl tr.sel-row > td{background:rgba(6,182,212,.05)}
.cross-tbl th.sel-col{background:var(--p-bg);color:var(--p-dark);font-weight:600}
.cross-tbl td.sel-col{background:var(--p-bg)}
.fill-handle{position:absolute;right:-4px;bottom:-4px;width:9px;height:9px;background:var(--p);border:1.5px solid #fff;border-radius:2px;cursor:crosshair;z-index:9;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.fill-handle:hover{background:var(--p-dark)}
.ctx-overlay{position:fixed;inset:0;z-index:1090}
.ctx-menu{position:fixed;z-index:1091;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:5px;min-width:172px;font-size:var(--fs-sm);max-height:calc(100vh - 16px);overflow-y:auto}
.ctx-menu button{display:flex;width:100%;align-items:center;gap:8px;padding:7px 10px;border:none;background:none;color:var(--t1);cursor:pointer;text-align:left;border-radius:var(--radius-sm);font-size:var(--fs-sm)}
.ctx-menu button:hover{background:var(--bg3)}
.ctx-menu button:disabled{opacity:.4;cursor:default}
.ctx-menu button.danger:hover{background:var(--dan-bg,rgba(239,68,68,.1));color:var(--dan)}
.ctx-menu kbd{margin-left:auto;padding:0 5px;border:1px solid var(--bd);border-bottom-width:2px;border-radius:4px;background:var(--bg2);font-family:var(--mono,ui-monospace,monospace);font-size:var(--fs-xs);color:var(--t2);font-weight:400}
.ctx-menu .ctx-sep{height:1px;background:var(--border-subtle);margin:4px 2px}
.ctx-menu .ctx-note{padding:6px 10px;color:var(--t3);font-size:11px}
.ctx-menu .ctx-ipt-row{display:flex;gap:6px;padding:6px 8px}
.ctx-menu .ctx-ipt{flex:1;min-width:0;padding:5px 7px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:var(--fs-sm);outline:none}
.ctx-menu .ctx-ipt:focus{border-color:var(--p)}
.ctx-menu .ctx-sel{padding:5px 4px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:var(--fs-sm);outline:none}
.ctx-menu .ctx-ipt-actions{display:flex;gap:6px;padding:0 8px 7px}
.ctx-menu .ctx-ipt-actions button{flex:1;justify-content:center;padding:5px 8px;border:none;background:var(--bg3);color:var(--t1);cursor:pointer;border-radius:var(--radius-sm);font-size:var(--fs-sm)}
.ctx-menu .ctx-ipt-actions button.btn-primary{background:var(--p);color:#fff}
.ctx-menu .ctx-ipt-actions button.btn-primary:hover{filter:brightness(.95)}
.ctx-menu .ctx-ipt-actions button:hover{background:var(--bg2)}
.ctx-menu button.ctx-on{background:color-mix(in srgb,var(--p) 14%,var(--bg));color:var(--p)}
/* 表头右键：唯一值筛选列表 */
.ctx-uniq-hd{padding:7px 10px 4px;font-size:12px;color:var(--t1);display:flex;align-items:center;justify-content:space-between;gap:8px}
.ctx-uniq-all{display:flex;align-items:center;gap:4px;color:var(--t2);font-size:var(--fs-sm);cursor:pointer}
.ctx-uniq-list{max-height:200px;overflow:auto;padding:2px 6px}
.ctx-uniq-item{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:var(--radius-sm);cursor:pointer}
.ctx-uniq-item:hover{background:var(--bg3)}
.ctx-uniq-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctx-ipt-unit{color:var(--t2)}
/* 条件格式：库存<安全库存 整行高亮 */
.edit-tbl tr.cond-warn > td,
.cross-tbl tr.cond-warn > td{background:color-mix(in srgb,var(--dan) 14%,var(--bg))!important}
.edit-tbl tr.cond-warn:hover > td,
.cross-tbl tr.cond-warn:hover > td{background:color-mix(in srgb,var(--dan) 20%,var(--bg))!important}
/* 列统计弹层 */
.stats-body{padding:6px 12px 12px}
.stat-row{display:flex;justify-content:space-between;gap:16px;padding:5px 2px;border-bottom:1px dashed var(--border-subtle)}
.stat-row:last-child{border-bottom:none}
.stat-row span{color:var(--t2)}
.stat-row b{color:var(--t1);font-variant-numeric:tabular-nums}
.stat-sample b{font-weight:600;white-space:pre-wrap;text-align:right}

/* 表头右键「筛选」激活提示 */
.filter-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border:1px solid var(--p);background:color-mix(in srgb,var(--p) 12%,var(--bg));color:var(--p);border-radius:999px;font-size:12px;white-space:nowrap;max-width:280px}
.filter-chip{overflow:hidden;text-overflow:ellipsis}
.filter-chip .chip-x{border:none;background:transparent;color:var(--p);cursor:pointer;font-size:12px;line-height:1;padding:0 2px;border-radius:50%}
.filter-chip .chip-x:hover{background:color-mix(in srgb,var(--p) 22%,var(--bg));color:var(--p)}

/* ---- P0-2 Excel 导入弹窗 ---- */
/* v136 修复：模态层必须高于「页面内所有浮层」，原先的 980/990 排在工具栏下拉之下。
   成因：本弹窗与遮罩都 Teleport 到 body，而 .page/.card/.toolbar/.grid-ctl-row 祖先链
   无 position+transform/filter/backdrop-filter，均不创建 stacking context ——
   于是工具栏 .tb-pop 的常态 1120 直接在根层与这里的 990 比较，1120 > 990，
   只要两者矩形重叠（实测视口高 >= 1040px 时品牌按钮即落入弹窗矩形），
   品牌/导出/复制报单三个按钮就浮在弹窗之上；遮罩 980 同样失效（品牌按钮仍可点穿）。
   取值：页面内浮层天花板 = 天气面板 .wx-pop 1121（注释「高于页面内所有下拉浮层」），
   故模态取 1125/1130 压过它，且远低于 toast 9999 / 空闲超时 9998。
   不要再改回 < 1121，也不要为此抬高 .tb-pop（会破坏「弹层开着直接点别的触发按钮」）。 */
.imp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:1125}
.imp-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(560px,94vw);background:var(--bg);border-radius:var(--radius-lg);z-index:1130;box-shadow:var(--shadow-lg);max-height:86vh;display:flex;flex-direction:column}
.imp-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle)}
.imp-hd b{font-size:14px}
.imp-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.imp-x:hover{color:var(--p-dark);background:var(--bg2);border-radius:var(--radius-sm)}
.imp-body{padding:16px 18px;overflow-y:auto}
.imp-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.imp-tip{font-size:var(--fs-sm);color:var(--t2);line-height:1.7;margin-bottom:14px}
.del-modal{width:min(440px,92vw)}
.warn-text{color:var(--dan);font-weight:500}
.del-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
.btn.danger{color:var(--dan)}
.btn.danger:hover{filter:brightness(.95)}
.imp-file{font-size:12px;color:var(--t3);margin-top:10px}
/* v178：原 `.imp-ident*` / `.imp-customers` / `.imp-miss` 一组样式随只读识别摘要一并移除
   —— 那组回显已被 ImportMapping 组件的可编辑映射表取代，留着就是死 CSS。 */
/* 列映射确认步要横向空间（文件列 / 识别为 / 依据 / 样例值四列） */
.imp-modal.imp-wide{width:min(880px,94vw)}
/* 进价列未识别时的提示：不是「说明文字」而是风险提示（闸门开启会整行拒收），且指明了去哪改 */
.imp-gate{margin:10px 0 12px;padding:8px 12px;border-radius:var(--radius-sm);font-size:var(--fs-sm);line-height:1.6;background:var(--warn-amber-bg);color:var(--warn-amber)}
.imp-matrix{max-height:180px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-md);margin-bottom:12px}
.imp-matrix table{font-size:var(--fs-sm)}
.imp-matrix th,.imp-matrix td{padding:5px 8px;border-bottom:1px solid var(--border-subtle);white-space:nowrap}
.imp-matrix thead th{position:sticky;top:0;background:var(--bg3)}
.imp-ft{display:flex;justify-content:flex-end;gap:10px;padding-top:6px}
.imp-ok{color:var(--suc);font-size:13px;margin-bottom:12px}
.imp-warn{color:var(--war);font-size:var(--fs-sm);margin-bottom:8px}
/* v179：「建档成功但没有数量」与「真的什么都没有」两个中性结局（信息蓝，不是错误色）。
   旧实现把前者渲染成绿色的「导入成功：0 个客户」，正是用户误判导入成功的直接原因。 */
.imp-none{color:var(--info-blue);font-size:13px;line-height:1.75;margin-bottom:12px}
.imp-errs{margin:0;padding-left:18px;font-size:12px;color:var(--t2);line-height:1.8}

/* v157 零档案建档结果块 */
.imp-arch{margin-top:12px;padding:12px 14px;border:1px solid var(--bd);border-radius:var(--radius-md);background:var(--bg2)}
.imp-arch-hd{font-size:var(--fs-sm);font-weight:600;color:var(--t1);margin-bottom:8px}
.imp-arch-line{display:flex;gap:10px;flex-wrap:wrap}
.imp-arch-tag{font-size:var(--fs-sm);color:var(--t2);padding:3px 10px;border-radius:999px;background:var(--bg3)}
.imp-arch-tag b{color:var(--t1);font-size:14px;margin-left:2px}
.imp-arch-tag.ok{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.imp-arch-tag.ok b{color:var(--suc)}
.imp-arch-list{margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--t2);line-height:1.75}
.imp-arch-note{margin:10px 0 0;font-size:var(--fs-sm);line-height:1.7;color:var(--t2)}
.imp-arch-note.warn{color:var(--war)}
.imp-arch-note.bad{color:var(--dan)}
.imp-arch-note.bad b{color:var(--dan)}

/* ---- P1-1 周期级 AI 审核台 ---- */
.audit-modal{width:min(760px,96vw)}
.legacy-note{font-size:var(--fs-sm);color:var(--t3);margin:0 0 10px;line-height:1.6}
.audit-erp-note{background:var(--bg3);border:1px solid var(--bd);border-left:3px solid var(--dan);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;line-height:1.7}
.audit-erp-note .link-btn{background:none;border:none;color:var(--p);font:inherit;font-weight:600;padding:0 2px;cursor:pointer;text-decoration:underline}
.audit-sum{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--t2);padding:8px 0 12px}
.audit-sum b{color:var(--t1)}
.audit-sug{color:var(--p-dark);font-weight:600}
.audit-name{font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audit-verdict{font-size:12px;color:var(--t2);max-width:260px}
.audit-modal .qty-input{width:72px;height:28px;padding:0 6px;border:1px solid var(--bd);border-radius:var(--radius-sm);text-align:right;background:var(--bg3);color:var(--t1);font-size:var(--fs-sm)}
.audit-more{display:flex;justify-content:center;padding:8px 0 2px}

/* ---- P1-4 下单主体徽标 ---- */
/* P1-4 下单主体徽标：按主体名稳定散列到有限色板。
   原先只写了两个具体户头名的类（`.oe-<户头名>`），后果有二：
   ① 真实户头名随产品交付到客户机器；② 其它租户的主体徽标匹配不到任何类 → 永远没有配色（只有裸徽标）。
   现改为通用色板 oe-c0..oe-c5，同名恒定同色，与主体名具体叫什么无关。 */
.oe-badge{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;font-size:var(--fs-xs);margin-left:6px;vertical-align:1px}
/* v179：本批导入角标（信息蓝，与户头徽标的彩色系区分开 —— 户头是"谁下单"，这个是"哪来的"） */
.imp-tag{background:var(--info-blue-bg);color:var(--info-blue)}
/* v179：不在「在售档案」里的行（已停用/已删除）—— 琥珀色，与「导入」蓝明确区分 */
.off-tag{background:var(--warn-amber-bg);color:var(--warn-amber)}
.oe-c0{background:var(--p-bg);color:var(--p-dark)}
.oe-c1{background:var(--violet-bg);color:var(--violet)}
.oe-c2{background:var(--sev-info-bg);color:var(--sev-info)}
.oe-c3{background:var(--st-approved-bg);color:var(--st-approved-txt)}
.oe-c4{background:var(--st-revised-bg);color:var(--st-revised-txt)}
.oe-c5{background:var(--st-submitted-bg);color:var(--st-submitted-txt)}

/* v193（既定方案 §五 阶段 0）：无「进行中期次」时的**常驻通告条**。
   配色沿用本页既有的提示级范式（同 .imp-gate / .tag.warn：warn-amber-bg 底 + warn-amber 字），
   不用 danger —— 这是「还差一步」而不是「出错了」。
   ⚠️ 布局影响：期次就绪时整条**不在 DOM 里**（v-if），故对既有用户零位移；
   出现时是页面纵向流的第一个块，不挤压工具栏那一行（不参与 .tb-group 的宽度竞争）。 */
.gate-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;
  border-radius:var(--radius-md);font-size:var(--fs-sm);line-height:1.6;
  background:var(--warn-amber-bg);color:var(--warn-amber)}
.gate-bar .gate-txt{flex:1}
.gate-bar b{font-weight:600}
.new-period{margin-bottom:14px}
/* v242h（用户定）：**行内标签**（label 在输入框左侧）+ 输入框本地降到 32px + 收窄宽度。
   为什么 32px：与 .btn-sm / 本页工具栏（期次选择器 32 + 新建期次按钮 32）齐平，整行一个高度。
   为什么要收窄：原 `.np-fld{flex:1}` 把 4 个字段各拉到卡片 1/4，日期框被撑到 200px+ ——
   一个「2026-09-22」用不了那么宽，纯浪费。现在日期固定 140px、名称 240px，行内不抢空间。 */
.np-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.np-fld{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.np-fld>span{font-size:12px;color:var(--t2);white-space:nowrap}
.np-fld .input{flex:none;width:130px;height:32px;min-width:0;padding:0 10px}
/* 名称要比日期宽（「9月20日报单9月25日到货」这类名字装得下） */
.np-fld-name .input{width:210px}
/* v180 期次软警告（同名 / 窗口重叠）—— 非阻塞提示；硬规则由后端 period_validate 拦截 */
.np-hint-warn{font-size:12px;color:var(--warn-amber);background:rgba(245,158,11,.1);border-left:3px solid rgba(245,158,11,.5);border-radius:var(--radius-sm);padding:6px 9px;margin:8px 0 0;line-height:1.55}
.np-warn{margin:10px 0 0;padding-left:18px;font-size:var(--fs-sm);line-height:1.7;color:var(--war)}
/* v180 导入弹窗「本期归属」行 —— 归属由后端在导入那一刻定死，故必须前置展示 */
.imp-own{margin:0 0 12px;font-size:var(--fs-sm);line-height:1.7;color:var(--t2)}
.imp-own b{color:var(--t1)}
.imp-own.warn{color:var(--war)}
.imp-own.warn b{color:var(--war)}
.imp-own .btn{margin-left:6px;vertical-align:middle}
/* v180 改期次弹窗 */
.pe-modal{width:min(520px,94vw)}
.pc-shift{display:flex;align-items:center;gap:8px;margin:12px 0 10px;flex-wrap:wrap}
.pc-shift-lab{font-size:var(--fs-sm);color:var(--t2)}
.pc-shift-tip{font-size:var(--fs-sm);color:var(--t3)}
/* v184 空期次的表内引导行：表头保留（列与列右键可达），只替换表体 */
.empty-row td{background:transparent;border-bottom:none;padding:34px 16px!important;text-align:center}
.empty-row .er-t{font-size:14px;font-weight:600;color:var(--t1);margin-bottom:6px}
.empty-row .er-s{font-size:var(--fs-sm);color:var(--t3);line-height:1.7;margin-bottom:14px}
.empty-row .er-ic{width:48px;height:48px;border-radius:14px;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.empty-row .er-ic svg{width:24px;height:24px}
.empty-row .er-ops{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.pe-grid{display:grid;grid-template-columns:76px 1fr;gap:10px 12px;align-items:center}
.pe-grid label{font-size:var(--fs-sm);color:var(--t2)}
.draft-section{}
.search-row{display:flex;gap:8px;position:relative}
.search-dropdown{position:absolute;top:42px;left:0;right:60px;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-md);max-height:280px;overflow-y:auto;z-index:100}
.sd-item{padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px}
.sd-item:hover{background:var(--bg2)}
.sd-main{flex:1;min-width:0}
.sd-alias{flex-shrink:0}
/* v136 修复：别名弹窗同属模态层，与 .imp-* 同因（Teleport 到 body、祖先无 stacking context）
   → 一并提到 1125/1130，否则商品别名弹窗同样会被工具栏 .tb-pop 1120 遮挡。 */
.al-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:1125}
.al-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(400px,92vw);background:var(--bg);border-radius:var(--radius-lg);z-index:1130;box-shadow:var(--shadow-lg)}
.al-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle)}
.al-hd b{font-size:14px}
.al-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.al-x:hover{color:var(--p-dark);background:var(--bg2);border-radius:var(--radius-sm)}
.al-body{padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.al-tip{font-size:12px;color:var(--t2);line-height:1.6}
.al-input{width:100%;padding:10px;font-size:13px}
.al-current{font-size:12px;color:var(--t3)}
.al-ft{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border-subtle)}
.sd-name{font-size:13px;font-weight:500}
.sd-spec{font-size:12px;color:var(--t3);margin-left:6px}
.sd-meta{font-size:12px;color:var(--t3);margin-top:2px}
.sd-bc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.85}
.qty-input{width:72px;height:30px;padding:0 6px;border:1px solid var(--bd);border-radius:var(--radius-sm);text-align:right;background:var(--bg3);color:var(--t1)}
.btn-del{width:30px;height:30px;padding:0;border:none;background:none;border-radius:var(--radius-sm);color:var(--t2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.btn-del:hover{color:var(--dan);background:var(--dan-bg)}
.rebate-section{}
.sprint-card{}
.sprint-card.is-pinned{margin:14px 0 4px;border:1px solid var(--p);box-shadow:0 2px 12px rgba(6,182,212,.14);background:linear-gradient(180deg,color-mix(in srgb,var(--p) 6%,var(--bg2)) 0%,var(--bg2) 60px)}
.sprint-card.is-pinned .panel-hd{border-bottom:1px dashed var(--border-subtle);padding-bottom:10px;margin-bottom:0}
.tag.hot{background:var(--dan-bg);color:var(--dan);font-weight:600}
/* 决策横幅（A2）：一行承载「未达标数 / 总缺口 / 剩余到货机会 / 均单需报」，折叠与展开都常显 */
.sprint-banner{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:9px 16px;font-size:var(--fs-sm);line-height:1.5;color:var(--t2)}
.sprint-banner b{color:var(--t1);font-variant-numeric:tabular-nums}
/* 数值状态色复用既有 .val-warn / .val-ok（见本文件 L6799-6800），不另造色类；
   因 .sprint-banner b 优先级更高，需显式压过，故写成 b.val-warn */
.sprint-banner b.val-warn{color:var(--war)}
.sprint-banner .sep{color:var(--t3)}
/* 虚线挂到明细区自己这一侧（border-top）—— 它能随 v-show 一起隐藏。
   若改挂在 .sprint-banner 的 border-bottom 上，折叠时会留下一条悬空线。 */
.sprint-card .panel-body{padding-top:10px;border-top:1px dashed var(--border-subtle)}
/* 冲刺看板：行内时间进度（右对齐到页头行最右侧）+ 进度条上的时间进度虚线标记
   （虚线范式与仪表盘 .rr-bar-mark 一致：橙色 2px dashed，超出条形上下各 3px） */
.sprint-card .sprint-tp{margin-left:auto;margin-right:2px;font-size:var(--fs-sm);color:var(--t3);white-space:nowrap}
.sprint-card .sprint-tp b{color:var(--war);font-size:var(--fs-base);font-variant-numeric:tabular-nums}
.sp-bar{position:relative}
/* 仅冲刺面板加高到 12px：让时间进度虚线可读（实测行高 41px 由文字行盒决定，加高不改变行高）；
   仪表盘参照为 16px，此表更紧凑故取 12px。不波及「厂家返利」表（仍 6px） */
.sprint-card .progress{height:12px}
.sp-bar-mark{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed var(--war);z-index:2;pointer-events:none}
/* v181：进度「与时间进度对比」文案（v183 起内容改为「达成率 X%」）。
   ⚠️ v183 文案缩短后它**不再撑宽该列**：实测 1680px 下列宽 168px、文案自然宽仅 74px（占 44%）。
   （v181/182 的长文案 212px 曾把该列撑到 240px、其余各列各缩 ~7px；文案变短后该副作用消失。）
   ⚠️ table-layout:auto 会把该列宽度**下限**顶在 max(td 自带 min-width:110px, 文案 min-content) 上，
   给 td 设 max-width 是无效的（实测设 64px、列宽仍为 102.8px）⇒ 要复现「放不下」只能约束本元素自身宽度。
   放不下时用 visibility:hidden（不是 display:none）保留占位 —— 行高不跳动、显隐不引起表格重排。 */
.sprint-card .sp-pace{display:block;width:100%;margin-top:3px;font-size:var(--fs-sm);line-height:1.25;
  white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}
.sprint-card .sp-pace.is-hidden{visibility:hidden}
.sprint-card .sp-pace.pace-behind{color:var(--dan)}
.sprint-card .sp-pace.pace-ahead{color:var(--suc)}
.sprint-card .sp-pace.pace-even{color:var(--t3)}
/* 时间语义着色：达成未达时间进度=红，已超前=绿（复用全局 .progress>i 的绿/琥珀范式） */
.sprint-card .progress.red>i{background:var(--dan)}
.sprint-sum{margin:0 0 12px;font-size:13px;color:var(--t2);line-height:1.7}
.sprint-sum b{color:var(--t1)}
.sprint-sum .muted{color:var(--t3);font-size:var(--fs-sm)}
.sprint-suggest{margin-top:12px;font-size:13px;color:var(--t2);line-height:1.8}
.sprint-suggest ul{margin:6px 0 0;padding-left:18px}
.sprint-suggest li{margin:4px 0}
.sprint-prod{display:inline-block;margin:0 8px 0 4px;padding:1px 8px;background:var(--bg3);border-radius:var(--radius-md);font-size:12px;color:var(--t2)}
.sprint-prod-empty{margin-left:4px;padding:1px 8px;font-size:12px;color:var(--warn-amber);background:color-mix(in srgb,var(--warn-amber) 10%,transparent);border-radius:var(--radius-md)}
.val-ok{color:var(--suc)}
.val-warn{color:var(--war)}
.val-bad{color:var(--dan)}

/* 可销天数 */
.cover-days{font-weight:500;font-variant-numeric:tabular-nums}
.cover-danger{color:var(--dan)}
.cover-warn{color:var(--war)}
.cover-ok{color:var(--t2)}

/* 建议量「为什么」 */
.sug-cell{display:inline-flex;align-items:center;gap:4px;position:relative}
.why{display:inline-flex;align-items:center;color:var(--t3);cursor:help}
.why:hover{color:var(--p-dark)}
.why-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);width:230px;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-md);padding:11px 13px;z-index:60;font-size:12px;color:var(--t2);line-height:1.8;text-align:left;white-space:nowrap}
.why:hover .why-tip{display:block}
.why-formula{white-space:nowrap}
.why-result{color:var(--p-dark);font-weight:500;margin-top:3px;padding-top:3px;border-top:1px solid var(--border-subtle)}

@media(max-width:768px){
  .toolbar{padding:10px 12px;gap:6px}
  .toolbar>.tb-edit-group{gap:6px}
  .grid-ctl-row{gap:6px}
  .search-dropdown{right:0}
}

/* ---- 增强：校验/选区/口径/筛选/草稿 ---- */
/* v175：出错位置醒目化 —— 红框 + 红字加粗放大 + 浅红底（三重，保证「一眼定位」）。
   ⚠️ 数量列（.qty-cell）的底色/字色来自 heatStyle 的 inline style（热力色），
   inline 优先于类选择器 ⇒ 必须 !important，否则错误格会被热力色盖住看不出异常。
   错误语义高于热力语义：先让人看见「这里错了」，再看量级。 */
.cell-input.invalid, .qty-cell.invalid input, td.invalid input{border-color:var(--danger-txt) !important;box-shadow:inset 0 0 0 2px var(--danger-txt);background:var(--danger-bg) !important;color:var(--danger-txt) !important;font-weight:600;font-size:var(--fs-base)}
.cell-input.invalid, .cell-input:focus{border-color:var(--p)}
.range-sel{background:var(--p-bg) !important}
.cross-tbl.dragging, .cross-tbl.dragging *{user-select:none}
.fc-num.invalid, .fc-code.invalid, .fc-text.invalid{border-radius:var(--radius-sm)}
td.invalid, .qty-cell.invalid{background:var(--danger-bg) !important}
/* v219 打磨④：错误跳转/清单点击后目标格闪两下。
   ⚠️ 用 outline 而不是 background —— 背景色会跟「红框错误色 / 热力图底色 / 选区底色」
      抢同一块视觉（用户会分不清「这是刚跳到的格」还是「这格错了」）。outline 不占位、
      不影响布局，也不改背景。 */
td.flash, .qty-cell.flash{animation:cellFlash .45s ease-out 2}
@keyframes cellFlash{0%{outline:2px solid var(--p-dark);outline-offset:-2px}100%{outline-color:transparent}}
/* v219 打磨②：改动记录列表 */
.undo-list{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow-y:auto;margin:8px 0;border:1px solid var(--bd);border-radius:var(--radius-md)}
.undo-item{display:flex;align-items:center;gap:8px;padding:6px 8px;background:none;border:0;border-bottom:1px solid var(--bd);cursor:pointer;text-align:left;font-size:var(--fs-sm);color:var(--t1)}
.undo-item:last-child{border-bottom:0}
.undo-item:hover{background:var(--p-bg)}
.undo-idx{flex:0 0 28px;color:var(--t3);font-variant-numeric:tabular-nums;font-size:var(--fs-sm)}
.undo-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 行号格标红：长表里先看见「哪一行有问题」，再落到具体格 */
.td.seq-cell.row-bad{background:var(--danger-bg);color:var(--danger-txt);font-weight:600}
.td.seq-cell.row-bad .seq-num{color:var(--danger-txt)}
.basis-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--t2)}
/* 表格工具行的「仅显示有报单」开关。
   v169 规格对齐：它原先自成一派（12px/400/var(--bg3) 底/10px 内边距），与同行的
   品牌、复制报单（.btn .btn-sm .btn-ghost → 13px/500/透明底/12px 内边距）肉眼可见地
   不一致（字号与字重有粗细跳变）。此处改为与 .btn-sm.btn-ghost 逐属性同值，
   使整行三种控件只有一种文字规格。注意本行是页面 scoped 样式，覆盖的是全局
   .btn-sm 的同名视觉属性，改这里等于把这一个控件的规格「归队」。 */
.tb-toggle{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--t1);background:transparent;border:1px solid var(--bd);border-radius:var(--radius-sm);height:32px;padding:0 12px;white-space:nowrap;cursor:pointer;user-select:none;flex:0 0 auto}
.tb-toggle:hover{background:var(--bg2)}
.tb-toggle input{width:14px;height:14px;accent-color:var(--p);cursor:pointer}
.basis-toggle select{border:1px solid var(--bd);border-radius:var(--radius-sm);padding:2px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.filter-input{border:1px solid var(--bd);border-radius:var(--radius-sm);padding:4px 9px;font-size:12px;min-width:150px;background:var(--bg);color:var(--t1)}
.edit-summary{margin-top:8px;font-size:13px;color:var(--t2)}
.edit-summary b{color:var(--p-dark);font-size:15px}
.link-btn{border:none;background:none;color:var(--warn-amber);text-decoration:underline;cursor:pointer;font-size:12px;padding:0}

/* ---- P3-P4 增强样式 ---- */
.warn-low{background:var(--danger-bg) !important}
.warn-short{background:var(--sum-bg) !important}
/* v211（P1-3）：错误角标。**左上角是格内唯一空闲位** —— 右侧垂直中线被 .name-badges 占、
   右下角被 .fill-handle 占（拖拽填充要用手势起在那里）。触屏点它即弹原因（td 的 title 要悬停，触屏没有）。
   ⚠️ z-index 取 5：**必须低于粘性列（.seq-cell / .frozen 都是 6）** ——
      否则横向滚动时，被冻结列盖住的那半张表上的角标会浮出来「飘在冻结列上面」。
   ⚠️ 尺寸压到 13×11、图标 9px：格子本身只有约 26px 高，再大就会压住输入文字的首字符。 */
.cell-err-dot{position:absolute;left:0;top:0;width:13px;height:11px;display:flex;align-items:center;justify-content:center;background:var(--danger-bg);color:var(--danger-txt);border-bottom-right-radius:6px;cursor:pointer;z-index:5;line-height:1}
.cell-err-dot svg.ico{width:9px;height:9px;vertical-align:top;margin:0}
/* v212（P2-2）：软警告角标（黄=疑）—— 与红角标**同形不同角**，靠颜色深浅分两档。
   位置：**右上角**（红在左上、填充柄在右下、左下留给行号格的红条，四角不打架）。
   ⚠️ `z-index:5` 必须 < 6：`.seq-cell` / `.frozen` 的粘性列是 6 ⇒ 高了会浮在冻结列上面。
   两档配色刻意都用「--sev-warn」这一支（黄系）：
     · soft-miss（疑漏订，**少报=少赚**，业务上更痛）→ 实心琥珀、更醒目
     · soft-over（疑超放量，占库存/压资金）→ 浅琥珀描边感、次要
   ⚠️ 实心那档的**文字色用 `var(--bg)`**（浅色主题=白、深色主题=近黑）：
      写死 #fff 在深色主题下是「浅琥珀底 + 白字」→ 几乎看不见（对比度 < 2:1）。 */
.cell-soft-dot{position:absolute;right:0;top:0;width:13px;height:11px;display:flex;align-items:center;justify-content:center;border-bottom-left-radius:6px;cursor:pointer;z-index:5;line-height:1}
.cell-soft-dot svg.ico{width:9px;height:9px;vertical-align:top;margin:0}
.cell-soft-dot.soft-miss{background:var(--sev-warn);color:var(--bg)}
.cell-soft-dot.soft-over{background:var(--sev-warn-bg);color:var(--sev-warn)}
.name-badges{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:2px;pointer-events:none}
.name-badges>span{margin-left:0;pointer-events:auto}
.warn-badge{display:inline-block;margin-left:3px;font-size:11px;color:var(--danger-txt);vertical-align:middle}
.warn-badge.short{color:var(--warn-amber)}
.diff-chg{outline:2px solid var(--p);outline-offset:-2px}
.mini-btn{margin-left:4px;font-size:11px;padding:1px 6px;border:1px solid var(--p);color:var(--p-dark);background:transparent;border-radius:var(--radius-sm);cursor:pointer}
.mini-btn:disabled{opacity:.4;cursor:default}
.suggest{color:var(--p-dark);font-weight:500}
.delta.up{color:var(--suc)}
.delta.down{color:var(--danger-txt)}
.spark-td{text-align:center}
.spark-td .muted{color:var(--t3);font-size:11px}
.foot-row td{background:var(--bg3);font-weight:500;border-top:2px solid var(--bd)}
.foot-row td.frozen{background:var(--bg3);z-index:6}
.grp-btn{font-size:12px;padding:5px 12px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg2);color:var(--t1);cursor:pointer;white-space:nowrap}
.grp-btn:hover{border-color:var(--p)}
.grp-btn.on{background:var(--p);color:#fff;border-color:var(--p)}
.grp-btn.danger{color:var(--dan);border-color:rgba(var(--dan-rgb),.4)}
.grp-btn.danger:hover{border-color:var(--dan)}
.grp-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:var(--bg2);border:0.5px solid var(--bd);border-radius:var(--radius-md)}
.batch-panel{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:8px;font-size:12px}
.batch-val{width:84px;border:1px solid var(--bd);border-radius:var(--radius-sm);padding:4px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.snap-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:12px}
.recipe-panel{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;font-size:12px}
.recipe-panel>span{display:inline-flex;align-items:center;gap:4px;color:var(--t2)}
.recipe-val{width:64px;border:1px solid var(--bd);border-radius:var(--radius-sm);padding:3px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.loss-badge{cursor:help;font-size:11px;margin-left:2px}
.loss-badge.risk{color:var(--sev-risk)}
.loss-badge.watch{color:var(--sev-warn)}
.note-badge{cursor:pointer;font-size:11px;margin-left:2px;opacity:.65}
.note-badge:hover{opacity:1}
.moq-below{background:var(--sev-risk-bg);color:var(--sev-risk);font-weight:500}
.info-panel{margin-top:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;font-size:12px}
.info-panel .panel-hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.info-panel .imp-x{margin-left:auto;border:none;background:none;cursor:pointer;color:var(--t2);font-size:14px;line-height:1}
/* v174：查错结果面板 —— 上排是「按原因分组」的总览（点一下只看该类），
   下面是逐条明细，每条自带「第几行 · 商品 · 列」，点一条跳到那一格。 */
.err-grps{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px}
.err-grp{border:1px solid var(--bd);background:var(--bg);color:var(--t2);border-radius:999px;padding:2px 9px;font-size:12px;line-height:1.7;cursor:pointer}
.err-grp:hover{border-color:var(--p);color:var(--t1)}
.err-grp.on{border-color:var(--p);background:var(--p-bg);color:var(--p-deep);font-weight:600}
.err-list-wrap{max-height:240px;overflow:auto}
.err-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
.err-list li{display:flex;gap:10px;align-items:baseline;padding:3px 8px;border-radius:var(--radius-sm);cursor:pointer;line-height:1.7}
.err-list li:hover{background:color-mix(in srgb,var(--p) 12%,transparent)}
/* 位置列封顶 + 省略号：客户名/商品名可能很长，不封会把面板撑出横向滚动条 */
.err-loc{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)}
.err-why{color:var(--danger-txt);font-weight:600}
.err-more{margin-top:6px;color:var(--t2)}
/* v219 打磨⑤：查错面板的一键修复条 + 修复预览弹窗 */
.err-fixbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px}
.err-fixhint{font-size:12px;color:var(--t2);line-height:1.6}
.fix-mask{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px}
.fix-dlg{width:min(720px,94vw);max-height:86vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);overflow:hidden}
.fix-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--bd);font-size:var(--fs-base)}
.fix-tip{margin:0;padding:10px 16px;font-size:var(--fs-sm);color:var(--t2);line-height:1.7;background:var(--bg2)}
.fix-list-wrap{flex:1 1 auto;overflow:auto;padding:6px 10px}
.fix-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
.fix-list li{display:flex;gap:10px;align-items:baseline;padding:5px 8px;border-radius:var(--radius-sm);line-height:1.7;font-size:var(--fs-sm)}
.fix-list li:nth-child(odd){background:var(--bg2)}
.fix-loc{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)}
.fix-chg{flex:none;font-variant-numeric:tabular-nums}
.fix-old{color:var(--t3)}
.fix-new{color:var(--p-deep)}
.fix-how{flex:1 1 auto;color:var(--t2);font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fix-ft{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--bd)}
.fix-rest{flex:1 1 auto;font-size:12px;color:var(--dan)}
.fix-ft .btn:first-of-type{margin-left:auto}
/* v219 打磨⑥：数量上限入口与编辑弹窗 */
.err-rulebtn{margin-left:auto;border:1px dashed var(--bd);background:none;color:var(--t2);border-radius:999px;padding:2px 9px;font-size:12px;line-height:1.7;cursor:pointer;white-space:nowrap}
.err-rulebtn:hover{border-color:var(--p);color:var(--p-deep)}
.rule-dlg{width:min(420px,94vw)}
.rule-body{padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.rule-label{font-size:var(--fs-sm);color:var(--t2)}
.rule-input{border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);padding:6px 10px;font-size:13px;font-variant-numeric:tabular-nums;outline:none}
.rule-input:focus{border-color:var(--p)}
.rule-hint{font-size:12px;color:var(--t2)}
.err-empty{color:var(--t2)}
.push-list,.health-list{margin:0;padding-left:18px;line-height:1.8}
.health-list li{cursor:pointer;display:flex;align-items:center;gap:6px}
.health-list li:hover{text-decoration:underline}
.sev-risk{color:var(--sev-risk)}.sev-warn{color:var(--sev-warn)}.sev-info{color:var(--sev-info)}
.sev-dot{width:7px;height:7px;border-radius:50%;flex:none;display:inline-block}
.sev-risk .sev-dot{background:var(--sev-risk)}.sev-warn .sev-dot{background:var(--sev-warn)}.sev-info .sev-dot{background:var(--sev-info)}
/* v166 修改日志面板：已从编辑态网格区搬到工具栏正下方，成为 .page 的直属元素（不再是卡片内
   的次级面板），故按 .card 的外观给（白底 / 同半径 / 同边框），免得与其它卡片割裂。 */
.audit-log-panel{margin:0 0 14px;padding:14px 16px;background:var(--bg);border:1px solid var(--border-subtle);border-radius:var(--radius-lg)}
/* 后端每期最多留 200 条 → 列表内部滚动，别把汇总表整张顶出屏幕 */
.audit-log-panel .at-log{max-height:300px;overflow:auto;padding-right:4px}
/* v166 修改日志：每条是「时间 · 修改人 · 动作 · 明细」，文字长需换行，故不复用 .health-list
   的「单行 flex 且 hover 下划线」范式——那里隐含着"这一条可以点"，而留痕条只是展示。 */
.at-log li{cursor:default;display:block;line-height:1.9}
.at-log li:hover{text-decoration:none}
.at-log .sev-dot{margin-right:6px;vertical-align:middle}
.at-time{color:var(--t3);font-variant-numeric:tabular-nums}
.at-who{color:var(--t1)}
.at-act{color:var(--t2)}
.at-global{margin-top:8px;border-top:1px dashed var(--bd);padding-top:8px}
.at-global-hd{display:flex;align-items:center;gap:6px;border:none;background:none;cursor:pointer;color:var(--t2);font-size:12px;padding:0;margin-bottom:4px}
.at-global-hd:hover{color:var(--t1)}
.pager{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:12px}
.pager-info{color:var(--t2)}
/* P8/P9/P10 新增强样式 */
.panel-sep{width:1px;height:18px;background:var(--bd);margin:0 2px;display:inline-block}
.rt-badge{cursor:help;font-size:11px;margin-left:2px}
.rt-badge.stockout{color:var(--sev-risk)}.rt-badge.low{color:var(--sev-warn)}.rt-badge.expiry{color:var(--sev-info)}.rt-badge.expired{color:var(--sev-expired)}
.book-area{width:100%;box-sizing:border-box;font-family:inherit;font-size:12px;line-height:1.6;padding:8px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);resize:vertical;margin-top:4px}
.acc-tbl{margin-top:6px;font-size:12px}
.acc-tbl td.num,.acc-tbl th.num{text-align:right}
.sub-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.tag.st-draft{background:var(--st-draft-bg);color:var(--st-draft-txt)}.tag.st-submitted{background:var(--st-submitted-bg);color:var(--st-submitted-txt)}
.tag.st-approved{background:var(--st-approved-bg);color:var(--st-approved-txt)}.tag.st-rejected{background:var(--st-rejected-bg);color:var(--st-rejected-txt)}.tag.st-revised{background:var(--st-revised-bg);color:var(--st-revised-txt)}
.tmpl-form{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.tmpl-form .input{width:auto;flex:1;min-width:120px}
.bi-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:6px}
.bi-card{background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-sm);padding:10px;text-align:center}
.bi-num{font-size:20px;font-weight:600;color:var(--p)}
.bi-num.warn{color:var(--sev-risk)}
.bi-lbl{font-size:11px;color:var(--t2);margin-top:2px}
/* P11-P13 第四轮增强样式 */
.gap-badge{cursor:help;font-size:11px;margin-left:2px}
.gap-form{display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap}
.rolling-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.rolling-chips .on{background:var(--p);color:#fff;border-color:var(--p)}
.var-cat{margin-top:8px;border-top:1px dashed var(--bd);padding-top:6px}
.var-cat-hd{font-size:12px;font-weight:600;color:var(--t1);margin-bottom:4px}
.nl-row{display:flex;gap:8px;align-items:center;margin-top:6px}
.tag.ok{background:var(--ok-green-bg);color:var(--ok-green)}
.tag.info{background:var(--info-blue-bg);color:var(--info-blue)}
.tag.warn{background:var(--warn-amber-bg);color:var(--warn-amber)}
/* P14-P16 第五轮增强样式 */
.hs-badge{cursor:help;font-size:11px;margin-left:2px;color:var(--info-blue)}
.mini-form{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.mini-form .input{flex:1;min-width:90px}
.mini-msg{margin-top:6px;font-size:12px;color:var(--ok-green)}
.heal-row{border:1px solid var(--bd);border-radius:var(--radius-sm);padding:8px 10px;margin-top:8px;background:var(--bg)}
.heal-row.risk{border-left:3px solid var(--sev-risk)}
.heal-row.warn{border-left:3px solid var(--sev-warn)}
@media print{
  body *{visibility:hidden}
  .table-wrap,.table-wrap *{visibility:visible}
  .table-wrap{position:absolute;left:0;top:0;width:100%;overflow:visible}
  .edit-tbl{width:100%}
  .batch-panel,.snap-bar,.edit-hint,.col-config-bar,.draft-banner,.ctx-menu,.ctx-overlay,.sel-stat{display:none !important}
}
/* Q9：编辑态新增行标识（左侧品牌色竖条 + 轻微底色，保存后随 _new 清除） */
.cross-tbl.edit-tbl tbody tr.new-row > td,
.edit-tbl tbody tr.new-row > td{box-shadow:inset 3px 0 0 var(--p);background:color-mix(in srgb,var(--p) 9%,var(--bg))}
.cross-tbl.edit-tbl tbody tr.new-row:hover > td,
.edit-tbl tbody tr.new-row:hover > td{background:color-mix(in srgb,var(--p) 14%,var(--bg))}
/* Q14：草稿恢复范围说明条 */
.draft-banner{margin:6px 0;padding:6px 10px;border-radius:var(--radius-sm);background:color-mix(in srgb,var(--war) 14%,var(--bg));color:var(--t1);font-size:12px;line-height:1.6}
.draft-banner .link-btn{margin-left:4px}
/* Q26/Q27：保存失败分流条 + 重试入口 */
.save-fail-banner{margin:6px 0;padding:6px 10px;border-radius:var(--radius-sm);background:color-mix(in srgb,var(--dan) 14%,var(--bg));color:var(--t1);font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.save-fail-banner .sf-partial{color:var(--war);font-weight:600}
.save-fail-banner .sf-msg{color:var(--t2)}
.save-fail-banner .sf-time{color:var(--t2);opacity:.7}
/* Q28：快捷键说明面板 */
.kbd-help{margin-top:6px}
.kbd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 18px;padding:8px 12px;background:var(--bg2);border-radius:8px;font-size:12px;color:var(--t2);line-height:1.9}
.kbd-grid kbd{display:inline-block;padding:0 5px;border:1px solid var(--border);border-bottom-width:2px;border-radius:4px;background:var(--bg);font-family:var(--mono,ui-monospace,monospace);font-size:11px;color:var(--t1)}

.panel-hd svg.ico{width:16px;height:16px;vertical-align:-3px;margin-right:5px}
.sprint-card.is-pinned .panel-hd svg.ico{vertical-align:-3px}
/* ---- emoji → Icon 组件后的尺寸/对齐统一（设计规范：只用线性 SVG，不用 emoji） ---- */
.ico{vertical-align:middle}
.btn svg.ico{width:14px;height:14px;vertical-align:-2px;margin-right:4px}
.btn-primary svg.ico,.btn-ghost svg.ico{vertical-align:-2px}
.rop svg.ico{width:14px;height:14px;vertical-align:middle}
.grp-toggle svg.ico,.exp-chev svg.ico{width:14px;height:14px;vertical-align:middle}
.name-badges svg.ico{width:12px;height:12px;vertical-align:middle;margin-left:2px}
.filter-chip .chip-x svg.ico{width:12px;height:12px;vertical-align:middle}
.col-menu-hd svg.ico{width:13px;height:13px;vertical-align:-2px}
.empty-ico svg.ico{width:40px;height:40px;opacity:.35}
.ctx-menu button svg.ico{width:14px;height:14px;vertical-align:-2px;margin-right:6px}
.link-btn svg.ico{width:14px;height:14px;vertical-align:-2px}
/* v215 商品名候选面板 —— 配色/圆角/阴影沿用 `.ctx-menu`（同一套浮层观感）。
   🔴 z-index 取 1101+：与 `.tb-pop-panel` 同级但更高，保证盖在工具栏浮层之上；
      又远低于全屏遮罩层（950 那条是表格内的），不会压住真正的模态。
   ⚠️ `position:fixed` + Teleport to body：表格有 overflow 容器与 sticky 表头，
      浮层留在单元格里会被裁掉。 */
.name-sug-pop{position:fixed;z-index:1150;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:4px;max-height:220px;overflow-y:auto;font-size:var(--fs-sm)}
.ns-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap}
.ns-item.on{background:var(--p-bg);color:var(--p-dark)}
.ns-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.ns-spec{flex:0 0 auto;color:var(--t3);font-size:var(--fs-sm)}
.ns-code{flex:0 0 auto;color:var(--t3);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
.st-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dan);margin-right:5px;vertical-align:middle}
.sort-ind svg.ico{width:12px;height:12px;vertical-align:middle;margin-left:3px}
.zb-btn svg.ico{width:14px;height:14px;vertical-align:middle}
/* 品牌筛选下拉 + 期次复制弹窗 */
.brand-pop{min-width:240px;max-height:62vh;overflow:auto}
.brand-pop .bp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;color:var(--t1)}
.brand-pop .bp-acts{display:flex;gap:6px}
.brand-pop .bp-list{display:flex;flex-direction:column;gap:4px;max-height:42vh;overflow:auto;padding:2px 0}
.brand-pop .bp-item{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);cursor:pointer;padding:2px 2px}
.brand-pop .bp-item:hover{background:var(--bg2)}
.brand-pop .bp-empty{color:var(--t3);font-size:12px;margin:4px 0}
.brand-pop .bp-tip{font-size:12px;color:var(--t3);margin:0;line-height:1.5}
/* v170：工具行「新增客户」弹层（承接表头撤下的那一格；外壳复用 .tb-pop-panel）
   ⚠️ max-width 必写：.tb-pop-panel 是 flex column 的 shrink-to-fit，缺它时长 tip 的
   max-content 会把面板撑到 700px+（真机实测 707.7px，而旁边的品牌面板只有 240px）。 */
.addcol-pop{min-width:264px;max-width:320px}
.addcol-pop .ac-head{font-weight:600;color:var(--t1);font-size:13px}
.addcol-pop .ac-row{display:flex;gap:6px;align-items:center}
.addcol-pop .ac-input{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg3);color:var(--t1);font-size:13px;font-family:inherit}
.addcol-pop .ac-input:focus{outline:none;border-color:var(--p);background:var(--bg)}
.addcol-pop .ac-tip{font-size:12px;color:var(--t3);margin:0;line-height:1.5}
.copy-pop{min-width:246px;max-width:320px}
.copy-pop .cp-title{font-weight:600;color:var(--t1);font-size:13px}
.copy-pop .cp-title-sub{font-weight:400;color:var(--t3);font-size:12px}
.copy-pop .cp-tip{font-size:12px;color:var(--t3);margin:2px 0 0;line-height:1.5}
.copy-pop .cp-tip.ok{color:var(--t2);margin-top:6px}
.copy-pop .cp-tip.ok b{color:var(--p-dark)}
.copy-pop .cp-unit-btns{display:flex;gap:6px;margin-top:8px}
.copy-pop .cp-act{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:4px 6px}
.copy-pop .cp-act:disabled{opacity:.45;cursor:not-allowed}
.copy-pop .cp-empty{font-size:12px;color:var(--t3);margin:8px 0 0;text-align:center}
</style>

