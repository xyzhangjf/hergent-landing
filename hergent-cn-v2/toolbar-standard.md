# Hergent 工具栏统一组件标准（Toolbar Component Standard）

> 适用范围：预报订货管理及其余所有「列表 / 表体工具栏」。
> 目标：消除当前工具栏的布局错乱、图标风格不一、背景色杂乱、字号字重无层级等问题；与 `variables.css` 设计令牌、AI 副驾 `.cp-icon-btn` 及苹果风视觉**完全一致**；形成可复用组件标准。

---

## 0. 现状问题清单（为什么要统一）

经核查 `src/pages/Forecast.vue` 与 `src/styles/variables.css`，当前工具栏存在以下不一致：

| 维度 | 问题点 | 位置 |
|---|---|---|
| 布局间距 | 间距 8/10/12 混用；`.toolbar` gap:10、`.tb-toolbar` gap:10 margin:4/8、`.edit-ops` gap:12 padding:10/4/2 | 4087 / 4150 / 4274 |
| 按钮尺寸 | `.btn-sm` **未定义 CSS 规则** → 回退到 `.btn`(36px/14px)，高度字号漂移 | — |
| 图标风格 | emoji（✏️ ⧉ ⬇ ↶ ↷ ↻ ＋）与 SVG（全屏按钮）混用，跨平台渲染割裂 | 15–29 / 488 |
| 图标背景 | `.btn-copy` 用 `--p` 彩色边框、`.grp-btn` 用 `--bg2`、图标按钮透明，无统一色板 | 4110 / 4443 |
| 圆角 | 按钮 `--radius-md`(12) / `.btn-xs` 6 / `.view-tabs` 8 / 输入 6，混用 | 4116 / 4092 |
| 阴影 | `.view-tabs .on` 硬编码 `0 1px 3px rgba(0,0,0,.08)`，未走 token | 4094 |
| 字体 | 14(`.btn`) / 13(`.view-tabs`) / 12(`.hint`/`.filter-input`) / 11(`.btn-xs`/col hint)，字重 400/500/600 无规范 | 多处 |
| 颜色硬编码 | `.sop` 用 `#fffbe6/#fde68a/#92400e`、`.calc.sum` 用 `#fffbeb/#92400e` 等，应改语义变量 | 4098+ |

---

## 1. 布局与间距规范

**容器 `.tb`**（替代现有 `.toolbar` / `.tb-toolbar` / `.edit-ops` 的外层）
```css
.tb{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; flex-wrap:wrap; }
```

**分组 `.tb-group`**（左组筛选/视图，右组动作）
```css
.tb-group{ display:inline-flex; align-items:center; gap:8px; }
.tb-sep{ width:1px; height:20px; background:var(--bd); flex:0 0 auto; } /* 组间分隔，不混用 gap */
```

**间距矩阵**

| 场景 | 值 |
|---|---|
| 组内按钮间距 | **8px** |
| 组间间距 / 分隔 | **12px** 或 1px `.tb-sep` |
| 工具栏内边距 | **12px 16px** |
| 工具栏与内容间距 | 14px（与卡片间距一致） |

**尺寸矩阵**

| 元素 | 高度 |
|---|---|
| 默认按钮 `.btn` | 36px |
| 紧凑按钮 `.btn-sm` | **32px**（须补齐定义） |
| 图标按钮 `.btn-icon` | **30px**（与 AI 副驾 `.cp-icon-btn` 对齐） |
| 筛选/下拉输入 | 32px |

---

## 2. 图标风格与尺寸标准

- **统一采用线性图标（line icon）**，风格对齐 Lucide / 全屏按钮 SVG：
  `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`。
- **颜色 = `currentColor`**：随按钮文字色自动变化（primary 白、ghost `--t1`、icon-btn `--t2`），天然适配深色模式。
- **尺寸档位**
  - 按钮内图标：**16×16**（默认）
  - 图标按钮盒内图标：16×16（盒 30×30）
  - 页头/品牌强调图标：20×20
- **❌ 禁止 emoji 作为功能图标**（✏️ ⧉ ⬇ ↶ ↷ ↻ ＋）。emoji 仅保留于状态/空态配图（如 📭）。
- **统一图标库**（沉淀为 `Icon.vue`，覆盖工具栏全部动作）：
  `edit / refresh / copy / download / import / sort / fullscreen / settings / plus / undo / redo / close / audit / payment / template / wizard / search`。

---

## 3. 图标背景色板与适用场景

| 类型 | 背景 | 文字/图标色 | 边框 | 适用场景 |
|---|---|---|---|---|
| **主操作 Primary** | `var(--p-dark)` | `#fff` | 无 | 每栏**唯一**主 CTA（AI 审核 / 保存调整 / 确认定稿 / 下游闭环向导） |
| **次要 Ghost** | `transparent` | `var(--t1)` | `1px solid var(--bd)` | 绝大多数动作（导入/复制/刷新/导出/撤销/重做） |
| **图标按钮 Icon** | `transparent` | `var(--t2)` | 无 | 纯图标动作（全屏 / 列设置 ⚙️ / 复制列 / 关闭 ✕）；hover `var(--bg2)` + `var(--t1)` |
| **危险 Danger** | `transparent` | `var(--dan)` | 透明 | **仅**删除类（删列/删行）；hover 浅红 `var(--dan-bg)`；不加实心红底，保持克制 |
| **中性 Chip** | `var(--bg2)` | `var(--t1)` | 透明 | 视图切换 tab / 分组选择；选中态 `var(--p)` 白字 |
| **悬浮/激活** | `var(--bg2)` / `var(--bg3)` | — | — | 所有可点元素的 hover；主操作按下 `var(--p-deep)` |

**配套令牌补充**（variables.css 当前缺失，需新增）：
```css
--dan-bg:rgba(255,59,48,.10);   /* 删除类 hover 浅红底 */
```

**❌ 禁止**：每个按钮各用彩色边框（如旧 `.btn-copy` 的 `--p` 边框改为 Ghost 或语义化）；硬写 hex 警示色（`.sop`/`.calc.sum` 改 `var(--war)` 衍生）；emoji 当图标。

---

## 4. 字体 / 字号 / 字重层级

统一 `font-family:var(--font-sans)`（SF / PingFang）。仅用 **400 / 500 / 600** 三档字重（设计体系无 700）。

| 级别 | 字号 | 字重 | 颜色 | 用途 |
|---|---|---|---|---|
| **T1 区块标题** | 14px | 600 | `var(--t1)` | 工具栏左侧区块标题、面板标题 |
| **T2 按钮文字** | 13px | 500 | 按钮主色 | 所有工具栏按钮标签（密度场景；卡片/页级按钮可保持 14px/500） |
| **T3 辅助文字** | 12px | 400 | `var(--t2)` / `var(--t3)` | hint、筛选占位、未选中 tab、说明 |

- 行高 1.5–1.6；数字一律 `font-variant-numeric:tabular-nums`。
- 消除现状：`.btn-sm` 未定义(14px) → 统一 13px；`.view-tabs`(13) / `.hint`(11–12) / `.btn-xs`(11) → 收敛到 **13 / 12** 两档。

---

## 5. 与现有 UI 体系对齐

| 要素 | 规范 | 对齐对象 |
|---|---|---|
| 圆角 | 按钮 / 图标按钮 / 输入 = **`--radius-sm`(8px)**；卡片保留 `--radius-lg`(16) | variables.css 令牌 |
| 阴影 | 按钮默认**无投影**（flat 苹果风）；仅 `.card`/浮层用 `--shadow-*`；`.view-tabs .on` 改 `var(--shadow-sm)` | variables.css |
| 间距 | 组内 8 / 组间 12 / padding 12-16，与 `.card` 一致 | variables.css |
| 主题 | 颜色全部走 CSS 变量，天然支持 `:root.dark`，**不写死任何颜色** | variables.css |
| 过渡 | `transition:.15s ease`（背景/颜色/边框） | `.btn` 现有 |
| 图标按钮 | 30×30、圆角 8、透明、hover 浅底 | AI 副驾 `.cp-icon-btn` |

---

## 6. 可复用组件标准（实现落地）

### 6.1 全局组件
- **`Toolbar.vue`**：渲染 `.tb` + `.tb-group` + `.tb-sep`，插槽分发左右组。
- **`Icon.vue`**：按 name 输出统一线性 SVG（`<Icon name="refresh"/>`），统一 16px currentColor。
- **`Button.vue`**（可选）：封装 `primary / ghost / danger / icon` 四种 variant + `size`。

### 6.2 核心 CSS（可直接并入 variables.css / 全局）
```css
.tb{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;flex-wrap:wrap}
.tb-group{display:inline-flex;align-items:center;gap:8px}
.tb-sep{width:1px;height:20px;background:var(--bd);flex:0 0 auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:none;border-radius:var(--radius-sm);font-size:13px;font-weight:500;line-height:1;cursor:pointer;transition:background .15s,color .15s,border-color .15s,opacity .15s}
.btn svg{width:16px;height:16px}
.btn-sm{height:32px;padding:0 12px;font-size:13px;border-radius:var(--radius-sm)}
.btn:disabled{opacity:.4;cursor:default}
.btn-primary{background:var(--p-dark);color:#fff}.btn-primary:hover:not(:disabled){background:var(--p-deep)}
.btn-ghost{background:transparent;color:var(--t1);border:1px solid var(--bd)}.btn-ghost:hover:not(:disabled){background:var(--bg2)}
.btn-danger{background:transparent;color:var(--dan);border:1px solid transparent}.btn-danger:hover:not(:disabled){background:var(--dan-bg)}
.btn-icon{width:30px;height:30px;padding:0;border:none;background:none;border-radius:var(--radius-sm);color:var(--t2);cursor:pointer;transition:background .15s,color .15s}
.btn-icon svg{width:16px;height:16px}.btn-icon:hover:not(:disabled){background:var(--bg2);color:var(--t1)}.btn-icon:disabled{opacity:.35;cursor:default}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid transparent;border-radius:var(--radius-sm);background:var(--bg2);color:var(--t1);font-size:13px;font-weight:500;cursor:pointer}
.chip:hover{border-color:var(--p)}.chip.on{background:var(--p);color:#fff;border-color:var(--p)}
.fld{height:32px;padding:0 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--t1);font-size:13px;font-family:inherit}
.fld:focus{outline:none;border-color:var(--p-dark);box-shadow:0 0 0 3px var(--p-bg)}
.ico{width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
```

### 6.3 推荐标记示例
```html
<div class="tb">
  <div class="tb-group">
    <input class="fld" placeholder="筛选商品名…" style="width:150px">
    <div class="tb-sep"></div>
    <button class="chip on"><Icon name="cross"/>交叉表</button>
    <button class="chip"><Icon name="list"/>列表</button>
  </div>
  <div class="tb-group">
    <button class="btn btn-ghost"><Icon name="import"/>导入 Excel</button>
    <button class="btn btn-ghost"><Icon name="refresh"/>刷新</button>
    <div class="tb-sep"></div>
    <button class="btn btn-icon" title="列设置"><Icon name="settings"/></button>
    <button class="btn btn-icon" title="全屏"><Icon name="fullscreen"/></button>
    <div class="tb-sep"></div>
    <button class="btn btn-primary"><Icon name="audit"/>AI 审核本周期</button>
  </div>
</div>
```

### 6.4 Do / Don't
- ✅ 主 CTA 唯一且实心青；其余幽灵描边；图标按钮透明 30×30。
- ✅ 图标全线性 16px、currentColor、同源图标库。
- ✅ 组内 8px、组间 12px / `.tb-sep`；圆角统一 8px；颜色全走变量。
- ❌ emoji 当功能图标；每按钮各自彩色边框；间距/圆角/字号随意混用；硬写 hex。

---

## 7. 落地 CheckList（应用到预报模块）

1. `variables.css` 新增 `--dan-bg`；将 `.sop` / `.calc.sum` 等硬 hex 改为语义变量。
2. 补齐 `.btn-sm`（32px/13px）定义；移除 `.btn-copy` 彩色边框（改 Ghost 或语义）。
3. 三处工具栏（顶部 `.toolbar`、交叉 `.tb-toolbar`、编辑 `.edit-ops`）统一为 `.tb` / `.tb-group` / `.tb-sep` 结构。
4. 所有 emoji 功能图标替换为 `Icon.vue` 线性图标（编辑/刷新/复制/导出/排序/撤销/重做/新增）。
5. 全屏 / 列设置 / 关闭 ✕ 统一为 `.btn-icon`（30×30，圆角 8，hover 浅底）。
6. 圆角统一 8px；`.view-tabs .on` 阴影改 `var(--shadow-sm)`。
7. 字号收敛 13/12 两档，字重 400/500/600。
8. `npm run build` + 部署 + 真机验证（浅/深两主题、全屏态、横向滚动对齐）。
