<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>商品档案</h2>
        <span class="page-sub">浏览与维护商品主档 · <b>点行尾「编辑」改名称/规格/价格/描述等（只提交你真的改过的字段）</b> · 品牌、进价、到货周期三列也支持行内直接点改</span>
      </div>
      <div class="pa-actions">
        <span class="pa-stat" v-if="total !== null"><b>{{ total }}</b>&nbsp;个商品</span>
        <button v-if="missingFactoryCount > 0" class="btn btn-ghost btn-sm pa-fp-btn" @click="openBatchFp"
                title="进价 ＝ 厂家跟你结算的价（元/箱），算「本期需付款」用的就是它。这里可逐行填，也可导出清单批量补">
          <Icon name="edit"/> 补进价<span class="pa-fp-n">{{ missingFactoryCount }}</span>
        </button>
        <button class="btn btn-primary btn-sm" @click="openAdd">+ 新增</button>
        <button class="btn btn-ghost btn-sm" @click="openImport">导入</button>
        <button class="btn btn-ghost btn-sm" @click="exportXlsx">导出</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="card pa-panel">
      <div class="pa-filters">
        <div class="pa-search">
          <svg class="pa-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input v-model="keyword" class="input pa-kw" placeholder="商品名称 / 条码 / 规格 / 编码" @input="onFilterChange">
        </div>
        <select v-model="brandFilter" class="input" @change="onFilterChange">
          <option value="">全部品牌</option>
          <option v-for="b in brandOptions" :key="b" :value="b">{{ b }}</option>
        </select>
        <select v-model="categoryFilter" class="input" @change="onFilterChange">
          <option value="">全部分类</option>
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="pa-check"><input type="checkbox" v-model="includeInactive" @change="onFilterChange"> 含停用</label>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置</button>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="products.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>名称</th><th>条码</th><th>规格</th><th>单位</th>
            <!-- v184b：到货周期（该单品下单后第几天到货）。位置放在「商品身份」块（名称/条码/规格/单位）
                 之后、价格块之前 —— 它是 SKU 属性，不属于价格组（标准售价/进价/分销价）。 -->
            <th title="该单品下单后第几天到货（如 +3天）。点格子可直接改；留空或 0 = 取消设置">到货周期</th>
            <th>品牌</th><th class="num">标准售价</th><th class="num" title="进价 ＝ 厂家跟你结算的价（元/箱），算「本期需付款」用的就是它。可留空：留空则按档案里的历史进价列取；点格子可直接改">进价</th><th class="num">安全库存</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="p in products" :key="p.id" :class="{ stopped: p.is_active === 0 }">
              <td class="pa-name">{{ p.name }}</td>
              <td class="pa-mono">{{ p.barcode || '—' }}</td>
              <td>{{ p.spec || '—' }}</td>
              <td>{{ p.unit || '—' }}</td>
              <!-- v184b：到货周期 —— 行内可编（沿用品牌/进价两列的改法）。
                   🔴 三态显示是**有意的**：
                     · 有值  → '+3天'（可点）
                     · 未设置 → 「未设」灰字 + 可点。这里**不用**「—」：本格是**可操作**的入口，
                       一个不表意的破折号不告诉用户「点它就能设」（进价列用「未录」同理）。
                       只在预报主表用「—」（那是纯展示、不可点）。
                     · 编辑中 → number 输入框，Enter 或失焦即存。
                   ⚠️ 「留空 = 取消设置」与**预报导入**的「留空 = 不改动」**语义相反**，这是刻意的：
                     导入是成百行的批量动作，空格子多半只是「这行没意见」；
                     而这里是用户**专门点开某一格**的定向动作，留空只能是「我要清掉它」。
                     故两边都各自显式提示（导入那边写在填写说明里，这里见 saveCycle 的 toast）。 -->
              <td class="pa-cyc-cell">
                <input v-if="editingCycleId === p.id" v-model="editCycle" class="input pa-cyc-input"
                       type="number" min="0" :max="ARRIVAL_MAX" step="1"
                       :title="'填 +几天到货（0~' + ARRIVAL_MAX + '）；留空或 0 = 取消设置'"
                       @keyup.enter="saveCycle(p)" @blur="saveCycle(p)">
                <span v-else-if="Number(p.arrival_lead_days) > 0" class="pa-cyc-val"
                      title="点这里改（该单品下单后第几天到货）" @click="startEditCycle(p)">{{ arrivalCycleText(p.arrival_lead_days) }}</span>
                <span v-else class="pa-cyc-none" title="点这里设置：该单品下单后第几天到货（如 3 = +3天）" @click="startEditCycle(p)">未设</span>
              </td>
              <td class="pa-brand-cell">
                <input v-if="editingId === p.id" v-model="editBrand" class="input pa-brand-input" list="pa-brand-list"
                       @keyup.enter="saveBrand(p)" @blur="saveBrand(p)">
                <span v-else class="pa-brand" @click="startEditBrand(p)">{{ p.brand || '—' }}</span>
              </td>
              <td class="num">{{ money(p.sale_price) }}</td>
              <!-- 🔴 v226（2026-09-21）：此处原有**两列**（「进价」绑 `purchase_price`、
                   「厂价」绑 `factory_price`），用户拍板「进价跟厂价是一个意思」⇒ **合成一列**。
                   实测那 46 个两列都有值的商品上，`purchase_price` 与「分销价」「标准售价」
                   **46/46 完全相同**，且门店真实成交价也是这个数 ⇒ 它存的是**卖给门店的价**，
                   而 `factory_price` 才是厂家跟你结算的进货成本 ⇒ 留后者。
                   ⚠️ `purchase_price` 仍在库里、仍作 `factory_price` 为空时的回退（见 `fpEff()`），
                      只是不再单独成列。🔴 **该回退只在"档案里有没有价"这个语义下成立**：
                      它是元/小单位、且实测等于标准售价 ⇒ **不参与金额计算**
                      （预报页金额基准 `factoryPrice()` 只认 `factory_price`，见其定义处 v226b 注释）。 -->
              <td class="num pa-fp-cell">
                <input v-if="editingFpId === p.id" v-model="editFp" class="input pa-fp-input" type="number" min="0" step="0.01"
                       @keyup.enter="saveFp(p)" @blur="saveFp(p)">
                <span v-else-if="fpEff(p).from === 'factory'" class="pa-fp-val" @click="startEditFp(p)">{{ money(fpEff(p).v) }}</span>
                <!-- v165/v226：档案进价列为空、但历史进价列有值时，直接显示解析后的价
                     （不显示「未录」，否则用户会以为要重录一遍，而付款额其实已经在用那个值）。 -->
                <span v-else-if="fpEff(p).from === 'purchase'" class="pa-fp-from" @click="startEditFp(p)"
                      title="取自档案里的历史进价列（元/小单位，实测等于标准售价）—— 这里只代表「档案里有价」，不代表能算金额；算「本期需付款」用的是元/箱的「进价」，点这里可直接填一个">取进价 {{ money(fpEff(p).v) }}</span>
                <span v-else class="pa-fp-miss" title="点这里填进价（档案里两个进价列都是空的）" @click="startEditFp(p)">未录</span>
              </td>
              <td class="num">{{ p.safety_stock != null ? p.safety_stock : '—' }}</td>
              <td>
                <span class="pa-status" :class="p.is_active === 0 ? 'off' : 'on'">{{ p.is_active === 0 ? '停用' : '启用' }}</span>
              </td>
              <td class="pa-ops"><button class="btn btn-ghost btn-sm" @click="openDetail(p)">编辑</button></td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <div class="pa-pager" v-if="total > pageSize">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span class="pa-pageinfo">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
          <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          <select v-model="pageSize" class="input pa-size" @change="onPageSizeChange">
            <option :value="20">20 / 页</option>
            <option :value="50">50 / 页</option>
            <option :value="100">100 / 页</option>
          </select>
        </div>
      </div>
      <div v-else class="state-empty">没有匹配的商品，调整筛选条件试试</div>
    </div>

    <!-- v184c：商品「编辑」弹窗（由原「只读详情」升级而来 —— 入口仍是每行那个按钮，**不新增按钮**）。
         🔴 三条设计约束（改之前先读）：

         ① **保存只提交「真正改动过的字段」**（diff），而不是把整张表单 PUT 回去。理由三条：
            · **不留假痕迹** —— 进价框显示的是 `fpEff()` 解析值（可能是「取进价」的结果），
              无脑整表回传会把 `factory_price` 从 0 写成那个数，留痕里凭空多一条「进价 0→3.5」；
            · **不误清空** —— 表单没渲染到的字段永远不会被覆盖（与 bulk-upsert 那个坑同源）；
            · **并发更安全** —— 两人同时编辑各改各的字段，后保存的不吃掉先保存的。

         ② **条码 / 厂家编码只读**。条码是唯一索引（`v89_products_barcode_unique`，`WHERE barcode!=''`）
            且是**至少 5 条链路**的关联键（扫码查询 `routers/barcode.py`、导入匹配 `import_router`、
            返利达成 `rebate_achievements`、档案弹层 `products.py`、预报配置），改它 = 断链路 ——
            故此处不给入口，要改得走专门的条码冲突处理流程（`barcode_conflicts`）。

         ③ **「留空 = 清空该字段」**（数值即 0），与「新增商品」弹窗的「留空 = 不改动」**相反**：
            这里是**定向动作**（你专门点开这一个商品），留空只能是「我要清掉它」；
            新增那边是同名即更新的批量语义，空格子多半只是「这行没意见」。
            两者都各自写在界面上（见各字段的 pa-hint 与上面那句 pa-tip）。

         ⚠️ 价格字段的提交会同时触发后端既有的**调价审计**（`routers/data.py::update_product`
            的 `has_price` 分支 → `db.audit_log`），那是另一套「动作级」日志，与下面「修改记录」
            （字段级）**不是重复**：前者答「做过调价这个动作」，后者答「哪个字段从多少变成多少」。 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="detailOpen" class="pa-overlay" @click="tryCloseEdit()"></div></Transition>
      <Transition name="pop">
        <div v-if="detailOpen" class="pa-modal pa-edit">
          <div class="pa-modal-hd">
            <b>编辑商品 · {{ detailTarget?.name }}</b>
            <button class="pa-x" @click="tryCloseEdit()"><Icon name="close"/></button>
          </div>
          <div class="pa-modal-body">
            <p class="pa-tip">改哪个字段就只提交哪个 —— 没动过的字段不会被覆盖，也不会产生多余的修改记录。</p>

            <div class="pa-sec">商品身份</div>
            <div class="pa-form">
              <label class="pa-f"><span>商品名称 <i>*</i></span><input v-model="editForm.name" class="input" placeholder="必填"></label>
              <label class="pa-f"><span>规格</span><input v-model="editForm.spec" class="input" placeholder="如 200g×12"></label>
              <label class="pa-f"><span>单位</span><input v-model="editForm.unit" class="input" placeholder="件"></label>
              <label class="pa-f"><span>分类</span><input v-model="editForm.category" class="input" placeholder="如 液态奶"></label>
              <label class="pa-f"><span>条码<span class="pa-hint">关联键，不可改</span></span><input :value="detailTarget?.barcode || '—'" class="input" disabled></label>
              <label class="pa-f"><span>厂家编码<span class="pa-hint">不可改</span></span><input :value="detailTarget?.product_code || '—'" class="input" disabled></label>
            </div>

            <div class="pa-sec">品牌与别名</div>
            <div class="pa-form">
              <label class="pa-f"><span>品牌<span class="pa-hint">保存时自动归一</span></span><input v-model="editForm.brand" class="input" list="pa-brand-list" placeholder="可手填或选已有"></label>
              <label class="pa-f"><span>别名<span class="pa-hint">逗号分隔的俗称，用于智能匹配</span></span><input v-model="editForm.alias" class="input" placeholder="如 纯甄,蒙牛纯甄"></label>
            </div>

            <div class="pa-sec">价格</div>
            <div class="pa-form">
              <label class="pa-f"><span>标准售价<span class="pa-hint">导入模版里叫「售价」</span></span><input v-model="editForm.sale_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <!-- v226：原来这里有**两个**进价输入框（`purchase_price` / `factory_price`）——
                   两词同义 ⇒ 只留一个（对外叫「进价」，绑 `factory_price`）。用户不必再猜该填哪个。
                   ⚠️ `editForm.purchase_price` 仍留在数据里：保存走「只提交真的改过的字段」，
                      没有界面入口 ⇒ 它永远不会进 payload，库里已有的值不会被覆盖或清零。 -->
              <label class="pa-f"><span>进价<span class="pa-hint">厂家跟你结算的价（元/箱）；留空 = 按档案历史进价列取</span></span><input v-model="editForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="留空 = 按档案历史进价列取"></label>
              <label class="pa-f"><span>分销价</span><input v-model="editForm.dist_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
            </div>

            <div class="pa-sec">库存与效期</div>
            <div class="pa-form">
              <label class="pa-f"><span>安全库存</span><input v-model="editForm.safety_stock" class="input" type="number" min="0" step="1" placeholder="0"></label>
              <label class="pa-f"><span>保质期(天)</span><input v-model="editForm.expiry_days" class="input" type="number" min="0" step="1" placeholder="0"></label>
              <label class="pa-f"><span>到货周期<span class="pa-hint">+几天到货；留空 = 取消设置</span></span><input v-model="editForm.arrival_lead_days" class="input" type="number" min="0" :max="ARRIVAL_MAX" step="1" placeholder="如 3"></label>
            </div>

            <div class="pa-sec">描述</div>
            <label class="pa-f pa-f-full"><span>描述<span class="pa-hint">内部备注，不印在单据上；留空 = 清空</span></span>
              <textarea v-model="editForm.description" class="input pa-ta" rows="3" placeholder="选填"></textarea></label>

            <div class="pa-sec">状态</div>
            <div class="pa-active">
              <span class="pa-status" :class="detailTarget?.is_active === 0 ? 'off' : 'on'">{{ detailTarget?.is_active === 0 ? '已停用' : '启用中' }}</span>
              <span class="pa-hint">停用后该商品不再出现在报单与小程序的可选列表里</span>
              <!-- 二次确认做成**内联**的（不叠第二层弹窗）：第一次点变成「确认停用」，点「取消」撤销。
                   停用是有业务后果的动作（商品从报单/小程序可选列表消失），故不给一键直通。 -->
              <button v-if="!confirmActive" class="btn btn-ghost btn-sm" @click="confirmActive = true">{{ detailTarget?.is_active === 0 ? '启用此商品' : '停用此商品' }}</button>
              <template v-else>
                <button class="btn btn-sm btn-danger" :disabled="savingActive" @click="applyActive(detailTarget?.is_active === 0 ? 1 : 0)">确认{{ detailTarget?.is_active === 0 ? '启用' : '停用' }}</button>
                <button class="btn btn-ghost btn-sm" @click="confirmActive = false">取消</button>
              </template>
            </div>

            <!-- 修改记录：后端自 v107.41 起**一直在写**（`product_update` 内部自动留痕），
                 本区块只是把**早已存在**的查询端点接出来 —— 在此之前前端零入口，
                 于是「改了但查不到谁改的」。首次展开才请求，不拖慢打开弹窗。 -->
            <div class="pa-sec pa-sec-click" @click="toggleChanges()">
              <span>修改记录</span>
              <span class="pa-hint">{{ changesLoaded ? ('共 ' + changesList.length + ' 条') : '点此展开' }}</span>
              <span class="pa-caret">{{ showChanges ? '收起' : '展开' }}</span>
            </div>
            <div v-if="showChanges" class="pa-log" ref="logBox">
              <div v-if="changesLoading" class="pa-log-empty">加载中…</div>
              <div v-else-if="!changesList.length" class="pa-log-empty">该商品还没有修改记录</div>
              <div v-else class="pa-log-list">
                <div v-for="(c, i) in changesList" :key="i" class="pa-log-row">
                  <span class="pa-log-t">{{ (c.created_at || '').slice(0, 16) }}</span>
                  <span class="pa-log-w">{{ c.user_name || '—' }}</span>
                  <span class="pa-log-f">{{ FIELD_CN[c.field_name] || c.field_name }}</span>
                  <span class="pa-log-v"><i>{{ logVal(c.old_value) }}</i> → <b>{{ logVal(c.new_value) }}</b></span>
                </div>
              </div>
            </div>
          </div>
          <div class="pa-modal-ft">
            <span class="pa-ft-note" v-if="dirtyCount">{{ dirtyCount }} 个字段已改，未保存</span>
            <button class="btn btn-ghost" @click="tryCloseEdit()">取消</button>
            <button class="btn btn-primary" :disabled="saving || !dirtyCount" @click="saveEdit()">{{ saving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>

      <!-- 新增商品弹窗 -->
      <Transition name="fade"><div v-if="addOpen" class="pa-overlay" @click="addOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="addOpen" class="pa-modal">
          <div class="pa-modal-hd"><b>新增商品</b><button class="pa-x" @click="addOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <p class="pa-tip">名称重复将更新已有商品（其余字段按填写覆盖）。品牌自动归一，未匹配品牌进入待审。</p>
            <div class="pa-form">
              <label class="pa-f"><span>商品名称 <i>*</i></span><input v-model="addForm.name" class="input" placeholder="必填"></label>
              <label class="pa-f"><span>条码</span><input v-model="addForm.barcode" class="input" placeholder="唯一编码，留空按名称匹配"></label>
              <label class="pa-f"><span>规格</span><input v-model="addForm.spec" class="input" placeholder="如 200g×12"></label>
              <label class="pa-f"><span>单位</span><input v-model="addForm.unit" class="input" placeholder="件（默认）"></label>
              <label class="pa-f"><span>品牌</span><input v-model="addForm.brand" class="input" list="pa-brand-list" placeholder="可手填或选已有"></label>
              <label class="pa-f"><span>分类</span><input v-model="addForm.category" class="input" placeholder="如 液态奶"></label>
              <!-- v226：同编辑弹窗 —— 只留一个「进价」输入框（绑 factory_price）。 -->
              <label class="pa-f"><span>进价<span class="pa-hint">厂家跟你结算的价（元/箱），可留空</span></span><input v-model="addForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>售价</span><input v-model="addForm.sale_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>安全库存</span><input v-model="addForm.safety_stock" class="input" type="number" min="0" step="1" placeholder="0"></label>
              <label class="pa-f"><span>保质期(天)</span><input v-model="addForm.expiry_days" class="input" type="number" min="0" step="1" placeholder="0"></label>
              <!-- v184b：到货周期。留空 = **不改动**（不写这一列）—— 本弹窗保存走 bulk-upsert，
                   同名商品会走更新分支；若把空值当 0 提交，会把别人已设好的到货周期清零
                   （进价列踩过同一个坑，见 saveAdd 里的条件展开）。 -->
              <label class="pa-f"><span>到货周期<span class="pa-hint">+几天到货，留空 = 不设置</span></span><input v-model="addForm.arrival_lead_days" class="input" type="number" min="0" :max="ARRIVAL_MAX" step="1" placeholder="如 3"></label>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-ghost" @click="addOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="addSaving" @click="saveAdd">{{ addSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>

      <!-- 导入弹窗 -->
      <Transition name="fade"><div v-if="impOpen" class="pa-overlay" @click="impOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="impOpen" class="pa-modal" :class="{ 'pa-map': impStep === 'map' }">
          <div class="pa-modal-hd"><b>导入商品（Excel）</b><button class="pa-x" @click="impOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <p v-if="impStep === 'pick'" class="pa-tip">下载模板 → 按列填写 → 选择文件自动识别列并导入。重复名称/条码将更新而非新增。</p>
            <div class="pa-imp-row">
              <button class="btn btn-ghost" @click="downloadTpl">下载模板</button>
              <label class="btn btn-ghost pa-file-btn">
                选择文件
                <input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onImpFile">
              </label>
              <span v-if="impFileName" class="pa-fname">{{ impFileName }}</span>
              <button v-if="impStep === 'pick'" class="btn btn-primary" :disabled="!impFile || impSaving" @click="previewImport">{{ impSaving ? '识别中…' : '下一步' }}</button>
            </div>
            <template v-if="impStep === 'map'">
              <p class="pa-tip">系统按列名猜字段，可能猜错（例如把「厂家商品编码」当成品牌）。核对「识别为」这一列，不对就在下拉里改 —— 标「不导入」的列不会进来。</p>
              <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions" />
            </template>
            <div v-if="impResult" class="pa-imp-result" :class="impResult.results?.errors?.length ? 'warn' : 'ok'">
              成功 {{ impResult.results?.success }} 条 · 跳过 {{ impResult.results?.skipped }} 条 · 失败 {{ impResult.results?.errors?.length || 0 }} 条
              <span v-if="impResult.results?.errors?.length" class="pa-errs">
                <span v-for="(er, i) in impResult.results.errors.slice(0, 4)" :key="i" class="pa-err">第{{ er.row }}行: {{ er.msg }}</span>
              </span>
            </div>
          </div>
          <div class="pa-modal-ft">
            <template v-if="impStep === 'map'">
              <button class="btn btn-ghost" :disabled="impSaving" @click="impStep = 'pick'">返回</button>
              <button class="btn btn-primary" :disabled="impSaving" @click="doImport">{{ impSaving ? '导入中…' : '确认导入' }}</button>
            </template>
            <button v-else class="btn btn-primary" @click="impOpen = false">关闭</button>
          </div>
        </div>
      </Transition>

      <!-- v157 批量补进价弹窗：默认只列「未录进价」的启用商品 -->
      <Transition name="fade"><div v-if="fpOpen" class="pa-overlay" @click="fpOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="fpOpen" class="pa-modal pa-wide">
          <div class="pa-modal-hd">
            <b>批量补进价 · 还有 {{ fpRows.length }} 个商品连进价都没有</b>
            <button class="pa-x" @click="fpOpen = false"><Icon name="close"/></button>
          </div>
          <div class="pa-modal-body">
            <p class="pa-tip">
              <b>进价 ＝ 厂家跟你结算的价</b>（元/箱），用于算「本期需付款 = 定稿量 × 进价」。<br>
              本表只列<b>连进价都没有</b>的商品 —— <b>档案里已有进价、或历史进价列里有值的一律不在列</b>，
              不必在这里重录（与工具栏徽标、导出清单同一个数）。<br>
              两种填法任选：① 直接在下表逐行填；② 点「导出待补清单」到 Excel 里填好，再点「导入回填」——
              回填按 <b>商品编号</b> 定位（编号缺失才退回条码），所以<b>没有条码的商品也能补</b>，前两列请勿改动。
            </p>

            <!-- v158 进价闸门：文案按开关实际状态陈述。此前 8 处文案无条件写「会被拒收」，
                 而代码里根本没有拒收逻辑 —— 开关存在就是为了让文案与行为都能说真话。 -->
            <div class="pa-fp-gate" :class="{ on: fpGate }">
              <label class="pa-fp-switch">
                <input type="checkbox" :checked="fpGate" :disabled="fpGateBusy" @change="toggleFpGate">
                <span><b>进价必填</b>（报单时拒收没录进价的商品）</span>
              </label>
              <span class="pa-fp-gate-hint">
                <template v-if="fpGate">
                  已开启：连进价都没有的商品，在<b>报单导入</b>与<b>小程序报单</b>时都会被拒收。<b v-if="fpGateMissing">当前还有 {{ fpGateMissing }} 个没补，建议先补完再保持开启。</b>
                </template>
                <template v-else>
                  未开启：价格没录也能正常报单 —— 档案里有进价的按进价算，<b>连进价都没有的才按标准售价估算（偏大）</b>。<span v-if="fpGateMissing"> 还有 {{ fpGateMissing }} 个商品价格没录。</span>
                </template>
              </span>
            </div>

            <div class="pa-fp-filters">
              <select v-model="fpBrand" class="input">
                <option value="">全部品牌</option>
                <option v-for="b in fpBrandOptions" :key="b" :value="b">{{ b }}</option>
              </select>
              <select v-model="fpCategory" class="input">
                <option value="">全部分类</option>
                <option v-for="c in fpCategoryOptions" :key="c" :value="c">{{ c }}</option>
              </select>
              <button class="btn btn-ghost btn-sm" @click="fpSelectAll(true)">全选</button>
              <button class="btn btn-ghost btn-sm" @click="fpSelectAll(false)">取消全选</button>
            </div>

            <div v-if="fpViewRows.length" class="pa-fp-wrap">
              <table class="tbl pa-fp-tbl">
                <thead><tr>
                  <th class="pa-fp-ck"></th><th>条码</th><th>名称</th><th>规格</th><th>单位</th>
                  <th class="num">参考：分销价</th><th class="num">填入进价</th>
                </tr></thead>
                <tbody>
                  <tr v-for="r in fpViewRows" :key="r.id" :class="{ 'pa-row-off': !r._ck }">
                    <td class="pa-fp-ck"><input type="checkbox" v-model="r._ck"></td>
                    <td class="pa-mono">{{ r.barcode || '—' }}</td>
                    <td class="pa-name">{{ r.name }}</td>
                    <td>{{ r.spec || '—' }}</td>
                    <td>{{ r.unit || '—' }}</td>
                    <td class="num pa-fp-ref">{{ Number(r.dist_price) > 0 ? money(r.dist_price) : '—' }}</td>
                    <td class="num"><input v-model="r._fp" class="input pa-fp-input" type="number" min="0" step="0.01" placeholder="0.00"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="state-empty">当前筛选下没有缺进价的商品 —— 都补好了</p>

            <p v-if="fpFiltered.length > fpShowLimit" class="pa-fp-more">
              表内只显示前 {{ fpShowLimit }} 个，另有 {{ fpFiltered.length - fpShowLimit }} 个请用「导出待补清单」批量处理
            </p>

            <div class="pa-fp-foot">
              <span class="pa-fp-count">已勾选 <b>{{ fpCheckedCount }}</b> 个 · 已填价 <b>{{ fpFilledCount }}</b> 个</span>
              <button class="btn btn-ghost btn-sm" @click="exportFpList">导出待补清单</button>
              <label class="btn btn-ghost btn-sm pa-file-btn">
                导入回填
                <input type="file" accept=".xlsx" style="display:none" @change="onFpFile">
              </label>
            </div>

            <div v-if="fpResult" class="pa-imp-result" :class="(fpResult.skipped?.length || fpResult.nokey) ? 'warn' : 'ok'">
              已更新 {{ fpResult.updated }} 个商品
              <template v-if="fpResult.unfilled">· {{ fpResult.unfilled }} 行进价留空（不算错）</template>
              <template v-if="fpResult.nokey">· {{ fpResult.nokey }} 行既没编号也没条码、认不出商品</template>
              <template v-if="fpResult.skipped?.length">· 跳过 {{ fpResult.skipped.length }} 个（{{ fpResult.skipped.slice(0, 3).map(s => (s.barcode || s.id) + '：' + s.reason).join('；') }}）</template>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-ghost" @click="fpOpen = false">关闭</button>
            <button class="btn btn-primary" :disabled="fpSaving || fpFilledCount === 0" @click="saveFpBatch">
              {{ fpSaving ? '保存中…' : `保存已填的 ${fpFilledCount} 行` }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 共享品牌候选 datalist：仅一份，避免每行重复渲染造成 DOM 爆炸（沿用 Forecast 修复范式） -->
    <datalist id="pa-brand-list">
      <option v-for="b in brandOptions" :key="b" :value="b"></option>
    </datalist>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import ImportMapping from '../components/ImportMapping.vue'
import { ref, computed, onMounted, nextTick } from 'vue'
import { api } from '../api/client'
import { productsApi, importApi } from '../api/modules'
import * as XLSX from 'xlsx'
import { toast } from '../store'
/* v184b：到货周期文案 / 解析的**唯一实现**（与「本期预报」主表共用同一份，见该文件注释）。
   本页若自己再写一份格式化 = 第二份拷贝 = 静默漂移（同一商品两处显示不一致）。 */
import { arrivalCycleText, parseArrivalDays, ARRIVAL_MAX } from '../utils/arrival.js'

const loading = ref(false)
const products = ref([])
const total = ref(null)
const page = ref(1)
const pageSize = ref(50)
const keyword = ref('')
const brandFilter = ref('')
const categoryFilter = ref('')
const includeInactive = ref(false)
const brandOptions = ref([])
const categoryOptions = ref([])

// ---- v157 进价（v165 更正口径；v226b 实证再修正）----
// 🔴 进价 ≡ 厂家跟经销商结算的价（用户 2026-09-14 定调原话「厂价就是进价」；v226 起界面统一叫「进价」）。
// v132 曾把它另建成独立列 `factory_price`，与既有列 `purchase_price` 并列为两个「进价」输入框；
// v226 用户拍板「两词一个意思」⇒ 界面**合成一列**（对外叫「进价」，绑 `factory_price`）。
// 🔴 v226b 实证：**两列的"同义"仅止于界面文案，值本身既不同量纲、也不同语义** ——
//   `factory_price` 元/箱；`purchase_price` 元/小单位且实测 56/56 == `sale_price`（存的是卖给门店的价）。
//   ⇒ 本页的解析口径（`factory_price` 优先，缺则取 `purchase_price`）**只用于"有没有录过价"**：
//      列表展示 / 缺价计数 / 补价面板。**它不参与金额计算**（那是 `Forecast.vue::factoryPrice()`，只认前者）。
//   闸门开启后，两列都没有的商品会在报单导入 / 小程序报单时被拒收。
// 解析的唯一实现：前端 `fpEff()`（本页）/ 后端 `db.factory_price_sql`（同为"有没有"口径）。改口径请只改这两处。
const allProducts = ref([])           // 全量商品索引（含停用），供补进价面板与分类候选共用
const missingFactoryCount = ref(0)    // 启用商品中「连进价都没有」的数量 → 为 0 时工具栏入口自动隐藏
const editingFpId = ref(null)
const editFp = ref('')
const fpOpen = ref(false)
const fpRows = ref([])                // [{...product, _ck, _fp}]
const fpBrand = ref('')
const fpCategory = ref('')
const fpSaving = ref(false)
const fpResult = ref(null)
const fpShowLimit = 200               // 面板内一次渲染上限（其余走「导出待补清单」）
// v158 进价闸门：开启后「报单导入」与「小程序报单」都会拒收**连进价都没有**的商品行；**默认关闭**。
// 关闭时价格没录也能照常报单：有进价的按进价算，只有两者皆无才按标准售价回退估算（偏大）。
// 文案必须如实说清，不能无条件写「会被拒收」（此前 8 处文案都这么写，而代码里根本没有拒收逻辑）。
const fpGate = ref(false)
const fpGateBusy = ref(false)
const fpGateMissing = ref(0)          // 后端权威的「连进价都没有」计数

const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize.value)))

/* ---- v157 批量补进价：派生视图 ---- */
const fpBrandOptions = computed(() => [...new Set(fpRows.value.map(r => r.brand).filter(Boolean))].sort())
const fpCategoryOptions = computed(() => [...new Set(fpRows.value.map(r => r.category).filter(Boolean))].sort())
const fpFiltered = computed(() => fpRows.value.filter(r =>
  (!fpBrand.value || r.brand === fpBrand.value) && (!fpCategory.value || r.category === fpCategory.value)))
const fpViewRows = computed(() => fpFiltered.value.slice(0, fpShowLimit))
const fpCheckedCount = computed(() => fpViewRows.value.filter(r => r._ck).length)
const fpFilledCount = computed(() => fpViewRows.value.filter(r => r._ck && Number(r._fp) > 0).length)

const editingId = ref(null)
const editBrand = ref('')

// ---- v184b 到货周期：行内编辑（沿用品牌 / 进价两列的改法）----
// 🔴 与「本期预报」主表那列的关系 = **同一列、两个写入口**（预报导入 / 本页），
//    展示都走 utils/arrival.js::arrivalCycleText；主表网格里它仍是只读（`edit:'ro'`），
//    要改值只能来本页或走导入 —— 所以那里右键提示语指向的正是本页。
const editingCycleId = ref(null)
const editCycle = ref('')
const detailOpen = ref(false)
const detailTarget = ref(null)

/* ========================= v184c 商品编辑（原「只读详情」升级） =========================
   入口不变（仍是每行那个按钮），变的是弹窗从「只看」变成「可改」。

   🔴 保存走 **diff**：只提交真正改动过的字段，不是整表 PUT。三条理由见模板顶部注释
      （不留假痕迹 / 不误清空 / 并发更安全）。

   两份数据：
     · `editForm`     —— 与输入框双向绑定（用户改的是它）
     · `editBaseline` —— 打开弹窗那一刻的快照，**永不被写**
   两者归一化后不同 = 有未保存改动；`dirtyCount` 就是差异个数（驱动「保存」按钮的可用态）。 */
const editForm = ref({})
const editBaseline = ref({})
const saving = ref(false)
const confirmActive = ref(false)      // 停用/启用 的内联二次确认
const savingActive = ref(false)
const showChanges = ref(false)
const changesList = ref([])
const changesLoading = ref(false)
const changesLoaded = ref(false)      // 首次展开才请求，避免拖慢打开弹窗
const logBox = ref(null)              // 记录区（展开后滚进视野用）

/* 可编辑字段清单 —— **同时是提交白名单**（只有这里列的才可能进 PUT body）。
   ⚠️ 条码 / 厂家编码**有意不在**清单里：条码是唯一索引（`WHERE barcode!=''`）且是至少 5 条链路的
      关联键（扫码查询、导入匹配、返利达成、档案弹层、预报配置），给它一个输入框就是给一把能
      断链路的钥匙。要改条码得走专门的冲突处理流程。 */
const EDIT_FIELDS = [
  'name', 'spec', 'unit', 'category', 'brand', 'alias',
  'sale_price', 'purchase_price', 'factory_price', 'dist_price',
  'safety_stock', 'expiry_days', 'arrival_lead_days', 'description',
]

/* 数值型字段（diff 比较、校验、提交都按数字；其余按 trim 后的字符串）。
   与「留空 = 清空」配套：数值留空归一成 0 提交，字符串留空提交空串。 */
const EDIT_NUM_FIELDS = new Set([
  'sale_price', 'purchase_price', 'factory_price', 'dist_price',
  'safety_stock', 'expiry_days', 'arrival_lead_days',
])

/* 修改记录里 `field_name`（英文键）→ 中文。
   ⚠️ 这是**展示层**叫法，与后端 `routers/import_router.py::FIELD_LABELS`（「导入列能识别成哪个
      字段」的候选清单）**受众不同**，故不强行共用一份；但**同一字段的叫法必须对齐**：
        · `sale_price` 后端导入标签写「售价」，本页列头写「标准售价」⇒ 本表跟**页面口径**
          （同屏一致优先，用户在同一个页面不该看到两种叫法）；
        · `arrival_lead_days` / `alias` / `description` 不在 FIELD_LABELS 里，用页面已有叫法。
   映射不到的键**原样显示英文**（不隐藏、不猜）—— 否则下一个人会以为记录丢了。 */
const FIELD_CN = {
  name: '商品名称', spec: '规格', unit: '单位', barcode: '条码', brand: '品牌',
  category: '分类', factory_price: '进价', purchase_price: '进价（历史字段）', dist_price: '分销价',
  sale_price: '标准售价', safety_stock: '安全库存', expiry_days: '保质期(天)',
  product_code: '厂家商品编码', arrival_lead_days: '到货周期', alias: '别名',
  description: '描述', wholesale_price: '批发价', min_order_qty: '起订量',
  is_active: '状态', status: '状态', lead_time_days: '补货提前期',
  review_period_days: '复核周期(天)', reorder_point: '补货点',
  weight_kg: '重量(kg)', volume_m3: '体积(立方米)', large_unit: '大单位',
  unit_ratio: '换算比', medium_unit: '中包装单位', medium_ratio: '中包装换算比',
  created_at: '创建时间', updated_at: '更新时间',
}

/** 修改记录里「值」的展示美化。
 *  后端对数值列取 `str()` 落库，于是 `REAL` 列存 0 会写成 `'0.0'` —— 业务上就是「0」，
 *  末尾那个 `.0` 是浮点表示的噪音（对不懂技术的老板是纯干扰）。
 *  ⚠️ 只削**整数尾巴**，不碰其它任何字符：名称/规格/别名这类文本字段的值原样显示，
 *     否则「削尾巴」会把真实内容改掉（例如商品名正好叫「2026.0」）。
 *  空值统一显示「空」（比空白格更明确：它表示「改前是空的」，不是「没有这一列」）。 */
function logVal(v) {
  if (v === '' || v == null) return '空'
  const s = String(v)
  return /^-?\d+\.0$/.test(s) ? s.slice(0, -2) : s
}

/** 归一化：数值字段恒为数字（空/非法 → 0），其余为去掉首尾空白的字符串。
 *  ⚠️ 必须与后端口径一致 —— 若把 `''` 与 `0` 判成不同，就会为「其实什么都没改」多发一次 PUT，
 *  于是修改记录里凭空多出一条。 */
function _norm(k, v) {
  if (EDIT_NUM_FIELDS.has(k)) {
    const n = Number(v)
    return isFinite(n) ? n : 0
  }
  return String(v == null ? '' : v).trim()
}

/* 未保存改动数（0 → 保存按钮置灰）。 */
const dirtyCount = computed(() => {
  const a = editForm.value || {}, b = editBaseline.value || {}
  let n = 0
  for (const k of EDIT_FIELDS) if (_norm(k, a[k]) !== _norm(k, b[k])) n++
  return n
})

/* 新增弹窗 */
const addOpen = ref(false)
const addSaving = ref(false)
const addForm = ref({ name: '', barcode: '', spec: '', unit: '', brand: '', category: '', purchase_price: '', factory_price: '', sale_price: '', safety_stock: '', expiry_days: '', arrival_lead_days: '' })

// 导入弹窗
const impOpen = ref(false)
const impFile = ref(null)
const impFileName = ref('')
const impResult = ref(null)
const impSaving = ref(false)
/* v178 列映射确认：导入由「一步」改为「两步」——先识别、让你看清每一列被当成什么，再执行。
   此前是 preview 的结果直接当 mapping 喂给 execute，中间无人可看：实测把「厂家商品编码」
   的编码串按关键词「厂家」写进了品牌列（`products.brand`），用户全程无感。 */
const impStep = ref('pick')          // pick=选文件 | map=确认列映射
const impSuggestions = ref([])       // /preview 的 suggestions（含样例值）
const impFieldOptions = ref([])      // 候选字段（**后端给**，前端不自己写一份键→中文）
const impMapping = ref({})

async function loadProducts() {
  loading.value = true
  try {
    const q = []
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (brandFilter.value) q.push('brand=' + encodeURIComponent(brandFilter.value))
    if (categoryFilter.value) q.push('category=' + encodeURIComponent(categoryFilter.value))
    if (includeInactive.value) q.push('include_inactive=1')
    q.push('limit=' + pageSize.value)
    q.push('offset=' + ((page.value - 1) * pageSize.value))
    const d = await api('/api/products?' + q.join('&'))
    products.value = d.items || []
    total.value = d.total || 0
  } catch (e) { toast(e.message || '加载商品失败', 'err') }
  finally { loading.value = false }
}

async function loadBrandOptions() {
  try {
    const d = await api('/api/brands?include_inactive=1')
    brandOptions.value = (Array.isArray(d) ? d : []).map(b => b.name).filter(Boolean)
  } catch (e) { /* 品牌候选为增强项，失败不影响主流程 */ }
}

// v157：一次性拉全量商品（含停用）做「商品索引」——
//   ① 分类筛选候选；② 「缺进价」计数（决定工具栏补进价入口显不显示）；③ 批量补进价面板的数据源。
// 428 行量级可接受；原先只为分类候选单独拉过一次，此处合并为一份缓存，避免重复请求。
async function refreshProductIndex() {
  try {
    const d = await api('/api/products?include_inactive=1&limit=5000')
    allProducts.value = Array.isArray(d.items) ? d.items : []
    categoryOptions.value = [...new Set(allProducts.value.map(p => p.category).filter(Boolean))].sort()
    recomputeMissingFactory()
  } catch (e) { /* 商品索引为增强项，失败不影响主流程 */ }
}

// v165 进价口径：**档案里有没有录过价格** —— 本函数回答的是这个。
// v132 曾把进价另建成独立列 factory_price，实测真实租户 `factory_price` 全空，价都在 purchase_price 里，
// 故判据放宽为「有厂价用厂价、没有才取历史进价」。
// 本函数是前端**唯一**的解析处（与后端 `factory_price_sql` 逐字同规则），一处供三用：
// 列表展示 / 缺价计数（工具栏徽标）/ 批量补价面板的数据源。
// 🔴 v226b 实证修正（原注释写「两列是**同一个量**」，**该表述是错的**，别再用）：
//   · `factory_price` = **元/箱**；`purchase_price` = **元/小单位**（实测 `factory_price = pp × perCase × 0.9`，46/46 成立）；
//   · 且 `purchase_price` 实测 **56/56 == `sale_price`**（46/46 还 == `dist_price`）⇒ 它存的是「卖给门店的价」。
//   ⇒ 回退**只在本函数这种「有没有」的语义下成立**（量纲不参与运算，值仅作展示与计数）。
//   🔴 **禁止**把本函数的返回值当作「元/箱 单价」去做乘法 —— 预报页金额基准走的是
//     `Forecast.vue::factoryPrice()`，那个**不回退**。两处口径有意分家，别互相"对齐"。
function fpEff(p) {
  const f = Number(p?.factory_price || 0)
  if (f > 0) return { v: f, from: 'factory' }
  const pp = Number(p?.purchase_price || 0)
  if (pp > 0) return { v: pp, from: 'purchase' }
  return { v: 0, from: 'none' }
}

function recomputeMissingFactory() {
  // 「待补进价」= 连进价都没有的启用商品（改前只看 factory_price ⇒ 真实租户 269 全中，
  // 会让用户重录一遍已经在「进价」里的数）。
  missingFactoryCount.value = allProducts.value
    .filter(p => p.is_active !== 0)
    .filter(p => fpEff(p).from === 'none').length
}

function onFilterChange() { page.value = 1; loadProducts() }
function onPageSizeChange() { page.value = 1; loadProducts() }
function goPage(p) { if (p < 1 || p > totalPages.value) return; page.value = p; loadProducts() }
function resetFilters() {
  keyword.value = ''; brandFilter.value = ''; categoryFilter.value = ''; includeInactive.value = false
  page.value = 1; loadProducts()
}

function money(n) {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (isNaN(v)) return '—'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function startEditBrand(p) { editingId.value = p.id; editBrand.value = p.brand || '' }
async function saveBrand(p) {
  if (editingId.value !== p.id) return  // 已保存过（如 Enter + blur 重复触发）
  editingId.value = null
  const raw = (editBrand.value || '').trim()
  if (raw === (p.brand || '')) return  // 无变化
  try {
    await api('/api/products/' + p.id, { method: 'PUT', body: { brand: raw } })
    p.brand = raw
    toast('品牌已更新（已自动归一）', 'ok')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* ---- v157 进价：行内编辑（沿用品牌的行内改法）---- */
function startEditFp(p) {
  editingFpId.value = p.id
  editFp.value = Number(p.factory_price) > 0 ? String(p.factory_price) : ''
}

async function saveFp(p) {
  if (editingFpId.value !== p.id) return  // 已保存过（Enter + blur 重复触发）
  editingFpId.value = null
  // ⚠️ 必须 String() 包一层：输入框是 type="number"，Vue 的 v-model 会自动把值转成
  //    number（2.8 而不是 "2.8"），直接 .trim() 会抛 "trim is not a function" 把整页打崩
  //    （真机 E2E 抓到；纯逻辑测试抓不到）。品牌那列是 text 才没这问题。
  const raw = String(editFp.value ?? '').trim()
  const nv = Number(raw)
  // 进价必须为正数：0/空 = 「没打算补」，不作为有效输入提交（后端同样拒绝 <=0）
  if (!raw || isNaN(nv) || nv <= 0) { toast('进价请填大于 0 的数字', 'err'); return }
  if (nv === Number(p.factory_price || 0)) return  // 无变化
  try {
    const r = await productsApi.batchFactoryPrice([{ id: p.id, factory_price: nv }])
    if (!r.updated) { toast(r.skipped?.[0]?.reason || '未更新', 'warn'); return }
    p.factory_price = nv
    const hit = allProducts.value.find(x => x.id === p.id)
    if (hit) hit.factory_price = nv
    recomputeMissingFactory()
    toast('进价已更新', 'ok')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* ---- v184b 到货周期：行内编辑 ----
   写的是 `products.arrival_lead_days`（该单品下单后第几天到货，整数，0 = 未设置）。
   ① 后端白名单：`db/queries/products.py::product_update.allowed` —— 不在那里放行，本页改完
      会**静默回旧值**（HTTP 200、零报错），属于「改了没反应」里最难查的一种。
   ② 校验 + 展示走 `utils/arrival.js` 同一份规则（上界 365 与后端 `_ATD_MAX` / 路由层同值）。
   ③ **留空 = 取消设置**（提交 0，本页显示「未设」、预报主表显示「—」）。这与**预报导入**的
      「留空 = 不改动」相反，是有意的：导入是成百行的批量动作（空格子多半只是「没意见」），
      这里是用户专门点开某一格的定向动作（留空只能是「清掉它」）。两边都各自显式提示。 */
function startEditCycle(p) {
  editingCycleId.value = p.id
  editCycle.value = Number(p.arrival_lead_days) > 0 ? String(p.arrival_lead_days) : ''
}
async function saveCycle(p) {
  if (editingCycleId.value !== p.id) return  // 已保存过（Enter + blur 重复触发）
  editingCycleId.value = null
  const r = parseArrivalDays(editCycle.value)
  if (!r.ok) { toast(`到货天数请填 0~${ARRIVAL_MAX} 之间的整数（留空或 0 = 取消设置）`, 'err'); return }
  if (r.value === (Number(p.arrival_lead_days) || 0)) return  // 无变化
  try {
    await api('/api/products/' + p.id, { method: 'PUT', body: { arrival_lead_days: r.value } })
    p.arrival_lead_days = r.value
    const hit = allProducts.value.find(x => x.id === p.id)
    if (hit) hit.arrival_lead_days = r.value   // 索引同步：切页前再调详情弹层也读到新值
    toast(r.value > 0
      ? `到货周期已设为 ${arrivalCycleText(r.value)}`
      : '已取消设置（该商品在预报主表显示「—」）', 'ok')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* ---- v157 进价：批量补（存量商品）---- */
/* 🔴 v226b 修：过滤口径与 `recomputeMissingFactory()` / `fpEff()` **统一**。
   此前这里写的是 `!(Number(p.factory_price) > 0)` —— 只看 `factory_price` 一列，而
   工具栏徽标与导出清单走的是 `fpEff()`（有厂价用厂价、没有才取历史进价）⇒ **同一功能两条路径给出两个数**：
   面板标题说「还有 134 个商品连进价都没有」，而同一屏的工具栏徽标与导出清单都是 124，差的那 10 个
   正是「历史进价列里其实有值」的商品 —— 档案列表对它们显示「取进价 ¥x」，
   面板却要用户重录一遍（面板自己的提示语还写着"后两处已有值的商品不必在这里重录"，自相矛盾）。
   ⇒ 一处口径（`fpEff`）供三处共用：徽标 / 导出清单 / 本面板。
   ⚠️ 与「金额基准」的区别：`factoryPrice()`（预报页算钱）**不回退**历史进价（元/小单位，混量纲）；
   本函数服务的是「档案里有没有价格信息」，回退是对的。两件事不同，别互相"对齐"。 */
function _rebuildFpRows() {
  const miss = allProducts.value
    .filter(p => p.is_active !== 0)
    .filter(p => fpEff(p).from === 'none')
  fpRows.value = miss.map(p => ({ ...p, _ck: true, _fp: '' }))
}

function openBatchFp() {
  _rebuildFpRows()
  fpBrand.value = ''
  fpCategory.value = ''
  fpResult.value = null
  fpSaving.value = false
  fpOpen.value = true
  loadFpGate()
}

/* ---- v158 进价闸门：读状态 / 开与关 ---- */
async function loadFpGate() {
  try {
    const g = await productsApi.factoryPriceGate()
    fpGate.value = !!g.enabled
    fpGateMissing.value = Number(g.missing_count || 0)
  } catch (e) { /* 读不到不影响面板正常使用，保持默认「未开启」 */ }
}

async function toggleFpGate() {
  const next = !fpGate.value
  fpGateBusy.value = true
  try {
    const g = await productsApi.setFactoryPriceGate(next)
    fpGate.value = !!g.enabled
    fpGateMissing.value = Number(g.missing_count || 0)
    toast(next
      ? `已开启进价必填：连进价都没有的商品在报单导入 / 小程序报单时会被拒收（当前还有 ${g.missing_count} 个没补）`
      : '已关闭进价必填：不再拦价格缺失的商品（有进价的按进价算，两者皆无才按标准售价估算）',
      next ? 'warn' : 'ok')
  } catch (e) { toast(e.message || '开关失败', 'err') }
  finally { fpGateBusy.value = false }
}

function fpSelectAll(v) { fpViewRows.value.forEach(r => { r._ck = v }) }

// 导出待补清单：**走后端生成**（后端那份带「商品编号」列作导回钥匙）。
// 为什么不在前端用 SheetJS 造：钥匙规则必须在唯一一处实现 —— 实测前端那版只有条码，
// 而本域存在「无条码商品」（演示租户 11 个待补商品全部无条码）与「共码商品」
// （两个下单主体共用同一商品条码），只认条码 → 前者永远补不回去、后者会把进价写到错的商品上。
async function exportFpList() {
  try {
    const blob = await importApi.factoryPriceTemplate({ brand: fpBrand.value, category: fpCategory.value })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `待补进价清单_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`已导出 ${fpFiltered.value.length} 条，填好「进价」列后点「导入回填」`, 'ok')
  } catch (e) { toast(e.message || '导出失败', 'err') }
}

// 导回填价结果：走后端 /factory-price-apply（编号优先、条码兜底；逐条回报跳过原因）。
async function onFpFile(ev) {
  const f = ev.target.files && ev.target.files[0]
  ev.target.value = ''
  if (!f) return
  if (!/\.xlsx$/i.test(f.name)) { toast('请上传 .xlsx（用「导出待补清单」下载的文件填写，另存为 .xlsx）', 'err'); return }
  fpSaving.value = true
  try {
    const r = await importApi.factoryPriceApply(f)
    await refreshProductIndex()
    loadProducts()
    _rebuildFpRows()
    fpResult.value = {
      updated: r.updated || 0, skipped: r.skipped || [],
      unfilled: r.unfilled || 0, nokey: r.nokey || 0,
    }
    await loadFpGate()
    const bits = []
    if (r.unfilled) bits.push(`${r.unfilled} 行进价留空（不算错）`)
    if (r.nokey) bits.push(`${r.nokey} 行既没编号也没条码、认不出是哪个商品`)
    toast(`回填完成：更新 ${r.updated} 个`
      + `${r.skipped?.length ? '，跳过 ' + r.skipped.length + ' 个' : ''}`
      + `${bits.length ? '（' + bits.join('；') + '）' : ''}`,
      (r.skipped?.length || r.nokey) ? 'warn' : 'ok')
    if (!r.skipped?.length && !r.nokey) fpOpen.value = false
  } catch (e) { toast(e.message || '回填失败', 'err') }
  finally { fpSaving.value = false }
}

async function saveFpBatch() {
  const picked = fpViewRows.value.filter(r => r._ck && Number(r._fp) > 0)
  if (!picked.length) { toast('请至少勾选一行并填入进价', 'warn'); return }
  fpSaving.value = true
  try {
    const r = await productsApi.batchFactoryPrice(
      picked.map(x => ({ id: x.id, factory_price: Number(x._fp) })))
    await refreshProductIndex()
    loadProducts()
    _rebuildFpRows()
    fpResult.value = r
    toast(`已更新 ${r.updated} 个商品${r.skipped?.length ? '，跳过 ' + r.skipped.length + ' 个' : ''}`,
      r.skipped?.length ? 'warn' : 'ok')
    if (!r.skipped?.length) fpOpen.value = false
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { fpSaving.value = false }
}

/* ============================ v184c 商品编辑：打开 / 保存 / 关闭 ============================ */

/** 打开编辑弹窗：把该商品的值拷两份 —— `editForm`（可变）+ `editBaseline`（diff 基线，不动）。
 *
 *  ⚠️ 数值字段**为 0 时渲染成空框**（而不是「0」）：这样用户一眼能分清「没设」与「有值」，
 *  也与本弹窗的「留空 = 清空」语义一致（想清掉就把框清空）。placeholder 里写了 0/示例，
 *  所以空框不会被误读成「这个字段不存在」。
 *  ⚠️ 进价框显示的是**存储值**（`factory_price`）而不是列表列那个 `fpEff()` 解析值 —— 列表里
 *  「取进价 3.5」说的是「factory_price 没单独录，按口径用 purchase_price」，若在这里显示 3.5，
 *  用户会以为已录，保存时也会把 0 写成 3.5。 */
function openDetail(p) {
  detailTarget.value = p
  const f = {}, b = {}
  for (const k of EDIT_FIELDS) {
    let v
    if (EDIT_NUM_FIELDS.has(k)) {
      const n = Number(p[k])
      v = (isFinite(n) && n > 0) ? String(n) : ''
    } else {
      v = p[k] == null ? '' : String(p[k])
    }
    f[k] = v
    b[k] = _norm(k, v)
  }
  editForm.value = f
  editBaseline.value = b
  saving.value = false
  confirmActive.value = false
  showChanges.value = false
  changesLoaded.value = false
  changesList.value = []
  detailOpen.value = true
}

/** 关闭编辑弹窗。有未保存改动时**提示一次**再关 —— 不静默丢弃（用户会以为存上了），
 *  也不挡着不让人关（点遮罩/叉号本来就是「算了」的意思）。 */
function tryCloseEdit() {
  if (saving.value) return                    // 保存进行中不给关，避免半途状态
  if (dirtyCount.value) toast(`已放弃 ${dirtyCount.value} 处未保存的改动`, 'warn')
  detailOpen.value = false
  confirmActive.value = false
}

/** 保存：**只提交改动过的字段**（diff）。
 *
 *  三处在发出请求前必须拦住（拦住 = 不发请求，与后端「宁可不写、不写脏」同向）：
 *   ① **商品名称为空** —— `products.name` 是 NOT NULL，但**空串不是 NULL**，SQLite 会照收 ⇒
 *      库里会出现无名商品（而它会出现在报单/小程序里）。后端也已补同一道闸（双保险）。
 *   ② **到货周期非法** —— 走 `utils/arrival.js` 同一份规则（上界与后端 `_ATD_MAX` 同值）。
 *   ③ **数值为负 / 非数字** —— `type=number` 只在 DOM 层拦得住「字母」，拦不住负数与越界。 */
async function saveEdit() {
  const p = detailTarget.value
  if (!p) return
  const f = editForm.value, b = editBaseline.value
  const body = {}
  for (const k of EDIT_FIELDS) {
    const nv = _norm(k, f[k])
    if (nv === b[k]) continue                 // 没动过 → 不进 body（这就是 diff）
    body[k] = nv
  }
  if (!Object.keys(body).length) { toast('没有改动', 'warn'); return }
  if ('name' in body && !String(body.name).trim()) { toast('商品名称不能为空', 'err'); return }
  if ('arrival_lead_days' in body) {
    const r = parseArrivalDays(body.arrival_lead_days)
    if (!r.ok) { toast(`到货天数请填 0~${ARRIVAL_MAX} 之间的整数（留空或 0 = 取消设置）`, 'err'); return }
    body.arrival_lead_days = r.value
  }
  for (const k of EDIT_NUM_FIELDS) {
    if (k in body && (!isFinite(body[k]) || body[k] < 0)) {
      toast((FIELD_CN[k] || k) + ' 不能是负数或非数字', 'err'); return
    }
  }
  saving.value = true
  try {
    await api('/api/products/' + p.id, { method: 'PUT', body })
    // 就地更新列表行 + 全量索引：切页回来、后续金额/补价计算都读到新值
    Object.assign(p, body)
    const hit = allProducts.value.find(x => x.id === p.id)
    if (hit) Object.assign(hit, body)
    if ('brand' in body) loadBrandOptions()   // 品牌可能是新值 → 刷新下拉候选
    toast(`已保存 ${Object.keys(body).length} 处改动`, 'ok')
    detailOpen.value = false
    if (changesLoaded.value) loadChanges(p.id)   // 记录已展开 → 顺手刷新，让刚改的立即可见
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { saving.value = false }
}

/** 停用 / 启用（`v` = 1 启用 / 0 停用）。
 *
 *  ⚠️ 走同一个 `PUT /api/products/{id}`（`is_active` 本就在 `product_update` 白名单里）。
 *  ⚠️ 停用是**有业务后果**的动作：该商品会从报单导入与小程序报单的可选列表里消失
 *     （既有单据不受影响）⇒ 故用内联二次确认，不做一键直通。 */
async function applyActive(v) {
  const p = detailTarget.value
  if (!p) return
  savingActive.value = true
  try {
    await api('/api/products/' + p.id, { method: 'PUT', body: { is_active: v } })
    p.is_active = v
    const hit = allProducts.value.find(x => x.id === p.id)
    if (hit) hit.is_active = v
    toast(v === 0
      ? '已停用 —— 该商品不再出现在报单与小程序的可选列表'
      : '已启用 —— 该商品重新可选', 'ok')
    confirmActive.value = false
    recomputeMissingFactory()                 // 停用会改变「缺进价」计数口径（该计数只算启用商品）
    if (changesLoaded.value) loadChanges(p.id)
  } catch (e) { toast(e.message || '操作失败', 'err') }
  finally { savingActive.value = false }
}

/** 展开/收起修改记录：**首次展开才请求**；展开后把记录区滚进视野。
 *
 *  ⚠️ 最后那步 `scrollIntoView` 不是装饰 —— 弹窗内容比视口长（14 字段 + 状态 + 记录），
 *  记录区在底部，用户点「展开」时它往往在视口外 ⇒「点了展开却什么都没出现」，
 *  看起来就像**没有记录**（v184c 首轮真机截图正是如此）。这个动作让「打开」的结果立刻可见。 */
async function toggleChanges() {
  showChanges.value = !showChanges.value
  if (!showChanges.value) return
  if (!changesLoaded.value) await loadChanges(detailTarget.value?.id)
  await nextTick()      // 记录区可能刚由 v-if 挂载出来，要等这一拍才拿得到元素
  if (logBox.value && logBox.value.scrollIntoView) {
    logBox.value.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

/** 拉商品修改记录（字段级留痕）。
 *  ⚠️ 后端 `GET /api/products/{pid}/changes` 直接返回 **数组**（与本仓销售订单那个返回
 *  `{changes:[...]}` 的端点**形态不同**）—— 这里两种都兼容，免得换个端点就静默空白。 */
async function loadChanges(pid) {
  if (!pid) return
  changesLoading.value = true
  try {
    const d = await productsApi.changes(pid)
    changesList.value = Array.isArray(d) ? d : (d && d.changes) || []
    changesLoaded.value = true
  } catch (e) { toast(e.message || '修改记录加载失败', 'err') }
  finally { changesLoading.value = false }
}


/* ---- 新增商品 ---- */
function openAdd() {
  addForm.value = { name: '', barcode: '', spec: '', unit: '', brand: '', category: '', purchase_price: '', factory_price: '', sale_price: '', safety_stock: '', expiry_days: '', arrival_lead_days: '' }
  addSaving.value = false
  addOpen.value = true
}
function _num(v, d = 0) { const n = Number(v); return isNaN(n) ? d : n }
async function saveAdd() {
  const f = addForm.value
  if (!f.name.trim()) { toast('请填写商品名称', 'err'); return }
  // v184b：到货周期先校验再提交 —— 非法值一律不发请求（与后端同一口径「宁可不写，不写脏」）。
  const _cyc = parseArrivalDays(f.arrival_lead_days)
  if (!_cyc.ok) { toast(`到货天数请填 0~${ARRIVAL_MAX} 之间的整数（留空 = 不设置）`, 'err'); return }
  addSaving.value = true
  try {
    const row = {
      name: f.name.trim(),
      barcode: f.barcode.trim(),
      spec: f.spec.trim(),
      unit: f.unit.trim() || '件',
      brand: f.brand.trim(),
      category: f.category.trim(), // 显式提供（含空），后端仅当提供时更新
      // 🔴 v226：此处原为 `purchase_price: _num(f.purchase_price)`（**无条件**带键）。
      //   界面已把两个进价输入框合成一个 ⇒ `f.purchase_price` 恒为空 ⇒ `_num("")` = 0
      //   ⇒ 新增同名商品走 upsert 时会把库里已有的 `purchase_price` **清零**。
      //   故本键改为**只在真填了值时才带**（与下面 factory_price 同一条守卫）。
      ...(String(f.purchase_price).trim() === '' ? {} : { purchase_price: _num(f.purchase_price) }),
      // 进价：空 = 「不动已录的进价」。本页新增同名商品会走 upsert 覆盖其它字段，
      // 若把空值当 0 提交，会把用户补好的进价清零 —— 故只在真填了值时才带上该键。
      ...(String(f.factory_price).trim() === '' ? {} : { factory_price: _num(f.factory_price) }),
      sale_price: _num(f.sale_price),
      safety_stock: _num(f.safety_stock),
      expiry_days: _num(f.expiry_days),
      // v184b 到货周期：与进价同一条守卫 —— **留空 = 不带该键**（= 不改动已有的值）。
      //   本弹窗走 bulk-upsert，同名商品会命中更新分支；若把空值当 0 提交，
      //   会把导入或档案里已设好的到货周期清零（进价列踩过同一个坑）。
      ...(_cyc.empty ? {} : { arrival_lead_days: _cyc.value }),
    }
    const r = await productsApi.bulkUpsert([row])
    toast(`已保存（新增 ${r.inserted || 0} / 更新 ${r.updated || 0}）`, 'ok')
    addOpen.value = false
    loadProducts()
    refreshProductIndex()
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { addSaving.value = false }
}

/* ---- 导入商品 ---- */
function openImport() {
  impFile.value = null; impFileName.value = ''; impResult.value = null; impSaving.value = false
  impStep.value = 'pick'; impSuggestions.value = []; impFieldOptions.value = []; impMapping.value = {}
  impOpen.value = true
}
function onImpFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls|csv)$/i.test(f.name)) { toast('仅支持 Excel/CSV 文件', 'err'); ev.target.value = ''; return }
  impFile.value = f; impFileName.value = f?.name || ''; impResult.value = null
  impStep.value = 'pick'   // 换文件 → 映射作废，回到第一步重识别
}
async function downloadTpl() {
  try {
    const blob = await importApi.templateFile('products')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '商品导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}
/* 第一步：只识别、不落库。把每一列识别成什么、依据是什么、命中列里有哪几个值，
   一并摆到界面上（样例值是判断「品牌还是编码」的唯一依据）。 */
async function previewImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const prev = await importApi.preview(impFile.value, 'products')
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    if (!impSuggestions.value.length) { toast('没读到任何列，请检查文件是否为 Excel/CSV', 'err'); return }
    const m = {}
    for (const s of impSuggestions.value) if (s.suggested_field) m[s.index] = s.suggested_field
    impMapping.value = m
    impStep.value = 'map'
  } catch (e) { toast(e.message || '文件解析失败', 'err') }
  finally { impSaving.value = false }
}
/* 第二步：按用户**确认过/改过**的映射执行。mapping 由界面持有 —— 后端本来就照用它，
   所以"改判"是真生效的，不是只改个显示。 */
async function doImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const r = await importApi.execute(impFile.value, 'products', impMapping.value)
    impResult.value = r
    impStep.value = 'pick'
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadProducts()
  } catch (e) { toast(e.message || '导入失败', 'err') }
  finally { impSaving.value = false }
}

/* ---- 导出商品（当前筛选） ---- */
async function exportXlsx() {
  try {
    const q = []
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (brandFilter.value) q.push('brand=' + encodeURIComponent(brandFilter.value))
    if (categoryFilter.value) q.push('category=' + encodeURIComponent(categoryFilter.value))
    if (includeInactive.value) q.push('include_inactive=1')
    q.push('limit=5000'); q.push('offset=0')
    const d = await api('/api/products?' + q.join('&'))
    const items = d.items || []
    const rows = items.map(p => ({
      '商品名称': p.name, '条码': p.barcode || '', '规格': p.spec || '', '单位': p.unit || '',
      // v184b：到货周期。导出给**人看**，故用与页面同一种写法（`+3天`）。
      //   ⚠️ 未设置导出**空串**而不是页面那个「—」：破折号在表格里是噪音，且回导时会被当成一个值。
      //   ⚠️ 本导出**不是**回写通道：商品导入对已存在的条码是「冲突跳过」而非更新（见 import_router），
      //      要改存量商品的到货周期请在**本页点该格**改。
      '到货周期': Number(p.arrival_lead_days) > 0 ? arrivalCycleText(p.arrival_lead_days) : '',
      '品牌': p.brand || '', '分类': p.category || '',
      '标准售价': p.sale_price || 0,
      // v226：原有两个中文键都叫「进价」（分别取 purchase_price / factory_price），
      //   JS 对象里**后者覆盖前者** ⇒ 导出的一直是 factory_price。现只留一个键，行为不变。
      '进价': p.factory_price || 0, '分销价': p.dist_price || 0,
      '安全库存': p.safety_stock != null ? p.safety_stock : '', '保质期(天)': p.expiry_days != null ? p.expiry_days : '',
      '状态': p.is_active === 0 ? '停用' : '启用',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '商品档案')
    XLSX.writeFile(wb, `商品档案_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast(`已导出 ${rows.length} 条`, 'ok')
  } catch (e) { toast(e.message || '导出失败', 'err') }
}

onMounted(() => {
  loadProducts()
  loadBrandOptions()
  refreshProductIndex()
})
</script>

<style scoped>
.pa-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.pa-stat{font-size:13px;color:var(--t2);flex-shrink:0}
.pa-stat b{color:var(--p);font-size:16px}

/* v157 「补进价」入口：仅当有商品未录进价时出现，补完自动消失（不是常驻按钮） */
.pa-fp-btn{color:var(--war);border-color:rgba(var(--war-rgb),.35);gap:5px}
.pa-fp-btn:hover{background:rgba(var(--war-rgb),.1);color:var(--war)}
.pa-fp-n{display:inline-block;min-width:18px;padding:0 5px;border-radius:999px;background:rgba(var(--war-rgb),.16);font-size:11.5px;font-weight:600;line-height:16px;text-align:center}

/* v157 进价列（行内可编） */
.pa-fp-cell{white-space:nowrap}
.pa-fp-val{cursor:pointer;border-bottom:1px dashed transparent}
.pa-fp-val:hover{border-bottom-color:var(--p);color:var(--p)}
.pa-fp-from{cursor:pointer;color:var(--txt-3);font-size:12px;border-bottom:1px dashed transparent}
.pa-fp-from:hover{border-bottom-color:var(--p);color:var(--p)}
.pa-fp-miss{display:inline-block;padding:1px 8px;border-radius:8px;background:rgba(var(--war-rgb),.14);color:var(--war);font-size:12px;cursor:pointer}
.pa-fp-miss:hover{background:rgba(var(--war-rgb),.24)}
.pa-fp-input{width:92px;height:30px;text-align:right;padding:0 8px}
.pa-hint{font-size:11px;color:var(--t3);font-weight:400;margin-left:4px}

/* v184b 到货周期列：行内可编，沿用进价列的视觉语言（虚线下划 + hover 变品牌色），
   但**不用**警示色 —— 见下面 .pa-cyc-none 的注释。 */
.pa-cyc-cell{white-space:nowrap;text-align:center}
.pa-cyc-val{cursor:pointer;border-bottom:1px dashed transparent;font-variant-numeric:tabular-nums}
.pa-cyc-val:hover{border-bottom-color:var(--p);color:var(--p)}
/* 「未设」用**灰**（--t3）而不是进价列那种琥珀（--war）：
   缺进价是**问题**（闸门开启后该商品在报单导入/小程序报单时会被拒收），缺到货周期只是「未设置」。
   本租户 285 个在售商品里 274 个为空 —— 用警示色会变成满屏噪音，反而盖掉真正要看的缺价提示。 */
.pa-cyc-none{cursor:pointer;color:var(--t3);font-size:12px;border-bottom:1px dashed transparent}
.pa-cyc-none:hover{border-bottom-color:var(--p);color:var(--p)}
.pa-cyc-input{width:74px;height:30px;text-align:center;padding:0 6px}

.pa-panel{padding:18px;margin-bottom:14px}
.pa-filters{display:flex;gap:10px;flex-wrap:nowrap;align-items:center;overflow-x:auto;padding-bottom:2px}
.pa-search{position:relative;display:flex;align-items:center;flex:0 1 260px;min-width:170px;max-width:300px}
.pa-search-ico{position:absolute;left:10px;width:15px;height:15px;color:var(--t3);pointer-events:none}
.pa-kw{width:100%;padding-left:32px}
.pa-filters select{flex:0 0 140px;width:140px}
.pa-filters .pa-check,.pa-filters .btn{flex:0 0 auto}

.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.pa-name{font-weight:600;color:var(--t1)}
.pa-mono{font-size:12px;color:var(--t3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pa-brand{display:inline-block;min-width:48px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t1);cursor:pointer;transition:.15s}
.pa-brand:hover{background:rgba(var(--p-rgb,6,182,212),.14);color:var(--p)}
.pa-brand-input{height:30px;min-width:120px}
.pa-status{font-size:12px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t3)}
.pa-status.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.pa-status.off{background:rgba(var(--t3-rgb,156,163,175),.14);color:var(--t3)}
.pa-ops{white-space:nowrap}
.pa-ops .btn{margin-left:6px}

.pa-pager{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
.pa-pageinfo{font-size:12.5px;color:var(--t2)}
.pa-size{height:30px;width:auto}

/* 弹窗 */
.pa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.pa-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(520px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.pa-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.pa-modal-hd b{font-size:15px;color:var(--t1)}
.pa-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.pa-modal-body{padding:18px 20px}
.pa-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.pa-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 14px;background:var(--bg2);padding:8px 12px;border-radius:8px}

/* 详情网格 */
/* ---- v184c 商品编辑弹窗（原 .pa-detail-* 只读样式随弹窗改造一并删除，避免死 CSS）----
   宽度 720 而非默认 520：14 个字段 + 状态 + 修改记录，520 下两列会挤到每行只剩半句。
   body 可滚动 + max-height：本项目弹窗没有内置滚动，字段一多底部按钮会被推出视口（点不到保存）。 */
.pa-modal.pa-edit{width:min(720px,94vw);max-height:88vh;display:flex;flex-direction:column}
.pa-modal.pa-edit .pa-modal-body{overflow-y:auto}
/* 分组小标题：把 14 个字段切成「身份 / 品牌 / 价格 / 库存效期 / 描述 / 状态 / 记录」。
   没有分隔时就是一长条输入框，找「进价」和找「保质期」都得靠扫。 */
.pa-sec{font-size:12px;font-weight:600;color:var(--t2);margin:16px 0 8px;padding-bottom:5px;
  border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:6px}
.pa-modal-body>.pa-sec:first-of-type{margin-top:2px}
.pa-sec-click{cursor:pointer;user-select:none}
.pa-sec-click:hover{color:var(--p)}
.pa-caret{margin-left:auto;font-size:11.5px;color:var(--p);font-weight:400}
.pa-f-full{grid-column:1 / -1}
.pa-ta{height:auto;min-height:66px;padding:8px 10px;line-height:1.6;resize:vertical;font-family:inherit}
/* 状态行：徽标 + 说明 + 按钮排一行；说明占满剩余宽度，长句不撑破弹窗。 */
.pa-active{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pa-active .pa-hint{margin-left:0;flex:1 1 220px;min-width:0}
/* 停用按钮用危险色：它是本弹窗里唯一「有业务后果」的动作（商品从报单/小程序可选列表消失）。 */
.btn-danger{background:var(--dan-bg);color:var(--dan);border:1px solid transparent}
.btn-danger:hover{filter:brightness(.97)}
/* 底部左侧未保存提示：margin-right:auto 把它顶到左边，按钮组留在原位（不跳位）。 */
.pa-ft-note{margin-right:auto;font-size:12px;color:var(--war)}
/* 修改记录：时间 / 人 / 字段 / 改前→改后，前三列不换行、末列自适应。 */
.pa-log{border:1px solid var(--border-subtle);border-radius:10px;max-height:210px;overflow-y:auto}
.pa-log-empty{padding:14px;text-align:center;font-size:12.5px;color:var(--t3)}
.pa-log-row{display:flex;align-items:baseline;gap:10px;padding:7px 12px;font-size:12.5px;
  border-bottom:1px solid var(--border-subtle)}
.pa-log-row:last-child{border-bottom:0}
.pa-log-t{color:var(--t3);font-variant-numeric:tabular-nums;white-space:nowrap}
.pa-log-w{color:var(--t2);white-space:nowrap;max-width:96px;overflow:hidden;text-overflow:ellipsis}
.pa-log-f{color:var(--t2);white-space:nowrap;min-width:76px}
.pa-log-v{color:var(--t1);word-break:break-all;min-width:0}
.pa-log-v i{font-style:normal;color:var(--t3);text-decoration:line-through}
.pa-log-v b{font-weight:600}

/* 新增表单 */
.pa-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.pa-f{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.pa-f i{color:var(--dan);font-style:normal}
.pa-f .input{height:34px}

/* 导入 */
.pa-imp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pa-file-btn{position:relative;overflow:hidden}
.pa-fname{font-size:12.5px;color:var(--t2)}
.pa-imp-result{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;background:rgba(var(--suc-rgb),.1);color:var(--suc)}
.pa-imp-result.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}
.pa-errs{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.pa-err{font-size:12px;color:var(--t2)}

/* v157 批量补进价面板 */
.pa-modal.pa-wide{width:min(880px,96vw)}
/* v178 列映射确认步：表格要横向空间，且行数可能几十行 → 加宽 + 限高内滚（不撑出视口） */
.pa-modal.pa-map{width:min(880px,96vw);max-height:88vh;display:flex;flex-direction:column}
.pa-modal.pa-map .pa-modal-body{overflow-y:auto}
.pa-fp-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.pa-fp-filters select{flex:0 0 140px;width:140px;height:30px}
.pa-fp-wrap{max-height:46vh;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-md)}
.pa-fp-tbl{font-size:12.5px;margin:0}
.pa-fp-tbl thead th{position:sticky;top:0;z-index:1;background:var(--bg3)}
.pa-fp-tbl td,.pa-fp-tbl th{padding:5px 8px}
.pa-fp-ck{width:34px;text-align:center}
.pa-fp-ref{color:var(--t3)}
tr.pa-row-off td{opacity:.5}
.pa-fp-more{margin:8px 0 0;font-size:12px;color:var(--t2)}
.pa-fp-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
.pa-fp-count{font-size:12.5px;color:var(--t2);margin-right:auto}
.pa-fp-count b{color:var(--t1)}
/* v158 进价闸门开关：默认（未开启）走中性底色，开启后转成功色 —— 开关状态一眼可辨 */
.pa-fp-gate{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);font-size:12.5px;line-height:1.6}
.pa-fp-gate.on{background:rgba(var(--suc-rgb),.08);border-color:rgba(var(--suc-rgb),.35)}
.pa-fp-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;color:var(--t1);white-space:nowrap;user-select:none}
.pa-fp-switch input{width:15px;height:15px;margin:0;cursor:pointer;accent-color:var(--suc)}
.pa-fp-switch input:disabled{cursor:not-allowed;opacity:.5}
.pa-fp-gate.on .pa-fp-switch b{color:var(--suc)}
.pa-fp-gate-hint{flex:1 1 320px;min-width:0;color:var(--t2)}
.pa-fp-gate-hint b{color:var(--war)}

.state-empty{font-size:13px;color:var(--t3);text-align:center;padding:22px 0}
</style>
