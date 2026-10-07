<template>
  <ErrorBoundary>
    <router-view />
  </ErrorBoundary>

  <!-- 底部通知坞（v362）：部署自检提示 + 通知条共用**同一个固定栈**，从下往上排。
       🔴 为什么合成一个容器：此前 `.upd-tip`(bottom:140px) 与 `.toast`(bottom:96px)
          各自绝对定位，通知条一变多（现在允许叠 3 条）就会压住「有新版本可用」。
          合进一个 flex 栈后两者**永远不重叠**。 -->
  <div v-if="updateReady || store.ui.toasts.length" class="notif-dock">
    <!-- v306c：部署自检提示 —— 服务器上已发新版本、而当前页面还跑着旧代码时显式提示。
         🔴 为什么需要它：SPA 一旦打开就把 JS 留在内存里，服务器重新部署不会自动生效，
            表现就是「你说修好了，我点了还是失败」，且**毫无提示**（只能靠人猜）。
         v362：底色改用 --toast-* 令牌 —— 它原先同样是 `--t1/--bg` 反色，深色下也是白条。 -->
    <Transition name="toast">
      <button v-if="updateReady" class="upd-tip" type="button" @click="reloadApp">
        <span class="upd-dot"></span>
        有新版本可用
        <span class="upd-act">点击刷新</span>
      </button>
    </Transition>

    <!-- 通知条（v362）：
         · 主题跟随 —— 底色/文字/描边走 --toast-*，深色下不再是白底；
         · 长文案（说明型）**不自动关闭**，右上角有「✕」，也可点弹窗外任意区域 / 按 Esc 关；
         · 多条并存成栈，不再互相顶掉。 -->
    <TransitionGroup name="toast">
      <div v-for="t in store.ui.toasts" :key="t.id"
           class="toast" :class="t.type"
           :role="isErrToast(t.type) ? 'alert' : 'status'"
           :aria-live="isErrToast(t.type) ? 'assertive' : 'polite'">
        <span class="toast-msg">{{ t.msg }}</span>
        <button v-if="t.sticky" class="toast-x" type="button"
                aria-label="关闭这条提示" title="关闭（Esc）"
                @click.stop="store.dismissToast(t.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { store } from './store'
import ErrorBoundary from './components/ErrorBoundary.vue'
import { useAppUpdate } from './composables/useAppUpdate'

/* v306c：部署自检 —— 只提示，不自动刷新（老板可能正在输入框里打字）。 */
const { hasNew: updateReady, reload: reloadApp } = useAppUpdate()

/* v367：无障碍（UI-SPEC §5 第 5 条）—— 通知条容器要 `aria-live`，而**错误类**要 `role="alert"`
     （= 立即播报，不必等用户停顿）。v362 只做了前者，这一半一直缺。
   仓里 toast 的类型命名**两套并存**（`err/ok/warn` 与 `error/success`，见 store 的 toast 用法计数），
   故两组都认；其余一律 `role="status"`（= polite，不打断用户）。 */
const isErrToast = (ty) => ty === 'err' || ty === 'error'

/* v362：长通知条不自动关闭 ⇒ 必须给它「关掉」的出口。出口做两个：
     ① 通知条右上角的 ✕（只有长条显示）；
     ② 点弹窗外部**任意区域**、或按 Esc —— 只关长条（短条本来就自己消失，不该再抢用户一次点击）。
   🔴 监听用**捕获阶段**：这样「点外部」时通知条先关，而用户那一次点击**照常生效**
      （不 stopPropagation）⇒ 不会出现「第一下点击被弹窗吃掉」这个经典毛病。
   🔴 不会误关刚弹出那条：通知条是在 click 处理器里 `await` 之后才入栈的，
      而捕获监听在本次事件传播最开始就已跑完 ⇒ 同一击不会自击自关。 */
function _closeSticky() {
  store.ui.toasts.filter(t => t.sticky).forEach(t => store.dismissToast(t.id))
}
function onDocClick(e) {
  if (!store.ui.toasts.some(t => t.sticky)) return
  const el = e.target
  if (el && el.closest && (el.closest('.toast') || el.closest('.upd-tip'))) return
  _closeSticky()
}
function onKeydown(e) { if (e.key === 'Escape') _closeSticky() }
onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
/* 底部通知坞：固定居中，栈式排列（第一条在最上），整体向上生长。 */
.notif-dock{
  position:fixed;left:50%;bottom:96px;transform:translateX(-50%);
  z-index:var(--z-toast,1200);
  display:flex;flex-direction:column;align-items:center;gap:8px;
  max-width:min(80vw,720px);
  pointer-events:none;        /* 坞本身不吃点击 ⇒ 点空白处仍能关掉长通知条 */
}
.notif-dock > *{pointer-events:auto}

.toast{
  display:flex;align-items:flex-start;gap:10px;
  padding:10px 16px;border-radius:12px;
  background:var(--toast-bg);color:var(--toast-fg);
  border:1px solid var(--toast-bd);
  font-size:13px;line-height:1.6;text-align:left;
  box-shadow:var(--shadow-lg);
}
.toast-msg{flex:1 1 auto;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.toast-x{
  flex:0 0 auto;margin:-1px -6px 0 0;padding:0 5px;
  background:transparent;border:none;border-radius:6px;
  color:inherit;opacity:.6;font:inherit;line-height:1.6;cursor:pointer;
}
.toast-x:hover{opacity:1}

/* 🔴 v362 语义色：全站**两种写法并存**（`err/ok/warn` 与 `error/success`），这里一次认全。
   不补这一条，`.toast.err`/`.toast.warn` 会**落回中性色** ⇒ 500+ 次调用的语义直接丢掉
   （实测：err 217 · ok 154 · warn 150 · error 129 · success 59；此前只定义了 error/success）。
   统一成「主题面上加一条语义色左边框」，而不是饱和底 + 白字 —— 后者在 `--suc` 上白字对比
   只有 2.2:1（读不清），而中性面 ~16:1，两套主题都能读。 */
.toast.err,.toast.error{border-left:3px solid var(--dan)}
.toast.ok,.toast.success{border-left:3px solid var(--suc)}
.toast.warn{border-left:3px solid var(--war)}

.toast-enter-active,.toast-leave-active{transition:all .25s}
.toast-enter-from,.toast-leave-to{opacity:0;transform:translateY(8px)}

/* v306c：部署自检提示（坞内的小胶囊，不再自己绝对定位） */
.upd-tip{
  display:inline-flex;align-items:center;gap:8px;
  padding:9px 16px;border-radius:999px;border:1px solid transparent;
  background:var(--toast-bg);color:var(--toast-fg);
  font:inherit;font-size:13px;line-height:1;cursor:pointer;box-shadow:var(--shadow-lg);
}
.upd-tip:hover{opacity:.92}
.upd-dot{width:7px;height:7px;border-radius:50%;background:var(--suc);flex:none}
.upd-act{opacity:.72;text-decoration:underline;text-underline-offset:2px}
.upd-tip.toast-enter-from,.upd-tip.toast-leave-to{opacity:0;transform:translateY(8px)}
</style>
