import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { pinia, setTheme } from './store'
import { bootstrapTenantContext } from './api/client'
import './styles/variables.css'

// 恢复主题
setTheme(localStorage.getItem('hergent_theme') === 'dark' ? 'dark' : 'light')

// 启动时清理可能失效的租户 cookie（老会话/演示残留会让所有业务接口 403）
bootstrapTenantContext()

const app = createApp(App)

// 全局错误兜底：捕获组件生命周期/渲染之外的未处理异常，避免静默崩溃（P0 评审清单）。
app.config.errorHandler = (err, instance, info) => {
  console.error('[global error]', err, info)
}

app.use(pinia).use(router).mount('#app')
