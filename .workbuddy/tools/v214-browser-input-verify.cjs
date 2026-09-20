// v214 A 真机取证：全角输入 → 自动转半角（真实 Chrome + 真实页面 + 真实键盘事件）
const puppeteer = require('puppeteer-core')
const TOKEN = process.argv[2]
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const ok = (cond, label, extra) => {
  results.push({ pass: !!cond, label, extra })
  console.log('%s %s%s', cond ? '✅' : '❌', label, extra ? '   ← ' + extra : '')
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 1000 })
  await page.goto('https://hergent.cn/login', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate(t => localStorage.setItem('hergent_v2_token', t), TOKEN)
  await page.goto('https://hergent.cn/#/forecast', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(6000)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    if (b && !b.disabled) b.click()
  })
  await sleep(7000)

  const TAG = 'v214probe'

  // 真实文本插入走 CDP `Input.insertText` —— 与用户敲键同一条通路，会触发 input 事件
  const cdp = await page.target().createCDPSession()
  const insertText = async (text) => { await cdp.send('Input.insertText', { text }) }

  // ─────────── A 定位第一个数量格，打标记 ───────────
  const a = await page.evaluate((tag) => {
    const el = document.querySelector('input.cell-qty')
    if (!el) return null
    el.setAttribute('data-v214', tag)
    const tr = el.closest('tr')
    return {
      type: el.type, inputmode: el.getAttribute('inputmode'),
      cls: String(el.className).slice(0, 40),
      rowSum: tr && tr.querySelector('td.sum') ? tr.querySelector('td.sum').textContent.trim() : null,
      pageNumberInputs: document.querySelectorAll('input[type=number]').length,
    }
  }, TAG)
  if (!a) { console.log('❌ 找不到数量格（未进编辑态？）'); await browser.close(); process.exit(1) }
  console.log('起点：type=%s inputmode=%s 该行合计=%s  全页 type=number 个数=%d\n',
    a.type, a.inputmode, a.rowSum, a.pageNumberInputs)
  ok(a.type === 'text', '数量格 type=text（原为 number）', a.type)
  ok(a.inputmode === 'numeric', '数量格保留 inputmode=numeric（移动端数字键盘不丢）', a.inputmode)
  ok(a.pageNumberInputs === 0, '整页不存在 type=number 的输入框', String(a.pageNumberInputs))

  // ─────────── B 清空该格 ───────────
  const sum0 = await page.evaluate((tag) => {
    const el = document.querySelector('input[data-v214="' + tag + '"]')
    el.focus(); el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const tr = el.closest('tr')
    return tr.querySelector('td.sum').textContent.trim()
  }, TAG)
  await sleep(400)

  // ─────────── C 真实键盘输入全角数字 ───────────
  await insertText('\uff11\uff12')   // １２
  await sleep(600)
  const c = await page.evaluate((tag) => {
    const el = document.querySelector('input[data-v214="' + tag + '"]')
    const tr = el.closest('tr')
    return { value: el.value, rowSumText: tr.querySelector('td.sum').textContent.trim() }
  }, TAG)
  ok(c.value === '12', '🔴 全角「１２」输进去后 DOM 自动变「12」', JSON.stringify(c.value))
  ok(parseFloat(c.rowSumText.replace(/[^0-9.]/g, '')) === (parseFloat(sum0.replace(/[^0-9.]/g, '')) || 0) + 12,
     '🔴 合计同步 += 12（证明 model 里是**数字 12**，不是字符串 "１２" —— 若为字符串 parseInt 会得 NaN⇒合计不增）',
     '清空后合计=' + sum0 + ' → 输入后合计=' + c.rowSumText)

  // ─────────── D 反证：**裸元素能力矩阵**（不经净化层，只差 type 一个变量）───────────
  //   ⚠️ 前两版反证都被证伪，记录在此以免下次再猜：
  //     ① 「改真实格的 type 回 number」—— 被污染：改 type 不摘 @input，净化层照样生效；
  //     ② 「type=number 会丢弃全角字符」—— **不成立**：Chromium 在 insertText 路径上会把
  //        全角数字规范化成 ASCII（`１２` → `12`）。所以「改前根本输不进去」是错的。
  //   ⇒ 改为测**真实差异**：同一个输入串，两种 type 各自得到什么。谁丢失信息，谁就在
  //      浏览器层做了我们看不见、也控制不了的加工。
  await page.evaluate(() => {
    for (const t of ['number', 'text']) {
      const i = document.createElement('input')
      i.type = t; i.id = 'bare-' + t
      i.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(i)
    }
  })
  const probe = async (id, text) => {
    await page.evaluate((i) => { const e = document.getElementById(i); e.value = ''; e.focus() }, id)
    await insertText(text)
    return page.evaluate((i) => document.getElementById(i).value, id)
  }
  const cases = [
    ['\uff11\uff12', '全角数字 １２'],
    ['\uff11\uff12\u3002\uff15', '全角数字 + 中文句号 １２。５'],
    ['1\uff0c200', '全角逗号 1，200'],
    ['12\u7bb1', '脏值 12箱'],
    ['12.', '中间态 12.'],
  ]
  console.log('\n裸元素能力矩阵（不经净化层）：')
  const diff = []
  for (const [raw, why] of cases) {
    const vn = await probe('bare-number', raw)
    const vt = await probe('bare-text', raw)
    const same = vn === vt
    if (!same) diff.push([raw, vn, vt])
    console.log('  %-24s number→%-14s text→%-14s %s',
      raw + ' ' + why.slice(0, 6), JSON.stringify(vn), JSON.stringify(vt), same ? '（一致）' : '← 有差异')
  }
  ok(diff.length > 0,
     '🔴 两种 type 对同一输入的处理**并不相同**（差异 ' + diff.length + ' 处）⇒ type=number 在浏览器层做了我们看不见的加工',
     diff.map(d => JSON.stringify(d[0]) + ': number=' + JSON.stringify(d[1]) + ' text=' + JSON.stringify(d[2])).join(' | '))
  const t12 = await probe('bare-text', '\uff11\uff12\u3002\uff15')
  ok(t12 === '\uff11\uff12\u3002\uff15',
     '🔴 type=text **原样**收下「１２。５」⇒ 我们的净化层能看到用户真实敲的东西（这是可验证、可修的前提）',
     JSON.stringify(t12))
  await page.evaluate(() => { document.getElementById('bare-number').remove(); document.getElementById('bare-text').remove() })

  // ─────────── E 中间态：`12.` 必须能打出来，离开时才收敛 ───────────
  const e1 = await page.evaluate((tag) => {
    const el = document.querySelector('input[data-v214="' + tag + '"]')
    el.focus(); el.value = '12.'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el.value
  }, TAG)
  await sleep(400)
  const e2 = await page.evaluate((tag) => {
    const el = document.querySelector('input[data-v214="' + tag + '"]')
    el.value = '12.'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  }, TAG)
  await sleep(400)
  const e3 = await page.evaluate((tag) => document.querySelector('input[data-v214="' + tag + '"]').value, TAG)
  ok(e1 === '12.', '中间态 `12.` 在输入过程中**被保留**（否则用户永远打不出小数点）', JSON.stringify(e1))
  ok(e3 === '12', '离开该格时收敛成 `12`（后端 _NUM_RE 要求小数点后必须有数字，不收敛会误判非数字）',
     'change 后=' + JSON.stringify(e3))

  // ─────────── F 单价格（decimal）：中文句号当小数点 ───────────
  const f1 = await page.evaluate((tag) => {
    const el = document.querySelector('input.cell-price')
    if (!el) return null
    el.setAttribute('data-v214p', tag)
    el.focus(); el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return { type: el.type, inputmode: el.getAttribute('inputmode') }
  }, TAG)
  if (f1) {
    await insertText('\uff11\uff12\u3002\uff15')   // １２。５
    await sleep(600)
    const f2 = await page.evaluate((tag) => document.querySelector('input[data-v214p="' + tag + '"]').value, TAG)
    ok(f2 === '12.5', '🔴 中文输入法打出的「１２。５」→「12.5」（`。` 是中文句号，NFKC **不转**，靠容错表）',
       JSON.stringify(f2) + '  （单价格 type=' + f1.type + '/' + f1.inputmode + '）')
  }

  // ─────────── 汇总 ───────────
  const bad = results.filter(r => !r.pass)
  console.log('\n' + '='.repeat(66))
  console.log('共 %d 条 · 通过 %d · 失败 %d', results.length, results.length - bad.length, bad.length)
  console.log(bad.length ? 'VERDICT: FAIL' : 'VERDICT: PASS  全角输入在真实浏览器/真实页面上已生效')
  await browser.close()
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
