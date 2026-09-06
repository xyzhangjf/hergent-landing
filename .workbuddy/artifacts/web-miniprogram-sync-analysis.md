# Web 端变更 → 小程序端同步分析报告

> 分析日期：2026-08-30　｜　性质：**仅分析与建议，未修改任何代码**
> 方法：从两仓库 git 提交记录 + 未提交工作区改动提取变更事实 → 提取小程序实际调用的 11 个接口 → 逐项比对后端实现与前端消费。

---

## 0. 分析范围与事实来源

| 仓库 | 分支 | 已提交（近 20） | 未提交改动 |
|---|---|---|---|
| `hergent-erp`（后端 + vanilla 前端） | `upgrade/v84-international` | 20 条 | **43 个文件**（`erp_db.py` +990、`server.py` +849 等） |
| `hergent-cn-v2`（Vue3 副驾前端） | `main` | 8 条 | **214 个文件**（含 Rebate/Forecast/ConnectCenter/Login 等页面） |

小程序端实际调用接口（从 `miniprogram/pages/*.js` 提取，共 11 个）：

```
POST /api/auth/login
POST /api/forecast-submissions          GET /api/forecast-submissions/my
GET  /api/forecast-submissions/open-periods   GET /api/forecast-submissions/stores
GET  /api/products/fill-search          GET /api/forecast-submissions/pending
GET  /api/forecast-submissions/summary  POST /api/forecast-submissions/{sid}/approve
POST /api/forecast-submissions/{sid}/reject  POST /api/forecast-submissions/{sid}/recall
```

---

## 1. Web 端变更清单（与小程序相关的部分）

### 1.1 后端 — 已提交（按时间近→远）

| 提交 | 变更 | 与小程序关系 |
|---|---|---|
| `02b1d36` `966a388` `c7fd460` | wecom webhook 修复 + 自助配置端点 | 无关 |
| `44428d8` | AI 进化日志端点 + 定时任务推送 | 无关 |
| `0231f8a` | **演示入口**（`POST /api/auth/demo-login`） | 需评估隔离性（见 R4，结论：安全） |
| `bed1564` | 用户自注册入口 + 激活引导 | 无关 |
| `0aab1c0` `2150749` | sale_orders 导入 / 智能导入 | 无关 |
| `146c5e3` | 催收跟进闭环 | 无关 |
| `83a6b4c` | **SKU 别名智能匹配** | 后端能力，小程序自动受益 |
| `20b1a6e` | 审批决策辅助（AI 置信度 + 库存对比 + AI 建议量） | **小程序审批页已消费** |
| `d9fc93b` | 汇总总表加 AI 建议下单量对比 | 部分相关（见 P1-2） |
| `cc0077d` | P0 修复：生产租户库缺预报表导致填报 500 | 已修复，小程序受益 |
| `69fe913` | 员工预报审批流（通过转采购申请 / 驳回） | **小程序审批页依赖** |
| `b4be521` | 员工账号管理（Web 端开账号 / 绑门店） | **小程序账号由此外开** |
| `2e35553` | 预报订单小程序后端（填报 / 我的提交 / 汇总） | 基础 |

### 1.2 后端 — 未提交改动（**关键，尚未部署**）

| 文件 | 改动 | 影响小程序？ |
|---|---|---|
| `server/routers/forecast_submissions.py`<br>(+286 / −26) | ① **B1 门店越权校验**（store.id 必须在 `employee_stores` 范围，name 不信任客户端）<br>② **B4 幂等**（同人同店同 order_date 仅一条，重复提交=覆盖；已通过则禁止覆盖）<br>③ **B2 明细清洗**（product_id 非法则跳过，非 500）<br>④ **期次解析 A+B 方案**（传 period_id 则校验"开放且今天在窗口内"；不传则后端自动取；**取不到硬报错**，不再静默回退今天；order_date 一律服务端推导）<br>⑤ 新增 `GET /open-periods`、`POST /remind`、`POST /save-matrix`、`POST /{sid}/recall`<br>⑥ `GET /summary` 新增 `start` / `end` 区间参数<br>⑦ N+1 优化（批量查人名） | **①②③④ 已适配**<br>⑤ remind/save-matrix 缺失<br>⑥ 未消费 |
| `server/routers/auth.py` (+45) | 登录响应**新增 `tenant_id` 字段**（v108-fix，注释明确写「wx.request 不自动处理 cookie」）；`update_profile` 支持改用户名 | **已消费**（login.js 存 `fs_tenant_id`） |
| `server/routers/data.py` (+149) | 新增 `GET /products/fill-search`（M7：单接口返回商品+库存+近 30 天日均，替代两次串行请求）；新增 `POST /products/bulk-upsert`（Web 网格批量写入） | fill-search **已消费** |
| `server/erp_db.py` (+990) | `forecast_submission_create()` 增 `order_date` 参数（**向后兼容**）<br>`forecast_submission_summary()` 增 `start_date/end_date`（**向后兼容**）<br>新增 `forecast_submission_recall()`<br>新增表 `forecast_col_schemes`（预报列方案）、`report_mapping`、`brand_pending` | **存在遗漏，见 P0-1** |
| `server/server.py` (+849) | RBAC `_PATH_MODULE_MAP` 扩充（新路由不登记 → 403） | 已验证 recall 可用 |

### 1.3 副驾前端 — 已提交

| 提交 | 变更 | 与小程序关系 |
|---|---|---|
| `2e84c48` | 推送卡 webhook 自助输入框 | 无关 |
| `f5375e8` | 进化日志 tab + 定时任务推送状态卡 | 无关 |
| `dbf94d6` | 登录页演示入口 + 顶栏演示模式徽标 | 无需同步 |
| `f8e3f96` | **角色权限配置页**（老板给角色勾模块权限） | **存在跨端耦合，见 R2** |
| `4058ee3` | 注册入口 + 激活引导 | 无需同步 |
| `5adb4b6` | 货损计算 + 算工资工作流前端 | 无需同步 |

### 1.4 副驾前端 — 未提交

`Rebate.vue`（维度入口卡片、达成填报 Tab）、`Forecast.vue`（冲刺看板「达成 = 填报达成 + 本期预报贡献」）、`ConnectCenter.vue`、`Dashboard.vue`、`Login.vue`、`Workbench.vue`、`Settings.vue` 等 —— 均属**Web 副驾业务模块**，小程序端无对应页面。

---

## 2. 小程序端接口覆盖对照

| 接口 | Web 端最新状态 | 小程序现状 | 结论 |
|---|---|---|---|
| `POST /auth/login` | 响应增 `tenant_id` | `login.js` 存 `fs_tenant_id`，每请求带 `X-Tenant-Id` | ✅ 已覆盖 |
| `POST /forecast-submissions` | B1 越权 + B4 幂等 + 期次 A+B | `fill.js:220` 传 `period_id`，**不传 order_date**（由服务端推导） | ✅ 已覆盖 |
| `GET /my` | — | `fill.js` / `mine.js` 均已用 | ✅ 已覆盖 |
| `GET /open-periods` | 新增 | `fill.js:33` 已用，缓存 `fs_period_id`，过期自动取 `periods[0]` | ✅ 已覆盖 |
| `GET /stores` | — | 已用（租户库绑定已修） | ✅ 已覆盖 |
| `GET /products/fill-search` | 新增（M7） | `fill.js` 已用 | ✅ 已覆盖 |
| `GET /pending` | — | `approval.js:23` 已用 | ✅ 已覆盖 |
| `POST /{sid}/approve` | — | 已用 | ✅ 已覆盖 |
| `POST /{sid}/reject` | — | 已用 | ✅ 已覆盖 |
| `POST /{sid}/recall` | 本轮新增 | 已用（mine.js） | ✅ 已覆盖 |
| `GET /summary` | **新增 start/end 区间** | `summary.js:13` **仅传 `?date=`（单日）** | ⚠️ **部分缺失** |
| `POST /remind` | 新增 | 未使用 | ❌ 缺失（Web 独有） |
| `POST /save-matrix` | 新增 | 未使用 | ❌ 缺失（Web 独有） |
| 列方案 `/forecast/col-schemes` | Web 端点(`forecast.py:107/121`) | 未使用 | ❌ 缺失（Web 独有） |

---

## 3. 三维度调整清单

### 3.1 后端维度

| # | 变更点 | 小程序端现状 | 建议调整方案 | 涉及文件 | 优先级 |
|---|---|---|---|---|---|
| **B-1** | 新增 `recalled` 状态后，**4 处 status 过滤只有 2 处排除撤回单** | 小程序撤回成功（pending 列表消失、`/my` 显示已撤回），但 **Web 端往期预报看板的「已报件数 / 门店名册」仍计入撤回单** | 两处改为 `s.status NOT IN ('rejected','recalled')`；建议抽成常量避免再次遗漏 | `server/erp_db.py:12579`（期次聚合 `_agg`）<br>`server/erp_db.py:13592`（`all_units` 门店名册） | **必须同步** |
| **B-2** | `GET /summary` 新增 `start` / `end` 区间查询 | 小程序 `summary.js` 仅支持单日 `?date=` | 汇总页加「起止日期」切换，或直接按当前期次区间查询 | `miniprogram/pages/summary/summary.js`、`summary.wxml` | 建议同步 |
| **B-3** | 登录响应含 `require_password_change`（测试账号为 true） | 小程序未消费该字段，无强制改密提示 | 内部工具可忽略；若要对外发布，登录时判断并提示改密 | `miniprogram/pages/login/login.js` | 建议同步（低） |
| **B-4** | 新增 `POST /remind`（催单）、`POST /save-matrix`（交叉表定稿）、列方案端点 | 小程序均无 | Web 端文员/经理工作流，小程序是填报端 —— 保持缺失，不建议补 | — | 可暂缓 |
| **B-5** | SKU 别名智能匹配（`83a6b4c`） | 后端能力，前端无感 | 无需改动；可考虑在搜索框 placeholder 提示「支持别名/黑话」 | `miniprogram/pages/fill/fill.wxml`（可选） | 可暂缓 |

### 3.2 前端维度

| # | 变更点 | 小程序端现状 | 建议调整方案 | 涉及文件 | 优先级 |
|---|---|---|---|---|---|
| **F-1** | 期次规则收紧（取不到开放期次**硬报错**，不再静默回退今天） | `fill.js:208` 已有 `if (!period || !period.id)` 前置拦截 | 已适配；建议把后端报错文案友好化（现在会直接弹后端原文） | `miniprogram/pages/fill/fill.js`（submit catch） | 建议同步 |
| **F-2** | B4 幂等：重复提交=**覆盖更新**；已审批通过则**禁止覆盖** | 小程序提交后显示「今日 XX 已报 N 件」，未区分「新建」与「覆盖」 | 提交成功文案区分新建/更新；命中「已通过禁止覆盖」时给明确提示 | `miniprogram/pages/fill/fill.js:223` | 建议同步 |
| **F-3** | B1 门店越权校验（store.id 须在授权范围） | 已通过（租户库绑定已修） | 无需改动；建议对 403 给「请联系老板分配门店」的友好提示 | `miniprogram/utils/api.js` | 建议同步 |
| **F-4** | 汇总区间查询缺失 | 见 B-2 | 同 B-2 | `summary.js` / `summary.wxml` | 建议同步 |
| **F-5** | Web 端新增演示入口 / 注册入口 / 进化日志 / 权限配置页 | 小程序均无 | 小程序是内部工具，不需要获客与配置能力 | — | 可暂缓 |

### 3.3 UI / 视觉维度

| # | 变更点 | 小程序端现状 | 建议调整方案 | 涉及文件 | 优先级 |
|---|---|---|---|---|---|
| **U-1** | Web 端主色为品牌青 `#06b6d4`（`variables.css`），小程序 `app.json` navigationBar 同为 `#06b6d4` | **一致** ✅ | 无需改动 | — | — |
| **U-2** | Web 端 Rebate/Forecast 新增卡片式入口、状态徽标、达成率着色 | 小程序状态徽标（待审批/已通过/已驳回/已撤回）已自建，风格不同 | 若追求跨端一致，可统一徽标配色与圆角；当前各自可辨，不阻塞 | `mine.wxss`、`approval.wxss` | 可暂缓 |
| **U-3** | 小程序**隐私同意弹窗**（微信平台强制） | Web 端无该弹窗 | 平台要求不同，无需同步；但《隐私保护指引》文本应与 `隐私保护指引.md` 保持一致 | — | 可暂缓 |
| **U-4** | 汇总表在 Web 端为交叉表（门店×商品），小程序为纵向列表 | 形态差异大 | 小程序屏幕小，纵向列表更合适；建议暂不同步 | — | 可暂缓 |

---

## 4. 风险专项

### R1 · 数据结构风险（高）—— `recalled` 未全链路贯通
- **现象**：新增撤回状态后，`erp_db.py` 中 4 处 submission 状态过滤，**仅 13577 / 13585 两处**改为 `NOT IN ('rejected','recalled')`；**12579（期次聚合）与 13592（门店名册）仍为 `s.status != 'rejected'`**。
- **影响范围**：销售在小程序撤回预报单后 → 小程序侧正确消失，但 **Web 端往期预报看板的「已报件数 / 参与门店数」不减少**，门店名册仍含该门店。老板看数据与销售实际操作不一致 → 信任问题。
- **建议**：优先修这两处，并抽成模块级常量（如 `_EXCLUDED_SUBMISSION_STATUS = ("rejected", "recalled")`），避免后续新增查询再次遗漏。
- **是否阻塞提审**：不阻塞（审核员看不到此不一致），但**建议上线前修掉**。

### R2 · 跨端权限耦合风险（中）
- **现象**：Web 端新增「角色权限配置页」(`f8e3f96`)，老板可在界面上改 `role_permissions`。而小程序审批/汇总依赖 **supervisor 角色拥有 `data` 模块权限** —— 该权限目前是**我上一轮手工插库补的**（`role_permissions` 表原本为空，`core.py _DEFAULT_PERMS` 里根本没有 supervisor）。
- **影响范围**：若老板在 Web 端取消了 supervisor 的 `data` 模块 → 小程序审批页 / 汇总页立刻 403；且 `ROLE_PERMS` 在**导入期加载**，需重启才生效，**故障现象会滞后出现，排查困难**。
- **建议**：
  1. **治本**：把 `supervisor` 写进 `core.py` 的 `_DEFAULT_PERMS`（当前只有 admin/boss/accountant/sales/guide/driver/staff）；
  2. **兜底**：小程序捕获 403 时给明确提示「你没有该模块权限，请联系老板在权限配置中开通」，而非显示原始报错。

### R3 · 接口不兼容风险：**低**
- 所有小程序依赖的后端签名变更均为**新增可选参数**（`order_date=""`、`start_date/end_date=""`），**向后兼容**，无破坏性变更。
- 唯一行为变更（期次取不到时硬报错）小程序已通过前置拦截适配。

### R4 · 依赖 Web 独有能力（中）
- `/remind`（催单）、`/save-matrix`（交叉表定稿）、`/forecast/col-schemes`（列方案）均为 **Web 端工作流能力**，后端已具备但小程序未接。
- 若未来要做「移动端定稿 / 移动端催单」，后端已就绪，纯前端工作量。
- **当前建议**：暂缓，等业务需求明确。

### R5 · 演示模式隔离性：**已确认安全**
- `POST /api/auth/demo-login` 返回的是**独立 demo 租户**（`tenants.subdomain='demo'`）的 boss token，与小程序使用的正式账号 (`tenant_id=1`) **租户隔离**，不会串数据。
- 小程序不调用 demo-login，无风险。

---

## 5. 需要你补充确认的内容

以下信息我无法从代码判断，需你决策：

1. **首版小程序是否需要「移动端定稿」？**（即老板在手机上审批后直接定稿，对应后端 `/save-matrix`）。如果只要"通过/驳回"，当前实现已够；若要定稿，需新增前端页面。
2. **汇总页是否需要区间查询？** 当前只能看单日，后端已支持 `start~end`。是按「期次区间」默认展示，还是让用户手选起止？
3. **supervisor 角色该怎么定位？** 目前它是我为了演示审批临时补权限的角色。你真实的组织架构里，审批人是「督导 / 老板 / 文员」中的哪一个？确定后我把它写进 `_DEFAULT_PERMS` 治本。
4. **Web 端「预报列方案」(`forecast_col_schemes`) 是否已上线 UI？** 我只在 `forecast.py:107/121` 找到后端端点，未找到前端调用 —— 若已在用，小程序是否要同步列配置需另行评估。

---

## 6. 结论摘要

- **小程序端对 Web 端核心变更的适配度：良好**。期次规则、门店越权、幂等、`tenant_id`、M7 搜索接口**均已覆盖**，这是本轮排查最重要的正面结论。
- **必须同步的只有 1 项**：撤回状态 `recalled` 未贯通 Web 端期次统计与门店名册（R1 / B-1）。
- **最大隐性风险是 R2（跨端权限耦合）**：supervisor 权限靠手工插库维持，一旦老板在 Web 端权限页改动，小程序会静默失效且故障滞后。
- **不建议同步**：催单、定稿、列方案、演示/注册入口 —— 均属 Web 端定位，小程序作为填报端保持精简更合适。
