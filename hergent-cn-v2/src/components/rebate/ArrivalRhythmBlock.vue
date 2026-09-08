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
    <p class="ap-derive">到货日 = 报单日{{ form.order_first_date ? '（' + form.order_first_date + '）' : '' }} + {{ leadValid ? form.order_lead_days : '?' }} 天<template v-if="firstArrivalDate"> = <b>{{ firstArrivalDate }}</b>（{{ arrivalWeekday }}）</template>。按<b>自然日</b>计算，不跳周末/节假日（与后端算法一致）；手动改到货日会自动反推提前天数。</p>

    <div class="ap-sec">② 到货产出</div>
    <div class="form-grid2">
      <div class="form-row"><label>本月到货次数</label>
        <div class="input-affix"><input v-model.number="form.arrival_count_override" class="input" type="number" min="0" :placeholder="'系统算：' + (arrivalPreview ? arrivalPreview.count : '-')"><span class="affix">次/月</span></div>
      </div>
      <div class="form-row"><label>均单</label>
        <div class="ro-val">≈ {{ fmtWan(arrivalPreview ? arrivalPreview.per_order_wan : 0) }} <b>万{{ arrivalPreview && arrivalPreview.unit==='箱' ? '箱' : '元' }}</b>/次</div>
      </div>
    </div>
    <p v-if="arrivalPreview && arrivalPreview.source==='arrival'" class="ap-warn">
      ⚠ 还没填「首次报单日」，均单暂按旧到货排程算（本月 {{ arrivalPreview.count }} 次、口径 {{ arrivalPreview.source }}）。填了首次报单日后自动改用报单节奏，与下方预览表同源。
      <button type="button" class="ap-adopt" @click="$emit('open-migrate')">从旧排程反推</button>
    </p>

    <div class="ap-sec">③ 报单自动化</div>
    <div class="form-row"><label>智能创建/关闭报单表</label>
      <div class="seg">
        <button type="button" :class="['seg-btn', !form.auto_period_enabled?'on':'']" @click="form.auto_period_enabled=0">手动建表</button>
        <button type="button" :class="['seg-btn', form.auto_period_enabled?'on':'']" @click="form.auto_period_enabled=1">自动建表</button>
      </div>
    </div>
    <div class="form-grid3">
      <div class="form-row"><label>开放填报</label><input v-model="form.auto_open_time" class="input" type="time"></div>
      <div class="form-row"><label>自动关单</label><input v-model="form.auto_close_time" class="input" type="time"></div>
      <div class="form-row"><label>厂家下单截止</label><input v-model="form.supplier_deadline_time" class="input" type="time"></div>
    </div>
    <p class="cf-tip">报单是<b>按品牌方排产节点</b>走的：<b>只能提前、不能延后</b> —— 过了品牌方的报单日就只能下期再报；提前太久报单又不准，所以最多提前 1~2 天。<br>
      <b>开放填报</b>在报单日<b>前一日</b>这个时刻自动建表，<b>自动关单</b>在报单日当天这个时刻截止；中间到<b>厂家下单截止</b>的这段，是留给经理改单、你付款、款到厂家账上的时间 —— 系统只在该时点提醒，<b>不会替你去厂家系统下单</b>。</p>

    <div v-if="autoPeriodPreview" class="ap-preview">
      <div class="ap-head">
        <span>未来 {{ autoPeriodPreview.preview.length }} 期</span>
        <span v-if="autoPeriodPreview.main_brand">主节奏：{{ autoPeriodPreview.main_brand }} · 每 {{ autoPeriodPreview.main_interval }} 天</span>
        <span v-if="autoPeriodPreview.window_hours">填报窗口 {{ autoPeriodPreview.window_hours }} 小时</span>
      </div>
      <div v-for="w in (autoPeriodPreview.warnings||[])" :key="w" class="ap-warn">⚠ {{ w }}</div>
      <div v-if="autoPeriodPreview.suggestion && autoPeriodPreview.suggestion.better" class="ap-warn ap-warn-tip">
        首次报单日建议改为 <b>{{ autoPeriodPreview.suggestion.suggested }}</b>
        （可避免 {{ autoPeriodPreview.suggestion.current_missed }} 次漏报）
        <button type="button" class="ap-adopt" @click="$emit('adopt')">采纳</button>
      </div>
      <table class="ap-tbl">
        <thead><tr><th>报单日</th><th>开放→关单</th><th>到货</th><th>本期应报</th></tr></thead>
        <tbody>
          <tr v-for="p in autoPeriodPreview.preview" :key="p.order_date">
            <td>{{ p.order_date }}</td>
            <td class="ap-dim">{{ p.open_date }} {{ (autoPeriodPreview.times&&autoPeriodPreview.times.open)||'' }} → {{ (autoPeriodPreview.times&&autoPeriodPreview.times.close)||'' }}</td>
            <td>{{ p.arrival_date }}</td>
            <td>
              <span v-for="b in p.brand_detail" :key="b.name" class="ap-brand">{{ b.name }}<i v-if="b.early_days"> 提前{{ b.early_days }}天</i></span>
              <span v-if="!p.brand_detail.length" class="ap-dim">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="(autoPeriodPreview.missed||[]).length" class="ap-warn">
        会漏报 {{ autoPeriodPreview.missed.length }} 次：{{ apMissedSummary }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { WEEKDAY_OPTIONS, fmtWan } from './useRebateTargetForm.js'

defineProps({
  form: { type: Object, required: true },
  arrivalPreview: { type: Object, default: null },
  autoPeriodPreview: { type: Object, default: null },
  apMissedSummary: { type: String, default: '' },
  firstArrivalDate: { type: String, default: '' },
  arrivalWeekday: { type: String, default: '' },
  leadErr: { type: String, default: '' },
  leadValid: { type: Boolean, default: false },
  /** 判断某星期是否已选（状态在父层，传函数进来避免拷贝 form 引用） */
  isOrderWk: { type: Function, required: true },
})
defineEmits(['lead-input', 'arrival-change', 'toggle-wk', 'adopt', 'open-migrate'])

const weekdayOptions = WEEKDAY_OPTIONS
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
.ap-derive{margin:2px 0 0;font-size:12px;color:var(--p-dark);background:rgba(6,182,212,.08);border-radius:6px;padding:6px 8px}
.ap-preview{margin-top:10px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px;background:var(--bg2)}
.ap-head{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--t3);margin-bottom:8px}
.ap-warn{font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5}
.ap-warn-tip{color:var(--p-dark)}
.ap-adopt{margin-left:8px;border:1px solid var(--p);background:transparent;color:var(--p-dark);border-radius:6px;padding:1px 10px;font-size:12px;cursor:pointer}
.ap-adopt:hover{background:var(--p);color:#fff}
.ap-tbl{width:100%;border-collapse:collapse;font-size:12px}
.ap-tbl th{text-align:left;color:var(--t3);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--border-subtle)}
.ap-tbl td{padding:5px 6px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
.ap-dim{color:var(--t3);font-size:11px}
.ap-brand{display:inline-block;background:rgba(6,182,212,.12);color:var(--p-dark);border-radius:4px;padding:1px 6px;margin:1px 4px 1px 0;font-size:11px}
.ap-brand i{font-style:normal;opacity:.7;margin-left:2px}
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0}
@media(max-width:768px){ .form-grid2,.form-grid3{grid-template-columns:1fr} }
</style>
