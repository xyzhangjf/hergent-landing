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
        <label v-if="showIncremental" class="im-inc" :title="'打开后，系统里已有的记录不会重复导入（商品按条码/名称、员工按工号/姓名、库存按商品+批次号判断）'">
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

    <!-- v303：映射记忆提示。只在**真命中**时出现（后端算不出命中就不回这个字段）——
         空壳提示（"已记住你的映射"但没记住）比不提示更糟：用户下次会发现并没有记住。 -->
    <div v-if="memory && memory.applied" class="im-mem">
      已按你上次的映射预填 <b>{{ memory.applied }}</b> 列
      <span class="im-mem-t">（{{ (memory.updated_at || '').slice(0, 10) }} 那次定的）。右边改动的列会覆盖它。</span>
    </div>

    <div class="im-wrap">
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
              <select class="fld im-sel" :value="current(r.index)" :aria-label="'「' + r.header + '」这一列对应哪个字段'" @change="pick(r.index, $event.target.value)">
                <option value="">（不导入）</option>
                <option v-for="o in fieldOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
              </select>
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
import { computed } from 'vue'

/* 导入「列映射确认」——商品 / 库存 / 员工 / 预报订单四处导入共用**同一份实现**。
 *
 * 由来（2026-09-16）：此前四处都是 `preview → 直接把系统识别结果当 mapping → execute`，
 * 中间没有任何确认环节。后果实测：商品导入模版里填「厂家商品编码」，被关键词「厂家」命中
 * brand，**编码串直接写进品牌列**（置信度还是 high）；「永辉商品编码」则被静默丢弃。
 * 另外后端 `_execute_forecast_cross` 的 400 文案早就写着「请在预览里把客户列映射为「客户」」
 * —— 承诺了界面，但预览里根本没有可改的控件。
 *
 * 设计约束（三条，别改）：
 *  ① **候选字段清单只能来自后端**（`/import/preview` 的 field_options）。前端自己再写一份
 *     「键→中文」就是第二份拷贝 —— 加字段时必然漏掉一侧，用户就会「选不到」。
 *  ② **必须是可改的，且改完真生效**。后端 `/execute` 本来就照用前端传的 mapping
 *     （`import_router.py` 逐行 `mapping.items()`；预报交叉表单客户列亦按 mapping 走），
 *     所以这里不需要动写入侧 —— 唯一要做的是把选择权交出去。
 *  ③ **给出判断依据**。只显示「识别为：品牌」没用，用户不知道对不对；显示命中这一列的前几个
 *     值（如 `130200004312`）才判断得了。样例值由后端在 preview 里一并回传。
 */

const props = defineProps({
  // /import/preview 的 suggestions：每列一条 {index, header, suggested_field, confidence, samples}
  suggestions: { type: Array, default: () => [] },
  // 后端给的候选字段：[{key, label}]，顺序即下拉顺序
  fieldOptions: { type: Array, default: () => [] },
  // 当前映射 {列下标: 字段键}；空串/不存在 = 不导入
  modelValue: { type: Object, default: () => ({}) },
  // v303：/import/preview 回的 `remembered`（{applied, updated_at, hit_count} 或 null）。
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
  if (current(r.index) !== suggestedOf(r)) return 'edit'
  if (!suggestedOf(r)) return 'low'
  // v303：memory 与 high 都表示"系统给的、可直接用"，但来源不同 —— 分开标色，
  //   用户才知道这一列是**自己上次定的**、不是系统猜的（猜的要复核，自己定的不用）。
  if (r.confidence === 'memory') return 'memory'
  return r.confidence || 'high'
}
function confLabel(r) {
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
.im-wrap{max-height:320px;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.im-tbl{font-size:13px}
.im-tbl th{position:sticky;top:0;z-index:1}
.im-tbl td{vertical-align:middle}
.im-c1{width:26%}.im-c2{width:26%}.im-c3{width:96px}
.im-hd{font-weight:500;color:var(--t1);word-break:break-all}
.im-sel{width:100%;height:30px;padding:0 6px;font-size:13px}
.im-smp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--t2);word-break:break-all}
.im-off .im-hd,.im-off .im-smp{color:var(--t3)}
.im-cc{display:inline-block;padding:1px 8px;border-radius:8px;font-size:11.5px;white-space:nowrap;background:var(--bg2);color:var(--t3)}
.im-cc-high{background:var(--ok-green-bg);color:var(--ok-green)}
.im-cc-ai{background:var(--info-blue-bg);color:var(--info-blue)}
.im-cc-cross{background:var(--p-bg);color:var(--p-dark)}
.im-cc-low{background:var(--warn-amber-bg);color:var(--warn-amber)}
.im-cc-edit{background:var(--violet-bg);color:var(--violet)}
.im-cc-memory{background:var(--violet-bg);color:var(--violet)}
</style>
