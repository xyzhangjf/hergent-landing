#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
步骤 6（验证数据可读）+ 步骤 7（跑通低温奶场景）

子命令：
  verify    测连接 + 三条只读查询（库存临期 / 应收逾期 / 销售单）
  scenario  跑低温奶副驾场景（临期 / 货损 / 下趟车预报建议）

用法：
  python3 verify_and_scenario.py verify   --server chanjet
  python3 verify_and_scenario.py scenario --server chanjet

说明：
  - 通过 subprocess 调 `hermes` CLI（默认 /Users/zhangjunfeng/.local/bin/hermes，可用 --hermes-bin 覆盖）。
  - Hermes 在会话启动时自动加载 config 里的 mcp_servers 工具；若工具没出现，执行 `hermes mcp test <server>` 或重启 gateway。
  - 必须先完成步骤 4（注入 MCP）且畅捷通侧已完成客户授权（步骤 5）。
"""
import argparse
import subprocess
import sys

DEFAULT_HERMES = "/Users/zhangjunfeng/.local/bin/hermes"

# 步骤 6：三条只读查询模板（自然语言，让 Hermes 自己选 MCP 工具）
VERIFY_QUERIES = [
    ("库存·临期", "请仅使用已连接的畅捷通(好生意/T+) MCP 工具，做只读查询："
                  "列出当前库存中距离保质期不足 15 天的商品（品名、批号、数量、到期日）。"
                  "不要做任何写操作。若工具不可用请直接说明。"),
    ("应收·逾期", "请仅使用畅捷通 MCP 工具，做只读查询："
                  "列出当前已到收款日但尚未收回的应收单据（客户、金额、到期日、逾期天数）。"
                  "不要做任何写操作。"),
    ("销售·近7天", "请仅使用畅捷通 MCP 工具，做只读查询："
                   "列出最近 7 天的销售出库单（单据号、客户、金额、日期）。"
                   "不要做任何写操作。"),
]

# 步骤 7：低温奶副驾场景
SCENARIO_PROMPT = """你是低温奶经销商的 AI 经营副驾。请使用已连接的畅捷通（好生意/T+）真实数据，结合低温奶行业经验，回答三个问题。只做分析建议，绝不擅自下单或改写任何数据：

1. 临期预警：本周（未来 7 天）有哪些商品将临期（距保质期不足 7 天）？列出品名、批号、数量、到期日、按进价估算的预计货损金额。
2. 货损风险：当前库存里哪些品类货损风险最高？给出一个货损金额估算区间，并说明依据（保质期、周转率）。
3. 下趟车预报：基于近期销量、在途库存、临期情况，建议这趟订货订哪些品、各订多少，目标是既不断货也不积压临期。

用经销商老板能看懂的中文输出，结论先讲重点。"""


def run_hermes(hermes_bin, args_list, timeout=120):
    cmd = [hermes_bin] + args_list
    print(f"\n$ {' '.join(cmd)}\n" + "─" * 60)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print("⏱  超时（可能首连 MCP 较慢或模型响应长），可加大 --timeout。")
        return 1
    if r.stdout:
        print(r.stdout)
    if r.stderr:
        print("[stderr]", r.stderr)
    return r.returncode


def cmd_verify(args):
    srv = args.server
    # 1) 连接测试
    rc = run_hermes(args.hermes_bin, ["mcp", "test", srv], timeout=60)
    if rc != 0:
        print(f"❌ mcp test 失败，请先执行步骤 4/5。server={srv}")
        return rc
    # 2) 三条只读查询
    for label, q in VERIFY_QUERIES:
        print(f"\n{'='*60}\n🔍 验证项：{label}\n{'='*60}")
        run_hermes(args.hermes_bin, ["chat", "-q", q], timeout=args.timeout)
    print(f"\n{'='*60}\n✅ 步骤 6 验证完成：若三项都返回了真实数据，说明副驾已能读畅捷通。\n{'='*60}")
    return 0


def cmd_scenario(args):
    srv = args.server
    print(f"\n🚀 步骤 7 场景：低温奶副驾（server={srv}）")
    run_hermes(args.hermes_bin, ["chat", "-q", SCENARIO_PROMPT], timeout=args.timeout)
    print(f"\n{'='*60}\n✅ 步骤 7 完成：若返回了临期/货损/预报建议，说明配方化算法在真实数据上成立。\n{'='*60}")
    return 0


def main():
    p = argparse.ArgumentParser(description="步骤6验证 + 步骤7场景")
    sub = p.add_subparsers(dest="cmd", required=True)

    pv = sub.add_parser("verify", help="测连接 + 三条只读查询")
    pv.add_argument("--server", default="chanjet")
    pv.add_argument("--hermes-bin", default=DEFAULT_HERMES)
    pv.add_argument("--timeout", type=int, default=120)
    pv.set_defaults(func=cmd_verify)

    ps = sub.add_parser("scenario", help="跑低温奶副驾场景")
    ps.add_argument("--server", default="chanjet")
    ps.add_argument("--hermes-bin", default=DEFAULT_HERMES)
    ps.add_argument("--timeout", type=int, default=180)
    ps.set_defaults(func=cmd_scenario)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
