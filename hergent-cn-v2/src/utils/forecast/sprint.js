/* v629：「这一期有没有返利冲刺数据可看」的唯一判据。
   🔴 抽出来的理由：页脚胶囊（SprintChip）与工具栏「冲刺看板」按钮都要判它。
     两处各写一遍三元表达式，迟早有一天只改一边 ⇒ 出现"按钮在、胶囊不在"或反过来
     （v183「同一行数与色不得互相矛盾」同族纪律：同一语义只能有一份判据）。
   两个调用方都不允许自己另写一遍 `summary.err || summary.rules > 0`。 */
export function sprintHasData (s) {
  return !!s && (!!s.err || (Number(s.rules) || 0) > 0)
}
