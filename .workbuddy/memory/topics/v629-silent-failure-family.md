# v629「静默失效」缺陷家族（一次真机探针连抓 5 例）

> 起因：用户授权在演示租户造 1 条商品目标后，用 `p1-alloc-real-verify.mjs` 真机点「分摊」。
> 结论：**构建全绿、测试全绿、控制台零报错，功能却完全不可用** —— 5 个缺陷全靠真机点击才现形。
> 共同根因：引用了「本作用域不存在的标识符」或「已被框架解包过的值」。

## 五例逐条（均已在 2026-10-22 修复并部署）

| # | 位置 | 症状 | 根因 |
|---|---|---|---|
| 1 | `Forecast.vue::openAlloc` | 点了没反应、零 toast | 调了子组件私有函数 `allocRowRef(r)`（定义在 `AllocPanel.vue` 且自身从不调用）。**自 v318 上线起从未可用**。修法=直接传 `v-for` 的 `r`（按 `product_id` 回查在**同品多行**会命中错行） |
| 2 | `Forecast.vue::openAlloc` | 同上第二处 | 调了子组件私有 `_allocPid()`。修法=就地取 `cross.value.period.id` |
| 3 | `AllocPanel.vue` 漏 import | 一渲染数字就 ReferenceError | 用了 `parseNumInput()` 却只 import 了 `fmt` |
| 4 | `AllocPanel.vue` 的 `props.xxx.value` | 弹窗永远停在「正在读取分摊依据…」 | **prop 到子组件时已被 Vue 解包**（父模板 `:cross="cross"` 的 ref 渲染即脱壳）⇒ `props.cross.value` 恒 undefined ⇒ `_allocPid()` 恒 0 ⇒ `loadAllocSetup` 静默 return。`props.row` / `props.open` 同理 |
| 4b | `AllocPanel.vue` 缺 `open` prop | 弹窗**永远不渲染** | 模板写 `v-if="open"` 但 `defineProps` 没声明 `open` ⇒ 值落进 `$attrs`，模板裸 `open` 解析成 undefined。生产构建连 dev warning 都没有 |
| 5 | `api()` 返回值再取 `.data` | 恒空 / 恒回落默认值，零报错 | `client.js` 末尾 `return data.data !== undefined ? data.data : data` **已解包一层**。再写 `(d && d.data)` 恒 undefined |

第 5 例一次扫出 4 处真缺陷：
- `AllocPanel.vue` ×2（setup + preview）⇒ 分摊弹窗恒空
- `RebateSprint.vue` `/api/params` ⇒ 全局默认到货周期**永远回落写死的 2 天**（用户改成 3 天不生效）
- `AiOps.vue` `/api/ai/recipe-versions` ⇒ 配方版本列表**永远为空**
- `PeriodOps.vue` `extraAlloc` ⇒ 关闭期次弹窗的「定稿推送明细」**永远空**（弹窗说 0 条、后端照发 N 条 —— 正是该文件注释最怕的两把尺子）

## 🔴 判据（可复用）

1. **prop 一律不加 `.value`**：`props.row` / `props.cross` / `props.open` 直接当对象用。判据：在子组件里写 `props.X.value` 就是错。
2. **模板里出现的裸标识符必须在 `defineProps` 或 setup 里声明**，否则落 `$attrs`、静默 undefined。
3. **`api()` 只解一层**：返回值就是 data 本体。除非该方法传了 `{ raw: true }`（如 `zhoupuApi.sourceStatus/status`），那时才取 `.data`。
4. **带兜底的写法不致病，别一律判红**：`Array.isArray(r) ? r : (r.items||r.data||[])`、`d.data || d || []`、`d && d.data ? d.data : d` 都是**防御链**，正常。只有「`.data` 是唯一来源、失败即恒空」才真坏。
5. **静态检查抓不到的一律靠真机探针**：这 5 例全部零构建错误、零控制台报错。

## 检查器（`tests/cross-sfc-symbol.contract.mjs`，已并入 `tests/run-all.mjs` 第 ④ 项）

四条规则：① 跨组件私有函数引用 ② 漏 import ③ `props.<已声明 prop>.value` ④ `api()` 双重解包。
每条都做过**注回自检**（把 4 处已修缺陷分别注回副本，确认 4/4 抓红），防"全绿假象"。

## 演示租户的环境性限制（不是缺陷）

- 演示租户 `readonly=1`，后端闸门**按 method 拦写** ⇒ `POST /extra-alloc/preview`（纯计算、不写库）也被 403 `READONLY_TENANT「演示环境只读」`。
  ⇒ 分摊弹窗的 setup（GET）正常（标题能出商品名），但**表格行永远出不来**。
- 后果：演示用户点「分摊」看到"演示环境只读"，体感像功能坏了。属**后端闸门粒度问题**（应按「是否写库」而非 method 放行），待评估再改。
- 探针因此把「承接人 2 行」改成：真出 2 行=PASS／空行提示恰为该只读报错=SKIP（不计红）／其他（卡在「计算中…」、显示「没有可分摊的承接人」）=判红。
- 结论：**「分摊」的两行承接人仍需真实账号复验**（真实期次 + 有商品目标的行）。

## 演示租户造数（可回滚）

脚本 `.workbuddy/tools/seed-demo-target.py`（直写 SQLite，`readonly=1` 走不了 API，故不翻闸门、不重启服务）。
内容：商品 2 补 `large_unit='箱'/large_ratio=12`、本期清单登记 1 行、目标 1 条（现名「蒙牛特仑苏纯牛奶 250ml 9月目标」120 箱）、分解 刘小顶 60%(72) / 王老板 40%(48)。
回滚：`ssh root@47.113.224.140 'cp /opt/hergent-erp/_backup/tenant_10.pre-allocprobe-20261022-072812.db /opt/hergent-erp/tenant_10.db'`


---

## 新成员（v712，静态前端 /opt/static）

### 1. `try{window.X=X}catch{}` —— 空 catch 吞掉 ReferenceError
`assets/main-CWrK_ez4.js` 共 **885 处**这种导出；页面里跑 `typeof window.X` 实测 **407 处是 `undefined`**。
机制：模块里根本没声明 `X` ⇒ `window.X=X` 抛 `ReferenceError` ⇒ 空 `catch{}` 吃掉 ⇒
**控制台无红字、页面不报错**，只是调用点在运行到的那一刻抛 `X is not a function`，
而外层（如报表渲染）没有 try/catch ⇒ 面板 `innerHTML` 停在 `<div class="spinner">`，**永远转**。

判据：**别看 grep「有没有定义」**，要在页面里批量核 `typeof window[name]`：
```js
var t = await (await fetch('/assets/main-CWrK_ez4.js')).text();
var re = /window\.([A-Za-z_$][\w$]*)=\1\}catch/g, m, seen={}, names=[];
while ((m = re.exec(t))) if (!seen[m[1]]) { seen[m[1]]=1; names.push(m[1]); }
var dead = names.filter(n => typeof window[n] === 'undefined');
```

修法（优先级）：**改 `index.html` 内联补全局函数**，不动 1.4MB 产物。
`<script type="module">` 天然延迟执行 ⇒ 内联经典脚本必定先跑；chunk 里那句赋值
仍会抛错被吞，因此**不会覆盖**内联定义。`index.html` / `assets` 都是
`cache-control: no-cache, no-store` ⇒ 刷新即生效。

### 2. `document.addEventListener("scroll", t => t.target.closest(...))`
滚动事件在 `document` 上触发时 `t.target` 是 `document`，**没有 `closest`** ⇒
每次滚动抛 `TypeError`，页面顶部弹红条，`thead.scrolled` 吸顶逻辑整段失效。
修法：`var e = t.target && t.target.closest ? t.target.closest(".page-inner") : null;`

### 3. 前端按「从未存在过的字段」写，静默显示 0
`assets.cash/ar/inventory/fixed_assets_net`、`liabilities.ap`、
`equity.paid_in_capital/retained` 这些字段接口**从来没返回过**（老函数用的是
顶层 `cash/ar/inventory_val/ap`）⇒ 界面 7 行明细恒为 ¥0.00，**比空着更误导**。
判据：**拿真接口 payload 逐字段比对前端读取的 key**（`print(list(d['assets'].keys()))`），
不要假设「前端能显示就说明后端有这个字段」。

### 4. 同族：先看 `index.html` 引的是哪个 chunk 再 grep
`/opt/static/assets` 有 4 个历史 `main-*.js`。在旧 chunk 上 grep 会得出
「没有这个功能」「代码是旧形态」之类**完全错误的结论**（v712 连踩两次）。

---

## 附录：MEMORY.md 原编号 13–23 全文（2026-10-28 迁出，MEMORY.md 留骨架）

**13. 真登录探针（v716 实测修正）**
`/opt/static` 的登录态是 **`localStorage.hergent_token`**（前端 `localStorage.setItem("hergent_token",...)`），**不认 cookie、也不认 `hergent_auth`** —— 后者在 `/opt/static` 全库 **0 处**，是 `/opt/hergent-cn-v2` 的机制。
playwright 要用 `ctx.add_init_script` 写 LS，同时注 `erp_token` cookie（**接口鉴权走它**）。只注 cookie ⇒ 停在 `#/login`，但 `/api/products` 之类照样 200，**极易误判成"已登录但没数据"**。
写接口还要过 CSRF：cookie `csrf_token` + 头 `X-CSRF-Token` 必须同值（`server.py:319`，缺任一 403 `CSRF_REQUIRED`；v711 C 组第一次跑 14 项全 403）。

**14. 「业务接口全正常、只有图片/附件裂」⇒ 查「带不了自定义头的请求」**
`<img>` / `<link>` / 下载 / `window.open` 都只能吃 cookie，发不出 `X-Tenant-Id`；`tenant_middleware` 对 `/api/*` fail-closed ⇒ 403 ⇒ 前端静默回落（v700 头像退回 🚀）。角色头像落盘在 `/opt/hergent-data/role-avatars/<tenant>/`（部署目录外，防 `rsync --delete`）。

**15. 改过的迁移不会重跑，也不会报错（v705）**
`_migrations` 只记 `(name,status)` ⇒ 名字没变就判"已执行"⇒ 老库旧 SQL、新库新 SQL，**两台都声称 ok**。
⇒ 新变更一律写 `migrations/patches/NNNN_名字.sql|py`；`schema_patches` 带 checksum，改已执行版本=**直接失败**。
两条连带纪律：**别 import `erp_db` 做任何体检/脚本**（导入期就跑 389 条迁移=会写生产）；`.sql` 别用 `executescript()`（隐式提交 ⇒ 留半截库）。体检 `python3 -m migrations.doctor`（只读）。

**16. 账不平先查重复写入，别先想"记哪一方"（v709 血案）**
判据两条：同一 `ref_type` 的 `created_at` 有几个时间点（多批次=重复导入）、每个父科目金额是否**逐分等于**其子科目合计（相等=父科目是派生行、不该当分录写）。
v709 就是靠这两条把 169 万"缺口"证伪成 4 轮导入 + 12 个父科目双写，删完差 **0.00**、**不编任何调整分录**。

**17. 补丁脚本幂等判据：先判「新串已在位」，再看旧串唯一**
`NEW = OLD + 追加` ⇒ **OLD 是 NEW 的前缀**，写 `if n_new>=1 and n_old==0` 会**再替换一遍**（语法合法、静默劣化，v709 把 `total_equity +=` 改成 2 行、多加 98,325）。必须加硬断言 `count(new)==1`。同族：回读校验**不能全文扫**（同文件常有合法同构/同名局部变量）。

**18. 批量改库的白名单别用 `startswith`**
`tenant_*` 会抓到 `tenant_1.pre-v617-*.db` 历史归档，**改它=篡改证据** ⇒ 用 `^tenant_\d+\.db$`；判主库必须 `realpath`（macOS `/var`→`/private/var`），判不出路径 fail-closed。

**19. 改口径先双算，验证必须人造边界**
生产数据上「改与不改一样」时，跑接口证明不了生效 ⇒ 隔离库造边界值（1 分差必判平、2 分差必判不平）+ 一条**反向对照**（老判据在同组数结论相反，证明新判据有区分力）。**反向对照要程序化挑选**：手挑的边界可能老判据同样给 False，等于什么都没验证（v710 第一版探针就栽在这）。

**20. 改完脚本先传，再执行（v710 事故）**
脚本带 `--revert`/`--apply`/删除语义时，本地与服务端版本不一致 ⇒ 它做的事和你以为的完全不同，**而输出看起来完全正常**（"已从备份恢复"，只是恢复错了目录）。同族：`rsync` 与 `scp` 串 `&&` 前者失败不阻止后者。

**21. 判据要看语义分家**
`abs(a-b) < 0.01` 用在「两笔钱是否同一笔」上，浮点下同一事实给相反结论（`50.00-50.01=0.009999999999998010` 判相等 / `100.01-100.00=0.010000000000005116` 判不等；v710 双算 69,186 次比较里 16,456 次相反）；用在「这个数是不是零」上则无所谓（`> 0.005` 保持原样，别硬统一）。

**22. `sqlite3.Row` 没有 `.get()`**
v711：purchase 的 ctx 写了 `o.get("order_no","")` ⇒ 采购过账 100% AttributeError。取值用 `o["x"] if "x" in o.keys() else 默认`。

**23. 补丁脚本另两条幂等纪律（v711 各踩一次）**
① **已经应用过的库上重跑时不能改 `NEW` 串的文字** —— 改一个标点就变成 `n_new=0 且 n_old=0` ⇒ 判「锚点不唯一」⇒ `patch_file` **整批回滚**；要改注释就单列一条替换。
② 「只针对旧形态」的升级项必须标 **optional** —— 干净副本上旧形态 0 次是**正常的**，按错误处理会连带跳过后面几项（v711 一次重放差 39 行）。
