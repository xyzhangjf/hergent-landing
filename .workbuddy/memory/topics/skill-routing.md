# 技能路由（user-level）

> 由 `MEMORY.md` 迁出（2026-09-19，为压索引页长度）。
> ⚠️ **不记「共几条」** —— 那个数字每次都过期（2026-09-19 实测写的 38 与实际 35 已不符）。
> 要数就现场 `ls ~/.workbuddy/skills | grep -c '^hergent'`。
> `-frontend-*` 一律指**新前端 hergent-cn-v2**；旧前端 `static/`（erp.hergent.cn）另有标注。

## 上线 / 构建 / 提交

- `hergent-frontend-deploy-verify` —— 前端（hergent-cn-v2）构建 + rsync + **双侧 md5** 验收
  🔴 **双侧 md5 一致只证明「传输没坏」，不证明「产物是新的」** —— 两边都可能是旧的那份。
  且 **Vite 会给被多处引用的共享 chunk 挑某个成员模块的名字命名**：新增一个多 chunk 依赖的模块，
  283 kB 的 xlsx chunk 就会从 `arrival-*` **改名**成 `roles-*`（2026-09-19 实测）
  ⇒ 差集核查别把它当成「删了一个 + 加了一个」。见 `.workbuddy/tools/dist_normalized_diffcheck.py`
  （已内置「同一 chunk 改名」识别；归一化差集必须能区分**纯派生噪声 / 真变化 / 疑似改名**）。
- `hergent-prod-deploy-e2e` —— 后端部署（flat `/opt/hergent-erp` 布局 + rsync 展平 + 权限）
  ；⭐ **「冒烟 / 回收脚本的五条纪律」** + **「影子库 + 金丝雀范式」**（v205 新增，写不可逆路径/证明分层生效时首选）
- `hergent-scoped-commit` —— **脏工作区**里只提交本轮改动（先读文首「🧭 导航」）
  ；🔴 **§5.26 暂存产物是「第三份产物」**（HEAD + 我只认领的 hunk，**没人验过**）⇒ 提交前必须
  `py_compile` + **符号一致性核对**；混合 hunk 的夹带裁决看「不收的后果」；
  `keep_all` 前必须扫 `-` 侧确认「该文件工作区改动全是我写的」（本轮 `MEMORY.md` 被并发会话整体重写
  ⇒ 同一 hunk 里夹着我的 1 行 ⇒ **该文件本轮不进索引**）

## 新增页面 / 模块

- `hergent-cn-v2-add-module` —— 在 hergent.cn 新增业务模块（后端路由 + 前端页 + 三处接线）
- ⭐ `hergent-role-registry-change` —— **加/改/停用角色**（或改任意「角色 → 权限」清单）。
  横跨后端 `_DEFAULT_PERMS` · 前端 `constants/roles.js` · 员工档案下拉与**适用端标注** ·
  徽标色板 · 小程序 `ROLE_TEXT` · 列级权限表 · 填报白名单 · 后端 `normalize_role` **共 8 处接线**；
  含「标了小程序 == 有 data/chat 权限」硬判据 · 「`normRole` 归一 ≠ 授权」·
  「权限层空转」三问（key 对不对 / 值从哪来 / 失败方向朝哪边）·
  ✅ **§四之二「权限表按租户分叉」**（**v205 已修**：`perms_for(tid)` / `tenant_scope` / 窄模块 `payroll`；
  🔴 两个最贵的坑：**RBAC 中间件在最外层 ⇒ 必须显式传 `tenant_id=`** · **豁免模块判定 ≠ 放宽访问控制**）
  —— ⚠️ 任何「按客户差异配权限」的需求，现在**做得到**；但按客户差异请在**该租户权限页**里授予
- ⭐ `hergent-capability-reality-audit` —— **第十二/十三/十四/十五种伪装**（词汇归一⇒假装权限生效 ·
  输入源没人赋值⇒能力空转 · **配置作用域 ≠ 权威作用域**（v205 已修，伪装通用）·
  **「验证通过」本身是假的**（404/5xx/空响应三种伪装 + **只读探测里夹写操作**）·
  **豁免一个判定顺手做成放宽访问控制**）。触发词：为何配了不生效 · 按租户 · 空承诺 ·
  **这个验证能不能算通过** · 假绿灯
- 旧前端 `static/`：`hergent-frontend-add-module` · `hergent-vite-landing` · `hergent-frontend-fetch-consolidation`

## 预报主表 / Excel

- ⭐ `hergent-unit-conversion-audit` —— **动任何「数量 / 箱数 / 单位 / 换算」代码前必跑**
  （报单·加单·商品目标·价格·库存·返利达成）。权威 = `products` 三级单位 + `order_unit`；
  唯一实现 = `perCase()` / `order_unit_master_sql()`。
  🔴 两个实测静默陷阱：① **`medium_ratio > 0` 在 SQLite 下假阳性**（157 行存空串，`'' > 0` 恒真
  ⇒ 中单位数 53 变 210），SQL 一律 `CAST(medium_ratio AS REAL)` ② **小程序与 Web 主表单位不同源**
  （`fill-search` 只下发 `p.unit`）⇒ 「按填报单位显示」的功能必须先打通。
  另含锚点商品（id=1449 ⇒ 1件=8包=40袋）、`arrival_count_override` = 可报单数、
  `rebate_achievements` 有 product 维度但**缺 unit 列**。
- `hergent-forecast-column-registry` —— 主表增删一列；删列前核查「会不会连同功能一起删掉」
- `hergent-import-mapping-confirm` —— Excel 导入加「列映射确认」界面并**改判真生效**
- `hergent-forecast-import-verify` —— 端到端验证导入（真实接口 + 隔离沙箱 + 逐列对账）

## 前端故障

- `-frontend-layout-capacity` —— 工具栏/表单/页头「能否单行」实测与控件间距
- `-dom-structure-diagnosis` —— 主内容空白 / 布局塌陷 / 侧栏不见
- `-zindex-diagnosis` —— 浮层被压 / 元素凭空浮在上面
- `-dead-control-diagnosis` —— 控件看得见但点了没反应
- `hergent-numeric-input-ime-tolerance` —— 数字格的**输入法容错**（全角数字 / `。` 句号 / 千分位；`type=number` 静默加工）
- `hergent-chart-render-verify` —— 图表柱子几何与颜色；证明前端没镜像后端算法

## 样式治理

- `-css-globalize` —— scoped 样式上提为全局层 + 死 CSS 甄别
- `hergent-workbuddy-ui-align` —— 按 WorkBuddy **真实 CSS** 对齐规格
- `hergent-emoji-to-icon-sweep` —— 全站 emoji/符号 → 统一 `<Icon>` 线性 SVG

## 小程序

- `hergent-miniprogram-privacy-audit` —— 隐私申报 ↔ 代码调用 ↔ 弹窗 ↔ 平台申报 四处一致性；改名同步；提审前自查

## 数据与库

- `hergent-authorized-prod-data-write` —— 用户显式授权的生产库改写（直连 DB / 走真实 API 两路）
- `hergent-tenant-schema-sync` —— 租户库 vs 主库 schema 对账（补表 / FTS5 / 回填索引）
- `hergent-sqlite-table-rebuild` —— SQLite 改列类型/约束（官方 12 步重建表）
- ⭐ `.workbuddy/tools/sandbox_tenant.py` —— 隔离租户沙箱真机验证（**id ≥ 9997**，只能在服务器跑）

## 诊断族

- `hergent-tenant-isolation-audit` —— 自注册链路 + 租户隔离 + 越权向量
  ；**§2.5 影子库验证任意业务写路径**（真租户库拷成影子租户，`set_tenant_context` 是必需前置）
- `hergent-data-staleness-diagnosis` —— 数据不更新 / 页面没刷新 / UI 语义缺陷
  ；**C-3「两个入口其实选同一个池子」⇒ 收敛入口定式「写端收敛、读端放宽」**（含 `update` 回写陷阱）
- `hergent-capability-reality-audit` —— 某能力/配置「到底有没有真的到用户面前」
- `hergent-write-failure-diagnosis` —— 写操作报「失败」（三轴：几个请求 / 文案谁写的 / 后端全部失败点）
- `hergent-rebate-caliber-consistency` —— 口径不一致（分子分母不同源 / 归组键错配 / 阈值硬编码）
- `hergent-page-change-log` —— 给业务页加字段级「修改日志」
- ⭐ `.workbuddy/tools/role-registry-consistency-check.py` —— **清单一致性回归护栏**（28 条硬断言；
  角色/权限清单 vs 后端 `core.py::_DEFAULT_PERMS` **AST** 权威源）。除了「下拉覆盖」还管：
  两页面**不得自带角色表** · 列权限/填报白名单必须是**规范**角色名 · 「标了小程序」集合 ==
  有 `data`/`chat` 权限的集合 · `roleName`/`roleText` **不得回落原值** · 跨面译名逐字一致 ·
  `normalize_role` 三处写入口接线。判别力自证：5 份副本全 FAIL。
- ⭐ `.workbuddy/tools/direct-self-recursion-check.py` —— 扫「`return` 表达式内**无参数**自递归」
  （带参数的一律放过 —— 正常递归总带出口参数）。配套 `self-recursion-discriminate.py` 自证判别力 6/6。
  🔴 两个实现细节都是踩出来的、**都导致漏报**：① 必须**剥注释**（示例代码就写在源码注释里，
  第一版把注释当真代码报了）；② 必须**认正则字面量**（不认则把正则里的 `"` 当字符串起始、
  与后面代码错位配对吞掉几千行 ⇒ 漏报）。
- ⭐ `.workbuddy/tools/hunk_index.py` —— 出「hunk 旧侧起始行 → 首条新增行」索引表。
  用于在**几百个脏项**的长期工作区里区分「本轮改动」与「并发会话在途改动」（详见 `hergent-scoped-commit`）。
- ⭐ `.workbuddy/tools/probe_token.py` —— 真机探针用的临时会话令牌（在服务器上 `insert` / `delete` / `count`）。
  三步留痕 + 删后回读计数 == 零残留证据。
- ⭐ `.workbuddy/tools/employee-supervisor-role-verify.js` —— 员工档案角色**真机探针**（沙箱 9997，真实 UI 建号）
- ⭐ `.workbuddy/tools/role-v199-ui-verify.js` —— 员工档案 + 预报页**真机 UI 18 断言**（含「预报页正文
  > 200 字符」这条 —— 它正是抓出整页 `RangeError` 自递归崩溃的那条）；`role-v199-shots.js` 出真机截图
- ⭐ `.workbuddy/tools/v200-store-scope-verify.py` —— **门店可见范围函数级 22 断言**（AST 抽真源码 +
  内存 sqlite；并集 / `prune` 不改可见集合 / 停用即收回 / `prune(0)` 作用域 / 缺表回落 / 不越权 /
  残留清单口径）。支持 **`ERP_DB=` 指向 scoped 暂存产物** ⇒ 验的是「要提交的那份」而不是工作区。
- ⭐ `.workbuddy/tools/v200-store-entry-e2e.js` —— 门店入口收敛**真机 13 断言**
  （旧按钮消失 / 提示条条数 / 新接口 200 / 0 pageerror / 0 业务 4xx-5xx）。
- ⭐ `scoped_stage_by_marker.py` 新增 **`present` 正向断言**（`gone` 的对称面）——
  专防「把自己的 hunk 误判成在途 ⇒ 静默少提交」。详见 `hergent-scoped-commit` **§5.10 / §5.17**。
- ⭐ v203 四件套（对象类型收敛）：`v203-cp-type-normalize-check.py`（判据自证 25 项，**AST 就地取
  真源码 exec**，不 `import erp_db`）· `v203-prod-verify.py`（生产只读 16 项）·
  `v203-shadow-write-test.py`（**影子库写路径 22 项**，`tenant_1.db` → `tenant_99.db`）·
  `v203-cp-type-e2e.js`（真机 26 项）。
- ⭐ v205 五件套（**权限按租户分叉 + `payroll` 窄模块**）：`tenant-perms-scope-check.py`（源码护栏
  **57/57**，A13c「两个 GET 端点必须用 `_admin` 而非 `_auth`」· D 组「`salary_detail_get` 返回 list」）·
  `tenant-perms-scope-discriminate.py`（判别力自证 **12/12 全 FAIL**）·
  `tenant-perms-shadow-e2e.py`（**影子库端到端 37/37**：`sqlite3.backup()` 只读复制生产库到 /tmp +
  真实 `server.app` + `TestClient(raise_server_exceptions=False)`；**金丝雀 + 正/反双向对照**）·
  `v205-prod-smoke.py`（**生产真机 32/32**，含零残留 8 条）· `v205-prod-cleanup.py`（残留回收 10/10）。
  🔴 三条写脚本的铁律：**setup 与 cleanup 共用同一数据结构算占位符**（手写 `IN (?,?,?)` 而 token 列表
  多了一个 ⇒ cleanup 崩在第一条 DELETE、**四项残留全留生产**）· 唯一约束上 `INSERT OR REPLACE` 保幂等 ·
  清理断言写**绝对不变量**（「不存在」）而非相对量（「比 pre 少 1」）。详见 `hergent-prod-deploy-e2e`
  「冒烟 / 回收脚本的五条纪律」+「影子库 + 金丝雀范式」。
- 🔴 **起号前先查占用**（`grep -rn` + **`git diff` 在途** + `git log --all -S`）；本序列已到 **v205**，
  下次从 **v206** 起编。**禁用 `grep "A\|B"`**（zsh 静默失效），改号用**行号白名单 + 计数断言**。
  ⚠️ v205 号**两边都在用**：本侧（权限分叉，已实现上线）与同日另一会话（保存下拉，**仅评估**）
  ⇒ 按对方自己写明的规则，**对方改号**。

## 门禁 / 协议 / 网关 / 外部数据

- `hergent-write-entry-gate` —— 给写入口加「前置条件门禁」（服务端硬拒 + 前端禁用并说明原因）
- `hergent-ai-card-protocol` —— 副驾卡片/fence 协议排障
- `hergent-hermes-tenant-diagnosis` —— Hermes 多租户网关（IM 渠道 / LLM key 继承）
- `hergent-external-data-source` —— 接外部数据源并做成「每年自动更新」（三层降级）

## 对账 / 资金流水

- `hergent-recon-engine-build` —— **构建 + 验收确定性对账算子**（上传 A vs 上传 B）。
  含：七步分工红线（算归代码、AI 禁止比对）· 🔴 **用报告自己给的组数反推人工算法** ·
  两类列布局 · 导出文件元信息行/合计行陷阱 · 符号不可翻转 · `bisect` 有序性事故 + 规模回归 ·
  **单测全绿 ≠ 引擎对** · 「人工报告自己就有错」的验收口径 · MCP 复用后端与生产 importlib 坑

## 文档 / 表格 / 流程

- `hergent-excel-attachment-to-schema-design` —— 业务 Excel → 主表/模版设计
- `local-xlsx-xml-minimal-write` —— 往既有 xlsx 补值**不破公式**（zipfile 原位最小写）
- `product-dev-sop` —— 产品开发 SOP（立项 / 大改动 / 事故复盘）
- `workbuddy-*-internals` —— WorkBuddy 连接器 / 提示词系统勘察

---

**技能库待整理**：`hergent-prod-deploy-e2e` 已成杂物箱；巨型技能全无 `references/`；诊断族命名不统一。
