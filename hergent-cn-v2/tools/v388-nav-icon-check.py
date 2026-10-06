#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v388-nav-icon-check.py —— 侧栏导航「图标名必须存在于 Icon.vue」护栏（**离线，只读**）

为什么需要它（开发计划 §四 硬约束 ③）：
  `Icon.vue` 的兜底是 `ICONS[props.name] || ICONS.settings` —— **写错名字不报错**，
  会静默渲染成一个齿轮。肉眼极难发现"这个条目的图标配错了"，构建、探针也全都绿。
  批次 2 往 `NAV` 里一次加了 8 个图标名（1 个职能区 + 7 个页签），正是最容易写错的时刻。

判据（两向）：
  ① 正向：`Shell.vue` 里出现的每个图标名（NAV 的 `icon:` 与模板的 `<Icon name="...">`）
     都必须存在于 `Icon.vue` 的 `ICONS` 键集合里；
  ② 反向（判别力自证）：故意塞一个不存在的名字，退出码必须是 2 —— 证明本脚本**真的会红**，
     而不是"永远返回 0 的假护栏"。用 `--selftest` 跑。

  ⚠️ 只报"未知图标名"，不报"未被使用的图标"（图标库本来就有大量备而不用的）。

用法：
  python3 hergent-cn-v2/tools/v388-nav-icon-check.py
  python3 hergent-cn-v2/tools/v388-nav-icon-check.py --selftest   # 反向自证
退出码：0 = 全绿；2 = 有未知图标名（或自证失败）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # hergent-cn-v2/
ICON_VUE = ROOT / "src" / "components" / "Icon.vue"
SHELL_VUE = ROOT / "src" / "components" / "Shell.vue"

# ICONS 对象里的键：形如 `  name: [...]` 或 `  'name': [...]`
ICON_KEY_RE = re.compile(r"^\s{2}'?([a-z0-9][a-z0-9-]*)'?\s*:\s*\[", re.M)
# Shell.vue 里 NAV 的 `icon: 'x'`
NAV_ICON_RE = re.compile(r"icon:\s*'([^']+)'")
# Shell.vue 模板里的 `<Icon name="x"` —— ⚠️ 必须用 `\sname=`（前面是空白）而不是裸 `name=`，
#   否则会把**绑定写法** `:name="it.icon"` 也当成字面量图标名（`:name` 里的 `name` 前面是 `:`），
#   于是把 `it.icon` 报成"未知图标"—— 这正是本脚本第一版的假阳性（自证步骤抓出来的）。
TAG_ICON_RE = re.compile(r"<Icon\s[^>]*?\sname=\"([^\"]+)\"")


def icon_keys(text: str):
    return set(ICON_KEY_RE.findall(text))


def used_icons(text: str):
    """返回 {图标名: [出现位置说明]}"""
    found = {}
    for m in NAV_ICON_RE.finditer(text):
        found.setdefault(m.group(1), []).append("NAV icon:")
    for m in TAG_ICON_RE.finditer(text):
        found.setdefault(m.group(1), []).append("<Icon name>")
    return found


def check(shell_text: str, keys: set, label: str):
    used = used_icons(shell_text)
    unknown = sorted(n for n in used if n not in keys)
    print(f"[{label}] Icon.vue 图标库 {len(keys)} 个 ｜ Shell.vue 用到 {len(used)} 个")
    print(f"[{label}] 用到的图标名：{', '.join(sorted(used))}")
    if unknown:
        print(f"[{label}] ❌ 未在 Icon.vue 中定义的图标名 {len(unknown)} 个：")
        for n in unknown:
            print(f"      · {n}   （出现在：{', '.join(used[n])}）")
            print(f"        ⇒ 不会报错，会**静默渲染成齿轮**。要么改对名字，要么在 Icon.vue 里补这一条。")
        return False
    print(f"[{label}] ✅ 全部图标名都在 Icon.vue 里（{len(used)}/{len(used)}）")
    return True


def main():
    selftest = "--selftest" in sys.argv

    if not ICON_VUE.exists() or not SHELL_VUE.exists():
        print(f"❌ 找不到文件：{ICON_VUE} / {SHELL_VUE}")
        return 2

    keys = icon_keys(ICON_VUE.read_text(encoding="utf-8"))
    shell = SHELL_VUE.read_text(encoding="utf-8")

    good = check(shell, keys, "正向")

    if selftest:
        # 判别力自证：塞一个绝对不存在的名字 —— 必须被判红
        poisoned = shell + "\nconst _SELFTEST = { icon: '__no_such_icon__' }\n"
        bad = check(poisoned, keys, "反向自证")
        if good and not bad:
            print("\n=== SELFTEST OK：正例通过、反例被判红 ⇒ 本护栏有判别力 ===")
            return 0
        print("\n=== ❌ SELFTEST FAIL：护栏没有判别力（反例居然也过了）===")
        return 2

    return 0 if good else 2


if __name__ == "__main__":
    sys.exit(main())
