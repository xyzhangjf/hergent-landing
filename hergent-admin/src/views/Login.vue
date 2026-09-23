<template>
  <div class="login-page">
    <div class="login-card card">
      <div class="login-brand">
        <img class="logo" :src="brandIcon" alt="Hergent" />
        <div>
          <div class="lb-title">Hergent 管理后台</div>
          <div class="lb-sub">独立租户管理 · 平台运营控制台</div>
        </div>
      </div>
      <div v-if="error" class="login-error">{{ error }}</div>
      <div class="field">
        <label>账号<span class="req">*</span></label>
        <input class="input" v-model="username" placeholder="平台管理员账号" @keyup.enter="submit" />
      </div>
      <div class="field">
        <label>密码<span class="req">*</span></label>
        <input class="input" type="password" v-model="password" placeholder="登录密码" @keyup.enter="submit" />
      </div>
      <button class="btn primary" style="width:100%;padding:10px" :disabled="loading" @click="submit">
        {{ loading ? '登录中…' : '登录' }}
      </button>
      <div class="login-foot">仅限平台管理员登录；普通租户账号无权限进入。</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { ApiError } from '../api/client'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const brandIcon = import.meta.env.BASE_URL + 'icons/brand-64.png'

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = '请输入账号和密码'
    return
  }
  loading.value = true
  try {
    await auth.login(username.value.trim(), password.value)
    const redirect = route.query.redirect || '/'
    router.replace(redirect)
  } catch (e) {
    if (e instanceof ApiError) error.value = e.message
    else error.value = '登录失败：' + (e && e.message ? e.message : '未知错误')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  height: 100vh; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1f2329 0%, #2b313a 100%);
}
.login-card { width: 380px; max-width: 92vw; padding: 32px; }
.login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.login-brand .logo {
  width: 40px; height: 40px; border-radius: 10px;
  display: block; object-fit: contain;
}
.lb-title { font-size: 18px; font-weight: 700; }
.lb-sub { font-size: 12px; color: var(--text-3); margin-top: 2px; }
.login-error {
  background: var(--danger-bg); color: var(--danger);
  padding: 9px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 16px;
}
.login-foot { margin-top: 18px; font-size: 12px; color: var(--text-3); text-align: center; }
</style>
