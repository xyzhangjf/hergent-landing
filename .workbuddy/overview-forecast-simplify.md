# 本期预报页（Forecast.vue）功能精简 — 概览

**目标**：页面功能罗列过多，按核心特性精简、合并、去冗余，降低视觉干扰。
**方案**：用户确认「做」= 方案①全做（工具栏精简 + 双视图合并 + 高级工具折叠 + 查看身份移除）。

## 改动清单
| 项 | 处理 | 说明 |
|---|---|---|
| 顶部工具栏按钮（~14→6+1） | 删冗余 | 删「余额&付款」「返利测算」（收进提交闭环向导3步）、「下游闭环向导」（改名「提交闭环」保留入口）、「查看身份」常驻label、旧 view-tabs 切换、列表专属「智能审核/保存草稿」 |
| 保留核心 | 6 按钮 + 1 向导 | 导入Excel / 编辑 / 保存调整 / AI审核 / 生成舟谱模板 / 复制全部下单 + 提交闭环 + 状态pill（已确认 / 草稿待经理确认） |
| 双视图 | 合并入内容区 | 「导入汇总 / 草稿填报」干净分段切换；草稿(draft)并行录入路径保留 |
| 草稿面板 | 迁入按钮 | 头部加「智能审核 / 保存草稿」（原工具栏项） |
| 4 平铺分组 | 收为折叠抽屉 | 编辑态「高级工具 ▾」展开后再展开 数据质量/智能预测/协同闭环/更多工具 |
| 向导弹窗标题 | 统一 | 「下游闭环向导」→「提交闭环」与工具栏按钮一致 |
| 样式 | 弱化 | 删 `.view-tabs` 改 `.view-seg`/`.ph-actions`；`.tbl-toolbar` 弱化为次级浅色条 |

## 部署
- 构建：`npm run build` → 成功（Forecast-FzsrTylM.js）
- 同步：`rsync -a --no-owner --no-group --delete dist/ → /opt/hergent-cn-v2/` + `chown -R hergent:hergent`
- 核对（构建产物 grep）：
  - 移除项归零：`view-tabs`=0、`查看身份`=0、`余额&付款`=0、旧向导标题=0
  - 新结构存在：`view-seg`/`ph-actions`/`高级工具`/`导入汇总`/`草稿填报`/`报单草稿`/`智能审核`(3)/`保存草稿`/`提交闭环`(2)

## 待用户真机确认（强刷页面）
1. 顶部按钮压减为 6 核心 + 提交闭环 + 状态 pill
2. 内容区出现「导入汇总 / 草稿填报」分段
3. 编辑态出现「高级工具 ▾」折叠抽屉
4. 草稿面板内有「智能审核 / 保存草稿」按钮

## 未做
- 浏览器真机验证（沙箱代理连不上 hergent.cn），仅后端+构建产物核对。
- `advToolsOpen` 变量在生产压缩后改名，属正常，逻辑已在 `.view-seg`/「高级工具」文案中确认落地。

## 更新：表内工具栏整合进主工具栏
- **为什么**：只读/编辑两模式各有一整条 `.tbl-toolbar`（搜索+分组/冻结/单价口径/显示AI建议+编辑动作+缩放），形成"第二工具栏"；且上轮「高级工具」因写在 `!editMode` 区块内却 `v-if="editMode"` 实际永不渲染。
- **做法**：
  - 搜索框上移主工具栏（单例，去重）。
  - 只读网格显示选项 → 主工具栏「表格设置 ⚙」弹层（`v-if=!editMode`）。
  - 编辑动作(生成建议/审批/推送/打印)+4分组 → 主工具栏「高级工具 ▾」抽屉（`v-if=editMode`，修复渲染 bug）。
  - 删除两处 `.tbl-toolbar`，仅留活动筛选 chips 行；缩放迁为全屏网格内浮条。
- **核对**：`tbl-toolbar`(JS)=0、表格设置=1、高级工具=1、gridFind=2(单输入框+脚本聚焦)。
- **待真机**：主工具栏含搜索框+⚙/高级工具；网格上方无整条工具栏；弹层点外部遮罩关闭；全屏右上角缩放条。

## 更新：全屏/缩放控件重叠修复
- **重叠根因**：全屏按钮 `.grid-fs-btn` 与全屏态缩放条 `.zoom-group` 均 `position:absolute` 钉在表体右上角（按钮 z-index:30、缩放条 z-index:1102），二者坐标重合 → 缩放条盖住退出全屏按钮（点不到）；非全屏态全屏按钮也绝对浮在表头末列上方压表体。旧避让规则（`.tb-toolbar`/`.edit-ops` 右侧留白）引用的类已被删，失效。
- **新设计**：把「全屏按钮 + 缩放条」合并为**表体上方一行 `.grid-ctl-row`（flex 流、右对齐）**，位于表格之上、靠 `.grid-area` 的 `gap:10px` 与表体自然留白；二者同排互不遮挡、随容器走，永不压表体。非全屏/全屏均成立；缩放条改为两态常驻（更实用）。
- **样式清理**：删 `.grid-area.is-fs .grid-fs-btn`、`.is-fs .zoom-group`(absolute)、`.not(.is-fs) .zoom-group{display:none}`、死 `.tbl-toolbar`/`.edit-ops` 留白；`.grid-fs-btn` 去 absolute 改为带边框的流内按钮。
- **核对（构建产物）**：旧漂浮规则=0；`grid-ctl-row`/`grid-ctl-right`/`zoom-group`/`grid-fs-btn` 各=2（只读 446 + 编辑 586）。已 build+rsync+chown 部署。
- **待真机**：①表体上方出现一行控制条（右：缩放 + 全屏图标）；②点全屏后控制条仍在顶部、退出按钮可点、不再有浮层压表头；③非全屏时缩放条也可见且不与表头重叠。

## 更新：全屏/缩放控件视觉微调（用户三诉求）
1. **全屏图标回到上一版样式**：`.grid-fs-btn` 由带边框/底色的流内按钮改回**无边框**（`border:none;background:none` + hover 浅底），即与 AI 副驾 `.cp-icon-btn` 对齐的上一版外观，去掉本轮回填的边框/底色（用户嫌丑）。
2. **整体收窄省空间**：控制条 `min-height:34→30px`、`grid-ctl-right` gap 10→8、`zoom-group` gap 8→6、滑块 `.zb-range` 140→100px、数值 `.zb-val` min-width 46→38px + 字号 12px、标签字号 12px；全局进度条 `.progress` 高度 `8→6px`（variables.css）。
3. **四图标同尺寸**：全屏按钮与缩放的「缩小/放大/重置(返回)」三个按钮统一 **26×26**，放大/缩小/返回/全屏四个图标一样大。
- **核对（构建产物 CSS）**：`grid-fs-btn` 26×26 且无边框、`.zb-range` 100px、`.grid-ctl-row` min-height:30px、全局 `.progress` height:6px 均落地。已 build+rsync+chown 部署。
- **待真机**：硬刷新后看控制条图标更紧凑、全屏按钮无边框、四个图标等大。

## 更新：全屏按钮回到上一版「悬浮右上角」
- **原因**：上一轮只把全屏按钮去边框、但仍留在顶部控制条里；用户要的"上一版"是**浮在表格右上角的图标**（重叠修复前的原样），所以觉得"没改过来"。
- **做法**：`<button class="grid-fs-btn">` 移出控制条、作为 `.grid-area` 直接子元素 `position:absolute;top:8px;right:8px;z-index:30`（压在 sticky 表头 z-index:7 之上，常显）；全屏态 `.grid-area.is-fs .grid-fs-btn{top:14px;right:14px}` 避开 12px padding；缩放条留控制条内并改为**左对齐**（移除 `grid-ctl-right` 右对齐包裹），与右上角悬浮按钮不冲突；仍保持无边框 + 26×26 与缩放三按钮同尺寸。只读/编辑两区同改。
- **核对（构建产物 CSS）**：`grid-fs-btn` 浮动无边框 + `is-fs` 偏移均落地；`grid-ctl-right` 已清除。已 build+rsync+chown 部署。
- **待真机**：硬刷新后全屏按钮回到表格右上角悬浮、无边框；缩放条在控制条左侧；点全屏后按钮仍在右上角、不被 padding 吃掉。

## 更新：全屏按钮图标修复（显示为横点）
- **原因**：Forecast.vue 内手写 SVG 的 path 数据 `M8 3H5a2 0 00-2 2v3...` 中，`H5a2` 的 `a2` 会被浏览器解析为非法的 arc 命令（参数缺失/错误），导致图标只渲染出一小段横线（用户截图红圈处）。
- **做法**：把只读/编辑两处 `<button class="grid-fs-btn">` 里的手写 SVG 替换为项目内置 `<Icon name="fullscreen" size="16"/>`（Icon.vue 中已有合法的四箭头全屏图标）；同时去掉 `cp-icon-btn` 类避免外部样式干扰。
- **核对（构建产物）**：非法 arc 模式 `a2 0 00-2`=0；正确 fullscreen 四条 path 各=1。已 build+rsync+chown 部署。
- **待真机**：硬刷新后表格右上角应显示正常的「四向箭头」全屏图标，不再是一个横点。

## 更新：主工具栏单行化（所有按钮同一水平行）
- **原因**：主工具栏 `.toolbar`（Forecast.vue:5302）原用 `flex-wrap:wrap` 会换行；且 `@media(max-width:768px)`（5719-5721）在窄屏把工具栏改成 `flex-direction:column` 纵向排列 → 多行/竖向。
- **做法**：
  1. `.toolbar` 改 `flex-wrap:nowrap` + `overflow-x:auto`（窄屏内容过多时**横向滚动**而非换行）；加 webkit 滚动条美化（height:6px，thumb 用 `--bd`）。
  2. `.toolbar>.tb-group`（左右两组）加 `flex:0 0 auto` 不收缩、内部 `.btn` `white-space:nowrap` 保证文字不折行；`.sel-period` 保持 `flex-shrink:0`。
  3. 删除媒体查询里的 `.toolbar{flex-direction:column;align-items:stretch}` 与 `.sel-period{width:100%}`（避免窄屏把期次 select 撑满导致换行），仅保留 padding/gap 微调。
- **核对（构建产物 CSS）**：`toolbar` `flex-wrap:nowrap`+`overflow-x:auto` 各=1、`flex-direction:column`=0、`toolbar>.tb-group` 选择器=1、scrollbar-thumb=1。已 build+rsync+chown 部署。
- **待真机**：硬刷新后主工具栏所有按钮（期次选择 / 搜索 / 导入 / 编辑 / 保存 / AI审核 / 表格设置 / 生成舟谱模板 / 复制下单 / 提交闭环 / 高级 / 状态徽标）在**同一水平行**内排列；缩窄浏览器窗口时出现底部横向滚动条而非换行；按钮文字不被截断。

## 更新：修复"高级 / 表格设置"下拉被遮挡
- **根因**：上一步给 `.toolbar` 加 `overflow-x:auto`，按 CSS 规范浏览器会把 `overflow-y` 强制提升为 `auto`，从而裁切掉超出工具栏高度的绝对定位下拉面板 `.tb-pop-panel`（原 `position:absolute;top:38px`，相对 `.tb-pop` 向下展开）。"高级 ▾"和"表格设置 ▾"两个弹层共用该 class，均被裁切 → 用户看到"下拉窗口被遮挡"。
- **做法**：
  1. 两个 `.tb-pop-panel` 用 `<Teleport to="body">` 包裹 + CSS 改 `position:fixed`，彻底脱离 `.toolbar` 的 overflow 裁切上下文（fixed 相对视口，且 `.toolbar` 无 transform 不创建包含块，故不被裁）。
  2. 加 `popStyle`(reactive 存 top/left) + `settingsBtn`/`advBtn`(ref) + `positionTbPop()`（用触发按钮 `getBoundingClientRect` 计算 `left=r.right-240`、`top=r.bottom+6`；下方空间不足则翻到按钮上方）+ `toggleTbPop(which)`（打开时 `nextTick` 定位）；按钮 `@click` 由直接翻转 `xxx=!xxx` 改为调 `toggleTbPop`。
  3. 删旧 `top:38px;right:0`。`.grp-row`（分组内部二级面板，738 行）在 `grid-area` 内、不在 toolbar 中，本就未被裁。
- **核对（构建产物）**：`.tb-pop-panel` CSS=`position:fixed`、旧 `top:38px`=0；`getBoundingClientRect`/ref 名(`settingsBtn`/`advBtn`)/参数串(`'settings'`/`'adv'`)均在；旧直接翻转残留=0。已 build+rsync+chown 部署。
- **待真机**：硬刷新后点「高级 ▾」/「表格设置 ▾」，下拉面板完整显示在按钮正下方（不再被裁切），点面板外遮罩自动关闭；点「高级 ▾」内"数据质量"等分组后二级面板也正常展开。
