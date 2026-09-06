<template>
  <Teleport to="body">
    <div v-if="open" class="cmd-mask" @click.self="close">
      <div class="cmd-panel" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="cmd-input-wrap">
          <span class="cmd-search-ic"><Icon name="search" :size="16" /></span>
          <input
            ref="input"
            v-model="q"
            class="cmd-input"
            placeholder="输入关键词，快速跳转或执行…"
            spellcheck="false"
            @keydown="onKey"
          />
          <kbd class="cmd-kbd">Esc</kbd>
        </div>

        <div class="cmd-list">
          <template v-for="(c, i) in filtered" :key="c.id">
            <div v-if="i === 0 || filtered[i - 1].group !== c.group" class="cmd-group-hd">{{ c.group }}</div>
            <button
              class="cmd-item"
              :class="{ active: i === activeIndex }"
              type="button"
              @click="run(c)"
              @mousemove="activeIndex = i"
            >
              <span class="cmd-ic"><Icon :name="c.icon" :size="15" /></span>
              <span class="cmd-title">{{ c.title }}</span>
              <span v-if="c.hint" class="cmd-hint">{{ c.hint }}</span>
            </button>
          </template>
          <div v-if="!filtered.length" class="cmd-empty">没有匹配的命令</div>
        </div>

        <div class="cmd-foot">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { store, setTheme } from '../store'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const router = useRouter()
const q = ref('')
const activeIndex = ref(0)
const input = ref(null)

const open = computed(() => props.modelValue)

const COMMANDS = [
  // 操作（高频动作）
  { id: 'copilot', group: '操作', icon: 'sparkle', title: '问 AI 副驾', hint: '⌘K', action: () => { store.ui.copilotOpen = true } },
  { id: 'theme', group: '操作', icon: 'lightbulb', title: '切换深浅主题', action: () => setTheme(store.ui.theme === 'light' ? 'dark' : 'light') },
  // 页面（导航）
  { id: 'workbench', group: '页面', icon: 'grid', title: '经营工作台', path: '/workbench' },
  { id: 'forecast', group: '页面', icon: 'activity', title: '预报订货管理', path: '/forecast' },
  { id: 'rebate', group: '页面', icon: 'target', title: '目标与返利', path: '/rebate' },
  { id: 'dashboard', group: '页面', icon: 'sort', title: '经营趋势', path: '/dashboard' },
  { id: 'connect', group: '页面', icon: 'brain', title: '能力中心', path: '/connect' },
  { id: 'roles', group: '页面', icon: 'users', title: 'AI 团队', path: '/roles' },
  { id: 'reconciliation', group: '页面', icon: 'audit', title: '对账工作流', path: '/reconciliation' },
  { id: 'loss', group: '页面', icon: 'flame', title: '货损计算工作流', path: '/loss' },
  { id: 'payroll', group: '页面', icon: 'coins', title: '算工资工作流', path: '/payroll' },
  { id: 'data-fill', group: '页面', icon: 'package', title: '库存效期补录', path: '/data-fill' },
  { id: 'archive', group: '页面', icon: 'book', title: '档案管理', path: '/archive/employees' },
  { id: 'cron', group: '页面', icon: 'clock', title: '定时任务', path: '/cron' },
  { id: 'settings', group: '页面', icon: 'settings', title: '设置', path: '/settings' },
  { id: 'bid-radar', group: '页面', icon: 'search', title: '招投标雷达', path: '/bid-radar' }
]

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return COMMANDS
  return COMMANDS.filter(c => c.title.toLowerCase().includes(kw) || (c.keywords || '').includes(kw))
})

function close() { emit('update:modelValue', false) }

function run(c) {
  if (c.path) router.push(c.path)
  else if (c.action) c.action()
  close()
}

function onKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const c = filtered.value[activeIndex.value]
    if (c) run(c)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

watch(open, async (v) => {
  if (v) {
    q.value = ''
    activeIndex.value = 0
    await nextTick()
    input.value && input.value.focus()
  }
})

watch(q, () => { activeIndex.value = 0 })
</script>

<style scoped>
.cmd-mask{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
.cmd-panel{width:min(560px,92vw);background:var(--bg);border:1px solid var(--border-subtle);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.28);overflow:hidden;display:flex;flex-direction:column}
.cmd-input-wrap{display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--border-subtle)}
.cmd-search-ic{color:var(--t3);display:flex}
.cmd-input{flex:1;border:none;outline:none;background:none;font-size:15px;color:var(--t1)}
.cmd-input::placeholder{color:var(--t3)}
.cmd-kbd{font-size:11px;color:var(--t3);background:var(--bg2);border:1px solid var(--border-subtle);border-radius:5px;padding:2px 6px}
.cmd-list{max-height:46vh;overflow-y:auto;padding:6px}
.cmd-group-hd{font-size:11px;font-weight:600;color:var(--t3);padding:10px 12px 4px;letter-spacing:.6px}
.cmd-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border:none;background:none;border-radius:9px;color:var(--t1);font-size:14px;cursor:pointer}
.cmd-item.active{background:var(--p-bg)}
.cmd-ic{color:var(--t2);display:flex;flex-shrink:0}
.cmd-item.active .cmd-ic{color:var(--p-dark)}
.cmd-title{flex:1;line-height:1.4}
.cmd-hint{font-size:11px;color:var(--t3);background:var(--bg2);border:1px solid var(--border-subtle);border-radius:5px;padding:2px 6px}
.cmd-empty{font-size:13px;color:var(--t3);text-align:center;padding:24px 0}
.cmd-foot{display:flex;gap:16px;padding:9px 15px;border-top:1px solid var(--border-subtle);font-size:11px;color:var(--t3)}
.cmd-foot kbd{font-size:10px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 5px;margin-right:4px}
</style>
