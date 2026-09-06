# 技术方案模板

> **用途**：大改动 / 多端 / 跨接口前必写。PRD 完成后进入。
> **配套**：`PRD-TEMPLATE.md` + `RISK-CHECKLIST.md`。
> **AI 接到大改动任务时**：必须主动问「技术方案写了吗」，未写则先答本模板。

---

## 1. 元数据

| 字段 | 值 |
|---|---|
| **方案 ID** | TECH-YYYYMMDD-<短名> |
| **对应 PRD** | PRD-... |
| **作者** | 张俊峰 + AI |
| **创建日期** | YYYY-MM-DD |
| **风险等级** | R2 / R3 / R4（参考 RISK-CHECKLIST） |

---

## 2. 架构图（手绘 / 文字版均可）

```
┌──────────┐   HTTPS    ┌──────────┐   FastAPI    ┌──────────┐
│ 前端 SPA │───────────▶│  NGINX   │─────────────▶│ 后端    │
│ Vue3+Pinia│   /api/    │ reverse  │              │ hergent-erp│
└──────────┘            │ proxy    │              │ :8700    │
                        └──────────┘              └─────┬────┘
                              │ /hermes/                 │
                              ▼                          ▼
                        ┌──────────┐              ┌──────────┐
                        │ Hermes   │              │ SQLite   │
                        │ :18765   │              │ erp.db  │
                        └──────────┘              │ tenant_*.db│
                                                   └──────────┘
```

---

## 3. 技术选型（必答 5 个）

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 后端框架 | FastAPI / Flask / Django | FastAPI | 已沉淀 |
| 数据库 | SQLite / MariaDB / Redis | SQLite | 一人多租户 |
| 前端框架 | Vue3 / React | Vue3 SFC | 已沉淀 |
| 构建工具 | Vite / Webpack | Vite | vite-landing skill 已落地 |
| LLM | DeepSeek / Qwen / Kimi | deepseek-v4-flash | 生产已 pin |

---

## 4. 接口 / 数据流

### 4.1 新增接口

| 方法 | 路径 | 入参 | 出参 | 鉴权 | RBAC 模块 |
|---|---|---|---|---|---|
| POST | /api/<x>/<y> | {...} | {success,data} | Bearer | <模块名> |

> ⚠️ **新接口必须在 `server.py:_PATH_MODULE_MAP` 登记**，否则 fail-closed 403 `MODULE_NOT_CONFIGURED`。

### 4.2 修改接口

| 方法 | 路径 | 现有行为 | 新行为 | 兼容性 |
|---|---|---|---|---|
| POST | /api/<x> | <旧> | <新> | ⚠️ 必须带登录态测 11 共享接口 |

### 4.3 数据表变更

| 表 | 列 | 类型 | 默认 | 索引 | 备注 |
|---|---|---|---|---|---|
| <table> | <col> | <type> | <default> | idx | <备注> |

> ⚠️ **租户库新列走 erp_db 尾部补丁循环**，不要全表重建。

---

## 5. 复用与依赖

### 5.1 复用现有

- [ ] 组件 / 函数 / Skill：<具体>
- [ ] 数据库视图 / 触发器：<具体>

### 5.2 新增依赖

| 依赖 | 用途 | 是否需要审批（pip/npm 装新包） |
|---|---|---|
| <包名> | <用途> | 否 / 是 |

### 5.3 兼容性分析

| 影响点 | 是否兼容 | 备注 |
|---|---|---|
| 已上线用户数据 | ⚠️ | <迁移？默认值？> |
| 11 个共享接口 | ⚠️ | <哪些接口被影响> |
| 已部署的小程序版本 | ⚠️ | <是否需要发新版> |

---

## 6. 部署与回滚

### 6.1 部署步骤

```bash
# 前端
mv dist /tmp/hergent-dist-bak-$(date +%s)
npm run build && \
rsync -a --no-owner --no-group --delete dist/ \
  root@47.113.224.140:/opt/hergent-cn-v2/ && \
ssh -i ~/.ssh/id_ed25519 root@47.113.224.140 \
  "chown -R hergent:hergent /opt/hergent-cn-v2/"

# 后端
bash /Users/zhangjunfeng/Documents/hergent-erp/deploy.sh

# 小程序
<微信开发者工具上传 + 体验版 + 提审>
```

### 6.2 回滚策略

| 场景 | 回滚命令 | 预计耗时 |
|---|---|---|
| 前端构建失败 | `mv /tmp/hergent-dist-bak-<ts> dist` | 10 秒 |
| 后端服务挂 | `ssh ... "systemctl restart hergent-erp"` + 仓库内 `git reset --hard <last-good-commit>` 重新 deploy | 2 分钟 |
| 数据破坏 | `/root/.hergent-env/.env` 备用 + 备份 `<ts>.db` 恢复 | 5 分钟 |
| 小程序审核失败 | 不影响（线上版本独立） | 0 |

### 6.3 健康检查

```bash
# 后端
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:8700/api/health
# 期望：200

# 前端
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' \
  https://hergent.cn/assets/<main-hash>.js
# 期望：200
```

---

## 7. 测试计划

### 7.1 单元测试

| 函数 / 模块 | 覆盖目标 | 模板 |
|---|---|---|
| <name> | <行覆盖> | `pytest` / `node --test` |

### 7.2 E2E 测试

| 场景 | 工具 | 期望 |
|---|---|---|
| 登录 → 主流程 → 退出 | Playwright + 真机 | 无 pageerror / 业务接口 200 |
| 改单 / 报单 / 审核 | 同上 | 同上 |

### 7.3 兼容性测试

| 浏览器 | 期望 |
|---|---|
| Chrome 121+（用户主力） | ✅ |
| Safari 17+ | ✅ |
| 微信内置 WebView | ✅（小程序 + 公众号） |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| safe-delete 拦截 vite build | 高 | 中 | build 前先 mv 旧 dist |
| rsync --delete 删 .env | 中 | 高 | 用 deploy.sh（带 --exclude='.env'） |
| ERP_SECRET 变更导致密码失效 | 低 | 高 | 改前备份 + 全量重置脚本 |
| 11 接口破坏性 | 中 | 高 | 改前 11 接口逐一过 |
| 用户数据迁移失败 | 中 | 高 | 先 staging + 备份 + 双写 |

---

## 9. 工期估算

| 阶段 | 工作量 |
|---|---|
| 实现 | X 人日 |
| 单测 / E2E | Y 人日 |
| 部署 + 生产验证 | Z 人日 |
| 复盘 | 0.5 人日 |
| **小计** | (X+Y+Z+0.5) × **1.3 buffer** |

---

## 10. 决策记录（关键选择）

> 复杂改动必有选择。每条选择写一行理由。

| 决策 | 选项 A vs B | 选了 | 理由 |
|---|---|---|---|
| 例：登录态校验 | 单 token vs 候选容错 | 候选容错 | 2026-09-05 boss 反复被踢事故 |

---

## 📎 附：方案完成自查

- [ ] 架构图画了
- [ ] 5 个技术选型答了
- [ ] 接口表完整 + RBAC 模块登记
- [ ] 复用与新依赖过完
- [ ] 兼容性分析过完（重点 11 共享接口）
- [ ] 部署 / 回滚 / 健康检查完整
- [ ] 测试计划覆盖
- [ ] 风险表完整
- [ ] 工期 buffer 算好
- [ ] 关键决策留底

---

> **方案完成 = 可以直接照着写代码**。每行都能跑 / 能测 / 能回滚。