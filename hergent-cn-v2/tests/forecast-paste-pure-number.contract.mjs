/* ㊿ v781 契约：纯数字列粘贴静默错误的拦截
 * ============================================================
 * 用户报障（2026-11-05）：从 Excel 复制「唐成」报单数据整列，未点选网格落点格就直接
 *   Ctrl+V，数字被当成「新增商品名」塞进表格，唐成列数量反而落空，还偷生一堆叫数字的商品行。
 *
 * 根因：onPaste 在 `editMode && selected.r < 0`（未选中落点单元格）时，会走进「主档粘贴」
 *   路径；纯数字列没有商品名/条码，被 `headerMap` 默认首列当成 name，于是新增 N 行数字商品。
 *
 * 修法（Forecast.vue::onPaste + 新增 pasteIsPureNumbers）：未选中单元格 + 剪贴板是
 *   「纯数字列」（无表头、每行都是数字）时，拦截并 toast「请先点选客户列单元格再粘贴」，
 *   **直接 return，不新增任何商品行**。已选中单元格的路径（首个分支走 pasteRegion 真·列对列填充）
 *   不受影响；带表头的商品主档表格（首行含名称/条码/规格等）一律放行。
 *
 * 🔴 护栏要点：
 *   · 静态判据必须同时确认「拦截分支存在」+「函数定义存在」+「提示文案落到拦截上」，
 *     三条缺一不可（只查函数名会被「定义了却没调用」骗过）。
 *   · 动态判据抽取**真实函数体**跑（`vm`，不是 reimplement），样本覆盖：纯数字列→true、
 *     商品名列→false、带表头→false、含非数字→false。
 *   · 坏样本：把拦截分支删掉（return 前那段 if）→ 必须判否；把 `selected.r < 0` 条件删掉
 *     （变成「已选中时也拦」）→ 必须判否（那会误伤 pasteRegion 正常批量填充）。
 */

import fs from 'fs'
import path from 'path'
import vm from 'vm'

const vue = fs.readFileSync(path.resolve('src/pages/Forecast.vue'), 'utf-8')
let pass = 0, fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅', label) }
  else { fail++; console.log('  ❌', label) }
}

console.log('=== 静态判据（拦截分支 + 函数定义 + 提示文案） ===')
ok(/function pasteIsPureNumbers\s*\(lines\)/.test(vue), '定义了 pasteIsPureNumbers 纯函数')
ok(/selected\.value\.r < 0 && pasteIsPureNumbers\(lines\)/.test(vue),
  'onPaste 在未选中单元格 + 纯数字列时拦截（selected.r < 0 && pasteIsPureNumbers）')
ok(/pasteIsPureNumbers\(lines\)[\s\S]{0,260}?toast\([^)]*点选要粘贴的客户列/.test(vue),
  '拦截后给出「点选客户列单元格」的明确提示，而非静默')
ok(/pasteIsPureNumbers\(lines\)[\s\S]{0,260}?\breturn\b/.test(vue),
  '拦截后直接 return（不新增任何商品行）')

console.log('\n=== 动态判据（抽取真实函数体实跑） ===')
const seg = (vue.match(/const PASTE_HEADER_WORDS = \[[\s\S]*?\]\s*;?\s*function pasteIsPureNumbers\(lines\)\s*\{[\s\S]*?\n\}/) || [''])[0]
ok(!!seg, '能从源码抽出 PASTE_HEADER_WORDS + pasteIsPureNumbers')
if (seg) {
  const sandbox = {}
  vm.createContext(sandbox)
  try {
    vm.runInContext(seg + '\nthis.pasteIsPureNumbers = pasteIsPureNumbers;', sandbox)
    const f = sandbox.pasteIsPureNumbers
    ok(f(['12', '34', '56']) === true, '纯数字列 → true（会被拦截，唐成列不落空）')
    ok(f(['商品A', '商品B']) === false, '商品名列 → false（放行主档新增）')
    ok(f(['商品名', '12', '34']) === false, '首行是表头（商品名）→ false（放行，交给 tryPasteCross/主档）')
    ok(f(['12', '34', 'abc']) === false, '含非数字行 → false（不当纯数字处理，避免误拦）')
    ok(f(['1,200', '3.5']) === true, '带千分位逗号/小数 → true（NFKC + 去逗号后仍是数字）')
  } catch (e) {
    ok(false, '函数体在 vm 中执行抛错：' + e.message)
  }
}

console.log('\n=== 坏样本（修改源码后护栏必须判否） ===')
const badDrop = vue.replace(/selected\.value\.r < 0 && pasteIsPureNumbers\(lines\)[\s\S]*?return\s*\n/, '')
ok(!/selected\.value\.r < 0 && pasteIsPureNumbers\(lines\)/.test(badDrop),
  '坏样本：删掉拦截分支 → 判据能检出（不再拦截纯数字列）')
const badNoSel = vue.replace('selected.value.r < 0 && pasteIsPureNumbers(lines)', 'pasteIsPureNumbers(lines)')
ok(!/selected\.value\.r < 0 && pasteIsPureNumbers\(lines\)/.test(badNoSel),
  '坏样本：删掉 selected.r<0 条件（误伤已选中时的正常填充）→ 判据能检出')

console.log(`\n结果：${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
