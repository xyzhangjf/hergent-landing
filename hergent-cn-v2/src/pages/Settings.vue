<template>
  <div class="page">
    <!-- 模块级标签页（沿用「预报订单管理」的 module-tabs 导航） -->
    <div class="module-tabs">
      <button :class="{ on: tab === 'account' }" @click="tab = 'account'">账号与组织</button>
      <button :class="{ on: tab === 'perm' }" @click="switchTab('perm')">权限</button>
      <button :class="{ on: tab === 'ai' }" @click="switchTab('ai')">AI 配置</button>
      <button :class="{ on: tab === 'aiops' }" @click="tab = 'aiops'">AI 运维</button>
      <button :class="{ on: tab === 'system' }" @click="tab = 'system'">数据与系统</button>
    </div>

    <!-- ==================== 账号与组织 ==================== -->
    <template v-if="tab === 'account'">
      <div class="card">
        <div class="panel-hd">
          <b>账号与组织</b>
          <span class="page-sub">当前登录账号与界面偏好</span>
        </div>
        <div class="set-row"><b class="set-lb">当前账号</b><span class="set-desc">{{ store.user.name || '—' }}</span></div>
        <div class="set-row">
          <b class="set-lb">界面主题</b>
          <button class="btn btn-sm btn-ghost" @click="toggleTheme">切换为 {{ store.ui.theme === 'light' ? '深色' : '浅色' }}</button>
        </div>
      </div>
    </template>

    <!-- ==================== 权限（仅角色权限矩阵；成员/账号归位「员工档案」） ==================== -->
    <template v-if="tab === 'perm'">
      <!-- v334：两种入口。默认「按角色配置」（对标舟谱：列表 → 点进某角色细配），
           旧的横向矩阵收进「批量总览」原样保留 —— 此前的使用习惯一点不变。 -->
      <div class="module-tabs perm-views">
        <button :class="{ on: permView === 'list' || permView === 'detail' }"
                @click="permView = 'list'">按角色配置</button>
        <button :class="{ on: permView === 'matrix' }" @click="permView = 'matrix'">批量总览</button>
      </div>

      <!-- ============ 视图一：角色列表（对标舟谱图 1）============ -->
      <template v-if="permView === 'list'">
        <div class="card">
          <div class="panel-hd">
            <b>角色与权限</b>
          </div>
          <table class="perm-role-table">
            <thead>
              <tr>
                <th class="pr-col-name">角色名称</th>
                <th class="pr-col-type">角色类型</th>
                <th class="pr-col-end">可登录</th>
                <th class="ctr">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in permRoles" :key="'rl-' + r.name">
                <td class="pr-name">{{ roleLabel(r.name) }}</td>
                <td>
                  <span class="pr-type" :class="{ custom: !isCanonicalRole(r.name) }">
                    {{ isCanonicalRole(r.name) ? '系统自带' : '自定义角色' }}
                  </span>
                </td>
                <td class="pr-end">{{ loginScopeLabel(endToScope(r.end)) }}</td>
                <td class="ctr">
                  <button class="btn btn-sm" @click="openRoleDetail(r.name)">配置权限</button>
                </td>
              </tr>
              <tr v-if="!permRoles.length">
                <td colspan="4" class="pr-empty">{{ permLoading ? '加载中…' : '没有可配置的角色' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ============ 视图二：单个角色的详情配置（对标舟谱图 2）============ -->
      <template v-if="permView === 'detail'">
        <div class="card toolbar">
          <div class="tb-group">
            <button class="btn btn-sm btn-ghost" @click="permView = 'list'">← 角色列表</button>
            <span class="tb-title">角色：{{ roleLabel(permDetailRole) }}</span>
          </div>
          <div class="tb-group tb-right">
            <button class="btn btn-sm btn-primary"
                    :disabled="permDetailSaving || permDetailLoading"
                    @click="saveRoleDetail">
              {{ permDetailSaving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <div class="card">
          <div class="panel-hd">
            <b>功能模块权限</b>
          </div>
          <div v-if="permDetailLoading" class="pr-empty">加载中…</div>
          <table v-else class="perm-detail-table">
            <thead>
              <tr>
                <th class="pd-mod">功能模块</th>
                <th v-for="a in permActions" :key="'ph-' + a" class="ctr" :title="permActionHints[a]">
                  {{ permActionLabels[a] }}
                </th>
                <th class="ctr">整行</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in groupedModules" :key="'dg-' + g.name">
                <tr class="pm-sec">
                  <td :colspan="permActions.length + 2">{{ g.name }}</td>
                </tr>
                <tr v-for="m in g.items" :key="'dm-' + m.id">
                  <td class="pd-mod">
                    <div class="pm-mod-lb">{{ m.label }}</div>
                    <div v-if="pageNamesFor(m).length" class="pm-mod-pages">对应页面：{{ pageNamesFor(m).join('、') }}</div>
                  </td>
                  <td v-for="a in permActions" :key="'pc-' + m.id + '-' + a" class="ctr">
                    <input type="checkbox"
                           :checked="!!(permDetail[m.id] || {})[a]"
                           @change="toggleDetail(m.id, a, $event)">
                  </td>
                  <td class="ctr">
                    <button class="btn btn-sm btn-ghost" @click="toggleRowAll(m.id)">
                      {{ rowAllOn(m.id) ? '取消整行' : '整行全选' }}
                    </button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <p class="pr-tip">
            一个模块四个勾都不勾 = 这个角色看不到这一块（侧栏入口与页内数据都会一起关掉）。
            勾了什么就真的生效什么：取消「查看」后，这个角色连这一块的数据都读不到。
          </p>
        </div>
      </template>

      <!-- ============ 视图三：旧的横向矩阵（批量总览，原样保留）============ -->
      <template v-if="permView === 'matrix'">
      <!-- 角色权限：角色 × 模块矩阵 -->
      <div class="card toolbar">
        <div class="tb-group">
          <span class="tb-title">角色权限</span>
        </div>
        <div class="tb-group tb-right">
          <div class="tb-search">
            <Icon name="search"/>
            <input v-model="moduleQuery" class="fld" placeholder="搜索模块…" aria-label="搜索模块">
          </div>
          <!-- v328 批次 ⑥：新建角色 / 全部恢复出厂。放在这里而不是工具栏最右侧，
               避免和「保存权限」挤成一排 —— 保存是高频动作，这两个是低频。 -->
          <button class="btn btn-sm" @click="newRoleOpen = !newRoleOpen"
                  title="拿一个现成角色做底子，另存成一个新角色">新建角色</button>
          <button class="btn btn-sm" @click="resetAllRoles"
                  title="把所有系统自带角色恢复成默认设置（自建角色不受影响）">全部恢复默认</button>
          <button class="btn btn-sm btn-primary" :disabled="permSaving || permLoading" @click="savePerms">
            {{ permSaving ? '保存中…' : '保存权限' }}
          </button>
        </div>
      </div>

      <div class="card">
        <!-- 使用说明：**默认收起**（v326，2026-09-29）。
             🔴 为什么收起：这里原先常驻 8 段「为什么这么设计」的实现说明 —— 版本号（v296/v311/v312）、
                模块键名、「角色门槛让位」规则、产品内置模块名单、两处归位……。
                那些是写给维护者的，不是写给老板的：它们不解释任何老板看得见的行为，
                却会被当成「系统坏了」的线索去读。⇒ 默认收起，只留一行入口。
             ⚠️ 留下来的两句仍是**功能的一部分**，不是装饰：权限页最容易犯的错是「许诺一件它兑现
                不了的事」—— 老板勾了模块、界面没变，就会认定系统坏了（而系统一声不吭）。
                所以只留两件事：什么时候生效 / 哪些账号会跟着变 ——
                全部业务语言，不带任何实现细节。
             ⚠️ v331c：原先还有第三句「手机端那列是什么」，随该只读列一起删掉了
                （列已不存在，留着就是解释一个看不见的东西）。 -->
        <button
          type="button"
          class="pm-help-tb"
          :aria-expanded="permHelpOpen ? 'true' : 'false'"
          @click="permHelpOpen = !permHelpOpen"
        >
          <Icon :name="permHelpOpen ? 'chevron-down' : 'chevron-right'"/>
          使用说明
        </button>
        <div v-if="permHelpOpen" class="pm-help">
          <p>保存后<b>立即生效</b>。已经存在的账号<b>不会被自动改动</b>；员工档案里会把这些账号
            标成「与角色配置不一致」，可一键按角色对齐。</p>
          <p>老板与管理员的「员工管理」「档案管理」为必选、不可取消 —— 防止把自己锁在门外。</p>
        </div>

        <!-- v328 批次 ⑥：新建角色的**内联**表单（不弹窗 —— 本页卡片内已有横向滚动的表格，
             再叠一层模态会让"在哪儿点"变成猜谜）。 -->
        <div v-if="newRoleOpen" class="pm-new">
          <div class="pm-new-row">
            <input v-model="newRoleName" class="fld pm-new-name" maxlength="16"
                   placeholder="新角色名，如「库管」" aria-label="新角色名">
            <select v-model="newRoleFrom" class="fld" aria-label="权限来源">
              <option value="">不复制，从空白开始</option>
              <option v-for="role in permRoles" :key="'nf-' + role.name" :value="role.name">
                复制「{{ roleLabel(role.name) }}」的权限
              </option>
            </select>
            <button class="btn btn-sm btn-primary" :disabled="permSaving" @click="createRole">创建</button>
            <button class="btn btn-sm" @click="newRoleOpen = false">取消</button>
          </div>
          <p class="pm-new-tip">创建后它立刻出现在下面的表格里，接着勾它的权限即可。
            名字最多 16 个字，不能和系统自带角色重名。</p>
        </div>

        <div v-if="permLoading" class="state-empty"><div class="skel-line" style="width:40%;margin:0 auto"></div></div>
        <div v-else-if="!filteredModules.length" class="state-empty">没有匹配的模块</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="pm-mod-col">权限项</th>
                <!-- v328：列头换成与员工档案**同一个短名**，补充职责走悬浮提示。 -->
                <th v-for="role in permRoles" :key="role.name" class="ctr"
                    :title="roleDuty(role.name) ? roleLabel(role.name) + '：' + roleDuty(role.name) : ''">
                  <div class="pm-col-hd">{{ roleLabel(role.name) }}</div>
                  <!-- v328 G4：**自定义角色的"让位盲区"** 必须写在脸上。
                       业务页（目标与返利 / 档案管理 / 货损…）的入口走**角色门槛**，自定义角色
                       不在任何门槛名单里 ⇒ 给它勾再多模块，那些页面也**不会多出来**。
                       这是刻意设计（防止"造一个角色就全开"），但**不说**客户就会认定权限没生效。
                       🔴 判据 = `isCanonicalRole(role.name)`（= 名字在 `ROLE_NAMES` 里），
                       **不是** `role.is_custom`（那是"本租户有覆盖行"，内置角色照样为 true ⇒
                       会把「主管」「业务员」都标成自定义角色，见 `backend-auth.md §2`），
                       **也不是** `role.is_default` —— 该字段后端确实下发（`role in _DEFAULT_PERMS`），
                       但 `loadPerms()` 的对象字面量**没搬它** ⇒ `undefined` ⇒ `!undefined` 恒真 ⇒
                       **每一列都标「自定义角色」**（2026-09-30 老板报障的原样）。
                       用 `name` 判就结构上不可能被这种"白名单漏搬字段"再咬一次。 -->
                  <div v-if="!isCanonicalRole(role.name)" class="pm-col-sub pm-col-custom"
                       >自定义角色</div>
                  <div v-if="role.end_is_custom" class="pm-col-sub">登录端已改</div>
                  <button
                    v-if="role.is_custom"
                    class="btn-mini"
                    @click="resetRole(role.name)"
                    title="恢复该角色的默认权限"
                  >恢复默认</button>
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- v312 第一条轴：**登录端** —— 这个角色的人可以从哪个端登录。
                   与下面的模块矩阵同表（列对齐），但语义完全不同：端 = 入口，模块 = 能力。 -->
              <tr class="pm-sec"><td :colspan="permRoles.length + 1">① 登录端 · 这个角色从哪儿登录</td></tr>
              <tr>
                <td class="pm-end-lb">允许使用电脑端（网页）</td>
                <td v-for="role in permRoles" :key="'ew-' + role.name" class="ctr">
                  <input
                    type="checkbox"
                    :checked="role.end.web"
                    :disabled="role.end_locked_web"
                    :title="role.end_locked_web ? '老板 / 管理员的电脑端不能关闭 —— 关掉后将无法进入后台改回来' : ''"
                    @change="toggleEnd(role, 'web', $event)"
                  >
                </td>
              </tr>
              <tr>
                <td class="pm-end-lb">允许使用手机端（小程序）</td>
                <td v-for="role in permRoles" :key="'em-' + role.name" class="ctr">
                  <input
                    type="checkbox"
                    :checked="role.end.mini"
                    @change="toggleEnd(role, 'mini', $event)"
                  >
                </td>
              </tr>
              <tr class="pm-end-sum">
                <td class="pm-end-lb">新账号的默认可登录端</td>
                <td v-for="role in permRoles" :key="'es-' + role.name" class="ctr">
                  <span class="pm-end-tag" :class="{ on: role.end_is_custom }">{{ loginScopeLabel(endToScope(role.end)) }}</span>
                  <button
                    v-if="role.end_is_custom"
                    class="btn-mini"
                    title="把该角色的登录端恢复为默认设置"
                    @click="resetRoleEnd(role)"
                  >恢复</button>
                </td>
              </tr>

              <tr class="pm-sec"><td :colspan="permRoles.length + 1">② 功能模块 · 这个角色能用哪些功能</td></tr>
              <!-- v328 批次 ⑥：按业务域分组渲染（组头可整组勾选）。 -->
              <template v-for="g in groupedModules" :key="g.name">
                <tr class="pm-grp">
                  <td class="pm-grp-lb">{{ g.name }}</td>
                  <td v-for="role in permRoles" :key="g.name + '-' + role.name" class="ctr">
                    <input
                      type="checkbox"
                      :checked="groupChecked(g, role)"
                      title="整组勾选 / 取消"
                      @change="toggleGroup(g, role, $event)"
                    >
                  </td>
                </tr>
                <tr v-for="m in g.items" :key="m.id">
                  <td class="pm-mod-cell">
                    <div class="pm-mod-lb">{{ m.label }}</div>
                    <!-- v333：这个勾选框管哪些**页面**。数据源 = 后端
                         `MODULE_IMPACT.entries`（由接口随模块表下发，见 `pageNamesFor`）——
                         **不是**前端再推一份映射：该表与 `pages.js` 的 `module` 由护栏
                         `role-registry-consistency-check.py` 逐项锁定，改一侧必同步另一侧。
                         老板是照页面名找开关的，模块名（"档案管理""销售管理"）对不上他认识的页面。 -->
                    <div v-if="pageNamesFor(m).length" class="pm-mod-pages">
                      对应页面：{{ pageNamesFor(m).join('、') }}
                    </div>
                  </td>
                  <td v-for="role in permRoles" :key="role.name + '-' + m.id" class="ctr">
                    <input
                      type="checkbox"
                      :checked="roleHas(role, m.id)"
                      :disabled="isLockedModule(role.name, m.id)"
                      :title="isLockedModule(role.name, m.id) ? '必选项，不可取消' : ''"
                      @change="togglePerm(role, m.id, $event)"
                    >
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      </template>
    </template>

    <!-- ==================== AI 配置 ==================== -->
    <template v-if="tab === 'ai'">
      <div class="card">
        <div class="panel-hd">
          <b>AI 副驾连接</b>
        </div>
        <div class="set-row">
          <button class="btn btn-sm btn-ghost" @click="test">测试连接</button>
          <span v-if="testResult" class="set-result" :class="testOk ? 'ok' : 'bad'">{{ testResult }}</span>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="panel-hd" style="justify-content:space-between">
          <b>AI 记忆</b>
          <button class="btn btn-sm btn-ghost" @click="loadMemory">刷新</button>
        </div>
        <p class="set-desc">AI 副驾记住了关于你的这些事，让回答更贴合你。可随时增删，也可直接在对话里说「记住…」「忘掉…」。</p>

        <div class="mem-block">
          <div class="mem-hd"><span class="mem-tag user">老板的偏好</span><span class="mem-count">{{ memUser.length }} 条</span></div>
          <div v-if="!memUser.length" class="mem-empty">AI 还没记住你的偏好，试着在对话里说「记住：催款要礼貌」。</div>
          <div v-for="(m, i) in memUser" :key="'u' + i" class="mem-item">
            <span class="mem-text">{{ m }}</span>
            <button class="mem-del" @click="removeMemory('user', i)" title="删除"><Icon name="close"/></button>
          </div>
        </div>

        <div class="mem-block">
          <div class="mem-hd"><span class="mem-tag agent">AI 的笔记</span><span class="mem-count">{{ memAgent.length }} 条</span></div>
          <div v-if="!memAgent.length" class="mem-empty">AI 还没有自己的笔记，它会随着使用自动沉淀行业规则。</div>
          <div v-for="(m, i) in memAgent" :key="'a' + i" class="mem-item">
            <span class="mem-text">{{ m }}</span>
            <button class="mem-del" @click="removeMemory('memory', i)" title="删除"><Icon name="close"/></button>
          </div>
        </div>

        <div class="set-row">
          <input v-model="newMem" class="input" placeholder="手动告诉 AI 记住一件事，例如：催款要先礼后兵" @keydown.enter="addMemory">
          <button class="btn btn-primary" :disabled="!newMem.trim()" @click="addMemory">记住</button>
        </div>
        <div class="set-row">
          <button class="btn btn-sm btn-ghost mem-danger" @click="resetMemory" :disabled="!memUser.length && !memAgent.length">清空全部记忆</button>
          <span class="set-desc">清空后 AI 会重新开始了解你</span>
        </div>
      </div>
    </template>

    <!-- ==================== AI 运维（备份/健康/审计/路由/兜底/配方IO） ==================== -->
    <template v-if="tab === 'aiops'">
      <AiOps />
    </template>

    <!-- ==================== 数据与系统 ==================== -->
    <template v-if="tab === 'system'">
      <div class="card">
        <div class="panel-hd">
          <b>数据维护</b>
        </div>
        <div class="set-row" style="justify-content:space-between">
          <p class="set-desc">员工档案、客户档案在左侧「档案管理」中维护；此处用于补录库存批次效期。</p>
          <button class="btn btn-sm btn-primary" @click="router.push('/data-fill')">库存效期补录</button>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { store, setTheme, toast } from '../store'
import { api } from '../api/client'
import Icon from '../components/Icon.vue'
import AiOps from './AiOps.vue'
// v312：登录端的**中文标注与合成**复用共享表 —— 不在本页再拼一份（本项目三次栽在"同一规则抄两份"）。
//   `loginScopeLabel` = `mini/both/web` → 中文；`endToScope` = `{web,mini}` → 单值。
//   🔴 为什么页面要自己算 `endToScope`：勾选框要**即时预览**「新账号的默认可登录端」，
//      而后端返回的那个字段要保存后才更新 ⇒ 必须能本地算一遍。映射与后端 `core.end_to_scope` 同源。
// v328：另取 `ROLE_NAMES`（角色短名，与员工档案同一个名字）+ `ROLE_HINTS`（一句话职责）。
//   🔴 统一名字的由来：权限页列头原先是另一套（"财务 / 文员"、"员工（小程序）"），
//      与员工档案下拉里的"会计"、"员工"**不是同一个名字** ⇒ 跨页对照时会当成两个角色。
import { loginScopeLabel, endToScope, ROLE_NAMES, ROLE_HINTS, isCanonicalRole } from '../constants/roles'

const router = useRouter()
const rtab = useRoute()

/* ---- 模块级标签页 ---- */
const tab = ref('account')
function switchTab(t) {
  tab.value = t
  if (t === 'perm') loadPerms()
  if (t === 'ai') loadMemory()
}

/* ---- AI 副驾连接检测 ----
   🔴 v281（2026-09-26）：原先这里让用户**在前端填网关 Bearer Key** 并存 localStorage，
   「测试连接」直接打 `/hermes/v1/models`。两处都已改：
     ① 那条 `/hermes/` 直通因「对公网无鉴权、且带 terminal/file 工具集」已被 nginx 封堵（403）；
     ② 网关凭据改为**只由服务端保管**（后端经 127.0.0.1 直连，`.env` 提供）⇒ 前端不该也不需要 Key。
   检测改为打后端**真实链路**（`/api/ai/skills` 会真正调用上游网关，403/失败会明确暴露）。 */
const testResult = ref('')
const testOk = ref(false)

async function test() {
  testResult.value = '测试中…'
  testOk.value = false
  try {
    const d = await api('/api/ai/skills')
    const ok = !!(d && d.ok !== false && d.success !== false)
    testOk.value = ok
    testResult.value = ok ? '连接正常' : '连接失败：上游网关无响应'
  } catch (e) {
    testOk.value = false
    testResult.value = (e && e.message) ? String(e.message) : '无法连接 AI 服务'
  }
}

/* ---- AI 记忆 ---- */
const memUser = ref([])
const memAgent = ref([])
const newMem = ref('')

async function loadMemory() {
  try {
    const d = await api('/api/memory')
    memUser.value = d.user || []
    memAgent.value = d.memory || []
  } catch (e) {
    toast('记忆读取失败：' + (e.message || '未知错误'), 'error')
  }
}

async function addMemory() {
  const c = newMem.value.trim()
  if (!c) return
  try {
    await api('/api/memory', { method: 'POST', body: { kind: 'user', content: c } })
    newMem.value = ''
    toast('已记住', 'success')
    loadMemory()
  } catch (e) {
    toast('保存失败：' + (e.message || '未知错误'), 'error')
  }
}

async function removeMemory(kind, index) {
  try {
    await api('/api/memory/remove', { method: 'POST', body: { kind, index } })
    loadMemory()
  } catch (e) {
    toast('删除失败：' + (e.message || '未知错误'), 'error')
  }
}

async function resetMemory() {
  if (!confirm('确定清空 AI 的全部记忆吗？清空后 AI 会重新开始了解你。')) return
  try {
    await api('/api/memory/reset', { method: 'POST' })
    loadMemory()
    toast('已清空记忆', 'success')
  } catch (e) {
    toast('清空失败：' + (e.message || '未知错误'), 'error')
  }
}

/* ================= 权限：成员授权 + 角色权限矩阵 ================= */
const ROLE_LABELS = {
  admin: '系统管理员', boss: '老板（全权限）', accountant: '财务/文员', sales: '业务员',
  guide: '导购', driver: '司机', staff: '员工（小程序）', supervisor: '主管',
  // v307 分销商：外部客户，默认只给 `data`（够跑通小程序报单），且默认只开小程序登录。
  distributor: '分销商（外部客户）',
}
const LOCKED_ROLES = ['admin']                  // 管理员不可改，保留唯一兜底账号
// 本页依赖 /api/role-permissions(hr) 与 /api/users(data)；只有 admin/boss 能进入，
// 锁死这两个角色的 hr/data 即可杜绝"把自己锁在门外"。
const PROTECTED_ROLES = ['admin', 'boss']
const CRITICAL_MODULES = ['hr', 'data']

const permRoles = ref([])
const modules = ref([])
const permLoading = ref(false)
const permSaving = ref(false)
const moduleQuery = ref('')
const permHelpOpen = ref(false)   // v326：使用说明默认收起（见模板注释）

/* ---- v334（2026-09-30）：细粒度权限（模块 × 动作）---------------------------------------
   需求原话：「按照舟谱截图，从角色列表点进某一角色的详情配置页，按各功能模块做更细粒度
   的权限配置」。后端 `GET/POST /api/role-permissions/detail`（`{模块: [动作]}`）**早已具备**
   —— 此前前端从未接上，于是界面上只有"勾模块"这一档。本轮补上，补齐"勾到动作"。

   三条视图，**旧矩阵原样保留**（零回归）：
     · `list`   角色列表（默认）—— 对标舟谱图 1：角色名 / 类型 / 可登录端 / 操作
     · `detail` 单角色细配 —— 对标舟谱图 2：模块分组 × 查看 / 新增 / 修改 / 删除
     · `matrix` 旧的横向矩阵 —— 保留作"批量总览与对比"，此前的使用习惯不受影响 */
const permView = ref('list')
const permDetailRole = ref('')
const permDetail = ref({})          // {模块: {read:bool, create:bool, update:bool, delete:bool}}
const permDetailLoading = ref(false)
const permDetailSaving = ref(false)
// 动作列的取值与顺序**照抄后端** `core._ALL_ACTIONS`（read/create/update/delete）。
// ⚠️ 刻意**不**照抄舟谱的「查看/编辑/导出/导入」四列：本仓的 `action` 由 **HTTP 方法**推导
//    （GET→read / POST→create / PUT→update / DELETE→delete），"导出/导入"在接口层没有独立
//    边界（导出常是 GET 或前端生成 CSV，导入是 POST）⇒ 硬套那两列会得到一个**点了不生效**
//    的假开关。四列表的中文名按业务语言给，见 `permActionLabels`。
const permActions = ['read', 'create', 'update', 'delete']
const permActionLabels = { read: '查看', create: '新增', update: '修改', delete: '删除' }
const permActionHints = {
  read: '看得到这一块的数据（列表、详情、报表）',
  create: '能新增记录',
  update: '能改已有记录',
  delete: '能删除记录',
}

/* v328：列头改用**短名**（`ROLE_NAMES`，与员工档案下拉同一个名字），
   原先那套带括号的（"财务 / 文员"、"员工（小程序）"）只作兜底 ——
   两页名字不一致时老板会当成两个角色。括号里的补充说明改由 `roleDuty` 走悬浮提示。 */
function roleLabel(n) { return ROLE_NAMES[n] || ROLE_LABELS[n] || n }
/** 悬浮提示里的一句话职责（"这个角色的人平时干什么"）。 */
function roleDuty(n) { return ROLE_HINTS[n] || '' }
function isLockedModule(roleName, mid) {
  return PROTECTED_ROLES.includes(roleName) && CRITICAL_MODULES.includes(mid)
}
function roleHas(role, mid) { return role.perms.includes(mid) }

/* ---- 角色权限矩阵 ---- */
/* v328 批次 ⑥：**按业务域分组**（对照舟谱的域分组矩阵）。
   15 个模块平铺时老板要逐行读、逐格勾；分组后是"数据 / 销售与库存 / 财务 / 人事 / AI"
   五组，组头可整组勾选 —— 从"勾 15 次"降到"想清楚 5 件事"。
   ⚠️ 分组只是**显示层**，勾选举仍是模块粒度（后端与保存逻辑零改动）。
   🔴 未归类模块兜底进「其他」组 —— 将来加了新模块忘了归组，也不会从界面上消失。 */
const MODULE_GROUPS = [
  { name: '数据与报单', mods: ['data', 'cron', 'bid'] },
  // v333：给以下模块归组。此前它们**没有归属** ⇒ 全部落进兜底的「其他」组
  //   （上次盘点是 6 个：dashboard / goals / forecast-audit / tasks / projects / messages）。
  //   兜底组本来是"将来加模块忘了归组也不消失"的保险，结果变成了垃圾抽屉 ——
  //   老板要在「其他」里找「经营目标」「预报审核与定稿」，与本次"找不到框"的问题同源。
  //   🔴 `forecast-audit` **单独一组**，刻意不并进「数据与报单」：后端 v332 拆它的原话
  //      就是"否则权限页上它会被误勾给一线岗位"，而组头「整组勾选」会把它连带送出去
  //      （正是要防的事）。单独成组后组头勾选 ≡ 只勾它自己。
  //      ⚠️ 组名用「预报」而非模块全名，避免组头与模块行出现两行同样的字。
  { name: '预报', mods: ['forecast-audit'] },
  // v333：`goals`「经营目标」归入本组 —— 它与「目标与返利」是同一套业务（同一页取数）。
  { name: '销售与库存', mods: ['sales', 'buying', 'stock', 'crm', 'goals'] },
  { name: '财务', mods: ['accounts', 'reports', 'payroll'] },
  { name: '人事与协同', mods: ['hr', 'tasks', 'projects', 'messages'] },
  { name: '看板', mods: ['dashboard'] },
  { name: 'AI', mods: ['chat'] },
]
const groupedModules = computed(() => {
  const list = filteredModules.value
  const byId = new Map(list.map(m => [m.id, m]))
  const out = []
  const used = new Set()
  for (const g of MODULE_GROUPS) {
    const items = g.mods.map(id => byId.get(id)).filter(Boolean)
    items.forEach(it => used.add(it.id))
    if (items.length) out.push({ name: g.name, items })
  }
  const rest = list.filter(m => !used.has(m.id))
  if (rest.length) out.push({ name: '其他', items: rest })
  return out
})

/* v333（2026-09-30）：模块行下面显示「对应页面」＝ 该模块**真的会让哪些页面入口出现/消失**。
   🔴 起因是老板原话：「角色权限界面怎么没有『预报订单管理和返利与目标』的权限配置框」。
      根因：权限页的每一行是**后端数据模块**，老板脑子里是**页面**，两个集合不是一一对应 ——
        · 「档案管理」(`data`) 其实是「**预报订货管理**」的门（还有品牌/商品档案）；
        · 「销售管理」(`sales`) 当时**一张页面都没对应**，却是「目标与返利」的唯一闸门
          ⇒ 权限页上等于没有框（v333 已给 `/rebate` 补 `module:'sales'` 修掉）。
      修法**不是**再写一段解释文字（v331 刚清掉那类"勾了会怎样"的说明），
      而是把**页面名**直接摆在模块名下面 —— 老板照着他认识的页面名找开关即可。
   🔴 **数据源 = 后端 `MODULE_IMPACT[*].entries`**（`/api/permissions/modules` 已随每个模块返回）。
      它是"勾了才会出现/消失的页面入口"的**唯一源**，且由护栏
      `role-registry-consistency-check.py` §5 段锁死 = `constants/pages.js` 的 `module` 字段逐项一致。
      ⇒ 前端**不再自己反查一遍 `PAGE_RULES`**（那样就是同一件事推两遍，正是本项目反复清掉的
        "规则抄两份"；前一版草稿就是这么写的，已改回用这个字段）。
   ⚠️ **只显示 `entries`，不显示 `feeds`** —— `feeds` 讲的是"入口不受它管、但页内数据要靠它读"
      （数据读取链路），属 v331 明令清除的**实现细节**；`entries` 只是页面名，是**导航事实**。
   ⚠️ `entries` 为空的模块（`accounts`/`reports`/`buying` 等纯接口模块）**什么都不显示**：
      宁可空着，也不写"用于其他"这种等于没说的占位（同样是 v331 清掉的噪音）。 */
function pageNamesFor(m) { return (m && m.entries) || [] }

/** 组头复选框：组内**可改**的模块全都勾上了才打勾（锁定的必选项不算"可改"）。 */
function groupChecked(g, role) {
  const free = g.items.filter(m => !isLockedModule(role.name, m.id))
  return free.length > 0 && free.every(m => roleHas(role, m.id))
}
/** 组头整组勾选/取消（只动**未锁定**的项 —— 老板的 hr/data 是防自锁的必选项）。 */
function toggleGroup(g, role, ev) {
  const on = !!ev.target.checked
  for (const m of g.items) {
    if (isLockedModule(role.name, m.id)) continue
    const has = roleHas(role, m.id)
    if (on && !has) role.perms.push(m.id)
    else if (!on && has) role.perms = role.perms.filter(x => x !== m.id)
  }
}

const filteredModules = computed(() => {
  const q = moduleQuery.value.trim().toLowerCase()
  if (!q) return modules.value
  return modules.value.filter(m => (m.label || '').toLowerCase().includes(q))
})

/* 权限值有两种合法形态（见后端 `core._DEFAULT_PERMS` 注释）：
     · legacy list：`["stock","data"]`
     · 新版 dict  ：`{"stock":["read","create"]}`
   本页只按**模块**勾选，两种形态都归一成模块名数组（丢动作粒度，因为动作粒度不影响任何入口显隐）。
   🔴 归一必须容错：`[...(v.permissions || [])]` 遇到 dict 会**直接抛**
      "object is not iterable" ⇒ 整个 `loadPerms` 落进 catch ⇒ 权限页一片空白 +
      只留一句"权限加载失败"。而这只在"某些租户用过 CRUD 级权限接口（/detail）"时才出现，
      本地无论如何复现不出 —— 属最难查的那类缺陷。 */
function permsToModules(v) {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string')
  if (v && typeof v === 'object') return Object.keys(v)
  return []
}

async function loadPerms() {
  permLoading.value = true
  try {
    const [r, m] = await Promise.all([api('/api/role-permissions'), api('/api/permissions/modules')])
    modules.value = m.modules || []
    const known = new Set(modules.value.map(x => x.id))
    permRoles.value = Object.entries(r.roles || {})
      .map(([name, v]) => ({
        name,
        perms: permsToModules(v.permissions).filter(p => p !== '*'),
        is_custom: v.is_custom,
        /* v312 登录端（「允许使用电脑端 / 允许使用手机端」）。
           🔴 三条都**从后端字段派生**，不在前端按 `ROLE_END` 重算一遍：
              `ROLE_END` 只是**内置默认**，租户可以在本页覆盖它 —— 若前端拿内置值渲染勾选，
              页面显示的就不是这家客户实际配置（正是"界面说的和实际不一样"那类缺陷）。
              · `end`           实际生效值（租户覆盖 ⊕ 内置默认）⇒ 勾选状态读它；
              · `endBase`       加载时的快照（比较键）⇒ 只保存**真改过**的角色，无谓请求为零；
              · `end_is_custom` 是否已被本租户改过 ⇒ 决定要不要显示「恢复」；
              · `end_locked_web` 电脑端是否锁死（老板/管理员，后端 `core.ROLE_END_PROTECTED`）。 */
        end: { web: !!(v.end && v.end.web), mini: !!(v.end && v.end.mini) },
        endBase: endKey(v.end),
        end_is_custom: !!v.end_is_custom,
        end_locked_web: !!v.end_locked_web,
      }))
      .filter(x => !LOCKED_ROLES.includes(x.name))
      .map(role => {
        /* 🔴 v296：这里**不再**丢弃"本页没有对应行的模块"（原为
           `filter(p => known.has(p) || p === 'dashboard')`）。
           原写法看着像"清理历史脏数据"，实际是**静默数据丢失**：`core._ALL_MODULES` 只有 15 项，
           而 `_DEFAULT_PERMS` 里还用着 `ops-workbench` / `perf` / `goals` 三个**未登记**的模块
           （`boss` 默认就持有它们）⇒ 老板只要点一次「保存权限」，这三个模块就被从租户库里**抹掉**，
           且全链路零报错 —— 因为 POST 回去的正是被过滤后的那份列表（自己弄丢、自己说没问题）。
           正确做法是「不认识 ≠ 丢掉」：未知模块**保留在数组里**（它只用于回传，不会被渲染成行，
           因为行是由 `modules` 渲染的）⇒ 保存时逐字回传，一个字节都不改。
           若日后要让它可配，正确动作是把它加进后端 `_ALL_MODULES` 并补中文标签，而不是在这里过滤。 */
        if (PROTECTED_ROLES.includes(role.name)) {
          for (const c of CRITICAL_MODULES) {
            if (known.has(c) && !role.perms.includes(c)) role.perms.push(c)
          }
        }
        return role
      })
  } catch (e) {
    permRoles.value = []
    toast('权限加载失败：' + (e.message || ''), 'error')
  } finally {
    permLoading.value = false
  }
}

function togglePerm(role, mid, ev) {
  if (isLockedModule(role.name, mid)) return
  const on = ev.target.checked
  role.perms = on ? [...new Set([...role.perms, mid])] : role.perms.filter(p => p !== mid)
}

/* ---- v334：单角色细粒度配置（模块 × 动作）-----------------------------------------
   数据源是**专门的端点** `GET /api/role-permissions/detail`，与上面旧矩阵那份（list 形态）
   **各走各的**：这样两条界面互不干扰，旧矩阵的行为一个字都不变。

   🔴 为什么保存必须走 `/detail`（dict 形态）而不是旧端点（list 形态）：
      在细粒度界面上，用户表达的是"这个模块只给查看、不给改" —— list 形态**装不下**这个意图。
      后端已做形态收敛 + 合并（`core.normalize_perms_shape` / `merge_module_list_into`），
      两个端点写进库的形态一致，所以这里选 dict 端点是**语义最完整**的那条路。 */
function openRoleDetail(name) {
  permDetailRole.value = name
  permView.value = 'detail'
  loadRoleDetail(name)
}

async function loadRoleDetail(name) {
  permDetailLoading.value = true
  permDetail.value = {}
  try {
    const d = await api('/api/role-permissions/detail')
    const mods = (d.roles && d.roles[name] && d.roles[name].modules) || {}
    const out = {}
    for (const k of Object.keys(mods)) out[k] = { ...mods[k] }
    permDetail.value = out
    /* 🔴 角色被删/改名（并发场景）⇒ 拿到空矩阵。此时**不能**静默留一个空表：
       一个空表在界面上与"这个角色什么权限都没有"长得一模一样，
       而用户点保存就会把该角色的权限**真的清空**。（本项目最怕的静默失效。） */
    if (!Object.keys(out).length) {
      toast('没有取到「' + roleLabel(name) + '」的权限明细，请退出后重进本页', 'warn')
    }
  } catch (e) {
    toast('权限明细加载失败：' + (e.message || ''), 'error')
  } finally {
    permDetailLoading.value = false
  }
}

function toggleDetail(mid, act, ev) {
  const cur = { ...(permDetail.value[mid] || {}) }
  cur[act] = !!ev.target.checked
  permDetail.value = { ...permDetail.value, [mid]: cur }
}

/** 该模块的四个动作是否**全**勾上（决定"整行"按钮显示什么、以及点下去做什么）。 */
function rowAllOn(mid) {
  const cur = permDetail.value[mid] || {}
  return permActions.every(a => !!cur[a])
}

function toggleRowAll(mid) {
  const on = !rowAllOn(mid)
  const cur = {}
  for (const a of permActions) cur[a] = on
  permDetail.value = { ...permDetail.value, [mid]: cur }
}

async function saveRoleDetail() {
  const name = permDetailRole.value
  if (!name) return
  permDetailSaving.value = true
  try {
    /* 只提交**至少勾了一个动作**的模块：四个都不勾 ≡ 这个模块不给。
       （后端 `_perm_granted` 对"模块不在 dict 里"与"动作列表为空"都是拒绝，
         但**不提交空动作的模块**能让库里那份配置保持干净、也让 `custom_roles` 的
         内容比对更直观 —— 不会出现 `{"stock": []}` 这种既占位又无权的怪行。） */
    const perms = {}
    for (const [mid, acts] of Object.entries(permDetail.value)) {
      const on = permActions.filter(a => acts && acts[a])
      if (on.length) perms[mid] = on
    }
    await api('/api/role-permissions/detail', {
      method: 'POST',
      body: { role_name: name, permissions: perms },
    })
    // 旧矩阵那份数据也要跟着刷新（同一张表，别让两套界面显示不一致）
    await loadPerms(true)
    await syncStorePerms()
    toast('「' + roleLabel(name) + '」的权限已保存', 'success')
  } catch (e) {
    toast('保存失败：' + (e.message || ''), 'error')
  } finally {
    permDetailSaving.value = false
  }
}

/* ---- v312 登录端（两条轴里的上面那条）----------------------------------------
   语义：`role.end` = 这个角色的人**默认**能从哪个端登录。它只决定**入口**，
   不决定能看哪些页面（那是下面的模块矩阵）；给该角色新建账号时，它是「可登录端」的默认值。
   ⚠️ 它是**角色政策**，不是账号事实：账号上那份 `login_scope` 仍可单独改（v307 的"保留手动开通"），
      两者不一致时员工档案会标出来，**不会**被这里静默覆盖。 */

/** 端配置的比较键（`"wm"` / `"w"` / `"m"`）—— 比对象比较可靠，也便于存"加载时快照"。 */
function endKey(e) {
  return (e && e.web ? 'w' : '') + (e && e.mini ? 'm' : '')
}

/** 勾选/取消某个端。两处把关在这里**各拦一次**（为了让用户不必等一个来回），
 *   **判据仍然后端** —— `POST /api/role-permissions/end` 对同样两种情况都会 400。 */
function toggleEnd(role, which, ev) {
  const want = !!ev.target.checked
  if (!want) {
    const other = which === 'web' ? role.end.mini : role.end.web
    if (!other) {
      ev.target.checked = true    // 还原控件：别让它停在一个后端必然拒绝的状态上
      toast('「' + roleLabel(role.name) + '」至少要允许一个端 —— 两个都不勾，这个角色的人就登不进来了', 'warn')
      return
    }
    if (which === 'web' && role.end_locked_web) {
      ev.target.checked = true
      toast('「' + roleLabel(role.name) + '」的电脑端不能关闭 —— 关掉之后您就进不来后台改回来了', 'warn')
      return
    }
  }
  role.end = { ...role.end, [which]: want }
}

/** 把某角色的登录端恢复为**出厂默认**（= 删掉本租户的覆盖那一行，后端 `DELETE .../end/{role}`）。 */
async function resetRoleEnd(role) {
  if (!confirm('把「' + roleLabel(role.name) + '」的登录端恢复为默认设置？')) return
  try {
    await api('/api/role-permissions/end/' + encodeURIComponent(role.name), { method: 'DELETE' })
    await loadPerms()
    toast('已恢复默认登录端', 'success')
  } catch (e) {
    toast('恢复失败：' + ((e && e.message) || ''), 'error')
  }
}

/* v296：保存/恢复后**必须把本会话的权限重新拉一遍**。改前没有这一步 ——
   `store.perms` 仍是旧值 ⇒ 侧栏 24 处 `canSee()` 全部按旧权限渲染，老板改完看着菜单没变，
   会以为"没保存上"；而系统给出的提示偏偏写着「权限已保存，立即生效」= **一句假承诺**。
   这是最容易被原谅、也最伤信任的一类缺陷：它不报错，它撒谎。
   🔴 用 `loadPerms(true)` 而**不是** `resetPerms()` + `loadPerms()`：后者会先把 `user.role`
      清空，而"角色未知 = fail-open"会让菜单**先全显一遍**再收窄（闪一屏，观感更糟）。 */
async function syncStorePerms() {
  try {
    await store.loadPerms(true)
  } catch (_) {}
  return !!store.perms
}

async function savePerms() {
  permSaving.value = true
  try {
    // ① 功能模块（两条轴里下面那条）—— 保持既有行为：按角色逐条 POST。
    for (const role of permRoles.value) {
      await api('/api/role-permissions', {
        method: 'POST',
        body: { role_name: role.name, permissions: role.perms },
      })
    }
    // ② 登录端（v312，上面那条）—— **只提交真改过的角色**（与加载时快照比对）。
    //    没改的一律不发请求：既省往返，也避免"给每个角色都写一行"。
    //    （后端对"与内置同值"的角色本来也会删行 ⇒ 两步一起保证覆盖表里只留真被改过的角色，
    //      这也正是 `end_is_custom` 能拿"有没有这一行"当判据的前提。）
    let endSaved = 0
    for (const role of permRoles.value) {
      if (endKey(role.end) === role.endBase) continue
      await api('/api/role-permissions/end', {
        method: 'POST',
        body: { role_name: role.name, allow_web: !!role.end.web, allow_mini: !!role.end.mini },
      })
      endSaved++
    }
    // ③ 落库后按**服务端事实**重画勾选与「登录端已改」标记 —— 不靠本地猜测。
    if (endSaved) await loadPerms()
    if (await syncStorePerms()) {
      toast(endSaved
        ? '已保存：功能模块 + 登录端（' + endSaved + ' 个角色改动）'
        : '权限已保存', 'success')
    } else {
      // 拉不回来（网络/401）⇒ 老实说"没核对上"，别继续许诺"已生效"。
      toast('权限已保存，请刷新页面确认', 'warn')
    }
  } catch (e) {
    toast('保存失败：' + ((e && e.message) || ''), 'error')
  } finally {
    permSaving.value = false
  }
}

async function resetRole(name) {
  if (!confirm(`确认把「${roleLabel(name)}」的权限恢复为默认？`)) return
  try {
    await api(`/api/role-permissions/${name}`, { method: 'DELETE' })
    await loadPerms()
    // v296：恢复默认同样是一次权限变更（而且会撤掉该角色的"让位"资格）⇒ 一样要同步本会话。
    await syncStorePerms()
    toast('已恢复默认权限', 'success')
  } catch (e) {
    toast('恢复失败：' + (e.message || ''), 'error')
  }
}

/* v328 批次 ⑥：**新建角色**（拿一个现成角色做底子，另存成一个新角色）。
   🔴 为什么必须有这个入口：后端保存端点在 v328 补了角色名校验 —— **只许改已存在的角色**。
      若不给"新建"留正门，客户就再也没有合法途径造角色了（**堵后门必须同批开正门**，
      只堵不开等于把功能删掉）。 */
const newRoleOpen = ref(false)
const newRoleName = ref('')
const newRoleFrom = ref('')
async function createRole() {
  const nm = newRoleName.value.trim()
  if (!nm) { toast('请先填新角色的名字', 'error'); return }
  try {
    await api('/api/role-permissions/new', {
      method: 'POST',
      body: { role_name: nm, from_role: newRoleFrom.value || '' },
    })
    toast('已新建角色「' + nm + '」' +
          (newRoleFrom.value ? '（权限复制自「' + roleLabel(newRoleFrom.value) + '」，可再调整）' : ''),
          'success')
    newRoleOpen.value = false
    newRoleName.value = ''
    await loadPerms()
    await syncStorePerms()
  } catch (e) {
    // 后端给出的是可执行的拒绝理由（重名 / 含空格 / 超长…），照原话转达，别改写成技术腔。
    toast('新建失败：' + (e.message || ''), 'error')
  }
}

/* v328 批次 ⑥：**全部恢复出厂** —— 只对**系统自带**的角色生效。
   🔴 为什么刻意不动自建角色：自建角色不在内置默认表里，删掉它的配置行 = 它**没有任何权限**
      ⇒ 派了这个角色的人全部 403 —— 而"恢复出厂"这四个字听起来人畜无害。
      所以自建角色只能逐个删（界面上每列已有的「恢复默认」就是干这个的）。 */
async function resetAllRoles() {
  /* 🔴 判据同上：`isCanonicalRole(r.name)`，**不要**写 `r.is_default`。
     该字段虽由后端下发，但 `loadPerms()` 的映射没搬它 ⇒ 恒 `undefined` ⇒ 本 filter 恒空 ⇒
     按钮永远回「没有可恢复的系统自带角色」= 功能静默失效（与列头那一处同源，2026-09-30 一并修）。
     前提：`roles.js::ROLE_NAMES` 的键集 ≡ 后端 `core._DEFAULT_PERMS`（由护栏
     `role-registry-consistency-check.py` 双向锁定，改一侧必同步）。 */
  const names = permRoles.value
    .filter(r => isCanonicalRole(r.name) && !LOCKED_ROLES.includes(r.name))
    .map(r => r.name)
  if (!names.length) { toast('没有可恢复的系统自带角色', 'error'); return }
  if (!confirm('把 ' + names.length + ' 个系统自带角色的权限恢复成默认设置？\n\n你自己新建的角色不受影响。')) return
  let fail = 0
  for (const n of names) {
    try {
      await api(`/api/role-permissions/${n}`, { method: 'DELETE' })
    } catch (e) {
      fail++
      toast('「' + roleLabel(n) + '」恢复失败：' + (e.message || ''), 'error')
    }
  }
  await loadPerms()
  await syncStorePerms()
  if (!fail) toast('已把系统自带角色恢复为默认设置', 'success')
}

/* ---- 其它 ---- */
function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

onMounted(() => {
  loadMemory()
  // 支持 ?tab=aiops 深链（「AI 引擎 › 产出与用量」页里的「设置 › AI 运维」入口，
  // 见 `AiHub.vue:9`；该页 v311 前叫「AI 中心」，路由与 query 名都没变）
  // 🔴 白名单里**不再有 'onboard'** —— 该标签页已移除（多租户开通改由管理后台负责）。
  //   旧书签 `?tab=onboard` 会落到默认标签页，不会白屏。
  const q = rtab.query && rtab.query.tab
  if (q && ['account', 'perm', 'ai', 'aiops', 'system'].includes(q)) switchTab(q)
})
</script>

<style scoped>
/* 卡片内距由全局 .card{padding:18px} 兜底（见 variables.css「通用卡片」），
   本页不再重复定义；下方 .toolbar 的 14px 16px 为工具栏专用紧凑间距，特异性更高、保持覆盖。 */

/* 模块级标签页：与「预报订单管理」module-tabs 保持一致 */
.module-tabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--bd);padding-bottom:2px}
.module-tabs button{border:none;background:transparent;color:var(--t2);font-size:14px;font-weight:500;padding:8px 14px;border-radius:var(--radius-sm) var(--radius-sm) 0 0;cursor:pointer;position:relative}
.module-tabs button:hover{color:var(--p)}
.module-tabs button.on{color:var(--p);font-weight:600}
.module-tabs button.on::after{content:'';position:absolute;left:0;right:0;bottom:-3px;height:2px;background:var(--p);border-radius:2px}

/* 顶部筛选 / 搜索栏：沿用 Forecast 的 toolbar + tb-search */
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:12px}
.tb-title{font-size:13.5px;font-weight:600;color:var(--t1)}
.tb-right{margin-left:auto}
/* 胶囊 + 内层无边框 input：焦点反馈挂胶囊整体，避免全局 .fld:focus 光晕悬空浮在胶囊内（同 Forecast） */
.tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:var(--bg3);border:1px solid var(--bd);border-radius:8px;color:var(--t2);transition:border-color .2s,box-shadow .2s}
.tb-search:focus-within{border-color:var(--p-dark);box-shadow:0 0 0 3px var(--p-bg)}
.tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;color:var(--t1);width:150px;height:100%}
.tb-search .fld:focus{box-shadow:none}
.tb-search .fld::placeholder{color:var(--t3)}

/* 全局无定义的类，本页补齐（沿用各页面统一口径） */
.btn-mini{border:1px solid var(--bd);background:none;border-radius:6px;padding:3px 10px;font-size:12px;color:var(--t2);cursor:pointer}
.btn-mini:hover{border-color:var(--p);color:var(--p-dark)}

/* 通用行 / 描述：允许换行 + 子项可收缩，避免长文本/输入框顶破卡片 */
.set-row{display:flex;align-items:center;gap:10px;padding:8px 0;flex-wrap:wrap}
.set-row>.input{flex:1 1 240px;width:auto;min-width:0}
.set-row>.set-desc{flex:1 1 260px;min-width:0}
.set-lb{display:inline-block;min-width:88px;font-size:13px;color:var(--t2)}
.set-desc{font-size:12px;color:var(--t3);margin:0;line-height:1.7}
.set-result{font-size:12.5px}
.set-result.ok{color:var(--suc)}
.set-result.bad{color:var(--dan)}

/* 卡片头：标题与副标题分列两端，长副标题时允许换行而不是撑破 */
.panel-hd{gap:10px;flex-wrap:wrap}
.panel-hd>.page-sub{min-width:0;text-align:right}

/* 权限矩阵 */
/* v326：使用说明默认收起（原先 8 段实现说明常驻在表格上方，见模板里的注释）。 */
.pm-help-tb{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--t2);background:none;border:0;padding:0;margin:0 0 10px;cursor:pointer}
.pm-help-tb:hover{color:var(--p-dark)}
.pm-help{margin:0 0 12px;padding:9px 12px;border-radius:var(--radius-md);background:var(--bg3);font-size:12.5px;color:var(--t2);line-height:1.75}
.pm-help p{margin:0 0 5px}
.pm-help p:last-child{margin-bottom:0}
.pm-mod-col{min-width:120px}
/* v328：模块名 + 下面一行「勾了会怎样」。
   副文案刻意用小字、次级色 —— 它是**说明**，不能抢了模块名的视觉重量（老板找的是模块名）。 */
.pm-mod-cell{padding-top:7px;padding-bottom:7px}
.pm-mod-lb{font-size:12.5px;color:var(--t1);line-height:1.5}
/* v333：模块行下面的「对应页面」—— 让老板按页面名找到开关。
   刻意做得比模块名更淡更小（它是**索引**不是正文），且不加背景/边框，
   否则一整列小色块会把表格又切碎（样式纪律见文件头那段）。 */
.pm-mod-pages{font-size:11px;color:var(--t3);line-height:1.45;margin-top:1px}
/* ==================== v334（2026-09-30）：角色列表 + 单角色细粒度权限 ====================
   对标舟谱的「角色列表 → 点进某角色细配」两步式。样式纪律沿用本文件既有约定：
   颜色**一律走 CSS 变量**（`--t1/--t2/--t3`、`--bd`、`--bg2/--bg3`、`--p-*`），
   **不写死色值** —— 写死会在深色模式下变成不可读的白底黑字
   （本仓专门修过一轮深色模式：原生控件白底、下拉列表白底都是同一类病）。 */
.perm-views{margin-bottom:12px}
.perm-role-table{width:100%;border-collapse:collapse;font-size:13px}
.perm-role-table th,.perm-role-table td{padding:9px 10px;border-bottom:1px solid var(--bd);text-align:left}
.perm-role-table th{font-weight:600;color:var(--t2);background:var(--bg3)}
.perm-role-table .ctr{text-align:center}
.pr-col-name{width:30%}
.pr-col-type{width:18%}
.pr-col-end{width:18%}
.pr-name{font-weight:600;color:var(--t1)}
/* 「自定义角色」用主色小标签，「系统自带」用中性小标签 —— 一眼能分辨，
   且两者都只是"角色类型"的注脚，不需要抢眼到干扰扫读。 */
.pr-type{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;
         background:var(--bg3);color:var(--t2)}
.pr-type.custom{background:var(--p-bg);color:var(--p-dark)}
.pr-end{color:var(--t2)}
.pr-empty{color:var(--t3);text-align:center;padding:22px 0}
.pr-tip{margin:10px 2px 2px;font-size:12px;color:var(--t3);line-height:1.6}
.perm-detail-table{width:100%;border-collapse:collapse;font-size:13px}
.perm-detail-table th,.perm-detail-table td{padding:8px 10px;border-bottom:1px solid var(--bd)}
.perm-detail-table th{font-weight:600;color:var(--t2);background:var(--bg3)}
.perm-detail-table .ctr{text-align:center}
.pd-mod{min-width:240px}
.perm-detail-table input[type="checkbox"]{width:15px;height:15px;cursor:pointer}
/* v328 批次 ⑥：域分组的组头行 + 新建角色表单。
   组头用浅底 + 小字，与「分节标题行」(pm-sec) 的主色**刻意不同** ——
   分节是"①②两条轴"，组头只是"这一堆模块归一类"，层级不一样，不能长得像。 */
.pm-grp td{background:var(--bg3)}
.pm-grp-lb{font-size:12px;font-weight:600;color:var(--t2);padding-left:14px}
.pm-new{margin:0 0 10px;padding:10px 12px;border:1px solid var(--bd);border-radius:var(--radius-md);background:var(--bg2)}
.pm-new-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pm-new-name{width:180px}
.pm-new-tip{font-size:11.5px;color:var(--t3);margin:7px 0 0;line-height:1.6}
.ctr{text-align:center}
.pm-col-hd{font-size:12.5px;font-weight:600;color:var(--t1);margin-bottom:4px}
.pm-me{margin-left:6px}
.pm-role{width:170px}

/* v331c（2026-09-29）：两条轴的分节标题行 + 登录端行。
   🔴 分节标题由「整行色带」改成「左侧层级小标题」—— 老板原话：那条铺满表宽的横条
      「把整个界面分成上下两块，非常不美观」。只改分隔**样式**，不动两轴本身
      （登录端 = 入口 / 功能模块 = 能力，两者正交，同表才需要标题来分层）。
   ⚠️ 仍用 `td` 而不是 `th`（它在 tbody 里，随内容滚动）；仍要与「业务域组头」
      （`pm-grp` 浅底小字）明确区分 —— 否则老板会把「允许使用手机端」读成又一个功能模块。
   ⚠️ v331c 同时删掉了只读「手机端」列的样式（`.pm-mini-col` / `.pm-mini-on` / `.pm-na`）：
      那一列标的是"小程序代码是否调了该模块的接口"，**勾不了、改不了**，是纯标注。 */
.pm-sec td{background:transparent;border-top:1px solid var(--bd);color:var(--t1);font-size:12.5px;font-weight:600;padding:14px 10px 5px}
.pm-sec:first-child td{border-top:0;padding-top:2px}
.pm-end-lb{font-size:12.5px;color:var(--t1)}
.pm-end-sum td{background:var(--bg2)}
.pm-col-sub{font-size:11px;color:var(--t3);margin-bottom:2px}
/* v328 G4：自定义角色的标记要能被看见（它是"为什么勾了没反应"的答案所在）。 */
.pm-col-custom{color:var(--warn,#b7791f);cursor:help}
.pm-end-tag{font-size:11.5px;padding:1px 7px;border-radius:9px;background:var(--bg3);color:var(--t2);white-space:nowrap}
.pm-end-tag.on{background:var(--p-bg);color:var(--p-dark)}

/* 分页：沿用 Forecast .pager */
.pager{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:12px}
.pager-info{color:var(--t2);margin-right:auto}

/* AI 记忆 */
.mem-block{margin:14px 0}
.mem-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.mem-tag{font-size:11.5px;padding:2px 8px;border-radius:10px}
.mem-tag.user{background:var(--p-bg);color:var(--p-dark)}
.mem-tag.agent{background:var(--bg3);color:var(--t2)}
.mem-count{font-size:11.5px;color:var(--t3)}
.mem-empty{font-size:12px;color:var(--t3);padding:8px 0}
.mem-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--radius-sm);background:var(--bg2);margin-bottom:6px}
.mem-text{flex:1;min-width:0;font-size:12.5px;color:var(--t1);line-height:1.6;word-break:break-word}
.mem-del{border:none;background:none;color:var(--t3);cursor:pointer;font-size:13px}
.mem-del:hover{color:var(--dan)}
.mem-danger{color:var(--dan)}

</style>
