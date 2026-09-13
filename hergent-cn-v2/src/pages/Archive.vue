<template>
  <div class="page">
    <div class="module-tabs">
      <button :class="{ on: activeTab === 'employees' }" @click="goTab('employees')">员工档案</button>
      <button :class="{ on: activeTab === 'customers' }" @click="goTab('customers')">客户档案</button>
      <button :class="{ on: activeTab === 'brands' }" @click="goTab('brands')">品牌档案</button>
      <button :class="{ on: activeTab === 'products' }" @click="goTab('products')">商品档案</button>
    </div>

    <div class="archive-panel">
      <EmployeeArchive v-if="activeTab === 'employees'" />
      <CustomerArchive v-if="activeTab === 'customers'" />
      <BrandArchive v-if="activeTab === 'brands'" />
      <ProductArchive v-if="activeTab === 'products'" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmployeeArchive from './EmployeeArchive.vue'
import CustomerArchive from './CustomerArchive.vue'
import BrandArchive from './BrandArchive.vue'
import ProductArchive from './ProductArchive.vue'

const route = useRoute()
const router = useRouter()

function tabFromPath(p) {
  if (p.endsWith('/products')) return 'products'
  if (p.endsWith('/brands')) return 'brands'
  return p.endsWith('/customers') ? 'customers' : 'employees'
}

const activeTab = ref(tabFromPath(route.path))

watch(() => route.path, (p) => { activeTab.value = tabFromPath(p) })

function goTab(t) {
  activeTab.value = t
  const target = '/archive/' + t
  if (route.path !== target) router.replace(target)
}
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
   于是 商品档案的「补厂价 / 新增 / 导入 / 导出」、员工与客户档案的「同步」全都点不到
   （`Archive.vue` 自 2026-08-31 引入 tab 壳起一直如此）。改法：只藏标题块，保留工具条并右对齐。 */
.archive-panel :deep(.page-hd) { display: none; }
.archive-panel :deep(.page-hd.split) { display: flex; justify-content: flex-end; margin: 0 0 12px; }
.archive-panel :deep(.page-hd.split > div:first-child) { display: none; }
</style>
