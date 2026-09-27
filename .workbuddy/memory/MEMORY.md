# Hergent 项目长期记忆（索引）

> **本页只回答「该读哪一份」**：判据全文在 `memory/topics/`。
> 🔴 **>14.5KB 被截断注入** ⇒ 维护前先 `wc -c`，目标 ≤11KB。📏 2026-09-26 晚实测 **~13KB（已超）** ⇒ 下次维护**只减不加**。

## 一、路由

- **前端**（页面/样式/表格/数字格）→ `topics/frontend-ui.md`
  · 全屏图层 ⇒ 页头控件**物理不可达**，须层内补副本；让位三条件缺一 = 死按钮不报错
  · v214-A 数字格病根在输入层：`type=number` 静默加工、`NFKC` 不折 `。`
  · 🔴 撤入口 ≠ 撤路由：`v-if` 只藏 DOM ⇒ 手敲 URL 照样进 = 假封锁 ⇒ 受限页挂 `meta.roles` + `roles.js::roleIn()`
  触发：全屏 · 工具栏 · 表格 · 数字格 · 全角数字 · 不居中 · 模块下架 · 深链 · 路由守卫 · 假封锁
- **后端**（权限/账号/DB/报 500）→ `topics/backend-invariants.md` + `backend-auth.md`
  · RBAC 在最外层 ⇒ `_check_perm` 时还没租户，须显式传 `tenant_id=`；参数错回 500 = `ValidationError` ≠ `RequestValidationError`
  · 🔴 恒空恒 0 且零报错 = 静默失效 ⇒ `tools/undefined-call-scan.py`；候选 ≠ 缺陷；读数「碰巧对」⇒ 问「恒定值是否恰好等于当前事实」
  · 🔴 SQLite DDL 是事务性的 ⇒ 建表须 `get_db_tx()`
  · 🔴 静默洞：① 租户库**只下发表不下发索引** ⇒ 须登记 `db/indexes.py::INDEX_SQLS`（**唯一**通道）② **窗口当主键** ⇒ 写成功/读空/零报错（v279 改 `period_id`）③ 白名单漏字段 = 静默不写
  · 🔴 换库文件 + 连接缓存 = **幽灵 inode**（句柄仍指已删 inode，`SELECT 1` 测不出）⇒ 必**先删后重启**
  触发：权限 · 开账号 · 列权限 · 报 500 · 参数校验 · 索引 · 时区 · 静默失效 · 裸 except · 幽灵 inode
- **部署 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`（§v230 / §v233 / §v277 / §v282）
  · 🔴 生产路径别靠记忆试：后端 FLAT `/opt/hergent-erp/`；前端 `/opt/hergent-cn-v2` 本身就是 dist
  · 🔴 加列靠租户库启动期自动对账 ⇒ 验收读 `[schema-sync] … 补列(+N)`；md5 一致只证「传输没坏」⇒ 补验 mtime
  · 🔴 判「哪些 hunk 属于我」先判「该文件是否已上线」：① md5 逐文件全等 ＋ ② 无源码 mtime 晚于构建；跨轮比**工作区**（非 HEAD）
  · 🔴 生效入口会被**并行会话接管**（同一工作区被再 build）⇒ 别拿「chunk 名 == 我构建的」当判据 ⇒ 用 ①特征串 ②CSS 逐字节 ③scopeId 反推；三条全过 ⇒ **不重部署**
  · 🔴 **v282：chunk 文件名连「夹带」都判不了** —— 只改 2 个源文件却让 **29/53** chunk 改名（rollup hash 对模块遍历顺序敏感 ⇒ 级联）⇒ 唯一判据 = **按逻辑名前缀比字节大小**（hash 是 base64url **含 `-`** ⇒ 正则 `^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$`）；干净差集应**精确等于我改的源文件对应 chunk**（+172B / +471B）；构建前必存 `ls dist/assets > before.txt`（`emptyOutDir` 让旧产物当场消失）
  · 🔴 **绝不用 `git stash` 做「去掉我的改动」的对照构建** —— 共享文件里叠着别人**已上线**的在途改动，stash 会一起移走（v282 险回退 v265 的 28KB）⇒ 改共享文件前**先 `cp` 备份 + 记字节数**（靠它全额恢复）
  · 🔴 无 production 分支 ⇒ 基线靠生产反推；生产 `assets/` 是历次构建**并集**（上传**绝不 `--delete`**，回滚只需还原 `index.html`）
  · 🔴 备份双份 + 存活告警：`backups/<date>/` ＋ OSS 异地（02:00）＋ 03:20 巡企微 ⇒ 技能 `hergent-offsite-backup-oss`；验收 = OSS `ETag` ↔ 本地 `md5sum`；⚠️ 判据取 stdout `success`（退出码恒 0）
  触发：构建 · 上线 · 回读 · 差集 · 夹带 · chunk 改名 · 生产基线 · 备份 · 异地 · OSS
- 🔴 **受控提交三条纪律**（→ `deploy-ops.md §v230`）
  · 临时索引提交后必须复位共享索引（残留 `MM`/`D ` 会被下次 commit 回退成旧版）；取路径须 `-z`
  · 绝不用 `git checkout -- <目录>` 收索引（不可逆）
  · 只交「已改的跟踪文件」= 坏提交（git / `node --check` / `py_compile` 全不报）⇒ 必做可达性审计 ＋ 页面完整性审计
  触发：受控提交 · 夹带 · 索引 · 遗留未提交 · 坏提交
- **预报主表 / 期次 / 导入 / 到货周期 / 报单基准 / 价格单位** → `topics/forecast-order-domain.md`（最长）
  · 口径类缺陷先问当初拍板的口径；崩溃时机即分类器（点删才崩=字段缺失 / 进页即崩+栈溢出=自递归）
  · 🔴 报单单位铁律：永不落大单位（三级用中 / 两级用小）⇒ 真身 = `products.order_unit` ⇒ 改单位必带数量换算，换算不出 ⇒ 退回明细单位 + 下载告警点名；⚠️ 别拿 `products.unit`
  · 🔴 厂价 = 元/箱 ⇒ `单价(厂价/箱)` 就是厂价本身；⚠️ 修「值不对的公式」先判该运算该不该存在
  · 🔴 `purchase/sale/dist_price` = 元/小单位，`factory_price` = 元/大单位；「进价」下两条链**有意分家**（金额基准只认 `factory_price`）
  · 🔴 对外单据量纲：舟谱「*单价(折后价)」×「*单位」= 元/单位 ⇒ v232 起模板取渠道价
  · 🔴 期次列表「无按钮的行」= 合成行（`id<0`）⇒ 屏蔽是设计如此；清理必带 `forecast_period_confirm`
  · 🔴 报单(判断) ≠ 提货(事实)；🔴 `forecast_audit` 窗口锚 `MAX(order_date)` ⇒ 停更 101 天零报错
  · 🔴 跨期复制只有「商品清单」该复制（键 = `period_id`）；「上一期」锚 `order_start` 严格 `<`；🔴 v273 自动沿用：**上一期为空 ⇒ 复制 0 行且逐期传染**（报单页空白零报错）⇒ **v282 已加告警**（`src_count` 区分「源为空」vs「全跳过」＋ 站内通知 `event_key=forecast_carry_empty` ＋ 推企微 ＋ 前端 warn 色）
  触发：预报 · 期次 · 定稿 · 合计(箱) · 单价 · 报单单位 · 单位换算 · 舟谱模板单价 · 进价 · 合成行 · 报 vs 提 · 清单为空 · 沿用上一期 · carry-empty
- **返利 / 目标** → `topics/rebate-domain.md`｜**货损 / 效期**（先分 `/loss` vs `/loss-accounting`）→ `topics/expiry-loss-domain.md`
  · 🔴 生效期口径（v186）：年度规则适用月份 = 月度分解本身，不逐月裁剪 ⇒ 有目标就必须画柱；门禁唯一实现 = `rebate_period.py::rule_covers_month/rule_covers_date`
  · 🔴 **只配节奏不设目标**（v282）：`target_value=0` 安全（`rebate_calc.py:257` 达成率 `None`、返利 0）⇒ 但必须走 `rebate_rules.py::_row_rhythm_only()` 正门 = 放行 ＋ **不判重** ＋ **不占月份锁**（否则年度无分解的 `covered_months`=整年 ⇒ 品牌整年锁死、以后建真目标被 409）；`auto_period_enabled` 保持 0（`_check_auto_period` 只认**第一条**开着的规则当 carrier）
  触发：目标 · 返利 · 生效期 · 月度分解 · 灰柱 · 达成率 · 节奏规则 · 到货规则
- **报单 / 小程序 / 品牌 / 员工账号 / 提审** → `topics/miniprogram-and-brand-data.md`
  · 「能登录」≠「能干活」：认证 `/api/auth` 豁免 RBAC、业务走模块中间件；角色缺 `data` ⇒ 每动作 403
  · 新账号 `password_changed=0` = 首登强制改密，密码 ≥8
  · 🔴 手机截图报「还是没修好」→ 先判在看哪个包（开发/体验/正式版是三份代码）⇒ 判别点只选本期新增 + 无条件渲染 + 肉眼可见；改行为必须同步改测试清单
  · ✅ 需求 2/3（均单提示 + 低于目标弹框）**v264c 已实现**；🔴 **行内单位 = `order_unit`，必须与后端 `avg_per_unit` 的键同源**
  · 🔴 **均单提示前置「三件套」**：① 本月有目标 ② 有大单位换算（`no_convert`）③ **该品牌有到货规则**（`no_rule` —— 只按品牌名精确匹配、**无兜底**）⇒ 缺任一都**静默不显示**；✅ **v282 已给 `蒙牛鲜奶` 建节奏规则（id=11，照抄蒙牛低温）⇒ 三件套齐、D20 首次可观测**（`1596` 四类 flag 全清）
  · 🔴 改小程序前先验**数据面能否观测**
  触发：报单 · 门店范围 · 提审账号 · 首登改密 · 收回门店 · 提交成功无反馈 · 一店一期一单 · 单号 · 均单目标 · 两把尺子 · no_rule · 到货规则
- **小程序保活** → `topics/miniprogram-keepalive.md`（微信不支持保活 ⇒ 状态韧性 + cron + 企微召回）
- **副驾 / AI 落点** → `topics/ai-copilot.md`（算·录·判·说；名带 `ai_` ≠ 用了 AI）｜**通知 / 工资条** → `topics/notification-center.md`
- **IM 渠道** → `topics/im-channels-v131.md`｜**业绩/提成/龙虎榜** → `topics/sales-reports-and-operator-attribution.md`｜**对账/流水/催收** → `topics/reconciliation-redo.md`｜键对账 ≠ 账户对账 ⇒ 验收 = 逐笔可解释
- **新用户建档 / 价格方案 / 单位换算** → `topics/onboarding-and-archive-gate.md`
  · 拦写入不拦浏览、隐式建档优先；🔴 六类档案之外还有员工 + `report_mapping` = 预报第一硬门槛
  · 🔴 `contacts.channel_id` 列从未被创建过（有守卫 ⇒ 永久落兜底价、零报错）
  · 🔴 价格真身 = `customer_prices`（非 `product_channel_prices`，0 行）；「三列并排」存三级单位价、与舟谱同构 ⇒ 照抄；🔴「前端缺某字段」先分清它从哪条接口来
  · ✅ 三档价联动：中/大单位价 = 小单位价 × 换算比 ⇒ 别再每档各存独立数（必漂移）
  · 🔴 换算唯一权威 = `products.large_ratio/medium_ratio`（判据用 `large_ratio > 0`，不用 `has_multi_unit`）；`unit_conversions` 0 行 ⇒ 别新建；⚠️ **批量补换算前先判 `unit` 语义**（`'件'`=整箱 ⇒ 反向，v277 填反 21 行已回滚）
  · ✅ `perCase` = 档案换算优先 → 规格解析回退；由 `products_grid` 白名单放行
  触发：新用户 · 建档前置 · 价格方案 · 千店千价 · 单位换算 · 装箱数 · 三列并排 · customer_prices · 三档价
- 🔴 **跨域铁律 → `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍
- **对外材料** → `outputs/德邻杯-AI创业大赛-2026-09-19/`

## 二、技能路由 → `topics/skill-routing.md`

- 🔴 **上线前体检** → `hergent-pre-launch-audit`（七面 28 项 + 反例对照法）｜触发：上线前检查 · 发版前体检
- 🔴 **对外材料成稿 + 脱敏 + 导 PDF** → `hergent-external-material-pdf`
  🔴 数字只取可验证来源（最易编：损耗降幅/耗时缩短/「AI 大量使用」）；🔴「留空」比「数字小」更危险 ⇒ 转成**假设 + 成功判据**；🔴 **定位句必须与全篇证据同向**；**Ask 不能比创始人战略更激进**
  工具 `tools/md2pdf.js`（h1 强制分页 ⇒ 尾页空白）；验收 `pymupdf` 渲页，填充率须排除页脚
  触发：帮我写 BP · 材料要交出去 · 导成 PDF · 这能不能公开
- 🔴 **图表渲染几何验证** → `hergent-chart-render-verify`｜触发：柱子不显示 · 颜色不对 · 图表对不上
- **预填外部 SPA 表单** → `web-form-autofill-spa`｜🔴 只预填、绝不点提交；下拉判定不能看 `input.value`
  触发：帮我填一下这张表 · 报名表 · 下拉选不中
- 🔴 受控提交 → `hergent-scoped-commit`｜并行会话安全 → `hergent-parallel-session-safety`（**§八 = 前端产物夹带判据**：文件名不可信 ⇒ 比字节大小；**绝不用 `git stash` 做对照构建**）

## 三、编号约定（⚠️ 起号前必做）

已用到 **v288**（→ `topics/version-history.md`）。🔴 本行极易过期（v278 被抢且**日志有、MEMORY 无**；**v286 被抢却只活在文档/commit 里**）⇒ 起号必须实搜：源码 `grep -rn -e "v20X" -e "V20X"`（多模式必须 `-e`）＋ `memory/` ＋ **该页当天新增段** ＋ `tools/` ＋ 两仓。⚠️ **技能章节不得借用代码版本号**；**零代码改动不占号**（但**数据操作占号**：v283–v285）。

## 四、主体 / 脱敏

hergent-cn-v2（`laozhangai-product` → `/opt/hergent-cn-v2`）｜hergent-erp（FastAPI + SQLite `:8700` → FLAT `/opt/hergent-erp`）｜🔴 脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 厂家政策。

🔴 仓库内含生产凭据明文（Hermes 网关 Bearer 在已跟踪 9 文件 / 历史 3 提交；提审账号与手机号同样已入库）⇒ 远端仓库必须 private；入库新文件前先跑凭据扫描。
🔴 个人 PII 不落 `outputs/`（被 git 跟踪）⇒ 环境变量 ＋ 打码 ＋ `grep` 自证 0 命中。

## 五、本机坑 → `topics/local-machine-pitfalls.md`

`grep "A\|B"` 静默失效 ⇒ 用 `-e A -e B`；多条 grep 串 `&&` 会短路 ⇒ 用 `;`。
🔴 **heredoc 经 `ssh` 传会吞引号** ⇒ 含引号的脚本一律**本地写盘 + `scp`**；服务器**无 `sqlite3` CLI** ⇒ 一律「落盘 → scp → `runuser -u hergent -- python3`」。
🔴 无头 Chrome 起不来先查启动参数（须 `--no-sandbox --disable-gpu`），别回滚代码。
🔴 **SQLite 只读两个方向**：**活库** `mode=ro`（**不带** `immutable`）；**静态备份**必须 `mode=ro&immutable=1`。判据：同一份数据必用「接口读端 + 直读库」两条路互验。
