<template>
  <div class="page">
    <div class="page-hd">
      <h2>算工资工作流</h2>
      <span class="page-sub">配算法 → 一键算工资 → 核对并确认</span>
    </div>

    <!-- 步骤指示器 -->
    <div class="pr-steps">
      <div class="pr-step" :class="{ on: step >= 1 }">① 配算法</div>
      <span class="pr-arrow">→</span>
      <div class="pr-step" :class="{ on: step >= 2 }">② 算工资</div>
      <span class="pr-arrow">→</span>
      <div class="pr-step" :class="{ on: step >= 3 }">③ 核对确认</div>
    </div>

    <!-- 步骤 1：配方表单 -->
    <div v-if="step === 1" class="card pr-panel">
      <div class="panel-hd">
        <b>我的工资算法</b>
        <span class="badge badge-blue">配方快照 · 可复制给同行业客户</span>
      </div>
      <p class="pr-tip">没有技术参数，只有你熟悉的业务问题。员工档案里写了工资的，优先用档案；没写的用下面的兜底值。</p>

      <div class="pr-form">
        <div class="pr-grid">
          <label class="pr-field">
            <span class="pr-label">计算月份 <em>默认当月</em></span>
            <input v-model="form.month" class="input" type="month">
          </label>

          <label class="pr-field">
            <span class="pr-label">基本工资（兜底） <em>员工档案无工资时用</em></span>
            <div class="pr-input-suffix">
              <input v-model.number="form.base_salary" class="input" type="number" min="0">
              <span class="pr-suffix">元</span>
            </div>
          </label>
        </div>

        <div class="pr-grid">
          <label class="pr-field">
            <span class="pr-label">提成比例 <em>按当月已交付销售额 × 比例</em></span>
            <div class="pr-input-suffix">
              <input v-model.number="form.commission_rate" class="input" type="number" min="0" max="100" step="0.1">
              <span class="pr-suffix">%</span>
            </div>
          </label>

          <label class="pr-field">
            <span class="pr-label">绩效工资 <em>全员统一，可按人后续微调</em></span>
            <div class="pr-input-suffix">
              <input v-model.number="form.performance" class="input" type="number" min="0">
              <span class="pr-suffix">元</span>
            </div>
          </label>
        </div>

        <div class="pr-grid">
          <label class="pr-field">
            <span class="pr-label">奖金</span>
            <div class="pr-input-suffix">
              <input v-model.number="form.bonus" class="input" type="number" min="0">
              <span class="pr-suffix">元</span>
            </div>
          </label>

          <label class="pr-field">
            <span class="pr-label">津贴</span>
            <div class="pr-input-suffix">
              <input v-model.number="form.allowance" class="input" type="number" min="0">
              <span class="pr-suffix">元</span>
            </div>
          </label>
        </div>

        <div class="pr-grid">
          <label class="pr-field">
            <span class="pr-label">其他扣款 <em>如缺勤/罚款</em></span>
            <div class="pr-input-suffix">
              <input v-model.number="form.deduction_other" class="input" type="number" min="0">
              <span class="pr-suffix">元</span>
            </div>
          </label>

          <label class="pr-field">
            <span class="pr-label">个税起征点 <em>默认 5000</em></span>
            <div class="pr-input-suffix">
              <input v-model.number="form.tax_standard_deduction" class="input" type="number" min="0">
              <span class="pr-suffix">元</span>
            </div>
          </label>
        </div>
      </div>

      <div class="pr-actions">
        <button class="btn btn-ghost" @click="saveRecipe">保存配方</button>
        <button class="btn btn-primary" :disabled="running" @click="runAndShow">
          {{ running ? '计算中…' : '保存并算工资 →' }}
        </button>
      </div>
    </div>

    <!-- 步骤 2/3：结果 -->
    <div v-else class="pr-result-wrap">
      <!-- 概要 -->
      <div class="pr-summary">
        <div class="card pr-kpi pr-kpi-total">
          <div class="pr-kpi-label">应发合计</div>
          <div class="pr-kpi-val">¥{{ fmt(result.summary?.total_gross) }}</div>
          <div class="pr-kpi-sub">{{ result.employees }} 人 · {{ result.month }}</div>
        </div>
        <div class="card pr-kpi">
          <div class="pr-kpi-label">实发合计</div>
          <div class="pr-kpi-val">¥{{ fmt(result.summary?.total_net) }}</div>
          <div class="pr-kpi-sub">提成 ¥{{ fmt(result.summary?.total_commission) }}</div>
        </div>
        <div class="card pr-kpi">
          <div class="pr-kpi-label">个税合计</div>
          <div class="pr-kpi-val val-warn">¥{{ fmt(result.summary?.total_tax) }}</div>
          <div class="pr-kpi-sub">起征点 ¥{{ fmt(result.recipe?.tax_standard_deduction) }}</div>
        </div>
        <div class="card pr-kpi">
          <div class="pr-kpi-label">雇主总成本</div>
          <div class="pr-kpi-val val-bad">¥{{ fmt(result.summary?.total_employer_cost) }}</div>
          <div class="pr-kpi-sub">含单位社保公积金</div>
        </div>
      </div>

      <!-- 员工明细 -->
      <div class="card pr-panel">
        <div class="panel-hd">
          <b>员工工资明细</b>
          <span class="tag info">{{ result.results?.length || 0 }} 人</span>
        </div>
        <div v-if="result.results?.length" class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>员工</th><th class="num">基本工资</th><th class="num">提成</th><th class="num">绩效</th>
              <th class="num">应发</th><th class="num">社保</th><th class="num">个税</th><th class="num">实发</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.results" :key="r.employee_id || i">
                <td>{{ r.employee_name }}</td>
                <td class="num">¥{{ fmt(r.breakdown?.base_salary) }}</td>
                <td class="num">¥{{ fmt(r.breakdown?.commission) }}</td>
                <td class="num">¥{{ fmt(r.breakdown?.performance) }}</td>
                <td class="num">¥{{ fmt(r.gross_salary) }}</td>
                <td class="num">¥{{ fmt(r.deductions_employee?.total_social_ee) }}</td>
                <td class="num">¥{{ fmt(r.tax_amount) }}</td>
                <td class="num pr-net">¥{{ fmt(r.net_salary) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">
          <p>{{ result.note || '暂无数据' }}</p>
        </div>
      </div>

      <div class="pr-actions" style="justify-content:space-between">
        <button class="btn btn-ghost" @click="backToConfig">← 改算法再算</button>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="pr-footnote">AI 只算不执行，核对无误再确认</span>
          <button class="btn btn-primary" :disabled="!result.results?.length" @click="confirmMonth">确认本月工资（写入台账）</button>
        </div>
      </div>
      <div v-if="confirmed" class="pr-confirm-ok">✅ {{ confirmed }} 人已确认，已生成工资台账与银行文件数据</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { toast } from '../store'
import { payrollApi } from '../api/modules'

const step = ref(1)
const running = ref(false)
const result = ref(null)
const confirmed = ref('')

const nowMonth = new Date().toISOString().slice(0, 7)

const form = reactive({
  name: '我的工资算法',
  month: nowMonth,
  base_salary: 5000,
  commission_rate: 0,
  performance: 0,
  bonus: 0,
  allowance: 0,
  deduction_other: 0,
  tax_standard_deduction: 5000,
})

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

async function saveRecipe() {
  try {
    await payrollApi.saveRecipe({
      name: form.name,
      base_salary: form.base_salary,
      commission_rate: form.commission_rate,
      performance: form.performance,
      bonus: form.bonus,
      allowance: form.allowance,
      deduction_other: form.deduction_other,
      tax_standard_deduction: form.tax_standard_deduction,
    })
    toast('配方已保存', 'ok')
    return true
  } catch (e) {
    toast(e.message || '保存失败', 'err')
    return false
  }
}

async function runAndShow() {
  running.value = true
  try {
    const saved = await saveRecipe()
    const res = await payrollApi.run({ month: form.month })
    result.value = res
    step.value = 2
    confirmed.value = ''
    if (res.employees > 0) toast('已为 ' + res.employees + ' 人计算工资（草稿，待确认）', 'ok')
    else toast(res.note || '计算完成', 'info')
  } catch (e) {
    toast(e.message || '计算失败', 'err')
  } finally {
    running.value = false
  }
}

async function confirmMonth() {
  try {
    // 复用后端现有 payroll/confirm：将 draft 明细置为 confirmed 并生成台账/银行文件
    const res = await payrollApi.confirm(form.month)
    confirmed.value = String(res.confirmed ?? 0)
    toast('工资已确认', 'ok')
  } catch (e) {
    toast(e.message || '确认失败', 'err')
  }
}

function backToConfig() {
  step.value = 1
}

onMounted(async () => {
  try {
    const r = await payrollApi.getRecipe()
    Object.assign(form, {
      name: r.recipe?.name || '我的工资算法',
      base_salary: r.recipe?.base_salary ?? 5000,
      commission_rate: r.recipe?.commission_rate ?? 0,
      performance: r.recipe?.performance ?? 0,
      bonus: r.recipe?.bonus ?? 0,
      allowance: r.recipe?.allowance ?? 0,
      deduction_other: r.recipe?.deduction_other ?? 0,
      tax_standard_deduction: r.recipe?.tax_standard_deduction ?? 5000,
    })
  } catch (e) { /* 用默认 */ }
})
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.pr-steps{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.pr-step{font-size:13px;color:var(--t3);padding:6px 14px;border-radius:16px;background:var(--bg2);border:1px solid var(--border-subtle)}
.pr-step.on{background:var(--p-bg);color:var(--p-dark);border-color:var(--p);font-weight:500}
.pr-arrow{color:var(--t3);font-size:12px}

.pr-panel{padding:20px}
.pr-tip{font-size:12.5px;color:var(--t2);margin:4px 0 16px;line-height:1.6}
.pr-form{display:flex;flex-direction:column;gap:18px}
.pr-field{display:flex;flex-direction:column;gap:8px}
.pr-label{font-size:13px;font-weight:500;color:var(--t1)}
.pr-label em{font-style:normal;font-size:12px;color:var(--t3);font-weight:400;margin-left:8px}
.pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pr-input-suffix{position:relative;display:flex;align-items:center}
.pr-input-suffix .input{padding-right:44px}
.pr-suffix{position:absolute;right:14px;font-size:13px;color:var(--t3)}
.pr-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}

.pr-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
.pr-kpi{padding:16px 18px}
.pr-kpi-total{border-color:var(--p);background:linear-gradient(180deg,var(--p-bg),transparent 130%)}
.pr-kpi-label{font-size:12px;color:var(--t3);margin-bottom:6px}
.pr-kpi-val{font-size:22px;font-weight:600;margin-bottom:4px;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.pr-kpi-val.val-warn{color:var(--war)}
.pr-kpi-val.val-bad{color:var(--dan)}
.pr-kpi-sub{font-size:11.5px;color:var(--t3)}
.pr-net{font-weight:600;color:var(--t1)}
.pr-footnote{font-size:12px;color:var(--t3)}
.pr-confirm-ok{margin-top:14px;padding:12px 16px;border-radius:10px;background:rgba(var(--suc-rgb),.1);color:var(--suc);font-size:13px;font-weight:500}

@media(max-width:768px){
  .pr-grid{grid-template-columns:1fr}
  .pr-summary{grid-template-columns:repeat(2,1fr)}
}
</style>
