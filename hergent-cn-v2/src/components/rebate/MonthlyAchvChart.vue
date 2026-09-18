<template>
  <div class="mac" ref="rootEl">
    <div class="mac-hd">
      <div class="mac-ti">
        <b>全年月度达成</b>
        <!-- v185 R1：副标题只留**唯一不能从图上直接读出来**的一句。
             删掉的两句：「柱高＝金额」（纵轴刻度＋柱顶「XX万」已自证）、
             「灰轨道＝…／深色段＝…」（与图例逐字/同义重复，见下方 .mac-legend 注释） -->
        <span class="mac-sub">上下两张图各用自己的量程，柱高不可跨图比较</span>
      </div>
      <div class="mac-ctl">
        <!-- v185 C2：图表密度切换 —— 用户 2026-09-18 选定「保留 12 月 + 紧凑档切换」
             （不采用"尾部空月不占槽"的自适应裁剪：12 月全景是"看全年走势"的本职）。
             紧凑档只压单图高度（200→132）与刻度段数（5→3），不改变任何数据与口径。
             选择记进 localStorage，下次进页面保持。
             复用 v154 删掉「全年视图」切换器后遗留的 .mac-seg / .seg-btn —— 那 4 条 CSS
             原本是死 CSS，现在名副其实地活了（不新增样式类）。 -->
        <div class="mac-seg" role="group" aria-label="图表高度">
          <button type="button" class="seg-btn" :class="{ on: density === 'full' }"
                  title="单图 200px，5 段刻度" @click="setDensity('full')">完整</button>
          <button type="button" class="seg-btn" :class="{ on: density === 'compact' }"
                  title="单图 132px，3 段刻度（12 个月份与全部数据不变）" @click="setDensity('compact')">紧凑</button>
        </div>
        <!-- v154 P2-A：品牌筛选已提升为页面级（`BrandFilter.vue`，与页面「统计月份」并排，一处筛选统管
             图表 + 异常区 + 达成列表）；原「全年视图」scope 徽标一并删除 —— 标题「全年月度达成」已表达该语义，
             且它与页头「单月视图」样式不一，两个时间维度的层级关系反而更乱 -->
        <select v-model="yearVal" class="input sel-year" @change="emit('update:year', yearVal)">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
        </select>
      </div>
    </div>

    <!-- v159：图例改为「口径说明」——每月合并柱后，目标与达成不再是可独立开关的两个系列，
         故不再提供点击隐藏；改为解释柱子的两段结构（轨道 / 填充 / 超额段）与本月红绿规则。
         v162：拆成上下两张单轴图后，系列名与单位已由每张图的小标题承担（不必再来回找归属）→
         图例只留「怎么读这根柱」的共性说明。
         v185 R1：由 4 条精简为 3 条。原 ① 灰轨道 与 ④ 深色段是**两条独立图例讲同一件事**
         （柱体两段结构），合并为一条（两个色块 + 一句话）；副标题里那一份同名说明已删。
         净效果：说明性文案 6 条 → 4 条（副标题 1 + 图例 3），且**零信息损失**。 -->
    <div class="mac-legend">
      <span class="lg-item"><i class="lg-track"></i>灰轨道＝目标位<i class="lg-deep lg-sep"></i>深色段＝超额</span>
      <span class="lg-item">
        <i :style="{ background: C.ahead.deep }"></i>
        <i :style="{ background: C.behind.deep }" class="lg-gap"></i>
        本月 绿＝超前时间进度 / 红＝落后
      </span>
      <span v-if="paceIdx >= 0" class="lg-item"><i class="lg-line"></i>虚线＝本月时间进度应完成的金额</span>
    </div>

    <!-- 加载态：骨架屏 -->
    <!-- v185 C2：高度改由 CANVAS_H 动态给出（原 CSS 里写死 468px）—— 紧凑档下骨架屏/空态
         必须跟着变矮，否则切档时页面会先跳一下再落定 -->
    <div v-if="loading" class="mac-body mac-skel" :style="{ height: CANVAS_H + 'px' }">
      <div v-for="i in 12" :key="i" class="sk-col">
        <span :style="{ height: (30 + ((i * 37) % 45)) + '%' }"></span>
        <span :style="{ height: (24 + ((i * 23) % 40)) + '%' }"></span>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!hasAny" class="mac-body mac-empty" :style="{ height: CANVAS_H + 'px' }">
      <p>{{ emptyText }}</p>
      <slot name="empty-action" />
    </div>

    <!-- 图表：上下两张单轴图，共享同一套 x 轴几何 → 月份列严格对齐 -->
    <div v-else class="mac-scroll">
      <div class="mac-canvas">
        <div v-for="sec in sections" :key="sec.key" class="mac-sec">
          <div class="sec-hd">
            <b>{{ sec.title }}</b>
            <span v-if="sec.unit" class="sec-u">{{ sec.unit }}</span>
            <!-- v185 R1：原 .sec-note「柱高＝实际销量 / 柱高＝实际返利金额」已删 —— 紧邻的小标题
                 （销量达成 / 实际返利）已表达该图讲什么，单位由 .sec-u 承担，note 是第三遍讲"柱高" -->
          </div>

          <!-- 该系列整年无数据：占位等高，避免两张图高度不一造成上下错位 -->
          <div v-if="!(sec.max > 0)" class="sec-empty" :style="{ height: SH + 'px' }">本年无{{ sec.title }}数据</div>

          <svg
            v-else
            :viewBox="`0 0 ${W} ${SH}`"
            class="mac-svg"
            :style="{ height: SH + 'px' }"
            preserveAspectRatio="none"
            role="img"
            @mouseleave="tip = null"
          >
            <!-- 横向网格线 + 纵轴刻度：本图自成一把尺子，量程 = 全年 max(目标, 达成) 取整 -->
            <!-- v162：单轴图，刻度数字用本系列的深色（销量青 / 返利琥珀），与本图柱子同色系 -->
            <line
              v-for="g in sec.ticks" :key="sec.key + 'g' + g.v"
              :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y"
              class="grid"
            />
            <text
              v-for="g in sec.ticks" :key="sec.key + 'l' + g.v"
              class="ax-lb" :style="{ fill: sec.axisColor }"
              :x="PAD.l - 8" :y="g.y + 4" text-anchor="end"
            >{{ axNum(g.v, sec.unit) }}</text>
            <!-- v162：单位只在小标题（.sec-u）出现一次 —— 轴顶再标一遍与它相隔仅 20 余像素，纯冗余 -->

            <g v-for="r in sec.rows" :key="sec.key + r.mo.key">
              <!-- 目标轨道：从 0 长到「该月目标金额」，高度 ∝ 目标值
                   （v161 前它恒为 100%，是"所有柱子一样高"的根源） -->
              <rect
                v-if="r.trackH > 0"
                :x="xBar(r.i)" :y="r.yTrack"
                :width="BW" :height="r.trackH"
                class="track" rx="1.5"
              />
              <!-- 达成填充：0 → min(达成金额, 目标金额) -->
              <rect
                v-if="r.fillH > 0"
                :x="xBar(r.i)" :y="r.yFill"
                :width="BW" :height="r.fillH"
                :fill="r.fill" rx="1.5"
              />
              <!-- 超额段：目标金额 → 达成金额，用同色加深，超额一眼可见且不引入新色相 -->
              <rect
                v-if="r.deepH > 0"
                :x="xBar(r.i)" :y="r.yDeep"
                :width="BW" :height="r.deepH"
                :fill="r.deep" rx="1.5"
              />

              <!-- v164：柱顶数值改为**两行横排** —— 上行金额、下行达成率，均以柱心居中。
                   旧版是「整体旋转 −90 度」的竖排：单张图绘图区仅 136px 高，一条 53px 的竖排标签吃掉 39%，
                   12 根柱并排即"竖字墙"，且中文数字混排竖读尤难。
                   横排后单行最宽 33px（6 位金额「123456万」≈36.7px 仍在界内），
                   最窄视口（MIN_W=600 → 月槽 44px，半槽 22px）也放得下 → 无需任何降级分支。
                   单位已由本图小标题与纵轴交代，标签只写数字保持干净 -->
              <text
                v-if="r.show && Number(r.achv) > 0"
                class="bar-lb"
                :x="xBar(r.i) + BW / 2" :y="r.yAmtLbl"
                text-anchor="middle"
                :fill="r.lbl"
              >{{ amtLabel(r.achv, r.kind) }}</text>
              <text
                v-if="r.show && Number(r.achv) > 0 && r.rateTxt"
                class="bar-lb bar-lb-rate"
                :x="xBar(r.i) + BW / 2" :y="r.yRateLbl"
                text-anchor="middle"
                :fill="r.lbl"
              >{{ r.rateTxt }}</text>

              <!-- 本月时间进度（与 KPI 卡同口径）：柱高改成金额后，"时间进度"在金额轴上
                   ＝「该月目标 × 时间进度」；柱顶过线＝超前（绿），未过线＝落后（红） -->
              <line
                v-if="r.i === paceIdx && r.paceY != null"
                :x1="xBar(r.i)" :x2="xBar(r.i) + BW"
                :y1="r.paceY" :y2="r.paceY"
                class="pace-line"
              />

              <!-- 月份标签：只在最后一张图显示（两图 x 轴严格对齐，读者自然按列对应），省一份重复文字 -->
              <template v-if="sec.showMonths">
                <text class="ax-mo" :x="xGroup(r.i) + GW / 2" :y="SH - PAD.b + 18" text-anchor="middle">
                  {{ r.mo.m }}月
                </text>
                <circle v-if="r.mo.key === curKey" :cx="xGroup(r.i) + GW / 2" :cy="SH - PAD.b + 26" r="2.5" class="cur-dot" />
              </template>

              <rect
                :x="xGroup(r.i)" :y="PAD.t" :width="GW" :height="plotH"
                fill="transparent"
                @mouseenter="onHover(r.mo, r.i, sec.key)" @mousemove="onHover(r.mo, r.i, sec.key)"
              />
            </g>

            <line :x1="PAD.l" :x2="W - PAD.r" :y1="plotBase" :y2="plotBase" class="axis" />
          </svg>
        </div>

        <div v-if="tip" ref="tipEl" class="mac-tip" :class="{ 'to-left': tip.flip }" :style="{ left: tip.x, top: tip.top }">
          <b>{{ tip.title }}</b>
          <div class="tp-row" v-for="r in tip.rows" :key="r.k">
            <span class="tp-k">{{ r.k }}</span>
            <span class="tp-v">{{ r.v }}</span>
            <span class="tp-r" :class="{ warn: r.warn }">{{ r.r }}</span>
          </div>
          <div class="tp-ex" v-for="r in tip.extra" :key="r.k">
            <span class="tp-k">{{ r.k }}</span><span class="tp-v">{{ r.v }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!loading && hasAny && ftText" class="mac-ft">
      <!-- v154 E4：原三条并列脚注读起来像"bug 列表"，本质是同一件事：本图的统计范围 → 合并为一句；
           「去达成填报补录」的动作指引下沉到 hover title（需要时才有，不占常驻版面） -->
      <span :title="(emptyMonths || emptyRebateMonths) ? '灰色轨道＝该月尚未填报销量达成或实际返利，可去「达成填报」补录' : ''">{{ ftText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { rate, niceMax } from './useMonthlyAchv.js'
import { tipAnchor, clampTipAnchor } from './tipPlacement.js'

const props = defineProps({
  model: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  year: { type: [Number, String], default: '' },
  yearOptions: { type: Array, default: () => [] },
  // v154 P2-A：品牌筛选已提到页面级，本组件不再承载筛选控件；singleBrand 仍用于 tooltip 的差额行
  singleBrand: { type: Boolean, default: false },
})
const emit = defineEmits(['update:year'])

const yearVal = ref(props.year)
watch(() => props.year, v => { yearVal.value = v })

// v124：画布宽度跟随容器自适应（viewBox 宽度 = 实际渲染宽度，避免 SVG 等比缩放导致左右大片留白）
const MIN_W = 600
const rootEl = ref(null)
const W = ref(MIN_W)

// ── v185 C2：图表密度（完整 / 紧凑）──────────────────────────────────────────────
// 用户 2026-09-18 明确选定「保留 12 月 + 紧凑档切换」：**不做**"尾部空月不占槽"的自适应裁剪，
// 因为 12 月全景正是"看全年走势"的本职；紧凑档只压**单图高度**与**刻度段数**，
// 不改变任何月份、任何数值、任何口径（改口径的开关是另一个东西，绝不可混）。
// 完整 = 200px / 5 段刻度（原样）；紧凑 = 132px / 3 段刻度（刻度少才不会在矮图上挤成一团）。
const DENSITY_KEY = 'hergent_achv_density'
function readDensity() {
  try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'full' } catch (e) { return 'full' }
}
const density = ref(readDensity())
function setDensity(v) {
  density.value = v === 'compact' ? 'compact' : 'full'
  try { localStorage.setItem(DENSITY_KEY, density.value) } catch (e) {}
}

// ── v162 布局：上下两张**单轴**图 ──────────────────────────────────────────────
// v161 曾把销量与返利合并进一张双轴图（左轴销量、右轴返利）。问题：两根柱各读各的轴，
// 「金额小却柱子高」是双轴图的固有观感（8 月销量 42.3 万 vs 返利 13.5 万，返利柱反而更高），
// 同屏的柱高不可互比。v162 按用户选择拆为上下两张单轴图：
//   · 每张图自成一把尺子 → 柱高可直接跨月比高矮，零歧义；
//   · 每张图自带小标题与单位 → 读者不必在两条轴之间找归属；
//   · 两图共享同一套 x 轴几何（PAD / GW 完全一致）→ 月份列严格上下对齐。
// 代价：图表高度由 300px 增至两张共约 460px（用户已确认接受；v185 起可用紧凑档压到 332px）。
const SH = computed(() => (density.value === 'compact' ? 132 : 200))   // 单张图高度
const SEG_N = computed(() => (density.value === 'compact' ? 3 : 5))    // 纵轴刻度段数
const PAD = { l: 52, r: 18, t: 34, b: 30 }
const plotW = computed(() => W.value - PAD.l - PAD.r)
const plotH = computed(() => SH.value - PAD.t - PAD.b)
const plotBase = computed(() => PAD.t + plotH.value)   // 0 刻度线（柱底）
const GW = computed(() => plotW.value / 12)
// v162：改为每月单柱 → 柱宽由「半月槽」放宽到「近整月槽」，视觉重量回到单张图的正中
const GAP = computed(() => Math.max(4, Math.min(12, GW.value * 0.16)))
const BW = computed(() => Math.max(12, Math.min(44, GW.value - GAP.value * 2)))

// 小标题行与两图间距（tooltip 要按 hover 的是哪张图定位，故这几个值必须与 CSS 逐字一致：
//   SEC_HD 26 = .sec-hd 行高 22px + .mac-sec 的 4px gap；SEC_GAP 16 = .mac-sec + .mac-sec 的 margin-top）
// ⚠️ 这三处 CSS 高度**不随密度档变化**（完整 200 + 紧凑 132 只差在 SH），故 SEC_HD / SEC_GAP 保持常量；
//    随密度变化的是净高部分 —— 故下面 SEC_TOP / CANVAS_H 必须是 computed（v185 前是常量）。
const SEC_HD = 26
const SEC_GAP = 16
const SEC_TOP = computed(() => ({ sales: 0, rebate: SEC_HD + SH.value + SEC_GAP }))
// 画布总高 = 两图（标题行 + 图 + 间距）再减末尾多余的间距。常量可算，tooltip 纵向夹取不必读 DOM
const CANVAS_H = computed(() => SEC_TOP.value.rebate + SEC_HD + SH.value)

function measureW() {
  const el = rootEl.value
  if (!el) return
  const w = Math.round(el.getBoundingClientRect().width)
  if (w > 0) W.value = Math.max(MIN_W, w)
}
let ro = null
onMounted(() => {
  measureW()
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    ro = new ResizeObserver(measureW)
    ro.observe(rootEl.value)
  } else {
    window.addEventListener('resize', measureW)
  }
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('resize', measureW)
})

const tip = ref(null)
const tipEl = ref(null) // tooltip 元素本身：落位后用它的实测宽高做一次夹取（见 layoutTip）

// v159 色板：fill = 达成填充（历史月＝系列色）；deep = 超额段（同色相加深）；
//        ahead/behind = 本月「超前/落后时间进度」；neutral = 无目标时的中性灰（不判红绿）
const C = {
  sales: { fill: '#06b6d4', deep: '#0e7490', lbl: '#0e7490' },
  rebate: { fill: '#f59e0b', deep: '#b45309', lbl: '#b45309' },
  ahead: { fill: '#16a34a', deep: '#15803d', lbl: '#15803d' },
  behind: { fill: '#dc2626', deep: '#b91c1c', lbl: '#b91c1c' },
  neutral: { fill: '#94a3b8', deep: '#64748b', lbl: '#64748b' },
}

const months = computed(() => props.model?.months || [])
const excluded = computed(() => props.model?.excluded || { nonBrand: 0, crossUnit: 0 })
const measure = computed(() => props.model?.measure || 'amount')
const hasAny = computed(() => !!props.model?.hasAny)
const emptyMonths = computed(() => months.value.some(m => m.salesTarget > 0 && !m.salesAchv))
/** v160：有返利目标（灰轨道＝预估应返）却还没录实际返利的月份 —— 与未填销量达成分开算，合并成一句提示 */
const emptyRebateMonths = computed(() => months.value.some(m => m.rebateTarget > 0 && !m.actualRebate))

const curKey = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
/** 当前月的月槽下标；-1 ＝ 所选年份不含本月（此时全图不判红绿、不画时间进度线） */
const paceIdx = computed(() => months.value.findIndex(m => m.key === curKey.value))
/** 本月时间进度：与 KPI 卡（Rebate.vue timeProgress）同一口径 —— 已过天数 ÷ 当月天数 */
const timeProgress = computed(() => {
  if (paceIdx.value < 0) return null
  const d = new Date()
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Math.min(1, d.getDate() / days)
})

// v154 E4：三条并列脚注合并为一句（同一件事＝本图的统计范围），且仅在确有内容时出现
const ftText = computed(() => {
  const parts = []
  // v160：销量达成与实际返利是两件各自可缺的事，合成一句时按缺哪样动态列名
  const miss = []
  if (emptyMonths.value) miss.push('销量达成')
  if (emptyRebateMonths.value) miss.push('实际返利')
  if (miss.length) parts.push(`灰色月份尚未填报${miss.join(' / ')}`)
  const ex = []
  if (excluded.value.nonBrand) ex.push(`${excluded.value.nonBrand} 条非品牌维度`)
  if (excluded.value.crossUnit) ex.push(`${excluded.value.crossUnit} 条${measure.value === 'amount' ? '数量' : '金额'}口径`)
  if (ex.length) parts.push(`本图仅计品牌维度，另有 ${ex.join('、')}目标未计入`)
  return parts.join('；')
})
const emptyText = computed(() => {
  if (!props.model) return '暂无数据'
  if (excluded.value.nonBrand && !months.value.some(m => m.salesTarget > 0)) {
    return `${props.year} 年暂无品牌维度目标`
  }
  return `${props.year} 年还没有品牌目标或达成数据`
})

// ── v161 量程：柱高 ∝ 金额（v162 拆图后每张图各有一个量程）───────────────────
// 改造前：纵轴＝达成率，灰轨道恒为 100% → 每月柱子一样高，"无法体现数值差异"。
// 改造后：纵轴＝金额，柱高 = 该柱金额 ÷ **本图**量程 × 绘图区高，严格等比。
//   · 量程 = 全年 max(目标, 达成) 向上取整到好看刻度（niceMax），刻度均分 5 段。
//   · 达成率不再决定柱高，改由「柱顶标签 / tooltip 里的百分比」与
//     「彩色填充 vs 灰轨道 的相对高矮」承载 —— 柱顶没到轨道顶＝未达标。
const salesMax = computed(() => {
  let mx = 0
  for (const m of months.value) mx = Math.max(mx, Number(m.salesTarget) || 0, Number(m.salesAchv) || 0)
  return mx > 0 ? niceMax(mx) : 0
})
const rebateMax = computed(() => {
  let mx = 0
  for (const m of months.value) mx = Math.max(mx, Number(m.rebateTarget) || 0, Number(m.actualRebate) || 0)
  return mx > 0 ? niceMax(mx) : 0
})

/** v164 柱顶标签（两行横排）的行距常量。
 *  上行＝金额、下行＝达成率，两行 baseline 相距 12px（8.5px 字号 → 行间净空约 5px）。
 *  竖向总占位 ≈ 26px（上行字顶 ≈ 锚点 −18 −7，至下行字底 ≈ 锚点 −6 +2）；
 *  柱顶最高可到 PAD.t = 34 → 上缘 ≈ 9px，净空充足，
 *  故**不再需要 v162 的「下压锚点」兜底**（旧版竖排标签竖向长达 53px，才必须 LBL_TOP=58 防裁）。 */
const LBL_DY_RATE = 6    // 下行（达成率）baseline 距柱顶
const LBL_DY_AMT = 18    // 上行（金额）baseline 距柱顶 ＝ 6 + 12px 行距

/* v186：「该月有目标」→ 必须**始终看得见**一根柱子。
   hAmt 是纯等比（无最小高度），当月目标相对全年量程极小（如某月目标只占 0.1%）时
   轨道高度会算成 0.1px —— 屏幕上等于没画，用户会以为"这个月的目标丢了"。
   故给轨道一个 2px 的可见下限：宁可略微夸大小到看不见的量，也不能让柱子消失
   （精确数值由 tooltip 与柱顶标签承担）。 */
const MIN_TRACK_PX = 2

/** 金额 → 像素高度（等比；min 截断只是防御，量程本就涵盖全部数值） */
function hAmt(v, max) {
  const m = Number(max) || 0
  if (m <= 0) return 0
  return (Math.min(Math.max(0, Number(v) || 0), m) / m) * plotH.value
}
/** 金额 → y 坐标 */
function yAmt(v, max) { return plotBase.value - hAmt(v, max) }

function xGroup(i) { return PAD.l + i * GW.value }
/** v162：每月单柱 → 在月槽内水平居中 */
function xBar(i) { return xGroup(i) + (GW.value - BW.value) / 2 }

/** 轴刻度：量程均分 n 段 —— niceMax 的基数 k∈{1,1.5,2,3,5,7.5,10}，除 5 后仍是整洁数值。
 *  v185：段数随密度档（完整 5 / 紧凑 3）。**只改刻度密度，不改量程、不改柱高算法** ——
 *  量程恒为 niceMax(全年 max(目标, 达成))，紧凑档下柱高与刻度的比例关系完全一致。 */
function axisTicks(max, n) {
  if (!(max > 0)) return []
  const seg = Number(n) > 0 ? Number(n) : 5
  return Array.from({ length: seg + 1 }, (_, i) => {
    const v = (max * i) / seg
    return { v, y: yAmt(v, max) }
  })
}

const salesUnit = computed(() => {
  if (!(salesMax.value > 0)) return ''
  if (measure.value === 'quantity') return salesMax.value >= 10000 ? '万件' : '件'
  return salesMax.value >= 100000 ? '万元' : '元'
})
const rebateUnit = computed(() => (rebateMax.value > 0 && rebateMax.value >= 100000 ? '万元' : '元'))

/** 轴刻度数字：按该轴单位换算（万 → 最多 2 位小数并去尾零；元 / 件 → 千分位整数） */
function axNum(v, unit) {
  const n = Number(v) || 0
  if (!n) return '0'
  if (unit === '万元' || unit === '万件') {
    const x = n / 10000
    return String(Math.abs(x) >= 100 ? Math.round(x) : Number(x.toFixed(2)))
  }
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/**
 * 合并柱：一根柱同时承载「参照值」（灰轨道）与「实际值」（彩色填充）
 *   销量图：轨道＝月度目标，填充＝销量达成
 *   返利图：轨道＝预估应返（按 100% 目标档试算），填充＝**实际返利**（达成填报录入）
 */
function barOf(cfg, mo) {
  const target = cfg.tgt(mo)
  const achv = cfg.achv(mo)
  const max = cfg.max
  const hasTarget = Number(target) > 0
  const hasAchv = Number(achv) > 0
  const rRaw = rate(achv, target)        // target ≤ 0 → null（没有目标就无所谓达成率）
  const noTarget = rRaw == null
  const isCur = paceIdx.value >= 0 && mo.key === curKey.value
  const ahead = isCur && !noTarget && timeProgress.value != null && rRaw >= timeProgress.value

  let fill, deep, lbl
  if (noTarget) {
    // 无目标但有手工录入的达成 → 中性灰、不判红绿（无从比较超前落后）
    fill = C.neutral.fill; deep = C.neutral.deep; lbl = C.neutral.lbl
  } else if (isCur) {
    const c = ahead ? C.ahead : C.behind
    fill = c.fill; deep = c.deep; lbl = c.lbl
  } else {
    fill = cfg.color.fill; deep = cfg.color.deep; lbl = cfg.color.lbl
  }

  // v161 几何：整根彩色柱高 ∝ 达成金额（在本图量程内等比）；
  //   0 → 目标 为常规色段，目标 → 达成 为深色超额段。
  //   无目标但有达成 → 整根都算填充（中性灰），不再"硬画到 100% 位"。
  const hTotal = hAmt(achv, max)
  // v186：有目标 ⇒ 轨道至少 MIN_TRACK_PX 高 —— "只要录到了目标就始终显示这根柱子"
  //   不是一句期望，而是这里的下限保证（未填报时它整根是灰的）。
  const trackH = hasTarget ? Math.max(MIN_TRACK_PX, hAmt(target, max)) : 0
  const fillH = hasTarget ? Math.min(hTotal, trackH) : hTotal
  const deepH = Math.max(0, hTotal - fillH)
  return {
    kind: cfg.key,                      // amtLabel 用它判断是否走「按数量」口径（销量图才可能）
    target, achv, max,                  // 原值（tooltip / 标签用）
    noTarget, r: rRaw,                  // r ＝ 达成率（tooltip 的百分比列）
    fill, deep, lbl,                    // 三段配色
    show: hasTarget || hasAchv,         // 有目标或有达成 → 该月这一列有东西可画
    trackH, fillH, deepH,
    yTrack: plotBase.value - trackH,          // 轨道顶 ＝ 目标金额的高度
    yFill: plotBase.value - fillH,            // 填充段顶
    yDeep: plotBase.value - fillH - deepH,    // 超额段顶
    yTop: plotBase.value - hTotal,            // 柱顶 ＝ 达成金额的高度
    // v164 柱顶标签锚点（两行横排，均以柱心为 text-anchor=middle 的基准）：
    //   有目标 → 金额在上行、达成率在下行；无目标（无从算达成率）→ 金额直接贴柱顶，不留空行
    yAmtLbl: plotBase.value - hTotal - (noTarget ? LBL_DY_RATE : LBL_DY_AMT),
    yRateLbl: plotBase.value - hTotal - LBL_DY_RATE,
    rateTxt: noTarget ? '' : Math.round(rRaw * 100) + '%',
    // 时间进度线（仅当月）：金额轴上 ＝「该月目标 × 时间进度」；该月无目标（轨道高 0）则不画
    paceY: (isCur && timeProgress.value != null && trackH > 0)
      ? yAmt(target * timeProgress.value, max)
      : null,
  }
}

/**
 * v162：两张图的**唯一**渲染描述 —— 模板对 sections 做 v-for，杜绝"两张图各写一遍渲染逻辑"
 * 造成的静默漂移（改了一张忘另一张，代码不报错、只有真机上数字不对）。
 * 数组顺序＝上下顺序：销量在前（主指标），返利在后（并携带月份标签）。
 */
const sections = computed(() => {
  const mk = (cfg) => {
    const rows = months.value.map((mo, i) => Object.assign({ mo, i }, barOf(cfg, mo)))
    return Object.assign({}, cfg, { rows, ticks: axisTicks(cfg.max, SEG_N.value) })
  }
  return [
    mk({
      key: 'sales', title: '销量达成',
      unit: salesUnit.value, axisColor: C.sales.deep, showMonths: false,
      max: salesMax.value, color: C.sales,
      tgt: m => m.salesTarget, achv: m => m.salesAchv,
    }),
    mk({
      key: 'rebate', title: '实际返利',
      unit: rebateUnit.value, axisColor: C.rebate.deep, showMonths: true,
      max: rebateMax.value, color: C.rebate,
      tgt: m => m.rebateTarget, achv: m => m.actualRebate,
    }),
  ]
})

/** hover 某个系列某个月 → 取该系列该月的几何（如该系列整年无数据则返回 null） */
function rowOf(key, i) {
  const sec = sections.value.find(s => s.key === key)
  return sec ? (sec.rows[i] || null) : null
}

/** 柱顶标签文本 —— v164 拆成两行（上行金额、下行达成率），故不再有「拼成一串」的 barLabelOf：
 *  金额走这里（回答"多少"），达成率由 barOf 的 rateTxt 直接给出（回答"超没超"）。 */
function amtLabel(v, kind) {
  const n = Number(v) || 0
  if (kind === 'sales' && measure.value === 'quantity') {
    return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(Math.round(n))
  }
  const d = n / 10000 // 万元
  if (!d) return '0'
  const s = d >= 100 ? String(Math.round(d)) : d.toFixed(1)
  return s.replace(/\.0$/, '') + '万'
}

function money(v) {
  const n = Number(v) || 0
  if (measure.value === 'quantity') return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + '万'
  return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
/** v160：金额（元）专用格式化 —— 实际返利 / 预估应返恒为元，不能跟着图表的 amount/quantity
 *  量纲开关走（否则切到「按数量」时返利会丢掉 ¥ 号，被读成件数）。 */
function yuan(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + '万'
  return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function qty(v) {
  const n = Number(v) || 0
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' 件'
}
function pct(v) {
  if (v == null) return '—'
  return (v * 100).toFixed(1) + '%'
}

/** 用 tooltip 的实测宽高把盒子夹进画布（越界才平移）。
 *  首帧渲染补丁与本次测量都在同一帧的微任务里跑完 → 用户看到的永远是夹取后的位置，不会跳动。 */
function layoutTip() {
  if (!tip.value || !tipEl.value) return
  const { anchor, top } = clampTipAnchor(
    { anchor: tip.value.anchor, flip: tip.value.flip, w: tipEl.value.offsetWidth, h: tipEl.value.offsetHeight, top: tip.value.baseTop },
    { canvasW: W.value, canvasH: CANVAS_H.value },
  )
  tip.value.x = anchor + 'px'
  tip.value.top = top + 'px'
}

function onHover(mo, i, key) {
  const k = key + '#' + i
  // 同一根柱上 mousemove 会持续触发，而落位只取决于"是哪一根柱" → 重复调用直接返回（省掉重渲染与重测量）
  if (tip.value && tip.value.k === k) return
  const s = rowOf('sales', i)
  const rb = rowOf('rebate', i)
  const rows = [
    { k: '销量目标', v: measure.value === 'quantity' ? qty(mo.salesTarget) : money(mo.salesTarget), r: '' },
    { k: '销量达成', v: measure.value === 'quantity' ? qty(mo.salesAchv) : money(mo.salesAchv), r: pct(s && !s.noTarget ? s.r : null), warn: !!s && !s.noTarget && s.r < 1 },
    { k: '返利预估', v: yuan(mo.rebateTarget), r: '' },
    { k: '实际返利', v: yuan(mo.actualRebate), r: pct(rb && !rb.noTarget ? rb.r : null), warn: !!rb && !rb.noTarget && rb.r < 1 },
  ]
  const extra = []
  if (paceIdx.value === i && timeProgress.value != null) {
    extra.push({ k: '时间进度', v: pct(timeProgress.value) })
  }
  if (props.singleBrand) {
    extra.push({ k: '距目标差额', v: measure.value === 'quantity' ? qty(Math.max(0, mo.salesTarget - mo.salesAchv)) : money(Math.max(0, mo.salesTarget - mo.salesAchv)) })
    // v160：原「影响返利」是「按目标档应返 − 按达成档应返」，两档都来自推算；现在减数换成了
    //   人工录入的实际返利，语义变成「还差多少返利没拿到」→ 标签同步改为「返利缺口」，否则会误导。
    extra.push({ k: '返利缺口', v: yuan(Math.max(0, mo.rebateTarget - mo.actualRebate)) })
  }
  // 横向避让：整只盒子挪到被 hover 柱子的**外侧**（贴柱缘留 TIP_GAP 净空）→ 盒子与柱身的 x 区间零交集，
  // 柱高、柱顶标签、时间进度线全部露出来。纵向无处可让（tooltip 比绘图区 136px 还高，见 tipPlacement.js），
  // 故仍贴本图顶部起步（两图相距 200px+，固定贴顶会让鼠标在下图时视线跳远）。
  const { anchor, flip } = tipAnchor(xGroup(i) + GW.value / 2, BW.value / 2, W.value)
  const baseTop = (SEC_TOP.value[key] || 0) + SEC_HD + 6
  tip.value = {
    k,
    title: `${props.year} 年 ${mo.m} 月`,
    rows,
    extra,
    anchor, flip, baseTop,
    x: anchor + 'px',
    top: baseTop + 'px',
  }
  // 先按常量落位（同一帧内可见），再用实测宽高夹进画布；正常情况下夹取不会移动它
  nextTick(layoutTip)
}
</script>

<style scoped>
.mac { display: flex; flex-direction: column; gap: 10px; width: 100%; min-width: 0; }
.mac-hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mac-ti { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.mac-ti b { font-size: 14px; font-weight: 500; color: var(--t1); }
.mac-sub { font-size: 12px; color: var(--t3); }
.mac-seg { display: inline-flex; border: 1px solid var(--bd); border-radius: 8px; overflow: hidden; }
.seg-btn { padding: 4px 12px; font-size: 12px; background: transparent; border: 0; cursor: pointer; color: var(--t2); }
.seg-btn + .seg-btn { border-left: 1px solid var(--bd); }
.seg-btn.on { background: var(--p); color: #fff; }

.mac-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sel-year { height: 26px; padding: 0 6px; font-size: 12px; width: auto; }
/* v154 P2-A：品牌筛选控件（原 .ctl-pop / .bp-* 一套）与作用域徽标（.mac-scope）已随控件上移至页面级
   （`BrandFilter.vue`，与「统计月份」并排）→ 这里的相关样式整体移除，不留死 CSS */

.mac-legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.lg-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t2); }
.lg-item i { width: 10px; height: 10px; border-radius: 2px; border: 1px solid transparent; display: inline-block; }
.lg-gap { margin-left: 2px; }
/* v185 R1：合并后的图例里「深色段」色块与前半句之间要留一口气 */
.lg-sep { margin-left: 8px; }
/* 灰轨道示意：上半深灰（达成位）＋下半浅灰（未达位）—— 与柱体两段结构同形 */
.lg-track { background: linear-gradient(180deg, #cbd5e1 0%, #cbd5e1 45%, #e2e8f0 45%, #e2e8f0 100%); }
.lg-line { width: 12px !important; height: 0 !important; border: 0 !important; border-top: 1px dashed #d97706 !important; border-radius: 0 !important; }
.lg-deep { background: linear-gradient(180deg, #0e7490 0%, #0e7490 50%, #06b6d4 50%, #06b6d4 100%); }

/* 与两张图的实际高度一致：26 + 200 + 16 + 26 + 200 = 468（骨架屏/空态不跳动） */
.mac-body { height: 468px; }
.mac-skel { display: flex; align-items: flex-end; gap: 6px; padding: 10px 0; }
.sk-col { flex: 1; display: flex; align-items: flex-end; gap: 2px; height: 100%; }
.sk-col span { flex: 1; background: var(--border-subtle, #e2e8f0); border-radius: 2px; animation: macpulse 1.2s ease-in-out infinite; }
@keyframes macpulse { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
.mac-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--t3); font-size: 13px; }

.mac-scroll { position: relative; width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; }
/* 画布层：宽度＝容器可用宽度，viewBox 与其 1:1 对应；窄屏时锁 600px 由外层横向滚动兜底 */
.mac-canvas { position: relative; width: 100%; min-width: 600px; }

/* v162：上下两张单轴图。标题行高（22px）＋列间距（4px）＋图间距（16px）是 tooltip 定位的基准，
   改动这三处必须同步 script 里的 SEC_HD / SEC_GAP */
.mac-sec { display: flex; flex-direction: column; gap: 4px; }
.mac-sec + .mac-sec { margin-top: 16px; }
.sec-hd { display: flex; align-items: baseline; gap: 8px; height: 22px; }
.sec-hd b { font-size: 12px; font-weight: 500; color: var(--t1); }
.sec-u { font-size: 11px; color: var(--t3); }
/* v185 R1：.sec-note（原「柱高＝实际销量 / 柱高＝实际返利金额」）已随两条 note 一并删除 —— 不留死 CSS */
.sec-empty { display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--t3); }

/* v185 C2：高度由 :style 给出（完整 200 / 紧凑 132），不写死 */
.mac-svg { width: 100%; display: block; }
.grid { stroke: var(--border-subtle, #e2e8f0); stroke-width: 1; stroke-dasharray: 3 3; }
.axis { stroke: var(--bd); stroke-width: 1; }
.ax-lb { font-size: 11px; }
.ax-mo { font-size: 11px; fill: var(--t3); }
/* v159 柱两段：轨道（目标）+ 填充（达成）+ 超额加深段。
   两处文字均加白色描边（paint-order）—— 柱顶标签可能压到相邻更高的柱、时间进度线文字会横跨当月柱身，
   无描边则与柱色混在一起读不出来 */
/* v186：轨道改用**明确灰 #cbd5e1**（原为 var(--border-subtle,#e2e8f0)）。
   轨道＝「该月有目标」这件事的唯一可见证据：有目标就必须看得见一根柱子 ——
   未填报 / 未达成时它整根是灰的，达成部分再被彩色填充盖上去。
   #e2e8f0 是边框色，在白底上淡到"像没画"，用户会以为"有目标却没柱子"。
   #cbd5e1 与图例 .lg-track 的顶端同色 —— 图例与柱体不再是两个灰度。 */
.track { fill: #cbd5e1; }
.bar-lb { font-size: 8.5px; font-variant-numeric: tabular-nums; pointer-events: none; paint-order: stroke; stroke: #fff; stroke-width: 2px; stroke-linejoin: round; }
/* v164：下行达成率略降透明度 → 上行金额先被读到；两行同色系，整柱归属依然清楚 */
.bar-lb-rate { opacity: .88; }
.pace-line { stroke: #d97706; stroke-width: 1; stroke-dasharray: 4 3; pointer-events: none; }
.cur-dot { fill: var(--p); }

/* v165：left / top 全部由 script 按几何算好（见 tipPlacement.js），CSS 只保留"翻转"这一件事——
   .to-left 把盒子左移自身 100%，锚点即从**左**缘变**右**缘，与盒子实际宽度无关（任何内容宽度都成立）。
   与柱身的净空（TIP_GAP=8）已算进锚点，这里不再叠 transform 位移。
   ⚠️ pointer-events: none 必须保留：盒子挪到柱外侧后会盖住相邻月份的悬停区，一旦吃掉事件就换不了柱。 */
.mac-tip {
  position: absolute;
  min-width: 210px; padding: 10px 12px; border-radius: 8px; pointer-events: none;
  background: var(--bg); border: 1px solid var(--bd);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .12); font-size: 12px; z-index: 5;
}
.mac-tip.to-left { transform: translateX(-100%); }
.mac-tip b { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 500; color: var(--t1); }
.tp-row { display: flex; align-items: center; gap: 8px; line-height: 1.9; }
.tp-k { width: 56px; color: var(--t3); flex: none; }
.tp-v { color: var(--t1); font-variant-numeric: tabular-nums; }
.tp-r { margin-left: auto; color: var(--t2); font-variant-numeric: tabular-nums; }
.tp-r.warn { color: #dc2626; }
.tp-ex { display: flex; gap: 8px; line-height: 1.9; border-top: 1px solid var(--border-subtle, #e2e8f0); margin-top: 4px; padding-top: 4px; }
.tp-ex .tp-v { color: var(--t2); }

.mac-ft { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--t3); }
</style>
