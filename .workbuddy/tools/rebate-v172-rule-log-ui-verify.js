// v172 真机验证：「目标与返利」页（返利规则）的「修改日志」按钮与弹窗（hergent.cn，隔离租户）
// 用法:
//   HG_TOKEN=<token> HG_TENANT=9998 NODE_PATH=<ws>/node_modules node rebate-v172-rule-log-ui-verify.js
// 覆盖：按钮规格 / 弹窗 7 列 / 真实规则记录渲染（含中文标签与 numeric 千分位）
//       / 规则页**不该有**「只看本期」/ 关键词搜索 / 【核心】界面点「停用」也留痕（端到端）
//       / 【回归】达成填报页的弹窗仍完好（有「只看本期」、数据源不同）
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'

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
    // 规则页不该有「只看本期」（规则没有期次概念）→ 用元素个数而非布尔，能区分"渲染了但没勾"
    chkCount: card.querySelectorAll('.achv-log-chk').length,
    kwPlaceholder: (() => {
      const i = card.querySelector('.achv-log-bar input.input')
      return i ? (i.getAttribute('placeholder') || '') : ''
    })(),
    rowH: [...card.querySelectorAll('tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height)),
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
    title: (b.getAttribute('title') || ''),
    h: +r.height.toFixed(1),
    hasIcon: !!b.querySelector('svg'),
    neighbours: [...b.parentElement.children].map(x => x.textContent.trim().replace(/\s+/g, ' ')).slice(0, 4),
  }
}
function clickMainTab(name) {
  const b = [...document.querySelectorAll('.main-tabs button')].find(x => x.textContent.trim() === name)
  if (b) { b.click(); return true }
  return false
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => {
    if (r.status() >= 400 && !/403/.test(String(r.status()))) bad.push(r.status() + ' ' + r.url().slice(0, 120))
  })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/rebate', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4500)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未落回 #/login）')
  info('落点 URL: ' + page.url())

  // ── 切到「目标与返利」tab（达成填报的前一个）──
  ok(await page.evaluate(clickMainTab, '目标与返利'), '点开「目标与返利」tab')
  await sleep(3200)

  console.log('\n=== A. 本页工具栏的「修改日志」按钮 ===')
  const B0 = await page.evaluate(btnInfo)
  ok(!!B0, '「目标与返利」页工具行存在「修改日志」按钮')
  if (!B0) { await browser.close(); process.exit(1) }
  info('文案=' + JSON.stringify(B0.text) + '｜class=' + B0.cls)
  info('相邻按钮: ' + JSON.stringify(B0.neighbours))
  ok(B0.cls.includes('btn') && B0.cls.includes('btn-ghost'), '按钮符合全站规格（与同排「试算」同规格）')
  ok(B0.hasIcon, '带线性图标')
  ok(B0.title === '', '无悬停说明文案（沿用上一轮"可由操作自证的不写说明"判据）')
  ok(B0.neighbours.some(x => x.includes('试算')), '与「试算」同排（都在工具行右侧）')

  console.log('\n=== B. 打开弹窗：结构与本页语义 ===')
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志')).click()
  })
  await sleep(3000)
  const M = await page.evaluate(modalState)
  ok(M.open, '弹窗已打开')
  if (!M.open) { await browser.close(); process.exit(1) }
  ok((M.title || '').includes('修改日志'), '标题 = ' + JSON.stringify(M.title))
  info('列 = ' + JSON.stringify(M.heads))
  ok(M.heads.length === 7
     && ['时间', '修改人', '动作', '对象', '字段', '修改前', '修改后'].every((h, i) => M.heads[i] === h),
     '★ 7 列且语义完整：' + JSON.stringify(M.heads))
  ok(M.chkCount === 0, '★ 规则页不显示「只看本期」（规则没有期次概念）—— 实际 ' + M.chkCount + ' 个')
  info('搜索框 placeholder = ' + JSON.stringify(M.kwPlaceholder))
  ok(!!M.kwPlaceholder, '搜索框在位')

  console.log('\n=== C. 真实规则记录渲染 ===')
  ok(M.rows.length > 0, '渲染出 ' + M.rows.length + ' 条记录')
  info('首行: ' + JSON.stringify(M.rows[0]))
  ok(M.rows.every(r => r[0] && r[1] && r[3] && r[4]), '每行都有 时间/修改人/对象/字段')
  const acts = [...new Set(M.rows.map(r => r[2]))]
  info('出现过的动作: ' + JSON.stringify(acts))
  ok(acts.every(a => /新增目标|修改目标|删除目标|新增档位版本|删除档位版本/.test(a)),
     '★ 动作全部译成中文业务用语（无 create/update 生码）')
  ok(M.rows.every(r => !/^[a-z_]+$/.test(r[4])), '★ 字段名全部译成中文（无 rebate_rate 生码）')
  const fields = [...new Set(M.rows.map(r => r[4]))]
  info('出现过的字段: ' + JSON.stringify(fields.slice(0, 12)))
  ok(fields.some(f => f === '返利比例'), '含「返利比例」这类业务字段名')
  ok(/共 \d+ 条/.test(M.count), '统计行 = ' + JSON.stringify(M.count))
  ok(M.wrapOver <= 1, '表格未溢出容器宽度（scrollWidth-clientWidth=' + M.wrapOver + 'px）')
  const uniqH = [...new Set(M.rowH)]
  ok(uniqH.length <= 2, '行高一致（' + JSON.stringify(uniqH) + 'px）—— 无折行造成的参差')

  console.log('\n=== D. numeric 渲染：数字加千分位、序号型不加 ===')
  const numRow = M.rows.find(r => r[4] === '目标值')
  if (numRow) {
    info('目标值行: ' + JSON.stringify(numRow))
    ok(/^\d[\d,]*$/.test(numRow[6]) && (numRow[6].includes(',') || Number(numRow[6]) < 10000),
       '目标值按数字渲染（' + numRow[6] + '）')
  } else {
    info('（本页当前没有「目标值」记录，跳过该断言）')
  }
  const yearRow = M.rows.find(r => r[4] === '目标年度')
  if (yearRow) {
    info('目标年度行: ' + JSON.stringify(yearRow))
    ok(!yearRow[6].includes(','), '★ 年份未被千分位（' + yearRow[6] + '，不是 2,026）')
  } else {
    info('（本页当前没有「目标年度」记录，跳过该断言）')
  }

  await page.screenshot({ path: OUT + '/v172-规则修改日志弹窗.png' })
  info('截图 → outputs/v172-规则修改日志弹窗.png')

  console.log('\n=== E. 关键词搜索（按规则名）===')
  const nameHit = M.rows[0][3]
  info('用首行的规则名搜索: ' + JSON.stringify(nameHit))
  await page.evaluate((kw) => {
    const i = document.querySelector('.achv-log-card .achv-log-bar input.input')
    i.value = kw
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }, nameHit)
  await sleep(400)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.achv-log-card .modal-ft button, .achv-log-card .achv-log-bar button')]
      .find(x => x.textContent.includes('刷新'))
    b.click()
  })
  await sleep(2200)
  const MS = await page.evaluate(modalState)
  ok(MS.rows.length > 0 && MS.rows.every(r => r[3] === nameHit),
     '搜索「' + nameHit + '」命中 ' + MS.rows.length + ' 条，且全是该规则')
  await page.evaluate((kw) => {
    const i = document.querySelector('.achv-log-card .achv-log-bar input.input')
    i.value = kw
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }, 'zzz不可能命中zzz')
  await sleep(400)
  await page.evaluate(() => {
    [...document.querySelectorAll('.achv-log-card button')].find(x => x.textContent.includes('刷新')).click()
  })
  await sleep(2200)
  const MZ = await page.evaluate(modalState)
  ok(MZ.rows.length === 0 && /没有匹配/.test(MZ.empty),
     '空态文案 = ' + JSON.stringify(MZ.empty))

  // 关弹窗（清搜索）
  await page.evaluate(() => {
    [...document.querySelectorAll('.achv-log-card .modal-ft button')].find(x => x.textContent.includes('关闭')).click()
  })
  await sleep(1200)
  ok(!(await page.evaluate(() => !!document.querySelector('.achv-log-card'))), '弹窗已关闭')

  console.log('\n=== F. 【核心】真实界面操作也留痕（端到端）===')
  // ── F 段两条必须遵守的写法（均为 2026-09-15 实测踩出来的）──
  // ① 🔴 操作规则列表前**必须先关掉日志弹窗**：弹窗是遮罩层，`el.click()` 按坐标派发，
  //    会被遮罩整个吃掉 —— 症状是「按钮找到了、也点了，却什么都没发生」（后端零请求、
  //    界面零变化）。本轮复原那一步就栽在这里：DB 里规则仍是 is_active=0，探针却以为点过了。
  //    ⚠️ 这类失败极像产品缺陷（"启用按钮点了没反应"），实际是探针自己没关弹窗。
  // ② 判「界面反馈」不要读 `.toast`：2.8s 后 toast 已消失，读数恒为 ""，会假 FAIL。
  //    改判**可稳定观测的状态翻转**——该行的按钮由「停用」变「启用」。
  const closeLog = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.achv-log-card .modal-ft button')]
        .find(x => x.textContent.includes('关闭'))
      if (b) b.click()
    })
    await sleep(1200)
  }
  const openLog = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志')).click()
    })
    await sleep(2800)
  }
  // 开→读→关（关掉才不会挡住后续对列表的点击）
  const readLog = async () => {
    await openLog()
    const m = await page.evaluate(modalState)
    await closeLog()
    return m
  }

  // 在规则列表里点一条**启用中**规则的「停用」。
  // ⚠️ 不能写死"第一行"：上一轮若复原失败，第一行可能已是停用态（只剩「启用」按钮），
  //    于是本轮取到 null 直接崩。改为"找任意一条带「停用」按钮的行"。
  // rowName 非空时只在**该规则的这一行**里找（复原必须回同一条规则；
  // 否则会命中另一条恰好也处于停用态的行 → 断言"复原成功"但真正被停用的那条仍停用）
  const findBtn = async (label, rowName) => {
    const h = await page.evaluateHandle((txt, rn) => {
      for (const tr of document.querySelectorAll('.list-card table.tbl tbody tr')) {
        if (rn && tr.children[0].textContent.trim() !== rn) continue
        const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === txt)
        if (b) return b
      }
      return null
    }, label, rowName || '')
    return h.asElement()
  }
  let el = await findBtn('停用')
  if (!el) {
    // ⚠️ 这一步本身就会产生一条留痕（已停用→已启用）→ 基线必须在它**之后**读，
    //    否则「记录数恰好 +1」会被这一步多加的一条顶掉（本轮实测：39 → 41，误判 FAIL）。
    info('没有启用中的规则 → 先把一条启用了再测（这一步也会留痕）')
    const en = await findBtn('启用')
    if (en) { await en.click(); await sleep(2600) }
    el = await findBtn('停用')
  }
  ok(!!el, '定位到一条启用中规则的「停用」按钮')
  if (!el) { await browser.close(); process.exit(1) }
  const ruleName = await page.evaluate(e => {
    const tr = e.closest('tr')
    return tr.children[0].textContent.trim()
  }, el)
  info('将停用规则: ' + JSON.stringify(ruleName))
  const before = (await readLog()).rows.length   // 基线（准备步已计入）
  info('基线记录数 = ' + before)

  await el.click()
  await sleep(2800)
  const toastTxt = await page.evaluate(() =>
    ([...document.querySelectorAll('.toast')].map(x => x.textContent.trim()).join(' | ')))
  info('toast（仅记录，不作判据）: ' + JSON.stringify(toastTxt))
  ok(!!(await findBtn('启用', ruleName)), '★ 界面反馈：该规则按钮已翻转为「启用」（= 停用已生效）')

  // 重开日志（这次先不关 —— 后面的截图要拍到这条新记录）
  await openLog()
  let M2 = await page.evaluate(modalState)
  info('操作后记录数 = ' + M2.rows.length + '（基线 ' + before + '）')
  if (M2.rows.length === before) {
    // ⚠️ 生产上「并发部署 / 重启后端」会让这一枪吃到 502（弹窗 toast「载入失败」且**保留旧列表**，
    //    所以条数看起来"没变"）。这**不是**"没留痕"——必须把「后端瞬断」与「真没写」分开：
    //    刷新一次重读，只有重读后仍没变才算 FAIL。（2026-09-15 实测：并发会话 23:08:18 重启后端，
    //    而 PUT 在 23:08:17 已 200、留痕已落库。）
    const lt = await page.evaluate(() =>
      ([...document.querySelectorAll('.toast')].map(x => x.textContent.trim()).join(' | ')))
    info('⚠ 条数未增加（toast=' + JSON.stringify(lt) + '）→ 判为疑似瞬断，刷新后重读一次')
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.achv-log-card button')].find(x => x.textContent.includes('刷新'))
      if (b) b.click()
    })
    await sleep(3000)
    M2 = await page.evaluate(modalState)
    info('重读后记录数 = ' + M2.rows.length)
  }
  ok(M2.rows.length === before + 1, '★ 记录数恰好 +1（新增了这一次操作）')
  const hit = M2.rows.find(r => r[3] === ruleName && r[4] === '启用'
                             && r[5] === '已启用' && r[6] === '已停用')
  ok(!!hit, '★【端到端】界面点「停用」这个动作已被记录：' + (hit ? hit.join(' | ') : '（未找到）'))
  if (hit) {
    ok(hit[1] && hit[1] !== 'system', '修改人取自登录态 = ' + hit[1])
    ok(hit[2] === '修改目标', '动作 = ' + hit[2] + '（软删等同「停用」，归为修改）')
  }

  await page.screenshot({ path: OUT + '/v172-规则修改日志-端到端.png' })
  await closeLog()   // 🔴 必须先关弹窗，否则下面点列表按钮会被遮罩吃掉（见 F 段开头 ①）

  // 复原：重新启用（顺带把「启用」这条写路径也验了）。
  // ⚠️ 必须**受断言保护** —— 静默失败会把沙箱留在停用态，下一轮的准备步会被多绕一圈
  // （本轮即是这样踩到的：早先那版复原只有一句 info，失败无人知晓）。
  const el2 = await findBtn('启用', ruleName)
  ok(!!el2, '找到**同一条规则**的「启用」按钮（准备复原）')
  if (el2) {
    await el2.click()
    await sleep(2800)
    let back = !!(await findBtn('停用', ruleName))
    if (!back) {
      // 瞬断（并发部署会重启后端）或点击未命中 → 重试一次再判，避免把环境噪音记成产品缺陷
      info('⚠ 复原第一次未生效 → 2.5 秒后重试一次')
      await sleep(2500)
      await el2.click()
      await sleep(2800)
      back = !!(await findBtn('停用', ruleName))
    }
    const t2 = await page.evaluate(() =>
      ([...document.querySelectorAll('.toast')].map(x => x.textContent.trim()).join(' | ')))
    info('复原 toast（仅记录）: ' + JSON.stringify(t2))
    ok(back, '★ 复原成功：该规则按钮恢复为「停用」（= 仍启用中，沙箱可复跑）')
    if (!back) info('⚠ 复原失败：需查明原因，否则下一轮 F 段会多绕一步')
  }

  console.log('\n=== G. 【回归】达成填报页的弹窗仍完好 ===')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.achv-log-card .modal-ft button')].find(x => x.textContent.includes('关闭'))
    if (b) b.click()
  })
  await sleep(1200)
  ok(await page.evaluate(clickMainTab, '达成填报'), '切到「达成填报」tab')
  await sleep(3000)
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(x => x.textContent.includes('修改日志')).click()
  })
  await sleep(2600)
  const MA = await page.evaluate(modalState)
  // ⚠️ 沙箱里达成填报没有记录 ⇒ 弹窗只渲染空态、没有 <table>，heads 为空是**正常**的。
  // 断言必须能区分「空态」与「坏了」：要么有 7 列表头，要么是正确的空态文案。
  ok(MA.open && (MA.heads.length === 7 || /还没有修改记录|没有匹配/.test(MA.empty || '')),
     '达成填报的弹窗仍正常（' + (MA.heads.length === 7 ? '7 列' : '空态：' + MA.empty) + '）')
  ok(MA.chkCount === 1, '★ 达成填报页仍保留「只看本期」（两页签共用一个弹窗但筛选集不同）')
  info('达成填报页空态/内容: ' + JSON.stringify((MA.empty || MA.rows[0] || '').toString().slice(0, 70)))
  await page.screenshot({ path: OUT + '/v172-达成填报弹窗-回归.png' })

  console.log('\n=== H. 运行期健康 ===')
  // 🔴 502/503/504 = 网关拿不到后端（并发部署/重启窗口），**不是前端缺陷**，必须单列；
  //    但它也不能被静默吞掉 —— 打印出来，并要求去 journal 里找到同时刻的 systemd restart 才能归为环境噪音。
  const ENV = /502|503|504/
  const envErrs = errs.filter(e => ENV.test(e))
  const realErrs = errs.filter(e => !ENV.test(e))
  ok(realErrs.length === 0, '零 console 错误（已剔除 502/503/504 网关类）',
     realErrs.length ? JSON.stringify(realErrs.slice(0, 3)) : '')
  if (envErrs.length) info('⚠ 网关类 console 错误 ' + envErrs.length + ' 条 → 需 journal 佐证为重启窗口: ' + JSON.stringify(envErrs.slice(0, 2)))
  const badShown = bad.filter(u => !ENV.test(u))
  ok(badShown.length === 0, '无 4xx/5xx 资源请求（已剔除 502/503/504）', badShown.length ? JSON.stringify(badShown.slice(0, 3)) : '')
  const envBad = bad.filter(u => ENV.test(u))
  if (envBad.length) info('⚠ 网关类请求 ' + envBad.length + ' 条 → 同上: ' + JSON.stringify(envBad.slice(0, 2)))
  if (bad.length) info('（含预期的 404/audit 探测: ' + JSON.stringify(bad.slice(0, 2)) + '）')

  const P = results.filter(r => r.pass).length
  const F = results.length - P
  console.log('\n结果：PASS ' + P + ' / FAIL ' + F)
  await browser.close()
  process.exit(F ? 1 : 0)
})()
