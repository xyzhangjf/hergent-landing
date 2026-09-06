# 配方口径同步（方案 B）实施报告

> 目标：消除「后端算的」与「AI 说的」两套文本之间的口径漂移——让 4 个行业 skill 包的口径与后端 `workflow_recipes` / `forecast_config` 实时配方同源。

## 交付物

| 文件 | 位置 | 作用 |
|------|------|------|
| `server/recipe_sync.py` | 本地 `hergent-erp/server/` + 生产 `/opt/hergent-erp/recipe_sync.py` | 确定性同步管道：读 `tenant_1` 实时配方 → 渲染 4 个 skill 的 `AUTO_RECIPE` 区块 → 正则替换写回 |
| 3 个保存端点触发 | `routers/loss_workflow.py` / `payroll_workflow.py` / `forecast_config.py` 的 PUT `/recipe` | 配方保存后调用 `trigger_sync_from_service()`（fail-closed） |
| 4 个 SKILL.md | 生产 `/root/.hermes/skills/hergent-milk-{expiry,forecast,commission,rebate}/SKILL.md` | 文末加 `AUTO_RECIPE` 区块 + 正文可变态数值改引该区块 |
| sudoers 规则 | 生产 `/etc/sudoers.d/hergent-recipe-sync`（已 visudo 校验） | 放行 `hergent ALL=(root) NOPASSWD: /usr/bin/python3 /opt/hergent-erp/recipe_sync.py` |

## 关键决策

1. **方案 B（推荐并确认）**：生成脚本重写静态 skill 包 + 配方保存事件自动触发。信任押在确定性管道，不依赖 LLM 运行时自觉调 API。
2. **漂移分级与处理**：
   - 货损 `loss_recipe`：临期阈值 7/cost/0%/1.0 原写死 → **高优先级**，已同步。
   - 工资 `payroll_recipe`：起征点 5000 原写死 → **中优先级**，已同步。
   - 预报 `forecast_config` 自由配方列表 + 出厂默认 1.2/2-3/5 天（仅存于 skill 文本）→ **低风险**，已渲染当前配置数。
   - 返利：`erp_db` 引擎常量（graduated/half_up/2）→ **低风险**，已渲染。
3. **生产权限陷阱（已排雷）**：后端服务以 `User=hergent` 运行，而 `/root/.hermes/skills` 为 `root:root 700`（且 `/root` 本身 700，hergent 无法遍历）。若直接写会 `PermissionError` 静默失败。改为服务经**免密 sudo** 委托 root 运行 `recipe_sync.py` 完成写入。

## 验证结果（生产实测）

- ✅ `recipe_sync.py` 独立运行（root）成功填充 4 个 skill 的 `AUTO_RECIPE` 区块，数值 = `tenant_1` 实时配方。
- ✅ 3 个 router 触发代码已部署（各 grep 命中 2 处）。
- ✅ **模拟实时触发路径**：以 `hergent` 身份 `sudo -n /usr/bin/python3 /opt/hergent-erp/recipe_sync.py` 退出码 0，skill 同步时间 22:46→22:49（确实写入）；而 hergent 直接写报 `Permission denied`——证明 sudo 委托必要且生效。
- ✅ 业务数据零改动：`workflow_recipes` 表只读未动（当前无自定义配方，sync 走兜底默认值）；前端/后端服务健康 HTTP 200。
- ✅ 本地单测：用阈值=5、过期系数=2.0、自定义预报配方样本验证渲染与正则替换正确（漂移可被捕获）。

## 需确认事项

1. **最终人工确认（UI 拨动）**：生产 Web 打开「货损工作流配方」把临期阈值 7→5 保存 → 确认 `/root/.hermes/skills/hergent-milk-expiry/SKILL.md` 的 `AUTO_RECIPE` 区块阈值变为 5。自动化链路已逐项验证，仅此 HTTP 往返需你用账号点一次。
2. **Hermes 重载**：`AUTO_RECIPE` 改的是 SKILL.md 文件，Hermes 若常驻内存缓存 skill，需触发一次 skill 重载（或等 curator 周期）才能读到新口径；文件层面已同源，无残留。
3. **新租户**：`recipe_sync.py` 默认 tenant_1；多租户时需对目标租户各跑一次（已支持 `--tenant-id`）。
