<template>
  <div v-if="open" class="nt-mask" @click="emit('close')"></div>
  <section v-if="open" class="nt-panel" role="dialog" aria-label="通知" @click.stop>
    <header class="nt-hd">
      <b>通知</b>
      <span v-if="unread > 0" class="nt-hd-n">{{ fmtNum(unread) }} 条未读</span>
      <span v-else class="nt-hd-n is-clear">全部已读</span>
      <span class="nt-hd-sp"></span>
      <button v-if="unread > 0" class="nt-btn" :disabled="busy" @click="doReadAll">
        {{ busy ? '处理中…' : '全部已读' }}
      </button>
      <button class="nt-x" title="关闭" @click="emit('close')"><Icon name="close" :size="14" /></button>
    </header>

    <div class="nt-body">
      <div v-if="loading" class="nt-empty">正在加载…</div>
      <template v-else>
        <div class="nt-sec">
          今日该干什么
          <span class="nt-sec-n">{{ groups.length }} 件事</span>
        </div>
        <div v-if="!groups.length" class="nt-empty">暂无未读通知</div>
        <div v-for="g in groups" :key="g.title + '|' + g.msg_type" class="nt-g">
          <div class="nt-g-top">
            <span class="nt-tag" :class="'is-' + meta(g.msg_type).cls">{{ meta(g.msg_type).label }}</span>
            <b class="nt-g-title">{{ g.title }}</b>
            <span v-if="g.triggers > 1" class="nt-g-tri">重复 {{ fmtNum(g.triggers) }} 次</span>
          </div>
          <p class="nt-g-body">{{ plainText(g.latest_content) || '（无正文）' }}</p>
          <div class="nt-g-foot">
            <span>{{ timeText(g.last_at) }}</span>
            <span v-if="g.rows > 1">共 {{ fmtNum(g.rows) }} 条</span>
            <span v-if="g.sender">{{ g.sender }}</span>
          </div>
        </div>

        <p v-if="folded > 0" class="nt-fold">
          另有 {{ fmtNum(folded) }} 条是同一批自动提醒的重复流水，已按上面 {{ groups.length }} 件事归并，不再逐条列出。
        </p>

        <div class="nt-sec">
          最近通知
          <span class="nt-sec-n">最近 {{ items.length }} 条</span>
          <span class="nt-hd-sp"></span>
          <button class="nt-link" @click="showDetail = !showDetail">
            {{ showDetail ? '收起明细' : '展开明细' }}
          </button>
        </div>
        <div v-if="!items.length" class="nt-empty">暂无记录</div>
        <template v-else>
          <div v-for="m in (showDetail ? items : items.slice(0, 3))" :key="m.id" class="nt-i" :class="{ 'is-read': m.is_read }">
            <span class="nt-dot" :class="'is-' + meta(m.msg_type).cls"></span>
            <div class="nt-i-main">
              <div class="nt-i-hd">
                <b>{{ m.title }}</b>
                <span v-if="m.triggers > 1" class="nt-g-tri">重复 {{ fmtNum(m.triggers) }} 次</span>
              </div>
              <p v-if="showDetail" class="nt-i-body">{{ plainText(m.content) || '（无正文）' }}</p>
              <div class="nt-i-foot"><span>{{ timeText(m.last_at) }}</span><span v-if="m.sender">{{ m.sender }}</span></div>
            </div>
            <button v-if="!m.is_read" class="nt-link" :disabled="busy" @click="markOne(m)">已读</button>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
import { toast } from '../store'
import { messagesApi } from '../api/modules'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'unread'])

const loading = ref(false)
const busy = ref(false)
const items = ref([])
const groups = ref([])
const unread = ref(0)
const folded = ref(0)
const showDetail = ref(false)

const TYPE_META = {
  danger: { label: '较紧急', cls: 'dan' },
  warning: { label: '需留意', cls: 'war' },
  notice: { label: '通知', cls: 'p' },
  info: { label: '信息', cls: 'info' }
}
function meta (t) { return TYPE_META[t] || TYPE_META.notice }
function fmtNum (n) { return Number(n || 0).toLocaleString('zh-CN') }

function timeText (s) {
  if (!s) return ''
  const t = new Date(String(s).replace(' ', 'T'))
  if (isNaN(t.getTime())) return String(s)
  const now = new Date()
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d1 = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  const days = Math.round((d0 - d1) / 86400000)
  const hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
  if (days === 0) return '今天 ' + hm
  if (days === 1) return '昨天 ' + hm
  if (days < 7) return days + ' 天前'
  return (t.getMonth() + 1) + '月' + t.getDate() + '日'
}

// 通知正文来自各类任务/AI 输出，常混入 markdown 噪音（**加粗**、| 表格 |、--- 分隔行、# 标题、
// [文字](链接)、`代码`）。这里是「给不懂技术的老板看」的摘要位，一律转成纯文本，避免管道符当正文显示。
function plainText (s) {
  if (!s) return ''
  let x = String(s)
  x = x.replace(/^\s*\|?[\s:|-]{4,}\|?\s*$/gm, ' ')      // 表格分隔行 |---|---|
  x = x.replace(/\|/g, ' ')                              // 表格竖线
  x = x.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')             // 图片
  x = x.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // 链接留文字
  x = x.replace(/`{1,3}([^`]*)`{1,3}/g, '$1')            // 代码
  x = x.replace(/\*\*([^*]*)\*\*/g, '$1')                // 加粗
  x = x.replace(/^\s{0,3}#{1,6}\s*/gm, '')               // 标题
  x = x.replace(/\s+/g, ' ').trim()
  return x
}

async function load () {
  loading.value = true
  try {
    const [b, l] = await Promise.all([messagesApi.briefing(), messagesApi.list({ limit: 20 })])
    groups.value = b.groups || []
    unread.value = b.unread_count || 0
    folded.value = b.folded || 0
    items.value = l.items || []
    emit('unread', unread.value)
  } catch (e) {
    toast(e.message || '加载通知失败', 'err')
  } finally {
    loading.value = false
  }
}

async function markOne (m) {
  busy.value = true
  try {
    await messagesApi.markRead(m.id)
    // 直接重拉：聚合结果（哪件事还在、还剩几条）由后端口径决定，前端不自己推算，避免同屏两个口径
    await load()
  } catch (e) {
    toast(e.message || '标记已读失败', 'err')
  } finally {
    busy.value = false
  }
}

async function doReadAll () {
  busy.value = true
  try {
    await messagesApi.markAllRead()
    groups.value = []
    items.value = items.value.map(x => ({ ...x, is_read: 1 }))
    folded.value = 0
    unread.value = 0
    emit('unread', 0)
    toast('已全部标记为已读', 'ok')
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  } finally {
    busy.value = false
  }
}

watch(() => props.open, v => { if (v) load() })
</script>

<style scoped>
.nt-mask{position:fixed;inset:0;z-index:40}
.nt-panel{position:absolute;top:44px;right:18px;width:440px;max-width:calc(100vw - 32px);max-height:min(72vh,660px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--glass-border);border-radius:12px;box-shadow:var(--shadow-md);z-index:50;overflow:hidden}
.nt-hd{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;border-bottom:1px solid var(--border-subtle)}
.nt-hd b{font-size:14px;font-weight:600;color:var(--t1)}
.nt-hd-n{font-size:12px;color:var(--dan)}
.nt-hd-n.is-clear{color:var(--t3)}
.nt-hd-sp{flex:1}
.nt-btn{height:26px;padding:0 10px;border:1px solid var(--p-border);border-radius:8px;background:var(--p-bg);color:var(--p-dark);font-size:12px;cursor:pointer}
.nt-btn:disabled{opacity:.6;cursor:default}
.nt-x{width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t3);cursor:pointer}
.nt-x:hover{background:var(--bg2);color:var(--t1)}
.nt-body{padding:10px 14px 14px;overflow-y:auto}
.nt-sec{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t3);margin:10px 0 8px}
.nt-sec:first-child{margin-top:2px}
.nt-sec-n{color:var(--t3)}
.nt-empty{padding:14px 0;font-size:13px;color:var(--t3);text-align:center}
.nt-g{border:1px solid var(--border-subtle);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.nt-g-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nt-tag{font-size:11px;padding:2px 7px;border-radius:6px;flex:0 0 auto}
.nt-tag.is-dan{background:var(--dan-bg);color:var(--dan)}
.nt-tag.is-war{background:var(--warn-amber-bg);color:var(--warn-amber)}
.nt-tag.is-p{background:var(--p-bg);color:var(--p-dark)}
.nt-tag.is-info{background:var(--info-blue-bg);color:var(--info-blue)}
.nt-g-title{font-size:13px;font-weight:600;color:var(--t1)}
.nt-g-tri{font-size:11px;color:var(--t3);background:var(--bg2);padding:2px 7px;border-radius:6px}
.nt-g-body{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--t2);word-break:break-all;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.nt-g-foot{display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--t3)}
.nt-fold{margin:2px 0 0;font-size:11px;line-height:1.6;color:var(--t3);background:var(--bg2);border-radius:8px;padding:8px 10px}
.nt-link{border:none;background:none;color:var(--p-dark);font-size:11px;cursor:pointer;padding:0 2px}
.nt-link:disabled{opacity:.6;cursor:default}
.nt-i{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle)}
.nt-i:last-child{border-bottom:none}
.nt-i.is-read{opacity:.62}
.nt-dot{width:7px;height:7px;border-radius:50%;margin-top:6px;flex:0 0 auto;background:var(--t3)}
.nt-dot.is-dan{background:var(--dan)}
.nt-dot.is-war{background:var(--warn-amber)}
.nt-dot.is-p{background:var(--p)}
.nt-dot.is-info{background:var(--info-blue)}
.nt-i-main{flex:1;min-width:0}
.nt-i-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nt-i-hd b{font-size:12.5px;font-weight:500;color:var(--t1)}
.nt-i-body{margin:4px 0 0;font-size:11.5px;line-height:1.6;color:var(--t3);word-break:break-all;white-space:normal}
.nt-i-foot{display:flex;gap:10px;margin-top:3px;font-size:11px;color:var(--t3)}
@media(max-width:520px){.nt-panel{right:8px;left:8px;width:auto}}
</style>
