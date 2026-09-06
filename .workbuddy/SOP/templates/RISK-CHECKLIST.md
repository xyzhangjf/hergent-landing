# 风险评估表（5 维 · R0-R4）

> **用途**：任何改动前必走一遍。即便 5 分钟改动也要扫一眼。
> **配套**：`PRD-TEMPLATE.md` + `TECH-TEMPLATE.md`。
> **AI 接到任务时**：必须主动问「风险等级 R0-R4？」，未答则先答本表。

---

## 1. 5 维评估（每维 0-4 分，最高 R4）

| 维度 | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **技术** | 文案/注释 | UI 调样式 | 业务逻辑局部 | 鉴权/支付/利润 | schema 迁移/infra |
| **业务** | 无用户感知 | 内部优化 | 局部流程改 | 多端用户感知 | 商业模式/合规 |
| **数据** | 0 行变动 | 新增非关键列 | 重要列加 | 数据迁移 | 跨库/跨租户 |
| **部署** | 不部署 | 前端单端 | 后端单端 | 多端 | 含 .env/密钥 |
| **回滚** | 即时 | < 5 分钟 | < 30 分钟 | < 2 小时 | > 2 小时 |

---

## 2. 风险等级汇总（取最高维度）

- **R0** —— 全部维度 = 0
- **R1** —— 最高维度 = 1
- **R2** —— 最高维度 = 2
- **R3** —— 最高维度 = 3
- **R4** —— 任一维度 = 4

---

## 3. 必走闸清单（按等级）

| 等级 | 必走闸 |
|---|---|
| **R0** | diff review |
| **R1** | R0 + lint + 视觉冒烟 |
| **R2** | R1 + type + 单元测试 + 端到端冒烟 |
| **R3** | R2 + 集成测试 + 人工场景测 + 时间盒发布 + 回滚预案 |
| **R4** | R3 + 全量演练 + checkpoint 审批 + 维护窗口 + 回滚预演 |

---

## 4. Hergent 特殊维度（必查）

### 4.1 共享 11 接口影响（Hergent 特有）
> 后端有 **11 个被小程序/Web 共用的接口**。改动前必过。

| 接口 | 是否改 | 兼容性 |
|---|---|---|
| /api/forecast/periods | <Y/N> | <兼容/不兼容> |
| /api/forecast/submissions | | |
| /api/auth/login | | |
| /api/auth/me | | |
| /api/inventory/* | | |
| /api/products/* | | |
| /api/customers/* | | |
| /api/suppliers/* | | |
| /api/orders/* | | |
| /api/import/* | | |
| /api/rebate/* | | |

> **改这 11 接口必须带真实登录态测试**，未登录时 401 无法区分「已登记/未登记」。

### 4.2 RBAC 模块登记
> 新路由必须登记 `server.py:_PATH_MODULE_MAP`，否则 fail-closed 403 `MODULE_NOT_CONFIGURED`。

| 新路由 | 模块名 | 登记状态 |
|---|---|---|
| /api/<x>/<y> | <module> | ☐ |

### 4.3 ERP_SECRET 风险
> `_hpw` = bcrypt.hashpw(pw + ERP_SECRET)。改/丢 ERP_SECRET = 全系统密码失效。

- [ ] 本次改动不动 ERP_SECRET
- [ ] 本次改动不动 `_hpw` 字段

### 4.4 safe-delete 防护
> vite build 时清空 `dist/assets` 超过 50 文件会触发 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`。

- [ ] 前端改动：build 前先 `mv dist /tmp/hergent-dist-bak-$(date +%s)`

### 4.5 rsync --delete 陷阱
> 裸 `rsync --delete server/` 会删根目录 .env 致服务挂。

- [ ] 后端改动：用 `deploy.sh`（带 `--exclude='.env'`），不用裸 rsync

### 4.6 Hermes SSE 直连
> 副驾对话前端直连 Hermes SSE（`/hermes/v1/chat/completions`），不经 server.py/hermes_core。

- [ ] 改副驾对话：核查 `hermesChat` + Hermes v0.19.0 SSE 格式（Responses 风格），非 `hermes_core._call_llm`

---

## 5. 数据迁移与备份

### 5.1 是否改库结构？

- [ ] 否 → 跳过本节
- [ ] 是 → 迁移脚本写了吗？
  - [ ] 备份命令：`cp erp.db erp.db.bak-<ts>` + 各 `tenant_*.db.bak-<ts>`
  - [ ] 迁移命令：<具体>
  - [ ] 回滚命令：`mv erp.db.bak-<ts> erp.db`
  - [ ] 验证命令：`sqlite3 erp.db ".schema"` 对比

### 5.2 是否改 .env / 密钥？

- [ ] 否 → 跳过
- [ ] 是 → 备份 `/opt/hergent-erp/.env` + `/root/.hergent-env/.env`
  - [ ] 改前 grep `_extract_token` `_resolve_auth` `_hpw` `SECRET`
  - [ ] 验证：`grep ERP_SECRET /opt/hergent-erp/.env` 确认已生效

---

## 6. 用户影响与回滚

### 6.1 用户影响
- [ ] 单用户
- [ ] 多用户（具体租户）
- [ ] 全量
- [ ] 外部（小程序 / 公众号 / 客户对接）

### 6.2 回滚命令（必填）

```bash
# 前端回滚（dist 备份）
mv /tmp/hergent-dist-bak-<ts> dist && rsync -a ...

# 后端回滚（git + deploy）
cd /Users/zhangjunfeng/Documents/hergent-erp && \
  git checkout <last-good-commit> && bash deploy.sh

# 数据库回滚（备份）
cp /opt/hergent-erp/erp.db.bak-<ts> /opt/hergent-erp/erp.db

# .env 回滚
cp /root/.hergent-env/.env /opt/hergent-erp/.env
```

---

## 7. 紧急联系人 / 工具

- **生产服务器**：`ssh -i ~/.ssh/id_ed25519 root@47.113.224.140`
- **后端日志**：`journalctl -u hergent-erp -f`
- **健康检查**：`curl --noproxy '*' http://127.0.0.1:8700/api/health`
- **前端静态**：`https://hergent.cn/assets/`
- **备份位置**：`/root/.hergent-env/.env`、`/tmp/hergent-dist-bak-*`

---

## 8. 评估结论

| 项 | 答案 |
|---|---|
| **风险等级** | R0 / R1 / R2 / R3 / R4 |
| **必走闸** | <见上表> |
| **是否需要用户确认** | 是 / 否 |
| **是否需要 checkpoint** | 是 / 否 |
| **回滚命令已就绪** | 是 / 否 |
| **是否进 Postmortem 预备** | 是 / 否（仅 R3+） |

---

## 📎 附：评估完成自查

- [ ] 5 维全部填了
- [ ] 等级正确（取最高维度）
- [ ] 必走闸明确
- [ ] Hergent 特殊 6 项全过
- [ ] 数据迁移 + 备份确认
- [ ] 回滚命令可执行
- [ ] 评估结论明确

---

> **风险评估 = 改前的最后一道闸**。填完才能安心写代码。