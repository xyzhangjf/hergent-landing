/* ============================================================================
   v413（2026-10-09）副驾「本轮轻重」判据 + 表格约束注入判据 —— **唯一实现**
   ----------------------------------------------------------------------------
   为什么独立成模块（而不是继续留在 CopilotDrawer.vue 里）：
     ① 这两条判据被**两处**消费 —— 超时分级（streamReply）与表格约束注入（send）。
        留在 .vue 里没法被判据台 `node` 直接加载（SFC 不是 ESM 模块）；
     ② 它们的边界（短确认词「要」、「本轮无附件但会话里有表」）正是出事的地方，
        必须能当**纯函数**反复验证；
     ③ 判据一旦抄成两份，就会出现「超时放宽了、约束却丢了」这种**半截修复**
        —— 本次事故就是两条判据同时只看"本轮"造成的。

   【背景事故 2026-10-09】
     老板上传两张邮储流水问「请帮我对账」⇒ 正常答出（全走 spreadsheet 工具通道）。
     随后他连回三次「要」继续 ⇒ 三次都在 3 分 0x 秒被掐断，提示「回答生成超时」。
     生产日志证明这三次里 Hermes 跑了 40 轮工具调用、其中 51 次是 `terminal`，
     在满服务器翻文件，一个字都没输出。
     根因 = **两条判据都只看"本轮"**：
       · 超时：`/对账|复盘|…/.test(q + content)` —— 「要」不含任何关键词 ⇒ 退回 3 分钟；
       · 约束：`if (tableFiles.length) 注入表格约束` —— 本轮没附件 ⇒ 整段约束消失；
         而那张表的 file_id 仍在 Hermes 的会话记忆里，它照样会去处理，
         于是失去约束后退回 terminal / read_file 乱翻。
   ========================================================================== */

/* 重活关键词：命中即按长任务（5 分钟）处理。
   ⚠️ 这里是**宽进**的 —— 多给两分钟，代价只是"最坏等更久"；
   误判成短任务，代价是**整轮白跑 + 已生成内容被丢**。两者不对称，故宁可宽。 */
export const HEAVY_RE = /对账|复盘|汇总|报表|经营分析|核销|结算|预测|预算|盘点|同比|环比|reconcil|spreadsheet/i

/* 短确认词：字面零信息量，轻重必须**继承上一条实质提问**。
   🔴 必须用 `^…$` 锚定**整句** —— 这类词出现在长句里（如「这个要看库存」）
   就不是确认，不能走继承分支。 */
export const CONFIRM_RE = /^(要|好|好的|行|可以|嗯|是|是的|对|继续|接着|同意|来吧|开始|执行|确认|提交|ok|okay|go|yes|y)[。！!，,、.～~\s]*$/i

/* 单个附件是否是 Excel/CSV —— 只有这两类才由 Hermes 的 spreadsheet 工具处理 */
export function isTableFile(f) {
  const name = (f && (f.file_name || f.name)) || ''
  return /\.(xlsx|csv)$/i.test(name)
}

/* 本会话（含历史轮）是否出现过表格附件。
   用途有二：① 判长任务（表还在它的记忆里，随时可能被继续算）；
             ② 判表格约束要不要注入（本轮没附件也必须注入，否则它退回 terminal）。 */
export function sessionHasTable(messages) {
  return (messages || []).some(m => m && m.role === 'user' && (m.files || []).some(isTableFile))
}

/* 这一轮该不该按长任务给超时。
     q        = 本轮输入框原文
     content  = 本轮拼装后的内容（含附件说明）
     messages = 对话历史（**含本轮已 push 的 user 消息**）
   判据优先级：本轮命中关键词 > 短确认词继承上一轮 > 会话碰过表格 > 最近几轮兜底 */
export function isHeavyTurn({ q, content, messages } = {}) {
  if (HEAVY_RE.test(`${q || ''} ${content || ''}`)) return true

  const users = (messages || []).filter(m => m && m.role === 'user' && !m.isSwitch && m.content)

  // ① 短确认词：往回找最近一条"不是确认词"的用户消息，用它的轻重决定本次
  if (CONFIRM_RE.test(String(q || '').trim())) {
    for (let i = users.length - 1; i >= 0; i--) {
      const c = String(users[i].content || '')
      if (CONFIRM_RE.test(c.trim())) continue                     // 连续确认（「要」「要」）⇒ 继续往前找
      if (HEAVY_RE.test(c)) return true                           // 上一条是重活 ⇒ 这一句也是
      if ((users[i].files || []).some(isTableFile)) return true   // 上一条带表 ⇒ 也算长任务
      return false                                                // 上一条是闲聊 ⇒ 不继承，退回 3 分钟
    }
  }
  // ② 本会话只要碰过表格，后续一律按长任务 —— 表在它的记忆里，随时可能被继续计算
  if (sessionHasTable(messages)) return true
  // ③ 兜底：最近 6 条消息（约 3 轮）里出现过重活关键词
  return users.slice(-6).some(m => HEAVY_RE.test(String(m.content || '')))
}

/* 表格约束该不该注入。🔴 不能只看本轮附件 —— 见文件头【背景事故】里"约束"那条。 */
export function shouldInjectTableHint({ tableFiles, messages } = {}) {
  return (tableFiles && tableFiles.length > 0) || sessionHasTable(messages)
}

/* 表格软提示正文（Plan A：全量计算上移 Hermes 的 spreadsheet 工具，前端只透传 file_id）。
   🔴 tableFiles 为空但会话历史有表时**也要能拼** —— 此时不列 file_id 清单，
      只重申通用约束（沿用上文已给出的 file_id）。 */
export function spreadsheetSoftHint(tableFiles) {
  const n = (tableFiles || []).length
  const header = n
    ? [
        '',
        '【表格数据说明】用户上传了以下 Excel/CSV（均已存于后端，你必须通过工具读取，严禁直接读文件内容）：',
        tableFiles.map(f => `- ${f.file_name}: file_id=${f.file_id}`).join('\n'),
      ]
    : [
        '',
        '【表格数据说明】本次会话此前已上传过 Excel/CSV（尚未处理完）——沿用上文给出的 file_id，继续时同样必须遵守下述约束：',
      ]
  const common = [
    '【强制】处理这些表格【只能】使用 spreadsheet_summary / spreadsheet_query / spreadsheet_reconcile_files 工具对【全部数据】精确计算。',
    '【严禁】使用 terminal / execute_code / write_file / read_file / search_files 等工具处理这些文件——这些无法可靠解析 Excel，且会令任务长时间运行导致连接超时中断。',
    '请严格基于 spreadsheet 工具返回的真实结果回答，不要心算、不要估算、不要编造。',
  ]
  if (n >= 2) {
    return [
      ...header,
      `用户上传了 ${n} 个文件，【若要对账/对比两份独立文件】，必须调用 ` +
        'spreadsheet_reconcile_files(file_a=<其中一个 file_id>, file_b=<另一个 file_id>, key=对账键列, amount=金额列) 做跨文件对账（不要自行写脚本合并两个文件）。',
      '调用前请先用 spreadsheet_summary 分别看清两个文件的 sheet 名与列名，再传准确的 key / amount / sheet 参数。',
      ...common,
    ].join('\n')
  }
  return [
    ...header,
    '先用 spreadsheet_summary(file_id) 看清工作表与列结构；再按问题调用：',
    '  单文件内两表对账用 spreadsheet_query(op=match, sheet_a=, sheet_b=, key=, amount=)、分组汇总用 op=groupby、总计用 op=sum。',
    ...common,
  ].join('\n')
}
