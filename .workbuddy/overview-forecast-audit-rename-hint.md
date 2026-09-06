# 预报页「AI审核」→「下单核对」+ 未连 ERP 占位提示

## 背景（战略判定）
用户指出 AI审核 有硬伤：审核建议量吃本地库的库存/销量，而本地库数据要么手填、要么连接器同步；手填库存+销量对非技术经销商不现实，**只有 API/MCP 实时抓 ERP 才有意义**（与产品"数据接入走连接器"战略一致）。
代码证实：`_audit_items` 只读本地库（日均销量/当前库存/安全库存/提前期），无实时 ERP 调用——所谓"AI"是确定性公式，数据质量 = 本地库质量。好消息：审核逻辑已"连接器就绪"，连接器把库存/销量实时同步进来即自动变准，无需改审核代码。

## 决策
保留按钮作**占位**，但做两点改动：

### 1. 文案软化（老板不信任 AI，"AI审核"词太重）
| 位置 | 改前 | 改后 |
|---|---|---|
| 主工具栏按钮 | AI 审核 | **下单核对** |
| 弹窗标题 | AI 审核本周期 | 下单核对本周期 |
| 下游校验提示（生成舟谱模板前） | 请先「AI 审核本周期 → 定稿」 | 请先「下单核对本周期 → 定稿」 |

（弹窗内"AI 不下单"提示保留——它强调人定稿、反而增信任，不删。）

### 2. 未连 ERP 占位提示
- 复用既有 chanjet/kingdee 状态接口：`/api/datasources/v2/{chanjet,kingdee}/status`，新增 `erpLinked` computed；`onMounted` 调 `probeErp()`。
- 弹窗顶部加琥珀色警示块（`.audit-erp-note`，`⚠` + 左边框）：**未连接 ERP 时**提示——本功能智能建议需实时库存/销量为依据、未连接仅供参考；可手动核对报单量后直接「确认定稿」，或点「能力中心」文字按钮（`goConnect` → `location.hash='#/connect'`）去连接 ERP，建议才会准确。
- 连接了任一 ERP 则该提示自动消失，功能正常可用。

## 改动文件
`hergent-cn-v2/src/pages/Forecast.vue`：
- 模板：按钮文案(32)、弹窗标题(187)、弹窗内警示块(188后)、2处 toast(4733/4756)。
- 脚本：`chanjetLinked`/`kingdeeLinked`/`erpLinked`/`probeErp()`/`goConnect()`；`onMounted` 加 `probeErp()`。
- 样式：`.audit-erp-note`、`.audit-erp-note .link-btn`。

## 构建 / 部署
`npm run build` → rsync `--delete` → `/opt/hergent-cn-v2/` → chown hergent。
新产物 `Forecast-DoUSiW32.js` / `Forecast-CpRDoRMV.css`。
产物核对：`下单核对`=4、`AI 审核`=0、`当前未连接 ERP`/`建议才会准确`=1、`audit-erp-note`/`link-btn`=2。

## 需确认
⚠️ 沙箱未做浏览器真机验证。请**硬刷新（Cmd+Shift+R）**确认：
1. 主工具栏按钮显示「**下单核对**」（不再有"AI审核"）；
2. 点击进入弹窗，若当前环境未连接畅捷通/金蝶，弹窗顶部出现琥珀色说明块，点「能力中心」可跳转；
3. 弹窗标题为「下单核对本周期」；生成舟谱模板前的提示文案亦同步更新。
