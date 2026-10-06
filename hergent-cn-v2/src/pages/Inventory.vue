<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>进销存</h2>
        <span class="page-sub">老板自研 · 开发闸门开启中，当前仅你可见</span>
      </div>
    </div>

    <div class="card">
      <div class="panel-hd"><b>能力闸门 · 脚手架就绪</b></div>
      <p class="inv-tip">
        这一页是「进销存」的占位骨架，用来验证<b>只有老板账号能看到、其他人都看不到</b>这个门禁。
        真正的业务模块（采购 / 销售 / 库存 / 往来账 等）会在下一步梳理设计后，逐块填进来。
      </p>

      <div class="inv-grid">
        <div class="inv-cell">
          <div class="inv-k">当前登录角色</div>
          <div class="inv-v">{{ meta ? (meta.role || '未知') : '读取中…' }}</div>
        </div>
        <div class="inv-cell">
          <div class="inv-k">模块归属</div>
          <div class="inv-v">{{ meta ? (meta.label || '进销存') : '—' }}</div>
        </div>
        <div class="inv-cell">
          <div class="inv-k">闸门状态</div>
          <div class="inv-v" :class="gateOk ? 'inv-ok' : 'inv-bad'">
            {{ gateOk ? '已放行（你持有「进销存」权限）' : gateErr || '校验中…' }}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="panel-hd"><b>下一步</b></div>
      <p class="inv-tip">
        骨架搭好后，我会结合你（蒙牛低温奶经销商）的真实业务，梳理进销存要做的模块、
        每个模块的用途与优先级，并画一张整体信息架构与页面布局的原型图。
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api/client'

const meta = ref(null)
const gateOk = ref(false)
const gateErr = ref('')

onMounted(async () => {
  try {
    const res = await api('/api/psi/meta')
    meta.value = res
    gateOk.value = !!(meta.value && meta.value.ok)
  } catch (e) {
    // 其余角色根本进不到这一页（前端入口已按 pages.js 收起 + 守卫拦深链）；
    // 万一绕过，这里会拿到 403，如实显示「无权限」而不是静默空白。
    const status = Number((e && e.status) || 0)
    if (status === 403) {
      gateErr = '你的角色没有「进销存」权限（403）'
    } else if (status === 401) {
      gateErr = '未登录（401）'
    } else {
      gateErr = '接口不可达（' + status + '）'
    }
  }
})
</script>

<style scoped>
.inv-tip { color: var(--t2); font-size: 13px; line-height: 1.7; margin: 4px 0 14px; }
.inv-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.inv-cell { background: var(--bg2); border: 1px solid var(--bd); border-radius: 10px; padding: 12px 14px; }
.inv-k { color: var(--t2); font-size: 12px; margin-bottom: 6px; }
.inv-v { color: var(--t1); font-size: 15px; font-weight: 500; }
.inv-ok { color: #16a34a; }
.inv-bad { color: #dc2626; }
@media (max-width: 720px) { .inv-grid { grid-template-columns: 1fr; } }
</style>
