# Hergent × 畅捷通 — 步骤 4-7 接入脚本套件

> 本目录是《Hergent×畅捷通-技术可行性探路-2026-08-19.md》步骤 4-7 的可执行落地脚本。
> 你（用户）完成**步骤 1-3 注册+授权**后，本套件让你在拿到 MCP 配置 URL / Key 后**直接跑通**接入与场景验证。

---

## 前置：你需要先完成的（【你】本人）

| 步骤 | 动作 | 备注 |
|------|------|------|
| 1 | 注册 `open.chanjet.com` → 企业认证 | 用你的经销商营业执照/个体户资质 |
| 2 | 创建应用 → 拿 `AppKey` / `AppSecret` | 多客户选"商店应用"，单验证选"自建应用" |
| 3 | MCP 市场生成 `CJTMSP-MCP` 配置 JSON | 勾产品 + 客户 OAuth 授权，复制 **URL** 和 **MCP Key** |
| 5 | 用你的畅捷通账号完成授权 | 使 Hermes 能读真实数据（自托管路线 B 则在 cjt2mcp 录入凭据） |

---

## 步骤 4：注入 MCP 到 Hermes（本套件）

**两条路线任选：**

### 路线 A — 官方 CJTMSP-MCP（最快验证）
```bash
python3 setup_chanjet_mcp.py --route A --name chanjet \
    --url "https://mcphub-admin.static.chanjet.com/<你的路径>/mcp" \
    --env-var CHANJET_MCP_KEY
# 把市场给的 MCP Key 写入 ~/.hermes/.env：
echo 'CHANJET_MCP_KEY=market_给你的_key' >> ~/.hermes/.env
```

### 路线 B — 自托管 cjt2mcp（多租户 / 私有部署）
```bash
python3 setup_chanjet_mcp.py --route B --name chanjet_acme \
    --url "https://mcp.your-host.com/acme/mcp" \
    --env-var CHANJET_MCP_KEY_ACME
echo 'CHANJET_MCP_KEY_ACME=ck_xxx' >> ~/.hermes/.env
```

**常用参数：**
- `--dry-run`：只打印要注入的 YAML 片段，不改文件（先预览）
- `--no-exclude-write-tools`：关闭只读过滤（仅联调用，正式务必保留）
- `--config-path`：指定 config（生产在远程 `/root/.hermes/config.yaml`，需在服务器上跑或 `rsync` 注入）

**注入后：**
```bash
hermes mcp test chanjet        # 测连接
hermes mcp configure chanjet   # 用 include 只放行读工具（更精细）
```

> 安全铁律：密钥只走 `${ENV_VAR}`（读 `~/.hermes/.env`），**绝不**明文写进 config 或贴进聊天。

---

## 步骤 6：验证三类核心数据可读（本套件）

```bash
python3 verify_and_scenario.py verify --server chanjet
```

脚本会依次：
1. `hermes mcp test chanjet` 测连接；
2. 发三条**只读**查询：库存临期 / 应收逾期 / 近 7 天销售单；
3. 打印 Hermes 用畅捷通 MCP 工具返回的真实数据。

✅ 三项都返回真实数据 = 副驾已能读畅捷通。

---

## 步骤 7：跑通低温奶场景（本套件）

```bash
python3 verify_and_scenario.py scenario --server chanjet
```

脚本把低温奶副驾 prompt 发给 Hermes：
> 临期预警（未来 7 天）/ 货损风险估算 / 下趟车预报建议 —— 只分析不擅自下单。

✅ 返回了临期+货损+预报建议 = 配方化算法在真实数据上成立，验证 Hergent 护城河（连接标准化后的**行业决策**价值）。

---

## 文件清单

| 文件 | 作用 |
|------|------|
| `setup_chanjet_mcp.py` | 步骤 4：注入 MCP server 到 Hermes config（支持路线A/B、多租户、只读过滤、dry-run） |
| `verify_and_scenario.py` | 步骤 6 验证 + 步骤 7 场景（subprocess 调 `hermes` CLI） |
| `config.routeA.yaml` | 路线 A 配置片段模板（官方 CJTMCP） |
| `config.routeB.yaml` | 路线 B 配置片段模板（自托管多租户） |
| `README.md` | 本手册 |

---

## 多租户用法（路线 B 推荐）

每个客户 = 一个 `chanjet_<客户>` server 名 + 独立 MCP Key + 独立 env 变量：
```bash
python3 setup_chanjet_mcp.py --route B --name chanjet_acme --url "https://.../acme/mcp" --env-var CHANJET_MCP_KEY_ACME
python3 setup_chanjet_mcp.py --route B --name chanjet_bakery --url "https://.../bakery/mcp" --env-var CHANJET_MCP_KEY_BAKERY
# 验证/场景时指定 --server chanjet_acme
```

---

## 排错

- **mcp test 失败**：检查 URL 是否正确、`.env` 的 Key 是否写入、客户授权是否完成（步骤 5）。
- **工具没出现在对话里**：执行 `hermes mcp test <server>` 或重启 gateway（`hermes gateway restart`）刷新工具缓存。
- **脚本报缺 PyYAML**：脚本会自动用 Hermes venv python 重跑；若仍失败，`pip install pyyaml`。
- **写操作被拦**：正常——`tools.exclude` 默认拦写。确须写时单独 `hermes mcp configure` 放开，但公式化写操作建议走你原有"粘贴模板"降级路径。

---

## 战略提醒（别忘）

连接是标准化的、**谁都能做**，所以"能连畅捷通"本身不是护城河。价值在连上之后用**低温奶配方化算法（货损/返利/预报/工资 skill）**做决策——这是通用 SaaS 不会为单一细分行业定制的。务必保留"导入 Excel/CSV、无 ERP 也能跑"的降级路径，命门不绑死平台。
