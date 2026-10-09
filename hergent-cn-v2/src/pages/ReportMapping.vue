<template>
  <div class="page">
    <!-- v424（2026-10-10）：「报单配置」原是一张长页面（运行参数三块 + 报单对象列表），
         首屏放不下全部配置项。现按侧栏「报单配置」分组的四个入口拆成四张独立子页
         （报单对象 / 报单自动化 / 报单提醒设置 / 模板参数，见 `Forecast.vue` 的
         `TAB_KEYS` 与 `Shell.vue::NAV`）—— **本页 = 其中的「报单对象」**。
         其余三块各自成页：`AutoPeriodBlock.vue` / `ReminderConfig.vue` /
         `components/forecast/TemplateParams.vue`。
         🔴 拆的只是「一页变四页」的版式：本页的列表、弹窗、写路径与短语判据一字未改。 -->
    <div class="page-hd">
      <div>
        <h2>报单对象</h2>
        <span class="page-sub">把"系统全称 ↔ 报单简称(列头) ↔ 单型"一次性配好，报单人（员工 / 外部客户）小程序报单不再碰列名</span>
      </div>
    </div>

    <!-- 配置体检红标 -->
    <div v-if="health" class="health-bar" :class="{ ok: !hasProblem }" @click="healthOpen = !healthOpen">
      <span class="hb-dot"></span>
      <template v-if="hasProblem">
        配置体检：<b>{{ health.unmapped_count }}</b> 个门店未配置 · <b>{{ health.alias_conflicts.length }}</b> 个别名冲突 · <b>{{ health.unassigned_count }}</b> 名员工未分配<template v-if="health.unassigned_ext_count"> · <b>{{ health.unassigned_ext_count }}</b> 个外部客户未配门店</template>
        <span class="hb-toggle">{{ healthOpen ? '收起' : '展开' }}</span>
      </template>
      <template v-else>配置体检：全部正常</template>
    </div>

    <!-- 体检详情 -->
    <div v-if="healthOpen && hasProblem" class="card health-detail">
      <div v-if="health.alias_conflicts.length" class="hd-sec">
        <b class="hd-t war">别名冲突（活跃配置中简称重复，需在编辑时修改）</b>
        <ul><li v-for="c in health.alias_conflicts" :key="c.report_alias">简称「{{ c.report_alias }}」重复 {{ c.c }} 次</li></ul>
      </div>
      <div v-if="health.unmapped_objects.length" class="hd-sec">
        <b class="hd-t">尚未配置报单的门店（前 50）</b>
        <div class="chip-row"><span v-for="o in health.unmapped_objects" :key="o.id" class="chip">{{ o.name }}</span></div>
      </div>
      <div v-if="health.unassigned_employees.length" class="hd-sec">
        <b class="hd-t">尚未配置报单的员工</b>
        <div class="chip-row"><span v-for="e in health.unassigned_employees" :key="e.id" class="chip">{{ e.name }}</span></div>
      </div>
      <!-- v317：已开小程序号、但**一条报单配置都没有**的外部客户。
           不列出来的话，这号就是「能登录、点进去没有任何可报门店」，而且完全不报错。 -->
      <div v-if="(health.unassigned_externals || []).length" class="hd-sec">
        <b class="hd-t war">已开号但没配门店的外部客户（小程序里没东西可选）</b>
        <div class="chip-row"><span v-for="x in health.unassigned_externals" :key="x.id" class="chip">{{ x.name }}</span></div>
      </div>
    </div>

    <!-- 历史门店授权（2026-09-19 收敛）：在旧「员工档案 → 分配门店」里配过、但尚未纳入
         本页报单配置的门店。员工档案侧入口已移除 ⇒ 写端只剩本页；不把它们列出来，
         这些门店就是「小程序看得到、后台没处改」。补一条「门店」映射即收敛
         （之后由映射派生，可停用、可收回）。 -->
    <div v-if="legacyStores.length" class="legacy-bar" @click="legacyOpen = !legacyOpen">
      <span class="lb-dot"></span>
      历史门店授权：<b>{{ legacyStores.length }}</b> 条门店来自旧「员工档案 → 分配门店」，尚未纳入报单配置
      <span class="lb-toggle">{{ legacyOpen ? '收起' : '展开' }}</span>
    </div>
    <div v-if="legacyOpen && legacyStores.length" class="card legacy-detail">
      <b class="hd-t">这些门店现在只有本页能改</b>
      <p class="lb-tip">
        <b>还要用</b> —— 点工具栏「新建配置」，给该员工建一条「门店」映射；此后由映射派生，
        可停用、可启用。<br>
        <b>不要了</b> —— 点「收回」，该员工在小程序里就不再能选这家门店报单；
        <b>不影响</b>已经报过的单与应收。
      </p>
      <ul>
        <li v-for="l in legacyStores" :key="l.employee_id + '-' + l.store_id">
          <span class="lb-row">
            <b>{{ l.employee_name || ('员工 #' + l.employee_id + '（已不在员工档案里）') }}</b>
            <span class="lb-arrow">→</span>
            <span>{{ l.store_name }}</span>
            <span v-if="l.store_active === 0" class="tag danger">门店已停用</span>
            <!-- v335 按钮级门禁：DELETE /api/report-mappings/legacy-stores/… ⇒ data/delete -->
            <button v-if="canDo('data', 'delete')" class="btn btn-ghost btn-sm danger lb-revoke" @click="askLegacyRevoke(l)">收回</button>
          </span>
        </li>
      </ul>
    </div>

    <!-- 工具栏：新建配置为数据区唯一主操作（实底主色），Excel 导入描边次之 -->
    <div class="toolbar">
      <!-- v335 按钮级门禁：新建=POST /api/report-mappings ⇒ data/create；
           Excel 导入=POST /api/report-mappings/import ⇒ data/create -->
      <button v-if="canDo('data', 'create')" class="btn btn-primary" @click="openCreate">+ 新建配置</button>
      <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" @click="importOpen = true">Excel 批量导入</button>
    </div>

    <!-- 列表 -->
    <div class="card table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th class="seq-th">序号</th><th>报单人</th><th>对象类型</th><th>对象全称</th><th>简称(列头)</th>
            <th>单型</th><th>取价渠道</th><th>仓库(调拨)</th><th>状态</th><th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in list" :key="m.id" :class="{ stopped: m.is_active === 0 }">
            <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
            <td>
              {{ m.person_name || m.employee_name || '—' }}
              <!-- v317：标出「这一行的报单人不是员工」。不标的话，同名的店与外部客户在
                   列表里长得一样，停用/编辑时容易改错行（列表是唯一能一眼看到全量配置的地方）。 -->
              <span v-if="m.subject_kind === 'external'" class="tag purple" title="外部客户（分销商）账号 —— 在「员工档案 › 外部客户账号」里开通">外部客户</span>
            </td>
            <td><span class="tag" :class="typeClass(m.counterparty_type)">{{ typeLabel(m.counterparty_type) }}</span></td>
            <td>{{ m.counterparty_name || m.system_name || '—' }}</td>
            <td><b>{{ m.report_alias }}</b></td>
            <!-- v294：单型列显示**派生值**，不显示库里存的旧值 —— 存量行可能存着与类型
                 矛盾的历史值（"门店 + 调拨单"），显示它等于把错误当事实播出去。
                 派生值才是系统实际会做的事。 -->
            <td>{{ orderTemplateFor(m.counterparty_type) }}</td>
            <td>{{ channelShow(m) }}</td>
            <td class="num">{{ whShow(m) }}</td>
            <td>
              <span v-if="m.is_active === 0" class="tag danger">已停用</span>
              <span v-else class="tag suc">启用中</span>
            </td>
            <td class="ops">
              <!-- v335 按钮级门禁：编辑=PUT /api/report-mappings/{mid} ⇒ data/update；
                   停用·启用=**POST** …/{mid}/toggle ⇒ data/**create**（动作由 HTTP 方法推导） -->
              <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(m)">编辑</button>
              <button v-if="m.is_active !== 0 && canDo('data', 'create')" class="btn btn-ghost btn-sm danger" @click="askDisable(m)">停用</button>
              <button v-else-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" @click="toggle(m.id, 1)">启用</button>
            </td>
          </tr>
          <tr v-if="!list.length"><td colspan="10" class="empty">暂无报单配置，点「新建配置」或「Excel 批量导入」开始</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 新建/编辑抽屉 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="editOpen" class="df-overlay" @click="editOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="editOpen" class="df-modal edit-modal">
          <div class="df-modal-hd">
            <div class="df-modal-hd-l">
              <b>{{ editId ? '编辑配置' : '新建配置' }}</b>
              <span class="req-legend"><i class="req">*</i> 必填项</span>
            </div>
            <button class="df-x" @click="editOpen = false"><Icon name="close"/></button>
          </div>
          <div class="df-modal-body">
            <!-- ① 归属 -->
            <div class="form-grp">
              <div class="sub-sec">归属</div>
              <div class="field" :class="{ err: errors.employee_id }">
                <!-- v317：「员工」→「报单人」。外部客户（分销商）也在这一个下拉里，
                     用 optgroup 分组而不是两个控件 —— 分成两个会让人以为要各配一次。 -->
                <label>报单人 <i class="req">*</i></label>
                <select v-model="subjectKey" :disabled="!!editId" @change="onEmpChange">
                  <option value="">请选择</option>
                  <optgroup v-if="refs.employees.length" label="员工">
                    <option v-for="e in refs.employees" :key="'e' + e.id" :value="'employee:' + e.id">{{ e.name }}</option>
                  </optgroup>
                  <optgroup v-if="refs.externals.length" label="外部客户（分销商）">
                    <option v-for="x in refs.externals" :key="'x' + x.id" :value="'external:' + x.id">{{ x.name }}{{ x.is_active ? '' : '（已禁用）' }}</option>
                  </optgroup>
                </select>
                <span v-if="errors.employee_id" class="field-err">{{ errors.employee_id }}</span>
                <span v-if="!editId && !refs.externals.length" class="al-note">
                  还没有外部客户账号？先<button type="button" class="lnk-btn" @click="goEmployees">去员工档案开通</button>，再回来给他配门店。
                </span>
              </div>
            </div>

            <!-- ② 对象定义 -->
            <div class="form-grp">
              <div class="sub-sec">对象定义</div>
              <div class="field" :class="{ err: errors.counterparty_type }">
                <label>对象类型 <i class="req">*</i></label>
                <div class="seg">
                  <button v-for="t in typeOptions" :key="t.v" class="seg-btn" :class="{ on: form.counterparty_type === t.v }" @click="onType(t.v)">{{ t.label }}</button>
                </div>
                <span v-if="errors.counterparty_type" class="field-err">{{ errors.counterparty_type }}</span>
              </div>
              <div class="field" :class="{ err: errors.counterparty_id }">
                <!-- 🔴 v381（2026-10-06）：「设个人仓」的入口从**员工档案**搬到这里。
                     原先这一格是只读框，员工没设个人仓时显示「请先在员工档案设置其个人仓」
                     —— 对会计 / 主管是**死胡同**：他们进不去员工档案（`/api/employees/*` 归
                     `hr` 模块，403 被静默吞 ⇒ 列表恒空零报错），却在报单配置里被要求去那儿设。
                     现在本人仓也走**仓库下拉**（即选即存），保存时后端回写 `hr_employees.warehouse_id`。 -->
                <label>{{ objFieldLabel }} <i class="req">*</i></label>
                <div class="combo" ref="objCombo">
                  <input
                    class="combo-input"
                    v-model="objKeyword"
                    :placeholder="objPlaceholder"
                    @focus="objOpen = true"
                    @input="onObjInput"
                    @keydown.down.prevent="objMove(1)"
                    @keydown.up.prevent="objMove(-1)"
                    @keydown.enter.prevent="objEnter"
                    @keydown.esc="objOpen = false"
                  />
                  <span v-if="!objKeyword" class="combo-caret"><Icon name="chevron-down"/></span>
                  <div v-show="objOpen" class="combo-panel">
                    <div
                      v-for="(c, i) in objFiltered"
                      :key="c.id"
                      class="combo-item"
                      :class="{ on: i === objHi, sel: c.id === Number(form.counterparty_id) }"
                      @mousedown.prevent="pickObj(c)"
                      @mouseenter="objHi = i"
                    >{{ c.name }}<span v-if="isSelfWh && whOwnerMap[c.id]" class="combo-note">已被 {{ whOwnerMap[c.id] }} 占用</span><span v-if="c.id === Number(form.counterparty_id)" class="combo-sel"><Icon name="check"/></span></div>
                    <div v-if="!objFiltered.length" class="combo-empty">
                      <template v-if="isSelfWh && !refs.warehouses.length">还没有仓库档案 —— 请先到「档案管理 → 仓库档案」新建一个仓</template>
                      <template v-else>无匹配结果</template>
                    </div>
                  </div>
                </div>
                <!-- v381：本人仓的唯一性**就地拦**（与后端 `_resolve_self_warehouse` 同判据：
                     一个仓只能属于一个员工）。不拦的话后端会报错，而报错点离病因很远
                     （员工 B 建映射撞的是「同一对象只能有一条活跃配置」v297）。 -->
                <span v-if="isSelfWh && currentWhOwner" class="field-err">
                  这个仓已指派给「{{ currentWhOwner }}」—— 一个仓只能属于一个员工，请换一个，或先改他那条配置
                </span>
                <span v-if="errors.counterparty_id" class="field-err">{{ errors.counterparty_id }}</span>
                <!-- v297（用户 2026-09-27 拍板「要」）：同一对象被配了**第二条**活跃配置 ⇒
                     Excel 模板会为它生成两列、汇总表裂两列（简称唯一约束拦不住，因为两条简称不同）。
                     生产实例：`永辉东津店`（id=3「东津」+ id=7「永辉东津店」都曾启用）。
                     v297 起这不再只是警告 —— 前端就地拦、后端 create/update/toggle/import
                     **四条写路径**也一律硬拒（判据唯一实现 `report_mapping_find_same_object`）。 -->
                <span v-if="objExisting.length" class="al-hint err">
                  这个{{ typeLabel(form.counterparty_type) }}已经有一条活跃配置了：{{
                    objExisting.map(x => '「' + x.alias + '」' + ((x.person_name || x.employee_name) ? '（' + (x.person_name || x.employee_name) + '）' : '')).join('、')
                  }} —— 同一对象只能有一条，再配一条会把汇总表和舟谱模板拆成两列、数量分家。
                  <b>保存会被拒绝</b>：若只是要换人负责，请改那一条配置，或先把它停用。
                </span>
              </div>
              <!-- v295（2026-09-27）：简称从「手打」改为「点选既有列头 + 自动解析」。
                   为什么这不是 UI 偏好而是业务必要：汇总表列头 = `forecast_submissions.store_name`
                   的全历史名册（后端 all_units）。手打一个名册外的名字 ≠ 改名，
                   而是给汇总表**新增一列** —— 同一个门店就此裂成两列、且永不自动合并
                   （v247 用户报障「配了简称，数据却没落到简称那一列」的病根）。
                   选中对象后自动解析：该对象上次报单用的列头 → 该对象配置中的简称 → 对象全称。
                   候选项直接标出「已被他人占用 / 已隐藏 / 你正在用 / 最近使用日期」。 -->
              <div class="field" :class="{ err: errors.report_alias }">
                <label>报单简称(列头) <i class="req">*</i></label>
                <div class="combo" ref="aliasCombo">
                  <input
                    class="combo-input"
                    v-model="form.report_alias"
                    placeholder="点选历史列头，或输入新名（如：东津）"
                    @focus="aliasOpen = true"
                    @input="onAliasInput"
                    @keydown.down.prevent="aliasMove(1)"
                    @keydown.up.prevent="aliasMove(-1)"
                    @keydown.enter.prevent="aliasEnter"
                    @keydown.esc="aliasOpen = false"
                  />
                  <span v-if="!form.report_alias" class="combo-caret"><Icon name="chevron-down"/></span>
                  <div v-show="aliasOpen" class="combo-panel">
                    <div class="al-hd">
                      <span>历史列头名册 · {{ aliasTotal }} 个</span>
                      <span v-if="aliasFromLabel" class="al-from">已带出：{{ aliasFromLabel }}</span>
                    </div>
                    <div
                      v-for="(a, i) in aliasFiltered"
                      :key="a.name"
                      class="combo-item"
                      :class="{ on: i === aliasHi, sel: a.name === aliasTrimmed }"
                      @mousedown.prevent="pickAlias(a)"
                      @mouseenter="aliasHi = i"
                    >
                      <span class="al-name">{{ a.name }}</span>
                      <span v-if="aliasOthers(a).length" class="al-tag war">已被他人占用</span>
                      <span v-else-if="a.hidden" class="al-tag">已隐藏</span>
                      <span v-else-if="a.used_by.length" class="al-tag mine">你正在用</span>
                      <span v-else-if="a.last_used" class="al-tag">{{ a.last_used }}</span>
                      <span v-else class="al-tag">历史列头</span>
                    </div>
                    <div v-if="!aliasFiltered.length" class="combo-empty">
                      名册里没有「{{ aliasTrimmed }}」—— 保存将新建一个列头
                    </div>
                  </div>
                </div>
                <span v-if="errors.report_alias" class="field-err">{{ errors.report_alias }}</span>
                <span v-if="aliasHint" class="al-hint" :class="aliasHint.tone">{{ aliasHint.text }}</span>
                <span v-else class="hint">简称即报单汇总表的列头文字，落列按它匹配，与全称解耦。</span>
                <!-- v295：当前简称不在名册里（= 会新增一列）时，把后端按名字归一化找出的
                     相近列头做成**一键改选** —— 这是把裂列拦在配置阶段的最后一米。 -->
                <div v-if="aliasNearby.length && aliasHint && aliasHint.tone === 'warn'" class="al-near">
                  <span>名册里有相近的列头：</span>
                  <button
                    v-for="nm in aliasNearby"
                    :key="nm"
                    type="button"
                    class="al-near-btn"
                    @click="pickAliasName(nm)"
                  >{{ nm }}</button>
                  <span class="al-near-tip">点一下改用它，就不会新增列了</span>
                </div>
              </div>
              <div class="field">
                <label>单型</label>
                <input :value="derivedTemplate" disabled />
                <span class="hint">
                  由「对象类型」自动决定，不可手改：门店 → <b>自提订单</b>，本人仓 → <b>调拨单</b>。
                  （舟谱模板进「自提订单」还是「调拨订单」表，判据只有对象类型。）
                </span>
              </div>
            </div>

            <!-- ③ 价格与仓库 · 选填 -->
            <div class="form-grp">
              <div class="sub-sec">价格与仓库 · 选填</div>
              <div v-if="form.counterparty_type !== 'self_warehouse'" class="field">
                <label>取价渠道</label>
                <select v-model="form.channel_id">
                  <option :value="0">自动（按客户档案／默认渠道）</option>
                  <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }}{{ c.is_default ? '（默认）' : '' }}</option>
                </select>
                <span class="hint">
                  默认「自动」＝先看该客户档案上绑的渠道，没绑就落到默认渠道。这里选了就一直用它，覆盖客户档案。
                  调拨不走渠道取价，故不显示。
                </span>
              </div>
              <template v-if="form.counterparty_type === 'self_warehouse'">
                <div class="field">
                  <label>源仓</label>
                  <select v-model="form.src_wh"><option value="0">请选择</option><option v-for="w in refs.warehouses" :key="w.id" :value="w.id">{{ w.name }}</option></select>
                </div>
                <div class="field">
                  <label>目标仓</label>
                  <select v-model="form.dst_wh"><option value="0">请选择</option><option v-for="w in refs.warehouses" :key="w.id" :value="w.id">{{ w.name }}</option></select>
                </div>
                <span class="hint">
                  这两个仓会写进舟谱<b>调拨单</b>的「调出仓 / 调入仓」两列。
                  源仓留空则用「默认业务仓」；目标仓留空则用上面选定的<b>个人仓</b>。
                  仓库还没建？去「档案管理 → 仓库档案」先建。
                </span>
              </template>
            </div>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="editOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 停用确认 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="disableOpen" class="df-overlay" @click="disableOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="disableOpen" class="df-modal">
          <div class="df-modal-hd"><b>停用配置</b><button class="df-x" @click="disableOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="warn-text">停用后该对象不再出现在员工报单下拉中，且不计入报单汇总。已保存的历史报单不受影响。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="disableOpen = false">取消</button>
            <button class="btn btn-danger" @click="confirmDisable">确认停用</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 收回历史门店授权（v216）：与「停用配置」不同 —— 这里删的是 employee_stores
         那一行（旧入口留下的授权），不是 report_mapping 的映射行。 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="revokeOpen" class="df-overlay" @click="revokeOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="revokeOpen" class="df-modal">
          <div class="df-modal-hd"><b>收回门店</b><button class="df-x" @click="revokeOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="warn-text">
              确认收回「{{ revokeTarget.employee_name || ('员工 #' + revokeTarget.employee_id) }}」
              对「{{ revokeTarget.store_name }}」的报单资格？
            </p>
            <p class="hint">收回后，该员工在小程序里不再能选这家门店报单。<b>不影响</b>已保存的历史报单与应收。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="revokeOpen = false">取消</button>
            <button class="btn btn-danger" :disabled="revoking" @click="confirmLegacyRevoke">{{ revoking ? '收回中…' : '确认收回' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Excel 导入 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="importOpen" class="df-overlay" @click="importOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="importOpen" class="df-modal">
          <div class="df-modal-hd"><b>Excel 批量导入配置</b><button class="df-x" @click="importOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="hint">
              模板表头（7 列）：员工 / 对象类型 / 对象全称 / 简称(列头) / 单型 / 源仓 / 目标仓。
              对象类型填 store（门店）或 self_warehouse（本人仓）。
              <b>单型那一列由「对象类型」自动决定</b>（填了不生效，见上方单型说明）——
              源仓 / 目标仓只对本人仓（调拨）有意义。
            </p>
            <label class="upload-btn">选择 Excel 文件
              <input type="file" accept=".xlsx,.xls" @change="onFile" hidden />
            </label>
            <div v-if="importResult" class="imp-result">
              <p>成功 <b class="suc">{{ importResult.imported }}</b> 行 · 失败 <b class="dan">{{ importResult.failed }}</b> 行</p>
              <ul v-if="importResult.failures.length"><li v-for="(f, i) in importResult.failures" :key="i">第 {{ f.row }} 行：{{ f.reason }}</li></ul>
            </div>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="importOpen = false">关闭</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
/* v317：页内跳转入口同判据（见 goEmployees）。 */
import { canSee } from '../constants/pages'
import { reportMappingApi, priceChannelApi } from '../api/modules'
import { api } from '../api/client'
import { toast, canDo } from '../store'

const list = ref([])
const router = useRouter()
/* v317：给「还没有外部客户账号」的提示条一个**真入口**。
   🔴 入口同判据（与 `EmployeeArchive::goConnect` 同规矩）：能进「报单配置」的人
      **不一定**能进员工档案 ⇒ 不判就会出现「点了没反应 / 被弹回工作台」的假入口。 */
function goEmployees() {
  if (!canSee('/archive/employees')) { toast('你没有访问「员工档案」的权限', 'warn'); return }
  router.push('/archive/employees')
}
// v317：`externals` = 外部客户（分销商）账号名册（后端按租户收口后下发）。
const refs = reactive({ employees: [], contacts: [], warehouses: [], externals: [] })
const health = ref(null)
const healthOpen = ref(false)
// 历史门店授权（旧「员工档案 → 分配门店」留下的、尚未纳入报单配置的门店）。
// 员工档案侧入口 2026-09-19 已移除 ⇒ 写端只剩本页；不把它们列出来，
// 这些门店就变成「小程序看得到、后台没处改」（读端有来源、写端无入口）。
const legacyStores = ref([])
const legacyOpen = ref(false)
const editOpen = ref(false)
const editId = ref(0)
const saving = ref(false)
const disableOpen = ref(false)
const disableTarget = ref(0)
// v216（2026-09-20）：**收回**历史门店授权（删 `employee_stores` 单行）。
// ⚠️ 与上面的「停用配置」不是同一件事：那条改的是 `report_mapping` 的**映射行**
// （停用后可再启用），这条删的是旧「员工档案 → 分配门店」留下的**授权行**
// （删了就没了，要恢复得重新建一条映射）。两者都只影响"还能不能报单"。
const revokeOpen = ref(false)
const revokeTarget = ref({})
const revoking = ref(false)
const importOpen = ref(false)
const importResult = ref(null)

// 🔴 v203（2026-09-19）：对象类型收敛为 —— 门店 / 本人仓。
// 依据：`/api/report-mappings/refs` 返回的对象池是 `contacts.type IN ('customer','both')`，
// 「门店」与「客户」两个入口点开选的是**同一批对象**，这个类型只是个分类标签。
// 用户定调「门店和客户是一个意思」⇒ 去掉「客户」入口。
// ⚠️ `customer` 作为**历史兼容别名**仍被后端读端认识（存量行 / 旧 Excel 不会消失），
//    本页把它按「门店」显示、保存即写成 store —— 口径与后端 REPORT_CP_ALIASES 同源。
const types = [
  { v: 'store', label: '门店' },
  { v: 'self_warehouse', label: '本人仓' },
]

/* 🔴 v317（2026-09-29）：报单人新增**外部客户（分销商）**一维。
   背景：v308 给外部客户开了「只登小程序」的账号，但报单配置里没有他们的位置
   （员工下拉只列 `hr_employees`）⇒ 客户开完号，小程序里**永远没有可报对象**。
   本页现在按主体给出可选对象类型：
     · 员工       → 门店 / 本人仓（本人仓要绑 `hr_employees.warehouse_id`）
     · 外部客户   → **只有门店**（他没有员工档案，谈不上「个人仓」；后端也硬拒）
   两面同口径：后端 `report_mapping_create` 对外部客户配「本人仓」直接返错。 */
const isExternalSubject = computed(() => Number(form.external_user_id) > 0)
const typeOptions = computed(() => (isExternalSubject.value ? types.filter(t => t.v !== 'self_warehouse') : types))

/** 「报单人」下拉的绑定值：`employee:12` / `external:999908` / `''`。
 *  用一个字符串键而不是两个下拉，是为了让「员工和外部客户是同一件事的两种取值」在界面上
 *  一眼可见 —— 分成两个控件会让人以为要各配一次。 */
const subjectKey = computed({
  get() {
    if (Number(form.external_user_id) > 0) return 'external:' + form.external_user_id
    if (Number(form.employee_id) > 0) return 'employee:' + form.employee_id
    return ''
  },
  set(v) {
    const s = String(v || '')
    const i = s.indexOf(':')
    form.employee_id = 0
    form.external_user_id = 0
    if (i <= 0) return
    const kind = s.slice(0, i)
    const id = Number(s.slice(i + 1)) || 0
    if (!id) return
    if (kind === 'external') form.external_user_id = id
    else form.employee_id = id
  },
})

// 历史 `customer` → `store`。只做**词汇归一**（与后端 normalize_report_cp_type 同义），
// 不在这里做任何权限/合法性判断。
function normalizeCpType(t) { return t === 'customer' ? 'store' : t }

const form = reactive({
  // v317：报单人**两维** —— 员工（`employee_id`）或外部客户（`external_user_id`）。
  // 后端二者必居其一且不可同传（见 `erp_db.report_mapping_create`）。
  employee_id: 0, external_user_id: 0,
  counterparty_type: 'store', counterparty_id: 0,
  system_name: '', report_alias: '', src_wh: 0, dst_wh: 0,
  channel_id: 0,
})
// ⚠️ 这里**有意没有** `order_template` 字段 —— 单型是派生的（见下方 derivedTemplate），
//    不再是用户可改的状态。留一个永远不用的表单字段就是"看起来还能手填"的假入口。

/* 🔴 v294（2026-09-27）：单型**由对象类型派生**，不再让用户手填。
   唯一判据与后端 `erp_db.order_template_for` 逐字一致（门店 → 自提订单 / 本人仓 → 调拨单）。

   为什么要锁死（用户 2026-09-27 报障）：舟谱模板把一张单写进「自提订单」还是
   「调拨订单」工作表，判据**只有** `counterparty_type`；而 `order_template` 在后端
   **零消费**（只写、只回显）。放开让用户填 ⇒「对象类型=门店 + 单型=调拨单」会让界面
   显示"调拨单"，实际生成的模板却进「自提订单」表 —— 同一对象两个互相矛盾的事实源，
   而且完全静默（不报错、不提示）。
   ⚠️ 改后端判据时**必须同步改这里**（反向索引：erp_db.py::order_template_for 的注释
      也点名了本文件）。两处不一致就会出现"界面说 A、系统做 B"的老问题。 */
function orderTemplateFor(t) { return t === 'self_warehouse' ? '调拨单' : '自提订单' }
const derivedTemplate = computed(() => orderTemplateFor(form.counterparty_type))

// v2026-09-23：字段级内联校验 —— 保存时把错误定位到具体字段（不再只弹 toast）
const errors = reactive({})
function clearErrors() { Object.keys(errors).forEach(k => delete errors[k]) }
/* v297：**单字段清错**。用户改掉那个字段之后，上一次保存留下的红字必须立刻消失 ——
   否则红字会挂在一个**已经被改掉**的字段下面，看起来像新填的值也有问题。
   实测（真机截图 03）：点过一次保存（拦下）→ 改选门店全称 → 上一轮的
   「这个门店已有一条活跃配置……」仍留在**新对象**下面，完全是误导。 */
function clearErr(k) { if (errors[k] !== undefined) delete errors[k] }

// v424：模板参数（原先在本文件里的 `tp*` 一组状态 + `loadProfile/saveProfile` +
//      `.tp-*` 样式）已整块迁到 `components/forecast/TemplateParams.vue` ——
//      它现在是侧栏「报单配置」分组的第 4 个子页，不再随本页挂载。

// v159（2026-09-14）：取价渠道。渠道是租户自配的数据，这里只做“覆盖位”；
// 0 = 不覆盖，按客户档案→默认渠道的顺序自动判。
const channels = ref([])
const chMap = computed(() => {
  const m = {}
  for (const c of channels.value) m[c.id] = c
  return m
})
function channelShow(m) {
  if (!m.channel_id) return '自动'
  const c = chMap.value[m.channel_id]
  return c ? c.name : `#${m.channel_id}（已删除）`
}

const hasProblem = computed(() => health.value && (
  health.value.unmapped_count > 0 || health.value.alias_conflicts.length > 0 || health.value.unassigned_count > 0
  // v317：老后端不给 `unassigned_ext_count` ⇒ `|| 0` 兜底，页面在老后端上行为不变。
  || (health.value.unassigned_ext_count || 0) > 0
))

// 🔴 v381：本人仓 = 对象轴上的一个值，但它的**落点**是员工属性（`hr_employees.warehouse_id`）。
//    下面几条 computed 就是「本人仓」与「门店」共用同一格下拉时的差异面。
const isSelfWh = computed(() => form.counterparty_type === 'self_warehouse')

const objOptions = computed(() => {
  if (isSelfWh.value) return refs.warehouses
  return refs.contacts
})

/* 已把某仓当个人仓的员工：仓 id → 员工名（**排除当前报单人** —— 编辑自己那条时不该显示"被自己占用"）。
   v381 新增约束「一个仓只能属于一个员工」（A1 语义：一人一仓）—— 这条 map 是它的前端那一半，
   后端那一半是 `erp_db._resolve_self_warehouse`（唯一写实现）。 */
const whOwnerMap = computed(() => {
  const m = {}
  const cur = Number(form.employee_id)
  for (const e of refs.employees) {
    const w = Number(e.warehouse_id) || 0
    if (w && e.id !== cur) m[w] = e.name
  }
  return m
})

// 当前选中的仓被谁占用（无占用 ⇒ 空串）。用于字段级红字，与后端返错**同判据**。
const currentWhOwner = computed(() => (isSelfWh.value ? (whOwnerMap.value[Number(form.counterparty_id)] || '') : ''))

// 对象下拉：可模糊查找的 combobox（门店数量大，原生 select 难翻）
const objKeyword = ref('')
const objOpen = ref(false)
const objHi = ref(0)
const objCombo = ref(null)
// v381：本人仓那一格显示「个人仓」而不是「本人仓全称」（后者读起来不知所云）。
const objFieldLabel = computed(() => (isSelfWh.value ? '个人仓' : `${typeLabel(form.counterparty_type)}全称`))
const objPlaceholder = computed(() => (isSelfWh.value ? '搜索仓库名称…' : `搜索${typeLabel(form.counterparty_type)}名称…`))
const objFiltered = computed(() => {
  const k = (objKeyword.value || '').trim().toLowerCase()
  const list = objOptions.value || []
  if (!k) return list
  return list.filter(c => (c.name || '').toLowerCase().includes(k))
})
function onObjInput() {
  // 重新输入即视为重新选择
  form.counterparty_id = 0
  form.system_name = ''
  objOpen.value = true
  objHi.value = 0
}
function pickObj(c) {
  form.counterparty_id = c.id
  form.system_name = c.name
  objKeyword.value = c.name
  objOpen.value = false
  clearErr('counterparty_id')   // v297：对象已换 ⇒ 上一轮针对旧对象的红字立即失效
  // v295：选中对象 → 自动解析它的历史列头（未手改过简称时才会覆盖）
  applySuggestAlias()
}
function objMove(d) {
  if (!objOpen.value) { objOpen.value = true; return }
  const n = objFiltered.value.length
  if (!n) return
  objHi.value = (objHi.value + d + n) % n
}
function objEnter() {
  if (!objOpen.value) return
  const c = objFiltered.value[objHi.value]
  if (c) pickObj(c)
}
/* ── v295（2026-09-27）：报单简称（列头）名册 + 自动解析 ──────────────────────
   数据源 = `/api/report-mappings/alias-pool`（三个来源合并，见 erp_db 的同名函数）。
   三条交互判据，每条都直接对应业务后果：
     ① **自动解析**：选中对象后按「该对象历史列头 → 该对象配置简称 → 对象全称」填入。
        用户一旦手改（`aliasTouched`）就不再覆盖 —— 自动填值绝不能盖掉人刚打的字。
     ② **点选**：候选项 = 汇总表**既有列头**，选中即接管那一列（不会新增列）。
     ③ **提前报冲突**：简称在活跃行内唯一（后端 `report_mapping_create` 的 dup 检查，
        原文案「简称「X」已存在…」）。不提前说，用户要到点保存才知道失败。 */
const aliasPool = ref({ aliases: [], suggest: {}, stats: {} })
const aliasCombo = ref(null)
const aliasOpen = ref(false)
const aliasHi = ref(0)
const aliasTouched = ref(false)   // 用户是否手改/点选过（之后自动解析不再覆盖）
const aliasFrom = ref('')         // 当前值为自动带出时的来源：mapping | report | system_name

const aliasTrimmed = computed(() => (form.report_alias || '').trim())
const aliasFromLabel = computed(() => ({
  mapping: '该对象配置中的简称',
  report: '该对象上次报单用的列头',
  name: '名册里名字最相近的列头（请核对是不是同一家）',
  system_name: '对象全称（名册里没有它的历史列头）',
}[aliasFrom.value] || ''))
/* 候选列表 = **只列真实列头**（后端 `listed`：源含 `report` 或 `hidden`）。
   🔴 v297（用户 2026-09-27 拍板「清」）：以前这里直接把 `aliases` 全量列出，
      于是「只在配置里出现过」的名字（某人配过、但从来没有报单真的写过它）也混在
      「历史列头名册」里，极易被读成"这就是历史列头"，而保存后其实是**新增一列**。
      生产实例：`美联（保康店）`（真列头是「美联保康」）、`永辉东津店`（真列头是「东津」）、
      `永诺（江山店）` —— 三个都只来自 `mapping`。
   ⚠️ 只是**不进候选**：它们仍在 `aliases` 里，所以「已被他人占用」的撞名提示
      （`aliasOthers`）与「同对象已有配置」提示（`objExisting`）照旧有效 —— 那两个恰好
      需要看到"配过但没落地"的名字。 */
const aliasFiltered = computed(() => {
  const k = aliasTrimmed.value.toLowerCase()
  const all = (aliasPool.value.aliases || []).filter(a => a.listed)
  return k ? all.filter(a => (a.name || '').toLowerCase().includes(k)) : all
})
// 名册条数口径：跟候选列表同源（后端 stats.total 也只数 listed），避免"说 24 个、只列 21 个"
const aliasTotal = computed(() => {
  const s = aliasPool.value.stats
  return s && typeof s.total === 'number' ? s.total : aliasFiltered.value.length
})
// 占用者：用了同一简称、但**不是本行自己**的活跃配置（编辑自己那条时不算冲突）
function aliasOthers(a) {
  const me = Number(editId.value) || 0
  return (a.used_by || []).filter(u => u.mapping_id !== me)
}
/* 输入框下方那行提示：三态 —— 接管既有列 / 会新增列 / 撞名会被拒。
   🔴 **判据必须是「报单真的落地过」（`sources` 含 `report`）或该列在隐藏名册里**，
      而不是「名字在名册里」—— 名册里有一批名字只来自 `mapping` 源（某人配过它、
      但从来没有报单真的用它），那种名字保存后**照样新增一列**。
      实测（生产）：`美联（保康店）` 就是这一类 —— 它在名册里（id=6 那条配置配了它），
      但历史列头实际叫「美联保康」；若按「在名册里 = 安全」提示，就是骗用户。 */
const aliasHint = computed(() => {
  const n = aliasTrimmed.value
  if (!n) return null
  const entry = (aliasPool.value.aliases || []).find(a => a.name === n)
  if (entry) {
    const others = aliasOthers(entry)
    if (others.length) {
      // v317：报单人两维 —— 外部客户行没有 `employee_name`，用后端统一给的 `person_name`；
      // 都取不到才回落「员工#id」（保持既有措辞，不新增第三种叫法）。
      const who = others.map(u => u.person_name || u.employee_name || ('员工#' + u.employee_id)).join('、')
      return { tone: 'err', text: `该简称已被「${who}」使用 —— 简称在租户内唯一，保存会被拒绝。请换一个名字，或先停用那一条配置。` }
    }
    const landed = entry.sources.includes('report')   // 报单真的用过它 = 汇总表真有这一列
    if (entry.hidden) {
      return { tone: 'ok', text: `「${entry.name}」${landed ? '曾是' : '是'}汇总表里被隐藏的列，保存后该列重新出现。` }
    }
    if (landed) return { tone: 'ok', text: `接管汇总表既有列头「${entry.name}」，不会新增列。` }
    return { tone: 'warn', text: `「${n}」只在配置里出现过、还没有任何报单用过它 —— 保存后汇总表会新增一列。` }
  }
  return {
    tone: 'warn',
    text: `名册里没有「${n}」这个列头 —— 保存后汇总表会新增一列。若这个门店以前报过单，请改选它原来那一列。`,
  }
})
// 后端按名字归一化算好的「相近列头」—— 只在当前简称**不在名册里**（上方 warn 态）时
// 拿来抢救：生产实例「美联（保康店）」↔ 名册「美联保康」、「永辉东津店」↔「东津」。
const aliasNearby = computed(() => {
  const cid = Number(form.counterparty_id) || 0
  if (!cid) return []
  const kind = form.counterparty_type === 'self_warehouse' ? 'warehouse' : 'store'
  const s = (aliasPool.value.suggest || {})[`${kind}:${cid}`]
  return (s && s.nearby) || []
})
/* 该对象是否**已被别的活跃配置**占用。
   🔴 生产实测存在这种形态：`永辉东津店`（contacts 2868）有两条活跃配置 —— id=3 用简称
      「东津」、id=7 用「永辉东津店」。Excel 模板按 `report_mapping_list` 逐条生成客户列 ⇒
      同一个门店会在模板里出现**两列**，导进去就是裂列（v247 同族）。
      简称唯一约束拦不住它（两条简称不同），所以必须在**选对象那一刻**就提示。 */
const objExisting = computed(() => {
  const cid = Number(form.counterparty_id) || 0
  if (!cid) return []
  const kind = form.counterparty_type === 'self_warehouse' ? 'warehouse' : 'store'
  const me = Number(editId.value) || 0
  const out = []
  for (const a of aliasPool.value.aliases || []) {
    for (const u of a.used_by || []) {
      if (u.mapping_id !== me && u.counterparty_type === kind && u.counterparty_id === cid) {
        out.push({ alias: a.name, employee_name: u.employee_name })
      }
    }
  }
  return out
})

// 自动解析：只在用户没手改过时生效
function applySuggestAlias() {
  if (aliasTouched.value) return
  const cid = Number(form.counterparty_id) || 0
  if (!cid) { form.report_alias = ''; aliasFrom.value = ''; return }
  const kind = form.counterparty_type === 'self_warehouse' ? 'warehouse' : 'store'
  const s = (aliasPool.value.suggest || {})[`${kind}:${cid}`]
  if (s && s.alias) { form.report_alias = s.alias; aliasFrom.value = s.from || ''; return }
  // 名册里没这个对象的痕迹（多半是**新门店**）⇒ 用对象全称兜底，并如实告知这会新增一列
  if (form.system_name) { form.report_alias = form.system_name; aliasFrom.value = 'system_name'; return }
  aliasFrom.value = ''
}
function onAliasInput() {
  aliasTouched.value = true
  aliasFrom.value = ''
  aliasOpen.value = true
  aliasHi.value = 0
  clearErr('report_alias')   // v297：简称已被改 ⇒ 上一轮「已被占用」的红字立即失效
}
function pickAlias(a) {
  form.report_alias = a.name
  aliasTouched.value = true    // 点选同样是「人的决定」，之后不再自动覆盖
  aliasFrom.value = ''
  aliasOpen.value = false
  clearErr('report_alias')     // v297：点选改值 ⇒ 上一轮「已被占用」的红字立即失效
}
// 给「相近列头」快捷按钮用：只带名字，复用同一条填值路径（保证行为一致）
function pickAliasName(name) { pickAlias({ name }) }
function aliasMove(d) {
  if (!aliasOpen.value) { aliasOpen.value = true; return }
  const n = aliasFiltered.value.length
  if (!n) return
  aliasHi.value = (aliasHi.value + d + n) % n
}
function aliasEnter() {
  if (!aliasOpen.value) return
  const a = aliasFiltered.value[aliasHi.value]
  if (a) pickAlias(a)
}
async function loadAliasPool() {
  // 名册是**辅助信息**：拉不到就不提示、不报错，用户仍能手打
  // （绝不能因为它把报单配置页带崩 —— 同 report_column_name 的 fail-safe 纪律）
  try {
    const r = await reportMappingApi.aliasPool()
    aliasPool.value = { aliases: r.aliases || [], suggest: r.suggest || {}, stats: r.stats || {} }
  } catch { aliasPool.value = { aliases: [], suggest: {}, stats: {} } }
}

function onDocClick(e) {
  if (objCombo.value && !objCombo.value.contains(e.target)) objOpen.value = false
  if (aliasCombo.value && !aliasCombo.value.contains(e.target)) aliasOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const whMap = computed(() => {
  const m = {}
  refs.warehouses.forEach(w => { m[w.id] = w.name })
  return m
})

// v381：选中员工的**既有**个人仓 —— 只作**下拉初值**（不再是只读的"强绑定"）。
// 员工还没设个人仓 ⇒ null，用户在下面那格下拉里**直接指派**（这正是本次从员工档案
// 搬过来的能力）；已设 ⇒ 自动带出，用户也可以在下拉里改成别的仓（后端会回写）。
const selectedEmpWh = computed(() => {
  const e = refs.employees.find(x => x.id === Number(form.employee_id))
  if (!e || !e.warehouse_id) return null
  return { id: e.warehouse_id, name: whMap.value[e.warehouse_id] || '本人仓' }
})

// 历史 `customer` 行按「门店」显示、用与门店**同一色板** —— 两者本就是同一批对象，
// 让它们看起来不同只会制造「这里有两种东西」的错觉（v203）。
function typeLabel(t) { return ({ store: '门店', customer: '门店', self_warehouse: '本人仓' })[t] || t }
function typeClass(t) { return ({ store: 'info', customer: 'info', self_warehouse: 'teal' })[t] || 'info' }
function whShow(m) {
  if (m.counterparty_type !== 'self_warehouse') return '—'
  const s = whMap.value[m.src_wh] || '?'
  const d = whMap.value[m.dst_wh] || '?'
  return `${s} → ${d}`
}

async function loadAll() {
  try { list.value = await reportMappingApi.list({ include_inactive: 1 }) } catch (e) { toast(e.message || '加载失败', 'err') }
  try { const r = await reportMappingApi.health(); health.value = r } catch {}
  // 历史门店授权：接口或表缺失时静默降级为空（不能因为一条提示把整页带崩）
  try { const r = await reportMappingApi.legacyStores(); legacyStores.value = r.items || [] } catch { legacyStores.value = [] }
}
async function loadChannels() {
  // 渠道字典只用于下拉与列头显示；失败不影响报单配置本身（不弹错、静默降级成「自动」）
  try { const r = await priceChannelApi.list(); channels.value = r.channels || [] } catch {}
}
async function loadRefs() {
  try {
    const r = await api('/api/report-mappings/refs')
    refs.employees = r.employees || []
    refs.contacts = r.contacts || []
    refs.warehouses = r.warehouses || []
    // v317：老后端（未升级）不会给这个键 ⇒ 回落空数组，页面对老后端仍可用（只是没有这一组选项）。
    refs.externals = r.externals || []
  } catch (e) { toast(e.message || '加载选项失败', 'err') }
}

function onType(t) {
  form.counterparty_type = t
  form.counterparty_id = 0
  form.system_name = ''
  objKeyword.value = ''
  clearErr('counterparty_id')   // v297：换轴（门店↔本人仓）等同于换对象
  // 本人仓：对象自动带出该员工的个人仓（v381：同时把仓名填进下拉输入框 ——
  // 下拉"选中"的显示靠 objKeyword，只设 counterparty_id 的话框里是空的）
  if (t === 'self_warehouse' && selectedEmpWh.value) {
    form.counterparty_id = selectedEmpWh.value.id
    form.system_name = selectedEmpWh.value.name
    objKeyword.value = selectedEmpWh.value.name
  }
  // v295：换类型 = 换对象，简称跟着重新解析（未手改时才会覆盖）
  applySuggestAlias()
}
function onEmpChange() {
  clearErr('employee_id')   // v297：报单人已选 ⇒ 上一轮「请选择报单人」立即失效
  // v317：切到**外部客户**时，对象类型只可能是「门店」——
  // 「本人仓」要读 `hr_employees.warehouse_id`，外部客户没有员工档案。
  // 这里主动把类型扳回门店并清空已选对象：否则会留下「类型=本人仓 + 报单人=外部客户」
  // 这种界面上说得通、一保存就被后端拒的组合（用户只会看到一句莫名其妙的报错）。
  if (isExternalSubject.value && form.counterparty_type === 'self_warehouse') {
    form.counterparty_type = 'store'
    form.counterparty_id = 0
    form.system_name = ''
    objKeyword.value = ''
    clearErr('counterparty_id')
    applySuggestAlias()
    return
  }
  // 切换报单人时，若当前为本人仓类型则重新解析其个人仓
  if (form.counterparty_type === 'self_warehouse') {
    if (selectedEmpWh.value) {
      form.counterparty_id = selectedEmpWh.value.id
      form.system_name = selectedEmpWh.value.name
    } else {
      form.counterparty_id = 0
      form.system_name = ''
    }
    // v381：下拉显示名跟着走（换人 ⇒ 仓可能不同；新人无个人仓 ⇒ 清空让用户自己选）
    objKeyword.value = selectedEmpWh.value ? selectedEmpWh.value.name : ''
    applySuggestAlias()
  }
}

function resetForm() {
  form.employee_id = 0; form.external_user_id = 0
  form.counterparty_type = 'store'; form.counterparty_id = 0
  form.system_name = ''; form.report_alias = ''
  form.src_wh = 0; form.dst_wh = 0
  form.channel_id = 0
  objKeyword.value = ''; objOpen.value = false
  // v295：新建时清空「已手改」标记 —— 否则上一轮的编辑残留会挡住自动解析
  aliasTouched.value = false; aliasFrom.value = ''; aliasOpen.value = false
}
function openCreate() { editId.value = 0; resetForm(); clearErrors(); editOpen.value = true }
function openEdit(m) {
  clearErrors()
  editId.value = m.id
  form.employee_id = m.employee_id
  // v317：报单人两维都要回填 —— 只回填 `employee_id` 会让外部客户那类行在下拉里显示
  // 「请选择」，用户一保存就把报单人抹掉（而且界面当时看着是"正常"的）。
  form.external_user_id = m.external_user_id || 0
  // v203：历史 `customer` 行归一成 `store` 再进表单 —— ① 类型分段控件里已无「客户」项，
  // 不归一则**没有任何按钮处于选中态**（用户第一反应是「这页坏了」）；
  // ② 保存时自然写回 store，存量数据在用户编辑时零迁移脚本收敛。
  form.counterparty_type = normalizeCpType(m.counterparty_type)
  form.counterparty_id = m.counterparty_id
  form.system_name = m.system_name || ''
  form.report_alias = m.report_alias || ''
  // v295：编辑时**只回填库里的值、不触发自动解析** —— 否则编辑一条「非 id 最小」的映射时，
  // suggest 会带出另一条的简称，一保存就撞唯一约束（后端 dup 检查）。
  // 用户**改对象**时才重新解析（pickObj/onType/onEmpChange 里都会调）。
  aliasTouched.value = false; aliasFrom.value = ''
  // ⚠️ v294：**不再回填** `m.order_template` —— 单型由类型派生（derivedTemplate）。
  //    存量行里存的可能是与类型矛盾的历史值（如"门店 + 调拨单"），把它填进表单
  //    会让用户看到"这个字段是调拨单、但类型是门店"，正是要消灭的那个矛盾。
  form.src_wh = m.src_wh || 0
  form.dst_wh = m.dst_wh || 0
  form.channel_id = m.channel_id || 0
  // 回填对象下拉显示名。v381：本人仓**也要回填** —— 它现在是一个可编辑的仓库下拉，
  // 不回填就是空白，用户一保存就把已选的仓抹成"未选"，而界面当时看着是正常的。
  objKeyword.value = ''
  const _f = objOptions.value.find(c => c.id === m.counterparty_id)
  if (_f) objKeyword.value = _f.name
  editOpen.value = true
}

async function save() {
  const errs = {}
  // v317：报单人两维任一即可。错误键仍用 `employee_id`（模板里那个字段的锚点），
  // 但文案必须说「报单人」—— 否则给外部客户配的人会以为自己漏填了某个叫"员工"的框。
  if (!form.employee_id && !form.external_user_id) errs.employee_id = '请选择报单人'
  // v381：本人仓漏选时的文案要说「个人仓」—— 说"对象"用户不知道指哪个框。
  // 同一条也由后端 `_resolve_self_warehouse` 兜（会返「请选择该员工的个人仓」），
  // 这里只是早一步告知，不用等一次失败往返。
  if (!form.counterparty_id) errs.counterparty_id = isSelfWh.value ? '请选择该员工的个人仓' : '请选择对象'
  // v381：一个仓只能属于一个员工（A1 语义）。front 就地拦，判据与后端 `_resolve_self_warehouse` 一致。
  else if (currentWhOwner.value) errs.counterparty_id = `该仓已指派给「${currentWhOwner.value}」，一个仓只能属于一个员工`
  if (!form.report_alias || !form.report_alias.trim()) errs.report_alias = '请填写报单简称（列头）'
  // v295：撞名**本地预检** —— 名册已知被他人占用时直接标红，不必等后端拒绝
  // （后端 dup 检查仍在，这里只是「早一步如实告知」，不是替代校验）
  else if (aliasHint.value && aliasHint.value.tone === 'err') errs.report_alias = '该简称已被占用，请改选或换一个'
  // v297：同一对象已有活跃配置 ⇒ **就地拒绝**（用户 2026-09-27 拍板「要」）。
  // 后端 create / update / toggle / import 四条写路径也硬拒 —— 这里只是把提示落到具体字段，
  // 不必等一次失败往返。判据同 objExisting（只算**活跃**配置；编辑自己那条不算）。
  if (objExisting.value.length && !errs.counterparty_id) {
    errs.counterparty_id = '这个' + typeLabel(form.counterparty_type) + '已有一条活跃配置，请改那一条，或先把它停用'
  }
  if (Object.keys(errs).length) {
    clearErrors(); Object.assign(errors, errs)
    toast('请完善标红的必填项', 'err'); return
  }
  clearErrors()
  saving.value = true
  try {
    const body = {
      employee_id: Number(form.employee_id), external_user_id: Number(form.external_user_id),
      counterparty_type: form.counterparty_type,
      counterparty_id: Number(form.counterparty_id), system_name: form.system_name,
      report_alias: form.report_alias,
      // v294：单型一律送**派生值**（后端也会同样派生一遍，双保险 —— 即使客户端被改坏，
      // 落库的也不会是"界面显示调拨单、实际生成自提订单"那种矛盾值）
      order_template: derivedTemplate.value,
      src_wh: Number(form.src_wh), dst_wh: Number(form.dst_wh),
      // ⚠️ 0 是有效值（＝自动/继承），必须原样传，不能被“空值不传”的写法挡掉
      channel_id: Number(form.channel_id) || 0,
    }
    const res = editId.value
      ? await reportMappingApi.update(editId.value, body)
      : await reportMappingApi.create(body)
    if (res && res.error) { toast(res.error, 'err'); return }
    toast(editId.value ? '已更新' : '已创建', 'ok')
    editOpen.value = false
    await loadAll()
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { saving.value = false }
}

function askDisable(m) { disableTarget.value = m.id; disableOpen.value = true }
// v216：收回历史门店授权。`l` 是 `legacy-stores` 返回的一行（employee_id/store_id/store_name/…），
// 整行存下来是为了确认弹窗能显示「谁 → 哪家店」，而不是只显示一个 id。
function askLegacyRevoke(l) { revokeTarget.value = { ...l }; revokeOpen.value = true }
async function confirmLegacyRevoke() {
  const t = revokeTarget.value || {}
  revoking.value = true
  try {
    const r = await reportMappingApi.revokeLegacyStore(t.employee_id, t.store_id)
    // `removed=0` = 该行本来就不存在（幂等，不是失败）。如实说出来，
    // 否则用户以为"点了没生效"；但仍然刷新页面，因为目标状态已经达成。
    toast(r && r.removed ? '已收回该门店的报单资格' : '该授权本就不存在，已按最新状态刷新', 'ok')
    revokeOpen.value = false
    await loadAll()
  } catch (e) {
    toast(e.message || '收回失败', 'err')
  } finally {
    revoking.value = false
  }
}
async function confirmDisable() {
  await toggle(disableTarget.value, 0)
  disableOpen.value = false
}
async function toggle(id, target) {
  try {
    // ⚠️ v297：**启用**方向会被后端硬拒（同一对象已有活跃配置时，见 report_mapping_toggle）。
    //    必须显式判 `res.error` —— 否则后端什么都没改、界面却报「已启用」= 静默失效。
    const res = await reportMappingApi.toggle(id, target)
    if (res && res.error) { toast(res.error, 'err'); return }
    toast(target ? '已启用' : '已停用', 'ok')
    await loadAll()
  } catch (e) { toast(e.message || '操作失败', 'err') }
}

async function onFile(e) {
  const file = e.target.files[0]
  if (!file) return
  try {
    const res = await reportMappingApi.importFile(file)
    importResult.value = res
    if (res && res.failed > 0) toast('部分行导入失败，请查看详情', 'err')
    else toast(`成功导入 ${res.imported} 行`, 'ok')
    await loadAll()
  } catch (err) { toast(err.message || '导入失败', 'err') }
  finally { e.target.value = '' }
}

// v295：`loadAliasPool` 与 refs 并行拉 —— 名册用于简称点选与自动解析，
// 拉不到就静默降级（用户仍能手打简称），不影响本页其它功能。
// v424：`loadProfile()` 已随模板参数卡片迁出（见 components/forecast/TemplateParams.vue）
//       —— 它现在只在「模板参数」子页挂载时拉，不再随本页加载。
onMounted(() => { loadRefs(); loadAll(); loadChannels(); loadAliasPool() })
</script>

<style scoped>
/* v424：`.sec-label`（分区眉标）与 `.tp-*`（模板参数卡片）两组样式已随内容迁出 ——
   「运行参数 / 报单对象」两个分区眉标随四页拆分消失，模板参数整卡搬到
   `components/forecast/TemplateParams.vue`。留在这里就是**死 CSS**（本项目纪律：
   死 CSS 与死代码同罪，会被后人当成"还在用"）。 */
.health-bar{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);background:rgba(var(--war-rgb),.06);border:1px solid var(--border-subtle);border-left:3px solid var(--war);padding:9px 14px;border-radius:var(--radius-md);margin-bottom:14px;cursor:pointer}
.health-bar.ok{background:rgba(var(--suc-rgb),.10);border-color:rgba(var(--suc-rgb),.35)}
.hb-dot{width:8px;height:8px;border-radius:50%;background:var(--war);flex-shrink:0}
.health-bar.ok .hb-dot{background:var(--suc)}
.hb-toggle{margin-left:auto;color:var(--p);font-size:12px}
.health-detail{margin-bottom:12px;padding:14px 16px}
.hd-sec{margin-bottom:12px}
.hd-sec:last-child{margin-bottom:0}
.hd-t{font-size:13px;color:var(--t1)}
.hd-t.war{color:var(--war)}
.chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
/* 历史门店授权提示条：与「配置体检」同构但用中性色 —— 它是「待收敛」不是「有错」。 */
.legacy-bar{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);background:var(--bg2);border:1px solid var(--border-subtle);border-left:3px solid var(--t3);padding:9px 14px;border-radius:var(--radius-md);margin-bottom:14px;cursor:pointer}
.lb-dot{width:8px;height:8px;border-radius:50%;background:var(--t3);flex-shrink:0}
.lb-toggle{margin-left:auto;color:var(--p);font-size:12px}
.legacy-detail{margin-bottom:12px;padding:14px 16px}
.lb-tip{font-size:12.5px;color:var(--t2);line-height:1.8;margin:8px 0 0}
.legacy-detail ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--t2);line-height:1.9}
/* 每行：员工 → 门店 [已停用] [收回] —— 用 inline-flex + wrap，窄屏时按钮换行不挤压文字 */
.lb-row{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.lb-arrow{color:var(--t3)}
.lb-revoke{margin-left:4px}
.chip{font-size:12px;padding:3px 9px;background:var(--bg2);border-radius:8px;color:var(--t2)}

.toolbar{display:flex;gap:10px;align-items:center;margin:16px 0 12px}

/* v2026-09-23：弹窗字段分组 + 必填图例 + 内联校验 */
.form-grp{display:flex;flex-direction:column;gap:12px}
.df-modal-hd-l{display:flex;align-items:baseline;gap:10px}
.req-legend{font-size:12px;color:var(--t3)}
/* 父级 .field.err 统一驱动输入框红边（混合 input / select / combo-input 一并处理） */
.field.err .combo-input,
.field.err input,
.field.err select{border-color:var(--dan);background:var(--danger-bg)}
.field.err .req{color:var(--dan)}

.card{background:var(--bg);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
.table-wrap{padding:6px 4px;overflow-x:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-md)}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;padding:10px 12px;color:var(--t3);font-weight:500;border-bottom:1px solid var(--border-subtle)}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--border-subtle);color:var(--t1)}
.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.tbl .ops{text-align:right;white-space:nowrap}
.empty{text-align:center;color:var(--t3);padding:28px}

.tag{font-size:11.5px;padding:2px 9px;border-radius:9px;background:var(--bg2);color:var(--t2)}
.tag.info{background:var(--p-bg);color:var(--p-dark)}
.tag.purple{background:rgba(var(--purple-rgb),.14);color:var(--purple)}
.tag.teal{background:rgba(var(--teal-rgb),.14);color:var(--teal)}
.tag.suc{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.tag.danger{background:rgba(var(--dan-rgb),.12);color:var(--dan)}
.num{font-variant-numeric:tabular-nums}

/* C2：按钮对齐全局令牌（.btn/.btn-sm/.btn-primary/.btn-ghost/.btn-danger 为 scoped 复刻，尺寸/圆角与 variables.css 保持一致） */
.btn{border:1px solid var(--border-subtle);background:var(--bg);border-radius:var(--radius-md);padding:7px 13px;font-size:13px;color:var(--t1);cursor:pointer}
.btn-sm{height:32px;padding:0 12px;font-size:13px;border-radius:var(--radius-sm)}
.btn-primary{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.btn-ghost{background:transparent}
.btn-danger{background:var(--dan);border-color:var(--dan);color:#fff}
.btn.danger{color:var(--dan)}
.btn:disabled{opacity:.55;cursor:not-allowed}

.df-overlay{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:980}
.df-modal{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);width:min(460px,92vw);background:var(--bg);border-radius:var(--radius-lg);z-index:990;box-shadow:var(--shadow-lg)}
.edit-modal{width:min(520px,94vw)}
.df-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border-subtle)}
.df-modal-hd b{font-size:15px;color:var(--t1)}
.df-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.df-modal-body{padding:16px 18px;display:flex;flex-direction:column;gap:14px;max-height:64vh;overflow:auto}
.df-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:13px 18px;border-top:1px solid var(--border-subtle)}

.field{display:flex;flex-direction:column;gap:6px;margin-bottom:2px}
.field label{font-size:12.5px;color:var(--t2)}
.req{color:var(--dan);font-weight:600;font-style:normal}
.field input, .field select{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 11px;font-size:13px;background:var(--bg);color:var(--t1)}
.field .hint{font-size:11.5px;color:var(--t3);line-height:1.5}
.seg{display:flex;gap:6px}
.seg-btn{flex:1;height:34px;border:1px solid var(--border-subtle);background:var(--bg);border-radius:var(--radius-sm);font-size:13px;color:var(--t2);cursor:pointer}
.seg-btn.on{background:var(--p);border-color:var(--p);color:#fff}

.warn-text{font-size:13px;color:var(--war);line-height:1.7}
/* v381：`.ro-box` / `.ro-name` / `.ro-tag` / `.ro-warn`（本人仓**只读框**）已随入口迁移删除 ——
   本人仓现在走**仓库下拉**（见模板「对象定义」），不再是只读展示。这四个类是死 CSS，别再加回来。 */
.combo{position:relative;width:100%}
.combo-input{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 28px 0 11px;font-size:13px;background:var(--bg);color:var(--t1)}
.combo-input:focus{outline:none;border-color:var(--p)}
.combo-caret{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:11px;pointer-events:none}
.combo-panel{position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);max-height:260px;overflow:auto;background:var(--bg);border:1px solid var(--border-subtle);border-radius:var(--radius-md);box-shadow:var(--shadow-md);padding:4px}
.combo-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:7px;font-size:13px;color:var(--t1);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.combo-item.on{background:var(--bg2)}
.combo-item.sel{color:var(--p);font-weight:600}
.combo-sel{color:var(--p);font-size:12px;flex:none}
.combo-note{font-size:11px;color:var(--war);flex:none}
.combo-empty{padding:10px;text-align:center;font-size:12px;color:var(--t3)}
/* v295：报单简称名册 —— 面板表头（sticky，滚动时仍看得见来源说明）、状态标签、三态提示 */
.al-hd{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-4px -4px 4px;padding:6px 10px 7px;font-size:11.5px;color:var(--t3);background:var(--bg);border-bottom:1px solid var(--border-subtle)}
.al-from{color:var(--p);flex:none}
.al-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.al-tag{flex:none;font-size:11px;padding:1px 7px;border-radius:8px;background:var(--bg2);color:var(--t3)}
.al-tag.war{background:rgba(var(--war-rgb),.14);color:var(--war)}
.al-tag.mine{background:var(--p-bg);color:var(--p-dark)}
/* 输入框下方那行判定：绿=接管既有列 / 黄=会新增一列 / 红=撞名会被拒 */
/* v317：报单人下拉下方的引导行（「还没有外部客户账号？去员工档案开通」）。
   中性灰而不是告警色 —— 它描述的是"还没有这种数据"，不是配置出错。 */
.al-note{font-size:11.5px;line-height:1.6;color:var(--t3)}
.lnk-btn{border:none;background:none;color:var(--p);cursor:pointer;font-size:11.5px;padding:0 2px;font-family:inherit;text-decoration:underline}
.lnk-btn:hover{color:var(--p-dark)}
.al-hint{font-size:11.5px;line-height:1.55;padding:6px 9px;border-radius:var(--radius-sm)}
.al-hint.ok{color:var(--suc);background:rgba(var(--suc-rgb),.10)}
.al-hint.warn{color:var(--war);background:rgba(var(--war-rgb),.10)}
.al-hint.err{color:var(--dan);background:rgba(var(--dan-rgb),.10)}
/* v295：相近列头的一键改选（把"会新增一列"的警告变成一个可点的动作，而不是光提示） */
.al-near{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;color:var(--t3);line-height:1.8}
.al-near-btn{border:1px solid var(--p);background:var(--p-bg);color:var(--p-dark);border-radius:8px;padding:2px 9px;font-size:11.5px;cursor:pointer}
.al-near-btn:hover{background:var(--p);color:#fff}
.al-near-tip{color:var(--t3)}
.upload-btn{display:inline-block;border:1px dashed var(--border-subtle);border-radius:var(--radius-md);padding:14px 18px;font-size:13px;color:var(--p);cursor:pointer;text-align:center}
.imp-result{font-size:13px;color:var(--t1);margin-top:6px}
.imp-result .suc{color:var(--suc)} .imp-result .dan{color:var(--dan)}
.imp-result ul{margin:8px 0 0;padding-left:18px;color:var(--t2);font-size:12px;line-height:1.7}

.fade-enter-active,.fade-leave-active{transition:opacity .18s}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:transform .2s,opacity .2s}
.pop-enter-from,.pop-leave-to{transform:translate(-50%,-46%) scale(.97);opacity:0}
</style>
