# AI 经营副驾 · 输入框 Composer 化重构方案

- 日期：2026-09-11
- 对象：`hergent-cn-v2/src/components/CopilotDrawer.vue` 底部输入区（`.cp-foot`）
- 参照：WorkBuddy 桌面客户端 Web UI 的 Composer 组件
- 参照数据来源：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/web-ui/assets/index-DESzSkbX.css`（**实测原始 CSS 规则**，非印象描述）
- 状态：**方案 A 已全量落地并上线生产**（2026-09-11 14:22，`Shell-D4O9Zenq.js` + `Shell-BcFmpbZM.css`）。落地结果见文末「六、落地结果」。

---

## 一、参照基准：WorkBuddy Composer 实测规格

WorkBuddy 的输入框组件命名体系为 `composer-*`，其结构是**明确的上下两层**：

```
.composer-stack            ← 外层：居中、限制 max-width 780px
└── .composer-card         ← 卡片本体：flex column, gap 8px, radius 20px
    ├── .composer-textarea ← 第一层：文本区，width 100%
    └── .composer-toolbar  ← 第二层：工具条，space-between
        ├── .composer-tools     （左组，flex:1 1 auto, gap 2px）
        └── .composer-trailing  （右组，flex:none, gap 2px）
```

| 元素 | 实测 CSS 关键值 |
|---|---|
| `.composer-stack` | `max-width:780px`、`padding:0 16px 8px`、`align-items:center` |
| `.composer-card` | `flex-column`、`gap:8px`、`padding-top:10px`、`border:1px`、**`border-radius:20px`** |
| `.composer-textarea` | `width:100%`、`padding:4px 12px 0 16px`、`font-size:15px`、`line-height:22px` |
| `.composer-textarea-hero` | `min-height:52px`（空态） |
| `.composer-toolbar` | `flex`、`align-items:center`、**`justify-content:space-between`**、`gap:6px`、`padding:0 8px 8px` |
| `.composer-tools` | `flex:1 1 auto`、`gap:2px` |
| `.composer-trailing` | `flex:none`、`gap:2px` |
| `.composer-add`（＋） | **28×28**、`border-radius:999px`（正圆）、透明底 |
| `.composer-chip` | 高 **28**、`padding:0 8px`、`border-radius:8px`、`font-size:13px/20px`、`font-weight:500`、`gap:4px`、`max-width:220px` |
| `.composer-seat-chip`（角色） | `min-height:28`、`border-radius:16px`（胶囊）、`font-size:13px/20px`、`max-width:240px` |
| `.composer-send` | **28×28**、`border-radius:999px`（正圆）、底色 = 品牌色、图标白色 |
| `.composer-send:hover` | 底色加深（`#000000`） |
| `.composer-send:disabled` | **透明底 + `box-shadow:inset 0 0 0 1px` 描边环**、图标转次级色、`opacity:1`（不靠变淡表达禁用） |
| `.composer-usage` | 28×28、`border-radius:8px` |

三条可直接借鉴的设计原则：

1. **文本与控件不争宽度**——文本区独占卡片整行，控件全部下沉到工具条。
2. **工具条两端锚定**——左侧放"输入手段"（＋、角色/模式），右侧放"动作"（发送）。中间留空，`flex:1` 撑开。
3. **控件尺寸统一**——28px 是唯一基准，正圆用于纯图标按钮，胶囊用于带文字的 chip。

---

## 二、现状诊断

Hergent 当前是**单行横向**布局：

```
.cp-foot (padding 12px 16px, border-top)
├── .cp-atts              附件 chips（已有）
├── .cp-input-wrap        单行：radius 18, padding 8px 10px, align-items:center
│   ├── .cp-role          34px 胶囊（radius 10）
│   ├── .cp-plus          34×34（radius 10）
│   ├── textarea.cp-input flex:1, min-height 50, padding 14px 4px
│   ├── .cp-voice         34×34（radius 10）
│   └── .cp-send          36×36（radius 11）
├── .cp-uploading         「上传解析中…」11px 居中
├── .cp-foot-guard        「只建议·不替你下单」居中
└── .cp-foot-hint         「Enter 发送…」11px 居中
```

| # | 问题 | 依据 |
|---|---|---|
| 1 | **文本区被两侧控件挤压** | 左侧胶囊（最长 150px）+ ＋34 + 右侧麦克风 34 + 发送 38 + 4 个 gap，最多吃掉约 170px；抽屉宽 880px 时输入区实际可用于文字的宽度明显偏窄 |
| 2 | **控件尺寸不统一** | 34 / 34 / 34 / 36 四种组合，发送键比其余大 2px，视觉上不在同一基准 |
| 3 | **发送键形状与语义不匹配** | 圆角方块（radius 11）承担主操作；WorkBuddy 用正圆，且禁用态是描边空心环而非"整块变淡" |
| 4 | **框外堆了三行小字** | 上传态 / 权限开关 / 快捷键提示各自居中占一行，输入区下方视觉噪音大，且三行文字都在框外、与输入行为无空间关联 |
| 5 | **权限开关缺少归属** | 「只建议·不替你下单」是**输入前的策略选择**（决定 AI 是否可写），却游离在输入框之外，用户容易忽略 |

---

## 三、优化方案

### 3.1 整体结构（核心改动）

将 `.cp-input-wrap` 从"单行 flex"改为"卡片 + 上下两层"：

```
.cp-composer              ← 卡片：flex column, gap 8px, padding-top 10px
│                           border 1px, radius 20px, background var(--bg)
├── textarea.cp-input     ← 第一层：width 100%, padding 4px 12px 0 16px
└── .cp-toolbar           ← 第二层：flex, align-items:center, space-between
    ├── .cp-tools         （左组：＋、角色胶囊、权限 chip）
    └── .cp-trailing      （右组：麦克风、发送）
```

- 文本区 `width:100%`，不再被控件占位 → **文字可用宽度 +约 170px**
- 卡片高度自适应：单行态由 `.cp-input` 的 `min-height` 决定，多行态随 textarea 增高，工具条始终贴在文本下方

### 3.2 控件位置

| 控件 | 现状 | 目标 | 理由 |
|---|---|---|---|
| 角色胶囊 | 输入框最左内 | 工具条**左组**，`＋` 之后 | 与 WorkBuddy 的 `[＋][chip]` 顺序一致；两者都是"会话级配置" |
| ＋ 上传 | 胶囊右侧 | 工具条**左组首位** | 输入手段的入口，放最左 |
| 权限开关 | 框外居中 | 工具条**左组末位**，做成 chip | 它是"输入前的策略"，属于工具条语义（见 3.5） |
| 麦克风 | 文本右侧 | 工具条**右组**，发送键左侧 | 同为"提交/输入动作"，与发送键成组 |
| 发送键 | 文本右侧 | 工具条**右组末位** | 主操作的稳定锚点（右下角） |

> 保守备选：若不想动权限开关，可保留其在框外居中，只做 3.1 / 3.3 / 3.4。

### 3.3 尺寸与间距

| 项 | 现状 | 目标 | 说明 |
|---|---|---|---|
| 卡片圆角 | 18px | **20px** | 对齐 WorkBuddy（窄屏 18px） |
| 卡片内边距 | `8px 10px` | `padding-top:10px` + 工具条 `0 8px 8px` | 文本区上下留白由自身 padding 控制 |
| 文本区字号 | 14px / 1.6 | **15px / 22px** | 对齐 WorkBuddy，长句更易读 |
| 文本区左右内边距 | 4px | `12px`（右）/ `16px`（左） | 与卡片边框形成呼吸感 |
| 图标按钮 | 34×34 | **28×28** | 统一基准；六项控件同尺寸 |
| 角色胶囊 | 高 34 / radius 10 | 高 **28** / radius **16** | WorkBuddy `seat-chip` 规格；胶囊形态更轻 |
| 控件间距 | gap 6px | 组内 **2px**，组间由 `space-between` 撑开 | 同类控件成组、组间留白 |
| 发送键 | 36×36 / radius 11 | **28×28 / 正圆** | 与所有图标按钮同基准 |
| 图标尺寸 | 16–18px | **13–14px** | 匹配 28px 按钮的视觉配重 |

### 3.4 对齐方式

- 工具条 `align-items:center`，28px 定高控件天然同一水平中线，不再需要逐个补偿
- 文本区 `line-height:22px` + 上下 padding 对称，文本行框中心 = 控件中心（**沿用今天上午已修复的居中基准，不回归**）
- 卡片圆角 20px 与内部控件间距同时放大，避免"大圆角 + 挤控件"的割裂感

### 3.5 交互反馈

| 场景 | 现状 | 目标 |
|---|---|---|
| 发送键可用 | 品牌色实心方块 | 品牌色实心**正圆** + 白色箭头 |
| 发送键 hover | `translateY(-1px)` + 变色（**布局位移**） | 仅底色加深，**不做位移**（避免与相邻麦克风产生视觉抖动） |
| 发送键禁用 | `opacity:.35`（整块变淡，像"半透明按钮"） | **透明底 + 1px 描边圆环 + 次级色图标**，明确表达"现在不可发送" |
| ＋ / 麦克风 hover | 灰底 | 浅灰底（`--bg-hover`）+ 图标由次级色转主色 |
| 角色胶囊 hover | 青色底加深 | 浅灰底浮出（与 `composer-chip` 一致），展开时保持高亮 |
| 权限开关 | 独立按钮 | chip 形态：默认「只建议」（盾牌图标 + 次级色）；切到「允许执行」时转琥珀色底，形成明确的风险提示 |
| 附件上传中 | 框外新增一行「上传解析中…」 | 收进 `.cp-atts`，以 chip 的 loading 态呈现，不再挤占一行 |
| 卡片聚焦 | `focus-within` 品牌色边框 + 光晕 | **保留**（已是良好反馈，与 WorkBuddy 一致） |

---

## 四、预期效果

1. **文字空间**：文本可用宽度由约 510px 提升到约 690px（抽屉 880px 下），长问句不再提前折行。
2. **视觉重量**：控件由 34/36px 统一到 28px，输入区整体变轻，与 20px 大圆角更协调。
3. **结构清晰**：一切"配置项"在工具条左侧、"提交动作"在右侧，形成稳定心智模型，且与用户日常使用的 WorkBuddy 手势一致。
4. **框外噪音**：从三行（上传态 / 权限开关 / 提示）减少到**至多一行**，输入区下方回归干净。
5. **状态语义**：发送键禁用态从"半透明"改为"描边空心环"，用户能一眼分辨"不可发送"与"可发送但低调"。

---

## 五、落地建议与风险

**建议分两步**：

- **第 1 步（低风险，建议先做）**：3.1 结构分层 + 3.3 尺寸统一 + 3.4 对齐。纯布局与尺寸调整，不改任何交互逻辑，可独立上线验证。
- **第 2 步（中风险，需真机回归）**：3.2 权限开关迁移 + 3.5 交互反馈。涉及按钮归属变化与禁用态表达，需要回归：空输入禁用、流式中禁用、语音激活态、上传中 chip、角色菜单展开定位（菜单 `bottom: calc(100% + 8px)` 会因胶囊位移而变化）。

**风险提示**：

| 风险 | 说明 | 缓解 |
|---|---|---|
| 角色下拉菜单定位 | 胶囊从文本行移到工具条，菜单锚点位置随之变化 | 沿用 `position:absolute` 相对胶囊定位，实机验证菜单不越出抽屉 |
| 窄屏（≤760px） | 抽屉变 100vw，工具条可能拥挤 | 工具条已 `flex-wrap:wrap`（WorkBuddy 同款），必要时权限 chip 在窄屏收起为纯图标 |
| 无障碍 | 纯图标按钮缺文字标签 | 保留现有 `title`，并补 `aria-label` |
| 快捷键提示 | 若折叠进 placeholder 会丢失发现性 | 建议保留框外一行 `.cp-foot-hint`，与 WorkBuddy 底部提示同位 |

**参考实现（第 1 步的 CSS 骨架，未落地）**：

```css
.cp-composer{display:flex;flex-direction:column;gap:8px;padding-top:10px;border:1px solid var(--bd);border-radius:20px;background:var(--bg);transition:border-color .2s,box-shadow .2s}
.cp-composer:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 4px var(--p-bg)}
.cp-input{width:100%;box-sizing:border-box;padding:4px 12px 0 16px;border:none;outline:none;background:transparent;resize:none;font-size:15px;line-height:22px;min-height:52px;max-height:168px;color:var(--t1);font-family:inherit;overflow-y:auto}
.cp-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;padding:0 8px 8px}
.cp-tools{display:flex;align-items:center;flex:1 1 auto;gap:2px;min-width:0}
.cp-trailing{display:flex;align-items:center;flex:none;gap:2px}
.cp-plus,.cp-voice,.cp-send{width:28px;height:28px;border-radius:999px}
.cp-role{height:28px;border-radius:16px;gap:4px;padding:0 8px;max-width:220px}
```

---

## 六、落地结果（2026-09-11，方案 A）

**实际改动与方案的差异（3 处，均为实测后修正）：**

| 项 | 方案原值 | 落地值 | 原因 |
|---|---|---|---|
| 卡片背景 | `var(--bg)` | **`var(--bg3)`** | `--bg` 与抽屉底色相同会失去「输入面」affordance；沿用原输入底更清晰 |
| 文本区高度/内边距 | `min-height:52px` + `padding:4px 12px 0 16px` | **`min-height:40px` + `padding:9px 12px 9px 16px`** | ① 空态更紧凑（卡片 94px vs WorkBuddy 106px）；② **上下 padding 必须对称**——只给上 padding 时多行文本块会偏低 4.5px |
| `INPUT_MIN_H` | 未涉及 | **50 → 40** | 配合上一条（autoGrow 的 clamp 下限） |

**额外修掉的既有 bug**：`autoGrow()` 只挂在 `@input`，`onWinResize()` 从不重算 → 宽屏输入长句后缩窄，多余的行使被裁掉。已在 `onWinResize()` 的 early-return 前补 `autoGrow()`。

**实测数值（生产真机，agent-browser + 系统 Chrome）：**

| 指标 | 改前 | 改后 |
|---|---|---|
| 文本可用宽度（1280） | ~510px | **845px（+335）** |
| 44 字长句 | 折 2 行 | **1 行** |
| 文本可用宽度（390） | ~180px | **356px** |
| 控件尺寸 | 34/34/34/36 | **28/28/28/28** |
| 卡片高度 | 66px | 94px（3 行 138 / 12 行 222） |
| 框外文字行数 | 3 | **1** |

**控制器对齐（5 项中心同值，`new Set(...).size === 1`）**

| 场景 | 控件中心 | 文本块中心 == 文本框中心 |
|---|---|---|
| 1280 单行 | 743.4 ×5 | ✅ |
| 1280 3 行 | 740.4 ×5 | ✅（676.4 / 676.4） |
| 1280 12 行（168px 滚动） | 740.4 ×5 | ✅ 不裁字 |
| 390 单行 | 784.4 ×5 | ✅ 无溢出 |

**交互态**：发送键禁用 = 透明底 + `inset 0 0 0 1px rgb(229,229,234)` 描边环（启用 = `rgb(8,145,178)` 实心）；权限 chip 「只建议」→「允许执行」琥珀态 `rgba(255,159,10,.14)`；角色菜单 4 项、不越界、点抽屉外空白关闭（未回归）；1280→390 resize 后 textarea 40→62px 无裁切。
