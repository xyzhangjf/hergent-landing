#!/usr/bin/env python3
"""v214 A 护栏：全角→半角（输入法容错）两端**行为**逐字同源。

与 `v213-rules-selftest.py` E 段的分工：
  · E 段（纯 Python、无外部依赖）：比**表** —— `_HALF_MAP` 与前端 `HALF_MAP` 的键值集合。
  · 本脚本（需 node）：比**行为** —— 同一批样例，`normalize_num_text` 与 `toHalfNum` 输出逐字相同。

🔴 为什么必须两条都有（实测教训）：
   两端表**完全一致**时，行为仍可能不一致 —— 曾经两侧都有 `'　': ''` 这条，但
   实现顺序是「先 NFKC 再查表」，而 NFKC 会把 U+3000 折成**普通空格** ⇒ 这条**永远匹配不到**。
   后端末尾恰有 `.strip()` 兜住（得 `'12'`），前端没有（得 `' 12 '`）。
   「比表」绿，「比行为」一眼红。⇒ 表相同 ≠ 行为相同。

🔴 本脚本**从源码里原样提取**前端的 `HALF_MAP` / `toHalfNum`，不重写副本 ——
   重写副本只能证明「我抄对了」，证明不了「线上那份是对的」。

用法：python3 v214-halfnum-parity.py      （退出码 0 = 全绿）
"""
import json
import os
import re
import subprocess
import sys
import tempfile

NODE = "/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"
BE_DIR = "/Users/zhangjunfeng/Documents/hergent-erp/server"
FE = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue"

sys.path.insert(0, BE_DIR)
import db.queries.forecast_rules as fr   # noqa: E402

# 样例覆盖：三端都可能出现的「形近但不同码位」的写法 + 必须**不被**放宽的脏值
CASES = [
    ("\uff11\uff12", "全角数字 １２"),
    ("12\u30025", "中文句号当小数点"),
    ("\uff11\uff12\u3002\uff15", "全角数字 + 中文句号"),
    ("1\uff0c200", "全角逗号（千分位）"),
    ("1\u3001200", "顿号"),
    ("1,200", "ASCII 千分位"),
    ("\u300012\u3000", "表意空格包围"),
    ("\uff0d3", "全角负号"),
    ("\u22123", "数学减号 U+2212"),
    ("12\uff0e5", "全角句点"),
    ("12.", "中间态（小数点后无数字）—— 必须原样保留"),
    ("12\u7bb1", "🔴 脏值：`12箱` 不得被洗成 12"),
    ("abc", "🔴 脏值：字母"),
    ("1e3", "记数法"),
    ("\uff11\uff123.a", "混合：只折形近字符"),
    ("\u0661\u0662", "🔴 阿拉伯-印度数字（JS 的 \\d 是 ASCII-only，后端也须一致拒收）"),
    ("\u0967\u0968", "🔴 天城文数字"),
]


def front_end_results():
    """从 Forecast.vue 提取真实实现，用 node 跑出结果。"""
    src = open(FE, encoding="utf-8").read()
    m_map = re.search(r"const HALF_MAP = \{[\s\S]*?\n\}", src)
    m_fn = re.search(r"function toHalfNum\(s\) \{[\s\S]*?\n\}", src)
    if not (m_map and m_fn):
        print("❌ 无法从 Forecast.vue 提取 HALF_MAP / toHalfNum")
        sys.exit(1)
    js = m_map.group(0) + "\n" + m_fn.group(0) + "\n"
    js += "const CASES = " + json.dumps([c for c, _ in CASES]) + ";\n"
    js += "console.log(JSON.stringify(CASES.map(c => toHalfNum(c))));\n"
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False, encoding="utf-8") as f:
        f.write(js)
        path = f.name
    try:
        out = subprocess.run([NODE, path], capture_output=True, text=True, check=True).stdout
        return json.loads(out.strip().splitlines()[-1])
    finally:
        os.unlink(path)


def main():
    fe = front_end_results()
    fails = []
    print("%-4s %-22s %-22s %s" % ("", "输入", "后端（Python）", "前端（JS）"))
    print("-" * 78)
    for (raw, why), fv in zip(CASES, fe):
        bv = fr.normalize_num_text(raw)
        same = bv == fv
        if not same:
            fails.append((raw, why, bv, fv))
        print("%-4s %-22s %-22s %s   %s" % ("✅" if same else "❌", repr(raw), repr(bv), repr(fv), why))

    print("-" * 78)
    if fails:
        print("❌ %d 处两端行为**不一致**：" % len(fails))
        for raw, why, bv, fv in fails:
            print("     %r（%s）后端=%r 前端=%r" % (raw, why, bv, fv))
        print("\nVERDICT: FAIL")
        return 1
    print("✅ %d 条样例两端**逐字一致**" % len(CASES))
    print("\nVERDICT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
