import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { setTheme } from './store'
import './styles/variables.css'

// 恢复主题
setTheme(localStorage.getItem('hergent_theme') === 'dark' ? 'dark' : 'light')

createApp(App).use(router).mount('#app')
