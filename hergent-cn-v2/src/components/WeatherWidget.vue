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
        <div class="wx-days" ref="daysEl" @scroll="syncTrend">
          <div class="wx-day" v-for="(d, i) in days" :key="i">
            <div class="wx-d-day">{{ dayLabel(d.date).text }}</div>
            <div class="wx-d-date">{{ dayLabel(d.date).date }}</div>
            <div class="wx-d-ic">{{ wmo(d.code)[1] }}</div>
            <div class="wx-d-t">{{ d.tmax }}° / {{ d.tmin }}°</div>
            <div class="wx-d-pop" v-if="d.pop != null">💧{{ d.pop }}%</div>
          </div>
        </div>

        <!-- 温度趋势线：与上方日卡片行同父容器，宽度/内边距/圆角天然对齐 -->
        <div v-if="trendGeo" class="wx-trend-wrap" ref="trendWrap">
          <div class="wx-trend" ref="trendEl" :style="trendW ? { width: trendW + 'px' } : null">
            <svg class="wx-trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="wxTrendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--p)" stop-opacity=".30" />
                  <stop offset="100%" stop-color="var(--p)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path class="wx-trend-area" :d="areaPath" />
              <path
                v-for="s in trendSegs"
                :key="'s' + s.i"
                class="wx-trend-line"
                :class="s.dir"
                :d="s.d"
              />
            </svg>

            <!-- 悬停/点击热区：整列命中，不用精确点中圆点 -->
            <div
              v-for="p in trendGeo"
              :key="'h' + p.i"
              class="wx-trend-hit"
              :class="{ on: activePt === p.i }"
              :style="{ left: (p.i / trendGeo.length * 100) + '%', width: (100 / trendGeo.length) + '%' }"
              @mouseenter="hoverPt = p.i"
              @mouseleave="hoverPt = -1"
              @click="pinPt = pinPt === p.i ? -1 : p.i"
            ></div>

            <!-- 拐点：降温标「降」、升温橙色圆点（HTML 定位，避免 SVG 拉伸把圆点压成椭圆） -->
            <span
              v-for="p in markedPoints"
              :key="'m' + p.i"
              class="wx-trend-dot"
              :class="[p.mark, { last: p.last }]"
              :style="{ left: p.x + '%', top: p.y + '%' }"
            ><em v-if="p.mark === 'down'">降</em></span>

            <div v-if="activePt >= 0" class="wx-trend-tip" :class="{ pinned: pinPt >= 0 }" :style="tipStyle">{{ tipText }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
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

// 全部追加 U+FE0F（变体选择符）强制走彩色 emoji 渲染，避免 ☀/☁/❄/⛈ 等
// BMP 符号被浏览器按"文本字形"渲染成单色线稿，跟 🌤/🌧/🌨 等 emoji-default
// 字形视觉风格不一致。加 VS16 对后者是幂等的，整体统一为 Apple Color Emoji 风格。
const WMO = {
  0: ['晴', '☀️'], 1: ['晴间多云', '🌤️'], 2: ['多云', '⛅️'], 3: ['阴', '☁️'],
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

// ---------------------------------------------------------------------------
// 温度趋势线：日最高温走势，升温/降温分段着色 + 拐点标记
// 业务意图：温度直接影响低温奶销量，老板要一眼看出升/降温拐点提前备货。
// ---------------------------------------------------------------------------
const daysEl = ref(null)
const trendWrap = ref(null)
const trendEl = ref(null)
const trendW = ref(0)
const hoverPt = ref(-1) // 悬停态（桌面）
const pinPt = ref(-1)   // 钉住态（点击/触摸，移开鼠标也不消失）
const TREND_DELTA = 3 // 明显拐点阈值（°C）
// 悬停与点击要分开：否则桌面 mouseenter 先置位、click 又把它切回 -1，点了反而消失
const activePt = computed(() => (pinPt.value >= 0 ? pinPt.value : hoverPt.value))

const _t = (v) => (v == null ? 0 : v)

const trendGeo = computed(() => {
  const ds = days.value || []
  if (ds.length < 2) return null
  const vals = ds.map((d) => _t(d.tmax))
  const maxT = Math.max(...vals)
  const minT = Math.min(...vals)
  const span = maxT - minT || 1
  const PAD_T = 16
  const PAD_B = 80 // 底部留白：圆点不贴边，避免被 overflow 裁掉
  const n = ds.length
  const pts = ds.map((d, i) => ({
    i,
    tmax: d.tmax,
    tmin: d.tmin,
    label: dayLabel(d.date).text,
    x: ((i + 0.5) / n) * 100,
    y: PAD_T + ((maxT - _t(d.tmax)) / span) * (PAD_B - PAD_T),
    last: i === n - 1,
    mark: null,
  }))
  // 拐点：与前一天相比，升/降温达阈值即在当天标记
  for (let i = 1; i < pts.length; i++) {
    const d = _t(pts[i].tmax) - _t(pts[i - 1].tmax)
    if (d >= TREND_DELTA) pts[i].mark = 'up'
    else if (d <= -TREND_DELTA) pts[i].mark = 'down'
  }
  return pts
})

const trendSegs = computed(() => {
  const pts = trendGeo.value
  if (!pts) return []
  return pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1]
    const d = _t(q.tmax) - _t(p.tmax)
    return {
      i,
      dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
      d: `M ${p.x} ${p.y} L ${q.x} ${q.y}`,
    }
  })
})

const areaPath = computed(() => {
  const pts = trendGeo.value
  if (!pts) return ''
  return (
    `M ${pts[0].x} 100 ` +
    pts.map((p) => `L ${p.x} ${p.y}`).join(' ') +
    ` L ${pts[pts.length - 1].x} 100 Z`
  )
})

const markedPoints = computed(() => (trendGeo.value || []).filter((p) => p.mark))

const tipText = computed(() => {
  const pts = trendGeo.value
  const idx = activePt.value
  if (!pts || idx < 0) return ''
  const p = pts[idx]
  const prev = pts[idx - 1]
  let delta = ''
  if (prev && p.tmax != null && prev.tmax != null) {
    const d = p.tmax - prev.tmax
    // 一位小数，避免 33.3-30 这类浮点误差显示成 3.299999999999997
    const r1 = (v) => Math.round(v * 10) / 10
    if (d >= TREND_DELTA) delta = ` · 升温 ${r1(d)}°`
    else if (d <= -TREND_DELTA) delta = ` · 降温 ${r1(-d)}°`
  }
  return `${p.label}${delta} · ${p.tmax}°/${p.tmin}°`
})

const tipStyle = computed(() => {
  const pts = trendGeo.value
  const idx = activePt.value
  if (!pts || idx < 0) return {}
  const p = pts[idx]
  // 左右夹住，避免浮层溢出卡片边界；纵向固定在趋势线顶部，不随点位上下溢
  return { left: Math.min(Math.max(p.x, 22), 78) + '%' }
})

// 宽度对齐：取日卡片行实际内容宽，横向滚动时同步位移，保证点与日期不错位
function syncTrend() {
  if (!daysEl.value) return
  trendW.value = daysEl.value.scrollWidth
  if (trendEl.value) trendEl.value.style.transform = `translateX(${-daysEl.value.scrollLeft}px)`
}

watch(() => days.value, () => {
  hoverPt.value = -1
  pinPt.value = -1
  nextTick(() => { syncTrend(); ensureTrendObserver() })
})
watch(() => open.value, (v) => {
  hoverPt.value = -1
  pinPt.value = -1
  if (v) nextTick(syncTrend)
})

let ro = null
let roBound = false
// 趋势线容器是 v-if 懒渲染，数据到位后才存在，需延迟挂载观察
function ensureTrendObserver() {
  if (!ro || roBound || !trendWrap.value) return
  ro.observe(trendWrap.value)
  roBound = true
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
  // 趋势线宽度跟随容器（弹层展开/窗口变化/窄屏）实时对齐日卡片行
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => syncTrend())
    ensureTrendObserver()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  if (ro) { ro.disconnect(); ro = null }
})
</script>

<style scoped>
.wx{position:relative;display:flex;align-items:center}
.wx-now{display:flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:18px;
  background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all .15s;white-space:nowrap}
.wx-now:hover{background:var(--p);color:#fff;box-shadow:0 4px 14px rgba(6,182,212,.22)}
.wx-now.dim{opacity:.6}
.wx-ic{font-size:16px;line-height:1}
.wx-temp{font-variant-numeric:tabular-nums}
.wx-load{opacity:.7}
.wx-pop{position:absolute;top:42px;left:50%;transform:translateX(-50%);z-index:30;
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

/* 温度趋势线：与上方日卡片行同父容器，宽度/内边距/圆角一致 */
.wx-trend-wrap{position:relative;overflow:hidden;margin-top:2px;padding-top:5px;border-top:1px solid var(--glass-border)}
.wx-trend{position:relative;height:42px}
.wx-trend-svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
.wx-trend-area{fill:url(#wxTrendGrad);stroke:none}
.wx-trend-line{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.wx-trend-line.up{stroke:#f97316}
.wx-trend-line.down{stroke:#0ea5e9}
.wx-trend-line.flat{stroke:var(--t3)}
/* 拐点圆点：HTML 绝对定位，避免 SVG preserveAspectRatio=none 把圆点压成椭圆 */
.wx-trend-dot{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;
  background:var(--bg);border:2px solid currentColor;pointer-events:none}
.wx-trend-dot.up{color:#f97316}
.wx-trend-dot.down{color:#0ea5e9}
.wx-trend-dot em{position:absolute;left:9px;top:-5px;font-size:9px;font-style:normal;font-weight:600;
  line-height:1.3;padding:0 3px;border-radius:4px;background:var(--bg2);color:currentColor;
  box-shadow:0 0 0 1px var(--glass-border)}
.wx-trend-dot.last em{left:auto;right:9px}
.wx-trend-hit{position:absolute;top:0;bottom:0;cursor:pointer;border-radius:6px}
.wx-trend-hit:hover,.wx-trend-hit.on{background:var(--p-bg);opacity:.55}
.wx-trend-tip{position:absolute;top:0;transform:translateX(-50%);z-index:2;
  padding:2px 7px;border-radius:6px;background:var(--t1);color:var(--bg);
  font-size:11px;font-weight:500;line-height:1.5;white-space:nowrap;pointer-events:none;
  box-shadow:0 4px 12px rgba(0,0,0,.18)}
</style>
