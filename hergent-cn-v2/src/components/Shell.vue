<template>
  <div class="shell">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="tb-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
        <b>Hergent</b><span class="tb-sub">AI 经营副驾</span>
      </div>
      <div class="tb-right">
        <button class="tb-btn" @click="toggleTheme" title="切换主题">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
        <div class="tb-user" @click="logout">{{ store.user.name || '我' }}</div>
      </div>
    </header>

    <!-- AI 经营副驾常驻条：一个入口，呼出全局抽屉 -->
    <div class="aibar">
      <div class="aibar-greet">{{ greeting }}</div>
      <button class="aibar-copilot" @click="openCopilot">
        <span class="aibar-cp-ic">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
        </span>
        <span class="aibar-cp-txt">问 AI 副驾</span>
        <span class="aibar-cp-k">⌘K</span>
      </button>
    </div>

    <div class="body">
      <!-- 侧栏（桌面） -->
      <aside class="sidebar" :class="{collapsed:!store.ui.sidebarOpen}">
        <nav class="sb-nav">
          <div class="sb-label">经营</div>
          <router-link to="/workbench" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>经营工作台</span></router-link>
          <router-link to="/forecast" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg><span>预报订货管理</span></router-link>
          <router-link to="/rebate" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg><span>目标与返利政策</span></router-link>

          <div class="sb-label">数据</div>
          <router-link to="/dashboard" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span>数据看板</span></router-link>

          <div class="sb-label">连接</div>
          <router-link to="/connect" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg><span>连接中心</span></router-link>

          <div class="sb-label">其他</div>
          <router-link to="/cron" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg><span>定时任务</span></router-link>
          <router-link to="/settings" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg><span>设置</span></router-link>
        </nav>
        <div class="sb-foot" @click="logout">退出登录</div>
      </aside>

      <!-- 内容区 -->
      <main class="content">
        <router-view v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </router-view>
      </main>
    </div>

    <!-- 移动端底部 Tab -->
    <nav class="mnav">
      <router-link to="/workbench" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>工作台</span></router-link>
      <router-link to="/forecast" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg><span>预报</span></router-link>
      <router-link to="/rebate" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg><span>政策</span></router-link>
      <router-link to="/dashboard" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span>看板</span></router-link>
      <button class="mnav-item" @click="store.ui.mobileDrawer=!store.ui.mobileDrawer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg><span>更多</span></button>
    </nav>

    <!-- 移动端更多抽屉 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="store.ui.mobileDrawer" class="md-overlay" @click="store.ui.mobileDrawer=false"></div>
      </Transition>
      <Transition name="sheet">
        <div v-if="store.ui.mobileDrawer" class="md-sheet">
          <div class="md-grab"></div>
          <router-link to="/connect" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>连接中心</router-link>
          <router-link to="/cron" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>定时任务</router-link>
          <router-link to="/settings" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>设置</router-link>
          <button class="md-item" @click="logout"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>退出登录</button>
        </div>
      </Transition>
    </Teleport>

    <!-- AI 副驾全局抽屉 -->
    <CopilotDrawer />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { store, toast, setTheme } from '../store'
import { auth } from '../api/client'
import CopilotDrawer from './CopilotDrawer.vue'

const router = useRouter()

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息 👋'
  if (h < 9) return '早上好 👋'
  if (h < 12) return '上午好 👋'
  if (h < 14) return '中午好 👋'
  if (h < 18) return '下午好 👋'
  return '晚上好 👋'
})

function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

function logout() {
  auth.token = ''
  auth.user = null
  router.push('/login')
}

function openCopilot() {
  store.ui.copilotOpen = true
}

/* ⌘K / Ctrl+K 唤起 AI 副驾（对输入框豁免） */
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    const t = e.target
    const tag = t && t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return
    e.preventDefault()
    store.ui.copilotOpen = !store.ui.copilotOpen
  }
}

onMounted(() => {
  if (auth.user) store.user.name = auth.user.display_name || auth.user.name || auth.user.username || '我'
  window.addEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.shell{display:flex;flex-direction:column;height:100vh;background:radial-gradient(1200px 420px at 72% -8%,rgba(6,182,212,.07),transparent 60%),var(--bg2)}
.topbar{height:var(--topbar-h);display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-bottom:1px solid var(--glass-border);flex-shrink:0;z-index:10}
.tb-brand{display:flex;align-items:center;gap:8px}
.tb-brand b{font-size:16px;font-weight:600;letter-spacing:.2px}
.tb-sub{font-size:12px;color:var(--t3);padding:3px 8px;border-radius:8px;background:var(--p-bg);color:var(--p-dark)}
.tb-right{display:flex;align-items:center;gap:8px}
.tb-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2)}
.tb-btn:hover{background:var(--bg2);color:var(--p-dark)}
.tb-user{height:32px;display:flex;align-items:center;padding:0 12px;border-radius:16px;background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer}

.aibar{height:var(--ai-bar-h);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 20px;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-bottom:1px solid var(--glass-border);flex-shrink:0;z-index:9}
.aibar-greet{font-size:14px;font-weight:500;color:var(--t1);white-space:nowrap}
.aibar-copilot{display:flex;align-items:center;gap:8px;height:34px;padding:0 7px 0 11px;border:1px solid var(--p);border-radius:18px;background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}
.aibar-copilot:hover{background:var(--p);color:#fff;box-shadow:0 4px 14px rgba(6,182,212,.22)}
.aibar-cp-ic{display:flex;align-items:center;justify-content:center}
.aibar-cp-k{padding:2px 7px;border-radius:8px;background:rgba(6,182,212,.14);font-size:11px;font-weight:500}

.body{flex:1;display:flex;overflow:hidden}
.sidebar{width:var(--sidebar-w);flex-shrink:0;display:flex;flex-direction:column;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-right:1px solid var(--glass-border);transition:width .2s}
.sb-nav{flex:1;overflow-y:auto;padding:12px 10px}
.sb-label{font-size:11px;font-weight:500;color:var(--t3);padding:14px 10px 6px;letter-spacing:.8px}
.sb-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:10px;color:var(--t2);text-decoration:none;font-size:13px;transition:all .15s}
.sb-item:hover{background:var(--bg);color:var(--t1)}
.sb-item.router-link-active{background:var(--p-bg);color:var(--p-dark);font-weight:500}
.sb-foot{padding:12px 20px;border-top:1px solid var(--border-subtle);font-size:12px;color:var(--t3);cursor:pointer}
.sb-foot:hover{color:var(--dan)}

.content{flex:1;overflow-y:auto;padding:20px;background:var(--bg)}

.page-enter-active,.page-leave-active{transition:opacity .18s,transform .18s}
.page-enter-from{opacity:0;transform:translateY(6px)}
.page-leave-to{opacity:0}

.mnav{display:none}
.md-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:900}
.md-sheet{position:fixed;left:0;right:0;bottom:0;background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-radius:16px 16px 0 0;padding:8px 0 calc(12px + env(safe-area-inset-bottom));z-index:901}
.md-grab{width:36px;height:4px;border-radius:2px;background:var(--bd);margin:6px auto 10px}
.md-item{display:flex;align-items:center;gap:12px;width:100%;padding:14px 20px;border:none;background:none;font-size:15px;color:var(--t1);text-align:left}
.md-item:active{background:var(--bg4)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.sheet-enter-active,.sheet-leave-active{transition:transform .25s ease}
.sheet-enter-from,.sheet-leave-to{transform:translateY(100%)}

@media(max-width:768px){
  .sidebar{display:none}
  .aibar-greet{display:none}
  .mnav{display:flex;position:fixed;bottom:0;left:0;right:0;height:calc(56px + env(safe-area-inset-bottom));background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-top:1px solid var(--glass-border);z-index:800;padding-bottom:env(safe-area-inset-bottom)}
  .mnav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:none;background:none;color:var(--t3);font-size:11px}
  .mnav-item.router-link-active{color:var(--p-dark)}
  .content{padding:14px 12px calc(72px + env(safe-area-inset-bottom))}
}
</style>
