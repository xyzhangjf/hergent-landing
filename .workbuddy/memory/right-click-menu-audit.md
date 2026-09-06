# 本期预报交叉表 · 右键菜单审计（2026-09-04）

> 审计对象：`hergent-cn-v2/src/pages/Forecast.vue` 表体右键菜单（模板 1177–1218 行，26 个按钮）+ 全部 `ctx*` 处理函数与底层 helper（2906–3760）。
> 方法：逐函数静态追码 + 依赖存在性校验 + 确认 `toast` 来自 `import { store, toast } from '../store'`（非缺失）+ 线上 bundle 与审计源码同源（且菜单此前已被你实测可弹/可点，运行期 handler 均解析）。未做真机逐键点击（沙箱无 agent-browser CLI + SPA 需登录态）。

## 一、逐项验证结论

### A. 正常执行（点击即生效，无异常）
| # | 按钮 | handler | 说明 |
|---|---|---|---|
| 1 | 全选编辑区域 | `ctxSelectAll` | 调 `selectAll()` 选满编辑区；空表给 warn。正常 |
| 2 | 复制选区 | `ctxCopy` | `copyRegion()`→TSV 写剪贴板。正常 |
| 3 | 复制此行到下方 | `ctxCopyRow` | 克隆行 `product_id=0` 插入。正常 |
| 4 | ↑/↓ 插入行 | `ctxInsertRow` | splice blankRow。正常 |
| 5 | ↓ 向下填充 | `ctxFillDown` | 从右键格向下铺值。正常 |
| 6 | → 向右填充 | `ctxFillRight` | 向右铺值。正常 |
| 7 | ↑ 在上方/↓ 在下方 插入列 | `ctxInsertCol` | 仅 qty 列；自动命名"新客户N"。正常 |
| 8 | 删除此列 | `ctxDeleteCol` | qty→`delCol`；master 可删→`deleteMasterCol`。正常（但见"精简建议"） |
| 9 | 删除此行 | `ctxDeleteRow` | splice。正常（危险操作，设计即 danger） |
| 10 | 按安全库存补齐 | `ctxFillSafety` | `ctxNumCell` 时显示；填 `safety_stock`。正常 |
| 11 | 查看商品档案 | `ctxViewProfile` | `master&&name` 时显示；置 `prodProfile` 弹层（186 行存在）。正常 |
| 12 | 本行加备注 | `ctxSetNote` | →`setRowNote`。正常 |
| 13 | 复制为 CSV | `ctxCopyCsv` | `regionRect`→CSV 写剪贴板。正常 |
| 14 | 复制为 Markdown | `ctxCopyMd` | `regionRect`→MD。正常（业务低频，见精简） |
| 15 | 导出选中行 | `ctxExportSel` | →`buildXlsx`。正常 |
| 16 | 高亮库存<安全库存 | `toggleCondWarn` | 切换 `condWarnOn`。正常 |
| 17 | 撤销 / 重做 | `undo`/`redo` | `:disabled` 绑 `canUndo/canRedo`；含 cell/full 双快照。正常 |

### B. 条件可用（需注意前置）
| 按钮 | 限制 | 备注 |
|---|---|---|
| 粘贴 | 依赖 `navigator.clipboard.readText()`（需 HTTPS 安全上下文 + 文档聚焦 + 剪贴板读取权限） | 失败回退提示"请用 Ctrl+V"；主路径 `onPaste`（Ctrl+V）更稳 |
| 让 AI 分析这行 | 依赖 Hermes 副驾后端（`runHermes`/`hermesOpen`） | 后端可用即生效；离线/未配则无响应 |
| 此列统计 | `editColDescAt(c)` 返回 null 时 toast"该列不可统计" | 正常兜底，不崩 |

### C. 隐性问题 / 待修小项
1. **【小】清空按钮标签与行为不一**：表体空白右键且未框选时，`ctxClearLabel` 显示"清空当前选中"，但 `ctxClear` 实际只 `toast('请先框选区域或点全选编辑区域')`——点了无动作。建议标签改为"清空选区"或改为真正清空当前选中格。
2. **【设计】只读模式右键整菜单不弹**：`onTbCtx` 首行 `if(!editMode.value) return`。想"看档案/复制行/导出"也得先进编辑态，对非录入员不必要。
3. **【可靠】右键粘贴弱于 Ctrl+V**：见 B 粘贴项。

### D. 无失效项
26 个 handler 全部定义、无 undefined 引用、无抛错路径；无"绑定存在但底层落空"的隐性失效。

## 二、业务适配评估（蒙牛低温奶经销商 · 报单场景）

### 现有项 vs 使用习惯
报单闭环 = 选期次→录各门店数量→安全库存校验→AI建议→**复制厂家编码+数量粘厂家系统**。当前菜单 Excel 式能力齐全，但"报单闭环终点"（厂家下单文本）只暴露在**列头 per-column 按钮**（408 行），表体右键缺"整行下单文本"。

### 建议新增（按价值 ★）
- **★P0 复制本行/选中行「厂家下单文本」（厂家编码+数量）入右键**：报单最后一步，现仅列头有；右键整行一键复制最高频刚需。
- **★P1 用 AI 建议填充本行数量**：一键把 `r.suggest` 铺到该行所有报单单元（已有单行"采纳"按钮，加右键批量版）。
- **★P1 按安全库存补齐「整行/整列」**：现只补单格；经销商常需"所有低于安全库存的单元一键补齐"。
- **★P2 倍数调整选中区域（×1.2 节假日等）**：中频提效。
- **★P1 只读模式右键子集**：查看档案/复制行/导出/AI 分析 在只读态也可点（放 `onTbCtx` 对非编辑态开放只读子集）。

### 建议精简 / 移除
- **删除此列 移出单元格菜单**（保留表头菜单）：误点即删整客户列（虽可撤销，但高风险）；单元格菜单里它紧挨其它项，误触概率高。→ 防数据事故，P0。
- **复制为 Markdown 降级/移除**：经销商主要用 Excel/微信，Markdown 极少用；保留"复制选区(TSV)"+ "复制为 CSV" 即可。
- **菜单过长（22 项）治理**：非技术老板认知负荷大；按"常用(全选/复制/粘贴/清空/删除行)"与"高级(填充/统计/AI/导出)"分组，把厂家下单文本/AI填充提至常用组。

## 三、落地优先级
- **P0**：删除此列移出单元格菜单；复制厂家下单文本入右键；修"清空"标签/行为不一。
- **P1**：AI建议填充本行；安全库存补齐整行；只读模式右键子集。
- **P2**：Markdown 降级；倍数调整；菜单分组治理。

## 四、确认
本次仅审计未改码。给"要"即从 P0 起端到端改+`vite build`+rsync 部署+线上 grep 标记验证。
