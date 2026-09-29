<template>
  <div class="page">
    <div class="module-tabs">
      <!-- v332（2026-09-29）：页签改为**按可见性判据生成**（下方 `tabs`），不再是 5 个裸按钮。
           🔴 不过滤的后果就是本项目定义的**假入口**：本容器的门槛比页签宽
              （`/archive` 走 `moduleAny`：hr/crm/data/stock 任一可用即显示这一项），
              而每个页签各属一个模块 —— 员工→`hr`、客户→`crm`、品牌/商品→`data`、仓库→`stock`。
              于是「侧栏有『档案管理』、点『员工档案』却报权限不足」（2026-09-29 主管与会计的原报障）。
           ⚠️ 判据仍是 `canSee(path)`（唯一源 = `constants/pages.js`），不在这里另写一份。 -->
      <button v-for="t in tabs" :key="t.key"
              :class="{ on: activeTab === t.key }" @click="goTab(t.key)">{{ t.label }}</button>
    </div>

    <div class="archive-panel">
      <EmployeeArchive v-if="activeTab === 'employees'" />
      <CustomerArchive v-if="activeTab === 'customers'" />
      <BrandArchive v-if="activeTab === 'brands'" />
      <ProductArchive v-if="activeTab === 'products'" />
      <WarehouseArchive v-if="activeTab === 'warehouses'" />
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
// v311：渠道与价格并入本容器当第 6 个页签（侧栏不再单列）。见模板里那段门禁说明。
import PriceChannels from './PriceChannels.vue'
import { canSee } from '../constants/pages'

const route = useRoute()
const router = useRouter()

function tabFromPath(p) {
  if (p.endsWith('/products')) return 'products'
  if (p.endsWith('/brands')) return 'brands'
  if (p.endsWith('/warehouses')) return 'warehouses'
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

/* v332（2026-09-29）：六个页签的定义表 —— **顺序 = 用户心智顺序**（人 → 客户 → 品牌 → 商品
   → 仓库 → 价格），不要按模块分组重排；`path` 必须与 `constants/pages.js` 的登记行逐条对应
   （那是可见性的唯一源，这里只负责渲染）。 */
const TABS = [
  { key: 'employees',  path: '/archive/employees',  label: '员工档案' },
  { key: 'customers',  path: '/archive/customers',  label: '客户档案' },
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
   这里把它落到第一个可见页签。`tabs` 为空不会发生（父级 `moduleAny` 保证至少一个模块可用）；
   真为空时**不 replace**，以免把用户推进重定向死循环。 */
watch(tabs, (list) => {
  if (!list.length) return
  if (!list.some(t => t.key === activeTab.value)) goTab(list[0].key)
}, { immediate: true })
</script>

<style scoped>
.module-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--bd);
  padding-bottom: 2px;
}
.module-tabs button {
  border: none;
  background: transparent;
  color: var(--t2);
  font-size: 14px;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
  position: relative;
}
.module-tabs button:hover { color: var(--p); }
.module-tabs button.on { color: var(--p); font-weight: 600; }
.module-tabs button.on::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -3px;
  height: 2px;
  background: var(--p);
  border-radius: 2px;
}
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
