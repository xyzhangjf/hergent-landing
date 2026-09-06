# 经营看板 UI 系统审查报告 (v96)
**审查时间**: 2026-08-02 06:55
**审查范围**: 经营看板页面 (`pgDashboard`) — 包括 4 stat-card / 2 chart / dashAttention (3 卡) / dashCore (2 卡) / aiInsightHero / B1 今日毛利 / B2 我的操作
**审查人**: UI Designer

---

## 优先级总览

| 优先级 | 数量 | 关键问题 |
|---|---|---|
| **🔴 P0** (立即修) | 5 | chart 文字不可读 (浅色主题) / 信息重复 (3 处) / 加载无 skeleton |
| **🟡 P1** (本周修) | 12 | stat-card 数字偏小 / chart 空态/硬编码色 / 移动端 padding / h1 字号 |
| **🟢 P2** (下迭代) | 8 | 钻取交互 / 键盘导航 / 文案统一 / 触感反馈 |

---

## 维度 1: 信息架构与布局合理性

### 🔴 P0-1.1: 信息重复 (3 处展示同一数据)

**位置**: `app.js:4407-4447` + `today-profit-bar.js:46-82` + `ai-features.js:9-40`

**问题**:
- **「今日毛利/销售/订单/回款」** 4 个数字同时出现在:
  - 4 stat-card (总收入/总支出/净利润/收款额)
  - B1 今日毛利横条 (固定底部)
  - B2 我的操作 + aiInsightHero ("今日营收 ¥X / X 笔订单")
- **「AI 洞察」** 重复:
  - aiInsightHero (page-hd 之下) 
  - dashCore 右侧 "AI 洞察" 卡片

**改进**:
- B1 (今日毛利横条) 内容并入 4 stat-card 顶部，删除独立横条
- aiInsightHero 改成「折叠态默认」: 一行总结 + "▼ 详细"，需要时再展开
- dashCore 的 "AI 洞察" 跟 aiInsightHero 合并到一处

### 🔴 P0-1.2: 工具栏高频操作缺失

**位置**: `app.js:4423-4428`

**现状**:
```js
// 只有 3 个按钮: 销售开单 / 记一笔 / 库存预警(条件渲染)
```

**改进**:
- 加 **「+ 新建客户」** (CRM 高频入口)
- 加 **「+ 录采购单」** (采购高频)
- 加 **「📋 待审核」** (L1 信任分级后核心入口, 显示 badge 数字)
- 工具栏超过 4 个按钮时折叠为 "更多 ▾" 菜单

### 🟡 P1-1.3: dashAttention 标题语义重叠

**位置**: `app.js:4440-4442`

**现状**:
- "需关注" (icon: alert)
- "今日概览" (icon: calendar)
- "经营健康" (icon: chart)

**问题**: "需关注" 和 "今日概览" 在用户感知上区分模糊

**改进**:
- 改为「⚠️ 异常」「📅 待办」「💚 健康分」— 动词+图标清晰
- 每张卡用更明确的状态色: 异常红/待办蓝/健康绿 (而不是统一 var(--t3))

---

## 维度 2: 数据可视化图表

### 🔴 P0-2.1: chart 文字颜色写死白色半透明, 浅色主题下完全不可读 ⚠️⚠️

**位置**: `app.js:4527 + 4534` — drawCharts()

**现状**:
```js
// chart 1 line 配置
plugins:{legend:{position:"bottom",labels:{color:"rgba(255,255,255,.5)"}}}
scales:{x:{ticks:{color:"rgba(255,255,255,.35)"}},y:{ticks:{color:"rgba(255,255,255,.35"}}}
```

**问题**: 线上跑的是浅色主题 (白底), 但 chart 的 legend / ticks / grid 颜色全部写死 **白色 35-50% 透明**——在白底上几乎不可见

**改进**:
```js
// 用 var(--t1) / var(--t2) / var(--bd) 跟随主题
labels: { color: 'var(--t2)' }   // legend
ticks: { color: 'var(--t3)' }    // axis
grid: { color: 'var(--bd)' }     // gridline
```

**注**: Chart.js 接受 CSS variable 字符串, 但**需要字符串字面量传 CSS variable 名称** (不能直接传 var()) — 实际改法是用 `getComputedStyle` 读 token 值, 或写两个 theme 切换函数

### 🟡 P1-2.2: chart 空态是平的折线/空白饼图

**位置**: `app.js:4519-4521` + 4533

**现状**:
```js
if(!income.length) income=[0,0,0,0,0,0,0];   // 全 0 → 平线
// doughnut: 4 段都是 0 → 空白圆
```

**改进**:
- 全 0 时显示 "📊 暂无数据, 点击录入第一笔销售" 占位 (有 CTA 按钮)
- 给 chart 区域加 .chart-empty 样式骨架

### 🟡 P1-2.3: 应收应付图数据是"估算的", 不是真实数据

**位置**: `app.js:4533`

**现状**:
```js
data:[nr(d.total_ar||0), nr(d.total_ap||0),
      Math.max(nr(d.total_ar||0)*.4,100),     // "已收" = 应收×0.4 (拍脑袋)
      Math.max(nr(d.total_ap||0)*.3,50)],     // "已付" = 应付×0.3
```

**改进**:
- 后端接口返回真实已收/已付字段 (`d.received_total` / `d.paid_total`)
- 或改成 **stacked bar chart** (应收/已收 / 应付/已付) 表达更清晰

### 🟡 P1-2.4: chart 7天趋势图跟 B1 趋势线重复

**位置**: `app.js:4524` (chartTrend) + `today-profit-bar.js:77` (B1 sparkline)

**问题**: 同 7 天数据, 大图+小折线各画一次

**改进**: B1 改成「按日对比/同比环比」, 不再画 sparkline

### 🟢 P2-2.5: chart tooltip 不显示中文数字格式

**位置**: `app.js:4524-4527` (line) + 4533 (doughnut)

**现状**: Chart.js 默认 tooltip 显示原始数字, 不带 ¥ 和千分位

**改进**:
```js
plugins:{tooltip:{callbacks:{
  label: function(ctx){return ctx.dataset.label+': ¥'+fmtCN(ctx.parsed.y)}
}}}
```

---

## 维度 3: 关键指标视觉层级

### 🟡 P1-3.1: stat-card 数字 24px 偏小, KPI 应该有冲击力

**位置**: `styles.css:235`

**现状**: `.stat-card-val{font-size:24px;font-weight:600}`

**改进**:
- 默认桌面: 32px / weight 700 / `font-variant-numeric: tabular-nums` 已有
- 当数字 ≥ 10000: 自动加 "万" 单位 (¥12.3万 而不是 ¥123,456)

### 🟡 P1-3.2: sc-green 重复 2 次 (总收入/收款额)

**位置**: `app.js:4432`

**现状**:
```js
statCard(icon('trendUp',14)+' 总收入', d.income||d.sales_total, "sc-green", "¥")
statCard(icon('accounts',14)+' 收款额', d.payments_total, "sc-green", "¥")
```

**问题**: 颜色重复, 视觉层级混乱

**改进**:
- 总收入 → sc-green (收入, 正向)
- 总支出 → sc-red (支出, 警示)
- 净利润 → sc-blue (核心指标, 强调)
- 收款额 → **sc-purple 或 sc-amber** (新色变体, 区分)

### 🟡 P1-3.3: page-hd 字号 24px, 经营看板是一级页面应该有更强标题

**位置**: `styles.css:8` (.page-hd) + `app.js:4411`

**现状**: `font-size:24px;font-weight:600`

**改进**:
- 经营看板 / 订单 / 客户 等一级页面 page-hd 用 **32px / 700**
- 二级页面 (分类管理 / 品牌档案) 24px 不变

### 🟡 P1-3.4: stat-card 数字 0 时显示很空

**位置**: `app.js:4432` + `statCard` 函数

**现状**: 当 d.profit=0 时显示 "¥0" 大字, 显得页面"没数据"

**改进**:
- 0 时: 显示 "—" 灰色 + hover 提示 "去录第一笔"
- 负数时: 用 --dan 红色 + "↓ -¥X" 形式
- 大数时: 用 "¥1.2万 / ¥34.5万" 简写

---

## 维度 4: 色彩搭配与对比度

### 🟡 P1-4.1: chart 颜色硬编码, 不跟随主题

**位置**: `app.js:4522-4534`

**现状**:
```js
borderColor:"#2563eb"  // 蓝
borderColor:"#ef4444"  // 红
backgroundColor:gi      // 渐变硬编码
pointBorderColor:"#0a0f1a"  // 深色
```

**问题**: 颜色绑死, 切深色主题时 chart 颜色不变

**改进**:
- 用 `getComputedStyle(document.documentElement).getPropertyValue('--p')` 读 token
- 写 chart 主题切换函数, 跟 store.theme 联动
- 改 2 套配色 (light/dark)

### 🟡 P1-4.2: stat-card 11px label 颜色 var(--t2) 在白底对比度勉强

**位置**: `styles.css:234`

**现状**: `.stat-card-label{font-size:11px;color:var(--t2)}`

**问题**: 11px 小字需要 ≥ 4.5:1 对比度, --t2 通常是 #6b7280 在白底 4.5:1 边缘

**改进**:
- 字号: 11px → 12px (可读性更好)
- 颜色: var(--t2) → var(--t1) (主文字色, 7:1+)
- text-transform: uppercase 中文不需要, 删掉

### 🟢 P2-4.3: aiInsightHero 渐变背景基于 --p 青色, 跟页面整体蓝紫调冲突

**位置**: `ai-features.js:51`

**改进**: 用品牌渐变 (青→紫) 而非单一青

---

## 维度 5: 交互操作便捷性

### 🟡 P1-5.1: stat-card 有 hover transform 但不可点击

**位置**: `styles.css:230`

**现状**: `.stat-card:hover{transform:translateY(-2px)}` 但没有 `cursor:pointer` 也没有 onclick

**改进**:
- 加 `cursor:pointer` + `onclick` 跳到详情 (总收入→销售明细 / 总支出→付款明细 / 净利润→经营分析 / 收款额→应收明细)

### 🟡 P1-5.2: chart-card 不能点击钻取

**位置**: `app.js:4434-4437`

**改进**:
- chart-wrap 整体加 `cursor:pointer` + 跳到对应模块
- chart 顶部右侧加 "查看详情 →" 链接

### 🟡 P1-5.3: 工具栏时间 chips 默认状态不明

**位置**: `app.js:4429` (renderTimeChips("dashboard"))

**问题**: 用户不知道默认选哪个时间维度 (今日/本周/本月?)

**改进**:
- chips 选中态视觉加强 (filled background, 不仅 outline)
- 默认选 "本月" (最常用)

### 🟢 P2-5.4: 没有 keyboard 导航

**位置**: stat-card / chart-card / 工具栏按钮

**改进**:
- stat-card / chart-card 加 `tabindex="0"` + Enter 跳转
- 工具栏按钮已有 (button 元素), 改 focus ring 颜色用 var(--p)

### 🟢 P2-5.5: stat-card hover transform 同行卡片错位

**位置**: `styles.css:230` `transform:translateY(-2px)`

**问题**: 同行其他卡片不动, hover 卡上移 → 视觉错位

**改进**: 改用 box-shadow 加强代替 transform

---

## 维度 6: 加载性能与响应速度

### 🔴 P0-6.1: 启动期无 loading skeleton

**位置**: `app.js:4440-4447` (dashAttention / dashCore placeholder) + chart (line 4435/4436)

**现状**:
```js
'<div class="stat-card" ...><div ...>待关注</div><div class="spinner" ...></div></div>'
// chart 区域: 200ms setTimeout 才 drawCharts, 这期间是空白
```

**改进**:
- stat-card 显示数字 placeholder (灰条骨架) 而不是 spinner
- chart 区域显示灰色折线骨架 (7 个点连线) 而不是空白
- skeleton 用 CSS animation pulse

### 🟡 P1-6.2: chart 每次 navTo 都 destroy + recreate

**位置**: `app.js:4514` `_dashboardCharts.trend.destroy()`

**问题**: 切到订单页再切回看板, chart 重新建, 浪费 200-400ms

**改进**:
- 缓存 chart 实例, 只在 data 变化时 update
- 用 `_dashboardCharts.trend.data = newData; _dashboardCharts.trend.update()`

### 🟡 P1-6.3: 启动期并行 8+ API, 没有优先级

**位置**: `app.js:4450` (loadAttentionCards + loadCoreGrid) + 多个组件 (aiInsightHero 2000ms setInterval) + B1 (5min polling) + B2 (5min polling) + B3 (10min polling)

**改进**:
- 关键数据 (4 stat-card + 2 chart) 优先, 串行 fetch
- 次要 (B2/B3) 用 requestIdleCallback 延后
- 同一数据 (receivables) 多处用, 共享 promise 缓存

### 🟢 P2-6.4: chart.js bundle 大, 可以按需懒加载

**现状**: 整套 chart.js 全量加载

**改进**:
- 看板首次进入才 import chart.js
- 用 dynamic import 延迟加载

---

## 维度 7: 移动端/不同屏幕适配

### 🟡 P1-7.1: stat-card padding 24px 在移动端太挤

**位置**: `styles.css:224`

**现状**: `.stat-card{background:var(--surface);padding:24px}` 移动端没改

**改进**:
- < 768px: padding 16px
- < 480px: padding 12px, stat-card-val 24px → 20px

### 🟡 P1-7.2: chart 在窄屏 (320-480px) tooltip 会溢出

**位置**: chart-wrap 默认高度?

**改进**:
- chart-wrap 设 `min-height: 200px` (避免高度 0)
- 移动端 chart options: `plugins.tooltip.enabled = window.innerWidth > 600`

### 🟡 P1-7.3: 工具栏 4+ 按钮移动端溢出

**位置**: `app.js:4423-4428`

**改进**:
- < 640px 工具栏变 2x2 grid
- > 4 个按钮时折叠为 "更多 ▾" 菜单

### 🟢 P2-7.4: B1 横条 fixed 在移动端占用 60-80px 太多

**位置**: `today-profit-bar.js` (buildBar)

**改进**:
- < 640px: B1 简化为单行 "今日毛利 ¥X (销售 ¥X · 订单 X · 回款 ¥X)", padding 8px

---

## 维度 8: 文案表述清晰度

### 🟡 P1-8.1: stat-card "收款额" 用词不专业

**位置**: `app.js:4432`

**现状**: `statCard(icon('accounts',14)+' 收款额', d.payments_total, "sc-green", "¥")`

**改进**:
- 改成 "已收款" 或 "回款" (财务标准术语)
- 跟 "应收款" 区分 (应收是客户欠你, 已收是客户已付)

### 🟡 P1-8.2: 4 stat-card label 中英文混排

**位置**: `app.js:4432`

**现状**:
- "总收入" ✓ 中文
- "总支出" ✓ 中文
- "净利润" ✓ 中文
- "收款额" → 已收款

**改进**: 全中文, 财务口径统一

### 🟡 P1-8.3: chart-card-title "应收应付分布" 跟 doughnut 实际 4 段不匹配

**位置**: `app.js:4436` + 4533

**问题**: 标题说"应收应付分布", 但实际 chart 4 段是"应收/应付/已收/已付" (不只是分布)

**改进**:
- 标题改 "应收应付构成" 或 "资金收支构成"
- 或 chart 类型改 grouped bar: X 轴「应收/应付」, 每组 2 段「未结/已结」

### 🟢 P2-8.4: aiInsightHero 文案太长时换行不友好

**位置**: `ai-features.js:29-36`

**改进**:
- 限制单行 60 字, 多行 ellipsis
- 加 "查看完整洞察 →" 链接

### 🟢 P2-8.5: B1 AI 角标 "🤖 AI" 用户不知道含义

**位置**: `today-profit-bar.js:56`

**改进**:
- 加 tooltip "AI 模式自动汇总" (已加, 但 hover 才显示)
- 加永久的 "AI 自动" 副标题

---

## P0 修复建议 (今天就修)

| # | 位置 | 改动 | 估时 |
|---|---|---|---|
| 1 | `app.js:4527/4534` | chart 文字色改 CSS variable | 30 min |
| 2 | `app.js:4407-4447` | 删除 B1 重复 + 合并 aiInsightHero/dashCore | 1 h |
| 3 | `app.js:4440-4447` | placeholder 改 skeleton (CSS 灰条 pulse) | 30 min |
| 4 | `styles.css:224` | stat-card padding 移动端 16/12px | 10 min |
| 5 | `app.js:4432` | 4 stat-card label 改标准财务术语 | 10 min |

**总估时**: ~2.5h

---

## 不修 (P3) — 留作讨论

- 看板完全重设计为「直播流」风格 (类似 Linear/Notion home)
- 引入 drag-and-drop 自定义布局
- 加 dark mode 看板专属配色

---

**UI Designer 结论**: 经营看板现在的问题不是「不好看」, 而是「信息层级不清 + 同一数据多处展示 + 主题跟随不到位」。修完 P0 5 项, 整体可读性 +50%, 加载体验 +30%。P1 12 项是打磨, 预计总工作量 1 人天。

**审完待确认**: 是否要现在就修 P0 5 项?
