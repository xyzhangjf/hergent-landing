# Hergent 记忆索引（判据首句 + 去哪查；细节一律 `topics/*.md`）

前端 **v732**，下一版 **v733**（`hergent-cn-v2/src/main.js:71`）。唯一开发源 = `main`。
「改了但用户说没变」先查 `window.__HG_BUILD__` + `html[data-build]`；判产物 `grep -o "v70x" dist/assets/index-*.js`（`mv dist-vNNN dist` 会嵌套 ⇒ 闭包全 200 也能骗过）。
合并/解冲突后**必须** `npm test` + `npm run build`：重复 `export`／重复对象键／整段模板被覆盖 ⇒ **构建不报错**。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（约 5.5k 行，改前必 grep）：入口与门禁唯一源 `pages.js`（未登记=放行）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁 ⇒ `hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度 `psi-list.css`｜副驾 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0 ⇒ `undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`**（直写库会绕过 `reload_perms` + 不留 `audit_logs`），合并语义「未列出=移除」⇒ 必须传**完整清单**。`roles`（`pages.js`）与 `module` 是**两条独立轴**（判据 `_PATH_MODULE_MAP`）。
- **部署** → `topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜**rsync 绝不 `--delete`**｜🔴 根路径 = ERP 前端，`/admin/` = 另一应用（`/admin/assets/x.js` 永远 200 但返回 index.html）。
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`。
- 🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表** ⇒ 按它判得「账面全 0」的假结论。流水 100% 是 `change_type='opening'` ⇒ 判「有没有动过」不能只看流水。

## 🔴 UI 判据（高频；全文 `topics/frontend-ui.md`，v727–v732 在末节）
🔴 **字号归并 ≠ 行高归并**：行高只影响垂直，**字号改宽度** ⇒ 换行/截断/列宽。只收「同值」和「单点」的档｜🔴🔴 **最难发现的债是「同值两个名字」**（`--fs-h2` 20px ≡ `--fs-xl` 20px）：不影响渲染 ⇒ 视觉回归/对比度探针全看不见，用的人只会问「该用哪个」｜护栏查同值不查档位数（`checkFontRamp`）｜`rule.style.fontSize` 读 `var()` 返回**空串**（CSSOM 特性）⇒ 验令牌值走 `getPropertyValue` 或读产物 CSS 文本｜🔴 **改字号的迁移必须同时跑 1440 + 375**（`HG_VW=375`，产物落 `-m375` 目录）—— 字号改的是**宽度**；且「抓到图」≠「进了移动端」⇒ 判 `body.fontSize`=15（桌面 14）为 media 生效的硬证据｜🔴 **一个令牌两个语义**（`--fs-h4` = 四级标题 + 移动端正文）不能机械归一，只能**拆名**；拆完必须加护栏防合回去（`checkMobileBodyOnly`）。
🔴🔴 **「用行高当高度」≠ 行距**（`height:15px;line-height:15px` 是垂直居中）。改 flex 三坑：`text-align:center` 对**匿名 flex item 无效**必须换 `justify-content`｜同块有 `text-overflow:ellipsis` 的**不能改**（文本变匿名 flex item ⇒ 省略号消失）｜`<select>` 不吃 `align-items`，`line-height` 是它唯一手段。加 `display:flex` 前必查它原本是否 inline（靠父级 grid/flex 被 blockify 才让 width 生效，普通 inline span 变 flex 会从「按内容宽」变固定宽）｜🔴 **护栏要三态**：命中 / 新增报错 / **冻结数用不满也报错**（只写上限 = 空白支票）。
令牌化最大的阻力是**契约**不是习惯（尺寸契约 `parseFloat` 遇 `var()` 得 NaN ⇒ 换令牌当场挂测试）｜🔴🔴 批量迁移脚本必须与护栏**共用同一套判据**，否则「改错 + 放行」同时发生（徽标 `height:15px;line-height:15px` 被改成 1.4 倍）｜行高令牌必须用**倍数**不用 px，`0`/`normal` 不是「行高为 1」｜护栏必须**双向**，说不清与邻居区别的档位不该存在（`checkLineHeightRamp`）｜缺的不是令牌是「令牌被使用」⇒ **护栏驱动采纳**｜对比度必 **alpha 合成后**算、四种底色全算（含 `--bg4`）、从最外层往内倒序叠｜焦点环别用 `:where()`（基类后加载吃掉 315 处，叠到 (0,2,0)），判焦点必发真 Tab、认 outline｜深色必须单独验，实心强调底+白字一律 `-solid`、文字侧 `-ink`｜亮青 `--p` 只能装饰（2.43）｜AA 下限使三级灰实际只能两级（`--t2`=`--t3`）｜判对齐只量 `Range…getBoundingClientRect()`（盒子差 0 ≠ 对齐），「全 0」先过阳性对照｜表头 sticky 必须有「限高 + overflow-y:auto」父级，**`freeze-page` 本仓不成立**｜`.ico{width/height}` 会压掉 `:size`（SVG 属性优先级最低）｜`:active` 别用 `transform:scale()`（重锚 fixed 浮层）｜判可见性用 `getClientRects()`｜**加载中显示一个结论比空白严重**（初始 `loading=true`、每块独立标志）｜测加载态只延迟 `fetch('/api/…')`，全局限速会假阴性｜骨架载体全站六种，清单先读源码｜状态标签病根是「三套并行」｜端点冻结/加列等 → 见本文件末节与 `impl-and-deploy-criteria`。

## 🔴 探针身份（v729，最易伪造「0 缺陷」）
hash 路由 URL 必须 `https://hergent.cn/#`+path，切换等 **3200ms**。token 过期 ⇒ **全部**页静默回退 `#/workbench`、用户名变「我」；**权限不足 = 只有部分页回退**、用户名正常。`probe_token.py` 旧版硬编码 user 1 = admin，而 `REPORT_VIEWER_ROLES=['boss','supervisor']` ⇒ reports/funds 被静默送回工作台。**boss = user 2**；插入前 `SELECT role` 断言。判通过前必须核对节点数量级与用户名。

## 🔴 实现 / 部署判据（原文 → `topics/impl-and-deploy-criteria.md`）
加列先吃「名称列」宽度、长文本列 `width+min-width` 同写｜分页条在滚动容器外｜加字段 4 处（`employee_create` 有第三份 `allowed`）｜`ui_col_prefs` 是租户级｜构建 `--emptyOutDir false`，每次 build 全部 hash 都变 ⇒ 走**闭包补传**｜CSS 改完量 `getComputedStyle`｜跨组件覆盖写在目标组件自己文件｜部署必检 `deploy-frontend-closure.py --push`（最后传 index.html）+ curl/cmp 逐字节。
真机验证（`deploy-ops.md`）：生产后端**不是 git 仓**；插 `sessions` 三时间列必须 `datetime('now','localtime')`（UTC 差 8h ⇒ 401）；Bearer 免 CSRF，权限端点要 `X-Tenant-Id`。

## 进度 / 交付锚
P0/P1 全交付；剩促销ROI（端点坏死500）/货架位（零数据）/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）。敏感页必须后端 `_admin` 双保险。

## 主体 / 脱敏 / 本机坑
`hergent-cn-v2`(`laozhangai-product`) + `hergent-erp`(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑 → `topics/local-machine-pitfalls.md`：🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`｜BSD grep 无 `\s`｜`| head -N` 截命中｜`grep -rl` 只搜顶层｜`git commit -m` 含 `{}`/反引号在 zsh 静默失败 ⇒ `git commit -F-`｜统计样式值前先遮罩注释。
