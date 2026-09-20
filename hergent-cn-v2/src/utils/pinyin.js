/* 拼音首字母 —— **零依赖、零码表**实现（v215）。
 *
 * 🔴 为什么不用码表 / 不装 pinyin-pro：
 *    商品档案**没有拼音字段**（后端也没生成），而给 428 条商品加一个拼音列要改后端 +
 *    回填存量。这里要的只是「首字母」这一件事，不值得为此上一个 100KB 的依赖或一张
 *    6763 字的码表（码表我**无法凭空保证逐字准确**，写错了就是静默搜不到 —— 比不做更糟）。
 *
 * 🔴 原理：Chrome/Safari 的 `Intl.Collator('zh-Hans-CN')` 对汉字**按拼音排序**（ICU 数据）。
 *    于是给每个拼音首字母取一个「首音节代表字」当锚点，二分找出「最后一个 ≤ 该字」的锚点，
 *    那个锚点的字母就是该字的首字母。
 *    ⚠️ 锚点必须取**同音组里码点尽量小**的字：同音字在 ICU 里按码点/笔画排，
 *       若锚点取大了（如用「昔」而不是「夕」），比它小的同音字（「希」）会掉到**前一个**字母。
 *       —— 这个坑实测踩过一次（「希」被判成 W）。
 *
 * 🔴 静默失效防护（本文件最重要的一条）：
 *    若某浏览器/环境的 ICU **不带中文排序数据**，`localeCompare` 会退化成码点序 ⇒
 *    首字母会**稳定但错误**。用户看到的是「打 mnh 搜不到蒙牛」，且**没有任何提示** ——
 *    正是本项目要消灭的那一类缺陷。故 `PY_OK` 在初始化时用 4 个已知字自检：
 *       **不通过就整个禁用拼音检索**（`pyInitials` 返回 ''），宁可少一个功能，也不给错答案。
 */
const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ'      // 拼音首字母里没有 I / U / V
const ANCHORS = ['啊', '八', '嚓', '搭', '蛾', '发', '噶', '哈', '击', '喀',
                 '垃', '妈', '拿', '哦', '啪', '期', '然', '撒', '塌', '挖',
                 '夕', '压', '匝']
const KANJI = /[\u4e00-\u9fa5]/

let CMP = null
try {
  CMP = new Intl.Collator('zh-Hans-CN').compare
} catch (_) {
  CMP = null
}

/** 自检：这 4 个字覆盖 A/M/N/X 四个字母段，任一不对即判环境不支持。 */
const SELFTEST = [['蒙', 'M'], ['牛', 'N'], ['安', 'A'], ['希', 'X']]

export let PY_OK = false

function initial(ch) {
  if (!CMP || !KANJI.test(ch)) return null
  let lo = 0, hi = ANCHORS.length - 1, ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (CMP(ANCHORS[mid], ch) <= 0) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return LETTERS[ans]
}

function selftest() {
  if (!CMP) return false
  // 锚点自身必须严格递增 —— 这是「排序是拼音序」的前提，比逐字验证更早暴露问题
  if (!ANCHORS.every((a, i) => i === 0 || CMP(ANCHORS[i - 1], a) < 0)) return false
  return SELFTEST.every(([ch, want]) => initial(ch) === want)
}

PY_OK = selftest()

/** 取「拼音首字母串」：汉字 → 首字母；英文字母/数字原样（如「优益C」→ YYC）。
 *  ⚠️ 环境不支持时返回**空串**（不是乱码）—— 调用方据此自动退回「只按名称/条码匹配」。 */
export function pyInitials(s) {
  if (!PY_OK || !s) return ''
  let out = ''
  for (const ch of String(s)) {
    const i = initial(ch)
    if (i) out += i
    else if (/[a-zA-Z0-9]/.test(ch)) out += ch.toUpperCase()
  }
  return out
}

/** 给一批商品预计算首字母串并**挂回对象**（`_py`）。428 条一次性算完，别在输入时逐字算。 */
export function attachPy(list) {
  if (!PY_OK) return list
  for (const p of list || []) p._py = pyInitials(p.name || '')
  return list
}
