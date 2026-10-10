<template>
  <div class="page">
    <div class="page-hd">
      <h2>商品目标</h2>
      <span class="page-sub">按月设总量 · 分解到人 · 期次自动认领</span>
    </div>

    <!-- ══ 口径说明（写死的业务口径，不是动态数据）════════════════════════════
         为什么要摆在页头下方而不是藏进「?」：这张表上「目标 / 已达成 / 均单」三个数
         都带单位换算（件/包/袋），用户第一眼必须知道**基准是箱**、**均单怎么来的**，
         否则会拿「合计(小单位)」去和这里的箱数对，得出「系统算错了」。 -->
    <div class="pt-caliber">
      <b>口径</b>
      <span>目标一律按<b>箱</b>设（商品必须已配大单位换算）</span>
      <span>·</span>
      <span>均单剩余(箱) = (月目标 − 已达成) ÷ 剩余可报期次</span>
      <span>·</span>
      <span>月目标 = <b>到货日所在月份</b>的目标（提前报单，报单月 ≠ 到货月）</span>
      <span>·</span>
      <span>剩余期次 = 整月到货日历里<b>「报单窗口还没关」</b>的到货日个数</span>
    </div>

    <!-- ══ v264c（R9）：报单列名 ↔ 报单对象 对账告警 ══════════════════════════
         只在「确实有列名没配上」时出现；配齐了整条消失 —— 不留一条「全部正常」的
         常态噪音（本项目对纯状态文案零容忍）。
         为什么这件事必须在**目标页**说：目标要分解到人，而「谁报了多少」依赖
         报单列名能对上人；对不上时系统不会报错，只是安静地少算一个人。
         v265（2026-09-24）：本页已收进「预报订货管理」当第 4 个页签，「报单配置」就是隔壁
         那个 tab ⇒ 原先"它没有独立路由、只能干指路"的顾虑消失，这里改成**一键跳过去修**。 -->
    <div v-if="audit && audit.unmapped_count > 0" class="pt-audit">
      <b>有 {{ audit.unmapped_count }} 个报单列名还没配进「报单配置」</b>
      <div class="pt-audit-b">
        {{ audit.unmapped.slice(0, 8).join('、') }}<template v-if="audit.unmapped.length > 8"> 等 {{ audit.unmapped.length }} 个</template>
      </div>
      <div class="pt-audit-b">
        这些列存进系统时不带门店/员工身份，只能靠名字对 ——
        <b>报单配置里一改名就对不上账，而且不会报错</b>。
        其中 {{ sameNameCnt }} 个在客户档案里有同名（配一下就能对上），
        {{ unknownCnt }} 个连客户档案里也没有。
      </div>
      <div class="pt-audit-b pt-audit-go">
        修法：把这些列名填成对应的「报单别名」。
        <button class="pt-audit-btn" @click="goReportMapping">去「报单配置」修</button>
      </div>
    </div>

    <!-- ══ 工具栏 ══ -->
    <div class="pt-tbar">
      <span class="pt-tbar-t">目标月份</span>
      <input v-model="month" type="month" class="fld pt-fld-m" aria-label="目标月份"
             @change="monthTouched = true; load(month)">
      <!-- v324：把「这个月是按哪个到货日定的」写在月份旁边。
           🔴 为什么必须有这一行：本轮病根是「系统按报单月读了目标月」，
              而这种错**零报错、数字看着合理**，只有老板肉眼发现「怎么还是上个月的」。
              把锚点摆到台面上，以后同类错位第一眼就能看见，不用等到月底。 -->
      <span v-if="monthHint" class="pt-anchor" :class="{ 'pt-anchor-warn': monthHintWarn }">
        {{ monthHint }}
      </span>
      <span class="pt-tbar-t">均单按</span>
      <select v-model.number="periodId" class="fld pt-fld-p" aria-label="期次" @change="loadAvg">
        <option :value="0">不显示均单</option>
        <option v-for="p in periods" :key="p.id" :value="p.id">
          {{ p.name || ('期次 ' + p.id) }}{{ p.status === 'open' ? '（进行中）' : '' }}
        </option>
      </select>
      <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load(month)">刷新</button>
      <span class="pt-sp"></span>
      <!-- v335 按钮级门禁：POST /api/product-targets ⇒ 模块 data / 动作 create
           （本页已收进 `/forecast` 当第 4 页签，写接口归 `data` 与父页同模块） -->
      <button v-if="canDo('data', 'create')" class="btn btn-primary btn-sm" @click="openNew">新建目标</button>
    </div>

    <!-- ══ 列表 ══ -->
    <div class="card pt-card">
      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="err" class="state-empty pt-err">{{ err }}</div>
      <div v-else-if="!rows.length" class="state-empty">
        这个月还没有商品目标。点右上「新建目标」开始建第一条。
      </div>
      <div v-else class="pt-wrap">
        <table class="pt-tbl seq-host">
          <thead>
            <tr>
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <th class="pt-th-prod">商品</th>
              <th v-if="isVisible('brand')">品牌</th>
              <th class="num">目标(箱)</th>
              <th class="num">已达成(箱)</th>
              <th class="num">差额(箱)</th>
              <th class="num">本期报单(箱)</th>
              <!-- v324 P2-A：这两列走的是后端实际读的目标月（= 到货月），与「目标/已达成/差额」
                   （走工具栏筛的月份）可能**不同月**。只在真的不同月时才挂 title，一致时连属性都不渲染。 -->
              <th class="num" v-if="isVisible('remain')" :title="avgColTip || undefined">剩余可报</th>
              <th class="num" v-if="isVisible('avg')" :title="avgColTip || undefined">均单(箱)</th>
              <th class="num" v-if="isVisible('alloc')">分解</th>
              <th class="pt-th-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(r, ri) in rows" :key="r.id">
              <tr :class="{ 'pt-row-open': openId === r.id }">
                <td class="seq-cell"><span class="seq-num">{{ ri + 1 }}</span></td>
                <td class="pt-prod">
                  <button class="pt-exp" :title="openId === r.id ? '收起分解' : '展开分解'"
                          @click="toggle(r.id)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                         :style="{ transform: openId === r.id ? 'rotate(90deg)' : 'none' }">
                      <path d="M9 6l6 6-6 6"/>
                    </svg>
                  </button>
                  <div class="pt-prod-txt">
                    <b>{{ r.product_name || ('商品 #' + r.product_id) }}</b>
                    <span class="pt-spec">{{ r.name || '—' }}</span>
                  </div>
                </td>
                <td class="pt-brand" v-if="isVisible('brand')">{{ r.brand || '—' }}</td>
                <td class="num"><b>{{ fmt(r.target_qty) }}</b></td>
                <td class="num">{{ fmt(r.achieved_box) }}</td>
                <td class="num" :class="gapClass(r)">{{ fmt(gapOf(r)) }}</td>
                <td class="num">{{ repText(r) }}</td>
                <td class="num pt-quiet" v-if="isVisible('remain')">{{ remText(r) }}</td>
                <td class="num" v-if="isVisible('avg')">
                  <b v-if="avgOf(r) != null">{{ fmt(avgOf(r).avg_box) }}</b>
                  <span v-else class="pt-quiet" :title="avgWhy(r)">—</span>
                </td>
                <td class="num pt-quiet" v-if="isVisible('alloc')">{{ (r.allocs || []).length }} 人</td>
                <td class="pt-op">
                  <!-- v335 按钮级门禁：改目标量=PUT /api/product-targets/{tid} ⇒ data/update；
                       删除=DELETE 同路径 ⇒ data/delete -->
                  <button v-if="canDo('data', 'update')" class="btn-icon" title="改目标量" @click="openEdit(r)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>
                    </svg>
                  </button>
                  <button v-if="canDo('data', 'delete')" class="btn-icon" title="删除目标（同时删掉分解）" @click="askDelete(r)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </td>
              </tr>
              <tr v-if="openId === r.id" class="pt-detail-row">
                <td :colspan="ptColspan">
                  <div class="pt-detail">
                    <div class="pt-detail-hd">
                      <b>分解到人</b>
                      <span class="pt-quiet">
                        Σ 分解 = {{ fmt(r.alloc_total) }} 箱（必须等于目标 {{ fmt(r.target_qty) }} 箱）
                        <b v-if="allocTotalGap(r)" class="pt-alloc-bad">
                          —— 差 {{ fmt(allocTotalGap(r)) }} 箱
                        </b>
                      </span>
                    </div>
                    <table class="pt-sub">
                      <thead>
                        <tr><th>承接人</th><th class="num">占比</th><th class="num">目标(箱)</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="a in r.allocs" :key="a.employee_id">
                          <td>{{ a.employee_name || ('员工 #' + a.employee_id) }}</td>
                          <td class="num">{{ fmt(a.ratio) }}%</td>
                          <td class="num">{{ fmt(a.target_qty) }}</td>
                        </tr>
                        <tr v-if="!(r.allocs || []).length">
                          <td colspan="3" class="pt-quiet">这条目标没有分解明细（历史数据）。</td>
                        </tr>
                      </tbody>
                    </table>
                    <!-- 逐人实报：P1 才做（需要 report_alias 桥）。这里**显式说明未上线**，
                         而不是留一个空列让用户以为「报了单却没数」。 -->
                    <div class="pt-note">
                      逐人实报（谁报了多少）在下一批上线 —— 它依赖员工与报单门店的别名对应关系，
                      请先在「报单配置」里为员工维护别名。
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />
      </div>
    </div>

    <!-- ══ 新建 / 编辑弹窗 ══ -->
    <Teleport to="body">
      <div v-if="modal" class="pt-mask" @click.self="closeModal">
        <div class="pt-modal">
          <div class="pt-modal-hd">
            <b>{{ editing ? '改目标量' : '新建商品目标' }}</b>
            <button class="btn-icon" title="关闭" @click="closeModal">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="pt-modal-bd">
            <div class="pt-form">
              <label class="pt-lb">商品</label>
              <div class="pt-pick">
                <!-- ══ v319e（P0-1）新建态分两屏：未选 = 搜索框 + 列表；已选 = 一张「已选卡片」══
                     原实现点选后只改了一行 6% 透明度的底色（实测合成到白底 = rgb(240,251,252)，
                     与白底只差 3.6% ⇒ 肉眼不可辨），且**没有任何文字**说明选到了什么
                     ⇒ 用户唯一能得出的结论就是「点了没反应」。这里改成：点选 → 列表收起 →
                     原地出现「✓ 商品名 / 换算 / 重新选择」。 -->
                <input v-if="!editing && !pickedProd" v-model="pkw" class="fld pt-pick-in"
                       placeholder="输入商品名或条码搜索" aria-label="搜索商品" @input="searchProducts">
                <div v-if="!editing && !pickedProd" class="pt-pick-list">
                  <!-- v277（S3）：可设目标的商品仍是 <button>（整行可选）；缺换算的商品改用 <div>
                       —— **必须换标签**，因为「补换算」要在这一条里再嵌一个 <button>，
                       而 button 不能嵌套 button：HTML 解析器会把内层踢出外层，表现为
                       「点补换算没反应、控制台零报错」（本项目文档里那类「死控件」的经典形态）。 -->
                  <template v-for="p in prods" :key="p.id">
                    <button v-if="p.can_target" class="pt-pick-item"
                            :class="{ on: form.product_id === p.id }" @click="pickProduct(p)">
                      <span class="pt-pick-nm">{{ p.name }}</span>
                      <span class="pt-pick-meta">{{ convText(p) }}</span>
                    </button>
                    <!-- v319e（P0-2）：这一行原来**点了完全没反应**（`pickProduct` 里
                         `if (!p.can_target) return` 静默退出），而它恰好是整行唯一不给解释的动作。
                         现在整行可点 ⇒ 弹一句原因 + 就地打开补换算。内层的「补换算」按钮照旧
                         `@click.stop` 独立生效（两个入口都能到，互不抢）。 -->
                    <div v-else class="pt-pick-item dis" @click="onDisabledPick(p)"
                         title="缺大单位换算 ⇒ 不能按箱设目标。点一下看原因并就地补上。">
                      <span class="pt-pick-nm">{{ p.name }}</span>
                      <span class="pt-pick-meta">{{ convText(p) }}</span>
                      <span class="pt-pick-warn">缺大单位换算，无法按箱设目标</span>
                      <button class="pt-fix-btn" @click.stop="toggleFix(p)">
                        {{ fixFor === p.id ? '收起' : '补换算' }}
                      </button>
                    </div>
                    <div v-if="!p.can_target && fixFor === p.id" class="pt-fix-box">
                      <div class="pt-fix-hint">
                        照商品包装补一处换算，这个商品就能按箱设目标。填错不会保存 ——
                        系统会先按这组换算试算一遍「1 大单位 = 几个小单位」，算不出或单位名打架就整笔拒收。
                      </div>
                      <div class="pt-fix-row">
                        <span class="pt-fix-eq">1</span>
                        <input v-model.trim="fixForm.large_unit" class="fld pt-fix-u"
                               placeholder="箱" aria-label="大单位名">
                        <span class="pt-fix-eq">=</span>
                        <input v-model.number="fixForm.large_ratio" type="number" min="0" step="1"
                               class="fld pt-fix-n" placeholder="?" aria-label="换算比">
                        <span class="pt-fix-eq">{{ p.unit || '小单位' }}</span>
                        <button v-if="canDo('data', 'create')" class="pt-fix-save" :disabled="fixBusy" @click.stop="submitFix(p)">
                          {{ fixBusy ? '保存中…' : '保存换算' }}
                        </button>
                      </div>
                      <!-- 预填值来自后端（`list_products.suggest_large_ratio`，由 `per_case`
                           唯一实现按规格串算）。前端**不自己解析规格串** —— 那是第二份口径。 -->
                      <div class="pt-fix-src">
                        <span v-if="p.suggest_large_ratio">
                          已按规格「{{ p.spec }}」预填，核对一下包装对不对。
                        </span>
                        <span v-else-if="p.spec">
                          规格「{{ p.spec }}」里认不出每箱数量，请照包装实际含量填。
                        </span>
                        <span v-else>
                          这个商品档案没有「规格」，系统推不出来 —— 请照包装实际含量填。
                        </span>
                      </div>
                      <div v-if="fixMsg" class="pt-fix-msg">{{ fixMsg }}</div>
                    </div>
                  </template>
                  <div v-if="!prods.length" class="pt-quiet pt-pick-empty">没有匹配的在售商品。</div>
                </div>
                <!-- ══ 已选卡片（v319e P0-1）══
                     数据源 = 点选那一刻冻结的商品快照（`pickedProd`），**不回搜索结果里现找** ——
                     否则换个搜索词列表被替换，连目标量旁那行换算都会一起消失。 -->
                <div v-if="!editing && pickedProd" class="pt-picked">
                  <span class="pt-picked-tick" aria-hidden="true">✓</span>
                  <div class="pt-picked-txt">
                    <div class="pt-picked-nm">{{ pickedName }}</div>
                    <div class="pt-picked-cv">{{ convText(pickedProd) }}</div>
                  </div>
                  <button type="button" class="pt-picked-change" @click="clearPick">重新选择</button>
                </div>
                <div v-if="editing" class="pt-fixed">
                  {{ pickedName }} <span class="pt-quiet">（商品与月份不可改，要改请删了重建）</span>
                </div>
              </div>

              <label class="pt-lb">目标月份</label>
              <div>
                <input v-model="form.period_month" type="month" class="fld pt-fld-m"
                       aria-label="目标月份" :disabled="editing">
                <!-- v324：说清「该建到哪个月」= **到货月**。
                     提前报单、几天后到货 ⇒ 月底建的目标本该落在次月。
                     不写这一行，用户会按月历直觉填当月，锚点改了也白改。 -->
                <div v-if="!editing && anchorMonthTip" class="pt-md-tip">{{ anchorMonthTip }}</div>
              </div>

              <label class="pt-lb">目标量（箱）</label>
              <div class="pt-qty">
                <!-- v358：总量是落定的**分母** ⇒ 它一改，各人的分摊数量必须跟着重算。
                     以**比例**为源（"只改总量"不该动比例），与后端「只改目标量」那条分支同规则。 -->
                <input v-model.number="form.target_qty" type="number" min="0" step="1"
                       class="fld pt-qty-in" aria-label="目标量" @change="onTargetQtyCommit">
                <span class="pt-qty-u">{{ pickedUnit || '箱' }}</span>
                <!-- 🔴 v264b：这里**必须**复用 convText(p)，不能自己拼。
                     原实现拼的是「pickedPerCase + 小单位名」，而那个值是
                     large_ratio ÷ medium_ratio = **中单位的数量**，名字却取了**小单位** ⇒
                     真机实测 id=1449 渲染成「1 件 = 8 袋」（8 是包数），而系统真值是
                     「1 件 = 40 袋」/「1 件 = 8 包」。「中单位的数 + 小单位的名」= 两个口径混用。
                     （注释内不写模板花括号，否则符号校验脚本会把它们当模板引用。） -->
                <span v-if="pickedConv" class="pt-quiet">{{ pickedConv }}</span>
              </div>
            </div>

            <!-- 选人双栏：左候选 / 右已选占比 -->
            <div class="pt-2col">
              <div class="pt-col">
                <div class="pt-col-hd">
                  <b>可选员工</b>
                  <input v-model="ekw" class="fld pt-ekw" placeholder="搜索姓名" aria-label="搜索员工">
                </div>
                <div class="pt-col-bd">
                  <button v-for="e in candEmps" :key="e.id" class="pt-emp"
                          :disabled="isPicked(e.id)" @click="addMember(e)">
                    <span>{{ e.name }}</span>
                    <span v-if="e.report_alias" class="pt-alias" title="报单别名：他报的单挂在哪个门店名下">
                      {{ e.report_alias }}
                    </span>
                    <span v-else class="pt-noalias" title="没分别名 ⇒ 逐人实报算不出来">未配别名</span>
                  </button>
                  <div v-if="!candEmps.length" class="pt-quiet pt-col-empty">没有匹配的在职员工。</div>
                </div>
              </div>

              <div class="pt-col">
                <div class="pt-col-hd">
                  <b>分解到人</b>
                  <!-- v358：合计条改成一个数说完两件事 —— 因为**它们本来就是一件事**
                       （Σ比例=100 ⟺ Σ数量=目标量，见 script 里的论证）。
                       摆两个独立的百分比/箱数只会让人以为要同时满足两个条件。 -->
                  <span class="pt-sigma" :class="qtyOk ? 'ok' : 'bad'">
                    合计 {{ fmt(qtySum) }} 箱 / 目标 {{ fmt(qtyTotal) }} 箱
                    · {{ fmt(sigmaPct) }}%{{ qtyOk ? '' : qtyGapText }}
                  </span>
                  <!-- v359：自动配平必须**说出来**。能自动改数，就得能自动交代"改了谁" ——
                       否则「填一格、旁边几格自己变了」就是本项目最忌讳的静默改数。 -->
                  <span v-if="allocAutoCount" class="pt-auto-hint">已自动配平 {{ allocAutoCount }} 人</span>
                  <button class="btn btn-ghost btn-sm pt-split" @click="splitEven">平均分配</button>
                </div>
                <div class="pt-col-bd">
                  <table class="pt-sub pt-sub-in">
                    <thead>
                      <!-- v358：两列都可填。谁被编辑谁就是「源」，另一列由后端落定后回填。 -->
                      <tr><th>承接人</th><th class="num">占比%</th><th class="num">分摊数量(箱)</th><th></th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="m in members" :key="m.employee_id">
                        <td>{{ m.employee_name }}</td>
                        <td class="num">
                          <!-- 🔴 必须 `type="text"`：`type="number"` 会把中文输入法打出的
                               `１２。５` **静默改成 `125`**（小数点被吃掉、数量放大 10 倍），
                               而且没有任何提示。改成 text 后原串原样收下来，交给后端归一。 -->
                          <input class="fld pt-num" type="text" inputmode="decimal"
                                 :class="{ 'pt-num-bad': allocBad['r:' + m.employee_id],
                                           'pt-num-auto': allocAutoIds.has(Number(m.employee_id)) }"
                                 :aria-label="m.employee_name + ' 分摊比例'"
                                 :value="allocFocus === ('r:' + m.employee_id) ? allocRaw : fmt(m.ratio)"
                                 @focus="onAllocFocus($event, 'ratio', m.employee_id)"
                                 @input="onAllocInput($event, 'ratio', m.employee_id)"
                                 @change="onAllocCommit($event, 'ratio', m.employee_id)"
                                 @blur="onAllocBlur('ratio', m.employee_id)">
                        </td>
                        <td class="num">
                          <input class="fld pt-num" type="text" inputmode="decimal"
                                 :class="{ 'pt-num-bad': allocBad['q:' + m.employee_id],
                                           'pt-num-auto': allocAutoIds.has(Number(m.employee_id)) }"
                                 :aria-label="m.employee_name + ' 分摊数量（箱）'"
                                 :value="allocFocus === ('q:' + m.employee_id) ? allocRaw : fmt(m.target_qty)"
                                 @focus="onAllocFocus($event, 'qty', m.employee_id)"
                                 @input="onAllocInput($event, 'qty', m.employee_id)"
                                 @change="onAllocCommit($event, 'qty', m.employee_id)"
                                 @blur="onAllocBlur('qty', m.employee_id)">
                        </td>
                        <td>
                          <button class="btn-icon" title="移除" @click="rmMember(m.employee_id)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </td>
                      </tr>
                      <tr v-if="!members.length">
                        <td colspan="4" class="pt-quiet">从左栏点员工加入。至少要 1 人，分摊数量合计要等于目标量。</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div v-if="allocErr" class="pt-save-err">{{ allocErr }}</div>
            <div v-if="allocHasBad" class="pt-save-err">
              有一格不是数字，已按 0 计 —— 请改成数字（支持中文输入法打出的全角数字与中文句号，
              例如「３３。３」会自动当作 33.3）。
            </div>
            <div v-if="saveErr" class="pt-save-err">{{ saveErr }}</div>
          </div>

          <div class="pt-modal-ft">
            <span class="pt-quiet">目标量{{ editing ? '' : '与分解' }}保存后立即生效</span>
            <button class="btn btn-ghost btn-sm" @click="closeModal">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="!canSave || saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ 删除确认 ══ -->
    <Teleport to="body">
      <div v-if="delRow" class="pt-mask" @click.self="delRow = null">
        <div class="pt-modal pt-modal-sm">
          <div class="pt-modal-hd"><b>删除这条目标？</b></div>
          <div class="pt-modal-bd">
            <p class="pt-del-q">
              <b>{{ delRow.product_name }}</b> · {{ delRow.period_month }} ·
              目标 {{ fmt(delRow.target_qty) }} 箱
            </p>
            <p class="pt-del-warn">
              会同时删掉 {{ (delRow.allocs || []).length }} 条分解明细（不可恢复）。
              已报的单不受影响。
            </p>
          </div>
          <div class="pt-modal-ft">
            <button class="btn btn-ghost btn-sm" @click="delRow = null">取消</button>
            <button class="btn btn-danger btn-sm" :disabled="saving" @click="doDelete">
              {{ saving ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
// v265：本页已收进「预报订货管理」当第 4 个页签 ⇒ 允许一处**同页互跳**（告警条 →「报单配置」tab）。
// 这是本页唯一的路由耦合，语义是「同页切页签」，不是跨页导航。
import { useRouter } from 'vue-router'
import { productTargetsApi, forecastApi } from '../api/modules.js'
// v277：补换算成功后要给「已写进哪个商品档案」一个明确回执。本页此前只用页内 err 条，
// 但那行是「列表级」的（会被后续 load 覆盖），而这里是一次单点写操作 ⇒ 用全站 toast。
import { toast, canDo } from '../store'
// 列设置齿轮（替换「序号」表头）：复用共享 useColSettings + ColMenuPanel，不新建基础设施。
import { useColSettings } from '../composables/useColSettings.js'
import ColMenuPanel from '../components/ColMenuPanel.vue'
import Icon from '../components/Icon.vue'

/* ══════════════════════════════════════════════════════════════
   商品目标管理（v264）
   🔴 三条纪律（改本页前先读）：
     ① 均单 / 预填 **只由后端算**（/avg-target）。本页不做任何本地换算 ——
        那是第二份口径，迟早与后端漂移（本项目反复付过学费）。
     ② 目标一律按**箱**。无大单位换算的商品后端硬拒 422 ⇒ 前端提前禁选并写明原因，
        不让用户白填一遍再吃一个错。
     ③ 占比合计必须 = 100%，前端**实时提示**、后端**硬校验**（双保险，不只做前端）。
   ══════════════════════════════════════════════════════════════ */

const rows = ref([])
const periods = ref([])
const loading = ref(false)
const err = ref('')
const saving = ref(false)
const openId = ref(0)

const now = new Date()
const month = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
/* v324：用户**手动**改过月份 ⇒ 不再自动纠正。
   `false` 时，`loadPeriods()` 会把月份对齐到「进行中期次的到货月」——
   因为我们是提前报单、几天后到货，月底那几期的**目标月是次月**，
   默认值取自然月会让老板月底进来看到上个月的桶（本轮报障就是这个）。 */
const monthTouched = ref(false)
/* v324：当期锚点（供页面自证「我按哪个到货日定的目标月」）。`null` = 没拿到期次。 */
const anchor = ref(null)
/* v324：后端实际读的目标月（/avg-target 回的 `target_month`）。
   用于把「X 月还没有目标」说成具体月份 —— 只说「本月」在跨月那几天恰恰是错的。 */
const avgMonth = ref('')
const periodId = ref(0)
const avgById = ref({})

/* ---- 列设置齿轮（替换「序号」表头，复用共享 useColSettings）---- */
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

const COLS = [
  { key: 'prod', label: '商品', core: true },
  { key: 'brand', label: '品牌', core: false },
  { key: 'target', label: '目标(箱)', core: true },
  { key: 'achieved', label: '已达成(箱)', core: true },
  { key: 'gap', label: '差额(箱)', core: true },
  { key: 'rep', label: '本期报单(箱)', core: true },
  { key: 'remain', label: '剩余可报', core: false },
  { key: 'avg', label: '均单(箱)', core: false },
  { key: 'alloc', label: '分解', core: false },
  { key: 'op', label: '操作', core: true },
]
const { isVisible, toggleCol, resetCols } = useColSettings('product-target', COLS)
// 展开行的明细占满整行：隐藏可选列后实际列数会变，colspan 必须跟着走。
const ptColspan = computed(() => 1 + COLS.filter(c => isVisible(c.key)).length)
/* v264c（R9）：报单「列名 ↔ 报单对象」对账（**只读**）。
   null = 还没查 / 查失败 ⇒ 不渲染告警（一次辅助查询失败不该在页面上吓用户）。 */
const audit = ref(null)
// v265：切到同页的「报单配置」页签。走 router.replace 而**不是** location.hash 拼接 ——
// 与 Forecast.vue 的 setTab 共用同一套 URL 语义（`?tab=config`）；两处各写一份 hash 拼接必然漂移。
const router = useRouter()
function goReportMapping() {
  router.replace({ path: '/forecast', query: { tab: 'config' } }).catch(() => {})
}

/* ---- 展示工具 ---- */
function fmt(v) {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  // 3 位小数与前端 `boxesOf` 同精度（用户自己的报单 Excel 里「件数」就是 3 位）
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

/* v324：'2026-10-03' → '10-03'；非法 → 原样（宁可显示得丑，也不要显示一个编的日期）。 */
function fmtMd(iso) {
  const s = String(iso || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : (s || '')
}
/* v324：'2026-10' → '10 月'；空/非法 → ''（调用方负责兜底）。 */
function monthLabel(m) {
  const s = String(m || '')
  return /^\d{4}-\d{2}$/.test(s) ? (Number(s.slice(5)) + ' 月') : ''
}

/* 选商品时把「一箱 = 几包 = 几袋」摊开给用户看。
   目标以**箱**为单位，用户脑子里的单位却是包/袋 ⇒ 不摊开他没法判断「150」是多还是少。
   🔴 只用档案字段算，**不猜**：缺换算就明说缺什么，不拿 1 冒充。 */
function convText(p) {
  const lr = Number(p.large_ratio) || 0
  const lu = p.large_unit || '箱'
  const mr = Number(p.medium_ratio) || 0
  const mu = p.medium_unit || ''
  const su = p.unit || '小单位'
  if (!(lr > 0)) return '缺大单位换算'
  const mid = (mu && mr > 0) ? `${fmt(lr / mr)} ${mu} · ` : ''
  return `1 ${lu} = ${mid}${fmt(lr)} ${su}`
}

/* v264c（R9）：汇总表列名没配进「报单配置」时，该列落库 `store_id=0` ⇒
   「逐人实报」只能靠 `store_name` **名字匹配**，报单配置里一改名，历史报单就归不到人
   且**零报错**。把名单摆到页面上，用户才知道该去补哪几条映射。
   ⚠️ 只读、且失败静默（`audit=null` ⇒ 不渲染）—— 它是提示，不是本页主功能。 */
async function loadAudit() {
  try {
    const d = await productTargetsApi.mappingAudit()
    audit.value = (d && d.ok) ? d : null
  } catch (e) {
    audit.value = null
  }
}

/* 告警里那两个计数：拆成 computed 而不是在模板里现算 —— 模板里现算会变成
   「同一份判据在模板里再写一遍」，加个新状态就容易漏改。 */
const _auditCols = () => ((audit.value && audit.value.columns) || [])
const sameNameCnt = computed(() => _auditCols().filter(c => c.status === 'same_name_only').length)
const unknownCnt = computed(() => _auditCols().filter(c => c.status === 'unknown').length)

/* ---- 列表 ---- */
async function load(m) {
  loading.value = true
  err.value = ''
  try {
    const d = await productTargetsApi.list(m || '')
    rows.value = d.items || []
    // 列表接口**只在按月过滤时**才附「已达成」（避免全表扫）⇒ 传空月时这几列会恒 0，
    // 页面上必须说清，否则用户会以为「达成是 0」。
    if (!m) err.value = '提示：不选月份时列表不计算「已达成 / 均单」。请选一个月份。'
    await loadPeriods()
    await loadAvg()
  } catch (e) {
    err.value = e?.message || '加载失败'
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function loadPeriods() {
  if (periods.value.length) return
  try {
    const d = await forecastApi.periods()
    periods.value = d.periods || []
    // 默认选**进行中**的期次；没有则用后端给的展示兜底 `current`
    const prefer = d.open || d.current || null
    if (prefer && !periodId.value) periodId.value = Number(prefer.id) || 0
    /* v324：锚点优先取 `open/current` 上带的 `arrival_date`。
       为什么还要回查 `periods`：`open`/`current` 是两个独立查询的返回，
       字段不保证与列表同宽（老库尤其明显）；列表里一定有 arrival_date。
       取不到 `arrival_date` ⇒ anchor=null ⇒ 提示整行不渲染（不拿自然月冒充锚点）。 */
    const _p = (prefer && periods.value.find(x => Number(x.id) === Number(prefer.id))) || prefer || null
    const _ad = String((_p && _p.arrival_date) || '').trim()
    anchor.value = _ad ? { arrival_date: _ad, period_name: (_p && _p.name) || '' } : null
    const av = _ad.slice(0, 7)
    if (av && !monthTouched.value && month.value !== av) {
      month.value = av
      /* 月份变了 ⇒ 列表必须按新月份**重取**。
         ⚠️ 这里是「先按自然月查一次、发现锚点是次月再查一次」，页面上会有一次
         无声的第二次请求；代价是进页面多一个 list 请求，换来的是**不猜锚点**
         （先猜再校验的写法会在老库/缺字段时静默取错月，正是本轮要消灭的那个静默）。 */
      await load(av)
    }
  } catch (e) {
    periods.value = []
  }
}

async function loadAvg() {
  if (!periodId.value || !rows.value.length) {
    avgById.value = {}
    avgMonth.value = ''
    return
  }
  try {
    const d = await productTargetsApi.avgTarget(periodId.value)
    avgById.value = d.items || {}
    // v324：后端实际读的目标月（= 到货月）。**不自己算** —— 自己算就是第二份锚点口径。
    avgMonth.value = String(d.target_month || '')
  } catch (e) {
    avgById.value = {}
    avgMonth.value = ''
  }
}

/* v324：锚点提示文案。三条判据，全都只读后端/期次给的事实，本页不推算：
   ① 有到货日才能说      ② 与当前查看的月份一致 ⇒ 正常态（一句话说清依据）
   ③ 不一致 ⇒ 警示态（明确告诉用户在看的不是本期的目标月） */
const monthHint = computed(() => {
  const a = anchor.value
  if (!a || !a.arrival_date) return ''
  const av = String(a.arrival_date).slice(0, 7)
  const md = fmtMd(a.arrival_date)
  if (av === month.value) return `按到货月 · 本期到货 ${md}`
  return `本期到货 ${md}（属 ${monthLabel(av)}）· 当前看的是 ${monthLabel(month.value)}目标`
})
const monthHintWarn = computed(() => {
  const a = anchor.value
  if (!a || !a.arrival_date) return false
  return String(a.arrival_date).slice(0, 7) !== month.value
})
/* v324：新建弹窗里「该建到哪个月」的一句话说明（锚点 = 到货月）。 */
const anchorMonthTip = computed(() => {
  const a = anchor.value
  if (!a || !a.arrival_date) return ''
  const av = String(a.arrival_date).slice(0, 7)
  return `本期到货 ${fmtMd(a.arrival_date)} ⇒ 目标建到 ${monthLabel(av) || av}`
       + '（提前报单，报单月 ≠ 到货月）'
})

/* v324 P2-A：同屏两口径的**零噪音**提示。
   `均单 / 剩余可报` 走后端实际读的目标月（= 到货月，见 avgMonth ← d.target_month），
   `目标 / 已达成 / 差额` 走用户在工具栏筛的 month。两者默认恰好重合，所以这个错位
   一直看不见；把锚点修对之后才被撕开（真机实测：切回 9 月时同屏出现「目标 150 / 均单 66.667」，
   而 66.667 是 10 月那 1000 箱算出来的）。
   解法：**一致时返回空串 ⇒ 表头连 title 属性都不渲染**（零可见噪音）；不一致时鼠标悬停才出说明。
   ⚠️ 本页不自己算月份，只比对后端给的 target_month 与用户选的 month —— 自己算就是第二份口径。 */
const avgColTip = computed(() => {
  const av = avgMonth.value
  if (!av || av === month.value) return ''
  const a = anchor.value
  const md = (a && a.arrival_date) ? fmtMd(a.arrival_date) : ''
  const avL = monthLabel(av) || av
  const mvL = monthLabel(month.value) || month.value
  return `「均单 / 剩余可报」按 ${avL} 的月目标算` + (md ? `（本期到货 ${md}）` : '')
       + `；「目标 / 已达成 / 差额」按你筛选的 ${mvL} 算。`
       + `两列月份不同 —— 要同一口径，把左边月份切到 ${avL}。`
})

function toggle(id) { openId.value = openId.value === id ? 0 : id }

/* ---- 派生展示 ---- */
function gapOf(r) { return Number(r.target_qty || 0) - Number(r.achieved_box || 0) }
function gapClass(r) {
  const g = gapOf(r)
  return g > 0 ? 'pt-gap-pos' : (g < 0 ? 'pt-gap-neg' : '')
}
/* v358：列表里「Σ 分解 vs 目标」的差。**只在真的差出来时才说话** ——
   落定之后两者本该精确相等，所以正常态一个字都不显示（本项目对纯状态文案零容忍）；
   0.001 级以下视为相等（旧规则存下来的历史行可能有这点尾差，不该吓用户）。 */
function allocTotalGap(r) {
  const d = Math.round(((Number(r.alloc_total) || 0) - (Number(r.target_qty) || 0)) * 1000) / 1000
  return Math.abs(d) < 0.0005 ? 0 : d
}
function avgOf(r) {
  const it = avgById.value[String(r.product_id)]
  if (!it) return null
  if (it.avg_box == null) return null
  return it
}
function avgWhy(r) {
  const it = avgById.value[String(r.product_id)]
  if (!periodId.value) return '未选择期次（均单要挂在期次上算）'
  if (!it) return '该商品不在本期期次清单里'
  const f = it.flags || {}
  if (f.no_convert) return '该商品缺单位换算，无法折算均单'
  /* v324：点名**后端实际读的那个月**（= 到货月）。
     说「本月」在跨月那几天恰恰是错的 —— 老板报障时看到的正是这个歧义。 */
  if (f.no_target) return (monthLabel(avgMonth.value) || '本月') + '还没有目标'
  if (f.no_rule) return '该品牌没有到货规则（配置面板里没设），算不出剩余期次'
  if (f.no_dates) return '该品牌按本规则在本月没有到货日'
  if (f.done) return '已达成本月目标'
  return '—'
}
function repText(r) {
  const it = avgById.value[String(r.product_id)]
  if (!it) return '—'
  return fmt(it.reported_box)
}
function remText(r) {
  const it = avgById.value[String(r.product_id)]
  if (!it || it.remaining_periods == null) return '—'
  return fmt(it.remaining_periods) + ' / ' + fmt(it.total_periods)
}

/* ══════════════ 弹窗 ══════════════ */
const modal = ref(false)
const editing = ref(null)          // null = 新建；否则是被编辑的目标行
const prods = ref([])
const emps = ref([])
const pkw = ref('')
/* v319e（P0-1）：点选那一刻冻结的商品快照。`null` = 还没选（⇒ 显示搜索列表）。
   🔴 不复制字段、直接持有后端返回的那个对象：`searchProducts()` 之后 `prods` 整个被换掉，
   旧对象仍被这里引用 ⇒ 快照语义天然成立；而**逐字段拷一份新对象**反而是第二份商品口径，
   迟早与档案漂移（本页第 ① 条纪律）。 */
const pickedProd = ref(null)
const ekw = ref('')
const saveErr = ref('')
const form = reactive({ product_id: 0, period_month: '', target_qty: null })
const members = ref([])

/* v319e（P0-1）：新建态取**点选快照**，编辑态取被编辑的行。
   原实现 `prods.value.find(p => p.id === form.product_id) || editing.value`：
   换个搜索词 `prods` 被替换，选中记录就找不到了 —— 目标量旁那行换算随之消失，
   用户刚建立的「我选好了」的认知也跟着消失（这是「选不中」体感的第二个来源）。 */
const picked = computed(() => pickedProd.value || editing.value || null)
const pickedName = computed(() => picked.value?.name || picked.value?.product_name || '—')
const pickedUnit = computed(() => picked.value?.large_unit || picked.value?.target_unit || '箱')
/* 目标量输入框旁那行换算提示。
   🔴 v264b：**必须**复用 `convText(p)` —— 唯一实现。此前这里自己拼了一份
   （`large_ratio ÷ medium_ratio` + 小单位名），两处口径必然漂移，真机实测已经漂了。
   没有大单位换算（或编辑态拿不到档案字段）时返回 '' ⇒ 提示整行不渲染，不拿猜测的数字冒充。 */
const pickedConv = computed(() => {
  const p = picked.value
  if (!p || !(Number(p.large_ratio) > 0)) return ''
  return '（' + convText(p) + '）'
})

const candEmps = computed(() => {
  const kw = ekw.value.trim()
  const pickedIds = new Set(members.value.map(m => m.employee_id))
  return emps.value.filter(e => {
    if (pickedIds.has(e.id)) return false
    if (!kw) return true
    return String(e.name || '').includes(kw)
  })
})
/* ══ v358：分解到人 = 比例(%) ↔ 数量(箱) **双向联动** ════════════════════════════════
   用户 2026-10-01：「目前仅支持填写分摊比例，分摊数量只能由比例自动推算，无法手动填写。
   请调整该功能，使分摊数量支持手动填写，并实现分摊比例与分摊数量的双向联动 …
   且需保证两者数值与总量始终一致、不出现误差。」

   🔴🔴 先立住那条**唯一不变量**（否则每步都会走偏）：
       Σ比例 = Σ(数量ᵢ ÷ 总量 × 100) = 100 × Σ数量ᵢ ÷ 总量
       ⇒ **Σ比例 = 100 ⟺ Σ数量 = 总量** —— 两个守恒式**不是两条约束，是一条**。
       既然只有一条，就只能有一个源头 ⇒ **数量是守恒侧，比例由数量反算**。
       （反过来把比例当源头、数量由 `round(总量×比例/100, 3)` 派生，四舍五入后
        Σ数量 会差 0.001 级 —— 旧实现正是这么算的：总量 101、比例 33.33/33.33/33.34
        ⇒ 33.663/33.663/33.673 ⇒ Σ=100.999，而界面上就写着「Σ 分解 必须等于 目标」。）

   🔴 四条纪律（改这段前先读）：
     ① **落定只在后端**（`POST /product-targets/alloc-preview`）。本页不做任何本地换算 ——
        与文件头第 ① 条纪律同一条。旧版本在这里自己算了一份：`allocBox` 走 **2 位**、
        后端存 **3 位** ⇒ 总量=7 时**同一屏上一个显示 6.99、一个存 7**（本轮实测）。
        本页只负责「记住用户正在打哪一格 + 把原串发过去 + 渲染返回值」。
     ② **源侧原样**：用户刚敲的那一格，回填不得改写它 —— 否则敲到一半的数字会被后端
        的四舍五入值顶掉（"填了不算"）。所以用 `allocFocus` 记住正在输入的格，
        在它失焦 / 本次落定回来之前，一直显示用户自己的原始串。
     ③ 数字格一律 `type="text"`：`type="number"` 会把中文输入法的 `１２。５`
        **静默改成 `125`**（小数点被吃掉、数量放大 10 倍，且零提示）。
        归一（全角数字 / 中文句号 → 半角）由后端既有唯一实现 `normalize_num_text` 做。
     ④ **自动配平（v359）必须可见**：`allocLocked` 记「用户敲过的行」（服务端据此把它们
        钉住、只把剩余分给其余行），`allocAuto` 记「这一轮系统动过的行」并给它们上色。
        两条缺一不可 —— 少了 `allocLocked`，配平会把用户刚填的数抹掉；少了 `allocAuto`，
        「填一格、旁边几格自己变了」就成了静默改数。 */
const allocBusy = ref(false)
const allocFocus = ref('')      // 'r:<eid>' / 'q:<eid>'；'' = 当前没有格子在输入
const allocRaw = ref('')        // 那一格的**原始串**（未解析）
const allocBad = ref({})        // { 'r:3': true } —— 后端判定为非数字的格（标红）
const allocErr = ref('')
/* ── v359 自动配平的两个集合（用数组而不是 Set：整份替换才算一次响应式更新，语义最直白）──
   `allocLocked` = **用户显式敲过的行**。后端在源轴上把它们钉住，剩余量分给其余行。
     ⚠️ 它**不是**「最后编辑的那一行」，而是**累积**的：用户依次给 A、B、C 填数，三行都会被
       钉住 —— 否则填第三个人时，第一个人的数会被"配平"改掉，用户会以为系统在乱改。
   `allocAuto`   = 上一轮**被系统自动配平的行**（只驱动视觉标记，不参与计算）。
   🔴 两者都只在 `resetAllocState()`（开新建 / 开编辑）与「平均分配」里清空 —— 弹窗不许带记忆。 */
const allocLocked = ref([])
const allocAuto = ref([])
let _allocSeq = 0               // 过期响应丢弃（连改会并发多个请求）

const _r2v = (v) => Math.round((Number(v) || 0) * 100) / 100
const _r3v = (v) => Math.round((Number(v) || 0) * 1000) / 1000

const sigmaPct = computed(() => _r2v(members.value.reduce((s, m) => s + (Number(m.ratio) || 0), 0)))
const sigmaOk = computed(() => Math.abs(sigmaPct.value - 100) <= 0.005)
/* 数量侧的两个数由**已落定的行值**相加而来（不是再算一遍口径：这些数就是后端刚发回来的，
   相加只是把它们摆到一起）。判据用 0.005 箱的容差 —— 落定之后本该**精确**相等，
   这点余量只用来吸收浮点加法噪声，真缺口是箱级/十箱级，绝不会被这点容差放过。 */
const qtySum = computed(() => _r3v(members.value.reduce((s, m) => s + (Number(m.target_qty) || 0), 0)))
const qtyTotal = computed(() => Number(form.target_qty) || 0)
/* 🔴 目标量 > 0 必须并进判据：目标量还没填时它是 0，而各人数量也全是 0 ⇒ **两个 0 恰好
     相等**，合计条会亮绿灯说"对上了"，用户以为填完了。这类「两个空值阴差阳错对上」是
     本项目反复付学费的形态。后端 `_validate_allocs` 用的是**同一条**判据（同款理由）。 */
const qtyOk = computed(() =>
  qtyTotal.value > 0 && members.value.length > 0
  && Math.abs(qtySum.value - qtyTotal.value) <= 0.005)
const qtyGapText = computed(() => {
  if (qtyOk.value || !members.value.length) return ''
  if (!(qtyTotal.value > 0)) return '，请先填目标量'   // 没有分母 ⇒ 别报一个假的"还差 N 箱"
  const d = _r3v(qtySum.value - qtyTotal.value)
  if (Math.abs(d) < 0.0005) return ''
  return d > 0 ? ('，多了 ' + fmt(d) + ' 箱') : ('，还差 ' + fmt(-d) + ' 箱')
})
const allocHasBad = computed(() => Object.keys(allocBad.value).length > 0)
/* v359：被系统自动配平的行 —— 模板用 Set 做 O(1) 命中（数组每次 `includes` 是 O(n)，
   而这段在 v-for 里会跑「行数 × 2 格」次）。 */
const allocAutoIds = computed(() => new Set((allocAuto.value || []).map(Number)))
const allocAutoCount = computed(() => allocAutoIds.value.size)

const canSave = computed(() => {
  if (!editing.value) {
    if (!form.product_id || !form.period_month) return false
  }
  // 目标量是分母 ⇒ 没有它就无从判「Σ数量 = 目标量」（编辑态、新建态都要过这一关）；
  // 上一版把它在 `else if` 里又写了一遍，属同一条判据写两处 ⇒ 收成一处。
  if (!(Number(form.target_qty) > 0)) return false
  // v358：门禁从「Σ比例 = 100」改为「**Σ数量 = 目标量**」—— 两者等价（见上方论证），
  //   但数量这条能同时钉住两列。再叠一条「没有非数字的格」，否则坏格子会以 0 混进合计。
  return qtyOk.value && !allocHasBad.value && members.value.length > 0
})

/* ── 落定：把「谁改了、改成了什么」交给后端，拿回落定后的两列 ─────────────────────
   `axis` = 'ratio' | 'qty'（用户改的是哪一列）；`raw` = 那一格的**原始串**（未解析）。
   ⚠️ `eid` 传 `null` = 这一轮**没有任何格子被单独改写**（例如只改了目标量）——
      此时两列都按当前值算，`source` 只决定「谁是源」。 */
const allocKey = (axis, eid) => (axis === 'ratio' ? 'r:' : 'q:') + eid

async function runAllocSettle(axis, eid, raw) {
  if (!members.value.length) return
  const key = allocKey(axis, eid)
  const seq = ++_allocSeq
  allocBusy.value = true
  allocErr.value = ''
  try {
    const allocs = members.value.map(m => {
      const same = (eid != null) && Number(m.employee_id) === Number(eid)
      return {
        employee_id: m.employee_id,
        ratio: (same && axis === 'ratio') ? raw : m.ratio,
        target_qty: (same && axis === 'qty') ? raw : m.target_qty,
      }
    })
    const d = await productTargetsApi.allocPreview({
      targetQty: Number(form.target_qty) || 0, source: axis, allocs,
      /* v359：把**锁定集合的快照**一并发出 —— 服务端据此把用户敲过的行钉住，
         只把剩余量分给其余行（自动配平）。
         ⚠️ 必须传快照 `[...]`：响应回来时锁定集合可能已被用户的下一次编辑改过，
            但**这一轮**的结果必须与它当时的输入一致；否则会出现"结果对应的是上一轮的锁"。 */
      locked: [...allocLocked.value],
    })
    if (seq !== _allocSeq) return                 // 过期响应直接丢弃
    const by = {}
    ;(d.items || []).forEach(x => { by[Number(x.employee_id)] = x })
    members.value = members.value.map(m => {
      const x = by[Number(m.employee_id)]
      return x ? { ...m, ratio: x.ratio, target_qty: x.target_qty } : m
    })
    const bad = {}
    ;((d.meta && d.meta.bad) || []).forEach(b => {
      // 只认这两列（后端还会回一条 `field:'total'`，那是总量格的问题，本页总量格是数值框、
      //   走不到这里；显式挡掉免得它落到某一行上）。
      if (b.field === 'ratio' || b.field === 'qty') bad[allocKey(b.field, b.employee_id)] = true
    })
    allocBad.value = bad
    /* v359：把「这一轮系统动了哪几行」记下来（为空 ⇒ 清掉上一轮的标记）。
       ⚠️ 放在过期响应判断**之后**：过期响应连 `members` 都不该改，更不该改标记。 */
    allocAuto.value = ((d.meta && d.meta.auto_filled) || []).map(Number)
    /* 这一格的落定值已经回来了 ⇒ 收起原始串、显示落定值。
       🔴 两道都要判：① 聚焦格还是它；② **原始串没变** —— 用户按回车提交后又接着敲，
         这两个条件不同时成立，此时**绝不能**把还在打字的格子顶掉。 */
    if (allocFocus.value === key && allocRaw.value === raw) allocFocus.value = ''
  } catch (e) {
    if (seq === _allocSeq) allocErr.value = e?.message || '联动计算失败'
  } finally {
    if (seq === _allocSeq) allocBusy.value = false
  }
}

function onAllocFocus(e, axis, eid) {
  allocFocus.value = allocKey(axis, eid)
  allocRaw.value = String((e && e.target && e.target.value) != null ? e.target.value : '')
}
function onAllocInput(e, axis, eid) {
  allocFocus.value = allocKey(axis, eid)
  allocRaw.value = String((e && e.target && e.target.value) != null ? e.target.value : '')
}
function onAllocBlur(axis, eid) {
  if (allocFocus.value === allocKey(axis, eid)) allocFocus.value = ''
}
/* 离开这一格（失焦 / 回车）⇒ 提交给后端联动。
   ⚠️ **中间态不在 @input 里收敛**：`Number("12.")` = 12，边打边收敛会让用户永远打不出小数点；
      而原串一直留在框里又不能让后端判「非数字」—— 所以只有「离开这一格」时收敛。 */
function onAllocCommit(e, axis, eid) {
  const raw = String((e && e.target && e.target.value) != null ? e.target.value : allocRaw.value)
  allocRaw.value = raw
  allocFocus.value = allocKey(axis, eid)
  /* 🔴 v359：**先入锁、再落定**。顺序反了会有个很难查的症状 ——
     用户刚敲 70 的那一行在同一轮里仍被当作"自由行"，于是它被自己的配平重算掉，
     表现为「填了 70、一松手变成 33.33」（用户会说"填了不算"，而这正是本页第 ② 条纪律
     要防的那件事，只是一个新的成因）。 */
  if (eid != null && !allocLocked.value.some(x => Number(x) === Number(eid))) {
    allocLocked.value = [...allocLocked.value, Number(eid)]
  }
  runAllocSettle(axis, eid, raw)
}
/* 目标量改了 ⇒ 以**比例**为源重新落定（"只改总量"不该动比例，数量跟着新总量走）。
   与后端 `update_target` 里「只改目标量、不给新分解」那条分支**同一条规则**。
   `eid=null` = 这一轮没有哪个格子被单独改写。 */
function onTargetQtyCommit() {
  if (!members.value.length) return
  runAllocSettle('ratio', null, null)
}

/* 清掉「正在输入的格 / 原始串 / 标红 / 上次错误」—— 开弹窗、换商品、关弹窗都要清，
   否则上一轮的中间态会带进下一轮（本项目反复栽的「弹窗带记忆」）。 */
function resetAllocState() {
  allocFocus.value = ''
  allocRaw.value = ''
  allocBad.value = {}
  allocErr.value = ''
  /* v359：锁定集合与自动配平标记也要清 —— 打开「编辑」时若不清理，上一次弹窗敲过的行
     会**跨弹窗**继续被钉住，表现为「新建的目标里怎么填都不配平」（而界面上看不出原因）。 */
  allocLocked.value = []
  allocAuto.value = []
  _allocSeq += 1              // 让在途响应作废，别把新弹窗的值覆盖掉
}

async function openNew() {
  editing.value = null
  saveErr.value = ''
  form.product_id = 0
  form.period_month = month.value
  form.target_qty = null
  members.value = []
  pkw.value = ''
  ekw.value = ''
  /* v319e：快照必须复位 —— 否则关掉再新建时会直接显示上一次选的商品（弹窗"带记忆"），
     而 `form.product_id` 恰好也是 0 的话，界面说的和要提交的就不是同一件事。 */
  pickedProd.value = null
  fixFor.value = 0
  fixMsg.value = ''
  resetAllocState()          // v358：上一轮的点名/原始串/标红不得带进新弹窗
  modal.value = true
  if (!prods.value.length) await searchProducts()
  if (!emps.value.length) await loadEmps()
}

function openEdit(r) {
  editing.value = r
  saveErr.value = ''
  form.product_id = r.product_id
  form.period_month = r.period_month
  form.target_qty = Number(r.target_qty) || null
  // v358：两列都要带回来（数量列现在是可编辑的，缺了它会显示成 0 ⇒ 用户一打开就以为分解没了）
  members.value = (r.allocs || []).map(a => ({
    employee_id: a.employee_id, employee_name: a.employee_name,
    ratio: Number(a.ratio) || 0, target_qty: Number(a.target_qty) || 0,
  }))
  ekw.value = ''
  resetAllocState()
  modal.value = true
  if (!emps.value.length) loadEmps()
  /* 打开时先按**比例**为源落定一次。
     为什么必须做：历史行的逐人数量是旧规则 `round(总量 × 比例 ÷ 100, 3)` 存的，
     Σ 可能差 0.001 级 ⇒ 不归一的话，用户一打开弹窗就看到「还差 0.002 箱」这种
     莫名其妙的红字，而那个差根本不是他造成的。以比例为源归一同时**不动比例**，
     是这里损失最小的做法。 */
  if (members.value.length) runAllocSettle('ratio', null, null)
}

function closeModal() { modal.value = false; editing.value = null }

async function searchProducts() {
  try {
    const d = await productTargetsApi.products(pkw.value.trim(), 50)
    prods.value = d.items || []
  } catch (e) {
    prods.value = []
  }
}
async function loadEmps() {
  try {
    const d = await productTargetsApi.employees()
    emps.value = d.items || []
  } catch (e) {
    emps.value = []
  }
}

function pickProduct(p) {
  // 缺换算的商品**不能静默 return**（那就是原病根）—— 转交 onDisabledPick 给一句解释。
  // 模板里已按 can_target 分流，这里保留判定是为了防将来有人把本函数接到别处去。
  if (!p.can_target) { onDisabledPick(p); return }
  form.product_id = p.id
  pickedProd.value = p          // 冻结快照（已选卡片与目标量旁换算是同一个数据源）
  // 单位随商品带回（目标单位 = 商品大单位）
  form.target_unit = p.large_unit || ''
}

/* v319e（P0-2）：点「缺大单位换算」那一行 —— 把死路变成有出路。
   改前：点它零反馈（选中标记不变、提示 0 条、页面内容长度变化 0），
   而这一行右侧明明写着「缺大单位换算，无法按箱设目标」—— 文字看得见，点它却什么都不发生。
   生产实测：362 个在售商品里 36 个属于这类（9.9%），首屏 50 行里 9 行（18%）。 */
function onDisabledPick(p) {
  const nm = String(p.name || '该商品')
  const short = nm.length > 14 ? nm.slice(0, 14) + '…' : nm
  const su = p.unit || '小单位'
  toast(`「${short}」还没配大单位换算，不能按箱设目标。已打开「补换算」，`
        + `照包装填「1 箱 = 几个${su}」，填好就能选它。`)
  // 只在未展开时切换：重复点同一行时保持展开（每次都要有反馈），不要变成开关来回跳。
  if (fixFor.value !== p.id) toggleFix(p)
}

/* v319e（P0-1）：点「重新选择」回到搜索列表。
   必须同时清掉 `form.product_id` 与 `target_unit` —— 只清快照的话，
   `product_id` 还留着、界面上却看不到任何选中项，那正是原来那类「说不清的中间态」。 */
function clearPick() {
  pickedProd.value = null
  form.product_id = 0
  form.target_unit = ''
}

/* ══ v277（S3）：缺换算商品「就地补换算」 ═══════════════════════════════════════
   为什么在这页做：`can_target=False` 的商品在选品列表里**看得见、选不了**；用户得离开目标页
   → 去商品档案页 → 翻到那一行 → 再改。而那条路此前还是坏的（`large_ratio` 不在
   `product_update` 白名单里，填了静默不写、也不报错，v277 一并修掉）。
   这里把「看得见的目标」和「改档案的能力」放进同一个弹窗，形成闭环。

   🔴 两条纪律：
     ① 预填值**只取后端建议**（`list_products.suggest_large_ratio`，由 `per_case` 唯一实现
        按规格串算）。前端**不自己解析规格串** —— 那会成为第二份口径，本页第 ① 条纪律。
     ② 三道校验（当前必须真缺 / 补完必须真能折箱且能摊出各级单位 / 大单位名不得撞名）
        全在后端。前端只做**可读性**前置（空值、非正数），不复制那三条业务判据。 */
const fixFor = ref(0)
const fixBusy = ref(false)
const fixMsg = ref('')
const fixForm = reactive({ large_unit: '', large_ratio: null })

function toggleFix(p) {
  if (fixFor.value === p.id) { fixFor.value = 0; fixMsg.value = ''; return }
  fixFor.value = p.id
  fixMsg.value = ''
  fixForm.large_unit = p.suggest_large_unit || '箱'
  fixForm.large_ratio = p.suggest_large_ratio || null
}

async function submitFix(p) {
  const lu = (fixForm.large_unit || '').trim()
  const lr = Number(fixForm.large_ratio)
  const su = p.unit || '小单位'
  if (!lu) { fixMsg.value = '请填大单位名（一般就是「箱」）。'; return }
  if (!(lr > 0)) { fixMsg.value = `请填「1 个${lu} = 几个${su}」，必须大于 0。`; return }
  fixBusy.value = true
  fixMsg.value = ''
  try {
    const d = await productTargetsApi.fixConversion(p.id, lu, lr)
    // 把「1 箱 = N 包 = M 袋」原样回给用户看 —— 这是他自己填的那个数的推论。
    // 不看一眼就去建目标，填错了要等到报单算箱数时才发现（那时已经算完好几张单）。
    const per = (d && d.per_unit) || {}
    const flat = Object.keys(per).map(k => `${fmt(per[k])} ${k}`).join(' · ')
    toast(`已补换算：1 ${lu} = ${fmt(lr)} ${su}` + (flat ? `（${flat}）` : '') +
          '。该商品现在可以设目标了。', 'ok')
    fixFor.value = 0
    // 重取列表：那一行 `can_target` 从 false 变 true，整行不再是灰的、可照常选中。
    // 不做「本地改一下 prods 里那一条」—— 那等于前端自己维护一份换算结论。
    await searchProducts()
  } catch (e) {
    // 后端的 400 带中文原因（三道校验各一条），原样展示；不要吞成「保存失败」。
    fixMsg.value = e?.message || '保存失败'
  } finally {
    fixBusy.value = false
  }
}

function isPicked(id) { return members.value.some(m => m.employee_id === id) }
function addMember(e) {
  if (isPicked(e.id)) return
  // v358：要带 `target_qty` —— 少了它这一行的数量列会是 undefined，
  //   而"保留原始串"的显示逻辑会把它渲染成空白（看起来像这一行没分解）。
  members.value.push({ employee_id: e.id, employee_name: e.name, ratio: 0, target_qty: 0 })
  // 首次加入时自动平均，省掉「加一个人再手填占比」这一步
  if (members.value.length === 1) members.value[0].ratio = 100
  /* 加人后要重落定：新人是 0% ⇒ 比例合计仍是 100、数量对照样守恒，
     但**具体到每一行的数量**要由后端重算（尾差补给谁可能变化）。 */
  runAllocSettle('ratio', null, null)
}
function rmMember(id) {
  members.value = members.value.filter(m => m.employee_id !== id)
  /* v359：他走了，锁定集合里也要删掉 —— 否则同名同 id 再加回来时是"幽灵锁定"，
     表现为「新加的人怎么填都不参与配平」，而界面完全看不出原因。 */
  allocLocked.value = allocLocked.value.filter(x => Number(x) !== Number(id))
  runAllocSettle('ratio', null, null)
}
function splitEven() {
  const n = members.value.length
  if (!n) return
  /* v359：点「平均分配」= 用户明确要求**推倒重排** ⇒ 先清锁定。
     不清的话，此前敲过的行仍按"源轴原样"钉着，平均出来的比例会被它们的旧值顶掉 ——
     症状是「按钮点了没反应」（其实是它的效果被锁抵消了）。 */
  allocLocked.value = []
  allocAuto.value = []
  // 与后端 `suggest_ratios` 同规则：前 n-1 人取两位小数，最后一人兜差额 ⇒ Σ 恒 = 100
  const base = Math.floor((100 / n) * 100) / 100
  let acc = 0
  members.value.forEach((m, i) => {
    if (i === n - 1) {
      m.ratio = Math.round((100 - acc) * 100) / 100
    } else {
      m.ratio = base
      acc = Math.round((acc + base) * 100) / 100
    }
  })
  // v358：比例定了 ⇒ 数量由后端落定（本页不自己乘总量 —— 那就是第二份口径）
  runAllocSettle('ratio', null, null)
}

async function save() {
  saving.value = true
  saveErr.value = ''
  try {
    const allocs = members.value.map(m => ({
      employee_id: m.employee_id,
      employee_name: m.employee_name,
      ratio: Number(m.ratio) || 0,
      // v358：**逐人数量也要落库**。两列都给，且两列都来自后端落定的那一份 ——
      //   后端 `_write_allocs` 见数量就以数量为准反算比例（服务端唯一实现），
      //   所以即便这里算错，库里也不会出现「Σ分摊数量 ≠ 目标量」的行。
      target_qty: Number(m.target_qty) || 0,
    }))
    if (editing.value) {
      await productTargetsApi.update(editing.value.id, {
        target_qty: Number(form.target_qty) || 0, allocs,
      })
    } else {
      await productTargetsApi.create({
        period_month: form.period_month,
        product_id: form.product_id,
        target_qty: Number(form.target_qty) || 0,
        target_unit: pickedUnit.value,
        allocs,
      })
    }
    const keepMonth = editing.value ? editing.value.period_month : form.period_month
    closeModal()
    if (keepMonth && keepMonth !== month.value) month.value = keepMonth
    await load(month.value)
  } catch (e) {
    saveErr.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

/* ---- 删除 ---- */
const delRow = ref(null)
function askDelete(r) { delRow.value = r }
async function doDelete() {
  if (!delRow.value) return
  saving.value = true
  try {
    await productTargetsApi.remove(delRow.value.id)
    delRow.value = null
    await load(month.value)
  } catch (e) {
    err.value = e?.message || '删除失败'
    delRow.value = null
  } finally {
    saving.value = false
  }
}

onMounted(() => { load(month.value); loadAudit() })
</script>

<style scoped>
/* ── 口径说明条 ── */
.pt-caliber{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;padding:9px 12px;
  border-radius:var(--radius-sm);background:var(--p-bg);color:var(--t2);font-size:12.5px;line-height:1.7}
.pt-caliber b{color:var(--t1)}

/* ── v264c（R9）：报单配置对账告警。复用站内语义色 `--warn-amber*`
      （成例：`ConnectCenter.vue::.cc-pair-lock`），不新造视觉语言。 ── */
.pt-audit{margin:0 0 12px;padding:10px 14px;border-radius:var(--radius-sm);
  background:var(--warn-amber-bg);color:var(--warn-amber);font-size:12.5px;line-height:1.7}
.pt-audit b{color:var(--t1)}
/* v265：告警条里的「去报单配置修」按钮 —— 继承告警条的琥珀色，不新造一套按钮视觉。
   用 filter 而不是 rgba 覆写背景：本页要同时适配明/暗主题，写死 rgba 会在暗色下变脏。 */
.pt-audit-btn{margin-left:8px;padding:2px 10px;border:1px solid currentColor;border-radius:var(--radius-sm);
  background:transparent;color:inherit;font-size:12.5px;line-height:1.6;cursor:pointer;font-family:inherit}
.pt-audit-btn:hover{filter:brightness(.95)}
.pt-audit-b{margin-top:3px}
.pt-audit-go{opacity:.9}

/* ── 工具栏 ── */
.pt-tbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.pt-tbar-t{font-size:13px;color:var(--t2)}
.pt-fld-m{width:150px}
.pt-fld-p{width:210px}
.pt-sp{flex:1 1 auto}
/* ── v324：目标月份锚点提示 ──
   正常态用次级文字色（它是**说明**，不是告警）；不一致时才升到站内琥珀告警色。
   两种态用同一套语义色，不新造视觉语言（成例：`.pt-audit` / `.pt-err`）。 */
.pt-anchor{font-size:12px;color:var(--t2);line-height:1.5}
.pt-anchor-warn{color:var(--warn-amber)}
/* v324：新建弹窗里的「目标建到哪个月」提示。次级文字色 + 收紧上间距 ——
   它是输入框的**旁注**（贴着月份框），不该被读成区段标题。 */
.pt-md-tip{margin-top:4px;font-size:11.5px;color:var(--t2);line-height:1.55}

/* ── 列表 ── */
.pt-card{padding:0;overflow:hidden}
.pt-wrap{overflow-x:auto}
.pt-tbl{width:100%;border-collapse:collapse;font-size:13px}
.pt-tbl th{position:sticky;top:0;z-index:2;background:var(--bg3);color:var(--t2);font-weight:500;
  text-align:left;padding:9px 10px;white-space:nowrap;border-bottom:1px solid var(--bd)}
.pt-tbl td{padding:9px 10px;border-bottom:1px solid var(--bd);vertical-align:middle}
.pt-tbl tr.pt-row-open td{background:var(--bg2)}
.pt-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
.pt-th-prod{min-width:260px}
.pt-th-op{width:88px;text-align:right}
.pt-op{text-align:right;white-space:nowrap}
.pt-prod{display:flex;align-items:flex-start;gap:6px}
.pt-exp{border:none;background:none;padding:2px;cursor:pointer;color:var(--t2);line-height:0;
  border-radius:4px;flex:0 0 auto}
.pt-exp svg{transition:transform .15s}
.pt-exp:hover{background:var(--bg4);color:var(--t1)}
.pt-prod-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.pt-spec{font-size:11.5px;color:var(--t2)}
.pt-brand{color:var(--t2);white-space:nowrap}
.pt-quiet{color:var(--t2)}
/* v358：列表里「Σ 分解 ≠ 目标」只在**真的差出来**时才红字 —— 正常态零文案。 */
.pt-alloc-bad{color:var(--danger-txt)}
.pt-gap-pos{color:var(--ok-green)}
.pt-gap-neg{color:var(--danger-txt);font-weight:600}

/* ── 分解明细 ── */
.pt-detail-row td{background:var(--bg2);padding:0}
.pt-detail{padding:12px 14px}
.pt-detail-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;font-size:13px}
.pt-sub{width:100%;max-width:520px;border-collapse:collapse;font-size:12.5px}
.pt-sub th{background:transparent;border-bottom:1px solid var(--bd);color:var(--t2);padding:5px 8px;
  font-weight:500;text-align:left;position:static}
.pt-sub td{padding:5px 8px;border-bottom:1px solid var(--bd)}
.pt-sub .num{text-align:right}
.pt-note{margin-top:10px;font-size:12px;color:var(--t2);line-height:1.6}

/* ── 空/错误态 ── */
.pt-err{color:var(--warn-amber)}

/* ── 弹窗 ── */
.pt-mask{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.35);display:flex;
  align-items:center;justify-content:center;padding:20px}
.pt-modal{width:min(960px,100%);max-height:92vh;display:flex;flex-direction:column;
  background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius);box-shadow:var(--shadow)}
.pt-modal-sm{width:min(460px,100%)}
.pt-modal-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:12px 14px;border-bottom:1px solid var(--bd);font-size:14px}
.pt-modal-bd{padding:14px;overflow:auto}
.pt-modal-ft{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid var(--bd)}
.pt-modal-ft .pt-quiet{flex:1 1 auto;font-size:12px}

.pt-form{display:grid;grid-template-columns:96px 1fr;gap:10px 12px;align-items:start;margin-bottom:16px}
.pt-lb{font-size:13px;color:var(--t2);padding-top:9px}
.pt-pick{display:flex;flex-direction:column;gap:8px}
.pt-pick-in{width:100%}
/* v319e（P1-2）：150px 只露 4~5 行，搜「蒙牛」有 50 行要滚很久，
   而**选中项常常在可视区之外** ⇒ 用户以为"点不到"。放到 260px（约 8~9 行）。 */
.pt-pick-list{max-height:260px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-sm)}
.pt-pick-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:none;
  background:none;cursor:pointer;text-align:left;font-size:13px;color:var(--t1);
  border-bottom:1px solid var(--bd)}
.pt-pick-item:last-child{border-bottom:none}
/* 🔴 v319e（P1-1）优先级倒置修正：原写法 `:hover:not(.dis)` 权重 (0,3,0)，
   **高于** `.pt-pick-item.on` 的 (0,2,0) ⇒ 鼠标停在选中行上时选中色被 hover 色盖掉。
   两色实测差异都只有 3.6% 左右，用户根本分不出哪个是"选中的那个"。
   收窄为 `:not(.on)` ⇒ hover 让位于选中态（语义：已选中的行不因鼠标经过而变色）。 */
.pt-pick-item:hover:not(.on):not(.dis){background:var(--bg2)}
/* 🔴 v319e（P0-1）选中态必须"一眼可辨"：原来只有 `--p-bg`（6% 透明度底色），
   合成到白底实测 = rgb(240,251,252)，与白底只差 3.6% ⇒ 肉眼不可辨。
   现在补**第二条视觉通道** —— 左侧 3px 主色实心条（用 inset 阴影画：不占布局、行宽不跳）。
   底色保留（弱提示），主色条 + 加粗承担"可辨"这件事。 */
.pt-pick-item.on{background:var(--p-bg);font-weight:600;
  box-shadow:inset 3px 0 0 0 var(--p)}
/* v277：整行不再一起降透明度 —— `dis` 行里现在有「补换算」按钮，
   行级 opacity 会把按钮一起压暗（还能点，但看起来像禁用 = 用户不会去点）。
   改为只压暗三个文字 span，按钮保持全亮。 */
/* v319e（P0-2）：灰行现在**整行可点**（点了给原因并就地补换算）⇒ 光标必须是 pointer。
   原来写 `not-allowed`，用户连试都不会试 —— 那和修之前一样是死路。 */
.pt-pick-item.dis{cursor:pointer}
.pt-pick-item.dis:hover:not(.on){background:var(--bg2)}
.pt-pick-item.dis .pt-pick-nm,
.pt-pick-item.dis .pt-pick-meta,
.pt-pick-item.dis .pt-pick-warn{opacity:.62}
.pt-pick-nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-pick-meta{color:var(--t2);font-size:11.5px;white-space:nowrap}
.pt-pick-warn{color:var(--warn-amber);font-size:11.5px;white-space:nowrap}
/* ── v277（S3）就地补换算 ── */
.pt-fix-btn{flex:0 0 auto;height:24px;padding:0 9px;border:1px solid var(--warn-amber);
  background:var(--warn-amber-bg);color:var(--warn-amber);border-radius:var(--radius-sm);
  font-size:11.5px;cursor:pointer;white-space:nowrap}
.pt-fix-btn:hover{filter:brightness(.97)}
/* 展开区独立成条（`.pt-pick-item` 是 flex 横排，塞不下这个表单） */
.pt-fix-box{padding:9px 12px 11px;background:var(--bg3);border-bottom:1px solid var(--bd)}
.pt-fix-hint{font-size:11.5px;color:var(--t2);line-height:1.55;margin-bottom:8px}
.pt-fix-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.pt-fix-eq{font-size:13px;color:var(--t2);white-space:nowrap}
.pt-fix-u{width:62px;text-align:center}
.pt-fix-n{width:80px;text-align:center}
.pt-fix-save{height:28px;padding:0 12px;border:none;border-radius:var(--radius-sm);
  background:var(--p-dark);color:#fff;font-size:12.5px;cursor:pointer;white-space:nowrap}
.pt-fix-save:hover:not(:disabled){background:var(--p-deep)}
.pt-fix-save:disabled{opacity:.45;cursor:not-allowed}
.pt-fix-src{margin-top:7px;font-size:11.5px;color:var(--t2);line-height:1.5}
.pt-fix-msg{margin-top:6px;font-size:12px;color:var(--danger-txt)}
.pt-pick-empty{padding:10px}
/* ── v319e（P0-1）已选商品卡片 ──
   点选后列表收起，原地换成这一张 ⇒ 用户一眼能确认「选的是哪件、一箱等于多少」。
   🔴 不用半透明底色当主信号（6% 那层正是原缺陷）；改用**实心主色圆勾** + 主色描边，
   差异是"有色/无色"级别，不依赖透明度，深色模式下同样成立。 */
.pt-picked{display:flex;align-items:center;gap:10px;padding:10px 12px;
  background:var(--p-bg);border:1px solid var(--p);border-radius:var(--radius-sm)}
.pt-picked-tick{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:var(--p);
  color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.pt-picked-txt{flex:1 1 auto;min-width:0}
.pt-picked-nm{font-size:13.5px;font-weight:600;color:var(--t1);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.pt-picked-cv{font-size:11.5px;color:var(--t2);margin-top:2px}
.pt-picked-change{flex:0 0 auto;height:26px;padding:0 10px;border:1px solid var(--bd);
  background:var(--bg);color:var(--t1);border-radius:var(--radius-sm);font-size:12px;cursor:pointer}
.pt-picked-change:hover{background:var(--bg2)}
.pt-fixed{padding:8px 10px;background:var(--bg3);border-radius:var(--radius-sm);font-size:13px}
.pt-qty{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pt-qty-in{width:130px}
.pt-qty-u{font-size:13px;color:var(--t2)}

/* ── 选人双栏 ── */
.pt-2col{display:grid;grid-template-columns:1fr 1.25fr;gap:12px}
.pt-col{border:1px solid var(--bd);border-radius:var(--radius-sm);display:flex;flex-direction:column;
  min-height:236px;max-height:320px;overflow:hidden}
.pt-col-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);
  border-bottom:1px solid var(--bd);font-size:13px;flex-wrap:wrap}
.pt-ekw{margin-left:auto;width:110px;height:28px}
.pt-col-bd{overflow:auto;flex:1 1 auto;padding:6px}
.pt-col-empty{padding:10px;font-size:12.5px}
.pt-emp{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:none;background:none;
  cursor:pointer;text-align:left;font-size:13px;color:var(--t1);border-radius:var(--radius-sm)}
.pt-emp:hover:not(:disabled){background:var(--bg2)}
.pt-emp:disabled{opacity:.4;cursor:default}
.pt-alias{font-size:11.5px;color:var(--t2)}
.pt-noalias{font-size:11.5px;color:var(--warn-amber)}
.pt-sigma{font-size:12.5px;font-weight:600}
.pt-sigma.ok{color:var(--ok-green)}
.pt-sigma.bad{color:var(--danger-txt)}
/* v359：自动配平的**文字交代** —— 光有格子变蓝还不够，得有一句话说明发生了什么。 */
.pt-auto-hint{margin-left:8px;font-size:12px;font-weight:600;color:var(--info-blue)}
.pt-split{margin-left:auto;height:28px}
.pt-sub-in{max-width:none}
.pt-sub-in th{position:static}
/* ── v358：分解到人的两个数字格（占比% / 分摊数量箱）──
   两列都可以填、且**会互相回填**（谁被编辑谁是源），所以两边同宽同形态 ——
   宽度按「3 位小数的箱数」（如 33.333）留够，否则末位会被截掉看不见。 */
.pt-num{width:88px;height:28px;text-align:right}
/* 后端判定为非数字的格（`meta.bad`）⇒ 标红。**不静默按 0 混进合计**：
   全角/中文标点已由后端归一，走到这里的确实是"不是数字"，必须让用户看见。 */
.pt-num-bad{border-color:var(--danger-txt);background:var(--danger-bg)}
/* v359：被**系统自动配平**的格 —— 必须与「用户自己敲的格」在视觉上分得开，
   否则「填一格、旁边几格自己变了」就是一次静默改数。
   用既有主题变量 `--info-blue-bg`（浅/深色主题各有一套值），不新造颜色。 */
.pt-num-auto{border-color:var(--info-blue);background:var(--info-blue-bg)}
/* 标红优先于标蓝：一格既坏又被配平过时，要说的是「它坏了」。 */
.pt-num-bad.pt-num-auto{border-color:var(--danger-txt);background:var(--danger-bg)}
.pt-save-err{margin-top:12px;padding:9px 11px;border-radius:var(--radius-sm);
  background:var(--danger-bg);color:var(--danger-txt);font-size:12.5px;line-height:1.6}

/* ── 删除确认 ── */
.pt-del-q{font-size:13px;line-height:1.7;margin:0 0 8px}
.pt-del-warn{font-size:12.5px;color:var(--warn-amber);line-height:1.7;margin:0}
.btn-danger{background:var(--danger-txt);color:#fff}

/* ── 窄屏：双栏改单栏 ── */
@media (max-width:760px){
  .pt-2col{grid-template-columns:1fr}
  .pt-form{grid-template-columns:1fr}
  .pt-lb{padding-top:0}
}
</style>
