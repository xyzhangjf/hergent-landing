# Hergent 前端 UI 规范（唯一权威）

> **本文件是 Hergent 前端视觉与交互规范的说明层；代码层的唯一权威是
> `src/styles/variables.css`。两者不一致时，以 `variables.css` 为准，并立即修正本文件。**

---

## 0. 存放位置与维护方式

| 项 | 位置 | 说明 |
|---|---|---|
| 规范说明（本文件） | `hergent-cn-v2/docs/UI-SPEC.md` | 给人看的：为什么这么定、怎么用 |
| 代码权威 | `hergent-cn-v2/src/styles/variables.css` | 给机器用的：令牌与全局组件层的**唯一**实现 |
| 审查报告 | `outputs/UI规范审查-*/` | 每次全仓排查的结论与整改记录 |

**为什么放在前端仓库而不是仓库根**：规范与 `variables.css` 同仓，改样式时文档就在旁边，
不会像根目录文档那样与实现逐渐脱节。

### 维护规则（必须遵守）

1. **新增全局组件 → 同步更新本文件**。只改 `variables.css` 不改文档，规范会在下一轮失效。
2. **本文件不定义新值**。所有数值都必须是 `variables.css` 里已存在的令牌或类；
   需要新值 ⇒ 先加令牌再写文档。
3. **改全局层 = 改所有页面**。`variables.css` 里带「全站唯一一份」注释的段落，
   改动前必须确认影响面。
4. **每次新增大块 UI 后跑「类差集审计」**：提取模板用到的类减去样式里定义的类，
   差集必须为空。本项目 2026-09-22 实测出过 **17 个类零样式定义**的严重缺陷
   （构建零报错、肉眼极难发现）。审计脚本见 §7。
5. **禁止为了局部效果在页面里覆盖全局件**。需要变体 ⇒ 在全局层加修饰符类。

---

## 1. 设计令牌

### 1.1 品牌色与语义色

| 令牌 | 浅色值 | 用途 |
|---|---|---|
| `--p` | `#06b6d4` | 品牌青 —— **装饰/高亮**（不作为文字色，对比度不足） |
| `--p-dark` | `#0891b2` | **主交互色**（按钮实底、文字可读） |
| `--p-deep` | `#0e7490` | hover / 按下 |
| `--p-bg` / `--p-border` | 6% / 28% 青 | 主色浅底 / 主色边框 |
| `--suc` | `#34c759` | 成功 |
| `--dan` | `#ff3b30` | 危险（删除/停用/错误） |
| `--war` | `#ff9f0a` | 警告（缺数据/待处理） |
| `--danger-bg` / `--danger-txt` | `#fef2f2` / `#dc2626` | 错误浅底 / 错误文字 |

> 🔴 **禁止裸写颜色值**。所有颜色必须走令牌；深色模式由 `:root.dark` 覆盖同名令牌实现。

### 1.2 中性色（背景 · 文字 · 边框）

| 令牌 | 浅色值 | 用途 |
|---|---|---|
| `--bg` | `#ffffff` | 页面底 / 卡片底 |
| `--bg2` | `#f5f5f7` | 分区底、表头底、hover 底 |
| `--bg3` | `#fafafa` | 输入底 |
| `--bg4` | `#f0f0f2` | 悬浮底、禁用底、默认标签底 |
| `--t1` | `#1d1d1f` | 主文字 |
| `--t2` | `#6e6e73` | 次要文字（**说明文案的最低档**，对白底 ≈ 5.0:1，达标） |
| `--t3` | `#a1a1a6` | 提示文字 —— 🔴 **仅用于装饰性/非说明性文字**（对白底仅 ≈2.5:1，不达标） |
| `--bd` | `#e5e5ea` | 边框 |
| `--border-subtle` | `#ececee` | 更浅的分隔线 |

> 🔴 **对比度红线**：说明性、字段标签、错误文案一律用 `--t2` 或更深的 `--t1`。
> 用 `--t3` 承载说明文字 = WCAG AA 不达标（实测 2.5:1 vs 要求 4.5:1）。

### 1.3 字号与字重

| 令牌 | 值 | 用途 |
|---|---|---|
| `--fs-xs` | 11px | **仅**角标/计数等非说明性文字 |
| `--fs-sm` | 12px | 提示、次要信息（已是可读下限，不要再小） |
| `--fs-base` | 13px | 表格、表单控件、小按钮 |
| `--fs-md` | 14px | 正文（body 默认） |
| `--fs-lg` | 16px | 弹窗标题、区块标题 |
| `--fs-xl` | 20px | 页头 `h2` |

字重只三档：`400`（正文）/ `500`（按钮、表头）/ `600`（标题、强调值）。

### 1.4 间距

`--sp-1`(4px) `--sp-2`(8px) `--sp-3`(12px) `--sp-4`(14px) `--sp-5`(18px) `--sp-6`(20px)

> 卡片内距全站默认 **18px**（`--sp-5`）；工具栏内距 12px 16px（紧凑档 8px 12px）。

### 1.5 圆角

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 8px | 小控件（`.fld`、`.chip`、标签、徽章） |
| `--radius-md` | 12px | 输入框、按钮、表格容器、次级卡片 |
| `--radius-lg` | 16px | 卡片、弹窗 |
| `--radius-xl` | 22px | 大容器 / 特殊面 |

> 🔴 圆角**只有这四档**。出现过 10px、18px 这类档外值，属不符合项。

### 1.6 阴影

| 令牌 | 值 | 用途 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.04), 0 1px 6px rgba(0,0,0,.04)` | 卡片默认 |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.04)` | 卡片 hover |
| `--shadow-lg` | `0 12px 40px rgba(0,0,0,.10)` | 弹窗、浮层 |

> ⚠️ **已知历史偏差**：站内曾并存 `0 16px 48px rgba(0,0,0,.18)` 的硬编码写法。
> 自 v241 起**以 `--shadow-lg` 为准**，页面不得再写字面量阴影。
>
> 🟡 **页面特型阴影（例外清单，v367 登记）**：下列**一次性**用途允许就地写字面量，
> 但**必须紧随注释说明用途**——它们语义与三档通用阴影不同（上沿 / 彩色 / 微控件），
> 硬套 `--shadow-*` 会改变视觉：
> · **上沿分隔**（表底统计条 `0 -2px …`，提示「上方还有内容」）：`.sel-stat`、`.col-total-bar`
> · **品牌光晕**（用强调色而非黑系）：`.sprint-card.is-pinned` 的青色 `rgba(6,182,212,.14)`
> · **微控件**（仅 1–2 处的小按钮 / 拖拽手柄）：`.row-ops .rop`、`.fill-handle`
>
> 🔴 判据：**同一阴影值在站内出现 ≥ 3 次** ⇒ 必须上提为令牌；一次性特型登记在此即可。

### 1.7 层级（z-index）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--z-dropdown` | 400 | 下拉菜单 |
| `--z-sticky` | 600 | 吸顶表头 |
| `--z-overlay` | 980 | 弹窗遮罩 |
| `--z-modal` | 990 | 弹窗本体 |
| `--z-popover` | 1010 | 弹窗内再浮出的气泡 |
| `--z-toast` | 1200 | 全局提示 |

> 此前全站散落 950/960/980/990/1000/1001 六档硬编码，自 v241 起收敛为令牌。

#### 1.7.1 页面级浮层档（v367 补档）

Forecast 页（1.3 万行、18 处自建浮层）的真实值域是 1000–1200，**远超上表 6 档**
⇒ 页面只能写字面量，与「页面不得再写字面量」自相矛盾（规范脱节）。
v367 按页面浮层的**语义**补足下列档位，并把该页 18 处字面量全部迁过来：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--z-page-fs` | 1000 | 页面级全屏容器 |
| `--z-ctx-overlay` | 1090 | 右键菜单遮罩 |
| `--z-ctx-menu` | 1091 | 右键菜单本体 |
| `--z-page-overlay` | 1100 | 页面级遮罩（列菜单 / 工具栏弹层） |
| `--z-page-menu` | 1101 | 页面级菜单 / 弹层本体 |
| `--z-page-menu-sub` | 1102 | 页面级二级菜单（列编辑菜单） |
| `--z-page-bar` | 1120 | 页面级工具条 / 气泡 |
| `--z-page-modal-overlay` | 1125 | 页面级模态遮罩（导入 / 审批） |
| `--z-page-modal` | 1130 | 页面级模态本体 |
| `--z-sug-pop` | 1150 | 建议浮层（商品名建议） |
| `--z-mask` | 1200 | 定稿 / 操作遮罩（与 `--z-toast` 同值，语义独立） |

> 🔴 **新增页面浮层一律从本表取值**，不要再在页面里拍数。
> 🔴 分界：上表 `--z-*`（400–1010）是**全局层**；本表 `--z-page-*` 是**页面自建浮层**——
> 后者整体高于前者，避免页面内弹层被全局弹窗盖住。
> 🔴 迁移纪律：**新令牌的值必须与页面既有字面量逐值相同** ⇒ 零视觉变化、相对顺序必然不变。
> v367 迁移后已自证「剩余字面量 = 0」且「令牌展开值集合 = 原值集合」。

---

## 2. 组件用法

### 2.1 按钮（三档 + 尺寸）

| 类 | 用途 | 规格 |
|---|---|---|
| `.btn` | 基础 | 高 36px，内距 0 16px，圆角 12px，14px/500 |
| `.btn-primary` | **主操作**（每屏最多一个） | 实底 `--p-dark`，白字 |
| `.btn-ghost` | 次要操作 | 透明底 + `--bd` 边框 |
| `.btn-danger` | **有业务后果**的动作（停用/删除/放弃改动） | 浅红底 `--dan-bg` + 危险色字 |
| `.btn-sm` | 工具栏/表格内 | 高 32px，内距 0 12px，13px |
| `.btn-icon` | 纯图标 | 30×30，图标 16px |
| `.btn.on` | 已激活/已展开 | 浅底 + 主色字 + 主色边框 |

**排列顺序**：右对齐时「次要 → 主」从左到右；危险动作不放在主按钮位置。
禁用时给 `:title` 说明原因（不要让用户猜为什么点不动）。

### 2.2 表单

| 类 | 用途 | 规格 |
|---|---|---|
| `.input` | 标准输入框 / 下拉 / 多行文本 | 高 40px，内距 0 14px，圆角 12px，底 `--bg3` |
| `.fld` | 紧凑控件（工具栏筛选） | 高 32px，内距 0 10px，圆角 8px，13px |
| `.input.err` | 校验失败 | 边框 `--dan` + 浅红底 |
| `.field-err` | 字段级错误文案 | 12px，`--danger-txt`，位于输入框下方 |
| `.chip` | 可切换标签 | 高 32px，圆角 8px；`.on` 为实底主色 |

**控件高度只有两档：40px（`.input`）与 32px（`.fld`）**。表单密集处用 32px。
出现过 34px 这类第三档，属不符合项。

### 2.3 状态（新增 v241）

| 类 | 用途 |
|---|---|
| `.input:disabled` | 禁用：灰底 `--bg4` + `--t3` + `cursor:not-allowed` |
| `.input[readonly]` | 只读：**保留焦点与复制能力**，底 `--bg2`，无 focus 高亮 |

> 🔴 **「不可改」优先用 `readonly` 而非 `disabled`**：`disabled` 元素不进 Tab 焦点序列，
> 屏幕阅读器会整段跳过，用户既读不到也复制不了内容（如条码）。

### 2.4 容器与布局

| 类 | 用途 |
|---|---|
| `.card` | 通用卡片（内距 18px，圆角 16px，`--shadow-sm`，hover 升 `--shadow-md`） |
| `.sub-card` / `.sub-card-hd` | 卡片内的次级分组（无阴影，避免嵌套显脏） |
| `.sec-hd` / `.sec-sub` | 区块标题（带左侧竖条，须为 `.card` 的直接子元素） |
| `.sub-sec` | 次级小标题（卡片内分组名） |
| `.bento` | 12 列自适应网格（模块用 `grid-column:span N`） |
| `.kpi-strip` | 顶部概览条（默认 5 项，`.cols-N` 覆盖） |
| `.tab-pane` | 与 `.main-tabs` 配套的 Tab 内容面板 |

### 2.5 页内 Tab（全站唯一一份）

```html
<div class="main-tabs" role="tablist" aria-label="分区名">
  <button class="main-tab" role="tab" :aria-selected="tab==='a'" :class="{on: tab==='a'}">甲</button>
</div>
<div class="tab-pane">…</div>
```

> 🔴 `.main-tabs` / `.main-tab` 是**全站唯一一份**。页面自造 Tab 会导致视觉逐轮漂移
> （2026-09-22 实测：商品档案自造的 `pa-tabs/pa-tab` 全仓零 CSS 定义）。

> ⚠️ **用途已收窄（v396）**：本节的页内 Tab 现在**只用于「同一个弹窗 / 同一张表单内部的分区」**
> （参照实现：`ProductArchive.vue` 编辑弹窗的 4 个表单分区）。
> **「模块有哪些子页」不再用页内 Tab** —— 改由 **§3.5 全局标签栏** 承载
> （`/rebate`、`/loss-accounting`、`/print`、`/archive`、`/inventory` 的页内页签条已于 v396 **退役**）。
> 判据一句话：**是"表单分区"就用本节；是"模块导航"就用 §3.5。**

### 2.6 表格与数据件

`.table-wrap` + `table.tbl`（表头 `--bg2`、13px、`--t3`）、`.tbl .num`（右对齐等宽数字）、
`.tag` / `.badge`、`.progress`、`.state-empty` / `.state-error`、`.skeleton`。

价格矩阵等「单元格内嵌输入」场景：`.pm-wrap`（横向滚动）+ `.pm-input`（高 30px 右对齐等宽数字）+ `.pm-c`（居中）。

#### 2.6.1 列设置入口与序号列（v400 统一约定）

**基准实现 = `/forecast`（预报订单管理 › 本期预报）** 的 `.cross-tbl`（查看态）与 `.edit-tbl`（改单态）。
全站任何「列可显隐 / 可拖序 / 可拖宽」的宽表一律照它做，**不要另发明入口、不要各拍一套**。

**一、列设置：齿轮在表头第一列（不是工具栏按钮）**

| 项 | 约定 |
|---|---|
| 位置 | **表头第一列（序号列）的单元格里**，是该单元格**唯一**的按钮。⛔ 不放工具栏、⛔ 不放别的表头列 |
| 元素 | `<button class="col-cfg gear" title="列设置"><Icon name="settings"/></button>` |
| 图标 | `<Icon name="settings"/>` = Lucide **线性**齿轮（2 段 path，`stroke` 取 `currentColor`、`fill:none`） |
| ⛔ 禁止 | **emoji 齿轮**（码位 U+2699 / U+FE0F）。全站必须 0 处 —— 判据见 §7.3 的 D1 |
| 状态 | 开合由**一个** `showColMenu` 管（`showColMenu = !showColMenu`）；查看态与改单态**共用**同一份清单、同一套排序、同一份可见性 |

`.col-cfg` 与 `.gear` 合起来给的全部视觉（**只此一处，页面里别再抄一遍**）：

```css
.col-cfg{border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:11px;
         padding:0 2px;line-height:1;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center}
.gear{padding:2px 4px;border:none;background:transparent;cursor:pointer;font-size:14px;line-height:1;
      color:var(--t3);border-radius:var(--radius-sm)}
.gear:hover{background:var(--bg3);color:var(--p-dark)}
```

⇒ 视觉三要素：**无边框、透明底、默认 `--t3` 灰；hover 才给 `--bg3` 底 + `--p-dark` 字**。
**只用令牌上色**（禁硬编码色值）⇒ 深色模式自动跟随，无需页面自己适配。
图标是 `<Icon>` 线性组件而非 emoji，与全站「装饰性 emoji → `<Icon>` 线性 SVG」的图标纪律同源。

齿轮的定位上下文是表头单元格内的 `.th-in`：

```css
.th-in{display:flex;align-items:center;gap:5px;justify-content:space-between}
.th-in > .col-cfg{margin-inline:auto}   /* 必须 —— 见下 */
```

🔴 **`.th-in > .col-cfg{margin-inline:auto}` 不是可选装饰**：序号列格子里**只有齿轮一个子元素**，
而 `justify-content:space-between` 对单个子元素**等价于 `flex-start`** ⇒ 齿轮被顶到格子左侧、
与表体 `.seq-num` 的居中线错开（v400 真机量到**右偏 4px**，v401 已修）。
`margin-inline:auto` 吃掉剩余空间，把它拉回正中。
（改单态的齿轮是 `<th>` 的**直接子元素**、靠 `.seq-th{text-align:center}` 居中，不经过 `.th-in`，本就不受影响。）

**二、序号：与齿轮同列，落在齿轮正下方**

| 项 | 约定 |
|---|---|
| 位置 | **表体、与齿轮同一列**（`td.seq-cell`）里的 `.seq-num`。⛔ 不另起一列、⛔ 不放行尾 |
| 取值 | **1 基连续**（查看态 `it.seq`、改单态 `ri + 1`），跟随**筛选 / 分组后的当前可见行序**重排 |
| 列宽 | **全站唯一源 = `variables.css` 的 `table.tbl .seq-th` / `.seq-cell`，写死 46px**（v401 上提）。宽表的**权威来源**仍是 `<colgroup>` 的 `colW('seq')`，默认 **46px**（`COL_DEFAULTS.seq`）、**可拖宽** —— 因 `.cross-tbl` / `.edit-tbl` 是 `table-layout:fixed` |
| 宿主写法 | 表头 `<th class="seq-th">序号</th>`；表体 `<td class="seq-cell"><span class="seq-num">1</span></td>` |
| ⛔ 别再抄 CSS | **页面里不要再写 `.seq-th` / `.seq-cell` / `.seq-num` 三条规则** —— v401 起已在全局层（见下） |
| 冻结 | 横向滚动必须随左冻结区粘住：`position:sticky; left:0`；表体 `z-index:6`／表头 `z-index:9`（**表头必须更高**，否则横向滚来的普通表头会盖住它） |
| 数字形态 | `.seq-num{display:inline-block;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}` —— **等宽数字**，否则 1↔10 切换时数字左右跳 |
| ⛔ 不可配置 | 序号列**不在列设置清单里** ⇒ **不可隐藏、不可拖序、不可删除**。它是齿轮的宿主，被藏掉会连入口一起消失 |

**序号列的 CSS 只此一份**（v401 上提、**v402 扩 `seq-host`**；落实 §8.4「同一选择器在站内 ≥3 次
且逐字相同 ⇒ 必须上提」—— v401 时 `Forecast.vue` ＋ 两个进销存列表页 = 3 处 ⇒ 触发；
v402 铺开后共 21 页 / 25 张表复用**同一份**）：

```css
/* src/styles/variables.css —— 表格区（紧接 table.tbl .num 之后） */
table.tbl .seq-th, table.seq-host .seq-th{width:46px;min-width:46px;text-align:center;padding:8px 4px;vertical-align:middle}
table.tbl .seq-cell, table.seq-host .seq-cell{width:46px;min-width:46px;text-align:center;padding:6px 4px;vertical-align:middle;color:var(--t3);font-size:12px}
table.tbl .seq-num, table.seq-host .seq-num{display:inline-block;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}
```

> **两组并列选择器的分工**：`table.tbl` 前缀给标准表；`table.seq-host` 前缀给各页自定义表
> （见「五、B」—— 它们**不能**改挂 `tbl` 类，会破坏自身排版）。后者 specificity **0,2,1**
> 稳压各表自身的 `.xx-tbl td` **0,1,1**，所以只改序号格、不碰其余单元格。
>
> ⚠️ **横向冻结不在这份全局规则里**：`position:sticky;left:0` ＋ `z-index`（表体 6 ／ 表头 9）
> 是**宽表特有**需求，由各页按需自己补 —— 基准实现见 `Forecast.vue` 的
> `.cross-tbl .seq-th` / `.cross-tbl .seq-cell` 三条。**列少、不横向滚动的只读清单不要加 sticky。**
> `Forecast.vue` 里原先那份 `42px` 副本（不参与布局的陈旧值）v401 已删。

**三、列设置清单（齿轮点开的面板）**

`.col-menu`（**`position:fixed`**、`max-height:70vh`、`min-width:300px`）+ `.col-menu-list`
（每行 = 拖拽手柄 `⠿` + checkbox + 列名）。**清单里只放可配置列**（主档列 / 客户列）——
**不含序号列，也不含合计 / 计算列**。改单态另叠 `.edit-col-menu`（只覆盖 `z-index` 与 `max-width:420px`）。

🔴 **面板位置必须由 JS 按齿轮现算，不许写死 `top` / `left`**（v401 定）：

| 项 | 约定 |
|---|---|
| 定位 | `position:fixed` ＋ 内联 `top`/`left`（**视口坐标**），由 `toggleColMenu(e)` 读 `e.currentTarget.getBoundingClientRect()` 算出 |
| 默认 | 齿轮**正下方**、间距 `gap:6px`；左缘与齿轮左缘对齐 |
| 越界 | 下方放不下 ⇒ **上翻**到齿轮上方；右侧越界 ⇒ 改右对齐 ⇒ 仍越界则贴视口右边（四周留 `pad:8px`） |
| 🔴 **必须限高** | **`maxHeight` 由 JS 按可用空间现算**（`spaceBelow = vh − pad − (gear.bottom + gap)`；上方同理），取**更大的一侧**且优先下方；另加 `Math.max(160, …)` 保底。**光"越界就移位"不够** —— 本期预报列清单实测高 **543px**，而齿轮下方只剩 ~520px、上方 ~511px ⇒ 上翻与贴底**都放不下**，菜单照样盖住齿轮。**移位必须与限高配对**，否则"不遮挡触发按钮"根本不成立 |
| 尺寸校正 | 首帧还量不到菜单 ⇒ 先按兜底尺寸（320）摆位，`nextTick` 后再用真实 `offsetWidth` 校正（**避免先闪一下**） |
| 滚动 / 改窗口 | 面板是 `fixed`（脱离文档流），任何滚动或 `resize` 都会让它与齿轮脱位 ⇒ 监听 `window` 的 `scroll`（**捕获阶段**，一个监听同时覆盖页面滚动与表格内部滚动）与 `resize`，**直接收起** |
| ⛔ 禁止 | 写死 `top:38px; left:0` 挂在工具条 `.col-config-bar` 上 —— 那是 v400 之前的错法：齿轮在表头、工具条在**另一坐标系** ⇒ 菜单从左上压下并**盖住齿轮**（实测 Δt=−15px） |

查看态与改单态**共用同一份**定位逻辑（`showColMenu` 唯一；齿轮各自把自身 DOM 存进 `colMenuGear`）。

**四、适用范围与触发条件**

| 场景 | 序号列 | 列设置齿轮 |
|---|---|---|
| 可编辑网格、逐行核对清单（行会被「第 N 行那个」点名） | **必须有** | 列集合不固定、或列数 ≥15 时**必须有** |
| 长清单只读表（列固定、语义稳定） | 建议有 | 不需要 |
| 卡片 / 表单 / 看板 / 短 KPI 表（≤5 行） | 不需要 | 不需要 |
| 弹窗内的只读明细预览 | 不需要 | 不需要 |

> 判据一句话：**这张表会不会被用户说成「第几行那个」？会说 ⇒ 要有序号。
> 列的集合会不会变（可加主档列 / 可隐藏 / 可拖序）？会 ⇒ 要有齿轮。**
>
> ⚠️ 两个**一起出现**才完整：齿轮的宿主就是序号列表头 ⇒ **要齿轮就必须同时有序号列**，反之不然。

**五、全站现状（v402：序号列已铺开至 21 页 / 25 张清单表）**

**A. 标准 `table.tbl` 列表页**（走 `table.tbl .seq-*`）

| 页面 | 路由 | 序号取值 | 备注 |
|---|---|---|---|
| 品牌档案 | `/archive/brands` | `i + 1` | |
| 客户档案 | `/archive/customers` | `(page - 1) * pageSize + i + 1` | 前端分页 `page/pageSize=20` |
| 员工档案 · 外部客户账号 | `/archive/employees` | `i + 1` | 本页**第 1 张**表 |
| 员工档案 · 在职员工 | `/archive/employees` | `i + 1` | 本页**第 2 张**表 |
| 商品档案 | `/archive/products` | `(page - 1) * pageSize + i + 1` | 14 列；`pageSize=50` |
| 仓库档案 | `/archive/warehouses` | `i + 1` | |
| 供应商档案 | `/archive/suppliers` | `(page - 1) * pageSize + i + 1` | 前端分页 `pageSize=20` |
| 采购单列表 | `/inventory/purchase` | `offset + i + 1` | v401 试点 |
| 销售单列表 | `/inventory/sale` | `offset + i + 1` | v401 试点 |
| 库存查询 | `/inventory/stock` | `offset + i + 1` | 服务端 `offset` 分页 |
| 采购单详情 · 分批到货录入 | `/inventory/purchase/:id` | `i + 1` | 可编辑录入网格 |
| 采购单详情 · 商品明细 | `/inventory/purchase/:id` | `i + 1` | |
| 销售单详情 · 商品明细 | `/inventory/sale/:id` | `i + 1` | |
| 新建采购单 · 明细录入 | `/inventory/purchase/new` | `i + 1` | 可编辑录入网格 |
| 新建销售单 · 明细录入 | `/inventory/sale/new` | `i + 1` | 可编辑录入网格 |
| 目标与返利 · 规则清单 | `/rebate` | `i + 1` | |
| 目标与返利 · 达成清单 | `/rebate` | `i + 1` | |
| 目标与返利 · 月度分解 | `/rebate` | `i + 1` | ≤12 行 |
| 货损计算工作流 · 命中明细 | `/loss` | `i + 1` | |
| 算工资 · 员工工资明细 | `/payroll` | `i + 1` | |
| 定时任务 | `/cron` | `i + 1` | |
| 历史期次 | `/forecast?tab=history` | `i + 1` | `ForecastHistory.vue` |
| 报单配置 | `/forecast?tab=config` | `i + 1` | `ReportMapping.vue`；空态行 `colspan 9 → 10` |

**B. 非 `.tbl` 自定义表**（走 `table.seq-host .seq-*`，**必须给 `<table>` 加 `seq-host` 类**）

| 页面 | 路由 | table class | 序号取值 | 备注 |
|---|---|---|---|---|
| 渠道与价格 · 客户专属价 | `/archive/prices` | `pc-tb seq-host` | `cpOffset + i + 1` | 服务端分页 `cpOffset` |
| 渠道与价格 · 商品价格 | `/archive/prices` | `pc-tb seq-host` | `mxOffset + i + 1` | 空态行 `colspan 5 → 6` |
| 商品目标 | `/forecast?tab=target` | `pt-tbl seq-host` | `ri + 1` | 展开行 `colspan 10 → 11` |
| 招投标雷达 | `/bid-radar` | `br-tbl seq-host` | `i + 1` | |
| 货损核算 · 月度分析 | `/loss-accounting` | `la-ml-tbl seq-host` | `i + 1` | ≤12 行 |

> 🔴 **为什么要有 `seq-host`**：全站有两类表 —— ① 标准表 `class="tbl"`；② 各页自定义表
> （`pc-tb` / `pt-tbl` / `br-tbl` / `la-ml-tbl` …，各自带一份**互不相同**的 th/td 样式，
> 如 `.pt-tbl th` 是 `position:sticky` + `--bg3`、`.pc-tb` 是 12.5px）。后者**不能改挂 `tbl` 类**
> —— 会与它自身的 `.xx-tbl td{padding:…}` 同 specificity 相撞、按源码顺序互相覆盖、破坏排版。
> 于是统一再加一个**无样式的中性标记类 `seq-host`** ⇒ 全局选择器写
> `table.tbl .seq-*, table.seq-host .seq-*`（后者 specificity **0,2,1** 稳压各表自身的
> `.xx-tbl td` **0,1,1**）⇒ 只改序号格、不碰其余单元格。
> **新增这类表时 `class="xx-tbl seq-host"` 两件都要写。**

> ⚠️ **分页表的序号必须跨页连续**：`offset + i + 1` / `(page - 1) * pageSize + i + 1` /
> `cpOffset + i + 1` —— 写 `i + 1` 会让第 2 页又从 1 开始。**先确认该页用的是哪种分页**再写下标。

**C. 有意不铺的页面**（按「四、」判据）

| 页面 | 原因 |
|---|---|
| 库存效期补录 `/data-fill` | 表单录入表，无 `v-for` 数据行 |
| 舟谱单据导入 `/zhoupu-import` | 3 列诊断表（列名映射 / 原因统计） |
| 设置 `/settings` | 权限配置表，不是业务清单 |
| 经营工作台 `/workbench` | 看板短表（≤6 行，如 `expiryData.slice(0,6)`） |
| 进销存工作台 `/inventory` | 4 列 KPI 小表 |
| 弹窗内只读明细（返利修改日志 `achv-log-wrap`、品牌冲突 `cf-tbl`） | 「弹窗内明细预览」不需要 |
| 货损核算的 `la-tbl` / `la-mini` 审计与概念表 | 审计 / 说明性质，非逐行清单 |

**D. 齿轮（列设置入口）仍只在 `/forecast`** —— 判据是「列集合会不会变」：全站只有本期预报有
「可加主档列 / 可拖序 / 列方案」，其余页列集合固定 ⇒ 按「四、」**不需要**齿轮。
（v402 起 `seq-host` 让**序号列**可低成本复用，但**齿轮不是样式、是与列数据集绑定的功能**，
不要给固定列页面硬套。）

⇒ 本节是**全站约定**，接入时按本节做，**别把首列改成别的语义再另开一个设置入口**。

**六、两处偏差已在 v401 修复（改前实测留档，作回归基线）**

v400 立本节时登记了两处真机偏差；**v401 已按本节修掉实现**（文档与实现对齐）：

| 偏差 | 改前实测（1920 视口） | v401 修法 |
|---|---|---|
| 齿轮**未居中**在序号列上（序号比齿轮**右偏 4px**） | 齿轮 cx=303 ／ 序号 cx=307 | 查看态补 `.th-in > .col-cfg{margin-inline:auto}`（根因：`space-between` ＋ 单子元素 ⇒ 被推到左边）；改单态本就居中，未动 |
| 列设置菜单**不从齿轮下方弹出**，反从**左上压下并盖住齿轮** | 菜单 top=510 ／ 齿轮 top=525 ⇒ **Δt=−15px**，Δl=−8px | `.col-menu` / `.edit-col-menu` 由 `position:absolute;top:38px;left:0` 改 **`position:fixed`**；位置改由 `toggleColMenu` 按齿轮 `getBoundingClientRect()` 现算，**并配 `maxHeight` 限高**（见「三、」—— 首版只移位不限高，被真机探针抓出仍遮挡：清单高 543px 放不进 ~520px 的可用空间） |

判定方式：探针 `.workbuddy/tools/v400-col-cfg-probe.mjs` 分**两相位** ——
`V400_EXPECT=impl`（记录 **v400 改前现况**，36 PASS / 0 FAIL）与
`V400_EXPECT=spec`（量**本节契约**，v400 时恰好红上面这 2 条）。
**v401 修完后：`spec` 相位应转全绿（原红那 2 条变绿）；`impl` 相位会在那 2 条上转红** ——
这不是回归，正是「同一条量在两相位取**相反**期望 ⇒ 判据不可能恒真」的自证。
⇒ **看回归请认 `spec` 相位**（它量的是本节的现在时）。

---

## 3. 布局与响应式

### 3.1 页面容器与留白（统一留白规范 · v399）

**基准页 = `/forecast`（预报订单管理 › 本期预报）**。实测 1920 视口下它**占宽比 100%、左右留白 0px**——
这就是全站唯一基准，其余页面（尤其**单据页**）一律向它对齐，而不是反过来。

**四层留白模型**（从视口到内容。每层只管一件事，**同一种间距不许由两层各给一次**）：

| 层 | 载体 | 值 | 谁给的 |
|---|---|---|---|
| L0 视口 → 侧栏 | 侧栏 | `--sidebar-w`（248px） | 全局 |
| L1 内容区 | `.view-wrap` | `padding:20px`；`≤768px` 时 `14px 12px calc(72px + env(safe-area-inset-bottom))` | 全局（`Shell.vue`） |
| L2 页面容器 | `.page` | `margin-inline:auto`。**默认不设 `max-width` ⇒ 全宽** | 全局（`variables.css` §②） |
| L3 卡片 | `.card` | `padding:18px`（`--sp-5`） | 全局（§2.4） |

**三条硬规则**：

1. **页面留白只有一层** —— 由全局外壳 `.view-wrap` 给 20px。**页根不再加左右内距。**
   页根写 `padding-left/right` 会与外壳**叠加**：`ZhoupuImport.vue` 原写 `padding:20px 20px 60px`
   ⇒ 实际左右 40px（实测占宽比掉到 58.8%）。
2. **页面容器默认全宽，不套宽度档位**。表格密集页 / **单据页** / 工作台 / 看板一律全宽——
   宽屏的取舍在「表格能不能少一次横向滚动」，不在「看着空不空」。
3. **禁止在页根写 `max-width` / `margin:0 auto` / 左右 `padding`** 这三件事。
   需要「阅读宽度」时，把宽度落在**卡片 / 表单 / 文本块**上，不落在页面上：
   例 `Print.vue` 的 `.pr-card{max-width:720px}`、`RoleManage.vue` 的 `.rm-caps-form{max-width:560px}`。

**例外白名单**（档位来自 `variables.css` 的 `.page-reading` / `.page-default`。
**在本节登记，改一处登记一处**——未登记即视为违规）：

| 页面 | 档位 | 值 | 理由 |
|---|---|---|---|
| `Print.vue` | `.page-default` | 1200px | 纯阅读 / 设置型（打印模板·设置·记录），卡片自身 720px，靠页容器居中 |
| *（无）* | `.page-reading` | 900px | **当前无使用者**（保留档位；持续无使用者则应删除） |

> 🔴 **历史教训**：2026-09-11 之前 19 个页面各写一份宽度，实测并存 **900 / 980 / 1180 / 960 / 全宽**
> 五档。「本期预报」当年改为全宽后，注释里写成「全站无页面启用档位」——**与实况不符**：
> 当时 `Print.vue` 与 `InventoryShell.vue` 都在用 `.page-default`。v399 一并改为写实况。
> ⇒ **文档里的「当前无使用者」必须每次改动后回查，否则它会变成一句会骗人的话。**

**怎么判定（可量化，不靠观感）**：**占宽比 = 页面实际宽 ÷ 内容区可用宽**
（内容区可用宽 = `.view-wrap` 的 `clientWidth − 左右 padding`）。**< 100% 即存在结构性留白**。

- ⚠️ **必须在 ≥1600 视口取判据**：1440 下 1200px 限宽只差 **8px**（量不出问题），1920 下差 **424px**。
- 左右留白应**对称**（`gapL`/`gapR` 差 ≤8px 记为滚动条 / 亚像素，不算偏移）。
- 探针：`.workbuddy/tools/v399-layout-gap-probe.mjs`（只读真机、零写入、含**判别力自证**——
  基准页与进销存页必须量到**不同**结构，否则判据本身没有区分力，跑出"全绿"也无意义）。

**基准判定表（1920 视口实测）**：

| 页面 | 页根 | `max-width` | 占宽比 | 左右留白 |
|---|---|---|---|---|
| 本期预报（**基准**） | `.page` | — | **100%** | **0 / 0** |
| 进销存 8 页（v399 **前**） | `.page.page-default` | 1200px | 73.5% | 216 / 216 |
| 舟谱导入（v399 **前**） | `.zp-wrap`（连 `.page` 都没有） | 960px | 58.8% | 336 / 336 |

**内层业务容器**（子页根，如进销存 `.inv-page`）：**零宽度声明**（只 `display:block`），
随容器自动铺满 —— 这样改容器宽度就只改一处，子页不用动。

### 3.2 页头

```html
<div class="page-hd split">
  <div><h2>标题</h2><span class="page-sub">副标题</span></div>
  <div class="XX-acts">…右侧操作区…</div>
</div>
```

`.page-hd`（基线对齐，下边距 18px）、`.split`（两端对齐）、`.flush`（去掉下边距）。

> 🔴 **右侧操作区目前没有全局件 —— 这是本规范的一处已知欠账**。
> 本示例原先写的是 `pa-actions`，但 `pa-` 是**商品档案的页面前缀**（§6.1），
> 该类的定义只在 `ProductArchive.vue` 的 **scoped** 里 ⇒ **规范示例自己违反了 §6.3**。
> 实况（2026-10-07 实测）：`ProductArchive.vue` 与进销存八页**各写一份**，共 8 份 `.XX-acts`
> （7 份逐字相同）。⇒ 按 §6.2 它**早已满足「被第二个页面需要」**，应当上提为全局类
> `.page-acts`；欠账清单与判据见 **§8.4**（本轮只登记，未整改）。

### 3.3 断点

| 断点 | 全局行为 | 页面需做的事 |
|---|---|---|
| ≤1200px | `.bento` 降 6 列、KPI 降 3 列 | 无需额外处理 |
| ≤768px | body 15px、`.bento` 单列、KPI 2 列、KPI 值 18px | 检查表格横向滚动 |
| ≤640px | — | **表单栅格降为单列**（两列时每列不足 170px 会挤压） |

> 🔴 表单型页面**必须**有 640px 断点。四个档案页曾全部为 0 个 `@media`。

### 3.4 侧栏一级项浮层面板（横向分列 · v395）

**形态来源**：竞品舟谱。截图库 = `/Users/zhangjunfeng/Documents/舟谱截图/`（按职能区分目录）；
本节每条形态要求都能在那批图上找到对应 —— OCR 实证清单见 `topics/competitor-zhoupudata.md`
（**档案管理 7 列 / 采销管理 6 列 / 设置 3 列**，列宽随条目长短不一）。

> 🔴 **它是「多列分组卡片」，不是「下拉菜单」**：一级项被悬停或点击时，在其**右侧**弹出一块
> 卡片，卡片里一个分组 = 一列、**横向并排**。
> v390 曾把它渲染成 168px 窄条、把各组**从上往下堆** —— 那是本节定义的**头号反例**（v395 修正）。
>
> ⚠️ 读图纪律：本仓模型侧**读不了图片**。对标竞品一律用 `.workbuddy/tools/ocrcli.swift`
> （Swift + macOS Vision，带归一化坐标）真读，**不许拿文档转述冒充「原图实证」**。

**DOM 契约**（`Shell.vue`，三层：面板 → 列 → 行）：

```html
<div class="sb-pop" :style="popStyle">
  <div v-for="sg in it.groups" :key="sg.label" class="sb-pop-col">
    <div v-if="sg.label" class="sb-pop-hd">{{ sg.label }}</div>
    <div v-for="x in sg.items" :key="x.path + (x.tab||'') + (x.q ? JSON.stringify(x.q) : '')" class="sb-pop-row">
      <router-link :to="navTo({path:x.path, tab:x.tab, q:x.q})" class="sb-pop-item" :class="{cur:isCur(x)}">…</router-link>
      <router-link v-if="x.create" :to="navTo(x.create.to)" class="sb-pop-new">创建</router-link>
    </div>
  </div>
</div>
```

| 类 | 作用 | 关键值 |
|---|---|---|
| `.sb-pop` | 面板本体 | `display:flex;align-items:flex-start;flex-wrap:wrap`、`min-width:168px`、圆角 12px、`z-index:30` |
| `.sb-pop-col` | **一列 = 一个分组** | `flex:1 1 auto`、`min-width:124px`、`max-width:240px`；相邻列 `border-left` 竖线 |
| `.sb-pop-hd` | 列标题 | 11px / 600、置顶、**下方细分隔线** |
| `.sb-pop-row` | 一行 = 两个可点区 | 左条目 `flex:1` 吃剩余宽、右「创建」`flex-shrink:0` ⇒ 条名长短不一时仍左右对齐 |
| `.sb-pop-item` | 条目 | 13px、`nowrap`、hover 换底；`.cur` 是**唯一**高亮来源（见下） |
| `.sb-pop-new` | 行尾「创建」 | 主色底文字按钮；`x.create` 是**对象** `{to, module, title}` |

**五条硬规则**：

1. **一个 `sg` = 一列**，禁止把 `groups` 平铺进面板（平铺即纵向堆叠 = 头号反例）。
2. **列宽自适应、不写死**：`min-width` 保底 / `max-width` 防某列过长 ⇒ 条目名长的列自然更宽（同舟谱「设置」弹窗）。
3. **面板高度只取决于最高的一列** ⇒ 以后加列**只变宽、不变高**。
4. **空列自动消失**（`resolveNavItem` 已按 `canSee(path)` 过滤）⇒ 模板里**禁止**再补 `v-if` 判据 —— 那会变成第二份权限实现。
5. **面板宽度不固定** ⇒ 定位必须给上限：`_placePop` 按「到视口右边缘 − 24px」算 `maxWidth`，列数多到放不下时靠 `flex-wrap` 折行，**绝不溢出屏幕**。

**移动端边界**：`≤768px` 侧栏整体 `display:none`，改走底部栏 + 抽屉，抽屉把 `groups`
**摊平成纵向列表**（`drawerGroups` 的 `flatMap`）⇒ 本节**只约束桌面**。竖屏放不下多列，
**不要**在这里做响应式多列。

**同一页面开多个入口（单据类型进 URL）** —— v395 起销售按「业态 × 订单/退单」拆成多条，
它们**同 path 不同 query**，三个环节必须连锁做对，缺一必出 bug：

| 环节 | 要求 | 漏了的后果 |
|---|---|---|
| `navTo` | 支持 `q`（任意 query，与 `tab` 同一套展开机制） | 类型进不了 URL ⇒ 入口点了没筛选 = **假入口** |
| `isCur` | `q` 也要**逐键相等**才算当前 | 同 path 不同 query 的几条**一起亮**（v390 页签那条坑） |
| `:key` | 必须带上 `q` | Vue 重复 key ⇒ 渲染错乱 |

> 🔴 **入口立了就得真筛选**：列表页必须读 URL 的 `type`/`kind` 预置筛选**并改页头标题**，
> 新建页必须由 `?type=` 预置单据类型并**写进提交载荷**。
> 只加入口不改页面 ⇒ 点进去看到全量列表，比没有入口更让人困惑。
> 后端还没有对应能力时（如退单），页面必须**明写「开发中」**，不许拿空列表装作没数据。

**验收**：横向判据必须看**真实几何**（各列标题 `y` 同排、`x` 递增），
**不能只信 `flex-direction`**；并做**反例自证**（强改 `column` ⇒ 判据必须失败，否则判据恒真）。
探针 `.workbuddy/tools/v395-nav-popover-cols-probe.mjs`（生产实测 21/21，零写请求）。

> ⚠️ 已知欠账：`.sb-pop` 的 `z-index:30` 仍是**字面量**，未走 §1.7 的浮层档令牌。
> 侧栏是全局常驻层、与其它浮层不冲突，故暂缓；一旦出现遮挡问题，先建令牌再改。

### 3.5 全局标签栏（v396）

**形态来源**：竞品舟谱（截图库 `/Users/zhangjunfeng/Documents/舟谱截图/` 的 `舟谱导航标签截图.png`）。
OCR + 像素实测：标签栏的 4 个标签 = 侧栏弹窗「商品相关」列的**前 4 个条目**、顺序一致
⇒ **点一个开一个、累积**；标签形态 = `⟳ 名称 ×`；**激活标签白底（亮度 255）、其余灰底（228）**。
（2026-10-06 的老截图同位置为空 ⇒ 存在**无标签态**。）

> 🔴 **两种语义，别混**（本节存在的根本原因）：
>
> | 语义 | 形态 | 回答的问题 | v396 后 |
> |---|---|---|---|
> | **模块内页签**（`.main-tabs`） | 页面内固定一条 | 「**这个模块有哪些页**」 | **已退役**（仅编辑弹窗的表单分区页签保留，见 §2.5） |
> | **打开历史标签栏**（`.tabbar`） | 内容区顶部常驻 | 「**我打开过哪些页**」 | **新立**，模块导航改走这条 |
>
> 混用会让同一屏同时出现「固定 5 个页签」+「累积 8 个标签」，用户分不清哪个是"全部"。

> ⚠️ **当前唯一的过渡态：`/forecast`（预报主表）** —— 它的**页内页签条本轮未退役**
> （`EXPLODED_PATHS` 刻意不含它）⇒ 该页**同时**有「固定页签条」与「全局标签栏」。
> 这是**已知暂留**、不是设计意图；后续统一时按 §3.5 的退役三步走
> （`Forecast.vue` 的 `TAB_KEYS` = `summary/history/config/target` **已在 `SUB_TITLES` 登记好标题** ⇒ 只差入口与抽屉两步）。

**DOM 契约**（`components/TabBar.vue`，**逐字取自源码**，两层：条 → 项）：

```html
<div v-if="tabs.length" class="tabbar">
  <div class="tb-strip" ref="stripEl">
    <button v-for="t in tabs" :key="t.key" type="button" class="tab-item"
            :class="{ on: t.key === activeKey }" :title="t.title" @click="go(t)">
      <span class="tab-ic tab-refresh" role="button" @click.stop="refresh(t)"><Icon name="refresh" :size="12" /></span>
      <span class="tab-title">{{ t.title }}</span>
      <span class="tab-ic tab-close" role="button" @click.stop="close(t)"><Icon name="close" :size="12" /></span>
    </button>
  </div>
  <div v-if="hidden.length" class="tab-more">
    <button type="button" class="tab-more-btn"><span>更多</span><span class="tab-more-n">{{ hidden.length }}</span></button>
    <div v-if="moreOpen" class="tab-more-menu">…</div>
  </div>
  <div v-if="moreOpen" class="tab-more-mask" @click="moreOpen = false"></div>
</div>
```

> 🔴 **`.tb-strip` 是「全集渲染 + `overflow:hidden` 裁剪」**：`v-for` 渲染**全部**标签（不是只渲染可见的 n 个）
> —— 被裁的元素仍有布局宽度，`offsetWidth` 才读得到 ⇒ **这是测量的前提**。
> 被裁的索引由 `measure()` 算出（逐个累加 `offsetWidth + GAP`），列进右侧「更多」。

| 类 | 作用 | 关键值（逐字） |
|---|---|---|
| `.tabbar` | 条体 | `display:flex;align-items:center;gap:6px;padding:6px 20px`、`background:var(--bg2)`、`border-bottom:1px solid var(--border-subtle)`、`flex-shrink:0`、`position:relative`、`z-index:6` |
| `.tb-strip` | 标签容器 | `flex:1;min-width:0;display:flex;gap:4px;overflow:hidden` |
| `.tab-item` | 单个标签（`<button>`） | `height:28px`、`padding:0 7px 0 5px`、圆角 8px、12.5px、**`max-width:200px`**；`.on` = `background:var(--bg)` ＋ `--shadow-sm` ＋ `font-weight:600` ＋ `border-color:var(--border-subtle)` |
| `.tab-ic` | 刷新 / 关闭小钮（`16×16`）；两个**语义变体** = `.tab-refresh` / `.tab-close` | `border-radius:5px`、`color:var(--t3)`；hover ⇒ `--p-bg` 底 + `--p-dark` 字 |
| `.tab-item.on .tab-refresh` | 激活标签的刷新钮 | `color:var(--p-dark)` |
| `.tab-item.on .tab-close` | 激活标签的关闭钮 | `color:var(--t3)` |
| `.tab-title` | 标题 | `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` |
| `.tab-more` / `.tab-more-btn` | 溢出入口 | `position:relative`；按钮高 28px、圆角 8px、`gap:5px` |
| `.tab-more-n` | **隐藏数量角标** | `min-width:16px;height:16px`、`--p-bg` 底 + `--p-dark` 字、11px/600 |
| `.tab-more-menu` | 溢出**下拉本体** | `position:absolute;top:34px;right:0;min-width:180px;max-height:320px;overflow-y:auto`、`z-index:40` |
| `.tab-more-mask` | 点外部收起 | `position:fixed;inset:0;z-index:30` |

**六条硬规则**：

1. **点一个开一个、累积**（不是"切页"）—— 标签 = 打开历史；同 `path` 同 `query` 视为同一个，**不重复开**。
2. **⟳ 刷新在名称左侧**、`×` 关闭在右侧。刷新语义**两分**：**当前标签** ⇒ 刷新计数 +1、组件重建；
   **非当前标签** ⇒ 先切过去（切换本身即重建）⇒ 不需要额外刷新手势。
3. **关掉当前标签去左邻**；**关尽最后一个 ⇒ 回首页**（`/workbench`，并立刻开出「经营工作台」标签）。
4. **上限 18**，超出淘汰**最久未激活**的（`at` 最小者），**永不淘汰当前标签**。
5. **内存态**：浏览器刷新 / 重登只还原**当前那一个**（由路由推出），**不落 localStorage** ⇒ 登出时 `resetTabs()`。
6. **手机端（≤768px）不出标签栏**（`display:none`），维持底部栏 + 抽屉；`@media print` 同样隐藏。

**布局约束 —— 内容区必须两层**（否则标签栏会跟着页面一起滚走）：

```css
.content{flex:1;min-width:0;display:flex;flex-direction:column;overflow:visible;background:var(--bg)}
.view-wrap{flex:1;min-height:0;overflow-y:auto;padding:20px}
```

> 🔴 `.content` 用 `overflow:visible` 而**不是** `hidden`：`.tab-more-menu` 是绝对定位的溢出下拉，
> `overflow:hidden` 会把它**裁掉**（下拉永远看不见）。溢出兜底由既有的 `.body{overflow:hidden}` 负责。
> 🔴 `<component :key="viewKey">` 的 `viewKey` **只含刷新计数、不含 `route.fullPath`** ——
> 含 `fullPath` 会让「页内切 `?tab=`」把整页组件重建、数据一起重拉（`Forecast.vue` 6000+ 行）。
> 跨 `path` 切换时组件类型本身就变了 ⇒ Vue 自然重建，无需 `key` 参与。

**标签标题：四层回落**（唯一源 = `constants/tabTitles.js` 的 `SUB_TITLES`）：

```
SUB_TITLES[path][query.tab] → SUB_TITLES[path]._default → PAGE_RULES[path].title → meta.title / pageTitle
```

> 🔴 **`pageTitle` 必须排在 `PAGE_RULES[path]` 精确命中之后**：`pageTitle` 走 `ruleFor`（**逐级去尾**）
> ⇒ `/inventory/purchase` 会继承 `/inventory` 的「进销存」，导致**三个子页标签同名**。
> 这是 v396 探针抓出的**真缺陷**（原实现直接用 `pageTitle`，采购单/销售单/库存查询全叫「进销存」）。

**URL 归一**：`/rebate` ≡ `/rebate?tab=dashboard` —— `openTab` 按 `DEFAULT_SUB_KEY[path]` 注入默认子页，
侧栏高亮改用 `effTab(path, tab)` 比较 ⇒ 否则会开出**两条同名标签**且侧栏当前项不亮。

**退役纪律**（「模块内页签退役」的必需配套，缺任一环就把用户关在门外）：

| 缺了哪一环 | 后果 |
|---|---|
| 侧栏入口未升级（仍是直达项） | 子页**再也点不到** |
| 手机抽屉未摊平（`EXPLODED_PATHS`） | 手机端标签栏不出 ⇒ 子页**在手机上永久失联** |
| 只删模板、留下 `TABS`/`goTab` **死代码** | 下一轮改的人以为它还在生效 |

> 参照实现：`/rebate`「目标与返利」由**直达项升级为职能区**（两组共六条）；`/loss-accounting` 补「货损填报」。
> ⚠️ `.main-tabs` **并没有全站消失** —— `ProductArchive.vue` 编辑弹窗的 4 个表单分区页签**保留**
> （那是**表单分区**，语义仍属 §2.5 的页内 Tab，不是模块导航）。

**验收**：真机探针 `.workbuddy/tools/v396-tabbar-probe.mjs`（13 相位，生产实测 **PASS 50 / FAIL 0**）。
判据必须含：点一开一**累积**、关尽**回首页**、`≤768px display:none`、溢出「更多」**真的渲染出行**、零写请求。
> ⚠️ 探针自身两个坑（都出过**假红**）：**别硬编码标签索引**（按标题找）、**别硬编码标签条数期望**（以上一步实测值为基线）。

**静态一致性自检**（改了本节或 `TabBar.vue` 后必跑，防规范与实现脱节）：
`.workbuddy/tools/v396-spec-tabbar-consistency.py --strict` —— A 类名 / B 数值 / C 机制 / D 反例禁令，当前 **ALL PASS**。

---

## 4. 交互与状态

| 状态 | 规范要求 |
|---|---|
| **默认** | 走全局件，不覆盖尺寸/圆角/阴影 |
| **hover** | 按钮换底/换色；卡片升 `--shadow-md`；可点文本加主色下划线 |
| **focus** | 输入框 `border-color:--p-dark` + `box-shadow:0 0 0 3px var(--p-bg)`。**禁止 `outline:none` 后不补替代** |
| **禁用** | `cursor:not-allowed` + 降对比；**必须给 `:title` 说明为什么不能点** |
| **加载** | 按钮 `:disabled` + 文案切换（「保存中…」）；区域用「加载中…」文字或 `.skeleton` |
| **错误** | ① 字段级：`.input.err` + `.field-err` 文案 + `aria-invalid` + `aria-describedby`；② 若错误分散在多个 Tab，另加**可点击跳转的错误汇总条**；③ `toast` 只作为兜底，**不能是唯一的错误呈现** |

### 4.1 弹窗（对话框）

必须同时满足：

1. `role="dialog"` + `aria-modal="true"` + `aria-labelledby`（指向标题元素 id）
2. `tabindex="-1"` + 打开后把焦点移入弹窗
3. **Esc 关闭**
4. 有未保存改动时**不得直接关闭**（遮罩点击是误触高发区）⇒ 走内联二次确认
5. 结构：`.xxx-modal-hd`（标题 + 关闭） / `.xxx-modal-body`（可滚动） / `.xxx-modal-ft`（操作区）

> ⚠️ **规范现状**：全站尚无统一 Modal 组件，各页自建（8+ 份）。
> 在抽取组件前，各页至少要做到上述 5 条与圆角/阴影/层级令牌一致。

### 4.2 二次确认

**优先内联**（第一次点击变成「确认 X」+「取消」），不叠第二层弹窗 ——
本项目已在「停用商品」「放弃改动」两处采用，效果良好。

---

## 5. 可访问性（最低要求）

1. 弹窗：dialog 语义 + Esc + 焦点管理（见 §4.1）。
2. 必填字段：`aria-required="true"`；视觉星号要 `aria-hidden="true"`（不要念出来）。
3. 校验失败：`aria-invalid="true"` + `aria-describedby` 指向错误文案 id。
4. 复选框/单选**成组**时：容器加 `role="group"` + `aria-labelledby`
   （用 `role=group` 而非 `<fieldset>`：后者在 flex/grid 容器里渲染不一致）。
5. 全局提示（toast）容器：`aria-live="polite"`；错误类用 `role="alert"`。
6. 对比度：说明性文字 ≥ 4.5:1（即至少 `--t2`）。
7. 图标按钮必须有 `aria-label` 或 `title`。

---

## 6. 命名与文件组织

### 6.1 命名

| 对象 | 约定 | 示例 |
|---|---|---|
| 令牌 | `--类别-变体`，全小写连字符 | `--p-dark`、`--fs-sm`、`--z-modal` |
| 全局类 | **无前缀**的语义名 | `.btn` `.card` `.input` `.main-tab` |
| 页面私有类 | `<页面缩写>-` 前缀 | `pa-`（商品档案）、`df-`、`cc-` |
| 状态修饰符 | `.on` / `.err` / `.warn` | `.main-tab.on`、`.input.err` |

### 6.2 铁律

> 🔴 **同一视觉语言不写第二份。**
> 某个页面私有类一旦被**第二个页面**需要，就必须上提到 `variables.css` 全局层。
> 抄一份 = 静默漂移（本项目在 `.btn-danger`、`.btn.on`、弹窗样式上均踩过）。

### 6.3 文件组织

```
src/styles/variables.css   全局令牌 + 全局组件层（唯一）
src/components/*.vue       跨页复用组件（自带 scoped 私有样式）
src/pages/*.vue            页面（scoped 私有样式，只允许出现本页前缀的类）
docs/UI-SPEC.md            本文件
```

**页面 scoped 样式里只允许出现本页前缀的类**；出现无前缀的通用类 ⇒ 应上提。

---

## 7. 验收与自测

### 7.1 类差集审计（每次新增大块 UI 后必跑）

模板用到的类 − 样式里定义的类 = 差集，**必须为 0**。

```python
# 思路：抽 <style> 段（去注释）取 .xxx 定义集；抽模板（去注释）取 class="..." 内类集；求差集
# 实例见 /tmp/pa_class_audit.py（style 段起始行必须动态定位，别硬编码）
```

> 🔴 2026-09-22 实测：商品档案「编辑商品」弹窗有 17 个类零定义，
> 整块新功能退化为浏览器默认样式，而构建零报错。

### 7.2 全局层改动的自查

1. 是否新增了令牌？→ 同步更新本文件 §1。
2. 是否新增了全局类？→ 同步更新本文件 §2。
3. 是否修改了既有选择器？→ 列出受影响页面（全局层是共享的）。
4. 页面上是否有同名字面量值？→ 一并替换为令牌。

### 7.3 文档 ↔ 源码「标识符」审计（v396 补）

§7.1 管的是「**模板** vs **样式**」；这条管「**文档** vs **源码**」——
规范里的 DOM 契约、类名、常量名是**给人照抄的**，写错一个字，下一轮的人就抄错一个字。

**血泪例子**：v396 写本节 §3.5 的 DOM 契约时**凭印象**写了 `.tab-more-pop`，
而源码里是 **`.tab-more-menu`**（连带 `.tab-more-btn` / `.tab-more-n` / `max-width:200px` 也一并漏了）。
文档看上去"挺完整"，但按它抄**一定抄不出东西**。

```python
# 脚本：.workbuddy/tools/v396-spec-tabbar-consistency.py（§3.5 ↔ TabBar/Shell/useTabs/tabTitles）
# 抽文档里引用的类名（.xxx）− 抽 src/**/*.{vue,css,js} 里出现的类名 ⇒ 差集必须为空
# 再塞一个不存在的类名做**反例**，证明这套判据确实有判别力（否则恒真）
```

**已有的两份一致性自检**（改完规范/实现后跑，`--strict` 有 FAIL 即 exit 1）：

| 脚本 | 管什么 |
|---|---|
| `.workbuddy/tools/v395-spec-shell-consistency.py` | §3.4 侧栏浮层面板 ↔ `Shell.vue` |
| `.workbuddy/tools/v396-spec-tabbar-consistency.py` | §3.5 全局标签栏 ↔ `TabBar.vue` / `Shell.vue` / `useTabs.js` / `tabTitles.js`（A 类名 ／ B 数值 ／ C 机制 ／ D 反例禁令） |
| `.workbuddy/tools/v400-spec-colcfg-consistency.py` | §2.6.1 列设置入口与序号列 ↔ `Forecast.vue` / `Icon.vue` / `variables.css` / 两个进销存列表页（A 类名 ／ B 数值 ／ C 机制 ／ D 反例：零 emoji 齿轮、齿轮源码恰好 2 处、`defaultColOrder` 不含 `seq`、**菜单不得写死 `top:38px`**） |

> ⚠️ **判据自身两个坑**（v396 首版 13 项假红，只有 1 项是真缺陷）：
> ① **规范侧的期望串不要带反引号** —— 文档里多个值常合写在一个反引号对内
> （`` `display:flex;align-items:center;gap:6px;padding:6px 20px` ``），要求「独立反引号对」会假红 10 项；
> ② **反例禁令必须跑在剥掉注释的源码上** —— `pageTitle(path)`、`main-tabs` 都在**注释**里出现，
> 裸 `in` 判断会被注释满足 ⇒ 判据恒真/恒假。

> 🔴 **扫描范围必须含 `src/styles/*.css`**：只扫 `components/*.vue` 会**假报缺失**
> （`.tab-pane` 定义在 `variables.css:594`）—— 同「搜不到先排除搜错了范围」。
> ⚠️ 文档里的**通配写法**（`.sb-pop-*`）会让正则抓出伪影 ⇒ 正则须排除 `*` 与词内连字符。

**同样适用于**：常量名（`MAX_TABS` / `EXPLODED_PATHS` / `SUB_TITLES`）、
函数名（`effTab` / `showInDrawer` / `evictOldest`）、以及**引用的具体数值**（上限 18、`max-height:320px`）。
**引用了什么，就逐字 grep 一次** —— 这是「判别串逐字取自源码」在**文档侧**的对称要求。

### 7.4 页面留白（占宽比）真机只读审计（v399 补）

§3.1 的「占宽比」不能靠读 CSS 心算（`.page-default{max-width:1200px}` 到底有没有生效、
外壳 `padding` 有没有叠加，只有浏览器知道）。判据是**几何**，就用几何去量：

```bash
# 脚本：.workbuddy/tools/v399-layout-gap-probe.mjs（只读真机 https://hergent.cn，零写入）
V399_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
  /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
    .workbuddy/tools/v399-layout-gap-probe.mjs
```

**它必须自带判别力自证**（否则"全绿"没有意义）：同一轮里同时量「基准页（预期 ratio≈100、`maxWidth=none`）」
与「进销存页（预期 ratio<95、`maxWidth=1200px`）」，**两组必须不同**；相同即 FAIL。
判据固定取 **1920 视口**（1440 下差额只剩 8px，测不出问题）。

### 7.5 列设置与序号列的几何真机只读审计（v400 补）

§2.6.1 里「齿轮在序号列表头」与「序号在齿轮正下方」**不是能读 CSS 心算出来的** ——
谁是第一列、sticky 有没有生效、菜单到底锚在哪，只有浏览器知道。判据是**几何**，就用几何去量：

```bash
# 脚本：.workbuddy/tools/v400-col-cfg-probe.mjs（只读真机 https://hergent.cn，零写入）
V400_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
V400_EXPECT=impl \        # impl = 现况事实（默认）；spec = §2.6.1 理想契约
NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
  /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
    .workbuddy/tools/v400-col-cfg-probe.mjs
```

**两相位 = 判据的判别力自证**：同一条量在 `impl` 取 **v400 改前现况**期望、在 `spec` 取**本节契约**
（现在时）期望，两相位结果必须**不同**。v400 时是「`impl` 36 PASS / 0 FAIL、`spec` 恰好红 2 条」；
**v401 修完后反转**为「`spec` 全绿、`impl` 红那 2 条」—— 方向变了，但**两相位仍必须不同**。
若两相位都给全绿 ⇒ 判据是**恒真**的，跑出来的"通过"没有意义。

> ⚠️ **v401 起判红的相位变了**：查回归认 `spec`（它量的是本节的现在时）；
> `impl` 是**历史基线**，它在「齿轮居中」/「菜单不遮挡齿轮」这两条上**应该**是红的 ——
> 红正是在证明这两处已经修掉了。

**它同时证伪了三件事**（用反例，不是用正面例）：
① 全表**只有 1 个**齿轮（第 2 列表头不得有）；② 齿轮内是 **SVG**（`textContent` 为空、
不含 U+2699 / U+FE0F ⇒ 不是 emoji）；③ 列设置清单里**没有**「序号」项。

**量到的原始几何**（1920 视口，查看态）：序号列宽 **46px**（= `colgroup` 的 `col0=46px`，
与第 2 列 210px 形成判别力对照）；齿轮 y[525..545] ↔ 序号 y[594..613]（**垂直分离**，
证明确实是"上方表头 / 下方表体"而不是同一行）。

---

## 8. 业务模块范式（参考实现：进销存）

> 本节登记**模块级**的共用范式 —— 不是新令牌、新全局类，而是「一个新业务模块该怎么搭」的口径。
> 参考实现 = 进销存（`src/pages/inventory/`，九文件，v392 上线）。
> **本节全部数据来自 2026-10-07 对源码的实测**，不是设计意图。

### 8.1 页面结构：容器 + 三件套

一个模块 = **1 个容器页 + 每个实体 3 个页面**：

| 角色 | 例（进销存） | 路径 |
|---|---|---|
| 容器（页签 + 子路由出口） | `InventoryShell.vue` | `/inventory` |
| 列表 | `InvPurchaseList.vue` | `/inventory/purchase` |
| 新建 | `InvPurchaseNew.vue` | `/inventory/purchase/new` |
| 详情 | `InvPurchaseDetail.vue` | `/inventory/purchase/:id` |

**容器规则**（`InventoryShell.vue` 的注释即契约）：

1. **容器自己就是 `.page`**，子页**只给页头与内容**、不再套 `.page`
   ⇒ 避免 `.page` 嵌套（padding 叠加），也就不需要 `:deep(.page){padding:0}` 这类补丁。
2. 页签用**全站唯一的 `.main-tabs` / `.main-tab`**（§2.5），不许再写第二份。
3. **页签由路径推导**，不用本地状态 ⇒ 刷新 / 深链 / 浏览器前进后退都自洽。
4. **下钻页不挂页签**（新建/详情留在所属页签下）——再挂一个页签 = 把「一次任务」拆成两个并列入口。
5. `path: ''`（空串）索引子路由**必需**（否则访问 `/inventory` 命中空路由）；
   且父级**不得** `redirect` 指向自身（自指重定向 ⇒ 无限循环）。
6. 带参数路由（`:id`）**必须排在**同前缀静态路由（`new`）**之后**，否则 `/new` 被 `:id` 吃掉。

**容器 ↔ 子页 宽度契约（v399 补）**：

- **容器只给 `.page`，不给宽度档位。** 单据 / 表格密集模块（进销存就是）一律**全宽**，
  口径见 §3.1。⚠️ `InventoryShell.vue` 原写 `.page.page-default` ⇒ 8 个子页全部被压在
  1200px 居中（1920 视口左右各空 216px），这正是「单据界面大量留白」的唯一根因。
- 子页根（`.inv-page`）**零宽度声明**（只 `display:block`）⇒ 容器改宽度时子页自动跟随，不用动 8 个文件。
- 子页**也不给左右内距** —— 内距只由 `.view-wrap` 给一层（§3.1 硬规则 1）。
- **一个模块只能有一处给 `.page`**，不许两处都给（会嵌套叠加）：
  - **厚壳**（`InventoryShell.vue`）：容器自带 `.page`，子页只给页头与内容 —— 进销存走这条；
  - **薄壳**（`ArchiveShell.vue`，全文件只有 `<router-view/>`）：容器不给 `.page`，由各 tab 页自带 —— 档案管理走这条。
  两种都合规；**判据是"全模块给 `.page` 的地方恰好一处"**，而不是选了哪种壳。

### 8.2 页面前缀分配

页面私有类一律带前缀（§6.1）。**进销存的实际分配**（一页一个，不许复用）：

| 页面 | 前缀 | 页面 | 前缀 |
|---|---|---|---|
| `InvWorkbench` | `iw-` | `InvSaleList` | `isl-` |
| `InvPurchaseList` | `ip-` | `InvSaleNew` | `isn-` |
| `InvPurchaseNew` | `ipn-` | `InvSaleDetail` | `isd-` |
| `InvPurchaseDetail` | `ipd-` | `InvStock` | `is-` |
| 跨页（容器级） | `inv-` | | |

> 🔴 **前缀冲突实例**：`.is-acts` 同时定义在 `InvSaleList.vue` 与 `InvStock.vue`。
> 两边都是 scoped ⇒ **不会互相覆盖、也就不会报错**，但改一处不会同步另一处
> ⇒ 这正是 §6.2 所说的**静默漂移**。新增页面时**先查前缀是否已被占用**。

### 8.3 状态与文案：词表是唯一源

1. 🔴 **界面上一律不出现英文枚举**。后端可能返回 `received` / `partial` / `self_pickup`，
   界面必须显示「已入库 / 部分入库 / 自提」。
2. 词表**唯一来源** = `src/constants/psiLabels.js`（每张表都对着后端 CHECK 约束核过）。
3. 取值只走两个函数，页面**不许自己 `switch`**：

   ```html
   <span class="tag" :class="tagOf(PO_STATUS, r.status)">{{ textOf(PO_STATUS, r.status) }}</span>
   ```

   - `textOf`：未知值**不静默留空**，回落「未知」（后端加新状态时界面看得出来）。
   - `tagOf`：返回 `.tag` 的修饰类（`ok` / `warn` / `bad` / `info` / 空 = 中性）。
4. **状态徽标 = 全局 `.tag` + 词表**，页面不再自造徽标类。
5. **阈值由后端给**：效期档位用接口返回的 `thresholds`，**不在前端写死 30 / 90**
   （写死就是第二份实现，必漂移）。
6. 金额显示**唯一实现** = `psiLabels.js` 的 `fmtMoney`，页面只 `import`。
   > 教训（v392b，**上线后真机才抓到**）：它原被**七个页面各抄一份**，唯独
   > `InvPurchaseNew.vue` 漏抄 ⇒ 模板调 `fmtMoney` 时运行期抛 `TypeError` ⇒
   > **整页被兜底替换、连带父容器的页签一起消失**，而**构建 / 路由探针 / 枚举检查 /
   > 文案审计四道全绿**。⇒ 一条规则只留一个实现；「同一规则抄多份」的漏抄那份以**整页崩**的形式爆。

### 8.4 复用全局件与已知欠账

八页**大量复用既有全局件**（实测用量：`.card` 25、`.page` 17、`.btn-primary` 14、
`.state-empty` 15、`.table-wrap` 9、`.kpi-strip` 1、`.main-tabs` 2）。

🔴 **进销存全模块零新增全局令牌、零新增全局类** —— 实测 `variables.css` 无任何
进销存痕迹。这符合「页面私有类不必上提」的边界，是**正面样本**。

> ⚠️ **但重复件是反面样本（已知欠账，本轮只登记未整改）**：下列三类**逐字相同**却各页各写一份，
> 已满足 §6.2「被第二个页面需要就该上提」的条件：
>
> | 候选全局类 | 份数 | 重复定义值 | 出现处 |
> |---|---|---|---|
> | `.page-acts`（页头右侧操作区） | **9 处 / 8 名** | `display:flex;gap:8px;flex-wrap:wrap`（**7 处逐字相同**；`.iw-acts` 多 `align-items:center`；`.pa-actions` 为 `gap:10px`） | 进销存 8 页（`.is-acts` 被两页各定义一次）＋ `ProductArchive.vue` |
> | `.page-pager`（列表分页条） | **3** | `flex;align-items:center;gap:8px;justify-content:flex-end;padding-top:12px;flex-wrap:wrap` | `.ip-page` / `.isl-page` / `.is-page`（**逐字相同**） |
> | `.page-filter`（筛选容器） | **3** | `flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px` | `.ip-filter` / `.isl-filter` / `.is-filter`（**逐字相同**） |
>
> 🔴 **新增判据**（本次实测归纳，与 §1.6 阴影那条同源）：
> **同一选择器的定义在站内出现 ≥ 3 次（且逐字相同）⇒ 必须上提为全局类**；
> 仅 2 次且未来可能分化 ⇒ 可暂缓，但须在本节登记。

---

## 9. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-09-22 | 首版。基于 2026-09-22 商品档案 UI 审查建立；同批补齐层级/字号/间距令牌、`.btn-danger`、输入禁用与只读态、表单错误态，并新增 Tab 面板/次级卡片/复选组/价格矩阵等可复用件。 |
| v367 | 2026-10-02 | §1.6 新增**页面特型阴影例外清单**；§1.7 新增 **§1.7.1 页面级浮层档**（11 档令牌 ＋ 全局层/页面层分界 ＋ 迁移纪律）。配套代码：`Forecast.vue` 18 处 z-index 字面量 → 令牌、`.spark-th` 补居中、`.btn-retry` 补危险底（新令牌 `--danger-solid`）、`App.vue` 错误类补 `role="alert"`。⚠️ 本文件该次补档**当时未提交**，2026-10-07 并行会话停止后补提交。 |
| v392 | 2026-10-07 | 新增 **§8 业务模块范式（参考实现：进销存）**：容器+三件套、前缀分配、词表唯一源、`.tag` 徽标纪律、`fmtMoney` 唯一实现、复用件清单与**重复件欠账表**；修正 §3.2 示例**误用页面私有类 `pa-actions`**（规范示例自己违反 §6.3）；新增「同一选择器出现 ≥3 次即须上提」判据。 |
| v395 | 2026-10-08 | 新增 **§3.4 侧栏一级项浮层面板（横向分列）**：分组 = 列、列宽自适应、列标题置顶+分隔线、`maxWidth` 防溢出、移动端维持纵向、**读图必须走 OCR 不许转述**、同页多入口三环节连锁（`navTo.q` / `isCur` 逐键比 / `key` 带 `q`）与「入口必须真筛选」纪律、几何判据 + 反例自证的验收法；并登记 `.sb-pop` 的 `z-index` 未令牌化这一欠账。配套代码：`Shell.vue`（模板 + `.sb-pop-*` CSS + `_placePop`）、销售/采购列表与新建页读 URL 预置、新增 `pages/Print.vue`（打印列占位）。 |
| v396 | 2026-10-08 | 新增 **§3.5 全局标签栏**：两种语义辨析（模块内页签 =「这个模块有哪些页」vs 标签栏 =「我打开过哪些页」）、DOM 契约与类表、六条硬规则（点一开一累积／⟳ 在名称左／关尽回首页／上限 18 淘汰最久未激活／内存态不落 localStorage／手机端不出）、内容区两层与 `overflow:visible` 的必要性、`:key` 只含刷新计数、**标签标题四层回落**（`pageTitle` 逐级去尾 ⇒ 三个子页同名，探针抓出的真缺陷）、URL 归一 `effTab`、**退役纪律三条**；并修订 **§2.5 页内 Tab 用途收窄**（只用于弹窗内的表单分区）。配套代码：新增 `components/TabBar.vue` / `composables/useTabs.js` / `constants/tabTitles.js`；改 `Shell.vue`（内容区两层 + NAV 升级为职能区 + 手机抽屉 `EXPLODED_PATHS`）与 5 个页面（`inventory/InventoryShell` / `Archive` / `Print` / `Rebate` / `LossAccounting`）退役页签条。同批新增 **§7.3 文档↔源码「标识符」审计** 与**静态一致性自检**（`v396-spec-tabbar-consistency.py`：A 类名 / B 数值 / C 机制 / D 反例禁令，ALL PASS）；登记 **`/forecast` 为唯一过渡态**（页内页签暂留，勿照抄）。验收探针 `v396-tabbar-probe.mjs` 生产实测 50/50。 |
| v399 | 2026-10-08 | 重写 **§3.1 为「页面容器与留白（统一留白规范）」**：以 `/forecast`（本期预报，实测占宽比 100% / 左右 0px）为**唯一基准**；建立**四层留白模型**（L0 侧栏 → L1 `.view-wrap{padding:20px}` → L2 `.page`（默认全宽）→ L3 `.card{padding:18px}`）；三条硬规则（页根不再加左右内距／默认全宽不套档位／页根禁写 `max-width`·`margin:0 auto`·左右 `padding`）；**例外白名单**（唯一使用者 `Print.vue` `.page-default`；`.page-reading` 无使用者）；新增**占宽比**量化判据与「必须在 ≥1600 视口取值」的说明。新增 **§7.4 留白真机只读审计**（`v399-layout-gap-probe.mjs`，含判别力自证）；**§8.1 补「容器 ↔ 子页宽度契约」**（容器只给 `.page` 不给档位／子页零宽度声明／**一个模块只能有一处给 `.page`**，并辨析厚壳 `InventoryShell` vs 薄壳 `ArchiveShell` 两种合规形态）。配套代码：`inventory/InventoryShell.vue` 去 `.page-default`（**8 个子页留白的唯一根因**）、`ZhoupuImport.vue` 去掉自拍 `max-width:960px;margin:0 auto` 与叠加的左右 `padding`；`variables.css` 修正两处**与实况不符**的「档位当前未启用 / 目前全站无页面启用」注释为写实况。生产探针 17/17 PASS（改前基线 A 面已留档）。 |
| v400 | 2026-10-08 | 新增 **§2.6.1 列设置入口与序号列（统一约定）**：先**确认现有实现**再立规 —— 基准实现 = `/forecast` 的 `.cross-tbl`（查看态）/ `.edit-tbl`（改单态）。① **列设置 = 表头第一列（序号列）里的 `<button class="col-cfg gear" title="列设置"><Icon name="settings"/></button>`**：**线性 SVG 齿轮（2 段 path、`stroke:currentColor`、`fill:none`），不是 emoji 齿轮（U+2699 / U+FE0F）**；无边框 / 透明底 / 默认 `--t3` / hover `--bg3` + `--p-dark`，只走令牌（深色自动跟随）；查看态与改单态**共用**一个 `showColMenu`。② **序号 = 同列表体**（`td.seq-cell > .seq-num`）**落在齿轮正下方**：1 基连续（`it.seq` / `ri + 1`）、跟随筛选分组重排、`tabular-nums` 等宽数字、列宽权威源 = `<colgroup>` `colW('seq')` **46px**（可拖宽；`.seq-th`/`.seq-cell` 里的 `42px` 是**不参与布局的陈旧值**）、`sticky left:0` 且表头 `z-index:9` > 表体 `6`。③ 序号列**不在列设置清单里**（不可隐藏/拖序/删除 —— 它是齿轮宿主，藏掉会连入口一起消失）。④ **适用范围与触发条件表**（可编辑网格/逐行核对清单**必须**有；卡片/表单/短 KPI 表不需要）；「要齿轮就必须同时有序号列，反之不然」。⑤ 全站现状实测：`col-cfg`/`seq-th`/`seq-cell`/`seq-num` **只在 `Forecast.vue`**，其余 28 个含表页面尚未接入 ⇒ 本节是**全站约定**。⑥ **登记两处已知偏差**（待对齐，非文档错）：齿轮未居中（序号比齿轮**右偏 4px**，成因 `.th-in{justify-content:space-between}` + 单子元素）、列设置菜单**不从齿轮下方弹出**（锚在工具条 `.col-config-bar` 的 `top:38px;left:0`，**Δt=−15px 压在齿轮上**）。配套：新增探针 `v400-col-cfg-probe.mjs`（**两相位** `impl`=现况 36 PASS/0 FAIL、`spec`=契约恰好红那 2 条 ⇒ 判据非恒真；含三条反例自证）、新增 **§7.5** 几何审计说明、新增一致性自检 `v400-spec-colcfg-consistency.py`（A 类名 ／ B 数值 ／ C 机制 ／ D 反例：零 emoji 齿轮、齿轮源码恰好 2 处、`defaultColOrder` 不含 `seq`、全站零复用）。**本轮只立规范、未改实现**（两处偏差留待决策）。 |
| v401 | 2026-10-08 | **修 v400 登记的两处偏差 ＋ 序号列上提全局 ＋ 试点接入**。① **偏差①齿轮居中**：查看态补 `.th-in > .col-cfg{margin-inline:auto}`（根因 `space-between` ＋ 单子元素 ⇒ 被顶到左边）；改单态是 `<th>` 直接子元素、本就居中，未动。② **偏差②菜单锚定齿轮**：`.col-menu` / `.edit-col-menu` 由 `position:absolute;top:38px;left:0` 改 **`position:fixed`**；位置改由新增的 `toggleColMenu(e)` 按齿轮 `getBoundingClientRect()` 现算 —— 默认正下方 `gap:6px`、下方越界上翻、右侧越界先右对齐再贴边（`pad:8px`）；**并配 `maxHeight` 限高**（按上下可用空间取大侧、优先下方，保底 160px）—— 首版**只移位不限高**被真机探针当场抓出：清单实测高 **543px**、可用空间仅 ~520px ⇒ 上翻与贴底**都放不下**、仍盖住齿轮；首帧用兜底尺寸（320）摆位、`nextTick` 按真实尺寸校正；`window` 的 `scroll`（**捕获阶段**）与 `resize` 直接收起；两态共用这一份逻辑（`showColMenu` 唯一）。③ **序号列 CSS 上提**：按 §8.4「≥3 次且逐字相同 ⇒ 必须上提」，新增全站唯一源 `variables.css` 的 `table.tbl .seq-th / .seq-cell / .seq-num`（列宽**统一 46px**，删除 `Forecast.vue` 里 `42px` 陈旧副本三条）；`.cross-tbl` 的 `sticky` / `z-index` 冻结规则**保留在页面**（宽表特有，不上提，也不给只读清单）。④ **试点接入**：`InvPurchaseList.vue`（7→8 列）与 `InvSaleList.vue`（8→9 列）加序号列，取值 `offset + i + 1`（**跨页连续**，offset/limit 分页）；**只加序号、不加齿轮、不加 sticky**。⑤ **文档**：§2.6.1 六处同步（① 补居中、② 列宽改 46 并加唯一源 CSS 块、③ 菜单改 `fixed` ＋ 定位表、⑤ 现状改「试点已接入」、⑥ 偏差改「v401 已修」并说明 `spec`/`impl` 相位反转）；§7.3 自检行更新（扫描面加 `variables.css` ＋ 两页、D 类新增「菜单不得写死 `top:38px`」）；§7.5 补相位反转说明；§9 本行。⑥ **验收**：一致性自检 `v400-spec-colcfg-consistency.py` 改写后 **ALL PASS**（D4 拆两族：`.col-cfg` 仍只 Forecast；`.seq-th`/`.seq-cell`/`.seq-num` 唯一源 = `variables.css` 且只被两页复用；新增 **D6** 菜单定位契约 = `fixed` ＋ **剥注释后**不写死 `top:38px`/`left:0`，含反例自证 D6f）；真机探针 `v400-col-cfg-probe.mjs` **两相位互补**：`spec`（现在时）**53 PASS / 0 FAIL**、`impl`（v400 基线）**53 PASS / 2 FAIL**（恰红「齿轮未居中」「菜单遮盖齿轮」⇒ 相位反转成立、判据非恒真）；新增 **P7** 试点页断言（采购 8 列 / 销售 9 列：表头「序号」＋ `.seq-th` ＋ 46px ＋ 居中 ＋ 首行 = 1 ＋ **非 sticky** ＋ 零写入）全绿。部署 `dist-v401b` 增量覆盖（**不带 `--delete`**，回滚点 39 个与 `backups/` 完好），双侧 md5 一致。 |
| v402 | 2026-10-08 | **序号列铺开至全站 ＋ 全局选择器扩 `seq-host` ＋ 抓出并修 scoped 同分覆盖**。① **铺开**：按「四、」判据给 **21 页 / 25 张清单表**加序号列 —— A 组标准 `table.tbl`（档案 6 页 / 库存查询 / 单据详情与新建 5 页 / 返利 3 表 / 货损工作流 / 算工资 / 定时任务 / 历史期次 / 报单配置），B 组非 `.tbl` 自定义表 5 张（`pc-tb`×2 / `pt-tbl` / `br-tbl` / `la-ml-tbl`）。取值按各页**真实分页方式**：`i + 1` ／ `offset + i + 1` ／ `(page - 1) * pageSize + i + 1` ／ `cpOffset + i + 1`。空态行 `colspan` 同步 +1（报单配置 9→10、商品价格 5→6、商品目标 10→11）。② **全局选择器扩 `seq-host`**：各页自定义表**不能改挂 `tbl` 类**（会与自身 `.xx-tbl td{padding:…}` 同分相撞、按源码顺序互相覆盖、破坏排版）⇒ 新增**无样式的中性标记类** ⇒ 选择器写 `table.tbl … , table.seq-host …`。③ 🔴 **真机探针抓出的真缺陷（首轮 FAIL 5 页）**：`.seq-th` 的 `text-align:center`（连 `padding`）**被页面 scoped 样式同分覆盖** —— Vue scoped 给 `.xx-tbl th{text-align:left;…}` 补 `[data-v-xxx]` ⇒ specificity 从 (0,1,1) **升到 (0,2,1)**，与原先的 `table.seq-host .seq-th` **(0,2,1) 同分**、而页面 CSS 后加载 ⇒ 后者胜（表头左对齐、列宽 50≠46）。**修法** = 选择器写成 `table.seq-host th.seq-th` / `td.seq-cell` ⇒ **(0,2,2)** 稳压 scoped 的 (0,2,1)，**与加载顺序无关**。④ **探针**：新增 `v402-seq-probe.mjs`（21 页逐个走生产：表头「序号」＋ `.seq-th` ＋ 46px ＋ 居中 ＋ 首行 = 1 ＋ 零写请求；无数据页报 **SKIP** 而非 FAIL，并打印页内表清单供人工确认）。⑤ **既有瑕疵（非本轮引入，取证留档）**：`POST /api/rebate-rules/simulate-batch` 是**纯试算不落库**，却**未登记**后端 `_READ_ONLY_POST`（名单里只有名字相近的 `/api/rebate-contracts/simulate`）⇒ 后端仍按 `create` 鉴权、`sales` 无 create 的角色会 403 ⇒ 探针把它排除但**显式报出条数**。⑥ **验收**：语法校验 21/21、隔离构建 `dist-v402b`、增量部署（**不带 `--delete`**，回滚点 41 个）、双侧 md5 一致；真机探针 **PASS 145 / FAIL 0 / SKIP 3**（SKIP = 无数据空态：返利无规则 / 工资未核算 / 货损未跑）。⑦ 有意不铺的 7 类页面见「五、C」（表单录入 / 诊断表 / 权限表 / 看板短表 / 弹窗明细 / 审计说明表）。 |
