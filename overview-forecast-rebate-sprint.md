# 预报模块：删「提交闭环」向导 + 新增「返利冲刺看板」（前置）

## 变更摘要
按用户决策重构 Forecast.vue 的下游闭环与返利体验：
- **删除**「提交闭环」按钮 + 两步向导（余额&付款 / 返利测算），因为文员汇总后直接去厂家系统看金额、用计算器算「订单金额−厂家余额」、通知打款即可，无需在 hergent 里填余额。
- **删除**独立的「余额&付款」弹窗、`「返利冲档测算」弹窗（均为无调用方的孤儿代码）及对应死变量/死样式。
- **新增「返利冲刺看板」**（list 视图）：把返利目标达成从"事后闭环"前移为"下单时即可见"——老板在看本期预报时就直接看到：
  - 目标品牌/商品本期达成多少、距目标还差多少能拿返利；
  - 本月（下单截止前）还要下几次单（按每 2 天一单估算）；
  - 要补齐缺口、均单需额外追加多少；系统给出每单追加额 + 优先加单商品 Top3 建议。
  - 未配置目标时显示空态，引导去「能力中心 → 返利目标规则」。

## 技术要点
- 复用后端现有 `rebate_target_rules` 引擎：`GET /api/rebate-rules` 读活跃规则（dimension=brand|product、target_type=amount|quantity），前端按本期预报（定稿量×厂价 / 件数）聚合 contrib/gap/perOrder/ach。
- 兼修：`Icon.vue` 补 `chevron-up`（原本用的 `up`/`down` 名不存在会 fallback 成设置齿轮）；`loadRebatePush` 改为直接调 `forecastApi.rebateGap`；`onMounted` 挂 `loadRebateRules()`。
- 修复构建阻断：删弹窗时误删 `</Teleport>` 闭合标签、留下孤立 `<Teleport to="body">` 起始标签导致 `Element is missing end tag`。已删孤立标签（Teleport 现 8 开 8 闭平衡）。

## 验证
- 本地 `npm run build` 通过（✓ 1.49s）。
- rsync + chown 部署至 `/opt/hergent-cn-v2/`（DEPLOY_OK）。
- 生产产物 grep 核对：`返利冲刺看板`=1、`提交闭环`/`余额&付款`/`返利冲档`=0。
- 保留独立的「💰 返利冲刺」推送助手（rebatPushOpen，与删除项无关）。

## 待用户实测
沙箱无浏览器真机验证（连不上 hergent.cn）。请**硬刷新（Cmd+Shift+R）**后到预报页 list 视图核对：看板显示、折叠、进度条、系统建议，以及「提交闭环/余额&付款/返利冲档」入口确已消失。
