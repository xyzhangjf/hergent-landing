// ===== Hergent ERP — 前端逻辑 =====
// 通过 IPC 调用本地 server.py 的 ERP API

const ERP_API = 'http://localhost:8765/api/erp';

async function erpFetch(path, options = {}) {
  const url = ERP_API + path;
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  };
  if (opts.body && typeof opts.body === 'object') {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  return res.json();
}

// ============================================================
// 状态
// ============================================================

let _erpTab = 'sale'; // 当前 ERP 标签页
let _erpProducts = [];
let _erpContacts = [];
let _erpSaleOrders = { orders: [], total: 0 };
let _erpPurchaseOrders = { orders: [], total: 0 };
let _erpInventory = [];
let _erpReceivables = { receivables: [], total: 0 };
let _erpDashboard = {};

// ============================================================
// 入口：渲染 ERP 主界面
// ============================================================

async function openErp() {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  let erpPage = document.getElementById('pageErp');
  if (!erpPage) {
    erpPage = document.createElement('div');
    erpPage.id = 'pageErp';
    erpPage.className = 'page';
    erpPage.innerHTML = ERP_HTML;
    document.querySelector('.main-body')?.appendChild(erpPage);
  }
  erpPage.style.display = 'flex';
  erpPage.style.flexDirection = 'column';
  erpPage.style.flex = '1';
  erpPage.style.overflow = 'hidden';

  switchErpTab('sale');
}

function switchErpTab(tab) {
  _erpTab = tab;
  document.querySelectorAll('#erpNav .erp-nav-item').forEach(el => el.classList.remove('active'));
  const navItem = document.querySelector(`#erpNav .erp-nav-item[data-tab="${tab}"]`);
  if (navItem) navItem.classList.add('active');
  if (tab === 'sale') renderSaleOrders();
  else if (tab === 'purchase') renderPurchaseOrders();
  else if (tab === 'inventory') renderInventory();
  else if (tab === 'contacts') renderContacts();
  else if (tab === 'bills') renderBills();
  else if (tab === 'dashboard') renderDashboard();
}

// ============================================================
// 看板
// ============================================================

async function renderDashboard() {
  const body = document.getElementById('erpBody');
  const data = await erpFetch('/accounts');
  _erpDashboard = data;
  body.innerHTML = `
    <div class="erp-dashboard">
      <div class="erp-dash-cards">
        <div class="erp-dash-card income"><div class="erp-dash-val">¥${data.today_income?.toFixed(2) || '0.00'}</div><div class="erp-dash-label">今日收入</div></div>
        <div class="erp-dash-card expense"><div class="erp-dash-val">¥${data.today_expense?.toFixed(2) || '0.00'}</div><div class="erp-dash-label">今日支出</div></div>
        <div class="erp-dash-card ar"><div class="erp-dash-val">¥${data.total_ar?.toFixed(2) || '0.00'}</div><div class="erp-dash-label">应收总额</div></div>
        <div class="erp-dash-card ap"><div class="erp-dash-val">¥${data.total_ap?.toFixed(2) || '0.00'}</div><div class="erp-dash-label">应付总额</div></div>
      </div>
      <h4 style="margin:16px 0 8px">账户余额</h4>
      <div class="erp-dash-cards">
        ${(data.accounts || []).map(a => `<div class="erp-dash-card"><div class="erp-dash-val">¥${a.current_balance?.toFixed(2) || '0.00'}</div><div class="erp-dash-label">${a.name}</div></div>`).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// 销售单
// ============================================================

async function renderSaleOrders() {
  const body = document.getElementById('erpBody');
  const data = await erpFetch('/sale-orders?limit=50');
  _erpSaleOrders = data;

  body.innerHTML = `
    <div class="erp-toolbar">
      <input class="erp-search" placeholder="搜索销售单..." oninput="filterErpList('sale')" id="erpSearch">
      <select class="erp-filter" onchange="filterErpList('sale')" id="erpStatusFilter">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="delivered">已出库</option>
        <option value="signed">已签收</option>
        <option value="settled">已结清</option>
      </select>
      <button class="erp-btn primary" onclick="showSaleForm()">+ 开销售单</button>
    </div>
    <div class="erp-list" id="erpSaleList">
      ${(data.orders || []).map(o => `
        <div class="erp-list-item" onclick="viewSaleOrder(${o.id})">
          <div class="erp-item-left">
            <div class="erp-item-title">${o.customer_name || '未知客户'}</div>
            <div class="erp-item-sub">${o.order_no} · ${o.order_date?.slice(0,10)}</div>
          </div>
          <div class="erp-item-right">
            <div class="erp-item-amount">¥${o.total_amount?.toFixed(2)}</div>
            <span class="erp-status erp-status-${o.status}">${statusLabel(o.status)}</span>
          </div>
        </div>
      `).join('') || '<div class="erp-empty">暂无销售单</div>'}
    </div>
  `;
}

async function showSaleForm() {
  const body = document.getElementById('erpBody');
  const products = await erpFetch('/products');
  const contacts = await erpFetch('/contacts?type=customer');
  _erpProducts = Array.isArray(products) ? products : [];
  _erpContacts = Array.isArray(contacts) ? contacts : [];

  body.innerHTML = `
    <div class="erp-form">
      <h4>开销售单</h4>
      <div class="erp-form-row">
        <label>客户</label>
        <select id="saleCustomer"><option value="">选择客户</option>${_erpContacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
      </div>
      <div id="saleItems"><div class="erp-form-row">
        <select class="erp-item-product"><option value="">选择商品</option>${_erpProducts.map(p => `<option value="${p.id}">${p.name} ${p.spec} (¥${p.sale_price})</option>`).join('')}</select>
        <input class="erp-item-qty" type="number" value="1" min="1" placeholder="数量">
        <input class="erp-item-price" type="number" step="0.01" placeholder="单价">
        <button class="erp-btn" onclick="addSaleItem()">+</button>
      </div></div>
      <div class="erp-form-row">
        <label>折扣</label><input type="number" id="saleDiscount" value="0" step="0.01">
        <label>备注</label><input type="text" id="saleNote" placeholder="备注">
      </div>
      <div class="erp-form-actions">
        <button class="erp-btn" onclick="switchErpTab('sale')">取消</button>
        <button class="erp-btn primary" onclick="submitSaleOrder()">保存草稿</button>
      </div>
    </div>
  `;
}

function addSaleItem() {
  const container = document.getElementById('saleItems');
  const row = document.createElement('div');
  row.className = 'erp-form-row';
  row.innerHTML = `
    <select class="erp-item-product">${document.querySelector('.erp-item-product')?.innerHTML || ''}</select>
    <input class="erp-item-qty" type="number" value="1" min="1" placeholder="数量">
    <input class="erp-item-price" type="number" step="0.01" placeholder="单价">
    <button class="erp-btn" onclick="this.parentElement.remove()">-</button>
  `;
  container.appendChild(row);
}

async function submitSaleOrder() {
  const customer_id = parseInt(document.getElementById('saleCustomer').value);
  if (!customer_id) return alert('请选择客户');

  const items = [];
  document.querySelectorAll('#saleItems .erp-form-row').forEach(row => {
    const productSelect = row.querySelector('.erp-item-product');
    const qtyInput = row.querySelector('.erp-item-qty');
    const priceInput = row.querySelector('.erp-item-price');
    const product_id = parseInt(productSelect?.value);
    const quantity = parseInt(qtyInput?.value) || 0;
    const unit_price = parseFloat(priceInput?.value) || 0;
    if (product_id && quantity > 0 && unit_price > 0) {
      items.push({ product_id, quantity, unit_price });
    }
  });
  if (items.length === 0) return alert('请添加商品');

  const discount = parseFloat(document.getElementById('saleDiscount')?.value) || 0;
  const note = document.getElementById('saleNote')?.value || '';

  const r = await erpFetch('/sale-orders', {
    method: 'POST',
    body: { customer_id, items, discount, note }
  });
  if (r.success) {
    switchErpTab('sale');
  } else {
    alert('创建失败: ' + (r.error || ''));
  }
}

async function viewSaleOrder(orderId) {
  const body = document.getElementById('erpBody');
  const data = await erpFetch(`/sale-orders/${orderId}`);
  if (!data || data.error) return alert('找不到订单');
  const o = data.order;
  const items = data.items || [];
  body.innerHTML = `
    <div class="erp-detail">
      <button class="erp-btn" onclick="switchErpTab('sale')">← 返回</button>
      <h4>${o.order_no}</h4>
      <p>客户: ${o.customer_name} | 日期: ${o.order_date?.slice(0,10)} | 状态: ${statusLabel(o.status)}</p>
      <table class="erp-table"><tr><th>商品</th><th>数量</th><th>单价</th><th>金额</th></tr>
        ${items.map(it => `<tr><td>${it.product_name} ${it.spec || ''}</td><td>${it.quantity}${it.unit || ''}</td><td>¥${it.unit_price?.toFixed(2)}</td><td>¥${it.amount?.toFixed(2)}</td></tr>`).join('')}
      </table>
      <p style="margin-top:8px">合计: <strong>¥${o.total_amount?.toFixed(2)}</strong> | 折扣: ¥${o.discount?.toFixed(2) || '0.00'} | 已收: ¥${o.received_amount?.toFixed(2) || '0.00'}</p>
      ${o.status === 'draft' ? `<button class="erp-btn primary" onclick="deliverSaleOrder(${o.id})">确认出库</button>` : ''}
      ${o.status === 'delivered' ? `<button class="erp-btn primary" onclick="signSaleOrder(${o.id})">确认签收</button><button class="erp-btn" onclick="erpReceivePayment('ar','sale',${o.id},${o.customer_id},${o.total_amount - o.received_amount})">收款</button>` : ''}
      ${o.status === 'signed' ? `<button class="erp-btn" onclick="erpReceivePayment('ar','sale',${o.id},${o.customer_id},${o.total_amount - o.received_amount})">收款</button>` : ''}
    </div>
  `;
}

async function deliverSaleOrder(id) {
  const r = await erpFetch(`/sale-orders/${id}/deliver`, { method: 'POST' });
  if (r.success) viewSaleOrder(id);
  else alert(r.error);
}

async function signSaleOrder(id) {
  const r = await erpFetch(`/sale-orders/${id}/sign`, { method: 'POST' });
  if (r.success) viewSaleOrder(id);
  else alert(r.error);
}

// ============================================================
// 采购单
// ============================================================

async function renderPurchaseOrders() {
  const body = document.getElementById('erpBody');
  const data = await erpFetch('/purchase-orders?limit=50');
  _erpPurchaseOrders = data;

  body.innerHTML = `
    <div class="erp-toolbar">
      <input class="erp-search" placeholder="搜索采购单..." oninput="filterErpList('purchase')" id="erpSearch">
      <button class="erp-btn primary" onclick="showPurchaseForm()">+ 采购入库</button>
    </div>
    <div class="erp-list">
      ${(data.orders || []).map(o => `
        <div class="erp-list-item" onclick="viewPurchaseOrder(${o.id})">
          <div class="erp-item-left">
            <div class="erp-item-title">${o.supplier_name || '未知供应商'}</div>
            <div class="erp-item-sub">${o.order_no} · ${o.order_date?.slice(0,10)}</div>
          </div>
          <div class="erp-item-right">
            <div class="erp-item-amount">¥${o.total_amount?.toFixed(2)}</div>
            <span class="erp-status erp-status-${o.status}">${statusLabel(o.status)}</span>
          </div>
        </div>
      `).join('') || '<div class="erp-empty">暂无采购单</div>'}
    </div>
  `;
}

async function showPurchaseForm() {
  const body = document.getElementById('erpBody');
  const products = await erpFetch('/products');
  const contacts = await erpFetch('/contacts?type=supplier');
  _erpProducts = Array.isArray(products) ? products : [];
  const suppliers = Array.isArray(contacts) ? contacts : [];

  body.innerHTML = `
    <div class="erp-form">
      <h4>采购入库</h4>
      <div class="erp-form-row">
        <label>供应商</label>
        <select id="purchaseSupplier"><option value="">选择供应商</option>${suppliers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
      </div>
      <div id="purchaseItems"><div class="erp-form-row">
        <select class="erp-item-product"><option value="">选择商品</option>${_erpProducts.map(p => `<option value="${p.id}">${p.name} ${p.spec} (进价¥${p.purchase_price})</option>`).join('')}</select>
        <input class="erp-item-qty" type="number" value="1" min="1" placeholder="数量">
        <input class="erp-item-price" type="number" step="0.01" placeholder="进价">
        <button class="erp-btn" onclick="addPurchaseItem()">+</button>
      </div></div>
      <div class="erp-form-row"><label>备注</label><input type="text" id="purchaseNote" placeholder="备注"></div>
      <div class="erp-form-actions">
        <button class="erp-btn" onclick="switchErpTab('purchase')">取消</button>
        <button class="erp-btn primary" onclick="submitPurchaseOrder()">保存并入库</button>
      </div>
    </div>
  `;
}

function addPurchaseItem() {
  const container = document.getElementById('purchaseItems');
  const row = document.createElement('div');
  row.className = 'erp-form-row';
  row.innerHTML = `
    <select class="erp-item-product">${document.querySelector('.erp-item-product')?.innerHTML || ''}</select>
    <input class="erp-item-qty" type="number" value="1" min="1" placeholder="数量">
    <input class="erp-item-price" type="number" step="0.01" placeholder="进价">
    <button class="erp-btn" onclick="this.parentElement.remove()">-</button>
  `;
  container.appendChild(row);
}

async function submitPurchaseOrder() {
  const supplier_id = parseInt(document.getElementById('purchaseSupplier').value);
  if (!supplier_id) return alert('请选择供应商');

  const items = [];
  document.querySelectorAll('#purchaseItems .erp-form-row').forEach(row => {
    const productSelect = row.querySelector('.erp-item-product');
    const qtyInput = row.querySelector('.erp-item-qty');
    const priceInput = row.querySelector('.erp-item-price');
    const product_id = parseInt(productSelect?.value);
    const quantity = parseInt(qtyInput?.value) || 0;
    const unit_price = parseFloat(priceInput?.value) || 0;
    if (product_id && quantity > 0 && unit_price > 0) {
      items.push({ product_id, quantity, unit_price });
    }
  });
  if (items.length === 0) return alert('请添加商品');

  const note = document.getElementById('purchaseNote')?.value || '';
  const r = await erpFetch('/purchase-orders', {
    method: 'POST',
    body: { supplier_id, items, note }
  });
  if (r.success) {
    // 直接确认入库
    await erpFetch(`/purchase-orders/${r.order_id}/confirm`, { method: 'POST' });
    switchErpTab('purchase');
  } else {
    alert('创建失败: ' + (r.error || ''));
  }
}

async function viewPurchaseOrder(orderId) {
  const body = document.getElementById('erpBody');
  const data = await erpFetch(`/purchase-orders/${orderId}`);
  if (!data || data.error) return alert('找不到订单');
  const o = data.order;
  const items = data.items || [];
  body.innerHTML = `
    <div class="erp-detail">
      <button class="erp-btn" onclick="switchErpTab('purchase')">← 返回</button>
      <h4>${o.order_no}</h4>
      <p>供应商: ${o.supplier_name} | 日期: ${o.order_date?.slice(0,10)} | 状态: ${statusLabel(o.status)}</p>
      <table class="erp-table"><tr><th>商品</th><th>数量</th><th>单价</th><th>金额</th></tr>
        ${items.map(it => `<tr><td>${it.product_name} ${it.spec || ''}</td><td>${it.quantity}${it.unit || ''}</td><td>¥${it.unit_price?.toFixed(2)}</td><td>¥${it.amount?.toFixed(2)}</td></tr>`).join('')}
      </table>
      <p style="margin-top:8px">合计: <strong>¥${o.total_amount?.toFixed(2)}</strong> | 已付: ¥${o.paid_amount?.toFixed(2) || '0.00'}</p>
      ${o.status === 'received' && o.paid_amount < o.total_amount ? `<button class="erp-btn" onclick="erpReceivePayment('ap','purchase',${o.id},${o.supplier_id},${o.total_amount - o.paid_amount})">付款</button>` : ''}
      ${o.status === 'draft' ? `<button class="erp-btn primary" onclick="confirmPurchaseOrder(${o.id})">确认入库</button>` : ''}
    </div>
  `;
}

async function confirmPurchaseOrder(id) {
  const r = await erpFetch(`/purchase-orders/${id}/confirm`, { method: 'POST' });
  if (r.success) viewPurchaseOrder(id);
  else alert(r.error);
}

// ============================================================
// 库存
// ============================================================

async function renderInventory() {
  const body = document.getElementById('erpBody');
  const data = await erpFetch('/inventory');
  _erpInventory = Array.isArray(data) ? data : [];

  body.innerHTML = `
    <div class="erp-toolbar">
      <input class="erp-search" placeholder="搜索商品..." oninput="filterErpList('inventory')" id="erpSearch">
      <label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="checkbox" onchange="renderInventory()" id="erpLowStockOnly"> 仅显示库存预警</label>
      <button class="erp-btn" onclick="showProductForm()">+ 商品</button>
    </div>
    <div class="erp-list">
      ${_erpInventory.map(inv => `
        <div class="erp-list-item ${inv.quantity <= inv.safety_stock && inv.safety_stock > 0 ? 'erp-warn' : ''}">
          <div class="erp-item-left">
            <div class="erp-item-title">${inv.name} <span style="font-size:12px;color:var(--text-secondary)">${inv.spec || ''} ${inv.unit || ''}</span></div>
            <div class="erp-item-sub">${inv.brand || ''} · ${inv.category || ''} · 进价¥${inv.purchase_price?.toFixed(2)} · 售价¥${inv.sale_price?.toFixed(2)}</div>
          </div>
          <div class="erp-item-right">
            <div class="erp-item-amount" style="color:${inv.quantity <= inv.safety_stock ? 'var(--red)' : 'inherit'}">${inv.quantity} ${inv.unit || '件'}</div>
            ${inv.quantity <= inv.safety_stock && inv.safety_stock > 0 ? '<span class="erp-status erp-status-draft">低于安全库存</span>' : ''}
          </div>
        </div>
      `).join('') || '<div class="erp-empty">暂无库存</div>'}
    </div>
  `;
}

function showProductForm() {
  const body = document.getElementById('erpBody');
  body.innerHTML = `
    <div class="erp-form">
      <h4>新增商品</h4>
      <div class="erp-form-row"><label>名称</label><input id="prodName" placeholder="商品名称"></div>
      <div class="erp-form-row"><label>规格</label><input id="prodSpec" placeholder="规格"></div>
      <div class="erp-form-row"><label>单位</label><input id="prodUnit" value="件"></div>
      <div class="erp-form-row"><label>品牌</label><input id="prodBrand" placeholder="品牌"></div>
      <div class="erp-form-row"><label>分类</label><input id="prodCategory" placeholder="分类"></div>
      <div class="erp-form-row"><label>进价</label><input id="prodPurchasePrice" type="number" step="0.01"></div>
      <div class="erp-form-row"><label>售价</label><input id="prodSalePrice" type="number" step="0.01"></div>
      <div class="erp-form-row"><label>安全库存</label><input id="prodSafetyStock" type="number" value="0"></div>
      <div class="erp-form-actions">
        <button class="erp-btn" onclick="switchErpTab('inventory')">取消</button>
        <button class="erp-btn primary" onclick="submitProduct()">保存</button>
      </div>
    </div>
  `;
}

async function submitProduct() {
  const data = {
    name: document.getElementById('prodName')?.value || '',
    spec: document.getElementById('prodSpec')?.value || '',
    unit: document.getElementById('prodUnit')?.value || '件',
    brand: document.getElementById('prodBrand')?.value || '',
    category: document.getElementById('prodCategory')?.value || '',
    purchase_price: parseFloat(document.getElementById('prodPurchasePrice')?.value) || 0,
    sale_price: parseFloat(document.getElementById('prodSalePrice')?.value) || 0,
    safety_stock: parseInt(document.getElementById('prodSafetyStock')?.value) || 0,
  };
  if (!data.name) return alert('请输入商品名称');
  const r = await erpFetch('/products', { method: 'POST', body: data });
  if (r.success) switchErpTab('inventory');
  else alert('创建失败');
}

// ============================================================
// 客户/供应商
// ============================================================

async function renderContacts() {
  const body = document.getElementById('erpBody');
  const contacts = await erpFetch('/contacts');
  _erpContacts = Array.isArray(contacts) ? contacts : [];

  body.innerHTML = `
    <div class="erp-toolbar">
      <input class="erp-search" placeholder="搜索..." oninput="filterErpList('contacts')" id="erpSearch">
      <select class="erp-filter" onchange="filterErpList('contacts')" id="erpContactType"><option value="">全部</option><option value="customer">客户</option><option value="supplier">供应商</option></select>
      <button class="erp-btn primary" onclick="showContactForm()">+ 新增</button>
    </div>
    <div class="erp-list">
      ${_erpContacts.map(c => `
        <div class="erp-list-item" onclick="viewContact(${c.id})">
          <div class="erp-item-left">
            <div class="erp-item-title">${c.name} <span class="erp-contact-type">${c.type === 'supplier' ? '供应商' : c.type === 'both' ? '客户/供应商' : '客户'}</span></div>
            <div class="erp-item-sub">${c.phone || ''} · ${c.settlement_method || ''}${c.credit_days ? ' ' + c.credit_days + '天' : ''}</div>
          </div>
        </div>
      `).join('') || '<div class="erp-empty">暂无联系人</div>'}
    </div>
  `;
}

function showContactForm() {
  const body = document.getElementById('erpBody');
  body.innerHTML = `
    <div class="erp-form">
      <h4>新增客户/供应商</h4>
      <div class="erp-form-row"><label>类型</label><select id="contactType"><option value="customer">客户</option><option value="supplier">供应商</option><option value="both">两者都是</option></select></div>
      <div class="erp-form-row"><label>名称</label><input id="contactName" placeholder="名称"></div>
      <div class="erp-form-row"><label>电话</label><input id="contactPhone" placeholder="电话"></div>
      <div class="erp-form-row"><label>地址</label><input id="contactAddr" placeholder="地址"></div>
      <div class="erp-form-row"><label>结算方式</label><select id="contactSettle"><option value="现结">现结</option><option value="赊账">赊账</option><option value="账期">账期</option></select></div>
      <div class="erp-form-row"><label>账期天数</label><input id="contactCreditDays" type="number" value="0"></div>
      <div class="erp-form-actions">
        <button class="erp-btn" onclick="switchErpTab('contacts')">取消</button>
        <button class="erp-btn primary" onclick="submitContact()">保存</button>
      </div>
    </div>
  `;
}

async function submitContact() {
  const data = {
    name: document.getElementById('contactName')?.value || '',
    type: document.getElementById('contactType')?.value || 'customer',
    phone: document.getElementById('contactPhone')?.value || '',
    address: document.getElementById('contactAddr')?.value || '',
    settlement_method: document.getElementById('contactSettle')?.value || '现结',
    credit_days: parseInt(document.getElementById('contactCreditDays')?.value) || 0,
  };
  if (!data.name) return alert('请输入名称');
  const r = await erpFetch('/contacts', { method: 'POST', body: data });
  if (r.success) switchErpTab('contacts');
  else alert('创建失败');
}

async function viewContact(id) {
  const body = document.getElementById('erpBody');
  const c = await erpFetch(`/contacts/${id}`);
  if (!c || c.error) return alert('找不到');
  body.innerHTML = `
    <div class="erp-detail">
      <button class="erp-btn" onclick="switchErpTab('contacts')">← 返回</button>
      <h4>${c.name}</h4>
      <p>类型: ${c.type === 'supplier' ? '供应商' : c.type === 'both' ? '客户/供应商' : '客户'}</p>
      <p>电话: ${c.phone || '-'} | 地址: ${c.address || '-'}</p>
      <p>结算: ${c.settlement_method} ${c.credit_days ? c.credit_days + '天' : ''}</p>
      ${c.receivable ? `<p>欠款: <strong>¥${c.receivable.balance?.toFixed(2) || '0.00'}</strong> (${c.receivable.count || 0}笔)</p>` : ''}
    </div>
  `;
}

// ============================================================
// 账单
// ============================================================

async function renderBills() {
  const body = document.getElementById('erpBody');
  const data = await erpFetch('/receivables?limit=50');
  _erpReceivables = data;

  body.innerHTML = `
    <div class="erp-toolbar">
      <select class="erp-filter" onchange="filterErpList('bills')" id="erpBillType">
        <option value="">全部</option><option value="ar">应收</option><option value="ap">应付</option>
      </select>
      <select class="erp-filter" onchange="filterErpList('bills')" id="erpBillStatus">
        <option value="">全部状态</option><option value="unpaid">未结</option><option value="partial">部分结</option><option value="paid">已结</option>
      </select>
    </div>
    <div class="erp-list">
      ${(data.receivables || []).map(r => `
        <div class="erp-list-item">
          <div class="erp-item-left">
            <div class="erp-item-title">${r.contact_name || '-'} <span class="erp-contact-type">${r.type === 'ar' ? '应收' : '应付'}</span></div>
            <div class="erp-item-sub">${r.ref_type || ''} · ${r.created_at?.slice(0,10)}</div>
          </div>
          <div class="erp-item-right">
            <div class="erp-item-amount">¥${r.amount?.toFixed(2)}</div>
            <div style="font-size:12px;color:var(--text-secondary)">已收 ¥${r.paid_amount?.toFixed(2)} · ${statusLabel(r.status)}</div>
          </div>
        </div>
      `).join('') || '<div class="erp-empty">暂无账单</div>'}
    </div>
  `;
}

// ============================================================
// 收款/付款弹窗
// ============================================================

async function erpReceivePayment(type, refType, refId, contactId, maxAmount) {
  const amount = prompt(`请输入${type === 'ar' ? '收款' : '付款'}金额（最大 ¥${maxAmount?.toFixed(2)}）:`, maxAmount?.toFixed(2));
  if (!amount) return;
  const r = await erpFetch('/payments', {
    method: 'POST',
    body: {
      contact_id: contactId,
      amount: parseFloat(amount),
      pay_type: type,
      ref_type: refType,
      ref_id: refId
    }
  });
  if (r.success) {
    alert('操作成功');
    switchErpTab(_erpTab); // 刷新当前页面
  } else {
    alert('操作失败');
  }
}

// ============================================================
// 工具函数
// ============================================================

function statusLabel(s) {
  const map = {
    draft: '草稿', confirmed: '已确认', received: '已入库', delivered: '已出库',
    signed: '已签收', settled: '已结清', cancelled: '已取消',
    unpaid: '未结', partial: '部分结', paid: '已结'
  };
  return map[s] || s;
}

function filterErpList(type) {
  // 简单前端筛选——后续可改为后端分页
  const q = (document.getElementById('erpSearch')?.value || '').toLowerCase();
  document.querySelectorAll(`#erp${type.charAt(0).toUpperCase()+type.slice(1)}List .erp-list-item, #erpSaleList .erp-list-item`).forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = q && !text.includes(q) ? 'none' : '';
  });
}

// ============================================================
// ERP HTML 模板
// ============================================================

const ERP_HTML = `
<div style="display:flex;flex:1;overflow:hidden;">
  <div class="sidebar" id="erpNav" style="width:120px;min-width:120px;padding-top:12px;">
    <div class="sidebar-item erp-nav-item active" data-tab="dashboard" onclick="switchErpTab('dashboard')">📊 看板</div>
    <div class="sidebar-item erp-nav-item" data-tab="sale" onclick="switchErpTab('sale')">📝 销售</div>
    <div class="sidebar-item erp-nav-item" data-tab="purchase" onclick="switchErpTab('purchase')">📦 进货</div>
    <div class="sidebar-item erp-nav-item" data-tab="inventory" onclick="switchErpTab('inventory')">🏪 库存</div>
    <div class="sidebar-item erp-nav-item" data-tab="contacts" onclick="switchErpTab('contacts')">👥 客户</div>
    <div class="sidebar-item erp-nav-item" data-tab="bills" onclick="switchErpTab('bills')">💰 账单</div>
  </div>
  <div style="flex:1;overflow-y:auto;padding:16px;" id="erpBody">
    <div class="erp-empty">加载中...</div>
  </div>
</div>`;
