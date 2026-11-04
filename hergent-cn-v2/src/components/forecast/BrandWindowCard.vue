<template>
  <!-- v765（2026-11-04）：品牌报单日 —— 总开关 + 「配完会怎样」预览。
       用户需求原话：「某期次不属于某品牌的报单日时，该品牌商品可选择隐藏或展示但禁止提交…
       并在填报页顶部横幅汇总展示本期可报单品牌提醒。」判定与文案都在后端，
       这块界面只做三件事：开关、把后端算出来的矩阵摆出来、**把配错的地方标红**。

       🔴 为什么必须单独有一块「预览」而不是只在弹窗里加个说明：
          `order_weekdays` 是**品牌级**配置，而它生效与否取决于「期次骨架落在哪些星期」。
          两者都在别处配，配完没有任何一处界面能回答"这样配到底会不会生效"。
          生产真实坏数据（`蒙牛酸奶` 归一后匹配 0 个商品）就是这种"配了等于没配"。 -->
  <ConfigCard v-model="open" title="品牌报单日" subtitle="某品牌不在报单日的期次：商品照显示、不能填数">
    <template #chip>
      <span class="bw-chip" :class="p.enabled ? 'on' : 'off'">{{ p.enabled ? '已启用' : '未启用' }}</span>
    </template>
    <template #summary>
      <span v-if="p.enabled && ruleCount" class="bw-meta">{{ ruleCount }} 个品牌配了报单日</span>
      <span v-else-if="p.enabled" class="bw-meta">还没有品牌配报单日</span>
    </template>

    <p class="bw-tip">
      报单日按<b>品牌</b>配（在「返利目标 → 品牌」里的<b>报单星期</b>）。这里控制的是
      <b>要不要按它拦填报</b>：启用后，不在当日报单日的品牌，小程序里商品仍显示、但数量填不进去，
      并提示「该商品可报单时间为每周X、Y，本期不可提报」。关掉则一切照旧，谁都能填。
    </p>

    <div class="bw-swrow">
      <div class="bw-swtxt">
        <b>按品牌报单日拦截填报</b>
        <span class="bw-sub">关掉后本功能完全不生效（等于回到上线前的行为），已配的星期不会被删除</span>
      </div>
      <button type="button" :class="['bw-btn', p.enabled ? 'bw-btn-on' : '']"
              :disabled="saving" @click="toggle">
        {{ p.enabled ? '关闭拦截' : '启用拦截' }}
      </button>
    </div>

    <div v-if="loading" class="bw-empty">读取配置中…</div>
    <div v-else-if="loadErr" class="bw-empty bw-err">{{ loadErr }} · <a @click="load">重试</a></div>

    <!-- 一条规则都没配：给出**可行动**的去处，而不是一句"暂无数据"。
         v765e：原来这里是一句四层路径的文字（「返利目标 → 品牌 → 新建/编辑 → 报单模式选…」），
         路径本身没错，但它要求用户记住四步、还得认出是「品牌」维度不是「单品」——
         所以现在主位放一个**能点的按钮**，路径压成一行小字作兜底（给想照着走的人看）。 -->
    <div v-else-if="!ruleCount" class="bw-empty">
      <div class="bw-empty-t">还没有任何品牌配置「报单星期」，所以下面这张表是空的。</div>
      <a v-if="canEditRebate" class="bw-go bw-go-lg" @click="goNewBrand">＋ 去配第一条</a>
      <div class="bw-empty-s">
        <template v-if="canEditRebate">
          也可以自己走：返利目标 → 规则 → 新建，维度选 <b>品牌</b> → 报单模式选「按固定星期」→ 勾报单星期。
        </template>
        <template v-else>需要「返利目标」权限的同事来配。</template>
      </div>
    </div>

    <template v-else>
      <!-- 规则表：品牌 / 可报星期 / 匹配商品数 / 最近命中 / 诊断 / 改入口
           🔴 最后一列表头留空（不是"操作"）—— 这一列每行都是同一句「改报单日 ›」，
              写个表头反而多一个词要读。 -->
      <table class="bw-table">
        <thead>
          <tr><th>品牌</th><th>可报星期</th><th class="bw-num">匹配商品</th><th class="bw-num">最近命中</th><th>诊断</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.brand">
            <td class="bw-brand">{{ r.brand }}</td>
            <td>{{ r.weekdays_cn || '—' }}</td>
            <td class="bw-num" :class="r.products ? '' : 'bw-bad'">{{ r.products }}</td>
            <td class="bw-num" :class="hitOk(r) ? '' : 'bw-bad'">{{ hitCount(r.brand) }} 期</td>
            <td>
              <span v-if="!r.products" class="bw-warn">⚠ 匹配 0 个商品：品牌名与商品档案对不上，这条规则不会生效</span>
              <span v-else-if="!hitOk(r)" class="bw-warn">⚠ 最近 {{ periods.length }} 期一期都命不中：业务员会以为长期无需报单</span>
              <span v-else class="bw-ok">正常</span>
            </td>
            <!-- v765e：直达那一条规则。**按 `rule_id` 定位、不按品牌名反查**（原因见 script 里 goRule）。 -->
            <td class="bw-op">
              <a v-if="canEditRebate" class="bw-go" @click="goRule(r)">改报单日 ›</a>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 矩阵：「配完会怎样」的唯一直观答案。✓ = 该期可报（能填报），— = 不可报（禁填） -->
      <div class="bw-mx-h">最近 {{ periods.length }} 期预览 <span class="bw-sub">✓ 可报填数 · — 不可报（品牌该期截止日不在它的报单星期）</span></div>
      <div class="bw-mx">
        <table class="bw-table">
          <thead>
            <tr>
              <th>期次</th>
              <th v-for="r in rules" :key="r.brand">{{ r.brand }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in periods" :key="row.period_id">
              <td class="bw-pi">
                <span class="bw-pid">#{{ row.period_id }}</span>
                <span class="bw-pd">{{ row.order_end || '—' }}</span>
                <span class="bw-pw">{{ row.weekday_cn }}</span>
              </td>
              <td v-for="(b, i) in row.brands" :key="i" class="bw-cell"
                  :class="b.orderable ? 'bw-yes' : 'bw-no'">{{ b.orderable ? '✓' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!p.enabled" class="bw-warnline">
        拦截<b>当前没有开启</b>：上面这张表只是「开启后会怎样」的预览，
        现在<b>谁都能照常填报</b>；点上方「启用拦截」才会真的开始拦。
      </p>
    </template>
  </ConfigCard>
</template>

<script setup>
/* v765 · 品牌报单日配置卡
   🔴 这块界面**不做任何星期运算**：矩阵、命中数、诊断全部来自
      `GET /api/forecast/brand-window/preview`。前端再算一遍 = 第二份实现
      （2 天/期 与 7 天/周 互质，配 2 个星期 = 约 2/7 的期次，凭直觉一定算错）。
   🔴 开关只认**布尔**：后端对 `{"enabled":"false"}` 返回 400（字符串经 bool() 会变真），
      所以这里必须发真布尔，不能发字符串。 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api/client'
import { toast } from '../../store'
/* v765e：卡片里的入口必须与侧栏**同一个权限判据** —— 否则会出现"能点、点了被踢回工作台"
   （`/rebate` 有 module 门槛，能进「预报订单管理」的人不一定能进「返利目标」）。 */
import { canSee } from '../../constants/pages'
import ConfigCard from './ConfigCard.vue'

const router = useRouter()
const canEditRebate = computed(() => canSee('/rebate'))

const open = ref(true)
const loading = ref(false)
const saving = ref(false)
const loadErr = ref('')
const p = reactive({ enabled: false, periods: [], rules: [], hit_count: {}, never_brands: [] })

const rules = computed(() => p.rules || [])
const periods = computed(() => p.periods || [])
const ruleCount = computed(() => rules.value.length)
const hitCount = (b) => Number((p.hit_count || {})[b] || 0)
/* 「命中 0 期」的判据：规则存在、窗口里有期次、且一次都没命中 —— 与后端 `never_brands` 同步，
   但**不信任那个数组本身**（它可能因为窗口为空而全空，那时说"永久报不了"是假警报）。 */
const hitOk = (r) => !periods.value.length || hitCount(r.brand) > 0

/* ---- 就地入口（v765e）----
   背景：这张卡片原来只有一句指路文字「去 返利目标 → 品牌 → 新建/编辑 → 报单模式选按固定星期
   → 勾报单星期」。四个层级全靠记、还得认出是「品牌」维度不是「单品」、跳过去还要在 18 条规则里
   认出改哪一条。所以补两个入口：一条规则→改这一条，空态→去配第一条。

   🔴 星期的**编辑**只在返利弹窗一处（`TargetFormModal` → `ArrivalRhythmBlock`）。
      卡片里只放"跳过去"的链接，**不做第二个星期选择器** —— 两份实现必然分叉，
      而分叉时两边都不报错（v765 定过的纪律，这次不改）。
   🔴 目标 URL 必须带 `tab=rules`：只带 `edit_rule` 会落在「返利看板」子页，
      弹窗虽然会开，但背后是另一张表，关掉弹窗后人会懵"我刚才改的是哪张表里的"。
   🔴 `rule_id` 由后端给。**不要**拿 `r.brand` 去 `rules.find(x => x.scope_key === 品牌名)` 反查：
      规则里的 `scope_key` 与归一后的品牌名不是一回事（`蒙牛低温/鲜奶` vs `蒙牛低温`），
      反查等于在前端再实现一遍归一化。 */
function goRule(r) {
  const id = Number((r && r.rule_id) || 0)
  if (!id) {
    toast('这条规则缺少 ID，请在「返利目标 → 规则」里手动打开', 'error')
    return
  }
  if (!canEditRebate.value) {
    toast('你没有「返利目标」的权限，改不了报单日', 'warn')
    return
  }
  router.push({ path: '/rebate', query: { tab: 'rules', edit_rule: String(id) } }).catch(() => {})
}

function goNewBrand() {
  if (!canEditRebate.value) {
    toast('你没有「返利目标」的权限，配不了报单日', 'warn')
    return
  }
  router.push({ path: '/rebate', query: { tab: 'rules', new: 'brand' } }).catch(() => {})
}

async function load() {
  loading.value = true
  loadErr.value = ''
  try {
    const d = await api('/api/forecast/brand-window/preview?limit=8')
    p.enabled = !!d.enabled
    p.periods = d.periods || []
    p.rules = d.rules || []
    p.hit_count = d.hit_count || {}
    p.never_brands = d.never_brands || []
  } catch (e) {
    loadErr.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}

async function toggle() {
  if (saving.value) return
  saving.value = true
  const next = !p.enabled
  try {
    /* 🔴 2026-11-04 修正：`api()` 第二个参数是 **options 对象**，不是 method。
       原先写成 `api(url, 'PUT', {enabled})` ⇒ method 回退成 GET、body 整个被丢弃 ⇒
       拿到的是「当前仍为关」的旧值，界面却弹了绿底「已启用…」（假成功）。
       这种错签名编译不报错、请求也不报错，**只有比对回读值才能发现**，
       所以下面必须校验 `r.enabled === next`，不符即当失败报出来。 */
    const r = await api('/api/forecast/brand-window', { method: 'PUT', body: { enabled: next } })
    if (!!r.enabled !== next) {
      throw new Error(next ? '启用没生效：后端仍返回未启用，请刷新后重试'
                           : '关闭没生效：后端仍返回已启用，请刷新后重试')
    }
    p.enabled = !!r.enabled
    toast(next ? '已启用：不在报单日的品牌将无法填报' : '已关闭：所有品牌都按原样可填', 'ok')
    await load()
  } catch (e) {
    toast(e.message || '保存失败', 'error')
    // 失败也要回读真实状态：否则界面停在一个「看起来成功」的假象里
    await load().catch(() => {})
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.bw-chip{font-size:var(--fs-sm);padding:1px var(--sp-2);border-radius:var(--radius-pill);border:1px solid transparent}
.bw-chip.on{background:var(--p-tint,var(--bg2));color:var(--p-ink);border-color:var(--p-border,var(--bd1))}
.bw-chip.off{background:var(--bg2);color:var(--t3);border-color:var(--bd1)}
.bw-meta{font-size:var(--fs-sm);color:var(--t3);margin-left:var(--sp-h6)}
.bw-tip{font-size:var(--fs-sm);color:var(--t2);line-height:var(--lh-normal);margin:0 0 var(--sp-2)}
.bw-tip b{color:var(--t1)}
.bw-swrow{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);
  padding:var(--sp-2) var(--sp-3);background:var(--bg2);border-radius:var(--radius-sm);margin-bottom:var(--sp-2)}
.bw-swtxt{min-width:0}
.bw-swtxt b{font-size:var(--fs-base);color:var(--t1)}
.bw-sub{display:block;font-size:var(--fs-sm);color:var(--t3);line-height:var(--lh-normal);margin-top:var(--sp-h2)}
.bw-btn{padding:var(--sp-h6) var(--sp-4);border:1px solid var(--bd2);background:var(--bg1);color:var(--t1);
  border-radius:var(--radius-sm);cursor:pointer;font-size:var(--fs-sm);white-space:nowrap}
.bw-btn-on{background:var(--p-solid);border-color:var(--p);color:#fff}
.bw-btn:disabled{opacity:.5;cursor:default}
.bw-empty{padding:var(--sp-3);font-size:var(--fs-sm);color:var(--t3);line-height:var(--lh-normal)}
.bw-err{color:var(--danger)}
.bw-table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.bw-table th{text-align:left;font-weight:500;color:var(--t3);padding:var(--sp-h6) var(--sp-2);border-bottom:1px solid var(--bd1);white-space:nowrap}
.bw-table td{padding:var(--sp-h6) var(--sp-2);border-bottom:1px solid var(--bd1);color:var(--t1);vertical-align:top}
.bw-num{text-align:right;font-variant-numeric:tabular-nums}
.bw-brand{font-weight:500}
.bw-bad{color:var(--danger);font-weight:600}
.bw-warn{color:var(--danger)}
.bw-ok{color:var(--t3)}
/* v765e：就地入口。行内链接用品牌色 + 下划线（只在 hover），空态按钮描边不填充 ——
   这一块已经有「启用拦截」一个实心按钮，再来一个实心会抢主按钮的权。
   🔴 不用 `pointer-events:none` 做禁用：无权限时**整条链接不渲染**（模板里的 v-if），
      灰着点不动等于"点了没反应"，那是 v761 记过的坑。 */
.bw-op{text-align:right;white-space:nowrap}
.bw-go{color:var(--p-ink);cursor:pointer;white-space:nowrap}
.bw-go:hover{text-decoration:underline}
.bw-go-lg{display:inline-block;margin:var(--sp-2) 0;padding:var(--sp-h6) var(--sp-3);
  border:1px solid var(--p);border-radius:var(--radius-sm);background:var(--bg1);
  font-size:var(--fs-base);font-weight:500}
.bw-go-lg:hover{text-decoration:none;background:var(--p-tint,var(--bg2))}
.bw-empty-t{color:var(--t2)}
.bw-empty-s{color:var(--t3);margin-top:var(--sp-h2)}
.bw-mx-h{margin:var(--sp-3) 0 var(--sp-h6);font-size:var(--fs-base);font-weight:600;color:var(--t1)}
.bw-mx{overflow-x:auto}
.bw-cell{text-align:center;font-variant-numeric:tabular-nums}
.bw-yes{color:var(--p-ink);font-weight:600}
.bw-no{color:var(--t3)}
.bw-pi{white-space:nowrap}
.bw-pid{color:var(--t3);margin-right:var(--sp-h6)}
.bw-pd{font-variant-numeric:tabular-nums}
.bw-pw{color:var(--t3);margin-left:var(--sp-h6)}
.bw-warnline{margin-top:var(--sp-2);font-size:var(--fs-sm);color:var(--danger);line-height:var(--lh-normal)}
</style>
