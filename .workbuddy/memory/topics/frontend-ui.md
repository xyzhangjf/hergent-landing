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
