# Hergent 产品全面审计报告

**审计日期**：2026-08-16
**审计范围**：生产后端、数据库、AI 层（Hermes）、Web 前端、预报小程序、安全、产品闭环
**总体健康度**：**B+（良好）** — 核心系统稳定运行，发现 1 个 P0 已当场修复，若干低风险项待处理

---

## 一、总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 基础设施 | A | 双服务正常、备份机制完善、错误日志干净 |
| 数据健康 | A- | 主库/租户库 integrity ok，历史失败迁移无害 |
| AI 层 | A- | Hermes v0.19.0 稳定，8 技能，curator 待激活 |
| 前端 | A- | 13 路由无死链、API 全匹配 |
| 小程序 | A- | 6 个 API 全部有效 |
| 安全 | A | .env 权限 600、密钥齐全、RBAC 隔离正常 |
| 产品闭环 | B+ | 六大引擎可用，配置项（配方/目标）待实际使用填充 |
| **磁盘** | **C-** | **81% 使用率，备份堆积是主因** |

---

## 二、P0 问题（已当场修复）

### 1. 生产租户库缺预报表 → 小程序填报必崩（已修复 ✅）

**发现**：生产 `tenant_1.db` 没有 `forecast_submissions` / `forecast_submission_items` / `employee_stores` 三张表。根因：v107 迁移只在主库（erp.db）跑，而 `tenant_1` 是 v107 之前创建的旧库，租户库不会自动获得新表（`workflow_registry` 当时做了惰性建表兜底，预报表漏了）。

**影响**：员工在小程序填报预报 → 100% 500 错误。**这是审计最大的价值点——上线前没人真跑过填报流程。**

**修复**（commit `cc0077d`）：新增 `_ensure_forecast_tables()` 惰性建表兜底，应用到全部 7 个预报表函数（create/list/summary/pending/approve/reject/stores）。已在生产触发验证：三表已建，`/api/forecast-submissions/my` 返回 ok。

**经验教训**：以后所有新表都要做**惰性建表兜底**（`_ensure_xxx(db)` + 请求时调用），不能只依赖 init_db 迁移——租户库是 v107 前快照复制的。

---

## 三、发现的问题清单（按优先级）

### P1 — 应尽快处理

| # | 问题 | 详情 | 建议 |
|---|------|------|------|
| 1 | **磁盘 81%（7.4G 剩余）** | backups 1.6G（276 个日备份）、hermes-engine 607M、pre-20260813 tar.gz 388M、hermes.tar.gz 103M、erp.db.bak 18M | 清理旧备份（保留 30 天）+ 删旧 tar.gz（可回收 ~2G） |
| 2 | **Hermes 资金查询工具报错** | 今日日志：`sqlite3.OperationalError: no such column: customer`——Hermes 调资金工具时 SQL 报错（记忆里已记录的 hermes_core.py 资金概况 bug） | 修 hermes_core.py 资金工具 SQL |
| 3 | **curator 从未运行** | run_count=0，AI 自进化技能机制闲置 | 跑一次 `hermes curator run` 验证，或配置 cron |

### P2 — 计划内

| # | 问题 | 详情 | 建议 |
|---|------|------|------|
| 4 | 历史失败迁移 | erp.db 2 条、tenant_1 1 条（v89 老问题 + v107.146 多语句坑） | 无害（均有代码兜底），可清理标记 |
| 5 | workflow_recipes 0 条 | 货损/工资配方没初始化，靠代码默认配方兜底 | 从 UI 保存一次配方即落库 |
| 6 | sales_targets 0 条 | 指标目标未配置 | 等真实使用再配 |
| 7 | AI 留痕仅 2 条 | 预报/审批今天才上线，无真实使用 | 正常，使用后自动积累 |
| 8 | 企微通道未启用 | channel_directory platforms 空 | 按需启用（当前 secret 已失效需重配） |

---

## 四、健康状态明细

### 基础设施
- ✅ `hergent-erp` active、`hermes-gateway` active（运行 5h42m，内存 156M）
- ✅ 每日备份 276 个（tenant_1 最新 20260816，10MB）
- ✅ 2 小时内无后端错误日志
- ⚠️ 磁盘 81%（见 P1-1）

### 数据库
- ✅ erp.db integrity: ok（224 迁移，2 failed 历史无害）
- ✅ tenant_1.db integrity: ok（188 迁移）
- ✅ 数据量：430 商品 / 730 客户 / 580 订单 / 15539 订单项 / 181 应收 / 81 采购单
- ⚠️ tenant_0/2/3/4/7/8 无 _migrations 表（历史库，正常）

### API 健康（核心端点全绿）
- ✅ 六大引擎：预报（forecast/overview）、货损（loss/recipe）、工资（payroll-workflow/recipe）、对账（reconciliation/customers）、返利（rebate-contracts）、指标（sales-targets）全部 200
- ✅ 工作流插件（4 个）、AI 技能（8 个）、员工列表、应收、采购申请全部 200
- ✅ 前端 28 个 API 端点引用全部有效（POST-only 端点用 GET 扫会 404，已甄别为正常）

### 前端
- ✅ 13 个路由 → 13 个页面组件，**零死链**
- ✅ 构建通过（contenthash 自动失效缓存）

### 小程序
- ✅ 20 个文件齐全，JS/JSON 语法校验通过
- ✅ 6 个 API 调用（登录/填报/我的/门店/汇总/商品）后端全部存在
- ✅ 功能闭环：填报 → 我的提交 → 汇总（AI 对比 + 一键复制）

### AI 层
- ✅ Hermes v0.19.0 `/health` ok
- ✅ 8 个技能（4 个行业技能 + 4 个系统技能），技能列表前端可见
- ✅ 记忆/会话系统就绪
- ⚠️ curator 未激活（P1-3）、资金工具 SQL bug（P1-2）

### 安全
- ✅ .env 权限 `-rw-------`（仅 hergent 可读）
- ✅ 密钥 fail-closed（缺 ERP_SECRET 直接拒绝启动）
- ✅ RBAC：admin 通配 / boss 全模块 / staff 最小权限（data/chat/stock）
- ✅ 多租户按库隔离（tenant_N.db）+ 员工-门店绑定（行级范围）
- ✅ 员工账号自动绑租户 + bcrypt 哈希

### 产品闭环（B2B 视角）
- ✅ 六大引擎全可用（其中 4 个有前端工作流页面）
- ✅ 工作流插件化：4 个工作流可开通/停用（分版本定价基础）
- ✅ AI 自进化技能前端可见（prebuilt/generated 分组）
- ✅ 预报小程序闭环：老板开账号 → 员工填报 → 审批 → 转采购 → 汇总 + AI 建议
- ✅ AI 对话框：文件上传（Excel 解析）+ 历史会话（接着聊）
- ✅ 数据补录：员工档案 + 小程序账号/门店管理

---

## 五、建议的下一步（按价值排序）

1. **清理磁盘**（P1-1，立即可做）：保留 30 天备份 → 删旧 tar.gz → 预计回收 2G+，磁盘降到 ~70%
2. **修 Hermes 资金工具 SQL bug**（P1-2）：`no such column: customer` → 修复后"账上还有多少钱"这类问题才准
3. **激活 curator**（P1-3）：跑一次 `hermes curator run --dry-run` 验证自进化技能
4. **真数据跑一轮**：在小程序真实填报 1 单 → 审批 → 转采购，验证全链路（顺便让 AI 留痕积累真实数据）
5. **推 GitHub**：今日 8 个 commit（工作流插件化/文件上传/历史会话/技能展示/预报小程序后端/账号管理/审批流/AI 建议/P0 修复）尚未推送

---

*报告生成：2026-08-16 · 审计方式：生产服务器直查 + 本地代码静态核查 + 接口实测*
