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
      <!-- ══ 概览（5 项）══
           形态用**全站唯一规范** `.kpi-strip`（styles/variables.css「Bento 网格 / KPI 概览条」段
           明文写着「顶部概览统计统一用 .kpi-strip，不再各页自造」）——
           本区此前自造的 `.dsh-kpis/.k` 正是该规范点名要收口的那种第二份实现。
           数据项、文案、口径一个不动，只换承载形态。 -->
      <div class="card dsh-kpibox">
        <div class="kpi-strip">
          <div class="kpi">
            <div class="kpi-label">期段货损净额</div>
            <div class="kpi-val val-net" :class="{ 'val-ok': summary.net_amt < 0 }">
              {{ wan2(summary.net_amt) }}<u>万元</u>
            </div>
            <div class="kpi-sub">毛额 − 临期销售 · 负数=临期销售超过损失（好事）</div>
          </div>
          <div class="kpi kpi-main">
            <div class="kpi-label">期段货损净率</div>
            <div class="kpi-val val-net">{{ pct(summary.rate_net) }}</div>
            <div class="kpi-sub">
              加权口径：∑净额 ÷ ∑分母（{{ summary.months_with_den || 0 }} 个月有分母）
            </div>
          </div>
          <div class="kpi">
            <div class="kpi-label">期段货损毛额</div>
            <div class="kpi-val val-gross">{{ wan2(summary.gross_amt) }}<u>万元</u></div>
            <div class="kpi-sub">①门店退货 + ②业务员仓调 + ③直调 + ④报损</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">临期销售</div>
            <div class="kpi-val val-ded">
              {{ summary.ded_sum == null ? '—' : wan2(summary.ded_sum) }}<u v-if="summary.ded_sum != null">万元</u>
            </div>
            <div v-if="summary.ded_sum == null" class="kpi-sub war">未录入 —— 不是 0（净额因此偏大）</div>
            <div v-else class="kpi-sub">挽回了毛额的 {{ pct(dedRatio) }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">数据完整度</div>
            <div class="kpi-val">{{ summary.months_with_data || 0 }}<u>/ {{ summary.months_total || 0 }} 月</u></div>
            <div class="kpi-sub">
              有缺口 {{ summary.months_with_gaps || 0 }} 月 · 已结账 {{ summary.months_closed || 0 }} 月
            </div>
          </div>
        </div>
      </div>

      <div v-if="dedPartial" class="dsh-warn">
        ⚠️ {{ summary.months_with_data - summary.months_with_ded }} 个月没录「临期仓销售总额」——
        这些月的抵扣按 0 计入合计，所以<b>净额偏大</b>、货损率偏高。按期补录后即自动修正。
      </div>

      <!-- ══ 主图：按月货损趋势（双柱 + 净率折线，双轴各自带刻度）══ -->
      <div class="dsh-card">
        <div class="sec-hd">
          按月货损趋势
          <span class="sec-sub">柱=万元（左轴）· 线=公司货损净率 %（右轴）· 点柱子可切到该月详情</span>
          <span class="lg">
            <i style="background:var(--c-gross)"></i>货损毛额
            <i style="background:var(--c-net)"></i>货损净额
            <i class="ln" style="background:var(--c-rate)"></i>公司货损净率
          </span>
        </div>
        <div class="dsh-svg">
          <svg :viewBox="`0 0 ${W} ${H}`" class="ch" role="img"
               aria-label="按月货损毛额、净额柱状图与公司货损净率折线">
            <!-- 左轴刻度线 + 标签 -->
            <g>
              <g v-for="t in amtAxis.ticks" :key="'ga' + t">
                <line :x1="padL" :x2="W - padR" :y1="yAmt(t)" :y2="yAmt(t)"
                      :stroke="t === 0 ? 'var(--c-axis)' : 'var(--c-grid)'" stroke-width="1"/>
                <text :x="padL - 8" :y="yAmt(t) + 4" class="ax" text-anchor="end">
                  {{ axisWan(t) }}
                </text>
              </g>
              <text :x="padL - 8" :y="padT - 16" class="ax ax-u" text-anchor="end">万元</text>
            </g>
            <!-- 右轴刻度（率的单位必须与金额分开标） -->
            <g>
              <g v-for="t in rateAxis.ticks" :key="'gr' + t">
                <text :x="W - padR + 8" :y="yRate(t) + 4" class="ax ax-rate" text-anchor="start">
                  {{ axisPct(t) }}
                </text>
              </g>
              <text :x="W - padR + 8" :y="padT - 16" class="ax ax-rate ax-u" text-anchor="start">%</text>
            </g>

            <!-- 月份 -->
            <g v-for="(m, i) in mm" :key="'mo' + m.period">
              <!-- 未录入 / 已隐藏：占位框，绝不画 0 柱 -->
              <!-- 占位框宽度 = **该月柱群宽度**（2*bw+4），不是整列宽：
                   12 个月时整列宽占满 ~79px、框间只剩 12px 缝，11 个未录入月连成
                   一片"灰墙"（新租户只有 1 个月数据时很常见）。收成柱群宽后，
                   既与"这里本该有柱子"对得上，三张图的占位也一个宽度。 -->
              <template v-if="m.hidden">
                <rect :x="cx(i) - bw - 2" :y="padT" :width="bw * 2 + 4" :height="ih"
                      fill="var(--c-ph-bg)" rx="6"/>
                <text :x="cx(i)" :y="padT + ih / 2" class="ph" text-anchor="middle">已隐藏</text>
                <text :x="cx(i)" :y="padT + ih / 2 + 15" class="ph ph-s" text-anchor="middle">未结账</text>
              </template>
              <template v-else-if="!m.has_data">
                <rect :x="cx(i) - bw - 2" :y="padT" :width="bw * 2 + 4" :height="ih"
                      fill="var(--c-ph-bg)" stroke="var(--c-ph-bd)" stroke-width="1"
                      stroke-dasharray="4 4" rx="6"/>
                <text :x="cx(i)" :y="padT + ih / 2 + 4" class="ph" text-anchor="middle">未录入</text>
              </template>
              <template v-else>
                <g class="bars" @click="$emit('pick', m.period)">
                  <title>{{ tip(m) }}</title>
                  <rect :x="cx(i) - bw - 2" :y="Math.min(yAmt(0), yAmt(m.gross_amt))"
                        :width="bw" :height="Math.abs(yAmt(m.gross_amt) - yAmt(0))"
                        fill="var(--c-gross)" rx="3"/>
                  <rect :x="cx(i) + 2" :y="Math.min(yAmt(0), yAmt(m.net_amt))"
                        :width="bw" :height="Math.abs(yAmt(m.net_amt) - yAmt(0))"
                        fill="var(--c-net)" rx="3"/>
                </g>
              </template>
              <!-- X 标签（`xl-m` 是月份标签的语义钩子：`xl-y`/`xl-open` 是它的附属行） -->
              <text :x="cx(i)" :y="H - padB + 16" class="xl xl-m"
                    text-anchor="middle">{{ mmLabel(m.period) }}</text>
              <text v-if="showYear(m, i)" :x="cx(i)" :y="H - padB + 30" class="xl xl-y"
                    text-anchor="middle">{{ m.period.slice(0, 4) }}</text>
              <text v-if="m.has_data && !m.is_closed" :x="cx(i)" :y="H - padB + 43"
                    class="xl xl-open" text-anchor="middle">未结账</text>
              <!-- 当前期次标记：加白描边让它从网格线里跳出来（原先 3px 纯色点太弱，
                   在一屏 6~12 根柱子中间基本看不出"我现在看的是哪个月"）。 -->
              <circle v-if="m.period === period" :cx="cx(i)" :cy="padT - 7" r="4"
                      fill="var(--c-net)" stroke="var(--bg)" stroke-width="1.5">
                <title>当前查看的期次</title>
              </circle>
            </g>

            <!-- 率折线（空月/隐藏月必须断开） -->
            <polyline v-for="(s, k) in rateSegs" :key="'rs' + k" :points="s" fill="none"
                      stroke="var(--c-rate)" stroke-width="2.4" stroke-linejoin="round"
                      stroke-linecap="round"/>
            <circle v-for="p in rateDots" :key="'rd' + p[2]" :cx="p[0]" :cy="p[1]" r="3.4"
                    fill="var(--bg)" stroke="var(--c-rate)" stroke-width="2.2"/>
          </svg>
        </div>
      </div>

      <!-- ══ 副图 A：构成堆叠 ══ -->
      <div class="dsh-grid">
        <div class="dsh-card">
          <div class="sec-hd">
            货损构成（按行分组）
            <span class="sec-sub">哪一块在变大</span>
          </div>
          <div class="dsh-svg dsh-svg-sm">
            <svg :viewBox="`0 0 ${W} ${Hs}`" class="ch" role="img" aria-label="按行分组的货损构成堆叠柱">
              <g v-for="t in stackAxis.ticks" :key="'gs' + t">
                <line :x1="padL" :x2="W - padR" :y1="ySt(t)" :y2="ySt(t)"
                      :stroke="t === 0 ? 'var(--c-axis)' : 'var(--c-grid)'" stroke-width="1"/>
                <text :x="padL - 8" :y="ySt(t) + 4" class="ax" text-anchor="end">{{ axisWanSt(t) }}</text>
              </g>
              <text :x="padL - 8" :y="padT - 16" class="ax ax-u" text-anchor="end">万元</text>
              <g v-for="(m, i) in mm" :key="'sk' + m.period">
                <template v-if="!m.has_data || m.hidden">
                  <rect :x="cx(i) - bw - 1" :y="padT" :width="bw * 2 + 2" :height="ihs"
                        fill="var(--c-ph-bg)" stroke="var(--c-ph-bd)" stroke-dasharray="4 4" rx="6"/>
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
          <div class="sec-hd">
            临期销售对比
            <span class="sec-sub">抵扣救回了多少</span>
          </div>
          <div class="dsh-svg dsh-svg-sm">
            <svg :viewBox="`0 0 ${W} ${Hs}`" class="ch" role="img" aria-label="逐月货损毛额、临期销售、货损净额对比柱">
              <g v-for="t in dedAxis.ticks" :key="'gd' + t">
                <line :x1="padL" :x2="W - padR" :y1="yDed(t)" :y2="yDed(t)"
                      :stroke="t === 0 ? 'var(--c-axis)' : 'var(--c-grid)'" stroke-width="1"/>
                <text :x="padL - 8" :y="yDed(t) + 4" class="ax" text-anchor="end">{{ axisWanDed(t) }}</text>
              </g>
              <text :x="padL - 8" :y="padT - 16" class="ax ax-u" text-anchor="end">万元</text>
              <g v-for="(m, i) in mm" :key="'dd' + m.period">
                <template v-if="!m.has_data || m.hidden">
                  <rect :x="cx(i) - bw3 * 2 - 4" :y="padT" :width="bw3 * 4 + 8" :height="ihs"
                        fill="var(--c-ph-bg)" stroke="var(--c-ph-bd)" stroke-dasharray="4 4" rx="6"/>
                  <text :x="cx(i)" :y="padT + ihs / 2 + 4" class="ph ph-s" text-anchor="middle">
                    {{ m.hidden ? '已隐藏' : '未录入' }}
                  </text>
                </template>
                <template v-else>
                  <g class="bars">
                    <title>{{ tip(m) }}</title>
                    <rect v-if="m.ded_amt != null" :x="cx(i) - bw3 * 2 - 4"
                          :y="Math.min(yDed(0), yDed(m.ded_amt))" :width="bw3"
                          :height="Math.abs(yDed(m.ded_amt) - yDed(0))" fill="var(--c-ded)" rx="3"/>
                    <rect :x="cx(i) - bw3 / 2" :y="Math.min(yDed(0), yDed(m.gross_amt))" :width="bw3"
                          :height="Math.abs(yDed(m.gross_amt) - yDed(0))" fill="var(--c-gross)" rx="3"/>
                    <rect :x="cx(i) + bw3 + 4" :y="Math.min(yDed(0), yDed(m.net_amt))" :width="bw3"
                          :height="Math.abs(yDed(m.net_amt) - yDed(0))" fill="var(--c-net)" rx="3"/>
                  </g>
                </template>
                <text :x="cx(i)" :y="Hs - padB + 16" class="xl" text-anchor="middle">{{ mmLabel(m.period) }}</text>
              </g>
            </svg>
          </div>
          <div class="lg lg-wrap">
            <span><i style="background:var(--c-ded)"></i>临期销售</span>
            <span><i style="background:var(--c-gross)"></i>货损毛额</span>
            <span><i style="background:var(--c-net)"></i>货损净额</span>
          </div>
        </div>
      </div>

      <!-- ══ 副图 C：主体排行（期段内合计）══ -->
      <div class="dsh-card">
        <div class="sec-hd">
          主体货损排行
          <span class="sec-sub">
            期段内合计 · 按货损净额降序 · 率 = ∑分子 ÷ ∑分母（<b>不是</b>各月率的平均）
          </span>
        </div>
        <div v-if="!rank.length" class="dsh-empty">这期间还没有门店/业务员的数据。</div>
        <div v-else class="rk">
          <div v-for="r in rank" :key="r.row_kind + r.subject_key" class="rk-row">
            <span class="rk-tag" :class="'k-' + r.row_kind">{{ tagOf(r.row_kind) }}</span>
            <span class="rk-nm" :title="r.subject_label">{{ r.subject_label }}</span>
            <span class="rk-bar">
              <i :style="{ width: rankW(r) + '%', background: r.net_amt < 0 ? 'var(--c-ded)' : 'var(--c-net)' }"></i>
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
   这里只决定"第 1 组用什么颜色"，不是第二份业务定义）。
   ⚠️ 色值走本组件自己的图表 token（见 style 里 `.dsh` 的 `--c-g*`）：
   全站的 `--war/--dan` 是**警示色**（用于徽标/告警条，面积小），
   直接拿来铺整片柱体会偏刺眼，故图表侧只派生不改全局。 */
const GCOL = ['var(--c-g1)', 'var(--c-g2)', 'var(--c-g3)', 'var(--c-g4)']
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

/* ── 几何 ──
   画布尺寸只决定**比例**（`.ch` 是 width:100% 缩放），故加大 H 会让图更"舒展"、
   柱更细长；配 `bw` 的上限一起调，避免 12 个月的图上柱子瘦成线。 */
const W = 1080
const H = 320
const Hs = 240
const padL = 70
const padR = 64
const padT = 36
const padB = 48
const iw = W - padL - padR
const ih = H - padT - padB
const ihs = Hs - padT - padB
const slot = computed(() => (mm.value.length ? iw / mm.value.length : iw))
const bw = computed(() => Math.max(6, Math.min(26, slot.value * 0.24)))
/* 副图 B 是**三根**柱，不能沿用一个 bw —— 12 个月时列宽只有 ~79px，而 4*bw+8
   会超过列宽，柱群会挤进相邻月份（该缺陷原先是"藏"着的：以前只有最右列有数据，
   右边正好有 padR 的空间接住它）。按"列宽减两侧留白"反算上限。 */
const bw3 = computed(() => Math.min(bw.value, Math.max(5, (slot.value - 16) / 4)))
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
/* ══════════════════════════════════════════════════════════════════
   货损趋势仪表盘 · 视觉层（本次重做；数据项、图表数量、文案零改动）
   --------------------------------------------------------------
   改本页前先读这三条：
   ① **图表配色走本组件自己的 token**（下面的 `--c-*`）。全站的
      `--war`(#ff9f0a) / `--dan`(#ff3b30) 是**警示语义**（徽章、告警条这类小面积），
      直接拿来铺整片柱体会偏刺眼；这里是**派生值**，且刻意**不改全局变量**
      —— 改全局会波及别的页。浅色/深色两套必须同时给，否则深色下柱子会糊在背景里。
   ② **层次靠字号/字重/颜色阶梯 + 间距节奏**，不靠加新标题：本页文案一个字没加，
      分组全部由「既有标题 + 左竖条 + 留白」表达。
   ③ 卡片沿用全局 `.card` 的视觉语言（radius-lg / shadow-sm / border-subtle），
      与站内其它页一致；概览条用全局 `.kpi-strip`（规范明文「不再各页自造」）。
   ══════════════════════════════════════════════════════════════════ */
.dsh {
  margin-top: 16px;

  /* ── 图表语义色 · 浅色 ── */
  --c-gross: #f97316;   /* 货损毛额：橙 = 损失总量 */
  --c-net:   #0891b2;   /* 货损净额：品牌青（与 --p-dark 同源，比 --p 深一档更耐看） */
  --c-ded:   #10b981;   /* 临期销售：绿 = 挽回的钱 */
  --c-rate:  #7c77dd;   /* 货损净率：紫 —— 与金额柱分色，标明它走右轴 */
  /* ① ~ ④ 行分组的堆叠色（顺序跟后端 row_groups，见 script 里的 GCOL） */
  --c-g1: #0891b2;
  --c-g2: #f59e0b;
  --c-g3: #10b981;
  --c-g4: #f43f5e;
  /* 网格 / 零轴 / 空月占位：网格是**背景**不是内容，故比 --bd 更轻 */
  --c-grid: rgba(0, 0, 0, .055);
  --c-axis: rgba(0, 0, 0, .14);
  --c-ph-bg: rgba(0, 0, 0, .022);
  --c-ph-bd: rgba(0, 0, 0, .10);
}
/* 深色主题：同一组语义按深底重取（亮一档 + 网格反过来提对比）。
   ⚠️ 主题是 `documentElement` 上的 `.light`/`.dark` class，不是 data-theme。 */
html.dark .dsh {
  --c-gross: #fb923c;
  --c-net:   #22d3ee;
  --c-ded:   #34d399;
  --c-rate:  #a5a0f0;
  --c-g1: #22d3ee;
  --c-g2: #fbbf24;
  --c-g3: #34d399;
  --c-g4: #fb7185;
  --c-grid: rgba(255, 255, 255, .075);
  --c-axis: rgba(255, 255, 255, .18);
  --c-ph-bg: rgba(255, 255, 255, .03);
  --c-ph-bd: rgba(255, 255, 255, .14);
}

/* ── 本块块头（「货损趋势」+ 区间/口径说明 + 两个状态胶囊）── */
.dsh-hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; }
.dsh-hd b { font-size: 15px; font-weight: 600; color: var(--t1); }
.dsh-sub { font-size: 12px; color: var(--t2); }
.dsh-note { font-size: 12px; padding: 3px 9px; border-radius: 999px; }
.dsh-note.war { color: var(--warn-amber); background: var(--warn-amber-bg); }

/* ── 空态 / 「数据不全所以净额偏大」告警（左侧色条替掉整块底色，读起来不刺）── */
.dsh-empty {
  padding: 26px 22px; border: 1px dashed var(--bd); border-radius: var(--radius-lg);
  color: var(--t2); font-size: 13px; line-height: 1.7; text-align: center; background: var(--bg2);
}
.dsh-warn {
  margin: 12px 0 0; padding: 10px 14px;
  border-left: 3px solid var(--warn-amber); border-radius: var(--radius-sm);
  font-size: 12.5px; line-height: 1.65;
  color: var(--warn-amber); background: var(--warn-amber-bg);
}

/* ── 概览条：承载形态 = 全局 `.kpi-strip`，这里只做本页微调 ──
   `.kpi-strip` 自带 `padding:6px 0`（为"裸用"场景准备的），本处外层 `.card`
   已有内距，故清零，避免双份留白。 */
.dsh-kpibox { padding: 6px 8px; }
.dsh-kpibox .kpi-strip { padding: 0; }
.dsh-kpibox .kpi { padding: 10px 18px; display: flex; flex-direction: column; gap: 5px; }
.dsh-kpibox .kpi-val { font-size: 25px; margin-bottom: 0; }
.dsh-kpibox .kpi-val u {
  font-size: 12px; font-weight: 400; color: var(--t2); text-decoration: none; margin-left: 4px;
}
.dsh-kpibox .kpi-sub { font-size: 11.5px; line-height: 1.55; }
.dsh-kpibox .kpi-sub.war { color: var(--warn-amber); }
/* 数值按指标语义着色 —— 比"每张卡换一个边框色"安静，且颜色直接绑定数据 */
.dsh-kpibox .val-gross { color: var(--c-gross); }
.dsh-kpibox .val-net { color: var(--c-net); }
.dsh-kpibox .val-ded { color: var(--c-ded); }
/* 「净额为负 = 好事」优先于上面的语义色，故放最后（更高特异性，不依赖源顺序） */
.dsh-kpibox .kpi-val.val-ok { color: var(--suc); }
/* 主指标（净率）：全条唯一的强调项 —— 品牌浅底 + 左内色条 */
.dsh-kpibox .kpi-main { background: var(--p-bg); box-shadow: inset 3px 0 0 var(--p-dark); }
.dsh-kpibox .kpi-main:hover { background: var(--p-bg); }

/* ── 图表卡 ── */
.dsh-card {
  background: var(--bg); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);
  padding: 16px 18px 14px; margin-top: 16px;
}
.dsh-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1200px) { .dsh-grid { grid-template-columns: 1fr; } }

/* 卡片标题用**全局** `.sec-hd` / `.sec-sub`（styles/variables.css）——
   本页与「按月一览」明细卡共用同一份，别再在这里写第二份。
   左竖条是"分区锚"，替代再加一行分区标题（本页文案不增）。 */
.lg { display: flex; align-items: center; gap: 14px; margin-left: auto; font-size: 11.5px; color: var(--t2); font-weight: 400; }
.lg-wrap { margin-left: 0; margin-top: 10px; flex-wrap: wrap; gap: 8px 16px; }
.lg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.lg i.ln { height: 3px; border-radius: 2px; width: 14px; }
.lg span { display: inline-flex; align-items: center; }

.dsh-svg { margin-top: 12px; }
.dsh-svg-sm { margin-top: 10px; }
.ch { width: 100%; height: auto; display: block; overflow: visible; }
/* 轴刻度弱于正文（--t3）；但「未录入 / 已隐藏」是要读的信息，用 --t2 */
.ax { font-size: 11px; fill: var(--t3); }
.ax-rate { fill: var(--c-rate); }
.ax-u { font-size: 10px; }
.xl { font-size: 11px; fill: var(--t2); }
.xl-y { font-size: 10px; fill: var(--t3); }
.xl-open { font-size: 10px; fill: var(--warn-amber); }
.ph { font-size: 11px; fill: var(--t2); }
.ph-s { font-size: 10px; fill: var(--t3); }
.bars { cursor: pointer; }
.bars rect { transition: opacity .12s ease; }
.bars:hover rect { opacity: .86; }

/* ── 主体排行：条加粗让"长度差"更好比；行 hover 给回定位反馈 ── */
.rk { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
.rk-row {
  display: grid; grid-template-columns: 22px minmax(130px, 240px) 1fr 104px 78px 68px;
  align-items: center; gap: 10px; font-size: 12.5px;
  padding: 3px 6px; border-radius: var(--radius-sm); transition: background .12s ease;
}
.rk-row:hover { background: var(--bg2); }
.rk-tag { width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 6px;
  font-size: 11px; background: var(--bg4); color: var(--t2); }
.rk-tag.k-store { background: var(--p-bg); color: var(--p-deep); }
.rk-tag.k-operator { background: var(--warn-amber-bg); color: var(--warn-amber); }
.rk-nm { color: var(--t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rk-bar { height: 14px; background: var(--bg2); border-radius: 7px; overflow: hidden; }
.rk-bar i { display: block; height: 100%; border-radius: 7px; min-width: 3px; transition: width .2s ease; }
.rk-v { text-align: right; color: var(--t1); font-variant-numeric: tabular-nums; }
.rk-v.good { color: var(--suc); }
.rk-r { text-align: right; color: var(--c-rate); font-variant-numeric: tabular-nums; }
.rk-m { text-align: right; color: var(--t3); font-size: 11.5px; }
</style>
