<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>开放API 控制台</h2>
        <span class="page-sub">自助管理 API 令牌，把 Hergent 数据对接到您的系统或第三方</span>
      </div>
    </div>

    <Skeleton v-if="loadingInfo" />

    <template v-else>
      <!-- 接入说明 -->
      <div class="card sec">
        <div class="sec-hd"><span>如何调用</span></div>
        <ul class="doc-list">
          <li><b>接口基地址</b>：<code>{{ baseUrl }}</code></li>
          <li><b>鉴权方式</b>：在请求头带上 <code>X-API-Token: &lt;您的令牌&gt;</code>，即以当前租户身份调用。</li>
          <li><b>当前权限范围</b>：<code>{{ (info.scopes || []).join('、') || 'read' }}</code>（只读）。令牌仅对您自己的租户数据有效，跨租户隔离。</li>
          <li><b>注意</b>：令牌明文仅在创建时展示一次，请立即复制保存；遗失可吊销后重新创建。</li>
        </ul>
      </div>

      <!-- 令牌管理 -->
      <div class="card sec">
        <div class="sec-hd split">
          <span>我的令牌</span>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="showCreate = !showCreate">
            <Icon name="plus" :size="14" />新建令牌
          </button>
        </div>

        <div v-if="showCreate" class="create-box">
          <div class="fld">
            <label>名称</label>
            <input v-model="newName" class="inp" maxlength="40" placeholder="如：我的ERP对接" />
          </div>
          <div class="fld">
            <label>有效期（天）</label>
            <input v-model.number="newDays" class="inp" type="number" min="1" max="3650" />
          </div>
          <div class="fld acts">
            <button class="btn btn-primary btn-sm" :disabled="busy" @click="createToken">创建</button>
            <button class="btn btn-ghost btn-sm" @click="showCreate = false">取消</button>
          </div>
        </div>

        <div v-if="createdToken" class="token-flash">
          <Icon name="check" :size="14" /> 令牌已创建，请立即复制保存（仅显示一次）：
          <code class="tk">{{ createdToken }}</code>
          <button class="btn btn-ghost btn-sm" @click="copy(createdToken)">复制</button>
        </div>

        <div v-if="tokens.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr><th>名称</th><th>创建时间</th><th>过期时间</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in tokens" :key="t.id">
                <td>{{ t.name }}</td>
                <td>{{ t.created_at }}</td>
                <td>{{ t.expires_at || '长期' }}</td>
                <td>
                  <span :class="['badge', t.is_active ? 'on' : 'off']">{{ t.is_active ? '启用' : '已吊销' }}</span>
                </td>
                <td>
                  <button v-if="t.is_active" class="btn btn-ghost btn-sm danger" :disabled="busy" @click="revoke(t.id)">吊销</button>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">您还没有创建任何令牌。点击「新建令牌」生成一个，用于系统对接。</div>
      </div>

      <!-- 可用接口清单 -->
      <div class="card sec">
        <div class="sec-hd"><span>当前可用接口（只读）</span></div>
        <ul class="ep-list">
          <li v-for="ep in endpoints" :key="ep.p">
            <code>{{ ep.m }} {{ ep.p }}</code><span>{{ ep.d }}</span>
          </li>
        </ul>
        <p class="rpt-foot">更多写入类接口（创建订单、同步库存等）将随开放平台完善陆续开放。</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Skeleton from '../../components/Skeleton.vue'
import Icon from '../../components/Icon.vue'
import { openapiApi } from '../../api/modules.js'

const loadingInfo = ref(true)
const info = ref({})
const baseUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/api'
const tokens = ref([])
const showCreate = ref(false)
const newName = ref('')
const newDays = ref(365)
const createdToken = ref('')
const busy = ref(false)

const endpoints = [
  { m: 'GET', p: '/openapi/info', d: '获取接口信息与权限范围' },
  { m: 'GET', p: '/openapi/tokens', d: '列出当前租户的令牌' },
  { m: 'GET', p: '/reports/invoice-sales', d: '销项发票台账' },
  { m: 'GET', p: '/reports/invoice-purchase', d: '进项发票台账' },
  { m: 'GET', p: '/bi/pivot', d: '多维业务透视（营收/成本/毛利等）' },
  { m: 'GET', p: '/bi/top', d: '业务排名（客户/商品/品牌等）' },
]

async function loadInfo() {
  loadingInfo.value = true
  try {
    info.value = await openapiApi.info()
    await loadTokens()
  } catch (e) {
    info.value = {}
  } finally {
    loadingInfo.value = false
  }
}

async function loadTokens() {
  try {
    const d = await openapiApi.listTokens()
    tokens.value = (d && d.tokens) ? d.tokens : []
  } catch (e) {
    tokens.value = []
  }
}

async function createToken() {
  busy.value = true
  try {
    const d = await openapiApi.createToken({ name: newName.value || 'API 令牌', expires_days: newDays.value || 365 })
    createdToken.value = d.token
    newName.value = ''
    showCreate.value = false
    await loadTokens()
  } catch (e) {
    alert('创建令牌失败，请重试。')
  } finally {
    busy.value = false
  }
}

async function revoke(id) {
  if (!confirm('确定吊销该令牌？吊销后使用该令牌的对接将立即失效。')) return
  busy.value = true
  try {
    await openapiApi.revokeToken(id)
    await loadTokens()
  } catch (e) {
    alert('吊销失败，请重试。')
  } finally {
    busy.value = false
  }
}

function copy(t) {
  if (navigator.clipboard) navigator.clipboard.writeText(t)
}

onMounted(loadInfo)
</script>

<style scoped>
.sec { margin-top: 14px; }
.doc-list, .ep-list { margin: 0; padding: 4px 18px 14px; line-height: 2; }
.doc-list code, .ep-list code { background: var(--bg2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.ep-list li { display: flex; gap: 12px; flex-wrap: wrap; }
.ep-list li span { color: var(--t2); font-size: 13px; }
.create-box { display: flex; gap: 14px; align-items: flex-end; padding: 12px 18px; flex-wrap: wrap; }
.fld { display: flex; flex-direction: column; gap: 4px; }
.fld label { font-size: 12px; color: var(--t2); }
.inp { height: 30px; border: 1px solid var(--bd); border-radius: 6px; padding: 0 10px; background: var(--bg); color: var(--t1); min-width: 160px; }
.fld.acts { flex-direction: row; gap: 8px; }
.token-flash { margin: 0 18px 12px; padding: 10px 12px; background: var(--bg2); border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.token-flash .tk { font-family: monospace; color: var(--brand, #2f6bff); }
.badge { padding: 1px 8px; border-radius: 10px; font-size: 12px; }
.badge.on { background: rgba(46,160,67,.14); color: #2ea043; }
.badge.off { background: var(--bg2); color: var(--t2); }
.muted { color: var(--t2); }
.btn.danger { color: #e5484d; }
.rpt-foot { margin: 10px 18px 14px; font-size: 12px; color: var(--t2); }
</style>
