<template>
  <ReportUnavailable
    :title="title"
    :module-name="title"
    :detail="'该市场营销模块的页面已落地并纳入权限门禁，对应业务功能将在进销存 / 市场运营模块成熟、产生数据后启用。'"
  />
</template>

<script setup>
/* 市场营销区「诚实空态」通用页（v638）：/mkt 23 页中 20 个后端暂无数据表，
   全部复用本组件，按路由 meta.title 显示对应模块名，绝不编造数据。 */
import { useRoute } from 'vue-router'
import ReportUnavailable from '../../components/ReportUnavailable.vue'

const route = useRoute()
const title = route.meta && route.meta.title ? route.meta.title : '市场营销模块'
</script>
