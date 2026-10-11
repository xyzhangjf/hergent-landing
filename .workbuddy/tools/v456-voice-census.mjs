/**
 * v456-voice-census.mjs —— 盘点「浏览器 Web Speech API 能给到哪些中文语音」
 *
 * 背景：副驾朗读走 `window.speechSynthesis` 且**未指定 voice** ⇒ 用的是系统默认
 *       那个最老的中文合成音（用户反馈"声音不好听"）。本脚本负责客观回答：
 *       ① 本机到底能拿到哪些 voice？② 有几个 zh 可用？③ 哪些是"优质/增强"档？
 *       ④ 默认挑中的是哪一个（= 用户现在听到的声音）？
 *
 * 跑法：node .workbuddy/tools/v456-voice-census.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(async () => {
  if (!('speechSynthesis' in window)) return { ok: false, reason: 'no speechSynthesis' }
  const dump = (list) => list.map(v => ({
    name: v.name, lang: v.lang, local: v.localService, def: v.default,
    uri: (v.voiceURI || '').slice(0, 60),
  }))
  let v1 = speechSynthesis.getVoices()
  if (!v1.length) {
    await new Promise((res) => {
      const t = setTimeout(res, 2000)
      speechSynthesis.onvoiceschanged = () => { clearTimeout(t); res() }
    })
    v1 = speechSynthesis.getVoices()
  }
  const all = dump(v1)
  const zh = all.filter(v => /^zh|Chinese|中文|Ting|Mei|Sin|Yu|Li|Siqi|Yue|Chun|Pan/i.test(v.name + ' ' + v.lang))
  return { ok: true, total: all.length, all, zh: zh.length ? zh : [] }
})()`

/* 🔴 headless 与有头是**两个不同的语音池**：实测 headless 只暴露 19 个 Google 在线语音、
   系统本地语音（Tingting 等）**一个都不出现**。真实用户在**有头**浏览器里听，所以必须两边都测。 */
const HEADED = process.argv.includes('--headed')

const browser = await launch({ headless: !HEADED })
const page = await browser.newPage()
await page.enable()
await page.goto('about:blank', 300)
await sleep(HEADED ? 1500 : 500)

const r = await page.eval(PROBE)
console.log('=== Web Speech API 语音普查（本机 Chrome，' + (HEADED ? '有头 GUI' : 'headless') + '）===')
if (!r || !r.ok) {
  console.log('  探测失败：', JSON.stringify(r))
} else {
  console.log('  voice 总数：', r.total)
  console.log('  --- 全部 voice ---')
  r.all.forEach((v, i) => {
    const tags = [v.lang, v.local ? '本地' : '在线', v.def ? 'DEFAULT' : ''].filter(Boolean).join(' · ')
    console.log(`  [${String(i).padStart(2)}] ${v.name.padEnd(34)} ${tags}`)
  })
  console.log('  --- 中文相关 ---')
  if (!r.zh.length) console.log('  （无）')
  else r.zh.forEach((v) => console.log(`   · ${v.name}  [${v.lang}]  ${v.local ? '本地' : '在线'}`))
}

// 再测：给一段中文，默认 voice 会选谁
const which = await page.eval(`(async () => {
  const vs = speechSynthesis.getVoices()
  const u = new SpeechSynthesisUtterance('测试中文语音')
  u.lang = 'zh-CN'
  // 模拟浏览器选声：优先 lang 完全匹配
  const pick = vs.find(v => v.lang === 'zh-CN') || vs.find(v => /^zh/i.test(v.lang)) || vs[0]
  return { picked: pick ? pick.name : null, lang: pick ? pick.lang : null,
           isDefault: pick ? pick.default : null, local: pick ? pick.localService : null }
})()`)
console.log('  默认会挑中（= 用户当前听到的声音）：', JSON.stringify(which))

await browser.close()
