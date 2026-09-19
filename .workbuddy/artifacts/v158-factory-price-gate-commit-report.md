# v158 厂价闸门 —— 提交收尾报告

日期：2026-09-13 · 范围：把已上线并验证过的 v158 改动**单独钉进历史**（scoped 提交），
不含新功能开发。

---

## 一、交付（两个仓库各一条提交）

| 仓库 | 分支 | commit | 文件 | 行数 | 推送 |
|---|---|---|---|---|---|
| hergent-erp | `upgrade/v84-international` | **`3cb7bd9`** | 6 | +442 / -17 | 未推送（ahead 5） |
| laozhangai-product（hergent-cn-v2） | `main` | **`3b5813f`** | 4 | +173 / -46 | 未推送（ahead 9） |

两条提交都是 **scoped** —— 只含本轮厂价闸门相关改动；同一文件里的在途改动**保持未提交**，
工作区内容零丢失（提交后逐字还原：`abb56f40`(modules.js) / `b95132ac`(Forecast.vue) /
`ff024e41`(ProductArchive.vue) / `459ca574`(Archive.vue)）。

### 提交内容

**后端 `3cb7bd9`**
- `db/queries/products.py`：厂价判据唯一实现（`factory_price_verdict` 纯函数 / `factory_price_gate_enabled` fail-safe 朝放行 / `resolve_factory_price` / `missing_factory_products`）
- `routers/import_router.py`：Excel 报单导入闸门拒收（位置在「无 pid」判定**之前**）+ 待补清单 `GET /factory-price-template` + 导回 `POST /factory-price-apply` + 修 `quote` 的 NameError
- `routers/forecast_submissions.py`：小程序报单同源闸门 + 修「整单被拒会吞掉上一次报单」的数据丢失
- `routers/forecast_config.py`：`GET/PUT /api/forecast/factory-price-gate`
- `erp_db.py`（1 行 re-export）、`server.py`（1 处注释）

**前端 `3b5813f`**
- `ProductArchive.vue`：「厂价必填」开关（按状态分叉文案）+ 导出/导回改走服务端 + 回执新增 `unfilled`/`nokey`
- `Forecast.vue`：导入回执加「厂价必填（已开启）」区块，点名被拒商品；顺带补上 `<div v-else>` 缺失的 `</div>`
- `Archive.vue`：修档案 tab 壳把子页 `.page-hd` 整块藏掉 → 「补厂价/新增/导入/导出/同步」全部不可点
- `api/modules.js`：`factoryPriceGate` / `setFactoryPriceGate` / `factoryPriceTemplate` / `factoryPriceApply`

---

## 二、边界（哪些**没有**提交，为什么）

| 未提交的在途改动 | 文件 |
|---|---|
| `forecastApproveApi.summary` 的 `periodId` 参数与 `period_id` 查询串 | modules.js |
| `srcByPid` / `extraByPid` / `sumById` 三处「合并而非覆盖」防御性聚合、`.imp-errs` 样式挪位 | Forecast.vue |
| 页头改 `.page-hd split`、`pa-stat` 挪位、`purchase_price` 列/字段顺序、`.page-hd`/`.page-sub` 上提全局 | ProductArchive.vue |
| `login_is_locked` 双维度锁定 / `v110_*` 迁移等 | erp_db.py 等 |

**唯一的例外（有意为之）**：`Forecast.vue` 那个补 `<div v-else>` 的 `</div>` 属在途序列，但它与
本轮插入的区块是**同一结构单元**（我的区块借用了它的闭合）—— 剔除后暂存版 `vite build` 直接报
`Element is missing end tag.`。故与本轮一起提交，并在提交信息中写明。

---

## 三、验证

| 维度 | 结果 |
|---|---|
| 暂存版前端构建 | ✅ `vite build` 通过（证明「HEAD + 本轮改动」语法完整、与在途解耦） |
| 暂存版后端语法 | ✅ 6 个文件 `compile()` 全 OK |
| 提交纯度 | ✅ 前端 `prevSrc`=0 / `const prev = sumById`=0；`periodId = 0` 提交版 9 vs 工作区 10（在途那行未进历史）；后端 `login_is_locked`/`v110_` 均为 HEAD 既有（§8 假警报） |
| 无回退 | ✅ 提交后按**完整工作区**重建 dist，与生产 `/opt/hergent-cn-v2` 6 项产物（Archive js/css、Forecast js/css、modules js、index.html）md5 **逐字节一致** |
| 基线位移 | ✅ 期间外部提交 `f539ef4`(v162)→`6d4107b`(v164) **未触碰**这 4 个文件（blob 逐字相同） |
| 在途保留 | ✅ 工作区仍脏：后端 9 文件 / 前端 30 文件 |
| 生产健康 | ✅ `hergent-erp` active、本地 health 200、`hergent.cn` 200 |

---

## 四、本轮新学到的东西（已写回技能 `hergent-scoped-commit` §10）

1. **HTML 里「我的新增」会与「在途改动」结构性耦合** —— 我的区块没有自己的 `</div>`，借用了
   HEAD 里关闭 `<div v-else>` 的那个；在途改动恰好新增一个 `</div>` 补回。剔除后者 → 暂存版失衡 →
   构建报错行号（129）在改动区（171/199）**之前很远**，极具误导。**剔 hunk 前必问「我的改动是否依赖它」。**
2. **索引会被另一会话整个重置** → `git add` 与 `git commit` 必须在**同一次工具调用内**完成，
   提交前断言索引文件集合（该断言本次拦下了一次空索引提交）。
3. **失物招领** —— 被重置的 staged blob 仍在对象库：`git fsck --dangling` + 大小/符号计数即可捞回；
   再用「从 HEAD 重建 + `git hash-object` 对撞」验证归属判断的字节级正确性。
4. **zsh 不做变量分词** → 提交命令里别用 `$FILES` 收多路径。
5. 手写的 `div` 计数扫描器**不可靠**（本次它对 HEAD 报「平衡」，而 HEAD 实际少一个 `</div>`）——
   **只信编译器**。

---

## 五、需确认事项 / 遗留

1. **推送**：两仓库提交均**未推送**（延续「暂缓推送」姿态）。要推的话说一声。
2. **闸门默认关闭**，尚未在真实租户 `tenant_1` 打开（实测在售 269 商品 100% 缺厂价）。
   你的计划是**用模板导入补价**再打开 —— 补价入口：商品档案 → 补厂价 → 「导出待补清单」；
   清单带「商品编号（请勿修改）」列，回填按**编号优先、条码兜底**（演示租户 11 个待补商品全无条码，条码不够用）。
3. **另开两轮**（按你的指示未动）：
   - 线上仓库 HEAD 不自洽：`HEAD:useCardTrigger.js` 无 `stripAllFences`，`HEAD:Workbench.vue` 引用 2 处；
     但两次 `vite build` 均通过 → 不阻塞构建。
   - 汇总表「单价(厂价)」列表头与实际取值口径不符（`displayPrice()` 实取 `dist_price`/`sale_price`）。
