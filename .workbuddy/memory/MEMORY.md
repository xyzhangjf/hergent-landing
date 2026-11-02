# Hergent 记忆索引（判据首句 + 去哪查；细节一律 `topics/*.md`）

前端 **v735**（Web 包未重建）；**v736 = 小程序+法务页品牌色统一**（2026-11-03），下一版 **v737**（`hergent-cn-v2/src/main.js:71`）。唯一开发源 = `main`。
「改了但用户说没变」先查 `window.__HG_BUILD__` + `html[data-build]`；判产物 `grep -o "v70x" dist/assets/index-*.js`（`mv dist-vNNN dist` 会嵌套 ⇒ 闭包全 200 也能骗过）。
合并/解冲突后**必须** `npm test` + `npm run build`：重复 `export`／重复对象键／整段模板被覆盖 ⇒ **构建不报错**。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（约 5.5k 行，改前必 grep）：入口与门禁唯一源 `pages.js`（未登记=放行）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁 ⇒ `hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度 `psi-list.css`｜副驾 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0 ⇒ `undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`**（直写库会绕过 `reload_perms` + 不留 `audit_logs`），合并语义「未列出=移除」⇒ 必须传**完整清单**。`roles`（`pages.js`）与 `module` 是**两条独立轴**（判据 `_PATH_MODULE_MAP`）。
- **部署** → `topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜**rsync 绝不 `--delete`**｜🔴 根路径 = ERP 前端，`/admin/` = 另一应用（`/admin/assets/x.js` 永远 200 但返回 index.html）。
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`。
- 🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表** ⇒ 按它判得「账面全 0」的假结论。流水 100% 是 `change_type='opening'` ⇒ 判「有没有动过」不能只看流水。

## 🔴 UI 判据（高频；全文 `topics/frontend-ui.md`, v727–v735 在末节）
🔴 **「两边品牌色不一样」先数色值个数，别比色相**（v736）：一个语义位置出现第 2 个色值就是 bug（色相差 3° 并排就看出）。小程序曾三档青并存 `#06b6d4`(白字2.43)/`#0891b2`(压浅青底3.54)/`#0e7490`(5.36) ⇒ 唯一源 `miniprogram/app.wxss` 的 `page{--brand:#0e7490}`，护栏 `.workbuddy/tools/check-miniprogram-brand.mjs`（含 **PNG 逐像素**）。**吃不到 CSS 变量必须同批手改**：`app.json` nav/tabBar、`showModal.confirmColor`、`<switch color>`、**`tab-*-active.png`（颜色烘在像素里）**。logo 渐变 `#0d9488→#06b6d4` 按用户决策**不动**。
🔴 **「字不够黑」先查层级倒挂，不是查某个色值**（v735）：侧栏未选中 5.25 ＞ 已选中 4.96 ⇒ 一屏里没有「深」的锚点，整片都显淡；改一处无用，要抬整条阶梯｜**文字 7:1 / UI 图形 3:1 分档**，只迁 `color`(247) 不碰 border(50)·accent(7)·SVG 描边 —— 一刀切加深边框 = 让边框变粗重｜`--t2`≡`--t3` 同值 ⇒「把 --t3 改成 --t2」是**零变化**，截图与肉眼都看不出｜🔴 改字色必须同批处理两件事：**hover 底**（`--bg` 与侧栏底差 3/255 ⇒ 该处 hover 唯一可见变化就是字色，字一改黑 hover 就没了）和 **`<a>` 下划线**（本仓无全局 `text-decoration:none`，字一压深下划线就显形，深色尤刺眼）｜🔴 **护栏必须接进「全部通过 → exit(0)」那个大 if**，否则违规也不打印直接放行（v735 首版四态对照全「通过」正是此因）。
🔴 **字号归并 ≠ 行高归并**：行高只影响垂直，**字号改宽度** ⇒ 换行/截断/列宽。只收「同值」和「单点」的档｜🔴🔴 **最难发现的债是「同值两个名字」**（`--fs-h2` 20px ≡ `--fs-xl` 20px）：不影响渲染 ⇒ 视觉回归/对比度探针全看不见，用的人只会问「该用哪个」｜护栏查同值不查档位数（`checkFontRamp`）｜`rule.style.fontSize` 读 `var()` 返回**空串**（CSSOM 特性）⇒ 验令牌值走 `getPropertyValue` 或读产物 CSS 文本｜🔴 **改字号的迁移必须同时跑 1440 + 375**（`HG_VW=375`，产物落 `-m375` 目录）—— 字号改的是**宽度**；且「抓到图」≠「进了移动端」⇒ 判 `body.fontSize`=15（桌面 14）为 media 生效的硬证据｜🔴 **一个令牌两个语义**（`--fs-h4` = 四级标题 + 移动端正文）不能机械归一，只能**拆名**；拆完必须加护栏防合回去（`checkMobileBodyOnly`）｜🔴 **文字竖排 ≠ 字体问题**：容器被压到 `width:0` 且 `overflow:visible` 就会逐字换行 ⇒ 先量 `width===0`，再查 `flex-shrink:0` 固定项之和是否已超容器（276 vs 277.8）。
🔴 **间距归一「收大留小」，别反着来**（v734）：判据不是「离不离 4 栅格」，是**这 2px 差人眼看不出看不出**。小间距 2/4/6/8/10/12 在密集区反复出现（`--sp-h6` 637 处里 **gap 占 255**）⇒ 看得出，6→8 等于全站多列容器重排 = 改设计；大间距 14/16/18/20 隔着整块内容 ⇒ 看不出，硬证据是 `--sp-h14` 与 `--sp-4` **同一条规则块共现 31 处**（作者自己也分不出层次）。**方向一律往上取整**（变小挤压 ⇒ 换行/裁切/溢出；变大只是页面变长）。令牌改值会撞契约的「基线自证」（`.card` 18→20 挂掉 `toolbar-density`）—— 那是**好失败**，改 `CARD_BASE` 常量 + 坏样本换成新令牌，别去改断言条件。
🔴🔴 **「用行高当高度」≠ 行距**（`height:15px;line-height:15px` 是垂直居中）。改 flex 三坑：`text-align:center` 对**匿名 flex item 无效**必须换 `justify-content`｜同块有 `text-overflow:ellipsis` 的**不能改**（文本变匿名 flex item ⇒ 省略号消失）｜`<select>` 不吃 `align-items`，`line-height` 是它唯一手段。加 `display:flex` 前必查它原本是否 inline（靠父级 grid/flex 被 blockify 才让 width 生效，普通 inline span 变 flex 会从「按内容宽」变固定宽）｜🔴 **护栏要三态**：命中 / 新增报错 / **冻结数用不满也报错**（只写上限 = 空白支票）。
令牌化最大的阻力是**契约**不是习惯（尺寸契约 `parseFloat` 遇 `var()` 得 NaN ⇒ 换令牌当场挂测试）｜🔴🔴 批量迁移脚本必须与护栏**共用同一套判据**，否则「改错 + 放行」同时发生（徽标 `height:15px;line-height:15px` 被改成 1.4 倍）｜行高令牌必须用**倍数**不用 px，`0`/`normal` 不是「行高为 1」｜护栏必须**双向**，说不清与邻居区别的档位不该存在（`checkLineHeightRamp`）｜缺的不是令牌是「令牌被使用」⇒ **护栏驱动采纳**｜对比度必 **alpha 合成后**算、四种底色全算（含 `--bg4`）、从最外层往内倒序叠｜焦点环别用 `:where()`（基类后加载吃掉 315 处，叠到 (0,2,0)），判焦点必发真 Tab、认 outline｜深色必须单独验，实心强调底+白字一律 `-solid`、文字侧 `-ink`｜亮青 `--p` 只能装饰（2.43）｜AA 下限使三级灰实际只能两级（`--t2`=`--t3`）｜判对齐只量 `Range…getBoundingClientRect()`（盒子差 0 ≠ 对齐），「全 0」先过阳性对照｜表头 sticky 必须有「限高 + overflow-y:auto」父级，**`freeze-page` 本仓不成立**｜`.ico{width/height}` 会压掉 `:size`（SVG 属性优先级最低）｜`:active` 别用 `transform:scale()`（重锚 fixed 浮层）｜判可见性用 `getClientRects()`｜**加载中显示一个结论比空白严重**（初始 `loading=true`、每块独立标志）｜测加载态只延迟 `fetch('/api/…')`，全局限速会假阴性｜骨架载体全站六种，清单先读源码｜状态标签病根是「三套并行」｜端点冻结/加列等 → 见本文件末节与 `impl-and-deploy-criteria`。

## 🔴 探针身份（v729，最易伪造「0 缺陷」）
hash 路由 URL 必须 `https://hergent.cn/#`+path，切换等 **3200ms**。token 过期 ⇒ **全部**页静默回退 `#/workbench`、用户名变「我」；**权限不足 = 只有部分页回退**、用户名正常。`probe_token.py` 旧版硬编码 user 1 = admin，而 `REPORT_VIEWER_ROLES=['boss','supervisor']` ⇒ reports/funds 被静默送回工作台。**boss = user 2**；插入前 `SELECT role` 断言。判通过前必须核对节点数量级与用户名。🔴 **「探针归位」≠「sessions 数量回到 1」**：用户可能同时在别处登录 ⇒ 判据是 `WHERE token LIKE 'sbxui-%'` = 0。抓图报「节点数仅 3 / 全屏差异」先当假差异重抓（v734 两次：白屏 36.89%→12.89%、`allProducts` 未到致按钮按 `v-if` 隐藏 31.38%→16.23%）。

## 🔴 实现 / 部署判据（原文 → `topics/impl-and-deploy-criteria.md`）
加列先吃「名称列」宽度、长文本列 `width+min-width` 同写｜分页条在滚动容器外｜加字段 4 处（`employee_create` 有第三份 `allowed`）｜`ui_col_prefs` 是租户级｜构建 `--emptyOutDir false`，每次 build 全部 hash 都变 ⇒ 走**闭包补传**｜CSS 改完量 `getComputedStyle`｜跨组件覆盖写在目标组件自己文件｜部署必检 `deploy-frontend-closure.py --push`（最后传 index.html）+ curl/cmp 逐字节。
真机验证（`deploy-ops.md`）：生产后端**不是 git 仓**；插 `sessions` 三时间列必须 `datetime('now','localtime')`（UTC 差 8h ⇒ 401）；Bearer 免 CSRF，权限端点要 `X-Tenant-Id`。

## 进度 / 交付锚
P0/P1 全交付；剩促销ROI（端点坏死500）/货架位（零数据）/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）。敏感页必须后端 `_admin` 双保险。

## 主体 / 脱敏 / 本机坑
`hergent-cn-v2`(`laozhangai-product`) + `hergent-erp`(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑 → `topics/local-machine-pitfalls.md`：🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`｜BSD grep 无 `\s`｜`| head -N` 截命中｜`grep -rl` 只搜顶层｜`git commit -m` 含 `{}`/反引号在 zsh 静默失败 ⇒ `git commit -F-`｜统计样式值前先遮罩注释。
