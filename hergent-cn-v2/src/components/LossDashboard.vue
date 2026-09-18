<template>
  <!-- 货损核算 · 趋势仪表盘（纯展示层）
       数据 100% 来自 GET /api/loss/accounting/trend 的下发结果：
       组名 / 组序来自后端 `row_groups`，**本组件不写第二份中文分组名**。
       本组件不做请求、不持有筛选状态（筛选与取数由页面负责）——
       否则"这一屏看的是哪几个月"就有了两个来源。 -->
  <section class="dsh">
    <div class="dsh-hd">
      <b>货损趋势</b>
      <span class="dsh-sub">
        {{ from }} → {{ to }} · 计价口径 {{ pricingLabel }} · 按<b>结账期次</b>归集
      </span>
      <span v-if="hiddenCount" class="dsh-note war">
        已隐藏 {{ hiddenCount }} 个未结账月（不参与图与合计）
      </span>
      <span v-if="skippedEmpty" class="dsh-note war">
        已跳过 {{ skippedEmpty }} 个未录入月 —— 折线跨过缺口，<b>不代表数据连续</b>
      </span>
    </div>

    <div v-if="!hasAny" class="dsh-empty">
      <template v-if="allFilteredOut">
        有数据的月都在，只是被筛选条件排除了（当前隐藏了 {{ hiddenCount }} 个未结账月）——
        取消勾选「只看已结账月」就能看到它们。
      </template>
      <template v-else>
        这个区间还没有任何录入，暂时没有可看的趋势。
        先在下方「手工录入」里填一个月，或把区间调到有数据的月份。
      </template>
    </div>

    <template v-else>
      <!-- ══ 指标卡（5 张）══ -->
      <div class="dsh-kpis">
        <div class="k">
          <i>期段货损净额</i>
          <b :class="sgn(summary.net_amt)">{{ wan2(summary.net_amt) }}<u>万元</u></b>
          <em>毛额 − 临期销售 · 负数=临期销售超过损失（好事）</em>
        </div>
        <div class="k k-main">
          <i>期段货损净率</i>
          <b :class="sgn(summary.rate_net)">{{ pct(summary.rate_net) }}</b>
          <em>
            加权口径：∑净额 ÷ ∑分母（{{ summary.months_with_den || 0 }} 个月有分母）
          </em>
        </div>
        <div class="k">
          <i>期段货损毛额</i>
          <b>{{ wan2(summary.gross_amt) }}<u>万元</u></b>
          <em>①门店退货 + ②业务员仓调 + ③直调 + ④报损</em>
        </div>
        <div class="k">
          <i>临期销售</i>
          <b>{{ summary.ded_sum == null ? '—' : wan2(summary.ded_sum) }}<u v-if="summary.ded_sum != null">万元</u></b>
          <em v-if="summary.ded_sum == null" class="war">未录入 —— 不是 0（净额因此偏大）</em>
          <em v-else>挽回了毛额的 {{ pct(dedRatio) }}</em>
        </div>
        <div class="k">
          <i>数据完整度</i>
          <b>{{ summary.months_with_data || 0 }}<u>/ {{ summary.months_total || 0 }} 月</u></b>
          <em>
            有缺口 {{ summary.months_with_gaps || 0 }} 月 · 已结账 {{ summary.months_closed || 0 }} 月
          </em>
        </div>
      </div>

      <div v-if="dedPartial" class="dsh-warn">
        ⚠️ {{ summary.months_with_data - summary.months_with_ded }} 个月没录「临期仓销售总额」——
        这些月的抵扣按 0 计入合计，所以<b>净额偏大</b>、货损率偏高。按期补录后即自动修正。
      </div>

      <!-- ══ 主图：按月货损趋势（双柱 + 净率折线，双轴各自带刻度）══ -->
      <div class="dsh-card">
        <div class="dsh-t">
          按月货损趋势
          <span class="dsh-t-sub">柱=万元（左轴）· 线=公司货损净率 %（右轴）· 点柱子可切到该月详情</span>
          <span class="lg">
            <i style="background:var(--war)"></i>货损毛额
            <i style="background:var(--p)"></i>货损净额
            <i class="ln" style="background:var(--purple)"></i>公司货损净率
          </span>
        </div>
        <div class="dsh-svg">
          <svg :viewBox="`0 0 ${W} ${H}`" class="ch" role="img"
               aria-label="按月货损毛额、净额柱状图与公司货损净率折线">
            <!-- 左轴刻度线 + 标签 -->
            <g>
              <g v-for="t in amtAxis.ticks" :key="'ga' + t">
                <line :x1="padL" :x2="W - padR" :y1="yAmt(t)" :y2="yAmt(t)"
                      :stroke="t === 0 ? 'var(--t3)' : 'var(--bd)'"
                      :stroke-dasharray="t === 0 ? '' : '2 4'" stroke-width="1"/>
                <text :x="padL - 8" :y="yAmt(t) + 4" class="ax" text-anchor="end">
                  {{ axisWan(t) }}
                </text>
              </g>
              <text :x="padL - 8" :y="padT - 4" class="ax ax-u" text-anchor="end">万元</text>
            </g>
            <!-- 右轴刻度（率的单位必须与金额分开标） -->
            <g>
              <g v-for="t in rateAxis.ticks" :key="'gr' + t">
                <text :x="W - padR + 8" :y="yRate(t) + 4" class="ax ax-rate" text-anchor="start">
                  {{ axisPct(t) }}
                </text>
              </g>
              <text :x="W - padR + 8" :y="padT - 4" class="ax ax-rate ax-u" text-anchor="start">%</text>
            </g>

            <!-- 月份 -->
            <g v-for="(m, i) in mm" :key="'mo' + m.period">
              <!-- 未录入 / 已隐藏：占位框，绝不画 0 柱 -->
              <template v-if="m.hidden">
                <rect :x="cx(i) - slot / 2 + 6" :y="padT" :width="slot - 12" :height="ih"
                      fill="var(--bg3)" opacity=".55" rx="4"/>
                <text :x="cx(i)" :y="padT + ih / 2" class="ph" text-anchor="middle">已隐藏</text>
                <text :x="cx(i)" :y="padT + ih / 2 + 15" class="ph ph-s" text-anchor="middle">未结账</text>
              </template>
              <template v-else-if="!m.has_data">
                <rect :x="cx(i) - slot / 2 + 6" :y="padT" :width="slot - 12" :height="ih"
                      fill="none" stroke="var(--t3)" stroke-width="1"
                      stroke-dasharray="3 3" rx="4"/>
                <text :x="cx(i)" :y="padT + ih / 2 + 4" class="ph" text-anchor="middle">未录入</text>
              </template>
              <template v-else>
                <g class="bars" @click="$emit('pick', m.period)">
                  <title>{{ tip(m) }}</title>
                  <rect :x="cx(i) - bw - 2" :y="Math.min(yAmt(0), yAmt(m.gross_amt))"
                        :width="bw" :height="Math.abs(yAmt(m.gross_amt) - yAmt(0))"
                        fill="var(--war)" rx="2"/>
                  <rect :x="cx(i) + 2" :y="Math.min(yAmt(0), yAmt(m.net_amt))"
                        :width="bw" :height="Math.abs(yAmt(m.net_amt) - yAmt(0))"
                        fill="var(--p)" rx="2"/>
                </g>
              </template>
              <!-- X 标签（`xl-m` 是月份标签的语义钩子：`xl-y`/`xl-open` 是它的附属行） -->
              <text :x="cx(i)" :y="H - padB + 16" class="xl xl-m"
                    text-anchor="middle">{{ mmLabel(m.period) }}</text>
              <text v-if="showYear(m, i)" :x="cx(i)" :y="H - padB + 30" class="xl xl-y"
                    text-anchor="middle">{{ m.period.slice(0, 4) }}</text>
              <text v-if="m.has_data && !m.is_closed" :x="cx(i)" :y="H - padB + 43"
                    class="xl xl-open" text-anchor="middle">未结账</text>
              <circle v-if="m.period === period" :cx="cx(i)" :cy="padT - 6" r="3" fill="var(--p)">
                <title>当前查看的期次</title>
              </circle>
            </g>

            <!-- 率折线（空月/隐藏月必须断开） -->
            <polyline v-for="(s, k) in rateSegs" :key="'rs' + k" :points="s" fill="none"
                      stroke="var(--purple)" stroke-width="2" stroke-linejoin="round"
                      stroke-linecap="round"/>
            <circle v-for="p in rateDots" :key="'rd' + p[2]" :cx="p[0]" :cy="p[1]" r="3.2"
                    fill="var(--bg)" stroke="var(--purple)" stroke-width="2"/>
          </svg>
        </div>
      </div>

      <!-- ══ 副图 A：构成堆叠 ══ -->
      <div class="dsh-grid">
        <div class="dsh-card">
          <div class="dsh-t">
            货损构成（按行分组）
            <span class="dsh-t-sub">哪一块在变大</span>
          </div>
          <div class="dsh-svg dsh-svg-sm">
            <svg :viewBox="`0 0 ${W} ${Hs}`" class="ch" role="img" aria-label="按行分组的货损构成堆叠柱">
              <g v-for="t in stackAxis.ticks" :key="'gs' + t">
                <line :x1="padL" :x2="W - padR" :y1="ySt(t)" :y2="ySt(t)"
                      stroke="var(--bd)" :stroke-dasharray="t === 0 ? '' : '2 4'" stroke-width="1"/>
                <text :x="padL - 8" :y="ySt(t) + 4" class="ax" text-anchor="end">{{ axisWanSt(t) }}</text>
              </g>
              <text :x="padL - 8" :y="14" class="ax ax-u" text-anchor="end">万元</text>
              <g v-for="(m, i) in mm" :key="'sk' + m.period">
                <template v-if="!m.has_data || m.hidden">
                  <rect :x="cx(i) - bw - 1" :y="padT" :width="bw * 2 + 2" :height="ihs"
                        fill="none" stroke="var(--t3)" stroke-dasharray="3 3" rx="3"/>
                  <text :x="cx(i)" :y="padT + ihs / 2 + 4" class="ph ph-s" text-anchor="middle">
                    {{ m.hidden ? '已隐藏' : '未录入' }}
                  </text>
                </template>
                <template v-else>
                  <g class="bars">
                    <title>{{ tip(m) }}</title>
                    <rect v-for="s in stackOf(m, i)" :key="'sg' + m.period + s.k" :x="cx(i) - bw"
                          :y="s.y" :width="bw * 2" :height="s.h" :fill="s.c">
                      <title>{{ s.label }}</title>
                    </rect>
                  </g>
                </template>
                <text :x="cx(i)" :y="Hs - padB + 16" class="xl" text-anchor="middle">{{ mmLabel(m.period) }}</text>
              </g>
            </svg>
          </div>
          <div class="lg lg-wrap">
            <span v-for="(g, i) in groupsMeta" :key="g.row_kind">
              <i :style="{ background: GCOL[i] }"></i>{{ g.no }} {{ g.title }}
            </span>
          </div>
        </div>

        <!-- ══ 副图 B：临期抵扣对比 ══ -->
        <div class="dsh-card">
          <div class="dsh-t">
            临期销售对比
            <span class="dsh-t-sub">抵扣救回了多少</span>
          </div>
          <div class="dsh-svg dsh-svg-sm">
            <svg :viewBox="`0 0 ${W} ${Hs}`" class="ch" role="img" aria-label="逐月货损毛额、临期销售、货损净额对比柱">
              <g v-for="t in dedAxis.ticks" :key="'gd' + t">
                <line :x1="padL" :x2="W - padR" :y1="yDed(t)" :y2="yDed(t)"
                      stroke="var(--bd)" :stroke-dasharray="t === 0 ? '' : '2 4'" stroke-width="1"/>
                <text :x="padL - 8" :y="yDed(t) + 4" class="ax" text-anchor="end">{{ axisWanDed(t) }}</text>
              </g>
              <text :x="padL - 8" :y="14" class="ax ax-u" text-anchor="end">万元</text>
              <g v-for="(m, i) in mm" :key="'dd' + m.period">
                <template v-if="!m.has_data || m.hidden">
                  <rect :x="cx(i) - slot * 0.34" :y="padT" :width="slot * 0.68" :height="ihs"
                        fill="none" stroke="var(--t3)" stroke-dasharray="3 3" rx="3"/>
                  <text :x="cx(i)" :y="padT + ihs / 2 + 4" class="ph ph-s" text-anchor="middle">
                    {{ m.hidden ? '已隐藏' : '未录入' }}
                  </text>
                </template>
                <template v-else>
                  <g class="bars">
                    <title>{{ tip(m) }}</title>
                    <rect v-if="m.ded_amt != null" :x="cx(i) - bw * 2 - 4"
                          :y="Math.min(yDed(0), yDed(m.ded_amt))" :width="bw"
                          :height="Math.abs(yDed(m.ded_amt) - yDed(0))" fill="var(--teal)" rx="2"/>
                    <rect :x="cx(i) - bw / 2" :y="Math.min(yDed(0), yDed(m.gross_amt))" :width="bw"
                          :height="Math.abs(yDed(m.gross_amt) - yDed(0))" fill="var(--war)" rx="2"/>
                    <rect :x="cx(i) + bw + 4" :y="Math.min(yDed(0), yDed(m.net_amt))" :width="bw"
                          :height="Math.abs(yDed(m.net_amt) - yDed(0))" fill="var(--p)" rx="2"/>
                  </g>
                </template>
                <text :x="cx(i)" :y="Hs - padB + 16" class="xl" text-anchor="middle">{{ mmLabel(m.period) }}</text>
              </g>
            </svg>
          </div>
          <div class="lg lg-wrap">
            <span><i style="background:var(--teal)"></i>临期销售</span>
            <span><i style="background:var(--war)"></i>货损毛额</span>
            <span><i style="background:var(--p)"></i>货损净额</span>
          </div>
        </div>
      </div>

      <!-- ══ 副图 C：主体排行（期段内合计）══ -->
      <div class="dsh-card">
        <div class="dsh-t">
          主体货损排行
          <span class="dsh-t-sub">
            期段内合计 · 按货损净额降序 · 率 = ∑分子 ÷ ∑分母（<b>不是</b>各月率的平均）
          </span>
        </div>
        <div v-if="!rank.length" class="dsh-empty">这期间还没有门店/业务员的数据。</div>
        <div v-else class="rk">
          <div v-for="r in rank" :key="r.row_kind + r.subject_key" class="rk-row">
            <span class="rk-tag" :class="'k-' + r.row_kind">{{ tagOf(r.row_kind) }}</span>
            <span class="rk-nm" :title="r.subject_label">{{ r.subject_label }}</span>
            <span class="rk-bar">
              <i :style="{ width: rankW(r) + '%', background: r.net_amt < 0 ? 'var(--suc)' : 'var(--p)' }"></i>
            </span>
            <span class="rk-v" :class="sgn(r.net_amt)">{{ wan2(r.net_amt) }} 万</span>
            <span class="rk-r" :title="r.rate_den == null ? '这期间没录过分母，率算不出' : ''">
              {{ r.rate_den == null ? '—' : pct(r.rate_net) }}
            </span>
            <span class="rk-m">{{ r.months_filled }}/{{ r.months }} 月</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  months: { type: Array, default: () => [] },
  summary: { type: Object, default: () => ({}) },
  subjectTotals: { type: Array, default: () => [] },
  groupsMeta: { type: Array, default: () => [] },
  pricing: { type: String, default: 'sale' },
  period: { type: String, default: '' },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  skippedEmpty: { type: Number, default: 0 },
})
defineEmits(['pick'])

/* 行分组配色 —— 按 row_groups 的**顺序**取色（组名与顺序都来自后端，
   这里只决定"第 1 组用什么颜色"，不是第二份业务定义）。 */
const GCOL = ['var(--p)', 'var(--war)', 'var(--teal)', 'var(--dan)']
/* 堆叠顺序也只认这个 key 序（与后端 ROW_GROUPS 的行序一致） */
const GKEYS = ['store', 'operator', 'direct', 'wastage']

const mm = computed(() => props.months || [])
const hasAny = computed(() => mm.value.some(m => m.has_data && !m.hidden))
/* 「有数据但全被筛掉」与「整个区间一条没录」是**两回事**，空态文案必须分开 ——
   否则用户看到"这个区间还没有任何录入"会以为数据丢了。 */
const allFilteredOut = computed(() => !hasAny.value && mm.value.some(m => m.has_data))
const hiddenCount = computed(() => mm.value.filter(m => m.hidden).length)
/* 跳过的空月数：页面在"补空月=关"时会把这些月从数组里去掉，故由页面另传一个计数
   —— 这里用 `from/to` 声明与实际月数的差**不作为**依据（区间本就可能含未录入月）。 */
const skippedEmpty = computed(() => props.skippedEmpty || 0)

const pricingLabel = computed(() => (props.pricing === 'cost' ? '成本价（进货价）' : '售价'))

/* ── 轴 ── */
function niceScale(vals, want = 4) {
  const rs = (vals || []).filter(v => v != null && isFinite(v))
  let lo = rs.length ? Math.min(0, ...rs) : 0
  let hi = rs.length ? Math.max(0, ...rs) : 0
  if (hi - lo < 1e-9) hi = lo + Math.max(Math.abs(lo) * 0.2, 1)
  const raw = (hi - lo) / want
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
  const a = Math.floor(lo / step) * step
  const b = Math.ceil(hi / step) * step
  const ticks = []
  for (let i = 0; a + i * step <= b + step * 1e-6; i++) ticks.push(+(a + i * step).toFixed(6))
  return { lo: a, hi: b, step, ticks }
}
const live = (m) => m.has_data && !m.hidden
const amtAxis = computed(() => niceScale(
  mm.value.filter(live).flatMap(m => [m.gross_amt, m.net_amt])))
const rateAxis = computed(() => niceScale(
  mm.value.filter(live).map(m => m.rate_net), 3))
const dedAxis = computed(() => niceScale(
  mm.value.filter(live).flatMap(m => [m.gross_amt, m.ded_amt, m.net_amt])))
const stackAxis = computed(() => {
  const sums = mm.value.filter(live).map(m => GKEYS.reduce(
    (s, k) => s + Math.max(0, Number(m.groups?.[k]?.net_amt) || 0), 0))
  return niceScale(sums)
})

/* ── 几何 ── */
const W = 1080
const H = 300
const Hs = 230
const padL = 70
const padR = 64
const padT = 34
const padB = 46
const iw = W - padL - padR
const ih = H - padT - padB
const ihs = Hs - padT - padB
const slot = computed(() => (mm.value.length ? iw / mm.value.length : iw))
const bw = computed(() => Math.max(5, Math.min(20, slot.value * 0.22)))
const cx = (i) => padL + slot.value * i + slot.value / 2
const mkY = (ax, h) => (v) => H - padB - ((Number(v) - ax.lo) / (ax.hi - ax.lo)) * h
const yAmt = (v) => mkY(amtAxis.value, ih)(v)
const yRate = (v) => mkY(rateAxis.value, ih)(v)
const yDed = (v) => (Hs - padB - ((Number(v) - dedAxis.value.lo)
  / (dedAxis.value.hi - dedAxis.value.lo)) * ihs)
const ySt = (v) => (Hs - padB - ((Number(v) - stackAxis.value.lo)
  / (stackAxis.value.hi - stackAxis.value.lo)) * ihs)

/* ── 折线：空月/隐藏月处**必须断开**（连起来就是把"缺月"画成"连续下降"）── */
const rateSegs = computed(() => {
  const segs = []
  let run = []
  mm.value.forEach((m, i) => {
    if (!live(m) || m.rate_net == null) {
      if (run.length > 1) segs.push(run)
      run = []
      return
    }
    run.push([cx(i), yRate(m.rate_net)])
  })
  if (run.length > 1) segs.push(run)
  return segs.map(s => s.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '))
})
const rateDots = computed(() => mm.value
  .map((m, i) => (live(m) && m.rate_net != null ? [cx(i), yRate(m.rate_net), m.period] : null))
  .filter(Boolean))

/* ── 堆叠段 ── */
function stackOf(m, i) {
  const out = []
  let acc = 0
  GKEYS.forEach((k, gi) => {
    const v = Math.max(0, Number(m.groups?.[k]?.net_amt) || 0)
    if (!v) return
    const y0 = ySt(acc)
    const y1 = ySt(acc + v)
    out.push({
      k, y: Math.min(y0, y1), h: Math.abs(y0 - y1), c: GCOL[gi],
      label: legendOf(k) + '：' + wan2(m.groups[k].net_amt) + ' 万元'
        + (m.groups[k].filled ? '' : '（未录入：0 元 ≠ 本月无此项）'),
    })
    acc += v
  })
  return out
}
function legendOf(k) {
  const g = (props.groupsMeta || []).find(x => x.row_kind === k)
  return g ? g.no + ' ' + g.title : k
}
function tagOf(k) {
  const g = (props.groupsMeta || []).find(x => x.row_kind === k)
  return g ? g.no : '·'
}

/* ── 提示 / 标签 / 格式 ── */
function tip(m) {
  const L = [m.period + (m.is_closed ? '（已结账）' : '（未结账）')]
  L.push('货损毛额 ' + wan2(m.gross_amt) + ' 万元')
  L.push('临期销售 ' + (m.ded_amt == null ? '未录入' : wan2(m.ded_amt) + ' 万元'))
  L.push('货损净额 ' + wan2(m.net_amt) + ' 万元')
  L.push('公司货损净率 ' + (m.rate_net == null ? '—（缺分母）' : pct(m.rate_net)))
  if (m.gaps && m.gaps.length) L.push('缺口：' + m.gaps.join('；'))
  L.push('点击查看该月详情')
  return L.join('\n')
}
const mmLabel = (p) => Number(p.slice(5)) + '月'
/* 年份只在 1 月或首列标一次，避免 12 个 2026 挤满 X 轴 */
const showYear = (m, i) => i === 0 || m.period.slice(5) === '01'

const axisWan = (v) => (v === 0 ? '0' : (v / 10000).toFixed(decimalsFor(amtAxis.value.step / 10000)))
const axisPct = (v) => Number(v).toFixed(decimalsFor(rateAxis.value.step)) + '%'
const axisWanDed = (v) => (v === 0 ? '0' : (v / 10000).toFixed(decimalsFor(dedAxis.value.step / 10000)))
const axisWanSt = (v) => (v === 0 ? '0' : (v / 10000).toFixed(decimalsFor(stackAxis.value.step / 10000)))
/* 小数位数**由刻度步长决定**（不是拍一个固定值）：
   同一根轴上出现 "1.0%" 与 "0.50%" 两种精度，用户会以为后者更精确。 */
function decimalsFor(step) {
  const s = Math.abs(step) || 1
  return Math.max(0, Math.min(3, Math.ceil(-Math.log10(s))))
}

function wan2(v) {
  if (v == null || !isFinite(Number(v))) return '—'
  return (Number(v) / 10000).toFixed(2)
}
function pct(v) {
  if (v == null || !isFinite(Number(v))) return '—'
  return Number(v).toFixed(2) + '%'
}
function sgn(v) {
  if (v == null || !isFinite(Number(v))) return ''
  return Number(v) < 0 ? 'good' : ''
}

/* 抵扣占毛额的比例（"挽回了多少"）——分母是**毛额**，不是销售额 */
const dedRatio = computed(() => {
  const g = Number(props.summary?.gross_amt) || 0
  const d = props.summary?.ded_sum
  if (!g || d == null) return null
  return d / g * 100
})
/* 有数据月里，有多少月没录抵扣 ⇒ 合计层面必须提示净额偏大 */
const dedPartial = computed(() => {
  const s = props.summary || {}
  return Number(s.months_with_data) > 0
    && Number(s.months_with_ded) < Number(s.months_with_data)
})

const rank = computed(() => (props.subjectTotals || []).slice(0, 8))
const rankMax = computed(() => Math.max(...rank.value.map(r => Math.abs(Number(r.net_amt) || 0)), 1))
function rankW(r) {
  return Math.max(2, Math.round(Math.abs(Number(r.net_amt) || 0) / rankMax.value * 100))
}
</script>

<style scoped>
.dsh { margin-top: 14px; }
.dsh-hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 10px; }
.dsh-hd b { font-size: 15px; color: var(--t1); }
.dsh-sub { font-size: 12px; color: var(--t2); }
.dsh-note { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.dsh-note.war { color: var(--warn-amber); background: var(--warn-amber-bg); }

.dsh-empty {
  padding: 22px; border: 1px dashed var(--bd); border-radius: var(--radius-md);
  color: var(--t2); font-size: 13px; text-align: center; background: var(--bg2);
}
.dsh-warn {
  margin: 8px 0; padding: 8px 12px; border-radius: var(--radius-sm);
  font-size: 12.5px; color: var(--warn-amber); background: var(--warn-amber-bg);
}

.dsh-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.k {
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; min-width: 0;
}
.k-main { border-color: var(--p-border); background: var(--p-bg); }
.k i { font-style: normal; font-size: 12px; color: var(--t2); }
.k b { font-size: 21px; font-weight: 600; color: var(--t1); letter-spacing: -.2px; }
.k b u { font-size: 12px; font-weight: 400; color: var(--t2); text-decoration: none; margin-left: 3px; }
.k b.good { color: var(--suc); }
.k em { font-style: normal; font-size: 11.5px; color: var(--t3); line-height: 1.5; }
.k em.war { color: var(--warn-amber); }
@media (max-width: 1100px) { .dsh-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.dsh-card {
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  padding: 12px 14px; margin-top: 12px;
}
.dsh-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1100px) { .dsh-grid { grid-template-columns: 1fr; } }
.dsh-t { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: var(--t1); font-weight: 600; }
.dsh-t-sub { font-weight: 400; font-size: 11.5px; color: var(--t3); }
.lg { display: flex; align-items: center; gap: 10px; margin-left: auto; font-size: 11.5px; color: var(--t2); font-weight: 400; }
.lg-wrap { margin-left: 0; margin-top: 8px; flex-wrap: wrap; }
.lg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.lg i.ln { height: 3px; border-radius: 2px; width: 14px; }
.lg span { display: inline-flex; align-items: center; }

.dsh-svg { margin-top: 8px; }
.dsh-svg-sm { margin-top: 6px; }
.ch { width: 100%; height: auto; display: block; overflow: visible; }
.ax { font-size: 11px; fill: var(--t3); }
.ax-rate { fill: var(--purple); }
.ax-u { font-size: 10px; }
.xl { font-size: 11px; fill: var(--t2); }
.xl-y { font-size: 10px; fill: var(--t3); }
.xl-open { font-size: 10px; fill: var(--warn-amber); }
.ph { font-size: 11px; fill: var(--t3); }
.ph-s { font-size: 10px; }
.bars { cursor: pointer; }
.bars:hover rect { opacity: .82; }

.rk { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.rk-row { display: grid; grid-template-columns: 22px minmax(120px, 190px) 1fr 96px 74px 62px;
  align-items: center; gap: 8px; font-size: 12.5px; }
.rk-tag { width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 6px;
  font-size: 11px; background: var(--bg4); color: var(--t2); }
.rk-tag.k-store { background: var(--p-bg); color: var(--p-deep); }
.rk-tag.k-operator { background: var(--warn-amber-bg); color: var(--warn-amber); }
.rk-nm { color: var(--t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rk-bar { height: 12px; background: var(--bg2); border-radius: 6px; overflow: hidden; }
.rk-bar i { display: block; height: 100%; border-radius: 6px; min-width: 2px; }
.rk-v { text-align: right; color: var(--t1); font-variant-numeric: tabular-nums; }
.rk-v.good { color: var(--suc); }
.rk-r { text-align: right; color: var(--purple); font-variant-numeric: tabular-nums; }
.rk-m { text-align: right; color: var(--t3); font-size: 11.5px; }
</style>
