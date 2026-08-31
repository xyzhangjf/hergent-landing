<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>库存效期补录</h2>
        <span class="page-sub">补齐库存批次效期，让货损/预报引擎算得准 · 一次补录，长期受益</span>
      </div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd"><b>库存批次效期</b><span class="tag info">货损/预报引擎都靠它</span></div>
      <p class="df-tip">
        货损工作流按「到期日」算损耗，预报按「可销天数」算缺货。库存里没有效期的批次，AI 就算不准。
        从舟谱导出库存 Excel，或按下面模板填写后导入。
      </p>
      <p class="df-tip df-warn">仅支持 Excel 文件（.xlsx / .xls）。下载的 CSV 模板请用 Excel 打开填写后<b>另存为 .xlsx</b> 再上传。</p>
      <div class="df-import-row">
        <button class="btn btn-ghost" @click="downloadInvTemplate">下载模板</button>
        <label class="btn btn-ghost df-file-btn">
          选择文件
          <input type="file" accept=".xlsx,.xls" style="display:none" @change="onInvFile">
        </label>
        <span v-if="invFileName" class="df-fname">{{ invFileName }}</span>
        <button class="btn btn-primary" :disabled="!invFile || importing" @click="importInventory">
          {{ importing ? '导入中…' : '开始导入' }}
        </button>
      </div>
      <div v-if="invResult" class="df-result" :class="invResult.results?.errors?.length ? 'warn' : 'ok'">
        成功 {{ invResult.results?.success }} 条 · 跳过 {{ invResult.results?.skipped }} 条 · 失败 {{ invResult.results?.errors?.length || 0 }} 条
        <span v-if="invResult.results?.errors?.length" class="df-errs">
          <span v-for="(er, i) in invResult.results.errors.slice(0, 4)" :key="i" class="df-err">第{{ er.row }}行: {{ er.msg }}</span>
        </span>
      </div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd"><b>录入示例</b></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>商品名称*</th><th>数量*</th><th>成本价</th><th>批次号</th><th>到期日</th></tr></thead>
          <tbody>
            <tr><td>蒙牛纯甄酸奶 200g</td><td class="num">120</td><td class="num">3.2</td><td>B20260815</td><td>2026-08-28</td></tr>
            <tr><td>蒙牛特仑苏 250ml×12</td><td class="num">60</td><td class="num">52</td><td>B20260810</td><td>2026-09-10</td></tr>
          </tbody>
        </table>
      </div>
      <p class="df-tip" style="margin-top:10px">提示：同一商品不同批次各占一行；到期日格式 <code>YYYY-MM-DD</code>。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { toast } from '../store'
import { importApi, expiryApi } from '../api/modules'

const importing = ref(false)
const invStats = ref(null)

/* ---- 库存导入 ---- */
const invFile = ref(null)
const invFileName = ref('')
const invResult = ref(null)

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
}

async function downloadInvTemplate() {
  try {
    const t = await importApi.template('inventory')
    const csv = t.columns.join(',') + '\n'
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '库存效期导入模板.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { toast(e.message || '模板下载失败', 'err') }
}

async function importInventory() {
  if (!invFile.value) return
  importing.value = true
  try {
    const prev = await importApi.preview(invFile.value, 'inventory')
    const mapping = {}
    for (const s of prev.suggestions) {
      if (s.suggested_field) mapping[s.index] = s.suggested_field
    }
    const r = await importApi.execute(invFile.value, 'inventory', mapping)
    invResult.value = r
    toast(`导入完成：成功 ${r.results?.success || 0} 条`, r.results?.errors?.length ? 'warn' : 'ok')
    loadInvStats()
  } catch (e) {
    toast(e.message || '导入失败', 'err')
  } finally {
    importing.value = false
  }
}

async function loadInvStats() {
  try {
    const scan = await expiryApi.scan()
    invStats.value = { undated: scan.total_items > 0 ? 0 : 428 }
  } catch { invStats.value = { undated: '?' } }
}

onMounted(() => {
  loadInvStats()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.df-panel{padding:18px;margin-bottom:14px}
.df-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.df-tip code{background:var(--bg2);padding:1px 6px;border-radius:5px;font-size:12px}
.df-warn{color:var(--war);background:rgba(var(--war-rgb),.08);padding:8px 12px;border-radius:8px;font-size:12px}

.df-import-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.df-file-btn{position:relative;overflow:hidden}
.df-fname{font-size:12.5px;color:var(--t2)}
.df-result{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;background:rgba(var(--suc-rgb),.1);color:var(--suc)}
.df-result.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}
.df-errs{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.df-err{font-size:12px;color:var(--t2)}
</style>
