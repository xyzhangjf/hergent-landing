<template>
  <div class="page">
    <div class="page-hd split">
      <div class="br-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        <div>
          <h2>招投标雷达</h2>
          <span class="page-sub">中国政府采购网 · 全国公共资源交易平台 · 军队采购网 · 低温奶相关商机订阅（每日 07:10 自动抓取）</span>
          <span class="br-fresh">数据每日 07:10 自动更新 · 最新公告 {{ maxDate || '—' }}</span>
        </div>
      </div>
    </div>

    <div class="bento">
    <!-- KPI 概览条（顶部紧凑统计带） -->
    <div class="card kpi-strip">
      <div class="kpi">
        <div class="kpi-label">累计商机</div>
        <div class="kpi-val">{{ meta.total === null ? '—' : meta.total }}</div>
        <div class="kpi-sub">条公开招投标信息</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">近 3 日新增</div>
        <div class="kpi-val" :class="recentCount ? 'val-warn' : ''">{{ recentCount }}</div>
        <div class="kpi-sub">最近 3 天发布</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">覆盖省份</div>
        <div class="kpi-val">{{ meta.regionHit }}</div>
        <div class="kpi-sub">当前有商机的省</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">数据来源</div>
        <div class="kpi-val">{{ meta.sources.length }}</div>
        <div class="kpi-sub">个平台</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">当前结果</div>
        <div class="kpi-val">{{ items.length }}</div>
        <div class="kpi-sub">{{ meta.fetched_at ? '更新于 ' + meta.fetched_at : '尚未抓取' }}</div>
      </div>
    </div>

    <!-- 筛选与列表（主区，整行铺满） -->
    <div class="card br-main">
    <!-- 快速筛选 -->
    <div class="br-presets">
      <button class="br-chip" :class="{ on: f.source === 'plap' }" @click="togglePreset('plap')">军队采购网</button>
      <button class="br-chip" :class="{ on: recentOnly }" @click="toggleRecent">仅看近 3 日新增</button>
    </div>

    <!-- 筛选栏 -->
    <div class="br-filters">
      <input v-model.trim="f.keyword" class="br-inp" placeholder="搜标题 / 采购人关键词" @input="onSearch" />
      <select v-model="f.region" class="br-inp" @change="reload">
        <option value="">全部地区（{{ meta.regionHit }} 个省有商机）</option>
        <option v-for="r in meta.regions" :key="r.value" :value="r.value" :disabled="!r.count">
          {{ r.name }}{{ r.count ? `（${r.count}）` : '（无）' }}
        </option>
      </select>
      <select v-model="f.type" class="br-inp" @change="reload">
        <option value="">全部类型</option>
        <option v-for="t in meta.types" :key="t" :value="t">{{ t }}</option>
      </select>
      <select v-model="f.source" class="br-inp" @change="reload">
        <option value="">全部来源</option>
        <option v-for="s in meta.sources" :key="s.value" :value="s.value">
          {{ s.name }}（{{ s.count }}）
        </option>
      </select>
      <input v-model="f.date_from" type="date" class="br-inp" @change="reload" title="发布日起" />
      <span class="br-tilde">~</span>
      <input v-model="f.date_to" type="date" class="br-inp" @change="reload" title="发布日止" />
      <label class="br-chk">
        <input type="checkbox" v-model="f.capex" @change="reload" /> 含加工设备类
      </label>
      <button class="br-btn" @click="reload">查询</button>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="br-state">加载中…</div>
    <div v-else-if="!items.length" class="br-state br-empty">
      暂无匹配的招投标信息。可放宽筛选条件，或等待次日自动抓取。
    </div>
    <table v-else class="br-tbl">
      <thead>
        <tr>
          <th class="c-date">发布日</th>
          <th class="c-type">类型</th>
          <th class="c-src">来源</th>
          <th class="c-buyer">采购人</th>
          <th class="c-region">地区</th>
          <th>标题</th>
          <th class="c-link">原文</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in items" :key="it.url">
          <td class="c-date">{{ it.date }}</td>
          <td class="c-type"><span class="tag" :class="tagClass(it.type)">{{ it.type }}</span></td>
          <td class="c-src"><span class="src" :class="sourceTagClass(it.source)">{{ it.source_name }}</span></td>
          <td class="c-buyer">{{ it.buyer || '—' }}</td>
          <td class="c-region">{{ it.region }}</td>
          <td class="c-title">
            <span v-if="isNew(it)" class="br-new" title="近 24 小时或本次打开后新入库">新</span>
            <span v-if="it.is_capex" class="br-capex" title="制造端 CAPEX，非配送线索">CAPEX</span>
            {{ it.title }}
          </td>
          <td class="c-link"><a :href="it.url" target="_blank" rel="noopener" class="br-link">查看 ↗</a></td>
        </tr>
      </tbody>
    </table>

    <!-- 分页 -->
    <div v-if="meta.total > f.page_size" class="br-pager">
      <button class="br-btn" :disabled="f.page <= 1" @click="goto(f.page - 1)">上一页</button>
      <span class="br-pg-info">第 {{ f.page }} / {{ totalPages }} 页</span>
      <button class="br-btn" :disabled="f.page >= totalPages" @click="goto(f.page + 1)">下一页</button>
    </div>

    </div><!-- /br-main -->

    <p class="br-foot">数据来源：上述平台公开搜索结果 · 仅摘要+原文链接，不整篇搬运 · 合规使用</p>
    </div><!-- /bento -->
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../api/client'

const items = ref([])
const loading = ref(false)
const recentCount = ref(0)
const meta = reactive({ total: null, regions: [], types: [], sources: [], fetched_at: '', regionHit: 0 })
const f = reactive({
  keyword: '', region: '', type: '', source: '', date_from: '', date_to: '', capex: false,
  page: 1, page_size: 50
})
let _searchTimer = null

// 日期助手：用于「近 3 日」窗口与「新」角标判定
function fmtDate(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const NOW = new Date()
const _d3 = new Date(NOW); _d3.setDate(_d3.getDate() - 2)
const RECENT_FROM = fmtDate(_d3)                 // 近 3 日窗口下界（含今天共 3 天）
const NOW_MS = NOW.getTime()
const recentOnly = computed(() => f.date_from === RECENT_FROM && !f.date_to)
const LS_KEY = 'br_last_visit'
const lastVisitMs = ref(Number(localStorage.getItem(LS_KEY) || 0))   // 上次打开的时间戳

const totalPages = computed(() => Math.max(1, Math.ceil((meta.total || 0) / f.page_size)))
const maxDate = computed(() => {
  let m = ''
  for (const it of items.value) if (it.date > m) m = it.date
  return m
})
let _persisted = false

function tagClass(type) {
  if (['公开招标', '招标公告', '竞争性磋商', '竞争性谈判', '询价公告'].includes(type)) return 'tag-active'
  if (['成交公告'].includes(type)) return 'tag-done'
  return 'tag-muted'
}
function sourceTagClass(source) {
  if (source === 'plap') return 'src-plap'
  if (source === 'ggzy') return 'src-ggzy'
  if (source === 'ccgp') return 'src-ccgp'
  return 'src-other'
}
function isNew(it) {
  // 「新」= 近 24h 入库，或本次打开后才入库（自上次访问以来新增）
  const c = it.created_at ? new Date(it.created_at.replace(/-/g, '/')) : null
  if (!c || isNaN(c.getTime())) return false
  const t = c.getTime()
  if (t > lastVisitMs.value) return true
  if (NOW_MS - t <= 24 * 3600 * 1000) return true
  return false
}

function buildQuery() {
  const p = new URLSearchParams()
  if (f.keyword) p.set('keyword', f.keyword)
  if (f.region) p.set('region', f.region)
  if (f.type) p.set('type', f.type)
  if (f.source) p.set('source', f.source)
  if (f.date_from) p.set('date_from', f.date_from)
  if (f.date_to) p.set('date_to', f.date_to)
  if (f.capex) p.set('capex', '1')
  p.set('page', String(f.page))
  p.set('page_size', String(f.page_size))
  return p.toString()
}

async function reload() {
  f.page = 1
  await load()
}
async function goto(pg) {
  f.page = pg
  await load()
}
function onSearch() {
  clearTimeout(_searchTimer)
  _searchTimer = setTimeout(reload, 400)
}
function togglePreset(src) {
  f.source = f.source === src ? '' : src
  reload()
}
function toggleRecent() {
  if (recentOnly.value) {
    f.date_from = ''
  } else {
    f.date_from = RECENT_FROM
    f.date_to = ''
  }
  reload()
}

async function load() {
  loading.value = true
  try {
    const res = await api(`/api/bid-radar?${buildQuery()}`, { method: 'GET' })
    items.value = res.items || []
    meta.total = res.total
    meta.regions = res.regions || []
    meta.regionHit = (res.regions || []).filter(r => r.count > 0).length
    meta.types = res.types || []
    // 修复既存缺陷：后端 /api/bid-radar 一直返回 sources（bid_radar.py 的 "sources" 字段），
    // 但此处此前漏了赋值 → 筛选栏「全部来源」下拉与 KPI 概览条的来源数恒为空。
    meta.sources = res.sources || []
    meta.fetched_at = res.fetched_at || ''
    // 近 3 日新增计数（独立轻量查询，规避「按浏览器当天」白天恒为 0 的误导）
    const t = await api(`/api/bid-radar?date_from=${RECENT_FROM}&page_size=1`, { method: 'GET' })
    recentCount.value = t.total || 0
    // 记录本次打开时间，供下次访问判断「自上次打开后新增」
    if (!_persisted) { try { localStorage.setItem(LS_KEY, String(Date.now())) } catch (e) {} _persisted = true }
  } catch (e) {
    items.value = []
    meta.total = 0
    recentCount.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* Bento 分栏：.bento / .kpi-strip 及 KPI 子元素走全局层（variables.css），这里只声明本页占宽。
   此前 .br 被 1200px 限宽（1920 视口下占宽仅 74%）；招投标雷达属表格密集页，改为整行铺满。
   页头统一走全局 .page-hd.split —— 原来的 .br-head / .br-stat / .br-title h2|p / .br-new-n
   已分别由全局页头与 KPI 概览条替代，故一并删除。 */
.br-main{grid-column:1/-1}
.br-foot{grid-column:1/-1}
.br-title{display:flex;align-items:center;gap:12px}
.br-title svg{color:var(--p-dark);background:var(--p-bg);padding:8px;border-radius:12px;box-sizing:content-box}
.br-fresh{display:block;margin-top:4px;font-size:11px;color:var(--t3)}

.br-presets{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.br-chip{height:32px;padding:0 14px;border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t2);border-radius:999px;font-size:12px;cursor:pointer;transition:all .15s}
.br-chip:hover{border-color:var(--p)}
.br-chip.on{background:var(--p);color:#fff;border-color:var(--p)}

.br-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.br-inp{height:38px;padding:0 12px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg2);color:var(--t1);font-size:13px;outline:none}
.br-inp:focus{border-color:var(--p)}
.br-filters input[type=date]{width:150px}
.br-tilde{color:var(--t3)}
.br-chk{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--t2);cursor:pointer;user-select:none}
.br-btn{height:38px;padding:0 18px;border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t1);border-radius:10px;font-size:13px;cursor:pointer;transition:all .15s}
.br-btn:hover:not(:disabled){border-color:var(--p);color:var(--p-dark)}
.br-btn:disabled{opacity:.5;cursor:default}

.br-state{padding:48px;text-align:center;color:var(--t3);font-size:14px}
.br-empty{color:var(--t2)}

/* 表格已置于 .card 内（卡片自带边框与圆角），故去掉自身的边框/圆角，避免双层描边 */
.br-tbl{width:100%;border-collapse:collapse;font-size:13px}
.br-tbl th{text-align:left;padding:10px 12px;background:var(--bg2);color:var(--t2);font-weight:500;border-bottom:1px solid var(--border-subtle);white-space:nowrap}
.br-tbl td{padding:10px 12px;border-bottom:1px solid var(--border-subtle);color:var(--t1);vertical-align:top}
.br-tbl tbody tr:hover{background:var(--bg2)}
.c-date{white-space:nowrap;color:var(--t2);font-variant-numeric:tabular-nums}
.c-type{white-space:nowrap}
.c-src{white-space:nowrap}
.c-buyer{white-space:nowrap;color:var(--t1)}
.c-region{white-space:nowrap;color:var(--t2)}

.src{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:500;white-space:nowrap;cursor:default}
.src-ccgp{color:var(--p-dark);background:var(--p-bg)}
.src-ggzy{color:#7c3aed;background:rgba(139,92,246,.14)}
.src-plap{color:#dc2626;background:rgba(220,38,38,.12);font-weight:600}
.src-other{color:var(--t3);background:var(--bg3)}
.c-title{color:var(--t1);min-width:280px}
.c-link{white-space:nowrap}
.br-link{color:var(--p-dark);text-decoration:none;font-weight:500}
.br-link:hover{text-decoration:underline}
.br-new{display:inline-block;margin-right:6px;font-size:10px;font-weight:700;color:#fff;background:#dc2626;padding:1px 6px;border-radius:6px;vertical-align:middle}
.br-capex{display:inline-block;margin-right:6px;font-size:10px;font-weight:600;color:#b45309;background:rgba(245,158,11,.16);padding:1px 6px;border-radius:6px;vertical-align:middle}

.tag{display:inline-block;padding:2px 9px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap}
.tag-active{color:var(--p-dark);background:var(--p-bg)}
.tag-done{color:var(--suc);background:rgba(34,197,94,.13)}
.tag-muted{color:var(--t3);background:var(--bg3)}

.br-pager{display:flex;align-items:center;justify-content:center;gap:14px;margin:16px 0}
.br-pg-info{font-size:13px;color:var(--t2)}
.br-foot{margin-top:14px;font-size:11px;color:var(--t3);text-align:center}
</style>
