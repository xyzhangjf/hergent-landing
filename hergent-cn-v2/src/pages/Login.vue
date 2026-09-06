<template>
  <div class="login">
    <div class="login-card">
      <div class="login-logo">
        <img src="/favicon.svg" alt="Hergent" />
      </div>
      <h1>Hergent · AI 经营副驾</h1>
      <p class="login-sub">低温奶经销商的经营好帮手</p>

      <!-- 登录 / 注册 切换 -->
      <div class="lg-tabs">
        <button class="lg-tab" :class="{ on: mode === 'login' }" @click="setMode('login')">登录</button>
        <button class="lg-tab" :class="{ on: mode === 'register' }" @click="setMode('register')">免费注册</button>
      </div>

<!-- 登录 / 注册 切换：card 高度由 min-height:548px 锁定，两 form 直接 v-if/v-else 瞬切，无过渡动画也无跳变 -->
<form v-if="mode === 'login'" key="login" @submit.prevent="doLogin">
        <div class="field">
          <label class="field-label">用户名</label>
          <input v-model="username" class="input" placeholder="用户名" autocomplete="username" required>
        </div>
        <div class="field">
          <label class="field-label">密码</label>
          <div class="pw-wrap">
            <input v-model="password" :type="pwShow ? 'text' : 'password'" class="input" placeholder="密码" autocomplete="current-password" required>
            <button type="button" class="pw-eye" :aria-label="pwShow ? '隐藏密码' : '显示密码'" @click="pwShow = !pwShow">
              <svg v-if="!pwShow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
            </button>
          </div>
        </div>
        <a class="login-forgot" @click="forgotOpen = true">忘记密码？</a>
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
        <button type="button" class="btn btn-ghost btn-block demo-btn" :disabled="demoLoading" @click="doDemo">
          {{ demoLoading ? '进入演示中…' : '先看看演示效果（免注册）' }}
        </button>
      </form>

      <!-- 注册（自注册 → 建租户 → 引导上传数据激活） -->
      <form v-else key="register" @submit.prevent="doRegister">
        <div class="field">
          <label class="field-label">公司名</label>
          <input v-model="regCompany" class="input" placeholder="公司名（如：张记乳品）" required>
        </div>
        <div class="field">
          <label class="field-label">手机号</label>
          <input v-model="regPhone" class="input" placeholder="手机号" autocomplete="tel" required>
        </div>
        <div class="field">
          <label class="field-label">密码</label>
          <div class="pw-wrap">
            <input v-model="regPassword" :type="pwShow ? 'text' : 'password'" class="input" placeholder="密码（至少 8 位）" autocomplete="new-password" required>
            <button type="button" class="pw-eye" :aria-label="pwShow ? '隐藏密码' : '显示密码'" @click="pwShow = !pwShow">
              <svg v-if="!pwShow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
            </button>
          </div>
        </div>
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading || !agreed">
          {{ loading ? '注册中…' : '注册并开始使用' }}
        </button>
        <label class="login-agree">
          <input type="checkbox" v-model="agreed">
          我已阅读并同意<a href="/legal/terms.html" target="_blank" rel="noopener">《用户协议》</a>和<a href="/legal/privacy.html" target="_blank" rel="noopener">《隐私政策》</a>
        </label>
      </form>

      <p class="login-legal">
        © 2026 湖北省小赫智体数字科技有限公司<br>
        <a class="beian" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">鄂ICP备2026027973号-1</a> · <a href="/legal/terms.html" target="_blank" rel="noopener">用户协议</a> · <a href="/legal/privacy.html" target="_blank" rel="noopener">隐私政策</a>
      </p>
    </div>

    <!-- 注册成功 → 激活引导：上传第一份数据 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="actOpen" class="act-overlay"></div></Transition>
      <Transition name="pop">
        <div v-if="actOpen" class="act-modal">
          <div class="act-hd"><b>欢迎，{{ regCompany }}</b><button class="act-x" @click="skipActivate">跳过</button></div>
          <div class="act-body">
            <p class="act-step">第 1 步 · 上传你的第一份数据（30 秒激活）</p>
            <p class="act-tip">从舟谱/系统导出 Excel（应收、商品、订单均可），拖进来 AI 自动识别入库——马上就能看到你的经营分析。</p>
            <label class="act-drop" :class="{ busy: actBusy }">
              <input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="actFile">
              <span v-if="!actBusy">{{ actResult || '点击选择 Excel 文件' }}</span>
              <span v-else>AI 识别导入中…</span>
            </label>
            <div v-if="actDone" class="act-done">导入完成！现在去看你的经营工作台</div>
          </div>
          <div class="act-ft">
            <button class="btn btn-ghost" @click="skipActivate">稍后再说</button>
            <button class="btn btn-primary" :disabled="!actDone" @click="goWorkbench">进入工作台 →</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 忘记密码说明弹窗 -->
    <Teleport to="body">
      <div v-if="forgotOpen" class="forgot-mask" @click.self="forgotOpen = false"></div>
      <div v-if="forgotOpen" class="forgot-modal">
        <div class="forgot-hd"><b>找回密码</b><button class="forgot-x" @click="forgotOpen = false" aria-label="关闭">×</button></div>
        <div class="forgot-body">
          <p class="forgot-tip">为账号安全，目前由人工协助重置密码。</p>
          <p class="forgot-step">请将您的「用户名 + 联系电话」发邮件给我们，工作日内协助重置：</p>
          <p class="forgot-mail">admin@hergent.cn</p>
          <a class="btn btn-primary btn-block" :href="mailtoForgot" target="_blank" rel="noopener">发邮件给我们（已自动填好主题与正文）</a>
          <p class="forgot-foot">紧急情况可联系您的系统管理员直接重置。</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { login, register, demoLogin } from '../api/client'
import { importApi } from '../api/modules'
import { store } from '../store'

const router = useRouter()
const mode = ref('login')
function setMode(m) { mode.value = m; error.value = '' }   // 切换 Tab 时清空残留错误
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const demoLoading = ref(false)
const pwShow = ref(false)   // 密码显隐切换
const forgotOpen = ref(false)   // 忘记密码说明弹窗
const mailtoForgot = computed(() => {
  const u = username.value.trim() || '（请填写您的用户名）'
  return `mailto:admin@hergent.cn?subject=${encodeURIComponent('[Hergent] 密码重置请求')}&body=${encodeURIComponent(`您好，\n请协助重置我的账号密码：\n\n用户名：${u}\n联系电话：\n\n谢谢`)}`
})
onMounted(() => {   // 回填上次登录成功的用户名
  try {
    const saved = localStorage.getItem('hergent_last_username')
    if (saved) username.value = saved
  } catch (e) {}
})

const regCompany = ref('')
const regPhone = ref('')
const regPassword = ref('')
const agreed = ref(false)   // 注册前须勾选同意协议（PIPL 明确同意）

/* 激活引导 */
const actOpen = ref(false)
const actBusy = ref(false)
const actDone = ref(false)
const actResult = ref('')

async function doLogin() {
  error.value = ''
  loading.value = true
  try {
    const data = await login(username.value.trim(), password.value)
    store.user.name = data.user?.display_name || data.user?.name || data.user?.username || username.value.trim()
    try { localStorage.setItem('hergent_last_username', username.value.trim()) } catch (e) {}
    router.push('/workbench')
  } catch (e) {
    error.value = e.message || '登录失败'
  } finally {
    loading.value = false
  }
}

async function doDemo() {
  error.value = ''
  demoLoading.value = true
  try {
    const data = await demoLogin()
    store.user.name = data.user?.display_name || '演示用户'
    store.demo = true
    router.push('/workbench')
  } catch (e) {
    error.value = e.message || '演示入口暂不可用'
  } finally {
    demoLoading.value = false
  }
}

async function doRegister() {
  error.value = ''
  loading.value = true
  try {
    const data = await register(regCompany.value.trim(), regPhone.value.trim(), regPassword.value)
    store.user.name = data.user?.display_name || regCompany.value.trim()
    // 注册成功 → 弹激活引导
    actOpen.value = true
    actBusy.value = false
    actDone.value = false
    actResult.value = ''
  } catch (e) {
    error.value = e.message || '注册失败'
  } finally {
    loading.value = false
  }
}

async function actFile(ev) {
  const f = ev.target.files?.[0]
  ev.target.value = ''
  if (!f) return
  actBusy.value = true
  actResult.value = ''
  try {
    const r = await importApi.oneShot(f)
    if (r.success && r.success !== false) {
      actDone.value = true
      actResult.value = `${r.category === 'receivables' ? '应收' : r.category === 'products' ? '商品' : '订单'}已识别 · ${r.success} 条入库`
    } else {
      actResult.value = r.message || '未能自动识别，可稍后在工作台导入'
      actBusy.value = false
    }
  } catch (e) {
    actResult.value = e.message || '导入失败，可稍后在工作台导入'
    actBusy.value = false
  }
}

function skipActivate() {
  actOpen.value = false
  router.push('/workbench')
}

function goWorkbench() {
  actOpen.value = false
  router.push('/workbench')
}
</script>

<style scoped>
.login{height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg2);padding:20px}
.login-card{width:360px;max-width:100%;background:var(--bg);border-radius:20px;padding:40px 32px;box-shadow:var(--shadow-lg);border:1px solid var(--border-subtle);min-height:548px;display:flex;flex-direction:column}
.login-logo{display:flex;justify-content:center;margin-bottom:14px}
.login-logo img{width:48px;height:48px;border-radius:10px;box-shadow:0 4px 12px rgba(13,148,136,.18)}
h1{font-size:20px;font-weight:600;text-align:center;margin-bottom:4px}
.login-sub{font-size:13px;color:var(--t3);text-align:center;margin-bottom:24px}
form{display:flex;flex-direction:column;gap:12px;flex:1}
.login-error{font-size:12px;color:var(--dan);margin:0}
.pw-wrap{position:relative}
.pw-wrap .input{padding-right:42px}
.pw-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;align-items:center;padding:6px;border:none;background:none;color:var(--t3);cursor:pointer;line-height:0}
.pw-eye:hover{color:var(--p-dark)}
.field{display:flex;flex-direction:row;align-items:center;gap:10px}
.field-label{font-size:12px;font-weight:500;color:var(--t2);width:52px;flex-shrink:0;text-align:left}
.field .input,.field .pw-wrap{flex:1;min-width:0}
.field .input{padding-right:42px}
.login-legal{font-size:11px;color:var(--t3);text-align:center;margin-top:auto;line-height:1.9}
.login-forgot{font-size:12px;color:var(--t3);text-align:right;display:block;margin:-6px 2px 0;cursor:pointer}
.login-forgot:hover{color:var(--p-dark)}
.forgot-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1000}
.forgot-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:360px;max-width:calc(100vw - 40px);background:var(--bg);border-radius:14px;box-shadow:var(--shadow-lg);padding:24px;z-index:1001}
.forgot-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.forgot-hd b{font-size:16px;font-weight:600}
.forgot-x{background:none;border:none;font-size:20px;color:var(--t3);cursor:pointer;line-height:1;padding:0 4px}
.forgot-x:hover{color:var(--t1)}
.forgot-tip{font-size:13px;color:var(--t2);margin-bottom:10px}
.forgot-step{font-size:12px;color:var(--t3);margin-bottom:8px}
.forgot-mail{font-size:14px;font-weight:600;color:var(--p-dark);text-align:center;padding:10px;background:var(--bg2);border-radius:8px;margin-bottom:14px}
.forgot-foot{font-size:11px;color:var(--t3);margin-top:10px;text-align:center}
.login-legal .beian{margin-right:6px}
.login-legal a{color:var(--p-dark);text-decoration:none;margin:0 2px}
.login-legal a:hover{text-decoration:underline}
.login-legal a.beian{color:var(--t3)}
.login-agree{display:flex;align-items:flex-start;gap:6px;font-size:12px;color:var(--t2);margin:2px 0 0;line-height:1.5}
.login-agree input{margin-top:2px;accent-color:var(--p);flex:none}
.login-agree a{color:var(--p-dark);text-decoration:none}
.login-agree a:hover{text-decoration:underline}
.lg-tabs{display:flex;gap:8px;margin-bottom:18px;background:var(--bg2);border-radius:10px;padding:4px}
.demo-btn{color:var(--p-dark);border-color:rgba(6,182,212,.35);margin-top:2px}
.lg-tab{flex:1;border:none;background:none;padding:8px;border-radius:8px;font-size:13px;color:var(--t3);cursor:pointer;transition:all .15s}
.lg-tab.on{background:var(--bg);color:var(--p-dark);font-weight:500;box-shadow:var(--shadow-sm)}
/* 激活引导弹窗 */
.act-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:980}
.act-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(440px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.2)}
.act-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.act-hd b{font-size:15px}
.act-x{border:none;background:none;font-size:12px;color:var(--t3);cursor:pointer}
.act-body{padding:20px}
.act-step{font-size:14px;font-weight:500;color:var(--t1);margin:0 0 8px}
.act-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 14px}
.act-drop{display:flex;align-items:center;justify-content:center;border:2px dashed var(--p-dark);border-radius:12px;padding:26px 16px;font-size:13px;color:var(--p-dark);cursor:pointer;text-align:center;transition:all .15s}
.act-drop:hover{background:var(--p-bg)}
.act-drop.busy{opacity:.6}
.act-done{margin-top:14px;font-size:13px;color:#2f9e44;font-weight:500}
.act-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
</style>
