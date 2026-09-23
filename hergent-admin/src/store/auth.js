import { defineStore } from 'pinia'
import { authApi, getToken, setToken } from '../api/client'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    username: '',
    role: '',
    platformAdmin: false,
    checked: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
  },
  actions: {
    async login(username, password) {
      const data = await authApi.login(username, password)
      const tk = (data && (data.token || data.access_token)) || ''
      setToken(tk)
      this.token = tk
      this.username = (data.user && data.user.username) || username
      this.role = (data.user && data.user.role) || ''
      // 确认是否平台管理员
      try {
        const who = await authApi.whoami()
        this.platformAdmin = !!(who && who.platform_admin)
      } catch (e) {
        this.platformAdmin = false
      }
      this.checked = true
      if (!this.platformAdmin) {
        setToken('')
        this.token = ''
        throw new Error('该账号没有管理后台权限（需平台管理员）')
      }
      return data
    },
    async verify() {
      if (!this.token) { this.checked = true; return false }
      try {
        const who = await authApi.whoami()
        this.username = who.username || this.username
        this.role = who.role || this.role
        this.platformAdmin = !!(who && who.platform_admin)
        this.checked = true
        return this.platformAdmin
      } catch (e) {
        this.checked = true
        this.token = ''
        setToken('')
        return false
      }
    },
    logout() {
      setToken('')
      this.token = ''
      this.username = ''
      this.role = ''
      this.platformAdmin = false
      this.checked = true
      location.href = '/admin/#/login'
    },
  },
})
