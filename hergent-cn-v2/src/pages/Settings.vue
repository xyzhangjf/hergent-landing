<template>
  <div class="page">
    <!-- 模块级标签页（沿用「预报订单管理」的 module-tabs 导航） -->
    <div class="module-tabs">
      <button :class="{ on: tab === 'account' }" @click="tab = 'account'">账号与组织</button>
      <button :class="{ on: tab === 'perm' }" @click="switchTab('perm')">权限</button>
      <button :class="{ on: tab === 'ai' }" @click="switchTab('ai')">AI 配置</button>
      <button :class="{ on: tab === 'aiops' }" @click="tab = 'aiops'">AI 运维</button>
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
          <Icon name="alert-triangle"/> 为防止把自己锁在门外，<b>老板</b> 与 <b>管理员</b> 的「员工管理」「档案管理」为必选、不可取消 —— 本设置页本身依赖这两个模块。
        </p>

        <!-- 🔴 v296：这两段文案是**功能的一部分**，不是装饰。
             权限页最容易犯的错是「许诺一件它兑现不了的事」——老板勾了一个模块、界面没变，
             就会认定系统坏了（而系统一声不吭）。所以这里必须把"勾选到底控制什么"、
             "哪些页面不受影响"、"多久生效"三件事说成事实。 -->
        <p class="pm-tip">
          勾选控制两件事：① 该角色能不能调用这个模块下的<b>功能接口</b>；② 部分页面的<b>入口显隐</b>
          （经营趋势 / AI 中心 / 算工资 / 定时任务 / 招投标雷达）。
          保存后<b>立即生效</b>：本人菜单当场重排；已在别处登录的人最迟 1 分钟内跟随。
        </p>
        <p class="pm-tip">
          ✅ <b>「档案管理」与「定时任务」已经分开</b>（v296 起）：勾「档案管理」
          <b>不会</b>再连带放开「定时任务」或「招投标雷达」—— 它们各自有独立的勾选项，
          想开哪个就勾哪个。（在此之前「档案管理」一个勾会同时管到这三样。）
          另需知道：这三页还各有一层<b>产品内置的角色门槛</b>，只有当某角色<b>被改动过权限</b>时，
          该门槛才会让位给您这里的勾选 —— 所以给「会计」勾上「定时任务」，她就真的能看到。
        </p>
        <p class="pm-tip">
          <b>产品内置、不受此处勾选影响</b>：预报订货管理、目标与返利、货损计算工作流、货损核算、
          库存效期补录、档案管理、渠道与价格、能力中心、舟谱单据导入、设置、AI 团队。
          —— 这些页面要么没有独立的权限模块（勾了也无处生效），要么就是「改权限」这件事本身。
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
          <b>AI 副驾连接</b>
          <span class="page-sub">AI 经营副驾由 Hermes Agent 提供</span>
        </div>
        <p class="set-desc">副驾经本系统服务端转发，网关凭据由服务端保管，无需在此填写。</p>
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
            <button class="mem-del" @click="removeMemory('user', i)" title="删除"><Icon name="close"/></button>
          </div>
        </div>

        <div class="mem-block">
          <div class="mem-hd"><span class="mem-tag agent">AI 的笔记</span><span class="mem-count">{{ memAgent.length }} 条</span></div>
          <div v-if="!memAgent.length" class="mem-empty">AI 还没有自己的笔记，它会随着使用自动沉淀行业规则。</div>
          <div v-for="(m, i) in memAgent" :key="'a' + i" class="mem-item">
            <span class="mem-text">{{ m }}</span>
            <button class="mem-del" @click="removeMemory('memory', i)" title="删除"><Icon name="close"/></button>
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

    <!-- ==================== AI 运维（备份/健康/审计/路由/兜底/配方IO） ==================== -->
    <template v-if="tab === 'aiops'">
      <AiOps />
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
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { store, setTheme, toast } from '../store'
import { api } from '../api/client'
import Icon from '../components/Icon.vue'
import AiOps from './AiOps.vue'

const router = useRouter()
const rtab = useRoute()

/* ---- 模块级标签页 ---- */
const tab = ref('account')
function switchTab(t) {
  tab.value = t
  if (t === 'perm') loadPerms()
  if (t === 'ai') loadMemory()
}

/* ---- AI 副驾连接检测 ----
   🔴 v281（2026-09-26）：原先这里让用户**在前端填网关 Bearer Key** 并存 localStorage，
   「测试连接」直接打 `/hermes/v1/models`。两处都已改：
     ① 那条 `/hermes/` 直通因「对公网无鉴权、且带 terminal/file 工具集」已被 nginx 封堵（403）；
     ② 网关凭据改为**只由服务端保管**（后端经 127.0.0.1 直连，`.env` 提供）⇒ 前端不该也不需要 Key。
   检测改为打后端**真实链路**（`/api/ai/skills` 会真正调用上游网关，403/失败会明确暴露）。 */
const testResult = ref('')
const testOk = ref(false)

async function test() {
  testResult.value = '测试中…'
  testOk.value = false
  try {
    const d = await api('/api/ai/skills')
    const ok = !!(d && d.ok !== false && d.success !== false)
    testOk.value = ok
    testResult.value = ok ? '连接正常' : '连接失败：上游网关无响应'
  } catch (e) {
    testOk.value = false
    testResult.value = (e && e.message) ? String(e.message) : '无法连接 AI 服务'
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
  // v307 分销商：外部客户，默认只给 `data`（够跑通小程序报单），且默认只开小程序登录。
  distributor: '分销商（外部客户）',
}
const ROLE_DESCS = {
  admin: '全部权限（不可修改）', boss: '全部模块', accountant: '财务相关', sales: '销售 + 采购 + 库存',
  guide: '销售 + 库存', driver: '看板 + 库存', staff: '填报 + AI 对话', supervisor: '审批 + 数据',
  distributor: '仅报单（外部客户）',
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

/* 权限值有两种合法形态（见后端 `core._DEFAULT_PERMS` 注释）：
     · legacy list：`["stock","data"]`
     · 新版 dict  ：`{"stock":["read","create"]}`
   本页只按**模块**勾选，两种形态都归一成模块名数组（丢动作粒度，因为动作粒度不影响任何入口显隐）。
   🔴 归一必须容错：`[...(v.permissions || [])]` 遇到 dict 会**直接抛**
      "object is not iterable" ⇒ 整个 `loadPerms` 落进 catch ⇒ 权限页一片空白 +
      只留一句"权限加载失败"。而这只在"某些租户用过 CRUD 级权限接口（/detail）"时才出现，
      本地无论如何复现不出 —— 属最难查的那类缺陷。 */
function permsToModules(v) {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string')
  if (v && typeof v === 'object') return Object.keys(v)
  return []
}

async function loadPerms() {
  permLoading.value = true
  try {
    const [r, m] = await Promise.all([api('/api/role-permissions'), api('/api/permissions/modules')])
    modules.value = m.modules || []
    const known = new Set(modules.value.map(x => x.id))
    permRoles.value = Object.entries(r.roles || {})
      .map(([name, v]) => ({
        name,
        perms: permsToModules(v.permissions).filter(p => p !== '*'),
        is_custom: v.is_custom,
      }))
      .filter(x => !LOCKED_ROLES.includes(x.name))
      .map(role => {
        /* 🔴 v296：这里**不再**丢弃"本页没有对应行的模块"（原为
           `filter(p => known.has(p) || p === 'dashboard')`）。
           原写法看着像"清理历史脏数据"，实际是**静默数据丢失**：`core._ALL_MODULES` 只有 15 项，
           而 `_DEFAULT_PERMS` 里还用着 `ops-workbench` / `perf` / `goals` 三个**未登记**的模块
           （`boss` 默认就持有它们）⇒ 老板只要点一次「保存权限」，这三个模块就被从租户库里**抹掉**，
           且全链路零报错 —— 因为 POST 回去的正是被过滤后的那份列表（自己弄丢、自己说没问题）。
           正确做法是「不认识 ≠ 丢掉」：未知模块**保留在数组里**（它只用于回传，不会被渲染成行，
           因为行是由 `modules` 渲染的）⇒ 保存时逐字回传，一个字节都不改。
           若日后要让它可配，正确动作是把它加进后端 `_ALL_MODULES` 并补中文标签，而不是在这里过滤。 */
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

/* v296：保存/恢复后**必须把本会话的权限重新拉一遍**。改前没有这一步 ——
   `store.perms` 仍是旧值 ⇒ 侧栏 24 处 `canSee()` 全部按旧权限渲染，老板改完看着菜单没变，
   会以为"没保存上"；而系统给出的提示偏偏写着「权限已保存，立即生效」= **一句假承诺**。
   这是最容易被原谅、也最伤信任的一类缺陷：它不报错，它撒谎。
   🔴 用 `loadPerms(true)` 而**不是** `resetPerms()` + `loadPerms()`：后者会先把 `user.role`
      清空，而"角色未知 = fail-open"会让菜单**先全显一遍**再收窄（闪一屏，观感更糟）。 */
async function syncStorePerms() {
  try {
    await store.loadPerms(true)
  } catch (_) {}
  return !!store.perms
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
    if (await syncStorePerms()) {
      toast('权限已保存，菜单与入口已同步更新', 'success')
    } else {
      // 拉不回来（网络/401）⇒ 老实说"没核对上"，别继续许诺"已生效"。
      toast('权限已保存；但本机菜单未能刷新，请刷新页面确认', 'warn')
    }
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
    // v296：恢复默认同样是一次权限变更（而且会撤掉该角色的"让位"资格）⇒ 一样要同步本会话。
    await syncStorePerms()
    toast('已恢复默认权限，菜单与入口已同步更新', 'success')
  } catch (e) {
    toast('恢复失败：' + (e.message || ''), 'error')
  }
}

/* ---- 其它 ---- */
function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

onMounted(() => {
  loadMemory()
  // 支持 ?tab=aiops 深链（AI 中心页的「设置 › AI 运维」入口）
  // 🔴 白名单里**不再有 'onboard'** —— 该标签页已移除（多租户开通改由管理后台负责）。
  //   旧书签 `?tab=onboard` 会落到默认标签页，不会白屏。
  const q = rtab.query && rtab.query.tab
  if (q && ['account', 'perm', 'ai', 'aiops', 'system'].includes(q)) switchTab(q)
})
</script>

<style scoped>
/* 卡片内距由全局 .card{padding:18px} 兜底（见 variables.css「通用卡片」），
   本页不再重复定义；下方 .toolbar 的 14px 16px 为工具栏专用紧凑间距，特异性更高、保持覆盖。 */

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
/* 胶囊 + 内层无边框 input：焦点反馈挂胶囊整体，避免全局 .fld:focus 光晕悬空浮在胶囊内（同 Forecast） */
.tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:var(--bg3);border:1px solid var(--bd);border-radius:8px;color:var(--t2);transition:border-color .2s,box-shadow .2s}
.tb-search:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 3px var(--p-bg)}
.tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;color:var(--t1);width:150px;height:100%}
.tb-search .fld:focus{box-shadow:none}
.tb-search .fld::placeholder{color:var(--t3)}

/* 全局无定义的类，本页补齐（沿用各页面统一口径） */
.btn-mini{border:1px solid var(--bd);background:none;border-radius:6px;padding:3px 10px;font-size:12px;color:var(--t2);cursor:pointer}
.btn-mini:hover{border-color:var(--p);color:var(--p-dark)}

/* 通用行 / 描述：允许换行 + 子项可收缩，避免长文本/输入框顶破卡片 */
.set-row{display:flex;align-items:center;gap:10px;padding:8px 0;flex-wrap:wrap}
.set-row>.input{flex:1 1 240px;width:auto;min-width:0}
.set-row>.set-desc{flex:1 1 260px;min-width:0}
.set-lb{display:inline-block;min-width:88px;font-size:13px;color:var(--t2)}
.set-desc{font-size:12px;color:var(--t3);margin:0;line-height:1.7}
.set-result{font-size:12.5px}
.set-result.ok{color:var(--suc)}
.set-result.bad{color:var(--dan)}

/* 卡片头：标题与副标题分列两端，长副标题时允许换行而不是撑破 */
.panel-hd{gap:10px;flex-wrap:wrap}
.panel-hd>.page-sub{min-width:0;text-align:right}

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
.mem-text{flex:1;min-width:0;font-size:12.5px;color:var(--t1);line-height:1.6;word-break:break-word}
.mem-del{border:none;background:none;color:var(--t3);cursor:pointer;font-size:13px}
.mem-del:hover{color:var(--dan)}
.mem-danger{color:var(--dan)}

</style>
