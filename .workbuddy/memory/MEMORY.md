# Hergent 记忆索引（只留判据首句＋去哪查）

> 🔴 **完整原文一字未删**存档：`topics/memory-index-full-2026-11-06.md`（含全部实测数字、版本线、坏样本细节）。
> 本文件按既有惯例（同 `topics/impl-and-deploy-criteria.md`）压缩为索引；**查细节先搜这两份，再按域指针进 `topics/*.md` / `memory/YYYY-MM-DD.md`**。

**版本**：v785 粘贴严格 N 行全覆盖（**已部署 2026-11-06**，commit `01ce394b`）｜v784 品牌筛选藏行（已部署、**归因后被推翻**）｜v783 空白/0 覆盖清空、v781 纯数字列静默错误（已部署）｜v780 日期文案改短（小程序已上传待发布）｜v779 拦截层读「可提前天数」、v776 外部账号定向催单、v775 拆兜底 event_key、v773→v774 导购受众（后端已上线）｜v778 数量单位不折行、v777 去规格显示（小程序代码已改**未发版**）｜v772 横幅本期清单｜v771 到货日期｜v769 返利率可留空｜v768 GoLink/useGoPage。**小程序 v758–v780 已上传微信平台开发版、待审核发布**。唯一源 `main`。→ `memory/2026-11-05.md` / `2026-11-06.md`

## 🔴🔴 最高频硬判据（每条只留判据首句）
- **「99 行只进 76 行」不是藏行，是写入层三处过滤**（v785）：`onPaste` filter 删空白行、`parseTSV` 尾部 pop、`pasteRegion` 按 `maxWriteR` 撑行 + clears 越界跳过。**后端删旧建新且 `qty_by_unit` 只发已存在的 key ⇒ 那格从未被 `writeCellVal` 触达，旧值 12 就永远留库 ⇒ 修复必须在前端写入层。**
- **严格 N 行全覆盖**：`parseTSV` 一行不删（Excel 末行空白时文本以 `\n` 结尾）、`onPaste` 不 filter 不 pop、`pasteRegion` 补行 `sr + rows` + 全块最大列数 + clears 逐格无越界守卫；`tryPasteCross` 按名寻址 ⇒ 空白行**只报数不按位置盲清**（盲清误伤别的商品）。
- **口径变了必须反转旧坏样本/旧判据**（v780/v785）：v783 ㊱·c「尾行空白不撑行」已被用户推翻；㊱·d 抽真实函数体注入桩实跑 + 三组坏样本自证；静态判据一律**剥注释**（注释抄旧代码会自撞空白支票）。
- **同一个「能不能报」不许写两份口径**（v779）：统一 `window_hit(order_end, ws, early)`；弹窗日期只认真实期次表 `next_period_date`，日历推算已废弃；`SELECT *` 取后加列。
- **`run-all.mjs` 不自动扫描**：每个 `*.contract.mjs` 必须显式 `run()`，否则永不执行却 ALL PASS（连踩三轮）；每条要 runner 注册＋坏样本自证＋对照组全绿；防三种空白支票（正则抽空集／只查唯一不查存在／只写上限，**必须三态**）。
- **探针身份**（v729/v770 两次）：token 过期 ⇒ 全部页静默回 `#/workbench` ⇒ 每页量到同一屏＝完美假绿 ⇒ 每页第一条断言必须是身份自检；读生产租户配置先进租户上下文，先打印 `[DB] SQLite engine` 核对文件。
- **中文标签进 flex 行 ⇒ 改文案＝改断行点**（v770/v780/v778）：`nowrap` 与容器 `flex-wrap:wrap` 兜底缺一不可；「数值+单位」两层保险（绑定不留空格 + `.it-qty{white-space:nowrap}`）；量行数用 `Range.getClientRects()`，**别用元素高度÷行高**。
- **「去掉某字段显示」≠「删数据层」**（v777）：`copyRecord` 的 `spec` 仍要带回填报页，不许全仓替换。
- **「保存了又变回原值」＝`|| undefined` 丢键** ⇒ 三道闸门同时放行、toast 照样「已保存」；判据是「界面能不能把它删空」。
- **`<GoLink>` ≠ `useGoPage`**（v768）：判据＝点完人还在不在这一页；实例名不能叫 `goPage`（8 页里是分页函数）。`api()` 第二参是 options 对象不是 method（写 `'PUT'` ⇒ 兜底 GET、拿到旧值却弹「已启用」）。
- **新增展示字段先问「前端拿不拿得到全量」**（v771）：`/open-periods` 只返未关闭期次（24 期里 23 期 closed）⇒ 必须服务端批量补。
- 其余逐条判据（通知受众 v773–v776、返利率留空 v769、扫码 v761、撤回 v758、zoom v745、列拖拽、品牌色/排版令牌、副驾 403、角色权限端点）**见上方完整原文存档**。

## 🔴🔴 部署（全文 `topics/deploy-ops.md`）
`deploy-frontend-closure.py --push` 只补 assets ⇒ 三步：`--push`→验闭包全 200→`rsync dist/index.html`（绝不 `--delete`，远端先 `cp -a`）。验产物**必须从线上 curl 回来 grep**：判新旧看**入口 JS 引用哪一份**；「改了没变」先查 `window.__HG_BUILD__`＋`html[data-build]`。
FLAT：后端 `/opt/hergent-erp/`（非 git 仓，靠 `.workbuddy/remote-erp/` 回拉镜像）｜前端 `/opt/hergent-cn-v2/`（index.html 在根）｜**ERP 前端域名＝`hergent.cn`**（`erp.hergent.cn` 是另一个应用，curl 错域名得「404＝没传上去」假结论）。后端单文件：`cp -a`→`scp`→`chown`→双侧 `md5sum`→restart→**等 8~10 秒**。`vite build` 十几分钟零输出＝安全删除护栏拦住清 `dist/assets`。

## 🔴 路由（硬判据）
- **前端** → `topics/frontend-ui.md`（改前必 grep）：门禁唯一源 `pages.js`（未登记＝放行）｜`permView.js` 唯一源、`module:null`＝只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜`⌘K`/`⌘⇧K` 已占用⇒新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效＝恒空恒 0｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。改角色权限必须走 `POST /api/role-permissions`（「未列出＝移除」⇒ 传完整清单）。
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`｜通知 `notification-center`。

## 实现 / 进度 / 主体 / 本机
实现细则 → `topics/impl-and-deploy-criteria.md`。进度：P0/P1 全交付；剩促销 ROI（端点 500）/货架位（零数据）/现金流预测页面化；**卖前三关未过、调拨单生产仍 0 张**；BI 唯一源 `erp_db.py:_BI_MEASURES`；敏感页后端 `_admin` 双保险。主体＝`hergent-cn-v2` + `hergent-erp`(FastAPI+SQLite)；脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑：🔴 `grep "A\|B"` 静默失效⇒一律 `-e`｜BSD grep 无 `\s`｜`| head -N`/`| tail -N` 会截掉决定性命中｜`grep -rl X *.py` 只搜顶层｜`git commit -m` 含 `{}`/反引号静默失败⇒`-F`｜「搜不到」先排除「搜错范围/被截断」。微信开发者工具 CLI 被「服务端口」挡住 ⇒ 须人工在 IDE 设置里打开一次。
