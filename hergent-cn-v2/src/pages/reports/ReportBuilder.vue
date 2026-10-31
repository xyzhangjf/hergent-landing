<template>
  <div class="page rb-page">
    <div class="page-hd split">
      <div>
        <h2>报表设计器</h2>
        <span class="page-sub">
          改一张报表的取数口径与列显示。<b>保存后所有人打开那张报表看到的都会变</b> ——
          这里改的是「数怎么算出来的」，不是「数长什么样」。
        </span>
      </div>
      <div class="rb-acts">
        <button class="btn btn-ghost btn-sm" :disabled="running || !draft" @click="runPreview">
          <Icon name="bar-chart" :size="14" />{{ running ? '试跑中…' : '试跑' }}
        </button>
        <button class="btn btn-sm rb-save" :disabled="saving || !dirty || !draft" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <div class="rb-layout">
      <!-- ── 左：报表清单 ────────────────────────────────────── -->
      <div class="card rb-list">
        <div class="rb-list-hd">
          <span>报表清单</span>
          <span class="rb-list-cnt">{{ list.length }}</span>
        </div>
        <div v-if="loadingList" class="rb-list-empty">加载中…</div>
        <div v-else class="rb-list-body">
          <button
            v-for="it in list"
            :key="it.name"
            class="rb-item"
            :class="{ on: draft && draft.name === it.name }"
            @click="select(it.name)"
          >
            <span class="rb-item-t">{{ it.title }}</span>
            <span class="rb-item-s" :class="statusCls(it)">{{ statusText(it) }}</span>
          </button>
        </div>
      </div>

      <!-- ── 右：编辑区 ──────────────────────────────────────── -->
      <div v-if="!draft" class="card rb-hollow">
        <h3>从左边选一张报表开始</h3>
        <p>没有选中任何报表。左边每一条都能改：标题、取数 SQL、列名、列类型、要不要合计。</p>
      </div>

      <div v-else class="rb-edit">
        <!-- 基本信息 -->
        <div class="card rb-sec">
          <div class="rb-sec-hd">
            <span>基本信息</span>
            <span v-if="draft.is_seed === 0" class="rb-badge rb-badge-manual">人工维护</span>
            <span v-else class="rb-badge">系统内置</span>
          </div>
          <div class="rb-grid2">
            <label class="rb-fld">
              <span>报表标题</span>
              <input v-model="draft.title" class="rb-in" @input="dirty = true" />
            </label>
            <label class="rb-fld">
              <span>入口路径</span>
              <input v-model="draft.path" class="rb-in rb-mono" @input="dirty = true" />
            </label>
          </div>
          <div class="rb-hint">
            标识 <code>{{ draft.name }}</code> 不可改（它是路由与接口的键）。
            <span v-if="draft.is_seed === 1">保存后会转成「人工维护」，此后系统升级不再覆盖它。</span>
          </div>
        </div>

        <!-- SQL -->
        <div class="card rb-sec">
          <div class="rb-sec-hd">
            <span>取数 SQL</span>
            <span class="rb-sec-note">只允许单条 SELECT / WITH；参数用 <code>:date_from</code> 这种写法</span>
          </div>
          <textarea
            v-model="draft.sql"
            class="rb-sql"
            spellcheck="false"
            rows="12"
            @input="dirty = true"
          ></textarea>

          <div class="rb-params">
            <span class="rb-params-hd">筛选项（会变成上方的日期/下拉控件）</span>
            <div v-if="!draft.filters.length" class="rb-params-empty">
              这张报表没有筛选项。SQL 里若用了 <code>:参数名</code>，必须在这里声明。
            </div>
            <div v-for="(f, i) in draft.filters" :key="'f-' + i" class="rb-param">
              <input v-model="f.key" class="rb-in rb-mono" placeholder="参数名" @input="dirty = true" />
              <input v-model="f.label" class="rb-in" placeholder="显示名" @input="dirty = true" />
              <select v-model="f.fieldtype" class="rb-in" @change="dirty = true">
                <option v-for="t in FILTER_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <input v-model="f.default" class="rb-in" placeholder="默认值" @input="dirty = true" />
              <button class="rb-x" title="删除" @click="draft.filters.splice(i, 1); dirty = true">×</button>
            </div>
            <button class="btn btn-ghost btn-sm" @click="addFilter">+ 加筛选项</button>
          </div>
        </div>

        <!-- 列定义 -->
        <div class="card rb-sec">
          <div class="rb-sec-hd">
            <span>列定义</span>
            <span class="rb-sec-note">
              类型决定「怎么显示」和「要不要合计」：金额右对齐带 ¥，百分比取平均
            </span>
          </div>

          <div class="rb-cols">
            <div class="rb-col rb-col-hd">
              <span>字段名</span><span>显示名</span><span>类型</span><span>列宽</span><span>合计</span><span></span>
            </div>
            <div v-for="(c, i) in draft.columns" :key="'c-' + i" class="rb-col">
              <input v-model="c.key" class="rb-in rb-mono" placeholder="列名" @input="dirty = true" />
              <input v-model="c.label" class="rb-in" placeholder="显示名" @input="dirty = true" />
              <select v-model="c.fieldtype" class="rb-in" @change="dirty = true">
                <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <input v-model="c.width" class="rb-in rb-mono" placeholder="112px" @input="dirty = true" />
              <input
                type="checkbox"
                :checked="inTotals(c.key)"
                :disabled="!canTotal(c)"
                :title="canTotal(c) ? '这一列参与合计' : '这个类型不参与合计'"
                @change="toggleTotal(c.key, $event.target.checked)"
              />
              <span class="rb-col-ops">
                <button class="rb-x" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
                <button class="rb-x" title="下移" :disabled="i === draft.columns.length - 1" @click="move(i, 1)">↓</button>
                <button class="rb-x" title="删除" @click="draft.columns.splice(i, 1); dirty = true">×</button>
              </span>
            </div>
            <div v-if="!draft.columns.length" class="rb-params-empty">还没有列。先试跑，再点下面的「按 SQL 结果补全列」。</div>
          </div>

          <div class="rb-cols-ops">
            <button class="btn btn-ghost btn-sm" @click="addColumn">+ 加一列</button>
            <button class="btn btn-ghost btn-sm" :disabled="!previewCols.length" @click="syncFromResult">
              按 SQL 结果补全列（{{ previewCols.length }}）
            </button>
            <span class="rb-hint-inline">
              合计方式：勾了「合计」的列会按类型合计；不勾则不出合计行。
            </span>
          </div>
        </div>

        <!-- 图表 -->
        <div class="card rb-sec">
          <div class="rb-sec-hd">
            <span>图表</span>
            <span class="rb-sec-note">
              配了图，报表页顶部先出图、下面才是明细表。图上的数<b>独立在完整结果集上聚合</b>，不受 5000 行显示上限影响
            </span>
          </div>

          <div class="rb-chart-row">
            <label>图形</label>
            <select v-model="draft.chart.type" class="rb-in rb-in-wide" @change="onChartType">
              <option value="">不出图（纯表格）</option>
              <option value="line">折线图 —— 看随时间的走势</option>
              <option value="bar">柱状图 —— 比多少</option>
              <option value="hbar">横向条形图 —— 排名（名字长也放得下）</option>
              <option value="donut">环形图 —— 看结构占比</option>
            </select>
          </div>

          <template v-if="draft.chart.type">
            <div class="rb-chart-row">
              <label>横轴</label>
              <select v-model="draft.chart.x" class="rb-in rb-in-wide" @change="dirty = true">
                <option value="">（选一列）</option>
                <option v-for="c in draft.columns" :key="'cx-' + c.key" :value="c.key">
                  {{ c.label || c.key }}（{{ c.fieldtype }}）
                </option>
              </select>
              <span class="rb-hint-inline">选日期列 → 自动按天/按月；选其它列 → 按值从大到小排名</span>
            </div>

            <div class="rb-chart-row">
              <label>纵轴</label>
              <span class="rb-chart-checks">
                <label v-for="c in numCols" :key="'cy-' + c.key" class="rb-chk">
                  <input
                    type="checkbox"
                    :checked="draft.chart.y.includes(c.key)"
                    @change="toggleY(c.key, $event.target.checked)"
                  />
                  {{ c.label || c.key }}
                </label>
                <span v-if="!numCols.length" class="rb-params-empty">
                  列定义里还没有数值列（Int / Float / Currency / Percent），先给列选对类型
                </span>
              </span>
            </div>

            <div class="rb-chart-row">
              <label>合计方式</label>
              <select v-model="draft.chart.agg" class="rb-in" @change="dirty = true">
                <option value="sum">求和（金额、数量）</option>
                <option value="count">计数（笔数）</option>
                <option value="avg">平均（比率）</option>
              </select>
              <label class="rb-inline-lab">最多显示</label>
              <input
                v-model.number="draft.chart.limit" type="number" min="1" max="50"
                class="rb-in rb-in-num" @input="dirty = true"
              />
              <span class="rb-hint-inline">组（排名类只画前 N，图注会写明）</span>
            </div>

            <div class="rb-chart-row">
              <label>图标题</label>
              <input
                v-model="draft.chart.title" class="rb-in rb-in-wide"
                placeholder="留空就用报表标题" @input="dirty = true"
              />
            </div>

            <p v-if="draft.chart.y.length && draft.chart.x && chartWarn" class="rb-chart-warn">
              <Icon name="alert-triangle" :size="13" /> {{ chartWarn }}
            </p>
          </template>
        </div>

        <!-- 口径说明 -->
        <div class="card rb-sec">
          <div class="rb-sec-hd">
            <span>口径说明</span>
            <span class="rb-sec-note">会显示在报表页脚，给看数的人解释「这个数是怎么来的」</span>
          </div>
          <textarea v-model="draft.note" class="rb-note" rows="4" @input="dirty = true"></textarea>
        </div>

        <!-- 试跑结果 -->
        <div v-if="previewErr" class="card rb-err">
          <div class="rb-err-hd"><Icon name="alert-triangle" :size="14" /> 试跑没通过</div>
          <p>{{ previewErr }}</p>
        </div>

        <div v-if="previewRows.length" class="card rb-sec">
          <div class="rb-sec-hd">
            <span>试跑结果</span>
            <span class="rb-sec-note">
              前 {{ previewRows.length }} 行 · 全量 {{ fmtInt(previewCount) }} 行 · {{ previewMs }} 毫秒
              <b v-if="previewCount > previewRows.length">（合计按全量算，不是只算这 {{ previewRows.length }} 行）</b>
            </span>
          </div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th v-for="c in previewCols" :key="'p-' + c">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewRows" :key="'pr-' + i">
                  <td v-for="c in previewCols" :key="'pc-' + i + c">{{ cell(r[c]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 图预览：配了图就能立刻看到长什么样 —— 这是这件事唯一的学习成本。
               图在表上方，与正式报表页的顺序一致，不是在编辑器里换一个排法。 -->
          <div v-if="draft.chart.type" class="rb-fig-prev">
            <div class="rb-fig-hd">图长这样</div>
            <component
              :is="previewChartComp"
              v-if="previewChartComp"
              :title="(previewChart && previewChart.title) || draft.chart.title || '预览'"
              :error="(previewChart && previewChart.error) || ''"
              :fmt="(previewChart && previewChart.fmt) || 'money'"
              :note="(previewChart && previewChart.note) || ''"
              :export-name="'图预览'"
              v-bind="previewChartProps"
            />
            <p v-else class="rb-params-empty">选了图形但还没选全横轴/纵轴 —— 试跑后这里会画出图。</p>
          </div>
        </div>
      </div>
    </div>

    <p class="rb-foot">
      保存会写进 <code>report_definitions</code>、并记一条审计（含旧 SQL 原文，可据此回滚）。
      同一张报表只需配一次，之后升级不会覆盖人工改过的定义。
    </p>
  </div>
</template>

<script setup>
/* 报表设计器（v725）
   ────────────────────────────────────────────────────────────────
   为什么要有这一页：v723 把 29 张报表做成「配置驱动」，但配置只能靠写 patch 改 ——
   老板想说「这张表加一列毛利」，就得等一次发版。这一页把那个入口交出来。

   🔴 为什么只给老板：改报表定义 = 改**所有人**看到的数的口径。把成本列换个科目、
      把 WHERE 放宽，界面上一切正常、没有任何报错 —— 这是「能改账」级别的权限，
      不是「配置一下界面」。后端 `_require_boss` 拦死，前端深链也拦。

   🔴 保存前必须试跑：语法对、闸门过，但列名拼错或类型不匹配只有真跑才知道。
      不试跑就保存 = 把 500 存进库，等老板下次打开那张报表才发现。
      后端 `_prepare_definition` 里也强制试跑，前端这道是让错误更早可见。
*/
import { ref, onMounted, computed } from 'vue'
import Icon from '../../components/Icon.vue'
import { reportEngineApi } from '../../api/modules'
import ChartLine from '../../components/chart/ChartLine.vue'
import ChartBar from '../../components/chart/ChartBar.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import ChartDonut from '../../components/chart/ChartDonut.vue'

const FIELD_TYPES = ['Data', 'Int', 'Float', 'Currency', 'Percent', 'Date', 'Datetime', 'Select', 'Link', 'Check']
const FILTER_TYPES = ['Date', 'Data', 'Int', 'Float', 'Select']
const TOTALABLE = ['Int', 'Float', 'Currency', 'Percent']
/* 图形类型与后端 `_CHART_TYPES` 一一对应；加新类型要两边一起改，
   否则保存时后端会以"图形类型只支持 …"为由 400（这是有意的，不是漏了兼容） */
const CHART_TYPES = ['line', 'bar', 'hbar', 'donut']

const list = ref([])
const loadingList = ref(false)
const draft = ref(null)
const dirty = ref(false)
const running = ref(false)
const saving = ref(false)

const previewRows = ref([])
const previewCols = ref([])
const previewCount = ref(0)
const previewMs = ref(0)
const previewErr = ref('')
/* 试跑的图：编辑器里「配了就能立刻看到」，不然配图是盲配 */
const previewChart = ref(null)

function fmtInt(v) {
  return Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function cell(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return String(v)
}

function statusText(it) {
  if (it.kind === 'unavailable') return '未启用'
  if (!it.columns || !it.columns.length) return '待完善'
  return '可用'
}
function statusCls(it) {
  if (it.kind === 'unavailable') return 's-off'
  if (!it.columns || !it.columns.length) return 's-warn'
  return 's-ok'
}

async function loadList() {
  loadingList.value = true
  try {
    const d = await reportEngineApi.defs()
    list.value = (d.items || []).filter(x => x.name !== 'personal')
  } catch (e) {
    list.value = []
  } finally {
    loadingList.value = false
  }
}

async function select(name) {
  if (dirty.value && !confirm('当前修改还没保存，切换会丢掉。确定切换吗？')) return
  previewRows.value = []; previewCols.value = []; previewErr.value = ''
  previewCount.value = 0; previewMs.value = 0; previewChart.value = null
  try {
    const r = await reportEngineApi.raw(name)
    draft.value = {
      name: r.name,
      title: r.title || '',
      path: r.path || '',
      kind: r.kind || 'sql',
      sql: r.sql || '',
      columns: (r.columns || []).map(c => ({
        key: c.key, label: c.label || c.key,
        fieldtype: c.fieldtype || c.type || 'Data',
        width: c.width || '',
      })),
      filters: (r.filters || []).map(f => ({
        key: f.key, label: f.label || f.key,
        fieldtype: f.fieldtype || (f.type === 'date' ? 'Date' : 'Data'),
        default: f.default === undefined || f.default === null ? '' : String(f.default),
      })),
      total_row: [...(r.total_row || [])],
      add_total_row: r.add_total_row || 0,
      note: r.note || '',
      reason: r.reason || '',
      // 图表：raw 接口给的是**原始配置**（不是 pi×归一化后的派生对象），直接回填即可
      chart: {
        type: (r.chart && r.chart.type) || '',
        x: (r.chart && r.chart.x) || '',
        y: (r.chart && Array.isArray(r.chart.y)) ? [...r.chart.y] : [],
        agg: (r.chart && r.chart.agg) || 'sum',
        limit: (r.chart && r.chart.limit) || 12,
        granularity: (r.chart && r.chart.granularity) || 'auto',
        title: (r.chart && r.chart.title) || '',
      },
      is_seed: r.is_seed,
    }
    dirty.value = false
  } catch (e) {
    previewErr.value = (e && e.message) || '读取报表定义失败'
  }
}

/* 合计勾选：用 total_row 显式清单表达。
   不勾任何一列 = 不出合计行（后端 add_total_row=0 且 total_row 为空）。 */
function inTotals(key) {
  return !!(draft.value && draft.value.total_row.includes(key))
}
function canTotal(c) {
  return TOTALABLE.includes(c.fieldtype)
}
function toggleTotal(key, on) {
  if (!draft.value) return
  const s = new Set(draft.value.total_row)
  if (on) s.add(key); else s.delete(key)
  draft.value.total_row = [...s]
  dirty.value = true
}

/* ---- 图表 ---- */
const numCols = computed(() => ((draft.value && draft.value.columns) || [])
  .filter(c => TOTALABLE.includes(c.fieldtype)))

function onChartType() {
  const ch = draft.value && draft.value.chart
  if (!ch) return
  if (!ch.type) {
    // 关掉图：把轴清干净，否则存下去是一份"没图形但有轴"的残配置
    ch.x = ''; ch.y = []; ch.title = ''
  } else if (!ch.limit) {
    ch.limit = 12
  }
  dirty.value = true
}

function toggleY(key, on) {
  const ch = draft.value && draft.value.chart
  if (!ch) return
  const s = new Set(ch.y)
  if (on) s.add(key); else s.delete(key)
  ch.y = [...s]
  dirty.value = true
}

/* 保存前就把「后端一定会拒」的组合说出来。
   后端 `_norm_chart(strict=True)` 也会 400，但那要等点了保存才看到 ——
   能提前提示的错误不该留到最后一刻。 */
const chartWarn = computed(() => {
  const ch = draft.value && draft.value.chart
  if (!ch || !ch.type) return ''
  const picked = ((draft.value && draft.value.columns) || []).filter(c => ch.y.includes(c.key))
  const fts = picked.map(c => c.fieldtype)
  if (fts.includes('Percent') && new Set(fts).size > 1) {
    return '百分比列不能和金额/数量画在同一根轴上：量级差 100 倍，图上看不出东西'
  }
  if ((ch.type === 'donut' || ch.type === 'hbar') && ch.y.length > 1) {
    return '环形图和条形图只画第一个纵轴列。要么去掉多余的，要么换成折线/柱状图'
  }
  return ''
})

/* 试跑图的渲染：和 GenericReport 同一套映射（两处必须一致，否则"编辑器里好好的、
   报表页上画歪了"这种问题极难查） */
const previewChartComp = computed(() => {
  const t = previewChart.value && previewChart.value.type
  return t === 'line' ? ChartLine
    : t === 'bar' ? ChartBar
    : t === 'hbar' ? ChartHbar
    : t === 'donut' ? ChartDonut : null
})
const previewChartProps = computed(() => {
  const c = previewChart.value || {}
  const labels = c.labels || []
  const series = (c.datasets || []).map(d => ({
    name: d.name || '', data: (d.values || d.data || []).map(v => Number(v) || 0),
  }))
  if (c.type === 'hbar' || c.type === 'donut') {
    const s = series[0] || { data: [] }
    const items = labels.map((lb, i) => ({ label: String(lb), value: Number(s.data[i]) || 0 }))
    const base = { items, total: c.type === 'donut' ? items.reduce((a, b) => a + b.value, 0) : 0 }
    // 与 GenericReport 一致：横条图的名称列放宽到 168，商品名才认得出来
    return c.type === 'hbar' ? { ...base, nameW: 168 } : base
  }
  // 与 GenericReport 保持一致：折线不从 0 起（看走势），柱子零基线
  if (c.type === 'line') return { labels, series, zeroBase: false }
  return { labels, series }
})

function addColumn() {
  draft.value.columns.push({ key: '', label: '', fieldtype: 'Data', width: '' })
  dirty.value = true
}
function addFilter() {
  draft.value.filters.push({ key: '', label: '', fieldtype: 'Date', default: '' })
  dirty.value = true
}
function move(i, d) {
  const a = draft.value.columns
  const j = i + d
  if (j < 0 || j >= a.length) return
  const t = a[i]; a[i] = a[j]; a[j] = t
  dirty.value = true
}

/* 按 SQL 结果补全列：只**追加**缺的，不改已有列的标签/类型（人的设置优先）。
   类型靠第一行非空值猜 —— 猜错可以在上面直接改，总比让老板从空白开始填要好。 */
function syncFromResult() {
  if (!draft.value) return
  const have = new Set(draft.value.columns.map(c => c.key))
  let added = 0
  for (const k of previewCols.value) {
    if (have.has(k)) continue
    draft.value.columns.push({ key: k, label: k, fieldtype: guessFt(k), width: '' })
    added++
  }
  if (added) dirty.value = true
  if (!added) alert('SQL 返回的列都已经在列定义里了')
}
function guessFt(key) {
  for (const r of previewRows.value) {
    const v = r[key]
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'number') return Number.isInteger(v) ? 'Int' : 'Float'
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return 'Date'
    return 'Data'
  }
  return 'Data'
}

function payload() {
  const d = draft.value
  return {
    title: d.title,
    path: d.path,
    kind: d.kind,
    sql: d.sql,
    columns: d.columns.filter(c => c.key).map(c => ({
      key: c.key, label: c.label || c.key,
      fieldtype: c.fieldtype, width: c.width || '',
    })),
    filters: d.filters.filter(f => f.key),
    total_row: d.total_row,
    add_total_row: d.total_row.length ? 1 : 0,
    note: d.note,
    reason: d.reason,
    // 没选图形 = 不出图，显式传空对象（不传会让后端沿用旧值，等于"删不掉图"）
    chart: d.chart.type ? {
      type: d.chart.type,
      x: d.chart.x,
      y: d.chart.y,
      agg: d.chart.agg,
      limit: Number(d.chart.limit) || 12,
      granularity: d.chart.granularity || 'auto',
      title: d.chart.title || '',
    } : {},
  }
}

async function runPreview() {
  if (!draft.value) return
  running.value = true
  previewErr.value = ''
  try {
    const r = await reportEngineApi.preview(payload())
    previewRows.value = r.rows || []
    previewCols.value = r.result_columns || (r.columns || []).map(c => c.key)
    previewCount.value = r.row_count || 0
    previewMs.value = r.elapsed_ms || 0
    previewChart.value = r.chart || null
    if (!previewRows.value.length && !r.row_count) {
      previewErr.value = ''
      alert('SQL 跑通了，但当前没有任何数据（不是报错）。换个日期范围再试，或确认表里确实还没数据。')
    }
  } catch (e) {
    previewErr.value = (e && e.message) || '试跑失败'
    previewRows.value = []; previewCols.value = []
  } finally {
    running.value = false
  }
}

async function save() {
  if (!draft.value) return
  const ok = confirm(
    '确认保存「' + draft.value.title + '」的报表口径？\n\n' +
    '· 保存后所有打开这张报表的人看到的数都会变；\n' +
    '· 保存前会自动试跑一次，跑不通不会保存；\n' +
    '· 旧的 SQL 会整段写进审计日志，可以据此回滚。'
  )
  if (!ok) return
  saving.value = true
  previewErr.value = ''
  try {
    await reportEngineApi.save(draft.value.name, payload())
    dirty.value = false
    draft.value.is_seed = 0
    await loadList()
    alert('已保存。这张报表现在是「人工维护」，系统升级不会再覆盖它。')
  } catch (e) {
    previewErr.value = (e && e.message) || '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(loadList)
</script>

<style scoped>
.rb-acts { display: flex; gap: 8px; align-items: center }
.rb-save { background: var(--pri, #2b6cb0); color: #fff; border: 1px solid var(--pri, #2b6cb0) }
.rb-save:disabled { opacity: .45 }

.rb-layout { display: grid; grid-template-columns: 268px minmax(0, 1fr); gap: 14px; align-items: start }
@media (max-width: 1080px) { .rb-layout { grid-template-columns: 1fr } }

.rb-list { position: sticky; top: 12px; max-height: calc(100vh - 150px); display: flex; flex-direction: column }
.rb-list-hd {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-bottom: 1px solid var(--line, #eef0f3);
  font-size: 12.5px; font-weight: 600; color: var(--t1);
}
.rb-list-cnt { font-size: 11.5px; font-weight: 400; color: var(--t3) }
.rb-list-body { overflow-y: auto; padding: 6px }
.rb-list-empty { padding: 14px; font-size: 12px; color: var(--t3) }

.rb-item {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  width: 100%; padding: 7px 9px; margin-bottom: 2px; border: 0; border-radius: 6px;
  background: transparent; cursor: pointer; text-align: left;
  font-size: 12.5px; color: var(--t1);
}
.rb-item:hover { background: var(--bg2, #f6f7f9) }
.rb-item.on { background: var(--pri-w, #eaf1fb); color: var(--pri, #2b6cb0); font-weight: 600 }
.rb-item-t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.rb-item-s { font-size: 10.5px; padding: 1px 5px; border-radius: 999px; flex-shrink: 0 }
.s-ok { background: #e6f6ec; color: #1f7a3f }
.s-warn { background: #fdf3e2; color: #a9741a }
.s-off { background: var(--bg3, #eef0f3); color: var(--t3) }

.rb-edit { display: flex; flex-direction: column; gap: 12px; min-width: 0 }
.rb-sec { padding: 14px 16px }
.rb-sec-hd {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  font-size: 13px; font-weight: 600; color: var(--t1); margin-bottom: 10px; flex-wrap: wrap;
}
.rb-sec-note { font-size: 11.5px; font-weight: 400; color: var(--t3) }
.rb-sec-note b { color: var(--war, #b8791a) }
.rb-sec-note code, .rb-hint code, .rb-params-empty code {
  background: var(--bg2); padding: 1px 4px; border-radius: 3px; font-size: 11px;
}

.rb-badge { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: var(--bg3, #eef0f3); color: var(--t3) }
.rb-badge-manual { background: #fdf3e2; color: #a9741a }

.rb-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px }
@media (max-width: 760px) { .rb-grid2 { grid-template-columns: 1fr } }
.rb-fld { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--t3) }
.rb-in {
  padding: 6px 8px; font-size: 12.5px; border-radius: 6px;
  border: 1px solid var(--line, #dcdfe6); background: var(--bg1, #fff); color: var(--t1);
  min-width: 0;
}
.rb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px }
.rb-hint { margin-top: 8px; font-size: 11.5px; color: var(--t3); line-height: 1.8 }

.rb-sql {
  width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--line, #dcdfe6); background: var(--bg2, #fafbfc); color: var(--t1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.7;
  resize: vertical;
}

.rb-params { margin-top: 12px }
.rb-params-hd { display: block; font-size: 11.5px; color: var(--t3); margin-bottom: 6px }
.rb-params-empty { font-size: 11.5px; color: var(--t3); padding: 6px 0 10px }
.rb-param { display: grid; grid-template-columns: 1fr 1fr 92px 1fr 24px; gap: 6px; margin-bottom: 6px }

.rb-cols { display: flex; flex-direction: column; gap: 4px }
.rb-col {
  display: grid; grid-template-columns: 1.1fr 1.3fr 104px 84px 40px 76px;
  gap: 6px; align-items: center;
}
.rb-col-hd { font-size: 11px; color: var(--t3); padding: 0 2px 2px }
.rb-col-ops { display: flex; gap: 2px }
.rb-x {
  width: 22px; height: 22px; line-height: 1; padding: 0; border: 1px solid var(--line, #dcdfe6);
  background: var(--bg1, #fff); color: var(--t2); border-radius: 4px; cursor: pointer; font-size: 12px;
}
.rb-x:disabled { opacity: .35; cursor: default }
.rb-col input[type="checkbox"] { width: 15px; height: 15px }

.rb-cols-ops { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap }
.rb-hint-inline { font-size: 11.5px; color: var(--t3) }

/* 图表配置行：label 固定 60px，右边控件自然对齐 —— 不固定的话每行 label 宽度不同，
   下拉框会错位，看着像没做完。 */
.rb-chart-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap }
.rb-chart-row > label:first-child { width: 60px; flex: none; font-size: 11.5px; color: var(--t3) }
.rb-in-wide { min-width: 260px; flex: 1; max-width: 420px }
.rb-in-num { width: 68px; flex: none }
.rb-inline-lab { font-size: 11.5px; color: var(--t3); margin-left: 4px }
.rb-chart-checks { display: flex; gap: 12px; flex-wrap: wrap; align-items: center }
.rb-chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t2); cursor: pointer }
.rb-chk input { width: 15px; height: 15px }
.rb-chart-warn {
  display: flex; align-items: center; gap: 6px; margin: 10px 0 0;
  font-size: 11.5px; color: #a9741a; background: #fdf3e2; padding: 7px 10px; border-radius: 6px;
}
.rb-fig-prev { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line, #dcdfe6) }
.rb-fig-hd { font-size: 11.5px; color: var(--t3); margin-bottom: 8px }

.rb-note {
  width: 100%; box-sizing: border-box; padding: 9px 11px; border-radius: 8px;
  border: 1px solid var(--line, #dcdfe6); background: var(--bg1, #fff); color: var(--t1);
  font-size: 12.5px; line-height: 1.9; resize: vertical;
}

.rb-err { padding: 12px 14px; border-left: 3px solid var(--danger, #d64545); background: var(--bg2) }
.rb-err-hd { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--danger, #d64545) }
.rb-err p { margin: 6px 0 0; font-size: 12px; line-height: 1.8; color: var(--t2); word-break: break-all }

.rb-hollow { padding: 28px 24px; text-align: center }
.rb-hollow h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--t1) }
.rb-hollow p { font-size: 12.5px; color: var(--t2); line-height: 1.9 }

.rb-foot { margin: 14px 2px 0; font-size: 11.5px; line-height: 1.9; color: var(--t3) }
.rb-foot code { background: var(--bg2); padding: 1px 5px; border-radius: 4px }
</style>
