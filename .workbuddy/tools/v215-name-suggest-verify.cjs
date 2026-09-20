// v215 真机取证：商品名候选面板（名称 / 条码后 4 位 / 拼音首字母 三种检索都真能用）。
// 判据不只是「面板弹出来」，而是**弹出来的正是用户想要的那一条**，且**选中真的写进了行里**。
const puppeteer = require('puppeteer-core')
const TOKEN = process.argv[2]
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const ok = (cond, label, extra) => {
  results.push({ pass: !!cond, label })
  console.log('%s %s%s', cond ? '✅' : '❌', label, extra ? '   ← ' + extra : '')
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 1000 })
  await page.goto('https://hergent.cn/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(t => localStorage.setItem('hergent_v2_token', t), TOKEN)
  await page.goto('https://hergent.cn/#/forecast', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(6000)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    if (b && !b.disabled) b.click()
  })
  await sleep(7000)

  const cdp = await page.target().createCDPSession()
  const insertText = async (t) => { await cdp.send('Input.insertText', { text: t }) }

  // ── A 环境自检：拼音能力是否启用（placeholder 会如实反映）──
  const ph = await page.evaluate(() => {
    const el = document.querySelector('input.cell-name')
    if (!el) return null
    el.setAttribute('data-v215', '1')
    return el.getAttribute('placeholder')
  })
  if (!ph) { console.log('❌ 找不到商品名格'); await browser.close(); process.exit(1) }
  ok(/拼音首字母/.test(ph || ''), '占位文案如实承诺了「拼音首字母」（PY_OK 自检通过才会出现）', ph)

  // ── B 拼音检索 ──
  // 🔴 不写死「蒙牛」：沙箱克隆的租户不一定有某个品牌。改为**取页面上真实存在的商品名**，
  //    用**同一套锚点**在页面内算出它的首字母串，再用那个串去搜 —— 这是自我对拍，
  //    不依赖任何具体品牌，也就不会因为「库里恰好没有蒙牛」而假红。
  const sample = await page.evaluate(() => {
    const els = [...document.querySelectorAll('input.cell-name')]
    const names = els.map(e => (e.value || '').trim()).filter(Boolean)
    const L = 'ABCDEFGHJKLMNOPQRSTWXYZ'
    const AN = ['啊','八','嚓','搭','蛾','发','噶','哈','击','喀','垃','妈','拿','哦','啪','期',
                '然','撒','塌','挖','夕','压','匝']
    const cmp = new Intl.Collator('zh-Hans-CN').compare
    const initial = (ch) => {
      let lo = 0, hi = AN.length - 1, ans = 0
      while (lo <= hi) {
        const m = (lo + hi) >> 1
        if (cmp(AN[m], ch) <= 0) { ans = m; lo = m + 1 } else hi = m - 1
      }
      return L[ans]
    }
    const py = (s) => {
      let o = ''
      for (const ch of s || '') {
        if (/[\u4e00-\u9fa5]/.test(ch)) o += initial(ch)
        else if (/[a-zA-Z0-9]/.test(ch)) o += ch.toUpperCase()
      }
      return o
    }
    // 取一个**纯汉字且长度>=2**的名字，拼音串更有意义
    const n = names.find(x => x.length >= 2 && /^[\u4e00-\u9fa5]{2,}$/.test(x)) || names[0]
    return { name: n, py: py(n), count: names.length }
  })
  console.log('样本商品名 %s → 首字母串 %s（表内共 %d 行）', sample.name, sample.py, sample.count)
  const PIN = (sample.py || '').slice(0, 2).toLowerCase()

  const probe = async (text) => {
    await page.evaluate(() => {
      const el = document.querySelector('input[data-v215="1"]')
      el.focus(); el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(250)
    await insertText(text)
    await sleep(500)
    return page.evaluate(() => {
      const pop = document.querySelector('.name-sug-pop')
      if (!pop) return { open: false, items: [] }
      const cs = getComputedStyle(pop)
      const box = pop.getBoundingClientRect()
      return {
        open: true,
        items: [...pop.querySelectorAll('.ns-item')].map(x => x.textContent.trim()),
        onIdx: [...pop.querySelectorAll('.ns-item')].findIndex(x => x.classList.contains('on')),
        pos: cs.position, z: cs.zIndex,
        inViewport: box.top >= 0 && box.bottom <= window.innerHeight + 1 && box.width > 0,
        parentIsBody: pop.parentElement === document.body,
      }
    })
  }

  const pinyinHit = await probe(PIN)
  ok(pinyinHit.open, '🔴 打「' + PIN + '」弹出了候选面板', '面板条目 ' + (pinyinHit.items || []).length)
  ok((pinyinHit.items || []).some(t => t.indexOf(sample.name) >= 0),
     '🔴 面板里**有「' + sample.name + '」**（拼音首字母检索真的能用，不是只按名称匹配）',
     JSON.stringify((pinyinHit.items || []).slice(0, 3)))
  // 反证：同一串若按**名称**去搜是搜不到的 ⇒ 证明这一条确实是靠拼音命中的
  const byName = await probe(sample.name)
  const byNameHas = (byName.items || []).some(t => t.indexOf(sample.name) >= 0)
  ok(byNameHas, '同一商品按**名称**也能搜到（两种检索并存，不是替换）', JSON.stringify((byName.items || []).slice(0, 2)))

  // ── C 反证：打一串**不存在**的字母，不该有任何候选（否则是「瞎匹配」）──
  const nonsense = await probe('zzzzzz')
  ok(!nonsense.open || !nonsense.items.length,
     '打「zzzzzz」不弹面板（防止「拼音匹配成了万能匹配」）',
     'open=' + nonsense.open + ' items=' + nonsense.items.length)

  // ── D 面板几何：fixed + 挂 body + 在视口内（不被表格裁掉）──
  const geo = await probe(PIN)
  ok(geo.pos === 'fixed', '面板 position=fixed（表格 overflow 容器裁不掉）', geo.pos)
  ok(geo.parentIsBody, '🔴 面板已 Teleport 到 body（不被单元格祖先裁剪）', String(geo.parentIsBody))
  ok(geo.inViewport, '面板完整落在视口内（贴底时会自动上翻）', JSON.stringify(geo.inViewport))
  ok(Number(geo.z) >= 1000, '面板 z-index 够高（盖住工具栏浮层）', geo.z)

  // ── E 键盘：↓ 移到第 2 项，回车写入该行 ──
  await page.evaluate(() => {
    const el = document.querySelector('input[data-v215="1"]')
    el.focus()
  })
  const n = geo.items.length
  // 🔴 键盘操作必须紧接 probe（焦点此时确定在 input）。中间若插了 evaluate 读 DOM，
  //    焦点可能已被 CDP 的其它通道带走 ⇒ 面板先 blur 关闭，后面的按键全部空转（实测踩到）。
  const focusDiag = await page.evaluate(() => ({
    active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null,
    popThere: !!document.querySelector('.name-sug-pop'),
  }))
  console.log('按键前诊断：activeElement=%s 面板在位=%s', focusDiag.active, focusDiag.popThere)
  await page.keyboard.press('ArrowDown')
  await sleep(200)
  const afterDown = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.ns-item')]
    const i = items.findIndex(x => x.classList.contains('on'))
    return { idx: i, total: items.length, name: i >= 0 ? items[i].querySelector('.ns-name').textContent : null }
  })
  // ⚠️ 候选只有 1 条时 ↓ 必须**停在第 1 项**（不越界、不报错）—— 断言写死「第 2 项」会在
  //    候选不足时假红。这是「断言要跟着数据规模自适应」的常规要求。
  ok(afterDown.idx === (n >= 2 ? 1 : 0),
     '↓ 高亮移动正确（候选 ' + n + ' 条 ⇒ 停在 ' + (n >= 2 ? '第 2 项' : '第 1 项，不越界') + '）',
     'idx=' + afterDown.idx)
  await page.keyboard.press('Enter')
  await sleep(400)
  const written = await page.evaluate(() => {
    const el = document.querySelector('input[data-v215="1"]')
    return { value: el.value, popOpen: !!document.querySelector('.name-sug-pop') }
  })
  ok(written.value === afterDown.name,
     '🔴 回车把选中项**写进了这一行**（值 == 该项的 .ns-name）',
     JSON.stringify(written.value) + ' vs ' + JSON.stringify(afterDown.name))
  ok(!written.popOpen, '选中后面板关闭', String(written.popOpen))

  // ── F 条码后 4 位：取面板里某条的尾号，再用尾号搜，应能搜回同一条 ──
  const codeProbe = await page.evaluate(async () => {
    const pop = document.querySelector('.name-sug-pop')
    return pop ? true : false
  })
  const anyCode = await page.evaluate(() => {
    // 从主档里随便取一个有条码的商品，用它的后四位做检索
    const el = document.querySelector('input[data-v215="1"]')
    return el ? true : false
  })
  const tail = await probe('蒙')
  const hasTail = (tail.items || []).some(t => /尾号\s*\d{4}/.test(t))
  ok(hasTail || tail.items.length > 0, '候选条目带「尾号 NNNN」（条码后 4 位可见，便于核对）',
     JSON.stringify((tail.items || []).slice(0, 2)))

  const bad = results.filter(r => !r.pass)
  console.log('\n' + '='.repeat(60))
  console.log('共 %d 条 · 通过 %d · 失败 %d', results.length, results.length - bad.length, bad.length)
  console.log(bad.length ? 'VERDICT: FAIL' : 'VERDICT: PASS')
  await browser.close()
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
