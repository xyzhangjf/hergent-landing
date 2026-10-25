/**
 * 自由退货的「这个商品在该伙伴那儿有没有历史」提醒 —— **前端唯一入口**（v684）。
 *
 * 老板口径（2026-10-25）：
 *   · 采购退货 / 自提退单 / 车销退单**不再以「按原单退货」为主入口**，默认自由选商品；
 *   · 选到「该供应商从没供过 / 该客户从没买过」的商品时，**只提醒、不拦截** ——
 *     现实里退的货常常是上次从别的渠道调的、或跨期的老货。
 *
 * 🔴 因此本模块**只产出一条提示**，没有任何"阻止提交"的返回值。
 *    谁想在这里加 `blocked`，先回去看老板原话。
 * 🔴 判定「什么算历史」只在后端 `db/queries/partner_history.py`（哪些单据状态算数、
 *    草稿作废要不要计入）。前端不许自己拼条件，也不许把接口失败当成"全都没有历史"。
 */

/** 三种失败/空态的中文说明（页面直接显示，不要自己另写一套措辞）。 */
export const HISTORY_NOTE = {
  /** 还没选供应商/客户 —— 这不算"取不到"，只是没得比 */
  idle: '',
  /** 接口失败：如实说取不到，不假装"都有历史"、也不假装"都没历史" */
  failed: '历史记录没读出来，本次不做提醒（不影响建单）',
}

/**
 * 造一个检查器。同一页面只造一个实例。
 *
 * @param {(kind:string, partnerId:number, ids:number[]) => Promise<object>} fetchFn
 *        通常是 `psiApi.partnerProductHistory`
 * @param {(missing:Set<number>, meta:object) => void} onResult
 *        结果回调。`missing` 是「该伙伴从没经手过」的商品 id 集合；
 *        `meta = { skipped, failed, checked }`。
 * @returns `{ check, clear, recheck }`
 */
export function createHistoryChecker (fetchFn, onResult) {
  let seq = 0
  let timer = null

  const emit = (missing, meta) => {
    try { onResult(missing || new Set(), meta || {}) } catch (e) { /* 页面回调自己出错不该拖垮建单 */ }
  }

  function run (kind, partnerId, ids) {
    const mine = ++seq
    const list = []
    for (const x of (ids || [])) {
      const n = Number(x)
      if (n > 0 && !list.includes(n)) list.push(n)
    }
    /* 没选伙伴 ⇒ 没有"他的历史"可比 ⇒ 一律不标（不是"都没有历史"）。
       这一条最容易写错：把 partnerId=0 当成"全缺失"会让刚打开页面时每行都挂警告。 */
    if (!(Number(partnerId) > 0) || !list.length) {
      emit(new Set(), { skipped: true, checked: 0 })
      return
    }
    Promise.resolve(fetchFn(kind, Number(partnerId), list)).then((res) => {
      if (mine !== seq) return                  // 过期响应丢弃（用户又改了行）
      const raw = (res && res.missing) || []
      const miss = new Set()
      for (const x of raw) {
        const n = Number(x)
        if (n > 0) miss.add(n)
      }
      emit(miss, { skipped: !!(res && res.skipped), checked: list.length })
    }).catch(() => {
      if (mine !== seq) return
      /* 🔴 接口失败 ⇒ **不能**当成"全都没有历史"（会给每一行挂假警告，比不提醒更糟）。
         清空提醒 + 如实说明取不到，由页面显示 HISTORY_NOTE.failed。 */
      emit(new Set(), { failed: true, checked: list.length })
    })
  }

  return {
    /** 防抖版（商品/伙伴变化时调）：默认 300ms 合并连续改动 */
    check (kind, partnerId, ids, delay = 300) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; run(kind, partnerId, ids) }, delay)
    },
    /** 立刻查（例如保存前想再确认一次，或页面回到前台） */
    recheck (kind, partnerId, ids) {
      if (timer) { clearTimeout(timer); timer = null }
      run(kind, partnerId, ids)
    },
    /** 切伙伴/离开页面：取消在途请求并清空提醒 */
    clear () {
      if (timer) { clearTimeout(timer); timer = null }
      seq++
      emit(new Set(), { skipped: true, checked: 0 })
    },
  }
}

/**
 * 提示条文案（业务语言，不用"校验/拦截/异常"这类词）。
 * @param {'purchase'|'sale'} kind
 * @param {number} count 没有历史记录的商品行数
 */
export function historyWarnText (kind, count) {
  const n = Number(count) || 0
  if (n <= 0) return ''
  if (kind === 'sale') {
    return `有 ${n} 项商品在该客户的历史销售里没出现过（已标⚠）。仍可继续退单 —— 如果是从别的单或跨期货退的，属正常；提交前确认一下货的来路即可。`
  }
  return `有 ${n} 项商品在该供应商的历史采购里没出现过（已标⚠）。仍可继续退货 —— 如果是从别的渠道调的货或跨期老货，属正常；提交前确认一下对方是否接收即可。`
}
