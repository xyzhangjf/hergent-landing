<template>
  <!-- v126 统一月表：年度与单期只是「填了 12 格还是 1 格」，底层同一张表 -->
  <div class="form-grid3" style="margin-top:8px">
    <div class="form-row"><label>目标年度</label>
      <input v-model.number="form.target_year" class="input" type="number" min="2000" max="2100" step="1" placeholder="如 2026">
    </div>
    <div class="form-row"><label>全年目标<span class="ap-sec-note">铺 12 个月</span></label>
      <div class="input-affix">
        <input :value="annualTarget" class="input" type="number" min="0" step="0.1"
               placeholder="填全年，自动均分" @input="$emit('update:annualTarget', $event.target.value)">
        <span class="affix">万元</span>
      </div>
    </div>
    <div class="form-row"><label>全年返利率<span class="ap-sec-note">铺 12 个月</span></label>
      <div class="input-affix">
        <input :value="annualRate" class="input" type="number" min="0" max="100" step="0.1"
               :placeholder="annualRatePlaceholder" @input="$emit('update:annualRate', $event.target.value)">
        <span class="affix">%</span>
      </div>
    </div>
  </div>

  <div class="monthly-grid" style="margin-top:8px">
    <div class="monthly-grid-hd" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <span class="page-sub">金额 <b>万元</b>、返利率 <b>%</b>（10 = 10%）；留空 = 该月无目标</span>
      <span style="flex:1"></span>
      <span class="page-sub">已填 <b>{{ filledCount }}</b> 个月 · 合计 <b>{{ sumWan }}</b> 万元</span>
      <button type="button" class="btn btn-ghost btn-xs" @click="$emit('clear')">清空</button>
    </div>
    <table class="dt-tier">
      <thead>
        <tr>
          <th>月份</th>
          <th>目标金额（万元）</th>
          <th v-if="form.trigger_mode !== 'tiered'">返利率（%）</th>
          <th v-else>阶梯档位（按月独立配）</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="m in rows" :key="m.mm">
          <tr :class="{ 'mg-open': openMm === m.mm }">
            <td style="white-space:nowrap">{{ m.mm }} 月</td>
            <td><input v-model.number="m.amtWan" class="input cc-ti" type="number" min="0" step="0.1" placeholder="0"></td>
            <td v-if="form.trigger_mode !== 'tiered'">
              <input v-model.number="m.ratePct" class="input cc-ti" type="number" min="0" max="100" step="0.1" placeholder="如 10">
            </td>
            <td v-else>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="mg-tier-txt" :class="{ 'is-empty': !tierText(m.tiers, form.rebate_basis) }">
                  {{ tierText(m.tiers, form.rebate_basis) || '未配置' }}
                </span>
                <span style="flex:1"></span>
                <button type="button" class="btn btn-ghost btn-xs" @click="toggle(m.mm)">
                  {{ openMm === m.mm ? '收起' : '配置' }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="form.trigger_mode === 'tiered' && openMm === m.mm" :key="m.mm + '-tier'">
            <td colspan="3" class="mg-tier-cell">
              <RebateValueBlock :form="form" :rule-tiers="m.tiers" :scale-options="scaleOptions"
                                :title="m.mm + ' 月档位（留空则回退默认档位）'" tiers-only
                                @add-tier="$emit('add-tier', m.mm)" @remove-tier="$emit('remove-tier', { mm: m.mm, i: $event })" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <div style="margin-top:8px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--bd);padding-top:8px">
    <span class="page-sub" style="flex:0 0 auto">触发方式</span>
    <select v-model="form.trigger_mode" class="input" style="width:auto">
      <option value="on_target">达成即返（按月返利率）</option>
      <option value="tiered">阶梯返利（按月分档）</option>
    </select>
    <select v-if="form.trigger_mode === 'tiered'" v-model="form.scale_type" class="input" style="width:auto">
      <option v-for="s in scaleOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
    </select>
    <span class="page-sub" style="flex:1;min-width:220px">
      {{ form.trigger_mode === 'tiered'
        ? '每个月可以配一套自己的档位；未配的月份回退到「默认档位」。'
        : '每月填自己的返利率，这个月 10%、下个月 8% 各自生效。' }}
    </span>
  </div>
</template>

<script setup>
/**
 * v126 统一月表（品牌目标唯一录入形态）
 *
 * 「年度」与「单期」不再是两种口径：年度 = 铺满 12 格，单期 = 只填 1 格。
 * 顶部「全年目标 / 全年返利率」只是快捷铺开工具，铺完仍可逐月改。
 * 阶梯模式下档位下沉到月 —— 点「配置」展开该月档位编辑。
 *
 * rows 由父层持有，这里就地编辑（月度行是表单状态的一部分，不做二次拷贝）
 */
import { ref } from 'vue'
import RebateValueBlock from './RebateValueBlock.vue'
import { tierText } from './useRebateTargetForm.js'

defineProps({
  form: { type: Object, required: true },
  rows: { type: Array, required: true },
  sumWan: { type: [Number, String], default: 0 },
  annualTarget: { type: [Number, String], default: '' },
  annualRate: { type: [Number, String], default: '' },
  annualRatePlaceholder: { type: String, default: '如 10' },
  filledCount: { type: Number, default: 0 },
  scaleOptions: { type: Array, default: () => [] },
})
defineEmits(['update:annualTarget', 'update:annualRate', 'clear', 'add-tier', 'remove-tier'])

const openMm = ref('')
function toggle(mm) { openMm.value = openMm.value === mm ? '' : mm }
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
.mg-open{background:rgba(var(--p-rgb),.06)}
.mg-tier-txt{font-size:12px;color:var(--t1)}
.mg-tier-txt.is-empty{color:var(--t3)}
.mg-tier-cell{background:var(--bg);padding:8px 10px}
.ap-sec-note{font-weight:400;font-size:11.5px;color:var(--t3);margin-left:4px}
@media(max-width:768px){ .form-grid3{grid-template-columns:1fr} }
</style>
