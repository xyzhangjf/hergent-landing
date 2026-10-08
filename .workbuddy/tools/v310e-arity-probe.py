# -*- coding: utf-8 -*-
"""v310e 判别探针：expense_order_create 是否真的参数不匹配？
正反两侧自证：
  · 用 8 个参数调用（正确用法）→ 若走通/抛非 TypeError，说明函数本体没问题
  · 用 15 个参数调用（路由里的写法）→ 应抛 TypeError
且**绝不触库**：先在 arity 阶段就失败，函数体不会执行。
"""
import sys
import os
import inspect

sys.path.insert(0, "/Users/zhangjunfeng/Documents/hergent-erp/server")
os.chdir("/Users/zhangjunfeng/Documents/hergent-erp/server")

from db.queries.finance import expense_order_create  # noqa: E402

sig = inspect.signature(expense_order_create)
print("签名:", sig)
n_params = len([p for p in sig.parameters.values()])
print("可接受位置参数个数上限 =", n_params)
print()

print("--- 反例：15 个参数（= routers/finance.py 第 579/589 行的真实写法）---")
try:
    expense_order_create(*([0] * 15))
    print("  未抛异常（说明 arity 没问题）")
except TypeError as e:
    print("  ✅ TypeError（参数个数错）:", e)
except Exception as e:
    print("  其它异常（= arity 已通过，函数体执行了）:", type(e).__name__, str(e)[:120])

print()
print("--- 正例：8 个参数（= 函数定义的真实形参个数）---")
try:
    expense_order_create(*([0] * 8))
    print("  未抛异常")
except TypeError as e:
    print("  TypeError（不该出现）:", e)
except Exception as e:
    print("  其它异常（= arity 通过，函数体已进入）:", type(e).__name__, str(e)[:120])
