/**
 * 表格密度偏好（P2 / v417k）：**舒适 cozy**（默认，即现状）/ **紧凑 compact**。
 *
 * ## 为什么要跟着租户走（云端），而不是只存 localStorage
 * 只存本地 ⇒ 换台电脑 / 换个浏览器就要重调一次；老板常在电脑与手机之间切。
 * 复用 `/api/ui/col-prefs`（page = `ui-density`）：该表按 page 存任意 cfg、无白名单，
 * 不必为密度单独加后端接口。
 *
 * ## 🔴 `ok` 必须与 `cfg` 分开（沿用 useColPrefs 那条血泪纪律）
 *   云端没有（ok=true,  cfg=null）⇒ 把本地那份**推上去**（用户此前调好的不能白调）
 *   网络失败（ok=false, cfg=null）⇒ **什么都别做**（此时推上去会用可能过期的本地值
 *                                   覆盖云端，是数据损失而非同步）
 * 两者混成一个 null，弱网时就会静默把云端配置冲掉，而且下次联网也回不来。
 *
 * ## 为什么本地也要存一份（两层而非一层）
 * 本地 = **即时生效层**（弱网/离线也能用，且避免"设置跳回默认"—— 偏好类设置最忌讳这个）；
 * 云端 = **跨设备同步层**（联网时对齐）。只读失败不影响本机，只 console.warn 留痕。
 *
 * ## 作用面
 * 值写到 `<html data-density="…">`，由 `variables.css` 的全局规则 + 各页 scoped 覆盖
 * 决定具体尺寸 —— 组件**不**自己算像素，避免密度规则散落在各页变成"抄多份"。
 */
import { ref } from 'vue'
import { api } from '../api/client'

const LS_KEY = 'hergent_density'
const PAGE = 'ui-density'

/** 只认这两个值：localStorage 里被人手改成别的 ⇒ 回落到 cozy（不静默用脏值）。 */
function readLocal () {
  try { return localStorage.getItem(LS_KEY) === 'compact' ? 'compact' : 'cozy' } catch (_) { return 'cozy' }
}

/** 模块级单例 ⇒ 全站共享同一个值（每页各 import 一份 ref 会各存各的，改一处不生效另一处）。 */
export const density = ref(readLocal())

function apply (v) {
  try { document.documentElement.dataset.density = v } catch (_) {}
}

/** 启动/登录后调一次：先本地即时生效，再尝试用云端对齐。 */
export async function initDensity () {
  apply(density.value)
  let ok = false
  let cfg = null
  try {
    const d = await api('/api/ui/col-prefs?page=' + encodeURIComponent(PAGE))
    // 形态不对（后端还没部署 / 网关插了 HTML）⇒ 当作**失败**，不是"云端没有"
    if (d && Object.prototype.hasOwnProperty.call(d, 'pref')) { ok = true; cfg = d.pref }
  } catch (e) {
    console.warn('[密度] 读取云端失败（本次沿用本地）', e && e.message)
  }
  if (!ok) return
  if (!cfg) { // 云端没有 ⇒ 把本地那份推上去（seed）
    try { await api('/api/ui/col-prefs', { method: 'POST', body: { page: PAGE, cfg: { density: density.value } } }) } catch (_) {}
    return
  }
  const v = cfg && cfg.density === 'compact' ? 'compact' : 'cozy'
  if (v !== density.value) {
    density.value = v
    apply(v)
    try { localStorage.setItem(LS_KEY, v) } catch (_) {}
  }
}

/**
 * 显式切换（设置页点按钮）。
 * 🔴 与「拖一下列」那种隐式偏好刻意不同：用户是**显式点了开关**，有"应该存上了"的预期，
 *    故云端写失败**必须如实回传 false 让调用方提示**，不能只 console.warn 了事。
 *    本机已生效这件事要在提示里讲清楚（否则用户以为整件事失败了）。
 */
export async function setDensity (v) {
  const next = v === 'compact' ? 'compact' : 'cozy'
  density.value = next
  apply(next)
  try { localStorage.setItem(LS_KEY, next) } catch (_) {}
  try {
    await api('/api/ui/col-prefs', { method: 'POST', body: { page: PAGE, cfg: { density: next } } })
    return true
  } catch (e) {
    console.warn('[密度] 云端保存失败（本机已生效，换设备可能不一致）', e && e.message)
    return false
  }
}

export function toggleDensity () {
  return setDensity(density.value === 'compact' ? 'cozy' : 'compact')
}
