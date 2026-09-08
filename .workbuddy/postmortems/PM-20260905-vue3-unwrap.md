# Postmortem PM-20260905-vue3-unwrap

> 一句话：Vue 3 `<script setup>` 内普通函数闭包的 `computed` 不会自动 `.value`，致「点改单」按钮触发 `Vn.has is not a function` 让整页白屏。

---

## 1. 元数据

| 字段 | 值 |
|---|---|---|
| **Postmortem ID** | PM-20260905-vue3-unwrap |
| **作者** | 张俊峰 + AI |
| **事故日期** | 2026-09-05 23:1x（约 23:10 用户反馈） |
| **解决时间** | 2026-09-05 23:25（修复部署 + e2e 通过） |
| **影响范围** | 单用户（首页级），所有用户均隐藏风险 |
| **持续时间** | 约 15 分钟（潜在 N 周——不是 P0 但每次点改单都翻车） |
| **严重度** | **P1**（功能受损：「改单」核心流程每次都白屏，但其他页面正常） |

---

## 2. 5W 一句话

**什么 + 何时 + 何地 + 谁影响 + 怎么发现**：2026-09-05 23:1x Forecast.vue `gapSet`（computed）在 setup 内被两个普通函数 `validateAll` 与 `namePadStyle` 引用，函数体内 `gapSet.has(...)` 缺少 `.value` → 点「改单」后渲染每行 `<input :style="namePadStyle(r)">` 触发 `Vn.has is not a function`，影响所有进入「编辑模式」的用户，由用户当场反馈发现。

---

## 3. 时间线

| 时间 | 事件 |
|---|---|
| **2026-09-05 历史** | Forecast.vue P5/P6/P7 批量增强完成时，`namePadStyle(r)` 函数被新增到 setup 内——但函数体里 `gapSet.has(...)` 未加 `.value`（自动 unwrap 规则的人脑盲区） |
| **同日早些** | 部署前端 `git commit f4daf7a` 的另一次小改动；bundle 验证 .has() 引用正常——只验证了模板里的 |
| **23:10** | 用户在生产点「改单」按钮，页面被 ErrorBoundary 替换 |
| **23:10** | 用户截图反馈「页面出错了」 |
| **23:11** | AI 在 production bundle `Forecast-B4pRvTvI.js` 抓取页面 console：`Vn.has is not a function`——stack pos `25:14685` |
| **23:13** | AI 反查源码：`gapSet` 是 `computed(() => new Set(...))` 包装对象；模板里 `gapSet.has(...)` 编译器自动 unwrap 正常，但**函数体里**不会自动 unwrap |
| **23:14** | AI 定位两处漏 `.value`：`validateAll`（L1836、`gapSet.has`）+ `namePadStyle`（L4402、`gapSet.has`） |
| **23:15** | AI 改源码 2 处补 `.value` |
| **23:17** | `npm run build` + `rsync` 部署，bundle hash 变 `Forecast-DsRtWFdw.js` |
| **23:20** | 无头浏览器 e2e：demo 登录 → 预报页 → 点改单 → 12 SKU 加载，无 pageerror |
| **23:25** | AI 写 memory + CLAUDE.md 铁律 |
| **23:30** | commit `f4daf7a` 落地 |

---

## 4. 影响（Impact）

- **受影响用户数**：**所有**会点「改单」进入编辑模式的用户（功能仅在编辑模式触发，所以比例低但影响全）
- **受影响功能**：预报页 `Forecast.vue` 进入「编辑模式」的所有渲染逻辑（含商品输入框、徽标、批注等）
- **数据丢失/损坏**：**无**（仅白屏，未保存编辑内容；用户重新进入编辑即可）
- **收入影响**：B 端 SaaS 用户每次进入编辑流程必翻车，体验劣化严重
- **对外影响**：尚未扩散（如未及时发现会持续影响所有用户）

---

## 5. 根因分析（Root Cause）

### 5.1 直接原因（一句话）

`Forecast.vue:setup` 内两个普通函数 `validateAll(r)` 和 `namePadStyle(r)` 闭包了 `gapSet`（computed 包装对象），函数体内直接调 `gapSet.has(r.product_id)`——`gapSet.has` 不是方法（包装对象没 `has`），运行期 throw。

### 5.2 根本原因（为什么走到这一步）

1. **Vue 3 自动 unwrap 规则在 setup 内**不**统一**：模板自动 unwrap，但函数体不自动 unwrap——这条规则的人脑盲区
2. **写完函数没 grep 自查**：缺一个简单的自查策略——「setup 内的普通函数 + 闭包 ref/computed + `.has/.get/.set/.size/.forEach/.keys` 调用 → 必须手动 `.value`」
3. **缺 ESLint 规则**：Vue 模板与 setup 函数体两套规则，本可以用 ESLint 自定义规则挡住，但项目当前未配
4. **bundle 验证有死角**：之前 commit 后只 grep `.has()` 数量，**未深入看 vs `.value.has()`**——本次幸运抓到「与头先」的不同 bundle 引用方式

### 5.3 触发链

```
用户点「改单」按钮
        ↓
editing=true，模板重渲每行
        ↓
<input :style="namePadStyle(r)"> 每行调用一次 namePadStyle(r)
        ↓
namePadStyle 函数体内：gapSet.has(r.product_id)
        ↓
gapSet 是 computed 包装对象 {value, effect}，不是 Set 实例
        ↓
Vn.has is not a function → 抛出
        ↓
Vue ErrorBoundary 捕获 → 整页替换为「页面出错了 / 点此重试」
```

### 5.4 不是根因的常见误判

- ❌ 不是「computed 没正确响应」——响应是正确的（模板用没事）
- ❌ 不是「gapSet 数据为空」——空 Set 调 `.has` 也不报错
- ❌ 不是「Pinia store 没初始化」——gapSet 是在 setup 内 `computed`，与 store 无关
- ✅ 真正根因：**Vue 3 setup 函数体不自动 unwrap ref/computed，人脑漏写 `.value`**

---

## 6. 修复（Mitigation）

### 6.1 立即修复

| 项 | 改动 | 验证 |
|---|---|---|
| **`validateAll` 补 .value** | `Forecast.vue:1836` `gapSet.has(r.product_id)` → `gapSet.value.has(r.product_id)` | e2e + 单点复测 |
| **`namePadStyle` 补 .value** | `Forecast.vue:4402` `gapSet.has(r.product_id)` → `gapSet.value.has(r.product_id)` | e2e + 单点复测 |

### 6.2 防复发（预防同样事故再次发生）

| 项 | 改动 | 验收口径 |
|---|---|---|
| **CLAUDE.md 加 Vue3 unwrap 铁律段** | `hergent-cn-v2/CLAUDE.md` §2「Vue 3 编码陷阱」段：写明「模板自动 unwrap / 函数体不自动 unwrap」+ 自查 grep 策略 | 文件已部署 |
| **MEMORY.md 写入 Vue3 unwrap 铁律** | `laozhangai-product/.workbuddy/memory/MEMORY.md`「前端规范」段补「Vue 3 setup 自动 unwrap 规则 + 复查策略」段 | grep `gapSet.value.has` 可查 |
| **bundle 验证升级** | 部署前 grep `gapSet.\\*has\(` → 应全为 `.value.has(`；如有裸 `.has()` 则报错 | 本次部署前已 grep 验证 4 处 `.value.has` 全部命中 |
| **（R1 候补）ESLint 自定义规则** | 加 ESLint 规则禁止 `setup` 内 `函数体` 直接对 ref/computed 用 `.has/.get/.set/.size/.forEach/.keys`——若要需加 `.value` | 项目配 ESLint |

---

## 7. 检测缺口（Detection Gap）

> **为什么没更早发现？**

- [x] **没有相关单测**——Vue 组件单测项目当前 0 个，无 pytest/vitest 框架就绪
- [x] **没有相关 e2e**——之前 e2e 只覆盖「编辑模式之外」的核心流程，「进入编辑模式渲染每行」未覆盖
- [x] **没有 bundle 自动化校验**——之前 grep 策略只查数量/接口，没查 `.has()` vs `.value.has()` 的调用上下文
- [ ] 没有用户主动反馈（用户本次即反馈）

**改进**：
- **加 e2e**（R1）：在 `vps-deploy-e2e` skill 加「编辑模式渲染验证」模板（点改单→断言无 console error→断言 12 行 input 元素）
- **加 bundle 自动化校验**（R1）：部署后 grep `\\.has\\(` / `\\.value\\.has\\(` 数量对比，错配即报警
- **加 Vue 组件单测**（R2）：vitest + @vue/test-utils 引入，挡函数体内的 unwrap 风险
- **加 ESLint**（R2）：规则挡住 `setup` 内函数体的 `.has`/`.get` 等调用

---

## 8. 行动项（Action Items）

> **5W2H：每条写 谁 + 做什么 + 何时 + 如何验证**

| # | 行动 | 负责人 | 截止 | 验证 |
|---|---|---|---|---|
| 1 | **Postmortem 归档**（本文件） | AI | 已完成 | 本文件存在 |
| 2 | **2 处函数体补 .value**（已做） | AI | 已完成 | commit f4daf7a |
| 3 | **CLAUDE.md 加 Vue3 unwrap 段**（已做） | AI | 已完成 | `hergent-cn-v2/CLAUDE.md` §2 存在 |
| 4 | **MEMORY.md 写 Vue3 unwrap 铁律**（已做） | AI | 已完成 | 文件存在 |
| 5 | **生产 e2e 验证**（已做） | AI | 已完成 | bundle Hash 验证 + 无头浏览器 e2e |
| 6 | **加 e2e「编辑模式」模板**（R1，本季度） | AI | T+30 | playwright 脚本可运行 |
| 7 | **bundle 自动化校验脚本**（R1，本季度） | AI | T+30 | grep 校验脚本落 `vps-deploy-e2e` skill |
| 8 | **Vue 组件单测引入**（R2，本季度） | AI | T+60 | vitest + 1 个组件样板测试 |
| 9 | **ESLint 自定义规则**（R2，本季度） | AI | T+60 | eslint 配置文件 + 1 条规则 |

---

## 9. 沉淀（SOP / CLAUDE.md / Skill）

### 9.1 是否进 SOP？
- [x] 是 → 应进 `PRODUCT-DEVELOPMENT-SOP.md` §二「开发中·AI 工作流约定·必做 3」补一条：「涉及 Vue 3 setup 改写必查：函数体内闭包 ref/computed 是否漏 `.value`；bundle 验证升级：grep `.has/.get/.set/.size` 必须 .value 配对」
- **状态**：本次先归档 Postmortem；SOP 主文档具体整合留待「月度 Postmortem 复盘」统一刷入（与本月月底的「回看本月 Postmortem，TOP 3 进 SOP」节奏对齐）

### 9.2 是否进项目级 CLAUDE.md？
- [x] 是 → `hergent-cn-v2/CLAUDE.md` §2「Vue 3 编码陷阱」（已落）

### 9.3 是否沉淀为 Skill？
- [ ] 否 —— 属「铁律」性质，已写入 CLAUDE.md + MEMORY.md；扩 `hergent-frontend-add-module` 为「Vue3 setup 安全编码自查模板」可作后续优化
- 候选扩 skill 名：`vue3-setup-safety-sweep`（扫描 setup 函数体里裸 `.has/.get/.set/.size` 调用）——R1 评估

### 9.4 是否进 MEMORY.md？
- [x] 是 → `laozhangai-product/.workbuddy/memory/MEMORY.md`「前端规范」段（已落）

---

## 10. 教训（Lessons）

> 用「未来不再犯」的句式写。

1. **未来不再因「setup 函数体漏 `.value`」让整页白屏**：因为本次把 Vue 3 自动 unwrap 规则（模板自动 + 函数体不自动）写入 hergent-cn-v2/CLAUDE.md §2。
2. **未来不再因「写完 setup 函数没自查」**：因为本次把复查策略「grep `setup\\s+内任意函数\\s*\\(` + `(ref|computed)\\.\\*?(has|get|set|size|forEach|keys)` 无 `.value` 即为 bug」写入铁律。
3. **未来不再因「bundle 验证有死角」**：因为本次把 bundle 验证升级为「grep `.has\\(` 与 `.value.has\\(` 数量对比，错配即报错」并准备集成进部署 skill。
4. **未来不再因「e2e 没覆盖编辑模式」**：因为本次把「点改单后断言无 console error」列为 e2e 必跑场景（R1 待补）。
5. **未来不再因「无 Vue 组件单测」长期跳隐患**：因为本次把 vitest + @vue/test-utils 引入列入 R2 行动项（即使目前人力紧张也要立项）。

---

## 📎 Postmortem 完成自查

- [x] 5W 一句话写清
- [x] 时间线完整（历史 → 23:30 闭环）
- [x] 影响量化（全用户 + 0 数据丢失）
- [x] 根因 vs 直接原因区分
- [x] 不是根因的常见误判也列了
- [x] 修复 + 防复发都有
- [x] 检测缺口提了（单测/e2e/bundle 三缺）
- [x] 行动项有负责人 + 截止 + 验证（9 项）
- [x] 4 个沉淀去向答了（SOP/CLAUDE.md/Skill/MEMORY.md）
- [x] 教训 5 条写完

---

> **写 5 分钟 Postmortem，省未来 3 小时「点改单就白屏」时间**。
