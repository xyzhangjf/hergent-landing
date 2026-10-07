<template>
  <div class="zp-wrap">
    <header class="zp-hd">
      <div>
        <h1 class="zp-title">舟谱单据导入</h1>
        <p class="zp-sub">
          把舟谱导出的<strong>销售结算明细表</strong>（客户提货）或<strong>调拨订单明细表</strong>（业务员提货）
          直接导进来，作为系统里的真实提货数据。
        </p>
      </div>
    </header>

    <!-- 三句必须讲清的口径：用户看过ユー会把「怎么算的」问一遍，写在页面上比写在文档里有用 -->
    <div class="zp-card zp-rules">
      <div class="zp-rule"><b>客户提货</b>看销售结算表：按客户记账，退货单（数量是负数）也会进来，这样才能算出净达成。</div>
      <div class="zp-rule"><b>业务员提货</b>看调拨表：业绩算在<b>调入仓</b>那个业务员头上；只导「已入库」的单，「待审核」的（货还没出库）不算。</div>
      <div class="zp-rule"><b>对不上的先不导。</b>客户 / 商品在系统里找不到就跳过，并把清单列给你；不会替你瞎建档案。</div>
    </div>

    <div class="zp-card">
      <div class="zp-file">
        <input ref="fileEl" type="file" accept=".xlsx,.xls"
               class="zp-file-input" @change="onPick" />
        <div class="zp-file-name">{{ file ? file.name : '还没选文件' }}</div>
        <button class="zp-btn" :disabled="!file || busy" @click="doPreview">
          {{ busy === 'preview' ? '正在读取…' : '读取这份表' }}
        </button>
      </div>
      <!-- v271：这条原来是「硬约束」（同步版 268.7 秒 vs nginx 300 秒只剩 31 秒余量），
           改成后台任务后已解除 —— 现在是建议，不再是警告。 -->
      <p class="zp-hint">
        文件必须是舟谱导出的原表（不用改格式、也不用删标题行，系统会自己找表头在哪一行）。<br>
        <b>导入在服务器上跑，关掉页面也不会中断</b>（重新打开这个页面还能接着看进度）。
        整年一次导完约 4 到 5 分钟；想快点就按月分批，一个月大约 20 到 30 秒。
      </p>
      <p v-if="err" class="zp-err">{{ err }}</p>
    </div>

    <!-- ===== v271 进度条 =====
         percent 为 null（预览阶段分母未知）时走流动条 —— **不给 0**：
         0% 一动不动跟卡死看起来一样，用户会去刷新页面，一刷新就丢了 job_id。 -->
    <div v-if="busy && prog" class="zp-card zp-running">
      <div class="zp-bar">
        <div v-if="prog.percent != null" class="zp-bar-in" :style="{ width: prog.percent + '%' }"></div>
        <div v-else class="zp-bar-in zp-bar-idle"></div>
      </div>
      <div class="zp-prog-txt">
        <span>{{ prog.phase }}</span>
        <span v-if="prog.percent != null"><b>{{ prog.percent }}%</b></span>
        <span>已用时 {{ prog.elapsed_sec }} 秒</span>
        <button class="zp-link" :disabled="cancelling" @click="doCancel">
          {{ cancelling ? '正在停下来…' : '中止导入' }}
        </button>
      </div>
      <p class="zp-hint">
        中止会在<strong>下一张单的边界</strong>停下来：已经导进去的完整单据会保留，不会出现半张单。
        没导完的部分下次再传同一份文件会自动补上。
      </p>
    </div>

    <!-- ===== 预览结果 ===== -->
    <div v-if="rep" class="zp-card">
      <h2 class="zp-h2">这份表里有什么</h2>
      <div class="zp-grid">
        <div class="zp-stat"><span>文件类型</span><b>{{ rep.label }}</b></div>
        <div class="zp-stat"><span>表头所在行</span><b>第 {{ rep.header_row }} 行</b></div>
        <div class="zp-stat"><span>单据日期范围</span><b>{{ rep.date_from }} ~ {{ rep.date_to }}</b></div>
        <div class="zp-stat"><span>共读到</span><b>{{ n(rep.stats.lines_total) }} 行明细 / {{ n(rep.stats.orders_total) }} 张单</b></div>
        <div class="zp-stat zp-ok"><span>能导进去</span><b>{{ n(rep.stats.lines_created) }} 行 / {{ n(rep.stats.orders_created) }} 张单</b></div>
        <div class="zp-stat zp-warn"><span>导不进去</span><b>{{ n(rep.stats.lines_skipped) }} 行</b></div>
      </div>

      <!-- 「正在导入」的提示改由上面的进度条承担（那里有百分比和中止按钮）——
           这里只放结果，别两处都说「正在…」，用户会不知道该看哪个。 -->
      <div v-if="done && done.aborted" class="zp-running">
        已中止：这一轮新建了 {{ n(done.orders_created) }} 张单、{{ n(done.lines_created) }} 行明细
        （用时 {{ done.elapsed_sec }} 秒）。剩下的下次再传同一份文件会自动补上。
      </div>
      <div v-else-if="done" class="zp-done">
        导入完成：新建 {{ n(done.orders_created) }} 张单、{{ n(done.lines_created) }} 行明细，
        用时 {{ done.elapsed_sec }} 秒。再传一次同一份文件不会产生重复。
      </div>
      <button v-else-if="rep.can_execute" class="zp-btn zp-primary" :disabled="busy" @click="doExecute">
        确认导入 {{ n(rep.stats.orders_created) }} 张单
      </button>

      <!-- 列识别：让用户能当场发现「某列没认出来」 -->
      <details class="zp-fold">
        <summary>列是怎么认出来的（{{ rep.columns.length }} 列）</summary>
        <table class="zp-tbl">
          <thead><tr><th>表里的列名</th><th>当成什么用</th><th>第几列</th></tr></thead>
          <tbody>
            <tr v-for="c in rep.columns" :key="c.field">
              <td>{{ c.header }}</td><td>{{ c.field }}</td><td>{{ c.col + 1 }}</td>
            </tr>
          </tbody>
        </table>
      </details>

      <!-- 缺漏清单（这是这个页面存在的理由：导之前先看清楚会少什么） -->
      <div v-if="rep.missing.length" class="zp-miss">
        <h3 class="zp-h3">这些内容导不进去（{{ rep.missing.length }} 类，共 {{ n(sumLines(rep.missing)) }} 行）</h3>
        <table class="zp-tbl">
          <thead><tr><th>原因</th><th>涉及</th><th class="zp-num">行数</th></tr></thead>
          <tbody>
            <tr v-for="(m, i) in rep.missing.slice(0, showAll ? 999 : 8)" :key="i">
              <td>{{ m.reason }}</td><td>{{ m.key }}</td><td class="zp-num">{{ n(m.lines) }}</td>
            </tr>
          </tbody>
        </table>
        <button v-if="rep.missing.length > 8 && !showAll" class="zp-link" @click="showAll = true">
          还有 {{ rep.missing.length - 8 }} 类，展开看全部
        </button>
      </div>

      <div v-if="rep.warnings.length" class="zp-warnbox">
        <h3 class="zp-h3">提醒（不影响导入，但你该知道）</h3>
        <table class="zp-tbl">
          <thead><tr><th>说明</th><th>涉及</th><th class="zp-num">行数</th></tr></thead>
          <tbody>
            <tr v-for="(w, i) in rep.warnings.slice(0, 6)" :key="i">
              <td>{{ w.reason }}</td><td>{{ w.key }}</td><td class="zp-num">{{ n(w.lines) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { zhoupuApi } from '../api/modules'

const file = ref(null)
const busy = ref('')
const err = ref('')
const rep = ref(null)
const done = ref(null)
const showAll = ref(false)
const fileEl = ref(null)
const jobId = ref('')
const prog = ref(null)
const cancelling = ref(false)
let timer = null

/* v271：任务号存 sessionStorage —— 用户关掉页面/刷新后回来还能接上进度。
   （导入在**服务器**上跑，页面关了也在跑；不记住任务号就只能让它跑完却没人看结果。） */
const JOB_KEY = 'hergent_zhoupu_job'
function saveJob(kind, id) {
  try { sessionStorage.setItem(JOB_KEY, JSON.stringify({ kind, id })) } catch { /* 无痕模式：忽略 */ }
}
function clearJob() {
  try { sessionStorage.removeItem(JOB_KEY) } catch { /* 同上 */ }
}

/* 数字一律加千分位 —— 这个页面全是几万十几万的数字，不加分隔符一眼读不出量级。 */
function n(v) {
  return String(v == null ? 0 : v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function sumLines(list) {
  return (list || []).reduce((a, b) => a + (b.lines || 0), 0)
}

function onPick(e) {
  const f = e.target.files && e.target.files[0]
  err.value = ''
  done.value = null
  rep.value = null
  if (!f) return
  if (!/\.(xlsx|xls)$/i.test(f.name)) {
    err.value = '只认 Excel 文件（.xlsx / .xls）。CSV 请先另存为 xlsx。'
    file.value = null
    return
  }
  file.value = f
}

function stopPoll() {
  if (timer) { clearInterval(timer); timer = null }
}
onBeforeUnmount(stopPoll)

/** 轮询任务进度，直到它结束。resolve(报告) / reject(错误)。
 *  1.5 秒一次：再快就是白刷服务器（一个任务要跑几分钟），再慢用户会觉得卡。 */
function poll(id) {
  return new Promise((resolve, reject) => {
    stopPoll()
    timer = setInterval(async () => {
      try {
        const r = await zhoupuApi.status(id)
        const d = (r && r.data) || null
        if (!d) return
        prog.value = d
        if (d.status === 'running') return
        stopPoll()
        if (d.status === 'failed') reject(new Error(d.error || '任务失败'))
        else resolve(d.result || {})
      } catch (e) {
        stopPoll()
        reject(e)
      }
    }, 1500)
  })
}

/** 开工 → 拿任务号 → 轮询。两个动作（预览/导入）共用这一段。 */
async function runJob(kind, starter) {
  busy.value = kind
  err.value = ''
  prog.value = null
  cancelling.value = false
  try {
    const r = await starter()
    const id = (r && r.data && r.data.job_id) || ''
    if (!id) throw new Error('服务端没返回任务号，请重试')
    jobId.value = id
    saveJob(kind, id)
    return await poll(id)
  } finally {
    busy.value = ''
    prog.value = null
    clearJob()
  }
}

async function doPreview() {
  if (!file.value) return
  try {
    const res = await runJob('preview', () => zhoupuApi.preview(file.value))
    rep.value = res
    done.value = null
    if (!rep.value) err.value = '没读到结果，请重试'
  } catch (e) {
    err.value = (e && e.message) || String(e)
  }
}

async function doExecute() {
  if (!rep.value || !rep.value.token) return
  const token = rep.value.token
  try {
    const d = await runJob('execute', () => zhoupuApi.execute(token))
    done.value = { orders_created: d.stats.orders_created, lines_created: d.stats.lines_created,
                   elapsed_sec: d.elapsed_sec, aborted: d.aborted }
    // 用服务端回执把预览结果刷新一遍：这样页面上的「已存在」才与库里一致，
    // 也顺手证明第二次再点是安全的（幂等）。
    rep.value.stats = d.stats
    rep.value.can_execute = !d.aborted
  } catch (e) {
    err.value = (e && e.message) || String(e)
  }
}

async function doCancel() {
  if (!jobId.value || cancelling.value) return
  cancelling.value = true
  try {
    await zhoupuApi.cancel(jobId.value)
  } catch (e) {
    err.value = (e && e.message) || String(e)
  }
  // 不在这里把 busy 清掉：等轮询拿到「已结束」再清，否则进度条会先消失再冒出结果
}

/* 重新打开页面时把没跑完的任务接回来 */
onMounted(async () => {
  let saved = null
  try { saved = JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null') } catch { saved = null }
  if (!saved || !saved.id) return
  jobId.value = saved.id
  busy.value = saved.kind || 'preview'
  err.value = ''
  try {
    const d = await poll(saved.id)
    if (saved.kind === 'execute') {
      done.value = { orders_created: d.stats.orders_created, lines_created: d.stats.lines_created,
                     elapsed_sec: d.elapsed_sec, aborted: d.aborted }
      // 接回导入任务时 rep 是空的（刷新丢了），只能显示结果数字 —— 用最小骨架兜住
      rep.value = rep.value || { stats: d.stats, can_execute: false, missing: [], warnings: [],
                                 columns: [], label: d.label || '', header_row: d.header_row || 0,
                                 date_from: d.date_from || '', date_to: d.date_to || '', token: d.token || '' }
      rep.value.stats = d.stats
      rep.value.can_execute = !d.aborted
    } else {
      rep.value = d
    }
  } catch (e) {
    err.value = '上一个任务没能接回来：' + ((e && e.message) || String(e))
  } finally {
    busy.value = ''
    prog.value = null
    clearJob()
  }
})
</script>

<style scoped>
.zp-wrap{max-width:960px;margin:0 auto;padding:20px 20px 60px}
.zp-hd{margin-bottom:14px}
.zp-title{font-size:20px;font-weight:600;margin:0 0 6px;color:var(--t1)}
.zp-sub{margin:0;font-size:13px;line-height:1.7;color:var(--t2)}
.zp-card{background:var(--bg2);border:1px solid var(--bd);
  border-radius:12px;padding:16px 18px;margin-bottom:14px}
.zp-rules{display:grid;gap:8px}
.zp-rule{font-size:13px;line-height:1.8;color:var(--t2)}
.zp-rule b{color:var(--t1);font-weight:600}
.zp-file{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.zp-file-input{font-size:13px}
.zp-file-name{font-size:13px;color:var(--t2)}
.zp-btn{padding:7px 16px;border-radius:8px;border:1px solid var(--bd);
  background:var(--bg2);color:var(--t1);font-size:13px;cursor:pointer}
.zp-btn:disabled{opacity:.5;cursor:not-allowed}
.zp-btn.zp-primary{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.zp-hint{margin:8px 0 0;font-size:12px;color:var(--t3);line-height:1.7}
.zp-err{margin:10px 0 0;padding:8px 12px;border-radius:8px;background:var(--dan-bg);
  color:var(--dan);font-size:13px}
.zp-h2{margin:0 0 12px;font-size:15px;font-weight:600;color:var(--t1)}
.zp-h3{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--t1)}
.zp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:14px}
.zp-stat{border:1px solid var(--bd);border-radius:8px;padding:10px 12px}
.zp-stat span{display:block;font-size:12px;color:var(--t2);margin-bottom:4px}
.zp-stat b{font-size:15px;font-weight:600;color:var(--t1)}
.zp-stat.zp-ok b{color:var(--ok-green)}
.zp-stat.zp-warn b{color:var(--warn-amber)}
.zp-running,.zp-done{margin:12px 0;padding:10px 14px;border-radius:8px;font-size:13px}
/* v271 进度条 */
.zp-bar{height:8px;border-radius:4px;background:var(--bd);overflow:hidden}
.zp-bar-in{height:100%;background:var(--p-dark);border-radius:4px;transition:width .4s ease}
/* 分母未知时的流动条：宽度固定 35% 左右滑来滑去，告诉用户「在动，只是算不出百分比」 */
.zp-bar-idle{width:35%;animation:zp-slide 1.2s ease-in-out infinite}
@keyframes zp-slide{0%{margin-left:-35%}100%{margin-left:100%}}
.zp-prog-txt{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--t2)}
.zp-prog-txt b{color:var(--p-dark)}
.zp-running{background:var(--warn-amber-bg);color:var(--warn-amber)}
.zp-done{background:var(--ok-green-bg);color:var(--ok-green)}
.zp-fold{margin-top:14px;font-size:13px;color:var(--t2)}
.zp-fold summary{cursor:pointer;padding:6px 0}
.zp-tbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
.zp-tbl th{text-align:left;padding:7px 10px;border-bottom:1px solid var(--bd);
  color:var(--t2);font-weight:500;font-size:12px}
.zp-tbl td{padding:7px 10px;border-bottom:1px solid var(--bd);color:var(--t1)}
.zp-tbl .zp-num{text-align:right}
.zp-miss,.zp-warnbox{margin-top:16px}
.zp-link{margin-top:8px;background:none;border:none;color:var(--p-dark);
  font-size:13px;cursor:pointer;padding:0}
</style>
