<template>
  <div class="card history-card">
    <div class="history-hd">
      <h3>预报订单历史</h3>
      <span class="hint">按报单期次汇总，点击查看该期汇总表明细</span>
    </div>
    <!-- v368④：「本期少了 N 期」说明 —— 到货日被标记「不到货」的期次，自动建表
         不会再建；下面这些是**用户点停单之前**就建出来的。不说清楚会有两种误读：
         「这几期怎么自己冒出来了」／「期次怎么少了一期」（v365 定的不静默原则）。
         🔴 独立于下面的 loading/empty 分支（表格本身照常渲染，说明只是加在上面）。 -->
    <div v-if="!loading && skipped.length" class="hist-skip">
      <b>{{ skipped.length }}</b> 期的到货日已标记「不到货」（{{ skippedDates }}）——
      这批货不来了，自动建表不会再建它们；下面这几期是<b>标记之前</b>就建好的，
      不需要的话点「一键作废」（只关掉、数据保留，可恢复）。
    </div>
    <div v-if="loading" class="history-loading">加载中…</div>
    <div v-else-if="!list.length" class="history-empty">暂无历史预报期次</div>
    <div v-else class="table-wrap">
      <table class="tbl history-tbl">
        <thead>
          <tr>
            <th class="seq-th">序号</th>
            <th>期次名称</th>
            <th>下单区间</th>
            <th>到货日期</th>
            <th class="num">报单人数</th>
            <th class="num">总件数</th>
            <th class="num">下单金额</th>
            <th>状态</th>
            <th>定稿</th>
            <th>加单通知</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in list" :key="row.id" :class="{ active: row.status === 'open' }">
            <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
            <td>
              <b>{{ row.name || '—' }}</b>
              <!-- v319：人工接管过（重开/解锁过）⇒ 当面说明。否则用户会疑惑「为什么这期没被
                   到点自动关掉」——那是 v319 的豁免在起作用（人已把这期拿回来处理）。 -->
              <div v-if="row.reopened_at" class="hd-sub ok">人工接管 · {{ shortTs(row.reopened_at) }}</div>
              <!-- v355：过期未关 ⇒ 这一行**正挡着自动建表创建下一期**。此前它显示为绿色
                   「进行中」，与"其实早已报不了单"正好相反（生产实证 2026-09-29~10-01：
                   连着两天零提示，只靠"报单页是空的"才发现）。
                   判据 = 后端 `forecast_order_board` 的 `stale_open`（与报单硬锁同源）。 -->
              <div v-if="row.stale_open" class="hd-sub warn">已过报单截止日 · 挡住下一期创建</div>
            </td>
            <td>{{ row.order_start || '—' }} ~ {{ row.order_end || '—' }}</td>
            <td>
              {{ row.arrival_date || '—' }}
              <!-- v368③：这一期的到货日被标记「不到货」⇒ 当面点出来，它是「一键作废」的依据 -->
              <div v-if="row.arrival_skipped" class="hd-sub warn">那天不到货</div>
            </td>
            <td class="num">{{ fmt(row.reporter_count) }}</td>
            <td class="num">{{ fmt(row.total_qty) }}</td>
            <td class="num">¥{{ fmt(row.total_amount) }}</td>
            <td>
              <!-- v355：`stale_open`（后端给）⇒ 这一期虽仍是「进行中」，报单窗口却已过去。
                   标签从绿色换成琥珀色 —— 它标的是**挡路**，不是"正常进行中"。 -->
              <!-- v368：作废（closed_mode='void'）**必须**有自己的标签 ——
                   它和「已关闭」不是一回事：已关闭 = 正常走完流程；已作废 = 那批货
                   根本不来、这一期本不该建。混着显示会让用户以为"这期正常结束了"。 -->
              <span class="tag" :class="statusTag(row).cls" :title="statusTag(row).title">{{ statusTag(row).text }}</span>
            </td>
            <td>
              <!-- v319 修复：此列此前判据读 `forecast_audit_decisions`（已废弃的审核台表，
                   生产 0 行）⇒ **恒显示「未定稿」**，与左侧「状态=已关闭」自相矛盾
                   （两列说的是同一件事：关闭即定稿）。现在判据 = `status==='closed'`。
                   副行给出「谁在何时怎么定的稿」—— 以前只能翻服务日志，日志一滚就永久丢失。 -->
              <span class="tag" :class="finalTag(row).cls">{{ finalTag(row).text }}</span>
              <div v-if="row.finalized" class="hd-sub">{{ closeHint(row) }}</div>
            </td>
            <td>
              <!-- v319：只对「本期真有加/减单分配」的期次提示推送 —— 没有分配行就不该出现
                   「尚未推送」（那是**假待办**，会让经理去点一个没内容的动作）。 -->
              <template v-if="Number(row.alloc_count) > 0">
                <span v-if="row.alloc_pushed_at" class="tag ok">已推送</span>
                <span v-else class="tag warn">尚未推送</span>
                <div v-if="row.alloc_pushed_at" class="hd-sub">{{ shortTs(row.alloc_pushed_at) }}</div>
              </template>
              <span v-else class="hd-sub">本期无加/减单</span>
            </td>
            <td>
              <button class="btn btn-sm btn-ghost" @click="$emit('view', row)">查看</button>
              <!-- v184：复制。源可以是**任何真实期次**（不限 open）—— 「照着满意的那一期建
                   下一期」正是主场景，而满意的往往已经关闭了。合成行（id<0，如「2026-07-24
                   报单」）没有 forecast_periods 记录，没有可引用的 id，故屏蔽（与下方关闭/
                   删除同一判据）。只带商品清单，不带报单数量 / 加单 / 定稿。 -->
              <button v-if="Number(row.id) > 0 && canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="$emit('copy', row)">复制</button>
              <!-- v180：改名 / 改日期。此前没有这条路径 ⇒ 名字打错只能「关闭 → 删除」，
                   而删除会级联清掉该期全部报单/定稿/付款。仅 open 期次可改（与后端一致）。 -->
              <button v-if="row.status === 'open' && Number(row.id) > 0 && canDo('data', 'update')" class="btn btn-sm btn-ghost" @click="$emit('rename', row)">修改</button>
              <!-- A6 修复 (2026-07-24)：合成行（id<0，如「2026-07-24 报单」）无真实期次记录，
                   关闭/删除会打到无效 id（UPDATE 0 行或误触数据），故屏蔽 -->
              <!-- v368：作废入口 —— 只给「还是 open 且 到货日被标记不到货」的期次。
                   🔴 为什么必须是这两个条件的**交集**：
                     · 已关闭的期次不需要作废（它已经不挡路了）；
                     · 没被标记不到货的期次不该出现这个按钮（那不是"误建"，
                       给它一个「作废」只会让人误以为关单有什么问题）。
                   🔴 语义必须写在按钮上：作废 = **关掉它、让开自动建表的路**，数据保留 ——
                      用户怕的是"点了会不会把报单删了"（真删才删数据，作废不删）。 -->
              <button v-if="row.status === 'open' && Number(row.id) > 0 && row.arrival_skipped && canDo('data', 'create')"
                      class="btn btn-sm btn-ghost danger" @click="$emit('void', row)"
                      title="这一期的到货日已标记「不到货」⇒ 作废：关掉它、让开自动建表的路；数据保留，可恢复">一键作废</button>
              <button v-if="row.status === 'open' && Number(row.id) > 0 && canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="$emit('close', row)">关闭</button>
              <template v-if="row.status !== 'open' && Number(row.id) > 0">
                <!-- 🔴 v319（用户拍板）：关闭态给出**两个语义不同**的入口，不再是一个笼统的「重开」。
                     病因：v219 的「重开」同时做了两件事 —— ①允许授权角色改数 ②重开销售报单通道。
                     真实场景绝大多数只要 ①（**改一个错数**），却被迫把 ② 一起打开：
                     老板以为只是改个数，实际把报单通道重新开了。
                     · 解锁编辑：status 不动 ⇒ 销售照旧报不了单；授权角色可改数。副作用最小。
                     · 恢复报单：status 回 open ⇒ 销售可继续报单（= 原「重开」）。 -->
                <button v-if="canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="$emit('unlock', row)"
                        title="只解锁编辑：主管/管理员可改本期的数；销售的小程序报单通道**不**打开">解锁编辑</button>
                <button v-if="canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="$emit('reopen', row)"
                        title="恢复报单：本期回到「进行中」，销售的小程序可以继续报单">恢复报单</button>
                <!-- v319①：加单/减单通知的手动推送出口。自动关单的期次**一条都没推**
                     （调度器直调 db 层、不经端点），所以必须给一个人确认的入口。 -->
                <button v-if="Number(row.alloc_count) > 0 && !row.alloc_pushed_at && canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="$emit('push', row)"
                        title="把本期的加单/减单明细推送给对应业务员">推送通知</button>
                <button v-if="canDo('data', 'delete')" class="btn btn-sm btn-ghost danger" @click="$emit('delete', row)">删除</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { forecastApi } from '../api/modules'
/* v335：按钮级门禁 —— 本组期次动作全部落在 `/api/forecast/periods*`（模块 `data`，见后端
   `_PATH_MODULE_MAP` 的 `/api/forecast` 键），动作按 HTTP 方法判：关闭/解锁/恢复/推送/复制 = POST
   ⇒ `create`；修改 = PATCH ⇒ `update`；删除 = DELETE ⇒ `delete`。「查看」是纯读，不门禁。
   🆕 v368「一键作废」= POST /api/forecast/periods/{pid}/void ⇒ 同为 `data` / `create`。 */
import { canDo } from '../store'

const emit = defineEmits(['view', 'delete', 'close', 'rename', 'copy', 'reopen', 'unlock', 'push', 'void'])
const list = ref([])
const skipped = ref([])
const loading = ref(false)
/* v368④：把「到货日被标记不到货」的日期去重后点名 —— 用户要对得上他在「到货节奏」里
   点掉的那一天，光说"有 N 期"他没法确认自己点对了没有。 */
const skippedDates = computed(() =>
  [...new Set((skipped.value || []).map(s => s.arrival_date).filter(Boolean))].join('、'))

function fmt(n) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/* v319：把 '2026-09-29 14:48:50' 压成 '09-29 14:48' —— 表格里要给留痕留位置，
   但完整时间戳太长会把期次名挤没。缺值原样返回（不编造）。 */
function shortTs(t) {
  const s = String(t || '')
  const m = s.match(/^\d{4}-(\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  return m ? m[1] + ' ' + m[2] : s
}

/* v368：状态标签 —— 三条互斥路径，顺序**不可调换**（作废 > 过期未关 > 进行中 > 已关闭）。
   🔴 作废必须排第一：那一期 status 已经是 closed，若先判 status 就会落到「已关闭」，
      把"这一期本不该存在"显示成"正常走完了流程"。 */
function statusTag(row) {
  // 🔴 `closed_mode==='void'` **必须**同时判 `status !== 'open'`：
  //   「恢复报单」（reopen）只把 status 改回 open，**不清** closed_mode（v319 的留痕语义：
  //   留痕不该被后续操作抹掉）。若这里只看 closed_mode，重开后的期次会一直显示
  //   「已作废」—— 而它明明又是「进行中」了 ⇒ 界面与状态自相矛盾。
  if (row.closed_mode === 'void' && row.status !== 'open') {
    return { text: '已作废', cls: 'info', title: '这一期的到货日已标记「不到货」⇒ 已作废（数据保留，可恢复）' }
  }
  if (row.status === 'open') {
    return row.stale_open
      ? { text: '进行中 · 已过截止日', cls: 'warn', title: '本期报单截止日已过，但还挂着「进行中」—— 它会挡住新一期的自动创建' }
      : { text: '进行中', cls: 'ok', title: '' }
  }
  return { text: '已关闭', cls: 'info', title: '' }
}

/* v368：定稿列 —— 🔴 作废**不算定稿**。
   `finalized` 的判据是 `status==='closed'`，而作废也会把 status 关掉 ⇒ 若直接照它显示，
   这一行就会同时写着「已作废」（状态列）和「已定稿」（定稿列）—— 两列互相打架，
   用户会以为"这期既作废了又定稿了"。作废是**撤销**，流程没走完 ⇒ 显示「未定稿」，
   真正的原因由副行 closeHint 交代（「已作废（那批货不到）· 谁 · 何时」）。 */
function finalTag(row) {
  if (row.closed_mode === 'void') return { text: '未定稿', cls: 'info' }
  return row.finalized ? { text: '已定稿', cls: 'ok' } : { text: '未定稿', cls: 'info' }
}

/* v319：定稿来源说明 —— 「系统到点自动关单 · 09-29 11:18」/「人工定稿 · 张三 · 09-27 20:04」。
   ⚠️ 区分 auto / manual 不是装饰：自动关单**不发通知**（加单/减单那个），
      所以这两种定稿在后一列的表现不同（自动的那些会停在「尚未推送」）。
   🆕 v355（2026-10-01）：再分出 `auto_reap`（**报单窗口已过、被系统回收**）。
      🔴 为什么必须分：`auto` 与 `auto_reap` **都无人操作、`closed_by` 都是「系统」**，
         只有 mode 分得清。此前两者同值 ⇒「你重开过、系统替你收了尾」这件事被显示成
         「系统到点正常关单」—— 用户看不出自己那一步操作留下了什么后果。
      ⚠️ 与后端 `forecast_period_close` 的 mode 契约**同批改**（后端只写、这里只读）。
   🆕 v368：再分出 `void`（**作废** —— 那批货不到，这一期本不该建）。
      与后端的 `void_period` 端点同批改；不在这里分支 ⇒ 界面把它当成「人工定稿」，
      等于告诉用户"这期正常结束了"，而事实是"这期是错误产物"。
   ⚠️ 历史期次这三列是空的（v319 才加列）⇒ 显示「—」，**不假装知道**。 */
function closeHint(row) {
  const mode = row.closed_mode === 'void' ? '已作废（那批货不到）'
    : (row.closed_mode === 'auto_reap' ? '系统自动回收（报单窗口已过）'
      : (row.closed_mode === 'auto' ? '系统到点自动关单'
        : (row.closed_mode === 'manual' ? '人工定稿' : '')))
  const who = String(row.closed_by || '')
  const whoTxt = (who && who !== '系统') ? who : ''
  const ts = shortTs(row.closed_at)
  const parts = [mode, whoTxt, ts].filter(Boolean)
  return parts.length ? parts.join(' · ') : '（早期定稿，无留痕）'
}

async function load() {
  loading.value = true
  try {
    const d = await forecastApi.orderBoard()
    list.value = d.board || []
    // v368③：后端算、前端只展示 —— 判据与自动建表的排除判定同源，界面不自己重算
    skipped.value = d.skipped || []
  } catch (e) {
    list.value = []
    skipped.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.history-card { padding: 16px 18px; }
.history-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.history-hd h3 { font-size: 16px; font-weight: 600; margin: 0; }
.history-hd .hint { font-size: 12px; color: var(--t3); }
/* v368④：「本期少了 N 期」说明条 —— 颜色全走既有令牌（零硬编码色，深色自动跟随）。
   与 `.ap-excl`（报单自动化面板里那条）同族：都用主色 6% 底 + 主深字。 */
.hist-skip {
  margin: 0 0 12px; font-size: 12px; line-height: 1.65; color: var(--p-dark);
  background: rgba(var(--p-rgb), .06); border-radius: var(--radius-xs, 6px); padding: 7px 10px;
}
.history-loading, .history-empty { color: var(--t3); padding: 40px 0; text-align: center; font-size: 13px; }
/* 列数从 9 增到 10（v319 新增「加单通知」列）⇒ 最小宽度同步放宽，避免操作列被压成两行 */
.history-tbl { min-width: 1060px; }
.history-tbl tbody tr.active { background: var(--p-bg); }
.history-tbl td { font-size: 13px; }
.history-tbl th { font-size: 12px; color: var(--t2); font-weight: 500; }
.history-tbl .danger { color: var(--dan); }
.history-tbl .danger:hover { text-decoration: underline; }
/* 单元格副行（定稿来源 / 人工接管 / 推送时刻）—— 11px + nowrap，不参与换行争夺 */
.hd-sub { font-size: 11px; color: var(--t3); margin-top: 3px; white-space: nowrap; }
.hd-sub.ok { color: var(--suc); }
/* v355：过期未关的副行 —— 琥珀色（与同行状态标签同色系）。
   ⚠️ 用变量而非硬编码：`styles/variables.css` 亮 / 暗两套都有 `--warn-amber` 定义。 */
.hd-sub.warn { color: var(--warn-amber); }
</style>
