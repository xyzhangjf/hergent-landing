<template>
  <!-- 返利形式 / 返利值：v126 统一月表下由各月返利率承载，故整体隐藏 -->
  <div class="form-grid2" v-if="visible && !tiersOnly">
    <div class="form-row"><label>返利形式</label>
      <select v-model="form.rebate_basis" class="input">
        <option value="rate">比例</option>
        <option value="fixed">固定金额</option>
      </select>
    </div>
    <div class="form-row" v-if="form.trigger_mode !== 'tiered'"><label>返利值</label>
      <input v-if="form.rebate_basis==='rate'" v-model.number="form.rebate_rate" class="input" type="number" min="0" max="1" step="0.01" placeholder="0.02 = 2%">
      <input v-else v-model.number="form.rebate_amount" class="input" type="number" min="0" placeholder="固定金额">
    </div>
  </div>

  <!-- 阶梯档位编辑器（达成率分档）。v126：ruleTiers 可以是「某一个月」的档位数组 -->
  <div v-if="form.trigger_mode === 'tiered' && (visible || tiersOnly)" class="tier-editor">
    <div class="te-hd" style="display:flex;align-items:center;justify-content:space-between;margin:10px 0 6px">
      <b>{{ title }}</b>
      <button class="btn btn-ghost btn-sm" type="button" @click="$emit('add-tier')">+ 加一档</button>
    </div>
    <p class="cf-tip">按<b>达成率（占目标值比例）</b>分档：达成 90% 落入 90%~100% 档、100% 落入 100%~∞ 档。返利比例填小数（<b>0.1 = 10%</b>）；固定金额填元。末档「结束达成率」填 <b>0</b> 表示无上限。</p>
    <table class="dt-tier" style="margin-top:8px">
      <thead><tr><th>起始达成率 %</th><th>结束达成率 %（0=以上）</th>
        <th v-if="form.rebate_basis==='rate'">返利比例（小数）</th>
        <th v-else>固定金额（元）</th><th></th></tr></thead>
      <tbody>
        <tr v-for="(t,i) in ruleTiers" :key="i">
          <td><input v-model.number="t.from_pct" class="input cc-ti" type="number" min="0" max="100" step="1" placeholder="90"></td>
          <td><input v-model.number="t.to_pct" class="input cc-ti" type="number" min="0" max="300" step="1" placeholder="100 / 0=以上"></td>
          <td v-if="form.rebate_basis==='rate'"><input v-model.number="t.rebate_rate" class="input cc-ti" type="number" min="0" max="1" step="0.01" placeholder="0.1 = 10%"></td>
          <td v-else><input v-model.number="t.rebate_amount" class="input cc-ti" type="number" min="0" step="1" placeholder="固定金额"></td>
          <td><button class="btn btn-ghost btn-xs danger" type="button" @click="$emit('remove-tier', i)">删除</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!ruleTiers.length" class="cf-tip" style="color:var(--dan)">请至少添加一档，否则无法保存（阶梯模式必须配置档位）。</p>
  </div>
</template>

<script setup>
/**
 * 返利形式 + 返利值 + 阶梯档位表
 * 品牌年度（12 月分解）模式不需要 —— 由 monthlyOn 控制隐藏
 */
defineProps({
  form: { type: Object, required: true },
  ruleTiers: { type: Array, required: true },
  scaleOptions: { type: Array, default: () => [] },
  /** 品牌年度月度分解模式下为 false（返利由各月返利率承载） */
  visible: { type: Boolean, default: true },
  /** v126：只渲染档位表（供月表里「某个月的档位编辑」内联复用） */
  tiersOnly: { type: Boolean, default: false },
  /** 档位区标题（月表内联时显示「X 月档位」，顶层显示「默认档位」） */
  title: { type: String, default: '阶梯档位（按达成率）' },
})
defineEmits(['add-tier', 'remove-tier'])
</script>

<style scoped>
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.dt-tier{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
.dt-tier th,.dt-tier td{border:1px solid var(--border-subtle);padding:6px 8px;text-align:left}
.cc-ti{width:90px;padding:3px 6px;font-size:12px}
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0}
@media(max-width:768px){ .form-grid2{grid-template-columns:1fr} }
</style>
