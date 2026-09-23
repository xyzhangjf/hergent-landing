import { defineStore } from 'pinia'

let seq = 0
export const useToastStore = defineStore('toast', {
  state: () => ({ items: [] }),
  actions: {
    push(message, type = 'info', ttl = 2600) {
      const id = ++seq
      this.items.push({ id, message, type })
      setTimeout(() => this.remove(id), ttl)
    },
    ok(m) { this.push(m, 'ok') },
    err(m) { this.push(m, 'err', 3600) },
    remove(id) { this.items = this.items.filter((i) => i.id !== id) },
  },
})
