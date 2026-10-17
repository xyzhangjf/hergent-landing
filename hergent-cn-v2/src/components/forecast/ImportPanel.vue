<script setup>
/* ---- P0-2 Excel 导入弹窗（forecast_cross）—— F3 从 Forecast.vue 抽离 ----
   🔴 抽离铁律：函数体一字不改，只动「组件边界 + props/emits」。
   父组件只保留 `impOpen` 开关与 `openImport()` 闸口（canImport 判据是页面级，供工具栏入口按钮用）；
   本组件自拥全部导入状态（impState、impFile*、impMapping、impResult…）与逻辑，
   通过 props 接收页面上下文、通过 emits 回抛「关闭 / 导入后刷新」。
   注册方式：父组件用 defineAsyncComponent 懒加载本组件 ⇒ 首屏 Forecast chunk 不含它，
   仅当首次点「导入」时才按需加载（懒加载天然成立）。 */
import { ref, computed } from 'vue'
import { importApi } from '../../api/modules'
import { toast } from '../../store'
import Icon from '../Icon.vue'
import ImportMapping from '../ImportMapping.vue'

const props = defineProps({
  cross: { type: Object, required: true },
  curOpenPeriodId: { type: Number, default: 0 },
  periods: { type: Array, default: () => [] },
  canDo: { type: Function, required: true },
  openNewPeriod: { type: Function, required: true },
  recordAudit: { type: Function, required: true },
})
const emit = defineEmits(['close', 'reload'])

const impState = ref(null)           // null | 'preview' | 'done'
const impFileInput = ref(null)
const impFileObj = ref(null)
const impFileName = ref('')
const impHeaders = ref([])
const impPreview = ref([])
const impMapping = ref({})
const impResult = ref(null)
const importing = ref(false)
/* v178 列映射确认：身份列与客户列都可在界面上改判（此前只读回显，改不了）。
   候选字段由后端 /preview 的 field_options 给 —— 前端不自己写一份键→中文。 */
const impSuggestions = ref([])
const impFieldOptions = ref([])
/* v303：映射记忆命中提示（后端 /preview 回的 `remembered`）。报单矩阵每期客户列都在变，
   这是四处导入里最需要它的地方。 */
const impMemory = ref(null)
/* 客户列数从 **实际要提交的 mapping** 派生，不再取后端识别结果 ——
   否则用户在上面把某列改成「不导入」后，按钮仍写着 N 个客户，文案与提交内容两套口径。 */
const impCustomerCount = computed(() => Object.values(impMapping.value).filter(v => v === 'customer').length)
const impCanExec = computed(() => impCustomerCount.value > 0)

/* ---- v180 导入的「本期归属」 ----------------------------------------------------
   归属期次由**后端**在导入那一刻解析（import_router: forecast_period_current() →
   兜底 forecast_period_default()），前端不接受指定 ⇒ 归属必须**前置展示**，
   而不是等导入完成后才问用户「要不要命名期次」（那时数据已经落库、归属已定死）。
   口径对齐：GET /api/forecast/periods 的 `current` 就是同一个 default() ⇒ 前端用
   **curOpenPeriodId**（只由 current 赋值，不随期次下拉/往期查看漂移）即为归属，
   而**不是** curPeriod（= 正在查看的期次）—— 查看往期时点「导入」，数据仍会落到
   当前期次，这个差异要让用户看见（impViewMismatch）。 */
const impOwnedPeriodId = computed(() => Number(props.curOpenPeriodId || 0))
const impOwnedPeriod = computed(
  () => (props.periods || []).find(p => Number(p.id) === impOwnedPeriodId.value) || null
)
const impOwnedName = computed(() => impOwnedPeriod.value?.name || (impOwnedPeriodId.value ? `期次 #${impOwnedPeriodId.value}` : ''))
const impViewMismatch = computed(() => {
  const viewed = Number(props.cross?.period?.id || 0)
  return impOwnedPeriodId.value > 0 && viewed > 0 && viewed !== impOwnedPeriodId.value
})
const impViewedName = computed(() => props.cross?.period?.name || '')
// 回执里「这次导入到底归到哪」用**后端回传的** results.period_id（权威），
// 不用上面的预告 —— 两者可能因「导入瞬间刚建了期次」而不同。
const impResultPeriodId = computed(() => Number(impResult.value?.results?.period_id || 0))
/* 进价是模版的「条件必填」列：闸门开启时档案里没有进价的行会被整行拒收。
   旧版把这句做成只读回显，用户看到「未识别」也无从下手；现在改成能被改的提示。 */
const impFactoryMissing = computed(() => !Object.values(impMapping.value).some(v => v === 'factory' || v === 'price'))

// v157 零档案建档结果：后端在 results 里回传 products_created_count / products_reused_count /
// products_backfilled_count / unmatched_products，并在顶层回传 barcode_conflicts。
// 没有任何一条时返回 null（不显示空块）。
const impArchive = computed(() => {
  const r = impResult.value
  if (!r) return null
  const rs = r.results || {}
  const created = Number(rs.products_created_count || 0)
  const reused = Number(rs.products_reused_count || 0)
  const backfilled = Number(rs.products_backfilled_count || 0)
  const unmatched = Array.isArray(rs.unmatched_products) ? rs.unmatched_products : []
  const conflicts = Array.isArray(r.barcode_conflicts) ? r.barcode_conflicts : []
  const createdNames = Array.isArray(rs.products_created) ? rs.products_created.slice(0, 5) : []
  const backfilledNames = Array.isArray(rs.products_backfilled) ? rs.products_backfilled.slice(0, 5) : []
  if (!created && !reused && !backfilled && !unmatched.length && !conflicts.length) return null
  return { created, reused, backfilled, unmatched, conflicts, createdNames, backfilledNames }
})

// v158 进价闸门：后端在 results 里回传 products_rejected_no_factory(_count) 与 factory_price_gate_on。
// 只在**闸门开启**时渲染（关闭时两个字段为 0/false → 返回 null，不显示空块）。
// 为什么单列一块：被拒的行是「整行没进报单」，用户最容易误以为「导入成功了」→ 必须点名到商品。
const impFpRejected = computed(() => {
  const rs = impResult.value?.results
  if (!rs || !rs.factory_price_gate_on) return null
  const names = Array.isArray(rs.products_rejected_no_factory) ? rs.products_rejected_no_factory : []
  return { count: Number(rs.products_rejected_no_factory_count || names.length || 0), names }
})

// v163 导入回执的「需要注意」：后端 results.warnings（非致命，但下游会出问题）+ 未配置对象清单。
// 与 errors 分开是有意的 —— errors = 「行根本没进来」，warnings = 「进来了，但你得知道这件事」。
// 旧实现在「报单对象不在报单配置里」时完全静默，用户以为导入成功，直到生成舟谱单据才发现缺客户全称。
const impWarnings = computed(() => {
  const ws = impResult.value?.results?.warnings
  return Array.isArray(ws) ? ws : []
})
const impUnmapped = computed(() => {
  const us = impResult.value?.results?.report_unmapped
  return Array.isArray(us) ? us : []
})

function pickFile() { impFileInput.value && impFileInput.value.click() }

async function downloadFcTemplate() {
  try {
    const blob = await importApi.templateFile('forecast_cross')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '预报订单导入模板.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('模板已开始下载', 'ok')
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}

async function onImportFile(ev) {
  const f = ev.target.files && ev.target.files[0]
  if (!f) return
  impFileObj.value = f
  impFileName.value = f.name
  impState.value = null
  importing.value = true
  try {
    const prev = await importApi.preview(f, 'forecast_cross')
    impHeaders.value = prev.headers || []
    impPreview.value = prev.preview || []
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    // v303：报单矩阵的客户列每期都在变（客户名做表头），这是四处导入里**最需要
    //   映射记忆**的一处 —— 命中就少认一遍几十个客户列。只回填 `remembered`，
    //   不走「跳过已存在的记录」（那条路径在 `_execute_forecast_cross` 里提前 return，
    //   `mode` 不生效 ⇒ 界面上不显示那个勾选框，见 ImportMapping 的 showIncremental 注释）。
    impMemory.value = prev.remembered || null
    const mapping = {}
    for (const s of impSuggestions.value) {
      if (s.suggested_field) mapping[s.index] = s.suggested_field
    }
    impMapping.value = mapping
    impState.value = 'preview'
  } catch (e) {
    toast(e.message || '文件解析失败', 'err')
    impState.value = null
  } finally {
    importing.value = false
    ev.target.value = ''
  }
}

async function doImport() {
  if (!impFileObj.value || !Object.keys(impMapping.value).length) return
  importing.value = true
  try {
    const od = (props.cross.period && props.cross.period.order_start) || ''
    const r = await importApi.execute(impFileObj.value, 'forecast_cross', impMapping.value, { order_date: od })
    impResult.value = r
    impState.value = 'done'
    // v166：导入会直接改写本期「导入」报单（覆盖式先清后建），是对汇总表的实质改动 → 留痕
    props.recordAudit('import', `${impFileName.value || '（未命名文件）'}（${r.imported_count || 0} 行 / ${r.results?.success || 0} 个客户）`)
  } catch (e) {
    toast('导入失败: ' + (e.message || ''), 'err')
  } finally {
    importing.value = false
  }
}

/* 关闭并刷新：父组件监听到 reload 后执行 impOpen=false + loadCross()。
   原实现是 `closeImportAndReload()`（同时置 impOpen=false 与 loadCross）；
   抽离后状态归本组件、刷新归父组件，故改为 emit。 */
function reload() { emit('reload') }
</script>

<template>
  <Teleport to="body">
    <Transition name="fade"><div class="imp-overlay" @click="$emit('close')"></div></Transition>
    <Transition name="pop">
      <div class="imp-modal" :class="{ 'imp-wide': impState === 'preview' }">
        <div class="imp-hd"><b>导入预报订单 Excel</b><button class="imp-x" @click="$emit('close')"><Icon name="close"/></button></div>
        <div v-if="!impState" class="imp-body">
          <p class="imp-tip">选择你现有的订单汇总表（行=商品、列=客户、格=数量）。系统自动识别商品列与客户列，导入后即汇总进交叉表。</p>
          <!-- v180：归属期次前置展示。归到哪个期次是**导入那一刻**由后端定死的，
               导入后再命名不会把它挪过去 —— 所以这个问题只能在导之前回答。
               v193：这一支（无期次）**正常流程已不可达** —— 入口按钮已按 canImport 置灰、
                      openImport 里也硬拦。保留它是**兜底**（后端同轮加了硬闸，此支只覆盖
                      「抽屉已开着时期次被别的会话删掉」这类竞态），不是主路径。 -->
          <p class="imp-own" :class="{ warn: !impOwnedPeriodId }">
            <template v-if="impOwnedPeriodId">
              本期归属：<b>{{ impOwnedName }}</b>
            </template>
            <template v-else>
              <b>你现在还没有期次</b> —— 这次导入不会归到任何期次，之后再新建期次它也不会自动跟过去。
              <button v-if="canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="openNewPeriod()"><Icon name="plus"/> 先建一个期次</button>
            </template>
          </p>
          <p v-if="impViewMismatch" class="imp-own warn">
            你正在查看的是「{{ impViewedName }}」，但导入会归到「{{ impOwnedName }}」——
            导入的归属取的是<b>当前进行中的期次</b>，不是你正在看的这一期。
          </p>
          <div class="imp-actions">
            <button class="btn btn-ghost" @click="downloadFcTemplate"><Icon name="download"/> 下载模板</button>
            <!-- v335：按钮级门禁 —— 「选择文件…」触发 = POST /api/import/preview ⇒ data/create
                 （与 /api/import/execute 同模块同动作；入口按钮已按 canImport 置灰，此处防守备） -->
            <button v-if="canDo('data', 'create')" class="btn btn-primary" @click="pickFile">选择文件…</button>
          </div>
          <p v-if="impFileName" class="imp-file">已选择：{{ impFileName }}</p>
        </div>
        <div v-else-if="impState === 'preview'" class="imp-body">
          <p class="imp-tip">系统按列名猜字段，可能猜错（例如把「合计」当成客户列）。核对「识别为」这一列，不对就在下拉里改 —— 标「不导入」的列不会进来。</p>
          <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions"
                         :memory="impMemory" :show-incremental="false" />
          <p v-if="impFactoryMissing" class="imp-gate">没有识别到「进价」列。进价闸门开启时，档案里也没有进价的行会被整行拒收 —— 文件里若有这一列（旧模版里叫「厂价」），请在上表把它改成「进价」。</p>
          <div v-if="impPreview.length" class="imp-matrix">
            <table class="tbl">
              <thead><tr><th v-for="(h, hi) in impHeaders.slice(0, 12)" :key="hi">{{ h }}</th></tr></thead>
              <tbody>
                <tr v-for="(r, ri) in impPreview.slice(0, 4)" :key="ri">
                  <td v-for="(c, ci) in r.slice(0, 12)" :key="ci">{{ c }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="imp-ft">
            <button class="btn btn-ghost" @click="impState = null">重选文件</button>
            <!-- v335：按钮级门禁 —— 导入执行 = POST /api/import/execute ⇒ data/create
                 （只读角色连「选择文件」都不给，见下方 canImport 入口判据） -->
            <button v-if="canDo('data', 'create')" class="btn btn-primary" :disabled="!impCanExec || importing" @click="doImport">
              {{ importing ? '导入中…' : `确认导入（${impCustomerCount} 个客户）` }}
            </button>
          </div>
        </div>
        <div v-else-if="impState === 'done'" class="imp-body">
          <!-- v179：**四种结局必须分开渲染**。用户 2026-09-16 实测踩中的正是第二格
               ——「商品都建档了、但一个客户列都没填数量」被旧文案渲染成绿色的
               「导入成功：0 个客户」，他因此以为整个导入都成功了。
               判据（有没有建档、有没有生成报单）由后端一次判完（archived_no_qty /
               product_rows_count），前端不重推规则 —— 同一规则两处实现必然漂移。 -->
          <p v-if="impResult && impResult.results?.archived_no_qty" class="imp-none">
            <b>已建档 / 更新 {{ impResult.results?.products_affected_count || 0 }} 个商品，但没有生成任何报单。</b>
            原因：这份文件里所有客户列的数量都是空的 —— 数量由业务员从小程序报。
            如果你是要用这份模版<u>批量建商品档案</u>，这一步已经完成了，明细见下方「商品档案」。
            <!-- 「行数 ≠ 商品数」必须说清基数，否则用户拿行数对不上会以为漏导：
                 同条码的两行 = 同一商品的两个户头（见 v163 户头口径），登记按商品去重。 -->
            <template v-if="(impResult.results?.product_rows_count || 0) > (impResult.results?.products_affected_count || 0)">
              文件里有 {{ impResult.results?.product_rows_count }} 行商品身份行，
              其中 {{ impResult.results?.product_rows_count - impResult.results?.products_affected_count }} 行与前面的条码相同（同一商品的两个户头），计为同一个商品。
            </template>
          </p>
          <div v-else-if="(impResult?.results?.errors || []).length">
            <p class="imp-warn">导入完成，但有 {{ impResult?.results?.errors?.length || 0 }} 处异常：</p>
            <ul class="imp-errs"><li v-for="(e, i) in (impResult?.results?.errors || []).slice(0, 8)" :key="i">{{ e.msg }}</li></ul>
          </div>
          <p v-else-if="(impResult?.results?.success || 0) > 0" class="imp-ok">导入成功：{{ impResult.results?.success || 0 }} 个客户</p>
          <p v-else class="imp-none">
            这份文件里没有可导入的内容 —— 既没有识别到商品行（商品名称 / 条码），
            也没有任何客户列填了数量。
          </p>
          <!-- v180 归属回执：**仅在真的没归到期次时出现**（判据用后端回传的
               results.period_id —— 权威值，不用前端预告）。
               归属正常（>0）时这里什么都不显示：工具栏已有常显的「新建期次」，
               常态再引导一次纯属噪音。也不做成自动弹窗 —— 导入已完成、数据已落库，
               弹窗会让人以为「还没结束」而回头重导。 -->
          <div v-if="impResult && !impResultPeriodId" class="imp-arch">
            <div class="imp-arch-hd warn">这次导入没有归到任何期次</div>
            <p class="imp-arch-note">
              数据已经进来了，但你现在还没有期次 —— <b>之后再新建期次，这批商品和报单不会自动跟过去</b>。
              要现在建一个吗？
            </p>
            <button v-if="canDo('data', 'create')" class="btn btn-sm btn-ghost" @click="reload(); openNewPeriod()">
              <Icon name="plus"/> 现在新建期次
            </button>
          </div>
          <!-- v163 导入回执：「导入成功了，但下游会出问题」必须显式给出。
               判据（用户 2026-09-15）：「导入没有成功要给用户一个回执，说明不成功的原因」。
               最典型的一条：报单对象不在「报单配置」里 → 生成舟谱单据时缺「客户全称 / 调拨仓」，
               单据无法导入舟谱。旧实现对此**完全静默**（只显示「成功 N 个客户」），
               用户要一路做到下单那一步才发现 —— 那时已经不知道是哪一列的问题了。 -->
          <div v-if="impWarnings.length" class="imp-arch">
            <div class="imp-arch-hd warn">需要注意</div>
            <ul class="imp-arch-list warn">
              <li v-for="(w, i) in impWarnings" :key="i">{{ w }}</li>
            </ul>
            <p v-if="impUnmapped.length" class="imp-arch-note">
              这些 Excel 列（共 {{ impUnmapped.length }} 个）不在「报单配置」里：
              <template v-for="(o, i) in impUnmapped.slice(0, 12)" :key="i">
                <b>{{ o.name }}</b><span v-if="i < Math.min(impUnmapped.length, 12) - 1">、</span>
              </template><span v-if="impUnmapped.length > 12"> …</span>
            </p>
          </div>
          <!-- v157: 零档案建档结果（后端已回传 products_created_count / reused / unmatched / conflicts） -->
          <div v-if="impArchive" class="imp-arch">
            <div class="imp-arch-hd">商品档案</div>
            <div class="imp-arch-line">
              <span class="imp-arch-tag ok">自动建档 <b>{{ impArchive.created }}</b> 个</span>
              <span class="imp-arch-tag muted">复用已有 <b>{{ impArchive.reused }}</b> 个</span>
              <!-- v157：命中已有档案时顺带补进去的空字段（最常见的就是老商品没录进价） -->
              <span v-if="impArchive.backfilled" class="imp-arch-tag ok">补进已有档案 <b>{{ impArchive.backfilled }}</b> 个</span>
            </div>
            <ul v-if="impArchive.backfilledNames.length" class="imp-arch-list">
              <li v-for="(n, i) in impArchive.backfilledNames" :key="i">补录：{{ n }}</li>
            </ul>
            <p v-if="impArchive.backfilled" class="imp-arch-note">
              只有已有档案里<u>空着</u>的字段才会被补上（多为进价/规格），档案里已有的值一律不动。
            </p>
            <ul v-if="impArchive.createdNames.length" class="imp-arch-list">
              <li v-for="(n, i) in impArchive.createdNames" :key="i">新建：{{ n }}</li>
            </ul>
            <p v-if="impArchive.unmatched.length" class="imp-arch-note warn">
              有 {{ impArchive.unmatched.length }} 条商品没能建档（缺名称或缺条码），这些行的数量不会计入汇总：
            </p>
            <ul v-if="impArchive.unmatched.length" class="imp-arch-list">
              <li v-for="(n, i) in impArchive.unmatched.slice(0, 5)" :key="i">{{ n }}</li>
            </ul>
            <p v-if="impArchive.conflicts.length" class="imp-arch-note warn">
              有 {{ impArchive.conflicts.length }} 条条码冲突（同一张条码已存在别的商品名下），系统未覆盖任何已有档案，
              已记入「条码冲突」台账，请人工确认后处理。
            </p>
          </div>
          <!-- v158 进价闸门：连进价都没有的行被拒 —— 「整行不进报单」是硬结果，必须给补价入口指引。
               闸门关闭时后端回传 factory_price_gate_on=false → 此块不渲染。
               v165：判据口径已改「进价 → 标准售价」两档（原「厂价列 / 进价列」两列合一），故不再只看 factory_price 一列。 -->
          <div v-if="impFpRejected" class="imp-arch">
            <div class="imp-arch-hd">进价必填（已开启）</div>
            <template v-if="impFpRejected.count">
              <p class="imp-arch-note bad">
                有 <b>{{ impFpRejected.count }}</b> 个商品因为<u>连进价都没有</u>被拒收，这些行的数量<u>没有</u>进本次报单：
              </p>
              <ul class="imp-arch-list">
                <li v-for="(n, i) in impFpRejected.names.slice(0, 8)" :key="i">{{ n }}</li>
              </ul>
              <p class="imp-arch-note">
                进价就是厂家跟你结算的价（元/箱）。请到 <b>商品档案 → 补进价</b> 补上（可「导出待补清单」批量填好再导回），补完重新导入本文件即可。
              </p>
            </template>
            <p v-else class="imp-arch-note">本次导入的商品都有进价，没有行被拒收。</p>
          </div>
          <div class="imp-ft">
            <button class="btn btn-primary" @click="reload">完成，刷新交叉表</button>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 隐藏文件选择框：pickFile() 触发其 click()，onImportFile 处理选中文件 -->
    <input ref="impFileInput" type="file" accept=".xlsx,.xls" style="display:none" @change="onImportFile">
  </Teleport>
</template>

<!-- ⚠️ 非 scoped：本组件经 Teleport 渲染到 body，scoped 属性不会匹配到父组件样式。
     故导入弹窗专用样式在此自持；共享的 `.del-modal`/`.warn-text`/`.del-actions`/`.btn.danger`
     等仍留在 Forecast.vue（被其它弹窗使用），此处不重复，避免污染全局。 -->
<style>
.imp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:var(--z-page-modal-overlay)}
.imp-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(560px,94vw);background:var(--bg);border-radius:var(--radius-lg);z-index:var(--z-page-modal);box-shadow:var(--shadow-lg);max-height:86vh;display:flex;flex-direction:column}
.imp-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle)}
.imp-hd b{font-size:14px}
.imp-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.imp-x:hover{color:var(--p-dark);background:var(--bg2);border-radius:var(--radius-sm)}
.imp-body{padding:16px 18px;overflow-y:auto}
.imp-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.imp-tip{font-size:var(--fs-sm);color:var(--t2);line-height:1.7;margin-bottom:14px}
.imp-modal.imp-wide{width:min(880px,94vw)}
.imp-gate{margin:10px 0 12px;padding:8px 12px;border-radius:var(--radius-sm);font-size:var(--fs-sm);line-height:1.6;background:var(--warn-amber-bg);color:var(--warn-amber)}
.imp-matrix{max-height:180px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-md);margin-bottom:12px}
.imp-matrix table{font-size:var(--fs-sm)}
.imp-matrix th,.imp-matrix td{padding:5px 8px;border-bottom:1px solid var(--border-subtle);white-space:nowrap}
.imp-matrix thead th{position:sticky;top:0;background:var(--bg3)}
.imp-ft{display:flex;justify-content:flex-end;gap:10px;padding-top:6px}
.imp-ok{color:var(--suc);font-size:13px;margin-bottom:12px}
.imp-warn{color:var(--war);font-size:var(--fs-sm);margin-bottom:8px}
.imp-none{color:var(--info-blue);font-size:13px;line-height:1.75;margin-bottom:12px}
.imp-errs{margin:0;padding-left:18px;font-size:12px;color:var(--t2);line-height:1.8}
.imp-arch{margin-top:12px;padding:12px 14px;border:1px solid var(--bd);border-radius:var(--radius-md);background:var(--bg2)}
.imp-arch-hd{font-size:var(--fs-sm);font-weight:600;color:var(--t1);margin-bottom:8px}
.imp-arch-line{display:flex;gap:10px;flex-wrap:wrap}
.imp-arch-tag{font-size:var(--fs-sm);color:var(--t2);padding:3px 10px;border-radius:999px;background:var(--bg3)}
.imp-arch-tag b{color:var(--t1);font-size:14px;margin-left:2px}
.imp-arch-tag.ok{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.imp-arch-tag.ok b{color:var(--suc)}
.imp-arch-list{margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--t2);line-height:1.75}
.imp-arch-note{margin:10px 0 0;font-size:var(--fs-sm);line-height:1.7;color:var(--t2)}
.imp-arch-note.warn{color:var(--war)}
.imp-arch-note.bad{color:var(--dan)}
.imp-arch-note.bad b{color:var(--dan)}
</style>
