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
/* v291（2026-09-27）：入口可见性判据 —— 与侧栏 / 路由守卫读**同一份**页面注册表，
   见下方 `canSee()` 与 `COMMANDS` 头部注释。 */
import { canSee } from '../constants/pages'
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
  // 操作（高频动作）—— 与页面无关，**默认**不做权限过滤（人人可用）。
  // 🔴 v325（2026-09-29）例外：`copilot` 必须带 `module: 'chat'`。
  //   AI 已从"人人可用"改为**按需开通**（默认只给管理员/老板）。
  //   这里漏填的后果是**第二组假入口**：侧栏/顶部栏都藏了，⌘⇧K 一搜「问 AI 副驾」还搜得到，
  //   点开是个用不了的抽屉 —— 与 v267 修过的「命令面板假入口」是同一类缺陷。
  //   过滤逻辑无需改：`filtered` 早就支持 `!c.module || store.canModule(c.module)`。
  { id: 'copilot', group: '操作', icon: 'sparkle', title: '问 AI 副驾', hint: '⌘K', module: 'chat', action: () => { store.ui.copilotOpen = true } },
  { id: 'theme', group: '操作', icon: 'lightbulb', title: '切换深浅主题', action: () => setTheme(store.ui.theme === 'light' ? 'dark' : 'light') },
  /* 页面（导航）—— v291（2026-09-27）：**每一条都走 `canSee(path)`**，判据唯一实现在
     `constants/pages.js` 的页面注册表（侧栏、路由守卫读的是同一份表）。
     🔴 为什么这里一条都不能漏：命令面板是**第二组入口**。侧栏藏了、这里还搜得到，
        就是"假入口"的回归 —— 用户 ⌘⇧K 搜到「定时任务」、点进去被弹回工作台，
        只会以为系统坏了（v267 修过的正是这一类）。
     ⚠️ 旧写法是逐条自己配 `module` / `when`（v206 起）：14 条页面里只有 2 条真正配上，
        而配上的那 2 条**也拦不住** —— 员工持有 `data`（报单要用），`data` 又覆盖 83 个接口。
        现在统一查表，"哪条忘了配"在结构上不可能发生。 */
  { id: 'workbench', group: '页面', icon: 'grid', title: '经营工作台', path: '/workbench',
    when: () => canSee('/workbench') },
  { id: 'forecast', group: '页面', icon: 'activity', title: '预报订单管理', path: '/forecast',
    when: () => canSee('/forecast') },
  { id: 'rebate', group: '页面', icon: 'target', title: '目标与返利', path: '/rebate',
    when: () => canSee('/rebate') },
  // 商品目标已收进「预报订货管理」当第 4 个页签 ⇒ 直指页签（少一跳 redirect）。
  // 判据同 /forecast（ruleFor 会剥掉 `?tab=target` 再查表）。
  { id: 'product-target', group: '页面', icon: 'bars', title: '商品目标', path: '/forecast?tab=target',
    when: () => canSee('/forecast') },
  { id: 'dashboard', group: '页面', icon: 'sort', title: '经营趋势', path: '/dashboard',
    when: () => canSee('/dashboard') },
  // v311：「能力中心」已更名「AI 引擎」（路由仍是 `/connect`）。
  { id: 'connect', group: '页面', icon: 'brain', title: 'AI 引擎', path: '/connect',
    when: () => canSee('/connect') },
  /* v311：两个「已并入容器当页签」的页面，这里**各留一条直达**（不删）。
     🔴 命令面板是**第二组入口**，判据与侧栏同源（`canSee`）—— 侧栏藏了、这里还搜得到，
        就是"假入口"回归（用户 ⌘⇧K 搜到、点进去被弹回工作台）。
     ⚠️ 它们现在**没有侧栏项**，与 `/roles`（AI 团队）同构：有路由、靠容器页签进入，
        但命令面板里仍单独可搜 —— 目的是"知道名字就能直达"，不必先想起它在哪个容器下。
     ⚠️ 路径分别指向 `/archive/prices`（旧 `/price-channels` 已 redirect）与 `/ai-hub`（活路由）。 */
  { id: 'archive-prices', group: '页面', icon: 'template', title: '渠道与价格', path: '/archive/prices',
    when: () => canSee('/archive/prices') },
  { id: 'ai-hub', group: '页面', icon: 'sparkle', title: '产出与用量', path: '/ai-hub',
    when: () => canSee('/ai-hub') },
  { id: 'roles', group: '页面', icon: 'users', title: 'AI 团队', path: '/roles',
    when: () => canSee('/roles') },
  { id: 'loss-accounting', group: '页面', icon: 'receipt', title: '货损核算', path: '/loss-accounting',
    when: () => canSee('/loss-accounting') },
  { id: 'payroll', group: '页面', icon: 'coins', title: '算工资工作流', path: '/payroll',
    when: () => canSee('/payroll') },
  { id: 'data-fill', group: '页面', icon: 'package', title: '库存效期补录', path: '/data-fill',
    when: () => canSee('/data-fill') },
  { id: 'archive', group: '页面', icon: 'book', title: '档案管理', path: '/archive/employees',
    when: () => canSee('/archive') },
  { id: 'cron', group: '页面', icon: 'clock', title: '定时任务', path: '/cron',
    when: () => canSee('/cron') },
  { id: 'settings', group: '页面', icon: 'settings', title: '设置', path: '/settings',
    when: () => canSee('/settings') },
  { id: 'bid-radar', group: '页面', icon: 'search', title: '招投标雷达', path: '/bid-radar',
    when: () => canSee('/bid-radar') }
]

const filtered = computed(() => {
  /* v206：先按权限收窄（未配 module 的条目一律保留），再按关键词过滤。
     v267：加**第二条轴** `when`（角色级门禁）。为什么要新轴而不是复用 `module`：
       `module` 只能表达「本租户有没有这个模块」，表达不了「同一模块下按角色区分」——
       报单汇总正是后者（`/api/forecast` 归 `data`，业务员持有 `data`；v347 起该前缀
       已改归窄模块 `forecast`，但**这不改变本轴的结论** —— 同一模块下仍可能按角色区分）。 */
  const pool = COMMANDS.filter(c => (!c.module || store.canModule(c.module)) && (!c.when || c.when()))
  const kw = q.value.trim().toLowerCase()
  if (!kw) return pool
  return pool.filter(c => c.title.toLowerCase().includes(kw) || (c.keywords || '').includes(kw))
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
/* v136：全局模态层基准 1130。原 1000 低于预报页 .tb-pop(1120)，命令面板打开时
   工具栏按钮浮在其上、可点穿（同 .pf-mask / .md-sheet 同批修正）。 */
.cmd-mask{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:1130;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
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
