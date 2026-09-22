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

    <!-- v242：「③ 报单自动化」已迁至「预报订单 → 报单配置」。
         它管的是**期次开闭**（预报订单模块的核心对象），且后端限定「租户内同一时间
         只能一个品牌开启」⇒ 属**租户级运行参数**，不属品牌目标。本块只保留
         ① 节奏 / ② 到货产出（这两项确实是品牌方排产节点）。 -->
    <div class="ap-moved">报单自动化（到点自动建表 / 关单）已移至
      <a href="#/forecast">预报订单 → 报单配置</a></div>
  </div>
</template>

<script setup>
import { WEEKDAY_OPTIONS, fmtWan } from './useRebateTargetForm.js'

defineProps({
  form: { type: Object, required: true },
  arrivalPreview: { type: Object, default: null },
  firstArrivalDate: { type: String, default: '' },
  arrivalWeekday: { type: String, default: '' },
  leadErr: { type: String, default: '' },
  leadValid: { type: Boolean, default: false },
  /** 判断某星期是否已选（状态在父层，传函数进来避免拷贝 form 引用） */
  isOrderWk: { type: Function, required: true },
})
defineEmits(['lead-input', 'arrival-change', 'toggle-wk', 'open-migrate'])

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
.ap-moved{margin:8px 0 0;font-size:12px;color:var(--t3);line-height:1.6}
.ap-moved a{color:var(--p-dark);text-decoration:none;border-bottom:1px dashed var(--p)}
.ap-derive{margin:2px 0 0;font-size:12px;color:var(--p-dark);background:rgba(6,182,212,.08);border-radius:6px;padding:6px 8px}
.ap-warn{font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5}
.ap-adopt{margin-left:8px;border:1px solid var(--p);background:transparent;color:var(--p-dark);border-radius:6px;padding:1px 10px;font-size:12px;cursor:pointer}
.ap-adopt:hover{background:var(--p);color:#fff}
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0}
@media(max-width:768px){ .form-grid2,.form-grid3{grid-template-columns:1fr} }
</style>
