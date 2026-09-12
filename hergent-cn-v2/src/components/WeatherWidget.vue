<template>
  <div class="wx" ref="root">
    <!-- 收起态：只留 天气图标 + 温度（扫一眼即可读的两个量）。位置与实况描述迁入展开面板首行 -->
    <button class="wx-now" @click="open = !open" :title="locText()" :aria-label="locText()" :class="{ dim: !ready }">
      <span class="wx-ic">{{ icon() }}</span>
      <span class="wx-temp" v-if="temp != null">{{ tempInt(temp) }}°</span>
      <span v-if="loading" class="wx-load">…</span>
    </button>
    <!-- 展开面板 Teleport 到 <body>：顶栏 .topbar 同时带 z-index:10 与 backdrop-filter，
         双重创建 stacking context → 面板的 z-index 无论设多高都被困在顶栏内（等效全局 10），
         会被预报页工具栏的 .tb-pop（z-index:1120）压住。只有脱离该 context 才能参与全局层叠。
         v-if 首帧隐藏（.pre）避免出现「先落在静态位置、再跳到按钮下方」的闪烁。 -->
    <Teleport to="body">
    <div v-if="open" ref="popEl" class="wx-pop" :class="{ pre: !popPlaced }" :style="popStyle">
      <!-- 位置上下文行（面板首行）：收起态按钮上的「城市名 / 天气描述」迁到这里，
           成为面板的阅读起点 —— 先确认「这是哪儿」，再看未来趋势。
           左起连续排列：位置（图标 + 城市名 + 定位来源）→ 分隔点 → 当前实况（描述 + 温度）。 -->
      <div class="wx-where">
        <Icon name="map-pin" :size="14" class="wx-where-ic" />
        <span class="wx-where-city">{{ city }}</span>
        <span class="wx-where-tag">{{ sel ? '已选城市' : '自动定位' }}</span>
        <span v-if="desc() && temp != null" class="wx-where-desc">{{ desc() }} {{ tempInt(temp) }}°</span>
      </div>
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
          <!-- 日卡片：法定节假日当天用节日名替换日期并标「休」，连休日标「休」，调休上班日标「班」。
               低温柔性奶销售受节假日影响大，老板扫一眼这一行就能看到假期与补班，
               提前安排备货与送货。节假日数据见 src/utils/cnHolidays.js（静态表，每年更新一次）。 -->
          <div class="wx-day" v-for="(r, i) in dayRows" :key="i" :title="r.tip">
            <div class="wx-d-day">{{ r.lab.text }}</div>
            <div class="wx-d-date">
              <span class="wx-d-dt" :class="{ 'is-name': !!r.hdName }">{{ r.hdName || r.lab.date }}<span
                v-if="r.badge" class="wx-hb" :class="r.badge === '班' ? 'work' : 'off'">{{ r.badge }}</span></span>
            </div>
            <div class="wx-d-ic">{{ wmo(r.code)[1] }}</div>
            <div class="wx-d-t">{{ tempInt(r.tmax) }}° / {{ tempInt(r.tmin) }}°</div>
            <div class="wx-d-pop" v-if="r.pop != null">💧{{ r.pop }}%</div>
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
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { api, auth } from '../api/client'
import { store } from '../store'
import { cnHoliday, loadRemoteHolidays } from '../utils/cnHolidays'
import Icon from './Icon.vue'

const LS_KEY = 'wx_city'

const city = ref('—')
const temp = ref(null)
const code = ref(null)
const days = ref([])
const loading = ref(true)
const open = ref(false)
const ready = ref(false)
const root = ref(null)

// ---- 展开面板定位（Teleport 到 body 后需按视口坐标自行定位，原因见模板注释） ----
const popEl = ref(null)          // 面板根节点：脱离 .wx 后 onClickOutside 需单独判定是否在面板内
const popPos = ref({})           // placePop() 写入的 { left, top }
const popPlaced = ref(false)     // 首帧未定位前置隐藏，避免「先落在静态位置、再跳到按钮下方」的闪烁
// 层级：常态须高于页面内最高的浮层 .tb-pop（z-index:1120）；副驾抽屉（.copilot z-index:950）
// 打开时让位，避免天气面板压住抽屉。
const popStyle = computed(() => ({
  ...popPos.value,
  zIndex: store.ui && store.ui.copilotOpen ? '900' : '1121',
}))

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

// 面板内所有温度的统一格式化入口：四舍五入取整（负数按绝对值四舍五入，-2.5 → -3）
// 任何温度字段（当前温/最高/最低/多日预报/趋势浮层/升降温差值）都必须走这里，
// 避免出现同一面板内部分带小数、部分为整数。
function tempInt(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return null
  return n < 0 ? -Math.round(-n) : Math.round(n)
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

  // full/week 供悬停提示使用：日卡片在节假日会把「MM/DD」换成节日名，日期本身不能丢
  return { text, date: mm + '/' + dd, full: d.getMonth() + 1 + '月' + d.getDate() + '日', week: '周' + names[d.getDay()] }
}

// 日卡片的渲染数据：把「日期标签 + 节假日属性」合并算一次，
// 避免模板里对同一张卡片重复调用 dayLabel()/cnHoliday()（16 张卡 × 3 次调用）。
const dayRows = computed(() => (days.value || []).map((d) => {
  const lab = dayLabel(d.date)
  const hd = cnHoliday(d.date)
  // 只有法定节假日当天（showName）才用节日名替换日期；连休日保留日期、仅加「休」徽标
  const name = hd && hd.showName ? hd.name : ''
  const suffix = hd ? ' · ' + hd.period + (hd.work ? '调休上班' : '假期') : ''
  return {
    date: d.date,
    code: d.code,
    tmax: d.tmax,
    tmin: d.tmin,
    pop: d.pop,
    lab,
    hd,
    hdName: name,
    badge: hd ? (hd.work ? '班' : '休') : '',
    tip: lab.full + ' ' + lab.week + suffix,
  }
}))

function locText() {
  if (sel.value) return '已选城市：' + sel.value.name + '（点击查看未来几天 / 切换城市）'
  return '按 IP 自动定位：' + city.value + '（点击可切换城市）'
}

// 面板以 position:fixed 挂在 body 上，需按触发按钮的视口矩形自行定位：
// 水平对齐按钮中心并夹住视口两侧（窄屏面板被 max-width 收窄时仍不溢出），垂直落在按钮下沿 8px。
function placePop() {
  const btn = root.value && root.value.querySelector('.wx-now')
  const el = popEl.value
  if (!btn || !el) return
  const b = btn.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const pad = 10
  const w = el.offsetWidth
  const h = el.offsetHeight
  const left = Math.max(pad, Math.min(b.left + b.width / 2 - w / 2, vw - w - pad))
  const top = Math.min(b.bottom + 8, Math.max(pad, vh - h - pad))
  popPos.value = { left: Math.round(left) + 'px', top: Math.round(top) + 'px' }
  popPlaced.value = true
}

// 面板宽度由内容决定（14 天卡片行最宽）—— 数据到位 / 城市名变长 / 窄屏 max-width 生效时宽度会变，
// 变化后必须按新宽度重新居中，否则面板会停在旧宽度算出的位置上。
let popRo = null
function observePop() {
  if (typeof ResizeObserver === 'undefined' || !popEl.value) return
  if (popRo) popRo.disconnect()
  popRo = new ResizeObserver(() => placePop())
  popRo.observe(popEl.value)
}

// 视口尺寸变化（窗口缩放 / 移动端横竖屏）→ 按钮位置与 max-width 都会变，需重新定位
function onWinResize() {
  if (open.value) placePop()
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
  // 先取整再参与计算：折线高度、拐点判定、浮层温差都必须与卡片上显示的数字自洽
  const vals = ds.map((d) => _t(tempInt(d.tmax)))
  const maxT = Math.max(...vals)
  const minT = Math.min(...vals)
  const span = maxT - minT
  const PAD_T = 16
  const PAD_B = 80 // 底部留白：圆点不贴边，避免被 overflow 裁掉
  const midY = (PAD_T + PAD_B) / 2
  const n = ds.length
  const pts = ds.map((d, i) => ({
    i,
    tmax: tempInt(d.tmax),
    tmin: tempInt(d.tmin),
    label: dayLabel(d.date).text,
    x: ((i + 0.5) / n) * 100,
    y: span > 0 ? PAD_T + ((maxT - vals[i]) / span) * (PAD_B - PAD_T) : midY,
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
    const d = p.tmax - prev.tmax // 两侧均已取整，整数相减无浮点误差
    if (d >= TREND_DELTA) delta = ` · 升温 ${d}°`
    else if (d <= -TREND_DELTA) delta = ` · 降温 ${-d}°`
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
  if (!v) return
  // 首次打开时 popPos 为空 → 先隐藏，等 placePop() 算出坐标再显示；
  // 之后沿用上次坐标（宽度通常不变），不隐藏以免闪一下，偏差由随后的 placePop() 抹平。
  if (!popPos.value.left) popPlaced.value = false
  nextTick(() => {
    placePop()
    observePop()
    syncTrend()
  })
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
  if (!open.value) return
  const t = e.target
  if (root.value && root.value.contains(t)) return
  // 面板已 Teleport 到 body，不再位于 .wx 之内 → 必须单独判定，
  // 否则点击面板内部（搜索框、日卡片）都会被当成「点外部」而把面板关掉。
  if (popEl.value && popEl.value.contains(t)) return
  open.value = false
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener('resize', onWinResize)
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) sel.value = JSON.parse(raw)
  } catch (e) {}
  load()                       // 先用本地/IP 即时显示
  // 节假日表：走后端接口（每年自动更新）；失败时静默回落到内置静态表，不阻塞天气渲染
  loadRemoteHolidays()
  if (auth.token) fetchPref()  // 再用账户偏好覆盖（跨设备/浏览器生效）
  // 趋势线宽度跟随容器（弹层展开/窗口变化/窄屏）实时对齐日卡片行
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => syncTrend())
    ensureTrendObserver()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('resize', onWinResize)
  if (ro) { ro.disconnect(); ro = null }
  if (popRo) { popRo.disconnect(); popRo = null }
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

/* 位置上下文行（2026-09-12）：收起态按钮瘦身成「图标 + 温度」后，城市名与实况描述迁到面板首行。
   布局 = 左起连续的一条「位置 → 实况」阅读线：📍图标 → 城市名 → 定位来源徽标 → · → 描述 + 当前温度。
   ⚠️ 不要用 space-between / margin-left:auto 把实况推到右端：面板宽度由下方 14 天卡片行撑开
   （实测 922px），两端对齐会在中间留下约 800px 空洞。左对齐与同面板内搜索框的行为一致。 */
.wx-where{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--t2)}
.wx-where-ic{color:var(--p);flex:0 0 auto}
.wx-where-city{font-size:13px;font-weight:600;color:var(--t1)}
.wx-where-tag{flex:0 0 auto;padding:1px 6px;border-radius:6px;background:var(--p-bg);color:var(--p-dark);font-size:10px;line-height:1.6}
.wx-where-desc{font-variant-numeric:tabular-nums;white-space:nowrap}
.wx-where-desc::before{content:'·';margin-right:6px;color:var(--t3)}
/* 面板由 Teleport 挂在 <body> 上、position:fixed，坐标由 placePop() 写入。
   ⚠️ 不能回到「留在顶栏内 + position:absolute」的写法：顶栏 .topbar 同时带 z-index:10 与
   backdrop-filter，双重创建 stacking context，面板 z-index 设多高都会被困在顶栏内（等效全局 10），
   会被预报页工具栏的 .tb-pop（z-index:1120）压住。1121 即为此定：高于页面内所有下拉浮层。 */
.wx-pop{position:fixed;z-index:1121;
  display:flex;flex-direction:column;gap:10px;padding:10px 12px;border-radius:12px;width:max-content;max-width:calc(100vw - 20px);
  background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);
  border:1px solid var(--glass-border);box-shadow:0 10px 30px rgba(0,0,0,.12)}
/* 首帧未定位前隐藏：避免先出现在静态位置、再跳到按钮下方 */
.wx-pop.pre{visibility:hidden}
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
/* min-width 52px（原 42px）：要放得下 3 字节日名（11px 字号 ≈33px）与右上角徽标。
   卡片在桌面端实测已是 52.3px（由「29° / 21°」这类内容撑开），提到 52px 不会加宽面板；
   只在窄屏 max-width 生效时阻止卡片被压到 42px —— 那时节日名会与徽标重叠。
   窄屏改为横向滚动（.wx-days 本就是 overflow-x:auto），信息仍完整可读。 */
.wx-day{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:52px;padding:4px 2px;flex:1 0 auto}
.wx-d-day{font-size:12px;color:var(--t1);font-weight:500}
.wx-d-date{font-size:10px;color:var(--t2);line-height:15px}
/* 日期 / 节日名 = 徽标的定位锚（inline-block + relative，宽度即文字宽度，
   不随卡片宽度变化；徽标作为其内联子元素绝对定位，绝不影响行内布局与居中）。 */
.wx-d-dt{display:inline-block;position:relative}
/* 节日名：比日期大一号、加粗、节庆红 —— 扫这一行时节日要第一个跳出来 */
.wx-d-dt.is-name{font-size:11px;font-weight:600;color:var(--hd-name)}
/* 休 / 班 徽标：贴在日期或节日名的右上角（文字之右、略微上提），不遮字。
   定位取值依据（卡片内容区 48px，实测卡片 52.3px，日期 10px 字号 ≈26px 宽、节日名 11px ≈33px 宽）：
     · right:-10px + 宽 11px → 徽标左缘正好落在文字右缘（26px 文字时右缘 center+23、
       33px 文字时 center+26.5），与文字仅 0~1px 交叠，不会压住末字。
     · top:-6px → 徽标纵向落在文字上方的空隙里：其下缘距日期字形还有 ~2px，
       上缘距「周X」字形 0.4px，两边都不碰。
     · 最宽情形（3 字节日名）徽标右缘超出卡片 0.35px，落在卡片间 4px 间隙内，
       不裁切、不压到相邻卡片（第一版曾把徽标做成 13px 并挂卡片右上角，
       那会落在「周X」同一行、"周日 班" 会被读成周日的属性，已改掉）。 */
.wx-hb{position:absolute;top:-6px;right:-10px;min-width:11px;height:11px;box-sizing:border-box;
  padding:0 1px;border-radius:5.5px;font-size:8px;font-weight:600;line-height:11px;text-align:center;
  color:#fff;font-style:normal;pointer-events:none}
.wx-hb.off{background:var(--hd-off)}
.wx-hb.work{background:var(--hd-work)}
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
