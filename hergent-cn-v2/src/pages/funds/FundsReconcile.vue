<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>对账工作台</h2><span class="page-sub">上传银行流水与舟谱明细两份表格，自动逐笔勾对；未匹配项按「渠道有·内部无 / 内部有·渠道无」分象限列出</span></div>
      <div class="frc-acts">
        <button v-if="result" class="btn btn-ghost btn-sm" @click="exportCsv"><Icon name="file-text" :size="14" />导出结果（CSV）</button>
        <button class="btn btn-ghost btn-sm" :disabled="running" @click="run"><Icon name="refresh" :size="14" />{{ running ? '对账中…' : '开始对账' }}</button>
      </div>
    </div>

    <!-- 第一步：上传两侧 -->
    <div class="frc-step">第一步 · 上传两份表格（内部侧 = 舟谱/系统明细，外部侧 = 银行/渠道流水）</div>
    <div class="frc-sides">
      <div v-for="k in sideKeys" :key="k" class="card frc-side">
        <div class="frc-side-hd">
          <span class="frc-side-tag" :class="k === 'a' ? 'frc-tag-a' : 'frc-tag-b'">{{ sides[k].label }}</span>
          <span v-if="sides[k].fileName" class="frc-file">{{ sides[k].fileName }}</span>
        </div>

        <div class="frc-frow">
          <input type="file" accept=".xlsx,.csv" class="input frc-file-input" @change="onFile(k, $event)">
          <span class="frc-hint">支持 Excel（.xlsx）与 CSV，不超过 10MB</span>
        </div>
        <div v-if="sides[k].uploadErr" class="frc-err">{{ sides[k].uploadErr }}</div>

        <template v-if="sides[k].sheets.length">
          <div class="frc-frow">
            <label>工作表
              <select v-model="sides[k].sheet" class="input" @change="reloadRows(k)">
                <option v-for="s in sides[k].sheets" :key="s.name" :value="s.name">{{ s.name }}（{{ s.rows }} 行）</option>
              </select>
            </label>
          </div>
          <div class="frc-frow">
            <label>表头行（表头不在第 1 行时必须选对）
              <select v-model.number="sides[k].headerRow" class="input" @change="reloadRows(k)">
                <option v-for="(hr, i) in headOptions(sides[k])" :key="i" :value="hr.value">第 {{ hr.value + 1 }} 行{{ hr.text ? '：' + hr.text : '' }}</option>
              </select>
            </label>
          </div>
          <div class="frc-head-preview">
            <div class="frc-hp-lb">原始行预览（点击行首圆点选定表头行）</div>
            <div class="table-wrap frc-hp-wrap">
              <table class="tbl frc-hp-tbl">
                <tbody>
                  <tr v-for="(row, i) in sides[k].head" :key="i" :class="{ 'frc-hp-on': sides[k].headerRow === i }" @click="sides[k].headerRow = i; reloadRows(k)">
                    <td class="frc-hp-radio"><span class="frc-radio" :class="{ on: sides[k].headerRow === i }"></span></td>
                    <td v-for="(c, j) in row.slice(0, 8)" :key="j" :title="String(c)">{{ c === '' || c === null ? '·' : c }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <div v-if="sides[k].loadingRows" class="frc-hint">正在读取数据…</div>
        <div v-else-if="sides[k].loaded" class="frc-loaded">
          <span class="frc-ok">✅ 已读取 {{ sides[k].rowCount }} 行数据（文件共 {{ sides[k].totalRows }} 行，{{ sides[k].columns.length }} 列）</span>
          <span v-if="sides[k].suggest && sides[k].suggest.confidence" class="frc-sug">自动认出 {{ sides[k].suggest.confidence }} 个关键列</span>
          <label v-if="sides[k].totalHints.length" class="frc-chk">
            <input type="checkbox" v-model="sides[k].skipTotals">跳过检测到的合计行（{{ sides[k].totalHints.map(h => '第' + h.row_index + '行「' + h.value + '」').join('、') }}）
          </label>
        </div>
        <div v-if="sides[k].loadErr" class="frc-err">{{ sides[k].loadErr }}</div>
      </div>
    </div>

    <!-- 第二步：列映射 -->
    <template v-if="bothLoaded">
      <div class="frc-step">第二步 · 确认列映射（自动猜列只是建议，以你确认为准）</div>
      <div class="frc-sides">
        <div v-for="k in sideKeys" :key="k" class="card frc-side">
          <div class="frc-side-hd">
            <span class="frc-side-tag" :class="k === 'a' ? 'frc-tag-a' : 'frc-tag-b'">{{ sides[k].label }}</span>
            <span class="frc-presets">
              <button v-for="p in presets" :key="p.name" class="btn btn-ghost btn-sm" @click="applyPreset(k, p)">{{ p.name }}</button>
            </span>
          </div>
          <div class="frc-frow">
            <label>金额列布局
              <select v-model="sides[k].map.mode" class="input">
                <option value="two_col">收支两列（收入列 / 支出列分开）</option>
                <option value="one_col_dir">单金额列 + 方向列（如微信账单「收/支」）</option>
              </select>
            </label>
          </div>
          <div class="frc-frow frc-map-grid">
            <label>日期列（必选）
              <select v-model="sides[k].map.date_col" class="input" :class="{ 'frc-miss': !sides[k].map.date_col }">
                <option value="">请选择</option>
                <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <template v-if="sides[k].map.mode === 'two_col'">
              <label>收入列
                <select v-model="sides[k].map.in_col" class="input" :class="{ 'frc-miss': !sides[k].map.in_col && !sides[k].map.out_col }">
                  <option value="">无此列</option>
                  <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
                </select>
              </label>
              <label>支出列
                <select v-model="sides[k].map.out_col" class="input" :class="{ 'frc-miss': !sides[k].map.in_col && !sides[k].map.out_col }">
                  <option value="">无此列</option>
                  <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
                </select>
              </label>
            </template>
            <template v-else>
              <label>金额列（必选）
                <select v-model="sides[k].map.amount_col" class="input" :class="{ 'frc-miss': !sides[k].map.amount_col }">
                  <option value="">请选择</option>
                  <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
                </select>
              </label>
              <label>方向列（必选）
                <select v-model="sides[k].map.direction_col" class="input" :class="{ 'frc-miss': !sides[k].map.direction_col }">
                  <option value="">请选择</option>
                  <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
                </select>
              </label>
            </template>
            <label>对方列（影响组合匹配判断）
              <select v-model="sides[k].map.counterparty_col" class="input">
                <option value="">无此列</option>
                <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label>单号列（选填）
              <select v-model="sides[k].map.key_col" class="input">
                <option value="">无此列</option>
                <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label>手续费列（选填）
              <select v-model="sides[k].map.fee_col" class="input">
                <option value="">无此列</option>
                <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label>备注列（选填）
              <select v-model="sides[k].map.note_col" class="input">
                <option value="">无此列</option>
                <option v-for="c in sides[k].columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <!-- 第三步：规则 -->
      <div class="frc-step">第三步 · 对账规则（默认值即常用口径，可按需调整）</div>
      <div class="card frc-spec">
        <div class="frc-frow">
          <label>日期容差（天）<input type="number" min="0" max="7" v-model.number="spec.dateTolerance" class="input frc-num"></label>
          <label>金额容差（元）<input type="number" min="0" step="0.01" v-model.number="spec.amountTolerance" class="input frc-num"></label>
          <label>组合匹配（一笔对多笔）
            <select v-model="spec.combinationMode" class="input">
              <option value="candidate">只给候选，不自动判平（推荐）</option>
              <option value="match">自动判平</option>
              <option value="off">关闭</option>
            </select>
          </label>
        </div>
        <div class="frc-frow">
          <label class="frc-chk"><input type="checkbox" v-model="spec.netRefunds">退款冲减（同对方、同额、反号的成对冲减）</label>
          <label class="frc-chk"><input type="checkbox" v-model="spec.feeAware">手续费感知（差额恰等于手续费时判为已匹配）</label>
          <label class="frc-chk"><input type="checkbox" v-model="spec.excludeWithdraw">排除提现等跨账户动作（不计入本账户对账）</label>
        </div>
      </div>

      <div class="frc-run">
        <button class="btn btn-primary btn-sm" :disabled="!canRun || running" @click="run">
          <Icon name="refresh" :size="14" />{{ running ? '对账中…' : '开始对账' }}
        </button>
        <span v-if="!canRun" class="frc-run-hint">{{ runBlockReason }}</span>
      </div>
    </template>

    <div v-if="runErr" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ runErr }}</p></div>

    <!-- 结果 -->
    <template v-if="result">
      <div class="frc-step">对账结果</div>

      <div v-if="zeroMatch" class="frc-warn">
        <Icon name="alert-triangle" :size="16" />两侧都有数据，但 <b>0 笔匹配</b>。请检查：列映射是否选对（尤其日期/金额列）、日期容差是否过小、两侧是否本来就不是同一口径（如拿银行流水对银行流水）。
      </div>
      <div v-if="droppedA || droppedB" class="frc-note">
        未进入对账的行：内部侧 {{ droppedA }} 行、外部侧 {{ droppedB }} 行（原因：方向或金额无法识别、金额为 0、命中跳过/排除规则）。这些行不出现在下方任何象限里。
      </div>
      <div v-if="candCount" class="frc-note">有 {{ candCount }} 组组合候选（一笔对多笔的线索）。按规则默认<b>不自动判平</b>，请人工确认后再处理。</div>

      <div class="card kpi-strip cols-4">
        <div class="kpi"><div class="kpi-label">已匹配</div><div class="kpi-val val-ok">{{ stats.matched_groups || 0 }} 组</div><div class="kpi-sub">渠道侧口径 ¥{{ fmtMoney(stats.matched_external_amount || 0) }}</div></div>
        <div class="kpi"><div class="kpi-label">渠道有 · 内部无</div><div class="kpi-val val-bad">{{ (stats.only_external_in_rows || 0) + (stats.only_external_out_rows || 0) }} 笔</div><div class="kpi-sub">银行收了/付了，系统里没有</div></div>
        <div class="kpi"><div class="kpi-label">内部有 · 渠道无</div><div class="kpi-val val-bad">{{ (stats.only_internal_in_rows || 0) + (stats.only_internal_out_rows || 0) }} 笔</div><div class="kpi-sub">系统里有，银行没见到</div></div>
        <div class="kpi"><div class="kpi-label">组合候选 / 已排除</div><div class="kpi-val">{{ candCount }} / {{ stats.excluded_rows || 0 }}</div><div class="kpi-sub">候选不判平；排除含提现等跨账户动作</div></div>
      </div>

      <div class="card frc-card">
        <div class="frc-frow frc-filter">
          <label>显示
            <select v-model="groupFilter" class="input">
              <option value="diff">仅差异（未匹配）</option>
              <option value="all">全部（含已匹配）</option>
              <option value="cand">仅组合候选</option>
            </select>
          </label>
          <span class="frc-hint">共 {{ filteredGroups.length }} 组</span>
        </div>
        <div v-if="!filteredGroups.length" class="state-empty">没有符合条件的组。</div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead><tr><th class="seq-th">组号</th><th>类型</th><th>方向</th><th class="num">渠道侧金额</th><th class="num">内部侧金额</th><th class="num">差额</th><th>日期</th><th>对方</th><th>说明</th></tr></thead>
            <tbody>
              <template v-for="g in filteredGroups" :key="g.group_no">
                <tr @click="toggleGroup(g.group_no)" :class="{ 'frc-open': openGroup === g.group_no }">
                  <td class="seq-cell"><span class="seq-num">{{ g.group_no }}</span></td>
                  <td><span class="tag" :class="kindTag(g.kind)">{{ kindLabel(g.kind) }}</span></td>
                  <td>{{ g.direction === 'in' ? '收入' : '支出' }}</td>
                  <td class="num">¥{{ fmtMoney(g.external_amount) }}</td>
                  <td class="num">¥{{ fmtMoney(g.internal_amount) }}</td>
                  <td class="num" :class="g.diff ? 'val-bad' : ''">{{ g.diff ? (g.diff > 0 ? '+' : '') + fmtMoney(g.diff) : '—' }}</td>
                  <td>{{ groupDate(g) || '—' }}</td>
                  <td>{{ groupCp(g) || '—' }}</td>
                  <td class="frc-note-cell" :title="g.note">{{ g.note || '—' }}</td>
                </tr>
                <tr v-if="openGroup === g.group_no" class="frc-detail">
                  <td colspan="9">
                    <div class="frc-detail-cols">
                      <div>
                        <div class="frc-d-lb">渠道侧明细（{{ g.external_count }} 笔）</div>
                        <div class="table-wrap"><table class="tbl">
                          <thead><tr><th>日期</th><th class="num">金额</th><th>对方</th><th>单号</th><th>备注</th></tr></thead>
                          <tbody>
                            <tr v-for="(r, i) in g.external_rows" :key="'e' + i">
                              <td>{{ r.date }}</td><td class="num">¥{{ fmtMoney(r.amount) }}</td><td>{{ r.counterparty || '—' }}</td><td>{{ r.key || '—' }}</td><td>{{ r.note || '—' }}</td>
                            </tr>
                            <tr v-if="!g.external_rows.length"><td colspan="5" class="frc-empty">无</td></tr>
                          </tbody>
                        </table></div>
                      </div>
                      <div>
                        <div class="frc-d-lb">内部侧明细（{{ g.internal_count }} 笔）</div>
                        <div class="table-wrap"><table class="tbl">
                          <thead><tr><th>日期</th><th class="num">金额</th><th>对方</th><th>单号</th><th>备注</th></tr></thead>
                          <tbody>
                            <tr v-for="(r, i) in g.internal_rows" :key="'i' + i">
                              <td>{{ r.date }}</td><td class="num">¥{{ fmtMoney(r.amount) }}</td><td>{{ r.counterparty || '—' }}</td><td>{{ r.key || '—' }}</td><td>{{ r.note || '—' }}</td>
                            </tr>
                            <tr v-if="!g.internal_rows.length"><td colspan="5" class="frc-empty">无</td></tr>
                          </tbody>
                        </table></div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 资金管理 · 对账工作台（v528 · P1-4 自动勾对）。
   🔴 架构红线（承 v198 recon_engine 设计）：
     · 本页**不做任何匹配判定** —— 比对 100% 走后端 `/api/reconciliation/statement`
       → recon_engine.reconcile（确定性算子）。前端只负责：上传、选表头行、收集列映射、
       展示四象限与差异组。
     · 自动猜列（后端 suggest）只是**建议**，必须经人确认后才生效 ⇒ 映射表单可改。
     · 组合匹配默认「只给候选、不自动判平」（算法不得擅自判平，R1）。
     · 「0 笔匹配」「有行未进入对账」必须显式告警 —— 不许把空报告说成"账是对的"。
   🔴 复用全局件：.page/.page-hd/.card/.kpi-strip/.tbl/.table-wrap/.tag/.state-*；私有类 frc- 前缀。 */
import { ref, reactive, computed } from 'vue'
import Icon from '../../components/Icon.vue'
import { reconcileApi } from '../../api/reconcile'
import { fmtMoney } from '../../constants/psiLabels'

const sideKeys = ['a', 'b']

function _blankSide(label) {
  return {
    label,
    fileName: '', uploading: false, uploadErr: '',
    sheets: [], sheet: '', headerRow: 0, head: [],
    loadingRows: false, loaded: false, loadErr: '',
    columns: [], rows: [], rowCount: 0, totalRows: 0,
    suggest: null, totalHints: [], skipTotals: true,
    mapTouched: false,
    map: { mode: 'two_col', date_col: '', in_col: '', out_col: '', amount_col: '', direction_col: '', counterparty_col: '', key_col: '', note_col: '', fee_col: '' },
  }
}
const sides = reactive({ a: _blankSide('内部侧 · 舟谱/系统明细'), b: _blankSide('外部侧 · 银行/渠道流水') })

const spec = reactive({
  dateTolerance: 1, amountTolerance: 0.01,
  combinationMode: 'candidate', netRefunds: true, feeAware: true, excludeWithdraw: false,
})

const running = ref(false)
const runErr = ref('')
const result = ref(null)
const groupFilter = ref('diff')
const openGroup = ref(0)

/* ---------- 预设（点一下按常见列名填映射；列不存在则跳过该字段） ---------- */
const presets = [
  { name: '舟谱账户明细', map: { mode: 'two_col', date_col: '单据时间', in_col: '收入金额', out_col: '支出金额', counterparty_col: '往来单位', key_col: '单据编号', note_col: '备注' } },
  { name: '银行流水', map: { mode: 'two_col', date_col: '交易日期', in_col: '收入金额', out_col: '支出金额', counterparty_col: '对方户名', fee_col: '手续费', note_col: '摘要' } },
  { name: '微信账单', map: { mode: 'one_col_dir', date_col: '交易时间', amount_col: '金额(元)', direction_col: '收/支', counterparty_col: '交易对方', note_col: '备注' } },
]

function applyPreset(k, p) {
  const s = sides[k]
  for (const [field, col] of Object.entries(p.map)) {
    if (field === 'mode') { s.map.mode = col; continue }
    if (s.columns.includes(col)) s.map[field] = col
  }
  s.mapTouched = true
}

/* ---------- 上传 → 预览原始行 ---------- */
async function onFile(k, ev) {
  const file = ev.target.files && ev.target.files[0]
  ev.target.value = ''           // 允许再次选同一文件
  if (!file) return
  const s = sides[k]
  s.uploadErr = ''
  s.uploading = true
  try {
    const d = await reconcileApi.upload(file)
    if (!d || !d.file_id) throw new Error(d && d.detail ? d.detail : '上传失败')
    s.fileId = d.file_id
    s.fileName = d.file_name || file.name
    s.loaded = false; s.loadErr = ''; s.mapTouched = false
    const pk = await reconcileApi.peek(d.file_id)
    s.sheets = (pk.sheets || []).map(x => ({ name: x.name, rows: x.rows, head: x.head }))
    if (!s.sheets.length) throw new Error('文件里没有可用工作表')
    s.sheet = s.sheets[0].name
    await loadRows(k)
  } catch (e) {
    s.uploadErr = e.message || '上传失败'
  } finally {
    s.uploading = false
  }
}

function headOptions(s) {
  return s.head.map((row, i) => ({
    value: i,
    text: (row || []).filter(c => c !== '' && c !== null && c !== undefined).slice(0, 3).join(' / ').slice(0, 24),
  }))
}

async function reloadRows(k) {
  const s = sides[k]
  if (!s.fileId) return
  await loadRows(k)
}

/* ---------- 按选定表头行读全量 + 猜列建议 ---------- */
async function loadRows(k) {
  const s = sides[k]
  if (!s.fileId) return
  s.loadingRows = true; s.loadErr = ''
  try {
    const d = await reconcileApi.rows(s.fileId, s.sheet, s.headerRow)
    // 🔴 必须 await（v533 修 v528 线上真实报错）：`await_cached_head` 是 async ⇒ 漏 await 时
    //    `(p || [])` 会把 Promise 本身（truthy）塞进 s.head ⇒ 渲染 `s.head.map is not a function`。
    const _hd = await await_cached_head(s)
    s.head = Array.isArray(_hd) ? _hd : []
    s.columns = d.columns || []
    s.rows = d.rows || []
    s.rowCount = d.row_count || 0
    s.totalRows = d.total_rows || 0
    s.suggest = d.suggest || null
    s.totalHints = d.total_hints || []
    s.skipTotals = s.totalHints.length > 0
    s.loaded = true
    // 猜列建议只在人没手动改过映射时预填（不覆盖人的确认）
    if (!s.mapTouched && d.suggest) {
      const m = d.suggest
      s.map.mode = m.mode || 'two_col'
      s.map.date_col = m.date_col || ''
      s.map.in_col = m.in_col || ''
      s.map.out_col = m.out_col || ''
      s.map.amount_col = m.amount_col || ''
      s.map.direction_col = m.direction_col || ''
      s.map.counterparty_col = m.counterparty_col || ''
      s.map.key_col = m.key_col || ''
      s.map.note_col = m.note_col || ''
      s.map.fee_col = m.fee_col || ''
    }
  } catch (e) {
    s.loadErr = e.message || '读取失败'
    s.loaded = false
  } finally {
    s.loadingRows = false
  }
}

/* peek 的原始行预览：file-peek 已给 head，这里在 loadRows 后同步刷新一次
   （headerRow 变化时 peek 不变，但 head 数组需要与 sheet 对应） */
async function await_cached_head(s) {
  if (!s.fileId) return []
  // 优先用 onFile 时同一份 peek 已带回的 head：省一次请求，也免"重发 peek 结果不同"的竞态
  const cached = (s.sheets || []).find(x => x.name === s.sheet)
  if (cached && Array.isArray(cached.head)) return cached.head
  try {
    const pk = await reconcileApi.peek(s.fileId)
    const one = (pk.sheets || []).find(x => x.name === s.sheet)
    return one && Array.isArray(one.head) ? one.head : []
  } catch (_) { return [] }
}

/* ---------- 就绪判定 ---------- */
function sideReady(s) {
  if (!s.loaded || !s.rowCount) return false
  const m = s.map
  if (!m.date_col) return false
  if (m.mode === 'two_col') return !!(m.in_col || m.out_col)
  return !!(m.amount_col && m.direction_col)
}
const bothLoaded = computed(() => sides.a.loaded && sides.b.loaded)
const canRun = computed(() => sideReady(sides.a) && sideReady(sides.b))
const runBlockReason = computed(() => {
  if (!sides.a.loaded || !sides.a.rowCount) return '内部侧还没有数据'
  if (!sides.b.loaded || !sides.b.rowCount) return '外部侧还没有数据'
  if (!sideReady(sides.a)) return '内部侧列映射不完整（见第二步红色项）'
  if (!sideReady(sides.b)) return '外部侧列映射不完整（见第二步红色项）'
  return ''
})

/* ---------- 执行对账 ---------- */
function buildSide(s) {
  const m = s.map
  const side = {
    name: s.label,
    date_col: m.date_col, mode: m.mode,
    counterparty_col: m.counterparty_col, key_col: m.key_col,
    note_col: m.note_col, fee_col: m.fee_col,
  }
  if (m.mode === 'two_col') { side.in_col = m.in_col; side.out_col = m.out_col }
  else { side.amount_col = m.amount_col; side.direction_col = m.direction_col }
  if (s.skipTotals && s.totalHints.length) {
    side.skip_types = s.totalHints.map(h => [h.column, h.value])
  }
  if (spec.excludeWithdraw) {
    side.exclude_rules = [['交易类型', '提现', '跨账户动作：提现到银行卡不计入本账户对账']]
  }
  return side
}

async function run() {
  if (!canRun.value || running.value) return
  running.value = true; runErr.value = ''; result.value = null; openGroup.value = 0
  try {
    const d = await reconcileApi.statement({
      rows_a: sides.a.rows, rows_b: sides.b.rows,
      side_a: buildSide(sides.a), side_b: buildSide(sides.b),
      spec: {
        date_tolerance_days: Number(spec.dateTolerance) || 0,
        amount_tolerance: Number(spec.amountTolerance) || 0,
        combination_mode: spec.combinationMode === 'off' ? 'candidate' : spec.combinationMode,
        max_combination: spec.combinationMode === 'off' ? 1 : 4,
        net_refunds: !!spec.netRefunds,
        fee_aware: !!spec.feeAware,
        driver_side: 'external',
      },
    })
    if (!d || d.ok === false) throw new Error((d && d.detail) || '对账失败')
    result.value = d
  } catch (e) {
    runErr.value = e.message || '对账失败'
  } finally {
    running.value = false
  }
}

/* ---------- 结果展示辅助 ---------- */
const stats = computed(() => (result.value && result.value.stats) || {})
const candCount = computed(() => stats.value.combination_candidates || 0)
const zeroMatch = computed(() => !!result.value && !stats.value.matched_groups && !droppedA.value && !droppedB.value)
/* 行数守卫：文件行数 vs 实际进入对账的行数（stats.*_rows_total）⇒ 差值显式告警 */
const droppedA = computed(() => {
  if (!result.value) return 0
  const entered = stats.value.internal_rows_total || 0
  return Math.max(0, sides.a.rowCount - entered)
})
const droppedB = computed(() => {
  if (!result.value) return 0
  const entered = stats.value.external_rows_total || 0
  return Math.max(0, sides.b.rowCount - entered)
})

const KIND_LABEL = { matched: '已匹配', only_internal: '内部有·渠道无', only_external: '渠道有·内部无', mismatch: '金额不符', excluded: '已排除', combination_candidate: '组合候选' }
function kindLabel(k) { return KIND_LABEL[k] || k }
function kindTag(k) {
  if (k === 'matched') return 'ok'
  if (k === 'combination_candidate') return 'warn'
  if (k === 'excluded') return 'muted'
  return 'bad'
}
const filteredGroups = computed(() => {
  const gs = (result.value && result.value.groups) || []
  if (groupFilter.value === 'all') return gs
  if (groupFilter.value === 'cand') return gs.filter(g => g.kind === 'combination_candidate')
  return gs.filter(g => g.kind === 'only_internal' || g.kind === 'only_external' || g.kind === 'mismatch')
})
function toggleGroup(no) { openGroup.value = openGroup.value === no ? 0 : no }
function groupDate(g) { const r = (g.external_rows && g.external_rows[0]) || (g.internal_rows && g.internal_rows[0]); return r ? r.date : '' }
function groupCp(g) { const r = (g.external_rows && g.external_rows[0]) || (g.internal_rows && g.internal_rows[0]); return r ? r.counterparty : '' }

/* ---------- 导出 CSV（带 BOM，Excel 直接打开不乱码） ---------- */
function exportCsv() {
  const gs = filteredGroups.value
  const head = ['组号', '类型', '方向', '渠道侧金额', '内部侧金额', '差额', '日期', '对方', '说明']
  const lines = [head.join(',')]
  for (const g of gs) {
    const row = [g.group_no, kindLabel(g.kind), g.direction === 'in' ? '收入' : '支出',
      g.external_amount, g.internal_amount, g.diff, groupDate(g) || '', groupCp(g) || '',
      (g.note || '').replace(/"/g, '""')]
    lines.push(row.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = '对账结果-' + new Date().toISOString().slice(0, 10) + '.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<style scoped>
.frc-acts { display: flex; gap: 8px }
.frc-step { font-size: 13px; font-weight: 600; color: var(--t2); margin: 16px 2px 8px }
.frc-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }
@media (max-width: 900px) { .frc-sides { grid-template-columns: 1fr } }
.frc-side { padding: 14px 16px }
.frc-side-hd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px }
.frc-side-tag { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px }
.frc-tag-a { background: rgba(47,107,255,.12); color: var(--brand, #2f6bff) }
.frc-tag-b { background: rgba(245,158,11,.14); color: #b45309 }
.frc-file { font-size: 12px; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px }
.frc-presets { margin-left: auto; display: flex; gap: 4px }
.frc-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 8px }
.frc-frow > label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2) }
.frc-map-grid > label { min-width: 180px; flex: 1 }
.frc-file-input { font-size: 12px; padding: 6px }
.frc-num { width: 90px }
.frc-hint { font-size: 12px; color: var(--t2) }
.frc-err { font-size: 12px; color: var(--bad, #dc2626); margin: 6px 0 }
.frc-miss { border-color: var(--bad, #dc2626) }
.frc-loaded { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; margin-top: 6px }
.frc-ok { color: var(--ok, #16a34a) }
.frc-sug { color: var(--t2) }
.frc-chk { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--t2) }
.frc-head-preview { margin-top: 8px }
.frc-hp-lb { font-size: 12px; color: var(--t2); margin-bottom: 4px }
.frc-hp-wrap { max-height: 180px; border: 1px solid var(--bd); border-radius: 8px }
.frc-hp-tbl { font-size: 12px }
.frc-hp-tbl td { white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis }
.frc-hp-tbl tr { cursor: pointer }
.frc-hp-tbl tr.frc-hp-on { background: rgba(47,107,255,.08) }
.frc-hp-radio { width: 28px; text-align: center }
.frc-radio { display: inline-block; width: 12px; height: 12px; border: 1px solid var(--bd); border-radius: 50% }
.frc-radio.on { border-color: var(--brand, #2f6bff); background: var(--brand, #2f6bff) }
.frc-spec { padding: 14px 16px }
.frc-run { display: flex; gap: 12px; align-items: center; margin: 14px 2px }
.frc-run-hint { font-size: 12px; color: var(--bad, #dc2626) }
.frc-warn { display: flex; gap: 8px; align-items: flex-start; background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.35); color: #92400e; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px }
.frc-note { font-size: 12px; color: var(--t2); background: var(--bg1); border: 1px solid var(--bd); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px }
.frc-card { padding: 0; overflow: hidden }
.frc-filter { padding: 12px 14px 0 }
.frc-note-cell { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.frc-detail td { background: var(--bg1) }
.frc-detail-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }
@media (max-width: 900px) { .frc-detail-cols { grid-template-columns: 1fr } }
.frc-d-lb { font-size: 12px; font-weight: 600; color: var(--t2); margin-bottom: 4px }
.frc-empty { color: var(--t2); text-align: center }
</style>
