<template>
  <div class="page">
    <div class="page-hd">
      <h2>货损核算</h2>
      <span class="page-sub">月度核算 · 期间流水口径</span>
    </div>

    <!-- ══ 主 Tab：看数 / 录数分开（对齐「目标与返利」页的同一套 .main-tabs） ══
         为什么要分：录数是"对着表格填"，看图是"回头看走势"。两者同屏时表格会被图表挤到
         屏幕外 —— 此前只能靠"录入态把整段趋势收起"来兜，而用户一进录入态就以为图没了，
         还得在编辑条里写一句话解释。分 tab 后这层补丁和那句话都不需要了。
         默认落在「仪表盘」（与「目标与返利」一致：老板每天先看数，录数是手段）。
         🔴 样式在 `styles/variables.css` 的全局层，全站唯一一份 —— 本页不重复定义。 -->
    <div class="main-tabs">
      <button class="main-tab" :class="{ on: mainTab === 'dashboard' }" @click="switchTab('dashboard')">仪表盘</button>
      <button class="main-tab" :class="{ on: mainTab === 'fill' }" @click="switchTab('fill')">数据填报</button>
    </div>

    <!-- ══ 仪表盘 Tab（只读）══════════════════════════════════════════════
         区间筛选 + 按月一览 + 趋势图。数据**全部**来自 GET /api/loss/accounting/trend
         （月列表与图表同源，不各自取数 —— 同屏两个口径是最难查的一类差异）。 -->
    <template v-if="mainTab === 'dashboard'">
      <!-- 🔴 诚实性：仪表盘读的是**已保存**的数据。有未保存的录入改动时必须在这里说清，
           否则用户会得出「我填了数、图怎么没变」—— 分 tab 之后这是最容易误解的一处。 -->
      <div v-if="dirtyCount" class="la-tabnote">
        当前有 <b>{{ dirtyCount }}</b> 格录入改动<b>尚未保存</b> ——
        本页读的是已保存的数据，切到「数据填报」保存后才会更新。
      </div>

      <div class="la-tbar">
        <span class="la-tbar-t">趋势区间</span>
        <select v-model.number="tRange" class="input la-sel-sm" aria-label="趋势区间" @change="loadTrend">
          <option :value="3">近 3 个月</option>
          <option :value="6">近 6 个月</option>
          <option :value="12">近 12 个月</option>
          <option :value="0">本年</option>
        </select>
        <label class="la-chk"><input v-model="tHideOpen" type="checkbox" /> 只看已结账月</label>
        <label class="la-chk"><input v-model="tSkipEmpty" type="checkbox" /> 跳过未录入月</label>
        <span v-if="trendLoading" class="la-quiet">加载中…</span>
        <span v-else-if="trendErr" class="la-tbar-err">{{ trendErr }}</span>
        <span class="la-tbar-r la-quiet">点柱子 = 切「当前期次」；点月列表「去填报」跳去录这个月</span>
      </div>

      <!-- 月列表 -->
      <div class="card la-ml">
        <div class="la-ml-hd">
          <b>按月一览</b>
          <span class="la-ml-sub">
            {{ tFrom }} → {{ tTo }} 共 {{ monthList.length }} 个月 ·
            有数据 {{ tSummary.months_with_data || 0 }} 个 ·
            已结账 {{ tSummary.months_closed || 0 }} 个
          </span>
        </div>
        <div v-if="!monthList.length" class="state-empty">这个区间还没有月份。</div>
        <div v-else class="la-ml-wrap">
          <table class="la-ml-tbl">
            <thead>
              <tr>
                <th>月份</th>
                <th class="num">货损净额</th>
                <th class="num">货损净率</th>
                <th class="num">净额环比</th>
                <th class="num">净率变化</th>
                <th>结账</th>
                <th>完整度</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(m, i) in monthList" :key="m.period"
                  :class="{ 'la-ml-cur': m.period === period, 'la-ml-hid': m.hidden }">
                <td class="la-ml-m">
                  <b>{{ m.period }}</b>
                  <u v-if="m.period === period" class="la-ml-badge">当前</u>
                  <u v-if="m.hidden" class="la-ml-badge la-ml-badge-hid">已隐藏</u>
                </td>
                <td class="num" :class="numCls(m.net_amt)">
                  {{ m.has_data ? wanText(m.net_amt) : '未录入' }}
                </td>
                <td class="num" :class="m.rate_net == null ? 'la-void-t' : ''">
                  {{ m.rate_net == null ? (m.has_data ? '—' : '—') : pctText(m.rate_net) }}
                </td>
                <td class="num" :class="momCls(momAmt(i))">{{ momAmtText(i) }}</td>
                <td class="num" :class="momCls(momRate(i))">{{ momRateText(i) }}</td>
                <td>
                  <span class="la-chip la-chip-mini" :class="m.is_closed ? 'is-closed' : 'is-open'">
                    {{ m.is_closed ? '已结账' : '未结账' }}
                  </span>
                </td>
                <td>
                  <span v-if="!m.has_data" class="la-ml-none">未录入</span>
                  <span v-else-if="!m.gaps.length" class="la-ml-ok">完整</span>
                  <span v-else class="la-ml-gap" :title="m.gaps.join('；')">缺 {{ m.gaps.length }} 项</span>
                </td>
                <td class="la-ml-op">
                  <button class="la-link" @click="goFill(m.period)">去填报</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <LossDashboard
        :months="chartMonths"
        :summary="tSummary"
        :subject-totals="trendSubjects"
        :groups-meta="trendGroups"
        :pricing="trendPricing"
        :period="period"
        :from="tFrom"
        :to="tTo"
        :skipped-empty="tSkipEmpty ? skipEmptyCount : 0"
        @pick="pickMonth"
      />
    </template>

    <!-- ══ 数据填报 Tab（**唯一能写的地方**）══════════════════════════════
         工具条 / 编辑条 / 公司卡 / 主表都在这里。仪表盘上点某月的「去填报」会切到本 tab
         并已定位到该月（见 goFill）。
         ⚠️ 下面「公司整体」与主表两块**保持原缩进**未重排：避免 175 行纯空白改动混进本页
         diff（本项目按 hunk 归属提交，纯缩进 churn 会让在途改动与本轮改动更难分辨）。 -->
    <template v-if="mainTab === 'fill'">
      <!-- 工具条 -->
      <div class="la-bar">
        <div class="la-bar-l">
          <select v-model="period" class="input la-sel" aria-label="核算期次" @change="reload">
            <option v-for="p in periods" :key="p.period" :value="p.period">
              {{ p.period }}{{ p.is_closed ? '（已结账）' : '' }}
            </option>
          </select>
          <span class="la-chip" :class="isClosed ? 'is-closed' : 'is-open'">
            {{ isClosed ? '已结账 · 数据锁定' : '未结账' }}
          </span>
          <span class="la-chip la-chip-quiet">数据截至 {{ updatedAt || '—' }}</span>
          <label class="la-pricing">
            <span>计价口径</span>
            <select v-model="pricing" class="input la-sel-sm" aria-label="计价口径" @change="onChangePricing">
              <option value="sale">售价</option>
              <option value="cost">成本价（进货价）</option>
            </select>
            <i class="la-hint" title="全部金额按此口径折算。临期销售也走同一口径 —— 分子里不允许混两种币值。">?</i>
          </label>
        </div>
        <div class="la-bar-r">
          <button class="btn btn-ghost btn-sm" @click="openImport">上传数据</button>
          <button class="btn btn-sm" :class="editMode ? 'btn-primary' : ''" :disabled="isClosed && !editMode" @click="toggleEdit">
            {{ editMode ? '完成录入' : '手工录入' }}
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="doRecompute">重算</button>
          <button class="btn btn-ghost btn-sm" @click="toggleClose">{{ isClosed ? '反结账' : '结账' }}</button>
          <button class="btn btn-ghost btn-sm" @click="openRoles">叫法映射</button>
          <button class="btn btn-ghost btn-sm" @click="openHealth">
            数据体检<span v-if="healthBadge" class="la-badge">{{ healthBadge }}</span>
          </button>
        </div>
      </div>

      <!-- 编辑态提示条 -->
      <div v-if="editMode" class="la-editbar">
        <span class="la-editbar-txt">
          可填写的格子已变成输入框；<b>毛额 / 净额 / 货损率由系统在保存后重算</b>（不接受手工填写）。
        </span>
        <span v-if="dirtyCount" class="la-dirty">已改 <b>{{ dirtyCount }}</b> 格未保存</span>
        <span v-else class="la-quiet">尚未修改</span>
        <button class="btn btn-primary btn-sm" :disabled="!dirtyCount || saving" @click="saveManual">
          {{ saving ? '保存中…' : '保存并重算' }}
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="cancelEdit">放弃修改</button>
      </div>

    <!-- ══ 公司整体 ══ -->
    <div class="card la-co">
      <div class="la-co-hd">
        <b>公司整体</b>
        <span class="la-co-formula">
          分子 = ①门店退货 + ②业务员仓调临期 + ③良品仓直调 + ④报损 − 临期仓销售总额
          ｜ 分母 = 公司销售金额
        </span>
        <button class="la-link" @click="showBreakdown = !showBreakdown">
          {{ showBreakdown ? '收起构成' : '展开构成' }}
        </button>
      </div>
      <div class="la-co-kpis">
        <div class="la-kpi">
          <i>公司销售金额</i>
          <b>{{ wanText(coV('company_sales_amt')) }}</b>
          <em>万元</em>
        </div>
        <div class="la-kpi">
          <i>货损毛额</i>
          <b>{{ wanText(company.gross_amt) }}</b>
          <em>万元 · 未扣抵扣</em>
        </div>
        <div class="la-kpi">
          <i>货损净额</i>
          <b :class="numCls(company.net_amt)">{{ wanText(company.net_amt) }}</b>
          <em>万元 · 毛额 − 临期仓销售总额</em>
        </div>
        <div class="la-kpi la-kpi-main">
          <i>公司综合货损率</i>
          <b :class="numCls(company.rate_net)">{{ pctText(company.rate_net) }}</b>
          <em>
            毛率 {{ pctText(company.rate_gross) }}
            <template v-if="company.rate_den"> · 分母 {{ wanText(company.rate_den) }} 万元</template>
          </em>
        </div>
      </div>

      <div v-if="showBreakdown" class="la-bd">
        <div class="la-bd-row">
          <span>① 门店退临期仓</span><b>{{ wanText(bd.store_return_amt) }}</b>
        </div>
        <div class="la-bd-row">
          <span>② 业务员仓调至临期仓</span><b>{{ wanText(bd.op_to_loss_amt) }}</b>
        </div>
        <div class="la-bd-row">
          <span>③ 良品仓直调临期仓</span><b>{{ wanText(bd.direct_amt) }}</b>
        </div>
        <div class="la-bd-row">
          <span>④ 报损</span>
          <b>{{ wanText(bd.wastage_amt) }}</b>
          <u v-if="!bd.wastage_amt" class="la-warn-inline">未录入（0 元 ≠ 本月无货损）</u>
        </div>
        <div class="la-bd-row la-bd-sub">
          <span>小计（= 货损毛额）</span><b>{{ wanText(company.gross_amt) }}</b>
        </div>
        <div class="la-bd-row">
          <span>− 临期仓销售总额</span><b>{{ wanText(bd.loss_wh_sale_amt) }}</b>
        </div>
        <div class="la-bd-row la-bd-indent">
          <span>其中：业务员自售（已进 ② 行抵扣）</span><b>{{ wanText(bd.op_loss_sale_amt) }}</b>
        </div>
        <div class="la-bd-row la-bd-indent">
          <span>其中：良品仓直调临期销售（已进 ③ 行抵扣）</span><b>{{ wanText(bd.direct_loss_sale_amt) }}</b>
        </div>
        <div class="la-bd-row la-bd-indent">
          <span>其中：其他渠道（公司行才扣）</span><b>{{ wanText(coV('loss_wh_sale_other_amt')) }}</b>
        </div>
        <div class="la-bd-row la-bd-sub">
          <span>= 货损净额</span><b :class="numCls(company.net_amt)">{{ wanText(company.net_amt) }}</b>
        </div>
        <p class="la-bd-note">
          公司行扣的是<b>临期仓销售总额</b>；② 业务员行只扣<b>该业务员自售</b>、③ 直调行只扣<b>直调临期销售</b>
          —— 是包含关系，不是重复扣减（三行相加恰好等于总额）。
        </p>
      </div>

      <div v-if="qualityList.length" class="la-q">
        <span v-for="(q, i) in qualityList" :key="i" class="la-q-item">{{ q }}</span>
      </div>
    </div>

    <!-- ══ 主表 ══ -->
    <div class="card la-tbl-card">
      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else class="la-tblwrap">
        <table class="la-tbl">
          <colgroup>
            <col style="width:176px">
            <col v-for="s in slots" :key="s.key" :style="{ width: slotWidth(s.key) }">
          </colgroup>
          <thead>
            <tr>
              <th class="la-subj-th">主体</th>
              <th v-for="s in slots" :key="s.key" :class="{ num: s.key !== 'extra' }">
                {{ s.label }}
                <i class="la-hint" :title="s.hint">?</i>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in groups" :key="g.row_kind">
              <tr class="la-grp">
                <td :colspan="slots.length + 1">
                  <span class="la-grp-name">{{ groupMeta(g.row_kind).no }} {{ groupMeta(g.row_kind).title }}</span>
                  <span v-if="groupMeta(g.row_kind).denominator_label" class="la-grp-den">
                    分母 = {{ groupMeta(g.row_kind).denominator_label }}
                  </span>
                  <span v-else class="la-grp-den la-grp-noratio">无分母 · 不给率</span>
                  <span class="la-grp-desc">{{ groupMeta(g.row_kind).desc }}</span>
                  <button
                    v-if="editMode && isMulti(g.row_kind)"
                    class="la-add"
                    @click="openSubject(g.row_kind)"
                  >+ 添加{{ g.row_kind === 'store' ? '门店' : '业务员' }}</button>
                </td>
              </tr>

              <tr v-if="!g.rows.length" class="la-row la-row-blank">
                <td :colspan="slots.length + 1" class="la-blank">
                  还没有{{ g.row_kind === 'store' ? '门店' : '业务员' }}。
                  <template v-if="editMode">点右上角「+ 添加」开始。</template>
                  <template v-else>点「手工录入」后再添加。</template>
                </td>
              </tr>

              <tr v-for="r in g.rows" :key="r.subject_key || '_'" class="la-row" :class="{ 'la-row-edit': editMode }">
                <td class="la-subj">
                  <span class="la-subj-name" :title="r.note || r.subject_label">{{ r.subject_label }}</span>
                  <i
                    v-if="r.data_quality && r.data_quality.length"
                    class="la-dot"
                    :title="r.data_quality.join('；')"
                  ></i>
                  <button class="la-rowbtn" title="查看这一行的录入与修改记录" @click="openDetail(g.row_kind, r)">溯源</button>
                </td>
                <td
                  v-for="s in slots"
                  :key="s.key"
                  class="la-cell"
                  :class="cellCls(g.row_kind, r, s.key)"
                >
                  <template v-if="editableAt(g.row_kind, s.key)">
                    <input
                      class="la-input"
                      type="text"
                      inputmode="decimal"
                      :value="draftVal(g.row_kind, r, s.key)"
                      :placeholder="rawAt(g.row_kind, r, s.key) === null ? '未填' : ''"
                      @input="onInput(g.row_kind, r, s.key, $event.target.value)"
                    >
                    <span class="la-unit">{{ colAt(g.row_kind, s.key)?.unit === '%' ? '%' : '万元' }}</span>
                  </template>
                  <template v-else>
                    <span :class="valCls(g.row_kind, r, s.key)" :title="cellTitle(g.row_kind, r, s.key)">
                      {{ cellText(g.row_kind, r, s.key) }}
                    </span>
                  </template>
                </td>
              </tr>

              <tr class="la-sub">
                <td class="la-subj la-sub-lbl">小计</td>
                <td v-for="s in slots" :key="s.key" class="la-cell" :class="subCls(g.row_kind, s.key)">
                  {{ subText(g.row_kind, s.key) }}
                </td>
              </tr>
            </template>
          </tbody>
          <tfoot>
            <tr class="la-foot">
              <td class="la-subj la-foot-lbl">
                合计校验
                <i class="la-hint" title="表尾只做金额加总，不含率 —— 三个率的分母各不相同，不能相加也不能平均。它与上面的公司行是并列核对关系，不是替代。">?</i>
              </td>
              <td v-for="s in slots" :key="s.key" class="la-cell">{{ footText(s.key) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <p class="la-footnote">
      货损率以月度为核算单位，可每日更新；每次保存会重算本期并写一份当月账快照与当日趋势点。
      打开「手工录入」即可开始手动填报，导入的舟谱数据会在下一阶段接入。
    </p>
    </template>

    <!-- ══ 弹窗 ══ -->
    <Teleport to="body">
      <div v-if="modal" class="la-mask" @click.self="closeModal">
        <div class="la-modal">
          <!-- 上传数据（占位说明，文案来自后端） -->
          <template v-if="modal === 'import'">
            <div class="la-modal-hd">上传数据<button class="la-x" @click="closeModal">×</button></div>
            <div class="la-modal-bd">
              <p class="la-notice">{{ importMsg }}</p>
              <p class="la-modal-lead">下一阶段会支持这 4 类舟谱导出文件，自动解析并回填到本页：</p>
              <ul class="la-list">
                <li>门店销售单（自提订单）—— 门店销售额 + 临期仓销售额</li>
                <li>门店退货单（自提退单）—— 门店退到临期仓的金额</li>
                <li>调拨单明细 —— 良品仓 / 业务员仓 / 临期仓之间的 3 种组合</li>
                <li>报损单（舟谱无此数据，仍由手工录入）</li>
              </ul>
              <p class="la-modal-tip">
                解析后会先给你一个<b>预览</b>：每列被识别成什么、有哪些仓名/门店没认出来（带行数和金额），
                确认无误才落库。现在请先用「手工录入」按同样的口径填数，数据模型完全一致，将来导入可无缝接上。
              </p>
            </div>
            <div class="la-modal-ft"><button class="btn btn-primary btn-sm" @click="closeModal">知道了</button></div>
          </template>

          <!-- 叫法映射 -->
          <template v-else-if="modal === 'roles'">
            <div class="la-modal-hd">叫法映射<button class="la-x" @click="closeModal">×</button></div>
            <div class="la-modal-bd">
              <p class="la-modal-lead">
                不同经销商对同一个东西叫法不同（比如「良品仓」你们叫<b>总仓</b>）。这里改的是<b>显示名</b>——
                页面上所有地方会跟着变；将来导入时用于识别文件的<b>别名</b>是另一份清单。
              </p>
              <table class="la-mini">
                <thead><tr><th>概念</th><th>当前显示名</th><th>说明</th></tr></thead>
                <tbody>
                  <tr v-for="r in rolesList" :key="r.role">
                    <td class="la-mono">{{ r.role }}</td>
                    <td>
                      <input v-model="roleLabelDraft[r.role]" class="la-input-sm" maxlength="20">
                    </td>
                    <td class="la-quiet">{{ r.basis }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="la-modal-tip">
                识别用别名（共 {{ aliasList.length }} 条，如
                <span class="la-mono">{{ aliasPreview }}</span>）将在导入阶段开放维护。
              </p>
            </div>
            <div class="la-modal-ft">
              <button class="btn btn-ghost btn-sm" @click="closeModal">取消</button>
              <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveRoles">保存显示名</button>
            </div>
          </template>

          <!-- 数据体检 -->
          <template v-else-if="modal === 'health'">
            <div class="la-modal-hd">数据体检<button class="la-x" @click="closeModal">×</button></div>
            <div class="la-modal-bd">
              <div v-if="!healthItems.length" class="state-empty">本期没有发现待处理的问题。</div>
              <ul v-else class="la-health">
                <li v-for="(it, i) in healthItems" :key="i" :class="'lv-' + it.level">
                  <span class="la-health-lv">{{ it.level === 'warn' ? '需处理' : '提示' }}</span>
                  <span>{{ it.text }}</span>
                </li>
              </ul>
            </div>
            <div class="la-modal-ft"><button class="btn btn-primary btn-sm" @click="closeModal">关闭</button></div>
          </template>

          <!-- 添加主体 -->
          <template v-else-if="modal === 'subject'">
            <div class="la-modal-hd">
              添加{{ subjectForm.subject_kind === 'store' ? '门店' : '业务员' }}
              <button class="la-x" @click="closeModal">×</button>
            </div>
            <div class="la-modal-bd">
              <label class="la-field">
                <span>名称</span>
                <input v-model="subjectForm.subject_key" class="la-input-sm" :placeholder="subjectForm.subject_kind === 'store' ? '例如：永辉民发店' : '例如：王琴'">
              </label>
              <label class="la-field">
                <span>备注<em>选填</em></span>
                <input v-model="subjectForm.note" class="la-input-sm" placeholder="例如：仅直营 / 负责城东片区">
              </label>
              <p class="la-modal-tip">
                名称要与舟谱导出里的一致 —— 将来导入时靠它把数据归到这一行，改名不影响已录入的历史数据。
              </p>
            </div>
            <div class="la-modal-ft">
              <button class="btn btn-ghost btn-sm" @click="closeModal">取消</button>
              <button class="btn btn-primary btn-sm" :disabled="saving || !subjectForm.subject_key.trim()" @click="saveSubject">添加</button>
            </div>
          </template>

          <!-- 行溯源 -->
          <template v-else-if="modal === 'detail'">
            <div class="la-modal-hd">
              溯源 · {{ detailData?.subject_label || '' }}
              <button class="la-x" @click="closeModal">×</button>
            </div>
            <div class="la-modal-bd">
              <h4 class="la-h4">本行当前录入值</h4>
              <div v-if="!detailData?.inputs?.length" class="state-empty">本行尚无录入值。</div>
              <table v-else class="la-mini">
                <thead><tr><th>项目</th><th class="num">值（万元）</th><th>最后修改</th><th>修改人</th></tr></thead>
                <tbody>
                  <tr v-for="it in detailData.inputs" :key="it.col_key">
                    <td>{{ it.col_label }}</td>
                    <td class="num">{{ wanText(it.value) }}</td>
                    <td class="la-quiet">{{ it.updated_at || '—' }}</td>
                    <td class="la-quiet">{{ it.updated_by || '—' }}</td>
                  </tr>
                </tbody>
              </table>

              <h4 class="la-h4">修改记录（谁在什么时候改的）</h4>
              <div v-if="!detailData?.change_logs?.length" class="state-empty">暂无修改记录。</div>
              <table v-else class="la-mini">
                <thead><tr><th>字段</th><th>改前</th><th>改后</th><th>修改人</th></tr></thead>
                <tbody>
                  <tr v-for="l in detailData.change_logs" :key="l.id">
                    <td>{{ l.field_name }}</td>
                    <td class="la-quiet">{{ wanMaybe(l.old_value) }}</td>
                    <td>{{ wanMaybe(l.new_value) }}</td>
                    <td class="la-quiet">{{ l.user_name }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="la-modal-tip">
                单据级明细（哪张单、哪个商品、多少数量）要等导入接入后才能钻 —— 手工填报阶段能追溯的就是这张录入与修改记录。
              </p>
            </div>
            <div class="la-modal-ft"><button class="btn btn-primary btn-sm" @click="closeModal">关闭</button></div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { toast } from '../store'
import { lossAccountingApi } from '../api/modules'
import LossDashboard from '../components/LossDashboard.vue'

/* ════════════════════════════════════════════════════════════════════
   数据来源：**全部由后端下发** —— 列定义（col_defs）、列位与中文表头（slots）、
   行分组（row_groups）都来自 /api/loss/accounting/bootstrap。
   本文件**不写任何列名/列序/可否编辑的第二份定义** ——
   否则前端加一列、后端不知道，或后端改了列序、前端对不上，两处必然漂移。
   ════════════════════════════════════════════════════════════════════ */

/* ── 主 Tab（对齐「目标与返利」页）──
   `dashboard` = 只看数（区间筛选 / 按月一览 / 趋势图，全部只读）
   `fill`      = 录数与结账（工具条 / 编辑条 / 公司卡 / 主表，**唯一能写的地方**）
   ⚠️ 声明放在最前：`switchTab` / `goFill` 虽是函数（无 TDZ 风险），但本页后续
      若有顶层求值引用到它，定义靠后会直接抛 "Cannot access before initialization"
      （返利页 v123 踩过同一个坑）。 */
const mainTab = ref('dashboard')

const loading = ref(true)
const busy = ref(false)
const saving = ref(false)
const boot = ref(null)
const periods = ref([])
const period = ref('')
const pricing = ref('sale')

const editMode = ref(false)
const draft = reactive({})     // 编辑中的格子：key → 原始值（元）
const original = reactive({})  // 进入编辑态时的快照，用于「放弃修改」
const dirty = reactive({})     // 已改动：key → true

const modal = ref('')
const importMsg = ref('')
const rolesList = ref([])
const aliasList = ref([])
const roleLabelDraft = reactive({})
const healthItems = ref([])
const detailData = ref(null)
const showBreakdown = ref(false)
const subjectForm = reactive({ subject_kind: 'store', subject_key: '', note: '' })

/* ── 趋势（仪表盘）状态 ──
   数据只来自 `GET /api/loss/accounting/trend`（跨期只读序列）。筛选分两类：
     · **影响取数**的只有区间（近 N 月 / 本年）—— 区间变了要重新问后端；
     · 两个开关只影响**显示**（是否含未结账月、是否跳过未录入月），本地过滤即可。
   但两类都会改变"这一屏看的是哪几个月"，所以界面上必须明说（顶部提示条 + 月列表标）。 */
const trend = ref(null)
const trendLoading = ref(false)
const trendErr = ref('')
const tRange = ref(12)         // 3 / 6 / 12 / 0(=本年)
const tHideOpen = ref(false)   // 只看已结账月
const tSkipEmpty = ref(false)  // 跳过未录入月

const SEp = '\u0001'
const dkey = (kind, key, col) => kind + SEp + (key || '') + SEp + col

/* 万元 ↔ 元 的唯一换算实现。
   ⚠️ 必须 round 到「分」：用户按万元输入（如 0.8333 万），×10000 在浮点下得到
   8332.999999999999 —— 直接入库会让金额带着残差进核算，显示出来又四舍五入成
   "看起来对"的数，属于最难查的一类对账差异。 */
const YUAN_PER_WAN = 10000
const wanToYuan = (txt) => {
  const s = String(txt == null ? '' : txt).trim()
  if (s === '') return null
  const n = Number(s)
  if (!isFinite(n)) return NaN
  return Math.round(n * YUAN_PER_WAN * 100) / 100
}

const colDefs = computed(() => boot.value?.col_defs || [])
const slots = computed(() => boot.value?.slots || [])
const groups = computed(() => boot.value?.groups || [])
const rowGroups = computed(() => boot.value?.row_groups || [])
const company = computed(() => boot.value?.company || { values: {} })
const bd = computed(() => company.value.breakdown || {})
const isClosed = computed(() => !!boot.value?.is_closed)
const updatedAt = computed(() => boot.value?.updated_at || '')
const qualityList = computed(() => boot.value?.data_quality || [])
const healthBadge = computed(() =>
  (boot.value?.data_quality || []).length + (boot.value?.groups || [])
    .reduce((n, g) => n + (g.rows || []).filter(r => (r.data_quality || []).length).length, 0))
const aliasPreview = computed(() => aliasList.value.slice(0, 4).map(a => a.alias).join('、'))
const dirtyCount = computed(() => Object.keys(dirty).length)

function groupMeta(rk) {
  return rowGroups.value.find(g => g.row_kind === rk)
      || { no: '', title: rk, denominator_label: '', desc: '' }
}
function isMulti(rk) { return rk === 'store' || rk === 'operator' }
function slotWidth(sk) {
  if (sk === 'extra') return '116px'
  if (sk === 'rate_gross' || sk === 'rate_net') return '94px'
  if (sk === 'ded') return '118px'
  return '106px'
}
/** 该行在某个列位上对应的列定义（不在 scope 内 = 该位对这一类行不适用 → 渲染「—」） */
function colAt(rk, sk) {
  return colDefs.value.find(c => c.slot === sk && (c.scope || []).includes(rk)) || null
}
function editableAt(rk, sk) {
  if (!editMode.value) return false
  const c = colAt(rk, sk)
  return !!(c && c.editable)
}

/* ── 取值与显示 ── */
function rawAt(rk, row, sk) {
  const c = colAt(rk, sk)
  if (!c) return null
  const v = row.values?.[c.key]
  return v === undefined ? null : v
}
function draftVal(rk, row, sk) {
  const col = colAt(rk, sk)
  if (!col) return ''
  const k = dkey(rk, row.subject_key, col.key)
  if (k in draft) return draft[k]
  const v = rawAt(rk, row, sk)
  // 输入框里也是「万元」—— 与展示口径一致，用户抄舟谱的数不用心算
  return v === null || v === undefined ? '' : String(round4(v / 10000))
}
const round4 = (n) => Math.round(n * 10000) / 10000

function cellText(rk, row, sk) {
  const c = colAt(rk, sk)
  if (!c) return '—'
  const v = row.values?.[c.key]
  if (v === null || v === undefined) return '—'
  if (c.kind === 'pct') return pctText(v)
  return wanText(v)
}
function cellCls(rk, row, sk) {
  const c = colAt(rk, sk)
  if (!c) return 'la-void'
  if (editMode.value && c.editable) return 'la-editable'
  const v = row.values?.[c.key]
  if (v === null || v === undefined) return 'la-void'
  if (c.kind === 'pct' && row.rate_den == null && sk.startsWith('rate')) return 'la-void'
  return ''
}
function valCls(rk, row, sk) {
  const c = colAt(rk, sk)
  if (!c) return ''
  const v = row.values?.[c.key]
  if (v === null || v === undefined) return 'la-void-t'
  if (sk === 'rate_net' || sk === 'net' || sk === 'rate_gross' || sk === 'gross') return numCls(v)
  return ''
}
function cellTitle(rk, row, sk) {
  const c = colAt(rk, sk)
  if (!c) return '本列对该类行不适用'
  if (c.kind === 'pct' && row.rate_den == null && sk.startsWith('rate')) {
    return '缺分母，货损率无法计算（系统不会用 0.00% 冒充）'
  }
  const bits = [c.hint]
  if (c.role === 'denominator') bits.push('本行的分母')
  if (c.role === 'derived') bits.push('系统计算列，不可手工填写')
  return bits.join(' · ')
}
function numCls(v) {
  if (v === null || v === undefined) return ''
  return Number(v) < 0 ? 'la-good' : ''
}

/* ── 小计 / 表尾 ── */
function subOf(rk) {
  const g = groups.value.find(x => x.row_kind === rk)
  return g?.subtotal || {}
}
function subText(rk, sk) {
  const s = subOf(rk)
  if (sk === 'den' && !s.has_rate) return '—'
  if (sk === 'extra') return '—'
  if (sk === 'rate_gross' || sk === 'rate_net') {
    if (!s.has_rate) return '—'
    return pctText(sk === 'rate_gross' ? s.rate_gross : s.rate_net)
  }
  if (sk === 'gross') return wanText(s.gross_amt)
  if (sk === 'net') return wanText(s.net_amt)
  if (sk === 'den') return wanText(s.rate_den)
  /* 「临期销售」列位的小计。
     ⚠️ 两条都必要：
       ① 该组**根本没有这一列**（①门店 / ④报损）⇒ 显示「—」，不是 0；
       ② 该组有这一列但一行都没填 ⇒ 后端求和结果同样是 0，
          而 0 会被读成"临期货一分钱都没卖出去"（「零值即健康」陷阱）
          ⇒ 直接看**原始行数据**有没有真值：有才显示 0，没有显示「—」。
          （不给后端加"填过几行"的字段 —— 判据所需的数据前端手里已经有了。） */
  if (sk === 'ded') {
    const c = colAt(rk, 'ded')
    if (!c) return '—'
    const g = groups.value.find(x => x.row_kind === rk)
    const anyFilled = (g?.rows || []).some(r => r.values?.[c.key] != null)
    return anyFilled ? wanText(s.ded_sum) : '—'
  }
  return '—'
}
function subCls(rk, sk) {
  const s = subOf(rk)
  if (sk === 'net') return numCls(s.net_amt)
  if (sk === 'rate_net') return numCls(s.rate_net)
  return ''
}
function footText(sk) {
  const f = boot.value?.foot?.values || {}
  const c = colDefs.value.find(x => x.slot === sk && x.scope.includes('company'))
  if (!c) return '—'
  const v = f[c.key]
  if (v === null || v === undefined) return '—'
  if (c.kind === 'pct') return pctText(v)
  return wanText(v)
}

/* ── 格式化（金额统一「万元」｜用户约定：存储元、录入与展示统一万元）── */
function wanText(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  // 走同一个 YUAN_PER_WAN 常量 —— 换算率只此一份，避免"两处各写 10000"
  // 在将来改口径时只改到一处
  return (n / YUAN_PER_WAN).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
}
function wanMaybe(s) {
  if (s === null || s === undefined || s === '') return '—'
  const n = Number(s)
  return isFinite(n) ? wanText(n) : String(s)
}
function pctText(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return n.toFixed(2) + '%'
}
function coV(key) { return company.value.values?.[key] }

/* ── 趋势：派生数据与环比 ── */
const tSummary = computed(() => trend.value?.summary || {})
const trendSubjects = computed(() => trend.value?.subject_totals || [])
const trendGroups = computed(() => trend.value?.row_groups || [])
const trendPricing = computed(() => trend.value?.pricing || 'sale')
const tFrom = computed(() => trend.value?.from || '')
const tTo = computed(() => trend.value?.to || '')

/* 月份序列（后端给的是**升序**）。
   `hidden` = 被「只看已结账月」关掉的未结账月：**不删**，而是保留时间轴上的位置、
   图上只留灰占位 —— 整列抽掉的话，折线会把"中间两个月没结账"画成"连续下降"。 */
const allMonths = computed(() => (trend.value?.months || [])
  .map(m => ({ ...m, hidden: tHideOpen.value && !m.is_closed })))
const skipEmptyCount = computed(() => (tSkipEmpty.value
  ? allMonths.value.filter(m => !m.has_data).length : 0))
/* 两个开关各管一件事，互不重叠（否则会出现"被隐藏的空月"这种既不属于甲也不属于乙的格）：
     · 跳过未录入月 → 无数据的月**整个从图上拿掉**（月列表里仍留着，好去补）
     · 只看已结账月 → 未结账的月**留在时间轴上**、但只有灰占位，不参与图与合计
   两者同时开：有数据但未结账的月 → 灰占位；无数据的月 → 整列拿掉。 */
const chartMonths = computed(() => (tSkipEmpty.value
  ? allMonths.value.filter(m => m.has_data) : allMonths.value))
/* 月列表：**不过滤空月** —— 管理界面就是要看见"哪个月没录"，好去补；最新月在最上 */
const monthList = computed(() => [...allMonths.value].reverse())

/* 🔴 环比只跟**上一个自然月**比（列表的下一行），不跨过缺口去跟更早的月比：
   跨缺口比出来的数用户无法在自己的账上复现。上月未录入就明说「上月未录入」。 */
function prevMonthOf(i) { return monthList.value[i + 1] || null }
function momAmt(i) {
  const c = monthList.value[i]
  const p = prevMonthOf(i)
  if (!c.has_data || !p || !p.has_data || c.net_amt == null || p.net_amt == null) return null
  if (!p.net_amt) return null           // 上月净额为 0 ⇒ 百分比除不出（不是 0%）
  return (c.net_amt - p.net_amt) / Math.abs(p.net_amt) * 100
}
function momAmtText(i) {
  const c = monthList.value[i]
  const p = prevMonthOf(i)
  if (!c.has_data) return '—'
  if (!p) return '首次'
  if (!p.has_data) return '上月未录入'
  const v = momAmt(i)
  return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'
}
function momRate(i) {
  const c = monthList.value[i]
  const p = prevMonthOf(i)
  if (!c.has_data || !p || !p.has_data || c.rate_net == null || p.rate_net == null) return null
  return c.rate_net - p.rate_net        // 单位 = 个百分点
}
function momRateText(i) {
  const c = monthList.value[i]
  const p = prevMonthOf(i)
  if (!c.has_data) return '—'
  if (!p) return '首次'
  if (!p.has_data) return '上月未录入'
  const v = momRate(i)
  if (v == null) return '—'
  // 🔴 率的变化单位是**个百分点**（减法），不能写「%」——「+0.31%」会被读成相对涨幅，
  //    与「+0.31 个百分点」差一个数量级
  return (v > 0 ? '+' : '') + v.toFixed(2) + ' 个百分点'
}
function momCls(v) {
  if (v == null || !isFinite(v)) return ''
  return v > 0 ? 'la-bad' : (v < 0 ? 'la-good' : '')
}

/* ── 加载 ── */
async function load(p) {
  loading.value = true
  try {
    const d = await lossAccountingApi.bootstrap(p || period.value || '')
    boot.value = d
    periods.value = d.periods || []
    period.value = d.period || ''
    pricing.value = d.pricing || 'sale'
    healthItems.value = []
  } catch (e) {
    toast(e.message || '加载失败', 'err')
  } finally {
    loading.value = false
  }
}
async function reload() { exitEdit(); await load(period.value); await loadTrend() }

/* 趋势取数：区间只由 `tRange` 决定；**终点跟着当前期次走**（"截至我正看的这个月"）。
   用"截至今天"的话，在看 6 月的账时图里会出现 9 月，与下方详情表错位。 */
async function loadTrend() {
  trendLoading.value = true
  trendErr.value = ''
  try {
    const to = period.value || ''
    let from = ''
    let limit = 0
    if (tRange.value === 0) {
      const base = period.value || new Date().toISOString().slice(0, 7)
      from = base.slice(0, 4) + '-01'
    } else {
      limit = tRange.value
    }
    trend.value = await lossAccountingApi.trend({ from, to, limit })
  } catch (e) {
    trendErr.value = e.message || '趋势数据加载失败'
  } finally { trendLoading.value = false }
}

/* ── 主 Tab 切换（看数 ↔ 录数）──
   ⚠️ 两个 tab **共享「当前期次」这一个时间维度**（同「目标与返利」页的月份双向同步）：
   期次是同一个 ref，不存在"两个 tab 各有一个月份"的错配 —— 在填报页切到 6 月，
   切到仪表盘就是 6 月（趋势图终点本来就跟着期次走）。
   ⚠️ 切 tab **不重新取数**：仪表盘数据由 6 个写路径 + 期次切换点统一刷新，永远是新鲜的；
   在这里再拉一次只会制造"同一份数据两条刷新路径"。
   （返利页按需拉取，是因为它两个 tab 的数据集**不同**；本页两个 tab 读的是同一份
     trend + bootstrap。） */
function switchTab(t) {
  if (t === mainTab.value) return
  mainTab.value = t
}

/* 🔴 有未保存草稿时，**从仪表盘发起**的「换期次」必须拒绝。
   为什么只在这里拦：仪表盘只看**已保存**的数据，草稿状态在那一屏是**不可见**的 ——
   点一下柱子就把人半天的录入无声丢掉，是最难自查的一类数据损失。
   （填报页的期次下拉与「完成录入」是既有行为，本轮未改，见交付说明的遗留项。） */
function blockIfDirty(what) {
  if (!dirtyCount.value) return false
  switchTab('fill')
  toast(`当前有 ${dirtyCount.value} 格未保存的录入改动，请先保存或放弃再${what}`, 'err')
  return true
}

/* 点柱子 / 图上数据点 ⇒ 只切「当前期次」，**留在仪表盘**。
   图上点一下是"横向比各月"，跳走就没法连续比；要"改哪个月"是明确动作，走月列表「去填报」。 */
async function pickMonth(p) {
  if (!p || p === period.value) return
  if (blockIfDirty('切换月份')) return
  exitEdit()
  period.value = p
  await load(p)
  await loadTrend()
}

/* 月列表「去填报」⇒ 切到该月 + 跳「数据填报」tab（那才是能改数的地方）。 */
async function goFill(p) {
  if (p && p !== period.value && blockIfDirty('切换月份')) return
  if (p && p !== period.value) {
    exitEdit()
    period.value = p
    await load(p)
    await loadTrend()
  }
  switchTab('fill')
}

async function doRecompute() {
  busy.value = true
  try {
    const r = await lossAccountingApi.recompute(period.value)
    boot.value = { ...boot.value, ...(r.summary || {}) }
    toast(r.message || '已重算', 'ok')
    await loadTrend()
  } catch (e) {
    toast(e.message || '重算失败', 'err')
  } finally { busy.value = false }
}

/* ── 编辑态 ── */
function toggleEdit() {
  if (editMode.value) exitEdit()
  else enterEdit()
}
function enterEdit() {
  Object.keys(draft).forEach(k => delete draft[k])
  Object.keys(original).forEach(k => delete original[k])
  Object.keys(dirty).forEach(k => delete dirty[k])
  groups.value.forEach(g => {
    (g.rows || []).forEach(r => {
      slots.value.forEach(s => {
        const c = colAt(g.row_kind, s.key)
        if (c && c.editable) {
          const v = r.values?.[c.key]
          original[dkey(g.row_kind, r.subject_key, c.key)] = v === undefined ? null : v
        }
      })
    })
  })
  editMode.value = true
}
function exitEdit() {
  editMode.value = false
  Object.keys(dirty).forEach(k => delete dirty[k])
}
function cancelEdit() { enterEdit(); exitEdit(); toast('已放弃未保存的修改', 'info') }

function onInput(rk, row, sk, raw) {
  const c = colAt(rk, sk)
  if (!c) return
  const k = dkey(rk, row.subject_key, c.key)
  const txt = String(raw).trim()
  draft[k] = txt
  const asNum = wanToYuan(txt)
  const bad = txt !== '' && !isFinite(asNum)
  const orig = original[k] === undefined ? null : original[k]
  if (bad) dirty[k] = true
  else if ((asNum === null && orig === null) || (asNum !== null && orig !== null && Math.abs(asNum - orig) < 1e-6)) delete dirty[k]
  else dirty[k] = true
}

async function saveManual() {
  const rows = []
  const badCols = []
  for (const k of Object.keys(dirty)) {
    const [kind, skey, col] = k.split(SEp)
    const c = colDefs.value.find(x => x.key === col)
    const num = wanToYuan(draft[k])
    if (!isFinite(num)) { badCols.push(c?.label || col); continue }
    if (num !== null && num < 0) { badCols.push((c?.label || col) + '（不能为负）'); continue }
    rows.push({ subject_kind: kind, subject_key: skey, col_key: col, value: num })
  }
  if (badCols.length) {
    toast('这些格子的值不合法，请先改好：' + [...new Set(badCols)].join('、'), 'err')
    return
  }
  if (!rows.length) { toast('没有需要保存的改动', 'info'); return }
  saving.value = true
  try {
    const r = await lossAccountingApi.saveManual({ period: period.value, rows })
    boot.value = { ...boot.value, ...(r.summary || {}) }
    Object.keys(draft).forEach(k => delete draft[k])
    enterEdit()   // 用新值重建编辑态基线
    await loadTrend()   // 刚改了数 ⇒ 趋势图上的这一根柱子也变了
    const msg = r.message || '已保存'
    toast(r.skipped_count ? (msg + '；' + r.skipped.slice(0, 2).join('；')) : msg,
          r.skipped_count ? 'info' : 'ok')
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally { saving.value = false }
}

/* ── 结账 / 口径 ── */
async function toggleClose() {
  const closing = !isClosed.value
  const key = closing ? '结账后本期数据将被锁定，所有录入与重算都会被拒绝（可反结账，但会留痕）。确定结账？'
                      : '反结账会解锁本期数据，允许再次修改。确定反结账？'
  if (!window.confirm(key)) return
  try {
    const r = closing ? await lossAccountingApi.close(period.value)
                      : await lossAccountingApi.reopen(period.value)
    toast(r.message || '操作成功', 'ok')
    exitEdit()
    await load(period.value)
    await loadTrend()   // 结账态会改变图上的「未结账」标记与「只看已结账月」的过滤结果
  } catch (e) { toast(e.message || '操作失败', 'err') }
}
async function onChangePricing() {
  const old = boot.value?.pricing
  if (pricing.value === old) return
  if (!window.confirm('计价口径会切换成「' + (pricing.value === 'sale' ? '售价' : '成本价') +
    '」，所有金额与货损率都会按新口径重算。确定切换？')) {
    pricing.value = old
    return
  }
  try {
    const r = await lossAccountingApi.saveConfig({ pricing: pricing.value })
    toast(r.message || '已切换', 'ok')
    await load(period.value)
    await loadTrend()   // 口径是全期唯一的 ⇒ 区间内每一根柱子都要跟着变
  } catch (e) {
    toast(e.message || '切换失败', 'err')
    pricing.value = old
  }
}

/* ── 弹窗 ── */
function closeModal() { modal.value = '' }
async function openImport() {
  /* ⭐ 导入是下一阶段的能力。这里**真的发一次请求**去向业务后端要"当前是否支持"，
     而不是在前端写死一句提示 —— 写死的话，后端哪天真做好了、前端还在劝用户"没这功能"。
     后端返回 501 + 明确文案，前端照实展示。 */
  try {
    await lossAccountingApi.importPreview({ period: period.value })
    toast('导入已可用（若看到本提示请反馈）', 'info')
  } catch (e) {
    if (e.status === 501) { importMsg.value = e.message; modal.value = 'import' }
    else toast(e.message || '导入暂不可用', 'err')
  }
}
async function openRoles() {
  try {
    const d = await lossAccountingApi.roles()
    rolesList.value = d.roles || []
    aliasList.value = d.aliases || []
    rolesList.value.forEach(r => { roleLabelDraft[r.role] = r.role_label })
    modal.value = 'roles'
  } catch (e) { toast(e.message || '加载失败', 'err') }
}
async function saveRoles() {
  const changed = rolesList.value.filter(r => roleLabelDraft[r.role] !== r.role_label)
  if (!changed.length) { toast('没有需要保存的改动', 'info'); return }
  saving.value = true
  let ok = 0
  try {
    for (const r of changed) {
      await lossAccountingApi.renameRole(r.role, { role_label: roleLabelDraft[r.role] })
      ok++
    }
    toast('已保存 ' + ok + ' 项显示名', 'ok')
    closeModal()
    await load(period.value)
  } catch (e) {
    toast('已保存 ' + ok + ' 项后失败：' + (e.message || ''), 'err')
    await load(period.value)
  } finally { saving.value = false }
}
async function openHealth() {
  try {
    const d = await lossAccountingApi.health(period.value)
    healthItems.value = d.items || []
    modal.value = 'health'
  } catch (e) { toast(e.message || '加载失败', 'err') }
}
function openSubject(kind) {
  subjectForm.subject_kind = kind
  subjectForm.subject_key = ''
  subjectForm.note = ''
  modal.value = 'subject'
}
async function saveSubject() {
  saving.value = true
  try {
    const r = await lossAccountingApi.saveSubject({
      subject_kind: subjectForm.subject_kind,
      subject_key: subjectForm.subject_key.trim(),
      subject_label: subjectForm.subject_key.trim(),
      note: subjectForm.note.trim(),
    })
    toast(r.message || '已添加', 'ok')
    modal.value = ''
    await load(period.value)
    if (!editMode.value) enterEdit()
  } catch (e) { toast(e.message || '添加失败', 'err') } finally { saving.value = false }
}
async function openDetail(rk, row) {
  try {
    detailData.value = await lossAccountingApi.detail(period.value, rk, row.subject_key)
    modal.value = 'detail'
  } catch (e) { toast(e.message || '加载失败', 'err') }
}

onMounted(async () => { await load(''); await loadTrend() })
</script>

<style scoped>
/* ── 工具条 ── */
.la-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.la-bar-l{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.la-bar-r{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.la-sel{width:auto;min-width:120px;padding:5px 8px;font-size:12.5px}
.la-sel-sm{width:auto;padding:3px 6px;font-size:12px}
.la-chip{font-size:11.5px;padding:3px 9px;border-radius:11px;border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t2);white-space:nowrap}
.la-chip.is-open{color:var(--war);border-color:color-mix(in srgb,var(--war) 35%,transparent);background:color-mix(in srgb,var(--war) 8%,transparent)}
.la-chip.is-closed{color:var(--t2);background:var(--bg4)}
.la-chip-quiet{color:var(--t3)}
.la-pricing{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--t2)}
.la-hint{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--bg4);color:var(--t3);font-size:10px;font-style:normal;cursor:help;flex:0 0 auto}
.la-badge{display:inline-block;margin-left:5px;min-width:15px;height:15px;line-height:15px;padding:0 4px;border-radius:8px;background:var(--war);color:#fff;font-size:10px;text-align:center}

/* ── 编辑态提示条 ── */
.la-editbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 14px;margin-bottom:12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--p) 30%,transparent);background:var(--p-bg)}
.la-editbar-txt{font-size:12.5px;color:var(--t1)}
.la-dirty{font-size:12.5px;color:var(--p-dark)}
.la-quiet{color:var(--t3);font-size:12px}
.la-editbar .btn{margin-left:auto}
.la-editbar .btn + .btn{margin-left:0}

/* ── 公司卡片 ── */
.la-co{margin-bottom:14px}
.la-co-hd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.la-co-hd b{font-size:14px}
.la-co-formula{font-size:11.5px;color:var(--t3);line-height:1.6}
.la-link{margin-left:auto;background:none;border:none;padding:0;color:var(--p-dark);font-size:12px;cursor:pointer}
.la-co-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.la-kpi{padding:12px 14px;border-radius:10px;background:var(--bg2);border:1px solid var(--border-subtle)}
.la-kpi-main{border-color:color-mix(in srgb,var(--p) 40%,transparent);background:linear-gradient(180deg,var(--p-bg),transparent 140%)}
.la-kpi i{display:block;font-style:normal;font-size:11.5px;color:var(--t3);margin-bottom:5px}
.la-kpi b{display:inline-block;font-size:19px;font-weight:600;letter-spacing:-.3px;font-variant-numeric:tabular-nums}
.la-kpi em{font-style:normal;font-size:11px;color:var(--t3);margin-left:4px}
.la-kpi em{display:block;margin:4px 0 0}
.la-bd{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border-subtle)}
.la-bd-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:3px 0;color:var(--t2)}
.la-bd-row b{font-variant-numeric:tabular-nums;color:var(--t1)}
.la-bd-sub{font-weight:500;color:var(--t1);border-top:1px solid var(--border-subtle);margin-top:4px;padding-top:6px}
.la-bd-indent span{padding-left:14px;color:var(--t3)}
.la-bd-note{margin:8px 0 0;font-size:11.5px;color:var(--t3);line-height:1.6}
.la-warn-inline{text-decoration:none;font-size:11px;color:var(--war);margin-left:6px}
.la-q{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px}
.la-q-item{font-size:11.5px;color:var(--war);background:color-mix(in srgb,var(--war) 9%,transparent);border:1px solid color-mix(in srgb,var(--war) 28%,transparent);padding:3px 9px;border-radius:9px}

/* ── 主表 ── */
.la-tbl-card{padding:0;overflow:hidden}
.la-tblwrap{overflow:auto;max-height:calc(100vh - 330px)}
.la-tbl{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
.la-tbl th,.la-tbl td{padding:7px 9px;font-size:12.5px;border-bottom:1px solid var(--border-subtle);text-align:left;vertical-align:middle;white-space:nowrap}
.la-tbl th{position:sticky;top:0;z-index:9;background:var(--bg3);color:var(--t2);font-weight:500;font-size:12px;text-align:center}
.la-tbl th.la-subj-th{left:0;z-index:11;text-align:left}
.la-tbl td.num,.la-tbl th.num{text-align:right}
.la-cell{text-align:right;font-variant-numeric:tabular-nums}
.la-tbl .la-cell{text-align:right}

/* 主体列冻结（横向滚动时保持可见）：
   ① 必须 sticky + **不透明**底色（sticky 只改绘制位置，透明底会透出滚过来的内容）
   ② 表头的 z-index 必须高于表体与其它表头，否则横滚过来的普通表头会盖住它 */
.la-subj{position:sticky;left:0;z-index:6;background:var(--bg)}
.la-tbl thead .la-subj-th{background:var(--bg3)}
.la-subj-name{display:inline-block;max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.la-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--war);margin-left:5px;cursor:help;vertical-align:middle}
.la-rowbtn{margin-left:6px;background:none;border:none;padding:0;font-size:11px;color:var(--t3);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.la-rowbtn:hover{color:var(--p-dark)}

.la-grp td{background:var(--bg2);border-bottom:1px solid var(--bd);padding:6px 10px}
.la-grp-name{font-weight:600;font-size:12.5px;color:var(--t1)}
.la-grp-den{margin-left:10px;font-size:11.5px;color:var(--p-dark);background:var(--p-bg);padding:2px 8px;border-radius:8px}
.la-grp-noratio{color:var(--t2);background:var(--bg4)}
.la-grp-desc{margin-left:10px;font-size:11.5px;color:var(--t3)}
.la-add{float:right;background:none;border:1px dashed var(--bd);border-radius:8px;padding:2px 9px;font-size:11.5px;color:var(--p-dark);cursor:pointer;background:var(--bg)}
.la-add:hover{border-color:var(--p)}

.la-row td{background:var(--bg)}
.la-row .la-editable{background:color-mix(in srgb,var(--p) 5%,var(--bg))}
.la-void,.la-void-t{color:var(--t3)}
.la-good{color:var(--ok,#16a34a)}
/* 环比为正 = 货损变大 = 坏（红）；为负 = 变小 = 好（绿）。
   与详情表里的「负净额 = 好事」同一套符号约定，两处不能各定一套。 */
.la-bad{color:var(--danger-txt)}
.la-row-blank td,.la-blank{color:var(--t3);font-size:12px;text-align:center;padding:14px}
.la-unit{margin-left:4px;font-size:10.5px;color:var(--t3)}
.la-input{width:calc(100% - 34px);padding:4px 6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--t1);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums}
.la-input:focus{outline:none;border-color:var(--p)}

.la-sub td{background:var(--bg2);font-weight:500;color:var(--t1)}
.la-sub .la-subj{background:var(--bg2);z-index:6}
.la-sub-lbl{font-size:11.5px;color:var(--t2)}
.la-foot td{background:var(--bg3);font-weight:600;border-top:1px solid var(--bd)}
.la-foot-lbl{font-size:11.5px;color:var(--t2);background:var(--bg3);z-index:6;font-weight:500}

.la-footnote{font-size:12px;color:var(--t3);margin-top:10px;line-height:1.7}

/* ── 趋势：区间筛选条 ── */
/* 分 tab 后的诚实性提示：仪表盘读的是**已保存**的数据，有草稿时必须说出来 */
.la-tabnote{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px;
  padding:8px 12px;border-radius:var(--radius-md);font-size:12.5px;color:var(--t1);
  border:1px solid color-mix(in srgb,var(--war) 32%,transparent);background:var(--warn-amber-bg)}
.la-tbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 10px;
  padding:8px 12px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.la-tbar-t{font-size:12.5px;color:var(--t2)}
.la-tbar-r{margin-left:auto}
.la-tbar-err{font-size:12px;color:var(--danger-txt)}
.la-chk{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--t2);cursor:pointer;user-select:none}

/* ── 趋势：按月一览 ── */
.la-ml{padding:12px 14px}
.la-ml-hd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.la-ml-hd b{font-size:13.5px;color:var(--t1)}
/* ⚠️ 不要复用公司卡的 `.la-co-formula` —— 那是"公司卡口径说明"的专用类，
   复用到这儿会让 `querySelector('.la-co-formula')` 抓到月列表（真机探针就这么翻过车）。 */
.la-ml-sub{font-size:11.5px;color:var(--t3);line-height:1.6}
.la-ml-wrap{overflow-x:auto}
.la-ml-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.la-ml-tbl th{font-weight:500;color:var(--t2);text-align:left;padding:6px 8px;
  border-bottom:1px solid var(--bd);white-space:nowrap}
.la-ml-tbl th.num,.la-ml-tbl td.num{text-align:right}
.la-ml-tbl td{padding:6px 8px;border-bottom:1px solid var(--border-subtle);color:var(--t1);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.la-ml-tbl tr:hover td{background:var(--bg2)}
.la-ml-m b{font-weight:500}
.la-ml-badge{margin-left:5px;font-size:10.5px;padding:1px 6px;border-radius:8px;
  background:var(--p-bg);color:var(--p-deep);text-decoration:none}
.la-ml-badge-hid{background:var(--bg4);color:var(--t2)}
.la-ml-cur td{background:var(--p-bg)}
.la-ml-hid td{color:var(--t3)}
.la-ml-none{font-size:11.5px;padding:1px 7px;border-radius:8px;background:var(--bg4);color:var(--t3)}
.la-ml-ok{font-size:11.5px;padding:1px 7px;border-radius:8px;background:var(--ok-green-bg);color:var(--ok-green)}
.la-ml-gap{font-size:11.5px;padding:1px 7px;border-radius:8px;background:var(--warn-amber-bg);
  color:var(--warn-amber);cursor:help}
.la-ml-op{text-align:right}
.la-chip-mini{font-size:11px;padding:2px 7px}

/* ── 弹窗 ── */
.la-mask{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px}
.la-modal{width:min(760px,96vw);max-height:86vh;display:flex;flex-direction:column;background:var(--bg);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.22);overflow:hidden}
.la-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle);font-size:14px;font-weight:600}
.la-x{background:none;border:none;font-size:19px;line-height:1;color:var(--t3);cursor:pointer}
.la-modal-bd{padding:16px 18px;overflow:auto}
.la-modal-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--border-subtle)}
.la-modal-lead{font-size:12.5px;color:var(--t1);line-height:1.7;margin:0 0 10px}
.la-modal-tip{font-size:11.5px;color:var(--t3);line-height:1.7;margin:10px 0 0}
.la-notice{font-size:13px;color:var(--p-dark);background:var(--p-bg);border:1px solid color-mix(in srgb,var(--p) 28%,transparent);border-radius:10px;padding:10px 12px;margin:0 0 12px}
.la-list{margin:0 0 4px;padding-left:18px;font-size:12.5px;color:var(--t2);line-height:1.9}
.la-h4{font-size:12.5px;font-weight:600;color:var(--t1);margin:16px 0 8px}
.la-h4:first-child{margin-top:0}
.la-mini{width:100%;border-collapse:collapse;font-size:12px}
.la-mini th,.la-mini td{padding:6px 8px;border-bottom:1px solid var(--border-subtle);text-align:left}
.la-mini th{color:var(--t3);font-weight:500;background:var(--bg2)}
.la-mini td.num,.la-mini th.num{text-align:right}
.la-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--t3)}
.la-input-sm{width:100%;padding:5px 8px;border:1px solid var(--bd);border-radius:7px;background:var(--bg);color:var(--t1);font-size:12.5px}
.la-input-sm:focus{outline:none;border-color:var(--p)}
.la-field{display:block;margin-bottom:12px}
.la-field>span{display:block;font-size:12.5px;color:var(--t1);margin-bottom:5px}
.la-field em{font-style:normal;font-size:11px;color:var(--t3);margin-left:6px}
.la-health{list-style:none;margin:0;padding:0}
.la-health li{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border-radius:9px;font-size:12.5px;line-height:1.6;margin-bottom:6px;background:var(--bg2)}
.la-health .lv-warn{background:color-mix(in srgb,var(--war) 9%,transparent)}
.la-health-lv{flex:0 0 auto;font-size:11px;padding:1px 7px;border-radius:8px;background:var(--bg4);color:var(--t2)}
.la-health .lv-warn .la-health-lv{background:var(--war);color:#fff}
.state-empty{padding:22px;text-align:center;color:var(--t3);font-size:12.5px}

@media(max-width:1100px){
  .la-co-kpis{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:768px){
  .la-co-kpis{grid-template-columns:1fr}
  .la-tblwrap{max-height:none}
}
</style>
