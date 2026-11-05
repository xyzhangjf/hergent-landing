"""
Hergent ERP — 主动推送引擎
每分钟检查触发条件，生成推送消息到站内通知中心
"""

import threading, time, json, os, subprocess, logging
from datetime import datetime, timedelta
import erp_db as db
from db.connection import get_tenant_context
from backup import _run_offsite_backup

# v304（2026-09-28）：让调度器日志**立即**落到 journald。
# 🔴 为什么必须：systemd 下 stdout 是 pipe ⇒ Python 默认**块缓冲**（8KB），`print` 要等
#    缓冲区满（或进程退出）才 flush ⇒ **日志时间戳是"flush 时刻"而不是"打印时刻"**。
#    实证（2026-09-28）：`[Scheduler] Started` 在 08:54:25 启动的进程里，时间戳却是 08:55:01
#    （36 秒后）；而 09:02 重启的进程**一条都看不到**（缓冲还没满）⇒ 排查时被判成
#    「调度器根本没启动」，方向直接跑偏。
#    ⇒ 行缓冲后每行立即落盘，"跑了但没输出"与"根本没跑"才区分得开（R8）。
try:
    import sys as _sys
    _sys.stdout.reconfigure(line_buffering=True)
    _sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

_running = False
_monitors_run = {}  # track last run time per monitor


def start():
    global _running
    if _running:
        return
    _running = True
    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    print("[Scheduler] Started")


def _loop():
    while _running:
        try:
            now = datetime.now()
            try:
                from monitoring import mark_scheduler_tick
                mark_scheduler_tick()
            except Exception:
                pass
            # ---- 库存/应收预警：节流执行（原每分钟无条件跑且无去重，既刷屏又在多租户遍历后按租户数放大）----
            if _should_run("low_stock", 1800, now):
                _run_per_tenant(_check_low_stock, "low_stock")
            if _should_run("overdue_receivables", 3600, now):
                _run_per_tenant(_check_overdue_receivables, "overdue")

            # v89: Check user cron tasks
            if _should_run("cron_tasks", 60, now):
                _run_per_tenant(_check_cron_tasks, "cron_tasks")

            # ---- v242 报单自动化：到点自动建表 / 到点自动关单 ----
            # 每 5 分钟一轮，逐租户；**默认零行为**（租户内无 auto_period_enabled=1
            # 的规则时立即返回，一个字节都不写）。演练期置 HERGENT_AUTO_PERIOD_DRY_RUN=1
            # 只记日志不写库。
            if _should_run("auto_period", 300, now):
                _run_per_tenant(_check_auto_period, "auto_period")

            # ---- 每10分钟检查 ----
            if _should_run("expense_anomaly", 600, now):
                _run_per_tenant(_check_expense_anomaly, "expense_anomaly")

            # ---- 每分钟检查 ----
            if _should_run("webhook_delivery", 60, now):
                _check_webhook_delivery()
            # v88: Alert evaluation — every 60 seconds
            if _should_run("alert_evaluation", 60, now):
                try:
                    from alerting import evaluate_all
                    _run_per_tenant(evaluate_all, "alerts")
                except Exception as e:
                    print(f"[Scheduler] Alert evaluation error: {e}")
            if _should_run("system_monitor", 300, now):
                try:
                    from monitoring import check_and_alert
                    check_and_alert()
                except Exception as e:
                    print(f"[Scheduler] System monitor error: {e}")
            if _should_run("metrics_session_count", 60, now):
                _update_session_count()
            if _should_run("slow_query_check", 300, now):
                _check_slow_queries()

            # ---- 每小时检查 ----
            if _should_run("inactive_customers", 3600, now):
                _run_per_tenant(_check_inactive_customers, "inactive_customers")
            if _should_run("expiry_check", 3600, now):
                _run_per_tenant(_check_expiry, "expiry")
            if _should_run("contract_expiry", 3600, now):
                _run_per_tenant(_check_contract_expiry, "contract_expiry")
            if _should_run("cleanup_idle_sessions", 600, now):
                _cleanup_idle_sessions()


            # ---- 每天8:00检查 ----
            # ---- 每天2:00自动备份（深挖第五期 ①：用新 admin_backup 模块替换原 _run_backup） ----
            if _should_run_at("auto_backup", now, interval_sec=86400, hours=(2,)):
                try:
                    from routers.admin_backup import _do_backup, _cleanup_old, BACKUP_ROOT
                    from datetime import date as _date
                    target = os.path.join(BACKUP_ROOT, _date.today().strftime("%Y-%m-%d"))
                    _do_backup(target)
                    _cleanup_old()
                    print(f"[Scheduler] local backup done: {target}")
                except Exception as e:
                    print(f"[Scheduler] auto_backup error: {e}")
                _run_pg_backup()
                try:
                    _run_offsite_backup()
                except Exception as e:
                    print(f"[Scheduler] Off-site backup error: {e}")


            if _should_run_at("morning_report", now, interval_sec=86400, hours=(8,)):
                _run_per_tenant(_generate_morning_report, "morning_report")
            # Phase 3C: Daily procurement plan at 6:00 AM (before morning report)
            if _should_run_at("procurement_plan", now, interval_sec=86400, hours=(6,)):
                _run_per_tenant(_auto_procurement_plan, "procurement_plan")
            # v303: 厂家承诺到期提醒（每天 8:00，与晨报/催收同一档）。
            #   与手动扫描端点共用 routers/commitments.py::check_commitment_due。
            if _should_run_at("commitment_due", now, interval_sec=86400, hours=(8,)):
                _run_per_tenant(_check_commitment_due, "commitment_due")
            # v88: Daily dunning evaluation at 8:00 AM
            if _should_run_at("dunning_eval", now, interval_sec=86400, hours=(8,)):
                try:
                    from dunning import evaluate_dunning_levels
                    actions = evaluate_dunning_levels()
                    if actions: print(f"[Scheduler] Dunning: {len(actions)} actions generated")
                except Exception as e:
                    print(f"[Scheduler] Dunning error: {e}")

            # ---- v91: 每天8:00 AI时间线生成 ----
            if _should_run_at("timeline_generate", now, interval_sec=86400, hours=(8,)):
                try:
                    from routers.timeline import _generate_timeline_entries
                    gen = _generate_timeline_entries()
                    if gen > 0: print(f"[Scheduler] Timeline: {gen} entries generated")
                except Exception as e:
                    print(f"[Scheduler] Timeline error: {e}")

            # ---- 每天7:30 AI生成经营洞察推送到通知 ----
            if _should_run_at("ai_daily_insight", now, interval_sec=86400, hours=(7,), minute_from=30, minute_to=35):
                _run_per_tenant(_generate_ai_daily_insight, "ai_daily_insight")
            # ---- 每天7:35 LLM 个性化经营洞察（深挖第四期 ③，跨表因果，替代 SQL 模板）----
            if _should_run_at("llm_insight", now, interval_sec=86400, hours=(7,), minute_from=35, minute_to=40):
                _run_per_tenant(_generate_llm_insight, "llm_insight")
            # ---- 每天8:05 副驾经营卡简报（货损/工资/返利，复用 M4 三卡只读聚合，不重复造调度/推送）----
            if _should_run_at("copilot_cards_brief", now, interval_sec=86400, hours=(8,), minute_from=5, minute_to=10):
                _push_copilot_cards_brief()
            # ---- P0-3: 预报催单（v305：改为每 5 分钟检查，**节点时刻由租户配置算出**）----
            # 🔴 为什么不再写死 9:00/16:00：面板配的是「截止前 N 小时 / 最后 N 小时」这种
            #   **相对量**，而租户真实关单时刻是配置项（tenant_1 = 11:00）——
            #   固定钟点既表达不了相对量，在「D-1 16:00 开 / D 11:00 关」的节奏下
            #   16 点那轮还**结构上永远是空的**。
            #   幂等由 `_run_forecast_reminder_for_tenant` 内部的记账保证
            #   （同一期次同一节点只发一次）⇒ 5 分钟一轮**不会**变成 5 分钟催一次。
            if _should_run("forecast_reminder", 300, now):
                _push_forecast_reminder()

            # ---- 每周一8:00档案健康检查 ----
            if _should_run_at("catalog_health", now, interval_sec=604800, hours=(8,), weekday=0):
                _run_per_tenant(_check_catalog_health, "catalog_health")

            # ---- 每小时检查定时激活的价目表 ----
            if _should_run("price_list_scheduled", 3600, now):
                _run_per_tenant(_check_scheduled_price_lists, "price_list_scheduled")

            # ---- 每小时清理过期session ----
            if _should_run("session_cleanup", 3600, now):
                _cleanup_expired_sessions()

            # ---- 每分钟扫描到点的 AI 提醒（② 待办提醒：站内通知 + 租户渠道，到点即推）----
            _check_ai_reminders()

            # ---- T8: 定时拉取所有已连接数据源到对应租户库（每租户隔离）----
            _interval = int(os.getenv("DATASOURCE_SYNC_INTERVAL", "3600"))
            if _should_run("datasource_sync", _interval, now):
                _sync_all_datasources()

            # ---- 连接健康重校：每 60s 巡检各租户已启用渠道（迁移自桌面 gateway.js checkHealth）----
            if _should_run("channel_health", 60, now):
                _check_channel_health()

            # ---- v89: 每小时释放过期库存锁定 ----
            if _should_run("release_expired_locks", 3600, now):
                try:
                    result = db.release_expired_locks()
                    if result.get("released", 0) > 0:
                        print(f"[Scheduler] Released {result['released']} expired stock lock(s)")
                except Exception as e:
                    print(f"[Scheduler] Stock lock release error: {e}")

            # ---- 执行数据库中的定时任务 ----
            tasks = db.task_get_due()
            for t in tasks:
                _execute_scheduled_task(t)

        except Exception as e:
            print(f"[Scheduler] Error: {e}")
        time.sleep(60)


def _should_run(name, interval_sec, now):
    """Check if a monitor should run based on its last run time.

    ⚠️ 只给**纯间隔**任务用（low_stock / overdue_receivables / cron_tasks …）。

    🔴 v304（2026-09-28）：**绝不要**用它搭配 `and now.hour == X` 这类时间窗条件。
       本函数在返回 True 时**无条件记账**（`_monitors_run[name] = now`），而调用处是用 `and`
       把时间窗接在后面的 ⇒ 时间窗**只在记账那一分钟被检查**，而那一刻被
       “进程启动时刻 + interval 的整数倍”锁死 ⇒ 只要服务不是在窗口内启动，这个任务
       **永远跑不到**，且零报错。
       实测（1440 个可能启动时刻全遍历）：窗口 9:00-9:05、间隔 3600s 时命中率 **8.33%**；
       窗口 5 分钟、间隔 86400s 时命中率 **0.35%**。
       生产后果：报单催单**历史 0 条**（
       `message_center` 近30天：库存预警 722 条、应收 417 条，而催单 0 条）。
       ⇒ 需要时间窗的，一律改用 `_should_run_at()`（它**只在窗口内才记账**）。
    """
    last = _monitors_run.get(name)
    if last is None or (now - last).total_seconds() >= interval_sec:
        _monitors_run[name] = now
        return True
    return False


def _should_run_at(name, now, *, interval_sec, hours=None, minute_from=0,
                   minute_to=5, weekday=None):
    """带时间窗的节流（v304）—— 判断与记账分离，**窗口外不记账**。

    为什么必须有这个函数：见 `_should_run` 的警告。核心是把时间窗**纳入条件本身**，
    这样窗口外直接返回 False 且**不更新 `_monitors_run`**，相位不会被污染；
    落到窗口内时才走正常的间隔节流（防止 60 秒一轮的循环在 5 分钟窗口里重复执行）。

    参数：
      hours        : 允许的小时集合，如 (8,) / (9, 16)；None = 不限
      minute_from  : 窗口起始分钟（含）
      minute_to    : 窗口结束分钟（不含）—— 默认 5，即 `0 <= minute < 5`
      weekday      : 允许的星期（0=周一）；None = 不限

    副作用：命中时打一行 `[Scheduler] <name> 到点触发` —— 这是**唯一的可观测抓手**，
    否则“跑了但无事可做”与“根本没跑”在日志里长得一模一样（R8：静默失效必须显式化）。
    """
    if hours is not None and now.hour not in hours:
        return False
    if weekday is not None and now.weekday() != weekday:
        return False
    if not (minute_from <= now.minute < minute_to):
        return False
    last = _monitors_run.get(name)
    if last is None or (now - last).total_seconds() >= interval_sec:
        _monitors_run[name] = now
        print(f"[Scheduler] {name} 到点触发（{now:%Y-%m-%d %H:%M}）")
        return True
    return False


# ============================================================
# Monitor 0: Webhook Delivery
# ============================================================
def _check_webhook_delivery():
    """Deliver pending webhook events. Runs every minute."""
    try:
        import erp_db as db
        from routers.webhook import deliver_event
        pending = db.webhook_get_pending()
        if not pending:
            return
        delivered = 0
        for evt in pending:
            try:
                deliver_event(evt)
                delivered += 1
            except Exception as e:
                print(f"[Scheduler] Webhook delivery error (evt {evt.get('id','?')}): {e}")
        if delivered > 0:
            print(f"[Scheduler] Webhook: delivered {delivered}/{len(pending)} events", flush=True)
    except Exception as e:
        print(f"[Scheduler] Webhook delivery error: {e}")

# ============================================================
# Monitor 0b: Session Count / Slow Query Monitor (v84)
# ============================================================
def _update_session_count():
    """Update active session count for metrics endpoint."""
    try:
        import core
        conn = core._master_db()
        try:
            cnt = conn.execute("SELECT COUNT(*) FROM sessions WHERE (expires_at='' OR datetime(expires_at) > datetime('now','localtime'))").fetchone()[0]
            from metrics import set_active_sessions
            set_active_sessions(cnt)
        finally: conn.close()
    except Exception as e:
        logging.getLogger("hergent").debug(f"optional step failed: {e}")

def _check_slow_queries():
    """Log a WARNING if query count is high (basic health pulse)."""
    try:
        from metrics import _http_requests
        total = sum(_http_requests.values()) if hasattr(_http_requests, 'values') else 0
        if total > 100000:
            logging.getLogger("hergent").warning(f"High request volume: {total} total requests")
    except Exception as e:
        logging.getLogger("hergent").debug(f"optional step failed: {e}")

# ============================================================
# 多租户遍历包装器（商业化前置：第二家客户起也要收到自己的提醒）
# ============================================================
def _run_per_tenant(fn, label):
    """把单租户 monitor 包成遍历全部租户：set_tenant_context(tid) → fn() → finally 复位主库。

    只做上下文切换的外壳包装，不改动 monitor 内部任何逻辑；单个租户抛错不影响其余租户
    （fail-closed）。注意：被包装的 monitor 必须只依赖 get_db()（受租户上下文控制），
    不能依赖主库表（如 tenants）。_tenant_ids / set_tenant_context 均为运行时解析。
    """
    try:
        from db.connection import set_tenant_context
    except Exception as e:
        print(f"[Scheduler] {label} tenant context import error: {e}")
        return
    tids = _tenant_ids()
    if not tids:
        return
    for tid in tids:
        try:
            set_tenant_context(tid)
            fn()
        except Exception as e:
            print(f"[Scheduler] {label} tenant={tid} error: {e}")
        finally:
            set_tenant_context(None)


# ============================================================
# Monitor 1: Low Stock Alert
# ============================================================
def _check_low_stock():
    try:
        inv = db.inventory_query(low_stock_only=True)
        if not inv:
            return
        critical = [i for i in inv if i["quantity"] <= i.get("safety_stock", 10)]
        if critical:
            items_text = "、".join([f"{i['name']}(仅剩{i['quantity']}{i.get('unit','件')})" for i in critical[:5]])
            more = f" 等{len(critical)}个商品" if len(critical) > 5 else ""
            msg = f"经营副驾：以下商品库存不足，建议采购补货——{items_text}{more}"
            # v352 纪律：event_key 显式传固定值，不依赖标题现算
            # （前端「按类静音/暂停」挂在该键上，标题漂移会让静音规则静默失效）
            db.message_send("库存预警", msg, "warning", "经营副驾", event_key="库存预警")
            # P22-a：同一预警外发到租户自己的企微/飞书渠道（节流：同题一天一条）。
            # _run_per_tenant 包装保证 set_tenant_context(tid) 已生效；tid 为 None
            # （不在 per-tenant 上下文）时 _push_alert_throttled 内部 fail-closed 不外发。
            tid = get_tenant_context()
            if tid: _push_alert_throttled(tid, "库存预警", msg)
    except Exception as e:
        print(f"[Scheduler] Low stock check error: {e}")


# ============================================================
# Monitor 2: Overdue Receivables
# ============================================================
def _check_overdue_receivables():
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        data = db.receivable_list(contact_type="customer")
        overdue = [r for r in data.get("receivables", []) if r["status"] != "paid" and r.get("due_date", "") < today]
        if overdue:
            total = sum(r["amount"] - r["paid_amount"] for r in overdue)
            top = sorted(overdue, key=lambda r: r["amount"] - r["paid_amount"], reverse=True)[:3]
            top_text = "、".join([f"{r['contact_name']}(¥{r['amount']-r['paid_amount']:,.0f})" for r in top])
            msg = f"会计：以下客户应收账款已逾期，建议催收——{top_text}，逾期总额 ¥{total:,.0f}"
            db.message_send("应收逾期提醒", msg, "danger", "会计")
    except Exception as e:
        print(f"[Scheduler] Overdue check error: {e}")


# ============================================================
# v89: User Cron Tasks
# ============================================================
def _check_cron_tasks():
    try:
        due = db.cron_get_due()
        for task in due:
            _execute_scheduled_task({
                "id": task["id"],
                "name": task["name"],
                "prompt": task["prompt"],
                "role": task.get("role", "dami"),
                # v330：把创建者带下去 —— 否则结果通知只能广播（见 _execute_scheduled_task）
                "user_id": task.get("user_id") or "",
            })
            db.cron_mark_run(task["id"])
    except Exception as e:
        print(f"[Scheduler] Cron tasks check error: {e}")

# ============================================================
# Monitor 3: Expense Anomaly Detection
# ============================================================
def _check_expense_anomaly():
    try:
        anomalies = db.get_anomalies()
        if not anomalies:
            return
        expense_anomalies = anomalies.get("expenses", []) if isinstance(anomalies, dict) else []
        if expense_anomalies:
            for a in expense_anomalies[:3]:
                msg = f"会计：检测到异常大额支出——{a.get('detail','')} ¥{a.get('amount',0):,.0f}，请确认"
                db.message_send("异常支出预警", msg, "warning", "会计")
    except Exception as e:
        print(f"[Scheduler] Anomaly check error: {e}")


# ============================================================
# Monitor 4: Inactive Customer Alert
# ============================================================
def _check_inactive_customers():
    try:
        churn = db.get_churn_risk(30)
        if not churn:
            return
        customers = churn.get("at_risk", []) if isinstance(churn, dict) else []
        if customers:
            top = customers[:5]
            names = "、".join([f"{c.get('name','')}({c.get('days_since_last','?')}天未下单)" for c in top])
            msg = f"经营副驾：以下客户超过30天未下单，有流失风险——{names}，建议回访"
            db.message_send("客户流失预警", msg, "warning", "经营副驾")
    except Exception as e:
        print(f"[Scheduler] Churn check error: {e}")


# ============================================================
# Monitor 5: Morning Daily Report
# ============================================================
def _generate_morning_report():
    """Generate and push daily profit report via the Phase 2C profit reporter."""
    try:
        # Phase 2C: Use the new comprehensive profit reporter
        from domain.profit_reporter import push_daily_report
        result = push_daily_report()

        if result["success"]:
            print(f"[Scheduler] Daily profit report pushed: {result['title']}")
        else:
            print(f"[Scheduler] Daily profit push failed, in-app only: {result.get('push_result', {})}")

        # 站内通知**只落一条**（2026-09-14 修双发）。
        # 原先推送失败时会连落两条：一条 format_wecom_message 的完整版、一条下面的简版，
        # 两条标题格式还不同（`盈亏快报 · 2026-09-13` vs `09月13日盈亏快报`）→ 用户在
        # 通知面板里看到两份日报；又因为写端去重键含 title，两条永远折不到一起。
        # 现在统一为简版一条（通知面板定位是「收敛视图」，完整明细看经营看板），
        # 推送失败不再额外落库，只在日志留痕。
        report = result.get("report")
        if report is None and not result.get("success"):
            try:
                from domain.profit_reporter import generate_daily_report
                report = generate_daily_report()
            except Exception as e:
                print(f"[Scheduler] Daily report recompute failed: {e}")
        if report:
            today = datetime.now().strftime("%m月%d日")
            sales = report.get("sales", {})
            msg = (
                f"销售额: ¥{sales.get('revenue', 0):,.0f} ({sales.get('order_count', 0)}单)\n"
                f"毛利: ¥{sales.get('gross_profit', 0):,.0f} (毛利率{sales.get('gross_margin', 0)}%)\n"
                f"临期预警: 红{report.get('expiry', {}).get('red_count', 0)}项 "
                f"过期{report.get('expiry', {}).get('expired_count', 0)}项\n"
                f"应收未结: ¥{report.get('ar_ap', {}).get('ar_balance', 0):,.0f}"
            )
            db.message_send(f"{today}盈亏快报", msg, "notice", "经营副驾")
    except Exception as e:
        print(f"[Scheduler] Morning report error: {e}")
        # Ultimate fallback: old behavior
        try:
            from accountant import _daily_summary
            summary = _daily_summary()
            today = datetime.now().strftime("%m月%d日")
            msg = f"早上好！{today}经营简报——{json.dumps(summary, ensure_ascii=False)}"
            db.message_send(f"{today}经营日报", msg, "notice", "经营副驾")
        except Exception as e2:
            print(f"[Scheduler] Morning report fallback also failed: {e2}")


def _auto_procurement_plan():
    """Phase 3C: Auto-generate procurement plan and push to WeCom (daily 6AM)."""
    try:
        from notify.procurement_notify import auto_generate_and_push
        result = auto_generate_and_push()
        if result["success"]:
            if result.get("plan_no"):
                print(f"[Scheduler] Procurement plan {result['plan_no']} generated and pushed: {result['total_items']} items, ¥{result['total_amount']:,.2f}")
            else:
                print(f"[Scheduler] No procurement needed today")
        else:
            print(f"[Scheduler] Procurement plan push failed: {result.get('message', '')}")
    except Exception as e:
        print(f"[Scheduler] Auto procurement error: {e}")


# ============================================================
# Scheduled Tasks (from DB)
# ============================================================
def _execute_scheduled_task(task):
    try:
        print(f"[Scheduler] Running task: {task['name']}")
        db.task_update_last_run(task["id"])

        from hermes_core import call_hermes_agent
        reply, _, _ = call_hermes_agent(task["prompt"], role=task.get("role", "dami"))
        # 2026-09-14：标题原先直接用 task["name"]，而 name 往往是用户当初的整句原话
        # （生产实测 39 条标题 =「你帮我设个定时任务，每天上午8点把当日AI方面的重大
        # 新闻发给我」）→ 通知面板里读不成句，也没法做「按类静音」（静音键含标题）。
        # 统一为「定时任务·{名前16字}」，完整原话仍保留在正文里。
        tname = (task.get("name") or "").strip() or "未命名"
        title = "定时任务·" + (tname[:16] + "…" if len(tname) > 16 else tname)
        msg = f"定时任务「{tname}」执行结果：{reply[:500]}"
        # v330：结果通知**只发给任务创建者**。
        #   此前 `recipients` 留空 = 广播（全租户可见）⇒ 老板的私人定时任务
        #   （生产实测 39 条标题=「你帮我设个定时任务，每天上午8点把当日AI方面的重大新闻发给我」）
        #   连**任务原话带执行结果**一起推给了全租户，销售也收到了。
        # 🔴 `cron_tasks.user_id` / `scheduled_tasks.user_id` 存的就是 `users.id`
        #   （生产核对：id=1 → admin），符合同一族「recipients 必须是 users.id」的口径；
        #   取不到创建者（0/空）时留空 ⇒ 退回事件键受众（管理端），不广播给业务员。
        _uid = str(task.get("user_id") or "").strip()
        db.message_send(title, msg, "notice", task.get("role", "系统"),
                        recipients=(_uid if _uid and _uid != "0" else ""))
        # ④ cron 结果回流：执行结论落 execution_log，补「到点自动跑 + 结果交付」闭环
        _log_cron_execution(task, reply[:1000] if reply else "", "success")
    except Exception as e:
        print(f"[Scheduler] Task {task.get('name','?')} error: {e}")
        _log_cron_execution(task, str(e)[:1000], "error")


def _log_cron_execution(task, result_text, status):
    """把 cron 执行结果落 tenant 库 cron_execution_log（④）。fail-closed。"""
    try:
        with db.get_db_tx() as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS cron_execution_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id INTEGER DEFAULT 0,
                    task_name TEXT DEFAULT '',
                    prompt TEXT DEFAULT '',
                    result TEXT DEFAULT '',
                    status TEXT DEFAULT 'success',
                    created_at TEXT DEFAULT (datetime('now','localtime'))
                )"""
            )
            c.execute(
                "INSERT INTO cron_execution_log (task_id, task_name, prompt, result, status) "
                "VALUES (?,?,?,?,?)",
                (task.get("id", 0), task.get("name", ""), task.get("prompt", "")[:2000],
                 result_text[:2000], status),
            )
    except Exception as e:
        print(f"[Scheduler] cron exec log error: {e}")


# ============================================================
# T8: Scheduled Data Source Sync (金蝶/畅捷通 → 租户库)
# ============================================================
def _sync_all_datasources():
    """周期性拉取所有已连接数据源到对应租户库，每租户隔离。

    遍历 datasource_bindings（主库），对每个 (tenant_id, source)：
      set_tenant_context(tid) → sync_source 全对象 → finally reset。
    单个租户失败不影响其他租户；未配置 AppKey 的连接器在构造/同步时抛错被吞。
    """
    try:
        from datasource_store import list_all_bindings
        from sync_writer import sync_source, ALL_OBJECTS
        from kingdee_connector import (KingdeeClient, map_product as k_map_p, map_contact as k_map_c,
                                        map_inventory as k_map_i, map_sales_order as k_map_so,
                                        map_purchase_order as k_map_po)
        from chanjet_connector import (ChanjetClient, map_product as c_map_p, map_contact as c_map_c,
                                        map_inventory as c_map_i, map_sales_order as c_map_so,
                                        map_purchase_order as c_map_po)
        from db.connection import set_tenant_context
    except Exception as e:
        print(f"[Scheduler] Datasource sync import error: {e}")
        return

    bindings = list_all_bindings()
    if not bindings:
        return
    for b in bindings:
        tid, source = b["tenant_id"], b["source"]
        try:
            set_tenant_context(tid)
            if source == "kingdee":
                client = KingdeeClient()
                total = sync_source("kingdee", client, k_map_p, k_map_c, ALL_OBJECTS, "",
                                    tid, map_inventory=k_map_i, map_sales_order=k_map_so,
                                    map_purchase_order=k_map_po)
            elif source == "chanjet":
                client = ChanjetClient()
                total = sync_source("chanjet", client, c_map_p, c_map_c, ALL_OBJECTS, "",
                                    tid, map_inventory=c_map_i, map_sales_order=c_map_so,
                                    map_purchase_order=c_map_po)
            else:
                continue
            synced = (total["products"] + total["customers"] + total["suppliers"]
                      + total["inventory"] + total["sales_orders"] + total["purchase_orders"])
            print(f"[Scheduler] Datasource sync tenant={tid} source={source}: {synced} records"
                  + (f", {len(total['errors'])} errors" if total["errors"] else ""))
        except Exception as e:
            print(f"[Scheduler] Datasource sync tenant={tid} source={source} error: {e}")
        finally:
            set_tenant_context(None)  # 复位到主库，避免污染后续任务上下文


# ============================================================
# Monitor 6: Automated Database Backup
# ============================================================
def _backup_retention_days():
    try:
        r = db.get_config("backup_retention_days")
        return int(r) if r else 7
    except Exception:
        # 旧写法是裸 `except:`：读配置失败会静默按 7 天清理，若租户实际策略更长会提前删备份，
        # 必须留痕（兜底值本身保留，不能因为读不到配置就不做备份轮转）。
        print("[Scheduler] 读取 backup_retention_days 失败，本次按默认 7 天轮转")
        return 7

def _run_backup():
    import shutil, os
    now = datetime.now()
    ts = now.strftime("%Y%m%d_%H%M%S")
    db_path = db.DB_PATH
    backup_dir = os.path.join(os.path.dirname(db_path), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, f"erp_{ts}.db")

    try:
        shutil.copy2(db_path, backup_path)
        size = os.path.getsize(backup_path)
        db.backup_history_add(f"erp_{ts}.db", size, "success")
        print(f"[Scheduler] Backup: {backup_path} ({size} bytes)")

        # Cleanup old backups
        retention = _backup_retention_days()
        cutoff = now - timedelta(days=retention)
        for f in os.listdir(backup_dir):
            if f.startswith("erp_") and f.endswith(".db"):
                fpath = os.path.join(backup_dir, f)
                mtime = datetime.fromtimestamp(os.path.getmtime(fpath))
                if mtime < cutoff:
                    os.remove(fpath)
                    print(f"[Scheduler] Removed old backup: {f}")
    except Exception as e:
        print(f"[Scheduler] Backup failed: {e}")
        try:
            db.backup_history_add(f"erp_{ts}.db", 0, f"failed: {str(e)[:200]}")
        except Exception as e:
            logging.getLogger("hergent").debug(f"optional step failed: {e}")

def _run_pg_backup():
    """PostgreSQL backup via pg_dump. Silently skips if not in PG mode."""
    import shutil
    try:
        db_url = os.environ.get("DATABASE_URL", "")
        if not db_url or not db_url.startswith("postgresql://") and not db_url.startswith("postgres://"):
            return  # SQLite mode — no PG backup needed
    except Exception:
        return

    now = datetime.now()
    ts = now.strftime("%Y%m%d_%H%M%S")
    db_path = db.DB_PATH
    backup_dir = os.path.join(os.path.dirname(db_path), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, f"erp_pg_{ts}.dump")

    try:
        result = subprocess.run(
            ["pg_dump", "-Fc", "-f", backup_path, db_url],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            size = os.path.getsize(backup_path)
            db.backup_history_add(f"erp_pg_{ts}.dump", size, "success")
            print(f"[Scheduler] PG Backup: {backup_path} ({size} bytes)", flush=True)
        else:
            err_msg = result.stderr[:200] if result.stderr else f"exit code {result.returncode}"
            db.backup_history_add(f"erp_pg_{ts}.dump", 0, f"failed: {err_msg}")
            print(f"[Scheduler] PG Backup failed: {err_msg}", flush=True)
    except FileNotFoundError:
        print("[Scheduler] pg_dump not found — skipping PG backup", flush=True)
    except subprocess.TimeoutExpired:
        print("[Scheduler] PG Backup timed out", flush=True)
        db.backup_history_add(f"erp_pg_{ts}.dump", 0, "failed: timeout")
    except Exception as e:
        print(f"[Scheduler] PG Backup error: {e}", flush=True)
        try:
            db.backup_history_add(f"erp_pg_{ts}.dump", 0, f"failed: {str(e)[:200]}")
        except Exception as e:
            logging.getLogger("hergent").debug(f"optional step failed: {e}")

    # Cleanup old PG backups
    try:
        retention = _backup_retention_days()
        cutoff = now - timedelta(days=retention)
        for f in os.listdir(backup_dir):
            if f.startswith("erp_pg_") and f.endswith(".dump"):
                fpath = os.path.join(backup_dir, f)
                mtime = datetime.fromtimestamp(os.path.getmtime(fpath))
                if mtime < cutoff:
                    os.remove(fpath)
                    print(f"[Scheduler] Removed old PG backup: {f}")
    except Exception as e:
        logging.getLogger("hergent").debug(f"optional step failed: {e}")

# ============================================================
# Monitor 7: Expiry Alert
# ============================================================
def _check_expiry():
    """Check for products expiring within 30 days."""
    try:
        from db.queries.inventory import get_expiry_alerts
        alerts = get_expiry_alerts(30)
        # _days_until 会对不可解析日期返回 None：这类记录不进任何一档，
        # 但已从 999（永不到期，静默失效）改为日志可见，避免永久漏报。
        if not alerts: return
        days = [(a, _days_until(a['expiry_date'])) for a in alerts]
        critical = [a for a, d in days if d is not None and d <= 7]
        warning = [a for a, d in days if d is not None and 7 < d <= 30]
        # P22-a：函数内取一次租户上下文（_run_per_tenant 已 set）；None 时两个
        # _push_alert_throttled 调用点都会 fail-closed 不外发。
        tid = get_tenant_context()
        if critical:
            items = "、".join([f"{a['name']}({a['batch_no']} {a['expiry_date']} ×{a['quantity']}{a['unit']})" for a in critical[:5]])
            more = f" 等{len(critical)}个" if len(critical) > 5 else ""
            msg = f"以下商品7天内到期：{items}{more}"
            db.message_send("效期预警·紧急", msg, "danger", "经营副驾", event_key="效期预警·紧急")
            if tid: _push_alert_throttled(tid, "效期预警·紧急", msg)
        if warning:
            items = "、".join([f"{a['name']}({a['batch_no']} {a['expiry_date']})" for a in warning[:3]])
            more = f" 等{len(warning)}个" if len(warning) > 3 else ""
            msg = f"以下商品30天内到期：{items}{more}"
            db.message_send("效期预警·提醒", msg, "warning", "经营副驾", event_key="效期预警·提醒")
            if tid: _push_alert_throttled(tid, "效期预警·提醒", msg)
    except Exception as e:
        print(f"[Scheduler] Expiry check error: {e}")


def _check_commitment_due():
    """厂家承诺到期提醒（v303）。

    ⚠️ 实现体放在 `routers/commitments.py`，与 `POST /api/commitments/scan-due` 手动扫描
    调用的是**同一个函数** —— 否则会出现"页面上点一下能扫、定时任务扫的是另一套逻辑"
    这种两份实现，改一处漏一处（本项目反复栽的同一类坑）。
    """
    try:
        from routers.commitments import check_commitment_due
        s = check_commitment_due()
        if s.get("overdue_count") or s.get("soon_count"):
            print(f"[Scheduler] Commitments: overdue={s.get('overdue_count')} soon={s.get('soon_count')}")
    except Exception as e:
        print(f"[Scheduler] Commitment due check error: {e}")


def _days_until(date_str):
    """距 date_str 还有几天；日期无法解析时返回 None。

    旧实现异常时返回魔法值 999，语义等价于"还很远"，会让调用方的 7/30 天筛选
    永久漏掉该条记录（合同到期提醒静默失效）。改为返回 None 由调用方显式跳过。
    """
    try:
        from datetime import datetime
        exp = datetime.strptime(date_str, '%Y-%m-%d')
        return (exp - datetime.now()).days
    except (ValueError, TypeError):
        print(f"[Scheduler] 日期无法解析（期望 YYYY-MM-DD）：{date_str!r}，已跳过该条")
        return None

def _check_contract_expiry():
    """Check for contracts expiring within 7 days and push notifications."""
    try:
        contracts = db.get_expiring_contracts(7)
        for ct in contracts:
            days_left = _days_until(ct["end_date"])
            if days_left is None:
                # 旧实现返回 999，等于永远不进 7 天窗口；这里显式跳过并留痕
                print(f"[Scheduler] 合同「{ct['name']}」end_date 无法解析({ct['end_date']})，已跳过到期提醒")
                continue
            label = "今天到期" if days_left <= 0 else f"{days_left}天后到期"
            db.message_send(
                "合同到期提醒",
                f"合同「{ct['name']}」({ct['contact_name']}) {label}，金额 ¥{ct['total_amount']:,.0f}",
                "warning",
                "经营副驾"
            )
            print(f"[Scheduler] Contract expiry: {ct['name']} expires in {days_left}d")
    except Exception as e:
        print(f"[Scheduler] Contract expiry error: {e}")


# ============================================================
# Monitor 8: Weekly Catalog Health
# ============================================================
def _check_catalog_health():
    """Weekly catalog data quality check. Runs every 7 days."""
    try:
        from ai_tools import tool_catalog_health
        health = tool_catalog_health()
        if health["score"] < 90:
            db.message_send(
                "档案健康检查",
                f"📋 档案健康度 {health['score']}/100 ({health['grade']})\n" +
                "\n".join(f"• {i}" for i in health["issues"]) if health["issues"] else "档案质量良好",
                "warning" if health["score"] < 75 else "info",
                "经营副驾"
            )
        print(f"[Scheduler] Catalog health: {health['score']}/100")
    except Exception as e:
        print(f"[Scheduler] Catalog health error: {e}")


def _check_scheduled_price_lists():
    """Activate price lists that have reached their scheduled activation time."""
    try:
        from erp_db import check_scheduled_price_lists
        result = check_scheduled_price_lists()
        if result.get("activated", 0) > 0:
            print(f"[Scheduler] Activated {result['activated']} scheduled price lists")
    except Exception as e:
        print(f"[Scheduler] Price list schedule error: {e}")


def _cleanup_expired_sessions():
    """Remove expired sessions from master DB. Runs every hour."""
    try:
        import core
        conn = core._master_db()
        try:
            conn.execute(
                "DELETE FROM sessions WHERE expires_at!='' AND datetime(expires_at) <= datetime('now','localtime')"
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f"[Scheduler] Session cleanup error: {e}")

def _cleanup_idle_sessions():
    """删除空闲超过阈值的会话。阈值统一取 core.SESSION_IDLE_MINUTES（默认 30 分钟）。

    兜底清理：真正的实时空闲校验在 core._lookup_user_by_token（每次请求判定），
    这里只负责把过期行从库里清掉，顺带处理 last_activity 为空的遗留行（回落到 created_at）。
    """
    try:
        import core
        idle = getattr(core, "SESSION_IDLE_MINUTES", 30)
        if idle <= 0:
            return
        conn = core._master_db()
        try:
            conn.execute(
                "DELETE FROM sessions WHERE "
                "datetime(COALESCE(NULLIF(last_activity,''), NULLIF(created_at,''))) IS NOT NULL AND "
                "datetime(COALESCE(NULLIF(last_activity,''), NULLIF(created_at,''))) < datetime('now','localtime', ?)",
                (f"-{idle} minutes",),
            )
            deleted = conn.rowcount if hasattr(conn, 'rowcount') else 0
            conn.commit()
            if deleted:
                print(f"[Scheduler] Cleaned up {deleted} idle sessions")
        finally:
            conn.close()
    except Exception as e:
        print(f"[Scheduler] Idle session cleanup error: {e}")


def _generate_ai_daily_insight():
    """Generate AI daily insight and push as notification."""
    try:
        from ai_insights import generate_daily_insight
        insight = generate_daily_insight()
        text = insight.get("insight", "")
        if text:
            db.message_send("今日经营洞察", text, "info", "经营副驾")
            print(f"[Scheduler] AI daily insight generated")
    except Exception as e:
        print(f"[Scheduler] AI insight error: {e}")


def _generate_llm_insight():
    """深挖第四期 ③：LLM 读多租户真实数据，生成跨表因果经营洞察并推送。fail-closed。"""
    try:
        from ai_insight_llm import push_llm_insight
        push_llm_insight()
        print(f"[Scheduler] LLM insight generated")
    except Exception as e:
        print(f"[Scheduler] LLM insight scheduler error: {e}")


# ============================================================
# vXX: 副驾经营卡每日简报（复用 M4 三卡只读聚合，不重复造调度/推送）
# ============================================================
def _build_copilot_brief_lines():
    """在【当前租户上下文】聚合货损/工资/返利三卡，返回简报行列表。

    复用已上线的只读聚合：wastage_summary / scan_expiry / calculate_commissions / get_rebate_progress。
    fail-closed：任一聚合异常仅跳过该段，不阻断整条简报、不崩服务。
    """
    try:
        from domain.wastage_tracker import wastage_summary
        from domain.batch_tracker import scan_expiry
    except Exception as e:
        print(f"[Scheduler] copilot cards brief import error: {e}")
        wastage_summary = None
        scan_expiry = None

    lines = []
    today = datetime.now().strftime("%Y-%m-%d")

    # ---- 货损 ----
    try:
        if wastage_summary:
            ws = wastage_summary(30)
            total_loss = round(ws.get("total_loss") or 0, 2)
            total_count = ws.get("total_count") or 0
            scan = scan_expiry(0) if scan_expiry else {}
            at_risk = round(scan.get("total_at_risk_value") or 0, 2)
            # v157：口径跟随后端返回的 tier 清单（scan_expiry 按配方 threshold_days 分档）。
            #   风险值只含「已过期/红/橙」；yellow 降级为「仅关注」，单独报、不计风险。
            _summ = scan.get("summary") or {}
            _risk_tiers = tuple(scan.get("risk_tiers") or ("expired", "red", "orange"))
            _watch_tiers = tuple(scan.get("watch_tiers") or ("yellow",))
            risk_items = sum(int((_summ.get(t) or {}).get("count") or 0) for t in _risk_tiers)
            watch_items = sum(int((_summ.get(t) or {}).get("count") or 0) for t in _watch_tiers)
            watch_value = round(scan.get("total_watch_value") or 0, 2)
            thr = int(scan.get("threshold_days") or 7)
            unscanned = int(scan.get("unscanned_batches") or 0)
            if total_loss > 0 or at_risk > 0:
                _gap = (f"；⚠️ {unscanned} 个在库批次未录到期日，临期风险扫不到" if unscanned else "")
                _watch = (f"；另 {watch_items} 个批次仅关注（{thr + 1}~{max(thr, 14)}天，¥{watch_value:,.0f}，不计风险）"
                          if watch_items else "")
                lines.append(f"📦 货损：近30天已审批报损 ¥{total_loss:,.0f}（{total_count}单）；临期风险值 ¥{at_risk:,.0f}（{risk_items}个批次，{thr}天内）{_watch}{_gap}")
            elif unscanned:
                # v156 B：无报损 ≠ 库存健康 —— 效期没录全时只能说「扫不到」，不能说「健康」
                lines.append(f"📦 货损：近30天无已审批报损，但 {unscanned} 个在库批次未录到期日，临期风险查不出来")
            else:
                _watch = (f"，另 {watch_items} 个批次仅关注（{thr + 1}~{max(thr, 14)}天，不计风险）"
                          if watch_items else "")
                lines.append(f"📦 货损：近30天无已审批报损，临期 {risk_items} 个批次（{thr}天内）{_watch}，效期数据完整")
            try:
                db.log_daily_metric(today, "loss_amount", total_loss)
                db.log_daily_metric(today, "loss_risk_value", at_risk)
                db.log_daily_metric(today, "loss_risk_items", risk_items)
                db.log_daily_metric(today, "loss_watch_items", watch_items)
            except Exception as le:
                print(f"[Scheduler] brief loss log error: {le}")
    except Exception as e:
        print(f"[Scheduler] copilot cards brief loss error: {e}")

    # ---- 工资 ----
    try:
        rows = db.calculate_commissions()
        if rows:
            total_comm = sum(float(r.get("commission") or 0) for r in rows)
            total_sales = sum(float(r.get("sales") or 0) for r in rows)
            lines.append(f"👥 工资：本月提成合计 ¥{total_comm:,.0f}（{len(rows)}人），关联销售额 ¥{total_sales:,.0f}")
            try:
                db.log_daily_metric(today, "payroll_commission", total_comm)
                db.log_daily_metric(today, "payroll_headcount", len(rows))
                db.log_daily_metric(today, "payroll_sales", total_sales)
            except Exception as le:
                print(f"[Scheduler] brief payroll log error: {le}")
        else:
            lines.append("👥 工资：本月暂无已核算的提成数据")
    except Exception as e:
        print(f"[Scheduler] copilot cards brief payroll error: {e}")

    # ---- 返利 ----
    try:
        contracts = db.get_rebate_progress()
        if contracts:
            open_n = len(contracts)
            achieved = sum(float(c.get("achieved") or 0) for c in contracts)
            est = sum(float(c.get("achieved") or 0) * float(c.get("rebate_pct") or 0) / 100.0 for c in contracts)
            lines.append(f"💰 返利：未结合同 {open_n} 个，当年已达成销售额 ¥{achieved:,.0f}，预计返利 ¥{est:,.0f}")
            try:
                db.log_daily_metric(today, "rebate_open", open_n)
                db.log_daily_metric(today, "rebate_achieved", achieved)
                db.log_daily_metric(today, "rebate_est", est)
            except Exception as le:
                print(f"[Scheduler] brief rebate log error: {le}")
        else:
            lines.append("💰 返利：当前无未结返利合同")
    except Exception as e:
        print(f"[Scheduler] copilot cards brief rebate error: {e}")

    return lines


# 🔴 v352：简报的**事件键是固定值**，不再由标题现算。
#   旧实现把租户名拼进标题，而 `message_send` 未传 event_key 时会由
#   `norm_event_key(title)` 现算 ⇒ **事件键也带上了租户名**（生产实测
#   `经营卡简报 · 测试企业A`）。而前端「按类静音 / 暂停」（`useNotiPrefs`）全挂在这个键上
#   ⇒ **租户一改名，用户已设的静音规则会静默全部失效**（同一类通知换个名字继续进来）。
_BRIEF_EVENT_KEY = "经营卡简报"


def _push_tenant_channels(tenant_id, title, content):
    """按租户自己的 Hermes 应用凭证推送简报（飞书/企微/钉钉/QQ）。

    走 hermes_tenants.send_message → Hermes `send` 复用该租户 $HERMES_HOME/.env
    的应用凭证出站，无需网关在跑；每个租户独立 home，绝不会串台。

    优先级：① 租户配过任一渠道 → 只走租户渠道；
           ② 租户完全没配渠道 → **仅当本部署只登记了一个租户**才回落全局 env webhook。
    返回成功推送的渠道数。全程 fail-closed。

    🔴 v352 两道闸门（方向都是「宁可少发，绝不发错人」）：
      闸门① **演示 / 只读租户一律不外发** —— `tenants.readonly=1`（演示与将来的
             体验版环境）或 `subdomain='demo'`。演示数据不能推到真实企微群 / 群机器人。
             对照：`server.py` 的「今日经营要务」早在推送上写了「演示租户不推送」，
             而简报这条路径一直没有 ⇒ 本函数把保护收进**唯一实现**，所有调用方共享。
      闸门② **多租户（登记租户 >= 2 个）禁止回落全局 webhook** —— 全局 webhook 的口径是
             「一个部署一个企微群」（`notify/wecom_notify.py` 自陈），它**没有租户身份**；
             一旦回落，所有「没配渠道的租户」的简报都会进同一个群
             （含演示租户与未来第二家客户）⇒ 改为不推 + 留日志。
             ⚠️ 租户数**读不到**时按多租户处理（拒绝回落）—— 泄漏不可逆，少发能补。
    """
    # ⚠️ 必须**直连主库**读租户属性：`set_tenant_context()` 之后 `db.tenant_list()`
    #   读到的是**租户库自己的影子 `tenants` 表**（生产实测 0 行）⇒ 属性会被静默读成
    #   "没有这个租户"，而且零报错。故用 `tenant_master_all()`。
    rows = db.tenant_master_all()
    if rows is None:
        print(f"[Scheduler] brief tenant={tenant_id} 读主库 tenants 失败 ⇒ 按多租户 fail-closed，本次不外发")
        return 0
    me = None
    for r in rows:
        try:
            if int(r.get("id")) == int(tenant_id):
                me = r
                break
        except (TypeError, ValueError):
            continue

    # 闸门① 演示 / 只读租户不外发（读不到该租户属性同样不外发）
    _ro = str(me.get("readonly") or "0").strip() if me else "1"
    if me is None or _ro != "0" or (me.get("subdomain") or "") == "demo":
        print(f"[Scheduler] brief tenant={tenant_id} 跳过外部推送：演示/只读/未登记租户（多租户保护）")
        return 0

    try:
        import hermes_tenants as ht
        order = list(ht.CHANNEL_ORDER)
        configured = set(ht.enabled_channels(tenant_id))
    except Exception as e:
        print(f"[Scheduler] brief tenant={tenant_id} 读取渠道失败: {e}")
        order, configured = [], set()

    if configured:
        pushed = 0
        for ch in order:
            if ch not in configured:
                continue
            try:
                if ht.send_message(tenant_id, ch, title, content):
                    pushed += 1
            except Exception as e:
                print(f"[Scheduler] brief tenant={tenant_id} push {ch} error: {e}")
        return pushed

    # 闸门② 多租户下禁止回落全局 webhook（全局渠道无租户身份 ⇒ 必然串台）
    if len(rows) > 1:
        print(f"[Scheduler] brief tenant={tenant_id} 未配渠道；本部署登记 {len(rows)} 个租户 ⇒ "
              f"多租户 fail-closed，不回落全局 webhook")
        return 0

    # 单租户部署 → 保留既有回落行为（全局未配置时 push_* 自动 no-op，不报错）
    pushed = 0
    try:
        from feishu_notify import push_to_wecom, push_to_feishu
        if push_to_wecom(title, content):
            pushed += 1
        if push_to_feishu(title, content):
            pushed += 1
    except Exception as e:
        print(f"[Scheduler] brief tenant={tenant_id} wecom/feishu fallback error: {e}")
    return pushed


# ============================================================
# P22-a：库存/效期预警外发 —— 节流包装，复用 _push_tenant_channels 活链
# ============================================================
_ALERT_PUSH_AT = {}   # (tenant_id, title) -> 上次外发时间戳（模块级）

def _push_alert_throttled(tenant_id, title, content, window=86400):
    """预警外发节流：同一租户同一标题 window 秒内只外发一次。返回 1=本次发起外发，0=跳过。

    为什么需要：检测频率是 30 分钟/小时级，而 _push_tenant_channels 无去重 ⇒ 不节流
    会把企微群刷爆。语义对齐 message_send 的 24h 去重窗口（同题一天一条）。
    进程重启后字典丢失 ⇒ 重启后首次检测会补推一次（可接受：站内去重仍在，且外发有
    _push_tenant_channels 的两道 fail-closed 闸门兜底）。
    tenant_id 为 None（不在 per-tenant 上下文）⇒ 不外发（fail-closed）。
    """
    if tenant_id is None:
        return 0
    try:
        now = time.time()
        key = (tenant_id, title)
        last = _ALERT_PUSH_AT.get(key)
        if last is not None and (now - last) < window:
            print(f"[Scheduler] alert throttled tenant={tenant_id} 「{title}」："
                  f"窗口内已外发，剩余 {int(window - (now - last))}s")
            return 0
        _push_tenant_channels(tenant_id, title, content)
        _ALERT_PUSH_AT[key] = now
        return 1
    except Exception as e:
        # scheduler 主循环不能被单个预警搞崩；异常只留痕不外抛
        print(f"[Scheduler] alert push throttled error tenant={tenant_id} 「{title}」: {e}")
        return 0


def _push_copilot_brief_current(tenant_id):
    """在【当前租户上下文】生成并推送简报：站内 + 该租户渠道。返回简报段数（0=无内容）。

    🔴 v352：标题**不再拼租户名**（`tenant_label` 参数随之删掉）。
      租户名是**内部标识**（生产里它一度还是注册种子名「测试企业A」），不该出现在
      客户看到的文案里；拼进标题还会让事件键随租户改名漂移（见 `_BRIEF_EVENT_KEY`）。
      外发渠道也不需要它：闸门② 之后不存在「多个租户共用一条全局渠道」的场景，
      每个租户只走自己 home 的凭证（见 `_push_tenant_channels`）。
    """
    lines = _build_copilot_brief_lines()
    if not lines:
        return 0
    today = datetime.now().strftime("%m月%d日")
    title = f"{today} 经营卡简报"
    content = "\n".join(lines)

    # 站内通知中心（走 get_db，受租户上下文隔离，各租户只看到自己的）
    try:
        db.message_send(title, content, "notice", "经营副驾", event_key=_BRIEF_EVENT_KEY)
    except Exception as e:
        print(f"[Scheduler] brief tenant={tenant_id} in-app send error: {e}")

    _push_tenant_channels(tenant_id, title, content)
    return len(lines)


def _push_copilot_cards_brief():
    """每天 8:05 遍历【全部租户】，逐个在其上下文聚合三卡并推送（单个失败不影响其他租户）。

    多租户商业化前置：第二家客户起也能收到自己的简报，且渠道走各自凭证不串台。fail-closed。
    """
    try:
        from db.connection import set_tenant_context
    except Exception as e:
        print(f"[Scheduler] copilot cards brief tenant context import error: {e}")
        return

    # v352：不再预取租户名（标题不带它了）⇒ 少一次主库读，
    #   也少一条「内部租户名流向用户可见文案」的通路。
    tids = _tenant_ids()
    if not tids:
        return
    for tid in tids:
        try:
            set_tenant_context(tid)
            n = _push_copilot_brief_current(tid)
            if n:
                print(f"[Scheduler] Copilot cards brief tenant={tid}: {n} sections")
        except Exception as e:
            print(f"[Scheduler] Copilot cards brief tenant={tid} error: {e}")
        finally:
            set_tenant_context(None)


# ============================================================
# v242 报单自动化：到点自动建表 / 到点自动关单
# ============================================================
# 数据来源：租户库 rebate_target_rules 中 auto_period_enabled=1 的那一条（后端
#   已有「租户内唯一」约束，故读「唯一那一行」即正确，无歧义）。
# 排程算法：**与预览同一实现** —— domain.arrival_schedule.build_period_plan。
#   刻意不做任何镜像：界面看到的 = 系统要做的（防「预览与现实不符」）。
# 安全：默认关闭 —— 无 auto_period_enabled=1 的租户零副作用；
#   演练期置环境变量 HERGENT_AUTO_PERIOD_DRY_RUN=1 只记日志不写库。
# 幂等：以期次的 (order_start, order_end) 为键，重复 tick 只打日志。
def _auto_period_dry_run():
    """演练开关（部署期临时置 1）。默认 0 = 真执行。"""
    return (os.environ.get("HERGENT_AUTO_PERIOD_DRY_RUN") or "0").strip().lower() in ("1", "true", "yes")


# v365：「该期已标记不到货 ⇒ 不自动建表」的**日志去重**集合（报单日 ISO）。
#   为什么必须有：这条路径**没有任何库内幂等闸**可依赖（不像建表成功后有同窗口行可查），
#   而自动化的相位是「每 5 分钟一轮」⇒ 不记一笔就会在窗口内刷几十条一模一样的日志，
#   真故障会被自己的噪音淹掉。进程重启后重打一次，可接受。
_EXCLUDED_LOGGED = set()


def _auto_period_open(p, dry, close_time="", open_time=""):
    """到点开表。

    🔴 幂等的**两道**闸（缺一不可）：
      ① 同 (order_start, order_end) 已存在 → 跳过；
      ② 本租户**当前有任何 status='open' 的期次** → 跳过。
    为什么必须有 ②（生产实测）：手工建的期次用的是「下单开始=下单截止=报单日」约定，
      而自动建表按「填报窗口」语义写 (报单日前一天 ~ 报单日) —— 两者**不同构**，
      只比日期对**永远比不中**，会建出两个并存的 open 期次；而小程序按
      status='open' 取期次 ⇒ 歧义。故以「同一时间只允许一个 open 期次」为硬闸。

    v304b（2026-09-28）：建表成功后**推「已开放」通知**（本函数以前只有一行 print，
      用户以为的「期次开放提醒」从来没实现过）。通知挂在建表这一刻 = 事件驱动，
      不受 `auto_period` 每 5 分钟相位与固定催单钟点的错位影响。
    """
    os_, oe, arr = p["open_date"], p["close_date"], p["arrival_date"]
    try:
        with db.get_db_tx() as conn:
            hit = conn.execute(
                "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=?",
                (os_, oe)).fetchone()
            if hit:
                return                  # 同窗已存在：静默幂等（每 5 分钟一轮，日志不刷屏）
            op = conn.execute(
                "SELECT id, name FROM forecast_periods WHERE status='open' ORDER BY id LIMIT 1"
            ).fetchone()
        if op:
            # 不静默：这是「自动化被手工期次挡住」，必须看得见（否则表现为“开了不生效”）
            d = dict(op)
            print(f"[Scheduler] auto_period: 跳过开表（已有进行中的期次#{d.get('id')} "
                  f"{d.get('name')}）—— 请先关闭它，自动开表才会继续")
            return
        if dry:
            print(f"[Scheduler] auto_period(DRY): 将创建期次 ({os_}~{oe}, 到货 {arr})")
            return
        pid = db.forecast_period_create(f"{p['order_date']} 报单期次", os_, oe, arr)
        # v273（2026-09-25）：**自动建表也沿用上一期的商品清单** —— 与手工「新建期次」
        #   （routers/forecast.py::create_period）**同一条规则**。用户诉求原话：
        #   「系统自动创建一个期次后……新建期次时应自动带出上一个期次的商品信息」。
        #   🔴 复用 `forecast_period_seed`（v184 唯一实现），不新写复制 SQL。
        #   ⚠️ 沿用失败**绝不阻断建表**：到点没建出期次 = 当轮报单直接断，比「清单没带过来」
        #     严重得多（没带过来还能手动补/导入）。所以这里 catch 后只打日志、继续走。
        _seeded, _note = 0, "无更早期次可沿用"
        _src_used, _src_name, _src_count, _seed_err = 0, "", 0, ""
        try:
            _src_used = db.forecast_period_prev_id(os_, exclude_id=pid)
            if _src_used:
                _sr = db.forecast_period_seed(pid, _src_used)
                _seeded = int(_sr.get("added") or 0)
                _src_name = _sr.get("src_name") or ""
                _src_count = int(_sr.get("src_count") or 0)     # v282：区分「源为空」与「全跳过」
                _note = f"沿用上一期「{_src_name or ('期次#' + str(_src_used))}」{_seeded} 个商品"
        except Exception as _se:
            _seed_err = str(_se)
            _note = f"沿用上一期清单失败（已跳过，期次已建成）— {_se}"
        print(f"[Scheduler] auto_period: 已创建期次#{pid} ({os_}~{oe}, 到货 {arr})，{_note}")
        # v282（2026-09-26）：**这条路以前只有一行 print** —— 自动建表时沿用到空期次，
        #   日志里写「0 个商品」，没有任何人看得到，用户直到打开报单页发现全白才知道。
        #   现在：① 日志打可 grep 的 `[v282][carry-empty]`；② 落站内通知中心；③ 推租户渠道（企微）。
        _carry_warn = ""
        if not _seed_err and _src_used and _seeded == 0:
            from routers.forecast import _carry_empty_warn
            _carry_warn, _carry_log = _carry_empty_warn(_src_used, _src_name, _src_count)
            if _carry_log:
                print(f"[Scheduler][v282][carry-empty] 期次#{pid} {_carry_log}")
        if _carry_warn:
            _alert_carry_empty(pid, os_, oe, _carry_warn)
        # v304b：建表成功 ⇒ 立刻推「已开放」（事件驱动）。放在最后 = 先保证期次与
        #   商品清单都已落库，用户收到通知点进去就是可用的报单页。
        #   ⚠️ **独立兜底**：通知出问题绝不能落到外层 except —— 那会打「建表失败」，
        #   而期次其实已经建好了。假信号比没信号更坏（排查时会被带偏一整轮）。
        # v305：面板「新期次发布时通知」节点可关 —— 关了就不发。
        #   ⚠️ 必须**留痕**：否则「用户自己关的」与「通知发送失败」在日志里长得一模一样。
        if not bool((_forecast_reminder_cfg().get("nodes") or {}).get("new_period", True)):
            print("[Scheduler][v305] 面板已关闭「新期次发布时通知」⇒ 期次#%s 不发开放通知" % pid)
        else:
            try:
                _notify_period_opened(pid, os_, oe, close_time=close_time,
                                      arrival=arr, open_time=open_time)
            except Exception as _ne:
                print(f"[Scheduler][v304b] 期次#{pid} 开放通知失败（**期次已建成**，不影响报单）: {_ne}")
    except Exception as e:
        print(f"[Scheduler] auto_period: 建表失败 ({os_}~{oe}) — {e}")


def _alert_carry_empty(period_id, os_, oe, detail):
    """v282：把「沿用上一期得到 0 个商品」推到**用户看得见的地方**。

    三层一起做（任一失效都不至于静默）：
      · 站内通知中心（`message_center`，tenant 上下文隔离；带稳定 `event_key` ⇒
        24h 内同一事件只留一行并累加 `dup_count`，不会每次 tick 刷屏）
      · 租户自己的渠道（企微/飞书/钉钉 —— `_push_tenant_channels` 复用既有出站，
        未配渠道的租户会自动回落全局 webhook，全程 fail-closed）
      · 上面已打的 `[v282][carry-empty]` 日志（可 grep / 可做监控规则）

    🔴 已核实这条路径**不会重复触发**：`_auto_period_open` 开头有「同窗口已存在期次 ⇒ return」
    的幂等闸，所以一个期次最多告警一次，不依赖去重兜底。
    """
    title = "本期报单商品清单是空的"
    content = ("期次#%d（%s ~ %s）是自动建的，它沿用了上一期 —— 但上一期自己就没有商品清单，"
               "所以这一期也是空的。\n\n%s\n\n"
               "⚠️ 不处理的话：小程序报单页会完全空白，而且**下一期会继续沿用这个空清单**。"
               % (int(period_id), os_, oe, detail))
    try:
        from db.connection import get_tenant_context
        tid = get_tenant_context()
    except Exception as e:
        tid = None
        print(f"[Scheduler][v282] 读租户上下文失败: {e}")
    try:
        db.message_send(title, content, "notice", "系统", event_key="forecast_carry_empty")
    except Exception as e:
        print(f"[Scheduler][v282] carry-empty 站内通知失败: {e}")
    if tid:
        # 🔴 v366：本路径**刻意不读** `channels.wecom`（与 `_notify_period_opened` 不同，别当 bug 修）。
        #   理由：这是**系统异常告警**（自动建出的期次商品清单为空 ⇒ 小程序报单页会全白），
        #   不是"报单提醒"。用户关掉提醒渠道的意图是"少打扰"，不是"系统坏了也别告诉我"；
        #   把故障告警混进提醒开关，等于给"静默失效"多开一条合法通道。
        #   ⇒ 若要动它，先回答：用户关掉开关时，是否真愿意连"清单空了"也不知道？
        #   （对照：同在报单提醒域的 `_notify_period_opened` 已按 v366 遵守该开关。）
        try:
            _push_tenant_channels(tid, title, content)
        except Exception as e:
            print(f"[Scheduler][v282] carry-empty 渠道推送失败: {e}")


# ============================================================
# v304b（2026-09-28）：报单「开放通知」—— **事件驱动**，不靠固定钟点代劳
# ============================================================
# 🔴 为什么必须新增（生产实测）：`_auto_period_open` 建出期次后**只打了一行 print**，
#   全程零推送 ⇒ 用户以为的「期次开放时提醒」**从来没有实现过**（详见 memory 2026-09-28）。
#
# 🔴 为什么不能靠 9:00 / 16:00 那两轮固定催单代劳（两条独立原因，都会真出问题）：
#   ① **相位错位**：`auto_period` 是**每 5 分钟**一轮、相位由**进程启动时刻**决定
#      （本机实测落在 :58:59 与 :03:59 各一轮），而 `forecast_reminder` 在 16:00 的
#      **第一分钟内**就跑 ⇒ 5 次里有 4 次跑在期次被建出来之前 ⇒ 开放通知丢。
#   ② **措辞反成误导**：16:00 那轮若真的看到刚建的期次，「还有 N 个单元未报」
#      必然等于「全部单元」，老板会读成「大家都拖着不报」——而事实是「刚开 0 分钟」。
# ⇒ 正解：开放通知挂在**建表成功这一刻**，并让紧随其后的固定轮**主动让位**。
PERIOD_OPEN_NOTICE_MINUTES = 30   # 建表后多久内视为「刚开放」⇒ 固定轮让位


def _period_opened_recently(minutes=PERIOD_OPEN_NOTICE_MINUTES):
    """本租户最近是否刚建出过期次（**查库**判据，跨进程重启仍然有效）。

    判据 = `forecast_periods.created_at`（`datetime('now','localtime')`，与本地时区同源）
           落在最近 N 分钟内。

    ⚠️ **fail-open**：任何异常 / 缺表 ⇒ 返回 False ⇒ 固定轮照常催单。
       绝不因为「读不到」而让用户丢提醒（这是本项目栽过多次的方向）。
    """
    try:
        with db.get_db() as c:
            if not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                             "AND name='forecast_periods'").fetchone():
                return False
            row = c.execute(
                "SELECT COUNT(*) FROM forecast_periods "
                "WHERE created_at IS NOT NULL AND created_at != '' "
                "AND created_at >= datetime('now','localtime',?)",
                ("-%d minutes" % int(minutes),)).fetchone()
        return bool(row and int(row[0] or 0) > 0)
    except Exception as e:
        print(f"[Scheduler] period opened-recently 探测失败（按未刚开放处理）: {e}")
        return False


def _notify_period_opened(period_id, os_, oe, close_time="", arrival="", open_time=""):
    """报单「已开放」通知（v304b）—— 唯一职责：期次刚被建出来时，让人知道。

    三层一起做（与 v282 的 `_alert_carry_empty` 同构，任一失效都不至于静默）：
      · 站内通知中心 —— 带**按期次稳定**的 `event_key`（供前端按类静音 / 追溯）。
        ⚠️ 落库去重走 `message_send` 的**既有**口径：按 `(title, msg_type, recipients)`
           在 `MESSAGE_DEDUP_WINDOW`(86400s) 内且**未读**时收敛成一行、累加 `dup_count`
           —— **不是**按 `event_key` 去重。⇒ 若两期开放间隔 < 24h 且上一条未读，
           两条会并成一条（这是 v166 的**收敛设计**，非缺陷；正文会更新成最新一期）。
           tenant_1 实际节奏为 **48h 一轮** ⇒ 不会触发。
        📌 受众由**受众规则表**唯一决定（`db/queries/finance.py::_AUDIENCE_PREFIX_RAW`
           的 `forecast_period_open_`）—— 本处**刻意不抄角色名单**：抄一份就多一处
           漂移点（v773 补 `guide` 时这里就曾写着旧的六角色名单）。
           v773 起 `guide`（导购）也在内 ⇒ 小程序那边的报单人都收得到。
      · 租户自己的渠道（企微/飞书/钉钉）—— 复用既有 `_push_tenant_channels`，fail-closed
      · 调用方已打的日志（可 grep / 可做监控规则）

    🔴 v366（2026-10-02）两处修正，都来自用户实测报障：

      ① **本函数此前不读面板的渠道开关** —— 同族的 `push_forecast_reminder_current`
         与 `push_forecast_summary` 都读 `channels.wecom`，**只有它不读** ⇒ 表现为
         「面板里企业微信明明是关的，开放通知照样推企微」（用户 2026-10-02 原话：
         「我今天在企微收到期次开通通知」，而他的面板 `wecom=false`）。
         ⇒ 现在站内信受 `channels.inapp`、企微受 `channels.wecom`，**两侧关闭都留痕**
         （关掉与发送失败在日志里必须可区分 —— R8）。
         ⚠️ **行为变更提示**：tenant_1 现存配置 `wecom=false` ⇒ 改后开放通知**不再推企微**；
            想继续在企微收到，须到面板「报单配置 → 报单提醒设置」把「企业微信」勾上。

      ② **「报单窗口」那行只印日期**（`2026-10-02 ~ 2026-10-03`），而真实窗口是
         「开放日 16:00 ~ 关单日 21:00」（`auto_open_time`/`auto_close_time` 与关单同源、
         早已存在）⇒ 用户读起来"不精确"，而配置其实一直是时分级。
         ⇒ 窗口行改为印到分，并把原「关单时刻」**单独一行合并掉**
         （同一数字不印两遍；关单时刻 = 窗口终点，末尾一句点明"到期自动关单"保住行动语义）。

    ⚠️ 绝不让通知失败影响建表主流程（本函数与调用方都兜底）。
    """
    try:
        from db.connection import get_tenant_context
        tid = get_tenant_context()
    except Exception as e:
        tid = None
        print(f"[Scheduler][v304b] 读租户上下文失败: {e}")

    _ch = (_forecast_reminder_cfg().get("channels") or {})
    _inapp = bool(_ch.get("inapp", True))
    _wecom = bool(_ch.get("wecom", False))

    title = "本期报单已开放"
    # v366：窗口含时分；拿不到时刻时自动退化为纯日期（不印空串）
    _win_s = ("%s %s" % (os_, open_time)) if open_time else str(os_ or "")
    _win_e = ("%s %s" % (oe, close_time)) if close_time else str(oe or "")
    content = ("本期报单已开放，请各销售开始报单。\n"
               "报单窗口：%s ~ %s\n"
               "到货日：%s\n"
               "请在窗口结束前完成报单，到期系统会自动关单。"
               % (_win_s, _win_e, arrival or "见期次"))

    if _inapp:
        try:
            db.message_send(title, content, "notice", "系统",
                            event_key="forecast_period_open_%s" % int(period_id))
        except Exception as e:
            print(f"[Scheduler][v304b] 期次#{period_id} 开放通知·站内失败: {e}")
    else:
        print(f"[Scheduler][v366] 面板已关闭「站内信」⇒ 期次#{int(period_id)} 开放通知不落通知中心")
    pushed = 0
    if tid and _wecom:
        try:
            pushed = _push_tenant_channels(tid, title, content)
        except Exception as e:
            print(f"[Scheduler][v304b] 期次#{period_id} 开放通知·渠道失败: {e}")
    elif not _wecom:
        print(f"[Scheduler][v366] 面板已关闭「企业微信」⇒ 期次#{int(period_id)} 开放通知不出站"
              f"（站内=%s）" % ("已发" if _inapp else "已关"))
    # 🔴 成功也要留痕（R8）：否则「发了但没人收到」与「压根没发」在日志里一模一样，
    #    下次再出问题又得从通道那头重查一遍。`pushed=0` 是明确信号：站内有、渠道没出去。
    print(f"[Scheduler][v304b] 期次#{int(period_id)} 开放通知已发"
          f"（站内信 %s；租户渠道 pushed=%d）" % ("ok" if _inapp else "off", pushed))


def _auto_period_close(p, dry, close_time=""):
    """到点关单：只关 status='open' 且**日期与本报告日匹配**的期次。

    匹配用 `order_start = 报单日 OR order_end = 报单日`，**一条句同时兼容两种约定**：
      · 手工建的 (D, D)          → order_start = D ✓
      · 自动建的 (D-1, D)        → order_end   = D ✓
    故不会去关一个无关的旧期次。

    🔴 v319（2026-09-29）新增「人工已接管 ⇒ 不碰」豁免：`AND COALESCE(reopened_at,'')=''`。
    病根（生产实测，用户报障牵连出来的）：本函数的调用方 `_check_auto_period` 的分支是
      `elif now_str >= ca` —— **一旦过了关单时刻就每一轮都跑**（每 5 分钟一轮）。
      而它只查「status='open' 且日期匹配」，**没有"人工重开过就别管"的概念** ⇒
      人工重开会在 2~5 分钟内被无条件撤销。生产日志实证（2026-09-27 期次 #19）：
          20:04:53  period_reopen        ← 人工重开
          20:07:31  auto_period: 已关闭期次#19   ← 2分38秒后被自动化撤销
          20:12:25  period_reopen        ← 人工再次重开
          20:17:34  auto_period: 已关闭期次#19   ← 5分09秒后又撤销
      而「重开」是 v219 定义的**唯一**补救路径 ⇒ 自动化开着时这条路径**实质失效**，
      且界面上不会告诉你为什么又变回去了（用户只会认为"系统坏了"）。
      ⇒ 豁免语义 = 「人已经把这期拿回来处理过，自动路径别插手」（`reopened_at` 见 v319 迁移注释）。

    🔴 关闭时落 `closed_by='系统'` / `closed_mode='auto'` 留痕（v319）：
      此前自动关单**零留痕** —— `forecast_config['audit:<pid>']` 里没有 period_close
      （本函数直调 db 层、不经端点 ⇒ 端点上的 `_audit_period_op` 全被绕过），
      `forecast_periods` 又没有关闭时间列 ⇒「#21 是谁在何时关的」只能翻 journalctl，
      日志一滚答案永久丢失。现在数据库里查得到，且 `closed_mode` 让界面能区分
      「人点的定稿」与「系统到点关的」（两者的通知行为不同，见 `alloc_pushed_at`）。
    """
    os_, oe, od = p["open_date"], p["close_date"], p["order_date"]
    try:
        with db.get_db_tx() as conn:
            row = conn.execute(
                "SELECT id, status FROM forecast_periods WHERE status='open' "
                "AND (order_start=? OR order_end=?) "
                "AND COALESCE(reopened_at,'')='' "
                "ORDER BY id LIMIT 1",
                (od, od)).fetchone()
        if not row:
            return                      # 无匹配的 open 期次，或已被人工接管（v319 豁免）：不动
        r = dict(row)
        if dry:
            print(f"[Scheduler] auto_period(DRY): 将关闭期次#{r.get('id')} (报单日 {od})")
            return
        db.forecast_period_close(r.get("id"), by="系统", mode="auto")
        print(f"[Scheduler] auto_period: 已关闭期次#{r.get('id')} (报单日 {od}) [auto]")
    except Exception as e:
        print(f"[Scheduler] auto_period: 关单失败 (报单日 {od}) — {e}")


# ============================================================
# v354（2026-10-01）：僵尸 open 期次回收 —— 防「自动建表被永久挡住」
# ============================================================
# 🔴 病根（生产实测，用户报障「10月1日这单没有自动创建」）：
#   ① 用户对**已关闭**的期次点「恢复报单」（`forecast_period_reopen(mode='full')`）
#      ⇒ `status='open'` **并且**种下 `reopened_at`；
#   ② `reopened_at` 是**自动关单的豁免键**（v319）⇒ `_auto_period_close` 再也不碰它；
#   ③ 更狠的一层：`_check_auto_period` 只遍历 `build_period_plan` 里 `>= today` 的报单日
#      ⇒ 该期次过了自己那天就**掉出编排**，连"想关"的触发机会都没有 ⇒ **永久 open**；
#   ④ 于是 `_auto_period_open` 的硬闸「本租户已有任何 `status='open'` 的期次 ⇒ 跳过」
#      被永久踩住 ⇒ **此后每一期的自动建表全部静默跳过**。
#   生产实证：2026-09-30 16:04 ～ 10-01 15:32 连续打出数百行
#      「auto_period: 跳过开表（已有进行中的期次#21 2026-09-29 报单期次）」，
#      而**界面上零提示** —— 用户直到打开报单页发现是空的才知道。
#
# 🔴 与 v319「人工接管豁免」的边界（必须讲清，否则会被读成"擅自撤销人工操作"）：
#   豁免**在报单窗口内有效** —— 人重开是为了继续报单/改数，自动路径确实不该插手；
#   **窗口过后豁免失效** —— 那一期已不可写（`forecast_period_writable` 判
#   `order_end < 今天` ⇒ False），留着 open 不再有任何业务价值，只会锁死后续自动化。
#   ⇒ 这不是"撤销人工操作"，是"清理一个已经失效的状态"。
#
# 安全性（逐条）：
#   · **只改 `status`** —— 报单数据 / 导入名册 / 商品清单一个字都不动；
#   · 只作用于**已开启自动建表**的租户（在 `carrier` 判完之后才调用）⇒ 手工管期的租户零影响；
#   · `order_end` 缺失或格式不足 10 位的**不动**（宁可漏收，不可误收）；
#   · 幂等：回收后本租户不再有僵尸 ⇒ 后续每一轮零行为（不刷屏、不重复通知）。
def _alert_stale_reaped(pid, name, order_end):
    """v354：把「自动建表曾被一个没关的期次挡住、现已自动恢复」告诉用户。

    为什么必须留痕（而不是只打日志）：本轮的原始故障就是**界面零提示** ——
    期次连着两天没建出来，用户完全不知道，只能靠"发现报单页是空的"来察觉。
    留一条站内信，用户至少能在通知中心看到「发生过什么、为什么、下次怎么避免」。
    """
    title = "自动建表已自动恢复（有一个旧期次挡了它）"
    content = (
        "期次#%d（%s）的报单日 %s 已经过去，但它一直停在「进行中」状态，"
        "把自动建表挡住了 —— 所以这期间本该自动建的新期次一直没有建出来。\n\n"
        "系统已自动把它关闭，自动建表会在 5 分钟内继续。\n\n"
        "⚠️ 什么情况下期次不会自己关掉：你在界面上对**已关闭**的期次点过「恢复报单」。"
        "那一期处理完之后记得顺手关掉它，否则它会再次挡住自动建表。"
        % (int(pid), name or "", order_end or "")
    )
    try:
        db.message_send(title, content, "notice", "系统",
                        event_key="forecast_stale_period_reaped_%s" % int(pid))
    except Exception as e:
        print(f"[Scheduler][v354] 僵尸回收通知失败: {e}")


def _reap_stale_open_periods(now_str, dry):
    """回收「僵尸 open 期次」—— 报单窗口已过却仍是 open 的期次。返回回收条数。

    判据（与 `forecast_period_writable` **同源**，别另写一套日期逻辑）：
      `order_end < 今天` ⇒ 报单窗口已彻底过去 ⇒ 该期次早已不可写。
    """
    today = (now_str or "")[:10]
    if not today:
        return 0
    try:
        with db.get_db_tx() as conn:
            rows = conn.execute(
                "SELECT id, name, order_end FROM forecast_periods "
                "WHERE status='open' "
                "AND length(COALESCE(order_end,'')) >= 10 "
                "AND substr(order_end,1,10) < ? "
                "ORDER BY id", (today,)).fetchall()
    except Exception as e:
        print(f"[Scheduler][v354] 僵尸期次扫描失败（本轮不回收）: {e}")
        return 0
    n = 0
    for r in rows:
        d = dict(r)
        pid = d.get("id")
        if dry:
            print(f"[Scheduler][v354](DRY) 将回收僵尸期次#{pid}"
                  f"（报单截止 {d.get('order_end')} 已过）")
            n += 1
            continue
        try:
            # v355：留痕用 `auto_reap`（**不是** `auto`）—— 两者都无人操作、`closed_by`
            #   都是「系统」，**只有 mode 分得清**「到点正常关的」与「过期被回收的」。
            #   界面据此解释这一期（「系统自动回收（已过截止日）」vs「系统到点自动关单」）。
            if db.forecast_period_close(pid, by="系统", mode="auto_reap"):
                n += 1
                print(f"[Scheduler][v354] 已回收僵尸期次#{pid} {d.get('name')}"
                      f"（报单截止 {d.get('order_end')} 已过，仍是 open ⇒ 挡住自动建表）")
                _alert_stale_reaped(pid, d.get("name"), d.get("order_end"))
        except Exception as e:
            print(f"[Scheduler][v354] 回收期次#{pid}失败: {e}")
    return n


def _check_auto_period():
    """当前租户上下文下跑一轮报单自动化（建表 + 关单）。幂等、fail-closed。"""
    from domain.arrival_schedule import build_period_plan
    dry = _auto_period_dry_run()
    # 口径与预览一致：用本地时刻字符串比较（open_at/close_at 形如 "YYYY-MM-DD HH:MM"）
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    with db.get_db_tx() as conn:
        rows = conn.execute(
            "SELECT * FROM rebate_target_rules WHERE is_active=1 AND dimension='brand'").fetchall()
        # v365：本租户各品牌「不到货」的停单日（唯一读取口，与两处预览共用）。
        #   全量读 —— 表只有 (规则 × 月份) 量级；排除判定是「期次到货日 == 停单日」的
        #   等值比较，多读几行绝不会误伤，反而能避免「窗口算小了 ⇒ 静默漏排除」。
        #   表不存在（老租户库）⇒ {}，本函数行为与 v364 之前完全一致。
        _skips = db.rebate_arrival_skip_map(conn)
    rules = [dict(r) for r in rows]
    carrier = None
    for r in rules:
        if int(r.get("auto_period_enabled") or 0) == 1:
            carrier = r
            break
    if not carrier:
        return                          # 未开启 ⇒ 零行为（本函数最常见的返回）
    if not (carrier.get("order_first_date") or "").strip():
        print("[Scheduler] auto_period: 已开启但缺「首次报单日」，本轮跳过")
        return
    # 🆕 v354（2026-10-01）：先把「报单窗口已过却仍 open」的僵尸期次回收掉。
    #   放在 carrier 判**之后**是刻意的：没开自动化的租户一个字节都不写
    #   （手工管期的租户可能就想让某一期长期开着，系统不该多事）。
    #   放在建表**之前**是必须的：第 ② 道硬闸是「本租户已有任何 open 期次 ⇒ 跳过」，
    #   不先清掉僵尸的话，下面这一轮的建表照样会被挡回去。
    _reap_stale_open_periods(now_str, dry)
    ot = (carrier.get("auto_open_time") or "20:00").strip() or "20:00"
    ct = (carrier.get("auto_close_time") or "10:00").strip() or "10:00"
    st = (carrier.get("supplier_deadline_time") or "12:00").strip() or "12:00"
    carrier_name = carrier.get("scope_name") or carrier.get("rule_name") or ""
    # 参与编排的规则集：与 /auto-period-preview 同构（全部有节奏的品牌 + 基准品牌兜底）
    plan_rules = [{**r, "name": r.get("scope_name") or r.get("rule_name") or ""}
                  for r in rules if (r.get("order_first_date") or "").strip()]
    if not any(x["name"] == carrier_name for x in plan_rules):
        plan_rules.append({**carrier, "name": carrier_name})
    if not plan_rules:
        return
    try:
        plan = build_period_plan(plan_rules, horizon_days=14,
                                 open_time=ot, close_time=ct, supplier_time=st,
                                 skips_by_rule=_skips)      # v365
    except Exception as e:
        print(f"[Scheduler] auto_period: 排程失败 — {e}")
        return
    for p in (plan.get("periods") or []):
        oa, ca, od = p.get("open_at"), p.get("close_at"), p.get("order_date")
        if not oa or not ca or not od:
            continue
        # v365：这一期的到货日已被标记「不到货」⇒ **不自动建表**（用户点「10/5 不到货」
        #   的诉求）。放在最前面：被排除的期次既不该建、也没有可关的东西。
        #   🔴 不留 open 期次 ⇒ 不会碰到「同一时间只能有一个 open 期次」那道硬闸，
        #      也不会重犯 v354/v355 的自动化死锁。
        #   🔴 日志只在该期的填报窗口内打、且**每期只打一次** —— 否则每 5 分钟刷一条，
        #      真故障会被自己的噪音淹掉。
        if p.get("excluded"):
            if oa <= now_str < ca and od not in _EXCLUDED_LOGGED:
                _EXCLUDED_LOGGED.add(od)
                print(f"[Scheduler][v365] auto_period: 期次（报单日 {od} / 到货 "
                      f"{p.get('arrival_date')}）已标记「不到货」⇒ 不自动建表 —— "
                      f"{p.get('exclude_reason')}")
            continue
        if oa <= now_str < ca:
            # 到点开表（v304b：关单时刻随开放通知一起告知；v366：开放时刻一并传，
            #   使「报单窗口」那行能印到分，而不是只印日期）
            _auto_period_open(p, dry, close_time=ct, open_time=ot)
        elif now_str >= ca:
            _auto_period_close(p, dry)      # 到点关单


# ============================================================
# P0-3: 预报定时催单（应报单元 vs 已报单元 → 推送未报者）
# ============================================================
def _tenant_ids():
    """返回**该跑定时任务**的租户 id 列表（升序、去重）。

    v206 (2026-09-19)：判据**下沉到 `erp_db.scan_tenant_dbs()`**（唯一权威实现），
    本函数只做「传参 + 兜底」。原实现是 `glob(tenant_*.db)` —— **只看文件名**，
    于是 0 字节空壳文件被当成真租户，每个 tick 都去写一次 ⇒ 生产实测
    `attempt to write a readonly database` 1268 条且永远自愈不了（详见 erp_db 里那段事故注释）。

    保留的两条实测教训（现已由 erp_db 侧实现）：
    1. 必须 fullmatch 严格匹配——早期用 str.replace('tenant_','') 会把异常命名的
       'tenant_tenant_1.db' 误解析成 id=1，导致该租户被处理两次（简报重复推送）。
    2. 排除 id<=0——tenant_0.db 非真实租户，且 set_tenant_context(0) 会被当作无租户
       而回落【主库】，导致业务 monitor 在主库上误执行（数据污染风险）。

    `registered_only=True`：定时任务是**对外动作**（推催单/简报给客户），只能作用于
    「主库 tenants 登记表里真实存在且启用」的租户。登记表读不出来时由 erp_db 侧
    fail-safe 退回纯结构校验（不静默丢全部租户）。
    """
    try:
        return db.list_tenant_db_ids(registered_only=True)
    except Exception as e:
        print(f"[Scheduler] 权威租户枚举失败（{e}），退回纯结构校验")
    try:
        return db.list_tenant_db_ids(registered_only=False)
    except Exception as e:
        print(f"[Scheduler] 租户枚举彻底失败，本次 tick 不处理任何租户: {e}")
        return []


def _check_ai_reminders():
    """每分钟扫描各租户「到点的 AI 提醒」（ai_reminders 表），推送站内通知 + 渠道，
    并推进状态。repeat_rule 支持 daily/weekly/monthly（空 = 一次性）。fail-closed。
    """
    try:
        from db.connection import set_tenant_context
    except Exception as e:
        print(f"[Scheduler] ai reminders tenant context import error: {e}")
        return

    tids = _tenant_ids()
    if not tids:
        return
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    for tid in tids:
        try:
            set_tenant_context(tid)
            with db.get_db() as c:
                c.execute(
                    "CREATE TABLE IF NOT EXISTS ai_reminders ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,"
                    "remind_at TEXT DEFAULT '', repeat_rule TEXT DEFAULT '',"
                    "status TEXT DEFAULT 'open', created_by TEXT DEFAULT '',"
                    "created_at TEXT DEFAULT (datetime('now','localtime')), done_at TEXT)"
                )
                rows = c.execute(
                    "SELECT * FROM ai_reminders WHERE status='open' AND remind_at != '' "
                    "AND remind_at <= ? ORDER BY remind_at ASC",
                    (now_str,),
                ).fetchall()
            for r in rows:
                rid, title = r["id"], r["title"]
                repeat = (r["repeat_rule"] or "").strip()
                try:
                    db.message_send("AI 提醒", f"⏰ {title}", "notice", "经营副驾")
                except Exception as e:
                    print(f"[Scheduler] reminder {rid} in-app send error: {e}")
                try:
                    _push_tenant_channels(tid, "AI 提醒", title)
                except Exception as e:
                    print(f"[Scheduler] reminder {rid} channel push error: {e}")
                with db.get_db_tx() as c2:
                    _advance_reminder(c2, rid, repeat, now_str)
        except Exception as e:
            print(f"[Scheduler] ai reminders tenant={tid} error: {e}")
        finally:
            set_tenant_context(None)


def _advance_reminder(c, rid, repeat, now_str):
    """到点后推进提醒：daily/weekly/monthly 顺延，否则标记 done。"""
    try:
        cur = datetime.strptime(now_str, "%Y-%m-%d %H:%M")
    except Exception:
        cur = datetime.now()
    nxt = None
    if repeat == "daily":
        nxt = cur + timedelta(days=1)
    elif repeat == "weekly":
        nxt = cur + timedelta(days=7)
    elif repeat == "monthly":
        y, m = cur.year, cur.month + 1
        if m > 12:
            m, y = 1, y + 1
        nxt = cur.replace(year=y, month=m)
    if nxt:
        c.execute("UPDATE ai_reminders SET remind_at=? WHERE id=?",
                  (nxt.strftime("%Y-%m-%d %H:%M"), rid))
    else:
        c.execute("UPDATE ai_reminders SET status='done', done_at=? WHERE id=?",
                  (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), rid))


def _forecast_reminder_state():
    """催单状态（当前租户上下文）：当前报单周期 + 应报/已报/未报单元。
    返回 dict 或 None（无开放周期 / 无候选单元 → 不催）。
    应报名单默认口径：近30天非『导入』报单过的单元（store_name 去重）——自动跟随历史习惯，无需配置。
    注：role='导入'（Excel 导入）不参与应报/已报统计，避免把文员导入的数据当员工报单。
    """
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        with db.get_db() as c:
            db._ensure_forecast_tables(c)
            c.commit()
            per = c.execute(
                "SELECT * FROM forecast_periods WHERE status='open' AND order_end>=? ORDER BY id DESC LIMIT 1",
                (today,),
            ).fetchone()
            if not per:
                return None
            p = dict(per)
            cand = [r[0] for r in c.execute(
                "SELECT DISTINCT store_name FROM forecast_submissions "
                "WHERE role!='导入' AND store_name!='' AND order_date >= date('now','localtime','-30 days')"
            ).fetchall()]
            if not cand:
                return None
            os_, oe = (p.get("order_start") or today), (p.get("order_end") or today)
            # 2026-09-15：与 /summary、报单幂等的期次口径对齐 ——
            # 「已报 / 汇总」按 period_id 精确归属；period_id=0 的历史行回退 order_date 窗口。
            # 原口径纯按 order_date BETWEEN：期次窗口重叠时，同一笔报单会同时算进相邻两期
            # （「已报」被放大、未报名单偏短，催单该催的没催到）。
            _pid = int(p.get("id") or 0)
            _attr = "(period_id=? OR (period_id=0 AND order_date BETWEEN ? AND ?))"
            reported = [r[0] for r in c.execute(
                f"SELECT DISTINCT store_name FROM forecast_submissions "
                f"WHERE role!='导入' AND store_name!='' AND {_attr}",
                (_pid, os_, oe),
            ).fetchall()]
            tot = c.execute(
                f"SELECT COUNT(DISTINCT store_name) AS units, COALESCE(SUM(total_qty),0) AS qty, COALESCE(SUM(total_amount),0) AS amount "
                f"FROM forecast_submissions WHERE role!='导入' AND {_attr}",
                (_pid, os_, oe),
            ).fetchone()
    except Exception as e:
        print(f"[Scheduler] forecast reminder state error: {e}")
        return None
    missing = [x for x in cand if x not in set(reported)]
    return {"period": p, "candidates": cand, "reported": reported, "missing": missing,
            "totals": dict(tot) if tot else {"units": 0, "qty": 0, "amount": 0}}


def _forecast_store_owner_map():
    """store_name（汇总表列名 = report_alias 优先，否则 system_name）→ 负责员工 id。

    用于把「催单」从广播改为**按负责销售定向**。fail-safe：缺表 / 异常 / 无绑定
    一律返回空 dict，绝不因为取不到归属就把催单主流程带崩。"""
    out = {}
    try:
        with db.get_db() as c:
            if not c.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='report_mapping'"
            ).fetchone():
                return out
            rows = c.execute(
                "SELECT report_alias, system_name, employee_id FROM report_mapping WHERE is_active=1"
            ).fetchall()
        for r in rows:
            r = dict(r)
            eid = int(r.get("employee_id") or 0)
            if eid <= 0:
                continue
            key = (r.get("report_alias") or "").strip() or (r.get("system_name") or "").strip()
            if key:
                out[key] = eid
    except Exception as e:
        print(f"[Scheduler] forecast store owner map error: {e}")
    return out


def forecast_pending_summary(my_employee_id=0):
    """给前端「本期还差谁没报」用的精简结构（v304 · 小程序首页提醒条）。

    🔴 **口径不另写一份** —— 直接复用 `_forecast_reminder_state()`。
       页面上显示的「还差几个」与催单催的「还差谁」必须同源，否则会出现
       「页面说都报完了、催单还在催」这种自相矛盾（本项目反复栽的同一类坑）。

    ⚠️ 只读：本函数自身不写库（`_forecast_reminder_state` 内部会幂等建表）。
    ⚠️ 不返回**全部**门店名：业务员不该看到别家门店。全局只回计数，
       `my_missing` 只含**他负责的**（按 `report_mapping.employee_id` 绑定）。
    """
    out = {"has_period": False, "period": None,
           "units_total": 0, "units_reported": 0, "units_missing": 0,
           "my_missing": [], "owner_bound": False}
    st = _forecast_reminder_state()
    if not st:
        return out
    p = st.get("period") or {}
    out["has_period"] = True
    out["period"] = {"id": p.get("id"), "name": p.get("name"),
                     "order_start": p.get("order_start"),
                     "order_end": p.get("order_end"),
                     "arrival_date": p.get("arrival_date")}
    out["units_total"] = len(st.get("candidates") or [])
    out["units_reported"] = len(st.get("reported") or [])
    out["units_missing"] = len(st.get("missing") or [])
    try:
        me = int(my_employee_id or 0)
        if me > 0:
            owner = _forecast_store_owner_map()
            out["owner_bound"] = True
            out["my_missing"] = [s for s in (st.get("missing") or [])
                                 if owner.get(s) == me]
    except Exception as e:
        print(f"[Scheduler] forecast pending summary owner error: {e}")
    return out


# ============================================================
# v305（2026-09-28）：报单提醒 **配置驱动**（用户拍板的 B/C 方案）
# ============================================================
# 🔴 为什么必须加这一层：`ReminderConfig.vue` 面板有 **7 组设置 / 四个节点**，而
#    · 后端 `_normalize_reminder` **连 `per_sales` 都没存**（`dict(REMINDER_DEFAULT)` 带出 True，
#      用户传的 false 被静默丢弃 ⇒ 面板上那个开关是个**假开关**）；
#    · 调度器**一个字都不看这份配置**，催报时刻硬编码 9 点 / 16 点。
#    用户原话（2026-09-28）：「面板上的设置点了没反应」。本层把面板接到**真实行为**上。
# 四个节点 = new_period（已开放）/ lead（截止前）/ final（最后时刻）/ summary（截止后汇总）。
_REMINDER_CFG_DEFAULT = {
    "enabled": True,
    "lead_hours": 3,
    "final_hours": 1,
    "deadline_time": "18:00",
    "per_sales": True,
    "channels": {"inapp": True, "wecom": True},
    "quiet": {"start": "22:00", "end": "08:00"},
    "nodes": {"new_period": True, "lead": True, "final": True, "summary": False},
}


def _forecast_reminder_cfg():
    """读**当前租户**的「报单提醒」配置。读不到一律回落内置默认（**fail-open**）。

    ⚠️ fail-open 是刻意的：配置读不到时**照常提醒**，比「静默不提醒」安全 ——
       提醒的本职是"别让销售漏报"，宁可多提醒一次，也不能因为一次读库异常就全公司不催。
       （与「通知失败绝不阻断主流程」同一取向。）
    ⚠️ 缺表 / 缺行 / JSON 坏 / 字段类型不对，全部走同一兜底，**绝不抛异常**。
    ⚠️ 默认值必须与 `routers/forecast_config.py::REMINDER_DEFAULT` **一致** ——
       两处不一致就会出现「后端没配时调度器用 A 口径、面板显示 B 口径」。本函数只做
       读 + 类型兜底，**不重复实现归一化规则**（归一化仍以 `_normalize_reminder` 为权威）。
    """
    cfg = {k: (dict(v) if isinstance(v, dict) else v)
           for k, v in _REMINDER_CFG_DEFAULT.items()}
    try:
        with db.get_db() as c:
            row = c.execute(
                "SELECT payload FROM forecast_config WHERE kind='reminder'").fetchone()
        if not row:
            return cfg
        raw = json.loads(row["payload"]) or {}
        if not isinstance(raw, dict):
            return cfg
        for k in ("enabled", "per_sales"):
            if k in raw:
                cfg[k] = bool(raw[k])
        for k in ("lead_hours", "final_hours"):
            try:
                if raw.get(k) is not None:
                    cfg[k] = int(raw[k])
            except (TypeError, ValueError):
                pass
        if isinstance(raw.get("deadline_time"), str) and raw["deadline_time"].strip():
            cfg["deadline_time"] = raw["deadline_time"].strip()
        for k in ("channels", "quiet", "nodes"):
            if isinstance(raw.get(k), dict):
                cfg[k].update(raw[k])
        # 🔴 v305：这里**刻意不做** final/lead 的 clamp —— 本函数只负责"把用户存的值读出来"。
        #   为什么不在读的时候压：① 压过之后调度层就再也看不出"用户其实把两个提前量配重了"；
        #   ② `_normalize_reminder` 那套 `max(1, lead-1)` 在 **lead=1** 时会返回 1
        #      ⇒ 两个节点仍落在**同一分钟**（压不干净）。
        #   ⇒ 交给 `_run_forecast_reminder_for_tenant` 判：`final >= lead` 时**跳过 final** 并留痕。
    except Exception as e:
        print(f"[Scheduler][v305] 读提醒配置失败，回落内置默认: {e}")
    return cfg


def _auto_period_times():
    """当前租户的报单自动化开/关时刻。**未开启返回 (None, None)**。

    与 `_check_auto_period` 读的是**同一张表同一批列**（`rebate_target_rules`）——
    催报基准必须与"真实关单时刻"同源，否则会出现
    「催报说 11:00 截止、系统 10:30 就把期次关了」这种自相矛盾。
    """
    try:
        with db.get_db() as c:
            rows = c.execute(
                "SELECT auto_period_enabled, auto_open_time, auto_close_time "
                "FROM rebate_target_rules WHERE is_active=1 AND dimension='brand'").fetchall()
        for r in rows:
            r = dict(r)
            if int(r.get("auto_period_enabled") or 0) == 1:
                ot = (r.get("auto_open_time") or "20:00").strip() or "20:00"
                ct = (r.get("auto_close_time") or "10:00").strip() or "10:00"
                return (ot, ct)
    except Exception as e:
        print(f"[Scheduler][v305] 读报单自动化时刻失败（催报将回落到面板配的截止时刻）: {e}")
    return (None, None)


def _reminder_close_time(cfg):
    """催报基准「关单时刻」的唯一取法。

    自动化**开启**时用真实 `auto_close_time`（与关单同源，用户在哪关、就在哪催）；
    自动化**未开启**时用面板里配的 `deadline_time`（此时面板是唯一来源）。
    两条都拿不到 ⇒ 18:00（面板默认值）。
    """
    _ot, ct = _auto_period_times()
    if ct:
        return ct
    return (cfg.get("deadline_time") or "18:00")


def _period_close_at(order_end, close_time):
    """期次的真实关单时刻 = `order_end`（日期）+ 关单时刻。解析不出 ⇒ None（本轮不催）。"""
    oe = str(order_end or "").strip()
    if len(oe) < 10:
        return None
    try:
        return datetime.strptime("%s %s" % (oe[:10], close_time), "%Y-%m-%d %H:%M")
    except Exception:
        return None


def _in_quiet_hours(now, quiet):
    """现在是否落在免打扰时段（只影响**企微**推送，站内信不受影响 —— 与面板文案同口径）。
    支持跨零点区间（如 22:00~08:00）。区间为空/相等 ⇒ 不免打扰。"""
    try:
        qs = str((quiet or {}).get("start") or "").strip()
        qe = str((quiet or {}).get("end") or "").strip()
        if not qs or not qe or qs == qe:
            return False
        cur = now.strftime("%H:%M")
        if qs < qe:
            return qs <= cur < qe
        # 跨零点：22:00~08:00 ⇒ 命中 [22:00,24:00) 或 [00:00,08:00)
        return cur >= qs or cur < qe
    except Exception:
        return False


def push_forecast_reminder_current(respect_open_notice=False, node="", ignore_quiet=False):
    """在当前租户上下文下计算+推送催单提醒。无开放周期/无候选/无未报 → 不推。返回 bool。

    ① 定向到人（2026-09-23）：未报单元按「负责销售」分组，给每个已绑定**启用中**账号的
       销售发**定向**站内信（只列他负责的门店）；未绑定 / 账号停用 / 定向发送失败的门店
       退化为「广播给管理员」，fail-closed —— 绝不因为归属缺失就静默丢弃某家店的催单。
    ② 企微 / 飞书机器人（老板群）保留原有**全量广播**，作为老板视角的兜底。

    v304b（2026-09-28）：`respect_open_notice=True` 时**刚开放就让位** —— 期次是最近
    30 分钟内建的 ⇒ 直接返回，因为「已开放」通知已由 `_auto_period_open` **事件驱动**
    精确发出。理由有两条，都会真出问题：① 撞车（同一条消息发两遍）；② **措辞反成
    误导** —— 刚开放 0 分钟时「还有 N 个单元未报」必然等于「全部单元」，老板会读成
    「大家都拖着不报」。

    🔴 **默认 False（= 不让位）是刻意的**：只有**定时轮**那个调用点显式传 True。
       原因是**手动催单按钮**（POST /api/forecast-submissions/remind）必须永远真发 ——
       用户手点却没反应，就是又一处「点得动、没反应、零报错」的静默失效。
       任何遗漏的调用点都退化为**旧行为（一定催）**，绝不退化为「静默不催」。
    ⚠️ 判据查库（`created_at`）⇒ 跨进程重启仍有效；读不到一律**照常催单**（fail-open）。

    供 scheduler 按租户遍历与手动触发端点（POST /api/forecast-submissions/remind）共用。

    🔴 v305（2026-09-28）：本函数开始**读面板配置**（用户拍板的 B/C 方案）——
       · `enabled`        ⇒ 总开关，关掉直接不发（**并留痕**，见下）
       · `channels.inapp` ⇒ 站内信（定向 + 广播兜底）
       · `channels.wecom` ⇒ 企业微信
       · `per_sales`      ⇒ 关掉就只发一条汇总，不按销售拆人头
       · `nodes.*`        ⇒ 由调用方 `_run_forecast_reminder` 决定该不该调本函数
       `node`（lead / final / summary）只用于日志与措辞；`ignore_quiet=True` 供**手动催单**用
       —— 按钮是用户主动动作，免打扰时段不该拦他自己的手。
    """
    cfg = _forecast_reminder_cfg()
    if not cfg.get("enabled"):
        # 🔴 必须留痕：否则「用户关了提醒」与「跑了但没内容」在日志里长得一模一样（R8 纪律）。
        print("[Scheduler][v305] 报单提醒总开关已关闭（面板「启用报单提醒」）⇒ 本轮不推送")
        return False
    if respect_open_notice and node != "summary" and _period_opened_recently():
        print("[Scheduler] forecast reminder: 本期刚开放（%d 分钟内）⇒ 让位给开放通知，本轮不催"
              % PERIOD_OPEN_NOTICE_MINUTES)
        return False
    st = _forecast_reminder_state()
    if not st or not st["missing"]:
        return False
    p = st["period"]
    missing = st["missing"]
    tot = st["totals"]
    today = datetime.now().strftime("%m月%d日")
    title = f"{today} 预报催单 · {p.get('name', '')}"
    os_, oe = (p.get("order_start") or ""), (p.get("order_end") or "")

    # —— ① 按负责销售分组 ——
    owner_map = _forecast_store_owner_map()
    acct_map = db.employee_account_map()  # {emp_id: {id, username, display_name, role, is_active}}
    by_emp = {}      # emp_id -> [store_name]
    unbound = []     # 未绑定负责人 / 负责人无启用账号 / 定向发送失败
    for s in missing:
        eid = owner_map.get(s, 0)
        acct = acct_map.get(eid) if eid else None
        if acct and acct.get("is_active"):
            by_emp.setdefault(eid, []).append(s)
        else:
            if acct and not acct.get("is_active"):
                print(f"[Scheduler] forecast reminder: 员工#{eid} 账号停用，门店转广播兜底: {s}")
            unbound.append(s)

    # ---- v305：面板「按销售分组」「站内信」两处开关在这里生效 ------------------
    # ⚠️ 只决定"给谁发 / 发不发"，**不改下方结构** —— 清空 dict 即零迭代，
    #    不必动 `for` 的缩进（少一次缩进改动就少一次把逻辑改歪的机会）。
    _inapp = bool((cfg.get("channels") or {}).get("inapp", True))
    _per_sales = bool(cfg.get("per_sales", True))
    if not _per_sales or not _inapp:
        by_emp = {}
    if not _per_sales:
        # 不拆人头 ⇒ 未报门店**全部**走下方广播兜底那一条。
        # 🔴 必须同时补 `unbound`：若只清空 `by_emp` 而不补，这些店会"既没定向、又没广播"
        #    ⇒ 一条催单都收不到。这正是最难查的那种静默漏催。
        unbound = list(missing)

    sent_any = False
    # 给每个有启用账号的销售发定向提醒（只列他负责的门店）
    for eid, stores in by_emp.items():
        acct = acct_map[eid]
        whom = acct.get("display_name") or acct.get("username") or f"员工#{eid}"
        lines = [
            f"你负责的以下 {len(stores)} 个单元本期货尚未报单，请于 {oe or '截止日'} 前完成报单：",
            "、".join(stores[:15]) + (" 等" if len(stores) > 15 else ""),
            f"报单窗口 {os_} ~ {oe}",
        ]
        try:
            db.message_send(title, "\n".join(lines), "warning", "经营副驾",
                            recipients=str(acct["id"]),
                            event_key=f"forecast_remind_emp_{eid}")
            sent_any = True
        except Exception as e:
            print(f"[Scheduler] forecast reminder 定向发送失败 (emp={eid}): {e}")
            unbound.extend(stores)  # 发送失败也退化为广播兜底

    # fail-closed：未绑定 / 账号停用 / 发送失败的门店，广播给管理员，绝不静默丢弃
    # v305：`channels.inapp` 关掉时这一段一并跳过（否则"关站内信"关不干净）。
    if unbound and _inapp:
        lines = [
            f"以下 {len(unbound)} 个单元尚未报单（含未绑定负责人或账号停用，请关注）：",
            "、".join(unbound[:15]) + (" 等" if len(unbound) > 15 else ""),
            f"报单窗口 {os_} ~ {oe}",
            f"本期已报 {tot.get('units') or 0} 个单元 · 总订量 {tot.get('qty') or 0} 件 · ¥{(tot.get('amount') or 0):,.0f}",
        ]
        try:
            db.message_send(title, "\n".join(lines), "warning", "经营副驾")
            sent_any = True
        except Exception as e:
            print(f"[Scheduler] forecast reminder 广播兜底发送失败: {e}")

    # ② 企业微信 / 飞书机器人（全量广播，老板视角兜底）
    broadcast_content = "\n".join([
        f"报单窗口 {os_} ~ {oe}，还有 {len(missing)} 个单元未报：",
        "、".join(missing[:10]) + (" 等" if len(missing) > 10 else ""),
        f"本期已报 {tot.get('units') or 0} 个单元 · 总订量 {tot.get('qty') or 0} 件 · ¥{(tot.get('amount') or 0):,.0f}",
    ])
    # 🔴 v305：这一条**必须走租户自己的通道**，不能只靠全局 webhook ——
    #   生产实测（2026-09-28）：`WECOM_WEBHOOK_URL` **从未配置**（全局那条路永远是空的），
    #   而租户 Hermes 的企微凭据是**好的**（沙箱内实测 `enabled_channels(1) == ['wecom']`，
    #   并拿到了投递回执 `message_id: aibot_send_msg-…`）。
    #   原实现只调 `push_to_wecom` ⇒ 用户**一条也收不到**，日志还只说"未配置"——
    #   这正是用户报障「提醒没收到」的最后一层，也是本轮 `channels.wecom` 的真实落点。
    #   顺序：先用**租户通道**（能到人）→ 再用全局 webhook（配了才发，作为额外兜底）。
    if bool((cfg.get("channels") or {}).get("wecom", False)):
        _quiet = _in_quiet_hours(datetime.now(), cfg.get("quiet")) and not ignore_quiet
        if _quiet:
            # 免打扰只挡企业微信（站内信不受影响，与面板文案同口径）。
            # ⚠️ 必须留痕：否则「夜里按免打扰没发」与「根本没跑」在日志里分不出来。
            print("[Scheduler][v305] 免打扰时段（%s~%s）⇒ 本轮不推企业微信；站内信不受影响"
                  % ((cfg.get("quiet") or {}).get("start"), (cfg.get("quiet") or {}).get("end")))
        else:
            try:
                from db.connection import get_tenant_context
                _tid = get_tenant_context()
            except Exception as _te:
                _tid = None
                print(f"[Scheduler][v305] 取租户上下文失败，跳过租户渠道: {_te}")
            if _tid:
                try:
                    _push_tenant_channels(_tid, title, broadcast_content)
                    sent_any = True
                except Exception as e:
                    print(f"[Scheduler][v305] 租户渠道推送失败（tenant={_tid}）: {e}")
            try:
                from feishu_notify import push_to_wecom, push_to_feishu
                push_to_wecom(title, broadcast_content)
                push_to_feishu(title, broadcast_content)
            except Exception as e:
                print(f"[Scheduler] forecast reminder wecom/feishu 全局兜底 push error: {e}")
    else:
        print("[Scheduler][v305] 面板未勾选「企业微信」渠道 ⇒ 本轮跳过企微（站内信不受影响）")
    print(f"[Scheduler] Forecast reminder pushed: node={node or 'manual'} "
          f"{len(missing)} missing, {len(by_emp)} 销售定向, {len(unbound)} 广播兜底, "
          f"inapp={_inapp}, wecom={bool((cfg.get('channels') or {}).get('wecom', False))}")
    return sent_any


# v305：提醒触发窗口 —— 到点后多久之内仍算"这一轮"。
#   太窄（<tick 间隔）会在服务刚好重启时漏发；太宽会把几小时前的轮次补发出来。
#   5 分钟 tick 下取 10 分钟：足以覆盖「刚好在那一分钟重启」。
_REMINDER_FIRE_WINDOW_MIN = 10


def push_forecast_summary(node="summary"):
    """「截止后汇总」（v305 · 节点 `summary`，**默认关闭** —— 用户明确"关单后通知不做"）。

    为什么仍然实现它、而不是在面板留个假开关：假开关正是用户这次要消灭的那类东西
    （「点了没反应」）。他选的是"保留开关但默认关闭"⇒ 开关一勾就必须真发。

    统计口径：取**最近关单的那个期次**（`order_end` = 今天或昨天，`status='closed'`），
    统计非「导入」报单的单元数与总量。口径与 `_forecast_reminder_state` 保持同向
    （都排除 `role='导入'`，因为那是文员导入的数据、不是销售报的单）。
    """
    try:
        from datetime import date as _date
        _today = _date.today()
        lo = (_today - timedelta(days=1)).isoformat()
        hi = _today.isoformat()
        with db.get_db() as c:
            row = c.execute(
                "SELECT id, name, order_start, order_end, arrival_date FROM forecast_periods "
                "WHERE status='closed' AND order_end>=? AND order_end<=? "
                "ORDER BY order_end DESC, id DESC LIMIT 1", (lo, hi)).fetchone()
        if not row:
            print("[Scheduler][v305] summary: 近两日内没有已关单的期次 ⇒ 无汇总可发")
            return False
        p = dict(row)
        pid = int(p["id"])
        with db.get_db() as c:
            st = c.execute(
                "SELECT COUNT(DISTINCT s.store_name) AS units, "
                "       COALESCE(SUM(i.quantity), 0) AS qty "
                "FROM forecast_submissions s "
                "LEFT JOIN forecast_submission_items i ON i.submission_id = s.id "
                "WHERE s.period_id = ? AND (s.role IS NULL OR s.role <> '导入')",
                (pid,)).fetchone()
        st = dict(st) if st else {}
        units = int(st.get("units") or 0)
        qty = int(st.get("qty") or 0)
        title = "本期报单已截止 · %s" % (p.get("name") or ("期次#%d" % pid))
        content = ("本期报单窗口已关闭（%s ~ %s）。\n"
                   "最终有 %d 个单元提交了报单，合计 %d 件。\n"
                   "到货日：%s"
                   % (p.get("order_start") or "", p.get("order_end") or "",
                      units, qty, p.get("arrival_date") or "见期次"))
        try:
            db.message_send(title, content, "notice", "经营副驾",
                            event_key="forecast_summary_%d" % pid)
        except Exception as e:
            print(f"[Scheduler][v305] summary 站内信失败: {e}")
        try:
            from db.connection import get_tenant_context
            _tid = get_tenant_context()
            if _tid and bool((_forecast_reminder_cfg().get("channels") or {}).get("wecom", False)):
                _push_tenant_channels(_tid, title, content)
        except Exception as e:
            print(f"[Scheduler][v305] summary 渠道推送失败: {e}")
        print("[Scheduler][v305] summary: 期次#%d 已发汇总（%d 单元 / %d 件）" % (pid, units, qty))
        return True
    except Exception as e:
        print(f"[Scheduler][v305] summary 异常（不影响其他节点）: {e}")
        return False


def _run_forecast_reminder_for_tenant(tid):
    """**单个租户**的催报调度（v305）：按面板配置 + 真实期次窗口决定此刻该发哪一轮。

    为什么不再用 `_should_run_at(hours=(9, 16))` 这类固定钟点（这是用户拍板 B/C 的核心理由）：
      · 真实关单时刻来自**租户配置**（`auto_close_time`，tenant_1 = 11:00），而固定轮写死 9/16 点；
        在「D-1 16:00 开 / D 11:00 关」的节奏下，16 点那轮**结构上永远是空的**；
      · 面板配的是「截止前 N 小时 / 最后 N 小时」这种**相对量**，固定钟点根本表达不了它。

    节点与基准（基准 = **真实关单时刻** = `order_end` 日期 + 关单时刻）：
      · lead    = 关单时刻 − `lead_hours`   —— 面板「截止前提醒（提前量）」
      · final   = 关单时刻 − `final_hours`  —— 面板「最后时刻提醒（提前量）」
      · summary = 关单时刻之后             —— 面板「截止后汇总」，**默认关闭**
      · new_period **不在这里** —— 它挂在"建表成功"那一刻（事件驱动），见 `_auto_period_open`。
        理由：`auto_period` 每 5 分钟一轮、相位由进程启动时刻决定，靠固定钟点代劳会有
        4/5 的概率跑在期次被建出来**之前**（v304b 实测）。

    幂等：`_monitors_run["fcrmd:<期次id>:<节点>"]` 记账 ⇒ 同一期次同一节点只发一次。
      ⚠️ 记账在**内存**里 ⇒ 进程重启后若仍在触发窗口内会**重发一次**。这是刻意取舍：
         「多催一次」的代价是噪音，「漏催一次」的代价是漏报 —— **宁多不漏**。
    """
    cfg = _forecast_reminder_cfg()
    if not cfg.get("enabled"):
        print(f"[Scheduler][v305] tenant={tid}: 提醒总开关已关闭 ⇒ 不做任何催报")
        return False
    st = _forecast_reminder_state()
    if not st:
        print(f"[Scheduler][v305] tenant={tid}: 无进行中的报单期次 ⇒ 无催报计划")
        return False
    p = st.get("period") or {}
    oe = p.get("order_end")
    ct = _reminder_close_time(cfg)
    # `datetime.now()` 每次取（不在外面缓存）：本函数可能跨 tick 边界执行
    close_at = _period_close_at(oe, ct)
    if close_at is None:
        print(f"[Scheduler][v305] tenant={tid}: 期次「{p.get('name')}」解析不出关单时刻"
              f"（order_end={oe!r} close_time={ct!r}）⇒ 本轮跳过")
        return False
    now = datetime.now()
    nodes = cfg.get("nodes") or {}
    _pid = int(p.get("id") or 0)
    fired = False

    def _due(key, at):
        """到点 且 未记账 ⇒ True（并立刻记账，防同一 tick 内重复）。"""
        _k = "fcrmd:%d:%s" % (_pid, key)
        if _monitors_run.get(_k) is not None:
            return False
        if at <= now <= at + timedelta(minutes=_REMINDER_FIRE_WINDOW_MIN):
            _monitors_run[_k] = now
            return True
        return False

    if nodes.get("lead", True):
        _at = close_at - timedelta(hours=int(cfg.get("lead_hours") or 3))
        if _due("lead", _at):
            print("[Scheduler][v305] tenant=%s: 命中「截止前提醒」（%s，早于关单 %s 小时）"
                  % (tid, _at.strftime("%m-%d %H:%M"), cfg.get("lead_hours")))
            if push_forecast_reminder_current(respect_open_notice=True, node="lead"):
                fired = True
    # 🔴 v305：「最后时刻」不可能晚于「截止前」。若用户把两个提前量配成同一个值
    #   （面板上 lead 最小可选 1 小时，而 final 最小也是 1 小时 ⇒ 完全可能配重），
    #   两个节点会落在**同一分钟**连发两条催单。
    #   `_normalize_reminder` 那套 `max(1, lead-1)` 在 lead=1 时返回 1，**压不干净**
    #   ⇒ 这一道必须在调度层存在。跳过要留痕，否则"少了一条"在日志里看不出来。
    _lead_h = int(cfg.get("lead_hours") or 3)
    _final_h = int(cfg.get("final_hours") or 1)
    if nodes.get("final", True) and _final_h >= _lead_h:
        print("[Scheduler][v305] tenant=%s: 「最后时刻提醒」提前量(%sh) 不小于「截止前提醒」"
              "(%sh) ⇒ 本轮跳过 final，避免同一分钟重复催" % (tid, _final_h, _lead_h))
    elif nodes.get("final", True):
        _at = close_at - timedelta(hours=_final_h)
        if _due("final", _at):
            print("[Scheduler][v305] tenant=%s: 命中「最后时刻提醒」（%s，早于关单 %s 小时）"
                  % (tid, _at.strftime("%m-%d %H:%M"), cfg.get("final_hours")))
            if push_forecast_reminder_current(respect_open_notice=False, node="final"):
                fired = True
    if nodes.get("summary", False):
        # 关单后给三次机会（+5 / +35 / +65 分钟）：服务刚好在关单那一分钟重启也不至于漏掉。
        # 命中一次即 break —— 汇总只该发一条。
        for _off in (5, 35, 65):
            if _due("summary%d" % _off, close_at + timedelta(minutes=_off)):
                if push_forecast_summary(node="summary"):
                    fired = True
                break
        else:
            print(f"[Scheduler][v305] tenant={tid}: summary 节点开着，但还没到关单后 5 分钟")
    if not fired:
        print("[Scheduler][v305] tenant=%s: 未到任何提醒节点（关单 %s；lead −%sh / final −%sh；"
              "开关 lead=%s final=%s summary=%s）"
              % (tid, close_at.strftime("%m-%d %H:%M"), cfg.get("lead_hours"),
                 cfg.get("final_hours"), nodes.get("lead"), nodes.get("final"),
                 nodes.get("summary")))
    return fired


def _push_forecast_reminder():
    """P0-3 预报催单：遍历所有租户，逐个在租户上下文调度（单个失败不影响其他租户）。fail-closed。

    v305：本体已瘦成"遍历 + 切租户"，**决策全部移进 `_run_forecast_reminder_for_tenant`**
    —— 那里才读得到该租户的面板配置。本函数只管"别让某个租户的异常拖垮其他租户"。
    """
    try:
        from db.connection import set_tenant_context
    except Exception as e:
        print(f"[Scheduler] forecast reminder tenant context import error: {e}")
        return
    tids = _tenant_ids()
    if not tids:
        return
    for tid in tids:
        try:
            set_tenant_context(tid)
            # v305：改由**配置驱动**（面板「截止前 / 最后时刻 / 截止后」三个节点 +
            #   该租户真实的关单时刻），不再写死 9 点 / 16 点。
            #   节点判定、幂等记账、留痕全在被调函数里。
            if _run_forecast_reminder_for_tenant(tid):
                print(f"[Scheduler] Forecast reminder tenant={tid}: pushed")
            # ⚠️ 未触发时**不在这里补一句泛泛的"无事可推"** —— 被调函数已经打印了
            #   「未到任何提醒节点（关单 X；lead −3h / final −1h；开关 …）」，
            #   再补一句会把真正的原因稀释掉（v304 那轮排查正是被这种泛化日志拖慢的）。
        except Exception as e:
            print(f"[Scheduler] Forecast reminder tenant={tid} error: {e}")
        finally:
            set_tenant_context(None)


# ============================================================
# 租户网关保活 Monitor（Hermes 多租户：凭证在就保证进程在）
# ============================================================
def _check_channel_health():
    """遍历所有租户，逐个跑 ai_channels.health_check_tenant(tid)。

    每个租户的网关是独立进程 + 独立 HERMES_HOME（/opt/hermes-tenants/<slug>），
    故此处在主库按 tenant_id 过滤即可，不需要切租户库上下文。
    单租户失败不影响其他租户；fail-closed。"""
    try:
        from ai_channels import health_check_tenant
    except Exception as e:
        print(f"[Scheduler] channel health import error: {e}")
        return
    tids = _tenant_ids()
    if not tids:
        return
    for tid in tids:
        try:
            health_check_tenant(tid)
        except Exception as e:
            print(f"[Scheduler] channel health tenant={tid} error: {e}")
