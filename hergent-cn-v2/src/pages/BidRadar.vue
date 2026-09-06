<template>
  <div class="br">
    <div class="br-head">
      <div class="br-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        <div>
          <h2>招投标雷达</h2>
          <p>中国政府采购网 · 全国公共资源交易平台 · 军队采购网 · 低温奶相关商机订阅（每日 07:10 自动抓取）</p>
        </div>
      </div>
      <div class="br-stat" v-if="!loading && meta.total !== null">
        共 <b>{{ meta.total }}</b> 条 · 今日新增 <b class="br-new-n">{{ todayCount }}</b> · 更新于 {{ meta.fetched_at }}
      </div>
    </div>

    <!-- 快速筛选 -->
    <div class="br-presets">
      <button class="br-chip" :class="{ on: f.source === 'plap' }" @click="togglePreset('plap')">军队采购网</button>
      <button class="br-chip" :class="{ on: todayOnly }" @click="toggleToday">仅看今日新增</button>
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
            <span v-if="isNew(it)" class="br-new" title="今日发布">新</span>
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

    <p class="br-foot">数据来源：上述平台公开搜索结果 · 仅摘要+原文链接，不整篇搬运 · 合规使用</p>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../api/client'

const items = ref([])
const loading = ref(false)
const todayCount = ref(0)
const meta = reactive({ total: null, regions: [], types: [], sources: [], fetched_at: '', regionHit: 0 })
const f = reactive({
  keyword: '', region: '', type: '', source: '', date_from: '', date_to: '', capex: false,
  page: 1, page_size: 50
})
let _searchTimer = null

const TODAY = (() => {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()
const todayOnly = computed(() => f.date_from === TODAY && !f.date_to)

const totalPages = computed(() => Math.max(1, Math.ceil((meta.total || 0) / f.page_size)))

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
  return it.date === TODAY
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
function toggleToday() {
  if (todayOnly.value) {
    f.date_from = ''
  } else {
    f.date_from = TODAY
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
    meta.fetched_at = res.fetched_at || ''
    // 今日新增计数（独立轻量查询）
    const t = await api(`/api/bid-radar?date_from=${TODAY}&page_size=1`, { method: 'GET' })
    todayCount.value = t.total || 0
  } catch (e) {
    items.value = []
    meta.total = 0
    todayCount.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.br{max-width:1180px;margin:0 auto}
.br-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.br-title{display:flex;align-items:center;gap:12px}
.br-title svg{color:var(--p-dark);background:var(--p-bg);padding:8px;border-radius:12px;box-sizing:content-box}
.br-title h2{margin:0;font-size:20px;font-weight:600;color:var(--t1)}
.br-title p{margin:2px 0 0;font-size:12px;color:var(--t3)}
.br-stat{font-size:13px;color:var(--t2);background:var(--bg2);padding:6px 12px;border-radius:10px}
.br-stat b{color:var(--p-dark)}
.br-new-n{color:#dc2626}

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

.br-tbl{width:100%;border-collapse:collapse;background:var(--bg);border:1px solid var(--border-subtle);border-radius:12px;overflow:hidden;font-size:13px}
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
