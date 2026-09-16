<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>商品档案</h2>
        <span class="page-sub">浏览与轻量维护商品主档 · 点品牌格行内改（自动归一）· 点厂价格可直接补价 · 售价/进价/安全库存只读（厂价 ＝ 进价，进价有值即不必再补）</span>
      </div>
      <div class="pa-actions">
        <span class="pa-stat" v-if="total !== null"><b>{{ total }}</b>&nbsp;个商品</span>
        <button v-if="missingFactoryCount > 0" class="btn btn-ghost btn-sm pa-fp-btn" @click="openBatchFp"
                title="厂价 ＝ 进价 ＝ 厂家跟你结算的价（同一个量），用于算「本期需付款」。进价已有值的商品不必再补；这里可逐行填或用清单批量补">
          <Icon name="edit"/> 补厂价<span class="pa-fp-n">{{ missingFactoryCount }}</span>
        </button>
        <button class="btn btn-primary btn-sm" @click="openAdd">+ 新增</button>
        <button class="btn btn-ghost btn-sm" @click="openImport">导入</button>
        <button class="btn btn-ghost btn-sm" @click="exportXlsx">导出</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="card pa-panel">
      <div class="pa-filters">
        <div class="pa-search">
          <svg class="pa-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input v-model="keyword" class="input pa-kw" placeholder="商品名称 / 条码 / 规格 / 编码" @input="onFilterChange">
        </div>
        <select v-model="brandFilter" class="input" @change="onFilterChange">
          <option value="">全部品牌</option>
          <option v-for="b in brandOptions" :key="b" :value="b">{{ b }}</option>
        </select>
        <select v-model="categoryFilter" class="input" @change="onFilterChange">
          <option value="">全部分类</option>
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="pa-check"><input type="checkbox" v-model="includeInactive" @change="onFilterChange"> 含停用</label>
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置</button>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="products.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>名称</th><th>条码</th><th>规格</th><th>单位</th>
            <th>品牌</th><th class="num">标准售价</th><th class="num">进价</th><th class="num" title="厂价 ＝ 进价 ＝ 厂家结算价（同一个量，可留空按进价取）">厂价</th><th class="num">安全库存</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="p in products" :key="p.id" :class="{ stopped: p.is_active === 0 }">
              <td class="pa-name">{{ p.name }}</td>
              <td class="pa-mono">{{ p.barcode || '—' }}</td>
              <td>{{ p.spec || '—' }}</td>
              <td>{{ p.unit || '—' }}</td>
              <td class="pa-brand-cell">
                <input v-if="editingId === p.id" v-model="editBrand" class="input pa-brand-input" list="pa-brand-list"
                       @keyup.enter="saveBrand(p)" @blur="saveBrand(p)">
                <span v-else class="pa-brand" @click="startEditBrand(p)">{{ p.brand || '—' }}</span>
              </td>
              <td class="num">{{ money(p.sale_price) }}</td>
              <td class="num">{{ money(p.purchase_price) }}</td>
              <td class="num pa-fp-cell">
                <input v-if="editingFpId === p.id" v-model="editFp" class="input pa-fp-input" type="number" min="0" step="0.01"
                       @keyup.enter="saveFp(p)" @blur="saveFp(p)">
                <span v-else-if="fpEff(p).from === 'factory'" class="pa-fp-val" @click="startEditFp(p)">{{ money(fpEff(p).v) }}</span>
                <!-- v165：厂价 ≡ 进价 ⇒ 未单独录厂价但进价有值时，直接显示口径解析后的价（不显示「未录」，
                     否则用户会以为要重录一遍，而付款额其实已经在用进价）。 -->
                <span v-else-if="fpEff(p).from === 'purchase'" class="pa-fp-from" @click="startEditFp(p)"
                      title="按口径「厂价 ＝ 进价」取自进价；点这里也可单独填厂价">取进价 {{ money(fpEff(p).v) }}</span>
                <span v-else class="pa-fp-miss" title="点这里填厂价（进价也为空）" @click="startEditFp(p)">未录</span>
              </td>
              <td class="num">{{ p.safety_stock != null ? p.safety_stock : '—' }}</td>
              <td>
                <span class="pa-status" :class="p.is_active === 0 ? 'off' : 'on'">{{ p.is_active === 0 ? '停用' : '启用' }}</span>
              </td>
              <td class="pa-ops"><button class="btn btn-ghost btn-sm" @click="openDetail(p)">详情</button></td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <div class="pa-pager" v-if="total > pageSize">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span class="pa-pageinfo">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
          <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          <select v-model="pageSize" class="input pa-size" @change="onPageSizeChange">
            <option :value="20">20 / 页</option>
            <option :value="50">50 / 页</option>
            <option :value="100">100 / 页</option>
          </select>
        </div>
      </div>
      <div v-else class="state-empty">没有匹配的商品，调整筛选条件试试</div>
    </div>

    <!-- 只读详情弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="detailOpen" class="pa-overlay" @click="detailOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="detailOpen" class="pa-modal">
          <div class="pa-modal-hd"><b>商品详情 · {{ detailTarget?.name }}</b><button class="pa-x" @click="detailOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <div class="pa-detail-grid">
              <div class="pa-detail-item"><span>名称</span><b>{{ detailTarget?.name }}</b></div>
              <div class="pa-detail-item"><span>条码</span><b>{{ detailTarget?.barcode || '—' }}</b></div>
              <div class="pa-detail-item"><span>规格</span><b>{{ detailTarget?.spec || '—' }}</b></div>
              <div class="pa-detail-item"><span>单位</span><b>{{ detailTarget?.unit || '—' }}</b></div>
              <div class="pa-detail-item"><span>品牌</span><b>{{ detailTarget?.brand || '—' }}</b></div>
              <div class="pa-detail-item"><span>分类</span><b>{{ detailTarget?.category || '—' }}</b></div>
              <div class="pa-detail-item"><span>标准售价</span><b>{{ money(detailTarget?.sale_price) }}</b></div>
              <div class="pa-detail-item"><span>进价</span><b>{{ money(detailTarget?.purchase_price) }}</b></div>
              <div class="pa-detail-item"><span>厂价<span class="pa-hint">＝ 进价 ＝ 厂家结算价，付款结算用</span></span><b :class="{ 'pa-fp-miss': fpEff(detailTarget).from === 'none' }">{{ fpEff(detailTarget).from === 'none' ? '未录' : money(fpEff(detailTarget).v) + (fpEff(detailTarget).from === 'purchase' ? '（取进价）' : '') }}</b></div>
              <div class="pa-detail-item"><span>分销价</span><b>{{ money(detailTarget?.dist_price) }}</b></div>
              <div class="pa-detail-item"><span>安全库存</span><b>{{ detailTarget?.safety_stock != null ? detailTarget.safety_stock : '—' }}</b></div>
              <div class="pa-detail-item"><span>保质期(天)</span><b>{{ detailTarget?.expiry_days != null ? detailTarget.expiry_days : '—' }}</b></div>
              <div class="pa-detail-item"><span>厂家编码</span><b>{{ detailTarget?.product_code || '—' }}</b></div>
              <div class="pa-detail-item pa-full"><span>别名</span><b>{{ detailTarget?.alias || '—' }}</b></div>
              <div class="pa-detail-item pa-full"><span>状态</span><b>{{ detailTarget?.is_active === 0 ? '已停用' : '启用' }}</b></div>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-primary" @click="detailOpen = false">知道了</button>
          </div>
        </div>
      </Transition>

      <!-- 新增商品弹窗 -->
      <Transition name="fade"><div v-if="addOpen" class="pa-overlay" @click="addOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="addOpen" class="pa-modal">
          <div class="pa-modal-hd"><b>新增商品</b><button class="pa-x" @click="addOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <p class="pa-tip">名称重复将更新已有商品（其余字段按填写覆盖）。品牌自动归一，未匹配品牌进入待审。</p>
            <div class="pa-form">
              <label class="pa-f"><span>商品名称 <i>*</i></span><input v-model="addForm.name" class="input" placeholder="必填"></label>
              <label class="pa-f"><span>条码</span><input v-model="addForm.barcode" class="input" placeholder="唯一编码，留空按名称匹配"></label>
              <label class="pa-f"><span>规格</span><input v-model="addForm.spec" class="input" placeholder="如 200g×12"></label>
              <label class="pa-f"><span>单位</span><input v-model="addForm.unit" class="input" placeholder="件（默认）"></label>
              <label class="pa-f"><span>品牌</span><input v-model="addForm.brand" class="input" list="pa-brand-list" placeholder="可手填或选已有"></label>
              <label class="pa-f"><span>分类</span><input v-model="addForm.category" class="input" placeholder="如 液态奶"></label>
              <label class="pa-f"><span>进价</span><input v-model="addForm.purchase_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>厂价<span class="pa-hint">＝ 进价，可留空</span></span><input v-model="addForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>售价</span><input v-model="addForm.sale_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>
              <label class="pa-f"><span>安全库存</span><input v-model="addForm.safety_stock" class="input" type="number" min="0" step="1" placeholder="0"></label>
              <label class="pa-f"><span>保质期(天)</span><input v-model="addForm.expiry_days" class="input" type="number" min="0" step="1" placeholder="0"></label>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-ghost" @click="addOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="addSaving" @click="saveAdd">{{ addSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>

      <!-- 导入弹窗 -->
      <Transition name="fade"><div v-if="impOpen" class="pa-overlay" @click="impOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="impOpen" class="pa-modal" :class="{ 'pa-map': impStep === 'map' }">
          <div class="pa-modal-hd"><b>导入商品（Excel）</b><button class="pa-x" @click="impOpen = false"><Icon name="close"/></button></div>
          <div class="pa-modal-body">
            <p v-if="impStep === 'pick'" class="pa-tip">下载模板 → 按列填写 → 选择文件自动识别列并导入。重复名称/条码将更新而非新增。</p>
            <div class="pa-imp-row">
              <button class="btn btn-ghost" @click="downloadTpl">下载模板</button>
              <label class="btn btn-ghost pa-file-btn">
                选择文件
                <input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onImpFile">
              </label>
              <span v-if="impFileName" class="pa-fname">{{ impFileName }}</span>
              <button v-if="impStep === 'pick'" class="btn btn-primary" :disabled="!impFile || impSaving" @click="previewImport">{{ impSaving ? '识别中…' : '下一步' }}</button>
            </div>
            <template v-if="impStep === 'map'">
              <p class="pa-tip">系统按列名猜字段，可能猜错（例如把「厂家商品编码」当成品牌）。核对「识别为」这一列，不对就在下拉里改 —— 标「不导入」的列不会进来。</p>
              <ImportMapping v-model="impMapping" :suggestions="impSuggestions" :field-options="impFieldOptions" />
            </template>
            <div v-if="impResult" class="pa-imp-result" :class="impResult.results?.errors?.length ? 'warn' : 'ok'">
              成功 {{ impResult.results?.success }} 条 · 跳过 {{ impResult.results?.skipped }} 条 · 失败 {{ impResult.results?.errors?.length || 0 }} 条
              <span v-if="impResult.results?.errors?.length" class="pa-errs">
                <span v-for="(er, i) in impResult.results.errors.slice(0, 4)" :key="i" class="pa-err">第{{ er.row }}行: {{ er.msg }}</span>
              </span>
            </div>
          </div>
          <div class="pa-modal-ft">
            <template v-if="impStep === 'map'">
              <button class="btn btn-ghost" :disabled="impSaving" @click="impStep = 'pick'">返回</button>
              <button class="btn btn-primary" :disabled="impSaving" @click="doImport">{{ impSaving ? '导入中…' : '确认导入' }}</button>
            </template>
            <button v-else class="btn btn-primary" @click="impOpen = false">关闭</button>
          </div>
        </div>
      </Transition>

      <!-- v157 批量补厂价弹窗：默认只列「未录厂价」的启用商品 -->
      <Transition name="fade"><div v-if="fpOpen" class="pa-overlay" @click="fpOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="fpOpen" class="pa-modal pa-wide">
          <div class="pa-modal-hd">
            <b>批量补厂价 · 还有 {{ fpRows.length }} 个商品厂价与进价都没有</b>
            <button class="pa-x" @click="fpOpen = false"><Icon name="close"/></button>
          </div>
          <div class="pa-modal-body">
            <p class="pa-tip">
              <b>厂价 ＝ 进价 ＝ 厂家跟你结算的价</b>（同一个量，档案里分成两列存）。它用于算「本期需付款 = 定稿量 × 厂价」，
              取价顺序为 <b>厂价 → 进价 → 标准售价</b>，所以<b>进价已有值的商品不必在这里重录</b>。<br>
              两种填法任选：① 直接在下表逐行填；② 点「导出待补清单」到 Excel 里填好，再点「导入回填」——
              回填按 <b>商品编号</b> 定位（编号缺失才退回条码），所以<b>没有条码的商品也能补</b>，前两列请勿改动。
            </p>

            <!-- v158 厂价闸门：文案按开关实际状态陈述。此前 8 处文案无条件写「会被拒收」，
                 而代码里根本没有拒收逻辑 —— 开关存在就是为了让文案与行为都能说真话。 -->
            <div class="pa-fp-gate" :class="{ on: fpGate }">
              <label class="pa-fp-switch">
                <input type="checkbox" :checked="fpGate" :disabled="fpGateBusy" @change="toggleFpGate">
                <span><b>厂价必填</b>（报单时拒收没录厂价的商品）</span>
              </label>
              <span class="pa-fp-gate-hint">
                <template v-if="fpGate">
                  已开启：厂价与进价都没有的商品，在<b>报单导入</b>与<b>小程序报单</b>时都会被拒收。<b v-if="fpGateMissing">当前还有 {{ fpGateMissing }} 个没补，建议先补完再保持开启。</b>
                </template>
                <template v-else>
                  未开启：价格没录也能正常报单 —— 有进价的按进价算，<b>厂价与进价都没有的才按标准售价估算（偏大）</b>。<span v-if="fpGateMissing"> 还有 {{ fpGateMissing }} 个商品价格没录。</span>
                </template>
              </span>
            </div>

            <div class="pa-fp-filters">
              <select v-model="fpBrand" class="input">
                <option value="">全部品牌</option>
                <option v-for="b in fpBrandOptions" :key="b" :value="b">{{ b }}</option>
              </select>
              <select v-model="fpCategory" class="input">
                <option value="">全部分类</option>
                <option v-for="c in fpCategoryOptions" :key="c" :value="c">{{ c }}</option>
              </select>
              <button class="btn btn-ghost btn-sm" @click="fpSelectAll(true)">全选</button>
              <button class="btn btn-ghost btn-sm" @click="fpSelectAll(false)">取消全选</button>
            </div>

            <div v-if="fpViewRows.length" class="pa-fp-wrap">
              <table class="tbl pa-fp-tbl">
                <thead><tr>
                  <th class="pa-fp-ck"></th><th>条码</th><th>名称</th><th>规格</th><th>单位</th>
                  <th class="num">参考：分销价</th><th class="num">填入厂价</th>
                </tr></thead>
                <tbody>
                  <tr v-for="r in fpViewRows" :key="r.id" :class="{ 'pa-row-off': !r._ck }">
                    <td class="pa-fp-ck"><input type="checkbox" v-model="r._ck"></td>
                    <td class="pa-mono">{{ r.barcode || '—' }}</td>
                    <td class="pa-name">{{ r.name }}</td>
                    <td>{{ r.spec || '—' }}</td>
                    <td>{{ r.unit || '—' }}</td>
                    <td class="num pa-fp-ref">{{ Number(r.dist_price) > 0 ? money(r.dist_price) : '—' }}</td>
                    <td class="num"><input v-model="r._fp" class="input pa-fp-input" type="number" min="0" step="0.01" placeholder="0.00"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="state-empty">当前筛选下没有缺厂价的商品 —— 都补好了</p>

            <p v-if="fpFiltered.length > fpShowLimit" class="pa-fp-more">
              表内只显示前 {{ fpShowLimit }} 个，另有 {{ fpFiltered.length - fpShowLimit }} 个请用「导出待补清单」批量处理
            </p>

            <div class="pa-fp-foot">
              <span class="pa-fp-count">已勾选 <b>{{ fpCheckedCount }}</b> 个 · 已填价 <b>{{ fpFilledCount }}</b> 个</span>
              <button class="btn btn-ghost btn-sm" @click="exportFpList">导出待补清单</button>
              <label class="btn btn-ghost btn-sm pa-file-btn">
                导入回填
                <input type="file" accept=".xlsx" style="display:none" @change="onFpFile">
              </label>
            </div>

            <div v-if="fpResult" class="pa-imp-result" :class="(fpResult.skipped?.length || fpResult.nokey) ? 'warn' : 'ok'">
              已更新 {{ fpResult.updated }} 个商品
              <template v-if="fpResult.unfilled">· {{ fpResult.unfilled }} 行厂价留空（不算错）</template>
              <template v-if="fpResult.nokey">· {{ fpResult.nokey }} 行既没编号也没条码、认不出商品</template>
              <template v-if="fpResult.skipped?.length">· 跳过 {{ fpResult.skipped.length }} 个（{{ fpResult.skipped.slice(0, 3).map(s => (s.barcode || s.id) + '：' + s.reason).join('；') }}）</template>
            </div>
          </div>
          <div class="pa-modal-ft">
            <button class="btn btn-ghost" @click="fpOpen = false">关闭</button>
            <button class="btn btn-primary" :disabled="fpSaving || fpFilledCount === 0" @click="saveFpBatch">
              {{ fpSaving ? '保存中…' : `保存已填的 ${fpFilledCount} 行` }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 共享品牌候选 datalist：仅一份，避免每行重复渲染造成 DOM 爆炸（沿用 Forecast 修复范式） -->
    <datalist id="pa-brand-list">
      <option v-for="b in brandOptions" :key="b" :value="b"></option>
    </datalist>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import ImportMapping from '../components/ImportMapping.vue'
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { productsApi, importApi } from '../api/modules'
import * as XLSX from 'xlsx'
import { toast } from '../store'

const loading = ref(false)
const products = ref([])
const total = ref(null)
const page = ref(1)
const pageSize = ref(50)
const keyword = ref('')
const brandFilter = ref('')
const categoryFilter = ref('')
const includeInactive = ref(false)
const brandOptions = ref([])
const categoryOptions = ref([])

// ---- v157 厂价（v165 更正口径）----
// 🔴 厂价 ≡ 进价 ≡ 厂家跟经销商结算的价 —— **同一个量**（用户 2026-09-14 定调原话「厂价就是进价」）。
// v132 曾把它另建成独立列 `factory_price`，与既有列 `purchase_price`（列头「进价」）同义；
// 实测真实租户 `factory_price` 269/269 全空、价都在进价里 ⇒ 解析口径 = **厂价优先，缺则取进价**，
// 两者皆无才回退标准售价（偏大）。闸门开启后，厂价与进价都没有的商品会在报单导入 / 小程序报单时被拒收。
// 解析的唯一实现：前端 `fpEff()`（本页）/ 后端 `db.factory_price_sql`。改口径请只改这两处。
const allProducts = ref([])           // 全量商品索引（含停用），供补厂价面板与分类候选共用
const missingFactoryCount = ref(0)    // 启用商品中「厂价与进价都没有」的数量 → 为 0 时工具栏入口自动隐藏
const editingFpId = ref(null)
const editFp = ref('')
const fpOpen = ref(false)
const fpRows = ref([])                // [{...product, _ck, _fp}]
const fpBrand = ref('')
const fpCategory = ref('')
const fpSaving = ref(false)
const fpResult = ref(null)
const fpShowLimit = 200               // 面板内一次渲染上限（其余走「导出待补清单」）
// v158 厂价闸门：开启后「报单导入」与「小程序报单」都会拒收**厂价与进价都没有**的商品行；**默认关闭**。
// 关闭时价格没录也能照常报单：有进价的按进价算，只有两者皆无才按标准售价回退估算（偏大）。
// 文案必须如实说清，不能无条件写「会被拒收」（此前 8 处文案都这么写，而代码里根本没有拒收逻辑）。
const fpGate = ref(false)
const fpGateBusy = ref(false)
const fpGateMissing = ref(0)          // 后端权威的「厂价与进价都没有」计数

const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize.value)))

/* ---- v157 批量补厂价：派生视图 ---- */
const fpBrandOptions = computed(() => [...new Set(fpRows.value.map(r => r.brand).filter(Boolean))].sort())
const fpCategoryOptions = computed(() => [...new Set(fpRows.value.map(r => r.category).filter(Boolean))].sort())
const fpFiltered = computed(() => fpRows.value.filter(r =>
  (!fpBrand.value || r.brand === fpBrand.value) && (!fpCategory.value || r.category === fpCategory.value)))
const fpViewRows = computed(() => fpFiltered.value.slice(0, fpShowLimit))
const fpCheckedCount = computed(() => fpViewRows.value.filter(r => r._ck).length)
const fpFilledCount = computed(() => fpViewRows.value.filter(r => r._ck && Number(r._fp) > 0).length)

const editingId = ref(null)
const editBrand = ref('')
const detailOpen = ref(false)
const detailTarget = ref(null)

// 新增弹窗
const addOpen = ref(false)
const addSaving = ref(false)
const addForm = ref({ name: '', barcode: '', spec: '', unit: '', brand: '', category: '', purchase_price: '', factory_price: '', sale_price: '', safety_stock: '', expiry_days: '' })

// 导入弹窗
const impOpen = ref(false)
const impFile = ref(null)
const impFileName = ref('')
const impResult = ref(null)
const impSaving = ref(false)
/* v178 列映射确认：导入由「一步」改为「两步」——先识别、让你看清每一列被当成什么，再执行。
   此前是 preview 的结果直接当 mapping 喂给 execute，中间无人可看：实测把「厂家商品编码」
   的编码串按关键词「厂家」写进了品牌列（`products.brand`），用户全程无感。 */
const impStep = ref('pick')          // pick=选文件 | map=确认列映射
const impSuggestions = ref([])       // /preview 的 suggestions（含样例值）
const impFieldOptions = ref([])      // 候选字段（**后端给**，前端不自己写一份键→中文）
const impMapping = ref({})

async function loadProducts() {
  loading.value = true
  try {
    const q = []
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (brandFilter.value) q.push('brand=' + encodeURIComponent(brandFilter.value))
    if (categoryFilter.value) q.push('category=' + encodeURIComponent(categoryFilter.value))
    if (includeInactive.value) q.push('include_inactive=1')
    q.push('limit=' + pageSize.value)
    q.push('offset=' + ((page.value - 1) * pageSize.value))
    const d = await api('/api/products?' + q.join('&'))
    products.value = d.items || []
    total.value = d.total || 0
  } catch (e) { toast(e.message || '加载商品失败', 'err') }
  finally { loading.value = false }
}

async function loadBrandOptions() {
  try {
    const d = await api('/api/brands?include_inactive=1')
    brandOptions.value = (Array.isArray(d) ? d : []).map(b => b.name).filter(Boolean)
  } catch (e) { /* 品牌候选为增强项，失败不影响主流程 */ }
}

// v157：一次性拉全量商品（含停用）做「商品索引」——
//   ① 分类筛选候选；② 「缺厂价」计数（决定工具栏补厂价入口显不显示）；③ 批量补厂价面板的数据源。
// 428 行量级可接受；原先只为分类候选单独拉过一次，此处合并为一份缓存，避免重复请求。
async function refreshProductIndex() {
  try {
    const d = await api('/api/products?include_inactive=1&limit=5000')
    allProducts.value = Array.isArray(d.items) ? d.items : []
    categoryOptions.value = [...new Set(allProducts.value.map(p => p.category).filter(Boolean))].sort()
    recomputeMissingFactory()
  } catch (e) { /* 商品索引为增强项，失败不影响主流程 */ }
}

// v165 厂价口径：**厂价 ≡ 进价 ≡ 厂家结算价（同一个量）** —— 用户 2026-09-14 定调。
// v132 曾把厂价另建成独立列 factory_price，实测真实租户 269/269 全空，价其实都在「进价」里。
// 本函数是前端**唯一**的解析处（与后端 `factory_price_sql` 逐字同规则）：
//   厂价列有值 → 用它（兼容历史上单独填过的租户）；否则取进价；两者皆无才视为缺价。
function fpEff(p) {
  const f = Number(p?.factory_price || 0)
  if (f > 0) return { v: f, from: 'factory' }
  const pp = Number(p?.purchase_price || 0)
  if (pp > 0) return { v: pp, from: 'purchase' }
  return { v: 0, from: 'none' }
}

function recomputeMissingFactory() {
  // 「待补厂价」= 厂价与进价**都没有**的启用商品（改前只看 factory_price ⇒ 真实租户 269 全中，
  // 会让用户重录一遍已经在「进价」里的数）。
  missingFactoryCount.value = allProducts.value
    .filter(p => p.is_active !== 0)
    .filter(p => fpEff(p).from === 'none').length
}

function onFilterChange() { page.value = 1; loadProducts() }
function onPageSizeChange() { page.value = 1; loadProducts() }
function goPage(p) { if (p < 1 || p > totalPages.value) return; page.value = p; loadProducts() }
function resetFilters() {
  keyword.value = ''; brandFilter.value = ''; categoryFilter.value = ''; includeInactive.value = false
  page.value = 1; loadProducts()
}

function money(n) {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (isNaN(v)) return '—'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function startEditBrand(p) { editingId.value = p.id; editBrand.value = p.brand || '' }
async function saveBrand(p) {
  if (editingId.value !== p.id) return  // 已保存过（如 Enter + blur 重复触发）
  editingId.value = null
  const raw = (editBrand.value || '').trim()
  if (raw === (p.brand || '')) return  // 无变化
  try {
    await api('/api/products/' + p.id, { method: 'PUT', body: { brand: raw } })
    p.brand = raw
    toast('品牌已更新（已自动归一）', 'ok')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* ---- v157 厂价：行内编辑（沿用品牌的行内改法）---- */
function startEditFp(p) {
  editingFpId.value = p.id
  editFp.value = Number(p.factory_price) > 0 ? String(p.factory_price) : ''
}

async function saveFp(p) {
  if (editingFpId.value !== p.id) return  // 已保存过（Enter + blur 重复触发）
  editingFpId.value = null
  // ⚠️ 必须 String() 包一层：输入框是 type="number"，Vue 的 v-model 会自动把值转成
  //    number（2.8 而不是 "2.8"），直接 .trim() 会抛 "trim is not a function" 把整页打崩
  //    （真机 E2E 抓到；纯逻辑测试抓不到）。品牌那列是 text 才没这问题。
  const raw = String(editFp.value ?? '').trim()
  const nv = Number(raw)
  // 厂价必须为正数：0/空 = 「没打算补」，不作为有效输入提交（后端同样拒绝 <=0）
  if (!raw || isNaN(nv) || nv <= 0) { toast('厂价请填大于 0 的数字', 'err'); return }
  if (nv === Number(p.factory_price || 0)) return  // 无变化
  try {
    const r = await productsApi.batchFactoryPrice([{ id: p.id, factory_price: nv }])
    if (!r.updated) { toast(r.skipped?.[0]?.reason || '未更新', 'warn'); return }
    p.factory_price = nv
    const hit = allProducts.value.find(x => x.id === p.id)
    if (hit) hit.factory_price = nv
    recomputeMissingFactory()
    toast('厂价已更新', 'ok')
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

/* ---- v157 厂价：批量补（存量商品）---- */
function _rebuildFpRows() {
  const miss = allProducts.value
    .filter(p => p.is_active !== 0)
    .filter(p => !(Number(p.factory_price) > 0))
  fpRows.value = miss.map(p => ({ ...p, _ck: true, _fp: '' }))
}

function openBatchFp() {
  _rebuildFpRows()
  fpBrand.value = ''
  fpCategory.value = ''
  fpResult.value = null
  fpSaving.value = false
  fpOpen.value = true
  loadFpGate()
}

/* ---- v158 厂价闸门：读状态 / 开与关 ---- */
async function loadFpGate() {
  try {
    const g = await productsApi.factoryPriceGate()
    fpGate.value = !!g.enabled
    fpGateMissing.value = Number(g.missing_count || 0)
  } catch (e) { /* 读不到不影响面板正常使用，保持默认「未开启」 */ }
}

async function toggleFpGate() {
  const next = !fpGate.value
  fpGateBusy.value = true
  try {
    const g = await productsApi.setFactoryPriceGate(next)
    fpGate.value = !!g.enabled
    fpGateMissing.value = Number(g.missing_count || 0)
    toast(next
      ? `已开启厂价必填：厂价与进价都没有的商品在报单导入 / 小程序报单时会被拒收（当前还有 ${g.missing_count} 个没补）`
      : '已关闭厂价必填：不再拦价格缺失的商品（有进价的按进价算，两者皆无才按标准售价估算）',
      next ? 'warn' : 'ok')
  } catch (e) { toast(e.message || '开关失败', 'err') }
  finally { fpGateBusy.value = false }
}

function fpSelectAll(v) { fpViewRows.value.forEach(r => { r._ck = v }) }

// 导出待补清单：**走后端生成**（后端那份带「商品编号」列作导回钥匙）。
// 为什么不在前端用 SheetJS 造：钥匙规则必须在唯一一处实现 —— 实测前端那版只有条码，
// 而本域存在「无条码商品」（演示租户 11 个待补商品全部无条码）与「共码商品」
// （两个下单主体共用同一商品条码），只认条码 → 前者永远补不回去、后者会把厂价写到错的商品上。
async function exportFpList() {
  try {
    const blob = await importApi.factoryPriceTemplate({ brand: fpBrand.value, category: fpCategory.value })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `待补厂价清单_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`已导出 ${fpFiltered.value.length} 条，填好「厂价」列后点「导入回填」`, 'ok')
  } catch (e) { toast(e.message || '导出失败', 'err') }
}

// 导回填价结果：走后端 /factory-price-apply（编号优先、条码兜底；逐条回报跳过原因）。
async function onFpFile(ev) {
  const f = ev.target.files && ev.target.files[0]
  ev.target.value = ''
  if (!f) return
  if (!/\.xlsx$/i.test(f.name)) { toast('请上传 .xlsx（用「导出待补清单」下载的文件填写，另存为 .xlsx）', 'err'); return }
  fpSaving.value = true
  try {
    const r = await importApi.factoryPriceApply(f)
    await refreshProductIndex()
    loadProducts()
    _rebuildFpRows()
    fpResult.value = {
      updated: r.updated || 0, skipped: r.skipped || [],
      unfilled: r.unfilled || 0, nokey: r.nokey || 0,
    }
    await loadFpGate()
    const bits = []
    if (r.unfilled) bits.push(`${r.unfilled} 行厂价留空（不算错）`)
    if (r.nokey) bits.push(`${r.nokey} 行既没编号也没条码、认不出是哪个商品`)
    toast(`回填完成：更新 ${r.updated} 个`
      + `${r.skipped?.length ? '，跳过 ' + r.skipped.length + ' 个' : ''}`
      + `${bits.length ? '（' + bits.join('；') + '）' : ''}`,
      (r.skipped?.length || r.nokey) ? 'warn' : 'ok')
    if (!r.skipped?.length && !r.nokey) fpOpen.value = false
  } catch (e) { toast(e.message || '回填失败', 'err') }
  finally { fpSaving.value = false }
}

async function saveFpBatch() {
  const picked = fpViewRows.value.filter(r => r._ck && Number(r._fp) > 0)
  if (!picked.length) { toast('请至少勾选一行并填入厂价', 'warn'); return }
  fpSaving.value = true
  try {
    const r = await productsApi.batchFactoryPrice(
      picked.map(x => ({ id: x.id, factory_price: Number(x._fp) })))
    await refreshProductIndex()
    loadProducts()
    _rebuildFpRows()
    fpResult.value = r
    toast(`已更新 ${r.updated} 个商品${r.skipped?.length ? '，跳过 ' + r.skipped.length + ' 个' : ''}`,
      r.skipped?.length ? 'warn' : 'ok')
    if (!r.skipped?.length) fpOpen.value = false
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { fpSaving.value = false }
}

function openDetail(p) { detailTarget.value = p; detailOpen.value = true }

/* ---- 新增商品 ---- */
function openAdd() {
  addForm.value = { name: '', barcode: '', spec: '', unit: '', brand: '', category: '', purchase_price: '', factory_price: '', sale_price: '', safety_stock: '', expiry_days: '' }
  addSaving.value = false
  addOpen.value = true
}
function _num(v, d = 0) { const n = Number(v); return isNaN(n) ? d : n }
async function saveAdd() {
  const f = addForm.value
  if (!f.name.trim()) { toast('请填写商品名称', 'err'); return }
  addSaving.value = true
  try {
    const row = {
      name: f.name.trim(),
      barcode: f.barcode.trim(),
      spec: f.spec.trim(),
      unit: f.unit.trim() || '件',
      brand: f.brand.trim(),
      category: f.category.trim(), // 显式提供（含空），后端仅当提供时更新
      purchase_price: _num(f.purchase_price),
      // 厂价：空 = 「不动已录的厂价」。本页新增同名商品会走 upsert 覆盖其它字段，
      // 若把空值当 0 提交，会把用户补好的厂价清零 —— 故只在真填了值时才带上该键。
      ...(String(f.factory_price).trim() === '' ? {} : { factory_price: _num(f.factory_price) }),
      sale_price: _num(f.sale_price),
      safety_stock: _num(f.safety_stock),
      expiry_days: _num(f.expiry_days),
    }
    const r = await productsApi.bulkUpsert([row])
    toast(`已保存（新增 ${r.inserted || 0} / 更新 ${r.updated || 0}）`, 'ok')
    addOpen.value = false
    loadProducts()
    refreshProductIndex()
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { addSaving.value = false }
}

/* ---- 导入商品 ---- */
function openImport() {
  impFile.value = null; impFileName.value = ''; impResult.value = null; impSaving.value = false
  impStep.value = 'pick'; impSuggestions.value = []; impFieldOptions.value = []; impMapping.value = {}
  impOpen.value = true
}
function onImpFile(ev) {
  const f = ev.target.files[0] || null
  if (f && !/\.(xlsx|xls|csv)$/i.test(f.name)) { toast('仅支持 Excel/CSV 文件', 'err'); ev.target.value = ''; return }
  impFile.value = f; impFileName.value = f?.name || ''; impResult.value = null
  impStep.value = 'pick'   // 换文件 → 映射作废，回到第一步重识别
}
async function downloadTpl() {
  try {
    const blob = await importApi.templateFile('products')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '商品导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}
/* 第一步：只识别、不落库。把每一列识别成什么、依据是什么、命中列里有哪几个值，
   一并摆到界面上（样例值是判断「品牌还是编码」的唯一依据）。 */
async function previewImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const prev = await importApi.preview(impFile.value, 'products')
    impSuggestions.value = prev.suggestions || []
    impFieldOptions.value = prev.field_options || []
    if (!impSuggestions.value.length) { toast('没读到任何列，请检查文件是否为 Excel/CSV', 'err'); return }
    const m = {}
    for (const s of impSuggestions.value) if (s.suggested_field) m[s.index] = s.suggested_field
    impMapping.value = m
    impStep.value = 'map'
  } catch (e) { toast(e.message || '文件解析失败', 'err') }
  finally { impSaving.value = false }
}
/* 第二步：按用户**确认过/改过**的映射执行。mapping 由界面持有 —— 后端本来就照用它，
   所以"改判"是真生效的，不是只改个显示。 */
async function doImport() {
  if (!impFile.value) return
  impSaving.value = true
  try {
    const r = await importApi.execute(impFile.value, 'products', impMapping.value)
    impResult.value = r
    impStep.value = 'pick'
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadProducts()
  } catch (e) { toast(e.message || '导入失败', 'err') }
  finally { impSaving.value = false }
}

/* ---- 导出商品（当前筛选） ---- */
async function exportXlsx() {
  try {
    const q = []
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    if (brandFilter.value) q.push('brand=' + encodeURIComponent(brandFilter.value))
    if (categoryFilter.value) q.push('category=' + encodeURIComponent(categoryFilter.value))
    if (includeInactive.value) q.push('include_inactive=1')
    q.push('limit=5000'); q.push('offset=0')
    const d = await api('/api/products?' + q.join('&'))
    const items = d.items || []
    const rows = items.map(p => ({
      '商品名称': p.name, '条码': p.barcode || '', '规格': p.spec || '', '单位': p.unit || '',
      '品牌': p.brand || '', '分类': p.category || '',
      '标准售价': p.sale_price || 0, '进价': p.purchase_price || 0,
      '厂价': p.factory_price || 0, '分销价': p.dist_price || 0,
      '安全库存': p.safety_stock != null ? p.safety_stock : '', '保质期(天)': p.expiry_days != null ? p.expiry_days : '',
      '状态': p.is_active === 0 ? '停用' : '启用',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '商品档案')
    XLSX.writeFile(wb, `商品档案_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast(`已导出 ${rows.length} 条`, 'ok')
  } catch (e) { toast(e.message || '导出失败', 'err') }
}

onMounted(() => {
  loadProducts()
  loadBrandOptions()
  refreshProductIndex()
})
</script>

<style scoped>
.pa-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.pa-stat{font-size:13px;color:var(--t2);flex-shrink:0}
.pa-stat b{color:var(--p);font-size:16px}

/* v157 「补厂价」入口：仅当有商品未录厂价时出现，补完自动消失（不是常驻按钮） */
.pa-fp-btn{color:var(--war);border-color:rgba(var(--war-rgb),.35);gap:5px}
.pa-fp-btn:hover{background:rgba(var(--war-rgb),.1);color:var(--war)}
.pa-fp-n{display:inline-block;min-width:18px;padding:0 5px;border-radius:999px;background:rgba(var(--war-rgb),.16);font-size:11.5px;font-weight:600;line-height:16px;text-align:center}

/* v157 厂价列（行内可编） */
.pa-fp-cell{white-space:nowrap}
.pa-fp-val{cursor:pointer;border-bottom:1px dashed transparent}
.pa-fp-val:hover{border-bottom-color:var(--p);color:var(--p)}
.pa-fp-from{cursor:pointer;color:var(--txt-3);font-size:12px;border-bottom:1px dashed transparent}
.pa-fp-from:hover{border-bottom-color:var(--p);color:var(--p)}
.pa-fp-miss{display:inline-block;padding:1px 8px;border-radius:8px;background:rgba(var(--war-rgb),.14);color:var(--war);font-size:12px;cursor:pointer}
.pa-fp-miss:hover{background:rgba(var(--war-rgb),.24)}
.pa-fp-input{width:92px;height:30px;text-align:right;padding:0 8px}
.pa-hint{font-size:11px;color:var(--t3);font-weight:400;margin-left:4px}

.pa-panel{padding:18px;margin-bottom:14px}
.pa-filters{display:flex;gap:10px;flex-wrap:nowrap;align-items:center;overflow-x:auto;padding-bottom:2px}
.pa-search{position:relative;display:flex;align-items:center;flex:0 1 260px;min-width:170px;max-width:300px}
.pa-search-ico{position:absolute;left:10px;width:15px;height:15px;color:var(--t3);pointer-events:none}
.pa-kw{width:100%;padding-left:32px}
.pa-filters select{flex:0 0 140px;width:140px}
.pa-filters .pa-check,.pa-filters .btn{flex:0 0 auto}

.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}
.pa-name{font-weight:600;color:var(--t1)}
.pa-mono{font-size:12px;color:var(--t3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pa-brand{display:inline-block;min-width:48px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t1);cursor:pointer;transition:.15s}
.pa-brand:hover{background:rgba(var(--p-rgb,6,182,212),.14);color:var(--p)}
.pa-brand-input{height:30px;min-width:120px}
.pa-status{font-size:12px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t3)}
.pa-status.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.pa-status.off{background:rgba(var(--t3-rgb,156,163,175),.14);color:var(--t3)}
.pa-ops{white-space:nowrap}
.pa-ops .btn{margin-left:6px}

.pa-pager{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
.pa-pageinfo{font-size:12.5px;color:var(--t2)}
.pa-size{height:30px;width:auto}

/* 弹窗 */
.pa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.pa-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(520px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.pa-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.pa-modal-hd b{font-size:15px;color:var(--t1)}
.pa-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.pa-modal-body{padding:18px 20px}
.pa-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.pa-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 14px;background:var(--bg2);padding:8px 12px;border-radius:8px}

/* 详情网格 */
.pa-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}
.pa-detail-item{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--t3)}
.pa-detail-item b{font-size:14px;color:var(--t1);font-weight:600;word-break:break-all}
.pa-detail-item.pa-full{grid-column:1 / -1}

/* 新增表单 */
.pa-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.pa-f{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.pa-f i{color:var(--dan);font-style:normal}
.pa-f .input{height:34px}

/* 导入 */
.pa-imp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pa-file-btn{position:relative;overflow:hidden}
.pa-fname{font-size:12.5px;color:var(--t2)}
.pa-imp-result{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;background:rgba(var(--suc-rgb),.1);color:var(--suc)}
.pa-imp-result.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}
.pa-errs{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.pa-err{font-size:12px;color:var(--t2)}

/* v157 批量补厂价面板 */
.pa-modal.pa-wide{width:min(880px,96vw)}
/* v178 列映射确认步：表格要横向空间，且行数可能几十行 → 加宽 + 限高内滚（不撑出视口） */
.pa-modal.pa-map{width:min(880px,96vw);max-height:88vh;display:flex;flex-direction:column}
.pa-modal.pa-map .pa-modal-body{overflow-y:auto}
.pa-fp-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.pa-fp-filters select{flex:0 0 140px;width:140px;height:30px}
.pa-fp-wrap{max-height:46vh;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius-md)}
.pa-fp-tbl{font-size:12.5px;margin:0}
.pa-fp-tbl thead th{position:sticky;top:0;z-index:1;background:var(--bg3)}
.pa-fp-tbl td,.pa-fp-tbl th{padding:5px 8px}
.pa-fp-ck{width:34px;text-align:center}
.pa-fp-ref{color:var(--t3)}
tr.pa-row-off td{opacity:.5}
.pa-fp-more{margin:8px 0 0;font-size:12px;color:var(--t2)}
.pa-fp-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
.pa-fp-count{font-size:12.5px;color:var(--t2);margin-right:auto}
.pa-fp-count b{color:var(--t1)}
/* v158 厂价闸门开关：默认（未开启）走中性底色，开启后转成功色 —— 开关状态一眼可辨 */
.pa-fp-gate{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);font-size:12.5px;line-height:1.6}
.pa-fp-gate.on{background:rgba(var(--suc-rgb),.08);border-color:rgba(var(--suc-rgb),.35)}
.pa-fp-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;color:var(--t1);white-space:nowrap;user-select:none}
.pa-fp-switch input{width:15px;height:15px;margin:0;cursor:pointer;accent-color:var(--suc)}
.pa-fp-switch input:disabled{cursor:not-allowed;opacity:.5}
.pa-fp-gate.on .pa-fp-switch b{color:var(--suc)}
.pa-fp-gate-hint{flex:1 1 320px;min-width:0;color:var(--t2)}
.pa-fp-gate-hint b{color:var(--war)}

.state-empty{font-size:13px;color:var(--t3);text-align:center;padding:22px 0}
</style>
