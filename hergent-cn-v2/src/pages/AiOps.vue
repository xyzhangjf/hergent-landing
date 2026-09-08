<template>
  <div class="aops">
    <div class="aops-tip">
      <b>AI 运维</b>
      <span>备份 / 健康 / 审计 / 路由 / 兜底 —— 日常不用看，出问题或要体检时来这里</span>
    </div>

    <!-- ==================== ① 数据备份 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>数据备份</b>
        <span class="page-sub">每日 03:00 自动备份主库+所有租户库 · 日 7 / 周 4 保留 · 一键恢复</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-primary" :disabled="running" @click="runBackupNow">
          {{ running ? '备份中…' : '立即备份' }}
        </button>
        <button class="btn btn-sm btn-ghost" @click="loadBackups">刷新</button>
      </div>
      <div v-if="backupStatus" class="bk-stat">
        <div class="bk-pill">
          <span class="bk-k">最近备份</span>
          <span class="bk-v">{{ backupStatus.last_backup ? backupStatus.last_backup.date : '尚未备份' }}</span>
          <em v-if="backupStatus.last_backup" class="quota-sub">{{ fmtSize(backupStatus.last_backup.total_size) }} · {{ backupStatus.last_backup.files.length }} 个文件</em>
        </div>
        <div class="bk-pill">
          <span class="bk-k">总占用</span>
          <span class="bk-v">{{ fmtSize(backupStatus.total_size) }}</span>
          <em class="quota-sub">共 {{ backupStatus.backup_count }} 份</em>
        </div>
        <div class="bk-pill">
          <span class="bk-k">下次计划</span>
          <span class="bk-v">{{ backupStatus.next_run }}</span>
        </div>
      </div>
      <div v-if="backups.length" class="bk-list">
        <div v-for="b in backups" :key="b.date" class="bk-item">
          <div class="bk-main">
            <span class="bk-date">{{ b.date }}</span>
            <span class="page-sub">{{ b.files.length }} 个库 · {{ fmtSize(b.total_size) }}</span>
          </div>
          <div class="bk-ops">
            <button class="btn btn-sm btn-ghost" @click="dryRestore(b.date)">演练恢复</button>
          </div>
        </div>
      </div>
      <div v-if="!backups.length" class="state-empty">还没有备份，点「立即备份」开始守护数据</div>
      <div v-if="lastRestore" class="restore-box">
        <div class="prof-hd">恢复演练结果 · {{ lastRestore.date }}</div>
        <div v-for="p in lastRestore.plan" :key="p.name" class="restore-row">
          <span class="bd-tag" :class="{ ok: p.writable, err: !p.writable }">{{ p.name }}</span>
          <span class="quota-sub">{{ fmtSize(p.size) }}</span>
          <span class="bd-tag" :class="{ ok: p.writable, err: !p.writable }">{{ p.writable ? '可恢复' : '不可写' }}</span>
        </div>
      </div>
    </div>

    <!-- ==================== ② LLM 健康看板 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>AI 健康看板</b>
        <span class="page-sub">LLM 调用全链路 tracing · 24h 成功率/延迟/失败归因</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-ghost" @click="loadObs">刷新</button>
      </div>
      <div v-if="obs" class="bk-stat">
        <div class="bk-pill">
          <span class="bk-k">总调用</span>
          <span class="bk-v">{{ obs.total_calls }}</span>
          <em class="quota-sub">最近 {{ obs.window_hours }}h</em>
        </div>
        <div class="bk-pill">
          <span class="bk-k">成功率</span>
          <span class="bk-v" :class="{ 'obs-warn': obs.success_rate < 80 }">{{ obs.success_rate }}%</span>
          <em class="quota-sub">{{ obs.success_calls }} 成功 / {{ obs.total_calls - obs.success_calls }} 失败</em>
        </div>
        <div class="bk-pill">
          <span class="bk-k">平均延迟</span>
          <span class="bk-v">{{ obs.avg_latency_ms }} ms</span>
        </div>
        <div class="bk-pill">
          <span class="bk-k">输入/输出字符</span>
          <span class="bk-v">{{ Math.round(obs.avg_input_chars) }} / {{ Math.round(obs.avg_output_chars) }}</span>
        </div>
      </div>
      <div v-if="obs && obs.provider_breakdown.length" class="obs-prov">
        <div class="prof-hd">模型分布</div>
        <div v-for="p in obs.provider_breakdown" :key="p.provider + p.model" class="obs-row">
          <span class="obs-prov-tag">{{ p.provider }} / {{ p.model }}</span>
          <span class="quota-sub">{{ p.count }} 次</span>
        </div>
      </div>
      <div v-if="obs && obs.fail_breakdown.length" class="obs-fail">
        <div class="prof-hd">失败归因</div>
        <div v-for="f in obs.fail_breakdown" :key="f.reason" class="obs-row">
          <span class="obs-fail-tag">{{ f.reason }}</span>
          <span class="quota-sub">{{ f.count }} 次</span>
        </div>
      </div>
      <div v-if="!obs" class="state-empty">还没有 LLM 调用记录（点刷新试试）</div>
    </div>

    <!-- ==================== ③ 配方导入导出 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>配方导入导出</b>
        <span class="page-sub">把货损/工资/预报三套配方当 JSON 备份，可回滚 / 跨店复用</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-primary" @click="exportRecipes">导出当前配方</button>
        <label class="btn btn-sm btn-ghost" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
          导入文件…
          <input type="file" accept=".json" style="display:none" @change="importRecipesFile" />
        </label>
        <button class="btn btn-sm btn-ghost" :disabled="!recipeImport" @click="dryRunRecipe">演练导入</button>
        <button class="btn btn-sm btn-primary" :disabled="!recipeImport" @click="applyRecipeImport">确认导入</button>
      </div>
      <div v-if="recipeExport" class="bk-stat">
        <div class="bk-pill">
          <span class="bk-k">schema</span>
          <span class="bk-v">{{ recipeExport._meta.schema_version }}</span>
        </div>
        <div class="bk-pill">
          <span class="bk-k">来自租户</span>
          <span class="bk-v">{{ recipeExport._meta.tenant_id }}</span>
          <em class="quota-sub">导出于 {{ recipeExport._meta.exported_at }}</em>
        </div>
        <div class="bk-pill">
          <span class="bk-k">已含</span>
          <span class="bk-v">{{ recipeExport._meta.modules.length }} 套配方</span>
        </div>
      </div>
      <div v-if="recipePlan && recipePlan.length" class="obs-prov">
        <div class="prof-hd">将导入</div>
        <div v-for="p in recipePlan" :key="p.key" class="obs-row">
          <span class="obs-prov-tag">{{ p.label }}</span>
          <span class="quota-sub">{{ p.key }} · size={{ p.size }}</span>
        </div>
      </div>
      <div v-if="recipeImportWarn" class="quota-sub" style="color:#c92a2a">{{ recipeImportWarn }}</div>

      <!-- 版本历史 / 回滚 -->
      <div class="recipe-ver" style="margin-top:16px;border-top:1px solid var(--border-subtle);padding-top:14px">
        <div class="prof-hd" style="display:flex;justify-content:space-between;align-items:center">
          <span>配方版本历史 <span class="quota-sub">（每次导入/回滚自动快照，覆盖有解药）</span></span>
          <button class="btn btn-sm btn-ghost" :disabled="verLoading" @click="loadVersions">{{ verLoading ? '加载中…' : '刷新版本' }}</button>
        </div>
        <div v-if="verError" class="quota-sub" style="color:#c92a2a">{{ verError }}</div>
        <div v-if="verList && verList.length" class="ver-list" style="margin-top:10px">
          <div v-for="v in verList" :key="v.id" class="obs-row" style="align-items:center">
            <span class="obs-prov-tag">{{ recipeLabel(v.key) }}</span>
            <span class="quota-sub">v{{ v.content_version }} · {{ v.change_summary }}</span>
            <span class="quota-sub" style="margin-left:auto">{{ v.created_at }}</span>
            <button class="btn btn-sm btn-ghost" :disabled="rolling" @click="doRollback(v.key, v.id)">回滚</button>
          </div>
        </div>
        <div v-else-if="!verLoading" class="quota-sub">暂无版本记录（导入一次后会自动生成）</div>
      </div>
    </div>

    <!-- ==================== ④ 审计日志 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>审计日志</b>
        <span class="page-sub">销售/收款/调价/对账/库存全路径留痕，可按模块筛选</span>
      </div>
      <div class="tb-group" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <select v-model="auditFilter.module" class="fld" @change="loadAudit" style="min-width:120px">
          <option value="">全部模块</option>
          <option v-for="m in auditModules" :key="m.name" :value="m.name">{{ m.name }} ({{ m.count }})</option>
        </select>
        <input v-model="auditFilter.keyword" class="fld" placeholder="关键词（动作/明细）" style="max-width:200px" @keyup.enter="loadAudit" />
        <button class="btn btn-sm btn-primary" @click="loadAudit">查询</button>
        <span class="page-sub" v-if="auditTotal">共 {{ auditTotal }} 条</span>
      </div>
      <div v-if="auditLogs.length" class="audit-list">
        <div v-for="log in auditLogs" :key="log.id" class="audit-row">
          <span class="audit-when">{{ fmt(log.at) }}</span>
          <span class="audit-user">{{ log.user_name }}</span>
          <span class="audit-mod">{{ log.module }}</span>
          <span class="audit-act">{{ log.action }}</span>
          <span class="audit-hash" v-if="log.hash">#{{ log.hash }}</span>
        </div>
      </div>
      <div v-else class="state-empty">暂无审计日志（点「查询」或触发一个写操作试试）</div>
    </div>

    <!-- ==================== ⑤ AI 兜底记录 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>AI 兜底记录</b>
        <span class="page-sub">LLM 失败或低置信度时自动落档，连续 ≥2 次推通知升级</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-ghost" @click="loadFallback">刷新</button>
        <button class="btn btn-sm btn-primary" :disabled="!fallbackList.length" @click="ackFallback">全部知道了</button>
      </div>
      <div v-if="fallbackList.length" class="fb-list">
        <div v-for="f in fallbackList" :key="f.id" class="fb-row">
          <span class="fb-when">{{ fmt(f.at) }}</span>
          <span class="fb-kind" :class="f.kind">{{ f.kind }}</span>
          <span class="fb-reason">{{ f.reason }}</span>
          <span v-if="f.notified" class="fb-tag notify">已通知</span>
          <span v-if="f.acked" class="fb-tag ack">已确认</span>
        </div>
      </div>
      <div v-else class="state-empty">暂无兜底事件（连续失败 / 低置信度 会自动落到这里）</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { store } from '../store'

const backupStatus = ref(null)
const backups = ref([])
const running = ref(false)
const lastRestore = ref(null)
const obs = ref(null)
const recipeExport = ref(null)
const recipeImport = ref(null)
const recipePlan = ref(null)
const recipeImportWarn = ref('')
const auditLogs = ref([])
const auditTotal = ref(0)
const auditModules = ref([])
const auditFilter = ref({ module: '', keyword: '' })
const fallbackList = ref([])

const verList = ref([])
const verLoading = ref(false)
const verError = ref('')
const rolling = ref(false)
const RECIPE_LABELS = { loss_recipe: '货损', payroll_recipe: '工资', forecast_recipe: '预报' }
function recipeLabel(k) { return RECIPE_LABELS[k] || k }
async function loadVersions() {
  verLoading.value = true; verError.value = ''
  try {
    const d = await api('/api/ai/recipe-versions')
    const data = (d && d.data) || {}
    const out = []
    for (const k of Object.keys(data)) for (const v of (data[k] || [])) out.push(v)
    out.sort((a, b) => b.id - a.id)
    verList.value = out
  } catch (e) { verError.value = (e && e.message) || '加载失败' }
  finally { verLoading.value = false }
}
async function doRollback(key, vid) {
  if (rolling.value) return
  if (!confirm('确定回滚到该版本？当前配方会自动先快照。')) return
  rolling.value = true
  try {
    const d = await api('/api/ai/recipe-rollback', { method: 'POST', body: { key, version_id: vid } })
    if (d && d.success) { store.toast('已回滚', 'ok'); loadVersions() }
    else store.toast('回滚失败', 'error')
  } catch (e) { store.toast((e && e.message) || '回滚失败', 'error') }
  finally { rolling.value = false }
}

onMounted(() => {
  loadBackups()
  loadObs()
  loadAudit()
  loadAuditModules()
  loadFallback()
  loadVersions()
})

function fmt(t) {
  if (!t) return ''
  return String(t).replace('T', ' ').slice(0, 16)
}

function fmtSize(n) {
  n = Number(n || 0)
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

/* ① 数据备份 */
async function loadBackups() {
  try {
    const d = await api('/api/admin/backups')
    backups.value = (d && d.backups) || []
    backupStatus.value = d || null
  } catch (_) {}
}

async function runBackupNow() {
  if (running.value) return
  running.value = true
  try {
    const d = await api('/api/admin/backups/run', { method: 'POST', body: {} })
    if (d && d.note) {
      store.toast('备份成功：' + d.note, 'success')
    }
    await loadBackups()
  } catch (e) {
    store.toast('备份失败：' + (e && e.message || String(e)), 'error')
  } finally {
    running.value = false
  }
}

async function dryRestore(date) {
  if (!confirm(`演练恢复 ${date} 的备份？仅校验完整性，不动数据`)) return
  try {
    const d = await api('/api/admin/backups/restore', { method: 'POST', body: { backup_date: date, dry_run: true } })
    lastRestore.value = { date, plan: (d && d.plan) || [] }
    store.toast('演练完成，请查看下方计划', 'success')
  } catch (e) {
    store.toast('演练失败：' + (e && e.message || String(e)), 'error')
  }
}

/* ② 健康看板 */
async function loadObs() {
  try {
    const d = await api('/api/ai/observability/health?hours=24')
    obs.value = d || null
  } catch (_) {}
}

/* ③ 配方导入导出 */
async function exportRecipes() {
  try {
    const d = await api('/api/ai/recipe-export')
    recipeExport.value = d && d.data ? d.data : d
    store.toast('导出成功，下载已开始', 'success')
    const blob = new Blob([JSON.stringify(recipeExport.value, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hergent-recipes-' + (recipeExport.value._meta.tenant_id) + '-' + Date.now() + '.json'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    store.toast('导出失败：' + (e && e.message || String(e)), 'error')
  }
}

function importRecipesFile(ev) {
  const f = ev.target.files && ev.target.files[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const text = String(e.target.result || '')
      const obj = JSON.parse(text)
      if (!obj || !obj._meta || !obj.recipes) {
        store.toast('文件格式不对，必须是导出的配方文件', 'error')
        return
      }
      recipeImport.value = obj
      recipeExport.value = obj
      dryRunRecipe()
    } catch (err) {
      store.toast('文件解析失败：' + err.message, 'error')
    }
  }
  reader.readAsText(f)
  ev.target.value = ''
}

async function dryRunRecipe() {
  if (!recipeImport.value) return
  try {
    const d = await api('/api/ai/recipe-import', {
      method: 'POST',
      body: { ...recipeImport.value, _meta: { ...recipeImport.value._meta, dry_run: true } },
    })
    recipePlan.value = (d && d.plan) || []
    recipeImportWarn.value = (d && d.warning) || ''
    store.toast('演练完成，请检查下方"将导入"列表', 'success')
  } catch (e) {
    store.toast('演练失败：' + (e && e.message || String(e)), 'error')
  }
}

async function applyRecipeImport() {
  if (!recipeImport.value) return
  if (!confirm('确认覆盖当前配方？会写入审计日志，但不可撤销。')) return
  try {
    const d = await api('/api/ai/recipe-import', {
      method: 'POST',
      body: { ...recipeImport.value, _meta: { ...recipeImport.value._meta, dry_run: false } },
    })
    store.toast('导入成功：' + ((d && d.note) || ''), 'success')
    recipePlan.value = null
    recipeImport.value = null
  } catch (e) {
    store.toast('导入失败：' + (e && e.message || String(e)), 'error')
  }
}

/* ④ 审计日志 */
async function loadAudit() {
  try {
    const q = new URLSearchParams({
      module: auditFilter.value.module || '',
      keyword: auditFilter.value.keyword || '',
      limit: '50',
    }).toString()
    const d = await api('/api/audit/logs?' + q)
    auditLogs.value = (d && d.items) || []
    auditTotal.value = (d && d.total) || 0
  } catch (_) {}
}

async function loadAuditModules() {
  try {
    const d = await api('/api/audit/modules')
    auditModules.value = (d && d.modules) || []
  } catch (_) {}
}

/* ⑤ 兜底记录 */
async function loadFallback() {
  try {
    const d = await api('/api/ai/fallback/list?limit=30')
    fallbackList.value = (d && d.items) || []
  } catch (_) {}
}

async function ackFallback() {
  if (!confirm('确认全部兜底记录为「知道了」？')) return
  try {
    await api('/api/ai/fallback/acknowledge', { method: 'POST', body: { all: true } })
    store.toast('已标记全部为已确认', 'success')
    await loadFallback()
  } catch (e) {
    store.toast('操作失败：' + (e && e.message || String(e)), 'error')
  }
}
</script>

<style scoped>
.aops{display:flex;flex-direction:column;gap:16px}
.aops-tip{display:flex;align-items:baseline;gap:10px;padding:10px 14px;background:var(--bg2);border:1px dashed var(--border-subtle);border-radius:10px}
.aops-tip b{font-size:14px;font-weight:600;color:var(--t1);flex-shrink:0}
.aops-tip span{font-size:12px;color:var(--t3)}

.state-empty{color:var(--t3);font-size:13px;padding:14px 4px;text-align:center}
.quota-sub{font-size:12px;color:var(--t3);margin-top:6px}
.prof-hd{font-size:13px;font-weight:600;color:var(--t1);margin-bottom:6px}

/* 数据备份 */
.bk-stat{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.bk-pill{background:var(--bg);border:1px solid var(--border-subtle);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:4px;min-width:160px}
.bk-k{font-size:11px;color:var(--t2);text-transform:uppercase;letter-spacing:.04em}
.bk-v{font-size:15px;font-weight:600;color:var(--t1)}
.bk-list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto}
.bk-item{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg);border:1px solid var(--border-subtle);border-radius:8px}
.bk-main{display:flex;flex-direction:column;gap:2px}
.bk-date{font-size:14px;font-weight:600;color:var(--t1)}
.restore-box{margin-top:14px;padding:12px 14px;background:var(--bg);border:1px solid var(--border-subtle);border-radius:10px}
.restore-row{display:flex;align-items:center;gap:10px;padding:4px 0}
.bd-tag{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#e9ecef;color:#495057}
.bd-tag.ok{background:#d3f9d8;color:#2b8a3e}
.bd-tag.err{background:#ffe3e3;color:#c92a2a}

/* 健康看板 */
.obs-warn{color:#c92a2a}
.obs-prov,.obs-fail{margin-top:14px;padding:12px 14px;background:var(--bg);border:1px solid var(--border-subtle);border-radius:10px}
.obs-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;gap:10px}
.obs-prov-tag{font-size:13px;font-weight:600;color:var(--t1);padding:2px 8px;background:#e7f5ff;border-radius:4px}
.obs-fail-tag{font-size:12px;color:#c92a2a;background:#fff5f5;padding:2px 8px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

/* 审计日志 */
.audit-list{display:flex;flex-direction:column;gap:4px;max-height:340px;overflow:auto}
.audit-row{display:grid;grid-template-columns:120px 100px 90px 1fr 80px;gap:8px;padding:6px 10px;background:var(--bg);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;align-items:center}
.audit-when{color:var(--t2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.audit-user{font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audit-mod{background:#e7f5ff;color:#1971c2;padding:2px 6px;border-radius:4px;text-align:center;font-weight:600}
.audit-act{color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audit-hash{color:var(--t2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;text-align:right}

/* 兜底记录 */
.fb-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto}
.fb-row{display:grid;grid-template-columns:130px 100px 1fr auto;gap:8px;padding:8px 10px;background:var(--bg);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;align-items:center}
.fb-when{color:var(--t2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.fb-kind{padding:2px 8px;border-radius:4px;text-align:center;font-weight:600;font-size:11px}
.fb-kind.failure{background:#ffe3e3;color:#c92a2a}
.fb-kind.low_confidence{background:#fff3bf;color:#b08900}
.fb-reason{color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fb-tag{padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600}
.fb-tag.notify{background:#d0ebff;color:#1864ab}
.fb-tag.ack{background:#d3f9d8;color:#2b8a3e}
</style>
