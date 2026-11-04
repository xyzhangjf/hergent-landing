"""返利指标规则模块 (Rebate / Target Rule Engine) — v113

让用户自定义"返利/指标"规则, 覆盖审核时综合的"厂家指标达成 + 返利调节"维度:
  * 计算维度 dimension: brand(品牌) / product(单品)
  * 目标度量 target_type: amount(金额, 品牌固定) / quantity(数量, 单品可选)
  * 作用对象 scope_key/scope_name: 品牌名 或 商品ID(空='全部/通用')
  * 周期口径 period_type: month / year / custom（v173b 起不再提供 quarter —— 季度规则在「统一月度模型」下无独立口径，且前端「周期」列只作读数）
  * 目标值 target_value: 金额(元) 或 数量(件)
  * 触发条件 trigger_mode: on_target(达成即返, 按 trigger_threshold 门槛) / tiered(阶梯)
  * 阶梯计法 scale_type: graduated(累进, 分档计算) / non_graduated(全量按档, 命中档对全部基数计价)
  * 舍入策略 rounding_mode: half_up(四舍五入) / up(进位) / down(舍去) + rounding_digits(小数位)
  * 返利形式 rebate_basis: rate(比例) / fixed(固定金额)
  * 生效时间范围 effective_start / effective_end (YYYY-MM-DD, 空=不限)
  * 优先级 priority: 数值越大越优先(多规则并存时排序与冲突裁决)
  * 启用 is_active

提供: 增删改查 + 预校验(validate) + 冲突检测(conflicts) + 返利试算(simulate / simulate-batch)。
规则落库于当前租户库(tenant_N.db)的 rebate_target_rules 表(由 erp_db v108 迁移创建)。

v113 变更（对标国际 ERP 第一批 §1.3 / §2.3）:
  - 计法与舍入策略落库并可由前端显式选择，算法委托 domain/rebate_calc 统一内核。
  - 新增 POST /simulate-batch：一次请求批量试算（仪表盘/试算器统一走它，前端不再镜像算法）。
  - /simulate 返回值带 steps[] 算式链与 tiers[] 档位明细，供透明化面板渲染。

校验/冲突逻辑:
  - 硬校验(422): 维度/目标度量一致性、目标值>0、返利比例 0~1、日期顺序、阶梯合法性等。
    · v360（2026-10-01）：比例返利(rebate_rate)**下界含 0** —— 填 0 = 该目标确实没有返利
      （原先 `(0,1]` 逼用户编一个假比例）。空值 / 非数字 / 负数 / >1 的拦截**不变**，
      判据 `_is_num_like` + 范围两段式，见该处注释。
  - 冲突(409): 同 (dimension, target_type, period_type, scope_key) 且生效期重叠的两条启用规则
    视为冲突(会导致重复计算/歧义), 创建/更新时拦截并列出冲突项。
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import json as _json
import logging
from datetime import datetime, date, timedelta
from db.connection import _connect
# v365：停单日的**唯一读取口**在 erp_db（`rebate_arrival_skip_map`）—— 本模块原先
#   只经 `db.connection` 拿连接、不碰 erp_db；这里补 `import erp_db as db` 是为了
#   复用同一份读取实现（`import erp_db as db` 是本仓 router 层的既有范式，
#   erp_db 不反向 import routers ⇒ 无循环）。
import erp_db as db
from core import _auth
# v172：「修改人怎么取」与「留痕失败怎么办」两条全仓唯一规则在 routers._field_log
# （与达成填报共用同一个壳），底层仍是 entity_change_logs 那唯一一份设施。
from db.queries.entity_logs import get_entity_changes_by_type
from routers import _field_log as fl
from domain.rebate_calc import (
    SCALE_TYPES, ROUNDING_MODES,
    DEFAULT_SCALE_TYPE_RULE, DEFAULT_ROUNDING_MODE, DEFAULT_ROUNDING_DIGITS,
    SCALE_TYPE_LABELS, ROUNDING_MODE_LABELS,
    _norm_digits, compute_rebate_unified,
)
from domain.arrival_schedule import (
    MODES as ARR_MODES, MODE_INTERVAL, MODE_LABELS as ARR_MODE_LABELS,
    WEEKDAY_LABELS, parse_weekdays as _parse_weekdays,
    arrival_summary,
    # v121 智能报单表：报单排程（报单语义）
    MAX_EARLY_LIMIT as ORDER_MAX_EARLY_LIMIT,
    build_period_plan as _build_period_plan,
    suggest_first_date as _suggest_first_date,
)

router = APIRouter(prefix="/api/rebate-rules", tags=["rebate-rules"])

# 本模块此前完全没有日志设施（全靠返回体/异常表达），v364 起需要记录
# 「某条规则的本月到货安排算不出来」这类**不该中断请求、但不能静默**的情况。
# 与 routers/product_targets.py 同名 logger，便于统一按 "hergent" 过滤。
logger = logging.getLogger("hergent")

# ---- 允许的枚举值域 ----
# v113（对标国际 ERP 第一批 §1.3 维度扩展）：在 brand / product 基础上新增
# category（品类）/ customer（客户）/ channel（渠道），覆盖「按品类 / 按客户 / 按渠道」返利。
DIMENSIONS = ("brand", "product", "category", "customer", "channel")
# 维度 → 作用对象(scope_key)语义：前端下拉候选据此切换
#   brand:    品牌名（brands 档案）
#   product:  商品 ID（products）
#   category: 品类名（products.category 去重）
#   customer: 客户名（contacts type=customer）
#   channel:  渠道枚举（CHANNEL_OPTIONS）
SCOPE_TYPE_OF = {
    "brand": "brand_name", "product": "product_id", "category": "category_name",
    "customer": "customer_name", "channel": "channel_enum",
}
CHANNEL_OPTIONS = [
    {"value": "ka", "label": "KA 大卖场"},
    {"value": "tt", "label": "传统流通(TT)"},
    {"value": "wholesale", "label": "批发"},
    {"value": "ecommerce", "label": "电商"},
    {"value": "direct", "label": "直营"},
]
TARGET_TYPES = ("amount", "quantity")
PERIOD_TYPES = ("month", "quarter", "year", "custom")
TRIGGER_MODES = ("on_target", "tiered")
REBATE_BASES = ("rate", "fixed")
DATE_FMT = "%Y-%m-%d"

# v113: 计法与舍入的元信息（前端下拉直接消费，避免前后端各写一份文案）
SCALE_OPTIONS = [{"value": v, "label": SCALE_TYPE_LABELS.get(v, v)} for v in SCALE_TYPES]
ROUNDING_OPTIONS = [{"value": v, "label": ROUNDING_MODE_LABELS.get(v, v)} for v in ROUNDING_MODES]


# ---------------------------------------------------------------------------
# v172：修改日志（字段级留痕）
# ---------------------------------------------------------------------------
# 复用全仓**唯一**的字段级修改记录设施 `db.log_entity_changes` → `entity_change_logs`
# （商品档案 / 客户档案 / 销售订单 / 达成填报的「修改记录」同源）。**不另建第二份日志** ——
# 「谁在什么时候把哪个字段从什么改成了什么」若有两份实现，二者必然漂移，
# 而这条日志是要拿去对账/追责的，漂移即失信。
RULE_ENTITY = "rebate_rule"

# 参与留痕的字段白名单。顺序 = 界面「规则列表」列序 + 表单分区顺序，
# 读起来像一张从界面抄下来的变更单，而不是一份列名清单。
RULE_LOG_FIELDS = (
    # 基础
    "rule_name", "dimension", "scope_name", "period_type", "target_year",
    "target_type", "target_value", "target_unit",
    # 触发与返利
    "trigger_mode", "trigger_threshold", "rebate_basis", "rebate_rate",
    "rebate_amount", "tiers_json",
    # 生效与状态
    "effective_start", "effective_end", "is_active", "priority", "contract_id",
    # 月度分解（一张 12 行的月表）
    "monthly_amounts", "monthly_rates", "monthly_tiers",
    # 节奏（L2）：到货排程 + 报单排程 + 报单自动化
    "arrival_mode", "arrival_first_dom", "arrival_cadence_days", "arrival_weekdays",
    "arrival_base_dow", "arrival_count_override",
    "order_mode", "order_first_date", "order_cadence_days", "order_weekdays",
    "order_lead_days", "order_max_early_days",
    "auto_period_enabled", "auto_open_time", "auto_close_time", "supplier_deadline_time",
    # 算钱策略
    "scale_type", "rounding_mode", "rounding_digits",
)

# 「钱 / 量」字段 —— 决定留痕值在前端是否按数字渲染（千分位）。
# 刻意**不含** target_year / priority / *_days / arrival_first_dom 这类序号型数字：
# 年份 2026 被千分位渲染成「2,026」是 bug 不是功能。
RULE_NUM_FIELDS = ("target_value", "rebate_amount")

# 中文标签。**与界面用词同源**（规则详情弹窗的字段名 / 表单 label），不另造一套说法 ——
# 同一个字段在详情里叫「达成门槛」、在日志里叫「阈值」，用户就得做一次翻译。
RULE_FIELD_LABELS = {
    "rule_name": "规则名称",
    "dimension": "计算维度",
    "scope_name": "作用对象",
    "period_type": "周期口径",
    "target_year": "目标年度",
    "target_type": "目标度量",
    "target_value": "目标值",
    "target_unit": "数量单位",
    "trigger_mode": "触发方式",
    "trigger_threshold": "达成门槛",
    "rebate_basis": "返利形式",
    "rebate_rate": "返利比例",
    "rebate_amount": "返利固定金额",
    "tiers_json": "阶梯档位",
    # v292（2026-09-27）：用词对齐 —— 这两列是**规则整体的启停窗口**，不是"目标适用到哪天"
    # （带月度分解的规则，适用月份由分解的键决定，生效期完全不参与）。
    # 修改日志弹窗直接照搬本表，故必须与表单 / 详情页用词保持一致，否则同一字段三个叫法。
    "effective_start": "规则启用日",
    "effective_end": "规则停用日",
    "is_active": "启用",
    "priority": "优先级",
    "contract_id": "归属合同",
    "monthly_amounts": "月度目标金额",
    "monthly_rates": "月度返利率",
    "monthly_tiers": "月度返利档位",
    "arrival_mode": "到货方式",
    "arrival_first_dom": "到货基准日",
    "arrival_cadence_days": "到货周期(天)",
    "arrival_weekdays": "到货星期",
    "arrival_base_dow": "基准到货星期",
    "arrival_count_override": "本月到货次数",
    "order_mode": "报单模式",
    "order_first_date": "首次报单日",
    "order_cadence_days": "报单周期(天)",
    "order_weekdays": "报单星期",
    "order_lead_days": "提前天数",
    "order_max_early_days": "最多可提前",
    "auto_period_enabled": "智能创建/关闭报单表",
    "auto_open_time": "开放填报",
    "auto_close_time": "自动关单",
    "supplier_deadline_time": "厂家下单截止",
    "scale_type": "计法",
    "rounding_mode": "舍入方式",
    "rounding_digits": "舍入小数位",
    # 档位版本 —— 不是 rebate_target_rules 的一列（在 rebate_tier_versions 表里），
    # 但同属本页可改的东西，故一并进标签表，避免它显示成生码 tier_version。
    "tier_version": "档位版本",
}

# 枚举值 → 界面用词。标签源一律**复用 domain 层已有的权威常量**
# （SCALE_TYPE_LABELS / ROUNDING_MODE_LABELS / ARR_MODE_LABELS），不在这里重抄一遍中文 ——
# 重抄的那一份改不动也测不到，改了 domain 就漂移。
RULE_ENUM_LABELS = {
    "dimension": {"brand": "品牌", "product": "单品", "category": "品类",
                  "customer": "客户", "channel": "渠道"},
    "period_type": {"month": "月", "quarter": "季", "year": "年", "custom": "自定义"},
    "target_type": {"amount": "金额", "quantity": "数量"},
    "trigger_mode": {"on_target": "达成即返", "tiered": "阶梯"},
    "rebate_basis": {"rate": "按比例", "fixed": "按固定金额"},
    "is_active": {1: "已启用", 0: "已停用", "1": "已启用", "0": "已停用"},
    "auto_period_enabled": {1: "自动建表", 0: "手动建表",
                            "1": "自动建表", "0": "手动建表"},
    "scale_type": dict(SCALE_TYPE_LABELS),
    "rounding_mode": dict(ROUNDING_MODE_LABELS),
    "arrival_mode": dict(ARR_MODE_LABELS),
    "order_mode": dict(ARR_MODE_LABELS),
}

RULE_ACTION_LABELS = {
    "create": "新增目标",
    "update": "修改目标",
    "delete": "删除目标",
    "tier_add": "新增档位版本",
    "tier_del": "删除档位版本",
    # v364：到货停单按月调整。动作码必须在这里有中文 —— 否则修改日志弹窗
    # 会直接显示生码（"arrival_skip_set"），用户看不懂。
    "arrival_skip_set": "调整到货停单",
    "arrival_skip_clear": "取消到货停单",
}


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today():
    return date.today().isoformat()


# ---------------------------------------------------------------------------
# 阶段2: 品牌目标两层结构 —— monthly_amounts/monthly_rates 的解析与取月工具
# 同一契约与前端 Forecast.vue rebateSprint / src/utils/rebateCalc 共享（改须双边同步）
# ---------------------------------------------------------------------------
def _parse_monthly(raw):
    """解析月度 JSON（{"01":1100000,"08":1100000} 或 {"08":0.10}）。非法/空 → {}。"""
    if not raw:
        return {}
    if isinstance(raw, dict):
        obj = raw
    elif isinstance(raw, str):
        try:
            obj = _json.loads(raw) if raw.strip() else {}
        except Exception:
            return {}
    else:
        return {}
    out = {}
    for k, v in (obj or {}).items():
        mm = str(k).strip()
        if len(mm) == 1:
            mm = "0" + mm
        if mm.isdigit() and 1 <= int(mm) <= 12:
            try:
                out[mm] = float(v)
            except (TypeError, ValueError):
                continue
    return out


def _parse_monthly_tiers(raw):
    """v126：解析月度阶梯 {"01":[{from_pct,to_pct,rebate_rate,rebate_amount}...]}。

    只保留键为 01~12 且值为数组的项；非法/空 → {}。与 _parse_monthly 同构，
    但值是「档位数组」而不是数字，故不能复用。
    """
    if not raw:
        return {}
    if isinstance(raw, str):
        try:
            raw = _json.loads(raw) if raw.strip() else {}
        except Exception:
            return {}
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k, v in raw.items():
        mm = str(k).strip().zfill(2)
        if mm.isdigit() and 1 <= int(mm) <= 12 and isinstance(v, list):
            out[mm] = v
    return out


def _clean_tier_list(raw, rebate_basis, errors, label=""):
    """校验并清洗一个档位数组 —— 顶层 tiers_json 与某月 monthly_tiers[MM] 共用同一套规则。"""
    out = []
    for i, t in enumerate(raw or []):
        if not isinstance(t, dict):
            errors.append(f"{label}第 {i+1} 个阶梯格式错误")
            continue
        fp = _coerce_num(t.get("from_pct"), 0)
        tp = _coerce_num(t.get("to_pct"), 0)
        if not (fp < tp):
            errors.append(f"{label}第 {i+1} 个阶梯的 from_pct 必须小于 to_pct")
        tr = _coerce_num(t.get("rebate_rate"), 0)
        ta = _coerce_num(t.get("rebate_amount"), 0)
        if rebate_basis == "rate" and not (0 < tr <= 1):
            errors.append(f"{label}第 {i+1} 个阶梯的比例须在 (0,1] 之间")
        if rebate_basis == "fixed" and ta <= 0:
            errors.append(f"{label}第 {i+1} 个阶梯的固定金额必须大于 0")
        out.append({"from_pct": fp, "to_pct": tp,
                    "rebate_rate": tr, "rebate_amount": ta})
    return out


def _month_of(ym):
    """'2026-08' / '2026-8' → '08'；无法解析返回 ''。"""
    s = (ym or "").strip()
    if len(s) >= 7 and s[4] == "-":
        mm = s[5:7]
        return mm if mm.isdigit() and 1 <= int(mm) <= 12 else ""
    if len(s) == 6 and s[:4].isdigit() and s[4:6].isdigit():
        mm = s[4:6]
        return mm if 1 <= int(mm) <= 12 else ""
    return ""


def resolve_month_target(rule, ym):
    """取规则在 ym(YYYY-MM) 生效的目标金额：monthly_amounts[MM] 有值用之，否则回退 target_value(年框,兼容老数据)。"""
    amounts = _parse_monthly(rule.get("monthly_amounts"))
    mm = _month_of(ym)
    if mm and mm in amounts:
        return float(amounts[mm] or 0)
    return float(rule.get("target_value") or 0)


def resolve_month_rate(rule, ym):
    """取规则在 ym 的返利率：monthly_rates[MM] 有值用之；缺省向前找最近有值的月；再缺省回退顶层 rebate_rate。"""
    rates = _parse_monthly(rule.get("monthly_rates"))
    mm = _month_of(ym)
    if mm and mm in rates:
        return float(rates[mm] or 0)
    if mm:
        # 向前找（含跨年回绕 12→1），体现"默认继承上月/最近配置"
        keys = sorted(int(k) for k in rates if k.isdigit())
        if keys:
            cur = int(mm)
            for d in range(1, 13):
                probe = cur - d
                if probe < 1:
                    probe += 12
                if probe in keys:
                    return float(rates[f"{probe:02d}"] or 0)
    return float(rule.get("rebate_rate") or 0)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def _compute_status(r, today=None):
    """服务端计算规则生效状态（v112 R41）：inactive/upcoming/active/expired。

    用服务端日期而非客户端时钟，避免跨时区/改时钟导致状态显示不一致。
    """
    if not isinstance(r, dict):
        r = dict(r)  # sqlite3.Row → dict，兼容 .get()（2026-08-31 修复 500）
    if not r.get("is_active"):
        return "inactive"
    t = today or _today()
    s = str(r.get("effective_start") or "").strip()
    e = str(r.get("effective_end") or "").strip()
    if s and t < s:
        return "upcoming"
    if e and t > e:
        return "expired"
    return "active"


def _row_to_dict(r):
    return {
        "id": r["id"],
        "rule_name": r["rule_name"],
        "dimension": r["dimension"],
        "target_type": r["target_type"],
        "scope_key": r["scope_key"],
        "scope_name": r["scope_name"],
        "period_type": r["period_type"],
        "target_value": r["target_value"],
        "trigger_mode": r["trigger_mode"],
        "trigger_threshold": r["trigger_threshold"],
        "tiers_json": r["tiers_json"],
        "rebate_basis": r["rebate_basis"],
        "rebate_rate": r["rebate_rate"],
        "rebate_amount": r["rebate_amount"],
        "effective_start": r["effective_start"],
        "effective_end": r["effective_end"],
        "priority": r["priority"],
        "is_active": r["is_active"],
        "status": _compute_status(r),
        # v111: 归属的年度合同 id（0 = 独立规则，只进仪表盘 / 冲刺看板，不进合同计提）
        "contract_id": r["contract_id"] if "contract_id" in r.keys() else 0,
        # v113: 阶梯计法 + 舍入策略（老库缺列时给默认值，保证读取不炸）
        "scale_type": (r["scale_type"] if "scale_type" in r.keys() and r["scale_type"]
                       else DEFAULT_SCALE_TYPE_RULE),
        "rounding_mode": (r["rounding_mode"] if "rounding_mode" in r.keys() and r["rounding_mode"]
                          else DEFAULT_ROUNDING_MODE),
        "rounding_digits": (r["rounding_digits"] if "rounding_digits" in r.keys()
                            and r["rounding_digits"] is not None else DEFAULT_ROUNDING_DIGITS),
        # v116: 到货节奏（L2）—— 老库缺列时给默认值(0=用全局默认, ''=未设基准星期)，保证读取不炸
        "arrival_cadence_days": int(r["arrival_cadence_days"]) if "arrival_cadence_days" in r.keys()
                                and r["arrival_cadence_days"] is not None else 0,
        "arrival_base_dow": (r["arrival_base_dow"] if "arrival_base_dow" in r.keys()
                             and r["arrival_base_dow"] else ""),
        # v118: 到货排程引擎（L2细化）—— 老库缺列降级，保证读取不炸
        "arrival_mode": (r["arrival_mode"] if "arrival_mode" in r.keys() and r["arrival_mode"]
                         else "interval"),
        "arrival_first_dom": int(r["arrival_first_dom"]) if "arrival_first_dom" in r.keys()
                             and r["arrival_first_dom"] is not None else 1,
        "arrival_weekdays": (r["arrival_weekdays"] if "arrival_weekdays" in r.keys()
                             and r["arrival_weekdays"] else ""),
        "arrival_count_override": (int(r["arrival_count_override"]) if "arrival_count_override" in r.keys()
                                   and r["arrival_count_override"] is not None else None),
        # 阶段2: 品牌目标两层结构 —— 月度目标金额/月度返利率(JSON)，is_monthly 供前端识别"带月度分解"的规则
        "monthly_amounts": _parse_monthly(r["monthly_amounts"]) if "monthly_amounts" in r.keys() else {},
        "monthly_rates": _parse_monthly(r["monthly_rates"]) if "monthly_rates" in r.keys() else {},
        "is_monthly": bool("monthly_amounts" in r.keys() and (r["monthly_amounts"] or "")),
        # v126：月度阶梯 {"01":[{from_pct,to_pct,rebate_rate,rebate_amount}...]}。
        # 与 monthly_amounts/monthly_rates 同构 —— 三者合起来就是「一张 12 行的月表」。
        "monthly_tiers": (_json.loads(r["monthly_tiers"]) if "monthly_tiers" in r.keys()
                          and r["monthly_tiers"] else {}),
        # v121: 智能报单表（报单语义）—— 老库缺列时全部降级为默认，保证读取不炸。
        # 注意：_row_to_dict 是【白名单】，不加这里前端编辑时读不到已存配置（会被默认值覆盖）。
        "order_mode": (r["order_mode"] if "order_mode" in r.keys() and r["order_mode"]
                       else "interval"),
        "order_cadence_days": int(r["order_cadence_days"]) if "order_cadence_days" in r.keys()
                              and r["order_cadence_days"] is not None else 2,
        "order_weekdays": (r["order_weekdays"] if "order_weekdays" in r.keys()
                           and r["order_weekdays"] else ""),
        "order_first_date": (r["order_first_date"] if "order_first_date" in r.keys()
                             and r["order_first_date"] else ""),
        "order_lead_days": int(r["order_lead_days"]) if "order_lead_days" in r.keys() \
                           and r["order_lead_days"] is not None else 4,
        "order_max_early_days": int(r["order_max_early_days"]) if "order_max_early_days" in r.keys() \
                                and r["order_max_early_days"] is not None else 1,
        "auto_period_enabled": int(r["auto_period_enabled"]) if "auto_period_enabled" in r.keys() \
                               and r["auto_period_enabled"] is not None else 0,
        "auto_open_time": (r["auto_open_time"] if "auto_open_time" in r.keys()
                           and r["auto_open_time"] else "20:00"),
        "auto_close_time": (r["auto_close_time"] if "auto_close_time" in r.keys()
                            and r["auto_close_time"] else "10:00"),
        "supplier_deadline_time": (r["supplier_deadline_time"] if "supplier_deadline_time" in r.keys()
                                   and r["supplier_deadline_time"] else "12:00"),
        # v122: 目标年度 + 数量单位。老库缺列降级为空，保证读取不炸。
        "target_year": (int(r["target_year"]) if "target_year" in r.keys()
                        and r["target_year"] is not None else None),
        "target_unit": (r["target_unit"] if "target_unit" in r.keys()
                        and r["target_unit"] else ""),
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


def _ver_to_dict(r):
    """阶梯版本行 → 字典。

    ⚠️ **不能复用 `_row_to_dict`** —— 那个是 `rebate_target_rules` 的白名单转换，
    套到 `rebate_tier_versions` 行上会 IndexError（本表没有 rule_name / dimension 等列）。
    此前 list / create / get tier-versions 三个端点都误用了它，症状是
    **数据照常落库、接口却 500**（本表在租户库里 0 行，所以一直没人撞上）。
    """
    try:
        keys = r.keys()
    except Exception:
        return {}

    def _g(k, d=None):
        return r[k] if k in keys else d

    return {
        "id": _g("id"), "rule_id": _g("rule_id"), "version_no": _g("version_no", 0),
        "effective_start": _g("effective_start", ""), "effective_end": _g("effective_end", ""),
        "tiers_json": _g("tiers_json", ""),
        "scale_type": _g("scale_type") or DEFAULT_SCALE_TYPE_RULE,
        "rounding_mode": _g("rounding_mode") or DEFAULT_ROUNDING_MODE,
        "rounding_digits": (_g("rounding_digits") if _g("rounding_digits") is not None
                            else DEFAULT_ROUNDING_DIGITS),
        "note": _g("note", ""), "created_at": _g("created_at", ""),
    }


# ---------------------------------------------------------------------------
# v172：留痕 —— 值格式化 / 差异计算 / 落库
# ---------------------------------------------------------------------------
def _num_txt(v):
    """数值 → 留痕文本：去浮点尾巴。刻意**不补千分位** —— 千分位是展示层的事，
    由前端按 numeric 标志统一渲染（同一份数字只格式化一次）。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "" if v is None else str(v).strip()
    if f == int(f):
        return str(int(f))
    return repr(round(f, 6))


def _pct_txt(v):
    """比值 → 百分数。0.9 对业务没有意义，界面上它一直写作「90%」（同 thresholdText）。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "" if v is None else str(v).strip()
    txt = ("%.4f" % (f * 100)).rstrip("0").rstrip(".")
    return (txt or "0") + "%"


def _weekdays_txt(v):
    """1-7 / "2,6" → 「周二、周六」（与表单里星期 chip 的写法同源）。"""
    try:
        days = _parse_weekdays(v)
    except Exception:
        return "" if v is None else str(v).strip()
    if not days:
        return ""
    return "、".join("周" + WEEKDAY_LABELS.get(d, str(d)) for d in days)


def _monthly_txt(raw, percent=False):
    """月度 JSON → 紧凑摘要。

    12 个月同值（「全年目标自动均分」是常态）折叠成「12 个月均 8,000」；否则逐月列出，
    超 6 个月截断 —— 日志是给人看的，不是 JSON 转储。
    """
    try:
        d = _parse_monthly(raw)
    except Exception:
        d = {}
    if not d:
        return ""
    keys = sorted(d.keys())
    fmt = _pct_txt if percent else _num_txt
    vals = [d[k] for k in keys]
    if len(keys) > 1 and all(str(v) == str(vals[0]) for v in vals):
        return "%d 个月均 %s" % (len(keys), fmt(vals[0]))
    body = "；".join("%d月 %s" % (int(k), fmt(d[k])) for k in keys[:6])
    if len(keys) > 6:
        body += "；…共 %d 个月" % len(keys)
    return body


def _monthly_tiers_txt(raw):
    """月度档位 → 「1月 3 档；2月 3 档」。档位明细不在这里展开（太长，且月表里看得见）。"""
    try:
        d = _parse_monthly_tiers(raw)
    except Exception:
        d = {}
    if not d:
        return ""
    keys = sorted(d.keys())
    body = "；".join("%d月 %d 档" % (int(k), len(d[k] or [])) for k in keys[:6])
    if len(keys) > 6:
        body += "；…共 %d 个月" % len(keys)
    return body


def _tiers_txt(raw):
    """阶梯档位 → 「100%~120% 返 3%」式摘要。to_pct≥9.9 是「无上限」哨兵（前端用 999）。"""
    items = raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return ""
        try:
            items = _json.loads(s)
        except Exception:
            return s[:120]
    if not isinstance(items, list) or not items:
        return ""
    parts = []
    for t in items[:6]:
        if not isinstance(t, dict):
            continue
        try:
            lo = float(t.get("from_pct") or 0) * 100
        except (TypeError, ValueError):
            lo = 0.0
        try:
            hi = float(t.get("to_pct") or 0)
        except (TypeError, ValueError):
            hi = 0.0
        span = "以上" if hi >= 9.9 else "%.0f%%" % (hi * 100)
        money = ""
        try:
            if float(t.get("rebate_rate") or 0):
                money = "返 " + _pct_txt(t.get("rebate_rate"))
            elif float(t.get("rebate_amount") or 0):
                money = "返 ¥" + _num_txt(t.get("rebate_amount"))
        except (TypeError, ValueError):
            money = ""
        parts.append("%.0f%%~%s%s" % (lo, span, (" " + money) if money else ""))
    if len(items) > 6:
        parts.append("…共 %d 档" % len(items))
    return "；".join(parts)


def _contract_name(conn, cid):
    """contract_id → 合同显示名（与界面「归属合同」下拉同构：合作方 · 年份）。"""
    try:
        n = int(cid or 0)
    except (TypeError, ValueError):
        return ""
    if not n or conn is None:
        return ""
    try:
        r = conn.execute("SELECT * FROM rebate_contracts WHERE id=?", (n,)).fetchone()
    except Exception:
        return ""
    if not r:
        return ""
    keys = r.keys()
    name = str((r["contact_name"] if "contact_name" in keys else "") or "").strip()
    year = str((r["year"] if "year" in keys else "") or "").strip()
    parts = [x for x in (name, year) if x]
    return " · ".join(parts) or ("合同 #%d" % n)


def _rule_val_txt(field, v, conn=None):
    """字段值 → 留痕文本（用词与规则详情弹窗同源）。

    同一个字段的 old / new 都走这里 ⇒ 类型差异（dict vs JSON 串、0 vs "0"）被吸收掉，
    比的是「业务上是否变了」，不是「Python 对象是否相等」。
    """
    if v is None:
        return ""
    if isinstance(v, str) and not v.strip():
        return ""
    if isinstance(v, dict) and not v:
        return ""
    if isinstance(v, (list, tuple)) and not v:
        return ""
    enums = RULE_ENUM_LABELS.get(field)
    if enums is not None:
        if v in enums:
            return str(enums[v])
        sv = str(v).strip()
        return str(enums[sv]) if sv in enums else sv
    if field in ("trigger_threshold", "rebate_rate"):
        return _pct_txt(v)
    if field == "monthly_rates":
        return _monthly_txt(v, percent=True)
    if field in ("monthly_amounts",):
        return _monthly_txt(v)
    if field == "monthly_tiers":
        return _monthly_tiers_txt(v)
    if field == "tiers_json":
        return _tiers_txt(v)
    if field in ("order_weekdays", "arrival_weekdays", "arrival_base_dow"):
        return _weekdays_txt(v)
    if field == "contract_id":
        # 数字对用户没有意义；但合同被删后仍需可读，故回退成 #id 而不是留空
        return _contract_name(conn, v) or ("合同 #%s" % _num_txt(v) if _num_txt(v) not in ("", "0") else "")
    if field in RULE_NUM_FIELDS:
        return _num_txt(v)
    if isinstance(v, (dict, list)):
        try:
            return _json.dumps(v, ensure_ascii=False)[:160]
        except Exception:
            return str(v)[:160]
    return str(v).strip()


def _rule_ref(rule_name, dimension="", scope_name="", scope_key=""):
    """日志「对象」列 = 规则名称。

    规则名是本页的天然主标识，且规则被删后它仍留在历史里（这正是留痕的意义）。
    规则名为空时回退「维度 · 作用对象」，保证任何一条记录都能定位到对象。
    """
    name = str(rule_name or "").strip()
    if name:
        return name
    dim = RULE_ENUM_LABELS["dimension"].get(dimension, dimension or "")
    obj = str(scope_name or scope_key or "").strip() or "全部"
    return "%s · %s" % (dim, obj)


def _rule_ref_of(row):
    """从一条规则行取「对象」列文本。行可能缺失（规则已删）或来自缺列的老库，故全程带保护。"""
    if row is None:
        return ""
    try:
        keys = row.keys()
        def _g(k):
            return row[k] if k in keys else ""
        return _rule_ref(_g("rule_name"), _g("dimension"), _g("scope_name"), _g("scope_key"))
    except Exception:
        return ""


def _rule_field_changes(old_row, new_row, conn=None):
    """逐字段比对，只留**真的变了**的字段。

    与达成填报的关键差别：那边是「部分更新」语义（请求体出现即记）；这边表单提交的是
    **全量字段** —— 若按「出现即记」，用户只改一个目标值也会刷出 40 行"其实没变"的记录，
    日志立刻失去可读性。故此处一律按值比对。
    """
    out = []
    if not new_row:
        return out
    for f in RULE_LOG_FIELDS:
        if f not in new_row:
            continue
        old_txt = _rule_val_txt(f, (old_row or {}).get(f), conn) if old_row else ""
        new_txt = _rule_val_txt(f, new_row.get(f), conn)
        if old_txt != new_txt:
            out.append((f, old_txt, new_txt))
    return out


def _tier_version_txt(row):
    """档位版本 → 「#2 · 2026-01-01 起 · 100%~120% 返 3%」式摘要。"""
    if not row:
        return ""
    try:
        keys = row.keys()
    except Exception:
        return str(row)[:120]
    parts = []
    no = row["version_no"] if "version_no" in keys else None
    if no:
        parts.append("#%s" % _num_txt(no))
    s = str(row["effective_start"] if "effective_start" in keys else "") or ""
    e = str(row["effective_end"] if "effective_end" in keys else "") or ""
    if s or e:
        parts.append("%s ~ %s" % (s or "不限", e or "不限"))
    t = _tiers_txt(row["tiers_json"] if "tiers_json" in keys else "")
    if t:
        parts.append(t)
    note = str(row["note"] if "note" in keys else "") or ""
    if note.strip():
        parts.append(note.strip())
    return " · ".join(parts)


def _log_rule_change(request, rule_id, action, changes, ref):
    """写规则字段级修改日志（委托公共壳；失败只告警，不阻断用户的目标配置）。"""
    return fl.safe_log(RULE_ENTITY, rule_id, request, changes, action=action,
                       ref=ref, tag="rebate-rule-log")


def _is_valid_date(s):
    if not s:
        return True
    try:
        datetime.strptime(s, DATE_FMT)
        return True
    except Exception:
        return False


def _ranges_overlap(s1, e1, s2, e2):
    """两个 [start,end] 日期区间是否重叠(''=无界)。字符串比较对 YYYY-MM-DD 有效。"""
    lo1, hi1 = (s1 or "0000-00-00"), (e1 or "9999-99-99")
    lo2, hi2 = (s2 or "0000-00-00"), (e2 or "9999-99-99")
    return not (hi1 < lo2 or hi2 < lo1)


# ---------------------------------------------------------------------------
# v125：跨周期口径的「月份覆盖集合」
# ---------------------------------------------------------------------------
# 背景（真实事故）：同一品牌（蒙牛低温）、同一月份（2026-09）存在两条目标 ——
# 一条 period_type=month（单期入口，生效期 2026-09-01~09-30），
# 一条 period_type=year（年度入口，12 月分解含 09，生效期为空=全年）。
# 旧 detect_conflicts 把 period_type 写进匹配键，两条口径不同的规则互相"看不见"，
# 于是仪表盘/柱状图按 rule 逐条试算求和 → 9 月目标与返利双双重复计数。
# 唯一可靠的判重维度不是 period_type，而是**规则实际覆盖哪些月份**。
#
# 实现下沉到 domain/rebate_period（只依赖标准库）—— erp_db 的迁移与回填也要用，
# 放在本模块会与 erp_db 成环（partially initialized module）。
from domain.rebate_period import (  # noqa: F401  （下方别名保留旧调用点）
    MONTH_KEYS,
    covered_months,
    month_in_range as _month_in_range,
    months_between as _months_between,
    rule_covers_date,
    rule_year as _rule_year,
)


# v292（2026-09-27）删除本地 `_effective_contains(start, end, ref)`：
# 它是纯日粒度的区间比较，与 `domain.rebate_period.rule_covers_date` **语义不等价**
# （后者对「有月度分解」的规则看的是"该月分解里有没有目标"，不逐月裁剪生效期）。
# 留着它就是留一个随时会被再次误用的第二实现 —— 本模块只保留唯一判据。


def _coerce_num(v, default=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _is_num_like(v):
    """v360：`v` 是否是一个**显式给出的数字**（数字串 '0' / '0.00' 也算）。

    🔴 为什么不能直接拿 `_coerce_num` 的结果去判：它把**空串 / None / 'abc'** 一律压成
    default(0)，于是「没填」「填了非数字」「显式填 0」在它眼里**完全一样**。
    而本轮的验收要求恰好是「0 放行、空与非数字继续拦」—— 必须能区分这三者。
    负数是数字（返回 True），越界与否交给调用方判，别在这里混进范围逻辑。
    """
    if v is None or isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return False
        try:
            float(s)
            return True
        except ValueError:
            return False
    return False


# ---- v121 智能报单表：格式校验工具 ----
def _valid_hhmm(s):
    """'HH:MM' 合法（00:00~23:59）返回 True。"""
    try:
        h, m = str(s or "").strip().split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59
    except Exception:
        return False


def _valid_ymd(s):
    """'YYYY-MM-DD' 合法且是真实存在的日期返回 True（拦 2/30 这类）。"""
    try:
        y, m, d = [int(x) for x in str(s or "").strip().split("-")[:3]]
        date(y, m, d)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# v122 Step4：维度归口（把原先只写在前端 save() 的强制规则下沉到后端）
# ---------------------------------------------------------------------------
_ORDER_ZERO = (
    "order_mode", "order_cadence_days", "order_weekdays", "order_first_date",
    "order_lead_days", "order_max_early_days",
    "auto_open_time", "auto_close_time", "supplier_deadline_time",
)


def _normalize_by_dimension(cleaned):
    """按 dimension 强制归口，防止 API 直调写入「页面不允许」的组合。

    品牌 + 年度（12 个月分解）：
      - 目标度量只能是金额
      - 返利只能是「达成即返 + 按月返利率」—— 月度返利与「按全年达成率分档」的阶梯天然互斥
      - 顶层 rebate_rate 取最早非零月兜底（与前端一致，供详情/试算展示）
    品牌 + 单期（月，单值）：保留阶梯 / 固定金额（UI 已开放触发方式），不强制
    商品维度：不带月度分解；报单节奏是品牌方排产节点，无实际配置时归零
    """
    dim = cleaned.get("dimension")
    if dim == "brand":
        cleaned["target_type"] = "amount"
        if cleaned.get("monthly_amounts"):
            # 有月度分解即年度口径（前端年度模式固定写 year，这里兜底防 API 直传 month）
            cleaned["period_type"] = "year"
            # v126：不再强制「达成即返」—— 逐月阶梯(monthly_tiers) 与逐月返利率(monthly_rates)
            # 同为合法年框口径，由触发方式自选；仅在非阶梯模式时兜底成达成即返。
            if cleaned.get("trigger_mode") != "tiered":
                cleaned["trigger_mode"] = "on_target"
                cleaned["trigger_threshold"] = 1.0
                cleaned["rebate_basis"] = "rate"
                cleaned["rebate_amount"] = 0
            try:
                rates = _json.loads(cleaned.get("monthly_rates") or "{}") or {}
            except Exception:
                rates = {}
            hits = sorted((mm for mm, v in rates.items() if float(v or 0) > 0))
            if hits:
                cleaned["rebate_rate"] = float(rates[hits[0]])
        return cleaned

    # 商品维度：月度分解一律不参与
    cleaned["monthly_amounts"] = ""
    cleaned["monthly_rates"] = ""
    cleaned["monthly_tiers"] = ""
    # 报单节奏归零 —— 仅当「没有真实节奏配置」时才清，避免静默抹掉既有排程
    if not cleaned.get("order_first_date") and not cleaned.get("auto_period_enabled"):
        for _k in _ORDER_ZERO:
            cleaned[_k] = "" if isinstance(cleaned.get(_k), str) else 0
        cleaned["auto_period_enabled"] = 0
    return cleaned


# ---------------------------------------------------------------------------
# v282（2026-09-26）：节奏规则（只配到货/报单节奏、不设返利目标）
# ---------------------------------------------------------------------------
# 🔴 唯一实现，**只此一处**。凡是要问「这条规则会不会产生返利 / 该不该占月份锁 /
#    算不算和别的规则冲突」，一律调本函数 —— 各处各写一份判定必然漂移。
#
# 背景（产线真实卡点，不是为方便）：
#   报单页「均单目标」提示的前置之一是「该**品牌**有启用的到货规则」
#   （`routers/product_targets.py::_arrival_ctx`：按品牌名精确匹配、**无任何兜底**）。
#   而到货节奏只能存在 `rebate_target_rules` 这张表里 ⇒ 想给品牌配节奏就得建一条「规则」，
#   可是经销商手里往往**只有部分品牌有厂商下发的返利目标**
#   （生产实测 2026-09-26：3 条 brand 规则 vs products 里 15+ 个品牌）。
#   原校验「目标值必须 > 0」会把这条路封死 ⇒ 逼用户编假目标 ⇒ 污染达成/KPI。
#
# 判定（缺一不可）：① 无目标值 ② 无月度金额分解 ③ **确实配了节奏**
def _row_rhythm_only(row):
    """`row` 是规则 dict（原始入参或 DB 行都可）。"""
    if not isinstance(row, dict):
        return False
    try:
        tv = float(row.get("target_value") or 0)
    except (TypeError, ValueError):
        tv = 0.0
    if tv > 0 or _parse_monthly(row.get("monthly_amounts")):
        return False

    def _n(k):
        try:
            return int(row.get(k) or 0)
        except (TypeError, ValueError):
            return 0

    return (bool(str(row.get("order_first_date") or "").strip())
            or _n("order_cadence_days") > 0
            or bool(str(row.get("order_weekdays") or "").strip())
            or _n("arrival_cadence_days") > 0
            or bool(str(row.get("arrival_weekdays") or "").strip()))


# ---------------------------------------------------------------------------
# 校验逻辑
# ---------------------------------------------------------------------------
def validate_rule(r, conn=None, exclude_id=None):
    """返回 (errors:list[str], cleaned:dict|None)。cleaned 含规整后的字段与解析后的 tiers。

    exclude_id: 更新时传当前规则 id —— 用于「智能开关租户内唯一」等需要排除自身的校验。
    """
    errors = []
    if not isinstance(r, dict):
        return ["规则必须是对象"], None

    name = (r.get("rule_name") or "").strip()
    if not name:
        errors.append("规则名称(rule_name)不能为空")

    dimension = (r.get("dimension") or "brand")
    if dimension not in DIMENSIONS:
        errors.append(f"计算维度(dimension)必须是 {DIMENSIONS}")
        dimension = None

    target_type = (r.get("target_type") or "amount")
    if target_type not in TARGET_TYPES:
        errors.append(f"目标度量(target_type)必须是 {TARGET_TYPES}")
        target_type = None

    # 维度/目标度量一致性: 品牌维度目标固定按金额
    if dimension == "brand" and target_type == "quantity":
        errors.append("品牌维度(brand)的目标只能按金额(amount), 不能选数量")

    period_type = (r.get("period_type") or "month")
    if period_type not in PERIOD_TYPES:
        errors.append(f"周期口径(period_type)必须是 {PERIOD_TYPES}")

    # v122: 目标年度(target_year) —— 12 个月分解必须有年份，否则跨年后无法区分是哪一年的分解。
    #   空 = 未指定（老规则），由生效期推断；填了就必须是 2000-2100 的整数。
    _ty = r.get("target_year")
    target_year = None
    if _ty not in (None, "", "null", 0, "0"):
        try:
            target_year = int(_ty)
            if not (2000 <= target_year <= 2100):
                errors.append("目标年度(target_year)须在 2000-2100 之间")
                target_year = None
        except (TypeError, ValueError):
            errors.append("目标年度(target_year)须为整数(如 2026)")
    # v122: 数量单位(target_unit) —— 数量目标没单位会导致看板/返利歧义（箱/件/提）。
    target_unit = str(r.get("target_unit") or "").strip()
    if len(target_unit) > 16:
        errors.append("数量单位(target_unit)不能超过 16 个字符")
        target_unit = target_unit[:16]

    target_value = _coerce_num(r.get("target_value"), 0)
    # v282：「只配节奏、不设返利目标」的品牌规则允许存在（判定见上方 `_row_rhythm_only`）。
    #   两条硬校验同时放行：目标值>0、返利率>0；且本类规则**不产生任何返利**
    #   （`domain/rebate_calc`：`target<=0 ⇒ 达成率 None ⇒ 不触发`，实测无除零风险），
    #   也**不占用月份锁、不参与冲突判重**（它没有目标，不可能造成返利重复计提）。
    rhythm_only = _row_rhythm_only(r)
    # 阶段2: 品牌目标带月度金额分解时，年框可缺省（由月合计兜底），此处放宽 >0 硬校验
    if target_value <= 0 and not _parse_monthly(r.get("monthly_amounts")) and not rhythm_only:
        errors.append("目标值(target_value)必须大于 0"
                      "（若这条规则只用来配「到货节奏」，请先填「首次报单日」或报单周期）")

    trigger_mode = (r.get("trigger_mode") or "on_target")
    if trigger_mode not in TRIGGER_MODES:
        errors.append(f"触发条件(trigger_mode)必须是 {TRIGGER_MODES}")
        trigger_mode = None

    trigger_threshold = _coerce_num(r.get("trigger_threshold"), 1.0)
    if trigger_mode == "on_target":
        if not (0 < trigger_threshold <= 1):
            errors.append("达成即返门槛(trigger_threshold)须在 (0,1] 之间(如 1.0=达成100%才返, 0.8=达成80%即返)")

    rebate_basis = (r.get("rebate_basis") or "rate")
    if rebate_basis not in REBATE_BASES:
        errors.append(f"返利形式(rebate_basis)必须是 {REBATE_BASES}")
        rebate_basis = None

    rebate_rate = _coerce_num(r.get("rebate_rate"), 0)
    rebate_amount = _coerce_num(r.get("rebate_amount"), 0)

    tiers = []
    monthly_tiers_raw = _parse_monthly_tiers(r.get("monthly_tiers"))
    if trigger_mode == "tiered":
        raw = r.get("tiers_json")
        if isinstance(raw, str):
            try:
                raw = _json.loads(raw) if raw.strip() else []
            except Exception:
                raw = None
        # v126：月度阶梯(monthly_tiers)可以完全替代顶层阶梯 —— 逐月配档位时顶层即回退档位
        if isinstance(raw, list) and raw:
            tiers = _clean_tier_list(raw, rebate_basis, errors)
        elif not monthly_tiers_raw:
            errors.append("阶梯模式(tiered)必须提供非空的 tiers_json 数组或 monthly_tiers 月度档位")
        monthly_tiers = {}
        for mm in sorted(monthly_tiers_raw):
            cleaned_mm = _clean_tier_list(monthly_tiers_raw[mm], rebate_basis,
                                          errors, label=f"{mm} 月")
            if cleaned_mm:
                monthly_tiers[mm] = cleaned_mm
    else:
        monthly_tiers = {}
        # on_target 模式用顶层 rebate 字段。
        # 阶段2: 品牌目标带月度返利(monthly_rates)时，顶层 rate 允许为 0（月月有值即合法，未列月不触发）。
        # v282: 「节奏规则」（rhythm_only，无目标无分解）同样允许 rate=0 —— 它压根不该产生返利。
        _has_mr = bool(_parse_monthly(r.get("monthly_rates")))
        # v360：比例返利**允许填 0** —— 代表该目标**确实没有返利**。
        #   🔴 不能只把 `0 <` 改成 `0 <=`：`_coerce_num` 把空串 / None / 'abc' 全压成 0，
        #      一放宽就会把「没填」和「填了 abc」一起放行。所以先判**是不是数字**再判范围。
        # v769：品牌月度目标**允许留空**（部分厂家本身没有返利，不该逼用户编一个费率）。
        #   只放行「空串 / None」，且限定 `品牌 + 有月度金额分解`：
        #     · 非数字 / 负数 / >1 仍然拦 —— 用户要的是「不用填」，不是「随便填」；
        #     · 单值模式（商品 / 单期）没有月度分解 ⇒ 维持 v360 口径，前端仍拦留空。
        #   前端同时把「有金额 + 费率留空」的月份显式落 0（buildMonthlyPayloads），
        #   否则 resolve_month_rate 向前继承会把前一个月的费率套到空月上。
        _brand_monthly = (dimension == "brand"
                          and bool(_parse_monthly(r.get("monthly_amounts"))))
        if rebate_basis == "rate" and not _has_mr and not rhythm_only:
            _rr_raw = r.get("rebate_rate")
            _rr_blank = (_rr_raw is None
                         or (isinstance(_rr_raw, str) and not _rr_raw.strip()))
            if _brand_monthly and _rr_blank:
                pass                  # 空 = 无返利，_coerce_num 已归一为 0
            elif not _is_num_like(_rr_raw):
                errors.append("比例返利(rebate_rate)必须是数字"
                              "（本月确实没有返利可留空或填 0，不要填非数字）")
            elif not (0 <= rebate_rate <= 1):
                errors.append("比例返利(rebate_rate)须在 [0,1] 之间(如 0.03=3%；填 0 = 本月无返利)")
        if rebate_basis == "fixed" and rebate_amount <= 0 and not rhythm_only:
            errors.append("固定返利(rebate_amount)必须大于 0")

    # v113: 阶梯计法（仅 tiered 有意义；on_target 无档位，忽略即可）
    scale_type = str(r.get("scale_type") or "").strip() or DEFAULT_SCALE_TYPE_RULE
    if scale_type not in SCALE_TYPES:
        errors.append(f"阶梯计法(scale_type)必须是 {SCALE_TYPES}")
    # v113: 舍入策略
    rounding_mode = str(r.get("rounding_mode") or "").strip() or DEFAULT_ROUNDING_MODE
    if rounding_mode not in ROUNDING_MODES:
        errors.append(f"舍入模式(rounding_mode)必须是 {ROUNDING_MODES}")
    rounding_digits = _norm_digits(r.get("rounding_digits"))

    # v116: 到货节奏（L2）—— 品牌维度专属。0 = 用全局默认(tenant_params.default_arrival_cadence_days, 默认2)。
    arrival_cadence_days = int(_coerce_num(r.get("arrival_cadence_days"), 0))
    if arrival_cadence_days < 0:
        errors.append("到货周期天数(arrival_cadence_days)不能为负")
    # 兼容旧字段（L2 初版），新逻辑以 arrival_mode/arrival_weekdays 为准
    arrival_base_dow = str(r.get("arrival_base_dow") or "").strip()
    if arrival_base_dow:
        _dow_parts = [p.strip() for p in arrival_base_dow.split(",") if p.strip()]
        _dow_ok = True
        for p in _dow_parts:
            if not (p.isdigit() and 1 <= int(p) <= 7):
                _dow_ok = False
                break
        if not _dow_ok:
            errors.append("基准到货星期(arrival_base_dow)须为 1-7 的逗号分隔数字（1=周一,7=周日）")
        else:
            arrival_base_dow = ",".join(_dow_parts)

    # v118: 到货排程引擎（L2细化）—— 双模式：按间隔天数 / 按固定星期
    arrival_mode = str(r.get("arrival_mode") or "").strip() or MODE_INTERVAL
    if arrival_mode not in ARR_MODES:
        errors.append(f"到货模式(arrival_mode)必须是 {ARR_MODES}")
    arrival_first_dom = int(_coerce_num(r.get("arrival_first_dom"), 1))
    if not (1 <= arrival_first_dom <= 31):
        errors.append("首次到货日(arrival_first_dom)须为 1-31 的月内日")
    arrival_weekdays = str(r.get("arrival_weekdays") or "").strip()
    if arrival_weekdays:
        _wd = _parse_weekdays(arrival_weekdays)
        if not _wd:
            errors.append("到货星期(arrival_weekdays)须为 1-7 的逗号分隔数字（1=周一,7=周日）")
        else:
            arrival_weekdays = ",".join(str(x) for x in _wd)
    # 本月到货次数手动覆盖（节假日停单等）；None 或 <=0 表示不覆盖
    _oco = r.get("arrival_count_override")
    arrival_count_override = None
    if _oco not in (None, "", "null"):
        try:
            _oco_i = int(_oco)
            if _oco_i < 0:
                errors.append("到货次数覆盖(arrival_count_override)不能为负")
            elif _oco_i > 0:
                arrival_count_override = _oco_i
        except (TypeError, ValueError):
            errors.append("到货次数覆盖(arrival_count_override)须为整数")

    # 日期
    eff_start = (r.get("effective_start") or "").strip()
    eff_end = (r.get("effective_end") or "").strip()
    if eff_start and not _is_valid_date(eff_start):
        errors.append(f"生效开始(effective_start)须为 {DATE_FMT}")
    if eff_end and not _is_valid_date(eff_end):
        errors.append(f"生效结束(effective_end)须为 {DATE_FMT}")
    if eff_start and eff_end and eff_start > eff_end:
        errors.append("生效开始不能晚于生效结束")

    # 作用对象: 单品维度若提供数字 scope_key, 校验商品存在
    scope_key = (r.get("scope_key") or "").strip()
    scope_name = (r.get("scope_name") or "").strip()
    # 品牌维度：品牌名即作用对象 key；防止前端/API 漏传 scope_key 导致空 key 冲突误判
    if dimension == "brand" and scope_name:
        scope_key = scope_name
    if dimension == "product" and scope_key and scope_key.isdigit() and conn is not None:
        row = conn.execute("SELECT name FROM products WHERE id=?", (int(scope_key),)).fetchone()
        if not row:
            errors.append(f"单品作用对象(scope_key={scope_key})在商品库中不存在")
        elif not scope_name:
            scope_name = row["name"]
    elif dimension == "product" and scope_name and conn is not None:
        # v122：前端提交的是商品名（或解析失败的串）—— 按 name 反查回填商品 ID，
        # 否则 scope_key 为空 =「作用于全部单品」，与用户意图不符且易与其他规则互判冲突
        try:
            row = conn.execute("SELECT id FROM products WHERE name=? LIMIT 1", (scope_name,)).fetchone()
        except Exception:
            row = None
        if row:
            scope_key = str(row["id"])
    # v113 维度扩展：category/customer/channel 的作用对象即其名称（轻校验，不阻断创建）
    if dimension in ("category", "customer", "channel") and scope_name:
        scope_key = scope_name.strip()
        if dimension == "channel" and scope_key not in {c["value"] for c in CHANNEL_OPTIONS}:
            errors.append(f"渠道(channel)必须是 {[c['value'] for c in CHANNEL_OPTIONS]} 之一")

    if errors:
        return errors, None

    # v111: 归属合同 —— 挂到合同的规则才会进入该合同的月度计提 / 结算链路
    contract_id = int(_coerce_num(r.get("contract_id"), 0))
    if contract_id and conn is not None:
        try:
            if not conn.execute("SELECT id FROM rebate_contracts WHERE id=?",
                                (contract_id,)).fetchone():
                errors.append(f"归属合同(contract_id={contract_id})不存在")
        except Exception:
            pass  # 表不存在时跳过校验，交由数据层降级处理

    # 阶段2: 品牌目标两层结构 —— 可选月度分解(金额层 monthly_amounts) + 月度返利(返利层 monthly_rates)。
    # 键为 "01"~"12"；金额 ≥0(元)，返利率 0~1(小数)。仅品牌维度允许月度分解(单品天然按月一条, 见口径)。
    monthly_amounts = _parse_monthly(r.get("monthly_amounts"))
    monthly_rates = _parse_monthly(r.get("monthly_rates"))
    if monthly_amounts and dimension != "brand":
        errors.append("月度目标分解(monthly_amounts)仅品牌维度(brand)支持")
    if monthly_rates and dimension != "brand":
        errors.append("月度返利(monthly_rates)仅品牌维度(brand)支持")
    for mm, amt in monthly_amounts.items():
        if amt < 0:
            errors.append(f"{mm} 月目标金额不能为负")
    for mm, rt in monthly_rates.items():
        if not (0 <= rt <= 1):
            errors.append(f"{mm} 月返利率须在 [0,1] 之间(如 0.1=10%)")
    # 有月度金额时自动抬年度总额 = 各月之和（金额层年框 = Σ月分解），并强制年周期语义
    if monthly_amounts:
        _sum_m = round(sum(monthly_amounts.values()), 2)
        if target_value <= 0:
            target_value = _sum_m  # 容错: 未填年框时用月合计兜底
        if period_type not in ("year", "custom"):
            period_type = "year"
    # 返利层有值但顶层比例未填 → 取最早非零月兜底（未列月份不触发；后端 compute 用顶层仅当无月度值）
    if monthly_rates and rebate_rate <= 0:
        for _k in sorted(monthly_rates):
            if monthly_rates[_k] > 0:
                rebate_rate = monthly_rates[_k]
                break

    # v126：统一月度模型 —— 「单期」不再是另一种口径，而是月表里只占一格。
    # 未给月度分解时按生效期自动落格：整月单期 → 一格；跨多个自然月 → 按月均摊。
    # 跨年不归一（11/15~01/10 会落在 '11','12','01'，同规则内月份号会撞车），交由生效期判重兜底。
    if not monthly_amounts and dimension == "brand" and target_value > 0:
        _yms = sorted(_months_between(eff_start, eff_end))
        if _yms and len({_ym[:4] for _ym in _yms}) == 1:
            _per = round(float(target_value) / len(_yms), 2)
            monthly_amounts = {_month_of(_ym): _per for _ym in _yms if _month_of(_ym)}
            if monthly_amounts and period_type not in ("year", "custom"):
                period_type = "year"

    # ---- v121 智能报单表：报单排程（报单语义）+ 三个时点 ----
    order_mode = (r.get("order_mode") or MODE_INTERVAL).strip() or MODE_INTERVAL
    if order_mode not in ARR_MODES:
        errors.append(f"报单模式(order_mode)须为 {'/'.join(ARR_MODES)}")
    order_cadence_days = int(_coerce_num(r.get("order_cadence_days"), 0))
    order_weekdays = (r.get("order_weekdays") or "").strip()
    if order_weekdays:
        order_weekdays = ",".join(str(x) for x in _parse_weekdays(order_weekdays))  # 归一化：去重升序
    order_first_date = (r.get("order_first_date") or "").strip()
    order_lead_days = int(_coerce_num(r.get("order_lead_days"), 4))
    order_max_early_days = int(_coerce_num(r.get("order_max_early_days"), 1))
    auto_period_enabled = 1 if r.get("auto_period_enabled") else 0
    auto_open_time = (r.get("auto_open_time") or "20:00").strip() or "20:00"
    auto_close_time = (r.get("auto_close_time") or "10:00").strip() or "10:00"
    supplier_deadline_time = (r.get("supplier_deadline_time") or "12:00").strip() or "12:00"

    for _lbl, _v in (("开放填报时刻", auto_open_time), ("自动关单时刻", auto_close_time),
                     ("厂家下单截止时刻", supplier_deadline_time)):
        if not _valid_hhmm(_v):
            errors.append(f"{_lbl}({_v})格式须为 HH:MM")
    if _valid_hhmm(auto_close_time) and _valid_hhmm(supplier_deadline_time) \
            and auto_close_time >= supplier_deadline_time:
        errors.append(
            f"自动关单时刻({auto_close_time})必须早于厂家下单截止时刻({supplier_deadline_time})"
            " —— 中间要留给经理改单、付款、款到厂家账的时间")
    # 跨日无需校验 T_open < T_close：开放始终在报单日【前一日】，
    # 即使 open=23:59 / close=00:01 也仍相隔 2 分钟，恒递增（R4 由此天然消除）。

    if order_lead_days < 0 or order_lead_days > 30:
        errors.append("报单提前天数(order_lead_days)须在 [0,30]")
    if order_max_early_days < 0 or order_max_early_days > ORDER_MAX_EARLY_LIMIT:
        errors.append(
            f"可提前天数(order_max_early_days)须在 [0,{ORDER_MAX_EARLY_LIMIT}]"
            "（提前太久，报单准确性会非常低）")

    # 开启智能开关 或 已填首次报单日 -> 强校验排程完整性
    if auto_period_enabled == 1 or order_first_date:
        if not order_first_date:
            errors.append("开启「智能创建/关闭报单表」必须填写首次报单日")
        elif not _valid_ymd(order_first_date):
            errors.append(f"首次报单日({order_first_date})格式须为 YYYY-MM-DD")
        if order_mode == MODE_INTERVAL:
            if order_cadence_days < 1 or order_cadence_days > 31:
                errors.append("报单模式为「按间隔天数」时，报单周期须在 [1,31] 天")
        elif not order_weekdays:
            errors.append("报单模式为「按固定星期」时，至少选择一个报单星期")

    # 租户内智能开关唯一：多个品牌各自开启会产出多套报单表互相冲突
    if auto_period_enabled == 1 and conn is not None:
        try:
            _ex = int(exclude_id or 0)
            _dup = conn.execute(
                "SELECT id, rule_name FROM rebate_target_rules "
                "WHERE auto_period_enabled=1 AND is_active=1 AND id<>?", (_ex,)).fetchall()
            if _dup:
                errors.append(
                    "智能创建/关闭报单表同一时间只能开启一条，当前已开启："
                    f"{_dup[0]['rule_name'] or ('规则#' + str(_dup[0]['id']))}")
        except Exception:
            pass

    if errors:
        return errors, None

    cleaned = {
        "rule_name": name,
        "dimension": dimension,
        "target_type": target_type,
        "scope_key": scope_key,
        "scope_name": scope_name,
        "period_type": period_type,
        "target_value": target_value,
        # v122
        "target_year": target_year,
        "target_unit": target_unit,
        "trigger_mode": trigger_mode,
        "trigger_threshold": trigger_threshold,
        "tiers_json": _json.dumps(tiers, ensure_ascii=False) if tiers else "",
        "rebate_basis": rebate_basis,
        "rebate_rate": rebate_rate,
        "rebate_amount": rebate_amount,
        "effective_start": eff_start,
        "effective_end": eff_end,
        "priority": int(_coerce_num(r.get("priority"), 0)),
        "is_active": 1 if r.get("is_active", 1) else 0,
        "contract_id": contract_id,
        "scale_type": scale_type,
        "rounding_mode": rounding_mode,
        "rounding_digits": rounding_digits,
        # v116: 到货节奏（L2）
        "arrival_cadence_days": arrival_cadence_days,
        "arrival_base_dow": arrival_base_dow,
        # v118: 到货排程引擎（L2细化）
        "arrival_mode": arrival_mode,
        "arrival_first_dom": arrival_first_dom,
        "arrival_weekdays": arrival_weekdays,
        "arrival_count_override": arrival_count_override,
        # 阶段2: 品牌目标两层结构（JSON 字符串落库）
        "monthly_amounts": _json.dumps(monthly_amounts, ensure_ascii=False) if monthly_amounts else "",
        "monthly_rates": _json.dumps(monthly_rates, ensure_ascii=False) if monthly_rates else "",
        # v126：月度阶梯（逐月可配一套档位；未配的月回退顶层 tiers_json）
        "monthly_tiers": _json.dumps(monthly_tiers, ensure_ascii=False) if monthly_tiers else "",
        # v121: 智能报单表（报单语义，与 arrival_* 到货语义并存、互不覆盖）
        "order_mode": order_mode,
        "order_cadence_days": order_cadence_days,
        "order_weekdays": order_weekdays,
        "order_first_date": order_first_date,
        "order_lead_days": order_lead_days,
        "order_max_early_days": order_max_early_days,
        "auto_period_enabled": auto_period_enabled,
        "auto_open_time": auto_open_time,
        "auto_close_time": auto_close_time,
        "supplier_deadline_time": supplier_deadline_time,
    }

    # v122 Step4：维度归口下沉（品牌=金额/年度按月返利率，商品=无月度分解/无报单节奏）
    _normalize_by_dimension(cleaned)
    return [], cleaned


def detect_conflicts(conn, cleaned, exclude_id=None):
    """找出与 cleaned 冲突的已启用规则。

    v125 升级：**不再要求 period_type 相同**。判重口径统一为
      「同 (dimension, target_type, scope_key) + 覆盖月份有交集」
    —— 单期(9月) 与 年度(含9月) 因此能被识别为重复目标（此前二者互相隐形，
       导致同一品牌同月存在两条目标、返利被重复计算）。

    无法判定月份（两端生效期皆空且非年度口径）的旧规则降级为原来的区间重叠判定，
    保证不会因口径不明而漏报。
    """
    # v282：**节奏规则不参与判重**（两侧都算）。
    #   它没有目标 ⇒ 不可能造成「同月两条目标、返利被重复计算」这个本函数要防的问题；
    #   而它的 `covered_months` 是整年（年度无分解 = 12 格）⇒ 若参与判重，
    #   先建节奏规则会把该品牌**整年锁死**，用户之后想补真实返利目标会被 409 打回。
    if _row_rhythm_only(cleaned):
        return []
    rows = conn.execute(
        """SELECT id, rule_name, period_type, target_year, monthly_amounts,
                  effective_start, effective_end,
                  target_value, order_first_date, order_cadence_days, order_weekdays,
                  arrival_cadence_days, arrival_weekdays
           FROM rebate_target_rules
           WHERE is_active=1 AND dimension=? AND target_type=? AND scope_key=?
                 AND id != ?""",
        (cleaned["dimension"], cleaned["target_type"],
         cleaned["scope_key"], exclude_id or -1),
    ).fetchall()
    mine = covered_months(cleaned)
    conflicts = []
    for r in rows:
        rd = dict(r)
        if _row_rhythm_only(rd):
            continue
        other = covered_months(rd)
        if other:
            hit = sorted(mine & other)
            if not hit:
                continue
        else:
            # 口径不明（无界且非年度）→ 退回区间重叠，宁可多报不可漏报
            if not _ranges_overlap(cleaned["effective_start"], cleaned["effective_end"],
                                   rd["effective_start"], rd["effective_end"]):
                continue
            hit = []
        conflicts.append({
            "id": rd["id"],
            "rule_name": rd["rule_name"],
            "period_type": rd["period_type"],
            "effective_start": rd["effective_start"],
            "effective_end": rd["effective_end"],
            # v125：冲突月份（'YYYY-MM'，空=仅生效期重叠无法定位到月）
            "months": hit,
            "covered_months": sorted(other),
        })
    return conflicts


# ---------------------------------------------------------------------------
# v125：品牌+月份 唯一性硬约束（DB 层）
# ---------------------------------------------------------------------------
# 应用层 detect_conflicts 能拦住绝大多数场景，但挡不住并发直调/脚本导入。
# 这里用一张月份锁表 + 唯一索引把约束下沉到 SQLite：同一 (dimension, target_type,
# scope_key, ym) 只允许一条启用规则占用。停用/删除即释放锁（软删可回滚）。
MONTH_LOCK_TABLE = "rebate_rule_month_lock"


def _lock_table_ready(conn):
    try:
        return conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (MONTH_LOCK_TABLE,)).fetchone() is not None
    except Exception:
        return False


def sync_month_lock(conn, rule_id, cleaned):
    """把规则的月份占用写入锁表（先清后写）。启用规则才占锁；停用/删除即释放。

    冲突时抛 sqlite3.IntegrityError —— 调用方需捕获并返回 409。
    """
    if not _lock_table_ready(conn):
        return
    conn.execute(f"DELETE FROM {MONTH_LOCK_TABLE} WHERE rule_id=?", (rule_id,))
    if not cleaned.get("is_active", 1):
        return
    # v282：节奏规则**不占月份锁**（它没有目标，占锁只会挡住该品牌以后建真实目标）。
    if _row_rhythm_only(cleaned):
        return
    months = sorted(covered_months(cleaned))
    if not months:
        return
    conn.executemany(
        f"""INSERT INTO {MONTH_LOCK_TABLE}
            (rule_id, dimension, target_type, scope_key, ym)
            VALUES (?,?,?,?,?)""",
        [(rule_id, cleaned["dimension"], cleaned["target_type"],
          cleaned["scope_key"], ym) for ym in months],
    )


def release_month_lock(conn, rule_id):
    """释放某条规则占用的全部月份锁（删除/停用时调用）。"""
    if not _lock_table_ready(conn):
        return
    conn.execute(f"DELETE FROM {MONTH_LOCK_TABLE} WHERE rule_id=?", (rule_id,))


# ---------------------------------------------------------------------------
# 返利计算(试算/评估用)
# ---------------------------------------------------------------------------
def compute_rebate(rule, achieved_amount, achieved_qty, ref_date="", scale_type=None,
                   rounding_mode=None, rounding_digits=None):
    """根据一条规则 + 实际达成, 计算返利。返回结构化结果。

    算法已收敛到 domain/rebate_calc.compute_rebate_unified —— 本试算与
    erp_db.accrue_rebate()（月度计提）、get_rebate_contract_overview()（月度全景）
    以及前端（经 /simulate-batch）共用同一实现，杜绝"试算一个数、计提另一个数"的口径漂移。
    """
    from domain.rebate_calc import compute_rule_rebate as _calc
    return _calc(rule, achieved_amount, achieved_qty, ref_date,
                 scale_type=scale_type, rounding_mode=rounding_mode,
                 rounding_digits=rounding_digits)


# ---------------------------------------------------------------------------
# CRUD 接口
# ---------------------------------------------------------------------------
@router.get("")
def list_rules(request: Request, q: str = "", dimension: str = "",
               is_active: int = 1, include_inactive: int = 0, scope_key: str = "",
               contract_id: int = 0, arrival_ym: str = ""):
    """列出规则。默认仅启用; include_inactive=1 含已停用; contract_id>0 只列该合同下的规则。

    arrival_ym（v364）：随每条 brand 规则带回的「该月到货安排」按哪个自然月算，'YYYY-MM'。
      缺省 / 格式不对 = 今天所在月。冲刺看板必须显式传它自己那个月（＝本期到货月）——
      「剩余到货次数」是**按月**的量，拿今天的月份去回答别的月份的问题是错的
      （例：10 月里看 11 月的看板，会把 10 月的 16 次当成 11 月的）。
    """
    _auth(request)
    conn = _connect()
    sql = "SELECT * FROM rebate_target_rules WHERE 1=1"
    params = []
    if not include_inactive:
        sql += " AND is_active=?"
        params.append(is_active)
    if contract_id:
        try:
            sql += " AND contract_id=?"
            params.append(contract_id)
        except Exception:
            pass
    if dimension:
        sql += " AND dimension=?"
        params.append(dimension)
    if scope_key:
        sql += " AND scope_key=?"
        params.append(scope_key)
    if q:
        sql += " AND rule_name LIKE ?"
        params.append(f"%{q}%")
    sql += " ORDER BY priority DESC, id DESC"
    rows = conn.execute(sql, params).fetchall()
    items = [_row_to_dict(r) for r in rows]
    # ------------------------------------------------------------------
    # v364：把「本月到货安排」一并带回，供**冲刺看板**用。
    #
    # 起因：冲刺看板（Forecast.vue）读的是规则上的 `arrival_count_override` ——
    #   那是**永久列**，10 月填的次数会一路生效到 11/12 月（实测蒙牛鲜奶长期 16，
    #   而 11 月系统推算只有 15 ⇒ 均单分母偏大）。该列已作废并在启动期迁移，
    #   所以必须改从「按月」的口径取，否则用户停了单、看板却看不出来
    #   （= 又一处「同屏两个尺子」）。
    #
    # 一次查全月停单再在内存里分发（而不是每条规则查一次）；表不存在或算不出
    # 一律回落 None，由前端退回它原有的按周期估算 —— 不阻断规则列表本身。
    # 只对 brand 维度算：到货节奏是**品牌方排产节点**，与单品无关（v122 已定）。
    # ------------------------------------------------------------------
    _skipmap = {}
    _ym = str(arrival_ym or "").strip()
    # 手工解析而不是 re：只接受严格的 'YYYY-MM'，任何别的写法都当"没传"（回落今天所在月）。
    _y = _mo = 0
    if len(_ym) == 7 and _ym[4] == "-" and _ym[:4].isdigit() and _ym[5:].isdigit():
        _y, _mo = int(_ym[:4]), int(_ym[5:])
        if not (2000 <= _y <= 2100 and 1 <= _mo <= 12):
            _y = _mo = 0
    if not _y:
        _today_d = date.today()
        _y, _mo = _today_d.year, _today_d.month
        _ym = "%04d-%02d" % (_y, _mo)
    try:
        for _s in conn.execute(
                "SELECT rule_id, skip_dates, count_override FROM rebate_arrival_skips"
                " WHERE ym=?", (_ym,)).fetchall():
            _skipmap[int(_s[0])] = {"skip_dates": _s[1] or "", "count_override": _s[2]}
    except Exception:
        _skipmap = {}
    _rowmap = {}
    for _r in rows:
        try:
            _rowmap[int(_r["id"])] = _r
        except Exception:
            continue
    for _it in items:
        _it["arrival_month"] = None
        if (_it.get("dimension") or "") != "brand":
            continue
        _src = _rowmap.get(int(_it.get("id") or 0))
        if _src is None:
            continue
        try:
            _sm = arrival_summary(dict(_src), _y, _mo,
                                  _skipmap.get(int(_it["id"])))
            _it["arrival_month"] = {
                "ym": _sm["ym"],
                "system_count": _sm["system_count"],
                "count": _sm["count"],
                "effective_count": _sm["effective_count"],
                "skipped": _sm["skipped"],
                "count_source": _sm["count_source"],
                # 次数与日历不一致时前端必须能看见（否则用户改了一个、另一个没动）
                "count_mismatch": _sm["count_mismatch"],
            }
        except Exception as _e:
            logger.warning(f"[v364] arrival_month 计算失败 rule={_it.get('id')}: {_e}")
    return {"success": True, "data": items}


@router.post("")
async def create_rule(request: Request):
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()
    errors, cleaned = validate_rule(body, conn)
    if errors:
        return JSONResponse(status_code=422,
                            content={"success": False, "error": "规则校验未通过", "errors": errors})
    conflicts = detect_conflicts(conn, cleaned)
    if conflicts:
        return JSONResponse(status_code=409, content={
            "success": False,
            "error": "该品牌在这些月份已有启用中的目标：" +
                     "、".join(m for c in conflicts for m in (c.get("months") or []))[:200],
            "conflicts": conflicts})
    try:
        cur = conn.execute(
            """INSERT INTO rebate_target_rules
               (rule_name, dimension, target_type, scope_key, scope_name, period_type,
                target_value, target_year, target_unit, trigger_mode, trigger_threshold, tiers_json, rebate_basis,
                rebate_rate, rebate_amount, effective_start, effective_end, priority, is_active,
                contract_id, scale_type, rounding_mode, rounding_digits,
                arrival_cadence_days, arrival_base_dow,
                arrival_mode, arrival_first_dom, arrival_weekdays, arrival_count_override,
                monthly_amounts, monthly_rates, monthly_tiers,
                order_mode, order_cadence_days, order_weekdays, order_first_date, order_lead_days, order_max_early_days, auto_period_enabled, auto_open_time, auto_close_time, supplier_deadline_time,
                created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (cleaned["rule_name"], cleaned["dimension"], cleaned["target_type"], cleaned["scope_key"],
             cleaned["scope_name"], cleaned["period_type"], cleaned["target_value"], cleaned["target_year"], cleaned["target_unit"], cleaned["trigger_mode"],
             cleaned["trigger_threshold"], cleaned["tiers_json"], cleaned["rebate_basis"], cleaned["rebate_rate"],
             cleaned["rebate_amount"],          cleaned["effective_start"], cleaned["effective_end"], cleaned["priority"],
             cleaned["is_active"], cleaned["contract_id"], cleaned["scale_type"], cleaned["rounding_mode"],
             cleaned["rounding_digits"], cleaned["arrival_cadence_days"], cleaned["arrival_base_dow"],
             cleaned["arrival_mode"], cleaned["arrival_first_dom"], cleaned["arrival_weekdays"], cleaned["arrival_count_override"],
             cleaned["monthly_amounts"], cleaned["monthly_rates"], cleaned["monthly_tiers"],
             cleaned["order_mode"], cleaned["order_cadence_days"], cleaned["order_weekdays"], cleaned["order_first_date"], cleaned["order_lead_days"], cleaned["order_max_early_days"], cleaned["auto_period_enabled"], cleaned["auto_open_time"], cleaned["auto_close_time"], cleaned["supplier_deadline_time"],
             _now(), _now()),
        )
        # v125：品牌+月份 唯一性硬约束（与 detect_conflicts 双保险，防并发绕过）
        sync_month_lock(conn, cur.lastrowid, cleaned)
        conn.commit()
    except Exception as e:
        try: conn.rollback()
        except Exception: pass
        if "UNIQUE" in str(e).upper():
            return JSONResponse(status_code=409, content={
                "success": False,
                "error": "目标月份已被其它启用规则占用（同一品牌同一月份只能有一条目标）",
                "conflicts": detect_conflicts(conn, cleaned)})
        raise
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (cur.lastrowid,)).fetchone()
    _new = _row_to_dict(row) if row is not None else cleaned
    # 留痕写在 commit **之后**（同 db/queries/products.py 的既有约定）：log_entity_changes
    # 另开连接，在事务里写会争锁，且看不到未提交的数据。
    _log_rule_change(request, cur.lastrowid, "create",
                     _rule_field_changes(None, _new, conn), _rule_ref_of(row))
    return JSONResponse(status_code=201, content={"success": True, "id": cur.lastrowid, "rule": _row_to_dict(row)})


@router.post("/precheck")
async def precheck_rule(request: Request):
    """v125：保存前的重复目标预检（不落库）。

    前端「年度 / 单期」两个入口在切换模式、改品牌、改年度或改生效期时调用，
    即时提示"该品牌 2026-09 已有一条目标"，避免用户填完一整张表才被 409 打回。
    入参同 create 的规则草稿；is_active=0 的规则不参与判重（停用即释放月份）。
    """
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()
    errors, cleaned = validate_rule(body, conn)
    if errors or not cleaned:
        return {"success": True, "ok": True, "conflicts": [], "skipped": True,
                "reason": "草稿尚未填完整，跳过预检", "errors": errors or []}
    conflicts = detect_conflicts(conn, cleaned, exclude_id=body.get("id") or 0)
    return {"success": True, "ok": not conflicts, "conflicts": conflicts,
            "covered_months": sorted(covered_months(cleaned))}


@router.get("/conflicts")
def list_conflicts(request: Request):
    """列出当前所有启用规则间的冲突对(供管理员排查 / 仪表盘异常预警区)。

    v125：口径由「同 period_type + 生效期重叠」升级为「覆盖月份有交集」——
    同品牌同月存在「单期目标 + 年度目标」必须能被这里报出来（此前完全隐形）。
    """
    _auth(request)
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM rebate_target_rules WHERE is_active=1 ORDER BY id").fetchall()
    pairs = []
    n = len(rows)
    cov = [covered_months(dict(r)) for r in rows]
    for i in range(n):
        for j in range(i + 1, n):
            a, b = rows[i], rows[j]
            if (a["dimension"], a["target_type"], a["scope_key"]) != \
               (b["dimension"], b["target_type"], b["scope_key"]):
                continue
            ma, mb = cov[i], cov[j]
            if ma and mb:
                hit = sorted(ma & mb)
                if not hit:
                    continue
            else:
                hit = []
                if not _ranges_overlap(a["effective_start"], a["effective_end"],
                                       b["effective_start"], b["effective_end"]):
                    continue
            pairs.append({"a": _row_to_dict(a), "b": _row_to_dict(b), "months": hit})
    return {"success": True, "data": pairs}


@router.get("/meta")
def rule_meta(request: Request):
    """规则元信息（枚举候选 + 文案），前端下拉直接消费，避免前后端各写一份。

    v113：含阶梯计法 scale_options 与舍入策略 rounding_options。
    """
    _auth(request)
    return {
        "success": True,
        "data": {
            "dimensions": [
                {"value": "brand", "label": "品牌", "scope_type": "brand_name", "scope_hint": "按品牌名（来自品牌档案）"},
                {"value": "product", "label": "单品", "scope_type": "product_id", "scope_hint": "按商品（SKU）"},
                {"value": "category", "label": "品类", "scope_type": "category_name", "scope_hint": "按品类名（来自商品档案 category）"},
                {"value": "customer", "label": "客户", "scope_type": "customer_name", "scope_hint": "按客户名（来自客户档案）"},
                {"value": "channel", "label": "渠道", "scope_type": "channel_enum", "scope_hint": "按渠道（KA/TT/批发/电商/直营）"},
            ],
            "channel_options": CHANNEL_OPTIONS,
            "target_types": [{"value": "amount", "label": "金额"},
                             {"value": "quantity", "label": "数量"}],
            "period_types": [{"value": "month", "label": "月度"},
                             {"value": "year", "label": "年度"},
                             {"value": "custom", "label": "自定义"}],
            "trigger_modes": [{"value": "on_target", "label": "达成即返"},
                              {"value": "tiered", "label": "阶梯返利"}],
            "rebate_bases": [{"value": "rate", "label": "按比例"},
                             {"value": "fixed", "label": "固定金额"}],
            "scale_options": SCALE_OPTIONS,
            "rounding_options": ROUNDING_OPTIONS,
            "defaults": {
                "scale_type": DEFAULT_SCALE_TYPE_RULE,
                "rounding_mode": DEFAULT_ROUNDING_MODE,
                "rounding_digits": DEFAULT_ROUNDING_DIGITS,
                # v116: 到货节奏（L2）—— 0 = 用全局默认(tenant_params.default_arrival_cadence_days, 默认2)
                "arrival_cadence_days": 0,
                "arrival_base_dow": "",
                # v118: 到货排程引擎（L2细化）
                "arrival_mode": "interval",
                "arrival_first_dom": 1,
                "arrival_weekdays": "",
                "arrival_count_override": None,
            },
            # v118: 到货排程引擎枚举（前端下拉/文案直接消费）
            # v172：标签改从 domain.arrival_schedule.MODE_LABELS 取 —— 此前在这里重抄了
            # 一份中文（"按间隔天数"/"按固定星期"），domain 那份改了这里不会跟着改。
            # 与上方 scale_options / rounding_options 的写法对齐。
            "arrival_modes": [{"value": v, "label": ARR_MODE_LABELS.get(v, v)} for v in ARR_MODES],
            "weekday_options": [{"value": w, "label": f"周{WEEKDAY_LABELS[w]}"} for w in range(1, 8)],
        },
    }


@router.get("/audit")
def list_rule_audit(request: Request, keyword: str = "", limit: int = 200, offset: int = 0):
    """「目标与返利」页的**字段级修改日志**，按时间倒序（最新在前）。

    数据源 = entity_change_logs 里 entity_type='rebate_rule' 的记录，由
    create / update / delete / tier-versions 五条写路径在同一事务提交后写入。

    ⚠️ 本路由必须定义在 `@router.get("/{rule_id}")` **之前** —— 否则
    `/api/rebate-rules/audit` 会先被路径参数吃掉，rule_id 按 int 解析失败返 422。
    （与达成填报那边的顺序要求相反：那边 `/{param}` 只有 DELETE，故 /audit 放在文件末尾。）

    keyword 在 规则名 / 字段 / 修改人 / 原值 / 新值 上模糊匹配 ——「对象」列存的就是规则名，
    所以搜规则名能命中它的全部变更。
    """
    _auth(request)
    rows, total = get_entity_changes_by_type(
        RULE_ENTITY, limit=limit, offset=offset, ref_like="",
        keyword=(keyword or "").strip())
    # 库里存的是**列名/动作码**（唯一真相），中文标签在这里统一翻译一次 ——
    # 前端不再各存一份映射表，否则改个叫法要改两处、漏一处就显示成生码。
    items = [{
        "id": r.get("id"),
        "at": r.get("created_at"),
        "user_name": r.get("user_name") or "",
        "action": r.get("action") or "",
        "action_label": RULE_ACTION_LABELS.get(r.get("action"), r.get("action") or ""),
        "target": r.get("ref") or "",
        "field": r.get("field_name") or "",
        "field_label": RULE_FIELD_LABELS.get(r.get("field_name"), r.get("field_name") or ""),
        "old_value": r.get("old_value") or "",
        "new_value": r.get("new_value") or "",
        # 由后端告知「这个值该不该按数字渲染」——前端不维护字段名清单，
        # 两个页面的日志弹窗共用同一个渲染器，靠这个标志分流。
        "numeric": (r.get("field_name") in RULE_NUM_FIELDS),
        "entity_id": r.get("entity_id"),
    } for r in rows]
    return {"success": True,
            "data": {"items": items, "total": total,
                     "limit": max(1, min(int(limit or 200), 500)),
                     "offset": max(0, int(offset or 0))}}


# ---------------------------------------------------------------------------
# v364：到货「停单」—— 按月存、仅当月有效
# ---------------------------------------------------------------------------
# 业务公理（2026-10-02 用户确认，改这里前先读 domain/arrival_schedule.py 顶部同名块）：
#   · 到货节奏配一次就无限延续：跨月不重置、**停单也不改节奏**
#     （停单只是「这一次不进货」，下一个到货日照旧）
#   · 手动调整**只保留到本月**，下月自动以系统推算为准
#   ⇒ 所以停单必须**按月存**，绝不能是规则上的永久标量。
#     旧实现 `rebate_target_rules.arrival_count_override` 正是永久列 ⇒
#     10 月填的次数会一路生效到 11/12 月（实测蒙牛鲜奶：长期填 16，而 11 月系统算 15）。
#   · 存「**停单日**」而不是「少几次」：只有这样，到货日历 / 到货次数 / 均单分母
#     三处才可能同口径（旧实现只改次数不改日历 ⇒ 商品目标页「剩余期次」
#     按含停单日的日历算 = 同屏两把尺子）。
# count_override 另留一列承接存量迁移：旧值只有「几次」、没有「哪一天」，
# 凭空编一个被停的日子出来就是在造假数据，所以只能按次数迁。


def _load_month_skips(conn, rule_id, year, month):
    """读该 (规则, 年月) 的手动调整；**无记录返回 None = 纯系统推算**。

    这就是「下月自动以系统推算为准」的实现方式：记录自带 ym，查下个月自然查不到。
    ⚠️ 表不存在时（老租户库还没跑启动补丁）返回 None，不抛 —— 接口层不能因为
    少一张表就 500。
    """
    if not conn or not rule_id or int(rule_id) <= 0:
        return None
    ym = "%04d-%02d" % (int(year), int(month))
    try:
        row = conn.execute(
            "SELECT skip_dates, count_override FROM rebate_arrival_skips"
            " WHERE rule_id=? AND ym=?", (int(rule_id), ym)).fetchone()
    except Exception:
        return None
    if row is None:
        return None
    # 按列下标取：本模块的 _row_to_dict 是**固定列**的（只服务 rebate_target_rules），
    # 这张表的行不能走它。
    sd = (row[0] or "").strip()
    co = row[1]
    if not sd and co is None:
        return None          # 空记录等同没记录（不制造「有配置」的假象）
    return {"skip_dates": row[0] or "", "count_override": co}


@router.get("/arrival-preview")
def arrival_preview(request: Request, rule_id: int = 0,
                    year: int = 0, month: int = 0,
                    mode: str = "", first_dom: int = 0, cadence_days: int = -1,
                    weekdays: str = "", override: int = -1, target_value: float = -1.0,
                    order_mode: str = None, order_first_date: str = None,
                    order_cadence_days: int = -1, order_weekdays: str = None,
                    order_lead_days: int = -1,
                    skip_dates: str = None):
    """到货排程预览（单一真相源，参数化，规则可不存在）。

    - rule_id>0：以该规则已存值为基准，再叠加覆盖参数。
    - rule_id=0：纯参数计算（新建规则未保存时实时试算）。
    year/month 缺省取当前自然月。供配置面板实时算本月到货次数与均单。

    v121 合并：可透传 order_*（报单语义）。已配 order_first_date 时到货次数由
    报单排程派生（与 auto-period-preview 同源）；未配则回退 arrival_*，
    返回体 source 字段标明口径（'order' / 'arrival'）。
    order_* 用 None 作「未传」哨兵，传空串表示显式清空（退回 arrival_* 口径）。

    v364 按月停单：新增 `skip_dates`（CSV 停单日，仅本月有效）。
      · 传了 skip_dates / override ⇒ 按传参算（面板实时试算，未保存也能看）
      · 都没传 ⇒ 读该 (rule, year, month) 的**已存记录**；无记录 = 纯系统推算
      ⚠️ `override` 语义已改为「**本月**到货次数」——它以前写的是规则上那个永久列，
         会造成「10 月填的次数一路生效到 11/12 月」。现在只作用于本次请求的月份。
      返回体新增 system_dates / system_count / skipped / count_source / count_mismatch。
    """
    _auth(request)
    if not year or not month:
        _today = date.today()
        year, month = _today.year, _today.month
    conn = None
    if rule_id and rule_id > 0:
        conn = _connect()
        row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
        if not row:
            return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
        rule = dict(_row_to_dict(row))
    else:
        # 新建规则默认值
        rule = {
            "arrival_mode": "interval", "arrival_first_dom": 1,
            "arrival_cadence_days": 0, "arrival_weekdays": "",
            "arrival_count_override": None, "target_value": 0,
        }
    # 覆盖参数优先级：传了就用传的
    if mode:
        rule["arrival_mode"] = mode
    if first_dom:
        rule["arrival_first_dom"] = first_dom
    if cadence_days >= 0:
        rule["arrival_cadence_days"] = cadence_days
    if weekdays != "":
        rule["arrival_weekdays"] = weekdays
    if target_value >= 0:
        rule["target_value"] = target_value
    # v121：报单语义透传（None=未传不覆盖；空串=显式清空，退回 arrival_* 口径）
    if order_mode is not None:
        rule["order_mode"] = order_mode
    if order_first_date is not None:
        rule["order_first_date"] = order_first_date
    if order_cadence_days >= 0:
        rule["order_cadence_days"] = order_cadence_days
    if order_weekdays is not None:
        rule["order_weekdays"] = order_weekdays
    if order_lead_days >= 0:
        rule["order_lead_days"] = order_lead_days
    # v364：当月手动调整 —— 优先级「显式传参 > 该月已存记录 > 无（纯系统推算）」
    if skip_dates is not None or override >= 0:
        skips = {"skip_dates": skip_dates or "",
                 "count_override": (override if override > 0 else None)}
    else:
        skips = _load_month_skips(conn, rule_id, year, month) if conn else None
    summary = arrival_summary(rule, int(year), int(month), skips)
    return {"success": True, "data": summary}


@router.get("/auto-period-preview")
def auto_period_preview(request: Request, rule_id: int = 0, horizon_days: int = 90,
                        scope_name: str = "", order_mode: str = "", order_first_date: str = "",
                        order_cadence_days: int = -1, order_weekdays: str = "",
                        order_lead_days: int = -1, order_max_early_days: int = -1,
                        auto_open_time: str = "", auto_close_time: str = "",
                        supplier_deadline_time: str = ""):
    """智能报单表预览（v121）—— 未来 N 期报单计划 + 每期应报品牌 + 漏报与相位建议。

    与 /arrival-preview（到货语义、单品牌、自然月口径）的区别：本端点是【报单语义、
    全部品牌、跨月连续】，回答的是「哪天开表、哪天关单、这期该报哪几个品牌」。

    rule_id>0：以该规则已存值为基准，叠加覆盖参数；rule_id=0：纯参数试算（新建未保存）。
    编排范围是【全部启用中的品牌规则】—— 品牌清单必须跨品牌一起算，只看单条算不出来。
    """
    _auth(request)
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM rebate_target_rules WHERE is_active=1 AND dimension='brand'").fetchall()
    rules = [dict(_row_to_dict(r)) for r in rows]

    cur = None
    if rule_id and rule_id > 0:
        for r in rules:
            if int(r.get("id") or 0) == int(rule_id):
                cur = dict(r)
                break
    if cur is None:
        cur = {"id": 0, "scope_name": scope_name or "本品牌", "order_mode": MODE_INTERVAL,
               "order_cadence_days": 0, "order_weekdays": "", "order_first_date": "",
               "order_lead_days": 4, "order_max_early_days": 1}
    if scope_name:
        cur["scope_name"] = scope_name
    if order_mode:
        cur["order_mode"] = order_mode
    if order_first_date:
        cur["order_first_date"] = order_first_date
    if order_cadence_days >= 0:
        cur["order_cadence_days"] = order_cadence_days
    if order_weekdays != "":
        cur["order_weekdays"] = order_weekdays
    if order_lead_days >= 0:
        cur["order_lead_days"] = order_lead_days
    if order_max_early_days >= 0:
        cur["order_max_early_days"] = order_max_early_days

    ot = (auto_open_time or cur.get("auto_open_time") or "20:00").strip() or "20:00"
    ct = (auto_close_time or cur.get("auto_close_time") or "10:00").strip() or "10:00"
    st = (supplier_deadline_time or cur.get("supplier_deadline_time") or "12:00").strip() or "12:00"

    # 用 name=品牌名 组装参与编排的规则集（当前编辑的那条用覆盖后的值）
    plan_rules = []
    hit = False
    for r in rules:
        if cur.get("id") and int(r.get("id") or 0) == int(cur["id"]):
            plan_rules.append({**cur, "name": cur.get("scope_name") or "本品牌"})
            hit = True
        elif r.get("order_first_date"):
            plan_rules.append({**r, "name": r.get("scope_name") or r.get("rule_name") or ""})
    if not hit:
        plan_rules.append({**cur, "name": cur.get("scope_name") or "本品牌"})

    # v365：停单日必须喂给**同一个** build_period_plan —— 这是「预览 = 调度器实际行为」
    #   的前提；各写一份判定必然漂移（本项目反复栽的毛病）。
    #   窗口取 horizon + 最大 lead + 3 天：足够覆盖所有会被编排出来的到货日
    #   （到货日 = 报单日 + lead，报单日最远到 today + horizon）。
    try:
        _d0 = date.today()
        _ml = max([int(r.get("order_lead_days") or 0) for r in plan_rules] or [0])
        _skips = db.rebate_arrival_skip_map(
            conn, _d0, _d0 + timedelta(days=int(horizon_days or 90) + _ml + 3))
    except Exception as _e:
        logger.warning("[v365] 读停单日失败: %s", _e)
        _skips = {}
    plan = _build_period_plan(plan_rules, horizon_days=horizon_days,
                              open_time=ot, close_time=ct, supplier_time=st,
                              skips_by_rule=_skips)
    suggestion = _suggest_first_date(plan_rules, horizon_days=horizon_days)
    return {"success": True, "data": {
        **plan,
        "suggestion": suggestion,
        "preview": plan["periods"][:6],          # 面板默认只展示未来 6 期
        "total_periods": len(plan["periods"]),
        "times": {"open": ot, "close": ct, "supplier": st},
        "window_hours": _window_hours(ot, ct),
    }}


def _window_hours(open_t, close_t):
    """填报窗口小时数：跨夜（D-1 open -> D close），恒 > 0。"""
    try:
        oh, om = [int(x) for x in str(open_t).split(":")]
        ch, cm = [int(x) for x in str(close_t).split(":")]
        return round((24 * 60 - (oh * 60 + om) + (ch * 60 + cm)) / 60.0, 2)
    except Exception:
        return 0.0


@router.get("/{rule_id}")
def get_rule(request: Request, rule_id: int):
    _auth(request)
    conn = _connect()
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
    return {"success": True, "data": _row_to_dict(row)}


@router.put("/{rule_id}")
async def update_rule(request: Request, rule_id: int):
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
    # 合并已存在字段与请求字段(允许局部更新)
    existing = _row_to_dict(row)
    merged = dict(existing)
    # v127：维度锁定 —— 品牌/商品是两个独立入口与两套算法口径（作用对象语义、月度分解、
    # 月份锁键），中途改维度会让 _normalize_by_dimension 静默清空 monthly_*（12 个月目标凭空
    # 消失）。故 update 一律沿用原维度，要换维度请新建一条规则。
    # ⚠️ 这里必须显式 pop + 不登记进下方白名单，两者缺一都会变成"传了但静默丢弃"的隐式行为。
    body.pop("dimension", None)
    for k in ("rule_name", "target_type", "scope_key", "scope_name", "period_type",
              "target_value", "trigger_mode", "trigger_threshold", "tiers_json", "rebate_basis",
              # v122：目标年度 / 数量单位 —— 不登记进这个局部更新白名单，传了也会被静默忽略（同 _row_to_dict）
              "target_year", "target_unit",
              "rebate_rate", "rebate_amount", "effective_start", "effective_end", "priority", "is_active",
              "contract_id", "scale_type", "rounding_mode", "rounding_digits",
              "arrival_cadence_days", "arrival_base_dow",
              "arrival_mode", "arrival_first_dom", "arrival_weekdays", "arrival_count_override",
              "monthly_amounts", "monthly_rates", "monthly_tiers",
              "order_mode", "order_cadence_days", "order_weekdays", "order_first_date", "order_lead_days", "order_max_early_days", "auto_period_enabled", "auto_open_time", "auto_close_time", "supplier_deadline_time"):
        if k in body:
            merged[k] = body[k]
    errors, cleaned = validate_rule(merged, conn, exclude_id=rule_id)
    if errors:
        return JSONResponse(status_code=422,
                            content={"success": False, "error": "规则校验未通过", "errors": errors})
    conflicts = detect_conflicts(conn, cleaned, exclude_id=rule_id)
    if conflicts:
        return JSONResponse(status_code=409, content={
            "success": False,
            "error": "该品牌在这些月份已有启用中的目标：" +
                     "、".join(m for c in conflicts for m in (c.get("months") or []))[:200],
            "conflicts": conflicts})
    try:
        conn.execute(
            """UPDATE rebate_target_rules SET
                  rule_name=?, dimension=?, target_type=?, scope_key=?, scope_name=?, period_type=?,
                  target_value=?, target_year=?, target_unit=?, trigger_mode=?, trigger_threshold=?, tiers_json=?, rebate_basis=?,
                  rebate_rate=?, rebate_amount=?, effective_start=?, effective_end=?, priority=?, is_active=?,
                  contract_id=?, scale_type=?, rounding_mode=?, rounding_digits=?,
                  arrival_cadence_days=?, arrival_base_dow=?,
                  arrival_mode=?, arrival_first_dom=?, arrival_weekdays=?, arrival_count_override=?,
                  monthly_amounts=?, monthly_rates=?, monthly_tiers=?, order_mode=?, order_cadence_days=?, order_weekdays=?, order_first_date=?, order_lead_days=?, order_max_early_days=?, auto_period_enabled=?, auto_open_time=?, auto_close_time=?, supplier_deadline_time=?, updated_at=?
               WHERE id=?""",
            (cleaned["rule_name"], cleaned["dimension"], cleaned["target_type"], cleaned["scope_key"],
             cleaned["scope_name"], cleaned["period_type"], cleaned["target_value"], cleaned["target_year"], cleaned["target_unit"], cleaned["trigger_mode"],
             cleaned["trigger_threshold"], cleaned["tiers_json"], cleaned["rebate_basis"], cleaned["rebate_rate"],
             cleaned["rebate_amount"],          cleaned["effective_start"], cleaned["effective_end"], cleaned["priority"],
             cleaned["is_active"], cleaned["contract_id"], cleaned["scale_type"], cleaned["rounding_mode"],
             cleaned["rounding_digits"], cleaned["arrival_cadence_days"], cleaned["arrival_base_dow"],
             cleaned["arrival_mode"], cleaned["arrival_first_dom"], cleaned["arrival_weekdays"], cleaned["arrival_count_override"],
             cleaned["monthly_amounts"], cleaned["monthly_rates"], cleaned["monthly_tiers"],
             cleaned["order_mode"], cleaned["order_cadence_days"], cleaned["order_weekdays"], cleaned["order_first_date"], cleaned["order_lead_days"], cleaned["order_max_early_days"], cleaned["auto_period_enabled"],              cleaned["auto_open_time"], cleaned["auto_close_time"], cleaned["supplier_deadline_time"],
             _now(), rule_id),
        )
        # v125：同步月份锁（停用即释放，改期/换品牌即重算）
        sync_month_lock(conn, rule_id, cleaned)
        conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        if "UNIQUE" in str(e).upper():
            return JSONResponse(status_code=409, content={
                "success": False,
                "error": "目标月份已被其它启用规则占用（同一品牌同一月份只能有一条目标）",
                "conflicts": detect_conflicts(conn, cleaned, exclude_id=rule_id)})
        raise
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    _new = _row_to_dict(row) if row is not None else cleaned
    # 与达成填报的关键差别：这张表单提交的是**全量字段**，故按值比对而非「出现即记」——
    # 否则用户只改一个目标值，日志里会刷出 40 行"其实没变"的记录。
    _log_rule_change(request, rule_id, "update",
                     _rule_field_changes(existing, _new, conn), _rule_ref_of(row))
    return {"success": True, "id": rule_id, "rule": _row_to_dict(row)}


@router.delete("/{rule_id}")
def delete_rule(request: Request, rule_id: int, hard: int = 0):
    """软删除(is_active=0)保留审计; hard=1 物理删除。"""
    _auth(request)
    conn = _connect()
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
    try:
        if hard:
            conn.execute("DELETE FROM rebate_target_rules WHERE id=?", (rule_id,))
        else:
            conn.execute("UPDATE rebate_target_rules SET is_active=0, updated_at=? WHERE id=?",
                         (_now(), rule_id))
        # v125：删除/停用即释放月份锁，让同品牌同月可以重新建目标
        release_month_lock(conn, rule_id)
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    # hard=1 物理删 → 记「删掉的是哪条」；hard=0 是软删（等同界面上的「停用」），
    # 按 is_active 的真实变化记 —— 一条已经停用的规则再删一次不会刷出假记录。
    _old = _row_to_dict(row)
    if hard:
        _changes = [("rule_name", _rule_val_txt("rule_name", _old.get("rule_name")), "")]
        _changes = [c for c in _changes if c[1]]
        _action = "delete"
    else:
        _after = dict(_old)
        _after["is_active"] = 0
        _changes = _rule_field_changes(_old, _after, conn)
        _action = "update"
    _log_rule_change(request, rule_id, _action, _changes, _rule_ref_of(row))
    return {"success": True, "id": rule_id, "deleted": True, "hard": bool(hard)}


# ---------------------------------------------------------------------------
# 校验 / 冲突 / 试算
# ---------------------------------------------------------------------------
@router.post("/validate")
async def validate_only(request: Request):
    """仅校验不落库: 返回 errors 与 conflicts, 供前端实时校验。"""
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()
    errors, cleaned = validate_rule(body, conn)
    conflicts = detect_conflicts(conn, cleaned) if cleaned else []
    return {"success": len(errors) == 0 and len(conflicts) == 0,
            "errors": errors, "conflicts": conflicts}


@router.post("/simulate")
async def simulate(request: Request):
    """返利试算（v112 R1 修复契约错位；v113 增加算式链与计法/舍入覆盖）。

    主契约（前端 Rebate.vue 使用）:
      入参 { rule_id: int, actual_value: number,
             可选覆盖: scale_type / rounding_mode / rounding_digits }
        —— 按 rule 的 target_type 自动判定 actual_value 是金额(amount) 还是数量(quantity)；
      返回 data: { rule_id, rule_name, target_type, target_value, basis_value,
        achievement, effective_rate, rebate_amount, triggered, note,
        v113: raw_rebate, marginal_rate, scale_type, scale_label, rounding,
              steps[]（算式链）, tiers[]（档位明细）}
    兼容契约（保留旧调用方）:
      入参 { dimension, scope_key, period_type, achieved_amount, achieved_qty, ref_date }
      返回 { success, ref_date, results, total_rebate }
    """
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()

    # v113: 允许调用方临时覆盖计法 / 舍入（试算器 What-if 用，不落库）
    ov_scale = body.get("scale_type") or None
    ov_mode = body.get("rounding_mode") or None
    ov_digits = body.get("rounding_digits")

    rule_id = body.get("rule_id")
    if rule_id in (None, "", 0):
        # ---- 兼容旧契约：按维度/作用对象/周期多规则试算 ----
        dimension = body.get("dimension") or "brand"
        scope_key = (body.get("scope_key") or "").strip()
        period_type = body.get("period_type") or "month"
        achieved_amount = _coerce_num(body.get("achieved_amount"), 0)
        achieved_qty = _coerce_num(body.get("achieved_qty"), 0)
        ref_date = (body.get("ref_date") or "").strip() or _today()
        rows = conn.execute(
            """SELECT * FROM rebate_target_rules
               WHERE is_active=1 AND dimension=? AND period_type=? AND (scope_key='' OR scope_key=?)""",
            (dimension, period_type, scope_key),
        ).fetchall()
        results = []
        for r in rows:
            rule = _row_to_dict(r)
            # v292（2026-09-27）：口径统一 —— 原先这里用本地 `_effective_contains`（纯日粒度比
            # 大小），是 v186 把生效期判据收敛到 `domain.rebate_period.rule_covers_date` 时
            # **漏网的最后一处**。后果：同一份数据两条路径两个答案 ——
            # 「10 月目标 + 生效期写到 09-30」在主契约（按 rule_id 单条试算）能正常出数，
            # 在这条兼容路径（按维度/作用对象批量）恒返回 0 条结果、返利恒 0，且零报错。
            # 收敛后语义同源：有月度分解 ⇒ 该月分解里有目标即适用，生效期不逐月裁剪；
            # 单期规则仍按生效期过滤。（compute_rebate 内部会用同一判据再验一次，不会打架。）
            if not rule_covers_date(rule, ref_date):
                continue
            results.append(compute_rebate(rule, achieved_amount, achieved_qty, ref_date,
                                          scale_type=ov_scale, rounding_mode=ov_mode,
                                          rounding_digits=ov_digits))
        total_rebate = round(sum(x["rebate"] for x in results), 2)
        return {"success": True, "ref_date": ref_date, "results": results, "total_rebate": total_rebate}

    # ---- 主契约：按规则 id 单条试算 ----
    try:
        rule_id = int(rule_id)
    except (TypeError, ValueError):
        return JSONResponse({"success": False, "detail": "rule_id 无效"}, status_code=422)
    row = conn.execute(
        "SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)
    ).fetchone()
    if row is None:
        return JSONResponse({"success": False, "detail": "规则不存在"}, status_code=404)
    rule = _row_to_dict(row)
    ref_date = (str(body.get("ref_date") or "").strip())
    actual_value = _coerce_num(body.get("actual_value"), 0)
    # 阶段2: 品牌目标带月度分解时，试算按 ref_date 所在月取「当月目标 + 当月返利」；
    # 未给 ref_date 则试算落在生效期首月（若 monthly 覆盖该月），否则沿用年框值（兼容老规则）。
    if rule.get("is_monthly") or rule.get("monthly_amounts"):
        _ym = ref_date[:7] if len(ref_date) >= 7 else ""
        if not _ym and rule.get("effective_start"):
            _ym = str(rule.get("effective_start"))[:7]
        if _ym:
            rule = dict(rule)
            rule["target_value"] = resolve_month_target(rule, _ym)
            rule["rebate_rate"] = resolve_month_rate(rule, _ym)
            rule["effective_start"], rule["effective_end"] = "", ""  # 已按指定月取数，不再二次拦截
    achieved_amount = actual_value if rule["target_type"] == "amount" else 0.0
    achieved_qty = actual_value if rule["target_type"] == "quantity" else 0.0
    calc = compute_rebate(rule, achieved_amount, achieved_qty, ref_date=ref_date,
                          scale_type=ov_scale, rounding_mode=ov_mode, rounding_digits=ov_digits)
    basis = calc["basis_value"]
    effective_rate = None
    if calc["triggered"] and calc["rebate_basis"] == "rate" and basis and basis > 0:
        effective_rate = round(calc["rebate"] / basis, 6)
    return {
        "success": True,
        "data": {
            "rule_id": calc["rule_id"],
            "rule_name": calc["rule_name"],
            "target_type": calc["target_type"],
            "target_value": calc["target_value"],
            "basis_value": calc["basis_value"],
            "achievement": calc["achievement_pct"],
            "effective_rate": effective_rate,
            "rebate_amount": calc["rebate"],
            "triggered": calc["triggered"],
            "note": calc["detail"],
            # v113: 透明化算式链 + 计法 / 舍入（前端直接渲染，不重复实现算法）
            "raw_rebate": calc["raw_rebate"],
            "marginal_rate": calc["marginal_rate"],
            "scale_type": calc["scale_type"],
            "scale_label": calc["scale_label"],
            "rounding": calc["rounding"],
            "steps": calc["steps"],
            "tiers": calc["tiers"],
        },
    }


@router.post("/simulate-batch")
async def simulate_batch(request: Request):
    """批量返利试算（v113 新增，对标国际 ERP 第一批 §2.3）。

    目的：把返利算法**唯一留在后端**。前端仪表盘 / 试算器一律走本接口，
    不再各自镜像一份算法（此前 Rebate.vue computeRebateFront 与后端双份实现必然漂移）。

    入参:
      {
        "items": [
          {"rule_id": 12, "basis_value": 120000},                 # 按库里规则算
          {"rule": {...规则快照...}, "basis_value": 90000,         # 按传入快照算（What-if 未保存的改动）
           "scale_type": "graduated", "rounding_mode": "half_up", "rounding_digits": 2}
        ],
        "ref_date": "2026-08-31"   # 可选，校验规则生效期
      }
    出参: { success, data: { results: [ 与入参同序, 每项含 rebate/steps/tiers/... ],
                            total_rebate, count } }
    单项失败不中断整批，该位置返回 { ok:false, error:"..." }。
    """
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    items = body.get("items")
    if not isinstance(items, list) or not items:
        return JSONResponse(status_code=422,
                            content={"success": False, "detail": "items 必须是非空数组"})
    if len(items) > 500:
        return JSONResponse(status_code=422,
                            content={"success": False, "detail": "单次最多试算 500 条"})
    ref_date = (str(body.get("ref_date") or "").strip()) or None
    conn = _connect()
    cache = {}
    results = []
    total = 0.0
    for it in items:
        if not isinstance(it, dict):
            results.append({"ok": False, "error": "item 必须是对象"})
            continue
        basis = _coerce_num(it.get("basis_value"), 0)
        ov_scale = it.get("scale_type") or None
        ov_mode = it.get("rounding_mode") or None
        ov_digits = it.get("rounding_digits")
        rule = it.get("rule")
        rid = it.get("rule_id")
        try:
            if isinstance(rule, dict) and rule:
                # What-if：用传入的规则快照，不校验落库字段
                rule = dict(rule)
                if rid and not rule.get("id"):
                    rule["id"] = rid
            else:
                rid = int(rid)
                if rid in cache:
                    rule = cache[rid]
                else:
                    row = conn.execute(
                        "SELECT * FROM rebate_target_rules WHERE id=?", (rid,)).fetchone()
                    if row is None:
                        results.append({"ok": False, "error": f"规则 {rid} 不存在"})
                        continue
                    rule = _row_to_dict(row)
                    cache[rid] = rule
            # v123：item 级 ref_date 覆盖（缺省沿用批次级）——全年柱状图一次请求
            # 试算 12 个月时，各月需锁定各自当期的阶梯版本，不能用同一个 ref_date
            it_ref = str(it.get("ref_date") or "").strip() or (ref_date or "")
            calc = compute_rebate(rule,
                                  basis if (rule.get("target_type") or "amount") == "amount" else 0.0,
                                  basis if (rule.get("target_type") or "amount") == "quantity" else 0.0,
                                  ref_date=it_ref,
                                  scale_type=ov_scale, rounding_mode=ov_mode,
                                  rounding_digits=ov_digits)
            calc["ok"] = True
            calc["rule_id"] = rule.get("id")
            calc["rule_name"] = rule.get("rule_name") or calc.get("name") or ""
            results.append(calc)
            total += calc["rebate"] or 0.0
        except Exception as e:  # 单条失败不拖垮整批
            results.append({"ok": False, "error": str(e)[:200]})
    return {
        "success": True,
        "data": {"results": results,
                 "total_rebate": round(total, 2),
                 "count": len([r for r in results if r.get("ok")])},
    }


# ===========================================================================
# v114 (第二批 B2-1): 阶梯版本化链路端点
# 规则阶梯可按生效期存多个版本；计提按"计提月份"锁定当时版本（见 erp_db._pick_tier_version）。
# ===========================================================================
@router.get("/{rule_id}/tier-versions")
def list_tier_versions(rule_id: int, request: Request):
    """列出某规则的全部阶梯版本（按 version_no / id 升序）。"""
    _auth(request)
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM rebate_tier_versions WHERE rule_id=? ORDER BY version_no, id",
        (rule_id,)).fetchall()
    return {"success": True, "data": [_ver_to_dict(r) for r in rows]}


@router.post("/{rule_id}/tier-versions")
async def create_tier_version(rule_id: int, request: Request):
    """新增一个阶梯版本。tiers_json 缺省取规则当前阶梯（"把当前快照存为一版"）；version_no 缺省=最大+1。"""
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()
    rule = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if rule is None:
        return JSONResponse(status_code=404, content={"success": False, "detail": "规则不存在"})
    # tiers_json：允许前端传 list 或 string；缺省取规则当前阶梯
    tiers = body.get("tiers_json")
    if tiers is None:
        tiers = rule["tiers_json"]
    if isinstance(tiers, list):
        tiers = _json.dumps(tiers, ensure_ascii=False)
    scale_type = body.get("scale_type") or rule["scale_type"] or "non_graduated"
    rounding_mode = body.get("rounding_mode") or rule["rounding_mode"] or "half_up"
    rd = body.get("rounding_digits")
    rounding_digits = int(rd) if (rd is not None and str(rd).strip() != "") else (rule["rounding_digits"] or 2)
    eff_start = str(body.get("effective_start") or "").strip()
    eff_end = str(body.get("effective_end") or "").strip()
    note = str(body.get("note") or "").strip()
    try:
        max_no = conn.execute(
            "SELECT COALESCE(MAX(version_no),0) FROM rebate_tier_versions WHERE rule_id=?",
            (rule_id,)).fetchone()[0] or 0
    except Exception:
        max_no = 0
    version_no = int(body.get("version_no") or 0) or (max_no + 1)
    try:
        cur = conn.execute(
            """INSERT INTO rebate_tier_versions
               (rule_id, version_no, effective_start, effective_end, tiers_json,
                scale_type, rounding_mode, rounding_digits, note, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (rule_id, version_no, eff_start, eff_end, tiers, scale_type,
             rounding_mode, rounding_digits, note, _now()))
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    row = conn.execute("SELECT * FROM rebate_tier_versions WHERE id=?", (cur.lastrowid,)).fetchone()
    _log_rule_change(request, rule_id, "tier_add",
                     [("tier_version", "", _tier_version_txt(row))],
                     _rule_ref_of(rule))
    return JSONResponse(status_code=201, content={"success": True, "id": cur.lastrowid,
                                                   "version": _ver_to_dict(row)})


@router.get("/{rule_id}/tier-versions/{version_id}")
def get_tier_version(rule_id: int, version_id: int, request: Request):
    _auth(request)
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM rebate_tier_versions WHERE id=? AND rule_id=?",
        (version_id, rule_id)).fetchone()
    if row is None:
        return JSONResponse(status_code=404, content={"success": False, "detail": "版本不存在"})
    return {"success": True, "data": _ver_to_dict(row)}


@router.delete("/{rule_id}/tier-versions/{version_id}")
def delete_tier_version(rule_id: int, version_id: int, request: Request):
    _auth(request)
    conn = _connect()
    # 先读整行再删 —— 删掉后就查不到原值了，日志里只能写「删了一个版本」而说不出删的是哪一版
    vrow = conn.execute("SELECT * FROM rebate_tier_versions WHERE id=? AND rule_id=?",
                        (version_id, rule_id)).fetchone()
    rrow = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    conn.execute("DELETE FROM rebate_tier_versions WHERE id=? AND rule_id=?",
                 (version_id, rule_id))
    conn.commit()
    if vrow is not None:
        _log_rule_change(request, rule_id, "tier_del",
                         [("tier_version", _tier_version_txt(vrow), "")],
                         _rule_ref_of(rrow))
    return {"success": True}


# ===========================================================================
# v364：到货停单（按月读写）
# ===========================================================================
# 路径都是 /{rule_id}/arrival-skips（两段），不会被上面的 @router.get("/{rule_id}")
# 遮蔽 —— 段数不同。与 /{rule_id}/tier-versions 同理。


def _arr_skip_txt(sd, co):
    """留痕里的「值」文本 —— 写成一句人话，不是字段清单。"""
    parts = []
    if co is not None:
        parts.append("本月到货 %s 次" % co)
    days = [x.strip() for x in str(sd or "").split(",") if x.strip()]
    if days:
        parts.append("停单 %d 天（%s）" % (len(days), "、".join(days)))
    return "；".join(parts) if parts else "无（按系统推算）"


# ===================== v365 停单 ⇒ 该期次不再自动新建 =====================
#
# 业务：用户在「到货节奏」里点某天「不到货」，除了少一次到货，**那天对应的报单期次
#   也不该再被自动建出来**（那批货不来，建出期次 = 让业务员白报一轮单）。
#
# 🔴 到货日 ↔ 期次是 **1:1 等值关系**，不是"同月"关系：
#      期次.arrival_date == 停单日，而 `arrival_date = 报单日 + 基准品牌 lead`
#   ⇒ 停单 10-05 对应的期次，**报单窗口在 9 月底**（报单日 10-01）。
#   生产实证（tenant_1）：期次#22「2026-10-01 报单期次」order_start=09-30 order_end=10-01
#                        arrival_date=10-05 —— 完全对上。
#   ⇒ 所以判定只能拿 arrival_date 等值比较，**绝不能按"期次所在月"去匹配停单记录**。
#
# 判定与排除**都在 `domain.arrival_schedule.build_period_plan` 里**（唯一实现），
# 这里只负责：① 把停单日喂给它；② 把「哪几期受影响」如实回执给用户。

def _iso_days(raw):
    """把用户/接口传来的停单日（CSV 或 list）解析成合法 ISO 日期列表（去重保序）。"""
    if isinstance(raw, (list, tuple, set)):
        items = [str(x) for x in raw]
    else:
        items = str(raw or "").split(",")
    out = []
    for it in items:
        it = (it or "").strip()[:10]
        if not it:
            continue
        try:
            datetime.strptime(it, "%Y-%m-%d")
        except (TypeError, ValueError):
            continue
        if it not in out:
            out.append(it)
    return sorted(out)


def _auto_period_plan_rows(conn):
    """参与报单编排的品牌规则 + 承载自动化的那条（与两处预览同构的唯一取法）。

    「参与编排」= 有 `order_first_date` —— 与 `build_period_plan` 的 usable 条件一致。
    """
    rows = [dict(_row_to_dict(r)) for r in conn.execute(
        "SELECT * FROM rebate_target_rules WHERE is_active=1 AND dimension='brand' "
        "ORDER BY id").fetchall()]
    carrier = next((r for r in rows if int(r.get("auto_period_enabled") or 0) == 1), None)
    plan_rules = [{**r, "name": r.get("scope_name") or r.get("rule_name") or ""}
                  for r in rows if (r.get("order_first_date") or "").strip()]
    if carrier:
        cn = carrier.get("scope_name") or carrier.get("rule_name") or ""
        if not any(x["name"] == cn for x in plan_rules):
            plan_rules.append({**carrier, "name": cn})
    return rows, carrier, plan_rules


def _affected_auto_periods(conn, rule_id, skip_dates, effect="skip", horizon_days=120,
                           limit=6, prev_days=None):
    """这次（取消）停单会让**哪几期的报单期次**（不再 / 恢复）自动新建。

    🔴 为什么必须回执：停单的直觉后果只有「少一次到货」，真实后果还包含
       「那一期的报单窗口不会再自动开」—— 用户看不到这一层，几周后只会发现
       「期次怎么少了一期」而无从追溯。
    🔴 同时给出**期次是否已存在**与**填报窗口状态**：这两种情况下"不再自动新建"
       其实已经没有实际影响（已存在的期次系统不会去动它；窗口已过的期次本来就不会再建），
       如实说明比一律渲染成"已排除"更有用 —— 后者会制造虚假的紧张感。

    effect='skip'    : `skip_dates` = 保存后**本月**的停单日全量；`prev_days` = 保存前本月的值
                       （用于把旧值摘掉，别误伤该规则其它月份的停单日）。
    effect='restore' : `skip_dates` = 本次**被删掉**的那些天；结论按"删掉之后"的状态算。

    Returns: {"computed": bool, "auto_enabled": bool, "brand_joins": bool,
              "excluded_count": int, "affected": [...]}
      affected[i] = {"order_date","arrival_date","open_at","close_at",
                     "excluded",       # 🔴 **最终结论**：这一期到底还会不会被自动建
                     "still_arriving",  # 那天**照常到货**的品牌（v368 起不影响结论，
                                        #  只用于界面如实交代「谁其实有货但跟着不建」）
                     "existed","period_id","window","effect","reason"}
    🔴 `affected` 收的是「**本次编辑打到**的期次」，不等于「被排除的期次」——
       所以每一项都必须带 `excluded` 结论。前端若只看"有没有被列出"就说"不再自动新建"，
       就会**界面与后端结论相反**（本项目最典型的病）。
    🔴 v368（老板拍板）：排除判定从「全停才排除」改为「**任一品牌停 ⇒ 整期不建**」。
       ⇒ 两种情形都会出现在回执里，前端**必须**分四种说法，不能合并：
         · skip      + excluded=True  ⇒ 不再自动新建（并交代谁跟着一起停了）
         · restore   + excluded=True  ⇒ **仍不建**（还有别的品牌那天停着）
         · restore   + excluded=False ⇒ 会恢复自动新建
         · skip      + excluded=False ⇒ 理论上不存在（打了就必中），留着当护栏
    """
    days = _iso_days(skip_dates)
    rows, carrier, plan_rules = _auto_period_plan_rows(conn)
    try:
        rid = int(rule_id or 0)
    except (TypeError, ValueError):
        rid = 0
    joins = any(int(x.get("id") or 0) == rid for x in plan_rules) if rid else False
    res = {"computed": True, "auto_enabled": bool(carrier), "brand_joins": joins,
           "affected": [], "excluded_count": 0}
    if not days or rid <= 0 or not joins:
        # 该品牌没配报单节奏 ⇒ 停单只影响「到货次数/均单」，与期次无关 ——
        # 这是**有效结论**，不是失败（界面据此说"不影响期次"而不是"算不出来"）。
        return res
    ot = (carrier.get("auto_open_time") or "20:00").strip() if carrier else "20:00"
    ct = (carrier.get("auto_close_time") or "10:00").strip() if carrier else "10:00"
    st = (carrier.get("supplier_deadline_time") or "12:00").strip() if carrier else "12:00"
    # 🔴 必须叠加**其它品牌已存的停单日**再算，否则结论恒为「照建」：
    #   本次编辑只动一条规则，但「这一期建不建」取决于**所有参与品牌**在该到货日是否都停。
    #   只注入 `{rid: days}` ⇒ 永远只有"部分品牌停" ⇒ 回执永远说"仍会按期建" ⇒ 界面骗人。
    #
    # 🔴🔴 算的必须是**改动之后**的状态，不是"改动之前"：
    #   用户问的是「我刚做了这件事，接下来会怎样」。若拿删除前的状态去算，结论会**反过来**——
    #   实例（2026-10-02 接口层探针抓到的缺陷）：两个品牌都停了 10-09 ⇒ 这一期不建；
    #   用户取消**蒙牛低温**的停单时，若按"删除前"（两个都停）算 ⇒ excluded=True ⇒
    #   界面说「不再自动新建」；而事实是鲜奶那天仍停、低温恢复送货 ⇒ 这一期**照建**。
    #   ⇒ restore 必须把这次删掉的那些天从停单集里**摘掉**再看结论。
    #   ⚠️ 用「减」而不是「清空」：同一条规则可能在**其它月份**还有停单日（按月作用域），
    #      一刀清空会让那些月份的期次结论也一起错。
    # ⚠️ 同理，'skip' 侧不直接 `skip_map[rid] = set(days)`：PUT 写的是**本月**的全量，
    #      直接覆盖会把该规则其它月份已存的停单日一并抹掉 ⇒ 其它月份的期次结论跟着错。
    #      故先用「本月旧值」摘旧、再并新（旧值由调用方经 prev_days 传入；拿不到就退化为覆盖）。
    skip_map = db.rebate_arrival_skip_map(conn)
    _cur = set(skip_map.get(rid) or ())
    _prev = set(_iso_days(prev_days)) if prev_days else set()
    if effect == "restore":
        _left = _cur - set(days)
    else:
        _left = (_cur - _prev) | set(days)
    if _left:
        skip_map[rid] = _left
    else:
        skip_map.pop(rid, None)
    # 「要报到哪几期」按**本次编辑涉及的那些天**去认（不是按"谁被排除"）：
    #   restore 之后这一条规则已经没有停单日了，靠 exclude_hit 认不出"曾经被它打中的期次"；
    #   而 skip 侧两者等价（该规则自己的到货日落在这批天里 ⇔ 它出现在 exclude_hit 里）。
    _watch = set(days)
    plan = _build_period_plan(plan_rules, horizon_days=horizon_days,
                              open_time=ot, close_time=ct, supplier_time=st,
                              skips_by_rule=skip_map)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    for p in (plan.get("periods") or []):
        # 只认**这一条规则自己的到货日**，不能拿期次的主到货日凑数（各品牌 lead 可能不同）
        if not any(int(b.get("rule_id") or 0) == rid
                   and str(b.get("arrival_date") or "") in _watch
                   for b in (p.get("brand_detail") or [])):
            continue
        row = conn.execute(
            "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=?",
            (p.get("open_date"), p.get("close_date"))).fetchone()
        ca = p.get("close_at") or ""
        oa = p.get("open_at") or ""
        win = "past" if (ca and now_str >= ca) else ("open" if (oa and now_str >= oa) else "future")
        res["affected"].append({
            "order_date": p.get("order_date"),
            "arrival_date": p.get("arrival_date"),
            "open_at": oa, "close_at": ca,
            # 🔴 最终结论：任一品牌那天不到货 ⇒ 这一期不建（v368）。
            #    别让界面自己从「有没有被列出」去猜 —— 猜错就是界面与后端结论相反。
            "excluded": bool(p.get("excluded")),
            # v368：语义改为「那天照常到货、但跟着这一期一起不建的品牌」（不再影响结论）
            "still_arriving": sorted({x.get("name") or "" for x in (p.get("exclude_partial") or [])}),
            # v368：**还在停**的品牌名 —— 取消停单后若这一期仍不建，界面必须能
            #       点名是**谁**还在停，否则用户无从下手（只有 still_arriving 不够：
            #       它说的是"谁有货"，而用户要问的是"那到底是谁不来了"）。
            "skipped_brands": sorted({x.get("name") or "" for x in (p.get("exclude_hit") or [])}),
            "existed": bool(row),
            "period_id": int(row[0]) if row else 0,
            "window": win,
            "effect": effect,
            "reason": p.get("exclude_reason") or "",
        })
    res["excluded_count"] = len([x for x in res["affected"] if x["excluded"]])
    res["affected"] = res["affected"][:limit]
    return res


@router.get("/{rule_id}/arrival-skips")
def get_arrival_skips(request: Request, rule_id: int, year: int = 0, month: int = 0):
    """某规则**某月**的到货安排：系统推算 vs 本月实到 + 停单明细。

    year/month 缺省当月。**下个月没有记录就是纯系统推算** —— 不需要任何
    「月初重置」动作，这是数据模型自带的性质（记录自带 ym）。
    """
    _auth(request)
    conn = _connect()
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
    rule = dict(_row_to_dict(row))
    if not year or not month:
        _t = date.today()
        year, month = _t.year, _t.month
    skips = _load_month_skips(conn, rule_id, year, month)
    summary = arrival_summary(rule, int(year), int(month), skips)
    # 原样回读那串停单日给前端（表单要能无损往返）。
    #   🔴 不能拿 summary["skipped"] 代替：那只保留"确实落在**当前**系统日历里"的日期，
    #      越月的、或用户后来改了报单周期导致已不存在的那些被剔到 skip_not_in_schedule ⇒
    #      前端再存一次就把它们悄悄抹掉了（用户会看到自己停的那天凭空消失）。
    summary["skip_dates_stored"] = (skips or {}).get("skip_dates") or ""
    return {"success": True, "data": summary}


@router.put("/{rule_id}/arrival-skips")
async def save_arrival_skips(request: Request, rule_id: int):
    """保存某月的到货手动调整。

    body: {"year":2026, "month":10,
           "skip_dates": ["2026-10-05", ...] 或 "2026-10-05,2026-10-07",
           "count_override": 15 或 null}

    ⚠️ **只写这一个月的记录，其它月一律不动** —— 这正是
    「改动只保持到本月、下月自动以系统推算为准」的实现方式。
    传 skip_dates 空 + count_override null ⇒ 删除该月记录（= 立刻恢复系统推算）。
    """
    _auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    conn = _connect()
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
    rule = dict(_row_to_dict(row))
    try:
        year = int(body.get("year") or 0)
        month = int(body.get("month") or 0)
    except (TypeError, ValueError):
        year = month = 0
    if not year or not month:
        _t = date.today()
        year, month = _t.year, _t.month
    if not (1 <= month <= 12):
        return JSONResponse(status_code=400, content={"success": False, "error": "月份须在 1-12"})
    ym = "%04d-%02d" % (year, month)
    raw = body.get("skip_dates")
    if isinstance(raw, (list, tuple)):
        sd = ",".join([str(x).strip() for x in raw if str(x).strip()])
    else:
        sd = str(raw or "").strip()
    old = _load_month_skips(conn, rule_id, year, month) or {"skip_dates": "", "count_override": None}
    # `count_override`：**未传 = 不动**（与 order_* 的 None 哨兵同族，见 arrival-preview 注释）。
    #   为什么必须有这个哨兵：迁移过来的旧值**只有「几次」、没有「哪一天」**，
    #   用户来点停单日时不能被顺手抹掉 —— 否则他原来的 15 次会静默变成按日历算的 16 次。
    #   显式传 null / "" ⇒ 清空（= 该月回到按日历算）。
    if "count_override" in body:
        co_raw = body.get("count_override")
        if co_raw is None or str(co_raw).strip() == "":
            co = None
        else:
            try:
                co = int(co_raw)
            except (TypeError, ValueError):
                return JSONResponse(status_code=400,
                                   content={"success": False, "error": "本月到货次数须为整数"})
            if co <= 0:
                co = None
    else:
        co = old.get("count_override")
    try:
        conn.execute("SELECT 1 FROM rebate_arrival_skips LIMIT 1")
    except Exception:
        # 老租户库在启动补丁跑完之前没有这张表。**明确报错**，不假装成功 ——
        # 否则用户以为停单存下了，实际什么都没发生（本项目最忌讳的静默失效）。
        return JSONResponse(status_code=503, content={
            "success": False,
            "error": "停单功能尚未就绪（服务端数据表迁移未完成），请稍后重试或联系管理员"})
    _cleared = False
    if not sd and co is None:
        conn.execute("DELETE FROM rebate_arrival_skips WHERE rule_id=? AND ym=?", (rule_id, ym))
        action = "arrival_skip_clear"
        _cleared = True
    else:
        conn.execute(
            "INSERT INTO rebate_arrival_skips"
            " (rule_id, ym, skip_dates, count_override, updated_by, updated_at)"
            " VALUES (?,?,?,?,?, datetime('now','localtime'))"
            " ON CONFLICT(rule_id, ym) DO UPDATE SET"
            "   skip_dates=excluded.skip_dates,"
            "   count_override=excluded.count_override,"
            "   updated_by=excluded.updated_by,"
            "   updated_at=excluded.updated_at",
            (rule_id, ym, sd, co, fl.who(request)))
        action = "arrival_skip_set"
    conn.commit()
    _stored = _load_month_skips(conn, rule_id, year, month)
    summary = arrival_summary(rule, year, month, _stored)
    summary["skip_dates_stored"] = (_stored or {}).get("skip_dates") or ""
    # v365：如实回执「哪几期的报单期次（不再 / 恢复）自动新建」。
    #   算失败**不假装成功**：回 computed=False，界面据此闭嘴（而不是印一句"无影响"）。
    #   🔴 界面上「把停单日全点掉再保存」走的就是**这条 PUT**（不是 DELETE）——
    #      此时该月记录被删、`skip_dates_stored` 为空；若还按 effect=skip 算，
    #      会因 days 为空直接返回"无影响"，把「恢复自动新建」这件事实**完全瞒掉**。
    #      故按 action 分成两种语义：清空 ⇒ restore（拿**被删掉的那些天**定位期次）。
    try:
        if _cleared:
            summary["affected_periods"] = _affected_auto_periods(
                conn, rule_id, (old or {}).get("skip_dates") or "", effect="restore")
        else:
            summary["affected_periods"] = _affected_auto_periods(
                conn, rule_id, summary["skip_dates_stored"], effect="skip",
                # 本月旧值：把旧的摘掉再并新的，别把该规则**其它月份**的停单日一起抹掉
                prev_days=(old or {}).get("skip_dates"))
    except Exception as _e:
        logger.warning("[v365] 计算受影响期次失败 rule=%s: %s", rule_id, _e)
        summary["affected_periods"] = {"computed": False, "affected": [], "error": str(_e)}
    _log_rule_change(request, rule_id, action,
                     [("%s 到货安排" % ym,
                       _arr_skip_txt(old.get("skip_dates"), old.get("count_override")),
                       _arr_skip_txt(sd if (sd or co is not None) else "", co))],
                     _rule_ref_of(row))
    return {"success": True, "data": summary}


@router.delete("/{rule_id}/arrival-skips")
def clear_arrival_skips(request: Request, rule_id: int, year: int = 0, month: int = 0):
    """删掉该月的手动调整 ⇒ 该月立刻恢复系统推算。**其它月不受影响。**"""
    _auth(request)
    conn = _connect()
    row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"success": False, "error": "规则不存在"})
    rule = dict(_row_to_dict(row))
    if not year or not month:
        _t = date.today()
        year, month = _t.year, _t.month
    ym = "%04d-%02d" % (year, month)
    old = _load_month_skips(conn, rule_id, year, month)
    try:
        conn.execute("SELECT 1 FROM rebate_arrival_skips LIMIT 1")
    except Exception:
        return JSONResponse(status_code=503, content={
            "success": False,
            "error": "停单功能尚未就绪（服务端数据表迁移未完成），请稍后重试或联系管理员"})
    conn.execute("DELETE FROM rebate_arrival_skips WHERE rule_id=? AND ym=?", (rule_id, ym))
    conn.commit()
    if old:
        _log_rule_change(request, rule_id, "arrival_skip_clear",
                         [("%s 到货安排" % ym,
                           _arr_skip_txt(old.get("skip_dates"), old.get("count_override")),
                           "无（按系统推算）")],
                         _rule_ref_of(row))
    # v365：被这一删「**恢复**自动新建」的期次。
    #   与 PUT 对称：取消停单同样会改变「系统会不会自动建这一期」，用户要知道。
    #   🔴 传进去的是**被删掉的那些天**（= 删除前的停单日）：它们既是"这一条规则曾经
    #      打中过哪些期次"的定位键，也是从停单集里要摘掉的部分 —— 但**结论按摘掉之后算**。
    _restore = {"computed": True, "affected": []}
    try:
        _restore = _affected_auto_periods(conn, rule_id,
                                         (old or {}).get("skip_dates") or "",
                                         effect="restore")
    except Exception as _e:
        logger.warning("[v365] 计算恢复期次失败 rule=%s: %s", rule_id, _e)
        _restore = {"computed": False, "affected": [], "error": str(_e)}
    _sum = arrival_summary(rule, year, month, None)
    _sum["skip_dates_stored"] = ""
    _sum["affected_periods"] = _restore      # 语义：这些期次会**恢复**自动新建
    return {"success": True, "data": _sum}
