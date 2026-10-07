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
            <span v-else-if="m.role === 'assistant'" class="msg-avatar" :title="(m.roleMeta && m.roleMeta.name) || ''">
              <!-- 🔴 用**消息自己的**角色快照，不用 currentRole：否则切角色会追溯改写历史署名。
                   v322：存量消息（v319 之前存的 / 服务端直接拉回的）**没有快照** ⇒ 此前只回落成
                   emoji，于是历史回复显示 🚀 而顶栏显示 3D 头像。现在整份回落，走同一渲染口。 -->
              <RoleAvatar :role="m.roleMeta || currentRole" img-class="msg-av-img" fallback="AI" />
            </span>
            <div class="msg-col">
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
                <div v-if="m.role === 'assistant' && m.content" class="md" v-html="renderMd(mediaView(m.content).text)"></div>
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
              <div v-if="m.clarify && m.clarify.options && m.clarify.options.length" class="cp-clarify">
                <div class="cp-clarify-ask">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  {{ m.clarify.ask }}
                </div>
                <div class="cp-clarify-opts">
                  <button v-for="(o, oi) in m.clarify.options" :key="oi" class="cp-clarify-opt" @click="askFollowup(o)">{{ o.label }}</button>
                </div>
              </div>

              <!-- 配方自进化提案（P2-⑦：AI 发现新口径 → 老板一键采纳/忽略） -->
              <div v-if="m.proposal" class="cp-proposal" :class="m.proposalStatus">
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
                  {{ m.proposalStatus === 'accepted' ? '已采纳，口径已写入配方并同步给 AI' : '已忽略此建议' }}
                </div>
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

              <!-- 反馈纠错（P0-①：对/错，错可填纠正 → 记忆自进化） -->
              <div v-if="m.role === 'assistant' && m.content && !store.chat.streaming" class="cp-feedback">
                <span v-if="m.feedback === 'good'" class="cp-fb-done">✓ 有帮助</span>
                <span v-else-if="m.feedback === 'bad'" class="cp-fb-done">已记下，下次改进</span>
                <template v-else>
                  <button class="cp-fb-btn" title="有帮助" @click="submitFeedback(m, 'good')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                  </button>
                  <button class="cp-fb-btn" title="说错了" @click="submitFeedback(m, 'bad')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
                  </button>
                </template>
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
              :key="a.file ? ('f' + a.file.file_id) : ('c' + a.index)"
              class="cp-art-item"
              @click="jumpTo(a.index)"
            >
              <ResultCard v-if="a.card" :card="a.card" :compact="true" @action="onCardAction" />
              <!-- v306：同样不能裸 href —— 该端点同样要 Authorization（匿名实测 401），
                   点击一律走 downloadAuthed() 带鉴权头取 blob。 -->
              <a v-else-if="a.file" class="cp-art-file" :href="`/api/chat-attachment/download/${a.file.file_id}`" :download="a.file.file_name" @click.stop.prevent="downloadAuthed(`/api/chat-attachment/download/${a.file.file_id}`, a.file.file_name)">
                <span class="cp-art-file-ic">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                </span>
                <span class="cp-art-file-tx">
                  <span class="cp-art-file-name">{{ a.file.file_name }}</span>
                  <span class="cp-art-file-meta">{{ a.file.rows ? a.file.rows + ' 行 · ' : '' }}点击下载</span>
                </span>
                <svg class="cp-art-file-dl" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </a>
            </div>
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
  </Teleport>
</template>

<script setup>
import Icon from './Icon.vue'
import ThinkingDots from './ThinkingDots.vue'
import RoleAvatar from './RoleAvatar.vue'   // v322：角色头像唯一渲染口
import { ref, shallowRef, nextTick, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { store, loadSessions, saveCurrentSession, newChatSession, openChatSession, deleteChatSession, loadAiRoles, setAiRole } from '../store'
import { hermesChat, api, auth, CHAT_TIMEOUT_NORMAL, CHAT_TIMEOUT_LONG } from '../api/client'
import { importApi } from '../api/modules'
import { chatAttachmentApi, aiPagerApi } from '../api/modules'
import ResultCard from './ResultCard.vue'
import { useCardTrigger, extractCard, extractCardIntent, stripAllFences, extractClarify, extractProposal, extractReminder, DENY_RE, demoCard } from '../composables/useCardTrigger'
import { useVoiceInput } from '../composables/useVoiceInput'
import { renderMd, splitMedia } from '../utils/md'
import { useRouter } from 'vue-router'   // M1：斜杠命令「跳转页面」用
// v311：`drillTo` 前置判据用（见该函数处注释）。判据唯一实现在 `constants/pages.js`。
import { canSee, pageTitle } from '../constants/pages'

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
}
function toggleRoleMenu() { const on = !showRoleMenu.value; closeMenus('role'); showRoleMenu.value = on }
// 点胶囊/菜单以外的任意空白处 → 收起菜单（抽屉内空白 + 抽屉外页面空白都算）。
// 用捕获阶段 pointerdown，避免被内层 @click.stop 或抽屉遮罩的 click 抢走。
// 2026-09-25：新增权限下拉后改为「各管各的」——两个菜单各自判断点击是否落在自己容器内。
function onDocPointerDown(e) {
  if (!showRoleMenu.value && !showGuardMenu.value && !showAddMenu.value) return
  const t = e.target
  const inside = (sel) => !!(t && t.closest && t.closest(sel))
  if (showRoleMenu.value && !inside('.cp-role')) showRoleMenu.value = false
  if (showGuardMenu.value && !inside('.cp-guard')) showGuardMenu.value = false
  if (showAddMenu.value && !inside('.cp-add')) showAddMenu.value = false
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

/* ---- P0-① 反馈纠错：对/错 → 落 memory（错可填纠正） ---- */
async function submitFeedback(m, type) {
  if (m.feedback) return
  let correction = ''
  if (type === 'bad') {
    correction = (window.prompt('哪里不对？（可选填，帮 AI 记住）', '') || '').trim()
  }
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
    m.feedback = type
    if (type === 'bad' && correction) store.toast('已记下纠正，下次改进')
    else if (type === 'good') store.toast('感谢反馈')
    else store.toast('已记录')
  } catch (e) {
    console.warn('[copilot] feedback failed:', e.message)
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
    const m = msgs[i]
    if (!m) continue
    if (m.card) list.push({ index: i, card: m.card })
    if (m.files && m.files.length) {
      for (const f of m.files) if (f && f.file_id) list.push({ index: i, file: f })
    }
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
}

async function send() {
  const q = draft.value.trim()
  if ((!q && !attachments.value.length) || store.chat.streaming) return
  if (aiMode.value === 'disabled') { store.chat.error = 'AI 已停用（后台设置）。如需使用请管理员开启。'; return }
  if (aiMode.value === 'readonly') aiGuard.value = 'advise'  // 只读模式强制只建议
  draft.value = ''
  nextTick(() => { if (cpInput.value) autoGrow(cpInput.value) })
  store.chat.error = ''

  // 拼装消息：附件解析文本 + 用户问题
  let content = q
  let tableFiles = []   // 上传的 Excel/CSV 附件（含 file_id），供 Hermes 跨文件/单文件全量表计算引用
  let files = []        // P1-④ 产物栏文件卡片：附件原文件（file_id 可下载回看）
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
  if (tableFiles.length) sysCtx = (sysCtx ? sysCtx + '\n' : '') + spreadsheetSoftHint(tableFiles)

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
async function streamReply(payload) {
  const { content, sys, roleId, q, tableFiles, files, vision } = payload
  store.chat.error = ''
  store.chat.messages.push({ role: 'user', content, files: files || [], vision: vision && vision.length ? vision : null })
  // v319（L2）：把**回答时的角色**快照进消息 —— 历史署名与头像从此不再随后续切换被改写
  store.chat.messages.push({ role: 'assistant', content: '', tools: [],
                             roleId: roleId || '', roleMeta: roleMetaOf(roleId) })
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
    // 分级超时（P1）：对账/复盘/汇总/报表等长任务放宽到 5 分钟，普通对话 3 分钟
    const isHeavy = /对账|复盘|汇总|报表|经营分析|reconcil/i.test((q || '') + ' ' + (content || ''))
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
          if (cl && cl.options && cl.options.length) last.clarify = cl
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
    if (/\[HTTP (502|503|504)\]|离线|offline|暂时不可用|service unavailable|bad gateway|gateway timeout/i.test(msg) && !payload.__retried) {
      setTimeout(() => { streamReply({ ...payload, __retried: true }) }, 1500)
    }
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
    loadSessions()
    loadAiRoles()
    loadAiMode()
    nextTick(() => { if (cpInput.value) cpInput.value.focus() })
  } else {
    showRoleMenu.value = false
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
  if (showAddMenu.value || showRoleMenu.value || showGuardMenu.value) { closeMenus(); return }
  if (!stopConfirm.value) {
    stopConfirm.value = true
    if (stopConfirmTimer) clearTimeout(stopConfirmTimer)
    stopConfirmTimer = setTimeout(() => { stopConfirm.value = false; stopConfirmTimer = null }, 2500)
    return
  }
  stopReply()
}
onMounted(() => {
  loadSessions()
  loadAiRoles()
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

/* 「思考中」等待动画已抽成可复用组件 components/ThinkingDots.vue（参数与此处原实现一致） */
/* 工具执行情况（对齐 WorkBuddy：标题 + 完成计数 + 执行中/已完成 耗时） */
.msg-tools .cp-tools-hd{display:flex;align-items:center;gap:6px;width:100%;padding:1px 0;background:transparent;border:none;font-size:11px;color:var(--t3);cursor:pointer;text-align:left}
.msg-tools .cp-tools-hd:hover{color:var(--t2)}
.cp-tools-hd svg{flex-shrink:0}
.cp-tools-n,.cp-tools-t{font-variant-numeric:tabular-nums;flex-shrink:0}
.cp-tools-t{margin-left:auto;color:var(--t3)}
.cp-tools-caret{transition:transform .15s}
.cp-tools-caret.open{transform:rotate(180deg)}
.cp-tools-body{display:flex;flex-direction:column;gap:4px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-subtle)}
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

/* P0-③ AI 权限护栏开关 */
.cp-guard-btn{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 11px;border:1px solid transparent;border-radius:16px;background:transparent;font-size:12px;color:var(--t2);cursor:pointer;flex-shrink:0;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.cp-guard-btn svg{color:var(--suc);flex-shrink:0}
.cp-guard-btn:hover{background:var(--bg4);color:var(--t1)}
.cp-guard-btn.on{border-color:rgba(var(--war-rgb),.5);background:rgba(var(--war-rgb),.14);color:var(--war)}
.cp-guard-btn.on svg{color:var(--war)}
/* 🔴 v281（2026-09-26）：`.cp-proxy-btn` 四条样式已随「副驾代理层用户开关」一并撤除
   （对应模板与 proxyOn/toggleProxy 已删；工具条左组由 4 控件回到 3：＋ / 只给建议 / 团队）。 */

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
.msg-tools{display:flex;flex-direction:column;margin-top:8px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);transition:padding .15s}
.msg-tools.folded{padding:5px 10px}
.msg-tools.live{border-color:var(--p-border)}
.cp-tool{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t2);line-height:1.5}
.cp-tool-ic{display:flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--p-dark);flex-shrink:0}
.cp-tool.running .cp-tool-ic{color:var(--war)}
.cp-tool.done .cp-tool-ic{color:var(--suc)}
.cp-tool-name{font-weight:600;color:var(--t1)}
.cp-tool-args{color:var(--t3);font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.cp-spin{animation:cp-spin 0.9s linear infinite}
@keyframes cp-spin{to{transform:rotate(360deg)}}

/* M5 语音输入按钮 */
.cp-voice{width:32px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--t2);cursor:pointer;transition:all .15s;flex-shrink:0;border:none;background:none}
.cp-voice:hover{background:var(--bg4);color:var(--t1)}
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
