<template>
  <div class="page">
    <div class="page-hd">
      <h2>商品目标</h2>
      <span class="page-sub">按月设总量 · 分解到人 · 期次自动认领</span>
    </div>

    <!-- ══ 口径说明（写死的业务口径，不是动态数据）════════════════════════════
         为什么要摆在页头下方而不是藏进「?」：这张表上「目标 / 已达成 / 均单」三个数
         都带单位换算（件/包/袋），用户第一眼必须知道**基准是箱**、**均单怎么来的**，
         否则会拿「合计(小单位)」去和这里的箱数对，得出「系统算错了」。 -->
    <div class="pt-caliber">
      <b>口径</b>
      <span>目标一律按<b>箱</b>设（商品必须已配大单位换算）</span>
      <span>·</span>
      <span>均单剩余(箱) = (月目标 − 已达成) ÷ 剩余可报期次</span>
      <span>·</span>
      <span>剩余期次 = 整月到货日历里「今天及以后」的到货日个数</span>
    </div>

    <!-- ══ v264c（R9）：报单列名 ↔ 报单对象 对账告警 ══════════════════════════
         只在「确实有列名没配上」时出现；配齐了整条消失 —— 不留一条「全部正常」的
         常态噪音（本项目对纯状态文案零容忍）。
         为什么这件事必须在**目标页**说：目标要分解到人，而「谁报了多少」依赖
         报单列名能对上人；对不上时系统不会报错，只是安静地少算一个人。
         v265（2026-09-24）：本页已收进「预报订货管理」当第 4 个页签，「报单配置」就是隔壁
         那个 tab ⇒ 原先"它没有独立路由、只能干指路"的顾虑消失，这里改成**一键跳过去修**。 -->
    <div v-if="audit && audit.unmapped_count > 0" class="pt-audit">
      <b>有 {{ audit.unmapped_count }} 个报单列名还没配进「报单配置」</b>
      <div class="pt-audit-b">
        {{ audit.unmapped.slice(0, 8).join('、') }}<template v-if="audit.unmapped.length > 8"> 等 {{ audit.unmapped.length }} 个</template>
      </div>
      <div class="pt-audit-b">
        这些列存进系统时不带门店/员工身份，只能靠名字对 ——
        <b>报单配置里一改名就对不上账，而且不会报错</b>。
        其中 {{ sameNameCnt }} 个在客户档案里有同名（配一下就能对上），
        {{ unknownCnt }} 个连客户档案里也没有。
      </div>
      <div class="pt-audit-b pt-audit-go">
        修法：把这些列名填成对应的「报单别名」。
        <button class="pt-audit-btn" @click="goReportMapping">去「报单配置」修</button>
      </div>
    </div>

    <!-- ══ 工具栏 ══ -->
    <div class="pt-tbar">
      <span class="pt-tbar-t">目标月份</span>
      <input v-model="month" type="month" class="fld pt-fld-m" aria-label="目标月份" @change="load(month)">
      <span class="pt-tbar-t">均单按</span>
      <select v-model.number="periodId" class="fld pt-fld-p" aria-label="期次" @change="loadAvg">
        <option :value="0">不显示均单</option>
        <option v-for="p in periods" :key="p.id" :value="p.id">
          {{ p.name || ('期次 ' + p.id) }}{{ p.status === 'open' ? '（进行中）' : '' }}
        </option>
      </select>
      <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load(month)">刷新</button>
      <span class="pt-sp"></span>
      <button class="btn btn-primary btn-sm" @click="openNew">新建目标</button>
    </div>

    <!-- ══ 列表 ══ -->
    <div class="card pt-card">
      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="err" class="state-empty pt-err">{{ err }}</div>
      <div v-else-if="!rows.length" class="state-empty">
        这个月还没有商品目标。点右上「新建目标」开始建第一条。
      </div>
      <div v-else class="pt-wrap">
        <table class="pt-tbl">
          <thead>
            <tr>
              <th class="pt-th-prod">商品</th>
              <th>品牌</th>
              <th class="num">目标(箱)</th>
              <th class="num">已达成(箱)</th>
              <th class="num">差额(箱)</th>
              <th class="num">本期报单(箱)</th>
              <th class="num">剩余可报</th>
              <th class="num">均单(箱)</th>
              <th class="num">分解</th>
              <th class="pt-th-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in rows" :key="r.id">
              <tr :class="{ 'pt-row-open': openId === r.id }">
                <td class="pt-prod">
                  <button class="pt-exp" :title="openId === r.id ? '收起分解' : '展开分解'"
                          @click="toggle(r.id)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                         :style="{ transform: openId === r.id ? 'rotate(90deg)' : 'none' }">
                      <path d="M9 6l6 6-6 6"/>
                    </svg>
                  </button>
                  <div class="pt-prod-txt">
                    <b>{{ r.product_name || ('商品 #' + r.product_id) }}</b>
                    <span class="pt-spec">{{ r.name || '—' }}</span>
                  </div>
                </td>
                <td class="pt-brand">{{ r.brand || '—' }}</td>
                <td class="num"><b>{{ fmt(r.target_qty) }}</b></td>
                <td class="num">{{ fmt(r.achieved_box) }}</td>
                <td class="num" :class="gapClass(r)">{{ fmt(gapOf(r)) }}</td>
                <td class="num">{{ repText(r) }}</td>
                <td class="num pt-quiet">{{ remText(r) }}</td>
                <td class="num">
                  <b v-if="avgOf(r) != null">{{ fmt(avgOf(r).avg_box) }}</b>
                  <span v-else class="pt-quiet" :title="avgWhy(r)">—</span>
                </td>
                <td class="num pt-quiet">{{ (r.allocs || []).length }} 人</td>
                <td class="pt-op">
                  <button class="btn-icon" title="改目标量" @click="openEdit(r)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>
                    </svg>
                  </button>
                  <button class="btn-icon" title="删除目标（同时删掉分解）" @click="askDelete(r)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </td>
              </tr>
              <tr v-if="openId === r.id" class="pt-detail-row">
                <td :colspan="10">
                  <div class="pt-detail">
                    <div class="pt-detail-hd">
                      <b>分解到人</b>
                      <span class="pt-quiet">
                        Σ 分解 = {{ fmt(r.alloc_total) }} 箱（必须等于目标 {{ fmt(r.target_qty) }} 箱）
                      </span>
                    </div>
                    <table class="pt-sub">
                      <thead>
                        <tr><th>承接人</th><th class="num">占比</th><th class="num">目标(箱)</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="a in r.allocs" :key="a.employee_id">
                          <td>{{ a.employee_name || ('员工 #' + a.employee_id) }}</td>
                          <td class="num">{{ fmt(a.ratio) }}%</td>
                          <td class="num">{{ fmt(a.target_qty) }}</td>
                        </tr>
                        <tr v-if="!(r.allocs || []).length">
                          <td colspan="3" class="pt-quiet">这条目标没有分解明细（历史数据）。</td>
                        </tr>
                      </tbody>
                    </table>
                    <!-- 逐人实报：P1 才做（需要 report_alias 桥）。这里**显式说明未上线**，
                         而不是留一个空列让用户以为「报了单却没数」。 -->
                    <div class="pt-note">
                      逐人实报（谁报了多少）在下一批上线 —— 它依赖员工与报单门店的别名对应关系，
                      请先在「报单配置」里为员工维护别名。
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ══ 新建 / 编辑弹窗 ══ -->
    <Teleport to="body">
      <div v-if="modal" class="pt-mask" @click.self="closeModal">
        <div class="pt-modal">
          <div class="pt-modal-hd">
            <b>{{ editing ? '改目标量' : '新建商品目标' }}</b>
            <button class="btn-icon" title="关闭" @click="closeModal">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="pt-modal-bd">
            <div class="pt-form">
              <label class="pt-lb">商品</label>
              <div class="pt-pick">
                <input v-if="!editing" v-model="pkw" class="fld pt-pick-in" placeholder="输入商品名或条码搜索"
                       aria-label="搜索商品" @input="searchProducts">
                <div v-if="!editing" class="pt-pick-list">
                  <!-- v277（S3）：可设目标的商品仍是 <button>（整行可选）；缺换算的商品改用 <div>
                       —— **必须换标签**，因为「补换算」要在这一条里再嵌一个 <button>，
                       而 button 不能嵌套 button：HTML 解析器会把内层踢出外层，表现为
                       「点补换算没反应、控制台零报错」（本项目文档里那类「死控件」的经典形态）。 -->
                  <template v-for="p in prods" :key="p.id">
                    <button v-if="p.can_target" class="pt-pick-item"
                            :class="{ on: form.product_id === p.id }" @click="pickProduct(p)">
                      <span class="pt-pick-nm">{{ p.name }}</span>
                      <span class="pt-pick-meta">{{ convText(p) }}</span>
                    </button>
                    <div v-else class="pt-pick-item dis">
                      <span class="pt-pick-nm">{{ p.name }}</span>
                      <span class="pt-pick-meta">{{ convText(p) }}</span>
                      <span class="pt-pick-warn">缺大单位换算，无法按箱设目标</span>
                      <button class="pt-fix-btn" @click.stop="toggleFix(p)">
                        {{ fixFor === p.id ? '收起' : '补换算' }}
                      </button>
                    </div>
                    <div v-if="!p.can_target && fixFor === p.id" class="pt-fix-box">
                      <div class="pt-fix-hint">
                        照商品包装补一处换算，这个商品就能按箱设目标。填错不会落库 ——
                        系统会先按这组换算试算一遍「1 大单位 = 几个小单位」，算不出或单位名打架就整笔拒收。
                      </div>
                      <div class="pt-fix-row">
                        <span class="pt-fix-eq">1</span>
                        <input v-model.trim="fixForm.large_unit" class="fld pt-fix-u"
                               placeholder="箱" aria-label="大单位名">
                        <span class="pt-fix-eq">=</span>
                        <input v-model.number="fixForm.large_ratio" type="number" min="0" step="1"
                               class="fld pt-fix-n" placeholder="?" aria-label="换算比">
                        <span class="pt-fix-eq">{{ p.unit || '小单位' }}</span>
                        <button class="pt-fix-save" :disabled="fixBusy" @click.stop="submitFix(p)">
                          {{ fixBusy ? '保存中…' : '保存换算' }}
                        </button>
                      </div>
                      <!-- 预填值来自后端（`list_products.suggest_large_ratio`，由 `per_case`
                           唯一实现按规格串算）。前端**不自己解析规格串** —— 那是第二份口径。 -->
                      <div class="pt-fix-src">
                        <span v-if="p.suggest_large_ratio">
                          已按规格「{{ p.spec }}」预填，核对一下包装对不对。
                        </span>
                        <span v-else-if="p.spec">
                          规格「{{ p.spec }}」里认不出每箱数量，请照包装实际含量填。
                        </span>
                        <span v-else>
                          这个商品档案没有「规格」，系统推不出来 —— 请照包装实际含量填。
                        </span>
                      </div>
                      <div v-if="fixMsg" class="pt-fix-msg">{{ fixMsg }}</div>
                    </div>
                  </template>
                  <div v-if="!prods.length" class="pt-quiet pt-pick-empty">没有匹配的在售商品。</div>
                </div>
                <div v-else class="pt-fixed">
                  {{ pickedName }} <span class="pt-quiet">（商品与月份不可改，要改请删了重建）</span>
                </div>
              </div>

              <label class="pt-lb">目标月份</label>
              <div>
                <input v-model="form.period_month" type="month" class="fld pt-fld-m"
                       aria-label="目标月份" :disabled="editing">
              </div>

              <label class="pt-lb">目标量（箱）</label>
              <div class="pt-qty">
                <input v-model.number="form.target_qty" type="number" min="0" step="1"
                       class="fld pt-qty-in" aria-label="目标量">
                <span class="pt-qty-u">{{ pickedUnit || '箱' }}</span>
                <!-- 🔴 v264b：这里**必须**复用 convText(p)，不能自己拼。
                     原实现拼的是「pickedPerCase + 小单位名」，而那个值是
                     large_ratio ÷ medium_ratio = **中单位的数量**，名字却取了**小单位** ⇒
                     真机实测 id=1449 渲染成「1 件 = 8 袋」（8 是包数），而系统真值是
                     「1 件 = 40 袋」/「1 件 = 8 包」。「中单位的数 + 小单位的名」= 两个口径混用。
                     （注释内不写模板花括号，否则符号校验脚本会把它们当模板引用。） -->
                <span v-if="pickedConv" class="pt-quiet">{{ pickedConv }}</span>
              </div>
            </div>

            <!-- 选人双栏：左候选 / 右已选占比 -->
            <div class="pt-2col">
              <div class="pt-col">
                <div class="pt-col-hd">
                  <b>可选员工</b>
                  <input v-model="ekw" class="fld pt-ekw" placeholder="搜索姓名" aria-label="搜索员工">
                </div>
                <div class="pt-col-bd">
                  <button v-for="e in candEmps" :key="e.id" class="pt-emp"
                          :disabled="isPicked(e.id)" @click="addMember(e)">
                    <span>{{ e.name }}</span>
                    <span v-if="e.report_alias" class="pt-alias" title="报单别名：他报的单挂在哪个门店名下">
                      {{ e.report_alias }}
                    </span>
                    <span v-else class="pt-noalias" title="没分别名 ⇒ 逐人实报算不出来">未配别名</span>
                  </button>
                  <div v-if="!candEmps.length" class="pt-quiet pt-col-empty">没有匹配的在职员工。</div>
                </div>
              </div>

              <div class="pt-col">
                <div class="pt-col-hd">
                  <b>分解到人</b>
                  <span class="pt-sigma" :class="sigmaOk ? 'ok' : 'bad'">
                    合计 {{ fmt(sigmaPct) }}%
                    {{ sigmaOk ? '' : (sigmaPct < 100 ? '，还差 ' + fmt(100 - sigmaPct) + '%'
                                                      : '，多了 ' + fmt(sigmaPct - 100) + '%') }}
                  </span>
                  <button class="btn btn-ghost btn-sm pt-split" @click="splitEven">平均分配</button>
                </div>
                <div class="pt-col-bd">
                  <table class="pt-sub pt-sub-in">
                    <thead>
                      <tr><th>承接人</th><th class="num">占比%</th><th class="num">目标(箱)</th><th></th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="m in members" :key="m.employee_id">
                        <td>{{ m.employee_name }}</td>
                        <td class="num">
                          <input v-model.number="m.ratio" type="number" min="0" max="100" step="1"
                                 class="fld pt-ratio" :aria-label="m.employee_name + ' 占比'">
                        </td>
                        <td class="num">{{ fmt(allocBox(m)) }}</td>
                        <td>
                          <button class="btn-icon" title="移除" @click="rmMember(m.employee_id)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </td>
                      </tr>
                      <tr v-if="!members.length">
                        <td colspan="4" class="pt-quiet">从左栏点员工加入。至少要 1 人、占比合计 100%。</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div v-if="saveErr" class="pt-save-err">{{ saveErr }}</div>
          </div>

          <div class="pt-modal-ft">
            <span class="pt-quiet">目标量{{ editing ? '' : '与分解比例' }}保存后立即生效</span>
            <button class="btn btn-ghost btn-sm" @click="closeModal">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="!canSave || saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ 删除确认 ══ -->
    <Teleport to="body">
      <div v-if="delRow" class="pt-mask" @click.self="delRow = null">
        <div class="pt-modal pt-modal-sm">
          <div class="pt-modal-hd"><b>删除这条目标？</b></div>
          <div class="pt-modal-bd">
            <p class="pt-del-q">
              <b>{{ delRow.product_name }}</b> · {{ delRow.period_month }} ·
              目标 {{ fmt(delRow.target_qty) }} 箱
            </p>
            <p class="pt-del-warn">
              会同时删掉 {{ (delRow.allocs || []).length }} 条分解明细（不可恢复）。
              已报的单不受影响。
            </p>
          </div>
          <div class="pt-modal-ft">
            <button class="btn btn-ghost btn-sm" @click="delRow = null">取消</button>
            <button class="btn btn-danger btn-sm" :disabled="saving" @click="doDelete">
              {{ saving ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
// v265：本页已收进「预报订货管理」当第 4 个页签 ⇒ 允许一处**同页互跳**（告警条 →「报单配置」tab）。
// 这是本页唯一的路由耦合，语义是「同页切页签」，不是跨页导航。
import { useRouter } from 'vue-router'
import { productTargetsApi, forecastApi } from '../api/modules.js'
// v277：补换算成功后要给「已写进哪个商品档案」一个明确回执。本页此前只用页内 err 条，
// 但那行是「列表级」的（会被后续 load 覆盖），而这里是一次单点写操作 ⇒ 用全站 toast。
import { toast } from '../store'

/* ══════════════════════════════════════════════════════════════
   商品目标管理（v264）
   🔴 三条纪律（改本页前先读）：
     ① 均单 / 预填 **只由后端算**（/avg-target）。本页不做任何本地换算 ——
        那是第二份口径，迟早与后端漂移（本项目反复付过学费）。
     ② 目标一律按**箱**。无大单位换算的商品后端硬拒 422 ⇒ 前端提前禁选并写明原因，
        不让用户白填一遍再吃一个错。
     ③ 占比合计必须 = 100%，前端**实时提示**、后端**硬校验**（双保险，不只做前端）。
   ══════════════════════════════════════════════════════════════ */

const rows = ref([])
const periods = ref([])
const loading = ref(false)
const err = ref('')
const saving = ref(false)
const openId = ref(0)

const now = new Date()
const month = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const periodId = ref(0)
const avgById = ref({})
/* v264c（R9）：报单「列名 ↔ 报单对象」对账（**只读**）。
   null = 还没查 / 查失败 ⇒ 不渲染告警（一次辅助查询失败不该在页面上吓用户）。 */
const audit = ref(null)
// v265：切到同页的「报单配置」页签。走 router.replace 而**不是** location.hash 拼接 ——
// 与 Forecast.vue 的 setTab 共用同一套 URL 语义（`?tab=config`）；两处各写一份 hash 拼接必然漂移。
const router = useRouter()
function goReportMapping() {
  router.replace({ path: '/forecast', query: { tab: 'config' } }).catch(() => {})
}

/* ---- 展示工具 ---- */
function fmt(v) {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  // 3 位小数与前端 `boxesOf` 同精度（用户自己的报单 Excel 里「件数」就是 3 位）
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

/* 选商品时把「一箱 = 几包 = 几袋」摊开给用户看。
   目标以**箱**为单位，用户脑子里的单位却是包/袋 ⇒ 不摊开他没法判断「150」是多还是少。
   🔴 只用档案字段算，**不猜**：缺换算就明说缺什么，不拿 1 冒充。 */
function convText(p) {
  const lr = Number(p.large_ratio) || 0
  const lu = p.large_unit || '箱'
  const mr = Number(p.medium_ratio) || 0
  const mu = p.medium_unit || ''
  const su = p.unit || '小单位'
  if (!(lr > 0)) return '缺大单位换算'
  const mid = (mu && mr > 0) ? `${fmt(lr / mr)} ${mu} · ` : ''
  return `1 ${lu} = ${mid}${fmt(lr)} ${su}`
}

/* v264c（R9）：汇总表列名没配进「报单配置」时，该列落库 `store_id=0` ⇒
   「逐人实报」只能靠 `store_name` **名字匹配**，报单配置里一改名，历史报单就归不到人
   且**零报错**。把名单摆到页面上，用户才知道该去补哪几条映射。
   ⚠️ 只读、且失败静默（`audit=null` ⇒ 不渲染）—— 它是提示，不是本页主功能。 */
async function loadAudit() {
  try {
    const d = await productTargetsApi.mappingAudit()
    audit.value = (d && d.ok) ? d : null
  } catch (e) {
    audit.value = null
  }
}

/* 告警里那两个计数：拆成 computed 而不是在模板里现算 —— 模板里现算会变成
   「同一份判据在模板里再写一遍」，加个新状态就容易漏改。 */
const _auditCols = () => ((audit.value && audit.value.columns) || [])
const sameNameCnt = computed(() => _auditCols().filter(c => c.status === 'same_name_only').length)
const unknownCnt = computed(() => _auditCols().filter(c => c.status === 'unknown').length)

/* ---- 列表 ---- */
async function load(m) {
  loading.value = true
  err.value = ''
  try {
    const d = await productTargetsApi.list(m || '')
    rows.value = d.items || []
    // 列表接口**只在按月过滤时**才附「已达成」（避免全表扫）⇒ 传空月时这几列会恒 0，
    // 页面上必须说清，否则用户会以为「达成是 0」。
    if (!m) err.value = '提示：不选月份时列表不计算「已达成 / 均单」。请选一个月份。'
    await loadPeriods()
    await loadAvg()
  } catch (e) {
    err.value = e?.message || '加载失败'
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function loadPeriods() {
  if (periods.value.length) return
  try {
    const d = await forecastApi.periods()
    periods.value = d.periods || []
    // 默认选**进行中**的期次；没有则用后端给的展示兜底 `current`
    const prefer = d.open || d.current || null
    if (prefer && !periodId.value) periodId.value = Number(prefer.id) || 0
  } catch (e) {
    periods.value = []
  }
}

async function loadAvg() {
  if (!periodId.value || !rows.value.length) {
    avgById.value = {}
    return
  }
  try {
    const d = await productTargetsApi.avgTarget(periodId.value)
    avgById.value = d.items || {}
  } catch (e) {
    avgById.value = {}
  }
}

function toggle(id) { openId.value = openId.value === id ? 0 : id }

/* ---- 派生展示 ---- */
function gapOf(r) { return Number(r.target_qty || 0) - Number(r.achieved_box || 0) }
function gapClass(r) {
  const g = gapOf(r)
  return g > 0 ? 'pt-gap-pos' : (g < 0 ? 'pt-gap-neg' : '')
}
function avgOf(r) {
  const it = avgById.value[String(r.product_id)]
  if (!it) return null
  if (it.avg_box == null) return null
  return it
}
function avgWhy(r) {
  const it = avgById.value[String(r.product_id)]
  if (!periodId.value) return '未选择期次（均单要挂在期次上算）'
  if (!it) return '该商品不在本期期次清单里'
  const f = it.flags || {}
  if (f.no_convert) return '该商品缺单位换算，无法折算均单'
  if (f.no_target) return '本月还没有目标'
  if (f.no_rule) return '该品牌没有到货规则（配置面板里没设），算不出剩余期次'
  if (f.no_dates) return '该品牌按本规则在本月没有到货日'
  if (f.done) return '已达成本月目标'
  return '—'
}
function repText(r) {
  const it = avgById.value[String(r.product_id)]
  if (!it) return '—'
  return fmt(it.reported_box)
}
function remText(r) {
  const it = avgById.value[String(r.product_id)]
  if (!it || it.remaining_periods == null) return '—'
  return fmt(it.remaining_periods) + ' / ' + fmt(it.total_periods)
}

/* ══════════════ 弹窗 ══════════════ */
const modal = ref(false)
const editing = ref(null)          // null = 新建；否则是被编辑的目标行
const prods = ref([])
const emps = ref([])
const pkw = ref('')
const ekw = ref('')
const saveErr = ref('')
const form = reactive({ product_id: 0, period_month: '', target_qty: null })
const members = ref([])

const picked = computed(() => prods.value.find(p => p.id === form.product_id) || editing.value || null)
const pickedName = computed(() => picked.value?.name || picked.value?.product_name || '—')
const pickedUnit = computed(() => picked.value?.large_unit || picked.value?.target_unit || '箱')
/* 目标量输入框旁那行换算提示。
   🔴 v264b：**必须**复用 `convText(p)` —— 唯一实现。此前这里自己拼了一份
   （`large_ratio ÷ medium_ratio` + 小单位名），两处口径必然漂移，真机实测已经漂了。
   没有大单位换算（或编辑态拿不到档案字段）时返回 '' ⇒ 提示整行不渲染，不拿猜测的数字冒充。 */
const pickedConv = computed(() => {
  const p = picked.value
  if (!p || !(Number(p.large_ratio) > 0)) return ''
  return '（' + convText(p) + '）'
})

const candEmps = computed(() => {
  const kw = ekw.value.trim()
  const pickedIds = new Set(members.value.map(m => m.employee_id))
  return emps.value.filter(e => {
    if (pickedIds.has(e.id)) return false
    if (!kw) return true
    return String(e.name || '').includes(kw)
  })
})
const sigmaPct = computed(() =>
  Math.round(members.value.reduce((s, m) => s + (Number(m.ratio) || 0), 0) * 100) / 100)
const sigmaOk = computed(() => Math.abs(sigmaPct.value - 100) <= 0.01)
const canSave = computed(() => {
  if (!editing.value) {
    if (!form.product_id || !form.period_month) return false
    if (!(Number(form.target_qty) > 0)) return false
  } else if (!(Number(form.target_qty) > 0)) return false
  return sigmaOk.value && members.value.length > 0
})

function allocBox(m) {
  return Math.round((Number(form.target_qty) || 0) * (Number(m.ratio) || 0)) / 100
}

async function openNew() {
  editing.value = null
  saveErr.value = ''
  form.product_id = 0
  form.period_month = month.value
  form.target_qty = null
  members.value = []
  pkw.value = ''
  ekw.value = ''
  modal.value = true
  if (!prods.value.length) await searchProducts()
  if (!emps.value.length) await loadEmps()
}

function openEdit(r) {
  editing.value = r
  saveErr.value = ''
  form.product_id = r.product_id
  form.period_month = r.period_month
  form.target_qty = Number(r.target_qty) || null
  members.value = (r.allocs || []).map(a => ({
    employee_id: a.employee_id, employee_name: a.employee_name, ratio: a.ratio,
  }))
  ekw.value = ''
  modal.value = true
  if (!emps.value.length) loadEmps()
}

function closeModal() { modal.value = false; editing.value = null }

async function searchProducts() {
  try {
    const d = await productTargetsApi.products(pkw.value.trim(), 50)
    prods.value = d.items || []
  } catch (e) {
    prods.value = []
  }
}
async function loadEmps() {
  try {
    const d = await productTargetsApi.employees()
    emps.value = d.items || []
  } catch (e) {
    emps.value = []
  }
}

function pickProduct(p) {
  if (!p.can_target) return
  form.product_id = p.id
  if (!form.product_id) return
  // 单位随商品带回（目标单位 = 商品大单位）
  form.target_unit = p.large_unit || ''
}

/* ══ v277（S3）：缺换算商品「就地补换算」 ═══════════════════════════════════════
   为什么在这页做：`can_target=False` 的商品在选品列表里**看得见、选不了**；用户得离开目标页
   → 去商品档案页 → 翻到那一行 → 再改。而那条路此前还是坏的（`large_ratio` 不在
   `product_update` 白名单里，填了静默不写、也不报错，v277 一并修掉）。
   这里把「看得见的目标」和「改档案的能力」放进同一个弹窗，形成闭环。

   🔴 两条纪律：
     ① 预填值**只取后端建议**（`list_products.suggest_large_ratio`，由 `per_case` 唯一实现
        按规格串算）。前端**不自己解析规格串** —— 那会成为第二份口径，本页第 ① 条纪律。
     ② 三道校验（当前必须真缺 / 补完必须真能折箱且能摊出各级单位 / 大单位名不得撞名）
        全在后端。前端只做**可读性**前置（空值、非正数），不复制那三条业务判据。 */
const fixFor = ref(0)
const fixBusy = ref(false)
const fixMsg = ref('')
const fixForm = reactive({ large_unit: '', large_ratio: null })

function toggleFix(p) {
  if (fixFor.value === p.id) { fixFor.value = 0; fixMsg.value = ''; return }
  fixFor.value = p.id
  fixMsg.value = ''
  fixForm.large_unit = p.suggest_large_unit || '箱'
  fixForm.large_ratio = p.suggest_large_ratio || null
}

async function submitFix(p) {
  const lu = (fixForm.large_unit || '').trim()
  const lr = Number(fixForm.large_ratio)
  const su = p.unit || '小单位'
  if (!lu) { fixMsg.value = '请填大单位名（一般就是「箱」）。'; return }
  if (!(lr > 0)) { fixMsg.value = `请填「1 个${lu} = 几个${su}」，必须大于 0。`; return }
  fixBusy.value = true
  fixMsg.value = ''
  try {
    const d = await productTargetsApi.fixConversion(p.id, lu, lr)
    // 把「1 箱 = N 包 = M 袋」原样回给用户看 —— 这是他自己填的那个数的推论。
    // 不看一眼就去建目标，填错了要等到报单算箱数时才发现（那时已经算完好几张单）。
    const per = (d && d.per_unit) || {}
    const flat = Object.keys(per).map(k => `${fmt(per[k])} ${k}`).join(' · ')
    toast(`已补换算：1 ${lu} = ${fmt(lr)} ${su}` + (flat ? `（${flat}）` : '') +
          '。该商品现在可以设目标了。', 'ok')
    fixFor.value = 0
    // 重取列表：那一行 `can_target` 从 false 变 true，整行不再是灰的、可照常选中。
    // 不做「本地改一下 prods 里那一条」—— 那等于前端自己维护一份换算结论。
    await searchProducts()
  } catch (e) {
    // 后端的 400 带中文原因（三道校验各一条），原样展示；不要吞成「保存失败」。
    fixMsg.value = e?.message || '保存失败'
  } finally {
    fixBusy.value = false
  }
}

function isPicked(id) { return members.value.some(m => m.employee_id === id) }
function addMember(e) {
  if (isPicked(e.id)) return
  members.value.push({ employee_id: e.id, employee_name: e.name, ratio: 0 })
  // 首次加入时自动平均，省掉「加一个人再手填占比」这一步
  if (members.value.length === 1) members.value[0].ratio = 100
}
function rmMember(id) {
  members.value = members.value.filter(m => m.employee_id !== id)
}
function splitEven() {
  const n = members.value.length
  if (!n) return
  // 与后端 `suggest_ratios` 同规则：前 n-1 人取两位小数，最后一人兜差额 ⇒ Σ 恒 = 100
  const base = Math.floor((100 / n) * 100) / 100
  let acc = 0
  members.value.forEach((m, i) => {
    if (i === n - 1) {
      m.ratio = Math.round((100 - acc) * 100) / 100
    } else {
      m.ratio = base
      acc = Math.round((acc + base) * 100) / 100
    }
  })
}

async function save() {
  saving.value = true
  saveErr.value = ''
  try {
    const allocs = members.value.map(m => ({
      employee_id: m.employee_id,
      employee_name: m.employee_name,
      ratio: Number(m.ratio) || 0,
    }))
    if (editing.value) {
      await productTargetsApi.update(editing.value.id, {
        target_qty: Number(form.target_qty) || 0, allocs,
      })
    } else {
      await productTargetsApi.create({
        period_month: form.period_month,
        product_id: form.product_id,
        target_qty: Number(form.target_qty) || 0,
        target_unit: pickedUnit.value,
        allocs,
      })
    }
    const keepMonth = editing.value ? editing.value.period_month : form.period_month
    closeModal()
    if (keepMonth && keepMonth !== month.value) month.value = keepMonth
    await load(month.value)
  } catch (e) {
    saveErr.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

/* ---- 删除 ---- */
const delRow = ref(null)
function askDelete(r) { delRow.value = r }
async function doDelete() {
  if (!delRow.value) return
  saving.value = true
  try {
    await productTargetsApi.remove(delRow.value.id)
    delRow.value = null
    await load(month.value)
  } catch (e) {
    err.value = e?.message || '删除失败'
    delRow.value = null
  } finally {
    saving.value = false
  }
}

onMounted(() => { load(month.value); loadAudit() })
</script>

<style scoped>
/* ── 口径说明条 ── */
.pt-caliber{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;padding:9px 12px;
  border-radius:var(--radius-sm);background:var(--p-bg);color:var(--t2);font-size:12.5px;line-height:1.7}
.pt-caliber b{color:var(--t1)}

/* ── v264c（R9）：报单配置对账告警。复用站内语义色 `--warn-amber*`
      （成例：`ConnectCenter.vue::.cc-pair-lock`），不新造视觉语言。 ── */
.pt-audit{margin:0 0 12px;padding:10px 14px;border-radius:var(--radius-sm);
  background:var(--warn-amber-bg);color:var(--warn-amber);font-size:12.5px;line-height:1.7}
.pt-audit b{color:var(--t1)}
/* v265：告警条里的「去报单配置修」按钮 —— 继承告警条的琥珀色，不新造一套按钮视觉。
   用 filter 而不是 rgba 覆写背景：本页要同时适配明/暗主题，写死 rgba 会在暗色下变脏。 */
.pt-audit-btn{margin-left:8px;padding:2px 10px;border:1px solid currentColor;border-radius:var(--radius-sm);
  background:transparent;color:inherit;font-size:12.5px;line-height:1.6;cursor:pointer;font-family:inherit}
.pt-audit-btn:hover{filter:brightness(.95)}
.pt-audit-b{margin-top:3px}
.pt-audit-go{opacity:.9}

/* ── 工具栏 ── */
.pt-tbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.pt-tbar-t{font-size:13px;color:var(--t2)}
.pt-fld-m{width:150px}
.pt-fld-p{width:210px}
.pt-sp{flex:1 1 auto}

/* ── 列表 ── */
.pt-card{padding:0;overflow:hidden}
.pt-wrap{overflow-x:auto}
.pt-tbl{width:100%;border-collapse:collapse;font-size:13px}
.pt-tbl th{position:sticky;top:0;z-index:2;background:var(--bg3);color:var(--t2);font-weight:500;
  text-align:left;padding:9px 10px;white-space:nowrap;border-bottom:1px solid var(--bd)}
.pt-tbl td{padding:9px 10px;border-bottom:1px solid var(--bd);vertical-align:middle}
.pt-tbl tr.pt-row-open td{background:var(--bg2)}
.pt-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
.pt-th-prod{min-width:260px}
.pt-th-op{width:88px;text-align:right}
.pt-op{text-align:right;white-space:nowrap}
.pt-prod{display:flex;align-items:flex-start;gap:6px}
.pt-exp{border:none;background:none;padding:2px;cursor:pointer;color:var(--t2);line-height:0;
  border-radius:4px;flex:0 0 auto}
.pt-exp svg{transition:transform .15s}
.pt-exp:hover{background:var(--bg4);color:var(--t1)}
.pt-prod-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.pt-spec{font-size:11.5px;color:var(--t2)}
.pt-brand{color:var(--t2);white-space:nowrap}
.pt-quiet{color:var(--t2)}
.pt-gap-pos{color:var(--ok-green)}
.pt-gap-neg{color:var(--danger-txt);font-weight:600}

/* ── 分解明细 ── */
.pt-detail-row td{background:var(--bg2);padding:0}
.pt-detail{padding:12px 14px}
.pt-detail-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;font-size:13px}
.pt-sub{width:100%;max-width:520px;border-collapse:collapse;font-size:12.5px}
.pt-sub th{background:transparent;border-bottom:1px solid var(--bd);color:var(--t2);padding:5px 8px;
  font-weight:500;text-align:left;position:static}
.pt-sub td{padding:5px 8px;border-bottom:1px solid var(--bd)}
.pt-sub .num{text-align:right}
.pt-note{margin-top:10px;font-size:12px;color:var(--t2);line-height:1.6}

/* ── 空/错误态 ── */
.pt-err{color:var(--warn-amber)}

/* ── 弹窗 ── */
.pt-mask{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.35);display:flex;
  align-items:center;justify-content:center;padding:20px}
.pt-modal{width:min(960px,100%);max-height:92vh;display:flex;flex-direction:column;
  background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius);box-shadow:var(--shadow)}
.pt-modal-sm{width:min(460px,100%)}
.pt-modal-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:12px 14px;border-bottom:1px solid var(--bd);font-size:14px}
.pt-modal-bd{padding:14px;overflow:auto}
.pt-modal-ft{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid var(--bd)}
.pt-modal-ft .pt-quiet{flex:1 1 auto;font-size:12px}

.pt-form{display:grid;grid-template-columns:96px 1fr;gap:10px 12px;align-items:start;margin-bottom:16px}
.pt-lb{font-size:13px;color:var(--t2);padding-top:9px}
.pt-pick{display:flex;flex-direction:column;gap:8px}
.pt-pick-in{width:100%}
.pt-pick-list{max-height:150px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-sm)}
.pt-pick-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:none;
  background:none;cursor:pointer;text-align:left;font-size:13px;color:var(--t1);
  border-bottom:1px solid var(--bd)}
.pt-pick-item:last-child{border-bottom:none}
.pt-pick-item:hover:not(.dis){background:var(--bg2)}
.pt-pick-item.on{background:var(--p-bg);font-weight:600}
/* v277：整行不再一起降透明度 —— `dis` 行里现在有「补换算」按钮，
   行级 opacity 会把按钮一起压暗（还能点，但看起来像禁用 = 用户不会去点）。
   改为只压暗三个文字 span，按钮保持全亮。 */
.pt-pick-item.dis{cursor:not-allowed}
.pt-pick-item.dis .pt-pick-nm,
.pt-pick-item.dis .pt-pick-meta,
.pt-pick-item.dis .pt-pick-warn{opacity:.62}
.pt-pick-nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-pick-meta{color:var(--t2);font-size:11.5px;white-space:nowrap}
.pt-pick-warn{color:var(--warn-amber);font-size:11.5px;white-space:nowrap}
/* ── v277（S3）就地补换算 ── */
.pt-fix-btn{flex:0 0 auto;height:24px;padding:0 9px;border:1px solid var(--warn-amber);
  background:var(--warn-amber-bg);color:var(--warn-amber);border-radius:var(--radius-sm);
  font-size:11.5px;cursor:pointer;white-space:nowrap}
.pt-fix-btn:hover{filter:brightness(.97)}
/* 展开区独立成条（`.pt-pick-item` 是 flex 横排，塞不下这个表单） */
.pt-fix-box{padding:9px 12px 11px;background:var(--bg3);border-bottom:1px solid var(--bd)}
.pt-fix-hint{font-size:11.5px;color:var(--t2);line-height:1.55;margin-bottom:8px}
.pt-fix-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.pt-fix-eq{font-size:13px;color:var(--t2);white-space:nowrap}
.pt-fix-u{width:62px;text-align:center}
.pt-fix-n{width:80px;text-align:center}
.pt-fix-save{height:28px;padding:0 12px;border:none;border-radius:var(--radius-sm);
  background:var(--p-dark);color:#fff;font-size:12.5px;cursor:pointer;white-space:nowrap}
.pt-fix-save:hover:not(:disabled){background:var(--p-deep)}
.pt-fix-save:disabled{opacity:.45;cursor:not-allowed}
.pt-fix-src{margin-top:7px;font-size:11.5px;color:var(--t2);line-height:1.5}
.pt-fix-msg{margin-top:6px;font-size:12px;color:var(--danger-txt)}
.pt-pick-empty{padding:10px}
.pt-fixed{padding:8px 10px;background:var(--bg3);border-radius:var(--radius-sm);font-size:13px}
.pt-qty{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pt-qty-in{width:130px}
.pt-qty-u{font-size:13px;color:var(--t2)}

/* ── 选人双栏 ── */
.pt-2col{display:grid;grid-template-columns:1fr 1.25fr;gap:12px}
.pt-col{border:1px solid var(--bd);border-radius:var(--radius-sm);display:flex;flex-direction:column;
  min-height:236px;max-height:320px;overflow:hidden}
.pt-col-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);
  border-bottom:1px solid var(--bd);font-size:13px;flex-wrap:wrap}
.pt-ekw{margin-left:auto;width:110px;height:28px}
.pt-col-bd{overflow:auto;flex:1 1 auto;padding:6px}
.pt-col-empty{padding:10px;font-size:12.5px}
.pt-emp{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:none;background:none;
  cursor:pointer;text-align:left;font-size:13px;color:var(--t1);border-radius:var(--radius-sm)}
.pt-emp:hover:not(:disabled){background:var(--bg2)}
.pt-emp:disabled{opacity:.4;cursor:default}
.pt-alias{font-size:11.5px;color:var(--t2)}
.pt-noalias{font-size:11.5px;color:var(--warn-amber)}
.pt-sigma{font-size:12.5px;font-weight:600}
.pt-sigma.ok{color:var(--ok-green)}
.pt-sigma.bad{color:var(--danger-txt)}
.pt-split{margin-left:auto;height:28px}
.pt-sub-in{max-width:none}
.pt-sub-in th{position:static}
.pt-ratio{width:74px;height:28px;text-align:right}
.pt-save-err{margin-top:12px;padding:9px 11px;border-radius:var(--radius-sm);
  background:var(--danger-bg);color:var(--danger-txt);font-size:12.5px;line-height:1.6}

/* ── 删除确认 ── */
.pt-del-q{font-size:13px;line-height:1.7;margin:0 0 8px}
.pt-del-warn{font-size:12.5px;color:var(--warn-amber);line-height:1.7;margin:0}
.btn-danger{background:var(--danger-txt);color:#fff}

/* ── 窄屏：双栏改单栏 ── */
@media (max-width:760px){
  .pt-2col{grid-template-columns:1fr}
  .pt-form{grid-template-columns:1fr}
  .pt-lb{padding-top:0}
}
</style>
