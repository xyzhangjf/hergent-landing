/**
 * 副驾探针共用：把当前对话重置成**空白新对话**
 *
 * 为什么必须有：demo 账号（tenant 10）打开副驾时会自动恢复「上次那段对话」，
 * 里面躺着前几轮探针自己造出来的经营卡。探针若直接取基线，会把历史卡算成本次增量：
 *   · v625 署名探针 → `before.length !== after.length` 直接判 FAIL（假失败）
 *   · v625b 竞态探针 → 基线取在历史恢复之前（0 张），恢复后变成 5 张 ⇒ 假 FAIL
 * 真机踩过（2026-10-19 v626 复跑 v625 系列时全部红）。
 *
 * 走 UI 的「＋ 新对话」，不直接改 store —— 与老板真实操作同路径，
 * 顺带覆盖 `newChatSession()` 的副作用（messages 换引用，是 v626 归属判据的一部分）。
 */

export const JS_OPEN_HIST = `(() => {
  const b = document.querySelector('.copilot [title="历史会话"]')
  if (!b) return 'no-btn'
  b.click(); return 'ok'
})()`

export const JS_NEW_CHAT = `(() => {
  const bs = [...document.querySelectorAll('.cp-hist button')]
  const hit = bs.find(b => (b.textContent || '').indexOf('新对话') > -1)
  if (!hit) return 'missing; have=' + bs.map(b => b.textContent.trim()).join('/')
  hit.click(); return 'ok'
})()`

export const JS_OPEN_ART = `(() => {
  const aside = document.querySelector('.cp-artifacts')
  if (!aside) return 'no-aside'
  if (aside.classList.contains('show-art')) return 'already'
  const b = document.querySelector('.cp-art-toggle')
  if (!b) return 'no-toggle'
  b.click(); return 'clicked'
})()`

export const JS_ART = `(() => {
  const items = [...document.querySelectorAll('.cp-artifacts .cp-art-item')]
  const badge = document.querySelector('.cp-art-badge')
  return JSON.stringify({
    n: items.length,
    badge: badge ? badge.textContent.trim() : '',
    items: items.map(el => (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48))
  })
})()`

/** 在当前页开一段空白新对话；返回 'ok' / 失败原因 */
export async function freshChat(page, sleep) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const open = await page.eval(JS_OPEN_HIST)
  if (open !== 'ok' && open !== 'already') return 'open-hist:' + open
  await wait(900)
  const r = await page.eval(JS_NEW_CHAT)
  await wait(900)
  return r
}
