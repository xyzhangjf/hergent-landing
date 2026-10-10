import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { pinia, setTheme } from './store'
import { bootstrapTenantContext } from './api/client'
import { initDensity } from './composables/useDensity'
import './styles/variables.css'
import './styles/col-menu.css'   // 列设置齿轮 + 面板 + 列宽拖动手柄（全站表格页复用，v432 / v444）

// 恢复主题
setTheme(localStorage.getItem('hergent_theme') === 'dark' ? 'dark' : 'light')

// 启动时清理可能失效的租户 cookie（老会话/演示残留会让所有业务接口 403）
// 🔴 必须先于 initDensity：密度读的是**租户级**偏好，若带着残留 cookie 先发出去，
//    会读到上一个租户的配置（cookie 残留正是这条清理要对付的毛病）。
bootstrapTenantContext()

// 恢复表格密度（v417k）：本地先即时生效，联网后再用云端对齐（失败不影响本机）
initDensity()

const app = createApp(App)

// 全局错误兜底：捕获组件生命周期/渲染之外的未处理异常，避免静默崩溃（P0 评审清单）。
app.config.errorHandler = (err, instance, info) => {
  console.error('[global error]', err, info)
}

app.use(pinia).use(router).mount('#app')
