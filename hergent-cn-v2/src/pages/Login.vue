<template>
  <div class="login">
    <div class="login-card">
      <div class="login-logo">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
      </div>
      <h1>Hergent · AI 经营副驾</h1>
      <p class="login-sub">低温奶经销商的经营好帮手</p>
      <form @submit.prevent="doLogin">
        <input v-model="username" class="input" placeholder="用户名" autocomplete="username" required>
        <input v-model="password" type="password" class="input" placeholder="密码" autocomplete="current-password" required>
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
      </form>
      <p class="login-tip">AI 能力由 Hermes Agent 提供</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '../api/client'
import { store } from '../store'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

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
</script>

<style scoped>
.login{height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg2);padding:20px}
.login-card{width:360px;max-width:100%;background:var(--bg);border-radius:20px;padding:40px 32px;box-shadow:var(--shadow-lg);border:1px solid var(--border-subtle)}
.login-logo{display:flex;justify-content:center;margin-bottom:14px}
h1{font-size:20px;font-weight:600;text-align:center;margin-bottom:4px}
.login-sub{font-size:13px;color:var(--t3);text-align:center;margin-bottom:28px}
form{display:flex;flex-direction:column;gap:12px}
.login-error{font-size:12px;color:var(--dan);margin:0}
.login-tip{font-size:11px;color:var(--t3);text-align:center;margin-top:20px}
</style>
