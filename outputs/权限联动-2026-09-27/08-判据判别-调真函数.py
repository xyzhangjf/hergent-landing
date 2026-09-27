"""v292 取证（合成判别 · 调**真函数**不抄判据）：`custom_roles` 的两种判据在生产数据上分不开。

**为什么需要它**：生产两个租户（tenant_1：2 行 / tenant_10：1 行）**每一行都真的与内置默认不同**
⇒ 「按内容判」与「按行判」在**今天的真实数据上给出相同结果**，所以**不能用生产数据**证明
「按内容判」更好。真正会分开两者的是这个形态：「**保存过权限页** ⇒ 逐角色全量回写 ⇒ 9 个角色都有行，
但其中若干行内容 == 默认」。该形态今天在生产上不存在 ⇒ 只能**合成**。

**为什么可信**：本脚本 `import core` 后**直接调用** `core.custom_roles` / `core.perms_rev`
（并 monkeypatch 掉唯一的取数出口 `_read_custom_perms`）—— 测的是**生产里跑的那个函数**，
不是"我照抄一份判据再来断言"。对照面：同一次输入下，**按行判**会返回什么。

⚠️ 必须先 `source .env`（`core.py` 在 import 期强制要 `ERP_SECRET`，缺了直接 RuntimeError）。
⚠️ 只在**内存里**构造输入，**不写任何库**。
用法：`cd /opt/hergent-erp && set -a && . ./.env && set +a && python3 /tmp/v292-custom-roles-discriminate.py`
"""
import sys

sys.path.insert(0, "/opt/hergent-erp")
import core  # noqa: E402

print("=" * 72)
print("v292 `custom_roles` 判据判别（直接调生产真函数，入参为内存合成）")
print("=" * 72)

DEFAULT_KEYS = sorted(core._DEFAULT_PERMS.keys())
print("内置默认角色集（%d）：%s" % (len(DEFAULT_KEYS), DEFAULT_KEYS))

SYNTH = {}


def feed(table):
    """把合成表塞进 core 唯一的取数出口。"""
    core._read_custom_perms = lambda key=None: table


def by_row(table):
    """对照面：**另一种**判据 —— 「表里有行就算改过」。"""
    return sorted(str(r) for r in (table or {}).keys())


def show(name, table):
    feed(table)
    c = core.custom_roles(1)
    r = by_row(table)
    print("")
    print("· %s" % name)
    print("    表行数 = %d" % len(table or {}))
    print("    按「内容 ≠ 内置默认」判 ⇒ custom_roles = %s   ← 生产实际用的" % c)
    print("    按「表里有行」判       ⇒ 虚拟结果    = %s" % r)
    print("    %s" % ("✅ 两种判据**结果不同** ⇒ 本场景能判别"
                      if c != r else "⚠️ 两种判据结果相同 ⇒ 本场景不能判别"))
    return c, r


fails = []

# ① 空表
c, _ = show("空表（新租户，从没配过权限）", {})
if c != []:
    fails.append("① 空表应得 []")

# ② **判别场景**：逐角色全量回写（内容 == 默认）
full_default = {r: list(core._DEFAULT_PERMS[r]) for r in DEFAULT_KEYS}
c, r = show("★判别场景：设置页「保存」后逐角色全量回写（%d 行，内容全部 == 默认）" % len(DEFAULT_KEYS),
            full_default)
if c != []:
    fails.append("② 全量回写且内容等于默认 ⇒ custom_roles 必须是 []")
if len(r) != len(DEFAULT_KEYS):
    fails.append("② 对照面应返回全部 %d 个角色" % len(DEFAULT_KEYS))

# ③ 真改一个角色
one = dict(full_default)
one["staff"] = ["data", "chat"]          # 去掉 stock（真实差异）
c, _ = show("真改一个角色（staff 去掉 stock，其余仍是默认）", one)
if c != ["staff"]:
    fails.append("③ 应只返回 ['staff']，实得 %s" % c)

# ④ 同内容、异形态：list ↔ dict
c1 = core.perms_rev(1)
feed({"staff": {"data": ["read"], "chat": ["read"]}})     # 新版 dict 形态
rev_dict = core.perms_rev(1)
feed({"staff": ["data", "chat"]})                          # legacy list 形态
rev_list = core.perms_rev(1)
print("")
print("· 同内容、异形态（dict vs legacy list）")
print("    指纹(dict) = %s" % rev_dict)
print("    指纹(list) = %s" % rev_list)
print("    %s" % ("✅ 同指纹（内容判据正确）" if rev_dict == rev_list else "🔴 不同指纹（形态泄漏进了判据）"))
if rev_dict != rev_list:
    fails.append("④ 同内容异形态应得同指纹")

# ⑤ 指纹稳定性 + 敏感性
feed({"staff": ["data", "chat"]})
a = core.perms_rev(1)
b = core.perms_rev(1)
feed({"staff": ["data", "chat", "stock"]})
d = core.perms_rev(1)
print("")
print("· 指纹稳定性 / 敏感性")
print("    同内容两次 = %s / %s  ⇒ %s" % (a, b, "稳定" if a == b else "🔴 不稳定"))
print("    改内容后   = %s  ⇒ %s" % (d, "已变化（正确）" if d != a else "🔴 未变化"))
if a != b or d == a:
    fails.append("⑤ 指纹应稳定且随内容变化")

print("")
print("=" * 72)
print("结果：%s" % ("全部通过" if not fails else "🔴 失败 %d 项：%s" % (len(fails), fails)))
sys.exit(0 if not fails else 1)
