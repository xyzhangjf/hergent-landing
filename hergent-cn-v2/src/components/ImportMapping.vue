<template>
  <div class="im">
    <div class="im-bar">
      <span class="im-st">
        共 {{ rows.length }} 列 · 导入 <b>{{ mappedCount }}</b> 列 · 不导入 <b :class="{ off: skippedCount }">{{ skippedCount }}</b> 列
      </span>
      <button v-if="changed" class="im-reset" @click="resetToSuggested">还原系统识别</button>
    </div>

    <div v-if="skippedCount" class="im-note">
      标「不导入」的列不会写进系统。若其中有你需要的列，在右边把它改成对应字段即可。
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
})
const emit = defineEmits(['update:modelValue'])

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

const CONF = { high: '系统识别', ai: 'AI 推测', cross: '客户列', low: '未识别' }
function confKey(r) {
  if (current(r.index) !== suggestedOf(r)) return 'edit'
  return suggestedOf(r) ? (r.confidence || 'high') : 'low'
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
.im-reset{border:none;background:none;padding:0;font-size:12px;color:var(--p-dark);text-decoration:underline;cursor:pointer}
.im-note{font-size:12px;color:var(--warn-amber);background:var(--warn-amber-bg);border-radius:var(--radius-sm);padding:6px 10px}
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
</style>
