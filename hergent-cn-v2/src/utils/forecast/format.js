export function statFmt(key, n) { return key === 'boxes' ? fmtBox(n) : fmt(n) }

export const HALF_MAP = {
  '。': '.',   // U+3002 表意句号 —— NFKC 不转，本表的核心理由
  '、': ',',   // U+3001 顿号     —— 数字格内只可能是千分位
  '—': '-',    // U+2014 em dash  —— 负号手误
  '–': '-',    // U+2013 en dash
  '\u2212': '-',  // U+2212 数学减号 —— 从公式/某些输入法复制的「负号」常是它，不是 ASCII 的 -
  '．': '.',   // U+FF0E 全角句点（NFKC 已覆盖，显式列出以便与后端逐字比对）
  '，': ',',   // U+FF0C 全角逗号（同上）
  '－': '-',   // U+FF0D 全角连字符（同上）
  '＋': '+',   // U+FF0B 全角加号（同上）
  // 　(U+3000) 表意空格**刻意不在这张表里**：NFKC 会先把它折成**普通空格**，
  //    所以「先 NFKC、再查表」的实现永远匹配不到它（写进来 = 死条目）。
  //    真正兜住它的是 `toHalfNum` 末尾的 `.trim()`（与后端 `.strip()` 同源）。
}

/* 全角 → 半角 + 去千分位逗号。**与后端 `normalize_num_text` 逐字同源**。
   ⚠️ 去逗号刻意放在这里、而不是只放在提交时：`rowSum` 用 `parseInt`，model 里若留着
      `"1,200"`，合计会**当场算成 1**（用户看见数字跳一下再跳回来）。逐字输入时逗号被吃掉
      也符合预期 —— 千分位本来就是给人看的，不是数据的一部分。 */
export function toHalfNum(s) {
  let t = String(s == null ? '' : s).normalize('NFKC')
  for (const k in HALF_MAP) if (t.indexOf(k) >= 0) t = t.split(k).join(HALF_MAP[k])
  return t.replace(/,/g, '').trim()
}

/* v597（B1）：**数字清洗** —— 把「人写着方便、机器读不懂」的写法收敛成纯数字。
   🔴 为什么需要它：经销商的数字大多不是手敲的，是从微信、Excel、厂家系统里**复制**来的，
      常见 `1,200`（千分位已由 toHalfNum 处理）、`¥99`、`66箱`、`99 元`。
      这些串 `Number()` 全是 NaN ⇒ 旧实现保留原串 ⇒ 标红「必须是数字」。
      用户看着明明是个数字，却被拒收，第一反应是「这软件坏了」。
   🔴 为什么**不**直接放宽 `toHalfNum`：它和后端 `normalize_num_text` 是**逐字同源**的一对
      （护栏 `v214-halfnum-parity.py` 逐样例比对）。在归一器里加"猜单位"的语义，
      等于让前后端对同一串给出不同结果。清洗只属于**前端录入这一层**，不碰归一器。
   ⚠️ 只认「整个串 = [货币符号?] 数字 [单位?]」这一种形态，去掉前后缀后**必须**是纯数字，
      否则原样返回（该标红的继续标红）。所以：
        `66箱` → 66      `¥1,200` → 1200     `12.5箱` → 12.5
        `12箱24瓶` → 原样（两个数量，无法判定）   `约12箱` → 原样（有前缀修饰）
        `1.5` → 1.5（绝不动小数）               `10-2` → 原样
   ⚠️ 不做 `O→0` / `l→1` 这类歧义映射 —— 把打错的字静默改成合法数字，比报错贵得多。 */
const NUM_UNIT_TAIL = '件|箱|包|瓶|提|个|盒|组|袋|支|罐|桶|听|杯|元|块|角|公斤|千克|kg|g|克'
const NUM_PLAIN_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)$/
/* 空格千分位：**只认「1~3 位 + 若干组 3 位」**。`1 200` → 1200；
   `12 34` 不匹配（34 不是 3 位）⇒ 仍然判非法。放宽到「去掉所有空格」会把
   用户粘的「12 34」静默拼成 1234 —— 那才是真正危险的猜测。
   ⚠️ 不用 `\u00a0` 等窄空格字符：`toHalfNum` 里的 `normalize('NFKC')` 已经把它们折成普通空格，
      在 NFKC 之后再匹配原码位永远匹配不到（死分支）。 */
const NUM_SPACE_GROUP_RE = /^([+-]?\d{1,3})((?:\s\d{3})+)(\.\d+)?$/
export function cleanNumText(v) {
  const s = toHalfNum(v)
  if (s === '') return ''
  let t = s.replace(/^(?:rmb|cny)\s*/i, '').replace(/^[¥$]\s*/, '')
  t = t.replace(new RegExp('\\s*(?:' + NUM_UNIT_TAIL + ')\\s*$', 'i'), '')
  t = t.trim()
  const m = t.match(NUM_SPACE_GROUP_RE)
  if (m && !NUM_PLAIN_RE.test(t)) t = (m[1] + m[2].replace(/\s+/g, '') + (m[3] || ''))
  return NUM_PLAIN_RE.test(t) ? t : s
}

/* Q18：数值解析不再静默归 0。原实现 `parseFloat(v) || 0` 会把「12箱」「1,234」「abc」
   全部变成 0，用户以为粘上了实际是 0 → 漏订货。现改为：
   - 支持千分位逗号（1,234 → 1234）
   - 解析失败时保留原始字符串 → cellErrMsg 报「必须是数字」并标红，保存时拦截
   - 空串仍按 0 处理（=未填） */
export function parseNumInput(v) {
  /* v214 A：补 `toHalfNum` —— 与后端 `normalize_num_text` 同源。
     🔴 原实现只去逗号、不折全角：粘贴（`writeCellVal` 走这里）进来的 `"１２"` 因
        `Number("１２")` = NaN 而被**保留为字符串** `"１２"` 存进 model，随后 `rowSum` 的
        `parseInt("１２")` = NaN ⇒ 按 0 累加 ⇒ **合计静默算少**，且屏幕上一切看起来正常。
     ⚠️ 解析失败时返回**归一后**的原串（而不是用户原始字节）：这样 model 里不残留全角字符，
        标红与保存拦截仍照常生效（`"12箱"` 归一后还是 `"12箱"`）。
     v597（B1）：入口换成 `cleanNumText` —— 它**内部先调 toHalfNum**，
       所以上面这条「model 不残留全角」的保证不变；额外只多做了「去货币符号 / 去单位尾缀」。
       解析不了时同样返回归一后原串（`cleanNumText` 的 else 分支就是 `s`）。 */
  const s = cleanNumText(v)
  if (s === '') return 0
  const n = Number(s)
  return Number.isNaN(n) ? s : n
}

/* v207：`maximumFractionDigits` 由 0 改 2 —— 原来是**显示层的二次抹零**，计算层改对了也没用。
   两类量都受益：
     ① 金额：最终下单(箱) × 单价(元/箱) 本来就带分（如 3 箱 × ¥97.36 = ¥292.08），
        旧设置显示成 ¥292 ⇒ 表尾金额与逐行相加对不上（差几角几分）。现在按分显示。
     ② 数量/库存/起订量这类整数：`maximumFractionDigits` 只是**上限**、`minimumFractionDigits`
        仍是 0 ⇒ 整数照旧显示成整数，不会冒出「12.00」。
   ⚠️ 箱数不走这里 —— 它要 3 位小数，见 fmtBox（24 瓶/箱报 3 瓶 = 0.125，2 位会变 0.13）。 */
export function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
/* v207：**箱数专用**格式（最多 3 位小数）。
   与 fmt 分开的原因：元只到分（2 位）、箱要 3 位，一个函数兜不住两种精度。 */
export function fmtBox(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}
