<template>
  <!-- 容器 = 页内二级导航 + 子路由出口。
       🔴 为什么容器自己就是 `.page`（而不是像 `ArchiveShell` 那样只有一个 `<router-view/>`）：
          进销存的 8 个页面里，**页签条属于容器、页头属于各页**。
          若让子页各自再套一层 `.page`，就会出现 `.page` 嵌套（padding 叠加），
          只能靠 `Archive.vue` 那种 `:deep(.page){padding:0}` 反打补丁 —— 多一处补丁多一处漂移。
          这里改为：**容器给页面宽度与页签条，子页只给页头与内容**，结构上不存在嵌套。
       ⚠️ 页签用的是全站唯一的 `.main-tabs` / `.main-tab`（UI-SPEC 明令禁止再写第二份）。
          旧壳与本仓的 `Archive.vue` / `Forecast.vue` 各自带一份 scoped `.module-tabs`
          是**历史重复**；新页面不再增加第三份。 -->
  <div class="page page-default">
    <div class="main-tabs">
      <button v-for="t in TABS" :key="t.key" class="main-tab"
              :class="{ on: activeTab === t.key }" @click="goTab(t)">{{ t.label }}</button>
    </div>

    <router-view />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

/* 页签定义表。
   🔴 `path` 必须与 `router/index.js` 里 `inventory.children` 的前缀一一对应 ——
      三处同源：本表（渲染）/ `router` children（可达）/ `constants/pages.js` 的
      `/inventory` 行（**可见性唯一源**，本表与 children 都不判可见性）。
   ⚠️ 本表**刻意不列**「新建采购单 / 采购单详情 / 新建销售单 / 销售单详情」四个页面：
      它们是列表页的下钻/创建态，仍在所属页签下（见 `tabFromPath`），
      再挂一个页签等于把「一次任务」拆成两个并列入口。 */
const TABS = [
  { key: 'workbench', path: '/inventory',         label: '工作台' },
  { key: 'purchase',  path: '/inventory/purchase', label: '采购单' },
  { key: 'sale',      path: '/inventory/sale',     label: '销售单' },
  { key: 'stock',     path: '/inventory/stock',    label: '库存查询' },
]

/* 当前页签由**路径**决定（不是本地状态）⇒ 刷新 / 深链 / 浏览器前进后退都自洽。
   ⚠️ 判据顺序：`/inventory/purchase` 与 `/inventory/sale` 互不冲突，但都必须排在
      兜底分支（工作台）之前；漏登记一个前缀就会静默落回「工作台」（URL 与内容对不上）。 */
function tabFromPath(p) {
  if (p.startsWith('/inventory/purchase')) return 'purchase'
  if (p.startsWith('/inventory/sale')) return 'sale'
  if (p.startsWith('/inventory/stock')) return 'stock'
  return 'workbench'
}

const activeTab = computed(() => tabFromPath(route.path))

function goTab(t) {
  if (route.path === t.path) return
  router.push(t.path)
}
</script>
