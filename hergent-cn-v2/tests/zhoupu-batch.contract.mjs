/* v665 契约：舟谱导入模板「分批源单据号唯一性」的前端侧不许回退。
 *
 * 为什么需要它：唯一性写在**后端**（`routers/forecast.py::_alloc_doc_seqs` / 号段水位表），
 * 但前端有两处会让后端做得再好也白费：
 *   ① `zt_seq_start` 的默认值 —— 若被改回 21，新租户第一批就从 21 起，
 *      「默认 01 起、可用满 99 个号」这条决定立刻失效（用户 2026-10-24 明确要 1）；
 *   ② 导出后必须把「第几批 / 哪段单号 / 是否复用」说给用户 —— 分批场景下这是
 *      **唯一**能跟舟谱里那批单对上的凭据，悄悄丢掉 = 用户拿着 3 个同名文件猜。
 *
 * 只扫 `<script setup>` 与模板，不扫全文（HTML 注释/CSS 里出现数字 21 是噪声）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TP = path.join(ROOT, 'src/components/forecast/TemplateParams.vue')
const API = path.join(ROOT, 'src/api/modules.js')
const FC = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}
const read = (p) => fs.readFileSync(p, 'utf8')

/* ── ① TemplateParams：默认起始序号必须是 1 ── */
console.log('① 自提单号起始序号默认 01')
{
  const s = read(TP)
  const scriptStart = s.indexOf('<script setup>')
  const script = scriptStart >= 0 ? s.slice(scriptStart) : s
  const hits21 = [...script.matchAll(/zt_seq_start[^\n]*\b21\b/g)].map(m => m[0].trim())
  ok(hits21.length === 0, '脚本里没有任何 zt_seq_start 兜底成 21 的地方', hits21.length ? hits21[0] : '')
  const init = script.match(/const\s+tp\s*=\s*reactive\(\{[^}]*zt_seq_start:\s*(\d+)/)
  ok(!!init && init[1] === '1', '响应式初值 = 1', init ? `(实际 ${init[1]})` : '(没找到 tp 初始化)')
  const loads = [...script.matchAll(/p\.zt_seq_start\s*\|\|\s*(\d+)/g)].map(m => m[1])
  ok(loads.length > 0 && loads.every(v => v === '1'), '读回时兜底 = 1', loads.length ? `(${loads.join('/')})` : '')
  const saves = [...script.matchAll(/zt_seq_start:\s*Number\([^)]*\)\s*\|\|\s*(\d+)/g)].map(m => m[1])
  ok(saves.length > 0 && saves.every(v => v === '1'), '保存时兜底 = 1', saves.length ? `(${saves.join('/')})` : '')
  // 语义变了必须说清，否则用户会以为改了配置就能"重置"号段
  ok(/第一批|首次/.test(s) && /不再复用|接着上一批/.test(s),
     '界面文案说明了「只决定第一批 / 之后自动接续」')
}

/* ── ② 导出必须消费批次/号段/复用三个头 ── */
console.log('② 导出后回报批次与号段')
{
  const s = read(API)
  ok(/x-template-batch/i.test(s), 'api 读取 X-Template-Batch')
  ok(/x-template-seq/i.test(s), 'api 读取 X-Template-Seq')
  ok(/x-template-reuse/i.test(s), 'api 读取 X-Template-Reuse')
  const f = read(FC)
  ok(/r\.batch/.test(f), 'Forecast.vue 用了返回的 batch')
  ok(/r\.seq/.test(f), 'Forecast.vue 用了返回的 seq')
  ok(/r\.reuse/.test(f), 'Forecast.vue 用了返回的 reuse')
  ok(/沿用原号段|复用/.test(f), '复用时有明确文案（不让用户以为又吃了新号）')
}

/* ── ③ 同一动作只能有一个入口：导出走统一下拉（不新增工具栏按钮） ── */
console.log('③ 导出入口')
{
  const f = read(FC)
  const callers = [...f.matchAll(/zhoupuGenerate\(/g)].length
  ok(callers === 1, '只从一个地方调用 zhoupuGenerate（统一出口）', `(${callers} 处)`)
}

if (failed) {
  console.log(`\nFAILED(${failed})`)
  process.exit(1)
}
console.log('\nPASS')
