<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>库存效期补录</h2>
        <span class="page-sub">补齐库存批次效期 · 一次补录，长期受益</span>
      </div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd"><b>库存批次效期</b></div>
      <p class="df-tip">
        货损工作流按「到期日」算损耗，预报按「可销天数」算缺货。库存里没有效期的批次，AI 就算不准。
        从舟谱导出库存 Excel，或按下面模板填写后导入。
      </p>
      <p class="df-tip df-warn">仅支持 Excel 文件（.xlsx / .xls）。下载的 CSV 模板请用 Excel 打开填写后<b>另存为 .xlsx</b> 再上传。</p>
      <div class="df-import-row">
        <button class="btn btn-ghost" @click="downloadInvTemplate">下载模板</button>
        <!-- v335 按钮级门禁：整条导入链的写动作是 POST /api/import/execute ⇒ 模块 data / 动作 create。
             「下一步」本身是 /api/import/preview（只读 POST，后端 `_READ_ONLY_POST` 纠偏成 read）⇒ 不门禁；
             但只读预览没有落库能力，所以「选择文件」一并按 create 收起 —— 否则用户能一路填到
             最后一步才发现「确认导入」不见了。 -->
        <label v-if="canDo('data', 'create')" class="btn btn-ghost df-file-btn">
          选择文件
          <input type="file" accept=".xlsx,.xls" style="display:none" @change="onInvFile">
        </label>
        <span v-if="invFileName" class="df-fname">{{ invFileName }}</span>
        <button v-if="impStep === 'pick'" class="btn btn-primary" :disabled="!invFile || importing" @click="previewInv">
          {{ importing ? '识别中…' : '下一步' }}
        </button>
      </div>
      <div v-if="impStep === 'map'" class="df-map">
        <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions"
                       :memory="impMemory" v-model:incremental="impInc" />
        <div class="df-import-row">
          <button class="btn btn-ghost" :disabled="importing" @click="impStep = 'pick'">返回</button>
          <button v-if="canDo('data', 'create')" class="btn btn-primary" :disabled="importing" @click="doImportInv">
            {{ importing ? '导入中…' : '确认导入' }}
          </button>
        </div>
      </div>
      <ImportReceipt :result="invResult" @undone="onInvUndone" />
    </div>

    <div class="card df-panel">
      <div class="panel-hd"><b>录入示例</b></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>商品名称*</th><th>数量*</th><th>成本价</th><th>批次号</th><th>到期日</th></tr></thead>
          <tbody>
            <tr><td>蒙牛纯甄酸奶 200g</td><td class="num">120</td><td class="num">3.2</td><td>B20260815</td><td>2026-08-28</td></tr>
            <tr><td>蒙牛特仑苏 250ml×12</td><td class="num">60</td><td class="num">52</td><td>B20260810</td><td>2026-09-10</td></tr>
          </tbody>
        </table>
      </div>
      <p class="df-tip" style="margin-top:10px">提示：同一商品不同批次各占一行；到期日格式 <code>YYYY-MM-DD</code>。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { toast, canDo } from '../store'
import { importApi, expiryApi } from '../api/modules'
import ImportMapping from '../components/ImportMapping.vue'
import ImportReceipt from '../components/ImportReceipt.vue'

const importing = ref(false)
const invStats = ref(null)

/* ---- 库存导入 ---- */
const invFile = ref(null)
const invFileName = ref('')
const invResult = ref(null)
/* v178 列映射确认：识别 → 你看一眼 → 再导入。此前识别结果被直接拿去执行，用户无从发现
   「商品名称」被认成「数量」这类错位。 */
const impStep = ref('pick')
const impSuggestions = ref([])
const impFieldOptions = ref([])
const impMapping = ref({})
/* v303：映射记忆命中提示（后端回的 `remembered`）+ 「跳过已存在的记录」开关。
   开关默认**打开**：库存重复导入是"同批次数量翻倍"这种**静默的数据错误**，
   而跳过会逐条点名（"批次 X 已在库存里"）—— 后者可见、可纠正，前者不可见。 */
const impMemory = ref(null)
const impInc = ref(true)

function onInvFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls)$/i.test(f.name)) {
    toast('仅支持 Excel 文件（.xlsx / .xls），请用 Excel 另存后再上传', 'err')
    ev.target.value = ''
    return
  }
  invFile.value = f
  invFileName.value = f?.name || ''
  invResult.value = null
  impMemory.value = null
  impStep.value = 'pick'
}

async function downloadInvTemplate() {
  try {
    const t = await importApi.template('inventory')
    const csv = t.columns.join(',') + '\n'
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '库存效期导入模板.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}

/* 第一步：只识别，不落库。 */
async function previewInv() {
  if (!invFile.value) return
  importing.value = true
  try {
    const prev = await importApi.preview(invFile.value, 'inventory')
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    impMemory.value = prev.remembered || null
    if (!impSuggestions.value.length) { toast('没读到任何列，请检查文件', 'err'); return }
    const m = {}
    for (const s of impSuggestions.value) if (s.suggested_field) m[s.index] = s.suggested_field
    impMapping.value = m
    impStep.value = 'map'
  } catch (e) {
    toast(e.message || '文件解析失败', 'err')
  } finally {
    importing.value = false
  }
}

/* 第二步：按确认过的映射执行。 */
async function doImportInv() {
  if (!invFile.value) return
  importing.value = true
  try {
    // v303：「跳过已存在的记录」→ 后端 `mode=incremental`（按商品+批次号精确去重、逐条点名）。
    //   不传 mode 时后端行为与改动前**逐字节一致** —— 小程序/Hermes/旧前端的调用方零影响。
    const extra = impInc.value ? { mode: 'incremental' } : {}
    const r = await importApi.execute(invFile.value, 'inventory', impMapping.value, extra)
    invResult.value = r
    impStep.value = 'pick'
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadInvStats()
  } catch (e) {
    toast(e.message || '导入失败', 'err')
  } finally {
    importing.value = false
  }
}

/* v303：撤销之后重载统计。**不清空 `invResult`** —— ImportReceipt 自己会把按钮切成
   "已撤销"，清掉的话用户就看不到"刚才撤销成功了"这一格回执了。 */
function onInvUndone() {
  loadInvStats()
}

async function loadInvStats() {
  try {
    const scan = await expiryApi.scan()
    // v157：未录效期的批次数由后端直接给（unscanned_batches，v156 起就有）。
    //   旧版拿 total_items 反推、还没数据时硬编码 428 —— 两个都不是「未纳统量」。
    //   后端未升级（无该字段）时回退旧行为，避免显示 NaN。
    const undated = (typeof scan.unscanned_batches === 'number')
      ? scan.unscanned_batches
      : (scan.total_items > 0 ? 0 : 428)
    invStats.value = { undated }
  } catch { invStats.value = { undated: '?' } }
}

onMounted(() => {
  loadInvStats()
})
</script>

<style scoped>
.df-panel{padding:18px;margin-bottom:14px}
.df-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.df-tip code{background:var(--bg2);padding:1px 6px;border-radius:5px;font-size:12px}
.df-warn{color:var(--war);background:rgba(var(--war-rgb),.08);padding:8px 12px;border-radius:8px;font-size:12px}

.df-import-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
/* v178 列映射确认步：表格 + 底部「返回/确认导入」 */
.df-map{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.df-file-btn{position:relative;overflow:hidden}
.df-fname{font-size:12.5px;color:var(--t2)}
/* v303：`.df-result / .df-errs / .df-err` 三条已随模板一起删除 ——
   结果展示改由共用的 `ImportReceipt.vue` 负责（它自带样式）。
   留着就是死 CSS：本页再也不会有 `class="df-result"` 的元素。 */
</style>
