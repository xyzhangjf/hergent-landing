#!/usr/bin/env node
/* v212 离线护栏 —— 单元格输入体验第二批
   ① 数量格「上期值 / 常用值」候选（P2-1）
   ② 软警告分级（疑漏订 / 疑超放量）（P2-2）
   ③ 选区批量填同值的可见入口（P2-3，功能早就有、只缺入口）

   设计纪律（沿用 v210/v211）：
   1. 每条断言都要能因「改坏源码」而变红 —— 否则它是恒真断言，比没有守卫更危险
      （用 v212-guard-falsify.mjs 反证）。
   2. 断言要打**判据**，不是打「有没有这个词」。例如 B2 不只要「有 datalist」，
      还要它**全表只有一个** —— 每格一个 = 3300 个 datalist，是本轮最大的性能地雷。
   3. 不做静默跳过：前置不成立就直接红。
   用法：node v212-input-ux-verify.mjs [Forecast.vue 路径] */
import fs from 'node:fs'

const SRC = process.argv[2] || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const src = fs.readFileSync(SRC, 'utf8')

let pass = 0, fail = 0
const lines = []
function ok(name, cond, ev) {
  if (cond) { pass++; lines.push('  ✅ ' + name + (ev ? '   ' + ev : '')) }
  else { fail++; lines.push('  ❌ ' + name + (ev ? '   ' + ev : '')) }
}
const count = (re) => { const m = src.match(re); return m ? m.length : 0 }
const has = (s) => src.indexOf(s) >= 0
const grab = (re) => { const m = src.match(re); return m ? m[0] : '' }
/* ⚠️ 按**行**定位，不用「截到第一个 >」的正则：模板属性里合法出现 `>`（Vue 表达式
   `Number(x) > 0` 之类），那种正则会假红（v211 实测踩到）。 */
const lineOf = (needle) => (src.split('\n').find((l) => l.indexOf(needle) >= 0) || '')
const idxOf = (needle) => src.indexOf(needle)

/* ===== 0. 先确认三个新块的函数体真的在（后面的断言都建立在它们之上） ===== */
const prevFn = grab(/async function loadPrevUnits\(\)[\s\S]*?\n\}/)
const qtyOptFn = grab(/function buildQtyCellOptions\(ri, ui\)[\s\S]*?\n\}/)
const softComputed = grab(/const softAt = computed\(\(\) => \{[\s\S]*?\n\}\)/)
ok('0-1 loadPrevUnits 存在且非空', prevFn.length > 400, '函数体 ' + prevFn.length + ' 字符')
ok('0-2 buildQtyCellOptions 存在且非空', qtyOptFn.length > 500, '函数体 ' + qtyOptFn.length + ' 字符')
ok('0-3 softAt 是 computed（不是普通函数）', softComputed.length > 500, '函数体 ' + softComputed.length + ' 字符')

/* ================= A. 上期「按客户」数量：P2-1 与 P2-2 的共用数据源 ================= */
lines.push('A. 上期「按客户」数量 —— 一个数据源喂两个功能')

/* 🔴 A1 是本批最容易做错的一处：现成的 prevMap（「上期量」列）是**按商品汇总**的，
   拿它去比**单格**数量 = 用「10 个客户合计」比「1 个客户」⇒ 全表误报漏订。
   判据：建索引的键必须是 sources 里的客户名，不能是 r.name。 */
ok('A1 逐格索引按「客户名」建（不是按商品名汇总）',
  /s\.store \|\| s\.store_name/.test(prevFn), /s\.store \|\| s\.store_name/.test(prevFn) ? '用 sources[].store' : '未见客户名取用')
ok('A2 同商品多来源累加（不是后写覆盖前写）',
  /bucket\[name\] = \(bucket\[name\] \|\| 0\) \+ \(parseInt\(s\.qty\) \|\| 0\)/.test(prevFn),
  /bucket\[name\] =/.test(prevFn) ? '累加式' : '未找到累加')
ok('A3 索引键是 product_id（与编辑网格行主键同源）',
  /m\[pid\] \|\| \(m\[pid\] = \{\}\)/.test(prevFn))

/* 🔴 A4：进编辑网格不该为参考数据多等一次往返 ⇒ 调用必须是「发射后不管」，
   但**必须带 .catch**（未接住的 rejection 会在输出落盘前带走进程 —— v210 踩过）。 */
const callLine = lineOf('loadPrevUnits().catch(')
ok('A4 调用处不 await 且带 catch（不阻塞渲染、不吞未处理拒绝）', callLine.length > 0, callLine.trim().slice(0, 70))
ok('A5 调用点在 loadEditGrid 内（不是只定义不调用）',
  idxOf('loadPrevUnits().catch(') > idxOf('async function loadEditGrid()') &&
  idxOf('loadPrevUnits().catch(') < idxOf('async function loadCross()'))

/* 🔴 A6：缓存必须**随期次清**。留着跨期次的旧数会让候选与软警告拿别的期次的数去比，
   而用户看到的是一张"有提示"的表 —— 比不提示更糟。 */
ok('A6 每次进编辑网格先清上期缓存（防跨期次串数）',
  /prevUnitsLoaded\.value = false/.test(src) && /prevUnitMap\.value = \{\}/.test(src),
  'prevUnitsLoaded 重置 = ' + count(/prevUnitsLoaded\.value = false/g) + ' 处')
/* 增益信息不得把失败变成噪音：loadPrevUnits 的 catch 里不能出现 toast。 */
const prevCatch = grab(/async function loadPrevUnits\(\)[\s\S]*?\n\}/)
ok('A7 取数失败静默降级（catch 里没有 toast）', prevCatch.indexOf('toast(') < 0)
ok('A8 refreshQty 访问器判空（product_id=0 的自建行不得炸）',
  /const b = prevUnitMap\.value\[Number\(r && r\.product_id\) \|\| 0\]/.test(src))

/* ================= B. 数量格候选（P2-1） ================= */
lines.push('B. 数量格候选 —— 上期同格值 / 本期其它客户常用值')

const qtyLine = lineOf('v-model.number="r.qtyByUnit[u.name]"')
ok('B1 数量格 input 绑定了候选列表', /:list="qtyListFor\(ri, ui\)"/.test(qtyLine), qtyLine.trim().slice(-80))

/* 🔴 B2 是本批最大的性能地雷：数量格 = 行数 × 客户列数（生产 158×21 ≈ 3300）。
   每格一份 datalist / option ⇒ 点击展开直接卡死标签页（v211 商品名补全那条注释实测过）。
   判据是「全表**恰好一个** #opt-qty」，不是「有一个 #opt-qty」。 */
const qtyDlCount = count(/id="opt-qty"/g)
ok('B2 候选 datalist 全表只有 1 个（防 3300 个节点爆炸）', qtyDlCount === 1, '#opt-qty 出现 ' + qtyDlCount + ' 次（期望 1）')
const qtyDl = grab(/<datalist v-if="editMode && qtyOptKey" id="opt-qty"[\s\S]*?<\/datalist>/)
/* 🔴 B3：换格必须**销毁重建**这个元素（:key）。只改 <option> 内容而不换节点，
   `input.list` 的惰性解析可能沿用旧候选 ⇒ 用户看到上一格的数。 */
ok('B3 datalist 带 :key 强制重建（换格时不留旧候选）', /:key="qtyOptKey"/.test(qtyDl), qtyDl.slice(0, 60))
/* B4：datalist 不得塞进 <td> —— 塞进去会让「每行渲染一份」这种问题在结构上难判。 */
ok('B4 datalist 放在表格结构之外（片段里没有 <td）', qtyDl.length > 0 && qtyDl.indexOf('<td') < 0)
ok('B5 候选只在编辑态渲染', /v-if="editMode && qtyOptKey"/.test(qtyDl))
/* 🔴 B6：只有**聚焦的那一格**才带 list ⇒ 否则多格共享一个内容会变的 datalist，互相看到对方的候选。 */
ok('B6 只有聚焦格才带 list 指向它（按 key 比对）',
  /return \(editMode\.value && qtyOptKey\.value === \(ri \+ '-' \+ ui\)\) \? 'opt-qty' : null/.test(src))
/* 🔴 B7：候选必须在 **@focus** 上同步，不能挂在 mousedown —— 键盘跳格（方向键/Tab/Enter）
   只走 focus、不走 mousedown ⇒ 挂错地方会让「键盘跳过去的格没有候选」，两种进格方式行为不一致。 */
const focusFn = grab(/function onFocusCell\(r, c, e\) \{[\s\S]*?\n\}/)
ok('B7 候选同步挂在 onFocusCell（键盘跳格也有候选）', /syncQtyCellOptions\(r, c\)/.test(focusFn), 'onFocusCell 体 ' + focusFn.length + ' 字符')
ok('B8 非数量格会清空候选 key（不留看不见的残壳）',
  /qtyOptKey\.value = ''; qtyCellOptions\.value = \[\]/.test(src))
ok('B9 候选含「上期同格」来源', /l: '上期 ' \+ fmt\(pv\)/.test(qtyOptFn))
ok('B10 候选含「本期其它客户」来源且排除 0', /本期其它客户填/.test(qtyOptFn) && /if \(q > 0\) tally\[q\]/.test(qtyOptFn))
ok('B11 候选按出现次数降序、最多 3 条（防下拉变成一堵墙）',
  /\.slice\(0, 3\)/.test(qtyOptFn) && /tally\[b\] - tally\[a\]/.test(qtyOptFn))

/* ================= C. 软警告分级（P2-2） ================= */
lines.push('C. 软警告分级 —— 「黄 = 疑」（红框管"一定错"，这里管"可能错"）')

/* 🔴 C1：必须一次成图，不能逐格现算。判据里要读「本行本期合计」（rowSum 本身 O(客户数)），
   现算就是 9k 格 × 21 ≈ 19 万次运算 × **每次按键**（与既有的 dupBarcodeAt 同一条理由）。 */
ok('C1 判据一次成图为 Map（模板侧只剩 O(1) 查询）',
  /const m = new Map\(\)[\s\S]{0,80}\/\/ `\$\{ri\}-\$\{ui\}`/.test(softComputed) || /m\.set\(ri \+ '-' \+ ui/.test(softComputed))
ok('C2 模板访问器只做 Map 查询', /function cellSoftIssue\(ri, ui\) \{ return softAt\.value\.get\(ri \+ '-' \+ ui\) \|\| '' \}/.test(src))
/* 🔴 C3：漏订必须带「本行本期已有别的客户填过值」这个前提。否则一进编辑网格（全表 0）
   每一格上期有值的都亮黄 ⇒ 满屏黄、没人看。同时它也是整行的**快路径开关**（零成本）。 */
ok('C3 漏订判据带行前提（防一进编辑态满屏黄）',
  /if \(rowTotal <= 0\) continue/.test(softComputed) && /rowTotal \+= parseInt\(r\.qtyByUnit\[units\[ui\]\.name\]\) \|\| 0/.test(softComputed))
ok('C4 两档都在：over=疑超放量 / miss=疑漏订',
  /m\.set\(ri \+ '-' \+ ui, 'over'\)/.test(softComputed) && /m\.set\(ri \+ '-' \+ ui, 'miss'\)/.test(softComputed))
ok('C5 两档互斥（先判 over 再 else if miss，不会一格两标）',
  /if \(softWarnCfg\.overOn && cur > 0 && cur >= pv \* ratio\)[\s\S]{0,120}else if \(softWarnCfg\.missOn && cur === 0\)/.test(softComputed))
/* 🔴 C6：阈值不能写死在判据里 —— 经销商口味不同（3 倍就慌 vs 10 倍才算异常）。 */
ok('C6 倍数阈值走 softWarnCfg（不写死）', /softRatio\(\)/.test(softComputed) && /Number\(softWarnCfg\.overRatio\)/.test(src))
ok('C7 阈值落 localStorage 且带回读（关了浏览器还在）',
  /hergent_forecast_softwarn_v1/.test(src) && /JSON\.parse\(localStorage\.getItem\(SOFTWARN_KEY\(\)\)/.test(src))
ok('C8 两档各有开关（可单独关掉一类）',
  /softWarnCfg\.missOn/.test(src) && /softWarnCfg\.overOn/.test(src) && /function toggleSoftWarn\(which\)/.test(src))

/* C9-C12：角标的可见性与几何。数量格 = 仅一处（主档数字列不判软警告 —— 拿上期数量比安全库存没有业务含义）。 */
const softDotCount = count(/class="cell-soft-dot"/g)
ok('C9 软角标只在数量格渲染一处', softDotCount === 1, 'cell-soft-dot = ' + softDotCount + ' 处（期望 1）')
/* 🔴 C10：软角标必须落在**数量格那个 td 内**（数量 input 之后、该格填充柄之前），
   且索引用的是 `ui`（单元/客户下标）而不是 `ci`（主档列下标）。
   两个下标空间不通用：softAt 的键是 `ri-ui`，若误写 `ci` 会取到别的列甚至取不到
   ——「角标标在错误的格子上」比不标更误导。
   ⚠️ 判据不能用「行里有没有 visibleCols.length + ui」：那一行本来就只写 `ui`，
      照抄 td 的写法反而是错的（本断言第一版就写成那样，实测假红）。 */
const iQtyInput = idxOf('v-model.number="r.qtyByUnit[u.name]"')
const iSoftDot = idxOf('class="cell-soft-dot"')
const iQtyFill = idxOf('v-if="selected.r === ri && selected.c === visibleCols.length + ui" class="fill-handle"')
ok('C10 软角标落在数量格 td 内且用单元下标 ui',
  iQtyInput > 0 && iSoftDot > iQtyInput && (iQtyFill < 0 || iSoftDot < iQtyFill) && /cellSoftIssue\(ri, ui\)/.test(lineOf('class="cell-soft-dot"')),
  'qtyInput@' + iQtyInput + ' < softDot@' + iSoftDot + ' < qtyFill@' + iQtyFill)
const softDotLine = lineOf('class="cell-soft-dot"')
/* 🔴 C11：mousedown 与 click 必须**都**拦（同 v211 的 C2）：少 mousedown ⇒ 按下角标先被 td
   的 onCellDown 接走，点一下"看疑点"顺手把选区也改了。触屏没有悬停 ⇒ 点击是唯一入口。 */
ok('C11 软角标同时拦住 mousedown 与 click（触屏唯一入口）',
  /@mousedown\.stop\.prevent @click\.stop="showCellSoft\(/.test(softDotLine))
ok('C12 软角标有 title（桌面悬停也能看）', /:title="cellSoftMsg\(ri, ui\)"/.test(softDotLine))

const softCss = grab(/\.cell-soft-dot\{[^}]*\}/)
/* 🔴 C13：z-index 必须 < 6（.seq-cell / .frozen 粘性列都是 6），否则横向滚动时
   角标会浮在冻结列**上方**，像贴错了格子（v210 刚踩过粘性遮挡）。 */
ok('C13 软角标层级低于粘性列', /z-index:\s*[1-5]\b/.test(softCss), (softCss.match(/z-index:\s*\d+/) || ['无 z-index'])[0])
/* 🔴 C14：四角分配不许打架 —— 红角标左上、填充柄右下、软角标必须选**右上**。 */
ok('C14 软角标取右上角（左上=红角标 / 右下=填充柄）', /right:0;top:0/.test(softCss), softCss.slice(0, 46) + '…')
/* 🔴 C15：实心档的文字色必须跟主题（var(--bg)）。写死 #fff 在深色主题下是
   「浅琥珀底 + 白字」⇒ 对比度 < 2:1，几乎看不见。 */
const missCss = grab(/\.cell-soft-dot\.soft-miss\{[^}]*\}/)
ok('C15 实心档文字色跟随主题（不写死 #fff）',
  /color:var\(--bg\)/.test(missCss) && missCss.indexOf('#fff') < 0, missCss)
ok('C16 两档 class 样式都在', grab(/\.cell-soft-dot\.soft-over\{[^}]*\}/).length > 0)
ok('C17 图标尺寸被压住（格子仅约 26px 高）', /\.cell-soft-dot svg\.ico\{[^}]*width:9px/.test(src))
ok('C18 点击给出可读原因', /function showCellSoft\(ri, ui\) \{ const m = cellSoftMsg\(ri, ui\); if \(m\) toast\(m, 'warn'\) \}/.test(src))

/* ================= D. 选区批量填同值入口（P2-3） ================= */
lines.push('D. 选区批量填同值 —— 功能早在，缺的是「看得见」')

ok('D1 右键菜单有入口', /@click="openCtxFill"/.test(src) && /批量填入相同值/.test(src))
ok('D2 入口只在有选区时出现（无选区时给按钮 = 点了没反应）',
  /v-else-if="ctxHasRangeSel" @click="openCtxFill"/.test(src))
ok('D3 选区统计条也有可见入口（刚框完一片时眼睛落着的地方）',
  /class="sel-fill"/.test(src) && /@click="applySelFill"/.test(src))
/* 🔴 D4：必须复用 batchWrite（Ctrl+Enter 的写入口，已被生产验证：只读列跳过 / 数值净化 /
   快照入栈 / 提示文案）。另写一份循环 = 「同一条规则两处实现」的经典开局。 */
const fillFn = grab(/function fillSelectionWith\(raw\) \{[\s\S]*?\n\}/)
const batchFn = grab(/function batchWrite\(val\) \{[\s\S]*?\n\}/)
const clearFn = grab(/function clearRange\(\) \{[\s\S]*?\n\}/)
ok('D4 复用 batchWrite（不另写一份写循环）', /batchWrite\(parseNumInput\(s\)\)/.test(fillFn), 'fillSelectionWith 体 ' + fillFn.length + ' 字符')
ok('D5 两个入口共用同一个写函数', /function applyCtxBatchFill\(\)/.test(src) && /function applySelFill\(\) \{ fillSelectionWith\(ctxFillVal\.value\) \}/.test(src))
/* 🔴 D6：空值必须拒。留空点「填入」若被当成"清空选区"，用户会在毫不知情下删掉一整片
   （清空有它自己的入口 Delete / 「清空选区」，两者语义必须分开）。 */
ok('D6 空值被拒且指明清空该走哪个入口',
  /if \(s === ''\) \{ toast\('请输入要填入的值（清空选区请用 Delete 或「清空选区」）', 'warn'\); return \}/.test(src))
/* 🔴 D7：菜单是复用的，残留上次输入会让第二次打开时输入框里躺着旧数字，
   用户以为"它默认就是这个值"。 */
ok('D7 closeCtx 清掉填入值（防残留被误当默认值）',
  /function closeCtx\(\) \{ ctxMode\.value = 'menu'; ctxFillVal\.value = ''; ctx\.value\.show = false \}/.test(src))
ok('D8 填入输入框带 inputmode（触屏弹数字键盘，同数量格的理由）',
  /v-model="ctxFillVal" class="ctx-ipt ctx-ipt-fill" type="number" inputmode="numeric"/.test(src) &&
  /v-model="ctxFillVal" class="sel-fill-ipt" type="number" inputmode="numeric"/.test(src))
ok('D9 无选区时给明确提示（不是静默无反应）', /请先框选要填充的区域，再执行批量填入/.test(src))

/* 🔴 D10 / D11 / D12 —— v212 真机首跑抓到的**真缺陷**，这三条是它的锁。
   现象：框选一片**空格子**（"每种货都订 10 箱"的标准打法）时，整条选区统计条不渲染
   ⇒ 刚做的「批量填入」入口在**最需要它的那一步消失**，且不报错、不出提示（静默缺入口）。
   根因：判据 `v-if="selStats"`，而 `selStats` 在选区里没有数字时 return null。 */
ok('D10 统计条判据建在「选区面积」上、不建在「有几个数字」上（防空选区整条消失）',
  /<div v-if="selRange" class="sel-stat">/.test(src) && !/v-if="selStats" class="sel-stat"/.test(src))
ok('D11 🔴 格数恒显示、求和/平均只在「真的有意义」时才显示（`sum!==0`）',
  src.includes('<span>共 <b>{{ selCellCount }}</b> 格</span>')
  && src.includes('<template v-if="selStats && selStats.sum !== 0">')
  && src.indexOf('求和 <b>{{ fmt(selStats.sum) }}</b>') >= 0,
  '恒显示格数；求和包在 sum!==0 内 —— 初值大量是 0 ⇒ 否则恒显示「求和 0」，既噪音又会被读成"有数据"')
/* 格数（占位符 / 菜单里的「N 格」/ 回退文案）必须**同一个来源** ——
   三处各写一遍 `(r1-r0+1)*(c1-c0+1)` 就是"同一条规则三处实现"的老病。 */
ok('D12 选区格数单源（selCellCount），不再在多处重算',
  /const selCellCount = computed\(/.test(src) &&
  /* 全文件只允许出现**一处**「(r1-r0+1)*(c1-c0+1)」的面积算术（在 computed 里）；
     多出来一处就说明模板/菜单里又在各算一遍 —— 那正是「同一条规则多处实现」的老病。 */
  count(/\(\w+\.r1 - \w+\.r0 \+ 1\) \* \(\w+\.c1 - \w+\.c0 \+ 1\)/g) === 1 &&
  count(/selCellCount/g) >= 3 &&
  /:placeholder="selCellCount \+ ' 格'"/.test(src) && /\{\{ selCellCount \}\} 格/.test(src))
/* 🔴 D13：统计条必须是**固定浮层**。表格自己是一个 max-height:72vh 的滚动盒、
   整页又在 main.content 里滚（页面比可视区高 ~574px）⇒ 1600×950 视口里它落在 y≈1200（屏幕外）。
   也就是说：用户刚框完一片格、正想批量填，而入口在屏幕外，得先往下滚。
   而这条统计条存在的全部意义就是"框完之后一眼看见"（真机 S4-2 / S4-21 抓到）。
   ⚠️ 曾经用 `sticky;bottom:0`（真机实测**无效**）：它是 .grid-area 的最后一个子元素，
      包含块底边就在它下面 ⇒ 吸不动。所以判据必须是 fixed，**不是** sticky。 */
const selStatCss = (src.match(/\.sel-stat\{[^}]*\}/) || ['未找到'])[0];
ok('D13 🔴 统计条是固定浮层（sticky 在这里吸不动 —— 包含块底边就在它下面，真机实测过）',
  /position:fixed/.test(selStatCss) && /bottom:0/.test(selStatCss),
  selStatCss.slice(0, 100) + '…')
ok('D14 浮层让开左侧栏（用 --sidebar-w，侧栏可拖拽调宽 ⇒ 自动跟随）',
  /left:var\(--sidebar-w/.test(selStatCss))
/* 🔴 D14：同一菜单里有两个 `ctx-ipt`（填入值 / 超放量倍数阈值）⇒ 必须能在 DOM 层分辨，
   否则「Esc 退回菜单了吗」这类断言会被阈值输入框误命中（真机 S4-18 一度假绿）。 */
/* 🔴 D16：批量填入与清空选区必须**同口径报数**（都按实际写入成功的格数）。
   面积口径 (r1-r0+1)*(c1-c0+1) 会跳过只读列这件事视而不见 ⇒ 真机实测：
   12 格的选区里只有 4 格是数量格，提示却报「已批量写入 12 个单元格」，用户会以为漏填了。
   ⚠️ 这个坑 **v184 已经在「清空」上修过**，批量填入当时漏了 ——
      典型的"同一条规则两处实现、只修一处"。所以这条断言要**同时**守两处。 */
ok('D16 🔴 批量填入与清空选区**同口径报数**（都按实际写入成功的格数，不按选区面积）',
  /if \(writeCellVal\(ri, ci, val\)\) n\+\+/.test(batchFn)
  && /已批量写入 \$\{n\} 个单元格/.test(batchFn)
  && !/\(r1 - r0 \+ 1\) \* \(c1 - c0 \+ 1\)/.test(batchFn)
  && /if \(writeCellVal\(ri, ci, ''\)\) n\+\+/.test(clearFn),
  'batchWrite 报数行 ' + (batchFn.match(/toast\(`已批量写入[^`]*`/) || ['未找到'])[0] + ' ｜ clearRange 同口径=' + /if \(writeCellVal\(ri, ci, ''\)\) n\+\+/.test(clearFn))
ok('D15 填入输入框有区分性类名（`ctx-ipt` 是共用样式类，另有阈值/表头改名/筛选等 5 处，必须能分辨）',
  /class="ctx-ipt ctx-ipt-fill"/.test(src) && count(/class="ctx-ipt"/g) >= 1,
  '裸 class="ctx-ipt" 另有 ' + count(/class="ctx-ipt"/g) + ' 处 —— 所以真机上按 .ctx-ipt 取元素会误命中')

/* ================= E. 回归：v211 / v210 不许被这批碰坏 ================= */
lines.push('E. 回归 —— v211（补全/键盘/角标）与 v210（两态模型）')

ok('E1 v211 商品名补全仍在', has("editMode ? 'opt-prodname' : null") && has('id="opt-prodname"'))
ok('E2 v211 错误角标仍是两处', count(/class="cell-err-dot"/g) === 2, 'cell-err-dot = ' + count(/class="cell-err-dot"/g) + '（期望 2）')
ok('E3 v211 角标仍拦 mousedown+click', count(/@mousedown\.stop\.prevent @click\.stop="showCellErr\(/g) === 2)
ok('E4 v210 两态模型仍在', has('const cellTyping = ref(false)') && has('if (cellTyping.value && editing && (e.key'))
ok('E5 v210 七个 @focus 仍带 $event', count(/@focus="onFocusCell\([^)]*, \$event\)"/g) === 7,
  '带 $event = ' + count(/@focus="onFocusCell\([^)]*, \$event\)"/g) + '（期望 7）')
ok('E6 数量格键盘与最小值的 v211 改动仍在', /inputmode="numeric" min="0" placeholder="0" :data-r="ri" :data-c="visibleCols\.length \+ ui"/.test(qtyLine))

/* ================= 汇总 ================= */
for (const l of lines) console.log(l)
console.log('')
console.log('v212 离线护栏：' + pass + ' 绿 / ' + fail + ' 红   （共 ' + (pass + fail) + ' 项）')
process.exitCode = fail === 0 ? 0 : 1
