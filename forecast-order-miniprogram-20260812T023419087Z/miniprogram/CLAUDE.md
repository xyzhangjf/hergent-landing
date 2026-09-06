# CLAUDE.md — Hergent 微信小程序（forecast-order-miniprogram）

> AI 在改这个仓库前必读。**接新任务前先看「铁律」段，再看 MEMORY.md，再 grep 现有代码**。
> 配套：`laozhangai-product/.workbuddy/SOP/PRODUCT-DEVELOPMENT-SOP.md`（产品级 SOP）。

---

## 一句话定位

**企业内部订货工具**（销售/主管使用，不对外），替代现行手工 forecast-order 流程。
多租户多角色（sales / supervisor），绑 Hergent 后端生产环境，**与 Web 端共享 11 个接口**。

---

## 铁律（改前必读，违反 = 必然事故）

### 1. 必须绑 Hergent 后端生产环境
- 生产域：`https://hergent.cn/api/...`
- 配置：`utils/` 里的 baseURL（避免硬编码）
- 后端 11 个共享接口被 Web + 小程序共用 → 改动必须避免破坏性（后端 CLAUDE.md 详）

### 2. 类目选「工具→效率」免食品证
- 主体公司（湖北省小赫智体数字科技）经营范围**无食品/乳制品**
- 不能选电商 / 商家自营 → 触发食品证 + 商家自营审核
- 名称可带"AI"（"效率"类目允许）

### 3. 微信小程序基础配置必查
| 配置项 | 值 | 影响 |
|---|---|---|
| appid | **真实账号 appid**（非 touristappid） | 必须 |
| request 合法域名 | hergent.cn / *.hergent.cn | 必须配否则线上 wx.request 失败 |
| 隐私指引 | 必须勾选剪切板权限（wx.setClipboardData） | 否则报单复制粘贴失败 |
| 类目 | 工具 → 效率 | 免食品证 |

### 4. 角色与测试账号（提审用）
| 角色 | 测试账号 | 密码 | 绑定门店 |
|---|---|---|---|
| sales | `mptest` | `Mptest@1` | 永诺旗舰店 |
| supervisor | `mptestsp` | `Mpsup@1` | 永诺旗舰店 |

> 提审前必须确保这 2 个账号可用，且能在体验版登录 + 走通主流程。

### 5. tabBar 静态限制
- 微信原生 tabBar **无法按角色隐藏**
- 角色相关入口迁到 `mine` 页（个人中心门控）
- 汇总总表入口（supervisor 专属）走 `mine` 页 + 审批门控

### 6. 角色与权限（supervisor 默认无权限！）
- 后端 `_DEFAULT_PERMS` **没有 supervisor**（历史 bug）
- 已手工插库 + 导入期加载，但**老板在 Web 端改权限后必须重启才生效**
- 治本：写进 `_DEFAULT_PERMS` 并迁移全部租户库

### 7. 期次接口必查（业务节奏）
- 2 天到货、提前 4 天下单节奏
- 期次接口返回的 `status='open'` 必须**今天** ∈ `order_start ~ order_end`
- 新建期次**双写旧列** `order_start_date/order_end_date` **与新列** `order_start/order_end`

### 8. 门店/员工数据在租户库
- `employee_stores` 在**租户库**（非主库）
- 用 `get_db()` JOIN `contacts` 表（type IN 'customer'/'both' AND is_active=1）
- 绑门店时插入 `tenant_*.db`
- 没有 `employees` 表，`employee_id` 是自由号**非外键**

### 9. 租户上下文传递
- 头 `X-Tenant-Id`（首选）或 cookie `hergent_tenant`
- 后端中间件优先级：头 > cookie > token 推导（fail-closed）

---

## 项目结构

```
forecast-order-miniprogram-20260812T023419087Z/miniprogram/
├── app.js                    # 入口
├── app.json                  # 全局配置（tabBar/页面注册/隐私指引）
├── project.config.json       # 微信开发者工具配置
├── sitemap.json              # SEO（小程序意义不大）
├── pages/                    # 业务页面
│   ├── index/                # 首页（报单）
│   ├── orders/               # 订单列表
│   ├── product/              # 商品选择
│   └── mine/                 # 个人中心（角色门控入口）
└── utils/                    # 工具（API 封装、baseURL、token 管理）
```

---

## 与后端契约（速查）

| 接口 | 用途 | 必填字段 |
|---|---|---|
| `/api/auth/login` | 登录 | username, password |
| `/api/auth/me` | 当前用户 | Bearer |
| `/api/forecast/periods?status=open` | 当前期次 | Bearer |
| `/api/forecast/products` | 商品列表 | Bearer |
| `/api/forecast/submissions` | 报单提交 | Bearer + body |
| `/api/forecast/submissions/list` | 报单列表 | Bearer |
| `/api/orders/customer-stores` | 当前员工门店 | Bearer |
| `/api/inventory/stock` | 库存查询 | Bearer |
| `/api/products/search` | 商品搜索 | Bearer + q |
| `/api/import/template/<tid>` | 导入模板下载 | Bearer |
| `/api/rebate/achievements` | 返利达成 | Bearer |

---

## ❌ 禁止

1. ❌ 不绑生产 Hergent 后端（不能用 mock 或 staging 跑线上）
2. ❌ 选电商/商家自营类目（触发食品证审核）
3. ❌ 用 touristappid 上体验版（被微信拒）
4. ❌ 不配合法域名（线上 wx.request 直接 fail）
5. ❌ 不勾选剪切板权限（报单复制粘贴功能失效）
6. ❌ tabBar 直接挂角色专属入口（静态无法隐藏）
7. ❌ 改 Web 端权限后未重启就上线（supervisor 默认无权限）
8. ❌ 直接 JOIN 主库 contacts（跨租户隔离破坏）

---

## 🔗 关联文档

- `laozhangai-product/HANDOFF.md` —— 全产品现状
- `laozhangai-product/forecast-miniprogram-input-contract.md` —— 小程序入参契约
- `laozhangai-product/forecast-miniprogram-approval-contract.md` —— 审批流契约
- `laozhangai-product/.workbuddy/memory/MEMORY.md` —— 跨仓库长期记忆
- `hergent-erp/CLAUDE.md` —— 后端铁律（共享 11 接口定义在那边）

---

> **改前 grep** MEMORY.md + CLAUDE.md + 现存代码 → **改中真机跑** → **改后体验版验证 + commit + memory**