# Hergent ERP · UI 设计审查报告（对比 WorkBuddy / Apple HIG）

- **日期**：2026-08-01
- **审查视角**：UiDesigner，对照 WorkBuddy 浅色/深色实际观感与 Apple 人机界面指南
- **审查对象（实读代码，非凭记忆）**：
  - `static/css/variables.css`（令牌源）
  - `static/styles.css`（6138 行，消费令牌）
  - `static/index.html`、内联 JS 样式
  - `static/js/modules/trade-mega.js`（采销面板）
- **范围**：仅分析 + 改进建议，未改动任何代码（用户要求"列出不一致 + 建议"）。
- **前提说明**：用户此前明确"深色模式不再改，只改浅色"。本报告中所有**深色模式修改建议均标记为"待解除冻结"**，默认不执行。

---

## 一、结论摘要（TL;DR）

| 维度 | 总评 | 最严重问题 |
|---|---|---|
| 1 颜色/对比度 | ⚠️ 浅色有硬伤 | 侧边栏激活项白字不可读、主按钮对比度不达标、浅色 hover 全失效 |
| 2 组件统一 | ⚠️ 中等 | 卡片表面令牌分裂（stat-card 与其余卡片不同）、两套激活态 |
| 3 间距/圆角/阴影 | ✅ 基本良好 | 仅圆角尺度跳跃（弹窗 22px 偏大） |
| 4 明暗切换 | ⚠️ 中等 | 过渡只覆盖部分元素，切主题瞬间"半亮半暗" |
| 5 布局/层级 | ✅ 正确 | 画布灰+卡片白本就符合 WorkBuddy，仅少数表面未遵循 |

**根因（一句话）**：浅色模式下"浮起表面"（stat-card / modal / hover-menu / 采销面板）错误地用了画布色 `--bg`(#f5f5f7)，而其他卡片用 `--bg2`(#fff) 正确。统一缺口 + 91 处 hover 用 `--white-rgb`（浅色下不可见）是前三类问题的共同来源。

---

## 二、审查方法

1. 实读主题令牌（`variables.css` 的 `:root` 与 `:root.dark`）与组件样式（`styles.css`）。
2. 用 `grep` 量化硬编码颜色与 `var(--white-rgb)` 出现位置（共 91 处）。
3. 逐组件比对 WorkBuddy 的"画布灰 / 卡片白 / 强调实底 / 悬停微变暗"模式。
4. 还原两种主题的"表面层级栈"，定位层级倒置与平铺。

---

## 三、维度逐项发现

### 维度 1 · 颜色搭配与对比度

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| F3 | `.sb-item.active` / `.sb-role-item.active`（styles.css:133,136,142） | 激活项 = `background:var(--pb)`（浅青 10% 透明）+ `color:var(--white)`（白字）。**浅色下白字浮在淡青上几乎不可见；深色下淡青也偏亮**，双模式对比度均不达标。 | 🔴 高 |
| F4 | `.btn-primary`（styles.css:286） | `background:rgba(var(--p-rgb),.10)` + `color:var(--pl)`(#22d3ee 浅青)。浅青字落在 10% 青底/白底上，对比度远低于 WCAG AA，主操作像标签不像按钮。 | 🔴 高 |
| F9 | 91 处 `var(--white-rgb)` 作 hover/active 背景/边框 | 在**浅色模式**下白色叠加层不可见：`.btn-outline:hover`(:27)、`#contactFilterBar .filter-chip:hover`(:34)、`.sb-toggle:hover` 边框(:154)、`tbody tr:hover`(:277)、`.bg-draft` 徽章(:293)、`.tab-close:hover`(:648)、滚动条(:57-58) 等。浅色下这些交互"看起来没反应"。 | 🔴 高 |
| F5 | `:root.dark #topBar/#sidebar`（styles.css:91,122） | 深色 sidebar `#2c2c2e` **比**卡片 `#1c1c1e` **更亮** → 导航栏浮在内容之上，层级倒置（WorkBuddy 深色侧栏通常与内容同级或更暗）。 | 🟡 中（冻结，仅观察） |
| F6 | `index.html:10,25` `<meta name=theme-color>` | 静态值与 JS 都写成 `var(--black)` / `var(--white)`——`theme-color` 不接受 CSS 变量，移动端状态栏配色失效。 | 🟢 低 |

### 维度 2 · 组件样式统一

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| F7 | `.stat-card`(215) vs `.product-card/.chart-card/.acct-card/.tbl-wrap`(230/237/244/253) | 表面令牌分裂：前者 `background:var(--bg)`，后者 `background:var(--bg2)`。同页两种卡片"材质"不一致。 | 🟡 中 |
| F8 | `.sb-item.active`(133) vs `.sb-main-item.active`(160) | 两套侧边栏激活态：旧版白字、新版青字。混用导致视觉语言不统一。 | 🟡 中 |
| F10 | `.btn-primary` 整体 | 主按钮是"10% 青 + 浅青字"的 ghost 样式，层级权重弱，与 WorkBuddy 实底强调按钮的观感差距大。 | 🟡 中 |

### 维度 3 · 间距 / 圆角 / 阴影

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| F11 | 圆角尺度 | 弹窗 22px / 卡片 16px / 按钮 12px / 筛选 chip 6px。弹窗 22px 相对卡片 16px 偏大，节奏不连贯。建议收为 18/14/10/8。 | 🟢 低 |
| F12 | `.stat-card` 阴影（styles.css:215 + :root.dark :51） | 浅色下 stat-card 与画布同色，`--shadow-sm` 极淡 → 卡片"贴"在页面上无立体感（后果来自 F1/F7）。 | 🟡 中 |

### 维度 4 · 明暗切换平滑度

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| F13 | 过渡声明 | `transition` 仅覆盖 `html/body/#topBar/#sidebar`；`#contentArea`、`.stat-card`、`.product-card`、`.modal` 等缺背景/边框过渡 → 切主题时画布与卡片"先后亮起"，有闪烁感。 | 🟡 中 |

### 维度 5 · 布局与视觉层次

| ID | 位置 | 问题 | 严重度 |
|---|---|---|---|
| F15 | 画布 vs 卡片方向 | **澄清（非 bug）**：当前"画布灰(#f5f5f7) + 卡片白(#fff)"正是 WorkBuddy/Apple 的标准做法。用户口头说的"画布白/卡片灰"是反向表述，代码本身正确——只需把"白色卡片"规则延伸到 stat-card/modal/hover（即 F1/F2/F7）。 | ✅ 信息 |
| F16 | `#topBar` backdrop-filter（styles.css:90） | 固定 flex 布局下内容不滚动到顶栏之下，毛玻璃无意义且徒增合成开销。可移除。 | 🟢 低 |
| F17 | 经营面板（today.js） | 此前已降噪（KPI 32→24px、快统 4→2 项）。建议复核一次是否还有杂色/字重不一致残留。 | 🟢 低 |

> 图中可见：浅色侧 stat-card / modal / hover 三块红框 = 与画布同色（F1/F2/F7）；深色侧 sidebar 红框 = 比卡片亮（F5）。

---

## 四、改进建议（按优先级，含代码级落地）

### P0 — 可读性硬伤（浅色，立即做，不碰深色）

1. **新增主题感知令牌**（`variables.css`）：
   ```css
   :root{
     --surface: var(--white);            /* 浮起表面：卡片/弹窗/菜单 */
     --hover: rgba(0,0,0,.04);           /* 浅色悬停：变暗 */
     --hover-strong: rgba(0,0,0,.07);
     --hover-border: rgba(0,0,0,.10);
   }
   :root.dark{
     --surface: #1c1c1e;
     --hover: rgba(255,255,255,.06);
     --hover-strong: rgba(255,255,255,.10);
     --hover-border: rgba(255,255,255,.14);
   }
   ```
2. **统一浮起表面**（修 F1/F2/F7）：
   - `.stat-card{background:var(--surface)}`（删掉浅色用 `--bg` 的写法；`:root.dark .stat-card{background:var(--bg2)}` 可删，由 `--surface` 统一）
   - `.modal{background:var(--surface)}`（styles.css:300）
   - `.hover-menu,.hover-card{background:var(--surface)}`（638/517）
   - `trade-mega.js:94` 内联 `background:var(--bg)` → `background:var(--surface)`
3. **修浅色 hover 失效**（F9）：把所有**非** `:root.dark` 作用域内的 `rgba(var(--white-rgb),x)` 悬停/激活背景与边框，替换为 `var(--hover)` / `var(--hover-border)`（重点：`.btn-outline:hover`、`.filter-chip:hover`、`.sb-toggle:hover` 边框、`tbody tr:hover`、`.bg-draft`、`.tab-close:hover`、滚动条 thumb）。
4. **侧边栏激活态**（F3/F8，统一为实底强调，最贴近 WorkBuddy）：
   ```css
   .sb-item.active,.sb-role-item.active,.sb-main-item.active{
     background:var(--p); color:#fff; font-weight:600;
   }
   .sb-item.active svg{color:#fff}
   ```
5. **主按钮对比度**（F4）：保守方案——保留淡青底色但文字主题化：
   ```css
   .btn-primary{background:rgba(var(--p-rgb),.12);border:1px solid rgba(var(--p-rgb),.35);color:var(--pd)}
   :root.dark .btn-primary{color:var(--pl)}
   ```
   若想更接近 WorkBuddy，可改为实底：`background:var(--p);color:#fff`（白字落 #06b6d4 对比度约 2.4:1，对粗体按钮文字可接受）。

### P1 — 层级一致性（浅色，可选碰深色需先解冻）

6. **深色 chrome 倒置**（F5，待解冻）：将 `:root.dark #topBar/#sidebar` 由 `#2c2c2e` 改为 `#000`（与画布融合）或 `#1c1c1e`（与卡片同级），让内容浮于导航之上。
7. **圆角收敛**（F11）：卡片 14 / 弹窗 18 / 按钮 10 / chip 8，建立清晰节奏。
8. **主题切换过渡补全**（F13）：
   ```css
   #contentArea,.page-inner,.stat-card,.product-card,.chart-card,.modal,.hover-menu{
     transition:background-color .3s var(--ease-smooth),border-color .3s var(--ease-smooth),color .3s var(--ease-smooth);
   }
   ```

### P2 — 打磨

9. **meta theme-color**（F6）：改字面量 `t==='dark'?'#000000':'#f5f5f7'`，并删 `index.html:10` 的 `var(--black)`。
10. **移除 `#topBar` 多余 backdrop-filter**（F16）。
11. 复核经营面板（F17）字重/色阶。

---

## 五、建议的令牌终态（两主题对照）

| 令牌 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--bg` | #f5f5f7 | #000000 | 画布（内容区/侧栏底色） |
| `--surface` | #ffffff | #1c1c1e | 所有浮起表面（卡片/弹窗/菜单） |
| `--hover` | rgba(0,0,0,.04) | rgba(255,255,255,.06) | 交互悬停叠层 |
| `--hover-border` | rgba(0,0,0,.10) | rgba(255,255,255,.14) | 悬停边框 |
| `--p` / `--pd` | #06b6d4 / #0891b2 | #22d3ee / #06b6d4 | 品牌强调（实底/文字） |

---

## 六、不在本次范围

- 深色模式任何视觉修改（用户此前冻结，仅 F5 作观察记录）。
- 功能/交互逻辑（仅 UI 表层）。
- 实际像素截图比对（按代码令牌推导，未启动浏览器实采）。

---

## 七、实施记录（P0 + P1 + P2 已上线）

> 报告原本"仅分析"。用户已依次执行 P0（"按 P0 改"）与 P1（"继续 P1"），均部署至生产 `https://erp.hergent.cn/`。

### P0（可读性硬伤 · 浅色主导，深色仅加令牌不改观感）✅
- 新增主题感知令牌 `--surface`/`--hover`/`--hover-strong`/`--hover-border`（:root 变暗、:root.dark 变亮）。
- 统一浮起表面：`stat-card`/`.modal`/`.hover-card`/`.hover-menu`/采销面板 `var(--bg)`→`var(--surface)`。
- 侧边栏激活态改实底青+白字；`.btn-primary` 改实底青+白字（对比度达标）。
- 修复 91 处浅色下失效的 `--white-rgb` hover 白叠层→`--hover` 系令牌（深色内白叠层未动）。

### P1（层级一致性 · 形状/过渡层，未碰深色配色）✅
- **圆角收敛**：`--radius-md` 12→10、`--radius-lg` 16→14；`.modal` 22→18、`.confirm-box` 16→18；全量 `border-radius:6px`→`8px`。最终节奏：**卡片 14 / 弹窗 18 / 按钮 10 / chip 8**。
- **主题切换过渡（F13）**：新增 `html.theme-anim *` 全局背景/边框/文字过渡（.3s，含 `prefers-reduced-motion` 兜底）；`app.js applyTheme()` 切换瞬间挂 `theme-anim` 类、360ms 后卸下。修复 `#contentArea`/`.chart-card`/`.modal` 等切主题"半亮半暗"缺口。
- **未做（仍冻结）**：F5 深色 chrome 层级倒置（用户冻结深色；P2 中移除顶栏毛玻璃不改变深色任何像素，故深色底色 `#2c2c2e` 未动）。

### 验证
- 生产 CSS `main-DHfvKvo8.css` 已确认含 `--radius-md:10px`、`--radius-lg:14px`、`html.theme-anim *{transition...}`、`.modal{...border-radius:18px`；JS `main-0qUGeE8S.js` 含 `theme-anim` 挂类逻辑；公网 HTTP 200。

### P2（打磨 · 边界内收尾）✅
- **F6 `meta theme-color` 字面量**：`index.html:10` `content="var(--black)"`→`"#f5f5f7"`；`:25` JS `t==='dark'?'var(--black)':'var(--white)'`→`'#000000':'#f5f5f7'`。移动端浏览器不解析 meta 内的 CSS 变量，此前等于失效；现浅色状态栏融合画布 #f5f5f7、深色纯黑 #000000。
- **F16 移除 `#topBar` 多余毛玻璃**：`styles.css:90` 删 `backdrop-filter:blur(24px) saturate(180%)` 两属性。顶栏 `background:var(--bg)`（浅色 #f5f5f7 / 深色 #2c2c2e）均为不透明实色，毛玻璃模糊被自身背景盖死→零可见效果，移除不改变任何像素（含深色）。
- **F17 清理 `stat-card` 重复定义**：删 `styles.css` 第 15-16 行被第 225-227 行覆盖的 `.stat-card-label/.stat-card-val` 死代码（两套令牌体系 `--fs-*`/`--text-*` 混用，易致"改一处不生效"陷阱），仅留 24px/600/t1 权威定义，渲染零变化。经营面板现层级：主值 t1/600/24px、标签 t2/500/11px、副值 t3/11px，彩色仅用于语义化 section 标题（红=关注、橙=要务、青=机会），信息层次清晰。
- **验证**：生产 CSS `main-Bt4xKfW4.css` + 重建 `index.html`；`backdrop-filter:blur(24px) saturate(180%)` 在生产 CSS 中 **0 次**；`.stat-card-val` 仅 1 条基础定义；公网 HTTP 200、index 含 `theme-color content="#f5f5f7"`、built JS 含字面量三元。
- **P0 + P1 + P2 全部闭环上线**；`F5` 深色 chrome 层级倒置始终按用户冻结边界未动。

---

## 整体重构（用户反馈"UI 非常丑" → 整体重构 → 更商务专业）✅

### 触发 & 定位
- 用户感觉"UI 非常丑"。先用对比 widget 诊断：①侧栏激活项 + `.btn-primary` 实底亮青 `#06b6d4` + 白字 → 视觉刺眼荧光感；②浅色画布 `#f5f5f7` 与卡片 `#fff` 阴影 alpha 仅 ~6% → 卡片浮不起来、画面灰糊；③圆角过紧（按钮 10/卡片 14）；④JS 图表/活动状态/图标渐变还残留 cyan。
- 用 AskUserQuestion 确认：**整体重构** + **更商务专业（藏青/海军蓝）**，mock 用 navy `#1f4e79` family。

### R1 令牌重映射（`variables.css`）
- 品牌主色 cyan → navy：`--p:#1f4e79` / `--pl:#2563eb` / `--pd:#16375a` / `--p-rgb:31,78,121`。
- 浅色画布 `#f5f5f7`→`#ececf0`（拉一档层级差）。
- 浅色阴影全量 alpha ~×2：`--shadow-sm/md/lg/xl` 从 6/10/14/18% 升到 6-10-14-18% 双层叠加（卡片真正浮起）。
- 圆角回到 Apple 节奏：`--radius-md:12 / --radius-lg:16`（撤回 P1 收敛；按钮 12 / 卡片 16）。
- 浅/深 `brand-50..700` 全部重做（浅=blue 50 蓝白 + 500 藏青；深=blue 50 深底 + 500 亮蓝）。
- `--pb` / `--shadow-glow` cyan rgba → navy rgba `37,99,235`。

### R2 浅色组件对齐（`styles.css`）
- `body{background:#fff}`→`var(--bg)`（浅色画布终于显灰）。
- `.sb-item.active` / `.sb-role-item.active` / `.sb-main-item.active` 全部：
  - 浅色 → `background:var(--brand-50);color:var(--pd);font-weight:600` + `::before` 3px 藏青指示条；
  - 深色 → 保留 `background:var(--p);color:#fff`（对比合规）。
- 移除 `#sidebar` 无效 `backdrop-filter:blur(24px)`。
- `.modal` 圆角 18→20 + 移除无效 `backdrop-filter:blur(40px)`。
- `.modal-field select` 箭头 SVG `#06b6d4`→`#1f4e79`。
- 移除 `.sb-item.active` 的 tech-glow（白边 inset + 青色 text-shadow），与新淡蓝底冲突。

### R3 深色保留 Apple 原生
- 深色 `--bg:#000` / `--bg2:#1c1c1e` / sidebar `#2c2c2e` 不动（Apple-authentic 最商务）。
- 仅通过 R1 把深色 `--pb`/`--shadow-glow` 残青换 navy 保持暗色与主色一致。
- F5 深色层级倒置仍按原冻结边界不动。

### R4 细节收编
- `static/icon.svg` + `static/public/icon.svg` 渐变 `#06b6d4/#0e7490`→`#1f4e79/#16375a`。
- 两个 `manifest.json` `theme_color`→`#1f4e79`。
- `app.js` 11 处残青（tier badge / 批发标签 / aging buckets / D1-D7 周图 / drillable hover / card gradient / focus rings / inline edits）逐处 Edit→navy。
- 模块：`bi-dashboard-ui.js`（line 118 渐变 + 126/128 dataset）、`new-features.js`（colors 数组首项）、`visit-tracking.js`（stroke + fill）、`import-wizard.js`（进度条底）、`ai-assistant/today.js`（info bg）全部 navy 化。

### R5 构建 + 部署 + 双验
- `npm --prefix static run build`(node22)→`main-B1i8edpC.js`(1362KB) + `main-T3RZ7l5t.css`(209KB)。
- 备份 `/tmp/static-pre-redesign-20260801.tar.gz`(1.9MB) → rsync dist/ 到 47.113.224.140:/opt/hergent-erp/static/（exclude `avatars`/`._*` + `--delete`）→ `chown hergent:hergent`。
- 验证：公网 https://erp.hergent.cn/ **HTTP 200**；生产 CSS `06b6d4|6,182,212` 计数 = **0**；生产 JS 计数 = **0**；navy `#1f4e79/#2563eb/37,99,235` 命中 **46 处**。
- 激活态在生产 CSS：`{background:var(--brand-50);color:var(--pd);font-weight:600}`（浅）+ `{background:var(--p);color:#fff}`（深），双模式都对齐商务专业。
