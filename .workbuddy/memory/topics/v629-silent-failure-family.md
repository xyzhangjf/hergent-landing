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
