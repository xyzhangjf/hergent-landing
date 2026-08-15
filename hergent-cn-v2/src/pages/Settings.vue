<template>
  <div class="page">
    <div class="page-hd"><h2>设置</h2><span class="page-sub">账号 / 公司 / Hermes 连接 / AI 记忆</span></div>

    <div class="card set-panel">
      <div class="set-row">
        <div>
          <b>Hermes API 连接</b>
          <p class="set-desc">AI 经营副驾由 Hermes Agent 提供。填入 API server 的 Bearer Key（生产环境由部署方配置）。</p>
        </div>
      </div>
      <div class="set-row">
        <input v-model="key" class="input" type="password" placeholder="Hermes API Server Key（可选，存于本地浏览器）">
        <button class="btn btn-primary" @click="saveKey">保存</button>
      </div>
      <div class="set-row">
        <button class="btn btn-ghost" @click="test">测试连接</button>
        <span v-if="testResult" class="set-result" :class="testOk ? 'ok' : 'bad'">{{ testResult }}</span>
      </div>
    </div>

    <!-- AI 记忆管理 -->
    <div class="card set-panel">
      <div class="set-row" style="justify-content:space-between">
        <div>
          <b>AI 记忆</b>
          <p class="set-desc">AI 副驾记住了关于你的这些事，让回答更贴合你。你可以随时增删，也可以直接在对话里说「记住…」「忘掉…」。</p>
        </div>
        <button class="btn btn-ghost" @click="loadMemory">刷新</button>
      </div>

      <!-- 老板的偏好 -->
      <div class="mem-block">
        <div class="mem-hd"><span class="mem-tag user">老板的偏好</span><span class="mem-count">{{ memUser.length }} 条</span></div>
        <div v-if="!memUser.length" class="mem-empty">AI 还没记住你的偏好，试着在对话里说「记住：催款要礼貌」。</div>
        <div v-for="(m, i) in memUser" :key="'u' + i" class="mem-item">
          <span class="mem-text">{{ m }}</span>
          <button class="mem-del" @click="removeMemory('user', i)" title="删除">✕</button>
        </div>
      </div>

      <!-- AI 的笔记 -->
      <div class="mem-block">
        <div class="mem-hd"><span class="mem-tag agent">AI 的笔记</span><span class="mem-count">{{ memAgent.length }} 条</span></div>
        <div v-if="!memAgent.length" class="mem-empty">AI 还没有自己的笔记，它会随着使用自动沉淀行业规则。</div>
        <div v-for="(m, i) in memAgent" :key="'a' + i" class="mem-item">
          <span class="mem-text">{{ m }}</span>
          <button class="mem-del" @click="removeMemory('memory', i)" title="删除">✕</button>
        </div>
      </div>

      <!-- 手动添加 -->
      <div class="set-row">
        <input v-model="newMem" class="input" placeholder="手动告诉 AI 记住一件事，例如：催款要先礼后兵" @keydown.enter="addMemory">
        <button class="btn btn-primary" :disabled="!newMem.trim()" @click="addMemory">记住</button>
      </div>

      <div class="set-row">
        <button class="btn btn-ghost mem-danger" @click="resetMemory" :disabled="!memUser.length && !memAgent.length">清空全部记忆</button>
        <span class="set-desc">清空后 AI 会重新开始了解你</span>
      </div>
    </div>

    <div class="card set-panel">
      <div class="set-row"><b>主题</b>
        <button class="btn btn-ghost" @click="toggleTheme">切换为 {{ store.ui.theme === 'light' ? '深色' : '浅色' }}</button>
      </div>
      <div class="set-row"><b>账号</b><span class="set-desc">{{ store.user.name || '—' }}</span></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { store, setTheme, toast } from '../store'
import { api, hermesChat, setHermesKey } from '../api/client'

const key = ref('')
const testResult = ref('')
const testOk = ref(false)

/* ---- AI 记忆 ---- */
const memUser = ref([])
const memAgent = ref([])
const newMem = ref('')

function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

function saveKey() {
  localStorage.setItem('hermes_v2_key', key.value.trim())
  setHermesKey(key.value.trim())
  testResult.value = '已保存'
  testOk.value = true
}

async function test() {
  testResult.value = '测试中…'
  testOk.value = false
  try {
    const k = key.value.trim() || localStorage.getItem('hermes_v2_key') || ''
    const res = await fetch('/hermes/v1/models', {
      headers: k ? { Authorization: `Bearer ${k}` } : {}
    })
    testOk.value = res.ok
    testResult.value = res.ok ? '✅ Hermes 连接成功' : `❌ ${res.status}（请检查 Key / 服务）`
  } catch (e) {
    testResult.value = '❌ 无法连接 Hermes API server'
  }
}

async function loadMemory() {
  try {
    const d = await api('/api/memory')
    memUser.value = d.user || []
    memAgent.value = d.memory || []
  } catch (e) {
    toast('记忆读取失败：' + (e.message || '未知错误'), 'error')
  }
}

async function addMemory() {
  const c = newMem.value.trim()
  if (!c) return
  try {
    await api('/api/memory', { method: 'POST', body: { kind: 'user', content: c } })
    newMem.value = ''
    toast('已记住', 'success')
    loadMemory()
  } catch (e) {
    toast('保存失败：' + (e.message || '未知错误'), 'error')
  }
}

async function removeMemory(kind, index) {
  try {
    await api('/api/memory/remove', { method: 'POST', body: { kind, index } })
    loadMemory()
  } catch (e) {
    toast('删除失败：' + (e.message || '未知错误'), 'error')
  }
}

async function resetMemory() {
  if (!confirm('确定清空 AI 的全部记忆吗？清空后 AI 会重新开始了解你。')) return
  try {
    await api('/api/memory/reset', { method: 'POST' })
    loadMemory()
    toast('已清空记忆', 'success')
  } catch (e) {
    toast('清空失败：' + (e.message || '未知错误'), 'error')
  }
}

onMounted(() => {
  key.value = localStorage.getItem('hermes_v2_key') || ''
  loadMemory()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.set-panel{padding:20px;margin-bottom:14px;display:flex;flex-direction:column;gap:14px}
.set-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.set-row b{font-size:14px}
.set-desc{font-size:12px;color:var(--t3)}
.set-result{font-size:13px}
.set-result.ok{color:var(--suc)}
.set-result.bad{color:var(--dan)}

/* 记忆 */
.mem-block{display:flex;flex-direction:column;gap:8px}
.mem-hd{display:flex;align-items:center;gap:8px}
.mem-tag{font-size:12px;font-weight:500;padding:3px 10px;border-radius:10px}
.mem-tag.user{background:rgba(var(--p-rgb),.12);color:var(--p-dark)}
.mem-tag.agent{background:rgba(var(--war-rgb),.15);color:var(--war)}
.mem-count{font-size:12px;color:var(--t3)}
.mem-empty{font-size:12px;color:var(--t3);padding:10px 12px;background:var(--bg2);border-radius:10px}
.mem-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg)}
.mem-text{flex:1;font-size:13px;color:var(--t1);line-height:1.6;white-space:pre-wrap}
.mem-del{flex-shrink:0;width:22px;height:22px;border:none;background:none;border-radius:6px;color:var(--t3);cursor:pointer;font-size:13px;line-height:1}
.mem-del:hover{background:var(--dan);color:#fff}
.mem-danger{color:var(--dan);border-color:rgba(var(--dan-rgb),.3)}
.mem-danger:hover{background:rgba(var(--dan-rgb),.08)}
</style>
