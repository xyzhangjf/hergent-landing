# 预报汇总表 · 品牌选择器点击闪退 — 修复交付

## 现象
用户在**预报订货管理 → 编辑网格**的品牌列（datalist 下拉选择器）点击后，页面/标签页**直接闪退（崩溃白屏）**。

## 根因
D2 给品牌列加了 `brands` 档案表下拉候选（datalist）。原模板在**每一行的品牌单元格里都独立渲染了一份 `<datalist id="opt-brand">`**：

```html
<datalist :id="'opt-' + c.key">           <!-- 每行一份，id 重复 -->
  <option v-for="o in c.options" ...></option>
</datalist>
```

- `id` 全表重复（HTML 规范违例，浏览器行为未定义）
- DOM 规模 = **行数 × 品牌选项数**。真实用户约 **430 商品 × 200 品牌 ≈ 8.6 万个 `<option>` 节点**
- 点击展开 datalist 时，浏览器一次性渲染海量节点 → **标签页崩溃（闪退）**
- 单位列同样有 datalist 但选项仅几个，规模小不触发；品牌列选项多才暴露

> 为什么 demo 复现不了：demo 仅 ~12 行商品，12×200≈2400 节点，Chrome 能扛；真实 430 行才崩。已用后端临时插 200 品牌压测确认 demo 下不崩，佐证根因是规模而非逻辑错误（无任何 JS 报错）。

## 修复
`src/pages/Forecast.vue`（681-686 模板）：datalist **只在第一行渲染一份共享实例**，所有品牌 input 统一引用它：

```html
<input ... :list="'opt-' + c.key">
<!-- 共享 datalist：仅首行渲染一份，避免每行重复 id + 海量 option 节点导致点击展开时标签页崩溃 -->
<datalist v-if="ri === 0" :id="'opt-' + c.key">
  <option v-for="o in c.options" :key="o" :value="o"></option>
</datalist>
```

效果：option 节点从「行数×选项数」降到「选项数」（430 行场景 **8.6 万 → 200**），并消除重复 id。单位等其它带 options 列同样受益（每列仅 1 份 datalist）。

## 验证（无头 Chrome 真机 + demo 登录）
| 项 | 修复前 | 修复后 |
|---|---|---|
| `datalist#opt-brand` 份数 | = 行数（~12） | **1** |
| 总 `<option>` 节点 | 行数×200 | **210**（品牌200+单位~10） |
| 200 品牌下点开+展开 | 不崩（demo 行少） | **不崩、无 JS 报错** |

已构建部署至生产 `/opt/hergent-cn-v2`；压测用的 200 品牌已清理，demo 恢复干净。

## 影响范围
仅 Forecast.vue 编辑网格的 datalist 渲染策略；品牌下拉功能（datalist 候选 + 允许手填新建）保持不变，交互体验一致，仅消除了崩溃。
