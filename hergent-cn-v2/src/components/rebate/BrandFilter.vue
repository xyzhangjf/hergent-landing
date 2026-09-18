<template>
  <div class="bf">
    <div v-if="open" class="bf-mask" @click="open = false"></div>
    <button class="btn btn-sm btn-ghost" :class="{ on: open }" @click="open = !open">
      <Icon name="filter" /> {{ label }} <Icon name="chevron-down" />
    </button>
    <div v-if="open" class="bf-panel" @click.stop>
      <div class="bf-head">
        <span>按品牌筛选</span>
        <div class="bf-acts">
          <button class="link-btn" @click="selectAll">全选</button>
          <button class="link-btn" @click="clearSel">清空</button>
        </div>
      </div>
      <input v-model="query" class="input bf-search" type="text" placeholder="搜索品牌" />
      <div class="bf-list">
        <label v-for="b in filtered" :key="b" class="bf-item">
          <input type="checkbox" :value="b" :checked="sel.includes(b)" @change="toggle(b)" /> {{ b }}
        </label>
        <p v-if="!filtered.length" class="bf-empty">{{ names.length ? '没有匹配的品牌' : emptyText }}</p>
      </div>
      <p class="bf-tip"><template v-if="scopeTip">{{ scopeTip }}<br /></template>不勾选 = 全部品牌合计。达成率按加权计算（合计达成 ÷ 合计目标）。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'

const props = defineProps({
  list: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  // 作用域说明：不同摆放位置的筛选作用范围不同，由调用方给出（说明出现在"用户点开筛选"的那一刻）
  scopeTip: { type: String, default: '' },
  // v185 R7：候选**本身就是空**（而非"搜索无结果"）时的文案 —— 两者都是空清单但成因完全不同，
  // 同一条「没有匹配的品牌」会让「本年度确实没有品牌目标」看起来像搜索坏了
  emptyText: { type: String, default: '没有匹配的品牌' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const query = ref('')
const names = computed(() => (props.list || []).map(b => b.name || b).filter(Boolean))
const sel = computed(() => props.modelValue || [])
const filtered = computed(() => {
  const q = String(query.value || '').trim()
  return q ? names.value.filter(n => n.includes(q)) : names.value
})
const label = computed(() => {
  const n = sel.value.length
  if (!n) return '全部品牌'
  return n === 1 ? sel.value[0] : `已选 ${n} 个品牌`
})
function toggle(b) {
  const cur = sel.value.slice()
  const i = cur.indexOf(b)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(b)
  emit('update:modelValue', cur)
}
function selectAll() { emit('update:modelValue', names.value.slice()) }
function clearSel() { emit('update:modelValue', []) }
</script>

<style scoped>
.bf { position: relative; }
.bf-mask { position: fixed; inset: 0; z-index: 40; }
.bf-panel {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 42;
  width: 250px; padding: 10px 12px; border-radius: var(--radius-sm, 8px);
  background: var(--bg); border: 1px solid var(--bd); box-shadow: var(--shadow-md);
}
.bf-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--t1); }
.bf-acts { display: flex; gap: 8px; }
.bf-search { width: 100%; height: 26px; font-size: 12px; margin: 8px 0 4px; }
.bf-list { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow: auto; }
.bf-item { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--t1); cursor: pointer; padding: 2px; }
.bf-item:hover { background: var(--bg2); }
.bf-empty { color: var(--t3); font-size: 12px; margin: 4px 0; }
.bf-tip { font-size: 12px; color: var(--t3); margin: 8px 0 0; line-height: 1.5; }
</style>
