/**
 * 采购单「自定义字段」的前端共用件（v415 / P2-7）。
 *
 * ## 为什么抽成 composable
 * 同一个东西要在**三个页面**上出现：
 *   · `InvPurchaseList.vue`  —— 动态列 + 列设置面板里新增/改名/删除 + 导出；
 *   · `InvPurchaseNew.vue`   —— 建单时录入（随单同事务落库）；
 *   · `InvPurchaseDetail.vue`—— 展示已填的值 + 事后补填。
 * 「字段定义怎么归一」「某行的值怎么读」是**同一件事**，三处各抄一份必然漂移
 * （本仓一类专项缺陷：同一条规则抄多份 ⇒ 漏抄的那份出错）⇒ 上提为唯一实现。
 *
 * ## 职责边界（写清是为了别长胖）
 * 本文件**只做两件事**：
 *   ① 网络（走 `api/psi.js`，本文件不自己 `fetch`，也不自己拼 URL）；
 *   ② 归一（服务端定义 → 与列表页 `PO_COLS` **逐字同形**的列定义 / 值读取）。
 * **不做**：缓存（不落 localStorage —— 定义的唯一源是服务端，本地缓存会给"换设备即丢"
 *   再造一个入口）、不做列顺序/显隐（那是各页的列设置）、不做校验（判据全在后端）。
 *
 * ## 🔴 为什么读定义失败要单独有个 `ok`
 * 「读到 0 个字段」与「没读到」长得一样（都是空数组），但该做的事相反：
 *   读到 0 个 ⇒ 就是没有，正常显示「新增字段」；
 *   没读到   ⇒ **不能给新增入口** —— 名字长度 / 重名 / 配额这些判据全在服务端，
 *              读不到定义时新增必然失败（或更糟：建出来一个和已有重名的）。
 * 把两者混成一个空数组，用户就会在一个注定失败的表单上填东西。
 * 同理：读失败时**不清空** `defs` —— 已经渲染出来的列继续显示（降级但可用），
 * 免得整张表的列突然塌掉。
 */
import { ref } from 'vue'
import { psiApi } from '../api/psi'

/** 自定义列的默认列宽（列表页 `<colgroup>` 用）。文本与数字同宽：字段名 ≤12 字、值 ≤200 字。 */
export const CUSTOM_COL_W = 110

/**
 * 服务端字段定义 → **与 `PO_COLS` 项逐字同形**的列定义。
 *
 * 🔴 同形是关键：列表页所有"列"的判断（可见性 / 顺序 / 宽度 / 取值 / 导出）都靠这个
 *    形状，一旦为自定义列分叉出一套 `{custom_key, custom_label}`，就得在每一处都写
 *    两个分支 —— 漏一处就是"自定义列不参与排序/导出"这类静默缺陷。
 * @param {{key:string,label:string,type:string}} c 服务端定义
 */
export function customColDef (c) {
  const num = c.type === 'number'
  return {
    key: c.key,
    label: c.label || c.key,
    w: CUSTOM_COL_W,
    on: false,          // 默认收起（由各页 `defaultColVis()` 读取；新增当场可见是**调用方**的事）
    num,                // 数字右对齐（与静态金额列同一种格样式）
    clip: !num,         // 文本列超出省略（数字列不会超宽）
    custom: true,       // 列设置面板里"可改名 / 可删"的唯一标记
  }
}

/**
 * 从一份 `extra` 字典里读某个字段的值。**详情页拿到的就是"那一份字典本身"**
 * （`order.extra`），列表页拿到的是"行"（`r.extra`）⇒ 两条入口，同一个实现。
 * @returns 值（`string` / `number`）；**没有该键 ⇒ `''`**（界面按缺值显示 `—`）
 *
 * 🔴 数字 `0` **原样返回 `0`，不返回 `''`** —— 本仓铁律「**「没有」≠「是零」**」：
 *    把 0 当空值会让界面把"填了 0"显示成 `—`，等于谎报"没填"。
 * ⚠️ 字典不缺时（老后端没这一列 / 这张单从没填过）一律 `''`，**不编造**。
 */
export function extraValOf (m, key) {
  if (!m || typeof m !== 'object') return ''
  const v = m[key]
  if (v === null || v === undefined) return ''
  return v
}

/**
 * 读某一行上某个自定义字段的值。**列表行 / 建单回显共用这一条口径**。
 * @param {object} r 行对象（`r.extra` 是服务端把 `extra_json` 解析出来的字典）
 * @param {string} key 字段 key（形如 `p_ab12cd34`）
 */
export function extraVal (r, key) {
  return extraValOf(r && r.extra, key)
}

/**
 * 三个页面共用的采购单自定义字段控制器。
 *
 * @returns {{
 *   defs: import('vue').Ref<Array>,   // 归一后的列定义（与 PO_COLS 同形）
 *   raw:  import('vue').Ref<Array>,   // 原始定义（`{key,label,type}`）—— 录入控件要判 type
 *   ok:   import('vue').Ref<boolean>, // 定义是否**成功读到**（fail-closed 用，见文件头）
 *   err:  import('vue').Ref<string>,  // 读失败的人话原因（界面照显，不静默）
 *   loaded: import('vue').Ref<boolean>, // 是否已经尝试读过（区分"还没读"与"读了但空"）
 *   loadDefs: () => Promise<boolean>,
 *   addField: (label:string, type?:string) => Promise<object>,
 *   renameField: (key:string, label:string) => Promise<object>,
 *   removeField: (key:string) => Promise<object>,
 * }}
 */
export function usePurchaseCustomFields () {
  const defs = ref([])
  const raw = ref([])
  const ok = ref(false)
  const err = ref('')
  const loaded = ref(false)

  /** 拉定义。返回是否成功（**不抛**：读列定义失败不该让整页报错，见文件头）。 */
  async function loadDefs () {
    try {
      const d = await psiApi.listPurchaseCustomFields()
      const cols = (d && d.columns && d.columns.custom) || []
      raw.value = cols.map(c => ({
        key: c.key,
        label: c.label || c.key,
        // ⚠️ 白名单式归一：服务端只会给 `text` / `number`，但**存量脏值可能是别的**
        //    （`field_type` 是自由文本列）。不认识的类型按**文本**处理 —— 文本输入框
        //    能装下任何一种值；反过来把未知类型当数字会让用户连字都填不进去。
        type: c.type === 'number' ? 'number' : 'text',
      }))
      defs.value = raw.value.map(customColDef)
      ok.value = true
      err.value = ''
      return true
    } catch (e) {
      ok.value = false
      err.value = (e && e.message) || '自定义字段读取失败'
      // 🔴 **不清空** defs / raw：已经渲染出来的列继续用（降级但可用）。
      return false
    } finally {
      loaded.value = true
    }
  }

  /**
   * 新增字段。拿到服务端返回的稳定 key 后**重拉一次定义** ——
   * 让服务端做唯一源（显示名、排序、以及"这个 key 真的存在"都由它说了算），
   * 而不是本地把返回体拼进列表（本地拼的那份与服务器真实状态迟早分岔）。
   */
  async function addField (label, type = 'text') {
    const r = await psiApi.addPurchaseCustomField(label, type)
    const col = (r && r.column) || null
    if (!col || !col.key) throw new Error('新增失败：服务端未返回字段标识')
    await loadDefs()
    return col
  }

  /** 改字段的显示名。**不动值** —— 值是按 key 存的，改显示名不影响已填内容。 */
  async function renameField (key, label) {
    const r = await psiApi.updatePurchaseCustomField(key, { label })
    const col = (r && r.column) || null
    if (!col) throw new Error('改名失败：服务端未返回字段信息')
    await loadDefs()
    return col
  }

  /**
   * 删字段（服务端会在同一事务里清掉所有单据上该字段的值）。
   * 返回体的 `purged_products` 是历史键名，语义 = **被清掉的采购单张数** ⇒ 调用方要报给用户。
   */
  async function removeField (key) {
    const r = await psiApi.deletePurchaseCustomField(key)
    raw.value = raw.value.filter(c => c.key !== key)
    defs.value = defs.value.filter(c => c.key !== key)
    return r || {}
  }

  return { defs, raw, ok, err, loaded, loadDefs, addField, renameField, removeField }
}

export default usePurchaseCustomFields
