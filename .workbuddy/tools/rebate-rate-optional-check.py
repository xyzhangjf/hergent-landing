#!/usr/bin/env python3
"""v769：品牌目标「返利率留空」后端自检 —— **只读，不写库、不改规则**。

在**生产机**（装了 fastapi）跑：
    cd /opt/hergent-erp && python3 /tmp/rebate-rate-optional-check.py

本地开发机缺 fastapi，跑不了 routers.rebate_rules；前端形状由
`hergent-cn-v2/tests/rebate-rate-optional.contract.mjs` 的静态判据 + 坏样本守着。

🔴 本脚本最值钱的两条是 R1/R2：`resolve_month_rate` 对「该月不在 monthly_rates」
   会向前找最近有值的月。前端若不把留空月显式落 0，2 月会被套上 1 月的 10%，
   凭空多算返利且零报错 —— 所以「允许留空」不等于「不写这一格」。
"""
import sys

sys.path.insert(0, '/opt/hergent-erp')
from routers.rebate_rules import validate_rule, resolve_month_rate  # noqa: E402

BASE = {
    "rule_name": "v769 自检（不落库）",
    "dimension": "brand",
    "target_type": "amount",
    "scope_key": "v769-自检品牌",
    "scope_name": "v769-自检品牌",
    "period_type": "year",
    "target_value": 200000,
    "target_year": 2026,
    "trigger_mode": "on_target",
    "trigger_threshold": 1,
    "rebate_basis": "rate",
    "rebate_rate": "",
    "rebate_amount": 0,
    "effective_start": "",
    "effective_end": "",
    "is_active": 1,
    "monthly_amounts": {"01": 100000, "02": 100000},
    "monthly_rates": {},
    "monthly_tiers": {},
}

DELETE = object()
_failed = 0


def ok(cond, label, extra=''):
    global _failed
    if cond:
        print('  ✅ ' + label + ((' | ' + str(extra)) if extra else ''))
    else:
        print('  ❌ ' + label + ((' | ' + str(extra)) if extra else ''))
        _failed += 1


def check(label, over=None, want_ok=True, want_rate=None, want_err_kw=''):
    body = dict(BASE)
    for k, v in (over or {}).items():
        if v is DELETE:
            body.pop(k, None)
        else:
            body[k] = v
    try:
        errors, cleaned = validate_rule(body, None)
    except Exception as e:
        ok(False, label, '抛异常: %s: %s' % (type(e).__name__, e))
        return
    got_ok = not errors
    ok(got_ok == want_ok, label,
       'errors=' + repr(errors) if errors else '通过')
    if want_ok and want_rate is not None and cleaned:
        ok(float(cleaned.get('rebate_rate') or 0) == want_rate,
           label + ' · 落库费率', cleaned.get('rebate_rate'))
    if want_err_kw and errors:
        ok(any(want_err_kw in e for e in errors),
           label + ' · 报错指向正确', errors)


print('── v769 后端：品牌目标返利率留空（只读自检）──')

# A 组：品牌月度目标，返利率留空 / 0 / 非空
check('A1 返利率 = 空串（用户整列留空）', want_ok=True, want_rate=0.0)
check('A2 返利率 = None（API 没带这个键）', {'rebate_rate': DELETE}, True, 0.0)
check('A3 返利率 = 显式 0', {'rebate_rate': 0}, True, 0.0)
check('A4 返利率 = 0.03（原有非空场景）', {'rebate_rate': 0.03}, True, 0.03)
check('A5 前端已把留空月落 0',
      {'rebate_rate': '', 'monthly_rates': {'01': 0, '02': 0}}, True, 0.0)
check('A6 混合月（1月10% / 2月无返利）',
      {'rebate_rate': '', 'monthly_rates': {'01': 0.1, '02': 0}}, True, 0.1)

# B 组：非法输入仍拦 —— 用户要的是「不用填」，不是「随便填」
check('B1 非数字 abc', {'rebate_rate': 'abc'}, False, want_err_kw='必须是数字')
check('B2 负数 -0.1', {'rebate_rate': -0.1}, False, want_err_kw='[0,1]')
check('B3 越界 1.5', {'rebate_rate': 1.5}, False, want_err_kw='[0,1]')
check('B4 月表费率越界', {'monthly_rates': {'01': 1.5}}, False, want_err_kw='[0,1]')

# C 组：单值模式（商品 / 单期）维持 v360 口径，留空仍拦
check('C1 商品目标 + 返利率留空（不该被顺手放开）',
      {'dimension': 'product', 'target_type': 'quantity', 'period_type': 'month',
       'monthly_amounts': DELETE}, False, want_err_kw='必须是数字')

# D 组：反证「向前继承」真实存在 —— 落 0 方案就是为它而加
_r_with_zero = {'monthly_rates': {'01': '0.1', '02': '0'}}
_r_without = {'monthly_rates': {'01': '0.1'}}
ok(resolve_month_rate(_r_with_zero, '2026-02-15') == 0.0,
   'R1 🔴 2 月显式 0 → 取 0（不继承 1 月的 10%）',
   resolve_month_rate(_r_with_zero, '2026-02-15'))
ok(resolve_month_rate(_r_without, '2026-02-15') == 0.1,
   'R2 🔴 反证：2 月不写 → 被套成 1 月的 10%（旧留空方案的真金白银 bug）',
   resolve_month_rate(_r_without, '2026-02-15'))

print(('✅ v769 后端自检 ALL PASS' if not _failed
       else '❌ v769 后端自检 FAILED (%d)' % _failed))
sys.exit(0 if not _failed else 1)
