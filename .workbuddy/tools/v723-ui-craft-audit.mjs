/**
 * v723-ui-craft-audit.mjs —— 「对标大厂」UI 工艺审计（只读，不改任何代码）
 *
 * 为什么需要这个探针：
 *   v717~v722 已经把「对比度 / 焦点环 / 令牌化 / 硬编码色 / 图标档位 / 表头冻结 /
 *   滚动区」这几条做完了。再往上走，"大厂差在哪"就落在**数据密度与可读性工艺**上，
 *   而这几个维度 grep 源码看不出来（各页自写一格样式、离线静态扫描不到运行时继承），
 *   必须上真机量渲染结果。
 *
 * 采五个维度（每条都有客观判据，不靠"看着挺好看"）：
 *   ① 数值对齐：ERP 里金额/数量列必须**右对齐 + 等宽数字 + 表头同侧**。
 *      混着左对齐时多行金额无法竖着比大小 —— 这是业务效率问题，不是审美。
 *   ② 行密度：表体行高应落在 32 / 36 / 40 三档之一且全站一致（同屏两档=手工压缩）。
 *   ③ 按钮同构：同一视觉层级的按钮高度应一致（差 2px 以上肉眼可见）。
 *   ④ 热区：图标按钮的可点区域 ≥ 24×24（WCAG 2.5.8 最低 24，Apple/Material 建议 44/48）。
 *   ⑤ 焦点可见：Tab 到第一个可聚焦控件，outline 是否真的可见（v718 做过，回归验证）。
 *
 * 用法：
 *   HG_TOKEN=<boss token> node .workbuddy/tools/v723-ui-craft-audit.mjs [--all]
 *   --all 跑全站清单；默认跑 10 个代表页（含列表 / 单据 / 报表 / 档案）。
 */

import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN || ''
if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }

const PAGES = [
  ['采购单列表', '/inventory/purchase', false],
  ['销售单列表', '/inventory/sale', false],
  ['库存查询', '/inventory/stock', false],
  ['商品档案', '/archive/products', false],
  ['客户档案', '/archive/customers', false],
  ['员工档案', '/archive/employees', false],
  ['工作台', '/workbench', false],
  ['目标与返利', '/rebate', false],
  ['销售订单汇总', '/reports/sales-order', false],
  ['收款单', '/funds/receipt', false],
  ['毛利分析', '/reports/gross-profit', false],
]

/** 页面内采集：表格数值列对齐 / 行高 / 按钮同构 / 热区 */
function PROBE() {
  const px = (v) => Math.round(parseFloat(v) || 0)

  /* ── ① 数值对齐 ─────────────────────────────────────────────
     只认「表体单元格文本以数字为主」的列：去掉千分位、￥¥$、%、空格、单位后
     剩下的字符里数字占比 ≥ 60% 且长度 ≥ 2 才算数值列。避免把「A123 客户」误判。 */
  const isNumericText = (t) => {
    const s = (t || '').trim()
    if (!s || s.length > 18) return false
    if (/^[\d.,\s]*%?$/.test(s) === false && !/[¥￥$]/.test(s)) {
      // 允许「12 件」「3.5 吨」这类带单一单位的
      if (!/^[¥￥$]?[\d,]+(\.\d+)?\s*[\u4e00-\u9fa5%]{0,2}$/.test(s)) return false
    }
    const digits = (s.match(/\d/g) || []).length
    return digits >= 2 && digits / s.replace(/\s/g, '').length >= 0.5
  }

  const tables = [...document.querySelectorAll('table')].filter(t => t.querySelector('tbody tr'))
  const numCols = []
  for (const t of tables.slice(0, 4)) {
    const head = [...t.querySelectorAll('thead th')].map(th => (th.innerText || '').trim())
    const bodyRows = [...t.querySelectorAll('tbody tr')].slice(0, 12)
    if (!bodyRows.length) continue
    const cols = bodyRows[0].children.length
    for (let c = 0; c < cols; c++) {
      const cells = bodyRows.map(r => r.children[c]).filter(Boolean)
      if (cells.length < 3) continue
      const hit = cells.filter(td => isNumericText(td.innerText)).length
      if (hit / cells.length < 0.7) continue
      const cs = getComputedStyle(cells[0])
      const thEl = t.querySelectorAll('thead th')[c]
      const hs = thEl ? getComputedStyle(thEl) : null
      /* 🔴 排除标识符列：「条码 / 登录账号 / 单号」形似数字但语义是字符串，
         右对齐 + 等宽反而更难核对（大厂规范也是左对齐）。v723 第一版漏判成缺陷。 */
      const hName = head[c] || ''
      if (/条码|编码|编号|账号|电话|手机|单号|货号|规格|代码|ID/i.test(hName)) continue
      numCols.push({
        h: head[c] || `#${c}`,
        align: cs.textAlign,
        thAlign: hs ? hs.textAlign : '-',
        tab: cs.fontVariantNumeric.includes('tabular-nums'),
        cls: (cells[0].className || '').slice(0, 24),
        sample: (cells[0].innerText || '').trim().slice(0, 12),
      })
    }
  }

  /* ── ② 表体行高（只取有表头的真数据表） ── */
  const rowHeights = []
  for (const t of tables.slice(0, 4)) {
    const tr = t.querySelector('tbody tr')
    if (!tr) continue
    const h = Math.round(tr.getBoundingClientRect().height)
    const td = tr.querySelector('td')
    const tds = td ? getComputedStyle(td) : null
    const pad = tds ? Math.round(parseFloat(tds.paddingTop) + parseFloat(tds.paddingBottom)) : -1
    const lh = tds ? Math.round(parseFloat(tds.lineHeight) || 0) : -1
    /* 判定：设定高 = padding + lineHeight（约等于实测 ⇒ 行高由样式决定，可统一）；
       实测远大于设定 ⇒ 被内容（多行地址/规格）撑高，属正常。 */
    if (h > 12 && h < 120) rowHeights.push({ h, pad, lh, set: pad + lh })
  }

  /* ── ③ 按钮同构：同屏 <button> 与外观看似按钮的 <a>/[role=button] ── */
  const btns = [...document.querySelectorAll('button, a.btn, [role="button"]')]
    .filter(b => {
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.height > 12 && getComputedStyle(b).visibility !== 'hidden'
    })
    .slice(0, 40)
  const btnH = {}
  const btnDetail = []
  for (const b of btns) {
    const h = Math.round(b.getBoundingClientRect().height)
    btnH[h] = (btnH[h] || 0) + 1
    if (btnDetail.length < 8) btnDetail.push({ t: (b.innerText || '').trim().slice(0, 8) || '(图标)', h, cls: (b.getAttribute('class') || '').slice(0, 20) })
  }

  /* ── ④ 热区：可见的纯图标控件（无文字或文字为空/单字符图标） ── */
  /* 🔴 只量真实控件容器：<svg> 是 SVGAnimatedString 的 className，且 16×16 图标装在
     32×32 按钮里是正常的 —— 直接量 svg 会虚报几百处（v723 第一版 357 个全是假阳性）。 */
  const small = []
  for (const el of document.querySelectorAll('button, a, [role="button"], .ico-btn')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const txt = (el.innerText || '').trim()
    if (txt.length > 1) continue           // 有文字的按钮热区天然够
    if (el.querySelector('svg') == null && txt.length === 0) continue
    if (r.width < 24 || r.height < 24) {
      small.push({ cls: (el.getAttribute('class') || el.tagName).slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) })
    }
  }

  /* ⑤ 焦点可见改由 Node 侧发真实 Tab 键测（见下方 TAB_FOCUS），
     程序化 .focus() 不匹配 :focus-visible ⇒ 会误报「焦点不可见」。 */

  return {
    tables: tables.length,
    numCols: numCols.slice(0, 14),
    rowHeights,
    density: document.documentElement.getAttribute('data-density') || '(未设)',
    btnH,
    btnDetail,
    small: small.slice(0, 10),
    smallN: small.length,
  }
}

/* 等 260ms 再采焦点（v718 教训：transition:all 会把 outline 动画带出来，采样到中间态） */
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await launch({ headless: true, executablePath: CHROME_DEFAULT })
const page = await browser.newPage()
await page.enable()

const cookies = [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]
for (const c of cookies) {
  await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })
}

const all = []
for (const [name, path] of PAGES) {
  await page.goto('https://hergent.cn/#' + path, 3200)
  await page.eval(`new Promise(r => setTimeout(r, 260))`)
  let r
  try { r = await page.eval(`(${PROBE.toString()})()`) } catch (e) { r = { err: String(e) } }

  /* ── 焦点：必须发**真实 Tab 键**。程序化 .focus() 不匹配 :focus-visible，
        量出来恒为 `outline:none`（v723 第一版 10 页全误报）。── */
  await page.eval('document.body.focus()')
  for (let i = 0; i < 3; i++) {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' })
  }
  await sleep(300)
  let foc
  try { foc = await page.eval(`(() => {
    const e = document.activeElement
    if (!e || e === document.body) return { none: true }
    const s = getComputedStyle(e)
    return {
      tag: e.tagName.toLowerCase(),
      cls: (e.getAttribute('class') || '').slice(0, 22),
      outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor.replace(/\s/g, ''),
      hasShadow: s.boxShadow !== 'none',
      visible: s.outlineStyle !== 'none' || s.boxShadow !== 'none',
    }
  })()`) } catch (e) { foc = { err: String(e) } }
  const bad = (r.numCols || []).filter(c => c.align !== 'right' || !c.tab)
  console.log(`\n· ${name}  表=${r.tables ?? '-'}  密度=${r.density}  按钮高=${JSON.stringify(r.btnH || {})}`)
  if (r.rowHeights?.length) console.log(`    行高/设定 ${JSON.stringify(r.rowHeights)}`)
  if (r.btnDetail?.length) console.log(`    按钮样例 ${JSON.stringify(r.btnDetail.slice(0, 5))}`)
  if (r.numCols?.length) {
    for (const c of r.numCols) {
      const ok = c.align === 'right' && c.tab
      console.log(`    ${ok ? '✅' : '🔴'} 数值列「${c.h}」align=${c.align} th=${c.thAlign} 等宽=${c.tab} 样例=${c.sample}`)
    }
  } else console.log('    （无识别到的数值列）')
  if (r.smallN) console.log(`    ⚠️ 热区<24px 的图标控件 ${r.smallN} 个 ${JSON.stringify(r.small.slice(0, 4))}`)
  console.log(`    焦点(真Tab×3): ${JSON.stringify(foc)}`)
  all.push({ name, path, ...r, bad: bad.length, foc })
}

/* ── 汇总 ── */
console.log('\n══════════ 汇总 ══════════')
const totNum = all.reduce((s, p) => s + (p.numCols?.length || 0), 0)
const totBad = all.reduce((s, p) => s + (p.bad || 0), 0)
console.log(`数值列 ${totNum} 个，其中未右对齐或非等宽 ${totBad} 个`)
const rh = []
for (const p of all) for (const x of (p.rowHeights || [])) rh.push(x)
console.log('表体行高（实测 / padding+lineHeight=设定 / 密度）：')
for (const p of all) console.log(`  ${p.name.padEnd(8)} 密度=${(p.density || '').padEnd(8)} ${JSON.stringify(p.rowHeights || [])}`)
const bh = {}
for (const p of all) for (const [h, n] of Object.entries(p.btnH || {})) bh[h] = (bh[h] || 0) + n
console.log(`按钮高度出现分布：${JSON.stringify(bh)}`)
console.log(`热区<24px 合计：${all.reduce((s, p) => s + (p.smallN || 0), 0)}`)
const fv = all.filter(p => p.foc && !p.foc.none && !p.foc.err)
const badF = fv.filter(p => !p.foc.visible)
console.log(`焦点环：测到 ${fv.length} 页，不可见 ${badF.length} 页 ${JSON.stringify(badF.map(p => p.name))}`)


await browser.close()
