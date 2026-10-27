"""金额与数量的精度口径 —— **唯一常量来源**。

本文件是 P0-4「精度收口」的第一步（batch A）：**只立常量与唯一实现，不动存量数据**。

## 三条口径（改动前请先读完）

1. **金额存元，两位小数**，存储类型是 `REAL`（SQLite 无定点数）。
   ⇒ 所有读写金额必须经过 `round_money()` 取整到分，否则 `0.1 + 0.2 != 0.3`
   会在累计、对账、返利结算里变成真金白银的差额。
2. **金额比较必须带容差**（`MONEY_EPS` = 1 分），不能用 `==`。
   浮点相加的结果与"应得值"差一个尾数位是**正常**的，`==` 会把正常判成异常。
3. **数量存最小单位**（包/袋/小单位），数量比较用 `QTY_EPS`。

## 为什么现在还是 float

真正彻底的解法是**整数分**（金额 × 100 存 INTEGER），但那是 P0-4 的主体工程：
要改 342 个金额列的语义、配双算校验、逐表回填，还牵动报单/返利/工资的既有口径。
batch A 只做**常量收口**——先把"1 分"这个数字从一个散落的字面量变成一个有名有姓的
常量，这样后续把 `REAL` 换成整数分时，比较逻辑不用再全库搜 `0.01`。

⚠️ **不要**把这里换成 `decimal.Decimal` 或 `decimal(21,9)`：
SQLite 会把 `decimal` 类型声明当亲和性为 NUMERIC 的列，实际仍以浮点存，
**看起来改了其实没改**——这比不改更危险（ERPNext 的 `decimal(21,9)` 在这里是个陷阱）。
"""
import math

# 金额：元，保留 2 位（分）
MONEY_DECIMALS = 2
# 金额比较容差：1 分。两笔钱差不到 1 分，业务上就是"相等"
MONEY_EPS = 0.01
# 同一容差的**整数分**表达（v706 起 `money_balanced` 用它做判定）：
# 整数比较不存在浮点表示问题，`abs(0.010000000000005116) > 0.01` 这类判据不再出现。
MONEY_EPS_CENTS = 1
# 数量比较容差：浮点累加后的最后一位噪声量级
QTY_EPS = 1e-6

__all__ = ["MONEY_DECIMALS", "MONEY_EPS", "MONEY_EPS_CENTS", "QTY_EPS",
           "round_money", "to_cents", "money_eq", "money_balanced", "qty_eq"]


def round_money(x):
    """把任意值规整到分（两位小数）。None / 非法值视为 0。

    ⚠️ 这是 `erp_db.money()` 的**原实现原样迁入**（`round(float(x or 0), 2)`，
    银行家舍入）。行为逐位不变是硬要求：金额口径一改，历史单据的合计就会漂。
    要改舍入方式，必须单独一版 + 全库双算验证。
    """
    try:
        return round(float(x or 0), 2)
    except (ValueError, TypeError):
        return 0.0


def to_cents(x):
    """金额 → **整数分**。

    这是 P0-4 的落点：以后金额列直接存整数分，比较与累计都不再有浮点误差。
    batch A 只用它做「严格相等」判断，不动任何存储。

    `round()` 放在 `*100` 之后是必要的：`2.675 * 100 = 267.49999999999997`，
    直接 `int()` 会截成 267（少一分）。先 round 再转 int 才是对的那一侧。
    """
    return int(round(round_money(x) * 100))


def money_eq(a, b):
    """两笔金额是否**完全相等**（按分比，不受浮点尾差影响）。

    ⚠️ 注意与 `money_balanced` 的区别：本函数**不容忍** 1 分的差。
    "对账时限内差 1 分算对得上"是另一回事，用 `money_balanced`。
    """
    return to_cents(a) == to_cents(b)


def money_balanced(dr, cr):
    """借方合计与贷方合计是否平衡（容差 **1 分**，按整数分判定）。

    ## 判据

        abs(to_cents(dr) - to_cents(cr)) <= MONEY_EPS_CENTS     # = 1

    老写法是 `abs(dr - cr) <= 0.01`。浮点下「差 1 分」的结论取决于二进制表示，
    **同样的业务事实会得出相反结论**：

        100.00 - 99.99    = 0.010000000000005116  ⇒ 老判据**不平**（拒单）
        1234.56 - 1234.55 = 0.010000000000000009  ⇒ 老判据**平**（过账）

    v706 改成按整数分比较。存量影响已双算核实（2026-10-27）：
    `erp.db` 6 张凭证 / `tenant_1.db` 23 张 / `tenant_10.db` 0 张，
    老新判据**逐张一致、零翻案** —— 本次只影响今后「恰好差 1 分」的新过账。

    ⚠️ 边界：判据比的是「按分规整之后」的差。输入若有第三位小数（如 `2.675`），
    规整后只差 1 分 ⇒ 判平。这不是缺陷：金额最小单位就是分，三分位金额本身是非法输入
    （全库写入都经 `round_money()`）；老判据在那里的"不平"是拿浮点噪声当业务规则。
    """
    return abs(to_cents(dr) - to_cents(cr)) <= MONEY_EPS_CENTS


def qty_eq(a, b):
    """两个数量是否相等（容差 QTY_EPS）。"""
    try:
        return math.isclose(float(a or 0), float(b or 0), abs_tol=QTY_EPS)
    except (ValueError, TypeError):
        return False
