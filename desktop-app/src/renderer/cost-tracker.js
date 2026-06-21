// Hergent Desktop — Cost Tracking
// Extracted from app.js Phase 2
// 费用预估：基于历史消息的平均消耗
function _recordMessageCost(cost, model) {
  if (!cost || cost <= 0) return;
  try {
    const records = JSON.parse(localStorage.getItem('hermes_cost_records') || '[]');
    records.push({ cost, model: model || 'deepseek-v4-flash', time: Date.now() });
    if (records.length > 100) records.splice(0, records.length - 100);
    localStorage.setItem('hermes_cost_records', JSON.stringify(records));
    // 同时维护简单数组用于平均计算
    const costs = JSON.parse(localStorage.getItem('hermes_msg_costs') || '[]');
    costs.push(cost);
    if (costs.length > 50) costs.shift();
    localStorage.setItem('hermes_msg_costs', JSON.stringify(costs));
  } catch (_) {}
}

function _getAvgCost() {
  try {
    const costs = JSON.parse(localStorage.getItem('hermes_msg_costs') || '[]');
    if (costs.length === 0) return null;
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    const low = Math.max(1, Math.floor(avg * 0.4));
    const high = Math.max(2, Math.ceil(avg * 1.6));
    return { low, high };
  } catch (_) { return null; }
}

function updateCostEstimate() {
  const el = document.getElementById('costEstimate');
  if (!el) return;
  const avg = _getAvgCost();
  if (avg) {
    document.getElementById('costEstimateNum').textContent = `${avg.low}-${avg.high}`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}



