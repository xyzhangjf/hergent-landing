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

    <!-- 数据维护 -->
    <div class="card set-panel">
      <div class="set-row" style="justify-content:space-between">
        <div>
          <b>数据维护</b>
          <p class="set-desc">补录员工底薪、库存批次效期——工资和货损工作流就靠这些数据算准。</p>
        </div>
        <button class="btn btn-primary btn-sm" @click="router.push('/data-fill')">去补录数据</button>
      </div>
    </div>

    <!-- 角色权限配置 -->
    <div class="card set-panel">
      <div class="set-row" style="justify-content:space-between">
        <div>
          <b>角色权限</b>
          <p class="set-desc">给不同角色配置能访问的模块。给员工开账号时选角色，即按此权限生效。</p>
        </div>
        <span v-if="permSaving" class="page-sub">保存中…</span>
        <span v-else-if="permSaved" class="perm-saved">✓ 已保存</span>
      </div>

      <div v-if="permLoading" class="state-empty">加载角色权限…</div>
      <div v-else class="perm-list">
        <div v-for="role in permRoles" :key="role.name" class="perm-role" :class="{ 'perm-locked': !editableRole(role.name) }">
          <div class="perm-role-hd">
            <b>{{ roleLabel(role.name) }}</b>
            <span class="tag info">{{ roleDesc(role.name) }}</span>
            <button v-if="role.is_custom && editableRole(role.name)" class="btn btn-ghost btn-sm" @click="resetRole(role.name)" title="恢复默认">恢复默认</button>
          </div>
          <div class="perm-grid">
            <label v-for="m in modules" :key="m.id" class="perm-item" :class="{ off: !role.perms.includes(m.id) }">
              <input type="checkbox" :checked="role.perms.includes(m.id)" :disabled="!editableRole(role.name)" @change="togglePerm(role, m.id, $event)">
              <span>{{ m.label }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="set-row" style="justify-content:flex-end;margin-top:6px">
        <button class="btn btn-primary btn-sm" :disabled="permSaving || permLoading" @click="savePerms">保存权限配置</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { store, setTheme, toast } from '../store'
import { api, hermesChat, setHermesKey } from '../api/client'

const router = useRouter()
const key = ref('')
const testResult = ref('')
const testOk = ref(false)

/* ---- AI 记忆 ---- */
const memUser = ref([])
const memAgent = ref([])
const newMem = ref('')

/* ---- 角色权限 ---- */
const permRoles = ref([])
const modules = ref([])
const permLoading = ref(false)
const permSaving = ref(false)
const permSaved = ref(false)

const ROLE_LABELS = {
  admin: '系统管理员', boss: '老板（全权限）', accountant: '财务', sales: '业务员',
  guide: '导购', driver: '司机', staff: '员工（小程序）',
}
const ROLE_DESCS = {
  admin: '全部权限', boss: '全部模块', accountant: '财务相关', sales: '销售+采购+库存',
  guide: '销售+库存', driver: '看板+库存', staff: '填报+AI对话',
}
const LOCKED_ROLES = ['admin'] // admin 不允许改

function roleLabel(n) { return ROLE_LABELS[n] || n }
function roleDesc(n) { return ROLE_DESCS[n] || '' }
function editableRole(n) { return !LOCKED_ROLES.includes(n) }

async function loadPerms() {
  permLoading.value = true
  try {
    const [r, m] = await Promise.all([api('/api/role-permissions'), api('/api/permissions/modules')])
    permRoles.value = Object.entries(r.roles || {}).map(([name, v]) => ({
      name, perms: [...(v.permissions || [])].filter(p => p !== '*'), is_custom: v.is_custom,
    })).filter(x => x.name !== 'admin')
    modules.value = m.modules || []
    // 检查是否有未在模块表里的权限（如 ops-workbench）
    const known = new Set(modules.value.map(x => x.id))
    for (const role of permRoles.value) {
      role.perms = role.perms.filter(p => known.has(p) || p === 'dashboard')
    }
  } catch (e) { toast('加载权限失败：' + (e.message || ''), 'error') } finally { permLoading.value = false }
}

function togglePerm(role, mid, ev) {
  const on = ev.target.checked
  role.perms = on ? [...new Set([...role.perms, mid])] : role.perms.filter(p => p !== mid)
  permSaved.value = false
}

async function savePerms() {
  permSaving.value = true
  permSaved.value = false
  try {
    for (const role of permRoles.value) {
      await api(`/api/role-permissions`, { method: 'POST', body: { role_name: role.name, permissions: role.perms } })
    }
    permSaved.value = true
    toast('权限已保存，立即生效', 'ok')
    setTimeout(() => { permSaved.value = false }, 3000)
  } catch (e) { toast('保存失败：' + (e.message || ''), 'error') } finally { permSaving.value = false }
}

async function resetRole(name) {
  try {
    await api(`/api/role-permissions/${name}`, { method: 'DELETE' })
    await loadPerms()
    toast('已恢复默认权限', 'ok')
  } catch (e) { toast('恢复失败：' + (e.message || ''), 'error') }
}

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
  loadPerms()
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
/* 角色权限 */
.perm-list{display:flex;flex-direction:column;gap:14px}
.perm-role{border:1px solid var(--bd);border-radius:12px;padding:14px}
.perm-role.perm-locked{opacity:.55}
.perm-role-hd{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.perm-role-hd b{font-size:14px;color:var(--t1)}
.perm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.perm-item{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t2);cursor:pointer;padding:6px 8px;border-radius:8px;border:1px solid var(--border-subtle);transition:all .15s}
.perm-item:hover{background:var(--bg2)}
.perm-item input{accent-color:var(--p-dark)}
.perm-item.off{opacity:.5}
.perm-saved{font-size:12px;color:#2f9e44;font-weight:500}
</style>
