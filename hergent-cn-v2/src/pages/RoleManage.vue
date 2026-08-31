<template>
  <div :class="embed ? 'rm-embed' : 'page'">
    <div class="page-hd">
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
          <button class="rm-av-btn" :title="r.custom_avatar ? '点击更换头像' : '点击上传头像'" @click="pickFile(r)">
            <img v-if="r.custom_avatar" :src="avatarUrl(r)" class="rm-av-img" alt="">
            <span v-else class="rm-av-emoji">{{ r.avatar || '🤖' }}</span>
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
          <div class="rm-sys">{{ r.system_prompt || '（无团队描述）' }}</div>
        </div>
        <div class="rm-ops">
          <label class="rm-switch" :title="r.is_active ? '点击停用' : '点击启用'">
            <input type="checkbox" :checked="!!r.is_active" @change="toggleActive(r, $event)">
            <span :class="r.is_active ? 'on' : 'off'">{{ r.is_active ? '启用中' : '已停用' }}</span>
          </label>
          <button v-if="!r.built_in" class="btn btn-ghost btn-sm" @click="openEdit(r)">编辑</button>
          <button v-if="!r.built_in" class="btn btn-ghost btn-sm rm-del" @click="remove(r)">删除</button>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑表单弹窗 -->
    <div v-if="showForm" class="rm-modal" @click.self="closeForm">
      <div class="rm-form">
        <div class="rm-form-hd">{{ editing ? '编辑团队' : '新建团队' }}
          <button class="rm-x" @click="closeForm">✕</button>
        </div>

        <label class="rm-fld">名称 <span class="rm-req">*</span>
          <input v-model="form.name" class="input" placeholder="如：采购专员" maxlength="20">
        </label>

        <div v-if="editing" class="rm-fld">头像
          <div class="rm-av-row">
            <button class="rm-av-btn sm" :title="editing.custom_avatar ? '更换头像' : '上传头像'" @click="pickFile(editing)">
              <img v-if="editing.custom_avatar" :src="avatarUrl(editing)" class="rm-av-img" alt="">
              <span v-else class="rm-av-emoji">{{ form.avatar || '🤖' }}</span>
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

    <!-- 按角色连接渠道弹窗 -->
    <div v-if="bindOpen" class="rm-modal" @click.self="closeBind">
      <div class="rm-form">
        <div class="rm-form-hd">{{ (bindRole && bindRole.name) || '' }} · 连接渠道
          <button class="rm-x" @click="closeBind">✕</button>
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

const sortedRoles = computed(() =>
  [...roles.value].sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99))
)

function avatarUrl(r) {
  return r.custom_avatar ? `/api/ai/roles/${r.role_id}/avatar?t=${bust.value}` : null
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

onMounted(load)
</script>

<style scoped>
.page-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600;margin:0 0 4px}
.page-sub{font-size:12px;color:var(--t3)}
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
.rm-req{color:var(--dan)}
.rm-av-in{width:90px}
.rm-ta{resize:vertical;line-height:1.6;font-family:inherit}
.rm-form-ops{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.rm-file{display:none}

/* 嵌入能力中心「专家」tab 时去掉外层 .page 内边距，避免嵌套双 padding */
.rm-embed{padding:0}
.rm-embed .page-hd{margin-bottom:16px}
</style>
