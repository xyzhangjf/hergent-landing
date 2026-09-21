# -*- coding: utf-8 -*-
"""v233 同源校验：**前端 `Forecast.vue::perCase` 与后端 `domain/unit_convert.py::per_case`
在同一批用例上逐值相等**。

为什么需要它：`per_case` 在后端是**第二份实现**（第一份在前端，跨语言无法共用代码）。
「两份实现」在本项目的默认命运是**漂移**，唯一能把它钉住的判据就是本脚本 ——
同一批 (spec, unit, arc) 跑两边、逐值比对。

做法：
  ① 从 `Forecast.vue` **原样抽出** `function perCase(...) {...}` 源码（不手抄，抽出来的
     就是线上跑的那段）→ 写进临时 `.mjs`；
  ② node 跑这批用例 → JSON；
  ③ Python 跑 `unit_convert.per_case` 同一批用例 → 逐值比对。

用法：
    python3 v233-percase-parity.py
退出码：0 = 全等（`PARITY OK n/n`）；1 = 有分歧。
"""
import json
import os
import re
import subprocess
import sys

VUE = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
NODE = '/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'
sys.path.insert(0, SRV)


def extract_per_case(path):
    """从 .vue 里抽出 `function perCase(...)` 的完整源码。

    结束判据 = **行首的 `}`**（文件里函数体缩进 2 空格，内层 `}` 都带缩进）
    —— 不用括号配平：函数体里有正则字面量 `/(\\d+...)/g`，配平会被它里面的括号带偏。
    """
    src = open(path, encoding='utf-8').read()
    i = src.index('function perCase(')
    j = src.index('\n}', i)          # 行首的 } = 函数结束
    code = src[i:j + 2]
    assert code.count('function perCase(') == 1, '抽取区间不干净'
    return code


# ---- 用例：(spec, unit, arc)。arc 的键与 `products_grid` 下发的同名 ----
A_FULL = {'large_unit': '件', 'large_ratio': 96, 'medium_unit': '组', 'medium_ratio': 12}
A_LR24 = {'large_unit': '件', 'large_ratio': 24, 'medium_unit': '', 'medium_ratio': 0}
A_LR12 = {'large_unit': '箱', 'large_ratio': 12, 'medium_unit': '', 'medium_ratio': 0}
A_NONE = {'large_unit': '', 'large_ratio': 0, 'medium_unit': '', 'medium_ratio': 0}
# v217 那个商品的真实形状：spec 纯数字、无换算
A_217 = {'large_unit': '', 'large_ratio': 0, 'medium_unit': '', 'medium_ratio': 0}

CASES = [
    # ① 档案换算优先 —— 大/中/小单位三档
    ('100g*8杯*12组', '组', A_FULL, '档案·中单位 ⇒ lr/mr = 8'),
    ('100g*8杯*12组', '杯', A_FULL, '档案·小单位 ⇒ lr = 96'),
    ('100g*8杯*12组', '件', A_FULL, '档案·大单位 ⇒ 1'),
    ('100g*8杯*12组', '条', A_FULL, '档案·认不出的单位 ⇒ lr = 96'),
    ('250g*24瓶', '瓶', A_LR24, '档案·两级商品小单位 ⇒ 24'),
    ('250g*24瓶', '件', A_LR24, '档案·两级商品大单位 ⇒ 1'),
    ('500g*12袋', '袋', A_LR12, '档案·大单位名是「箱」⇒ 12'),
    # ② 档案缺换算 ⇒ 回退规格解析（v189 规则）
    ('250g*24瓶', '瓶', A_NONE, '回退·末位单位同名 ⇒ 24'),
    ('100g*8杯*12组', '杯', A_NONE, '回退·报单单位更细 ⇒ 8×12 = 96'),
    ('100g*8杯*12组', '组', A_NONE, '回退·同末位单位 ⇒ 12'),
    ('12', '件', A_NONE, '回退·纯数字规格 ⇒ 12'),
    ('12', '瓶', A_NONE, '回退·纯数字规格(换单位) ⇒ 12'),
    ('250g*24', '瓶', A_NONE, '回退·末位无单位 ⇒ 24'),
    ('1500ML*6桶', '桶', A_NONE, '回退·末位单位同名 ⇒ 6'),
    ('340G', '瓶', A_NONE, '回退·净含量陷阱 ⇒ 340'),
    ('195g×24盒（130g+65g）', '盒', A_NONE, '回退·末位不是装箱数 ⇒ 65'),
    # ③ 缺规格 / 无数字 ⇒ 0
    ('', '瓶', A_NONE, '回退·空规格 ⇒ 0'),
    ('赠品物料', '件', A_NONE, '回退·无数字 ⇒ 0'),
    ('', '瓶', None, '回退·空规格且不传 arc ⇒ 0'),
    # ④ 边界
    ('250g*24瓶', '', A_NONE, '回退·报单单位缺失 ⇒ 24'),
    ('250g*24瓶', None, A_NONE, '回退·报单单位 None ⇒ 24'),
    ('250g*24瓶', '瓶', None, '不传 arc ⇒ 回退规格解析 ⇒ 24'),
    # ⑤ v217 真实商品（`160红枣5连杯`：spec=8、档案无换算、unit='件'）
    ('8', '件', A_217, 'v217·档案 unit=件(空换算) ⇒ 8'),
    ('8', '条', A_217, 'v217·回填后的报单单位「条」⇒ 8（**换算比不变**，这是我敢回填的判据）'),
]


def main():
    if not os.path.exists(VUE):
        print('BAD 找不到前端文件:', VUE)
        return 1
    code = extract_per_case(VUE)
    print('已从 Forecast.vue 抽出 %d 行 perCase 源码' % code.count('\n'))

    mjs = '/tmp/v233-percase.mjs'
    with open(mjs, 'w', encoding='utf-8') as f:
        f.write("import { readFileSync } from 'fs'\n")
        f.write(code + '\n')
        f.write("const cases = JSON.parse(readFileSync(0, 'utf8'))\n")
        f.write("const out = cases.map(c => perCase(c[0], c[1], c[2]))\n")
        f.write("process.stdout.write(JSON.stringify(out))\n")

    payload = json.dumps([[c[0], c[1], c[2]] for c in CASES], ensure_ascii=False)
    r = subprocess.run([NODE, mjs], input=payload.encode('utf-8'),
                       capture_output=True)
    if r.returncode != 0:
        print('BAD node 执行失败:\n' + r.stderr.decode('utf-8', 'replace')[:800])
        return 1
    js_out = json.loads(r.stdout.decode('utf-8'))

    from domain.unit_convert import per_case as py_per_case  # noqa: E402
    bad = 0
    for i, (spec, unit, arc, why) in enumerate(CASES):
        got_py = py_per_case(spec, unit, arc)
        got_js = js_out[i]
        ok = abs(float(got_py) - float(got_js)) < 1e-9
        if not ok:
            bad += 1
        print('  %s %-52s py=%-8s js=%-8s' % ('ok ' if ok else 'BAD', why, got_py, got_js))
    n = len(CASES)
    print()
    if bad:
        print('PARITY FAIL %d/%d 不一致' % (bad, n))
        return 1
    print('PARITY OK %d/%d' % (n, n))
    return 0


if __name__ == '__main__':
    sys.exit(main())
