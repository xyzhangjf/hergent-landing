<template>
  <div class="page">
    <div class="page-hd flush">
      <h2>AI 中心</h2>
      <span class="page-sub">副驾产出固化 · 用量配额 · 个性化洞察 · 长期画像</span>
    </div>
    <div class="ops-hint">
      <span>数据备份、健康看板、审计日志等运维能力已移入</span>
      <router-link to="/settings?tab=aiops">设置 › AI 运维</router-link>
    </div>

    <div class="bento">
    <!-- KPI 概览条（顶部紧凑统计带） -->
    <div class="card kpi-strip">
      <div class="kpi">
        <div class="kpi-label">我的报告</div>
        <div class="kpi-val">{{ reports.length }}</div>
        <div class="kpi-sub">已沉淀的分析</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">本月 AI 调用</div>
        <div class="kpi-val">{{ value ? fmtNum(value.usage.calls) : '—' }}</div>
        <div class="kpi-sub">{{ value ? value.month + ' 月至今' : '暂无数据' }}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">配额剩余</div>
        <div class="kpi-val" :class="quota && quota.exceeded ? 'val-bad' : ''">{{ quota ? fmtNum(quota.remaining) : '—' }}</div>
        <div class="kpi-sub">{{ quota ? tierLabel(quota.tier) : '—' }}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">建议采纳率</div>
        <div class="kpi-val" :class="value && value.adoption_rate >= 50 ? 'val-ok' : ''">{{ value ? value.adoption_rate + '%' : '—' }}</div>
        <div class="kpi-sub">{{ value ? '已采纳 ' + value.advice.adopted + ' / ' + value.advice.total : '暂无数据' }}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">长期画像</div>
        <div class="kpi-val" :class="profile ? 'val-ok' : ''">{{ profile ? '已生成' : '未生成' }}</div>
        <div class="kpi-sub">{{ profile && profile.updated_at ? '更新于 ' + fmt(profile.updated_at) : '用副驾对话后自动生成' }}</div>
      </div>
    </div>

    <!-- ==================== ① 我的报告 ==================== -->
    <div class="card rep-card">
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
    <div class="card quota-card">
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
    <div class="card value-card">
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

    <!-- ==================== ②·6 口径提案审核台（M3） ==================== -->
    <div class="card proposal-card">
      <div class="panel-hd">
        <b>口径提案审核台</b>
        <span class="page-sub">AI / 运营沉淀的算法口径改动 —— 采纳后才合并进正式配方（全程可审计）</span>
      </div>
      <div class="tb-group tb-right" style="margin-bottom:12px">
        <button class="btn btn-sm btn-ghost" @click="toggleCaliberForm">
          {{ caliberOpen ? '收起' : '＋ 记录一次口径' }}
        </button>
        <button class="btn btn-sm btn-ghost" :disabled="proposalsLoading" @click="loadProposals">
          {{ proposalsLoading ? '加载中…' : '刷新' }}
        </button>
      </div>

      <div v-if="paramsInfo" class="cal-hint">
        可调口径 {{ paramsInfo.params.length }} 项 · 近 30 天已记录 {{ totalRecent }} 次 ·
        同一口径同量级累计 <b>3 次同向</b>改写时系统会自动提案
      </div>

      <!-- ============ T1-5 记录一次口径（与审核台同卡，不新增侧栏）============
           「提」与「审」放在同一处才闭环。字段清单全部来自后端 /params，
           前端不写第二份（旧 FIELD_LABEL 已漂移出 4 个后端不存在的键）。 -->
      <div v-if="caliberOpen" class="cal-form">
        <div v-if="!paramsInfo" class="cal-tip">口径清单加载中…</div>
        <template v-else>
          <div class="cal-row">
            <select v-model="cal.module" class="fld cal-f1" @change="onModuleChange">
              <option v-for="m in paramsInfo.modules" :key="m.v" :value="m.v">{{ m.l }}</option>
            </select>
            <select v-model="cal.param_key" class="fld cal-f2">
              <option v-for="p in calParams" :key="p.param_key" :value="p.param_key">
                {{ p.label }}{{ p.unit ? '（' + p.unit + '）' : '' }} · 当前 {{ valText(p) }}
              </option>
            </select>
            <select v-if="calEntry && calEntry.type === 'enum'" v-model="cal.user_value" class="fld cal-f3">
              <option v-for="o in calEntry.options" :key="o.v" :value="o.v">{{ o.l }}</option>
            </select>
            <input v-else v-model="cal.user_value" class="fld cal-f3" type="text" inputmode="decimal"
                   :placeholder="calEntry ? '新取值' + (calEntry.unit ? '（' + calEntry.unit + '）' : '') : '新取值'" />
            <input v-model="cal.note" class="fld cal-f4" type="text" placeholder="为什么这么定？（可选）" />
            <button class="btn btn-sm btn-primary" :disabled="calBusy || !calEntry" @click="submitCaliber">
              {{ calBusy ? '提交中…' : '记下并生成提案' }}
            </button>
          </div>
          <div v-if="calEntry && calEntry.hint" class="cal-tip">{{ calEntry.hint }}</div>
          <div v-if="calEntry && calEntry.type !== 'enum'" class="cal-tip">
            取值范围 {{ calEntry.min }} ~ {{ calEntry.max }}{{ calEntry.unit || '' }}，超出会被自动收到边界
          </div>
          <div v-if="calEntry" class="cal-tip">
            <template v-if="calEntry.shareable">属算法参数：确认后会计入跨租户行业口径（只共享参数名与量级，不含金额 / 客户 / 进货价）</template>
            <template v-else>属商业秘密：只在本租户沉淀，不会进入跨租户共享层</template>
          </div>
        </template>
      </div>

      <div v-if="proposalsDenied" class="state-empty">
        当前账号没有「AI 对话」模块权限，看不到待审提案。请管理员在【员工档案 → 角色权限】里为你开通该模块。
      </div>
      <div v-else-if="!proposals.length" class="state-empty">
        暂无待审提案。当同类口径被反复改写（经验闭环判定）或运营手工提交时，提案会出现在这里等你拍板。
      </div>
      <div v-else class="prop-list">
        <div v-for="p in proposals" :key="p.id" class="prop-item" :class="{ done: p.status !== 'pending' }">
          <div class="prop-main">
            <div class="prop-title">
              <span class="prop-mod">{{ MOD_LABEL[p.module] || p.module }}</span>
              <span class="prop-name">{{ p.title || '（无标题）' }}</span>
              <span class="prop-st" :class="'st-' + p.status">{{ ST_LABEL[p.status] || p.status }}</span>
            </div>
            <div v-if="p.rationale" class="prop-why">{{ p.rationale }}</div>
            <div v-if="changesText(p.changes)" class="prop-chg">{{ changesText(p.changes) }}</div>
            <div class="prop-meta">
              {{ srcLabel(p) }} · {{ fmt(p.created_at) }}
              <template v-if="p.reviewed_at"> · {{ fmt(p.reviewed_at) }} 由 {{ p.reviewed_by || '—' }}</template>
            </div>
            <div v-if="p.status === 'pending' && fuelOf(p)" class="prop-fuel">{{ fuelOf(p) }}</div>
          </div>
          <div v-if="p.status === 'pending'" class="prop-ops">
            <button class="btn btn-sm btn-primary" :disabled="!isAdmin || reviewing === p.id" @click="reviewProposal(p, 'accept')">采纳</button>
            <button class="btn btn-sm btn-ghost danger" :disabled="!isAdmin || reviewing === p.id" @click="reviewProposal(p, 'reject')">驳回</button>
          </div>
        </div>
      </div>
      <div v-if="!isAdmin && proposals.some(p => p.status === 'pending')" class="quota-sub">仅管理员可采纳 / 驳回</div>
    </div>

    <!-- ==================== ③ AI 经营洞察 ==================== -->
    <div class="card insight-card">
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
      <!-- T1-3：缺数据时**明说缺数据**，不拿残缺数据编一段像模像样的洞察 -->
      <div v-if="insightBlocked" class="blocked-box">
        <b>缺数据，本次不出结论</b>
        <div class="blocked-txt">{{ insight }}</div>
      </div>
      <div v-else-if="insight" class="insight-box">{{ insight }}</div>
      <div v-else class="state-empty">点「生成经营洞察」，AI 会结合你的销售/应收/临期/返利数据给出建议</div>

      <!-- T1-3 溯源：读了几张表 / 每项按什么口径 / 由几行算出来的 -->
      <div v-if="provenance.length" class="prov">
        <div class="prov-hd">
          这份结论读了 <b>{{ tablesRead.length }}</b> 张表、共 <b>{{ rowsTotal }}</b> 行数据
        </div>
        <div class="prov-tb">
          <div class="prov-tr prov-th">
            <span>指标</span><span>数据源表</span><span>口径</span>
            <span class="num">行数</span><span class="num">取值</span>
          </div>
          <div v-for="p in provenance" :key="p.key" class="prov-tr" :class="'pv-' + p['状态']">
            <span>{{ p['指标'] }}</span>
            <span>{{ p['数据源表'] }}</span>
            <span>{{ p['口径'] }}</span>
            <span class="num">{{ p['行数'] }}</span>
            <span class="num">
              {{ pv(p) }}
              <em v-if="p['状态'] === 'empty'" class="prov-e">确实无记录</em>
              <em v-else-if="p['状态'] === 'error'" class="prov-e bad">读不到</em>
            </span>
          </div>
        </div>
        <div class="prov-warn" v-if="unscannedBatches">
          另有 {{ unscannedBatches }} 个在库批次没录到期日、未纳入临期扫描 —— 所以「临期风险低」不等于库存健康。
        </div>
        <div class="prov-tip">口径 = 这个数是怎么算出来的。照着「数据源表 + 口径」两列，你可以自己在系统里复算一遍。</div>
      </div>
    </div>

    <!-- ==================== ⑤ 长期经营画像 ==================== -->
    <div class="card profile-card">
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
    </div><!-- /bento -->

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
import { aiExperienceApi } from '../api/modules'
import { store } from '../store'
import { openPrintable } from '../utils/printable'
import { renderMd } from '../utils/md'

const reports = ref([])
const savingReport = ref(false)
const quota = ref(null)
const quotaForm = ref({ tier: 'free' })
const isAdmin = ref(false)
const insight = ref('')
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
  loadProposals()
  loadParams()
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

/* ②·6 口径提案审核台（M3）——后端 /api/ai/recipe-proposals（list / review） */
const proposals = ref([])
const proposalsLoading = ref(false)
const proposalsDenied = ref(false)   // 🔴 403 与「真没有提案」必须分开说，别把「没权限」显示成「没有」
const reviewing = ref(0)
const MOD_LABEL = { loss: '货损', payroll: '工资', forecast: '预报', rebate: '返利' }
const ST_LABEL = { pending: '待审批', accepted: '已采纳', rejected: '已驳回' }
async function loadProposals() {
  proposalsLoading.value = true
  proposalsDenied.value = false
  try {
    const d = await api('/api/ai/recipe-proposals')
    proposals.value = (d && d.proposals) || []
  } catch (e) {
    proposals.value = []
    // 403 / 模块未授权 ⇒ 单独提示「没权限」，不与「真没有提案」混为一谈
    const msg = String((e && (e.message || e.error || e.code)) || '')
    proposalsDenied.value = /403|权限|MODULE_DENIED|AI 对话/.test(msg)
  } finally {
    proposalsLoading.value = false
  }
}
async function reviewProposal(p, action) {
  if (!isAdmin.value || reviewing.value) return
  reviewing.value = p.id
  try {
    await api('/api/ai/recipe-proposals/' + p.id + '/review', { method: 'POST', body: { action } })
    store.toast(action === 'accept' ? '已采纳，口径已合并进正式配方' : '已驳回')
    await loadProposals()
  } catch (e) {
    store.toast((e && e.message) || '审批失败', 'error')
  } finally {
    reviewing.value = 0
  }
}
/* 把 changes 对象压成一行「字段=值」，空对象返回空串（不渲染空行） */
function changesText(ch) {
  if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return ''
  const ks = Object.keys(ch)
  if (!ks.length) return ''
  return ks.map(k => k + ' = ' + JSON.stringify(ch[k])).join('　·　')
}
/* 提案来源要说人话，且**不能把「闭环自动提案」说成「AI 提案」** —— 前者是系统按
   统计规则算出来的，后者是模型自己想出来的，老板据此判断可信度，混为一谈就是误导。 */
function srcLabel(p) {
  if (p.source === 'loop') return '经验闭环自动提案（同口径反复改写触发）'
  if (p.source === 'manual') return '口径记录入口提交'
  return 'AI 提案'
}

/* ==================== T1-5 记录一次口径 ====================
   与「口径提案审核台」同一张卡：既能审（accept/reject），也能提（一次确认即建提案）。
   候选清单全部来自后端 /api/ai/experience/params —— 前端不写第二份。 */
const paramsInfo = ref(null)
const caliberOpen = ref(false)
const calBusy = ref(false)
const cal = ref({ module: 'loss', param_key: '', user_value: '', note: '' })
const calParams = computed(() => {
  if (!paramsInfo.value) return []
  return paramsInfo.value.params.filter(p => p.module === cal.value.module)
})
const calEntry = computed(() => calParams.value.find(p => p.param_key === cal.value.param_key) || null)
const totalRecent = computed(() => {
  if (!paramsInfo.value) return 0
  return paramsInfo.value.params.reduce((s, p) => s + (p.recent_overrides || 0), 0)
})
function valText(p) {
  if (p.type === 'enum') {
    const o = (p.options || []).find(x => x.v === p.current)
    return o ? o.l : String(p.current)
  }
  return String(p.current) + (p.unit || '')
}
async function loadParams() {
  try {
    const d = await aiExperienceApi.params()
    paramsInfo.value = d && d.ok ? d : null
    // 默认选中当前模块的第一条口径（避免下拉空着、按钮灰着让人以为坏了）
    if (paramsInfo.value && !cal.value.param_key) {
      const first = calParams.value[0]
      if (first) { cal.value.param_key = first.param_key; cal.value.user_value = String(first.current) }
    }
  } catch (_) {
    paramsInfo.value = null
  }
}
function toggleCaliberForm() {
  caliberOpen.value = !caliberOpen.value
  if (caliberOpen.value && !paramsInfo.value) loadParams()
}
function onModuleChange() {
  const first = calParams.value[0]
  cal.value.param_key = first ? first.param_key : ''
  cal.value.user_value = first ? String(first.current) : ''
}
/* 数字输入层归一：全角数字/中文句号等先折成半角（中文输入法下 `１２。５` 否则整串作废）。
   🔴 与 Forecast/CollectionsCard 同一条判据：不用 type=number（它会静默吞掉全角字符）。 */
function normNum(v) {
  let s = String(v == null ? '' : v)
  try { s = s.normalize('NFKC') } catch (e) { /* 老浏览器忽略 */ }
  return s.replace(/[。｡、]/g, '.').replace(/，/g, ',').replace(/−|–|—/g, '-').replace(/,/g, '').trim()
}
async function submitCaliber() {
  const e = calEntry.value
  if (!e || calBusy.value) return
  const raw = e.type === 'enum' ? cal.value.user_value : normNum(cal.value.user_value)
  if (raw === '') { store.toast('请填写新取值', 'error'); return }
  calBusy.value = true
  try {
    const r = await aiExperienceApi.proposeRecipe({
      module: e.module, param_key: e.param_key, user_value: raw, note: cal.value.note || ''
    })
    let msg = r.created ? '已生成提案' : '已有同口径待审提案，已并到那一条'
    msg += '：' + (r.label || e.label) + ' = ' + r.applied_value + (r.unit || '')
    if (r.clamped) msg += '（你填的值超范围，已收到边界）'
    store.toast(msg)
    cal.value.note = ''
    await Promise.all([loadProposals(), loadParams()])
  } catch (err) {
    store.toast((err && err.message) || '记录失败', 'error')
  } finally {
    calBusy.value = false
  }
}
/* 待审提案若是「某个口径」，把它的燃料进度说出来（老板才知道系统还差几次会自己提） */
const fuelMap = computed(() => {
  const m = {}
  if (paramsInfo.value) paramsInfo.value.params.forEach(p => { m[p.param_key] = p })
  return m
})
function fuelOf(p) {
  const pk = p && p.changes && p.changes.__param
  if (!pk || !fuelMap.value[pk]) return ''
  const n = fuelMap.value[pk].recent_overrides || 0
  if (!n) return ''
  return '该口径近 30 天已被记录 ' + n + ' 次'
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

/* ③ 洞察（T1-3：结论 + 指标级溯源；缺数据则拒答）*/
const insightBlocked = ref(false)
const provenance = ref([])
const tablesRead = ref([])
const rowsTotal = ref(0)
const unscannedBatches = computed(() => {
  // 覆盖度不足必须显现出来，否则「临期风险低」会被误读成「库存健康」
  return provenance.value.reduce((s, p) => s + (p['未纳扫批次'] || 0), 0)
})
async function genInsight() {
  insighting.value = true
  insight.value = ''
  insightBlocked.value = false
  provenance.value = []
  tablesRead.value = []
  rowsTotal.value = 0
  try {
    const d = await api('/api/ai/llm-insight')
    insight.value = (d && d.insight) || ''
    insightBlocked.value = !!(d && d.blocked)
    provenance.value = (d && d.provenance) || []
    tablesRead.value = (d && d.tables_read) || []
    rowsTotal.value = (d && d.rows_total) || 0
    insightAt.value = (d && d.generated_at) || ''
  } catch (e) {
    store.toast((e && e.message) || '生成失败', 'error')
  } finally {
    insighting.value = false
  }
}
/* 取值渲染：数字带中文单位（经销商看不懂英文缩写的数目字），列表压成一行 */
function pv(p) {
  const v = p['取值']
  const u = p['单位'] || ''
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return v.length ? v.join('；') : '—'
  if (typeof v === 'number') return v.toLocaleString('zh-CN') + (u ? ' ' + u : '')
  return String(v)
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
.page{display:flex;flex-direction:column;gap:16px}
/* Bento 分栏：.bento / .kpi-strip 及 KPI 子元素走全局层（variables.css），
   这里只声明本页模块占宽 —— 12 列栅格按「7+5 / 5+7 / 12」两栏铺开，
   消除此前 900px 单列窄栏造成的大面积留白（1920 视口下占宽仅 55%）。 */
.rep-card{grid-column:span 7}
.quota-card{grid-column:span 5}
.value-card{grid-column:span 5}
.insight-card{grid-column:span 7}
.profile-card{grid-column:1/-1}
/* 审核台是列表，整行铺开（与 profile-card 同策略）；🔴 不写这条会被栅格塞进 1 列窄栏、文字竖排 */
.proposal-card{grid-column:1/-1}
.ops-hint{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t3);margin-top:-8px}
.ops-hint a{color:var(--p);text-decoration:none;font-weight:500}
.ops-hint a:hover{text-decoration:underline}
.card{background:var(--bg2);border:1px solid var(--border-subtle);border-radius:14px;padding:16px 18px}
/* KPI 条要覆盖上面这条 scoped .card 的内距 —— 两者特异性同为 0,2,0（scoped 会被加上
   [data-v-x] 属性选择器），全局层的 .kpi-strip 特异性只有 0,1,0 盖不住，只能靠源顺序在这里补一条。 */
.kpi-strip{padding:6px 0}
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
.value-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.value-item{background:var(--bg3);border-radius:10px;padding:14px 10px;text-align:center}
.value-num{font-size:26px;font-weight:600;color:var(--t1);line-height:1.1}
.value-num.good{color:var(--suc)}
.value-label{font-size:12px;color:var(--t3);margin-top:6px}

/* 洞察 / 画像 */
.insight-box{background:var(--p-bg);border:1px solid var(--p-border);border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.7;color:var(--t1);white-space:pre-wrap}
/* T1-3 缺数据拒答：必须看起来就"不是一条洞察"，否则老板会把说明当结论读 */
.blocked-box{background:var(--warn-amber-bg);border:1px solid var(--warn-amber);border-radius:10px;padding:12px 14px;color:var(--t1)}
.blocked-box b{display:block;font-size:13.5px;color:var(--warn-amber);margin-bottom:6px}
.blocked-txt{font-size:13px;line-height:1.7;white-space:pre-wrap}
/* T1-3 指标级溯源表 */
.prov{margin-top:12px;border-top:1px dashed var(--border-subtle);padding-top:11px}
.prov-hd{font-size:12.5px;color:var(--t2);margin-bottom:8px}
.prov-hd b{color:var(--p-dark);font-size:13.5px}
.prov-tb{display:flex;flex-direction:column;border:1px solid var(--border-subtle);border-radius:9px;overflow:hidden}
.prov-tr{display:grid;grid-template-columns:112px 1.15fr 1.9fr 52px 108px;gap:8px;padding:7px 10px;font-size:12px;color:var(--t2);border-top:1px solid var(--border-subtle)}
.prov-tr:first-child{border-top:none}
.prov-tr.prov-th{background:var(--bg3);color:var(--t3);font-weight:600;font-size:11.5px}
.prov-tr .num{text-align:right;font-variant-numeric:tabular-nums}
.prov-tr.pv-error{background:var(--dan-bg)}
.prov-e{font-style:normal;font-size:10.5px;margin-left:5px;padding:1px 6px;border-radius:7px;background:var(--bg3);color:var(--t3)}
.prov-e.bad{background:var(--dan-bg);color:var(--dan)}
.prov-warn{margin-top:8px;font-size:12px;color:var(--warn-amber);line-height:1.6}
.prov-tip{margin-top:7px;font-size:11.5px;color:var(--t3);line-height:1.55}
.prof-sec{margin-top:12px}
.prof-hd{font-size:13px;font-weight:600;color:var(--t1);margin-bottom:6px}
.prof-item{font-size:13px;color:var(--t2);padding:4px 0;border-bottom:1px dashed var(--border-subtle)}

/* 弹窗 */
.rep-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(2px)}
.rep-modal{width:620px;max-width:92vw;max-height:84vh;background:var(--bg);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}
.rep-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle);font-size:15px;color:var(--t1)}
.rep-content{flex:1;overflow:auto;padding:16px 18px;margin:0;font-size:13px;line-height:1.7;color:var(--t1);white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.rep-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border-subtle)}

/* 窄屏：栅格降为 6 列 → 两栏各占 3 列；单列屏全宽堆叠 */
@media(max-width:1200px){
  .rep-card,.quota-card,.value-card,.insight-card{grid-column:span 3}
}
@media(max-width:768px){
  .rep-card,.quota-card,.value-card,.insight-card,.profile-card,.proposal-card{grid-column:1/-1}
}
/* M3 口径提案审核台 */
.prop-list{display:flex;flex-direction:column;gap:10px}
.prop-item{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--border-subtle);border-radius:10px;padding:11px 13px;background:var(--bg)}
.prop-item.done{opacity:.62}
.prop-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.prop-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prop-mod{font-size:11px;padding:1px 8px;border-radius:9px;background:var(--p-bg);color:var(--p-dark);flex-shrink:0}
.prop-name{font-size:13.5px;font-weight:600;color:var(--t1)}
.prop-st{font-size:11px;padding:1px 8px;border-radius:9px;flex-shrink:0}
.prop-st.st-pending{background:var(--p-bg);color:var(--p-dark)}
.prop-st.st-accepted{color:var(--suc);background:var(--dan-bg)}
.prop-st.st-rejected{color:var(--dan);background:var(--dan-bg)}
.prop-why{font-size:12.5px;color:var(--t2);line-height:1.55}
.prop-chg{font-size:12px;color:var(--t1);background:var(--bg2);border-radius:7px;padding:5px 9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.prop-meta{font-size:11px;color:var(--t3)}
.prop-fuel{font-size:11px;color:var(--p-dark)}
.prop-ops{display:flex;gap:6px;align-items:center;flex-shrink:0}
/* T1-5 记录一次口径（与审核台同卡） */
.cal-hint{font-size:12px;color:var(--t3);margin-bottom:10px;line-height:1.6}
.cal-hint b{color:var(--t2)}
.cal-form{background:var(--bg3);border:1px solid var(--border-subtle);border-radius:10px;padding:12px;margin-bottom:12px}
.cal-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cal-f1{width:130px}.cal-f2{width:250px}.cal-f3{width:150px}.cal-f4{flex:1;min-width:160px}
.cal-tip{font-size:11.5px;color:var(--t3);margin-top:7px;line-height:1.55}
</style>
