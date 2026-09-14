<template>
  <div v-if="open" class="nt-mask" @click="emit('close')"></div>
  <section v-if="open" class="nt-panel" role="dialog" aria-label="通知" @click.stop="menuKey = ''">
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
          <span class="nt-sec-n">{{ activeGroups.length }} 件事</span>
        </div>
        <div v-if="!activeGroups.length" class="nt-empty">
          {{ groups.length ? '其它通知已按你的设置收起，见下方「已收起」' : '暂无未读通知' }}
        </div>
        <div v-for="g in activeGroups" :key="g.event_key + '|' + g.msg_type" class="nt-g">
          <div class="nt-g-top">
            <span class="nt-tag" :class="'is-' + meta(g.msg_type).cls">{{ meta(g.msg_type).label }}</span>
            <b class="nt-g-title">{{ g.title }}</b>
            <span v-if="g.triggers > g.rows" class="nt-g-tri">重复 {{ fmtNum(g.triggers - g.rows) }} 次</span>
            <span class="nt-hd-sp"></span>
            <button class="nt-set" title="设置这类通知怎么提醒你" @click.stop="toggleMenu(g.event_key)">
              {{ menuKey === g.event_key ? '收起设置' : '提醒设置' }}
            </button>
          </div>
          <p class="nt-g-body">{{ plainText(g.latest_content) || '（无正文）' }}</p>
          <div class="nt-g-foot">
            <span>{{ timeText(g.last_at) }}</span>
            <span v-if="g.rows > 1">共 {{ fmtNum(g.rows) }} 条</span>
            <span v-if="g.sender">{{ g.sender }}</span>
          </div>
          <div v-if="menuKey === g.event_key" class="nt-ctl" @click.stop>
            <div class="nt-ctl-row">
              <span class="nt-ctl-lb">这类通知</span>
              <button v-for="o in MODE_OPTIONS" :key="o.value" class="nt-chip"
                      :class="{ 'is-on': modeOf(g.event_key) === o.value }"
                      @click="pickMode(g.event_key, o.value)">{{ o.label }}</button>
            </div>
            <div class="nt-ctl-row">
              <span class="nt-ctl-lb">暂时不看</span>
              <button v-for="o in SNOOZE_OPTIONS" :key="o.days" class="nt-chip"
                      @click="pickSnooze(g.event_key, o.days)">{{ o.label }}</button>
            </div>
            <p class="nt-ctl-note">只影响「提示你」，不会删除记录；暂停到期会自动恢复。</p>
          </div>
        </div>

        <template v-if="suppressedRules.length">
          <div class="nt-sec">
            已收起
            <span class="nt-sec-n">{{ suppressedRules.length }} 类</span>
            <span class="nt-hd-sp"></span>
            <button class="nt-link" @click="showSuppressed = !showSuppressed">
              {{ showSuppressed ? '收起' : '展开' }}
            </button>
          </div>
          <p class="nt-fold">
            这 {{ suppressedRules.length }} 类通知不再提示你（相关记录仍留在系统里，没有删除）。
            点「恢复提醒」随时可以看回来。
          </p>
          <div v-if="showSuppressed">
            <div v-for="s in suppressedRules" :key="s.key" class="nt-s">
              <div class="nt-s-main">
                <b>{{ s.key }}</b>
                <span class="nt-s-st">{{ stateText(s) }}</span>
                <!-- 被收起的类还剩几条没看 —— 静音是「不打扰」，不是「藏起来」。
                     不显示这个数，用户会以为通知没产生。 -->
                <span v-if="pendingOf(s.key)" class="nt-s-pend">还有 {{ fmtNum(pendingOf(s.key)) }} 条未看</span>
              </div>
              <button class="nt-link" @click="restore(s.key)">恢复提醒</button>
            </div>
          </div>
        </template>

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
                <span v-if="m.triggers > 1" class="nt-g-tri">重复 {{ fmtNum(m.triggers - 1) }} 次</span>
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
import { ref, computed, watch } from 'vue'
import Icon from './Icon.vue'
import { toast } from '../store'
import { messagesApi } from '../api/modules'
import {
  MODE_OPTIONS, SNOOZE_OPTIONS, badgeFromGroups, modeOf, isSuppressed,
  prettyDate, setMuted, snooze, restore as restorePref,
  suppressedList as suppressedRules
} from '../composables/useNotiPrefs'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'unread'])

const loading = ref(false)
const busy = ref(false)
const items = ref([])
const groups = ref([])
const folded = ref(0)
const showDetail = ref(false)
const showSuppressed = ref(false)
const menuKey = ref('')

const TYPE_META = {
  danger: { label: '较紧急', cls: 'dan' },
  warning: { label: '需留意', cls: 'war' },
  notice: { label: '通知', cls: 'p' },
  info: { label: '信息', cls: 'info' }
}
function meta (t) { return TYPE_META[t] || TYPE_META.notice }
function fmtNum (n) { return Number(n || 0).toLocaleString('zh-CN') }

function keyOf (g) { return g.event_key || g.title || '' }

// 「今天该干什么」只列没被你收起的；被收起的进下方「已收起」区，
// 两边都不能丢 —— 直接过滤掉等于把通知藏起来（用户会以为系统不再产生了）。
const activeGroups = computed(() => groups.value.filter(g => !isSuppressed(keyOf(g))))
const hiddenGroups = computed(() => groups.value.filter(g => isSuppressed(keyOf(g))))

/** 某个被收起的事件类型还剩几条没看（静音 ≠ 藏起来，得让用户看得见） */
function pendingOf (key) {
  return hiddenGroups.value
    .filter(g => keyOf(g) === key)
    .reduce((n, g) => n + Number(g.rows || 1), 0)
}

// 头部未读数必须与顶栏铃铛**同一个算法**（useNotiPrefs.badgeFromGroups）：
// 两边都是同一个纯函数 + 同一份规则 + 同一批 groups，所以结果必然一致 ——
// 不能一边带副作用地「记账」、一边纯计算，那样同屏两个数字会对不上。
const unread = computed(() => badgeFromGroups(groups.value))

function stateText (s) {
  if (s.state === 'snoozed') return '暂停至 ' + prettyDate(s.until)
  if (s.state === 'off') return '不再提示'
  return ''
}

function toggleMenu (key) { menuKey.value = menuKey.value === key ? '' : key }

// 改完规则要**立刻**把新的未读数推给顶栏铃铛 —— 否则铃铛要等下一轮 2 分钟轮询才变，
// 用户会看到「面板说 4 条、铃铛还挂着 5」。
function pushUnread () { emit('unread', unread.value) }

function pickMode (key, v) {
  setMuted(key, v === 'off')
  menuKey.value = ''
  pushUnread()
  toast(v === 'off' ? '这类通知不再提示（可在「已收起」里恢复）' : '这类通知恢复提示', 'ok')
}

function pickSnooze (key, days) {
  snooze(key, days)
  menuKey.value = ''
  pushUnread()
  toast('已暂停 ' + days + ' 天，到期自动恢复', 'ok')
}

function restore (key) {
  restorePref(key)
  pushUnread()
  toast('已恢复提醒', 'ok')
}

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
    emit('unread', 0)
    toast('已全部标记为已读', 'ok')
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  } finally {
    busy.value = false
  }
}

watch(() => props.open, v => { if (v) { menuKey.value = ''; load() } })
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
.nt-set{border:none;background:none;color:var(--t3);font-size:11px;cursor:pointer;padding:0 2px;flex:0 0 auto}
.nt-set:hover{color:var(--p-dark)}
.nt-ctl{margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-subtle);display:flex;flex-direction:column;gap:6px}
.nt-ctl-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.nt-ctl-lb{font-size:11px;color:var(--t3);flex:0 0 auto;min-width:52px}
.nt-ctl-note{margin:0;font-size:11px;color:var(--t3);line-height:1.5}
.nt-chip{height:24px;padding:0 9px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg);color:var(--t2);font-size:11px;cursor:pointer}
.nt-chip:hover{border-color:var(--p-border);color:var(--p-dark)}
.nt-chip.is-on{background:var(--p-bg);border-color:var(--p-border);color:var(--p-dark)}
.nt-fold{margin:2px 0 0;font-size:11px;line-height:1.6;color:var(--t3);background:var(--bg2);border-radius:8px;padding:8px 10px}
.nt-link{border:none;background:none;color:var(--p-dark);font-size:11px;cursor:pointer;padding:0 2px}
.nt-link:disabled{opacity:.6;cursor:default}
.nt-s{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-subtle)}
.nt-s:last-child{border-bottom:none}
.nt-s-main{flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nt-s-main b{font-size:12.5px;font-weight:500;color:var(--t1)}
.nt-s-st{font-size:11px;color:var(--t3);background:var(--bg2);padding:2px 7px;border-radius:6px}
.nt-s-pend{font-size:11px;color:var(--warn-amber);background:var(--warn-amber-bg);padding:2px 7px;border-radius:6px}
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
