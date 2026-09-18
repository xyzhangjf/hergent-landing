/**
 * v186 生效期口径「前后端一致性」检查（纯函数，不连库、不启浏览器）
 *
 * 背景：生效期门禁此前在前后端各写了 5 份，口径分叉就出现同屏自相矛盾
 * （图表不画柱、合计却算进去；品牌候选与图表错配）。
 * v186 收敛为：
 *   后端 domain/rebate_period.rule_covers_month / covered_months
 *   前端 components/rebate/useMonthlyAchv.ruleCoversMonth
 * 本脚本把**同一批断言**跑在前端实现上，与
 *   server/tests/test_rebate_period_v186.py（后端实现）
 * 逐条对应。任一侧漂移，另一侧的对应用例会立刻对不上。
 *
 * 用法：node .workbuddy/tools/rebate-rule-covers-month-check.mjs
 */
import {
  ruleCoversMonth, ruleYear, monthTargetOf,
} from '../../hergent-cn-v2/src/components/rebate/useMonthlyAchv.js'

const fails = []
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails.push(`  ✗ ${label}: 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

// 真实事故数据（tenant_1 规则 10）：12 个月分解齐全，生效期只写了 2026-09
const RULE10 = {
  id: 10, dimension: 'brand', scope_key: '蒙牛低温', period_type: 'year',
  target_year: 2026, target_value: 8684000, rebate_rate: 0.1, is_active: 1,
  monthly_amounts: {
    '01': 600000, '02': 500000, '03': 600000, '04': 700000, '05': 800000, '06': 900000,
    '07': 900000, '08': 950000, '09': 674000, '10': 700000, '11': 760000, '12': 600000,
  },
  monthly_rates: { '09': 0.1, '10': 0.15 },
  effective_start: '2026-09-01', effective_end: '2026-09-30',
}

// 1. 年度规则：12 个月分解 ⇒ 12 个月全部适用（生效期不再砍月份）
eq('规则10 覆盖月份数',
  Array.from({ length: 12 }, (_, i) => ruleCoversMonth(RULE10, 2026, i + 1)).filter(Boolean).length, 12)
eq('规则10 覆盖 2026-08', ruleCoversMonth(RULE10, 2026, 8), true)
eq('规则10 覆盖 2026-01', ruleCoversMonth(RULE10, 2026, 1), true)
eq('规则10 覆盖 2026-12', ruleCoversMonth(RULE10, 2026, 12), true)
eq('规则10 不覆盖 2025-08（年份对齐）', ruleCoversMonth(RULE10, 2025, 8), false)
eq('规则10 不覆盖 2027-08（年份对齐）', ruleCoversMonth(RULE10, 2027, 8), false)

// 2. 有分解 ⇒ 只认分解的键
const partial = { ...RULE10, monthly_amounts: { '09': 80000 }, target_value: 80000 }
eq('部分分解 覆盖 09', ruleCoversMonth(partial, 2026, 9), true)
eq('部分分解 不覆盖 08', ruleCoversMonth(partial, 2026, 8), false)
eq('部分分解 不覆盖 10', ruleCoversMonth(partial, 2026, 10), false)

// 3. 无分解的年度规则：仍按生效期（放行 12 个月会把年度总额当每月目标）
const noMa = { period_type: 'year', target_year: 2026, target_value: 12000000, is_active: 1,
              monthly_amounts: '', effective_start: '2026-09-01', effective_end: '2026-09-30' }
eq('无分解年度规则 覆盖 09', ruleCoversMonth(noMa, 2026, 9), true)
eq('无分解年度规则 不覆盖 08', ruleCoversMonth(noMa, 2026, 8), false)
eq('无分解年度规则 不覆盖 10', ruleCoversMonth(noMa, 2026, 10), false)

// 4. 单期规则（无分解）：按生效期
const monthRule = { period_type: 'month', monthly_amounts: '', target_value: 650000, is_active: 1,
                    effective_start: '2026-08-01', effective_end: '2026-08-31' }
eq('单期规则 覆盖 08', ruleCoversMonth(monthRule, 2026, 8), true)
eq('单期规则 不覆盖 07', ruleCoversMonth(monthRule, 2026, 7), false)
eq('单期规则 不覆盖 09', ruleCoversMonth(monthRule, 2026, 9), false)
eq('单期规则 无生效期 ⇒ 常年适用', ruleCoversMonth(
  { period_type: 'month', monthly_amounts: '', target_value: 1, is_active: 1 }, 2026, 8), true)

// 5. 停用规则一律不适用；非法入参不适用
eq('停用规则不适用', ruleCoversMonth({ ...RULE10, is_active: 0 }, 2026, 8), false)
eq('空规则不适用', ruleCoversMonth(null, 2026, 8), false)
eq('非法月份不适用', ruleCoversMonth(RULE10, 2026, 13), false)
eq('非法月份 0 不适用', ruleCoversMonth(RULE10, 2026, 0), false)
eq('字符串年月入参可用', ruleCoversMonth(RULE10, '2026', '08'), true)

// 6. 0 值月：键存在 ⇒ "有目标可言"（与后端 covered_months 同口径），
//    但下游 monthTargetOf 返回 0 ⇒ 图表不画、后端 monthly_view 也取到 0（两侧一致）。
const zeroMonth = { ...RULE10, monthly_amounts: { '08': 0, '09': 674000 } }
eq('0 值月 键存在 ⇒ 覆盖', ruleCoversMonth(zeroMonth, 2026, 8), true)
eq('0 值月 monthTargetOf = 0（下游拦截）', monthTargetOf(zeroMonth, 2026, 8), 0)
eq('0 值月 未配置月 ⇒ 不覆盖', ruleCoversMonth(zeroMonth, 2026, 7), false)

// 7. 与图表消费方的组合判据：候选条件 = ruleCoversMonth && monthTargetOf > 0
const covers = (r, y, m) => ruleCoversMonth(r, y, m) && monthTargetOf(r, y, m) > 0
eq('组合判据：规则10 8 月可画柱', covers(RULE10, 2026, 8), true)
eq('组合判据：规则10 12 月可画柱', covers(RULE10, 2026, 12), true)
eq('组合判据：0 值月不画柱', covers(zeroMonth, 2026, 8), false)
eq('组合判据：无分解年度规则 8 月不画柱', covers(noMa, 2026, 8), false)
eq('组合判据：单期规则 8 月可画柱', covers(monthRule, 2026, 8), true)
eq('组合判据：单期规则 9 月不画柱', covers(monthRule, 2026, 9), false)

// 8. ruleYear 与后端 rule_year 同口径
eq('ruleYear 优先 target_year', ruleYear(RULE10), 2026)
eq('ruleYear 退回生效期年份', ruleYear({ target_year: null, effective_start: '2025-03-01' }), 2025)
eq('ruleYear 都没有 ⇒ 当年', ruleYear({}), new Date().getFullYear())

if (fails.length) {
  console.log('v186 前端口径检查：%d 项不通过', fails.length)
  console.log(fails.join('\n'))
  process.exit(1)
}
console.log('v186 前端口径检查：全部通过（与后端 test_rebate_period_v186.py 同批断言）')
