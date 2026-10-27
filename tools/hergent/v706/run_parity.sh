#!/bin/sh
# DDL 对账一键跑（全程只读，不改库、不改代码）。
#
# 为什么要有它：对账要三步（抽代码 DDL → dump 真实库 → 比对），命令记不住，
# 少跑一步就得到一份看着正常、实则只比了一半的结论。
#
# 用法：
#   cd /opt/hergent-erp && sh tools/ddl_parity/run_parity.sh
#   TENANTS="tenant_1.db tenant_10.db" sh tools/ddl_parity/run_parity.sh   # 指定租户库
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
TENANTS=${TENANTS:-"tenant_1.db tenant_10.db"}
OUT=${OUT:-/tmp/ddl_parity}
mkdir -p "$OUT"

echo "[1/3] 抽代码里声明的 DDL（跳过 tools/tests 等探针目录）"
python3 tools/ddl_parity/extract_ddl_schema.py . -o "$OUT/ddl.json" | head -3

echo "[2/3] dump 真实库（只读打开）"
python3 tools/ddl_parity/dump_db_schema.py -o "$OUT/schema_dump.json" erp.db $TENANTS

echo "[3/3] 对账"
python3 tools/ddl_parity/check_ddl_parity.py \
    --ddl "$OUT/ddl.json" --schema "$OUT/schema_dump.json"
