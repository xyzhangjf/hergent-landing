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
