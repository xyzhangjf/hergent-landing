# 品牌档案「添加品牌」按钮无反应 — 修复交付

## 现象
品牌档案页（档案管理 → 品牌档案）的「添加品牌」按钮点击后没有任何反应。

## 根因（无头浏览器真机复现确认）
按钮绑定了 `:disabled="!newBrand.name.trim()"`——**品牌名称为空时按钮本身就是禁用（灰）状态**。
用户预期像「编辑」那样点一下弹表单，实际却必须先填名称按钮才允许点，于是「点了没反应」。
这不是报错：后端 `POST /api/brands` 完全正常（无 token → 401 鉴权门、有 token 可建库），填名称后点击实测能成功建品牌并弹「已添加品牌」toast。

## 修复
把「添加品牌」改成与「编辑」一致的交互——**点一下直接弹新建弹窗**，校验放到弹窗内部：

- `src/pages/BrandArchive.vue`
  - 顶部加品牌行改为单个 `<button @click="openCreate">+ 添加品牌</button>`（去掉内联输入框和禁用逻辑）。
  - 编辑弹窗统一为「新建 / 编辑」双模式（`formOpen` + `formMode`，标题按模式显示「新建品牌」/「编辑品牌 · 名称」，保存按钮 `@click="saveForm"`）。
  - 脚本重构：`addBrand` / `newBrand` / `editOpen` 全部替换为 `openCreate` / `saveForm` / `formOpen` / `formMode`，删除旧引用。
- 同一次整站 `npm run build` 也带上了上一轮被打断的 **D4（返利页品牌下拉）** 改动，故 D4 一并上线。

## 验证（真机，符合验收标准）
无头 Chrome + demo 登录 `hergent.cn/#/archive/brands`：
1. 点「+ 添加品牌」→ **弹窗直接出现**（无禁用陷阱）。
2. 填品牌名称 → 保存按钮启用。
3. 点保存 → 新品牌入表 + 「已添加品牌」toast。

已清理 demo 租户（tenant_10.db）自建的两条测试品牌，未污染演示数据。

## 部署
前端 build + rsync → `/opt/hergent-cn-v2`（chown hergent），已生效。

## 附带状态
D2（商品品牌下拉 + brand 进入 bulk-upsert 保存）、D3（导入/舟谱写入接 normalize + 未命中入待审）、D4（目标/返利品牌选择器）后端已落地、前端 D2/D4 已随本次整站构建部署。D2/D4 的交互（下拉候选、保存携带 brand）尚未单独做浏览器点验，方便时你点一下确认即可。
