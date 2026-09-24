import { defineStore } from 'pinia'

let seq = 0

export const useToastStore = defineStore('toast', {
  state: () => ({ items: [] }),
  actions: {
    /**
     * @param {string} message
     * @param {'info'|'ok'|'err'} type
     * @param {number} ttl 自动消失毫秒；传 0 表示不自动消失
     * @param {{label:string, run:Function}|null} action 可选动作按钮（P2-5：可逆操作用「撤销」）
     */
    push(message, type = 'info', ttl = 2600, action = null) {
      const id = ++seq
      this.items.push({ id, message, type, action })
      if (ttl > 0) setTimeout(() => this.remove(id), ttl)
    },
    // 带动作的 toast 停留更久，否则用户来不及点「撤销」
    ok(m, action = null) { this.push(m, 'ok', action ? 6000 : 2600, action) },
    err(m) { this.push(m, 'err', 3600) },
    remove(id) { this.items = this.items.filter((i) => i.id !== id) },
    runAction(id) {
      const it = this.items.find((i) => i.id === id)
      if (it && it.action && typeof it.action.run === 'function') {
        try { it.action.run() } catch (e) { /* 撤销失败不应炸掉 UI */ }
      }
      this.remove(id)
    },
  },
})
