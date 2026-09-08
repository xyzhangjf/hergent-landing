<template>
  <div class="page">
    <div class="page-hd">
      <b>AI 中心</b>
      <span class="page-sub">副驾产出固化 · 用量配额 · 个性化洞察 · 长期画像</span>
    </div>
    <div class="ops-hint">
      <span>数据备份、健康看板、审计日志等运维能力已移入</span>
      <router-link to="/settings?tab=aiops">设置 › AI 运维</router-link>
    </div>

    <!-- ==================== ① 我的报告 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>我的报告</b>
        <span class="page-sub">副驾分析结果一键固化，可回看 / 导出 / 转发</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-primary" :disabled="savingReport || !hasChat" @click="saveCurrentChat">
          {{ savingReport ? '保存中…' : '保存当前对话为报告' }}
        </button>
        <button class="btn btn-sm btn-ghost" @click="loadReports">刷新</button>
      </div>
      <div v-if="!reports.length" class="state-empty">还没有报告，在副驾里分析完点「存为报告」即可沉淀到这里</div>
      <div v-else class="rep-list">
        <div v-for="r in reports" :key="r.id" class="rep-item">
          <div class="rep-main" @click="openReport(r)">
            <div class="rep-title">{{ r.title }}</div>
            <div class="rep-meta">{{ r.source }} · {{ fmt(r.created_at) }}</div>
          </div>
          <div class="rep-ops">
            <button class="btn btn-sm btn-ghost" @click="openReport(r)">查看</button>
            <button class="btn btn-sm btn-ghost" @click="exportReport(r)">导出</button>
            <button class="btn btn-sm btn-ghost danger" @click="delReport(r)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== ② 用量与配额 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>用量与配额</b>
        <span class="page-sub">本租户当月 AI 调用计量（字符量近似）</span>
      </div>
      <div v-if="quota" class="quota">
        <div class="quota-row">
          <span class="quota-tier" :class="{ over: quota.exceeded }">
            套餐：{{ tierLabel(quota.tier) }}
            <em v-if="quota.exceeded" class="quota-badge">已超限</em>
          </span>
          <span class="quota-num">已用 {{ fmtNum(quota.used_this_month) }} / 额度 {{ fmtNum(quota.monthly_limit) }}</span>
        </div>
        <div class="quota-bar">
          <div class="quota-fill" :class="{ over: quota.exceeded }"
               :style="{ width: pct(quota.used_this_month, quota.monthly_limit) + '%' }"></div>
        </div>
        <div class="quota-sub">剩余 {{ fmtNum(quota.remaining) }} 字符 · 每月 1 日重置</div>
        <div class="quota-set" v-if="isAdmin">
          <span class="page-sub">调整套餐（管理员）：</span>
          <select v-model="quotaForm.tier" class="fld" @change="applyQuota">
            <option value="free">免费版 (20万)</option>
            <option value="pro">专业版 (200万)</option>
            <option value="enterprise">企业版 (1000万)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- ==================== ②·5 AI 价值账单（环3 门面） ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>AI 价值账单</b>
        <span class="page-sub">AI 给了多少建议、你采纳了多少、本月用了多少算力</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-ghost" @click="loadValue">刷新</button>
      </div>
      <div v-if="value" class="value-grid">
        <div class="value-item">
          <div class="value-num">{{ value.advice.total }}</div>
          <div class="value-label">本月建议</div>
        </div>
        <div class="value-item">
          <div class="value-num good">{{ value.advice.adopted }}</div>
          <div class="value-label">已采纳</div>
        </div>
        <div class="value-item">
          <div class="value-num">{{ value.adoption_rate }}%</div>
          <div class="value-label">采纳率</div>
        </div>
        <div class="value-item">
          <div class="value-num">{{ fmtNum(value.usage.calls) }}</div>
          <div class="value-label">本月 AI 调用</div>
        </div>
      </div>
      <div v-if="value" class="quota-sub">{{ value.month }} 月 · 节省金额待「金额回算」接入后展示（下一步）</div>
      <div v-else class="state-empty">暂无数据，去副驾里采纳/驳回几条建议，这里就会长出你的 AI 价值账单</div>
    </div>

    <!-- ==================== ③ AI 经营洞察 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>AI 经营洞察</b>
        <span class="page-sub">LLM 读真实数据，跨表因果，区别于规则模板</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-primary" :disabled="insighting" @click="genInsight">
          {{ insighting ? '生成中…' : '生成经营洞察' }}
        </button>
        <span class="page-sub" v-if="insightAt">最近：{{ insightAt }}</span>
      </div>
      <div v-if="insight" class="insight-box">{{ insight }}</div>
      <div v-else class="state-empty">点「生成经营洞察」，AI 会结合你的销售/应收/临期/返利数据给出建议</div>
      <div v-if="insightDp && Object.keys(insightDp).length" class="insight-dp">
        <div v-for="(v, k) in insightDp" :key="k" class="dp-item" v-show="v">
          <span class="dp-k">{{ dpLabel(k) }}</span><span class="dp-v">{{ dpText(k, v) }}</span>
        </div>
      </div>
    </div>

    <!-- ==================== ⑤ 长期经营画像 ==================== -->
    <div class="card">
      <div class="panel-hd">
        <b>长期经营画像</b>
        <span class="page-sub">AI 从历史对话自动提炼你的偏好与口径</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-ghost" :disabled="refreshing" @click="refreshProfile">
          {{ refreshing ? '提炼中…' : '刷新画像' }}
        </button>
      </div>
      <div v-if="profile">
        <div v-if="profile.summary" class="insight-box">{{ profile.summary }}</div>
        <div class="prof-sec" v-if="profile.preferences && profile.preferences.length">
          <div class="prof-hd">偏好 / 习惯</div>
          <div v-for="(p, i) in profile.preferences" :key="i" class="prof-item">{{ p }}</div>
        </div>
        <div class="prof-sec" v-if="profile.calibers && profile.calibers.length">
          <div class="prof-hd">业务口径</div>
          <div v-for="(c, i) in profile.calibers" :key="i" class="prof-item">{{ c }}</div>
        </div>
        <div v-if="profile.updated_at" class="quota-sub">更新于 {{ profile.updated_at }}</div>
      </div>
      <div v-else class="state-empty">
        画像将在你使用副驾（对话 / 纠正口径）后自动生成，点「刷新画像」立即提炼
      </div>
    </div>

    <!-- 报告查看弹窗 -->
    <div v-if="viewing" class="rep-mask" @click.self="viewing = null">
      <div class="rep-modal">
        <div class="rep-modal-hd">
          <b>{{ viewing.title }}</b>
          <button class="cp-icon-btn" @click="viewing = null">✕</button>
        </div>
        <pre class="rep-content">{{ viewing.content }}</pre>
        <div class="rep-modal-ft">
          <button class="btn btn-sm btn-ghost" @click="exportReport(viewing)">导出 Markdown</button>
          <button class="btn btn-sm btn-ghost" @click="exportPrintable(viewing)">导出成品</button>
          <button class="btn btn-sm btn-primary" @click="viewing = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { store } from '../store'
import { openPrintable } from '../utils/printable'
import { renderMd } from '../utils/md'

const reports = ref([])
const savingReport = ref(false)
const quota = ref(null)
const quotaForm = ref({ tier: 'free' })
const isAdmin = ref(false)
const insight = ref('')
const insightDp = ref(null)
const insightAt = ref('')
const insighting = ref(false)
const profile = ref(null)
const value = ref(null)
const refreshing = ref(false)
const viewing = ref(null)
const hasChat = computed(() => store.chat.messages.some(m => m.content))

onMounted(() => {
  loadReports()
  loadQuota()
  loadValue()
  loadProfile()
  try {
    const u = JSON.parse(localStorage.getItem('hergent_v2_user') || '{}')
    isAdmin.value = u && (u.role === 'admin' || u.role === 'boss')
  } catch (_) {}
})

function fmt(t) {
  if (!t) return ''
  return String(t).replace('T', ' ').slice(0, 16)
}
function fmtNum(n) {
  n = Number(n || 0)
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}
function pct(used, limit) {
  limit = Number(limit || 0)
  if (!limit) return 0
  return Math.min(100, Math.round((Number(used || 0) / limit) * 100))
}
function tierLabel(t) {
  return { free: '免费版', pro: '专业版', enterprise: '企业版' }[t] || t
}

/* ① 报告 */
async function loadReports() {
  try {
    const d = await api('/api/ai/reports')
    reports.value = (d && d.reports) || []
  } catch (_) {}
}
function chatToMarkdown() {
  return store.chat.messages
    .filter(m => m.content)
    .map(m => (m.role === 'user' ? '**老板**：' : '**AI 副驾**：') + m.content)
    .join('\n\n')
}
async function saveCurrentChat() {
  const content = chatToMarkdown()
  const first = store.chat.messages.find(m => m.role === 'user' && m.content)
  const title = first ? first.content.slice(0, 40) : '副驾对话报告'
  if (!content) return
  savingReport.value = true
  try {
    await api('/api/ai/reports', { method: 'POST', body: { title, content, source: 'copilot' } })
    store.toast('已存为报告')
    loadReports()
  } catch (e) {
    store.toast((e && e.message) || '保存失败', 'error')
  } finally {
    savingReport.value = false
  }
}
async function openReport(r) {
  try {
    const d = await api('/api/ai/reports/' + r.id)
    viewing.value = d && d.report ? d.report : r
  } catch (_) {
    viewing.value = r
  }
}
function exportReport(r) {
  const text = `# ${r.title}\n\n> 来源：${r.source || 'copilot'} · ${fmt(r.created_at)}\n\n${r.content || ''}`
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (r.title || 'report') + '.md'
  a.click()
  URL.revokeObjectURL(url)
}
function exportPrintable(r) {
  const bodyHtml = renderMd(r.content || '')
  openPrintable({
    title: r.title || 'AI 分析报告',
    subtitle: 'Hergent AI 经营副驾 · 分析报告',
    bodyHtml,
    filename: (r.title || 'report'),
    generatedAt: '生成于 ' + fmt(r.created_at),
  })
}
async function delReport(r) {
  if (!confirm('确定删除这份报告？')) return
  try {
    await api('/api/ai/reports/' + r.id, { method: 'DELETE' })
    reports.value = reports.value.filter(x => x.id !== r.id)
    store.toast('已删除')
  } catch (e) {
    store.toast((e && e.message) || '删除失败', 'error')
  }
}

/* ② 配额 */
async function loadQuota() {
  try {
    const d = await api('/api/ai/quota')
    quota.value = d && d.ok ? d : null
    if (quota.value) quotaForm.value.tier = quota.value.tier
  } catch (_) {}
}
async function applyQuota() {
  try {
    const d = await api('/api/ai/quota', { method: 'POST', body: { tier: quotaForm.value.tier } })
    if (d && d.ok) { quota.value = d; store.toast('配额已更新') }
  } catch (e) {
    store.toast((e && e.message) || '更新失败', 'error')
  }
}

/* ②·5 价值账单 */
async function loadValue() {
  try {
    const d = await api('/api/ai/value-summary')
    value.value = d && d.ok ? d : null
  } catch (_) {
    value.value = null
  }
}

/* ③ 洞察 */
async function genInsight() {
  insighting.value = true
  insight.value = ''
  insightDp.value = null
  try {
    const d = await api('/api/ai/llm-insight')
    insight.value = (d && d.insight) || ''
    insightDp.value = (d && d.data_points) || null
    insightAt.value = (d && d.generated_at) || ''
  } catch (e) {
    store.toast((e && e.message) || '生成失败', 'error')
  } finally {
    insighting.value = false
  }
}
function dpLabel(k) {
  return {
    top_customers: '重点客户', overdue_ar: '逾期应收', expiry_risk_value: '临期风险货值',
    rebate_open: '未结返利', rebate_achieved: '返利已达成', loss_30d: '近30天货损'
  }[k] || k
}
function dpText(k, v) {
  if (k === 'top_customers') return Array.isArray(v) ? v.join('；') : v
  if (typeof v === 'number') return fmtNum(v)
  return v
}

/* ⑤ 画像 */
async function loadProfile() {
  try {
    const d = await api('/api/ai/profile-llm')
    profile.value = (d && d.ok && d.profile) ? d.profile : null
  } catch (_) {}
}
async function refreshProfile() {
  refreshing.value = true
  try {
    const d = await api('/api/ai/profile-refresh', { method: 'POST', body: {} })
    if (d && d.ok && d.profile) {
      profile.value = d.profile
      store.toast('画像已更新')
    } else if (d && !d.ok) {
      store.toast((d.error) || '提炼失败', 'error')
    }
  } catch (e) {
    store.toast((e && e.message) || '提炼失败', 'error')
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
.page{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.page-hd{display:flex;align-items:baseline;gap:12px;margin-bottom:2px}
.page-hd b{font-size:18px;font-weight:600;color:var(--t1)}
.page-sub{color:var(--t3);font-size:12px}
.ops-hint{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t3);margin-top:-8px}
.ops-hint a{color:var(--p);text-decoration:none;font-weight:500}
.ops-hint a:hover{text-decoration:underline}
.card{background:var(--bg2);border:1px solid var(--border-subtle);border-radius:14px;padding:16px 18px}
.panel-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.panel-hd b{font-size:15px;font-weight:600;color:var(--t1)}
.state-empty{color:var(--t3);font-size:13px;padding:14px 4px;text-align:center}

/* 报告列表 */
.rep-list{display:flex;flex-direction:column;gap:8px}
.rep-item{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg3);border-radius:10px}
.rep-main{flex:1;min-width:0;cursor:pointer}
.rep-title{font-size:14px;color:var(--t1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rep-meta{font-size:12px;color:var(--t3);margin-top:2px}
.rep-ops{display:flex;gap:6px;flex-shrink:0}

/* 配额 */
.quota-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.quota-tier{font-size:14px;color:var(--t1);font-weight:500}
.quota-tier.over{color:var(--dan)}
.quota-badge{margin-left:6px;font-style:normal;font-size:11px;background:var(--dan-bg);color:var(--dan);padding:1px 8px;border-radius:8px}
.quota-num{font-size:13px;color:var(--t2)}
.quota-bar{height:10px;background:var(--bg3);border-radius:6px;overflow:hidden}
.quota-fill{height:100%;background:var(--p);border-radius:6px;transition:width .3s}
.quota-fill.over{background:var(--dan)}
.quota-sub{font-size:12px;color:var(--t3);margin-top:6px}
.quota-set{margin-top:10px;display:flex;align-items:center;gap:8px}

/* 价值账单 */
.value-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.value-item{background:var(--bg3);border-radius:10px;padding:14px 10px;text-align:center}
.value-num{font-size:26px;font-weight:600;color:var(--t1);line-height:1.1}
.value-num.good{color:var(--suc)}
.value-label{font-size:12px;color:var(--t3);margin-top:6px}

/* 洞察 / 画像 */
.insight-box{background:var(--p-bg);border:1px solid var(--p-border);border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.7;color:var(--t1);white-space:pre-wrap}
.insight-dp{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.dp-item{display:flex;gap:10px;font-size:12px}
.dp-k{color:var(--t3);min-width:84px;flex-shrink:0}
.dp-v{color:var(--t2)}
.prof-sec{margin-top:12px}
.prof-hd{font-size:13px;font-weight:600;color:var(--t1);margin-bottom:6px}
.prof-item{font-size:13px;color:var(--t2);padding:4px 0;border-bottom:1px dashed var(--border-subtle)}

/* 弹窗 */
.rep-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(2px)}
.rep-modal{width:620px;max-width:92vw;max-height:84vh;background:var(--bg);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}
.rep-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle);font-size:15px;color:var(--t1)}
.rep-content{flex:1;overflow:auto;padding:16px 18px;margin:0;font-size:13px;line-height:1.7;color:var(--t1);white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.rep-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border-subtle)}
</style>
