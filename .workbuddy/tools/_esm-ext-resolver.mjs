/* 极小的 ESM 解析垫片：把无扩展名的相对 import 补成 `.js` 再解析。
   🔴 为什么需要它：`src/constants/pages.js` 里写的是 `from './roles'`（Vite 能解析，
      原生 node ESM **不能** —— 它要求完整文件名）。探针要在**真实源码**上跑判据，
      就不能为了跑探针去改被测文件（改了就不是真身了）。
   ⚠️ 只在"裸 relative 解析失败"时兜一次 `.js`，不做任何其它猜测 ——
      兜底越多，探针看到的就越不是生产的行为。 */
export async function resolve (specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (e) {
    const rel = specifier.startsWith('./') || specifier.startsWith('../')
    if (rel && !/\.[a-z]+$/i.test(specifier)) {
      // ① 目录 import（`from '../store'` ⇒ `../store/index.js`）—— Vite 默认行为
      try {
        const r = await nextResolve(specifier + '/index.js', context)
        return r
      } catch (_) { /* 落到 ② */ }
      // ② 裸文件名补 `.js`
      try { return await nextResolve(specifier + '.js', context) } catch (_) { /* 落回原错误 */ }
    }
    throw e
  }
}
