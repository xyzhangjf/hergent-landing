# Hergent 桌面端（hergent.cn）Bug 审核报告

- **日期**：2026-08-11
- **审核对象**：`desktop-app/`（Electron 主程序 + 渲染层 + 本地 Python 后端 `server.py`）
- **方法**：静态代码审查——语法检查（node --check）+ 关键链路走读（启动/聊天/定时任务/ERP/支付）
- **一句话结论**：**原型/自用级别能跑，但距离"卖给别的经销商"还差关键一关——付费闭环不能被绕过 + 界面要容错。** 已发现 1 个致命级安全漏洞 + 4 个会直接影响客户体验/稳定的严重问题。

---

## 总评

| 维度 | 结论 |
|---|---|
| 语法 | ✅ 干净（main.js / preload.js / js/app.js 均通过 `node --check`） |
| Electron 安全基线 | ✅ 达标（contextIsolation 开、nodeIntegration 关、webSecurity 开，配置在 `src/main/window.js`） |
| 功能广度 | ✅ 宽（ERP 增删改查 + AI 对话 + 定时任务 + 多通道 + 支付/积分脚手架都齐） |
| 付费安全 | 🔴 致命漏洞 |
| 界面容错 | 🟠 几乎为零 |
| 核心工具确定性 | 🟠 目前靠"让 AI 猜" |

---

## 🔴 致命（卖之前必须修）

### 1. 支付/充值可被免费绕过（免单后门）
- **位置**：`server/server.py` 第 762–776 行 `dev_pay()`
- **现象**：本地后端 `http://localhost:8765/api/payment/dev-pay` 接收 `device_id` + `amount`，**没有任何鉴权、没有"仅开发环境"开关、没有签名校验**，直接给该设备加积分（1 元 = 100 积分）。
- **更危险**：第 682–704 行 `get_payment_url()`（生成充值链接的接口）在支付宝未启用时，返回的"充值链接"本身指向 `https://api.hergent.cn/api/payment/dev-pay`（并标注 `dev_mode: True`）。也就是说——**只要没配支付宝，点"充值"等于点"免费领积分"**。
- **桌面端还主动暴露这条路**：`preload.js` 把 `devPay` 暴露给前端，`main.js:2055` 直接调用该端点。
- **后果**：任何一个会开浏览器开发者工具的客户，都能给自己充无限积分。对一款要收费的产品，这是硬伤；若 `api.hergent.cn` 跑的是同一份代码且公网可达，则公网也能被刷积分。
- **修复方向**：`dev_pay` 必须仅在显式 dev 标志 + 服务端密钥下可用；生产环境删除该端点或对入参做签名校验；充值链接永远走真实支付闭环（支付宝/微信）。
- **✅ 已于 2026-08-11 修复（见文末《修复记录》）**：引入 `HERGENT_ENV` 环境变量（默认 `production`），`dev_pay` 端点在非开发环境一律 `403`；`get_payment_url` 支付宝未启用时不再回退免单链接、改为返回明确错误；桌面端移除 `devPay` 桥接与免单调用，IPC 兜底拒绝。

---

## 🟠 严重（影响客户日常使用/稳定）

### 2. ERP 全部界面零容错 → 后端一抽风就白屏
- **位置**：`js/erp.js`（全文件 **0 个 try/catch`），`erpFetch()` 直接 `return res.json()` 且不判断 HTTP 状态码。
- **现象**：库存/账单/客户等标签页，只要后端没起、返回 500、或返回非 JSON，整页渲染就抛未捕获异常 → **白屏/卡死且没有任何错误提示**。
- **后果**：客户机器上后台进程偶尔没起来（很常见），点开 ERP 就是一片空白，会以为软件坏了、要退款。
- **修复**：`erpFetch` 加状态码判断 + try/catch；渲染层 catch 后显示"数据加载失败，请重试"。

### 3. 四个核心工具（预报/货损/对账/工资）不是"计算"，是"让 AI 猜"
- **位置**：`main.js` 第 809–829 行 `cron:create`
- **现象**：你最在意的"预报订单/算货损/对账/算工资"，在桌面端其实只是几个定时任务的**提示词模板**（如"对账银行流水，结果推送到飞书"），交给大模型自由发挥，**并未调用确定性的 ERP 引擎函数**。
- **背景**：`forecast_engine` / `run_payroll` / `check_expiry` / `match_bank_statement` 这些确定性引擎在 hergent-erp 里已经写好了，但**桌面端没接**，只把 LLM 当计算器。
- **后果**：① 结果不保证正确、不可复现（"算工资"算错是责任问题）；② 必须连上飞书才能看到结果，App 内不展示；③ 依赖大模型，慢且贵。
- **修复**：直接调用后端已存在的确定性引擎接口，把结果结构化回显到 App；AI 只做"解释"，不做"计算"。

### 4. ERP 搜索框在 4/5 的标签页失效
- **位置**：`js/erp.js` 第 254/387/457/538 行 + `filterErpList` 第 596 行
- **现象**：只有"销售"标签页的列表带 `id="erpSaleList"`；采购/库存/客户/账单四个标签页的列表**根本没有 id**；而 `filterErpList` 按 `erp${类型}List` 拼 id 去查。结果：在这四个页打字搜索**毫无反应**。
- **修复**：给四个列表补上正确 id（`erpPurchaseList` / `erpInventoryList` / `erpContactsList` / `erpBillsList`）。

### 5. 命令拼接 + 文本解析脆，且存在命令注入隐患
- **位置**：`main.js` `cron:create`(822) / `channels:save`(899) / `cron:list`(780)
- **现象**：用字符串拼接 shell 命令（如 `hermesCLI(\`cron create "${schedule}" ...\`)`），`schedule` 未做转义直接套进双引号；`cron:list` 用正则解析 Hermes CLI 的文本输出；聊天回复靠识别"╰─"等制表符来提取。
- **后果**：① 用户输入含特殊字符可能注入命令；② Hermes 双周大版本一改 CLI 输出格式，定时任务列表/聊天回复就会**静默失效**（你之前就担心过 Hermes 升级会断）。
- **修复**：改用参数数组调子进程（不用 shell 字符串）；cron 走结构化数据而非文本解析。

---

## 🟡 建议改进（不急但值得做）

- **模型名硬编码 `deepseek-v4-flash`**（`main.js` 多处）。确认这是真实可用模型名 / 可在配置里改；若写错，网关聊天路径会全部失败。
- **`GATEWAY_API_KEY` 每次启动 `randomBytes` 重新生成**（`main.js:29`）。若网关依赖稳定 key 维持已连接的飞书/企微会话，每次重启 App 可能要重新配对，需验证。
- **大量 `.bak` / `.bak-phase1` / `app.asar.old` 临时文件**散落（main.js、js/app.js、server.py 都有）。不打包进成品，但说明没有版本控制纪律，后期维护/排查极危险。建议清理并接入 Git。
- **`sandbox: false`** 当前配合 contextIsolation 是可接受的，非紧急。

---

## 结论与下一步

- 这款产品**原型/自用级别是能跑的**，但卖出去前必须过两关：**付费不能被绕过**（#1）+ **界面要容错**（#2）。
- 你之前定调"聚焦 AI 小工具（预报/货损/对账/工资）"，但 #3 说明这些工具目前只是"提示词"，要变成真工具必须接确定性引擎——这正好印证了前面几轮的结论：**别让 AI 算账，让 AI 解释账**。
- 最高优先级：立刻修 #1（免单后门）和 #2（白屏容错）——这两个不修，卖出去第一天就会被钻空子或投诉"打不开"。

**可以马上动手的三件事（你挑一个）：**
1. 修掉 #1 免单后门（给 `dev_pay` 加环境锁 + 签名，前端移除 `devPay`）；
2. 给 `erp.js` 加全局容错（状态码判断 + 错误提示）；
3. 把四个工具接到确定性引擎并回显到 App（不再只靠 LLM 提示词）。

---

## 修复记录 #1 免单后门（2026-08-11）

**原则：纵深防御**——后端锁死（覆盖所有端）+ 前端移除调用 + IPC 兜底拒绝，任何一层漏了其他层也兜住。

### 后端 `server/server.py`（最关键，覆盖桌面端 + Web 端 + 任何客户端）
1. **新增环境开关**（在 `ALIPAY_ENABLED` 定义之后）：
   ```python
   HERGENT_ENV = os.environ.get("HERGENT_ENV", "production").strip().lower()
   DEV_MODE_ALLOWED = (HERGENT_ENV == "development")
   ```
   生产环境默认 `DEV_MODE_ALLOWED = False`，启动时打印 `[SECURITY] dev-pay（免单充值）在生产环境已禁用。`
2. **`dev_pay()` 端点首行加锁**：非开发环境直接 `raise HTTPException(403, "dev-pay 已禁用")`，不执行任何加积分逻辑。
3. **`get_payment_url()` 不再回退免单链接**：支付宝未启用时，不再生成指向 `https://api.hergent.cn/api/payment/dev-pay` 的链接，改为返回
   `{"success": False, "error": "支付网关尚未启用，暂不支持在线充值，请联系管理员开通", "dev_mode": False}`。前端据此显示提示而非免单。

### 前端 `desktop-app/`（纵深防御：即便后端漏锁也不会免单）
4. `main.js` 的 `payment:dev-pay` IPC handler：直接返回 `{ success: False, error: "DEV充值通道已关闭" }`，不再请求后端（兜底）。
5. `src/renderer/payment.js` 两处免单分支（① `createPayment` 回调里的 `result.dev_mode` 分支；② `openPaymentInBrowser` 里的 `indexOf('dev-pay')` 分支）：移除 `hermes.devPay(...)` 调用，改为"提示不支持 / 该方式不可用"。
6. `preload.js` 移除 `devPay` 桥接；`src/types.d.ts` 移除 `devPay` 类型声明。

### 验证
- `python3 -m py_compile server/server.py` ✅ 通过
- `node --check main.js / preload.js / src/renderer/payment.js` ✅ 全部通过
- 功能性免单调用（`hermes.devPay` / POST dev-pay）仅残留在 `.bak` / `backups/` / `.pre-feishu` 等**不参与构建**的备份文件中，活跃代码已干净。

### 部署注意（重要）
- **生产环境切勿设置 `HERGENT_ENV=development`**，否则免单后门重新打开。
- 本地开发自测充值：临时设 `HERGENT_ENV=development` 启动 `server.py` 即可恢复 dev-pay（仅限本地）。
