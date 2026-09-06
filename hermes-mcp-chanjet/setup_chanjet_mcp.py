#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
步骤 4：把畅捷通 MCP server 注入 Hermes config.yaml（Hergent 副驾 × 畅捷通数据源）

支持两种接入路线：
  路线 A（官方 CJTMSP-MCP）：用 MCP 市场生成的配置 URL + 客户授权后的 MCP Key
  路线 B（自托管 cjt2mcp）：Docker 自托管，每客户独立 MCP Key（多租户友好）

用法：
  # 路线 A：把 key 走环境变量（推荐，避免明文落盘）
  python3 setup_chanjet_mcp.py --route A --name chanjet \
      --url "https://mcphub-admin.static.chanjet.com/.../mcp" \
      --env-var CHANJET_MCP_KEY

  # 路线 B：自托管，多租户（每个客户一个 server 名）
  python3 setup_chanjet_mcp.py --route B --name chanjet_acme \
      --url "https://mcp.your-host.com/acme/mcp" \
      --api-key "ck_live_xxx"

  # 只预览要注入的 YAML 片段，不改文件
  python3 setup_chanjet_mcp.py --route A --name chanjet --url "..." --dry-run

依赖：PyYAML。若当前 python 没有，脚本会自动用 Hermes 的 venv python 重跑。
"""
import os
import sys
import shutil
import datetime
import argparse

# PyYAML 自检：没有就自动用 Hermes venv 重跑
try:
    import yaml
except ImportError:
    _HERMES_PY = "/Users/zhangjunfeng/.hermes/hermes-agent/venv/bin/python"
    if os.path.exists(_HERMES_PY):
        os.execv(_HERMES_PY, [_HERMES_PY] + sys.argv)
    sys.stderr.write("缺少 PyYAML：请用 `pip install pyyaml` 或 Hermes 的 venv python 运行。\n")
    sys.exit(2)

DEFAULT_CONFIG = os.path.expanduser("~/.hermes/config.yaml")

# 写操作关键词黑名单（tools.exclude）：默认只放行读类工具，避免 MCP 误触发写/删/提交。
# 畅捷通 MCP 工具名尚未公开，这里用通用业务动词兜底；验证后用 include 精细控制更安全。
WRITE_TOOL_PATTERNS = [
    "create", "add", "new", "insert", "save", "update", "edit", "modify",
    "submit", "audit", "approve", "delete", "remove", "cancel", "void",
    "revoke", "post", "book", "push", "sync", "send", "transfer",
    "pay", "refund", "close", "import",
]


def build_server(args):
    server = {"url": args.url, "headers": {}}
    if args.api_key:
        server["headers"]["Authorization"] = f"Bearer {args.api_key}"
    else:
        server["headers"]["Authorization"] = f"Bearer ${{{args.env_var}}}"
    if args.exclude_write_tools:
        server["tools"] = {"exclude": WRITE_TOOL_PATTERNS}
    return server


def main():
    p = argparse.ArgumentParser(description="注入畅捷通 MCP server 到 Hermes config")
    p.add_argument("--config-path", default=DEFAULT_CONFIG, help="Hermes config.yaml 路径")
    p.add_argument("--route", choices=["A", "B"], default="A", help="A=官方CJTMCP / B=自托管cjt2mcp")
    p.add_argument("--name", default="chanjet", help="server 名（多租户用 chanjet_<客户> 区分）")
    p.add_argument("--url", required=True, help="MCP server 的 URL（streamable-http）")
    p.add_argument("--api-key", help="MCP Key 明文（不推荐，优先用 --env-var）")
    p.add_argument("--env-var", default="CHANJET_MCP_KEY", help="把 key 写成 ${ENV_VAR}，从 .env 读取")
    p.add_argument("--exclude-write-tools", dest="exclude_write_tools", action="store_true", default=True)
    p.add_argument("--no-exclude-write-tools", dest="exclude_write_tools", action="store_false")
    p.add_argument("--dry-run", action="store_true", help="只打印待注入片段，不修改文件")
    args = p.parse_args()

    if not os.path.exists(args.config_path):
        p.error(f"config 不存在：{args.config_path}")

    with open(args.config_path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}

    server = build_server(args)
    mcp = cfg.get("mcp_servers") or {}
    if args.name in mcp and not args.dry_run:
        print(f"⚠️  mcp_servers.{args.name} 已存在，将被覆盖。原值：")
        print(f"    {mcp[args.name]}")
    mcp[args.name] = server
    cfg["mcp_servers"] = mcp

    fragment = yaml.safe_dump(
        {"mcp_servers": {args.name: server}}, allow_unicode=True, sort_keys=False
    )

    if args.dry_run:
        print("# ── 待注入的 config 片段（dry-run，未修改文件）──")
        print(fragment)
        print(f"# 写入后执行：hermes mcp test {args.name}")
        return

    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = f"{args.config_path}.bak-chanjet-{ts}"
    shutil.copy(args.config_path, bak)

    with open(args.config_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

    print(f"✅ 已注入 mcp_servers.{args.name}（路线 {args.route}）到 {args.config_path}")
    print(f"   备份：{bak}")
    print(f"   下一步：")
    print(f"     1) 若用 --env-var，把真实 MCP Key 写入 ~/.hermes/.env 的 {args.env_var}=")
    print(f"     2) hermes mcp test {args.name}")
    print(f"     3) hermes mcp configure {args.name}  # 用 include 只放行读工具")
    print(f"     4) 跑验证：python3 verify_and_scenario.py verify --server {args.name}")


if __name__ == "__main__":
    main()
