<template>
  <div :class="embed ? 'rm-embed' : 'page'">
    <div class="page-hd split">
      <div>
        <h2>AI 团队</h2>
        <span class="page-sub">配置副驾的不同 AI 团队。切换后对话自动带上对应专家视角，让 AI 更贴你的业务。</span>
      </div>
      <button class="btn btn-primary rm-new" @click="openNew">+ 新建团队</button>
    </div>

    <div v-if="loading" class="rm-state">加载团队…</div>
    <div v-else-if="!roles.length" class="rm-state rm-empty">还没有团队，点右上角「新建团队」创建一个专属 AI 角色。</div>

    <div v-else class="rm-list">
      <div v-for="r in sortedRoles" :key="r.role_id" class="rm-card" :class="{ off: !r.is_active }">
        <div class="rm-av-wrap">
          <button class="rm-av-btn" :title="r.custom_avatar ? '更换头像' : '上传头像'" @click="pickFile(r)">
            <RoleAvatar :role="r" img-class="rm-av-img" text-class="rm-av-emoji" fallback="🤖" :bust="bust" />
          </button>
        </div>
        <div class="rm-main">
          <div class="rm-name">
            {{ r.name }}
            <span v-if="r.built_in" class="tag info">内置</span>
            <span v-else class="tag">自定义</span>
          </div>
          <div class="rm-ch" v-if="linkedChannels(r).length">
            <span v-for="c in linkedChannels(r)" :key="c.key" class="rm-ch-badge" :class="'ch-' + c.key">
              <span class="rm-ch-ic">{{ c.key === 'wecom' ? '企' : '飞' }}</span>{{ c.name }}
            </span>
            <button class="rm-ch-edit" @click="openBind(r)">管理</button>
          </div>
          <div class="rm-ch" v-else>
            <button class="rm-ch-add" @click="openBind(r)">+ 连接渠道</button>
          </div>
          <div class="rm-open">{{ r.opening || '（无开场白）' }}</div>
          <!-- v319（L2）：能力摘要 —— 让"这个角色到底能干什么"在列表上就能看见，
               不必点进去。⚠️ 未配置时显示的是「继承」语义（全部技能包 / 随权限），
               不是"没有" —— 这两个字差别决定了老板会不会误以为功能坏了。 -->
          <div class="rm-caps">
            <span class="rm-cap" :class="'g-' + (r.guard || 'inherit')">{{ guardText(r) }}</span>
            <span class="rm-cap">{{ (r.skills && r.skills.length) ? (r.skills.length + ' 个技能包') : '全部技能包' }}</span>
            <span class="rm-cap">{{ (r.data_scope && r.data_scope.length) ? (r.data_scope.length + ' 个数据域') : '数据范围随权限' }}</span>
          </div>
          <div class="rm-sys">{{ r.system_prompt || '（无团队描述）' }}</div>
        </div>
        <div class="rm-ops">
          <label class="rm-switch" :title="r.is_active ? '停用' : '启用'">
            <input type="checkbox" :checked="!!r.is_active" @change="toggleActive(r, $event)">
            <span :class="r.is_active ? 'on' : 'off'">{{ r.is_active ? '启用中' : '已停用' }}</span>
          </label>
          <button class="btn btn-ghost btn-sm" @click="openCaps(r)">能力</button>
          <button v-if="!r.built_in" class="btn btn-ghost btn-sm" @click="openEdit(r)">编辑</button>
          <button v-if="!r.built_in" class="btn btn-ghost btn-sm rm-del" @click="remove(r)">删除</button>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑表单弹窗 -->
    <div v-if="showForm" class="rm-modal" @click.self="closeForm">
      <div class="rm-form">
        <div class="rm-form-hd">{{ editing ? '编辑团队' : '新建团队' }}
          <button class="rm-x" @click="closeForm"><Icon name="close"/></button>
        </div>

        <label class="rm-fld">名称 <span class="rm-req">*</span>
          <input v-model="form.name" class="input" placeholder="如：采购专员" maxlength="20">
        </label>

        <div v-if="editing" class="rm-fld">头像
          <div class="rm-av-row">
            <button class="rm-av-btn sm" :title="editing.custom_avatar ? '更换头像' : '上传头像'" @click="pickFile(editing)">
              <RoleAvatar :role="editingAvatarView" img-class="rm-av-img" text-class="rm-av-emoji" fallback="🤖" :bust="bust" />
            </button>
            <span class="rm-av-hint">点击上传自定义头像（自动裁剪为 256×256 正方形）。不传则显示下方 emoji。</span>
            <button v-if="editing.custom_avatar" class="rm-av-rm2" @click="removeAvatar(editing)">移除</button>
          </div>
        </div>

        <label class="rm-fld">默认头像（emoji，未上传自定义头像时显示）
          <input v-model="form.avatar" class="input rm-av-in" placeholder="🧑‍💼" maxlength="4">
        </label>

        <label class="rm-fld">开场白
          <input v-model="form.opening" class="input" placeholder="切换该团队时的一句引导语，例如：我是你的会计助理，随时帮你核账。">
        </label>

        <label class="rm-fld">团队描述（system prompt，核心）
          <textarea v-model="form.system_prompt" class="input rm-ta" rows="7"
            placeholder="描述这个角色的专家视角、职责边界、回答风格。例如：你是低温奶经销商的会计，专注银行流水与舟谱账户收支对账、厂家返利测算与冲档…"></textarea>
        </label>

        <div class="rm-form-ops">
          <button class="btn btn-ghost" @click="closeForm">取消</button>
          <button class="btn btn-primary" :disabled="!form.name.trim() || saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- v319（L2）：角色能力配置 —— 技能包 / 数据范围 / 权限档。
         🔴 这三项才是"角色切换"真正该有的差异（此前只有头像与人设措辞）。
            可选项全部来自后端 `/api/ai/role-catalog`，前端不写死。 -->
    <div v-if="capsOpen" class="rm-modal" @click.self="closeCaps">
      <div class="rm-form rm-caps-form">
        <div class="rm-form-hd">{{ (capsRole && capsRole.name) || '' }} · 能做什么
          <button class="rm-x" @click="closeCaps"><Icon name="close"/></button>
        </div>
        <p class="rm-caps-tip">这三项决定这个角色在对话里<b>能碰什么</b>。全部留空＝沿用当前设置（不做额外限制）。</p>

        <div class="rm-fld">能做哪些事（技能包）
          <div class="rm-chips">
            <label v-for="s in catalog.skills" :key="s.id" class="rm-chip"
              :class="{ on: capsForm.skills.includes(s.id) }" :title="s.desc">
              <input type="checkbox" :value="s.id" v-model="capsForm.skills">
              <span>{{ s.name }}</span>
            </label>
          </div>
        </div>

        <div class="rm-fld">能看哪些数据（数据范围）
          <div class="rm-chips">
            <label v-for="d in catalog.data_scope" :key="d.id" class="rm-chip"
              :class="{ on: capsForm.data_scope.includes(d.id) }">
              <input type="checkbox" :value="d.id" v-model="capsForm.data_scope">
              <span>{{ d.name }}</span>
            </label>
          </div>
          <div class="rm-hint">只在「这个角色想要的」超出「你自己的账号权限」时才会被自动收窄 —— 角色永远不能让你看到你本来没有的东西。</div>
        </div>

        <div class="rm-fld">怎么做事（执行档）
          <div class="rm-radios">
            <label class="rm-radio" :class="{ on: !capsForm.guard }" title="跟随租户的 AI 模式设置">
              <input type="radio" value="" v-model="capsForm.guard"><span>沿用全局</span>
            </label>
            <label v-for="g in catalog.guards" :key="g.id" class="rm-radio"
              :class="{ on: capsForm.guard === g.id }" :title="g.desc">
              <input type="radio" :value="g.id" v-model="capsForm.guard"><span>{{ g.name }}</span>
            </label>
          </div>
          <div class="rm-hint">「只给建议」会在服务端拒绝开单/收款等写操作 —— 不只是提示词上的约束。</div>
        </div>

        <div class="rm-form-ops">
          <button class="btn btn-ghost" @click="closeCaps">取消</button>
          <button class="btn btn-primary" :disabled="capsSaving" @click="saveCaps">
            {{ capsSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 按角色连接渠道弹窗 -->
    <div v-if="bindOpen" class="rm-modal" @click.self="closeBind">
      <div class="rm-form">
        <div class="rm-form-hd">{{ (bindRole && bindRole.name) || '' }} · 连接渠道
          <button class="rm-x" @click="closeBind"><Icon name="close"/></button>
        </div>
        <p class="rm-bind-tip">勾选该角色要推送到的渠道。保存后，这个 AI 角色的回复会推到对应手机。</p>
        <label class="rm-bind-row">
          <span class="rm-ch-ic ch-wecom">企</span>
          <span class="rm-bind-name">企业微信</span>
          <label class="switch" :class="{ on: bindForm.wecom }">
            <input type="checkbox" v-model="bindForm.wecom" />
            <span class="slider"></span>
          </label>
        </label>
        <label class="rm-bind-row">
          <span class="rm-ch-ic ch-feishu">飞</span>
          <span class="rm-bind-name">飞书</span>
          <label class="switch" :class="{ on: bindForm.feishu }">
            <input type="checkbox" v-model="bindForm.feishu" />
            <span class="slider"></span>
          </label>
        </label>
        <label class="rm-bind-row">
          <span class="rm-ch-ic ch-dingtalk">钉</span>
          <span class="rm-bind-name">钉钉</span>
          <label class="switch" :class="{ on: bindForm.dingtalk }">
            <input type="checkbox" v-model="bindForm.dingtalk" />
            <span class="slider"></span>
          </label>
        </label>
        <div class="rm-bind-scope">
          <span class="rm-bind-name">推送内容</span>
          <select v-model="bindForm.push_scope" class="rm-sel">
            <option value="all">全部（对话 + 经营卡）</option>
            <option value="card">仅经营卡（推荐，降噪）</option>
            <option value="reply">仅对话回复</option>
          </select>
        </div>
        <div class="rm-form-ops">
          <button class="btn btn-ghost" @click="closeBind">取消</button>
          <button class="btn btn-primary" @click="saveBind">保存</button>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept="image/*" class="rm-file" @change="onFile">
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import RoleAvatar from '../components/RoleAvatar.vue'   // v322：角色头像唯一渲染口
import { ref, computed, reactive, onMounted } from 'vue'
import { store, toast } from '../store'
import { api } from '../api/client'

const props = defineProps({ embed: { type: Boolean, default: false } })

const roles = ref([])
const loading = ref(false)
const showForm = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = ref({ name: '', avatar: '🧑‍💼', opening: '', system_prompt: '' })
const fileInput = ref(null)
const pendingRole = ref(null)
const bust = ref(0) // 头像缓存破坏，上传/移除后递增

// v322：编辑弹窗里的头像预览视图。
// 🔴 emoji 必须取 `form.value.avatar`（下方"头像 emoji"输入框的实时值），
//    不能用 `editing.avatar`（打开弹窗那一刻的快照）——否则用户在输入框里改 emoji，预览纹丝不动。
const editingAvatarView = computed(() => (editing.value ? {
  role_id: editing.value.role_id,
  custom_avatar: editing.value.custom_avatar,
  avatar: form.value.avatar
} : null))

const sortedRoles = computed(() =>
  [...roles.value].sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99))
)

/* v322：`avatarUrl()` 已删 —— 头像 URL 的计算收进 `RoleAvatar.vue`（唯一渲染口）。
   本页原来的两处 `<img v-if="custom_avatar">` 各写一遍判断，正是让别处漏写的成因。 */

/* ---- v319（L2）：角色能力三轴（技能包 / 数据范围 / 权限档）----
   可选项来自后端 `/api/ai/role-catalog`：技能包 id 必须与 Hermes 运行时的 skills 目录同名，
   写死在前端会在"Hermes 加了新技能包"时静默缺项（老板勾不到 ⇒ 以为没这个能力）。 */
const catalog = reactive({ skills: [], data_scope: [], guards: [] })
const capsOpen = ref(false)
const capsRole = ref(null)
const capsSaving = ref(false)
const capsForm = reactive({ skills: [], data_scope: [], guard: '' })

function guardText(r) {
  if (r.guard === 'advise') return '只给建议'
  if (r.guard === 'execute') return '可执行'
  return '执行档随全局'
}

async function loadCatalog() {
  try {
    const d = await api('/api/ai/role-catalog')
    catalog.skills = d.skills || []
    catalog.data_scope = d.data_scope || []
    catalog.guards = d.guards || []
  } catch (e) { /* 静默：目录拉不到只是配置面缺可选项，不影响角色本身 */ }
}

function openCaps(r) {
  capsRole.value = r
  // 🔴 深拷贝：直接引用 r.skills 会让弹窗里的勾选**当场改动列表**（取消也回不去）
  capsForm.skills = [...(r.skills || [])]
  capsForm.data_scope = [...(r.data_scope || [])]
  capsForm.guard = r.guard || ''
  capsOpen.value = true
}
function closeCaps() { capsOpen.value = false; capsRole.value = null }

async function saveCaps() {
  const r = capsRole.value
  if (!r) return
  capsSaving.value = true
  try {
    await api('/api/ai/roles/' + r.role_id, {
      method: 'PUT',
      body: { skills: capsForm.skills, data_scope: capsForm.data_scope, guard: capsForm.guard }
    })
    toast('已保存「' + r.name + '」的能力范围')
    await load()
    closeCaps()
  } catch (e) {
    toast('保存失败：' + (e.message || ''), 'error')
  } finally { capsSaving.value = false }
}

async function load() {
  loading.value = true
  try {
    const d = await api('/api/ai/roles')
    roles.value = (d.roles || d) || []
    await Promise.all(roles.value.map(loadRoleChannels))
  } catch (e) {
    toast('加载团队失败：' + (e.message || ''), 'error')
  } finally {
    loading.value = false
  }
}

/* 按角色连接：每个角色已连渠道 */
const roleChannels = reactive({})  // roleId -> { wecom: bool, feishu: bool }
const CH_META = { wecom: { name: '企业微信' }, feishu: { name: '飞书' }, dingtalk: { name: '钉钉' } }

async function loadRoleChannels(role) {
  try {
    const r = await api('/api/ai/roles/' + role.role_id + '/channels')
    const map = {}
    ;(r && r.channels || []).forEach(c => {
      map[c.channel] = !!c.connected
      if (c.role_config && c.role_config.push_scope) map.push_scope = c.role_config.push_scope
    })
    roleChannels[role.role_id] = map
  } catch (e) { roleChannels[role.role_id] = {} }
}

function linkedChannels(r) {
  const m = roleChannels[r.role_id] || {}
  return Object.keys(CH_META).filter(k => m[k]).map(k => ({ key: k, name: CH_META[k].name }))
}

/* 连接渠道弹窗 */
const bindOpen = ref(false)
const bindRole = ref(null)
const bindForm = reactive({ wecom: false, feishu: false, dingtalk: false, push_scope: 'all' })

function openBind(r) {
  bindRole.value = r
  const m = roleChannels[r.role_id] || {}
  bindForm.wecom = !!m.wecom
  bindForm.feishu = !!m.feishu
  bindForm.dingtalk = !!m.dingtalk
  bindForm.push_scope = m.push_scope || 'all'
  bindOpen.value = true
}
function closeBind() { bindOpen.value = false; bindRole.value = null }

async function saveBind() {
  const r = bindRole.value
  if (!r) return
  try {
    await api('/api/ai/roles/' + r.role_id + '/channels', {
      method: 'PUT',
      body: { items: [
        { channel: 'wecom', connected: bindForm.wecom, role_config: { push_scope: bindForm.push_scope } },
        { channel: 'feishu', connected: bindForm.feishu, role_config: { push_scope: bindForm.push_scope } },
        { channel: 'dingtalk', connected: bindForm.dingtalk, role_config: { push_scope: bindForm.push_scope } },
      ] }
    })
    if (!roleChannels[r.role_id]) roleChannels[r.role_id] = {}
    roleChannels[r.role_id].wecom = bindForm.wecom
    roleChannels[r.role_id].feishu = bindForm.feishu
    roleChannels[r.role_id].dingtalk = bindForm.dingtalk
    roleChannels[r.role_id].push_scope = bindForm.push_scope
    closeBind()
    toast('已更新渠道连接', 'ok')
  } catch (e) { toast('保存失败：' + (e.message || ''), 'error') }
}

function pickFile(r) {
  pendingRole.value = r
  fileInput.value && fileInput.value.click()
}

async function onFile(ev) {
  const file = ev.target.files && ev.target.files[0]
  ev.target.value = '' // 允许重复选同一文件
  const r = pendingRole.value
  pendingRole.value = null
  if (!file || !r) return
  if (file.size > 8 * 1024 * 1024) { toast('图片不能超过 8MB', 'error'); return }
  try {
    const dataUrl = await cropToSquare256(file)
    const b64 = dataUrl.split(',')[1]
    await api(`/api/ai/roles/${r.role_id}/avatar`, { method: 'POST', body: { filename: file.name, data: b64 } })
    r.custom_avatar = 1
    bust.value++
    toast('头像已更新', 'ok')
  } catch (e) {
    toast('头像上传失败：' + (e.message || ''), 'error')
  }
}

async function removeAvatar(r) {
  try {
    await api(`/api/ai/roles/${r.role_id}/avatar`, { method: 'DELETE' })
    r.custom_avatar = 0
    bust.value++
    toast('已移除自定义头像', 'ok')
  } catch (e) {
    toast('移除失败：' + (e.message || ''), 'error')
  }
}

// 与桌面版一致：裁剪为 256×256 正方形（cover 居中裁剪），输出 PNG dataURL
function cropToSquare256(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('裁剪失败'))
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result)
          fr.onerror = () => reject(new Error('编码失败'))
          fr.readAsDataURL(blob)
        }, 'image/png')
      }
      img.onerror = () => reject(new Error('图片读取失败'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function openNew() {
  editing.value = null
  form.value = { name: '', avatar: '🧑‍💼', opening: '', system_prompt: '' }
  showForm.value = true
}
function openEdit(r) {
  editing.value = r
  form.value = {
    name: r.name,
    avatar: r.avatar || '🧑‍💼',
    opening: r.opening || '',
    system_prompt: r.system_prompt || '',
  }
  showForm.value = true
}
function closeForm() {
  showForm.value = false
  editing.value = null
}

async function save() {
  if (!form.value.name.trim()) return
  saving.value = true
  try {
    if (editing.value) {
      await api(`/api/ai/roles/${editing.value.role_id}`, { method: 'PUT', body: { ...form.value } })
      toast('已保存', 'ok')
    } else {
      const res = await api('/api/ai/roles', { method: 'POST', body: { ...form.value } })
      if (res && res.role_id) editing.value = null
      toast('已创建', 'ok')
    }
    closeForm()
    await load()
  } catch (e) {
    toast('保存失败：' + (e.message || ''), 'error')
  } finally {
    saving.value = false
  }
}

async function toggleActive(r, ev) {
  const on = ev.target.checked ? 1 : 0
  const prev = r.is_active
  try {
    await api(`/api/ai/roles/${r.role_id}`, { method: 'PUT', body: { is_active: on } })
    r.is_active = on
    toast(on ? '已启用' : '已停用', 'ok')
  } catch (e) {
    ev.target.checked = !!prev
    toast('操作失败：' + (e.message || ''), 'error')
  }
}

async function remove(r) {
  if (!confirm(`确定删除团队「${r.name}」吗？删除后副驾切换菜单不再显示它。`)) return
  try {
    await api(`/api/ai/roles/${r.role_id}`, { method: 'DELETE' })
    toast('已删除', 'ok')
    await load()
  } catch (e) {
    toast('删除失败：' + (e.message || ''), 'error')
  }
}

onMounted(() => { load(); loadCatalog() })
</script>

<style scoped>
.rm-new{flex-shrink:0}
.rm-state{padding:40px;text-align:center;color:var(--t3);font-size:13px}
.rm-empty{background:var(--bg2);border-radius:12px}

.rm-list{display:flex;flex-direction:column;gap:12px}
.rm-card{display:flex;gap:14px;padding:16px;border:1px solid var(--bd);border-radius:14px;background:var(--bg);transition:opacity .15s}
.rm-card.off{opacity:.5}

.rm-av-wrap{position:relative;flex-shrink:0}
.rm-av-btn{width:46px;height:46px;border:1px dashed var(--bd);border-radius:12px;background:var(--bg2);cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:border-color .15s}
.rm-av-btn:hover{border-color:var(--p-dark)}
.rm-av-btn.sm{width:40px;height:40px}
.rm-av-img{width:100%;height:100%;object-fit:cover;display:block}
.rm-av-emoji{font-size:26px;line-height:1}

.rm-main{flex:1;min-width:0}
.rm-name{font-size:15px;font-weight:600;color:var(--t1);display:flex;align-items:center;gap:8px}
.tag{font-size:11px;font-weight:500;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t2)}
.tag.info{background:rgba(var(--p-rgb),.12);color:var(--p-dark)}
.rm-open{font-size:12px;color:var(--t3);margin-top:4px;line-height:1.5}
.rm-sys{font-size:13px;color:var(--t2);margin-top:6px;line-height:1.6;white-space:pre-wrap;max-height:84px;overflow:hidden}
.rm-ops{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0}
.rm-switch{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--t2)}
.rm-switch input{accent-color:var(--p-dark);width:16px;height:16px}
.rm-switch .on{color:var(--suc)}
.rm-switch .off{color:var(--t3)}
.rm-del{color:var(--dan);border-color:rgba(var(--dan-rgb),.3)}
.rm-del:hover{background:rgba(var(--dan-rgb),.08)}

.rm-ch{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
.rm-ch-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t2)}
.rm-ch-ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:4px;font-size:10px;color:#fff}
.ch-wecom .rm-ch-ic, .rm-ch-ic.ch-wecom{background:var(--p-dark)}
.ch-feishu .rm-ch-ic, .rm-ch-ic.ch-feishu{background:#1f6eff}
.ch-dingtalk .rm-ch-ic, .rm-ch-ic.ch-dingtalk{background:#00a0e9}
.rm-ch-edit{font-size:11px;color:var(--p-dark);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0}
.rm-ch-add{font-size:12px;color:var(--t2);background:var(--bg2);border:1px dashed var(--bd);border-radius:8px;padding:3px 10px;cursor:pointer}
.rm-ch-add:hover{border-color:var(--p-dark);color:var(--p-dark)}

.rm-bind-tip{font-size:12px;color:var(--t3);margin:0 0 14px;line-height:1.5}
.rm-bind-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border-subtle)}
.rm-bind-row:last-of-type{border-bottom:none}
.rm-bind-name{font-size:14px;font-weight:500;color:var(--t1);flex:1}
.rm-bind-scope{display:flex;align-items:center;gap:10px;padding:14px 0 4px}
.rm-sel{font-size:13px;padding:7px 10px;border:1px solid var(--bd);border-radius:9px;background:var(--bg2);color:var(--t1);cursor:pointer;flex:1}

/* 开关（本页 scoped，自包含） */
.switch{position:relative;width:40px;height:22px;flex-shrink:0;cursor:pointer;display:inline-block}
.switch input{opacity:0;width:0;height:0}
.switch .slider{position:absolute;inset:0;background:var(--bg3);border-radius:22px;transition:.2s}
.switch .slider::before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.switch.on .slider{background:var(--p-dark)}
.switch.on .slider::before{transform:translateX(18px)}

.rm-av-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rm-av-hint{font-size:12px;color:var(--t3);flex:1;min-width:160px}
.rm-av-rm2{font-size:12px;color:var(--dan);background:none;border:none;cursor:pointer;text-decoration:underline}

/* 弹窗 */
.rm-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px}
.rm-form{width:min(540px,94vw);max-height:90vh;overflow-y:auto;background:var(--bg);border:1px solid var(--bd);border-radius:18px;padding:22px;box-shadow:var(--shadow-lg)}
.rm-form-hd{display:flex;align-items:center;justify-content:space-between;font-size:16px;font-weight:600;color:var(--t1);margin-bottom:16px}
.rm-x{border:none;background:none;color:var(--t3);font-size:16px;cursor:pointer;line-height:1}
.rm-x:hover{color:var(--t1)}
.rm-fld{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--t2);margin-bottom:14px}

/* v319（L2）角色能力：列表上的能力摘要 + 能力配置弹窗 */
.rm-caps{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
.rm-cap{padding:1px 7px;border-radius:var(--radius-md);background:var(--bg2);border:1px solid var(--border-subtle);font-size:11px;color:var(--t3)}
.rm-cap.g-advise{color:var(--war)}
.rm-cap.g-execute{color:var(--suc)}
.rm-caps-form{max-width:560px}
.rm-caps-tip{margin:0 0 12px;font-size:12.5px;color:var(--t3);line-height:1.6}
.rm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.rm-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--bd);border-radius:var(--radius-md);font-size:12.5px;color:var(--t2);cursor:pointer;user-select:none}
.rm-chip input{display:none}
.rm-chip.on{border-color:var(--p);color:var(--p);background:var(--p-bg)}
.rm-radios{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.rm-radio{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--bd);border-radius:var(--radius-md);font-size:12.5px;color:var(--t2);cursor:pointer}
.rm-radio input{display:none}
.rm-radio.on{border-color:var(--p);color:var(--p);background:var(--p-bg)}
.rm-hint{margin-top:6px;font-size:11.5px;color:var(--t3);line-height:1.6}
.rm-req{color:var(--dan)}
.rm-av-in{width:90px}
.rm-ta{resize:vertical;line-height:1.6;font-family:inherit}
.rm-form-ops{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.rm-file{display:none}

/* 嵌入能力中心「专家」tab 时去掉外层 .page 内边距，避免嵌套双 padding */
.rm-embed{padding:0}
.rm-embed .page-hd{margin-bottom:16px}
</style>
