#!/bin/bash
# v173 接口层真机验证 —— 对隔离沙箱租户 9997 跑，不碰真实租户
BASE="https://hergent.cn"
TOK="faef7940f22e4c84a3568319f8184feadcdacb593f6243b691d364f7a4935e48"
TID="9997"
H_GET=(-s -H "Authorization: Bearer $TOK" -H "X-Tenant-Id: $TID")
H_POST=(-s -H "Authorization: Bearer $TOK" -H "X-Tenant-Id: $TID" -H "Content-Type: application/json")

py() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo "PARSE_ERR"; }

echo "===== A. 月度桶读取（2026-09 应有 2 行）====="
curl "${H_GET[@]}" "$BASE/api/rebate-achievements?month=2026-09" \
  | py "d.get('month'), len(d.get('data') or []), sorted(set(r['period_month'] for r in (d.get('data') or [])))"

echo "===== B. 全年读取（应含 4 行，且 period_month 全为 YYYY-MM）====="
curl "${H_GET[@]}" "$BASE/api/rebate-achievements?year=2026" \
  | py "len(d.get('data') or []), sorted(set(r['period_month'] for r in (d.get('data') or [])))"

echo "===== C. 写入端收口：季度键应 422 ====="
curl "${H_POST[@]}" -w "HTTP=%{http_code} " -o /tmp/v173_c.json \
  -X POST "$BASE/api/rebate-achievements" \
  -d '{"period_month":"2026-Q3","dimension":"brand","scope_key":"__v173probe","scope_name":"v173probe","actual_amount":1}'
cat /tmp/v173_c.json | py "d.get('success'), d.get('error'), (d.get('detail') or '')[:40]"

echo "===== D. 写入端收口：年度键应 422 ====="
curl "${H_POST[@]}" -w "HTTP=%{http_code} " -o /tmp/v173_d.json \
  -X POST "$BASE/api/rebate-achievements" \
  -d '{"period_month":"2026","dimension":"brand","scope_key":"__v173probe","scope_name":"v173probe","actual_amount":1}'
cat /tmp/v173_d.json | py "d.get('success'), d.get('error'), (d.get('detail') or '')[:40]"

echo "===== E. 写入端收口：非法月份字符串应 422 ====="
curl "${H_POST[@]}" -w "HTTP=%{http_code} " -o /tmp/v173_e.json \
  -X POST "$BASE/api/rebate-achievements" \
  -d '{"period_month":"乱写","dimension":"brand","scope_key":"__v173probe","scope_name":"v173probe","actual_amount":1}'
cat /tmp/v173_e.json | py "d.get('success'), d.get('error')"

echo "===== F. 正常月份写入应 200（沙箱内探针行）====="
curl "${H_POST[@]}" -w "HTTP=%{http_code} " -o /tmp/v173_f.json \
  -X POST "$BASE/api/rebate-achievements" \
  -d '{"period_month":"2026-09","dimension":"brand","scope_key":"__v173probe","scope_name":"v173probe","actual_amount":12345,"actual_rebate":999}'
cat /tmp/v173_f.json | py "d.get('success'), (d.get('item') or {}).get('id'), (d.get('item') or {}).get('period_month')"

PID=$(cat /tmp/v173_f.json | py "(d.get('item') or {}).get('id')")
echo "    探针行 id=$PID"

echo "===== G. 省略 period_month 应回落当月（既有便利约定未被破坏）====="
curl "${H_POST[@]}" -w "HTTP=%{http_code} " -o /tmp/v173_g.json \
  -X POST "$BASE/api/rebate-achievements" \
  -d '{"dimension":"brand","scope_key":"__v173probe2","scope_name":"v173probe2","actual_amount":7}'
cat /tmp/v173_g.json | py "d.get('success'), (d.get('item') or {}).get('period_month')"

echo "===== H. 清理探针行 ====="
for id in "$PID"; do
  curl "${H_GET[@]}" -X DELETE "$BASE/api/rebate-achievements/$id" -w "HTTP=%{http_code}\n" -o /dev/null
done
ID2=$(cat /tmp/v173_g.json | py "(d.get('item') or {}).get('id')")
curl "${H_GET[@]}" -X DELETE "$BASE/api/rebate-achievements/$ID2" -w "HTTP=%{http_code}\n" -o /dev/null

echo "===== I. 残留检查（探针行应为 0；非月桶行应为 0）====="
curl "${H_GET[@]}" "$BASE/api/rebate-achievements?year=2026" \
  | py "[r['period_month'] for r in (d.get('data') or []) if 'v173probe' in str(r.get('scope_key'))], sorted(set(r['period_month'] for r in (d.get('data') or [])))"

echo "===== J. 修改日志端点仍可用 ====="
curl "${H_GET[@]}" "$BASE/api/rebate-achievements/audit?limit=3" \
  | py "d.get('total') is not None, len((d.get('items') or []))"
