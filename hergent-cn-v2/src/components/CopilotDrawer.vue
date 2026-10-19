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
            <!-- v319b：顶栏头像必须与「输入框角色选择器」「消息头像」**同源**。
                 此前这里写死品牌 logo（`/favicon.svg`）⇒ 切角色时顶栏纹丝不动，
                 看起来像"三处头像各说各话"（老板实测截图发现）。
                 现在统一渲染**当前角色**的头像（自定义 PNG 优先，否则 emoji）。 -->
            <span class="cp-ai-img" :title="(currentRole && currentRole.name) || ''">
              <RoleAvatar :role="currentRole" img-class="cp-ai-img-png" fallback="🚀" />
            </span>
            <div class="cp-titles">
              <!-- v322b：标题也带上当前角色名（老板：「要不要标题也跟着显示角色名」→ 要）。
                   🔴 **additive**：产品名「AI 经营副驾」仍是主标题（品牌不能丢），角色名作为后缀标签；
                   🔴 **角色名与产品名重复时不渲染** —— 默认角色就叫「经营副驾」，
                      直接拼会得到「AI 经营副驾 · 经营副驾」（生产探针当场抓到的观感缺陷）。 -->
              <b>AI 经营副驾<span v-if="titleRoleSuffix" class="cp-title-role"> · {{ titleRoleSuffix }}</span></b>
            </div>
          </div>
          <div class="cp-actions">
            <button class="cp-icon-btn cp-art-toggle" title="本次产物" :class="{on:artOpen}" @click="artOpen ? hideArtifacts() : (artOpen = true)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              <span v-if="artifacts.length" class="cp-art-badge">{{ artifacts.length }}</span>
            </button>
            <button class="cp-icon-btn" :class="{on:showPager}" title="经营一页纸" @click="togglePager">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </button>
            <button class="cp-icon-btn" title="存为报告" :disabled="!hasChat || savingReport" @click="saveAsReport">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13h6M9 17h6"/></svg>
            </button>
            <button class="cp-icon-btn" title="历史会话" @click="toggleHistory">
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
          <!-- 跨会话检索（P2-⑤：搜历史对话） -->
          <div class="cp-hist-search">
            <input v-model="histQuery" class="cp-hist-q" placeholder="搜索历史对话…" @input="onHistSearch">
          </div>
          <div v-if="histHits.length" class="cp-hist-hits">
            <div v-for="h in histHits" :key="h.session_id" class="cp-hist-hit" @click="openSession(h.session_id)">
              <div class="cp-hist-title">{{ h.title || '（无标题）' }}</div>
              <div v-for="(sn, si) in h.snippets" :key="si" class="cp-hist-snippet">{{ sn }}</div>
            </div>
          </div>
          <div v-if="!store.chat.sessions.length && !histHits.length" class="state-empty">{{ store.chat.sessionsLoading ? '正在加载历史会话…' : '还没有历史会话' }}</div>
          <div v-else class="cp-hist-list">
            <div v-for="s in store.chat.sessions" :key="s.id" class="cp-hist-item" :class="{ on: s.id === store.chat.currentId }" @click="openSession(s.id)">
              <div class="cp-hist-title">{{ s.title }}</div>
              <div class="cp-hist-meta">
                <span v-if="roleNameOf(s.roleId)" class="cp-hist-role">{{ roleNameOf(s.roleId) }}</span>
                {{ fmtTime(s.updated_at) }}<template v-if="s.messages && s.messages.length"> · {{ s.messages.length }} 条</template>
              </div>
              <button class="cp-hist-del" title="删除" @click.stop="delSession(s.id)"><Icon name="close"/></button>
            </div>
          </div>
        </div>

        <!-- 双栏：左聊天 / 右产物（方案 B） -->
        <div v-show="!showHistory && !showPager" class="cp-split">
        <div class="cp-chat" :class="{'art-hidden': artFullscreen}">
        <!-- 对话流 -->
        <!-- v622：scroll 记录「离开时的位置」—— 抽屉是 v-if 挂载的，DOM 一销毁 scrollTop 就丢，
             重开必然停在顶部（用户实测：看到的是历史第一条）。详见下方 restoreScroll 注释。 -->
        <div class="cp-body" ref="cpBody" @scroll.passive="onBodyScroll">
          <!-- v488：进入副驾自动恢复最近会话期间的加载态，覆盖在对话流上，避免先闪现空白新对话 -->
          <div v-if="restoringSession" class="cp-restoring">
            <span class="cp-restoring-spin"></span>
            <span>正在恢复上次对话…</span>
          </div>
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

          <div v-for="(m, i) in store.chat.messages" :key="i" class="msg" :class="[m.role, m.isSwitch && 'is-switch']" :data-msg="i">
            <!-- v319（L2）角色切换分隔标记：整条退化为一行居中灰字（其余子节点由 CSS 隐藏） -->
            <div v-if="m.isSwitch" class="cp-switch-line">
              <span>{{ m.content }}</span>
              <button class="cp-switch-new" @click.stop="startNewFromSwitch"
                title="角色换了，另起一段干净对话（当前这段会存进历史）">新开对话</button>
              <!-- v320：这个角色的历史会话。**只挂在"当前角色"的那条分隔标记上**
                   （老标记不显示，否则切一轮回来会冒出好几个同名按钮），
                   且已经在那条会话里时也不显示（否则是让人原地打转）。 -->
              <button v-if="resumeTarget && m.switchTo === (currentRole && currentRole.role_id)"
                class="cp-switch-resume" @click.stop="resumeSession"
                :title="`回到「${(currentRole && currentRole.name) || ''}」上次那段对话`">
                接着《{{ resumeTarget.title }}》聊
              </button>
            </div>
            <!-- v523：助手回复顶部信息区 = 头像(居左) + 角色名(紧邻右侧) + 时间；与下方正文保留间距。
                 用消息自带的角色快照 m.roleMeta（不读 currentRole），避免切角色后历史署名被追溯改写。 -->
            <div v-else-if="m.role === 'assistant'" class="msg-head">
              <span class="msg-avatar" :title="(m.roleMeta && m.roleMeta.name) || 'AI'">
                <RoleAvatar :role="m.roleMeta || currentRole" img-class="msg-av-img" fallback="AI" />
              </span>
              <span class="msg-role">{{ (m.roleMeta && m.roleMeta.name) || (currentRole && currentRole.name) || 'AI' }}</span>
              <span class="msg-time" v-if="m.created_at">{{ fmtMsgTime(m.created_at) }}</span>
            </div>
            <div class="msg-col">
              <!-- v495b：每条消息显示沟通时间（绝对时间，便于回看历史）；
                   助手回复时间已上移至顶部信息区，此处仅用户消息仍显示在正文首行。 -->
              <div class="msg-time" v-if="m.created_at && m.role !== 'assistant'">{{ fmtMsgTime(m.created_at) }}</div>
              <!-- 深度思考（推理流）：默认折叠，点开看模型想什么。对齐 WorkBuddy 的「深度思考」。 -->
              <div v-if="m.reasoning" class="msg-think">
                <button class="mt-hd" @click="toggleThink(i)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 00-3.6 10.8V17h7.2v-3.2A6 6 0 0012 3z"/><path d="M9.5 20.5h5"/></svg>
                  <span>深度思考</span>
                  <span class="mt-n">{{ m.reasoning.length }} 字</span>
                  <svg class="mt-caret" :class="{ open: openThink === i }" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                <div v-if="openThink === i" class="mt-body">{{ m.reasoning }}</div>
              </div>
              <div class="msg-bubble">
                <div v-if="m.role === 'assistant' && m.content" class="md" v-html="renderMd(mediaView(m.content).text)" @click="onCopilotTocClick" @change="onCopilotControl"></div>
                <!-- 等待动画：只在「正在流式 + 这是最后一条 + 还没收到内容」时显示。
                     判据必须带上 streaming —— 请求超时/报错/取消时 streaming 立刻变 false，
                     组件随之卸载，不会留在气泡里一直跳（原先只看内容为空，中断后会常驻）。 -->
                <ThinkingDots
                  v-else-if="m.role === 'assistant' && store.chat.streaming && i === store.chat.messages.length - 1"
                  text="思考中…"
                />
                <template v-else>{{ m.content }}</template>
                <!-- v309：用户主动停止的标记。对齐 WorkBuddy 的 `message.interrupted`（任务被中断）——
                     中断后**保留**已生成内容，只在末尾附一个中性标记，不弹错误、不删气泡。 -->
                <div v-if="m.role === 'assistant' && m.stopped" class="cp-stopped" role="status">
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>
                  <span>已停止生成</span>
                </div>
                <!-- v301：副驾产出的文件（Hermes `MEDIA:` 标记）→ 可直接下载/打开。
                     原先 Web 端只显示一串服务器路径（企微客户端里却能点开），就是这个缺口。
                     v306：🔴 下载**必须**走 downloadAuthed()（带 Authorization 头取 blob）——
                     裸 <a href> 是普通链接跳转，不带鉴权头 ⇒ 端点回 401 ⇒ Chrome 下载中断。
                     详见 downloadAuthed 注释。href 保留只为「右键复制链接」语义，点击一律拦截。 -->
                <a
                  v-for="(f, fi) in mediaFiles(m)"
                  :key="fi"
                  class="cp-art-file msg-file"
                  :href="mediaHref(f.path)"
                  :download="f.name"
                  @click.prevent="downloadAuthed(mediaHref(f.path), f.name)"
                >
                  <span class="cp-art-file-ic">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                  </span>
                  <span class="cp-art-file-tx">
                    <span class="cp-art-file-name">{{ f.name }}</span>
                    <span class="cp-art-file-meta">副驾产出 · 点击下载</span>
                  </span>
                  <svg class="cp-art-file-dl" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
                <!-- v492：用户**上传**给副驾的附件 —— 留在沟通面板（气泡）里，可下载回看。
                     🔴 它**不**再登记进侧栏产物区（产物区语义 = 副驾的交付物；用户上传物属**输入**）。
                     挪到气泡而非直接删，是为了**不静默丢失下载能力**（原下载入口只在侧栏那张卡上）。
                     端点走 chat-attachment/download（按 file_id、需鉴权），故同样 click→downloadAuthed。 -->
                <a
                  v-for="(uf, ufi) in (m.files || [])"
                  :key="'uf' + ufi"
                  class="cp-art-file msg-file"
                  :href="`/api/chat-attachment/download/${uf.file_id}`"
                  :download="uf.file_name"
                  @click.prevent="downloadAuthed(`/api/chat-attachment/download/${uf.file_id}`, uf.file_name)"
                >
                  <span class="cp-art-file-ic">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                  </span>
                  <span class="cp-art-file-tx">
                    <span class="cp-art-file-name">{{ uf.file_name }}</span>
                    <span class="cp-art-file-meta">{{ uf.rows ? uf.rows + ' 行 · ' : '' }}我上传的 · 点击下载</span>
                  </span>
                  <svg class="cp-art-file-dl" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
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
              <!-- 结构化经营结果卡 -->
              <ResultCard v-if="m.card" :card="m.card" @action="onCardAction" />

              <!-- AI 调用工具的过程 —— 对齐 WorkBuddy 的节奏：
                   **回复中自动展开**显示每一步（执行中 / 已完成 耗时）；
                   **回复结束自动收起**，只留答案 + 一行可点开的摘要。
                   数据来自 Hermes 的 `hermes.tool.progress` 事件（此前事件名对不上、被全丢）。 -->
              <div v-if="m.tools && m.tools.length" class="msg-tools" :class="{ folded: !toolsOpen(i), live: toolsLive(i) }">
                <button class="cp-tools-hd" @click="toggleTools(i)">
                  <svg v-if="toolsLive(i)" class="cp-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
                  <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{{ toolsLive(i) ? '正在执行' : '工具执行情况' }}</span>
                  <span class="cp-tools-n">{{ m.tools.filter(t => t.status === 'done').length }} / {{ m.tools.length }} 步</span>
                  <span class="cp-tools-t">{{ toolsElapsed(m) }}</span>
                  <svg class="cp-tools-caret" :class="{ open: toolsOpen(i) }" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                <div v-if="toolsOpen(i)" class="cp-tools-body">
                  <div v-for="(t, ti) in m.tools" :key="ti" class="cp-tool" :class="t.status">
                    <span class="cp-tool-ic">
                      <svg v-if="t.status === 'running'" class="cp-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
                      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                    <span class="cp-tool-name">{{ t.emoji ? t.emoji + ' ' : '' }}{{ t.label || t.name }}</span>
                    <span class="cp-tool-st">{{ t.status === 'running' ? '执行中' : (t.ms ? '已完成 ' + fmtMs(t.ms) : '已完成') }}</span>
                  </div>
                </div>
              </div>

              <!-- 渐进式访谈引导（M2） -->
              <div v-if="m.followups && m.followups.length" class="cp-followups">
                <button v-for="(f, fi) in m.followups" :key="fi" class="cp-fubtn" @click="askFollowup(f)">{{ f.label || f }}</button>
              </div>

              <!-- 主动澄清（P0-①：信息不足时 AI 反问 + 结构化选项） -->
              <div v-if="m.clarify && ((m.clarify.questions && m.clarify.questions.length) || (m.clarify.options && m.clarify.options.length))" class="cp-clarify">
                <!-- v486 P1-⑥ 多组：一次问多个问题，老板在一屏内逐个拍板 -->
                <template v-if="m.clarify.questions">
                  <div class="cp-clarify-qhd">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    需要你定 {{ m.clarify.questions.length }} 件事
                  </div>
                  <div v-for="(q, qi) in m.clarify.questions" :key="qi" class="cp-clarify-grp">
                    <div class="cp-clarify-ask">
                      <span class="cp-clarify-no">{{ qi + 1 }}</span>
                      <span>{{ q.ask }}</span>
                    </div>
                    <div class="cp-clarify-opts">
                      <button v-for="(o, oi) in q.options" :key="oi" class="cp-clarify-opt" @click="askFollowup(o)">{{ o.label }}</button>
                    </div>
                  </div>
                </template>
                <!-- 单主题（旧协议，逐字保留） -->
                <template v-else>
                  <div class="cp-clarify-ask">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    {{ m.clarify.ask }}
                  </div>
                  <div class="cp-clarify-opts">
                    <button v-for="(o, oi) in m.clarify.options" :key="oi" class="cp-clarify-opt" @click="askFollowup(o)">{{ o.label }}</button>
                  </div>
                </template>
              </div>

              <!-- 配方自进化提案 / 执行计划闸门（P2-⑦ 单条配方 + v483 多步计划） -->
              <div v-if="m.proposal" class="cp-proposal" :class="m.proposalStatus">
                <!-- v483：多步执行计划（AI 先列清单，点「执行计划」才按序真调写接口） -->
                <template v-if="m.proposal.steps">
                  <div class="cp-prop-hd">
                    <svg class="cp-prop-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    <span class="cp-prop-title">{{ m.proposal.title || 'AI 执行计划' }}</span>
                    <span v-if="m.proposal.module" class="cp-prop-module">{{ MODULE_LABEL[m.proposal.module] || m.proposal.module }}</span>
                  </div>
                  <ol class="cp-plan-steps">
                    <li v-for="(s, i) in m.proposal.steps" :key="i" class="cp-plan-step" :class="stepClass(s)">
                      <span class="cp-step-dot"></span>
                      <span class="cp-step-tx">{{ i + 1 }}. {{ s.action }}<template v-if="s.target"> → {{ s.target }}</template><template v-if="s.detail">（{{ s.detail }}）</template></span>
                    </li>
                  </ol>
                  <div v-if="m.proposal.rationale" class="cp-prop-rationale">{{ m.proposal.rationale }}</div>
                  <div v-if="!m.proposalStatus" class="cp-prop-ops">
                    <button class="cp-prop-btn ghost" :disabled="m.propBusy || aiMode === 'readonly'" @click="cancelPlan(m)">取消</button>
                    <button class="cp-prop-btn primary" :disabled="m.propBusy || aiMode === 'readonly'" @click="applyPlan(m)">{{ m.propBusy ? '执行中…' : '执行计划' }}</button>
                  </div>
                  <div v-else class="cp-prop-done" :class="{ rej: m.proposalStatus === 'rejected' }">
                    <svg v-if="m.proposalStatus === 'accepted'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    {{ proposalDoneText(m) }}
                  </div>
                </template>
                <!-- 单条配方提案（原逻辑，向后兼容 P2-⑦） -->
                <template v-else>
                  <div class="cp-prop-hd">
                    <svg class="cp-prop-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    <span class="cp-prop-title">{{ m.proposal.title || 'AI 建议调整配方' }}</span>
                    <span class="cp-prop-module">{{ MODULE_LABEL[m.proposal.module] || m.proposal.module }}</span>
                  </div>
                  <div class="cp-prop-changes">
                    <span v-for="(v, k) in m.proposal.changes" :key="k" class="cp-prop-change">{{ FIELD_LABEL[k] || k }}：{{ v }}</span>
                  </div>
                  <div v-if="m.proposal.rationale" class="cp-prop-rationale">{{ m.proposal.rationale }}</div>
                  <div v-if="!m.proposalStatus" class="cp-prop-ops">
                    <button class="cp-prop-btn ghost" :disabled="m.propBusy" @click="applyProposal(m, 'reject')">忽略</button>
                    <button class="cp-prop-btn primary" :disabled="m.propBusy" @click="applyProposal(m, 'accept')">{{ m.propBusy ? '处理中…' : '采纳并写入配方' }}</button>
                  </div>
                  <div v-else class="cp-prop-done" :class="{ rej: m.proposalStatus === 'rejected' }">
                    <svg v-if="m.proposalStatus === 'accepted'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    {{ proposalDoneText(m) }}
                  </div>
                </template>
              </div>

              <!-- AI 待办提醒（P0-②：AI 识别「要记得/提醒」→ 记下，到点推送） -->
              <div v-if="m.reminder" class="cp-reminder" :class="m.reminderStatus">
                <div class="cp-rem-hd">
                  <svg class="cp-rem-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  <span class="cp-rem-title">{{ m.reminder.title }}</span>
                  <span class="cp-rem-time">{{ m.reminder.remind_at }}{{ m.reminder.repeat ? ' · 重复' : '' }}</span>
                </div>
                <div v-if="!m.reminderStatus" class="cp-prop-ops">
                  <button class="cp-prop-btn ghost" @click="applyReminder(m, 'cancel')">不用记</button>
                  <button class="cp-prop-btn primary" @click="applyReminder(m, 'save')">记下提醒</button>
                </div>
                <div v-else-if="m.reminderStatus === 'saved'" class="cp-prop-done">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  已记下提醒，到点会推送给你
                </div>
              </div>

              <!-- v423：单轮对话底部操作栏（对齐 WorkBuddy message-actions）：
                   复制 / 点赞 / 点踩 / 朗读 / 重新生成 / 分享 + 当前模型标识。
                   只在「有内容且非正在流式输出的最后一条」时显示（流式时只露出气泡，避免干扰）。 -->
              <div v-if="m.role === 'assistant' && m.content && !(store.chat.streaming && i === store.chat.messages.length - 1)" class="cp-msg-actions">
                <button class="cp-act" title="复制" @click="copyMsg(m)">
                  <Icon name="copy" :size="16" />
                </button>
                <!-- v451：点赞/点踩对齐 WorkBuddy 的 ratingButton —— 尺寸/圆角/hover 用 .cp-rate 覆盖，
                     选中态靠「线框 → 实心」图标切换表达（不靠变色，同 WorkBuddy 的 RatingBar）。 -->
                <button class="cp-act cp-rate" :class="{ on: m.feedback === 'good' }" :aria-pressed="m.feedback === 'good'" title="点赞" @click="toggleFeedback(m, 'good')">
                  <Icon :name="m.feedback === 'good' ? 'thumbs-up-filled' : 'thumbs-up'" :size="16" />
                </button>
                <button class="cp-act cp-rate" :class="{ on: m.feedback === 'bad' }" :aria-pressed="m.feedback === 'bad'" title="点踩" @click="toggleFeedback(m, 'bad')">
                  <Icon :name="m.feedback === 'bad' ? 'thumbs-down-filled' : 'thumbs-down'" :size="16" />
                </button>
                <button class="cp-act" :class="{ on: readingId === i }" :title="readingId === i ? '停止朗读' : '朗读'" @click="toggleRead(m, i)">
                  <Icon :name="readingId === i ? 'volume-x' : 'volume-2'" :size="16" />
                </button>
                <button class="cp-act" title="重新生成" :disabled="store.chat.streaming" @click="regenerate(i)">
                  <Icon name="rotate-ccw" :size="16" />
                </button>
                <div class="cp-share">
                  <button class="cp-act" :class="{ on: shareOpen === i }" title="分享" @click.stop="toggleShare(i)">
                    <Icon name="share-2" :size="16" />
                  </button>
                  <div v-if="shareOpen === i" class="cp-share-menu" @click.stop>
                    <button @click="shareCopy(m, 'reply')">复制回复</button>
                    <button @click="shareCopy(m, 'qa')">复制问答</button>
                    <button @click="shareCopyLink()">复制页面链接</button>
                    <button @click="shareQR()">生成二维码</button>
                  </div>
                </div>
                <div v-if="qrUrl" class="cp-qr" @click.stop>
                  <img :src="qrUrl" alt="二维码" />
                  <p>用微信「扫一扫」打开此页，再点右上角「···」分享到聊天或朋友圈</p>
                  <button class="cp-qr-close" @click="qrUrl = null">关闭</button>
                </div>
                <div v-if="shareOpen === i || qrUrl" class="cp-share-backdrop" @click="shareOpen = null; qrUrl = null"></div>
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
          <!-- v319（L2）：常驻一行「将由谁回答」。作用有两个 ——
               ① 切角色后**立刻能确认生效**（此前只有左下角胶囊变了个名字）；
               ② 把这个角色的能力边界讲在明处（技能数 / 数据域数 / 执行档），
                  老板不必去设置里翻，就知道"现在这个 AI 能干什么"。
               ⚠️ 未配置能力的角色（存量）不显示摘要 ⇒ 界面与升级前逐字相同。 -->
          <div class="cp-who">
            <!-- v322：这里原来**只打印 emoji** ⇒ 明明有 3D 头像也显示 🚀（老板实测发现）。
                 统一走 RoleAvatar（唯一渲染口），与顶栏/胶囊/消息头像同源。 -->
            <span class="cp-who-av"><RoleAvatar :role="currentRole" img-class="cp-who-av-img" fallback="🚀" /></span>
            <span class="cp-who-t">将由「{{ (currentRole && currentRole.name) || '经营副驾' }}」回答</span>
            <span class="cp-who-tag" :class="effectiveGuard">{{ effectiveGuard === 'advise' ? '只给建议' : '可执行' }}</span>
            <span v-if="capSummary" class="cp-who-cap">{{ capSummary }}</span>
          </div>
          <!-- 待发送附件 -->
          <div v-if="attachments.length || uploading" class="cp-atts">
            <div v-if="uploading" class="cp-att cp-att-loading">
              <span class="cp-att-spin"><Icon name="loader"/></span>
              <span class="cp-att-name">上传解析中…</span>
            </div>
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

          <!-- Composer 卡片（WorkBuddy 范式：文本区独占整行 + 工具条两端锚定） -->
          <div class="cp-composer">
            <!-- M1 斜杠命令：输入 / 唤起快捷指令面板（复用命令面板的分组/键盘/权限范式） -->
            <div v-if="slashOpen" class="cp-slash" role="listbox" aria-label="快捷指令">
              <div class="cp-slash-hd">
                <span>快捷指令</span>
                <span class="cp-slash-kbd"><kbd>↑↓</kbd> 选择 · <kbd>↵</kbd> 执行 · <kbd>Esc</kbd> 关闭</span>
              </div>
              <template v-for="(c, i) in slashMatches" :key="c.cmd">
                <div v-if="i === 0 || slashMatches[i - 1].group !== c.group" class="cp-slash-group">{{ c.group }}</div>
                <button type="button" class="cp-slash-item" :class="{ active: i === slashIndex }"
                  @mousemove="slashIndex = i" @mousedown.prevent="pickSlash(c)">
                  <span class="cp-slash-ic"><Icon :name="c.icon" :size="15" /></span>
                  <span class="cp-slash-cmd">{{ c.cmd }}</span>
                  <span class="cp-slash-title">{{ c.title }}</span>
                  <span v-if="c.hint" class="cp-slash-hint">{{ c.hint }}</span>
                </button>
              </template>
            </div>
            <!-- 第一层：文本区，width:100%，不再与控件争宽度 -->
            <textarea
              v-model="draft"
              class="cp-input"
              rows="1"
              placeholder="输入 / 唤起快捷指令，或直接问返利、算货损…"
              aria-label="向 AI 经营副驾提问"
              @keydown="onComposerKeydown"
              @input="autoGrow"
              ref="cpInput"
            ></textarea>
            <!-- 只看**字数**：有内容时才出现（纯文字、无术语）。
                 🔴 空态**不显示快捷键提示**（2026-09-25 老板指出）：原来的「⏎ 发送 · ⇧⏎ 换行」
                    用的是键盘符号，**经销商看不懂**——正是"别给老板看他不认识的东西"。
                    回车发送属通用习惯，占位文字「输入 / 唤起快捷指令，或直接问…」已足够指路。 -->
            <span v-if="draft.trim()" class="cp-inhint" aria-hidden="true">{{ draft.length }} 字</span>
            <!-- 第二层：工具条，左=输入手段 / 右=提交动作 -->
            <div class="cp-toolbar">
              <div class="cp-tools">
                <!-- 「＋」= 菜单（对齐 WorkBuddy 的 addMenu）：让老板知道**能给 AI 什么**。
                     三项都走同一个 onFile 流程，只是预筛类型不同（不塞假条目）。 -->
                <div class="cp-add">
                  <button class="cp-plus" @click.stop="toggleAddMenu" title="给 AI 一份材料" aria-label="给 AI 一份材料">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                  <input ref="fileInput" type="file" :accept="fileAccept" style="display:none" @change="onFile">
                  <div v-if="showAddMenu" class="cp-role-menu cp-add-menu">
                    <div class="cp-role-menu-hd">给 AI 一份材料</div>
                    <div class="cp-role-item" @click.stop="pickAdd('sheet')">
                      <div class="cp-role-item-tx">
                        <div class="cp-role-item-name">上传表格</div>
                        <div class="cp-role-item-desc">Excel / CSV，能自动识别并生成经营卡</div>
                      </div>
                    </div>
                    <div class="cp-role-item" @click.stop="pickAdd('image')">
                      <div class="cp-role-item-tx">
                        <div class="cp-role-item-name">上传图片</div>
                        <div class="cp-role-item-desc">截图或照片，AI 能看懂画面内容</div>
                      </div>
                    </div>
                    <div class="cp-role-item" @click.stop="pickAdd('file')">
                      <div class="cp-role-item-tx">
                        <div class="cp-role-item-name">上传文件</div>
                        <div class="cp-role-item-desc">PDF、文本等其它格式</div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- 团队胶囊：会话级配置，＋ 之后 -->
                <div class="cp-role" @click.stop="toggleRoleMenu" role="button" aria-label="切换 AI 团队">
                  <span class="cp-role-av">
                    <RoleAvatar :role="currentRole" img-class="cp-role-av-img" fallback="🚀" />
                  </span>
                  <span class="cp-role-name">{{ (currentRole && currentRole.name) || '经营副驾' }}</span>
                  <svg class="cp-role-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                  <div v-if="showRoleMenu" class="cp-role-menu">
                    <div class="cp-role-menu-hd">切换 AI 团队</div>
                    <div v-for="r in activeRoles" :key="r.role_id" class="cp-role-item" :class="{ on: r.role_id === store.chat.currentRole }" @click.stop="pickRole(r)">
                      <span class="cp-role-item-av">
                        <RoleAvatar :role="r" img-class="cp-role-item-av-img" fallback="AI" />
                      </span>
                      <div class="cp-role-item-tx">
                        <div class="cp-role-item-name">{{ r.name }}</div>
                        <div class="cp-role-item-desc">{{ r.opening }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- AI 权限（对齐 WorkBuddy 的 permission chip：**把解释摆在台面上**，不藏在 hover 提示里）
                     ⚠️ 语义澄清：aiGuard 是**提示级软开关**（影响提示词）；真正的硬门禁是服务端
                     `ai_mode`（readonly / disabled，后端拦截写操作）。只读时这里禁用并强制只给建议。 -->
                <div class="cp-guard">
                  <button class="cp-guard-btn" :class="{ on: effectiveGuard === 'execute' }" @click.stop="toggleGuardMenu"
                    :disabled="aiMode === 'readonly' || roleGuardLocked"
                    :title="roleGuardLocked
                      ? ('这个由「' + ((currentRole && currentRole.name) || '当前角色') + '」的角色决定，去「设置 › AI 团队」里改')
                      : (aiMode === 'readonly' ? '只读模式：AI 仅给建议，不可放开' : 'AI 可以怎么做？点开选择')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
                    {{ effectiveGuard === 'advise' ? '只给建议' : '可直接执行' }}
                    <svg class="cp-guard-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                  <div v-if="showGuardMenu" class="cp-role-menu cp-guard-menu">
                    <div class="cp-role-menu-hd">AI 可以怎么做<span v-if="roleGuardLocked" class="cp-hd-note">· 由「{{ (currentRole && currentRole.name) || '当前角色' }}」决定</span></div>
                    <div class="cp-role-item" :class="{ on: effectiveGuard === 'advise', locked: roleGuardLocked }" @click.stop="pickGuard('advise')">
                      <div class="cp-role-item-tx">
                        <div class="cp-role-item-name">只给建议</div>
                        <div class="cp-role-item-desc">只算给你看，不替你下单、收款、改档案</div>
                      </div>
                    </div>
                    <div class="cp-role-item" :class="{ on: effectiveGuard === 'execute', locked: aiMode === 'readonly' || roleGuardLocked }"
                      @click.stop="pickGuard('execute')">
                      <div class="cp-role-item-tx">
                        <div class="cp-role-item-name">可直接执行</div>
                        <div class="cp-role-item-desc">{{ roleGuardLocked ? '这个角色的权限档在「设置 › AI 团队」里配' : (aiMode === 'readonly' ? '后台已设只读，暂不可选' : '可以真的下单、收款、改档案') }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- v461：朗读声音选择 —— 让老板自己挑「念给他听」的声音。
                     放在「AI 可以怎么做」之后：二者同属「会影响副驾表现」的设置，胶囊形态一致（图标+当前值+下拉箭头）。
                     🔴 可选项**只有一个来源** = 后端 `GET /api/ai/tts/voices`（音色白名单与默认值都在后端定义），
                        前端**不另抄一份名单** —— 否则后端加/换音色时前端不认，界面显示与真实可用的声音会脱节。 -->
                <div class="cp-ttsv">
                  <button class="cp-ttsv-btn" :class="{ on: showVoiceMenu }" @click.stop="toggleVoiceMenu"
                    :title="'朗读声音：' + (ttsVoiceName || '默认') + '（点开选择）'" aria-label="选择朗读声音">
                    <Icon name="volume-2" :size="12" />
                    <span class="cp-ttsv-tx">{{ ttsVoiceName || '朗读声音' }}</span>
                    <svg class="cp-guard-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                  <div v-if="showVoiceMenu" class="cp-role-menu cp-ttsv-menu">
                    <div class="cp-role-menu-hd">朗读声音<span class="cp-hd-note">· 选好后，下次朗读就用它</span></div>
                    <div v-if="ttsVoicesLoading" class="cp-role-item locked">
                      <div class="cp-role-item-tx"><div class="cp-role-item-name">正在读取声音列表…</div></div>
                    </div>
                    <template v-else>
                      <div v-for="v in ttsVoiceOptions" :key="v.id" class="cp-role-item"
                        :class="{ on: v.id === ttsVoice }" @click.stop="pickTtsVoice(v)">
                        <div class="cp-role-item-tx">
                          <div class="cp-role-item-name">{{ v.name }}</div>
                          <div v-if="voiceDesc(v)" class="cp-role-item-desc">{{ voiceDesc(v) }}</div>
                        </div>
                      </div>
                      <div v-if="ttsVoicesErr" class="cp-ttsv-err">声音列表读取失败，暂时只能用「{{ ttsVoiceName || '默认声音' }}」</div>
                    </template>
                  </div>
                </div>
                <!-- 🔴 v281（2026-09-26）此处的「自动降级 / 直连通道」开关已**整条撤除**。
                     原因（实测）：它不是用户偏好，而是**通道选择**，且"关"的那一侧会绕过后端的
                     AI 停用管控（`ai_mode` 只在后端代理这条路上做权威判定）；更严重的是那条"直连"
                     路径（nginx `/hermes/`）原本是**对公网零鉴权直通生产网关**，实测外网不带凭据
                     即可在服务器上执行命令 ⇒ 已封堵，前端亦无存在的必要。
                     现在恒定走 `/api/ai/copilot/chat`（后端直连 127.0.0.1:18765，凭据只在服务端）。 -->
              </div>
              <div class="cp-trailing">
                <!-- 🔴 模型选择已于 2026-09-25 下架（老板选 B）。
                     原因：Hermes 的 `model_routes` 未配置 ⇒ 请求里的 model **匹配不到路由、静默回落默认模型**
                     （服务端账本 `session_model_usage` 只有 deepseek-v4-flash 可证）⇒
                     放在界面上就是**静默无效**的控件，点了没反应也不报错。宁可不给。
                     恢复步骤见 outputs/输入框对比-2026-09-25/ 报告 §9.6.4b。 -->
                <button class="cp-voice" :class="{ on: recognizing }" title="语音输入" aria-label="语音输入" @click="toggleVoice">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
                </button>
                <button class="cp-snap" :class="{ busy: snapping }" title="截图" aria-label="截图" :disabled="snapping" @click="captureScreenshot">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/></svg>
                </button>
                <!-- 🔴 v309（2026-09-28）发送 / 停止 = **同一个按钮**（对齐 WorkBuddy 的 SendButton）。
                     对照要点：① `handleClick` 按 loading 分流到 onStop/onSend；
                     ② loading 时**不再 disabled**（WB 的 effectiveDisabled 写成
                        `(loading && cancelDisabled) || (disabled && !loading)`）——
                        原先我们的 `:disabled` 里带着 `store.chat.streaming`，
                        正是「消息发出后无法停止」的病根；
                     ③ 只换图形不换色（WB 的停止态与发送态同色）；
                     ④ 二次确认时按钮位置显示快捷键标签（WB: send-button__stop-confirm-label，11px/600）。 -->
                <button
                  class="cp-send"
                  :class="{ 'is-stop': canStop, 'is-busy': store.chat.streaming && !canStop }"
                  :disabled="canStop ? false : ((!draft.trim() && !attachments.length) || store.chat.streaming || aiMode === 'disabled')"
                  :title="canStop ? stopHint : '发送'"
                  :aria-label="canStop ? stopHint : '发送'"
                  @click="canStop ? stopReply() : send()"
                >
                  <span v-if="stopConfirm && canStop" class="cp-send-esc">Esc</span>
                  <!-- 停止：实心圆角方块。几何照抄 WorkBuddy 的 STOP_PATH ——
                       在其 32×32 圆盘里方块是 `M13 10 …H19…V13` ⇒ 边长 12/32、圆角 3，
                       我们按钮同为 32px，故直接用同尺寸 viewBox 1:1 复刻。 -->
                  <svg v-else-if="canStop" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                    <rect x="10" y="10" width="12" height="12" rx="3" fill="currentColor"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
              </div>
            </div>
          </div>
          <!-- v408：AI 生成内容免责提示 —— 常驻于**聊天输入框下方**（composer 之后、模式横幅之前）。
               展示位置：footer 内、输入框卡片正下方，整行居中、低对比灰字，不抢视线。
               触发逻辑：抽屉打开即常驻显示（每次进入副驾都能看到），不依赖是否已发问/已收到回复 ——
                       与 ChatGPT/Claude 的「AI 可能犯错」提示同范式（被动免责，而非条件触发）。
                       若日后想改成「仅在收到首条 AI 回复后显示」，把 v-if 换成
                       `v-if="store.chat.messages.some(m => m.role === 'assistant')"` 即可。 -->
          <div class="cp-ai-note" role="note" aria-live="polite">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span>内容由AI生成，请核实重要信息</span>
          </div>
          <div v-if="queueHint" class="cp-queue-hint" role="status" aria-live="polite">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>{{ queueHint }}</span>
          </div>
          <div v-if="aiMode === 'disabled'" class="cp-mode-banner disabled">AI 已停用（后台设置）。当前无法对话，请联系管理员开启。</div>
        <div v-else-if="aiMode === 'readonly'" class="cp-mode-banner readonly">只读模式：AI 仅给建议，不会执行任何写操作。</div>
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
            <!-- v486 P1-⑤：产物 / 待办 双分页 —— AI 记下的待办不再「记完就消失」，
                 在这里看得见、能完成、能删掉。 -->
            <div class="cp-art-tabs" role="tablist">
              <button class="cp-art-tab" :class="{ on: artTab === 'art' }" role="tab" :aria-selected="artTab === 'art'" @click="artTab = 'art'">
                本次产物 <span class="cp-art-count">{{ artifacts.length }}</span>
              </button>
              <button class="cp-art-tab" :class="{ on: artTab === 'todo' }" role="tab" :aria-selected="artTab === 'todo'" @click="openTodoTab">
                我的待办 <span v-if="todos.length" class="cp-art-count">{{ todos.length }}</span>
              </button>
            </div>
            <div class="cp-art-ops">
              <button v-if="artTab === 'todo'" class="cp-icon-btn" title="刷新待办" @click="loadTodos">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
              </button>
              <button class="cp-icon-btn" :title="artFullscreen ? '退出区域全屏' : '区域全屏'" @click="toggleArtFullscreen">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m13-5v3a2 2 0 01-2 2h-3"/></svg>
              </button>
              <button class="cp-icon-btn" title="收起产物区" @click="hideArtifacts">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="cp-art-body">
            <!-- v486 P1-⑤：待办分页 -->
            <template v-if="artTab === 'todo'">
              <div v-if="todoLoading" class="state-empty">正在加载待办…</div>
              <div v-else-if="todoErr" class="state-empty">
                {{ todoErr }}
                <button class="cp-art-tab" style="margin-top:8px" @click="loadTodos">重试</button>
              </div>
              <div v-else-if="!todos.length" class="state-empty">
                目前没有待办<br/>跟副驾说「记得提醒我…」，它记下的事会出现在这里
              </div>
              <div v-for="t in todos" :key="t.id" class="cp-todo">
                <div class="cp-todo-main">
                  <span class="cp-todo-title">{{ t.title }}</span>
                  <span v-if="t.remind_at" class="cp-todo-time">{{ t.remind_at }}<span v-if="t.repeat_rule"> · {{ repeatText(t.repeat_rule) }}</span></span>
                </div>
                <div class="cp-todo-ops">
                  <button class="cp-icon-btn" title="标记完成" @click="todoDone(t)">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <button class="cp-icon-btn" title="删除" @click="todoRemove(t)">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </div>
              </div>
            </template>
            <template v-else>
            <div v-if="!artifacts.length" class="state-empty">
              副驾产出的报告、图表、文件会沉淀在这里<br/>随时回看，不随对话滚走
            </div>
            <div
              v-for="a in artifacts"
              :key="a.produced ? ('p' + a.produced.path) : ('c' + a.index)"
              class="cp-art-item"
              @click="jumpTo(a.index)"
            >
              <div class="cp-art-meta" v-if="a.created_at || a.source">
                <span v-if="a.created_at">{{ fmtArtTime(a.created_at) }}</span><span v-if="a.source"> · 来自「{{ a.source }}」</span>
              </div>
              <ResultCard v-if="a.card" :card="a.card" :compact="true" @action="onCardAction" />
              <!-- 🔴 v492：用户**上传**的附件（a.file）不再进产物区 —— 已从 artifacts 集合移除，
                   此处原先渲染「用户上传附件」的预览/下载卡。用户上传物属**输入**、不是副驾产物，
                   只在对话流（气泡 content 的「【附件：…】」）里出现。
                   保留此注释，避免后人误把用户附件重新登记回产物集合。 -->
              <!-- v489：副驾**产出文件**（MEDIA: 标记）的产物项 —— 与上面「用户上传附件」并列展示，
                   但取数走 `/api/ai/media`（按路径、需鉴权）而非 chat-attachment（按 file_id）。
                   对齐 WorkBuddy 结果区：图片/视频/HTML 先内联预览，其余给下载入口。 -->
              <template v-else-if="a.produced">
                <div v-if="isPreviewable(a.produced)" class="cp-art-prev">
                  <img v-if="isImage(a.produced)" class="cp-art-img" :src="producedPreviewSrc(a.produced.path) || undefined" :alt="a.produced.name" @click.stop="zoomProduced(a.produced.path)" />
                  <video v-else-if="isVideo(a.produced)" class="cp-art-video" :src="producedPreviewSrc(a.produced.path) || undefined" controls preload="metadata" @click.stop></video>
                  <iframe v-else-if="isHtml(a.produced)" class="cp-art-frame" sandbox="allow-scripts" :src="producedPreviewSrc(a.produced.path) || undefined" @click.stop></iframe>
                  <a class="cp-art-dl-row" :href="mediaHref(a.produced.path)" :download="a.produced.name" @click.stop.prevent="downloadAuthed(mediaHref(a.produced.path), a.produced.name)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>下载原文件</span>
                  </a>
                </div>
                <a v-else class="cp-art-file" :href="mediaHref(a.produced.path)" :download="a.produced.name" @click.stop.prevent="downloadAuthed(mediaHref(a.produced.path), a.produced.name)">
                  <span class="cp-art-file-ic">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                  </span>
                  <span class="cp-art-file-tx">
                    <span class="cp-art-file-name">{{ a.produced.name }}</span>
                    <span class="cp-art-file-meta">副驾产出 · 点击下载</span>
                  </span>
                  <svg class="cp-art-file-dl" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
              </template>
            </div>
            </template>
          </div>
        </aside>
      </div><!-- /cp-split -->

      <!-- 经营一页纸（P1-3：四宫格聚合视图；窄屏自动 1 列） -->
      <div v-if="!showHistory && showPager" class="cp-pager">
        <div class="cp-pager-hd">
          <b>本期经营一页纸</b>
          <span class="cp-pager-sub">四宫格 + 异常清单</span>
          <button class="cp-pager-back" @click="showPager=false">← 返回对话</button>
        </div>

        <div v-if="pagerLoading" class="cp-pager-loading">正在汇总经营数据…</div>
        <div v-else-if="!pagerData" class="state-empty">暂时取不到经营数据，请稍后重试</div>
        <template v-else>
          <div class="cp-pager-grid">
            <!-- 预报达成 -->
            <div class="cp-pg-card" @click="drillTo('#/forecast')">
              <div class="cp-pg-ic" style="background:var(--info-blue-bg);color:var(--info-blue)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg></div>
              <div class="cp-pg-t">预报达成</div>
              <div class="cp-pg-v">{{ pagerData.forecast ? pagerData.forecast.done_pct + '%' : '—' }}</div>
              <div class="cp-pg-s" v-if="pagerData.forecast">已报 {{ pagerData.forecast.submitted_stores }}/{{ pagerData.forecast.total_stores }} 门店 · 预报 ¥{{ fmtWan(pagerData.forecast.amount) }}</div>
              <div class="cp-pg-s" v-else>暂无开放期次</div>
            </div>
            <!-- 货损 -->
            <div class="cp-pg-card" @click="drillTo('#/loss')">
              <div class="cp-pg-ic" style="background:var(--warn-amber-bg);color:var(--warn-amber)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>
              <div class="cp-pg-t">货损</div>
              <div class="cp-pg-v">{{ pagerData.loss ? pagerData.loss.expiring_soon + ' 个' : '—' }}</div>
              <!-- v389：天数**不能写死** —— 后端已改按货损配方阈值算，写死 14 天就会出现
                   「库里按 7 天判、界面写着 14 天」。口径变了，「短保风险」也随之改名「涉及 N 个商品」。 -->
              <div class="cp-pg-s" v-if="pagerData.loss">{{ pagerData.loss.threshold_days || 7 }} 天内临期 · 涉及 {{ pagerData.loss.short_sku }} 个商品</div>
              <div class="cp-pg-s" v-else>暂无临期数据</div>
            </div>
            <!-- 回款 -->
            <div class="cp-pg-card" @click="drillTo('#/ai-hub')">
              <div class="cp-pg-ic" style="background:var(--ok-green-bg);color:var(--ok-green)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
              <div class="cp-pg-t">回款（应收）</div>
              <div class="cp-pg-v">¥{{ pagerData.ar ? fmtWan(pagerData.ar.balance) : '—' }}</div>
              <div class="cp-pg-s" v-if="pagerData.ar">逾期 ¥{{ fmtWan(pagerData.ar.overdue_amount) }} · {{ pagerData.ar.overdue_count }} 笔</div>
              <div class="cp-pg-s" v-else>暂无应收数据</div>
            </div>
            <!-- 返利 -->
            <div class="cp-pg-card" @click="drillTo('#/rebate')">
              <div class="cp-pg-ic" style="background:var(--violet-bg);color:var(--violet)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg></div>
              <div class="cp-pg-t">返利</div>
              <div class="cp-pg-v">¥{{ pagerData.rebate ? fmtWan(pagerData.rebate.expected_rebate) : '—' }}</div>
              <div class="cp-pg-s" v-if="pagerData.rebate">{{ pagerData.rebate.contracts }} 份合同 · 达成 ¥{{ fmtWan(pagerData.rebate.achieved) }}</div>
              <div class="cp-pg-s" v-else>暂无返利合同</div>
            </div>
          </div>

          <!-- 异常清单 -->
          <div class="cp-pager-anom" v-if="pagerData.anomalies">
            <div class="cp-anom-hd">异常清单（点击下钻）</div>
            <div class="cp-anom-list">
              <div class="cp-anom-row" @click="drillTo('#/dashboard')">
                <span class="cp-anom-t">低库存商品</span><span class="cp-anom-n">{{ pagerData.anomalies.low_stock }}</span>
              </div>
              <div class="cp-anom-row" @click="drillTo('#/loss')">
                <span class="cp-anom-t">临期商品</span><span class="cp-anom-n">{{ pagerData.anomalies.expiring_soon }}</span>
              </div>
              <div class="cp-anom-row" @click="drillTo('#/ai-hub')">
                <span class="cp-anom-t">逾期应收</span><span class="cp-anom-n">{{ pagerData.anomalies.overdue_ar }}</span>
              </div>
              <div class="cp-anom-row" @click="drillTo('#/workbench')">
                <span class="cp-anom-t">待审批订单</span><span class="cp-anom-n">{{ pagerData.anomalies.pending_orders }}</span>
              </div>
              <div class="cp-anom-row" @click="drillTo('#/data-fill')">
                <span class="cp-anom-t">库存缺批次/效期</span><span class="cp-anom-n">{{ pagerData.anomalies.data_gaps }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      </aside>
    </Transition>

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

    <!-- v426 P0-3：结构化纠错面板（取代浏览器原生输入弹窗）
         复用既有浮层范式（同 cp-fwd：Teleport + 居中蒙层），层级 z-index 与转发面板一致。 -->
    <Transition name="fade">
      <div v-if="corr.open" class="cp-corr-mask" @click="corrSkip">
        <div class="cp-corr" @click.stop>
          <div class="cp-corr-hd">
            <b>哪里不对？</b>
            <button class="cp-icon-btn" @click="corrSkip"><Icon name="close"/></button>
          </div>
          <p class="cp-corr-sub">选一项原因、再写一句正确答案，AI 下次遇到同类问题就会改过来。</p>
          <div class="cp-corr-chips">
            <button v-for="c in CORR_REASONS" :key="c" class="cp-corr-chip" :class="{ on: corr.cat === c }" @click="corr.cat = c; corr.hint = ''">{{ c }}</button>
          </div>
          <textarea class="cp-corr-text" v-model="corr.text" rows="3" :placeholder="corrPlaceholder" @input="corr.hint = ''"></textarea>
          <label class="cp-corr-forever">
            <input type="checkbox" v-model="corr.forever" />
            <span>以后都按这个来（升级为长期口径）</span>
          </label>
          <p v-if="corr.hint" class="cp-corr-hint">{{ corr.hint }}</p>
          <div class="cp-corr-ops">
            <button class="btn btn-ghost btn-sm" @click="corrSkip">不用了</button>
            <button class="btn btn-primary btn-sm" @click="corrSubmit">提交纠正</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- v465 截图区域框选遮罩（微信式：选画面 → 拖拽框选 → 确认裁剪 → 进附件） -->
    <div v-if="snapCrop.show" class="cp-snap-mask" ref="cropMask" tabindex="-1"
         @mousemove="onCropMove" @mouseup="onCropUp"
         @keydown.esc="cancelCrop" @keydown.enter="confirmCrop">
      <div class="cp-snap-stage" ref="cropStage" :style="{ width: snapCrop.dispW + 'px', height: snapCrop.dispH + 'px' }"
           @mousedown="onCropDown">
        <img class="cp-snap-img" :src="snapCrop.src" :style="{ width: snapCrop.dispW + 'px', height: snapCrop.dispH + 'px' }" alt="截图预览" draggable="false" />
        <div class="cp-snap-sel" :style="{ left: snapCrop.rect.x + 'px', top: snapCrop.rect.y + 'px', width: snapCrop.rect.w + 'px', height: snapCrop.rect.h + 'px' }"></div>
      </div>
      <div class="cp-snap-hint" @mousedown.stop>拖动鼠标框选要截取的区域，松开后点「确认裁剪」</div>
      <div class="cp-snap-bar" @mousedown.stop>
        <button class="cp-snap-btn ghost" @click="cancelCrop">取消</button>
        <button class="cp-snap-btn" @click="confirmCrop">确认裁剪</button>
      </div>
    </div>
    <!-- v483：生成物预览灯箱（点击缩略图放大看） -->
    <div v-if="zoomSrc" class="cp-lightbox" @click="zoomSrc = ''">
      <img :src="zoomSrc" alt="预览大图" @click.stop />
    </div>
  </Teleport>
</template>

<script setup>
import Icon from './Icon.vue'
import ThinkingDots from './ThinkingDots.vue'
import RoleAvatar from './RoleAvatar.vue'   // v322：角色头像唯一渲染口
import { ref, shallowRef, reactive, nextTick, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { store, loadSessions, saveCurrentSession, newChatSession, openChatSession, deleteChatSession, loadAiRoles, setAiRole } from '../store'
import { hermesChat, api, apiBlob, auth, CHAT_TIMEOUT_NORMAL, CHAT_TIMEOUT_LONG } from '../api/client'
import { isHeavyTurn, shouldInjectTableHint, spreadsheetSoftHint } from '../utils/copilotTurn'
import { importApi } from '../api/modules'
import { chatAttachmentApi, aiPagerApi } from '../api/modules'
import ResultCard from './ResultCard.vue'
import { useCardTrigger, extractCard, extractCardIntent, stripAllFences, extractClarify, extractProposal, extractReminder, DENY_RE, demoCard } from '../composables/useCardTrigger'
import { useVoiceInput } from '../composables/useVoiceInput'
import { renderMd, splitMedia } from '../utils/md'
import { useRouter } from 'vue-router'   // M1：斜杠命令「跳转页面」用
// v311：`drillTo` 前置判据用（见该函数处注释）。判据唯一实现在 `constants/pages.js`。
import { canSee, pageTitle } from '../constants/pages'
import QRCode from 'qrcode'   // v424：分享→生成二维码（微信扫一扫）

const router = useRouter()

const draft = ref('')
const cpBody = ref(null)
const cpInput = ref(null)
const sources = ref([])
const openSources = ref(-1)
const openThink = ref(-1)          // 展开「深度思考」的消息下标（-1 = 全折叠）
function toggleThink(i) { openThink.value = openThink.value === i ? -1 : i }

/* v301（2026-09-28）：副驾产出的文件（Hermes 的 `MEDIA:<路径>` 标记）→ 可下载文件卡。
   病根不在鉴权/跨域，而在**两个渠道的适配器不同**：企微适配器会把标记摘出正文、真上传文件；
   Web 副驾走的 OpenAI 兼容适配器**只处理图片**，`docx/xlsx/pptx` 原样退回原文 ⇒ 老板只看到
   一串服务器路径，无法下载/打开。（详因见 `utils/md.js::splitMedia` 的注释。）
   渲染：卡片走**模板**（复用产物栏 `.cp-art-file` 的既有外观 —— v-html 注入的 DOM 拿不到
        scoped 的 `data-v-*`，样式不会生效，所以卡片不放 markdown 里）；
        正文喂给 renderMd 前先剥掉路径行，否则同一处既显路径又显卡。
   下载：后端 `/api/ai/media`（已登录 + 只放行**本租户** Hermes 家目录的 output/·media/）。
   ⚠️ 按内容 memo：模板每次重渲染都会问一次，长会话有数百条气泡，不能每条都跑正则；
      流式期间内容逐字增长会不断产生新键 ⇒ 超阈值整表清空，避免无界增长。 */
const _mvCache = new Map()
function mediaView(content) {
  const key = content || ''
  const hit = _mvCache.get(key)
  if (hit) return hit
  const v = splitMedia(key)
  if (_mvCache.size > 400) _mvCache.clear()
  _mvCache.set(key, v)
  return v
}
/* P1-b：TOC 锚点跳转 —— 点击目录项平滑滚动到对应标题，**不**改 URL hash（避免破坏 hash 路由）。 */
function onCopilotTocClick(e) {
  // v486 P1-②：代码块「一键复制」—— 与 TOC 跳转共用这一个委托入口
  // （md.js 渲染的是 v-html 字符串，按钮没法绑 Vue 事件，只能委托）。
  const cp = e && e.target && e.target.closest ? e.target.closest('.md-code-copy') : null
  if (cp) {
    const code = cp.getAttribute('data-code') || ''
    const tx = cp.querySelector('.md-code-copy-tx')
    copyText(code).then((ok) => {
      store.toast(ok ? '已复制代码' : '复制失败，请手动选择')
      if (!ok || !tx) return
      // 就地给个「已复制」反馈（2 秒复原）。该 DOM 由 v-html 生成、Vue 不管，
      // 下次消息重渲染会整体重建，不会残留状态。
      cp.classList.add('copied')
      if (tx) tx.textContent = '已复制'
      setTimeout(() => { cp.classList.remove('copied'); tx.textContent = '复制' }, 2000)
    })
    return
  }
  // v487 P2-③ / v491：表格↔图表开关 + 图表形态切换（走势 / 对比 / 占比）
  // 🔴 v491 的一个坑：原实现用 `tog.textContent = …` 换文案，会把按钮里的图标一起抹掉
  //    （本轮把彩色 emoji 换成线性 SVG 后才显形）⇒ 改为只改 `-tx` 那个 span。
  const seg = e && e.target && e.target.closest ? e.target.closest('.ch-md-segbtn') : null
  if (seg) {
    const box = seg.closest('.md-table-chart')
    const form = seg.getAttribute('data-form')
    if (box && form) {
      box.querySelectorAll('.ch-md-segbtn').forEach((b) => b.classList.toggle('on', b === seg))
      box.querySelectorAll('.ch-md-pane').forEach((p) => {
        if (p.getAttribute('data-form') === form) p.removeAttribute('hidden')
        else p.setAttribute('hidden', '')
      })
      // 图例只对折线/柱状有意义；切到「占比」时它由明细自己承担 ⇒ 一并收起
      const lg = box.querySelector('.ch-md-legend')
      if (lg) { if (form === 'donut') lg.setAttribute('hidden', ''); else lg.removeAttribute('hidden') }
    }
    return
  }
  const tog = e && e.target && e.target.closest ? e.target.closest('.md-table-chart-toggle') : null
  if (tog) {
    const wrap = tog.closest('.md-table-wrap')
    const chart = wrap && wrap.querySelector('.md-table-chart')
    const table = wrap && wrap.querySelector('.md-table')
    if (chart && table) {
      const show = chart.hasAttribute('hidden')
      if (show) chart.removeAttribute('hidden'); else chart.setAttribute('hidden', '')
      table.style.display = show ? 'none' : ''
      const tx = tog.querySelector('.md-table-chart-toggle-tx')
      if (tx) tx.textContent = show ? '看表格' : '看图表'
    }
    return
  }
  const el = e && e.target && e.target.closest ? e.target.closest('.md-toc-link') : null
  if (!el) return
  const anchor = el.getAttribute('data-anchor')
  if (!anchor) return
  const target = document.getElementById(anchor)
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
/* v487 P2-⑦：内联控件（滑块/开关）变更 → 回灌 AI（复用 askFollowup 写草稿并发送）。
   控件由 md.js 渲染进 v-html，@change 委托到此处；滑块在松手时触发 change（不会逐像素刷屏）。 */
function onCopilotControl(e) {
  const el = e && e.target && e.target.closest ? e.target.closest('.md-control-range, .md-switch') : null
  if (!el) return
  const wrap = el.closest('.md-control')
  if (!wrap) return
  const label = wrap.getAttribute('data-label') || '参数'
  let value
  if (el.classList.contains('md-switch')) {
    const on = !el.classList.contains('on')
    el.classList.toggle('on', on)
    el.setAttribute('aria-checked', String(on))
    wrap.setAttribute('data-value', on ? 'on' : 'off')
    value = on ? '开启' : '关闭'
  } else {
    value = el.value
    const vEl = wrap.querySelector('.md-control-val')
    if (vEl) vEl.textContent = value
    wrap.setAttribute('data-value', value)
  }
  askFollowup({ query: `${label}设为${value}`, label: `${label}：${value}` })
}
function mediaFiles(m) {
  return m && m.role === 'assistant' && m.content ? mediaView(m.content).files : []
}
function mediaHref(p) { return '/api/ai/media?path=' + encodeURIComponent(String(p || '')) }

/* v306（2026-09-28）：带鉴权的文件下载 —— 本组件所有「下载」都必须走这里，**不能**用裸 <a href>。
   🔴 病根（生产实测）：本仓鉴权是 `Authorization: Bearer <token>`（token 存 localStorage），
      而 `GET /api/ai/media` 与 `GET /api/chat-attachment/download/:id` **都要鉴权**。
      裸 <a href> 触发的是**普通链接跳转**，浏览器不会附带这个请求头 ⇒ 端点回 401（JSON），
      Chrome 的下载随即被中断 —— 下载记录里那条「无法从网站上提取文件」就是它。
      （对比：带同一个 token 直接请求该 URL = 200 / 45,452 字节，所以问题**完全在前端怎么发这个请求**。）
   ⚠️ 极具迷惑性：`:download` 属性会**自己提供文件名**，所以下载记录里文件名看着完全正确，
      只瞄一眼名字会以为端点通了 —— 判据必须是「响应状态码」，不是「文件名对不对」。
   ⇒ 正解 = fetch（带头）→ blob → objectURL → a.download → click。这与本仓既有导出范式一致
      （见 `pages/Workbench.vue::downloadWeeklyDocx`、`api/modules.js` 的模板下载）。
   ⚠️ `revokeObjectURL` **不能**紧跟在 click 之后同步执行：Chrome 还没读完 blob 就把 URL 撤销，
      会报出**一模一样**的「无法从网站上提取文件」，等于修好 401 又换回一个长得相同的故障。
      这里延后 10 秒（那时下载早已开始读取，且不再白占内存）。
   ⚠️ 也不能改用 window.open：新标签同样是普通跳转，没有鉴权头，只是把 401 换个地方显示。 */
async function downloadAuthed(url, name) {
  try {
    const res = await fetch(url, {
      headers: {
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.tenant ? { 'X-Tenant-Id': String(auth.tenant) } : {}),
      },
    })
    if (!res.ok) {
      // 失败必须出声：静默的话用户看到的就是「点了没反应」，比报错更难排查
      let msg = ''
      try { msg = (await res.json()).detail || '' } catch (e) { /* 非 JSON（如网关 502）不必强解 */ }
      store.toast(msg || `下载失败（${res.status}），请稍后重试`, 'error')
      return
    }
    const blob = await res.blob()
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = u
    a.download = name || '文件'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 10000)
  } catch (e) {
    // 网络层失败（断网/超时）也走这里 —— 同样必须让用户看见
    store.toast('下载失败，请检查网络后重试', 'error')
  }
}

/* ---- 鉴权取 blob：预览 / 下载统一入口（带 Authorization + X-Tenant-Id） ----
   v492：原先此处还有「用户上传附件」专用的一套预览缓存（previewStore / previewLoading /
   previewSrc / loadPreview / zoomArtifact）；随用户附件退出产物区一并移除。
   现在只由副驾**产出文件**的 producedPreviewSrc（下方）使用本函数。 */
const zoomSrc = ref('')
async function fetchAuthedBlob(url) {
  try {
    const res = await fetch(url, {
      headers: {
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.tenant ? { 'X-Tenant-Id': String(auth.tenant) } : {}),
      },
    })
    if (!res.ok) {
      let msg = ''
      try { msg = (await res.json()).detail || '' } catch (e) { /* 非 JSON 忽略 */ }
      store.toast(msg || `预览加载失败（${res.status}）`, 'error')
      return null
    }
    return await res.blob()
  } catch (e) {
    store.toast('预览加载失败，请检查网络后重试', 'error')
    return null
  }
}
function fileExt(f) { return (f && f.file_name ? String(f.file_name).split('.').pop() : '').toLowerCase() }
function isImage(f) { return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(fileExt(f)) }
function isVideo(f) { return ['mp4', 'webm', 'ogg', 'mov'].includes(fileExt(f)) }
function isHtml(f) { return ['html', 'htm'].includes(fileExt(f)) }
function isPreviewable(f) { return isImage(f) || isVideo(f) || isHtml(f) }
/* v492：previewSrc / loadPreview / zoomArtifact（用户上传附件的预览）已随用户附件退出产物区移除。 */
/* ---- v489：副驾**产出文件**（Hermes `MEDIA:<路径>` 标记）的预览 URL ----
   取数端点：产出文件按**路径**走 `/api/ai/media?path=`（需 Authorization，故 fetch→blob→objectURL）。
   v492：用户上传附件已退出产物区，其预览缓存（previewStore）与 previewSrc 一并移除。 */
const producedPreview = reactive({})     // path -> objectURL
const producedPreviewLoading = new Set()
function producedPreviewSrc(path) {
  if (!path) return ''
  if (producedPreview[path]) return producedPreview[path]
  if (!producedPreviewLoading.has(path)) {
    producedPreviewLoading.add(path)
    fetchAuthedBlob(mediaHref(path))
      .then((b) => { if (b) producedPreview[path] = URL.createObjectURL(b) })
      .finally(() => producedPreviewLoading.delete(path))
  }
  return ''
}
function zoomProduced(path) {
  const u = producedPreviewSrc(path)
  if (u) zoomSrc.value = u
}

/* 工具执行情况的展开节奏（对齐 WorkBuddy）：
   **回复中自动展开**看每一步；**回复结束自动收起**，只留答案 + 一行可点开的摘要。
   openTools: -1 = 未手动干预（跟随「是否正在回复」）／i = 手动展开该条／-2 = 手动收起 */
const openTools = ref(-1)
const toolsLive = (i) => store.chat.streaming && i === store.chat.messages.length - 1
function toolsOpen(i) {
  if (openTools.value === -2) return false
  if (openTools.value === i) return true
  return toolsLive(i)
}
function toggleTools(i) { openTools.value = toolsOpen(i) ? -2 : i }
/* 汇总耗时：已完成步骤的耗时之和（并行步骤会重复计，仅作量级参考） */
function toolsElapsed(m) {
  const done = (m.tools || []).filter(t => t.ms)
  if (!done.length) return ''
  return fmtMs(done.reduce((a, b) => a + (b.ms || 0), 0))
}
const attachments = ref([])
const uploading = ref(false)
const showHistory = ref(false)
// v488：进入副驾自动恢复最近会话的加载态。由 restoreLatestSession() 显式抬起/落下 ——
// 恢复完成（或回退新建）后置 false，覆盖在对话流上，避免「空白新对话」先闪一下再切到历史会话。
// 初值 false：恢复只在 copilotOpen 打开分支按需触发（pre-flush 先于渲染跑，能赶在首帧前抬起遮罩）。
//
// 🔴 为什么不在 onMounted 里恢复：`<CopilotDrawer/>` 在 Shell.vue 里是**无条件挂载**的，
//    onMounted 在**开机**就跑（那时抽屉还没打开、遮罩所在的 .cp-body 根本没渲染）⇒
//    等用户点开时恢复早已完成，遮罩永远不可见，等于没有加载态。所以改为**点开抽屉时**按需恢复。
const restoringSession = ref(false)
// v488：「用户主动要一段空白新对话」的意图标记（点「＋ 新对话」/切换标记的「新开对话」会置 true，
//       打开任一历史会话会置 false）。抽屉重开时凭它决定「要不要自动恢复最近会话」——
//       否则用户刚点了「新对话」、一关一开又被拽回历史会话，等于新对话入口不可靠。
const explicitNew = ref(false)
const isFullscreen = ref(false)
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

/* 产物区：默认隐藏；系统生成新产物自动弹开；顶部按钮可手动隐藏 / 切换区域全屏 */
const artOpen = ref(false)
const artFullscreen = ref(false)

// P1-3 经营一页纸（四宫格聚合视图）
const showPager = ref(false)
const pagerData = ref(null)
const pagerLoading = ref(false)
function togglePager() {
  if (showPager.value) { showPager.value = false; return }
  showPager.value = true
  if (!pagerData.value) loadPager()
}
async function loadPager() {
  pagerLoading.value = true
  try {
    const r = await aiPagerApi.pager()
    pagerData.value = r
  } catch (e) {
    pagerData.value = null
  } finally {
    pagerLoading.value = false
  }
}
function drillTo(hash) {
  /* v311（2026-09-28）：**先判权限再跳**。
     🔴 为什么必须在这里判：本函数是直接改 `location.hash`，路由守卫**会**接住这次导航，
        发现角色不够就把人弹回工作台并提示「没有「xxx」这一页的访问权限」——
        于是卡片写着「回款（应收）」、点下去却被弹回来，用户只会以为系统坏了。
        入口自己先判，就不会有那一跳（本项目的「假入口」家族）。
     ⚠️ 消息措辞与守卫保持一致（都用 `pageTitle`），避免同一次拒绝出现两种说法。
     ⚠️ 判据走 `canSee`（→ `pages.js` 一张表），**不要**在这里写角色硬编码。 */
  const p = String(hash || '').replace(/^#/, '')
  if (p && !canSee(p)) {
    store.toast('没有「' + (pageTitle(p) || p) + '」的访问权限', 'warn')
    return
  }
  showPager.value = false
  store.ui.copilotOpen = false
  window.location.hash = hash
}
function fmtWan(v) {
  if (v == null) return '—'
  const wan = v / 10000
  return (wan >= 0.1 ? wan.toFixed(1) : wan.toFixed(2)) + ' 万'
}
/* ① 存为报告 */
const savingReport = ref(false)
const hasChat = computed(() => store.chat.messages.some(m => m.content))
function hideArtifacts() {
  artOpen.value = false
  artFullscreen.value = false
}
function toggleArtFullscreen() {
  artFullscreen.value = !artFullscreen.value
  if (artFullscreen.value) artOpen.value = true   // 全屏隐含展开
}

/* ① 存为报告：把当前对话固化为报告落库（AI 中心可回看/导出/转发） */
function chatToMarkdown() {
  return store.chat.messages
    .filter(m => m.content)
    .map(m => (m.role === 'user' ? '**老板**：' : '**AI 副驾**：') + m.content)
    .join('\n\n')
}
async function saveAsReport() {
  const content = chatToMarkdown()
  const first = store.chat.messages.find(m => m.role === 'user' && m.content)
  const title = first ? first.content.slice(0, 40) : '副驾对话报告'
  if (!content) return
  savingReport.value = true
  try {
    await api('/api/ai/reports', { method: 'POST', body: { title, content, source: 'copilot' } })
    store.toast('已存为报告，可在「AI 引擎 › 产出与用量」回看')
  } catch (e) {
    store.toast((e && e.message) || '保存失败', 'error')
  } finally {
    savingReport.value = false
  }
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
  autoGrow()   // 宽度变化会改变折行数，必须重算 textarea 高度（否则多出的行被裁掉）
  if (isNarrow.value) return
  const maxW = artMaxWidth()
  if (artWidth.value > maxW) artWidth.value = maxW
}

/* 工具耗时：<1s 显示毫秒，否则显示秒（对齐 WorkBuddy「已完成 {duration}」） */
function fmtMs(ms) {
  const n = Number(ms) || 0
  return n < 1000 ? n + 'ms' : (n / 1000).toFixed(1) + 's'
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
    loadSessions()   // 每次打开历史都向服务端对齐，保证看到别的设备/端刚聊过的会话
  }
}

function newSession() {
  explicitNew.value = true         // v488：用户主动要空白新对话 ⇒ 抽屉重开时不再自动恢复
  savedScroll = null               // v622：换了一段对话 ⇒ 位置记录作废，下次打开按「贴底」处理
  newChatSession()
  showHistory.value = false
  nextTick(() => { if (cpInput.value) cpInput.value.focus() })
}

function openSession(id) {
  explicitNew.value = false        // v488：打开了具体会话 ⇒ 撤销「要新对话」的意图
  savedScroll = null               // v622：换了会话，旧位置记录不许串到新会话上
  openChatSession(id)
  showHistory.value = false
  // v622：切会话后落到**最新一条**（原来只靠 messages.length 变化触发，两个会话条数相同时不触发 ⇒ 停在顶部）
  nextTick(() => { scrollBottom(); if (cpInput.value) cpInput.value.focus() })
}

function delSession(id) {
  deleteChatSession(id)
}

/* v488：进入副驾时自动恢复「当前角色」最近一次会话，取代默认空白新对话。
   ① 按角色维度（latestSessionOfRole 已按 updated_at 取最新）；
   ② 先等本地缓存 + 服务端对齐完再取最新（服务端可能比本地新/多），期间 restoringSession 遮罩覆盖，不闪空白；
   ③ 有最近会话 → openChatSession 恢复完整历史并滚到上次浏览位置（底部最新一条）；
      无会话 / 最近会话失效 → newChatSession 回退新建；
   ④ 「＋ 新对话」入口保留（newSession 仍可用），用户仍可主动开新会话；
   ⑤ 切换/新建后 openChatSession 会 bump updated_at，下次进入自动续上刚看的那条（见 store）。 */
async function restoreLatestSession() {
  restoringSession.value = true                       // 覆盖层抬起（覆盖在对话流上）
  savedScroll = null                                  // v622：自动恢复=换会话 ⇒ 旧位置记录作废
  // 兜底：任何异常都不让遮罩卡死
  const safety = setTimeout(() => { restoringSession.value = false }, 6000)
  try {
    loadSessions()                                   // 本地优先秒开 + 触发服务端对齐
    try { await store.loadSessionsFromServer() } catch (_) {}   // 等服务端对齐完再取最新
    try { await store.loadAiRoles() } catch (_) {}   // 🔴 必须先等角色就绪，再取 rid
    // 🔴 rid 必须在 loadAiRoles() **之后**取：否则抽屉早于角色加载挂载时，
    //    currentRole 还是 null ⇒ rid='' ⇒ latestSessionOfRole('') 恒返回 null ⇒
    //    误判「无历史会话」而回退空白新对话（本轮探针当场抓到，不是推测）。
    const rid = (currentRole.value && currentRole.value.role_id) || ''
    const target = store.latestSessionOfRole(rid)
    if (target && target.id) {
      explicitNew.value = false
      openChatSession(target.id)                     // 恢复历史；本地无全文（跨设备）则内部异步补拉
      if (target.messages && target.messages.length) {
        await nextTick(); scrollBottom()
        restoringSession.value = false
      } else {
        // 跨设备无本地全文：等异步拉到首条再关遮罩，期间遮罩盖住不闪空白
        const stop = watch(() => store.chat.messages.length, (n) => {
          if (n > 0) { stop(); nextTick(() => scrollBottom()); restoringSession.value = false }
        })
        setTimeout(() => { stop(); restoringSession.value = false }, 5000)
      }
    } else {
      newChatSession()                               // 无历史会话 / 最近会话失效 ⇒ 回退新建
      restoringSession.value = false
    }
  } catch (_) {
    try { newChatSession() } catch (_) {}
    restoringSession.value = false
  } finally {
    clearTimeout(safety)
  }
}

/* ---- P2-⑤ 跨会话检索：搜索历史对话，命中会话 + 片段预览 ---- */
const histQuery = ref('')
const histHits = ref([])
let histTimer = null
function onHistSearch() {
  clearTimeout(histTimer)
  const q = histQuery.value.trim()
  if (!q) { histHits.value = []; return }
  histTimer = setTimeout(async () => {
    try {
      const d = await api(`/api/ai/search-chat?q=${encodeURIComponent(q)}`, { silent401: true })
      histHits.value = (d && d.hits) || []
    } catch (_) { histHits.value = [] }
  }, 300)
}

const suggestions = ['今天该订什么货？', '算一下这个月货损', '哪些客户该催款了？', '核对我该拿多少返利']

/* ---- M1：对话内斜杠命令（输入 / 唤起快捷指令） ----
   复用命令面板（CommandPalette）的范式：分组 + 键盘导航 + 权限过滤 + Icon。
   🔴 v341（2026-09-30）：过滤从「只看 `store.canModule`」升级为**两轴**（与侧栏/守卫同源）——
      模块轴（本租户有没有买这个能力）＋ 入口轴（`canSee(c.path)`：角色门槛）。
      只有命令面板一直是两轴；斜杠命令此前漏了入口轴 ⇒ `/预报`、`/返利政策` 对
      不在角色名单里的人仍显示（假入口）。见下方 `slashMatches` 处注释。
   形态取「输入框上方的内联浮层」而非全屏模态 —— 这是斜杠命令的标准形态，不打断输入。
   两类命令：prompt（选中即发送一条预置提问）/ path（跳转页面，跳转时收起抽屉）。 */
const slashIndex = ref(0)
const slashDismissed = ref(false)
const SLASH_COMMANDS = [
  // —— 快捷提问（选中即发，省去打字）——
  { cmd: '/报单', group: '快捷提问', icon: 'package', title: '本期报单建议', hint: '结合库存与销量', module: 'data',
    prompt: '帮我看本期报单：结合当前库存和近期销量，给我建议报单量。' },
  { cmd: '/查库存', group: '快捷提问', icon: 'store', title: '库存与临期排查', hint: '偏低 / 临期', module: 'stock',
    prompt: '查一下当前库存：哪些商品库存偏低需要补货？哪些临期需要尽快处理？' },
  { cmd: '/今日洞察', group: '快捷提问', icon: 'lightbulb', title: '今日经营洞察', hint: '销售·库存·应收',
    prompt: '给我今天的经营洞察：销售、库存、应收各有什么要重点关注的？' },
  { cmd: '/生成日报', group: '快捷提问', icon: 'book', title: '生成经营日报', hint: '可复制发群',
    prompt: '生成本周经营日报，包含销售、货损、返利达成要点。' },
  { cmd: '/审批提案', group: '快捷提问', icon: 'check', title: '待审批提案', hint: '改动与风险',
    prompt: '有哪些待我审批的提案？分别说明改动内容和风险。' },
  { cmd: '/催款', group: '快捷提问', icon: 'phone', title: '催款名单', hint: '按逾期金额', module: 'accounts',
    prompt: '哪些客户该催款了？按逾期金额从高到低排，给出金额和账期。' },
  { cmd: '/返利', group: '快捷提问', icon: 'target', title: '返利达成核对', hint: '按品牌', module: 'sales',
    prompt: '核对我该拿多少返利，按品牌说明达成情况和缺口。' },
  { cmd: '/货损', group: '快捷提问', icon: 'trash', title: '货损分析', hint: '按品类 / 原因', module: 'stock',
    prompt: '算一下这个月货损，按品类和原因拆解，指出异常。' },
  // —— 跳转页面（跳转时收起抽屉）——
  { cmd: '/工作台', group: '跳转页面', icon: 'grid', title: '经营工作台', path: '/workbench' },
  { cmd: '/预报', group: '跳转页面', icon: 'activity', title: '预报订单管理', path: '/forecast' },
  { cmd: '/返利政策', group: '跳转页面', icon: 'target', title: '目标与返利', path: '/rebate' },
  { cmd: '/商品目标', group: '跳转页面', icon: 'bars', title: '商品目标', path: '/product-target', module: 'data' },
  { cmd: '/算工资', group: '跳转页面', icon: 'coins', title: '算工资工作流', path: '/payroll', module: 'payroll' }
]
// 只在「首词是 /指令、且尚未输空格」时激活（一旦空格即是提问，不是选命令）
const slashQuery = computed(() => {
  const m = /^\/(\S*)$/.exec(draft.value)
  return m ? m[1].toLowerCase() : null
})
const slashMatches = computed(() => {
  if (slashQuery.value === null) return []
  const kw = slashQuery.value
  return SLASH_COMMANDS.filter(c => (!c.module || store.canModule(c.module)) &&
    /* 🔴 v341（2026-09-30）：跳转类命令必须**再过一遍入口判据**。
       此前这里只判模块轴（`store.canModule`），而 `/预报`（roles = `FORECAST_SUMMARY_ROLES`
       只放管理员/老板/主管）与 `/返利政策`（roles = `BIZ_ROLES`）都带**角色硬门槛** ⇒
       不在名单的角色（含租户自建的自定义角色）会看到命令、点了被路由守卫弹回工作台
       —— 正是本项目的「假入口」（入口在、点进去被拒）。
       判据唯一实现仍是 `canSee()`（→ `constants/pages.js` 一张表），此处**不另写名单**；
       模块轴保留（它多拦一层"本租户没买这个能力"）。 */
    (!c.path || canSee(c.path)) &&
    (!kw || c.cmd.slice(1).toLowerCase().includes(kw) || c.title.includes(kw)))
})
const slashOpen = computed(() => slashQuery.value !== null && !slashDismissed.value && slashMatches.value.length > 0)
// 草稿脱离「/指令」形态时重置「已关闭」，让下次输入 / 能重新唤起
watch(draft, () => {
  if (slashQuery.value === null) slashDismissed.value = false
  slashIndex.value = 0
})
function onComposerKeydown(e) {
  if (slashOpen.value) {
    const n = slashMatches.value.length
    if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex.value = (slashIndex.value + 1) % n; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashIndex.value = (slashIndex.value - 1 + n) % n; return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(slashMatches.value[slashIndex.value]); return }
    if (e.key === 'Escape') { e.preventDefault(); slashDismissed.value = true; return }
  }
  // 与原 `.keydown.enter.exact.prevent` 语义一致：无任何修饰键的 Enter 才发送
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); send() }
}
function pickSlash(c) {
  if (!c) return
  slashDismissed.value = true
  if (c.path) {
    draft.value = ''
    store.ui.copilotOpen = false
    router.push(c.path)
    return
  }
  if (c.prompt) ask(c.prompt)
}

/* ---- AI 团队（角色定位）：输入区左下角胶囊 + 下拉 ---- */
const showRoleMenu = ref(false)
const activeRoles = computed(() => (store.chat.roles || []).filter(r => r.is_active !== 0))
const currentRole = computed(() => {
  const list = store.chat.roles || []
  return list.find(r => r.role_id === store.chat.currentRole) || list[0] || null
})
// v322b：顶栏标题里的**角色名后缀**。
// 🔴 角色名与产品名重复时返回空串 ⇒ 不渲染。默认角色就叫「经营副驾」，
//    直接拼会得到「AI 经营副驾 · 经营副驾」——生产探针当场抓到的观感缺陷。
//    没有当前角色时（角色列表未加载完 / 空租户）同样返回空串 ⇒ 与升级前逐字相同。
const titleRoleSuffix = computed(() => {
  const n = (currentRole.value && currentRole.value.name) || ''
  return n && !'AI 经营副驾'.includes(n) ? n : ''
})
// v322：自定义头像 URL 的计算已收进 `RoleAvatar.vue`（唯一渲染口）。
// 原来这里有一份 `avatarUrl()`，与本文件 5 处各自的 `v-if="custom_avatar"` 并存 ——
// 正是"判断散落多处、两处漏写"的成因（「将由 X 回答」行就漏了，生产上一直显示 🚀）。
// v319（L2）：**消息级角色快照**。
// 🔴 修的是一个既存缺陷：此前每条助手消息渲染时都读 `currentRole` ⇒ 一切换角色，
//    历史回复的署名与头像**被追溯改写**（切到"会计"后，之前"经营副驾"的回复也变成会计）。
//    正确做法是发送那一刻把角色快照进消息里，之后永不重算。
function roleMetaOf(rid) {
  if (!rid) return null
  const r = (store.chat.roles || []).find(x => x.role_id === rid)
  return r ? { role_id: r.role_id, name: r.name, avatar: r.avatar, custom_avatar: r.custom_avatar } : null
}

// v320：历史列表里的「这段是谁开的」标签。
//   🔴 取不到名字（角色已被删除 / 归属为空）就返回空串 ⇒ **不显示标签**，
//      绝不让 `ROLE_NAMES[x] || x` 那类回落把内部 id 印到界面上（本项目踩过的老坑）。
function roleNameOf(rid) {
  const m = roleMetaOf(rid)
  return m ? m.name : ''
}
/* ---- 下拉菜单**集中互斥**（3 个：团队 / 权限 / 添加）----
   🔴 2026-09-25 教训：原先每个 toggle 各自写「关掉另一个」，加到第 4 个时必然会漏，
      造成「两个菜单同屏挂在屏幕上」（加模型下拉时就这么被探针抓了一次）。
   ⇒ 改成**一处集中管理**：以后新增菜单只要在这里登记一行 + 在 onDocPointerDown 登记一行，就不会再漏。
   （模型下拉已于同日下架，此处同步摘除。） */
function closeMenus(except) {
  if (except !== 'role') showRoleMenu.value = false
  if (except !== 'guard') showGuardMenu.value = false
  if (except !== 'add') showAddMenu.value = false
  if (except !== 'voice') showVoiceMenu.value = false   // v461：朗读声音下拉
}
function toggleRoleMenu() { const on = !showRoleMenu.value; closeMenus('role'); showRoleMenu.value = on }
// 点胶囊/菜单以外的任意空白处 → 收起菜单（抽屉内空白 + 抽屉外页面空白都算）。
// 用捕获阶段 pointerdown，避免被内层 @click.stop 或抽屉遮罩的 click 抢走。
// 2026-09-25：新增权限下拉后改为「各管各的」——两个菜单各自判断点击是否落在自己容器内。
function onDocPointerDown(e) {
  if (!showRoleMenu.value && !showGuardMenu.value && !showAddMenu.value && !showVoiceMenu.value) return
  const t = e.target
  const inside = (sel) => !!(t && t.closest && t.closest(sel))
  if (showRoleMenu.value && !inside('.cp-role')) showRoleMenu.value = false
  if (showGuardMenu.value && !inside('.cp-guard')) showGuardMenu.value = false
  if (showAddMenu.value && !inside('.cp-add')) showAddMenu.value = false
  if (showVoiceMenu.value && !inside('.cp-ttsv')) showVoiceMenu.value = false   // v461
}
function pickRole(r) {
  const prev = store.chat.currentRole
  setAiRole(r.role_id)
  showRoleMenu.value = false
  if (!r || r.role_id === prev) return
  // v319（L2）：切换必须**看得见**。此前只换头像 —— 老板既不知道"切没切成功"，
  //   也不知道"从哪一条开始换了人答"，而历史头像还会被追溯改写（既存缺陷）。
  //   这里插一条分隔标记：渲染成居中灰字，**不参与发送**（发送处按 isSwitch 过滤）。
  const pv = roleMetaOf(prev)
  store.chat.messages.push({
    role: 'assistant', isSwitch: true,
    content: `已切换角色 · 以上由「${(pv && pv.name) || '上一个角色'}」，以下由「${r.name}」回答`,
    switchTo: r.role_id, switchFrom: prev || ''
  })
  // v320：拉一次服务端会话列表 —— 「接着《…》聊」的目标要从它算出来（`latestSessionOfRole`）。
  //   🔴 **不 await**：切换本身必须立刻可见（分隔标记先出来），列表回来后再把按钮补上；
  //      按钮是 computed，依赖 store.chat.sessions ⇒ 列表一到就自动出现，不需要额外通知。
  try { store.loadSessionsFromServer() } catch (_) {}
  nextTick(() => scrollBottom())
}

// v319（L2）：从切换标记一键「另起一段」。
//   ⚠️ 刻意**不自动清空**：老板可能只是想让另一个人接着看同一段上下文。
//      所以给按钮、不强制 —— 但把「新开对话」摆在切换那一行，是因为角色换了以后
//      旧角色的口径会污染新角色（同一段历史里两个角色的话混在一起，模型会串）。
function startNewFromSwitch() {
  explicitNew.value = true         // v488：显式「另起一段干净对话」⇒ 同样别再自动恢复
  savedScroll = null               // v622：换了一段对话 ⇒ 位置记录作废，按「贴底」处理
  try { store.newChatSession() } catch (_) {}
  nextTick(() => scrollBottom())
}

// v320：点「接着《…》聊」= **显式**打开该角色上次那段会话。
//   复用 openSession —— 它内部的 openChatSession 已处理"本地无全文 ⇒ 从服务端拉完整 messages"
//   （换设备场景），所以这里不需要额外处理。
function resumeSession() {
  const t = resumeTarget.value
  if (!t) return
  openSession(t.id)
}

function close() { store.ui.copilotOpen = false; showPager.value = false }

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
  savedScroll = null               // v622：清空即新对话 ⇒ 位置记录作废
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

/* ---- P0-③ 动作分级护栏：AI 权限档位（只建议/允许执行），产品化"只建议不擅自下单"铁律 ---- */
const aiGuard = ref(localStorage.getItem('hergent_ai_guard') || 'advise')  // advise=只建议（默认）/ execute=允许执行
// H1：Web 副驾服从后台 AI 模式（auto/readonly/disabled），修复"后台关 AI 但副驾仍可用"的越权口子
const aiMode = ref('auto')  // auto=正常 / readonly=强制只建议 / disabled=完全停用

/* v319（L2）：**生效的**权限档 = 角色档 ⊕ 租户 AI 模式（都只能收窄）。
   为什么必须与后端同口径：后端 `role_caps()` 就是这么算的（模式非 auto ⇒ 一律 advise）。
   前端若还显示 aiGuard 的本地值，会出现"界面写着可直接执行、后端却拒绝" —— 用户看到的
   解释与实际行为不一致，比不给这个开关更糟。 */
const effectiveGuard = computed(() => {
  if (aiMode.value === 'readonly' || aiMode.value === 'disabled') return 'advise'
  const g = currentRole.value && currentRole.value.guard
  if (g === 'advise' || g === 'execute') return g
  return aiGuard.value
})
// 角色是否**已配置**权限档 ⇒ 前端这个软开关就该退位（把决定权交回角色）
const roleGuardLocked = computed(() => {
  const g = currentRole.value && currentRole.value.guard
  return g === 'advise' || g === 'execute'
})
// 能力摘要（技能包数 / 数据域数）。🔴 未配置时返回空 ⇒ 界面**逐字不变**（存量角色零观感变化）
const capSummary = computed(() => {
  const r = currentRole.value
  if (!r) return ''
  const sk = (r.skills || []).length
  const sc = (r.data_scope || []).length
  if (!sk && !sc) return ''
  return `${sk} 个技能 · ${sc} 个数据域`
})

// v320：「接着上次聊」的目标 —— 当前角色名下**最近**一条会话，且**不是**正在聊的这条。
// 🔴 这是"显式版"的核心：系统**只提供目标**，绝不自己跳过去。
//   用户点它才算数 —— 因为切换角色的意图是真二义的（"换个视角看同一件事" vs
//   "换个岗位干另一摊活"），自动跳会赌错一半，而赌错的代价（屏幕被换走）用户撤不回来。
const resumeTarget = computed(() => {
  const rid = currentRole.value && currentRole.value.role_id
  if (!rid) return null
  const s = store.latestSessionOfRole(rid)
  if (!s || s.id === store.chat.currentId) return null
  return s
})
/* 权限下拉（对齐 WorkBuddy 的 permission chip）：把"AI 会怎么做"摆到台面上，不再只靠 hover 提示。
   （原 `toggleAiGuard` 二态直切已由本下拉取代，函数一并删除，避免死代码。）
   ⚠️ 硬门禁仍在服务端 `ai_mode`；这里只是让老板看懂软开关的含义。 */
const showGuardMenu = ref(false)
function toggleGuardMenu() {
  if (aiMode.value === 'readonly') return          // 只读时按钮本就 disabled，双保险
  const on = !showGuardMenu.value; closeMenus('guard'); showGuardMenu.value = on
}
function pickGuard(mode) {
  // v319（L2）：角色已配权限档 ⇒ 前端这个**软开关退位**（决定权在角色，去「设置 › AI 团队」改）
  if (roleGuardLocked.value) { showGuardMenu.value = false; return }
  if (mode === 'execute' && aiMode.value === 'readonly') { showGuardMenu.value = false; return }
  aiGuard.value = mode
  localStorage.setItem('hergent_ai_guard', mode)
  showGuardMenu.value = false
}

/* 🔴 「模型选择」已于 2026-09-25 整体下架（老板选 B）——前后端代码一并移除，不留死 UI 逻辑。
   根因：Hermes 未配 `model_routes` ⇒ 请求里的 model 匹配不到路由、**静默回落默认模型**
   （服务端账本 `session_model_usage` 只出现 deepseek-v4-flash 可证）⇒ 那是"静默无效"控件。
   恢复 A 方案的精确步骤见报告 §9.6.4b（加 model_routes + 重启网关 + 还原本处 UI）。 */

/* ---- 「＋」变菜单（P3/R10，对齐 WorkBuddy 的 `addMenu`）----
   🔴 只放**真能用的**入口：三项走的是同一个 `onFile` 流程，只是**预筛的文件类型**不同。
      菜单的价值是让老板知道"能给 AI 什么"，而不是新增能力（不塞假条目——假条目点了没反应更伤信任）。
   ⚠️ 智能导入不是独立入口：它由 onFile 识别到表格后自动弹确认面板（`.cp-smart`）。 */
const showAddMenu = ref(false)
const fileAccept = ref('.xlsx,.xls,.csv,.txt,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.pdf')
const fileInput = ref(null)
const ADD_KINDS = {
  sheet: '.xlsx,.xls,.csv',
  image: '.jpg,.jpeg,.png,.gif,.webp',
  file: '.pdf,.txt,.md,.json',
}
function toggleAddMenu() { const on = !showAddMenu.value; closeMenus('add'); showAddMenu.value = on }
function pickAdd(kind) {
  fileAccept.value = ADD_KINDS[kind] || ADD_KINDS.file
  showAddMenu.value = false
  // 等 accept 落到 DOM 再唤起系统选择框（否则可能拿旧 accept 打开，选不到目标类型）
  nextTick(() => {
    const el = fileInput.value
    if (!el) return
    el.value = ''      // 允许连续选同一个文件
    el.click()
  })
}
const AI_GUARD_HINT = '【AI 权限】你当前处于「只建议」模式：任何下单、收款、付款、采购、删除、修改等写操作，一律只给建议和步骤，绝不擅自执行。'

/* 🔴 v281（2026-09-26）副驾代理层"用户开关"已**整条撤除**（UI + 状态 + 函数）。
   原先：开 = 经服务端转发 / 关 = 浏览器直连 `/hermes/v1/chat/completions`。
   撤除理由（实测取证，见 outputs/安全-hermes网关未鉴权-2026-09-26.md）：
     ① 那条"直连"路径是 nginx 上**对公网零鉴权直通生产 Hermes 网关**的 location，
        且带 terminal/file/browser 工具集 ⇒ 外网不带任何凭据即可在服务器上执行命令；
     ② "关"的一侧会**绕过后端 AI 停用管控**（`ai_mode` 只在后端代理这条路做权威判定）；
     ③ 它本质是运维应急开关（原 `client.js` 注释自述"紧急回滚，不用改代码"），不该给老板点。
   现在恒定走 `/api/ai/copilot/chat`；应急回滚改由**后端环境变量**承担。 */

/* ---- P1-⑥ 经营画像：让副驾"开口就懂这家客户"（缓存 10 分钟，静默失败不阻断） ---- */
const tenantProfile = ref('')
let profileLoadedAt = 0
async function ensureProfile() {
  const now = Date.now()
  if (tenantProfile.value && now - profileLoadedAt < 10 * 60 * 1000) return tenantProfile.value
  try {
    const res = await api('/api/ai/profile')
    const p = (res && res.profile) || ''
    if (p) { tenantProfile.value = p; profileLoadedAt = now }
    return p
  } catch (_) { return tenantProfile.value }
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
  // 过程回复：改成演示**真实在用的**「工具执行情况」UI（原 `progress` 是死路径，已移除）。
  // 字段与 Hermes `hermes.tool.progress` 实际下发的保持一致（含 emoji/label/耗时）。
  store.chat.messages.push({
    role: 'assistant',
    content: '长任务（如算整月工资）会实时显示「工具执行情况」，老板一眼看到走到哪一步：',
    tools: [
      { id: 'demo-1', name: 'skill_view', emoji: '📚', label: 'hergent-milk-commission', status: 'done', ms: 320 },
      { id: 'demo-2', name: 'terminal', emoji: '💻', label: '读取库存与效期批次', status: 'done', ms: 1840 },
      { id: 'demo-3', name: 'run_payroll', emoji: '🧮', label: '核算本月工资提成', status: 'running' }
    ]
  })
  scrollBottom()
  saveCurrentSession()
}

/* 卡片操作：采纳/驳回翻转状态留痕 + 落库（环1）；转发走面板；其余回写对话 */
function onCardAction({ key, card }) {
  if (key === 'forward') { openForward(card); return }
  const verbMap = { adopt: '采纳', detail: '查看明细', forward: '转发', save: '保存', reject: '驳回' }
  const verb = verbMap[key] || key
  if (key === 'adopt' || key === 'reject') {
    if (card && 'status' in card) card.status = (key === 'reject') ? 'rejected' : 'confirmed'
    logAdviceDecision(card, key)
  }
  draft.value = `${verb}「${card?.title || '该建议'}」`
  send()
}

/* P0 环1：把采纳/驳回信号落 ai_advice_log，让 AI 价值闭环第一次有数据 */
async function logAdviceDecision(card, key) {
  if (!card || card._logged) return
  card._logged = true
  try {
    const decision = key === 'adopt' ? 'adopted' : 'rejected'
    const created = await api('/api/ai/advice', {
      method: 'POST',
      body: { task_type: inferTaskType(card), advice_text: card.title || 'AI 建议', ai_source: 'copilot' }
    })
    if (created && created.advice_id) {
      await api(`/api/ai/advice/${created.advice_id}/decide`, {
        method: 'POST', body: { decision }
      })
    }
  } catch (e) {
    console.warn('[copilot] log advice decision failed:', e.message)
  }
}

function inferTaskType(card) {
  const t = (card && card.title ? card.title : '') + ' ' + ((card && card.content) || '')
  if (/货损|临期|报损|损失|损耗/.test(t)) return 'loss_calc'
  if (/工资|薪资|提成|个税|绩效/.test(t)) return 'payroll_calc'
  if (/返利|申领|目标/.test(t)) return 'rebate_calc'
  if (/预报|订货|下单|缺货|补货/.test(t)) return 'forecast'
  return 'copilot'
}

/* ---- M2 渐进式访谈：引导 chips 点击 -> 追加提问 ---- */
function askFollowup(f) {
  const q = (typeof f === 'object' && f !== null) ? (f.query || f.label) : f
  draft.value = q
  send()
}

/* ---- P2-⑦ 配方自进化提案：AI 发现新口径 → 老板一键采纳/忽略 ---- */
const MODULE_LABEL = { loss: '货损', payroll: '工资', forecast: '预报', rebate: '返利' }
const FIELD_LABEL = {
  threshold_days: '临期阈值(天)', pricing: '计价口径', dimension: '计算维度',
  near_loss_pct: '临期损耗率%', expired_coefficient: '过期损失系数',
  base_salary: '基本工资', commission_rate: '提成比例%', tax_standard_deduction: '个税起征点',
  performance: '绩效', bonus: '奖金', allowance: '津贴', deduction_other: '其他扣款',
  reorder_cycle: '补货周期', safety_factor: '安全系数', lead_time: '提前期',
  moq: '起订量', safety_days: '安全天数'
}
// 采纳/忽略 = 先落一条提案(source=ai)再审批；后端 accept 才会合并进配方并写审计
async function applyProposal(m, action) {
  if (!m.proposal || m.proposalStatus) return
  m.propBusy = true
  try {
    const created = await api('/api/ai/recipe-proposals', {
      method: 'POST',
      body: {
        module: m.proposal.module,
        title: m.proposal.title,
        changes: m.proposal.changes,
        rationale: m.proposal.rationale,
        source: 'ai'
      }
    })
    await api(`/api/ai/recipe-proposals/${created.id}/review`, { method: 'POST', body: { action } })
    m.proposalStatus = action === 'accept' ? 'accepted' : 'rejected'
    saveCurrentSession()
  } catch (e) {
    console.warn('[copilot] apply proposal failed:', e.message)
    store.chat.error = '配方提案处理失败：' + e.message
  } finally {
    m.propBusy = false
  }
}

/* ---- v483 P0-④：多步执行计划闸门 ----
   AI 先返回 steps 清单，点「执行计划」才按序真调写接口；「取消」零调用。
   写接口调用只在用户点执行后发生；渲染计划卡时零副作用（不 prefetch、不预校验会改动的对象）。 */
const PLAN_STEP_HANDLERS = {
  // 复用配方提案的「落提案→审批」链路（当前唯一已接好的写通道）
  recipe: async (s, m) => {
    const created = await api('/api/ai/recipe-proposals', {
      method: 'POST',
      body: {
        module: m.proposal.module || 'loss',
        title: s.target || m.proposal.title || 'AI 计划步骤',
        changes: s.detail ? safeJson(s.detail) : {},
        rationale: m.proposal.rationale,
        source: 'ai'
      }
    })
    await api(`/api/ai/recipe-proposals/${created.id}/review`, { method: 'POST', body: { action: 'accept' } })
  }
}
function safeJson(t) { try { const j = JSON.parse(t); return (j && typeof j === 'object') ? j : {} } catch (e) { return {} } }
async function runPlanStep(s, m) {
  const h = PLAN_STEP_HANDLERS[s.action]
  if (!h) throw new Error(`暂不支持的步骤类型「${s.action || '空'}」，需后端对接`)
  return h(s, m)
}
function stepClass(s) { return s.status || '' }
function proposalDoneText(m) {
  if (m.proposal.steps) {
    if (m.proposalStatus === 'accepted') return '计划已执行完成'
    const failed = m.proposal.steps.some(s => s.status === 'fail')
    return failed ? '计划执行中断，已完成步骤已保留' : '计划已取消'
  }
  return m.proposalStatus === 'accepted' ? '已采纳，口径已写入配方并同步给 AI' : '已忽略此建议'
}
async function applyPlan(m) {
  if (!m.proposal || !m.proposal.steps || m.proposalStatus) return
  m.propBusy = true
  let ok = true
  for (let i = 0; i < m.proposal.steps.length; i++) {
    const s = m.proposal.steps[i]
    s.status = 'running'
    try {
      await runPlanStep(s, m)
      s.status = 'done'
      store.toast(`第 ${i + 1} 步完成：${s.action}`)
    } catch (e) {
      s.status = 'fail'
      ok = false
      store.toast(`第 ${i + 1} 步失败：${e.message || '未知错误'}`, 'error')
      break   // 中止后续步骤，保留已完成步骤，便于用户续跑/回滚
    }
  }
  m.propBusy = false
  m.proposalStatus = ok ? 'accepted' : 'rejected'
  if (ok) saveCurrentSession()
}
function cancelPlan(m) {
  if (!m.proposal || m.proposalStatus) return
  m.proposalStatus = 'rejected'
  store.toast('已取消计划')
}

/* ---- P0-① 反馈纠错：对/错 → 落 memory（错可填纠正） ---- */
async function submitFeedback(m, type, correction = '') {
  // 乐观高亮：先亮，再发请求；失败回滚。去掉原 `if (m.feedback) return` 守卫，
  // 否则「点赞↔点踩」无法互相切换（toggleFeedback 切到另一种类型时会被这里拦死）。
  //
  // v426 P0-3：纠正文本改为**由调用方传入**（来自下方自绘纠错面板），本函数不再弹窗。
  // 原写法在这里直接调用浏览器原生的输入弹窗 —— 对一个不懂技术的老板来说
  // 就是「弹个框、不知道写啥、直接回车」⇒ 落库的 correct_result 为空 ⇒ 闭环照样不闭。
  const prev = m.feedback
  m.feedback = type
  correction = (correction || '').trim()
  const idx = store.chat.messages.indexOf(m)
  let original = ''
  for (let k = idx - 1; k >= 0; k--) {
    if (store.chat.messages[k].role === 'user') { original = store.chat.messages[k].content; break }
  }
  try {
    await api('/api/ai/feedback', {
      method: 'POST',
      body: { original_input: original, ai_result: m.content, feedback: type, correction }
    })
    if (type === 'bad' && correction) store.toast('已记下纠正，下次改进')
    else if (type === 'good') store.toast('感谢反馈')
    else store.toast('已记录')
  } catch (e) {
    m.feedback = prev   // 请求失败回滚高亮，避免「亮了却没存上」的静默不一致
    console.warn('[copilot] feedback failed:', e.message)
  }
}

/* ---- v423：单轮对话底部操作栏（对齐 WorkBuddy message-actions） ----
   复制 / 点赞 / 点踩 / 朗读 / 重新生成 / 分享 + 当前模型标识。 */
const readingId = ref(null)      // 正在朗读的助手消息下标（同时只允许一条）
const shareOpen = ref(null)      // 打开的分享菜单对应的消息下标

// 当前模型/智能体标识（WorkBuddy 在消息栏左侧展示所用模型）
// 纯前端复制（带非安全上下文兜底）
async function copyText(t) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t)
      return true
    }
  } catch (_) { /* 落到兜底 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch (_) { return false }
}

// 去掉 Markdown 噪音，便于朗读/复制纯文本
function stripMarkdownText(s) {
  return (s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// 复制本条回复
async function copyMsg(m) {
  const ok = await copyText(m.content || '')
  store.toast(ok ? '已复制回复' : '复制失败，请手动选择')
}

// 点赞 / 点踩（可再点取消，对齐 WorkBuddy 的 toggle 语义）
async function toggleFeedback(m, type) {
  if (m.feedback === type) {
    m.feedback = ''
    return
  }
  // v426 P0-3：点踩时先弹出「结构化纠错面板」收集正确答案，再落库。
  // 不能像点赞那样直接发请求 —— 那样 correction 恒为空，点踩就退化成一个纯粹的情绪统计，
  // 「点踩 + 填纠正 → 下次不再犯」这条闭环等于没闭上。
  if (type === 'bad') {
    await openCorrectionSheet(m)
    return
  }
  await submitFeedback(m, type, '')
}

/* ---- v426 P0-3：结构化纠错面板（取代浏览器原生输入弹窗） ----

   🔴 为什么必须有它：整个「反馈 → 记忆 → 下次改进」闭环里，**只有这一步需要人类产出**。
      前面所有环节（前端传输、后端落库、中文召回、注入提示词）都已在上轮打通，
      唯独这一环是个光秃秃的系统输入框 ⇒ 老板大概率写一句「不对」或干脆回车
      ⇒ 库里的 `correct_result` 是空的 ⇒ **召回算法再准也没东西可召回**。

   设计约束（刻意做薄，别做成表单）：
      · 最多三项：① 原因分类（点一下就选中）② 正确答案（一句话）③ 是否长期口径
      · 「不用了」永远可点 —— 只想点个踩、不想写字的人不能被卡住
      · 什么都不填就点提交 ⇒ **明确提示**，绝不静默关闭
*/
const CORR_REASONS = ['数字不对', '口径不对', '只说了情况，没给建议', '认错商品或客户', '其他']
const CORR_PLACEHOLDER = {
  '数字不对': '正确的数字应该是：',
  '口径不对': '正确的算法/口径是：',
  '只说了情况，没给建议': '你希望它直接给出什么建议：',
  '认错商品或客户': '正确的商品名或客户名是：',
  '其他': '哪里不对：',
}
const corr = ref({ open: false, cat: '', text: '', forever: false, hint: '' })
let corrResolve = null         // 面板关闭时的兑现口（Promise 写法，调用方 await 即可）

const corrPlaceholder = computed(() => CORR_PLACEHOLDER[corr.value.cat] || '正确答案应该是：')

function openCorrectionSheet(m) {
  corr.value = { open: true, cat: '', text: '', forever: false, hint: '' }
  return new Promise((resolve) => {
    corrResolve = async (payload) => {   // payload: null=不纠正，string=纠正文本
      corr.value.open = false
      corrResolve = null
      resolve()
      await submitFeedback(m, 'bad', payload || '')
    }
  })
}

function corrSubmit() {
  const text = (corr.value.text || '').trim()
  if (!corr.value.cat && !text) {
    corr.value.hint = '请先在上面选一项原因，或直接写一句正确答案'
    return
  }
  const parts = [corr.value.cat, text].filter(Boolean)
  const forever = corr.value.forever ? '【长期口径：以后遇到同类问题都按这个来】' : ''
  corrResolve && corrResolve(parts.join('：') + forever)
}

function corrSkip() {
  corrResolve && corrResolve(null)
}

/* ---- v456 朗读：**服务端合成**（微软神经语音）为主，浏览器内置为兜底 ----

   🔴 为什么必须改（实测结论，不是审美偏好）：
     Chrome（headless 与真实窗口**都一样**）在 macOS 上只暴露 **19 个 Google 在线语音**，
     其中**中文普通话只有 1 个**（"Google 普通话（中国大陆）"）—— macOS 的系统语音
     （Tingting / Meijia…）**一个都拿不到**。⇒ 用户说"声音不好听"时**根本没有第二个音色可选**；
     更严重的是 Windows / Mac / 各浏览器音色各不相同，**每个客户听到的声音不可控**。
   ⇒ 改为「后端合成 mp3 → 前端播放」（`/api/ai/tts`，edge-tts = 微软神经语音，免费无 key）：
      所有客户端听到**同一个**自然音色；换音色/语速只改后端，不动前端。
   ⇒ 服务端不可用（网络 / 上游接口变更 ⇒ 503）时**回落**浏览器内置朗读，保证"至少还能出声"。 */
const TTS_VOICE_KEY = 'hg_copilot_tts_voice'
const TTS_VOICE_DEFAULT = 'zh-CN-XiaoxiaoNeural'      // 晓晓（女·亲和）—— 试听后选定
const ttsVoice = ref((() => {
  try { return localStorage.getItem(TTS_VOICE_KEY) || TTS_VOICE_DEFAULT } catch { return TTS_VOICE_DEFAULT }
})())
let ttsAudio = null        // 当前播放的 Audio（同时只允许一条）
let ttsObjectUrl = ''      // 用完必须 revoke，否则 Blob 常驻内存
let ttsSeq = 0             // 请求序号：异步返回时校验"期间是否已被停止/切换"，防"按了停止还在念"

/** 停掉一切正在发声的东西（服务端音频 + 浏览器内置语音），并复位按钮态。 */
function stopRead() {
  ttsSeq++
  if (ttsAudio) { try { ttsAudio.pause() } catch { /* ignore */ } ttsAudio = null }
  if (ttsObjectUrl) { try { URL.revokeObjectURL(ttsObjectUrl) } catch { /* ignore */ } ttsObjectUrl = '' }
  if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel() } catch { /* ignore */ } }
  readingId.value = null
}

/** 兜底：浏览器内置朗读（只在服务端合成不可用时才走这里）。
 *  v490：兜底本身也可能"不出声"（本机无中文语音 / 被系统静音 / 被浏览器策略拦截）
 *        ⇒ 用看门狗明确告知，不再让用户对着"点了没反应"的按钮猜。 */
function speakLocal(text, i, notice) {
  if (!('speechSynthesis' in window)) {
    readingId.value = null
    store.toast('朗读不可用：当前浏览器不支持语音朗读')
    return
  }
  if (notice) store.toast(notice)
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  let started = false
  const watchdog = setTimeout(() => {
    if (!started && readingId.value === i) {
      readingId.value = null
      store.toast('朗读没有出声：请检查系统音量或浏览器的语音设置')
    }
  }, 1500)
  u.onstart = () => { started = true; clearTimeout(watchdog) }
  u.onend = () => { clearTimeout(watchdog); if (readingId.value === i) readingId.value = null }
  u.onerror = () => { clearTimeout(watchdog); if (readingId.value === i) readingId.value = null }
  try { window.speechSynthesis.speak(u) } catch (_) {
    clearTimeout(watchdog); readingId.value = null
    store.toast('朗读启动失败，请稍后重试')
  }
}

// 朗读 / 停止朗读（v456：服务端合成 → 失败回落浏览器内置；v490：失败不再静默）
async function toggleRead(m, i) {
  if (readingId.value === i) { stopRead(); return }    // 再点一次 = 停止
  stopRead()                                           // 切换消息时先停掉上一条
  const text = stripMarkdownText(m.content)
  if (!text) { store.toast('本条没有可朗读的内容'); return }
  readingId.value = i
  const seq = ttsSeq
  try {
    const blob = await apiBlob('/api/ai/tts', {
      method: 'POST', body: { text, voice: ttsVoice.value }, timeout: 30000,
    })
    if (seq !== ttsSeq || readingId.value !== i) return  // 期间已停止/切换 ⇒ 丢弃结果
    ttsObjectUrl = URL.createObjectURL(blob)
    ttsAudio = new Audio(ttsObjectUrl)
    ttsAudio.onended = () => { if (readingId.value === i) stopRead() }
    ttsAudio.onerror = () => {
      if (readingId.value !== i) return
      stopRead()
      speakLocal(text, i, '在线语音播放失败，已改用浏览器朗读')
    }
    try {
      await ttsAudio.play()
    } catch (playErr) {
      if (seq !== ttsSeq || readingId.value !== i) return
      // v490：异步等待后用户手势可能已过期 ⇒ 浏览器拦截自动播放。给明确指引，不静默。
      stopRead()
      store.toast('浏览器拦截了自动播放，请再点一次「朗读」')
    }
  } catch (e) {
    if (seq !== ttsSeq || readingId.value !== i) return
    // v490：服务端合成失败（如 503）不再静默 —— 明确告知已降级，避免"点了没反应"的困惑。
    speakLocal(text, i, '在线语音服务暂不可用，已改用浏览器朗读')
  }
}

/* ---- v461：朗读声音选择（工具栏「朗读声音」胶囊）----

   可选项来源 = 后端 `GET /api/ai/tts/voices`（**唯一源**：音色白名单 + 默认值都在 `routers/ai_tts.py` 定义）。
   🔴 前端**不另抄一份名单** —— 否则后端加/换音色时前端不认，界面显示与真实可用的声音会脱节。
   兜底：清单拉不到（网络/权限）时，菜单至少保留"当前声音"一行，不空白、也不骗人。 */
const showVoiceMenu = ref(false)
const ttsVoices = ref([])                          // [{id,name,gender,style}]，来自后端
const ttsVoiceDefault = ref(TTS_VOICE_DEFAULT)     // 后端下发的默认音色（用作"（默认）"标记与自愈回落）
const ttsVoicesLoading = ref(false)
const ttsVoicesErr = ref(false)

/** 当前声音的显示名（清单未到时为空 ⇒ 胶囊回落显示「朗读声音」）。 */
const ttsVoiceName = computed(() => {
  const v = ttsVoices.value.find(x => x.id === ttsVoice.value)
  return (v && v.name) || ''
})
/** 菜单项：清单没到时至少给"当前声音"一行，菜单不至于空。 */
const ttsVoiceOptions = computed(() => {
  if (ttsVoices.value.length) return ttsVoices.value
  return [{ id: ttsVoice.value, name: ttsVoiceName.value || '当前声音', gender: '', style: '' }]
})
/** 菜单副标题：性别 · 风格（+ 默认标记）。 */
function voiceDesc(v) {
  const s = [v.gender, v.style].filter(Boolean).join(' · ')
  if (v.id === ttsVoiceDefault.value) return s ? s + '（默认）' : '默认声音'
  return s
}
/** 拉取音色清单（只拉一次；失败静默降级，仅置错误标记）。 */
async function loadTtsVoices() {
  if (ttsVoices.value.length) return
  ttsVoicesLoading.value = true
  ttsVoicesErr.value = false
  try {
    const d = await api('/api/ai/tts/voices')
    const list = (d && d.voices) || []
    if (list.length) {
      ttsVoices.value = list
      if (d.default) ttsVoiceDefault.value = d.default
      // 自愈：本地存的声音若已不在可用清单里（后端换过名单），回落到默认
      if (!list.some(v => v.id === ttsVoice.value)) ttsVoice.value = ttsVoiceDefault.value
    } else {
      ttsVoicesErr.value = true
    }
  } catch (e) {
    ttsVoicesErr.value = true          // 静默降级：菜单仍可用（只剩"当前声音"一行）
  } finally {
    ttsVoicesLoading.value = false
  }
}
function toggleVoiceMenu() {
  const on = !showVoiceMenu.value
  closeMenus('voice')                  // 与其它下拉互斥（集中管理，见 closeMenus 注释）
  showVoiceMenu.value = on
  if (on) loadTtsVoices()
}
/** 选中即生效：写 localStorage（下次进来自动沿用）+ 关菜单；**不打断正在念的那条**（用户语义=「用于后续朗读」）。 */
function pickTtsVoice(v) {
  ttsVoice.value = v.id
  try { localStorage.setItem(TTS_VOICE_KEY, v.id) } catch { /* ignore */ }
  showVoiceMenu.value = false
  store.toast('朗读声音已切换为「' + v.name + '」，下次朗读生效')
}

// 重新生成：移除本条助手回复及其之后所有内容，复用其前的用户消息重跑（语义同 WorkBuddy 的 resend）
async function regenerate(i) {
  if (store.chat.streaming) return
  const msgs = store.chat.messages
  if (i < 0 || i >= msgs.length || msgs[i].role !== 'assistant') return
  msgs.splice(i)                       // 删掉本条及之后（下游轮次一并失效，符合"重生成覆盖后续"）
  const userMsg = msgs[msgs.length - 1]
  if (!userMsg || userMsg.role !== 'user') return
  const roleId = (currentRole.value && currentRole.value.role_id) || ''
  const rolePrompt = currentRole.value ? currentRole.value.system_prompt : ''
  lastPayload = {
    content: userMsg.content,
    sys: rolePrompt,
    roleId,
    q: userMsg.content,
    tableFiles: [],
    files: userMsg.files || [],
    vision: userMsg.vision || null
  }
  streamReply(lastPayload, true)
}

function toggleShare(i) {
  shareOpen.value = shareOpen.value === i ? null : i
}

// 分享：复制回复 / 复制问答（带前文用户问题）
async function shareCopy(m, kind) {
  const idx = store.chat.messages.indexOf(m)
  let q = ''
  for (let k = idx - 1; k >= 0; k--) {
    if (store.chat.messages[k].role === 'user') { q = store.chat.messages[k].content; break }
  }
  const text = kind === 'qa' ? `${q}\n\n${m.content}` : (m.content || '')
  const ok = await copyText(text)
  shareOpen.value = null
  store.toast(ok ? (kind === 'qa' ? '已复制问答' : '已复制回复') : '复制失败')
}

// v424：复制当前页面链接（粘进微信即可分享）；生成二维码（手机微信扫一扫）
async function shareCopyLink() {
  const url = window.location.href
  const ok = await copyText(url)
  shareOpen.value = null
  store.toast(ok ? '已复制页面链接' : '复制失败，请手动复制网址')
}

const qrUrl = ref(null)
async function shareQR() {
  try {
    qrUrl.value = await QRCode.toDataURL(window.location.href, { width: 168, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
  } catch (e) {
    store.toast('二维码生成失败')
  }
  shareOpen.value = null
}

/* ---- v486 P1-⑤：我的待办（可视管理）—— AI 记下的提醒在这里看得见、能完成、能删 ----
   后端接口早已齐备（GET/POST/PATCH /api/ai/reminders，ai_assist.py），此前只是**没有界面**，
   所以「记下就消失」。本段只补前端，后端零改动。 */
const artTab = ref('art')          // 'art' = 本次产物 | 'todo' = 我的待办
const todos = ref([])
const todoLoading = ref(false)
const todoErr = ref('')

// 后端把「AI 连续兜底失败」也写进同一张表（created_by='ai-fallback'），
// 那是系统自诊断通知、不是老板的待办 —— 混进来会让面板变成噪音，故在此过滤。
function isUserTodo(r) { return r && r.created_by !== 'ai-fallback' }

function repeatText(rule) {
  if (!rule) return ''
  const map = { once: '一次', daily: '每天', weekly: '每周', monthly: '每月' }
  return map[rule] || rule
}

async function loadTodos() {
  todoLoading.value = true
  todoErr.value = ''
  try {
    const d = await api('/api/ai/reminders')
    const items = (d && d.items) || []
    // 已完成/已取消的不进面板（后端已软删，这里只是不展示）
    todos.value = items.filter(r => r.status !== 'done' && r.status !== 'cancel' && isUserTodo(r))
  } catch (e) {
    // 403 = 该角色没有 AI 模块权限（如「主管」未开通）—— 要**说清楚**，不能静默空白
    const msg = (e && e.message) || ''
    todoErr.value = /403|权限/.test(msg) ? '没有权限查看待办（需管理员开通 AI 功能）' : '待办加载失败'
  } finally {
    todoLoading.value = false
  }
}

function openTodoTab() {
  artTab.value = 'todo'
  if (!todos.value.length && !todoLoading.value) loadTodos()
}

async function todoDone(t) {
  try {
    await api(`/api/ai/reminders/${t.id}`, { method: 'PATCH', body: { status: 'done' } })
    todos.value = todos.value.filter(x => x.id !== t.id)
    store.toast('已完成')
  } catch (e) {
    store.toast('操作失败，请重试')
  }
}

async function todoRemove(t) {
  try {
    // 后端没有物理删除接口，取消即软删（status='cancel'）—— 与「完成」同族、可逆语义
    await api(`/api/ai/reminders/${t.id}`, { method: 'PATCH', body: { status: 'cancel' } })
    todos.value = todos.value.filter(x => x.id !== t.id)
    store.toast('已删除')
  } catch (e) {
    store.toast('操作失败，请重试')
  }
}

/* ---- P0-② AI 待办提醒：记下 → 落 ai_reminders，scheduler 到点推送 ---- */
async function applyReminder(m, action) {
  if (m.reminderStatus) return
  if (action === 'cancel') { m.reminderStatus = 'cancelled'; saveCurrentSession(); return }
  try {
    await api('/api/ai/reminders', {
      method: 'POST',
      body: { title: m.reminder.title, remind_at: m.reminder.remind_at, repeat_rule: m.reminder.repeat }
    })
    m.reminderStatus = 'saved'
    saveCurrentSession()
    // v486 P1-⑤：刚记下的待办要立刻出现在「我的待办」面板里（面板正开着才拉，省一次请求）
    if (artTab.value === 'todo') loadTodos()
  } catch (e) {
    console.warn('[copilot] save reminder failed:', e.message)
    store.toast('提醒保存失败，请重试')
  }
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
// 🔴 这两个常量与 `.cp-input` 的 CSS `min-height/max-height` **必须成对修改**：
//    autoGrow 会把内联 height 写死在 textarea 上、**覆盖 CSS** ⇒ 只改 CSS 会静默无效（高度不变）。
//    2026-09-25 对齐 WorkBuddy：40/168 → 48/240（其可编辑区为 min 50 / max 252）。
const INPUT_MIN_H = 48
const INPUT_MAX_H = 240
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

// H2：File -> base64 data URL（把图片真正喂给视觉模型，修复"伪多模态"）
function readFileAsDataUrl(f) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(f)
  })
}

async function onFile(ev) {
  const f = ev.target.files?.[0]
  ev.target.value = ''
  if (!f) return
  uploading.value = true
  try {
    const d = await chatAttachmentApi.upload(f)
    // H2：图片读取为 base64 data URL，随消息送给 Hermes 视觉模型（此前图片只当文件名文本，模型看不到）
    if (/^image\//i.test(f.type) || /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name)) {
      try { d.dataUrl = await readFileAsDataUrl(f) } catch (_) { /* 读不出则退化为纯文本引用 */ }
    }
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

/* ---- M7 截图（剪刀）按钮 v465：点按钮 → 选屏/窗 → 抓首帧 → 区域框选 → 裁剪后作为图片附件 ---- */
const snapping = ref(false)
const cropMask = ref(null)
const cropStage = ref(null)
const snapCrop = reactive({
  show: false, src: '', fullW: 0, fullH: 0, dispW: 0, dispH: 0,
  rect: { x: 0, y: 0, w: 0, h: 0 }, dragging: false, dragStart: { x: 0, y: 0 },
})
let snapFullCanvas = null
const clampSnap = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

async function captureScreenshot() {
  if (snapping.value) return
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    store.toast('当前浏览器不支持屏幕截图，请用电脑版 Google Chrome 打开副驾后重试', 'warn')
    return
  }
  snapping.value = true
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false })
    const track = stream.getVideoTracks()[0]
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    // 等首帧就绪再抓（requestVideoFrameCallback 优先，否则退化为延时；1.5s 兜底防卡死）
    await new Promise((resolve) => {
      let done = false
      const fin = () => { if (!done) { done = true; resolve() } }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(fin)
      else video.onloadeddata = () => setTimeout(fin, 200)
      setTimeout(fin, 1500)
    })
    const w = video.videoWidth, h = video.videoHeight
    if (!w || !h) throw new Error('未能读取画面尺寸')
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    if (track) track.stop()
    openCropEditor(canvas, w, h)
  } catch (e) {
    // 用户取消选屏 / 拒绝授权：静默
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError' || (e.message || '').indexOf('Permission denied') >= 0)) return
    store.toast('截图失败：' + (e && e.message ? e.message : e), 'error')
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop())
    snapping.value = false
  }
}

// v465：抓到整幅画面后，弹全屏遮罩让用户拖拽框选区域
function openCropEditor(canvas, w, h) {
  const maxW = Math.floor(window.innerWidth * 0.9)
  const maxH = Math.floor(window.innerHeight * 0.8)
  const scale = Math.min(1, maxW / w, maxH / h)
  snapFullCanvas = canvas
  snapCrop.fullW = w
  snapCrop.fullH = h
  snapCrop.dispW = Math.max(1, Math.round(w * scale))
  snapCrop.dispH = Math.max(1, Math.round(h * scale))
  snapCrop.src = canvas.toDataURL('image/png')
  snapCrop.rect = { x: 0, y: 0, w: 0, h: 0 }
  snapCrop.dragging = false
  snapCrop.show = true
  nextTick(() => { if (cropMask.value) cropMask.value.focus() })
}
function onCropDown(e) {
  if (!snapCrop.show || !cropStage.value) return
  const r = cropStage.value.getBoundingClientRect()
  const x = clampSnap(e.clientX - r.left, 0, snapCrop.dispW)
  const y = clampSnap(e.clientY - r.top, 0, snapCrop.dispH)
  snapCrop.dragging = true
  snapCrop.dragStart = { x, y }
  snapCrop.rect = { x, y, w: 0, h: 0 }
}
function onCropMove(e) {
  if (!snapCrop.dragging || !cropStage.value) return
  const r = cropStage.value.getBoundingClientRect()
  const cx = clampSnap(e.clientX - r.left, 0, snapCrop.dispW)
  const cy = clampSnap(e.clientY - r.top, 0, snapCrop.dispH)
  const sx = snapCrop.dragStart.x, sy = snapCrop.dragStart.y
  snapCrop.rect = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) }
}
function onCropUp() { snapCrop.dragging = false }
function cancelCrop() { closeCrop() }
function confirmCrop() {
  if (!snapFullCanvas) { closeCrop(); return }
  const scale = snapCrop.fullW / snapCrop.dispW
  let sx, sy, sw, sh
  if (snapCrop.rect.w < 4 || snapCrop.rect.h < 4) {
    // 没框选 → 默认用整图
    sx = 0; sy = 0; sw = snapCrop.fullW; sh = snapCrop.fullH
  } else {
    sx = Math.round(snapCrop.rect.x * scale)
    sy = Math.round(snapCrop.rect.y * scale)
    sw = Math.round(snapCrop.rect.w * scale)
    sh = Math.round(snapCrop.rect.h * scale)
  }
  const out = document.createElement('canvas')
  out.width = sw; out.height = sh
  out.getContext('2d').drawImage(snapFullCanvas, sx, sy, sw, sh, 0, 0, sw, sh)
  out.toBlob(async (blob) => {
    if (!blob) { store.toast('裁剪失败', 'error'); closeCrop(); return }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
    const file = new File([blob], `截图${stamp}.png`, { type: 'image/png' })
    closeCrop()
    await uploadScreenshot(file)
  }, 'image/png')
}
function closeCrop() {
  if (snapCrop.src && snapCrop.src.startsWith('blob:')) URL.revokeObjectURL(snapCrop.src)
  snapCrop.show = false
  snapCrop.src = ''
  snapCrop.rect = { x: 0, y: 0, w: 0, h: 0 }
  snapFullCanvas = null
}

async function uploadScreenshot(file) {
  uploading.value = true
  try {
    const d = await chatAttachmentApi.upload(file)
    // H2：图片读 base64 供视觉模型看（与 onFile 同一套）
    try { d.dataUrl = await readFileAsDataUrl(file) } catch (_) { /* 读不出则退化为纯引用 */ }
    attachments.value.push(d)
    store.chat.error = ''
    store.toast('截图已附到输入框，可补充说明后发送')
  } catch (e) {
    store.chat.error = (e && e.message) || '截图上传失败'
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

/* ---- v622：抽屉重开时回到「你离开的位置」-------------------------------------------------
   🔴 病根（用户实测，探针复现）：抽屉是 `v-if` 挂载的，关闭时整个 DOM（含 `.cp-body` 的
     scrollTop）**连根销毁**。而「打开」分支只有「空白态才恢复最近会话」那一条分支做了
     scrollBottom，**已有对话直接重开时没有任何滚动代码** ⇒ 新建出来的 `.cp-body` scrollTop=0
     ⇒ 用户看到的是这段对话的**第一条**，刚落下的那条回复在 3000px 之外。
     实测（24 条长消息）：首开 gapToBottom=0；关掉再开 scrollTop=0、gapToBottom=3078。
   修法：用一次 scroll 事件把「位置 + 是否贴底」记在组件上（不依赖关的那一刻 DOM 还在不在），
     重开时按它还原：
       · 原来贴底（生成中 / 刚看完最新）→ 回到底部，**关闭期间流式落下的新回复也一并看到**；
       · 原来在中段翻历史 → 还原当时的 scrollTop，不把人从读到一半的地方拽走。
   ⚠️ 不能用「记 scrollTop 数值」单独判断：关闭期间内容可能变长，同一个数值在变长后的文档里
      已经不是原来那段话了 —— 所以必须同时记「是否贴底」。 */
let savedScroll = null      // { top, atBottom } | null（null = 没有记录 ⇒ 当作贴底）
function onBodyScroll() {
  const el = cpBody.value
  // 关闭动画期间 / 卸载瞬间也可能收到 scroll，别把记录冲成 0（那会让下次重开反而回到顶部）
  if (!el || !el.isConnected || !store.ui.copilotOpen) return
  savedScroll = { top: el.scrollTop, atBottom: el.scrollHeight - el.clientHeight - el.scrollTop <= 40 }
}
/** 打开后还原位置。nextTick 只保证「元素在」，不保证「内容撑开了」——
 *  Markdown/表格/图片是随渲染异步变高的，所以再补一帧 + 一次 180ms 兜底（仅贴底时补）。 */
function restoreScroll() {
  const el = cpBody.value
  if (!el) return
  const s = savedScroll
  const toBottom = !s || s.atBottom
  const apply = () => {
    const e = cpBody.value
    if (!e) return
    if (toBottom) e.scrollTop = e.scrollHeight
    else e.scrollTop = Math.min(s.top, Math.max(0, e.scrollHeight - e.clientHeight))
  }
  apply()
  requestAnimationFrame(apply)
  if (toBottom) {
    setTimeout(() => {
      // 这 180ms 内用户自己往上翻了 ⇒ savedScroll.atBottom 变 false，就别再把人拽回底部
      if (savedScroll && savedScroll.atBottom === false) return
      const e = cpBody.value
      if (e) e.scrollTop = e.scrollHeight
    }, 180)
  }
}

/* ---- 方案 B：右侧 Artifact 面板 —— 从对话消息中派生产物索引（最新在上） ---- */
const artifacts = computed(() => {
  const msgs = store.chat.messages
  const list = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (!m) continue
    // v487 P2-⑨：来源指令 = 最近一条 user 消息片段（零新接口，数据从消息链取）
    let source = ''
    for (let j = i - 1; j >= 0; j--) {
      if (msgs[j] && msgs[j].role === 'user' && msgs[j].content) {
        source = String(msgs[j].content).replace(/\s+/g, ' ').trim().slice(0, 14)
        break
      }
    }
    const base = { created_at: m.created_at || null, source }
    if (m.card) list.push({ ...base, index: i, card: m.card })
    /* 🔴 v492：用户**上传**给副驾的文件（`m.files`）**不再**登记进产物集合。
       产物区语义 = 「副驾产出的报告 / 图表 / 文件」；用户发来的材料是**输入**、不是产物，
       放进产物区会让人误以为「这是 AI 生成的东西」（老板原话：这不应该是副驾的产物）。
       它们**只**留在对话流里 —— `send()` 已把「【附件：…】」拼进用户消息 content，气泡可见。
       与 WorkBuddy 语义一致：结果区只放 Agent 的交付物，用户上传物留在会话流。 */
    /* v489：副驾**产出文件**（Hermes `MEDIA:<路径>` 标记）也必须登记进产物集合。
       🔴 原先它只被当正文装饰 —— `mediaFiles(m)` 只在气泡里渲染一张下载卡，
          侧栏产物区永远看不到它 ⇒ 表现为「产物只出现在回复区，落不到侧栏产物区」。
       对齐 WorkBuddy 的产物落位：产物由**显式动作**（`present_files` → 右侧结果区）决定去处；
          回复里可以留一个「入口」，但**产物本体必须沉淀到侧栏结果区**。
       `file_name` 是给 isImage/isVideo/isHtml 复用所需的字段名（它们的判据读的是 file_name）。 */
    for (const pf of mediaFiles(m)) {
      if (pf && pf.path) list.push({ ...base, index: i, produced: { path: pf.path, name: pf.name, file_name: pf.name } })
    }
  }
  return list.reverse()
})
/* v495b：时间戳归一 —— 本地存的是 Date.now() 数字，服务端回的是 'YYYY-MM-DD HH:MM:SS' 字符串
   （空格分隔不是合法 ISO，new Date() 会解析成 Invalid Date ⇒ 产物时间显示 NaN月NaN日）。统一转毫秒。 */
function toTs(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const n = Date.parse(String(v).replace(' ', 'T'))
  return isNaN(n) ? 0 : n
}
/* v487 P2-⑨：产物生成时间相对化（刚刚 / x 分钟前 / 时:分 / 月日） */
function fmtArtTime(ts) {
  const t = toTs(ts)
  if (!t) return ''
  const d = new Date(t)
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  const pad = (n) => String(n).padStart(2, '0')
  if (diff < 86400 && d.getDate() === new Date().getDate()) return pad(d.getHours()) + ':' + pad(d.getMinutes())
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}
/* v495b：消息气泡的绝对时间（老板要"查看沟通时间"，绝对时间比相对更便于回看历史） */
function fmtMsgTime(ts) {
  const t = toTs(ts)
  if (!t) return ''
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes())
  const date = (now.getFullYear() === d.getFullYear()
    ? (pad(d.getMonth() + 1) + '-' + pad(d.getDate()))
    : (d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())))
  return date + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
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
// 表格软提示实现已迁移到 utils/copilotTurn.js（spreadsheetSoftHint / shouldInjectTableHint），
// 支持「本轮无附件、但会话历史带表」也注入约束（防模型退回 terminal 乱翻导致长任务超时）。
// 上方 Plan A 说明仍适用。

let lastPayload = null   // 最近一次发送载荷，供「重试」使用（含表格软提示）

/* ============================================================
   v309（2026-09-28）「停止生成」—— 对齐 WorkBuddy（本机 app.asar 实测）
   ------------------------------------------------------------
   WorkBuddy 的做法（源码原文，包路径 packages/conversation-render/src/
   chat-input/components/send-button/send-button.tsx）：
     · **发送与停止是同一个按钮**，按 loading 分流：
         const handleClick = () => { if (canStop) { onStop?.(); return }
                                     if (loading) return
                                     if (semanticDisabled) return
                                     store.api.send()... }
     · `canStop   = loading && !!onStop && !cancelDisabled`
       `semantic` = loading ? (cancelDisabled || !onStop) : isSendDisabled
       ⇒ **loading 期间按钮不再 disabled**（除非宿主显式取消停止能力）
     · 视觉：`--sending`（只能等，不能停）opacity .7 / cursor default；
             `--stop` 颜色与**发送态同值**（`--cr-internal-send-button-fill-stop` =
             rgba(0,0,0,.9) light、rgba(255,255,255,.92) dark）⇒ **不换色，只把箭头换方块**
             （方块 12/32 × 32 圆盘内、corner radius 3）
     · 文案：tooltip/aria-label 三态 发送 / 发送中… / 停止；二次确认时按钮显示快捷键「Esc」
     · 二次确认（pendingStopConfirm）：先按一次快捷键 → 按钮变「Esc」提示、
       tooltip 变「再次按下快捷键停止」→ 再按一次才真的停（防误触）
     · 真正落地停止 = 取消 SSE reader + abortController.abort() 掐断 fetch +
       再向服务端 DELETE 一条拆除该次运行（我们的后端是直通代理：浏览器 abort 后
       Starlette 会关闭上游生成器并 resp.close()，故只需前两步）
   ------------------------------------------------------------
   🔴 原先的缺陷：`:disabled` 里带着 `store.chat.streaming` ⇒ 流式期间发送键被禁用，
      **消息发出后没有任何办法停止**（越长的任务越难等）。
   ============================================================ */
const stopRequested = ref(false)   // 这次中止是「用户点的停止」，而不是超时/断网
const sctrl = shallowRef(null)     // 当前流式请求的中止器（null = 当前没有可停的请求）
const stopConfirm = ref(false)     // Esc 二次确认态（对齐 WB 的 pendingStopConfirm）
let stopConfirmTimer = null
/** 有正在跑的、可被中止的请求 ⇒ 按钮呈「停止」态（对应 WB 的 canStop） */
const canStop = computed(() => store.chat.streaming && !!sctrl.value)
const stopHint = computed(() => (stopConfirm.value ? '再次按下 Esc 停止' : '停止生成（Esc）'))

// v522：流式进行中用户又发来的输入 → 入队（只保留最新一条），当前回复结束后自动补发。
// 修复「连发几条只有第一条真正发出、后几条被 store.chat.streaming 守卫静默丢弃」的已读不回缺陷。
const pendingInput = ref(null)      // { q, attachments }
const queueHint = ref('')

function resetStopConfirm() {
  if (stopConfirmTimer) { clearTimeout(stopConfirmTimer); stopConfirmTimer = null }
  stopConfirm.value = false
}

/** 停止当前回复。真正的掐断在 `sctrl.abort()`（见 api/client.js 的 _mergeSignal）；
 *  这里先把 UI 解锁，避免「点了停止、按钮还是停止、要等一个网络回合」的空窗。 */
function stopReply() {
  if (!canStop.value) return
  resetStopConfirm()
  stopRequested.value = true
  try { sctrl.value.abort() } catch (_) { /* 已收尾，忽略 */ }
  store.chat.streaming = false
  // 🔴 不在 stopReply 里直接 flush：abort 后旧 streamReply 的 catch→stopped 分支会负责补发，
  // 这里抢先 flush 会与旧 catch 的 sctrl.value=null 形成竞态、误清新建流的停止器。
}

/** v522：当前流式回复结束后，若有排队输入，自动补发（取最新一条）。
 *  流式进行中用户连发的新消息不再被静默丢弃 —— 这是「已读不回」的根因修复点。 */
function flushPending() {
  if (store.chat.streaming) return           // 还在流，不能抢发
  if (!pendingInput.value) return
  const item = pendingInput.value
  pendingInput.value = null
  queueHint.value = ''
  draft.value = item.q
  attachments.value = item.attachments || []
  // 等本次 streamReply 的收尾（saveCurrentSession 等）彻底走完再发
  nextTick(() => send())
}

async function send() {
  const q = draft.value.trim()
  if (!q && !attachments.value.length) return
  // v522：流式进行中不直接丢弃，改为入队排队（当前回复结束自动补发），杜绝已读不回
  if (store.chat.streaming) {
    pendingInput.value = { q, attachments: attachments.value.slice() }
    attachments.value = []
    draft.value = ''
    queueHint.value = '已排队，当前回复完成后自动发送'
    return
  }
  if (aiMode.value === 'disabled') { store.chat.error = 'AI 已停用（后台设置）。如需使用请管理员开启。'; return }
  if (aiMode.value === 'readonly') aiGuard.value = 'advise'  // 只读模式强制只建议
  draft.value = ''
  nextTick(() => { if (cpInput.value) autoGrow(cpInput.value) })
  store.chat.error = ''

  // 拼装消息：附件解析文本 + 用户问题
  let content = q
  let tableFiles = []   // 上传的 Excel/CSV 附件（含 file_id），供 Hermes 跨文件/单文件全量表计算引用
  let files = []        // v492：附件原文件（file_id），挂在用户消息上供「重新生成」回传 Hermes；**不再**进侧栏产物区
  let visionBlocks = [] // H2：图片视觉块（base64 直传 Hermes 视觉模型）
  if (attachments.value.length) {
    tableFiles = attachments.value.filter(a => a.file_id && /\.(xlsx|csv)$/i.test(a.file_name))
    files = attachments.value
      .filter(a => a.file_id)
      .map(a => ({ file_id: a.file_id, file_name: a.file_name, file_type: a.file_type || 'file', rows: a.rows || 0 }))
    // 静默读取：消息只留轻量引用（文件名+行数，自包含可溯源），不把表格正文 preview 塞进上下文。
    // 全量数据由 Hermes 经 spreadsheet MCP 工具按 file_id 静默读取，避免截断预览误导模型心算。
    const parts = attachments.value.map(a => {
      const head = `【附件：${a.file_name}${a.rows ? `（${a.rows} 行）` : ''}】`
      return `${head}（已上传，AI 已读取全量数据）`
    })
    content = parts.join('\n\n') + (q ? `\n\n我的问题：${q}` : '\n\n请分析这份数据。')
    // H2：图片转为视觉块（base64 直传 Hermes 视觉模型，无需 Hermes 回连后端）
    visionBlocks = attachments.value
      .filter(a => a.dataUrl)
      .map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } }))
    if (visionBlocks.length) {
      content += `\n\n（已附带 ${visionBlocks.length} 张图片，请结合图片内容一并分析）`
    }
    attachments.value = []
  }

  // v319（L2）：把系统提示拆成**两段** ——
  //   ① 角色人设：只在"没有角色 id"时兜底。（传了 roleId ⇒ 人格与能力边界都由**后端**
  //      用服务端角色定义拼装，避免同一个人设下发两份、互相干扰）
  //   ② 附加上下文：表格软提示 / 每日经营日志 / 经营画像 —— 这些是**数据**，
  //      永远要传，后端会把它们排在能力授权书之后并显式标注"非指令"。
  const rolePrompt = currentRole.value ? currentRole.value.system_prompt : ''
  let sysCtx = ''
  if (shouldInjectTableHint({ tableFiles, messages: store.chat.messages })) sysCtx = (sysCtx ? sysCtx + '\n' : '') + spreadsheetSoftHint(tableFiles)

  // P0-② 时间锚点：老板问「昨天/上周」时，把每日经营日志注入 AI 上下文（静默，失败不阻断）
  const anchorDays = timeAnchorDays(q)
  if (anchorDays) {
    try {
      const res = await api(`/api/ai/daily-log?days=${anchorDays}`)
      const logs = (res && res.logs) || []
      const ctx = formatDailyLogForAI(logs)
      if (ctx) sysCtx = (sysCtx ? sysCtx + '\n\n' : '') + ctx
    } catch (_) { /* 静默降级，不阻断主对话 */ }
  }

  // P1-⑥ 经营画像：让副驾"开口就懂这家客户"（缓存 10 分钟，静默失败不阻断）
  try {
    const profile = await ensureProfile()
    if (profile) sysCtx = (sysCtx ? sysCtx + '\n\n' : '') + `【这家店的经营画像】${profile}（回答时自然参考，勿逐字复述）`
  } catch (_) { /* 静默降级 */ }

  // P0-③ 动作分级护栏：只建议档显式注入行为边界（信任透明化 + 未来写能力护栏）
  //   ⚠️ v319 起这一条与「角色权限档」同向但不同源：本开关是**租户级**，角色档是**角色级**。
  //      两者都只能收窄，叠加是双保险；后端 `role_caps` 已把租户 AI 模式并进角色 guard。
  if (aiGuard.value === 'advise') {
    sysCtx = (sysCtx ? sysCtx + '\n\n' : '') + AI_GUARD_HINT
  }

  const roleId = (currentRole.value && currentRole.value.role_id) || ''
  // 🔴 兼容性决策（重要）：**仍然把完整人设放进 system**，而不是"传了 roleId 就不传人设"。
  //   原因：前端与后端是两条独立部署线，中间必有时间窗。若前端先上线而后端未上线，
  //   后端不认识 roleId、只会照用前端 system ⇒ AI **当场丢掉角色人设**（可感知的功能倒退）。
  //   现在这样两边都不会坏：
  //     · 旧后端：照用 system（含人设）⇒ 与升级前逐字相同
  //     · 新后端：看到 roleId ⇒ 用服务端角色定义拼装，并把前端这段人设前缀**剥掉**
  //       （否则同一个人设下发两遍、互相干扰）
  const sys = rolePrompt + (sysCtx ? '\n\n' + sysCtx : '')
  lastPayload = { content, sys, roleId, q, tableFiles: [...tableFiles], files, vision: visionBlocks }
  streamReply(lastPayload)
}

/* 流式发送核心：成功才触发卡片/推送并落盘；失败（含超时中断）只移除半截气泡、
   给出分级错误，绝不误报「离线」或追发卡片请求（P0 评审炸弹 #4）。 */
async function streamReply(payload, reuseUserMsg = false) {
  const { content, sys, roleId, q, tableFiles, files, vision } = payload
  store.chat.error = ''
  // v423：regenerate 时用户消息已在对话里（上一条），不再重复 push，避免重复气泡
  if (!reuseUserMsg) {
    // v495b：带上 created_at —— 沟通面板每条消息都要显示时间，产物区时间也由此继承
    store.chat.messages.push({ role: 'user', content, files: files || [], vision: vision && vision.length ? vision : null, created_at: Date.now() })
  }
  // v319（L2）：把**回答时的角色**快照进消息 —— 历史署名与头像从此不再随后续切换被改写
  // v495b：带上 created_at —— 气泡与产物区时间都依赖它
  store.chat.messages.push({ role: 'assistant', content: '', tools: [],
                             roleId: roleId || '', roleMeta: roleMetaOf(roleId), created_at: Date.now() })
  const replyIndex = store.chat.messages.length - 1
  store.chat.streaming = true
  // v309：给这次请求挂上可被「停止」的中止器（按钮据此呈现停止态）
  stopRequested.value = false
  resetStopConfirm()
  const ctrl = new AbortController()
  sctrl.value = ctrl
  scrollBottom()
  // AI 自主判断的卡片意图（```cards 围栏）；null = AI 未输出意图，走弱兜底
  let cardIntent = null

  try {
    // 分级超时（P1-v413）：对账/复盘/汇总/报表等长任务放宽到 CHAT_TIMEOUT_LONG。
    // 🔴 必须用 isHeavyTurn（不是朴素正则）——它还会「短确认词继承上轮轻重」+
    // 「会话碰过表格即算长任务」，否则「要/继续」这类追问会退回 3 分钟被掐断。
    const isHeavy = isHeavyTurn({ q, content, messages: store.chat.messages })
    await hermesChat(
      // 🔴 分隔标记（isSwitch）必须排除：它只是给人看的分隔线，不是对话内容；
      //    发上去会让模型把"已切换角色"当成用户说过的话（污染上下文）。
      store.chat.messages.filter(m => m.content && !m.isSwitch).map(m => ({ role: m.role, content: m.vision || m.content })),
      {
        system: sys,
        // v319（L2）：把角色 id 交给后端 —— 能力边界（技能包 / 数据范围 / 权限档）
        // 由服务端按角色裁决，前端不再拥有"我说我是谁"的权力。
        roleId,
        timeout: isHeavy ? CHAT_TIMEOUT_LONG : CHAT_TIMEOUT_NORMAL,
        // v309：把中止信号传到 fetch —— 不加这一行，「停止」按钮就只是个换了图标的摆设。
        // 中止后浏览器掐断连接 ⇒ 后端 Starlette 关闭上游生成器 ⇒ Hermes 那次运行随之断开。
        signal: ctrl.signal,
        onTool: (step) => {
          const last = store.chat.messages[replyIndex]
          if (!last || !last.tools) return
          // 配对优先用 toolCallId（Hermes 的 hermes.tool.progress 事件自带 id）；
          // 旧的 Responses 风格事件没有 id，回退按工具名配「正在跑的那条」。
          const running = () => step.id
            ? last.tools.find(x => x.id === step.id)
            : last.tools.find(x => x.name === step.name && x.status === 'running')
          if (step.phase === 'start') {
            if (step.id && last.tools.some(x => x.id === step.id)) return   // 同 id 重复 running 不重复加
            last.tools.push({
              id: step.id || '',
              name: step.name,
              emoji: step.emoji || '',
              label: step.label || '',
              args: step.args || '',
              status: 'running',
              t0: Date.now(),
            })
            scrollBottom()
          } else if (step.phase === 'done') {
            const t = running()
            if (t) { t.status = 'done'; t.ms = t.t0 ? (Date.now() - t.t0) : 0 }
            scrollBottom()
          } else if (step.phase === 'result') {
            const t = running()
            if (t) { t.status = 'done'; t.result = step.result; t.ms = t.t0 ? (Date.now() - t.t0) : 0 }
          }
        },
        // 推理流：模型吐答案前的思考（DeepSeek `reasoning_content`）。
        // 累加到 m.reasoning，由模板渲染成可折叠的「深度思考」块（对齐 WorkBuddy）。
        onReasoning: (r) => {
          const last = store.chat.messages[replyIndex]
          if (!last) return
          last.reasoning = (last.reasoning || '') + r
          scrollBottom()
        },
        onDelta: (d, full) => {
          const last = store.chat.messages[replyIndex]
          if (!last) return
          if (!cardIntent) cardIntent = extractCardIntent(full)
          // 各协议围栏先抽取成结构化数据（澄清 / 提案 / 提醒 / 经营卡），
          // 正文统一在最后一步剥掉全部围栏——不再有「抽到卡片后就不剥 card 围栏」的分支。
          const cl = extractClarify(full)
          // v486 P1-⑥：多组（questions）也算「有内容」，否则新协议会被静默丢弃
          if (cl && ((cl.questions && cl.questions.length) || (cl.options && cl.options.length))) last.clarify = cl
          const prop = extractProposal(full)
          if (prop && !last.proposal) last.proposal = prop
          const rem = extractReminder(full)
          if (rem && !last.reminder) last.reminder = rem
          if (!last.card) {
            const ex = extractCard(full)
            if (ex) last.card = ex.card
          }
          // 正文 = 原文剥掉所有协议围栏（含流式半截未闭合的），老板永远看不到控制标记
          last.content = stripAllFences(full)
          scrollBottom()
        }
      }
    )
  } catch (e) {
    const stopped = stopRequested.value || (e && e.stopped === true)
    stopRequested.value = false
    sctrl.value = null
    const last = store.chat.messages[replyIndex]

    /* 🔴 v309（2026-09-28）**用户主动停止 ≠ 出错**，两条路必须分开走：
       WorkBuddy 的取向（实测其 message-timeline）：中断后**保留**已生成内容，
       仅在其后附一个「任务被中断」标记（i18n `message.interrupted`），不弹错误、
       不删气泡。我们照此办理，并把标记落盘（`m.stopped`）。
       原先这里只有「失败」一种处理 ⇒ 停一下会看到红字「回答生成超时」+ 半截气泡被删，
       既误导（不是超时）又白等（生成的内容没了）。 */
    if (stopped) {
      if (last) last.stopped = true
      saveCurrentSession()      // 停在哪留哪：用户提问 + 已生成部分 + 「已停止」标记一起落盘
      store.chat.error = ''     // 不是错误，不给红字
      store.chat.streaming = false
      flushPending()            // v522：停止后若有排队输入立即补发
      return
    }

    // 中断/失败（含关盖休眠、网络断开、超时）：先把当前对话落盘——用户提问 + 已生成的部分回复，
    // 否则这场对话只活在内存里，换设备/重开页面就丢了（2026-09-23：用户公司电脑关盖时 AI 正在流式
    // 回复，整段对话未落盘，回家后在另一台电脑看不到）。
    saveCurrentSession()
    // 再移除内存里的半截气泡，避免本机重新打开时把截断消息当完整会话显示（乱码重现）
    if (last && !last.card) store.chat.messages.splice(replyIndex, 1)

    // 区分错误类型，避免一切失败都冒泡成"离线"（修复"AI助手暂时离线"误导）
    const rawMsg = (e && e.message) || ''
    let msg
    if (e && e.name === 'AbortError') {
      // ⚠️ v309 起这条**只**代表「内部超时」（如 3 / 5 分钟没跑完）。
      //    用户点「停止」走的是上面的 `stopped` 分支，client.js 已把两者拆开
      //    （外部信号中止抛 `StoppedError`，不再冒充 AbortError）—— 别再把两者合并。
      msg = '回答生成超时，已停止。请点「重试」重新发送。'
    } else if (/\[HTTP 403\]|无权限|forbidden|权限不足/i.test(rawMsg)) {
      // 🔴 v281：原先 403 会被 client.js「自动退回直连通道」兜掉，那条退路已随安全封堵删除，
      //   403 现在会真到用户面前 ⇒ 必须给出**能行动**的话（而不是笼统的"鉴权异常"）。
      msg = '当前账号没有使用 AI 副驾的权限，请联系管理员开通。'
    } else if (/\[HTTP 401\]|未认证|鉴权|unauthorized/i.test(rawMsg)) {
      msg = '登录状态已失效，请重新登录后再试。'
    } else if (/\[HTTP (502|503|504)\]|离线|offline|暂时不可用|service unavailable|bad gateway|gateway timeout/i.test(rawMsg)) {
      msg = 'AI 服务暂时不可用，正在自动重试…如持续失败请稍后再试。'
    } else {
      msg = rawMsg || '与 AI 助手通信失败，请稍后再试'
    }
    store.chat.error = msg
    store.chat.streaming = false

    // 对"服务不可用"类错误尝试一次静默退避重试（1.5s），避免瞬时抖动直接报离线
    const willRetry = /\[HTTP (502|503|504)\]|离线|offline|暂时不可用|service unavailable|bad gateway|gateway timeout/i.test(msg) && !payload.__retried
    if (willRetry) {
      setTimeout(() => { streamReply({ ...payload, __retried: true }) }, 1500)
      return   // 重试会重新进入流式，待其结束再 flush，避免两个流并发
    }
    flushPending()   // v522：终态失败也补发排队输入（非 502/503/504 抖动，不会再重试）
    return
  }

  store.chat.streaming = false
  sctrl.value = null            // v309：正常跑完 ⇒ 撤掉中止器（按钮回到「发送」态）
  // 成功分支：仅在 AI 正常回复后才触发卡片/推送（修复原 .then 在失败时仍误触发）
  const replyMsg = store.chat.messages[replyIndex]
  const reply = (replyMsg && replyMsg.content ? replyMsg.content : '').trim()
  if (reply && currentRole.value && currentRole.value.role_id) {
    pushRoleReply(currentRole.value.role_id, reply, (currentRole.value.name || 'AI 经营副驾'))
  }
  // 是否补经营卡 = AI 自主判断（老板无需知道"卡片"）：
  //   ① AI 输出了 ```cards 意图围栏 → 完全按 AI 的 show 执行（show:[] 即纯文字一张不补）
  //   ② AI 已出单卡（```card / 裸卡，已在 onDelta 里被 extractCard 抽成 replyMsg.card）
  //      → 视为 AI 已自主判断，不再兜底
  //   ③ 以上都没有（模型漏标/旧会话）→ 单卡正则弱兜底，且尊重显式否定词
  // v156 A：判据原先只看 ```cards 复数围栏，而协议要求 AI「出单个 ```card 就别再出 ```cards」
  //   （两者只需其一）→ AI 越守协议，前端越判定"未出卡"而再补一张，老板收到两条结论相反的
  //   回复（2026-09-13 实测：LLM 说"算不出来/数据缺失"，兜底卡却报"库存健康"）。
  //   修复：只要 AI 已出过卡（任意形态），兜底一律不触发。
  const aiCarded = !!(cardIntent || (replyMsg && replyMsg.card))
  if (cardIntent) {
    if (cardIntent.show && cardIntent.show.length) fireCards(cardIntent.show, q)
  } else if (!aiCarded && !DENY_RE.test(q)) {
    triggerCards(q)
  }
  saveCurrentSession()
  flushPending()   // v522：本轮回复结束，自动补发流式期间用户排队的新消息
  reportUsage(content, reply)
}

/* P2-⑥ 用量归因：副驾每次成功回复上报字符量，落主库 ai_usage（支撑 B 端分层定价）。
   fail-closed：计量失败绝不干扰主对话。 */
function reportUsage(input, output) {
  try {
    api('/api/ai/usage', {
      method: 'POST',
      body: { model: 'hermes-agent', kind: 'chat', input_chars: (input || '').length, output_chars: (output || '').length }
    }).catch(() => {})
  } catch (_) { /* 静默 */ }
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

/* H1：拉取后台 AI 模式，服从 disabled / readonly 管控（Web 副驾此前直连 Hermes 绕过此管控） */
async function loadAiMode() {
  try {
    const r = await api('/api/ai-mode')
    if (r && r.mode) {
      aiMode.value = r.mode
      if (r.mode === 'readonly') aiGuard.value = 'advise'  // 只读模式强制只建议
    }
  } catch (_) { /* 静默降级，默认 auto */ }
}

/* 打开抽屉时聚焦输入框 */
watch(() => store.ui.copilotOpen, (v) => {
  if (v) {
    loadAiMode()
    loadTtsVoices()      // v461：提前取音色清单 ⇒ 「朗读声音」胶囊能直接显示当前声音名
    // v488：本次打开若处于「空白态」（无消息、无当前会话）且用户没主动要新对话
    //   ⇒ 自动恢复当前角色最近一次会话（带加载态）。已有对话/刚点了「＋ 新对话」则原样展示，不劫持。
    if (!store.chat.messages.length && !store.chat.currentId && !explicitNew.value) {
      restoreLatestSession()
    } else if (store.chat.messages.length) {
      // v622：已有对话直接重开 —— DOM 是新建的，**必须主动还原位置**，否则停在顶部（历史第一条）。
      //   空白态走 restoreLatestSession（它自己会滚到底）。
      nextTick(() => restoreScroll())
    }
    nextTick(() => { if (cpInput.value) cpInput.value.focus() })
  } else {
    showRoleMenu.value = false
    showVoiceMenu.value = false   // v461
    saveCurrentSession()  // 关闭时落盘
  }
})

function onKeydown(e) {
  if (e.key === 'Escape' && isFullscreen.value) { isFullscreen.value = false; return }
  if (e.key !== 'Escape') return
  /* v309：流式中的 Esc = 停止生成（**二次确认**，对齐 WorkBuddy 的 `pendingStopConfirm`：
     第一次按 → 按钮位置显示快捷键「Esc」、tooltip 变「再次按下快捷键停止」；2.5 秒内再按一次
     才真的停 —— 防误触。这是 WB 的设计，不要简化成「按一下就停」。 */
  if (!store.ui.copilotOpen || !canStop.value) return
  // 有下拉菜单开着时，Esc 的语义是「收菜单」，不能顺手把 AI 回复也停了
  if (showAddMenu.value || showRoleMenu.value || showGuardMenu.value || showVoiceMenu.value) { closeMenus(); return }
  if (!stopConfirm.value) {
    stopConfirm.value = true
    if (stopConfirmTimer) clearTimeout(stopConfirmTimer)
    stopConfirmTimer = setTimeout(() => { stopConfirm.value = false; stopConfirmTimer = null }, 2500)
    return
  }
  stopReply()
}
onMounted(() => {
  // v488：**不在此处恢复会话** —— 组件由 Shell.vue 无条件挂载，onMounted 在开机就跑，
  //   那时抽屉未打开、加载遮罩（.cp-body）未渲染 ⇒ 恢复会「隐身」完成，遮罩永远看不见。
  //   改为在 copilotOpen 打开分支按需恢复（见上方 watch）。
  loadAiMode()
  loadTtsVoices()          // v461
  onWinResize()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWinResize)
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWinResize)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  resetStopConfirm()   // v309：别把确认态的定时器留在身后
  stopRead()           // v456：副驾关闭/卸载时别把朗读留在后台继续念
  // v492：卸载时回收**产出文件**预览 blob URL，避免内存泄漏（用户附件预览已随其退出产物区一并移除）
  Object.values(producedPreview).forEach(u => { try { URL.revokeObjectURL(u) } catch (e) {} })   // v489：产出文件预览同样回收
})

// v456：消息增删（发新消息 / 重新生成会 splice）⇒ 正在朗读的那条可能已不存在，先停掉再滚动
watch(() => store.chat.messages.length, () => { stopRead(); scrollBottom() })
</script>

<style scoped>
.copilot{
  /* v492：880 → 1120。原宽在「产物栏打开」时把聊天区压到约 489px，
     输入框工具条（左＝＋/团队/权限/朗读声音，右＝语音/截图/发送）被迫换行 ——
     语音·截图·发送掉到第二行。加宽后聊天区约 690px，工具条保持单行。
     全屏态（.fullscreen width:100vw）与窄屏媒体查询（max-width:760px → 100vw）均不受影响。 */
  position:fixed;top:0;right:0;bottom:0;width:min(1120px,94vw);
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
/* v486 P1-⑤：产物 / 待办 双分页 */
.cp-art-tabs{display:inline-flex;gap:2px;padding:2px;background:var(--bg2);border-radius:8px}
.cp-art-tab{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:none;background:transparent;border-radius:6px;font:inherit;font-size:12.5px;color:var(--t2);cursor:pointer;transition:all .15s}
.cp-art-tab:hover{color:var(--t1)}
.cp-art-tab.on{background:var(--bg);color:var(--t1);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.cp-todo{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg2)}
.cp-todo-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.cp-todo-title{font-size:12.5px;color:var(--t1);line-height:1.45;word-break:break-all}
.cp-todo-time{font-size:11px;color:var(--t3)}
.cp-todo-ops{display:flex;gap:2px;flex:none}
.cp-art-title{font-size:13px;font-weight:600;color:var(--t1);display:inline-flex;align-items:center;gap:8px}
.cp-art-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 7px;border-radius:10px;background:var(--p-bg);color:var(--p-dark);font-size:11px;font-weight:600}
.cp-art-ops{display:flex;align-items:center;gap:4px}
.cp-art-ops .cp-icon-btn{width:28px;height:28px;padding:0}
.cp-art-ops .cp-icon-btn:hover{background:rgba(127,127,127,.16);color:var(--t1)}
.cp-art-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.cp-art-item{cursor:pointer;transition:transform .12s ease}
.cp-art-item:hover{transform:translateY(-1px)}
.cp-art-item .rc{border-color:var(--bd)}
/* P1-④ 产物栏文件卡片 */
.cp-art-file{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--bd);border-radius:var(--radius-md);background:var(--bg2);text-decoration:none;transition:border-color .15s}
.cp-art-file:hover{border-color:var(--p-dark)}
.cp-art-file-ic{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--p-bg);color:var(--p-dark);flex-shrink:0}
.cp-art-file-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.cp-art-file-name{font-size:13px;color:var(--t1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-art-file-meta{font-size:11px;color:var(--t3)}
.cp-art-file-dl{color:var(--t3);flex-shrink:0}
/* v301：气泡内的「副驾产出文件」卡 —— 复用产物栏外观，仅调底色与间距
   （气泡底就是 --bg2，卡片再铺 --bg2 会没有对比；--bg 在两套主题下都有对比） */
.msg-file{margin-top:8px;background:var(--bg)}
.msg-file .cp-art-file-name{white-space:normal}
/* v483 P0-①：生成物实时预览样式（跟随浅/深主题） */
.cp-art-prev{display:flex;flex-direction:column;gap:8px}
.cp-art-img{max-width:100%;max-height:240px;border-radius:8px;cursor:zoom-in;border:1px solid var(--bd);background:var(--bg3)}
.cp-art-video{width:100%;max-height:320px;border-radius:8px;background:#000;border:1px solid var(--bd)}
.cp-art-frame{width:100%;height:320px;border:1px solid var(--bd);border-radius:8px;background:#fff}
.cp-art-dl-row{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;color:var(--p);font-size:12px;text-decoration:none;cursor:pointer}
.cp-art-dl-row:hover{text-decoration:underline}
/* v483 P0-④：多步计划步骤列表 */
.cp-plan-steps{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.cp-plan-step{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--t1);line-height:1.5}
.cp-step-dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex-shrink:0;background:var(--t3);border:1px solid var(--bd)}
.cp-plan-step.running .cp-step-dot{background:var(--p);animation:cpStepPulse 1s infinite}
.cp-plan-step.done .cp-step-dot{background:#1a9e57}
.cp-plan-step.fail .cp-step-dot{background:#e0483a}
.cp-plan-step.running .cp-step-tx{color:var(--p)}
.cp-plan-step.fail .cp-step-tx{color:#e0483a}
@keyframes cpStepPulse{0%{opacity:.4}50%{opacity:1}100%{opacity:.4}}
/* v483：预览灯箱 */
.cp-lightbox{position:fixed;inset:0;z-index:985;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:40px;cursor:zoom-out}
.cp-lightbox img{max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
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

/* ===== P1-3 经营一页纸 ===== */
.cp-pager{flex:1;overflow:auto;padding:16px;background:var(--bg1)}
.cp-pager-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.cp-pager-hd b{font-size:15px;color:var(--t1)}
.cp-pager-sub{font-size:12px;color:var(--t3)}
.cp-pager-back{margin-left:auto;border:1px solid var(--bd1);background:var(--bg2);color:var(--t2);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}
.cp-pager-back:hover{background:var(--bg3)}
.cp-pager-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.cp-pg-card{background:var(--bg2);border:1px solid var(--bd1);border-radius:12px;padding:14px;cursor:pointer;transition:transform .12s,border-color .12s;display:flex;flex-direction:column;gap:6px}
.cp-pg-card:hover{transform:translateY(-2px);border-color:var(--p)}
.cp-pg-ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center}
.cp-pg-t{font-size:13px;color:var(--t2);font-weight:600}
.cp-pg-v{font-size:24px;font-weight:700;color:var(--t1);line-height:1.1}
.cp-pg-s{font-size:12px;color:var(--t3);line-height:1.4}
.cp-pager-anom{margin-top:14px;background:var(--bg2);border:1px solid var(--bd1);border-radius:12px;padding:12px 14px}
.cp-anom-hd{font-size:12px;color:var(--t3);margin-bottom:8px}
.cp-anom-list{display:flex;flex-direction:column}
.cp-anom-row{display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid var(--bd1);cursor:pointer;font-size:13px;color:var(--t2)}
.cp-anom-row:last-child{border-bottom:none}
.cp-anom-row:hover{color:var(--p)}
.cp-anom-n{font-weight:700;color:var(--t1)}
.cp-pager-loading{padding:30px;text-align:center;color:var(--t3);font-size:13px}
@media (max-width:560px){.cp-pager-grid{grid-template-columns:1fr}}
.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:940}

.cp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.cp-brand{display:flex;align-items:center;gap:10px}
/* v319b：顶栏头像容器与「消息头像」(`.msg-avatar`) 同一套视觉 —— 圆形底 + 居中 emoji/PNG，
   差别只在尺寸（32 / 26）。改这里时请一并看 `.msg-avatar` 与 `.cp-role-av`，三处必须同源。 */
.cp-ai-img{width:32px;height:32px;border-radius:50%;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;flex-shrink:0;overflow:hidden}
.cp-ai-img-png{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.cp-titles{display:flex;flex-direction:column;min-width:0}
.cp-titles b{font-size:14px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* v322b：标题里的角色名后缀。用较淡的字重/颜色 ⇒ 读作"标签"而不是"第二个标题"；
   角色名很长时由上面的 ellipsis 兜底，不会把头部撑破。 */
.cp-title-role{font-size:12px;font-weight:500;color:var(--t3)}
.cp-sub{font-size:11px;color:var(--t3);margin-top:1px}
.cp-actions{display:flex;gap:6px}
.cp-icon-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2);cursor:pointer}
.cp-icon-btn:hover:not(:disabled){background:var(--bg2);color:var(--t1)}
.cp-icon-btn:disabled{opacity:.35;cursor:default}

.cp-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;position:relative}
/* v488：进入副驾恢复最近会话时的加载遮罩，覆盖在对话流上，避免先闪空白新对话 */
.cp-restoring{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:var(--bg,#fff);color:var(--t3,#94a3b8);font-size:13px}
.cp-restoring-spin{width:22px;height:22px;border:2.5px solid var(--border-subtle,#e2e8f0);border-top-color:var(--p-dark,#3b5bdb);border-radius:50%;animation:cp-spin .7s linear infinite}

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
.cp-hist-search{margin:8px 0}
.cp-hist-q{width:100%;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg2);font-size:12.5px;color:var(--t1);outline:none}
.cp-hist-q:focus{border-color:var(--p)}
.cp-hist-hits{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.cp-hist-hit{padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);cursor:pointer;transition:all .15s}
.cp-hist-hit:hover{border-color:var(--p);background:var(--p-bg)}
.cp-hist-snippet{font-size:11.5px;color:var(--t3);margin-top:4px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cp-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}
.cp-w-ic{width:56px;height:56px;border-radius:18px;background:var(--p-bg);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.cp-w-title{font-size:15px;font-weight:500;color:var(--t1);margin:0 0 4px}
.cp-w-sub{font-size:12px;color:var(--t3);margin:0 0 16px}
.cp-w-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.cp-chip{padding:7px 12px;border:1px solid var(--bd);border-radius:16px;background:var(--bg);font-size:12px;color:var(--t2);cursor:pointer;transition:all .15s}
.cp-chip:hover{border-color:var(--p-dark);color:var(--p-dark);background:var(--p-bg)}
.cp-demo{margin-top:14px;padding:8px 18px;border:1px solid var(--p-border);border-radius:20px;background:var(--p-bg);font-size:12.5px;color:var(--p-dark);cursor:pointer;transition:all .15s}
.cp-demo:hover{background:rgba(6,182,212,.12);border-color:var(--p-dark)}

.msg{display:flex;gap:8px}
.msg.user{flex-direction:row;align-items:flex-end;justify-content:flex-end}
.msg.assistant{flex-direction:column;align-items:stretch;gap:0}
.msg.is-switch{flex-direction:row;align-items:flex-end;justify-content:flex-start}
/* v523：助手回复顶部信息区（头像居左 + 角色名紧邻右侧 + 时间）；
   角色名过长自动省略，时间不收缩，保证「谁在答 + 何时答」一眼可见。 */
.msg-head{display:flex;align-items:center;gap:8px;margin:0 0 6px;min-width:0}
.msg-role{font-size:12.5px;font-weight:600;color:var(--t2);line-height:1.3;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg-head .msg-time{margin-left:6px;padding:0;flex-shrink:0}
.msg-avatar{width:26px;height:26px;border-radius:50%;background:var(--p-bg);color:var(--p-dark);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;overflow:hidden}
.msg-av-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.msg-col{display:flex;flex-direction:column;gap:5px;max-width:82%}
.msg.user .msg-col{align-items:flex-end}
/* v523：窄屏/移动端适配 —— 顶部信息区间距收紧、正文用更宽比例，头像与角色名不变形 */
@media (max-width:760px){
  .msg-col{max-width:92%}
  .msg-head{gap:6px;margin-bottom:5px}
  .msg-role{font-size:12px}
}
/* v495b：每条消息的沟通时间（次级灰字，随气泡左/右对齐） */
.msg-time{font-size:11px;color:var(--t3,#94a3b8);line-height:1.4;padding:1px 4px;user-select:none;font-variant-numeric:tabular-nums}
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

/* 「思考中」等待动画已抽成可复用组件 components/ThinkingDots.vue（参数与此处原实现一致） */
/* 工具执行情况（对齐 WorkBuddy：标题 + 完成计数 + 执行中/已完成 耗时） */
.msg-tools .cp-tools-hd{display:flex;align-items:center;gap:6px;width:100%;padding:1px 0;background:transparent;border:none;font-size:11px;color:var(--t3);cursor:pointer;text-align:left}
.msg-tools .cp-tools-hd:hover{color:var(--t2)}
.cp-tools-hd svg{flex-shrink:0}
.cp-tools-n,.cp-tools-t{font-variant-numeric:tabular-nums;flex-shrink:0}
.cp-tools-t{margin-left:auto;color:var(--t3)}
.cp-tools-caret{transition:transform .15s}
.cp-tools-caret.open{transform:rotate(180deg)}
.cp-tools-body{display:flex;flex-direction:column;gap:4px;min-width:0;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-subtle)}
.cp-tool-st{font-size:11px;color:var(--t3);flex-shrink:0;margin-left:auto;white-space:nowrap}
/* 深度思考（推理流）—— 对齐 WorkBuddy「深度思考」：默认折叠，标题显示字数 */
.msg-think{width:100%;margin-bottom:6px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg2);overflow:hidden}
.mt-hd{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;background:transparent;border:none;font-size:12px;color:var(--t2);cursor:pointer;text-align:left}
.mt-hd:hover{color:var(--t1)}
.mt-hd svg{flex-shrink:0;color:var(--t3)}
.mt-n{font-size:11px;color:var(--t3);font-variant-numeric:tabular-nums}
.mt-caret{margin-left:auto;transition:transform .15s}
.mt-caret.open{transform:rotate(180deg)}
.mt-body{padding:8px 12px 10px;font-size:12.5px;line-height:1.65;color:var(--t2);white-space:pre-wrap;border-top:1px dashed var(--border-subtle);max-height:280px;overflow:auto}

.msg-error{font-size:12px;color:var(--dan);padding:6px 2px;line-height:1.5}
.err-hint{color:var(--t3);display:block;margin-top:2px}
.cp-retry{margin-left:8px;padding:3px 12px;border:1px solid var(--dan);border-radius:8px;background:transparent;color:var(--dan);font-size:12px;cursor:pointer;vertical-align:middle}
.cp-retry:hover{background:var(--dan);color:#fff}

/* v319（L2）：常驻「将由谁回答」行 + 角色切换分隔标记 + 角色决定权限档的说明 */
.cp-who{display:flex;align-items:center;gap:6px;padding:0 2px 8px;font-size:12px;color:var(--t3);flex-wrap:wrap}
.cp-who-av{display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--p-bg);color:var(--p-dark);font-size:12px;line-height:1;flex-shrink:0;overflow:hidden}
/* v322：这里原来只打印 emoji（`.cp-who-av` 是个纯文字格）⇒ 有 3D 头像也显示 🚀 */
.cp-who-av-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.cp-who-t{color:var(--t2)}
.cp-who-tag{padding:1px 6px;border-radius:var(--radius-md);background:var(--bg2);border:1px solid var(--border-subtle);font-size:11px;color:var(--t3)}
.cp-who-tag.execute{color:var(--suc);border-color:currentColor}
.cp-who-cap{color:var(--t3);font-size:11px}
.cp-hd-note{font-weight:400;color:var(--t3);font-size:11px}
/* 切换标记：整条退化为一行居中的细字（其余子节点一律隐藏，避免渲染出空气泡） */
.msg.is-switch{justify-content:center;padding:2px 0}
.msg.is-switch > *:not(.cp-switch-line){display:none}
.cp-switch-line{flex:1;display:flex;align-items:center;gap:10px;color:var(--t3);font-size:11.5px}
.cp-switch-line::before,.cp-switch-line::after{content:'';flex:1;height:1px;background:var(--border-subtle)}
.cp-switch-line > span{white-space:nowrap}
.cp-switch-new{flex:none;padding:1px 8px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t2);font-size:11px;cursor:pointer}
.cp-switch-new:hover{color:var(--p);border-color:var(--p)}
/* v320：「接着《…》聊」—— 会话标题可能很长 ⇒ 限宽 + 省略号，绝不把分隔行撑破 */
.cp-switch-resume{flex:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t2);font-size:11px;cursor:pointer}
.cp-switch-resume:hover{color:var(--p);border-color:var(--p)}
/* v320：历史列表里「这段是谁开的」小标签（归属为空则不渲染 = 存量会话界面不变） */
.cp-hist-role{display:inline-block;padding:0 5px;margin-right:5px;border-radius:var(--radius-md);background:var(--bg2);border:1px solid var(--border-subtle);font-size:11px;color:var(--t3)}
.cp-foot{padding:12px 16px;border-top:1px solid var(--border-subtle);flex-shrink:0;background:var(--bg)}
.cp-atts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.cp-att{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:var(--p-bg);border:1px solid var(--p);border-radius:10px;font-size:12px;color:var(--p-dark);max-width:100%}
.cp-att-ic{font-size:13px}
.cp-att-name{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-att-meta{font-size:11px;color:var(--p-dark);opacity:.7}
.cp-att-x{border:none;background:none;color:var(--p-dark);cursor:pointer;font-size:12px;padding:0 2px;opacity:.6}
.cp-att-x:hover{opacity:1}
.cp-plus{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;color:var(--t2);cursor:pointer;transition:all .15s;flex-shrink:0}
.cp-plus:hover{background:var(--bg4);color:var(--t1)}
.cp-att-loading{background:var(--bg2);border-color:var(--border-subtle);color:var(--t2)}
.cp-att-spin{display:inline-flex;animation:cp-spin 1s linear infinite}
@keyframes cp-spin{to{transform:rotate(360deg)}}
.cp-composer{position:relative;display:flex;flex-direction:column;gap:8px;padding-top:8px;border:1px solid var(--bd);border-radius:24px;background:var(--bg3);transition:border-color .2s,box-shadow .2s}
.cp-composer:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 4px var(--p-bg)}
.cp-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:0 10px 10px}
.cp-tools{display:flex;align-items:center;gap:4px;flex:0 1 auto;min-width:0}
.cp-trailing{display:flex;align-items:center;gap:12px;flex:none;margin-left:auto}
.cp-role{position:relative;display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 10px;border-radius:16px;background:var(--p-bg);color:var(--p-dark);cursor:pointer;flex-shrink:1;min-width:0;transition:background .15s;max-width:220px}
.cp-role:hover{background:rgba(6,182,212,.16)}
.cp-role-av{font-size:14px;line-height:1;flex-shrink:0;display:flex;align-items:center}
.cp-role-av-img{width:18px;height:18px;border-radius:50%;object-fit:cover;display:block}
.cp-role-name{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-role-caret{flex-shrink:0;opacity:.7}
/* AI 权限下拉（对齐 WorkBuddy permission chip）：容器定位 + 不可选项的视觉 */
.cp-guard{position:relative;display:inline-flex;flex-shrink:0}
.cp-guard-caret{flex-shrink:0;opacity:.7}
.cp-guard-menu{width:240px}
.cp-role-item.locked{opacity:.5;cursor:not-allowed}
.cp-role-item.locked:hover{background:transparent}
/* 「＋」菜单（P3/R10）：容器定位 + 菜单宽度 */
.cp-add{position:relative;display:inline-flex;flex-shrink:0}
.cp-add-menu{width:266px}
/* ＋ 从 label 改为 button 后，需显式清掉浏览器默认按钮样式 */
button.cp-plus{border:none;background:transparent;padding:0}
button.cp-plus:hover{background:var(--bg2);color:var(--t1)}
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
.cp-input{display:block;width:100%;border:none;background:none;outline:none;resize:none;font-size:15px;line-height:22px;min-height:48px;max-height:240px;padding:13px 12px 9px 16px;color:var(--t1);font-family:inherit;overflow-y:auto}
.cp-input::placeholder{color:var(--t3)}
/* M1 斜杠命令浮层：锚在 composer 上方，不打断输入 */
.cp-slash{position:absolute;left:0;right:0;bottom:calc(100% + 8px);background:var(--bg);border:1px solid var(--border-subtle);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.20);max-height:44vh;overflow-y:auto;padding:6px;z-index:30}
.cp-slash-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:600;color:var(--t3);padding:8px 10px 6px;letter-spacing:.4px}
.cp-slash-kbd{font-weight:400;color:var(--t3)}
.cp-slash-kbd kbd{font-size:10px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 4px;margin:0 1px}
.cp-slash-group{font-size:10px;font-weight:600;color:var(--t3);padding:8px 10px 3px;letter-spacing:.5px}
.cp-slash-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;background:none;border-radius:8px;padding:8px 10px;font-size:13px;color:var(--t1);cursor:pointer}
.cp-slash-item.active{background:var(--p-bg)}
.cp-slash-ic{color:var(--t2);display:flex;flex-shrink:0}
.cp-slash-item.active .cp-slash-ic{color:var(--p-dark)}
.cp-slash-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--p-dark);flex-shrink:0;min-width:62px}
.cp-slash-title{flex:1;color:var(--t1)}
.cp-slash-hint{font-size:11px;color:var(--t3);flex-shrink:0}
.cp-send{width:32px;height:32px;border:none;border-radius:999px;background:var(--p-dark);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s,color .15s,box-shadow .15s;box-shadow:var(--shadow-sm)}
.cp-send:not(:disabled):hover{background:var(--p-deep)}
.cp-send:disabled{background:transparent;color:var(--t3);box-shadow:inset 0 0 0 1px var(--bd);cursor:default}
/* v309：停止态 —— **与发送态同色**（对齐 WorkBuddy：--cr-send-button-fill-stop 与
   --cr-send-button-fill 是同值 rgba(0,0,0,.9)/rgba(255,255,255,.92)），只把箭头换成方块。
   刻意不用红色：一是 WB 也没有，二是「红=危险/报错」会把「正常中断」渲染成事故。 */
.cp-send.is-stop{background:var(--p-dark);color:#fff;box-shadow:var(--shadow-sm);cursor:pointer}
.cp-send.is-stop:not(:disabled):active{transform:scale(.93)}
/* 流式中但没有可停的请求（极短窗口）——按 WB 的 `--sending`：只能等，不能点 */
.cp-send.is-busy{background:transparent;color:var(--t3);box-shadow:inset 0 0 0 1px var(--bd);cursor:default}
/* 停止二次确认时显示的快捷键标签（对齐 WB `.cr-send-button__stop-confirm-label`：11px/600） */
.cp-send-esc{font-size:11px;font-weight:600;line-height:1;letter-spacing:.02em}
/* 已停止标记（对齐 WB 的 message.interrupted「任务被中断」）：中性、不喧哗 */
.cp-stopped{display:flex;align-items:center;gap:5px;margin-top:8px;font-size:12px;color:var(--t3)}
/* 字数内联：绝对定位在文本区**第一行**右侧，不占布局高度（composer 高度不变）。
   🔴 top 的算法：绝对定位相对 **padding box** ⇒ 文本区顶 = 8px(padding-top)，
      其第一行文字再 +13px(textarea padding-top) ⇒ **21px** 才是第一行基线区。
      别写 13px（那是 textarea 的**内部**坐标，会整体偏高 8px）。
   🔵 不需要窄屏隐藏：字数**只在有内容时**出现，而有内容时占位文字不渲染 ⇒ 天然不会重叠。 */
.cp-inhint{position:absolute;top:21px;right:15px;font-size:11px;line-height:22px;color:var(--t3);pointer-events:none;white-space:nowrap;font-variant-numeric:tabular-nums}
.cp-mode-banner{font-size:12px;padding:6px 10px;border-radius:8px;margin-top:7px;text-align:center;line-height:1.4}
.cp-mode-banner.disabled{background:var(--danger-bg);color:var(--danger-txt)}
.cp-mode-banner.readonly{background:var(--warn-amber-bg);color:var(--warn-amber)}
/* v408：AI 生成内容免责提示 —— 输入框正下方，整行居中、低对比灰字，不抢视线。
   用 --t3（次要文字色）而非警示红：这是常驻免责声明，不是报错/危险。 */
.cp-ai-note{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2px;font-size:11.5px;line-height:1.4;color:var(--t3,#94a3b8);user-select:none}
.cp-queue-hint{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px;font-size:11.5px;line-height:1.4;color:var(--brand,#2563eb);user-select:none;animation:cp-queue-pulse 1.4s ease-in-out infinite}
@keyframes cp-queue-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.cp-ai-note svg{flex-shrink:0;opacity:.85}

/* P0-③ AI 权限护栏开关 */
.cp-guard-btn{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 11px;border:1px solid transparent;border-radius:16px;background:transparent;font-size:12px;color:var(--t2);cursor:pointer;flex-shrink:0;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.cp-guard-btn svg{color:var(--suc);flex-shrink:0}
.cp-guard-btn:hover{background:var(--bg4);color:var(--t1)}
.cp-guard-btn.on{border-color:rgba(var(--war-rgb),.5);background:rgba(var(--war-rgb),.14);color:var(--war)}
.cp-guard-btn.on svg{color:var(--war)}
/* ---- v461：朗读声音选择（胶囊几何照抄上面 .cp-guard-btn，配色走主色以示"偏好类设置"）---- */
.cp-ttsv{position:relative;display:inline-flex;flex-shrink:0;min-width:0}
.cp-ttsv-btn{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 11px;border:1px solid transparent;border-radius:16px;background:transparent;font-size:12px;color:var(--t2);cursor:pointer;flex-shrink:0;white-space:nowrap;transition:background .15s,color .15s,border-color .15s;max-width:150px;min-width:0}
.cp-ttsv-btn svg.ico{color:var(--p);flex-shrink:0;width:12px;height:12px}
.cp-ttsv-btn:hover{background:var(--bg4);color:var(--t1)}
.cp-ttsv-btn.on{border-color:var(--p);background:var(--p-bg);color:var(--p-dark)}
.cp-ttsv-tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-ttsv-menu{width:250px}
.cp-ttsv-err{padding:6px 8px;font-size:11px;color:var(--war)}
/* 🔴 v281（2026-09-26）：`.cp-proxy-btn` 四条样式已随「副驾代理层用户开关」一并撤除
   （对应模板与 proxyOn/toggleProxy 已删；工具条左组由 4 控件回到 3：＋ / 只给建议 / 团队）。 */

/* M2 渐进式访谈引导 chips */
.cp-followups{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.cp-fubtn{padding:6px 11px;border:1px solid var(--p);border-radius:14px;background:var(--p-bg);font-size:11.5px;color:var(--p-dark);cursor:pointer;transition:all .15s}
.cp-fubtn:hover{background:rgba(6,182,212,.16);border-color:var(--p-dark)}

/* P0-① 主动澄清：AI 反问 + 结构化选项 */
.cp-clarify{margin-top:8px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.cp-clarify-ask{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);margin-bottom:8px}
/* v486 P1-⑥ 批量结构化决策：多组选项，每组自带序号，组间留分隔线 */
.cp-clarify-qhd{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px}
.cp-clarify-grp{padding:8px 0;border-top:1px dashed var(--border-subtle)}
.cp-clarify-grp:first-of-type{border-top:none;padding-top:0}
.cp-clarify-no{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--p);color:#fff;font-size:10px;font-weight:700;line-height:1}
.cp-clarify-ask svg{color:var(--p-dark);flex-shrink:0}
.cp-clarify-opts{display:flex;flex-direction:column;gap:6px}
.cp-clarify-opt{padding:7px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg);font-size:12.5px;color:var(--t1);cursor:pointer;text-align:left;transition:all .15s}
.cp-clarify-opt:hover{border-color:var(--p-dark);background:var(--p-bg)}

/* P2-⑦ 配方自进化提案卡片 */
.cp-proposal{margin-top:8px;padding:11px 12px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);border-left:3px solid var(--p)}
.cp-proposal.accepted{border-left-color:var(--suc)}
.cp-proposal.rejected{border-left-color:var(--t3);opacity:.8}
.cp-prop-hd{display:flex;align-items:center;gap:7px;margin-bottom:7px}
.cp-prop-ic{color:var(--p-dark);flex-shrink:0}
.cp-prop-title{font-size:12.5px;font-weight:600;color:var(--t1)}
.cp-prop-module{font-size:10.5px;color:var(--p-dark);background:var(--p-bg);border:1px solid var(--p);border-radius:8px;padding:1px 7px;flex-shrink:0}
.cp-prop-changes{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}
.cp-prop-change{font-size:11px;color:var(--t2);background:var(--bg);border:1px solid var(--border-subtle);border-radius:8px;padding:2px 8px}
.cp-prop-rationale{font-size:11.5px;color:var(--t3);line-height:1.55;margin-bottom:9px}
.cp-prop-ops{display:flex;gap:8px;justify-content:flex-end}
.cp-prop-btn{font-size:12px;padding:6px 14px;border-radius:9px;cursor:pointer;transition:all .15s;border:1px solid transparent}
.cp-prop-btn:disabled{opacity:.5;cursor:default}
.cp-prop-btn.ghost{background:var(--bg);border-color:var(--border-subtle);color:var(--t2)}
.cp-prop-btn.ghost:hover:not(:disabled){border-color:var(--t3);color:var(--t1)}
.cp-prop-btn.primary{background:var(--p-dark);color:#fff;box-shadow:var(--shadow-sm)}
.cp-prop-btn.primary:hover:not(:disabled){background:var(--p-deep)}
.cp-prop-done{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--suc)}
.cp-prop-done svg{flex-shrink:0}
.cp-prop-done.rej{color:var(--t3)}

/* P0-② AI 待办提醒卡片 */
.cp-reminder{margin-top:8px;padding:11px 12px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);border-left:3px solid var(--p)}
.cp-reminder.cancelled{opacity:.65}
.cp-rem-hd{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--t1)}
.cp-rem-ic{color:var(--p-dark);flex-shrink:0}
.cp-rem-title{font-weight:600}
.cp-rem-time{margin-left:auto;font-size:11px;color:var(--t3);flex-shrink:0}

/* P0-① 反馈纠错（对/错） */
.cp-feedback{display:flex;align-items:center;gap:4px;margin-top:6px}
.cp-fb-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid var(--border-subtle);border-radius:8px;background:transparent;color:var(--t3);cursor:pointer;transition:all .15s}
.cp-fb-btn:hover{border-color:var(--p-dark);color:var(--p-dark);background:var(--p-bg)}
.cp-fb-done{font-size:11px;color:var(--t3)}

/* M3 任务进度容器 */

/* H2 AI 工具调用过程可视化 */
/* 工具执行情况容器：回复中展开、结束后收起成一行摘要（对齐 WorkBuddy） */
/* v623：工具行**必须能收缩**，否则长文本会把整行顶出卡片。
   真机复现（1440 视口 / 内容区 857px）：一条 120 字符无空格串（真实形态＝MCP 工具名
   `mcp__hermes_spreadsheet__...`、长文件路径、URL）实测行 scrollWidth 1052 > clientWidth 857，
   **溢出 195px 且没有任何滚动条** —— 文字直接压过卡片右边界、贴到抽屉边上，整页被撑出横向滚动。
   机理：`.cp-tool` 是 flex 行，`.cp-tool-name` 没写 min-width ⇒ 默认 `min-width:auto`
   （＝内容最小宽度）。对无空格串，最小宽度就是整个串宽 ⇒ 不可压缩，flex 只能溢出。
   定式（今后同类「行内一段可能超长的文本」都按这个写）：
     · 文本项 `flex:1 1 auto; min-width:0` —— min-width:0 是让它真的能被压缩的那把钥匙；
     · 再加 `overflow-wrap:anywhere` 允许在任意字符处断行（比 ellipsis 好：信息完整可见，
       工具进度本来就是短列表，多一行不影响；截断反而看不出跑的是哪个表/哪个文件）。
   对齐方式同时由 center 改 flex-start：折成两行时图标与状态标签要贴首行，不能吊在中间。 */
.msg-tools{display:flex;flex-direction:column;min-width:0;max-width:100%;margin-top:8px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);transition:padding .15s}
.msg-tools.folded{padding:5px 10px}
.msg-tools.live{border-color:var(--p-border)}
.cp-tool{display:flex;align-items:flex-start;gap:7px;min-width:0;font-size:12px;color:var(--t2);line-height:1.5}
.cp-tool-ic{display:flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:1px;color:var(--p-dark);flex-shrink:0}
.cp-tool.running .cp-tool-ic{color:var(--war)}
.cp-tool.done .cp-tool-ic{color:var(--suc)}
.cp-tool-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;word-break:break-word;font-weight:600;color:var(--t1)}
.cp-tool-args{color:var(--t3);font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.cp-spin{animation:cp-spin 0.9s linear infinite}
@keyframes cp-spin{to{transform:rotate(360deg)}}

/* M5 语音输入按钮 */
.cp-voice{width:32px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--t2);cursor:pointer;transition:all .15s;flex-shrink:0;border:none;background:none}
.cp-voice:hover{background:var(--bg4);color:var(--t1)}
.cp-voice.on{background:var(--p-dark);color:#fff;animation:cp-voice-pulse 1.2s infinite}
@keyframes cp-voice-pulse{0%,100%{box-shadow:0 0 0 0 rgba(6,182,212,.4)}50%{box-shadow:0 0 0 5px rgba(6,182,212,0)}}
/* M7 截图（剪刀）按钮：与 .cp-voice 同款几何（32px 圆形、currentColor 线性图标），对齐 UI 规范 */
.cp-snap{width:32px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--t2);cursor:pointer;transition:all .15s;flex-shrink:0;border:none;background:none}
.cp-snap:hover{background:var(--bg4);color:var(--t1)}
.cp-snap.busy{opacity:.6;cursor:progress}
.cp-snap svg{width:14px;height:14px}

/* v465 截图区域框选遮罩（微信式拖拽框选） */
.cp-snap-mask{position:fixed;inset:0;z-index:980;background:rgba(0,0,0,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;user-select:none;outline:none}
.cp-snap-stage{position:relative;box-shadow:0 8px 30px rgba(0,0,0,.45);cursor:crosshair;overflow:hidden;background:#222}
.cp-snap-img{display:block;pointer-events:none;-webkit-user-drag:none;user-select:none}
.cp-snap-sel{position:absolute;left:0;top:0;width:0;height:0;border:1.5px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.5);box-sizing:border-box;pointer-events:none}
.cp-snap-hint{color:#fff;font-size:12px;background:rgba(0,0,0,.45);padding:4px 10px;border-radius:6px;pointer-events:none}
.cp-snap-bar{display:flex;gap:10px}
.cp-snap-btn{height:34px;padding:0 18px;border-radius:8px;border:none;background:var(--p);color:#fff;font-size:13px;cursor:pointer;font-family:inherit}
.cp-snap-btn.ghost{background:rgba(255,255,255,.18)}
.cp-snap-btn:hover{filter:brightness(1.08)}

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
/* v408：回复排版对标 WorkBuddy `prose` —— 强化标题层级与纵向节奏，便于经销商一眼扫清结构。
   🔴 此前 h1/h2/h3 仅 1.05/1/0.94em，几乎与正文同高 ⇒ 长回复「平铺一片、没有骨架」。
   现在拉到 1.45/1.22/1.06em 并加大段间距，层级一眼可辨（仍受气泡宽度约束，不溢出）。 */
.md{line-height:1.7;font-size:14.5px;color:var(--t1);overflow-wrap:anywhere}
.md p{margin:0 0 8px}
.md p:last-child{margin-bottom:0}
.md h1,.md h2,.md h3{margin:12px 0 6px;font-weight:700;line-height:1.3;color:var(--t1)}
.md-h1{font-size:1.45em}
.md-h2{font-size:1.22em}
.md-h3{font-size:1.06em}
.md ul,.md ol{margin:6px 0;padding-left:22px}
.md li{margin:3px 0}
/* 表格：长编码/单号/金额在窄气泡里易溢出 ⇒ 单元格允许换行（不撑破布局） */
.md table{border-collapse:collapse;margin:8px 0;font-size:.9em;width:100%;table-layout:fixed}
.md th,.md td{border:1px solid var(--b2,#e5e7eb);padding:5px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
.md th{background:var(--bg2,#f3f4f6);font-weight:600}
.md blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid var(--p,#06b6d4);background:rgba(6,182,212,.06);color:var(--t2,#475569);border-radius:0 6px 6px 0}
.md hr{border:none;border-top:1px solid var(--b2,#e5e7eb);margin:8px 0}
.md code{background:var(--bg2,#f3f4f6);padding:1px 4px;border-radius:4px;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.md pre{background:var(--bg2,#f3f4f6);padding:8px;border-radius:6px;overflow-x:auto;margin:6px 0}
.md pre code{background:none;padding:0}
/* —— P1-a 代码块：语言标签 + 行号（对标 WorkBuddy 代码块范式） —— */
.md-codeblock{margin:6px 0;border:1px solid var(--b2,#e5e7eb);border-radius:8px;overflow:hidden;background:var(--bg2,#f3f4f6)}
.md-codeblock__bar{display:flex;align-items:center;padding:4px 10px;background:var(--bg3,#e9eef3);border-bottom:1px solid var(--b2,#e5e7eb)}
.md-codeblock__lang{font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--t3,#94a3b8);text-transform:uppercase}
/* v486 P1-② 代码块一键复制：靠右、低对比，hover 才提亮，不抢代码正文视线 */
.md-code-copy{margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font:inherit;font-size:11px;line-height:1.6;color:var(--t3,#94a3b8);background:transparent;border:1px solid var(--b2,#e5e7eb);border-radius:6px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.md-code-copy:hover{color:var(--p,#06b6d4);border-color:var(--p,#06b6d4);background:var(--bg2,#f3f4f6)}
.md-code-copy.copied{color:#16a34a;border-color:#16a34a}
.md-codeblock .md-pre{margin:0;border-radius:0;background:transparent;padding:8px 0}
.md-ln{display:block;white-space:pre}
.md-ln-no{display:inline-block;width:2.2em;margin-right:10px;text-align:right;color:var(--t3,#94a3b8);user-select:none;-webkit-user-select:none}
.md-ln-tx{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
/* —— P1-b 长回复目录（TOC），可折叠，点击跳转 —— */
.md-toc{margin:8px 0;padding:8px 12px;border:1px solid var(--b2,#e5e7eb);border-radius:8px;background:var(--bg3,#eef2f6)}
.md-toc__title{font-size:12px;font-weight:700;color:var(--t2,#475569);cursor:pointer;user-select:none}
.md-toc-list{margin:6px 0 0;padding-left:0;list-style:none}
.md-toc-li{margin:2px 0;line-height:1.5}
.md-toc-li.lv3{padding-left:14px}
.md-toc-link{color:var(--p,#06b6d4);cursor:pointer;font-size:13px}
.md-toc-link:hover{text-decoration:underline}
/* —— P2-a / P3-a 引用块：区分 AI 结论 / 引用资料 / 关键结论卡片 —— */
.md blockquote.md-quote--ai{border-left-color:var(--p,#06b6d4);background:rgba(6,182,212,.06)}
.md blockquote.md-quote--src{border-left-color:var(--t3,#94a3b8);background:rgba(148,163,184,.08);color:var(--t2,#64748b)}
.md blockquote.md-quote--key{border-left-color:#f59e0b;background:rgba(245,158,11,.10);color:var(--t1)}
.md blockquote.md-quote--key .md-quote__tag{display:inline-block;margin-bottom:2px;padding:0 6px;border-radius:4px;background:#f59e0b;color:#fff;font-size:11px;font-weight:700;line-height:1.7}
/* —— P2-b 表格：横向滚动容器 + 表头吸顶 —— */
.md-table-wrap{margin:8px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.md th{position:sticky;top:0;z-index:1}
/* —— v487 P2-③ 表格→图表开关（:deep 因 v-html 注入的 DOM 无 scoped 属性） —— */
.md :deep(.md-table-bar){display:flex;justify-content:flex-end;margin:2px 0 4px}
.md :deep(.md-table-chart-toggle){font:inherit;font-size:11px;line-height:1.6;color:var(--t3,#94a3b8);background:transparent;border:1px solid var(--b2,#e5e7eb);border-radius:6px;padding:2px 8px;cursor:pointer;transition:color .15s,border-color .15s}
.md :deep(.md-table-chart-toggle:hover){color:var(--p,#06b6d4);border-color:var(--p,#06b6d4)}
.md :deep(.md-table-chart){margin:4px 0 2px}
.md :deep(.md-chart-svg){width:100%;height:96px;display:block}
.md :deep(.md-chart-legend){display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:11px;color:var(--t2,#475569)}
.md :deep(.md-chart-lg){display:inline-flex;align-items:center;gap:4px}
.md :deep(.md-chart-lg i){width:8px;height:8px;border-radius:2px;flex-shrink:0}
/* —— v487 P2-⑦ 内联交互控件（滑块/开关） —— */
.md :deep(.md-control){display:inline-flex;align-items:center;gap:8px;margin:2px 10px 2px 0;padding:4px 10px;background:var(--bg2,#f3f4f6);border:1px solid var(--b2,#e5e7eb);border-radius:8px}
.md :deep(.md-control-lbl){font-size:12px;color:var(--t2,#475569);white-space:nowrap}
.md :deep(.md-control-range){width:120px;accent-color:var(--p,#06b6d4)}
.md :deep(.md-control-val){font-size:12px;font-weight:600;color:var(--t1,#0f172a);font-variant-numeric:tabular-nums;min-width:2.5em;text-align:right}
.md :deep(.md-switch){width:38px;height:22px;border-radius:11px;border:none;background:var(--b2,#e5e7eb);position:relative;cursor:pointer;padding:0;transition:background .15s}
.md :deep(.md-switch)::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.md :deep(.md-switch.on){background:var(--p,#06b6d4)}
.md :deep(.md-switch.on)::after{left:18px}
/* —— v487 P2-⑨ 产物元数据 —— */
.cp-art-meta{font-size:11px;color:var(--t3,#94a3b8);line-height:1.5;padding:2px 4px 6px;margin-bottom:4px;border-bottom:1px dashed var(--border-subtle)}

/* —— v423：单轮对话底部操作栏（对齐 WorkBuddy message-actions） —— */
/* v451：操作栏按钮规格对齐 WorkBuddy。实测依据（WorkBuddy.app → app.asar →
   renderer/assets/lib-chat-ui-*.css，2026-10-11 逐条读出）——`_actionButton_` / `_ratingButton_` /
   `_shareButton_` 三处是**同一套规格**：24×24、border:none、radius 8px、padding 0、font-size 0、
   默认色 var(--cb-text-secondary)（浅色 #666）、hover **只换背景** var(--cb-bg-primary-hover)（#ebebeb）
   且不改字色、:focus/:focus-visible outline:none、图标 16px、按钮间距 8px。
   颜色映射到本仓 token：--cb-text-secondary → --t2；--cb-bg-primary-hover → --b2。 */
/* v524：分割线由「按钮上方」移至「按钮下方」—— 让复制/点赞等操作条归到本条消息，
   线作为消息与消息之间的分隔；保留顶部 8px 间距，底部 8px 内边距后落线。 */
.cp-msg-actions{display:flex;align-items:center;gap:8px;margin-top:8px;padding-bottom:8px;border-bottom:1px solid var(--b2,#eef1f5)}
.cp-act{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;background:transparent;border-radius:8px;color:var(--t2,#6e6e73);cursor:pointer;transition:background-color .15s}
.cp-act:hover{background:var(--b2,#ebebeb)}
.cp-act:focus,.cp-act:focus-visible{outline:none}
.cp-act:disabled{opacity:.35;cursor:not-allowed}
.cp-act.on{color:var(--p,#3b82f6)}          /* 朗读/分享激活态：主色高亮 */
.cp-act.on:hover{background:transparent}
/* 点赞/点踩：WorkBuddy 的选中态**不改颜色**，只把图标从线框换成实心（见 Icon.vue 的 FILL_ICONS），
   所以这里把上面 .cp-act.on 的主色高亮「收回」为默认字色，并保留 hover 背景。
   两条选择器各多一层类，特异性 (0,3,0)/(0,4,0) > 上面的 (0,2,0)/(0,3,0)，无需 !important。 */
.cp-act.cp-rate.on{color:var(--t2,#6e6e73)}
.cp-act.cp-rate.on:hover{background:var(--b2,#ebebeb)}
.cp-share{position:relative;display:inline-flex}
.cp-share-menu{position:absolute;bottom:36px;left:0;z-index:30;display:flex;flex-direction:column;min-width:124px;padding:4px;background:var(--bg);border:1px solid var(--bd);border-radius:10px;box-shadow:0 6px 20px rgba(15,23,42,.14)}
.cp-share-menu button{text-align:left;padding:7px 10px;border:none;background:transparent;border-radius:7px;font-size:13px;color:var(--t1);cursor:pointer}
.cp-share-menu button:hover{background:var(--bg2)}
.cp-share-backdrop{position:fixed;inset:0;z-index:20;background:transparent}

/* v424：分享→二维码弹层（微信扫一扫） */
.cp-qr{position:absolute;bottom:36px;left:0;z-index:31;display:flex;flex-direction:column;align-items:center;gap:8px;width:188px;padding:12px;background:var(--bg);border:1px solid var(--bd);border-radius:12px;box-shadow:0 8px 28px rgba(15,23,42,.18)}
.cp-qr img{width:168px;height:168px;display:block;border-radius:6px}
.cp-qr p{margin:0;font-size:12px;line-height:1.5;color:var(--t3);text-align:center}
.cp-qr-close{padding:6px 14px;border:none;border-radius:7px;background:var(--bg2);color:var(--t1);font-size:13px;cursor:pointer}
.cp-qr-close:hover{background:var(--bd)}

/* v426 P0-3：结构化纠错面板（取代浏览器原生输入弹窗）
   🔴 背景一律走 **var(--bg)**，绝不写 `background:#fff` —— 写死白底就是本项目反复发作的
      「深色模式下剩一块白板」老毛病（cp-qr 那份已经是反面教材）。
   🔴 token 全部取 variables.css 里真实存在的（--p-dark/--p-bg/--p-border/--t2/--t3/--bd），
      且选中态沿用本文件既有 `.cp-chip:hover` 的配色口径，不另造一套。 */
.cp-corr-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:960;display:flex;align-items:center;justify-content:center;padding:20px}
.cp-corr{width:min(380px,92vw);background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.cp-corr-hd{display:flex;align-items:center;justify-content:space-between}
.cp-corr-hd b{font-size:14px;font-weight:600;color:var(--t1)}
.cp-corr-sub{margin:0;font-size:12px;line-height:1.6;color:var(--t3)}
.cp-corr-chips{display:flex;flex-wrap:wrap;gap:6px}
.cp-corr-chip{padding:5px 11px;border:1px solid var(--bd);border-radius:16px;background:var(--bg);font-size:12px;color:var(--t2);cursor:pointer;transition:all .15s}
.cp-corr-chip:hover{border-color:var(--p-dark);color:var(--p-dark);background:var(--p-bg)}
.cp-corr-chip.on{border-color:var(--p-dark);color:var(--p-dark);background:var(--p-bg);font-weight:600}
.cp-corr-text{width:100%;padding:9px 11px;border:1px solid var(--bd);border-radius:8px;background:var(--bg2);color:var(--t1);font-size:13px;line-height:1.6;resize:vertical;font-family:inherit}
.cp-corr-text:focus{outline:none;border-color:var(--p-dark)}
.cp-corr-forever{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--t2);cursor:pointer;user-select:none}
.cp-corr-forever input{width:14px;height:14px;margin:0;cursor:pointer;accent-color:var(--p-dark)}
.cp-corr-hint{margin:0;font-size:12px;color:var(--danger)}
.cp-corr-ops{display:flex;justify-content:flex-end;gap:8px}
</style>
