<template>
  <div class="card history-card">
    <div class="history-hd">
      <h3>预报订单历史</h3>
      <span class="hint">按报单期次汇总，点击查看该期汇总表明细</span>
    </div>
    <div v-if="loading" class="history-loading">加载中…</div>
    <div v-else-if="!list.length" class="history-empty">暂无历史预报期次</div>
    <div v-else class="table-wrap">
      <table class="tbl history-tbl">
        <thead>
          <tr>
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
          <tr v-for="row in list" :key="row.id" :class="{ active: row.status === 'open' }">
            <td>
              <b>{{ row.name || '—' }}</b>
              <!-- v319：人工接管过（重开/解锁过）⇒ 当面说明。否则用户会疑惑「为什么这期没被
                   到点自动关掉」——那是 v319 的豁免在起作用（人已把这期拿回来处理）。 -->
              <div v-if="row.reopened_at" class="hd-sub ok">人工接管 · {{ shortTs(row.reopened_at) }}</div>
            </td>
            <td>{{ row.order_start || '—' }} ~ {{ row.order_end || '—' }}</td>
            <td>{{ row.arrival_date || '—' }}</td>
            <td class="num">{{ fmt(row.reporter_count) }}</td>
            <td class="num">{{ fmt(row.total_qty) }}</td>
            <td class="num">¥{{ fmt(row.total_amount) }}</td>
            <td><span class="tag" :class="row.status === 'open' ? 'ok' : 'info'">{{ row.status === 'open' ? '进行中' : '已关闭' }}</span></td>
            <td>
              <!-- v319 修复：此列此前判据读 `forecast_audit_decisions`（已废弃的审核台表，
                   生产 0 行）⇒ **恒显示「未定稿」**，与左侧「状态=已关闭」自相矛盾
                   （两列说的是同一件事：关闭即定稿）。现在判据 = `status==='closed'`。
                   副行给出「谁在何时怎么定的稿」—— 以前只能翻服务日志，日志一滚就永久丢失。 -->
              <span class="tag" :class="row.finalized ? 'ok' : 'info'">{{ row.finalized ? '已定稿' : '未定稿' }}</span>
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
import { ref, onMounted } from 'vue'
import { forecastApi } from '../api/modules'
/* v335：按钮级门禁 —— 本组期次动作全部落在 `/api/forecast/periods*`（模块 `data`，见后端
   `_PATH_MODULE_MAP` 的 `/api/forecast` 键），动作按 HTTP 方法判：关闭/解锁/恢复/推送/复制 = POST
   ⇒ `create`；修改 = PATCH ⇒ `update`；删除 = DELETE ⇒ `delete`。「查看」是纯读，不门禁。 */
import { canDo } from '../store'

const emit = defineEmits(['view', 'delete', 'close', 'rename', 'copy', 'reopen', 'unlock', 'push'])
const list = ref([])
const loading = ref(false)

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

/* v319：定稿来源说明 —— 「系统自动关单 · 09-29 11:18」/「人工定稿 · 张三 · 09-27 20:04」。
   ⚠️ 区分 auto / manual 不是装饰：自动关单**不发通知**（加单/减单那个），
      所以这两种定稿在后一列的表现不同（自动的那些会停在「尚未推送」）。
   ⚠️ 历史期次这三列是空的（v319 才加列）⇒ 显示「—」，**不假装知道**。 */
function closeHint(row) {
  const mode = row.closed_mode === 'auto' ? '系统自动关单'
    : (row.closed_mode === 'manual' ? '人工定稿' : '')
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
  } catch (e) {
    list.value = []
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
</style>
