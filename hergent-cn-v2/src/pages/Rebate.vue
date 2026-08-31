<template>
  <div class="page">
    <!-- 主 Tab：仪表盘 / 目标规则 / 达成填报 -->
    <div class="main-tabs">
      <button class="main-tab" :class="{ on: mainTab === 'dashboard' }" @click="switchTab('dashboard')">仪表盘</button>
      <button class="main-tab" :class="{ on: mainTab === 'rules' }" @click="mainTab = 'rules'">目标规则</button>
      <button class="main-tab" :class="{ on: mainTab === 'achv' }" @click="switchTab('achv')">达成填报</button>
      <button class="main-tab" :class="{ on: mainTab === 'contracts' }" @click="switchTab('contracts')">年度合同</button>
    </div>

    <!-- ===== 仪表盘 Tab（A：返利达成全景 / 档位进度 / 预警，默认落地） ===== -->
    <template v-if="mainTab === 'dashboard'">
      <div class="card dash-card">
        <div class="dash-hd">
          <b>返利达成仪表盘</b>
          <span class="page-sub">本月填报达成全景 · 按风险升序排列，最该操心的排最前 · 含预报贡献的实时达成见预报页「返利冲刺看板」</span>
          <div class="dash-month">
            <label class="achv-lb">统计月份</label>
            <input type="month" v-model="dashMonth" class="input achv-month" @change="onDashMonth" />
          </div>
        </div>

        <div v-if="achvLoading" class="state-empty">加载中…</div>
        <div v-else-if="!dashboardModel || !dashboardModel.items.length" class="state-empty">
          <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
          <p v-if="!rules.length">暂无返利规则，请先在「目标规则」创建品牌 / 商品目标。</p>
          <p v-else>所选月份（{{ dashMonth }}）没有处于生效期的返利目标。</p>
        </div>
        <div v-else>
          <!-- KPI：钱 + 风险 置顶 -->
          <div class="dash-kpi">
            <div class="kpi-hero money">
              <span class="kpi-num">¥{{ fmt(dashboardModel.summary.totalEstRebate) }}</span>
              <span class="kpi-lb">本月预估返利</span>
            </div>
            <div class="kpi-hero" :class="dashboardModel.summary.risk ? 'risk' : ''">
              <span class="kpi-num">{{ dashboardModel.summary.risk }}</span>
              <span class="kpi-lb">预警规则</span>
            </div>
            <div class="kpi-sm">
              <span class="kpi-num">{{ dashboardModel.summary.done }}<i class="kpi-unit">/ {{ dashboardModel.summary.applicable }}</i></span>
              <span class="kpi-lb">已达标 / 生效目标</span>
            </div>
            <div class="kpi-sm">
              <span class="kpi-num">{{ dashboardModel.summary.avgAchPct }}</span>
              <span class="kpi-lb">平均达成率</span>
            </div>
          </div>

          <!-- 本月时间进度参照 -->
          <div class="dash-time">
            <span class="dt-k">📅 本月时间进度 <b>{{ dashboardModel.summary.timeProgressPct }}</b></span>
            <span class="dt-v">{{ dashboardModel.summary.timeLabel }}</span>
            <span class="dt-hint">虚线＝时间进度：条形超过虚线＝超前，短于虚线＝落后时间进度</span>
          </div>
          <!-- 图例 -->
          <div class="dash-legend">
            <span><i class="lg done"></i>已达标</span>
            <span><i class="lg risk"></i>预警</span>
            <span><i class="lg ontrack"></i>推进中</span>
            <span><i class="lg time"></i>时间进度（虚线）</span>
            <span class="dash-legend-note">条形＝达成率（100% 即达标），自上而下风险最高</span>
          </div>
          <div v-if="dashboardModel.summary.noData" class="dash-nodata">本月（{{ dashMonth }}）在「达成填报」里还没有录入数据，进度条按 0% 显示。去「达成填报」录一笔，或把上方「统计月份」切到有数据的月份，进度条就出来了。</div>

          <!-- 条形排行 -->
          <div class="dash-rank">
            <div v-for="(it, idx) in dashboardModel.items" :key="it.rule.id" class="rank-row" :class="it.level">
              <div class="rr-top">
                <span class="rr-rank">{{ idx + 1 }}</span>
                <span class="tag info">{{ it.dimLabel }}</span>
                <b class="rr-name">{{ it.rule.rule_name }}</b>
                <span class="rr-scope">{{ it.scope }}</span>
                <span class="tag" :class="it.level === 'done' ? 'ok' : it.level === 'risk' ? 'risk' : ''">{{ it.levelText }}</span>
                <span class="rr-ach" :class="it.level === 'risk' ? 'val-warn' : ''">{{ it.achPct }}</span>
              </div>
              <div class="rr-bar">
                <div class="rr-bar-fill" :class="it.level" :style="{ width: Math.min(100, it.ach * 100) + '%' }"></div>
                <div v-if="dashboardModel.summary.tpShown" class="rr-bar-mark" :style="{ left: dashboardModel.summary.timeProgressPct }"></div>
              </div>
              <div class="rr-meta">
                <span>目标 <b>{{ it.targetText }}</b></span>
                <span>已填报 <b>{{ it.reportedText }}</b></span>
                <span>距目标 <b :class="it.gap > 0 ? 'val-warn' : 'val-ok'">{{ it.gapText }}</b></span>
                <span>档位 <b>{{ it.curTierPct }} → {{ it.nextTierPct || '满档' }}</b></span>
                <span v-if="it.nextTierPct != null" class="rr-next">达下一档多赚 <b class="val-ok">¥{{ fmt(it.estRebateNext - it.estRebate) }}</b></span>
              </div>
              <div class="rr-vs" :class="it.timeVerdict">
                <i class="rr-vs-ic">⏱</i>
                <template v-if="it.timeVerdict === 'ahead'">超前时间进度 {{ it.vsTimePct }}（进度领先）</template>
                <template v-else-if="it.timeVerdict === 'behind'">落后时间进度 {{ it.vsTimePct }}（需加速补单 / 催回款）</template>
                <template v-else>与时间进度基本持平</template>
              </div>
              <div v-if="it.level === 'risk'" class="rr-warn">⚠ 预计月底仅达成 {{ it.predictedPct }}，还差 {{ it.gapText }}，建议尽快补单或催回款</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-if="mainTab === 'rules'">
    <!-- 操作栏 -->
    <div class="card toolbar">
      <div class="tb-left">
        <select v-model="filterDim" class="input sel-filter">
          <option value="">全部维度</option>
          <option value="brand">品牌维度</option>
          <option value="product">单品维度</option>
        </select>
        <select v-model="filterActive" class="input sel-filter">
          <option value="">全部状态</option>
          <option value="1">已启用</option>
          <option value="0">已停用</option>
        </select>
      </div>
      <div class="tb-right">
        <button class="btn btn-ghost" @click="showSimulate = !showSimulate">试算</button>
      </div>
    </div>

    <!-- 维度入口卡片（P0-1：对标舟谱目标分类入口） -->
    <div class="entry-row">
      <div class="card entry-card">
        <div class="ec-body">
          <h3>品牌目标</h3>
          <p>按品牌设置月度/季度返利与指标达成（如蒙牛纯牛奶系列），下单时副驾提示冲刺进度与缺口建议。</p>
        </div>
        <button class="btn btn-primary btn-sm" @click="openCreate('brand')">+ 创建品牌目标</button>
      </div>
      <div class="card entry-card">
        <div class="ec-body">
          <h3>商品目标</h3>
          <p>按核心单品（SKU）设置返利冲量目标，支持按销售数量（大单位）维度。</p>
        </div>
        <button class="btn btn-primary btn-sm" @click="openCreate('product')">+ 创建商品目标</button>
      </div>
    </div>

    <!-- 规则列表 -->
    <div class="card list-card">
      <div v-if="loading" class="state-empty"><div class="skel-line" style="width:60%;margin:0 auto"></div></div>
      <div v-else-if="!filteredRules.length" class="state-empty">
        <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
        <p>暂无返利规则，点击上方「创建品牌目标 / 商品目标」新建</p>
      </div>
      <div v-else class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>规则名称</th><th>维度</th><th>周期</th><th>作用对象</th>
              <th class="num">目标值</th><th>触发</th><th>返利</th>
              <th>生效期</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredRules" :key="r.id">
              <td>{{ r.rule_name }}</td>
              <td><span class="tag info">{{ dimText(r.dimension) }}</span></td>
              <td>{{ periodText(r.period_type) }}</td>
              <td>{{ r.scope_name || '全部' }}</td>
              <td class="num">{{ fmtTarget(r) }}</td>
              <td><span class="tag" :class="r.trigger_mode === 'tiered' ? 'info' : 'ok'">{{ triggerText(r.trigger_mode) }}</span></td>
              <td>{{ rebateText(r) }}</td>
              <td class="td-date">{{ r.effective_start || '—' }} ~ {{ r.effective_end || '—' }}</td>
              <td><span class="tag" :class="statusOf(r).cls">{{ statusOf(r).text }}</span></td>
              <td>
                <button class="btn-mini" @click="openDetail(r)">详情</button>
                <button class="btn-mini" @click="openEdit(r)">编辑</button>
                <button class="btn-mini btn-danger" @click="del(r)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    </template>

    <!-- ===== 达成填报 Tab（无 API / 手动上传客户的达成数据入口） ===== -->
    <template v-if="mainTab === 'achv'">
      <div class="card achv-card">
        <div class="panel-hd">
          <b>达成填报</b>
          <span class="page-sub">无 API / 手动上传客户在此填报实际达成 · 预报页「返利冲刺看板」达成 = 填报达成 + 本期预报贡献</span>
        </div>

        <div class="achv-bar">
          <label class="achv-lb">统计月份</label>
          <input type="month" v-model="achvMonth" class="input achv-month" @change="loadAchievements" />
          <span class="achv-hint">共 {{ achvRows.length }} 行 · 已填报 {{ achvFilledCount }} 行</span>
          <div class="achv-ops">
            <button class="btn btn-ghost btn-sm" @click="downloadAchvTemplate">下载模板</button>
            <button class="btn btn-primary btn-sm" @click="achvImpOpen = true">Excel 导入</button>
          </div>
        </div>

        <div v-if="achvLoading" class="state-empty">加载中…</div>
        <div v-else-if="!achvRows.length" class="state-empty">
          <p>本期还没有可填报的行。请先在「目标规则」创建品牌 / 商品目标，或直接「Excel 导入」达成数据。</p>
        </div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>维度</th><th>作用对象</th><th class="num">目标值</th>
                <th class="num">实际达成金额</th><th class="num">实际达成数量</th>
                <th class="num">达成率</th><th>来源</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in achvRows" :key="row.key">
                <td><span class="tag info">{{ dimText(row.dimension) }}</span></td>
                <td>{{ row.scope_name || row.scope_key }}</td>
                <td class="num">{{ row.target_type ? fmtTarget(row) : '—' }}</td>
                <td class="num">
                  <input class="input num-input" type="number" v-model.number="row.achAmount"
                         :placeholder="row.target_type === 'amount' ? '填金额' : '—'"
                         @change="saveAchv(row)" />
                </td>
                <td class="num">
                  <input class="input num-input" type="number" v-model.number="row.achQty"
                         :placeholder="row.target_type === 'quantity' ? '填数量' : '—'"
                         @change="saveAchv(row)" />
                </td>
                <td class="num"><span :class="achvRateCls(row)">{{ achvRateText(row) }}</span></td>
                <td>
                  <span class="tag" :class="row.achId ? 'ok' : ''">
                    {{ row.achId ? (row.source === 'excel' ? 'Excel' : '手工') : '未填报' }}
                  </span>
                </td>
                <td><button v-if="row.achId" class="btn-mini btn-danger" @click="delAchv(row)">清除</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 达成数据 Excel 导入弹窗 -->
      <Teleport to="body">
        <Transition name="fade">
          <div v-if="achvImpOpen" class="modal-overlay" @click.self="achvImpOpen = false"></div>
        </Transition>
        <Transition name="modal">
          <div v-if="achvImpOpen" class="modal-card">
            <div class="modal-hd">
              <b>导入达成数据</b>
              <button class="btn-close" @click="achvImpOpen = false">✕</button>
            </div>
            <div class="modal-body">
              <p class="achv-tip">列顺序：<code>月份 / 维度 / 作用对象 / 实际达成金额 / 实际达成数量 / 备注</code>。首次使用请先「下载模板」。</p>
              <p class="achv-tip">同一「月份 + 维度 + 作用对象」重复导入将<b>覆盖</b>旧值，可放心重导。商品维度按名称或条码匹配商品档案，匹配不到按原文导入并在结果中提示。</p>
              <p class="achv-tip">月份列留空时，按上方选择的 <b>{{ achvMonth }}</b> 归入。</p>
              <input type="file" accept=".xlsx,.xls,.csv" @change="onAchvFile" />
              <p v-if="achvImpFileName" class="achv-file">已选：{{ achvImpFileName }}</p>
            </div>
            <div class="modal-ft">
              <button class="btn btn-ghost" @click="achvImpOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="!achvImpFile || achvImporting" @click="runAchvImport">
                {{ achvImporting ? '导入中…' : '开始导入' }}
              </button>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- ===== 年度合同返利 Tab（并入目标与返利：展示 rebate_contracts，含原无入口的年度合同数据） ===== -->
    <template v-if="mainTab === 'contracts'">
      <div class="card list-card">
        <div class="dash-hd">
          <b>厂家年度合同返利</b>
          <span class="page-sub">厂家 / 平台给你的年度合同返利（采购或销售合同），与目标规则的月度品牌返利并列管理 · 数据来自「年度合同（rebate_contracts）」</span>
          <button class="btn btn-primary btn-sm" style="margin-left:auto" @click="openCreateContract">+ 录入年度合同</button>
        </div>

        <div v-if="contractLoading" class="state-empty">加载中…</div>
        <div v-else-if="!contracts.length" class="state-empty">
          <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
          <p>暂无年度合同返利。点击「录入年度合同」新增（如「蒙牛 2026 年度返利合同」）。</p>
        </div>
        <div v-else class="contract-list">
          <div v-for="c in contracts" :key="c.id" class="contract-card">
            <div class="cc-top">
              <b class="cc-name">{{ contractName(c) }}</b>
              <span class="tag info">{{ c.year }} 年度</span>
              <span class="tag" :class="c.settled ? '' : 'ok'">{{ c.settled ? '已结算' : '进行中' }}</span>
              <span class="tag warn">{{ contractTypeText(c) }}</span>
              <span class="cc-actions">
                <button class="btn btn-ghost btn-xs" @click="openTierForm(c)">阶梯设置</button>
                <button v-if="!c.settled" class="btn btn-ghost btn-xs" @click="openAccrueMonth(c)">计提本月</button>
                <button v-if="!c.settled" class="btn btn-primary btn-xs" @click="settleContract(c)">结算</button>
                <button class="btn btn-ghost btn-xs" @click="openEditContract(c)">编辑</button>
                <button class="btn btn-ghost btn-xs danger" @click="deleteContract(c)">删除</button>
              </span>
            </div>
            <div class="cc-grid">
              <div class="cc-item"><span class="cc-l">目标额</span><span class="cc-v">¥{{ fmt(c.target_amount) }}</span></div>
              <div class="cc-item"><span class="cc-l">返利比例</span><span class="cc-v">{{ rebatePctText(c.rebate_pct) }}</span></div>
              <div class="cc-item"><span class="cc-l">当年达成</span><span class="cc-v">¥{{ fmt(c.achieved) }}</span></div>
              <div class="cc-item"><span class="cc-l">进度</span><span class="cc-v">{{ c.progress_pct != null ? c.progress_pct + '%' : '—' }}</span></div>
              <div class="cc-item"><span class="cc-l">预计返利</span><span class="cc-v">¥{{ fmt(c.expected_rebate) }}</span></div>
              <div class="cc-item" v-if="c.rule_count != null"><span class="cc-l">挂载规则</span><span class="cc-v">{{ c.rule_count }} 条</span></div>
              <div class="cc-item" v-if="c.settled"><span class="cc-l">已返金额</span><span class="cc-v">¥{{ fmt(c.settled_amount) }}</span></div>
              <div class="cc-item" v-if="c.settled && c.settled_date"><span class="cc-l">结算日期</span><span class="cc-v">{{ c.settled_date }}</span></div>
            </div>
            <div class="cc-tier" v-if="tierList(c).length">
              <div class="cc-tier-h">阶梯返利</div>
              <table class="dt-tier">
                <thead><tr><th>区间</th><th>返利</th></tr></thead>
                <tbody>
                  <tr v-for="(t, i) in tierList(c)" :key="i">
                    <td>{{ tierRangeText(t) }}</td>
                    <td class="dt-ok">{{ tierPctText(t) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- v111: 月度构成（年度合同按月分解） -->
            <div class="cc-mo">
              <button class="cc-mo-toggle" @click="toggleMonths(c)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :style="{transform: (expandedMonths[c.id] ? 'rotate(90deg)' : '')}"><path d="M9 18l6-6-6-6"/></svg>
                月度构成（按 1~12 月分解目标 / 达成 / 计提）
              </button>
              <div v-if="expandedMonths[c.id]" class="cc-months">
                <div v-if="moLoading[c.id]" class="state-empty" style="padding:10px">加载月度明细…</div>
                <template v-else-if="moError[c.id]">
                  <div class="dt-note" style="margin-top:0">{{ moError[c.id] }}</div>
                </template>
                <template v-else-if="moData[c.id]">
                  <div class="cc-months-save">
                    <span class="cc-ms-tip">月度目标之和 = 合同年度目标（保存后自动回写）</span>
                    <button class="btn btn-primary btn-xs" :disabled="moSaving[c.id]" @click="saveMonths(c)">{{ moSaving[c.id] ? '保存中…' : '保存月度目标' }}</button>
                  </div>
                  <div class="cc-mtable-wrap">
                    <table class="dt-tier cc-mtable">
                      <thead>
                        <tr>
                          <th>月份</th><th>月度目标</th><th>达成</th><th>达成率</th>
                          <th>试算返利</th><th>已计提</th><th>累计计提</th><th>状态</th><th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="m in moData[c.id].months" :key="m.month">
                          <td class="cc-m-label">{{ m.label }}</td>
                          <td><input v-model.number="moEdits[c.id][m.month]" class="input cc-m-input" type="number" min="0" step="1000" placeholder="0" /></td>
                          <td>¥{{ fmt(m.achieved) }}</td>
                          <td :class="m.achievement_pct != null ? (m.achievement_pct >= 1 ? 'dt-ok' : '') : ''">{{ m.achievement_pct != null ? (m.achievement_pct * 100).toFixed(1) + '%' : '—' }}</td>
                          <td>¥{{ fmt(m.est_rebate) }}</td>
                          <td>¥{{ fmt(m.accrued_rebate) }}</td>
                          <td>¥{{ fmt(m.cum_accrued) }}</td>
                          <td>
                            <span v-if="m.settled" class="tag">已结算</span>
                            <span v-else-if="m.accrued_rebate > 0" class="tag ok">已计提</span>
                            <span v-else-if="m.has_achievement" class="tag warn">待计提</span>
                            <span v-else class="tag">—</span>
                          </td>
                          <td>
                            <button class="btn btn-ghost btn-xs" :disabled="m.settled || accrueLoading[c.id+'-'+m.month]" @click="accrueMonth(c, m)">
                              {{ m.settled ? '已结算' : (accrueLoading[c.id+'-'+m.month] ? '计提中…' : '计提') }}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div class="cc-mtotals">
                    <span>目标 ¥{{ fmt(moData[c.id].totals.target) }}</span>
                    <span>达成 ¥{{ fmt(moData[c.id].totals.achieved) }}</span>
                    <span>预计返利 ¥{{ fmt(moData[c.id].totals.est_rebate) }}</span>
                    <span>已计提 ¥{{ fmt(moData[c.id].totals.accrued) }}</span>
                    <span class="cc-mtotals-p" :class="moData[c.id].totals.progress_pct >= 100 ? 'ok' : ''">进度 {{ moData[c.id].totals.progress_pct }}%</span>
                  </div>
                  <div v-if="accrueResult[c.id]" class="dt-note" style="margin-top:10px">
                    <b>{{ accrueResult[c.id].month }} 计提完成：</b>达成 ¥{{ fmt(accrueResult[c.id].achieved) }} → 返利 ¥{{ fmt(accrueResult[c.id].rebate) }}
                    <ul style="margin:6px 0 0 18px;padding:0">
                      <li v-for="(dd, di) in (accrueResult[c.id].details || [])" :key="di" :style="{color: dd.triggered ? 'var(--suc)' : 'var(--t3)'}">
                        {{ dd.scope }}：达成 ¥{{ fmt(dd.achieved) }} → ¥{{ fmt(dd.rebate) }}（{{ dd.detail }}）
                      </li>
                    </ul>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 新建/编辑弹层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showForm" class="modal-overlay" @click.self="showForm=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showForm" class="modal-card">
          <div class="modal-hd">
            <b>{{ editing ? '编辑规则' : '新建规则' }}</b>
            <button class="btn-close" @click="showForm=false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row"><label>规则名称</label><input v-model="form.rule_name" class="input" placeholder="如 蒙牛低温8月目标"></div>
            <div class="form-grid2">
              <div class="form-row"><label>计算维度</label>
                <select v-model="form.dimension" class="input">
                  <option value="brand">品牌</option>
                  <option value="product">单品</option>
                </select>
              </div>
              <div class="form-row"><label>目标度量</label>
                <select v-model="form.target_type" class="input">
                  <option value="amount">下单金额（元）</option>
                  <option value="quantity">销售数量（大单位）</option>
                </select>
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>作用对象</label>
                <input v-model="form.scope_name" class="input" list="rebate-brand-list" placeholder="品牌名/商品名（空=全部）">
                <datalist id="rebate-brand-list">
                  <option v-for="b in brandOptions" :key="b" :value="b"></option>
                </datalist>
                <span v-if="form.dimension==='brand' && form.scope_name && !brandOptions.includes(form.scope_name)" style="color:var(--dan);font-size:12px;margin-top:4px">该品牌不在档案中，请先在「档案管理 → 品牌档案」创建</span>
              </div>
              <div class="form-row"><label>周期口径</label>
                <select v-model="form.period_type" class="input">
                  <option value="month">月</option>
                  <option value="quarter">季</option>
                  <option value="year">年</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>目标值</label><input v-model.number="form.target_value" class="input" type="number" min="0" placeholder="金额或数量"></div>
              <div class="form-row"><label>触发方式</label>
                <select v-model="form.trigger_mode" class="input">
                  <option value="on_target">达成即返</option>
                  <option value="tiered">阶梯返利</option>
                </select>
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>返利形式</label>
                <select v-model="form.rebate_basis" class="input">
                  <option value="rate">比例</option>
                  <option value="fixed">固定金额</option>
                </select>
              </div>
              <div class="form-row"><label>返利值</label>
                <input v-if="form.rebate_basis==='rate'" v-model.number="form.rebate_rate" class="input" type="number" min="0" max="1" step="0.01" placeholder="0.02 = 2%">
                <input v-else v-model.number="form.rebate_amount" class="input" type="number" min="0" placeholder="固定金额">
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>生效开始</label><input v-model="form.effective_start" class="input" type="date"></div>
              <div class="form-row"><label>生效结束</label><input v-model="form.effective_end" class="input" type="date"></div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>优先级</label><input v-model.number="form.priority" class="input" type="number" placeholder="数值越大越优先"></div>
              <div class="form-row"><label>启用</label>
                <select v-model.number="form.is_active" class="input">
                  <option :value="1">启用</option>
                  <option :value="0">停用</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showForm=false">取消</button>
            <button class="btn btn-primary" @click="save">{{ editing ? '保存' : '创建' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 试算弹层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showSimulate" class="modal-overlay" @click.self="showSimulate=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showSimulate" class="modal-card">
          <div class="modal-hd"><b>返利试算</b><button class="btn-close" @click="showSimulate=false">✕</button></div>
          <div class="modal-body">
            <div class="form-row"><label>选择规则</label>
              <select v-model="simRuleId" class="input">
                <option value="">— 选择 —</option>
                <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.rule_name }}</option>
              </select>
            </div>
            <div class="form-row"><label>实际完成值</label><input v-model.number="simActual" class="input" type="number" placeholder="实际完成金额或数量"></div>
            <div v-if="simResult" class="sim-result">
              <div class="sr-row"><span>应返金额</span><b class="sr-val">¥{{ fmt(simResult.rebate_amount) }}</b></div>
              <div class="sr-row"><span>返利比例</span><b>{{ simResult.effective_rate ? (simResult.effective_rate * 100).toFixed(2) + '%' : '—' }}</b></div>
              <div class="sr-row"><span>达成率</span><b>{{ simResult.achievement ? (simResult.achievement * 100).toFixed(1) + '%' : '—' }}</b></div>
              <div v-if="simResult.note" class="sr-note">{{ simResult.note }}</div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showSimulate=false">关闭</button>
            <button class="btn btn-primary" @click="runSimulate">计算</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 详情弹层（P0-4） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showDetail" class="modal-overlay" @click.self="showDetail=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showDetail && detailRule" class="modal-card">
          <div class="modal-hd">
            <b>规则详情</b>
            <button class="btn-close" @click="showDetail=false">✕</button>
          </div>
          <div class="modal-body">
            <div class="dt-head">
              <span class="tag" :class="statusOf(detailRule).cls">{{ statusOf(detailRule).text }}</span>
              <span class="dt-name">{{ detailRule.rule_name }}</span>
            </div>
            <div class="dt-grid">
              <div class="dt-item"><span class="dt-l">计算维度</span><span class="dt-v">{{ dimText(detailRule.dimension) }}</span></div>
              <div class="dt-item"><span class="dt-l">目标度量</span><span class="dt-v">{{ detailRule.target_type === 'amount' ? '下单金额' : '销售数量' }}</span></div>
              <div class="dt-item"><span class="dt-l">作用对象</span><span class="dt-v">{{ detailRule.scope_name || '全部' }}</span></div>
              <div class="dt-item"><span class="dt-l">周期口径</span><span class="dt-v">{{ periodText(detailRule.period_type) }}</span></div>
              <div class="dt-item"><span class="dt-l">目标值</span><span class="dt-v">{{ fmtTarget(detailRule) }}</span></div>
              <div class="dt-item"><span class="dt-l">优先级</span><span class="dt-v">{{ detailRule.priority }}</span></div>
            </div>
            <div class="dt-sec">
              <h4>触发与返利</h4>
              <div class="dt-grid">
                <div class="dt-item"><span class="dt-l">触发方式</span><span class="dt-v">{{ triggerText(detailRule.trigger_mode) }}</span></div>
                <div class="dt-item" v-if="detailRule.trigger_mode === 'on_target'"><span class="dt-l">达成门槛</span><span class="dt-v">{{ ((detailRule.trigger_threshold || 1) * 100).toFixed(0) }}%</span></div>
                <div class="dt-item"><span class="dt-l">返利形式</span><span class="dt-v">{{ detailRule.rebate_basis === 'rate' ? '比例' : '固定金额' }}</span></div>
                <div class="dt-item"><span class="dt-l">{{ detailRule.rebate_basis === 'rate' ? '返利比例' : '返利固定金额' }}</span><span class="dt-v">{{ rebateText(detailRule) }}</span></div>
              </div>
              <table v-if="detailRule.trigger_mode === 'tiered' && tierList(detailRule).length" class="dt-tier">
                <thead><tr><th>达成区间</th><th>返利</th></tr></thead>
                <tbody>
                  <tr v-for="(t, i) in tierList(detailRule)" :key="i">
                    <td>{{ (t.from_pct * 100).toFixed(0) }}% ~ {{ (t.to_pct * 100).toFixed(0) }}%</td>
                    <td class="dt-ok">{{ detailRule.rebate_basis === 'rate' ? (t.rebate_rate * 100).toFixed(1) + '%' : '¥' + t.rebate_amount }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="dt-sec">
              <h4>生效区间</h4>
              <div class="dt-grid">
                <div class="dt-item"><span class="dt-l">生效开始</span><span class="dt-v">{{ detailRule.effective_start || '不限' }}</span></div>
                <div class="dt-item"><span class="dt-l">生效结束</span><span class="dt-v">{{ detailRule.effective_end || '不限' }}</span></div>
                <div class="dt-item"><span class="dt-l">创建时间</span><span class="dt-v">{{ detailRule.created_at || '—' }}</span></div>
                <div class="dt-item"><span class="dt-l">更新时间</span><span class="dt-v">{{ detailRule.updated_at || '—' }}</span></div>
              </div>
            </div>
            <div class="dt-note">整体达成全景（档位进度 / 预警 / 预估返利）见「仪表盘」tab；含预报贡献的实时达成见 AI 副驾「预报 → 返利冲刺看板」。本页为规则配置视图。</div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showDetail=false">关闭</button>
            <button class="btn btn-ghost" @click="showSimulate=true; showDetail=false">返利试算</button>
            <button class="btn btn-primary" @click="openEdit(detailRule); showDetail=false">编辑</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 规则冲突弹窗（409）：列出与已启用规则的冲突明细 + 解决建议 -->
    <Teleport to="body">
      <div v-if="conflictInfo" class="modal-overlay" @click.self="conflictInfo=null"></div>
      <Transition name="modal">
        <div v-if="conflictInfo" class="modal-card">
          <div class="modal-hd"><b>规则冲突，无法创建</b><button class="btn-close" @click="conflictInfo=null">✕</button></div>
          <div class="modal-body">
            <p class="cf-tip">
              你正在为「<b>{{ conflictInfo.scopeName }}</b>」（{{ conflictInfo.dimension==='brand'?'品牌':'单品' }}维度）创建规则，<br>
              与以下 <b>已启用</b> 规则属于「同维度 / 同目标度量 / 同周期 / 同作用对象」且 <b>生效期重叠</b>，系统不允许重复计算，因此被拦截：
            </p>
            <table class="tbl cf-tbl">
              <thead><tr><th>冲突规则</th><th>作用对象</th><th>生效期</th></tr></thead>
              <tbody>
                <tr v-for="c in conflictInfo.conflicts" :key="c.id">
                  <td>{{ c.rule_name }}</td>
                  <td>{{ conflictInfo.scopeName }}</td>
                  <td class="cf-period">{{ c.effective_start }} ~ {{ c.effective_end }}</td>
                </tr>
              </tbody>
            </table>
            <p class="cf-sol">解决方式（任选其一）：<br>
              ① 调整本规则的 <b>生效起止日期</b>，避开与上方规则的重叠区间；<br>
              ② 或先到「目标规则」<b>停用</b>冲突规则，再创建本规则；<br>
              ③ 若本规则本就是想替换旧规则，请直接 <b>编辑旧规则</b> 而非新建。</p>
          </div>
          <div class="modal-ft">
            <button class="btn btn-primary" @click="conflictInfo=null">我知道了</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 录入年度合同返利弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="contractFormOpen" class="modal-overlay" @click.self="contractFormOpen=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="contractFormOpen" class="modal-card">
          <div class="modal-hd">
            <b>{{ editingContractId ? '编辑年度合同返利' : '录入年度合同返利' }}</b>
            <button class="btn-close" @click="contractFormOpen=false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="cb-line">
                <input type="checkbox" v-model="contractForm.byName">
                合作方列表里没有这家？按名称直接录
              </label>
            </div>
            <div class="form-row" v-if="!contractForm.byName">
              <label>合作方（厂家 / 客户）</label>
              <select v-model="contractForm.contact_id" class="input">
                <option value="">— 选择 —</option>
                <option v-for="o in contactOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>
            <div class="form-row" v-else>
              <label>合作方名称（直接填写）</label>
              <input v-model="contractForm.contact_name" class="input" placeholder="如 蒙牛低温奶事业部">
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>年度</label><input v-model="contractForm.year" class="input" placeholder="如 2026"></div>
              <div class="form-row"><label>返利比例</label><input v-model.number="contractForm.rebate_pct" class="input" type="number" min="0" step="0.01" placeholder="如 3 表示 3%"></div>
            </div>
            <div class="form-row" style="margin-top:2px">
              <label>月度目标（元）<span class="cf-mo-hint">可留空 · 空与 0 均视为无目标</span></label>
            </div>
            <div class="cf-mo-grid">
              <div v-for="i in 12" :key="i" class="cf-mo-cell">
                <label>{{ i }}月</label>
                <input v-model.number="contractForm.months[monthKey(i)]" class="input" type="number" min="0" placeholder="0">
              </div>
            </div>
            <div class="cf-mo-sum">
              <span>全年目标（自动汇总）</span>
              <b>¥{{ fmt(contractYearSum) }}</b>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="contractFormOpen=false">取消</button>
            <button class="btn btn-primary" @click="saveContract">保存</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v111: 阶梯设置弹窗（年度合同 tiers_json 编辑） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="tierFormOpen" class="modal-overlay" @click.self="tierFormOpen=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="tierFormOpen" class="modal-card">
          <div class="modal-hd">
            <b>阶梯设置 · {{ tierFormContract ? contractName(tierFormContract) : '' }} {{ tierFormContract ? tierFormContract.year : '' }}</b>
            <button class="btn-close" @click="tierFormOpen=false">✕</button>
          </div>
          <div class="modal-body">
            <p class="cf-tip">按<b>累计达成额</b>累进计算返利，比例按<b>百分点</b>填（3 = 3%）。未设阶梯时用合同的单一返利比例。</p>
            <table class="dt-tier" style="margin-top:8px">
              <thead><tr><th>下限（元）</th><th>上限（元，0=以上）</th><th>返利 %</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(t, i) in tierFormTiers" :key="i">
                  <td><input v-model.number="t.min_amount" class="input cc-ti" type="number" min="0" placeholder="0"></td>
                  <td><input v-model.number="t.max_amount" class="input cc-ti" type="number" min="0" placeholder="0=以上"></td>
                  <td><input v-model.number="t.pct" class="input cc-ti" type="number" min="0" step="0.1" placeholder="3"></td>
                  <td><button class="btn btn-ghost btn-xs danger" @click="tierFormTiers.splice(i,1)">删除</button></td>
                </tr>
              </tbody>
            </table>
            <button class="btn btn-ghost btn-sm" style="margin-top:8px" @click="tierFormTiers.push({min_amount:0,max_amount:0,pct:0})">+ 加一档</button>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="tierFormOpen=false">取消</button>
            <button class="btn btn-primary" :disabled="tierSaving" @click="saveTiers">{{ tierSaving ? '保存中…' : '保存阶梯' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { toast } from '../store'
import { rebateApi } from '../api/modules'
import { api } from '../api/client.js'

const rules = ref([])
const loading = ref(false)
const filterDim = ref('')
const filterActive = ref('')

const showForm = ref(false)
const editing = ref(false)
const form = ref({})

const showSimulate = ref(false)
const simRuleId = ref('')
const simActual = ref(null)
const simResult = ref(null)
const showDetail = ref(false)
const detailRule = ref(null)

// 创建/更新规则被后端以 409 拦截（与已启用规则冲突）时，承载 conflicts 明细弹窗
const conflictInfo = ref(null)

// D4：品牌下拉候选（来自 brands 档案表），作用对象为品牌时提供候选 + 校验存在（决策：品牌必须先在档案创建）
const brandOptions = ref([])
async function loadBrandOptions() {
  try {
    const list = await api('/api/brands?include_inactive=1')
    brandOptions.value = (Array.isArray(list) ? list : []).map(b => b.name).filter(Boolean)
  } catch (e) {}
}

const filteredRules = computed(() => {
  return rules.value.filter(r => {
    if (filterDim.value && r.dimension !== filterDim.value) return false
    if (filterActive.value !== '' && String(r.is_active) !== filterActive.value) return false
    return true
  })
})

function openCreate(presetDim) {
  editing.value = false
  form.value = {
    rule_name: '', dimension: presetDim || 'brand', target_type: presetDim === 'brand' ? 'amount' : 'quantity',
    scope_key: '', scope_name: '', period_type: 'month',
    target_value: 0, trigger_mode: 'on_target', trigger_threshold: 1,
    tiers_json: '', rebate_basis: 'rate', rebate_rate: 0, rebate_amount: 0,
    effective_start: '', effective_end: '', priority: 0, is_active: 1,
  }
  showForm.value = true
}

function openEdit(r) {
  editing.value = true
  form.value = { ...r }
  showForm.value = true
}

async function save() {
  const f = form.value
  if (!f.rule_name) { toast('请填写规则名称', 'error'); return }
  if (!f.target_value || f.target_value <= 0) { toast('目标值必须 > 0', 'error'); return }
  if (f.rebate_basis === 'rate' && (f.rebate_rate < 0 || f.rebate_rate > 1)) { toast('返利比例须 0~1', 'error'); return }
  if (f.dimension === 'brand' && f.scope_name && !brandOptions.value.includes(f.scope_name)) { toast('品牌「' + f.scope_name + '」不在品牌档案中，请先创建', 'error'); return }
  // D10：品牌维度 scope_key 与 scope_name 同源（品牌名即 key），避免空 key 导致不同品牌互判冲突
  if (f.dimension === 'brand' && f.scope_name) {
    f.scope_key = f.scope_name.trim()
  }
  try {
    if (editing.value) {
      await rebateApi.update(f.id, f)
    } else {
      await rebateApi.create(f)
    }
    toast(editing.value ? '已保存' : '已创建', 'success')
    showForm.value = false
    await loadRules()
  } catch (e) {
    // 409 冲突：后端在 payload.conflicts 给了冲突规则明细，弹窗列出，
    // 不再显示「请求失败 (409)」这种无意义文案（user 之前反馈体验差）。
    if (e.status === 409 && e.payload && Array.isArray(e.payload.conflicts) && e.payload.conflicts.length) {
      conflictInfo.value = {
        dimension: f.dimension,
        scopeName: f.scope_name || f.scope_key || '全部',
        conflicts: e.payload.conflicts
      }
    } else {
      toast('操作失败: ' + (e.message || ''), 'error')
    }
  }
}

async function del(r) {
  if (!confirm(`确认删除「${r.rule_name}」？`)) return
  try {
    await rebateApi.delete(r.id)
    toast('已删除', 'success')
    await loadRules()
  } catch (e) {
    toast('删除失败: ' + (e.message || ''), 'error')
  }
}

async function runSimulate() {
  if (!simRuleId.value || !simActual.value) { toast('请选择规则并输入实际值', 'error'); return }
  try {
    const r = await rebateApi.simulate({ rule_id: parseInt(simRuleId.value), actual_value: simActual.value })
    simResult.value = r
  } catch (e) {
    toast('试算失败: ' + (e.message || ''), 'error')
  }
}

async function loadRules() {
  loading.value = true
  try {
    const d = await rebateApi.list()
    rules.value = d.rules || d.data || d || []
  } catch (e) {
    // 静默
  } finally {
    loading.value = false
  }
}

function dimText(d) { return d === 'brand' ? '品牌' : d === 'product' ? '单品' : d }
function periodText(p) { return { month: '月', quarter: '季', year: '年', custom: '自定义' }[p] || p }
function triggerText(t) { return t === 'on_target' ? '达成即返' : t === 'tiered' ? '阶梯' : t }
function rebateText(r) {
  if (r.rebate_basis === 'rate') return r.rebate_rate ? (r.rebate_rate * 100).toFixed(1) + '%' : '—'
  return r.rebate_amount ? '¥' + r.rebate_amount : '—'
}
function fmtTarget(r) {
  if (r.target_type === 'amount') return '¥' + fmt(r.target_value)
  return r.target_value + ' 件'
}
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function statusOf(r) {
  if (!r.is_active) return { cls: '', text: '停用' }
  const t = new Date().toISOString().slice(0, 10)
  const s = r.effective_start || ''
  const e = r.effective_end || ''
  if (s && t < s) return { cls: 'warn', text: '未开始' }
  if (e && t > e) return { cls: '', text: '已结束' }
  return { cls: 'ok', text: '进行中' }
}
function openDetail(r) { detailRule.value = r; showDetail.value = true }
function tierList(r) {
  try {
    const a = typeof r.tiers_json === 'string' ? JSON.parse(r.tiers_json) : (r.tiers_json || [])
    return Array.isArray(a) ? a : []
  } catch (e) { return [] }
}

/* ---- 达成填报 Tab（v109：无 API / 手动上传客户的达成数据入口） ---- */
const mainTab = ref('dashboard')
const achvMonth = ref(new Date().toISOString().slice(0, 7))
const dashMonth = ref(new Date().toISOString().slice(0, 7))
const achievements = ref([])
const achvRows = ref([])
const achvLoading = ref(false)
const achvImpOpen = ref(false)
const achvImpFile = ref(null)
const achvImpFileName = ref('')
const achvImporting = ref(false)

const achvFilledCount = computed(() => achvRows.value.filter(r => r.achId).length)

async function switchTab(t) {
  mainTab.value = t
  if (t === 'achv') await loadAchievements(achvMonth.value)
  else if (t === 'dashboard') await loadAchievements(dashMonth.value)
  else if (t === 'contracts') await loadContracts()
}

/** 把「启用中的目标规则」与「已填报达成」合并成可编辑行。
 *  无对应规则的达成行也保留 —— 否则导入的数据会"看不见"。 */
function buildAchvRows() {
  const byKey = new Map()
  for (const r of rules.value.filter(x => x.is_active)) {
    const key = `${r.dimension}::${r.scope_key || ''}`
    byKey.set(key, {
      key,
      dimension: r.dimension,
      scope_key: r.scope_key || '',
      scope_name: r.scope_name || r.scope_key || '全部',
      target_type: r.target_type,
      target_value: r.target_value,
      achId: null, achAmount: null, achQty: null, source: '', note: '',
    })
  }
  for (const a of achievements.value) {
    const key = `${a.dimension}::${a.scope_key || ''}`
    const hit = byKey.get(key)
    if (hit) {
      hit.achId = a.id
      hit.achAmount = a.actual_amount
      hit.achQty = a.actual_qty
      hit.source = a.source
      hit.note = a.note || ''
    } else {
      byKey.set(key, {
        key, dimension: a.dimension, scope_key: a.scope_key || '',
        scope_name: a.scope_name || a.scope_key,
        target_type: '', target_value: 0,
        achId: a.id, achAmount: a.actual_amount, achQty: a.actual_qty,
        source: a.source, note: a.note || '',
      })
    }
  }
  achvRows.value = [...byKey.values()]
}

async function loadAchievements(month) {
  const m = month || achvMonth.value
  achvLoading.value = true
  try {
    const list = await api('/api/rebate-achievements?month=' + encodeURIComponent(m))
    achievements.value = Array.isArray(list) ? list : []
  } catch (e) {
    achievements.value = []
    toast('达成数据加载失败: ' + (e.message || ''), 'error')
  } finally {
    achvLoading.value = false
    buildAchvRows()
  }
}

async function saveAchv(row) {
  // 未填报且两个输入都空 → 不落库（避免点一下就产生空记录）
  if (!row.achId && !row.achAmount && !row.achQty) return
  try {
    const r = await api('/api/rebate-achievements', {
      method: 'POST',
      body: {
        period_month: achvMonth.value,
        dimension: row.dimension,
        scope_key: row.scope_key,
        scope_name: row.scope_name,
        actual_amount: Number(row.achAmount) || 0,
        actual_qty: Number(row.achQty) || 0,
        source: 'manual',
        note: row.note || '',
      },
    })
    if (r && r.item) { row.achId = r.item.id; row.source = r.item.source }
    toast('已保存', 'success')
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  }
}

async function delAchv(row) {
  if (!row.achId) return
  if (!confirm(`确认清除「${row.scope_name}」${achvMonth.value} 的达成数据？`)) return
  try {
    await api('/api/rebate-achievements/' + row.achId, { method: 'DELETE' })
    row.achId = null; row.achAmount = null; row.achQty = null; row.source = ''
    toast('已清除', 'success')
  } catch (e) {
    toast('清除失败: ' + (e.message || ''), 'error')
  }
}

function onAchvFile(e) {
  const f = e.target.files?.[0] || null
  achvImpFile.value = f
  achvImpFileName.value = f?.name || ''
}

async function runAchvImport() {
  if (!achvImpFile.value) return
  achvImporting.value = true
  try {
    const fd = new FormData()
    fd.append('file', achvImpFile.value)
    fd.append('month', achvMonth.value)
    const r = await api('/api/rebate-achievements/import', { method: 'POST', raw: true, body: fd })
    const errs = r?.errors || []
    if (errs.length) toast(`导入完成 ${r?.imported ?? 0} 行，${errs.length} 处提示`, 'warn')
    else toast(`导入完成：${r?.imported ?? 0} 行`, 'success')
    achvImpOpen.value = false
    achvImpFile.value = null
    achvImpFileName.value = ''
    await loadAchievements()
  } catch (e) {
    toast('导入失败: ' + (e.message || ''), 'error')
  } finally {
    achvImporting.value = false
  }
}

function downloadAchvTemplate() {
  const header = ['月份', '维度', '作用对象', '实际达成金额', '实际达成数量', '备注']
  const sample = [achvMonth.value, '品牌', '蒙牛', '120000', '', '示例行，导入前请删除']
  const csv = header.join(',') + '\n' + sample.join(',') + '\n'
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = '达成数据导入模板.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

function achvRateText(row) {
  if (!row.target_type || !row.target_value) return '—'
  const ach = row.target_type === 'amount' ? (row.achAmount || 0) : (row.achQty || 0)
  if (!row.achId && !ach) return '—'
  return (ach / row.target_value * 100).toFixed(1) + '%'
}
function achvRateCls(row) {
  if (!row.target_type || !row.target_value) return ''
  const ach = row.target_type === 'amount' ? (row.achAmount || 0) : (row.achQty || 0)
  const pct = ach / row.target_value
  if (pct >= 1) return 'val-ok'
  if (pct >= 0.8) return 'val-warn'
  return ''
}

/* ---- 仪表盘 Tab（A：返利达成全景 / 档位进度 / 预警，复用填报达成，不依赖预报） ---- */
function ruleActiveInMonth(r, month) {
  if (r.is_active === 0) return false
  const [yy, mm] = String(month).split('-').map(Number)
  if (!yy || !mm) return false
  const ms = new Date(yy, mm - 1, 1), me = new Date(yy, mm, 0)
  const s = r.effective_start ? new Date(r.effective_start) : null
  const e = r.effective_end ? new Date(r.effective_end) : null
  if (s && s > me) return false
  if (e && e < ms) return false
  return true
}

// 前端镜像后端 compute_rebate：按一条规则 + 实际达成基数算返利
function computeRebateFront(rule, basisValue) {
  const target = Number(rule.target_value) || 0
  const ach = target > 0 ? basisValue / target : 0
  if (rule.trigger_mode === 'tiered') {
    const tiers = tierList(rule)
    let hit = null
    for (const t of tiers) {
      const fp = Number(t.from_pct) || 0, tp = Number(t.to_pct) || 0
      if (fp <= ach && ach < (tp || 1e9)) { hit = t; break }
    }
    if (!hit) return { rebate: 0, triggered: false, ach }
    const rebate = rule.rebate_basis === 'fixed' ? (Number(hit.rebate_amount) || 0) : basisValue * (Number(hit.rebate_rate) || 0)
    return { rebate, triggered: true, ach }
  } else {
    const threshold = Number(rule.trigger_threshold) || 1.0
    if (ach >= threshold) {
      const rebate = rule.rebate_basis === 'fixed' ? (Number(rule.rebate_amount) || 0) : basisValue * (Number(rule.rebate_rate) || 0)
      return { rebate, triggered: true, ach, threshold }
    }
    return { rebate: 0, triggered: false, ach, threshold }
  }
}

function fmtByType(v, tt) {
  if (v == null || v === '') return '—'
  return tt === 'amount' ? '¥' + fmt(v) : fmt(v) + ' 件'
}
function pctText(x) { return (Number(x) * 100).toFixed(1) + '%' }

const dashboardModel = computed(() => {
  if (mainTab.value !== 'dashboard') return null
  const month = dashMonth.value
  const [yy, mm] = String(month).split('-').map(Number)
  const now = new Date()
  const monthEnd = new Date(yy, mm, 0, 23, 59, 59)
  const daysLeft = Math.max(0, Math.ceil((monthEnd - now) / 86400000))
  const elapsed = Math.max(1, now.getDate())
  // 本月时间进度：与"今天在所选月份里的位置"比对（过去月=100% / 未来月=0%）
  const totalDays = new Date(yy, mm, 0).getDate()
  const curY = now.getFullYear(), curM = now.getMonth() + 1
  let timeProgress
  if (yy < curY || (yy === curY && mm < curM)) timeProgress = 1
  else if (yy > curY || (yy === curY && mm > curM)) timeProgress = 0
  else timeProgress = Math.min(1, now.getDate() / totalDays)
  let timeLabel
  if (timeProgress >= 1) timeLabel = '本月已结束'
  else if (timeProgress <= 0) timeLabel = '本月尚未开始'
  else timeLabel = `到 ${now.getDate()} 号 / 共 ${totalDays} 天`
  const achvMap = new Map()
  for (const a of (achievements.value || [])) {
    achvMap.set(`${a.dimension}::${String(a.scope_key ?? '')}`, a)
  }
  const activeRules = (rules.value || []).filter(r => ruleActiveInMonth(r, month))
  const items = []
  let done = 0, risk = 0, totalEst = 0, achSum = 0
  for (const r of activeRules) {
    const dim = r.dimension
    const scope = String(r.scope_key ?? '')
    const av = achvMap.get(`${dim}::${scope}`)
    const reported = av ? (r.target_type === 'quantity' ? (Number(av.actual_qty) || 0) : (Number(av.actual_amount) || 0)) : 0
    const target = Number(r.target_value) || 0
    const ach = target > 0 ? reported / target : 0
    const gap = Math.max(0, target - reported)
    // 时间进度对比：达成率 vs 本月时间进度
    const vsTime = ach - timeProgress
    const timeVerdict = vsTime >= 0.01 ? 'ahead' : vsTime <= -0.01 ? 'behind' : 'even'
    const vsTimePct = (Math.abs(vsTime) * 100).toFixed(1) + ' 个百分点'
    const estRebate = computeRebateFront(r, reported).rebate
    // 档位进度
    let curTierPct = 0, nextTierPct = null, toNextGap = 0
    if (r.trigger_mode === 'tiered') {
      const tiers = tierList(r).slice().sort((a, b) => (Number(a.from_pct) || 0) - (Number(b.from_pct) || 0))
      let cur = null
      for (const t of tiers) { if (ach >= (Number(t.from_pct) || 0)) cur = t }
      const idx = cur ? tiers.indexOf(cur) : -1
      const nxt = idx >= 0 && idx + 1 < tiers.length ? tiers[idx + 1] : null
      curTierPct = cur ? (Number(cur.from_pct) || 0) : 0
      if (nxt) { nextTierPct = Number(nxt.from_pct) || 0; toNextGap = Math.max(0, nextTierPct - ach) }
    } else {
      const threshold = Number(r.trigger_threshold) || 1.0
      nextTierPct = threshold
      toNextGap = Math.max(0, threshold - ach)
    }
    const estRebateNext = nextTierPct != null ? computeRebateFront(r, target * nextTierPct).rebate : estRebate
    // 节奏 / 预警
    const pace = elapsed > 0 ? reported / elapsed : 0
    const predicted = reported + pace * daysLeft
    const willHit = target > 0 ? predicted >= target : true
    let level = 'ontrack'
    if (ach >= 1) { level = 'done'; done++ }
    else if (!willHit) { level = 'risk'; risk++ }
    achSum += ach
    totalEst += estRebate
    items.push({
      rule: r,
      dimLabel: dim === 'brand' ? '品牌' : '单品',
      scope: r.scope_name || scope || '全部',
      target, targetType: r.target_type,
      reported, ach, gap,
      targetText: fmtByType(target, r.target_type),
      reportedText: fmtByType(reported, r.target_type),
      gapText: fmtByType(gap, r.target_type),
      achPct: pctText(ach),
      curTierPct: pctText(curTierPct),
      nextTierPct: nextTierPct != null ? pctText(nextTierPct) : null,
      toNextGapPct: (toNextGap * 100).toFixed(1) + ' 个百分点',
      estRebate, estRebateNext,
      timeVerdict, vsTimePct,
      level,
      levelText: level === 'done' ? '已达标' : level === 'risk' ? '预警' : '推进中',
      predictedPct: pctText(target > 0 ? predicted / target : 1),
    })
  }
  // 风险升序：最该操心的排最前（risk → ontrack → done，同级按达成率升序）
  const levelRank = l => (l === 'risk' ? 0 : l === 'done' ? 2 : 1)
  items.sort((a, b) => (levelRank(a.level) - levelRank(b.level)) || (a.ach - b.ach))
  return {
    items,
    summary: {
      applicable: activeRules.length,
      done, risk,
      avgAchPct: activeRules.length ? pctText(achSum / activeRules.length) : '—',
      totalEstRebate: totalEst,
      noData: activeRules.length > 0 && items.every(it => it.reported === 0),
      timeProgressPct: pctText(timeProgress),
      timeLabel,
      tpShown: timeProgress > 0 && timeProgress < 1,
    }
  }
})

async function onDashMonth() { await loadAchievements(dashMonth.value) }

/* ---- 年度合同返利（rebate_contracts）并入目标与返利：展示 + 录入 ---- */
const contracts = ref([])
const contractLoading = ref(false)
const contractFormOpen = ref(false)
const editingContractId = ref(null)
const contractForm = ref({ contact_id: '', contact_name: '', byName: false, year: String(new Date().getFullYear()), months: {}, rebate_pct: 0, orig_target: 0 })
const contactOptions = ref([])

async function loadContracts() {
  contractLoading.value = true
  try {
    // 用 /api/rebate-summary：除合同基础信息外还带达成/进度/预计返利/挂载规则数，
    // 且同样 LEFT JOIN contact_name，按名称直录的合同不会丢。
    const list = await api('/api/rebate-summary')
    contracts.value = Array.isArray(list) ? list : (list.data || [])
  } catch (e) {
    // 兜底退回基础合同列表（老后端无 summary 字段时）
    try {
      const list = await api('/api/rebate-contracts')
      contracts.value = Array.isArray(list) ? list : (list.data || [])
    } catch (e2) {
      contracts.value = []
      toast('合同返利加载失败: ' + (e2.message || ''), 'error')
    }
  } finally {
    contractLoading.value = false
  }
}
async function loadContactOptions() {
  try {
    const list = await api('/api/contacts?limit=300')
    contactOptions.value = Array.isArray(list) ? list : (list.data || [])
  } catch (e) {}
}
/* ---- 录入年度合同：按月录入 + 全年自动汇总 ---- */
function buildMonthsMap(year) {
  const m = {}
  for (let i = 1; i <= 12; i++) m[`${year}-${String(i).padStart(2, '0')}`] = null
  return m
}
function monthKey(i) {
  const y = String(contractForm.value.year || new Date().getFullYear()).trim()
  return `${y}-${String(i).padStart(2, '0')}`
}
// 年度变更时把已填的月份值迁移到新年份 key（如 2026 → 2027），不丢输入
watch(() => contractForm.value.year, (ny, oy) => {
  const f = contractForm.value
  if (!f.months || !oy) return
  const sy = String(oy).trim()
  const ty = String(ny || sy).trim()
  if (!ty || sy === ty) return
  const nm = buildMonthsMap(ty)
  for (let i = 1; i <= 12; i++) {
    const ok = `${sy}-${String(i).padStart(2, '0')}`
    const nk = `${ty}-${String(i).padStart(2, '0')}`
    const v = f.months[ok]
    if (v !== null && v !== undefined && v !== '') nm[nk] = v
  }
  f.months = nm
})
// 全年目标 = 12 个月求和（空/非法按 0），驱动汇总条实时刷新
const contractYearSum = computed(() => {
  const f = contractForm.value
  let s = 0
  for (const k in (f.months || {})) {
    const v = Number(f.months[k])
    if (Number.isFinite(v) && v > 0) s += v
  }
  return s
})
function openCreateContract() {
  const year = String(new Date().getFullYear())
  contractForm.value = { contact_id: '', contact_name: '', byName: false, year, months: buildMonthsMap(year), rebate_pct: 0, orig_target: 0 }
  editingContractId.value = null
  contractFormOpen.value = true
}
async function openEditContract(c) {
  const year = String(c.year || new Date().getFullYear())
  contractForm.value = {
    contact_id: c.contact_id || '',
    contact_name: c.contact_name || '',
    byName: !!(c.contact_name && String(c.contact_name).trim()),
    year,
    months: buildMonthsMap(year),
    rebate_pct: Number(c.rebate_pct) || 0,
    orig_target: Number(c.target_amount) || 0,
  }
  editingContractId.value = c.id
  contractFormOpen.value = true
  // 预填月度分解：已设置过的月份回填数值，未设置的保持空（可编辑）
  try {
    const d = await api('/api/rebate-contracts/' + c.id + '/months')
    if (d && d.success) {
      const m = { ...contractForm.value.months }
      for (const row of d.months || []) {
        if (row.saved) m[row.month] = Number(row.target_amount) || 0
        else if (Number(row.target_amount) > 0) m[row.month] = Number(row.target_amount)
      }
      contractForm.value.months = m
    }
  } catch (e) { /* 月度预填失败不阻塞编辑 */ }
}
async function saveContract() {
  const f = contractForm.value
  if (!f.year) { toast('请填写年度', 'error'); return }
  if (f.byName) {
    if (!String(f.contact_name || '').trim()) { toast('请填写合作方名称', 'error'); return }
  } else {
    if (!f.contact_id) { toast('请选择合作方', 'error'); return }
  }
  const y = String(f.year).trim()
  const months = []
  let sum = 0
  for (let i = 1; i <= 12; i++) {
    const key = `${y}-${String(i).padStart(2, '0')}`
    const raw = f.months[key]
    let v = 0
    if (raw !== null && raw !== undefined && raw !== '') {
      v = Number(raw)
      if (!Number.isFinite(v)) { toast(`「${i}月」目标必须是数字`, 'error'); return }
      if (v < 0) { toast(`「${i}月」目标不能为负数`, 'error'); return }
    }
    months.push({ month: key, target_amount: v })
    sum += v
  }
  // 编辑老合同防误清零：全部月空/0 且原目标 >0 → 保留原全年目标，不写月度分解
  const hasPositive = months.some(m => m.target_amount > 0)
  const keepOldTarget = !!editingContractId.value && sum === 0 && !hasPositive && (Number(f.orig_target) || 0) > 0
  const targetAmount = keepOldTarget ? Number(f.orig_target) : sum
  const body = { year: y, target_amount: targetAmount, rebate_pct: Number(f.rebate_pct) || 0 }
  if (f.byName) { body.contact_name = String(f.contact_name).trim(); body.contact_id = 0 }
  else { body.contact_id = Number(f.contact_id) }
  try {
    let cid = editingContractId.value
    if (cid) {
      await api('/api/rebate-contracts/' + cid, { method: 'PUT', body })
    } else {
      const r = await api('/api/rebate-contracts', { method: 'POST', body })
      cid = (r && r.id) || null
    }
    if (!cid) throw new Error('未拿到合同 id')
    // 第二步：写月度目标（全 12 个月，含显式 0，保证后端回写 = 用户所见之和）
    if (hasPositive) {
      const mr = await api('/api/rebate-contracts/' + cid + '/months', { method: 'PUT', body: { months } })
      if (mr && mr.success && mr.contract_target != null) sum = Number(mr.contract_target)
    }
    contractFormOpen.value = false
    editingContractId.value = null
    await loadContracts()
    if (keepOldTarget) toast('已保存，该合同无月度分解，全年目标沿用原值 ¥' + fmt(targetAmount), 'success')
    else if (sum === 0) toast('已保存（未填写月度目标，全年目标为 ¥0）', 'success')
    else toast('已保存，全年目标自动汇总为 ¥' + fmt(sum), 'success')
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  }
}
async function deleteContract(c) {
  if (!window.confirm('确定删除「' + contractName(c) + ' ' + c.year + ' 年度」合同返利吗？此操作不可恢复。')) return
  try {
    await api('/api/rebate-contracts/' + c.id, { method: 'DELETE' })
    toast('已删除', 'success')
    await loadContracts()
  } catch (e) {
    toast('删除失败: ' + (e.message || ''), 'error')
  }
}

/* ---- v111: 月度构成（12 个月目标分解）---- */
const expandedMonths = ref({})
const moData = ref({})      // cid -> overview 结构
const moLoading = ref({})
const moError = ref({})
const moSaving = ref({})
const moEdits = ref({})     // cid -> { '2026-01': number, ... }
const accrueLoading = ref({})
const accrueResult = ref({})

async function toggleMonths(c) {
  if (expandedMonths.value[c.id]) { expandedMonths.value[c.id] = false; return }
  expandedMonths.value[c.id] = true
  if (!moData.value[c.id]) await loadMonths(c)
}
async function loadMonths(c) {
  moLoading.value[c.id] = true
  moError.value[c.id] = ''
  try {
    const d = await api('/api/rebate-contracts/' + c.id + '/overview')
    if (!d || !d.success) throw new Error((d && d.error) || '加载失败')
    moData.value[c.id] = d
    const edits = {}
    for (const m of d.months || []) edits[m.month] = m.target_amount
    moEdits.value[c.id] = edits
  } catch (e) {
    moError.value[c.id] = '月度明细加载失败: ' + (e.message || '')
  } finally {
    moLoading.value[c.id] = false
  }
}
async function saveMonths(c) {
  const months = []
  const edits = moEdits.value[c.id] || {}
  for (const m of (moData.value[c.id] || {}).months || []) {
    months.push({ month: m.month, target_amount: Number(edits[m.month]) || 0, note: m.note || '' })
  }
  moSaving.value[c.id] = true
  try {
    const r = await api('/api/rebate-contracts/' + c.id + '/months', { method: 'PUT', body: { months } })
    if (r && r.success) {
      toast('月度目标已保存，年度目标自动更新为 ¥' + fmt(r.contract_target), 'success')
      await Promise.all([loadMonths(c), loadContracts()])
    } else {
      toast('保存失败: ' + ((r && r.error) || ''), 'error')
    }
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  } finally {
    moSaving.value[c.id] = false
  }
}
async function accrueMonth(c, m) {
  const key = c.id + '-' + m.month
  if (m.settled) { toast(m.month + ' 已结算，不能重复计提', 'error'); return }
  accrueLoading.value[key] = true
  try {
    const r = await api('/api/rebate-contracts/' + c.id + '/accrue', { method: 'POST', body: { month: m.month } })
    if (r && r.success) {
      accrueResult.value[c.id] = r
      toast(m.month + ' 计提完成：返利 ¥' + fmt(r.rebate), 'success')
      await Promise.all([loadMonths(c), loadContracts()])
    } else {
      toast('计提失败: ' + ((r && r.error) || ''), 'error')
    }
  } catch (e) {
    toast('计提失败: ' + (e.message || ''), 'error')
  } finally {
    accrueLoading.value[key] = false
  }
}
/* 计提本月：默认取当前月份；若合同年度与当前月不符则提示 */
function openAccrueMonth(c) {
  const now = new Date()
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  const year = String(c.year || now.getFullYear())
  if (year !== String(now.getFullYear())) {
    toast('合同年度 ' + year + ' 与当前年份不符，请展开「月度构成」按月计提', 'error')
    return
  }
  // 展开月度表并直接对该月计提
  if (!expandedMonths.value[c.id]) {
    expandedMonths.value[c.id] = true
    if (!moData.value[c.id]) {
      loadMonths(c).then(() => { accrueMonth(c, { month: ym, settled: false }) })
      return
    }
  }
  accrueMonth(c, { month: ym, settled: false })
}
async function settleContract(c) {
  if (!window.confirm('确定结算「' + contractName(c) + ' ' + c.year + ' 年度」？将把未结算的计提汇总生成一张应收单（厂家欠你方）。')) return
  try {
    const r = await api('/api/rebate-contracts/' + c.id + '/settle', { method: 'POST' })
    if (r && r.success) {
      toast('结算完成：应收单 #' + r.receivable_id + ' ¥' + fmt(r.settled_amount), 'success')
      await Promise.all([loadContracts()].concat(expandedMonths.value[c.id] ? [loadMonths(c)] : []))
    } else {
      toast('结算失败: ' + ((r && r.error) || ''), 'error')
    }
  } catch (e) {
    toast('结算失败: ' + (e.message || ''), 'error')
  }
}

/* ---- v111: 阶梯设置 ---- */
const tierFormOpen = ref(false)
const tierFormContract = ref(null)
const tierFormTiers = ref([])
const tierSaving = ref(false)
function openTierForm(c) {
  tierFormContract.value = c
  tierFormTiers.value = tierList(c).length ? tierList(c).map(t => ({ min_amount: Number(t.min_amount) || 0, max_amount: Number(t.max_amount) || 0, pct: Number(t.pct) || 0 })) : []
  tierFormOpen.value = true
}
async function saveTiers() {
  const c = tierFormContract.value
  const tiers = tierFormTiers.value
    .filter(t => !(t.min_amount === 0 && t.max_amount === 0 && t.pct === 0))
    .map(t => ({ min_amount: Number(t.min_amount) || 0, max_amount: Number(t.max_amount) || 0, pct: Number(t.pct) || 0 }))
  tiers.sort((a, b) => a.min_amount - b.min_amount)
  tierSaving.value = true
  try {
    const r = await api('/api/rebate-contracts/' + c.id + '/tiers', { method: 'PUT', body: { tiers } })
    if (r && r.success) {
      toast('阶梯已保存', 'success')
      tierFormOpen.value = false
      await loadContracts()
    } else {
      toast('保存失败: ' + ((r && r.error) || ''), 'error')
    }
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  } finally {
    tierSaving.value = false
  }
}
function contractName(c) {
  if (c.contact_name && String(c.contact_name).trim()) return c.contact_name
  if (c.contact_ref_name && String(c.contact_ref_name).trim()) return c.contact_ref_name
  if (c.customer_name && String(c.customer_name).trim()) return c.customer_name
  return '合作方 #' + (c.contact_id || '?')
}
function contractTypeText(c) {
  const t = c.contract_type
  if (t === 'purchase') return '采购口径返利'
  if (t === 'revenue') return '销售口径返利'
  return t || '—'
}
function rebatePctText(v) {
  // 年度合同口径：rebate_pct 为百分点（3 = 3%）
  const n = Number(v) || 0
  return (Math.round(n * 100) / 100) + '%'
}
function tierRangeText(t) {
  if (t.min_amount != null || t.max_amount != null) {
    return '¥' + (t.min_amount || 0) + ' ~ ' + (t.max_amount ? '¥' + t.max_amount : '以上')
  }
  return ((t.from_pct || 0) * 100).toFixed(0) + '% ~ ' + ((t.to_pct || 0) * 100).toFixed(0) + '%'
}
function tierPctText(t) {
  // 目标规则档位：rebate_rate 为小数（0.03 = 3%）
  if (t.rebate_rate != null) return (Number(t.rebate_rate) * 100).toFixed(1) + '%'
  // 年度合同档位：pct 为百分点（3 = 3%）
  if (t.pct != null) return Number(t.pct) + '%'
  return '—'
}

onMounted(() => { loadRules(); loadBrandOptions(); loadAchievements(dashMonth.value); loadContracts(); loadContactOptions() })
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:10px}
.tb-left,.tb-right{display:flex;align-items:center;gap:8px}
.sel-filter{width:160px}
.list-card{padding:16px}
.td-date{font-size:12px;color:var(--t3);white-space:nowrap}
.btn-mini{border:1px solid var(--bd);background:none;border-radius:6px;padding:3px 10px;font-size:12px;color:var(--t2);cursor:pointer;margin-right:4px}
.btn-mini:hover{background:var(--bg2)}
.btn-mini.btn-danger{color:var(--dan);border-color:rgba(var(--dan-rgb),.3)}
.btn-mini.btn-danger:hover{background:rgba(var(--dan-rgb),.08)}

/* 主 Tab：目标规则 / 达成填报 */
.main-tabs{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border-subtle)}
.main-tab{padding:10px 18px;border:none;background:none;font-size:14px;color:var(--t2);cursor:pointer;position:relative;font-weight:500}
.main-tab:hover{color:var(--t1)}
.main-tab.on{color:var(--p-dark)}
.main-tab.on::after{content:'';position:absolute;left:12px;right:12px;bottom:-1px;height:2px;background:var(--p-dark);border-radius:2px}

/* 达成填报 Tab */
.achv-card{padding:16px}
.achv-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.achv-lb{font-size:12.5px;color:var(--t2)}
.achv-month{width:150px}
.achv-hint{font-size:12px;color:var(--t3)}
.achv-ops{margin-left:auto;display:flex;gap:8px}
.num-input{width:120px;text-align:right}
.val-ok{color:var(--suc);font-weight:600}
.val-warn{color:var(--war);font-weight:600}
.achv-tip{font-size:12.5px;color:var(--t2);margin:0}
.achv-file{font-size:12px;color:var(--t3);margin:0}

.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000}
.modal-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:580px;max-width:92vw;max-height:88vh;overflow-y:auto;background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:1001}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.modal-hd b{font-size:16px}
.btn-close{border:none;background:none;font-size:18px;color:var(--t3);cursor:pointer}
.modal-body{padding:20px;display:flex;flex-direction:column;gap:14px}
.modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sim-result{background:var(--bg2);border-radius:var(--radius-md);padding:14px;margin-top:6px}
.sr-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0}
.sr-val{font-size:18px;color:var(--p-dark)}
.sr-note{font-size:12px;color:var(--t3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.modal-enter-active,.modal-leave-active{transition:all .25s ease}
.modal-enter-from,.modal-leave-to{opacity:0;transform:translate(-50%,-46%)}

/* P0-1 维度入口卡片 */
.entry-row{display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.entry-card{flex:1;min-width:260px;display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.entry-card h3{font-size:15px;font-weight:600;margin:0}
.entry-card p{font-size:12.5px;color:var(--t3);line-height:1.55;margin:0;flex:1}
.entry-card .btn{margin-top:4px;align-self:flex-start}

/* P0-3 状态标签 */
.tag.warn{background:rgba(245,158,11,.12);color:#b45309;border:1px solid rgba(245,158,11,.3)}

/* P0-4 详情弹层 */
.dt-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.dt-name{font-size:15px;font-weight:600;color:var(--t1)}
.dt-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}
.dt-item{display:flex;flex-direction:column;gap:3px}
.dt-l{font-size:11px;color:var(--t3)}
.dt-v{font-size:13.5px;color:var(--t1);font-weight:500}
.dt-sec{margin-top:14px;padding-top:12px;border-top:1px solid var(--border-subtle)}
.dt-sec h4{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--t2)}
.dt-tier{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
.dt-tier th,.dt-tier td{border:1px solid var(--border-subtle);padding:6px 8px;text-align:left}
.dt-ok{color:var(--p-dark);font-weight:600}
.dt-note{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#b45309;border-radius:var(--radius-md);padding:9px 12px;font-size:12.5px;margin-top:12px;line-height:1.5}

/* 仪表盘 Tab（方案 A：KPI 置顶 + 条形排行） */
.dash-card{padding:16px}
.dash-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.dash-hd b{font-size:16px}
.dash-month{margin-left:auto;display:flex;align-items:center;gap:6px}

/* KPI */
.dash-kpi{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.kpi-hero{flex:1.4;min-width:170px;background:linear-gradient(135deg,rgba(6,182,212,.12),rgba(6,182,212,.04));border:1px solid rgba(6,182,212,.35);border-radius:var(--radius-lg);padding:14px 18px;display:flex;flex-direction:column;gap:4px}
.kpi-hero.risk{background:linear-gradient(135deg,rgba(var(--dan-rgb),.16),rgba(var(--dan-rgb),.05));border-color:rgba(var(--dan-rgb),.45)}
.kpi-sm{flex:1;min-width:130px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:14px 16px;display:flex;flex-direction:column;gap:4px;justify-content:center}
.kpi-num{font-size:26px;font-weight:700;color:var(--t1);line-height:1.1}
.kpi-hero.money .kpi-num{color:var(--p-dark)}
.kpi-hero.risk .kpi-num{color:var(--dan)}
.kpi-unit{font-size:14px;font-weight:500;color:var(--t3);font-style:normal;margin-left:2px}
.kpi-lb{font-size:12px;color:var(--t3)}

/* 图例 */
.dash-legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--t2);margin-bottom:10px}
.dash-legend span{display:inline-flex;align-items:center;gap:5px}
.lg{width:10px;height:10px;border-radius:3px;display:inline-block}
.lg.done{background:var(--suc)}
.lg.risk{background:var(--dan)}
.lg.ontrack{background:var(--p-dark)}
.dash-legend-note{margin-left:auto;color:var(--t3)}

/* 条形排行 */
.dash-rank{display:flex;flex-direction:column;gap:12px}
.rank-row{border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px 14px;background:var(--bg)}
.rank-row.risk{border-color:rgba(var(--dan-rgb),.45);background:rgba(var(--dan-rgb),.05)}
.rank-row.done{border-color:rgba(var(--suc-rgb),.4)}
.rr-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.rr-rank{width:20px;height:20px;border-radius:50%;background:var(--bg2);border:1px solid var(--border-subtle);font-size:11px;font-weight:700;color:var(--t2);display:inline-flex;align-items:center;justify-content:center}
.rank-row.risk .rr-rank{background:rgba(var(--dan-rgb),.15);border-color:rgba(var(--dan-rgb),.4);color:var(--dan)}
.rr-name{font-size:14px;font-weight:600;color:var(--t1)}
.rr-scope{font-size:12px;color:var(--t3)}
.rr-ach{margin-left:auto;font-size:15px;font-weight:700;color:var(--p-dark)}
.rr-ach.val-warn{color:var(--dan)}
.rr-bar{height:14px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;position:relative}
.rr-bar-fill{height:100%;border-radius:8px;transition:width .35s ease;background:var(--p-dark)}
.dash-nodata{margin:-2px 0 12px;padding:9px 12px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.3);border-radius:var(--radius-md);font-size:12.5px;color:var(--p-dark);line-height:1.5}

/* 本月时间进度参照条 */
.dash-time{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;padding:9px 12px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:var(--radius-md);font-size:12.5px;color:var(--t2)}
.dash-time .dt-k{font-weight:600;color:var(--t1)}
.dash-time .dt-k b{color:var(--war);font-size:15px}
.dash-time .dt-v{color:var(--t3)}
.dash-time .dt-hint{margin-left:auto;color:var(--t3)}
.lg.time{width:0;height:12px;border-radius:0;background:transparent;border-left:2px dashed var(--war)}

/* 条形上的时间进度虚线标记 */
.rr-bar-mark{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed var(--war);z-index:2;pointer-events:none}
.rr-vs{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12.5px;border-radius:var(--radius-md);padding:6px 10px}
.rr-vs-ic{font-style:normal}
.rr-vs.ahead{background:rgba(var(--suc-rgb),.1);border:1px solid rgba(var(--suc-rgb),.35);color:var(--suc)}
.rr-vs.behind{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);color:#b45309}
.rr-vs.even{background:var(--bg2);border:1px solid var(--border-subtle);color:var(--t2)}
.rr-bar-fill.risk{background:var(--dan)}
.rr-bar-fill.done{background:var(--suc)}
.rr-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--t2);margin-top:8px}
.rr-next{color:var(--t3)}
.rr-warn{margin-top:8px;padding:8px 10px;background:rgba(var(--dan-rgb),.08);border:1px solid rgba(var(--dan-rgb),.3);border-radius:var(--radius-md);font-size:12.5px;color:var(--dan)}
.tag.risk{background:rgba(var(--dan-rgb),.12);color:var(--dan);border:1px solid rgba(var(--dan-rgb),.3)}

/* 年度合同返利（并入目标与返利） */
.contract-list{display:flex;flex-direction:column;gap:12px}
.contract-card{border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px 16px;background:var(--bg)}
.cc-top{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.cc-actions{margin-left:auto;display:flex;gap:6px}
.btn-xs{padding:3px 10px;font-size:12px;line-height:1.5;border-radius:var(--radius-sm)}
.btn-xs.danger{color:var(--dan);border-color:rgba(var(--dan-rgb),.4)}
.btn-xs.danger:hover{background:rgba(var(--dan-rgb),.1)}
.cb-line{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);cursor:pointer;font-weight:400}
.cb-line input{width:auto;margin:0}
.cc-name{font-size:14px;font-weight:600;color:var(--t1)}
.cc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px 18px}
.cc-item{display:flex;flex-direction:column;gap:3px}
.cc-l{font-size:11px;color:var(--t3)}
.cc-v{font-size:13.5px;color:var(--t1);font-weight:500}
.cc-tier{margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)}
.cc-tier-h{font-size:12.5px;font-weight:600;color:var(--t2);margin-bottom:6px}

/* v111: 月度构成 */
.cc-mo{margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)}
.cc-mo-toggle{display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:var(--p-dark);font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 0}
.cc-mo-toggle svg{transition:transform .15s}
.cc-months{margin-top:10px}
.cc-months-save{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.cc-ms-tip{font-size:12px;color:var(--t3)}
.cc-mtable-wrap{overflow-x:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.cc-mtable{margin-top:0;min-width:640px}
.cc-mtable th,.cc-mtable td{padding:5px 8px;white-space:nowrap}
.cc-m-label{font-weight:600;color:var(--t2)}
.cc-m-input{width:96px;padding:3px 6px;font-size:12px;text-align:right}
.cc-mtotals{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--t2)}
.cc-mtotals .cc-mtotals-p{font-weight:600}
.cc-mtotals .cc-mtotals-p.ok{color:var(--suc)}
.cc-ti{width:90px;padding:3px 6px;font-size:12px}


@media(max-width:768px){
  .toolbar{flex-direction:column;align-items:stretch}
  .sel-filter{width:100%}
  .form-grid2{grid-template-columns:1fr}
  .modal-card{width:94vw}
  .entry-row{flex-direction:column}
  .dt-grid{grid-template-columns:1fr}
  .dash-hd{flex-direction:column;align-items:flex-start}
  .dash-month{margin-left:0}
  .kpi-hero,.kpi-sm{min-width:0;flex:1 1 100%}
  .rr-top{gap:6px}
  .rr-meta{gap:10px}
  .dash-legend-note{margin-left:0;width:100%}
}

/* 冲突弹窗（409 规则冲突） */
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0 0 12px}
.cf-mo-hint{font-size:12px;color:var(--t3);font-weight:400;margin-left:6px}
.cf-mo-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px}
.cf-mo-cell label{display:block;font-size:12px;color:var(--t2);margin-bottom:3px}
.cf-mo-sum{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:10px 14px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.18);border-radius:8px}
.cf-mo-sum span{font-size:13px;color:var(--p-dark)}
.cf-mo-sum b{font-size:18px;color:var(--p);font-weight:600}
.cf-tip b{color:var(--t1)}
.cf-tbl{width:100%;margin-bottom:12px}
.cf-tbl td.cf-period{white-space:nowrap;color:var(--t2);font-variant-numeric:tabular-nums}
.cf-sol{font-size:12.5px;color:var(--t3);line-height:1.7;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px 12px;margin:0}
.cf-sol b{color:var(--t1)}

@media(max-width:768px){
  .cf-tbl td.cf-period{white-space:normal}
}
</style>
