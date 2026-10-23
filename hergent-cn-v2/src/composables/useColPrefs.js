/**
 * 列设置的云端同步（P2-4 / v411）。
 *
 * ## 为什么抽成 composable
 * 本页要把「列顺序 / 可见性 / 冻结列」从**只活在这台浏览器**升级成**跟着租户走**。
 * 最初只有三个宿主页（`/forecast`、`/inventory/purchase`、结算单列表），现已扩到 **27 个页面**
 * （各明细 / 单据 / 档案页的列可见性都走这里）—— `useColSettings` 是它们的统一入口。
 * 而本仓已有一类缺陷叫「同一规则抄多份 ⇒ 漏抄的那份整页出错」——
 * 故上提为**唯一实现**，与 `useColMenu.js`（列菜单定位）同一处置。
 * 🔴 新增宿主页时必须同时在后端 `db/queries/ui_prefs.py` 的 `COL_PREF_PAGES` 登记 page 键，
 *    否则 400 ⇒ 该页列设置永远同步不上去（2026-10 之前 15 个页面就这么静默失效过）。
 *
 * ⚠️ 本 composable **只管网络与合并时机**，不含列数据集本身
 *    （清单 / 顺序 / 可见性怎么算、怎么应用到界面）—— 那部分各页差异大，
 *    由各页通过 `apply` / `snapshot` 两个回调注入。
 *
 * ## 🔴 一条不能省的正确性要求：`ok` 必须与 `cfg` 分开
 * `pull()` 返回 `{ ok, cfg }` 而不是直接返回 cfg，因为**「云端没有」与「网络失败」
 * 长得一模一样（都是 null），但该做的事相反**：
 *
 *     云端没有（ok=true,  cfg=null）⇒ 把本地那份**推上去**（用户此前调好的列不能白调）
 *     网络失败（ok=false, cfg=null）⇒ **什么都别做**（此时推上去会用一份可能过期的
 *                                   本地值**覆盖云端**，是数据损失而非同步）
 *
 * 把两者混成一个 null，弱网/离线时就会静默把云端的配置冲掉 —— 而且下次联网
 * 也回不来（本地那份已经是新的"最新"了）。
 *
 * ## 失败为什么只留痕、不弹提示
 * 拖一下列、勾一下列**不是一次显式保存动作**，用户没有"正在提交"的心智模型；
 * 为此弹 toast 是噪音（对照 `Forecast.vue` 的「保存为方案」——那是显式动作，
 * 所以它失败时**必须**如实提示，两者的处理刻意不同）。
 * 但**绝不静默**：失败一律 `console.warn` 留下可诊断的痕迹。
 */
import { onBeforeUnmount } from 'vue'
import { api } from '../api/client'

const PUSH_DEBOUNCE = 800   // 拖列会连发多次变更，合并成一次写

/* 🔴 400 单独说人话（v652b）：本端点**有白名单**（后端 `db/queries/ui_prefs.py`）。
   页面键没登记 ⇒ 400 ⇒ 本页列设置永远同步不上去，而界面上毫无提示。
   2026-10 之前有 15 个页面就栽在这——只 `console.warn('读取失败')`，
   谁也不会去点开那条 warn 看是 400 还是网络抖动。所以这里把它升成 `error` 并给出下一步动作。 */
function _prefFailHint (page, e, action) {
  if (e && e.status === 400) {
    console.error(
      `[列设置] 页面键「${page}」未被后端登记（400），本页${action}无法跨设备同步。` +
      ' 修法：在后端 db/queries/ui_prefs.py 的 COL_PREF_PAGES 里登记这个 page 键。')
    return
  }
  console.warn(`[列设置] ${action}失败（本次沿用本地）`, e && e.message)
}

export function useColPrefs (page, { apply, snapshot } = {}) {
  let timer = null
  let pending = null

  /** 读云端。**必须**区分 ok / cfg 两个字段，理由见文件头。 */
  async function pull () {
    try {
      const d = await api('/api/ui/col-prefs?page=' + encodeURIComponent(page))
      // 响应形态不对（后端未部署的新版本 / 网关插了 HTML）⇒ 当作失败，**不当作"云端没有"**
      if (!d || !Object.prototype.hasOwnProperty.call(d, 'pref')) {
        console.warn('[列设置] 云端返回形态异常，本次不同步', d)
        return { ok: false, cfg: null }
      }
      return { ok: true, cfg: (d.pref && typeof d.pref === 'object') ? d.pref : null }
    } catch (e) {
      _prefFailHint(page, e, '读取云端配置')
      return { ok: false, cfg: null }
    }
  }

  /* 真正发出去的那一次。**失败不改状态、不重试** —— 列设置是低频偏好，
     重试的收益远小于把逻辑写复杂后引入"循环写"的风险。 */
  function _flush () {
    const cfg = pending
    pending = null
    timer = null
    if (!cfg) return
    api('/api/ui/col-prefs', { method: 'POST', body: { page, cfg } }).catch(e => {
      _prefFailHint(page, e, '保存云端配置')
    })
  }

  /** 写云端（debounce）。canonical 的调用点是各页的 `persistCols()`。 */
  function push (cfg) {
    if (!cfg) return
    pending = cfg
    if (timer) clearTimeout(timer)
    timer = setTimeout(_flush, PUSH_DEBOUNCE)
  }

  /** 立即把待写的那一份发出去（卸载时用，避免"刚调完就切页"丢失末次变更）。 */
  function flush () { if (timer) { clearTimeout(timer); timer = null } _flush() }

  /**
   * 挂载时同步一次。返回实际发生了什么（便于打点/自检）：
   *   'pulled'  —— 云端有 ⇒ 已覆盖本地并应用
   *   'seeded'  —— 云端没有 ⇒ 已把本地那份推上去
   *   'offline' —— 读取失败 ⇒ **什么都没动**
   */
  async function syncFromCloud () {
    const { ok, cfg } = await pull()
    if (!ok) return 'offline'
    if (cfg) { if (apply) apply(cfg); return 'pulled' }
    if (snapshot) push(snapshot())
    return 'seeded'
  }

  onBeforeUnmount(flush)

  return { pull, push, flush, syncFromCloud }
}
