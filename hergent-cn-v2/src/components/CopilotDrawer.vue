<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="store.ui.copilotOpen" class="cp-overlay" @click="close"></div>
    </Transition>
    <Transition name="slide">
      <aside v-if="store.ui.copilotOpen" class="copilot" :class="{ 'is-typing': store.chat.streaming, fullscreen: isFullscreen }">
        <!-- 头部 -->
        <header class="cp-head">
          <div class="cp-brand">
            <img class="cp-ai-img" src="/favicon.svg" alt="Hergent" />
            <div class="cp-titles">
              <b>AI 经营副驾</b>
              <span class="cp-sub">Hermes · 随时在侧</span>
            </div>
          </div>
          <div class="cp-actions">
            <button class="cp-icon-btn cp-art-toggle" title="本次产物" :class="{on:artOpen}" @click="artOpen ? hideArtifacts() : (artOpen = true)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              <span v-if="artifacts.length" class="cp-art-badge">{{ artifacts.length }}</span>
            </button>
            <button class="cp-icon-btn" title="历史会话" :disabled="!store.chat.sessions.length && !showHistory" @click="toggleHistory">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 106 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>
            </button>
            <button class="cp-icon-btn" title="清空对话" :disabled="!store.chat.messages.length" @click="clear">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            <button class="cp-icon-btn" :title="isFullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m13-5v3a2 2 0 01-2 2h-3"/></svg>
            </button>
            <button class="cp-icon-btn" title="关闭" @click="close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </header>

        <!-- 历史会话视图 -->
        <div v-if="showHistory" class="cp-hist">
          <div class="cp-hist-hd">
            <b>历史会话</b>
            <button class="btn btn-primary btn-sm" @click="newSession">＋ 新对话</button>
          </div>
          <div v-if="!store.chat.sessions.length" class="state-empty">还没有历史会话</div>
          <div v-else class="cp-hist-list">
            <div v-for="s in store.chat.sessions" :key="s.id" class="cp-hist-item" :class="{ on: s.id === store.chat.currentId }" @click="openSession(s.id)">
              <div class="cp-hist-title">{{ s.title }}</div>
              <div class="cp-hist-meta">{{ fmtTime(s.updated_at) }} · {{ s.messages.length }} 条</div>
              <button class="cp-hist-del" title="删除" @click.stop="delSession(s.id)"><Icon name="close"/></button>
            </div>
          </div>
        </div>

        <!-- 双栏：左聊天 / 右产物（方案 B） -->
        <div v-show="!showHistory" class="cp-split">
        <div class="cp-chat" :class="{'art-hidden': artFullscreen}">
        <!-- 对话流 -->
        <div class="cp-body" ref="cpBody">
          <div v-if="!store.chat.messages.length" class="cp-welcome">
            <div class="cp-w-ic">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
            </div>
            <p class="cp-w-title">问 AI 副驾任何经营问题</p>
            <p class="cp-w-sub">它会读你的真实数据回答</p>
            <div class="cp-w-chips">
              <button v-for="s in suggestions" :key="s" class="cp-chip" @click="ask(s)">{{ s }}</button>
            </div>
            <button class="cp-demo" @click="showDemo">查看示例经营卡 →</button>
          </div>

          <div v-for="(m, i) in store.chat.messages" :key="i" class="msg" :class="m.role" :data-msg="i">
            <span v-if="m.role === 'assistant'" class="msg-avatar">
              <img v-if="currentRole && currentRole.custom_avatar" :src="avatarUrl(currentRole)" class="msg-av-img" alt="">
              <template v-else>{{ (currentRole && currentRole.avatar) || 'AI' }}</template>
            </span>
            <div class="msg-col">
              <div class="msg-bubble">
                <div v-if="m.role === 'assistant' && m.content" class="md" v-html="renderMd(m.content)"></div>
                <span v-else-if="m.role === 'assistant'" class="typing"><i></i><i></i><i></i></span>
                <template v-else>{{ m.content }}</template>
              </div>
              <!-- 溯源：参考来源 -->
              <button v-if="m.role === 'assistant' && m.content" class="src-tag" @click="toggleSources(i)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                参考来源
              </button>
              <div v-if="openSources === i" class="src-panel">
                <div class="src-sec">
                  <div class="src-sec-hd">你的偏好记忆 <span class="src-sec-n">{{ sources.length }}</span></div>
                  <div v-if="!sources.length" class="src-empty">AI 还没记住你的偏好，可在「设置 → AI 记忆」添加</div>
                  <div v-for="(s, si) in sources.slice(0, 5)" :key="si" class="src-item">{{ s }}</div>
                </div>
                <div class="src-sec">
                  <div class="src-sec-hd">业务数据</div>
                  <div class="src-item">已读取你的真实经营数据（应收、库存、订单等）作答，非凭空生成。</div>
                </div>
              </div>
              <!-- 任务进度（M3） -->
              <div v-if="m.progress" class="msg-progress">
                <ProgressSteps :steps="m.progress.steps" />
              </div>

              <!-- 结构化经营结果卡 -->
              <ResultCard v-if="m.card" :card="m.card" @action="onCardAction" />

              <!-- AI 调用工具的过程（H2：让推理可见，提升信任） -->
              <div v-if="m.tools && m.tools.length" class="msg-tools">
                <div v-for="(t, ti) in m.tools" :key="ti" class="cp-tool" :class="t.status">
                  <span class="cp-tool-ic">
                    <svg v-if="t.status === 'running'" class="cp-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
                    <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                  <span class="cp-tool-name">{{ t.name }}</span>
                  <span v-if="t.args" class="cp-tool-args">{{ shortArgs(t.args) }}</span>
                </div>
              </div>

              <!-- 渐进式访谈引导（M2） -->
              <div v-if="m.followups && m.followups.length" class="cp-followups">
                <button v-for="(f, fi) in m.followups" :key="fi" class="cp-fubtn" @click="askFollowup(f)">{{ f.label || f }}</button>
              </div>

              <!-- 主动澄清（P0-①：信息不足时 AI 反问 + 结构化选项） -->
              <div v-if="m.clarify && m.clarify.options && m.clarify.options.length" class="cp-clarify">
                <div class="cp-clarify-ask">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  {{ m.clarify.ask }}
                </div>
                <div class="cp-clarify-opts">
                  <button v-for="(o, oi) in m.clarify.options" :key="oi" class="cp-clarify-opt" @click="askFollowup(o)">{{ o.label }}</button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="store.chat.error" class="msg-error">
            {{ store.chat.error }}
            <button class="cp-retry" @click="retryLast">重试</button>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="cp-foot">
          <!-- 待发送附件 -->
          <div v-if="attachments.length" class="cp-atts">
            <div v-for="(a, i) in attachments" :key="i" class="cp-att">
              <span class="cp-att-ic"><Icon :name="a.file_type === 'image' ? 'image' : 'file'"/></span>
              <span class="cp-att-name">{{ a.file_name }}</span>
              <span v-if="a.rows" class="cp-att-meta">{{ a.rows }} 行</span>
              <button class="cp-att-x" @click="removeAtt(i)"><Icon name="close"/></button>
            </div>
          </div>

          <!-- 智能导入建议（B 路径：识别到账务文件可一键入库） -->
          <div v-if="smartImport" class="cp-smart">
            <div class="cp-smart-hd">
              <span class="cp-smart-ic"><Icon name="download"/></span>
              <div>
                <div class="cp-smart-title">{{ smartImport.message }}</div>
                <div class="cp-smart-meta">约 {{ smartImport.total_estimate }} 行 · 置信度 {{ smartImport.confidence }}%</div>
              </div>
              <div class="cp-smart-ops">
                <button class="btn btn-ghost btn-sm" @click="smartImport = null">忽略</button>
                <button class="btn btn-primary btn-sm" :disabled="smartBusy" @click="doSmartImport">{{ smartBusy ? '导入中…' : '一键导入' }}</button>
              </div>
            </div>
            <div v-if="smartPreviewRows.length" class="cp-smart-prev">
              <div v-for="(row, i) in smartPreviewRows" :key="i" class="cp-smart-row">{{ row.slice(0, 4).join(' · ') }}</div>
            </div>
            <div v-if="smartResult" class="cp-smart-result" :class="{ err: smartResultErr }">{{ smartResult }}</div>
          </div>

          <div class="cp-input-wrap">
            <!-- 团队胶囊（WorkBuddy 范式：输入区左下角，＋左侧） -->
            <div class="cp-role" @click.stop="toggleRoleMenu">
              <span class="cp-role-av">
                <img v-if="currentRole && currentRole.custom_avatar" :src="avatarUrl(currentRole)" class="cp-role-av-img" alt="">
                <template v-else>{{ (currentRole && currentRole.avatar) || '🚀' }}</template>
              </span>
              <span class="cp-role-name">{{ (currentRole && currentRole.name) || '经营副驾' }}</span>
              <svg class="cp-role-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              <div v-if="showRoleMenu" class="cp-role-menu">
                <div class="cp-role-menu-hd">切换 AI 团队</div>
                <div v-for="r in activeRoles" :key="r.role_id" class="cp-role-item" :class="{ on: r.role_id === store.chat.currentRole }" @click.stop="pickRole(r)">
                  <span class="cp-role-item-av">
                    <img v-if="r.custom_avatar" :src="avatarUrl(r)" class="cp-role-item-av-img" alt="">
                    <template v-else>{{ r.avatar }}</template>
                  </span>
                  <div class="cp-role-item-tx">
                    <div class="cp-role-item-name">{{ r.name }}</div>
                    <div class="cp-role-item-desc">{{ r.opening }}</div>
                  </div>
                </div>
              </div>
            </div>
            <label class="cp-plus" title="上传 Excel / CSV / 图片">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <input type="file" accept=".xlsx,.xls,.csv,.txt,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.pdf" style="display:none" @change="onFile">
            </label>
            <textarea
              v-model="draft"
              class="cp-input"
              rows="1"
              placeholder="问返利、算货损、今天订什么货…（可上传 Excel 让 AI 直接分析）"
              @keydown.enter.exact.prevent="send"
              @input="autoGrow"
              ref="cpInput"
            ></textarea>
            <button class="cp-voice" :class="{ on: recognizing }" title="语音输入" @click="toggleVoice">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
            </button>
            <button class="cp-send" :disabled="(!draft.trim() && !attachments.length) || store.chat.streaming" @click="send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          </div>
          <div v-if="uploading" class="cp-uploading">上传解析中…</div>
          <div class="cp-foot-hint">Enter 发送 · Shift+Enter 换行 · 支持上传 Excel/CSV/图片</div>
        </footer>
        </div><!-- /cp-chat -->

        <!-- 可拖拽分割线：左聊天 / 右产物，鼠标与触摸均可拖（仅产物区展开且非区域全屏、非窄屏时显示） -->
        <div
          v-if="artOpen && !isNarrow && !artFullscreen"
          class="cp-divider"
          role="separator"
          aria-orientation="vertical"
          :aria-valuenow="artWidth"
          title="拖拽调整产物栏宽度"
          @pointerdown="onDividerDown"
        ></div>

        <!-- 右侧 Artifact 面板：聊天产物沉淀处（方案 B）；默认隐藏，新产物自动弹开 -->
        <aside class="cp-artifacts" :class="{'show-art':artOpen,'art-full':artFullscreen}" :style="artFullscreen ? { flex: '1 1 100%' } : (artOpen && !isNarrow ? { flexBasis: artWidth + 'px' } : null)">
          <div class="cp-art-hd">
            <span class="cp-art-title">本次产物 <span class="cp-art-count">{{ artifacts.length }}</span></span>
            <div class="cp-art-ops">
              <button class="cp-icon-btn" :title="artFullscreen ? '退出区域全屏' : '区域全屏'" @click="toggleArtFullscreen">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m13-5v3a2 2 0 01-2 2h-3"/></svg>
              </button>
              <button class="cp-icon-btn" title="收起产物区" @click="hideArtifacts">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="cp-art-body">
            <div v-if="!artifacts.length" class="state-empty">
              副驾产出的报告、图表、文件会沉淀在这里<br/>随时回看，不随对话滚走
            </div>
            <div
              v-for="a in artifacts"
              :key="a.index"
              class="cp-art-item"
              @click="jumpTo(a.index)"
            >
              <ResultCard :card="a.card" :compact="true" @action="onCardAction" />
            </div>
          </div>
        </aside>
      </div><!-- /cp-split -->
      </aside>
    </Transition>

    <!-- 团队下拉遮罩：点击空白处关闭 -->
    <div v-if="showRoleMenu" class="cp-role-backdrop" @click="showRoleMenu=false"></div>

    <!-- 转发面板（M5） -->
    <Transition name="fade">
      <div v-if="forwardCard" class="cp-fwd-mask" @click="forwardCard = null">
        <div class="cp-fwd" @click.stop>
          <div class="cp-fwd-hd">
            <b>转发到微信</b>
            <button class="cp-icon-btn" @click="forwardCard = null"><Icon name="close"/></button>
          </div>
          <p class="cp-fwd-sub">把下面的经营摘要复制后，发到老板群 / 客户群：</p>
          <textarea class="cp-fwd-text" :value="forwardText" readonly ref="fwdText"></textarea>
          <div class="cp-fwd-ops">
            <button class="btn btn-ghost btn-sm" @click="forwardCard = null">取消</button>
            <button class="btn btn-primary btn-sm" @click="doCopy">{{ copied ? '已复制 ' : '复制摘要' }}<Icon v-if="copied" name="check"/></button>
            <button v-if="canShare" class="btn btn-primary btn-sm" @click="doShare">直接分享</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import Icon from './Icon.vue'
import { ref, nextTick, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { store, loadSessions, saveCurrentSession, newChatSession, openChatSession, deleteChatSession, loadAiRoles, setAiRole } from '../store'
import { hermesChat, api, CHAT_TIMEOUT_NORMAL, CHAT_TIMEOUT_LONG } from '../api/client'
import { importApi } from '../api/modules'
import { chatAttachmentApi } from '../api/modules'
import ResultCard from './ResultCard.vue'
import ProgressSteps from './ProgressSteps.vue'
import { useCardTrigger, extractCard, extractCardIntent, stripIntentFence, extractClarify, stripClarifyFence, DENY_RE, demoCard } from '../composables/useCardTrigger'
import { useVoiceInput } from '../composables/useVoiceInput'
import { renderMd } from '../utils/md'

const draft = ref('')
const cpBody = ref(null)
const cpInput = ref(null)
const sources = ref([])
const openSources = ref(-1)
const attachments = ref([])
const uploading = ref(false)
const showHistory = ref(false)
const isFullscreen = ref(false)
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

/* 产物区：默认隐藏；系统生成新产物自动弹开；顶部按钮可手动隐藏 / 切换区域全屏 */
const artOpen = ref(false)
const artFullscreen = ref(false)
function hideArtifacts() {
  artOpen.value = false
  artFullscreen.value = false
}
function toggleArtFullscreen() {
  artFullscreen.value = !artFullscreen.value
  if (artFullscreen.value) artOpen.value = true   // 全屏隐含展开
}

/* 双栏可拖拽分割线（鼠标 + 触摸统一用 Pointer Events） */
const artWidth = ref(Number(localStorage.getItem('hergent_copilot_artwidth')) || 384)
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width:760px)').matches)
let dividerDrag = null
const ART_MIN = 280   // 产物栏最小宽度
const CHAT_MIN = 320  // 聊天栏最小宽度（保证可输入/可读）
function artMaxWidth() {
  const split = document.querySelector('.cp-split')
  if (!split) return ART_MIN + CHAT_MIN
  return Math.max(ART_MIN + 40, split.clientWidth - CHAT_MIN)
}
function onDividerDown(e) {
  if (isNarrow.value) return
  dividerDrag = {
    startX: e.clientX,
    startW: artWidth.value,
    minW: ART_MIN,
    maxW: artMaxWidth(),
    el: e.currentTarget,
    pid: e.pointerId,
  }
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
  e.currentTarget.classList.add('dragging')
  window.addEventListener('pointermove', onDividerMove)
  window.addEventListener('pointerup', onDividerUp)
  window.addEventListener('pointercancel', onDividerUp)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}
function onDividerMove(e) {
  if (!dividerDrag) return
  // 向左拖 → 产物栏变宽（clientX 减小，delta 为负）
  let w = dividerDrag.startW - (e.clientX - dividerDrag.startX)
  if (w < dividerDrag.minW) w = dividerDrag.minW
  else if (w > dividerDrag.maxW) w = dividerDrag.maxW
  artWidth.value = Math.round(w)
}
function onDividerUp() {
  if (!dividerDrag) return
  try { dividerDrag.el.releasePointerCapture(dividerDrag.pid) } catch (_) {}
  dividerDrag.el.classList.remove('dragging')
  window.removeEventListener('pointermove', onDividerMove)
  window.removeEventListener('pointerup', onDividerUp)
  window.removeEventListener('pointercancel', onDividerUp)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  localStorage.setItem('hergent_copilot_artwidth', String(artWidth.value))
  dividerDrag = null
}
function onWinResize() {
  isNarrow.value = window.matchMedia('(max-width:760px)').matches
  if (isNarrow.value) return
  const maxW = artMaxWidth()
  if (artWidth.value > maxW) artWidth.value = maxW
}

function shortArgs(s) {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > 80 ? t.slice(0, 80) + '…' : t
}
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function toggleHistory() {
  if (showHistory.value) {
    showHistory.value = false
    nextTick(() => { if (cpInput.value) cpInput.value.focus() })
  } else {
    saveCurrentSession()
    showHistory.value = true
  }
}

function newSession() {
  newChatSession()
  showHistory.value = false
  nextTick(() => { if (cpInput.value) cpInput.value.focus() })
}

function openSession(id) {
  openChatSession(id)
  showHistory.value = false
  nextTick(() => { if (cpInput.value) cpInput.value.focus() })
}

function delSession(id) {
  deleteChatSession(id)
}

const suggestions = ['今天该订什么货？', '算一下这个月货损', '哪些客户该催款了？', '核对我该拿多少返利']

/* ---- AI 团队（角色定位）：输入区左下角胶囊 + 下拉 ---- */
const showRoleMenu = ref(false)
const activeRoles = computed(() => (store.chat.roles || []).filter(r => r.is_active !== 0))
const currentRole = computed(() => {
  const list = store.chat.roles || []
  return list.find(r => r.role_id === store.chat.currentRole) || list[0] || null
})
// 自定义头像 URL（与桌面版一致：服务端存储的 256x256 PNG）
function avatarUrl(r) {
  return r && r.custom_avatar ? `/api/ai/roles/${r.role_id}/avatar` : null
}
function toggleRoleMenu() { showRoleMenu.value = !showRoleMenu.value }
function pickRole(r) {
  setAiRole(r.role_id)
  showRoleMenu.value = false
}

function close() { store.ui.copilotOpen = false }

async function toggleSources(i) {
  if (openSources.value === i) { openSources.value = -1; return }
  openSources.value = i
  try {
    const d = await api('/api/memory')
    sources.value = d.user || []
  } catch (e) {
    sources.value = []
  }
}

function clear() {
  store.chat.messages = []
  store.chat.error = ''
  attachments.value = []
  newChatSession()
}

function ask(s) { draft.value = s; send() }

/* ---- P0-② 时间锚点识别：老板问「昨天/上周」时，把每日经营日志注入 AI 上下文 ---- */
const TIME_ANCHOR_RULES = [
  { re: /昨天|昨日/, days: 2 },
  { re: /前天|前日/, days: 3 },
  { re: /上周|上礼拜|上星期|上一周/, days: 14 },
  { re: /上月|上个月|上一月/, days: 60 },
]
const TIME_ANCHOR_N_RE = /近(\d{1,2})天|最近(\d{1,2})天|过去(\d{1,2})天|这(\d{1,2})天/
const METRIC_LABELS = {
  loss_amount: '货损金额', loss_risk_value: '临期风险', loss_risk_items: '临期SKU数',
  payroll_commission: '提成合计', payroll_headcount: '核算人数', payroll_sales: '关联销售',
  rebate_open: '未结合同', rebate_achieved: '已达成销售', rebate_est: '预计返利',
}
function timeAnchorDays(q) {
  for (const t of TIME_ANCHOR_RULES) { if (t.re.test(q)) return t.days }
  const m = (q || '').match(TIME_ANCHOR_N_RE)
  if (m) { const n = parseInt(m[1] || m[2] || m[3] || m[4], 10); if (n > 0 && n <= 90) return n }
  return null
}
function formatDailyLogForAI(logs) {
  if (!logs || !logs.length) return ''
  const byDate = {}
  for (const l of logs) { const d = (l.log_date || '').slice(5); (byDate[d] = byDate[d] || []).push(l) }
  const lines = Object.keys(byDate).sort().map(d => {
    const items = byDate[d].map(l => `${METRIC_LABELS[l.metric] || l.metric}¥${Math.round(l.value || 0)}`).join('，')
    return `- ${d}：${items}`
  })
  return `【这家店最近几天的经营记录（每日简报快照，供你回忆历史真实数字，勿编造）】\n${lines.join('\n')}`
}

function showDemo() {
  store.chat.messages.push({
    role: 'assistant',
    content: '先看一下我能怎么帮你——下面是几个例子：',
    followups: [
      { label: '按客户维度看货损', query: '按客户维度分析本月货损' },
      { label: '按商品维度看货损', query: '按商品维度分析本月货损' },
      { label: '只要结论不要细节', query: '用一句话告诉我本月货损重点' }
    ]
  })
  store.chat.messages.push({
    role: 'assistant',
    content: '这是「货损核算」经营卡，带近 7 日趋势迷你图：',
    card: demoCard()
  })
  store.chat.messages.push({
    role: 'assistant',
    content: '长任务（如算整月工资）会显示进度，老板一眼看到哪一步：',
    progress: { steps: [
      { label: '读库存', status: 'done' },
      { label: '算折价', status: 'done' },
      { label: '出报表', status: 'active' }
    ]}
  })
  scrollBottom()
  saveCurrentSession()
}

/* 卡片操作：采纳/驳回翻转状态留痕；转发走面板；其余回写对话 */
function onCardAction({ key, card }) {
  if (key === 'forward') { openForward(card); return }
  const verbMap = { adopt: '采纳', detail: '查看明细', forward: '转发', save: '保存', reject: '驳回' }
  const verb = verbMap[key] || key
  if (key === 'adopt' || key === 'reject') {
    if (card && 'status' in card) card.status = (key === 'reject') ? 'rejected' : 'confirmed'
  }
  draft.value = `${verb}「${card?.title || '该建议'}」`
  send()
}

/* ---- M2 渐进式访谈：引导 chips 点击 -> 追加提问 ---- */
function askFollowup(f) {
  const q = (typeof f === 'object' && f !== null) ? (f.query || f.label) : f
  draft.value = q
  send()
}

/* ---- AI 卡片触发器（A6 拆分至 composables/useCardTrigger） ---- */
function getRoleId() {
  return (currentRole.value && currentRole.value.role_id) ? currentRole.value.role_id : null
}
const {
  fetchLossCard,
  fetchPayrollCard,
  fetchRebateCard,
  fetchForecastCard,
  triggerCards,
  fireCards
} = useCardTrigger({ store, scrollBottom, saveCurrentSession, pushRoleReply, getRoleId })

/* ---- M5 语音输入（A6 拆分至 composables/useVoiceInput） ---- */
const { recognizing, speechOk, toggleVoice: _toggleVoice } = useVoiceInput({
  onError: (msg) => { store.chat.error = msg }
})
function toggleVoice() {
  _toggleVoice((t) => { draft.value = t })
}

/* ---- M5 转发到微信：生成纯文本摘要 + 复制/分享 ---- */
const forwardCard = ref(null)
const copied = ref(false)
const fwdText = ref(null)
const canShare = typeof navigator !== 'undefined' && !!navigator.share
const SCENE_LABEL = { loss: '货损', rebate: '返利', forecast: '预报', reconcile: '对账', payroll: '工资', kpi: '指标' }
const forwardText = computed(() => {
  const c = forwardCard.value
  if (!c) return ''
  let t = `【Hergent·${SCENE_LABEL[c.type] || '经营'}】${c.title}\n`
  if (c.summary) t += c.summary + '\n'
  if (c.metrics) c.metrics.forEach(m => { t += `· ${m.label}：${m.value}${m.hint ? '（' + m.hint + '）' : ''}\n` })
  if (c.points) c.points.forEach(p => { t += `  - ${p.text}\n` })
  return t.trim()
})
function openForward(card) { forwardCard.value = card; copied.value = false }
async function doCopy() {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(forwardText.value)
    else if (fwdText.value) { fwdText.value.select(); document.execCommand('copy') }
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch (e) { store.chat.error = '复制失败，请手动选择文本复制' }
}
async function doShare() {
  try { await navigator.share({ title: forwardCard.value?.title || 'Hergent 经营摘要', text: forwardText.value }) }
  catch (e) { /* 用户取消分享，忽略 */ }
}

/* 输入框随内容自动增高，但保底 3 行、封顶 ~7 行，避免过矮/失控 */
const INPUT_MIN_H = 50
const INPUT_MAX_H = 168
function autoGrow(e) {
  const el = e && e.target ? e.target : cpInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(Math.max(el.scrollHeight, INPUT_MIN_H), INPUT_MAX_H) + 'px'
}

/* ---- 文件上传（Excel/CSV 解析成文本，图片存盘）+ B 路径智能导入 ---- */
const smartImport = ref(null)
const smartPreviewRows = ref([])
const smartBusy = ref(false)
const smartResult = ref('')
const smartResultErr = ref(false)
let pendingSmartFile = null

async function onFile(ev) {
  const f = ev.target.files?.[0]
  ev.target.value = ''
  if (!f) return
  uploading.value = true
  try {
    const d = await chatAttachmentApi.upload(f)
    attachments.value.push(d)
    store.chat.error = ''
    // B 路径：Excel/CSV 走智能识别，可导入则弹建议卡
    if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
      try {
        const sp = await importApi.smartParse(f)
        if (sp && sp.can_import) {
          pendingSmartFile = f
          smartImport.value = sp
          smartPreviewRows.value = sp.preview_rows || []
          smartResult.value = ''
          smartResultErr.value = false
        }
      } catch (e2) { /* 识别失败不打扰 */ }
    }
  } catch (e) {
    store.chat.error = e.message || '文件上传失败'
  } finally {
    uploading.value = false
    nextTick(() => { if (cpInput.value) cpInput.value.focus() })
  }
}

async function doSmartImport() {
  if (!pendingSmartFile || !smartImport.value) return
  smartBusy.value = true
  smartResult.value = ''
  try {
    const sp = smartImport.value
    const ex = await importApi.execute(pendingSmartFile, sp.category, sp.mapping || {})
    const ok = ex.success !== false
    smartResultErr.value = !ok
    smartResult.value = ok ? `已导入 ${ex.success ?? '完成'} 条（跳过 ${ex.skipped ?? 0}，重复 ${ex.dupes ?? 0}）` : (ex.error || ex.detail || '导入失败')
    if (ok) { smartImport.value = null; pendingSmartFile = null }
  } catch (e) {
    smartResultErr.value = true
    smartResult.value = e.message || '导入失败'
  } finally {
    smartBusy.value = false
  }
}

function removeAtt(i) {
  attachments.value.splice(i, 1)
  if (i === 0) { smartImport.value = null; pendingSmartFile = null }
}

function scrollBottom() {
  nextTick(() => { if (cpBody.value) cpBody.value.scrollTop = cpBody.value.scrollHeight })
}

/* ---- 方案 B：右侧 Artifact 面板 —— 从对话消息中派生产物索引（最新在上） ---- */
const artifacts = computed(() => {
  const msgs = store.chat.messages
  const list = []
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i] && msgs[i].card) list.push({ index: i, card: msgs[i].card })
  }
  return list.reverse()
})
/* 新产物（artifact 数量增加）时自动弹开；数量减少或初始化/切会话不触发，避免误弹。
   必须放在 artifacts 定义之后，否则 watch 初始化取值会触发 const 的 TDZ 报错。 */
watch(
  () => artifacts.value.length,
  (n, o) => { if (n > o) artOpen.value = true }
)

function jumpTo(idx) {
  nextTick(() => {
    const el = cpBody.value && cpBody.value.querySelector(`[data-msg="${idx}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1200)
  })
}

// Plan A：表格全量计算上移至 Hermes（spreadsheet MCP server），前端只透传 file_id + 软提示，
// 由 Hermes 自行规划参数并调用 spreadsheet_summary / spreadsheet_query 工具对整表精确计算。
// 关键约束：强制走工具、严禁 terminal/execute_code/write_file——避免模型自行写脚本导致长任务
// 超时、前端 SSE 断开误报"离线"（14:10 已发生一次 11 轮 terminal 任务导致掉线）。
// Plan A：表格全量计算上移至 Hermes（spreadsheet MCP server），前端只透传 file_id + 软提示，
// 由 Hermes 自行规划参数并调用 spreadsheet_* 工具对整表精确计算。
// 关键约束：强制走工具、严禁 terminal/execute_code/write_file——避免模型自行写脚本导致长任务
// 超时、前端 SSE 断开误报"离线"（14:10 已发生一次 11 轮 terminal 任务导致掉线）。
// tableFiles: 上传的 Excel/CSV 附件数组（含 file_id / file_name），可能 1 个或多个。
function spreadsheetSoftHint(tableFiles) {
  const n = tableFiles.length
  const list = tableFiles.map(f => `- ${f.file_name}: file_id=${f.file_id}`).join('\n')
  const header = [
    '',
    '【表格数据说明】用户上传了以下 Excel/CSV（均已存于后端，你必须通过工具读取，严禁直接读文件内容）：',
    list,
  ]
  const common = [
    '【强制】处理这些表格【只能】使用 spreadsheet_summary / spreadsheet_query / spreadsheet_reconcile_files 工具对【全部数据】精确计算。',
    '【严禁】使用 terminal / execute_code / write_file / read_file 等工具处理这些文件——这些无法可靠解析 Excel，且会令任务长时间运行导致连接超时中断。',
    '请严格基于 spreadsheet 工具返回的真实结果回答，不要心算、不要估算、不要编造。',
  ]
  if (n >= 2) {
    // 多文件：明确指令用跨文件对账工具，严禁自行写脚本合并
    return [
      ...header,
      `用户上传了 ${n} 个文件，【若要对账/对比两份独立文件】，必须调用 ` +
        'spreadsheet_reconcile_files(file_a=<其中一个 file_id>, file_b=<另一个 file_id>, key=对账键列, amount=金额列) 做跨文件对账（不要自行写脚本合并两个文件）。',
      '调用前请先用 spreadsheet_summary 分别看清两个文件的 sheet 名与列名，再传准确的 key / amount / sheet 参数。',
      ...common,
    ].join('\n')
  }
  return [
    ...header,
    '先用 spreadsheet_summary(file_id) 看清工作表与列结构；再按问题调用：',
    '  单文件内两表对账用 spreadsheet_query(op=match, sheet_a=, sheet_b=, key=, amount=)、分组汇总用 op=groupby、总计用 op=sum。',
    ...common,
  ].join('\n')
}

let lastPayload = null   // 最近一次发送载荷，供「重试」使用（含表格软提示）

async function send() {
  const q = draft.value.trim()
  if ((!q && !attachments.value.length) || store.chat.streaming) return
  draft.value = ''
  nextTick(() => { if (cpInput.value) autoGrow(cpInput.value) })
  store.chat.error = ''

  // 拼装消息：附件解析文本 + 用户问题
  let content = q
  let tableFiles = []   // 上传的 Excel/CSV 附件（含 file_id），供 Hermes 跨文件/单文件全量表计算引用
  if (attachments.value.length) {
    tableFiles = attachments.value.filter(a => a.file_id && /\.(xlsx|csv)$/i.test(a.file_name))
    // 静默读取：消息只留轻量引用（文件名+行数，自包含可溯源），不把表格正文 preview 塞进上下文。
    // 全量数据由 Hermes 经 spreadsheet MCP 工具按 file_id 静默读取，避免截断预览误导模型心算。
    const parts = attachments.value.map(a => {
      const head = `【附件：${a.file_name}${a.rows ? `（${a.rows} 行）` : ''}】`
      return `${head}（已上传，Hermes 将经表格工具读取全量数据）`
    })
    content = parts.join('\n\n') + (q ? `\n\n我的问题：${q}` : '\n\n请分析这份数据。')
    attachments.value = []
  }

  // 系统提示：角色人设 + （若有上传表）表格计算工具指令
  let sys = currentRole.value ? currentRole.value.system_prompt : ''
  if (tableFiles.length) sys = (sys ? sys + '\n' : '') + spreadsheetSoftHint(tableFiles)

  // P0-② 时间锚点：老板问「昨天/上周」时，把每日经营日志注入 AI 上下文（静默，失败不阻断）
  const anchorDays = timeAnchorDays(q)
  if (anchorDays) {
    try {
      const res = await api(`/api/ai/daily-log?days=${anchorDays}`)
      const logs = (res && res.logs) || []
      const ctx = formatDailyLogForAI(logs)
      if (ctx) sys = (sys ? sys + '\n\n' : '') + ctx
    } catch (_) { /* 静默降级，不阻断主对话 */ }
  }

  lastPayload = { content, sys, q, tableFiles: [...tableFiles] }
  streamReply(lastPayload)
}

/* 流式发送核心：成功才触发卡片/推送并落盘；失败（含超时中断）只移除半截气泡、
   给出分级错误，绝不误报「离线」或追发卡片请求（P0 评审炸弹 #4）。 */
async function streamReply(payload) {
  const { content, sys, q, tableFiles } = payload
  store.chat.error = ''
  store.chat.messages.push({ role: 'user', content })
  store.chat.messages.push({ role: 'assistant', content: '', tools: [] })
  const replyIndex = store.chat.messages.length - 1
  store.chat.streaming = true
  scrollBottom()
  // AI 自主判断的卡片意图（```cards 围栏）；null = AI 未输出意图，走弱兜底
  let cardIntent = null

  try {
    // 分级超时（P1）：对账/复盘/汇总/报表等长任务放宽到 5 分钟，普通对话 3 分钟
    const isHeavy = /对账|复盘|汇总|报表|经营分析|reconcil/i.test((q || '') + ' ' + (content || ''))
    await hermesChat(
      store.chat.messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
      {
        system: sys,
        timeout: isHeavy ? CHAT_TIMEOUT_LONG : CHAT_TIMEOUT_NORMAL,
        onTool: (step) => {
          const last = store.chat.messages[replyIndex]
          if (!last || !last.tools) return
          if (step.phase === 'start') {
            last.tools.push({ name: step.name, args: step.args, status: 'running' })
          } else if (step.phase === 'done') {
            const t = last.tools.find(x => x.name === step.name && x.status === 'running')
            if (t) t.status = 'done'
          } else if (step.phase === 'result') {
            const t = last.tools.find(x => x.name === step.name && x.status === 'running')
            if (t) { t.status = 'done'; t.result = step.result }
          }
        },
        onDelta: (d, full) => {
          const last = store.chat.messages[replyIndex]
          if (!last) return
          if (!cardIntent) cardIntent = extractCardIntent(full)
          let clean = stripIntentFence(full)
          // 主动澄清：```clarify 围栏 → 渲染可点选项，围栏不出现在正文
          const cl = extractClarify(clean)
          if (cl && cl.options && cl.options.length) { last.clarify = cl; clean = stripClarifyFence(clean) }
          if (last.card) { last.content = clean }            // 已抽到卡片，继续累积纯文本（意图围栏已剥离）
          else {
            const ex = extractCard(clean)
            if (ex) { last.card = ex.card; last.content = ex.content }
            else last.content = clean
          }
          scrollBottom()
        }
      }
    )
  } catch (e) {
    // 失败/超时：移除半截气泡，避免把截断消息当完整会话落盘（乱码重现）
    const last = store.chat.messages[replyIndex]
    if (last && !last.card) store.chat.messages.splice(replyIndex, 1)

    // 区分错误类型，避免一切失败都冒泡成"离线"（修复"AI助手暂时离线"误导）
    const rawMsg = (e && e.message) || ''
    let msg
    if (e && e.name === 'AbortError') {
      msg = '回答生成超时，已停止。请点「重试」重新发送。'
    } else if (/\[HTTP (401|403)\]|鉴权|unauthorized|forbidden/i.test(rawMsg)) {
      msg = 'AI 服务鉴权异常，请联系管理员。'
    } else if (/\[HTTP (502|503|504)\]|离线|offline|暂时不可用|service unavailable|bad gateway|gateway timeout/i.test(rawMsg)) {
      msg = 'AI 服务暂时不可用，正在自动重试…如持续失败请稍后再试。'
    } else {
      msg = rawMsg || '与 AI 助手通信失败，请稍后再试'
    }
    store.chat.error = msg
    store.chat.streaming = false

    // 对"服务不可用"类错误尝试一次静默退避重试（1.5s），避免瞬时抖动直接报离线
    if (/\[HTTP (502|503|504)\]|离线|offline|暂时不可用|service unavailable|bad gateway|gateway timeout/i.test(msg) && !payload.__retried) {
      setTimeout(() => { streamReply({ ...payload, __retried: true }) }, 1500)
    }
    return
  }

  store.chat.streaming = false
  // 成功分支：仅在 AI 正常回复后才触发卡片/推送（修复原 .then 在失败时仍误触发）
  const replyMsg = store.chat.messages[replyIndex]
  const reply = (replyMsg && replyMsg.content ? replyMsg.content : '').trim()
  if (reply && currentRole.value && currentRole.value.role_id) {
    pushRoleReply(currentRole.value.role_id, reply, (currentRole.value.name || 'AI 经营副驾'))
  }
  // 是否补经营卡 = AI 自主判断（老板无需知道"卡片"）：
  //   ① AI 输出了 ```cards 意图围栏 → 完全按 AI 的 show 执行（show:[] 即纯文字一张不补）
  //   ② AI 未输出（模型漏标/旧会话）→ 单卡正则弱兜底，且尊重显式否定词
  if (cardIntent) {
    if (cardIntent.show && cardIntent.show.length) fireCards(cardIntent.show, q)
  } else if (!DENY_RE.test(q)) {
    triggerCards(q)
  }
  saveCurrentSession()
}

function retryLast() {
  if (lastPayload) streamReply(lastPayload)
}

/* P1 推送闭环：助手回复 → 该角色已连渠道（企微/飞书群机器人 Webhook）。
   fail-closed：推送失败仅告警，绝不阻断对话。无绑定时后端静默 skipped。 */
async function pushRoleReply(roleId, content, title, kind = 'reply') {
  try {
    await api(`/api/ai/roles/${roleId}/push`, {
      method: 'POST',
      body: { title: title || 'AI 经营副驾', content, kind }
    })
  } catch (e) {
    console.warn('[copilot] push role reply failed:', e.message)
  }
}

/* 打开抽屉时聚焦输入框 */
watch(() => store.ui.copilotOpen, (v) => {
  if (v) {
    loadSessions()
    loadAiRoles()
    nextTick(() => { if (cpInput.value) cpInput.value.focus() })
  } else {
    showRoleMenu.value = false
    saveCurrentSession()  // 关闭时落盘
  }
})

function onKeydown(e) {
  if (e.key === 'Escape' && isFullscreen.value) isFullscreen.value = false
}
onMounted(() => {
  loadSessions()
  loadAiRoles()
  onWinResize()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWinResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWinResize)
})

watch(() => store.chat.messages.length, scrollBottom)
</script>

<style scoped>
.copilot{
  position:fixed;top:0;right:0;bottom:0;width:min(880px,94vw);
  display:flex;flex-direction:column;
  background:var(--bg);border-left:1px solid var(--bd);
  box-shadow:-12px 0 40px rgba(0,0,0,.12);
  z-index:950;
}
/* 全屏态：覆盖 ERP，铺满视口（按钮触发，可一键/Esc 退出，非默认） */
.copilot.fullscreen{
  width:100vw;height:100vh;left:0;right:0;top:0;bottom:0;
  border-left:none;border-radius:0;box-shadow:none;
}
.copilot.fullscreen .cp-artifacts{flex-basis:460px}
/* 方案 B：左聊天 / 右产物 双栏 */
.cp-split{flex:1;display:flex;min-height:0;min-width:0;overflow:hidden}
.cp-chat{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0}
.cp-chat.art-hidden{display:none}
.cp-artifacts{flex:0 0 384px;display:none;flex-direction:column;min-height:0;border-left:1px solid var(--bd);background:var(--bg2)}
.cp-artifacts.show-art{display:flex}
.cp-artifacts.art-full{flex:1 1 100%;border-left:none}
/* 可拖拽分割线：细线 + 放大命中区，触摸更易抓；touch-action:none 防止拖拽时页面滚动 */
.cp-divider{flex:0 0 7px;position:relative;cursor:col-resize;background:transparent;touch-action:none;z-index:6}
.cp-divider::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);background:var(--bd);transition:background .15s,width .15s}
.cp-divider:hover::before,.cp-divider.dragging::before{background:var(--p);width:3px}
.cp-divider::after{content:'';position:absolute;top:0;bottom:0;left:-5px;right:-5px}
.cp-art-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.cp-art-title{font-size:13px;font-weight:600;color:var(--t1);display:inline-flex;align-items:center;gap:8px}
.cp-art-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 7px;border-radius:10px;background:var(--p-bg);color:var(--p-dark);font-size:11px;font-weight:600}
.cp-art-ops{display:flex;align-items:center;gap:4px}
.cp-art-ops .cp-icon-btn{width:28px;height:28px;padding:0}
.cp-art-ops .cp-icon-btn:hover{background:rgba(127,127,127,.16);color:var(--t1)}
.cp-art-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.cp-art-item{cursor:pointer;transition:transform .12s ease}
.cp-art-item:hover{transform:translateY(-1px)}
.cp-art-item .rc{border-color:var(--bd)}
/* 跳转动效 */
.msg.flash .msg-bubble{animation:cpFlash 1.2s ease}
@keyframes cpFlash{0%,100%{box-shadow:0 0 0 0 transparent}30%{box-shadow:0 0 0 3px var(--p-bg)}}
@media (max-width:760px){
  .copilot{width:100vw}
  .cp-split{flex-direction:column}
  .cp-divider{display:none}
  .cp-artifacts{display:none}
  .cp-artifacts.show-art{display:flex;flex:1;min-height:0;border-left:none;border-top:1px solid var(--bd)}
}
/* Artifact 切换按钮（移动端可见） */
.cp-art-toggle{position:relative}
.cp-art-toggle.on{background:var(--p-bg);color:var(--p-dark)}
.cp-art-badge{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:var(--dan);color:#fff;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center}
.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:940}

.cp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.cp-brand{display:flex;align-items:center;gap:10px}
.cp-ai-img{width:32px;height:32px;border-radius:50%;object-fit:cover}
.cp-titles{display:flex;flex-direction:column}
.cp-titles b{font-size:14px;font-weight:600;color:var(--t1)}
.cp-sub{font-size:11px;color:var(--t3);margin-top:1px}
.cp-actions{display:flex;gap:6px}
.cp-icon-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2);cursor:pointer}
.cp-icon-btn:hover:not(:disabled){background:var(--bg2);color:var(--t1)}
.cp-icon-btn:disabled{opacity:.35;cursor:default}

.cp-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}

/* 历史会话 */
.cp-hist{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.cp-hist-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.cp-hist-hd b{font-size:14px;font-weight:600;color:var(--t1)}
.cp-hist-list{display:flex;flex-direction:column;gap:8px}
.cp-hist-item{position:relative;padding:12px 32px 12px 12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);cursor:pointer;transition:all .15s}
.cp-hist-item:hover{border-color:var(--p);background:var(--p-bg)}
.cp-hist-item.on{border-color:var(--p);background:var(--p-bg)}
.cp-hist-title{font-size:13px;font-weight:500;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-hist-meta{font-size:11px;color:var(--t3);margin-top:3px}
.cp-hist-del{position:absolute;top:8px;right:8px;width:22px;height:22px;border:none;background:none;border-radius:6px;color:var(--t3);cursor:pointer;font-size:11px}
.cp-hist-del:hover{background:rgba(var(--dan-rgb),.12);color:var(--dan)}
.cp-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}
.cp-w-ic{width:56px;height:56px;border-radius:18px;background:var(--p-bg);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.cp-w-title{font-size:15px;font-weight:500;color:var(--t1);margin:0 0 4px}
.cp-w-sub{font-size:12px;color:var(--t3);margin:0 0 16px}
.cp-w-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.cp-chip{padding:7px 12px;border:1px solid var(--bd);border-radius:16px;background:var(--bg);font-size:12px;color:var(--t2);cursor:pointer;transition:all .15s}
.cp-chip:hover{border-color:var(--p-dark);color:var(--p-dark);background:var(--p-bg)}
.cp-demo{margin-top:14px;padding:8px 18px;border:1px solid var(--p-border);border-radius:20px;background:var(--p-bg);font-size:12.5px;color:var(--p-dark);cursor:pointer;transition:all .15s}
.cp-demo:hover{background:rgba(6,182,212,.12);border-color:var(--p-dark)}

.msg{display:flex;gap:8px;align-items:flex-end}
.msg.user{justify-content:flex-end}
.msg-avatar{width:26px;height:26px;border-radius:50%;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;overflow:hidden}
.msg-av-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.msg-col{display:flex;flex-direction:column;gap:5px;max-width:82%}
.msg.user .msg-col{align-items:flex-end}
.msg-bubble{max-width:100%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.msg.user .msg-bubble{background:var(--p-dark);color:#fff;border-bottom-right-radius:4px}
.msg.assistant .msg-bubble{background:var(--bg2);border-bottom-left-radius:4px;color:var(--t1)}

/* 溯源：参考来源 */
.src-tag{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:none;background:none;border-radius:8px;font-size:11px;color:var(--t3);cursor:pointer;transition:all .15s}
.src-tag:hover{background:var(--p-bg);color:var(--p-dark)}
.src-panel{width:100%;background:var(--bg);border:1px solid var(--border-subtle);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.src-sec{display:flex;flex-direction:column;gap:5px}
.src-sec-hd{font-size:11px;font-weight:500;color:var(--t3);display:flex;align-items:center;gap:6px}
.src-sec-n{font-size:11px;color:var(--p-dark);background:var(--p-bg);padding:0 6px;border-radius:8px}
.src-item{font-size:12px;color:var(--t2);line-height:1.6;padding:6px 8px;background:var(--bg2);border-radius:8px}
.src-empty{font-size:12px;color:var(--t3);padding:6px 8px}

/* 思考中动效 */
.typing{display:inline-flex;gap:4px;align-items:center;padding:4px 0}
.typing i{width:6px;height:6px;border-radius:50%;background:var(--t3);animation:cp-blink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}
.typing i:nth-child(3){animation-delay:.4s}
@keyframes cp-blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}

.msg-error{font-size:12px;color:var(--dan);padding:6px 2px;line-height:1.5}
.err-hint{color:var(--t3);display:block;margin-top:2px}
.cp-retry{margin-left:8px;padding:3px 12px;border:1px solid var(--dan);border-radius:8px;background:transparent;color:var(--dan);font-size:12px;cursor:pointer;vertical-align:middle}
.cp-retry:hover{background:var(--dan);color:#fff}

.cp-foot{padding:12px 16px;border-top:1px solid var(--border-subtle);flex-shrink:0;background:var(--bg)}
.cp-atts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.cp-att{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:var(--p-bg);border:1px solid var(--p);border-radius:10px;font-size:12px;color:var(--p-dark);max-width:100%}
.cp-att-ic{font-size:13px}
.cp-att-name{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-att-meta{font-size:11px;color:var(--p-dark);opacity:.7}
.cp-att-x{border:none;background:none;color:var(--p-dark);cursor:pointer;font-size:12px;padding:0 2px;opacity:.6}
.cp-att-x:hover{opacity:1}
.cp-plus{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;color:var(--t2);cursor:pointer;transition:all .15s;flex-shrink:0}
.cp-plus:hover{background:var(--bg4);color:var(--p-dark)}
.cp-uploading{font-size:11px;color:var(--t3);margin-top:6px;text-align:center}
.cp-input-wrap{display:flex;align-items:flex-end;gap:6px;border:1px solid var(--bd);border-radius:18px;padding:8px 10px;background:var(--bg3);transition:border-color .2s,box-shadow .2s}
.cp-input-wrap:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 4px var(--p-bg)}
.cp-role{position:relative;display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 8px 0 6px;border-radius:10px;background:var(--p-bg);color:var(--p-dark);cursor:pointer;flex-shrink:0;transition:all .15s;max-width:150px}
.cp-role:hover{background:rgba(6,182,212,.16)}
.cp-role-av{font-size:15px;line-height:1;flex-shrink:0;display:flex;align-items:center}
.cp-role-av-img{width:20px;height:20px;border-radius:50%;object-fit:cover;display:block}
.cp-role-name{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-role-caret{flex-shrink:0;opacity:.7}
.cp-role-menu{position:absolute;bottom:calc(100% + 8px);left:0;width:248px;max-height:300px;overflow-y:auto;background:var(--bg);border:1px solid var(--bd);border-radius:14px;box-shadow:var(--shadow-lg);padding:8px;z-index:20}
.cp-role-menu-hd{font-size:11px;color:var(--t3);padding:4px 8px 8px}
.cp-role-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;cursor:pointer;transition:all .15s}
.cp-role-item:hover{background:var(--p-bg)}
.cp-role-item.on{background:var(--p-bg);box-shadow:inset 0 0 0 1px var(--p)}
.cp-role-item-av{font-size:18px;flex-shrink:0;width:24px;text-align:center;display:flex;align-items:center}
.cp-role-item-av-img{width:24px;height:24px;border-radius:50%;object-fit:cover;display:block}
.cp-role-item-tx{display:flex;flex-direction:column;min-width:0}
.cp-role-item-name{font-size:13px;font-weight:500;color:var(--t1)}
.cp-role-item-desc{font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.cp-role-backdrop{position:fixed;inset:0;z-index:15}
.cp-input{flex:1;border:none;background:none;outline:none;resize:none;font-size:14px;line-height:1.6;min-height:50px;max-height:168px;padding:8px 4px;color:var(--t1);font-family:inherit;overflow-y:auto}
.cp-input::placeholder{color:var(--t3)}
.cp-send{width:36px;height:36px;border:none;border-radius:11px;background:var(--p-dark);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all .15s;box-shadow:var(--shadow-sm)}
.cp-send:not(:disabled):hover{background:var(--p-deep);transform:translateY(-1px)}
.cp-send:disabled{opacity:.35;cursor:default}
.cp-foot-hint{font-size:11px;color:var(--t3);margin-top:7px;text-align:center}

/* M2 渐进式访谈引导 chips */
.cp-followups{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.cp-fubtn{padding:6px 11px;border:1px solid var(--p);border-radius:14px;background:var(--p-bg);font-size:11.5px;color:var(--p-dark);cursor:pointer;transition:all .15s}
.cp-fubtn:hover{background:rgba(6,182,212,.16);border-color:var(--p-dark)}

/* P0-① 主动澄清：AI 反问 + 结构化选项 */
.cp-clarify{margin-top:8px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.cp-clarify-ask{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);margin-bottom:8px}
.cp-clarify-ask svg{color:var(--p-dark);flex-shrink:0}
.cp-clarify-opts{display:flex;flex-direction:column;gap:6px}
.cp-clarify-opt{padding:7px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg);font-size:12.5px;color:var(--t1);cursor:pointer;text-align:left;transition:all .15s}
.cp-clarify-opt:hover{border-color:var(--p-dark);background:var(--p-bg)}

/* M3 任务进度容器 */
.msg-progress{width:100%;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px 12px}

/* H2 AI 工具调用过程可视化 */
.msg-tools{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.cp-tool{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t2);line-height:1.5}
.cp-tool-ic{display:flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--p-dark);flex-shrink:0}
.cp-tool.running .cp-tool-ic{color:var(--war)}
.cp-tool.done .cp-tool-ic{color:var(--suc)}
.cp-tool-name{font-weight:600;color:var(--t1)}
.cp-tool-args{color:var(--t3);font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.cp-spin{animation:cp-spin 0.9s linear infinite}
@keyframes cp-spin{to{transform:rotate(360deg)}}

/* M5 语音输入按钮 */
.cp-voice{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--t2);cursor:pointer;transition:all .15s;flex-shrink:0;border:none;background:none}
.cp-voice:hover{background:var(--bg4);color:var(--p-dark)}
.cp-voice.on{background:var(--p-dark);color:#fff;animation:cp-voice-pulse 1.2s infinite}
@keyframes cp-voice-pulse{0%,100%{box-shadow:0 0 0 0 rgba(6,182,212,.4)}50%{box-shadow:0 0 0 5px rgba(6,182,212,0)}}

/* M5 转发面板 */
.cp-fwd-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:960;display:flex;align-items:center;justify-content:center;padding:20px}
.cp-fwd{width:min(360px,92vw);background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.cp-fwd-hd{display:flex;align-items:center;justify-content:space-between}
.cp-fwd-hd b{font-size:14px;font-weight:600;color:var(--t1)}
.cp-fwd-sub{font-size:12px;color:var(--t3);margin:0;line-height:1.5}
.cp-fwd-text{width:100%;height:140px;resize:none;border:1px solid var(--bd);border-radius:var(--radius-md);padding:10px 12px;font-size:12.5px;line-height:1.6;color:var(--t1);background:var(--bg2);font-family:inherit;outline:none}
.cp-fwd-ops{display:flex;justify-content:flex-end;gap:8px}

/* 智能导入卡（B 路径） */
.cp-smart{margin:0 12px 8px;border:1px solid rgba(6,182,212,.3);background:rgba(6,182,212,.05);border-radius:12px;padding:10px 12px}
.cp-smart-hd{display:flex;align-items:center;gap:10px}
.cp-smart-ic{font-size:16px}
.cp-smart-title{font-size:13px;font-weight:500;color:var(--t1)}
.cp-smart-meta{font-size:11px;color:var(--t3);margin-top:2px}
.cp-smart-ops{margin-left:auto;display:flex;gap:6px;flex-shrink:0}
.cp-smart-prev{margin-top:8px;border-top:1px solid var(--bd);padding-top:8px;max-height:100px;overflow-y:auto}
.cp-smart-row{font-size:11px;color:var(--t2);padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-smart-result{margin-top:8px;font-size:12px;color:#2f9e44;font-weight:500}
.cp-smart-result.err{color:#d0342c}

/* 过渡 */
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.slide-enter-active,.slide-leave-active{transition:transform .25s ease}
.slide-enter-from,.slide-leave-to{transform:translateX(100%)}

@media(max-width:768px){
  .copilot{width:100vw;border-left:none}
}

/* 副驾回复 Markdown 渲染（B 层：让格式协议生效，仍先转义防 XSS） */
.md{font-size:13px;line-height:1.65;word-break:break-word}
.md p{margin:0 0 6px}
.md p:last-child{margin-bottom:0}
.md h1,.md h2,.md h3{margin:8px 0 4px;font-weight:600;line-height:1.3;color:var(--t1)}
.md-h1{font-size:1.05em}
.md-h2{font-size:1em}
.md-h3{font-size:.94em}
.md ul,.md ol{margin:4px 0;padding-left:20px}
.md li{margin:2px 0}
.md table{border-collapse:collapse;margin:6px 0;font-size:.9em;width:100%}
.md th,.md td{border:1px solid var(--b2,#e5e7eb);padding:4px 8px;text-align:left;vertical-align:top}
.md th{background:var(--bg2,#f3f4f6);font-weight:600}
.md blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid var(--p,#06b6d4);background:rgba(6,182,212,.06);color:var(--t2,#475569);border-radius:0 6px 6px 0}
.md hr{border:none;border-top:1px solid var(--b2,#e5e7eb);margin:8px 0}
.md code{background:var(--bg2,#f3f4f6);padding:1px 4px;border-radius:4px;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.md pre{background:var(--bg2,#f3f4f6);padding:8px;border-radius:6px;overflow-x:auto;margin:6px 0}
.md pre code{background:none;padding:0}
</style>
