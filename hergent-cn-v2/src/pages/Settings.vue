<template>
  <div class="page">
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
        <!-- v417k（P2）：表格密度开关。放在「界面主题」旁边而不是每张表上 ——
             密度是**人**的偏好（这台屏幕多大、这人眼神如何），不是**某张表**的属性。
             写进 `useDensity`：本机即时生效 + 云端跨设备同步（复用 /api/ui/col-prefs）。 -->
        <div class="set-row">
          <b class="set-lb">表格密度</b>
          <button class="btn btn-sm btn-ghost" @click="switchDensity">{{ densityLabel }}</button>
          <span class="set-desc">{{ densityHint }}</span>
        </div>
      </div>
    </template>

    <!-- ==================== 权限（仅角色权限矩阵；成员/账号归位「员工档案」） ==================== -->
    <template v-if="tab === 'perm'">
      <!-- ============ v351（2026-10-01，路线 A）：权限页只剩**一个**写法 ============
           老板拍板走路线 A：**「批量总览」不再是一个页签**，它原来的两个用途拆开 ——
             · 「配权限」→ 归到**每个角色自己的配置页**（唯一写入口）；
             · 「几家角色横向比一比」→ 降级为角色列表右上角的**「查看对比」只读弹窗**。

           🔴 为什么必须这么改（v350 那个 P0 的病根）：
           原先两个视图**写同一行同一列、却是两种数据形态** ——
             矩阵视图写 list（`perms[角色] = [模块…]`），详情视图写 dict（`{模块: [动作]}`）。
           于是「老板的 hr/data 是必选」这条安全规则**只在矩阵视图实现**，详情视图零防护
           ⇒ 在详情页取消一个勾就能把 boss 的 `hr` 写空 ⇒ 权限页永久自锁（只能改库救回）。
           v350 是给两处各补一份判据（同一规则**抄了两份**）；本版是**把第二个写入口删掉** ——
           规则自然只剩一份，结构上不可能再漏。 -->

      <!-- ============ 视图一：角色列表（对标舟谱图 1）============ -->
      <template v-if="permView === 'list'">
        <div class="card">
          <div class="panel-hd">
            <b>角色与权限</b>
            <div class="tb-group tb-right">
              <!-- 🔴 v351：原先这三件事挤在矩阵视图的工具栏最右侧（搜索框 + 新建角色 +
                   「全部恢复默认」+ 「保存权限」）。矩阵撤掉后，两个**整页级低频**动作挪到这里；
                   「保存」则只在**角色配置页**里出现（它保存的是那一个角色）。 -->
              <button class="btn btn-sm" @click="compareOpen = true"
                      title="所有角色横向比一比（只能看，不能改）">查看对比</button>
              <button class="btn btn-sm" @click="newRoleOpen = !newRoleOpen"
                      title="拿一个现成角色做底子，另存成一个新角色">新建角色</button>
              <button class="btn btn-sm" @click="resetAllRoles"
                      title="把所有系统自带角色恢复成默认设置（自建角色不受影响）">全部恢复默认</button>
            </div>
          </div>

          <!-- v328 批次 ⑥：新建角色的**内联**表单（不弹窗 —— 本页已有横向滚动的表格，
               再叠一层模态会让"在哪儿点"变成猜谜）。v351：跟着按钮从矩阵挪到本视图。 -->
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
              <button class="btn btn-sm btn-primary" :disabled="permLoading" @click="createRole">创建</button>
              <button class="btn btn-sm" @click="newRoleOpen = false">取消</button>
            </div>
            <p class="pm-new-tip">创建后它立刻出现在下面的表格里，接着点「配置权限」勾它的权限即可。
              名字最多 16 个字，不能和系统自带角色重名。</p>
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
                  <!-- v351：从矩阵列头挪过来。判据仍是 `is_custom`（= 本租户有覆盖行）——
                       系统自带角色被改过也照样能单独恢复，正是老板要的"这个改坏了，退回去"。 -->
                  <button v-if="r.is_custom" class="btn btn-sm btn-ghost" @click="resetRole(r.name)"
                          title="恢复该角色的默认权限">恢复默认</button>
                </td>
              </tr>
              <tr v-if="!permRoles.length">
                <td colspan="4" class="pr-empty">{{ permLoading ? '加载中…' : '没有可配置的角色' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="pr-tip">
            点「配置权限」进入这个角色的明细。<b>同一个角色只有一个配权限的地方</b> ——
            改了就是真的改了，不会出现"这里改了那里没变"。
          </p>
        </div>
      </template>

      <!-- ============ 视图二：单个角色的详情配置（对标舟谱图 2 · **唯一写入口**）============ -->
      <template v-if="permView === 'detail'">
        <div class="card toolbar">
          <div class="tb-group">
            <button class="btn btn-sm btn-ghost" @click="permView = 'list'">← 角色列表</button>
            <span class="tb-title">角色：{{ roleLabel(permDetailRole) }}</span>
            <span v-if="roleDuty(permDetailRole)" class="tb-sub">{{ roleDuty(permDetailRole) }}</span>
          </div>
          <div class="tb-group tb-right">
            <button class="btn btn-sm btn-primary"
                    :disabled="permDetailSaving || permDetailLoading"
                    @click="saveRoleDetail">
              {{ permDetailSaving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <!-- ============ ③④ 登录端 —— 置顶（原型第 2 条）============
             它回答的是"这个角色的人**从哪儿进来**"，与下面"进来之后能干什么"是两件事，
             分开放才读得清（原先它是矩阵里的一行，藏在 20 行模块中间）。
             🔴 它是**角色政策**（给该角色新建账号时 `login_scope` 的默认值），不是账号事实 ——
                已存在的账号仍可单独改，两者不一致时员工档案会标出来，**不会**在这里被静默覆盖。 -->
        <div class="card">
          <div class="panel-hd"><b>登录端 · 这个角色的人从哪儿进来</b></div>
          <div v-if="permDetailLoading || !curRole" class="pr-empty">加载中…</div>
          <template v-else>
            <label class="end-row end-row-web">
              <input type="checkbox"
                     :checked="curRole.end.web"
                     :disabled="curRole.end_locked_web"
                     :title="curRole.end_locked_web ? '老板 / 管理员的电脑端不能关闭 —— 关掉后将无法进入后台改回来' : ''"
                     @change="toggleEnd(curRole, 'web', $event)">
              <span>允许使用电脑端（网页）</span>
            </label>
            <label class="end-row end-row-mini">
              <input type="checkbox" :checked="curRole.end.mini" @change="toggleEnd(curRole, 'mini', $event)">
              <span>允许使用手机端（小程序）</span>
            </label>
            <div class="end-sum">
              新账号的默认可登录端：<b>{{ loginScopeLabel(endToScope(curRole.end)) }}</b>
              <button v-if="curRole.end_is_custom" class="btn-mini" style="margin-left:8px"
                      title="把该角色的登录端恢复为默认设置" @click="resetRoleEnd(curRole)">恢复默认</button>
            </div>
          </template>
        </div>

        <!-- ============ ① 功能模块 —— **域页签**（原型第 3 条）============
             🔴 「更多」**不再折叠**（老板 2026-10-01 拍板）：原先是一条长列表 + 把「更多」折起来，
                找东西得先在长列表里扫；改成页签后点一下就到那一类，再折叠就是多余的两次点击。 -->
        <div class="card">
          <div class="panel-hd">
            <b>功能权限 · 这个角色能用哪些功能</b>
            <div class="tb-group tb-right">
              <div class="tb-search">
                <Icon name="search"/>
                <input v-model="moduleQuery" class="fld" placeholder="搜索功能…" aria-label="搜索功能">
              </div>
              <!-- v350：搜索是**查找**不是筛选 ⇒ 给命中数，否则"其余行变淡"会被当成没反应 -->
              <span v-if="searchHitKeys" class="tb-hit">
                {{ searchHitKeys.size ? '找到 ' + searchHitKeys.size + ' 个' : '没有匹配的功能' }}
              </span>
            </div>
          </div>

          <div v-if="permGroups.length" class="domtabs">
            <button v-for="g in permGroups" :key="'dt-' + g.name"
                    :class="{ on: g.name === (curDomain || {}).name }"
                    @click="detailDomain = g.name">
              {{ g.tab || g.name }}
              <!-- 搜索时改显**命中数**（无命中的域自然会露出来，用户知道该点哪个） -->
              <span class="cnt">{{ domainCount(g) }}</span>
            </button>
          </div>

          <div v-if="permDetailLoading" class="pr-empty">加载中…</div>
          <table v-else class="perm-detail-table">
            <thead>
              <tr>
                <th class="pd-mod">功能</th>
                <th v-for="a in permActions" :key="'ph-' + a" class="ctr" :title="permActionHints[a]">
                  {{ permActionLabels[a] }}
                </th>
                <th class="ctr" style="width:104px">整行</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in detailRows" :key="'dm-' + m.id"
                  :class="{ 'pm-row-dim': isDimmed(m) }">
                <td class="pd-mod">
                  <div class="pm-mod-lb">{{ m.rowName || m.label }}</div>
                  <!-- v349：只读固定行（`module: null`）—— 只说清它归谁管，**不给勾选框**。
                       画一个勾了不生效的框 = 界面说假话（本项目红线）。 -->
                  <div v-if="m.fixed" class="pm-mod-fixed">{{ m.fixed }}</div>
                  <template v-else>
                    <!-- v333：这个勾管哪些**页面**。数据源 = 后端 `MODULE_IMPACT.entries`，
                         与 `pages.js` 的 `module` 由护栏逐项锁定，前端不自己再推一份。 -->
                    <div v-if="pageNamesFor(m).length" class="pm-mod-pages">
                      对应页面：{{ pageNamesFor(m).join('、') }}
                    </div>
                    <!-- 🔴 v390（2026-10-07）：`note` 与上面的 `entries` 改回**可并存**
                         （原来是 `v-else-if` 二选一）。起因：v390 把「经营看板」行改名为
                         「经营趋势」后，该行**同时**有了 `entries: ['经营趋势']` 与一句
                         补充说明（"首页的今日销售额 / 毛利 / 回款也跟它一起开关"）——
                         二选一的写法会把后半句**静默顶掉**（数据仍在 `permView.js` 里，
                         界面上却看不见）。一条规则（"这个勾管什么"）不该因为有没有
                         页面入口而少说一半。仍无内容时才落到下面那句 `PERM_NO_PAGE_NOTE`。 -->
                    <div v-if="m.note" class="pm-mod-pages">{{ m.note }}</div>
                    <div v-if="!pageNamesFor(m).length && !m.note"
                         class="pm-mod-pages pm-mod-nopage">{{ PERM_NO_PAGE_NOTE }}</div>
                  </template>
                </td>
                <td v-for="a in permActions" :key="'pc-' + m.id + '-' + a" class="ctr">
                  <span v-if="m.fixed" class="pm-fixed-mark" :title="m.fixed">不在此配</span>
                  <!-- 🔴 v350 P0 / v351 仍是本页**唯一**的勾选框位置：
                       `isLockedModule` 是「必选项」的**单一实现**（渲染层 + 行为层共用）。
                       v351 撤掉矩阵视图后，这条规则在结构上只剩这一处，不可能再漏一份。 -->
                  <input v-else type="checkbox"
                         :checked="!!(permDetail[m.id] || {})[a]"
                         :disabled="isLockedModule(permDetailRole, m.id)"
                         :title="isLockedModule(permDetailRole, m.id) ? '必选项，不可取消' : ''"
                         @change="toggleDetail(m.id, a, $event)">
                </td>
                <td class="ctr">
                  <span v-if="m.fixed" class="pm-fixed-mark">—</span>
                  <!-- 「整行全选」对必选项同样危险（点一下＝改掉该行 4 个勾）⇒ 一并上锁。 -->
                  <button v-else class="btn btn-sm btn-ghost"
                          :disabled="isLockedModule(permDetailRole, m.id)"
                          :title="isLockedModule(permDetailRole, m.id) ? '必选项，不可取消' : ''"
                          @click="toggleRowAll(m.id)">
                    {{ rowAllOn(m.id) ? '取消整行' : '整行全选' }}
                  </button>
                </td>
              </tr>
              <tr v-if="!detailRows.length">
                <td :colspan="permActions.length + 2" class="pr-empty">这个分类下没有可配置的功能</td>
              </tr>
            </tbody>
          </table>
          <p class="pr-tip">
            一个功能四个勾都不勾 = 这个角色看不到这一块（侧栏入口与页内数据都会一起关掉）。
            勾了什么就真的生效什么：取消「查看」后，这个角色连这一块的数据都读不到。
          </p>
        </div>

        <!-- ============ ② 是否可使用 AI —— 独立一块（原型第 4 条）============
             它不属于任何一个业务域（不是一个页面），混在功能列表里会被当成"又一个模块"。
             🔴 口径要说准：关掉它 = 关掉**发起新对话**（`/api/ai/copilot/chat` 归 chat）；
             `/api/ai/sessions`、`search-chat`、`media` 豁免模块判定 ⇒ 历史会话与附件仍可读
             （且只读自己的）。别说成"关掉 AI 就全断了"，那是假话。
             ⚠️ 勾选举**仍然写回 `chat` 模块**（`PERM_AI_MODULE`）—— 后端零改动。 -->
        <div class="card">
          <div class="panel-hd"><b>允许使用 AI · 问副驾 / 让 AI 分析</b></div>
          <div v-if="permDetailLoading" class="pr-empty">加载中…</div>
          <template v-else>
            <label class="end-row end-row-ai">
              <input type="checkbox"
                     :checked="detailModuleOn(PERM_AI_MODULE)"
                     title="勾选即允许该角色使用 AI"
                     @change="toggleAi($event)">
              <span>允许这个角色使用 AI</span>
            </label>
            <p class="pr-tip" style="margin-top:8px">
              关掉后不能发起新对话；已经存在的会话与附件仍然可以查看（只看自己的）。
            </p>
          </template>
        </div>

        <!-- 使用说明：**默认收起**（v326）。留着的两句仍是功能的一部分，不是装饰 ——
             权限页最容易犯的错是「许诺一件它兑现不了的事」。 -->
        <div class="card">
          <button type="button" class="pm-help-tb"
                  :aria-expanded="permHelpOpen ? 'true' : 'false'"
                  @click="permHelpOpen = !permHelpOpen">
            <Icon :name="permHelpOpen ? 'chevron-down' : 'chevron-right'"/>
            使用说明
          </button>
          <div v-if="permHelpOpen" class="pm-help" style="margin-bottom:0">
            <p>保存后<b>立即生效</b>。已经存在的账号<b>不会被自动改动</b>；员工档案里会把这些账号
              标成「与角色配置不一致」，可一键按角色对齐。</p>
            <p>老板与管理员的「员工管理」「档案管理」为必选、不可取消 —— 防止把自己锁在门外。</p>
          </div>
        </div>
      </template>

      <!-- ============ 「查看对比」只读弹窗（原「批量总览」的**看**那一半）============
           🔴 v351：为什么降级成弹窗 —— 跨角色对比本来只是"看一眼"，
           为它保留一个**可写**视图正是 v350 那个自锁缺陷的病根
           （同一行同一列、两套读写路径）。
           🔴 本弹窗里**没有任何 input / @click 能写**，只有 ✓ 与 — 两种只读标记 ——
           结构上不可能再从第二个地方改权限。 -->
      <div v-if="compareOpen" class="cmp-mask" @click.self="compareOpen = false">
        <div class="cmp-dlg">
          <div class="panel-hd">
            <b>角色权限对比（只读）</b>
            <div class="tb-group tb-right">
              <button class="btn btn-sm" @click="compareOpen = false">关闭</button>
            </div>
          </div>
          <p class="pr-tip">
            这里只能看，不能改。要改请回到对应角色的配置页 ——
            这样就不会有"在两个地方各勾一半"的问题。
          </p>
          <div v-if="permLoading" class="pr-empty">加载中…</div>
          <div v-else class="cmp-wrap">
            <table class="cmp-table">
              <thead>
                <tr>
                  <th class="cmp-first">权限项</th>
                  <th v-for="role in permRoles" :key="'ch-' + role.name" class="ctr">
                    <div class="pm-col-hd">{{ roleLabel(role.name) }}</div>
                    <div v-if="!isCanonicalRole(role.name)" class="pm-col-sub pm-col-custom">自定义角色</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr class="pm-sec"><td :colspan="permRoles.length + 1">登录端</td></tr>
                <tr>
                  <td class="cmp-first">允许使用电脑端（网页）</td>
                  <td v-for="role in permRoles" :key="'cw-' + role.name" class="ctr">
                    <span class="cmp-mark" :class="{ on: role.end.web }">{{ role.end.web ? '✓' : '—' }}</span>
                  </td>
                </tr>
                <tr>
                  <td class="cmp-first">允许使用手机端（小程序）</td>
                  <td v-for="role in permRoles" :key="'cm-' + role.name" class="ctr">
                    <span class="cmp-mark" :class="{ on: role.end.mini }">{{ role.end.mini ? '✓' : '—' }}</span>
                  </td>
                </tr>
                <tr class="pm-sec"><td :colspan="permRoles.length + 1">是否可使用 AI</td></tr>
                <tr>
                  <td class="cmp-first">允许使用 AI</td>
                  <td v-for="role in permRoles" :key="'ca-' + role.name" class="ctr">
                    <span class="cmp-mark" :class="{ on: roleHas(role, PERM_AI_MODULE) }">{{ roleHas(role, PERM_AI_MODULE) ? '✓' : '—' }}</span>
                  </td>
                </tr>
                <template v-for="g in permGroups" :key="'cg-' + g.name">
                  <tr class="pm-sec"><td :colspan="permRoles.length + 1">{{ g.tab || g.name }}</td></tr>
                  <tr v-for="m in g.items" :key="'cr-' + m.id">
                    <td class="cmp-first">
                      {{ m.rowName || m.label }}
                      <span v-if="m.fixed" class="pm-fixed-mark">·不在此配</span>
                    </td>
                    <td v-for="role in permRoles" :key="role.name + '-' + m.id" class="ctr">
                      <span v-if="m.fixed" class="pm-fixed-mark">—</span>
                      <span v-else class="cmp-mark" :class="{ on: roleHas(role, m.id) }">{{ roleHas(role, m.id) ? '✓' : '—' }}</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
        <div class="set-row" style="justify-content:space-between" v-if="canSee('/data-fill')">
          <p class="set-desc">员工档案、客户档案在左侧「档案管理」中维护；此处用于补录库存批次效期。</p>
          <button class="btn btn-sm btn-primary" @click="goDataFill">库存效期补录</button>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { store, setTheme, toast } from '../store'
import { density, setDensity } from '../composables/useDensity'
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
import { canSee } from '../constants/pages'
// v349：权限页的**行**改为由 `permView.js` 定义（行 = 侧栏功能，而不是后端模块名）。
//   行名 / 分组 / 只读固定行 /「更多」折叠，全部在那一个文件里改，本页不再内联第二份。
import {
  PERM_SIDEBAR_GROUPS, PERM_MORE_GROUP, PERM_AI_MODULE, PERM_NO_PAGE_NOTE,
} from '../constants/permView'

const router = useRouter()
const rtab = useRoute()

/* ---- 模块级标签页（v427：改为 URL `?tab=` 驱动，页内页签条已退役，见 v396）---- */
const SETTINGS_TABS = ['account', 'perm', 'ai', 'aiops', 'system']
function normSettingsTab(q) {
  return SETTINGS_TABS.indexOf(q) >= 0 ? q : 'account'
}
const tab = ref('account')
function switchTab(t) {
  tab.value = t
  if (t === 'perm') loadPerms()
  if (t === 'ai') loadMemory()
}
/* 侧栏直达 / 深链（`/settings?tab=aiops`，见 `AiHub.vue:9`）/ 页内切换都走这一处：
   URL 是唯一真相，组件不随 query 变化重挂，故要 watch。 */
function applySettingsTab() {
  switchTab(normSettingsTab(rtab.query && rtab.query.tab))
}
watch(() => rtab.query.tab, () => applySettingsTab())

/* v341（2026-09-30）：「库存效期补录」按钮的守卫。
   目标是 `/data-fill`（模块 `stock` + 业务管理岗），与设置页自身的门槛**不是同一条**
   —— 设置页能进 ≠ 这一页能进。原先按钮直接 `router.push('/data-fill')` 没有任何判据，
   权限被收窄的账号点下去只会被路由守卫弹回工作台（看起来像"点了没反应"）。
   现在按钮本身也按同一份 `PAGE_RULES` 决定显不显示（见模板 `v-if`），
   这里再守一道，防的是"渲染后权限被改"的窗口期。 */
function goDataFill() {
  if (!canSee('/data-fill')) { toast('你没有访问「库存效期补录」的权限，请联系管理员', 'warn'); return }
  router.push('/data-fill')
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
const moduleQuery = ref('')
const permHelpOpen = ref(false)   // v326：使用说明默认收起（见模板注释）

/* ---- v334（2026-09-30）：细粒度权限（模块 × 动作）---------------------------------------
   需求原话：「按照舟谱截图，从角色列表点进某一角色的详情配置页，按各功能模块做更细粒度
   的权限配置」。后端 `GET/POST /api/role-permissions/detail`（`{模块: [动作]}`）**早已具备**
   —— 此前前端从未接上，于是界面上只有"勾模块"这一档。本轮补上，补齐"勾到动作"。

   v351（2026-10-01，老板拍板走**路线 A**）：**只剩两个视图，且只有一个能写**：
     · `list`   角色列表 —— 对标舟谱图 1：角色名 / 类型 / 可登录端 / 操作（含「查看对比」）
     · `detail` 单角色细配 —— 对标舟谱图 2：登录端 / 域页签 × 查看·新增·修改·删除 / AI
     · ~~`matrix` 旧的横向矩阵~~ ⇒ **已删除**，降级为 `compareOpen` 只读弹窗。
   🔴 这不是"少了个功能"，是**修掉病根**：两个可写视图写同一行同一列（list 形态 vs dict 形态）
      ⇒ 「老板 hr/data 必选」这条规则必然要在两处各写一遍 ⇒ v350 那个"改一个勾就能把权限页
      永久锁死"的缺陷。**删掉第二个写入口 = 规则只剩一份 = 结构上不可能再漏。** */
const permView = ref('list')
const compareOpen = ref(false)      // v351：「查看对比」只读弹窗（原「批量总览」的"看"那一半）
const detailDomain = ref('')        // v351：详情页当前选中的**域页签**（'经营'/'核算'/'配置'/'更多'）
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
/* v349：**分组定义搬到 `constants/permView.js`** —— 行改成"侧栏功能"，不再是 20 个后端模块名。
   本页只负责把它**合成**成可渲染的行（后端下发的 `modules` 提供 `entries` / `label` / `id`）。

   🔴 合成时三类行要分清：
     · 有 `module` 的 ⇒ 真实可勾行，`id` 就是模块键（保存时写回它，**不是**行名）；
     · `module: null` 的 ⇒ **只读固定行**（`id` 用 `__fixed_` 前缀合成，保存时**必须过滤掉**）。
       🔴 为什么必须给固定行而不是让它"消失"：`module: null` 的页（首页 / AI 引擎 / 设置）
       入口由**角色轴**裁决，`pages.js` 的让位规则第③档明确"没有 module ⇒ 不让位"
       ⇒ 就算画个勾也**不会生效**。"消失"会被当成缺功能，"可勾但不生效"是界面说假话
       ⇒ 只剩第三条路：显示出来 + 一句话说清为什么不在这里配。
     · `PERM_AI_MODULE`（chat）⇒ **不进任何组**，独立渲染成「② 是否可使用 AI」一行。

   ⚠️ `entries` 为空的模块（`buying`/`accounts`/`reports`…）**不是**漏配 —— 它们是纯数据闸门
      （`accounts` 一只手管 61 条接口），只是侧栏上没有对应页面 ⇒ 行下写「数据权限 · 不影响侧栏」。 */
function synthRows(items, byId) {
  const out = []
  for (const it of items) {
    if (it.module) {
      const m = byId.get(it.module)
      // 后端没下发该模块 ⇒ 不渲染（而不是画一个勾了不生效的行）
      if (!m) continue
      out.push({ ...m, rowName: it.name, fixed: null, note: it.pages || '' })
    } else {
      out.push({ id: '__fixed_' + it.name, label: it.name, rowName: it.name,
                 fixed: it.fixed, entries: [] })
    }
  }
  return out
}

/* v351：**折叠机制整体删除**（`collapsedGroups` / `toggleGroupCollapse` / `collapsed` 字段）。
   老板 2026-10-01 拍板「不折叠」—— 域页签本身就是"点一下就到那一类"的入口，
   再叠一层"先展开再找"是多余的两次点击（原先折叠是因为「更多」那 11 行会淹掉上面 10 个功能，
   现在它们各自在页签里，谁也淹不掉谁）。 */
const permGroups = computed(() => {
  /* 🔴 v350 结论保留：**组内行 = 全量模块**，与搜索词无关（搜索只影响"淡化"，见 `searchHitKeys`）。
     于是"整组/整行的作用范围"、用户所见、DOM 里真实存在的行，是**同一份 `items`**
     —— 这正是它比"过滤 + 另存 allItems"更稳的地方：没有第二份需要同步的列表。
     🔴 v351：**加 `tab`（域页签上的短名）** —— 组名「更多（子页面与数据权限）」当页签名太长，
        但**单一源仍在 `permView.js`**（本页不另定义短名，否则又是同一条规则抄两份）。 */
  const byId = new Map(modules.value.map(m => [m.id, m]))
  const out = []
  for (const g of PERM_SIDEBAR_GROUPS) {
    const items = synthRows(g.items, byId)
    if (items.length) out.push({ name: g.name, tab: g.tab || g.name, items })
  }
  const more = synthRows(PERM_MORE_GROUP.items, byId)
  if (more.length) {
    out.push({ name: PERM_MORE_GROUP.name, tab: PERM_MORE_GROUP.tab || PERM_MORE_GROUP.name, items: more })
  }
  return out
})

/* ---- v351：详情视图（本页**唯一**的读写视图）用的三个派生量 --------------------------
   🔴 域页签只是**导航**，不是"筛选" —— 它一次只显示一个域的行，页面上**没有任何批量控件
      跨域作用**（「整行全选」只作用于它自己那一行）⇒ 不存在 v350 那种"作用范围 ≠ 所见"的风险。
      这也是能放心用页签、而不必像搜索那样"淡化"的原因。 */
/** 当前正在配置的角色对象（登录端卡片要用它的 `end` / `end_is_custom`）。 */
const curRole = computed(() => permRoles.value.find(r => r.name === permDetailRole.value) || null)
/** 生效的域：用户选过就用它，否则**默认第一个**（模块表异步到达，不能把默认值写死成某个组名）。 */
const curDomain = computed(() => {
  const gs = permGroups.value
  if (!gs.length) return null
  return gs.find(g => g.name === detailDomain.value) || gs[0]
})
/** 当前域的行（含 `module: null` 的只读固定行 —— 它们**必须**显示，只是不给勾选框）。 */
const detailRows = computed(() => (curDomain.value ? curDomain.value.items : []))
/** 域页签上的数字：没搜索时 = 该域行数；搜索时 = **命中数**（无命中的域自然露出 0，
 *  ⇒ 用户知道该点哪个页签，不会以为"搜索没反应"）。 */
function domainCount(g) {
  const s = searchHitKeys.value
  if (!s) return g.items.length
  return g.items.filter(m => s.has(m.id)).length
}

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

/* v351：**组头整组勾选已删除**（`groupChecked` / `toggleGroup`）。
   它们只服务于横向矩阵（"角色 × 组"的一格勾一整组）。矩阵撤掉后，详情视图是**按角色**的，
   一行只有一个角色，已经没有"整组"这个概念 —— 保留它就是留一条没有界面的写路径。 */

/* 🔴 v350 搜索 = **查找**，不是筛选。
   为什么最终是"淡化"而不是"过滤" —— 中间版本踩过两次，记下来免得再犯：
     ① 拿 `moduleQuery` 过滤行 ⇒ 它是**跨视图共享**的同一个 ref，在「批量总览」里搜过之后
        切到「按角色配置」，整个矩阵只剩 1 行（用户会以为权限丢了）；
     ② 把搜索限制在矩阵视图 + 给组头另存一份 `allItems`（让"整组勾选"作用于整组）——
        看着对了，实则更糟：过滤态下**未命中的行根本不在 DOM 里** ⇒ 点组头会
        **静默改掉用户看不见的行**（原来只是组头状态显示得不准，现在是改错了东西）。
   ⇒ 终版：所有行始终在 DOM，命中的正常显示、其余**淡化**。
   v351：搜索框现在只在**详情视图**里（矩阵已撤），判据随之改为 `permView !== 'detail'` 返 `null`
      —— 这个"视图守卫"刻意保留：`moduleQuery` 仍是跨视图共享的 ref，将来若再加视图，
      不守就会重演 ①。
   ⚠️ 匹配**行名**（`rowName`，老板看到的那个名字）**或**后端模块名 ——
      只比 `label` 会漏：行名「目标与返利」对应的后端名是「销售管理」，搜前者原本搜不到。 */
const searchHitKeys = computed(() => {
  const q = moduleQuery.value.trim().toLowerCase()
  if (!q || permView.value !== 'detail') return null   // null = 不做淡化
  const s = new Set()
  for (const g of permGroups.value) {
    for (const m of g.items) {
      const row = (m.rowName || '').toLowerCase()
      const lbl = (m.label || '').toLowerCase()
      if (row.includes(q) || lbl.includes(q)) s.add(m.id)
    }
  }
  return s
})
function isDimmed(m) {
  const s = searchHitKeys.value
  return !!s && !s.has(m.id)
}

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
    /* 🔴 v350 P0：**拆掉 `Promise.all` 的耦合**（这是"权限页永久锁死"的直接成因）。
       原先任一请求失败 ⇒ 整个 try 落进 catch ⇒ `permRoles.value = []` ⇒ 页面一片空白，
       而它**正是唯一能把权限改回来的页面**（自救通道被自己掐断）。
       病根：本页依赖的「模块清单」`/api/permissions/modules` 映射到 `hr`，
       与它管理的对象**同一条模块轴** ⇒ boss 的 `hr` 一旦被撤，页面就再也打不开。
       拆开后：角色列表不依赖模块表也能渲染（详情走 `/detail`，是独立端点，且已豁免模块判定）；
       最坏退化成"功能模块那一栏空着 + 一句提示"，而不是白屏。
       ⚠️ 拉不到模块表 ⇒ `known` 为空 ⇒ 下面的"必选模块回补"不生效（不知道有哪些模块就不瞎补），
          且 `permGroups` 全空 —— 这是**看得见**的降级，不是静默失效。 */
    const r = await api('/api/role-permissions')
    let m = { modules: [] }
    try {
      m = await api('/api/permissions/modules')
    } catch (e2) {
      toast('功能模块清单读取失败（' + ((e2 && e2.message) || '') + '）：权限页将以受限模式显示', 'warn')
    }
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

/* v351：矩阵的 `togglePerm`（按模块整体勾选）已删除 —— 它只服务于横向矩阵。
   详情视图有自己的动作级写法（`toggleDetail` / `toggleRowAll` / `toggleAi`），
   而且**必须**用动作级：`/detail` 端点是 dict 形态，用模块级勾选会丢动作粒度。
   🔴 保留 `roleHas`：它仍被「查看对比」只读弹窗使用（那里只判"有没有这个模块"）。 */

/* ---- v334：单角色细粒度配置（模块 × 动作）-----------------------------------------
   数据源是**专门的端点** `GET /api/role-permissions/detail`。
   🔴 为什么保存必须走 `/detail`（dict 形态）：
      在细粒度界面上，用户表达的是"这个模块只给查看、不给改" —— list 形态**装不下**这个意图。
      后端已做形态收敛 + 合并（`core.normalize_perms_shape` / `merge_module_list_into`），
      所以选 dict 端点是**语义最完整**的那条路。
   🔴 v351：`/api/role-permissions`（list 形态）在本页**只剩读取**（`loadPerms` 拿角色清单与
      登录端），**不再有任何写入** —— 这是路线 A 的核心：一个写路径，不可能两边打架。 */
function openRoleDetail(name) {
  permDetailRole.value = name
  permView.value = 'detail'
  detailDomain.value = ''      // v351：换角色时回到第一个域（避免停在上一个角色看过的域）
  moduleQuery.value = ''       // v351：不把上一个角色的搜索词带过来
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
  /* 🔴 v350 P0：必选项的**第二道**校验（渲染层已 `disabled`）。
     为什么两层都要：`disabled` 只挡鼠标，挡不住"渲染后角色被换掉"的窗口期，
     也挡不住将来有人重写模板时漏掉 `:disabled` —— 而这一漏就是**权限页永久自锁**。
     v351：矩阵视图撤掉后，`isLockedModule` 已是本页**唯一**的写判据（不再有第二处实现）。 */
  if (isLockedModule(permDetailRole.value, mid)) return
  const cur = { ...(permDetail.value[mid] || {}) }
  cur[act] = !!ev.target.checked
  permDetail.value = { ...permDetail.value, [mid]: cur }
}

/** 该模块的四个动作是否**全**勾上（决定"整行"按钮显示什么、以及点下去做什么）。 */
function rowAllOn(mid) {
  const cur = permDetail.value[mid] || {}
  return permActions.every(a => !!cur[a])
}

/** 该模块**是否有任意一个动作**（「允许使用 AI」那个单勾读它）。
 *  🔴 不读某个固定动作（比如 `read`）：后端判"这个模块给不给"看的是**有没有动作**，
 *     挑一个写死就会造出"看起来关着、其实开着"的假开关。 */
function detailModuleOn(mid) {
  const cur = permDetail.value[mid] || {}
  return permActions.some(a => !!cur[a])
}

/** 把某模块的四个动作**整体**置为开/关。
 *  🔴 唯一的"一次改多个勾"的实现 —— `toggleRowAll` 与 `toggleAi` 都走它，
 *     不会出现两处各写一遍、日后只改一处的情形。调用方**必须**先过 `isLockedModule`。 */
function setModuleAll(mid, on) {
  const cur = {}
  for (const a of permActions) cur[a] = on
  permDetail.value = { ...permDetail.value, [mid]: cur }
}

function toggleRowAll(mid) {
  /* 🔴 v350 P0：本函数对必选项尤其危险 —— 它把整行 4 个勾**一次改掉**。
     老板的 `hr`（员工管理）在矩阵视图里是锁死的，但本视图原先点一下「取消整行」就全没了。
     ⇒ 与 `toggleDetail` 共用同一个判据（单一实现）。 */
  if (isLockedModule(permDetailRole.value, mid)) return
  setModuleAll(mid, !rowAllOn(mid))
}

/** 「允许使用 AI」的单勾（v351 独立成块）。
 *  ⚠️ 它写回的仍是**模块 `chat` 的四个动作**（`PERM_AI_MODULE`）—— 后端零改动，
 *     而"整模块开/关"正是矩阵时代那个勾的语义（`role.perms` 里有没有 `chat`）。
 *  ⚠️ 刻意**不**为它加 `isLockedModule` 判断：`chat` 不在 `CRITICAL_MODULES` 里，
 *     加了反而会掩盖"以后谁把它加进 CRITICAL_MODULES 就该同步上锁"这件事 ——
 *     真要上锁，加的是同一份 `CRITICAL_MODULES`，判据仍然只有一份。 */
function toggleAi(ev) {
  setModuleAll(PERM_AI_MODULE, !!ev.target.checked)
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
    /* 🔴 v350 P0：**提交前强制回补**保护角色的关键模块 —— 这是"自我锁死"的最后一道闸。
       即便界面被绕过（旧缓存包、脚本调用、将来新增的视图），也不会把 boss 的 `hr` / `data` 写空。
       判据与界面上的 `isLockedModule` **同源**（`PROTECTED_ROLES` × `CRITICAL_MODULES`）。
       ⚠️ 为什么不能只靠界面 `disabled`：库里**已经**可能有一份被改坏的配置，
         那种租户只有靠"再保存一次"才能自愈 —— 而详情页是唯一能写 dict 形态的入口。 */
    if (PROTECTED_ROLES.includes(name)) {
      const known = new Set(modules.value.map(x => x.id))
      for (const c of CRITICAL_MODULES) {
        if (known.has(c) && !(perms[c] && perms[c].length)) perms[c] = [...permActions]
      }
    }
    await api('/api/role-permissions/detail', {
      method: 'POST',
      body: { role_name: name, permissions: perms },
    })

    /* 🔴 v351：登录端**并入本页保存**。
       原先它由矩阵那个「保存权限」按钮连同所有角色一起提交；矩阵撤掉后，登录端卡片就在
       本页顶部，用户点了「保存」却只存了功能权限、登录端没存 —— 那就是**界面说假话**。
       ⚠️ 只在真改过时才发请求（与加载时快照 `endBase` 比对）：既省往返，
          也避免"给每个角色都写一行"（`end_is_custom` 是拿"有没有这一行"当判据的）。 */
    const role = permRoles.value.find(r => r.name === name)
    let endSaved = false
    if (role && endKey(role.end) !== role.endBase) {
      await api('/api/role-permissions/end', {
        method: 'POST',
        body: { role_name: name, allow_web: !!role.end.web, allow_mini: !!role.end.mini },
      })
      endSaved = true
    }

    /* 🔴 v350 P0-2（切视图静默丢输入）：**不 `loadPerms(true)` 整表重拉**。
       原先重拉会把 `permRoles` 整个重建 ⇒ 别处尚未保存的勾选**全丢且零提示**。
       改为**只增量更新本角色**：`perms` 的键 ≡ 该角色拥有的模块。
       ⚠️ v296 纪律「不认识 ≠ 丢掉」在这里同样成立：`permRoles[].perms` 可能带着
         `_ALL_MODULES` 之外的遗留键（它们只用于逐字回传），增量更新时**必须原样保留**。 */
    if (role) {
      const knownIds = new Set(modules.value.map(x => x.id))
      const legacy = (role.perms || []).filter(p => !knownIds.has(p))
      role.perms = [...Object.keys(perms), ...legacy]
      /* 登录端就地更新快照与「已改过」标记（**不重拉**）：
         走到这里说明 `endKey(end) !== endBase`，即用户确实改过 ⇒ 它现在与本租户的覆盖行
         一致。把 `end_is_custom` 置真只是让「恢复默认」按钮露出来 —— 那是个**只读安全**的
         保守方向（多露一个按钮 ≠ 少存一次改动）。反过来说，若要在这里把它置回假，
         就得知道"内置默认是什么"，那等于在本页再推一份 `ROLE_END`，是同一规则抄两份。 */
      role.endBase = endKey(role.end)
      role.end_is_custom = true
    }
    await syncStorePerms()
    toast('「' + roleLabel(name) + '」的权限已保存' + (endSaved ? '（含登录端）' : ''), 'success')
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

/* v351：**`savePerms`（矩阵的「保存权限」批量提交）整体删除**。
   它是本页唯一的 list 形态写入口 —— 路线 A 要的就是"一个角色一个写路径"：
     · 功能模块 → 详情页 `POST /api/role-permissions/detail`（dict 形态）
     · 登录端   → 详情页 `POST /api/role-permissions/end`（单角色，随保存一起走）
   🔴 删掉它的**直接收益**：`POST /api/role-permissions`（list 形态）在本页不再有调用方。
      那个端点与 `/detail` 写的是**同一行**，两套形态并存正是 v350 自锁缺陷的土壤。
   ⚠️ 端点本身**保留**（后端不动、其它调用方不动）—— 这里删的只是本页的调用。

   同批删掉的还有「全部保存」这条路径带来的一个老问题：它需要"批量未保存状态"这个概念
   （勾了没存、切走了就丢），而 v350 的 P0-2 就是在给这个概念打补丁。
   **现在每次改动都落在某一个角色上、点保存即入库 ⇒ "未保存的批量勾选"这个概念消失了。** */

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

/* ---- v417k：表格密度 ----
   🔴 为什么云端写失败也要给用户看见（不能只 console.warn）：
   用户是**显式点了按钮**，预期就是"存上了"。若弱网时静默只改本机，
   换台电脑又跳回舒适档，用户会认为是 bug 而不是网络问题 —— 且无法自查。
   故云端失败时如实提示「本机已生效、云端没存上」，把两件事讲清楚。 */
const densityLabel = computed(() => density.value === 'compact' ? '切换为舒适' : '切换为紧凑')
const densityHint = computed(() =>
  density.value === 'compact' ? '当前紧凑：行高更小，一屏能多看几行' : '当前舒适：行高宽松，看得更清楚'
)
async function switchDensity () {
  const next = density.value === 'compact' ? 'cozy' : 'compact'
  const saved = await setDensity(next)
  if (saved) toast(next === 'compact' ? '已切换为紧凑' : '已切换为舒适', 'success')
  else toast('本机已切换，但没能存到云端 —— 换台设备可能会跳回原样', 'warn')
}

onMounted(() => {
  // v427：改为 URL 驱动（见上方 applySettingsTab）。
  //   旧注释里的白名单与 onboard 处理已并入 normSettingsTab（不在名单里的落到默认「账号与组织」）。
  applySettingsTab()
})
</script>

<style scoped>
/* 卡片内距由全局 .card{padding:18px} 兜底（见 variables.css「通用卡片」），
   本页不再重复定义；下方 .toolbar 的 14px 16px 为工具栏专用紧凑间距，特异性更高、保持覆盖。 */

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
.pm-mod-lb{font-size:12.5px;color:var(--t1);line-height:1.5}
/* v333：模块行下面的「对应页面」—— 让老板按页面名找到开关。
   刻意做得比模块名更淡更小（它是**索引**不是正文），且不加背景/边框，
   否则一整列小色块会把表格又切碎（样式纪律见文件头那段）。 */
.pm-mod-pages{font-size:11px;color:var(--t3);line-height:1.45;margin-top:1px}
/* v349：三种副文案要**分得开**，否则老板看不出"这一个到底能不能勾"：
     · `pm-mod-pages`  = 对应页面（可勾行）／数据权限说明
     · `pm-mod-fixed`  = 只读固定行 —— **不给勾选框**，用强调色把"为什么不能关"说清
     · `pm-fixed-mark` = 勾列里那个「不在此配」占位（替代勾选框，避免空格子被当成"没配"） */
.pm-mod-fixed{font-size:11px;color:var(--t2);line-height:1.45;margin-top:2px;opacity:.85}
.pm-mod-nopage{font-style:normal;opacity:.75}
.pm-fixed-mark{font-size:10.5px;color:var(--t3);opacity:.7;white-space:nowrap}
/* v350：搜索 = **查找**而非筛选 —— 未命中的行「淡化」而不是消失。
   行永远在 DOM 里，「整行全选」的作用范围才 ≡ 用户所见。
   用 `td` 而不是 `tr`（tr 上的 opacity 会影响行背景与边框的表现，各浏览器不一致）。 */
.pm-row-dim td{opacity:.32}
/* 搜索框旁的命中数 —— 没有它，"其余行变淡"会被当成搜索没反应。 */
.tb-hit{font-size:12px;color:var(--t3);white-space:nowrap}
/* ==================== v334（2026-09-30）：角色列表 + 单角色细粒度权限 ====================
   对标舟谱的「角色列表 → 点进某角色细配」两步式。样式纪律沿用本文件既有约定：
   颜色**一律走 CSS 变量**（`--t1/--t2/--t3`、`--bd`、`--bg2/--bg3`、`--p-*`），
   **不写死色值** —— 写死会在深色模式下变成不可读的白底黑字
   （本仓专门修过一轮深色模式：原生控件白底、下拉列表白底都是同一类病）。 */
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
/* 「整行全选 / 取消整行」是 4 个字，88px 的列里会折成两行 ⇒ 不换行 + 略放宽列宽。
   🔴 折行不只是难看：它让每一行的高度随文案变化，扫读时"行"的边界会漂。 */
.perm-detail-table .ctr button{white-space:nowrap}
/* v328 批次 ⑥：新建角色表单（v351 跟着「新建角色」按钮从矩阵挪到角色列表页）。 */
.pm-new{margin:0 0 10px;padding:10px 12px;border:1px solid var(--bd);border-radius:var(--radius-md);background:var(--bg2)}
.pm-new-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pm-new-name{width:180px}
.pm-new-tip{font-size:11.5px;color:var(--t3);margin:7px 0 0;line-height:1.6}
.ctr{text-align:center}
.pm-col-hd{font-size:12.5px;font-weight:600;color:var(--t1);margin-bottom:4px}

/* v331c（2026-09-29）：分节标题行（v351 起只用于「查看对比」只读弹窗）。
   🔴 分节标题由「整行色带」改成「左侧层级小标题」—— 老板原话：那条铺满表宽的横条
      「把整个界面分成上下两块，非常不美观」。
   ⚠️ 仍用 `td` 而不是 `th`（它在 tbody 里，随内容滚动）；仍要与普通行明确区分，
      否则老板会把「登录端」读成又一个功能模块。 */
.pm-sec td{background:transparent;border-top:1px solid var(--bd);color:var(--t1);font-size:12.5px;font-weight:600;padding:14px 10px 5px}
.pm-sec:first-child td{border-top:0;padding-top:2px}
.pm-col-sub{font-size:11px;color:var(--t3);margin-bottom:2px}
/* v328 G4：自定义角色的标记要能被看见（它是"为什么勾了没反应"的答案所在）。 */
.pm-col-custom{color:var(--warn,#b7791f);cursor:help}

/* ==================== v351（2026-10-01）路线 A：单一写入口 + 只读对比 ====================
   🔴 样式上的核心主张：**用户看见的边界 = 实际的写边界**。
      路线 A 的全部意义是"一个角色只有一处能改"，所以详情页刻意分成三张卡
      （登录端 / 功能权限 / 允许使用 AI）—— 每一张都是一个可写的边界，不会再出现
      "这张表里有些格子改了不算数"那种界面。 */

/* 详情页头那一小句职责（走 `roleDuty`，与员工档案同一个来源 —— 不另写文案）。 */
.tb-sub{font-size:12px;color:var(--t3)}

/* 登录端（置顶卡片）：一行一个开关 + 一行"新账号默认值"小结。
   与下面那张功能权限表**刻意长得不一样** —— 它是"从哪儿进来"（角色政策），
   不是"进来之后能干什么"，两者正交（v331c 定的口径，v351 只是把它从矩阵搬到这里）。 */
.end-row{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:13px;color:var(--t1);cursor:pointer}
.end-row input[type="checkbox"]{width:15px;height:15px;cursor:pointer}
.end-sum{margin-top:8px;padding:8px 12px;border-radius:var(--radius-md);background:var(--bg2);
         font-size:12.5px;color:var(--t2)}

/* 域页签（经营 / 核算 / 配置 / 更多）—— 取代"一条长列表 + 默认折叠「更多」"。
   🔴 做成**胶囊**而不是下划线页签：它与页面顶部那个「账号 / 权限 / AI」主标签页**层级不同**
      （主标签换的是整页内容，这里只换一张卡里的一张表）。长得一样会让老板以为"点一下整页都换了"。
   ⚠️ 「更多」**不折叠**（老板 2026-10-01 拍板）：页签已经解决了"11 行淹掉 10 个功能"的问题，
      再叠一层展开/收起就是多余的两次点击。 */
.domtabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}
.domtabs button{border:1px solid var(--bd);background:var(--bg);color:var(--t2);
  border-radius:999px;padding:5px 14px;font-size:13px;cursor:pointer;transition:all .15s}
.domtabs button:hover{border-color:var(--p);color:var(--p-dark)}
.domtabs button.on{background:var(--p-bg);border-color:var(--p);color:var(--p-dark);font-weight:600}
/* 页签上的数字：没搜索时 = 该域有几行；搜索时 = 命中几个。
   无命中的域会自然露出 0 ⇒ 用户知道该点哪个，不会以为"搜索没反应"。 */
.domtabs .cnt{color:var(--t3);font-weight:400;margin-left:3px;font-size:12px}
.domtabs button.on .cnt{color:var(--p-dark);opacity:.75}

/* ---- 只读对比弹窗（原「批量总览」的"看"那一半）----
   🔴 里面**只有 ✓ / —**，没有任何 input / 写绑定 —— 结构上不可能从第二个地方改权限。
   ⚠️ 遮罩点空白处关闭；`position:fixed` 不依赖父级是否有 transform/overflow。 */
.cmp-mask{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:900;
          display:flex;align-items:center;justify-content:center;padding:24px}
.cmp-dlg{background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-lg);
         width:min(1080px,96vw);max-height:86vh;overflow:auto;padding:18px;
         box-shadow:0 18px 48px rgba(0,0,0,.28)}
.cmp-wrap{overflow:auto;max-height:calc(86vh - 150px)}
.cmp-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
.cmp-table th,.cmp-table td{padding:7px 10px;border-bottom:1px solid var(--bd);text-align:left;white-space:nowrap}
.cmp-table th{font-weight:600;color:var(--t2);background:var(--bg3);position:sticky;top:0;z-index:1}
.cmp-table .ctr{text-align:center}
/* 第一列（权限项）横向滚动时钉住 —— 否则角色一多就不知道自己正在看哪一行。 */
.cmp-table .cmp-first{position:sticky;left:0;background:var(--bg);z-index:2}
.cmp-table thead .cmp-first{background:var(--bg3);z-index:3}
.cmp-mark{font-size:13px;color:var(--t3)}
.cmp-mark.on{color:var(--suc);font-weight:700}

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
