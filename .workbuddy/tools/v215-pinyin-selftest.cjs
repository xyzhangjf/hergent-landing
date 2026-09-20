// v215 护栏：拼音首字母 + 商品名匹配口径。
// 🔴 为什么必须在**真实浏览器**里跑：`Intl.Collator('zh-Hans-CN')` 的汉字排序依赖 ICU 数据，
//    node 常是 small-icu（无中文数据）⇒ 在 node 里跑会**假绿**或**假红**，两种都是误导。
//    本脚本用本机 Chrome（与用户实际运行环境一致），且逻辑**从源码原样提取**（不另写副本）。
const fs = require('fs')
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/utils/pinyin.js'

const CHARS = [
  ['蒙','M'],['牛','N'],['伊','Y'],['利','L'],['特','T'],['仑','L'],['苏','S'],
  ['安','A'],['慕','M'],['希','X'],['纯','C'],['甄','Z'],['味','W'],['全','Q'],
  ['光','G'],['明','M'],['君','J'],['乐','L'],['宝','B'],['简','J'],['爱','A'],
  ['卡','K'],['士','S'],['酸','S'],['奶','N'],['优','Y'],['益','Y'],['低','D'],
  ['脂','Z'],['草','C'],['莓','M'],['原','Y'],['香','X'],['冰','B'],['激','J'],
  ['凌','L'],['布','B'],['丁','D'],['每','M'],['日','R'],['鲜','X'],['语','Y'],
  ['有','Y'],['机','J'],['寻','X'],['云','Y'],['坐','Z'],['错','C'],['女','N'],
  ['真','Z'],['果','G'],['粒','L'],['养','Y'],['多','D'],['畅','C'],['意','Y'],
  ['冠','G'],['乳','R'],['夕','X'],['簿','B'],['菌','J'],['穆','M'],
]
const NAMES = [
  ['蒙牛','MN'],['特仑苏','TLS'],['安慕希','AMX'],['伊利','YL'],['纯甄','CZ'],
  ['味全','WQ'],['光明','GM'],['君乐宝','JLB'],['简爱','JA'],['卡士','KS'],
  ['酸奶','SN'],['低脂','DZ'],['草莓','CM'],['原味','YW'],['香草','XC'],
  ['冰淇淋','BQL'],['布丁','BD'],['优益C','YYC'],['每日鲜语','MRXY'],
  ['特仑苏有机','TLSYJ'],['真果粒','ZGL'],['养乐多','YLD'],['畅意','CY'],
  ['冠益乳','GYR'],
]

;(async () => {
  let src = fs.readFileSync(SRC, 'utf8')
  src = src.replace(/export\s+let\s+/g, 'let ').replace(/export\s+function\s+/g, 'function ')
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.goto('https://hergent.cn/login', { waitUntil: 'domcontentloaded' })
  const out = await page.evaluate((src, chars, names) => {
    // eslint-disable-next-line no-eval
    const mod = eval(src + '\n;({ PY_OK, pyInitials, initial })')
    const res = { pyOk: mod.PY_OK, chars: [], names: [] }
    for (const [ch, want] of chars) res.chars.push({ ch, want, got: mod.initial(ch) })
    for (const [n, want] of names) res.names.push({ n, want, got: mod.pyInitials(n) })
    // 混合串：汉字取首字母、**字母数字原样保留**（「优益C」要能搜 YYC）—— 所以 `12箱` → `12X`
    res.nonKanji = [['12箱', '12X'], ['abc', 'ABC'], ['', ''], ['蒙牛A1', 'MNA1']]
      .map(([s, want]) => ({ s, want, got: mod.pyInitials(s) }))
    return res
  }, src, CHARS, NAMES)

  const bad = []
  const chk = (label, arr, key) => {
    let n = 0
    for (const r of arr) {
      if (r.got !== r.want) { bad.push(label + ' ' + (r.ch || r.n || JSON.stringify(r.s)) + ' 期望' + r.want + ' 实得' + r.got) } else n++
    }
    console.log('%s：%d / %d', label, n, arr.length)
  }
  console.log('PY_OK（环境自检）=', out.pyOk)
  if (!out.pyOk) bad.push('🔴 PY_OK=false —— 该环境 ICU 无中文拼音序，拼音检索会被自动禁用')
  chk('单字', out.chars)
  chk('整名', out.names)
  chk('非汉字/混合', out.nonKanji)
  if (bad.length) { console.log('\n❌ 未通过：'); for (const b of bad) console.log('   ' + b) }
  console.log('\n' + (bad.length ? 'VERDICT: FAIL' : 'VERDICT: PASS'))
  await browser.close()
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
