<template>
  <div class="page">
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
          <div class="ev-stat"><b>{{ aiSkills.length }}</b><span>行业技能</span></div>
          <div class="ev-stat"><b>{{ evRuns.length }}</b><span>进化轮次</span></div>
          <div class="ev-stat"><b>{{ evLastAt || '—' }}</b><span>最近进化</span></div>
        </div>

        <!-- 技能库（与技能 Tab 同源：走 Hermes 代理，根治直接读 /root/.hermes 的权限坑） -->
        <div class="ev-skills" v-if="aiSkills.length">
          <div class="ev-sk-hd"><b>技能库（AI 的"行业经验"）</b><span class="page-sub">{{ aiSkills.length }} 个已启用</span></div>
          <div class="ev-sk-grid">
            <div v-for="s in aiSkills" :key="s.name" class="ev-sk" :class="{ internal: skillMeta(s).internal }">
              <span class="ev-sk-ic">{{ skillMeta(s).icon || '🧠' }}</span>
              <div>
                <div class="ev-sk-name">{{ skillMeta(s).title || s.name }}</div>
                <div class="ev-sk-sub">{{ skillMeta(s).what || s.description || '' }}</div>
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
        <!-- 对齐桌面「连接手机」：顶部提示条 -->
        <div class="cc-tip-banner" v-if="!ccTipDismissed">
          <span class="ctb-icon">📱</span>
          <span class="ctb-txt">连上飞书 / 企微 / 钉钉，AI 干完活直接推送到你手机上</span>
          <button class="ctb-close" @click="dismissCcTip">知道了</button>
        </div>
        <div class="panel-hd">
          <b>连接手机</b>
          <span class="page-sub">连上聊天软件，AI 干完活直接推送到你手机上</span>
        </div>
        <!-- 对齐桌面：三步引导 -->
        <div class="cc-guide">
          <div class="cc-guide-step"><span class="cgs-num">①</span> 选一个平台</div>
          <span class="cgs-arrow">→</span>
          <div class="cc-guide-step"><span class="cgs-num">②</span> 填渠道信息</div>
          <span class="cgs-arrow">→</span>
          <div class="cc-guide-step"><span class="cgs-num">③</span> 选个 AI 角色</div>
        </div>
        <div class="cc-grid">
          <!-- 企微 -->
          <div class="card cc-card" :class="{ linked: channelStatus.wecom.state==='connected' }" @click="openWecom">
            <div class="cc-card-top">
              <span class="cc-logo" :class="channelStatus.wecom.state==='connected' ? 'cc-logo-wecom' : ''">企</span>
              <span class="cc-state" :class="connCls('wecom')">{{ connLabel('wecom') }}</span>
            </div>
            <div class="cc-name">企业微信</div>
            <div class="cc-desc">AI 回复直达你的微信（群机器人 Webhook）</div>
            <div class="cc-roles" v-if="wecomLinkedRoles.length">
              <span v-for="r in wecomLinkedRoles" :key="r.role_id" class="cc-role-tag" :title="r.name">
                <img v-if="r.custom_avatar" :src="avatarUrl(r.role_id)" class="cc-role-av" />
                <span v-else class="cc-role-av cc-role-av-em">{{ r.avatar }}</span>
              </span>
            </div>
            <div class="cc-ops" v-if="channelStatus.wecom.state!=='disconnected'">
              <button class="cc-op" :disabled="wecomBusy" @click.stop="testChannel('wecom')">测试</button>
              <button class="cc-op" :disabled="wecomBusy" @click.stop="restartChannel('wecom')">重连</button>
            </div>
            <div class="cc-health" v-if="channelStatus.wecom.last_health_at">
              最近探活 {{ channelStatus.wecom.last_health_at }}
              <template v-if="channelStatus.wecom.fail_count"> · 失败{{ channelStatus.wecom.fail_count }}</template>
              <template v-if="channelStatus.wecom.restart_count"> · 重连{{ channelStatus.wecom.restart_count }}</template>
            </div>
            <div class="cc-action" :class="channelStatus.wecom.state==='connected' ? 'ghost' : 'primary'" @click.stop="openWecom">{{ channelStatus.wecom.state==='connected' ? '重新配置' : '去连接' }}</div>
          </div>
          <!-- 飞书 -->
          <div class="card cc-card" :class="{ linked: channelStatus.feishu.state==='connected' }" @click="openFeishu">
            <span class="cc-rec">推荐</span>
            <div class="cc-card-top">
              <span class="cc-logo" :class="channelStatus.feishu.state==='connected' ? 'cc-logo-feishu' : ''">飞</span>
              <span class="cc-state" :class="connCls('feishu')">{{ connLabel('feishu') }}</span>
            </div>
            <div class="cc-name">飞书</div>
            <div class="cc-desc">AI 回复直达飞书（群机器人 Webhook）</div>
            <div class="cc-roles" v-if="feishuLinkedRoles.length">
              <span v-for="r in feishuLinkedRoles" :key="r.role_id" class="cc-role-tag" :title="r.name">
                <img v-if="r.custom_avatar" :src="avatarUrl(r.role_id)" class="cc-role-av" />
                <span v-else class="cc-role-av cc-role-av-em">{{ r.avatar }}</span>
              </span>
            </div>
            <div class="cc-ops" v-if="channelStatus.feishu.state!=='disconnected'">
              <button class="cc-op" :disabled="feishuBusy" @click.stop="testChannel('feishu')">测试</button>
              <button class="cc-op" :disabled="feishuBusy" @click.stop="restartChannel('feishu')">重连</button>
            </div>
            <div class="cc-health" v-if="channelStatus.feishu.last_health_at">
              最近探活 {{ channelStatus.feishu.last_health_at }}
              <template v-if="channelStatus.feishu.fail_count"> · 失败{{ channelStatus.feishu.fail_count }}</template>
              <template v-if="channelStatus.feishu.restart_count"> · 重连{{ channelStatus.feishu.restart_count }}</template>
            </div>
            <div class="cc-action" :class="channelStatus.feishu.state==='connected' ? 'ghost' : 'primary'" @click.stop="openFeishu">{{ channelStatus.feishu.state==='connected' ? '重新配置' : '去连接' }}</div>
          </div>
          <!-- 钉钉 -->
          <div class="card cc-card" :class="{ linked: channelStatus.dingtalk.state==='connected' }" @click="openDingtalk">
            <div class="cc-card-top">
              <span class="cc-logo" :class="channelStatus.dingtalk.state==='connected' ? 'cc-logo-dingtalk' : ''">钉</span>
              <span class="cc-state" :class="connCls('dingtalk')">{{ connLabel('dingtalk') }}</span>
            </div>
            <div class="cc-name">钉钉</div>
            <div class="cc-desc">AI 回复直达钉钉（群机器人 Webhook，支持加签）</div>
            <div class="cc-roles" v-if="dingtalkLinkedRoles.length">
              <span v-for="r in dingtalkLinkedRoles" :key="r.role_id" class="cc-role-tag" :title="r.name">
                <img v-if="r.custom_avatar" :src="avatarUrl(r.role_id)" class="cc-role-av" />
                <span v-else class="cc-role-av cc-role-av-em">{{ r.avatar }}</span>
              </span>
            </div>
            <div class="cc-ops" v-if="channelStatus.dingtalk.state!=='disconnected'">
              <button class="cc-op" :disabled="dingtalkBusy" @click.stop="testChannel('dingtalk')">测试</button>
              <button class="cc-op" :disabled="dingtalkBusy" @click.stop="restartChannel('dingtalk')">重连</button>
            </div>
            <div class="cc-health" v-if="channelStatus.dingtalk.last_health_at">
              最近探活 {{ channelStatus.dingtalk.last_health_at }}
              <template v-if="channelStatus.dingtalk.fail_count"> · 失败{{ channelStatus.dingtalk.fail_count }}</template>
              <template v-if="channelStatus.dingtalk.restart_count"> · 重连{{ channelStatus.dingtalk.restart_count }}</template>
            </div>
            <div class="cc-action" :class="channelStatus.dingtalk.state==='connected' ? 'ghost' : 'primary'" @click.stop="openDingtalk">{{ channelStatus.dingtalk.state==='connected' ? '重新配置' : '去连接' }}</div>
          </div>
        </div>
        <!-- 对齐桌面：连接状态栏 -->
        <div class="cc-gateway">
          <span class="gw-dot" :class="gwCls"></span>
          <span class="gw-text">{{ gwText }}</span>
          <button class="gw-btn" :disabled="gwBusy" @click="recheckAll">重新检测全部</button>
        </div>
      </div>


      <div class="cc-section">
        <div class="panel-hd">
          <b>ERP 数据源</b>
          <span class="page-sub">接入你的业务系统，AI 副驾直接读真实数据</span>
        </div>
        <div class="cc-grid">
          <!-- 畅捷通 / T+ -->
          <div class="card cc-card" :class="{ linked: chanjet.linked }" @click="openChanjet">
            <div class="cc-card-top">
              <span class="cc-logo" :class="chanjet.linked ? 'cc-logo-chanjet' : ''">畅</span>
              <span class="cc-state" :class="chanjet.linked ? 'on' : ''">{{ chanjet.linked ? '已连接' : '待授权' }}</span>
            </div>
            <div class="cc-name">畅捷通 / T+</div>
            <div class="cc-desc">授权后同步商品 / 客户 / 供应商</div>
            <div class="cc-action" :class="chanjet.linked ? 'ghost' : 'primary'">{{ chanjet.linked ? '管理' : '去连接' }}</div>
          </div>
          <!-- 金蝶 / 云星空 -->
          <div class="card cc-card" :class="{ linked: kingdee.linked }" @click="openKingdee">
            <div class="cc-card-top">
              <span class="cc-logo" :class="kingdee.linked ? 'cc-logo-kingdee' : ''">金</span>
              <span class="cc-state" :class="kingdee.linked ? 'on' : ''">{{ kingdee.linked ? '已连接' : '待授权' }}</span>
            </div>
            <div class="cc-name">金蝶 / 云星空</div>
            <div class="cc-desc">授权后同步商品 / 客户 / 供应商 / 库存 / 订单</div>
            <div class="cc-action" :class="kingdee.linked ? 'ghost' : 'primary'">{{ kingdee.linked ? '管理' : '去连接' }}</div>
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

    <!-- ===== 专家 Tab（即 AI 团队）===== -->
    <template v-else-if="tab === 'expert'">
      <p class="cc-expert-intro">这里的「专家」就是你的 <b>AI 团队</b>：为副驾配置不同的 AI 角色，每个角色自带行业视角，对话时一键切换。</p>
      <RoleManage embed />
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
              <div v-for="s in generatedSkills" :key="s.name" class="card sk-card gen">
                <div class="sk-top">
                  <span class="sk-ic">✨</span>
                  <div class="sk-id">
                    <div class="sk-title">{{ s.name }}</div>
                  </div>
                </div>
                <div class="sk-what">{{ s.description || 'AI 在工作中沉淀的经验' }}</div>
              </div>
            </div>
          </div>

          <!-- 预置行业技能 -->
          <div class="sk-sec">
            <div class="sk-sec-hd">
              <b>📦 低温奶行业 AI 技能</b>
              <span class="tag info">{{ prebuiltSkills.length }} 个 · 你的护城河</span>
            </div>
            <div class="sk-grid">
              <div v-for="s in prebuiltSkills" :key="s.name" class="card sk-card" :class="{ internal: skillMeta(s).internal }">
                <div class="sk-top">
                  <span class="sk-ic">{{ skillMeta(s).icon || '🧠' }}</span>
                  <div class="sk-id">
                    <div class="sk-title">{{ skillMeta(s).title || s.name }}</div>
                    <div class="sk-name">{{ s.name }}</div>
                  </div>
                  <span v-if="skillMeta(s).internal" class="sk-badge">系统</span>
                </div>
                <div class="sk-what">{{ skillMeta(s).what || s.description || '行业规则' }}</div>
                <div v-if="skillMeta(s).when" class="sk-when">⏱ {{ skillMeta(s).when }}</div>
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
            <p class="cc-modal-tip">在企微群里「添加群机器人」复制 Webhook 地址；如需应用消息可补充企业 ID / 应用 ID。</p>
            <div class="cc-roles-pick" v-if="roles.length">
              <div class="cc-roles-pick-hd">选择 AI 角色<span class="cc-roles-pick-sub">（勾选后该角色回复推送到本渠道）</span></div>
              <div class="cc-chips">
                <button v-for="r in roles" :key="r.role_id" type="button" class="cc-chip" :class="{ on: modalRoles.has(r.role_id) }" @click="toggleModalRole(r.role_id)">
                  <img v-if="r.custom_avatar" :src="avatarUrl(r.role_id)" class="cc-chip-av" />
                  <span v-else class="cc-chip-av cc-chip-av-em">{{ r.avatar }}</span>
                  <span class="cc-chip-name">{{ r.name }}</span>
                </button>
              </div>
            </div>
            <label class="cc-field">
              <span>群机器人 Webhook 地址</span>
              <input v-model="wecom.form.webhookUrl" class="input" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx" />
            </label>
            <label class="cc-field">
              <span>企业 ID（corpId，可选）</span>
              <input v-model="wecom.form.corpId" class="input" placeholder="企业微信 corpId" />
            </label>
            <label class="cc-field">
              <span>应用 ID（agentId，可选）</span>
              <input v-model="wecom.form.agentId" class="input" placeholder="自建应用 agentId" />
            </label>
          </div>
          <div class="cc-modal-ft">
            <button class="btn btn-ghost" @click="closeWecom">取消</button>
            <button class="btn btn-primary" :disabled="!wecom.form.webhookUrl" @click="saveWecom">保存连接</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 飞书配置弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="feishu.open" class="cc-overlay" @click="closeFeishu"></div>
      </Transition>
      <Transition name="pop">
        <div v-if="feishu.open" class="cc-modal">
          <div class="cc-modal-hd">
            <b>连接飞书</b>
            <button class="cc-x" @click="closeFeishu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="cc-modal-body">
            <p class="cc-modal-tip">在飞书群里「添加群机器人」复制 Webhook 地址；如需应用消息可补充 App ID / App Secret。</p>
            <div class="cc-roles-pick" v-if="roles.length">
              <div class="cc-roles-pick-hd">选择 AI 角色<span class="cc-roles-pick-sub">（勾选后该角色回复推送到本渠道）</span></div>
              <div class="cc-chips">
                <button v-for="r in roles" :key="r.role_id" type="button" class="cc-chip" :class="{ on: modalRoles.has(r.role_id) }" @click="toggleModalRole(r.role_id)">
                  <img v-if="r.custom_avatar" :src="avatarUrl(r.role_id)" class="cc-chip-av" />
                  <span v-else class="cc-chip-av cc-chip-av-em">{{ r.avatar }}</span>
                  <span class="cc-chip-name">{{ r.name }}</span>
                </button>
              </div>
            </div>
            <label class="cc-field">
              <span>群机器人 Webhook 地址</span>
              <input v-model="feishu.form.webhookUrl" class="input" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx" />
            </label>
            <label class="cc-field">
              <span>App ID（可选）</span>
              <input v-model="feishu.form.appId" class="input" placeholder="飞书应用 App ID" />
            </label>
            <label class="cc-field">
              <span>App Secret（可选）</span>
              <input v-model="feishu.form.appSecret" class="input" placeholder="粘贴 App Secret" type="password" />
            </label>
          </div>
          <div class="cc-modal-ft">
            <button class="btn btn-ghost" @click="closeFeishu">取消</button>
            <button class="btn btn-primary" :disabled="!feishu.form.webhookUrl" @click="saveFeishu">保存连接</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 钉钉配置弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="dingtalk.open" class="cc-overlay" @click="closeDingtalk"></div>
      </Transition>
      <Transition name="pop">
        <div v-if="dingtalk.open" class="cc-modal">
          <div class="cc-modal-hd">
            <b>连接钉钉</b>
            <button class="cc-x" @click="closeDingtalk">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="cc-modal-body">
            <p class="cc-modal-tip">在钉钉群里「智能群助手 / 自定义机器人」复制 Webhook 地址；若机器人开启「加签」安全设置，请粘贴签名密钥。</p>
            <div class="cc-roles-pick" v-if="roles.length">
              <div class="cc-roles-pick-hd">选择 AI 角色<span class="cc-roles-pick-sub">（勾选后该角色回复推送到本渠道）</span></div>
              <div class="cc-chips">
                <button v-for="r in roles" :key="r.role_id" type="button" class="cc-chip" :class="{ on: modalRoles.has(r.role_id) }" @click="toggleModalRole(r.role_id)">
                  <img v-if="r.custom_avatar" :src="avatarUrl(r.role_id)" class="cc-chip-av" />
                  <span v-else class="cc-chip-av cc-chip-av-em">{{ r.avatar }}</span>
                  <span class="cc-chip-name">{{ r.name }}</span>
                </button>
              </div>
            </div>
            <label class="cc-field">
              <span>群机器人 Webhook 地址</span>
              <input v-model="dingtalk.form.webhookUrl" class="input" placeholder="https://oapi.dingtalk.com/robot/send?access_token=xxxx" />
            </label>
            <label class="cc-field">
              <span>加签密钥（secret，可选）</span>
              <input v-model="dingtalk.form.secret" class="input" placeholder="开启加签时填写" type="password" />
            </label>
          </div>
          <div class="cc-modal-ft">
            <button class="btn btn-ghost" @click="closeDingtalk">取消</button>
            <button class="btn btn-primary" :disabled="!dingtalk.form.webhookUrl" @click="saveDingtalk">保存连接</button>
          </div>
        </div>
      </Transition>
    </Teleport>


    <!-- 畅捷通 / T+ 授权弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="chanjet.open" class="cc-overlay" @click="closeChanjet"></div>
      </Transition>
      <Transition name="pop">
        <div v-if="chanjet.open" class="cc-modal">
          <div class="cc-modal-hd">
            <b>连接畅捷通 / T+</b>
            <button class="cc-x" @click="closeChanjet">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="cc-modal-body">
            <p class="cc-modal-tip">在<a href="https://open.chanjet.com" target="_blank" rel="noopener">畅捷通开放平台</a>创建应用，把回调地址设为 <code>https://erp.hergent.cn/api/datasources/v2/chanjet/callback</code>，并将 AppKey / AppSecret 配置到服务端环境变量，然后点击下方按钮开始授权。</p>
            <div v-if="!chanjet.linked">
              <div class="cc-modal-btns">
                <button class="btn btn-primary" :disabled="chanjet.busy" @click="connectChanjet">{{ chanjet.busy ? '正在打开授权页…' : '开始授权' }}</button>
                <button class="btn btn-ghost" :disabled="chanjet.busy" @click="checkChanjet">我已授权，检查连接</button>
              </div>
            </div>
            <div v-else>
              <p class="cc-modal-tip ok">已连接{{ chanjet.orgName ? '：' + chanjet.orgName : '' }}</p>
              <div class="cc-modal-btns">
                <button class="btn btn-primary" :disabled="chanjet.busy" @click="syncChanjet">{{ chanjet.busy ? '同步中…' : '同步数据' }}</button>
                <button class="btn btn-ghost" :disabled="chanjet.busy" @click="disconnectChanjet">断开连接</button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 金蝶 / 云星空 授权弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="kingdee.open" class="cc-overlay" @click="closeKingdee"></div>
      </Transition>
      <Transition name="pop">
        <div v-if="kingdee.open" class="cc-modal">
          <div class="cc-modal-hd">
            <b>连接金蝶 / 云星空</b>
            <button class="cc-x" @click="closeKingdee">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="cc-modal-body">
            <p class="cc-modal-tip">在<a href="https://open.kingdee.com/K3Cloud/Open/Home.aspx" target="_blank" rel="noopener">金蝶开发平台</a>创建应用，回调地址设为 <code>https://erp.hergent.cn/api/datasources/v2/kingdee/callback</code>，将 AppID / AppSecret 配置到服务端环境变量，然后点击下方按钮开始授权。</p>
            <div v-if="!kingdee.linked">
              <div class="cc-modal-btns">
                <button class="btn btn-primary" :disabled="kingdee.busy" @click="connectKingdee">{{ kingdee.busy ? '正在打开授权页…' : '开始授权' }}</button>
                <button class="btn btn-ghost" :disabled="kingdee.busy" @click="checkKingdee">我已授权，检查连接</button>
              </div>
            </div>
            <div v-else>
              <p class="cc-modal-tip ok">已连接{{ kingdee.orgName ? '：' + kingdee.orgName : '' }}</p>
              <div class="cc-modal-btns">
                <button class="btn btn-primary" :disabled="kingdee.busy" @click="syncKingdee">{{ kingdee.busy ? '同步中…' : '同步数据' }}</button>
                <button class="btn btn-ghost" :disabled="kingdee.busy" @click="disconnectKingdee">断开连接</button>
              </div>
            </div>
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
import RoleManage from './RoleManage.vue'

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

/* 技能展示富化：把机器名 + 技术描述 → 老板可懂的「图标 + 中文名 + 能干嘛 + 何时触发」 */
const SKILL_META = {
  'hergent-milk-forecast':   { icon: '🔮', title: '智能预报订货', what: '算可销天数、判断断货风险、给出建议下单量', when: '你问"该进多少货""会不会断货""还能卖几天"' },
  'hergent-milk-expiry':     { icon: '⏳', title: '临期与货损',   what: '判定几天算临期、过期怎么计损、临期库存分级处置', when: '你问"这批快到期怎么办""货损怎么算""过期损失多少"' },
  'hergent-milk-commission': { icon: '💰', title: '提成与工资',   what: '按回款/开单算提成、阶梯提成、扣社保个税后的实发', when: '你问"这个月工资多少""提成怎么算""给业务员算提成"' },
  'hergent-milk-rebate':     { icon: '🎁', title: '厂家返利',     what: '目标达成率、返利基数、核销注意事项', when: '你问"返利怎么算""达成多少""能拿多少返利"' },
  'hergent-collections':     { icon: '📞', title: '智能催收',     what: '查应收逾期、生成分级催收清单和话术', when: '你问"谁还欠钱""该催谁了""逾期多少钱"' },
  'hergent-erp-tools':       { icon: '🧰', title: 'ERP 工具集',   what: '28 个业务工具：开单 / 查库存 / 收付款 / 出报表 / 预警', when: '日常开单、查库存、对账等高频操作' },
  'hergent-architecture':    { icon: '🏗️', title: '系统架构', internal: true, what: '数据库表结构、API 路由、前端模块（开发维护用）', when: '系统开发 / 维护时' },
  'hergent-erp-diagnostics': { icon: '🔧', title: '排障诊断', internal: true, what: 'API 调用、端口 / token 获取、工具直调（开发排障用）', when: '系统异常排查时' },
}
function skillMeta(s) {
  return SKILL_META[s.name] || {}
}

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

/* 渠道凭证（租户级，后端加密持久化，替换 localStorage） */
const wecom = reactive({ open: false, linked: false, form: { webhookUrl: '', corpId: '', agentId: '' } })
const feishu = reactive({ open: false, linked: false, form: { webhookUrl: '', appId: '', appSecret: '' } })
const dingtalk = reactive({ open: false, linked: false, form: { webhookUrl: '', secret: '' } })

/* 连接状态机（每渠道真实连接状态，移植自桌面 gateway.js） */
const wecomBusy = ref(false)
const feishuBusy = ref(false)
const dingtalkBusy = ref(false)
const channelStatus = reactive({
  wecom:    { state: 'disconnected', last_health_at: '', fail_count: 0, restart_count: 0, last_error: '' },
  feishu:   { state: 'disconnected', last_health_at: '', fail_count: 0, restart_count: 0, last_error: '' },
  dingtalk: { state: 'disconnected', last_health_at: '', fail_count: 0, restart_count: 0, last_error: '' },
})

function connLabel(ch) {
  const s = (channelStatus[ch] && channelStatus[ch].state) || 'disconnected'
  return ({ disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '异常', reconnecting: '重连中' })[s] || s
}
function connCls(ch) {
  const s = (channelStatus[ch] && channelStatus[ch].state) || 'disconnected'
  return ({ disconnected: '', connecting: 'warn', connected: 'on', error: 'err', reconnecting: 'warn' })[s] || ''
}

/* 对齐桌面「连接手机」：顶部提示条可关闭（localStorage 记忆） */
const ccTipDismissed = ref(false)
try { if (localStorage.getItem('cc_tip_dismissed') === '1') ccTipDismissed.value = true } catch (e) {}
function dismissCcTip() {
  ccTipDismissed.value = true
  try { localStorage.setItem('cc_tip_dismissed', '1') } catch (e) {}
}

/* 对齐桌面 channel-gateway：底部连接状态栏（聚合三渠道状态机） */
const gwBusy = ref(false)
const gwSummary = computed(() => {
  const st = ['wecom', 'feishu', 'dingtalk'].map(c => (channelStatus[c] && channelStatus[c].state) || 'disconnected')
  const anyErr = st.includes('error')
  const anyReconn = st.includes('reconnecting')
  const anyConn = st.includes('connecting')
  const allConn = st.every(s => s === 'connected')
  const noneConn = st.every(s => s === 'disconnected')
  if (anyErr) return { cls: 'err', text: '部分渠道连接异常，建议点卡片上的「重连」' }
  if (anyReconn) return { cls: 'warn', text: '正在尝试重连…' }
  if (anyConn) return { cls: 'warn', text: '正在连接中…' }
  if (allConn) return { cls: 'on', text: '全部渠道已连接，AI 会推送到你的手机' }
  if (noneConn) return { cls: '', text: '尚未连接任何渠道' }
  return { cls: '', text: '部分渠道已连接' }
})
const gwCls = computed(() => gwSummary.value.cls)
const gwText = computed(() => gwSummary.value.text)
async function recheckAll() {
  gwBusy.value = true
  try {
    const proms = ['wecom', 'feishu', 'dingtalk']
      .filter(c => channelStatus[c] && channelStatus[c].state !== 'disconnected')
      .map(c => testChannel(c))
    await Promise.all(proms)
    await loadChannelStatus()
    toast('已重新检测全部渠道', 'ok')
  } catch (e) { toast('检测失败', 'err') }
  finally { gwBusy.value = false }
}
function setBusy(ch, v) {
  if (ch === 'wecom') wecomBusy.value = v
  else if (ch === 'feishu') feishuBusy.value = v
  else if (ch === 'dingtalk') dingtalkBusy.value = v
}
async function loadChannelStatus() {
  try {
    const r = await api('/api/ai/channels/status')
    const list = (r && r.channels) || []
    list.forEach(c => {
      if (channelStatus[c.channel]) Object.assign(channelStatus[c.channel], {
        state: c.conn_state || 'disconnected',
        last_health_at: c.last_health_at || '',
        fail_count: c.fail_count || 0,
        restart_count: c.restart_count || 0,
        last_error: c.last_error || '',
      })
    })
  } catch (e) { /* 静默 */ }
}
async function testChannel(ch) {
  setBusy(ch, true)
  try {
    const d = await api('/api/ai/channels/test', { method: 'POST', body: { channel: ch } })
    if (d && d.success) toast(d.state === 'connected' ? '连通正常' : ('探活结果：' + connLabel(ch)), 'ok')
    else toast((d && d.msg) || '探活失败', 'err')
    await loadChannelStatus()
  } catch (e) { toast(e.message || '探活失败', 'err') }
  finally { setBusy(ch, false) }
}
async function restartChannel(ch) {
  setBusy(ch, true)
  try {
    const d = await api('/api/ai/channels/restart', { method: 'POST', body: { channel: ch } })
    if (d && d.success) toast('已重连：' + connLabel(ch), 'ok')
    else toast((d && d.msg) || '重连失败', 'err')
    await loadChannelStatus()
  } catch (e) { toast(e.message || '重连失败', 'err') }
  finally { setBusy(ch, false) }
}
async function loadChannelConfig(channel) {
  try { return (await api('/api/ai/channels/config?channel=' + channel)) || {} }
  catch (e) { return {} }
}

async function openWecom() {
  const r = await loadChannelConfig('wecom')
  const cfg = (r && r.config) || {}
  wecom.form.webhookUrl = cfg.webhookUrl || ''
  wecom.form.corpId = cfg.corpId || ''
  wecom.form.agentId = cfg.agentId || ''
  wecom.linked = !!(r && r.enabled)
  loadModalRoles('wecom')
  wecom.open = true
}
function closeWecom() { wecom.open = false }

async function saveWecom() {
  const cfg = { webhookUrl: wecom.form.webhookUrl.trim(), corpId: wecom.form.corpId.trim(), agentId: wecom.form.agentId.trim() }
  if (!cfg.webhookUrl) { toast('请填写企微群机器人 Webhook 地址', 'err'); return }
  try {
    await api('/api/ai/channels/config', { method: 'PUT', body: { channel: 'wecom', config: cfg } })
    wecom.linked = true; wecom.open = false
    toast('企微连接已保存', 'success')
    testChannel('wecom')
    await applyModalRoles('wecom')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

async function openFeishu() {
  const r = await loadChannelConfig('feishu')
  const cfg = (r && r.config) || {}
  feishu.form.webhookUrl = cfg.webhookUrl || ''
  feishu.form.appId = cfg.appId || ''
  feishu.form.appSecret = cfg.appSecret || ''
  feishu.linked = !!(r && r.enabled)
  loadModalRoles('feishu')
  feishu.open = true
}
function closeFeishu() { feishu.open = false }

async function saveFeishu() {
  const cfg = { webhookUrl: feishu.form.webhookUrl.trim(), appId: feishu.form.appId.trim(), appSecret: feishu.form.appSecret.trim() }
  if (!cfg.webhookUrl) { toast('请填写飞书群机器人 Webhook 地址', 'err'); return }
  try {
    await api('/api/ai/channels/config', { method: 'PUT', body: { channel: 'feishu', config: cfg } })
    feishu.linked = true; feishu.open = false
    toast('飞书连接已保存', 'success')
    testChannel('feishu')
    await applyModalRoles('feishu')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

async function openDingtalk() {
  const r = await loadChannelConfig('dingtalk')
  const cfg = (r && r.config) || {}
  dingtalk.form.webhookUrl = cfg.webhookUrl || ''
  dingtalk.form.secret = cfg.secret || ''
  dingtalk.linked = !!(r && r.enabled)
  loadModalRoles('dingtalk')
  dingtalk.open = true
}
function closeDingtalk() { dingtalk.open = false }

async function saveDingtalk() {
  const cfg = { webhookUrl: dingtalk.form.webhookUrl.trim(), secret: dingtalk.form.secret.trim() }
  if (!cfg.webhookUrl) { toast('请填写钉钉群机器人 Webhook 地址', 'err'); return }
  try {
    await api('/api/ai/channels/config', { method: 'PUT', body: { channel: 'dingtalk', config: cfg } })
    dingtalk.linked = true; dingtalk.open = false
    toast('钉钉连接已保存', 'success')
    testChannel('dingtalk')
    await applyModalRoles('dingtalk')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* AI 角色与渠道绑定状态（渠道卡片头像标签、弹窗 chip 网格复用） */
const roles = ref([])
const roleChannels = reactive({})  // roleId -> { wecom: bool, feishu: bool }

async function loadRoles() {
  try {
    const r = await api('/api/ai/roles')
    roles.value = (r && r.roles) || []
    await Promise.all(roles.value.map(loadRoleChannels))
  } catch (e) { roles.value = [] }
}

async function loadRoleChannels(role) {
  try {
    const r = await api('/api/ai/roles/' + role.role_id + '/channels')
    const map = {}
    ;(r && r.channels || []).forEach(c => { map[c.channel] = !!c.connected })
    roleChannels[role.role_id] = map
  } catch (e) { roleChannels[role.role_id] = {} }
}

function isLinked(roleId, channel) {
  return !!(roleChannels[roleId] && roleChannels[roleId][channel])
}


/* 连接弹窗内的「选 AI 角色」：chip 多选 + 保存时自动 pair/approve 绑定（对齐桌面 channelRoleModal 角色 chip 区） */
const modalRoles = reactive(new Set())
function toggleModalRole(roleId) {
  if (modalRoles.has(roleId)) modalRoles.delete(roleId)
  else modalRoles.add(roleId)
}
function loadModalRoles(channel) {
  modalRoles.clear()
  roles.value.forEach(r => { if (isLinked(r.role_id, channel)) modalRoles.add(r.role_id) })
}
async function applyModalRoles(channel) {
  let bound = 0, unbound = 0
  for (const r of roles.value) {
    const want = modalRoles.has(r.role_id)
    const has = isLinked(r.role_id, channel)
    if (want && !has) {
      try {
        const p = await api(`/api/ai/roles/${r.role_id}/channels/${channel}/pair`, { method: 'POST', body: {} })
        if (p && p.success) {
          const a = await api(`/api/ai/roles/${r.role_id}/channels/${channel}/approve`, { method: 'POST', body: { code: p.code } })
          if (a && a.success) bound++
        }
      } catch (e) {}
    } else if (!want && has) {
      try {
        await api('/api/ai/roles/' + r.role_id + '/channels', { method: 'PUT', body: { items: [{ channel, connected: false }] } })
        unbound++
      } catch (e) {}
    }
  }
  await Promise.all(roles.value.map(loadRoleChannels))
  if (bound) toast(`已绑定 ${bound} 个 AI 角色到 ${channel}`, 'ok')
  if (unbound) toast(`已解除 ${unbound} 个角色`, 'ok')
}

function avatarUrl(roleId) {
  return '/api/ai/roles/' + roleId + '/avatar?t=' + Date.now()
}

const wecomLinkedRoles = computed(() => roles.value.filter(r => isLinked(r.role_id, 'wecom')))
const feishuLinkedRoles = computed(() => roles.value.filter(r => isLinked(r.role_id, 'feishu')))
const dingtalkLinkedRoles = computed(() => roles.value.filter(r => isLinked(r.role_id, 'dingtalk')))

/* 畅捷通 / T+ 数据源连接（走后端 OAuth，前端只负责引导授权 + 检查状态） */
const chanjet = reactive({
  open: false,
  linked: false,
  busy: false,
  orgName: '',
})
const CHANJET_KEY = 'hergent_chanjet_config'

function loadChanjet() {
  try { return JSON.parse(localStorage.getItem(CHANJET_KEY) || 'null') } catch { return null }
}

async function refreshChanjetStatus() {
  try {
    const s = await api('/api/datasources/v2/chanjet/status')
    chanjet.linked = !!s.connected
    chanjet.orgName = s.org_name || ''
    if (s.connected) localStorage.setItem(CHANJET_KEY, JSON.stringify({ connected: true, orgName: s.org_name || '' }))
    else localStorage.removeItem(CHANJET_KEY)
  } catch (e) { /* 静默：服务端未配置 key 时不崩 */ }
}

function openChanjet() { chanjet.open = true }
function closeChanjet() { chanjet.open = false }

async function connectChanjet() {
  chanjet.busy = true
  try {
    const d = await api('/api/datasources/v2/chanjet/connect', { method: 'POST', body: {} })
    if (d && d.success && d.auth_url) {
      window.open(d.auth_url, '_blank')
      toast('已打开授权页，请在畅捷通完成授权', 'info')
    } else {
      toast((d && d.error) || '无法生成授权链接，请检查服务端 CHANJET_APP_KEY/SECRET', 'err')
    }
  } catch (e) {
    toast(e.message || '授权请求失败', 'err')
  } finally {
    chanjet.busy = false
  }
}

async function checkChanjet() {
  chanjet.busy = true
  try {
    await refreshChanjetStatus()
    if (chanjet.linked) { chanjet.open = false; toast('畅捷通已连接', 'success') }
    else toast('尚未检测到授权，请先在畅捷通完成授权', 'info')
  } finally { chanjet.busy = false }
}

async function syncChanjet() {
  chanjet.busy = true
  try {
    const d = await api('/api/datasources/v2/chanjet/sync', { method: 'POST', body: { objects: ['products', 'customers', 'suppliers'] } })
    if (d && d.success) toast(d.message || '同步完成', 'success')
    else toast((d && d.error) || '同步失败', 'err')
  } catch (e) {
    toast(e.message || '同步失败', 'err')
  } finally { chanjet.busy = false }
}

async function disconnectChanjet() {
  chanjet.busy = true
  try {
    const d = await api('/api/datasources/v2/chanjet/disconnect', { method: 'POST' })
    if (d && d.success) { chanjet.linked = false; localStorage.removeItem(CHANJET_KEY); toast('已断开', 'ok') }
    else toast((d && d.error) || '断开失败', 'err')
  } catch (e) {
    toast(e.message || '断开失败', 'err')
  } finally { chanjet.busy = false }
}

/* 金蝶 / 云星空 数据源连接（走后端 OAuth，前端只负责引导授权 + 检查状态） */
const kingdee = reactive({
  open: false,
  linked: false,
  busy: false,
  orgName: '',
})
const KINGDEE_KEY = 'hergent_kingdee_config'

function loadKingdee() {
  try { return JSON.parse(localStorage.getItem(KINGDEE_KEY) || 'null') } catch { return null }
}

async function refreshKingdeeStatus() {
  try {
    const s = await api('/api/datasources/v2/kingdee/status')
    kingdee.linked = !!s.connected
    kingdee.orgName = s.org_name || ''
    if (s.connected) localStorage.setItem(KINGDEE_KEY, JSON.stringify({ connected: true, orgName: s.org_name || '' }))
    else localStorage.removeItem(KINGDEE_KEY)
  } catch (e) { /* 静默：服务端未配置 key 时不崩 */ }
}

function openKingdee() { kingdee.open = true }
function closeKingdee() { kingdee.open = false }

async function connectKingdee() {
  kingdee.busy = true
  try {
    const d = await api('/api/datasources/v2/kingdee/connect', { method: 'POST', body: {} })
    if (d && d.success && d.auth_url) {
      window.open(d.auth_url, '_blank')
      toast('已打开授权页，请在金蝶完成授权', 'info')
    } else {
      toast((d && d.error) || '无法生成授权链接，请检查服务端 KINGDEE_APP_ID/APP_SECRET', 'err')
    }
  } catch (e) {
    toast(e.message || '授权请求失败', 'err')
  } finally {
    kingdee.busy = false
  }
}

async function checkKingdee() {
  kingdee.busy = true
  try {
    await refreshKingdeeStatus()
    if (kingdee.linked) { kingdee.open = false; toast('金蝶已连接', 'success') }
    else toast('尚未检测到授权，请先在金蝶完成授权', 'info')
  } finally { kingdee.busy = false }
}

async function syncKingdee() {
  kingdee.busy = true
  try {
    const d = await api('/api/datasources/v2/kingdee/sync', { method: 'POST', body: { objects: ['products', 'customers', 'suppliers', 'inventory', 'sales_orders', 'purchase_orders'] } })
    if (d && d.success) toast(d.message || '同步完成', 'success')
    else toast((d && d.error) || '同步失败', 'err')
  } catch (e) {
    toast(e.message || '同步失败', 'err')
  } finally { kingdee.busy = false }
}

async function disconnectKingdee() {
  kingdee.busy = true
  try {
    const d = await api('/api/datasources/v2/kingdee/disconnect', { method: 'POST' })
    if (d && d.success) { kingdee.linked = false; localStorage.removeItem(KINGDEE_KEY); toast('已断开', 'ok') }
    else toast((d && d.error) || '断开失败', 'err')
  } catch (e) {
    toast(e.message || '断开失败', 'err')
  } finally { kingdee.busy = false }
}

onMounted(() => {
  loadChannelStatus()
  loadRoles()
  refreshChanjetStatus()
  refreshKingdeeStatus()
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

.cc-expert-intro{font-size:13px;color:var(--t2);line-height:1.6;margin:0 0 18px}
.cc-expert-intro b{color:var(--p-dark)}

.cc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.cc-card{padding:18px;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}
.cc-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.cc-card.disabled{cursor:default;opacity:.7}
.cc-card.disabled:hover{transform:none;box-shadow:var(--shadow-sm)}
.cc-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.cc-logo{width:38px;height:38px;border-radius:10px;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:var(--t2)}
.cc-logo-wecom{background:var(--p-bg);color:var(--p-dark)}
.cc-logo-chanjet{background:rgba(255,149,0,.14);color:#ff9500}
.cc-logo-kingdee{background:rgba(14,165,183,.16);color:#0ea5b7}
.cc-modal-tip.ok{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.cc-modal-btns{display:flex;gap:10px;flex-wrap:wrap}
.cc-modal-btns .btn{flex:1;min-width:120px}
.cc-state{font-size:11px;padding:3px 9px;border-radius:10px;background:var(--bg2);color:var(--t3)}
.cc-state.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.cc-state.warn{background:rgba(245,158,11,.14);color:#f59e0b}
.cc-state.err{background:rgba(239,68,68,.14);color:#ef4444}
.cc-ops{display:flex;gap:8px;margin-bottom:12px}
.cc-op{height:28px;padding:0 12px;border-radius:7px;font-size:12px;border:1px solid var(--bd);background:var(--bg);color:var(--t2);cursor:pointer;transition:all .15s}
.cc-op:hover:not(:disabled){border-color:var(--p-dark);color:var(--p-dark)}
.cc-op:disabled{opacity:.5;cursor:default}
.cc-health{font-size:11px;color:var(--t3);margin-bottom:12px;line-height:1.5}
.cc-name{font-size:15px;font-weight:500;color:var(--t1);margin-bottom:4px}
.cc-desc{font-size:12px;color:var(--t3);margin-bottom:14px;min-height:18px}
.cc-action{display:inline-block;height:32px;padding:0 14px;border-radius:8px;font-size:12px;line-height:32px;text-align:center}
.cc-action.primary{background:var(--p-dark);color:#fff}
.cc-action.ghost{border:1px solid var(--bd);color:var(--t2)}

.cc-logo-feishu{background:rgba(31,110,255,.16);color:#1f6eff}
.cc-logo-dingtalk{background:rgba(0,160,233,.16);color:#00a0e9}
.cc-roles{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.cc-role-tag{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--bg2);overflow:hidden}
.cc-role-av{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:13px}
.cc-role-av-em{line-height:24px}
.cc-roles-pick{margin:0 0 16px;padding:12px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg2)}
.cc-roles-pick-hd{font-size:13px;font-weight:500;color:var(--t1);margin-bottom:10px}
.cc-roles-pick-sub{font-weight:400;color:var(--t2);font-size:12px;margin-left:4px}
.cc-chips{display:flex;flex-wrap:wrap;gap:8px}
.cc-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;border-radius:20px;border:1px solid var(--border-subtle);background:var(--bg);color:var(--t1);cursor:pointer;font-size:12px;transition:.15s;line-height:1}
.cc-chip:hover{border-color:var(--p)}
.cc-chip.on{border-color:var(--p);background:var(--p-bg);color:var(--p-dark)}
.cc-chip-av{width:20px;height:20px;border-radius:50%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:11px}
.cc-chip-av-em{background:var(--p-bg);color:var(--p-dark)}
.cc-chip-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

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
.sk-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.sk-card{padding:16px;display:flex;flex-direction:column;gap:10px;transition:transform .18s ease,box-shadow .18s ease}
.sk-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.sk-card.internal{opacity:.68}
.sk-card.gen{border-style:dashed}
.sk-top{display:flex;align-items:flex-start;gap:12px}
.sk-ic{font-size:22px;line-height:1;flex-shrink:0;margin-top:1px}
.sk-id{flex:1;min-width:0}
.sk-title{font-size:14px;font-weight:600;color:var(--t1)}
.sk-name{font-size:11px;color:var(--t3);font-family:var(--font-mono,monospace);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-badge{font-size:10px;padding:2px 7px;border-radius:8px;background:var(--bg3);color:var(--t3);flex-shrink:0;align-self:flex-start}
.sk-what{font-size:12.5px;color:var(--t2);line-height:1.65}
.sk-when{font-size:11.5px;color:var(--p-dark);background:var(--p-bg);padding:6px 10px;border-radius:8px;line-height:1.5}
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
/* ===== 对齐桌面「连接手机」页面 ===== */
/* 顶部提示条 */
.cc-tip-banner{display:flex;align-items:center;gap:10px;padding:12px 14px;margin-bottom:16px;background:var(--p-bg);border:1px solid transparent;border-radius:12px;font-size:13px;color:var(--p-dark)}
.ctb-icon{flex-shrink:0;font-size:15px}
.ctb-txt{flex:1;line-height:1.5}
.ctb-close{flex-shrink:0;border:none;background:rgba(255,255,255,.55);color:var(--p-dark);font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer}
.ctb-close:hover{background:#fff}

/* 三步引导条 */
.cc-guide{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.cc-guide-step{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--t2);background:var(--bg2);padding:6px 12px;border-radius:10px}
.cgs-num{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--p-dark);color:#fff;font-size:11px;font-weight:600}
.cgs-arrow{color:var(--t3);font-size:14px}

/* 推荐角标（飞书） */
.cc-card{position:relative}
.cc-rec{position:absolute;top:-9px;right:-10px;z-index:2;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:var(--p-dark);color:#fff;line-height:1.5;box-shadow:0 2px 6px rgba(0,0,0,.15)}

/* 底部连接状态栏（对齐桌面 channel-gateway） */
.cc-gateway{display:flex;align-items:center;gap:10px;padding:14px 18px;margin-top:16px;background:var(--bg);border:1px solid var(--bd);border-radius:12px;font-size:13px}
.gw-dot{width:9px;height:9px;border-radius:50%;background:var(--t3);flex-shrink:0;transition:background .2s}
.gw-dot.on{background:var(--suc)}
.gw-dot.warn{background:#f59e0b}
.gw-dot.err{background:#ef4444}
.gw-text{flex:1;color:var(--t2)}
.gw-btn{font-size:12px;padding:5px 14px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--t2);cursor:pointer;transition:all .15s}
.gw-btn:hover:not(:disabled){border-color:var(--p-dark);color:var(--p-dark)}
.gw-btn:disabled{opacity:.5;cursor:not-allowed}
</style>
