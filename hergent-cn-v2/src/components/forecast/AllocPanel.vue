<script setup>
/* ---- 按比例分摊弹窗（F5 从 Forecast.vue 抽离的懒加载叶子）----
   🔴 抽离铁律：函数体一字不改，只动「组件边界 + props/emits」。
   父组件保留 allocOpen / allocRow 两个 ref：「分摊」按钮在**中央网格每一行**，
   需要把本次要分摊的行传给本弹窗；前置校验（单人/无人/无期次）也留在父级。
   🔴 写操作收口：本组件**不直接写中央网格**。applyAlloc 只调后端 API，
      完成后 emit('applied', payload)，由父组件做网格回填（row.extraQty）
      + saveDraftNow()；角标刷新走本组件 finally 里的 props.loadPtGap()
      —— 与 AuditPanel emit('reload') 同模式。
      🔴 v657：父级**不再** loadCross()（那会把编辑态网格换成服务端重造的只读行、
         把刚填的加单量冲掉 ⇒ 保存传 0、分配落空，见 Forecast.vue::onAllocApplied
         的注释）。编辑态下网格保持不动，加单量留在格子里。
   🔴 样式随组件自含（本文件 <style scoped>）—— 见 v558 判据：
      scoped 父组件的 data-v 只打在子组件根元素上，样式必须一起搬。 */
import { ref, computed, watch, onMounted } from 'vue'
import { productTargetsApi } from '../../api/modules'
/* 🔴 v629 补 `parseNumInput`：本文件 `_allocNum()` 一直在调它，却**从未 import**
   （抽离时漏带）⇒ 弹窗一渲染数字就抛 `parseNumInput is not defined`，
   被 ErrorBoundary 吞掉 ⇒ 弹窗空白 / 数字全 NaN。构建不报错，只有真机点开才现形。
   与父级 `_allocPid()` 同一类：**引用了本文件没有的标识符**。 */
import { fmt, parseNumInput } from '../../utils/forecast/format.js'
import { toast } from '../../store'
import Icon from '../Icon.vue'
/* v671：表头全选（三态）全站统一件 —— 与本期预报序号列那颗同款。 */
import SelectAllCheckbox from '../SelectAllCheckbox.vue'

const props = defineProps({
  /* 🔴 v629 修真缺陷：模板写的是 `<div v-if="open" class="imp-modal alloc-modal">`，
     而 `open` **一直没在 defineProps 里声明** —— 父级 `:open="allocOpen"` 传下来后
     落进 `$attrs`（inheritAttrs 默认开），模板里的裸 `open` 却解析成 **undefined**
     ⇒ 弹窗**永远不渲染**：点了「分摊」没弹窗、没 toast、没报错（生产构建连
     dev warning 都没有）。同类第三例（前两例：父级 `_allocPid()`、本文件漏 import
     `parseNumInput`）—— 都是「引用了本文件不存在的标识符」。 */
  open:         { type: Boolean,  default: false },
  cross:        { type: Object,   default: null },
  row:          { type: Object,   default: null },   // = 父级 allocRow（本次要分摊的编辑态行）
  ptAlloc:      { type: Object,   default: null },   // product_id → extra-alloc item（预留）
  numInput:     { type: Function, required: true },
  numCommit:    { type: Function, required: true },
  loadPtGap:    { type: Function, required: true },
  canDo:        { type: Function, required: true },
})
const emit = defineEmits(['close', 'applied'])

const allocBusy = ref(false)          // 正在读 setup / 正在应用
const allocPrev = ref(false)          // 正在预演（只影响按钮文案，不锁输入）
/* ── v336：本商品的分摊占比是不是**推导出来的**（无目标 ⇒ 按本期报单量）──────────
   `true` 时：比例**只读**（它由报单事实推出，不由人手改）、无档案可写、
             「应用」= 只把加单量回填本行；界面文案全部换成"按报单量"口径。
   🔴 判据取**后端 setup 的 `basis`**，不在前端猜（猜 = 第二份实现，迟早与后端分叉）。 */
const allocIsDerived = computed(() =>
  String((allocSetup.value && allocSetup.value.basis) || '') === 'reported')
/* ── v339（P1）：占比是**本期临时设定**的 ──────────────────────────────────────
   `true` 时：占比可改，改动存进「本期临时占比」、**只影响本期**（不写商品目标档案）。
   老板原话：「**L2 的比例『临时改只影响本期』放 P1**」。
   🔴 判据取后端 setup 的 `basis`（与 `allocIsDerived` 同一条纪律：不在前端猜 —— 猜就是
      第二份实现，迟早与后端分叉）。 */
const allocIsOverride = computed(() =>
  String((allocSetup.value && allocSetup.value.basis) || '') === 'override')
/* ── v657：**勾选模式**（从「报单对象名册」挑承接人）────────────────────────────
   什么时候进：setup 说「一个自然承接人都没有」（`flags.no_members` = 无启用目标
   **且**本期没人报过这个商品）**且**候选池非空（`candidates`，用户 2026-10-24
   拍板的名册口径 = 启用中的 report_mapping 别名按员工去重）。
   此时表格改渲染**名册**：逐人一个 checkbox，勾谁谁承接；未勾行占比禁用。
   ⚠️ 保存过本期占比的商品**不会**再进这个模式 —— override 行即自然承接人
      （`_alloc_members_of` 第 0 层），走普通表格，可继续改/清除。 */
/* 🔴🔴 v658b 真缺陷（用户 2026-10-24 实测：「**只勾选了一家门店，弹窗即关闭**」）：
   原判据是 `allocFlags.no_members && candidates.length`，而 `allocFlags` 每轮预演都被
   **后端返回值覆盖**（见 `runAllocPreview` 里的 `allocFlags.value = dd.flags`），
   后端 `extra_alloc_preview` 的 flags 是 `({} if base_mem else {"no_members": True})`
   —— **只要勾了任何一家，`base_mem` 就非空 ⇒ 返回的 flags 里没有 `no_members`**
   ⇒ 本 computed 由真变假 ⇒ 13 行名册整块消失、弹窗只剩勾中的那一行。
   用户看到的就是「弹窗被关掉了」，而且**再也勾不到第二家**（名册没了）。
   修法：判据改取 **setup 的 `can_pick`**（后端 v657 专为此预留：
   `(not members_out) and bool(_pool)`），setup 只在打开弹窗时拉一次、
   不会被任何后续请求改写 ⇒ 天然稳定。旧后端（无该字段）回落到 setup 的 flags
   （同样是快照，**不用** `allocFlags` —— 那是会被覆盖的那一份）。 */
/* ── v659：**名册模式可以手动进**（用户 2026-10-24：「当前如果该产品有人报单，
   点击分摊后只能分给有报单的这几个人，请把它做成没报单的人也可以选择去分摊」）──
   原来只有「本期没人报过、也没有目标」才进名册（`can_pick`）；商品一旦有人报单，
   表格就是那几个报单人，**加不进别人**。现在多一条入口：用户点「选择承接门店」
   ⇒ `allocPickForced` 置真 ⇒ 照常渲染全量名册，并**预勾当前表格里的人**，
   再补勾没报单的门店即可。
   ⚠️ `allocPickAuto` 必须单独留着 —— 两种进入原因的说明文案完全不同
      （自动进 = "一个人都分不到，只能从名册挑"；手动进 = "已勾上本期报单人，
      你还可以再加"）。混用一句话会造成假话。 */
const allocPickForced = ref(false)
const allocPickAuto = computed(() => {
  const s = allocSetup.value
  if (!s || !((s.candidates || []).length)) return false
  if (s.can_pick != null) return !!s.can_pick
  return !!(s.flags && s.flags.no_members)
})
const allocPickMode = computed(() =>
  !!allocSetup.value && !!((allocSetup.value.candidates || []).length)
  && (allocPickAuto.value || allocPickForced.value))
const allocPicked = ref({})          // {<门店键>: true} 勾选态（默认**全不勾**，用户拍板）
/* ── v658：分摊的**身份键从「工号」换成「门店」** ────────────────────────────
   用户 2026-10-24 原话：「**分摊要以门店为维度来分**」。
   同一员工可挂多个门店（生产 tenant_1：柏万红 eid=3 名下「东津」「吾悦」）——
   按工号做键会把两店并成一行，也**勾不出**「东津分 60%、吾悦分 40%」。
   🔴 键从此可能是**非数字字符串**（门店别名）⇒ 本文件内**禁止**再用 `Number(k) > 0`
      当「这个键有效吗」的判据（旧代码到处这么写；换维后它会恒为假 ⇒ 所有勾选
      静默判成"没勾"、占比全部发不出去，而且**零报错**）。
      有效性统一用 `!!k` / `allocKeyOf()`。 */
const allocKeyOf = (x) => {
  const sn = String((x && x.store_name) || '').trim()
  return sn || ('e' + Number((x && x.employee_id) || 0))
}
/* 名册里**没有登录账号**的人数（`has_account` 由后端按 `employee_account_map`
   同一判据解析）—— 定稿通知只投有账号的人（v318 纪律：取不到账号不投、按
   employee_id 硬发会错投）。勾选模式要**汇总提示一次**，不逐行打标（生产
   tenant_1 全部无账号 ⇒ 逐行标会把每一行都染成告警，纯噪音）。 */
const allocPoolNoAcct = computed(() =>
  ((allocSetup.value && allocSetup.value.candidates) || [])
    .filter(c => !c.has_account).length)
/* 占比**能不能改** —— v339 起判据只有一条：本期有没有可分摊对象。
   ⚠️ 旧版把 `reported`（按报单量推导）设为**只读** —— 那等于对用户说
      "想按本月实际情况调？先去建个商品目标吧"，而他要的只是**这一期**的分法。
   · target   ⇒ 改 = 写档案（**全期生效**），既有行为不变；
   · reported ⇒ 改 = 存本期临时占比（v339 新增，只影响本期）；
   · override ⇒ 继续改本期那一份（再改就覆盖）。
   v657：勾选模式下同样要能改（名册里勾的人，占比就是这期专用的分法）；
     但**没勾上的行**仍禁用（模板里另判 `x.picked`）。 */
const allocRatioEditable = computed(() =>
  !!allocSetup.value && (!allocFlags.value.no_members || allocPickMode.value))

/* v657：表格行 —— 普通模式 = 预演结果；名册模式 = **候选池**一门店一行，
   预演结果（占比/报量/加单/定稿）按**门店键**贴上，没勾的人全是 0。
   ⚠️ v658：普通模式的行也必须带 `key` —— 同一员工的两个门店现在是**两行**，
      直接用 `employee_id` 当 `v-for` 的 key 会重复（Vue 会复用错节点、
      改一格的数字跑到另一格去）。
   🔴 v659：名册模式**末尾必须补上「名册里没有的原有承接人」**。
      `_alloc_candidate_pool()` 只收「启用别名 + 绑了员工」的门店，**没有报单别名的
      员工根本不在名册里**。手动切名册时若只渲染 candidates，这些人的承接关系会
      当场消失（用户看到"我原来分给张三的那份不见了"），而且**保存后真的就没了**
      —— 这是会吃掉数据的，不是显示问题。 */
const allocTableRows = computed(() => {
  if (!allocPickMode.value) return allocRows.value || []
  const prev = {}
  ;(allocRows.value || []).forEach(x => { prev[allocKeyOf(x)] = x })
  const out = []
  const seen = {}
  ;((allocSetup.value && allocSetup.value.candidates) || []).forEach(c => {
    const e = Number(c.employee_id) || 0
    const sn = String(c.store_name || '').trim()
    const k = allocKeyOf(c)
    if (!k) return
    seen[k] = true
    const p = prev[k] || null
    out.push({
      key: k,
      store_name: sn,
      employee_id: e,
      employee_name: c.employee_name || ('员工' + e),
      aliases: c.aliases || [],
      has_account: !!c.has_account,
      picked: !!allocPicked.value[k],
      ratio: p ? p.ratio : 0,
      reported_box: p ? p.reported_box : 0,
      alloc_box: p ? p.alloc_box : 0,
      final_box: p ? p.final_box : 0,
    })
  })
  // 不在名册里的原有承接人（无报单别名）—— 保留在表格末尾，可继续分摊/移除
  ;(allocRows.value || []).forEach(x => {
    const k = allocKeyOf(x)
    if (!k || seen[k]) return
    seen[k] = true
    out.push({
      key: k,
      store_name: String(x.store_name || '').trim(),
      employee_id: Number(x.employee_id) || 0,
      employee_name: x.employee_name || ('员工' + (Number(x.employee_id) || 0)),
      aliases: [],
      has_account: false,
      no_alias: true,
      picked: !!allocPicked.value[k],
      ratio: Number(x.ratio) || 0,
      reported_box: Number(x.reported_box) || 0,
      alloc_box: Number(x.alloc_box) || 0,
      final_box: Number(x.final_box) || 0,
    })
  })
  return out
})
/* 已勾选的门店数（勾选模式下「分不满」提示与角落汇总都用它）。
   🔴 必须从**表格行**数，不能从 `allocPicked` 的键数 —— 换门店时用户可能先勾了
      一个随后被删掉的门店，键还在对象里但行已经没了（数字虚高 ⇒ 提示自相矛盾）。 */
const allocPickedCount = computed(() =>
  allocTableRows.value.filter(x => x.picked).length)

const allocErr = ref('')
const allocSetup = ref(null)          // setup 接口的 data
const allocRows = ref([])             // 预演结果（**唯一权威**：加单/定稿两列直接读它）
const allocSummary = ref(null)        // 预演 summary（fully_applied / ratio_gap / clip_gap）
const allocRatioTotal = ref(0)
const allocRatioOk = ref(false)
const allocTargetId = ref(0)
const allocFlags = ref({})
const allocTotalRaw = ref('')         // 总量输入框的**原串**（见下方"为什么存原串"）
const totalInput = ref(null)          // v660：总量输入框（总量为 0 时自动聚焦，见 loadAllocSetup 结尾）
/* v658：三张原串表全部按**门店键**索引（`allocKeyOf(row)`，可能是别名而非数字）。
   ⚠️ 用对象当 map 时数字键与字符串键会被压成同一个字符串，混用不会报错但会串行 ——
      故**全组件统一用 `allocKeyOf()` 产出的字符串键**，不再自己拼。 */
const allocRatiosRaw = ref({})        // {门店键: '占比原串'}
const allocAllocsRaw = ref({})        // {门店键: '加单原串'}（显示用；每轮预演后回填）
const allocArchiveRatios = ref({})    // 档案原比例（供「恢复档案原比例」）
const allocFocusKey = ref('')         // 当前聚焦的「加单(箱)」输入框所属**门店键**（防预演回填打断输入）
let _allocSeq = 0
let _allocTimer = null

/* 为什么三列数字都存**原串**而不直接存 number：
   `Number("12.")` = 12 ⇒ 若边打边把数字写回 `:value`，用户**永远打不出小数点**
   （敲了 `.` 立刻被抹掉）——与编辑网格 `numCommit` 的注释踩的是同一件事。
   故：输入期只做全角折算 + 存原串；**离开这一格（@change）**才收敛成数字并触发联动。 */
const _r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000
const _r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
/* 🔴 v629 修真缺陷：原文是 `props.cross.value` —— **prop 到手时已被 Vue 解包**
   （父模板里 `:cross="cross"` 的 `cross` 是 ref，渲染时就脱壳成 `{period,rows,…}` 对象）。
   于是 `props.cross.value` 恒为 undefined ⇒ `_allocPid()` 恒 0 ⇒ `loadAllocSetup`
   在「期次为空」那一行静默 return ⇒ **弹窗永远停在「正在读取分摊依据…」**。
   本组件所有 `props.row` / `props.cross` 同理，一律**直接当对象用**。 */
const _allocPid = () => Number((props.cross && props.cross.period && props.cross.period.id) || 0)

/* ⚠️ 这里**曾**有个 allocRowRef(r)：按 product_id 回查 cross.rows 再返回。
   它在本组件内从未被调用，却让父级 Forecast.vue 误以为可以 `openAlloc(allocRowRef(r))`
   ⇒ 点了「分摊」直接抛 allocRowRef is not defined（构建不报错、运行时静默失效）。
   2026-10-22 已删：父级直接传 v-for 的 r（本就是编辑态唯一实例），
   且按 product_id 回查在**同品多行**时会命中错行 —— 比不查更糟。
   本组件读行一律用 props.row（**不加 .value**，见 `_allocPid` 处注释）。 */

function syncAllocAllocsFromRows() {
  const m = {}
  ;(allocRows.value || []).forEach(x => {
    const k = allocKeyOf(x)
    if (k !== allocFocusKey.value) m[k] = String(_r3(x.alloc_box))
  })
  // 正在打字的那一格保留用户原串（预演回填不得打断输入）
  const fk = allocFocusKey.value
  if (fk && allocAllocsRaw.value[fk] != null) m[fk] = allocAllocsRaw.value[fk]
  allocAllocsRaw.value = m
}

/* v658：把「占比原串表」翻译成后端契约 —— 每项 `{store_name, employee_id, ratio}`。
   身份键是门店，但 `employee_id` 仍要带上：后端在门店名对不上（老数据/别名改名）时
   用它兜底；两者都空的项**直接丢弃**（否则后端会把它算成一个无名承接人）。
   ⚠️ 只发**表格里真实存在**的行 —— `allocRatiosRaw` 可能残留已被删掉的门店键。
   🔴 v658b：勾选模式下**只发勾中的门店**。名册是 13 行，若把未勾的 11 行也发上去
      （ratio=0），`extra-alloc/override` 是**整组替换** ⇒ `forecast_alloc_ratio`
      会落 13 行、其中 11 行 0% ⇒ 下次打开时 `basis=override` 且有 13 个成员
      ⇒ `can_pick` 为假 ⇒ **再也回不到名册**（用户没法把漏勾的门店补上，
      只能在 13 行 0% 的表格里自己找）。这条不修，勾选模式是"一次性"的。 */
function _ratioPayload() {
  const pick = allocPickMode.value
  const out = []
  ;(allocTableRows.value || []).forEach(x => {
    if (pick && !x.picked) return
    const k = (x && x.key) || allocKeyOf(x)
    if (!k) return
    out.push({
      store_name: String((x && x.store_name) || '').trim(),
      employee_id: Number((x && x.employee_id) || 0),
      ratio: _allocNum(allocRatiosRaw.value[k]),
    })
  })
  return out
}

async function runAllocPreview() {
  const data = allocSetup.value
  const periodId = _allocPid()
  const pid = Number(data && data.product && data.product.id) || 0
  if (!data || !periodId || !pid) return
  const seq = ++_allocSeq
  allocPrev.value = true
  try {
    /* v658：占比按**门店键**下发（`{store_name, employee_id, ratio}`）—— 后端
       `extra_alloc_preview` 优先用 `store_name` 当覆盖键、无门店名才回落工号。 */
    const ratios = _ratioPayload()
    /* v657：勾选模式把「勾了哪些门店 + 各自占比」一并带给后端 —— 后端按这份名单算
       （并校验每个门店都在「本来就能分摊 ∪ 候选池」里，不允许凭空造门店）。
       ⚠️ 首开时 `allocFlags` 还没被 setup 之后的第一次预览刷新 ⇒ `allocPickMode`
          此刻为假 ⇒ members 为空 ⇒ 后端按自然承接人（空）算，返回空表 +
          no_members —— 正是「还没勾人」的正确展示，随后 flags 落地再点勾即变。 */
    let members = []
    if (allocPickMode.value) {
      members = (allocTableRows.value || [])
        .filter(x => x.picked)
        .map(x => ({
          store_name: String(x.store_name || '').trim(),
          employee_id: Number(x.employee_id) || 0,
          ratio: _allocNum(allocRatiosRaw.value[x.key]),
        }))
    }
    const d = await productTargetsApi.extraAllocPreview({
      periodId, productId: pid,
      totalDelta: _allocNum(allocTotalRaw.value),
      ratios, members,
    })
    if (seq !== _allocSeq) return              // 过期响应直接丢弃（连点/连改会并发多个请求）
    // 同上：api() 已解包一层，`d` 就是 {rows,summary,ratio_total,…}，不要再取 `.data`
    const dd = d || null
    allocRows.value = (dd && dd.rows) || []
    allocSummary.value = (dd && dd.summary) || null
    allocRatioTotal.value = dd ? Number(dd.ratio_total) : 0
    allocRatioOk.value = dd ? !!dd.ratio_ok : false
    allocTargetId.value = dd ? (Number(dd.target_id) || 0) : 0
    allocFlags.value = (dd && dd.flags) || {}
    allocErr.value = ''
    syncAllocAllocsFromRows()
  } catch (e) {
    if (seq !== _allocSeq) return
    allocErr.value = (e && e.message) || '预演失败'
  } finally {
    if (seq === _allocSeq) allocPrev.value = false
  }
}
function allocPreviewSoon() {
  if (_allocTimer) clearTimeout(_allocTimer)
  _allocTimer = setTimeout(() => { _allocTimer = null; runAllocPreview() }, 260)
}


/* 打开后的数据加载：父级 openAlloc 校验通过、allocOpen=true 挂载本组件时触发 */
async function loadAllocSetup() {
  const row = props.row          // 见 `_allocPid` 处注释：prop 已解包，不要再 `.value`
  if (!row) return
  const pid = Number(row.product_id) || 0
  const periodId = _allocPid()
  if (!pid || !periodId) return
  allocSetup.value = null
  allocRows.value = []
  allocSummary.value = null
  allocErr.value = ''
  allocFlags.value = {}
  allocTargetId.value = 0
  allocRatioOk.value = false
  allocRatioTotal.value = 0
  allocArchiveRatios.value = {}
  allocRatiosRaw.value = {}
  allocAllocsRaw.value = {}
  allocFocusKey.value = ''
  allocPicked.value = {}            // v657：勾选态每次重开都重置为「全不勾」
  allocPickForced.value = false     // v659：手动进入名册的开关也随之复位
  allocTotalRaw.value = String(_r3(row.extraQty))
  allocBusy.value = true
  try {
    const d = await productTargetsApi.extraAllocSetup(periodId, pid)
    // 期间用户可能关了、或又点了别的商品 ⇒ 只在"还是这一个商品"时才落盘
    if (!props.open || !props.row || Number(props.row.product_id) !== pid) return
    /* 🔴 v629 修真缺陷（第五例）：**不能**再写 `(d && d.data)`。
       `api()`（src/api/client.js）末尾已经做过 `return data.data !== undefined ? data.data : data`
       ⇒ 到这里的 `d` **就是** data 本体（`{period,product,target,members,…}`）。
       再解一次 `.data` ⇒ 恒 undefined ⇒ allocSetup 恒 null ⇒ 弹窗永远停在
       「正在读取分摊依据…」，且**零报错**（catch 不触发、finally 正常收尾）。
       参照同文件 `avgTarget` 的正确写法：拿到 d 直接 `d.items`。 */
    const data = d || null
    allocSetup.value = data
    if (data) {
      /* 总量的初值。🔴 v660：**只有本行还没填（0/空）时才用接口的已落库值兜底**。
         旧实现是 `if (cur)` 无条件覆盖 —— 后果：用户已经在加单格里把 100 改成 200
         （未保存），一点「分摊」总量就被后端 `forecast_extra_qty` 里的旧值 100 顶掉，
         他再点保存，回填的自然是 100 ⇒ 体感就是「我填的数没有回填」。
         本行有值就以本行为准（那是用户此刻的手笔），后端值只做空值兜底。 */
      const cur = Number(data.total_delta) || 0
      if (cur && !(Math.abs(Number(row.extraQty) || 0) > 1e-9)) {
        allocTotalRaw.value = String(_r3(cur))
      }
      const arch = {}, raw = {}
      ;(data.members || []).forEach(m => {
        // v658：键 = 门店（`store_name`），同一员工的两个门店各占一条
        const k = allocKeyOf(m)
        if (!k || k === 'e0') return
        arch[k] = Number(m.ratio) || 0
        raw[k] = String(_r2(m.ratio))
      })
      allocArchiveRatios.value = arch
      allocRatiosRaw.value = raw
    }
    await runAllocPreview()
    /* v660：总量为 0 ⇒ 这次分摊**分不出任何数量**（0 × 任何占比还是 0）。
       用户 2026-10-24 报的「分摊数量没有回填」就是这种情形：他勾了 10 个门店、
       占比设成 10 家各 10%，点「保存本期占比并回填」—— 占比存下了，但加单格
       回填的还是 0，界面上什么都没变，看起来像"没回填"。
       ⇒ 进窗就把光标放到总量框，让他第一眼看到该填哪儿。 */
    if (allocTotalZero.value) focusTotal()
  } catch (e) {
    allocErr.value = (e && e.message) || '读取分摊依据失败'
    toast('读取分摊依据失败：' + allocErr.value, 'err')
  } finally {
    allocBusy.value = false
  }
}

/* 关闭：交还父组件统一清 allocOpen / allocRow（单一收口，避免两边各清一半） */
function closeAlloc() { emit('close') }
/* v660：把光标放到「本期加单总量」框并全选 —— 总量为 0 时唯一的正事就是填它。 */
function focusTotal() {
  try {
    const el = totalInput.value
    if (!el) return
    el.focus()
    if (el.select) el.select()
  } catch (_) { /* 聚焦失败不影响业务 */ }
}

/* 总量（改完离开这一格 ⇒ 联动重算） */
function onAllocTotalInput(e) { props.numInput(e, (v) => { allocTotalRaw.value = v }) }
function onAllocTotalCommit(e) {
  const v = _allocNum(e && e.target ? e.target.value : allocTotalRaw.value)
  allocTotalRaw.value = String(v)
  loadAllocArchivedRatiosIfEmpty()
  runAllocPreview()
}
/* 占比（同上；比例始终是"输入源"，预演**不回写**它） */
function onAllocRatioInput(e, key) { props.numInput(e, (v) => { allocRatiosRaw.value[key] = v }) }
function onAllocRatioCommit(e, key) {
  const v = _allocNum(e && e.target ? e.target.value : allocRatiosRaw.value[key])
  allocRatiosRaw.value[key] = String(v)
  runAllocPreview()
}
function loadAllocArchivedRatiosIfEmpty() {
  // setup 没回来时（极少数：接口失败）用户仍可能改总量 ⇒ 至少让比例有一份可算的值
  const raw = allocRatiosRaw.value || {}
  if (Object.keys(raw).length) return
  const arch = allocArchiveRatios.value || {}
  const m = {}
  Object.keys(arch).forEach(k => { m[k] = String(_r2(arch[k])) })
  allocRatiosRaw.value = m
}

/* 加单(箱) 直接改 ⇒ **反向回推比例**：rᵢ := aᵢ / Σa × 100，并把总量改为 Σa。
   为什么双向都要收敛：只改 aᵢ 而不改 rᵢ 会让 Σaᵢ ≠ 总量，而 `allocate()` 是按占比算的
   ⇒ 下一次预演会把用户刚填的数**改回去**（"填了没用"）。两条路径必须同时收敛。
   🔴 归一化是**公开的界面规则**（不是 `allocate` 的第二份实现）：它只做"按权重缩放"，
     不碰夹断/重分 —— 那部分仍只由后端算。 */
function onAllocAllocInput(e, key) { props.numInput(e, (v) => { allocAllocsRaw.value[key] = v }) }
function onAllocAllocCommit(e, key) {
  /* 🔴 v660：名册态下必须按**表格行**（= 候选池 + 遗留承接人）算，不能再用 `allocRows`
     —— 后者只含**已勾选**的门店。用户去改一个「还没勾」的门店的加单量时，
     它不在 `allocRows` 里 ⇒ 新值进不了 `want` ⇒ 被静默丢弃，然后占比与总量按
     其余行重算，他刚敲的数当场"自己变回去"（同 v359「填了不算」的老病，新成因）。 */
  const rows = allocPickMode.value
    ? (allocTableRows.value || []).filter(x => x.picked)
        .map(x => ({ key: x.key, store_name: x.store_name, employee_id: x.employee_id, alloc_box: x.alloc_box }))
    : (allocRows.value || [])
  if (!rows.length) return
  if (!rows.some(x => allocKeyOf(x) === key)) {
    toast('这个门店还没勾选 —— 先勾上，才能给它单独改加单量', 'warn')
    runAllocPreview()
    return
  }
  const v = _allocNum(e && e.target ? e.target.value : allocAllocsRaw.value[key])
  allocAllocsRaw.value[key] = String(v)
  const want = {}          // {门店键: 用户想要的加单量}
  rows.forEach(x => {
    const k = allocKeyOf(x)
    want[k] = (k === key) ? v
      : _allocNum(allocAllocsRaw.value[k] != null ? allocAllocsRaw.value[k] : _r3(x.alloc_box))
  })
  const sum = Object.keys(want).reduce((s, k) => s + (Number(want[k]) || 0), 0)
  if (Math.abs(sum) < 1e-9) { toast('各人的加单量合计为 0，无法反推占比', 'warn'); runAllocPreview(); return }
  // 归一化到 Σ=100（保留 2 位；尾差补到**绝对值最大**的那一项，避免末位 99.99/100.01 抖动）
  const keys = Object.keys(want)
  const raw = keys.map(k => (Number(want[k]) || 0) / sum * 100)
  const rnd = raw.map(x => Math.round(x * 100) / 100)
  let resid = Math.round((100 - rnd.reduce((s, x) => s + x, 0)) * 100) / 100
  if (Math.abs(resid) >= 0.005) {
    let bi = 0
    rnd.forEach((x, i) => { if (Math.abs(raw[i]) > Math.abs(raw[bi])) bi = i })
    rnd[bi] = Math.round((rnd[bi] + resid) * 100) / 100
  }
  const newRaw = {}
  keys.forEach((k, i) => { newRaw[k] = String(rnd[i]) })
  allocRatiosRaw.value = newRaw
  allocTotalRaw.value = String(_r3(sum))
  runAllocPreview()
}

/* 平均分配：Σ 精确 = 100，尾差给最后一人（与 `ProductTarget.vue::splitEven` 同规则）
   v657：名册态下如果**一个都没勾**，它就是「一键全勾 + 均分」（用户拍板：默认全不勾，
   要全勾就点它）—— 名单取候选池而不是预演结果（还没勾人时预演结果本来是空的）。
   🔴 v659：名册态下**已经勾了人**时，只均分**已勾选**的那些，不再顺手把 13 家全勾上。
      原因：手动进入名册后（`enterPickMode` 会预勾本期报单人），用户点「平均分配」的
      真实意思是「这几家平摊」，若在这里全勾，等于把量摊给了 11 个他没打算给的门店
      —— 而界面上只是个"平均分配"按钮，他完全预期不到这个后果。 */
function allocSplitEven() {
  if (allocPickMode.value) {
    let rows = allocTableRows.value.filter(x => x.picked)
    if (!rows.length) {
      const picked = {}
      allocTableRows.value.forEach(x => { if (x.key) picked[x.key] = true })
      allocPicked.value = picked
      rows = allocTableRows.value
    }
    const n = rows.length
    if (!n) return
    const base = Math.round((100 / n) * 100) / 100
    const raw = {}
    rows.forEach((x, i) => {
      const k = x.key || allocKeyOf(x)
      if (!k) return
      raw[k] = String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base)
    })
    allocRatiosRaw.value = raw
    runAllocPreview()
    return
  }
  const rows = allocRows.value || []
  if (!rows.length) return
  const n = rows.length
  const base = Math.round((100 / n) * 100) / 100
  const raw = {}
  rows.forEach((x, i) => {
    const k = allocKeyOf(x)
    if (!k) return
    raw[k] = String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base)
  })
  allocRatiosRaw.value = raw
  runAllocPreview()
}
/* v657：勾选 / 取消某个承接门店（v658 起单位 = **门店**）。
   🔴 v658b：勾选集合一变就**按当前勾选数均分**，理由有两条，都是用户当场会撞上的：
     ① 后端把「勾了但没给占比」按 `ratio=0` 处理 ⇒ Σ≠100 ⇒「应用」按钮恒灰
        （`:disabled="... || !allocRatioOk"`）⇒ 用户勾了一家还得自己手填 100
        才点得动，对他就叫"勾了没用"。勾一家 = 100%、勾两家 = 50/50，
        这正是他最常做的动作，不该让他手算。
     ② `allocRatiosRaw` 里只留**当前勾中**的键 —— 未勾的键若残留，`_ratioPayload`
        （虽已过滤）之外的地方仍可能读到它，属于"取消了还占额度"的老毛病。
   ⚠️ 代价：这会覆盖他手调过的比例。但成员集合刚变过，重设一份是合理的；
      要保留自己那套，就别改勾选、直接改数字。 */
function togglePick(key) {
  const k = String(key || '')
  if (!k) return
  const next = { ...allocPicked.value }
  if (next[k]) delete next[k]
  else next[k] = true
  allocPicked.value = next
  _allocAfterPickChange(Object.keys(next))
}

/* v671：勾选集合变了之后的固定收尾（重新均分占比 + 重跑预览）。
   `togglePick`（单个）与 `togglePickAll`（表头全选）共用 ——
   🔴 不写两份：两份实现迟早漂移，v607 就是这么踩的。 */
function _allocAfterPickChange (keys) {
  if (!keys.length) {
    allocRatiosRaw.value = {}
    runAllocPreview()
    return
  }
  const n = keys.length
  const base = Math.round((100 / n) * 100) / 100
  const raw = {}
  keys.forEach((key2, i) => {
    raw[key2] = String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base)
  })
  allocRatiosRaw.value = raw
  runAllocPreview()
}
/* v671：表头全选 —— 范围 = 当前候选表里列出的这些门店（与表体 v-for 同一份数据）。 */
const allocAllOn = computed(() => allocTableRows.value.length > 0 && allocTableRows.value.every(x => x.picked))
const allocSomeOn = computed(() => !allocAllOn.value && allocTableRows.value.some(x => x.picked))
function togglePickAll (on) {
  const next = { ...allocPicked.value }
  ;(allocTableRows.value || []).forEach(x => {
    const k = x.key || allocKeyOf(x)
    if (!k) return
    if (on) next[k] = true
    else delete next[k]
  })
  allocPicked.value = next
  _allocAfterPickChange(Object.keys(next))
}
/* v659：手动切进「报单门店名册」—— 让**没报单的门店**也能被选来分摊。
   进入时**预勾当前表格里的人**（本期报单人 / 目标承接人），并保留他们现有的占比，
   所以"只是进来看看"不会有任何变化；要加人再勾。
   ⚠️ 不在这里做均分：现有占比是用户/系统算好的一份（Σ 通常本来就是 100），
      进来就重分等于擅自改数。只有他**勾/取消**（`togglePick`）才重新均分。 */
function enterPickMode() {
  const s = allocSetup.value
  if (!s || !((s.candidates || []).length)) {
    toast('没有可挑的报单门店（报单配置里还没有启用的别名）', 'warn')
    return
  }
  const picked = {}
  const raw = {}
  let sum = 0
  ;(allocTableRows.value || []).forEach(x => {
    const k = x.key || allocKeyOf(x)
    if (!k) return
    const r = (allocRatiosRaw.value[k] != null)
      ? _allocNum(allocRatiosRaw.value[k])
      : (Number(x.ratio) || 0)
    if (r <= 1e-9) return          // 0 占比的人不预勾（勾了也只是 0，纯噪音）
    picked[k] = true
    raw[k] = String(_r2(r))
    sum += r
  })
  allocPicked.value = picked
  /* 现有占比合计不是 100（例如 override 只留下一部分、或按报单量推导有缺口）⇒
     均分兜底，否则用户一进来「保存」就是灰的，还得先自己凑够 100。 */
  const keys = Object.keys(raw)
  if (keys.length && Math.abs(sum - 100) > 0.5) {
    const n = keys.length
    const base = Math.round((100 / n) * 100) / 100
    keys.forEach((k, i) => {
      raw[k] = String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base)
    })
  }
  allocRatiosRaw.value = raw
  allocPickForced.value = true
  runAllocPreview()
}
/* 退出名册、回到"系统自动按报单量/档案分"的表格（**不改任何已存数据**） */
function exitPickMode() {
  allocPickForced.value = false
  allocPicked.value = {}
  allocRatiosRaw.value = {}
  runAllocPreview()
}
function allocResetRatios() {
  const arch = allocArchiveRatios.value || {}
  const raw = {}
  Object.keys(arch).forEach(k => { raw[k] = String(_r2(arch[k])) })
  allocRatiosRaw.value = raw
  runAllocPreview()
}
function allocRatiosChanged() {
  const arch = allocArchiveRatios.value || {}
  const raw = allocRatiosRaw.value || {}
  const ks = Object.keys(raw)
  if (ks.length !== Object.keys(arch).length) return true
  for (const k of ks) {
    if (Math.abs(_allocNum(raw[k]) - (Number(arch[k]) || 0)) > 0.005) return true
  }
  return false
}
/* `parseNumInput` 解析失败时会**保留原串**（这是它的既有契约，见 Q18 注释）⇒ 这里必须再收敛
   成有限数字，否则 `Math.abs('abc')` = NaN 会顺手把整块界面染成 NaN。 */
function _allocNum(v) {
  const n = parseNumInput(v)
  return (typeof n === 'number' && isFinite(n)) ? n : 0
}
function allocTotalNum() { return _allocNum(allocTotalRaw.value) }
/* v660：总量是不是 0（= 这一趟分摊分不出任何数量）。
   ⚠️ 必须定义在 `allocTotalNum` **之后**：本仓的 SFC 符号检查器按声明顺序静态解析，
      前置引用会被判成「未定义: (未能解析)」而把基线打红（cd 前 200 行的位置就是坑）。 */
const allocTotalZero = computed(() => Math.abs(allocTotalNum()) < 1e-9)
function allocAllocNum(key) {
  const raw = allocAllocsRaw.value[key]
  if (raw != null) return _allocNum(raw)
  const r = (allocRows.value || []).find(x => allocKeyOf(x) === key)
  return r ? Number(r.alloc_box) || 0 : 0
}

/* 应用：① 比例写目标档案（全期生效，仅在改动时写）② 加单量回填本行（仍随「保存」落库） */
async function applyAlloc() {
  const data = allocSetup.value, row = props.row
  if (!data || !row || allocBusy.value) return
  if (allocRatioOk.value !== true) {
    toast(`占比合计 ${fmt(allocRatioTotal.value)}%，必须等于 100% 才能应用到目标档案`, 'warn'); return
  }
  const tid = Number(allocTargetId.value) || 0
  // ── v339（P1）：占比存到哪 —— **两条不同的写路**，由 `basis` 决定（判据来自后端）──
  //   · 'target'                ⇒ 写**商品目标档案**（`PUT /product-targets/{tid}`），
  //                                 **全期生效**（v318 既有行为，不变）；
  //   · 'reported' / 'override' ⇒ 写**本期临时占比**（`PUT .../extra-alloc/override`），
  //                                 **只影响本期**、不碰档案（v339 新增）。
  //   🔴 旧实现把 'reported' 的 `changed` 直接置 `false` ⇒ 用户改了比例、点「应用」、
  //      看到「记得点保存」、保存后**比例回到原样** —— 而且**全程零报错**。
  //      这正是本项目反复栽的那类「界面允许你改、保存后无声丢失」。
  const _basis = String((allocSetup.value && allocSetup.value.basis) || 'target')
  const _derived = (_basis === 'reported')
  const _ovr = (_basis === 'override')
  // 本期临时占比这条路（L2 推导 / 已被覆盖）**不需要**目标档案 ⇒ 没有 tid 也合法
  // v657：勾选模式同样恒走这条路 —— 名册里挑的人本来就不在任何商品目标档案里，
  //   「本期专用占比」是他们**唯一**的落点（写档案那条路对他们不存在）。
  const _periodPath = (_derived || _ovr || allocPickMode.value)
  if (!tid && !_periodPath) {
    toast('该商品本月没有启用的目标，比例无处可存（请先到「商品目标」页建目标）', 'err'); return
  }
  const changed = allocRatiosChanged()
  const _pid = Number((data.product && data.product.id) || 0)
  const _periodId = _allocPid()
  allocBusy.value = true
  try {
    if (changed) {
      if (_periodPath) {
        // v339：本期临时占比（**只影响本期**）。整组提交 —— 占比是一组相互约束的值（Σ=100），
        //   逐行 upsert 会让并发读取侧读到"合计不是 100%"的中间态。
        // v658：按**门店**提交（`{store_name, employee_id, ratio}`），与预演同源。
        await productTargetsApi.extraAllocOverride({
          periodId: _periodId, productId: _pid,
          ratios: _ratioPayload(),
        })
      } else {
        // 全量提交（`_write_allocs` 是整体替换）—— 保持与档案同样的排序（sort_no = 数组下标）
        // v658：**必须带 `store_name`** —— 档案承接人的唯一键是 (target_id, store_name)，
        //   漏了它后端会退回员工名兜底 ⇒ 同一员工的两个门店被写成一模一样的两行、
        //   撞唯一约束（整笔保存 500），或更糟：并成一行、丢掉其中一个门店的分法。
        const allocs = (allocRows.value || []).map(x => ({
          employee_id: Number(x.employee_id) || 0,
          employee_name: x.employee_name || '',
          store_name: String(x.store_name || '').trim(),
          ratio: _allocNum(allocRatiosRaw.value[allocKeyOf(x)]),
        }))
        await productTargetsApi.update(tid, { allocs })
      }
    }
    /* 写网格统一交给父级执行（emit('applied')），本组件不直接改 cross.rows */
    /* 🔴 v660（2026-10-24，用户报「分摊数量没有回填」）：总量是 0 时**不许静默过**。
       0 × 任何占比都是 0 ⇒ 回填 0 ⇒ 加单格与点之前毫无差别，用户看到的就是
       "我把分摊设好了、也点了保存，可汇总表那格什么都没出现"。
       而界面上的承诺恰恰是「保存本期占比**并回填**」—— 承诺了没做到，且零提示，
       正是本项目反复要防的那类静默失效。
       ⇒ 占比照存（那是他真正设好的东西），但**不关闭弹窗**、聚焦总量框、
         用 warn 说明「占比已存、数量还是 0」，让他当场填完再点一次。 */
    const _amt = allocTotalNum()
    if (Math.abs(_amt) < 1e-9) {
      toast('占比已保存，但本期加单/减单总量还是 0 —— 没有任何数量可回填。'
            + '请在上方「本期加单总量」里填数量，再点一次这个按钮。', 'warn')
      focusTotal()
      return
    }
    /* v661：连**分配结果**一起交给父级 —— 父级要把每个门店分到的量叠到它那一列
       （用户 2026-10-24 拍板「门店列直接显示最终量」）。带 `alloc_box`（箱）而不是
       已换算的桶：换算必须由父级用 `perCase` 做，与「合计(箱)」同源，本组件不复制那份口径。 */
    emit('applied', {
      extraQty: _amt,
      allocs: (allocRows.value || []).map(x => ({
        store_name: String(x.store_name || '').trim(),
        employee_id: Number(x.employee_id) || 0,
        alloc_box: Number(x.alloc_box) || 0,
      })),
    })
    // toast 必须按**实际写了什么**说 —— 说错就是让用户对"全期比例变没变"产生错误预期。
    toast(_periodPath
      ? (changed
        ? '已保存本期临时占比（**只影响本期**，没改商品目标档案），并把加单量回填到本行 —— 记得点「保存」'
        : `已把加单量回填到本行 —— 本商品本期按**各门店报单量**自动分给 ${(allocRows.value || []).length} 个门店/人，记得点「保存」`)
      : (changed
        ? '已更新该商品的目标档案占比（全期生效），并把加单量回填到本行 —— 记得点「保存」'
        : '已把加单量回填到本行 —— 记得点「保存」'), 'ok')
    closeAlloc()
  } catch (e) {
    toast('应用失败：' + ((e && e.message) || '未知错误'), 'err')
  } finally {
    allocBusy.value = false
    props.loadPtGap()        // 比例/分配可能已变 ⇒ 刷新角标与悬停（只读；失败静默）
  }
}

/* v339：**清除本期临时占比** —— 回到自动判据（有档案按档案、无档案按报单量）。
   这是「改错了要能退回去」的**唯一**入口：没有它，用户只能把每个人手动敲回原值，
   而且**永远回不到"没设过"的状态**（`basis` 会一直是 override，界面也就一直说"你改过"，
   可他其实想撤销）。
   ⚠️ 只清占比、**不动加单量** —— 加单量是另一件事，仍随「保存汇总表」落库。 */
async function allocClearOverride() {
  const data = allocSetup.value
  if (!data || allocBusy.value) return
  const _pid = Number((data.product && data.product.id) || 0)
  const _periodId = _allocPid()
  if (!_pid || !_periodId) { toast('当前没有可分摊的期次', 'warn'); return }
  allocBusy.value = true
  try {
    // ratios 传空数组 = 清除（后端语义：空即撤销覆盖、回落到自动判据）
    await productTargetsApi.extraAllocOverride({
      periodId: _periodId, productId: _pid, ratios: [],
    })
    toast('已清除本期临时占比 —— 该商品恢复为自动判据（有目标按目标、没有则按本期报单量）', 'ok')
    closeAlloc()
  } catch (e) {
    toast('清除失败：' + ((e && e.message) || '未知错误'), 'err')
  } finally {
    allocBusy.value = false
    props.loadPtGap()
  }
}

onMounted(() => { loadAllocSetup() })
</script>

<template>
    <!-- v318：一键分摊弹窗（编辑态「加单(箱)」格的分摊按钮唤起）—— 预演台，不是第二份分摊算法 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="open" class="imp-overlay" @click="closeAlloc"></div></Transition>
      <Transition name="pop">
        <div v-if="open" class="imp-modal alloc-modal">
          <div class="imp-hd">
            <b>按比例分摊 · {{ (allocSetup && allocSetup.product && allocSetup.product.name) || '商品' }}</b>
            <button class="imp-x" @click="closeAlloc"><Icon name="close"/></button>
          </div>
          <div class="imp-body">
            <!-- v336：前置缺失必须**分开说**（两者成因与解法完全不同）──────────────
                 · `no_members` = **真的一条都分不出去**（无目标 **且** 本期没人报过）⇒ 必须点名；
                 · `no_target`（只是没有目标）**不再**是"分不出去" —— 会走 L2
                   （按本期各人报单量推导占比），所以这里只是**说明依据变了**，表格照常显示。
                 旧文案把两者混为一谈，会把人引去建一个他并不需要的目标。
                 v657：`no_members` **且候选池有人** = 勾选模式（下面那段 alloc-note），
                 「一个人都分不到」那句 warn 只在**池也空**时才说 —— 有路可走时说死路
                 等于假话。 -->
            <p v-if="allocSetup && allocFlags.no_members && !allocPickMode" class="imp-tip warn-text">
              该商品<b>本期没有人报过单，也没有启用目标</b>（或目标没填分解承接人）
              ⇒ 这笔加/减单<b>一个人都分不到</b>，保存后也不会有任何人的量被调整。
              请先让业务员在「报单」里报这个商品，或到「商品目标」页为它建目标并填分解比例。
            </p>
            <p v-else-if="allocPickMode && allocPickAuto" class="imp-tip alloc-note">
              ⓘ 该商品<b>本期没有人报过单、也没有启用目标</b> ⇒ 从下方<b>报单门店名册</b>里
              <b>勾选</b>承接这笔{{ allocTotalNum() >= 0 ? '加单' : '减单' }}的门店（<b>可以勾多家</b>，
              一家也能分）。每勾一个/取消一个，占比会<b>按勾中的门店数自动均分</b>，均完还能自己改；
              点「平均分配」= 一键全勾并均分。保存的是<b>本期专用占比</b>，只影响本期。
            </p>
            <!-- v659：用户手动切进来的名册态（该商品本期有人报单，但要把量分给没报单的门店） -->
            <p v-else-if="allocPickMode" class="imp-tip alloc-note">
              ⓘ 你正在<b>手动挑选承接门店</b>：已经勾上本期<b>报过单</b>的门店，
              你可以继续勾<b>其他门店</b>（<b>本期没报单的也能勾</b>）——
              勾上的门店会按占比直接分到这笔{{ allocTotalNum() >= 0 ? '加单' : '减单' }}。
              每勾一个/取消一个，占比会<b>按勾中的门店数自动均分</b>，均完还能自己改。
              保存的是<b>本期专用占比</b>，只影响本期、不改商品目标档案。
            </p>
            <p v-else-if="allocSetup && allocFlags.no_target" class="imp-tip alloc-note">
              该商品在 <b>{{ (allocSetup.product && allocSetup.product.month) || '' }}</b> 没有启用目标
              ⇒ 本次按<b>各人本期报单量</b>推导占比来分摊（客观事实，<b>比例只读</b>）。
              要让比例可调，请到「商品目标」页为它建目标并填分解比例。
            </p>
            <!-- v657：名册里没有登录账号的人，定稿通知到不了 —— **汇总说一次**，
                 不逐行打标（生产 tenant_1 全员无账号 ⇒ 逐行标全是噪音）。 -->
            <p v-if="allocPickMode && allocPoolNoAcct > 0" class="imp-tip warn-text">
              名册中有 {{ allocPoolNoAcct }} 个门店的负责人没有关联登录账号 —— 期次<b>定稿（关闭期次）</b>时
              这些门店收不到加/减单通知（分配本身不受影响）。要收到通知，请先到「员工档案」
              给他们关联登录账号。
            </p>
            <template v-if="allocSetup && (!allocFlags.no_members || allocPickMode)">
              <div class="alloc-top">
                <label>本期{{ allocTotalNum() >= 0 ? '加单' : '减单' }}总量</label>
                <input ref="totalInput" class="cell-input alloc-num" type="text" inputmode="decimal" :value="allocTotalRaw"
                       title="正数 = 加单，负数 = 减单；改完按回车或点别处即重新联动"
                       @input="onAllocTotalInput" @change="onAllocTotalCommit">
                <span class="alloc-unit">箱</span>
                <span v-if="Number(allocSetup.product && allocSetup.product.large_ratio) > 0" class="alloc-conv">
                  ≈ {{ fmt(Math.abs(allocTotalNum()) * Number(allocSetup.product.large_ratio)) }} {{ (allocSetup.product && allocSetup.product.unit) || '小单位' }}
                </span>
              </div>
              <!-- v660：总量为 0 = 这次分摊分不出任何数量（0 × 占比还是 0）。
                   保存按钮照旧可点（占比是他真设好的东西），但必须让他**事先**知道
                   这一趟不会产生数量 —— 否则就是用户 2026-10-24 报的「分摊数量没有回填」：
                   勾了 10 家、占比设好、点了保存，汇总表那格原样不动，一句提示都没有。 -->
              <p v-if="allocSetup && allocTotalZero" class="imp-tip warn-text">
                ⚠ 还没有填<b>本期{{ allocTotalNum() >= 0 ? '加单' : '减单' }}总量</b> ——
                现在保存只会记住占比，<b>不会产生任何分摊数量</b>。先在上面那个输入框里填数量
                （正数加单、负数减单），勾选的结果才会真正分到各门店名下。
              </p>
              <!-- v659：这三段讲的是「改动会落到哪」（档案 = 全期 / 本期专用），
                   在**名册态**下全是假话 —— 名册里挑的人恒走「本期专用占比」
                   （`_periodPath` 含 allocPickMode），不会改目标档案。
                   故名册态一律不显示，只留上面那条名册说明。 -->
              <template v-if="!allocPickMode">
                <p v-if="allocIsOverride" class="imp-tip alloc-note">
                  ⓘ 占比是<b>本期临时设定</b>的<template v-if="allocSetup.override && allocSetup.override.operator"
                    >（{{ allocSetup.override.operator }} 设定）</template> —— 改动<b>只影响本期</b>，
                  不会改商品目标档案。
                </p>
                <p v-else-if="allocIsDerived" class="imp-tip alloc-note">
                  ⓘ 该商品本期没有目标 ⇒ 原本按<b>各人本期报单量</b>推导占比。
                  在这里改动会存成<b>本期专用</b>占比（<b>只影响本期</b>、不改商品目标档案）；
                  存下之后，业务员后来补报也不会再自动改变你定下的分法。
                </p>
                <p v-else class="imp-tip alloc-note">
                  ⓘ 占比来自该商品的<b>目标档案</b>。在这里改动会<b>同时改写目标档案</b> ——
                  该商品<b>本月所有期次</b>的加单分摊都会跟着变（不只是本期）。
                </p>
              </template>
              <div class="alloc-tbl-wrap">
                <table class="alloc-tbl">
                  <thead>
                    <tr>
                      <!-- v671：勾选列表头放全选三态框（原型 = 本期预报 v615 那颗）。
                           范围 = 当前候选表里可见的这些门店，部分选中显示半选。 -->
                      <th v-if="allocPickMode" class="chk" title="勾选后这个门店才参与本期分摊">
                        <SelectAllCheckbox :checked="allocAllOn" :indeterminate="allocSomeOn"
                                           :disabled="!allocTableRows.length" :count="allocTableRows.length"
                                           unit="个门店" title="全选/取消当前列出的这些门店（勾选的才参与本期分摊）"
                                           @toggle="togglePickAll" />
                      </th>
                      <th>{{ allocPickMode ? '报单门店' : ((allocIsDerived || allocIsOverride) ? '报单门店' : '承接门店') }}</th><th class="num">占比%</th><th class="num">本期报量(箱)</th>
                      <th class="num">加单(箱)</th><th class="num">定稿(箱)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <!-- 逐行顺序 = `product_target_alloc.sort_no`（与目标档案一致，改比例时按它整表回写）；
                         v657 勾选模式 = 候选池顺序（后端按「工号 → 门店名」排，同一员工的两门店相邻）
                         🔴 v658：`v-for` 的 key 用**门店键**，不能用 employee_id ——
                            同一员工的两个门店是两行，用 employee_id 会重复 ⇒ Vue 复用错节点。 -->
                    <tr v-for="x in allocTableRows" :key="allocKeyOf(x)">
                      <td v-if="allocPickMode" class="chk">
                        <input type="checkbox" :checked="x.picked" @change="togglePick(allocKeyOf(x))"
                               title="勾选后这个门店才参与本期分摊">
                      </td>
                      <!-- v658：主标签 = **门店**（别名），员工名退到括号里 —— 用户要按门店分，
                           一眼看「东津」「吾悦」才认得出；但同一员工的两个门店必须能看出是谁的。 -->
                      <td>
                        <b>{{ x.store_name || x.employee_name || ('员工' + x.employee_id) }}</b>
                        <span v-if="x.store_name && x.employee_name && x.store_name !== x.employee_name"
                              class="alloc-alias">（{{ x.employee_name }}）</span>
                        <span v-else-if="allocPickMode && x.aliases && x.aliases.length > 1" class="alloc-alias"
                              :title="'报单别名：' + x.aliases.join('、')">（{{ x.aliases.join('、') }}）</span>
                      </td>
                      <td class="num">
                        <!-- 占比可否改 —— 🔴 v339 改了这条判据：旧版对「按报单量推导」**只读**，
                             而 L2 商品根本没有档案可写 ⇒ 用户**没有别的入口**，
                             「想按本月实际情况调整分法」这个需求完全无解。
                             现在可改：改动存成**本期专用**占比（不写档案、只影响本期）。
                             v657 勾选模式：**没勾上的行禁用**（先勾门店才能定比例）。 -->
                        <input class="cell-input alloc-mini" type="text" inputmode="decimal"
                               :readonly="!allocRatioEditable || (allocPickMode && !x.picked)"
                               :class="{ 'alloc-ro': !allocRatioEditable || (allocPickMode && !x.picked) }"
                               :title="(allocPickMode && !x.picked) ? '先勾选上，才能给这个门店定占比'
                                       : (!allocRatioEditable ? '本期没有可分摊对象'
                                       : (allocPickMode ? '本期专用占比：改动只影响本期，不会改商品目标档案'
                                       : (allocIsOverride ? '本期临时占比：改动只影响本期，不会改商品目标档案'
                                       : (allocIsDerived ? '原本按各门店本期报单量推导；改动会存成本期专用占比（只影响本期）'
                                       : '来自商品目标档案；改动会同时改写档案，影响本月所有期次'))))"
                               :value="allocRatiosRaw[allocKeyOf(x)] != null ? allocRatiosRaw[allocKeyOf(x)] : x.ratio"
                               @input="onAllocRatioInput($event, allocKeyOf(x))"
                               @change="onAllocRatioCommit($event, allocKeyOf(x))">
                      </td>
                      <!-- v659：名册态下标出「未报单」—— 用户要的正是把量分给这些人，
                           显示 0 容易让人以为"这家没份"，写清楚他才知道这是自己挑的 -->
                      <td class="num">
                        <span v-if="allocPickMode && !(Number(x.reported_box) > 0)" class="alloc-idle">未报单</span>
                        <template v-else>{{ fmt(x.reported_box) }}</template>
                      </td>
                      <td class="num">
                        <!-- ⚠️ @focus/@blur 记「正在打字的是哪一格」：预演回来时**不回填这一格**，
                             否则用户敲到一半的数字会被后端的四舍五入值顶掉（"填了不算"）。 -->
                        <input class="cell-input alloc-mini" type="text" inputmode="decimal"
                               :value="allocAllocsRaw[allocKeyOf(x)] != null ? allocAllocsRaw[allocKeyOf(x)] : fmt(x.alloc_box)"
                               @focus="allocFocusKey = allocKeyOf(x)" @blur="allocFocusKey = ''"
                               @input="onAllocAllocInput($event, allocKeyOf(x))"
                               @change="onAllocAllocCommit($event, allocKeyOf(x))">
                      </td>
                      <td class="num" :class="{ 'alloc-neg': Number(x.final_box) < 0 }">{{ fmt(x.final_box) }}</td>
                    </tr>
                    <tr v-if="!allocTableRows.length">
                      <td :colspan="allocPickMode ? 6 : 5" class="alloc-empty">{{ allocBusy || allocPrev ? '计算中…' : (allocErr || (allocPickMode ? '名册里没有可勾选的门店' : '没有可分摊的承接门店')) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="alloc-sum">
                <span :class="allocRatioOk ? 'ok' : 'bad'">占比合计 {{ fmt(allocRatioTotal) }}%{{ allocRatioOk ? ' ✓' : ' ✗ 必须 = 100%' }}</span>
                <span v-if="allocSummary" :class="allocSummary.fully_applied ? 'ok' : 'bad'">
                  加单合计 {{ fmt(allocSummary.allocated) }}{{ allocSummary.fully_applied ? ' ✓' : (' ✗ 差 ' + fmt(allocSummary.unassigned)) }}
                </span>
                <span v-if="allocSetup.target">目标总量 {{ fmt(allocSetup.target.target_qty) }} 箱</span>
                <span v-else>{{ allocPickMode ? '本月无目标（存本期专用占比）' : '本月无目标' }}</span>
              </div>
              <!-- 勾选模式下还没勾任何人时，「分不满」是废话（0 人分出 0 箱）⇒ 不显示 -->
              <p v-if="allocSummary && !allocSummary.fully_applied && !(allocPickMode && !allocPickedCount)" class="imp-tip warn-text">
                分不满：经理填 {{ fmt(allocSummary.total_delta) }} 箱，实际分出 {{ fmt(allocSummary.allocated) }} 箱，缺口 {{ fmt(allocSummary.unassigned) }} 箱
                —— 其中「占比合计不足 100%」占 {{ fmt(allocSummary.ratio_gap) }} 箱、
                「减单时有人报量不够被夹到 0」占 {{ fmt(allocSummary.clip_gap) }} 箱。
                前者改占比即可，后者是报量事实、改占比无用。
              </p>
              <p v-if="allocErr" class="imp-tip warn-text">{{ allocErr }}</p>
              <!-- v657：常驻保存提示 —— 用户原话「点击保存后未生效」的病灶之一就是
                   以为弹窗里点一下就落库了。这里是**预演台**：应用只存占比 + 回填
                   本行，真正落到各人名下必须点汇总表右上角「保存」。 -->
              <p v-if="allocPickMode" class="imp-tip alloc-note">
                ⓘ 这里是<b>预演台</b>：应用只把占比存成本期专用、并把加单量回填到本行；
                还要点汇总表<b>右上角「保存」</b>，加单量才会真正落到各人名下。
              </p>
            </template>
            <p v-else class="imp-tip">正在读取分摊依据…</p>
            <div class="alloc-actions">
              <!-- v659：**让没报单的门店也能分** —— 用户原话：「当前如果该产品有人报单，
                   点击分摊后只能分给有报单的这几个人，请把它做成没报单的人也可以选择去分摊」。
                   后端白名单本来就是「自然承接人 ∪ 报单对象名册」（`_base ∪ _pool_keys`），
                   所以这里只差一个入口：切到名册，把没报单的门店勾进来。 -->
              <button v-if="allocSetup && !allocPickMode && (allocSetup.candidates || []).length"
                      class="btn btn-sm btn-ghost"
                      title="打开报单门店名册，把本期没报单的门店也选来分摊（存本期专用占比，只影响本期）"
                      @click="enterPickMode">选择承接门店（含没报单的）</button>
              <!-- v659：只有「手动进入」才有返回；自动进入（一个人都分不到）退了没有意义 -->
              <button v-if="allocPickMode && !allocPickAuto"
                      class="btn btn-sm btn-ghost"
                      title="退出名册，回到系统自动按报单量/目标档案分摊（不改任何已存数据）"
                      @click="exitPickMode">返回自动分摊</button>
              <!-- v339：L2（无目标）也能分摊之后，「**有没有目标**」不再是能不能操作的前提 ——
                   旧版两处 `!no_target` 把 L2 商品的「平均分配 / 恢复」**整对按钮藏掉了**。
                   现在唯一的前提是"本期有没有可分摊对象"（= no_members）。
                   v657：勾选模式同样要有「平均分配」—— 它就是**一键全勾 + 均分**
                   （用户拍板：默认全不勾，要全勾点它）。 -->
              <button v-if="allocSetup && (!allocFlags.no_members || allocPickMode)"
                      class="btn btn-sm btn-ghost"
                      :title="allocPickMode ? '把占比平摊给已勾选的门店（一个都没勾时才会一键全勾）' : '把占比平均分给所有承接人'"
                      @click="allocSplitEven">平均分配</button>
              <!-- v658b：加 `!allocPickMode` —— 勾选模式下勾了人之后 preview 会把
                   `flags.no_members` 翻成假，这个按钮就会冒出来；可名册里的人**没有档案
                   比例可恢复**（`allocArchiveRatios` 为空）⇒ 点一下会把所有占比清成 0。 -->
              <button v-if="allocSetup && !allocFlags.no_members && !allocIsOverride && !allocPickMode"
                      class="btn btn-sm btn-ghost"
                      :title="allocIsDerived ? '恢复为按各人本期报单量自动算' : '恢复为商品目标档案里的比例'"
                      @click="allocResetRatios">{{ allocIsDerived ? '恢复自动比例' : '恢复档案原比例' }}</button>
              <!-- v339：**撤销本期覆盖**的专用入口。没有它，用户改错了只能手动把每个人敲回原值 ——
                   而且**永远回不到"没设过"的状态**（`basis` 会一直是 override，界面也就一直说"你改过"）。 -->
              <button v-if="allocSetup && allocIsOverride"
                      class="btn btn-sm btn-ghost"
                      title="清除本期临时占比，恢复为自动判据（不改商品目标档案）"
                      @click="allocClearOverride">清除本期临时占比</button>
              <span class="alloc-spacer"></span>
              <button class="btn btn-ghost" @click="closeAlloc">取消</button>
              <!-- v335 门禁：两条写路都归 data/update ——
                   写档案 = PUT /api/product-targets/{tid}；v339 本期临时占比 = PUT .../extra-alloc/override；
                   v657 勾选模式 = 同一条 override 路（名册里的人不在任何档案里，本期专用是唯一落点）。 -->
              <!-- v660：总量为 0 时按钮**照旧可点**（占比确实是用户设好的、值得存），
                   但文案与 title 必须改成「只保存占比」—— 继续写「并回填」就是
                   承诺一件做不到的事，用户点完看到加单格没变只会以为坏了。 -->
              <button class="btn btn-primary"
                      :disabled="allocBusy || allocPrev || !allocSetup || (!!allocFlags.no_members && !allocPickMode) || !allocRatioOk || !canDo('data', 'update')"
                      :title="!canDo('data', 'update') ? '当前角色没有分摊加单/减单的权限'
                              : (!allocRatioOk ? '占比合计必须等于 100% 才能保存'
                              : (allocTotalZero ? '本期总量还是 0 ⇒ 只能保存占比，不会有数量回填。先在「本期加单总量」里填数量'
                              : '保存本期占比，并把加单量回填到本行'))"
                      @click="applyAlloc">{{ allocBusy ? '应用中…'
                        : (allocTotalZero
                          ? '只保存占比（未填数量）'
                          : ((allocIsOverride || allocIsDerived || allocPickMode) ? '保存本期占比并回填' : '应用到汇总表')) }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
</template>

<style scoped>
.alloc-modal{width:min(720px,95vw)}
.alloc-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 8px}
.alloc-top label{font-size:13px;font-weight:600;color:var(--t1)}
.alloc-num{width:96px;text-align:right}
.alloc-unit{font-size:12px;color:var(--t3)}
.alloc-conv{font-size:12px;color:var(--t3)}
.alloc-note{background:var(--warn-amber-bg);border-radius:6px;padding:6px 8px;color:var(--warn-amber)}
.alloc-tbl-wrap{max-height:290px;overflow:auto;border:1px solid var(--bd);border-radius:4px;background:var(--bg)}
.alloc-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.alloc-tbl th{position:sticky;top:0;z-index:1;background:var(--bg3);color:var(--t2);font-weight:600;text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);white-space:nowrap}
.alloc-tbl td{padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--t1)}
.alloc-tbl .num{text-align:right}
.alloc-mini{width:74px;text-align:right;padding:2px 5px;font-size:12.5px}
/* v657：勾选列（勾选模式才渲染）+ 别名后缀（同一员工多个报单门店时，如「东津/吾悦」） */
.alloc-tbl .chk{width:34px;text-align:center}
.alloc-tbl td.chk{text-align:center}
.alloc-alias{color:var(--t3);font-size:11.5px;margin-left:2px}
/* v659：名册态里的「未报单」标记（弱化，不抢数字的视线） */
.alloc-idle{color:var(--t3);font-size:11.5px}
/* v336：占比「只读」态 —— 来源是本期报单量推导（客观事实），不是可配置的档案比例。
   视觉上必须一眼看出"这格改不了"，否则用户会反复点进去以为输入框坏了。 */
.alloc-mini.alloc-ro{background:var(--bg2);color:var(--t2);cursor:not-allowed;border-style:dashed}
.alloc-empty{text-align:center;color:var(--t3);padding:14px 0}
.alloc-neg{color:var(--danger-txt);font-weight:600}
.alloc-sum{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 0;font-size:12px;color:var(--t2)}
.alloc-sum .ok{color:var(--p-dark);font-weight:600}
.alloc-sum .bad{color:var(--danger-txt);font-weight:600}
.alloc-actions{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)}
.alloc-spacer{flex:1}
</style>