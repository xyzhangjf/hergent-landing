/* v740 契约：删客户列必须「做得到 + 说清楚还差一步」。
 *
 * 报障原话：「易胜玲那一列为什么删不掉呢？是因为她本期已报单吗？」
 * 实测：功能本身是好的 —— 改单态点列头 ✕，列当场消失，保存载荷
 *   customers 22 列（不含她）+ hidden_customers:["易胜玲"]，落库后名册的 NOT EXISTS 生效。
 * 真正让人"删不掉"的是两个**静默**：
 *   ① 只读态右键菜单里只有一句灰字「增删列 / 改字段请先点上方『改单』进入编辑态」——
 *      它不可点，用户眼里这一段就是"菜单里没有删除项"；
 *   ② 改单态删完**零反馈**：列从屏幕消失，但落库要等 save-matrix 的 hidden_customers，
 *      刷新即回来 ⇒ 用户唯一的结论是"删不掉"。
 *
 * 所以护栏钉的是这三条，且每条都带**坏样本自证**（只打印 ✅ 的护栏等于没有护栏）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGE = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const src = fs.readFileSync(PAGE, 'utf8')
/** 剥注释：本文件注释里就写着旧写法（`删列是待保存动作`、旧提示原文），不剥必假阳性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)
const tpl = code.slice(code.indexOf('<template>'), code.indexOf('<script'))

/** 取函数体：从 `function name` 到下一个行首 `}`。 */
function fnBody (name, text = code) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}', '')
  const m = text.match(re)
  return m ? m[0] : ''
}

console.log('① 只读态必须有**可点**的删除入口（不能只有一句灰字）')
{
  const btn = tpl.match(/<button[^>]*@click="hdrGoEditForStructural"[^>]*>/)
  ok(!!btn, '菜单里存在「去改单里删列 / 改字段」按钮', btn ? '' : '（只读态仍是纯文字提示 ⇒ 用户看到的是"没有删除项"）')
  ok(!!btn && /canDo\('data',\s*'delete'\)/.test(btn[0]),
    '该入口受 data/delete 权限门禁（不放假旋钮）')

  // 位置：必须落在「删除列」按钮**之后**的 v-else 分支里。
  // 若跑到前面（回改单态那个 v-if 里），等于把入口又藏回只有改单态才看得见的地方。
  const iDel = tpl.indexOf('删除列')
  const iGo = tpl.indexOf('hdrGoEditForStructural')
  ok(iDel > 0 && iGo > iDel, '入口位于改单态结构块之后（落在只读态的 v-else 分支）',
    iGo > iDel ? '' : `（删除列@${iDel} / 入口@${iGo}）`)

  // 坏样本自证：旧写法（只有一句 ctx-note）必须被判否
  const badTpl = tpl.replace(/<button[^>]*@click="hdrGoEditForStructural"[^>]*>[\s\S]*?<\/button>/, '')
  ok(!/<button[^>]*@click="hdrGoEditForStructural"/.test(badTpl),
    '坏样本：只剩灰字提示时判据会报错（不是恒真）')
}

console.log('② 入口只许转调 enterEdit（闸门只在他手里）')
{
  const body = fnBody('hdrGoEditForStructural')
  ok(!!body, '函数已实现')
  ok(/enterEdit\s*\(/.test(body), '转调 enterEdit( )')
  // 自带判据 = 第二套闸门：会出现"按钮能点、进去又被拦"或反之，用户完全猜不到规律
  const dup = /\b(periodLocked|editPermBlocked|noOpenPeriod|canDo)\s*\(?/.exec(body)
  ok(!dup, '未自带期次 / 权限判据（避免两套闸门漂移）', dup ? '发现：' + dup[1] : '')

  const badBody = 'function hdrGoEditForStructural () { closeHdrCtx(); if (periodLocked.value) return; if (!editMode.value) enterEdit() }'
  ok(/\b(periodLocked|editPermBlocked|noOpenPeriod|canDo)\s*\(?/.test(badBody),
    '坏样本：自带 periodLocked 判据会被上一条抓出')
}

console.log('③ 删列后必须说明「还要保存」')
{
  const body = fnBody('delCol')
  ok(!!body, 'delCol 已实现')
  const toastLine = (body.match(/toast\([^\n]*/g) || []).find((l) => /保存/.test(l))
  ok(!!toastLine, '删除后 toast 文案里明确提到「保存」',
    toastLine ? '' : '（屏幕已经变了却不说还要保存 ⇒ 刷新回来 = 用户认为删不掉）')
  ok(/hiddenUnits\s*\(\)/.test(body), '仍登记进 hiddenUnits（保存时随 hidden_customers 落库）')

  const badBody = body.replace(/toast\([^\n]*\n?/g, '')
  const badHas = (badBody.match(/toast\([^\n]*/g) || []).some((l) => /保存/.test(l))
  ok(!badHas, '坏样本：去掉 toast 后上一条会报错')
}

console.log('\n' + (failed ? `❌ ${failed} 条未通过` : '✅ 全部通过'))
process.exit(failed ? 1 : 0)
