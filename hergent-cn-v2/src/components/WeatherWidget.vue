<template>
  <div class="wx" ref="root">
    <button class="wx-now" @click="open = !open" :title="locText()" :class="{ dim: !ready }">
      <span class="wx-ic">{{ icon() }}</span>
      <span class="wx-city">{{ city }}</span>
      <span class="wx-temp" v-if="temp != null">{{ temp }}°</span>
      <span class="wx-desc" v-if="desc() && temp != null">{{ desc() }}</span>
      <span v-if="loading" class="wx-load">…</span>
    </button>
    <div v-if="open" class="wx-pop">
      <div class="wx-search">
        <input
          class="wx-input"
          v-model="query"
          @input="onInput"
          @keyup.enter="pickFirst"
          placeholder="切换城市，输入城市名"
        />
        <button v-if="sel" class="wx-loc" @click="resetIp" title="恢复按 IP 自动定位">我的位置</button>
      </div>
      <div v-if="query.trim() && (results.length || searching || searched)" class="wx-results">
        <div
          v-for="(r, i) in results"
          :key="i"
          class="wx-res"
          :class="{ active: i === 0 }"
          @click="pick(r)"
          @mouseenter="hoverIdx = i"
        >
          <span class="wx-res-name">{{ r.name }}</span>
          <span class="wx-res-region" v-if="r.region">{{ r.region }}</span>
        </div>
        <div v-if="query.trim() && !searching && searched && !results.length" class="wx-res-none">
          未找到匹配城市
        </div>
      </div>

      <div v-if="days.length" class="wx-days-wrap">
        <div class="wx-days">
          <div class="wx-day" v-for="(d, i) in days" :key="i">
            <div class="wx-d-day">{{ dayLabel(d.date).text }}</div>
            <div class="wx-d-date">{{ dayLabel(d.date).date }}</div>
            <div class="wx-d-ic">{{ wmo(d.code)[1] }}</div>
            <div class="wx-d-t">{{ d.tmax }}° / {{ d.tmin }}°</div>
            <div class="wx-d-pop" v-if="d.pop != null">💧{{ d.pop }}%</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api, auth } from '../api/client'

const LS_KEY = 'wx_city'

const city = ref('—')
const temp = ref(null)
const code = ref(null)
const days = ref([])
const loading = ref(true)
const open = ref(false)
const ready = ref(false)
const root = ref(null)

// 用户已选城市 {name, lat, lon}，存 localStorage；为空表示按 IP 自动定位
const sel = ref(null)
const query = ref('')
const results = ref([])
const searching = ref(false)
const searched = ref(false)
const hoverIdx = ref(-1)
let searchTimer = null

const WMO = {
  0: ['晴', '☀️'], 1: ['晴间多云', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
  51: ['毛毛雨', '🌦️'], 53: ['小雨', '🌧️'], 55: ['中雨', '🌧️'],
  56: ['冻雨', '🌧️'], 57: ['冻雨', '🌧️'],
  61: ['小雨', '🌧️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '❄️'], 75: ['大雪', '❄️'], 77: ['雪粒', '❄️'],
  80: ['阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
  95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴', '⛈️'],
}

function wmo(c) {
  return WMO[c] || ['—', '🌡️']
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return { text: dateStr, date: '' }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((target - today) / 86400000)

  const names = ['日', '一', '二', '三', '四', '五', '六']
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')

  let text
  if (diff === -1) text = '昨天'
  else if (diff === 0) text = '今天'
  else if (diff === 1) text = '明天'
  else text = '周' + names[d.getDay()]

  return { text, date: mm + '/' + dd }
}

function locText() {
  if (sel.value) return '已选城市：' + sel.value.name + '（点击查看未来几天 / 切换城市）'
  return '按 IP 自动定位：' + city.value + '（点击可切换城市）'
}

async function load() {
  loading.value = true
  try {
    let r
    if (sel.value) {
      const p = '?lat=' + sel.value.lat + '&lon=' + sel.value.lon + '&city=' + encodeURIComponent(sel.value.name)
      r = await api('/api/weather' + p)
    } else {
      r = await api('/api/weather')
    }
    city.value = r.city || '—'
    temp.value = r.temp
    code.value = r.code
    days.value = r.days || []
    ready.value = !(r.temp == null)
  } catch (e) {
    city.value = '郑州'
    ready.value = false
  } finally {
    loading.value = false
  }
}

function onInput() {
  results.value = []
  searched.value = false
  hoverIdx.value = -1
  if (!query.value.trim()) return
  searching.value = true
  clearTimeout(searchTimer)
  searchTimer = setTimeout(doSearch, 300)
}
async function doSearch() {
  try {
    const r = await api('/api/weather/geocode?q=' + encodeURIComponent(query.value.trim()))
    results.value = r.results || []
  } catch (e) {
    results.value = []
  } finally {
    searching.value = false
    searched.value = true
  }
}
function pick(r) {
  sel.value = { name: r.name, lat: r.lat, lon: r.lon }
  try { localStorage.setItem(LS_KEY, JSON.stringify(sel.value)) } catch (e) {}
  query.value = ''
  results.value = []
  searched.value = false
  load()
  savePref()
}

// 账户级城市偏好：登录后写入后端（跨设备/浏览器生效），覆盖本地/IP 自动
async function savePref() {
  if (!auth.token) return
  try {
    const c = sel.value
    await api('/api/weather/pref', {
      method: 'POST',
      body: c ? { name: c.name, lat: c.lat, lon: c.lon } : { name: null },
    })
  } catch (e) {}
}
function pickFirst() {
  if (results.value.length) pick(results.value[0])
}
function resetIp() {
  sel.value = null
  try { localStorage.removeItem(LS_KEY) } catch (e) {}
  query.value = ''
  results.value = []
  searched.value = false
  load()
  savePref()
}

// 登录后拉取账户保存的城市偏好；有则覆盖本地/IP，无则保持现状
async function fetchPref() {
  if (!auth.token) return
  try {
    const r = await api('/api/weather/pref')
    const c = r && r.city
    if (c && c.name) {
      sel.value = { name: c.name, lat: c.lat, lon: c.lon }
      try { localStorage.setItem(LS_KEY, JSON.stringify(sel.value)) } catch (e) {}
      load()
    }
  } catch (e) {}
}

const icon = () => wmo(code.value)[1]
const desc = () => wmo(code.value)[0]

function onClickOutside(e) {
  if (open.value && root.value && !root.value.contains(e.target)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) sel.value = JSON.parse(raw)
  } catch (e) {}
  load()                       // 先用本地/IP 即时显示
  if (auth.token) fetchPref()  // 再用账户偏好覆盖（跨设备/浏览器生效）
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
})
</script>

<style scoped>
.wx{position:relative;display:flex;align-items:center}
.wx-now{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:15px;
  background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all .15s;white-space:nowrap}
.wx-now:hover{border-color:var(--p)}
.wx-now.dim{opacity:.6}
.wx-ic{font-size:16px;line-height:1}
.wx-temp{font-variant-numeric:tabular-nums}
.wx-load{opacity:.7}
.wx-pop{position:absolute;top:38px;left:50%;transform:translateX(-50%);z-index:30;
  display:flex;flex-direction:column;gap:10px;padding:10px 12px;border-radius:12px;width:max-content;max-width:calc(100vw - 20px);
  background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);
  border:1px solid var(--glass-border);box-shadow:0 10px 30px rgba(0,0,0,.12)}
.wx-search{display:flex;gap:6px;align-items:center;width:260px}
.wx-input{flex:1;min-width:0;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--glass-border);
  background:var(--bg);color:var(--t1);font-size:13px;outline:none}
.wx-input:focus{border-color:var(--p)}
.wx-loc{height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--p);background:transparent;
  color:var(--p);font-size:12px;cursor:pointer;white-space:nowrap}
.wx-loc:hover{background:var(--p-bg)}
.wx-results{display:flex;flex-direction:column;max-height:200px;overflow:auto;border-radius:8px;
  background:var(--bg);border:1px solid var(--glass-border)}
.wx-res{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;cursor:pointer;font-size:13px;color:var(--t1)}
.wx-res:hover,.wx-res.active{background:var(--p-bg)}
.wx-res-name{font-weight:500}
.wx-res-region{font-size:11px;color:var(--t2)}
.wx-res-none{padding:8px 10px;font-size:12px;color:var(--t2)}

.wx-days-wrap{position:relative;display:flex;flex-direction:column;width:max-content;max-width:calc(100vw - 20px)}

.wx-days{display:flex;gap:4px;padding-bottom:2px;overflow-x:auto;max-width:none}
.wx-days::-webkit-scrollbar{height:5px}
.wx-days::-webkit-scrollbar-thumb{background:var(--glass-border);border-radius:3px}
.wx-day{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:42px;padding:4px 2px;flex:1 0 auto}
.wx-d-day{font-size:12px;color:var(--t1);font-weight:500}
.wx-d-date{font-size:10px;color:var(--t2)}
.wx-d-ic{font-size:22px;line-height:1}
.wx-d-t{font-size:11px;color:var(--t1);font-variant-numeric:tabular-nums}
.wx-d-pop{font-size:11px;color:#2b8a3e}
</style>
