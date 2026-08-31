<template>
  <div class="page">
    <!-- 模块级标签页：本期预报 / 历史预报 -->
    <div class="module-tabs">
      <button :class="{ on: activeTab === 'summary' }" @click="activeTab = 'summary'">本期预报</button>
      <button :class="{ on: activeTab === 'history' }" @click="activeTab = 'history'">历史预报</button>
      <button :class="{ on: activeTab === 'config' }" @click="activeTab = 'config'">报单配置</button>
    </div>

    <template v-if="activeTab === 'summary'">
    <!-- 报单期次选择 -->
    <div class="card toolbar">
      <div class="tb-group">
        <select v-model="curPeriod" class="input sel-period" @change="onPeriodChange">
          <option value="0">— 选择期次 —</option>
          <option v-for="p in periods" :key="p.id" :value="p.id">{{ p.name }}（{{ p.order_start }} ~ {{ p.order_end }}）</option>
        </select>
        <button v-if="currentPeriod && currentPeriod.status === 'open'" class="btn btn-sm btn-ghost" @click="askClose(currentPeriod)" title="关闭当前期次（关闭后不可再编辑，仅可删除）">关闭期次</button>
        <button v-if="currentPeriod && currentPeriod.status === 'closed'" class="btn btn-sm btn-ghost danger" @click="askDelete(currentPeriod)" title="删除当前期次（仅已关闭期次可删）">删除期次</button>
        <button class="btn btn-sm btn-ghost" @click="openNewPeriod"><Icon name="plus"/> 新建期次</button>
      </div>
      <div class="tb-group tb-right">
        <div class="tb-search">
          <Icon name="search"/>
          <input id="gridFind" v-model="findText" @keydown="onFindKey" class="fld" placeholder="搜索商品名…" aria-label="筛选商品名">
        </div>
        <label class="tb-toggle"><input type="checkbox" v-model="hideZeroReport"> 仅显示有报单</label>
        <span class="tb-sep"></span>
        <button class="btn btn-sm btn-ghost" @click="openImport"><Icon name="import"/> 导入</button>
        <span class="tb-sep"></span>
        <button v-if="!editMode" class="btn btn-sm btn-ghost" @click="enterEdit"><Icon name="edit"/> 编辑</button>
        <button v-if="editMode" class="btn btn-sm btn-ghost" @click="exitEdit">取消</button>
        <button v-if="editMode" class="btn btn-sm btn-primary" @click="saveEdits">{{ savingEdit ? '保存中…' : '保存' }}</button>
        <span class="tb-sep"></span>
        <button class="btn btn-sm btn-primary" :disabled="!cross.period" @click="onSuggest">智能建议</button>
        <span class="tb-sep"></span>
        <!-- 表格设置：只读视图的网格显示选项（分组/冻结/单价口径/显示AI建议） -->
        <div v-if="!editMode" class="tb-pop">
          <button ref="settingsBtn" class="btn btn-sm btn-ghost" :class="{on:tbSettingsOpen}" @click="toggleTbPop('settings')"><Icon name="settings"/> 表格设置 ▾</button>
          <Teleport to="body">
          <div v-if="tbSettingsOpen" class="tb-pop-panel" :style="popStyle" @click.stop>
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
            <label class="basis-toggle">单价口径
              <select v-model="priceBasis" aria-label="单价口径">
                <option value="dist">分销价</option>
                <option value="sale">标准售价</option>
              </select>
            </label>
            <label class="basis-toggle"><input type="checkbox" v-model="showSuggest"> 显示AI建议</label>
          </div>
          </Teleport>
        </div>
        <!-- 编辑态：高级工具（审批/推送/打印 + 数据质量/销量预测/协同闭环/更多工具） -->
        <div v-if="editMode" class="tb-pop">
          <button ref="advBtn" class="btn btn-sm btn-ghost" :class="{on:advToolsOpen}" @click="toggleTbPop('adv')">高级 ▾</button>
          <Teleport to="body">
          <div v-if="advToolsOpen" class="tb-pop-panel" :style="popStyle" @click.stop>
            <button class="grp-btn" @click="subOpen=!subOpen"><Icon name="approve"/> 审批流</button>
            <button class="grp-btn" @click="pushForecast" :disabled="pushing"><Icon name="upload"/> 推送企微审批</button>
            <button class="grp-btn" @click="printGrid"><Icon name="print"/> 打印/PDF</button>
            <div class="tb-pop-sep"></div>
            <button class="grp-btn" :class="{on:openGroup==='quality'}" @click="openGroup=openGroup==='quality'?null:'quality'">数据质量</button>
            <button class="grp-btn" :class="{on:openGroup==='smart'}" @click="openGroup=openGroup==='smart'?null:'smart'">销量预测</button>
            <button class="grp-btn" :class="{on:openGroup==='collab'}" @click="openGroup=openGroup==='collab'?null:'collab'">协同闭环</button>
            <button class="grp-btn" :class="{on:openGroup==='more'}" @click="openGroup=openGroup==='more'?null:'more'">更多工具</button>
          </div>
          </Teleport>
        </div>
      </div>
      <div class="tb-status-row">
        <span v-if="confirmInfo" class="confirm-badge ok"><Icon name="check" /> 已确认{{ confirmInfo.by ? ' · ' + confirmInfo.by : '' }}</span>
        <span v-else class="confirm-badge draft">草稿 · 待经理确认</span>
        <span v-if="hideZeroReport" class="confirm-badge filter"><Icon name="filter" /> 已隐藏 {{ zeroReportCount }} 个零报单</span>
      </div>
      <div v-if="(tbSettingsOpen && !editMode) || (advToolsOpen && editMode)" class="pop-overlay" @click="tbSettingsOpen=false; advToolsOpen=false"></div>
    </div>

    <!-- 新建期次表单（紧贴工具条，随时可点，不依赖视图） -->
    <div v-if="showNewPeriod" class="card new-period">
      <div class="np-row">
        <input v-model="np.name" class="input" placeholder="期次名称（如 8月25日报单-8月29日到货）" @input="onPeriodNameInput">
        <input v-model="np.order_start" class="input" type="date" placeholder="下单开始">
        <input v-model="np.order_end" class="input" type="date" placeholder="下单截止">
        <input v-model="np.arrival" class="input" type="date" placeholder="预计到货">
        <button class="btn btn-primary" @click="createPeriod">创建</button>
      </div>
    </div>

    <input ref="impFileInput" type="file" accept=".xlsx,.xls" style="display:none" @change="onImportFile">

    <Teleport to="body">
      <Transition name="fade"><div v-if="impOpen" class="imp-overlay" @click="impOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="impOpen" class="imp-modal">
          <div class="imp-hd"><b>导入预报订单 Excel</b><button class="imp-x" @click="impOpen = false"><Icon name="close"/></button></div>
          <div v-if="!impState" class="imp-body">
            <p class="imp-tip">选择你现有的订单汇总表（行=商品、列=客户、格=数量）。系统自动识别商品列与客户列，导入后即汇总进交叉表。</p>
            <div class="imp-actions">
              <button class="btn btn-ghost" @click="downloadFcTemplate"><Icon name="download"/> 下载模板</button>
              <button class="btn btn-primary" @click="pickFile">选择文件…</button>
            </div>
            <p v-if="impFileName" class="imp-file">已选择：{{ impFileName }}</p>
          </div>
          <div v-else-if="impState === 'preview'" class="imp-body">
            <div v-if="impCross" class="imp-ident">
              <div class="imp-ident-row"><span>商品名称列</span><b>{{ impCross.identity.name != null ? impHeaders[impCross.identity.name] : '（未识别）' }}</b></div>
              <div class="imp-ident-row"><span>条码列</span><b>{{ impCross.identity.barcode != null ? impHeaders[impCross.identity.barcode] : '（未识别）' }}</b></div>
              <div class="imp-ident-row"><span>单价列</span><b>{{ impCross.identity.price != null ? impHeaders[impCross.identity.price] : '（未识别）' }}</b></div>
              <div class="imp-ident-row"><span>客户列（{{ impCross.customers.length }} 个）</span><b class="imp-customers">{{ impCross.customers.map(c => c.name).join('、') }}</b></div>
            </div>
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
            <p v-if="impResult && !(impResult.results?.errors || []).length" class="imp-ok">导入成功：{{ impResult.results?.success || 0 }} 个客户</p>
            <div v-else>
              <p class="imp-warn">导入完成，但有 {{ impResult?.results?.errors?.length || 0 }} 处异常：</p>
              <ul class="imp-errs"><li v-for="(e, i) in (impResult?.results?.errors || []).slice(0, 8)" :key="i">{{ e.msg }}</li></ul>
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
              <div class="pf-item"><span>到货天数</span><b>{{ fmt(prodProfile.lead_days) }}</b></div>
              <div class="pf-item"><span>保质期天</span><b>{{ fmt(prodProfile.expiry_days) }}</b></div>
              <div class="pf-item"><span>标准售价</span><b>{{ prodProfile.sale_price != null ? fmt(prodProfile.sale_price) : '—' }}</b></div>
              <div class="pf-item"><span>进价</span><b>{{ prodProfile.purchase_price != null ? fmt(prodProfile.purchase_price) : '—' }}</b></div>
              <div class="pf-item"><span>分销价</span><b>{{ prodProfile.dist_price != null ? fmt(prodProfile.dist_price) : '—' }}</b></div>
              <div class="pf-item"><span>数据健康分</span><b :class="healthClass(prodProfile.product_id)">{{ hsMap[prodProfile.product_id] != null ? hsMap[prodProfile.product_id] : '—' }}</b></div>
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
              <b>⚠ 当前未连接 ERP（畅捷通 / 金蝶）。</b>本功能的智能建议需以实时库存与销量为依据；未连接时建议量缺少数据支撑、仅供参考。你可手动核对报单量后直接「确认定稿」，或前往 <button class="link-btn" @click="goConnect">能力中心</button> 连接 ERP，建议才会准确。
            </div>
            <p v-if="auditState === 'loading'" class="imp-tip">正在按「日均销量 × 覆盖天数 − 当前库存」逐 SKU 计算建议量…</p>
            <template v-else-if="auditState === 'done'">
              <p v-if="auditData?.rebate_hint" class="imp-ok">{{ auditData.rebate_hint }}</p>
              <div class="audit-sum">
                <span>{{ auditData.summary?.sku_count || 0 }} 个 SKU</span>
                <span>预报 <b>{{ fmt(auditData.summary?.total_requested) }}</b> 件</span>
                <span>AI 建议 <b class="audit-sug">{{ fmt(auditData.summary?.total_suggested) }}</b> 件</span>
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
                      <td class="num"><input v-if="a.final_qty != null" v-model.number="a.final_qty" class="qty-input" type="number" min="0"><span v-else class="hint">—</span></td>
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

    <!-- 本期预报子视图切换：导入汇总（交叉表）/ 草稿填报（搜索商品加入草稿） -->
    <div class="view-seg" v-if="!editMode">
      <button :class="{ on: viewMode === 'cross' }" @click="switchView('cross')">导入汇总</button>
      <button :class="{ on: viewMode === 'list' }" @click="switchView('list')">草稿填报</button>
    </div>

    <!-- 交叉表视图（P0-1）：行=商品 × 列=报单单元（透视小程序报单 sources） -->
    <div v-if="viewMode === 'cross'" class="cross-area">
      <div v-if="cross.period" class="sop">
        <b>SOP · {{ cross.period.name }}</b>
        <span class="sep">│</span>
        <span>下单 {{ cross.period.order_start }} ~ {{ cross.period.order_end }}</span>
        <span class="sep">│</span>
        <span>预计到货 {{ cross.period.arrival_date || cross.period.arrival || '—' }}</span>
        <span class="sep">│</span>
        <span>报单单元自动汇总 · 到货前 1 天 AI 副驾自动生成导入模板</span>
      </div>
      <div class="card cross-card">
        <!-- 列配置条 -->
          <div class="col-config-bar">
            <div v-if="showColMenu && !editMode" class="col-menu-overlay" @click="showColMenu=false"></div>
            <div v-if="showColMenu && !editMode" class="col-menu" @click.stop>
              <div class="col-menu-hd"><span>显示列（拖拽排序，✓ 显示）</span><button class="col-menu-x" @click="showColMenu=false" title="关闭"><Icon name="close"/></button></div>
              <ul class="col-menu-list">
                <li v-for="(c, ci) in colOrder" :key="c.key" v-if="canSeeCol(c.key)" :class="{ locked: c.fixed, hidden: colVis[c.key] === false }" :draggable="!c.fixed" @dragstart="onColDragStart(ci)" @dragover.prevent @drop="onColDrop(ci)">
                  <span class="drag">⠿</span>
                  <label><input type="checkbox" :checked="colVis[c.key] !== false" :disabled="c.fixed" @click.prevent="toggleCol(c.key)"> {{ c.label }}</label>
                  <button v-if="!c.fixed && c.deletable" class="col-menu-del" @click="deleteMasterCol(c.key)" title="删除该列"><Icon name="close"/></button>
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
                <button class="btn btn-ghost btn-xs" :disabled="!schemeName" @click="delScheme(schemeName)" title="删除所选方案">删除</button>
              </div>
            </div>
          </div>

        <!-- 表体：加载态 / 空态 / 汇总表（虚拟滚动+分组+展开+行操作+键盘a11y） -->
        <div v-if="crossLoading" class="tbl-state tbl-skeleton" aria-busy="true" aria-label="数据加载中">
          <div class="sk-row" v-for="n in 8" :key="n"><span class="sk-bar" v-for="m in 6" :key="m"></span></div>
        </div>
        <div v-else-if="!editMode && (!cross.rows.length || !cross.rows.some(r => !r._deleted))" class="tbl-state tbl-empty">
          <div class="empty-ico">📭</div>
          <div class="empty-t">暂无预报数据</div>
          <div class="empty-s">当前期次没有报单记录，可在编辑模式补录商品，或刷新重新载入</div>
          <div class="empty-ops">
              <button class="btn btn-primary btn-sm" @click="editMode = true; addRow()"><Icon name="plus"/> 编辑补录商品</button>
              <button class="btn btn-ghost btn-sm" @click="loadCross()"><Icon name="refresh"/> 刷新</button>
          </div>
        </div>
        <div v-else-if="!editMode" class="grid-area" :class="{ 'is-fs': gridFullscreen }">
          <div class="grid-ctl-row">
            <div class="zoom-group">
              <span class="zb-label">缩放</span>
              <button class="zb-btn" type="button" :disabled="gridZoom<=50" @click="zoomOut" title="缩小" aria-label="缩小">－</button>
              <input class="zb-range" type="range" min="50" max="200" step="10" v-model.number="gridZoom" aria-label="缩放比例">
              <span class="zb-val">{{ gridZoom }}%</span>
              <button class="zb-btn" type="button" :disabled="gridZoom>=200" @click="zoomIn" title="放大" aria-label="放大">＋</button>
              <button class="zb-btn zb-reset" type="button" :disabled="gridZoom===100" @click="zoomReset" title="重置 100%" aria-label="重置缩放">⟲</button>
            </div>
          </div>
          <button class="grid-fs-btn" :title="gridFullscreen ? '退出全屏' : '全屏'" @click="toggleGridFullscreen" aria-label="表体全屏切换">
            <Icon name="fullscreen" size="16"/>
          </button>
          <div class="filter-row" v-if="colFilter || colFilterSet">
            <span v-if="colFilter" class="filter-chip" :title="'按「' + colLabel(colFilter.key, colFilter.type, colFilter.ui) + '」筛选'">筛选「{{ colLabel(colFilter.key, colFilter.type, colFilter.ui) }}」={{ colFilter.val }} <button class="chip-x" @click="clearColFilter" aria-label="清除列筛选">✕</button></span>
            <span v-if="colFilterSet" class="filter-chip" :title="'按「' + colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) + '」唯一值筛选'">筛选「{{ colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) }}」∈ {{ colFilterSet.values.length }} 值 <button class="chip-x" @click="clearUniqFilter" aria-label="清除唯一值筛选">✕</button></span>
          </div>
          <div class="table-wrap cross-viewport" ref="scrollEl" @scroll="onScroll">
            <table class="tbl cross-tbl" role="grid" :aria-rowcount="flatItems.length" :aria-colcount="colOrderList.length" :style="{ zoom: gridZoom + '%' }">
            <colgroup>
              <col v-for="col in colOrderList" :key="'cg' + col.key" :style="{ width: colW(col.key) + 'px' }"></col>
            </colgroup>
            <thead>
              <tr>
                <th v-for="(col, ci) in colOrderList" :key="col.key" :class="['th', colCls(col), { frozen: isFrozen(col), sortable: canSort(col) }]" :style="isFrozen(col) ? 'left:0;min-width:200px' : ''" :aria-sort="ariaSort(col)" @click="onHeadClick(col)" @contextmenu.prevent="openHdrCtx($event, col.key, col.type)">
                  <div class="th-in">
                    <template v-if="col.type === 'seq'">
                      <button class="col-cfg gear" @click.stop="showColMenu = !showColMenu" title="列设置"><Icon name="settings"/></button>
                    </template>
                    <template v-else>
                      <span>{{ col.label }}<span v-if="canSort(col)" class="sort-ind">{{ sortInd(col.key) }}</span></span>
                      <button v-if="col.type === 'qty'" class="col-copy" :title="'复制该客户下单文本'" @click.stop="copyColumn(col.key)"><Icon name="copy"/></button>
                    </template>
                  </div>
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, col.key)" @click.stop></span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr class="vs-spacer" :style="{ height: vsWindow.top + 'px' }"><td :colspan="colOrderList.length"></td></tr>
              <template v-for="(it, wi) in vsWindow.items" :key="rowKey(it)">
                <tr v-if="it.kind === 'group'" class="grp-head" @click="toggleGroup(it.key)" role="row">
                  <td :colspan="colOrderList.length" @click.stop="toggleGroup(it.key)">
                    <span class="grp-toggle">{{ openGroups[it.key] ? '▼' : '▶' }}</span>
                    <b>{{ it.label }}</b>
                    <span class="grp-sub-info">小计 {{ fmt(it.subtotal.qty) }} 件 · ¥{{ fmt(it.subtotal.amount) }}</span>
                  </td>
                </tr>
                <tr v-else-if="it.kind === 'row' && openGroups[it.gkey] !== false"
                    :class="['data-row', { zebra: it.zi % 2 === 1, selected: selectedPid === it.r.product_id, 'row-loading': rowState(it.r) === 'loading', 'row-error': rowState(it.r) === 'error', 'row-disabled': rowState(it.r) === 'disabled', 'cond-warn': condWarnOn && rowWarn(it.r) === 'low' }]"
                    role="row" :aria-selected="selectedPid === it.r.product_id" :aria-label="rowAria(it.r)">
                  <td v-for="(col, ci) in colOrderList" :key="col.key"
                      :class="['td', colCls(col), { frozen: isFrozen(col), 'cell-active': cellActive(it, ci) }]"
                      :style="isFrozen(col) ? 'left:0;min-width:200px' : ''"
                      role="gridcell" :tabindex="cellActive(it, ci) ? 0 : -1"
                      :data-cell="ci" :data-pid="it.r.product_id"
                      :aria-label="cellAria(it.r, col)"
                      @click="onCellClick(it, col, ci, $event)"
                      @dblclick="onCellDbl(it, col)"
                      @focus="onCellFocus(it, ci)"
                      @keydown="onBodyKey">
                    <template v-if="col.type === 'seq'"><span class="seq-num">{{ it.seq }}</span></template>
                    <template v-else-if="col.type === 'master' && col.key === 'name'">
                      <span class="exp-chev" @click.stop="toggleExpand(it.r.product_id)" :title="isExpanded(it.r.product_id) ? '收起明细' : '展开明细'">{{ isExpanded(it.r.product_id) ? '▼' : '▶' }}</span>
                      <div class="pname">{{ it.r.name }}<span v-if="it.r.ordering_entity" class="oe-badge" :class="'oe-' + it.r.ordering_entity">{{ it.r.ordering_entity }}</span></div>
                      <div class="pspec">{{ it.r.spec || '—' }} · {{ it.r.unit }}<span v-if="it.r.people"> · {{ it.r.people }} 人报</span></div>
                      <div v-if="it.r.ai != null" class="ai-hint">AI 建议 {{ fmt(it.r.ai) }}{{ it.r.unit }}<span v-if="it.r.aiMethod" class="hint">（{{ it.r.aiMethod }}）</span></div>
                      <span v-if="rowWarn(it.r) === 'low'" class="warn-badge" title="低于安全库存">⚠</span>
                      <span v-else-if="rowWarn(it.r) === 'short'" class="warn-badge short" title="短保（保质期≤7天）">⚠</span>
                      <span v-if="lossWarn(it.r)" class="loss-badge" :class="lossWarn(it.r)" :title="lossTip(it.r)">🔥</span>
                      <span v-if="rtBadge(it.r)" class="rt-badge" :class="rtBadge(it.r)" :title="rtBadgeTip(it.r)">🔔</span>
                      <span v-if="rowNote(it.r)" class="note-badge" :title="rowNote(it.r)" @click.stop="setRowNote(cross.rows.indexOf(it.r))">💬</span>
                      <span v-if="gapSet.has(it.r.product_id)" class="gap-badge" title="缺批次/到期资料，需补录">⚠️</span>
                      <span v-if="hsMap[it.r.product_id] !== undefined && hsMap[it.r.product_id] < 60" class="hs-badge" :title="'数据健康分 ' + hsMap[it.r.product_id] + '（偏低，需补全资料）'">💡</span>
                      <span class="row-ops">
                        <button class="rop" @click.stop="viewRow(it.r.product_id)" title="查看/展开明细">🔍</button>
                        <button class="rop" @click.stop="editRow(it.r.product_id)" title="编辑该行">✎</button>
                        <button class="rop danger" @click.stop="delRowSoft(it.r.product_id)" title="删除该行">🗑</button>
                      </span>
                    </template>
                    <template v-else-if="col.type === 'master'">{{ masterVal(it.r, col) }}</template>
                    <template v-else-if="col.type === 'qty'">
                      <input v-if="editingCell && editingCell.pid === it.r.product_id && editingCell.uname === col.key" class="cell-input cell-qty" type="number" min="0" :value="it.r.qtyByUnit[col.key] || 0" v-focus @change="commitCell(it.r.product_id, col.key, $event.target.value)" @blur="commitCell(it.r.product_id, col.key, $event.target.value)" @keydown.stop="onCellKey($event, it.r.product_id, col.key)">
                      <span v-else class="qty-num tip-wrap" :style="heatStyle(it.r, col.key)">{{ it.r.qtyByUnit[col.key] }}<span class="tip">¥{{ fmt(displayPrice(it.r) != null ? (it.r.qtyByUnit[col.key] || 0) * displayPrice(it.r) : 0) }}（按行单价估算）</span></span>
                    </template>
                    <template v-else-if="col.key === 'qty'">{{ fmt(it.r.total) }}</template>
                    <template v-else-if="col.key === 'boxes'">{{ it.r.boxes != null ? fmt(it.r.boxes) : '—' }}</template>
                    <template v-else-if="col.key === 'final'">
                      <template v-if="it.r.decided"><b>{{ fmt(it.r.final_qty) }}</b><span class="decided-badge">已定稿</span></template>
                      <template v-else><span class="pending-final">待定稿</span></template>
                    </template>
                    <template v-else-if="col.key === 'ai'">{{ it.r.ai != null ? fmt(it.r.ai) : '—' }}</template>
                    <template v-else-if="col.key === 'amount'"><span :class="{ 'miss-price': displayPrice(it.r) == null }">{{ displayPrice(it.r) != null ? displayPrice(it.r).toFixed(2) : '缺价' }}</span></template>
                  </td>
                </tr>
                <tr v-else-if="it.kind === 'detail'" class="det-row" role="row">
                  <td :colspan="colOrderList.length">
                    <div class="det-grid">
                      <div class="det-row2"><span>品类</span><b>{{ it.r.category || '—' }}</b></div>
                      <div class="det-row2"><span>品牌</span><b>{{ it.r.brand || '—' }}</b></div>
                      <div class="det-row2"><span>AI建议</span><b v-if="it.r.ai != null">{{ fmt(it.r.ai) }}{{ it.r.unit }} <i v-if="it.r.aiMethod" class="det-i">{{ it.r.aiMethod }}</i></b><span v-else>—</span></div>
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
          <table class="tbl cross-tbl col-total-bar" ref="crossFoot" :style="{ zoom: gridZoom + '%' }">
            <colgroup>
              <col v-for="col in colOrderList" :key="'cfg' + col.key" :style="{ width: colW(col.key) + 'px' }"></col>
            </colgroup>
            <tbody>
              <tr class="col-total">
                <td v-for="(col, ci) in colOrderList" :key="'f' + col.key" :class="['td', colCls(col), { frozen: isFrozen(col) }]" :style="isFrozen(col) ? 'left:0' : ''">
                  <template v-if="col.key === 'name'">合计</template>
                  <template v-else-if="col.type === 'qty'">{{ cross.colTotals[(ci - 1) - visibleCols.length] || '' }}</template>
                  <template v-else-if="col.key === 'qty'">{{ fmt(cross.grand.qty) }}</template>
                  <template v-else-if="col.key === 'boxes' || col.key === 'final'">—</template>
                  <template v-else-if="col.key === 'amount'">{{ fmt(cross.grand.amount) }}</template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 编辑模式：Excel 式可编辑矩阵（选中/方向键/右键行列菜单/填充柄 + 列配置 + 复制） -->
        <div v-else class="grid-area" :class="{ 'is-fs': gridFullscreen }">
          <div class="grid-ctl-row">
            <div class="zoom-group">
              <span class="zb-label">缩放</span>
              <button class="zb-btn" type="button" :disabled="gridZoom<=50" @click="zoomOut" title="缩小" aria-label="缩小">－</button>
              <input class="zb-range" type="range" min="50" max="200" step="10" v-model.number="gridZoom" aria-label="缩放比例">
              <span class="zb-val">{{ gridZoom }}%</span>
              <button class="zb-btn" type="button" :disabled="gridZoom>=200" @click="zoomIn" title="放大" aria-label="放大">＋</button>
              <button class="zb-btn zb-reset" type="button" :disabled="gridZoom===100" @click="zoomReset" title="重置 100%" aria-label="重置缩放">⟲</button>
            </div>
          </div>
          <button class="grid-fs-btn" :title="gridFullscreen ? '退出全屏' : '全屏'" @click="toggleGridFullscreen" aria-label="表体全屏切换">
            <Icon name="fullscreen" size="16"/>
          </button>
          <div class="filter-row" v-if="colFilter || colFilterSet">
            <span v-if="colFilter" class="filter-chip" :title="'按「' + colLabel(colFilter.key, colFilter.type, colFilter.ui) + '」筛选'">筛选「{{ colLabel(colFilter.key, colFilter.type, colFilter.ui) }}」={{ colFilter.val }} <button class="chip-x" @click="clearColFilter" aria-label="清除列筛选">✕</button></span>
            <span v-if="colFilterSet" class="filter-chip" :title="'按「' + colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) + '」唯一值筛选'">筛选「{{ colLabel(colFilterSet.key, colFilterSet.type, colFilterSet.ui) }}」∈ {{ colFilterSet.values.length }} 值 <button class="chip-x" @click="clearUniqFilter" aria-label="清除唯一值筛选">✕</button></span>
          </div>
          <div v-if="showColMenu" class="col-menu-overlay" @click="showColMenu=false"></div>
          <div v-if="showColMenu" class="col-menu edit-col-menu" @click.stop>
            <div class="col-menu-hd"><span>显示列（拖拽排序，✓ 显示）</span><button class="col-menu-x" @click="showColMenu=false" title="关闭"><Icon name="close"/></button></div>
            <ul class="col-menu-list">
              <li v-for="(c, ci) in colOrder" :key="c.key" :class="{ locked: c.fixed, hidden: colVis[c.key] === false }" :draggable="!c.fixed" @dragstart="onColDragStart(ci)" @dragover.prevent @drop="onColDrop(ci)">
                <span class="drag">⠿</span>
                <label><input type="checkbox" :checked="colVis[c.key] !== false" :disabled="c.fixed" @click.prevent="toggleCol(c.key)"> {{ c.label }}</label>
                <button v-if="!c.fixed && c.deletable" class="col-menu-del" @click="deleteMasterCol(c.key)" title="删除该列"><Icon name="close"/></button>
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
          </div>
          <div class="table-wrap edit-grid-wrap" @scroll="onEditScroll">
          <table class="tbl cross-tbl edit-tbl" :class="{ dragging }" @paste="onPaste" @keydown="onGridKey" :style="{ zoom: gridZoom + '%' }">
            <colgroup>
              <col v-for="(k, i) in editColKeys" :key="'eg' + k + i" :style="{ width: colW(k) + 'px' }"></col>
            </colgroup>
            <thead>
              <tr>
                <th class="th seq-th">
                  <button class="col-cfg gear" @click.stop="showColMenu = !showColMenu" title="列设置"><Icon name="settings"/></button>
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'seq')" @click.stop></span>
                </th>
                <th v-for="(c, ci) in visibleCols" :key="c.key" :class="['th', c.cls, { frozen: c.fixed || c.key === frozenExtra, 'sel-col': selected.r >= 0 && selected.c === ci }]" :style="c.fixed ? 'left:0;min-width:200px' : (c.key === frozenExtra ? 'left:200px;min-width:200px' : '')" @contextmenu.prevent="openHdrCtx($event, c.key, 'master')">
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
                <th class="num calc-th extra">加单<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'extra')" @click.stop></span></th>
                <th class="num calc-th amount">金额<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'amount')" @click.stop></span></th>
                <th v-if="showSuggest" class="num calc-th suggest">建议<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'suggest')" @click.stop></span></th>
                <th v-if="compareOn" class="num calc-th">上期量<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'comparePrev')" @click.stop></span></th>
                <th v-if="compareOn" class="num calc-th delta">Δ<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'compareDelta')" @click.stop></span></th>
                <th v-if="showSpark" class="spark-th">趋势<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'spark')" @click.stop></span></th>
                <th v-if="yoyOn" class="num calc-th">去年同期<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'yoyPrev')" @click.stop></span></th>
                <th v-if="yoyOn" class="num calc-th">同比<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'yoyDelta')" @click.stop></span></th>
                <th class="num calc-th sum">合计<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'sum')" @click.stop></span></th>
                <th class="qty-th">
                  <input class="cell-input cell-cust" placeholder="客户名" @keyup.enter="addCol($event)">
                  <span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'spacer')" @click.stop></span>
                </th>
                <th class="op-th">操作<span class="col-resizer" @mousedown.stop.prevent="startResize($event, 'op')" @click.stop></span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, ri) in cross.rows" :key="ri" :class="{ 'sel-row': selected.r === ri, 'cond-warn': condWarnOn && rowWarn(r) === 'low' }" v-show="rowShown(ri)">
                <td class="td seq-cell"><span class="seq-num">{{ ri + 1 }}</span></td>
                <td v-for="(c,  ci) in visibleCols" :key="c.key" :class="['td', c.cls, { frozen: c.fixed || c.key === frozenExtra, selected: selected.r === ri && selected.c === ci, 'range-sel': inRange(ri, ci), invalid: cellInvalid(ri, ci) }]" :style="c.fixed ? 'left:0;min-width:200px' : (c.key === frozenExtra ? 'left:200px;min-width:200px' : '')" :data-r="ri" :data-c="ci" :title="cellErrMsg(ri, ci) || null" @mousedown="onCellDown(ri, ci, $event)" @mouseover="onCellOver(ri, ci)" @contextmenu.prevent="openCtx($event, ri, ci, 'master')">
                  <template v-if="c.key === 'name'">
                    <input v-model="r.name" class="cell-input cell-name" placeholder="商品名称" :data-r="ri" :data-c="ci" @focus="onFocusCell(ri, ci)">
                    <div class="name-badges">
                      <span v-if="rowWarn(r) === 'low'" class="warn-badge" title="低于安全库存">⚠</span>
                      <span v-else-if="rowWarn(r) === 'short'" class="warn-badge short" title="短保（保质期≤7天）">⚠</span>
                      <span v-if="lossWarn(r)" class="loss-badge" :class="lossWarn(r)" :title="lossTip(r)">🔥</span>
                      <span v-if="rtBadge(r)" class="rt-badge" :class="rtBadge(r)" :title="rtBadgeTip(r)">🔔</span>
                      <span v-if="rowNote(r)" class="note-badge" :title="rowNote(r)" @click="setRowNote(ri)">💬</span>
                      <span v-if="gapSet.has(r.product_id)" class="gap-badge" title="缺批次/到期资料，需补录">⚠️</span>
                      <span v-if="hsMap[r.product_id] !== undefined && hsMap[r.product_id] < 60" class="hs-badge" :title="'数据健康分 '+hsMap[r.product_id]+'（偏低，需补全资料）'">💡</span>
                    </div>
                  </template>
                  <template v-else-if="c.edit === 'text' && c.options && c.options.length">
                    <input v-model="r[c.key]" class="cell-input cell-wide" :placeholder="c.label" :data-r="ri" :data-c="ci" :list="'opt-' + c.key" @focus="onFocusCell(ri, ci)" @change="onCellChange">
                    <!-- 共享 datalist：仅首行渲染一份，避免每行重复 id + 海量 option 节点导致点击展开时标签页崩溃 -->
                    <datalist v-if="ri === 0" :id="'opt-' + c.key">
                      <option v-for="o in c.options" :key="o" :value="o"></option>
                    </datalist>
                  </template>
                  <template v-else-if="c.edit === 'text'">
                    <input v-model="r[c.key]" class="cell-input cell-wide" :placeholder="c.label" :data-r="ri" :data-c="ci" @focus="onFocusCell(ri, ci)" @change="onCellChange">
                  </template>
                  <template v-else-if="c.edit === 'num'">
                    <input v-model.number="r[c.key]" class="cell-input cell-num" type="number" min="0" placeholder="0" :data-r="ri" :data-c="ci" @focus="onFocusCell(ri, ci)" @change="onCellChange">
                  </template>
                  <span v-if="selected.r === ri && selected.c === ci" class="fill-handle" @mousedown.prevent.stop="startFill(ri, ci, $event)" title="拖拽填充"></span>
                </td>
                <td v-for="(u, ui) in cross.units" :key="u.name" class="qty-cell" :class="{ selected: selected.r === ri && selected.c === visibleCols.length + ui, 'range-sel': inRange(ri, visibleCols.length + ui), invalid: cellInvalid(ri, visibleCols.length + ui), 'warn-low': rowWarn(r) === 'low', 'warn-short': rowWarn(r) === 'short', 'diff-chg': snapCompare && cellDiff(ri, ui) !== 0 }" :style="heatStyle(r, u.name)" :data-r="ri" :data-c="visibleCols.length + ui" :title="cellErrMsg(ri, visibleCols.length + ui) || null" @mousedown="onCellDown(ri, visibleCols.length + ui, $event)" @mouseover="onCellOver(ri, visibleCols.length + ui)" @contextmenu.prevent="openCtx($event, ri, visibleCols.length + ui, 'qty')">
                  <input v-model.number="r.qtyByUnit[u.name]" class="cell-input cell-qty" type="number" min="0" placeholder="0" :data-r="ri" :data-c="visibleCols.length + ui" @focus="onFocusCell(ri, visibleCols.length + ui)" @change="onCellChange">
                  <span v-if="selected.r === ri && selected.c === visibleCols.length + ui" class="fill-handle" @mousedown.prevent.stop="startFill(ri, visibleCols.length + ui, $event)" title="拖拽填充"></span>
                </td>
                <td class="num calc extra"><input v-model.number="r.extraQty" class="cell-input cell-qty" type="number" min="0" placeholder="0" :data-r="ri" :data-c="visibleCols.length + cross.units.length" @focus="onFocusCell(ri, visibleCols.length + cross.units.length)" @change="onCellChange"></td>
                <td class="num calc amount">{{ fmt(rowAmount(r)) }}</td>
                <td v-if="showSuggest" class="num calc suggest">{{ fmt(r.suggest || 0) }}<button class="mini-btn" @click="adoptSuggestion(ri)" :disabled="!(r.suggest > 0)">采纳</button></td>
                <td v-if="compareOn" class="num calc">{{ prevQty(r) != null ? fmt(prevQty(r)) : '—' }}</td>
                <td v-if="compareOn" class="num calc delta" :class="deltaClass(r)">{{ deltaQty(r) == null ? '—' : (deltaQty(r) > 0 ? '+' : '') + fmt(deltaQty(r)) }}</td>
                <td v-if="showSpark" class="spark-td">
                  <svg v-if="(r.history || []).length >= 2" width="84" height="18"><polyline :points="sparkPoints(r)" fill="none" :stroke="sparkColor(r)" stroke-width="1.5"/></svg>
                  <span v-else class="muted">—</span>
                </td>
                <td v-if="yoyOn" class="num calc">{{ yoyQty(r) != null ? fmt(yoyQty(r)) : '—' }}</td>
                <td v-if="yoyOn" class="num calc delta" :class="yoyPct(r) > 0 ? 'up' : (yoyPct(r) < 0 ? 'down' : '')">{{ yoyPct(r) == null ? '—' : (yoyPct(r) > 0 ? '+' : '') + yoyPct(r) + '%' }}</td>
                <td class="num calc sum" :class="[warnClass(ri), moqWarn(r) === 'below' ? 'moq-below' : '']">{{ fmt(rowSum(r)) }}</td>
                <td class="td spacer"></td>
                <td class="op-th"><button class="btn-del" @click="delRow(ri)" title="删除该商品行"><Icon name="close"/></button></td>
              </tr>
            </tbody>
            </table>
          </div>
          <table class="tbl cross-tbl edit-tbl col-total-bar" ref="editFoot">
            <colgroup>
              <col v-for="(k, i) in editColKeys" :key="'efg' + k + i" :style="{ width: colW(k) + 'px' }"></col>
            </colgroup>
            <tbody>
              <tr class="foot-row">
                <td class="seq-cell"></td>
                <td v-for="c in visibleCols" :key="'f' + c.key" class="num calc" :class="{ frozen: c.fixed || c.key === frozenExtra }" :style="c.fixed ? 'left:0;min-width:200px' : (c.key === frozenExtra ? 'left:200px;min-width:200px' : '')">{{ c.key === 'name' ? '合计' : (c.edit === 'num' ? fmt(foot.masterSum[c.key] || 0) : '') }}</td>
                <td v-for="(u, ui) in cross.units" :key="'fu' + u.name" class="num calc">{{ fmt(foot.unitSum[ui] || 0) }}</td>
                <td class="num calc extra">{{ fmt(cross.rows.reduce((s, r) => s + (Number(r.extraQty) || 0), 0)) }}</td>
                <td class="num calc amount">{{ fmt(foot.amount) }}</td>
                <td v-if="showSuggest" class="num calc suggest">{{ fmt(foot.suggest) }}</td>
                <td v-if="compareOn" class="num calc">—</td>
                <td v-if="compareOn" class="num calc delta">—</td>
                <td v-if="showSpark" class="spark-td"></td>
                <td v-if="yoyOn" class="num calc">—</td>
                <td v-if="yoyOn" class="num calc delta">—</td>
                <td class="num calc sum">{{ fmt(foot.qty) }}</td>
                <td class="td spacer"></td>
                <td class="op-th"></td>
              </tr>
            </tbody>
          </table>
          <div v-if="selStats" class="sel-stat">
            <span class="sel-stat-label">选区统计</span>
            <span>计数 <b>{{ selStats.count }}</b></span>
            <span>求和 <b>{{ fmt(selStats.sum) }}</b></span>
            <span>平均 <b>{{ fmt(selStats.avg) }}</b></span>
            <button class="sel-stat-x" @click="selRange = null" title="清除选区">✕</button>
          </div>
          <div v-if="openGroup" class="grp-row">
            <template v-if="openGroup==='quality'">
              <button class="btn btn-ghost btn-sm" @click="gapOpen=!gapOpen" :disabled="gapLoading">⚠️ 缺口补录</button>
              <button class="btn btn-ghost btn-sm" @click="safetyOpen=!safetyOpen" :disabled="safetyLoading">🛡 安全库存</button>
              <button class="btn btn-ghost btn-sm" @click="rollingOn=!rollingOn">🗓 滚动预报</button>
              <button class="btn btn-ghost btn-sm" @click="loadVariance" :disabled="varLoading">📉 偏差归因</button>
              <button class="btn btn-ghost btn-sm" @click="healthOpen=!healthOpen">🩺 体检</button>
              <button class="btn btn-ghost btn-sm" @click="loadHealthScore" :disabled="hsLoading">💡 数据健康分</button>
            </template>
            <template v-else-if="openGroup==='smart'">
              <button class="btn btn-ghost btn-sm" @click="loadTs" :disabled="tsLoading">🤖 运行预测</button>
              <button class="btn btn-ghost btn-sm" @click="openCal">📆 日历因子</button>
              <button class="btn btn-ghost btn-sm" @click="nlOpen=!nlOpen">💬 自然语言改单</button>
              <button class="btn btn-ghost btn-sm" @click="topupOpen=!topupOpen">🧮 一键凑单达返利</button>
            </template>
            <template v-else-if="openGroup==='collab'">
              <button class="btn btn-ghost btn-sm" @click="poOpen=!poOpen">📦 供应商PO</button>
              <button class="btn btn-ghost btn-sm" @click="loadPo2" :disabled="po2Loading">🧾 采购直发</button>
              <button class="btn btn-ghost btn-sm" @click="loadHeal" :disabled="healLoading">🛠 异常自愈</button>
              <button class="btn btn-ghost btn-sm" @click="miniInputOpen=!miniInputOpen">📱 移动端录单</button>
              <button class="btn btn-ghost btn-sm" @click="rtWarnOpen=!rtWarnOpen" :disabled="rtWarnLoading">🔔 库存预警</button>
              <label class="basis-toggle"><input type="checkbox" v-model="autoAlertOn" @change="maybeAutoAlert"> 主动预警</label>
            </template>
            <template v-else-if="openGroup==='more'">
              <label class="basis-toggle">对比期
                <select v-model="compareBaseId" @change="loadComparePeriod(compareBaseId)">
                  <option value="">任选…</option>
                  <option v-for="p in compareablePeriods" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
              <button v-if="compareOn" class="btn btn-ghost btn-xs" @click="clearCompare">清除对比</button>
              <button class="btn btn-ghost btn-sm" @click="loadHistory" :disabled="historyLoading">📈 载入趋势</button>
              <button class="btn btn-ghost btn-sm" @click="batchMode=!batchMode">▦ 批量编辑</button>
              <button class="btn btn-ghost btn-sm" @click="saveSnap">⎘ 存快照</button>
              <button class="btn btn-ghost btn-sm" @click="loadRebatePush" :disabled="rebatePushLoading">💰 返利缺口查</button>
              <button class="btn btn-ghost btn-sm" @click="showMoq=!showMoq">📦 MOQ</button>
              <button class="btn btn-ghost btn-sm" @click="loadYoY" :disabled="historyLoading">📅 去年同期</button>
              <button class="btn btn-ghost btn-sm" @click="genSuggestBook" :disabled="suggestBookLoading">📝 下单说明</button>
              <button class="btn btn-ghost btn-sm" @click="loadAccuracy" :disabled="accLoading">🎯 准确率</button>
              <button class="btn btn-ghost btn-sm" @click="trailOpen=!trailOpen">📜 审计</button>
              <button class="btn btn-ghost btn-sm" @click="loadTemplates" :disabled="tmplLoading">📚 行业模板</button>
              <button class="btn btn-ghost btn-sm" @click="loadBI" :disabled="biLoading">📊 经营看板</button>
              <button class="btn btn-ghost btn-sm" @click="miniOpen=!miniOpen">📱 小程序端审批</button>
              <button class="btn btn-ghost btn-sm" @click="loadMarket" :disabled="marketLoading">🏪 配方市场</button>
              <button class="btn btn-ghost btn-sm" @click="suggestPanel=!suggestPanel"><Icon name="settings"/> 建议配方</button>
              <button class="btn btn-ghost btn-sm" @click="pagingOn=!pagingOn">📄 分页</button>
            </template>
          </div>
          <div v-if="suggestPanel" class="recipe-panel">
            <span>策略</span>
            <select v-model="suggRecipe.strategy">
              <option value="safety">安全库存法</option>
              <option value="avg">历史均值法</option>
              <option value="trend">趋势外推法</option>
              <option value="blend">加权混合法</option>
            </select>
            <span v-if="suggRecipe.strategy !== 'safety'">覆盖天数<input v-model.number="suggRecipe.coverageDays" type="number" min="1" class="recipe-val"></span>
            <span v-if="suggRecipe.strategy === 'trend'">外推步数<input v-model.number="suggRecipe.trendSteps" type="number" min="1" class="recipe-val"></span>
            <span v-if="suggRecipe.strategy === 'blend'">历史权重<input v-model.number="suggRecipe.trendWeight" type="number" step="0.1" min="0" max="1" class="recipe-val"></span>
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
            <input v-model.number="batch.val" type="number" class="batch-val" placeholder="数值">
            <button class="btn btn-primary btn-xs" @click="applyBatch">应用</button>
            <span class="hint">先 Shift+点击 或 拖选多行</span>
          </div>
          <div v-if="snaps.length" class="snap-bar">
            <span>快照对比：</span>
            <button v-for="s in snaps" :key="s.name" class="btn btn-ghost btn-xs" @click="diffSnap(s.name)">对比 {{ s.name }}</button>
            <button class="btn btn-ghost btn-xs" @click="snapCompare = null">清除对比</button>
            <button v-if="snapCompare" class="btn btn-primary btn-xs" @click="exportDiffXlsx"><Icon name="download"/> 导出差异</button>
          </div>
          <div v-if="rebatePushOpen" class="info-panel">
            <div class="panel-hd"><b>💰 返利缺口提示</b><button class="imp-x" @click="rebatePushOpen=false"><Icon name="close"/></button></div>
            <div v-if="rebatePushLoading" class="hint">加载中…</div>
            <div v-else-if="!rebatePushList.length" class="hint">暂无未结冲档空间（均已达最高档或未配置合同）</div>
            <ul v-else class="push-list">
              <li v-for="p in rebatePushList" :key="p.supplier">供应商 <b>{{ p.supplier }}</b>：再采 ¥{{ fmt(p.gap) }} 冲下一档 <b>{{ p.pct }}%</b>，预计多拿返利 ¥{{ fmt(p.extra) }}</li>
            </ul>
          </div>
          <div v-if="healthOpen" class="info-panel">
            <div class="panel-hd"><b>🩺 提交前体检</b><span class="tag" :class="healthIssues.length ? 'warn' : 'ok'">{{ healthIssues.length }} 项</span><button class="imp-x" @click="healthOpen=false"><Icon name="close"/></button></div>
            <div v-if="!healthIssues.length" class="hint">未发现明显异常，可放心提交</div>
            <ul v-else class="health-list">
              <li v-for="(it, i) in healthIssues" :key="i" :class="'sev-'+it.sev" @click="jumpToRow(it.ri)"><span class="sev-dot"></span>{{ it.msg }}</li>
            </ul>
          </div>
          <div v-if="pagingOn" class="pager">
            <button class="btn btn-ghost btn-xs" :disabled="curPage<=0" @click="pageGo(-1)">← 上一页</button>
            <span class="pager-info">第 {{ curPage+1 }} / {{ totalPages }} 页 · 每页 {{ pageSize }} 行 · 共 {{ cross.rows.length }} SKU</span>
            <button class="btn btn-ghost btn-xs" :disabled="curPage>=totalPages-1" @click="pageGo(1)">下一页 →</button>
          </div>

          <!-- P8-1 下单说明文档 -->
          <div v-if="suggestBookOpen" class="info-panel">
            <div class="panel-hd"><b>📝 下单说明文档</b><button class="imp-x" @click="suggestBookOpen=false"><Icon name="close"/></button></div>
            <textarea class="book-area" v-model="suggestBookText" rows="10"></textarea>
            <div class="imp-ft"><button class="btn btn-primary btn-sm" :disabled="pushing" @click="sendSuggestBook"><Icon name="upload"/> 推送企微审批</button><span class="hint">AI 据体检/货损/MOQ 自动生成，可手改</span></div>
          </div>

          <!-- P8-2 实时库存预警 -->
          <div v-if="rtWarnOpen" class="info-panel">
            <div class="panel-hd"><b>🔔 实时库存预警</b><span class="tag warn">{{ Object.keys(rtWarnMap).length }} 项</span><button class="imp-x" @click="rtWarnOpen=false"><Icon name="close"/></button></div>
            <div v-if="rtWarnLoading" class="hint">加载中…</div>
            <ul v-else-if="Object.keys(rtWarnMap).length" class="push-list">
              <li v-for="(it,pid) in rtWarnMap" :key="pid"><b>{{ it.name }}</b>：{{ it.msg }}</li>
            </ul>
            <div v-else class="hint">实时库存无临期/缺货预警（含批次与到期校验）</div>
          </div>

          <!-- P8-3 预测准确率 -->
          <div v-if="accOpen" class="info-panel">
            <div class="panel-hd"><b>🎯 预测准确率</b><span class="tag" :class="accData&&accData.hit_rate!=null?'ok':'warn'">{{ accData? (accData.hit_rate!=null? accData.hit_rate+'%':'数据不足') : '…' }}</span><button class="imp-x" @click="accOpen=false"><Icon name="close"/></button></div>
            <div v-if="accLoading" class="hint">加载中…</div>
            <div v-else-if="accData">
              <div v-if="accData.note" class="imp-tip">{{ accData.note }}</div>
              <table v-if="accData.items && accData.items.length" class="tbl acc-tbl">
                <thead><tr><th>商品</th><th class="num">预报</th><th class="num">实际</th><th class="num">差异</th><th>命中</th></tr></thead>
                <tbody>
                  <tr v-for="(it,i) in accData.items.slice(0,30)" :key="i">
                    <td>{{ it.product }}</td><td class="num">{{ fmt(it.forecast) }}</td><td class="num">{{ fmt(it.actual) }}</td>
                    <td class="num" :class="it.diff>0?'up':(it.diff<0?'down':'')">{{ it.diff>0?'+':'' }}{{ fmt(it.diff) }}</td>
                    <td>{{ it.hit ? '✓' : '✗' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- P9-4 审批流状态机 -->
          <div v-if="subOpen" class="info-panel">
            <div class="panel-hd"><b>✅ 审批流（状态机）</b><span class="tag" :class="'st-'+subStatus">{{ SUB_LABEL[subStatus] }}</span><button class="imp-x" @click="subOpen=false"><Icon name="close"/></button></div>
            <div class="sub-bar">
              <button class="btn btn-sm" :disabled="subStatus!=='draft'&&subStatus!=='revised'" @click="doSubmit">提交审批</button>
              <button class="btn btn-primary btn-sm" :disabled="subStatus!=='submitted'" @click="doApprove">通过</button>
              <button class="btn btn-sm" :disabled="subStatus!=='submitted'" @click="doReject">驳回</button>
              <button class="btn btn-sm" :disabled="subStatus!=='approved'&&subStatus!=='rejected'" @click="doRevise">退回修改</button>
              <button class="btn btn-sm" :disabled="subStatus!=='approved'" @click="doWriteback">🔗 回写ERP</button>
            </div>
            <div v-if="subBy" class="hint">操作人 {{ subBy }} · {{ subAt }}</div>
            <div v-if="subReason" class="imp-warn">驳回原因：{{ subReason }}</div>
          </div>

          <!-- P9-6 改动留痕审计 -->
          <div v-if="trailOpen" class="info-panel">
            <div class="panel-hd"><b>📜 改动留痕审计</b><span class="tag info">{{ auditTrail.length }} 条</span><button class="imp-x" @click="trailOpen=false"><Icon name="close"/></button></div>
            <ul v-if="auditTrail.length" class="health-list">
              <li v-for="(a,i) in auditTrail" :key="i" class="sev-info"><span class="sev-dot"></span>{{ a.at }} · {{ a.action }} · {{ a.detail }}</li>
            </ul>
            <div v-else class="hint">暂无留痕（保存/审批操作会自动记录）</div>
          </div>

          <!-- P10-7 配方行业模板库 -->
          <div v-if="tmplOpen" class="info-panel">
            <div class="panel-hd"><b>📚 配方行业模板库</b><button class="imp-x" @click="tmplOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>📊 经营看板 BI</b><button class="imp-x" @click="biOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>📱 小程序端审批契约</b><button class="imp-x" @click="miniOpen=false"><Icon name="close"/></button></div>
            <div class="imp-tip">老板可在 <b>forecast-order-miniprogram</b> 手机端批单。契约：小程序调 <code>GET /api/forecast/submission?period_id=</code> 取状态，调 <code>POST /api/forecast/submission</code> 执行 approve/reject（复用本页状态机）。本页「✅ 审批」通过的操作，小程序实时可见。</div>
          </div>

          <!-- P11-1 数据缺口补录 -->
          <div v-if="gapOpen" class="info-panel">
            <div class="panel-hd"><b>⚠️ 数据缺口补录</b><span class="tag warn">{{ gapList.length }} 项缺批次/到期</span><button class="imp-x" @click="gapOpen=false"><Icon name="close"/></button></div>
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
            <div v-else class="hint">全部商品资料完整 🎉（无缺口）</div>
          </div>

          <!-- P11-2 安全库存 AI 建议 -->
          <div v-if="safetyOpen" class="info-panel">
            <div class="panel-hd"><b>🛡 安全库存 AI 建议</b><button class="imp-x" @click="safetyOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>🗓 多期滚动预报</b><span class="tag info">未来 {{ rollingN }} 期</span><button class="imp-x" @click="rollingOn=false"><Icon name="close"/></button></div>
            <div class="rolling-chips">
              <button v-for="p in rollingPeriods" :key="p.id" class="btn btn-ghost btn-xs" :class="{on: p.id===curPeriod}" @click="gotoPeriod(p.id)">{{ p.name }}</button>
            </div>
            <div class="hint">点击切换期次，网格随预报节奏联动（默认载入最新期）</div>
          </div>

          <!-- P12-4 偏差归因复盘 -->
          <div v-if="varOpen" class="info-panel">
            <div class="panel-hd"><b>📉 偏差归因复盘</b><span class="tag" :class="varData&&varData.hit_rate!=null?'ok':'warn'">{{ varData? (varData.hit_rate!=null? varData.hit_rate+'%':'数据不足'):'…' }}</span><button class="imp-x" @click="varOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>💬 自然语言改单</b><button class="imp-x" @click="nlOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>🧮 一键凑单达返利</b><button class="btn btn-primary btn-xs" :disabled="!topupPlan.length" @click="applyTopup">一键凑单</button><button class="imp-x" @click="topupOpen=false"><Icon name="close"/></button></div>
            <ul v-if="topupPlan.length" class="push-list">
              <li v-for="t in topupPlan" :key="t.name"><b>{{ t.name }}</b> 差 ¥{{ fmt(t.gap) }} → 建议 +{{ t.add }} 箱 @¥{{ fmt(t.price) }}</li>
            </ul>
            <div v-else class="hint">无可达返利阈值的凑单项（先点「💰 返利缺口查」算缺口）</div>
          </div>

          <!-- P12-7 what-if 配方模拟 -->
          <div v-if="cmp2Open" class="info-panel">
            <div class="panel-hd"><b>🔬 what-if 配方模拟</b><button class="imp-x" @click="cmp2Open=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>📦 供应商PO聚合</b><button class="btn btn-primary btn-xs" :disabled="poLoading" @click="loadPo">聚合</button><button class="btn btn-ghost btn-xs" :disabled="!poData" @click="poWriteback">🔗 回写ERP</button><button class="imp-x" @click="poOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>📲 移动端预报录入（Web 侧闭环）</b><button class="imp-x" @click="miniInputOpen=false"><Icon name="close"/></button></div>
            <div class="imp-tip">销售现场录单：选商品 + 数量，提交即写 <code>forecast_orders</code>，Web 端「✅ 审批」实时可见。小程序工程另立（契约见交付文档）。</div>
            <div class="mini-form">
              <select v-model="miniPid" class="input"><option value="">选商品…</option><option v-for="r in cross.rows" :key="r.product_id" :value="r.product_id">{{ r.name }}</option></select>
              <input v-model.number="miniQty" type="number" min="0" class="input" placeholder="数量(箱)" style="width:90px">
              <input v-model="miniUnit" class="input" placeholder="单位" style="width:64px">
              <input v-model="miniNote" class="input" placeholder="备注(选填)">
              <button class="btn btn-primary btn-sm" :disabled="miniSaving" @click="submitMini">提交录单</button>
            </div>
            <div v-if="miniMsg" class="mini-msg">{{ miniMsg }}</div>
          </div>

          <!-- P14-1/2 时间序列预测 + 置信区间 -->
          <div v-if="tsOpen" class="info-panel">
            <div class="panel-hd"><b>🤖 销量预测（时间序列 + 置信区间）</b><button class="imp-x" @click="tsOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>📆 节假日/促销日历因子</b><button class="imp-x" @click="calOpen=false"><Icon name="close"/></button></div>
            <div class="imp-tip">为节令/促销设置销量放大因子，一键叠加到当前网格预报量。</div>
            <div class="mini-form">
              <select v-model="calFactors.selected" class="input"><option value="">选因子…</option><option v-for="p in calPresets" :key="p" :value="p">{{ p }}</option></select>
              <input v-model.number="calFactors.factors[calFactors.selected]" type="number" step="0.1" min="0.1" class="input" placeholder="倍数" style="width:70px" :disabled="!calFactors.selected" @focus="setCalFactor(calFactors.selected)">
              <button class="btn btn-primary btn-sm" @click="applyCal">应用因子</button>
              <button class="btn btn-ghost btn-sm" @click="saveCal">保存</button>
            </div>
            <div class="imp-tip">已设：<span v-for="(v,k) in calFactors.factors" :key="k" class="tag info">{{ k }} ×{{ v }}</span></div>
          </div>

          <!-- P14-4 滞销/临期反向预警 -->
          <div v-if="slowOpen" class="info-panel">
            <div class="panel-hd"><b>🔻 滞销/临期反向预警（去库存）</b><button class="imp-x" @click="slowOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>🧾 采购单直发</b><button class="imp-x" @click="po2Open=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>🛠 异常自愈闭环</b><button class="imp-x" @click="healOpen=false"><Icon name="close"/></button></div>
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
            <div class="panel-hd"><b>🧠 Hermes 深度联动（异常根因分析）</b><button class="imp-x" @click="hermesOpen=false"><Icon name="close"/></button></div>
            <textarea v-model="hermesCtx" class="book-area" placeholder="描述预报/库存/销售异常，例如：A商品连续3周预测偏高20%，B商品临期积压…"></textarea>
            <div class="mini-form">
              <button class="btn btn-primary btn-sm" :disabled="hermesLoading" @click="runHermes">{{ hermesLoading ? '分析中…' : '让 Hermes 分析' }}</button>
            </div>
            <div v-if="hermesResult" class="imp-tip" style="white-space:pre-wrap">{{ hermesResult }}</div>
          </div>

          <!-- 列统计弹层 -->
          <div v-if="statsOpen" class="info-panel">
            <div class="panel-hd"><b>📊 列统计 · {{ colStats && colStats.label }}</b><button class="imp-x" @click="statsOpen=false"><Icon name="close"/></button></div>
            <div v-if="colStats" class="stats-body">
              <template v-if="colStats.numeric">
                <div class="stat-row"><span>合计</span><b>{{ fmt(colStats.sum) }}</b></div>
                <div class="stat-row"><span>平均值</span><b>{{ fmt(colStats.avg) }}</b></div>
                <div class="stat-row"><span>最大值</span><b>{{ fmt(colStats.max) }}</b></div>
                <div class="stat-row"><span>最小值</span><b>{{ fmt(colStats.min) }}</b></div>
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

          <!-- P16-8 配方市场 -->
          <div v-if="marketOpen" class="info-panel">
            <div class="panel-hd"><b>🏪 配方市场（行业配方可交易资产）</b><button class="imp-x" @click="marketOpen=false"><Icon name="close"/></button></div>
            <div v-if="marketLoading" class="imp-tip">加载中…</div>
            <template v-else>
              <div class="imp-tip">发布当前配方到市场：</div>
              <div class="mini-form">
                <input v-model="marketName" class="input" placeholder="配方名称">
                <input v-model.number="marketPrice" type="number" min="0" class="input" placeholder="价格(元)" style="width:90px">
                <input v-model="marketDesc" class="input" placeholder="简介">
                <button class="btn btn-primary btn-sm" @click="publishMarket">发布</button>
              </div>
              <div class="imp-tip">市场配方（{{ marketList.length }}）：</div>
              <div v-for="m in marketList" :key="m.id" class="heal-row">
                <div><b>{{ m.name }}</b> · {{ m.price ? ('¥'+m.price) : '免费' }} · {{ m.author }}</div>
                <div class="imp-tip">{{ m.desc }}</div>
                <button class="btn btn-ghost btn-xs" @click="adoptMarket(m.id)">采纳到本租户</button>
              </div>
            </template>
          </div>

          <!-- P16-9 数据健康分 -->
          <div v-if="hsOpen" class="info-panel">
            <div class="panel-hd"><b>💡 数据健康分（每 SKU 评分）</b><button class="imp-x" @click="hsOpen=false"><Icon name="close"/></button></div>
            <div v-if="hsLoading" class="imp-tip">评分中…</div>
            <template v-else>
              <div class="imp-tip">平均数据健康分：<b>{{ hsAvg != null ? hsAvg : '—' }}</b>（网格中分&lt;60 的商品已标 💡）</div>
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
          <div v-if="ctx.show" class="ctx-menu" :style="ctxMenuStyle">
            <button class="ctx-paste" @click="ctxPaste"><Icon name="paste"/> 粘贴</button>
            <button @click="ctxCopy"><Icon name="copy"/> 复制选区</button>
            <button @click="ctxAskAi"><Icon name="sparkle"/> 让 AI 分析这行</button>
            <button @click="ctxColStats"><Icon name="list"/> 此列统计</button>
            <button v-if="ctxNumCell" @click="ctxFillSafety"><Icon name="sparkle"/> 按安全库存补齐</button>
            <button v-if="ctx.type === 'master' && ctx.key === 'name'" @click="ctxViewProfile"><Icon name="list"/> 查看商品档案</button>
            <div class="ctx-sep"></div>
            <button @click="ctxInsertRow(true)">↑ 在上方插入行</button>
            <button @click="ctxInsertRow(false)">↓ 在下方插入行</button>
            <button @click="ctxFillDown">↓ 向下填充</button>
            <button @click="ctxFillRight">→ 向右填充</button>
            <button class="danger" @click="ctxDeleteRow">🗑 删除此行</button>
            <div class="ctx-sep"></div>
            <template v-if="ctx.type === 'qty'">
              <button @click="ctxInsertCol(true)">← 在左侧插入列</button>
              <button @click="ctxInsertCol(false)">→ 在右侧插入列</button>
              <button class="danger" @click="ctxDeleteCol">🗑 删除此列</button>
            </template>
            <template v-else-if="ctx.type === 'master' && ctx.deletable">
              <button class="danger" @click="ctxDeleteCol">🗑 删除此列</button>
            </template>
            <template v-else-if="ctx.type === 'master' && !ctx.deletable">
              <div class="ctx-note">该主档列不可删除（可经列配置隐藏）</div>
            </template>
            <div class="ctx-sep"></div>
            <button @click="ctxClearCell">⌫ 清空此单元格</button>
            <button @click="ctxSetNote"><Icon name="edit"/> 本行加备注</button>
            <button @click="ctxCopyRow"><Icon name="copy"/> 复制此行到下方</button>
            <button @click="ctxCopyCsv"><Icon name="copy"/> 复制为 CSV</button>
            <button @click="ctxCopyMd"><Icon name="copy"/> 复制为 Markdown</button>
            <button @click="ctxExportSel"><Icon name="download"/> 导出选中行</button>
            <div class="ctx-sep"></div>
            <button :class="{ 'ctx-on': condWarnOn }" @click="toggleCondWarn">🔴 {{ condWarnOn ? '✓ ' : '' }}高亮库存&lt;安全库存</button>
            <div class="ctx-sep"></div>
            <button :disabled="!canUndo" @click="undo"><Icon name="undo"/> 撤销</button>
            <button :disabled="!canRedo" @click="redo"><Icon name="redo"/> 重做</button>
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
                  <button @click="hdrFreezeCol"><Icon name="cross"/> {{ frozenExtra === hdrCtx.key ? '取消冻结此列' : '冻结此列' }}</button>
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
                <input v-model="hdrWidthVal" class="ctx-ipt" type="number" min="40" style="width:90px" @keyup.enter="applyHdrWidth" @keyup.esc="hdrCtx.mode='menu'"> <span class="ctx-ipt-unit">px</span>
              </div>
              <div class="ctx-ipt-actions">
                <button class="btn-primary" @click="applyHdrWidth">应用</button>
                <button @click="hdrCtx.mode='menu'">取消</button>
              </div>
            </template>
          </div>
        </div>

        <div v-if="cross.rows.length && !editMode" class="pin">
          <span class="big">总订量 <b>{{ fmt(cross.grand.qty) }}</b> 件</span>
          <span class="mini">下单金额 <b>¥{{ fmt(cross.grand.amount) }}</b></span>
          <span class="mini">{{ cross.grand.sku }} 个商品 · {{ cross.reportedUnits }} 个报单单元</span>
        </div>
        <div v-if="editMode" class="edit-hint">
          <div class="edit-summary">合计 <b>{{ fmt(editTotalQty) }}</b> 件 · 金额 <b>¥{{ fmt(editTotalAmount) }}</b></div>
          <div v-if="draftRestored" class="draft-banner">⚠️ 已从本地草稿恢复未完成数据（{{ cross.rows.length }} 行），「保存」后自动清除；或 <button class="link-btn" @click="clearDraft">放弃草稿</button></div>
        </div>
      </div>
    </div>

    <!-- 商品搜索 + 草稿区 -->
    <div v-show="viewMode === 'list'" class="card draft-section">
      <div class="panel-hd"><b>报单草稿</b><span class="tag info">{{ draft.length }} 个商品</span>
        <span class="ph-actions">
          <button class="btn btn-sm btn-primary" :disabled="!draft.length || auditing" @click="runAudit">{{ auditing ? '审核中…' : '智能审核' }}</button>
          <button class="btn btn-sm btn-ghost" :disabled="!auditResults.length" @click="saveDraft">保存草稿</button>
        </span>
      </div>

      <div class="search-row">
        <input v-model="searchQ" class="input" placeholder="搜索商品名称/规格/拼音首字母…" @input="onSearch">
        <button class="btn btn-ghost" @click="searchQ=''; searchResults=[]">清空</button>
      </div>

      <!-- 搜索结果下拉 -->
      <div v-if="searchResults.length" class="search-dropdown">
        <div v-for="p in searchResults" :key="p.id" class="sd-item">
          <div class="sd-main" @click="addToDraft(p)">
            <div class="sd-name">{{ p.name }} <span class="sd-spec">{{ p.spec || '' }}</span></div>
            <div class="sd-meta">库存 {{ p.current_stock ?? '—' }}{{ p.unit || '' }} · 日均 {{ p.avg_daily_sales ?? '—' }}{{ p.unit || '' }}/天</div>
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
              <td class="num"><input v-model.number="d.requested_qty" class="qty-input" type="number" min="0"></td>
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

    <!-- 返利冲刺看板（前置：下单时即可看目标达成/缺口/均单建议；有期次即显示，不绑子视图） -->
    <div v-if="cross.period" class="card sprint-card" style="margin-top:14px">
      <div class="panel-hd">
        <b>📊 返利冲刺看板</b>
        <span class="tag info" v-if="cross.period">本期 · {{ cross.period.name }}</span>
        <button class="imp-x" style="margin-left:auto" @click="rebateSprintOpen = !rebateSprintOpen"><Icon :name="rebateSprintOpen ? 'chevron-up' : 'chevron-down'"/></button>
      </div>
      <div v-show="rebateSprintOpen" class="panel-body">
        <template v-if="rebateSprint.length">
          <p class="sprint-sum">
            本期（下单截止 <b>{{ cross.period && cross.period.order_end }}</b>）还剩 <b>{{ rebateSprintOrders }}</b> 次下单机会（按每 {{ REBATE_CADENCE_DAYS }} 天一单估算）。
            要补齐以下返利目标缺口，<b>均单需额外 ¥{{ fmt(sprintTotalGapPerOrder) }}</b>。
            <span class="muted">（达成 = 已填报达成 + 本期预报贡献；未填报的部分可在「目标与返利 → 达成填报」补录或 Excel 导入）</span>
          </p>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th>维度</th><th>目标对象</th><th class="num">目标</th><th class="num">已达成(填报)</th><th class="num">本期预报贡献</th><th class="num">距目标还差</th><th class="num">建议均单追加</th><th>进度</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in rebateSprint" :key="s.key">
                  <td>{{ s.dimLabel }}</td>
                  <td>{{ s.name }}</td>
                  <td class="num">¥{{ fmt(s.target) }}<template v-if="s.targetType === 'quantity'"> / 件</template></td>
                  <td class="num">{{ s.reported > 0 ? '¥' + fmt(s.reported) : '—' }}</td>
                  <td class="num">¥{{ fmt(s.contrib) }}</td>
                  <td class="num"><b :class="s.gap > 0 ? 'val-warn' : 'val-ok'">{{ s.gap > 0 ? fmt(s.gap) : '已达成' }}</b></td>
                  <td class="num" v-if="s.gap > 0">¥{{ fmt(s.perOrder) }}</td>
                  <td class="num" v-else>—</td>
                  <td style="min-width:100px"><div class="progress" :class="achProgressClass(s.ach)"><i :style="{width: Math.min(100, s.ach * 100) + '%'}"></i></div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="sprint-suggest" v-if="rebateSprintOrders > 0">
            <b>系统建议：</b>
            <ul>
              <template v-for="s in rebateSprint" :key="'sg' + s.key">
                <li v-if="s.gap > 0">
                  为「{{ s.name }}」补齐返利，剩余 {{ rebateSprintOrders }} 次下单中<b>每单多加 ¥{{ fmt(s.perOrder) }}</b>；优先加单：
                  <span v-for="p in s.top" :key="p.name" class="sprint-prod">{{ p.name }}（本期已报 ¥{{ fmt(p.contrib) }}）</span>
                </li>
              </template>
            </ul>
          </div>
        </template>
        <p v-else class="hint">尚未配置品牌 / 商品返利目标。去「目标与返利」页创建目标后，这里会在你下单时实时显示达成率、缺口与均单追加建议；实际达成可在「达成填报」补录或 Excel 导入。</p>
      </div>
    </div>

    <!-- 返利达成汇总 -->
    <div class="card rebate-section" style="margin-top:14px" v-if="rebateSummary.length">
      <div class="panel-hd"><b>厂家返利达成</b><span class="tag info">{{ rebateSummary.length }} 个合同</span></div>
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

    <ForecastHistory v-if="activeTab === 'history'" :key="historyKey" @view="onViewHistory" @delete="onHistoryDelete" @close="onHistoryClose" />

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

    <!-- 关闭期次确认弹窗（始终渲染，确保两入口可唤起） -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="closeOpen" class="imp-overlay" @click="closeOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="closeOpen" class="imp-modal del-modal">
          <div class="imp-hd"><b>关闭期次</b><button class="imp-x" @click="closeOpen = false"><Icon name="close"/></button></div>
          <div class="imp-body">
            <p class="imp-tip warn-text">确认关闭期次「{{ closeTarget && closeTarget.name }}」？关闭后该期次<b>不可再编辑</b>，仅可删除（级联删除其全部数据）。</p>
            <div class="del-actions">
              <button class="btn btn-ghost" @click="closeOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="closing" @click="confirmClose">{{ closing ? '关闭中…' : '确认关闭' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as XLSX from 'xlsx'
import { store, toast } from '../store'
import { auth, api } from '../api/client.js'
import { forecastApi, auditApi, forecastApproveApi, importApi, productsApi, forecastRecipeApi, columnSchemeApi } from '../api/modules'
import Icon from '../components/Icon.vue'
import ForecastHistory from './ForecastHistory.vue'
import ReportMapping from './ReportMapping.vue'

const periods = ref([])
const curPeriod = ref(0)
const viewPeriod = ref(null) // 往期预报「查看」回载的期次（真实或合成行）
const showNewPeriod = ref(false)
const np = ref({ name: '', order_start: '', order_end: '', arrival: '' })
const activeTab = ref('summary') // 'summary' | 'history' | 'config'

/* ---- P0-1 交叉表视图 ---- */
const viewMode = ref('cross')
const cross = ref({ period: null, units: [], rows: [], colTotals: [], grand: { sku: 0, qty: 0, amount: 0 }, reportedUnits: 0 })
const editMode = ref(true)

/* ---- 表体优化（P1/P2/P3）：分组/热力图/排序/筛选/风险徽标 ---- */
const prodMeta = ref({})            // pid -> {category, brand}，loadCross 填充
const groupBy = ref('none')         // none | category | brand
const openGroups = ref({})          // 分组折叠状态 key -> true(展开)
const sortKey = ref('none')         // none | name | qty | amount
const sortDir = ref('desc')
const hideZeroReport = ref(false)   // 仅显示有报单（填报数量>0）的商品行
const zeroReportCount = computed(() => cross.value.rows.filter(r => rowSum(r) <= 0).length)
function rowVisible(r) {
  const f = (filterText.value || findText.value || '').trim().toLowerCase()
  if (f && !(r && (r.name || '').toLowerCase().includes(f))) return false
  if (hideZeroReport.value && rowSum(r) <= 0) return false
  if (!passColFilter(r)) return false
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
  let bg = '#E1F5EE', color = '#04342C'
  if (t >= 0.85) { bg = '#1D9E75'; color = '#fff' }
  else if (t >= 0.6) { bg = '#5DCAA5'; color = '#04342C' }
  else if (t >= 0.35) { bg = '#9FE1CB'; color = '#04342C' }
  else if (t >= 0.15) { bg = '#C0DD97'; color = '#173404' }
  return { background: bg, color }
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
    else { av = rowAmount(a); bv = rowAmount(b) }
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
    rs.forEach(r => { sub.qty += rowSum(r); sub.amount += rowAmount(r) })
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
function sortInd(key) { return sortKey.value === key ? (sortDir.value === 'asc' ? ' ▲' : ' ▼') : '' }

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

function recomputeTotals() {
  const rows = cross.value.rows.filter(r => !r._deleted)
  const units = cross.value.units
  cross.value.colTotals = units.map(u => rows.reduce((s, r) => s + (r.qtyByUnit[u.name] || 0), 0))
  cross.value.grand = {
    sku: rows.length,
    qty: rows.reduce((s, r) => s + (r.total || 0), 0),
    amount: rows.reduce((s, r) => s + (r.amount || 0), 0),
  }
}
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
  if (!window.confirm('确认删除该商品行？（仅从当前视图移除，重新载入可恢复）')) return
  const r = cross.value.rows.find(x => x.product_id === pid)
  if (r) { r._deleted = true; if (selectedPid.value === pid) selectedPid.value = null; recomputeTotals() }
  toast('已删除该行', 'ok')
}
function editCell(pid, uname) { editingCell.value = { pid, uname } }
function commitCell(pid, uname, val) {
  const r = cross.value.rows.find(x => x.product_id === pid)
  if (!r) { editingCell.value = null; return }
  const v = Math.max(0, parseInt(val) || 0)
  r.qtyByUnit = { ...r.qtyByUnit, [uname]: v }
  const total = cross.value.units.reduce((s, u) => s + (r.qtyByUnit[u.name] || 0), 0)
  r.total = total
  const px = r.price != null ? r.price : displayPrice(r)
  r.amount = px != null ? total * px : r.amount
  const specNum = parseFloat(r.spec)
  r.boxes = (specNum > 0 && total) ? Math.round(total / specNum) : r.boxes
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

const colOrderList = computed(() => {
  const cols = [{ type: 'seq', key: 'seq', label: '列设置' }]
  visibleCols.value.forEach(c => cols.push({ type: 'master', key: c.key, label: c.label, cls: c.cls, fmt: c.fmt, deletable: c.deletable }))
  cross.value.units.forEach(u => cols.push({ type: 'qty', key: u.name, label: u.name }))
  cols.push({ type: 'calc', key: 'qty', label: '合计' })
  cols.push({ type: 'calc', key: 'boxes', label: '件数' })
  cols.push({ type: 'calc', key: 'extra', label: '加单' })
  cols.push({ type: 'calc', key: 'final', label: '最终下单' })
  if (showSuggest.value) cols.push({ type: 'calc', key: 'ai', label: 'AI建议' })
  cols.push({ type: 'calc', key: 'price', label: '单价(厂价)' })
  cols.push({ type: 'calc', key: 'amount', label: '下单金额' })
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
const COL_DEFAULTS = { seq: 46, name: 210, product_code: 120, category: 90, brand: 90, spec: 90, unit: 70, safety_stock: 86, expiry_days: 86, qty: 74, boxes: 70, extra: 78, final: 78, ai: 84, amount: 104, suggest: 80, comparePrev: 80, compareDelta: 80, spark: 92, yoyPrev: 80, yoyDelta: 80, sum: 74, spacer: 110, op: 64 }
function colDefault(key) { return COL_DEFAULTS[key] != null ? COL_DEFAULTS[key] : (key === 'seq' ? 46 : 90) }
function colW(key) { return colWidths.value[key] != null ? colWidths.value[key] : colDefault(key) }
function loadColWidths() { try { const s = localStorage.getItem('hergent-forecast-col-widths'); if (s) colWidths.value = JSON.parse(s) || {} } catch (e) {} }
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
  keys.push('extra')
  keys.push('amount')
  if (showSuggest.value) keys.push('suggest')
  if (compareOn.value) { keys.push('comparePrev'); keys.push('compareDelta') }
  if (showSpark.value) keys.push('spark')
  if (yoyOn.value) { keys.push('yoyPrev'); keys.push('yoyDelta') }
  keys.push('sum')
  keys.push('spacer')
  keys.push('op')
  return keys
})
function isFrozen(col) { return frozenKey.value !== 'none' && col.key === frozenKey.value }
function canSort(col) { return col.key === 'name' || col.key === 'qty' || col.key === 'amount' }
function ariaSort(col) { return sortKey.value === col.key ? (sortDir.value === 'asc' ? 'ascending' : 'descending') : 'none' }
function onHeadClick(col) { if (canSort(col)) onSort(col.key) }
function masterVal(r, col) { if (col.fmt) return col.fmt(r); const v = r[col.key]; return v != null && v !== '' ? v : '—' }
function cellText(r, col) {
  if (col.type === 'qty') return r.qtyByUnit[col.key] || 0
  if (col.type === 'master') return masterVal(r, col)
  if (col.key === 'qty') return fmt(r.total)
  if (col.key === 'boxes') return r.boxes != null ? fmt(r.boxes) : '—'
  if (col.key === 'extra') return fmt(r.extra_qty || 0)
  if (col.key === 'final') return fmt((r.total || 0) + (r.extra_qty || 0))
  if (col.key === 'ai') return r.ai != null ? fmt(r.ai) : '—'
  if (col.key === 'price') return r.purchase_price != null ? fmt(r.purchase_price) : '—'
  if (col.key === 'amount') { const fq = (r.total || 0) + (r.extra_qty || 0); return r.purchase_price != null ? fmt(fq * r.purchase_price) : '缺价' }
  return ''
}
function cellAria(r, col) { if (col.type === 'seq') return '序号：' + (r.seq || '') ; return col.label + '：' + cellText(r, col) }
function rowAria(r) { const fq = (r.total || 0) + (r.extra_qty || 0); return r.name + '，合计 ' + fmt(r.total) + '，加单 ' + fmt(r.extra_qty || 0) + '，最终下单 ' + fmt(fq) + '，下单金额 ¥' + fmt(fq * (r.purchase_price || 0)) }
function rowKey(it) { return it.kind === 'group' ? 'grp-' + it.key : it.kind === 'row' ? 'row-' + it.r.product_id : 'det-' + it.r.product_id }
function cellActive(it, ci) { return it.kind === 'row' && it.r.product_id === activeCell.value.pid && ci === activeCell.value.ci }
function riskText(r) {
  const parts = []
  const w = rowWarn(r); if (w === 'low') parts.push('低于安全库存'); else if (w === 'short') parts.push('短保≤7天')
  const l = lossWarn(r); if (l) parts.push('货损风险')
  const rt = rtBadge(r); if (rt) parts.push('库存预警')
  if (gapSet.has(r.product_id)) parts.push('缺批次/到期')
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
function onScroll(e) { scrollTop.value = e.target.scrollTop; if (scrollEl.value) viewportH.value = scrollEl.value.clientHeight; if (crossFoot.value) crossFoot.value.scrollLeft = e.target.scrollLeft }
function onEditScroll(e) { if (editFoot.value) editFoot.value.scrollLeft = e.target.scrollLeft }
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
      const uStart = visibleCols.value.length, uEnd = uStart + cross.value.units.length
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
const MASTER_COL_DEFS = [
  { key: 'brand', label: '品牌', cls: 'fc-text', edit: 'text', deletable: true },
  { key: 'barcode', label: '条码', cls: 'fc-code', edit: 'text', deletable: false },
  { key: 'spec', label: '规格', cls: 'fc-text', edit: 'text', deletable: true },
  { key: 'unit', label: '单位', cls: 'fc-text', edit: 'text', deletable: true, options: ['件', '箱', '提', '杯', '袋', '瓶', '盒', '托', '板', '根'] },
  { key: 'sale_price', label: '标准售价', cls: 'fc-num', edit: 'num', deletable: false, fmt: r => r.sale_price ? r.sale_price.toFixed(2) : '—' },
  { key: 'purchase_price', label: '进价', cls: 'fc-num', edit: 'num', deletable: true },
  { key: 'dist_price', label: '分销价', cls: 'fc-num', edit: 'num', deletable: false, fmt: r => r.dist_price ? r.dist_price.toFixed(2) : '—' },
  { key: 'product_code', label: '厂家编码', cls: 'fc-code', edit: 'text', deletable: false },
  { key: 'safety_stock', label: '安全库存', cls: 'fc-num', edit: 'num', num: 'int', deletable: true },
  { key: 'expiry_days', label: '保质期天', cls: 'fc-num', edit: 'num', num: 'int', deletable: true },
  { key: 'moq', label: '起订量', cls: 'fc-num', edit: 'num', num: 'int', deletable: true },
  { key: 'lead_days', label: '到货天数', cls: 'fc-num', edit: 'num', num: 'int', deletable: true },
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
      MASTER_COL_DEFS.forEach(m => { if (!have.has(m.key)) merged.push({ key: m.key, label: m.label, cls: m.cls }) })
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
  return colOrder.value
    .filter(c => c.key === 'name' || colVis.value[c.key] !== false)
    .filter(c => c.key === 'name' || canSeeCol(c.key))   // 列级权限：角色无权的列直接剔除
    .map(c => {
      if (c.key === 'name') return { key: 'name', label: '商品名称', fixed: true, cls: 'fc-name' }
      const m = defMap[c.key] || {}
      const opts = c.key === 'brand' ? (brandOptions.value && brandOptions.value.length ? brandOptions.value : m.options) : m.options
      return { key: c.key, label: c.label, cls: c.cls || m.cls, fixed: false,
        edit: c.edit || m.edit, deletable: c.deletable !== undefined ? c.deletable : m.deletable,
        fmt: m.fmt, options: opts, custom: !!c.custom }
    })
})
const addableMasterCols = computed(() => MASTER_COL_DEFS.filter(m => !colOrder.value.find(c => c.key === m.key)))

/* ---- 列级权限（角色可见性网关）----
   借鉴企业微信智能表格「字段列级权限」。敏感列(进价/分销价/标准售价)按业务角色可见。
   角色来源：登录返回 role > 本地切换(hergent_biz_role) > 默认 owner(全可见)。
   说明：本层只做前端展示级隐藏；真实数据隔离仍需后端 DataSourceAdapter 行/列过滤（生产安全基线）。 */
const BIZ_ROLES = ['owner', 'finance', 'sales', 'promoter', 'supervisor', 'dealer']
const ROLE_LABELS = { owner: '老板', finance: '财务', sales: '销售', promoter: '促销', supervisor: '督导', dealer: '经销商' }
// 列权限：key -> 允许查看的角色；未列出的列所有人可见
const COLUMN_PERMISSIONS = {
  purchase_price: ['owner', 'finance'],                                  // 进价（成本）
  dist_price: ['owner', 'finance'],                                     // 分销价（毛利相关）
  sale_price: ['owner', 'finance', 'sales', 'supervisor'],              // 标准售价
}
const BIZ_ROLE_KEY = 'hergent_biz_role'
const bizRole = ref((store.user && store.user.role) || localStorage.getItem(BIZ_ROLE_KEY) || 'owner')
function setBizRole(r) {
  bizRole.value = r
  try { localStorage.setItem(BIZ_ROLE_KEY, r) } catch (e) {}
  if (store.user) store.user.role = r
}
function canSeeCol(key) {
  const allow = COLUMN_PERMISSIONS[key]
  return !allow || allow.includes(bizRole.value)
}

function toggleCol(key) {
  if (key === 'name') return
  // colVis[key]: undefined/true=显示, false=隐藏。点击切换为相反态。
  colVis.value[key] = colVis.value[key] === false ? true : false
  _persistCols()
}
function quickHide(key) {
  if (key === 'name') return
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
function deleteMasterCol(key) {
  colOrder.value = colOrder.value.filter(c => c.key !== key)
  delete colVis.value[key]
  _persistCols()
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
async function enterEdit() {
  // 编辑网格渲染在交叉表区域内，无论从哪个视图点进来都先切到交叉表视图
  viewMode.value = 'cross'
  editMode.value = true
  await loadEditGrid()
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
  try {
    const [prods, d] = await Promise.all([
      productsApi.grid(),
      forecastApproveApi.summary('', p.order_start || '', p.order_end || ''),
    ])
    confirmInfo.value = (d.confirmed || null)
    const srcByPid = {}
    const units = []
    const _seenUnit = new Set()
    // ① 跨期持久的客户名册：即使当期无报单，也保留客户列（与后端占位机制互补）
    ;(d.all_units || []).forEach(name => {
      if (name && !_seenUnit.has(name)) { _seenUnit.add(name); units.push({ name, role: '' }) }
    })
    // ② 当期来源：补齐 quantity 与 role（当期有报单的客户优先带角色/数量）
    ;(d.rows || []).forEach(r => {
      srcByPid[r.product_id] = r.sources || []
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
    // 行级加单（业务经理按进度追加）：从 summary 的 extra_qty 注入每行
    const extraByPid = {}
    ;(d.rows || []).forEach(r => { if (r.product_id) extraByPid[r.product_id] = r.extra_qty || 0 })
    let rows = (prods.items || []).map(pd => {
      const qtyByUnit = {}
      ;(srcByPid[pd.id] || []).forEach(s => {
        const name = s.store || s.store_name || '未署名'
        qtyByUnit[name] = (qtyByUnit[name] || 0) + (s.qty || 0)
      })
      return {
        product_id: pd.id, name: pd.name, barcode: pd.barcode || '', spec: pd.spec || '', unit: pd.unit || '件',
        sale_price: pd.sale_price || 0, purchase_price: pd.purchase_price || 0,
        safety_stock: pd.safety_stock || 0, expiry_days: pd.expiry_days || 0,
        product_code: pd.product_code || '', dist_price: pd.dist_price || 0,
        price: pd.sale_price || 0, qtyByUnit, extraQty: extraByPid[pd.id] || 0, ai: null, suggest: 0, history: [],
      }
    })
    let colTotals = units.map(u => rows.reduce((s, r) => s + (r.qtyByUnit[u.name] || 0), 0))
    cross.value = {
      period: p, units, rows, colTotals,
      grand: { sku: rows.length, qty: rows.reduce((s, r) => s + Object.values(r.qtyByUnit).reduce((a, b) => a + (parseInt(b) || 0), 0), 0), amount: 0 },
      reportedUnits: units.length,
    }
    // 恢复本地草稿（未提交数据），但绝不允许草稿冲掉服务端客户列：
    // 列集始终以服务端 all_units 为准，草稿仅叠加单元格值 + 补回本地新增列。
    const dr = loadDraft()
    if (dr && dr.rows && dr.rows.length) {
      // 1) 草稿里服务端没有的本地新增列（如右键加列未提交）补回来
      ;(dr.units || []).forEach(du => {
        const nm = du && du.name ? du.name : du
        if (nm && !_seenUnit.has(nm)) { _seenUnit.add(nm); units.push({ name: nm, role: (du && du.role) || '' }) }
      })
      // 2) 用草稿单元格值覆盖（草稿是用户最新未提交编辑），按列名对齐到服务端列集
      const draftByPid = {}
      ;(dr.rows || []).forEach(r => { draftByPid[r.product_id] = r.qtyByUnit || {} })
      rows.forEach(r => {
        const dq = draftByPid[r.product_id]
        const merged = {}
        units.forEach(u => {
          merged[u.name] = (dq && dq[u.name] !== undefined) ? dq[u.name] : (r.qtyByUnit[u.name] || 0)
        })
        r.qtyByUnit = merged
      })
      colTotals = units.map(u => rows.reduce((s, r) => s + (Number(r.qtyByUnit[u.name]) || 0), 0))
      cross.value = {
        period: p, units, rows, colTotals,
        grand: { sku: rows.length, qty: rows.reduce((s, r) => s + Object.values(r.qtyByUnit).reduce((a, b) => a + (parseInt(b) || 0), 0), 0), amount: 0 },
        reportedUnits: units.length,
      }
      draftRestored.value = true
      _ignoreNextWatch = 1
    } else {
      _ignoreNextWatch = 1
    }
    applyCustVals()
    compareOn.value = false
    snapCompare.value = null
    loadSnaps()
    loadSchemes()
    loadSuggestRecipes()
    loadMoq()
    loadNotes()
    loadCloudNotes()
    loadRealtimeWarn()
    loadSubmission()
    loadAuditLog()
    loadGaps()
    loadSafety()
    _alertedThisLoad = false
    pagingOn.value = false; curPage.value = 0; findIdx.value = -1
  } catch (e) {
    toast('商品清单加载失败: ' + (e.message || ''), 'error')
  }
}

function exitEdit() {
  editMode.value = false
  loadCross()  // 放弃修改，回到只读
}

function rowSum(r) {
  return Object.values(r.qtyByUnit || {}).reduce((s, v) => s + (parseInt(v) || 0), 0)
}

function addRow() {
  snapshot()
  cross.value.rows.push(blankRow())
}

function delRow(ri) {
  snapshot()
  cross.value.rows.splice(ri, 1)
}

function addCol(ev) {
  const v = (ev.target.value || '').trim()
  if (!v) return
  if (cross.value.units.find(u => u.name === v)) return
  snapshot()
  cross.value.units.push({ name: v, role: '' })
  cross.value.rows.forEach(r => { if (!(v in r.qtyByUnit)) r.qtyByUnit[v] = 0 })
  ev.target.value = ''
}

function renameCol(ui, newName) {
  snapshot()
  const u = cross.value.units[ui]
  const oldName = u.name
  const v = String(newName || '').trim()
  if (!v || v === oldName) return
  if (cross.value.units.find(x => x.name === v)) return
  cross.value.rows.forEach(r => {
    if (oldName in r.qtyByUnit) {
      r.qtyByUnit[v] = r.qtyByUnit[oldName]
      delete r.qtyByUnit[oldName]
    }
  })
  u.name = v
}

function delCol(ui) {
  snapshot()
  const u = cross.value.units[ui]
  cross.value.units.splice(ui, 1)
  cross.value.rows.forEach(r => { delete r.qtyByUnit[u.name] })
}

async function saveEdits() {
  const p = cross.value.period
  if (!p) return
  // 提交前校验：列类型非法（负数/非数字/非整数）拦截
  let bad = 0
  cross.value.rows.forEach((r, ri) => {
    const nc = visibleCols.value.length
    for (let ci = 0; ci < nc + cross.value.units.length; ci++) if (cellInvalid(ri, ci)) bad++
  })
  if (bad) { toast(`存在 ${bad} 个单元格录入不合法，请先修正再保存`, 'err'); return }
  savingEdit.value = true
  try {
    // 1) 商品主档（网格直编 / 粘贴）—— 先落商品，再落数量矩阵
    const prodRows = cross.value.rows
      .map(r => ({
        name: r.name || '', barcode: r.barcode || '', spec: r.spec || '', unit: r.unit || '件',
        sale_price: r.sale_price || 0, purchase_price: r.purchase_price || 0,
        safety_stock: r.safety_stock || 0, expiry_days: r.expiry_days || 0,
        product_code: r.product_code || '', dist_price: r.dist_price || 0,
        brand: r.brand || '',
        moq: r.moq || 0, lead_days: r.lead_days || 0,
      }))
      .filter(r => r.name || r.barcode)
    let prodMsg = ''
    if (prodRows.length) {
      const pr = await productsApi.bulkUpsert(prodRows)
      prodMsg = ` · 商品 ${pr.inserted} 新增 / ${pr.updated} 更新`
    }
    // 2) 数量矩阵（保持原 save_matrix 语义：幂等覆盖本期『导入』数据）
    const payload = {
      start: p.order_start, end: p.order_end,
      customers: cross.value.units.map(u => u.name),
      rows: cross.value.rows.map(r => ({
        product_id: r.product_id || 0, product_name: r.name || '', spec: r.spec || '',
        unit: r.unit || '件', price: r.sale_price || 0, qty_by_unit: r.qtyByUnit || {},
        extra_qty: Number(r.extraQty) || 0,
      })),
    }
    const r = await forecastApproveApi.saveMatrix(payload)
    if (!r.success) throw new Error(r.error || '保存失败')
    syncMoq()
    saveCloudNotes()
    recordAudit('save_changes', `保存预报单调整（${r.saved_customers} 客户 / ${r.saved_items} 明细）`)
    toast(`已保存：${r.saved_customers} 个客户 · ${r.saved_items} 条商品明细${prodMsg}`, 'ok')
    clearDraft()
    collectCustVals()
    undoStack.value = []; redoStack.value = []
    // 保持编辑态并刷新（粘贴/新增的商品留在表里可见）
    await loadEditGrid()
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'err')
  } finally {
    savingEdit.value = false
  }
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
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length)
  if (!lines.length) return
  const HEADER_KEYS = {
    '名称': 'name', '商品名称': 'name', '货品': 'name', '条码': 'barcode', '条形码': 'barcode',
    '厂家编码': 'product_code', '永辉代码': 'product_code', '客户代码': 'product_code', '产品编码': 'product_code', '货号': 'product_code',
    '规格': 'spec', '单位': 'unit', '售价': 'sale_price', '单价': 'sale_price', '销售价': 'sale_price',
    '分销价': 'dist_price', '分销价格': 'dist_price', '批发价': 'dist_price',
    '进价': 'purchase_price', '成本价': 'purchase_price', '采购价': 'purchase_price',
    '安全库存': 'safety_stock', '库存下限': 'safety_stock', '保质期': 'expiry_days', '保质期天数': 'expiry_days',
  }
  const first = lines[0].split('\t').map(s => s.trim())
  let headerMap = null, startIdx = 0
  const known = first.filter(h => HEADER_KEYS[h]).length
  if (known >= 2) {
    headerMap = first.map(h => HEADER_KEYS[h] || null)
    startIdx = 1
  } else {
    // 无表头：默认顺序 名称/条码/规格/单位/售价/分销价/厂家编码/进价/安全库存/保质期
    headerMap = ['name', 'barcode', 'spec', 'unit', 'sale_price', 'dist_price', 'product_code', 'purchase_price', 'safety_stock', 'expiry_days']
  }
  let added = 0
  snapshot()
  for (let i = startIdx; i < lines.length; i++) {
    const cells = lines[i].split('\t')
    const row = { product_id: 0, name: '', barcode: '', spec: '', unit: '件',
      sale_price: 0, purchase_price: 0, safety_stock: 0, expiry_days: 0, product_code: '', dist_price: 0,
      price: 0, qtyByUnit: {}, ai: null }
    headerMap.forEach((key, ci) => {
      if (!key) return
      const v = (cells[ci] || '').trim()
      if (key === 'sale_price' || key === 'purchase_price' || key === 'safety_stock' || key === 'expiry_days' || key === 'dist_price') row[key] = parseFloat(v) || 0
      else row[key] = v
    })
    if (!row.name && !row.barcode) continue
    cross.value.rows.push(row)
    added++
  }
  if (added) toast(`已从 Excel 粘贴 ${added} 行商品（改完点「保存」落库）`, 'ok')
}
const savingEdit = ref(false)
const confirmInfo = ref(null)  // 2026-08-27：期次确认（经理保存汇总表=审批定稿）状态，老板进汇总表一眼看出是否已定稿

/* ---- Excel 式交互（单元格选中 / 方向键导航 / 右键行列菜单 / 填充柄） ---- */
// 选中单元格坐标：r=行索引, c=统一列索引（主档列 0..n-1，客户列 n..n+m-1；操作列不参与导航）
const selected = ref({ r: -1, c: -1 })
const ctx = ref({ show: false, x: 0, y: 0, r: -1, c: -1, type: '', key: '', ui: -1, deletable: false })
const fillEnd = ref({ r: -1, c: -1 })
let _fillStart = null
const ctxMenuStyle = computed(() => {
  const wh = typeof window !== 'undefined' ? window.innerHeight : 800
  const ww = typeof window !== 'undefined' ? window.innerWidth : 400
  return { top: Math.min(ctx.value.y, wh - 230) + 'px', left: Math.min(ctx.value.x, ww - 190) + 'px' }
})
// 右键菜单：当前单元格是否为数字列（用于「按安全库存补齐」显隐）
const ctxNumCell = computed(() => {
  const v = ctx.value
  if (v.type === 'qty') return true
  if (v.type === 'master') { const col = visibleCols.value[v.c]; return !!(col && col.edit === 'num') }
  return false
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
const colStats = ref(null)         // { label, numeric, sum, avg, min, max, count, empty, distinct, sample }
const hdrWidthVal = ref(120)       // 精确列宽输入
const uniqAll = ref(false)         // 唯一值筛选：全选
// 列统计：取某行在某列上的「数值」（可统计列返回 number，否则返回 null 视为文本列）
const NUMERIC_MASTER = { sale_price: 1, purchase_price: 1, dist_price: 1, safety_stock: 1, expiry_days: 1, moq: 1, lead_days: 1 }
function colStatVal(r, desc) {
  if (!r) return null
  if (desc.type === 'qty') return Number(r.qtyByUnit[desc.key] || 0)
  if (desc.type === 'master') {
    if (desc.edit === 'num' || NUMERIC_MASTER[desc.key]) return Number(r[desc.key] || 0)
    return String(r[desc.key] != null ? r[desc.key] : '')
  }
  // calc 列
  switch (desc.key) {
    case 'amount': return r.amount != null ? Number(r.amount) : null
    case 'qty': return Number(r.total || 0)
    case 'boxes': return r.boxes != null ? Number(r.boxes) : null
    case 'final': return r.decided ? Number(r.final_qty || 0) : null
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
      label: desc.label, numeric: true,
      sum, avg, min: Math.min(...nums), max: Math.max(...nums),
      count: nums.length, empty: texts.filter(t => !t).length,
      distinct: 0, sample: ''
    }
  } else {
    const nonEmpty = texts.filter(t => t !== '')
    const dist = new Set(nonEmpty)
    colStats.value = {
      label: desc.label, numeric: false,
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
  const lblMap = { amount: '下单金额', suggest: 'AI建议', comparePrev: '上期量', compareDelta: 'Δ', spark: '趋势', yoyPrev: '去年同期', yoyDelta: '同比', sum: '合计' }
  return { type: 'calc', key, label: lblMap[key] || key }
}
// 分组小计：仅文本型主档列可分组
function groupableCol(key) { return ['product_code', 'unit', 'spec', 'category', 'brand'].includes(key) }

// 商品档案弹层
const prodProfile = ref(null)
// 选区统计（求和/平均/计数）
const selStats = computed(() => {
  const sr = selRange.value
  if (!sr) return null
  const nums = []
  for (let r = sr.r0; r <= sr.r1; r++) {
    const rw = cross.value.rows[r]; if (!rw) continue
    for (let c = sr.c0; c <= sr.c1; c++) {
      let v
      if (c < visibleCols.value.length) { const col = visibleCols.value[c]; if (!col || col.edit !== 'num') continue; v = rw[col.key] }
      else { const ui = c - visibleCols.value.length; v = rw.qtyByUnit[cross.value.units[ui].name] }
      const n = Number(v)
      if (v !== '' && v != null && !isNaN(n)) nums.push(n)
    }
  }
  if (!nums.length) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return { count: nums.length, sum, avg: sum / nums.length }
})

function blankRow() {
  return { product_id: 0, name: '', barcode: '', spec: '', unit: '件',
    sale_price: 0, purchase_price: 0, safety_stock: 0, expiry_days: 0, product_code: '', dist_price: 0,
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
function focusCell(r, c) {
  nextTick(() => {
    const el = document.querySelector(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) { el.focus(); if (el.select) { try { el.select() } catch (e) {} } }
  })
}
// 键盘导航：Enter 下移 / Shift+Enter 上移 / Tab 右移(到头换下一行) / Shift+Tab 左移 / Esc 取消选中
function onGridKey(e) {
  if (!editMode.value) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return }
  const maxC = visibleCols.value.length + cross.value.units.length - 1
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
    snapshot()
    for (let ri = sr + 1; ri <= er; ri++) writeCellVal(ri, sc, src)
    toast('已向下填充', 'ok')
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
    e.preventDefault(); focusCell(r, c)
  } else if (e.key === 'Escape') {
    selected.value = { r: -1, c: -1 }
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
  ctx.value = { show: true, x: e.clientX, y: e.clientY, r, c, type, key, ui, deletable }
}
function closeCtx() { ctx.value.show = false }
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
  let base = cross.value.units.length + 1, i = 1, name = '新客户' + base
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
function ctxClearCell() {
  snapshot()
  const { r, c, type, key, ui } = ctx.value
  const rw = cross.value.rows[r]
  if (rw) {
    if (type === 'qty') rw.qtyByUnit[cross.value.units[ui].name] = 0
    else if (type === 'master') rw[key] = (visibleCols.value[c] && visibleCols.value[c].edit === 'num') ? 0 : ''
  }
  closeCtx()
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
  hermesCtx.value = `我是低温奶经销商，请基于以下商品分析本期订货建议，重点说明：是否合理、库存/货损风险、可优化点。\n商品：${r.name}（规格 ${r.spec || '—'} ${r.unit || ''}）\n安全库存：${r.safety_stock || 0}　保质期：${r.expiry_days || 0}天\n各报单单元订量：${units || '无'}\n合计：${r.total || 0}${r.unit || ''}　下单金额：¥${fmt(r.amount)}\n系统AI建议：${r.ai != null ? r.ai : '—'}\n历史销量：${hist || '无'}`
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
  const last = visibleCols.value.length + cross.value.units.length - 1
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
  const m = { amount: '下单金额', suggest: 'AI建议', comparePrev: '上期量', compareDelta: 'Δ', spark: '趋势', yoyPrev: '去年同期', yoyDelta: '同比', sum: '合计' }
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
  frozenExtra.value = (frozenExtra.value === k) ? '' : k
  closeHdrCtx()
}

/* ---- 表头右键：修改字段 / 增加列 / 删除列（master 主档列 + qty 报单单元列通用）---- */
// 主档列是否可删除：自定义列恒可删；其余以 MASTER_COL_DEFS.deletable 为准
function canDeleteMaster(key) {
  const c = colOrder.value.find(x => x.key === key)
  if (c && c.custom) return true
  const m = MASTER_COL_DEFS.find(x => x.key === key)
  return !!(m && m.deletable)
}
// 自定义主档列的值：存 localStorage（按 条码::名称 定位商品），使其跨保存/刷新留存
const CUSTVAL_KEY = 'forecast_customvals_v1'
function _loadCustVals() { try { return JSON.parse(localStorage.getItem(CUSTVAL_KEY) || '{}') } catch (e) { return {} } }
function _saveCustVals(map) { try { localStorage.setItem(CUSTVAL_KEY, JSON.stringify(map)) } catch (e) {} }
function _prodKeyOf(r) { return (r.barcode || '') + '::' + (r.name || '') }
function applyCustVals() {
  const map = _loadCustVals()
  const custKeys = colOrder.value.filter(c => c.custom).map(c => c.key)
  if (!custKeys.length || !cross.value.rows) return
  cross.value.rows.forEach(r => {
    const m = map[_prodKeyOf(r)]
    if (m) custKeys.forEach(k => { if (k in m) r[k] = m[k] })
  })
}
function collectCustVals() {
  const map = _loadCustVals()
  const custKeys = colOrder.value.filter(c => c.custom).map(c => c.key)
  if (!custKeys.length || !cross.value.rows) return
  cross.value.rows.forEach(r => {
    const pk = _prodKeyOf(r)
    if (!map[pk]) map[pk] = {}
    custKeys.forEach(k => { map[pk][k] = r[k] != null ? r[k] : '' })
  })
  _saveCustVals(map)
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
function applyHdrAdd() {
  const v = (hdrAddName.value || '').trim()
  const { type } = hdrCtx.value
  if (v) {
    if (type === 'qty') {
      if (!cross.value.units.find(u => u.name === v)) {
        snapshot()
        cross.value.units.push({ name: v, role: '' })
        cross.value.rows.forEach(r => { if (!(v in r.qtyByUnit)) r.qtyByUnit[v] = 0 })
      }
    } else {
      addCustomMasterCol(v, hdrAddType.value)
    }
  }
  closeHdrCtx()
}
function addCustomMasterCol(name, editType) {
  let key = 'cust_' + Date.now().toString(36)
  while (colOrder.value.find(c => c.key === key)) key = 'cust_' + Math.random().toString(36).slice(2, 8)
  snapshot()
  const newCol = { key, label: name, cls: editType === 'num' ? 'fc-num' : 'fc-text', edit: editType, deletable: true, custom: true }
  const idx = colOrder.value.findIndex(c => c.key === hdrCtx.value.key)
  if (idx >= 0) colOrder.value.splice(idx + 1, 0, newCol)
  else colOrder.value.push(newCol)
  colVis.value[key] = true
  const def = editType === 'num' ? 0 : ''
  cross.value.rows.forEach(r => { if (!(key in r)) r[key] = def })
  _persistCols()
}
// 删除列
function hdrDeleteCol() {
  const { key, type } = hdrCtx.value
  if (type === 'qty') {
    const ui = cross.value.units.findIndex(u => u.name === key)
    if (ui >= 0) delCol(ui)
  } else {
    // 自定义列：同时清掉留存的值映射
    if (colOrder.value.find(c => c.key === key && c.custom)) {
      const map = _loadCustVals()
      Object.keys(map).forEach(pk => { delete map[pk][key]; if (!Object.keys(map[pk]).length) delete map[pk] })
      _saveCustVals(map)
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
  headers.push('金额')
  headers.push('建议')
  const data = [headers]
  rows.forEach(r => {
    const line = []
    line.push(r.name || '')
    visibleCols.value.forEach(c => { if (c.key !== 'name') line.push(c.fmt ? (r[c.key] != null ? r[c.key] : '') : (r[c.key] || '')) })
    cross.value.units.forEach(u => line.push(r.qtyByUnit[u.name] || 0))
    line.push(rowAmount(r))
    line.push(r.suggest || 0)
    data.push(line)
  })
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '预报单')
  XLSX.writeFile(wb, `${fname}.xlsx`)
}
// 填充柄：从选中单元格拖拽，复制填充到矩形范围（兼容主档列 + 客户数量列）
function readCellVal(r, c) {
  const rw = cross.value.rows[r]; if (!rw) return ''
  if (c < visibleCols.value.length) { const k = visibleCols.value[c].key; return rw[k] ?? '' }
  const ui = c - visibleCols.value.length
  if (ui < cross.value.units.length) return rw.qtyByUnit[cross.value.units[ui].name] || 0
  return ''
}
function writeCellVal(r, c, v) {
  const rw = cross.value.rows[r]; if (!rw) return
  if (c < visibleCols.value.length) {
    const col = visibleCols.value[c]
    rw[col.key] = col.edit === 'num' ? (parseFloat(v) || 0) : (v == null ? '' : String(v))
  } else {
    const ui = c - visibleCols.value.length
    if (ui < cross.value.units.length) rw.qtyByUnit[cross.value.units[ui].name] = parseFloat(v) || 0
  }
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
  for (let ri = r0; ri <= r1; ri++)
    for (let ci = c0; ci <= c1; ci++) writeCellVal(ri, ci, val)
  toast(`已批量写入 ${(r1 - r0 + 1) * (c1 - c0 + 1)} 个单元格`, 'ok')
}
// 批量清除：清空选区（或单格）内容（Delete / Backspace，非编辑态）
function clearRange() {
  const sr = selRange.value
    ? selRange.value
    : (selected.value.r >= 0 ? { r0: selected.value.r, c0: selected.value.c, r1: selected.value.r, c1: selected.value.c } : null)
  if (!sr) return
  snapshot()
  const { r0, c0, r1, c1 } = sr
  for (let ri = r0; ri <= r1; ri++)
    for (let ci = c0; ci <= c1; ci++) writeCellVal(ri, ci, '')
  toast(`已清除 ${(r1 - r0 + 1) * (c1 - c0 + 1)} 个单元格`, 'ok')
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
function copyColumn(unitName) {
  const lines = []
  cross.value.rows.forEach(r => {
    const q = parseInt(r.qtyByUnit[unitName] || 0)
    if (!q) return
    const code = _rowCode(r)
    if (!code) return
    lines.push(`${code}\t${q}`)
  })
  _copyText(lines.join('\n'), `「${unitName}」${lines.length} 行`)
}

/* ---- 增强：撤销/重做 · 校验 · 区域复制 · 金额 · 草稿 · 筛选 · 口径 · 导出 ---- */
// 价格口径：dist=分销价 / sale=标准售价
const priceBasis = ref('dist')
function displayPrice(r) {
  const v = priceBasis.value === 'dist' ? (r.dist_price || 0) : (r.sale_price || 0)
  return v ? v : null
}
// 筛选（商品名）
const filterText = ref('')
function rowShown(ri) {
  const f = (filterText.value || findText.value || '').trim().toLowerCase()
  if (f) {
    const r = cross.value.rows[ri]
    if (!(r && (r.name || '').toLowerCase().includes(f))) return false
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
function applySort() {
  snapshot()
  const rows = cross.value.rows
  if (sortMode.value === 'asc') rows.sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'zh'))
  else if (sortMode.value === 'desc') rows.sort((a, b) => (b.name || '').localeCompare((a.name || ''), 'zh'))
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
function snapshot() {
  undoStack.value.push(clone(cross.value))
  if (undoStack.value.length > 200) undoStack.value.shift()
  redoStack.value = []
}
function undo() {
  if (!undoStack.value.length) return
  redoStack.value.push(clone(cross.value))
  cross.value = undoStack.value.pop()
  clampSelection()
  toast('已撤销', 'ok')
}
function redo() {
  if (!redoStack.value.length) return
  undoStack.value.push(clone(cross.value))
  cross.value = redoStack.value.pop()
  clampSelection()
  toast('已重做', 'ok')
}
function clampSelection() {
  const nr = Math.max(0, cross.value.rows.length - 1)
  const nc = Math.max(0, visibleCols.value.length + cross.value.units.length - 1)
  if (selected.value.r > nr) selected.value.r = nr
  if (selected.value.c > nc) selected.value.c = nc
  if (selected.value.r < 0) selected.value.r = -1
}
function normRange(r0, c0, r1, c1) {
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) }
}
function inRange(r, c) {
  if (!selRange.value) return false
  const { r0, c0, r1, c1 } = selRange.value
  return r >= r0 && r <= r1 && c >= c0 && c <= c1
}
// 单元格聚焦时记录编辑前快照；change 时入栈（驱动撤销）
function onFocusCell(r, c) {
  selectCell(r, c)
  if (!_pendingSnap) _pendingSnap = clone(cross.value)
}
function onCellChange() {
  if (!_pendingSnap) return
  const cur = clone(cross.value)
  if (JSON.stringify(cur) !== JSON.stringify(_pendingSnap)) {
    undoStack.value.push(_pendingSnap)
    if (undoStack.value.length > 200) undoStack.value.shift()
    redoStack.value = []
  }
  _pendingSnap = null
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
  const maxC = visibleCols.value.length + cross.value.units.length - 1
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
// 区块单元格粘贴：从选中格（或选区左上角）起逐格写入，行超界自动补空商品行、列超界截断
function pasteRegion(text) {
  const block = parseTSV(text)
  if (!block.length || !block[0].length) return
  const rows = block.length, cols = block[0].length
  let sr, sc
  if (selRange.value) { sr = selRange.value.r0; sc = selRange.value.c0 }
  else { sr = selected.value.r; sc = selected.value.c }
  if (sr < 0 || sc < 0) return
  const maxC = visibleCols.value.length + cross.value.units.length - 1
  let useCols = cols, truncated = false
  if (sc + cols - 1 > maxC) { useCols = Math.max(0, maxC - sc + 1); truncated = true }
  const needRows = sr + rows
  while (cross.value.rows.length < needRows) cross.value.rows.push(blankRow())
  snapshot()
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < useCols; j++)
      writeCellVal(sr + i, sc + j, block[i][j])
  toast(`已粘贴 ${rows}×${useCols}` + (truncated ? '（右侧列超出表格已截断）' : ''), 'ok')
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
      // options 仅作输入候选提示（datalist 下拉），不强制校验；如需强制枚举约束的列，设 enforceOptions:true
      if (col.options && col.options.length && col.enforceOptions && raw !== '' && raw != null && raw !== undefined && !col.options.includes(String(raw)))
        return '应为：' + col.options.join('/') + ' 之一'
      return ''                                  // 文本列（无枚举）不校验
    }
    isNum = true; isInt = col.num === 'int'
    raw = rw[col.key]
  } else {
    const ui = c - visibleCols.value.length
    if (ui >= cross.value.units.length) return ''
    const k = cross.value.units[ui].name
    isNum = true; isInt = true                    // 客户数量=非负整数
    raw = rw.qtyByUnit[k]
  }
  if (raw === '' || raw === null || raw === undefined) return ''   // 空=未填=合法(0)
  const n = typeof raw === 'number' ? raw : parseFloat(raw)
  if (Number.isNaN(n)) return '必须是数字'
  if (n < 0) return '不能为负数'
  if (isInt && !Number.isInteger(n)) return '必须为整数'
  return ''
}
function cellInvalid(r, c) { return cellErrMsg(r, c) !== '' }
// 金额：分销价 × 行总件数
function rowAmount(r) { return (parseFloat(r.dist_price) || 0) * rowSum(r) }
const editTotalQty = computed(() => cross.value.rows.reduce((s, r) => s + rowSum(r), 0))
const editTotalAmount = computed(() => cross.value.rows.reduce((s, r) => s + rowAmount(r), 0))

// 本地草稿：未提交前自动缓存，刷新可恢复；保存后清除
const draftRestored = ref(false)
const DRAFT_KEY = () => 'forecast_draft_' + (cross.value.period ? cross.value.period.id : 'default')
let _ignoreNextWatch = 0
function saveDraftNow() {
  try { localStorage.setItem(DRAFT_KEY(), JSON.stringify(cross.value)) } catch (e) {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY()) } catch (e) {}
  draftRestored.value = false
  toast('已放弃草稿', 'ok')
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
  if (f) rows = rows.filter(r => (r.name || '').toLowerCase().includes(f))
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
    if (!ok) { toast('历史不足，无法用「' + recipeLabel(recipe.strategy) + '」计算（先点「载入趋势」）', 'warn'); return }
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
  try { await forecastRecipeApi.save(list) } catch (e) {}            // 云端同步（静默）
  loadSuggestRecipes(); recipePick.value = n; toast('已存为配方「' + n + '」', 'ok')
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
    const d = await forecastApproveApi.summary('', base.order_start || '', base.order_end || '')
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

// P3-4 冻结小计行
const foot = computed(() => {
  const rows = cross.value.rows
  const masterSum = {}
  visibleCols.value.forEach(c => { if (c.key !== 'name' && c.edit === 'num') masterSum[c.key] = rows.reduce((s, r) => s + (parseFloat(r[c.key]) || 0), 0) })
  const unitSum = cross.value.units.map(u => rows.reduce((s, r) => s + (parseInt(r.qtyByUnit[u.name]) || 0), 0))
  return { masterSum, unitSum, qty: editTotalQty.value, amount: editTotalAmount.value, suggest: totalSuggest.value }
})

// P3-6 行内 sparkline（近 6 期趋势，按需载入）
const showSpark = ref(false)
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
    const d = await forecastApproveApi.summary('', pp.order_start || '', pp.order_end || '')
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
async function loadSchemes() {
  try {
    const d = await columnSchemeApi.list()           // 后端随租户配方下发（跨设备同步）
    if (d && Array.isArray(d.schemes)) { schemes.value = d.schemes; return }  // 后端成功即以云端为准（含空数组）
  } catch (e) { /* 后端未部署/出错，回退本地 */ }
  try { schemes.value = JSON.parse(localStorage.getItem(SCHEME_KEY()) || '[]') } catch (e) { schemes.value = [] }
}
async function saveScheme() {
  const n = (schemeName.value || '').trim(); if (!n) { toast('输入方案名', 'warn'); return }
  const item = { name: n, order: clone(colOrder.value), vis: clone(colVis.value) }
  const i = schemes.value.findIndex(x => x.name === n); if (i >= 0) schemes.value[i] = item; else schemes.value.push(item)
  localStorage.setItem(SCHEME_KEY(), JSON.stringify(schemes.value))   // 本地兜底
  try { await columnSchemeApi.save(schemes.value) } catch (e) {}       // 云端同步（静默）
  toast('已保存列方案', 'ok')
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
  try { await columnSchemeApi.save(schemes.value) } catch (e) {}  // 云端同步（静默）
  toast('已删除方案「' + name + '」', 'ok')
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
    const d = await forecastApproveApi.summary('', yoy.order_start || '', yoy.order_end || '')
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
  cross.value.rows.forEach((r, i) => { if ((r.name || '').toLowerCase().includes(f)) out.push(i) })
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
function zoomIn() { gridZoom.value = Math.min(200, gridZoom.value + 10) }
function zoomOut() { gridZoom.value = Math.max(50, gridZoom.value - 10) }
function zoomReset() { gridZoom.value = 100 }
function toggleGridFullscreen() { gridFullscreen.value = !gridFullscreen.value; if (!gridFullscreen.value) gridZoom.value = 100 }
function onFsKey(e) { if (e.key === 'Escape' && gridFullscreen.value) gridFullscreen.value = false }
onMounted(() => { window.addEventListener('keydown', onFsKey) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onFsKey) })

// P6-8 企微/飞书推送快照（后端就绪 /api/forecast/push；失败降级复制）
const pushing = ref(false)
async function pushForecast() {
  const p = cross.value.period; if (!p) { toast('请先选定期次', 'warn'); return }
  const riskN = healthIssues.value.filter(x => x.sev === 'risk').length
  const summary = `【预报单待审批】${p.name}\nSKU ${cross.value.rows.length} · 总箱 ${editTotalQty.value} · 金额 ¥${fmt(editTotalAmount.value)}\n风险项 ${riskN} 条 · 生成于 ${new Date().toLocaleString()}`
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
  t += `共 ${cross.value.rows.length} 个 SKU，总箱 ${editTotalQty.value}，金额 ¥${fmt(editTotalAmount.value)}\n`
  if (!healthIssues.value.length) t += '体检：未发现明显异常，可放心定稿。\n'
  else {
    t += `风险提示（${risk.length} 项高危 / ${warn.length} 项注意）：\n${top}\n`
  }
  const lossN = cross.value.rows.filter(r => lossWarn(r) === 'risk').length
  if (lossN) t += `货损：${lossN} 个短保商品订量超安全库存，建议下调或加快周转。\n`
  const moqN = cross.value.rows.filter(r => moqWarn(r) === 'below').length
  if (moqN) t += `MOQ：${moqN} 个商品未达起订量，建议凑单或调起订量。\n`
  t += '\n（AI 建议，最终以人定稿为准）'
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
  } catch (e) { toast('准确率载入失败', 'err') } finally { accLoading.value = false }
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

// P9-6 改动留痕审计（per period 追加）
const trailOpen = ref(false)
const auditTrail = ref([])
const auditTrailLoading = ref(false)
async function loadAuditLog() {
  try {
    const p = cross.value.period; if (!p) return
    const r = await forecastApi.auditGet(p.id)
    auditTrail.value = r.items || []
  } catch (e) {}
}
async function recordAudit(action, detail, ref_id = '') {
  const p = cross.value.period; if (!p) return
  try { await forecastApi.auditPost({ period_id: p.id, action, detail, ref_id }); await loadAuditLog() } catch (e) {}
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
const tbSettingsOpen = ref(false) // 主工具栏「表格设置」弹层（只读视图网格显示选项）
// 主工具栏弹层（表格设置/高级）改为 Teleport+fixed，脱离 .toolbar{overflow:auto} 裁切；用触发按钮坐标定位
const popStyle = reactive({ top: '0px', left: '0px' })
const settingsBtn = ref(null)
const advBtn = ref(null)
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
function toggleTbPop(which) {
  if (which === 'settings') {
    tbSettingsOpen.value = !tbSettingsOpen.value
    if (tbSettingsOpen.value) nextTick(() => positionTbPop(settingsBtn.value))
  } else {
    advToolsOpen.value = !advToolsOpen.value
    if (advToolsOpen.value) nextTick(() => positionTbPop(advBtn.value))
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
  varAttrs[pid] = cause
  try { await forecastApi.varianceAttrPut({ period_id: curPeriod.value, attrs: JSON.parse(JSON.stringify(varAttrs)) }) } catch (e) {}
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
  if (it) { it.status = status; if (note != null) it.note = note }
  try { await forecastApi.interventionsPost({ id, status, note: note || '' }) } catch (e) {}
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

// ---------- P16-8 配方市场 ----------
const marketOpen = ref(false)
const marketLoading = ref(false)
const marketList = ref([])
const marketMine = ref([])
const marketName = ref('')
const marketPrice = ref(0)
const marketDesc = ref('')
async function loadMarket() {
  marketLoading.value = true; marketOpen.value = true
  try { const r = await forecastApi.recipeMarketGet(); marketList.value = r.market || []; marketMine.value = r.mine || [] } catch (e) { toast('加载失败：' + (e.message || e), 'err') }
  finally { marketLoading.value = false }
}
async function publishMarket() {
  if (!marketName.value.trim()) { toast('请填配方名称', 'warn'); return }
  const recipe = (tmplList.value && tmplList.value[0]) ? (tmplList.value[0].recipe || tmplList.value[0]) : {}
  try {
    const r = await forecastApi.recipeMarketPublish({ name: marketName.value, recipe, price: marketPrice.value, desc: marketDesc.value })
    toast('已发布到配方市场 #' + r.entry.id, 'ok')
    marketName.value = ''; marketDesc.value = ''
    loadMarket()
  } catch (e) { toast('发布失败：' + (e.message || e), 'err') }
}
async function adoptMarket(id) {
  try { await forecastApi.recipeMarketAdopt({ id }); toast('已采纳到本租户模板库', 'ok'); loadMarket() } catch (e) { toast('采纳失败：' + (e.message || e), 'err') }
}

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
const impCross = ref(null)
const impMapping = ref({})
const impResult = ref(null)
const importing = ref(false)
const impCustomerCount = computed(() => (impCross.value?.customers || []).length)
const impCanExec = computed(() => (impCross.value?.customers || []).length > 0)

function openImport() { impOpen.value = true; impState.value = null }
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
    impCross.value = prev.cross || null
    const mapping = {}
    for (const s of prev.suggestions || []) {
      if (s.suggested_field) mapping[s.index] = s.suggested_field
    }
    // 兜底：非空且非身份列的未映射表头 → 客户列
    const identityIdx = new Set(Object.values((prev.cross && prev.cross.identity) || {}))
    for (let i = 0; i < (prev.headers || []).length; i++) {
      const h = String(prev.headers[i] || '').trim()
      if (!h || identityIdx.has(i) || mapping[i]) continue
      mapping[i] = 'customer'
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
    const r = await auditApi.auditPeriod({ start: p.order_start, end: p.order_end })
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
const REBATE_CADENCE_DAYS = 2   // 下单节奏：每 2 天一单（低温奶行业经验值，可调）
const rebateRules = ref([])     // 活跃返利目标规则（品牌/商品维度）
const rebateSprintOpen = ref(true)

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
const sprintAchvMonth = ref(new Date().toISOString().slice(0, 7))

async function loadRebateAchievements() {
  try {
    const list = await api('/api/rebate-achievements?month=' + encodeURIComponent(sprintAchvMonth.value))
    rebateAchievements.value = Array.isArray(list) ? list : []
  } catch (e) { rebateAchievements.value = [] }
}

// 本期还剩几次下单机会（下单截止日 - 今天，按每 CADENCE 天一单）
const rebateSprintOrders = computed(() => {
  const p = cross.value.period
  if (!p || !p.order_end) return 1
  const end = new Date(p.order_end + 'T23:59:59')
  const daysLeft = Math.ceil((end - new Date()) / 86400000)
  if (daysLeft <= 0) return 1
  return Math.max(1, Math.ceil(daysLeft / REBATE_CADENCE_DAYS))
})

// 按「填报达成 + 本期预报贡献」聚合各规则的实际达成、缺口、建议均单追加
const rebateSprint = computed(() => {
  const rules = rebateRules.value || []
  const rows = cross.value.rows || []
  const meta = prodMeta.value || {}
  const orders = rebateSprintOrders.value
  // 填报达成查表：维度 + 作用对象 → 达成记录
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
      const fq = (r.total || 0) + (r.extra_qty || 0)
      const amt = fq * (r.purchase_price || 0)
      if (rule.target_type === 'quantity') contrib += fq
      else contrib += amt
      products.push({ name: r.name, contrib: amt, qty: fq })
    }
    // 填报达成：金额型规则取金额，数量型规则取数量
    const av = achvMap.get(`${dim}::${scope}`)
    const reported = av
      ? (rule.target_type === 'quantity' ? (Number(av.actual_qty) || 0) : (Number(av.actual_amount) || 0))
      : 0
    const target = Number(rule.target_value) || 0
    const achieved = reported + contrib            // 达成 = 已填报 + 本期预报贡献
    const gap = Math.max(0, target - achieved)
    const perOrder = orders > 0 ? gap / orders : gap
    const ach = target > 0 ? achieved / target : 0
    const top = products.slice().sort((a, b) => b.contrib - a.contrib).slice(0, 3)
    out.push({
      key: rule.id,
      dimLabel: dim === 'brand' ? '品牌' : '商品',
      name: rule.scope_name || scope,
      target, targetType: rule.target_type,
      reported, contrib, achieved, gap, perOrder, ach, top
    })
  }
  return out
})

const sprintTotalGap = computed(() => rebateSprint.value.reduce((s, x) => s + x.gap, 0))
const sprintTotalGapPerOrder = computed(() => rebateSprintOrders.value > 0 ? sprintTotalGap.value / rebateSprintOrders.value : 0)

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
  deleting.value = true
  try {
    await forecastApi.deletePeriod(row.id)
    delOpen.value = false
    delTarget.value = null
    historyKey.value++            // 重挂往期预报，自动重载看板
    await loadPeriods()           // 刷新期次下拉 / 滚动期次
    if (curPeriod.value === row.id) {
      curPeriod.value = 0
      cross.value = { rows: [] }
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
      forecastApproveApi.summary('', p.order_start || '', p.order_end || ''),
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
    // 矩阵行以【全量商品主档】为行底：查看/只读模式也能展开完整商品列表（与编辑一致），
    // 不再只显示有报单的商品。有报单的商品按 summary 注入数量/金额/AI 等，无报单的商品以 0 占位。
    const sumById = {}
    ;(d.rows || []).forEach(r => { sumById[r.product_id] = r })
    const matrixRows = (prods.items || []).map(pd => {
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
        const specNum = parseFloat(pd.spec)
        boxes = (specNum > 0 && total) ? Math.round(total / specNum) : null
        ai = r.ai_suggested_qty; aiMethod = r.ai_method; people = r.people || 0
        final_qty = r.final_qty != null ? r.final_qty : null; decided = !!r.forecast_decided
        extra_qty = r.extra_qty || 0
      }
      return {
        product_id: pd.id, name: pd.name, spec: pd.spec, unit: pd.unit,
        barcode: pd.barcode || '', product_code: pd.product_code || '', dist_price: pd.dist_price || 0,
        sale_price: pd.sale_price || 0, purchase_price: pd.purchase_price || 0,
        safety_stock: pd.safety_stock || 0, expiry_days: pd.expiry_days || 0,
        category: meta[pd.id] ? (meta[pd.id].category || '') : '', brand: meta[pd.id] ? (meta[pd.id].brand || '') : '',
        qtyByUnit, total, boxes, price, amount,
        ai, aiMethod, people, final_qty, decided, extra_qty,
      }
    })
    const colTotals = units.map(u => matrixRows.reduce((s, r) => s + (r.qtyByUnit[u.name] || 0), 0))
    cross.value = {
      period: p,
      units,
      rows: matrixRows,
      colTotals,
      grand: {
        sku: matrixRows.length,
        qty: matrixRows.reduce((s, r) => s + r.total, 0),
        amount: matrixRows.reduce((s, r) => s + ((r.total || 0) + (r.extra_qty || 0)) * (r.purchase_price || 0), 0),
      },
      reportedUnits: units.length,
    }
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
    searchResults.value = data.products || data.data || data || []
  } catch (e) { /* 静默 */ }
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
  } catch (e) {
    toast('创建失败: ' + (e.message || ''), 'error')
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
  // 打开即预填：下单窗口=今天，到货=今天+4（均可手改）
  const t = new Date()
  const arr = new Date(t.getTime() + 4 * 86400000)
  np.value.order_start = fmtDate(t)
  np.value.order_end = fmtDate(t)
  np.value.arrival = fmtDate(arr)
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

// 名称输入时自动把识别到的日期填进表单（第一个=下单日，第二个=到货日）
function onPeriodNameInput() {
  const ds = parsePeriodDates(np.value.name)
  if (ds.length >= 1) {
    const d0 = fmtDate(new Date(ds[0].year, ds[0].month - 1, ds[0].day))
    np.value.order_start = d0
    np.value.order_end = d0
  }
  if (ds.length >= 2) {
    np.value.arrival = fmtDate(new Date(ds[1].year, ds[1].month - 1, ds[1].day))
  }
}

async function loadPeriods() {
  try {
    const d = await forecastApi.periods()
    periods.value = d.periods || []
    if (d.current) curPeriod.value = d.current.id || 0
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
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
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
  loadRebateAchievements()
  probeErp()
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
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:12px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.toolbar::-webkit-scrollbar{height:6px}
.toolbar::-webkit-scrollbar-thumb{background:var(--bd);border-radius:99px}
.tb-left,.tb-right,.toolbar>.tb-group{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.tb-left .btn,.tb-right .btn,.toolbar>.tb-group .btn{flex:0 0 auto;white-space:nowrap}
.sel-period{width:auto;max-width:100%;flex-shrink:0}

/* ---- P0-1 交叉表视图 ---- */
/* 本期预报子视图切换：导入汇总 / 草稿填报（移出工具栏，内容区干净分段） */
.view-seg{display:inline-flex;gap:4px;background:var(--bg3);border-radius:8px;padding:3px;margin-bottom:12px}
.view-seg button{border:none;background:transparent;padding:5px 16px;border-radius:6px;font-size:13px;color:var(--t2);cursor:pointer}
.view-seg button.on{background:#fff;color:var(--p-dark);box-shadow:var(--shadow-sm);font-weight:500}
.ph-actions{margin-left:auto;display:inline-flex;gap:8px}
/* 2026-08-27 期次确认徽标（经理保存汇总表=审批定稿） */
.confirm-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:8px;font-weight:500;white-space:nowrap}
.confirm-badge.ok{background:rgba(52,199,89,.14);color:#2f9e44}
.confirm-badge.draft{background:var(--bg3);color:var(--t3)}
.confirm-badge.filter{background:rgba(6,182,212,.14);color:#0e7490}
/* P0-1 工具栏语义分隔条（筛选/数据/编辑/AI/设置 五簇） */
.tb-sep{display:inline-block;width:1px;height:20px;background:var(--bd);margin:0 5px;flex:0 0 auto;opacity:.65;align-self:center}
/* P0-2 状态徽标移出按钮行，独立状态行（不与操作按钮争横向空间） */
.tb-status-row{flex:0 0 100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.cross-area{margin-bottom:14px}
.sop{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:rgba(var(--war-rgb),.10);border:1px solid rgba(var(--war-rgb),.30);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;color:var(--war);margin-bottom:12px}
.sop b{color:var(--war)}
.sop .sep{color:var(--t3)}
.cross-card{padding:0 14px 14px}
.cross-tbl{min-width:100%;font-size:12px}
.cross-tbl thead th{position:sticky;top:0;z-index:5;background:var(--bg3);border-bottom:1px solid var(--bd);font-weight:500;color:var(--t2);padding:8px 7px;white-space:nowrap}
.cross-tbl .frozen{position:sticky;left:0;background:var(--bg);z-index:6;min-width:200px;box-shadow:1px 0 0 var(--bd)}
.cross-tbl thead .frozen{background:var(--bg3)}
.fc-code{min-width:96px;font-variant-numeric:tabular-nums;color:var(--t2);font-size:11px}
.fc-num{min-width:72px;text-align:right;font-variant-numeric:tabular-nums;color:var(--t2)}
.fc-text{min-width:70px;color:var(--t2)}
.fc-name{min-width:200px}
.col-copy{border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:13px;padding:0 2px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.col-copy:hover{color:var(--p-dark)}
.btn-copy{border-color:var(--bd);color:var(--t1)}
.btn-copy:hover{background:var(--bg2)}

/* ---- 列配置条 + 菜单 ---- */
.col-config-bar{position:relative;display:flex;align-items:center;gap:10px;padding:0;flex-wrap:wrap}
.btn-xs{padding:3px 9px;font-size:12px;border-radius:var(--radius-sm)}
.col-menu{position:absolute;top:38px;left:0;z-index:1101;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:10px 12px;min-width:300px;max-height:70vh;overflow:auto}
.col-menu-hd{font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.col-menu-x{border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;border-radius:var(--radius-sm);flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.col-menu-x:hover{background:var(--bg3);color:var(--p-dark)}
.col-menu-overlay{position:fixed;inset:0;z-index:1100}
.col-menu-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.col-menu-list li{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;font-size:12.5px}
.col-menu-list li:hover{background:var(--bg3)}
.col-menu-list li.locked{color:var(--t2);font-weight:500}
.col-menu-list li.hidden{opacity:.5}
.col-menu-list li .drag{cursor:grab;color:var(--t3);font-size:12px;user-select:none}
.col-menu-list li.locked .drag{visibility:hidden}
.col-menu-list label{display:flex;align-items:center;gap:5px;flex:1;cursor:pointer}
.col-menu-del{border:none;background:none;color:var(--t3);cursor:pointer;font-size:11px;padding:1px 4px;border-radius:var(--radius-sm);display:inline-flex;align-items:center;justify-content:center}
.col-menu-del:hover{color:var(--dan);background:var(--dan-bg)}
.col-menu-del:hover{color:var(--dan);background:var(--dan-bg,rgba(239,68,68,.1))}
.col-menu-add{margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.col-menu-add .cm-label{font-size:11px;color:var(--t3);margin-right:2px}
.col-menu-schemes{margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.col-menu-schemes select{font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--t1)}
.edit-col-menu{position:absolute;top:38px;left:0;z-index:1102;max-width:420px}
.th-in{display:flex;align-items:center;gap:5px;justify-content:space-between}
.col-cfg{border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:11px;padding:0 2px;line-height:1;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.col-cfg:hover{color:var(--p-dark)}
.col-cfg:hover{color:var(--p-dark)}
.cross-tbl tbody td{border-bottom:1px solid var(--border-subtle);padding:7px 7px;white-space:nowrap}
.qty-th{text-align:center;min-width:52px}
.qty-cell{text-align:center;color:var(--t3)}
.qty-cell.has{color:var(--t1);font-weight:500}
.calc-th{text-align:right}
.calc-th.sum{background:#fffbeb;color:#92400e}
.calc-th.final{background:var(--p-bg);color:var(--p-dark)}
.calc-th.final .th-sub{font-weight:400;font-size:10px;opacity:.7}
.decided-badge{display:inline-block;margin-left:4px;padding:0 5px;font-size:10px;line-height:15px;border-radius:999px;background:var(--suc);color:#fff;vertical-align:1px}
/* 表体优化 P1/P2/P3：斑马纹/排序/分组/吸底合计 */
.tb-toolbar{display:flex;gap:12px;align-items:center;margin:4px 0 8px;flex-wrap:wrap}
.tb-toolbar .hint{color:var(--t3);font-size:12px}
.cross-tbl tbody tr.data-row.zebra{background:var(--bg2)}
.cross-tbl tbody tr.data-row:hover{background:var(--bg3)}
.cross-tbl.edit-tbl tbody tr:nth-child(even){background:var(--bg2)}
.cross-tbl.edit-tbl tbody tr:hover{background:var(--bg3)}
th.sortable{cursor:pointer;user-select:none}
th.sortable:hover{color:var(--p-dark)}
.sort-ind{font-size:10px;margin-left:2px;color:var(--p)}
.grp-head{background:var(--bg3);cursor:pointer}
.grp-head td{padding:6px 8px;border-bottom:1px solid var(--border-subtle)}
.grp-toggle{display:inline-block;width:14px;color:var(--p-dark)}
.grp-sub-info{margin-left:10px;color:var(--t2);font-size:12px;font-weight:400}

/* 选区统计状态栏 */
.sel-stat{display:flex;align-items:center;gap:16px;padding:7px 14px;background:var(--bg3);border-top:1px solid var(--bd);font-size:12.5px;color:var(--t2)}
.sel-stat-label{font-weight:600;color:var(--t1)}
.sel-stat b{color:var(--p-dark);font-weight:600;margin-left:2px}
.sel-stat-x{margin-left:auto;width:22px;height:22px;border:none;background:var(--bg);border-radius:var(--radius-sm);color:var(--t2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.sel-stat-x:hover{background:var(--dan-bg);color:var(--dan)}

/* 商品档案弹层 */
.profile-modal{max-width:480px}
.pf-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--bd);border-radius:var(--radius-sm);overflow:hidden}
.pf-item{display:flex;flex-direction:column;gap:3px;padding:10px 12px;background:var(--bg)}
.pf-item span{font-size:11px;color:var(--t3)}
.pf-item b{font-size:13.5px;color:var(--t1);font-weight:600;word-break:break-all}
.pf-item.pf-note{grid-column:1 / -1}
.pf-warn{color:var(--dan) !important}
.pf-ok{color:var(--suc) !important}
.pf-mid{color:var(--war) !important}
.cross-tbl,.edit-tbl{border-collapse:separate;border-spacing:0;table-layout:fixed}
.cross-tbl>tbody>tr>td,.edit-tbl>tbody>tr>td{position:relative}
.col-resizer{position:absolute;top:0;right:-3px;width:9px;height:100%;cursor:col-resize;z-index:5;touch-action:none}
.col-resizer::after{content:'';position:absolute;right:3px;top:8%;height:84%;width:2px;border-radius:2px;background:#cbd5e1}
.col-resizer:hover::after,.col-resizer.active::after{background:#06b6d4}
.table-wrap.edit-grid-wrap{flex:1 1 auto;min-height:0;max-height:72vh;overflow:auto;max-width:100%}
.seq-th{width:42px;min-width:42px;text-align:center;padding:8px 4px;vertical-align:middle}
.seq-cell{width:42px;min-width:42px;text-align:center;padding:6px 4px;vertical-align:middle;color:var(--t3);font-size:12px}
.seq-num{display:inline-block;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}
.gear{padding:2px 4px;border:none;background:transparent;cursor:pointer;font-size:14px;line-height:1;color:var(--t3);border-radius:4px}
.gear:hover{background:var(--bg3);color:var(--p-dark)}
.col-total-bar{position:relative;z-index:9;background:var(--bg3);border-top:2px solid var(--bd);flex:0 0 auto;width:100%;overflow:hidden;box-shadow:0 -2px 5px rgba(15,23,42,.06)}
.col-total-bar .frozen{background:var(--bg3)}
.pending-final{color:var(--t3);font-size:12px}
.miss-price{color:#dc2626;font-weight:500}
.calc-th.amount{min-width:80px}
.calc{text-align:right;font-variant-numeric:tabular-nums}
.calc.sum{background:#fffbeb;color:#92400e;font-weight:500}
.calc.final{background:var(--p-bg);color:var(--p-dark);font-weight:600}
.calc.amount{font-weight:600}
.col-total td{background:var(--bg3);font-weight:600;border-top:2px solid var(--bd)}
.col-total .calc.sum{background:#fef3c7}
.col-total .calc.final{background:#cffafe}

/* ---- 表体工程化增强（T1-T8：虚拟滚动/选中/展开/行状态/行操作/空加载态/键盘a11y） ---- */
.cross-viewport{flex:1 1 auto;min-height:0;max-height:72vh;overflow:auto;position:relative}
/* 表体全屏按钮：尺寸/图标/颜色/圆角/悬停态与 AI 副驾 .cp-icon-btn 全屏按钮完全对齐 */
.grid-area{position:relative;display:flex;flex-direction:column;gap:10px}
.grid-area.is-fs{position:fixed;inset:0;z-index:1000;background:var(--bg);padding:12px;display:flex;flex-direction:column;gap:10px}
.grid-area.is-fs .cross-viewport,
.grid-area.is-fs .edit-grid-wrap{flex:1 1 auto;min-height:0;max-height:none}
/* 表体控制条：全屏按钮 + 缩放条整合为一行，置于表体上方（flex 流），与表格主体保持间距、互不遮挡（非全屏/全屏均成立） */
.grid-ctl-row{display:flex;align-items:center;min-height:30px;padding:1px 0}
.grid-fs-btn{
  position:absolute;top:8px;right:8px;z-index:30;
  width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
  border:none;background:none;border-radius:8px;color:var(--t2);cursor:pointer;
}
.grid-fs-btn:hover:not(:disabled){background:var(--bg2);color:var(--t1)}
.grid-fs-btn:disabled{opacity:.35;cursor:default}
.grid-area.is-fs .grid-fs-btn{top:14px;right:14px}
/* 表内工具栏弱化为次级浅色条，降低视觉干扰（核心筛选操作保留，分组/冻结/口径为次级） */
.tbl-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--radius-sm);margin-bottom:10px}
.tbl-toolbar .tb-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 缩放条：常驻（非全屏/全屏均显示），内联于控制条右侧，不再 floating 覆盖表格 */
.zoom-group{align-items:center;gap:6px;margin-left:0;font-size:12px}
.zoom-group .zb-label{color:var(--t2);white-space:nowrap;font-size:12px}
.zoom-group .zb-btn{
  width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--bd);background:var(--bg);color:var(--t1);border-radius:8px;cursor:pointer;
  font-size:15px;line-height:1;padding:0;
}
.zoom-group .zb-btn:hover:not(:disabled){background:var(--bg2);color:var(--p)}
.zoom-group .zb-btn:disabled{opacity:.35;cursor:default}
.zoom-group .zb-reset{font-size:14px}
.zoom-group .zb-range{width:100px;accent-color:var(--p);cursor:pointer}
.zoom-group .zb-val{min-width:38px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums;color:var(--t1)}
/* 主工具栏整合：搜索框 / 表格设置&高级工具 弹层 / 活动筛选行 */
.tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:var(--bg3);border:1px solid var(--bd);border-radius:8px;color:var(--t2);flex:0 0 auto}
.tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;color:var(--t1);width:150px}
.tb-search .fld::placeholder{color:var(--t3)}
.tb-pop{position:relative;display:inline-flex}
.tb-pop-panel{position:fixed;z-index:1101;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:12px;display:flex;flex-direction:column;gap:10px;min-width:220px}
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
.cross-tbl tr.data-row.row-loading .pname::after{content:' ⏳';font-size:11px}
.cross-tbl tr.data-row.row-error{background:#fef2f2}
.cross-tbl tr.data-row.row-error .pname{color:#dc2626}
.cross-tbl tr.data-row.row-disabled{opacity:.45;filter:grayscale(.6)}
.exp-chev{cursor:pointer;color:var(--p-dark);display:inline-block;width:14px;user-select:none;margin-right:2px}
.row-ops{position:absolute;top:2px;right:4px;display:none;gap:2px;z-index:5}
.cross-tbl tr.data-row:hover .row-ops{display:flex}
.row-ops .rop{border:none;background:var(--bg3);border-radius:5px;cursor:pointer;font-size:12px;line-height:18px;padding:0 4px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
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
.det-unit{background:var(--bg);border:1px solid var(--border-subtle);border-radius:6px;padding:1px 6px}
.det-units-row{grid-column:1 / -1}
.vs-spacer td{border:none;padding:0;height:0;line-height:0;background:transparent;font-size:0}
.qty-num{display:inline-block;min-width:18px}
.tbl-state{padding:40px 16px;text-align:center}
.tbl-skeleton .sk-row{display:flex;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border-subtle)}
.tbl-skeleton .sk-bar{flex:1;height:14px;border-radius:6px;background:linear-gradient(90deg,var(--bg2) 25%,var(--bg3) 37%,var(--bg2) 63%);background-size:400% 100%;animation:sk 1.2s ease-in-out infinite}
@keyframes sk{0%{background-position:100% 50%}100%{background-position:0 50%}}
.tbl-empty .empty-ico{font-size:40px}
.tbl-empty .empty-t{font-size:15px;font-weight:500;margin-top:8px}
.tbl-empty .empty-s{color:var(--t3);font-size:12px;margin-top:4px}
.tbl-empty .empty-ops{display:flex;gap:10px;justify-content:center;margin-top:14px}
.pname{font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pspec{color:var(--t3);font-size:11px;margin-top:1px}
.ai-hint{color:var(--p-dark);font-size:11px;margin-top:2px;font-weight:500}
.tip-wrap{position:relative;cursor:help;border-bottom:1px dashed var(--bd)}
.tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;font-size:11px;padding:7px 10px;border-radius:6px;white-space:nowrap;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.tip b{color:#7dd3fc}
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
.cell-input{height:26px;padding:0 6px;border:1px solid var(--bd);border-radius:5px;background:var(--bg);color:var(--t1);font-size:12px;outline:none;display:block;width:100%;min-width:0;box-sizing:border-box;text-align:center}
.cell-input:focus{border-color:var(--p)}
.cell-name{text-align:left;font-weight:500;padding-right:42px}
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
.edit-ops{display:flex;align-items:center;gap:12px;padding:10px 4px 2px;flex-wrap:wrap}
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
.ctx-menu{position:fixed;z-index:1091;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:5px;min-width:172px;font-size:12.5px}
.ctx-menu button{display:flex;width:100%;align-items:center;gap:8px;padding:7px 10px;border:none;background:none;color:var(--t1);cursor:pointer;text-align:left;border-radius:6px;font-size:12.5px}
.ctx-menu button:hover{background:var(--bg3)}
.ctx-menu button:disabled{opacity:.4;cursor:default}
.ctx-menu button.danger:hover{background:var(--dan-bg,rgba(239,68,68,.1));color:var(--dan)}
.ctx-menu .ctx-sep{height:1px;background:var(--border-subtle);margin:4px 2px}
.ctx-menu .ctx-note{padding:6px 10px;color:var(--t3);font-size:11px}
.ctx-menu .ctx-ipt-row{display:flex;gap:6px;padding:6px 8px}
.ctx-menu .ctx-ipt{flex:1;min-width:0;padding:5px 7px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--t1);font-size:12.5px;outline:none}
.ctx-menu .ctx-ipt:focus{border-color:var(--p)}
.ctx-menu .ctx-sel{padding:5px 4px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--t1);font-size:12.5px;outline:none}
.ctx-menu .ctx-ipt-actions{display:flex;gap:6px;padding:0 8px 7px}
.ctx-menu .ctx-ipt-actions button{flex:1;justify-content:center;padding:5px 8px;border:none;background:var(--bg3);color:var(--t1);cursor:pointer;border-radius:6px;font-size:12.5px}
.ctx-menu .ctx-ipt-actions button.btn-primary{background:var(--p);color:#fff}
.ctx-menu .ctx-ipt-actions button.btn-primary:hover{filter:brightness(.95)}
.ctx-menu .ctx-ipt-actions button:hover{background:var(--bg2)}
.ctx-menu button.ctx-on{background:color-mix(in srgb,var(--p) 14%,var(--bg));color:var(--p)}
/* 表头右键：唯一值筛选列表 */
.ctx-uniq-hd{padding:7px 10px 4px;font-size:12px;color:var(--t1);display:flex;align-items:center;justify-content:space-between;gap:8px}
.ctx-uniq-all{display:flex;align-items:center;gap:4px;color:var(--t2);font-size:11.5px;cursor:pointer}
.ctx-uniq-list{max-height:200px;overflow:auto;padding:2px 6px}
.ctx-uniq-item{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:6px;cursor:pointer}
.ctx-uniq-item:hover{background:var(--bg3)}
.ctx-uniq-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctx-ipt-unit{color:var(--t2)}
/* 条件格式：库存<安全库存 整行高亮 */
.edit-tbl tr.cond-warn > td,
.cross-tbl tr.cond-warn > td{background:color-mix(in srgb,var(--dan,#ef4444) 14%,var(--bg))!important}
.edit-tbl tr.cond-warn:hover > td,
.cross-tbl tr.cond-warn:hover > td{background:color-mix(in srgb,var(--dan,#ef4444) 20%,var(--bg))!important}
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
.imp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.imp-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(560px,94vw);background:var(--bg);border-radius:var(--radius-lg);z-index:990;box-shadow:var(--shadow-lg);max-height:86vh;display:flex;flex-direction:column}
.imp-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle)}
.imp-hd b{font-size:14px}
.imp-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.imp-x:hover{color:var(--p-dark);background:var(--bg2);border-radius:var(--radius-sm)}
.imp-body{padding:16px 18px;overflow-y:auto}
.imp-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.imp-tip{font-size:12.5px;color:var(--t2);line-height:1.7;margin-bottom:14px}
.del-modal{width:min(440px,92vw)}
.warn-text{color:var(--dan);font-weight:500}
.del-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
.btn-danger{background:var(--dan);border-color:var(--dan);color:#fff}
.btn-danger:hover{filter:brightness(.95)}
.btn-danger:disabled{opacity:.6;cursor:not-allowed}
.btn.danger{color:var(--dan)}
.btn.danger:hover{filter:brightness(.95)}
.imp-file{font-size:12px;color:var(--t3);margin-top:10px}
.imp-ident{background:var(--bg3);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:12px;display:flex;flex-direction:column;gap:6px}
.imp-ident-row{display:flex;gap:10px;font-size:12.5px}
.imp-ident-row span{color:var(--t3);flex-shrink:0;width:88px}
.imp-ident-row b{color:var(--t1);font-weight:500}
.imp-customers{font-weight:400;color:var(--p-dark);line-height:1.6}
.imp-matrix{max-height:180px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-md);margin-bottom:12px}
.imp-matrix table{font-size:11.5px}
.imp-matrix th,.imp-matrix td{padding:5px 8px;border-bottom:1px solid var(--border-subtle);white-space:nowrap}
.imp-matrix thead th{position:sticky;top:0;background:var(--bg3)}
.imp-ft{display:flex;justify-content:flex-end;gap:10px;padding-top:6px}
.imp-ok{color:var(--suc);font-size:13px;margin-bottom:12px}
.imp-warn{color:var(--war);font-size:12.5px;margin-bottom:8px}
.imp-errs{margin:0;padding-left:18px;font-size:12px;color:var(--t2);line-height:1.8}

/* ---- P1-1 周期级 AI 审核台 ---- */
.audit-modal{width:min(760px,96vw)}
.legacy-note{font-size:11.5px;color:var(--t3);margin:0 0 10px;line-height:1.6}
.audit-erp-note{background:var(--bg3);border:1px solid var(--bd);border-left:3px solid var(--dan);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;line-height:1.7}
.audit-erp-note .link-btn{background:none;border:none;color:var(--p);font:inherit;font-weight:600;padding:0 2px;cursor:pointer;text-decoration:underline}
.audit-sum{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;font-size:12.5px;color:var(--t2);padding:8px 0 12px}
.audit-sum b{color:var(--t1)}
.audit-sug{color:var(--p-dark);font-weight:600}
.audit-name{font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audit-verdict{font-size:12px;color:var(--t2);max-width:260px}
.audit-modal .qty-input{width:72px;height:28px;padding:0 6px;border:1px solid var(--bd);border-radius:6px;text-align:right;background:var(--bg3);color:var(--t1);font-size:12.5px}
.audit-more{display:flex;justify-content:center;padding:8px 0 2px}

/* ---- P1-4 下单主体徽标 ---- */
.oe-badge{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;font-size:10.5px;margin-left:6px;vertical-align:1px}
.oe-恒滋{background:var(--p-bg);color:var(--p-dark)}
.oe-福宝{background:#f3e8ff;color:#7c3aed}

.new-period{padding:16px;margin-bottom:14px}
.np-row{display:flex;gap:10px;flex-wrap:wrap}
.np-row .input{flex:1;min-width:140px}
.draft-section{padding:16px}
.search-row{display:flex;gap:8px;position:relative}
.search-dropdown{position:absolute;top:42px;left:0;right:60px;background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-md);box-shadow:var(--shadow-md);max-height:280px;overflow-y:auto;z-index:100}
.sd-item{padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px}
.sd-item:hover{background:var(--bg2)}
.sd-main{flex:1;min-width:0}
.sd-alias{flex-shrink:0}
.al-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.al-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(400px,92vw);background:var(--bg);border-radius:var(--radius-lg);z-index:990;box-shadow:var(--shadow-lg)}
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
.qty-input{width:72px;height:30px;padding:0 6px;border:1px solid var(--bd);border-radius:6px;text-align:right;background:var(--bg3);color:var(--t1)}
.btn-del{border:none;background:none;color:var(--t3);font-size:14px;cursor:pointer;padding:4px 8px;border-radius:var(--radius-sm);display:inline-flex;align-items:center;justify-content:center}
.btn-del:hover{color:var(--dan);background:var(--dan-bg)}
.btn-del:hover{background:rgba(var(--dan-rgb),.1);color:var(--dan)}
.rebate-section{padding:16px}
.sprint-card{padding:16px}
.sprint-card .panel-body{padding-top:10px}
.sprint-sum{margin:0 0 12px;font-size:13px;color:var(--t2);line-height:1.7}
.sprint-sum b{color:var(--t1)}
.sprint-sum .muted{color:var(--t3);font-size:11.5px}
.sprint-suggest{margin-top:12px;font-size:13px;color:var(--t2);line-height:1.8}
.sprint-suggest ul{margin:6px 0 0;padding-left:18px}
.sprint-suggest li{margin:4px 0}
.sprint-prod{display:inline-block;margin:0 8px 0 4px;padding:1px 8px;background:var(--bg3);border-radius:10px;font-size:12px;color:var(--t2)}
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
.why-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);width:230px;background:var(--bg);border:1px solid var(--bd);border-radius:10px;box-shadow:var(--shadow-md);padding:11px 13px;z-index:60;font-size:12px;color:var(--t2);line-height:1.8;text-align:left;white-space:nowrap}
.why:hover .why-tip{display:block}
.why-formula{white-space:nowrap}
.why-result{color:var(--p-dark);font-weight:500;margin-top:3px;padding-top:3px;border-top:1px solid var(--border-subtle)}

@media(max-width:768px){
  .toolbar{padding:10px 12px;gap:8px}
  .tb-right{flex-wrap:wrap;justify-content:flex-start}
  .tb-status-row{margin-top:8px}
  .search-dropdown{right:0}
}

/* ---- 增强：校验/选区/口径/筛选/草稿 ---- */
.cell-input.invalid, .qty-cell.invalid input, td.invalid input{border-color:#dc2626 !important;background:#fef2f2}
.cell-input.invalid, .cell-input:focus{border-color:var(--p)}
.range-sel{background:#e0f2fe !important}
.cross-tbl.dragging, .cross-tbl.dragging *{user-select:none}
.fc-num.invalid, .fc-code.invalid, .fc-text.invalid{border-radius:6px}
td.invalid{background:#fef2f2}
.basis-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--t2)}
.tb-toggle{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--t1);background:var(--bg3);border:1px solid var(--bd);border-radius:8px;height:32px;padding:0 10px;white-space:nowrap;cursor:pointer;user-select:none;flex:0 0 auto}
.tb-toggle input{width:14px;height:14px;accent-color:var(--p);cursor:pointer}
.basis-toggle select{border:1px solid var(--bd);border-radius:var(--radius-sm);padding:2px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.filter-input{border:1px solid var(--bd);border-radius:var(--radius-sm);padding:4px 9px;font-size:12px;min-width:150px;background:var(--bg);color:var(--t1)}
.edit-summary{margin-top:8px;font-size:13px;color:var(--t2)}
.edit-summary b{color:var(--p-dark);font-size:15px}
.draft-banner{margin-top:8px;padding:7px 10px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;font-size:12px;color:#9a3412}
.link-btn{border:none;background:none;color:#b45309;text-decoration:underline;cursor:pointer;font-size:12px;padding:0}

/* ---- P3-P4 增强样式 ---- */
.warn-low{background:#fef2f2 !important}
.warn-short{background:#fffbeb !important}
.name-badges{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:2px;pointer-events:none}
.name-badges>span{margin-left:0;pointer-events:auto}
.warn-badge{display:inline-block;margin-left:3px;font-size:11px;color:#dc2626;vertical-align:middle}
.warn-badge.short{color:#d97706}
.diff-chg{outline:2px solid #2563eb;outline-offset:-2px}
.mini-btn{margin-left:4px;font-size:11px;padding:1px 6px;border:1px solid var(--p);color:var(--p-dark);background:transparent;border-radius:6px;cursor:pointer}
.mini-btn:disabled{opacity:.4;cursor:default}
.suggest{color:var(--p-dark);font-weight:500}
.delta.up{color:#16a34a}
.delta.down{color:#dc2626}
.spark-td{text-align:center}
.spark-td .muted{color:var(--t3);font-size:11px}
.spacer{background:transparent}
.foot-row td{background:var(--bg3);font-weight:500;border-top:2px solid var(--bd)}
.foot-row td.frozen{background:var(--bg3);z-index:6}
.enh-panels{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}
.grp-btn{font-size:12px;padding:5px 12px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg2);color:var(--t1);cursor:pointer;white-space:nowrap}
.grp-btn:hover{border-color:var(--p)}
.grp-btn.on{background:var(--p);color:#fff;border-color:var(--p)}
.grp-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:var(--bg2);border:0.5px solid var(--bd);border-radius:var(--radius-md)}
.batch-panel{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:8px;font-size:12px}
.batch-val{width:84px;border:1px solid var(--bd);border-radius:6px;padding:4px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.snap-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:12px}
.recipe-panel{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;font-size:12px}
.recipe-panel>span{display:inline-flex;align-items:center;gap:4px;color:var(--t2)}
.recipe-val{width:64px;border:1px solid var(--bd);border-radius:6px;padding:3px 6px;font-size:12px;background:var(--bg);color:var(--t1)}
.loss-badge{cursor:help;font-size:11px;margin-left:2px}
.loss-badge.risk{color:#A32D2D}
.loss-badge.watch{color:#BA7517}
.note-badge{cursor:pointer;font-size:11px;margin-left:2px;opacity:.65}
.note-badge:hover{opacity:1}
.moq-below{background:rgba(163,45,45,.12);color:#A32D2D;font-weight:500}
.info-panel{margin-top:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;font-size:12px}
.info-panel .panel-hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.info-panel .imp-x{margin-left:auto;border:none;background:none;cursor:pointer;color:var(--t2);font-size:14px;line-height:1}
.push-list,.health-list{margin:0;padding-left:18px;line-height:1.8}
.health-list li{cursor:pointer;display:flex;align-items:center;gap:6px}
.health-list li:hover{text-decoration:underline}
.sev-risk{color:#A32D2D}.sev-warn{color:#BA7517}.sev-info{color:var(--t2)}
.sev-dot{width:7px;height:7px;border-radius:50%;flex:none;display:inline-block}
.sev-risk .sev-dot{background:#A32D2D}.sev-warn .sev-dot{background:#BA7517}.sev-info .sev-dot{background:var(--t3)}
.pager{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:12px}
.pager-info{color:var(--t2)}
/* P8/P9/P10 新增强样式 */
.panel-sep{width:1px;height:18px;background:var(--bd);margin:0 2px;display:inline-block}
.rt-badge{cursor:help;font-size:11px;margin-left:2px}
.rt-badge.stockout{color:#A32D2D}.rt-badge.low{color:#BA7517}.rt-badge.expiry{color:#9A6B00}.rt-badge.expired{color:#7A1F1F}
.book-area{width:100%;box-sizing:border-box;font-family:inherit;font-size:12px;line-height:1.6;padding:8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--t1);resize:vertical;margin-top:4px}
.acc-tbl{margin-top:6px;font-size:12px}
.acc-tbl td.num,.acc-tbl th.num{text-align:right}
.sub-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.tag.st-draft{background:#eee;color:#555}.tag.st-submitted{background:#FFF3D6;color:#9A6B00}
.tag.st-approved{background:#DDF5E7;color:#0F6E56}.tag.st-rejected{background:#FBE0E0;color:#A32D2D}.tag.st-revised{background:#E6EAF2;color:#37517E}
.tmpl-form{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.tmpl-form .input{width:auto;flex:1;min-width:120px}
.bi-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:6px}
.bi-card{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;text-align:center}
.bi-num{font-size:20px;font-weight:700;color:var(--p)}
.bi-num.warn{color:#A32D2D}
.bi-lbl{font-size:11px;color:var(--t2);margin-top:2px}
/* P11-P13 第四轮增强样式 */
.gap-badge{cursor:help;font-size:11px;margin-left:2px}
.gap-form{display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap}
.rolling-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.rolling-chips .on{background:var(--p);color:#fff;border-color:var(--p)}
.var-cat{margin-top:8px;border-top:1px dashed var(--bd);padding-top:6px}
.var-cat-hd{font-size:12px;font-weight:600;color:var(--t1);margin-bottom:4px}
.nl-row{display:flex;gap:8px;align-items:center;margin-top:6px}
.tag.ok{background:#DDF5E7;color:#0F6E56}
.tag.info{background:#E6F1FB;color:#185FA5}
.tag.warn{background:#FBEEDA;color:#854F0B}
/* P14-P16 第五轮增强样式 */
.hs-badge{cursor:help;font-size:11px;margin-left:2px;color:#185FA5}
.mini-form{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.mini-form .input{flex:1;min-width:90px}
.mini-msg{margin-top:6px;font-size:12px;color:#0F6E56}
.heal-row{border:1px solid var(--bd);border-radius:8px;padding:8px 10px;margin-top:8px;background:var(--bg)}
.heal-row.risk{border-left:3px solid #A32D2D}
.heal-row.warn{border-left:3px solid #BA7517}
@media print{
  body *{visibility:hidden}
  .table-wrap,.table-wrap *{visibility:visible}
  .table-wrap{position:absolute;left:0;top:0;width:100%;overflow:visible}
  .edit-tbl{width:100%}
  .tbl-toolbar,.edit-ops,.enh-panels,.batch-panel,.snap-bar,.edit-hint,.col-config-bar,.draft-banner,.ctx-menu,.ctx-overlay{display:none !important}
}
</style>

