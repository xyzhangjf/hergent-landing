<template>
  <div class="page">
    <div class="panel-hd">
      <div>
        <b>定时任务</b>
        <p class="sub">AI 副驾的定时任务，由 Hermes 引擎调度，到点自动执行</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">新建任务</button>
    </div>

    <div v-if="loading" class="skel-line" style="margin-bottom:12px"></div>
    <div v-else-if="error" class="state-error">{{ error }}</div>
    <div v-else-if="!jobs.length" class="state-empty">
      <div class="se-ic">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
      </div>
      还没有定时任务。点「新建任务」，让 AI 副驾每天自动帮你干活。
    </div>
    <div v-else class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr><th>任务</th><th>定时</th><th>状态</th><th>下次运行</th><th style="text-align:right">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="j in jobs" :key="j.id">
            <td>{{ j.name || '(未命名)' }}</td>
            <td class="num">{{ scheduleLabel(j) }}</td>
            <td><span class="tag" :class="isPaused(j) ? 'bad' : 'ok'">{{ isPaused(j) ? '已暂停' : '运行中' }}</span></td>
            <td class="num">{{ j.next_run_at || '—' }}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="tb-btn" @click="toggle(j)" :title="isPaused(j) ? '恢复' : '暂停'">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <template v-if="isPaused(j)"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></template>
                  <template v-else><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></template>
                </svg>
              </button>
              <button class="tb-btn" @click="remove(j)" title="删除">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showCreate" class="cron-overlay" @click.self="showCreate=false">
          <div class="cron-modal">
            <div class="panel-hd"><b>新建定时任务</b><button class="tb-btn" @click="showCreate=false">✕</button></div>
            <div class="field">
              <label>任务名称</label>
              <input v-model="form.name" class="input" placeholder="例如：每日经营晨报">
            </div>
            <div class="field">
              <label>执行时间</label>
              <div class="chips">
                <button v-for="p in presets" :key="p.cron" class="chip" :class="{on: form.schedule===p.cron}" @click="form.schedule=p.cron">{{ p.label }}</button>
              </div>
            </div>
            <div class="field">
              <label>Cron 表达式（自定义）</label>
              <input v-model="form.schedule" class="input" placeholder="分 时 日 月 星期，如 0 6 * * *">
            </div>
            <div class="field">
              <label>任务指令（让 AI 副驾做什么）</label>
              <textarea v-model="form.prompt" class="input" rows="4" placeholder="例如：生成今日经营要务，综合库存预警、应收逾期、流失风险，用中文汇报"></textarea>
            </div>
            <button class="btn btn-primary btn-block" :disabled="creating" @click="create">{{ creating ? '创建中…' : '创建' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api/client'
import { toast } from '../store'

const jobs = ref([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const creating = ref(false)
const form = ref({ name: '', schedule: '0 6 * * *', prompt: '' })

const presets = [
  { label: '每天 6:00', cron: '0 6 * * *' },
  { label: '每天 8:00', cron: '0 8 * * *' },
  { label: '每天 20:00', cron: '0 20 * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每周一 8:00', cron: '0 8 * * 1' }
]

function scheduleLabel(j) {
  return j.schedule_display || (j.schedule && (j.schedule.value || (typeof j.schedule === 'string' ? j.schedule : ''))) || j.schedule || '—'
}

function isPaused(j) {
  return j.state === 'paused' || j.enabled === false
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api('/api/cron/jobs')
    jobs.value = (r && r.jobs) || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.value = { name: '', schedule: '0 6 * * *', prompt: '' }
  showCreate.value = true
}

async function create() {
  if (!form.value.prompt.trim()) { toast('请填写任务指令', 'error'); return }
  creating.value = true
  try {
    await api('/api/cron/jobs', { method: 'POST', body: { name: form.value.name, schedule: form.value.schedule, prompt: form.value.prompt } })
    toast('任务已创建', 'success')
    showCreate.value = false
    load()
  } catch (e) {
    toast(e.message || '创建失败', 'error')
  } finally {
    creating.value = false
  }
}

async function toggle(j) {
  const act = isPaused(j) ? 'resume' : 'pause'
  try {
    await api(`/api/cron/jobs/${j.id}/${act}`, { method: 'POST' })
    toast(isPaused(j) ? '已恢复' : '已暂停', 'success')
    load()
  } catch (e) {
    toast(e.message || '操作失败', 'error')
  }
}

async function remove(j) {
  if (!confirm(`确定删除任务「${j.name || '(未命名)'}」？`)) return
  try {
    await api(`/api/cron/jobs/${j.id}`, { method: 'DELETE' })
    toast('已删除', 'success')
    load()
  } catch (e) {
    toast(e.message || '删除失败', 'error')
  }
}

onMounted(load)
</script>

<style scoped>
.page{max-width:900px}
.sub{font-size:12px;color:var(--t3);margin:2px 0 0}
.tb-btn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2);cursor:pointer}
.tb-btn:hover{background:var(--bg2);color:var(--dan)}
.cron-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:950;display:flex;align-items:center;justify-content:center;padding:20px}
.cron-modal{width:440px;max-width:100%;background:var(--bg);border-radius:16px;padding:20px 22px;box-shadow:var(--shadow-lg)}
.field{margin-bottom:14px}
.field label{display:block;font-size:12px;color:var(--t2);margin-bottom:6px}
.field textarea{height:auto;resize:vertical;padding:10px 14px;line-height:1.6}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.chip{padding:6px 12px;border:1px solid var(--bd);border-radius:16px;background:var(--bg3);color:var(--t2);font-size:12px;cursor:pointer;transition:all .15s}
.chip:hover{border-color:var(--p-dark);color:var(--p-dark)}
.chip.on{background:var(--p-bg);border-color:var(--p-dark);color:var(--p-dark);font-weight:500}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
</style>
