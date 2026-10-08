#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v402 受控批量插入序号列。

判据 / 取值 / 分页口径见 UI-SPEC §2.6.1。用法：
    python3 v402-apply-seq.py            # dry-run：只校验每条锚点命中次数并报告
    python3 v402-apply-seq.py --apply    # 真写

安全：每条 old 必须**恰好命中 1 次**，否则该条跳过并计入 FAIL，绝不模糊匹配。
同文件多条按列出顺序依次替换（前一条替换后的文本参与后一条计数）。
"""
import io, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'hergent-cn-v2', 'src', 'pages')
APPLY = '--apply' in sys.argv

def p(rel):
    return os.path.join(ROOT, rel)

# (相对路径, old, new)
EDITS = [

# ── 1 品牌档案 ───────────────────────────────────────────────────────────
('BrandArchive.vue', '''            <th>品牌</th><th>厂商</th><th>等级</th>
            <th class="num">关联商品</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="b in brands" :key="b.id" :class="{ stopped: b.is_active === 0 }">
              <td>
                {{ b.name }}''', '''            <th class="seq-th">序号</th><th>品牌</th><th>厂商</th><th>等级</th>
            <th class="num">关联商品</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="(b, i) in brands" :key="b.id" :class="{ stopped: b.is_active === 0 }">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>
                {{ b.name }}'''),

# ── 2 供应商档案（分页 page/pageSize）────────────────────────────────────
('SupplierArchive.vue', '''              <th>供应商名称</th><th>供应商类别</th><th>对接人</th><th>电话</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id">
              <td class="sup-name">{{ c.name }}</td>''', '''              <th class="seq-th">序号</th><th>供应商名称</th><th>供应商类别</th><th>对接人</th><th>电话</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in items" :key="c.id">
              <td class="seq-cell"><span class="seq-num">{{ (page - 1) * pageSize + i + 1 }}</span></td>
              <td class="sup-name">{{ c.name }}</td>'''),

# ── 3 仓库档案 ───────────────────────────────────────────────────────────
('WarehouseArchive.vue', '''            <th>仓库名称</th><th>地址</th><th>联系人</th><th>联系电话</th><th>角色</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="w in rows" :key="w.id">
              <td>
                {{ w.name }}''', '''            <th class="seq-th">序号</th><th>仓库名称</th><th>地址</th><th>联系人</th><th>联系电话</th><th>角色</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="(w, i) in rows" :key="w.id">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>
                {{ w.name }}'''),

# ── 4 定时任务 ───────────────────────────────────────────────────────────
('CronJobs.vue', '''          <tr><th>任务</th><th>定时</th><th>状态</th><th>下次运行</th><th style="text-align:right">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="j in jobs" :key="j.id">
            <td>{{ j.name || '(未命名)' }}</td>''', '''          <tr><th class="seq-th">序号</th><th>任务</th><th>定时</th><th>状态</th><th>下次运行</th><th style="text-align:right">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="(j, i) in jobs" :key="j.id">
            <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
            <td>{{ j.name || '(未命名)' }}</td>'''),

# ── 5 预报历史（表头每列一行）────────────────────────────────────────────
('ForecastHistory.vue', '''            <th>期次名称</th>''', '''            <th class="seq-th">序号</th>
            <th>期次名称</th>'''),
('ForecastHistory.vue', '''          <tr v-for="row in list" :key="row.id" :class="{ active: row.status === 'open' }">
            <td>
              <b>{{ row.name || '—' }}</b>''', '''          <tr v-for="(row, i) in list" :key="row.id" :class="{ active: row.status === 'open' }">
            <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
            <td>
              <b>{{ row.name || '—' }}</b>'''),

# ── 6 客户档案（分页）────────────────────────────────────────────────────
('CustomerArchive.vue', '''              <th>客户名称</th><th>业态</th><th>片区</th><th>配送线路</th><th>老板 / 电话</th>
              <th>负责业务员</th><th class="num">应收余额</th><th>最近下单</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id">
              <td class="cas-name">{{ c.name }}</td>''', '''              <th class="seq-th">序号</th><th>客户名称</th><th>业态</th><th>片区</th><th>配送线路</th><th>老板 / 电话</th>
              <th>负责业务员</th><th class="num">应收余额</th><th>最近下单</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in items" :key="c.id">
              <td class="seq-cell"><span class="seq-num">{{ (page - 1) * pageSize + i + 1 }}</span></td>
              <td class="cas-name">{{ c.name }}</td>'''),

# ── 7 员工档案：外部客户账号表 + 在职员工表 ──────────────────────────────
('EmployeeArchive.vue', '''          <thead><tr>
            <th>客户</th><th>登录账号</th><th>可登录端</th>''', '''          <thead><tr>
            <th class="seq-th">序号</th><th>客户</th><th>登录账号</th><th>可登录端</th>'''),
('EmployeeArchive.vue', '''            <tr v-for="u in extAccounts" :key="u.id" :class="{ stopped: !u.is_active }">
              <td>{{ extNameOf(u) }}</td>''', '''            <tr v-for="(u, i) in extAccounts" :key="u.id" :class="{ stopped: !u.is_active }">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>{{ extNameOf(u) }}</td>'''),
('EmployeeArchive.vue', '''          <thead><tr>
            <th>员工</th><th>岗位</th><th class="num">底薪/月</th>''', '''          <thead><tr>
            <th class="seq-th">序号</th><th>员工</th><th>岗位</th><th class="num">底薪/月</th>'''),
('EmployeeArchive.vue', '''            <tr v-for="e in employees" :key="e.id" :class="{ stopped: e.is_active === 0 }">
              <td>
                {{ e.name }}''', '''            <tr v-for="(e, i) in employees" :key="e.id" :class="{ stopped: e.is_active === 0 }">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>
                {{ e.name }}'''),

# ── 8 货损工作流（已有 (it, i)）──────────────────────────────────────────
('LossWorkflow.vue', '''            <thead><tr><th>商品</th><th>批次</th><th>效期</th><th class="num">剩余</th><th class="num">数量</th><th class="num">单价</th><th class="num">损耗</th><th>建议</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in result.items" :key="i">
                <td>{{ it.product_name }}<span v-if="it.spec" class="lf-spec">{{ it.spec }}</span></td>''', '''            <thead><tr><th class="seq-th">序号</th><th>商品</th><th>批次</th><th>效期</th><th class="num">剩余</th><th class="num">数量</th><th class="num">单价</th><th class="num">损耗</th><th>建议</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in result.items" :key="i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ it.product_name }}<span v-if="it.spec" class="lf-spec">{{ it.spec }}</span></td>'''),

# ── 9 工资核算（已有 (r, i)）────────────────────────────────────────────
('PayrollWorkflow.vue', '''            <thead><tr>
              <th>员工</th><th class="num">基本工资</th><th class="num">提成</th><th class="num">绩效</th>
              <th class="num">应发</th><th class="num">社保</th><th class="num">个税</th><th class="num">实发</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.results" :key="r.employee_id || i">
                <td>{{ r.employee_name }}</td>''', '''            <thead><tr>
              <th class="seq-th">序号</th><th>员工</th><th class="num">基本工资</th><th class="num">提成</th><th class="num">绩效</th>
              <th class="num">应发</th><th class="num">社保</th><th class="num">个税</th><th class="num">实发</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.results" :key="r.employee_id || i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.employee_name }}</td>'''),

# ── 10 商品档案（14 列，分页）────────────────────────────────────────────
('ProductArchive.vue', '''          <thead><tr>
            <th>名称</th><th>条码</th><th>规格</th><th>单位</th>''', '''          <thead><tr>
            <th class="seq-th">序号</th><th>名称</th><th>条码</th><th>规格</th><th>单位</th>'''),
('ProductArchive.vue', '''            <tr v-for="p in products" :key="p.id" :class="{ stopped: p.is_active === 0 }">
              <td class="pa-name">{{ p.name }}</td>''', '''            <tr v-for="(p, i) in products" :key="p.id" :class="{ stopped: p.is_active === 0 }">
              <td class="seq-cell"><span class="seq-num">{{ (page - 1) * pageSize + i + 1 }}</span></td>
              <td class="pa-name">{{ p.name }}</td>'''),

# ── 11 报单映射（空态 colspan 9→10）──────────────────────────────────────
('ReportMapping.vue', '''          <tr>
            <th>报单人</th><th>对象类型</th><th>对象全称</th><th>简称(列头)</th>
            <th>单型</th><th>取价渠道</th><th>仓库(调拨)</th><th>状态</th><th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id" :class="{ stopped: m.is_active === 0 }">
            <td>
              {{ m.person_name || m.employee_name || '—' }}''', '''          <tr>
            <th class="seq-th">序号</th><th>报单人</th><th>对象类型</th><th>对象全称</th><th>简称(列头)</th>
            <th>单型</th><th>取价渠道</th><th>仓库(调拨)</th><th>状态</th><th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in list" :key="m.id" :class="{ stopped: m.is_active === 0 }">
            <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
            <td>
              {{ m.person_name || m.employee_name || '—' }}'''),
('ReportMapping.vue', '''<tr v-if="!list.length"><td colspan="9" class="empty">''', '''<tr v-if="!list.length"><td colspan="10" class="empty">'''),

# ── 12 返利：规则清单 / 达成清单 / 月度分解（3 张页内主表）───────────────
('Rebate.vue', '''              <th>规则名称</th><th>维度</th><th>周期</th><th>作用对象</th>
              <th class="num">目标值</th><th>触发</th><th>返利</th>
              <th>生效期</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredRules" :key="r.id">
              <td>{{ r.rule_name }}</td>''', '''              <th class="seq-th">序号</th><th>规则名称</th><th>维度</th><th>周期</th><th>作用对象</th>
              <th class="num">目标值</th><th>触发</th><th>返利</th>
              <th>生效期</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in filteredRules" :key="r.id">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>{{ r.rule_name }}</td>'''),
('Rebate.vue', '''                <th>维度</th><th>作用对象</th><th>周期</th><th class="num">本月目标</th>
                <th class="num">实际达成金额</th><th class="num">实际达成数量</th>
                <th class="num">实际返利（元）</th>
                <th class="num">达成率</th><th>来源</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in achvRows" :key="row.key">
                <td><span class="tag info">{{ dimText(row.dimension) }}</span></td>''', '''                <th class="seq-th">序号</th><th>维度</th><th>作用对象</th><th>周期</th><th class="num">本月目标</th>
                <th class="num">实际达成金额</th><th class="num">实际达成数量</th>
                <th class="num">实际返利（元）</th>
                <th class="num">达成率</th><th>来源</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in achvRows" :key="row.key">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td><span class="tag info">{{ dimText(row.dimension) }}</span></td>'''),
('Rebate.vue', '''                <th>月份</th>
                <th class="num">月度目标</th>
                <th class="num">实际达成</th>
                <th class="num">达成率</th>
                <th class="num">实际返利</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in yearMonthRows" :key="r.m">
                <td>{{ r.m }} 月</td>''', '''                <th class="seq-th">序号</th>
                <th>月份</th>
                <th class="num">月度目标</th>
                <th class="num">实际达成</th>
                <th class="num">达成率</th>
                <th class="num">实际返利</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in yearMonthRows" :key="r.m">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.m }} 月</td>'''),

# ── 13 库存查询（分页 offset）────────────────────────────────────────────
('inventory/InvStock.vue', '''              <tr>
                <th>商品</th>
                <th>规格</th>
                <th>仓库</th>
                <th>批次号</th>
                <th>到期日</th>
                <th>剩余</th>
                <th class="num">数量</th>
                <th class="num">成本价</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td>{{ r.product_name || ('商品 ' + r.product_id) }}</td>''', '''              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>规格</th>
                <th>仓库</th>
                <th>批次号</th>
                <th>到期日</th>
                <th>剩余</th>
                <th class="num">数量</th>
                <th class="num">成本价</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td>{{ r.product_name || ('商品 ' + r.product_id) }}</td>'''),

# ── 14 采购详情：分批到货录入表 + 商品明细表 ─────────────────────────────
('inventory/InvPurchaseDetail.vue', '''              <tr><th>商品</th><th class="num">订购</th><th class="num">已到</th><th class="num">这次到货</th></tr>
            </thead>
            <tbody>
              <tr v-for="g in recvGroups" :key="g.product_id">
                <td>{{ g.name }}</td>''', '''              <tr><th class="seq-th">序号</th><th>商品</th><th class="num">订购</th><th class="num">已到</th><th class="num">这次到货</th></tr>
            </thead>
            <tbody>
              <tr v-for="(g, i) in recvGroups" :key="g.product_id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ g.name }}</td>'''),
('inventory/InvPurchaseDetail.vue', '''              <tr>
                <th>商品</th>
                <th class="num">数量</th>
                <th>单位</th>
                <th class="num">单价</th>
                <th class="num">金额</th>
                <th>批次号</th>
                <th>到期日</th>
                <th>生产日期</th>
                <th class="num">已到货</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id">
                <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>''', '''              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th class="num">数量</th>
                <th>单位</th>
                <th class="num">单价</th>
                <th class="num">金额</th>
                <th>批次号</th>
                <th>到期日</th>
                <th>生产日期</th>
                <th class="num">已到货</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in items" :key="it.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>'''),

# ── 15 销售详情：商品明细表 ─────────────────────────────────────────────
('inventory/InvSaleDetail.vue', '''              <tr>
                <th>商品</th>
                <th>规格</th>
                <th class="num">数量</th>
                <th>单位</th>
                <th class="num">单价</th>
                <th class="num">金额</th>
                <th>出库批次</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id">
                <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>''', '''              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>规格</th>
                <th class="num">数量</th>
                <th>单位</th>
                <th class="num">单价</th>
                <th class="num">金额</th>
                <th>出库批次</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in items" :key="it.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>'''),

# ── 16 新建采购单（可编辑录入网格，已有 (row, i)）───────────────────────
('inventory/InvPurchaseNew.vue', '''            <tr>
              <th class="ipn-c-prod">商品</th>''', '''            <tr>
              <th class="seq-th">序号</th><th class="ipn-c-prod">商品</th>'''),
('inventory/InvPurchaseNew.vue', '''            <tr v-for="(row, i) in items" :key="i">
              <td>''', '''            <tr v-for="(row, i) in items" :key="i">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>'''),

# ── 17 新建销售单（同上）────────────────────────────────────────────────
('inventory/InvSaleNew.vue', '''            <tr>
              <th class="isn-c-prod">商品</th>''', '''            <tr>
              <th class="seq-th">序号</th><th class="isn-c-prod">商品</th>'''),
('inventory/InvSaleNew.vue', '''            <tr v-for="(row, i) in items" :key="i">
              <td>''', '''            <tr v-for="(row, i) in items" :key="i">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>'''),

# ── 18 价格渠道：客户专属价表 + 商品价格表（pc-tb → 加 seq-host）────────
('PriceChannels.vue', '''        <table class="pc-tb">''', '''        <table class="pc-tb seq-host">'''),
('PriceChannels.vue', '''              <th>客户</th><th>商品</th><th>规格</th>
              <th>小单位价</th><th>中单位价</th><th>大单位价</th><th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in cpRows" :key="r._k" :class="{ dirty: cpDirty[r._k] }">
              <td class="pc-name">
                {{ r.customer_name || ('#' + r.customer_id) }}''', '''              <th class="seq-th">序号</th><th>客户</th><th>商品</th><th>规格</th>
              <th>小单位价</th><th>中单位价</th><th>大单位价</th><th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in cpRows" :key="r._k" :class="{ dirty: cpDirty[r._k] }">
              <td class="seq-cell"><span class="seq-num">{{ cpOffset + i + 1 }}</span></td>
              <td class="pc-name">
                {{ r.customer_name || ('#' + r.customer_id) }}'''),
('PriceChannels.vue', '''          <table v-else class="pc-tb">''', '''          <table v-else class="pc-tb seq-host">'''),
('PriceChannels.vue', '''              <tr><th>商品</th><th>条码</th><th>该渠道商品编码</th><th>该渠道价格</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in mxRows" :key="r.id" :class="{ dirty: mxDirty[r.id] }">
                <td class="pc-name">{{ r.name }}<span v-if="r.spec" class="pc-spec">规格 {{ r.spec }}</span></td>''', '''              <tr><th class="seq-th">序号</th><th>商品</th><th>条码</th><th>该渠道商品编码</th><th>该渠道价格</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in mxRows" :key="r.id" :class="{ dirty: mxDirty[r.id] }">
                <td class="seq-cell"><span class="seq-num">{{ mxOffset + i + 1 }}</span></td>
                <td class="pc-name">{{ r.name }}<span v-if="r.spec" class="pc-spec">规格 {{ r.spec }}</span></td>'''),
('PriceChannels.vue', '''<tr v-if="!mxRows.length"><td colspan="5" class="pc-empty">''', '''<tr v-if="!mxRows.length"><td colspan="6" class="pc-empty">'''),

# ── 19 商品目标（pt-tbl → seq-host；展开行 colspan 10→11）──────────────
('ProductTarget.vue', '''        <table class="pt-tbl">''', '''        <table class="pt-tbl seq-host">'''),
('ProductTarget.vue', '''              <th class="pt-th-prod">商品</th>
              <th>品牌</th>''', '''              <th class="seq-th">序号</th>
              <th class="pt-th-prod">商品</th>
              <th>品牌</th>'''),
('ProductTarget.vue', '''            <template v-for="r in rows" :key="r.id">
              <tr :class="{ 'pt-row-open': openId === r.id }">
                <td class="pt-prod">''', '''            <template v-for="(r, ri) in rows" :key="r.id">
              <tr :class="{ 'pt-row-open': openId === r.id }">
                <td class="seq-cell"><span class="seq-num">{{ ri + 1 }}</span></td>
                <td class="pt-prod">'''),
('ProductTarget.vue', '''                <td :colspan="10">''', '''                <td :colspan="11">'''),

# ── 20 招投标雷达（br-tbl → seq-host，已有 (it, i)）────────────────────
('BidRadar.vue', '''    <table v-else class="br-tbl">''', '''    <table v-else class="br-tbl seq-host">'''),
('BidRadar.vue', '''        <tr>
          <th class="c-date">发布日</th>''', '''        <tr>
          <th class="seq-th">序号</th>
          <th class="c-date">发布日</th>'''),
('BidRadar.vue', '''        <tr v-for="(it, i) in items" :key="it.url">
          <td class="c-date">{{ it.date }}</td>''', '''        <tr v-for="(it, i) in items" :key="it.url">
          <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
          <td class="c-date">{{ it.date }}</td>'''),

# ── 21 货损核算月度分析（la-ml-tbl → seq-host，已有 (m, i)）────────────
('LossAccounting.vue', '''          <table class="la-ml-tbl">''', '''          <table class="la-ml-tbl seq-host">'''),
('LossAccounting.vue', '''              <tr>
                <th>月份</th>
                <th class="num">货损净额</th>''', '''              <tr>
                <th class="seq-th">序号</th>
                <th>月份</th>
                <th class="num">货损净额</th>'''),
('LossAccounting.vue', '''                <td class="la-ml-m">
                  <b>{{ m.period }}</b>''', '''                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td class="la-ml-m">
                  <b>{{ m.period }}</b>'''),
]

def main():
    cache = {}
    ok, fail = 0, 0
    for rel, old, new in EDITS:
        if rel not in cache:
            cache[rel] = io.open(p(rel), encoding='utf-8').read()
        n = cache[rel].count(old)
        if n != 1:
            fail += 1
            print('FAIL  %-38s 命中 %d 次  <<%s>>' % (rel, n, old.replace('\n', '\\n')[:70]))
            continue
        cache[rel] = cache[rel].replace(old, new, 1)
        ok += 1
        print('OK    %-38s %s' % (rel, new.replace('\n', '\\n')[:60]))
    print('\n合计 OK=%d  FAIL=%d  （共 %d 条 / %d 个文件）' % (ok, fail, len(EDITS), len(cache)))
    if fail:
        print('⛔ 有 FAIL ⇒ 不做任何写入（避免半改状态）。请修正锚点后重跑。')
        return
    if not APPLY:
        print('（dry-run；加 --apply 才写入）')
        return
    for rel, src in cache.items():
        io.open(p(rel), 'w', encoding='utf-8').write(src)
    print('✅ 已写入 %d 个文件' % len(cache))

if __name__ == '__main__':
    main()
