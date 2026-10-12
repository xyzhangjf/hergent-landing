/* v486 P1-⑥ 单测：extractClarify 多组(questions)扩展 + 旧单主题向后兼容
   真实 import 源码（经 esbuild 打包，因为 useCardTrigger.js 用无扩展名 import）。
   用法: node .workbuddy/tools/v486-clarify-test.mjs            （自动打包并跑）
*/
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import url from 'node:url'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const SRC = path.join(ROOT, 'src/composables/useCardTrigger.js')
const OUT = path.join(mkdtempSync(path.join(tmpdir(), 'v486-')), 'uct.bundle.mjs')

execFileSync(
  path.join(ROOT, 'node_modules/.bin/esbuild'),
  [SRC, '--bundle', '--format=esm', '--platform=node', `--outfile=${OUT}`],
  { stdio: 'pipe' }
)
const { extractClarify } = await import(url.pathToFileURL(OUT).href)

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${extra ? '  → ' + JSON.stringify(extra) : ''}`) }
}

const fence = (o) => '```clarify ' + JSON.stringify(o) + ' ```'

console.log('=== v486 extractClarify ===')

// 1) 旧协议（单主题）完全不变，且 questions 显式为 null
{
  const r = extractClarify(fence({ ask: '选哪个客户？', options: [{ label: '永辉', query: '永辉的销量' }, { label: '美廉', query: '美廉的销量' }] }))
  ok('旧单主题：ask 透传', r && r.ask === '选哪个客户？', r)
  ok('旧单主题：options 2 项', r && r.options.length === 2, r)
  ok('旧单主题：questions 显式 null（契约明确）', r && r.questions === null, r)
}

// 2) 新协议（多组）
{
  const r = extractClarify(fence({
    questions: [
      { ask: '选哪个客户？', options: [{ label: '永辉', query: 'q1' }, { label: '美廉', query: 'q2' }] },
      { ask: '时间定哪天？', options: [{ label: '本周', query: 'q3' }, { label: '本月', query: 'q4' }] },
    ],
  }))
  ok('多组：questions 长度 2', r && r.questions && r.questions.length === 2, r)
  ok('多组：第 1 组 ask', r && r.questions[0].ask === '选哪个客户？', r)
  ok('多组：第 2 组 ask', r && r.questions[1].ask === '时间定哪天？', r)
  ok('多组：每组各有 2 选项', r && r.questions.every(q => q.options.length === 2), r)
  ok('多组：options 置空（走 questions 分支）', r && r.options.length === 0, r)
}

// 3) 新协议但某组无选项 → 该组被丢弃；全空则回落旧分支
{
  const r = extractClarify(fence({
    ask: '兜底问法',
    options: [{ label: 'A', query: 'qa' }],
    questions: [
      { ask: '有选项', options: [{ label: 'X', query: 'qx' }] },
      { ask: '没选项', options: [] },
    ],
  }))
  ok('多组：无选项的组被过滤', r && r.questions && r.questions.length === 1, r)
  ok('多组：保留的组正确', r && r.questions[0].ask === '有选项', r)
}
{
  const r = extractClarify(fence({ ask: '兜底', options: [{ label: 'A', query: 'qa' }], questions: [{ ask: '空组', options: [] }] }))
  ok('多组全空 → 回落旧单主题分支', r && r.questions === null && r.ask === '兜底', r)
}

// 4) 选项 label/query 互为兜底
{
  const r = extractClarify(fence({ questions: [{ ask: 'q', options: [{ label: '只有标签' }, { query: '只有问法' }] }] }))
  ok('选项：只有 label 时 query 兜底', r && r.questions[0].options[0].query === '只有标签', r)
  ok('选项：只有 query 时 label 兜底', r && r.questions[0].options[1].label === '只有问法', r)
}

// 5) 边界：无围栏 / 非法 JSON / 纯函数无副作用
{
  ok('无围栏返回 null', extractClarify('普通文本') === null)
  ok('非法 JSON 返回 null', extractClarify('```clarify {bad json} ```') === null)
  const txt = fence({ ask: 'a', options: [{ label: 'L', query: 'Q' }] })
  const a = extractClarify(txt)
  const b = extractClarify(txt)
  ok('纯函数：两次调用结果一致（无副作用）', JSON.stringify(a) === JSON.stringify(b))
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
