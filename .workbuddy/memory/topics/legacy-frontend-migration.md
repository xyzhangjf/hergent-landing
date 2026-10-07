# 旧前端 / 新前端 定位与迁移判据

## 三个前端（共用同一个后端）
- `erp.hergent.cn` → **旧前端** = hergent-erp 仓库 `static/`（vanilla JS；105 个模块 / 18849 行）
- `hergent.cn` → **新前端** = `hergent-cn-v2`（Vue3 SFC；30 个 `.vue` 页面）
- `hergent.cn/admin/` → `hergent-admin`（base `/admin/`）
三者**共用后端** `/opt/hergent-erp`、**共用库** `erp.db` + `tenant_*.db`。

## 🔴 迁移评估的关键判据
- **旧前端代码依赖全局作用域**：`static/vite.config.js` 的 `exposeTopLevelGlobals` 插件把每个文件「列 0 顶层声明」强行挂回 `window`（否则 ESM 下别处裸调用报 `ReferenceError`）⇒ 与 Vue 的**组件作用域相反**。
- **旧前端渲染 = 字符串拼 HTML + `el.innerHTML`**（见 `wms-console.js`）⇒ 无对应 Vue 写法 ⇒ **页面层必须重画**。
- **可复用三层**：后端接口 100%（路径不变，新前端可直接调）、数据库 100%（零迁移）、业务规则/字段/校验（当**规格书**照抄，不是搬代码）。
- **旧前端调过的进销存接口**（新前端**尚未接**，实测 `grep src/` 为空）：`/api/wms` `/api/procurement` `/api/inbound` `/api/assembly` `/api/batch` `/api/expiry` `/api/wastage` `/api/stock-freezes` `/api/stock-locks` `/api/dunning` `/api/profit-report` …
- 🔴 **禁止 iframe 内嵌旧前端**：旧前端自带完整侧栏 ⇒ 任何能开旧地址的人都能看到进销存 ⇒ **绕过 v380 的 `inventory` 能力闸门**（与老板"只有 boss 可见"冲突）。
- 旧前端侧栏分组（可借鉴）：`经营看板 / 仓库操作 / 财务工具 / 系统工具 / 扩展功能`（`js/core/module-registry.js::GROUP_ORDER`）。

## 迁移路径
**C 保底**（旧前端当自用功能库）+ **B 渐进**（常用页用 Vue 重画、**后端零改动**）；**不用 A**（iframe）。
详见 `docs/erp旧前端功能迁移评估-2026-10-06.md`。
