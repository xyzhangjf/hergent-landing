#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mp-wxml-class-coverage.py —— 小程序「wxml 引用的 class 是否有 wxss 定义」防回归断言。

背景（本技能 §2.6 第 1 条）：曾出现 `privacy-mask` / `privacy-box` / `p-btn` 等类名
**只存在于 .wxml、全仓没有任何 .wxss 定义**，导致弹窗渲染成一坨裸文字。
同类问题 2026-09-22 再现于 `pages/mine/mine.wxml` 的 `.rec-total` / `.recall-btn` / `.rec-expand`
——按钮按微信原生 `<button>` 默认样式渲染，视觉上悬在卡片中间盖住文字。

判据：本页「wxml 中用到的类名」应能在**本页 wxss 或它 @import 的公共 wxss** 中找到规则。
用法：python3 mp-wxml-class-coverage.py <miniprogram 目录>
退出码：0 = 无缺失；1 = 有缺失
"""
import os
import re
import sys

WXML_CLASS = re.compile(r'class="([^"{}]*)"')
RULE = re.compile(r'\.([A-Za-z][\w-]*)')
IMPORT = re.compile(r'@import\s+"([^"]+)"')

# 视为"无需样式"的例外（可在此登记并写明原因）。⚠️ 只登记**靠继承/ Flex 布局已正确**的类，
# 不要用它压掉"本该有样式却漏了"的类（那正是本脚本要抓的东西）。
ALLOW = {
    # 品名：字号/颜色继承父级 .rec-item{font-size:26rpx;color:#3a3a3c}，Flex 两端对齐由父级负责；
    # 兄弟 .it-qty 需要单独着色（青色）故有规则，两者不对称是设计如此。
    "it-name",
}


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def collect_rules(wxss_path, seen=None):
    """收集一个 wxss 及其 @import 链上的所有类名。"""
    seen = seen or set()
    p = os.path.abspath(wxss_path)
    if p in seen or not os.path.isfile(p):
        return set()
    seen.add(p)
    txt = read(p)
    names = set(RULE.findall(txt))
    for rel in IMPORT.findall(txt):
        names |= collect_rules(os.path.join(os.path.dirname(p), rel), seen)
    return names


def selftest():
    """正反例自测 —— 证明「有孤儿类名」抓得到、「全有样式」放得过。

    只有正反例**结果不同**，这个探针才算有效；若两者同结果（例如都报绿），
    说明探针已作废，其结论一律不可信。用法：--selftest
    """
    import subprocess
    import tempfile
    d = tempfile.mkdtemp(prefix="mpwxml-")
    wxml = os.path.join(d, "p.wxml")
    wxss = os.path.join(d, "p.wxss")
    with open(wxss, "w", encoding="utf-8") as f:
        f.write(".a{color:#000}\n.b{color:#111}\n")
    with open(wxml, "w", encoding="utf-8") as f:
        f.write('<view class="a"><text class="b">x</text></view>\n')
    ok = subprocess.run([sys.executable, __file__, d], capture_output=True)
    with open(wxml, "a", encoding="utf-8") as f:
        f.write('<view class="orphan-cls">y</view>\n')
    ng = subprocess.run([sys.executable, __file__, d], capture_output=True)
    print("正例（类名都有样式）退出码 = %d，应为 0" % ok.returncode)
    print("反例（含无样式类名）退出码 = %d，应为 1" % ng.returncode)
    if ok.returncode == 0 and ng.returncode == 1 and b"orphan-cls" in ng.stdout:
        print("SELFTEST: PASS —— 正反例结果不同，探针有效")
        return 0
    print("SELFTEST: FAIL —— 正反例同结果，探针作废，其结论不可采信")
    return 1


def main():
    # ⚠️ 2026-09-22 修（假绿）：默认路径只是便利值。调用方 cwd 不是仓库根、或小程序目录被改名时，
    # `os.walk` 会走 0 个文件 —— 旧版此时**照旧打印「全部类名均有样式定义 ✅」并 exit 0**，
    # 即「一个页面都没扫到」被当成了「检查通过」。这正是本技能反复记的
    # 「正反例同结果 ⇒ 探针作废」。故：路径不存在 / 扫不到页面，一律按「工具失效」报错，
    # **绝不算通过**。
    root = sys.argv[1] if len(sys.argv) > 1 else "miniprogram"
    if not os.path.isdir(root):
        print("❌ 扫描路径不存在：%s" % os.path.abspath(root))
        print("   用法：python3 mp-wxml-class-coverage.py <miniprogram 目录>")
        return 2
    bad = []
    pages = 0

    for dp, dn, fns in os.walk(root):
        for fn in sorted(fns):
            if not fn.endswith(".wxml"):
                continue
            base = fn[:-5]
            wxml = os.path.join(dp, fn)
            wxss = os.path.join(dp, base + ".wxss")
            pages += 1
            if not os.path.isfile(wxss):
                bad.append((wxml, "*", "整个 wxss 缺失"))
                continue
            defined = collect_rules(wxss)
            used = set()
            for m in WXML_CLASS.findall(read(wxml)):
                for c in m.split():
                    if c and not c.startswith("{{"):
                        used.add(c)
            for c in sorted(used - defined - ALLOW):
                bad.append((wxml, c, "无样式定义"))

    if pages == 0:
        print("❌ 在 %s 下没有扫到任何 .wxml —— 探针未生效，本次结论无效（≠ 通过）"
              % os.path.abspath(root))
        return 2

    print("扫描 wxml 页面数: %d" % pages)
    if bad:
        print("\n⚠ 以下类名在 wxml 中被引用但没有 wxss 规则：")
        for f, c, why in bad:
            print("  %s  .%s  (%s)" % (f, c, why))
        print("\nRESULT: %d 处缺失" % len(bad))
        return 1
    print("\nRESULT: 全部类名均有样式定义 ✅")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    sys.exit(main())
