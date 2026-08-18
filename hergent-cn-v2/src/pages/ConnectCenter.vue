<template>
  <div class="page">
    <div class="page-hd">
      <h2>能力中心</h2>
      <span class="page-sub">AI 副驾的能力中枢：连接器 / AI 技能 / 工作流</span>
    </div>

    <!-- Tab 栏 -->
    <div class="cc-tabs">
      <button class="cc-tab" :class="{ active: tab === 'connector' }" @click="tab = 'connector'">连接器</button>
      <button class="cc-tab" :class="{ active: tab === 'expert' }" @click="tab = 'expert'">专家</button>
      <button class="cc-tab" :class="{ active: tab === 'skill' }" @click="tab = 'skill'">技能</button>
      <button class="cc-tab" :class="{ active: tab === 'evolution' }" @click="tab = 'evolution'; loadEvolution()">进化日志</button>
    </div>

    <!-- ===== 进化日志 Tab（AI 自进化可见化）===== -->
    <template v-if="tab === 'evolution'">
      <div class="cc-section">
        <div class="panel-hd">
          <b>AI 进化日志</b>
          <span class="page-sub">AI 副驾每周自我审查、持续进化——这是它最近做的事</span>
        </div>

        <!-- 总览 -->
        <div class="ev-stats">
          <div class="ev-stat"><b>{{ evSkills.total }}</b><span>行业技能</span></div>
          <div class="ev-stat"><b>{{ evRuns.length }}</b><span>进化轮次</span></div>
          <div class="ev-stat"><b>{{ evLastAt || '—' }}</b><span>最近进化</span></div>
        </div>

        <!-- 技能库 -->
        <div class="ev-skills" v-if="evSkills.items && evSkills.items.length">
          <div class="ev-sk-hd"><b>技能库（AI 的"行业经验"）</b><span class="page-sub">{{ evSkills.items.length }} 个已启用</span></div>
          <div class="ev-sk-grid">
            <div v-for="s in evSkills.items" :key="s.name" class="ev-sk">
              <span class="ev-sk-ic">🧠</span>
              <div>
                <div class="ev-sk-name">{{ s.title || s.name }}</div>
                <div class="ev-sk-sub">{{ s.name }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 进化记录 -->
        <div class="ev-runs" v-if="evRuns.length">
          <div class="ev-sk-hd"><b>最近进化记录</b></div>
          <div v-for="(r, i) in evRuns" :key="i" class="ev-run">
            <div class="ev-run-hd">
              <b>{{ fmtEvTime(r.started_at) }}</b>
              <span class="tag info">时长 {{ r.duration_seconds }}s</span>
              <span class="tag ok">技能 {{ r.counts?.before || 0 }} → {{ r.counts?.after || 0 }}</span>
            </div>
            <div class="ev-run-body" v-if="r.summary">{{ r.summary }}</div>
            <div class="ev-run-empty" v-else>本次进化未产生变化（AI 审查通过，无需改动）</div>
          </div>
        </div>
        <div v-else class="state-empty">暂无进化记录</div>
      </div>
    </template>

    <!-- ===== 连接器 Tab ===== -->
    <template v-if="tab === 'connector'">
      <div class="cc-section">
        <div class="panel-hd">
          <b>消息通道</b>
          <span class="page-sub">AI 干完活，直接推送到你的手机</span>
        </div>
        <div class="cc-grid">
          <!-- 企微 -->
          <div class="card cc-card" :class="{ linked: wecom.linked }" @click="openWecom">
            <div class="cc-card-top">
              <span class="cc-logo" :class="wecom.linked ? 'cc-logo-wecom' : ''">企</span>
              <span class="cc-state" :class="wecom.linked ? 'on' : ''">{{ wecom.linked ? '已连接' : '待授权' }}</span>
            </div>
            <div class="cc-name">企业微信</div>
            <div class="cc-desc">智能机器人推送 · 今日要务直达微信</div>
            <div class="cc-action" :class="wecom.linked ? 'ghost' : 'primary'">{{ wecom.linked ? '重新配置' : '去连接' }}</div>
          </div>
          <!-- 飞书 -->
          <div class="card cc-card disabled">
            <div class="cc-card-top">
              <span class="cc-logo">飞</span>
              <span class="cc-state">未连接</span>
            </div>
            <div class="cc-name">飞书</div>
            <div class="cc-desc">即将上线</div>
            <div class="cc-action ghost" @click.stop="toast('飞书接入即将上线', 'info')">敬请期待</div>
          </div>
          <!-- 钉钉 -->
          <div class="card cc-card disabled">
            <div class="cc-card-top">
              <span class="cc-logo">钉</span>
              <span class="cc-state">未连接</span>
            </div>
            <div class="cc-name">钉钉</div>
            <div class="cc-desc">即将上线</div>
            <div class="cc-action ghost" @click.stop="toast('钉钉接入即将上线', 'info')">敬请期待</div>
          </div>
        </div>
      </div>

      <div class="cc-section">
        <div class="panel-hd">
          <b>MCP 连接</b>
          <span class="page-sub">接入第三方工具与数据源</span>
        </div>
        <div class="cc-mcp" @click="toast('MCP 接入即将上线', 'info')">
          <div class="cc-mcp-ic">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <div class="cc-mcp-txt">
            <div class="cc-mcp-title">添加 MCP 服务器</div>
            <div class="cc-mcp-desc">接入舟谱、第三方数据源等，让 AI 副驾读更多数据</div>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== 专家 Tab ===== -->
    <template v-else-if="tab === 'expert'">
      <div class="cc-empty">
        <div class="cc-empty-ic">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="cc-empty-title">行业专家 · 正在筹备</div>
        <div class="cc-empty-desc">把低温奶订货、返利核对、货损计算这些「行业经验」沉淀成一个个 AI 专家。<br>这是你的产品最值钱、别人抄不走的东西。</div>
      </div>
    </template>

    <!-- ===== 技能 Tab ===== -->
    <template v-else>
      <!-- AI 技能库：预置行业技能 + AI 自进化沉淀 -->
      <div class="cc-section">
        <div class="panel-hd">
          <b>AI 技能库</b>
          <span class="page-sub">行业规则预置 + AI 从使用中自进化沉淀</span>
        </div>

        <div v-if="skillLoading" class="state-empty">加载技能中…</div>
        <div v-else-if="!aiSkills.length" class="state-empty">Hermes 技能未连接，请检查 Hermes API server。</div>

        <template v-else>
          <!-- AI 自进化技能 -->
          <div v-if="generatedSkills.length" class="sk-sec">
            <div class="sk-sec-hd">
              <b>✨ AI 自进化技能</b>
              <span class="tag warn">{{ generatedSkills.length }} 个 · 从你的使用中自动沉淀</span>
            </div>
            <div class="sk-grid">
              <div v-for="s in generatedSkills" :key="s.name" class="card sk-card">
                <div class="sk-name">{{ s.name }}</div>
                <div class="sk-desc">{{ s.description || 'AI 在工作中沉淀的经验' }}</div>
              </div>
            </div>
          </div>

          <!-- 预置行业技能 -->
          <div class="sk-sec">
            <div class="sk-sec-hd">
              <b>📦 预置行业技能</b>
              <span class="tag info">{{ prebuiltSkills.length }} 个 · 低温奶行业经验</span>
            </div>
            <div class="sk-grid">
              <div v-for="s in prebuiltSkills" :key="s.name" class="card sk-card">
                <div class="sk-name">{{ s.name }}</div>
                <div class="sk-desc">{{ s.description || '行业规则' }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 工作流 -->
      <div class="cc-section">
        <div class="panel-hd">
          <b>工作流</b>
          <span class="page-sub">把高频经营活封装成「工作流」，一键跑通</span>
          <button class="btn btn-ghost btn-sm" @click="manageOpen = true">⚙️ 管理工作流</button>
        </div>
        <div class="wf-grid">
          <div v-for="w in workflows" :key="w.key || w.name" class="card wf-card" :class="{ disabled: !w.ready }" @click="openWorkflow(w)">
            <div class="wf-top">
              <span class="wf-icon">{{ w.icon }}</span>
              <div class="wf-name-wrap">
                <div class="wf-name">{{ w.name }}</div>
                <span class="wf-state" :class="w.ready ? 'on' : ''">{{ w.ready ? '可用' : '未开通' }}</span>
              </div>
            </div>
            <div class="wf-desc">{{ w.desc }}</div>
            <div class="wf-steps">
              <template v-for="(s, i) in w.steps" :key="i">
                <span class="wf-step">{{ s }}</span>
                <span v-if="i < w.steps.length - 1" class="wf-arrow">→</span>
              </template>
            </div>
            <div class="wf-foot">
              <span class="wf-count">{{ w.steps.length }} 步</span>
              <span class="wf-action" :class="w.ready ? 'go' : ''">{{ w.ready ? '去使用 →' : '联系开通' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 管理工作流弹窗 -->
      <Teleport to="body">
        <Transition name="fade">
          <div v-if="manageOpen" class="cc-overlay" @click="manageOpen = false"></div>
        </Transition>
        <Transition name="pop">
          <div v-if="manageOpen" class="cc-modal">
            <div class="cc-modal-hd">
              <b>管理工作流</b>
              <button class="cc-x" @click="manageOpen = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="cc-modal-body">
              <p class="cc-modal-tip">开通/停用工作流，未开通的不会出现在卡片里。不同客户可以开不同组合。</p>
              <div v-for="w in workflows" :key="w.key" class="mg-row">
                <div class="mg-info">
                  <span class="wf-icon" style="width:26px;height:26px;font-size:13px">{{ w.icon }}</span>
                  <div>
                    <div class="mg-name">{{ w.name }}</div>
                    <div class="mg-desc">{{ w.desc }}</div>
                  </div>
                </div>
                <label class="switch" :class="{ on: w.ready }">
                  <input type="checkbox" :checked="w.ready" @change="toggleWorkflow(w)">
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- 企微配置弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="wecom.open" class="cc-overlay" @click="closeWecom"></div>
      </Transition>
      <Transition name="pop">
        <div v-if="wecom.open" class="cc-modal">
          <div class="cc-modal-hd">
            <b>连接企业微信</b>
            <button class="cc-x" @click="closeWecom">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="cc-modal-body">
            <p class="cc-modal-tip">在<a href="https://work.weixin.qq.com" target="_blank" rel="noopener">企业微信管理后台</a>的「智能机器人」里，开启 API 模式 → 长连接，获取 BotID 和 Secret。</p>
            <label class="cc-field">
              <span>BotID</span>
              <input v-model="wecom.form.botId" class="input" placeholder="智能机器人的 BotID" />
            </label>
            <label class="cc-field">
              <span>Secret（长连接专用密钥）</span>
              <input v-model="wecom.form.secret" class="input" placeholder="粘贴 Secret" type="password" />
            </label>
            <label class="cc-field">
              <span>推送给谁（你的 userid，可选）</span>
              <input v-model="wecom.form.userId" class="input" placeholder="留空则稍后在企微里对机器人说句话自动识别" />
            </label>
          </div>
          <div class="cc-modal-ft">
            <button class="btn btn-ghost" @click="closeWecom">取消</button>
            <button class="btn btn-primary" :disabled="!wecom.form.botId || !wecom.form.secret" @click="saveWecom">保存连接</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '../store'
import { workflowApi, aiSkillsApi } from '../api/modules'
import { api } from '../api/client'

const router = useRouter()
const tab = ref('connector')

/* ---- AI 进化日志 ---- */
const evSkills = ref({ total: 0, items: [] })
const evRuns = ref([])
const evLastAt = ref('')

async function loadEvolution() {
  try {
    const r = await api('/api/ai/evolution')
    evRuns.value = (r && r.curator && r.curator.runs) || []
    evSkills.value = (r && r.skills) || { total: 0, items: [] }
    evLastAt.value = r ? (r.last_run_at || '').slice(0, 16).replace('T', ' ') : ''
  } catch (e) { /* 静默 */ }
}

function fmtEvTime(t) {
  if (!t) return '—'
  return String(t).slice(0, 16).replace('T', ' ')
}

/* ---- AI 技能库（预置 + AI 自进化） ---- */
const aiSkills = ref([])
const skillLoading = ref(false)
const prebuiltSkills = computed(() => aiSkills.value.filter(s => s.source === 'prebuilt'))
const generatedSkills = computed(() => aiSkills.value.filter(s => s.source === 'generated'))

async function loadAiSkills() {
  skillLoading.value = true
  try {
    const d = await aiSkillsApi.list()
    aiSkills.value = d.skills || []
  } catch (e) {
    aiSkills.value = []
    toast(e.message || '技能加载失败', 'err')
  } finally {
    skillLoading.value = false
  }
}

/* 工作流插件清单（后端化，客户按需开通） */
const workflows = ref([])
const manageOpen = ref(false)

async function loadWorkflows() {
  try {
    const d = await workflowApi.list(0)
    workflows.value = (d.workflows || []).map(w => ({ ...w, ready: !!w.enabled }))
  } catch (e) {
    toast(e.message || '加载工作流失败', 'err')
  }
}

async function toggleWorkflow(w) {
  const next = !w.ready
  try {
    await workflowApi.toggle(w.key, next)
    w.ready = next
    toast((next ? '已开通：' : '已停用：') + w.name, 'ok')
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  }
}

function openWorkflow(w) {
  if (w.ready && w.path) router.push(w.path)
  else toast(w.name + ' 未开通', 'info')
}

/* 企微配置（暂存 localStorage，后端推送接口就绪后落库） */
const wecom = reactive({
  open: false,
  linked: false,
  form: { botId: '', secret: '', userId: '' }
})

const WECOM_KEY = 'hergent_wecom_config'

function openWecom() {
  const saved = loadWecom()
  if (saved) { wecom.form.botId = saved.botId || ''; wecom.form.secret = saved.secret || ''; wecom.form.userId = saved.userId || '' }
  wecom.open = true
}
function closeWecom() { wecom.open = false }

function loadWecom() {
  try { return JSON.parse(localStorage.getItem(WECOM_KEY) || 'null') } catch { return null }
}

function saveWecom() {
  const cfg = { botId: wecom.form.botId.trim(), secret: wecom.form.secret.trim(), userId: wecom.form.userId.trim() }
  localStorage.setItem(WECOM_KEY, JSON.stringify(cfg))
  wecom.linked = true
  wecom.open = false
  toast('企微连接已保存', 'success')
}

onMounted(() => {
  wecom.linked = !!loadWecom()
  loadWorkflows()
  loadAiSkills()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.cc-tabs{display:flex;gap:6px;margin-bottom:20px;border-bottom:1px solid var(--border-subtle);padding-bottom:0}
.cc-tab{padding:10px 18px;border:none;background:none;font-size:14px;color:var(--t2);cursor:pointer;position:relative;font-weight:500}
.cc-tab.active{color:var(--p-dark)}
.cc-tab.active::after{content:'';position:absolute;left:12px;right:12px;bottom:-1px;height:2px;background:var(--p-dark);border-radius:2px}

.cc-section{margin-bottom:26px}
.panel-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.panel-hd b{font-size:14px;font-weight:500}

.cc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.cc-card{padding:18px;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}
.cc-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.cc-card.disabled{cursor:default;opacity:.7}
.cc-card.disabled:hover{transform:none;box-shadow:var(--shadow-sm)}
.cc-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.cc-logo{width:38px;height:38px;border-radius:10px;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:var(--t2)}
.cc-logo-wecom{background:var(--p-bg);color:var(--p-dark)}
.cc-state{font-size:11px;padding:3px 9px;border-radius:10px;background:var(--bg2);color:var(--t3)}
.cc-state.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.cc-name{font-size:15px;font-weight:500;color:var(--t1);margin-bottom:4px}
.cc-desc{font-size:12px;color:var(--t3);margin-bottom:14px;min-height:18px}
.cc-action{display:inline-block;height:32px;padding:0 14px;border-radius:8px;font-size:12px;line-height:32px;text-align:center}
.cc-action.primary{background:var(--p-dark);color:#fff}
.cc-action.ghost{border:1px solid var(--bd);color:var(--t2)}

.cc-mcp{display:flex;align-items:center;gap:14px;padding:18px;border:1.5px dashed var(--bd);border-radius:14px;cursor:pointer;transition:all .15s}
.cc-mcp:hover{border-color:var(--p-dark);background:var(--p-bg)}
.cc-mcp-ic{width:44px;height:44px;border-radius:12px;background:var(--bg2);display:flex;align-items:center;justify-content:center;color:var(--p-dark);flex-shrink:0}
.cc-mcp-title{font-size:14px;font-weight:500;color:var(--t1)}
.cc-mcp-desc{font-size:12px;color:var(--t3);margin-top:2px}

.cc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 20px}
.cc-empty-ic{width:72px;height:72px;border-radius:22px;background:var(--p-bg);display:flex;align-items:center;justify-content:center;margin-bottom:20px}
.cc-empty-title{font-size:16px;font-weight:500;color:var(--t1);margin-bottom:10px}
.cc-empty-desc{font-size:13px;color:var(--t3);line-height:1.8}

/* 工作流卡片 */
.wf-intro{font-size:13px;color:var(--t2);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.wf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.wf-card{padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:12px;transition:transform .18s ease,box-shadow .18s ease}
.wf-card:hover:not(.disabled){transform:translateY(-2px);box-shadow:var(--shadow-md)}

/* 技能库 */
.sk-sec{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}
.sk-sec-hd{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sk-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.sk-card{padding:14px;display:flex;flex-direction:column;gap:6px}
.sk-name{font-size:13px;font-weight:500;color:var(--p-dark);font-family:var(--font-mono,monospace)}
.sk-desc{font-size:12px;color:var(--t2);line-height:1.6}
@media(max-width:768px){.sk-grid{grid-template-columns:1fr}}

/* 管理工作流弹窗 */
.mg-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-subtle)}
.mg-row:last-child{border-bottom:none}
.mg-info{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.mg-name{font-size:13.5px;font-weight:500;color:var(--t1)}
.mg-desc{font-size:12px;color:var(--t3);margin-top:2px}
.switch{position:relative;width:40px;height:22px;flex-shrink:0;cursor:pointer}
.switch input{opacity:0;width:0;height:0}
.switch .slider{position:absolute;inset:0;border-radius:11px;background:var(--bg3);transition:background .2s}
.switch .slider::before{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.switch.on .slider{background:var(--p)}
.switch.on .slider::before{transform:translateX(18px)}
.wf-card.disabled{cursor:default;opacity:.65}
.wf-top{display:flex;align-items:center;gap:12px}
.wf-icon{width:40px;height:40px;border-radius:10px;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;flex-shrink:0}
.wf-name-wrap{flex:1}
.wf-name{font-size:15px;font-weight:500;color:var(--t1);margin-bottom:2px}
.wf-state{font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg2);color:var(--t3)}
.wf-state.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.wf-desc{font-size:12px;color:var(--t3);line-height:1.6}
.wf-steps{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:12px;color:var(--t2)}
.wf-step{padding:3px 9px;border-radius:8px;background:var(--bg2);white-space:nowrap}
.wf-arrow{color:var(--t3);font-size:11px}
.wf-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border-subtle);padding-top:12px}
.wf-count{font-size:12px;color:var(--t3)}
.wf-action{font-size:13px;font-weight:500;color:var(--t3)}
.wf-action.go{color:var(--p-dark)}

/* 弹窗 */
.cc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:960}
.cc-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,92vw);background:var(--bg);border-radius:18px;z-index:961;box-shadow:var(--shadow-lg);overflow:hidden}
.cc-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.cc-modal-hd b{font-size:15px;font-weight:600}
.cc-x{width:28px;height:28px;border:none;background:none;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--t2);cursor:pointer}
.cc-x:hover{background:var(--bg2)}
.cc-modal-body{padding:18px 20px}
.cc-modal-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 16px;background:var(--p-bg);padding:10px 12px;border-radius:10px}
.cc-modal-tip a{color:var(--p-dark)}
.cc-field{display:block;margin-bottom:14px}
.cc-field span{display:block;font-size:12px;color:var(--t2);margin-bottom:6px}
.cc-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}

.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:transform .2s ease,opacity .2s ease}
.pop-enter-from,.pop-leave-to{transform:translate(-50%,-48%);opacity:0}

@media(max-width:768px){
  .cc-grid{grid-template-columns:1fr}
  .wf-grid{grid-template-columns:1fr}
}
/* AI 进化日志 */
.ev-stats{display:flex;gap:12px;margin:14px 0;flex-wrap:wrap}
.ev-stat{display:flex;flex-direction:column;align-items:center;background:var(--bg2);border-radius:12px;padding:12px 22px;min-width:90px}
.ev-stat b{font-size:18px;font-weight:500;color:var(--t1)}
.ev-stat span{font-size:11px;color:var(--t3);margin-top:2px}
.ev-skills{margin-bottom:18px}
.ev-sk-hd{display:flex;align-items:center;gap:10px;margin:14px 0 10px}
.ev-sk-hd b{font-size:13px;color:var(--t1)}
.ev-sk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.ev-sk{display:flex;align-items:center;gap:10px;border:1px solid var(--bd);border-radius:10px;padding:10px 12px}
.ev-sk-ic{font-size:16px}
.ev-sk-name{font-size:12.5px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-sk-sub{font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.ev-runs{display:flex;flex-direction:column;gap:10px}
.ev-run{border:1px solid var(--bd);border-radius:12px;padding:12px 14px}
.ev-run-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ev-run-hd b{font-size:13px;color:var(--t1)}
.ev-run-body{font-size:12px;color:var(--t2);line-height:1.7;margin-top:8px;white-space:pre-wrap;background:var(--bg2);border-radius:8px;padding:10px 12px}
.ev-run-empty{font-size:12px;color:var(--t3);margin-top:8px}
</style>
