/* v306c：验证「部署自检」(useAppUpdate) 的**真实代码** —— 静态 import 真模块，用 esbuild 打包后跑。
 * 为什么不用另写一份判据：另写的判据只能证明「我写的正则对」，证明不了「组件里跑的那份对」。
 *
 * 跑法（两个参数都是**真实**的 index.html）：
 *   $NODE node_modules/.bin/esbuild <本文件> --bundle --platform=node --format=esm \
 *       --alias:vue=<tools>/v306c-stub-vue.mjs --outfile=/tmp/v306c-test/bundle.mjs
 *   $NODE /tmp/v306c-test/bundle.mjs <旧 index.html> <新 index.html>
 */

import { readFileSync } from 'node:fs'
import { __hooks } from './v306c-stub-vue.mjs'
import { useAppUpdate } from '../../hergent-cn-v2/src/composables/useAppUpdate.js'

const OLD_HTML = readFileSync(process.argv[2], 'utf8') // 「老板手上那版」的 index.html
const NEW_HTML = readFileSync(process.argv[3], 'utf8') // 「服务器现在这版」的 index.html

const ENTRY_RE = /assets\/(index-[A-Za-z0-9_-]+\.js)/
const entryOf = (html) => {
  const m = ENTRY_RE.exec(html)
  return m ? m[1] : ''
}

const OLD_ENTRY = entryOf(OLD_HTML)
const NEW_ENTRY = entryOf(NEW_HTML)

let pass = 0
let fail = 0
function chk(ok, label) {
  if (ok) {
    pass++
    console.log('  ✅  ' + label)
  } else {
    fail++
    console.log('  ❌  ' + label)
  }
}

/* ---------- 0. 夹具自证：两个真实文件必须都能抽出入口名，且互不相同（否则这个测试无判别力） ---------- */
console.log('夹具（真实 index.html）：')
console.log('  当前页面版 = ' + OLD_ENTRY)
console.log('  服务器新版 = ' + NEW_ENTRY)
chk(!!OLD_ENTRY, '旧 index.html 能抽出入口 chunk 名')
chk(!!NEW_ENTRY, '新 index.html 能抽出入口 chunk 名')
chk(OLD_ENTRY !== NEW_ENTRY, '两个入口名不同（夹具具备判别力：能真正区分新旧）')

/* ---------- 环境装置：DOM / window / fetch 全是我们造的，但被测代码是真的 ---------- */
let docScripts = []
let fetchHtml = NEW_HTML
let fetchThrows = false
let fetchCalls = 0
let reloaded = 0

const mkScript = (src, isModule) => ({
  attrType: isModule ? 'module' : null,
  getAttribute: (k) => (k === 'src' ? src : null),
})

globalThis.document = {
  visibilityState: 'visible',
  querySelector: (sel) => {
    const wantModule = sel.indexOf('module') >= 0
    for (const s of docScripts) {
      if (wantModule && s.attrType !== 'module') continue
      const src = s.getAttribute('src') || ''
      if (src.indexOf('/assets/index-') >= 0) return s
    }
    return null
  },
  querySelectorAll: () => docScripts,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = { addEventListener() {}, removeEventListener() {} }
globalThis.location = { reload: () => reloaded++ }
globalThis.fetch = async () => {
  fetchCalls++
  if (fetchThrows) throw new Error('network down')
  return { ok: true, text: async () => fetchHtml }
}

function reset() {
  __hooks.mounted.length = 0
  __hooks.unmounted.length = 0
  docScripts = []
  fetchHtml = NEW_HTML
  fetchThrows = false
  fetchCalls = 0
  reloaded = 0
}

async function drive() {
  const { hasNew } = useAppUpdate()
  for (const cb of __hooks.mounted) cb()
  await new Promise((r) => setTimeout(r, 20)) // 让 check() 里的 fetch/await 落地
  return hasNew
}

/* ---------- 正例 1：页面跑旧入口 + 服务器已是新入口 ⇒ 必须报「有新版本」 ---------- */
reset()
docScripts = [mkScript('/assets/' + OLD_ENTRY, true)]
{
  let h = { value: null }
  {
    const r = await drive()
    h = r
  }
  console.log('\n正例：')
  chk(h.value === true, '旧页面 + 新服务器 ⇒ hasNew = true（真实读数 ' + h.value + '）')
  chk(fetchCalls === 1, '确实去问了服务器一次（fetch 次数 = ' + fetchCalls + '，期望 1）')
}

/* ---------- 正例 2：入口 script 不带 type=module（走代码里的兜底遍历）⇒ 仍要认得出旧版本 ---------- */
reset()
docScripts = [mkScript('/assets/' + OLD_ENTRY, false)]
{
  const h = await drive()
  chk(h.value === true, '入口 script 非 module 时走兜底遍历，仍判出旧版本（真实读数 ' + h.value + '）')
}

/* ---------- 反例 1（最关键）：页面已是最新 ⇒ 必须**不**报（防恒真） ---------- */
reset()
docScripts = [mkScript('/assets/' + NEW_ENTRY, true)]
{
  const h = await drive()
  console.log('\n反例：')
  chk(h.value === false, '最新页面 + 新服务器 ⇒ hasNew = false（真实读数 ' + h.value + '）—— 判据不是恒真')
}

/* ---------- 反例 2：网络抖动 ⇒ 静默，不抛异常、不误报 ---------- */
reset()
docScripts = [mkScript('/assets/' + OLD_ENTRY, true)]
fetchThrows = true
{
  let threw = false
  let h = { value: null }
  try {
    h = await drive()
  } catch (e) {
    threw = true
  }
  chk(threw === false, 'fetch 抛错时组件侧不炸（异常被吞）')
  chk(h.value === false, 'fetch 抛错时 hasNew 保持 false（网络抖动不打扰用户）')
}

/* ---------- 反例 3：拿不到当前入口名 ⇒ 压根不该发请求（避免误报） ---------- */
reset()
docScripts = []
{
  const h = await drive()
  chk(fetchCalls === 0, '取不到当前入口名时不发请求（fetch 次数 = ' + fetchCalls + '，期望 0）')
  chk(h.value === false, '取不到当前入口名时 hasNew = false')
}

/* ---------- 反例 4：服务器返回的 HTML 里没有入口脚本（异常页/404 页）⇒ 不误报 ---------- */
reset()
docScripts = [mkScript('/assets/' + OLD_ENTRY, true)]
fetchHtml = '<!doctype html><html><body>502 Bad Gateway</body></html>'
{
  const h = await drive()
  chk(h.value === false, '服务器 HTML 异常（抽不到入口名）⇒ hasNew = false，不误报')
}

/* ---------- 卸载后：不该再继续轮询/监听 ---------- */
reset()
docScripts = [mkScript('/assets/' + OLD_ENTRY, true)]
{
  const { hasNew } = useAppUpdate()
  for (const cb of __hooks.mounted) cb()
  await new Promise((r) => setTimeout(r, 20))
  const before = fetchCalls
  for (const cb of __hooks.unmounted) cb()
  hasNew.value = false // 重置标记，看它还会不会再请求
  await new Promise((r) => setTimeout(r, 20))
  chk(fetchCalls === before, '组件卸载后不再发请求（卸载前 ' + before + ' 次，卸载后 ' + fetchCalls + ' 次）')
}

console.log('\n合计：' + (pass + fail) + ' 项，通过 ' + pass + '，失败 ' + fail)
console.log(fail === 0 ? '🟢 部署自检逻辑全部通过' : '🔴 有 ' + fail + ' 项未通过')
process.exit(fail === 0 ? 0 : 1)
