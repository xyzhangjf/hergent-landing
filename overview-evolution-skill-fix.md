# 进化日志技能区根治（2026-08-19）

## 问题
「能力中心 → 进化日志」Tab 里的**技能库区一直空白不显示**。
根因：后端 `/api/ai/evolution` 的技能库部分直接 `os.walk('/root/.hermes/skills')` 读文件系统。Hermes 会周期性把该目录重置为 `700` 权限，`hergent` 用户读不到 → 返回空 items → 前端 `v-if` 为假 → 整块技能库不渲染。之前用 `chmod` 临时修复，但会被 Hermes 再次重置（复发）。

## 根治方案（前后端双管齐下）
1. **后端** `hergent-erp/server/server.py`（`ai_evolution_log`）：技能库部分改调 `routers.ai_skills._hermes_skills()`（Hermes `/v1/skills` 代理），稳定且带中文描述；Hermes 未连时降级为空、不抛错。
2. **前端** `hergent-cn-v2/src/pages/ConnectCenter.vue`：进化日志技能库区数据源由 `evSkills.items`（文件系统）改为复用 `aiSkills`（页面挂载即加载、`/api/ai/skills` 代理同源），并用 `SKILL_META` 富化（图标 / 中文名 / 能干啥）；统计行改 `aiSkills.length`。**彻底脱离 `/root/.hermes` 依赖**。

## 验证（生产真机）
- 编译：`py_compile` OK；`vite build` OK（63 modules transformed）。
- 接口实测：
  - `/api/ai/evolution` → 技能 `skills_total=8 / items=8`、`curator runs=1`
  - `/api/ai/skills` → 8 个技能
- `systemctl restart hergent-erp` 后 `/api/health` = `200`。

## 部署
- 前端 `dist/` → `/opt/hergent-cn-v2/`（hergent.cn 根）
- 后端 flatten → `/opt/hergent-erp/`（**务必 `--exclude=static`**，否则 rsync 因 static 冲突 exit 23 且 server.py 可能未同步）
- restart `hergent-erp`

## 同类陷阱（铁律）
任何"直读 Hermes 目录"的后端逻辑都会踩权限坑，一律改走 Hermes 代理端点（`/api/ai/skills`）。临时 `chmod` 不可依赖。

## 建议后续
- 进化记录的 `curator runs` 部分仍读 `/root/.hermes/logs/curator` 文件系统，理论上也有权限复发风险；目前数据正常，若后续发现进化记录空白，同样改走代理或持久化到 DB。
