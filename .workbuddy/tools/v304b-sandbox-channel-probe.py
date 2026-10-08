#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v304b 只读探针：ERP 在**服务的沙箱命名空间里**能不能读到租户企微凭据。

为什么必须先验这一条：`_push_tenant_channels` 的分叉完全取决于
`ht.enabled_channels(tid)` 是否非空 ——
  · 非空 ⇒ 走租户自己的 Hermes 凭据（企微智能机器人）出站
  · 为空 ⇒ 回落**全局 webhook**（生产未配置）⇒ 静默什么都不发
所以「读得到 / 读不到」直接决定「提醒能不能到人」。

⚠️ 本探针**只读**：不发送、不写文件、不打印任何密钥值（只报「有没有」）。
"""
import sys

sys.path.insert(0, "/opt/hergent-erp")

try:
    import hermes_tenants as ht
except Exception as e:
    print("IMPORT_FAIL: %s: %s" % (type(e).__name__, e))
    sys.exit(2)

print("available():", ht.available())
print("TENANTS_ROOT:", ht.TENANTS_ROOT)
print()

for tid in (1, 10):
    print("=== tenant=%s ===" % tid)
    home = ht.home_for(tid)
    envfile = home / ".env"
    readable = "?"
    try:
        with open(str(envfile), "rb") as f:
            readable = "可读（%d 字节）" % len(f.read())
    except Exception as e:
        readable = "读不到: %s: %s" % (type(e).__name__, e)
    print("  home      :", home)
    print("  .env      :", "存在" if envfile.exists() else "不存在", "|", readable)

    try:
        chans = ht.enabled_channels(tid)
        print("  enabled_channels -> %r" % (chans,))
    except Exception as e:
        print("  enabled_channels -> ERR %s: %s" % (type(e).__name__, e))
        chans = []

    try:
        creds = ht.read_credentials(tid)
        shape = {c: {k: bool(v) for k, v in d.items()} for c, d in creds.items()}
        print("  read_credentials(字段非空?) -> %r" % (shape,))
    except Exception as e:
        print("  read_credentials -> ERR %s: %s" % (type(e).__name__, e))

    print("  ⇒ 推送走向:", "租户企微通道" if chans else "全局 webhook（未配置 ⇒ 不会发出）")
    print()
