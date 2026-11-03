/**
 * 列设置面板「滚动误关」护栏（v742）。
 *
 * 病根：useColMenu 在 window 捕获阶段监听**所有** scroll 事件并直接收起面板，
 * 导致在面板内部翻列（.col-menu-list 的 overflow:auto 滚动）时也被关掉。
 * 修复：滚动关闭前先判 target 是否落在面板内部，内部翻列跳过。
 *
 * 静态护栏（与 forecast-*.contract.mjs 同款范式）：钉住修复存在、旧版已移除。
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const file = resolve(__dir, '../src/composables/useColMenu.js')
const src = readFileSync(file, 'utf8')

const checks = []
const must = (cond, msg) => checks.push([!!cond, msg])

// ① 滚动关闭处理函数必须接收事件参数 e（才能判内部滚动）
must(/closeColMenuOnViewportChange\s*\(e\)/.test(src),
  '滚动关闭处理函数接收事件参数 e')

// ② 关闭前必须先判 target 是否落在面板内部（内部翻列不收起）
must(/colMenuEl\.value\.contains\(e && e\.target\)/.test(src),
  '滚动关闭前先判 target 是否在面板内部（内部翻列不收起）')

// ③ 回归钉：不能是旧版「无条件收起」单行实现
must(
  !/function closeColMenuOnViewportChange \(\) \{ if \(showColMenu\.value\) showColMenu\.value = false \}/.test(src),
  '已移除旧版「无条件收起」单行实现'
)

let ok = true
for (const [c, m] of checks) {
  console.log((c ? '✅' : '❌') + ' ' + m)
  if (!c) ok = false
}
console.log(ok
  ? '\n✅ 列设置面板滚动不误关：护栏通过'
  : '\n❌ 列设置面板滚动护栏失败')
process.exit(ok ? 0 : 1)
