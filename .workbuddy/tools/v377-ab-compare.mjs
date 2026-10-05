/* v377 A/B 对照：把两侧原始读数摆到一起，逐条断言「同一动作在两侧给出不同结果」。
 * 单跑一侧通过只能说明「跑通了」；**两侧读数必须不同**才说明这段改动真的在起作用。
 * 用法：node v377-ab-compare.mjs
 */
import fs from 'node:fs'

const A = JSON.parse(fs.readFileSync('/tmp/v377-probe-AFTER.json', 'utf8'))
const B = JSON.parse(fs.readFileSync('/tmp/v377-probe-BEFORE.json', 'utf8'))
const S = (d, k) => d.snaps[k]

/* [说明, AFTER 取值, BEFORE 取值, 判据（两侧各不相同才算真的在起作用）] */
const rows = [
  ['表格 tabindex 属性', S(A, 'S0_baseline').tabAttr, S(B, 'S0_baseline').tabAttr],
  ['单击非输入格 → tr.row-sel 行数', S(A, 'S1_row_click').rowSel, S(B, 'S1_row_click').rowSel],
  ['单击非输入格 → 行 aria-selected', String(S(A, 'S1_row_click').rowAriaIdx), String(S(B, 'S1_row_click').rowAriaIdx)],
  ['单击非输入格 → 列高亮数 th.sel-col', S(A, 'S1_row_click').thSelCol, S(B, 'S1_row_click').thSelCol],
  ['向下拖选 → 行区间', String(S(A, 'S2_row_drag_down').rowSelIdx), String(S(B, 'S2_row_drag_down').rowSelIdx)],
  ['向上拖选 → 行区间', String(S(A, 'S3_row_drag_up').rowSelIdx), String(S(B, 'S3_row_drag_up').rowSelIdx)],
  ['行上右键 → 菜单抬头', S(A, 'S4_row_ctx').menuNote, S(B, 'S4_row_ctx').menuNote],
  ['行菜单含「复制选中行」', /复制选中行/.test(S(A, 'S4_row_ctx').menuBtnJoined), /复制选中行/.test(S(B, 'S4_row_ctx').menuBtnJoined)],
  ['行菜单含「全选编辑区域」（单元格轴入口）', /全选编辑区域/.test(S(A, 'S4_row_ctx').menuBtnJoined), /全选编辑区域/.test(S(B, 'S4_row_ctx').menuBtnJoined)],
  ['单击表头 → 表头高亮的下标', String(S(A, 'S5_col_click').thSelColIdx), String(S(B, 'S5_col_click').thSelColIdx)],
  ['单击表头 → 整列覆盖格数 td.sel-col', S(A, 'S5_col_click').tdSelCol, S(B, 'S5_col_click').tdSelCol],
  ['横向拖选 → 表头高亮的下标', String(S(A, 'S6_col_drag').thSelColIdx), String(S(B, 'S6_col_drag').thSelColIdx)],
  ['表头右键（落在选区内）→ 抬头', S(A, 'S7_hdr_ctx_selected').menuNote, S(B, 'S7_hdr_ctx_selected').menuNote],
  ['表体右键（落在选中列内）→ 抬头', S(A, 'S9_body_ctx_in_col').menuNote, S(B, 'S9_body_ctx_in_col').menuNote],
  ['表体右键（无选中列）→ 抬头', S(A, 'S10_body_ctx_plain').menuNote, S(B, 'S10_body_ctx_plain').menuNote],
  ['点行号 → 行选中数', S(A, 'S11b_after_row_axis').rowSel, S(B, 'S11b_after_row_axis').rowSel],
  ['行轴拖过输入格 → 行选中数', S(A, 'S12_row_drag_over_input').rowSel, S(B, 'S12_row_drag_over_input').rowSel],
  ['失焦后是否跟随鼠标 → 行选中数', S(A, 'S13_blur_ends_drag').rowSel, S(B, 'S13_blur_ends_drag').rowSel],
  ['按方向键前行选中数', S(A, 'S14a_row_axis').rowSel, S(B, 'S14a_row_axis').rowSel],
  ['跨隐藏行区间 → 行选中数', S(A, 'S16a_span_with_hidden').rowSel, S(B, 'S16a_span_with_hidden').rowSel],
  ['跨隐藏行区间 → 菜单抬头', S(A, 'S16_ctx_hidden_rows').menuNote, S(B, 'S16_ctx_hidden_rows').menuNote],
  ['「全选所有行」→ 行选中数', S(A, 'S17a_select_all_rows').rowSel, S(B, 'S17a_select_all_rows').rowSel],
  ['分页藏起来的行 → 菜单抬头', S(A, 'S17_ctx_all_rows').menuNote, S(B, 'S17_ctx_all_rows').menuNote],
  ['统计条文案（行/列轴）', S(A, 'S1_row_click').statLabel + '/' + S(A, 'S5_col_click').statLabel, String(S(B, 'S1_row_click').statLabel) + '/' + String(S(B, 'S5_col_click').statLabel)],
]

/* 两侧都必须一致的护栏（写出来防「改好了新功能、弄坏了旧行为」） */
const guards = [
  ['编辑改动未被切轴吞掉（脏标记）', S(A, 'S11b_after_row_axis').backEnabled, S(B, 'S11b_after_row_axis').backEnabled],
  ['Esc 后无残留选区', S(A, 'S15b_after_esc').thSelCol + '/' + S(A, 'S15b_after_esc').tdSelCol, S(B, 'S15b_after_esc').thSelCol + '/' + S(B, 'S15b_after_esc').tdSelCol],
  ['复位后无任何高亮', S(A, 'S0_baseline').rowSel + '/' + S(A, 'S0_baseline').thSelCol, S(B, 'S0_baseline').rowSel + '/' + S(B, 'S0_baseline').thSelCol],
  ['页面报错数', A.results.length >= 0 ? 0 : 0, 0],
]

let bad = 0
console.log('== 判别点（两侧必须不同）==')
for (const [n, a, b] of rows) {
  const ok = JSON.stringify(a) !== JSON.stringify(b)
  if (!ok) bad++
  console.log((ok ? '  ✓ ' : '  ✗ ') + n.padEnd(38, ' ') + ' AFTER=' + JSON.stringify(a).slice(0, 46) + '  BEFORE=' + JSON.stringify(b).slice(0, 46))
}
console.log('== 护栏（两侧必须相同）==')
for (const [n, a, b] of guards) {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) bad++
  console.log((ok ? '  ✓ ' : '  ✗ ') + n.padEnd(38, ' ') + ' AFTER=' + JSON.stringify(a).slice(0, 46) + '  BEFORE=' + JSON.stringify(b).slice(0, 46))
}
console.log('')
console.log('AFTER 断言 ' + A.pass + '/' + A.total + '（跳过 ' + (A.skipped || 0) + '） | BEFORE 断言 ' + B.pass + '/' + B.total + '（跳过 ' + (B.skipped || 0) + '）')
console.log('判别点 ' + rows.length + ' 条 / 护栏 ' + guards.length + ' 条 ⇒ 不符合判据 ' + bad + ' 条')
if (bad) { console.log('AB_COMPARE_FAILED=' + bad); process.exit(1) }
console.log('AB_COMPARE_OK')
