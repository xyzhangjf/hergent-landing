<template>
  <!-- 供应商作用对象选择器（v702）
       🔴 用**内嵌展开面板**而不是绝对定位浮层：目标弹窗的 body 是 `.ui-modal-body`
          （`overflow-y:auto`），任何 absolute 浮层都会被**裁剪**在滚动容器边界上，
          表现为「点了没反应 / 只露出半行」。内嵌面板占据布局高度，随 body 滚动，
          永不被裁 —— 这是此处唯一稳的形态。
       🔴 纯展示 + 回传选中数组：不发起请求、不做任何业务判定；候选由父页传入。 -->
  <div class="sp">
    <!-- 已选 chips：这是「当前所选供应商」的第一处显式提示 -->
    <div v-if="selected.length" class="sp-chips">
      <span v-for="s in selected" :key="s.id" class="sp-chip" :title="s.name">
        <span class="sp-chip-nm">{{ s.name }}</span>
        <button type="button" class="sp-chip-x" :aria-label="'移除 ' + s.name" @click="remove(s)">×</button>
      </span>
      <button v-if="multiple && selected.length > 1" type="button" class="sp-clear" @click="clearAll">全部清空</button>
    </div>

    <!-- 触发器 -->
    <button type="button" class="sp-trigger" :disabled="disabled" @click="toggle">
      <Icon name="search" :size="14" />
      <span class="sp-trigger-t">{{ triggerText }}</span>
      <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="14" />
    </button>

    <!-- 内嵌面板 -->
    <div v-if="open" class="sp-panel">
      <div class="sp-hd">
        <input ref="kwRef" v-model="kw" class="input sp-search"
               placeholder="搜供应商名称 / 编码">
        <select v-model="cat" class="input sp-cat" title="按供应商分类筛选">
          <option value="">全部分类（{{ suppliers.length }} 个）</option>
          <option v-for="c in cats" :key="c" :value="c">{{ c }}（{{ countOf(c) }} 个）</option>
        </select>
      </div>

      <div class="sp-list">
        <label v-for="s in filtered" :key="s.id" class="sp-item" :class="{ on: isSel(s) }">
          <input :type="multiple ? 'checkbox' : 'radio'" :checked="isSel(s)"
                 @change="multiple ? pickMulti(s) : pickSingle(s)">
          <span class="sp-nm">{{ s.name }}</span>
          <span v-if="s.code" class="sp-code">编码 {{ s.code }}</span>
          <span v-if="s.catLabel" class="sp-catb">{{ s.catLabel }}</span>
        </label>
        <div v-if="!filtered.length" class="sp-empty">
          没有匹配的供应商。若确实没有，请先到「档案管理 › 供应商档案」建档。
        </div>
      </div>

      <div class="sp-ft">
        <span class="sp-cnt">当前筛选 {{ filtered.length }} 个 · 已选 {{ selected.length }} 个</span>
        <button v-if="multiple" type="button" class="btn btn-ghost btn-sm"
                :disabled="!filtered.length" @click="selectAllFiltered">
          全选当前筛选
        </button>
        <button type="button" class="btn btn-primary btn-sm" @click="open = false">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
/* v702：作用对象统一为供应商。search 命中口径 = 名称 / 编码（包含即命中，不区分大小写）。
   🔴 不承诺「拼音首字母」：生产 38 个供应商的 pinyin / pinyin_first 字段**全部为空**
      （实测 0/38），写上就是一句做不到的承诺 —— 用户敲 ja 会看到"没有匹配"。
      字段照读（有值就能命中，未来补了拼音自动生效），但**界面不宣传**。
   分类筛选取自候选自身的 supplier_category，只聚合「有哪几类」，不另建分类字典
   （避免出现库里根本没有的分类选项）。 */
import Icon from '../Icon.vue'
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({
  /** 已选供应商数组：[{ id, name, code, category }] */
  modelValue: { type: Array, default: () => [] },
  /** 全部候选供应商（父页一次性传入） */
  suppliers: { type: Array, default: () => [] },
  /** true=多选（新建）；false=单选（编辑已有规则） */
  multiple: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '点击选择供应商' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const kw = ref('')
const cat = ref('')
const kwRef = ref(null)

const selected = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])

function catLabelOf(c) {
  const s = String(c || '').trim()
  if (!s) return ''
  const parts = s.split('/').map(x => x.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}
/* 候选归一：只保留有 id 与名称的行；分类统一成显示用的末段标签 */
const list = computed(() => (props.suppliers || [])
  .filter(s => s && s.id != null && String(s.name || '').trim())
  .map(s => ({
    id: s.id, name: String(s.name || '').trim(),
    code: String(s.code || '').trim(),
    pinyin: String(s.pinyin || '').trim(),
    pinyinFirst: String(s.pinyin_first || '').trim(),
    category: String(s.supplier_category || '').trim(),
    catLabel: catLabelOf(s.supplier_category),
  })))

const cats = computed(() => {
  const set = []
  list.value.forEach(s => { if (s.catLabel && set.indexOf(s.catLabel) < 0) set.push(s.catLabel) })
  return set.sort((a, b) => a.localeCompare(b, 'zh'))
})
function countOf(c) { return list.value.filter(s => s.catLabel === c).length }

const filtered = computed(() => {
  const k = kw.value.trim().toLowerCase()
  let arr = list.value
  if (cat.value) arr = arr.filter(s => s.catLabel === cat.value)
  if (k) {
    arr = arr.filter(s => s.name.toLowerCase().includes(k)
      || (s.code && s.code.toLowerCase().includes(k))
      || (s.pinyin && s.pinyin.toLowerCase().includes(k))
      || (s.pinyinFirst && s.pinyinFirst.toLowerCase().includes(k)))
  }
  return arr
})

function isSel(s) { return selected.value.some(x => Number(x.id) === Number(s.id)) }
function emitVal(arr) { emit('update:modelValue', arr) }
function pickMulti(s) {
  const cur = selected.value.slice()
  const i = cur.findIndex(x => Number(x.id) === Number(s.id))
  if (i >= 0) cur.splice(i, 1)
  else cur.push({ id: s.id, name: s.name, code: s.code, category: s.category })
  emitVal(cur)
}
/* 单选：点已选中的那个不取消（避免"手滑点一下就把作用对象清空"变成全部供应商） */
function pickSingle(s) {
  if (isSel(s)) return
  emitVal([{ id: s.id, name: s.name, code: s.code, category: s.category }])
}
function remove(s) {
  emitVal(selected.value.filter(x => Number(x.id) !== Number(s.id)))
}
function clearAll() { emitVal([]) }
function selectAllFiltered() {
  const cur = selected.value.slice()
  filtered.value.forEach(s => {
    if (!cur.some(x => Number(x.id) === Number(s.id))) {
      cur.push({ id: s.id, name: s.name, code: s.code, category: s.category })
    }
  })
  emitVal(cur)
}

const triggerText = computed(() => {
  const n = selected.value.length
  if (!n) return props.placeholder
  if (n === 1) return selected.value[0].name
  return `已选 ${n} 个供应商，点击查看或修改`
})

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) nextTick(() => kwRef.value && kwRef.value.focus())
}
/* 收起时清掉搜索词 —— 否则下次打开会只剩上次筛出来的几行，看起来像"供应商变少了" */
watch(open, v => { if (!v) { kw.value = ''; cat.value = '' } })

/* 点面板外部收起（面板在文档流内，不需要监听尺寸变化） */
function onDocDown(e) {
  if (!open.value) return
  const el = e.target && e.target.closest ? e.target.closest('.sp') : null
  if (!el) open.value = false
}
document.addEventListener('mousedown', onDocDown, true)
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true))
</script>

<style scoped>
.sp { display: flex; flex-direction: column; gap: 8px; }

.sp-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sp-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 3px 4px 3px 9px; border-radius: 14px; font-size: 12.5px;
  background: rgba(0, 122, 255, .1); border: 1px solid rgba(0, 122, 255, .28); color: var(--t1); }
.sp-chip-nm { max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-chip-x { flex: none; width: 17px; height: 17px; line-height: 1; border: 0; border-radius: 50%;
  background: transparent; color: var(--t2); cursor: pointer; font-size: 14px; }
.sp-chip-x:hover { background: rgba(0, 0, 0, .08); color: var(--dan); }
.sp-clear { border: 0; background: transparent; color: var(--t3); font-size: 12px; cursor: pointer; padding: 2px 4px; }
.sp-clear:hover { color: var(--dan); }

.sp-trigger { display: flex; align-items: center; gap: 7px; width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid var(--bd); border-radius: 8px; background: var(--bg); color: var(--t1);
  font-size: 13px; cursor: pointer; text-align: left; }
.sp-trigger:hover { border-color: var(--t3); }
.sp-trigger:disabled { opacity: .55; cursor: not-allowed; }
.sp-trigger-t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sp-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px;
  border: 1px solid var(--bd); border-radius: 10px; background: var(--bg2); }
.sp-hd { display: grid; grid-template-columns: 1fr 170px; gap: 8px; }
.sp-search, .sp-cat { height: 32px; font-size: 12.5px; }

.sp-list { max-height: 210px; overflow-y: auto; border: 1px solid var(--bd); border-radius: 8px;
  background: var(--bg); }
.sp-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 13px;
  cursor: pointer; border-bottom: 1px solid var(--bd); }
.sp-item:last-child { border-bottom: 0; }
.sp-item:hover { background: var(--bg2); }
.sp-item.on { background: rgba(0, 122, 255, .08); }
.sp-item input { flex: none; width: 14px; height: 14px; accent-color: #007aff; cursor: pointer; }
.sp-nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-code { flex: none; font-size: 11.5px; color: var(--t3); }
.sp-catb { flex: none; font-size: 11px; color: var(--t3); padding: 1px 6px;
  border-radius: 8px; background: var(--bg2); border: 1px solid var(--bd); }
.sp-empty { padding: 14px 10px; font-size: 12.5px; color: var(--t3); text-align: center; line-height: 1.6; }

.sp-ft { display: flex; align-items: center; gap: 8px; }
.sp-cnt { flex: 1; font-size: 12px; color: var(--t2); white-space: nowrap; }

@media (max-width: 760px) {
  .sp-hd { grid-template-columns: 1fr; }
  .sp-list { max-height: 180px; }
  .sp-item { padding: 9px 10px; }
  /* 移动端：计数独占一行（否则「已选 0 个」会断成两行），控件各占一半 */
  .sp-ft { flex-wrap: wrap; }
  .sp-cnt { width: 100%; flex: none; }
  .sp-ft .btn { flex: 1; }
}
</style>
