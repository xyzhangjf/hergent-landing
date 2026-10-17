/**
 * 商品名候选面板（v215）—— 预报编辑网格「商品名称」列的自制建议浮层。
 *
 * 🔴 原生 datalist 的三个硬伤（这就是要自建的理由）：
 *    ① 过滤逻辑由浏览器定：Chrome 是「子串 + 模糊」，Safari 早期只认**前缀** ⇒ 同一份数据两种体验；
 *    ② 只按 `value` 匹配 ⇒ **条码后四位 / 拼音首字母**根本无从表达；
 *    ③ 无法控制外观与键盘行为（上下键选中项的值在多数浏览器里**读不到**）。
 * ⚠️ 定位用 `position:fixed` + Teleport 到 body：表格里有 `overflow` 容器和 sticky 表头，
 *    浮层留在 `<td>` 里会被**裁掉**（这是本项目反复踩过的层级/裁剪问题，见 zindex 诊断技能）。
 * ⚠️ 候选项用 `@mousedown.prevent` 而不是 `@click`：click 之前会先触发 input 的 blur，
 *    面板已关闭 ⇒ 点了没反应（经典的「死按钮」形态）。
 *
 * 宿主页用法：
 *   const { nameSug, onNameInput, nameSugKey, nameSugPick, nameSugClose, namePh } =
 *     useNameSuggest({ masterNameOptions, cross, onCellChange })
 */
import { ref, computed } from 'vue'
import { PY_OK } from '../utils/pinyin.js'

export function useNameSuggest ({ masterNameOptions, cross, onCellChange }) {
  const nameSug = ref({ open: false, ri: -1, ci: -1, idx: 0, list: [], top: 0, left: 0, w: 0 })
  function nameSugList(q) {
    const f = String(q || '').trim().toLowerCase()
    if (!f) return []
    const pool = masterNameOptions.value
    const hit = []
    for (const o of pool) {
      if (matchMasterOne(o, f)) hit.push(o)
      if (hit.length >= 40) break      // 面板最多 40 条 —— 再多既看不过来也拖慢渲染
    }
    return hit
  }
  /* 单个候选的匹配口径。**必须与 `rowMatchText` 同源**（名称 / 厂家编码 / 条码后 4 位 / 拼音首字母），
     否则会出现「在筛选框里搜得到、在商品名格里搜不到」这种同屏两套答案。 */
  function matchMasterOne(o, f) {
    if (!f) return true
    const name = String(o.v || '').toLowerCase()
    if (name.includes(f)) return true                      // 名称子串（含汉字直接搜）
    if (String(o.code || '').toLowerCase().includes(f)) return true   // 厂家编码
    const bc = String(o.c || '').toLowerCase()
    if (bc && (bc.includes(f) || (f.length >= 3 && bc.endsWith(f)))) return true  // 条码 / 后 4 位
    if (o.y && o.y.toLowerCase().includes(f.toUpperCase().toLowerCase())) return true  // 拼音首字母
    return false
  }
  function onNameInput(r, ri, ci, e) {
    const el = e && e.target
    const q = el ? el.value : ''
    const rect = el ? el.getBoundingClientRect() : null
    const list = nameSugList(q)
    if (!list.length || !rect) { nameSug.value.open = false; return }
    nameSug.value = {
      open: true, ri, ci, idx: 0, list,
      left: rect.left, w: Math.max(rect.width, 260),
      // 面板放不下就往上翻（贴底时往下会超出视口 ⇒ 用户看不到，等于没弹）
      top: (rect.bottom + 226 < window.innerHeight) ? rect.bottom + 2 : Math.max(8, rect.top - 226),
    }
  }
  /* 🔴 必须**手动** stopPropagation，且**只在面板打开时**：
        input 在 `<table @keydown="onGridKey">` 内，方向键会冒泡上去被表格当成「跳格」
        ⇒ 焦点在 keydown 阶段就被搬走、面板随即 blur 关闭（真机实测：↓ 后高亮消失、
        回车写入静默失效——看起来像「键盘没反应」，属于死控件那一类）。
        1017 行注释里记的是同一个坑的**回车版**（`focusCell()` 抢焦点导致 @keyup.enter 收不到）。
     ⚠️ 不能写成模板上的 `@keydown.stop`：那样**面板没开时**也拦，方向键跳格就被破坏了。
        所以放在函数里按 `s.open` 条件拦 —— 「只在我要用这几个键的时候才拦」。 */
  function nameSugKey(e) {
    const s = nameSug.value
    if (!s.open) return
    e.stopPropagation()
    if (e.key === 'ArrowDown') { s.idx = (s.idx + 1) % s.list.length; e.preventDefault() }
    else if (e.key === 'ArrowUp') { s.idx = (s.idx - 1 + s.list.length) % s.list.length; e.preventDefault() }
    else if (e.key === 'Enter') { nameSugPick(s.list[s.idx]); e.preventDefault() }
    else if (e.key === 'Escape') { s.open = false; e.preventDefault() }
  }
  function nameSugPick(o) {
    const s = nameSug.value
    if (!o) return
    const r = cross.value.rows[s.ri]
    if (r) {
      r.name = o.v
      onCellChange()          // 🔴 必须：不调它，改名不进撤销栈、也不点亮状态条（v211 修过的老缺陷）
    }
    s.open = false
  }
  function nameSugClose() { nameSug.value.open = false }
  /* 占位文案**按能力给**：环境不支持拼音序时**不提拼音** —— 提了等于承诺一个搜不到的功能。
     （`PY_OK` 由 `utils/pinyin.js` 在加载时用 4 个已知字自检得出，见该文件顶部说明。） */
  const namePh = computed(() => (PY_OK ? '商品名称 / 条码后 4 位 / 拼音首字母' : '商品名称 / 条码后 4 位'))

  return { nameSug, onNameInput, nameSugKey, nameSugPick, nameSugClose, namePh }
}
