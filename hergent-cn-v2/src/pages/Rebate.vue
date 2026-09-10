<template>
  <div class="page">
    <!-- 主 Tab：仪表盘 / 目标与返利 / 达成填报 / 返利结算 -->
    <div class="main-tabs">
      <button class="main-tab" :class="{ on: mainTab === 'dashboard' }" @click="switchTab('dashboard')">仪表盘</button>
      <button class="main-tab" :class="{ on: mainTab === 'rules' }" @click="mainTab = 'rules'">目标与返利</button>
      <button class="main-tab" :class="{ on: mainTab === 'achv' }" @click="switchTab('achv')">达成填报</button>
      <button class="main-tab" :class="{ on: mainTab === 'contracts' }" @click="switchTab('contracts')">返利结算</button>
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
          <p v-if="!rules.length">暂无返利规则，请先在「目标与返利」创建品牌 / 商品目标。
            <!-- v112 R19：空态快捷操作 -->
            <button class="btn btn-primary btn-sm" style="display:block;margin:10px auto 0" @click="mainTab='rules'">去创建目标</button>
          </p>
          <p v-else>所选月份（{{ dashMonth }}）没有处于生效期的返利目标。</p>
        </div>
        <div v-else>
          <!-- KPI：钱 + 风险 置顶 -->
          <div class="dash-kpi">
            <div class="kpi-hero money" :title="'本月预估返利：¥' + fmt(dashboardModel.summary.totalEstRebate)">
              <!-- v112 R25：长金额缩写（≥1万 万 / ≥1亿 亿），悬停看全量 -->
              <span class="kpi-num">¥{{ fmtShort(dashboardModel.summary.totalEstRebate) }}</span>
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
          <!-- v123：KPI 回答"我这个月总共能拿多少返利"，必须始终全量，不能被筛选悄悄改掉 -->
          <div class="dash-kpi-note">以上 KPI 始终统计全部品牌，不随下方图表的品牌筛选变化</div>

          <!-- 本月时间进度参照（v112 R22：emoji 统一为 SVG 图标） -->
          <div class="dash-time">
            <span class="dt-k">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
              本月时间进度 <b>{{ dashboardModel.summary.timeProgressPct }}</b>
            </span>
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

          <!-- v123：全年月度达成柱状图（位置＝KPI 之下、预警之上；品牌筛选联动预警区与排行） -->
          <div class="dash-chart">
            <MonthlyAchvChart
              :model="chartMatrix"
              :loading="chartLoading"
              :year="chartYear"
              :year-options="chartYearOptions"
              :brand-list="chartBrandList"
              :brand-sel="chartBrandSel"
              :single-brand="chartBrandSel.length === 1"
              @update:year="onChartYear"
              @update:brand-sel="chartBrandSel = $event"
            >
              <template #empty-action>
                <button class="btn btn-primary btn-sm" @click="mainTab='rules'">去创建品牌目标</button>
              </template>
            </MonthlyAchvChart>
          </div>

          <!-- #356：异常预警区（规则冲突 / 达成未填 / 预计不达标 聚合） -->
          <div v-if="anomalies.length" class="dash-anom">
            <div class="da-hd"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.5"/></svg>待处理异常（{{ anomalies.length }}）</div>
            <ul class="da-list">
              <li v-for="(a, ai) in anomalies" :key="ai" class="da-item" :class="a.level">
                <span class="da-ic"><Icon :name="a.type === 'conflict' ? 'alert-triangle' : a.type === 'risk' ? 'clock' : 'edit'"/></span>
                <span class="da-text">{{ a.text }}</span>
                <span class="da-items">{{ a.items.slice(0, 4).join('、') }}<template v-if="a.items.length > 4"> 等 {{ a.items.length }} 项</template></span>
              </li>
            </ul>
          </div>

          <!-- 条形排行 -->
          <div class="dash-rank">
            <div v-for="(it, idx) in dashItemsFiltered" :key="it.rule.id" class="rank-row" :class="it.level">
              <div class="rr-top">
                <span class="rr-rank">{{ idx + 1 }}</span>
                <span class="tag info">{{ it.dimLabel }}</span>
                <b class="rr-name">{{ it.rule.rule_name }}</b>
                <span class="rr-scope">{{ it.scope }}</span>
                <span class="tag" :class="it.level === 'done' ? 'ok' : it.level === 'risk' ? 'risk' : ''">{{ it.levelText }}</span>
                <span class="rr-ach" :class="it.level === 'risk' ? 'val-warn' : ''">{{ it.achPct }}</span>
                <!-- #354：点金额/达成率看返利计算算式链 -->
                <button v-if="it.simReady" class="rr-calc-btn" @click="openCalc(it.simData, it.rule.rule_name)" title="查看返利计算算式">算式</button>
                <span v-else class="rr-calc-loading">试算中…</span>
              </div>
              <div class="rr-bar">
                <div class="rr-bar-fill" :class="it.level" :style="{ width: Math.min(100, it.ach * 100) + '%' }"></div>
                <span class="rr-bar-pct">{{ (Math.min(100, it.ach * 100)).toFixed(0) }}%</span>
                <div v-if="dashboardModel.summary.tpShown" class="rr-bar-mark" :style="{ left: dashboardModel.summary.timeProgressPct }"></div>
              </div>
              <div class="rr-meta">
                <span>目标 <b>{{ it.targetText }}</b></span>
                <span>已填报 <b>{{ it.reportedText }}</b></span>
                <span>距目标 <b :class="it.gap > 0 ? 'val-warn' : 'val-ok'">{{ it.gapText }}</b></span>
                <span>档位 <b>{{ it.curTierPct }} → {{ it.nextTierPct || '满档' }}</b></span>
                <span v-if="it.nextTierPct != null" class="rr-next">达下一档多赚 <b class="val-ok">¥{{ fmt(it.estRebateNext - it.estRebate) }}</b></span>
                <span class="rr-est">预计返利 <b class="val-ok">¥{{ fmt(it.estRebate) }}</b>
                  <button v-if="it.simReady" class="rr-calc-link" @click="openCalc(it.simData, it.rule.rule_name)">看算式</button>
                </span>
              </div>
              <div class="rr-vs" :class="it.timeVerdict">
                <i class="rr-vs-ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg></i>
                <template v-if="it.timeVerdict === 'ahead'">超前时间进度 {{ it.vsTimePct }}（进度领先）</template>
                <template v-else-if="it.timeVerdict === 'behind'">落后时间进度 {{ it.vsTimePct }}（需加速补单 / 催回款）</template>
                <template v-else>与时间进度基本持平</template>
              </div>
              <div v-if="it.level === 'risk'" class="rr-warn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.5"/></svg>
                预计月底仅达成 {{ it.predictedPct }}，还差 {{ it.gapText }}，建议尽快补单或催回款
              </div>
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
        <!-- v112 R10：按归属合同筛选（后端 list_rules 已支持 contract_id，前端补入口） -->
        <select v-model="filterContract" class="input sel-filter">
          <option value="">全部合同</option>
          <option v-for="c in contracts" :key="c.id" :value="c.id">{{ contractName(c) }} · {{ c.year }}{{ c.brand_name ? ' · ' + c.brand_name : '' }}</option>
        </select>
      </div>
      <div class="tb-right">
        <button class="btn btn-ghost" title="按规则试算返利（也可在规则详情弹窗进入）" @click="showSimulate = !showSimulate">试算</button>
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

    <!-- v116 (L2)：全局默认到货周期 —— 规则未单独设到货周期时沿用；各品牌可在规则里单独覆盖 -->
    <div class="card cadence-default-card">
      <div class="cd-left">
        <b><Icon name="settings"/> 全局默认到货周期</b>
        <span class="muted">规则留空时沿用此默认值；蒙牛、简爱等不同品牌可在各自规则里单独设置到货周期覆盖它。</span>
      </div>
      <div class="cd-right">
        <input v-model.number="defaultCadence" class="input cd-input" type="number" min="1" max="30">
        <span>天到货一次</span>
        <button class="btn btn-primary btn-sm" :disabled="cdnSaving" @click="saveDefaultCadence">保存</button>
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
              <td>{{ periodText(r.period_type) }}<span v-if="r.is_monthly" class="tag ok" style="margin-left:6px" title="按 12 个月分解目标与返利">月分解</span></td>
              <td>{{ r.scope_name || '全部' }}</td>
              <td class="num">{{ fmtTarget(r) }}</td>
              <td><span class="tag" :class="r.trigger_mode === 'tiered' ? 'info' : 'ok'">{{ triggerText(r.trigger_mode) }}</span></td>
              <td>{{ rebateText(r) }}</td>
              <td class="td-date">{{ r.effective_start || '—' }} ~ {{ r.effective_end || '—' }}</td>
              <td><span class="tag" :class="statusOf(r).cls">{{ statusOf(r).text }}</span></td>
              <td>
                <button class="btn-mini" @click="openDetail(r)">详情</button>
                <button class="btn-mini" @click="openEdit(r)">编辑</button>
                <!-- #354：规则级「查看算式」（以 100% 达成为例生成算式链） -->
                <button class="btn-mini" @click="openRuleCalc(r)">算式</button>
                <!-- v114 (B2-1)：阶梯版本管理（按生效期锁定历史月份计提口径） -->
                <button class="btn-mini" @click="openVersionManager(r)">版本</button>
                <!-- v112 R11：复制（清空生效期，名称带副本后缀），多 SKU 同结构目标免重复录入 -->
                <button class="btn-mini" @click="dup(r)">复制</button>
                <!-- v112 R5：停用/启用三态 —— 停用=软删可恢复；启用=重新生效 -->
                <button v-if="r.is_active" class="btn-mini" @click="toggleActive(r)">停用</button>
                <button v-else class="btn-mini" style="color:var(--p-dark);border-color:rgba(var(--p-rgb),.4)" @click="toggleActive(r)">启用</button>
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
          <label class="achv-lb">周期口径</label>
          <select v-model="achvPeriod" class="input achv-period" @change="onAchvPeriod">
            <option value="month">按月</option>
            <option value="quarter">按季</option>
            <option value="year">按年</option>
          </select>
          <template v-if="achvPeriod === 'month'">
            <input type="month" v-model="achvMonth" class="input achv-month" @change="loadAchievements" />
          </template>
          <template v-else-if="achvPeriod === 'quarter'">
            <input type="text" v-model="achvMonth" class="input achv-month" placeholder="如 2026-Q3"
                   @change="onAchvPeriodInput" />
          </template>
          <template v-else>
            <input type="text" v-model="achvMonth" class="input achv-month" placeholder="如 2026"
                   @change="onAchvPeriodInput" />
          </template>
          <span class="achv-hint">共 {{ achvRows.length }} 行 · 已填报 {{ achvFilledCount }} 行</span>
          <div class="achv-ops">
            <button class="btn btn-ghost btn-sm" @click="downloadAchvTemplate">下载模板</button>
            <button class="btn btn-primary btn-sm" @click="achvImpOpen = true">Excel 导入</button>
          </div>
        </div>

        <div v-if="achvLoading" class="state-empty">加载中…</div>
        <div v-else-if="!achvRows.length" class="state-empty">
          <p>本期还没有可填报的行。请先在「目标与返利」创建品牌 / 商品目标，或直接「Excel 导入」达成数据。</p>
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
                         :disabled="achvSaving[row.key]"
                         @change="saveAchv(row)" />
                </td>
                <td class="num">
                  <input class="input num-input" type="number" v-model.number="row.achQty"
                         :placeholder="row.target_type === 'quantity' ? '填数量' : '—'"
                         :disabled="achvSaving[row.key]"
                         @change="saveAchv(row)" />
                </td>
                <td class="num"><span :class="achvRateCls(row)">{{ achvRateText(row) }}</span></td>
                <td>
                  <span class="tag" :class="row.achId ? 'ok' : ''">
                    {{ row.achId ? (row.source === 'excel' ? 'Excel' : '手工') : '未填报' }}
                  </span>
                  <!-- v112 R14：行级保存状态（防抖期间 / 请求中 / 失败待重试） -->
                  <span v-if="achvSaving[row.key]" class="achv-saving">保存中…</span>
                  <span v-else-if="achvFail[row.key]" class="achv-fail" @click="retryAchv(row)">保存失败，点击重试</span>
                </td>
                <td><button v-if="row.achId" class="btn-mini btn-danger" :disabled="achvSaving[row.key]" @click="delAchv(row)">清除</button></td>
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
              <button class="btn-close" @click="achvImpOpen = false"><Icon name="close"/></button>
            </div>
            <div class="modal-body">
              <p class="achv-tip">列顺序：<code>月份 / 维度 / 作用对象 / 实际达成金额 / 实际达成数量 / 备注</code>。首次使用请先「下载模板」。</p>
              <p class="achv-tip">同一「月份 + 维度 + 作用对象」重复导入将<b>覆盖</b>旧值，可放心重导。商品维度按名称或条码匹配商品档案，匹配不到按原文导入并在结果中提示。</p>
              <p class="achv-tip">月份列留空时，按上方选择的 <b>{{ achvMonth }}</b> 归入。</p>
              <input type="file" accept=".xlsx,.xls,.csv" @change="onAchvFile" />
              <p v-if="achvImpFileName" class="achv-file">已选：{{ achvImpFileName }}</p>
              <!-- v112 R34：先预览（干跑校验）再确认导入，避免整表导入后才发现格式问题 -->
              <div v-if="achvPreview" class="achv-preview">
                <p class="achv-preview-hd">
                  预览结果：将导入 <b>{{ achvPreview.imported }}</b> 行，
                  跳过 {{ achvPreview.skipped }} 行
                  <span v-if="(achvPreview.errors || []).length" class="val-warn">，{{ achvPreview.errors.length }} 处提示</span>
                </p>
                <ul v-if="(achvPreview.errors || []).length" class="achv-preview-errs">
                  <li v-for="(er, ei) in achvPreview.errors.slice(0, 20)" :key="ei">第 {{ er.row }} 行：{{ er.msg }}</li>
                  <li v-if="achvPreview.errors.length > 20">… 共 {{ achvPreview.errors.length }} 处提示</li>
                </ul>
                <p v-else class="achv-preview-ok">校验通过，可放心导入。</p>
              </div>
            </div>
            <div class="modal-ft">
              <button class="btn btn-ghost" @click="achvImpOpen = false">取消</button>
              <button v-if="!achvPreview" class="btn btn-primary" :disabled="!achvImpFile || achvImporting" @click="previewAchvImport">
                {{ achvImporting ? '校验中…' : '预览并校验' }}
              </button>
              <template v-else>
                <button class="btn btn-ghost" @click="achvPreview = null; achvImpFile = null; achvImpFileName = ''">重新选择</button>
                <button class="btn btn-primary" :disabled="achvImporting" @click="runAchvImport">
                  {{ achvImporting ? '导入中…' : '确认导入' }}
                </button>
              </template>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- ===== 返利结算 Tab（原年度合同：展示 rebate_contracts，含计提/结算/申领/余额） ===== -->
    <template v-if="mainTab === 'contracts'">
      <div class="card list-card">
        <div class="dash-hd">
          <b>返利结算</b>
          <span class="page-sub">厂家 / 平台给你的年度返利合同，在此做计提 / 结算 / 申领与余额管理 · 数据来自年度合同（rebate_contracts）</span>
          <!-- v112 R12：合同搜索（名称 / 年度） -->
          <input v-model="contractSearch" class="input" style="width:180px" placeholder="搜索合同名称 / 年度" />
          <button class="btn btn-ghost btn-sm" :disabled="batchAccruing" @click="batchAccrue">{{ batchAccruing ? '计提中…' : '批量计提(本月)' }}</button>
          <button class="btn btn-primary btn-sm" style="margin-left:auto" @click="openCreateContract">+ 录入年度合同</button>
        </div>

        <div v-if="contractLoading" class="state-empty">加载中…</div>
        <div v-else-if="!contracts.length" class="state-empty">
          <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
          <p>暂无返利结算。点击「录入年度合同」新增（如「蒙牛 2026 年度返利合同」）。</p>
        </div>
        <div v-else class="contract-list">
          <div v-for="c in filteredContracts" :key="c.id" class="contract-card">
            <div class="cc-top">
              <b class="cc-name">{{ contractName(c) }}</b>
              <span class="tag info">{{ c.year }} 年度</span>
              <span class="tag info" v-if="c.brand_name">{{ c.brand_name }}</span>
              <span class="tag" :class="c.settled ? '' : 'ok'">{{ c.settled ? '已结算' : '进行中' }}</span>
              <span class="tag warn">{{ contractTypeText(c) }}</span>
              <span class="tag" :class="claimBadgeClass(c)">{{ claimStatusText(c) }}</span>
              <span class="cc-actions">
                <button class="btn btn-ghost btn-xs" @click="openTierForm(c)">阶梯设置</button>
                <button v-if="!c.settled" class="btn btn-ghost btn-xs" @click="openAccrueMonth(c)">计提本月</button>
                <button v-if="!c.settled" class="btn btn-primary btn-xs" @click="settleContract(c)">结算</button>
                <button v-if="!c.settled && claimStatus(c)==='none'" class="btn btn-ghost btn-xs" @click="claimSubmit(c)">申领</button>
                <button v-if="!c.settled && claimStatus(c)==='submitted'" class="btn btn-primary btn-xs" @click="claimReview(c,'approve')">审核通过</button>
                <button v-if="!c.settled && claimStatus(c)==='submitted'" class="btn btn-ghost btn-xs danger" @click="claimReview(c,'reject')">驳回</button>
                <button v-if="claimStatus(c)==='approved'" class="btn btn-ghost btn-xs danger" @click="claimReview(c,'reverse')">冲销</button>
                <button class="btn btn-ghost btn-xs" @click="openEditContract(c)">编辑</button>
                <button class="btn btn-ghost btn-xs danger" @click="deleteContract(c)">删除</button>
              </span>
            </div>
            <div class="cc-grid">
              <div class="cc-item"><span class="cc-l">目标额</span><span class="cc-v">¥{{ fmt(c.target_amount) }}</span></div>
              <div class="cc-item"><span class="cc-l">返利比例</span><span class="cc-v">{{ rebatePctText(c.rebate_pct) }}</span></div>
              <div class="cc-item"><span class="cc-l">当年达成</span><span class="cc-v">¥{{ fmt(c.achieved) }}</span></div>
              <div class="cc-item"><span class="cc-l">进度</span><span class="cc-v">{{ c.progress_pct != null ? c.progress_pct + '%' : '—' }}</span></div>
              <div class="cc-item" title="全年预计：按当年已达成口径，用合同阶梯/比例计算（区别于月度表的「当月试算」）"><span class="cc-l">预计返利</span><span class="cc-v">¥{{ fmt(c.expected_rebate) }}</span></div>
              <div class="cc-item" v-if="c.rule_count != null"><span class="cc-l">挂载规则</span><span class="cc-v">{{ c.rule_count }} 条</span></div>
              <div class="cc-item" v-if="c.contact_rebate_balance != null"><span class="cc-l">未结算余额(BV)</span><span class="cc-v">¥{{ fmt(c.contact_rebate_balance) }}</span></div>
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
                  <!-- #357 目标分解：分解方式 + 校验条 -->
                  <div class="cc-mo-toolbar">
                    <div class="cc-months-save">
                      <span class="cc-ms-tip">月度目标之和 = 合同年度目标（保存后自动回写）</span>
                      <button class="btn btn-primary btn-xs" :disabled="moSaving[c.id]" @click="saveMonths(c)">{{ moSaving[c.id] ? '保存中…' : '保存月度目标' }}</button>
                    </div>
                    <div class="cc-mo-split">
                      <label class="cc-mo-split-l">分解方式</label>
                      <select v-model="moSplitMode[c.id]" class="input input-sm cc-mo-select" @change="applySplit(c)">
                        <option value="manual">手动（自定义）</option>
                        <option value="avg">平均</option>
                        <option value="hist">按去年同期占比</option>
                      </select>
                      <button class="btn btn-ghost btn-xs" :disabled="moSplitBusy[c.id]" @click="applySplit(c)">应用分解</button>
                      <button class="btn btn-ghost btn-xs" :disabled="moSplitBusy[c.id]" @click="topUpMonths(c)" title="把差额补到最后一个未锁定月，使月度合计=年度目标">差额补平</button>
                    </div>
                    <div class="cc-mo-valid" :class="moMismatch(c) ? 'warn' : 'ok'">
                      <span>月度合计 <b>¥{{ fmt(moEditSum(c)) }}</b></span>
                      <span class="cc-mo-vs">年度目标 <b>¥{{ fmt(moContractTarget(c)) }}</b></span>
                      <span v-if="moMismatch(c)" class="cc-mo-bad">差 ¥{{ fmt(Math.abs(moEditSum(c) - moContractTarget(c))) }}</span>
                      <span v-else class="cc-mo-good">一致</span>
                    </div>
                  </div>
                  <div class="cc-mtable-wrap">
                    <table class="dt-tier cc-mtable">
                      <thead>
                        <tr>
                          <th>月份</th><th>月度目标</th><th>达成</th><th>达成率</th>
                          <th title="当月试算：按当月达成计算（区别于合同卡片的「全年预计」）">试算返利</th><th>已计提</th><th>累计计提</th><th>状态</th><th>操作</th>                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="m in moData[c.id].months" :key="m.month">
                          <td class="cc-m-label">{{ m.label }}</td>
                          <td>
                            <span v-if="monthLocked(m)" class="mo-locked">
                              ¥{{ fmt(m.target_amount) }}
                              <svg class="mo-lock" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" title="已计提，已锁定不可改"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                            </span>
                            <input v-else v-model.number="moEdits[c.id][m.month]" class="input cc-m-input" type="number" min="0" step="1000" placeholder="0" />
                          </td>
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
                              <!-- v112 R33：区分首次计提 / 重提（覆盖旧值） -->
                              {{ m.settled ? '已结算' : (accrueLoading[c.id+'-'+m.month] ? '计提中…' : (Number(m.accrued_rebate) > 0 ? '重提' : '计提')) }}
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
                    <span v-if="moData[c.id].contact_rebate_balance != null" class="cc-mtotals-p">未结算余额 ¥{{ fmt(moData[c.id].contact_rebate_balance) }}</span>
                  </div>
                  <div v-if="accrueResult[c.id]" class="dt-note" style="margin-top:10px">
                    <b>{{ accrueResult[c.id].month }} 计提完成：</b>达成 ¥{{ fmt(accrueResult[c.id].achieved) }} → 返利 ¥{{ fmt(accrueResult[c.id].rebate) }}
                    <ul style="margin:6px 0 0 18px;padding:0">
                      <li v-for="(dd, di) in (accrueResult[c.id].details || [])" :key="di" :style="{color: dd.triggered ? 'var(--suc)' : 'var(--t3)'}">
                        {{ dd.scope }}：达成 ¥{{ fmt(dd.achieved) }} → ¥{{ fmt(dd.rebate) }}（{{ dd.detail }}）<span v-if="dd.tier_version_id" class="tag info" style="margin-left:6px">按 v{{ dd.tier_version_id }} 算</span>
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
    <!-- v122 拆分：目标规则表单已抽到 components/rebate/ —— 品牌页 / 商品页各自独立，
         本页只负责「打开哪个模式 + 传依赖 + 收结果」 -->
    <TargetFormModal
      :open="showForm" :mode="formMode" :rule="formRule" :preset-dim="formPresetDim"
      :brand-options="brandOptions" :product-names="productNames" :product-refs="productRefs"
      :scale-options="scaleOptions" :default-cadence="defaultCadence"
      :existing-rules="rules"
      @close="showForm=false" @saved="onRuleSaved" @conflict="conflictInfo=$event"
      @load-existing="onLoadExisting"
    />

    <!-- 试算弹层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showSimulate" class="modal-overlay" @click.self="showSimulate=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showSimulate" class="modal-card">
          <div class="modal-hd"><b>返利试算</b><button class="btn-close" @click="showSimulate=false"><Icon name="close"/></button></div>
          <div class="modal-body">
            <div class="form-row"><label>选择规则</label>
              <select v-model="simRuleId" class="input" @change="simResult = null">
                <option value="">— 选择 —</option>
                <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.rule_name }}</option>
              </select>
              <!-- v112 R17①：切规则自动带出目标值/单位提示 -->
              <span v-if="simRuleTarget" class="sr-hint">{{ simRuleTarget }}</span>
            </div>
            <div class="form-row"><label>实际完成值（{{ simRuleId ? (simActual != null && simActual !== '' ? fmt(simActual) : '0') : '—' }}）</label>
              <input v-model.number="simActual" class="input" type="number" min="0" placeholder="实际完成金额或数量" />
              <!-- #355：滑块快速拖动看不同达成下的返利（与目标值联动） -->
              <input v-if="simRuleId" type="range" class="sim-slider" min="0" :max="simSliderMax" step="any" v-model.number="simActual" />
            </div>
            <!-- #355：What-if 覆盖（不落库，仅试算看差异） -->
            <div class="form-grid2 sim-ov">
              <div class="form-row"><label>计法（覆盖）</label>
                <select v-model="simScaleOverride" class="input" @change="simResult = null">
                  <option value="">沿用规则</option>
                  <option v-for="s in scaleOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
              </div>
              <div class="form-row"><label>舍入（覆盖）</label>
                <select v-model="simRoundingMode" class="input" @change="simResult = null">
                  <option value="">沿用规则</option>
                  <option v-for="o in roundingOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
            </div>
            <div v-if="simResult" class="sim-result">
              <div class="sr-row"><span>应返金额</span><b class="sr-val">¥{{ fmt(simResult.rebate) }}</b></div>
              <div class="sr-row"><span>返利比例（实际）</span><b>{{ simResult.effectiveRate != null ? (simResult.effectiveRate * 100).toFixed(2) + '%' : '—' }}</b></div>
              <div class="sr-row"><span>达成率</span><b>{{ simResult.achievementPct != null ? (simResult.achievementPct * 100).toFixed(1) + '%' : '—' }}</b></div>
              <div class="sr-row"><span>边际率</span><b>{{ simResult.marginalRate != null ? (simResult.marginalRate * 100).toFixed(2) + '%' : '—' }}</b></div>
              <div class="sr-row"><span>计法 / 舍入</span><b>{{ simResult.scaleLabel || '—' }} · {{ simResult.rounding ? roundingLabel(simResult.rounding) : '—' }}</b></div>
              <div v-if="!simResult.triggered" class="sr-flag">未达触发门槛，返利为 0</div>
              <div v-if="simResult.detail" class="sr-note">{{ simResult.detail }}</div>
              <!-- #354：直接在此展开算式链（也可点「查看完整算式」放大看） -->
              <button class="btn btn-ghost btn-sm sim-calc-btn" @click="openCalc(simResult, (simRuleName))">查看完整算式</button>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showSimulate=false">关闭</button>
            <button class="btn btn-primary" @click="runSimulate">计算</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- #354 透明化算式链 Modal（点金额/达成率/「算式」按钮弹出） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showCalc" class="modal-overlay" @click.self="showCalc=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showCalc && calcData" class="modal-card calc-card">
          <div class="modal-hd">
            <b>返利计算算式 · {{ calcTitle }}</b>
            <button class="btn-close" @click="showCalc=false"><Icon name="close"/></button>
          </div>
          <div class="modal-body">
            <!-- 摘要 -->
            <div class="calc-sum">
              <div class="cs-cell"><span>达成基数</span><b>{{ calcData.basisValue != null ? fmtByType(calcData.basisValue, calcData.targetType) : '—' }}</b></div>
              <div class="cs-cell"><span>达成率</span><b>{{ calcData.achievementPct != null ? (calcData.achievementPct * 100).toFixed(1) + '%' : '—' }}</b></div>
              <div class="cs-cell"><span>应返金额</span><b class="cs-ok">¥{{ fmt(calcData.rebate) }}</b></div>
              <div class="cs-cell"><span>计法</span><b>{{ calcData.scaleLabel || '—' }}</b></div>
            </div>
            <!-- 算式链 steps[]：基数 → 达成率 → 命中档位 → 比率 → 金额 → 舍入 -->
            <div class="calc-sec">
              <h4>计算步骤</h4>
              <ol class="calc-steps">
                <li v-for="(s, i) in calcData.steps" :key="i" class="cs-step">
                  <span class="cs-key">{{ s.label }}</span>
                  <span class="cs-text">{{ s.text }}</span>
                  <span v-if="s.value != null" class="cs-val">{{ typeof s.value === 'number' ? (calcData.targetType === 'amount' && /金额|返利|基数/.test(s.label) ? '¥' + fmt(s.value) : fmt(s.value)) : s.value }}</span>
                </li>
              </ol>
            </div>
            <!-- 档位明细 tiers[] -->
            <div v-if="calcData.tiers.length" class="calc-sec">
              <h4>档位明细（{{ calcData.scaleType === 'graduated' ? '累进：每档只对落入部分计价' : '全量按档：命中档对全部基数计价' }}）</h4>
              <table class="dt-tier calc-tiers">
                <thead><tr><th>区间</th><th>比率</th><th>该档基数</th><th>该档返利</th><th>状态</th></tr></thead>
                <tbody>
                  <tr v-for="(t, i) in calcData.tiers" :key="i" :class="t.hit ? 'tier-hit' : 'tier-miss'">
                    <td>{{ fmtByType(t.from, calcData.targetType) }} ~ {{ t.to_infinite ? '以上' : fmtByType(t.to, calcData.targetType) }}</td>
                    <td>{{ t.rate != null ? (Number(t.rate) * 100).toFixed(1) + '%' : '—' }}</td>
                    <td>¥{{ fmt(t.amount) }}</td>
                    <td :class="t.hit ? 'dt-ok' : ''">¥{{ fmt(t.rebate) }}</td>
                    <td><span class="tag" :class="t.hit ? 'ok' : ''">{{ t.hit ? '命中' : '未命中' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="calcData.detail" class="dt-note">{{ calcData.detail }}</div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showCalc=false">关闭</button>
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
            <button class="btn-close" @click="showDetail=false"><Icon name="close"/></button>
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
                <div class="dt-item" v-if="detailRule.trigger_mode === 'tiered'"><span class="dt-l">计法</span><span class="dt-v">{{ detailRule.scale_type === 'graduated' ? '累进（分档累计）' : '全量按档' }}</span></div>
                <div class="dt-item" v-if="detailRule.trigger_mode === 'on_target'"><span class="dt-l">达成门槛</span><span class="dt-v">{{ thresholdText(detailRule) }}</span></div>
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
              <!-- 阶段2: 月度分解（金额层 + 返利层）明细 -->
              <table v-if="detailRule.is_monthly" class="dt-tier">
                <thead><tr><th>月份</th><th>目标金额</th><th>返利率</th></tr></thead>
                <tbody>
                  <tr v-for="mm in MONTHS_12" :key="mm">
                    <td>{{ mm }} 月</td>
                    <td>{{ detailRule.monthly_amounts && detailRule.monthly_amounts[mm] ? '¥' + fmt(detailRule.monthly_amounts[mm]) : '—' }}</td>
                    <td class="dt-ok">{{ detailRule.monthly_rates && detailRule.monthly_rates[mm] ? (detailRule.monthly_rates[mm] * 100).toFixed(1) + '%' : '—' }}</td>
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
            <button class="btn btn-ghost" @click="openRuleCalc(detailRule)">查看算式</button>
            <button class="btn btn-ghost" @click="showSimulate=true; showDetail=false">返利试算</button>
            <button class="btn btn-primary" @click="openEdit(detailRule); showDetail=false">编辑</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v112 R20：统一确认弹窗（替换原生 confirm，全站 Modal 风格一致；危险操作红色确认按钮） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="confirmState" class="modal-overlay" @click.self="confirmClose"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="confirmState" class="modal-card confirm-card">
          <div class="modal-hd"><b>{{ confirmState.title }}</b><button class="btn-close" @click="confirmClose"><Icon name="close"/></button></div>
          <div class="modal-body"><p class="cf-tip" style="margin:0;white-space:pre-line">{{ confirmState.message }}</p></div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="confirmClose">取消</button>
            <button class="btn btn-primary" :style="confirmState.danger ? 'background:var(--dan);border-color:rgba(var(--dan-rgb),.5)' : ''" @click="confirmOk">{{ confirmState.okText || '确定' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 规则冲突弹窗（409）：列出与已启用规则的冲突明细 + 解决建议 -->
    <Teleport to="body">
      <div v-if="conflictInfo" class="modal-overlay" @click.self="conflictInfo=null"></div>
      <Transition name="modal">
        <div v-if="conflictInfo" class="modal-card">
          <div class="modal-hd"><b>规则冲突，无法创建</b><button class="btn-close" @click="conflictInfo=null"><Icon name="close"/></button></div>
          <div class="modal-body">
            <p class="cf-tip">
              你正在为「<b>{{ conflictInfo.scopeName }}</b>」（{{ conflictInfo.dimension==='brand'?'品牌':'单品' }}维度）创建规则，<br>
              它在 <b>{{ conflictInfo.monthsText || '相同生效期' }}</b> 与下面这些 <b>已启用</b> 规则撞车了 ——
              同一品牌同一月份只能有一条目标，否则返利会被<b>重复计算</b>，因此被拦截：
            </p>
            <table class="tbl cf-tbl">
              <thead><tr><th>冲突规则</th><th>口径</th><th>冲突月份</th><th>生效期</th></tr></thead>
              <tbody>
                <tr v-for="c in conflictInfo.conflicts" :key="c.id">
                  <td>{{ c.rule_name }}</td>
                  <td>{{ c.period_type === 'year' ? '年度' : (c.period_type === 'month' ? '单期' : (c.period_type || '—')) }}</td>
                  <td class="cf-period"><b>{{ (c.months || []).join('、') || '—' }}</b></td>
                  <td class="cf-period">{{ c.effective_start || '不限' }} ~ {{ c.effective_end || '不限' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="cf-sol">解决方式（任选其一）：<br>
              ① 若新规则是<b>年度总纲</b>：先停用同品牌的各月单期规则，再保存（停用后月份立即释放）；<br>
              ② 若只想改某个月：直接 <b>编辑旧规则</b>，不要新建；<br>
              ③ 调整本规则的 <b>生效起止 / 目标年度</b>，避开上面列出的月份。</p>
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
            <div class="cf-wizard-actions">
              <button class="btn btn-ghost btn-xs" type="button" @click="quotePrevYear" title="复制上一年度同厂家/同品牌合同的配置">引用上一年度</button>
              <button class="btn btn-ghost btn-xs" type="button" @click="loadContractTemplate" title="套用上次保存的合同模板">引用模板</button>
            </div>
            <button class="btn-close" @click="contractFormOpen=false"><Icon name="close"/></button>
          </div>
          <!-- #357/§1.1 向导步骤条 -->
          <div class="cf-steps">
            <div class="cf-step" :class="{active: contractStep===1, done: contractStep>1}"><span>1</span>基本信息</div>
            <div class="cf-step" :class="{active: contractStep===2, done: contractStep>2}"><span>2</span>年度与比例</div>
            <div class="cf-step" :class="{active: contractStep===3, done: contractStep>3}"><span>3</span>月度分解</div>
            <div class="cf-step" :class="{active: contractStep===4, done: contractStep>4}"><span>4</span>预览确认</div>
          </div>
          <div class="modal-body">
            <!-- Step 1 基本信息 -->
            <div v-if="contractStep===1">
              <div class="form-row">
                <label class="cb-line">
                  <input type="checkbox" v-model="contractForm.byName">
                  合作方列表里没有这家？按名称直接录
                </label>
              </div>
              <div class="form-row" v-if="!contractForm.byName">
                <label>合作方（厂家）</label>
                <select v-model="contractForm.contact_id" class="input">
                  <option value="">— 选择 —</option>
                  <option v-for="o in contactOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
                <span v-if="!contactOptions.length" class="cf-hint" style="color:var(--dan);font-size:12px">未找到厂家档案，请在「档案管理 → 供应商」先录入厂家（如 蒙牛），或勾选上方按名称直录</span>
              </div>
              <div class="form-row" v-else>
                <label>合作方名称（直接填写）</label>
                <input v-model="contractForm.contact_name" class="input" placeholder="如 蒙牛低温奶事业部">
              </div>
              <div class="form-row">
                <label>品牌（可选）</label>
                <select v-model="contractForm.brand_id" class="input">
                  <option value="">— 选择已录入的品牌 —</option>
                  <option v-for="b in brandList" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
                <span v-if="!brandList.length" class="cf-hint" style="color:var(--war);font-size:12px">暂无品牌档案，可先到「档案管理 → 品牌档案」录入；不选品牌则合同视为覆盖全部品牌</span>
              </div>
            </div>
            <!-- Step 2 年度与比例 -->
            <div v-if="contractStep===2">
              <div class="form-grid2">
                <div class="form-row"><label>年度</label><input v-model="contractForm.year" class="input" placeholder="如 2026"></div>
                <div class="form-row"><label>返利比例</label><input v-model.number="contractForm.rebate_pct" class="input" type="number" min="0" step="0.1" placeholder="百分点，如 3 = 3%"></div>
              </div>
              <p class="cf-tip">阶梯 / 档位返利在「目标与返利」中按品牌、单品单独配置；此处填年度整体返利比例基准。</p>
            </div>
            <!-- Step 3 月度分解 -->
            <div v-if="contractStep===3">
              <div class="cf-mo-toolbar">
                <span class="cf-mo-label">月度目标（元）<span class="cf-mo-hint">空与 0 均视为无目标</span></span>
                <span class="cf-mo-avg">
                  <input v-model.number="cfAvgTarget" class="input input-sm" type="number" min="0" step="10000" placeholder="全年目标，用于平均填充">
                  <button class="btn btn-ghost btn-xs" type="button" @click="fillCreateAvg">平均填充</button>
                </span>
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
            <!-- Step 4 预览确认 -->
            <div v-if="contractStep===4">
              <div class="cf-review">
                <div class="cf-r-row"><span>合作方</span><b>{{ contractForm.byName ? contractForm.contact_name : contactNameById(contractForm.contact_id) }}</b></div>
                <div class="cf-r-row"><span>品牌</span><b>{{ brandNameById(contractForm.brand_id) }}</b></div>
                <div class="cf-r-row"><span>年度</span><b>{{ contractForm.year }}</b></div>
                <div class="cf-r-row"><span>返利比例</span><b>{{ rebatePctText(contractForm.rebate_pct) }}</b></div>
                <div class="cf-r-row"><span>全年目标</span><b>¥{{ fmt(contractYearSum) }}</b></div>
              </div>
              <p class="cf-tip">确认无误后点击「保存」。保存后可在年度合同列表展开「月度构成」继续用 #357 的分解方式微调。</p>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="contractFormOpen=false">取消</button>
            <span style="flex:1"></span>
            <button v-if="contractStep>1" class="btn btn-ghost" @click="contractStep--">上一步</button>
            <button v-if="contractStep<4" class="btn btn-primary" @click="nextContractStep">下一步</button>
            <button v-else class="btn btn-primary" @click="saveContract">保存</button>
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
            <button class="btn-close" @click="tierFormOpen=false"><Icon name="close"/></button>
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

    <!-- v114 (B2-1): 阶梯版本管理弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="versionModalOpen" class="modal-overlay" @click.self="versionModalOpen=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="versionModalOpen" class="modal-card" style="max-width:680px">
          <div class="modal-hd">
            <b>阶梯版本管理 · {{ versionRule ? versionRule.rule_name : '' }}</b>
            <button class="btn-close" @click="versionModalOpen=false"><Icon name="close"/></button>
          </div>
          <div class="modal-bd">
            <p class="cf-tip">按生效期锁定历史月份计提口径：计提某月时自动采用当时生效的版本阶梯，避免年中改阶梯后历史月份口径争议。</p>
            <div v-if="versionLoading" class="state-empty">加载中…</div>
            <div v-else-if="!versionList.length" class="state-empty"><p>暂无版本。点「新增版本」把当前阶梯快照为一版（可设生效期）。</p></div>
            <table v-else class="dt-tier" style="margin-top:8px">
              <thead><tr><th>版本</th><th>生效期</th><th>阶梯</th><th>计法</th><th></th></tr></thead>
              <tbody>
                <tr v-for="v in versionList" :key="v.id">
                  <td>v{{ v.version_no }}</td>
                  <td class="td-date">{{ v.effective_start || '—' }} ~ {{ v.effective_end || '—' }}</td>
                  <td>{{ tierCountOf(v.tiers_json) }} 档</td>
                  <td>{{ v.scale_type === 'graduated' ? '累进' : '全量按档' }}</td>
                  <td><button class="btn btn-ghost btn-xs danger" @click="deleteVersion(v)">删除</button></td>
                </tr>
              </tbody>
            </table>
            <div class="cf-mo-toolbar" style="margin-top:14px"><b>新增版本（快照当前阶梯）</b></div>
            <div class="form-row" style="margin-top:8px">
              <label>生效起</label>
              <input v-model="versionForm.effective_start" class="input" placeholder="2026-01-01" />
              <label>生效止</label>
              <input v-model="versionForm.effective_end" class="input" placeholder="2026-06-30（空=长期）" />
            </div>
            <div class="form-row" style="margin-top:8px">
              <label>备注</label>
              <input v-model="versionForm.note" class="input" placeholder="如：H1 旧政策" />
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="versionModalOpen=false">关闭</button>
            <button class="btn btn-primary" :disabled="versionSaving" @click="createVersion">{{ versionSaving ? '保存中…' : '新增版本' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { toast } from '../store'
import { rebateApi } from '../api/modules'
import { api } from '../api/client.js'
import TargetFormModal from '../components/rebate/TargetFormModal.vue'
import MonthlyAchvChart from '../components/rebate/MonthlyAchvChart.vue'
import { buildYearMatrix, buildSimItems, applySimResults } from '../components/rebate/useMonthlyAchv.js'

// v123：mainTab 提到最前 —— 上方的图表代码（watch/computed）会引用它，
// 定义靠后时一旦有顶层求值就会触发 TDZ「Cannot access 'mainTab' before initialization」
const mainTab = ref('dashboard')
const rules = ref([])
const loading = ref(false)
const filterDim = ref('')
const filterActive = ref('')
// v112 R10：按归属合同筛选规则
const filterContract = ref('')

const showForm = ref(false)
// v122 拆分：表单状态与逻辑已迁入 TargetFormModal，本页只留「打开模式 + 选中的规则」
const formMode = ref('create')      // 'create' | 'edit' | 'dup'
const formRule = ref(null)          // 编辑/复制时的原始规则对象
const formPresetDim = ref('brand')  // 新建时的预设维度（入口按钮决定）
// 规则阶梯档位编辑器（达成率分档，UI 用百分比，落库转小数；to_pct=0 表示无上限→哨兵 999）
const MONTHS_12 = ['01','02','03','04','05','06','07','08','09','10','11','12']


const showSimulate = ref(false)
const simRuleId = ref('')
const simActual = ref(null)
const simResult = ref(null)
const showDetail = ref(false)
const detailRule = ref(null)

// v113 §2.3（#354 透明化面板 / #355 试算器共用）：算式链 Modal
const showCalc = ref(false)
const calcData = ref(null)      // 归一化后的试算结果（带 steps[] / tiers[]）
const calcTitle = ref('')
// What-if 覆盖项（不落库，供试算器临时改计法/舍入看差异）
const simScaleOverride = ref('')
const simRoundingMode = ref('')
const simRoundingDigits = ref(2)
// 规则冲突（异常预警区用）
const conflicts = ref([])

// v112 R17①：试算弹窗选中规则后带出目标值/单位提示（分维度与周期口径）
const simRuleTarget = computed(() => {
  const r = rules.value.find(x => String(x.id) === String(simRuleId.value))
  if (!r) return ''
  const t = r.target_type === 'amount' ? '¥' + fmt(r.target_value) : r.target_value + ' 件'
  return `目标 ${t} · ${dimText(r.dimension)} · ${periodText(r.period_type)} · ${r.scope_name || '全部'}`
})
// #355：What-if 滑块上限（按选中规则目标值的 1.5 倍，至少 1）
const simSliderMax = computed(() => {
  const r = rules.value.find(x => String(x.id) === String(simRuleId.value))
  if (!r || !r.target_value) return 100000
  return Math.max(Number(r.target_value) * 1.5, 1)
})
// 选中规则名（试算结果标题用）
const simRuleName = computed(() => {
  const r = rules.value.find(x => String(x.id) === String(simRuleId.value))
  return r ? r.rule_name : ''
})
// 舍入对象 {mode, digits} → 文案
function roundingLabel(rd) {
  if (!rd) return '—'
  const m = { half_up: '四舍五入', up: '向上进位', down: '向下舍去' }[rd.mode] || rd.mode
  return m + (rd.digits != null ? (' · ' + rd.digits + ' 位') : '')
}

// 创建/更新规则被后端以 409 拦截（与已启用规则冲突）时，承载 conflicts 明细弹窗
const conflictInfo = ref(null)

// v112 R20：统一确认弹窗（危险操作红色按钮），替换原生 window.confirm
const confirmState = ref(null)
function openConfirm({ title, message, okText = '确定', danger = false, onOk }) {
  confirmState.value = { title, message, okText, danger, onOk }
}
function confirmClose() { confirmState.value = null }
function confirmOk() {
  const s = confirmState.value
  confirmState.value = null
  if (s && s.onOk) s.onOk()
}

// D4：品牌下拉候选（来自 brands 档案表），作用对象为品牌时提供候选 + 校验存在（决策：品牌必须先在档案创建）
const brandOptions = ref([])
// v113：品牌 id+name 列表（合同弹窗「品牌（可选）」下拉用；brandOptions 是 name 数组供规则弹窗 datalist 校验）
const brandList = ref([])
async function loadBrandOptions() {
  try {
    const list = await api('/api/brands?include_inactive=1')
    const arr = Array.isArray(list) ? list : (list.items || list.data || [])
    brandList.value = arr.map(b => ({ id: Number(b.id), name: String(b.name || '') })).filter(b => b.name)
    brandOptions.value = brandList.value.map(b => b.name)
  } catch (e) {}
}

// v113（对标国际 ERP 第一批 §1.3）：维度扩展 + 计法开关
// meta 承载枚举候选（维度 / 渠道 / 计法 / 舍入），前端直接消费，避免前后端各写一份。
const rebateMeta = ref({ data: {} })
async function loadRebateMeta() {
  try { rebateMeta.value = await api('/api/rebate-rules/meta') || { data: {} } } catch (e) {}
}
// v116 (L2)：全局默认到货周期（天）—— 规则未单独设到货周期时沿用；各品牌可在规则里单独覆盖
const defaultCadence = ref(2)
const cdnSaving = ref(false)
async function loadDefaultCadence() {
  try {
    const r = await api('/api/params')
    const d = (r && r.data) ? r.data : {}
    const c = parseInt(d.default_arrival_cadence_days, 10)
    defaultCadence.value = (Number.isFinite(c) && c > 0) ? c : 2
  } catch (e) { defaultCadence.value = 2 }
}
async function saveDefaultCadence() {
  const iv = Number(defaultCadence.value)
  if (!Number.isFinite(iv) || iv < 1 || iv > 30) { toast('到货周期默认天数须为 1-30 的整数', 'error'); return }
  cdnSaving.value = true
  try {
    await api('/api/params', { method: 'PUT', body: { default_arrival_cadence_days: iv } })
    toast('已保存全局默认到货周期', 'success')
  } catch (e) {
    toast('保存失败: ' + (e.message || ''), 'error')
  } finally {
    cdnSaving.value = false
  }
}

// v127：计算维度下拉已从创建弹窗移除（维度由入口按钮决定，后端锁定不可改）
// 计法候选（来自 meta.scale_options）
const scaleOptions = computed(() => (rebateMeta.value.data && rebateMeta.value.data.scale_options) || [
  { value: 'non_graduated', label: '全量按档' }, { value: 'graduated', label: '累进' },
])
// 舍入候选（来自 meta.rounding_options，What-if 试算器覆盖用）
const roundingOptions = computed(() => (rebateMeta.value.data && rebateMeta.value.data.rounding_options) || [
  { value: 'half_up', label: '四舍五入' }, { value: 'up', label: '向上进位' }, { value: 'down', label: '向下舍去' },
])

const filteredRules = computed(() => {
  return rules.value.filter(r => {
    if (filterDim.value && r.dimension !== filterDim.value) return false
    if (filterActive.value !== '' && String(r.is_active) !== filterActive.value) return false
    // v112 R10：contract_id=0 或缺失 = 独立规则（未挂合同），归入「独立规则」过滤组时同样可筛
    if (filterContract.value && String(r.contract_id || 0) !== String(filterContract.value)) return false
    return true
  })
})

function openCreate(presetDim) {
  formMode.value = 'create'
  formRule.value = null
  formPresetDim.value = presetDim || 'brand'
  showForm.value = true
}

function openEdit(r) {
  formMode.value = 'edit'
  formRule.value = { ...r }
  showForm.value = true
}

// v128：创建弹窗里点「编辑这条」—— 就地切到编辑该规则，弹窗不关（关了再开会像新建）
function onLoadExisting(r) {
  if (!r || !r.id) return
  formMode.value = 'edit'
  formRule.value = { ...r }
  showForm.value = true
}

// v112 R11：复制规则 —— 复制全部配置，清空生效期与 id（走新建）
function dup(r) {
  formMode.value = 'dup'
  formRule.value = { ...r }
  showForm.value = true
}

// 表单保存成功（由 TargetFormModal 回调）：关弹窗 + 刷新列表
async function onRuleSaved() {
  showForm.value = false
  await loadRules()
}

async function del(r) {
  // v112 R5/R20：删除=物理删除（含历史达成关联失效），停用请用「停用」按钮（可恢复）
  openConfirm({
    title: '物理删除规则',
    message: `确定「物理删除」规则「${r.rule_name}」吗？\n此操作不可恢复，历史达成关联将失效。\n如需暂时下线请用「停用」。`,
    okText: '物理删除', danger: true,
    onOk: async () => {
      try {
        await rebateApi.delete(r.id, true)
        toast('已删除', 'success')
        await loadRules()
      } catch (e) {
        toast('删除失败: ' + (e.message || ''), 'error')
      }
    },
  })
}

// v112 R5：停用=软删（is_active=0，列表可见可恢复）；启用=重新生效（若与现存启用规则冲突，后端 409 拦截）
async function toggleActive(r) {
  const next = r.is_active ? 0 : 1
  try {
    await rebateApi.update(r.id, { is_active: next })
    toast(next ? '已启用' : '已停用', 'success')
    await loadRules()
  } catch (e) {
    if (e.status === 409 && e.payload && Array.isArray(e.payload.conflicts) && e.payload.conflicts.length) {
      conflictInfo.value = {
        dimension: r.dimension,
        scopeName: r.scope_name || r.scope_key || '全部',
        // v125：冲突月份（跨「年度/单期」口径）
        monthsText: [...new Set((e.payload.conflicts || []).flatMap(c => c.months || []))].sort().join('、'),
        conflicts: e.payload.conflicts
      }
    } else {
      toast('操作失败: ' + (e.message || ''), 'error')
    }
  }
}

async function runSimulate() {
  if (!simRuleId.value || simActual.value == null || simActual.value === '') { toast('请选择规则并输入实际值', 'error'); return }
  try {
    const body = { rule_id: parseInt(simRuleId.value), actual_value: simActual.value }
    // #355 What-if：允许临时覆盖计法/舍入（不落库），看不同口径下返利差异
    if (simScaleOverride.value) body.scale_type = simScaleOverride.value
    if (simRoundingMode.value) body.rounding_mode = simRoundingMode.value
    if (simRoundingDigits.value != null && simRoundingDigits.value !== '') body.rounding_digits = Number(simRoundingDigits.value)
    const r = await rebateApi.simulate(body)
    // api() 已解开信封：r 即 data 载荷（含 steps[] / tiers[]）
    simResult.value = normalizeCalc(r)
  } catch (e) {
    toast('试算失败: ' + (e.message || ''), 'error')
  }
}

/* ---- v113 §2.3：算式链归一化 ----
 * /simulate（单条）与 /simulate-batch（批量）返回键名不一致：
 *   单条：rebate_amount / achievement / steps / tiers
 *   批量：rebate / achievement_pct / steps / tiers
 * 统一归一成前端渲染用的规范形状，避免模板里两套键名散落。
 */
function normalizeCalc(d) {
  if (!d) return null
  return {
    ruleName: d.rule_name || d.name || '',
    targetType: d.target_type || '',
    targetValue: d.target_value != null ? d.target_value : null,
    basisValue: d.basis_value != null ? d.basis_value : null,
    achievementPct: d.achievement_pct != null ? d.achievement_pct
      : (d.achievement != null ? d.achievement : null),
    triggered: d.triggered,
    rebate: d.rebate != null ? d.rebate : (d.rebate_amount != null ? d.rebate_amount : 0),
    rawRebate: d.raw_rebate != null ? d.raw_rebate : null,
    effectiveRate: d.effective_rate != null ? d.effective_rate : null,
    marginalRate: d.marginal_rate != null ? d.marginal_rate : null,
    scaleType: d.scale_type || '',
    scaleLabel: d.scale_label || '',
    rounding: d.rounding || null,
    detail: d.detail || d.note || '',
    steps: Array.isArray(d.steps) ? d.steps : [],
    tiers: Array.isArray(d.tiers) ? d.tiers : [],
  }
}

// 打开透明化算式链 Modal（d 为原始试算结果，内部归一化）
function openCalc(d, title) {
  const n = normalizeCalc(d)
  if (!n) { toast('暂无试算数据，请先在仪表盘/试算器生成', 'warn'); return }
  calcData.value = n
  calcTitle.value = title || n.ruleName || '返利算式'
  showCalc.value = true
}
// 规则列表/详情的「查看算式」：以 100% 达成（target_value）为例跑一次单条试算，再看算式
async function openRuleCalc(r) {
  try {
    const d = await rebateApi.simulate({ rule_id: r.id, actual_value: Number(r.target_value) || 0 })
    openCalc(d, r.rule_name)
  } catch (e) {
    toast('算式生成失败: ' + (e.message || ''), 'error')
  }
}
// 规则冲突加载（异常预警区用）；/conflicts 返回 { success, data:[...] }，api 解开后 d 可能是数组或对象
async function loadConflicts() {
  try {
    const d = await rebateApi.conflicts()
    conflicts.value = Array.isArray(d) ? d
      : (d && Array.isArray(d.conflicts)) ? d.conflicts
      : (d && d.data && Array.isArray(d.data)) ? d.data
      : []
  } catch (e) { conflicts.value = [] }
}
// 异常预警区：从仪表盘结构 + 冲突规则聚合
const anomalies = computed(() => {
  // v123：按图表品牌筛选收窄（无筛选时等于全量）
  const items = dashItemsFiltered.value
  const list = []
  const noData = items.filter(it => it.reported === 0 && it.level !== 'done')
  if (noData.length) list.push({ type: 'nodata', level: 'warn', text: `${noData.length} 个生效目标本月尚未填报达成（进度按 0% 显示）`, items: noData.map(it => it.rule.rule_name) })
  const risk = items.filter(it => it.level === 'risk')
  if (risk.length) list.push({ type: 'risk', level: 'dan', text: `${risk.length} 个目标预计月底不达标，建议补单或催回款`, items: risk.map(it => it.rule.rule_name) })
  // v125：判重口径升级为「覆盖月份交集」——同品牌同月存在两条目标（含"单期 vs 年度"）
  if (conflicts.value.length) list.push({
    type: 'conflict', level: 'dan',
    text: `${conflicts.value.length} 组目标在同一品牌同一月份重复（返利会被重复计算，新建同月目标会被拦截）`,
    items: conflicts.value.map(c => {
      // /conflicts 返回「冲突对」{a, b, months}
      const ms = c.months || []
      const na = (c.a && c.a.rule_name) || (c.rule_name) || ('规则#' + (c.a && c.a.id))
      const nb = (c.b && c.b.rule_name) || ('规则#' + (c.b && c.b.id))
      return `${na} × ${nb}` + (ms.length ? `（${ms.join('、')}）` : '')
    }),
  })
  return list
})

// v123：图表筛选后，预警区与条形排行同步收窄（KPI 卡保持全量，不受影响）
const dashItemsFiltered = computed(() => {
  const m = dashboardModel.value
  if (!m || !Array.isArray(m.items)) return []
  const sel = (chartBrandSel.value || []).filter(Boolean)
  if (!sel.length) return m.items
  const set = new Set(sel)
  return m.items.filter(it => {
    const nm = String(it.rule?.scope_name || it.rule?.scope_key || '')
    return set.has(nm) || set.has(String(it.rule?.scope_key || ''))
  })
})

/* ===================== v123：全年月度达成柱状图 =====================
   口径：销量达成取「达成填报」rebate_achievements；没填的月份就是 0，不插值。
   返利一律由后端 simulate-batch 产出，前端不镜像算法。                    */
const chartYear = ref(String(new Date().getFullYear()))
const chartBrandSel = ref([])      // 空 = 全部品牌
const yearAchv = ref([])           // 全年达成（与单月 achievements 分开，互不污染）
const chartLoading = ref(false)
const chartMatrix = ref(null)
let _chartSeq = 0

const chartYearOptions = computed(() => {
  const set = new Set([Number(chartYear.value), new Date().getFullYear()])
  for (const r of (rules.value || [])) {
    const y = Number(r.target_year)
    if (y >= 2000 && y <= 2100) set.add(y)
    const s = String(r.effective_start || '').slice(0, 4)
    if (/^\d{4}$/.test(s)) set.add(Number(s))
  }
  return [...set].sort((a, b) => b - a)
})

// 品牌候选 = 品牌档案 ∪ 规则里实际出现的品牌名。
// 只用档案会漏：历史规则的 scope_name 是自由文本（如「蒙牛低温」），与档案名不一定一致。
const chartBrandList = computed(() => {
  const set = new Set()
  for (const b of (brandList.value || [])) if (b && b.name) set.add(String(b.name))
  for (const r of (rules.value || [])) {
    if (r.dimension !== 'brand') continue
    const nm = String(r.scope_name || r.scope_key || '').trim()
    if (nm) set.add(nm)
  }
  return [...set].map(name => ({ id: name, name }))
})

const chartBase = computed(() => buildYearMatrix({
  year: chartYear.value,
  rules: rules.value || [],
  achievements: yearAchv.value || [],
  brandSel: chartBrandSel.value || [],
}))

async function loadYearAchv() {
  chartLoading.value = true
  try {
    const d = await api('/api/rebate-achievements?year=' + encodeURIComponent(chartYear.value))
    const list = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : [])
    yearAchv.value = list
  } catch (e) {
    yearAchv.value = []
  } finally {
    chartLoading.value = false
  }
}

// 返利试算：每月每条规则两档（目标档 / 达成档），一次请求带 item 级 ref_date
async function runChartSim() {
  const base = chartBase.value
  if (!base || !base.hasAny) { chartMatrix.value = base; return }
  const seq = ++_chartSeq
  const { items, keys } = buildSimItems(base)
  if (!items.length) { chartMatrix.value = base; return }
  try {
    const res = await rebateApi.simulateBatch({ items })
    if (seq !== _chartSeq) return
    const m = JSON.parse(JSON.stringify(base))
    applySimResults(m, (res && res.results) || [], keys)
    chartMatrix.value = m
  } catch (e) {
    // 试算失败也要显示销量，返利降为 0，不整块空白
    if (seq === _chartSeq) chartMatrix.value = base
  }
}

let _chartTimer = null
function scheduleChart() {
  if (mainTab.value !== 'dashboard') return
  clearTimeout(_chartTimer)
  _chartTimer = setTimeout(() => { loadYearAchv(); runChartSim() }, 200)
}
function onChartYear(y) { chartYear.value = String(y); scheduleChart() }
// 注意：mainTab 定义在下方，必须用 getter 惰性取值，直接写 mainTab 会触发 TDZ
watch([chartYear, chartBrandSel, () => rules.value, () => mainTab.value], scheduleChart)
watch(yearAchv, runChartSim)

async function loadRules() {
  loading.value = true
  try {
    // v112 R5：include_inactive=1 —— 停用规则也要加载，否则无法恢复/筛选「已停用」
    const d = await rebateApi.list(1)
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
// v112 R25：长金额缩写 —— ≥1亿 显示「1.2亿」、≥1万 显示「1.2万」，防 KPI 卡溢出
function fmtShort(n) {
  if (n == null) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万'
  return fmt(v)
}
// v112 R41：状态直接消费后端返回的 status（服务端日期判定，跨时区/改时钟不再漂移）；
// 老后端/无字段时按 is_active 兜底。
function statusOf(r) {
  const map = {
    inactive: { cls: '', text: '停用' },
    upcoming: { cls: 'warn', text: '未开始' },
    active: { cls: 'ok', text: '进行中' },
    expired: { cls: '', text: '已结束' },
  }
  return map[r.status] || (r.is_active ? map.active : map.inactive)
}
function openDetail(r) { detailRule.value = r; showDetail.value = true }
// v112 R43：threshold 展示侧 clamp 到 (0,1]，防绕过 API 直插越界数据导致显示/判断错乱
function thresholdText(r) {
  const t = Number(r.trigger_threshold) || 1
  const c = Math.min(1, Math.max(0.01, t))
  return (c * 100).toFixed(0) + '%'
}
function tierList(r) {
  try {
    const a = typeof r.tiers_json === 'string' ? JSON.parse(r.tiers_json) : (r.tiers_json || [])
    return Array.isArray(a) ? a : []
  } catch (e) { return [] }
}

/* ---- 达成填报 Tab（v109：无 API / 手动上传客户的达成数据入口） ---- */
const achvMonth = ref(new Date().toISOString().slice(0, 7))
// v112 R2：达成填报支持月/季/年三种周期口径，月份选择器按口径切换键格式（YYYY-MM / YYYY-Qn / YYYY）
const achvPeriod = ref('month')
const dashMonth = ref(new Date().toISOString().slice(0, 7))
const achievements = ref([])
const achvRows = ref([])
const achvLoading = ref(false)
const achvImpOpen = ref(false)
const achvImpFile = ref(null)
const achvImpFileName = ref('')
const achvImporting = ref(false)
// v112 R34：导入干跑预览结果（{imported, skipped, errors}），确认后才真正导入
const achvPreview = ref(null)

const achvFilledCount = computed(() => achvRows.value.filter(r => r.achId).length)

// v112 R39：product 维度「名称/条码 → 商品 ID」映射 —— Excel 导入未匹配到商品档案时
// 达成行 scope_key 是原文（名称/条码），与规则的 scope_key（商品 ID）不一致导致行不合并、
// 仪表盘算不到该规则。这里用商品主档补齐映射，让两边键对齐。
const productRefs = ref({ byName: new Map(), byBarcode: new Map() })
// v122：商品名候选（规则弹窗「作用对象」datalist 用）—— 之前商品维度候选为空，用户只能手填商品 ID
const productNames = ref([])
async function loadProductRefs() {
  try {
    const d = await api('/api/products/grid')
    const items = Array.isArray(d) ? d : (d.items || [])
    const byName = new Map(), byBarcode = new Map()
    const names = []
    for (const p of items) {
      const pid = String(p.id)
      if (p.name) {
        byName.set(String(p.name).trim().toLowerCase(), pid)
        const nm = String(p.name).trim()
        if (nm) names.push(nm)
      }
      if (p.barcode) byBarcode.set(String(p.barcode).trim(), pid)
    }
    productRefs.value = { byName, byBarcode }
    productNames.value = names
  } catch (e) { /* 映射加载失败不阻塞，键保持原文 */ }
}
function resolveProductKey(key) {
  const s = String(key ?? '').trim()
  if (/^\d+$/.test(s)) return s // 已是商品 ID
  const { byName, byBarcode } = productRefs.value
  if (!byName.size) return s
  return byBarcode.get(s) || byName.get(s.toLowerCase()) || s
}

async function switchTab(t) {
  // v112 R16：达成填报 ↔ 仪表盘月份联动（仅月口径同步；季/年键会破坏仪表盘 YYYY-MM 格式，不同步）
  if (t === 'dashboard' && achvPeriod.value === 'month') dashMonth.value = achvMonth.value
  else if (t === 'achv' && achvPeriod.value === 'month') achvMonth.value = dashMonth.value
  mainTab.value = t
  if (t === 'achv') await loadAchievements(achvMonth.value)
  else if (t === 'dashboard') await loadAchievements(dashMonth.value)
  else if (t === 'contracts') await loadContracts()
}

// 规则是否在指定月份（YYYY-MM）生效：生效期缺省=长期有效；与仪表盘后端口径一致
function ruleEffectiveInMonth(rule, m) {
  if (!m) return true
  const s = rule.effective_start ? String(rule.effective_start).slice(0, 7) : ''
  const e = rule.effective_end ? String(rule.effective_end).slice(0, 7) : ''
  if (s && s > m) return false
  if (e && e < m) return false
  return true
}

/** 把「启用中的目标规则」与「已填报达成」合并成可编辑行。
 *  仅纳入生效期覆盖所选月份的启用规则；无对应规则的达成行（用户已手动录入）仍保留，否则导入数据会"看不见"。 */
function buildAchvRows() {
  const byKey = new Map()
  for (const r of rules.value.filter(x => x.is_active && ruleEffectiveInMonth(x, achvMonth.value))) {
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
    // v112 R39：product 维度先把 名称/条码 解析成商品 ID，再与规则 key 匹配合并
    let sk = a.scope_key || ''
    if (a.dimension === 'product') sk = resolveProductKey(sk)
    const key = `${a.dimension}::${sk}`
    const hit = byKey.get(key)
    if (hit) {
      hit.achId = a.id
      hit.achAmount = a.actual_amount
      hit.achQty = a.actual_qty
      hit.source = a.source
      hit.note = a.note || ''
    } else {
      byKey.set(key, {
        key, dimension: a.dimension, scope_key: sk,
        scope_name: a.scope_name || sk,
        target_type: '', target_value: 0,
        achId: a.id, achAmount: a.actual_amount, achQty: a.actual_qty,
        source: a.source, note: a.note || '',
      })
    }
  }
  achvRows.value = [...byKey.values()]
}

// v112 R2：切换周期口径时重置默认周期键（月=当前月 / 季=当前季度 / 年=当前年）
function onAchvPeriod() {
  const d = new Date()
  if (achvPeriod.value === 'quarter') achvMonth.value = d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1)
  else if (achvPeriod.value === 'year') achvMonth.value = String(d.getFullYear())
  else achvMonth.value = d.toISOString().slice(0, 7)
  loadAchievements()
}
// v112 R2：文本输入（季度/年度键）变更后刷新列表；后端 _norm_month 已兼容 2026Q3/2026-Q3/2026
function onAchvPeriodInput() {
  loadAchievements()
}

// v112 R15：仪表盘/达成填报切月份竞态保护 —— 旧请求晚返回不覆盖新月份
let achvReqSeq = 0
async function loadAchievements(month) {
  const m = month || achvMonth.value
  const seq = ++achvReqSeq
  achvLoading.value = true
  try {
    const list = await api('/api/rebate-achievements?month=' + encodeURIComponent(m))
    if (seq !== achvReqSeq) return // 已有更新的请求发出，丢弃本次旧结果
    achievements.value = Array.isArray(list) ? list : []
  } catch (e) {
    if (seq !== achvReqSeq) return
    achievements.value = []
    toast('达成数据加载失败: ' + (e.message || ''), 'error')
  } finally {
    if (seq === achvReqSeq) {
      achvLoading.value = false
      buildAchvRows()
    }
  }
}

// v112 R14：行内编辑 300ms 防抖（连续改多个单元格只发一次请求）+ 行级保存中禁用 + 失败还原原值、新值保留供「点击重试」
const achvTimers = {}
const achvSaving = ref({})
const achvFail = ref({})
async function saveAchv(row) {
  // v112 R45：显式 0 视为有效达成（用户可能想记录"本月为 0"），仅双输入都为 null/空才不落库
  if (!row.achId && row.achAmount == null && row.achQty == null) { row.__orig = null; row.__pending = null; return }
  // 首次编辑该行时记录原值快照（失败还原基准），已有快照则保留
  if (row.__orig == null) row.__orig = { achAmount: row.achAmount, achQty: row.achQty }
  row.__pending = { achAmount: row.achAmount, achQty: row.achQty }
  delete achvFail.value[row.key]
  clearTimeout(achvTimers[row.key])
  achvTimers[row.key] = setTimeout(() => doSaveAchv(row), 300)
}
async function doSaveAchv(row) {
  const p = row.__pending || { achAmount: row.achAmount, achQty: row.achQty }
  if (!row.achId && p.achAmount == null && p.achQty == null) { row.__orig = null; row.__pending = null; return }
  const amount = Number(p.achAmount) || 0
  const qty = Number(p.achQty) || 0
  achvSaving.value[row.key] = true
  try {
    const r = await api('/api/rebate-achievements', {
      method: 'POST',
      body: {
        period_month: achvMonth.value,
        dimension: row.dimension,
        scope_key: row.scope_key,
        scope_name: row.scope_name,
        actual_amount: amount,
        actual_qty: qty,
        source: 'manual',
        note: row.note || '',
      },
    })
    if (r && r.item) { row.achId = r.item.id; row.source = r.item.source }
    // 保存成功：把最终落库值写回行（含重试场景，input 显示最终值）
    row.achAmount = amount
    row.achQty = qty
    row.__orig = null
    row.__pending = null
    delete achvFail.value[row.key]
    toast('已保存', 'success')
  } catch (e) {
    // 失败还原原值；用户改过的新值保留在 __pending，点「点击重试」用新值再发
    if (row.__orig) { row.achAmount = row.__orig.achAmount; row.achQty = row.__orig.achQty }
    achvFail.value[row.key] = true
    toast('保存失败: ' + (e.message || ''), 'error')
  } finally {
    achvSaving.value[row.key] = false
  }
}
// 失败后点击重试：以 __pending（用户改过的新值）再次提交
function retryAchv(row) {
  if (row.__orig == null && row.__pending == null) row.__pending = { achAmount: row.achAmount, achQty: row.achQty }
  doSaveAchv(row)
}

async function delAchv(row) {
  if (!row.achId) return
  // v112 R20：统一确认弹窗
  openConfirm({
    title: '清除达成数据',
    message: `确认清除「${row.scope_name}」${achvMonth.value} 的达成数据？\n清除后该行恢复为未填报。`,
    okText: '清除', danger: true,
    onOk: async () => {
      try {
        await api('/api/rebate-achievements/' + row.achId, { method: 'DELETE' })
        row.achId = null; row.achAmount = null; row.achQty = null; row.source = ''
        delete achvFail.value[row.key]
        toast('已清除', 'success')
      } catch (e) {
        toast('清除失败: ' + (e.message || ''), 'error')
      }
    },
  })
}

function onAchvFile(e) {
  const f = e.target.files?.[0] || null
  achvImpFile.value = f
  achvImpFileName.value = f?.name || ''
  achvPreview.value = null // v112 R34：换文件后旧预览失效
}

// v112 R34：干跑校验预览（后端 preview=1 不落库，返回可导入行数与逐行提示）
async function previewAchvImport() {
  if (!achvImpFile.value) return
  achvImporting.value = true
  try {
    const fd = new FormData()
    fd.append('file', achvImpFile.value)
    fd.append('month', achvMonth.value)
    fd.append('preview', '1')
    const r = await api('/api/rebate-achievements/import', { method: 'POST', raw: true, body: fd, timeout: 60000 })
    achvPreview.value = r || {}
    const errs = (r?.errors || []).length
    if (errs) toast(`预览完成：${r?.imported ?? 0} 行可导入，${errs} 处提示`, 'warn')
    else toast(`预览完成：${r?.imported ?? 0} 行可导入`, 'success')
  } catch (e) {
    toast('预览失败: ' + (e.message || ''), 'error')
  } finally {
    achvImporting.value = false
  }
}

async function runAchvImport() {
  if (!achvImpFile.value) return
  achvImporting.value = true
  try {
    const fd = new FormData()
    fd.append('file', achvImpFile.value)
    fd.append('month', achvMonth.value)
    // v112 R35：10MB Excel 解析 + upsert 在低配服务器可能超 20s 默认超时，显式放宽到 60s
    const r = await api('/api/rebate-achievements/import', { method: 'POST', raw: true, body: fd, timeout: 60000 })
    const errs = r?.errors || []
    if (errs.length) toast(`导入完成 ${r?.imported ?? 0} 行，${errs.length} 处提示`, 'warn')
    else toast(`导入完成：${r?.imported ?? 0} 行`, 'success')
    achvImpOpen.value = false
    achvImpFile.value = null
    achvImpFileName.value = ''
    achvPreview.value = null
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

/* ---- v113：返利金额一律由后端计算 ----
 * 历史债：此处曾有 computeRebateFront（后端算法的镜像实现，v112 R40 已记录必然漂移）。
 * v113 起彻底删除 —— 前端只做「结构性」计算（达成率 / 档位边界 / 时间进度），
 * 涉及钱的一律走 POST /api/rebate-rules/simulate-batch，渲染后端返回的 steps[] / tiers[]。
 * 口径契约用例：server/tests/fixtures/rebate_cases.json（前后端 + 生产 E2E 共用同一份）。
 */
const simResults = ref({})   // { '<ruleId>::cur' | '<ruleId>::next': 后端试算结果 }
const simLoading = ref(false)
const simError = ref('')
function simKey(ruleId, tag) { return `${ruleId}::${tag || 'cur'}` }

async function runDashboardSim() {
  const base = dashBase.value
  if (!base || !base.items.length) { simResults.value = {}; simError.value = ''; return }
  const items = []
  const keys = []
  for (const it of base.items) {
    items.push({ rule_id: it.rule.id, basis_value: it.reported })
    keys.push(simKey(it.rule.id, 'cur'))
    if (it.nextTierBasis != null) {
      items.push({ rule_id: it.rule.id, basis_value: it.nextTierBasis })
      keys.push(simKey(it.rule.id, 'next'))
    }
  }
  simLoading.value = true
  simError.value = ''
  try {
    const res = await rebateApi.simulateBatch({ items })
    // api() 已解开信封：res 即 { results, total_rebate, count }（注意不是 res.data.results）
    const rows = (res && Array.isArray(res.results)) ? res.results : []
    const map = {}
    rows.forEach((r, i) => { if (r && r.ok !== false) map[keys[i]] = r })
    simResults.value = map
  } catch (e) {
    simError.value = '返利试算失败：' + (e.message || '')
  } finally {
    simLoading.value = false
  }
}

// 依赖变化（月份 / 达成填报 / 规则集）后重算，防抖 200ms 避免逐行输入打接口
let _simTimer = null
function scheduleDashSim() {
  if (mainTab.value !== 'dashboard') return
  clearTimeout(_simTimer)
  _simTimer = setTimeout(runDashboardSim, 200)
}
watch([dashMonth, rules, achievements, mainTab], scheduleDashSim)

function fmtByType(v, tt) {
  if (v == null || v === '') return '—'
  return tt === 'amount' ? '¥' + fmt(v) : fmt(v) + ' 件'
}
function pctText(x) { return (Number(x) * 100).toFixed(1) + '%' }

// 结构层：只算达成率 / 档位边界 / 时间进度，不含任何金额计算
const dashBase = computed(() => {
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
    // v112 R39：与 buildAchvRows 同口径 —— product 维度先解析 名称/条码 → 商品 ID
    const sk = a.dimension === 'product' ? resolveProductKey(a.scope_key) : String(a.scope_key ?? '')
    achvMap.set(`${a.dimension}::${sk}`, a)
  }
  const activeRules = (rules.value || []).filter(r => ruleActiveInMonth(r, month))
  const items = []
  let done = 0, risk = 0, achSum = 0
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
    // 档位进度（纯结构性，不涉及金额）
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
    // 达下一档所需的达成基数（交给后端试算「下一档能拿多少」）
    const nextTierBasis = nextTierPct != null ? target * nextTierPct : null
    // 节奏 / 预警
    const pace = elapsed > 0 ? reported / elapsed : 0
    const predicted = reported + pace * daysLeft
    const willHit = target > 0 ? predicted >= target : true
    let level = 'ontrack'
    if (ach >= 1) { level = 'done'; done++ }
    else if (!willHit) { level = 'risk'; risk++ }
    achSum += ach
    items.push({
      rule: r,
      dimLabel: dimText(r.dimension),
      scope: r.scope_name || scope || '全部',
      target, targetType: r.target_type,
      reported, ach, gap, nextTierBasis,
      targetText: fmtByType(target, r.target_type),
      reportedText: fmtByType(reported, r.target_type),
      gapText: fmtByType(gap, r.target_type),
      achPct: pctText(ach),
      curTierPct: pctText(curTierPct),
      nextTierPct: nextTierPct != null ? pctText(nextTierPct) : null,
      toNextGapPct: (toNextGap * 100).toFixed(1) + ' 个百分点',
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
      noData: activeRules.length > 0 && items.every(it => it.reported === 0),
      timeProgressPct: pctText(timeProgress),
      timeLabel,
      tpShown: timeProgress > 0 && timeProgress < 1,
      timeProgress,
    }
  }
})

// 展示层：把后端试算结果合并进结构层（钱 = 后端算，前端只渲染）
const dashboardModel = computed(() => {
  const base = dashBase.value
  if (!base) return null
  const items = base.items.map(it => {
    const cur = simResults.value[simKey(it.rule.id, 'cur')] || null
    const nxt = simResults.value[simKey(it.rule.id, 'next')] || null
    const estRebate = cur ? (cur.rebate || 0) : 0
    const estRebateNext = nxt ? (nxt.rebate || 0) : estRebate
    return {
      ...it,
      estRebate,
      estRebateNext,
      simReady: !!cur,
      simData: cur,
      triggered: cur ? !!cur.triggered : false,
      effectiveRate: cur && cur.effective_rate != null ? (cur.effective_rate * 100).toFixed(2) + '%' : '—',
    }
  })
  // 未拿到后端结果前不报总数（避免显示出一个"少算"的错数）
  const allReady = items.length > 0 && items.every(it => it.simReady)
  return {
    items,
    summary: {
      ...base.summary,
      simReady: allReady,
      totalEstRebate: allReady ? items.reduce((s, it) => s + (it.estRebate || 0), 0) : 0,
    },
  }
})

async function onDashMonth() { await loadAchievements(dashMonth.value) }

/* ---- 年度合同返利（rebate_contracts）并入目标与返利：展示 + 录入 ---- */
const contracts = ref([])
const contractLoading = ref(false)
const contractFormOpen = ref(false)
const editingContractId = ref(null)
const contractForm = ref({ contact_id: '', contact_name: '', byName: false, year: String(new Date().getFullYear()), months: {}, rebate_pct: 0, orig_target: 0, brand_id: '' })
const contractStep = ref(1)        // §1.1 向导步骤 1~4
const cfAvgTarget = ref(null)      // §1.1 创建态：平均填充用的全年目标输入
const CONTRACT_TPL_KEY = 'hergent_contract_tpl'
const contactOptions = ref([])
// v112 R13：录入/编辑合同弹窗月度网格折叠开关（默认展开；避免长表单底部按钮不可见）
const contractMoCollapsed = ref(false)
// v112 R12：合同搜索（名称 / 年度）
const contractSearch = ref('')
const filteredContracts = computed(() => {
  const q = contractSearch.value.trim().toLowerCase()
  if (!q) return contracts.value
  return contracts.value.filter(c =>
    String(contractName(c)).toLowerCase().includes(q) ||
    String(c.year || '').includes(q))
})

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
    await loadClaims().catch(() => {})
  }
}
// v114 (B2-2): 加载全部申领状态映射（合同卡片徽标 + 申领/审核按钮用）
async function loadClaims() {
  const cl = await api('/api/rebate-claims')
  const m = {}
  for (const x of (Array.isArray(cl) ? cl : [])) if (x && x.contract_id != null) m[x.contract_id] = x
  claimMap.value = m
}
async function loadContactOptions() {
  // v113：合同合作方只选厂家（供应商），不混客户——contacts 接口服务端按 type=supplier 过滤；
  // 兼容 items / data / 裸数组三种信封结构（老接口返回 {items:[...]} 分页结构）。
  try {
    const list = await api('/api/contacts?limit=300&type=supplier')
    const arr = Array.isArray(list) ? list : (list.items || list.data || [])
    contactOptions.value = arr.filter(o => o && (o.type === 'supplier' || o.type === 'both') && o.is_active !== 0)
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
/* ---- §1.1 向导：步骤导航 + 引用上年/模板 ---- */
function contactNameById(id) {
  const o = (contactOptions.value || []).find(x => String(x.id) === String(id))
  return o ? o.name : '—'
}
function brandNameById(id) {
  if (!id) return '全部品牌'
  const b = (brandList.value || []).find(x => String(x.id) === String(id))
  return b ? b.name : ('品牌 #' + id)
}
function nextContractStep() {
  const f = contractForm.value
  if (contractStep.value === 1) {
    if (!f.byName && !f.contact_id) { toast('请选择合作方（厂家）', 'error'); return }
    if (f.byName && !String(f.contact_name || '').trim()) { toast('请填写合作方名称', 'error'); return }
  }
  if (contractStep.value === 2) {
    if (!String(f.year || '').trim()) { toast('请填写年度', 'error'); return }
    if (Number(f.rebate_pct) < 0) { toast('返利比例不能为负', 'error'); return }
  }
  if (contractStep.value < 4) contractStep.value++
}
function fillCreateAvg() {
  const t = Number(cfAvgTarget.value) || 0
  if (t <= 0) { toast('请先填「全年目标」再平均填充', 'warn'); return }
  const f = contractForm.value
  const y = String(f.year || new Date().getFullYear()).trim()
  const each = Math.floor(t / 12)
  const m = buildMonthsMap(y)
  for (let i = 1; i <= 12; i++) m[`${y}-${String(i).padStart(2, '0')}`] = each
  m[`${y}-12`] = each + (t - each * 12)
  f.months = m
  toast('已按全年目标 ¥' + fmt(t) + ' 平均填充 12 个月', 'success')
}
async function quotePrevYear() {
  const f = contractForm.value
  const list = contracts.value || []
  const baseYear = Number(f.year) || new Date().getFullYear()
  const cands = list.filter(x => Number(x.year) < baseYear)
  if (!cands.length) { toast('未找到更早的年度合同可引用', 'warn'); return }
  let prev = null
  if (f.brand_id) prev = cands.find(x => x.brand_id === f.brand_id)
  if (!prev && f.contact_id) prev = cands.find(x => Number(x.contact_id) === Number(f.contact_id))
  if (!prev && f.byName && f.contact_name) prev = cands.find(x => (x.contact_name || '').trim() === String(f.contact_name).trim())
  if (!prev) prev = cands.slice().sort((a, b) => Number(b.year) - Number(a.year))[0]
  if (!prev) { toast('未找到更早的年度合同可引用', 'warn'); return }
  try {
    const d = await api('/api/rebate-contracts/' + prev.id + '/months')
    const months = buildMonthsMap(String(baseYear))
    for (const row of (d.months || [])) {
      const mm = String(baseYear) + '-' + String(row.month || '').slice(-2)
      if (mm in months) months[mm] = Number(row.target_amount) || 0
    }
    f.contact_id = prev.contact_id || ''
    f.contact_name = prev.contact_name || ''
    f.byName = !!(prev.contact_name && !prev.contact_id)
    f.brand_id = prev.brand_id != null ? String(prev.brand_id) : ''
    f.rebate_pct = Number(prev.rebate_pct) || 0
    f.year = String(baseYear)
    f.months = months
    contractStep.value = 3
    toast('已引用 ' + prev.year + ' 年度合同配置（' + (prev.contact_name || contactNameById(prev.contact_id)) + '）', 'success')
  } catch (e) {
    toast('引用失败: ' + (e.message || ''), 'error')
  }
}
function saveContractTemplate() {
  try {
    const f = contractForm.value
    const tpl = { byName: f.byName, contact_id: f.contact_id, contact_name: f.contact_name, brand_id: f.brand_id, rebate_pct: f.rebate_pct }
    localStorage.setItem(CONTRACT_TPL_KEY, JSON.stringify(tpl))
  } catch (e) {}
}
function loadContractTemplate() {
  try {
    const raw = localStorage.getItem(CONTRACT_TPL_KEY)
    if (!raw) { toast('暂无保存的合同模板', 'warn'); return }
    const t = JSON.parse(raw)
    const f = contractForm.value
    f.byName = !!t.byName
    f.contact_id = t.contact_id || ''
    f.contact_name = t.contact_name || ''
    f.brand_id = t.brand_id != null ? String(t.brand_id) : ''
    f.rebate_pct = Number(t.rebate_pct) || 0
    toast('已套用合同模板', 'success')
  } catch (e) { toast('模板读取失败', 'error') }
}
function openCreateContract() {
  const year = String(new Date().getFullYear())
  contractForm.value = { contact_id: '', contact_name: '', byName: false, year, months: buildMonthsMap(year), rebate_pct: 0, orig_target: 0, brand_id: '' }
  editingContractId.value = null
  contractMoCollapsed.value = false
  contractStep.value = 1
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
    brand_id: c.brand_id != null && c.brand_id ? String(c.brand_id) : '',
  }
  editingContractId.value = c.id
  contractMoCollapsed.value = false
  contractStep.value = 1
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
    // v112 R6：未填写过的月份（空串）不提交 —— 避免"1 月填 10 万、其余 11 个月未填当 0 提交"，
    // 把老合同年度目标（如 108 万）静默压成"已填月份之和"（10 万）。
    // 显式输入 0 的月份（raw 为数字 0）仍会提交，保证"清空某月目标"可生效。
    if (raw === null || raw === undefined || raw === '') continue
    let v = Number(raw)
    if (!Number.isFinite(v)) { toast(`「${i}月」目标必须是数字`, 'error'); return }
    if (v < 0) { toast(`「${i}月」目标不能为负数`, 'error'); return }
    months.push({ month: key, target_amount: v })
    sum += v
  }
  // 编辑老合同防误清零：全部月空/0 且原目标 >0 → 保留原全年目标，不写月度分解
  const hasPositive = months.some(m => m.target_amount > 0)
  const keepOldTarget = !!editingContractId.value && sum === 0 && !hasPositive && (Number(f.orig_target) || 0) > 0
  const targetAmount = keepOldTarget ? Number(f.orig_target) : sum
  const body = { year: y, target_amount: targetAmount, rebate_pct: Number(f.rebate_pct) || 0, brand_id: Number(f.brand_id) || 0 }
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
    // 第二步：写月度目标（只提交用户填写过的月份；后端首次分解保护避免年度目标被部分填写压小）
    let mr = null
    if (hasPositive) {
      mr = await api('/api/rebate-contracts/' + cid + '/months', { method: 'PUT', body: { months } })
      if (mr && mr.success && mr.contract_target != null) sum = Number(mr.contract_target)
    }
    contractFormOpen.value = false
    editingContractId.value = null
    await loadContracts()
    saveContractTemplate()   // §1.1 保存后记忆为模板，供「引用模板」复用
    if (keepOldTarget) toast('已保存，该合同无月度分解，全年目标沿用原值 ¥' + fmt(targetAmount), 'success')
    else if (mr && mr.first_partial) toast('已保存，月度分解未填满 12 个月，全年目标保留 ¥' + fmt(sum), 'success')
    else if (sum === 0) toast('已保存（未填写月度目标，全年目标为 ¥0）', 'success')
    else toast('已保存，全年目标自动汇总为 ¥' + fmt(sum), 'success')
  } catch (e) {
    // v112 R36：合同已创建但月度写入失败 → 明确告知「可补填」，避免用户重试又建一份
    if (cid && !editingContractId.value) {
      toast('合同已创建（无月度目标），可在年度合同列表展开「月度构成」补填', 'warn')
      contractFormOpen.value = false
      editingContractId.value = null
      await loadContracts()
    } else {
      toast('保存失败: ' + (e.message || ''), 'error')
    }
  }
}
async function deleteContract(c) {
  // v112 R4/R20：已结算合同后端 409 拦截（detail 给出原因）；统一确认弹窗
  openConfirm({
    title: '删除年度合同',
    message: `确定删除「${contractName(c)} ${c.year} 年度」合同返利吗？\n此操作不可恢复；被挂载的目标规则将回置为独立规则（不删除）。`,
    okText: '删除', danger: true,
    onOk: async () => {
      try {
        await api('/api/rebate-contracts/' + c.id, { method: 'DELETE' })
        toast('已删除', 'success')
        await loadContracts()
      } catch (e) {
        toast('删除失败: ' + (e.message || ''), 'error')
      }
    },
  })
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
const moSplitMode = ref({})   // #357 分解方式：manual / avg / hist
const moSplitBusy = ref({})   // #357 按去年占比异步加载态

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
    moSplitMode.value[c.id] = 'manual'   // #357 默认手动，避免意外覆盖已有分解
  } catch (e) {
    moError.value[c.id] = '月度明细加载失败: ' + (e.message || '')
  } finally {
    moLoading.value[c.id] = false
  }
}
async function saveMonths(c) {
  // #357：月度合计与年度目标不一致时，保存前二次确认（后端会按月度之和回写年度目标）
  if (moMismatch(c)) {
    const gap = Math.round(moEditSum(c) - moContractTarget(c))
    openConfirm({
      title: '月度合计与年度目标不一致',
      message: `月度目标合计 ¥${fmt(moEditSum(c))}，与年度目标 ¥${fmt(moContractTarget(c))} 相差 ¥${fmt(Math.abs(gap))}。\n保存后年度目标将自动变为月度合计值，确认保存？`,
      okText: '仍要保存', danger: true,
      onOk: () => doSaveMonths(c),
    })
    return
  }
  doSaveMonths(c)
}
async function doSaveMonths(c) {
  const months = []
  const edits = moEdits.value[c.id] || {}
  for (const m of (moData.value[c.id] || {}).months || []) {
    // #357：已计提月份锁定，提交时沿用原目标（不随编辑变化，避免误改资损）
    const v = monthLocked(m) ? (Number(m.target_amount) || 0) : (Number(edits[m.month]) || 0)
    months.push({ month: m.month, target_amount: v, note: m.note || '' })
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
/* ---- #357 目标分解：拆分方式 + 已计提锁定 + 校验条 ---- */
function monthLocked(m) {
  // 已计提（accrued_rebate>0）或已结算（settled）的月份锁定，不可改
  return Number(m.accrued_rebate) > 0 || !!m.settled
}
function moContractTarget(c) {
  const t = Number(c.target_amount)
  if (Number.isFinite(t) && t > 0) return t
  const od = moData.value[c.id]
  return od && od.totals ? Number(od.totals.target) || 0 : 0
}
function moEditSum(c) {
  const edits = moEdits.value[c.id] || {}
  const data = moData.value[c.id]
  let s = 0
  for (const m of (data ? data.months : [])) {
    const v = Number(edits[m.month])
    if (Number.isFinite(v) && v > 0) s += v
  }
  return Math.round(s * 100) / 100
}
function moMismatch(c) {
  return Math.abs(moEditSum(c) - moContractTarget(c)) > 0.5
}
// 把 baseTarget 按 weights 分配到未锁定月（最大余数法消除浮点残差），锁定月保持原值
function distributeMonths(c, weights) {
  const data = moData.value[c.id]
  if (!data) return
  const months = data.months
  const locked = months.filter(monthLocked)
  const lockedSum = locked.reduce((a, m) => a + (Number(m.target_amount) || 0), 0)
  const baseTarget = Math.round((moContractTarget(c) - lockedSum) * 100) / 100
  const fillable = months.filter(m => !monthLocked(m))
  if (fillable.length === 0) { toast('所有月份已计提锁定，无可分配月份', 'warn'); return }
  if (baseTarget < 0) { toast('已计提月份目标之和已超过年度目标，无法再分解', 'error'); return }
  const edits = { ...(moEdits.value[c.id] || {}) }
  const wsum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0)
  if (wsum <= 0) {
    const each = Math.floor(baseTarget / fillable.length)
    fillable.forEach((m) => { edits[m.month] = each })
    edits[fillable[fillable.length - 1].month] = each + (baseTarget - each * fillable.length)
  } else {
    const raw = fillable.map((m, i) => ({ month: m.month, val: baseTarget * (weights[i] > 0 ? weights[i] : 0) / wsum }))
    const floor = raw.map(r => ({ month: r.month, f: Math.floor(r.val), frac: r.val - Math.floor(r.val) }))
    let used = floor.reduce((a, r) => a + r.f, 0)
    let residual = Math.round((baseTarget - used))
    floor.sort((a, b) => b.frac - a.frac)
    let idx = 0
    while (residual > 0 && idx < floor.length) { floor[idx].f += 1; residual -= 1; idx++ }
    for (const r of floor) edits[r.month] = r.f
  }
  moEdits.value[c.id] = edits
}
function fillableEqualWeights(c) {
  const data = moData.value[c.id]
  return (data ? data.months : []).map(() => 1)
}
async function applySplit(c) {
  const mode = moSplitMode.value[c.id] || 'manual'
  if (mode === 'manual') return
  if (mode === 'avg') { distributeMonths(c, fillableEqualWeights(c)); return }
  if (mode === 'hist') { await fillHist(c) }
}
async function fillHist(c) {
  moSplitBusy.value[c.id] = true
  try {
    const prev = findPrevYearContract(c)
    if (!prev) { toast('未找到 ' + (Number(c.year) - 1) + ' 年同品牌/同合作方合同，已按平均分解', 'warn'); distributeMonths(c, fillableEqualWeights(c)); return }
    const d = await api('/api/rebate-contracts/' + prev.id + '/overview')
    if (!d || !d.success) { toast('读取去年同期失败，已按平均分解', 'warn'); distributeMonths(c, fillableEqualWeights(c)); return }
    const months = d.months || []
    let weights = months.map(m => Number(m.achieved) || 0)
    if (weights.every(w => w <= 0)) weights = months.map(m => Number(m.target_amount) || 0)
    if (weights.every(w => w <= 0)) { toast('去年同期无数据，已按平均分解', 'warn'); distributeMonths(c, fillableEqualWeights(c)); return }
    distributeMonths(c, weights)
    toast('已按 ' + (Number(c.year) - 1) + ' 年同期占比分解', 'success')
  } catch (e) {
    toast('按去年占比分解失败: ' + (e.message || ''), 'warn')
    distributeMonths(c, fillableEqualWeights(c))
  } finally {
    moSplitBusy.value[c.id] = false
  }
}
function findPrevYearContract(c) {
  const py = Number(c.year) - 1
  const list = contracts.value || []
  const sameBrand = list.find(x => Number(x.year) === py && x.brand_id != null && x.brand_id === c.brand_id)
  if (sameBrand) return sameBrand
  const cid = Number(c.contact_id) || 0
  if (cid) {
    const sameContact = list.find(x => Number(x.year) === py && (Number(x.contact_id) || 0) === cid)
    if (sameContact) return sameContact
  }
  const nm = (c.contact_name || '').trim()
  if (nm) {
    const sameName = list.find(x => Number(x.year) === py && (x.contact_name || '').trim() === nm)
    if (sameName) return sameName
  }
  return null
}
function topUpMonths(c) {
  // 把「年度目标 - 当前月度合计」差额补到最后一个未锁定月，使两者一致
  const gap = Math.round(moContractTarget(c) - moEditSum(c))
  if (gap === 0) { toast('月度合计已与年度目标一致', 'success'); return }
  const data = moData.value[c.id]
  if (!data) return
  const fillable = data.months.filter(m => !monthLocked(m))
  if (fillable.length === 0) { toast('所有月份已锁定', 'warn'); return }
  const edits = { ...(moEdits.value[c.id] || {}) }
  const last = fillable[fillable.length - 1].month
  const cur = Number(edits[last]) || 0
  edits[last] = Math.max(0, cur + gap)
  moEdits.value[c.id] = edits
  toast('已将差额 ¥' + fmt(Math.abs(gap)) + ' 补到 ' + last, 'success')
}
async function accrueMonth(c, m) {
  if (m.settled) { toast(m.month + ' 已结算，不能重复计提', 'error'); return }
  // v112 R33：已计提月份再次计提 = 重提（覆盖旧值），需二次确认
  if (Number(m.accrued_rebate) > 0) {
    openConfirm({
      title: '重新计提',
      message: `${m.month} 已计提 ¥${fmt(m.accrued_rebate)}。\n重新计提将按当前达成覆盖旧值，确认继续？`,
      okText: '重新计提', danger: true,
      onOk: () => doAccrueMonth(c, m),
    })
    return
  }
  doAccrueMonth(c, m)
}
async function doAccrueMonth(c, m) {
  const key = c.id + '-' + m.month
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
  // v112 R7/R20：可反结算（uns-settle）兜底；统一确认弹窗
  openConfirm({
    title: '结算年度合同',
    message: `确定结算「${contractName(c)} ${c.year} 年度」？\n将把未结算的计提汇总生成一张应收单（厂家欠你方）。\n结算后可随时「反结算」作废应收单回退。`,
    okText: '确认结算', danger: false,
    onOk: async () => {
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
    },
  })
}

/* ---- v114 (B2-2): 申领 + 审批状态机 ---- */
const claimMap = ref({})
function claimStatus(c) { return (claimMap.value[c.id] || {}).claim_status || 'none' }
function claimStatusText(c) {
  const s = claimStatus(c)
  return { none: '未申领', submitted: '待审核', approved: '已通过', rejected: '已驳回', reversed: '已冲销' }[s] || s
}
function claimBadgeClass(c) {
  const s = claimStatus(c)
  return { none: '', submitted: 'warn', approved: 'ok', rejected: 'danger', reversed: '' }[s] || ''
}
async function claimSubmit(c) {
  try {
    const r = await api('/api/rebate-contracts/' + c.id + '/claim', { method: 'POST', body: {} })
    if (r && r.success) { toast('已提交申领，等待审核', 'success'); await Promise.all([loadContracts()].concat(expandedMonths.value[c.id] ? [loadMonths(c)] : [])) }
    else toast('申领失败: ' + ((r && r.error) || ''), 'error')
  } catch (e) { toast('申领失败: ' + (e.message || ''), 'error') }
}
async function claimReview(c, action) {
  const label = { approve: '审核通过', reject: '驳回', reverse: '冲销' }[action] || action
  openConfirm({
    title: label + '申领',
    message: `确定对「${contractName(c)}」执行「${label}」？` + (action === 'approve' ? '\n审核通过将生成应收单（结算）。' : action === 'reverse' ? '\n冲销将作废应收单回退为未结算。' : ''),
    okText: label, danger: action !== 'approve',
    onOk: async () => {
      try {
        const r = await api('/api/rebate-contracts/' + c.id + '/claim/review', { method: 'POST', body: { action } })
        if (r && r.success) { toast(label + '成功', 'success'); await Promise.all([loadContracts()].concat(expandedMonths.value[c.id] ? [loadMonths(c)] : [])) }
        else toast(label + '失败: ' + ((r && r.error) || ''), 'error')
      } catch (e) { toast(label + '失败: ' + (e.message || ''), 'error') }
    },
  })
}
/* ---- v114 (B2-3): 批量计提 ---- */
const batchAccruing = ref(false)
async function batchAccrue() {
  batchAccruing.value = true
  try {
    const r = await api('/api/rebate-contracts/batch-accrue', { method: 'POST', body: { month: new Date().toISOString().slice(0, 7) } })
    if (r && r.success) toast(`批量计提完成：${r.ok_count}/${r.count} 个合同，返利 ¥${fmt(r.total_rebate)}`, 'success')
    else toast('批量计提失败', 'error')
    await loadContracts()
  } catch (e) { toast('批量计提失败: ' + (e.message || ''), 'error') }
  finally { batchAccruing.value = false }
}

/* ---- v111: 阶梯设置 ---- */
const tierFormOpen = ref(false)
const tierFormContract = ref(null)
const tierFormTiers = ref([])
const tierSaving = ref(false)
/* ---- v114 (B2-1): 阶梯版本管理 ---- */
const versionModalOpen = ref(false)
const versionRule = ref(null)
const versionList = ref([])
const versionLoading = ref(false)
const versionSaving = ref(false)
const versionForm = ref({ effective_start: '', effective_end: '', note: '' })
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
/* ---- v114 (B2-1): 阶梯版本管理 ---- */
function tierCountOf(tiersJson) {
  try {
    const a = typeof tiersJson === 'string' ? JSON.parse(tiersJson) : (tiersJson || [])
    return Array.isArray(a) ? a.length : 0
  } catch (e) { return 0 }
}
async function openVersionManager(r) {
  versionRule.value = r
  versionModalOpen.value = true
  versionForm.value = { effective_start: '', effective_end: '', note: '' }
  await loadVersions(r)
}
async function loadVersions(r) {
  versionLoading.value = true
  try {
    const list = await api('/api/rebate-rules/' + r.id + '/tier-versions')
    versionList.value = Array.isArray(list) ? list : (list.data || [])
  } catch (e) {
    versionList.value = []
    toast('版本加载失败: ' + (e.message || ''), 'error')
  } finally {
    versionLoading.value = false
  }
}
async function createVersion() {
  const r = versionRule.value
  if (!r) return
  versionSaving.value = true
  try {
    // 快照规则当前阶梯（前端把规则 tiers_json 原样传回，后端存为版本）
    const r0 = await api('/api/rebate-rules/' + r.id + '/tier-versions', {
      method: 'POST',
      body: {
        effective_start: versionForm.value.effective_start || '',
        effective_end: versionForm.value.effective_end || '',
        note: versionForm.value.note || '',
        tiers_json: r.tiers_json || '[]',
        scale_type: r.scale_type || 'non_graduated',
        rounding_mode: r.rounding_mode || 'half_up',
        rounding_digits: r.rounding_digits != null ? r.rounding_digits : 2,
      },
    })
    if (r0 && r0.success) {
      toast('版本已新增', 'success')
      versionForm.value = { effective_start: '', effective_end: '', note: '' }
      await loadVersions(r)
    } else toast('新增版本失败: ' + ((r0 && r0.error) || ''), 'error')
  } catch (e) { toast('新增版本失败: ' + (e.message || ''), 'error') }
  finally { versionSaving.value = false }
}
async function deleteVersion(v) {
  const r = versionRule.value
  if (!r) return
  openConfirm({
    title: '删除版本',
    message: `确定删除版本 v${v.version_no}（生效 ${v.effective_start || '—'} ~ ${v.effective_end || '—'}）？`,
    okText: '删除', danger: true,
    onOk: async () => {
      try {
        await api('/api/rebate-rules/' + r.id + '/tier-versions/' + v.id, { method: 'DELETE' })
        toast('已删除', 'success')
        await loadVersions(r)
      } catch (e) { toast('删除失败: ' + (e.message || ''), 'error') }
    },
  })
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

onMounted(() => { loadRules(); loadBrandOptions(); loadProductRefs(); loadAchievements(dashMonth.value); loadContracts(); loadContactOptions(); loadRebateMeta(); loadConflicts(); loadDefaultCadence(); loadYearAchv() })
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
/* v112 R24：数字列统一右对齐 + 等宽数字（规则列表「目标值/返利」、达成填报、月度表共用） */
.num{text-align:right;font-variant-numeric:tabular-nums}
/* v112 R27：达成填报主标题与仪表盘 .dash-hd b 统一 16px */
.panel-hd b{font-size:16px}
/* v118 (L2细化)：到货排程引擎面板 */
.arrival-block{border:1px solid var(--bd2);border-radius:10px;padding:14px;margin-bottom:6px;background:var(--bg2)}
.arrival-block .form-row{margin-bottom:8px}
.seg{display:inline-flex;border:1px solid var(--bd2);border-radius:8px;overflow:hidden}
.seg-btn{padding:6px 14px;border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--t2)}
.seg-btn.on{background:var(--p);color:#fff}
.wk-chips{display:flex;gap:6px;flex-wrap:wrap}
.wk-chip{padding:6px 12px;border:1px solid var(--bd2);border-radius:18px;background:var(--bg1);cursor:pointer;font-size:13px;color:var(--t2)}
.wk-chip.on{background:var(--p);color:#fff;border-color:var(--p)}
.input-affix{display:flex;align-items:center;gap:6px}
.input-affix .input{flex:1}
.input-affix .affix{font-size:12px;color:var(--t3);white-space:nowrap}
.ro-val{font-size:14px;color:var(--t1);padding:7px 0;font-variant-numeric:tabular-nums}
.ro-val b{color:var(--p)}
/* v112 R34：导入干跑预览结果 */
.achv-preview{margin-top:4px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.achv-preview-hd{font-size:12.5px;color:var(--t2);margin:0 0 6px}
.achv-preview-hd b{color:var(--t1)}
.achv-preview-errs{margin:0;padding:0;list-style:none;max-height:120px;overflow-y:auto}
.achv-preview-errs li{font-size:12px;color:var(--t3);padding:2px 0;border-bottom:1px dashed var(--border-subtle)}
.achv-preview-ok{font-size:12px;color:var(--suc);margin:0}

.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000}
.modal-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:580px;max-width:92vw;max-height:88vh;overflow-y:auto;background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:1001}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.modal-hd b{font-size:16px}
.btn-close{border:none;background:none;font-size:18px;color:var(--t3);cursor:pointer}
.modal-body{padding:20px;display:flex;flex-direction:column;gap:14px}
.modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle);position:sticky;bottom:0;background:var(--bg);z-index:2}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
/* v121 智能报单表：三个时点并排 */
.form-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
/* v121 合并：卡片内部分区标题 + 到货派生说明 */
.ap-sec{display:flex;align-items:center;gap:8px;margin:12px 0 8px;font-size:12.5px;font-weight:600;color:var(--t1)}
.ap-sec:first-child{margin-top:0}
.ap-sec-note{font-weight:400;font-size:11.5px;color:var(--t3)}
.ap-derive{margin:2px 0 0;font-size:12px;color:var(--p-dark);background:rgba(6,182,212,.08);border-radius:6px;padding:6px 8px}
.ap-preview{margin-top:10px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px;background:var(--bg2)}
.ap-head{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--t3);margin-bottom:8px}
.ap-warn{font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5}
.ap-warn-tip{color:var(--p-dark)}
.ap-adopt{margin-left:8px;border:1px solid var(--p);background:transparent;color:var(--p-dark);border-radius:6px;padding:1px 10px;font-size:12px;cursor:pointer}
.ap-adopt:hover{background:var(--p);color:#fff}
.ap-tbl{width:100%;border-collapse:collapse;font-size:12px}
.ap-tbl th{text-align:left;color:var(--t3);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--border-subtle)}
.ap-tbl td{padding:5px 6px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
.ap-dim{color:var(--t3);font-size:11px}
.ap-brand{display:inline-block;background:rgba(6,182,212,.12);color:var(--p-dark);border-radius:4px;padding:1px 6px;margin:1px 4px 1px 0;font-size:11px}
.ap-brand i{font-style:normal;opacity:.7;margin-left:2px}
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
/* v116 (L2)：全局默认到货周期设置条 */
.cadence-default-card{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;margin-bottom:14px;flex-wrap:wrap}
.cadence-default-card .cd-left{display:flex;flex-direction:column;gap:3px}
.cadence-default-card .cd-left b{font-size:14px;display:flex;align-items:center;gap:6px}
.cadence-default-card .cd-left .muted{font-size:12px}
.cadence-default-card .cd-right{display:flex;align-items:center;gap:8px;white-space:nowrap}
.cadence-default-card .cd-input{width:72px;text-align:center}

/* P0-3 状态标签（v112 R21：琥珀色统一用 --war 变量，适配暗黑主题） */
.tag.warn{background:rgba(var(--war-rgb),.12);color:var(--war);border:1px solid rgba(var(--war-rgb),.3)}

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
.dt-note{background:rgba(var(--war-rgb),.1);border:1px solid rgba(var(--war-rgb),.3);color:var(--war);border-radius:var(--radius-md);padding:9px 12px;font-size:12.5px;margin-top:12px;line-height:1.5}

/* 仪表盘 Tab（方案 A：KPI 置顶 + 条形排行） */
.dash-card{}
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

/* #354：rank-row 算式入口 + 进度条百分比 */
.rr-calc-btn{margin-left:8px;border:1px solid rgba(var(--p-rgb),.4);background:rgba(6,182,212,.08);color:var(--p-dark);border-radius:6px;padding:2px 9px;font-size:12px;cursor:pointer}
.rr-calc-btn:hover{background:rgba(6,182,212,.16)}
.rr-calc-link{margin-left:6px;border:none;background:none;color:var(--p-dark);cursor:pointer;font-size:12px;text-decoration:underline;padding:0}
.rr-calc-link:hover{opacity:.8}
.rr-calc-loading{margin-left:8px;font-size:12px;color:var(--t3)}
.rr-est{display:inline-flex;align-items:center;gap:6px}
.rr-bar{height:16px}
.rr-bar-pct{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;color:var(--t1);text-shadow:0 0 3px rgba(255,255,255,.6);pointer-events:none}

/* #356：异常预警区 */
.dash-anom{margin-bottom:14px;border:1px solid rgba(var(--dan-rgb),.35);background:rgba(var(--dan-rgb),.06);border-radius:var(--radius-md);padding:12px 14px}
.da-hd{font-size:13px;font-weight:600;color:var(--dan);margin-bottom:8px;display:flex;align-items:center}
.da-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
.da-item{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--t1);line-height:1.5}
.da-ic{flex:none;width:18px;text-align:center;color:var(--dan);font-weight:700}
.da-item.warn .da-ic{color:var(--war)}
.da-text{flex:none;font-weight:500}
.da-items{color:var(--t3);font-size:12px}

/* #354：算式链 Modal */
.calc-card{width:620px}
.calc-sum{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.cs-cell{background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:8px 12px;display:flex;flex-direction:column;gap:3px}
.cs-cell span{font-size:11px;color:var(--t3)}
.cs-cell b{font-size:14px;color:var(--t1);font-weight:600}
.cs-cell .cs-ok{color:var(--suc)}
.calc-sec{margin-top:6px}
.calc-sec h4{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--t2)}
.calc-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.cs-step{display:flex;align-items:center;gap:10px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:8px 12px}
.cs-key{flex:none;min-width:84px;font-size:12px;font-weight:600;color:var(--p-dark);background:rgba(6,182,212,.1);border-radius:6px;padding:2px 8px;text-align:center}
.cs-text{flex:1;font-size:12.5px;color:var(--t1);line-height:1.45}
.cs-val{flex:none;font-size:13px;font-weight:700;color:var(--t1);font-variant-numeric:tabular-nums}
.calc-tiers th,.calc-tiers td{text-align:left}
.calc-tiers .tier-hit{background:rgba(var(--suc-rgb),.08)}
.calc-tiers .tier-miss{opacity:.62}

/* #355：What-if 试算器 */
.sim-slider{width:100%;margin-top:6px;accent-color:var(--p-dark)}
.sim-ov{margin-top:4px}
.sim-calc-btn{margin-top:10px}
.sr-flag{font-size:12px;color:var(--war);margin-top:8px;padding:6px 10px;background:rgba(var(--war-rgb),.1);border-radius:var(--radius-sm)}

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
.rr-vs.behind{background:rgba(var(--war-rgb),.12);border:1px solid rgba(var(--war-rgb),.4);color:var(--war)}
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
/* #357 目标分解：分解方式 + 校验条 + 锁定 */
.cc-mo-toolbar{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.cc-mo-split{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cc-mo-split-l{font-size:12px;color:var(--t2);font-weight:600}
.cc-mo-select{width:auto;padding:3px 8px;font-size:12px;min-height:28px}
.cc-mo-valid{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12px;padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle)}
.cc-mo-valid.ok{background:rgba(var(--suc-rgb),.12);border-color:var(--suc)}
.cc-mo-valid.warn{background:var(--danger-bg);border-color:var(--danger-txt)}
.cc-mo-valid b{font-weight:700}
.cc-mo-vs{color:var(--t3)}
.cc-mo-bad{color:var(--danger-txt);font-weight:700}
.cc-mo-good{color:var(--suc);font-weight:700}
.mo-locked{display:inline-flex;align-items:center;gap:4px;font-weight:600;color:var(--t2);background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:2px 8px;font-size:12px}
.mo-lock{color:var(--t3);flex-shrink:0}
.cc-mtotals .cc-mtotals-p.ok{color:var(--suc)}
.cc-ti{width:90px;padding:3px 6px;font-size:12px}


@media(max-width:768px){
  .toolbar{flex-direction:column;align-items:stretch}
  .sel-filter{width:100%}
  .form-grid2{grid-template-columns:1fr}
  .form-grid3{grid-template-columns:1fr}
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
/* v112 R13：月度网格折叠/展开 */
.cf-mo-label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cf-mo-toggle{background:none;border:1px solid var(--bd);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--p-dark);cursor:pointer;margin-left:auto}
.cf-mo-toggle:hover{background:var(--bg2)}
.cf-mo-collapsed-tip{font-size:12px;color:var(--t3);background:var(--bg2);border:1px dashed var(--border-subtle);border-radius:6px;padding:8px 10px;margin-top:4px}
/* v112 R14：达成填报行级保存状态 */
.achv-saving{font-size:12px;color:var(--t3);margin-left:6px}
.achv-fail{font-size:12px;color:var(--dan);margin-left:6px;cursor:pointer;text-decoration:underline}
.cf-mo-cell label{display:block;font-size:12px;color:var(--t2);margin-bottom:3px}
.cf-mo-sum{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:10px 14px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.18);border-radius:8px}
.cf-mo-sum span{font-size:13px;color:var(--p-dark)}
.cf-mo-sum b{font-size:18px;color:var(--p);font-weight:600}
.cf-tip b{color:var(--t1)}
/* §1.1 向导步骤条 + 引用按钮 + 预览 */
.cf-wizard-actions{display:flex;gap:6px;margin-left:auto}
.cf-steps{display:flex;gap:6px;padding:12px 18px 0;border-bottom:1px solid var(--border-subtle)}
.cf-step{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--t3);padding:6px 10px;border-radius:var(--radius-sm);flex:1;justify-content:center}
.cf-step span{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--bg2);color:var(--t2);font-size:12px;font-weight:700}
.cf-step.active{color:var(--t1);font-weight:600;background:rgba(6,182,212,.1)}
.cf-step.active span{background:var(--p-dark);color:#fff}
.cf-step.done span{background:var(--suc);color:#fff}
.cf-step.done{color:var(--suc)}
.cf-mo-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin:4px 0 8px;flex-wrap:wrap}
.cf-mo-label{font-size:13px;color:var(--t2);font-weight:600}
.cf-mo-hint{font-size:11px;color:var(--t3);font-weight:400;margin-left:6px}
.cf-mo-avg{display:flex;align-items:center;gap:6px}
.cf-mo-avg .input-sm{width:170px}
.cf-review{display:flex;flex-direction:column;gap:2px}
.cf-r-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border-subtle);font-size:13.5px}
.cf-r-row:last-child{border-bottom:none}
.cf-r-row span{color:var(--t3)}
.cf-r-row b{color:var(--t1);font-weight:600}
.cf-tbl{width:100%;margin-bottom:12px}
.cf-tbl td.cf-period{white-space:nowrap;color:var(--t2);font-variant-numeric:tabular-nums}
.cf-sol{font-size:12.5px;color:var(--t3);line-height:1.7;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px 12px;margin:0}
.cf-sol b{color:var(--t1)}

@media(max-width:768px){
  .cf-tbl td.cf-period{white-space:normal}
}
/* v112 R13：320px 窄屏月度网格 4 列 → 2 列 */
@media(max-width:480px){
  .cf-mo-grid{grid-template-columns:repeat(2,1fr)}
}

/* v112 R26：打印样式 —— 财务/管理层打印仪表盘或月度构成表 */
@media print{
  .main-tabs,.toolbar,.entry-row,.achv-ops,.cc-actions,.cc-mo-toggle,
  .btn,.btn-mini,.btn-xs,.dash-month{display:none!important}
  .dash-card,.contract-card,.cc-mtable-wrap{border:none;box-shadow:none}
  .modal-overlay,.modal-card{position:static;transform:none;box-shadow:none;max-height:none;overflow:visible}
  .rr-bar-mark{display:none}
}
/* v123：全年月度达成柱状图 */
.dash-chart { margin: 4px 0 2px; }
.dash-kpi-note { font-size: 12px; color: var(--t3); margin: -2px 0 8px; }
</style>
