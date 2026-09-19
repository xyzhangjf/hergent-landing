// v171b 真机验证（空态场景）：达成填报「修改日志」在**没有任何记录**时的文案。
//
// 为什么单独一个探针：主探针 rebate-v171-audit-ui-verify.js 要求沙箱里已有留痕记录
// （它断言「看到新增填报 / Excel 导入 / 清除」），因此永远看不到空态分支。
// 而被本轮删掉的那句「本页的填报 / 修改 / 清除 / 导入都会自动记录在这里」只在空态出现 ——
// 只有全新沙箱的第一屏能验证它。所以：
//   ① 沙箱刚建好、还没播种 → 跑本探针（本文件）
//   ② 跑后端 E2E 探针播种 → 跑主探针
//
// ⚠️ 必须用**全新沙箱**：若日志已有记录，第 1 条断言会失败（这是有意为之，不是探针 bug）。
//
// 用法：HG_TOKEN=<沙箱令牌> HG_TENANT=9997 node rebate-v171-empty-ui-verify.js
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const TOKEN = process.env.HG_TOKEN || ''
const TENANT = process.env.HG_TENANT || ''
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function ok(pass, label) {
  results.push({ pass: !!pass, label })
  console.log('  ' + (pass ? '✓' : '✗ FAIL') + ' ' + label)
}
function info(t) { console.log('    · ' + t) }

// 弹窗内的空态与正文（page.evaluate 只序列化函数自身源码 ⇒ helper 必须内联）
function emptyState() {
  const card = document.querySelector('.achv-log-card')
  if (!card) return { open: false }
  const txt = el => (el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '')
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志'))
  return {
    open: true,
    empty: txt(card.querySelector('.state-empty')),
    tips: card.querySelectorAll('.achv-tip').length,
    body: txt(card.querySelector('.achv-log-body')),
    rows: card.querySelectorAll('tbody tr').length,
    bar: txt(card.querySelector('.achv-log-bar')),
    // ⚠️ textContent 拿不到 <input> 的 placeholder —— 搜索框是否在必须读属性，不能读文本
    ph: (card.querySelector('.achv-log-bar input.input') || {}).placeholder || '',
    titleLen: btn ? (btn.getAttribute('title') || '').length : -1,
  }
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],   // ⚠️ 绝不加 --proxy-server
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/rebate', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4500)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未落回 #/login）')

  const toAchv = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '达成填报')
    if (b) { b.click(); return true }
    return false
  })
  ok(toAchv, '点开「达成填报」tab')
  await sleep(3200)

  console.log('\n=== 空态：打开日志（全新沙箱，尚无任何记录）===')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志'))
    b.click()
  })
  await sleep(2800)
  const M = await page.evaluate(emptyState)
  ok(M.open, '弹窗已打开')
  if (!M.open) { await browser.close(); process.exit(1) }
  ok(M.titleLen === 0, '按钮无 hover 说明文案（title 长度 ' + M.titleLen + '）')
  ok(M.rows === 0, '沙箱开局确实零记录（空态场景成立）')
  ok(M.tips === 0, '弹窗内已无说明段落（.achv-tip 命中 ' + M.tips + ' 处）')
  info('空态文案 = ' + JSON.stringify(M.empty))
  ok(M.empty === '还没有修改记录。',
     '空态文案精简为「还没有修改记录。」（不含「都会自动记录在这里」）')
  ok(!/自动|留痕|只记|都会/.test(M.empty), '空态不含任何机制说明')
  ok(!/自动留痕|只记|都会自动|真实变化/.test(M.body), '弹窗正文不含机制说明文字')
  // 搜索栏必须仍在（删的是说明段落，不是功能）
  ok(/搜索 修改人/.test(M.ph), '搜索框仍在，placeholder = ' + JSON.stringify(M.ph))
  ok(/只看本期/.test(M.bar) && /刷新/.test(M.bar),
     '「只看本期 / 刷新」仍在：' + JSON.stringify(M.bar))

  const shot = OUT + '/v171b-修改日志空态.png'
  await page.screenshot({ path: shot })
  info('已截图: ' + shot)
  ok(errs.length === 0, '页面零 console 错误' + (errs.length ? '：' + errs.slice(0, 2).join(' ; ') : ''))

  await browser.close()
  const fails = results.filter(r => !r.pass)
  console.log('\n' + '='.repeat(64))
  console.log('结果：PASS ' + (results.length - fails.length) + ' / FAIL ' + fails.length)
  console.log('='.repeat(64))
  if (fails.length) { fails.forEach(f => console.log('  FAIL: ' + f.label)); process.exit(1) }
  console.log('ALL_PASS')
})().catch(e => { console.error('探针异常:', e.message); process.exit(2) })
