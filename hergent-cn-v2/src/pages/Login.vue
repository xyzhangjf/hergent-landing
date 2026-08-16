<template>
  <div class="login">
    <div class="login-card">
      <div class="login-logo">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
      </div>
      <h1>Hergent · AI 经营副驾</h1>
      <p class="login-sub">低温奶经销商的经营好帮手</p>

      <!-- 登录 / 注册 切换 -->
      <div class="lg-tabs">
        <button class="lg-tab" :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button class="lg-tab" :class="{ on: mode === 'register' }" @click="mode = 'register'">免费注册</button>
      </div>

      <!-- 登录 -->
      <form v-if="mode === 'login'" @submit.prevent="doLogin">
        <input v-model="username" class="input" placeholder="用户名" autocomplete="username" required>
        <input v-model="password" type="password" class="input" placeholder="密码" autocomplete="current-password" required>
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
        <button type="button" class="btn btn-ghost btn-block demo-btn" :disabled="demoLoading" @click="doDemo">
          {{ demoLoading ? '进入演示中…' : '先看看演示效果（免注册）' }}
        </button>
      </form>

      <!-- 注册（自注册 → 建租户 → 引导上传数据激活） -->
      <form v-else @submit.prevent="doRegister">
        <input v-model="regCompany" class="input" placeholder="公司名（如：张记乳品）" required>
        <input v-model="regPhone" class="input" placeholder="手机号" autocomplete="tel" required>
        <input v-model="regPassword" type="password" class="input" placeholder="密码（至少 8 位）" autocomplete="new-password" required>
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? '注册中…' : '注册并开始使用' }}
        </button>
        <p class="login-note">注册即开通专属经营空间 · 免费试用 · 无需信用卡</p>
      </form>

      <p class="login-tip">AI 能力由 Hermes Agent 提供</p>
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
            <div v-if="actDone" class="act-done">✅ 导入完成！现在去看你的经营工作台</div>
          </div>
          <div class="act-ft">
            <button class="btn btn-ghost" @click="skipActivate">稍后再说</button>
            <button class="btn btn-primary" :disabled="!actDone" @click="goWorkbench">进入工作台 →</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, register, demoLogin } from '../api/client'
import { importApi } from '../api/modules'
import { store } from '../store'

const router = useRouter()
const mode = ref('login')
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const demoLoading = ref(false)

const regCompany = ref('')
const regPhone = ref('')
const regPassword = ref('')

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
      actResult.value = `✅ ${r.category === 'receivables' ? '应收' : r.category === 'products' ? '商品' : '订单'}已识别 · ${r.success} 条入库`
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
.login-card{width:360px;max-width:100%;background:var(--bg);border-radius:20px;padding:40px 32px;box-shadow:var(--shadow-lg);border:1px solid var(--border-subtle)}
.login-logo{display:flex;justify-content:center;margin-bottom:14px}
h1{font-size:20px;font-weight:600;text-align:center;margin-bottom:4px}
.login-sub{font-size:13px;color:var(--t3);text-align:center;margin-bottom:24px}
form{display:flex;flex-direction:column;gap:12px}
.login-error{font-size:12px;color:var(--dan);margin:0}
.login-tip{font-size:11px;color:var(--t3);text-align:center;margin-top:20px}
.login-note{font-size:11px;color:var(--t3);text-align:center;margin:0}
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
