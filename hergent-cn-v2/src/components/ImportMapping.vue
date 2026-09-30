<template>
  <div class="im">
    <div class="im-bar">
      <span class="im-st">
        共 {{ rows.length }} 列 · 导入 <b>{{ mappedCount }}</b> 列 · 不导入 <b :class="{ off: skippedCount }">{{ skippedCount }}</b> 列
      </span>
      <span class="im-acts">
        <!-- v303：「跳过已存在的记录」= 后端 `mode=incremental`。
             为什么长在这里而不是页面上：它和上面那张映射表回答的是同一件事 ——
             「这份文件会怎么进系统」。放在映射确认这一步，用户改完映射顺手就能决定；
             放到页面上就会和「选文件」挤在一行，变成先选文件、隔着一步才想起该不该去重。
             标签用业务话（"已存在的记录"）而不是"增量导入"——这个词老板不认识。 -->
        <label v-if="showIncremental" class="im-inc" :title="'打开后，系统里已有的记录不会重复导入'">
          <input type="checkbox" :checked="incremental"
                 @change="$emit('update:incremental', $event.target.checked)" />
          跳过已存在的记录
        </label>
        <button v-if="changed" class="im-reset" @click="resetToSuggested">还原系统识别</button>
      </span>
    </div>

    <div v-if="skippedCount" class="im-note">
      标「不导入」的列不会写进系统。若其中有你需要的列，在右边把它改成对应字段即可。
    </div>

    <!-- v346：**危险列**提示条。刻意放在最上面（颜色也最重）——
         这类列的共同点是「界面原本显示一切正常」，用户根本不会主动往下看。
         风险等级高于「有列不导入」：不导入只是少数据，映射错了是**错数据**。 -->
    <div v-if="riskyRows.length" class="im-risk">
      <div class="im-risk-h">
        <Icon name="alert" :size="14" />
        有 <b>{{ riskyRows.length }}</b> 列识别不确定，导入前请看一眼
      </div>
      <ul class="im-risk-l">
        <li v-for="r in riskyRows" :key="r.index">
          <b>「{{ r.header }}」</b>{{ riskTail(r) }}
        </li>
      </ul>
    </div>

    <!-- v303：映射记忆提示。只在**真命中**时出现（后端算不出命中就不回这个字段）——
         空壳提示（"已记住你的映射"但没记住）比不提示更糟：用户下次会发现并没有记住。 -->
    <div v-if="memory && memory.applied" class="im-mem">
      已按你上次的映射预填 <b>{{ memory.applied }}</b> 列
      <span class="im-mem-t">（{{ (memory.updated_at || '').slice(0, 10) }} 那次定的）。{{ memoryTail }}</span>
    </div>

    <!-- v346：**记忆命中且没有危险列** ⇒ 默认收起映射表，让「确认导入」直接就是下一步。
         判据只有后端一处（`remembered.direct_ok`）：前端不自己推算"该不该直通"。
         ⚠️ 收起 ≠ 不让看：按钮永远在，点一下就是完整映射表，改动照样生效。
         为什么敢默认收起：这份映射是**用户自己上次确认过的**，且这次没有一列需要改。 -->
    <div v-if="collapsed" class="im-fold">
      <Icon name="check" :size="14" />
      <span>各列都和你上次定的一样，没有需要确认的地方，可以直接导入。</span>
      <button class="im-fold-btn" @click="collapsed = false">
        <Icon name="chevron-right" :size="13" />
        查看 / 调整映射（{{ rows.length }} 列）
      </button>
    </div>

    <div v-else class="im-wrap">
      <div v-if="collapsible" class="im-unfold">
        <button class="im-fold-btn" @click="collapsed = true">
          <Icon name="chevron-down" :size="13" />
          收起映射表
        </button>
      </div>
      <table class="tbl im-tbl">
        <thead>
          <tr>
            <th class="im-c1">文件里的列</th>
            <th class="im-c2">识别为</th>
            <th class="im-c3">依据</th>
            <th>前几行的值（判断这列是什么用）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.index" :class="{ 'im-off': !current(r.index) }">
            <td class="im-hd">{{ r.header }}</td>
            <td>
              <select class="fld im-sel" :class="{ 'im-sel-risk': !!r.risk }" :value="current(r.index)" :aria-label="'「' + r.header + '」这一列对应哪个字段'" @change="pick(r.index, $event.target.value)">
                <option value="">（不导入）</option>
                <option v-for="o in fieldOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
              </select>
              <!-- v346：危险列在**行内**再说一遍原因。只靠顶部提示条不够 ——
                   用户点「改」的时候视线在这一行上，那时候最需要看到"为什么说它可疑"。 -->
              <div v-if="r.risk" class="im-rdanger">
                <Icon name="alert" :size="12" />{{ riskTail(r) }}
              </div>
            </td>
            <td><span class="im-cc" :class="'im-cc-' + confKey(r)">{{ confLabel(r) }}</span></td>
            <td class="im-smp">{{ (r.samples || []).join(' / ') || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'

/* 导入「列映射确认」——商品 / 库存 / 员工 / 预报订单四处导入共用**同一份实现**。
 *
 * 由来（2026-09-16）：此前四处都是 `preview → 直接把系统识别结果当 mapping → execute`，
 * 中间没有任何确认环节。后果实测：商品导入模版里填「厂家商品编码」，被关键词「厂家」命中
 * brand，**编码串直接写进品牌列**（置信度还是 high）；「永辉商品编码」则被静默丢弃。
 * 另外后端 `_execute_forecast_cross` 的 400 文案早就写着「请在预览里把客户列映射为「客户」」
 * —— 承诺了界面，但预览里根本没有可改的控件。
 *
 * 设计约束（四条，别改）：
 *  ① **候选字段清单只能来自后端**（`/import/preview` 的 field_options）。前端自己再写一份
 *     「键→中文」就是第二份拷贝 —— 加字段时必然漏掉一侧，用户就会「选不到」。
 *  ② **必须是可改的，且改完真生效**。后端 `/execute` 本来就照用前端传的 mapping
 *     （`import_router.py` 逐行 `mapping.items()`；预报交叉表单客户列亦按 mapping 走），
 *     所以这里不需要动写入侧 —— 唯一要做的是把选择权交出去。
 *  ③ **给出判断依据**。只显示「识别为：品牌」没用，用户不知道对不对；显示命中这一列的前几个
 *     值（如 `130200004312`）才判断得了。样例值由后端在 preview 里一并回传。
 *  ④ **v346：该拦的拦住、该省的省掉**。危险列（`r.risk`）必须显眼到不可能错过；
 *     而记忆命中且无危险列时，「确认导入」直接就是下一步（收起映射表）。
 *     两个判据都**只来自后端**，前端不算第二遍。
 */

const props = defineProps({
  // /import/preview 的 suggestions：每列一条
  // {index, header, suggested_field, confidence, samples, risk, risk_reason}
  //   · risk ∈ '' | 'dup'（同一字段被多列命中）| 'generic'（整名列名属于另一个字段）
  //   · risk_reason 是**后端给好的业务话**，前端直接显示，不要自己再拼一句
  suggestions: { type: Array, default: () => [] },
  // 后端给的候选字段：[{key, label}]，顺序即下拉顺序
  fieldOptions: { type: Array, default: () => [] },
  // 当前映射 {列下标: 字段键}；空串/不存在 = 不导入
  modelValue: { type: Object, default: () => ({}) },
  // v303：/import/preview 回的 `remembered`
  //   （{applied, updated_at, hit_count, risky_columns, direct_ok, block_reason} 或 null）。
  //   传 null 不显示任何提示 —— 组件**不自己判断**"有没有记住"，判据只有后端一处。
  memory: { type: Object, default: null },
  // v303：是否跳过已存在的记录（→ 后端 `mode=incremental`）。默认关，保持既有行为。
  incremental: { type: Boolean, default: false },
  // v303：是否显示上面那个勾选框。**报单矩阵（forecast_cross）必须传 false** ——
  //   那条路径走 `_execute_forecast_cross`、在 `/execute` 里提前 return，`mode` 根本不生效；
  //   显示一个不起作用的勾选框就是「死按钮」，比没有更糟。去重由报单本身的
  //   「一店一期一单」幂等键负责，不需要这个开关。
  showIncremental: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'update:incremental'])

/* 行的可见性：无表头且无数据、也无映射的列不显示 —— Excel 尾部常拖一堆空列，显示出来全是噪音。
   隐藏**不会**改变映射（那类列本来就没有映射项）。 */
const rows = computed(() => (props.suggestions || []).filter(s => {
  if (String(s.header || '').trim()) return true
  return !!props.modelValue?.[s.index] || (s.samples || []).length > 0
}))

const current = (idx) => props.modelValue?.[idx] || ''
const suggestedOf = (r) => r.suggested_field || ''

const mappedCount = computed(() => rows.value.filter(r => current(r.index)).length)
const skippedCount = computed(() => rows.value.filter(r => !current(r.index)).length)
const changed = computed(() => rows.value.some(r => current(r.index) !== suggestedOf(r)))

/* v346：危险列。**只用后端给的 `risk`**，不在前端重算 —— 判据（无歧义列名索引 + 语义族门）
   在后端 `_annotate_column_risks` 里只有一处实现，前端再算一遍必然漂移。 */
const riskyRows = computed(() => rows.value.filter(r => !!r.risk))

/* 提示语：后端把「被识别成了什么」写在 risk_reason 开头，这里只做去重拼接，不改写语义。
   `risk_reason` 形如「「商品名称」被识别成了「客户名称」——…」，而列表里已经显示了列名
   （`<b>「X」</b>`），所以把开头那段「「X」」摘掉，避免同一句话里出现两次列名。 */
function riskTail(r) {
  const s = String(r.risk_reason || '')
  const h = String(r.header || '')
  if (!s) return ''
  const head = '「' + h + '」'
  return s.startsWith(head) ? s.slice(head.length) : ' ' + s
}

/* ── v346：记忆命中 ⇒ 是否默认收起映射表 ────────────────────────────────────
   判据 = 后端 `remembered.direct_ok`（后端已经排除了「改账目类目」「报单矩阵」「有危险列」）。
   前端**不**自己判这几种情况 —— 那会是同一规则的第二份实现。 */
const collapsible = computed(() => !!(props.memory && props.memory.direct_ok))
const collapsed = ref(collapsible.value)
// 同一组件实例可能被下一页 prev 复用（父级不一定重挂），memory 变了要跟着回到对应状态。
watch(collapsible, (v) => { collapsed.value = v })

const memoryTail = computed(() => {
  const b = String(props.memory?.block_reason || '')
  if (b) return b + '，右边可以逐列核对。'
  if (collapsible.value) return '下面各列不用改。'
  return '右边改动的列会覆盖它。'
})

function pick(idx, val) {
  const next = { ...(props.modelValue || {}) }
  if (val) next[idx] = val
  else delete next[idx]
  emit('update:modelValue', next)
}

function resetToSuggested() {
  const next = {}
  for (const r of rows.value) if (suggestedOf(r)) next[r.index] = suggestedOf(r)
  emit('update:modelValue', next)
}

const CONF = { high: '系统识别', ai: 'AI 推测', cross: '客户列', low: '未识别', memory: '上次你的选择' }
function confKey(r) {
  // v346：危险列排在最前 —— 用户自己改过就以"已改"为准（改动之后的映射才是要落库的那份，
  //   后端的风险标记是针对改之前那一列的）。
  if (current(r.index) === suggestedOf(r) && r.risk) return 'risk'
  if (current(r.index) !== suggestedOf(r)) return 'edit'
  if (!suggestedOf(r)) return 'low'
  // v303：memory 与 high 都表示"系统给的、可直接用"，但来源不同 —— 分开标色，
  //   用户才知道这一列是**自己上次定的**、不是系统猜的（猜的要复核，自己定的不用）。
  if (r.confidence === 'memory') return 'memory'
  return r.confidence || 'high'
}
function confLabel(r) {
  if (current(r.index) === suggestedOf(r) && r.risk) return '需确认'
  if (current(r.index) !== suggestedOf(r)) return '已改'
  return suggestedOf(r) ? (CONF[r.confidence] || '系统识别') : '未识别'
}
</script>

<style scoped>
.im{display:flex;flex-direction:column;gap:8px}
.im-bar{display:flex;align-items:center;justify-content:space-between;gap:10px}
.im-st{font-size:12px;color:var(--t2)}
.im-st b{color:var(--p-dark);font-size:13px}
.im-st b.off{color:var(--war)}
.im-acts{display:flex;align-items:center;gap:12px}
.im-inc{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--t2);cursor:pointer;white-space:nowrap}
.im-inc input{cursor:pointer;margin:0}
.im-reset{border:none;background:none;padding:0;font-size:12px;color:var(--p-dark);text-decoration:underline;cursor:pointer}
.im-note{font-size:12px;color:var(--warn-amber);background:var(--warn-amber-bg);border-radius:var(--radius-sm);padding:6px 10px}
.im-mem{font-size:12px;color:var(--p-dark);background:var(--p-bg);border-radius:var(--radius-sm);padding:6px 10px}
.im-mem b{font-size:13px}
.im-mem-t{color:var(--t2)}
/* v346 危险列提示条 —— 用最重的颜色，因为这类列原本"看起来一切正常" */
.im-risk{font-size:12px;color:var(--danger-txt);background:var(--danger-bg);border-radius:var(--radius-sm);padding:7px 10px;display:flex;flex-direction:column;gap:3px;border:1px solid var(--danger-txt)}
.im-risk-h{display:flex;align-items:center;gap:5px;font-weight:600}
.im-risk-l{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:2px}
.im-risk-l li{line-height:1.5}
/* v346 收起态：一行把话说清，按钮永远在 */
.im-fold{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ok-green);background:var(--ok-green-bg);border-radius:var(--radius-sm);padding:8px 10px;flex-wrap:wrap}
.im-fold-btn{display:inline-flex;align-items:center;gap:3px;border:none;background:none;padding:0;font-size:12px;color:var(--p-dark);text-decoration:underline;cursor:pointer}
.im-unfold{display:flex;justify-content:flex-end;padding:5px 8px 0}
.im-wrap{max-height:320px;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.im-tbl{font-size:13px}
.im-tbl th{position:sticky;top:0;z-index:1}
.im-tbl td{vertical-align:middle}
.im-c1{width:26%}.im-c2{width:26%}.im-c3{width:96px}
.im-hd{font-weight:500;color:var(--t1);word-break:break-all}
.im-sel{width:100%;height:30px;padding:0 6px;font-size:13px}
/* 危险列的下拉框本身也描红 —— 只标「依据」徽章的话，扫一眼很难定位到是哪一行要改 */
.im-sel-risk{border-color:var(--danger-txt)}
.im-rdanger{display:flex;align-items:flex-start;gap:4px;margin-top:4px;font-size:11.5px;line-height:1.45;color:var(--danger-txt)}
.im-smp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--t2);word-break:break-all}
.im-off .im-hd,.im-off .im-smp{color:var(--t3)}
.im-cc{display:inline-block;padding:1px 8px;border-radius:8px;font-size:11.5px;white-space:nowrap;background:var(--bg2);color:var(--t3)}
.im-cc-high{background:var(--ok-green-bg);color:var(--ok-green)}
.im-cc-ai{background:var(--info-blue-bg);color:var(--info-blue)}
.im-cc-cross{background:var(--p-bg);color:var(--p-dark)}
.im-cc-low{background:var(--warn-amber-bg);color:var(--warn-amber)}
.im-cc-edit{background:var(--violet-bg);color:var(--violet)}
.im-cc-memory{background:var(--violet-bg);color:var(--violet)}
.im-cc-risk{background:var(--danger-bg);color:var(--danger-txt);font-weight:600}
</style>
