<template>
  <div class="page">
    <div class="page-hd">
      <h2>连接中心</h2>
      <span class="page-sub">连接消息通道与第三方服务，让 AI 副驾能力外延</span>
    </div>

    <!-- Tab 栏 -->
    <div class="cc-tabs">
      <button class="cc-tab" :class="{ active: tab === 'connector' }" @click="tab = 'connector'">连接器</button>
      <button class="cc-tab" :class="{ active: tab === 'expert' }" @click="tab = 'expert'">专家</button>
      <button class="cc-tab" :class="{ active: tab === 'skill' }" @click="tab = 'skill'">技能</button>
    </div>

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
      <div class="wf-intro">
        <p>把高频经营活封装成「工作流」，一键跑通。这是 AI 副驾随叫随到的能力。</p>
      </div>
      <div class="wf-grid">
        <div v-for="w in workflows" :key="w.name" class="card wf-card" :class="{ disabled: !w.ready }" @click="openWorkflow(w)">
          <div class="wf-top">
            <span class="wf-icon">{{ w.icon }}</span>
            <div class="wf-name-wrap">
              <div class="wf-name">{{ w.name }}</div>
              <span class="wf-state" :class="w.ready ? 'on' : ''">{{ w.ready ? '可用' : '筹备中' }}</span>
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
            <span class="wf-action" :class="w.ready ? 'go' : ''">{{ w.ready ? '去使用 →' : '即将上线' }}</span>
          </div>
        </div>
      </div>
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
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '../store'

const router = useRouter()
const tab = ref('connector')

/* 工作流模板库（对标 ComfyUI 工作流，后续可后端化） */
const workflows = [
  { name: '预报订货工作流', icon: '订', desc: '查库存、算日均销，AI 给建议下单量', steps: ['查库存', '算日均销', '算可销天数', 'AI 审核', '生成订货单'], ready: true, path: '/forecast' },
  { name: '对账工作流', icon: '账', desc: '读应收、匹配客户声称金额，标出差异', steps: ['读应收', '匹配差异', '生成对账单'], ready: true, path: '/reconciliation' },
  { name: '算工资工作流', icon: '薪', desc: '按你的算法自动算工资，核对后一键确认', steps: ['配算法', '读销售额', '算工资', '确认入账'], ready: true, path: '/payroll' },
  { name: '货损预警工作流', icon: '损', desc: '按你的算法扫效期、算损耗，一键出结果', steps: ['配算法', '扫效期', '算损耗', '看结果'], ready: true, path: '/loss' },
]

function openWorkflow(w) {
  if (w.ready && w.path) router.push(w.path)
  else toast(w.name + ' 筹备中', 'info')
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
.wf-intro{font-size:13px;color:var(--t2);margin-bottom:16px}
.wf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.wf-card{padding:18px;cursor:pointer;display:flex;flex-direction:column;gap:12px;transition:transform .18s ease,box-shadow .18s ease}
.wf-card:hover:not(.disabled){transform:translateY(-2px);box-shadow:var(--shadow-md)}
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
</style>
