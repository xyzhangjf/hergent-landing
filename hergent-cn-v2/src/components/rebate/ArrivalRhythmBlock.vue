<template>
  <!-- v121 合并：到货与报单节奏 —— 单一节奏源（报单语义），到货日自动派生 -->
  <!-- v122：报单节奏是品牌方（蒙牛/简爱）的排产节点，与单品无关 —— 商品维度整块不渲染 -->
  <div class="arrival-block">
    <div class="ap-sec">① 节奏<span class="ap-sec-note">只填一次，到货日自动算</span></div>
    <div class="form-row"><label>报单模式</label>
      <div class="seg">
        <button type="button" :class="['seg-btn', form.order_mode==='interval'?'on':'']" @click="form.order_mode='interval'">按间隔天数</button>
        <button type="button" :class="['seg-btn', form.order_mode==='weekday'?'on':'']" @click="form.order_mode='weekday'">按固定星期</button>
      </div>
    </div>
    <div class="form-grid2">
      <div class="form-row"><label>首次报单日</label><input v-model="form.order_first_date" class="input" type="date"></div>
      <div class="form-row" v-if="form.order_mode==='interval'"><label>报单周期(天)</label><input v-model.number="form.order_cadence_days" class="input" type="number" min="1" max="31" placeholder="如 2 = 每2天报单"></div>
      <div class="form-row" v-else><label>报单星期</label>
        <div class="wk-chips">
          <button v-for="w in weekdayOptions" :key="w.value" type="button" :class="['wk-chip', isOrderWk(w.value)?'on':'']" @click="$emit('toggle-wk', w.value)">{{ w.label }}</button>
        </div>
      </div>
    </div>
    <!-- v121b：报单日 → N → 到货日 三字段同排，左→右即计算链路 -->
    <div class="form-grid3">
      <div class="form-row"><label>提前天数</label>
        <div class="input-affix"><input :value="form.order_lead_days ?? ''" class="input" type="number" min="0" max="30" step="1" @input="$emit('lead-input', $event)"><span class="affix">天到货</span></div>
      </div>
      <div class="form-row"><label>首次到货日<span class="ap-sec-note">自动算，可改</span></label>
        <input :value="firstArrivalDate" class="input" type="date" @change="$emit('arrival-change', $event)">
      </div>
      <div class="form-row"><label>最多可提前</label>
        <div class="input-affix"><input v-model.number="form.order_max_early_days" class="input" type="number" min="0" max="2"><span class="affix">天报单</span></div>
      </div>
    </div>
    <p v-if="leadErr" class="ap-warn">⚠ {{ leadErr }}</p>
    <p class="ap-derive">到货日 = 报单日{{ form.order_first_date ? '（' + form.order_first_date + '）' : '' }} + {{ leadValid ? form.order_lead_days : '?' }} 天<template v-if="firstArrivalDate"> = <b>{{ firstArrivalDate }}</b>（{{ arrivalWeekday }}）</template>。按<b>自然日</b>计算，不跳周末/节假日；手动改到货日会自动反推提前天数。</p>

    <div class="ap-sec">② 本月到货<span class="ap-sec-note">次数由「到货日」数出来，两处永远一致</span></div>

    <!-- v364：到货次数 = 日历上还剩几天。用户只做两件事：
           ① 点某一天 = 这一天不进货（停单）  ② 恢复系统推算。
         不再提供「直接填一个次数」的输入框 —— 那正是上一版出问题的根：
         次数能脱离日历被单独改写，于是「次数说 15、日历说 16」同屏两把尺子。 -->
    <div class="arr-stat">
      <div class="arr-stat-i">
        <span class="arr-stat-k">系统推算</span>
        <b>{{ sysCount }}</b><span class="arr-stat-u">次</span>
      </div>
      <div class="arr-stat-i">
        <span class="arr-stat-k">{{ ym }} 实到</span>
        <b :class="['on', skipped.length ? 'cut' : '']">{{ myCount }}</b><span class="arr-stat-u">次</span>
      </div>
      <div class="arr-stat-i">
        <span class="arr-stat-k">均单</span>
        <b>≈ {{ fmtWan(preview.per_order_wan) }}</b>
        <span class="arr-stat-u">万{{ preview.unit === '箱' ? '箱' : '元' }}/次</span>
      </div>
    </div>

    <!-- 次数与日历不一致时必须说清楚，并给一键对齐。
         典型来源：从旧版迁过来的「本月到货次数」只有次数、没有「哪一天」。 -->
    <p v-if="preview.count_mismatch" class="ap-warn">
      ⚠ 之前填的「本月到货 {{ preview.count_override }} 次」与日历上的 {{ myCount }} 天对不上，
      当前均单按 {{ preview.count_override }} 次算。
      <button type="button" class="ap-adopt" @click="$emit('align-count')">按日历对齐</button>
    </p>

    <!-- 停单日已不在本月的到货日里了（典型：停了某天后又改了报单周期/首次报单日）。
         这种"存着但不起作用"的日期必须说出来 —— 否则用户在日历上找不到自己停的那天，
         会以为系统吞了它，而它其实还在库里、只要改回来就复活。 -->
    <p v-if="staleSkips.length" class="ap-warn">
      ⚠ 你有 {{ staleSkips.length }} 天的停单<b>已经对不上本月的到货日</b>了（多半是后来改过报单周期 / 首次报单日），
      现在不起作用。想按新节奏重来，点「恢复系统推算」，再到上面的日历重新选。
      <button type="button" class="ap-adopt" @click="$emit('reset-skips')">恢复系统推算</button>
    </p>

    <div v-if="sysDates.length" class="arr-days">
      <button v-for="d in sysDates" :key="d" type="button"
              :class="['arr-day', skipped.includes(d) ? 'off' : '']"
              :title="skipped.includes(d) ? '点一下恢复这一天' : '点一下停掉这一天（这天不进货）'"
              @click="$emit('toggle-skip', d)">
        <span class="arr-day-d">{{ dayNum(d) }}</span>
        <span class="arr-day-w">{{ wkLabel(d) }}</span>
      </button>
    </div>
    <p v-else class="ap-warn">还没算出本月到货日 —— 先填「首次报单日」与「报单周期」。</p>

    <p v-if="sysDates.length" class="ap-skip-note">
      点一下某天 = <b>这一天不进货</b>。到货节奏<b>不会因此改变</b>：停掉 5 号，7 号照常到。
      <template v-if="skipped.length">已停 {{ skipped.length }} 天；</template>
      改动<b>只对 {{ ym }} 有效</b>，{{ nextYm }} 起自动回到系统推算<template
        v-if="nextSysCount != null">（{{ nextSysCount }} 次）</template>，不需要你每月维护。
      <button v-if="skipped.length || skipsDirty" type="button" class="ap-adopt"
              @click="$emit('reset-skips')">恢复系统推算</button>
    </p>

    <!-- v365：停单**顺带**改变了「系统会不会自动建那一期」—— 后端回执、逐条人话。
         为什么必须放在这里：用户的直觉后果只有「少一次到货」，而"报单期次少了一期"
         要等到几周后他打开报单页才会发现，那时已无从追溯是哪一次停单造成的。
         ⚠️ 只在**保存成功后**出现（改动未落库时上游会清空它），避免拿旧结论当现状。 -->
    <div v-if="skipEffect && skipEffect.length" class="ap-skip-effect">
      <p v-for="(t, i) in skipEffect" :key="i">{{ t }}</p>
    </div>

    <p v-if="preview.source === 'arrival'" class="ap-warn">
      ⚠ 还没填「首次报单日」，暂按旧的到货排程算（本月 {{ preview.count }} 次）。
      <b>旧排程锚在「每月几号」，跨月会错位</b>（如 10 月 31 日的下一次会算成 11 月 1 日，应为 11 月 2 日）；
      填了首次报单日后改用绝对日期延续，跨月不再错位，也与下方预览表一致。
      <button type="button" class="ap-adopt" @click="$emit('open-migrate')">从旧排程反推</button>
    </p>

    <!-- v242：「③ 报单自动化」已迁至「预报订单 → 报单配置」。
         它管的是**期次开闭**（预报订单模块的核心对象），且后端限定「租户内同一时间
         只能一个品牌开启」⇒ 属**租户级运行参数**，不属品牌目标。本块只保留
         ① 节奏 / ② 到货产出（这两项确实是品牌方排产节点）。 -->
    <div class="ap-moved">报单自动化（到点自动建表 / 关单）已移至
      <a href="#/forecast">预报订单 → 报单配置</a></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { WEEKDAY_OPTIONS, fmtWan } from './useRebateTargetForm.js'

const props = defineProps({
  form: { type: Object, required: true },
  arrivalPreview: { type: Object, default: null },
  firstArrivalDate: { type: String, default: '' },
  arrivalWeekday: { type: String, default: '' },
  leadErr: { type: String, default: '' },
  leadValid: { type: Boolean, default: false },
  /** 判断某星期是否已选（状态在父层，传函数进来避免拷贝 form 引用） */
  isOrderWk: { type: Function, required: true },
  /** v364：停单改动是否尚未保存（保存时随规则一起落库，并只写本月这一条） */
  skipsDirty: { type: Boolean, default: false },
  /** v365：保存后由后端回执的「哪几期报单期次不再自动新建」（人话，逐条） */
  skipEffect: { type: Array, default: () => [] },
})
defineEmits(['lead-input', 'arrival-change', 'toggle-wk', 'open-migrate',
             'toggle-skip', 'reset-skips', 'align-count'])

const weekdayOptions = WEEKDAY_OPTIONS

/* v364：② 区的所有数字都从**预览返回体**取 —— 前端不再自己算次数。
   上一版正是让次数脱离日历被单独改写，才出现「次数 15、日历 16」两把尺子；
   这里连「已停哪几天」也以返回体为准（未改动时它就是库里的值）。 */
const preview = computed(() => props.arrivalPreview || {})
const sysDates = computed(() => (props.arrivalPreview && props.arrivalPreview.system_dates) || [])
const sysCount = computed(() => {
  const n = props.arrivalPreview && props.arrivalPreview.system_count
  return n == null ? '—' : n
})
const myCount = computed(() => {
  const n = props.arrivalPreview && props.arrivalPreview.count
  return n == null ? '—' : n
})
const skipped = computed(() => (props.arrivalPreview && props.arrivalPreview.skipped) || [])
/** 存着但**对不上本月到货日**的停单日（越月 / 格式错 / 改过节奏后已不存在的那些）。
 *  只用来报个数（原始值可能是乱码，不往界面上摆）。 */
const staleSkips = computed(() => {
  const p = props.arrivalPreview || {}
  return [].concat(p.skip_not_in_schedule || [], p.skip_invalid || [])
})
const ym = computed(() => (props.arrivalPreview && props.arrivalPreview.ym) || '本月')
const nextYm = computed(() => (props.arrivalPreview && props.arrivalPreview.next_ym) || '下月')
const nextSysCount = computed(() => {
  const v = props.arrivalPreview && props.arrivalPreview.next_system_count
  return v == null ? null : v
})
const _WK = ['日', '一', '二', '三', '四', '五', '六']
function dayNum(iso) {
  const d = String(iso || '').slice(8, 10)
  return d ? String(Number(d)) : ''
}
function wkLabel(iso) {
  const p = String(iso || '').split('-').map(Number)
  if (p.length < 3 || p.some(n => !Number.isFinite(n))) return ''
  return '周' + _WK[new Date(p[0], p[1] - 1, p[2]).getDay()]
}
</script>

<style scoped>
.arrival-block{border:1px solid var(--bd2);border-radius:10px;padding:14px;margin-bottom:6px;background:var(--bg2)}
.arrival-block .form-row{margin-bottom:8px}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.seg{display:inline-flex;border:1px solid var(--bd2);border-radius:8px;overflow:hidden}
.seg-btn{padding:6px 14px;border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--t2)}
.seg-btn.on{background:var(--p);color:#fff}
.wk-chips{display:flex;gap:6px;flex-wrap:wrap}
.wk-chip{padding:6px 12px;border:1px solid var(--bd2);border-radius:18px;background:var(--bg1);cursor:pointer;font-size:13px;color:var(--t2)}
.wk-chip.on{background:var(--p);color:#fff;border-color:var(--p)}
.input-affix{display:flex;align-items:center;gap:6px}
.input-affix .input{flex:1}
.input-affix .affix{font-size:12px;color:var(--t3);white-space:nowrap}
.ro-val{font-size:14px;color:var(--t1);padding:7px 0;font-variant-numeric:tabular-nums}
.ro-val b{color:var(--p)}
.ap-sec{display:flex;align-items:center;gap:8px;margin:12px 0 8px;font-size:12.5px;font-weight:600;color:var(--t1)}
.ap-sec:first-child{margin-top:0}
.ap-sec-note{font-weight:400;font-size:11.5px;color:var(--t3)}
.ap-moved{margin:8px 0 0;font-size:12px;color:var(--t3);line-height:1.6}
.ap-moved a{color:var(--p-dark);text-decoration:none;border-bottom:1px dashed var(--p)}
.ap-derive{margin:2px 0 0;font-size:12px;color:var(--p-dark);background:rgba(6,182,212,.08);border-radius:6px;padding:6px 8px}
.ap-warn{font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5}
.ap-adopt{margin-left:8px;border:1px solid var(--p);background:transparent;color:var(--p-dark);border-radius:6px;padding:1px 10px;font-size:12px;cursor:pointer}
.ap-adopt:hover{background:var(--p);color:#fff}
/* v364：② 本月到货 —— 三个数字 + 一排可点的到货日。
   颜色一律走既有令牌（--p / --t1..t3 / --bg1..2 / --bd2），不新增硬编码色：
   本仓深色模式靠令牌翻转，写死色会在深色下变成白块（v362 踩过）。 */
.arr-stat{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px}
.arr-stat-i{display:flex;align-items:baseline;gap:4px;flex-wrap:wrap;background:var(--bg1);border:1px solid var(--bd2);border-radius:8px;padding:8px 10px}
.arr-stat-k{font-size:11.5px;color:var(--t3);flex-basis:100%}
.arr-stat-i b{font-size:17px;color:var(--t1);font-variant-numeric:tabular-nums;line-height:1.15}
.arr-stat-i b.on{color:var(--p-dark)}
.arr-stat-i b.cut{color:var(--t2)}
.arr-stat-u{font-size:11.5px;color:var(--t3)}
.arr-days{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px}
.arr-day{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:40px;padding:5px 6px;border:1px solid var(--bd2);border-radius:8px;background:var(--bg1);cursor:pointer;line-height:1.1}
.arr-day:hover{border-color:var(--p)}
.arr-day-d{font-size:13px;color:var(--t1);font-variant-numeric:tabular-nums}
.arr-day-w{font-size:10px;color:var(--t3)}
.arr-day.off{background:var(--bg2);border-style:dashed;opacity:.6}
.arr-day.off .arr-day-d{text-decoration:line-through;color:var(--t3)}
.ap-skip-note{margin:2px 0 0;font-size:12px;color:var(--t2);line-height:1.65}
/* v365：影响说明。颜色全走既有令牌（--p-dark/--p-rgb 本文件已在用），零硬编码色 */
.ap-skip-effect{margin:6px 0;font-size:12px;color:var(--p-dark);background:rgba(var(--p-rgb),.06);border-radius:var(--radius-xs, 6px);padding:6px 9px;line-height:1.6}
.ap-skip-effect p{margin:0}
.ap-skip-effect p+p{margin-top:4px}
@media(max-width:768px){ .arr-stat{grid-template-columns:1fr} }
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0}
@media(max-width:768px){ .form-grid2,.form-grid3{grid-template-columns:1fr} }
</style>
