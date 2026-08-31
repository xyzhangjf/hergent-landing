<template>
  <div class="page">
    <!-- 模块级标签页（沿用「预报订单管理」的 module-tabs 导航） -->
    <div class="module-tabs">
      <button :class="{ on: tab === 'account' }" @click="tab = 'account'">账号与组织</button>
      <button :class="{ on: tab === 'perm' }" @click="switchTab('perm')">权限</button>
      <button :class="{ on: tab === 'ai' }" @click="switchTab('ai')">AI 配置</button>
      <button :class="{ on: tab === 'system' }" @click="tab = 'system'">数据与系统</button>
    </div>

    <!-- ==================== 账号与组织 ==================== -->
    <template v-if="tab === 'account'">
      <div class="card">
        <div class="panel-hd">
          <b>账号与组织</b>
          <span class="page-sub">当前登录账号与界面偏好</span>
        </div>
        <div class="set-row"><b class="set-lb">当前账号</b><span class="set-desc">{{ store.user.name || '—' }}</span></div>
        <div class="set-row">
          <b class="set-lb">界面主题</b>
          <button class="btn btn-sm btn-ghost" @click="toggleTheme">切换为 {{ store.ui.theme === 'light' ? '深色' : '浅色' }}</button>
        </div>
      </div>
    </template>

    <!-- ==================== 权限（仅角色权限矩阵；成员/账号归位「员工档案」） ==================== -->
    <template v-if="tab === 'perm'">
      <!-- 角色权限：角色 × 模块矩阵 -->
      <div class="card toolbar">
        <div class="tb-group">
          <span class="tb-title">角色权限</span>
          <span class="page-sub">勾选 = 该角色可查看，也可新增 / 修改 / 删除</span>
        </div>
        <div class="tb-group tb-right">
          <div class="tb-search">
            <Icon name="search"/>
            <input v-model="moduleQuery" class="fld" placeholder="搜索模块…" aria-label="搜索模块">
          </div>
          <button class="btn btn-sm btn-primary" :disabled="permSaving || permLoading" @click="savePerms">
            {{ permSaving ? '保存中…' : '保存权限' }}
          </button>
        </div>
      </div>

      <div class="card">
        <p class="pm-tip">
          ⚠️ 为防止把自己锁在门外，<b>老板</b> 与 <b>管理员</b> 的「员工管理」「档案管理」为必选、不可取消 —— 本设置页本身依赖这两个模块。
        </p>

        <div v-if="permLoading" class="state-empty"><div class="skel-line" style="width:40%;margin:0 auto"></div></div>
        <div v-else-if="!filteredModules.length" class="state-empty">没有匹配的模块</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="pm-mod-col">模块</th>
                <th v-for="role in permRoles" :key="role.name" class="ctr">
                  <div class="pm-col-hd">{{ roleLabel(role.name) }}</div>
                  <button
                    v-if="role.is_custom"
                    class="btn-mini"
                    @click="resetRole(role.name)"
                    title="恢复该角色的默认权限"
                  >恢复默认</button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in filteredModules" :key="m.id">
                <td>{{ m.label }}</td>
                <td v-for="role in permRoles" :key="role.name + '-' + m.id" class="ctr">
                  <input
                    type="checkbox"
                    :checked="roleHas(role, m.id)"
                    :disabled="isLockedModule(role.name, m.id)"
                    :title="isLockedModule(role.name, m.id) ? '必选项，不可取消' : ''"
                    @change="togglePerm(role, m.id, $event)"
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ==================== AI 配置 ==================== -->
    <template v-if="tab === 'ai'">
      <div class="card">
        <div class="panel-hd">
          <b>Hermes API 连接</b>
          <span class="page-sub">AI 经营副驾由 Hermes Agent 提供</span>
        </div>
        <p class="set-desc">填入 API server 的 Bearer Key（生产环境由部署方配置，存于本地浏览器）。</p>
        <div class="set-row">
          <input v-model="key" class="input" type="password" placeholder="Hermes API Server Key（可选）">
          <button class="btn btn-primary" @click="saveKey">保存</button>
        </div>
        <div class="set-row">
          <button class="btn btn-sm btn-ghost" @click="test">测试连接</button>
          <span v-if="testResult" class="set-result" :class="testOk ? 'ok' : 'bad'">{{ testResult }}</span>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="panel-hd" style="justify-content:space-between">
          <b>AI 记忆</b>
          <button class="btn btn-sm btn-ghost" @click="loadMemory">刷新</button>
        </div>
        <p class="set-desc">AI 副驾记住了关于你的这些事，让回答更贴合你。可随时增删，也可直接在对话里说「记住…」「忘掉…」。</p>

        <div class="mem-block">
          <div class="mem-hd"><span class="mem-tag user">老板的偏好</span><span class="mem-count">{{ memUser.length }} 条</span></div>
          <div v-if="!memUser.length" class="mem-empty">AI 还没记住你的偏好，试着在对话里说「记住：催款要礼貌」。</div>
          <div v-for="(m, i) in memUser" :key="'u' + i" class="mem-item">
            <span class="mem-text">{{ m }}</span>
            <button class="mem-del" @click="removeMemory('user', i)" title="删除">✕</button>
          </div>
        </div>

        <div class="mem-block">
          <div class="mem-hd"><span class="mem-tag agent">AI 的笔记</span><span class="mem-count">{{ memAgent.length }} 条</span></div>
          <div v-if="!memAgent.length" class="mem-empty">AI 还没有自己的笔记，它会随着使用自动沉淀行业规则。</div>
          <div v-for="(m, i) in memAgent" :key="'a' + i" class="mem-item">
            <span class="mem-text">{{ m }}</span>
            <button class="mem-del" @click="removeMemory('memory', i)" title="删除">✕</button>
          </div>
        </div>

        <div class="set-row">
          <input v-model="newMem" class="input" placeholder="手动告诉 AI 记住一件事，例如：催款要先礼后兵" @keydown.enter="addMemory">
          <button class="btn btn-primary" :disabled="!newMem.trim()" @click="addMemory">记住</button>
        </div>
        <div class="set-row">
          <button class="btn btn-sm btn-ghost mem-danger" @click="resetMemory" :disabled="!memUser.length && !memAgent.length">清空全部记忆</button>
          <span class="set-desc">清空后 AI 会重新开始了解你</span>
        </div>
      </div>
    </template>

    <!-- ==================== 数据与系统 ==================== -->
    <template v-if="tab === 'system'">
      <div class="card">
        <div class="panel-hd">
          <b>数据维护</b>
          <span class="page-sub">补录与校准计算所依赖的基础数据</span>
        </div>
        <div class="set-row" style="justify-content:space-between">
          <p class="set-desc">员工档案、客户档案在左侧「档案管理」中维护；此处用于补录库存批次效期 —— 货损和货损工作流就靠这些数据算准。</p>
          <button class="btn btn-sm btn-primary" @click="router.push('/data-fill')">库存效期补录</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { store, setTheme, toast } from '../store'
import { api, setHermesKey, hermesRequest } from '../api/client'
import Icon from '../components/Icon.vue'

const router = useRouter()

/* ---- 模块级标签页 ---- */
const tab = ref('account')
function switchTab(t) {
  tab.value = t
  if (t === 'perm') loadPerms()
  if (t === 'ai') loadMemory()
}

/* ---- Hermes API ---- */
const key = ref('')
const testResult = ref('')
const testOk = ref(false)

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
    // 走统一 Hermes REST 封装，复用同一套 Key 鉴权（不再裸 fetch）
    const res = await hermesRequest('/hermes/v1/models')
    testOk.value = res.ok
    testResult.value = res.ok ? '✅ Hermes 连接成功' : `❌ ${res.status}（请检查 Key / 服务）`
  } catch (e) {
    testResult.value = '❌ 无法连接 Hermes API server'
  }
}

/* ---- AI 记忆 ---- */
const memUser = ref([])
const memAgent = ref([])
const newMem = ref('')

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

/* ================= 权限：成员授权 + 角色权限矩阵 ================= */
const ROLE_LABELS = {
  admin: '系统管理员', boss: '老板（全权限）', accountant: '财务 / 文员', sales: '业务员',
  guide: '导购', driver: '司机', staff: '员工（小程序）', supervisor: '主管',
}
const ROLE_DESCS = {
  admin: '全部权限（不可修改）', boss: '全部模块', accountant: '财务相关', sales: '销售 + 采购 + 库存',
  guide: '销售 + 库存', driver: '看板 + 库存', staff: '填报 + AI 对话', supervisor: '审批 + 数据',
}
const LOCKED_ROLES = ['admin']                  // 管理员不可改，保留唯一兜底账号
// 本页依赖 /api/role-permissions(hr) 与 /api/users(data)；只有 admin/boss 能进入，
// 锁死这两个角色的 hr/data 即可杜绝"把自己锁在门外"。
const PROTECTED_ROLES = ['admin', 'boss']
const CRITICAL_MODULES = ['hr', 'data']

const permRoles = ref([])
const modules = ref([])
const permLoading = ref(false)
const permSaving = ref(false)
const moduleQuery = ref('')

function roleLabel(n) { return ROLE_LABELS[n] || n }
function isLockedModule(roleName, mid) {
  return PROTECTED_ROLES.includes(roleName) && CRITICAL_MODULES.includes(mid)
}
function roleHas(role, mid) { return role.perms.includes(mid) }

/* ---- 角色权限矩阵 ---- */
const filteredModules = computed(() => {
  const q = moduleQuery.value.trim().toLowerCase()
  if (!q) return modules.value
  return modules.value.filter(m => (m.label || '').toLowerCase().includes(q))
})

async function loadPerms() {
  permLoading.value = true
  try {
    const [r, m] = await Promise.all([api('/api/role-permissions'), api('/api/permissions/modules')])
    modules.value = m.modules || []
    const known = new Set(modules.value.map(x => x.id))
    permRoles.value = Object.entries(r.roles || {})
      .map(([name, v]) => ({
        name,
        perms: [...(v.permissions || [])].filter(p => p !== '*'),
        is_custom: v.is_custom,
      }))
      .filter(x => !LOCKED_ROLES.includes(x.name))
      .map(role => {
        // 只保留已知模块（历史数据可能残留 ops-workbench 等已下线项）
        role.perms = role.perms.filter(p => known.has(p) || p === 'dashboard')
        // 受保护角色强制补回关键模块，避免历史脏数据导致自锁
        if (PROTECTED_ROLES.includes(role.name)) {
          for (const c of CRITICAL_MODULES) {
            if (known.has(c) && !role.perms.includes(c)) role.perms.push(c)
          }
        }
        return role
      })
  } catch (e) {
    permRoles.value = []
    toast('权限加载失败：' + (e.message || ''), 'error')
  } finally {
    permLoading.value = false
  }
}

function togglePerm(role, mid, ev) {
  if (isLockedModule(role.name, mid)) return
  const on = ev.target.checked
  role.perms = on ? [...new Set([...role.perms, mid])] : role.perms.filter(p => p !== mid)
}

async function savePerms() {
  permSaving.value = true
  try {
    for (const role of permRoles.value) {
      await api('/api/role-permissions', {
        method: 'POST',
        body: { role_name: role.name, permissions: role.perms },
      })
    }
    toast('权限已保存，立即生效', 'success')
  } catch (e) {
    toast('保存失败：' + (e.message || ''), 'error')
  } finally {
    permSaving.value = false
  }
}

async function resetRole(name) {
  if (!confirm(`确认把「${roleLabel(name)}」的权限恢复为默认？`)) return
  try {
    await api(`/api/role-permissions/${name}`, { method: 'DELETE' })
    await loadPerms()
    toast('已恢复默认权限', 'success')
  } catch (e) {
    toast('恢复失败：' + (e.message || ''), 'error')
  }
}

/* ---- 其它 ---- */
function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

onMounted(() => {
  key.value = localStorage.getItem('hermes_v2_key') || ''
  loadMemory()
})
</script>

<style scoped>
/* 模块级标签页：与「预报订单管理」module-tabs 保持一致 */
.module-tabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--bd);padding-bottom:2px}
.module-tabs button{border:none;background:transparent;color:var(--t2);font-size:14px;font-weight:500;padding:8px 14px;border-radius:var(--radius-sm) var(--radius-sm) 0 0;cursor:pointer;position:relative}
.module-tabs button:hover{color:var(--p)}
.module-tabs button.on{color:var(--p);font-weight:600}
.module-tabs button.on::after{content:'';position:absolute;left:0;right:0;bottom:-3px;height:2px;background:var(--p);border-radius:2px}

/* 顶部筛选 / 搜索栏：沿用 Forecast 的 toolbar + tb-search */
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:12px}
.tb-title{font-size:13.5px;font-weight:600;color:var(--t1)}
.tb-right{margin-left:auto}
.tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:var(--bg3);border:1px solid var(--bd);border-radius:8px;color:var(--t2)}
.tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;color:var(--t1);width:150px}
.tb-search .fld::placeholder{color:var(--t3)}

/* 通用行 / 描述 */
.set-row{display:flex;align-items:center;gap:10px;padding:8px 0}
.set-lb{display:inline-block;min-width:88px;font-size:13px;color:var(--t2)}
.set-desc{font-size:12px;color:var(--t3);margin:0}
.set-result{font-size:12.5px}
.set-result.ok{color:var(--suc)}
.set-result.bad{color:var(--dan)}

/* 权限矩阵 */
.pm-tip{font-size:12.5px;color:var(--t2);margin:0 0 12px;padding:8px 12px;border-radius:var(--radius-md);background:var(--bg3)}
.pm-mod-col{min-width:120px}
.ctr{text-align:center}
.pm-col-hd{font-size:12.5px;font-weight:600;color:var(--t1);margin-bottom:4px}
.pm-me{margin-left:6px}
.pm-role{width:170px}

/* 分页：沿用 Forecast .pager */
.pager{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:12px}
.pager-info{color:var(--t2);margin-right:auto}

/* AI 记忆 */
.mem-block{margin:14px 0}
.mem-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.mem-tag{font-size:11.5px;padding:2px 8px;border-radius:10px}
.mem-tag.user{background:var(--p-bg);color:var(--p-dark)}
.mem-tag.agent{background:var(--bg3);color:var(--t2)}
.mem-count{font-size:11.5px;color:var(--t3)}
.mem-empty{font-size:12px;color:var(--t3);padding:8px 0}
.mem-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--radius-sm);background:var(--bg2);margin-bottom:6px}
.mem-text{flex:1;font-size:12.5px;color:var(--t1)}
.mem-del{border:none;background:none;color:var(--t3);cursor:pointer;font-size:13px}
.mem-del:hover{color:var(--dan)}
.mem-danger{color:var(--dan)}
</style>
