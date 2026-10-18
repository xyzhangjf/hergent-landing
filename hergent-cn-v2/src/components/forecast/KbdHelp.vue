<script setup>
/* ---- v603：键盘快捷键说明：从「表格下方独占一行的折叠链接」改成「页脚右侧小胶囊 + 点开浮层」 ----
   诉求（用户原话）：键盘快捷键能否不要占一行，放在一个更合适的位置。

   🔴 为什么原来那个位置两个问题一起犯
     ① **占一整行**：`.kbd-help` 是 `.edit-hint` 里独立的一块，折叠态也照样占一行高度；
        展开态更狠 —— 15 条按 `minmax(240px,1fr)` 铺成 4~5 行，把表体直接顶上去。
     ② **全屏看不见**：`.edit-hint` 是 `.grid-area` 的**兄弟**（在 card 里、grid-area 外），
        而全屏层 `.grid-area.is-fs{position:fixed;inset:0}` 盖住整个视口 ⇒ 全屏改单时这个入口不存在。
        而「全屏改单」恰恰是最需要快捷键的场景。

   🔴 为什么挂页脚 `.edit-summary`（而不是工具栏）
     · 页脚行**本来就存在**（合计/下单金额/冲刺胶囊），加一个 20px 胶囊是零新增行；
     · 它在 `.grid-area` **内部** ⇒ 全屏/非全屏同一份 DOM，不需要任何全屏专属分支（v584 教训）；
     · 工具栏 `.grid-ctl-row` 非全屏已经接近满宽（v209 实测塞编辑组差 273px），再加一个按钮
       必然折行 ⇒ 反而多占一行，与诉求相反。

   🔴 尺寸纪律：高度锁 20px、与 `.sprint-chip` 同高（v575：页脚是 21px 行，任何元素不得把它顶高）。

   ⚠️ 浮层同 SprintChip 定式（v588）：Teleport 到 body + position:fixed + z-index 1250
      （> `--z-page-fs` 1000）⇒ 全屏层里照样浮在最上面；水平居中、垂直锚触发器向上弹。
      `transform` 会创建 containing block ⇒ 浮层内**不得**再放 position:fixed/sticky 子元素。 */
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Icon from '../Icon.vue'

const SEEN_KEY = 'forecast_kbd_help_seen'

/* 内容按「使用场景」分四组，而不是平铺 15 条：
   老板不会通读，他是在「想填一片格子」的那一刻找那一条。分组让他在三秒内定位。 */
const GROUPS = [
  {
    t: '移动',
    items: [
      { k: ['Enter', 'Shift+Enter'], d: '下一格 / 上一格' },
      { k: ['Tab', 'Shift+Tab'], d: '右一格 / 左一格（行末自动换行）' },
      { k: ['↑', '↓', '←', '→'], d: '换格；正在改数字时 = 在格内移光标' },
      { k: ['F2'], d: '进入输入态（光标停末尾，改一位数字不用整格重打）' },
      { k: ['Home', 'End'], d: '行首 / 行尾' },
      { k: ['PgUp', 'PgDn'], d: '上 / 下翻页' },
      { k: ['Ctrl+↑', 'Ctrl+↓'], d: '跳到本列连续数据的首 / 尾' },
    ],
  },
  {
    t: '选中',
    items: [
      { k: ['Ctrl+A'], d: '全选整表（正在改数字时 = 选中本格文字）' },
      { k: ['Shift+方向键'], d: '从当前格向外扩选' },
      { k: ['点行号'], d: '选中整行（按住上下拖动可连选）' },
      { k: ['点表头'], d: '选中整列（按住左右拖动可连选）' },
      { k: ['右键'], d: '全选 / 复制 / 清空 / 插入删除行列 / 按安全库存补齐' },
    ],
  },
  {
    t: '批量填写',
    items: [
      { k: ['Ctrl+C', 'Ctrl+X', 'Ctrl+V'], d: '复制 / 剪切 / 粘贴（可直接从 Excel 粘一块进来）' },
      { k: ['Ctrl+D'], d: '向下填满选区（源 = 当前格）' },
      { k: ['Ctrl+R'], d: '向右填满选区（源 = 选区最左列）' },
      { k: ['拖右下角圆点'], d: '沿拖动方向线性填充（横向只铺数量区）' },
      { k: ['双击圆点'], d: '填到「本期已报数量」的最后一行' },
      { k: ['Ctrl+Enter'], d: '把当前值填满整个选区' },
      { k: ['Delete'], d: '清空选区' },
      { k: ['Ctrl+Z', 'Ctrl+Y'], d: '撤销 / 重做' },
    ],
  },
  {
    t: '定位与其他',
    items: [
      { k: ['Ctrl+G'], d: '跳转：输行号 / 商品名 / 条码 / 客户名' },
      { k: ['双击列边界'], d: '列宽自适应内容' },
      { k: ['Esc'], d: '放弃本格修改（还原成进格前的值）；不在编辑时 = 取消选中' },
    ],
  },
]

const chipRef = ref(null)
const popRef = ref(null)
const open = ref(false)
const popStyle = ref({})

function place () {
  const el = chipRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  const maxH = Math.min(Math.round(vh * 0.78), 540)
  /* 页脚在视口底部 ⇒ 向上弹；只有在视口上半部（页面很短）才向下弹，避免顶出屏幕。 */
  const up = r.top > maxH + 16
  popStyle.value = {
    left: '50%',
    transform: 'translateX(-50%)',
    maxHeight: maxH + 'px',
    ...(up ? { bottom: (vh - r.top + 8) + 'px' } : { top: (r.bottom + 8) + 'px' }),
  }
}

function doOpen () {
  if (open.value) return
  open.value = true
  try { localStorage.setItem(SEEN_KEY, '1') } catch (e) {}
  nextTick(place)
}
function close () { open.value = false }
function toggle () { open.value ? close() : doOpen() }

function onDocClick (e) {
  if (!open.value) return
  const t = e.target
  if (chipRef.value && chipRef.value.contains(t)) return
  if (popRef.value && popRef.value.contains(t)) return
  close()
}
/* Esc 关闭：必须**捕获阶段** + stopPropagation。
   表格的 Esc（放弃本格修改）挂在 `<table @keydown>` 上，冒泡阶段晚于本监听；
   若只在冒泡里关浮层，用户按一次 Esc 会「关浮层 + 顺手把正在改的格还原」两件事一起发生。 */
function onEsc (e) {
  if (!open.value || e.key !== 'Escape') return
  e.preventDefault(); e.stopPropagation(); close()
}
function onViewportChange () {
  if (!open.value) return
  const el = chipRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  /* 页脚被滚出视口（长表滚动）时浮层留在屏幕上会像"无主弹窗" ⇒ 直接收起。 */
  if (r.bottom < 4 || r.top > window.innerHeight - 4) { close(); return }
  place()
}

onMounted(() => {
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
  document.addEventListener('keydown', onEsc, true)
  document.addEventListener('click', onDocClick)
  /* 首次进入编辑自动展开一次（沿用原 Q28 行为：这些能力不教就永远没人用）。
     但只在胶囊**当前可见**时才自动弹 —— 页脚在首屏之下时弹出来会是"屏幕底部飞出个框"。 */
  let seen = false
  try { seen = localStorage.getItem(SEEN_KEY) === '1' } catch (e) {}
  if (!seen) {
    nextTick(() => {
      const el = chipRef.value
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.top > 0 && r.bottom < window.innerHeight) doOpen()
    })
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
  document.removeEventListener('keydown', onEsc, true)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <span
    ref="chipRef"
    class="kbd-chip"
    :class="{ on: open }"
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-expanded="open"
    aria-label="键盘快捷键（点开查看全部）"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <Icon name="keyboard" :size="13" />
    <span class="kc-txt">快捷键</span>
  </span>

  <Teleport to="body">
    <div v-if="open" ref="popRef" class="kbd-pop" :style="popStyle" role="dialog" aria-label="键盘快捷键" @click.stop>
      <div class="kp-hd">
        <b><Icon name="keyboard" /> 键盘快捷键</b>
        <span class="kp-esc">按 <kbd>Esc</kbd> 关闭</span>
        <button class="kp-x" aria-label="关闭" @click="close"><Icon name="close" /></button>
      </div>
      <div class="kp-grid">
        <section v-for="g in GROUPS" :key="g.t">
          <h4>{{ g.t }}</h4>
          <p v-for="(it, i) in g.items" :key="i">
            <span class="kp-keys">
              <template v-for="(k, j) in it.k" :key="j">
                <kbd>{{ k }}</kbd><i v-if="j < it.k.length - 1" class="kp-slash">/</i>
              </template>
            </span>
            <span class="kp-desc">{{ it.d }}</span>
          </p>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 胶囊：与 .sprint-chip 同高同圆角（页脚 21px 行不得被顶高）。 */
.kbd-chip{
  display:inline-flex;align-items:center;gap:5px;
  height:20px;padding:0 9px;
  border:1px solid var(--bd);border-radius:999px;
  background:var(--bg2);color:var(--t2);
  font-size:12px;line-height:18px;white-space:nowrap;
  cursor:pointer;user-select:none;align-self:center;
  transition:background .15s ease,border-color .15s ease,color .15s ease;
}
.kbd-chip:hover,
.kbd-chip.on{border-color:var(--p);background:var(--p-bg);color:var(--t1)}
.kbd-chip:focus-visible{outline:2px solid var(--p);outline-offset:1px}
.kbd-chip .kc-txt{display:inline-flex;align-items:center}

/* 浮层：fixed + Teleport（页脚祖先一旦 overflow:hidden 也不会裁它）；
   z-index 1250 > --z-page-fs(1000) ⇒ 全屏层里也在最上面，且低于模态遮罩类。 */
.kbd-pop{
  position:fixed;z-index:1250;
  left:50%;transform:translateX(-50%);
  width:min(860px,calc(100vw - 24px));
  overflow:auto;overscroll-behavior:contain;
  padding:12px 14px 14px;
  background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius);
  box-shadow:0 12px 32px rgba(15,23,42,.18);
}
.kp-hd{display:flex;align-items:center;gap:8px;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid var(--bd)}
.kp-hd b{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:var(--t1)}
.kp-hd svg.ico{width:15px;height:15px;vertical-align:-2px}
.kp-esc{margin-left:auto;font-size:11px;color:var(--t3);display:inline-flex;align-items:center;gap:4px}
.kp-x{border:0;background:transparent;color:var(--t3);cursor:pointer;padding:2px;display:inline-flex;border-radius:6px}
.kp-x:hover{background:var(--bg2);color:var(--t1)}
.kp-x svg.ico{width:14px;height:14px}

.kp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 26px}
@media (max-width:760px){.kp-grid{grid-template-columns:minmax(0,1fr)}}
.kp-grid section{min-width:0}
.kp-grid h4{
  margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:.4px;
  color:var(--t3);text-transform:none;
}
.kp-grid p{display:flex;align-items:baseline;gap:8px;margin:0;padding:2px 0;font-size:12px;color:var(--t2);line-height:1.55}
.kp-keys{flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;min-width:96px}
.kp-keys kbd{
  display:inline-block;padding:0 5px;
  border:1px solid var(--bd);border-bottom-width:2px;border-radius:4px;
  background:var(--bg2);font-family:var(--mono,ui-monospace,monospace);
  font-size:11px;line-height:16px;color:var(--t1);white-space:nowrap;
}
.kp-slash{font-style:normal;color:var(--t3);font-size:10px}
.kp-desc{color:var(--t2);min-width:0}
</style>
