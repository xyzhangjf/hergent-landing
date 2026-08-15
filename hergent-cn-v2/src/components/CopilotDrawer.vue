<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="store.ui.copilotOpen" class="cp-overlay" @click="close"></div>
    </Transition>
    <Transition name="slide">
      <aside v-if="store.ui.copilotOpen" class="copilot" :class="{ 'is-typing': store.chat.streaming }">
        <!-- 头部 -->
        <header class="cp-head">
          <div class="cp-brand">
            <span class="cp-ai">AI</span>
            <div class="cp-titles">
              <b>AI 经营副驾</b>
              <span class="cp-sub">Hermes · 随时在侧</span>
            </div>
          </div>
          <div class="cp-actions">
            <button class="cp-icon-btn" title="清空对话" :disabled="!store.chat.messages.length" @click="clear">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            <button class="cp-icon-btn" title="关闭" @click="close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </header>

        <!-- 对话流 -->
        <div class="cp-body" ref="cpBody">
          <div v-if="!store.chat.messages.length" class="cp-welcome">
            <div class="cp-w-ic">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
            </div>
            <p class="cp-w-title">问 AI 副驾任何经营问题</p>
            <p class="cp-w-sub">它会读你的真实数据回答</p>
            <div class="cp-w-chips">
              <button v-for="s in suggestions" :key="s" class="cp-chip" @click="ask(s)">{{ s }}</button>
            </div>
          </div>

          <div v-for="(m, i) in store.chat.messages" :key="i" class="msg" :class="m.role">
            <span v-if="m.role === 'assistant'" class="msg-avatar">AI</span>
            <div class="msg-col">
              <div class="msg-bubble">
                <template v-if="m.role === 'assistant' && m.content">{{ m.content }}</template>
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
            </div>
          </div>

          <div v-if="store.chat.error" class="msg-error">
            {{ store.chat.error }}<span class="err-hint">（请确认 Hermes API server 已启动并配置密钥）</span>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="cp-foot">
          <div class="cp-input-wrap">
            <textarea
              v-model="draft"
              class="cp-input"
              rows="1"
              placeholder="问返利、算货损、今天订什么货…"
              @keydown.enter.exact.prevent="send"
              @keydown="autoGrow"
              ref="cpInput"
            ></textarea>
            <button class="cp-send" :disabled="!draft.trim() || store.chat.streaming" @click="send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          </div>
          <div class="cp-foot-hint">Enter 发送 · Shift+Enter 换行</div>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { store } from '../store'
import { hermesChat, api } from '../api/client'

const draft = ref('')
const cpBody = ref(null)
const cpInput = ref(null)
const sources = ref([])
const openSources = ref(-1)

const suggestions = ['今天该订什么货？', '算一下这个月货损', '哪些客户该催款了？', '核对我该拿多少返利']

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
}

function ask(s) { draft.value = s; send() }

function autoGrow(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function scrollBottom() {
  nextTick(() => { if (cpBody.value) cpBody.value.scrollTop = cpBody.value.scrollHeight })
}

function send() {
  const q = draft.value.trim()
  if (!q || store.chat.streaming) return
  draft.value = ''
  nextTick(() => { if (cpInput.value) { cpInput.value.style.height = 'auto' } })
  store.chat.error = ''
  store.chat.messages.push({ role: 'user', content: q })
  store.chat.messages.push({ role: 'assistant', content: '' })
  store.chat.streaming = true
  scrollBottom()
  hermesChat(
    store.chat.messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
    { onDelta: (d, full) => { const last = store.chat.messages[store.chat.messages.length - 1]; if (last) last.content = full; scrollBottom() } }
  ).catch((e) => { store.chat.error = e.message || 'Hermes 未连接' })
   .finally(() => { store.chat.streaming = false })
}

/* 打开抽屉时聚焦输入框 */
watch(() => store.ui.copilotOpen, (v) => {
  if (v) nextTick(() => { if (cpInput.value) cpInput.value.focus() })
})

watch(() => store.chat.messages.length, scrollBottom)
</script>

<style scoped>
.copilot{
  position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);
  display:flex;flex-direction:column;
  background:var(--bg);border-left:1px solid var(--bd);
  box-shadow:-12px 0 40px rgba(0,0,0,.12);
  z-index:950;
}
.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:940}

.cp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.cp-brand{display:flex;align-items:center;gap:10px}
.cp-ai{width:32px;height:32px;border-radius:50%;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600}
.cp-titles{display:flex;flex-direction:column}
.cp-titles b{font-size:14px;font-weight:600;color:var(--t1)}
.cp-sub{font-size:11px;color:var(--t3);margin-top:1px}
.cp-actions{display:flex;gap:6px}
.cp-icon-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2);cursor:pointer}
.cp-icon-btn:hover:not(:disabled){background:var(--bg2);color:var(--t1)}
.cp-icon-btn:disabled{opacity:.35;cursor:default}

.cp-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.cp-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}
.cp-w-ic{width:56px;height:56px;border-radius:18px;background:var(--p-bg);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.cp-w-title{font-size:15px;font-weight:500;color:var(--t1);margin:0 0 4px}
.cp-w-sub{font-size:12px;color:var(--t3);margin:0 0 16px}
.cp-w-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.cp-chip{padding:7px 12px;border:1px solid var(--bd);border-radius:16px;background:var(--bg);font-size:12px;color:var(--t2);cursor:pointer;transition:all .15s}
.cp-chip:hover{border-color:var(--p-dark);color:var(--p-dark);background:var(--p-bg)}

.msg{display:flex;gap:8px;align-items:flex-end}
.msg.user{justify-content:flex-end}
.msg-avatar{width:26px;height:26px;border-radius:50%;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
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

.cp-foot{padding:12px 16px;border-top:1px solid var(--border-subtle);flex-shrink:0;background:var(--bg)}
.cp-input-wrap{display:flex;align-items:flex-end;gap:8px;border:1px solid var(--bd);border-radius:14px;padding:8px 8px 8px 14px;background:var(--bg3);transition:border-color .2s,box-shadow .2s}
.cp-input-wrap:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 3px var(--p-bg)}
.cp-input{flex:1;border:none;background:none;outline:none;resize:none;font-size:13px;line-height:1.5;max-height:120px;color:var(--t1);font-family:inherit}
.cp-send{width:32px;height:32px;border:none;border-radius:10px;background:var(--p-dark);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:opacity .15s}
.cp-send:disabled{opacity:.35;cursor:default}
.cp-foot-hint{font-size:11px;color:var(--t3);margin-top:6px;text-align:center}

/* 过渡 */
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.slide-enter-active,.slide-leave-active{transition:transform .25s ease}
.slide-enter-from,.slide-leave-to{transform:translateX(100%)}

@media(max-width:768px){
  .copilot{width:100vw;border-left:none}
}
</style>
