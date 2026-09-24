<template>
  <div v-if="show" class="palette-mask" @click.self="$emit('close')">
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <input
        ref="inputEl"
        class="palette-input"
        v-model="q"
        placeholder="搜索页面、操作，或输入租户名…"
        aria-label="命令面板搜索"
        autocomplete="off"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="exec()"
        @keydown.esc.prevent="$emit('close')"
      />
      <div class="palette-list">
        <button
          v-for="(it, i) in results"
          :key="it.id"
          type="button"
          class="palette-item"
          :class="{ on: i === idx }"
          @click="exec(i)"
          @mouseenter="idx = i"
        >
          <Icon :name="it.icon" :size="15" />
          <span>{{ it.label }}</span>
          <span class="p-kind">{{ it.kind }}</span>
        </button>
        <div v-if="results.length === 0" class="palette-empty">没有匹配项</div>
      </div>
      <div class="palette-foot">
        <span><span class="kbd">↑</span><span class="kbd">↓</span> 选择</span>
        <span><span class="kbd">Enter</span> 打开</span>
        <span><span class="kbd">Esc</span> 关闭</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { tenantApi } from '../api/client'
import Icon from './Icon.vue'

// 命令面板（⌘K / Ctrl+K）：页面跳转 + 快捷操作 + 租户搜索。
// 租户搜索走服务端（复用 /api/tenants 的 q 参数），不把全量租户拉进前端。
const props = defineProps({ show: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'run'])

const inputEl = ref(null)
const q = ref('')
const idx = ref(0)
const tenants = ref([])
let tid = null

const STATIC = [
  { id: 'p-overview', label: '平台总览', kind: '页面', icon: 'dashboard', to: '/' },
  { id: 'p-tenants', label: '租户管理', kind: '页面', icon: 'building', to: '/tenants' },
  { id: 'p-invite', label: '邀请码管理', kind: '页面', icon: 'ticket', to: '/invite-codes' },
  { id: 'p-reg', label: '注册流水', kind: '页面', icon: 'clipboard', to: '/registrations' },
  { id: 'p-audit', label: '操作审计', kind: '页面', icon: 'history', to: '/audit-logs' },
  { id: 'p-users', label: '平台用户', kind: '页面', icon: 'users', to: '/users' },
  { id: 'a-new-tenant', label: '新增租户', kind: '操作', icon: 'building', to: '/tenants?new=1' },
  { id: 'a-new-invite', label: '生成邀请码', kind: '操作', icon: 'ticket', to: '/invite-codes?new=1' },
  { id: 'a-theme', label: '切换浅色 / 深色主题', kind: '设置', icon: 'refresh', action: 'theme' },
  { id: 'a-density', label: '切换表格密度', kind: '设置', icon: 'refresh', action: 'density' },
]

const results = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const stat = STATIC.filter((s) => !kw || s.label.toLowerCase().includes(kw) || s.kind.includes(kw))
  const t = tenants.value.map((x) => ({
    id: 't-' + x.id, label: x.name, kind: '租户', icon: 'building', to: '/tenants/' + x.id,
  }))
  return [...stat, ...t].slice(0, 30)
})

function move(d) {
  if (!results.value.length) return
  idx.value = (idx.value + d + results.value.length) % results.value.length
}
function exec(i) {
  const it = results.value[i === undefined ? idx.value : i]
  if (!it) return
  emit('run', it)
  emit('close')
}

async function searchTenants(kw) {
  try {
    const data = await tenantApi.list({ q: kw, limit: 8 })
    tenants.value = (data && data.data) || []
  } catch (e) {
    tenants.value = []
  }
}

watch(() => props.show, async (v) => {
  if (v) {
    q.value = ''
    idx.value = 0
    tenants.value = []
    await nextTick()
    if (inputEl.value) inputEl.value.focus()
  }
})
watch(q, (v) => {
  idx.value = 0
  clearTimeout(tid)
  const kw = v.trim()
  if (kw.length < 1) { tenants.value = []; return }
  tid = setTimeout(() => searchTenants(kw), 250)
})
onBeforeUnmount(() => clearTimeout(tid))
</script>
