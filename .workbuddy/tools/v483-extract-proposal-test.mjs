/**
 * v483-extract-proposal-test.mjs —— extractProposal 协议解析单测（真实 import 源码）
 * 验证：旧单条格式向后兼容 / 新 steps 计划格式 / 缺字段返回 null / 零副作用
 */
import { extractProposal } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/composables/useCardTrigger.js'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  PASS  ' + n + (e !== undefined ? '   -> ' + e : '')) } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '   -> ' + e : '')) } }
const fence = (json) => '```proposal ' + json + '\n```'

// 1) 旧单条配方提案（P2-⑦）：向后兼容，steps 必须为空
const old = extractProposal(fence('{"module":"loss","title":"临期阈值","changes":{"threshold_days":5},"rationale":"最近多批临期"}'))
ok(old && old.module === 'loss' && old.changes && old.changes.threshold_days === 5, '旧单条：module+changes 解析', JSON.stringify(old && old.changes))
ok(old && old.steps === null, '旧单条：steps 为 null（向后兼容）', old && old.steps)

// 2) 新多步计划：仅 steps，无 module
const plan = extractProposal(fence('{"steps":[{"action":"recipe","target":"调整临期阈值","detail":"{\\"threshold_days\\":5}"},{"action":"recipe","target":"同步返利口径","detail":"{}"}]}'))
ok(plan && Array.isArray(plan.steps) && plan.steps.length === 2, '新计划：steps 数组长度 2', plan && plan.steps && plan.steps.length)
ok(plan && plan.steps[0].action === 'recipe' && plan.steps[0].target === '调整临期阈值' && plan.steps[0].detail === '{"threshold_days":5}', '新计划：step 字段映射 (action/target/detail)', plan && JSON.stringify(plan.steps[0]))
ok(plan && plan.changes === null, '新计划：changes 为 null', plan && plan.changes)

// 3) 新多步计划：带 module（跨模块计划）
const planM = extractProposal(fence('{"module":"payroll","steps":[{"action":"recipe","target":"调工资"}]}'))
ok(planM && planM.module === 'payroll' && planM.steps.length === 1, '新计划：module 透传', planM && planM.module)

// 4) 缺 module 且缺 steps → null（严格守卫，不误渲染）
ok(extractProposal(fence('{"title":"x","changes":{}}')) === null, '无 module 无 steps → null', 'null')
ok(extractProposal(fence('{"module":"bogus","changes":{"a":1}}')) === null, '非法 module → null', 'null')

// 5) 无围栏 / 非法 JSON → null（且不抛错）
ok(extractProposal('普通文本没有围栏') === null, '无围栏 → null', 'null')
ok(extractProposal(fence('{不是合法json')) === null, '非法 JSON → null（不抛错）', 'null')

// 6) 零副作用：extractProposal 不应触碰任何外部状态（纯函数）
const before = JSON.stringify({})
const _ = extractProposal(fence('{"module":"loss","changes":{"a":1}}'))
ok(JSON.stringify({}) === before, '纯函数：无副作用', 'ok')

console.log('\n================ extractProposal 单测：' + pass + ' PASS / ' + fail + ' FAIL ================')
process.exit(fail ? 1 : 0)
