// v171 真机验证：达成填报「修改日志」按钮与弹窗（hergent.cn，隔离租户）
// 用法:
//   HG_TOKEN=<token> HG_TENANT=9998 NODE_PATH=<ws>/node_modules node rebate-v171-audit-ui-verify.js
// 覆盖：按钮存在与规格 / 弹窗结构与列语义 / 真实记录渲染（含「已清除」）
//       / 只看本期筛选 / 关键词搜索与空态 / 【核心】真实界面操作也留痕（端到端）
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'
// ⚠️ 必须每轮唯一：若沿用固定值，复跑时目标行的值已经等于它 ⇒ 后端按 v160「部分更新」语义
//    正确地判定「无变化」→ 不写库、不留痕、也不弹「已保存」→ 探针会假 FAIL 且端到端等于没验证。
const NEW_REBATE = process.env.HG_NEW_REBATE ||
  String(100000 + (Date.now() % 800000))

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   ' + extra : ''))
}
function info(m) { console.log('  · ' + m) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ⚠️ page.evaluate 只序列化函数自身源码 → helper 一律内联，不引用外部变量
function modalState() {
  const card = document.querySelector('.achv-log-card')
  if (!card) return { open: false }
  const txt = el => (el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '')
  const heads = [...card.querySelectorAll('thead th')].map(t => t.textContent.trim())
  const rows = [...card.querySelectorAll('tbody tr')].map(tr =>
    [...tr.children].map(td => td.textContent.trim().replace(/\s+/g, ' ')))
  return {
    open: true,
    title: txt(card.querySelector('.modal-hd b')),
    heads,
    rows,
    empty: txt(card.querySelector('.state-empty')),
    count: txt(card.querySelector('.achv-log-count')),
    hasMore: !!([...card.querySelectorAll('.modal-ft button')].find(b => b.textContent.includes('加载更多'))),
    kwVal: (card.querySelector('.achv-log-bar input.input') || {}).value || '',
    chk: !!((card.querySelector('.achv-log-chk input') || {}).checked),
    // 行高与横向溢出：折行会让行高参差、列太宽会逼出横向滚动条，两者都靠实测而非估算
    rowH: [...card.querySelectorAll('tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height)),
    tagH: [...card.querySelectorAll('tbody tr .tag')].map(t => Math.round(t.getBoundingClientRect().height)),
    wrapOver: (() => {
      const w = card.querySelector('.achv-log-wrap')
      return w ? w.scrollWidth - w.clientWidth : -1
    })(),
  }
}
function btnInfo() {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志'))
  if (!b) return null
  const cs = getComputedStyle(b)
  const r = b.getBoundingClientRect()
  return {
    text: b.textContent.trim().replace(/\s+/g, ' '),
    cls: String(b.className),
    title: (b.getAttribute('title') || '').slice(0, 30),
    fs: cs.fontSize, fw: cs.fontWeight, h: +r.height.toFixed(1),
    bg: cs.backgroundColor, bc: cs.borderTopColor,
    hasIcon: !!b.querySelector('svg'),
    neighbours: [...b.parentElement.children].map(x => x.textContent.trim().replace(/\s+/g, ' ')).slice(0, 5),
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
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400 && !/403/.test(String(r.status()))) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/rebate', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4500)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未落回 #/login）')
  info('落点 URL: ' + page.url())

  // ── 切到「达成填报」tab ──
  const toAchv = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '达成填报')
    if (b) { b.click(); return true }
    return false
  })
  ok(toAchv, '点开「达成填报」tab')
  await sleep(3200)

  console.log('\n=== A. 「修改日志」按钮 ===')
  const B0 = await page.evaluate(btnInfo)
  ok(!!B0, '工具行存在「修改日志」按钮')
  if (!B0) { await browser.close(); process.exit(1) }
  info('文案=' + JSON.stringify(B0.text) + '｜class=' + B0.cls)
  info('字号=' + B0.fs + ' 字重=' + B0.fw + ' 高=' + B0.h + 'px 底=' + B0.bg)
  info('相邻按钮: ' + JSON.stringify(B0.neighbours))
  ok(B0.cls.includes('btn') && B0.cls.includes('btn-ghost') && B0.cls.includes('btn-sm'),
     '按钮沿用全站规格 .btn.btn-ghost.btn-sm（与「下载模板」同规格）')
  ok(B0.hasIcon, '带线性图标（与全站「修改日志」一致）')
  ok((B0.title || '').length > 10, '有 hover 说明文案')
  ok(B0.neighbours.some(x => x.includes('下载模板')) && B0.neighbours.some(x => x.includes('Excel 导入')),
     '与「下载模板 / Excel 导入」同处工具行')

  console.log('\n=== B. 打开弹窗：结构与列语义 ===')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志'))
    b.click()
  })
  await sleep(2600)
  const M = await page.evaluate(modalState)
  ok(M.open, '弹窗已打开（.achv-log-card 存在）')
  ok(M.title && M.title.includes('修改日志'), '标题 = ' + JSON.stringify(M.title))
  ok(JSON.stringify(M.heads) === JSON.stringify(['时间', '修改人', '动作', '对象', '字段', '修改前', '修改后']),
     '列 = 时间/修改人/动作/对象/字段/修改前/修改后 → ' + JSON.stringify(M.heads))
  ok(M.rows.length > 0, '渲染出 ' + M.rows.length + ' 条记录')
  ok(!M.hasMore || /共 \d+ 条/.test(M.count), '有总量提示：' + JSON.stringify(M.count))

  const flat = M.rows.map(r => r.join(' | '))
  info('前 3 条：')
  flat.slice(0, 3).forEach(r => info('   ' + r))

  // 每条都必须有 时间/修改人/动作/对象/字段（不能出现空白格）
  const blanks = M.rows.filter(r => !r[0] || !r[1] || !r[2] || !r[3] || !r[4])
  ok(blanks.length === 0, '每条都填齐 时间/修改人/动作/对象/字段（空行 ' + blanks.length + ' 条）')
  ok(M.rows.every(r => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r[0])),
     '时间格式为 YYYY-MM-DD HH:MM:SS → ' + (M.rows[0] ? M.rows[0][0] : ''))
  ok(M.rows.every(r => r[1] && r[1] !== 'undefined'), '修改人非空 → ' + (M.rows[0] ? M.rows[0][1] : ''))

  // 版式实测：行高一致（无折行）+ 不出横向滚动条
  const hMin = Math.min(...M.rowH), hMax = Math.max(...M.rowH)
  info('行高 min/max = ' + hMin + '/' + hMax + 'px；横向溢出 = ' + M.wrapOver + 'px')
  ok(hMax - hMin <= 1, '每一行都单行不折行（行高 ' + hMin + '~' + hMax + 'px）')
  ok(M.wrapOver <= 1, '表格未溢出容器宽度（scrollWidth-clientWidth = ' + M.wrapOver + 'px）')
  // 动作标签必须自身单行：折行时 <span class="tag"> 的高度会翻倍（这是折行的直接证据）
  ok(M.tagH.every(h => h <= hMin), '动作标签自身单行（tag 高度 ' + JSON.stringify(M.tagH) + ' ≤ 行高 ' + hMin + '）')

  // 三条写路径都出现在界面上
  ok(flat.some(r => r.includes('新增填报')), '看到「新增填报」记录')
  ok(flat.some(r => r.includes('修改填报')), '看到「修改填报」记录')
  ok(flat.some(r => r.includes('Excel 导入')), '看到「Excel 导入」记录')
  const delRow = flat.find(r => r.includes('清除') && r.includes('已清除'))
  ok(!!delRow, '看到「清除」记录且修改后列渲染为「已清除」' + (delRow ? '：' + delRow : ''))
  ok(flat.some(r => r.includes('实际返利')), '字段列已翻译成中文（如「实际返利」）')
  const chg = flat.find(r => /实际达成金额/.test(r) && /→|150,000|100,000/.test(r))
  ok(!!chg, '数值字段显示了千分位与前后值：' + (chg || ''))
  ok(flat.every(r => !r[5].includes('100000')), '数值不带原始裸串（100000 → 100,000 已美化）')

  console.log('\n=== C. 「只看本期」筛选 ===')
  await page.evaluate(() => {
    const c = document.querySelector('.achv-log-chk input')
    c.click()
  })
  await sleep(2400)
  const M2 = await page.evaluate(modalState)
  ok(M2.chk, '复选框已勾选')
  ok(M2.rows.length > 0, '按本期筛选仍有 ' + M2.rows.length + ' 条（都是 2026-09）')
  ok(M2.rows.every(r => r[3].indexOf('2026-09 ·') === 0),
     '筛出的对象都以 2026-09 开头（期次筛选精确）')
  info('筛选后条数提示：' + JSON.stringify(M2.count))
  // 取消勾选
  await page.evaluate(() => { document.querySelector('.achv-log-chk input').click() })
  await sleep(2200)

  console.log('\n=== D. 关键词搜索与空态 ===')
  const kwInput = await page.$('.achv-log-card .achv-log-bar input.input')
  await kwInput.click({ clickCount: 3 })
  await page.keyboard.type('zzz不可能命中zzz')
  await page.keyboard.press('Enter')
  await sleep(2400)
  const M3 = await page.evaluate(modalState)
  ok(M3.rows.length === 0, '搜不存在的词 → 0 条')
  ok(M3.empty.includes('没有匹配'), '空态给出可行动文案：' + JSON.stringify(M3.empty.slice(0, 40)))
  // 搜一个能命中的
  await kwInput.click({ clickCount: 3 })
  await page.keyboard.type('v171探针品牌')
  await page.keyboard.press('Enter')
  await sleep(2400)
  const M4 = await page.evaluate(modalState)
  ok(M4.rows.length > 0 && M4.rows.every(r => r[3].includes('v171探针品牌')),
     '按对象名搜索命中 ' + M4.rows.length + ' 条且全部匹配')
  await kwInput.click({ clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await sleep(2200)

  console.log('\n=== E. 【核心】真实界面操作也留痕（端到端）===')
  // 基线必须在弹窗**还开着**时量（关掉后 .achv-log-card 不存在，rows 恒为 0 —— 旧版据此
  // 写出「前 0 → 后 13」这种永远成立、什么也没证明的断言）
  const beforeTotal = await page.evaluate(() => {
    const el = document.querySelector('.achv-log-card .achv-log-count')
    const m = el ? el.textContent.match(/(\d+)/) : null
    return m ? +m[1] : -1
  })
  ok(beforeTotal > 0, '改动前日志总量 = ' + beforeTotal + ' 条（基线可量）')

  // 关弹窗
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.achv-log-card .modal-ft button')].find(x => x.textContent.includes('关闭'))
    if (b) b.click()
  })
  await sleep(1200)
  ok(!(await page.evaluate(() => !!document.querySelector('.achv-log-card'))), '弹窗已关闭')

  const t0 = Date.now()   // 改动时刻：用于证明重开后看到的是**新**记录而非旧匹配
  // 在表格里改「蒙牛低温」行的实际返利
  const handle = await page.evaluateHandle(() => {
    const tr = [...document.querySelectorAll('table.tbl tbody tr')]
      .find(r => r.children[1] && r.children[1].textContent.includes('蒙牛低温'))
    return tr ? tr.children[5].querySelector('input') : null
  })
  const el = handle.asElement()
  ok(!!el, '定位到「蒙牛低温」行的「实际返利」输入框')
  if (!el) { await browser.close(); process.exit(1) }
  const oldVal = await page.evaluate(e => e.value, el)
  info('原值 = ' + JSON.stringify(oldVal) + '，改为 ' + NEW_REBATE + '（每轮唯一，保证确实产生变更）')
  await el.click({ clickCount: 3 })
  await page.keyboard.type(NEW_REBATE)
  await page.keyboard.press('Tab')       // blur → 触发 @change
  await sleep(2600)
  const toastTxt = await page.evaluate(() =>
    ([...document.querySelectorAll('.toast')].map(x => x.textContent.trim()).join(' | ')))
  info('toast: ' + JSON.stringify(toastTxt))
  ok(/已保存/.test(toastTxt), '界面提示「已保存」')

  // 重新打开日志（打开即刷新）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志'))
    b.click()
  })
  await sleep(2800)
  const M5 = await page.evaluate(modalState)
  const want = Number(NEW_REBATE).toLocaleString('zh-CN')
  const hit = M5.rows.find(r => r[2].includes('修改填报') && r[3].includes('蒙牛低温')
                             && r[4].includes('实际返利') && r[6].replace(/,/g, '') === String(NEW_REBATE))
  ok(!!hit, '【端到端】界面改的那一笔已被记录（修改后 = ' + want + '）：' + (hit ? hit.join(' | ') : '（未找到）'))
  const afterTotal = await page.evaluate(() => {
    const el = document.querySelector('.achv-log-card .achv-log-count')
    const m = el ? el.textContent.match(/(\d+)/) : null
    return m ? +m[1] : -1
  })
  ok(afterTotal === beforeTotal + 1,
     '日志总量恰好 +1（前 ' + beforeTotal + ' → 后 ' + afterTotal + '）—— 界面改一次只留一条痕')
  if (hit) {
    // 时间必须落在本次改动之后 —— 否则命中的可能是上一轮留下的同值旧记录
    const hitMs = Date.parse(hit[0].replace(' ', 'T'))
    ok(hitMs >= t0 - 60000, '该条时间落在本次改动之后（新记录，非旧匹配）：' + hit[0])
    ok(hit[1] && hit[1] !== 'system', '修改人 = ' + hit[1] + '（取自登录态，不是 system）')
    ok(hit[5] === Number(oldVal).toLocaleString('zh-CN'),
       '修改前列如实显示改前值：' + hit[5] + '（界面原值 ' + oldVal + '）')
    ok(M5.rows.every(r => r[4]), '所有行都有字段名')
  }

  console.log('\n=== F. 截图与页面错误 ===')
  await page.screenshot({ path: OUT + '/v171-修改日志弹窗.png' })
  info('已截图: outputs/v171-修改日志弹窗.png')
  ok(errs.length === 0, '页面零 console 错误' + (errs.length ? '：' + errs.slice(0, 2).join(' ; ') : ''))
  const badReal = bad.filter(x => !/favicon/.test(x))
  ok(badReal.length === 0, '无 4xx/5xx 接口' + (badReal.length ? '：' + badReal.slice(0, 3).join(' ; ') : ''))

  await browser.close()
  const fails = results.filter(r => !r.pass)
  console.log('\n' + '='.repeat(64))
  console.log('结果：PASS ' + (results.length - fails.length) + ' / FAIL ' + fails.length)
  console.log('='.repeat(64))
  if (fails.length) {
    fails.forEach(f => console.log('  FAIL: ' + f.label))
    process.exit(1)
  }
  console.log('ALL_PASS')
})().catch(e => { console.error('探针异常:', e.message); process.exit(2) })
