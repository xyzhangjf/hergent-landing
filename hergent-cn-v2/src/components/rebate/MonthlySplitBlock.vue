<template>
  <!-- 年度模式：目标年度 + 全年目标 + 全年返利率 + 12 月表 -->
  <div class="form-grid3" style="margin-top:8px">
    <div class="form-row"><label>目标年度</label>
      <input v-model.number="form.target_year" class="input" type="number" min="2000" max="2100" step="1" placeholder="如 2026">
    </div>
    <div class="form-row"><label>全年目标</label>
      <div class="input-affix">
        <input :value="annualTarget" class="input" type="number" min="0" step="0.1"
               placeholder="填全年，自动均分到 12 个月" @input="$emit('update:annualTarget', $event.target.value)">
        <span class="affix">万元</span>
      </div>
    </div>
    <div class="form-row"><label>全年返利率</label>
      <div class="input-affix">
        <input :value="annualRate" class="input" type="number" min="0" max="100" step="0.1"
               :placeholder="annualRatePlaceholder" @input="$emit('update:annualRate', $event.target.value)">
        <span class="affix">%</span>
      </div>
    </div>
  </div>

  <div class="monthly-grid" style="margin-top:8px">
    <div class="monthly-grid-hd" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <span class="page-sub">单月微调：金额单位 <b>万元</b>、返利率 <b>%</b>（如 10 = 10%）；留空 = 该月无目标 / 继承上月</span>
      <span style="flex:1"></span>
      <span class="page-sub">已填 <b>{{ filledCount }}</b> 个月 · 合计 <b>{{ sumWan }}</b> 万元</span>
      <button type="button" class="btn btn-ghost btn-xs" @click="$emit('clear')">清空</button>
    </div>
    <table class="dt-tier">
      <thead><tr><th>月份</th><th>目标金额（万元）</th><th>返利率（%）</th></tr></thead>
      <tbody>
        <tr v-for="m in rows" :key="m.mm">
          <td style="white-space:nowrap">{{ m.mm }} 月</td>
          <td><input v-model.number="m.amtWan" class="input cc-ti" type="number" min="0" step="0.1" placeholder="0"></td>
          <td><input v-model.number="m.ratePct" class="input cc-ti" type="number" min="0" max="100" step="0.1" placeholder="如 10"></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- v121c：触发方式整合进本区 —— 按月分解按各月返利率直接计返，与「按全年达成率分档」的阶梯不并存 -->
  <div style="margin-top:8px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--bd);padding-top:8px">
    <span class="page-sub" style="flex:0 0 auto">触发方式</span>
    <b>达成即返（按月返利率）</b>
    <span class="page-sub" style="flex:1;min-width:220px">本月 10%、下月 8% 各自生效；阶梯返利是按全年达成率分档，与该模式不并存，所以这里固定为达成即返。</span>
  </div>
</template>

<script setup>
/**
 * 12 个月分解（品牌目标 · 年度模式独占）
 * rows 由父层持有，这里就地编辑（月度行是表单状态的一部分，不做二次拷贝）
 */
defineProps({
  form: { type: Object, required: true },
  rows: { type: Array, required: true },
  sumWan: { type: [Number, String], default: 0 },
  annualTarget: { type: [Number, String], default: '' },
  annualRate: { type: [Number, String], default: '' },
  annualRatePlaceholder: { type: String, default: '如 10' },
  filledCount: { type: Number, default: 0 },
  legacyNotice: { type: String, default: '' },
})
defineEmits(['update:annualTarget', 'update:annualRate', 'clear'])
</script>

<style scoped>
.form-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.input-affix{display:flex;align-items:center;gap:6px}
.input-affix .input{flex:1}
.input-affix .affix{font-size:12px;color:var(--t3);white-space:nowrap}
.dt-tier{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
.dt-tier th,.dt-tier td{border:1px solid var(--border-subtle);padding:6px 8px;text-align:left}
.cc-ti{width:90px;padding:3px 6px;font-size:12px}
@media(max-width:768px){ .form-grid3{grid-template-columns:1fr} }
</style>
