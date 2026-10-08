<template>
  <div class="page">
    <!-- 🔴 v396（2026-10-08）**退役模块内页签**（老板 Q3 A）：
         原来这里铺一排固定页签（员工/客户/供应商/品牌/商品/仓库/渠道与价格），
         点侧栏任何一条进来都会看到**整组** ⇒ 正是老板说的
         「点一个字段，把整个模块的所有标签全展示出来」。
         现在各自成为一个**标签**（对齐舟谱「点一个开一个」）：侧栏「档案管理」
         弹窗里 7 个条目各开一个标签（`Shell.vue` 的 `NAV` 已齐），
         页内不再有页签条。

         ⚠️ 下方 `TABS` / `tabs` + 兜底 `watch` **必须保留** —— 它们退役后唯一的用途是
            「落在不可见页签时自动落到第一个可见页」（v332 必修项）：
            `/archive/employees` 要 `hr` 模块，没有 `hr` 的角色（如主管）一进来就落在
            不可见页上；删掉兜底 = 页签没了、面板也空白，用户只会报「档案管理打不开」。 -->
    <div class="archive-panel">
      <EmployeeArchive v-if="activeTab === 'employees'" />
      <CustomerArchive v-if="activeTab === 'customers'" />
      <BrandArchive v-if="activeTab === 'brands'" />
      <ProductArchive v-if="activeTab === 'products'" />
      <WarehouseArchive v-if="activeTab === 'warehouses'" />
      <!-- v387（2026-10-06）批次 1.2：供应商档案 = 第 7 个页签 -->
      <SupplierArchive v-if="activeTab === 'suppliers'" />
      <PriceChannels v-if="activeTab === 'prices'" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmployeeArchive from './EmployeeArchive.vue'
import CustomerArchive from './CustomerArchive.vue'
import BrandArchive from './BrandArchive.vue'
import ProductArchive from './ProductArchive.vue'
import WarehouseArchive from './WarehouseArchive.vue'
// v387（2026-10-06）批次 1.2：供应商档案（`contacts.type='supplier'`）—— 第 7 个页签。
//   它装的不是新数据：生产 tenant_1 早有 **38 家供应商**（舟谱导入进来的），
//   只是**一直没有页面**能看/能改它们 ⇒ 本页是"补入口"，不是"新功能"。
import SupplierArchive from './SupplierArchive.vue'
// v311：渠道与价格并入本容器当第 6 个页签（侧栏不再单列）。见模板里那段门禁说明。
import PriceChannels from './PriceChannels.vue'
import { canSee } from '../constants/pages'

const route = useRoute()
const router = useRouter()

function tabFromPath(p) {
  if (p.endsWith('/products')) return 'products'
  if (p.endsWith('/brands')) return 'brands'
  if (p.endsWith('/warehouses')) return 'warehouses'
  // v387（2026-10-06）：`/archive/suppliers` 必须在这里登记，否则**刷新该 URL 会静默
  //   落回「员工档案」页签**（URL 与内容对不上，且没有任何报错）。
  //   ⚠️ 判据顺序：`/suppliers` 与 `/customers` 互不冲突，但两者都必须排在最后那行
  //      `return ... ? 'customers' : 'employees'` **之前** —— 那行是兜底分支。
  if (p.endsWith('/suppliers')) return 'suppliers'
  // v311：`/archive/prices` —— 顺序无所谓（各分支互斥），但必须在这里登记，
  //   否则刷新 `/archive/prices` 会静默落回「员工档案」页签（URL 与内容对不上）。
  if (p.endsWith('/prices')) return 'prices'
  return p.endsWith('/customers') ? 'customers' : 'employees'
}

const activeTab = ref(tabFromPath(route.path))

watch(() => route.path, (p) => { activeTab.value = tabFromPath(p) })

function goTab(t) {
  activeTab.value = t
  const target = '/archive/' + t
  if (route.path !== target) router.replace(target)
}

/* v332（2026-09-29）：页签的定义表 —— **顺序 = 用户心智顺序**（人 → 客户 → 品牌 → 商品
   → 仓库 → 价格），不要按模块分组重排；`path` 必须与 `constants/pages.js` 的登记行逐条对应
   （那是可见性的唯一源，这里只负责渲染）。
   v387（2026-10-06）：插入「供应商档案」。位置 = **客户档案之后**（第 3 位）——
   与「客户 / 供应」成对的心智顺序一致（都是"往来单位"），且**排在品牌/商品之前**：
   供应商是品牌与商品的上游（你在哪个品牌下有什么商品，取决于你从哪家进货）。
   ⚠️ 改动本表**必须**同批确认三处：本表 / `pages.js` 的 `/archive/suppliers` 行 /
   `router/index.js` 的 `archive.children` —— 缺任一处即「假入口」或「假封锁」。 */
const TABS = [
  { key: 'employees',  path: '/archive/employees',  label: '员工档案' },
  { key: 'customers',  path: '/archive/customers',  label: '客户档案' },
  { key: 'suppliers',  path: '/archive/suppliers',  label: '供应商档案' },
  { key: 'brands',     path: '/archive/brands',     label: '品牌档案' },
  { key: 'products',   path: '/archive/products',   label: '商品档案' },
  { key: 'warehouses', path: '/archive/warehouses', label: '仓库档案' },
  // v311：渠道与价格并入本容器（侧栏不再单列）。它**必须**带门禁 —— 本容器比它宽：
  //   `/archive` 对 BIZ_ROLES（含 主管 / 业务员）开放，而价格只给 老板 / 管理员 / 会计。
  //   三层同源（本表 + `pages.js::/archive/prices` + 路由守卫）⇒ 手敲 URL 也进不去。
  { key: 'prices',     path: '/archive/prices',     label: '渠道与价格' }
]
const tabs = computed(() => TABS.filter(t => canSee(t.path)))

/* v332：兜住「落在不可见页签上」这一种状态。
   🔴 它**不是**防御性代码，是必修：`/archive` 的路由 redirect 是**写死**
      `/archive/employees` 的，而员工档案要 `hr` 模块 —— 没有 `hr` 的角色（如主管）
      一进来就落在**不可见**的页签上：页签条一个都不渲染、面板空白，用户只会报「档案管理打不开」。
   这里把它落到第一个可见页签。v341 起容器门槛改为 `module:'data'`，故只要能进本容器（持 data）
   就至少能看到「品牌档案 / 商品档案 / 供应商档案 / 渠道与价格」四个 data 页签，`tabs` 不会为空；
   真为空时**不 replace**，以免把用户推进重定向死循环。 */
watch(tabs, (list) => {
  if (!list.length) return
  if (!list.some(t => t.key === activeTab.value)) goTab(list[0].key)
}, { immediate: true })
</script>

<style scoped>
/* v396：`.module-tabs` 的样式块已随页签条一起删除（净删除，无迁移遗漏）。
   ⚠️ 它本就是 UI-SPEC §6.2「同一视觉语言不写第二份」的一处历史欠账 ——
      全站页签早已统一用全局 `.main-tabs`，本页私有的这份从来就是重复；
      而全局 `.main-tabs` 本轮也退出了这些模块（改由标签栏承担）。 */
.archive-panel :deep(.page) { padding: 0; margin: 0; }
/* 嵌入时隐藏子页面各自标题，避免与父级 tab 重复。
   ⚠️ 2026-09-13 真机 E2E 修正：原规则 `.page-hd{display:none}` 把**整块**页头藏了，
   而各子页面的**操作按钮**恰好就在 `.page-hd`（.split 变体）里面 ——
   于是 商品档案的「补进价 / 新增 / 导入 / 导出」、员工与客户档案的「同步」全都点不到
   （`Archive.vue` 自 2026-08-31 引入 tab 壳起一直如此）。改法：只藏标题块，保留工具条并右对齐。 */
.archive-panel :deep(.page-hd) { display: none; }
.archive-panel :deep(.page-hd.split) { display: flex; justify-content: flex-end; margin: 0 0 12px; }
.archive-panel :deep(.page-hd.split > div:first-child) { display: none; }
</style>
