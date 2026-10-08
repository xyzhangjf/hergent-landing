# 整改结果 — 2026-09-22（对应 `2026-09-22.md` 审查清单）

> 范围：严格按清单逐项处理，未扩大/缩减；未改动与清单无关的代码
> **未提交、未部署、未重启任何服务**（仅本地改码 + 本地构建/测试）
> 构建/测试结论：前端 `npm run build` ✅ 通过（2.03s）；后端 `compileall` ✅ 退出 0；后端现有 3 套纯逻辑测试 ✅ 全绿；真实库 `erp.db` md5 前后一致（零写入）

---

## 一、整改结果总表

| # | 清单项（严重度） | 问题根因 | 修改的文件与方法 | 验证方式 | 是否遗留风险 |
|---|---|---|---|---|---|
| 1 | `Forecast.vue:8437` 异常自愈闭环乐观更新+静默吞错（**高**） | `catch (e) {}` 吞掉服务端写失败，本地已改、无回滚、无提示 | `hergent-cn-v2/src/pages/Forecast.vue` → `setHeal()`：加改动前留底 `prevStatus/prevNote`，catch 内回滚 + `toast('保存失败…','err')` | `vite build` 通过；代码复核（grep 该函数体） | 无 |
| 2 | `Forecast.vue:8221` 差异归因写入静默失败（中） | 同上（写入 `varianceAttrPut` 失败被吞） | 同文件 → `saveVarAttr()`：留底 `prevCause`，catch 回滚 + `toast('归因保存失败…','err')` | 同上 | 无 |
| 3 | `Forecast.vue:7106/7561/7575` 云端同步失败仍报「已存」（中） | 本地 localStorage 成功即无条件 `toast(...,'ok')`，云端 `catch {}` 静默 | 同文件 → `saveSuggestRecipe()`、`saveScheme()`、`deleteScheme()`：接出 `cloudOk`，失败时改 `'warn'` 文案「已存到本地，但云端同步失败（换设备不可用）」 | 同上；`grep -c "云端同步（静默）"` = 0 | 无 |
| 4 | `server/domain/forecast_engine.py:549` 效期解析失败丢行（中） | 裸 `except: continue`，脏日期整行丢弃 → 同商品只要有一个脏批次，临期数量/金额**系统性少算** | `server/domain/forecast_engine.py` → `_inject_expiry_alerts()`：异常收窄为 `(ValueError, TypeError)`；脏日期只置 `days_left=None`，**数量/金额照常并入**；仅"该商品全脏"时保持旧行为不建条目；新增一次性 `logger.warning` 计数 | **桩替换 DB 依赖的行为验证**（`/tmp/expiry_fix_verify.py`）：仅有效行 → qty=10/value=50；有效行+脏日期行 → **qty=30/value=150**（旧实现为 10/50）；仅脏日期 → `expiry_alert=None` 不崩；影子库运行、真实库 md5 不变 | 无（脏日期**天数**仍无法参与推算，属数据质量问题，已由 warning 点名） |
| 5 | `server/scheduler.py:637` `_days_until` 返回魔法值 999（中） | 解析失败返回 999 ≈ "永不到期"，合同到期检查**永久静默漏报** | `server/scheduler.py` → `_days_until()` 改返回 `None` + 打印原因；同步改 3 个调用点：`_check_expiry()`（一次性求值、显式跳过 None，顺带去掉原先每条重复调用 2 次）、`_check_contract_expiry()`（None 则跳过并留痕） | 断言验证（`/tmp/shadow_import_smoke.py`）：`_days_until('not-a-date') is None` ✅、`_days_until('2030-01-01')=1196` ✅ | 无 |
| 6 | `server/hermes_core.py:21` 审计 fail-open（中） | `except ImportError:` 时把 `audit_ai_action` 变成 `pass`，5 处 AI 写操作（含收付款）审计断链且零提示 | `server/hermes_core.py`：兜底分支加 `logging.getLogger("hergent").warning(...)`（保持 no-op 行为，只让失效可见） | `py_compile` + 导入冒烟通过 | 无（触发条件窄：同目录 `ai_engine.py` 存在时不会走到） |
| 7 | `server/db/queries/purchases.py:16` 裸 except 吞阈值查询（中） | 裸 `except:` 静默回落 5000，可能让本应审批的采购单直接过 | `server/db/queries/purchases.py`：`except Exception` + `_logger.warning(..., exc_info=True)`；`5000` 提为模块常量 `DEFAULT_APPROVAL_THRESHOLD` | `py_compile`；`grep -e "^[[:space:]]*except:$"` = 0 | 无 |
| 8 | `server/ai_engine.py:591` `except Exception: pass`（中） | 低置信度采样一旦失效整体停工且无痕 | `server/ai_engine.py`：改为 `logging.getLogger("hergent").warning(...)` | `py_compile` + 导入冒烟 | 无 |
| 9 | 清单原项：`fmtNum` 三套口径不一致（中） | **该条不成立（撤回）**：`AiHub` 的 fmtNum 作用于「调用次数/额度字符数」，`NotificationPanel` 作用于「通知条数」——量纲不同，各用各的格式合理；`Workbench` 那份是**从未被调用的死函数** | 结论：撤回"抽 `utils/fmt.js` 统一万元口径"（会误改计数类显示，且违反"不引入新方案"）；仅删除 `Workbench.vue` 死函数 `fmtNum` | 逐处 grep 使用点确认语义 | 无 |
| 10 | 魔法值散落（中） | `5000` / `30` / `90` / `999` 内联 | `purchases.py` → `DEFAULT_APPROVAL_THRESHOLD`；`inventory.py` → `EXPIRY_CRITICAL_DAYS=30` / `EXPIRY_WARNING_DAYS=90`（并把三元表达式展开为多行）；`999` 随第 5 项消除 | `py_compile`；常量 grep 可见 | 无 |
| 11 | `src/utils/rebateCalc.js` 整文件零引用（中） | 前端早已不再自带返利算法（`tests/rebate-calc.contract.mjs` 头注释明写"前端不再自带算法"），此文件为遗留 | `git rm hergent-cn-v2/src/utils/rebateCalc.js`（148 行 / 6.0 KB） | **全扩展名**全仓搜索 `rebateCalc`（含 `.mjs`/`.md`）→ 仅本报告提及；构建产物中无 `rebateCalc` chunk | 可从 git 恢复：`git checkout HEAD -- hergent-cn-v2/src/utils/rebateCalc.js` |
| 12 | 3 处裸 `except:`（低） | `inventory.py:36` / `import_zhoupu.py:277` / `scheduler.py:519` 会连 `KeyboardInterrupt`、`SystemExit` 一起吞 | 分别收窄为 `(ValueError, TypeError)` ×2、`Exception` + 留痕 ×1 | **POSIX 安全写法**全后端复扫：`grep -rn -e "^[[:space:]]*except:[[:space:]]*$" server --include="*.py"` → **零命中** | 无 |
| 13 | 清单原项：`fmtDate` 两份重复（低） | 确属重复，但修复需新建公共 `utils/fmt.js` 模块 | **本轮不做**（见下文"不适用说明"） | — | 保留为已知冗余，不影响正确性 |
| 14 | 清单原项：`Forecast.vue` 10,951 行拆分（低） | 单文件过大导致回归成本高 | **不适用**：属大型重构，明确超出"不引入新技术方案/不做重构"的约束 | — | 建议单独立项 |
| 15 | 导出后零引用（低） | ① `printable.js` 的 `downloadPrintable` 全仓零调用，且与 `buildPrintableHtml` 内联的 `dlHandler` 能力重复；② `client.js` 的 `clearTenantCookie` 仅文件内用 | ①删除 `downloadPrintable`（含文件头用法示例第 4 行），去掉 `buildPrintableHtml` 的 `export`；②`clearTenantCookie` 去掉 `export` 改为模块私有 | 全扩展名搜索确认零外部引用；`node --check` OK；`vite build` OK；`printable` chunk 由原体积降至 4.02 kB | 无 |
| 16 | `gl.py` 三个 DEPRECATED no-op 被导入却无调用（低） | 旧 GL 过账通道已迁至 `auto_journal_for_*`，但 no-op 占位仍在，易误以为旧通道有效 | `server/db/queries/gl.py` 删除 `gl_post_sale/gl_post_purchase/gl_post_payment`，改留一行口径说明；`server/erp_db.py:4796` 导入收敛为 `(init_gl, gl_post, get_gl_balance)` | `grep -rn` 三个名字：仅剩注释提及与已改的导入行；`py_compile` 两文件 OK | 无 |

**执行统计**：清单 16 项 → **已实施 11 项**（覆盖 14 个代码位置）、**撤回 1 项**（第 9 条不成立）、**本轮不适用 3 项**（第 13、14、以及第 15 条中的两个子项）、**另 1 项部分实施**（第 15 条含 4 个子项，2 项已改）。

---

## 二、分文件关键改动点

### 前端 `laozhangai-product/hergent-cn-v2`
| 文件 | 关键改动 | 行数变化 |
|---|---|---|
| `src/pages/Forecast.vue` | ① `saveVarAttr()` 留底回滚 + 失败提示；② `saveSuggestRecipe()` 接出 `cloudOk` 改降级文案；③ 列方案保存/删除两处同法；④ `setHeal()` 留底回滚 + 失败提示 | +37 / −12 |
| `src/utils/printable.js` | 删 `downloadPrintable`；`buildPrintableHtml` 转私有；文件头用法示例同步 | −14 / +1 |
| `src/api/client.js` | `clearTenantCookie` 去 `export`（函数体内逻辑未动） | ±5 |
| `src/pages/Workbench.vue` | 删死函数 `fmtNum`（全文唯一出现即定义行） | −2 |
| `src/utils/rebateCalc.js` | **整文件删除** | −148 |

### 后端 `hergent-erp/server`
| 文件 | 关键改动 |
|---|---|
| `domain/forecast_engine.py` | 效期聚合：异常收窄 + 脏日期行不再丢数量/金额 + 一次性 warning 计数 |
| `scheduler.py` | `_days_until` 改返回 `None` + 留痕；`_check_expiry` 改为一次性求值并跳过 `None`；`_check_contract_expiry` 跳过并留痕；`_backup_retention_days` 裸 except 收窄 + 留痕 |
| `db/queries/purchases.py` | 新增 `DEFAULT_APPROVAL_THRESHOLD=5000`；裸 except → `except Exception` + warning |
| `db/queries/inventory.py` | 新增 `EXPIRY_CRITICAL_DAYS/EXPIRY_WARNING_DAYS`；裸 except 收窄 |
| `db/queries/gl.py` | 删除 3 个 DEPRECATED no-op；保留一行口径说明 |
| `erp_db.py` | 仅 `db.queries.gl` 导入行收敛（**无逻辑改动**） |
| `hermes_core.py` | 审计兜底加 warning（no-op 行为不变） |
| `ai_engine.py` | 低置信度检测失败由 `pass` 改 warning |
| `import_zhoupu.py` | 数量解析回退的裸 except 收窄 |

---

## 三、验证记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| 前端构建 | `npm run build`（hergent-cn-v2） | ✅ `✓ built in 2.03s`；产物含 `printable-BL3F1_ze.js`、`Workbench-C-P0ayAR.js`，无 `rebateCalc` chunk |
| 后端全量字节码 | `python3 -m compileall -q . -x "(var|__pycache__)"` | ✅ exit 0 |
| 后端纯逻辑测试 | `tests/test_recon_engine.py` / `test_rebate_monthly_pure.py` / `test_rebate_period_v186.py` | ✅ 46 项断言全通过 / `ALL_OK` / 全部通过（**无回归**） |
| 后端导入冒烟 | `/tmp/shadow_import_smoke.py`（影子库） | ✅ 9/9 模块导入成功；`_days_until` 行为断言通过 |
| 效期修复行为验证 | `/tmp/expiry_fix_verify.py`（桩替换 DB） | ✅ ALL PASS（脏日期行由"被丢弃"变为并入 30 件/150 元） |
| 真实数据零写入 | `md5 erp.db` 前后对比 | ✅ 一致 `d3012908f8034d0ff370e14989fa354e` |
| 裸 except 清零 | `grep -rn -e "^[[:space:]]*except:[[:space:]]*$" server --include="*.py"` | ✅ 零命中 |

**未执行**：`tests/test_rebate_calc_contract.py` —— 它需要连真实 HTTP 后端（默认 `127.0.0.1:8700`），本机未运行后端服务，属环境限制而非回归。

---

## 四、不适用项说明（按用户要求明确指出原因）

1. **清单第 9 条（`fmtNum` 三套口径统一）—— 撤回，原判断不成立。**
   复核使用点后确认：`AiHub.vue` 的 `fmtNum` 作用于 `usage.calls` / `quota.remaining` / `used_this_month`（AI **调用次数与额度字符数**），`NotificationPanel.vue` 的 `fmtNum` 作用于 `unread` / `rows` / `triggers`（**通知条数**）——三者量纲不同，各用各的格式是正确的；且 `Workbench.vue:336` 那份**从未被调用**。强行统一成"万元口径"会把计数类数字错误折算。已按事实撤销该条，仅清理 `Workbench.vue` 的死函数。
2. **清单第 13 条（`fmtDate` 去重）—— 本轮不做。** 修复须新建公共模块（`utils/fmt.js`），与"不引入新的技术方案/不做重构"的约束冲突；两份实现输出一致、不影响正确性。若同意新建公共模块，可与其他日期格式化需求合并做一次。
3. **清单第 14 条（`Forecast.vue` 拆分 composable）—— 不适用。** 属大型重构，明确超出本次约束范围，建议单独立项（可先按已识别的 P12-5 / P15-5 / P15-6 / P15-7 四段试抽）。
4. **清单第 15 条子项（`roles.js:canUseMiniProgram`、`useCardTrigger.js` 四个 `strip*Fence`）—— 本轮不删，需你拍板。** 原因：这两处不是"意外死代码"。
   - `roles.js` 的 `canUseMiniProgram` + `MINI_PROGRAM_ROLES` 被项目文档与工具脚本（`.workbuddy/tools/scoped_stage_by_marker.py`、`memory/topics/backend-auth.md`）记为"前端角色唯一来源"的公开 API，注释还声明它是与员工档案「小程序」标注对齐的**护栏**——但实际没有任何代码调用它。删掉等于静默移除一项**号称存在却未接线**的护栏；接上则属功能新增（超范围）。两条路都需要你决定。
   - `useCardTrigger.js` 的 `stripIntentFence` / `stripClarifyFence` / `stripProposalFence` / `stripReminderFence` 是剥围栏协议的**对称面**（对应的 `extractClarify`/`extractProposal`/`extractReminder` 均**有**外部调用，实际剥离走 `stripAllFences`），且被《Hergent-副驾回复格式优化分析-对标WorkBuddy.md》引用。只删其中 4 个会破坏模块对称性与文档一致性。

---

## 五、交付状态与提醒

- **改动位置**：前端 `laozhangai-product`（5 文件改 + 1 删除）、后端 `hergent-erp/server`（9 文件改）。
- **未提交**：按惯例等你确认后再做受控提交（工作树里还有他人在途文件，如 `.workbuddy/memory/2026-09-21.md`，**不要**一并提交）。
- **未部署**：前端 `dist/` 已本地重建但**未 rsync 到生产**；后端**未部署、未重启** `hergent-gateway`/ERP 服务。
- **建议下一步**：① 对第 1/2/3 项（前端写路径）做一次真机点验（断网或制造 500，确认提示与回滚生效）；② 第 4 项可在生产用真实脏数据复核一次临期合计是否有变化；③ 决定第 15 条两个子项的取舍。
