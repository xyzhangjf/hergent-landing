/**
 * 全站「全选」交互统一契约（v671）
 * ---------------------------------------------------------------------------
 * 为什么需要这一组：
 *   本期预报（v615）那颗三态全选框是**原型**，本轮把它上提成共享件
 *   `components/SelectAllCheckbox.vue` + `styles/select-all.css`，并推广到进销存
 *   三列表 / 商品档案 / 分摊面板 / 线路 / 筛选面板。
 *
 *   这类约定最容易死的死法是「新页面照着老写法抄一遍」—— 抄出来的框
 *   ① 没有半选态（用户看不出"只选了一部分"）；
 *   ② 用 `@click.prevent` 手写 ⇒ 真实鼠标一点就出现 v669 那种「勾选态与真实状态
 *      永久相反」，而 JS 的 `el.click()` 探针**量不出来**。
 *   ⇒ 只能靠静态契约钉住，且必须**扫全站**（v669 就是只扫了 3 个文件才漏网的）。
 *
 * 🔴 扫描纪律（踩过）：
 *   · 断言前**先剥 HTML 注释** —— 注释里写「不要用 @click.prevent」会被当成违规命中。
 *   · 本机 shell 里 `grep "A\|B"` 会静默失效 ⇒ 本文件一律用 Node 的正则，不用 shell。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
const read = (p) => fs.readFileSync(p, 'utf8')
/** 剥掉 HTML 注释（等长替换保行号）*/
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))

function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue') || e.name.endsWith('.css') || e.name.endsWith('.js')) out.push(p)
  }
  return out
}
const files = walk(SRC)
const vueFiles = files.filter((f) => f.endsWith('.vue'))
const rel = (p) => p.slice(ROOT.length + 1)

console.log('\n【1】唯一源存在且已接入入口')
{
  const comp = path.join(SRC, 'components/SelectAllCheckbox.vue')
  const css = path.join(SRC, 'styles/select-all.css')
  ok(fs.existsSync(comp), 'components/SelectAllCheckbox.vue 存在')
  ok(fs.existsSync(css), 'styles/select-all.css 存在')
  ok(/import '\.\/styles\/select-all\.css'/.test(read(path.join(SRC, 'main.js'))),
    'main.js 已 import styles/select-all.css（否则只有入口页有样式）')

  /* 🔴 这里也要剥注释：共享件的说明里写着「不要 preventDefault」，
     不剥就会把自己文档里的那句话判成违规（与 v664 那次同族）。 */
  const c = stripComments(read(comp))
  ok(/:indeterminate\.prop="indeterminate"/.test(c), '共享件用原生 :indeterminate.prop 画半选（不自绘方块）')
  ok(/@change="onChange"/.test(c), '共享件用 @change（不是 @click）')
  ok(!/@click\.prevent/.test(c), '共享件没有 @click.prevent（会撞 pre-click activation）')
  ok(!/preventDefault/.test(c), '共享件不调用 preventDefault')
  ok(/class="row-pick sa-cb"/.test(c), '共享件根节点带 .row-pick .sa-cb（与原型同名同类，视觉不漂移）')

  const s = read(css)
  ok(/width:\s*13px/.test(s) && /height:\s*13px/.test(s), 'select-all.css 里 .sa-cb 尺寸 13×13（与本期预报同款）')
  ok(/accent-color:\s*var\(--p\)/.test(s), 'select-all.css 里 .sa-cb 用主色 accent-color')
  ok(/\.sa-cb:disabled/.test(s), 'select-all.css 里有禁用态')
}

console.log('\n【2】全站不得再手写三态复选框（扫全部 .vue）')
{
  const COMP = path.join(SRC, 'components/SelectAllCheckbox.vue')
  const bad = []
  for (const f of vueFiles) {
    if (f === COMP) continue
    const s = stripComments(read(f))
    /* 🔴 只判「写在 <input> 上的」—— `:indeterminate="x"` 传给共享件是**正常用法**，
       第一版把它也算进来 ⇒ 7 处接入点全部假红（判别力为 0）。 */
    /* 🔴 前导别写 `\s` —— 真实写法是 `:indeterminate.prop=`，冒号不是空白 ⇒
       第一版因此一处都没抓到。 */
    for (const m of s.matchAll(/<input[^>]*indeterminate[^>]*>/g)) bad.push(rel(f) + ' → ' + m[0].slice(0, 70))
  }
  ok(bad.length === 0, `除共享件外无手写三态 <input>（实测 ${bad.length} 处）`, bad.join(' | '))
}

console.log('\n【3】全选 handler 不得在模板里自取反 / 不得用 click.prevent')
{
  /* `@change="x = !x; ..."` 是把「浏览器翻转 DOM」与「组件里取反」当成两次改动叠在一起，
     顺序一反勾选态就与真实集合永久相反（v669 同源）。全选状态必须由数据单向决定。 */
  const bad = []
  for (const f of vueFiles) {
    const s = stripComments(read(f))
    for (const m of s.matchAll(/@change="([^"]*)"/g)) {
      if (/=\s*!/ .test(m[1])) bad.push(`${rel(f)} → ${m[1].slice(0, 60)}`)
    }
  }
  ok(bad.length === 0, `无「@change 里对状态自取反」的写法（实测 ${bad.length} 处）`, bad.join(' | '))
}

console.log('\n【4】接入点覆盖（每个点必须真的用了共享件）')
{
  const POINTS = [
    ['pages/Forecast.vue', '本期预报·序号列表头（原型）'],
    ['pages/Forecast.vue', '本期预报·品牌筛选面板'],
    ['pages/Forecast.vue', '本期预报·到货周期筛选面板'],
    ['pages/Forecast.vue', '本期预报·唯一值筛选面板'],
    ['pages/inventory/InvPurchaseList.vue', '采购单列表表头'],
    ['pages/inventory/InvSaleList.vue', '销售单列表表头'],
    ['pages/inventory/InvTransferList.vue', '调拨单列表表头'],
    ['pages/ProductArchive.vue', '商品档案·批量补进价表头'],
    ['components/forecast/AllocPanel.vue', '分摊面板·门店勾选表头'],
    ['pages/wh/RouteSetup.vue', '线路设置·停靠点勾选'],
  ]
  for (const [f, label] of POINTS) {
    const p = path.join(SRC, f)
    const s = stripComments(read(p))
    /* 🔴 必须判「模板里真的用了 `<SelectAllCheckbox`」，不能只判文件里出现过这个名字 ——
       import 语句本身就含这个名字 ⇒ 第一版在"已改回手写 input"的状态下仍然判绿
       （判别力为 0，注回自证时就是这么露的）。 */
    ok(/<SelectAllCheckbox/.test(s) && /import SelectAllCheckbox/.test(s), `${label} 已接入共享件`)
  }
}

console.log('\n【5】三态判据完整（每个接入点都要有 all / some 两个 computed）')
{
  /* 只有 :checked 没有 :indeterminate ⇒ 「部分选中」在界面上等于「没选」，
     用户会以为自己的勾选丢了。这条钉的是"半选态不许省"。 */
  const CHECKS = [
    ['pages/inventory/InvPurchaseList.vue', ['pageAllOn', 'pageSomeOn']],
    ['pages/inventory/InvSaleList.vue', ['pageAllOn', 'pageSomeOn']],
    ['pages/inventory/InvTransferList.vue', ['pageAllOn', 'pageSomeOn']],
    ['pages/ProductArchive.vue', ['fpAllOn', 'fpSomeOn']],
    ['components/forecast/AllocPanel.vue', ['allocAllOn', 'allocSomeOn']],
    ['pages/wh/RouteSetup.vue', ['pickAllOn', 'pickSomeOn']],
    ['pages/Forecast.vue', ['brandAllOn', 'brandSomeOn', 'cycleAllOn', 'cycleSomeOn']],
  ]
  for (const [f, names] of CHECKS) {
    const s = stripComments(read(path.join(SRC, f)))
    /* 🔴 必须判「**定义**了」而不是「出现过」—— 模板里 `:indeterminate="pickSomeOn"`
       也算一次出现，第一版因此在"computed 已被改名"时仍判绿。此处锚定声明式：`const x = computed(` */
    const miss = names.filter((n) => !new RegExp('const\\s+' + n + '\\s*=\\s*computed\\s*\\(').test(s))
    ok(miss.length === 0, `${f} 定义了 ${names.join(' / ')}`, miss.length ? '缺定义 ' + miss.join(',') : '')
  }
}

console.log('\n【6】不得影响单选 / 开关 / 权限矩阵（这些地方不许出现全选件）')
{
  /* 有意例外，写进契约是怕后人"顺手统一"把它们也换了：
     · Settings 权限矩阵：有 v350「必选项」上锁，列级全选会一次改掉多行且绕过锁；
     · ColMenuPanel 列显隐：有 core 固定列禁用，且已有「重置」；
     · 单选/开关类（提醒开关、是否启用…）本来就不是多选。 */
  for (const f of ['pages/Settings.vue', 'components/ColMenuPanel.vue', 'components/forecast/ReminderConfig.vue']) {
    const p = path.join(SRC, f)
    if (!fs.existsSync(p)) continue
    const s = stripComments(read(p))
    ok(!/SelectAllCheckbox/.test(s), `${f} 未被改成全选件（保持自己的锁定语义）`)
  }
}

console.log('\n【7】v510 的"不要恢复全选"注释已随本轮口径更新')
{
  const s = read(path.join(SRC, 'styles/psi-list.css'))
  ok(/v671/.test(s) && /恢复/.test(s), 'psi-list.css 已注明 v671 恢复表头全选（旧注释会误导后人改回去）')
  ok(!/不要恢复全选/.test(s), 'psi-list.css 不再留下「不要恢复全选」的过期指令')
}

console.log(failed === 0 ? '\n  ALL PASS' : `\n  FAILED(${failed})`)
process.exit(failed === 0 ? 0 : 1)
