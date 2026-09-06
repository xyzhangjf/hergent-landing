# AI 角色 3D 头像恢复 — 完成

## 问题
Hergent 经营副驾（Web）的 AI 角色自定义头像「丢了」：头像原本运行时写入 `/opt/hergent-erp/static/role-avatars/<租户>/<角色>.png`，但该目录**不在 git 仓库**，后端部署脚本 `deploy.sh` 用 `rsync --delete` 扁平覆盖，每次部署都把运行时写入的头像静默删掉。

## 根因
- 头像存于被部署脚本 `--delete` 覆盖的目录 → 上传即丢。
- 本次修复同时把头像目录移出部署目录，从根上避免再丢。

## 处理动作
1. **迁移存储路径**（`server/ai_roles.py`）：新增 `_AVATAR_ROOT = <server父目录>/hergent-data/role-avatars`（线上即 `/opt/hergent-data/role-avatars`），不在 `/opt/hergent-erp` 内，彻底避开 `--delete` 误删。同步更新 `_avatar_dir` 与 `find_role_avatar_fallback`。
2. **还原 `deploy.sh`**：移除无效/有害的 `--exclude='static/role-avatars`（它反而挡掉了本应随仓库下发的文件）。
3. **恢复头像文件**：将 workspace `avatars/` 中对应图复制到 `/opt/hergent-data/role-avatars/1/`（线上）与本地 `~/Documents/hergent-data/role-avatars/1/`，按 Web 副驾 role_id 命名：
   - 经营副驾(copilot) → dami.png
   - 运营主管(ops) → manager.png
   - 会计(accountant) → accountant.png
   - 客服助手(cs) → tutor.png （注：无精确对应，暂用 tutor，可在 RoleManage 随时换）
   - 大秘(secretary) → secretary.png
4. **置位**：`ai_roles` 表全部角色 `custom_avatar=1`（前端仅在 `custom_avatar=1` 时显示图片）。

## 验证
- 构建/部署成功，服务 health HTTP 200。
- 5 个角色头像接口 `GET /api/ai/roles/{role_id}/avatar` 均返回 `200 image/png`。
- 刷新 hergent.cn 打开 AI 经营副驾 / 角色管理 / 能力中心即可看到头像。

## 注意
- 以后无论部署多少次，头像都不会再被清掉（已移出 `/opt/hergent-erp`）。
- 桌面端 `desktop-app`（已冻结）的角色头像不在此范围。
- 如需调整客服助手映射，改 `/opt/hergent-data/role-avatars/1/cs.png` 并在 RoleManage 重新触发即可。
