import { ref, onMounted, onUnmounted } from 'vue'

/* v306c（2026-09-28）：部署自检 —— 「我在服务器上已经修好了」不等于「你浏览器里跑的是修好的那版」。
 *
 * 🔴 病根（生产实证）：hergent.cn 是 SPA（单页应用），页面一旦打开，JS 就留在内存里跑。
 *    我在服务器上重新部署后，老板那个 15:20 打开、一直没刷新的标签页**仍然跑旧代码** ——
 *    表现就是「你说修好了，我点了还是失败」（下载记录里那条「无法从网站上提取文件」）。
 *    这类「静默的旧版本」没有任何提示，只能靠人猜，是最费时间的一类问题。
 *
 * 判据（可靠且不依赖任何后端配合）：
 *    构建产物是**哈希文件名**（assets/index-XXXX.js），而 index.html 是 no-store
 *    ⇒ 服务器上有没有新版本，直接从「现在服务器上 index.html 引用的入口文件名」就能看出来。
 *    把它和「当前页面正在跑的入口文件名」一比，不同 = 我手上这版是旧的。
 *
 * ⚠️ 刻意**不自动刷新**：老板可能正在输入框里打字，替他点刷新会丢内容。
 *    只提示（页面底部一颗小圆角提示），刷新动作由人点。
 * ⚠️ 失败一律静默：网络抖动、离线、老浏览器不该因为一个自检就报错打扰用户。
 */

const ENTRY_RE = /assets\/(index-[A-Za-z0-9_-]+\.js)/

function currentEntry() {
  const hit = (el) => {
    const m = ENTRY_RE.exec(el.getAttribute('src') || '')
    return m ? m[1] : ''
  }
  const mod = document.querySelector('script[type="module"][src*="/assets/index-"]')
  if (mod) {
    const n = hit(mod)
    if (n) return n
  }
  for (const el of document.querySelectorAll('script[src]')) {
    const n = hit(el)
    if (n) return n
  }
  return ''
}

export function useAppUpdate() {
  const hasNew = ref(false)
  const cur = currentEntry()
  let timer = null
  let stopped = false

  async function check() {
    if (stopped || hasNew.value || !cur) return
    try {
      const r = await fetch('/index.html?_v=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (!r.ok) return
      const m = ENTRY_RE.exec(await r.text())
      if (m && m[1] !== cur) hasNew.value = true
    } catch (e) {
      /* 自检失败不打扰用户 */
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible') check()
  }

  onMounted(() => {
    check()
    timer = setInterval(check, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
  })

  onUnmounted(() => {
    stopped = true
    if (timer) clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', check)
  })

  return { hasNew, reload: () => location.reload() }
}
