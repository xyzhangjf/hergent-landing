<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>员工档案</h2>
        <span class="page-sub">维护员工底薪与登录账号权限（网页端 / 小程序通用）· 支持手动录入与 Excel 批量导入</span>
      </div>
      <div class="sync-wrap">
        <span class="sync-state" :class="connState">{{ connLabel }}</span>
        <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" :disabled="syncBusy" @click="onSync">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          {{ syncBusy ? '同步中…' : '同步' }}
        </button>
      </div>
    </div>

    <!-- v308 外部客户账号（分销商）· v317（2026-09-29）版式与「在职员工」对齐：
         页头「＋ 新建外部客户」+ **常驻列表**。
         🔴 为什么撤销「默认收起」：收起时整块只剩一行标题，老板看到的现象是
         「已经开好的账号**没有展示**」—— 一个默认折叠等于把唯一入口藏起来。
         空间代价很小（空态只占一行），但少了整整一类用户「找不到自己刚建的号」的故障。 -->
    <div class="card df-panel">
      <div class="panel-hd df-ph">
        <b>外部客户账号</b>
        <div class="df-ph-right">
          <span class="tag info">不是员工 · 默认只开小程序</span>
          <button v-if="canDo('data', 'create')" class="btn btn-primary btn-sm" :disabled="extBusy" @click="openExtCreate">＋ 新建外部客户</button>
        </div>
      </div>
      <p class="df-tip">
        给<b>外部客户（分销商）</b>开一个只用来报单的登录账号：不建人事档案、不算工资。
        开完号还要去 <b>预报订单管理 → 报单配置</b> 把<b>他的门店</b>配给他，小程序里才有东西可选。
      </p>

      <div v-if="extLoading" class="state-empty">加载中…</div>
      <div v-else-if="extAccounts.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>客户</th><th>登录账号</th><th>可登录端</th>
            <th class="num" title="在「预报订单管理 → 报单配置」里为该客户配的门店数；配了小程序才报得了单">可报门店</th>
            <th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="u in extAccounts" :key="u.id" :class="{ stopped: !u.is_active }">
              <td>{{ extNameOf(u) }}</td>
              <td>{{ u.username }}</td>
              <td>{{ loginScopeLabel(u.login_scope) }}</td>
              <td class="num">
                <!-- v317：`null` = **读数不可用**（租户库查询失败）必须与 `0`（真·没配）分开展示 ——
                     把「不知道」渲染成「未配 · 去配置」就是用未知冒充结论（静默撒谎）。 -->
                <span v-if="u.report_mapping_count > 0">{{ u.report_mapping_count }} 家</span>
                <span v-else-if="u.report_mapping_count === null || u.report_mapping_count === undefined"
                      class="df-no" title="读取报单配置失败，请刷新重试">—</span>
                <button v-else class="df-mini-lnk" @click="goReportConfig">未配 · 去配置</button>
              </td>
              <td><span :class="u.is_active ? 'on' : 'off'">{{ u.is_active ? '启用中' : '已禁用' }}</span></td>
              <td class="df-ops">
                <!-- v335 按钮级门禁：外部客户账号走 /api/users/* ⇒ 后端模块 **data**（不是本页的 hr）
                     编辑=PUT display-name · login-scope ⇒ update；禁用·启用=PUT /api/users/{uid}/status ⇒ update -->
                <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" :disabled="extBusy" @click="openExtEdit(u)">编辑</button>
                <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" :class="{ danger: u.is_active }" :disabled="extBusy" @click="toggleExtAccount(u)">{{ u.is_active ? '禁用' : '启用' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">还没有外部客户账号 —— 点右上角「＋ 新建外部客户」开通</div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd df-ph">
        <b>在职员工</b>
        <div class="df-ph-right">
          <span class="tag info">工资按档案底薪算</span>
          <button v-if="canDo('hr', 'create')" class="btn btn-primary btn-sm" @click="openCreate">＋ 添加员工</button>
        </div>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="employees.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>员工</th><th>岗位</th><th class="num">底薪/月</th>
            <th>登录账号</th><th>可报门店</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="e in employees" :key="e.id" :class="{ stopped: e.is_active === 0 }">
              <td>
                {{ e.name }}
                <span v-if="e.employee_no" class="df-no">{{ e.employee_no }}</span>
                <span v-if="e.is_active === 0" class="df-no stopped-tag">已停用</span>
              </td>
              <td>{{ e.position || '—' }}</td>
              <td class="num">¥{{ fmt(salaryOf(e)) }}</td>
              <td>
                <span v-if="e.has_account" class="df-acc" :class="{ on: e.account_active }" :title="'账号：' + e.account_username + (e.account_active ? '（启用中）' : '（已禁用，点「编辑」可重新启用）')">已开通 {{ e.account_username }}</span>
                <span v-else class="df-acc">未开通</span>
                <span v-if="e.account_role" class="df-role" :class="['r-' + e.account_role, { stopped: e.is_active === 0 }]">{{ roleDisplay(e.account_role) }}</span>
                <span
                  v-for="r in extraRolesOf(e)"
                  :key="'x-' + r"
                  class="df-role df-role-extra"
                  :title="'兼任角色：' + roleDisplay(r)"
                >+{{ roleDisplay(r) }}</span>
              </td>
              <!-- v381（2026-10-06）：个人仓列**已移除** —— 「设个人仓」的唯一入口搬到
                   「预报订单管理 → 报单配置」（老板拍板 Q2=B：弹窗与列表列都撤）。
                   理由与 2026-09-19「门店」那次收敛同源：它本就是报单域的属性，
                   且它的**唯一读取方**是 `report_mapping_create/update` 的本人仓分支。
                   在这里留一列只读展示，只会让用户以为"要在这儿改"。 -->
              <!-- 2026-09-19 收敛：门店配置入口已移出员工档案，本列只读展示数量。
                   数据 = 报单配置派生 ∪ 历史授权（见后端 employee_stores_get）。 -->
              <td class="num" title="在「预报订单管理 → 报单配置」里为该员工配门店，配了即授权其小程序可报">  {{ (e.store_ids || []).length }} 家</td>
              <td class="df-ops">
                <!-- v335 按钮级门禁：员工主档走 /api/employees/* ⇒ 模块 **hr**
                     编辑=PUT /api/employees/{eid} ⇒ update
                     停用·启用=**POST** /api/employees/{eid}/toggle ⇒ hr/**create**（动作由 HTTP 方法推导） -->
                <button v-if="canDo('hr', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(e)">编辑</button>
                <button v-if="e.is_active !== 0 && canDo('hr', 'create')" class="btn btn-ghost btn-sm danger" @click="askDisable(e)">停用</button>
                <button v-else-if="canDo('hr', 'create')" class="btn btn-ghost btn-sm" @click="employeeToggle(e.id, 1)">启用</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">还没有员工档案，先添加或从 Excel 导入</div>
    </div>

    <!-- 开账号已整合进「编辑员工」弹窗（见下方 edit-modal 的"登录账号"区） -->

    <!-- 2026-09-19：「分配门店」弹窗已移除 —— 门店配置收敛到「预报订单管理 → 报单配置」。
         在那里按「员工 × 门店」建一条报单映射，即等于授权该员工小程序可报该门店
         （后端 employee_stores_get 从报单配置派生可见范围）。
         员工档案只保留只读的「可报门店」数量列，避免两个入口配同一件事、且互不感知。 -->

    <!-- Excel 批量导入 -->
    <div class="card df-panel">
      <div class="panel-hd"><b>Excel 批量导入员工</b><span class="tag info">按模板整理后上传</span></div>
      <p class="df-tip">下载模板，按 <code>姓名* | 工号 | 岗位 | 底薪/月 | 社保基数 | 银行账号</code> 填写，用 Excel 打开后<b>另存为 .xlsx</b> 再上传。</p>
      <div class="df-import-row">
        <button class="btn btn-ghost" @click="downloadEmpTemplate">下载模板</button>
        <!-- v335 按钮级门禁：整条导入链的写动作是 POST /api/import/execute ⇒ data/create；
             「下一步」是只读预览（后端 `_READ_ONLY_POST`）⇒ 不门禁，但选文件一并收起，
             免得一路填到最后才发现「确认导入」不见了。 -->
        <label v-if="canDo('data', 'create')" class="btn btn-ghost df-file-btn">
          选择文件
          <input type="file" accept=".xlsx,.xls" style="display:none" @change="onInvFile">
        </label>
        <span v-if="invFileName" class="df-fname">{{ invFileName }}</span>
        <button v-if="impStep === 'pick'" class="btn btn-primary" :disabled="!invFile || importing" @click="previewEmployees">
          {{ importing ? '识别中…' : '下一步' }}
        </button>
      </div>
      <div v-if="impStep === 'map'" class="df-map">
        <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions"
                       :memory="impMemory" v-model:incremental="impInc" />
        <div class="df-import-row">
          <button class="btn btn-ghost" :disabled="importing" @click="impStep = 'pick'">返回</button>
          <button v-if="canDo('data', 'create')" class="btn btn-primary" :disabled="importing" @click="doImportEmployees">
            {{ importing ? '导入中…' : '确认导入' }}
          </button>
        </div>
      </div>
      <ImportReceipt :result="invResult" @undone="loadEmployees()" />
      <p v-if="connState === 'unlinked'" class="df-tip df-warn">未连接 ERP：连接畅捷通/金蝶后，可点上方「同步」拉取外部档案。</p>
    </div>

    <!-- 编辑员工弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="editOpen" class="df-overlay" @click="tryCloseEdit"></div></Transition>
      <Transition name="pop">
        <div v-if="editOpen" class="df-modal edit-modal">
          <div class="df-modal-hd"><b>{{ isCreate ? '新建员工' : ('编辑员工 · ' + (editTarget?.name || '')) }}</b><button class="df-x" @click="tryCloseEdit" aria-label="关闭"><Icon name="close"/></button></div>
          <div class="df-modal-body df-edit-body">

            <!-- 基本信息 -->
            <section class="df-sec">
              <div class="df-sec-title">基本信息</div>
              <div class="df-edit-grid">
                <label class="df-field"><span>姓名 <i class="req">*</i></span><input v-model="editForm.name" class="input"></label>
                <label class="df-field"><span>工号</span><input v-model="editForm.employee_no" class="input"></label>
                <label class="df-field"><span>岗位</span><input v-model="editForm.position" class="input"></label>
                <label class="df-field"><span>入职日期</span><input v-model="editForm.hire_date" class="input" placeholder="2026-03-01"></label>
              </div>
            </section>

            <!-- v381（2026-10-06）：原「报单身份 › 个人仓」分区**已移除**。
                 它搬到了「预报订单管理 → 报单配置」：新建/编辑一条「本人仓」映射时，
                 对象那一格现在是**仓库下拉**，选了即存（后端回写 `hr_employees.warehouse_id`）。
                 ⇒ 会计 / 主管终于能设个人仓了（旧入口归 `hr` 模块，他们进不来、403 被静默吞）。
                 后端 `PUT /api/employees/{eid}` 的 `warehouse_id` 白名单**仍然保留**
                 （兼容脚本与回滚），只是界面不再从这里发。 -->

            <!-- 薪酬与账户 -->
            <section class="df-sec">
              <div class="df-sec-title">薪酬与账户</div>
              <div class="df-edit-grid">
                <label class="df-field"><span>底薪/月</span><input v-model.number="editForm.base_salary" class="input" type="number"></label>
                <label class="df-field"><span>社保基数</span><input v-model.number="editForm.social_insurance_base" class="input" type="number"></label>
                <label class="df-field"><span>公积金基数</span><input v-model.number="editForm.housing_fund_base" class="input" type="number"></label>
                <label class="df-field"><span>社保缴纳城市</span><input v-model="editForm.social_insurance_city" class="input"></label>
                <label class="df-field"><span>身份证号</span><input v-model="editForm.id_card" class="input"></label>
                <label class="df-field"><span>开户银行</span><input v-model="editForm.bank_name" class="input"></label>
                <label class="df-field"><span>银行账号</span><input v-model="editForm.bank_account" class="input"></label>
              </div>
            </section>

            <!-- 登录账号（整合原"开账号"入口：员工的人事档案与登录账号在同一处管理） -->
            <section class="df-sec">
              <div class="df-sec-title">登录账号</div>
              <div v-if="isCreate" class="df-acc-hint">
                <p class="df-tip">保存员工后，可在此为其开通登录账号。</p>
              </div>
              <div v-else-if="!editTarget || !editTarget.has_account" class="df-acc-create">
                <!-- v307：原文案写死「可登录**网页端**与**预报小程序**」，与下面新加的
                     「可登录端」下拉可能相反（选了员工 ⇒ 默认仅小程序）⇒ 改成跟随所选值。
                     这类"同屏两句互相矛盾"的措辞，正是老板得出「权限没生效」结论的来源。 -->
                <p class="df-tip">该员工暂无登录账号。开通后可登录：<b>{{ loginScopeLabel(accForm2.login_scope) }}</b> —— 默认值按所选角色给出，可随时在下方调整；能进哪些页面由角色决定。</p>
                <label class="df-field"><span>手机号 / 账号</span><input v-model="accForm2.username" class="input" placeholder="如 13800000001"></label>
                <label class="df-field"><span>初始密码</span><input v-model="accForm2.password" class="input" type="text" :placeholder="PWD_HINT"></label>
                <label class="df-field"><span>角色 / 权限</span>
                  <select v-model="accForm2.role" class="input acc-role">
                    <option v-for="o in ROLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </label>
                <label class="df-field"><span>可登录端</span>
                  <select v-model="accForm2.login_scope" class="input acc-role" @change="accScopeTouched = true">
                    <option v-for="o in LOGIN_SCOPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </label>
                <!-- v312：把「这个默认值是从哪来的」写出来 —— 它来自「设置 › 权限」里给该角色配的端。
                     不写的话，老板改完权限页来这里看不到变化（或看到旧值），会以为没生效。 -->
                <p class="df-tip df-scope-src">
                  该角色在「设置 › 权限」里配的默认端：<b>{{ loginScopeLabel(roleEndScope(accForm2.role)) }}</b>
                  <template v-if="accScopeTouched && accForm2.login_scope !== roleEndScope(accForm2.role)">
                    ；本次已手工改为 <b>{{ loginScopeLabel(accForm2.login_scope) }}</b>。
                    <button type="button" class="df-mini-lnk" @click="accScopeTouched = false; accForm2.login_scope = roleEndScope(accForm2.role)">改回角色默认</button>
                  </template>
                </p>
                <!-- v335 按钮级门禁：开通账号=POST /api/forecast-submissions/staff-accounts ⇒ data/create -->
                <button v-if="canDo('data', 'create')" class="btn btn-primary btn-block" :disabled="accBusy || !accForm2.username || !pwdOk(accForm2.password)" @click="createAccountInEdit">开通账号</button>
              </div>
              <div v-else class="df-acc-manage df-acc-card">
                <!-- v382（2026-10-06）：**保存单位从「行」改回「整个弹窗」**。
                     这里原先是三套独立保存（保存角色 / 保存可登录端 / 保存基本信息），
                     v290 还给卡片画了边框表达"保存边界到哪儿为止"。但那个设计反复出问题：
                     用户改完档案顺手改角色、只点了其中一个保存 ⇒ 另一处随关窗无声消失
                     （v290 只把它从"必消失"降级成"要确认"）。老板直接要求合并。
                     ⇒ 现在**只有一个保存入口**（弹窗右下角「保存」），一次提交全部改动。
                     卡片保留边框 —— 它现在的语义是**分组**（这块属于登录账号），不再是"保存边界"。 -->
                <div class="df-acc-card-hd">
                  <span class="df-acc-card-t">账号与权限</span>
                  <span v-if="accAnyDirty" class="df-dirty-tag">有未保存的改动</span>
                </div>
                <p class="df-acc-card-tip">下面改完<b>不用单独保存</b> —— 和人事档案一起，点右下角「保存」一次提交。</p>
                <p class="df-acc-sum">登录账号：<b>{{ editTarget.account_username }}</b> · {{ roleDisplay(editTarget.account_role) }}<template v-if="extraRolesOf(editTarget).length">（兼任 {{ extraRolesOf(editTarget).map(roleDisplay).join('、') }}）</template> · <span :class="editTarget.account_active ? 'on' : 'off'">{{ editTarget.account_active ? '启用中' : '已禁用' }}</span> · 可登录：{{ loginScopeLabel(editTarget.account_login_scope || roleEndScope(editTarget.account_role)) }}</p>
                <!-- v382：主角色那一行原来右侧有个「保存角色」按钮 —— 已删（合并到底部「保存」）。
                     补一个「角色」标签：删掉按钮后这一行只剩孤零零一个下拉，与下面「可登录端」
                     那行不对称、也看不出这格是干嘛的。
                     🔴 同时把整行挂到 `canDo('data','update')` 下（与原先按钮同轴）：
                     没有该权限的角色本来也点不动那个按钮，但下拉**当时是可见可改的** ⇒
                     改完却没处存 = "看得见存不了"。宁可看不见。 -->
                <div v-if="canDo('data', 'update')" class="df-acc-row">
                  <span class="df-acc-exp-label">角色</span>
                  <select v-model="accRoleEdit" class="input acc-role">
                    <option v-for="o in ROLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
                <!-- v307 可登录端：默认按岗位给出（如「员工」默认仅小程序），**可手动改**。
                     ⚠️ 两项说明写在界面上，因为它俩正是最容易误解的地方：
                       ① 这只管「能不能登录这个端」，**能看哪些页面仍由角色决定**；
                       ② 改了**不影响已登录的人**，只在他下次登录时生效。 -->
                <!-- v382：这一行原有的「保存」按钮同样已删（合并到底部）。
                     与上面角色行一起挂 `canDo('data','update')`。 -->
                <div v-if="canDo('data', 'update')" class="df-acc-row">
                  <span class="df-acc-exp-label">可登录端</span>
                  <select v-model="accScopeEdit" class="input acc-role" aria-label="可登录端">
                    <option v-for="o in LOGIN_SCOPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
                <!-- v312：**只提示、不自动改**。
                     老板在权限页改了某角色的端之后，这个账号的端不会跟着变（刻意的，见下）。
                     但必须让他**看见**这件事 —— 否则"权限改了但这个人还能用网页端"会被当成没生效；
                     反过来自动改，会把"人为单独给某人开过网页端"的账号静默收窄回小程序，
                     那是"用户被自己锁在门外"那一族的另一种形态。 -->
                <div v-if="accScopeMismatch" class="df-mismatch">
                  <span class="df-mismatch-tag">与角色配置不一致</span>
                  <span class="df-mismatch-txt">角色「{{ roleDisplay(accRoleEdit) }}」现在的默认端是 <b>{{ loginScopeLabel(accScopeDefault) }}</b>，而这个账号是 <b>{{ loginScopeLabel(accScopeEdit) }}</b>。</span>
                  <!-- v335 按钮级门禁：PUT /api/users/{uid}/login-scope ⇒ data/update -->
                  <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" :disabled="accBusy" @click="alignAccScope">按角色对齐</button>
                </div>
                <p class="df-tip">只决定这个账号能从哪里登录；能看哪些页面由上面的角色决定。保存后，该账号<b>下次登录</b>时生效。
                  该角色当前在「设置 › 权限」里配的默认端是 <b>{{ loginScopeLabel(accScopeDefault) }}</b>。</p>
                <!-- v266 角色可叠加：兼任角色**只增加权限**，不改上面的主角色。
                     主角色决定「这个人是干嘛的」（销售只看自己的单、能不能用小程序…）；
                     兼任让一个人同时干两份活（如 业务员 + 库管、会计 + 主管）。 -->
                <div v-if="canDo('data', 'update')" class="df-acc-row df-acc-extra">
                  <span class="df-acc-extra-tip">兼任角色（可多选，只加权限）</span>
                  <div class="df-extra-chips">
                    <button
                      v-for="o in extraRoleOptions"
                      :key="'x-' + o.value"
                      type="button"
                      class="chip"
                      :class="{ on: accRolesEdit.includes(o.value) }"
                      :aria-pressed="accRolesEdit.includes(o.value)"
                      @click="toggleExtraRole(o.value)"
                    >{{ roleDisplay(o.value) }}</button>
                  </div>
                </div>
                <!-- v290（2026-09-27）操作行 + 展开区**上下相邻**。
                     原实现的展开输入框长在这一行的**上方**（中间还隔着「兼任角色」一整块），
                     点完按钮，输入框出现在屏幕另一处 ⇒ 看着像"点了没反应"，用户会连点。
                     现在：按钮行不动，输入框紧贴在它下面长出来（几何距离 ≤ 1 行）。
                     另外「取消改账号 / 取消重置」两个按钮**不再叫"取消"** ——
                     同屏三个"取消"（含底部关窗那个）语义不同，是误点源。 -->
                <div class="df-acc-row df-acc-ops">
                  <!-- v335 按钮级门禁：这三个都是 /api/users/* ⇒ 模块 **data**
                       改登录名  → 保存链路是 PUT /api/users/{uid}/username ⇒ update
                       重置密码  → 保存链路是 POST /api/users/{uid}/password ⇒ **create**
                       禁用·启用账号 → PUT /api/users/{uid}/status ⇒ update -->
                  <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" :class="{ 'is-on': showRename }" :disabled="accBusy" :aria-expanded="showRename" @click="toggleRename">{{ showRename ? '收起' : '改登录名' }}</button>
                  <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" :class="{ 'is-on': showReset }" :disabled="accBusy" :aria-expanded="showReset" @click="showReset = !showReset">{{ showReset ? '收起' : '重置密码' }}</button>
                  <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm danger df-acc-right" :disabled="accBusy" @click="toggleAccStatus">{{ editTarget.account_active ? '禁用账号' : '启用账号' }}</button>
                </div>
                <div v-if="showRename || showReset" class="df-acc-expand">
                  <!-- v288（2026-09-27）：改**登录账号名**。
                       原入口只在「个人设置」里（`PUT /api/auth/profile`）且**只能改自己** ——
                       老板在这里看不到入口，账号名建错只能删账号重建。 -->
                  <div v-if="showRename" class="df-acc-row">
                    <span class="df-acc-exp-label">新登录名</span>
                    <input v-model="accNameEdit" class="input" type="text" placeholder="2-32 个字符" @keyup.enter="renameAcc">
                    <!-- v335 按钮级门禁：PUT /api/users/{uid}/username ⇒ data/update -->
                    <button v-if="canDo('data', 'update')" class="btn btn-primary btn-sm" :disabled="accBusy || !nameDirty" @click="renameAcc">保存登录名</button>
                  </div>
                  <div v-if="showReset" class="df-acc-row">
                    <span class="df-acc-exp-label">新密码</span>
                    <input v-model="accPwdEdit" class="input" type="text" :placeholder="PWD_HINT">
                    <!-- v335 按钮级门禁：POST /api/users/{uid}/password ⇒ data/**create** -->
                    <button v-if="canDo('data', 'create')" class="btn btn-primary btn-sm" :disabled="accBusy || !pwdOk(accPwdEdit)" @click="resetAccPwd">保存密码</button>
                  </div>
                </div>
                <!-- Q29（2026-09-19）生成一次性重置码：员工在小程序「忘记密码」里自己设新密码，
                     管理员全程不知道员工最终密码 —— 比上面的「重置密码」（管理员直接指定明文）
                     责任边界更清楚。业务员/分销商/导购可能只被允许登录小程序、不分配网页端
                     权限，所以这条通道必须在小程序侧闭环。 -->
                <div class="df-acc-row">
                  <!-- v335 按钮级门禁：POST /api/users/{uid}/reset-code ⇒ data/**create** -->
                  <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" :disabled="accBusy || !editTarget.account_active" @click="issueResetCode">生成重置码</button>
                  <span class="rc-tip">线下发给员工 · 30 分钟内有效 · 用一次即废</span>
                </div>
                <div v-if="resetCode" class="df-acc-row rc-box">
                  <b class="rc-code">{{ resetCode }}</b>
                  <button class="btn btn-ghost btn-sm" @click="copyResetCode">复制</button>
                  <span class="rc-exp">{{ resetCodeExp }} 前有效</span>
                </div>
              </div>
            </section>

          </div>

          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="tryCloseEdit">取消</button>
            <!-- v382：**全弹窗唯一保存入口** —— 人事档案 + 登录账号（角色 / 兼任 / 可登录端）
                 一次提交完。原来这三处是三个按钮、三套端点，点漏一个就有一处改动静默消失。 -->
            <button class="btn btn-primary" :disabled="accBusy || !editForm.name.trim()" @click="saveAll">保存</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- v317 新建 / 编辑外部客户账号（分销商）—— 与「新建员工」同一套版式与控件 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="extOpen" class="df-overlay" @click="closeExt"></div></Transition>
      <Transition name="pop">
        <div v-if="extOpen" class="df-modal ext-modal">
          <div class="df-modal-hd">
            <b>{{ extEditId ? '编辑外部客户 · ' + (extForm.name || '') : '新建外部客户' }}</b>
            <button class="df-x" @click="closeExt" aria-label="关闭"><Icon name="close"/></button>
          </div>
          <div class="df-modal-body">

            <section class="df-sec">
              <div class="df-sec-title">客户与登录账号</div>
              <label class="df-field"><span>客户名称 <i class="req">*</i></span>
                <input v-model="extForm.name" class="input" placeholder="如 永辉超市（分销）">
              </label>
              <label class="df-field"><span>登录账号（手机号） <i v-if="!extEditId" class="req">*</i></span>
                <input v-model="extForm.username" class="input" :disabled="!!extEditId" placeholder="如 13800000001">
              </label>
              <label v-if="!extEditId" class="df-field"><span>初始密码 <i class="req">*</i></span>
                <input v-model="extForm.password" class="input" type="text" :placeholder="PWD_HINT">
              </label>
            </section>

            <section class="df-sec">
              <div class="df-sec-title">可登录端</div>
              <label class="df-field"><span>允许登录</span>
                <select v-model="extForm.login_scope" class="input">
                  <option v-for="o in LOGIN_SCOPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
              <p class="df-tip">
                外部客户默认<b>仅小程序</b>。除非确有需要，不要给他开网页端 ——
                网页端能看到整店的经营数据。
              </p>
              <p class="df-tip">
                开通后请到 <b>预报订单管理 → 报单配置</b> 选「报单人 = 该客户」，把<b>他的门店</b>配给他，
                他在小程序里才能报单。
              </p>
            </section>

            <section v-if="extEditId" class="df-sec">
              <div class="df-sec-title">账号操作（不填则不改动）</div>
              <div class="df-acc-row">
                <span class="df-acc-exp-label">新登录名</span>
                <input v-model="extNameEdit" class="input" type="text" placeholder="2-32 个字符">
                <!-- v335 按钮级门禁：PUT /api/users/{uid}/username ⇒ data/update -->
                <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" :disabled="extBusy || !extNameEdit.trim()" @click="renameExtAcc">保存登录名</button>
              </div>
              <div class="df-acc-row">
                <span class="df-acc-exp-label">新密码</span>
                <input v-model="extPwdEdit" class="input" type="text" :placeholder="PWD_HINT">
                <!-- v335 按钮级门禁：POST /api/users/{uid}/password ⇒ data/**create** -->
                <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" :disabled="extBusy || !pwdOk(extPwdEdit)" @click="resetExtPwd">重置密码</button>
              </div>
            </section>

          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="closeExt">取消</button>
            <button class="btn btn-primary" :disabled="extBusy || !extForm.name.trim() || (!extEditId && (!extForm.username.trim() || !pwdOk(extForm.password)))" @click="saveExt">
              {{ extBusy ? '保存中…' : (extEditId ? '保存' : '开通账号') }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 停用确认弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="disableOpen" class="df-overlay" @click="disableOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="disableOpen" class="df-modal">
          <div class="df-modal-hd"><b>停用员工</b><button class="df-x" @click="disableOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip warn-text">确认停用「{{ disableTarget?.name }}」？<br>停用后该员工不再计入工资核算，其登录账号也会被禁用（可随时「启用」恢复）。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="disableOpen = false">取消</button>
            <button class="btn btn-danger" @click="confirmDisable">确认停用</button>
          </div>
        </div>
      </Transition>

      <!-- 离职交接：报单配置转交 -->
      <Transition name="fade"><div v-if="transferOpen" class="df-overlay" @click="transferOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="transferOpen" class="df-modal">
          <div class="df-modal-hd"><b>交接报单配置</b><button class="df-x" @click="transferOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip warn-text">
              「{{ transferEmp?.name }}」名下还有 <b>{{ transferCount }}</b> 个报单配置（门店）。<br>
              这些配置<b>不能随离职作废</b> —— 否则对应门店将无人报单，业务会中断。请转交给接任者。
            </p>
            <label class="df-field">
              <span>转交给 <b class="req">*</b></span>
              <select v-model="transferToId" class="input">
                <option :value="null">— 请选择在职员工 —</option>
                <option v-for="ae in activeEmployees" :key="ae.id" :value="ae.id">
                  {{ ae.name }}<template v-if="ae.employee_no">（{{ ae.employee_no }}）</template>
                </option>
              </select>
            </label>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="transferOpen = false">稍后处理</button>
            <button v-if="canDo('hr', 'create')" class="btn btn-primary" :disabled="transferring || !transferToId" @click="confirmTransfer">
              {{ transferring ? '转交中…' : '确认转交' }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 未连接提醒弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="remindOpen" class="df-overlay" @click="remindOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="remindOpen" class="df-modal">
          <div class="df-modal-hd"><b>尚未连接 ERP</b><button class="df-x" @click="remindOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip">「同步」需要先把你的 ERP（畅捷通 / 金蝶）接入 Hergent。</p>
            <p class="df-tip">请前往 <b>AI 引擎 › 连接器</b> 完成授权连接后，再来点「同步」。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="remindOpen = false">知道了</button>
            <button class="btn btn-primary" @click="goConnect">去 AI 引擎</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import ImportMapping from '../components/ImportMapping.vue'
import ImportReceipt from '../components/ImportReceipt.vue'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { toast, store, canDo } from '../store'
/* v291：页内跳转入口同判据（见 goConnect）。 */
import { canSee } from '../constants/pages'
import { employeeApi, importApi, staffAccountApi } from '../api/modules'
// 角色中文名 —— 前端唯一来源（constants/roles.js 顶部有完整说明与权威源出处）
// v300：另取 `ROLE_END`/`ROLE_END_LABEL`（「适用端」标注的唯一来源）与 `canUseMiniProgram`
//   （降级判据）—— 下拉 label 由它们**生成**，不再手写「小程序」字样。
import { roleName, isCanonicalRole, ROLE_END, ROLE_END_LABEL, canUseMiniProgram,
         LOGIN_SCOPE_OPTIONS, defaultLoginScope, loginScopeLabel,
         ROLE_HINTS } from '../constants/roles'

const router = useRouter()
const loading = ref(false)
const importing = ref(false)
const employees = ref([])
const empStats = ref(null)

/* ---- 员工 ---- */
const isCreate = ref(false)

/* ---- 完整编辑 ---- */
const editOpen = ref(false)
const editTarget = ref(null)
const editForm = reactive({
  name: '', employee_no: '', position: '', hire_date: '', id_card: '',
  bank_name: '', bank_account: '', social_insurance_city: '',
  social_insurance_base: null, housing_fund_base: null, base_salary: null,
  // v381：原「个人仓」字段（`warehouse_id`）已移出本表单 ——
  // 入口搬到「预报订单管理 → 报单配置」（「本人仓」映射的对象那一格）。
  // 理由：它的唯一读取方是 `report_mapping_create/update`，放在员工档案是错位。
})
/* v290（2026-09-27）：「人事档案有没有被改过」的基线快照。
   打开弹窗时由 resetEditForm 存一份，关窗前拿它和当前 editForm 比 —— 见 tryCloseEdit。 */
const formSnap = ref('')
function snapshotForm() { formSnap.value = JSON.stringify(editForm) }

/* ---- 登录账号（整合进"编辑员工"弹窗）与门店 ---- */
/* 角色下拉的**值域**。
 *
 * 🔴 v300（2026-09-27）从「前端写死 8 项」改为「**内置 8 项 + 本租户自定义角色**」。
 *    为什么要改：后端 `core.known_roles(tid)` = 内置 ∪ 本租户自定义，且 `PUT /api/users/{uid}/role`
 *    与开账号接口**都按它放行** —— 但下拉写死 8 项 ⇒ 客户在「设置 › 权限」里配出来的自定义角色
 *    （生产实测：tenant_1 的「库管」真配了 4 个模块）**在下拉里选不到** ⇒
 *    后端通、UI 断，配了没人能用的**死配置**（`users.role` 里 0 个 `库管` 即证）。
 *
 * 值域来源 = `GET /api/role-permissions`（返回 `{内置 ∪ 本租户 custom}`，每项带 `is_custom`）。
 *   ⚠️ 该端点归 `hr` 模块且要求 `role ∈ (admin,boss)`（`core._admin`），而本页可见角色是
 *      `BIZ_ROLES`（含 accountant/sales/supervisor）⇒ 他们拉不到是**预期**，此时**静默降级为
 *      内置 8 项**（与改动前完全一致：不报错、不闪错）。这不算缺陷 —— 角色指派本就是
 *      admin/boss 的活（后端两处写入口都只放行 admin/boss）。
 *
 * 「适用端」标注不再是手写文案，而是由 `ROLE_END`（唯一来源）**生成** —— 它的键集有护栏，
 * 会与后端「持有 `data`/`*`」的角色集逐项比对（`role-registry-consistency-check.py` D 段）。
 * 顺序：先小程序主力（员工 / 主管 / 业务员），再网页端专用，最后两个全权限角色。 */
const BUILTIN_ROLE_ORDER = ['staff', 'distributor', 'supervisor', 'sales', 'guide', 'driver', 'accountant', 'boss', 'admin']
// v328：这段已上提到 `constants/roles.js::ROLE_HINTS`（权限页与档案页共用同一份名字与职责，
//   不再各写一套）。改文案请去那里改，别在这里再建一份。
/** 后端实况：`{角色: {modules:[], is_custom}}`；`null` = 尚未/无权加载 ⇒ 降级为内置 8 项。 */
const roleCatalog = ref(null)
async function loadRoleCatalog() {
  try {
    const r = await api('/api/role-permissions')
    const out = {}
    for (const [name, v] of Object.entries(r.roles || {})) {
      out[name] = {
        modules: Array.isArray(v.permissions) ? v.permissions : Object.keys(v.permissions || {}),
        is_custom: !!v.is_custom,
        // v312：该角色**实际生效**的默认可登录端 —— 后端 `core.role_end_for` 已把
        //   「租户覆盖 ⊕ 出厂默认」合好，前端**不要**再自己合一遍（那会造出第二份判据）。
        scope: v.default_login_scope || '',
      }
    }
    roleCatalog.value = out
    // v312：角色表是**异步**到的 ⇒ 若此刻开账号表单正开着、且用户没手工动过「可登录端」，
    //   就把预览刷新成本租户实况。否则会出现"我在权限页刚配完端，来这里开号却还是旧值"，
    //   而用户会据此认定"权限没生效"。
    if (!accScopeTouched.value) accForm2.login_scope = roleEndScope(accForm2.role)
  } catch (_) {
    roleCatalog.value = null      // 403 / 网络异常 ⇒ 降级（不弹错；指派角色本就不该由这些角色做）
  }
}
/** 「能在小程序干活」的判据 = 有 `data` 或 `*`（与 `roles.js::ROLE_END` 同源）。 */
function miniCapable(mods) {
  return Array.isArray(mods) && (mods.includes('*') || mods.includes('data'))
}
/** v312：某角色**默认**的可登录端（= 给该角色新建账号时，「可登录端」会预填什么）。
 *
 *  🔴 三档优先级，顺序**不能倒**：
 *    ① 后端实况 —— 本租户在「设置 › 权限」为该角色配的端（`r.default_login_scope`）；
 *    ② 出厂默认 —— `roles.js::ROLE_END`（唯一源，有护栏对账）；
 *    ③ 共享判据兜底 `defaultLoginScope()`。
 *    倒过来（先 ② 再 ①）就会出现"权限页刚配好、这里仍按出厂值预填"——同屏两处说法不一致。
 */
function roleEndScope(role) {
  const cat = roleCatalog.value
  const s = cat && cat[role] && cat[role].scope
  if (s) return s
  return defaultLoginScope(role)
}
/** 一个角色的「适用端」文字。篇幅优先级：**租户实况 → 出厂定义 → 后端模块实况 → 共享判据兜底**。
 *  ⚠️ v312 起把"租户实况"提到最前 —— 端已经能在「设置 › 权限」里按客户改，
 *     出厂值 `ROLE_END` 从此只是**默认**，不再是这家客户实际生效的上限。 */
function endLabelOf(role) {
  const cat = roleCatalog.value
  const s = cat && cat[role] && cat[role].scope
  if (s) return ROLE_END_LABEL[s] || ''
  const e = ROLE_END[role]
  if (e) return ROLE_END_LABEL[e] || ''
  if (cat && cat[role] && Array.isArray(cat[role].modules)) {
    return miniCapable(cat[role].modules) ? ROLE_END_LABEL.both : ROLE_END_LABEL.web
  }
  // 既不在产品定义里、也查不到实况（如降级时遇到已删的自定义角色）⇒ 用共享判据兜底，
  // 且**不谎称**能用小程序。
  return canUseMiniProgram(role) ? ROLE_END_LABEL.both : ROLE_END_LABEL.web
}
/** 角色下拉的完整选项：内置 8 项（固定顺序）+ 本租户自定义角色（排在末尾并标注）。 */
const ROLE_OPTIONS = computed(() => {
  const out = BUILTIN_ROLE_ORDER.map(v => ({
    value: v,
    label: roleName(v) + '（' + endLabelOf(v) + (ROLE_HINTS[v] ? ' · ' + ROLE_HINTS[v] : '') + '）',
  }))
  const cat = roleCatalog.value
  if (cat) {
    for (const name of Object.keys(cat).sort()) {
      if (isCanonicalRole(name)) continue
      out.push({ value: name, label: name + '（自定义角色 · ' + endLabelOf(name) + '）' })
    }
  }
  return out
})
/** 角色**显示名**：内置走共享表；本租户自定义角色**直接显示原名**
 *  （它不是"未知" —— 是客户在权限页真配过的角色，`roleCatalog` 里查得到）。
 *  真·未知角色仍走 `roleName()` 的 `未知角色( x )`，让配置漂移在下一次看界面时暴露。 */
function roleDisplay(r) {
  const k = String(r || '').trim()
  if (!k) return '未设置'
  if (isCanonicalRole(k)) return roleName(k)
  if (roleCatalog.value && roleCatalog.value[k]) return k
  return roleName(k)
}
const accForm2 = reactive({ username: '', password: '', role: 'staff', login_scope: defaultLoginScope('staff') })
/* v312：`accScopeTouched` = 用户有没有**手工**改过「可登录端」。
   🔴 它决定提交时**发不发**这个字段（见 `createAccountInEdit`）：没改过就不发，
      由后端按该角色的端政策决定。为什么必须这样 —— 本页的角色表可能因权限不足而
      **降级成出厂默认**（`loadRoleCatalog` 的 403 分支），此时若把前端猜出来的值发上去，
      会**静默覆盖**这家客户在「设置 › 权限」里的实际配置，而界面看不出任何异常。 */
const accScopeTouched = ref(false)
/* v307：换角色 ⇒ 可登录端**重取默认值**（默认跟随角色）；用户手动改过之后
   再换角色会重设，这是刻意的 —— 换角色等于换岗位，沿用上一个岗位的端设置更危险。 */
watch(() => accForm2.role, (r) => {
  accForm2.login_scope = roleEndScope(r)
  accScopeTouched.value = false
})
const accRoleEdit = ref('staff')
/* v307 登录范围（这个账号允许从哪个端登录）。
   🔴 **默认跟随角色的适用端**（`defaultLoginScope` → `ROLE_END` 唯一源），**可手动改**
      ⇒ 满足「业务员 / 促销员默认只开小程序，需要时再开通网页端」。
   🔴 与「角色」**分开保存**：两套端点、字段零交集（同本弹窗其它项的处理一致），
      不要合并成一个"保存账号"按钮 —— 合并后一处失败会连累另一处。 */
const accScopeEdit = ref('both')
const accScopeBase = ref('both')          // 打开弹窗时的原值（判脏用）
/* v266 角色可叠加：**兼任角色**（只加权限，不改主角色承载的单值语义 ——
   主角色仍决定「这个人是干嘛的」：销售只看自己的单、小程序能不能报单…）。
   存数组便于多选；提交时拼成数组交给后端（后端 `core.user_roles` 也容错中文分隔符）。 */
const accRolesEdit = ref([])
const accPwdEdit = ref('')
const accBusy = ref(false)
const showReset = ref(false)

/* 🔴 v289（2026-09-27）：密码规则 —— **唯一权威在后端** `core._validate_password`
   （规则：≥8 个字符，且**同时包含字母和数字**）。

   为什么这一段要写在最显眼处：本页两个密码框原先硬编码的下限都是 4 位，而后端门槛
   早已是 8 位 ⇒ 老板按提示输 4 位、点保存被后端打回「密码至少需要8位」，提示与校验
   当场打架。病根是**规则被抄成多份、改一处漏一处**。
   ⇒ 前端只此一处定义，两个输入框共用；后端 `core.py` 里有一段反向索引注释点名了本文件，
     改后端规则时必须同步改这里的 PWD_MIN / PWD_HINT。
   ⚠️ 前端这一层只为"少跑一个来回"，**判据始终在后端**。 */
const PWD_MIN = 8
const PWD_HINT = '至少 8 位，且包含字母和数字'
/** 与后端 `core._validate_password` **同口径**：长度达标 ＋ 同时含数字和字母。 */
function pwdOk(p) {
  const s = String(p || '')
  return s.length >= PWD_MIN && /[0-9]/.test(s) && /[a-zA-Z]/.test(s)
}

/* v288（2026-09-27）：改**登录账号名**。
   此前只有本人能在个人设置里改自己（`PUT /api/auth/profile`），员工档案的账号区
   有「重置密码 / 禁用账号 / 生成重置码」却**没有改账号** ⇒ 账号名建错了只能删账号重建
   （而删账号会连带丢掉报单配置与工资条链路）。
   🔴 改完账号名**立即生效**：本人手上的会话不断（sessions 按 user_id），但**下次登录必须用新名**。 */
const accNameEdit = ref('')
const showRename = ref(false)
const nameDirty = computed(() => {
  const n = accNameEdit.value.trim()
  return !!n && !!editTarget.value && n !== (editTarget.value.account_username || '')
})
// Q29（2026-09-19）忘记密码自助重置：一次性重置码。明文只在生成的这一次出现，
// 后端只存哈希 —— 关了弹窗就再也看不到，需要重发。
const resetCode = ref('')
const resetCodeExp = ref('')

/* ---- 连接器状态 + 同步 ---- */
const chanjetLinked = ref(false)
const kingdeeLinked = ref(false)
const syncBusy = ref(false)
const remindOpen = ref(false)

const connState = computed(() => (chanjetLinked.value || kingdeeLinked.value) ? 'linked' : 'unlinked')
const connLabel = computed(() => {
  if (chanjetLinked.value && kingdeeLinked.value) return '畅捷通 + 金蝶 已连接'
  if (chanjetLinked.value) return '畅捷通 已连接'
  if (kingdeeLinked.value) return '金蝶 已连接'
  return '未连接 ERP'
})

async function probeConnectors() {
  try { const s = await api('/api/datasources/v2/chanjet/status'); chanjetLinked.value = !!s.connected } catch { chanjetLinked.value = false }
  try { const s = await api('/api/datasources/v2/kingdee/status'); kingdeeLinked.value = !!s.connected } catch { kingdeeLinked.value = false }
}

async function onSync() {
  if (!chanjetLinked.value && !kingdeeLinked.value) { remindOpen.value = true; return }
  syncBusy.value = true
  try {
    const jobs = []
    if (chanjetLinked.value) jobs.push(api('/api/datasources/v2/chanjet/sync', { method: 'POST', body: { objects: ['products', 'customers', 'suppliers'] } }))
    if (kingdeeLinked.value) jobs.push(api('/api/datasources/v2/kingdee/sync', { method: 'POST', body: { objects: ['products', 'customers', 'suppliers', 'inventory', 'sales_orders', 'purchase_orders'] } }))
    await Promise.all(jobs)
    const who = chanjetLinked.value && kingdeeLinked.value ? '（畅捷通 + 金蝶）' : chanjetLinked.value ? '（畅捷通）' : '（金蝶）'
    toast('已同步外部档案数据' + who, 'ok')
  } catch (e) {
    toast(e.message || '同步失败', 'err')
  } finally {
    syncBusy.value = false
  }
}

function goConnect() {
  /* v291（2026-09-27）：入口同判据 —— 能进档案的人**不一定**能进「AI 引擎」
     （业务员能进档案，但不能进连接器/数据源配置）⇒ 不判就会出现"点了被弹回工作台"（假入口）。
     ⚠️ v311：容器已由「能力中心」更名「AI 引擎」——**提示文案必须跟着改**，
        否则用户按提示去找一个已经不存在的菜单名。路由仍是 `/connect`，判据没变。 */
  if (!canSee('/connect')) { toast('你没有访问「AI 引擎」的权限', 'warn'); return }
  remindOpen.value = false
  router.push('/connect')
}

/* ---- 员工 CRUD ---- */
function salaryOf(e) {
  try { return (JSON.parse(e.salary_structure || '{}')).base_salary || 0 } catch { return 0 }
}
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }

async function loadEmployees() {
  loading.value = true
  try {
    employees.value = await employeeApi.list({ include_inactive: 1 }) || []
    const missing = employees.value.filter(e => !salaryOf(e)).length
    empStats.value = { total: employees.value.length, missing }
  } catch (e) { toast(e.message || '加载员工失败', 'err') }
  finally { loading.value = false }
}

/* ---- v381：原「仓库主档」整块已删除（`warehouses` / `loadWarehouses` / `warehouseName`）。
   它只服务于已搬走的「个人仓」下拉与列表列 —— 留着就是死代码（`warehouseApi` 的 import
   也一并去掉，否则会变成"看着像在用、其实没人调"的误导）。 */

/* ---- 完整编辑弹窗（新增 / 编辑共用同一弹窗） ---- */
function resetEditForm(e) {
  const src = e || {}
  editForm.name = src.name || ''
  editForm.employee_no = src.employee_no || ''
  editForm.position = src.position || ''
  editForm.hire_date = src.hire_date || ''
  editForm.id_card = src.id_card || ''
  editForm.bank_name = src.bank_name || ''
  editForm.bank_account = src.bank_account || ''
  editForm.social_insurance_city = src.social_insurance_city || ''
  editForm.social_insurance_base = src.social_insurance_base != null ? src.social_insurance_base : null
  editForm.housing_fund_base = src.housing_fund_base != null ? src.housing_fund_base : null
  editForm.base_salary = e ? (salaryOf(e) || null) : null
  // v381：`warehouse_id` 不再回填（字段已移出本表单）。
  // 账号区状态复位
  accForm2.username = ''
  accForm2.password = ''
  accForm2.role = 'staff'
  // v312：默认端跟着**角色实况**（本租户在权限页配的）而不是出厂常量；同时清"手工改过"标记。
  accForm2.login_scope = roleEndScope('staff')
  accScopeTouched.value = false
  // v307：账号区编辑态**统一走 syncRoleEdit 一处**。此前这里把那三行抄了一遍 ——
  // 抄第二遍的代价正是「新增字段时只改了一处」（v307 的登录范围就是这样漏的）。
  syncRoleEdit(src)
  accPwdEdit.value = ''
  showReset.value = false
  // v288：改账号的展开态与输入也要复位 —— 否则换一个人打开弹窗，输入框里留着**上一个人**
  // 的账号名（预填逻辑只在点「改账号」时跑，展开态却是复用的），容易顺手改错人。
  showRename.value = false
  accNameEdit.value = ''
  resetCode.value = ''      // 换人 / 重开弹窗即清 —— 码只对刚生成的那个人有效
  resetCodeExp.value = ''
  // v290：存一份「档案基线」，供关窗前的未保存检查比对。
  // 必须放在**最后一行** —— 保证此刻 editForm 已经是"刚打开弹窗时该有的值"。
  snapshotForm()
}

function openCreate() {
  isCreate.value = true
  editTarget.value = null
  resetEditForm(null)
  editOpen.value = true
}

function openEdit(e) {
  isCreate.value = false
  editTarget.value = e
  resetEditForm(e)
  editOpen.value = true
}

/* v382（2026-10-06）：由「底部保存按钮的处理函数」降级为 **saveAll 的第一步**（人事档案，含新建）。
   返回 `{ok, created, renamed, renameError}`：
     · `created=true` = 刚新建成功（弹窗已切到编辑态）⇒ saveAll 本轮到此为止 ——
       与原行为一致：创建后**不关窗**，好让用户接着开通登录账号；
     · `renamed` = 改名连带同步了登录账号显示名（供汇总 toast 说明）；
     · `renameError` = 后端明确回了同步失败原因（已在此处单独以 err 报出，别再叠一条成功提示）。
   ⚠️ 原先末尾那段「按 `accAnyDirty` 决定关不关窗」已**上移**到 saveAll：合并后
      "还有没有别的没存"要等后面两步跑完才知道，第一步自己判会误判（那时账号区必然还是 dirty）。 */
async function saveEmployeeCore() {
  if (!editForm.name.trim()) { toast('请输入员工姓名', 'err'); return { ok: false } }
  const f = editForm
  const body = {
    name: f.name.trim(),
    employee_no: f.employee_no || undefined,
    position: f.position || undefined,
    hire_date: f.hire_date || undefined,
    id_card: f.id_card || undefined,
    bank_name: f.bank_name || undefined,
    bank_account: f.bank_account || undefined,
    social_insurance_city: f.social_insurance_city || undefined,
    social_insurance_base: f.social_insurance_base != null ? f.social_insurance_base : undefined,
    housing_fund_base: f.housing_fund_base != null ? f.housing_fund_base : undefined,
    // v381：`warehouse_id` 不再随本表单提交（入口已搬到报单配置）。
    // 后端 `PUT /api/employees/{eid}` 的白名单**仍保留**它以兼容脚本与回滚。
  }
  if (f.base_salary != null) body.salary_structure = JSON.stringify({ base_salary: f.base_salary })
  try {
    if (isCreate.value) {
      const created = await employeeApi.create(body)
      toast('已创建员工', 'ok')
      isCreate.value = false
      // 用新档案继续填充弹窗，便于立即开通登录账号
      openEdit(created)
      loadEmployees()
      return { ok: true, created: true }
    }
    const r = await employeeApi.update(editTarget.value.id, body)
    loadEmployees()
    // 🔴 v326（2026-09-29）：**改名会联动该员工的登录账号显示名**（后端已改，见
    //    `erp_db.sync_employee_account_display_name`）。这里要接住它的回执：
    //      ① 后端明确回带了失败原因 ⇒ **说出来**（否则"名字改了但账号没改"又变回
    //         一个只能靠用户自己发现的静默问题 —— 本轮修的就是这个）；
    //      ② 真的同步到了账号 ⇒ `force` 重拉一次身份：若改的正是**自己**，
    //         右上角当场跟着变（`loadPerms` 默认幂等，不 force 会直接 return 缓存）；
    //         改的是别人也无害（一次轻请求）。
    const renamed = Number((r && r.account_renamed) || 0)
    const renameError = (r && r.rename_error) || ''
    if (renameError) {
      toast('基本信息已保存，但登录账号名称没同步成功：' + renameError, 'err')
    }
    if (renamed > 0) store.loadPerms(true)
    return { ok: true, created: false, renamed, renameError }
  } catch (e2) { toast(e2.message || '保存失败', 'err'); return { ok: false } }
}

/* ---- 停用 / 启用 ---- */
const disableOpen = ref(false)
const disableTarget = ref(null)
function askDisable(e) { disableTarget.value = e; disableOpen.value = true }
async function confirmDisable() {
  const e = disableTarget.value
  disableOpen.value = false
  const r = await employeeToggle(e.id, 0)
  // 停用后：若该员工名下还有报单配置，必须引导转交 ——
  // 直接作废会导致这些门店无人报单，业务中断。权限可回收，报单要交接。
  if (r && r.report_mapping_count > 0) {
    transferEmp.value = e
    transferCount.value = r.report_mapping_count
    transferToId.value = null
    await loadActiveEmployees()
    transferOpen.value = true
  }
}
async function employeeToggle(eid, val) {
  try {
    const r = await employeeApi.toggle(eid, val)
    const n = r && r.accounts_affected ? r.accounts_affected : 0
    if (val) {
      toast(n ? `已启用员工，并恢复 ${n} 个登录账号` : '已启用员工', 'ok')
    } else {
      toast(n ? `已停用员工，并禁用 ${n} 个登录账号` : '已停用员工（该员工无关联账号）', 'ok')
    }
    loadEmployees()
    return r
  } catch (e2) { toast(e2.message || '操作失败', 'err'); return null }
}

/* ---- 离职交接：报单配置转交（不能直接停用，否则门店无人报单） ---- */
const transferOpen = ref(false)
const transferEmp = ref(null)
const transferCount = ref(0)
const transferToId = ref(null)
const activeEmployees = ref([])
const transferring = ref(false)

async function loadActiveEmployees() {
  try {
    const d = await api('/api/employees/active')
    activeEmployees.value = d.employees || []
  } catch (e) { activeEmployees.value = [] }
}

async function confirmTransfer() {
  if (!transferToId.value) { toast('请选择接任者', 'err'); return }
  transferring.value = true
  try {
    const r = await api(`/api/employees/${transferEmp.value.id}/transfer-mappings`, {
      method: 'POST',
      body: { to_employee_id: Number(transferToId.value) },
    })
    toast(`已转交 ${r.moved || 0} 个报单配置`, 'ok')
    transferOpen.value = false
    loadEmployees()
  } catch (e) {
    toast(e.message || '转交失败', 'err')
  } finally {
    transferring.value = false
  }
}

/* ---- 登录账号 / 门店 ---- */
// 角色短名已上提到 `constants/roles.js`（前端唯一来源，2026-09-19 收敛）。
// 此前这里另有一份 8 条目表 —— 与 Forecast.vue、小程序 roles.js 三份并存，正是漏条目的温床：
// 缺 key 时旧写法 `ROLE_NAMES[r] || r` 会把英文原样显示，与「正常英文值」看不出区别。
// 现在 roleName 对未知角色返回 `未知角色( xxx )`，让漂移在下一次看界面时就暴露。

// 在"编辑员工"弹窗内开通账号（仅当该员工尚无账号时显示）
async function createAccountInEdit() {
  if (accBusy.value || !editTarget.value) return
  // v289：与上面 resetAccPwd 同一口径（同 PWD_HINT），避免"两个密码框两套说法"。
  if (!pwdOk(accForm2.password)) { toast('初始密码需' + PWD_HINT, 'err'); return }
  accBusy.value = true
  try {
    await staffAccountApi.createAccount({
      employee_id: editTarget.value.id,
      username: accForm2.username.trim(),
      password: accForm2.password,
      display_name: editTarget.value.name,
      role: accForm2.role,
      // v312：**没手工改过就不带这个字段**（空串 ⇒ 后端按该角色的端政策取默认值，
      //   见 `routers/forecast_submissions.py` 的 `raw_scope is None or not strip()` 分支）。
      //   理由见 `accScopeTouched` 的注释：本页角色表可能降级成出厂值，
      //   把它发上去会静默覆盖租户实际配置。
      login_scope: accScopeTouched.value ? accForm2.login_scope : '',
    })
    toast('账号已开通', 'ok')
    // v290（2026-09-27）：不关窗 —— 开通后刷新即就地切到「已有账号」态，
    //    让用户接着配角色 / 密码；关窗同样会丢掉档案区未保存的改动。
    await loadEmployees()
    const fresh = employees.value.find(x => x.id === (editTarget.value && editTarget.value.id))
    if (fresh) editTarget.value = fresh
  } catch (e) { toast(e.message || '开通失败', 'err') }
  finally { accBusy.value = false }
}

/* ---- v308 外部客户账号（分销商）---------------------------------------------
   🔴 **为什么入口在这里，而不是在客户档案**：
     ① 登录账号在**主库 `users`**、客户业务数据在**租户库** —— 放客户档案要跨库写两处，
        破坏现有多租户隔离边界；
     ② 本系统现在**没有客户主数据表**（`CustomerArchive.vue` 是数据源同步页，不是客户档案），
        为放一个入口先造一整套客户主数据，成本是前者的数倍；
     ③ 放员工档案可**复用**现成的密码策略（`PWD_HINT`）、角色白名单（后端强制 distributor）、
        自助改密通道。
   🔴 外部客户**不是员工** ⇒ 不建人事档案、不进工资核算、不占员工编号
     （后端 `employee_id` 保持 0，身份留痕写 `external_ref`），避免污染人事/工资口径。 */
const extOpen = ref(false)
const extLoading = ref(true)
const extAccounts = ref([])
const extBusy = ref(false)
const extEditId = ref(0)                 // 0 = 新建；>0 = 正在编辑的 users.id
const extNameEdit = ref('')              // 编辑态：新登录名（选填）
const extPwdEdit = ref('')               // 编辑态：新密码（选填）
const extForm = reactive({ name: '', username: '', password: '', login_scope: 'mini' })

/** 客户名（唯一取法）：`name`（名册口径）→ `external_ref` → `display_name` → 「外部客户 #id」。
 *  🔴 **绝不回落空串** —— 空串在表格里看着像「这行坏了」，而实际只是名字列没读到。 */
function extNameOf(u) {
  const s = String((u && (u.name || u.external_ref || u.display_name)) || '').trim()
  return s || ('外部客户 #' + ((u && u.id) || 0))
}

/** v317：外部客户名册改从 **`/api/report-mappings/refs`**（租户库口径）取。
 *
 *  🔴 为什么不再用 `/api/users`（这是老板报的「已开通账号没有展示」的**真根因**）：
 *   A. `/api/users` 线上有**两个实现**，谁生效只看注册顺序 ——
 *      `routers/platform.py::list_users`（prefix `/api`，在 `include_router` 阶段注册）
 *      先命中，`server.py::list_users` **永不可达**（在它那儿加字段不会生效）；
 *   B. 生效的那个返回 `{success, data:[…], total}` —— 经 `api()` 解包后拿到的是**裸数组**，
 *      而这里原来读的是 `d.users` ⇒ `undefined`；
 *   C. 它的 `SELECT` 里**也没有 `external_ref`** ⇒ 即使形状对，按 `external_ref` 过滤也恒空。
 *   A+B+C ⇒ `extAccounts` 恒为空 ⇒ 界面永远看不见已开通的账号（零报错、零提示）。
 *
 *  `refs.externals` 天然覆盖本块全部需要（`name` / `username` / `login_scope` / `is_active`
 *  ＋ v317 补的 `report_mapping_count`），且「按 `user_tenants` 收口」在同一处完成。
 *  保留旧形状兜底，以免日后路由若被改回去时又静默变空。 */
async function loadExtAccounts() {
  try {
    const d = await api('/api/report-mappings/refs')
    let list = (d && Array.isArray(d.externals)) ? d.externals : null
    if (!list) {
      // 兜底：旧口径（形状可能是裸数组，也可能是 `{users:[…]}`，两种都收）
      const u = await api('/api/users')
      const arr = Array.isArray(u) ? u : ((u && u.users) || [])
      list = arr.filter((x) => String(x.external_ref || '').trim())
    }
    extAccounts.value = list
  } catch { extAccounts.value = [] }   // 无权限/接口抖动：当"没有"，不打断整页
  finally { extLoading.value = false }
}

function openExtCreate() {
  extEditId.value = 0
  extForm.name = ''; extForm.username = ''; extForm.password = ''
  // v312 同源：默认端取「设置 › 权限」里给「分销商」配的端，而不是写死 'mini'。
  // 写死的后果 = 权限页改了分销商政策、这里却仍然按老规矩建号（两处口径）。
  extForm.login_scope = roleEndScope('distributor')
  extNameEdit.value = ''; extPwdEdit.value = ''
  extOpen.value = true
}

function openExtEdit(u) {
  extEditId.value = u.id
  extForm.name = extNameOf(u)
  extForm.username = u.username || ''
  extForm.password = ''
  extForm.login_scope = String(u.login_scope || '').trim() || roleEndScope('distributor')
  extNameEdit.value = ''; extPwdEdit.value = ''
  extOpen.value = true
}

function closeExt() { if (extBusy.value) return; extOpen.value = false }

/** 新建 / 编辑统一入口。编辑时先落「客户名称 + 可登录端」，再由用户按需点改名/重置密码。 */
async function saveExt() {
  if (extBusy.value) return
  if (!extForm.name.trim()) { toast('请填写客户名称', 'err'); return }
  extBusy.value = true
  try {
    if (!extEditId.value) {
      if (!pwdOk(extForm.password)) { toast('初始密码需' + PWD_HINT, 'err'); return }
      await staffAccountApi.createAccount({
        employee_id: 0,                        // 外部客户不关联员工
        username: extForm.username.trim(),
        password: extForm.password,
        display_name: extForm.name.trim(),
        role: 'distributor',                   // 后端强制；外部账号不允许其它角色
        login_scope: extForm.login_scope,
        external_ref: extForm.name.trim(),     // 身份留痕
      })
      toast('外部客户账号已开通', 'ok')
    } else {
      const uid = extEditId.value
      const cur = extAccounts.value.find(x => x.id === uid) || {}
      // 只在**真的改了**的时候才发请求 —— 无变化也发会刷出一条无意义的审计记录。
      if (extForm.name.trim() !== extNameOf(cur)) {
        await api(`/api/users/${uid}/display-name`, { method: 'PUT', body: { display_name: extForm.name.trim() } })
      }
      if (String(cur.login_scope || '') !== extForm.login_scope) {
        await api(`/api/users/${uid}/login-scope`, { method: 'PUT', body: { login_scope: extForm.login_scope } })
      }
      toast('已保存', 'ok')
    }
    extOpen.value = false
    await loadExtAccounts()
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { extBusy.value = false }
}

async function toggleExtAccount(u) {
  try {
    await api(`/api/users/${u.id}/status`, { method: 'PUT', body: { is_active: u.is_active ? 0 : 1 } })
    await loadExtAccounts()
  } catch (e) { toast(e.message || '操作失败', 'err') }
}

/** 编辑态：改登录名（`PUT /api/users/{uid}/username`，与员工账号同一接口）。 */
async function renameExtAcc() {
  if (extBusy.value || !extEditId.value) return
  const n = extNameEdit.value.trim()
  if (!n) { toast('请填写新的登录账号', 'err'); return }
  if (n.length < 2 || n.length > 32) { toast('登录账号需 2-32 个字符', 'err'); return }
  extBusy.value = true
  try {
    const r = await api(`/api/users/${extEditId.value}/username`, { method: 'PUT', body: { new_username: n } })
    if (r && r.changed === false) { toast('登录账号没有变化', 'ok'); extNameEdit.value = ''; return }
    // 必须点名「下次登录用新账号」—— 否则客户拿旧号登录被拒，会以为密码坏了。
    toast(`登录账号已改为「${n}」— 该客户下次登录请用新账号`, 'ok')
    extNameEdit.value = ''
    await loadExtAccounts()
  } catch (e) { toast(e.message || '修改失败', 'err') }
  finally { extBusy.value = false }
}

/** 编辑态：重置密码（`POST /api/users/{uid}/password`，与员工账号同一接口）。 */
async function resetExtPwd() {
  if (extBusy.value || !extEditId.value) return
  if (!pwdOk(extPwdEdit.value)) { toast('新密码需' + PWD_HINT, 'err'); return }
  extBusy.value = true
  try {
    await api(`/api/users/${extEditId.value}/password`, { method: 'POST', body: { password: extPwdEdit.value } })
    toast('密码已重置 — 请告知该客户新密码', 'ok')
    extPwdEdit.value = ''
  } catch (e) { toast(e.message || '重置失败', 'err') }
  finally { extBusy.value = false }
}

/** 去「预报订单管理 → 报单配置」给该客户配门店。
 *  🔴 入口同判据（与 goConnect 同规矩）：能进员工档案的人**不一定**能进预报订单管理
 *     ⇒ 不判就会出现「点了没反应 / 被弹回工作台」的假入口。 */
function goReportConfig() {
  if (!canSee('/forecast')) { toast('你没有访问「预报订单管理」的权限', 'warn'); return }
  router.replace({ path: '/forecast', query: { tab: 'config' } }).catch(() => {})
}

/* ---- v266 兼任角色（角色可叠加）---------------------------------------------
   三个小工具，判据与后端 `core.user_roles()` 完全同源（都容错中英文分隔符），
   不在这里另写一套「什么算合法角色」—— 那正是漂移源。 */
function extraRolesOf(e) {
  return String((e && e.account_roles) || '')
    .split(/[,，、;；]/).map(s => s.trim())
    .filter(r => r && r !== (e && e.account_role))
}
/** 点选 / 取消一个兼任角色。 */
function toggleExtraRole(v) {
  const i = accRolesEdit.value.indexOf(v)
  if (i >= 0) accRolesEdit.value.splice(i, 1)
  else accRolesEdit.value.push(v)
}
/** 可选兼任项：排除当前主角色（兼任与主角色相同没有意义）。
 *  ⚠️ v300：`ROLE_OPTIONS` 已是 `computed` ⇒ 这里**必须** `.value`（模板里才自动解包）。 */
const extraRoleOptions = computed(() => ROLE_OPTIONS.value.filter(o => o.value !== accRoleEdit.value))
/** 「有未保存改动」—— 主角色或兼任任一变化即算。原实现只比主角色，加了兼任后会漏判。 */
const accRoleDirty = computed(() => {
  if (!editTarget.value) return false
  const norm = (arr) => arr.slice().sort().join(',')
  const next = norm(accRolesEdit.value.filter(r => r && r !== accRoleEdit.value))
  const cur = norm(extraRolesOf(editTarget.value))
  return accRoleEdit.value !== editTarget.value.account_role || next !== cur
})

/** v290：把角色编辑态同步到某个员工对象上（保存成功后调用，让 accRoleDirty 归零）。 */
function syncRoleEdit(e) {
  const src = e || {}
  accRoleEdit.value = src.account_role || 'staff'
  accRolesEdit.value = String(src.account_roles || '')
    .split(/[,，、;；]/).map(s => s.trim()).filter(Boolean)
  // v307 登录范围：库里有值 ⇒ 用它（**手工值优先**）；库里为空 ⇒ 按角色默认（存量账号）。
  // v312：这里的"角色默认"改走 `roleEndScope`（本租户在权限页配的端），而不是出厂常量。
  const cur = String(src.account_login_scope || '').trim()
  accScopeEdit.value = cur || roleEndScope(accRoleEdit.value)
  accScopeBase.value = accScopeEdit.value
}

/* v307 判脏：与「打开弹窗时的原值」比，而不是与后端值比 ——
   saveAll 提交成功后 `editTarget` 会被刷新（那是**库里的值**），若拿它当基准，
   刚存进去的这一项会被误判成"仍在修改"（界面上「有未保存的改动」标签不消失）。
   v382 合并保存后这条更关键：合并流程走完会统一刷新一次，基准必须是"打开弹窗时的原值"。 */
const accScopeDirty = computed(() => accScopeEdit.value !== accScopeBase.value)

/* v382（2026-10-06）：由「独立保存按钮的处理函数」降级为 **saveAll 里的一个写库步骤**。
   不再自管 `accBusy`（并发由唯一入口 saveAll 挡）、不再自报成功 toast（由 saveAll 汇总一条）、
   **也不再自己刷新 + `syncRoleEdit`**。
   🔴 最后这条是合并保存必须改的关键点（已实测推演）：
      原实现保存完会 `syncRoleEdit(fresh)`，那会把 `accScopeEdit` / `accScopeBase` 一起
      重写成**库里的值**。合并后若先存角色、再存端，这一步就会把**用户刚改的端**悄悄抹掉
      （编辑态被覆盖、`accScopeDirty` 归零 ⇒ 后面判"没改动"直接跳过，改动静默消失）。
      ⇒ 写库步骤一律**只用传入的快照值**，刷新统一由 saveAll 在最后做一次。 */
async function saveAccScopeCore(scope) {
  const t = editTarget.value
  if (!t || !t.account_user_id) return false
  try {
    await api(`/api/users/${t.account_user_id}/login-scope`, {
      method: 'PUT',
      body: { login_scope: scope },
    })
    return true
  } catch (e) {
    // 后端对"改自己"会 400（把自己锁在门外）⇒ 如实转达，别吞掉。
    toast(e.message || '可登录端保存失败', 'err')
    return false
  }
}

/* ---- v312：角色端政策 ↔ 账号实际端的**差异提示与一键对齐** ----------------------
   需求原话（老板）：「在设置中为角色配置权限后…该员工只有小程序权限」。
   功能权限那条**本来就是继承**（员工没有自己的模块权限）；端这条是**两层**：
     · 角色政策（`role_end`，在「设置 › 权限」配）—— 决定**新建账号**的默认值；
     · 账号事实（`users.login_scope`）—— 建号后仍可单独改（v307 的"保留手动开通"）。
   ⇒ 改角色政策时**不动已有账号**。但必须让老板**看得见**这个差异，所以有下面这一对。 */
/** 当前所选角色在「设置 › 权限」里配的默认端。 */
const accScopeDefault = computed(() => roleEndScope(accRoleEdit.value))
/** 这个账号的端 ≠ 它角色的默认端。
 *  🔴 **只用来提示，绝不自动改**：自动对齐会把"当初特意给某人开过网页端"的账号
 *     在下一次动角色时静默收窄回小程序 —— 那正是"用户被自己锁在门外"那一族。 */
const accScopeMismatch = computed(() => {
  const cur = String(accScopeEdit.value || '')
  return !!cur && cur !== accScopeDefault.value
})
/** 一键把账号的端对齐到角色默认（走与手动保存**同一个端点**，不另开写路径）。 */
async function alignAccScope() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  const want = accScopeDefault.value
  if (!confirm('把这个账号的「可登录端」改成角色「' + roleDisplay(accRoleEdit.value) + '」的默认值：' + loginScopeLabel(want) + '？')) return
  accBusy.value = true
  try {
    await api(`/api/users/${editTarget.value.account_user_id}/login-scope`, {
      method: 'PUT',
      body: { login_scope: want },
    })
    toast('已按角色对齐', 'ok')
    await loadEmployees()
    const fresh = employees.value.find(x => x.id === (editTarget.value && editTarget.value.id))
    if (fresh) { editTarget.value = fresh; syncRoleEdit(fresh) }
  } catch (e) {
    // 后端对"改自己"会 400（把自己锁在门外 = 自杀操作）⇒ 如实转达，别吞掉。
    toast(e.message || '操作失败', 'err')
  } finally { accBusy.value = false }
}

/* ==== v290（2026-09-27）「未保存改动」的统一判据 ==============================
   为什么要有这一组：这个弹窗里的改动落在**两套端点**上（人事档案 `/api/employees/*` 与
   登录账号 `/api/users/*`，字段零交集 —— 端点这层仍然不合并，各写各的）；
   但原先**任何一处保存成功都会关掉整个弹窗**，于是"先改 A、再改 B、只点了一个保存"
   ⇒ 另一处随关窗**无声消失**（零提示、零报错，比 v289 那个"至少还报错"的缺陷更隐蔽）。
   v290 先治了这个：① 保存成功不再一律关窗 ② 关窗前统一问一句 —— 就是下面的 tryCloseEdit。
   🔴 **v382（2026-10-06）又往前走了一步**：三个保存按钮并成一个「保存」（见 saveAll），
      ⇒ "点漏一个"这个错误路径从根上没有了。但**这组判据一条都不能删**：
      `tryCloseEdit` 仍要拦住"改了却没保存就点取消/✕/遮罩"（例如只改了「改登录名」那个
      独立动作、或改了档案没点保存），而 `accAnyDirty` 还负责 saveAll 之后判断
      "账号区是不是还有没提交的独立动作"。⇒ 合并的是**按钮**，不是**判据**。
   ⚠️ 判据只在**这里**写一份，不要在各个按钮里再抄一遍（本项目三次栽在"规则抄多份"）。 */
const formDirty = computed(() => JSON.stringify(editForm) !== formSnap.value)
const accAnyDirty = computed(() =>
  accRoleDirty.value || nameDirty.value || String(accPwdEdit.value || '').length > 0
  || accScopeDirty.value
)
const anyDirty = computed(() => formDirty.value || accAnyDirty.value)

/** 关闭编辑弹窗的**唯一入口**（遮罩 / ✕ / 取消 三处都走它，别再直接写 editOpen=false）。 */
function tryCloseEdit() {
  if (anyDirty.value) {
    const what = [formDirty.value ? '人事档案' : '', accAnyDirty.value ? '登录账号' : '']
      .filter(Boolean).join('和')
    const nm = (editTarget.value && editTarget.value.name) || ''
    if (!window.confirm(`「${nm}」的${what}还有未保存的改动。\n\n关闭后这些改动会丢失，确定关闭吗？`)) return
  }
  editOpen.value = false
}

/* v382：同 saveAccScopeCore —— 降级为 saveAll 的写库步骤（主角色 + 兼任角色一起提交）。
   入参 `role` / `roles` 是**调用方抄好的快照值**：不能在这里读 `accRoleEdit`，
   因为 saveAll 前一步的刷新可能已经把它覆盖掉（见 saveAccScopeCore 的注释）。
   入参 `askDrift` = 角色变了、但账号的端与角色默认不一致时，要不要**当场问一句**。
   🔴 合并保存后可能出现"用户自己改了端 + 也改了角色"：这时**用户的显式选择优先**，
      saveAll 会传 `askDrift=false` 跳过询问 —— 否则"按新角色对齐"会把他刚选的端覆盖掉。
   返回 `{ok, scopeHandled}`：`scopeHandled=true` 表示这次已顺手把端写进库了，
   saveAll 的第三步就不必再写一遍。 */
async function saveAccRoleCore(role, roles, askDrift) {
  const t = editTarget.value
  if (!t || !t.account_user_id) return { ok: false, scopeHandled: false }
  const uid = t.account_user_id
  try {
    const r = await api(`/api/users/${uid}/role`, {
      method: 'PUT',
      body: { role, roles },
    })

    // v328 G1：**角色换了，登录范围不会跟着换** —— 账号的"能从哪儿登录"是既成事实，
    //   后端刻意不自动改（有人可能兼任两职、就是要两端）。但**不说就是坑**：
    //   把「导购（仅网页端）」改成「业务员（仅小程序）」后，这个人照样能登网页端，
    //   与角色政策相悖，而界面上一声不吭 ⇒ 老板根本不知道有这回事。
    //   ⇒ 后端返回 `scope_drift` ⇒ 这里当场问一句，让老板自己点头。
    if (askDrift && r && r.scope_drift && r.default_login_scope) {
      const nm = t.name || '该员工'
      const want = loginScopeLabel(r.default_login_scope)
      const now = loginScopeLabel(r.login_scope)
      const yes = window.confirm(
        `「${nm}」的角色已改为「${roleDisplay(role)}」，` +
        `但他现在能登录的范围还是 ${now}（新角色的默认是 ${want}）。\n\n` +
        `要按新角色对齐成 ${want} 吗？`
      )
      if (yes) {
        try {
          await api(`/api/users/${uid}/login-scope`, {
            method: 'PUT',
            body: { login_scope: r.default_login_scope },
          })
          toast('已按新角色对齐登录范围', 'ok')
          return { ok: true, scopeHandled: true }
        } catch (e2) {
          // 后端对"改自己"会 400（把自己锁在门外）⇒ 如实转达，别吞掉。
          toast(e2.message || '登录范围未改动', 'err')
          // ⚠️ 对齐失败也返回 handled=false：交给第三步按**用户原本选的值**再试一次 ——
          //    否则"对齐失败"会连带把他本来就想选的端一起丢掉。
        }
      }
    }
    return { ok: true, scopeHandled: false }
  } catch (e) {
    toast(e.message || '角色保存失败', 'err')
    return { ok: false, scopeHandled: false }
  }
}

/* ==== v382（2026-10-06）**合并保存** ==============================================
   老板要求：把「保存角色」「保存」「保存基本信息」三个按钮合并成一个「保存」。
   背景：这三处原本是**三套端点 + 三个按钮、各自独立保存**。v290 还专门给卡片画了边框
   来表达"保存边界到哪儿为止" —— 可那设计本身反直觉：用户改完档案顺手改角色、只点了
   其中一个保存 ⇒ 那处改动随关窗**静默消失**（v290 只把它从"必丢"降级成"关窗前问一句"）。
   ⇒ 现在弹窗右下角是**全窗口唯一保存入口**，一次提交全部改动。

   🔴 三条必须守住的：
     ① **顺序固定**：基本信息 → 角色/兼任 → 可登录端。基本信息放最前，是因为新建时
        必须先有员工档案（后两步依赖 `account_user_id`，新建态根本没有账号）。
     ② **只用快照值**：两个账号步骤的编辑态会被彼此的 `syncRoleEdit(fresh)` 覆盖
        （详见 saveAccScopeCore 的注释）⇒ 进函数**前**先把要存的值抄下来，步骤内部不许读编辑态。
     ③ **刷新只做一次**：全部写完统一 `loadEmployees()` + 刷新 `editTarget` + `syncRoleEdit`；
        中间不刷新 —— 否则前一步的刷新会覆盖后一步还没用到的编辑态。

   🔴 **失败即停**：任一步失败就不再往下（后面多半也会失败），**不关窗**、报错、保留现场 ——
      宁可让用户看见"只存了一半"，也不能关窗假装全成功。 */
async function saveAll() {
  if (accBusy.value) return
  accBusy.value = true
  try {
    const t = editTarget.value
    const hasAcc = !!(t && t.has_account && t.account_user_id)
    // 只有"已开通账号 + 有 data/update 权限"才谈得上后面两步
    // （没权限时那几行控件已被 v-if 收起来，这里再判一次是防止脏标记残留时误发请求）
    const canAcc = hasAcc && canDo('data', 'update')
    // ② 快照：必须在第一次写库**之前**抄，写库后编辑态就可能被刷新覆盖
    const snap = {
      role: accRoleEdit.value,
      roles: accRolesEdit.value.filter(r => r && r !== accRoleEdit.value),
      scope: accScopeEdit.value,
      roleDirty: accRoleDirty.value,
      scopeDirty: accScopeDirty.value,
    }
    // ① 人事档案（含新建）
    const r1 = await saveEmployeeCore()
    if (!r1.ok) return
    if (r1.created) return              // 新建成功 ⇒ 弹窗已切编辑态，本轮到此为止
    // ② 角色 / 兼任
    let scopeHandled = false
    if (canAcc && snap.roleDirty) {
      // 用户自己改了端 ⇒ 不问"要不要按新角色对齐"（那会把他显式选的端覆盖掉）
      const r2 = await saveAccRoleCore(snap.role, snap.roles, !snap.scopeDirty)
      if (!r2.ok) return
      scopeHandled = r2.scopeHandled
    }
    // ③ 可登录端（若上一步已按新角色对齐写入过，就不重复写一遍）
    if (canAcc && snap.scopeDirty && !scopeHandled) {
      const r3 = await saveAccScopeCore(snap.scope)
      if (!r3.ok) return
    }
    // 三步都过 ⇒ 刷新一次，让摘要行 / 脏标签 / 编辑态都对齐到库里的最新值
    await loadEmployees()
    const fresh = employees.value.find(x => x.id === (t && t.id))
    if (fresh) { editTarget.value = fresh; syncRoleEdit(fresh) }

    // 「改登录名」「重置密码」是**独立动作**（各有自己的按钮与提交时机），不在本次合并范围内。
    // 若它们有没提交的内容，就别把窗关掉 —— 关了同样静默丢。
    const pending = nameDirty.value || String(accPwdEdit.value || '').length > 0
    if (pending) {
      toast('已保存；「改登录名 / 重置密码」里还有没提交的内容', 'warn')
      return
    }
    if (!r1.renameError) {
      const didAcc = canAcc && (snap.roleDirty || snap.scopeDirty)
      toast(r1.renamed > 0
        ? '已保存（登录账号名称已同步）'
        : (didAcc ? '已保存（含登录账号设置）' : '已保存'), 'ok')
    }
    editOpen.value = false
  } finally { accBusy.value = false }
}

/* v288（2026-09-27）改登录账号名。
   打开时**预填当前账号名** —— 改名往往是"改几个字"（如 liushantao → liushantao2），
   空白输入框会让人重敲一遍，还容易打错成另一个已存在的名字。 */
function openRename() {
  accNameEdit.value = (editTarget.value && editTarget.value.account_username) || ''
  showRename.value = true
}

/** v290：点「改登录名」展开（顺带预填当前账号名）、再点即收起。
    抽成函数是因为模板里原来写死的是 `showRename = false`（只能收、不能开）。 */
function toggleRename() {
  if (showRename.value) { showRename.value = false; return }
  openRename()
}

async function renameAcc() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  const n = accNameEdit.value.trim()
  if (!n) { toast('请填写新的登录账号', 'err'); return }
  // 与后端 `core.validate_username` 同一口径（2..32）。前端这一层只为"不用等一个来回"，
  // **不是**判据本身 —— 真正的门禁在后端（且 admin 一类保留名由后端拒）。
  if (n.length < 2 || n.length > 32) { toast('登录账号需 2-32 个字符', 'err'); return }
  accBusy.value = true
  try {
    const r = await api(`/api/users/${editTarget.value.account_user_id}/username`, {
      method: 'PUT',
      body: { new_username: n },
    })
    if (r && r.changed === false) { toast('登录账号没有变化', 'ok'); showRename.value = false; return }
    // 🔴 必须点名「下次登录用新账号」—— 否则员工拿旧账号登录被拒，会以为是密码坏了。
    toast(`登录账号已改为「${n}」— 该员工下次登录请用新账号`, 'ok')
    showRename.value = false
    accNameEdit.value = ''
    // v290（2026-09-27）：同 saveAccRole —— **不关窗**。
    //    关窗会连带丢掉「人事档案」那边还没保存的改动，而用户完全看不出来。
    await loadEmployees()
    const fresh = employees.value.find(x => x.id === (editTarget.value && editTarget.value.id))
    if (fresh) editTarget.value = fresh
  } catch (e) { toast(e.message || '修改失败', 'err') }
  finally { accBusy.value = false }
}

// 重置已有账号的密码
async function resetAccPwd() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  const p = accPwdEdit.value
  // 🔴 v289（2026-09-27）：**先把规则说清楚，再提交**。
  //    以前这里直接 POST：输 4 位就被后端打回「密码至少需要8位」，而那个输入框当时写的下限
  //    正是 4 位 ⇒ 老板照提示填却被拒，看起来像系统坏了。现在前端按同一口径先挡一道，
  //    提示语与 placeholder 是**同一句话**（PWD_HINT）。判据仍在后端，这里只挡明显不合格的。
  if (!pwdOk(p)) { toast('密码需' + PWD_HINT, 'err'); return }
  accBusy.value = true
  try {
    await api(`/api/users/${editTarget.value.account_user_id}/password`, { method: 'POST', body: { password: p } })
    toast('密码已重置', 'ok')
    showReset.value = false
    accPwdEdit.value = ''
  } catch (e) { toast(e.message || '重置失败', 'err') }
  finally { accBusy.value = false }
}

// Q29（2026-09-19）生成「忘记密码」一次性重置码。
// 员工拿这个码在小程序「忘记密码」页自己设新密码 —— 管理员不清楚员工最终密码，
// 与上面的 resetAccPwd（管理员直接指定明文）相比责任边界更清楚。
async function issueResetCode() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  accBusy.value = true
  try {
    const d = await api(`/api/users/${editTarget.value.account_user_id}/reset-code`, { method: 'POST', body: {} })
    resetCode.value = d.code || ''
    resetCodeExp.value = d.expires_at || ''
    toast('重置码已生成，请线下发给本人', 'ok')
  } catch (e) { toast(e.message || '生成重置码失败', 'err') }
  finally { accBusy.value = false }
}

async function copyResetCode() {
  if (!resetCode.value) return
  try {
    await navigator.clipboard.writeText(resetCode.value)
    toast('已复制重置码', 'ok')
  } catch (e) {
    // 非 HTTPS 或未授权剪贴板时 clipboard API 会拒绝 —— 退回让用户手抄
    toast('复制失败，请手动记录：' + resetCode.value, 'err')
  }
}

// 启用 / 禁用已有账号
async function toggleAccStatus() {
  if (accBusy.value || !editTarget.value || !editTarget.value.account_user_id) return
  const next = editTarget.value.account_active ? 0 : 1
  accBusy.value = true
  try {
    await api(`/api/users/${editTarget.value.account_user_id}/status`, { method: 'PUT', body: { is_active: next } })
    toast(next ? '账号已启用' : '账号已禁用', 'ok')
    // v290（2026-09-27）：同 saveAccRole —— 不关窗（关窗会吃掉档案区未保存的改动）。
    await loadEmployees()
    const fresh = employees.value.find(x => x.id === (editTarget.value && editTarget.value.id))
    if (fresh) editTarget.value = fresh
  } catch (e) { toast(e.message || '操作失败', 'err') }
  finally { accBusy.value = false }
}
/* ---- Excel 导入 ---- */
const invFile = ref(null)
const invFileName = ref('')
const invResult = ref(null)
/* v178 列映射确认：先识别、你看一眼再导入（此前识别结果被直接执行，改不了）。 */
const impStep = ref('pick')
const impSuggestions = ref([])
const impFieldOptions = ref([])
const impMapping = ref({})
/* v303：映射记忆提示 + 「跳过已存在的记录」开关。员工按工号/姓名去重 —— 默认打开。 */
const impMemory = ref(null)
const impInc = ref(true)

function onInvFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls)$/i.test(f.name)) {
    toast('仅支持 Excel 文件（.xlsx / .xls），请用 Excel 另存后再上传', 'err')
    ev.target.value = ''
    return
  }
  invFile.value = f
  invFileName.value = f?.name || ''
  invResult.value = null
  impMemory.value = null
  impStep.value = 'pick'
}
async function downloadEmpTemplate() {
  try {
    const t = await importApi.template('employees')
    const csv = '﻿' + t.columns.join(',') + '\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '员工导入模板.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}
/* 第一步：只识别，不落库。 */
async function previewEmployees() {
  if (!invFile.value) return
  importing.value = true
  try {
    const prev = await importApi.preview(invFile.value, 'employees')
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    impMemory.value = prev.remembered || null
    if (!impSuggestions.value.length) { toast('没读到任何列，请检查文件', 'err'); return }
    const m = {}
    for (const s of impSuggestions.value) if (s.suggested_field) m[s.index] = s.suggested_field
    impMapping.value = m
    impStep.value = 'map'
  } catch (e) { toast(e.message || '文件解析失败', 'err') }
  finally { importing.value = false }
}
/* 第二步：按确认过的映射执行。 */
async function doImportEmployees() {
  if (!invFile.value) return
  importing.value = true
  try {
    const r = await importApi.execute(invFile.value, 'employees', impMapping.value,
                                      impInc.value ? { mode: 'incremental' } : {})
    invResult.value = r
    impStep.value = 'pick'
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadEmployees()
  } catch (e) { toast(e.message || '导入失败', 'err') }
  finally { importing.value = false }
}

onMounted(() => {
  loadEmployees()
  loadRoleCatalog()  // v300：角色下拉的动态值域（403/失败静默降级为内置 8 项，见函数注释）
  probeConnectors()
  loadExtAccounts()  // v308：外部客户账号（失败静默 —— 无权限就当"没有"，不打断整页）
})
</script>

<style scoped>
.sync-wrap{display:flex;align-items:center;gap:8px;flex-shrink:0}
.sync-state{font-size:11.5px;padding:3px 10px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.sync-state.linked{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.sync-state.unlinked{background:rgba(var(--war-rgb),.12);color:var(--war)}

.df-panel{padding:18px;margin-bottom:14px}
.df-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.df-tip code{background:var(--bg2);padding:1px 6px;border-radius:5px;font-size:12px}
/* v312：角色默认端的出处说明 / 内联小按钮 / 「与角色配置不一致」提示条 */
.df-scope-src{margin:0 0 12px}
.df-mini-lnk{border:none;background:none;color:var(--p);cursor:pointer;font-size:12.5px;padding:0 2px;text-decoration:underline}
.df-mini-lnk:hover{color:var(--p-dark)}
.df-mismatch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 10px;padding:7px 10px;border-radius:var(--radius-md);background:var(--bg3)}
.df-mismatch-tag{font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:20px;background:rgba(234,179,8,.18);color:var(--t1);border:1px solid rgba(234,179,8,.5);flex-shrink:0}
.df-mismatch-txt{font-size:12.5px;color:var(--t2);line-height:1.6;min-width:0;flex:1 1 240px}
.df-warn{color:var(--war);background:rgba(var(--war-rgb),.08);padding:8px 12px;border-radius:8px;font-size:12px}

.df-ph{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.df-ph-right{display:flex;align-items:center;gap:10px}
.df-no{display:inline-block;margin-left:6px;font-size:11px;color:var(--t3)}
.df-edit-in{width:110px;height:30px;font-size:12.5px}
.df-ops{white-space:nowrap}
.df-ops .btn{margin-left:6px}

.df-import-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
/* v178 列映射确认步：表格 + 底部「返回/确认导入」 */
.df-map{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.df-file-btn{position:relative;overflow:hidden}
.df-fname{font-size:12.5px;color:var(--t2)}
/* v303：`.df-result / .df-errs / .df-err` 已随模板删除（结果展示改由共用的
   `ImportReceipt.vue` 负责，它自带样式）。本页不再有 `class="df-result"` 的元素。 */

/* 账号/门店 */
.df-acc{font-size:12px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t3);white-space:nowrap}
/* v294：个人仓（有仓 = 可用色标出，未设 = 弱化 —— 后者是需要老板去补的状态） */
/* v381：`.df-wh`（个人仓行内标签）已随列表列删除。 */
.df-muted{font-size:11px;color:var(--t3)}
.df-acc.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.df-role{display:inline-block;font-size:11px;padding:1px 7px;border-radius:6px;margin-left:6px;background:rgba(var(--teal-rgb,14,165,164),.14);color:var(--teal,#0ea5a4);white-space:nowrap}
.df-role.r-admin{background:rgba(239,68,68,.14);color:#ef4444}
.df-role.r-boss{background:rgba(234,88,12,.14);color:#ea580c}
.df-role.r-accountant{background:rgba(59,130,246,.14);color:#3b82f6}
.df-role.r-sales{background:rgba(16,185,129,.14);color:#10b981}
.df-role.r-guide{background:rgba(168,85,247,.14);color:#a855f7}
.df-role.r-driver{background:rgba(245,158,11,.14);color:#f59e0b}
.df-role.r-staff{background:rgba(var(--teal-rgb,14,165,164),.14);color:var(--teal,#0ea5a4)}
/* 2026-09-19 补：此前 8 个角色只定义了 7 个色板，r-supervisor 落到基础 .df-role（teal），
   与 r-staff 撞色 —— 主管和其他角色混在一起看不出来。用 indigo 与既有的
   red/orange/blue/emerald/purple/amber 都拉开距离。 */
.df-role.r-supervisor{background:rgba(99,102,241,.14);color:#6366f1}
/* v307 分销商：角色表新增的第 9 个角色，**先想好色再上线** —— 不定义就会落回基础
   .df-role（teal）与「员工」撞色，列表里分不出谁是外部客户（2026-09-19 主管踩过同一个坑）。
   用 rose（玫瑰红）与既有 8 色都拉开距离，也暗示"外部 / 需留意"。 */
.df-role.r-distributor{background:rgba(244,63,94,.14);color:#f43f5e}
/* v308 外部客户账号分区：表单单行自适应换行（窄屏自动折行，不横向溢出）。 */
/* v317：外部客户弹窗宽度 —— 比「停用确认」略宽（要放 2 列字段 + 两行说明），
   比「编辑员工」（680px）窄，因为它没有薪酬那一大块。 */
.ext-modal{width:min(560px,94vw)}
.df-role.stopped{background:#e5e7eb !important;color:#9aa0a6 !important}
/* v266 兼任角色徽标：用**虚框**而非实底，与主角色实底徽标在视觉上分层
   —— 一眼看出「哪个是这个人的本职、哪个是兼的」。 */
.df-role-extra{background:transparent !important;border:1px dashed rgba(var(--teal-rgb,14,165,164),.55);color:var(--teal,#0ea5a4)}
/* v290：遮罩 .3 → .45。原值太浅，弹窗右侧还能看清整个员工列表，视觉焦点不集中。
   ⚠️ 这只是**对比度**问题，不是层叠问题 —— overlay 980 / modal 990 的层级本来就是对的，
      截图里露出的那块表格是没遮严的页面内容，不是 bug，别往 z-index 上修。 */
.df-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:980}
.df-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:88vh;display:flex;flex-direction:column;background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.df-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.df-modal-hd b{font-size:15px;color:var(--t1)}
.df-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.df-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow-y:auto}
.df-field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--t2)}
.req{color:var(--dan)}
/* .df-store-list / .df-store-item 于 2026-09-19 随「分配门店」弹窗一并移除
   （门店配置收敛到「预报订单管理 → 报单配置」）。 */
.df-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle);flex-shrink:0}

/* 停用视觉 */
.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.stopped-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 7px;border-radius:8px;background:#e5e7eb;color:#6b7280}
.btn.danger{color:var(--dan)}
.btn-danger{background:var(--dan);color:#fff;border:none}
.btn-danger:hover{filter:brightness(.95)}

/* 编辑弹窗布局 */
/* v290：600 → 680 —— 两列栅格下每列约 270px 太挤（"薪酬与账户"7 个字段会挤出半行留白）。 */
.edit-modal{width:min(680px,94vw)}
.df-edit-body{display:flex;flex-direction:column;gap:20px}
.df-sec{display:flex;flex-direction:column;gap:13px}
.df-sec-title{font-size:13px;font-weight:600;color:var(--t1);padding-left:11px;border-left:3px solid var(--p);line-height:1.2}
.df-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
.df-field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--t2)}
.df-field .input, .df-field select{width:100%;box-sizing:border-box;height:36px}
.df-field span{font-size:12.5px;color:var(--t2)}
.df-field .req{color:var(--dan);font-style:normal;font-weight:600}

/* 登录账号区 */
.df-acc-hint{margin-top:-2px}
.df-acc-sum{font-size:12.5px;color:var(--t2);margin:0 0 2px;line-height:1.6}
.df-acc-sum .on{color:var(--suc);font-weight:600}
.df-acc-sum .off{color:var(--t3)}
.df-acc-create{display:flex;flex-direction:column;gap:12px}
.df-acc-manage{display:flex;flex-direction:column;gap:12px}
/* v290 画的卡片边框，v382 后语义已变：**不再是「保存边界」，只是分组**。
   原先这一段是「各自独立保存」的（卡片以内自己存，卡片以外归底部「保存基本信息」），
   边框用来告诉用户"一个保存单位"到哪儿为止；v382 把三个保存按钮并成一个之后，
   **整窗只有一个保存入口**，边框只剩"这块属于登录账号"的分组含义。 */
.df-acc-card{border:1px solid var(--border-subtle);border-radius:12px;padding:14px 14px 15px;background:var(--bg2);gap:11px}
.df-acc-card-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.df-acc-card-t{font-size:12.5px;font-weight:600;color:var(--t1)}
/* 文字色跟主题走（浅色=深字 / 深色=浅字），只有底色是黄调 —— 避免深色主题下看不清。 */
.df-dirty-tag{font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:20px;background:rgba(234,179,8,.18);color:var(--t1);border:1px solid rgba(234,179,8,.5)}
.df-acc-card-tip{font-size:12px;color:var(--t3);margin:-4px 0 0;line-height:1.6}
.df-acc-card-tip b{color:var(--t2)}
/* v290：操作行 + 紧贴其下的展开区（输入框**不再**长在按钮上方、隔着别的区块）。 */
.df-acc-ops{padding-top:1px}
.df-acc-ops .btn.is-on{border-color:var(--teal);color:var(--teal)}
.df-acc-right{margin-left:auto}
.df-acc-expand{display:flex;flex-direction:column;gap:10px;padding:10px 11px;border-radius:9px;background:var(--bg);border:1px dashed var(--border-subtle)}
.df-acc-exp-label{font-size:12.5px;color:var(--t2);flex-shrink:0;min-width:56px}
.df-acc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.df-acc-row .input, .df-acc-row select{flex:1;min-width:0}
/* v266 兼任角色选择：独占一行、可点选的 chip（多选）。
   不用 `<select multiple>` —— 手机上多选下拉极难操作，而这里的语义就是「勾几个」，
   chip 更直白、也不用按住 Ctrl。 */
.df-acc-extra{align-items:flex-start;flex-direction:column;gap:7px}
.df-acc-extra-tip{font-size:12px;color:var(--t3)}
.df-extra-chips{display:flex;flex-wrap:wrap;gap:6px}
.df-extra-chips .chip{border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t2);font-size:12px;padding:3px 10px;border-radius:20px;cursor:pointer;font-family:inherit;line-height:1.6}
.df-extra-chips .chip:hover{border-color:var(--teal)}
.df-extra-chips .chip.on{background:rgba(var(--teal-rgb,14,165,164),.14);border-color:var(--teal);color:var(--teal);font-weight:600}
.df-extra-chips .chip:focus-visible{outline:2px solid var(--teal);outline-offset:1px}
/* Q29（2026-09-19）忘记密码：一次性重置码的展示区 */
.rc-tip{font-size:12px;color:var(--t3);line-height:1.5}
.rc-box{gap:10px;background:var(--bg2);border-radius:9px;padding:8px 12px}
.rc-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;letter-spacing:3px;color:var(--teal)}
.rc-exp{font-size:12px;color:var(--t3);margin-left:auto}
.btn-block{width:100%}
.warn-text{color:var(--dan);font-weight:500}
.acc-role{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:9px;padding:0 11px;font-size:13px;background:var(--bg);color:var(--t1);appearance:none;cursor:pointer}
</style>
