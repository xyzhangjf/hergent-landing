# 前端 UI 规范 / 对标 WorkBuddy

## 读 WorkBuddy 真实 UI 规格（不要凭印象）

WorkBuddy 桌面端是 Electron，**渲染层已解包在磁盘**，可直接读原始 CSS：
`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/web-ui/assets/`
（主样式 `index-*.css`，Tailwind 压缩成单行；主包 `index-*.js`）

```bash
P=/Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3
C=".../web-ui/assets/index-DESzSkbX.css"
$P -c "import re;css=open('$C').read();[print(r[:300]) for r in re.findall(r'[^{}]+\{[^{}]*\}',css) if 'composer' in r.split('{')[0]]"
```

- 输入框组件类名前缀 = **`composer-*`**（`composer-stack/card/textarea/toolbar/tools/trailing/add/send/chip/seat-chip/usage`）。
- 若必须解析 `app.asar`：头部结构 = `UInt32LE@0`(size) / `UInt32LE@4`(headerPickleSize) / `UInt32LE@8`(jsonSize) / `UInt32LE@12`，**JSON 从 offset 16 开始**（早期误以为 12 会解析失败）。但优先找 `.unpacked/`，通常已解包。

## WorkBuddy Composer 实测规格（参照基准）

| 元素 | 值 |
|---|---|
| `.composer-stack` | max-width 780、padding 0 16px 8px、align-items center |
| `.composer-card` | flex-column、**gap 8**、padding-top 10、border 1、**radius 20** |
| `.composer-textarea` | **width 100%**、padding 4px 12px 0 16px、font 15/line-height 22 |
| `.composer-toolbar` | flex、**space-between**、gap 6、padding 0 8px 8px |
| `.composer-tools` | flex:1 1 auto、gap 2 |
| `.composer-trailing` | flex:none、gap 2 |
| `.composer-add` / `-send` | **28×28、radius 999**（正圆） |
| `.composer-send:disabled` | **透明底 + `inset 0 0 0 1px` 描边环**、图标转次级色、opacity 1 |
| `.composer-chip` | 高 28、padding 0 8、radius 8、font 13/20、max-width 220 |
| `.composer-seat-chip` | min-height 28、radius 16（胶囊）、font 13/20、max-width 240 |

三条原则：① 文本与控件不争宽度（文本独占整行，控件下沉工具条）；② 工具条两端锚定（左=输入手段，右=提交动作）；③ 28px 是唯一尺寸基准（正圆用于纯图标，胶囊用于带文字 chip）。

## Hergent 副驾输入区 = Composer 两层结构（2026-09-11 落地）

```
.cp-composer      flex-column, gap 8, padding-top 8, radius 20, bg var(--bg3)
├── textarea.cp-input   width 100%, font 15/22, padding 9px 12px 9px 16px, min-height 40
└── .cp-toolbar         flex, wrap, space-between, gap 6, padding 0 8px 8px
    ├── .cp-tools       flex 0 1 auto, min-width 0, gap 2
    │   └── ＋ / .cp-role 胶囊 / .cp-guard-btn 权限 chip
    └── .cp-trailing    flex none, margin-left auto, gap 2
        └── .cp-voice / .cp-send
```

要点与坑：

- **`.cp-input` 左右 padding 必须对称**（`9px 12px 9px 16px` + `min-height:40px` + `INPUT_MIN_H=40`）。只给上 padding（`9px 12px 0 16px`）单行看着居中，**多行文本块会整体偏低 4.5px**。
- **控件统一 28px 正圆**（`.cp-plus/.cp-voice/.cp-send`）；角色胶囊 28 高 / radius 16 / max-width 220；卡片 radius 20。
- **发送键禁用 = 透明底 + `inset 0 0 0 1px var(--bd)` 描边环 + `color:var(--t3)`**，`opacity:1` —— 不要用 `opacity:.35` 整块变淡（语义是"不可发送"而非"按钮很淡"）；hover **不做 `translateY`**（会与相邻麦克风抖动）。
- **权限 chip 琥珀态用 `rgba(var(--war-rgb),.14)`**，不要用固定色 `#FAEEDA`（深色模式对比度崩）。
- **上传态收进 `.cp-atts` 成 chip**（`.cp-att-loading` + `.cp-att-spin` 旋转 Icon `loader`），不再在框外独占一行。
- 旧类名 **已废弃**：`.cp-input-wrap` / `.cp-foot-guard` / `.cp-uploading`。
- 框外只剩一行 `.cp-foot-hint`（快捷键提示）；`.cp-foot-guard` 已并入工具条左组。
- 角色下拉菜单 `position:absolute; bottom:calc(100% + 8px)` 相对胶囊；胶囊移入工具条后菜单会覆盖文本区，**不被裁剪**（`.cp-composer` 无 `overflow:hidden`），实测不越出抽屉左边界。

## ⚠️ autoGrow 与 resize（既有 bug，2026-09-11 修）

`autoGrow()` 只在 `@input` 触发。**窗口/抽屉宽度变化会改变折行数** → 不重算就**裁掉多出来的行**（窄屏下长句第二行被切）。

修法：`onWinResize()` 里在 early-return **之前**调 `autoGrow()`。

验证：1280 输入长句 → `set viewport 390`（**不重新输入**）→ textarea 高度应从 40 变 62，`scrollHeight <= clientHeight`。

## 验证技巧（真机）

- 「控件是否在同一水平中线」用 `new Set(centers).size === 1` 判定，比逐个目测可靠。
- 「文本是否居中于自身高度」量 **文本行框中心 = `top + paddingTop + lineHeight/2`**，与文本框中心比。
- 布局改完不能只测状态（单行/多行/极限/窄屏），**必须补测「尺寸变化路径」**——本次裁剪 bug 就是这样才暴露的。
- 局部放大定论用 `agent-browser screenshot "<selector>" <path>`，全屏截图目测不可靠。

## ⭐ 全站页面布局体系：全局组件层已存在，唯独 `.page` 缺失（2026-09-11 盘点）

**结论先行**：`src/styles/variables.css`（299 行）**已经是一套成体系的全局组件层**，但**页面最外层容器 `.page` 没被纳入**。

已有全局定义（重查时别再用 `grep '\.card\{'`——bash 里 `\{` 是 BRE 量词会误报，用 ripgrep 查 `^\.[a-z][a-z0-9-]*[\s,{]`）：
`.btn / .btn-primary / .btn-ghost / .btn-block / .btn-sm / .btn-icon`、`.tb / .tb-compact / .tb-group / .tb-sep`、
`.fld`、`.chip`、`.ico`、`.card`、`.input`、`.skeleton / .skel-line`、`.badge*`、`.progress`、
`.state-empty / .state-error`、`.table-wrap`、`table.tbl`、`.tag*`、`.panel-hd`。

**缺失**：`.page`、`.page-hd`、`.page-sub` —— 而 19 个页面全都写了 `<div class="page">`（有约定、无规范）。

**后果：三档宽度并存**（真机 1280 实测，`#/cron` `#/ai-hub` `#/rebate` `#/settings` `#/forecast` `#/dashboard` `#/workbench`）：

| 页面 | `.page` 规则 | 实际表现 |
|---|---|---|
| CronJobs | `.page{max-width:900px}` ← **漏了 `margin:0 auto`** | 900px **左对齐**，`gapLeft 20 / gapRight 112`（差 92px，远超滚动条 8px） |
| AiHub | `.page{max-width:980px;margin:0 auto;flex-column;gap:16px}` | 980px 居中（1280 下 980≈984 视觉无差；宽屏才显效） |
| 其余 17 页 | 无 | 全宽撑满内容区（`content` 只给 `padding:20px`，无 max-width 上限） |

**重复定义量化**：`.page-hd` 在 **16** 个文件各写一遍、`.page-sub` 在 **17** 个（内容几乎都是 `font-size:12px;color:var(--t3)`）；且 `.page-hd` **已经分叉**——`align-items:baseline;gap:10px`（Forecast/Workbench/LossWorkflow/ConnectCenter/Reconciliation）vs `align-items:flex-start;justify-content:space-between;gap:12px`（Employee/Product/CustomerArchive、RoleManage），AiHub 更特殊（用 `<b>` 18px 而非 `<h2>` 20px、`margin-bottom:2px`）。另外 CronJobs 用 `.panel-hd` + 自定义 `.sub`，是**第二套标题规范**。

**间距离散度**：`gap` 出现 12 种值（2/3/4/5/6/7/8/10/12/14/16/18px），`margin-bottom` 12 种；页面级纵向间距在 **16 / 18 / 20** 三个值之间摇摆（`margin-bottom:18px`×17、`margin-bottom:16px`×14、`gap:16px`×11、`margin-top:16px`×9）。

**⭐ 历史先例（说明这是复发型问题）**：`variables.css:211-216` 的 `.card` 注释明确记录过同类事故——
"此前 .card 不含内距，每个页面都得靠自己的具体类补……一旦新页面裸用 .card 就会漏掉内距、文字贴边（**设置模块即因此出过 bug**）"。
作者当时的处理是给 `.card` 加全局兜底 padding（靠 scoped 特异性 0,2,0 > 0,1,0 实现"覆盖不叠加"）。**`.page` 是同一个病，还没治。**

## ✅ L0/L1/L2 已落地（2026-09-11，用户选 C）

最终规范（`variables.css`，紧跟 `.ico` 之后新开「页面容器 / 页头（全局布局层）」段）：

```css
.page{margin-inline:auto}                                   /* L0 */
.page-reading{max-width:var(--page-reading)}                /* L1，令牌 900px */
.page-default{max-width:var(--page-default)}                /* L1，令牌 1200px */
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-hd.split{align-items:flex-start;justify-content:space-between;gap:12px}
.page-hd.flush{margin-bottom:0}
.page-sub{font-size:12px;color:var(--t3)}
```

- 档位令牌放 `:root` 的 `/* 布局 */` 段（`--page-reading:900px` / `--page-default:1200px`）。
- **应用**：CronJobs + AiHub → `class="page page-reading"`（AiHub 原 980 并入 900）；BidRadar `.br` 改 `var(--page-default)`（原硬编码 1180）；`split` 4 页 = CustomerArchive / EmployeeArchive / ProductArchive / RoleManage；AiHub `page-hd flush` + `<b>` 改 `<h2>`。
- **删重复 49 条规则定义 / 20 个文件**（16 `.page-hd` + 15 `.page-hd h2` + 1 `.page-hd b` + 17 `.page-sub`），另清 2 处硬编码宽度（CronJobs 删 `max-width:900px`、AiHub 摘掉交给档位类）。产物里 `.page-hd*` / `.page-sub` **全局各剩 1 份**。
- ⭐ **`.page-hd` 的两种形态由模板结构自动分派、无需加类**：`<h2>`+`<span>` 兄弟节点 = 内联同行；`<div>` 包裹 = 标题在上。同一套全局规则兼容两者。

### ⭐ 关键方法：先分「死 CSS」再动手（本轮最大的一次性收益）

对每个待去重的类，**同时统计「模板用量」与「CSS 定义数」**：

```bash
for f in src/pages/*.vue; do
  t=$(grep -c 'class="page-hd' $f); s=$(grep -c '^\.page-hd{' $f); echo "$f tpl=$t css=$s"; done
```

`模板=0 且 CSS=1` = **死 CSS**（页头早被重构掉、样式残留）。本轮 5 个页面（ConnectCenter / Dashboard / Forecast / Rebate / Workbench）的 `.page-hd`、2 个页面的 `.page-sub` 全属此类 → **删除零视觉风险**。跳过这步会把"删了也不知有没有影响"的活代码与死代码混在一起评估。

### ⭐ `.page-sub` 是跨组件公用类，不只在页面里

`src/components/rebate/*`（BrandTargetForm / MonthlySplitBlock）、`AiOps.vue` 的 `.panel-hd` 都在用 → 上提全局收益比"只是标题副标题"大；反之**去重时不能只按页面数估影响面**。

### ⚠️ 与 `:deep()` 的交互（改 `.page` / `.page-hd` 必查）

`Archive.vue` 与 `Forecast.vue` 用 `:deep()` 把被嵌入子页的容器/页头清零：

```css
.archive-panel :deep(.page){padding:0;margin:0}   .archive-panel :deep(.page-hd){display:none}
.config-panel  :deep(.page){padding:0;margin:0}   .config-panel  :deep(.page-hd){display:none}
```

编译成 `.archive-panel[data-v-x] .page-hd` = **0,2,0 > 全局 0,1,0** → 全局规则盖不过它，**无需改动**。真机已验：`#/forecast` → 点「报单配置」→ 内嵌 `.page` = `padding 0 / margin 0 / max-width none`、`.page-hd` = `display:none`，与改前一致。

🔴🔴 **修正（2026-09-13 真机 E2E 抓到，前端 `3b5813f` 已修）**：`display:none` 藏的是**整块页头**，
而各子页面的**操作按钮**恰好就在 `.page-hd`（`.split` 变体）里面 →
**商品档案的「补厂价 / 新增 / 导入 / 导出」、员工与客户档案的「同步」全部不可见不可点**，
自 2026-08-31 引入 tab 壳（`git blame 456881b`）起一直如此，**两个月没人发现**
（因为按钮区被藏后页面"看起来正常"，只是少了一排按钮）。
**修法：只藏标题块，保留工具条并右对齐** ——

```css
.archive-panel :deep(.page-hd) { display: none; }
.archive-panel :deep(.page-hd.split) { display: flex; justify-content: flex-end; margin: 0 0 12px; }
.archive-panel :deep(.page-hd.split > div:first-child) { display: none; }
```

⚠️ 通用教训：**`:deep()` 命中 `.page-hd` 时，先问这个类里除了标题还有没有别的（按钮/工具条）**。
"标题重复"这个视觉理由成立 ≠ 整块可藏。同类风险点：`.panel-hd` / `.br-head` / 任何 `*hd` 容器。

### 真机验证判据（本轮实测）

| 页面 | 改前 | 改后 |
|---|---|---|
| `#/cron` | 900px **左对齐** `gapL20/gapR112` | 900px **居中** `gapL66/gapR66` |
| `#/ai-hub` | 980px、标题 `<b>` 18px | 900px、`<h2>` 20px |
| `#/bid-radar` | 硬编码 1180 | `var(--page-default)`（视口内 984） |
| `#/roles` 等 4 页 | `space-between` | `split` 保持，右侧块 `rightInset 0` |
| `#/payroll` 内联式 | — | `dx10 dyBottom-4` = 同行基线对齐 |
| `#/data-fill` 堆叠式 | — | 标题在上、副标题在下（结构自动分派） |

⚠️ **判「标题与副标题是否同一行」不能比 `top`**：两者字号不同（20 vs 12），基线对齐下 `top` 天然差 7~8px，会误判成"换行"。要**比 `bottom`**（descender 差仅 ~4px）+ 比水平位置 `dx`。

### 本轮确认的两条边界（用户已认可方向）

- ~~`.page-hd` 覆盖 16 个页面，CronJobs 不用它 —— 用 `.panel-hd` + 自造 `.sub`（**第三套页头**，标题 14px）；`BidRadar` 用 `.br-head`（**第四套**）。两处未动（属视觉权重重设计，需单独确认）。~~ → **2026-09-11 晚已全部落地，见下节。**
- **不建议**造组件库（已有全局层，属过度工程）；**不建议**给全宽页面强加 max-width（ERP 表格密集，全宽合理）。

## ⭐ Bento 栅格 / KPI 概览条 = 全局布局范式（2026-09-11 晚落地）

**起因**：用户反馈「招投标雷达 / 定时任务 / AI 中心**大量留白**，要参照侧栏其它板块统一」。
真机 1920 量化（判据 = **页面宽 ÷ 内容区宽**）：

| 页面 | 改前占宽 | 改前左右留白 | 改后 |
|---|---|---|---|
| AI 中心 | **55%**（900/1624） | 362 + 370 | **100%**（左 0 / 右 0） |
| 定时任务 | **55%**（900/1632） | 366 + 366 | **100%** |
| 招投标雷达 | **74%**（1200/1624） | 212 + 220 | **100%** |
| 其余 17 个板块 | 100% | 0 | 100%（未动） |

→ **留白是结构性的**：这三页正是上一轮被归入「限宽档」的页面，宽屏下左右各空 362~370px。
⚠️ **必须在 1920 测**：1280 下 900px 限宽只差 42px、看不出问题；**用户屏幕宽，小窗口里测不出他看到的病**。

**范式来源 ＝ 经营工作台（Workbench）**：它早有「12 列栅格 + 顶部 KPI 横条」，但只写在 scoped 里。
**上提全局**（段落排在 `.card` **之后** —— 同 0,1,0 特异性靠源顺序压掉 `.card` 的 `padding:18px`）：

```css
.bento{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;grid-auto-flow:dense}
.kpi-strip{grid-column:1/-1;display:grid;grid-template-columns:repeat(var(--kpi-cols,5),1fr);padding:6px 0}
.kpi-strip.cols-3{--kpi-cols:3}          /* .cols-4 / .cols-6 同构 */
.kpi-strip .kpi{padding:8px 18px;border-right:1px solid var(--border-subtle)}
.kpi-label{font-size:12px;color:var(--t3);margin-bottom:6px}
.kpi-val{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.kpi-val.val-ok|.val-warn|.val-bad        .kpi-sub{font-size:12px;color:var(--t3)}
@media(max-width:1200px){ .bento{6 列}  .kpi-strip{3 列} }
@media(max-width:768px){  .bento{1 列}  .kpi-strip{2 列}  .kpi-val{18px} }
```

- **Workbench 内同名 scoped 规则全部删除**（scoped 0,2,0 会盖住全局），模板照旧用类名即可。
- 三页只加**占宽声明**、**不重排 DOM**：AiHub `rep7+quota5 / value5+insight7 / profile12`；
  CronJobs `jobs7+push5 / exec12`；BidRadar `br-main12`。
- 窄屏：1200px 下 `span 3`（6 列制的一半）；⚠️ **768px 1 列栅格必须把 `span N` 显式改回 `1/-1`**，否则出隐式列。
- **页头同步收敛**：CronJobs 弃 `.panel-hd`+自造 `.sub`、BidRadar 弃 `.br-head` → 一律 `.page-hd.split`。**全站页头至此只剩一套**。
- **档位类 `--page-reading` / `--page-default` 现全站无页面启用**（定义保留作未来阅读/表单型备位，注释已更新）。

### ⚠️ 硬坑：KPI 条的 padding 覆盖（只改全局无效）

`.kpi-strip` 压 `.card` 的 `padding` 靠源顺序，**但页面 scoped 若重定义过 `.card`**（AiHub 是
`.card{padding:16px 18px}`，scoped 后 0,2,0），全局 `.kpi-strip`（0,1,0）**盖不住** → KPI 条莫名多 16px 内距。
**解法：在该页 scoped 补一条 `.kpi-strip{padding:6px 0}`，且必须排在其 `.card` 规则之后。**

### 🐛 副产品：KPI 条会把「数据空洞」显形

新加的统计项若恒 0/空，**先疑前端漏字段赋值**，别当"没数据"。本轮：BidRadar `load()` 从未赋值
`meta.sources`（后端 `routers/bid_radar.py:178` 一直返回该字段）→ 筛选栏「全部来源」下拉**长期只有 1 项**、
KPI「数据来源」显示 0。修后 4 项（全国公共资源交易平台 168 / 军队采购网 113 / 中国政府采购网 74）。**非本轮引入。**

### 真机工具坑（2026-09-11 实测，已并入 skill `hergent-frontend-css-globalize`）

- `agent-browser **set** viewport 1920 1080` ✅；`agent-browser viewport …` → **Unknown command**。
- `screenshot --full <path>` ❌ 参数顺序错 → `[selector] [path]` 是**位置参数**，`<path>` 被当成 selector。
  用 `screenshot -f`（不给路径）或先 `set viewport 1920 2000` 再截整屏。
- 新版用**内置 Chromium**；设 `AGENT_BROWSER_EXECUTABLE_PATH` 会 `CDP response channel` 挂起。
  node 版本目录会随升级消失 → 包在 `.../node/workspace/node_modules/agent-browser/bin/agent-browser.js`，`node <该路径>` 直调。
- **改模板结构后验 `<div>` 配平**要用 `s.index('<template>')` ~ `s.rindex('</template>')`；
  用 `split('</template>')[0]` 遇内层 `<template v-if>`（如 SVG 并列图标）会截断 → 假 MISMATCH。

---

## 工具栏单行 / 容量补偿（v144 · v149）
- ⭐ **工具栏单行布局（v144，Forecast 主工具栏）**：双行（`.tb-head`/`.tb-right`，106px）→ 单行三段 **62px**：`.tb-ctx`（期次选择 / **新建期次** / 待审核徽标）| `.tb-data`（搜索框 导入 导出 复制报单）| `.tb-act`（AI智能建议 改单/工具箱），段间 `.tb-sep`；编辑态 6 个编辑按钮由 `.tb-edit-group{flex:0 0 100%}` 独占第二行并置于**最末**（最贴近表格）。**类名避开全局 `.tb-compact`**（`variables.css:201` + `Toolbar.vue` 已占用），用 `.tb-dense`。
- ⭐ **溢出菜单项提为常显按钮 → 必须做「容量补偿」（v149）**：`⋯`(32px) 换成常显「新建期次」(102px) = 段1 净增 70px，1280~1440 立刻折行。**补偿的取舍顺序（越靠前越不该动）**：① **收窄同一功能簇里的选择器**（期次选择器 220→150，与旧「220+32」占地 252 对齐，信息只影响收起态显示、下拉里仍是全文）② **隐藏装饰分隔条**（`.tb-sep` 无信息，省下 2px 宽 + 12px 外边距 + 2 个 gap）③ 收紧 1px 段间距 ④ 最后才考虑动按钮标签/状态徽标。**按钮文字、按钮间距、搜索框宽度是用户明确在意的，不要拿它们换空间**。分档：≥1360 不动、<1360 才收紧（1280 档余量 +12px，非编辑态 1 行 62px / 编辑态 2 行 100px）。**遗留**：原 ⋯ 里的「关闭/删除期次」改由「历史期次」页行内按钮承担，但该页仅在 `Number(row.id) > 0` 时渲染。
- 🔴 **算 flex 会不会折行，必须把子元素 margin 算进去**：`need = Σ(子元素宽 + marginLeft + marginRight) + gap×(n−1)`。只累加 `getBoundingClientRect().width` 会漏掉 `.tb-sep` 的 `margin:0 5px/3px`（两条 12~20px）→ 脚本报「余量 +8px」而真机**照样折行**。同理 `flex-shrink` **挡不住 wrap**：换行判定只看 hypothetical main size（= flex-basis 受 min/max 夹取），要不换行只能压 `max-width`。
- ⚠️ **媒体查询限宽必写全限定名**：`@media(...){.sel-period{max-width:150px}}` 会被源序更后、特异性相同的通用 `.sel-period{max-width:220px}` 覆盖 → 必须写 `.toolbar .sel-period`。
- ⚠️ **单行可行性估算三坑**：① `clientWidth` **含 padding**（真实内容宽 = −32）；② `.tb-sep` rect 宽 1px 但实占 ~27px；③ **必须模拟最坏值**（select 选中后撑到 max-width）—— 演示账号无期次数据，占位态量出的余量假性充足（v142 漏判 1440 折行 59px）。
- ⭐ **"作用对象就近"是工具栏瘦身第一手段**：单行放不下别硬塞/图标化 —— 把**只作用于某子区域**的控件下移到该区域的工具行（v144 把「仅显示有报单/品牌▾/已隐藏 N」移到表格卡片顶部 `.grid-ctl-row`，该行原只放缩放控件 → 1280–1920 全单行且**表格卡片高度不变**）。⚠️ **跨视图全局控件不能下移**（搜索框 `findText` 在汇总表/逐单补录/编辑态/导出都生效）。
- ⭐ **mock 复刻测量只能定方案、不能替代真机验收**：mock 会掩盖真实 CSS 缺失（曾漏 `flex-wrap` → 真机 1280 溢出 55px），按钮宽度也与 mock 有差（余量 58 vs 105px）。真机免登录入口 = 登录页「先看看演示效果（免注册）」→ `#/workbench` → 侧栏 `a[href="#/forecast"]`。
- 复核脚本：`.workbuddy/tools/toolbar-newperiod-fit.js`、`toolbar-single-row-verify.js`、`toolbar-newperiod-func.js`、`toolbar-newperiod-shot.js`。

## 浮层层级 / 组件细节
- ⭐ **浮层层级基准（2026-09-13 更新）**：toast **9999** / 空闲超时 9998 ＞ **模态层 1125(overlay)/1130(modal)**（`.imp-*` 导入弹窗、`.al-*` 别名弹窗等所有 Teleport 到 body 的页面模态）＞ 天气面板 `.wx-pop` **1121**（页面内浮层天花板）＞ 工具栏触发按钮 `.tb-pop` **1120** ＞ `.tb-pop-panel`/`.col-menu` 1101、`.edit-col-menu` 1102 ＞ `.pop-overlay` 1100 ＞ 右键菜单 1090/1091 ＞ 全屏表格 1000 ＞ 副驾抽屉 `.copilot` **950** / 遮罩 `.cp-overlay` 940。
  **三条硬约束**：① **页面局部层不得超过 950**，修法=打开时降级本页超高 z-index（`copilot-on` + `.page.copilot-on .tb-pop{z-index:auto}`），**不要抬高抽屉**；② **模态必须 ≥ 1125**（`.tb-pop` 常态 1120 也在根层，低于它就会被工具栏按钮盖住、遮罩一并失效可点穿）。**别靠"页面弹窗"这个旧名推值**，旧值 980/990 就是这么错的；③ **Shell 级全局模态同基准** —— `.pf-mask` **1130**、`.cmd-mask` **1130**、移动端 `.md-overlay` **1125** / `.md-sheet` **1130**（v136 修正，原 1000/1000/900/901）。⚠️ `.pf-mask` **不是** body 直属（在 `.shell` 内），但 `.shell`/`.body`/`.content` **全无 context**（`pos:static`，或 `relative` 但 z-index auto）→ 同样在**根层**直接比大小。
  ⚠️ **例外＝顶栏内浮层**：`.tb-menu`/`.tb-menu-mask`(40/50) 位于 `.topbar`（`z-index:10`+`backdrop-filter` 双重 context）内，**改 z-index 无效**，根治只能 Teleport。**现状已实测为缺陷**（预报页菜单开启时工具栏 1120 按钮压住其全屏遮罩 → 点按钮不关菜单），**待修**。
- ⭐ **浮层被压住先查祖先 stacking context，别调 z-index（v146）**：`header.topbar` 同时带 `z-index:10` **与** `backdrop-filter` → 双重创建 context，其内 `.wx-pop` 的 z-index 被压成**等效全局 10**，而页面内 `.tb-pop`=**1120**。**创建 context 的条件不止 z-index：`backdrop-filter`/`filter`/`transform`/`isolation:isolate`/`opacity<1`，以及 flex item 的 z-index（即使 position:static）**。修法 = `Teleport to body` + `position:fixed` + JS 定位（`placePop()` 居中夹边）+ `ResizeObserver` 重居中 + **`onClickOutside` 必须补浮层自身 `contains` 判定**。验收靠 `elementFromPoint` **命中测试翻转**，不是看数字。天气面板 z-index=**1121**。完整流程见技能 `hergent-frontend-zindex-diagnosis`。
- ⚠️ **容器宽由最长子项决定时，短内容行不能两端对齐（v145）**：`.wx-pop` 是 `width:max-content`，被下方 14 天卡片行撑到 **922px**；首行内容仅 170px → `space-between` 留 **826px 空洞**。**判据：行内容跨度 < 容器内宽 60% → 一律左起连续排列**。
- ⭐ **信息层级减负：收起态只留「高频两个量」（v145 天气按钮）**：原 图标/城市名/温度/描述 4 项、148px（城市名宽度随内容浮动 → 宽度不稳）；改为**只留 天气图标 + 温度**（75px，与相邻 `.tb-copilot` 等宽），城市名/描述/定位来源迁入展开面板首行，按钮补 `aria-label`。**判据：位置、描述这类「恒定不变或需要时才看」的信息不该占收起态位置**。新图标入 `Icon.vue` 时注意组件只渲染 `<path>`、**不支持 `<circle>`**（圆要拆成两段弧拼闭合路径）。
- ⭐ **焦点反馈要挂在「有边框的那一层」**：外胶囊（`border+radius+padding`）内含 `border:none` 的 input 时，内层仍继承全局 `.fld:focus` 的 `box-shadow:0 0 0 3px var(--p-bg)` → 光晕不贴胶囊。修法 = 内层 `.fld:focus{box-shadow:none}` + 外层 `:focus-within{...}`（对齐 `.cp-composer`）。**`border:none` 管得住 border-color，管不住 box-shadow**。已修 `.tb-search`×2。
- ⭐ 真机验证**必带 `?cb=<ts>`** 穿透缓存；**别用 `offsetParent` 判弹窗可见**（`position:fixed` 恒 null）；`<script setup>` 顶层 `watch([a,b,refX],fn)` 会 TDZ → 用 getter；vite dev 缓存造假象 → `pkill -f vite && rm -rf node_modules/.vite`；**沙箱拦 build 的 rmSync(dist)**（safe-delete shim，阈值 50 文件）→ 正解 = `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build`。
- 侧栏高亮取 `router.resolve(to).matched` **最后一项**（`resolve()` 不跟随 redirect）；带子页面模块须「父 record 有 component（薄壳 `<router-view/>`）+ 子路由」。弹窗「点外部关闭」用 `document.addEventListener('pointerdown',fn,true)` + `closest()`，**不要用 fixed backdrop 子元素**。

## 天气 / 节假日组件
- ⭐ **法定节假日 = 三层数据源，已做成每年自动更新（v148）**：① 后端 `GET /api/weather/holidays`（**免鉴权** —— `/api/weather` 在 `_PUBLIC_PATHS` 且判定是 `any(path.startswith(p))` **前缀匹配**）→ ② 前端远端层（localStorage，TTL 12h）→ ③ 内置静态表 `src/utils/cnHolidays.js`。数据源 `NateScarlet/holiday-cn`（GitHub raw 主 / jsDelivr 备，`papers` 带国办通知原文链接）。**查询优先级 = 内置表命中即用内置**（精修层：远端取不到「法定当天」与「除夕」，故 2026 行为 100% 不变）；未命中才用远端（label 取假期首日）；都无 → null 不标。**归属以通知原文为准**（2026 的 9/20 上班挂国庆节、不是中秋）。
- ⭐ **前端 utils 里用 `ref` 承载远端数据**：`cnHoliday()` 在 computed 中被调用 → 读 `remote.value` 自动建立依赖 → 拉取成功后日期行**自己重算**，无需「版本号 / tick」hack。失败静默且**不清空已有数据**。
- ⭐ **小角标（休/班、红点、计数）定位要锚在文字元素本身**，不要锚卡片：`.wx-d-dt{display:inline-block;position:relative}` + 徽标 `right:-10px;top:-6px` → 与文字只 0~1px 细边、与相邻行零重叠。锚卡片会让徽标落到上一行；徽标尺寸不得超过它标注的字号（13px 徽标配 10px 日期会压住末字）。遗留：趋势线悬停浮层仍用「周X」标签、未带节日名。

## ⭐ 「时间进度 vs 达成进度」双轴范式（2026-09-12 落地于返利仪表盘 + 冲刺看板）

同一语义已在两处使用，新页面要用就直接复用这套：
- **数据**：`timeProgress = 过去月 1 / 未来月 0 / 当月 now.getDate() ÷ 该月总天数`（`new Date(yy, mm, 0).getDate()` 取总天数，mm 为 1-based）。**月份口径必须与该处的业务归属一致** —— 仪表盘用所选月份，冲刺看板用「本期到货月」(`sprintAchvMonth`)，绝不能各写一套。
- **虚线标记**：`position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed var(--war);z-index:2;pointer-events:none`，`left: frac*100%`。仪表盘 `16px` 条（`.rr-bar-mark`）、冲刺表 `12px` 条（`.sp-bar-mark`）。
- ⚠️ **虚线必须挂在「不裁剪」的父层上**：`.progress`/`.rr-bar` 都带 `overflow:hidden`（圆角填充需要）→ 虚线放**外层 position:relative 容器**里，父层不能有 overflow:hidden，否则 ±3px 延伸被裁掉、6px 的条只剩 1 段 dash 根本读不出来。
- **着色**：达成 ≥ 时间进度 = `green`（超前），否则 = `red`（落后）。扩全局 `.progress` 家族时补一条 `.progress.red>i{background:var(--dan)}`（已有 green/amber）。scoped 样式里写 `.x .progress.red>i` 会被编译成 `.x .progress.red>i[data-v-*]`，**`<i>` 在本文档模板内渲染 → 生效**（若 `<i>` 来自子组件则须 `:deep()`）。
- **文案**：`本月时间进度：40%`（整数百分比，用户指定格式），`<b>` 用 `var(--war)`；`frac` 为 0 或 1 时（过去/未来月）**不画虚线**（同仪表盘 `tpShown`），否则虚线会贴在条的左右边缘像边框。
- ⚠️ **同一个 flex 行里只能有一个 `margin-left:auto`**：两个并存会**平分空隙**，把中间撑出大片空白。要新增一个右对齐元素时，把原按钮的 auto 改成条件式（`:style="cond ? null : 'margin-left:auto'"`），保住无数据态的回退对齐。
- ⭐ **判断「加高进度条会不会改变行高」不要估算，实测**：本表行高 41px 由 `td padding:10px` + 文字行盒 `13px/20.8px` 决定，把条高从 6px 试到 16px **行高恒为 41px** → 加高是零成本的。条高 6px 时虚线不可读，12px 后清晰（参照仪表盘 16px，但密集表格取 12px）。
- ⭐ **着色判据必须两处一致（v151 修）**：曾出现「冲刺看板绿、返利排行青」的不一致 —— 返利排行原用**三态语义**（已达标 `ach>=1` 绿 / 预警 `!willHit` 红 / 其余青），与「按时间进度着色」是两套判据。修法：返利排行新增 `paceCls = timeProgress > 0 ? (ach >= timeProgress ? 'pace-ahead' : 'pace-behind') : ''`，条形只讲**节奏**；「已达标 / 预警 / 推进中」下沉到**行内 tag + 行边框**（仍由 `level` 驱动），信息不丢。色值本来就同源（`--suc` #34c759 / `--dan` #ff3b30）—— 排查这类"颜色不一样"要**先比色值、再比判据**，十有八九差的是判据。
- ⚠️ **`timeProgress <= 0`（所选/到货月尚未开始）不着色**：否则 `ach >= 0` 恒真 →「0 达成也判绿」。两处都要这个守卫（`sprintBarClass` 里 `if (!(tp.frac > 0)) return ''`，返利排行 `timeProgress > 0 ? ... : ''`）。
- ⚠️ **两处的达成口径仍不同源**：返利排行 `ach = 已填报 / 月目标`，冲刺看板 `ach = (已填报 + 本期预报贡献) / 月目标` → 同一品牌可能连数字都不同，进而颜色不同。要不要并轨属产品决策，别默默改。

## ⭐ 区块 / 功能标题命名规范（2026-09-12 v152 定）

- 🔴 **「排行」是危险词**：只有当**真的按某指标降序、且第一名最优**时才可用。反例：`目标与返利 → 仪表盘` 原叫「返利达成排行」，实际按**风险优先**排（`risk → ontrack → done`，同级达成率升序、**越危险越靠前**），与"排行榜"的默认预期相反，序号 ①②③ 又强化了"这是第 1 名"的误读。**判据：若一个标题需要旁注来解释排序方向，就是标题没把语义说清** —— 该区图例 note 当时不得不补「自上而下风险最高」正是自证。
- 🔴 **改名先做"撞车检查"**：本产品里 `目标与返利` 同时是**侧边栏导航名 + 路由 meta 页标题 + 页内主 Tab 名**，并被 8+ 处正文引用（如 Forecast 提示语「去『目标与返利』创建目标」）；同页另一 Tab 叫 `达成填报`，已占用"达成"。→ 任何"X与Y"结构的新名（如「返利与达成」）都会与模块名**同构且语序颠倒**，指代直接糊掉。**改名前 grep 候选词在「导航 / Tab / meta / 正文」四处的占用**。
- ⭐ **同页区块标题求字数齐**：该页统一 6 字 —— 本月关键指标 / 全年月度达成 / 返利目标达成。对齐字数既统一节奏、也让宽度可预测（6 字 ≈ 78px @13px/600，实测）。
- ⭐ **去掉形式词，留内容名词**：本页全是内容名词短语（无"榜/排行/列表"这类形式词）。改名后本页再无孤例。
- **不构成同质可排名集合时别叫"排行"**：该列表混排品牌/商品维度、金额/数量口径（¥900,000 与「/件」），达成率横向比高低业务含义有限 —— 它是**逐目标健康度清单**，不是排行榜。
- **代码内部 class 名不必跟改**：`.rank-hd` / `.rank-row` / `.dash-rank` 用户不可见，跟着改只增 diff（本次保留）。
- 改名同步范围：面向用户的标题必改；**引用旧名的注释要一起改**（否则以后 grep 旧名还能搜到、且后人以为还有个叫"排行"的区块）。当前 `Rebate.vue` 标题相关注释已同步，仅保留 3 处历史事故描述（"失真排行"等）不动。

## ⭐ 页面「冗余文案 / 冗余字段」审查法（2026-09-12 落于返利仪表盘全页审查）

- **别凭截图印象，量出来**：真机遍历 `卡片下所有 `children.length===0` 的叶子节点`，得到**文案节点数 / 总字数**，再对每个区域 `getBoundingClientRect()` 拿宽高与 band 高度。本次基线：仪表盘 **103 节点 / 755 字 / 9 条解释性说明**；列表 5 行 811px、单行 148px（标识 24 / 条形 16 / 指标 20 / 判语 38）。**有了数字，删多少、省多少 px 才可验证。**
- 🔴 **最硬的一类冗余 = 同屏同一个数字出现两次且不相等**（比"啰嗦"严重得多）：行右上 `110.0%` 与条形内 `100%`（后者被 `Math.min(100,…)` 截断）→ 用户必然追问"哪个对"。**审查时优先搜同名指标的第二处渲染。**
- 🔴 **说明性文案的数量 = 交互不直观的数量**。样板：KPI 行那句「始终统计全部品牌，不随下方图表的品牌筛选变化」之所以存在，是因为**品牌筛选控件长在图表卡内部、却静默作用于下方异常区与达成列表**。→ **删说明的最好办法是消除需要说明的设计**（把筛选提到页面级），而不是换个说法。**看到"XX 不随 YY 变化"这类说明，先去找耦合。**
- **同一视觉编码讲两次 = 一次白讲**：`虚线＝时间进度：超过＝超前／短于＝落后` 与列表图例三项（超前/落后/时间进度虚线）完全同义；`达成率＝合计达成÷合计目标` 在图例 note、筛选弹层 tip、KPI 角标各讲一遍。**每个解释只保留一处，且放在"需要它的那一刻"**（弹层/tooltip 优于常驻）。
- **解释性旁注的长度 = 主 UI 没说清的程度**。图例 note 达 442px、4 个分句（条形＝达成率／100% 即达标／口径＝所选月份／自上而下风险最高）—— 其中「100% 即达标」应由**100% 处的达标参考线**承担，「风险排序」应由排序本身承担。
- **摘要类区块的存续判据**：异常/预警区若只复述列表已有的问题（未填报、预计不达标），它就只是**需要用户二次核对的摘要**；唯一正当职责是"**发现列表发现不了的**"（同月重复目标、规则冲突）。**摘要与明细不一致时，用户会怀疑数据。**
- **判语从"整行"降级为"标签"是最大的单项收益**：把每行第 4 段（38px 的「超前时间进度 70.0 个百分点」/红底预警句）收成行内 chip → 行高 148→~104，5 行省 ~220px，而结论仍一眼可见。
- **"看着像冗余但别删"的清单要单独列**：口径免责声明（返利为预估非到账）、数据完整性披露（另有 N 条未计入本图）、预测值（预计月底仅达成 X%，与当前达成率不同源）、无替代来源的分母（生效目标数）。**过度精简会删掉风险披露。**

### 审查法的落地结果（v154，供下次直接复用）

- ⭐ **同数据复测是验收的唯一硬标准**：审查时用什么数据量的基线，落地后就要用**同一组造数**复测，否则"省了多少"无从对比。v154 实测：`103→81` 节点 / `755→459` 字 / `9→3` 说明 / 列表 `811→596px` / 单行 `148→104px`。
- ⭐ **"说明性文案 = 交互不直观"这条判据可直接换钱**：删掉 B1「不随筛选变化」说明的**唯一正确做法是消除耦合**（品牌筛选从图表卡内部抽成 `BrandFilter.vue` 提到页头 `.dash-ctl`），不是换说法。**抽组件比原地改文案更省**——原 `.bp-*` 一整套样式 + `Icon` 依赖可整块随组件迁走。
- ⚠️ **别删页头长句里的"跨页导航"，要下沉**：v154 页头那句「含预报贡献的实时达成见冲刺看板」删掉会丢入口 → 移到**达成列表标题行**（该区讲填报达成，冲刺看板讲含预报贡献的达成，同源对照），做成 `location.hash='#/forecast'` 的极短链接。**"移除"与"迁址"要分开判断。**
- ⚠️ **"画达标参考线"类建议要先算比例尺**：若条形宽度映射是 `min(100, x)%`，则 100% 恰在容器右边缘，参考线画不出来（视觉不可辨识）；要可辨识须把基准改成 `max(120%, 实际值)`，会改变**所有行**的条形长度。→ **这类"顺手加个标记"的建议，先验映射再动手，不可行就如实说明并由既有标签（已达标/预警）承载语义**，不要硬做。
- **`scope` / `tag` 去重的判据**（返利达成列表）：`scopeAll = !String(r.scope_name || r.scope_key || '').trim()`。有具体对象 → 只留对象名（`品牌/蒙牛` 是同义叠加）；对象为空 → 才用维度 tag「品牌」表达。

### 数字单位与"同屏双语"（v155）

- 🔴 **面向经销商的 UI，数字一律带中文单位，禁用英文缩写**：`70pp` → **`70 个百分点`**（用户明确指出"经销商看不懂"）。判据：**缩写只在有行业共识时才可用**（% / ¥ / kg 可以，`pp` / `mo` / `avg` 不行）。自检法：`grep -n "pp\b"`，并扫 `>xx<` 形式的模板文本节点里的 1~4 位拉丁字母。
- 🔴 **同一数值的"短版"与"长版"必须同源，否则悬停前后数字会变**：v154 曾让 chip 用 `Math.round`（`63pp`）、hover title 用 `toFixed(1)`（`63.5 个百分点`）—— 同一行两处各算一次，**同屏两种写法**。v155 合并为唯一来源 `vsTimePct`（整数不带小数点、非整数留一位），chip 与 title 共用同一个字符串。**规则：任何"为了紧凑再算一遍"的展示值，都是分叉隐患。**
- **口径文案可以"紧凑"，但代价要去实测**：chip 从 65px 涨到 107px（+42px），实测顶行盒高恒 24px（单行）、行高 102~104px 不变，在 1560/1440/1280 与"25 字规则名"压力下都未换行 —— 所以这个代价是**免费的**。**改文案宽度前先留出长名压力测试**（规则名 + 对象名同时拉长）。
- ⚠️ **窄视口行高异常先归因再改**：1140px 下一行 137px，看着像本次改动的锅；实际用"同一页面同一视口、只替换目标文案重量"对照即可证明新旧一致（明细行换行所致）。**归因手段：单变量替换 + 重量一次。**

### 删「状态表达元素」的判据（v156）

- 🔴 **删除前先问"它承载的信息有没有第二载体"**。返利行内的判语 chip（`超前 70 个百分点`）被删，成立的唯一理由是**同屏已有两个载体**：① 条形颜色（绿＝超前 / 红＝落后）+ 上方图例；② 数值本身可由同屏右侧达成率与 KPI 卡时间进度相减得到。**载体重叠是"删"的前提，不是"能看懂"的前提。**
- ⚠️ **删掉文字后若"颜色成为唯一载体"，必须补两件事**：① 覆盖**全部状态分支**（超前 / 落后 / 持平），不能只验一条 —— 演示租户常只有 0% 达成，只跑得到 behind；② 保留 **hover 文字路径**（把判语句子挂到条形 `:title` 上，并把原 chip 的 `cursor:help` 一起迁过去），否则色觉障碍用户失去唯一可读通道。
- 🔴 **两个百分数相减的单位是「百分点」，绝不能用 % 代替**（用户问过"用 % 行不行"）：`40%→110%` 跨 70 格，写「超前 70%」会被读成「超额完成 70%＝170%」或「相对超出 70%＝68%」——**同一句话差上百个百分点**，对账会出错。**自检：凡是"差值"类文案，看它是减法（百分点）还是比值（%），两者不可互换。**
- 🔑 **验"某元素已删除"必须 DOM 计数 + CSSOM 规则计数双验**：`document.querySelectorAll('.rr-pace').length === 0` **且** `[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.selectorText?.includes('rr-pace')).length === 0`。只验前者会漏掉"模板删了、CSS 忘删"的半成品（本轮实测两者都归零才算过）。
- **删组件连带清它的专属样式与光标**：`.rr-pace` 三态背景/边框/`cursor:help` 全部随模板一起删，并把 `cursor:help` 迁到新载体 `.rr-bar`。**"迁址"要连样式与光标一起迁，不能只迁 `title`。**

### 图表量纲：Y 轴选「率」还是「金额」（v161，`MonthlyAchvChart.vue`）

- 🔴 **"所有柱子一样高"先分清是 bug 还是设计**。v159 的 Y 轴＝达成率、灰轨道恒画 `0→100%` →
  柱高只反映完成百分比，**目标不同的两个月必然等高**；整年没填达成时 12 根灰柱完全一样。
  **判据：`hOf(1)` 与月份无关 = 轨道等高是设计；用户要"看出金额差距" = 必须换量纲。**
- 🔴 **Y 轴换成金额后，「销量 vs 返利」只能双轴** —— 两者量级差 1~2 个数量级；
  更硬的理由：切「按数量」口径时销量是**件**、返利是**元**，**物理上无法共用一条轴**。
  量程各自 `niceMax(全年 max(目标, 达成))`，刻度均分 5 段（niceMax 的基数 k∈{1,1.5,2,3,5,7.5,10} 除 5 仍整洁）。
- ⚠️ **双轴的固有观感陷阱：数值小却柱子高**（演示租户 8 月销量 110万 与返利 11万 恰好同高，
  因为它们各自量程的比值也恰好是 10）。三条对策缺一不可：① 图例写死轴与单位
  （`销量达成（左轴 · 万元）`，**单位要动态插值**，因为可能变 万元/元/万件/件）；② 轴刻度与轴名用**对应柱色**上色；
  ③ 网格线只按主系列刻度画、副轴另标短线（**不共网格**）。**并要在交付摘要里明说"两根柱的高矮不可互比"。**
- 🔴 **换量纲必须连带复查所有依赖旧量纲的 y 坐标**，本类改动最容易漏两处：
  ① **柱顶竖排标签会被裁掉**（旧量纲下柱子不可能顶到上限，新量纲下能 → 需要 `LBL_TOP` 下压兜底）；
  ② **"时间进度"这类横向参考线的语义变了**（率轴上＝时间百分比；金额轴上＝`目标 × 时间进度`，
     且多系列量程不同 → 每个系列各画一段自己量程的短线）。
- ⚙️ **量程为 0（整年无数据）不画轴、不画柱**：`niceMax(0)` 返回 1 会造出 `0/0/0/1` 这种假刻度。
  写法：`max > 0 ? niceMax(mx) : 0`，`axisTicks` 对 0 返回 `[]`。
- ⭐ **验收这种"几何 ∝ 数值"的改动，用真实组件 SSR 渲染断言最省**：
  `vite.createServer({server:{middlewareMode:true},appType:'custom'})` + `ssrLoadModule('**.vue')` +
  `renderToString` → 解析 `rect` 的 `x/y/width/height`。几何全在 render 期由 computed 算出，
  **与 DOM 环境无关，即 SSR 产物 = 浏览器最终值**；好处是**无需登录态、秒级、边界用例随便造**。
  ⚠️ 坑：`v-show=false` 的元素 SSR **照样输出**（带 `display:none`），按显隐过滤要自己判。
  ⚠️ 环境：脚本放在项目目录外时 node 解析不到 `vite` → 在 `/tmp/xx/` 建软链 `node_modules` → 项目 `node_modules`。
- ⭐ **逐月/逐项交叉验证的写法**：期望值不要硬编码，而是 ① 实时拉页面同源接口（如 `/api/rebate-rules`）
  ② 用**组件同一个纯函数**（`monthTargetOf` / `ruleActiveInMonth`）汇总 ③ 量程**从轴标签反推**
  → 三边独立（金额来自接口、量程来自轴、像素来自 DOM），任何一边坏了都测不出来。断言用 `console.table` 打逐月对照最直观。

### 多系列量级不可比时：双轴 vs 拆成上下多张单轴图（v162 定论）

**判据**：两个系列量级差 1~2 个数量级（或单位不同，如「万元」vs「件」）→ 只能各自量程。
此时**优先拆成上下多张单轴图，不要用双轴**：

| | 双轴合并 | 上下两张单轴图 |
|---|---|---|
| 跨月比较（主要诉求） | 同系列内可比 | 同图内可比 ✓ |
| **跨系列比较** | **不可比，且会误导** —— "金额小却柱子高"（返利 13.5万 的柱比销量 42.3万 的柱还高） | 仍不可比，但**"两张尺子"写在明处**（各自小标题带单位、副标题写明"柱高不可跨图比较"） |
| 版面 | 紧凑 | 高度约 1.5~2 倍 |

**拆图时三条硬约束（缺一条就会出问题）**
1. ⭐ **两张图必须由同一个数据描述数组驱动渲染**（`sections` computed + 模板 `v-for`，每项含预算好的
   几何 `rows`），**绝不各写一遍模板** —— 否则改一张忘另一张＝静默漂移，代码不报错、只有真机上数字不对。
2. **共享同一套 x 轴几何**（PAD / GW 全等）→ 月份列严格对齐；月份标签只在最下图出现一次。
3. **重复信息只留一处**：单位放小标题就别再放轴顶（相隔 20 余像素的重复纯冗余）；
   tooltip 位置要跟着 hover 到的那张图走（多图相距 200px+ 时固定贴顶会让视线跳远）——
   这类"常数与 CSS 逐字一致"的值（行高+gap、图间距）**必须写进注释**，否则改 CSS 时静默错位。
   另外：某系列整年无数据时给**等高占位**，别让那张图塌陷或牵连另一张。

**给元素留净空的量要用实测，不要估算**：竖排标签占位按"数字宽 × 字符数"估会**漏算汉字**
（`万` 是全宽 8.5px，数字才 ~4.7px）→ 估出的 `LBL_TOP` 偏小、真机上标签被画布裁掉。
`getBoundingClientRect()` 换算回 viewBox 坐标做断言最可靠（`preserveAspectRatio="none"` + `width:100%`
时 x/y 各自线性映射，可分别换算）。（竖排标签已于 v164 废弃，见下节；「实测优于估算」这条不变。）

⚠️ **`dispatchEvent(new MouseEvent('mouseenter'))` 后必须 `await` 一个 tick 再读 DOM** ——
Vue 更新走微任务，同步读拿到的是上一帧。这条会让"tooltip 是否出现"的断言**静默全跳过**
（`tip == null` 被 guard 吞掉 → 一条断言都不输出，看起来像通过）→ **验证脚本必须显式断言断言数 > 0**。

### ⭐ 柱顶数值标签：**一律横排，永不旋转**（v164 定论，`MonthlyAchvChart.vue`）

用户原话「竖排看着别扭」。竖排的代价被严重低估过：单图绘图区只有 **136px** 高，
而「金额·达成率」竖排标签竖向长达 **≈53px** → **一根柱就吃掉 39% 的可用高度**；
12 根并排 = 一堵「竖字墙」，且**中文数字混排竖读尤难**。

**放不下的正解是「拆两行」，不是「转竖」**：

| 画法 | 单行最宽 | 最窄视口（月槽 44px） | 结论 |
|---|---|---|---|
| 横排整串「1235万·129%」 | 53px | ❌ 溢出相撞 | 这才是 v162 当年转竖的**唯一理由** |
| **横排两行**（上行金额 / 下行达成率） | 33px | ✅ 余量充足 | ✅ v164 采用（用户选 B） |
| 横排单行（只金额） | 33px | ✅ | ✅ 更干净，适合"达成率已由柱形表达"时 |

- ⭐ 关键量化：`万` 是全宽 8.5px、数字才 ≈4.7px → **6 位金额「123456万」= 36.7px、半宽 18.4px
  仍 < 半月槽 22px** → 横排两行**在任何视口都不需要降级分支**。**别写"宽则横排、窄则竖排"**。
- 锚点：金额 baseline = 柱顶 − 18、达成率 = 柱顶 − 6（行距 12px）；竖向总占位 ≈26px，
  柱顶最高 `PAD.t = 34` → 上缘约 9px 净空 → **不需要"下压锚点"兜底**（旧版 `LBL_TOP=58` 已删）。
- 无目标月份**只出一行金额、不留空行**；下行 `.bar-lb-rate { opacity:.88 }` 微降调，让金额先被读到。
- 一律 `text-anchor="middle"` 对齐**柱心**（旧版挂在柱右侧，左右不对称）。

**回归护栏**：SSR 断言「全图 `rotate(` 零命中」——
⚠️ 但**必须先剥掉 HTML 注释**：Vue 开发模式编译会保留模板注释，注释里出现 `rotate(-90)` 字样就假失败。
真机侧再补「同图同行相邻标签水平零重叠 + 所有标签 `transform` 为 `null`」（实测宽屏间距 72.5px、窄屏 700px 仍有 19.5px）。

### ⭐ 柱状图 tooltip 落位：横向避让（v165，提交 `aa30973`）

🔴 **判据：让浮层"不挡住被指对象"，先算"对象占多大 / 浮层占多大"，再决定躲哪个方向 —— 通常只能横向躲。**
本例的量化：浮层 **210×138~170px**，而单图绘图区只有 **136px 高** → **纵向无论贴顶贴底都必压柱子**，
所以「挪到柱子上方/下方的空白处」在这个图里物理上不成立；唯一解 = **整只盒子挪到柱子左/右侧**
（贴柱缘留 8px 净空 → 与柱身 x 区间**零交集**）。旧版锚点是"整串从**柱心**右移 8px"，柱宽 44px
→ 每条提示吃掉柱身一条 **14px 宽竖条**（实测占柱面积 14%~32%）。

- 几何抽成 `src/components/rebate/tipPlacement.js`（纯函数）：`tipAnchor(柱心, 柱半宽, 画布宽)`
  → 右侧放得下走右、放不下翻左、两侧都放不下取空间大的一侧；`clampTipAnchor` 用**实测**宽高把盒子夹进画布。
- 组件里 left/top 一律 **px**（不用 `%` + 固定 transform 偏移）；落位后 `nextTick` 夹一次
  （与首帧补丁同帧微任务内完成 → **用户看不到跳动**）。
- **翻转用 `transform: translateX(-100%)`**：锚点从"左缘"变"右缘"，与盒子实际宽度无关 → 任何内容宽度都成立，
  也就不需要先量宽再定位（量宽只用于夹取）。
- 🔴 **`pointer-events: none` 是硬要求**：盒子挪到柱外侧后必然盖住**邻柱**悬停区（210px 盒子 vs 106px 月槽，
  覆盖 2~3 根无法避免），一旦吃掉事件就换不了柱。真机用 `page.mouse.move`（真实命中测试）验证换柱照常。
- 性能：`mousemove` 会持续触发，但**落位只与"哪一根柱"有关** → 组件里按 `key#i` 去重直接 return
  （否则每帧重算 + 重新测量）。
- 邻柱被盖住这件事**无解也不该藏**：如实告知用户"被指的那根本身零遮挡，邻柱 2~3 根在浮层后面（浮层比月槽宽）"。


## ⭐ 校验「标记」与「清单」必须同源（v175，`Forecast.vue`）

**症状**：清单里报了 7 条「条码重复」，表格里那 7 格**干干净净** —— 不是"标得不明显"，
而是**根本没标**。用户视角的表述是「标记跟清单对不上」。

**根因**：同一份校验规则被写了两遍 ——
- 格子标记 `cellInvalid()` 只调 `cellErrMsg()`（列类型 / 必填 / 数值域）；
- 清单 `validateAll()` 在 `cellErrMsg()` 之外**另扫了一遍条码重复**。
两处各自演化 ⇒ 条码重复只进了清单、没进格。

**收敛**：`cellIssue(ri, ci)` 作为「某一格有没有错、错在哪」的**唯一权威**，
红框标记 / `title` 悬停提示 / 查错清单三处全部走它；`validateAll()` 里那段单独扫条码的
代码随即删除。**判据：新增一条校验规则时，问"它会不会让格子变色"** ——
若答案与"它会不会进清单"不一致，就是第二份拷贝。

**性能硬约束**：行级校验（条码重复）要落到格子上，必须 **computed 预建
「行号 → 说明」索引**（`dupBarcodeAt`）。若在 `cellErrMsg` 里现扫全表，模板逐格渲染
会退化成 **O(N²×M)**。

**真机验收方式（关键）**：把「界面标记集合」与「清单集合」各自归一成
`(行号, 原因文本)` 做**双向**断言 ——
① 标了的格在清单里都有说法；② 清单里当前渲染行的条目在格子上都标了。
只断言单向会漏掉①这类「标了却不说为什么」。本页表格分页渲染，所以②要限定在
`allRows`（实际渲染行）内，否则跨页条目永远"缺失"。

### 出错位置怎样才算「醒目」（用户原话："红色字体放大显示，或红色边框/红框框选"）
`Forecast.vue` 实测通过的组合（正常格 12px / 黑字作对照）：
```
color:var(--danger-txt) !important      → rgb(220,38,38)
font-weight:700 ／ font-size:13.5px      → 放大 + 加粗
box-shadow: inset 0 0 0 2px var(--danger-txt)  → 2px 红内框（不用 border，不挤布局）
background: var(--danger-bg) !important → rgb(254,242,242)
```
- 🔴 **`!important` 是硬要求**：数量列的底/字色来自 `heatStyle(r,u)` 的 **inline style**
  （热力色），**inline 优先于任何类选择器** ⇒ 不写 `!important` 错误格会被热力色盖住，
  表现成「CSS 明明写了却没生效」。语义上**错误 > 热力**。
- **行号格也要标红**（`errRowSet` → `.seq-cell.row-bad`）：长表里先定位到「哪一行」，
  再落到具体格。
- 只加 `1px border` + 浅红底**不够**（v174 之前的旧实现）：数字仍是黑字、正常字号，
  长表里扫视时几乎不可见 —— 等于没标。

## ⭐ 表格冻结列的层级与偏移判据（v176，`Forecast.vue`）

给「本来不在冻结名单里」的列（序号列）加冻结时，**冲突面不止样式** —— 五条缺一即错位：

### ① 偏移必须单点定义，且取宽走权威列宽
既有冻结列已占着 `left:0`（只读表 `frozenKey` 默认 `'name'`）⇒ 新冻结列插在它前面，
**既有冻结列的 `left` 必须整体右移「一个新列宽」**，否则两列重叠。
- 用一个函数承载（`frozenShift(base)`），**6 个渲染点共用**（只读表 thead/tbody/表尾 +
  改单表 thead/tbody/表尾）—— 复制 6 份内联表达式必漂移。
- 🔴 **取宽必须走 `colW(key)`，不能抄 CSS 里的数值**：`table-layout:fixed` 的表格里
  `<colgroup>` 才是权威（`.seq-th{width:42px}` 是**陈旧值、不参与布局**，实际 46）。
  且该列宽**可被拖拽手柄改**（`startResize(e,'seq')`）⇒ 任何硬编码都会在用户改宽后错位。

### ② sticky 的底色必须不透明，且与既有冻结列同色
`sticky` 只改绘制位置，**透明底会把滚过来的内容透出来**。底色取既有冻结列**同一组变量**
（表体 `var(--bg)` / 表头 `var(--bg3)`）⇒ 读作**一个整体冻结块**，而不是给新列单染一条色带。

### ③ z-index：新表的表头必须**高过**既有 sticky 表头
既有：`thead th`=7 · `thead th.frozen`=8 · `.frozen` td=6。
同 z 且同在 sticky 下，**后出现者胜** ⇒ 横向滚过来的普通表头会盖住新冻结的列头。
新列表头取 **9**、单元格取 **6**（与 `.frozen` 同级）。
**行状态无需在冻结规则里重复** —— 特异性天然胜出：`.cond-warn>td` 带 `!important`；
`.td.seq-cell.row-bad`(0,3,0) > 冻结规则(0,2,0)。

### ④ 🔴 表尾是**另一张 table**，`sticky` 在里面无效
`.col-total-bar` 靠 CSS 变量 `--foot-sl` 整体 `translateX` 跟随表体（它**自己不滚动**）。
位移对冻结列一视同仁 ⇒ 横滚时「合计」标签滑出左边界、冻结列下方显示的是**别的列**。
解法 = 给表尾冻结格一份**反向位移**：
`.col-total-bar .frozen,.col-total-bar .seq-cell{transform:translateX(calc(-1 * var(--foot-sl,0px)))}`
✅ **可否顺手修的判据：`--foot-sl=0` 时该规则是否为 no-op** —— 是，则静态外观零变化，可安全一并修。
⚠️ 其特异性 (0,2,0) 压过 `.col-total td{background:var(--bg3)}`(0,1,1) ⇒ 需单独再兜一条同底色规则。

### ⑤ 真机验收必须覆盖「改宽 / 关冻结」两个动作（只测滚动不够）
至少四判据：① 行内滚动前后新列 `left` **恒定**；② 拖宽新列后既有冻结列 `left`
**自动跟随**（证明没硬编码）；③ 把既有冻结列切成 `none` 后它应**整列滚走**
（此时断言「不与新列重叠」是**错的** —— 它本就该滚走，应断言「右缘 ≤ 新列左缘」）；
④ `elementFromPoint` 命中测试证明新列没被盖住（z-index 的硬证据）。


## 🔴 「归属」类显示不得复用「当前查看」的 ref（v180 实证，2026-09-16）

**范式**：一个 ref 同时承担两种语义 ⇒ 两个独立故障，且**第一个是死分支**（能通过代码审查、能通过构建、永远不报错）。

`Forecast.vue` 里有 `curPeriod`（期次下拉 / 往期「查看」都会改写它 = **用户在看的哪一期**），
而导入弹窗 pick 步要显示的「本期归属」= **后端会把数据落到哪一期**。
首版直接复用了 `curPeriod` 当归属，于是：

1. 🔴 **`impViewMismatch` 恒为 false** —— 它比较的正是 `curPeriod` 与 `cross.value.period.id`，
   而 `cross` 就是按 `curPeriod` 取的 ⇒ **同一个值比自己**。那段「你正在看的是 X，但导入会归到 Y」
   的提示**从上线起从未渲染过一次**，且不会抛错、不会有控制台警告。
2. 🔴 **切到往期「查看」时，归属被显示成那一期** —— 用户会以为"导入归到我看的这个期次"。

**修法**：另立 `curOpenPeriodId`，**只由 `GET /api/forecast/periods` 的 `current` 单向赋值**
（后端 `current = db.forecast_period_default()`，与 `import_router` 落库同源），
下拉 / 查看一律不碰它。并且**无条件赋值**：

```js
const cid = d.current ? Number(d.current.id || 0) : 0
if (d.current) curPeriod.value = cid
curOpenPeriodId.value = cid        // ⚠️ 必须无条件：期次全删时 current 变 null
                                   //    沿用旧值 ⇒ pick 步仍显示一个已不存在的「本期归属」，
                                   //    而导入实际落 0 —— 又是"显示与实际不一致"
```

**可迁移判据（三条同时问）**：
1. 这个显示量的**权威来源是谁**？能不能指出一行代码（而不是"某个 ref 恰好是那个值"）？
2. 有没有**第二个动作**在改写它？重命名为「A 视角」与「B 归属」后还共用吗？
3. 派生提示里的两个比较项，**是不是同一个 ref 派生的**？—— 是 ⇒ 该提示恒真或恒假，先删或先修，
   别去调它的 CSS/文案。

**验证方式（本轮靠它才抓到）**：不写单元测试，写**真机断言**——
B 组三条：`B1 存在可切换的其他期次`（前置）→ `B2 切下拉后归属文本不变` → `B3 归属名 == periods.current.name`。
首轮 B1/B2 是**假 FAIL**（探针命中了 `id=0` 占位项），用独立探针抓
`/api/forecast-submissions/summary?period_id=14` 的**真实请求**才定案功能正常、是我的测试错了。

---

## 「表格里的可编辑列」= 一条要同时收四件事的机制（v184b2 落地）

商品档案页的「到货周期」列、品牌列、厂价列都是同一形态。加一列时这四件事缺一不可：

1. **后端白名单**（`product_update.allowed` / `product_create.allowed`）—— **不放行就是
   静默失败**：`PUT` 过去的值被丢弃，HTTP 200、零报错、界面回旧值。这是该形态**最难查**
   的一环，动手前先去白名单里确认。
2. **校验 + 展示走同一份实现**（`src/utils/arrival.js`）—— 两处各写一份格式化 = **第二份
   拷贝 = 静默漂移**（改了 A 页忘了 B 页，同一商品两处显示不一致）。
   上界常量必须**前后端同值**（前端 `ARRIVAL_MAX` / 后端 `_ATD_MAX` / 路由层），
   改一处不改另两处 = 「前端放行、后端 400」。
3. **三态渲染**：`v-if="editingXxxId === p.id"` → input；`v-else-if="有值"` → 可点 span；
   `v-else` → 「未设/未录」可点 span。Enter + blur 双触发用
   `if (editingXxxId.value !== p.id) return` 去重。
   🔴 **空态文案要「表意」**：可操作入口不能只画一个「—」，得写「未设」/「未录」
   （破折号不告诉用户「点它就能设」）。纯展示列才用「—」。
   🔴 **空态用色要分性质**：缺厂价是**问题**（会被拒收）→ 琥珀；缺到货周期只是
   「未设置」→ 灰。用警示色标满屏 274 个空格子 = 盖掉真正要看的缺价提示。
4. **保存时「显式提供才写」**（若该页保存走 bulk-upsert）—— 见 `forecast-order-domain.md`
   的守卫段。**留空 = 不带该键**，否则每次保存都把别人设好的值清零。

### 🔴 探针侧：这一形态最容易踩的六个坑

| 坑 | 现象 | 正解 |
|---|---|---|
| **`Meta+A` 在 headless Chrome 失效** | 想输 5 得到 **45**（新字符**追加**到旧值后），界面/库都变 45 ⇒ 看着像「保存逻辑错了」 | **原生 setter + `input` 事件**驱动 v-model：`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, String(v)); el.dispatchEvent(new Event('input',{bubbles:true}))` |
| **`type="number"` 在 DOM 层拒收 `'abc'`** | `value` 自己变空 | 那不是我们的校验拦的 —— 该条只断言「零写请求 + 状态不变」，**别把浏览器的功劳算成自己的** |
| **「被拒」的证据看 toast** | toast 只活 3 秒、还会被下一条覆盖 ⇒ 单点读取读到 `null` | ① 轮询读；② 更硬的证据 = **拦截 `window.fetch` 记录非 GET 的写请求，断言「零写请求」** |
| **Vue 渲染是 nextTick** | 点完**立刻**查 `input` 必拿不到 ⇒ 返回 `no-input`，像「点了没反应」 | 拆成**两次** `evaluate`（点 → sleep → 量） |
| **虚拟滚动下 tbody 行懒渲染** | `tr` 拿到 `null`，`hasInput/frozen` 全 null ⇒ 像「只读失效 + 冻结失效」两个产品缺陷 | 轮询等行出现再断言 |
| **网格支持分组（`groupBy`）** | 第一条 `tbody tr` 是**只有一格的分组表头行**，`tr.children[i]` 必然 null/错格 | 按**具体列类名**找 `td.fc-cycle`；🔴 **禁用 `[class*=xx-]`**（会命中 Teleport 到 body 前的同前缀元素） |

### 🔴 探针自身的两类「假失败」毒瘤（都不是产品缺陷）

- **fixture 依赖**：把期望值**写死成 pid 列表**。换一份沙箱数据后这些 pid 根本不在本期行底，
  报「未遍历到」，看起来像缺陷。**修法**：降级为 `info`，并另写**数据集无关**的探针 ——
  **期望值从接口现取**（`/api/products?include_inactive=1&limit=5000`）+ 虚拟滚动遍历页面
  + **逐行双向核对**（有值的必须显示 `+N天`，无值的必须显示 `—`）。这条断言天然覆盖
  off-archive / 已停用行，换任何数据集都成立。
- **写死原话的断言**：提示语改了（如「不能改」→「去哪能改」）而断言还匹配旧原话 ⇒ 假失败。
  **判据：断言要匹配「意图」（`includes('只读') && includes('商品档案')`），不要匹配原话** ——
  否则文案优化永远变成回归。
- 同族（v184b 实测）：**对照断言必须选「原本非空」的格** —— 拿一格本来就空的当对照，
  「清空后仍为空」恒真 = **空断言假 PASS**。

## 🔴 Forecast.vue 有**两张表、两套列序**（v187 实测，判定「列不对」前必读）

| | 只读汇总表（查看态） | 编辑网格（改单态） |
|---|---|---|
| 列序来源 | `colOrderList` computed | `editColKeys` computed |
| 单元格 | 模板按 `colOrderList` 逐列 `v-if` 分支 | **自己一套**手写 `<th>`/`<td>`/表尾 |
| 驱动 | 只读 | `editColKeys` 驱动 `<colgroup>`，改它必须**同时**同步 thead+tbody+表尾共四处 |

- **「合计在最右 / 某列看不见」先分辨是哪张表**：只读表历来完整；编辑网格长期缺
  「最终下单(箱)/单价(厂价/箱)/下单金额(厂价)」三列（`git log -S` 只命中只读表）。**别去改只读表。**
- **calc 列不在选区索引空间内**：`maxC = master + units - 1`，`readCellVal`/`writeCellVal` 对
  `c ≥ master+units` 一律 `''`/`false`。「加单」是 calc 列里唯一带输入框的，其 `data-c` 必须是
  **越界哨兵**（本项目具名 `C_EXTRA_INPUT`）；**别写成 `editColKeys.indexOf('extra')-1`**（随
  `showSuggest` 漂移、语义不同源）。真要让 calc 列可键盘操作 ⇒ 必须同时扩 `maxC` + 两条读写。
- **同位置不同量不得同名**：只读表「系统建议」(`r.ai`，后端固定口径) vs 编辑网格「配方建议」
  (`r.suggest`，建议算法面板控制、带「采纳」)。「对齐汇总表」= 对齐**排法**，不是合并两列。
- **列宽**：`colW` 两表共用，未知 key 兜底 90px（表头「单价(厂价/箱)」≈91px 会折行）⇒ 补 `COL_DEFAULTS`。
  ⚠️ **改列名会改变表头宽度 ⇒ 必须重核列宽**（v188：「合计」→「合计(小单位)」需 ~95px，74px 会折行）。
- **改列名的显示位比「列」多**（v188 实测，共 8 类）：查看态 `colOrderList` 的 `label` /
  改单态手写 `<th>` / `editColDescAt().lblMap` 与 `colHeaderAt().m` **两份** / 顶部 `.edit-summary` /
  `.cross-amt-note` / `.cp-tip` / `COL_DEFAULTS` / 源码注释。漏一处 = 「一张表改了、另一张没改」。
  🔴 判据：`grep '合计'` 后**逐条判断是「列名」还是「行标签 / 统计指标名」** —— 表尾行首的「合计」
  是行标签、列统计弹层的「合计 / 平均值 / 最大值 / 最小值」是指标名，**都不是列名、不该改**。禁用全文替换。
  ⚠️ **两态 key 不同名却是同一个量**：只读表「合计(小单位)」= `qty`，编辑网格 = `sum`
  （历史分裂；统一会牵动 `readCellVal` / 导出 / `col_defs`，别顺手做）⇒ 两个 key 的宽度都要给。
- 🔴 **探针：验「表头是否折行」不能用 th 高度** —— 表格同一行内所有单元格高度被强制相同
  （折行的那个只把整行撑高）⇒ 比高度**恒真 = 空断言假 PASS**。正解：对 th 内第一个非空文本节点做
  Range 测量，**行盒数 >1 即折行**（本项目封装为页面函数 `window.__linesOf(el)`）。
  另：改列名要**两态都验**，查看态表头必须在**点「改单」之前**抓（之后只读表被 `v-else` 换掉）。
- 具体改法与 **24 项**真机断言见技能 `hergent-forecast-column-registry` §11
  （§11.4 列名显示位清单、§11.5 折行判据）。

## 🔴 「删除一块卡片 / 一个面板」类改动（v190-wb-trend，2026-09-18 经营工作台）

> 做法与断言细节见技能 `hergent-frontend-deploy-verify` §v190-wb-trend。此处只留判据。

- 🔴 **「删干净没有」必须分层查产物：模板 / 脚本 / CSS**。本轮线上曾是「JS 干净、CSS 脏」——
  JS chunk 里文案与类名都是 0，**CSS chunk 仍留着 5 条死规则**。只 grep JS 会漏掉一整层。
- 🔴 **删卡片会留网格空洞**：`.bento` 是 12 列 + `grid-auto-flow:dense`、**无 `grid-auto-rows`**，
  `today-panel{span 8; grid-row:span 2}` + `trend-card{span 4}` 的搭配里，
  **第 2 行右侧 4 列靠 trend-card 顶住** ⇒ 只删卡片必留洞（实测空 475.3px）。
  ⭐ 判据用 **`elementFromPoint` 同点位前后对照**（改前命中 `.bento` 本身 = 空格子；
  改后命中卡片内元素），比「宽度数字变大」有力；另配 `expiry.bottom === today.bottom`。
  ⚠️ 前提是改前真的留了空 ⇒ **必须先跑「改前探针」**。
- **修法**：右侧块改 `grid-row:span 2`；两张条件卡各加 `:class="{'span-all': 对方不存在}"`
  （覆盖四种显隐组合）；🔴 **窄屏断点单独改**（1200px 降 6 列时原 `span 3` 会空 3 列）；
  别用 `:has()`。
- ⚠️ **`tc-` 短前缀被两个区块共用**（趋势图 vs 今日经营要务）⇒ 删样式**逐个精确匹配，禁用前缀通配**。
- ⚠️ **要删的字段可能有第二个消费方**：该面板 `trend` 与 KPI 同源
  （`/api/dashboard/today-profit` 一次返回 `{profit,sales,orders,payment,trend}`），
  且仍被 `Dashboard.vue`（`/dashboard`）消费 ⇒ **「删除相关数据请求」的正确处置是一个都不删**。
- ⚠️ **冒烟判据别用 body 文本长度**：`/dashboard` 核心是 SVG（不进 `textContent`），
  文本仅 151 字符却完全正常 ⇒ 用「`.page` 有实质 DOM + 有结构性内容 + 无 `pageerror`」。

## 🔴 v209（2026-09-20）全屏图层：页头控件在**全屏下物理不可达** ⇒ 必须补层内副本

用户原话（两条，第二条是澄清，解开第一条的歧义）：
> ①「将『改单』按钮及其点击后弹出的所有功能按钮统一移动到表格工具栏中……确保工具栏内所有内容仅占一行，不出现横向滚动条。」
> ②「因为用户大概率会用**全屏功能**来查看和修改预报订单，所以要把这些按钮放在表格工具栏，
>    便于用户在全屏模式下直接操作，**不需要退出全屏模式才能进行操作**。」

**痛点坐实（真机 `elementFromPoint`）**：全屏下点页头「改单」，`btnBox` 坐标正常（按钮确实在 DOM 里、
位置也对）但 `topEl = ""`（一个无 class 的元素）、`hitIsBtn = false` ⇒ **点不到**。
成因：`.grid-area.is-fs{position:fixed;inset:0;z-index:1000;background:var(--bg)}` 是不透明图层，
把主工具栏整条盖住（源码 `toggleGridFullscreen()` 上方 v129 注释早已自陈）。

### 方案 A（用户拍板）：**全屏专属** —— 只在 `gridFullscreen` 为真时渲染副本，非全屏一个像素不动
理由（实测，不是偏好）：**非全屏放不下** —— 全屏·编辑态塞入编辑组后 1440 差 **273px**、1280 差 433px；
非全屏 1440 的表格工具行只有 1122px，而编辑组自身 428px。「两态都搬」与「仅占一行」**数学上冲突**。

### 🔴 让位判据 = 本轮最贵的一条（与「图层此刻真挂在屏幕上」严格同源）
```js
const fsRowHosting = computed(() => gridFullscreen.value && viewMode.value === 'cross' && !crossLoading.value)
```
- 🔴 **漏 `!crossLoading` = 死按钮**：重新加载期间 `.grid-area` 整块被骨架替换（`v-if="crossLoading"` 在前）、
  全屏层随之消失；此时若主工具栏那份已让位，屏幕上**一个「改单」都没有** —— 点了没反应、**不报任何错**。
- 🔴 **漏 `viewMode === 'cross'`**：表格工具行只在汇总表视图存在（`.cross-area` 是 `v-if`），
  逐单补录视图下它不在 DOM ⇒ 同样无入口。
- **让位（不渲染）而不是两份并存**：全屏层虽盖住了主工具栏那份，但被盖住那份**仍在 Tab 序与读屏里**（重复控件）。
- 真机判据：**数按钮条数**（`/^改单$/` === 1）—— 唯一能同时抓「重复」与「消失」的断言。

### 容量物理：全屏可用宽 = **视口 − 24**（比非全屏多约 300px）
全屏层 `inset:0` 不吃侧栏 248 + 页面 padding 40 + 卡片 padding 36 ⇒「非全屏放不下、全屏放得下」。

### 🔴 两个「当前态 ≠ 最坏态」的漏算（本次差点翻车）
1. **状态条宽度随文案变**：实测 clean 74 / dirty 110 / saved 97 px。v208 后保存成功即退出编辑态，
   但 `lastSavedAt` 不清 ⇒「已保存 HH:MM」仍会出现。**判据**：克隆 `.save-state` 换三态文案量一遍再投影。
2. **两个计数徽标可同时出现**（「仅显示有报单」+ 未勾「显示全部商品」），各约 150–180px。

### 🔴 行尾必须给全屏按钮留位
`.grid-fs-btn` 是 `position:absolute;right:14px`（相对全屏层），而 `.grid-ctl-row` 内容右边界在视口−12px
⇒ **天然重叠最后 28px**，内容一长就被压住（看着像缺一块、点不中）。留 `padding-right:34px`。
真机判据用 `max(子元素右边界) − 按钮左边界 ≤ 0`；**`scrollWidth` 抓不到这种压盖**。

### 全屏专属收紧清单（都只全屏生效）
| 手法 | 省 | 备注 |
|---|---|---|
| 徽标 → 图标形态（`badge-slim`，文案进 `title` + `aria-label`） | ~150 ×2 | **信息不丢**，实测 180 → 30 |
| 隐藏行首那条装饰 `.tb-sep` | 19 | **只隐藏行首那条**，编辑组前面那条要留（否则两段糊成一团） |
| 行 `gap` 8 → 6 | ~24 | |
| 缩放控件 `compact`（去「缩放」二字 + 滑杆 100→64） | 66 | 能力不丢（－/＋/重置仍在） |
| 编辑组按钮横向内边距 12 → 9 | ~30 | |

### 两个实现陷阱
- 🔴 **子组件的内部类名父组件选择器打不进去**：`<style scoped>` 只给子组件**根元素**加父 scope id
  ⇒ `.grid-area.is-fs .zb-label` 这类写法**静默失效**。收紧子组件要加 **prop**（`GridZoomCtl` 的 `compact`）。
- 🔴 **`.tb-edit-group` 的「共用布局」与「独占整行」必须拆开**：原为单条 `.toolbar>.tb-edit-group`
  同时管两件事（含 `flex:0 0 100%`）⇒ 直接被表格工具行复用时**立刻强制折行**。
  拆成 `.tb-edit-group{display:flex;gap:8px;flex-wrap:wrap}` + `.toolbar>.tb-edit-group{flex:0 0 100%}`
  + `.grid-ctl-row>.tb-edit-group{flex:0 0 auto;flex-wrap:nowrap}`。

### 一组控件写在两处 = 最大漂移风险（必须机器化守）
`v209-fs-toolbar-verify.mjs`（离线 36 项）：抠出两处 `.tb-edit-group`，**逐个按钮比对
`@click` + `:disabled` + `title` + 可见文本**，并断言顺序 = `exitEdit,undoToLastSaved,openErrList,addRow,saveEdits`。
（本文件里「品牌弹层」「两态 `.grid-ctl-row`」早就是同样的同构两处写法，沿此惯例。）
真机 `v209-fs-toolbar-prod-probe.js`（40 项，**零写入**）：含 S0 非全屏零改动回归、S1 全屏只读、
S2 从表格工具行那颗按钮进入编辑态、S3 取消后入口回来、S4 退出全屏全部恢复。

### 本轮实测（生产 hergent.cn）
| 场景 | 1280 | 1366 | 1440 | 1680 | 1920 |
|---|---|---|---|---|---|
| 全屏·只读·余量 | +387 | +473 | +547 | +787 | +1027 |
| **全屏·编辑·余量** | **+73** | +159 | +233 | +473 | +713 |
| 非全屏·只读·余量（**未改**） | **−21（仍 2 行）** | +65 | +139 | +379 | +619 |

⚠️ **既有缺陷（与本次无关，未修）**：非全屏 1280 的表格工具行**本来就折成 2 行**（−21px）。
一行修法 = 把徽标也按窄屏收成图标形态；代价是 1280–1359 下徽标失去文字。**待用户拍板**。



---

## 🔴 v210（2026-09-20）编辑网格「单元格两态模型」—— 单击全选 + 方向键跳格

**用户诉求（原话）**：「① 单元格应支持单击选中所有内容，便于用户快速修改已有内容；② 要支持键盘方向键进行不同单元格之间的跳转」

### 两条需求**天然打架**，正解不是二选一而是分两态
焦点落在 `<input>` 上时，方向键到底是「跳格」还是「字内移光标」？
当年 Q21 为治「想改一位数字却被跳格」，把方向键在输入框内**一律放行** ——
代价是 **② 整个功能等于不存在**：格子一被选中焦点必定在 input 里 ⇒ 跳格分支全是**死代码**。

| 状态 | 进入方式 | 单击 | 方向键 / Home / End / PgUp·Dn |
|---|---|---|---|
| **导航态** `cellTyping=false`（默认） | 单击某格 / 键盘跳到某格 | **全选内容**（诉求①） | **跨格跳转**（诉求②） |
| **输入态** `cellTyping=true` | 双击 / `F2` / 在**已选中的同一格**上再点一次 | 光标落在点击处（保「改一位数字」） | 放行给浏览器**字内移光标** |

`Esc` 在输入态下**只换态、不回退内容**（回退归「回退」按钮 / Ctrl+Z —— 在此顺手还原 = 静默丢数据）。

### 四条判据（每条都对应一个**静默失效**）
1. 🔴 **早退判据必须是 `cellTyping.value && editing`**，只判 `cellTyping` ⇒ 拖框选（`onCellOver` 把输入框 blur 掉）之后**方向键整体失效、不报错**，与「键盘坏了」长得一样。
2. 🔴 **复位语句（`cellTyping.value = !doSelect`）必须写在 `nextTick` **之前** —— `el.focus()` 会**同步**触发模板上的 `@focus`（`onFocusCell`），那里面要读 `cellTyping` 才能决定「要不要全选」；放进 nextTick ⇒ 用 `F2` 进输入态时被 `@focus` 抢先把内容全选掉，**正好把 F2 的语义做反**。
3. 🔴 **第二次点击的判据 = 「按下这一刻该输入框是否已是 `document.activeElement`」**，**不能用 `selected` 比对代替**（键盘跳格后 `selected` 已指向该格，但焦点未必还在输入框 —— 例如拖框选之后焦点在 body ⇒ 那时单击必须仍是「全选」）。
4. 🔴 **`focusCell()` 是「所有键盘跳格」的唯一入口** ⇒ 「跳到新格 ⇒ 回导航态」在此**统一落定**，让「漏了某条跳格路径没复位」不可能发生。

### 模板侧：编辑表**每一个**可编辑 input 的 `@focus` 都必须带 `$event`
漏一列 ⇒ 那一列单击不全选，**纯静默**，只能机器查（当前 7 处）。护栏 C 段专治此条。

### 🔴 连带缺陷（同批修，不修就会立刻以「随机失灵」出现）
- **`_pendingCell` 必须每格一套**：原 `if (!_pendingCell)` ⇒ 焦点在**没改动**的格子间连续移动后，变量停在**第一个**格子上；之后改别处 ⇒ 拿它比对「压根没动过的格子」⇒ 两边相等**直接 return** ⇒ 这次改动**既不进撤销栈、也不点亮状态条**（用户明明改了，界面说「尚未修改」、「回退」还是灰的）。v210 起方向键跳格会让这条路径从偶发变**常态**。
- **跳到的格子不得被粘性列/表头遮住**（`keepCellClear()`，v210 **新开出来的**路径，老版本不存在）：浏览器原生 `focus()` 的滚进视口是**最小滚动**语义 ⇒ 只把格子送到滚动口**边缘**，而本表两处边缘都被 sticky 占据（`.seq-cell` 46px + `.frozen` ~200px，均 `left:0`；表头 `top:0`）⇒ **按了方向键，光标停在冻结列底下、看不见**（比「没跳」更难排查）。
  · 冻结区边界必须**量出来**（遍历本行 sticky 格子取最大 right + `thead th` 取最大 bottom），**不许写死 250px**；
  · 只在**确实被遮住**时才滚（否则相邻格跳转会不停抖动）；
  · **粘性格自身直接跳过**（它按定义永远可见，对它补偿只会让页面无意义漂移）。

### ⚠️ 既有局限（**本轮不改**，已报用户）：拖框选的**起拖点**
在编辑网格里从单元格**中间**（输入框上）按住拖 ⇒ **不形成选区**；必须从单元格**空白边缝**（每侧约 7px）起拖。
**实测对照**（`v210-probe-env-diag6.js`）：

| 起拖位置 | `mouseover` 计数 | 输入框 blur | 选区格数 |
|---|---|---|---|
| 输入框上 | 1 → **全程不再增加** | 否 | **0** |
| 单元格空白边缝 | 2 → 7（正常） | 是 | **3** |

成因：从 `<input>` 起拖时浏览器进入**原生文本选择并捕获指针**，期间**不再向其它元素派发 `mouseover`** ⇒ `onCellOver` 收不到信号。
定性：`onCellDown` 里 `_dragEditing` 的 preventDefault 分支 v210 **未改动** ⇒ **不是本次引入的回归**；修它要重新设计手势（独立一轮）。

### 🔴 探针侧的两个坑（真机取景）
- **坐标必须「滚动到视口中央后再取当下值」**，且**横向也必须显式居中**：`scrollIntoView({inline:'nearest'})` 会被**粘性列骗过** —— 它把格子停在滚动口左边缘（= 冻结列底下），`elementFromPoint` 命中的是 `td.seq-cell` 而非 input，表现是「点了没反应」，极易误读成功能坏了。取点必须带**命中测试** `hitIsSelf`。
- **`End` 的期望值不能取「所有 `.cell-qty` 的最大 `data-c`」**：`C_EXTRA_INPUT = visibleCols+units = maxC+1`（加单列，class 也是 `cell-qty`，**不参与导航坐标系**）⇒ 期望会多 1。正确写法 `td:not(.extra) input.cell-qty`。实测三者：`qtyMaxC=28` / `qtyMaxCNoExtra=27` / End 落点 `27`。

### 护栏与探针
- `v210-cell-typing-verify.mjs`（离线 **43 项**，切片真实源码；A 两态本体 / B 需求① / **C 每个 @focus 带 $event** / D 需求② / E `_pendingCell` / F 五处共读 / H `keepCellClear` / G 回归）
- `v210-guard-falsify.mjs`（**反证自测** 7 个变异：去 $event / 退回裸 editing / 复位挪到 nextTick 后 / 补偿挪到 focus 前 / 无条件滚动 / 写死 250px / 去掉粘性格跳过）
- `v210-cell-typing-prod-probe.js`（真机 **39 项全绿**，支持沙箱注入 + 命中测试 + **零写入取证**：`p.on('request')` 断言无非 GET 的 `/api/` 请求）
- 🔴 **本轮探针自身有 3 处缺陷造成的假红**：① 坐标过期/被冻结列盖住导致点空 ② `End` 期望值把「加单」算进去 ③ `S4-1` 在测一个**产品从来不具备的手势**（从输入框内起拖）。

---

## 🔴 小程序（wxss）按钮文字不居中：宿主组件的内置默认行高（2026-09-20 实证）

**判据缺一层就看不见**：仓库里 grep 不到，但微信 `<button>` 组件带内置默认样式，
其中 `line-height:2.55555556`（**无单位倍数**，按元素自身 `font-size` 计算）。
⇒ **给 button 设了显式 `height`、却没设 `line-height` / flex 居中** 的规则，文字必然偏上 `(height − line-height)/2`。
登录页 `.btn{height:96rpx;…}` ⇒ 行高 = 2.5555…×32rpx = **81.78rpx** ⇒ 偏上 **(96−81.78)/2 = 7.11rpx**（实测 −7.00）。
**病根是耦合**：正确性押在「height 与 line-height 两个数字永远相等」上，改一个忘另一个就复发
（实测：只改 height 96→120→200rpx，移前偏移 −7/−19/−59，线性漂移并精确命中「行盒贴顶」预言）。
**反例三类不算缺陷**：line-height 与 height 相等 / `display:flex`+`align-items:center` / 不设 height 靠上下对称 padding。
**全仓 9 页普查**：6 处按钮设了 height，缺陷 3 处（`login`/`password`/`forgot` 的 `.btn`，同源三份）—— 只修被看见的那一个必然漏。

**修法**：加 `display:flex;align-items:center;justify-content:center;line-height:1.2;padding:0`。
`align-items` 管垂直、`justify-content` 管水平（`flex-direction:row` 时主轴是横的）。
**不选「只补 line-height」** —— 那会保留耦合。

### 🔴 像素级实测保真三坑（用浏览器量小程序时必须全中，否则结论是假的）

| 坑 | 后果 | 处置 |
|---|---|---|
| 用 HTML `<button>` 模拟微信 button | Chrome 对原生 button 额外做「内容垂直自动居中」，**把缺陷掩盖掉**（同一份 CSS：原生 1.00rpx vs `wx-button` 7.11rpx）；宽度还走 shrink-to-fit（65px vs 287px） | 改用自定义元素 `<wx-button>` |
| `mobile:true` 但无 viewport meta | 布局视口回落 ~980px，与写死的 rpx 基准脱钩（量出 916px） | 补 meta + 断死 `clientWidth === 375` |
| 掩膜不向内侵蚀 | 按钮轮廓的「青↔白」抗锯齿像素 r 被抬到 >90，**被当成文字**（−8 污染成 −19.5） | 掩膜向内侵蚀 3 像素 + 圆角矩形判定 |

**阈值不能设 0**：墨迹包围盒只能取整像素 ⇒ 中心有 0.5 图像像素量化下限；判据 **≤1.5rpx**（原缺陷 5～7rpx，余量 ≥3 倍）。
**出图的坑**：`top:50%` 画基准线会因 `.btn` 自带 `margin-top:8rpx` 而**偏高 4.5 像素**，看着像「没居中」其实是线画错 ⇒ 按实测矩形摆线，且图本身要过像素校验。

**工具**：`tools/btn-text-center-probe.mjs`（11 项断言：前提 + 双向判别力 + 机理归属 + 实测 + 高度无关性）、
`tools/btn-height-without-lineheight-scan.py`（静态普查，须带反向对照）、`tools/png-button-center-verify.py`（校验对照图不说谎）。
**边界**：小程序无构建步骤，改完需在微信开发者工具重新编译；测量在浏览器引擎里复现宿主默认样式（开发者工具无法无人值守），**真机仍建议扫码确认一次**。
**技能**：`hergent-frontend-text-centering-diagnosis`。

---

## §v214-A 数字输入格的「输入法容错」（全角数字 / 中文标点）—— 2026-09-20

**技能**：`hergent-numeric-input-ime-tolerance`（新建，含完整清单）｜**工具**：`v214-halfnum-parity.py`、`v214-browser-input-verify.cjs`

### 🔴 最贵判据 ①：病根在**输入层**，不在校验层 —— 且 `type="number"` 的危害是「**静默加工**」不是「收不到」

`cellErrMsg`（前端）/ `normalize_qty`（后端）**早已走 NFKC**，全角数字本来就能过校验 ⇒ 改校验层是白改。
真机裸元素能力矩阵（只差 `type` 一个变量）：

```
'１２'      number → "12"     text → "１２"
'１２。５'  number → "125"    text → "１２。５"   ← 中文句号被删 ⇒ 小数点消失 ⇒ 数量放大 10 倍
'12箱'      number → "12"     text → "12箱"       ← 脏值变合法数字
'12.'       number → "12"     text → "12."        ← 中间态被打断 ⇒ 小数根本打不出来
```
⇒ **用户看不到任何异常**（无报错、无红框，框里就是个"正常数字"）—— 比「输不进去」危险得多。
  与 v213 原则同向：**宁可标红，不要静默丢/改**。⇒ 必须换 `type="text"`（保留 `inputmode` 保住移动端数字键盘），
  并自己接住校验责任（`cellErrMsg` 整串判据是这套设计的**组成部分**，不是可选装饰）。

### 🔴 最贵判据 ②：NFKC **不折 `。`(U+3002)** —— 「小数点打不出来」的真凶

NFKC 只折**全角形**（`．`U+FF0E → `.`）；中文输入法在**中文标点态**下打出的是 `。`U+3002（表意句号），NFKC 对它**不做任何事**。
容错表只收「数字格内语义唯一」的字符（`。、—–−．，－＋`），**不做 `O→0`/`l→1` 歧义映射**。
🔴 **`　`(U+3000) 别写进表**：NFKC 先把它折成普通空格 ⇒ 「先 NFKC、再查表」永远匹配不到 = **死条目**
（实测 `toHalfNum('　12　')` → `' 12 '`）；真正兜住它的是末尾 `.strip()`/`.trim()`。
🔴 **「表相同」≠「行为相同」** ⇒ 护栏必须两层：「比表」（纯 Python）+「比行为」（从源码提取前端表用 node 跑，逐条比对）。

### 🔴 最贵判据 ③：`\d` 在 Python 是 Unicode 感知、在 JS 是 ASCII-only ⇒ 两端分裂

`_NUM_RE` 必须写 `[0-9]`。暴露方式：**去掉 NFKC 的变异体 M6「仍然全绿」** —— `\d` 的宽容把 NFKC 变成了冗余层。
> **变异体「全绿」比「变红」信息量大**：它在说「这条判据在替解释器的宽容背书，不是在测代码」。

### 三条实现纪律（都踩过）

1. **中间态只能 `@change` 收敛，不能放 `@input`**：`Number("12.")`=12 ⇒ 边打边收敛 = 用户**永远打不出小数点**；
   不收敛 ⇒ 后端 `_NUM_RE` 判「非数字」= **用户填 12 却见红框**。两头都错。
2. **`@input` 内必须同时做两件事**：① 回写 DOM `value`（用户**看得见**转换，这是功能的全部价值）
   ② **显式写 model**（不能只靠 `v-model`，顺序反转就把全角原串写进 model ⇒ `parseInt('１２')`=NaN ⇒ **合计静默按 0 累加**）。
3. **光标换算**：全角→半角 1:1，但**去逗号会让文本变短** ⇒ 不能沿用原 `selectionStart`；
   按「光标左侧文本转换后的长度」重算。且 **IME 组合期（`e.isComposing`）一律不碰 DOM**。

### 🔴 反证实验的干净性（两次被自己的实验骗过，值得记）

- 不能用「把真实格的 `el.type` 改回 `number`」做对照 —— **改 `type` 不会摘掉已绑定的 `@input` 监听器**，
  净化层照样生效 ⇒ 对照被自己污染。必须用 `createElement('input')` 的**裸元素**（`position:fixed;left:-9999px`）。
- 输入必须走 **CDP `Input.insertText`**（`page.target().createCDPSession()`）；`page.keyboard.insertText`
  在 managed `puppeteer-core` 里**不存在**。

## §v234 「下架一个模块」的 7 个落点（漏一个就留下死链或死入口）—— 2026-09-21

案例：前端下架「催收跟进」（`Collections.vue`）。**只删组件 + 侧栏一项是不够的。**

| # | 落点 | 漏掉的后果 |
|---|---|---|
| 1 | `pages/<X>.vue` 组件本体 | —— |
| 2 | `router/index.js` 懒加载 `const X = () => import(…)` | 构建报错（引用了未定义变量） |
| 3 | `router/index.js` 路由项 `{ path: '<x>', component: X }` | 死页仍可达 |
| 4 | **指向该路由的 `redirect`** | 🔴 比死页更糟：旧书签被**静默重定向到死页** |
| 5 | `components/Shell.vue` 的**桌面侧栏 + 移动端抽屉两处** | 只删一处 ⇒ 移动端仍能点进死页 |
| 6 | `components/CommandPalette.vue` 命令项 | 🔴 侧栏藏了，⌘⇧K 仍能跳过去 |
| 7 | 其他引用：能力中心卡（`ConnectCenter` 的 `SKILL_META`）、工作台待办卡片（`Workbench` 的 `todoItems` 里 `path:`）、`api/modules.js` 的导出 | 🔴 卡片/导出指向已删页面 = **失效链接** |

**验收（三扫 + 一建）**
1. 残留扫：`grep -rn -e "<中文名>" -e "<Component>" -e "<apiName>" -e "/<path>" -e "hergent-<key>" src` → 0
2. **死链扫**：`grep -rn "'/<path>'" -e '"/<path>"' -e 'to="/<path>"' src` **并且**扫它的
   `redirect` **源**路径（本次 `reconciliation` 就是靠这条抓到的）→ 0
3. `grep -rn "<Component>.vue" src`（无残留 import）→ 0
4. `npm run build` 零报错，且产物里**没有**该模块 chunk、没有入口文案（本次 assets 53→51，净减恰为 js+css）

**范围边界要显式说明**：本次是「前端侧栏下架」，后端 `/api/<x>/*` 与路由文件**刻意保留**
（重做方案要以它为存量入口）；`desktop-app/main.js` 里的同名能力描述属**另一套产品面**，
不在同批范围 —— 交付时要点明，别默认"全清了"。

---

## §v278b 副驾流式渲染：**逐字动画不做**（2026-09-26 实测判定）

**判据 = 上游分片粒度**（动手前必须先量，别凭感觉说"更顺滑"）：
经代理实测一条 310 字回答 = **236 帧 / 5.6 秒**，每帧字符中位 **1**（72% 帧仅 1 字）、
帧间隔中位 **1ms**、p90 13ms、**0 次 >300ms 静默** ⇒ 上游**本来就是逐字吐**（≈55 字/秒），
前端渲染已 ≈**42 帧/秒**（近 60fps 上限）⇒ **打字机动画平滑收益 ≈ 0**，
典型 30 字/秒的打字机**比现状更慢**（310 字多等 4.7 秒）。

**9 条副作用（照抄可复用）**：① `store.chat.streaming=false` 在 `hermesChat` 返回**即**置位，
工具条折叠(`toolsLive`)/参考来源/评价按钮全挂它 ⇒ **正文还在打字、工具条已收起**；
② `scrollBottom()` 是无条件 `scrollTop = scrollHeight` ⇒ 动画会变成**每帧拽回底部**，
老板往上翻必被拽回；③ 若把"显示文本"当真值 ⇒ 切会话/关抽屉会**存下半截**
（2026-09-23 已真实发生过一次落盘事故）；④ 回头改原始串 ⇒ **半截控制标记闪现**
（`useCardTrigger.js` 的 `OPEN_PROTOCOL_FENCE_RE` 正为此存在）；
⑤ 每帧 = 全串 `stripAllFences` **跑 2 遍**（`onDelta` + `md.js::renderMd`）+ 全串 markdown 重解析
+ 整块 `v-html` 替换 ⇒ 长回答带表格会掉帧；⑥ 全项目**零** `prefers-reduced-motion`；
⑦ 动画期间复制/长按选取错位；⑧ 6 个真机探针靠固定 `sleep` 读 DOM ⇒ 会随机变红；
⑨ 与老板"看结论"的目的相反。

🔴 **若日后仍要做，5 条硬约束**：只对纯文本消息 / 后端返回后**立即 flush** /
尊重 `prefers-reduced-motion` / **只作用于显示副本**（store 真值恒为完整文本，保落盘与复制）/
动画层建在**已剥离围栏**的文本之上。并按此**重跑全部探针**。

💡 **反方向才是真优化**：现状已是"每帧全串重解析 + 整块替换"，
该做的是**合帧**（渲染从 ≈42 降到 ≈20 帧/秒）降开销，而不是再叠一层动画。

**可复用的量法**（下次问"要不要加动画/要不要加节流"时照用）：打一条真实问题经**生产代理**，
逐帧记录 `(相对时间, 本帧字符数)`，输出「每帧字符中位/p90 / 帧间隔中位/p90/最大 /
1 帧 1 字占比 / ≥8 字占比 / >300ms 静默次数」——**分片细 ⇒ 动画无收益；分片粗(≥8 字成坨) ⇒ 才值得做**。

---

## 🔴 「多级保存」弹窗：判「要不要合并」看**端点/字段是否重叠**，缺陷几乎总在**收尾动作**（2026-09-27 编辑员工弹窗评审）

**症状形态**：一个弹窗 4 个保存按钮（底部「保存」＋ 账号区「保存角色/保存密码/保存账号」），直觉判「冗余、该合并」。

**第一步判据（决定要不要动）**：把**每个按钮提交的字段**列出来取交集。
- 本页实测：`saveEmployee` body = 11 个档案字段（**逐字检查过，不含 role/password/username**）；另三个端点 body 分别是 `{role,roles}` / `{password}` / `{new_username}` ⇒ **交集为空**。
- **交集为空 ⇒ 是「域分离」，不是冗余，不要合并。** 合并需新增后端端点，且会**放宽账号侧授权面**（三个账号端点统一挂 `_assert_user_manageable`），还把敏感字段混进常规按钮 —— 用 UX 收益换安全面，不划算。
- ⚠️ 反直觉：**「按钮多」本身不是缺陷**。

**第二步才是找真缺陷 —— 收尾动作**。同弹窗内 A 域保存成功后 `editOpen=false`（关窗）⇒ **吃掉 B 域未保存的改动，零提示零报错**。
- 本页两条路径：① 改档案→改角色→点「保存角色」⇒ 档案丢；② 改角色→点底部「保存」⇒ 角色丢。
- 🔴 **比 v289 更隐蔽**：v289 至少**报错**（4 位被拒），这条是**改动消失得和保存成功一模一样** ⇒ 属「恒真不报错」型静默失效。
- 三处判据（照此清单核）：① 列出所有写操作函数 ② **逐个看成功后是否「关窗 / 清空 / 跳转」**（本页 `resetAccPwd` 不关窗、另两个关窗 ⇒ **同类操作行为不一致**，仅这处不一致就足够定位） ③ 关窗入口（点遮罩 / ✕ / 取消）**有没有脏检查**。

**修法优先级（经验）**：
1. **先让「保存成功不关窗」对齐**（约 4 行，一处改动）—— 一举消除**两个方向**的丢失，性价比最高。
2. 再加**关闭前 dirty confirm** 作兜底（将来新增会关窗的写操作也不漏）。
3. 最后改展开态落点。

**附带几何判据（同 v209「物理不可达」族）**：`v-if` 展开出的输入框若插在**触发按钮的上方**、且中间隔着别的区块（本页「重置密码」按钮在第 197 行，输入框在第 183 行，中间夹着「兼任角色」整块）⇒ **点了像没反应，用户会连点**。判据：展开内容与触发按钮的垂直距离 ≤ 1 行。

**优化方向（不要砍按钮，要让边界可见）**：底部按钮按实际职责改名（「保存基本信息」）／账号区加「以下各自独立保存」／用**边框**把「独立保存单位」框出来（边框 = 保存边界）／危险操作（禁用账号）单独靠右且保持 danger 色。
⚠️ **「取消」二字被复用是误点源**：底部「取消」= 关弹窗，而「取消改账号」「取消重置」= 收起输入框 —— 同屏三个「取消」两种语义。

---

## 🔴 前端「入口门禁」覆盖面：机制早就有，**只接了 1 个菜单**（2026-09-27 实测）

触发：换角色后界面没变 / 权限没生效 / 受限角色登录后菜单照样全在

- `store.canModule(m)`（`store/index.js:107`）＋ `constants/roles.js::roleIn()`（v275）**都建好了**，
  但 `Shell.vue` 侧栏 **12 条菜单里只有 2 条接了门禁**（2026-09-27 复核：原记「11 个菜单项」，实测 **12 条**）：
  · `canViewForecastSummary(store.user.role)` → `/forecast`（桌面 `:59` ＋ 手机抽屉 `:97`）
  · `store.canModule('payroll')` → `/payroll`（桌面 `:62` ＋ 手机 `:114`）
  其余（工作台 / 返利 / 货损核算 / 档案管理 / 渠道与价格 / 能力中心 / 招投标 / 定时任务 / AI 中心 / 设置）**一律无门禁**。
- `router/index.js` 全表**只有 1 处 `meta.roles`**（`/zhoupu-import`，第 75 行）⇒ 其余页面**手敲 URL 可达**。
- 现象：受限角色登录后**侧栏几乎满配**，菜单点得开、**进去后接口才 403** ——
  用户读到的不是"被拦住"，而是"**权限没生效 / 到处无权限**"。
- 🔴 判据：**「机制存在」≠「覆盖完整」**。审计入口权限时**不要** grep 机制是否存在（必然存在），
  要**数接入点**并与菜单项总数对照：`grep -c "canModule" Shell.vue` + `grep -c "meta: {.*roles" router/index.js`。
- ⚠️ 前端入口隐藏**永远不是安全边界**（真边界在 `server.py:799` 的 `_check_perm`）；
  它修的是**状态与实现不一致**（可见即不可用 = 假入口）。
- ⚠️ 三处前端缓存会让"改角色后不刷新"继续用旧角色：`store.perms`（同租户幂等，`store/index.js:81`）、
  `store.user.role`（`ensureRoleLoaded` 有值即不重拉）、`localStorage.hergent_v2_user`。
  ⇒ 验收"角色权限变更"类需求，**必须要求"重新登录一次"或加"权限版本号"**，否则测不出真结果。
- 🔴 **给菜单加门禁时的三条实测硬约束（2026-09-27 补，来自"A 方案做完会怎样"的评估）**：
  · **菜单结构与模块体系不同构**：侧栏里**没有**「报表 / 账目 / 客户 / 营销」入口，而 `accountant` 的模块恰恰
    只有 `accounts/reports/marketing/chat` ⇒ 机械按模块挂门禁会把**会计从 10 条砍到 2 条**（是功能回退，不是修好）。
  · **「设置」不能挂 `settings` 模块**：`_PATH_MODULE_MAP` 里**没有任何前缀登记为 `settings`**（幽灵模块），
    而 `boss` 的 `read_denied` 恰好是 `['settings']` ⇒ 挂上去 = **老板自己的「设置」菜单消失**。
    应挂 `hr`（`/api/users` `/api/permissions` `/api/platform` 都归 `hr`；老板有 `hr` ⇒ 不受影响，其余角色隐藏）。
  · **`data` 是 82 个前缀的公共大口袋**（含 `/api/datasources` `/api/import/*` `/api/cron` `/api/bid-radar`
    `/api/price-channels`）⇒ 只要给某角色 `data`，"管理入口"就**全留**：员工 12 条里仍看得见 **7** 条
    （其中 5 项是管理入口）。
  ⇒ 结论：**菜单门禁该按「角色白名单」做，不该按「模块」做**。同范式先例＝
    `roles.js::FORECAST_SUMMARY_ROLES` ＋ `roleIn()`（fail-open）＋ AST 护栏（注释明写「与后端必须同一份名单」）。
  ⚠️ 别漏 `components/CommandPalette.vue`（已有 `when` 机制）—— 侧栏藏了、命令面板还能搜到 = 假入口回归。
  📊 各角色前后条数对照 → `outputs/员工角色-WEB端可登录-诊断-2026-09-27/00-诊断报告.md` §7
- 登录端与角色的关系（为什么"仅小程序"不是一条被绕过的规则）→ `backend-auth.md` 缺口 B。

---

## 🔴 v291（2026-09-27）「按角色收窄入口」= 建**一张页面注册表**当唯一判据源（两条轴，不是一条）

触发：不同角色登录后只该看到自己有权限的页面 / 换角色菜单没变 / 受限角色侧栏满配 / 假入口

**病根不是「没机制」，是「模块粒度太粗 ＋ 判据散在四处」**：
- `server.py::_PATH_MODULE_MAP` 实测 **304 条**路径，`data` 一个模块吃掉 **83 条**（档案 / 渠道价格 / 能力中心 / 招投标 / 定时任务 / 补录 / 报单…），`accounts` 61、`stock` 36、`sales` 36、`hr` 28。
- ⇒ 只按 `module` 判：员工（`staff` = `data+chat+stock`）仍看得见 **7–8 个管理入口**；司机（有 `stock`）因 `/api/loss` 也归 `stock` ⇒ 能进**货损核算**。
- 判据此前散在**四处**（Shell 侧栏 / router 守卫 / CommandPalette / 页内跳转）⇒ 必然产出**假入口**（v267 修过）与**假封锁**（v275 修过）。

**正解 = 两条轴并存，且只有一份名单**：

| 轴 | 回答 | 谁定 |
|---|---|---|
| `module` | 本租户**买没买**这个能力 | 客户在「设置 › 权限」自助开关 |
| `roles` | 这一页**天然只给哪几类人** | 产品内置（`roles.js::roleIn()`） |

新建 `src/constants/pages.js`（197 行）= **唯一判据源**：**17 页** × 两轴，导出 `ruleFor / canSeePage / pageRoleAllowed / canSee / pageTitle / PAGE_PATHS`。
四个消费方全部改走 `canSee()`：`router/index.js`（`roleGuarded` ＋ 403 跳 `?denied=`）、`Shell.vue`（侧栏 ＋ 手机抽屉）、`CommandPalette.vue`（`when`）、`Workbench.vue`（快捷入口）。

**fail-open 两处（刻意，不要「顺手改严」）**：① 未登记的路径 ⇒ 放行；② 未知角色 ⇒ 放行。
要更严只能让守卫的 `ensureRoleLoaded()` **先消掉「未知」**，而不是把 fail-open 关掉（关掉 = 新页面一上线就对所有人隐身）。

**验收读数（真机无头探针）**：`assets/` 双侧 md5 **57/57**；新版探针 **20/20**、旧版 **17/20**（3 条失败全部是「旧版把已收窄的菜单仍当应显示」）；注册表护栏退出码 **0**。
**各角色侧栏条数（收窄后）**：`admin`/`boss` **12**、`accountant` **6**、`supervisor` **6**、`sales` **6**、`guide`/`driver`/`staff` **2**。

### 🔴 三条会静默出错的坑（本轮全踩）

1. **「漏登记 ⇒ 静默失去门禁」**：`ruleFor()` 未登记返回 `null`，`canSeePage()` 对 `null` **fail-open**。本轮真的漏了 `/payroll` 与 `/bid-radar` **两行** —— 零报错，只是那两页对受限角色**照样可见**（正好与需求相反）。
   ⇒ 必须配**注册表护栏**（`.workbuddy/tools/v291-page-registry-guard.py`，退出码 0 = 全登记）：把 `src/pages/*.vue` 的路由与 `PAGE_RULES` 键做双向差集。**新增页面忘了登记靠它抓，不靠人眼。**
2. **权限缓存按「租户」存 ⇒ 同租户换账号串味**：`loadPerms()` 缓存键只有 `permsTenant`，无账号维度 ⇒ **老板登出、员工登录会命中老板的缓存**（前端满配菜单，像是「改角色没生效」）。修法 = `store.resetPerms()`，在 `Login.vue` 登录前 ＋ `Shell.vue` 登出时都调。
3. **首页不能挂 `dashboard` 模块**：员工没有 `dashboard` ⇒ `/workbench` 若挂 `dashboard` 会**白屏**，必须 `module: null`（人人可见）。另：**`settings` 是幽灵模块**（`_PATH_MODULE_MAP` 里没有任何前缀登记为 `settings`，而 `boss` 的 `read_denied` 恰是 `['settings']`）⇒ `/settings` 必须挂 `hr`，挂 `settings` = **老板自己的「设置」菜单消失**。

### 🔴 v291 探针法：「釜底抽薪」——别给业务接口编假数据

**症状链条（差点误判成「权限全崩」）**：无头探针读生产页面侧栏，读到 **0 条菜单** ⇒ 看着像「菜单全没了」。
真因：页面级 chunk 加载后调业务接口失败 ⇒ **ErrorBoundary 把整个 `#app` 换成错误卡片** ⇒ 侧栏一起消失 ⇒ 探针读到 0 条。**假数据永远补不完**（每页依赖的接口都不同）。
**正解 = CDP `Fetch.enable` ＋ `Fetch.fulfillRequest`**，把**页面级 chunk** 的响应换成一段**空 Vue 组件**（`ProbeStubPage`）⇒ 页面挂载成功、侧栏照常渲染、业务接口一次都不打（**零写入**）。
⇒ 教训：**探针读到 0 时，先问「是不是整个 app 被换了」，再问「是不是权限把它藏了」**。判据 = 探针同时报「侧栏条目数」与「`#app` 是否为 ErrorBoundary」。

工具 `.workbuddy/tools/v291-role-menu-probe.mjs`；交付证据 `outputs/角色菜单权限-按角色收窄-2026-09-27/`（含可复跑工具副本）。
🔴 **提交归属**：本轮 11 个源文件里 **5 个是混合文件**（`store/index.js` `router/index.js` `Shell.vue` `CommandPalette.vue` `Workbench.vue`）⇒ 用 `own_hunks` 逐 hunk 归属；**并差点漏掉依赖闭包**（见 `skill-routing.md` / `hergent-scoped-commit`）。


## 🔴 v292（2026-09-27）权限「默认 + 客户自主 + 界面联动」：让客户配置**优先于**内置角色门槛

### 一条新判据：`roleGateOpen`（唯一实现，入口与守卫共用）
`constants/pages.js` 现在只有一个角色判据 `roleGateOpen(r, role, customRoles)`，`canSeePage`（入口）与 `pageRoleAllowed`（守卫）都调它。三档：
1. 本行没配 `roles` ⇒ 过；
2. 角色在 `roles` 名单里 ⇒ 过；
3. 都不满足，但**本租户已为该角色真实改过权限**、**本行配有 `module`**、**未被 `lock` 锁住** ⇒ **让位**（过）。

🔴 **为什么「让位」必须要求本行配有 `module`**（安全阀，不是偷懒）：`module: null` 的行一旦让位就**一个判据都不剩** = 对所有"被改过权限的角色"全开。后果具体：`/archive`（档案管理）与 `/price-channels`（渠道与价格）都是 `module: null`，老板在权限页点一下"保存权限"，**每个角色都会多出这两个入口**。
🔴 实测「让位」影响面**恰好 3 页**：`/bid-radar` `/cron` （module `data`）+ `/roles`（module `chat`）。前两页后端只按模块裁决 ⇒ 让位**诚实**（放开就能真进去）；`/roles` 的 `chat` **人人都有** ⇒ 已 `lock: true` 锁死，否则任何被改过权限的角色都会看到「AI 团队」。
🔴 `lock` 是**显式声明**：`/settings`（module 为 null，天然不会让位）也标了 —— 它是"改权限"这件事本身，后端 `role-permissions` 四端点一律 `core._admin`，放开入口只会造**假入口**。后人给它补 module 时，锁还在。

### 🔴 三态方向：`customRoles` 与 `perms` **刻意相反**
- `perms = null`（不知道）⇒ `canModule()` 返回 true = **不藏菜单**（旧纪律）。
- `customRoles = null`（不知道哪些角色被改过）⇒ **不让位** = 退回内置门槛（**较严**）。
理由：前者代价是老板眼前少几个入口（看得见、可刷新）；后者代价是每个角色**凭空多出**「定时任务 / AI 团队」，看起来就像权限失效 —— 后者更像缺陷、更难解释。`[]`（已确认无角色被改过）与 `null`（不知道）是两件事，别写混。

### 界面响应三层（缺一层就有"改了不生效"）
| 层 | 触发 | 实现 |
|---|---|---|
| ① 当场 | 设置页保存/恢复默认后 | `store.loadPerms(true)`；**不要** `resetPerms()` 前置（会先清 `user.role` ⇒ fail-open 让菜单闪一屏全显） |
| ② 导航 | 每次 `router.beforeEach` | `store.refreshPermsIfChanged()` —— **故意不 await**（否则每次跳页多一次往返）；内部 20 秒节流 |
| ③ 兜底 | 60 秒轮询 + `visibilitychange`（切回标签页） | `Shell.vue` 两个 timer 分开，`force=true` 绕过节流 |

🔴 改前那句 `toast('权限已保存，立即生效')` 是**假承诺**：没有任何代码刷新本地 `store.perms`，侧栏 24 处 `canSee()` 全按旧权限渲染。**它不报错，它撒谎** —— 最伤信任的一类。现在 toast 会区分"已同步"与"未能刷新，请刷新页面"。

### 顺手修掉的两个**静默**缺陷（都不报错）
1. `Settings.vue::loadPerms` 的 `filter(p => known.has(p) || p === 'dashboard')` —— 看着像清理脏数据，实际是**静默数据丢失**：`core._ALL_MODULES` 只有 15 项，而 `_DEFAULT_PERMS` 还用着 `ops-workbench` / `perf` / `goals` 三个**未登记**模块（`boss` 默认持有）⇒ 老板点一次「保存权限」这三个就被从租户库抹掉。**正确做法：不认识 ≠ 丢掉**（未知模块保留在数组里只用于回传；行由 `modules` 渲染，不会多出界面）。要让它可配，正确动作是加进 `_ALL_MODULES` 并补中文标签。
2. `[...(v.permissions || [])]` 遇 **dict 形态**权限（`/api/role-permissions/detail` 存的 `{module:[actions]}`）**直接抛** "object is not iterable" ⇒ 整个 `loadPerms` 落 catch ⇒ **权限页一片空白** + 一句"权限加载失败"。只在"某些租户用过 CRUD 级接口"时触发，本地永远复现不出。已加 `permsToModules()` 两形态归一。

### 本页文案是**功能的一部分**
权限页最容易许诺它兑现不了的事。现在明说三件：① 勾选控制什么（功能接口 + 部分页面入口：经营趋势/AI 中心/算工资/定时任务/招投标雷达）② 哪些页面**产品内置、不受勾选影响**（11 页）③ 多久生效（本人当场；别处已登录最迟 1 分钟）。
⚠️ ~~并**点名**「档案管理」= `data` 模块**粒度粗**：给某角色勾上它，除接口外还会一并放开**定时任务 / 招投标雷达**两个入口（因为该角色从此"被改过"，内置门槛让位）。~~
🔴 **上面这条已过时（v296 已修）** —— 保留划线是为了记住"权限页曾经许诺过它兑现不了的事"：

### v296：模块拆细 + `roleIn` 的「未知」分两判

**① `data` 拆出 `cron` / `bid`（`pages.js` 的 module 轴随之变）**

| 页面 | v296 前 module | v296 后 module | roles（未变） |
|---|---|---|---|
| `/cron` 定时任务 | `data` | **`cron`** | `ADMIN_ROLES` |
| `/bid-radar` 招投标雷达 | `data`（**实际上是 `reports`**，见 backend-auth） | **`bid`** | `[...ADMIN_ROLES,'sales']` |

⇒ 「勾『档案管理』连带放开定时任务」这件事从**根上**没了：两者成了**可分别勾选**的两个项。
`Settings.vue` 的文案同步改成「✅『档案管理』与『定时任务』已经分开」，并补一句
「这三页还各有一层**产品内置的角色门槛**，只有当某角色**被改动过权限**时，该门槛才会让位给您这里的勾选」。
🔴 **只改文档不改模块 = 假修**：让位规则的前提是「勾了这个模块 = 想开这一页」——
`data` 粒度粗时这个前提**不成立**，所以拆细是让位规则的**前置修复**，不是可选项。

**② `roleIn()` 的「未知」必须分两判（v296 修洞）**

```js
export function roleIn(r, allowList) {
  const k = normRole(r)
  if (!k) return true                   // ① 空串 = 未加载 ⇒ 放行（启动竞态，技术性）
  if (!isCanonicalRole(k)) return false // ② 真·未知角色 ⇒ 收紧
  return Array.isArray(allowList) && allowList.includes(k)
}
```

| 情形 | v296 前 | v296 后 |
|---|---|---|
| 空串（权限还没回来） | 放行 | **放行**（不变 —— 否则老板菜单会先消失再出现） |
| `库管`（租户自定义、非空） | **放行 ⇒ 绕过全部 `roles` 门槛** | **收紧** |
| `库管` 已被老板在「设置 › 权限」勾过 | 放行 | **放行**（走 `roleGateOpen` ③ 正门，**不是**后门） |

🔴 **分工别混**：`roleIn` 判**产品内置门槛**（真未知角色是**先收紧、再查名单** ⇒ 对它**恒 false**，
即便有人把 `库管` 字面写进某个内置名单）；**「让位」不经它**，走 `roleGateOpen` ③ 直接比 `customRoles`。
🔴 现场依据：生产 `custom_roles` 实测 `["supervisor","库管"]` ⇒ **这不是假想洞**；
且它同时**造假设入口**（自定义角色进预报页，页内判据说"可以"、后端 `SUMMARY_ROLES` 必 403 ⇒ 用户对着空表怀疑系统坏了）。
⇒ **判据的可判别性**：`库管` 未自定义 ⇒ 对 13 个 `roles` 门槛页 **0 泄漏**；
把 `库管` 写进自定义名单 ⇒ **确有 2 页可见**（`/cron`、`/bid-radar`）—— 有这一对照，才不是"一律 false"的空断言。

**③ 权限页文案漂移**：`tasks` 原显示「定时任务」，但它管 `/api/tasks`+`/api/projects`（任务看板/项目）
⇒ 改为「任务与项目」，否则权限页会出现**两个「定时任务」**，老板勾哪个全凭猜。
**教训：模块的中文名要与页面名对齐，别名一漂移就会出现同名两项。**

---

## 🔴 v300（2026-09-27）员工档案角色下拉：**写死清单 → 动态值域**（把「入口可见性」那条判据延伸到「值域」）

### 缺陷形状：**后端通、UI 断**

`ROLE_OPTIONS` 写死 8 项 ⇒ 本租户真配过的自定义角色（`tenant_1` 的 `库管`，配了 4 个模块）
**在下拉里不存在** ⇒ 生产 `users.role` 里 **0 个 `库管`**。**配了，没人能用** —— 零报错、零异常。

### 修法（`EmployeeArchive.vue`）

- `ROLE_OPTIONS` 从**数组常量** → **`computed`**：内置 8 项（`BUILTIN_ROLE_ORDER`）**在前** +
  本租户自定义角色（`isCanonicalRole` 为假者）**追加在后**。
- `loadRoleCatalog()` 打 `GET /api/role-permissions`；🔴 **403 / 网络异常 ⇒ 静默降级内置 8 项**
  （指派角色本就不该由这些角色做 ⇒ **不该弹错**，但必须**不崩**）。
  ⇒ 与 `roleGateOpen` ③ 同一条纪律：**「让位」是产品行为，不是错误提示**。
- `extraRoleOptions` 必须加 **`.value`**：`ROLE_OPTIONS` 变 `computed` 后，
  **模板里自动解包、模板外不解包** —— `script` 里忘了 `.value` 会静默得到 ref 对象（筛不出东西）。

### 🔴🔴 「适用端」文案 = **三档优先级**，且必须只有**一个来源**

`roleDisplay`/`endLabelOf` 的 label 顺序：**`ROLE_END`（产品定义）→ `roleCatalog`（后端实况）
→ `canUseMiniProgram`（共享兜底）**。
- `ROLE_END` / `ROLE_END_LABEL` **全站唯一一份**（原来 `EmployeeArchive.vue` 手写「（仅小程序）」字样
  ⇒ 一处改动要改两处，必漂移）。
- 🔴 **判据订正**：「能用小程序」= **有 `data`**（**不再**算 `chat`）——
  理由：`chat` 自 v292/v293 起**全员持有**（为副驾代理通道降级而补），**已失去区分度**。
  ⇒ 若某天要再挑一个模块当"小程序能力"的判据，**先查它是不是全员持有**。

### 🔴 `is_custom` **不能**当「这是自定义角色」的判据

`roleCatalog` 每项带 `is_custom`（= 租户库有行）。实测 **`tenant_10` 有 7 个角色 `is_custom: true`
——全是内置角色**（`boss`/`accountant`/`sales`/`guide`/`driver`/`staff`/`supervisor`）。
⇒ 用它判「要不要当自定义角色追加」，**内置角色会被重复列一遍**。
⇒ 唯一正确判据 = **名字是否在 canonical 集合里**（`isCanonicalRole`）。
（这条是**读端点真实 payload** 才发现的，写 mock 永远发现不了。）

### 验收：真机 E2E **双向对照**（`v300-role-dropdown-e2e.mjs`，17/17）

- **反例 A（真实降级）**：`/api/role-permissions` **放行到真后端**（sales 真 403）⇒ 断言下拉 **8 项**、
  不出现「自定义角色」、**零 pageerror**、**零写入**。
- **正例 B（动态生效）**：拦截并**回放端点真实序列化产物**（不是手写 mock）⇒ 断言 **9 项**、
  `库管（自定义角色 · 网页端 + 小程序）`**在第 9 位**、内置 8 项仍在、内置「主管」**只出现 1 次**。
- 🔴 **判别串要选「新旧构建必然不同」的**：`自定义角色`（本轮新增，旧构建 0 命中）；
  以及新 label 形态 `员工（仅小程序 · …`（旧构建是写死的无后缀版）——
  后者**在反例 A 里也必须命中**，才能证明**线上跑的就是本轮构建**，而不只是"没坏"。

---

## 🔴 v309（2026-09-28）输入框「发送 / 停止」= **同一个按钮**，且**流式中绝不能把发送键 disabled**

**触发场景**：任何「AI 回复过程中还能不能干预」的设计（停止生成 / 打断重发 / 排队发送）。

**缺陷形态（本节的可复用判据）**：
发送键写成 `:disabled="… || store.chat.streaming || …"` ⇒ 流式期间按钮置灰、点了没反应，
**全站没有任何中止入口**。这类缺陷有个共同伪装：**按钮看起来"正常"**（置灰态样式本来就有），
所以「按钮坏了」不会有人报，只会报成「**消息发出后停不了**」。

⇒ **判据**：问一句「流式期间这个按钮 `disabled` 吗？」——`disabled` 为真就**不可能**承担停止语义。
停止能力必须落在**同一个按钮**上，靠**分流**而不是靠**多一个按钮**：

```js
// 对齐 WorkBuddy：send-button.tsx
const canStop = loading && !!onStop && !cancelDisabled
handleClick = () => { if (canStop) { onStop(); return } … send() }   // 分流
semanticDisabled = loading ? (cancelDisabled || !onStop) : isSendDisabled
//                  ↑ loading 分支**不看** isSendDisabled ⇒ 流式中按钮仍可点
```

**四条硬件事实（WorkBuddy 本机 asar 实测，可直接照搬）**：
1. 停止态**与发送态同色**（`--cr-send-button-fill-stop == -fill`，light `rgba(0,0,0,.9)`）——
   **不换红**。红只会把「正常中断」渲染成事故。
2. 只换图形：箭头 → **实心圆角方块**（内切于 32 圆盘：**边长 12/32、圆角 r=3**）；
   按下缩到 `scale(.93)`；「只能等不能停」的中间态用 `opacity:.7; cursor:default`。
3. 文案三态 + `aria-disabled: semanticDisabled && !canStop`；二次确认时按钮位置显示**快捷键标签**
   （`send-button__stop-confirm-label`，11px/600）。
4. 中断**不是错误**：保留已生成内容，末条挂 `message.interrupted`（任务被中断），
   **不删气泡、不弹红字**（判据来自 WB 的 `USER_CANCELLED_TEXTS` 处理：命中哨兵只 `slice(0,-1)`）。

**两个必须同时做的配套（少一个就是假按钮）**：
- **HTTP 层**：流式函数要**收外部 signal**，且把它并进 fetch（`AbortSignal.any([外部, 超时])`）。
  🔴 只在前端 `streaming=false` 是**假停止** —— 请求还在跑、tokens 还在烧。
- **错误分类**：外部中止与内部超时必须**可判**（本项目：外部 ⇒ `StoppedError` + `err.stopped=true`；
  超时 ⇒ 原生 `AbortError`）。否则点停止会看到「回答生成超时」——**一句错的提示比没提示更糟**。

**真机验收判据（4 条，缺一即可能恒真）**：
① 流式中按钮 `is-stop` 且 **`disabled===false`**（旧构建此处 true）；
② 停止**之前**页面上**不存在**「已停止」标记（否则「停止后出现」这条断言毫无价值）；
③ 停止**之后**，**打桩服务端要能观察到 `res` 提前 close**（证明真掐断，不是只改前端状态）；
④ 停止后还能**再发一次**（证明组件没被卡死）。
⚠️ 本机验证 `res` 断连时，判据只能用 `res.on('close') && !res.writableEnded`；
**`req.on('close')` 在 POST 上请求流 `end` 后立即触发**，会把第一帧误判成「客户端断开」（实测踩过）。

## 🔴 「点了没反应」的第三类：**生效了但反馈不可辨** —— 修法是**换通道**，不是调透明度（v319e 实证）

判据：状态**确实写进去了**（保存能成功），但界面上**没有任何东西**能让用户确认这一点
⇒ 用户的自然反应（再点一次 / 换个词再搜）**恰好把仅有的痕迹抹掉** ⇒ 必然判定「选不中」。

**范式（商品目标选品，v319e）**：
1. **选完把结果渲染成带文字的常驻卡片**：`✓ 商品名 / 1 箱 = 8 包 / [重新选择]`
   —— 把「我选了什么」从**颜色**（3.6% 色距，不可辨）搬到**文字**（可读结论）。
2. **收起输入面板**：动作完成本身就是反馈；顺带解决"选中项在滚动区 800px 外"。
3. **冻结快照**（`pickedProd`）：换个搜索词再搜，卡片仍在（原实现 `prods.find(id)` 现找 ⇒ 一换词就丢，
   连目标量旁的换算一起消失）。⚠️ 快照要**持有原对象**、别逐字段拷一份（那是第二份口径）。
4. **禁用项也必须可点**（点了给原因 + 就地打开补救入口）：`cursor:not-allowed` + 静默 `return`
   = 用户连试都不试。生产实测这类**占 9.9%**（362 在售 / 36 灰行），不是罕见分支。
5. **清空要彻底**：`clearPick()` 同时清快照 + `form.product_id` + `target_unit`
   —— 只清快照会留下"看得见 id 却看不到选中项"的中间态。

⚠️ **顺带副作用（必须想清楚）**：列表收起后 `.on` 行**不再与列表同时可见** ⇒ 选中高亮退化为
**防御性**样式，**别再指望它当主反馈**。
配套两条：`:hover:not(.on)`（修 `:hover`(0,3,0) **盖住** `.on`(0,2,0) 的**优先级倒置** —— 实测两色
差异都只 3.6%，用户分不出哪个是选中的）；左色条用 `box-shadow: inset`（**不占布局、行宽不跳**）。
🔴 **卡片底别再用半透明色**：`--p-bg` 只有 6%，拿它当主信号 = 把这次的缺陷原样复制过去。

## 🔴 v322 · **同一个"可见决策"被多处各写一遍 ⇒ 必收成唯一渲染口**（角色头像 🚀 事件）

**症状**：老板两次反馈「角色头像不一致」。第一次（v319b）只有**顶栏**写着品牌 logo，改成读当前角色后就以为修完了；
第二次老板指出「截屏里 AI 头像还是 🚀，『将由 AI 副驾回答』前面那个图标也是 🚀」。

**真身**：**同一个判断（"有自定义头像就显示 PNG，否则显示 emoji"）被 5 处各写一遍**，

| 渲染点 | 选择器 | 修前 |
|---|---|---|
| 副驾顶栏 | `.cp-ai-img` | ✅（v319b 补） |
| 输入框胶囊 | `.cp-role-av` | ✅ |
| 角色菜单项 | `.cp-role-item-av` | ✅ |
| **「将由 X 回答」行** | `.cp-who-av` | ❌ **纯文字格，从没读过 `custom_avatar`** |
| **消息头像回落分支** | `.msg-avatar` | ❌ **只回落 emoji**（无快照的消息全中招） |

⚠️ 生产真身：4 个角色**全部 `custom_avatar=1`** —— **emoji 只是"没上传头像"的兜底**。
所以"只打印 emoji"这类代码**在生产上必然错**，而且**零报错**。

### 三条通用律

1. 🔴 **一个"可见决策"只能有一个实现口。** 判据是：「同一个 if（判字段/判状态）在几个文件/几处重复出现？」
   ≥2 处就抽成**组件**（不是抽成函数 —— 组件是**渲染路径**，能强迫两分支都存在；
   抽成工具函数时，调用方照样可以只写 `else` 那一支）。
   本项目实例 = `components/RoleAvatar.vue`：**7 处**（CopilotDrawer 5 ＋ RoleManage 2）全部改走它，
   两处散落的 `avatarUrl()` **删掉**。
2. 🔴 **回落分支与主分支一样要审。** 本次两处漏判里，一处是"只会 emoji"，另一处更隐蔽 ——
   **`A || B` 的回落链**：`(m.roleMeta && m.roleMeta.avatar) || (currentRole && currentRole.avatar)`
   看起来"有兜底"，但**兜底取的是 emoji 字段**，于是"没有快照的历史消息"（服务端拉回的那些）
   一律退化成 emoji。⇒ 审回落时问一句「**兜底那个表达式的类型/语义，和主分支一致吗？**」
3. 🔴 **"某个字段在生产上恒为某个值"时，不要在代码里保留另一条看起来能用的路径**并假装它会走 ——
   而应**验证**它。判据：`curl <生产>/api/ai/roles` 看 `custom_avatar` 的真实分布
   （本次 4/4 全为 1）⇒ 才能断定"只读 emoji"= 一定错。

### 顺带修的两件事

- **PNG 加载失败**（角色被删 / 文件丢）⇒ 组件用 `@error` 自动退回 emoji，免得界面出现**裂图**；
  `watch(src)` 让换角色或重传头像后自动复位重试。
- **编辑态预览要取"实时值"**：`RoleManage` 弹窗里的 emoji 必须取 `form.avatar`（输入框 `v-model` 的值），
  不能取 `editing.avatar`（打开弹窗那一刻的快照）—— 否则用户改 emoji，预览纹丝不动。
  （收进组件时用计算属性 `editingAvatarView` 保住这个语义。）


## §v326 界面文案里不许出现「实现细节」

- 病根：本仓习惯把「为什么这么设计」写成段落，而**有些是写在模板里的**（= 会渲染给老板看）。
  权限面板曾常驻 8 段：版本号（v296/v311/v312）、模块键名、「角色门槛让位」规则、产品内置模块名单、
  「两处归位」…… 老板既看不懂，又会把它当成「系统坏了」的线索去读。
- 处置：整块撤掉，换**默认收起**的一行入口（`.pm-help-tb`）＋ 3 句业务语言
  （那一列是什么／什么时候生效／哪些账号会跟着变）。🔴 留下来的那 3 句**仍然是功能的一部分**：
  权限页最容易犯的错是「许诺一件它兑现不了的事」—— 老板勾了模块、界面没变，就会认定系统坏了。
- 🔴 **审计必须覆盖三处，缺一处就漏**（v326 实测漏了第三处）：
  ① `<template>` 文本节点；② `title` / `placeholder` / `aria-label` 属性（**也是看得见的**）；
  ③ `<script>` 里 `confirm` / `toast` / `alert` / `prompt` 的**字符串字面量**。
  实证：`confirm('把「X」的登录端恢复为出厂默认？')` 只躲在第③处 —— 只扫模板的版本报「OK」，
  而线上字节里那句还在。
- 工具：`.workbuddy/tools/ui-devtext-leak-audit.py`（扫 `src/**/*.vue`，**自带反例自证**）。
- 🔴 两个"写正则时的坑"（都被反例自证当场抓住）：
  ① 顶层模板**不能**用 `\n</template>` 收尾 —— 「不带换行就闭合」的文件会被**整份跳过**
     ⇒ 该文件判为「干净」= **假绿**；也不能用非贪婪到**第一个** `</template>`
     （Vue 里 `<template v-if>` 遍地都是 ⇒ 截断）。
     正确写法：**首个 `<template>` → 最后一个 `</template>`**。
  ② `toast('x')` 紧跟 `</script>` 时，按"收尾字符类"匹配会**整条漏掉**；按第一个 `)` 切又会
     **截断** `(a+b)` 拼接串。正确写法：**按括号配平**取参数。
- 边界（哪些**不算**泄漏，别一律删）：`title="必选项，不可取消"`、`「登录端已改」`、
  分节标题里的「（决定新建账号的默认值）」都是**业务语言**。
  判据 = **「它解不解释老板看得见的行为」**。反面样本：「与后端算法一致」「落库」「出厂默认」
  「后端推送未部署」—— 这些只解释了**我们的实现与发版状态**。
- 同轮另清（同页/同族）：`Settings.vue` 的 tooltip「出厂默认」、客户开通页「替代 SSH 手工开号」、
  **死代码 `ROLE_DESCS`**（全仓无引用，且其 `staff: '填报 + AI 对话'` 已被 v325 推翻 ⇒ 谁渲染它谁写错话）、
  `Forecast.vue` 的 `（后端推送未部署）`×2 与 `才会存到后端`。

### 🔴 v327（同日）：「面板内」是老板的**提问范围**，不是**产品口径** —— 已按同判据清到全站 0 处

- 老板 v326 的后半句是「**并检查面板中是否还有其他**…」（限定面板内），但他给的那条判据是**通用的**
  （**文案在对用户说话，还是在对开发者说话**）⇒ 同一个 bug 的另外 9 处还在面板外，留着 = **没修完**。
  处置：按同判据一并清掉（**9 处 / 6 文件**），工具读数 60 个 `.vue` **9 处 → 0 处**。
- 🔴 **手法铁律：只删/换「实现层措辞」，绝不连业务信息一起删**。同一句里往往**一半该留一半该删** ——
  「仓库还没建？去『档案管理 → 仓库档案』先建。**（v294 起才真正生效）**」只需砍掉括号那半句。
  同理 `LossAccounting.vue` 那句：删「数据模型完全一致」（实现词），保留并改写成
  「将来用导入也能接在同一本账上」（业务信息）。
- 🔴 **判「这包有没有夹带 / 有没有回滚」，绝不能按文件名比**（本轮最值钱的一条）：
  chunk 名 = 内容哈希 ⇒ **一个源文件变、import 它的整张图都改名**。实测：只改 5 个源文件，
  却出现 **32 对 chunk 改名**（`diff -rq` 只有 `index.html` 一行 `differ`）。能穿透的只有两条：
  ① **中文串集合差**（压缩后中文字符串内容不变）—— 本轮 新构建独有 **6** / 基线独有 **11**，逐条对上改动；
  ② **`rsync -c`**（校验和模式；输出全 `.f..t....` = 仅时间戳不同、内容全同）。
- 🔴 **归因的正确基准 = 上次部署的产物**：本轮 `dist-v326c/index.html` 的 md5 **正好等于生产线上**
  ⇒ 它就是「线上那份」，直接与它 diff，比「下载生产 assets 再按逻辑名配对」省事且无歧义。
  反过来：**构建产物目录要留着**（`dist-v32X`），它就是下一次的归因基准。
- ⚠️ **定点 grep 找不到 ≠ 没上线**：`ReportMapping.vue` 那 4 处文案并进了 **`Forecast-*.js`**
  （不在同名 chunk 里）⇒ 搜同名 chunk 一无所获。先 `grep -rl <串> .` 定到**哪个 chunk**，再下结论。

## 🔴 v332（2026-09-29）：**侧栏可见性 = 角色轴 ∧ 模块轴**（新增 `moduleAny` 语义）

- 老板原话：「如果该角色没有这个权限就不显示这个侧栏」。病灶 = `pages.js` 里 `/forecast`、
  `/loss-accounting`、`/archive` 都是 `module: null` ⇒ **只判角色轴** ⇒ 角色名单里有、模块没有
  = **假入口**（看得见、点进去 403 恒空）。
- 修法：`canSeePage = roleGateOpen ∧ module ∧ moduleAny`（两轴**取交集** ⇒ **只更严、不放宽**）。
  · `module`（单值）= **必须有它**（整页数据归一个模块的页面）；
  · `moduleAny`（数组，v332 新增）= **至少有一个** —— 只给**容器页**用（`/archive` 五个页签
    分属 hr/crm/data/stock，任一可用这一页就有意义；挂单值会把有权限的人挡住或把没权限的放进来）。
  🔴 两处都必须 **「`canModule` 不是函数 ⇒ 放行」**（沿用「拉不到 ≠ 没权限」）。`moduleAny` 尤其
  容易写错：空 `some()` 天然 false ⇒ 漏了守卫就会在"权限未加载"时把容器页整页隐藏，
  **而且只在启动那一下可见**（极难复现）。
- 🔴 **容器页的页签必须逐条登记 + 兜住 redirect**：`/archive` 的路由 redirect **写死**
  `/archive/employees`（要 `hr`），没有 hr 的角色（如主管）会落在**不可见页签**上 ⇒ 页签条
  一个都不渲染、面板空白，用户只会报「档案管理打不开」。修法 = 页签由
  `TABS.filter(t => canSee(t.path))` 生成 ＋ `watch(tabs)` 落到第一个可见页签。
- 加 `module` 后 **`MODULE_IMPACT.entries` 必须同步**（护栏 `.workbuddy/tools/role-registry-consistency-check.py`
  逐项比对，**100/100** 才算过）。
- ⚠️ **未修的同类**（待拍板）：`/loss`（货损计算工作流）、`/data-fill`（库存效期补录）同属
  `BIZ_ROLES` 但接口在 `stock`/`data` ⇒ 同一病灶；修法取决于「是否要给主管/会计开这两个权限」。

## §v335 页内按钮级门禁 —— `canDo(模块, 动作)`（2026-09-30）

`store/index.js` 的 `canDo` 是**唯一实现**（三态与 `canModule`/`canCap` 同一条纪律，不另写一套）：

```js
function canDo(module, action) {
  if (!module || !action) return true          // 代码缺陷 ⇒ 放行
  const pa = permActs.value
  if (!pa) return true                         // 不知道 ⇒ 不隐藏（fail-open）
  const star = pa['*']
  if (Array.isArray(star)) return star.includes('*') || star.includes(action)
  const acts = pa[module]
  if (!Array.isArray(acts)) return false       // 没有这个模块（fail-closed）
  return acts.includes('*') || acts.includes(action)
}
```

🔴 **fail-closed 的代价**：模块键**写错** ⇒ **整页按钮消失**，而构建通过、运行期零报错、人工难发现
⇒ 必须有静态护栏（`tools/v335-button-gate-check.py`，6 条判据 + 5 条反例自证）。

### ① 🔴 护栏的 C6 判据来自「护栏自己的盲区」（本轮最值钱的产出）

首跑报 `Rebate.vue 计数 32 ≠ 写死的 33`。**根因不是漏做门禁**，而是**字面量正则看不见三元表达式**
（`canDo('sales', editingContractId ? 'update' : 'create')`）⇒ 护栏对这类输入**失明**，而失明处
正是错误最容易藏的地方。补 **C6**（`ANY_CALL_RE` 抓 `canDo(...)` 全形态 − 字面量命中 = 必须登记在
`NON_LITERAL_ALLOW`）+ 第 5 条反例自证（三元必须转红）后全绿。
⇒ **纪律：护栏第一版必须假设「它会对某一类输入失明」，并把该类显式列为待登记项。**

### ② 🔴 「置灰」而非「消失」的场景（系统化，非随手）

表单**最后一步**的保存按钮（`Rebate` 合同弹窗）凭空消失会让用户以为「填完了却没下一步」⇒ 用 `:disabled`；
同理 `:disabled`/`:readonly` 用于矩阵、`<select>`、月度输入格、审批流五按钮（叠在既有状态条件上）。
**保留角标但不可点**用于报单 note-badge（角标是信息、不是操作）。

### ③ 🔴 产物级判据必须用**中文提示串**，不能用 `canDo` 字面量

实测：`canDo` 只在 **index chunk** 出现 **2 次**，**页面 chunk 全 0**。
这**不是**「门禁没编进去」，而是 `@vitejs/plugin-vue` 的 **inline 模板编译**把 setup 绑定编译成
**短名直接调用**（`canDo('sales','create')` → `d('sales','create')`）⇒ 字面量必然消失。
⇒ 判据改用中文提示串（压缩器**不改写字符串字面量**）：`不能保存报单` → Forecast chunk、
`当前角色无权创建返利目标` → Rebate chunk、`你没有撤销导入的权限` → ImportReceipt chunk —— 全部命中。

### ④ 🔴 真机验收：**响应改写**（生产权限值是全动作 ⇒ 门禁今天不隐藏任何按钮）

装置：`ctx.route('**/api/auth/permissions*')` → `route.fetch()` → 只改交给前端的那份 JSON 的
`permissions_detail` → `route.fulfill({response, body})`。**零写入生产。**
探针 `tools/v335-button-gate-e2e.mjs` **17/17**：`data⇒read` 时 `/data-fill` 的「选择文件」消失
而 `/rebate` 按钮仍在（**活体证明「按接口模块判、非页面模块」**）；`sales⇒read` 时 `/rebate`
两个入口按钮消失。

**探针自己的三条纪律（本轮全踩过）**：
- **(a) 必须强制整页重载到指定路由**。第一版用 `page.reload()` —— 它**留在上一次的 hash 上** ⇒
  「按钮消失」是「页面不对」造成的**假阳性**（把好产品报成坏产品，与放过坏产品一样贵）。
  正解：`page.goto(BASE + '/?v=N#/hash')`（查询串变化 ⇒ 必然整文档重载，hash 再定路由）。
- **(b) 每阶段必须自证刺激真的落地**：断言页面**实际收到**的 `permissions_detail` 形态（数字写死）。
- **(c) 断言值必须归一化**：`https://host/path` 与 `/path` 直接比 ⇒ 判据恒报失败，看起来像
  「有越权写入」，其实是探针自己比错了。

### ⑤ ⚠️ **同一元素在不同 tab 里** ⇒ 断面前先切 tab

`/rebate` 的「+ 创建品牌目标」在 **目标与返利（rules）tab**，而页面**默认 tab 是仪表盘** ⇒
不做 `page.click('.main-tab:has-text("目标与返利")')` 就必然 0（第一版据此误判「按钮不存在」）。
**通用做法**：新增/修改按钮类断言前，先确认真实 DOM（dump 一次按钮清单），别按印象写选择器。

### ⑥ 🔴 `grep -o '...\.\(js\|css\)'` 的 `\|` 交替**静默失效**（本仓第 5 次）

本轮实测：同一 URL 用 `grep -o 'assets/index-…\.\(js\|css\)'` 返回**空**，拆成单模式立刻命中
⇒ 差点误判「首页未生效」。**纪律升级**：不止「多条模式用 `-e`」，**`\(a\|b\)` 也属多模式** ——
一律拆开或 `-e`。同族：`grep --include=*.py` 在 zsh 报 `no matches found` ⇒ 必须引号或用 Grep 工具。


---

## 🔴 v336（2026-09-30）：**状态色不可复用** —— 加新色前先 grep 既有类名

### 起因

需求原话是「把加单的那个数字**变红**，鼠标悬停可以看到这个数是怎么来的」，
但老板紧接着纠正：

> 「变红或变大/加背景色/高亮等是我举了一个例子，你自己可以看一下哪个更好，
> 更符合我们的UI设计规范」

⇒ **不能照字面用色**，要先查这个色在本项目**有没有被占用**。

### 实测：本项目红色**已被三处占用且语义固定**

| 类名 | 语义 |
|---|---|
| `.cell-minus` | 减单（红字 ＋ 加粗 ＋ 红框） |
| `.cell-err-dot` | 硬错角标 |
| `.final-neg` | 最终下单为负 |

而「**没人可分**」（加单格填了数但没有任何人能承接）**不是填错**，是**配置缺失**
⇒ 语义不同 ⇒ **不能再借红色** ⇒ 改用**琥珀** `--warn-amber`（浅色 `#854F0B` / 深色 `#e2b274`）。

### 判据（可复用）

> **新增任何状态色之前，先 grep 既有颜色类名**，确认 **没被占用** 且 **语义不冲突**；
> 冲突时**降级到语义更弱的色**（红 → 琥珀 → 灰）。

```bash
grep -rn "cell-minus\|cell-err-dot\|final-neg\|danger-txt" hergent-cn-v2/src/
```

### 视觉通道分配（v336 落地方案，可照抄）

| 通道 | 用途 | 实现要点 |
|---|---|---|
| 数字颜色 | 减单 = **红**（既有，优先）；悬空 = **琥珀 ＋ 加粗** | `font-weight: 600` |
| 左侧竖条 | 悬空行标识 | `box-shadow: inset 2px 0`，🔴 **挂在 `<td>` 而非 `<input>`** —— 否则被单元格裁剪 |
| 角标 | 新增第五态「**悬空**」 | `.pt-xm-b.has-void` |
| 悬停 | 完整来源链（含成因 ＋ 修法） | `ptExtraTip` / `ptExtraInputTitle` |

### 🔴 连带纪律：**同一事实只能有一个说法**

`ptExtraTip`（悬停）与 `ptExtraInputTitle`（格内）是**同一语义的两份实现**，
两处都**无条件**说「本期没有人报过这个商品」——而真数据里该商品本期**有 18 箱报单**，
只是报单列头映射不到员工 ⇒ **界面在说假话，经理会去查一个不存在的问题**。

实测两函数**不可复用**（`ptExtraInputTitle` 里 `g` 定义在被引用行**之后**；
`ptExtraMark()` 依赖 `ptAlloc`，而「无人可分」恰是 `ptAlloc` 为空的情况）。
⇒ 结论不是「硬抽一个函数」，而是：**两份实现 ＋ 同一份判据 ＋ 同一套分支**，
并在两处都写注释指向对方。

⇒ **新增/修改任何用户可见的因果说明**（「因为…所以…」「本期没有人…」）时，
先问**这句话的反面有没有真实数据能证明它**；有 ⇒ 必须分支。

### 相关：数值输入格相关的两个前端陷阱（探针侧也适用）

- 数值输入格**未填**时可能渲染成 `"0"`（**不是空串**）⇒ 判「未填」必须走逻辑值
  `Math.abs(Number(v) || 0) < 1e-9`。
- 界面文案**禁实现细节/内部逻辑**（v331 铁律）—— v336 新增文案里刻意只讲
  「去『报单配置』把该列头对应到报单人」，不提表名/字段名。

---

## 🔴 v341（2026-09-30）「撤了权限、入口还在」—— 容器页禁用 `moduleAny`

**报障**：「取消了主管的档案管理权限，他的账号登录后仍看得到档案管理」。
**根因**：入口可见性 = 两条轴 `roles` × `module`，而**权限页里能勾的每一行都是「模块」**。
`/archive` 当时写的是 `moduleAny: ['hr','crm','data','stock']`（任一命中即显示）——
主管被撤的是 `data`，但**他还持有 `stock`**（v332b 为「货损核算」授予）⇒ `moduleAny` 判"这页对他还有用" ⇒ 入口照常出现。
**一句话**：入口问的是"你手上还有没有一个档案类模块"，你以为它问的是"档案管理这个能力你开不开"。

**判据（下次给容器页加轴先问这一句）**：权限页上**有没有一个开关就叫这个名字**？
有（如「档案管理」↔ `data`）⇒ **单值 `module`**；只有真分属多模块、每个都该能独立进，才用 `moduleAny`。
🔴 子页签**仍要逐条登记** —— 容器门槛与页签门槛是**两道**，只改容器会出现「进得去档案管理、点『员工档案』却 403」。

**「跳转入口」是一族，不是一处**（本轮修了 4 处漏判据）：

| 位置 | 缺口形态 |
|---|---|
| `DataLedger.go(cat)` | 跳转路径来自 `CAT_META` **配置表** ⇒ 只判了"这一格有没有目标页" |
| `ConnectCenter.openWorkflow(w)` | `w.path` **后端下发** ⇒ 只判 `w.ready`。🔴「**开通**」是**租户级**事实、「**可见**」是**账号级**事实 —— 两句话长得像，不是同一句 |
| `Settings.vue` 库存效期补录按钮 | **设置页能进 ≠ `/data-fill` 能进**（模块不同） |
| `AiHub.vue::isAdmin` | 读 `localStorage` 登录快照、**硬编码** `role==='admin'\|\|'boss'`（与 `ADMIN_ROLES` 各一份，且不随事后改角色重算） |

🔴 **规律**：凡「**跳转路径来自配置表 / 后端下发 / 数组**」的入口最容易漏判据 ——
写代码时手上没有具体 path，就顺手只判了"能力开通了吗"，漏了"**当前这个人**有权限吗"。
排查：`grep -rn "router\.push\|router\.replace" src/` 逐条问「这个 path 过没过 `canSee`」。
⚠️ `AiHub` 那处**故意不加模块轴**：该页动作的后端模块键未核实，猜错键会让**所有人**的按钮一起消失
（`canDo` 对未知模块 **fail-closed**）—— 「不知道就先不加」比"加一个错的"安全。

**验收定式**：真机探针必有**第 4 个相位 = 只给兄弟模块、不给目标模块**（例 `[dashboard,hr,crm,stock]` 无 `data`）
⇒ 目标入口**必须消失**。这条**专门区分 `moduleAny` 与单值 `module`** ——
少了它，「入口消失」可能只是"这个角色本来就不在 `roles` 名单里"，与本次修复无关。
参考：`.workbuddy/tools/v341-archive-entry-e2e.mjs`（6 相位 14 项全绿）、逻辑级 `v341-archive-gate-probe.mjs`。

---

## 🔴 v345（2026-09-30）「让位」会吞掉角色名单 —— `lock` 不是保险，是**必须**

**报障**：「郝洋的账号不应该看到我的定时任务才对呀」。`/cron` 写的是
`{ module:'cron', roles: ADMIN_ROLES }` —— 有角色名单、有模块轴，但**没有 `lock`**。

`roleGateOpen` 三档，第 ③ 档「用户配置优先」：
**本租户改过该角色权限（`custom_roles` 含它）⇒ 内置角色名单让位**，改由 module 轴单独裁决。
⇒ 于是「只给 admin/boss」这句话形同虚设：只要该角色**持有那个模块**，入口就出来。

**主管为什么持有 `cron`**（生产真值，只读查 `tenant_1.db::role_permissions`）：
v296 拆模块时按「谁原本调得通 `/api/cron`」给 **boss/sales/staff/supervisor 都补了 `cron`**；
而老板**撤主管 data 的那次保存**，把该角色当时的完整权限集**一并落库固化** ⇒
`cron` 从"迁移自动补的"变成"客户显式勾过的" ⇒ 让位放行得更理直气壮。

**判据（给「名单 + 模块」并存的行加轴时先问这一句）**：本行的 `module` 是不是**名单外角色也可能持有**？
会 ⇒ 必须 `lock: true`。同族已锁三行（`/ai-hub`、`/roles`、`/settings`）挂的都是 `chat`（人人都有）
⇒ 它们**早就**加了；`/cron` 挂 `cron`，当时以为「窄模块没人有」**而主管恰好有** ⇒ 唯一漏网的一行。

### 🔴 全表审计：三条判据缺一不可（`tools/v345-rolegate-audit.mjs`）

13 行「有 roles ＋ 有 module ＋ 无 lock」= **静态可达**。但只看静态**会大量假阳性**，必须再加第三条：

| # | 判据 | 少了它会怎样 |
|---|---|---|
| ① | 有 roles（角色名单） | — |
| ② | 有 module 且**无 lock** | 判不出"可能漏" |
| ③ | **名单外角色在租户库里真的持有该模块** | 🔴 会把"根本走不通"当成洞 |

**本轮亲身踩到**：第一版审计据**桩值**把 `/bid-radar` 判成「会计可见」——
查租户库真值才发现**会计并不持有 `bid`**，真正持有的是**主管**。
⇒ 探针 ⑥ 改成**真值驱动**（桩的角色与模块清单全部照抄 `tenant_1.db::role_permissions`）。
🔴 **一句话纪律：桩值能证机制，不能证存在。**

**本租户产出**：真活洞 `2` 个 —— `/bid-radar`（主管持 `bid`）、`/forecast`（库管持 `data`），
`/cron` 已修。而 `/archive*`、`/loss*`、`/data-fill`、`/rebate` 名单覆盖满 5 个业务岗 ⇒
让位是给**自定义角色**开的**正门**，非缺陷 —— **宽名单与窄名单必须分开判**。

### 🔴 入口断了 ≠ 数据断了（比 v341 更彻底，但仍有一层）
`lock` 同时让**路由守卫**拦住深链（`pageRoleAllowed` 走同一个 `roleGateOpen`）⇒
修后主管手敲 `#/cron` 直接落回工作台（v341 的 `/archive` 只断入口，深链仍能进容器）。
⚠️ 但**直调 `/api/cron` 仍然通** —— 前端只是门帘。要真正关掉须撤**后端授权点**：
租户库 `role_permissions` ＋ 后端 `_DEFAULT_PERMS`（新租户）＋ 迁移脚本目标角色表。
🔴 **撤之前先查该模块的接口家族**（本轮核实 `/api/cron` 只有 `routers/cron_tasks.py` 一族 ⇒
无连带，才敢建议撤）：`grep -rn '"/api/<模块>' /opt/hergent-erp/{server.py,routers/*.py}`。

参考：`tools/v345-cron-delegate-e2e.mjs`（真机 16/16，含真值驱动同族取证）、
`v345-cron-gate-probe.mjs`（逻辑 15/15，翻转用例 C01 入口、C13 守卫）。

---

## §v348（2026-09-30，方案·**未上线**）角色权限页「四类维度」重构侦察

需求原话：「权限项重新设计为 ①侧栏暴露的功能模块 ②是否可用 AI ③可使用 Web 端 ④可使用小程序端」。
盘点脚本 `.workbuddy/tools/v348-perm-dimension-audit.py`（只读；AST 取后端字面量 + 正则取 `pages.js`/`Shell.vue`，三源对齐）。
交付：`outputs/v348-角色权限四类维度重构方案-2026-09-30.md`，原始输出 `outputs/v348-perm-audit-2026-09-30/audit.txt`。

### 一、病根 = 行来源选错了轴
权限页的行来自 `server.py:1178-1199 list_modules()` ← `core._ALL_MODULES`（**19 个后端模块**）；
而老板认的是 `Shell.vue:214-242` 的 `NAV`（**侧栏 10 个功能**）。两个集合**不一一对应**，产出三类：

- **一行都没有**（`pages.js` 里 `module: null`）：`/workbench` 经营工作台、`/connect` AI 引擎、`/settings` 设置。
  🔴 其中两个**刻意不该有开关**：首页是登录落地页（挂了模块 = 员工登录白屏）；设置是权限页本身（`lock:true`）。
  ⇒ 正解是**只读固定行**（显示出来 + 说明为什么不能关），不是"补个模块"。
- **关得掉但行名对不上**：目标与返利 = `sales`「销售管理」；货损核算 = `stock`「仓库管理」。
- **一个开关管一串页**：`MODULE_IMPACT['stock'].entries` 一次管 **4 页**（货损核算/货损计算工作流/库存效期补录/仓库档案）；`data` 管 3 页。

### 二、值得记住的硬事实（全部实测）
- **7 个模块"勾了在新前端零变化"**（`entries` + `feeds` 双空）：`buying`(16 前缀) `accounts`(**61**) `reports`(14)
  `projects`(2) `goals`(1) `tasks`(1) `messages`(1)。它们是**数据闸门不能删**，但不该与侧栏功能平铺在同一张 19 行表里。
- **AI 维度早就在，只是不是"一行独立维度"**：`store/index.js:193 canUseAi() = canModule('chat')`，5 个入口读它
  （`Shell.vue:17` 顶栏、`Shell.vue:441` ⌘K、`Workbench.vue:238`、`Forecast.vue:1982`、`CommandPalette.vue:74`）。
  🔴 **`_DEFAULT_PERMS` 里 9 个角色只有 `admin`(`*`) / `boss` 持 `chat`** ⇒ 其余 7 类（含主管/会计/业务员）用不了副驾。
  放宽**不用改代码** —— 权限页勾「AI 功能」那一行即可。
- **端轴 ≠ 功能轴（必须并行显示、绝不合并成一个勾）**：
  ①②在**会话内**裁决（后端 `_check_perm` 按模块 ＋ `pages.js` 按角色）；③④在**登录那一刻**裁决（`users.login_scope` ← 角色政策 `role_end`）。
  ⇒ 改端**只改将来新建账号的默认值**，**不动已有账号**（已有账号的端在员工档案里逐账号可改）。
- 🔴 **关掉 AI ≠ 全关**：`/api/ai/sessions`、`/api/ai/search-chat`、`/api/ai/media` **豁免模块判定**（`server.py:839-841`）
  ⇒ 无 `chat` 的角色仍能列/读/写**自己的**会话与附件（刻意如此）。`/hermes/` 直连实测 `hergent.cn` → **403**（v281 仍生效）✅。
  ⇒ 准确口径：关「可用 AI」= 关掉**发起新对话**（`/api/ai/copilot/chat` 归 `chat`）。

### 三、后端**已下发、权限页从未读取**的字段（"埋起来的能力"）
| 字段 | 后端位置 | 后果 |
|---|---|---|
| `modules[].mini` | `server.py:1193` / `core.MINI_MODULES = ("data","messages")` | v331c 删了只读「手机端」列 ⇒ **没人告诉老板"这个功能在小程序里到底有没有页面"** |
| `modules[].feeds` | `server.py:1198` / `core.MODULE_IMPACT[*].feeds` | **「AI 引擎」的数据闸门只写在 `chat.feeds` 里，而 feeds 不显示** ⇒ 结构性看不见（§一 第 2 行的根因） |
| `roles[].is_default` | `server.py:1238` | 前端改判 `isCanonicalRole(name)` ⇒ 两份实现（v331 曾因此全员误标"自定义角色"） |
| `roles[].end_builtin` | `server.py:1247` | 「恢复默认」的比对基准缺失 |
| `roles[].default_login_scope` | `server.py:1248` | 前端本地 `endToScope()` 重算 ⇒ 又一份实现 |
| `GET /detail` 的 `modules`/`actions` | `server.py:1450` | `Settings.vue:540` 硬编码 `permActions` ⇒ 动作表第二份 |
| 动作轴 `read/create/update/delete` | `core.py:744` `_ALL_ACTIONS` | **只在「按角色配置 → 单角色详情」有**；批量总览矩阵没有 ⇒ 半暴露 |

**端点侧 9/9 全部已接**（`/api/permissions/modules`、`/api/role-permissions` GET/POST、`/new`、DELETE 角色、`/end` POST/DELETE、`/detail` GET/POST）
⇒ **没有"有接口没界面"的端点；缺的是页面的组织方式。**

### 四、可复用的方法论（比结论更值钱）
- 「够不够全」不能靠肉眼：写一支把**三份清单**（`Shell.vue NAV` / `pages.js PAGE_RULES` / `core._ALL_MODULES`）
  机器对齐的脚本，一次就产出"谁没行、谁一关多页、谁勾了没变化"。
- 🔴 判「前端有没有读某字段」**必须先剥注释**：本仓注释密度极高，`is_default`/`feeds`/`手机端` 都在注释里出现过，
  不剥就会把"注释里提过"当成"读过"。只剥**整行** `//`（不动行内，避免砍掉 `https://`）。
- 🔴 字段读判据要**精确到对象名**：查 `m\.mini` 而不是 `mini` —— 否则 `role.end.mini` 会把"未读"误判成"读过"（本次实测踩过）。
- 🔴 侧栏项**加了模块 ≠ 客户能关**：`pages.js:375` 第 ③ 档「**没有 `module` ⇒ 不让位**」是安全阀
  ⇒ "按侧栏功能出行"必须落在**展示层**；要物理成立就得给该页建**真模块**（三处同改 + 迁租户）。

---

## §v349（2026-09-30，已上线）拆 `loss` ＋ 撤 `dashboard` ＋ 权限页四类维度

老板四项拍板全落地。三个**以后必然复用**的教训：

### 一、撤模块前先量化「它到底裁决几个前缀」
`dashboard` 在 `_PATH_MODULE_MAP` 里只裁决 **2 个前缀**（`/api/dashboard`、`/api/today`）。
⇒ 撤它的全部可见后果 = 「经营趋势」入口消失 + 首页三块数据消失（今日利润/最近操作/今日待办）。
**先量化再动手**：不量化就会把「今日待办」（一线刚需、不是经营数据）连着一起撤掉。
要「待办留、利润不给」⇒ 单独拆 `/api/today`（待办 v350）。

### 二、🔴 撤模块必须同批处理「兜底骨架」
`Workbench.vue::kpis` 在 `dashData=null` 时兜底返回「¥— / **加载中**」骨架 ⇒
没权限的人看到的是**永远加载中的 KPI 条** —— 比空卡片更糟（暗示"马上有数据"）。
**撤数据源 = 同批给消费方加 `v-if="store.canModule(模块)"`**（本轮 KPI 条已加）。
同族：v347 的 forecastDenied 横幅。**每次撤权限都要问一句：谁在消费它、消费方的 null 态长什么样。**

### 三、🔴 权限页 `module:null` 行的三条铁律（permView.js 落地时踩的）
1. **绝不能画可勾的框** —— `roleGateOpen` 第③档"没有 module ⇒ 不让位" ⇒ 勾了不生效 = 界面说假话。
   渲染成**只读说明「不在此配」+ 一句话说清它归谁管**（首页=落地页不能关 / AI 引擎=跟着「可用 AI」走 / 设置=权限页本身）。
2. **`groupChecked`/`toggleGroup` 必须过滤 fixed 行** —— fixed 行 id 是合成键（`__fixed_xxx`），
   永远不在 `role.perms` 里 ⇒ 不过滤则组头勾**永远打不上**且看不出原因。
3. **保存链路天然安全**：fixed 行没有 checkbox ⇒ 不会产生 togglePerm ⇒ 不会写回垃圾键。

### 四、探针三条教训（权限页验收特有）
1. **权限页数据接口归 `hr`**（`/api/permissions/modules`、`/api/role-permissions`）⇒
   非管理角色探针 403 ⇒ 矩阵空（症状=「没有匹配的模块」空态，不是报错）。
   解法：route 改写注入**照抄后端 MODULE_LABEL/MODULE_IMPACT 的真值**验证渲染层；边界必须交底。
2. 🔴 **取文本限定在矩阵表内**（`table.filter({hasText:'登录端'})`）—— `body.innerText()`
   会把侧栏的「档案管理/设置」一起算进来 ⇒ 行名断言假阳性（实测踩过：10 个同名项全"命中"）。
3. 权限 tab 默认「按角色配置」视图；四类维度矩阵在**「批量总览」**子视图 ⇒ 探针必须先点它。

---

## §v350（2026-10-01，已上线）权限页两个 P0 修复 ＋ 目标形态原型（路线 A）

老板拍板「1.今天就上；2.A；3.要」⇒ ① 第 1 批 P0 修复上线 ② 批量总览整合进角色详情页（路线 A）③ 先出静态原型。
本轮纯前端零行为变化 + 后端 1 处豁免；探针 **26/26**、护栏 **112/112**、双侧 md5 一致。

### 一、🔴 病根：**多视图 = 多写入口 ⇒ 保护规则必须单一实现**

权限页有两个写同一张表的视图，**写的数据形态不同**：
- 矩阵视图（批量总览）写 **list 形态**（`perms[模块] = [actions...]`）
- 详情视图（按角色配置）写 **dict 形态**（`perms[模块] = {action: bool}`）

⇒ 「老板的 `hr`/`data` 是必选、不可取消」这条规则**只在矩阵视图实现**（`disabled` +
`togglePerm` 早退 + `toggleGroup` 过滤），**详情视图零防护**。

**自我锁死链条（P0-1）**：
1. 详情页取消 boss 的 `hr` 里任意一个勾
2. `normalize_perms_shape` 原样返回 dict ⇒ 后端**整列覆盖**
3. boss 覆盖行缺那个 action ⇒ `perms_for` 按角色**整表覆盖**
4. `_perm_granted` 拒绝 ⇒ `/api/permissions/modules`（映射 `hr`、**未豁免**）403
5. `Promise.all` 抛 ⇒ `permRoles=[]` ⇒ **权限页永久空白**（而它正是唯一能自救的页面）

**修法 = 五层纵深**（界面 `:disabled` → 行为早退 → **提交前强制回补** → 拆 `Promise.all` → 后端豁免）：
- 🔴 提交层「强制回补」是**关键**：让**库里已经坏掉的租户**能靠「再保存一次」**自愈**，不必改数据库。
- 🔴 后端豁免只收窄到**这一个只读端点**；`/api/role-permissions` 是 v199 已豁免的**另一半**。
  **两条轴别混**：`_TENANT_MASTER_PREFIXES`（租户上下文轴）≠ RBAC 中间件里的 `path.startswith`（模块判定轴）。
- 🔴 **顺手补了老板方案漏掉的一处**：详情页「整行全选」改前 = **一键撤权** ⇒ 对 boss 的 `员工管理` 同样致命。
  ⇒ **看到「有防护的视图」时，必须把同族控件全部列一遍**，别只修点名的那一个。

### 二、🔴 搜索 = **查找**而非筛选（未命中「淡化」不「消失」）

第一版设计（限制在矩阵视图 + 组头另存 `allItems` 让"整组勾选"作用于整组）**看着对，实则更糟**：
过滤态下未命中的行**根本不在 DOM** ⇒ 点组头会**静默改掉用户看不见的行**。
**终版：未命中 `opacity:.32` 淡化，行仍在 DOM** ⇒ 组头状态 ≡ 勾选范围 ≡ **用户所见**，三者恒等。

**推广判据**：任何「批量控件」都必须满足 **可见集合 ≡ 作用集合**。
用 `filter`/`v-if` 隐藏行 = 破坏这个恒等 ⇒ **只要页面上还有作用于"整组/全选"的控件，就不能用过滤做搜索**。

### 三、`P0-2 切视图静默丢输入` ⇒ **别整表重拉**
保存成功后若 `await loadPerms(true)` 全量刷新 ⇒ 把**用户在另一个视图里没保存的输入冲掉**。
改法：**只就地更新这一行**，并保留 v296 纪律 —— `_ALL_MODULES` 之外的**遗留键原样带走**：
```js
const local = permRoles.value.find(r => r.name === name)
if (local) {
  const knownIds = new Set(modules.value.map(x => x.id))
  const legacy = (local.perms || []).filter(p => !knownIds.has(p))
  local.perms = [...Object.keys(perms), ...legacy]
}
```

### 四、探针教训（本轮新增，接 §v349 第四节）
1. 🔴 **端点自身的兜底会让断言失去判别力**：`/api/role-permissions` 有自己的 `_admin` 兜底
   （role ∈ {admin,boss}）⇒ 主管**必然 403**，与豁免无关。判据须改成「403 的理由**不是**模块判定」
   （`status===403 && !/使用权限/.test(detail)`），**别拿必然结果当证据**。
2. 🔴 **现象类断言必须选单变量**：验「别的角色未保存改动是否被冲掉」，就必须**保存另一个角色**
   （保存自己 ⇒ 本就以详情为准 ⇒ 断言无判别力，实测踩过）。
3. **折起分组点不到**：`v-show` 折叠组里的 checkbox，`force:true` 同样失败 ⇒ 先点 `.pm-grp-lb` 展开。
4. 真机只读探针范式：真账号登录 + Playwright `route` 改写 `/api/auth/permissions`、
   `/api/permissions/modules`、`/api/role-permissions*`，注入**照抄后端常量与生产库的真值**。

## §v351（2026-10-01，已上线 · **重号第二占用者**）权限页「路线 A」结构重构 —— 一个角色一个写路径

老板拍板「**1.认；2.不折叠**」。承接 §v350 §七 两个待决问题。探针 **51/51**、护栏 **112/112**、双侧 md5 30/30。
⚠️ 本号与另一会话「通知标题泄漏」**同号**（见 `notification-center.md §v351`）；本仓惯例（号表 v339「重号 · 第二占用者」）⇒ 登记重号，不重做。

### 一、🔴 结论升级：v350 是「两处各补一份判据」，v351 是「让规则只剩一份」

§v350 已把病根写清（**多视图 = 多写入口 ⇒ 保护规则必须单一实现**）。v350 的修法是**在两个视图里各补一份** —— 治了病，没治病根。
**v351 用结构消除问题**：**删掉第二个写入口**（「批量总览」页签整块移除）⇒

- `isLockedModule` 只剩详情视图**一个**消费方 ⇒ 规则物理上只有一份，**不可能再漏**；
- `POST /api/role-permissions` 在本页**不再有任何调用方**（端点本身保留，不动后端）；
- 随之删净：`collapsedGroups` / `toggleGroupCollapse` / `groupChecked` / `toggleGroup` /
  `groupedModules` / `togglePerm` / `savePerms` / `permSaving`（撤矩阵后即"没有界面的写路径"）；
- 「看」的需求降级为**只读弹窗**（`✓`/`—`，**零 input / 零 checkbox / 零 v-model**，唯一按钮「关闭」）。

> **推广**：当发现"同一条安全规则被抄了两份"，**先问能不能删掉其中一个入口**，而不是把两份都改对。
> 删入口是结构性的（一次永久），补判据是维护性的（每次都要记得改两处）。

### 二、🔴 域页签为什么安全，而 v350 的矩阵不安全 —— **「可见集合 ≡ 作用集合」**

§v350 判据：任何「批量控件」都必须满足 **可见集合 ≡ 作用集合**（用 `filter`/`v-if` 隐藏行 = 破坏这个恒等）。
**页签恰好满足这个恒等**：一次只显示**一个域**的行，页面上**没有任何跨域批量控件**（「整行全选」只作用自己那一行）⇒ 不存在"作用范围 ≠ 用户所见"。
∴ 页签可以直接"换内容"，不必像 v350 那样把未命中行 `opacity` 淡化留在 DOM。

### 三、「不折叠」（v349 曾拍板保留折叠，本轮改）

改由**域页签**呈现，理由写进代码注释：页签本身就是"点一下就到那一类"的入口，再叠一层"先展开再找"是**多余的两次点击**；
「11 行会淹掉上面 10 个功能」这个问题**已由页签解决**。实现：`permView.js` 的 `PERM_MORE_GROUP` **删 `collapsed: true`**，折叠机制整体删净。

🔴 **页签上的数字在搜索态下必须改显命中数**（`domainCount(g)`）：无命中的域自然露出 `0`，用户才知道该点哪个；
否则"页签里什么都没有"会被当成**坏了**（实测搜「算工资」后页签＝`["经营0","核算1","配置0","更多0"]`）。

🔴 **域页签名放 `permView.js`（`tab` 字段），不在 `Settings.vue` 另定义一份短名** —— 避免"同一条规则抄两份"。
已核实护栏正则只抓 `name:`/`module:` 对、**不解析分组名** ⇒ 加 `tab` 不会让护栏误判。

### 四、🔴 撤掉写入口时，必须同步排查「它原本顺带做了什么」

矩阵的「保存权限」按钮撤掉后，**登录端卡片留在了详情页顶部** ⇒ 若点「保存」只存功能权限、不存登录端 = **界面说假话**。
修法：`saveRoleDetail` 同时发 `POST /api/role-permissions/end`，且

- **只在真改过时才发**（与 `endBase` 快照比对，避免无谓写库）；
- body **只含当前这一个角色**（旧代码是 for 所有角色逐个 POST ⇒ 会把别的角色一起写一遍）。

> **推广**：删掉一个写入口时，**逐个回答"这个按钮除了它名字里写的事，还顺手提交了什么"**。

### 五、搜索的视图守卫**要改轴**

`searchHitKeys` 的守卫由 `permView !== 'matrix'` 改为 `permView !== 'detail'` —— 视图删了一个，守卫的**允许集合**必须跟着改，否则搜索在唯一的写入口上失效。

### 六、探针教训（本轮新增，接 §v350 第四节）

1. 🔴 **「目标态文案」不能当「当前态」判**：主题开关按钮写的是「切换为 **深色**」= 点下去会变成什么，**不是**当前态。
   拿它当判据 ⇒ 整段深色断言其实跑在浅色下（全红但产品是对的）。唯一可靠判据 = `document.documentElement.classList.contains('dark')`
   （`store/index.js::setTheme` 就是往 `<html>` 切 `light`/`dark` 类）。
2. 🔴 **`getComputedStyle().backgroundColor` 返回的是「声明值」，半透明色必须逐层 over 合成**：
   `--p-bg` = `rgba(6,182,212,.10)` ⇒ 直接算 RGB 亮度得 0.575（那是**青色本身**的亮度，不是它在深色卡上的**视觉**亮度）。
   正解：从元素往外逐层 `acc.r*acc.a + c.r*(1-acc.a)` 直到 `a>=0.999` ⇒ 合成亮度 **0.157**。
3. 🔴 **「有行被淡化」不等于「淡化按命中来」**：在**无命中**的域上搜（11 行全淡、命中 0），断言照样绿。
   ⇒ 必须补一条「**切到有命中的域 ⇒ 恰好 N 行未被淡化**」的判别力断言（本轮 H6）。
4. **换角色时要重置视图状态**：`openRoleDetail` 里把 `detailDomain` 与 `moduleQuery` 归零 —— 否则会**停在上一个角色看过的域**、并把上一个角色的搜索词带过来。

---

## §v357（2026-10-01，已上线）招投标雷达「记住用户选的地区」—— 偏好持久化 + 探针三态

文件：`src/pages/BidRadar.vue`（**本轮唯一改动**，+103/−4）。

### 一、🔴 偏好要在 **setup 顶层同步读**，不能等 `onMounted` / 首次响应回来再读

需求是「下次打开**直接只查该地区**」。若写成「挂载后读 localStorage → 改 `f.region` → 再查」，
用户会看到**先闪一下全国结果再跳**。正解：

```js
const savedRegion = ref(_lsGet(LS_REGION))          // 顶层同步
const f = reactive({ keyword:'', region: savedRegion.value, /* … */ })   // 直接当初值
```

⇒ **首个请求就带 `region=`**（探针实测 `/api/bid-radar?region=湖北&page=1&page_size=50`）。
**通用律**：「首次加载就应按偏好呈现」的偏好，必须在**能发出第一个请求之前**就位。

### 二、🔴 兜底必须**四路分开**，尤其「失败 ≠ 无数据」

原实现 `catch(e){ items=[]; meta.total=0 }` 与「真的没数据」**共用同一个空状态** ⇒ 403 / 超时
会被渲染成「暂无匹配的招投标信息」（**静默误导**，与本仓反复踩的静默失效同族）。四路：

| 情形 | 呈现 | 动不动记忆 |
|---|---|---|
| 无数据（`count===0`） | 「X 当前暂无商机（数据每日 07:10 自动更新）」+「查看全部地区」 | **一并清** |
| 未选择 | 回落全部地区（正常列表） | 无 |
| 记忆失效（省名已不在清单） | 清记忆 + `br-notice` 明说原因：「之前记住的地区「X」已不在可查询范围内，已切换为全部地区。」 | 清 |
| **请求失败** | 「加载失败：…」+「重试」 | 🔴 **绝不清** |

⚠️ `ensureRegionValid()` 里判失效的**前提是清单已拿到**（`meta.regions.length > 0`）；
清单没拿到就判失效 = 把「后端挂了」误判成「你的地区没了」并**擦掉用户偏好**。

### 三、🔴 `disabled` 的 option 被设为选中值时，部分浏览器会**回落显示首个选项**

⇒ 出现「**看着是湖北、实际查的是全部地区**」的假象。修法：`disabled` 要**放过当前选中项**：

```vue
<option v-for="r in meta.regions" :value="r.value" :disabled="!r.count && r.value !== f.region">
```

**通用律**：用 `disabled` 表达「不可手选」时，**已选值必须豁免**，否则 UI 会自己说谎。

### 四、连带发现的两处**同屏不同口径**

- 「近 3 日新增」是**独立查询** `/api/bid-radar?date_from=…&page_size=1`，原先**不带 region** ⇒
  锁「湖北」时同屏并排出现「累计商机 11（湖北）」与「近 3 日新增 300（全国）」两个**同名不同口径**数。
  ⇒ 独立小查询也要跟着当前筛选走。
- KPI 副标题原写「条公开招投标信息」，未写口径 ⇒ 改为「{{ 区域 }}范围内公开招投标」。

⚠️ 该页 3 个下拉**此前都没有可访问名称** ⇒ 补 `aria-label="地区"`（**既为无障碍，也为探针精确定位**：
同页多下拉、值可能相同，靠 `value` 匹配会命中旁边那个）。

### 五、🔴🔴 探针最大教训：`addInitScript` **每次导航都执行**

我想用 init script 注入 `localStorage.br_region`。写成「seed 为 null ⇒ **清空**」，
于是**在「重新打开页面」那一步，脚本把要验证的记忆自己清掉了** ⇒
「下次打开还记得吗」这件事**永远测不出来**（首轮 6 个 FAIL 全源于此，**产品侧一行未改**）。

正解 = **三态**：

| seed 值 | 语义 | 用途 |
|---|---|---|
| `'__SKIP__'` | **完全不动** | 🔴 **验「跨导航持久化 / 会不会被清除」只能用这个** |
| `null` / `''` | 清空 | 验「从未选过」的兜底 |
| 其余字符串 | 预置 | 验「已记住 X」 |

并且：**多相位共享同一 browser profile** ⇒ `localStorage` 是共享的、**相位顺序本身是变量**；
验「换页面后记忆是否还在」要 `newPage()` **且**用 `__SKIP__` 态，否则同样测不出来。

> **可复用句式**：任何「注入了初始状态」的探针，先问一句 **「这条断言执行时，状态是被我设过的，还是它自己长出来的？」**
> 若两者混淆 ⇒ 断言零判别力。同族纪律见 §六第 1 条（「目标态文案」当「当前态」判）与 §v349 第四节。

### 六、🔴 零依赖 CDP 探针怎么记「首个请求带没带 region」

`cdp-lite.mjs` **没有网络监听 API** ⇒ 在 init script 里包裹 `window.fetch` 自记：

```js
window.__brUrls = [];
var _f = window.fetch;
window.fetch = function (i, n) {
  var u = (typeof i === 'string') ? i : ((i && i.url) || '');
  if (u.indexOf('/api/bid-radar') >= 0) {
    window.__brUrls.push(u);
    if (FAIL) return Promise.resolve(new Response(JSON.stringify({detail:'探针打桩：模拟服务端错误'}),
                    {status:500, headers:{'Content-Type':'application/json'}}));
  }
  return _f.apply(this, arguments);
};
```

同一包裹点**顺便实现打桩 500** ⇒ 「失败态」也能真机验（不必等后端真坏）。

### 七、验收读数（可照抄的验收组合）

- **双向判别串** 12 条：`旧包全 0 / 新包全 ≥1`（只命中新包才叫判据，否则是零判别力护栏）。
- **差集四段**：生效集 56 / 本地 56，基名无增删；① 归一后逐字节相同 **54**；② 差异**恰好 2**（本轮两文件）；
  ③ **生产生效、本地缺失 = 0**；④ 本地有而生产无 = **0**。⇒ ② ≠ 本地改动文件数 ⇒ 必是**级联假差异**。
- **38 PASS / 0 FAIL**；3 张截图为证（重开带出 / 天津无数据兜底 / 打桩 500 与无数据分开）。


## §v362（2026-10-02，已上线）提示条深色白底 ＋ 长文案不自动关闭 ＋ 全站深色适配排查

### 一、先定性：这叫「通知条（toast）」，不叫「弹窗」

老板报的「弹窗」是**全局通知条**。链路固定：

```
routers/forecast.py::_zhoupu_empty_reason → HTTPException(400, …)
  → api/modules.js 抛 new Error(d.detail) → Forecast.vue::zhoupuGen catch
  → store.toast(e.message, 'err') → App.vue 渲染
```

🔴 **排查纪律**：见到「弹窗显示不对」先分清是 **notification toast** 还是 **自定义 Modal**。
本轮逐一验过 6 个真 Modal（CommandPalette / TargetFormModal / IdleTimeout / ReportMapping / Settings / ProductTarget）—— **全都已用 `background:var(--bg)`，模态框本身没病**。若照"弹窗"二字去翻 Modal 代码，会白跑一轮。

### 二、🔴 根因两族（互相独立，只修一族都还会白）

**（甲）类型串对不上 ＋ 基类是「反色」写法。**

- `App.vue` 渲染 `:class="store.ui.toast.type"`；全站实际传的是 **`err`/`ok`/`warn`**（用法计数 **217/154/150**），而 CSS 只定义了 **`.toast.error` / `.toast.success`** ⇒ **语义色一条都不生效**（`error` 129 / `success` 59 也在用 ⇒ **两套命名并存**）。
- 更要命的是基类 `.toast{background:var(--t1);color:var(--bg)}` 是**反色**写法：
  - 浅色：`--t1` 深、`--bg` 浅 ⇒ 看着正常，**问题被掩盖**
  - 深色：`--t1=#f5f5f7`（近白）＋ `--bg=#1c1c1e`（近黑）⇒ **整条变成白底黑字**
- `.upd-tip`（更新提示）**同族同病**。

🔴 **「反色」是深色模式最阴的一类写法** —— 它在浅色下**永远是好的**，所以能长期存在。审计时要专门搜 `background:var(--t1)` / `background:var(--txt*)` 这类「浅色模式下正确、深色模式下翻转」的组合。

**（乙）28 个 CSS 自定义属性「被 `var()` 引用但全站从未定义」。**

| 形态 | 后果 |
|---|---|
| 有 fallback（`var(--card,#fff)` / `var(--line,rgba(0,0,0,.12))` / `var(--pri,#2563eb)` / `var(--t3,var(--t2))`） | **静默回落硬编码浅色** ⇒ 深色下亮斑 |
| 无 fallback（`var(--bd1)` …） | **整条声明被浏览器丢弃** ⇒ 描边/背景缺失 |

两者都 **零报错、零控制台提示** —— 本项目最贵的那类失效。**兜底值恰恰是浅色**，所以浅色QA永远发现不了。

### 三、修法三层（令牌化，不要逐处打补丁）

1. **`styles/variables.css`**：`:root{}` 加 toast 令牌（`--toast-bg:#1d1d1f` / `--toast-fg:#ffffff` / `--toast-bd:transparent`）＋ **13 个兼容别名**把幽灵变量**指向既有真源**（不是新造颜色）：
   `--border/--bd1/--bd2/--b2 → --bd`｜`--bg1 → --bg2`｜`--ok → --ok-green`｜`--danger/--err/--err-red → --danger-txt`｜`--warn → --warn-amber`｜`--txt-3 → --t3`｜`--mono/--font-mono`｜`--radius-xs:6px`｜`--radius → --radius-lg`｜`--shadow → --shadow-lg`；`:root.dark{}` 加 `--toast-bg:#3a3a3c` / `--toast-fg:#f5f5f7` / `--toast-bd:rgba(255,255,255,.10)` / `--t3-rgb:142,142,147`。
   ⚠️ 改完核 **花括号配平**（本轮 140/140）。
   ⚠️ **别新造语义重复的令牌**：`--bd1 → var(--bd)` 这种别名能让 **14 个文件一次性回本**，比逐文件替换安全。
2. **`store/index.js` 的 `toast` 从单槽位改栈式**：`ui.toast`（一个对象）→ `ui.toasts[]`；`TOAST_MAX=3`；**`STICKY_LEN=60`**（≥60 字判为「说明型」⇒ **不自动关闭**）；`_toastSeq` 当 id（**别再用 `Date.now()`** —— 同一毫秒连推两条会撞 id）；`_toastTimers` Map 管定时器；新增 **`dismissToast(id)`**。短文案仍自动关（`min(6000, 3000 + 字数×30)`）。
3. **`App.vue` 重写通知区**：
   - `.notif-dock` 弹性栈（`.upd-tip` ＋ `TransitionGroup name="toast"`）
   - `.toast` 改**实色令牌** `background:var(--toast-bg)`（不再反色）
   - `.toast-x` 关闭按钮 `v-if="t.sticky"`
   - 类型规则**同时吃两套命名**：`.toast.err,.toast.error` / `.toast.ok,.toast.success` / `.toast.warn`
   - `onDocClick` 用**捕获阶段**注册（`document.addEventListener('click', onDocClick, true)`）并 `skip` 掉 `.toast`/`.upd-tip` 内部的目标 ⇒ 得到「**点外部关闭、点条内不关**」
   - Esc 也能关；`.notif-dock{pointer-events:none}` ＋ `.notif-dock>*{pointer-events:auto}` ⇒ 外部点击仍能落到页面（否则整条空白区会吃掉点击）
   - ⚠️ `TransitionGroup` 要求 ×-active 规则**排在** ×-from/×-to **之前**（Vite 产出的顺序已满足，但改 CSS 时别打乱）。

### 四、全站同类排查 → 本轮改 12 个文件

`variables.css` · `store/index.js` · `App.vue` · `ZhoupuImport.vue`（整页脱令牌，13 组替换）· **`AiOps.vue`（最大户，11 处）** · `CopilotDrawer.vue`（6 处）· `EmployeeArchive.vue` · `BrandArchive.vue` · `ConnectCenter.vue` · `DataLedger.vue` · `WeatherWidget.vue` · `rebate/MonthlyAchvChart.vue`。

⚠️ **刻意不动的**：`LossAccounting.vue:1181`（`var(--ok,#16a34a)`）与 `ProductTarget.vue:1257` —— 它们的 `--ok`/`--radius`/`--shadow` **已在令牌层统一解决**，再改是重复劳动 + 增加冲突面。
🔴 **排查顺序建议**：先补令牌（一次覆盖一大片）→ 再重建 → **用探针看还剩哪些亮斑** → 只补真剩下的。别一上来就逐文件 grep 硬编码（会做大量无用功）。

### 五、🔴 取「生产真 store」的办法（本轮最可复用的技法）

```js
document.querySelector('#app').__vue_app__          // Vue 3 在 mount 容器上挂了 app 实例
  .config.globalProperties.$pinia                   // app.use(pinia) 会挂到这里
  ._s.get('app')                                    // defineStore('app', …) ⇒ 键就是 'app'
```

⇒ **不必登录、不必打桩、不必起 dev server**，直接在**生产真机**上驱动真实业务逻辑（本轮用它验证 toast 交互 11/11）。
⚠️ 若 app 未挂载或 store id 写错，`_s.get()` 返 `undefined` ⇒ 探针要**先探测再断言**（打印实际 keys 便于纠错）。

### 六、🔴 探针自身的两个坑（本轮踩到，务必先排除）

1. **触发 `store.toast()` 后必须等一拍再读 DOM**（Vue 渲染是异步的）。本轮第一版同步读 `querySelectorAll('.toast').length` 得 **0**，我**误判成「并存上限断言失败」**。⇒ 差 1 拍 = 假红。**凡"断言突然失败而源码看着没问题"，先怀疑探针没等渲染。**
2. **拿旧包做交互反例时，CDP `send()` 会等一个永不返回的回执 ⇒ 脚本静默挂死**（本轮挂了 3 分 35 秒，无任何输出）。⇒ 交互层反例改走**确定性产物判据**（比特征串 / 比字节），别在旧包上跑真交互。
3. 补充（同轮）：**旧包 CSS 做渲染反例时必须单独起页** —— 旧规则的 scoped id（`data-v-*`）与新元素不匹配，把旧 CSS `<link>` 追加到新页面**根本不生效**，反例会"假绿"。（本轮第一版反例就这样白跑了一次。）

### 七、验收读数（可照抄）

| 层 | 脚本 | 正例 | 反例 |
|---|---|---|---|
| 逻辑 | `.workbuddy/tools/v362-toast-logic.mjs` | **17/17** | **5/5**（对 `git show HEAD:…store/index.js`：单槽、固定 3000ms、无 `dismissToast`、`Date.now()` 当 id、无 sticky） |
| 渲染 | `.workbuddy/tools/v362-theme-probe.mjs` | 深色 `#3a3a3c`/`#f5f5f7`/`3px #ff453a`；浅色仍 `#1d1d1f`（未回归） | 旧包 CSS **单独起页**测 ⇒ 深色 **`#f5f5f7`（亮度 245.7 = 白块）**、边框 `0px`、`.notif-dock/.toast.ok/.toast.warn` 全缺 |
| 交互 | `.workbuddy/tools/v362-toast-e2e-live.mjs`（打生产） | **11/11** | 产物判据：旧包 `notif-dock`/`toast-x`/`dismissToast`**全 0**，新包 **1/1/3** |
| 截图 | `.workbuddy/tools/v362-toast-shot.mjs` | `artifacts/v362/toast-dark-改后.png`（真机拍） | `toast-dark-改前.png` |

**交互 11/11 明细**：深色长文案渲染 ✅ 带 ✕ ✅ 非白底 ✅ 3px 语义边框 ✅ ／ **静置 8 秒仍在** ✅ ／ 点条内**不**关 ✅ ／ **点外部关闭** ✅ ／ 点 ✕ 关闭 ✅ ／ **短文案 6 秒后自动关（未回归）** ✅ ／ 连推 4 条上限 = 3 ✅。

**上游 CSS 值定位公式（渲染探针通用）**：`scopeOf(cls)` 在运行时从 `document.styleSheets` 的 `cssText` 里正则抓 `.toast[data-v-XXXX]` 的 `XXXX` ⇒ **scoped id 运行时自取，绝不硬编码**（源码一改 scoped id 就变）。

## §v364（2026-10-02，已上线）到货节奏「按月停单」—— 让**派生数字不可直接被编辑**

### 一、🔴 核心设计原则（本轮最值钱的一条）

缺陷本体不是"算错了"，而是**界面上给了用户一个可以脱离事实单独改写的派生量**：
旧 ② 区是「**本月到货次数**」输入框，日历另算一套 ⇒ 用户把次数填成 15、日历上仍是 16 天
⇒ 同屏两把尺子，且**没有任何地方告警**。

⇒ 新 UI **不提供次数输入框**。次数**只能由日历数出来**：
`点一下某天 = 这一天不进货`，于是「次数」「日历」「均单分母」三处**不可能**打架。
**通用判据**：若某数字是另一个可编辑事实的**函数**，就**不要再给它一个输入框** ——
两个入口必然漂移。

### 二、面板构成（`ArrivalRhythmBlock.vue` ② 区）

```
② 本月到货   次数由「到货日」数出来，两处永远一致
┌ 系统推算 ┐ ┌ 2026-10 实到 ┐ ┌ 均单 ┐
│  16 次   │ │   15 次      │ │≈1.23 万元/次│
└──────────┘ └──────────────┘ └──────┘
[1周四][3周六][5周一̶][7周三][9周五]…          ← 16 个 chip，点一下切换停/恢复
点一下某天 = 这一天不进货。到货节奏不会因此改变：停掉 5 号，7 号照常到。
已停 1 天；改动只对 2026-10 有效，2026-11 起自动回到系统推算（15 次），不需要你每月维护。
[恢复系统推算]
```

- 三个数字**全部取自后端预览返回体**（`system_count` / `count` / `per_order_wan`），
  **前端一行算术都不写** —— 这是本项目反复栽的「前端镜像后端算法」的正面做法。
- chips 来源是 `system_dates`（**未剔停单**的系统日历），被停的加 `.off`（划线 + 降透明）。
- 文案直接用业务语言说清"为什么停单不改节奏"（用户原话的落点），**不出现任何内部枚举值**。

### 三、两条「不静默」提示（都是可达状态，不是防御性代码）

| 状态 | 何时出现 | 界面怎么说 |
|---|---|---|
| `count_mismatch` | 该月有**显式次数**且与日历天数不等（典型：从旧版迁过来的「本月到货次数」只有次数、没有哪一天） | 「⚠ 之前填的「本月到货 15 次」与日历上的 16 天对不上，当前均单按 15 次算。**[按日历对齐]**」 |
| `skip_not_in_schedule` / `skip_invalid` | 停单日**已离开当前到货日历**（典型：停了某天后又改了报单周期 / 首次报单日 —— **这正是老板需求里"重配"会撞上的情形**） | 「⚠ 你有 N 天的停单**已经对不上本月的到货日**了…现在不起作用。想按新节奏重来，点「恢复系统推算」…」 |

🔴 **第一条的处理纪律**：冲突时**两个都不静默取**，把冲突讲出来 + 给一键收敛。
**不要自动选一个** —— 那等于静默丢弃用户其中一个输入。
🔴 **第二条是"存着但不起作用"的第三种状态**：既不是"已停"也不是"没停"。
不说出来，用户会在日历上找不到自己停的那天，以为系统吞了它。

### 四、🔴 一个我自己写出来的模板缺陷（Vue 不报错）

`v-if="skipped.length || dirty"` —— `dirty` **根本没定义**（应为 `skipsDirty`）。
Vue 3 模板里未定义标识符解析成 `undefined`，**编译通过、构建通过、运行时只出一条 dev 警告**
⇒ 后果是「已改动次数但没停单」时按钮不出现。
**判据**：SFC 构建成功**不能**证明模板里的标识符存在；涉及条件渲染的新增标识符，
要用探针**真的走到那个状态**验证，或直接 `grep` 一遍模板变量名。

### 五、深色模式

新增样式**全部走既有令牌**（`--p / --p-dark / --t1..t3 / --bg1..2 / --bd2`），**零硬编码色**。
实测 `html.dark` 下 `.arr-stat-i` / `.arr-day` 底色 `rgb(44,44,46)`、文字 `rgb(245,245,247)`
—— **无白块**（v362 曾栽在这里）。**验证方式**：不靠肉眼，用 `getComputedStyle` 量
`backgroundColor` 并算亮度，把"不是白块"变成**可打印的数字**。

### 六、探针技法（本轮新增，可复用）

1. **真机验收要覆盖"没保存"这一步**：本轮的交互（点日期）是**纯内存态**，
   点完不保存 ⇒ 零落库。关弹窗后再**复读接口**确认 `skip_dates_stored === ''`
   ⇒ 把"探针没写脏生产"变成**断言**，而不是我的口头保证。
2. **截图要裁剪到证据区**：`Page.captureScreenshot` 支持 `clip`（`{x,y,width,height,scale}`）。
   先 `scrollIntoView({block:'center'})` 再取几个目标元素的 `getBoundingClientRect()`
   做 union + 内边距 ⇒ 截出来就是"要验的那一段"。
   否则弹窗内部一滚，`getBoundingClientRect` 只给**可视区**那一块，截到弹窗顶部一片表单。
3. **`lib/cdp-lite.mjs` 的 `page.screenshot(path)` 需要传路径**（不传返回值）；
   要裁剪走 `page.raw.send('Page.captureScreenshot', {...})`。
4. **深色模式证据要量颜色**，不要只截图 —— 亮度数字能进报告当判据。

## §v367（2026-10-02 夜，**未改代码**）类差集审计器的四坑 ＋ 并行会话核查

### 一、🔴 类差集审计器**四个坑**（v363 报告因此误报，务必先排除）

v363 结论「5 组拼接类零定义 ⇒ 状态色静默失效」**是误报**。真实 **0 组缺失**。四个根因：

| # | 坑 | 症状 | 正解 |
|---|---|---|---|
| 1 | **CSS 复合选择器只抽第一个类** | `.tag.st-draft{background:var(--st-draft-bg)}` 只记 `tag`，`st-draft` 丢弃 ⇒ 整个 `.tag.st-*` 家族被判零定义 | 选择器内**抽全部** `.cls`：`for cm in re.finditer(r'\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)', sel)` |
| 2 | **`\bclass=` 误匹配 `:class=`** | `\b` 在 `:`(非词字符) 与 `c`(词字符) 之间成立 ⇒ `:class="{ on: activeTab === 'summary' }"` 被当静态 class 拆词 ⇒ `activeTab`/`d`/`ri` 等**变量名**混入（差集 18 虚涨到 **60**） | 用 **`(?<!:)class="..."`** |
| 3 | **基准缺全局 CSS** | 只拿本页 `<style>` 当「已定义」⇒ `card`/`btn-sm`/`tbl`/`state-empty` 等全局类全被误报 | 基准 = 本页 scoped **∪ `src/styles/variables.css`**（本项目全局 CSS **只有这一个文件**） |
| 4 | **猜值域而非实证值域** | 拿 `has-warn/risk/info` 去测，实际值域是 `void`/`short`/`done`/`gap`（`ptExtraMark()` 返回）；`soft-` 实际只有 `miss`/`over` | **值域必须从源码实证**（grep 到赋值/返回点），不能凭类名猜 |

**另加一条**：`strip_css` 用 `re.sub(r'/\*.*?\*/', ...)` 在**注释未闭合**时会残留 ⇒ 大量注释文字被当选择器（本轮虚报 z-index 44 处，实际 15 处）。**正解：字符级状态机去注释**（见 `tools/v367-comment-safe-scan.py`）。

**可复用脚本**（`~/.workbuddy/../../Documents/laozhangai-product/.workbuddy/tools/`）：
- `v367-class-diff-rigorous.py` —— **带 4 条自证断言**（`.tag` 在 scoped / `st-draft` 可抽出 / `.card` 在 global / `extra` 未被误收），断言全过才输出结论
- `v367-comment-safe-scan.py` —— 字符级状态机去注释，统计 z-index/阴影/文案
- `v367-parent-fallback-check.py` —— 对每个差集类核「父类是否兜底」（判严重度：真缺 vs 仅缺修饰）

**🔴 通用纪律：差集不为 0 ≠ 出事。** 先分三类：
1. **真缺且无兜底**（如 `btn-retry`）⇒ 真问题
2. **有父类/元素兜底**（`tb-ctx`→`.tb-group`、`err-panel`→`.info-panel`、`th`→元素选择器）⇒ 良性
3. **审计器自身假阳性**（拼接前缀、变量名、跨页类）⇒ 排除

⚠️ v363 的 4 个脚本已加「**已证实会误报**」头部警告，勿再直接用。

### 二、并行会话核查（本轮**因此不部署**）

**事实**（可复刻的核查顺序）：

1. `find src -type f -newermt '<上次核查时刻>' -print0 | xargs -0 stat -f '%Sm %z %N' -t '%H:%M:%S'` ⇒ 发现 **6 文件 +523 −39 行**在途（20:14→21:04 连续），**含我要改的 `Forecast.vue`**
2. `git diff --stat -- <这些文件>` ⇒ 量化规模；`git diff -U0 ... | grep '^@@'` ⇒ **定位 hunk 行号**，与 `<style>` 起始行比对 ⇒ 判断「冲突面是否重叠」（本轮：他们的 hunk 全在 template/script ≤11816，`<style>` 从 11922 起 ⇒ **不重叠**）
3. `ps aux | grep -E "[v]ite|[n]pm run build"` ⇒ 无构建进程
4. **本地 `dist` 的 mtime** ⇒ 21:04:17（**他们已构建一份未上线的产物**）
5. 生产 `index.html` md5 与引用 ⇒ **已不是我的上次构建**（`984e3b77…` vs 我的 `48dfa57f…`；入口 `index-gfVGce4x.js` vs `index-DtmT2gg4.js`，**CSS 未变**）⇒ 「线上 == 我构建基线」**已失效**

**判据**：只要「别人有未上线的 `dist`」或「`Forecast.vue` 有他人在途 hunk」，**我构建 = 覆盖他们的产物；我上传 = 把他们的在途改动一起带上线**（v356 的镜像情形）。
⇒ **正确动作：不改、不构建、不部署，先交结论。**

### 三、🔴 `ls -lt` 会骗人：`--time-style=+%H:%M` 丢日期

本轮中途据 `ls -lt --time-style=+%H:%M` 看到 `index-1ZfsDoC9.js 21:59` / `index-CWx0QzFq.js 21:11`，**误判成「另一会话正在高频部署（四次）」**。
实际那两份是 **10-01** 的 —— `ls -lt` 是倒序，`+%H:%M` **不带日期**，跨天就完全误导。
🔴 **纪律：跨天比较时间戳必须带 `%m-%d`**；本次补 `%m-%d` 后真相是「10-02 只有 12:00 / 16:55 / 20:23 三次，**最近一次就是 20:23**」。

### 四、本轮真实不符合项（更正后，供后续整改）

| 级别 | 项 | 位置 |
|---|---|---|
| 🟡 真缺 | `spark-th` —— 趋势列表头**无** `.calc-th`（同排其它列都有） | `Forecast.vue:1179` |
| 🟡 真缺 | `btn-retry` —— 保存失败时主按钮**无任何视觉区分**（无兜底） | `Forecast.vue:164 / 1091` |
| 🟠 令牌化 | z-index 字面量 **15 处** 4 位数（1000/1090/1091/1100/1101/1102/1120/1125/1130/1150/1200）—— 规范令牌只有 6 档（400/600/980/990/1010/1200）⇒ **规范脱节，该扩令牌** | `Forecast.vue` style 段 |
| 🟠 令牌化 | `box-shadow` 字面量 **5 处** | 同上 |
| 🔵 文案 | `SKU` **13 处**（template 8 ＋ script 5）· `Δ` **5 处**（含导出表头 `合计Δ`）· `✓✗⚠` **5 处**（L2081/2082/2166） | `Forecast.vue` |

---

## §v365 停单回执与排除说明（2026-10-02）

### 回执面板：**算对了但用户看不见 = 白算**

`TargetFormModal.vue` 保存本月停单后，后端回执里「影响哪些期次」必须**留在屏幕上**：
- 有回执 ⇒ **不自动关面板**，主按钮变「关闭」，且**不再显示「取消」**
  （已保存成功还给「取消」会让人以为还能撤掉这次保存）。
- `toggleSkip` / `resetSkips` / `alignCount` 三处各清空回执 —— 否则改完停单日
  还挂着上一版的结论。
- 父层 `Rebate.vue::onRuleSaved()` **不再关弹窗**（原来它会把回执一起关掉）。

### 回执文案必须**双分支**（`effect` × `excluded`）

只看 `excluded` 会把「取消停单」渲染成「不再自动新建」，并反向指引
"请去另一个品牌也点掉"（方向完全相反）。正确分派：

```js
if (p.effect === 'restore') {          // 取消停单
  p.excluded ? '仍不会自动新建：那天所有品牌都没货到。'
             : '会恢复自动新建：<其它品牌>那天有货到。'
} else {                               // 停单
  p.excluded ? '不再自动新建，它将在 <时刻> 打开填报，届时不会自动建表。'
             : '仍会按期建：…；要让这一天整批都不建，请到「<其它品牌>」的到货节奏里也点掉 <日>。'
}
```

### 报单自动化预览里的「不静默」

`AutoPeriodBlock.vue`：被排除的行**划线**（`tr.ap-row-off`）+ 挂标记
（`.ap-offchip`「不到货 · 不会建」）+ 顶部 `.ap-excl` 说明条。
🔴 「报单自动化」在**「报单配置」页签里**（v242 迁过去的），不在 `/#/forecast` 首页 ——
写探针时先点页签再等渲染，否则在错的页面上找元素（本轮踩过，4 条断言假红）。

### 深色模式

`.ap-skip-effect` 颜色全走既有令牌（`--p-dark` / `rgba(var(--p-rgb),.06)`），**零硬编码色**。
⚠️ 验「深色下是不是白块」**不能**直接取 `rgba()` 前三位当 RGB ——
`rgba(34,211,238,.06)` 忽略 alpha 会算出亮度 175（**假的白块**）。
要沿祖先链找不透明底色做 **alpha 合成**（本轮实测有效亮度 52/44，确认不是白块）。

## §v367（2026-10-02，已上线）UI-SPEC 整改落地 —— 层级令牌化 + 两处真缺类 + 文案/无障碍

### 一、🔴 先复核再动手：v363 报告的 P0 是**误报**

**教训**：`docs/UI-SPEC.md §7.1` 的「类差集必须为 0」是很硬的判据，但**审计器本身极易误报**
（本项目已在 v363 踩过一次，差集虚涨 3 倍）。四类根因，**写审计器时逐条防**：

| 根因 | 症状 | 正解 |
|---|---|---|
| **复合选择器只抽第一个类** | `.tag.st-draft{}` 里的 `st-draft` 被当「无定义」 | 抽取器要扫**选择器整串的每个 `.xxx` 段**，不是只取第一个 |
| **`\bclass=` 误匹 `:class=`** | `:class="{ on: tab==='x' }"` 的变量名/比较值被当类名（差集 18→60 虚涨） | 先删比较式 `===?\s*'…'`，再取对象键名与三元字面量；或干脆用 `(?<![:\w])class=` |
| **基准缺全局 CSS** | 把 `card`/`btn-sm`/`tbl`/`th` 这些 `variables.css` 里的全局类当零定义 | 基准 = **本文件 style 段 ∪ `src/styles/variables.css`** |
| **猜值域而不实证** | 拿 `has-warn`/`has-risk` 去测，实际值域是 `void/short/done/gap` | **先读被测函数**的 return 分支，再按真实值域断言 |

🔴 **纪律**：任何「零定义 / 缺失」类结论，**先给审计器写 3–4 条自证断言**
（正例必中、反例必不中、基准文件确在），全 True 才采信。脚本：`tools/v367-class-diff-rigorous.py`。

### 二、z-index 令牌化 = **保值迁移**（本项目最重要的迁移范式）

**问题**：`§1.7` 要求「页面不得再写字面量」，但该页真实值域 **1000–1200**，而全局只有 6 档
（400/600/980/990/1010/1200）⇒ **页面根本无处可取**，只能拍数。这叫**规范脱节**。

**正解不是「把页面塞进不够用的令牌」**（会改相对顺序 ⇒ 层级错乱），而是规范自陈的那条：
> 与 `variables.css` 不一致时**以代码为准，并立即修正本文件** ⇒ **扩令牌 + 改文档**。

🔴 **迁移铁律**：**新令牌的值 = 原字面量的值**（逐值相同）⇒
零视觉变化、相对顺序**必然**不变、可**逐项自证**。

```bash
# 迁移后必做的双向核对（缺一不可）
① 剩余字面量 = 0        # style 段内 z-index:\d{4} 应为 0
② 令牌展开值集合 == 原值集合   # 从 variables.css 读定义，展开页面里的 var(--z-*)
```
v367 实测：18 处 → 11 个令牌，两组集合逐项相同。

**命名分层**（新增页面浮层一律从这里取）：
`--z-*`（400–1010）= **全局层**；`--z-page-*`（1000–1200）= **页面自建浮层**，整体高于全局层。

### 三、`--danger-solid` vs `--danger-txt`：**当底**和**当字**是两个令牌

- `--danger-txt`：浅色 `#dc2626` / **深色 `#f87171`（浅红）** —— 为**文字可读性**按主题调过
- 拿它当**实心按钮底** ⇒ 深色下 `#f87171` 配白字对比度仅 **2.4:1**（不合格）
- ⇒ 新增 `--danger-solid:#dc2626`（**两态同值**），配白字 **5.0:1**

🔴 **通用教训**：语义色令牌**按用途分**（底色 / 文字色 / 描边色）。同一个红，「当字」和「当底」在深色下的最优值不同。

### 四、`box-shadow` 该不该令牌化？用**出现频次**判

v367 页面内 5 处字面量阴影，**全部是一次性特型**，语义与 `--shadow-sm/md/lg`（下沿、黑系）不同：
- **上沿分隔**（`0 -2px …`，提示「上方还有内容」）：`.sel-stat` / `.col-total-bar`
- **品牌光晕**（用强调色而非黑系）：`.sprint-card.is-pinned` 的青色
- **微控件**（1–2 处的小按钮/手柄）：`.row-ops .rop` / `.fill-handle`

硬套通用令牌会**改变视觉**；为一次性用途造 5 个令牌又是垃圾。
⇒ **判据：同一阴影值站内出现 ≥ 3 次 ⇒ 必须上提为令牌；一次性特型在 `§1.6` 登记例外即可。**
（这条已写进 `docs/UI-SPEC.md §1.6`。）

### 五、无障碍：toast 的**两个**要求，别只做一半

`§5 可访问性`第 5 条 = **两件事**：
```html
<!-- ① 容器有 aria-live；② 错误类用 role="alert" -->
<div class="toast" :class="t.type"
     :role="isErr(t.type) ? 'alert' : 'status'"
     :aria-live="isErr(t.type) ? 'assertive' : 'polite'">
```
🔴 `role="alert"` 隐式 `assertive`；若同时硬写 `aria-live="polite"`，**后者会覆盖前者**，
「立即播报」语义就丢了 ⇒ 两个属性都要**随类型动态给**。
🔴 仓里 toast 的 type 命名**两套并存**（`err/ok/warn` 与 `error/success`）⇒ 判断函数要**两组都认**。

### 六、验证券（可照抄）

| 层 | 脚本 | 读数 |
|---|---|---|
| 静态·类差集 | `tools/v367-class-diff-rigorous.py` | 差集 16→14（余者=前缀/参数假阳性 + 9 个**有父类兜底**的标记类） |
| 静态·去注释扫描 | `tools/v367-comment-safe-scan.py` | z-index 4 位数字面量 0；Δ 进界面 0 |
| 渲染（打生产） | `tools/v367-render-probe.mjs <URL> <CSS_URL>` | **13/13**；含**判别力自证**（同元素不带 `data-v-*` ⇒ 回落成改前表现） |
| 真机回归 | `tools/v367-forecast-regression-shot.mjs` | 登录 `#/forecast` 零 JS 报错；截图 |

🔴 **渲染探针的通用要点**（本轮验证过）：
1. `scoped id` **运行时从 CSS 文本正则抓**（`.xxx[data-v-([a-z0-9]+)]`），**绝不硬编码**；
2. 构造元素后**必须手动 `setAttribute('data-v-'+id,'')`**，否则 scoped 样式**不生效**（会假红/假绿）；
3. **判别力自证最省事的做法** = 同一元素**故意不加** `data-v-*`，看是否回落成「改前表现」——
   比去翻旧包便宜，且不会挂（旧包跑真交互会卡死在 CDP `send()`）；
4. 一次不要 `mk()` 太多元素：`grid-area is-fs` 这类**多类名选择器**要按**最后一个类**去查 scoped id。

### 七、🔴 产物特征串核验：**必须遍历 `assets/*.css`**

Vite `build.cssCodeSplit` **默认 true** ⇒ 页面 CSS 落在**各自 chunk**（`Forecast-Bt0YDxRy.css`，108 KB），
入口只有 `index-*.css`（全局令牌）。只查入口会得到「`btn-retry` 全 0」，**误判成没生效**。
⇒ 核验串一律 `for f in dist/assets/*.css; do grep -o -F -- "$s" "$f"; done`。

### §v368（2026-10-02）：回执/状态标签的"结论必须跟着后端走"

**回执文案（`rebate/TargetFormModal._skipEffectLines`）按 `effect` × `excluded` 分四种说法**，
合并任何一种都会**界面与后端结论相反**：
| effect=skip + excluded | 「不再自动新建」+ 交代「谁其实有货、但跟着一起不建」 |
| effect=restore + excluded | 「**仍不会**自动新建：X 那天仍标记不到货」（靠 `skipped_brands` 点名"是谁还在停"） |
| effect=restore + !excluded | 「会恢复自动新建」 |
| effect=skip + !excluded | 护栏（v368 下打了就必中，走到这儿说明口径又变了，**不许静默**） |

🔴 `skipped_brands` 是 v368 新增的：**只有 `still_arriving` 答不了用户的问题** ——
它说的是"谁有货"，而用户问的是"那到底是谁不来了"。

**历史期次页（`pages/ForecastHistory.vue`）两个界面缺陷**（都是界面探针跑出来的）：
1. `statusTag` 只看 `closed_mode === 'void'` ⇒ 「恢复报单」后仍显示「已作废」——
   **`reopen` 只把 status 改回 open、不清留痕**（v319 语义：留痕不该被后续操作抹掉）
   ⇒ 必须 `closed_mode === 'void' && status !== 'open'`。
2. 定稿列照 `status === 'closed'` 判 ⇒ 同一行同时写着「已作废」（状态列）和「已定稿」（定稿列）
   ⇒ 新增 `finalTag()`：**作废不算定稿**（它是撤销，流程没走完），原因由副行交代。

**按钮显示条件取交集**：「一键作废」只在 `status === 'open'` **且** `arrival_skipped` 时出现 ——
已关闭的不需要作废；没被标记的给它「作废」只会让人误以为关单有问题。
**确认框要讲清两件事**（缺一件用户就不敢点）：① 为什么轮到它（把到货日摆出来让他自己对得上）
② 点了会失去什么（**数据全部保留，可恢复** —— 用户真正怕的是报单被删）。

### §v376（2026-10-04）：预报汇总表整改 —— 选中态对比度 / 编辑网格可访问性 / 渲染热路径 / 死 CSS

**只改 2 个文件**：`pages/Forecast.vue` + `styles/variables.css`。11 项
（P0×2 / P1×3 / P2×6）。**10 项已在生产**（随另一会话 22:45 整包批次上线），1 项待定。

**① 选中态对比度：新增专用令牌，不改 `--p-dark`。**
`th.sel-col` 的 `color` 由 `var(--p-dark)` 改 `var(--p-ink)`（浅 `#0e7490` / 深 `#22d3ee`）。
- 真机 3.49:1 → **5.08:1**；🔴 **审核报告的估算值（3.34:1）不等于实测值** —— 估算是手算底色的近似，**结论方向可以采信、具体数字不要**。
- 为什么不直接改 `--p-dark`：它同时供白字底（`.btn-primary`）、`main-tab.on` 等 **12 处**使用 ⇒ **别动通用令牌去修一个专用场景**。

**② 渲染热路径：缓存要"一次算好"，不是"每处各缓存一次"。**
四层（`rowWarnArr` / `heatOf(r,u)` / `cellIssueIndex` / `rowSumArr`+`rowSumOf`）。
- 🔴 **只把 `parseInt` 从模板挪进 WeakMap 缓存＝白做**：调用数只降 27.6%（判据要 ≥60%）。
  栈采样显示 **92.1% 仍来自 `rowSum`** —— 因为整表 **3,234 个 `<input>` 全量常驻、不虚拟滚动**，
  一次击键就重渲染全表，**每次失效都重算全部 154 行合计**。
- ⇒ **真杠杆是虚拟滚动 / 行级组件化**（把"整表 computed"拆成"每行自己的 computed"），
  不是继续加微观缓存。**别再靠加缓存去凑百分比。**
- ⚠️ 但**缓存正确性必须带陈旧性测试**：改一格的值后**必须立刻**变色/变告警（缓存不得返回旧值）；
  改 `r.ai` 后同样要失效；非本表行对象要能退回原实现兜底。

**③ 可访问性（与审核报告的一处刻意偏离）**：
- 网格：`role="grid"` + `aria-rowcount` + `aria-colcount`；**每个 `<th>` 都要 `scope="col"`**（本轮 16 个）。
- 选中列：`aria-current="true"`，未选中写 `null`（**不要写 `"false"`**，否则读屏会把每一列都念一遍）。
- 表尾：`role="table" aria-label="合计行"` + **其 `<tbody>` 加 `role="rowgroup"`**。
  🔴 **`rowgroup` 是 `<tbody>` 的角色，不是 `<table>` 的** —— 审核意见若写「给 `<table>` 加 `rowgroup`」，
  **照抄会顶掉表格语义、比不改更差**。审核意见也要判对错。

**④ 死 CSS 删除的取证**：删后必须**逐类 `grep -c` = 0**（源码 + 线上产物两侧），并在线上标签页确认无样式回归。

**🔴 ⑤ 两条通用纪律（本轮踩到的）**

1. **判「线上有没有某特征」必须先定位特征所属 chunk，再取那个 chunk。**
   本文 §七 已为 **CSS** 记过这个坑（`cssCodeSplit` ⇒ 页面 CSS 在各自 chunk）；
   **本轮在 JS 侧复发**：拿入口 `index-*.js` 去搜 `合计行` / `aria-colcount` 恒得 **0 命中**，
   据此写出「生产仍是旧版、本轮未上线」的**完全错误的结论**（其实 10 项都已在线）。
   ⇒ 核验串一律 `for f in dist/assets/*.js dist/assets/*.css; do grep -o -F -- "$s" "$f"; done`；
   **入口 chunk 里没有业务字符串**。
2. **判「是否夹带」比字节，不比文件名。** 两个构建的资产**文件名差 31 个、真实内容变化只有 1 个**：
   入口改名 ⇒ 所有引用入口的分块改名（hash 级联）。抽样 `md` / `RoleAvatar` / `Icon`：
   **字节数完全相同**，唯一差异是行首 `import{…}from"./index-XXX.js"` 说明符。
3. **跨会话判「这处差异是谁改的、改了什么」只能按可 grep 的特征串判，不能按字节差大小判。**
   对方把 `Forecast.js` 的差异定性为「纯压缩变量重命名（±几字节）」，
   而线上 chunk 里能 grep 到 `aria-colcount` / `aria-current` / `合计行` ⇒
   **方向对、程度低估**。`Δ±几字节` 既可能是压缩抖动，也可能是**净差极小的真实重构**。

---

### §v377（2026-10-05）：预报汇总表「行选中 / 列选中」三轴选择 —— 互斥、轴判据、编辑态冲突

**只改 1 个文件**：`pages/Forecast.vue`（884,101 B → **912,016 B**，+27,915 B；终版 md5 `e0920c00…`）。⛔ **未上线**。
交付文档 `docs/UI-预报汇总表-行选中与列选中交付与验收-2026-10-05.md`。

**① 模型：三轴互斥 + 共用一套矩形（不是第二套选区）**

`selAxis: 'cell' | 'row' | 'col'`（默认 `'cell'` = 既有行为逐字不变）；
`selRange{r0,c0,r1,c1}` + `selected{r,c}` + `selAnchor{r,c}` **三轴共用**。

| 轴 | 不变式 | 效果 |
|---|---|---|
| row | `c0 = 0`、`c1 = 最后可编辑列` | **恒满宽** |
| col | `r0 = 0`、`r1 = 最后一行` | **恒满高** |

🔴 **为什么这样设计**：满宽/满高 ⇒ 下游所有按「矩形区间」取数的消费者（复制 TSV / CSV / Markdown、导出选中行、【清空选区】、批量填入、【选区统计】、删除行、`Ctrl+Enter`）
**天然支持行/列粒度、一行都不用改**。代价是**两个维护点**：`setAxisRange`（唯一写入口）＋ `clampSelection`。
**别为行/列另立第二套数据结构** —— 那样每个消费者都要写两遍。

**② 互斥必须落到三层，只做数据层 = 界面自己推翻规则**

「整行 × 整列同时选中」没有无歧义语义（交叉区？并集？）⇒ **不做叠加，只做互斥**。

| 层面 | 保证 |
|---|---|
| 数据 | 切轴时 `setAxisRange` **整体覆写** `selRange`；点任一输入格的 `mousedown` 把轴复位 `'cell'` |
| **视觉** | 行轴下 `isColHL()` **必须返回 `false`**（不许落到「当前列」分支）、列轴下不画行高亮 —— 否则「整行亮着 + 表头还有一列是选中样式」在界面上把互斥推翻了 |
| 出口 | `Esc` / `clearSel()` / 统计条关闭 / 菜单【取消行选中】**一律连轴一起复位** |

🔴 **错位态**：只清选区不清轴 ⇒「轴还是 row、选区已空」⇒ **界面没有任何高亮，右键却弹出行菜单**。
只要 `clearSel()` 被调用，就必须同时复位 `selAxis`。
（刻意例外：被点中的那一格保留 `.selected` 2px 描边 —— 它表达「操作锚点在这儿」，**不表达「这格被选中」**，三轴下都只有一个。）

**③ 轴判据 = 列元数据，不是 DOM target ★**

```js
isInputColIdx(ci)  // visibleCols[ci].edit === 'text'|'num' ＋ 数量列 ＋ 两个 calc 哨兵列
```
🔴 **为什么不能用 `e.target.tagName === 'INPUT'`**：可编辑格的**内边距**点下去 target 是 `td`
⇒ 会把「点在自己要编辑的那一格边缘」误判成「点了非输入区 ⇒ 选整行」。
**判据要问「这一列是什么列」，不要问「点到谁了」。**

**哨兵列**：`C_EXTRA_INPUT = visibleCols.length + unitCount()`（加单/箱）、`C_PRICE_INPUT = 它 + 1`（单价）——
列号**超出** `visibleCols + units` 取值范围。而行号格 / 计算列 / 操作列传进单元格轴拖动的是 **`SEQ_CI = -1`**。
⇒ 两处都必须显式认下，否则「左键选不中、右键走错菜单」；`SEQ_CI` 若原样写进 `selected.c`，
「当前列」会变成一个**不存在的列**，随后方向键 / 填充 / 右键【此列统计】全部指向空格（**不报错、就是不对**）。

**④ 🔴 进轴前必 `commitPendingEdit()`（顺序：先 commit，后 preventDefault）★ 本轮最容易静默丢改动的一条**

行/列轴的 `mousedown` 会 `preventDefault()`（禁默认焦点转移）⇒ 原先聚焦的输入框**不失焦**
⇒ 它的 `change` **永不触发** ⇒ `onCellChange` 不执行 ⇒ 刚改的那格**既不进撤销栈、也不点亮「未保存」**。
**用户眼里「我明明改了」，系统眼里「什么都没发生」。**

固定写法：`onCellDown` / `onHeadDown` 里 **先 `commitPendingEdit()`（主动 `blur()`），后 `preventDefault()`**。
真机断言：改一格 → 点行号切行轴 → ① 值仍在格内 ②「有未保存的改动」仍点亮。

**配套焦点**：编辑网格有 `tabindex="-1"`，行/列轴选中后须 `focusGrid()` 把焦点**交还表格本体**。
少这一步：`blur` 后焦点落 `body` ⇒ `@keydown` 收不到事件 ⇒ **Delete / 方向键全失效**，
而「选中整行再按 Delete」正是行轴最主要的姿势。

**⑤ 看不见的行：按原因**分两栏**报 —— 说了话但是假话，比不说更坏**

行区间是**行号连续**的（与矩形选区同语义，不另立），⇒ 被藏起来的行**也会被一起操作**。
唯一能做的是**说出来**，且必须按真实原因分开：

| 原因 | 判据 | 抬头 |
|---|---|---|
| 被搜索词 / 隐藏零量 / 列筛选挡掉 | `rowBaseShown` | `，其中 M 行已被筛选隐藏`（去清筛选） |
| 只是不在当前页 | `rowShown = rowBaseShown && 分页可见` | `，另有 K 行不在当前页`（翻页就看得见） |

🔴 原先两种原因**混成一个数**：分页开着时「全选所有行」报出「104 行已被筛选隐藏」，而用户**一个筛选都没开**
⇒ 让他去找一个根本不存在的筛选器。**删除行提示同样按两栏报**（`已删除 154 行（含 104 行不在当前页）`）。
⚠️ 这类「把 paging 当成 filtering」的混装，凡是页面同时支持筛选 + 分页的地方都要自查。

**⑥ 两处「显示与行为不一致」的预防（都是拦在源头）**

- **列轴不参与批量应用**：批量面板以 `selectedRows()` 为作用域，而列区间**满高** ⇒
  不拦则「点表头选整列 + 点【应用】」会**静默改写整张表**。⇒ `selectedRows()` 在列轴下**只认焦点行**，
  面板提示同步改「列选中不参与批量应用，请先选中要改的行」。
- **填充柄只在 `selAxis === 'cell'` 出现**：`doFill` 以**锚点格**为准、**不读 `selRange`** ⇒
  整行/整列选区下它会填出一个「从锚点算起的矩形」，而界面显示的是整行/整列。
  ⚠️ v377 之前只排除了行轴 ⇒ **列轴会漏出来**；条件必须写 `=== 'cell'`，不要写 `!== 'row'`。

**⑦ 哨兵列门禁：宁可不出按钮，也不出会做错事的按钮**
凡**与某一列绑定**的动作（插入列 / 删除列 / 此列统计 / 按安全库存补齐），落点是哨兵列时**直接不出按钮**
（`ctxColOpsOk`），而不是带着越界下标去执行。

**⑧ 右键路由（唯一判定处 `onTbCtx`，优先级从上到下）**

1. 批量填入子模式已开 ⇒ **子模式优先**（否则行轴一右键就永远打不开它）
2. 列轴 && `inColSpan(落点列)` ⇒ **列菜单**（复用表头那份，只换锚点）
3. 行轴 && `inRowSpan(落点行)` ⇒ **行菜单**，**保留整段多行选区**
4. 其它 ⇒ **行菜单** + 选区迁到该行（Excel 心智：右键哪行就管哪行）
   ／ **表头 `<th>`** 恒 **列菜单**，并行不冲突。

**⑨ 视觉语言（怎么一眼分清两轴）**
行轴：表体整行底色（`tr.row-sel`，**必须 `!important`** —— 数量格底色由 `heatOf()` 以**内联 `:style`** 写死，
**类选择器压不住内联样式**）＋左端 **3px 主色竖条** + 行号变色加粗（`.new-row` 按更高特异性负责，两者不抢）。
列轴：表头青底 + 青字 + **2px 主色下划线**（与全站激活态同一语法）。
深色模式走同一批 CSS 变量，**无新增硬编码颜色**。

**⑩ 顺带修掉的 4 个既有缺陷（都属「看起来做了、其实没做」）**

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| 1 | `editColDescAt` / `colHeaderAt` **差一列**（调用方传 0 基，函数按 1 基含序号列解析） | 右键【此列统计】报的是**隔壁列**；CSV/Markdown 表头**整体错位** | 重写为 0 基，委派 `visibleCols` / `cross.units` / `calcInputKey` |
| 2 | `ctxClear` 在加单/单价格抛 `TypeError`（`cross.units[ui]` 对哨兵列不存在） | **右键即崩**；且这两列对 `readCellVal/writeCellVal` 是越界值 ⇒ 复制/清空/粘贴/向下填充**静默无效** | 加 `calcInputKey` / `CALC_INPUT_LABEL` 认下哨兵列 |
| 3 | `selectedRows()` 在列轴下把整表当「选中行」 | 选一列 + 批量【应用】⇒ **静默改写整张表** | 列轴下只认焦点行 |
| 4 | 表体右键落在选中列内仍走单元格菜单 | 列已选中，右键却给【粘贴/向下填充】 | 新增 `openHdrCtxAt` 分流（旧的 `openBodyCtx` 已删） |

**⑪ 🔴 真机 A/B 探针工程学（本轮新踩，比功能本身更值钱）**

1. **断言必须先分类，不能全用 `exists`**：`exists`（判别点，两侧必须不同）／`always`（护栏，两侧必须相同）／
   `afterOnly`（BEFORE 侧不可达 ⇒ SKIP）／`eqSide`（逐侧期望值）。
   本轮初版把非判别断言写成 `exists` ⇒ **一口气 10 条假失败**（例：「表体右键必须弹菜单」两侧都该为真；
   「无列高亮」在 BEFORE 是 **1** —— 因为旧的「当前列」底色本来就在）。
   ⇒ **判据写错方向，比没有判据更坏。**
2. 🔴 **两个 dev server 并存会互踩 `node_modules/.vite`**：各自 `--force` 改写 `_metadata.json`
   ⇒ 同一依赖被加载成 **3 个 hash**（`chunk-*?v=27b9563e` / `?v=b5130710` / `?v=ee5b20b1`）、
   `vue.js` 出现 5288 与 5289 两份 ⇒ **双 Vue 运行时 ⇒ App 挂载了但整片空白、控制台 0 报错**。
   我一度把它读成「旧构建没有该功能」（**假阴性**）。
   **判别证据**：`performance.getEntriesByType('resource')` 里同一文件不同 `?v=` 存在多份。
   ⇒ **A/B 是顺序的，就一次只跑一个 server**（这也是唯一可靠的解法）。
3. **固定 `sleep` 等不到 Vite 按需编译**：`Forecast.vue` 转译后约 5.2 MB，首次访问要现编译 ⇒
   一律用 `waitFor(page, 条件, ms)` 轮询，**不要写死 5.5s**。
4. **常量假判据**：`table.tabIndex` 在**没有** `tabindex` 属性时也返回 **`-1`**（HTML 规范：不可聚焦 ⇒ -1）
   ⇒ 这条断言**永远为真**、什么也证明不了。改查 `getAttribute('tabindex')`。
   ⇒ 通则：**先问「这个读数在反例下会不会变」**，不会变就不是判据。
5. **触发后同步读 DOM 恒读到旧值**：Vue 在 microtask 里刷新 ⇒ `dispatchEvent('input')` 之后立刻读，
   永远看到未更新的 50 行。⇒ 改 `async` + `await` 一拍（与 v362「触发 toast 后必须等一拍」同族）。
6. **改 `input` 后读 `textContent` 恒空**：编辑态下商品名在 `<input>` 里，其值**不在** `textContent`；
   必须读 `cell.querySelector('input').value` —— 否则「没覆盖到」会伪装成「一切正常」。
7. **CSS 锚点要带行号限定**：`tbody td.qty-cell` 是全局第 N 个，不是某行的；必须 `[data-r="2"]`。
8. **判据的期望值与元素必须出自同一个函数**：`th` 的序号列要不要计入，两处口径不同 ⇒ 差一列。
9. **自证判别力（§12 通则）**：正反两侧都要跑到，且 N/M **写死**；BEFORE 侧不可达的项要显式 SKIP，不能算通过。

**⑫ 🔴 chunk 改名铁律又添一个实例：入口 ↔ 页面 chunk 之间存在循环引用**

为证明「只改一条注释零行为影响」，我做了对照，**没得到预期结论**：
同一源码连跑两次构建 ⇒ chunk 名**完全一致**（构建是确定的）；
但**仅改一条已被剥掉的注释**（产物里 `显式/隐式/错位态` 命中 0）后重建 ⇒
`Forecast` 与**入口 `index`** 两个 chunk **同时改名**。
逐字节比对：**长度完全相同（449,869 B）、首个差异在 offset 378 —— 正是 `index-*.js` 的依赖名**
⇒ 入口与页面 chunk 有 `__vite__mapDeps` 式**循环引用**，chunk 名是占位符**迭代收敛**的结果，
**连一条注释都足以把入口 chunk 改名**。⇒ **chunk 文件名什么都判不了，永远比字节、不比名字。**
（本轮 A/B 证据不受影响：它跑在 **dev server** 上、按源码实时编译，与构建产物无关。
⚠️ 第一次对照我还犯了另一个错：两次用了**不同 `outDir`** ⇒ 入口 hash 变 ⇒ 级联。**

**验证券**：真机 A/B `AFTER 60/60 通过`、`BEFORE 59/59 通过（+1 SKIP）`、
`判别点 24 条 / 护栏 4 条 ⇒ 不符合判据 0 条`、两侧页面错误 **0**；隔离构建 `dist-v377/`
（`Forecast-DmByzzXg.js` 449.87 kB / gzip 143.22 kB，`✓ built in 2.21s`，exit 0）。

**⛔ 未部署**：前端一上线就会带上本仓其它会话的在途改动（长期脏工作区）
⇒ 发版前须走受控提交 `hergent-scoped-commit` + 夹带判定 `hergent-parallel-session-safety`（**比字节不比 chunk 名**）
+ `hergent-frontend-deploy-verify` 的零夹带核对。

**⚠️ 截图不入库**：A/B 截图里列头整片是**客户名**（报单对象），属脱敏红线 ⇒ 只在 `/tmp/v377-*.png` 本地看。
工具：`.workbuddy/tools/v377-rowcol-axis-probe.mjs`（17 相 S0–S17）／`v377-ab-compare.mjs`（对照表）。

---

### §v378（2026-10-05，**✅ 已上线 13:22**；受控提交 `86d7b24`）：选中保真度 —— 「选中什么就高亮什么」

**一句话**：缺陷不是「列高亮太强」，而是**一条视觉通道被当成两条语义用**。

🔴 **病灶**：旧 `isColHL()` 把「**选中跨度**」与「**当前列定位**」压进同一个类 `sel-col` + 同一个令牌
`--p-bg` + 一条整行底 `tr.sel-row > td`。单击 1 格 ⇒ 实测 `selArea=154` / `colOverlay=154` /
`extraCyan=35` / 表头强态 1 —— **整列＋整行＋表头同时点亮**。用户的误判是**被设计出来的**，不是错觉。
⚠️ 这**不是 bug**：`docs/UI-预报汇总表-列选中态-视觉设计方案-2026-10-04.md`（v376）明确写了这套行为
（当时为了修「列选中完全看不见」）⇒ 本版是在「看不见」与「过度可见」之间取正确档位。

🔴 **两通道模型（本版的核心抽象，可复用）**
- ① **选中跨度** `spanHas(axis,i)`：有 `selRange` 用矩形、没有（单击）用活动格。**唯一**允许在数据区上色的依据。
  ⚠️ 守卫 `selected.r < 0` **不能丢** —— `clearSel()` 只清 `selRange` 与轴、**不清 `selected`**，
  少了它 Esc/冷启动会点亮一整行或一整列。
- ② **定位指示** `isCurColHd()` / `isCurRowHd()`：**只在单元格轴**、**只画在表头 / 行号格**、
  中性灰（`rgba(var(--t3-rgb),.16)`）、**永不进入数据区**。
  样式用 `background-image:linear-gradient(...)` —— 🔴 **不能用 `box-shadow`**（会顶掉 `.frozen` 的 1px 分隔线）。
- 效果：**`sel-col` / `--p-bg` 从此只表达「选中」一种含义**（两个类由互斥判据驱动，永不同时命中）。

🔴 **对标 Excel 的取舍（别搞反）**：**刻意保留**「点列头 ⇒ 整列点亮」——
Excel 里点列标**就是**选中整列，此时 `selRange` 满高 ⇒ 整列高亮是对的。
要修的从来不是「列头点亮太多」，而是「**点一个格却点亮整列**」。
⇒ 判据是 **`selAxis` 决定什么算选中**，不是一刀切禁列高亮。反向同理：选列不动行号、选行不动列标。

**改动 8 处（全在 `Forecast.vue`）**：引擎 `:7758-7765`（删 `isColHL`，加三函数）／模板 `:1155/1161/1191/1193/1253`
（`isColHL` → `inColSpan`·`isCurColHd`·`isCurRowHd`）／CSS 删 `:12916` 假行带、加 `:12924-12925` 弱指示。
`aria-current` 挂**定位**、`aria-selected` 挂**选中**（屏幕阅读器与视觉一致）。
刻意不动：`th.sel-col` `:12931`／`td.sel-col` `:12932`／`.new-row>td.sel-col` `:13466`／`tr.row-sel` 族。

**验收（A/B：`dist-v377` vs `dist-v378`，静态代理跑的是上线产物字节）**
断言 BEFORE **64/64**（10 跳过）／AFTER **74/74**（0 跳过）／页面报错 0；★ 核心 28 条全绿。
单击 1 格：`sel 154→1`、`col 154→0`、`extra 35→0`、表头强态 `1→0`、弱态 `0→1`、行号弱态 `0→1`。
**v377 回归**：两侧各 60/60；快照差异**仅 3 处**且全在 `thSelCol/tdSelCol` 族、只在 `S14b`（行轴→单元格轴）⇒ 疑似回归 0。

🔴 **本版最有价值的复用知识：探针自身的 3 个假判据（首跑 6 条失败全是探针缺陷）**
① `__sig` 只读 `backgroundColor + boxShadow` ⇒ 对 `background-image` 弱指示器**永久失明** ⇒ 恒假；
② `nrWeak` 写 `td.seq-cell.cur-row-hd`，但**类在 `<tr>` 上**（`tr.cur-row-hd > td.seq-cell`）⇒ **恒 0**；
③ 像素采样点压在表头**白底输入框 pill**（`cell-input cell-cust`）上 ⇒ 冷选同值 ⇒ 假绿。
⇒ 🔴 **纪律：新判据上线前必须自问「它在 AFTER 侧有没有可能通过？」恒假判据比没有判据更危险。**

🔴 **第三通道「渲染像素」的做法（新，可复用）**：`Page.captureScreenshot` → Pillow 读截图字节，
采单元格**顶部内边距带**（`top+4`，避开白 pill）的**众数色**（不是中位数）。
带**判别力自证**：合成一张纯底 + 一张叠同配方 16% 灰，期望写死 `(250,250,250)`/`(236,236,236)`，先证明采样器能分辨。
实测 AFTER 表头/行号 Δ=−14 ⇒ 与 CSS 属性通道、有效色通道**三通道互证**。

🔴 **HELPERS 模板字符串的两个同族陷阱**：① **禁止反引号**（会截断，本会话第 6 次）；
② **正则反斜杠必须双写** `\\(` `\\)` `\\d` `\\s`，单写被求值阶段吃掉
（`/rgba?\\(([^)]+)\\)/` → `/rgba?(([^)]+))/` ⇒ `m[1]` 拿到 `"(250, 250, 250"` ⇒ NaN）。
✅ 自证手法：`new Function('return \`'+HELPERS+'\`')()` 还原注入值，再对**注入后的正则**实跑一次。

**验证券**：`/tmp/v378-probe-{BEFORE,AFTER}.json`、`/tmp/v378-pixel-proof.{py,json}`、
隔离构建 `dist-v378/`（`Forecast-DVhHfNnz.js` 450.08 kB / `Forecast-DN-t1QZj.css` 109,123 B）。
文档：`docs/UI-预报汇总表-选中保真度改造与验收-v378-2026-10-05.md`。
⚠️ 截图含**客户名**（脱敏红线）⇒ 只在 `/tmp/v378-*.png` 本地看，不入库。

#### §v378 上线（2026-10-05 13:22，commit `86d7b24`）

🔴 **真实增量面判据（可复用）**：`find src -type f -newermt "<上次部署时生产 index.html 的 mtime>"`
⇒ 429 个脏文件里**恰好 1 个**是本次在途，其余全是**已上线的历史在途**。
**「上次部署时刻」是唯一可靠的 mtime 水位线**（比任何文件名单都好用）。

🔴 **部署语义：生产 `assets/` 是并集目录**（2,889 物理资产 / 56 去哈希逻辑名 + `backups/` + 21 个 `index.html.bak-*`）
⇒ **绝不用 `--delete`**；一律 `rsync -a --no-owner --no-group`（无 `--delete`）+ 事前 `cp -p index.html index.html.bak-vNNN-<stamp>`。

🔴 **零夹带四路（互不依赖、均不猜 chunk 名）**：① 去哈希基名 + 字节（56→56、恰 2 项字节变）；
② **全 token 归一**（`[A-Za-z0-9_-]{8,}` → `#`）：54 同 / 2 真变；③ `scopeId` 三方（HEAD `29804117` = 生产实际 / 工作树 `bc491277` = 本构建，差集恰 1 ⇒ 反证「只 1 个 `.vue` 变了」）；
④ vs **生产生效集**：【生产有·本地缺】= **0**；★ API 超集 290 vs 290 撤回 0。
🔴 **② 不可省**：`dist-invariant-diff.py` 只归一 `data-v-[0-9a-z]{8}`（Vue scope 属性），
**漏掉自定义 keyframe 名 `cellFlash-<scopeId>`** ⇒ 报 ❌「需人工归因」的**假警报**。
⇒ **归一化工具不能靠「猜 hash 形态」；能折的 token 就全折**（v339 老账）。

🔴 **新增「零写入运行时取证」**（本版加入探针，已上线）：`addInitScript` 里猴补
`window.fetch` + `XMLHttpRequest.prototype.open`，把**非 GET 的 `/api/` 请求**记进 `window.__WRITES`；
断言 = 业务写正则 `/save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update/i` 命中 **0 条**。
**必须有「监控已安装 = true」这条护栏**，否则「0 条」在监控没装时**恒真**（恒真判据比没有判据更危险）。
生产直打读数：监控 true / 写请求 **0** / 页面报错 0。

🔴 **判据取值域必须与输入取值域同宽 —— 本版最贵的一课**：
`const IS_AFTER = LABEL === 'AFTER'` 在浏览器探针里的**二态模型**，遇到**第三态标签**（`LIVE`＝直打生产、
`PRE`、`POST`）时 `else` 分支把它当成 **BEFORE** ⇒ 拿**改造前**期望量**改造后**线上
⇒ 上线后首跑 `exit=1`、**19 条 ★ 假红**，形态酷似真缺陷。
**修**：`const IS_AFTER = LABEL !== 'BEFORE'`（**只有显式 BEFORE 才是改造前**，未知态取 fail-safe 的「新」侧）⇒ 复跑 76/76。
⇒ 🔴 **纪律：探针里禁止 `x === A ? before : after`；判据的取值域必须显式覆盖未知态。**

🔴 **判别串读数为 0 时，先问「我的判据有判别力吗」**：
① **zsh 不对未加引号的变量做词切分** ⇒ `for f in "OLD $OLD_CSS"` 把空路径喂给 `grep`
⇒ 读数 `新包=0 旧包=0`（两侧都是 0 = 判据没有判别力，不是「两边都没有」）。
② **Vue scoped CSS 会在类名后插 `[data-v-xxxxxxxx]`** ⇒ 精确串 `th.cur-col-hd{...}` **恒 0 命中**（假警报）；
须用正则 `th\.cur-col-hd\[data-v-[0-9a-z]{8}\]\{[^}]*\}`。

**上线后线上直打**：保真度 **76/76**、页面报错 0；与本地 AFTER **逐字段 161/161 全同**；
线上 **v377 回归 60/60**、与上线前基线 dump **逐字段 576/576 全同 ⇒ 零回归**。
双侧 md5 **5/5 全等**：`index.html` `a0558fef…`｜`Forecast-DVhHfNnz.js` `64297d6c…`｜
`Forecast-DN-t1QZj.css` `4a52d8d5…`｜入口 `index-WeSalXc8.js` `722f07f9…`｜`index-DQ1t-4Q1.css` `8220b06b…`。
回滚点 `/opt/hergent-cn-v2/index.html.bak-v377-20261005-153754`。

**遗留**：弱指示器强度 16%（浅 `#a1a1a6` / 深 `#8e8e93`，只调这一个比例、**不得引入主色**）｜
表头选中态对比度 3.34:1 未达 WCAG 4.5:1（v376 遗留）｜`td.sel-col` 对冻结列是覆盖非叠加（已知取舍）。

---

### 🔴 §Excel 对标扫描（2026-10-05，**只读扫描 + 方案，无代码改动、无版本号**）

交付：`docs/UI-预报汇总表-Excel对标差异与全面优化方案-2026-10-05.md`
方法：三轴并行只读扫描（选择编辑 / 视图结构 / 校验权限）→ `file:line` 取证 → **关键结论二次实证**。

**规模**：`Forecast.vue` **13,539 行 / 914,405 B**。全仓 **27 页**含 `<table>`，网格交互类 `cross-tbl`
**只在 `Forecast.vue`**；抽查 `ProductTarget`(1389) / `CustomerArchive`(554) / `DataFill`(193) 的
`keydown|paste|fill-handle|selRange|col-resizer` 命中 **均 0** ⇒ **Excel 级交互只有一张表享受得到**。

**🔴 五条 P0（真 bug / 数据风险，非"缺功能"）**
1. **排序改底层 + 不重置选区**：`applySort`(`:7301`)/`sortByCol`(`:6706`) 直接 `cross.rows.sort()` + `saveDraftNow()`
   ⇒ 改**底层顺序并持久化**；`:7280-7281` 注释自陈"selAnchor 排序后指向别的行属既有行为"
   ⇒ **排序后按 Delete 会删错行**。只读态却是副本排序（**同页两套语义**）。
2. **粘贴不跳过空单元格**（`:7946-7949` 逐格无条件写）⇒ 粘数量时**源表空格把已有数据清零，零报错**。
3. **编辑网格全量渲染**：`v-show="rowShown(ri)"`(`:1191`) ⇒ 分页只 `display:none`，全行常驻 DOM
   （`:4618` 自陈 ≈1.2 万节点）。只读表有虚拟滚动（`VSCROLL_MIN=80`），编辑表**没有**。
   ⚠️ `:8962` 注释称"DOM 仅渲染当前页" —— **与实现矛盾**。
4. **「只看有量」一键筛选不存在**：428 行里常只有 ~100 行有量；现有筛选仅"单列包含 + 唯一值勾选"，
   **无按量筛选** ⇒ 本页最高频筛选需求缺位。
5. **列权限注释过期**（见下条）。

**🔴🔴 子代理会拿「过期注释」当事实 —— 2 条结论被实证推翻**
| 子扫描结论 | 实际 | 依据 |
|---|---|---|
| 列级权限"空转、全仓无人赋值 `store.user.role`" | ❌ 错。`store/index.js:164` **有赋值**；`canSeeCol`(`:4132`) 在 `:4072` 真实过滤列 | `grep -rn "user\.role\s*=" src/` 命中 2 处 |
| "全站无打印能力" | ❌ 错。`:139` 有按钮、`:8698 printGrid(){window.print()}` | `grep -n printGrid` |
根因同一：两份都引用了 `Forecast.vue:4102` 附近**那段过期注释**。
⇒ 🔴 **凡"有/无"结论必须落到 `grep` 或真机读数；注释只当线索、不当证据。**

**🔴 「写了」≠「可达」**
`Ctrl+End`（`:6280`）代码写了、注释写了、`lastDataPos()` 也实现了，但 `:6234` 普通 `End` 分支
**没排除 ctrl/meta** ⇒ 先命中 ⇒ **永远走不到**、`lastDataPos` 成死代码。`Ctrl+Home` 同族（变成"本行首列"）。
⇒ **核查快捷键/入口的判据 = "按键后状态是否改变"，不是"代码里有没有这段"。**

**其它实证缺口**：`Shift+方向键` **不扩选**（`:6204-6211` 不判 shiftKey，而 `Ctrl+Shift+方向键` **有** ⇒ 同族不一致）｜
打印是**假按钮**（未 import `src/utils/printable.js`，而该基建 `@media print`+`openPrintable()` **Rebate 页已在用**）｜
缩放**未覆盖编辑态表尾**（`:1315` 无 `:style="{zoom}"` ⇒ 80% 时表尾列宽错位）｜
内置列"删除"是**死路**（`:6766-6770` 点了→刷新又回来，零提示，正解是隐藏）｜
金额口径分裂（其余 7 页「万元」，本页 **0 处**）。

**已核实修复、不再提案**（10-04 审核那批**全部已修**）：`th.sel-col` 用 `var(--p-ink)`(`:12931`)｜
编辑网格 `role="grid"`+`aria-rowcount/colcount`+`scope="col"`×16(`:1145`)｜`aria-current` 3 处｜
表尾 `<tbody role="rowgroup">`(`:1319`)｜`rowWarnArr[ri]`(`:8263`)+`_heatMemo`(`:3253`)｜6 组死 CSS 全 0 命中。

**路线图**：P0 8 项 → P1 14 项 → P2 14 项 → 末批 **S-1 网格内核提取**
（`useGridCore()` composable → 列元数据协议 → `<DataGrid>`；第 1 步验收 = 行数降 ≥15% 且 v377/v378 回归零差异）。
⚠️ **S-1 是重构不是新功能** ⇒ 独立分支、每次只动一类、每趟跑回归，**不在业务迭代期夹带**。

**「不抄 Excel」清单**（防盲目堆功能）：公式栏／多工作表／自定义数字格式／自动序列／行高拖拽／色筛／合并单元格 ——
理由与业务模型冲突或纯负担，详见文档 §一。

触发：Excel 对标 · 网格能力 · 交互重构 · 假实现 · 写在但不可达 · 排序语义 · 粘贴覆盖 · 打印 · 网格内核提取


### §v379（2026-10-05，**⛔ 未上线**；改动面 `Forecast.vue` `+241 −61`）：Excel 对标 P0 四项修补

> 四项 = 粘贴跳空值（C-2）／`Ctrl+Home/End/方向键` 可达（B-1/B-2）／`Shift+方向键` 扩选（B-3/B-4）／打印走 `printable.js`（E-13/G-10）。
> 逐项细节见 `version-history.md §v379` 与 📄 `docs/UI-预报汇总表-Excel对标P0四项修补-v379-2026-10-05.md`。此处只留**可复用的规律**。

#### 一、🔴 「写了 ≠ 可达」的第二种形态：**链序遮蔽**（T2/T3 同根）

`onGridKey` 是 `if / else if` 长链。**裸键分支在前且不判修饰键** ⇒ 后面那些 `Ctrl+End` / `Ctrl+方向键` / `Ctrl+Shift+方向键`
分支**永远进不去**，而它们**代码写得完整、注释也写了**（`lastDataPos()` 甚至成了死代码）。
⇒ **判据**：加键盘快捷键，不许只 `grep` 代码在不在；**必须真派发 `KeyboardEvent`（带修饰键）量落点**。
⚠️ **爆炸半径要自己量全**：文档只写了 `Home/End` 被抢，实测**4 个 `Arrow` 裸分支也抢了 `Ctrl+方向键`** ⇒
「按文档修」会漏掉一半。
**修法（保值迁移式）**：不搬动 5 个分支（diff 大、并行会话易冲突），而是**在链首加一处锁存** `const navMod = e.ctrlKey || e.metaKey`，
各裸分支改 `!navMod && e.key === …`。

#### 二、🔴 扩选必须**收敛为唯一实现**，且是「推进端语义」

原先扩选被**手抄了三份**（键盘 / `Ctrl+Shift+…` / Shift+点击）⇒ 三处行为漂移。
唯一实现 `extendSelTo(r,c)` / `extendSel(dr,dc)` 的两条硬约束：
① **锚点不动、推远端** ⇒ 基准要取**当前推进端**（`|r1−anchor| >= |r0−anchor| ? r1 : r0`），
   若每次从锚点重算，**连按 Shift+↓ 反而会把 4 行缩回 2 行**；
② **`selected` 停在锚点**（与拖选、与 Excel 同口径）⇒ 于是「`Shift+↓×3` 后 `Ctrl+D`」是**从选区首行向下填**。

#### 三、🔴 `el.focus()` 是「扩选/跟随」的**毒药**（T3 + 旧 `Ctrl+Shift` 长期失效的同一个坑）

模板 `@focus` → `onFocusCell(ri,ci,$event)` 是**同步**的，首句就是 `selectCell(r, c)`（**无 shift 参数**）
⇒ `selectCell` 把 `selRange.value = null` ⇒ **刚扩出来的选区被当场清空**。
所以「扩选后让视口跟到推进端」**不能**顺手调 `focusCell()`。
⇒ 用 `scrollIntoView({block:'nearest', inline:'nearest'})`（**已经可见时什么都不做**＝逐行推进不抖）
　 ＋ `keepCellClear(el)` 补「停在粘性列/粘性表头底下」那一档（原生最小滚动解决不了）。
⚠️ 只靠 `keepCellClear` **不够**：它只改 `wrap.scrollTop`，而 `.table-wrap` **未必是真正的滚动约束者**。

#### 四、🔴 判「可见性」的量法：`.table-wrap` 有 **2 个**，不能只看容器、也不能只看窗口

实测 `td.closest('.table-wrap') !== document.querySelector('.table-wrap')`，且首个是**零尺寸**的
（`wrapRect {t:0,b:0,h:0}`、`scrollHeight 0`）⇒ 用 `querySelector` 取包装器**会量错对象**。
⇒ 可见性判据写 **`在窗口内 ∨ 在容器可见带内`**（二者取一）：只看容器会在「窗口滚动」型布局下**恒假**，
只看窗口会在「容器滚动」型布局下**恒假**。

#### 五、🔴 编辑格「可见行 ≠ DOM 行 ≠ 打印行」——三套口径，别混用

| 口径 | 数量 | 由谁决定 |
|---|---|---|
| `tbody tr`（DOM 行） | **155** | `v-for cross.rows`（`v-show` 藏起来的**仍在 DOM**） |
| 屏上可见行 | **50** | **编辑态强制分页**（`pagingOn=true`，`pageSize=50`，`:4621`「Q7」） |
| 打印 / 导出 Excel 行 | **155** | `filteredRowsForExport()`：套**筛选**、**不套分页** |

⇒ **打印/导出＝「整张单子」（受筛选约束、不受分页约束）是刻意设计**（分页是「看」的便利）。
⇒ 判据既不能比 DOM 行数、也不能比可见行数，否则「一开筛选/一分页」就假红。

#### 六、🔴 探针（HELPERS）三条保命纪律

1. **模板字面量里禁止反引号** —— 会在那里**把字符串截断**，而 `node --check` **仍然通过**
   （后半段被解析成属性访问），症状是跑到一半 `xxx is not defined`。
   ⇒ 加**启动自检闸门**：逐个点名 `window.__*` 是否存在，缺则 `exit(2)`。
2. **内嵌表达式不做字符串转义** —— `JSON.stringify(SEED.join('\\n'))` 经「探针源码 → 注入源码 → 页面求值」三层后
   到页面手里是**字面反斜杠+n**，`parseTSV` 只切出 1 行。⇒ 用 `[…].join(String.fromCharCode(10))`。
3. **取表禁用 `[0]`** —— `document.querySelectorAll('table.edit-tbl')` 返回 **2** 个（第二个 `theadTh:0`），
   必须过滤 `thead th.length > 0`。

#### 七、🔴 判据自证判别力（本版照抄可用）

`disc(name, got, wantAfter, wantBefore)`：**BEFORE 侧断言 `got === wantBefore`**。
⇒ ★ 类判据一律 `wantAfter=true, wantBefore=false` ⇒ BEFORE 侧「通过」的含义是**「旧码确实有这个病」**。
本版 BEFORE **33/33 通过**＝每条 ★ 都在旧码上取到病态值（不是恒真）；AFTER **42/42**。
⚠️ 另有**前置护栏**防恒真：粘贴事件自证能读到 `clipboardData`、写监控+打印桩已装、进的是单元格轴、
「分页确实开着」（否则「打印不受分页限制」这条恒真）、以及**当数据稀疏时自铺基准段**
（实测当期**全表最长连续段 = 1** ⇒ 靠真实数据取不到 `Ctrl+↓` 的基准）。

---

## §v382（2026-10-06）员工弹窗**三个保存按钮合一** —— 保存单位从「行」改回「整个弹窗」

（`EmployeeArchive.vue` · 前端受控提交 `91d11b7` · 已上线 2026-10-06 18:47）

### 一、改了什么

老板原话：把「保存角色」「保存」「保存基本信息」三个按钮合并成一个「保存」，一次点完。

| | 改前 | 改后 |
|---|---|---|
| 入口 | 3 个按钮（账号卡内 2 个 + 弹窗底部 1 个） | **弹窗右下角 1 个「保存」** |
| 端点 | 3 套，各自提交 | 3 套，**一次点击串行** |
| 保存边界 | 卡片边框 = 「这段自己存」（v290 设计） | 边框只剩**分组**含义 |

⇒ **推翻了 v290 的「各自独立保存 + 边框表达保存边界」**。那个设计从根上就不对：
它把「要记住哪几处要分别点」这件事**推给了用户**，用户改完档案顺手改角色、
只点了其中一个 ⇒ 另一处随关窗静默消失。v290 只把它从「必丢」降级成「关窗前问一句」，
本版直接从根上取消了「点漏一个」这条错误路径。

🔴 **下次别再把它拆回去**：看到「合并保存」不要以为是省事，它修的是静默丢改动。

### 二、🔴🔴 本版最关键的坑：两个写步骤会**互相覆盖对方的编辑态**

`saveAccRole` / `saveAccScope` 原来各自保存完后都会 `loadEmployees()` + `syncRoleEdit(fresh)`。
`syncRoleEdit` 会把**角色编辑态和端编辑态一起**重写成库里的值。

⇒ 合并成串行后，**先存角色**就会：把 `accScopeEdit` 覆盖成库里的旧端、
`accScopeBase` 也跟着被覆盖 ⇒ `accScopeDirty` 变 false ⇒ **用户刚改的端被判成「没改动」、
静默不存**。反过来「先存端再存角色」会丢角色改动。**两个方向都会丢。**

**解法（唯一正解）：进第一个写库步骤之前，把要存的值抄成快照。**

```
const snap = { role, roles, scope, roleDirty, scopeDirty }   // 必须在首次写库之前
```

三个写库步骤（`saveEmployeeCore` / `saveAccRoleCore` / `saveAccScopeCore`）**只负责写库**：
- 不读编辑态（只读入参）
- 不自管 `accBusy`（并发由唯一入口 `saveAll` 挡）
- **不自己刷新**（否则前一步的刷新会覆盖后一步还没用到的编辑态）

刷新统一放在 `saveAll` 末尾做一次。

> 同族坑：v377「进轴前必 `commitPendingEdit`」也是「编辑态与显示态/持久态的桥没搭」。
> 这里是「**两个兄弟编辑态互相踩**」——凡「一个弹窗里放多份可编辑状态 + 保存后刷新」的组合，
> 都要问一句：**刷新会不会把还没提交的那份也覆盖掉？**

### 三、编排的四条硬约束（`tools/v382-logic-assert.py` 逐条断言 + 反例自证）

| # | 约束 | 为什么 |
|---|---|---|
| 1 | **顺序固定**：基本信息 → 角色/兼任 → 可登录端 | 新建时后两步依赖 `account_user_id`，新建态还没有账号 |
| 2 | **快照在首次写库之前** | 见上节；反例（挪后）会让断言变红 |
| 3 | **失败即停 + 不关窗** | 任一步失败就 `return`，保留现场报错。宁可让用户看见「只存了一半」，也不能关窗假装全成功 |
| 4 | **刷新一次 + 关窗放最后** | 先 `loadEmployees()` 刷新、再判 pending、最后才 `editOpen=false` |

**反例自证**（证明判据有判别力）：删 `if (!r2.ok) return` ⇒ ⑥ 红；`askDrift` 改恒 true ⇒ ④ 红；
快照挪到写库之后 ⇒ ② 红。

### 四、`scope_drift`（角色改了、端不跟着换）与用户显式选择的优先级

`PUT /api/users/{uid}/role` 会回 `scope_drift`，原来会弹一句「要按新角色对齐成 X 吗？」。

合并后可能出现「用户既改了端、又改了角色」⇒ **用户的显式选择优先**：
传 `askDrift = !snap.scopeDirty`，他改过端就不问（否则「按角色对齐」会把他刚选的端覆盖掉）。
若真问了并答「是」⇒ 顺手把那步做掉，返回 `scopeHandled=true`，第三步不再重复写。

⚠️ **对齐失败时仍返回 `scopeHandled=false`** —— 交给第三步按**用户原本选的值**再试一次，
否则「对齐失败」会连带把他本来就想选的端一起丢掉。

### 五、独立动作不在合并范围（刻意保留）

`改登录名` / `重置密码` / `按角色对齐` / `禁用·启用账号` / `生成重置码` **各有自己的按钮与提交时机**。

⇒ `saveAll` 提交完，若 `nameDirty` 或密码框里有内容 ⇒ **不关窗**，改提示
「已保存；『改登录名 / 重置密码』里还有没提交的内容」。

⇒ 对应地，`tryCloseEdit`（遮罩/✕/取消的唯一出口）与 `accAnyDirty` **一条都不能删**：
合并的是**按钮**，不是**判据**。

### 六、同轴门禁：下拉也要挂 `canDo`（不是只挂按钮）

三个按钮原本都有 `v-if="canDo('data','update')"`，但**下拉框是无条件渲染的** ⇒
没这个权限的人「看得见、改得动、存不了」（点了也没入口）。本版把
**角色行 / 可登录端行 / 兼任角色块** 三行都挂上同一轴 `canDo('data','update')` ⇒ 看不见。

🔴 这是本项目反复出现的形态：**控件可见性与它的写权限不同轴**。
以后加任何「看得见 + 改得动 + 有个保存按钮」的控件，三者的门禁必须是同一轴。

### 七、附带的两处 UI 调整（可读性，非范围扩张）

- 角色行补 `<span class="df-acc-exp-label">角色</span>`：删掉按钮后那行只剩一个孤立下拉，
  与下面「可登录端」行不对称、也看不出这格是干嘛的。
- 卡片 tip 文案：`以下每一项都**各自独立保存**…与弹窗底部的「保存基本信息」互不影响`
  → `下面改完**不用单独保存** —— 和人事档案一起，点右下角「保存」一次提交`。
  （旧文案在新行为下是**误导**，改文案属 hergent-ui-copy-guard 范围。）

### 八、验收资产（可复用）

| 脚本 | 用途 |
|---|---|
| `tools/v382-logic-assert.py` | **源码级编排断言 26 条** + 反例自证（判别力证明） |
| `tools/v382-batch-diff.py` | 隔离构建 vs 基线（当前线上）归一化比对 ⇒ 判夹带 |
| `tools/v382-fe-commit-surgery.py` | blob 手术（剔并行会话的同文件改动） |
| `tools/v381-live-probe.js` | 站点健康探针（未登录，零错误） |

**本轮验收判据链**：名单 56 vs 56 无增无减 → 归一化 54 项相同、仅 `Archive.js`(+368B)/`.css`(±0) →
CSS 那 ±0 是 182 处 `data-v-` **scope-id 重排** → 中文串集合差（基线独有 11 条全是我删的旧文案、
我独有 9 条全是新文案、别人的 0 条）→ 生产分块判别串（9 条新文案各 1、9 条旧文案各 0、
三条写路径 `/api/users/`×13 `/role`×2 `/login-scope`×4 `/api/employees`×2）→ 全量 60/60 md5。

🔴 **顺序纪律（本轮实测）**：工作区版构建会带上**并行会话未上线**的进销存脚手架
（`Inventory-*.js/.css` 真出现在产物里）⇒ 必须用**隔离副本**（`v381-iso` 那种已剔除基线）
只覆盖自己改的文件再构建。**「构建产物里有没有多出 chunk」是夹带最直接的判据。**

---

## §v383（2026-10-06）员工档案 · 新建保存后姓名被清空

**症状**：新建员工弹窗输入姓名 → 点「保存」→ **姓名框当场变空**，用户以为"没保存上"，
只能关窗重新点「编辑」才能接着为该员工开通账号。

### 🔴 根因（三层叠加，且第 ③ 层是「静默」不是「抛错」）

| # | 事实 | 位置 |
|---|---|---|
| ① | `POST /api/employees` 只回 `{"success": True, "employee_id": eid}` —— **不是员工对象** | `server/server.py` |
| ② | 新建分支把该**回执**直接交给 `openEdit(created)` | `EmployeeArchive.vue` `saveEmployeeCore` |
| ③ | `resetEditForm(e)` 是**逐字段** `src.x || ''`（**不是 spread**）⇒ 每一项都被**静默清成空** | 同上 |

⇒ 「保存成功但界面像没保存」的观感；`snapshotForm()` 又把"空"存成基线 ⇒ 后续比较全错。

**残余（更危险）**：残缺 `editTarget` **缺 `id`** ⇒ `createAccountInEdit` 发出
`employee_id: undefined` ⇒ 后端 `int(d.get("employee_id") or 0)` 兜成 **`0`**
—— 而 `0` 在本接口是**外部客户（分销商）语义**（`external_ref` 非空才跳过员工校验）
⇒ **静默造出不挂员工档案的孤儿账号**，且 `display_name` 为空、页面上看不出来。

### 改法

- `saveEmployeeCore` 新建分支：创建后 `await loadEmployees()`，再
  `employees.value.find(x => x.id === newId)` 取回**完整档案**进编辑态。
  🔴 必须回列表取的原因：`has_account` / `account_user_id` / `account_role` /
  `store_ids` 这些**派生字段只有 `employee_list()` 会补**（由 `employee_account_map()`
  唯一补齐）—— 拿到它们才能接着开通账号。
  兜底也**绝不退回残缺对象**：至少 `Object.assign({ id: newId }, body)`。
- `createAccountInEdit`：取 `editTarget.id`，取不到直接
  `toast('请先点击「保存」建立员工档案，再开通账号')` + return ⇒ 堵死 `employee_id=0`。
- 显示名兜底 `editTarget.value.name || editForm.name.trim()`。

### 验收判据（三层，均全绿）

| 层 | 工具 | 读数 |
|---|---|---|
| 行为级 | `tools/v383-name-clear-assert.mjs`（从 .vue **原样抠出真实函数源码**，`new Function` 装 stub 真跑） | **27 pass / 0 fail**；`--expect-broken` 跑 HEAD 版 **5 pass / 13 fail + COUNTEREXAMPLE-OK** |
| 零夹带 | `tools/v383-contraband-check.py`（六路） | 归一后 **55/56 逐字节一致**，唯一残差 `Archive.js` Δ+257B = 压缩器标识符重命名（单段替换） |
| 真机 | `tools/v383-e2e-probe.mjs`（线上产物 + 沙箱租户） | **24 pass / 0 fail**；核心 A0 回执 / A1 姓名保留 / A4 守卫未触发 / B4 `employee_id` 一致 |

🔴 **反例自证的额外收获**：`--expect-broken` 跑 HEAD 版时，`C2` 显示"账号已开通"的
**ok toast 照出**，而 `C1`（employee_id 正确性）失败 ⇒ 当场**实证**了上面那条
"静默孤儿账号"—— 报错不出现，不良后果却发生了。

### 通用教训（可迁移）

1. 🔴 **「创建接口的回执」几乎总是「最小标识」（id）而非「实体」** ⇒ 前端拿到后
   **不能当实体用**。判据：`Object.keys(回执).length <= 2` 就是回执不是实体。
2. 🔴 **`resetEditForm` 这类「逐字段 `src.x || ''`」是静默清空器** —— 用 spread
   （`{ ...EMPTY, ...src }`）才能保住"有值字段"，同时让缺字段落默认值。
   两者的差别**只在字段缺失时显现**，正常路径下看不出来。
3. 🔴 **派生字段（`has_account` 等）只有列表接口会补** ⇒ 任何"创建后立刻进编辑态"的
   流程都必须**回列表取一次**，否则界面会缺判断依据（本轮表现为"开通账号"表单不渲染）。

### 受控提交（同文件含并行会话改动）

工作区内 `EmployeeArchive.vue` **同时含并行会话的 2 行深色模式改动**
（`.df-role.stopped` / `.stopped-tag`：硬编码色 → `var(--st-draft-bg|txt)`），
🔴 **HEAD 里 `var(--st-draft-*)` 计数 = 0**（判别力成立）⇒ 走 blob 手术
`tools/v383-commit-surgery.py`：把工作区那 2 行**回退成 HEAD 版**生成"干净版"再挂 blob。

**三面自证**：① 干净版 vs HEAD 只有我的改动（`+25/-5`，新增行含 `st-draft` = **0**）；
② 干净版 vs 工作区恰好 `-2/+2` 且 `+` 侧全含 `st-draft`（方向正确）；
③ 三方计数 `var(--st-draft-bg)` = **0 / 2 / 0**、`请先点击` = 1 / 1 / 0。
提交 `6003859`（1 file，+25/−5）；工作区那 2 行**原样留存**待对方提交。

---

## §v384 「换了 `editTarget` 却没重建编辑态」—— 同一弹窗的同族缺陷

**报障**（老板）：新建员工开通账号时选了「导购」，点完「开通账号」界面显示「员工」。

**根因（三层，与 §v383 同族）**：`createAccountInEdit` 成功分支
```js
await loadEmployees()
const fresh = employees.value.find(x => x.id === editTarget.value.id)
if (fresh) editTarget.value = fresh        // ← 只换对象
```
界面**据此**从「无账号」切到「已有账号」态（模板判据是 `editTarget.has_account`），
但右侧那几行编辑态（`accRoleEdit` / `accRolesEdit` / `accScopeEdit`）**仍是开通前**的值——
而开通前那份是 `resetEditForm(src)` 时由 `syncRoleEdit(src)` 落下的，那一刻 `src` 上**没有账号**
⇒ `src.account_role` 为空 ⇒ 落到默认 `'staff'`（**员工**）。

🔴 **危害不止显示**：`accRoleDirty` = (`accRoleEdit` ≠ 库里 `account_role`) = `'staff' ≠ 'guide'`
= **恒真** ⇒ 界面冒「有未保存的改动」；用户顺手点一次右下角**唯一**的「保存」
（v382 合并保存后极易触发）⇒ 走 `saveAccRoleCore('staff')` **把刚设的导购真的改回员工**。

**铁律**：**「换 `editTarget`」必配「重建编辑态」**。凡"刷新列表 → 换对象"的路径，
必须同时调 `syncRoleEdit(fresh)`。本页已有三处这么做（`resetEditForm` / `saveAll` 结尾 /
`saveAccScopeCore` 后），**唯独 `createAccountInEdit` 漏了**。

**同族排查（口径，别扩大）**：另两处也做 `editTarget.value = fresh` 而不 `syncRoleEdit` ——
`renameAcc`（改登录名）、`toggleAccStatus`（启用/禁用）。**它们不必改**：这两处不碰
`account_role` / `account_login_scope`，刷新后这两个字段不变 ⇒ `accRoleDirty` 不受影响。
判据是**「账号态发生跃迁（无账号 → 有账号）」**，不是"见到 `editTarget.value = fresh` 就补"。

🔴 **探针假绿教训（本条最该记）**：`.df-acc-create`（开通表单）与 `.df-acc-manage`（已有账号态）
里**各有一个 `select.acc-role`，class 完全相同**。探针原来取"**可见的第一个**"⇒
界面**没切换**时会读到**开通表单**那个下拉，而它的值**恰好也是用户刚选的 `guide`**
⇒ 把本该 FAIL 的核心断言读成 **PASS**（v1 就是这样骗过一次）。
修法：**按容器定位**（`.df-acc-create select.acc-role` / `.df-acc-manage select.acc-role`），
并加**守门断言**（先证 `.df-acc-manage` 已渲染，再读它里面的值）。
⇒ 通用纪律：**同名控件的"取值范围"必须由容器收窄**，不能靠"可见性"排序。

---

## §v385 新建员工 / 选角色 / 开账号「一屏一次完成」（2026-10-06 · ✅已上线 · 提交 `8170560`）

**老板原话**（贴舟谱「新建员工」截图）：「能否采用一样的方式，新建员工/选择角色和创建账号**在一个界面完成，不要分两步**。」
⇒ 原实现确为两遍：`isCreate` 时账号区只有一句「保存员工后，可在此为其开通登录账号」，
表单要等档案落库、弹窗切到编辑态才长出来。**只动 `EmployeeArchive.vue` 一个文件。**

### 1. 五条实现纪律（每条都对应一个"否则会怎样"）

| # | 做法 | 不这么做会怎样 |
|---|---|---|
| ① | 新建态与「未开通账号」态 **共用同一块表单、同一份 `v-model="accForm2"`** | 拆成两套绑定 ⇒ **在一个状态填的值，切到另一个状态就没了** |
| ② | 右下角**唯一**按钮文案由 `accDraftWanted` 推出（`footerBtnLabel`），**该 computed 同时是提交动作的判据** | 文案与行为分两份 ⇒ **「按钮写着『创建并开通账号』、实际只建了档案」** —— 对用户撒谎 |
| ③ | `saveAll()` 里 **先 `pwdOk` 校验、再调 `saveEmployeeCore()`** | 顺序反过来 ⇒ 留下**「档案已建、账号没开成」的半成品**（能提前发现的问题不该留到写库之后） |
| ④ | 跨库两步 ⇒ **失败路径必须可自愈**：`accSnap` 快照恢复 + **不关窗** + 界面停在「未开通账号」态 | 失败后 `openEdit(fresh)` 已把账号区清空 ⇒ **用户要重敲登录名和密码**（正是"合并一屏"要消灭的东西） |
| ⑤ | 无 `data/create` 权限 ⇒ **整块收起**账号表单（`<template v-if>` 包住，不是只藏按钮） | 只藏按钮 ⇒ 用户填完**发现没处存**，且底下「创建员工」会把输入**静默丢掉** |

### 2. 🔴 跨库 ≠ 原子（架构级约束，必须对老板讲清）

员工档案在**租户库** `tenant_N.db` 的 `hr_employees`；登录账号在**平台主库** `erp.db` 的 `users`。
SQLite **没有分布式事务** ⇒ 「一次点击」本质是**两次写**，第二步理论上会失败（如登录名撞车）。
⇒ 能做到「失败可见、现场保留、就地重试」，**做不到"绝无中间状态"**。这条**不能对非技术老板打包票**（交付说明里原话写了）。

### 3. 🔴 顺带修的真 bug（v382 遗留）—— 兄弟函数返回形状必须一致

`saveAccScopeCore()` 原来 `return true/false`（**裸布尔**），而 `saveAll` 的调用点读的是 `if (!r3.ok) return`（**结果对象**）
⇒ `r3.ok` 恒 `undefined` ⇒ `!undefined` **恒真** ⇒ **saveAll 写完「可登录端」后必然提前返回**，
后面「刷新 + 成功提示 + 关窗」三步全被跳过。
**现象（老板视角）**：只改「可登录端」再点保存 ⇒ 库里**真的改了**，但界面不刷新、不弹提示、窗口不关、**脏标签还在** ⇒ 以为没保存。
⇒ 通用纪律：**同一族的兄弟函数（`saveAccRoleCore` 返回 `{ok}`）返回形状必须一致** ——
不一致时**"写错了也不会报错"**，只是静默走另一条分支。**判据 L 组专锁这条。**

### 4. 🔴 判据工具自身的两个缺陷（都曾造成/险些造成误判）

- **`extractComputed` 必须按圆括号配对**（`matchParen(src, openParen)`），**不能**从 `=>` 找第一个 `{`：
  **表达式体** computed（`() => a && b`）没有 `{`，会一路抓到**后面不相干函数**的 `{`
  ⇒ 实测报 `ReferenceError: anyDirty is not defined`。同一修复已回填 **v384 工具**。
- **轮询提示语要按「谓词」而不是「任一 needle 命中即返回」**：
  `saveAll` 会**先后**弹两条（中间态 `已创建员工` → 合并态 `员工已创建，登录账号已开通`），
  先命中的被提前返回 ⇒ 断言读到中间态 ⇒ **假红**（v385 首跑 B7 就是这么挂的，功能其实是好的）。
  ⇒ 改 `pollToastWhere(page, pred, tries)`。

### 5. 真机截图小坑

员工编辑弹窗的**滚动体是 `.df-edit-body`**（`overflow-y:auto`），头尾固定。
直接截图会**把账号区三个字段截在视口外**；要拍全须先
`document.querySelector('.df-edit-body').scrollTop = scrollHeight`。
⇒ 交付物固定出两张：**提交前**（一屏原貌，价值最高）＋ **提交后**（账号已开通）。

---

## §v390 侧栏重构为 8 项职能区 + L1 双入口「＋」（2026-10-07 · ✅已上线 · 前端 `a3596c3` / 后端 `35ab946`）

终版图 = `docs/侧边栏归类结构重规划-2026-10-06.md` §10.3.4。
**8 项 = 2 直达 + 6 弹窗**：经营工作台(直达) / 预报订单管理› / 进销存› / 目标与返利(直达) / 核算› / 经营分析› / 档案管理› / 系统›。
v388 只把「档案管理」升成职能区验骨架（当时 1 个区），本轮一次落成终版（6 个区）。

### 1. 🔴 「一级项做不做弹窗」的唯一判据
**内部有"多个同级页面" ⇒ 弹窗；只有一页 + 页内页签 ⇒ 直达。**
与 v303/v375 那两条「页内页签型模块不新增侧栏」同族（同一个判断的另一面）。

### 2. 🔴🔴 职能区的「闸门」怎么选（本轮最贵的一条）
职能区可选 `path` 作**准入锚点**（`resolveNavItem` 里 `if (it.path && !canSee(it.path)) return null`）。
**不设闸门时，区的可见性 = 区内条目的并集（∪）；设了闸门 = 交集（∩）。** 两个方向都会出事：

| 情形 | 不设闸门会怎样 | 该不该设 |
|---|---|---|
| **进销存›** | 区内「库存效期补录」挂**宽模块 `stock`** ⇒ 业务员/会计/主管/仓管侧栏里都会冒出一个叫「进销存」的区 —— 而按 v380 能力闸门它**只该给老板/管理员** | **必须设** `path:'/inventory'`（`module:'inventory'` + `lock:true`）。真机探针 P5/P6：抹掉闸门**立刻**漏给 accountant/sales/supervisor |
| **档案管理›** | 看着"该设"（容器 `/archive` 看着是这一类的地盘） | **故意不设** —— 容器 `/archive` 挂 `data` **∧ `BIZ_ROLES`**，比区内条目**更窄** ⇒ 拿它当闸门会把「会计（有 `crm`、无 `data`）看得见渠道与价格」**藏掉** |

⇒ **纪律：闸门要选「比区内条目更宽或等宽」的那个锚点，不是"名字最像"的那个。**
判据：拿每个候选 anchor 跑一遍 `canSee`，**设闸门后可见角色集不得少于不设时**。

### 3. 高亮判据必须换成「按 path + tab 比」，不能靠 `.router-link-active`
`/forecast` 三条子条目是**同一 path、不同 query**（`?tab=history|config|target`）⇒
`router-link-active` 会**三条一起亮**。新增 `isCur(x)` 显式比 path + tab；
一级项另用 `areaCur(it)`（区内任一条命中即高亮）。
手机抽屉里 `md-item` 的 `to` 由 `navTo({path,tab})` 组装 —— ⚠️ **`navTo` 要分开写 `tab`**，
不能把 `?tab=` 塞进 `path`（`path` 同时是**权限判据的键**，塞进去 `ruleFor()` 就匹配不上）。

### 4. L1 双入口「＋」的落法
条目可带 `create:{to, module, title}` ⇒ 行右侧渲染「＋创建」。
**出现与否在 `resolveNavItem` 里判**（`canDo(create.module,'create')` 假 ⇒ 把 `create` 置 null），
**模板不补第二份判据**（v291/v311 纪律）。模块取 **`data`** —— 与 `Forecast.vue` 里既有的 9 处
`v-if="canDo('data','create')"` 同源，不新造（v335 纪律：键写错会 fail-closed 把按钮全藏掉）。
⚠️ **手机端刻意不做「＋」**：本轮唯一带 `create` 的条目 `path='/forecast'` 属底部栏三项之一
⇒ 按抽屉规则**永不出现** ⇒ 写了就是**永远不可达的死分支**。

### 5. 🔴 探针自身的三个坑（都导致过假绿/假红）
1. **`permissions_detail` 必须是 `{模块: [动作]}` 数组**。写成 `{模块: {动作:1}}` 时
   `canDo` 走 `Array.isArray` 假分支 ⇒ **fail-closed ⇒ 全班角色都判"没有 create"**。
   ⇒ **只验"只读时为 0"没有判别力**（两侧都是 0），必须 **全动作 1 个 vs 只读 0 个成对看**。
2. **反例判据要比「边界值」、并标侧别**：v388 已把档案管理升成职能区 ⇒ 旧产物有 **1 个**职能区，不是 0 个；
   旧产物**有**一个叫「进销存」的入口，但它是**平铺直达项** ⇒ 判别点在 `kind`（`link` vs `area`），
   不在"名字在不在"。写成 `!includes('进销存')` 会**指针标红了产物**。
3. **剥 `<script setup>` 时 `String.indexOf('<script setup>')` 会被行内注释骗到**（本仓 Shell.vue 第 79 行注释里
   就写着 `` `<script setup>` ``）⇒ 必须用**换行锚定**正则 `/\n<script setup>\n([\s\S]*?)\n<\/script>/`；
   另外 `fs.writeFileSync(p, code)` 后 `code.length` 是**字符数不是字节数**（25 362 字符 = 37 515 字节）。

### 6. 权限页域页签 = 侧栏一级项 **1:1**（老板拍板）
`permView.js::PERM_SIDEBAR_GROUPS` 由 3 组重排为 **8 组**，**组名逐项同序 = `NAV` 一级项名**，
短名（`tab`）只活在本文件：工作台 / 预报订单 / 进销存 / 返利 / 核算 / 分析 / 档案 / 系统 /（+「更多」）。
🔴 这条**此前只是注释许愿、没有判据** ⇒ v390 才真写进 `role-registry-consistency-check.py` 硬断言
（含反例自证：`NAV` 少一个一级项 ⇒ 必须转红）。
行名「经营看板」→「**经营趋势**」，并让 `Settings.vue` 的「对应页面」（`entries`）与补充说明（`note`）
**改回可并存** —— 原 `v-else-if` 二选一会把后半句**静默顶掉**（数据仍在 `permView.js` 里，界面看不见）。

### 7. 🟡 `v291-page-registry-guard.py`：**恒绿 ≠ 查过了**
判据 A 原按 `Shell.vue` 里 `canSee('/x')` **字面量**取引用集。表驱动（v311）之后
`Shell.vue` 里这类字面量**归零** ⇒ 判据**恒绿但什么也没查**（比红灯更危险）。
v390 把输入扩为 **∪ `NAV` 表里的 `path: '/x'`**（0 → 20 个），并做正反两侧判别力自证
（注释里注入 `/ghost-cmt-v390` 不被抓；`NAV` 里注入 `/ghost-real-v390` 立刻被报未登记）。
⇒ **纪律：改了数据源形态（手写 → 表驱动）后，回头查一遍"护栏的输入还在不在"。**

---

## §v393 · 侧栏入口落位（批次 6.1）＋ 手机抽屉的两个坑

### 1. 🔴🔴 `.md-sheet` 从来没有滚动容器 ⇒ 内容高于视口时**顶部永久够不到**（v393b 修）

```css
/* 改前：只有 bottom:0 —— 内容高了就把整个盒子顶出屏幕 */
.md-sheet{position:fixed;left:0;right:0;bottom:0; …}
/* 改后 */
.md-sheet{ … max-height:calc(100vh - 96px); max-height:calc(100dvh - 96px);
           overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; …}
```

实测（390×844）：改前 `sheetH=1258 / top=-414 / scrollH==clientH==1258`；
`position:fixed` **不随页面滚动**，抽屉**自身也不可滚** ⇒ 顶部 414px 谁也够不到。
改后 `sheetH=748 / top=96 / canScrollSheet=true`。

⚠️ **是既有缺陷、不是挂入口引入的**：改动前 17 条时内容已 1102px（同样超 844），
只是只切 258px、不易察觉；**+3 条**把它放大成显性断点。
⇒ 纪律：**给「固定定位的溢出容器」加内容时，先量一次「内容高 vs 视口高」**。

### 2. 🔴🔴 判「元素是否在用户眼前」**必须按视口判**，拿容器自身矩形当参照 = 恒真假绿

我第一版写的是：

```js
// ❌ 拿「抽屉自己的矩形」当参照 —— 而抽屉自己也在屏外（top=-414）
const ok = hd.getBoundingClientRect().top >= sheet.getBoundingClientRect().top - 2
// hd.top(-386) >= sheet.top(-414) ⇒ 恒真 ⇒ 全绿，而用户根本看不见
```

✅ 正解（与 `hergent-chart-render-verify` / 探针技能 §4 同源）：

```js
const vh = window.innerHeight || document.documentElement.clientHeight
const inView = (e) => { const b = e.getBoundingClientRect(); return b.height > 0 && b.top >= -1 && b.bottom <= vh + 1 }
// 并且要**真的把该试的滚动手段都试一遍**，再下「不可达」的结论：
sheet.scrollTop = 0; window.scrollTo(0, 0); hd.scrollIntoView({block:'start'})
```

🔴 **配套事实：探针用 JS `.click()` 能点到屏外元素。**
所以「点『＋』落到 `/inventory/purchase/new`」这条断言在**顶部不可达**时**照样 PASS**
—— 它证的是「元素在 DOM 里且绑了事件」，**证不了「用户点得到」**。
⇒ **「可达性」必须单独立断言，不能靠「能点到」代替。**

### 3. 手机抽屉的「＋」为什么曾是**永不可达的死分支**

v390 手机端**刻意不做**「＋」，注释里写的理由是
「唯一带 `create` 的条目 path=`/forecast` 属底部栏三项 ⇒ 永不进抽屉」。
v393 进销存条目（`/inventory/purchase`、`/inventory/sale`）**不在底部栏** ⇒ 这行才第一次真的可执行。
⇒ 同理那条**判据**：`create` 是否会出现，取决于**条目 path 在不在 `MNAV_PATHS` 里**，
不是「抽屉有没有写这段模板」。

---

## v394 · UI-SPEC 收口：挖出「规范 vs 实现」的两处脱节（2026-10-07）

**背景**：计划 §八 6.4 = 把进销存口径写回 `hergent-cn-v2/docs/UI-SPEC.md`。
收口前实测：**全文 0 处「进销存」**（最后提交 `3a44679` = 09-22）。
新增 **§8「业务模块范式（参考实现：进销存）」**（原 §8 版本记录顺延为 §9）。

**🔴 收口时挖出两处「规范与实现脱节」（比补一节文档值钱）：**

**① 规范自己的示例违反了自己的规则。**
§3.2 页头示例写 `<div class="pa-actions">`，而 `pa-` 是**商品档案的页面前缀**（§6.1 明写），
该类的定义**只在 `ProductArchive.vue` 的 scoped 里** ⇒ 拿页面私有类当全局类示范，
直接违反 §6.3「页面 scoped 样式里只允许出现本页前缀的类」。
⇒ **纪律：规范的示例也要过自己的检查** —— 示例里出现的类名必须能在**全局层**检索到。

**② 一个通用件从未上提 ⇒ 9 处各写一份。**
「页头右侧操作区」全站**没有全局类**（`.page-hd` 只管 flex/baseline，不含操作区）
⇒ `ProductArchive` + 进销存八页**各造一份**。

**新增判据（已写进 §8.4）：**
> 🔴 **同一选择器的定义在站内出现 ≥ 3 次（且逐字相同）⇒ 必须上提为全局类**。
> 仅 2 次且未来可能分化 ⇒ 可暂缓，但须登记。
（与 §1.6「同一阴影值 ≥3 次须上提为令牌」同源 —— **重复次数到了就该收，不靠感觉判**。）

**实测的三类重复件（已登记进 §8.4 欠账表，本轮只登记未整改）：**

| 候选全局类 | 份数 | 出现处 | 备注 |
|---|---|---|---|
| `.page-acts`（页头右侧操作区） | **9 处 / 8 名** | 进销存 8 页 + `ProductArchive` | 7 处逐字相同；`.iw-acts` 多 `align-items:center`；`.pa-actions` 是 `gap:10px` |
| `.page-pager`（列表分页条） | **3 份逐字相同** | `.ip-page` / `.isl-page` / `.is-page` | 含 `padding-top:12px` |
| `.page-filter`（筛选容器） | **3 份逐字相同** | `.ip-filter` / `.isl-filter` / `.is-filter` | `gap:12px;margin-bottom:12px` |

⇒ 涉 8 个页面 + 全站共享层，**另立批次**（不塞进「文档收口」批）。

**⚠️ 一处易被忽略的前缀冲突**：`.is-acts` **同时**定义在 `InvSaleList.vue` 与 `InvStock.vue`。
两边都是 scoped ⇒ **不互相覆盖、也不报错** ⇒ 改一处不会同步另一处
＝ §6.2 说的**静默漂移**。⇒ **新增页面时先查前缀是否已被占用**。

**🔴 深色回归的判据（v394 深色探针，22/22）—— 两条都会影响判据本身的对错：**

1. **必须用「alpha 合成的有效亮度」，不能直读 `backgroundColor`。**
   页面大量用半透明色（如 `--p-bg:rgba(6,182,212,.10)`）—— 直读会把它看成"透明"，
   但合成到深色底上**就是一块可见亮斑**。做法：沿祖先链累加合成（`r = c*a + r*(1-a)`），
   基数取浏览器默认白。
2. **白块 = 亮 且 近灰**（`lum >= 100 && sat < 40`）。
   ⚠️ 初版**只看亮度** ⇒ 把主按钮品牌青底 `#06b6d4`（亮度 133、色度 206）误报成白块，
   12 个假亮块；加饱和度一维后归零。**又是「判据取值域必须与输入同宽」。**
3. 深色令牌参考值：`--bg #1c1c1e`(28) / `--bg2 #2c2c2e`(44) / `--bg3 #3a3a3c`(58)；
   浅色则 255/245 ⇒ 阈值取 **100** 时两态天然分离。

## 舟谱截图素材库（老板本地，长期资产）

- **路径 = `/Users/zhangjunfeng/Documents/舟谱截图/`**（按职能区分目录：档案管理 / 仓配管理 / 数据报表 / 财务管理 / 导出的报表）。
- **档案管理目录内 9 张弹窗截图**（2026-10-06 摄）：档案管理弹窗（7 列）/ 采销管理弹窗（6 列）/ 资金管理 / 仓配管理 / 财务管理 / 数据报表 / 市场营销 / 员工考核 / 设置（3 列）。
- **舟谱面板形态（原图实证）**：一级项右侧弹白底卡片 ⇒ **分组横向并排成列**；列标题粗体置顶、列标题下有细分隔线、列间纵向分隔线；采销管理每条目右侧带蓝色文字小按钮「创建」；条目多的列自动更宽（设置弹窗 3 列宽窄不一）；列底部另有流程示意小图标行（装饰性，不复刻）。

## v395 · 侧栏弹窗横向分列已写入 UI-SPEC §3.4

- **规范位置**：`hergent-cn-v2/docs/UI-SPEC.md` **§3.4 侧栏一级项浮层面板（横向分列 · v395）**（§3 布局与响应式下，§3.3 断点之后）。
- 写了什么：形态来源（舟谱 + OCR 实证清单）+ **读图纪律**（模型读不了图 ⇒ 必须走 `ocrcli.swift`，不许拿文档转述冒充原图实证）+ DOM 契约三层（面板→列→行）+ 六类关键值表 + 五条硬规则 + 移动端边界 + 同页多入口三环节连锁表 + 几何验收判据。
- 🔴 **五条硬规则**：① 一个 `sg` = 一列（平铺 = 头号反例）② 列宽自适应不写死（124/240px）③ 加列只变宽不变高 ④ 空列自动消失 ⇒ 模板**禁止**再补 `v-if`（否则第二份权限实现）⑤ 面板宽度不固定 ⇒ `_placePop` 必须给 `maxWidth`。
- 🔴 **同页多入口三环节**（同 path 不同 query，缺一必出 bug）：`navTo` 支持 `q` / `isCur` **逐键比 `q`** / `:key` 带 `q`；外加「**入口立了就得真筛选**」（列表页预置筛选 + 改页头标题、新建页按 `?type=` 预置并写进载荷），后端无能力时页面须明写「开发中」。
- **移动端边界**：`≤768px` 侧栏整体 `display:none` ⇒ 抽屉 `flatMap` 摊平**仍纵向**；§3.4 **只约束桌面**，别做响应式多列。
- 🔴 **防脱节机制**（v394 教训的制度化）：新建 `.workbuddy/tools/v395-spec-shell-consistency.py` —— 把 §3.4 每条可验证断言拿去 `Shell.vue` 比对（类名存在性 / 数值一致性 / 关键机制 / 反例禁令），`--strict` 有 FAIL 即 exit 1。初跑抓到 1 处（规范表格漏写 `z-index:30`）⇒ **补规范而非改判据迁就**。
- 已知欠账（已在规范登记）：`.sb-pop` 的 `z-index:30` 仍是字面量，未走 §1.7 浮层档令牌。

## v396 · 全局标签栏（对齐舟谱）+ 模块内页签退役（2026-10-08）

**需求原话（老板）**：「点击弹窗中的单个字段，会把整个模块的**所有**标签全部展示出来，
这个行为是错误的」⇒ 要求对齐舟谱：**点一个字段只开一个标签**，每个标签带刷新 ⟳ 与关闭 ×。

### 🔴 两种语义（本轮全部改动的理由，以后别再混）

| | 语义 | 长什么样 |
|---|---|---|
| 模块内固定页签（**旧**） | 「**这个模块有哪些页**」 | 进任意条目都看到**整组**页签 |
| 打开历史标签栏（**新**） | 「**我打开过哪些页**」 | 点一个开一个、累积、可单独关 |

### 舟谱实证（OCR + 像素，见 `competitor-zhoupudata.md §6`）

- 标签栏 4 个标签 = 弹窗「商品相关」列**前 4 个条目**且**顺序一致** ⇒ 点一个开一个。
- 10-06 老截图同位置**为空** ⇒ 存在「**无标签态**」。
- 标签 = `[圆图标] 名称 [×]`；**激活标签白底(255)、其余灰底(228)**。

### 老板拍板（Q1–Q6）

Q1 **A** 刷新在名称**左侧**（确认那个圆环就是刷新）｜Q2 **B** 关掉最后一个 ⇒ **回首页**
｜Q3 **A** 模块内页签**退役**｜Q4 **A** 刷新浏览器只还原当前那一个（**内存态**）
｜Q5 **B** 放不下收进「更多」下拉 + **上限 18**（超出淘汰最久未激活）｜Q6 **A** 手机端维持现状。

### 落地的五个新文件 / 改动面

- `composables/useTabs.js` —— 标签状态机（模块级单例）：`openTab` / `closeTab` / `resetTabs`、
  `MAX_TABS=18` + LRU 淘汰（**永不淘汰当前**）、key 由「path + 排序后的关键 query」算出、
  `EPHEMERAL=['__r','denied','edit_rule']` 不进 key。
- `constants/tabTitles.js` —— **子页标题唯一源**（`SUB_TITLES` / `DEFAULT_SUB_KEY` / `effTab`）。
- `components/TabBar.vue` —— UI（⟳ 左、× 右、溢出测量 + 更多下拉、`≤768px` 与打印时隐藏）。
- `Shell.vue` —— `.content` 改「标签栏 + `.view-wrap` 滚动区」两层；`watch(route.fullPath)`
  自动开标签；`:key="viewKey"` 只含刷新计数（**不含 fullPath**，否则页内切页会整页重建重拉数）。
- 退役 5 处：`InventoryShell` / `Archive` / `Print` / `Rebate` / `LossAccounting`。

### 🔴 三条硬结论（踩出来的）

1. **退役页签 ⇒ 必须同步在侧栏弹窗补齐子页入口**，否则那些页**再也到不了**
   （退役后弹窗是唯一入口）。本轮为此把「目标与返利」从**直达项升级为职能区**（6 条，分
   目标/返利两列）、「核算›损耗」补「货损填报」。
   ⚠️ **手机端更要命**：手机标签栏按 Q6 A **不出** ⇒ 抽屉必须摊平这些子页；
   而抽屉原有规则「path 在 `MNAV_PATHS` 里就整区滤掉」会让「目标与返利」6 条**全部消失**
   ⇒ 新增 `EXPLODED_PATHS`（页签已退役的 5 个 path）区分「锚点本身不重复」与「子页要摊平」。
2. **标签标题三层回落，顺序不能错**（`useTabs::tabTitle`）：
   `SUB_TITLES`（子页） → `PAGE_RULES[path]` **精确命中** → 路由 `meta.title` → `pageTitle`。
   🔴 直接用 `pageTitle` 的坑：它走 `ruleFor`（**逐级去尾**），`/inventory/purchase` 会继承
   `/inventory` 的「进销存」⇒「采购单 / 销售单 / 库存查询」**三个标签同名**（探针 P10 抓出来的）。
   反过来 `/archive/products` 在 `PAGE_RULES` 里**有**精确行（商品档案），而它的 `meta.title`
   只是笼统的「档案管理」⇒ 精确行**必须优先于 meta**。
3. **URL 归一**：`/rebate` ≡ `/rebate?tab=dashboard`（`DEFAULT_SUB_KEY` 注入 + `effTab` 比较），
   否则点弹窗「仪表盘」会开出**两条同名标签**；侧栏当前项也会「两条都不亮」。

### 🔴 `isCur`（侧栏高亮）必须用 `effTab` 比较

原来直接比 `route.query.tab` 与 `x.tab` —— URL 省略 tab 时 `''` ≠ `'dashboard'` ⇒ 站在仪表盘上
侧栏两条都不亮。改用 `effTab(path, tab)`（省略时补 `_default`）后两边同为 `'dashboard'` ✓。
（这是 v390 那条「同 path 不同 query 会一起亮」坑的**镜像**：一个多亮、一个不亮。）

### 探针自身教训（v396 一次性踩了 4 条假红 + 1 条真缺陷）

- ❌ **硬编码标签索引**（`closeTabAt(1)`）：上一个断言成立与否会改变索引 ⇒ 误报 4 条 FAIL。
  改为 `closeTabByTitle(title)`（按标题找）后全绿。
- ❌ **硬编码标签条数期望**：基线应取「上一步的实测 n」，不是拍脑袋的常数。
- ❌ **点「更多」后立刻查行数** ⇒ 0（Vue 还没渲染）。必须 `await sleep(350)`。
- ⚠️ `POST /api/rebate-rules/simulate-batch` 是**只读语义的计算接口**
  （后端 `_READ_ONLY_POST` 早列过，v335），由返利页 `onMounted` 自动触发 ⇒ 零写入判据要**豁免**它。
- ✅ 唯一真缺陷：`tabTitle` 用了会「逐级去尾」的 `pageTitle` ⇒ 进销存子页标签同名（见上文第 2 条）。

### 本轮「规范 / 技能」落点（2026-10-08 收口，防重复劳动）

- **规范** = `hergent-cn-v2/docs/UI-SPEC.md`（**唯一权威**，29497 → 42371 B）：
  新增 **§3.5 全局标签栏**（两种语义辨析／DOM 契约／六条硬规则／内容区两层／标题四层回落／
  URL 归一／退役纪律三环）、**§7.3 文档↔源码「标识符」审计**；修订 **§2.5**（页内 Tab **用途收窄**
  ⇒ 只用于弹窗/表单内部分区）；§9 版本记录加 v396 行；并登记 **`/forecast` 是唯一过渡态**（页内页签暂留）。
  🔴 **更正（v405，2026-10-08）**：该过渡态**已消除** —— `/forecast` 的 `.module-tabs` 已退役，
  本节末尾「v405」段记录了退役三步与两个验收探针；`UI-SPEC.md §3.5` 里那句「当前唯一的过渡态」
  也已改写为「已消除」。
- **技能 `hergent-nav-tab-restructure` 已按新范式重写**（25212 → ~35 KB）：§3.2 由「加页签」改为
  「**旧范式留档 + 新范式三步**」；新增 §3.5（标签栏三唯一源）/§4.6（标签栏专用判据）；
  §五 报备加「**入口可达性**」；frontmatter 补触发词（模块内页签退役 · 页签条删掉 · 加个标签栏 · 标签名都一样）。
- **技能 `hergent-e2e-readonly-probe`** 补「🔴 v396 补：截图工具链的三个坑」（探针侧的表述，
  与 `local-machine-pitfalls §39/§40` 同源）。
- 🔴 **新守卫**：`.workbuddy/tools/v396-spec-tabbar-consistency.py --strict`
  （A 类名／B 数值／C 机制／D 反例禁令，**ALL PASS**）—— 改规范或 `TabBar.vue` 后**必跑**。
  ⚠️ 首版 **13 项假红里只有 1 项是真缺陷**：① 规范侧期望串**不能要求独立反引号对**
  （文档常把多个值合写在一个反引号对内 ⇒ 10 项假红）；② **反例禁令必须跑在剥掉注释的源码上**
  （`pageTitle(path)` / `main-tabs` 都出现在**注释**里 ⇒ 裸 `in` 判断恒真/恒假）。
- ⚠️ **这次真的臆造了类名**：写 §3.5「DOM 契约」时凭印象写了 `.tab-more-pop`，源码实为
  **`.tab-more-menu`**（还漏了 `.tab-more-btn` / `.tab-more-n` / `max-width:200px`）⇒
  文档"看着完整"，但按它抄**一定抄不出**。修法已固化为 §7.3：**文档里引用的每个类名/常量名都 grep 一次**。
  同批修掉 `tabTitles.js` 的自述错误（注释自称导出 `tabTitle`，实际在 `composables/useTabs.js`）。
- ⚠️ **未动**：`CLAUDE.md`（自述"桌面版历史规范"、当前主产品入口是 `HANDOFF.md`）与
  `HANDOFF.md`（交接文档，**已落后 2 个月**）—— 留作「需确认事项」，不擅自改。

---

## v399 统一留白规范（2026-10-08）—— 以「本期预报」为基准，单据页对齐全宽

🔴 **一句话**：**「大段留白」的唯一根因是页根多写了一个档位类，不是"很多地方都窄"。**
`inventory/InventoryShell.vue:22` 的 `.page page-default` ⇒ 全局 `.page-default{max-width:1200px}`＋
`.page{margin-inline:auto}` ⇒ **8 个子页全被压在 1200px 居中**。去掉档位，8 个子页**一个字没改**。

**四层留白模型**（`UI-SPEC.md §3.1`，唯一权威仍是 `variables.css`）：

| 层 | 载体 | 值 | 备注 |
|---|---|---|---|
| L0 | 侧栏 | `--sidebar-w:248px` | — |
| L1 | `.view-wrap` | `padding:20px`（`≤768px` `14px 12px …`） | **页面留白"只有这一层"** |
| L2 | `.page` | `margin-inline:auto`，**默认不设 max-width = 全宽** | 禁写 `max-width`/`margin:0 auto`/左右 `padding` |
| L3 | `.card` | `padding:18px`（`--sp-5`） | — |

**硬判据（可量化，不靠观感）**：
- **占宽比 = 页面实际宽 ÷ 内容区可用宽**（`.view-wrap.clientWidth − 左右 padding`）。**<100% 即结构性留白**。
- 🔴 **必须在 ≥1600 视口取**：1440 下 1200px 限宽只差 **8px**（量不出），1920 下差 **424px**。
- 左右留白应**对称**（差 ≤8px 记为滚动条/亚像素）。
- 探针 `.workbuddy/tools/v399-layout-gap-probe.mjs`：**相位感知**（`V399_EXPECT=before|after`，
  两相位期望**相反** ⇒ 判据不可能恒真），含判别力自证 + 零写入审计。
- 可视对照 `.workbuddy/tools/v399-layout-shot.mjs`：用**注入还原**旧规则（`.page{max-width:1200px}`）
  在同一页截 A/B，**并自证注入生效**（还原后必须量到 1200/216，与改前基线逐项吻合）。

**改动前后（@1920）**：

| 页面 | 改前 | 改后 |
|---|---|---|
| 本期预报（基准） | `.page` / 100% / 0–0 | 不变 |
| 进销存 8 页 | `.page.page-default` / 73.5% / **216–216** | `.page` / **100%** / **0–0** |
| 舟谱导入 | `.zp-wrap`（**无 `.page`**）/ 960px / 58.8% / 336–336 | `.page zp-wrap` / **100%** / **0–0** |
| 打印（**白名单**） | `.page-default` / 73.5% | **保持不变**（有意） |

**白名单（`UI-SPEC.md §3.1` 登记，改一处登记一处）**：唯一使用者 = `Print.vue`（`.page-default` 1200px，
纯阅读/设置型，卡片自身 720px 靠页容器居中）。`.page-reading`（900px）**当前无使用者**。

🔴 **两条会复发的坑**：
1. **"文档里的『当前无使用者』必须每次改动后回查"** —— `variables.css` 第 102–103 行与 366–369 行
   两处注释都写「（当前未启用）/ 目前全站无页面启用」，而实况是 `Print.vue` 与当时的 `InventoryShell.vue`
   **都在用**。假注释比没有注释更坏：下一轮的人会据此以为"档位是死代码"而删掉白名单那一个。
2. **模板串禁裸反引号**（又踩一次）：探针 `MEASURE` 模板串内写了 `` `.page` `` ⇒ `"...is not a function`。

**其他登记**：
- **全站页面根容器普查（39 个 `.vue`）**：根为 `.page` 的 30 个（合规）；**限宽 2 个**（`Print.vue` 白名单 +
  `InventoryShell.vue` 已修）；**非 `.page` 的只有 `Login.vue`**（全屏居中，独立，不适用本规范）。
  ⚠️ `ForecastHistory.vue`（`.card.history-card`）与 `AiOps.vue`（`.aops`）**不是页面根** ——
  分别嵌在 `Forecast.vue` 的 `history` 页签与 `Settings.vue` 里 ⇒ **不进本规范范围**（别误列）。
- **内层业务容器**：进销存 8 个 `.inv-page` 全是 `display:block`、**零 max-width**（只有 640px 断点）⇒
  容器改宽度即自动铺满。**这是"改一处而不是改八处"的结构前提。**
- **容器宽度的两种合规形态**：**厚壳**（`InventoryShell` 自带 `.page`，子页只给页头与内容）vs
  **薄壳**（`ArchiveShell` 全文件只有 `<router-view/>`，各 tab 页自带 `.page`）。
  **判据 = "全模块给 `.page` 的地方恰好一处"**，而不是选了哪种壳（两处都给 = 嵌套叠加）。

---

## v400 · 列设置入口与序号列（§2.6.1）—— 全站唯一约定 + 两处已知偏差

🔴 **列设置触发按钮 = 表头第一列（序号列）里的 `<Icon name="settings"/>`**
（`<button class="col-cfg gear" title="列设置">`）。**不是 emoji ⚙️** —— 是 Lucide 线性 SVG
（2 段 path、`stroke:currentColor`、`fill:none`）；**全站 U+2699 命中 0**。
`.col-cfg` + `.gear` 是**唯一一份**样式定义（无边框/透明底/默认 `--t3`/hover `--bg3`+`--p-dark`）。
查看态 `.cross-tbl`（`Forecast.vue:855`）与改单态 `.edit-tbl`（`:1151`）**各 1 处、共 2 处**，
共用同一个 `showColMenu`。

🔴 **序号 = 同一列表体** `.seq-num`，**落在齿轮正下方**（`:923` `{{ it.seq }}` / `:1192` `{{ ri + 1 }}`）。
实测齿轮 y[525..545] ↔ 序号 y[594..613]（垂直分离）。1 基连续、跟随筛选/分组重排。
**列宽权威源 = `<colgroup>` 的 `colW('seq')` = 46px**（`.seq-th/.seq-cell` 里的 `42px` 是
**不参与布局的陈旧值** —— `table-layout:fixed` 下 colgroup 胜，源码注释自述）。
`sticky left:0`，**表体 z 6 / 表头 z 9**（表头必须更高，否则被横向滚来的普通表头盖住）。

🔴 **序号列不在列设置清单里** ⇒ 不可隐藏/拖序/删除。
判据是**两个生成器不同源**：`colOrderList`（渲染序）首位**注入** `{type:'seq',key:'seq'}`，
而 `defaultColOrder()`（可配置序）= `name + MASTER_COL_DEFS`、**不含 seq**。实测菜单 8 项、无「序号」。
⚠️ 序号列的 `label` 在 `colOrderList` 里写作 `'列设置'` —— 那是**语义名**，模板对它渲染齿轮而非文字
（`v-if="col.type === 'seq'"` 分支），别把它当"表头文字是列设置"。

🔴 **两处已知偏差（真机实测，登记待对齐；本轮只立规、未改实现）**：
1. **齿轮未居中**：序号比齿轮**右偏 4px**（齿轮 cx=303 / 序号 cx=307）。成因 =
   `.th-in{display:flex;align-items:center;gap:5px;justify-content:space-between}` + 表头**只有一个子元素**
   ⇒ 齿轮被 `space-between` 推到**左**边（表头内距 7/7、内容宽 32px）。
2. **列设置菜单不从齿轮下方弹出**：锚在**工具条** `.col-config-bar` 的 `top:38px;left:0`
   ⇒ 实测菜单 t=510 / 齿轮 t=525，**Δt=−15px**、Δl=−8px，**菜单把齿轮盖住**。

🔴 **全站范围（v400 实测）**：`col-cfg` / `seq-th` / `seq-cell` / `seq-num` 在 `src/**` 里
**只**出现在 `Forecast.vue`；其余 **28 个含表格的页面**（进销存 8 页 / 各档案页 / 返利 / 工资 /
舟谱导入…）**既无序号列也无列设置入口**，首列语义分别是「单号 / 商品 / 名称 / 客户名称 / 供应商名称…」。
⇒ §2.6.1 是**全站约定**，接入时照做，**别把首列改成别的语义再另开一个设置入口**。
**触发条件**：行会被「第 N 行那个」点名 ⇒ 要序号；列集合会变（可加主档列/可隐藏/可拖序）⇒ 要齿轮。
**要齿轮就必须同时有序号列**（齿轮的宿主就是序号列表头），反之不然。

🔴 **两条复发的坑**：
1. **判据取值域必须与结论同宽**：一致性自检 D1 首版把 **U+FE0F（变体选择符）**也算「emoji 齿轮」
   ⇒ **假红 59 个文件**（⚠️/✅/ℹ️ 等合法 emoji 都带它）。真判据 = **U+2699 = 0** + 齿轮按钮那一行两种码位都没有。
   （与「搜不到先排除搜错了范围」对称：这条是**搜太多**。）
2. **模板串内注释禁裸反引号**（又踩）：探针 `MEASURE` 模板串注释里写 `` `.th-in{...}` ``
   ⇒ `SyntaxError: Unexpected token 'in'`。

**工具**：`v400-col-cfg-probe.mjs`（**两相位** `impl`=现况 36/0、`spec`=契约恰好红那 2 条 ⇒ 判据非恒真；
三条反例自证：全表只有 1 个齿轮 / 齿轮内是 SVG 且 `textContent=''` / 清单无「序号」）、
`v400-col-cfg-shot.mjs`（放大截图）、`v400-spec-colcfg-consistency.py`（A 类名/B 数值/C 机制/D 反例，ALL PASS）。

---

## v401 · 两处偏差已修 ＋ 序号列上提全局 ＋ 两试点页接入（2026-10-08 · ✅已上线）

🔴 **v400 登记的两处偏差「已从规范相位翻转到实现相位」** —— 这正是 §2.6.1 偏差表的 `spec`/`impl`
**相位反转**：改了实现，实现侧由红转绿，`spec` 由绿转红。

### ① 齿轮居中 —— 单子元素 + `space-between` 的坑

- **根因**：查看态齿轮包在 `.th-in`，而
  `.th-in{display:flex;align-items:center;gap:5px;justify-content:space-between}`。
  ⚠️ **表头单元格里只有一个子元素** ⇒ **`space-between` 对单子元素等价于 `flex-start`** ⇒ 齿轮被推到**左**边。
  （**这是本轮最值得记的一条**：`justify-content:space-between` 在单子元素上**不居中、而是靠左**。）
- **修法**：查看态补 `.th-in > .col-cfg{margin-inline:auto}`（`auto` 外边距吃掉剩余空间）。
- **改单态本来就对**：那里的齿轮是 `<th class="th seq-th">` 的**直接子元素**，靠
  `.seq-th{text-align:center}` 居中 ⇒ **不受影响**（所以只补查看态那一侧）。
- **真机**：齿轮 cx=**307** / 序号 cx=**307** ⇒ **Δ=0px**（改前 303 vs 307）。

### ② 菜单锚定齿轮 —— 坐标系错位 + 🔴 **必须配对限高**

- **根因**：`.col-menu{position:absolute;top:38px;left:0}` 挂在**工具条** `.col-config-bar`
  （`position:relative`）下，而齿轮实际长在**表头单元格**里 ⇒ **两者根本不在同一坐标系**。
- **修法**：`position:fixed` + JS 按 `gear.getBoundingClientRect()` 算视口坐标；新增
  `toggleColMenu` / `placeColMenu` / `colMenuGear` / `colMenuEl` / `colMenuStyle` /
  `closeColMenuOnViewportChange` + `watch(showColMenu,…)` + `onMounted`/`onBeforeUnmount` 成对注册。
  **滚动/改窗口直接收起**：挂 `window` 且用**捕获阶段** `addEventListener('scroll', …, true)`
  ⇒ **一个监听同时覆盖**页面滚动与表格内部 `.table-wrap` 的滚动（✅ 已验：全站 `.page`/`.view-wrap`/`.content`
  稳态**无 `transform`/`filter`/`perspective`** ⇒ `position:fixed` 参照系安全）。
- 🔴 **本轮最贵的新发现**：**光「越界就移位」是不够的，必须配 `max-height` 限高**。
  首版 `dist-v401` 真机探针当场抓出 **52 PASS / 1 FAIL**（`menu.t=529 < gear.b=545`、覆盖齿轮=true）。
  根因：本期预报列清单实测高 **543px**，而齿轮下方只剩 ~520px、上方 ~511px
  ⇒ **上翻与贴底都放不下**，落到「贴底」分支照样压住齿轮。
  **「移位不配限高，契约在几何上无解。」**
- **修法**：`placeColMenu` 先算 `spaceBelow = vh - pad - (r.bottom + gap)` /
  `spaceAbove = r.top - gap - pad`，取**更大一侧**（优先下方）作为 `maxHeight`
  （另加 `Math.max(160, …)` 保底）；`top = useBelow ? r.bottom + gap : Math.max(pad, r.top - gap - maxH)`。
- **结果**：`dist-v401b` **53 PASS / 0 FAIL**（`menu.t=551 > gear.b=545`、`Δl=0`、高 **543→521**）。

### ③ 序号列上提全局（§8.4 判据触发）

- **判据**：§8.4「同一选择器定义出现 **≥3 次**（逐字相同）⇒ 必须上提」。序号列供
  Forecast + 两试点页 = **3 处** ⇒ 触发。
- `variables.css` 新增 **`table.tbl .seq-th` / `.seq-cell` / `.seq-num`**（基样式：列宽 46 / 居中 /
  灰字 / 等宽数字）；⚠️ **横向冻结不在这份规则里**（需要的宽表如 `.cross-tbl` 各页自补 `sticky`）。
- **列宽统一 46px**：权威源 = `<colgroup>` 的 `colW('seq')` = `COL_DEFAULTS.seq = 46`；
  原 `42px` 是**不参与布局的陈旧值**（该表 `table-layout:fixed`，宽度由 `<colgroup>` 决定）⇒ 统一 46 并删副本。
- Forecast 里所有用 `seq-cell`/`seq-th`/`seq-num` 的 `<table>` **全部带 `.tbl` 类** ⇒ `table.tbl .seq-*` 全覆盖。
  `Forecast.vue` 删三条 scoped 副本，保留 `.cross-tbl` 冻结三条（sticky 各页自补）。

### ④ 两试点页接入（进销存采购 / 销售列表）

| 页 | 文件 | 列数 | 序号写法 |
|---|---|---|---|
| 采购单列表 | `inventory/InvPurchaseList.vue` | 7→**8** | `offset + i + 1` |
| 销售单列表 | `inventory/InvSaleList.vue` | 8→**9** | `offset + i + 1` |

🔴 **两页是 `offset/limit=50` 分页 ⇒ 序号必须 `offset + i + 1`（跨页连续），不是 `i + 1`。**
**分页表的序号是「全局行号」，不是「本页行号」** —— 这是接入 §2.6.1 时**最容易错的一处**。
不加齿轮（当前列集合固定）、不加 sticky（不需要横向冻结）。

### ⑤ 验收（四道全绿）

- 三份一致性自检 `--strict` 全绿：`v395-spec-shell-consistency.py` / `v396-spec-tabbar-consistency.py` /
  **`v400-spec-colcfg-consistency.py` ALL PASS**（含 **D5/D6f 两条反例自证**：混入
  `.col-menu{position:absolute;top:38px;left:0}` ⇒ D6b/D6c 必转 FAIL）。
- 真机探针 **`spec` 相位 53 PASS / 0 FAIL**；**`impl` 相位 53 PASS / 2 FAIL**
  （恰红「齿轮未居中」「菜单遮盖齿轮」）⇒ **相位反转成立、判据非恒真**。
- 真机数据：采购页 `thCount=8`/`numCount=50`、销售页 `thCount=9`/`numCount=100`；两页
  `th0Text="序号"`、`cellPos=static`（非 sticky）、`nums=["1","2","3"]`、**零写请求**；
  `col0=46px` vs `col1=210px`（**判别力对照**：不是所有列都 46）。
- 部署：留回滚点 `index.html.bak-v401-pre-20261008-153145`、**绝不 `--delete`**、
  assets **3679→3723**（并集）、**双侧 md5 完全一致**。

### ⑥ 两条新纪律

- 🔴 **「移位」必须与「限高」配对**：`position:fixed` 浮层要真正「不遮挡触发按钮」，
  只有「越界就移位」是**不够的** —— 两侧空间都不足时**必须靠 `max-height` 压进去**。
  判据 = `menu.top > gear.bottom`，且**要用真实数据量跑**（列少了根本量不出问题）。
- 🔴 **相位反转是「判据非恒真」的证据**：`spec`/`impl` 两相位在修好后应当**恰好互补**
  （`spec` 全绿 / `impl` 恰红那几条）。**别只跑一侧** —— 只跑一侧无法证明判据有判别力。

**工具**：`v400-spec-colcfg-consistency.py`（v401 扩：B 类删三条假绿判据改验 `position:fixed`、
单列加「序号列宽上提全局」、D4 拆 `[D4a]`/`[D4b]`/`[D4c]` 三族、新增 `[D6]` 菜单定位契约 6 条含反例）、
`v400-col-cfg-probe.mjs`（v401 改：默认相位 `impl`→`spec`、新增 `MEASURE_LIST` + `P7` 段跑两试点页、
P5 三条断言改写含「菜单位置由 inline style 给」）、
`v401-col-cfg-shot.mjs`（**修后可视取证**，与 `v400-col-cfg-shot.mjs` **同机位改后对照**；
产 3 张到 `outputs/列设置与序号-v401-2026-10-08/`）。
⚠️ **可视取证的纪律**：判据**不是「看着像」** —— ① 裁剪范围全部由**实测几何**算出（不估行高）；
② 中轴线画在 `th0` 水平中点，并给齿轮与 `.seq-num` 画红框，**红线应同时平分两者**（改前齿轮框会
整体偏在左侧，一眼可判）；③ stdout 打出的数字必须与 `v400-col-cfg-probe.mjs` 的 `spec` 相位互证。
⚠️ `outputs/` 的 PNG **不入库**（依 v400 先例：**脚本入库、产物不入库**）。

## v402 · 序号列铺开全站 21 页 ＋ 全局选择器扩 `seq-host`（2026-10-08 · ✅已上线）

**老板指令**：「**1.铺开；2.一起铺；3.暂时不动**」—— 逐条回答 v401 交付摘要的三项「需确认事项」。

### ① 全站有两类表 ⇒ 序号列必须用「中性标记类」，不能改挂 `.tbl`

| 类 | 成员 | 序号宿主写法 |
|---|---|---|
| A 标准表 | `class="tbl"`（16 页） | `table.tbl th.seq-th{…}`（靠 `table.tbl` 前缀） |
| B 自定义表 | `pc-tb`/`pt-tbl`/`br-tbl`/`la-ml-tbl`（5 张） | 加**无样式的中性类** `seq-host` ⇒ `table.seq-host th.seq-th{…}` |

🔴 **B 组为什么不能改挂 `tbl` 类**：各页 `.xx-tbl td{padding:…}` 自带一份单元格样式，挂上 `tbl` 会与
`table.tbl td{…}` **同 specificity 相撞**、按源码顺序互相覆盖 ⇒ 破坏现有排版。改用**只多做一件事**的
中性标记类 `seq-host`：它本身无样式，唯一作用是「给全局序号规则一个可命中的宿主」，**除序号格外不碰任何单元格**。
⛔ 页面里除 `.tbl`/`.seq-host` 外，**不许再抄** `.seq-th`/`.seq-cell`/`.seq-num` 这三条（唯一源 = `variables.css`）。

### ② 🔴🔴 Vue scoped 把 specificity 抬一级 ⇒ 全局类必须写满到 (0,2,2)

**现场**：`dist-v402` 部署后首跑探针 → 5 页（报单配置/招投标雷达/货损核算/商品目标/渠道与价格）
**表头没居中、列宽 50≠46**。不是「没生效」，是**被页面 scoped 样式同分覆盖**。

- Vue scoped 会给 `.xx-tbl th{text-align:left;padding:…}` 补上 `[data-v-xxx]` ⇒ specificity **从 (0,1,1) 升到 (0,2,1)**。
- 全局首版写 `table.seq-host .seq-th` = **(0,2,1)** ⇒ **同分**，而**页面 CSS 后加载** ⇒ 页面胜，
  `text-align:center` 与 `padding:8px 4px` **一起被夺走**（表现为「表头左对齐、列宽 50≠46」）。
- 🔴 **修法 = 把选择器提到 (0,2,2)**：写 `table.seq-host th.seq-th` / `td.seq-cell`（**元素+类+类**）⇒
  稳压 scoped 的 (0,2,1)，**与加载顺序无关**。这就是「为什么写成 `th.seq-th` 而不是裸 `.seq-th`」的原因。

⇒ **一般化纪律**：往全局层上提样式、又要覆盖各页 scoped 的同名单元格规则时，**必须假设 scoped 会 +1 级**，
全局选择器要写到 (0,2,2) 及以上（多一个元素限定符），别指望「后定义就赢」。

### ③ 🔴 CSS 注释块 `*/` 位置错误会吞掉紧随的规则（本轮最严重的自伤）

修 ② 时，一次 Edit 的 `new_string` 把说明文字写到了 `*/` **之外**（注释块已在上一行闭合）⇒ 成了**裸文本**；
CSS 解析器把这堆乱码**连同紧随其后的 `table.tbl th.seq-th{…}` 规则一起吞掉** ⇒ **全站序号列立刻失效**
（探针从 **133 PASS 掉到 104 PASS** 的现场证据，`dist-v402b`）。

- **修法**：删掉中间多余的 `*/`，让注释块延续到末尾。
- 🔴 **判定 = `/*` 与 `*/` 数量必须相等**（本轮 `/*`=149 / `*/`=149、`{`=145 / `}`=145）。
- **固化护栏**：写进 `v402-spec-seq-consistency.py` 的 `[B]` 类 4 条判据（B1 `/*`==`*/`、B2 `{`==`}`、
  B3 序号规则紧跟 `*/` 之后无裸文本夹缝、B4 无「注释外裸文本」特征）＋ `[E]` 反例自证。

### ④ 各页真实分页方式（决定序号取值）—— 别一律写 `i + 1`

| 页 | 分页 | 序号取值 |
|---|---|---|
| Supplier/Customer/ProductArchive | **前端** `page`/`pageSize` | `(page-1)*pageSize+i+1` |
| InvStock | **服务端 offset** | `offset+i+1` |
| PriceChannels | **服务端** `cpOffset`/`mxOffset` | `cpOffset+i+1` / `mxOffset+i+1` |
| 其余页 | 无分页 | `i+1` |

🔴 **加序号列后 `colspan` 必须同步 +1**（空态行 / 展开行）：ReportMapping 9→10、PriceChannels 5→6、ProductTarget 10→11。
⚠️ **分页表的序号必须跨页连续**（`offset+i+1` 而非 `i+1`），已在 UI-SPEC §2.6.1 单列一段警告。

### ⑤ 齿轮（列设置入口）**没有**跟着铺 —— 这是按规范判据执行，不是漏做

老板答「一起铺」，但 AI 核实后**仍只在 `/forecast`**，依据 §2.6.1「四、」判据原文：
「长清单只读表（列固定、语义稳定）⇒ 序号建议有、**齿轮不需要**」「**列的集合会不会变**（可加主档列/可隐藏/可拖序）？
**会 ⇒ 要有齿轮**」。全站**只有本期预报**列集合会变，其余页列固定 ⇒ 按规范本身就不需要齿轮。
已在 §2.6.1 新增「**D. 齿轮仍只在 `/forecast`**」段显式写明：**齿轮不是样式、是与列数据集绑定的功能，
不要给固定列页面硬套**。（⇒ 以后遇到同类「一起铺」指令，**先用判据筛，再据实回话**，而不是硬铺。）

### ⑥ 验收（四道全绿）

- 真机只读探针 `v402-seq-probe.mjs`：**PASS=147 / FAIL=0 / SKIP=3**（21 页 × 8 条断言；
  每页测：表头首列=序号 / 带 `.seq-th` / 列宽≈46 / 居中 / 首个 `.seq-num`=1 / 号格居中 / 号格宽≈46 / **零写请求**）。
- SKIP 3 页**合理**（目标与返利 / 货损计算工作流 / 算工资 —— 无数据时空态**不渲染 `<table>`**，探针报 SKIP 并打印页内表清单）。
- 一致性自检 `v402-spec-seq-consistency.py --strict`：**36/36 ALL PASS**（含 `[E]` 反例自证）。
- 隔离构建 `dist-v402`→`v402b`→**`dist-v402c`** 三次均留回滚点（39→40→**42**）、**绝不 `--delete`**、
  `chown -R hergent:hergent`、**双侧 md5 一致**。
- 🔴 探针「零写请求」有 1 类**误报要处理**：`POST /api/rebate-rules/simulate-batch`（Shell 多页预取的批量返利试算）；
  探针**排除该路径但显式报出排除条数**，避免「静默放过」。

### ⑦ 本轮发现的既有瑕疵（非 v402 引入，登记待修）

🔴 **`POST /api/rebate-rules/simulate-batch` 未登记后端只读 POST 白名单**：`server.py:741` 的
`_READ_ONLY_POST` 含 `/api/price-change/preview`、`/api/rebate-contracts/simulate`、`/api/products/compare`、
`/api/pricing/match`、`/api/einvoice/verify`、`/api/product-targets/alloc-preview`、`/api/ai-query` 等，
**`simulate-batch` 不在其中**（名单里只有**名字相近但路径不同**的 `/api/rebate-contracts/simulate`）
⇒ 后端仍按 `create` 动作鉴权 ⇒ `sales` 无 create 的角色会 **403**。

**工具**：`v402-apply-seq.py`（受控批量插入器，43 条三元组，**每条 `old` 必须恰命中 1 次**否则整批不写）、
`v402-check-syntax.py`（抽 `<script setup>` 跑 `node --check`）、`v402-seq-probe.mjs`（全站真机只读探针）、
`v402-spec-seq-consistency.py`（A/B/C/D/E 五族，含 CSS 注释配对护栏）、
`v402-scan-tables.py`/`v402-scan-list-tables.py`（扫全站表 / 提列表页 v-for 与分页标识符）。

## v403 · 采购订单重塑（进销存内重塑，对齐舟谱）+ 新增 UI-SPEC §2.4.1（2026-10-08 · ✅已上线）

素材 = `/Users/zhangjunfeng/Documents/舟谱截图/采购订单`（实测 **9 张**）＋舟谱导出近 30 天采购数据。
落地 = 改现有 `/inventory/purchase` 三页（**不另起一套**）、复用 `/api/psi` 与既有闸门。

### ① 底部动作条「贴视口底沿」= 两半成对（新立规 → UI-SPEC §2.4.1）

舟谱那条看着天然贴底，是因为它的**明细网格撑满剩余高度**；我们明细只有一两行时会**浮在页面中间**。

| 半 | 位置 | 内容 |
|---|---|---|
| 高度链 | 容器（`inventory/InventoryShell.vue` 的 `.page`） | `.page{display:flex;flex-direction:column;min-height:100%}` ＋ `.page > :deep(*){flex:1 1 auto;min-width:0}` |
| 推底 | 页面（`InvPurchaseNew.vue`） | 页根竖排 ＋ 动作条 `position:sticky;bottom:0` ＋ **`margin-top:auto`** ＋ `margin:0 -20px -20px -20px` |

🔴 **为什么会断**：`min-height:100%` 是**百分比**，要沿祖先链解析出确定高度。链 =
`.view-wrap`（`flex:1` ✅）→ **中间层 `.page`（块级、高度 auto ❌）** → `.inv-page`。
断在中间 ⇒ 百分比退化成 `auto`、`margin-top:auto` 无富余空间可吸 ⇒
**数值全对、实际不生效、零报错**。**读代码判不出来，只能量几何。**

🔴 **`flex:1 1 auto` 不能写成 `flex:1`**（= `1 1 0%`）：基准 0 ⇒ 条目被压成一屏高、内容溢出框外、
容器不再随内容变高 ⇒ **长页面直接失去滚动**（无报错）。`flex-basis:auto` 让基准 = 内容高度 ⇒ 长页照常滚、短页靠 grow 撑满。

**判据（可证伪）**：`滚动容器内容盒下沿 − 动作条下沿` **≤ 2px**；反例两条 ——
① 同页明细表下沿离底沿 **> 50px**（证明判据不是"页面上随便什么都贴底"）；
② 长列表页**仍可滚**且滚到底后分页器可见（证明容器改动没把长页压死）。
工具：`.workbuddy/tools/v403-probe.mjs` 的 `C8/C8b/C8c` ＋ `A16/A17`。

### ② 状态页签「计数」与「当前筛选行数」不矛盾 —— `counts` 走 `base_where`

页签 = 全部81/草稿2/待审批0/已确认0/已入库79/部分入库0/已取消0，而当前筛选只有 2 行 ——
**不是 bug**：`counts` 用**不含 `status` 的 `base_where`** 算（否则「全部」会跟着当前筛选一起变）。
且**排除逻辑走 SQL 而非前端 filter**（`exclude_status`）⇒ 反例判据：
`kind=order` 下**没有**「已退货」页签、表体**零个**已退货徽标（前端 filter 会让页签和行数都对不上）。

### ③ 「没有」≠「是零」：`has_items` 是一等事实

79 张 `CD` 前缀舟谱导入单**只有表头、零明细行** ⇒ 「订单数量 / 入库金额 / 未结款」显示 **`—`**，
不是 `¥0.00`（金额列同族：`moneyOrDash` / `qtyText` / `unpaidText` 三个谓词，
与 §8.3「未知值不静默留空」同源 —— 这里是反向：**真有值的 0 要显示 0**，没值的才 `—`）。
对照：`打印数` **必须显示 `0` 而不是 `—`**（那就是个真计数）。

### ④ 创建人下拉**必须**读主库 `users`（两套编号同 id 指向不同人）

- `users` 在 `_TENANT_COL_SYNC_SKIP`（主库专属；租户库同名表是**历史克隆残留**，只有 6 行种子 vs 主库 16 行）。
- 🔴 **更坏的一点**：`users` 与 `hr_employees` **是两套编号、同 id 指向不同人**（实测 2 个冲突：
  `id=2` 张俊峰 vs 王老板、`id=4` 张记乳品（演示）vs 刘小顶）⇒ 拿员工档案当创建人下拉的**代用品**，
  不是"筛出来恒空"，而是**显示成另一个人且零报错**。
- 收敛为唯一读取口 `_main_users()`（`tenant_scope(None)`）；主库不可读时 `refs` **不返回该键**（而非返回空数组）。

### ⑤ 🔴 同 path 不同 query ⇒ vue-router **复用组件实例、不重跑 setup**

从「采购单」切「采购退货单」（两个侧栏入口同 path 不同 query）时，标题 / 页签条 / 行状态**全都不跟着变**。
根因：`kind` 被写成**一次性常量**。修法：`kind = computed(() => route.query.kind || '')` ＋
`watch(kind, () => { f.value = baseFilter(); load() })`。
（同族记录见 `Shell.vue:149` 那条 `:key="viewKey"` 只含刷新计数、不含 `fullPath` 的注释 —— **同一条约束的两面**。）

### ⑥ 探针竞态：Vue 响应式更新是**异步**的

同步连点 3 行复选框只登记 2 条；**间隔 250ms** 连点 3/3 正确；「全选」则正常。
⇒ **页面无 bug，是探针自己的假阴性**。所有"点完立刻读 DOM"的地方必须 `await` 一拍（≥250ms）。
（截图上"点了没反应"的灰色读数，先怀疑工具，再怀疑产品。）

### ⑦ 三处换行 = 真机截图才看得见

状态徽标「草稿」折两行、日期 `2026-07-23` 折行、供应商名折行（表 `min-width` 1600 时）。
修法：`.ipl-c-st`/`.ipl-c-time` 加 `white-space:nowrap`；`.ipl-c-sup`/`.ipl-c-cat`
加 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`；表 `min-width` 1600→1700。
🔴 **教训**：列宽够不够不是算出来的 —— **必须在真机截图里逐列看**（文字折行是"宽度不足"的唯一显性证据）。

### ⑧ 页内三页签 + `?tab=` 驱动（v404 采购单详情页）

**形态**：`InvPurchaseDetail.vue` 页头（返回/复制/打印/分批到货/确认入库）＋
`.main-tabs`（三个 `.main-tab`，`:class="{on: tab===t.key}"`）＋ `.tab-pane`
（`v-if` / `v-else-if` / `v-else` ⇒ **同一时刻只渲染 1 个 pane**）。
复用的全是既有全局件，**零新增全局类**（页面私有类一律 `.ipd-*`）。

**🔴 三页签由 `?tab=` query 驱动**（可分享链接 + 浏览器后退可用；缺省 `detail`）：
```js
const oid = computed(() => Number(route.params.id))
const TABS = [{key:'detail',text:'采购订单详情'},{key:'payments',text:'货款'},{key:'inbound',text:'入库单'}]
const tab = computed(() => {
  const k = String((route.query && route.query.tab) || '')
  return TABS.some(t => t.key === k) ? k : 'detail'   // 非法值必须回落，不能渲染空白
})
function pickTab (k) { router.replace({ path: route.path, query: k === 'detail' ? {} : { tab: k } }) }
watch(oid, loadAll)          // ① 路由参数变化必须重新取数
async function loadAll () { /* Promise.all 三个端点并发 */ }
```

**🔴🔴 `oid` 必须 `computed` + `watch(oid, loadAll)`**（本批的命门）：
vue-router 对「**同 route record、只有 params 变化**」会**复用组件实例、不重跑 `setup`**
⇒ 把 `oid` 写成一次性常量，从 A 单点到 B 单会**仍显示 A 单**，而且**零报错**。
（v403 已在 `kind` 上踩过同一坑；v404 把它做成探针命门，并**在旧构建上现场复现**：
`hash` 已是单 10、页头仍是 `CD260628000002`。）
**判据写法**：**只改 `location.hash`、不 reload**，然后断言
①页头单号变了 ②**接口派生出的字段也跟着变**（证明三个端点都重取了，不是只换了个标题）
③再加一条「**不等于**旧值」的反向对照。

### ⑨ 🔴 一类专项缺陷：「同一屏两个说法互相打脸」（v404 一次抓到四条）

形态都是**页面自己算出来的一句话**，与**同屏另一个数字/事实**矛盾。四条实例：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| ① | 提示写「库存和**应付**都已生成」，右边「应付金额」却是 `—` | `statusHint` 对 `status==='received'` 无条件宣称 | 先看 `pay.ap_exists`，按它分叉 |
| ② | 无应付行的单，付款提示写「**已经结清**」 | 只按 `unpaid_amount === 0` 判断 | 真相是「**没有**应付单」，不是「结清了」 |
| ③ | 无应付行但未结 > 0 时，付款按钮**可点**、点了必被后端拒 | `canPay` 只判 `unpaid > 0` | `canPay = apExists && hasDue` |
| ④ | 未结金额 `¥0.00` 被染 `--danger` **告急红** | `.ipd-amt-due{color:var(--danger)}` 无条件挂 | 新增 `hasDue`，**真欠钱才红** |

🔴 **通用判据**：**凡是"状态 → 一句话"的映射，都要先问"这句话里的每个断言，同屏有没有别的
元素在说反话"**。`received` / 「已入库」**不等于**「应付已生成」/「已结算」——
状态只描述**这一半**，另一半（应付、入库单、批次）各有各的存在性，必须**各自查、各自说**。

### ⑩ 探针方法论：判别力靠**相位反转**，不靠"全绿"（v404 三组实证）

🔴 **一个判据只要没有"改前必须红"的证据，就有可能是恒真式。**
本轮把这条做成可复用的工具链：

`v404-oldserver.mjs` = 本地静态服务（服务**指定 dist 目录**）＋ **`/api/*` 反代生产**。
于是**同一套断言**可以跑在任意历史构建上：

| 目标 | 结果 |
|---|---|
| 生产 `dist-v404c`（最终） | **51 PASS / 0 FAIL** |
| 已上线 **v403 旧构建**（同一套断言） | **10 PASS / 36 FAIL** ⇒ 36 条新判据确有判别力 |
| 修复提示前的 `dist-v404` | **45 / 4**（恰红那 4 条） |
| 修复染色前的 `dist-v404b` | **50 / 1**（恰红那 1 条） |

🔴 **反转模式必须自动跳过截图** —— 否则反转跑会把正例的证据图**覆盖掉**
（本轮真踩过一次，得重跑才刷回来）。约定：探针读 `V404_BASE` 判定是否反转模式。

**⚠️ 本机坑（复发两次，已入 `local-machine-pitfalls.md`）**：
① 静态服务用 `cmd &` 起在 Bash 调用里 **活不过当次调用**（下次调用时端口已关，症状是
Chrome 落到 `chrome-error://chromewebdata/`、`localStorage` 报 "Access is denied"）⇒
必须用工具的**后台运行**能力常驻。
② 采样函数**返回对象时不要再 `JSON.stringify` 一次**（外层已统一序列化）⇒
套两层会让读到的字段变**字符串**，`d.x.y` 恒 `undefined`，**判据静默恒真/恒假**。

---

## v405 · `/forecast` 页内页签退役 —— 全站「页签条＋标签栏」并存态清零（2026-10-08 · 已提交 `50d0f47`，未部署）

**动因**：v396 立了「全局标签栏」后，`/forecast` 是**唯一**没退役的过渡态 —— 同屏既有页内
固定页签条（`.module-tabs`：本期预报 / 历史期次 / 报单配置 / 商品目标），又有累积标签栏。
两条回答的是不同问题（「这个模块有哪些页」vs「我打开过哪些页」），用户分不清谁是"全部"。

### ① 退役三步（`/forecast` 是最后一处 ⇒ 这套现在可当模板照抄）
1. **删页签条**：`Forecast.vue` 模板删 `.module-tabs` 整块 ＋ scoped 样式块**净删除**；
   原地留一行说明（防下轮误判"全站消失"）。
2. **补入口**（🔴 最容易漏、代价最大）：`Shell.vue::NAV` 的职能区补一条**无 `tab`** 的
   默认子页直达条目。`summary`（主表）此前**只靠页签条**进去；删掉后桌面上只剩
   「历史期次」行那个「＋」，而它受 `canDo('data','create')` 收口 ⇒ **只读角色进不去主表**。
3. **手机抽屉摊平**：`EXPLODED_PATHS` 补该 path。手机端标签栏按 Q6 A **不出** ⇒ 抽屉若不摊平，
   「历史期次 / 报单配置 / 商品目标」三条**永久失联**（只剩底部栏那个不区分 tab 的 `/forecast`）。
   `showInDrawer` 的"只放带 `tab`"规则天然把无 `tab` 的 `summary` 留给底部栏 —— 不重复。

### ② 🔴 `setTab()` 退役后**不是死代码**，语义变了
它不再是"页签按钮的 click 处理器"，而是**页内互跳写 URL 的唯一入口**。
判据链：顶部标签栏标题**只认 URL**（`useTabs.js::tabKey`）⇒ 任何子页切换都必须写 URL。
**实例（本轮唯一的功能性修复）**：`onViewHistory`（历史期次列表点「查看」⇒ 回本期主表）原为
`activeTab.value = 'summary'`，会把 `?tab=history` 留在地址里 ⇒
**标签栏写着「历史期次」、页面显示本期主表**（同屏自相矛盾）。页签条在时这处不一致被页内
高亮掩盖；退役后标签栏成了唯一指示 ⇒ 必须改成 `setTab('summary')`。
⇒ **通则：退役页签条时，必须搜一遍"只改 `activeTab` 不写 URL"的调用点。**

### ③ 判据（两条反假红纪律，本轮各踩一次）
- 断言"页内某类按钮已消失"时**必须排除顶部标签栏**：`.tabbar` 里 `<button class="tab-item">`
  的 textContent 就是子页名（「本期预报」），不排除必假红（首轮 1 条）。
- 点侧栏弹窗条目后**弹窗会自动收起**（模板上 `@click="areaClose"`）⇒ 连着点第二条**必然 miss**，
  每个"点条目"相位前都要先重开弹窗（首轮实测这一条造出 **4 条**假红）。

### ④ 验收读数
- `v405-forecast-tabs-probe.mjs`（本地 dev + 生产后端代理，只读）：**47 PASS / 0 FAIL**，
  零写入、零 console error。含插桩自证判别力 ＋ P8 专验上述修复点。
- `v405-nav-reach-probe.mjs`（加载真实 `pages.js` ＋ 从 `Shell.vue` 抠真实 `showInDrawer`，
  不重写判据）：**15 PASS / 0 FAIL**。4 条子页 `path` 全等 ⇒ 对
  admin/boss/supervisor/accountant **必然一致可见**（不存在"进得去却少一条"）；含 4 条反证。
  ⚠️ 为什么需要它：生产上这些角色**没有活跃 session** ⇒ token 供给器取不到，真机探针验不了
  "只读角色能否进主表"，而那正是本轮补入口的全部动机。
- 隔离构建 `dist-v405`：Forecast chunk `module-tabs` = **0**、Settings chunk = 1（反例对照）；
  CSS 只剩 Settings 那份；必然不存在串的假阳性对照 = 0。
- 可视取证 7 张（`outputs/v405-forecast-tabs-2026-10-08/`）：四子页均无重复标题、
  顶部留白与既有退役页（Rebate / Print / LossAccounting）一致。

### ⑤ 遗留与协作
- `Settings.vue` 页内仍有一条同名 `.module-tabs`（设置页自己的分区导航，**非模块导航**），
  不在本次范围；表单分区页签仍走全局 `.main-tabs`。
- 生产**未部署**。
- **号冲突实录**：起号时 `v404` 已被并行会话占用（`a1d9e7f feat(inventory): v404 采购单详情页
  三页签`），且其会话在 `MEMORY.md` 里已把 v405 预留给"本会话的 /forecast 页签退役" ⇒
  两边判断一致。**跳号优于同号两用**（参照 v393 教训）。

---

### ⑪ 🔴 页内 Tab 的**第三类**用途 + 硬判据（v404 补档，UI-SPEC §2.5/§2.5.1）

**规范冲突点**：§2.5（v396 收窄）当时写的是页内 Tab「**只用于**两类」——① 弹窗/表单内分区；② 排除项
（模块导航 → §3.5 全局标签栏）。而 v404 在采购单详情页新增的三页签（采购订单详情 / 货款 / 入库单）
**两类都不是** ⇒ 属规范**未覆盖的第三类**，本轮补档（v404 落地时漏了这半步）。

**🔴 硬判据（唯一一句话）**：**切换的对象是「一个单据实例」还是「一个页面」。**
- 若某个对象的**每个实例**都要这几面（每张采购单都要看货 / 看钱 / 看入库）⇒ **不可能**是模块导航：
  塞进 §3.5 会**为每张单开 3 个标签**（上限 18，很快互相淘汰），且标签名**无法区分是哪张单**。
- ⇒ 必须用页内 Tab。同理「列表页的**状态筛选页签**」是第三类之外的又一形态（参照 `InvPurchaseList.vue`，
  复用 `.main-tabs` ＋ 计数小胶囊）。

**§2.5.1 五条契约（`?tab=` 驱动）**：
| 项 | 约定 |
|---|---|
| 状态载体 | **URL query `?tab=`**，不是本地 `ref` —— 可分享链接 ＋ 浏览器后退可用 |
| 缺省 | 无 `tab` ⇒ `detail`；`pickTab('detail')` **清掉 query**（`query: {}`）⇒ 地址栏不留 `?tab=detail` |
| 非法值 | 不在 `TABS` 里 ⇒ **回落 `detail`**（不空白、不报错、不 404） |
| 写入 | `router.replace`（**不是 `push`**）—— 切一面不该往历史里塞一条 |
| 取数 | `watch(oid, loadAll)` ＋ `oid` 必 `computed`（vue-router 同 record 换 params **复用实例、不重跑 setup**） |

**样式**：一律复用全局 `.main-tabs` / `.main-tab` / `.tab-pane`（唯一源 `styles/variables.css` 393–397 / 623），
页面私有只起前缀（本页 `.ipd-*`）——**不许再定义一遍页签样式**（§2.5「全站唯一一份」）。

### ⑫ 🔴 方法论铁律：**自检脚本写死「代码里的字面量」= 定时炸弹**（v404 补档轮回查实证）

**现场**：`v400-spec-colcfg-consistency.py` 断言写死 `'table.tbl .seq-th{width:46px;min-width:46px' in vars_css`，
而 **v402 把选择器改成 `table.tbl th.seq-th, table.seq-host th.seq-th`**（为压过 scoped 补 `[data-v]` 后的
(0,2,1) 同分覆盖）⇒ 断言**自 v402 起恒 FAIL**。**v402 之后没人再跑这个脚本 ⇒ 6 天无人知。**
> 🔴 **一个恒 FAIL 的护栏比没有护栏更坏** —— 它会训练人「FAIL 是正常的」，于是真缺陷也被忽略。

**两条纪律**：
1. **判据锚「语义片段」不锚「整串字面量」**：写成 `选择器片段 + 属性片段` 的正则（如
   `table\.tbl(?:th\.seq-th|\.seq-th)[^{]*\{width:46px;min-width:46px`），并**剥注释 + 剥空白**后判
   ⇒ 兼容单臂/双臂两种形态。
2. **每条关键断言配「★反例自证」**：把期望值换成别的值（46px → 99px），**必须转 FAIL**
   —— 证明判据不是恒真。本仓已有此范式（v400 的 D5/D6f、v395、v402 的 E 族），照抄即可。

**附带纪律**：**改了规范正文，必须顺手跑一遍全部既有 spec 自检**（`for f in v395 v396 v400 v402 …`）。
本轮若只改文档不跑自检，这条 6 天前就烂掉的护栏**永远不会被发现**。

**剥注释的假绿风险复核（改判据前必做）**：① 目标串是否**只**出现在真规则里（`variables.css` 的 `width:46px`
只在 555/556 两条规则、注释内无同形串）；② `strip_comments` 的 `//` 剥离会**误伤** `url(https://…)` 之类
（该文件实测 **0 处 `https://`** ⇒ 安全）。

---

## v407 · 撤掉「预报订单管理」弹窗里与「本期预报」重复的「创建」按钮（2026-10-08 · ✅已上线 `96beba8`）

### 一句话

**侧栏弹窗里一行 = 两个可点区（左条目 / 右「＋创建」）**。`预报订单管理` 职能区的「历史期次」行
右侧那个「＋创建」，`to` 与上一行「本期预报」**同是 `/forecast`** ⇒ 老板判「功能重复」。
**改动 = 删掉这一条数据**（`Shell.vue::NAV` 的 `create` 字段），机制原封不动留给进销存区。

### 改动面（唯一的实质 diff 只有一行数据）

```js
// 删掉这一行（其余全是注释重写）：
{ path: '/forecast', tab: 'history', name: '历史期次', icon: 'history',
  create: { to: '/forecast', module: 'data', title: '新建本期预报（期次）' } },
```

| 面 | 受什么驱动 | 本次结果 |
|---|---|---|
| 桌面弹窗「＋ 创建」文字（`.sb-pop-new`） | `x.create` | 消失 |
| 手机抽屉「＋」图标（`.md-item-new`） | **同一份** `x.create` | 消失（**不是两处各改一遍**） |
| `resolveNavItem` 的 `canDo(create.module,'create')` 收口 | 机制 | **原样保留** |
| `.sb-pop-new` / `.md-item-new` 样式 + 模板 `v-if="x.create"` | 机制 | **原样保留** |
| 进销存区 7 条「＋」（采购单/采购退货单/自提·车销·调拨各单） | 各自 `create` | **不受影响** |

### 🔴 三条可复用判据

1. **「重复」的判据是落点相同，不是名字相同。** 那个「＋」的 `title` 写的是「新建本期预报（期次）」
   （听着像"动作"），而「本期预报」条目听着像"导航" —— 但**两者的 `to` 逐字相同（`/forecast`）**，
   点下去落在同一处。⇒ 判"要不要两个入口"看 **`to` / URL**，不看文案。
   （v405 时我曾把这条判成"不是重复"，理由就是文案不同；本轮被老板一句话推翻，注释已作废重写。）
2. **撤了它，"唯一入口"的判据会变硬。** v405 补「本期预报」条目时的理由是"只读角色进不去主表"，
   但当时还有一个受 `canDo('data','create')` 收口的「＋」兜底。**现在没了** ⇒
   「本期预报」条 = **主表在桌面弹窗里的唯一入口**，误删它 = 只读角色彻底进不去。
3. **零个元素必须配两条自证**（本项目铁律）：
   - **插桩自证**：手插一个同类元素 ⇒ 计数必须变（证明选择器有判别力）；
   - **★反例对照**：**同一个侧栏、同一份模板**下的进销存区「＋」必须**仍在** ⇒
     证明"零"来自**数据**，而不是选择器/模板/样式被一并删掉。
   本轮探针 `v407-nav-forecast-create-probe.mjs` 两条都做了（生产 20/20）。

### 探针踩坑（真机）

- **切 `mobile:true` 会触发一次异步页面重载**，把 Pinia 的 `store.ui.mobileDrawer` 打回 `false` ⇒
  「resize 完立刻点开抽屉」必然读到空抽屉（首轮两条**假红**）。正解：**重载之后再点**
  （探针里把这一步显式化成 `hardGo('#/workbench')` + sleep）。
- **空数组会让 `every()` 恒真** ⇒ 手机那条判据必须写成 `fcRows.length === 3 && every(!hasNew)`，
  否则"一条都没找到"也会 PASS（假绿）。

### 零夹带与部署

- `dist-pair-check`：**77/77 去 hash 基名一致、无 chunk 增删**；唯一字节差 = `Shell.js` **Δ−77B**。
- `dist-token-norm --expect Shell.js`：**✅ 完全吻合、exit 0**。差异原文可见：
  基准 `…icon:"history",create:{to:"/#",module:"data",title:"新建本期预报（期次）"}},{path:"/…`
  → 对比 `…icon:"history"},{path:"/#",tab:"config",name:"报单配置",…`。
- 部署：回滚点 `index.html.bak-v407-20261008-205711`；`rsync` **不带 `--delete`**
  （生产 assets **4233→4274 只增不减**）；`chown -R hergent:hergent`；双层 md5 **4/4 一致**；
  公网入口 `index-C0cZALNd.js`。
- ⚠️ **本次 grep 一个小坑**：`grep -o '.\{0,260\}'` 报 `maximum repetition exceeds 255`
  —— BSD grep 的 `{}` 上限是 255，写 `\{0,300\}` 会**直接报错**（不是静默），换 `[^]]*` 即可。


