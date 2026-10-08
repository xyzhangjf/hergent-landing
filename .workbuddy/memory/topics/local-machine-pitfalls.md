# 本机坑（macOS 开发环境）

> 索引页 `MEMORY.md` 只留一行指针 —— 这里是全文。
> ⚠️ **通用坑（grep 静默失效 / heredoc 写文件 / UI 数字带中文单位）已在用户级 `~/.workbuddy/MEMORY.md` 里，不在此重复**；本页只收 **Hergent 项目特有**的。

## 1. 舟谱导出的 xlsx 不能用 openpyxl `read_only=True`

舟谱导出文件的 `dimension` 声明异常 ⇒ `read_only=True` 模式下**只读出 1 行**，
实测 358 行的文件只回 1 行 —— **看起来完全像"空文件"**。

- ⇒ 一律用**常规模式**读（不用 `read_only`）。
- ⇒ 表头不在第 1 行时（如第 4 行），**按列名定位，不要按列序号硬编**。

## 2. 真机读 Hergent 表格数据不能用 `innerText`

Hergent 的**编辑态**把商品名称 / 规格 / 单位 / 客户数量都渲染成 `<input>`
⇒ `innerText` 读出来是**空的**，看着像「表里没这个商品」（v222 差点据此误判成缺陷）。

- ⇒ **必须读 `input.value`**。
- ⇒ 且**汇总表是视口 / 增量渲染**：实测 DOM 里只有 28 个 `<tr>`，另有 132 个只体现为**徽标计数**
  ⇒ 要找某个商品，先勾「**仅显示有报单**」把行数压小。
- ⇒ 默认视图是**逐单补录**（行名带「导入 … · N 人报」后缀），不是汇总表 —— 别拿默认视图当汇总表找。

## 3. cdp-lite 偶发 `Runtime.evaluate` 45s 超时 ≠ 页面死锁

先探一个平凡表达式（如 `1+1`，每 2s 一次）来分清「真死锁」与「抖动」：
实测同一次偶发超时，换法重跑就正常（侧栏 / 直达路由都 2s 内响应）。

## 4. 多条 grep 串在 `&&` 后会整串短路

`grep -c` 在**无匹配**时返回 exit 1 ⇒ 若用 `&&` 串联，后面的命令**根本不会执行**，
输出为空却**不报错**，看起来像"后面的判据也没命中"。

- ⇒ 多条断言一律用 `;` 分隔，让每条**各自可判**（能看到具体计数才叫跑过了）。
- ⇒ 与用户级记忆里那条「`grep "A\|B"` 静默失效」是同一族问题的两个面。

## 5. 🔴 注入到上下文里的「记忆快照」可能**早于磁盘**

2026-09-21 实测：同一会话里刚把 `MEMORY.md` 瘦身到 10489 B 并提交，下一轮注入的
`<working_memory_content>` 却是**瘦身前那份（~15.2KB）**，还附带一句
「你的 MEMORY.md 已超出上限、注入时被截断，请先清理」。

- ⇒ **判据一律以磁盘为准**（`wc -c .workbuddy/memory/MEMORY.md`），
  **不要按注入版本去重复瘦身 / 重复改** —— 那会把刚下沉出去的内容再删一遍。
- ⇒ 同族现象：注入版里的「已用到 vNNN」「最新版本」也可能落后 ⇒ 起号前的三连搜
  必须是**源码 + 磁盘记忆 + tools 目录**，不能只信注入版。
- 🔴🔴 **2026-09-26 新增同族坑：同一份「材料」里前后不一致时，我引了旧那半。**
  我按 `memory/2026-09-22.md:16`（表格行）写了「小程序**备案未获批**」，
  而**同一记忆树的 topic 章节** `miniprogram-and-brand-data.md §备案通过（2026-09-22）`
  与小程序仓库自己的 `真机E2E测试清单.md:7`（「备案通过后、提审前复检」）都写着**备案已通过**。
  ⇒ 那条表格行是**当天早些时候的快照**，已被后续事件推翻。
  **判据（建议固化成习惯）**：引用**状态类**事实（备案/上线/提审/审批/版本号）前，
  先看**那份 topic 章节**有没有更新的结论；**topic 章节 > 日表格行**。
  更进一步：**新写一段话之前，先读一遍你要改的那份文件** ——
  这次我新增的段落与该文件第 7 行**自相矛盾**，读一眼就能发现。

## 6. 🔴 `git ls-files -o` 对**含中文的路径会加引号转义** ⇒ 分类统计得到假结论

2026-09-21 实测：清未跟踪文件时，`git ls-files -o --exclude-standard | grep "^outputs/"`
算出「outputs 下只有 8 个 png、0 个非 png」—— **完全是假的**，差点据此误判范围。
真因：git 对非 ASCII 路径输出成 `"outputs/\344\270\255\346\226\207.png"`（**首字符是引号**）
⇒ `grep "^outputs/"` 与 `grep "\.md$"` **全部匹配不到**。

- ⇒ 正确取法：**`git ls-files -o --exclude-standard -z | tr '\0' '\n'`**
  （或 `git status --porcelain -z`），拿到的是**未转义的原始路径**。
- ⇒ 影响面：任何「按目录 / 扩展名统计未跟踪文件」的判据都会失真 —— 中文文件名在本项目极常见。
- ⇒ 同族：`grep "A\|B"` 静默失效（用户级记忆）＋ `&&` 短路（本页 §4）。

## 7. `git add` 的两个用法约束（批量入库时必踩）

- 🔴 **`--pathspec-from-file` 不能与路径参数同用**：
  `git add --pathspec-from-file=f.txt .gitignore` ⇒
  `fatal: '--pathspec-from-file' and pathspec arguments cannot be used together`
  ⇒ 须**分两步**（先 `git add <单文件>`，再 `git add --pathspec-from-file=…`）。
- 🔴 **中文路径要配 `GIT_LITERAL_PATHSPECS=1`**：否则 pathspec 里的 `[` `*` `?`
  会被当 glob 解析，可能匹配到意料外的文件（2026-09-21 入 119 个中文交付文档即用此变量）。
- 配套：入库前的**凭据扫描只扫待入库文件**（用 `git ls-files -o -z` 生成清单），
  别全仓扫 —— 会有大量历史噪音（本次全仓 `-S` 查证才需要）。

## 8. 清未跟踪文件的分批纪律（2026-09-21 实操定式）

先分类再动手，**按「体积风险」而不是「目录」分批**：

| 批次 | 判据 | 处理 |
|---|---|---|
| 脚本类（`tools/`） | 纯文本、体积小 | 直接入库（配凭据扫描） |
| 文档类（`*.md`/`*.txt`/`.diff`/`.wxss`） | 纯文本、是交付资产 | 入库 |
| 图片类（`*.png`） | **体积黑洞**（本次 232 个 = 35.5 MB） | 🔴 **不入库** ⇒ 加 `.gitignore`（见 §9） |
| 备份/临时（`backups/` `tmp/` `*.bak*`） | 可再生、无价值 | **加 `.gitignore`** |
| 他人源码 | 非本批范围 | **不碰** |

- 仓库历史上有 `filter-branch` 把 859MB 清到 10MB 的记录 ⇒ **图片入库要单独立项决策**。
- `.gitignore` 的**目录匹配陷阱**：`backup/` 与 `/tmp/` **只匹配仓库根下的同名目录**，
  匹配不到 `.workbuddy/backups/`、`.workbuddy/tmp/` ⇒ 需显式列出带路径的规则。

## 9. 🔴 排除「截图/二进制」时的三条判据（2026-09-21 v234 实操）

**规则写法**：必须**锚定到「证据目录」**，不能全局 `*.png` —— 本仓**已跟踪 241 个 png**
（`avatars/` 16 · `landing-page/` 16 · `hergent_mobile/` 35 · `desktop-app/` 26 ·
小程序 14 · `assets/` 3 · `.workbuddy/` 5 · `outputs/` 121…）全是**产品资源**或历史证据，
全局通配会**静默吞掉将来新增的头像/落地页/小程序图标**。正解：

```gitignore
/outputs/*.png          # 交付产出目录
/outputs/**/*.png       # 含中文命名的子目录
/artifacts/*.png        # artifacts/ 已跟踪文件全是 md 交付说明
/assets/ai-*.png        # 精确到截图前缀（assets/ 里有 icon*.png 真资源！）
/assets/role-*.png
```

**🔴 验证必须用 `--no-index`**：`git check-ignore` **默认跳过已跟踪文件**
⇒ `git ls-files -z | git check-ignore --stdin -z` **恒返回 0 行**，看着像「零误伤」，**其实是空判**。
必须 `… --no-index` 才会报出被规则命中的已跟踪文件（本次报出 121 个，**全在 `outputs/`**，
属历史已入库的截图，忽略规则**不改变其跟踪状态**；除 `outputs/` 外零命中 = 真·零误伤）。

**🔴 §6 的镜像：`git ls-files`（不带 `-z`）同样引号转义** ⇒ 已跟踪文件计数也漏数：
本次把已跟踪 png 数成 **102**（实际 **241**）、`outputs/` 已跟踪 png 数成 **2**（实际 **121**）——
因为带中文的路径输出成 `"outputs/…png"`、**行尾是引号** ⇒ `grep '\.png$'` 匹配不到。
⇒ 凡「按扩展名统计已跟踪文件」一律加 `-z | tr '\0' '\n'`。

**三条验收**：① 未跟踪数收敛（本次 234 → 2）；② `--no-index` 断言**除证据目录外零命中**；
③ `find <dir> -name '*.png' | wc -l` 证明文件**仍在本地磁盘**（被忽略 ≠ 被删）。

---

## 🔴 无头 Chrome（puppeteer-core + 系统 Chrome）在本机必须加四个启动开关

**症状**（2026-09-25 实测，排查两轮）：同一脚本十分钟前能跑，之后开始报
`FATAL Timed out after waiting 30000ms`（卡在 `newPage()`）
或 `Protocol error (Emulation.setTouchEmulationEnabled): Session closed. Most likely the page has been closed.`（卡在 `setViewport`）。
**看着像脚本 bug / 浏览器崩了，其实是启动参数缺了。**

**确诊手法**：`launch({ ..., dumpio: true })` 才会打印真正的 stderr：

```
sandbox initialization failed: Operation not permitted      ← Chrome 自身沙箱被本机沙箱拒
GPU process exited unexpectedly: exit_code=6
FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc:417] GPU process isn't usable. Goodbye.
```

**修法（照抄）**：

```js
args: ['--no-proxy-server', '--no-sandbox', '--disable-setuid-sandbox',
       '--disable-gpu', '--disable-software-rasterizer',
       '--disable-dev-shm-usage', '--no-first-run']
```

- `--no-sandbox` / `--disable-gpu` **不是可选项**（本机沙箱下必加）。
- 再配 `page.setDefaultTimeout(8000)`：下拉弹层会遮住别的元素，默认 30s 才报错。
- 脚本用 **CJS（`require`）**：ESM（`import`）**不认 `NODE_PATH`** ⇒ `ERR_MODULE_NOT_FOUND`。
- 🔴 **通用判据**：「同一脚本十分钟前能跑、现在跑不了」**先怀疑环境（启动参数 / 残留进程 / 资源），
  不要回滚代码**。用最小探针（`launch → version → newPage → setViewport → goto`）逐段定位，
  比在长脚本里猜快得多。

**PII 落盘红线**：`outputs/` 是被 git 跟踪的（含 **121 个已跟踪 png**，见上文 §6）⇒
手机号 / 邮箱等**只填表单、不写文件**；脚本走环境变量，文档里打码，收尾 `grep -rn` 自证为空。

## 10. 🔴 往生产跑诊断脚本的四条（2026-09-26 一次性踩齐）

1. **heredoc 经 `ssh` 传过去会把引号吞掉** —— `ssh host 'python3 - <<PY ... PY'` 里
   `(r[3] or '')` 到达对端变成 `(r[3] or )` ⇒ `SyntaxError: invalid syntax`。
   **即使本地写法完全正确**也会中招（多层引号嵌套时 shell 剥了两层）。
   ⇒ **含引号的脚本一律「本地 `Write` 落盘 → `scp` → 远端执行」**，不要用 heredoc。
2. **服务器上没有 `sqlite3` CLI**（`/opt/hergent-erp` 这台）⇒ 一律
   `runuser -u hergent -- python3 <脚本>`。用 `runuser -u hergent` 而**不是 root** 跑，
   免得新文件落成 root 属主。
3. 🔴 `runuser -u hergent` **不能 `systemctl restart`**（`Interactive authentication required`）⇒
   重启必须**另开一条 root 的 ssh** 执行。把「改文件 + 重启」写进同一个 hergent 脚本**会静默半途失败**
   （脚本里 `subprocess` 返回 rc=1，但前面的删文件/改登记已经生效了 —— 看起来像"重启了但没生效"）。
4. **只读打开「备份文件」必须加 `&immutable=1`**：备份没有 `-wal`/`-shm` 兄弟文件，
   单纯 `mode=ro` 会让 SQLite 尝试创建 `-shm` 而被拒（`attempt to write a readonly database`）。
   写法：`sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)`。
   ⚠️ 另外：要比对「当前最新」时，克隆生产库要用 `Connection.backup()`，
   **不能用 `shutil.copy2`**（WAL 下最新提交可能还在 `-wal` 里）。
   🔄 **2026-09-26 订正**：此处原写「只读连接读不到 WAL 未 checkpoint 的部分」—— **这句是错的**，
   已按本轮实证改掉。真相见 **§11**：以库属主身份运行时 `mode=ro` **能**读到 WAL 最新提交；
   真正读不到的是**加了 `immutable=1`** 的情况（= 主动告诉 SQLite「文件不会变」）。

---

## 11. 🔴🔴 SQLite 只读打开的**两个方向都踩过**：活库不许 `immutable`，备份必须 `immutable`（2026-09-26 v279f 误判实录）

上一条（§10.4）只讲了备份那一半，**漏了另一半，本轮就栽在它上面**。

| 读谁 | 正确写法 | 写错的后果 |
|---|---|---|
| **活库**（`/opt/hergent-erp/tenant_*.db`，服务正在跑） | `sqlite3.connect("file:%s?mode=ro" % p, uri=True)` | 加 `&immutable=1` ⇒ **静默读到 checkpoint 之前的旧页**（`-wal` 里的最新提交看不见） |
| **静态备份文件**（`backups/…/*.bak`，无 `-wal`/`-shm` 兄弟） | 必须 `&immutable=1` | 不加 ⇒ `attempt to write a readonly database`（SQLite 想建 `-shm` 被拒） |

**为什么活库不加 immutable 也能读 WAL**：只读连接读 WAL 需要能写 `-shm`。
以库属主（`hergent`）身份运行时 `-shm` 可写 ⇒ **`mode=ro` 就能读到最新提交**。
`immutable=1` 的语义是「这个文件不可能变」，SQLite 据此**跳过 WAL 与缓存校验** —— 它不是"更安全的只读"，
而是"**假设它不会变**"。活库违背这个假设 ⇒ 读到旧数据。

**本轮的代价**：验收脚本对现网库加了 `immutable=1`，写入其实全部成功（HTTP 200 + 读端接口能看到新值），
但快照层「1596 没变 / 期次19 清单 0 行 / 目标 0 条」⇒ **一口气 7 条断言假 FAIL**，
差点据此得出「写入没生效」的错误结论。

**判据**：**同一份数据，必须同时用「接口读端」和「直读库」两条路各取一次并互相比对。**
只有一条路时，「读到旧值」和「真的没写进去」在屏幕上长得一模一样。

---

## 12. 🔴 探针必须先自证判别力 —— 否则整轮验收等于没做（v293 起，v297 复证）

**症状**：验收脚本全绿，但**它本来就不可能失败** —— 判别值恰好等于旧口径值 / 恰好在两套口径下同值。

**判据（三条，缺一即无判别力）**：
1. **先断言「新值 ≠ 旧值」**（或注入一个已知会被拦的反例）。不满足 ⇒ **抛错退出，不硬凑 PASS**。
2. **正反两侧都要有**：只有"硬拒 N 条"不够，必须配"放行 M 条"作正对照；
   **把 N / M 的数字写死在断言里**（不是"跑通即通过"）。
3. **别把「接口返回的第一条」当成「页面正在看的那条」** —— 页面可能按别的排序/过滤。

📏 v297 实证：`report_mapping` 方向断言写作 **硬拒 6 / 放行 9**（数字写死）。
✅ 附带好处：一旦数据漂移（如另一会话新增了一行），断言会**立刻响**，而不是继续"全绿"。

**同族**：判别串要挑「**本轮新增 + 无条件渲染**」的文本 —— 挑到别轮就有的串，会把"改动没生效"判成"已生效"。

---

## 13. 🔴 「夹带断言」在**中文路径**上会**假阳性** —— `git` 默认对非 ASCII 路径做八进制转义（v299 实测）

**现象**：受控提交后跑「索引里不得含非本轮文件」的断言，脚本报 ❌ 列出 7 个"非本轮文件"，
但那些**明明就是本轮产物**（只是文件名是中文）。

**真因**：`git diff --cached --name-only` 默认 `core.quotepath=true`
⇒ 非 ASCII 路径被输出成 `"outputs/\345\256\232\346\227\266..."` 八进制转义形式
⇒ 脚本里 `grep -v -e "outputs/定时任务修复-2026-09-27/"` **匹配不上** ⇒ 全被判成"非本轮"。

**修法（二选一，都用过）**：
```bash
git -c core.quotepath=false diff --cached --name-only        # ① 本次：临时关掉转义再比
git diff --cached --name-only -z | tr '\0' '\n'              # ② 彻底：NUL 分隔，不做任何转义
```

⇒ **通用判据（这次踩的是"探针自己"）**：任何"白名单/黑名单比对"脚本，
**先用一个已知该通过的样本自证** —— 若它把**已知正确的输入**判成违规，就是**探针的错**，不是被检对象的错。
⚠️ 这正是 `§12 探针必须先自证判别力` 的**反面形态**：§12 防的是"漏报"（假绿），
本条防的是"**误报**（假红）" —— 两者都会把排查带偏，**假红尤其费时间**，因为它伪装成"出事了"。

---

## 14. 🔴🔴 `vite build` 会在本机**被安全删除守卫拦下**（2026-09-27 v301 **复踩**）

> ⚠️ **这不是新发现**：技能 `hergent-frontend-deploy-verify` 里**早已记录**（v206 实测），
> 连解法都一模一样。本轮**复踩**的唯一原因是「接到改前端文案的任务后直接 `npm run build`，
> 没有先加载该技能」。**这里保留一份，是为了让不做部署、只做构建的场合也能撞见它。**

**现象**：`npm run build` **2 秒即失败**，报错看起来完全不像环境问题：

```
error during build:
[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":54,"threshold":50,
  "scope":"turn","targets":[".../hergent-cn-v2/dist/assets"],"targetCount":1}
    at checkBulkDeleteGuard (.../cli/vendor/shim/node-safe-delete-shim.cjs:239:19)
    at emptyDir (.../vite/dist/node/chunks/dep-*.js)
```

**根因**：vite 构建前会 `emptyDir(outDir)` 清空 `dist/`。`dist/assets` 累计 **53–54 个文件**，
**超过守卫的单轮批量删除阈值（50）** ⇒ 守卫拒绝执行 ⇒ **构建中止**。
⚠️ **这不是代码问题、不是依赖问题、不是 vite 配置问题** —— 报错里出现
`node-safe-delete-shim.cjs` 就该直接往这个方向想，**别去查 SFC/语法/依赖**。

**正解（不绕过守卫）**：**先把 `dist` 整体 `mv` 走，再构建** ——
`mv` 是**单次重命名**，不产生批量删除，守卫不介入；vite 随后**从零创建** `dist/`（无需清空）。

```bash
cd <前端项目>
mv dist /tmp/<proj>-dist-bak-$(date +%Y%m%d-%H%M)   # 单次 rename，安全
npm run build                                       # 此时不触发守卫
```

**另一种正解（2026-09-28 v309 实测）**：直接**换输出目录**，连 `mv` 都不需要：

```bash
npx vite build --outDir dist-<本轮号> --emptyOutDir   # 全新目录 ⇒ 没有批量删除 ⇒ 守卫不介入
```

`dist/` **原地不动**（旧基线自然保全），且与 `mv` 分支产物**逐文件 md5 一致**（v309 实测）。
适合「只做构建/验证、暂不部署」或「怕 `mv` 期间有别的会话在读 `dist`」的场合；
要交付**规范目录**时仍走上面的 `mv + npm run build`。

🔴 **两条连带纪律**（都来自这次踩坑）：

1. **别覆盖既有的 `dist`**：仓库里的 `dist/` 是**上一次某个基线的产物**，可能是当前生产对应的版本。
   用上面这个"移走再建"的做法，**旧 dist 原地保全**；若要恢复，`mv` 回来即可。
   如果顺手把它删了/覆盖了，就等于**丢掉了一个基线参照物**。
2. **`dist` 脏 ≠ 能部署**：本项目 `src/` 常有多会话在途改动（这次 25 个 M + 5 个 ??），
   `Forecast.vue` 单文件就有 570+/61− 不属于本轮 ⇒ **构建成功只证明"能编"，不证明"能上线"**。
   部署前仍须核「线上 == HEAD」这条前提（→ `deploy-ops.md` / `hergent-parallel-session-safety`）。

**守卫本身**（供识别，**不要去关它**）：`CODEBUDDY_SAFE_DELETE_BULK_GUARD` 由宿主注入，
是本机防误删的保护机制。**正解是让构建不需要批量删除，不是去禁用守卫。**

> 📌 **v300（2026-09-27 晚）又踩了一次**（同一晚第二次）。计数更新：**v206 首见 → v300 与 v301 各复踩一次**。
> 说明「接到改前端文案的任务就直接 `npm run build`」这个反射**极其顽固**。
> 📌 **v309（2026-09-28）第三次复踩** —— 同一个反射。本轮用上面那条「换 outDir」分支绕过；
> ⚠️ 但**代价是产物不在规范目录**，若当轮要交付规范 `dist/` 还得多跑一次 `mv + build`（本轮跑了两次构建）。

---

## 15. 🔴🔴 打生产页面前**先确认路由模式**，否则路径会被静默落回默认页（2026-09-27 v300 实测）

**现象**：探针 `page.goto('https://hergent.cn/archive')` 后，`location.href` 变成
**`https://hergent.cn/archive#/workbench`** —— 页面**正常渲染、零报错**，但渲染的是**工作台**，
所有目标选择器（`.df-ops` / `.acc-role` / 表格）**全部找不到** ⇒ 看起来像"功能根本没上"。

**根因**：hergent.cn 前端是 **vue-router `createWebHashHistory()`**（**hash 模式**，
`src/router/index.js:7/46`）⇒ 真地址是 **`https://hergent.cn/#/archive/employees`**。
- 访问 `/archive` 时 nginx 把 `/archive` 当**路径**回落到 `index.html`，hash 段为空 ⇒ 路由落**默认页**。
- 若写成 `/#/archive`（v296 探针的写法）能进父路由，但**子路由要靠 `redirect`**；
  `/archive` 的 redirect 目标是 `/archive/employees` ⇒ **直接写全 `/#/archive/employees` 最稳**。

**判据（动手前 30 秒自查）**：
1. `grep -n "createWeb" src/router/index.js` —— 看到 `createWebHashHistory` ⇒ **所有深链都要带 `/#/`**。
2. 探针里**断言 `location.href`**（或打印它），别只看"页面出东西了"。**页面能渲染 ≠ 在目标页。**

🔴 **同型陷阱**：本项目**两套前端路由模式不同** ——
`hergent.cn`（hergent-cn-v2）= **hash**；旧前端 `erp.hergent.cn/admin/`（`hergent-erp/static`）= **path**。
⇒ **拿旧前端的 URL 习惯套新前端**，就会得到上面这个"看着正常、其实在别的页"的结果。

---

## 16. 🔴🔴 同一条消息里的**两个 Bash 调用是并行的** ⇒ 临时文件会竞态（2026-09-27 v300 实测）

**现象**：把「写临时文件」与「读该文件做对比」拆成**同一条消息里的两个 Bash 调用**后，
第二个调用报 `grep: /tmp/c-ea.vue: No such file or directory`，且计数**打印为空白**
—— 看起来像「对比没差异」，实际是**根本没读到文件**。

**根因**：同一条 assistant 消息里的多个工具调用**并发发起**，Bash 之间**没有先后保证**。
脚本 A 刚 `> /tmp/c-ea.vue`，脚本 B 已经在 `grep /tmp/c-ea.vue`。

**纪律**：
1. **写文件 → 读文件**这种有数据依赖的步骤，**必须放进同一个 Bash 调用**（用 `&&` / `;` 串起来）。
2. 只有**互不依赖**的只读命令（`git log` / `git status` / `wc -c`）才能并行。
3. 🔴 **判据**：假如两个调用的输出**存在依赖关系**（B 的输入来自 A），它们就**不能并行**。

---

## 17. 🔴 `grep -c` 在**计数为 0 时 exit 1** ⇒ 挂在 `&&` 后面会**整链短路**（与 §4 同族、机制不同）

**现象**：`git show HEAD~1:<path> | grep -c 'F2 报单汇总' && echo "存在=1"` ——
上游**确实没有**这个串（期望结论「不存在」），但 `grep -c` 返回 **0 且 exit 1** ⇒
`&&` 后面的 `echo` **不执行**；若写成 `|| echo "不存在"` 则会**打出正确结论**，
而写成 `&& echo` 的变体（如 `... && echo "存在"` 被 shell 视为失败继续）就会让人**拿到反了的结论**。

**纪律**：
1. 🔴 **凡是只想拿"计数"而不想让退出码参与判断的**，一律把命令包进 `$(...)`：
   `echo "次数 = $(... | grep -c 'X')"` —— 子 shell 的 exit code **不影响**外层语句。
2. `grep -c` 与 `-e A -e B` 混用时同样成立（`-e` 只解决**匹配**，不解决**退出码**，见 §4 / 用户级记忆）。
3. 本条与 §4 是**两个独立机制**：§4 = 多模式 `\|` 写法让 `grep` **匹配为空**；
   §17 = 匹配**本来就该为空**时 `grep -c` 的**退出码**把 `&&` 链咬断。

---

## 18. 🔴🔴 **import 即迁移**：只要 import 链里有 `erp_db`，不设 `ERP_DB_PATH` 就会**对真库跑 DDL**

**根因（读代码得出的硬事实）**：`erp_db.py` 在**模块顶层**就调
`_safe_migrate(...)` / `_safe_migrate_script(...)`（实测行号 `erp_db.py:451` / `:468` / `:718` / `:727` …），
而 `DB_PATH` 来自 `db/connection.py:11` 的 `os.environ.get("ERP_DB_PATH", <默认 server/erp.db>)`
⇒ **任何** import `erp_db` 的脚本/测试，只要没设这个环境变量，就**直接对真库执行那批 DDL**。

**为什么极难自己发现**：
- **大小不变**（`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` 命中已存在的对象 ⇒ 幂等 no-op，
  文件长度一模一样）⇒ `ls -la` 看 size **完全看不出来**。
- **零输出、零报错**（幂等错误被 `_is_idempotent_migration_error` 过滤掉了）。
- 唯一可见的痕迹是 **mtime**。⇒ **真库零污染自证的判据必须是 mtime（+大小），只比大小等于没比。**

**踩点（2026-09-28 实证）**：`tools/probe-experience-catalog.py` 自称"只测纯函数"，
但 `from routers.loss_workflow import ...` 顺带 import 了 `erp_db` ⇒ 每跑一次就动一次真库
（`server/erp.db` mtime 从 08:45 变 09:16，大小 3829760 一路不变）。
**逐个跑、盯 mtime** 才定位到（t13/t15/t16 三个都已正确隔离，唯独它没有）。

**纪律**：
1. 🔴 判据一句话：**「只测纯函数」≠「不碰数据库」** —— 看的是 **import 链**，不是"我调了什么函数"。
   只要链里有 `erp_db` / `core` / `routers.*` / `server`，就必须先隔离。
2. 隔离动作**必须在第一个 server 模块 import 之前**执行（`ERP_DB_PATH` 在 import 时被读到，
   事后设置无效）。
3. 自证方式：脚本开头记 `(mtime, size)`，结尾再记一次并**断言相等**；
   `ok()` 项里同时含 mtime 与 size。⇒ 现在四个探针都带这条自证。
4. 影子库应**每轮从真库重置**（`shutil.rmtree` + `cp` 主库与 `tenant_*.db`，`-wal`/`-shm` 一并拷）。
   ⚠️ 不重置会让"起点写死预期 0"的断言在第二遍集体变红 ⇒ **看起来像代码回归，其实是前提没保证**
   （t15 实测：第二遍 9 条 FAIL，全是假的）。探针不可重跑 = 不可复现。
5. **已知未修（不是本轮范围，勿静默改别人文件）**：`server/tests/`
   `test_period_prev_v273.py`、`test_rhythm_only_rule_v282.py`、`test_user_rename_v288.py`
   三个文件 import server 模块但 **`ERP_DB_PATH` 出现 0 次** ⇒ 直接跑会写真库。修法同上。

---

## 19. 🔴 浏览器语音输入「真机测试」的四个坑（2026-09-28 一次踩齐）

**场景**：要验「点麦克风按钮能不能真的识别」。这类测试有个特点：**功能全在浏览器侧**，
所以既要测应用接线，又要测浏览器与网络——**两者的结论不能互相顶替**。

### 19.1 🔴 Chrome 同时暴露**两个**构造器，替换/包装必须**两个都做**
`window.SpeechRecognition` **与** `window.webkitSpeechRecognition` 在现代 Chrome 里**都存在**，
而 `useVoiceInput.js` 取的是 `window.SpeechRecognition || window.webkitSpeechRecognition`
⇒ 只包 `webkitSpeechRecognition` 时，**应用走的是没被包的那个**，
表现为「点击后事件列表 / 模拟结果全都为空」，看起来像**按钮没接线**（实际是探针自己漏了）。
判据：包装后先断言 `[!!window.SpeechRecognition, !!window.webkitSpeechRecognition]` 两个都为 true，
且**以应用实际取用的那个为准**。

### 19.2 `--use-fake-device-for-media-stream` **喂不进语音识别**
- 它 + `--use-fake-ui-for-media-stream` 能让 `getUserMedia` 成功（设备名 `Fake Default Audio Input`），
  但 `SpeechRecognition` 走的是**另一条特权采集通道**，不认假设备 ⇒ 报 **`audio-capture`**。
- ⇒ **别用 `audio-capture` 判定"用户的麦克风坏了"** —— 那是自动化环境的限制。
- ⇒ 反过来说：**麦克风/识别路径无法在本机无头环境里做端到端正向验证**；
  要正向证据只能靠「浏览器层能否连到语音服务」+「应用侧结果渲染」两段分别证。

### 19.3 本机没有真中文 TTS 声音，`say -v Eddy` 会产出**哑文件**
- `say -v '?' | grep zh_CN` 列出的 `Eddy/Flo/Grandma/...` 是**新奇(novelty)声音**；
  用**短名** `say -v Eddy -o a.aiff "中文"` 会静默产出 **4800 字节**的哑文件（每次一样大）。
- ✅ 必须用**完整声音名**：`say -v 'Eddy (中文（中国大陆）)' -o a.aiff "库存还有多少"` → 79KB（约 3.6s 真音频）。
- 转 Chrome 假麦克风要的格式：`afconvert -f WAVE -d LEI16@16000 -c 1 a.aiff a.wav`（16k/mono/16bit）。
- 🔴 **自证**：转完必须用 `wave` 读一次 `getnframes()/getframerate()`；只 `ls -l` 看字节数会漏掉
  「头里 nframes=320（0.02s）」这种**哑文件也能有 4.5KB** 的情况。

### 19.4 在页面里做网络探测**必须带超时**
`page.evaluate(() => fetch('https://www.google.com/...'))` 在**黑洞网络**下会挂很久（不是快速失败），
整个探针被宿主 SIGTERM（`exit=137`、**stdout 还因为管道缓冲全丢**，看起来像"脚本没跑"）。
⇒ 一律 `fetch(url, { signal: AbortSignal.timeout(5000) })`；`mode:'no-cors'` 只能判"有没有到"，
判状态码要用可 CORS 的地址。

---

## 20. 🔴 「浏览器说支持」≠「能用」：Chrome 的 `available()` 不检查网络（2026-09-28 实测）

`SpeechRecognition.available({langs:['zh-CN'], processLocally:false})` 返回 **`"available"`**，
但同一台机器上 `fetch('https://speech.googleapis.com/')` **5 秒超时**。
⇒ 云端可用性**只看浏览器自己的登记表，不探网**。
判据：**「能力声明」与「实际连通」是两件事**（与本项目「接口 200 ≠ 数据正常」同族）。
另：`processLocally:true` 查中文得 **`downloadable`** ⇒ 设备端模型**存在但未装**，
代码若不显式设 `r.processLocally = true`，永远走云端那条路。

---

## 21. 🔴🔴 共享追加日志**只能 append**；被覆盖后可从**会话留痕**重建（2026-09-29 真实事故）

**事故**（我自己造成、已恢复）：把当天新段落写进 `.workbuddy/memory/2026-09-29.md` 时，
两件事同时做错 —— ① 用 `open(p,'w')` **覆盖**了它（该文件当天已被另外两个会话写了 4 个章节）；
② 用「锚点行 → 文件末尾」切片，把一个段落在两个文件间搬运，结果**连带搬走了 09-28 日志里别人
追加的 793 行**。

### 21.1 两条根因（都是"默认了自己的假设")

1. **写"共享追加日志"前不判存在**。`memory/YYYY-MM-DD.md` 是**多会话共享的追加文件**，
   任何时刻都可能已被别人创建/写满。⇒ **必须** `os.path.exists()` 判断 + `open(p,'a')` 追加；
   **永不**对这类文件用 `'w'`（`'w'` 只在"确认要整写、且已备份"时用）。
2. **「锚点 → EOF」切片**假定"我的段落就在文件末尾"。多会话下**别人的内容随时会追加在更后面**
   ⇒ 切片越界、跨文件搬运。
   ✅ 正解：**双向锚点**（起点串 + 终点串，两个都要能找到且次序正确），找不到终点就**停手报错**；
   或先 `cp` 一份快照，diff 确认边界后再动。

### 21.2 恢复配方（**实测可用**，无需快照/Time Machine —— 本机都没有）

被覆盖的记忆文件可以从 **会话留痕**重建：`~/.workbuddy/projects/<项目slug>/*.jsonl`
（每个会话一个 jsonl，**完整保存了该会话的每次工具调用**，含 `Write.content` / `Edit.new_string` /
Bash 的 `cat >> … <<'EOF'` 原文）。

```python
# 关键三步（脚本骨架见 /tmp/recover-build.py）
# ① 记录是 JSONL；工具参数**常常是嵌在字符串里的 JSON** ⇒ 必须先把 s.json.loads 解一层
#    （直接找 key='command' 会 0 命中 —— 本轮先因为这个空跑了两次）
# ② 三种写入形态都要收：Write.content（整写）/ Edit.new_string（追加，需减去 old_string 前缀）
#    / Bash heredoc（用 re 抓 <<'EOF' … EOF 之间的正文）
# ③ 按**时间戳字段**（record 的 timestamp/createdAt，毫秒要 /1000）排序拼接，而不是按会话或行号
```
**完整性自证（必做）**：从留痕里再捞**当时会话自己跑的读数**（`wc -l` / `tail` 的输出）与重建结果对照
—— 本轮拿到 `76 → 119` 两条历史行数，与重建序列吻合；再用关键事实串（版本号/数字/小标题）逐条 grep 非零。
**兜底反查**：另跑一遍"有没有别的写入方式"的扫描（`open(` / `sed -i` / `tee` / `printf >` / `>>`），
确认没有漏掉的写入路径（本轮只有 1 条 `cat >>`，已收）。

### 21.3 判据
- 任何"搬运/重排共享文件内容"的操作，**先 `cp` 备份 + 打印文件行数与头尾各 3 行**；动完再打一次。
- 事故发生后**第一件事是停手 + 找源**，不要在原文件上继续修补（会覆盖更多现场）。
- 恢复后必须报**交叉污染 0 / 重复 0 / 行数**三类读数（本轮：0 / 0 / 1918+218）。

---

## 22. 🔴🔴 `comm` 的差集是假的：macOS 与 Linux 的 `sort` **排序规则不同**（2026-10-01 v351 实测，差点按假清单部署）

**踩法**：`comm -23 本地清单 生产清单` 求"该传哪些文件"，得出「**52 个待上传**」。

**真值**：**30 个**。差的 22 个是**误报**。

**根因**：`comm` 要求两侧**按同一种序**排好。macOS 的 `sort` 与 Linux 的 `sort` 在 `-` `_` `.` 这些字符上的 **collation 不同**
（文件名的 hash 段恰好大量含这些字符）⇒ 两侧虽都"排过序"，却不是同一种序 ⇒ `comm` 输出**垃圾**（既不报错、也不空，是**貌似合理**的错数）。

**怎么发现（关键手法）**：拿一个具体文件名回查 —— `Archive-FHZG7KfX.css` **同时**出现在"生产缺失"清单和"生产 08:46 批次"清单里。
**同一个文件不可能既缺又在** ⇒ 自相矛盾 ⇒ 回头怀疑工具，而不是相信数字。

> 🔴 **纪律**：差集/交集结果**必须抽一条具体记录回查两侧**，证明它"既缺又在"是不可能的。
> 只看总数（52 vs 30 都"像个数字"）**永远发现不了**。

**正确做法**（本仓已在 `deploy-ops.md` 立为铁律：**比字节不比名**）：不要比名字，比 **md5**。
```python
# ① 拉生产全量 md5；② 本地逐文件算 md5
# ③ 三分：同名同字节 / 同名不同内容(危险) / 名字新(再分"字节已有"与"字节也新")
```
若确实要用 `comm`：两侧都加 `LC_ALL=C sort` **强制同一种序**。

---

## 23. 🔴 `scp $FILES ...` 在 **zsh** 下只传得动一个文件（zsh 不做词分割）—— 曾把线上入口指向缺失文件

**踩法**：
```zsh
FILES=$(sed 's|^|/tmp/dist/assets/|' list.txt | tr '\n' ' ')   # 30 个路径拼成一串
scp -q $FILES root@host:/opt/app/assets/                        # ← 只传了"一个"文件
```
报错形如 `scp: stat local "/a.js /b.js /c.js …": No such file or directory` —— **整个串被当成一个文件名**。

**根因**：**bash 会把未加引号的 `$VAR` 按 IFS 拆词，zsh 默认不拆**。本机默认 shell = zsh ⇒ 从 bash 抄来的写法静默变形。

**本轮为什么危险**：脚本是"先传 chunk、后传 `index.html`"的两条命令 —— chunk 那条失败但**没有 `&&` 拦住下一条**
（第一条 `scp` 失败后我用 `;`/换行继续）⇒ `index.html` 传上去了 ⇒ **线上入口短暂指向尚未上传的 chunk**（页面白屏）。
发现后 30 秒内用数组补齐恢复，但这是**可避免的**生产事故。

**正确做法**（二选一）：
```zsh
FILES=($(cat list.txt))                    # zsh 数组
scp -q "${FILES[@]}" root@host:/opt/app/assets/

# 或
xargs -a list.txt -I{} scp -q {} root@host:/opt/app/assets/
```

🔴 **配套纪律**：
- 批量上传后**必须**做「双侧逐文件 md5 核对」（只对 1 个文件报 `ok` 是**不够**的 —— 本轮第一次输出里我看到了 `✅ index.html 上传完成`，而 chunk 那条是报错的，**两条命令的成败要分别断言**）。
- 多步上传**串 `&&`**，任一步失败就停，别让"后一步成功"掩盖"前一步失败"。


### §24 `ls -lt` 的 `--time-style=+%H:%M` **丢日期**（2026-10-02 实测踩到）

```bash
ls -lt --time-style=+%H:%M /opt/hergent-cn-v2/assets/index-*.js
# → index-1ZfsDoC9.js 21:59 / index-CWx0QzFq.js 21:11 / index-DIqaPdmx.js 20:45
# 「21:59」看着比当前时间(21:08)还晚 —— 因为它其实是**昨天的** 21:59。
```

我据此一度判断「另一会话正在高频部署（四次）」，实际 10-02 只有三次（12:00/16:55/20:23）。
🔴 **纪律**：跨天比较时间戳**必须带日期** ⇒ `--time-style=+'%m-%d %H:%M'`。
🔴 更一般地：**任何「时间倒序」输出若不带日期，都不能用来推断「刚刚发生了什么」**。

### §25 zsh 里 `$k{` 会被当**算术表达式**

```bash
for k in st- sev-; do grep -rhoE ".$k[a-z]+" src/; done   # (eval): bad math expression
```
`$k[` / `$k{` 触发参数展开的算术语法 ⇒ **报错但 exit 0**，输出为空，看着像「无匹配」！
🔴 **正解**：多模式一律 `grep -e`，或把变量放进引号内 `"\.${k}[a-z]*"`，或干脆改用 Python。
🔴 **同族**：`grep "A\|B"` 静默失效、`| head -N` 截掉决定性命中、`&&` 短路（§10–§12）。

### §26 🔴 sandbox escalate 会让**副作用命令执行两次**（2026-10-02 深夜实测，差点让「生产基线」对错）

**现象**：一条带 `mv dist /tmp/dist-v366base-$TS` 的构建命令，返回 `⚠️ Sandbox bypassed (escalation-approved)`
—— 沙箱内先试跑了一次、escalate 批准后又跑了一次。`$TS` 取 `date +%H%M%S` ⇒ 生成**两个目录**：

```
drwxr-xr-x  6 zhangjunfeng  staff  192 Oct  2 23:01 /tmp/dist-v366base-230543   ← 生产基线(md5 72ec5a73…)
drwxr-xr-x  6 zhangjunfeng  staff  192 Oct  2 23:05 /tmp/dist-v366base-230545   ← 第二次(新产物)
```

我又用 `OLD=$(ls -d /tmp/dist-v366base-* | tail -1)` 取值 ⇒ 拿到**第二次**那个（＝新产物），
于是「零夹带对比」出现了**不可能的结论**：`diff` 为空、md5 相同（拿新产物跟新产物比）。

🔴 **纪律**：
1. **副作用命令一律写幂等**：用 `cp -a` 而不是 `mv`；`rsync` 天然幂等；备份用**固定名**或先 `test -e` 再建。
2. 执行后**核对只发生一次**：`ls -la --time-style=+'%m-%d %H:%M:%S' <pattern>` 看是否有**两个** mtime 相近的产物。
3. 取「最新/最旧」时**别用 `tail -1`** —— 显式写死路径，或先 `ls` 打印出来人眼过一遍再选。
4. 见到 `Sandbox bypassed (escalation-approved)` ⇒ **默认怀疑该命令跑了两遍**。

### §27 🔴 `grep -o -F "--xxx"` 的 `--` 前缀被当**选项**（输出 0，看着像「无匹配」）

```bash
grep -o -F "--danger-solid" dist/assets/index.css
# grep: unrecognized option `--danger-solid'      ← 报错，但 stdout 为 0 行
```
在 `$(... | wc -l)` 里这会被读成 **0**，与「真的不存在」**完全一样**。
本轮差点据此判定「令牌没进产物」。

🔴 **正解**：`grep -o -F -- "$s" "$f"`（`--` 之后一律当文件/模式）；或用 `printf '%s' "$s" | grep -o -F -e "$s"`。
🔴 **同族**（本项目已踩 5 条，务必一起记）：`grep "A\|B"` 静默失效 ⇒ 用 `-e`；
`| head -N` 截掉决定性命中；`grep -rl X *.py` 只搜顶层；`&&` 短路；zsh `$k{` 当算术（§25）。
🔴 **纪律**：**「搜不到」先排除「搜错了 / 被截断 / 参数写错」，再当成事实。**

### §28 🔴 Vite `build.cssCodeSplit` 默认 true ⇒ 页面 CSS 在**各自 chunk** 里

产物 `dist/assets/` 下**有 23 个 css**：入口只有 `index-*.css`（全局令牌 + `variables.css`），
页面私有样式在各自的 `Forecast-*.css` / `Rebate-*.css` …（本页 **108 KB**）。

只查入口 CSS ⇒ `btn-retry` / `spark-th` / `z-index:var(--z-page-*)` **全 0**，
看起来像「改动没生效」，实际全在 `Forecast-Bt0YDxRy.css` 里。

🔴 **纪律**：产物特征串核验**必须遍历 `assets/*.css`**：
```bash
for f in dist/assets/*.css; do printf '%s: %s\n' "$(basename $f)" "$(grep -o -F -- "$s" "$f" | wc -l)"; done
```
🔴 同理适用于 `.js`：`__vite__mapDeps` 导致**入口一改、全站 chunk 改名** ⇒
「零夹带」判据要**比逻辑名集合**（去 hash），不能比 chunk 名。

---

## §29 zsh 下 `--include=*.py` 这类通配**必须加引号**（2026-10-05 实测）

```bash
grep -rn "x" --include=*.py .            # ✗ zsh: no matches found: --include=*.py
grep -rn "x" --include='*.py' .         # ✓
grep -rn "x" --include="*.vue" .        # ✓
```
zsh 会在**命令执行前**对 `*.py` 做 glob 展开；当前目录没有匹配文件时直接报
`no matches found` 并**整条命令不执行**（exit 1，看起来像"没有匹配结果"）。

🔴 **与 §10 的 `grep "A\|B"` 静默失效是同一族**：都是「搜不到」但其实**根本没搜**。
⇒ 纪律不变：**「搜不到」必须先排除「搜错了范围 / 没执行 / 被截断」，再当成事实。**
本机推荐直接用 Grep 工具（ripgrep 封装）代替 Bash 里的 `grep -r`，可同时规避 `\|`、`&&` 短路、通配三个坑。


## §30 CDP 探针的 `HELPERS` 是**模板字符串** ⇒ 两条同族陷阱（2026-10-05 实测，各踩到）

探针把注入页面的工具函数写在 `const HELPERS = \`…\`` 里，**求值阶段会吃掉转义**：

```js
// ① 注释/代码里出现反引号 ⇒ 直接截断字符串（报 SyntaxError: Unexpected token）
//    v377/v378 两个会话共踩 6 次。规矩：HELPERS 区间内**一个反引号都不许有**，用「」代替。

// ② 正则的反斜杠必须**双写**（这是最容易漏的一条）
var m = /rgba?\(([^)]+)\)/.exec(c)     // ✗ 求值后变成 /rgba?(([^)]+))/
var m = /rgba?\\(([^)]+)\\)/.exec(c)   // ✓ 求值后才是 /rgba?\(([^)]+)\)/
// 后果：m[1] 拿到 "(250, 250, 250"（带左括号）⇒ parseFloat = NaN ⇒ 有效色算成 "NaN,250,250"
// 同族：\d → d、\s → s（`/([\d.]+)px\s+inset/` 会退化成匹配不到任何东西）
```

✅ **自证手法（必做）**：还原「注入页面后的真实源码」再验，别读 `.mjs` 原文：
```js
const src = fs.readFileSync(探针路径, 'utf8')
const a = src.indexOf('const HELPERS = `') + 18, b = src.indexOf('\n`\n', a)
const val = (new Function('return `' + src.slice(a, b) + '`'))()   // ← 这一步等效于页面里看到的东西
// 然后在 val 里 grep 正则、或对还原出的正则直接 exec 一次
```

🔴 **同族**：`§29` 的 zsh 通配、`§10` 的 `grep "A\|B"`、用户级 `~/.workbuddy/MEMORY.md` 里的
heredoc 吞引号 —— 都是「**写下去的东西 ≠ 跑起来的东西**」。⇒ 纪律：**凡经一层求值/转发，必须还原后再验。**


## §31 恒假判据 / 恒零计数器 —— 比没有判据更危险（2026-10-05 v378 实测 6 条假红）

首跑 v378 探针 6 条失败，**全部是探针自己的缺陷，产品侧 100% 正确**。三条机制各不同：

| 假判据 | 机制 | 后果 |
|---|---|---|
| `__sig` 只读 `backgroundColor + boxShadow` | 被测对象用 `background-image` 实现 ⇒ 两项都不变 | **恒假**，AFTER 侧永不可能通过 |
| `nrWeak` 查 `td.seq-cell.cur-row-hd` | 类实际挂在 **`<tr>`** 上（`tr.cur-row-hd > td.seq-cell`） | **恒 0**，与 CSS 对错无关 |
| 像素采样取元素**中心**的众数 | 表头中心压着**白底输入框 pill**（`cell-input cell-cust`） | 冷/选同值 ⇒ **假绿** |

⇒ 🔴 **纪律一**：**每条新判据上线前必须自问「它在 AFTER 侧有没有可能通过？」**
不可能通过的判据 = 必然假红；两侧都恒同的判据 = 假绿（`§12` 的反面）。

⇒ 🔴 **纪律二**：**「属性读到 / 读不到」都不能替代「用户看不看得见」。**
属性读不到 ≠ 看不见（首版假红）；属性读到了也 ≠ 看得见（声明可能被覆盖）。
⇒ 加一条**独立通道**：`__eff`（把 `background-color` 与渐变首色标按 alpha 合成出「有效绘制色」）
＋ **渲染像素**（截图 + Pillow 读字节，完全绕开 CSS）。

⇒ 🔴 **纪律三**：**采样点必须避开内容**。文字标签、白底输入框、1px 边框都会污染采样。
像素采样改取单元格**顶部内边距带**（`top+4`，在内容之上、边框之下的纯底色区）的**众数色**（不是中位数），
并配**判别力自证**：先合成「纯底 / 叠同配方半透明灰」两张图、期望值写死，证明采样器能分辨，再看真实截图。

---

## §32 🔴 探针里的**二态判据**遇到**第三态输入**会静默落回旧侧（2026-10-05 v378 上线后实测，19 条假红）

**症状**：上线后拿同一支探针直打生产，标签不是 `BEFORE`/`AFTER` 而是 `LIVE`（第三个取值），
`exit=1`，**19 条 ★ 断言全红**，形态酷似真缺陷：

```
★P4 点列头：选的是列，就不许有行被点亮（基线外新增青底）  期望="before"  实测=0
★P5 切回单元格轴：整列底消失                             期望=154      实测=0
```

而同一时刻的关键信号 `cellClick{sel:1,col:0}` / `colClick{sel:154,col:154}` —— **逐项与本地 AFTER 完全相同**。
⇒ **被测对象是对的，判据错了。**

**机制**：探针设计成 `BEFORE / AFTER` **二态**，但上线后必然出现第三态（`LIVE` 直打生产 / `PRE` 预发 / `POST` 灰度）：

```js
const IS_AFTER = LABEL === 'AFTER'   // ← 三元只有两侧，第三态必落入 else ⇒ 被当成 BEFORE
```

`else` 分支把「不是 AFTER」一律当成「是 BEFORE」⇒ 拿**改造前**的期望量**改造后**的线上 ⇒ **全部反着判**。
它**不报错**，只在你第一次拿它量新环境时给一整屏假红，且假红形态与真缺陷**无法从输出上区分**。

**修**（语义应当是「**只有显式 BEFORE 才是改造前**」，未知态取 fail-safe 的「新」侧）：

```js
const IS_AFTER = LABEL !== 'BEFORE'
```

复跑 ⇒ **76/76，exit=0**。

⇒ 🔴 **纪律**：**判据的取值域必须与被测输入的取值域同宽**。做不到时，
**显式列出未知态该落哪一侧**，并选 **fail-safe 的一侧**（把未知当"新"，而不是当"旧"）。
⇒ 🔴 **探针里禁止 `x === A ? before : after` 这种写法**——它是定时炸弹。

---

## §33 🔴 判别串读数为 0 时，先问「我的判据有判别力吗」（2026-10-05 v378 上线，两条独立成因）

上线时两次碰到「读数 = 0」，两次都**不是**「被测对象真的没有」：

**成因一：zsh 不对未加引号的变量做词切分**

```sh
for f in "OLD $OLD_CSS" "NEW $NEW_CSS"; do ... grep -c 'tr.sel-row>td' "$f"; done
#     ^^^^^ 变量展开后不再切词 ⇒ 整串是一个路径 ⇒ 喂给 grep 的是空路径
```
读数变成 `新包=0 旧包=0` —— **两侧都是 0 = 判据没有判别力**，不是「两边都没有」。
（同族：`grep "A\|B"` 静默失效 ⇒ 用 `-e`；grep 串 `&&` 短路 ⇒ 用 `;`。）
修：用显式路径，或 `printf` + `$(ssh …)` 逐条取。

**成因二：Vue scoped CSS 会在类名后插 `[data-v-xxxxxxxx]`**

想验证新规则在不在产物里，写了精确串：

```sh
grep -c 'th.cur-col-hd{background-image:...}' Forecast-DN-t1QZj.css   # ⇒ 0，假阴性
```

实际产物里长这样：`th.cur-col-hd[data-v-bc491277]{background-image:…}`
⇒ 精确串**恒 0 命中**。修：用正则

```sh
grep -oE 'th\.cur-col-hd\[data-v-[0-9a-z]{8}\]\{[^}]*\}'
```

⇒ 🔴 **纪律**：**判别串读到 0 时，先自证判据有判别力**（在**已知含该串**的旧包上跑一次，必须读到 ≥1），
再把它当事实。**「搜不到」必须先排除「搜错了范围 / 判据写错了」，再下结论。**

---

## §29 zsh 通配**无匹配**会把整条命令**中止**（v385 又踩）

`ls -l /tmp/a.png outputs/v385-*.png` —— 后半截无匹配时 zsh 打印
`(eval):1: no matches found: outputs/v385-*.png` 并 **abort 整条命令** ⇒ 连前半截
`/tmp/a.png`（**明明存在**）也没被列出来。看输出极易误判成"两个文件都不在"。
⇒ **纪律：多个路径分开写，或给通配加引号 / 用 `ls ... 2>/dev/null`。**
（同族 §… 「zsh 通配须引号」；这条是它的**变体**：不是变量未加引号，而是**字面通配**无匹配。）

## §30 服务器上做只读库检查的姿势（v385 实测）

- **生产机没有 `sqlite3` CLI**（`bash: sqlite3: command not found`）⇒ 用
  `python3` + `sqlite3.connect("file:/opt/hergent-erp/erp.db?mode=ro", uri=True)`（**只读 URI**）；
  且**必须 `runuser -u hergent`**（文件属主）。
- 🔴 **写 SQL 前先 `PRAGMA table_info(<表>)`**。本轮踩：
  `users` 表**没有 `tenant_id` 列**（租户关系在 `user_tenants`）、**主键是 `id` 不是 `user_id`**、
  `sessions` 也**没有 `tenant_id`**（靠 `user_id` 关联）。凭印象写列名 ⇒ `no such column`。
- 🔴 **python sqlite3 的参数绑定要"同宽"**：把同一份 `params` tuple 套用到所有查询上 ⇒
  没有占位符的那条会抛 `ProgrammingError: Incorrect number of bindings supplied`。
  ⇒ 每条查询**各自带自己的 params**（本轮 `(label, sql, params)` 三元组）。
- 🔴 **"残留检查"的范围条件先出假阳性**（同 §v383 第 4 条）：本轮查 `users.id >= 900000` 得到 **12**，
  一度以为没清干净 —— 实为**生产租户 1 的历史老账号**（id 999899–999921）。
  真正的沙箱号是 999926/999928/999930/999932；**当前 max(id) = 999921** ⇒ 已全清。
  ⇒ 判据要**取"沙箱实际用到的号"**（或 `> 本轮最大沙箱号`），不要拍一个整数段。

---

## §34 用 `git show HEAD:` 做「改动前」对照时，先确认改动**提交了没**（v393 实测）

做「判别力自证」（拿改动**前**的源文件跑同一批断言，必须变红）时，习惯写法是

```bash
git show HEAD:hergent-cn-v2/src/components/Shell.vue > /tmp/Shell.head.vue
SHELL_PATH=/tmp/Shell.head.vue node tools/<探针>.mjs
```

🔴 **但这个写法只在「改动尚未提交」时成立。** 本轮 `Shell.vue` 的入口挂接**已经提交**
（`cdb152e`）⇒ `HEAD:` 取到的就是**改动后**的版本 ⇒ 探针读到「新旧完全相同」
（抽屉 17 条 = 17 条、进销存 5 条 = 5 条），**看起来像判据失效**，实际是我拿错了对照版。

✅ 正解 —— 取**那个 commit 的父提交**：

```bash
git show cdb152e^:hergent-cn-v2/src/components/Shell.vue > /tmp/Shell.pre.vue
cmp -s /tmp/Shell.pre.vue hergent-cn-v2/src/components/Shell.vue \
  && echo '🔴 两份相同 ⇒ 对照版拿错了，判据无效' || echo '✅ 两份不同 ⇒ 可用于判别力自证'
```

⇒ **纪律：任何「改动前 vs 改动后」的对照，先 `cmp` 一次自证两份**不同**，再跑断言。**
（同族：`git show <commit>^:` 里的 `^` 只退一级；若该文件被多次提交，要退到真正那次之前。）

**顺带**：`git ls-files | grep '<中文>'` 在本机会因为 git 输出对非 ASCII 路径做八进制转义
而**匹配不到**（看起来像「文件没被跟踪」）⇒ 用 `git log --oneline -- <路径>` 或
`git status --porcelain -- <路径>` 判断跟踪状态，别用 `ls-files | grep`。

---

## §35 `git commit -m "..."` 里的**反引号会被 zsh 当命令替换**（v393 实测，静默吞字）

双引号内的反引号在本机 zsh 下照样做**命令替换** —— 不是「原样传字符串」：

```bash
git commit -m "P3 点「＋」落 `/purchase/new`，深链用 `/?__r=` 强制新文档"
# zsh 先执行 `/purchase/new` 与 `/?__r=` ⇒ 前者 "no such file or directory"、
# 后者 "no matches found"，**替换成空串** ⇒ 提交信息里那两处**直接消失**，
# 而 git 提交**照样成功**（退出码 0），不比对 message 就发现不了。
```

🔴 **这是「静默丢内容」，与本项目其它静默失效同族**（写进去了但少了东西，零报错）。
✅ 三种安全写法（任选）：
1. **不用反引号**，改「」或直接写路径 —— 最省事；
2. 反引号**转义**：`\`path\``（本会话 `dfd7315`/`2e700be` 就是这么写的，复查过未受损）；
3. **写进消息文件再 `-F`**：`git commit -F /tmp/msg.txt`（多行长消息首选，且能随意用反引号）。
⇒ **纪律：含反引号 / `$(` / `*` / `?` 的长提交信息，一律走 `-F 文件`；
提交后 `git log -1 --format=%B | grep <关键词>` 自证关键串还在。**
（同族已在 memory 里：heredoc 经 `ssh` 吞引号、`grep "A\|B"` 静默失效。）

---

## §36 · **模板字符串内部禁止写反引号**（写探针注释时踩，2026-10-07 v394）

**症状**：往 `.mjs` 探针的**模板字符串**里加一段中文注释，`node --check` 报
`SyntaxError: Unexpected identifier 'lum'`，指向注释中间那行 —— 看着像"注释语法错"，
其实是**上一行的反引号把模板字符串提前闭合了**。

```js
const SAMPLER = (sels) => `JSON.stringify((function(){
  /* 白块判据 = 亮 且 近灰（`lum >= 100 && sat < 40`）。   ← 🔴 这里的反引号闭合了外层模板
     第一版只判 `lum >= 100` ⇒ 把 .btn-primary 误报成白块。  ← 🔴 又一次
```
外层 `` ` `` 一闭合，后面的中文就变成"没写完的标识符" ⇒ 报错位置**指向中文**，
**误导你去查中文/标点**，而真凶是反引号。

🔴 **本项目探针的共性风险**：为了把页面侧函数塞进浏览器，探针大量使用**嵌套模板字符串**
（`p.eval(\`...\`)` 里再拼 `${JSON.stringify(...)}`）。此时**字符串内任何裸反引号都是地雷**，
而**注释里最爱用反引号标代码/变量** ⇒ 极易命中。

✅ **写法**：
1. 模板字符串内的注释**一律不用反引号** —— 变量名直接写，或用「」/单引号；
2. 改完**立刻 `node --check`**，别等跑起来才发现（本次是连着两处、改一处还剩一处）；
3. 真要写反引号 ⇒ 转义 `` \` ``，但可读性差，不如换引号。

⚠️ **与 §35 同源但不同层**：§35 是 **shell 吞反引号**（`git commit -m` 被 zsh 命令替换），
本条是 **JS 模板字符串被反引号提前闭合** —— 一个丢内容，一个报语法错。**反引号在本项目是高频雷区。**




## §37 · 本会话**读不了图片**，读图一律走 OCR

- 模型侧 Read 图片会返回「不支援图片 / Content filtered」⇒ **不能凭"我读过图"下结论**。
  曾据此把文档转述当成「原图实证」表述过（v394 轮），属**错误归因** —— 已由 `topics/competitor-zhoupudata.md` 用真 OCR 覆盖纠正。
- **解法（本机可用）**：macOS 自带 `/usr/bin/swift`，用 Vision 做中文 OCR，无需装包：
  `.workbuddy/tools/ocrcli.swift`（`swiftc -O ocrcli.swift -o ocrcli`），
  输出 `x|y|w|h\t文本`（归一化坐标，原点左上）⇒ **能还原列结构**（同 y≈ 列标题、同 x≈ 同一列）。
  · 关键参数：`recognitionLanguages=["zh-Hans","en-US"]`、`usesLanguageCorrection=false`、
    `recognitionLevel=.accurate`；排序按 y 后按 x（容差 0.006）。
  · 截取面板区用 `awk -F'\t' '{split($1,a,"|"); if (a[2]+0>=0.17 && a[2]+0<=0.45) print}'`。
  · Swift 坑：`boundingBox` 是 **CGFloat**，元组类型注解写 `Double` 编译不过。

## §38 · 「模型读不了图」的三件套图像工具（v396 建）

配套 `§37`（读图一律走 OCR）。本轮为了看**图形控件**（刷新箭头、关闭 ×、圆形图标）又补了两件：

- `.workbuddy/tools/v396-ascii-view.py <图> x0 y0 x1 y1 [宽度]`
  **把任意矩形区域转成字符画**（灰度 → ` .:-=+*#%@`）。用途：OCR 只给文本，
  **图形控件的形状只能靠这个看**。🔴 换算要按字符宽高比 ≈1:2 折算行数，
  否则图被纵向压扁一半；区域太扁时行数不足，要**先缩小裁剪范围**再看。
- `.workbuddy/tools/v396-zoom.py <图> x0 y0 x1 y1 [倍数] [名]` 任意矩形放大存 PNG，
  再喂给 `ocrcli` —— **放大 5–8× 后 OCR 对小图标/小字的识别率明显提升**（但不会凭空多出信息，
  认不出的图标放大后仍读成同一个字母）。
- `.workbuddy/tools/v396-crop-tabbar.py` 裁一条横向带子并放大（标签栏/工具条专用）。
- 🔴 **纪律**：OCR 把图标读成字母（如圆环→`C`、关闭→`X`）时，**不要据字母猜语义**；
  必须用字符画看轮廓，且**轮廓像 ≠ 就是**（圆环可能是刷新，也可能是状态点）。
  证据不足就写进「待确认问题」，**不猜**。

## §39 · 「参数被静默忽略」与「comm 的 locale」（v396 实测，两条都是**假线索**）

### 39.1 🔴 函数只声明了更少的参数 ⇒ 多余实参被**静默丢弃**

`lib/cdp-lite.mjs` 的 `screenshot(path)` 原来**只接一个参数**。调用方写
`p.screenshot(file, { clip: {...} })` 想截「标签栏条带」，落盘的却是**整页 1440×900** ——
不报错、不警告、`--stat` 照常、脚本自称"已截图 3 · 标签栏条带"。
**唯一线索**：那张"条带"与上一张整页图**字节数完全相同**（154163 = 154163）。

- **判据**：截图体积与预期量级不符（整页 130~160KB vs 条带 6~7KB）⇒ 先怀疑参数没生效。
- **纪律**：传了可选参数后，**必须回读产物自证**（尺寸/字节数），别信日志里那句自己打印的成功。
- **修法**：把参数**显式声明并透传**（`screenshot(path, opts)` + `if (opts?.clip) params.clip = opts.clip`），
  让"忽略"变成"编译期可见"。静默忽略参数的 API 比报错危险得多。

### 39.2 🔴 再犯 §4.83 那条：`comm` 两侧 locale 必须一致（本次是**新变体**）

`comm` 要求**两个输入都已按同一 collation 排序**。本轮我写的是：

```
ssh … 'ls -1 /opt/hergent-cn-v2/assets/ | sort' > /tmp/_loc.txt   # ← 远端 sort（远端 locale）
ls -1 dist/assets/ | LC_ALL=C sort > /tmp/_srv.txt                # ← 本地 LC_ALL=C
LC_ALL=C comm -23 /tmp/_srv.txt /tmp/_loc.txt | wc -l             # → 假报 67
```

只给**比较侧**加了 `LC_ALL=C`、却让**生产侧在远端排序** ⇒ 两份序不同 ⇒ 假报「67 个缺失」，
而 rsync 明明刚成功。**修法：两侧都在同一侧排序**（把远端列表拉回本地，统一 `LC_ALL=C sort`），
读数立刻变 **0**。

- **判据方向**：`comm -23 A B` = **只在 A 里的行**。取"本地有、生产无"就是 `comm -23 本地 生产`
  —— 本轮我变量名也起反了（`_loc` 装的是生产），**方向 + locale 两个错叠在一起**，
  差一点当成"部署失败"去重传。
- **与 §4.83 的关系**：那条讲的是"该加 `LC_ALL=C` 却没加"；这条讲**只加了一半**。同族。

