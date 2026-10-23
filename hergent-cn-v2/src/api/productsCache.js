/* 商品主档（`/api/products/grid`）的**进程内缓存 + 预取** —— v653
   ============================================================
   要解决什么（2026-10-23 实测，tenant 1 / 1159 个在售商品）：
     · 该接口未压缩 454KB、gzip 后 30.8KB；后端内部 126ms，经框架 148ms，
       本机到阿里云再加 RTT ⇒ **一次「打开改单」在这一个请求上要等 0.31 秒**。
     · 它与「改单」表体渲染是**串行**的：点「改单」→ 等 0.31s 网络 → 再花 0.95s 建 294 行。
       所以这 0.31s 是用户纯等的、且完全可省。
   做法：进预报页就**空闲预取**，点「改单」时直接用内存里的那份。

   为什么这样做是安全的（而不是「缓存导致看到旧档案」）：
     1. TTL 60 秒 —— 过了就重新拉，最长陈旧窗口一分钟；
     2. **任何**商品写操作成功后立刻失效（`onWriteSuccess` 在 api() 层按
        `/api/products` 前缀统一拦截，见 client.js）⇒ 改完档案马上进改单看到的是新值；
     3. 缓存只在**内存**里，不落 localStorage/IndexedDB ⇒ 刷新页面即失效，
        不会出现「换设备/隔天还拿旧档案」这种难查的问题。

   ⚠️ 不缓存 `summary`（本期报单汇总）：它随他人报单实时变化，缓存等于让老板
      看到别人已经改过的旧数 —— 那种错比慢更贵。这里只缓存「商品主档」这类
      低频变更的字典数据。
   ============================================================ */
import { productsApi } from './modules'
import { onWriteSuccess } from './client'

const TTL = 60000

let _cache = null      // { at:number, items:any }
let _inflight = null   // 同一时刻只允许一个在飞的请求（并发调用共享它，天然去重）

/** 只读探针：命中（且未过期）返回数据，否则 null。给「要不要等它」这类判断用。 */
export function peekProductsGrid() {
  if (!_cache) return null
  if (Date.now() - _cache.at > TTL) return null
  return _cache.items
}

/** 取商品主档（命中缓存则零等待）。force=true 时忽略缓存重新拉。 */
export function fetchProductsGrid({ force = false } = {}) {
  if (!force) {
    const hit = peekProductsGrid()
    if (hit) return Promise.resolve(hit)
    if (_inflight) return _inflight      // 已有请求在飞 ⇒ 复用，绝不再发一个
  }
  const p = productsApi.grid().then(d => {
    _cache = { at: Date.now(), items: d }
    if (_inflight === p) _inflight = null
    _markReady(Array.isArray(d && d.items) ? d.items.length : 0)
    return d
  }).catch(e => {
    if (_inflight === p) _inflight = null
    throw e
  })
  _inflight = p
  return p
}

/** 空闲预取。**失败一律静默** —— 预取是纯优化，任何异常都不该影响页面。 */
export function prefetchProductsGrid() {
  if (peekProductsGrid() || _inflight) return
  const run = () => { fetchProductsGrid().catch(() => {}) }
  try {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 })
    else setTimeout(run, 300)
  } catch { /* 环境不支持 idle 回调：直接不预取，功能不受影响 */ }
}

/* 可观测标志（只读、无副作用）：预取是否已把主档装进内存。
   存在的理由 —— 「打开改单还是慢」时，第一个要分清的就是**预取到底生没生效**，
   否则只能靠猜（改单耗时里网络与建 DOM 混在一起看不出来）。探针读它，人也可以在
   DevTools Console 里敲 `__hgProductsGridReady` 一眼看到。 */
function _markReady(v) {
  try { if (typeof window !== 'undefined') window.__hgProductsGridReady = v } catch { /* 忽略 */ }
}

/** 丢掉缓存（写操作后 / 手动刷新时用）。 */
export function invalidateProductsGrid() {
  _cache = null
  _inflight = null
  _markReady(0)
}

/* 商品档案被写（新增/修改/批量/自定义列/批量补进价…）⇒ 立即失效。
   前缀按 `/api/products` 匹配，覆盖 `products/bulk-upsert`、`products/{id}`、
   `products/extra-values`、`products/batch-factory-price` 等全部写通道。 */
onWriteSuccess('/api/products', invalidateProductsGrid)
