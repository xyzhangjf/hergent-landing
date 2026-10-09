/**
 * 列设置的云端同步（P2-4 / v411）。
 *
 * ## 为什么抽成 composable
 * 本页要把「列顺序 / 可见性 / 冻结列」从**只活在这台浏览器**升级成**跟着租户走**。
 * 三个宿主页（`/forecast`、`/inventory/purchase`、`/inventory/purchase-settlement`）
 * 都要这件事，而本仓已有一类缺陷叫「同一规则抄多份 ⇒ 漏抄的那份整页出错」——
 * 故上提为**唯一实现**，与 `useColMenu.js`（列菜单定位）同一处置。
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
      console.warn('[列设置] 读取云端配置失败（本次沿用本地）', e && e.message)
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
      console.warn('[列设置] 云端保存失败（本地已生效，换设备后可能不一致）', e && e.message)
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
