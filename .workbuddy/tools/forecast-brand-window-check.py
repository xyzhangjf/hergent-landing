#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按品牌报单日（星期）管控 —— 判定内核契约检查。

用法：
    python3 .workbuddy/tools/forecast-brand-window-check.py
    python3 .workbuddy/tools/forecast-brand-window-check.py --self-test

退出码：0 = 全绿；1 = 有失败项

为什么要有这个脚本（2026-11-04）：
    「某品牌这一期能不能报」是一个**双向都会静默出错**的判定 ——
    判宽了 = 该拦的没拦（业务员在非报单日把单报上去，厂家侧不认）；
    判紧了 = 该放的拦住（全员报不了单，比漏拦贵得多）。
    两种都不会抛异常，只会让人以为"系统就是这样"。
    故本脚本用**生产真实 23 期日期**做样本，逐期断言。

自包含：不读生产库。DB 段用临时造的**最小库**（只有必要列），
    顺带能暴露「代码偷偷依赖了某个列」的问题。
"""
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
# `BW_REMOTE` 供 --self-test 把检查指向注入过错误的副本
REMOTE = os.environ.get('BW_REMOTE') or os.path.normpath(
    os.path.join(HERE, '..', 'remote-erp'))

# 生产 tenant_1 真实期次（2026-11-04 快照，23 期，跳过号是历史删除留下的）
PERIODS = [
    (16, '2026-09-20'), (17, '2026-09-23'), (18, '2026-09-25'), (19, '2026-09-27'),
    (21, '2026-09-29'), (22, '2026-10-01'), (23, '2026-10-03'), (27, '2026-10-05'),
    (28, '2026-10-07'), (29, '2026-10-09'), (30, '2026-10-11'), (31, '2026-10-13'),
    (32, '2026-10-15'), (33, '2026-10-17'), (34, '2026-10-19'), (35, '2026-10-21'),
    (36, '2026-10-23'), (37, '2026-10-25'), (38, '2026-10-27'), (39, '2026-10-29'),
    (40, '2026-10-31'), (41, '2026-11-02'), (42, '2026-11-04'),
]

# 硬事实：配「每周一、周四」时，这 6 期可报，其余 17 期不可报。
# 🔴 这是按真实日期手推出来的具体期次清单，**不是**拿函数输出反推的。
#    改判定算法若动摇了它，说明语义变了，必须逐个人工复核。
EXPECT_HIT_14 = {22, 27, 32, 34, 39, 41}      # 周四/周一
EXPECT_HIT_25 = {18, 21, 29, 31, 36, 38}      # 周五/周二

fails, total = [], 0


def ok(cond, msg):
    global total
    total += 1
    if not cond:
        fails.append(msg)
        print('  \u274c ' + msg)


def build_db(path, with_rules=True, rules_weekdays='', with_periods=True,
             with_order_end_date=True):
    c = sqlite3.connect(path)
    if with_periods:
        # v765c：`order_end_date` 是后加的列 —— tenant_1 有、tenant_10 没有、
        # 将来新租户取决于迁移脚本。夹具必须能造出「缺这一列」的库，
        # 否则自检永远绿，而生产上开关一开就整段抛错被吞成全放行。
        if with_order_end_date:
            c.execute("CREATE TABLE forecast_periods("
                      "id INTEGER PRIMARY KEY, order_end TEXT, order_end_date TEXT)")
            for pid, oe in PERIODS:
                c.execute("INSERT INTO forecast_periods VALUES(?,?,?)", (pid, oe, oe))
        else:
            c.execute("CREATE TABLE forecast_periods("
                      "id INTEGER PRIMARY KEY, order_end TEXT)")
            for pid, oe in PERIODS:
                c.execute("INSERT INTO forecast_periods VALUES(?,?)", (pid, oe))
    if with_rules:
        c.execute("CREATE TABLE rebate_target_rules("
                  "id INTEGER PRIMARY KEY, scope_key TEXT, scope_name TEXT, "
                  "dimension TEXT, is_active INTEGER, order_mode TEXT, "
                  "order_weekdays TEXT, order_lead_days INTEGER)")
        for i, b in enumerate(['简爱', '蒙牛酸奶', '蒙牛鲜奶（7579）', '蒙牛酸奶-恒滋'], start=9):
            c.execute("INSERT INTO rebate_target_rules VALUES(?,?,?,?,?,?,?,?)",
                      (i, b, b, 'brand', 1, 'interval', rules_weekdays, 4))
    c.execute("CREATE TABLE products("
              "id INTEGER PRIMARY KEY, brand TEXT, is_active INTEGER)")
    for i, b in enumerate(['简爱'] * 71 + ['蒙牛低温'] * 162 + ['蒙牛鲜奶'] * 39, start=1):
        c.execute("INSERT INTO products VALUES(?,?,1)", (i, b))
    # v772：全档案有、本期清单没有的品牌 —— 用来反证「横幅不按全档案算」。
    c.execute("INSERT INTO products VALUES(273,'君乐宝',1)")
    # v772：横幅口径 = **本期预报清单**，夹具必须真的有这张表。
    #   清单里 3 个品牌项数刻意不同（3/2/1）⇒ 横幅按项数降序列全，顺序可被断言锁死。
    c.execute("CREATE TABLE forecast_import_products("
              "id INTEGER PRIMARY KEY, period_id INTEGER, order_date TEXT, "
              "product_id INTEGER, brand TEXT)")
    if with_periods:
        for pid, oe in PERIODS:
            for product_id, n in [(72, 3), (234, 2), (1, 1)]:   # 蒙牛低温 / 蒙牛鲜奶 / 简爱
                for _ in range(n):
                    c.execute("INSERT INTO forecast_import_products VALUES(NULL,?,?,?,NULL)",
                              (pid, oe, product_id))
    c.commit()
    c.close()


def main():
    if not os.path.isdir(REMOTE):
        print('\u274c 后端副本不存在：%s' % REMOTE)
        print('   这是**红**不是跳过：判定内核就在那份代码里，缺了等于没有检查。')
        print('   恢复方式：从生产回拉 -- '
              'scp -r root@<host>:/opt/hergent-erp/{domain,db} %s/' % REMOTE)
        return 1

    tmpdir = tempfile.mkdtemp(prefix='bw-check-')
    db_main = os.path.join(tmpdir, 'tenant.db')
    db_bad = os.path.join(tmpdir, 'bad.db')
    db_norule = os.path.join(tmpdir, 'norule.db')
    try:
        build_db(db_main)
        build_db(db_bad, with_rules=False, with_periods=True)
        build_db(db_norule, with_rules=False, with_periods=False)
        db_old = os.path.join(tmpdir, 'old-tenant.db')
        build_db(db_old, rules_weekdays='1,4', with_order_end_date=False)
        os.environ['ERP_DB_PATH'] = db_main
        sys.path.insert(0, REMOTE)

        try:
            from domain.brand_order_window import (
                normalize_brand, weekday_of, weekdays_short, weekdays_full, tip_for,
                rules_from_rows, judge, window_map, banner_for, preview,
                next_order_date, next_period_date, window_hit, lock_msg_for,
                period_brands, _future_periods, MAX_EARLY_LIMIT,
            )
        except Exception as e:
            print('\u274c 判定内核无法导入：%r' % (e,))
            print('   多半是 domain/brand_order_window.py 未部署到副本。')
            return 1

        print('=== A 品牌归一化（不许前缀合并）===')
        ok(normalize_brand('蒙牛鲜奶（7579）') == '蒙牛鲜奶', 'A1 全角括号备注去掉')
        ok(normalize_brand('新希望(南山)') == '新希望', 'A2 半角括号备注去掉')
        ok(normalize_brand('蒙牛低温') == '蒙牛低温', 'A3 无括号不动')
        ok(normalize_brand('蒙牛') == '蒙牛',
           'A4 🔴 蒙牛 绝不许并进 蒙牛低温（是独立事业部）')
        ok(normalize_brand(' 简爱 ') == '简爱', 'A5 去首尾空白')
        ok(normalize_brand('') == '' and normalize_brand(None) == '', 'A6 空值 / None')

        print('=== B 日期 → 星期（1=周一 .. 7=周日）===')
        ok(weekday_of('2026-11-04') == 3, 'B1 11-04 是周三')
        ok(weekday_of('2026-11-02') == 1, 'B2 11-02 是周一')
        ok(weekday_of('2026-10-29') == 4, 'B3 10-29 是周四')
        ok(weekday_of('2026-11-04 12:30:00') == 3, 'B4 带时间戳能解析')
        ok(weekday_of('') is None and weekday_of('abc') is None, 'B5 空 / 坏值 → None')
        ok(weekday_of('2026-13-01') is None, 'B6 非法月份 → None')

        print('=== C 规则装配 ===')
        rows = [
            {'id': 9, 'scope_key': '简爱', 'order_weekdays': '1,4', 'order_lead_days': 4},
            {'id': 10, 'scope_key': '蒙牛酸奶', 'order_weekdays': '', 'order_lead_days': 4},
            {'id': 11, 'scope_key': '蒙牛鲜奶（7579）', 'order_weekdays': '2', 'order_lead_days': 4},
            {'id': 12, 'scope_key': '简爱', 'order_weekdays': '1,4,6', 'order_lead_days': 4},
        ]
        r = rules_from_rows(rows)
        ok('简爱' in r, 'C1 有星期的品牌进表')
        ok(r['简爱']['weekdays'] == [1, 4, 6], 'C2 同品牌多条取并集最大的（不被后条覆盖）')
        ok('蒙牛酸奶' not in r, 'C3 空星期不进表（= 不限制）')
        ok('蒙牛鲜奶' in r and r['蒙牛鲜奶']['weekdays'] == [2], 'C4 括号归一后键名正确')
        ok(rules_from_rows([]) == {} and rules_from_rows(None) == {}, 'C5 空输入 → 空表')

        print('=== D 单品牌判定 ===')
        R = {'简爱': {'weekdays': [1, 4], 'rule_id': 9, 'lead_days': 4}}
        j = judge('简爱', '2026-11-02', R, True)
        ok(j['orderable'] is True, 'D1 周一规则 + 周一截止 → 可报')
        j = judge('简爱', '2026-11-04', R, True)
        ok(j['orderable'] is False, 'D2 🔴 周一规则 + 周三截止 → 不可报')
        ok(j['tip'] == '该商品可报单时间为每周一、四，本期不可提报', 'D3 提示文案逐字')
        ok(j['weekdays'] == [1, 4], 'D4 回传可报星期')
        ok(judge('简爱', '2026-11-04', R, False)['orderable'] is True,
           'D5 🔴 开关关 → 全放行')
        ok(judge('新希望', '2026-11-04', R, True)['orderable'] is True, 'D6 没规则 → 放行')
        ok(judge('简爱', '', R, True)['orderable'] is True, 'D7 日期缺失 → 放行')
        ok(judge('简爱', 'bad', R, True)['orderable'] is True, 'D8 日期坏值 → 放行')
        ok(judge('', '2026-11-04', R, True)['orderable'] is True, 'D9 空品牌 → 放行')

        print('=== E 文案格式 ===')
        ok(weekdays_short([1, 4]) == '一、四', 'E1 short')
        ok(weekdays_full([1, 4]) == '周一、周四', 'E2 full')
        ok(tip_for([7]) == '该商品可报单时间为每周日，本期不可提报', 'E3 单星期周日')

        print('=== F 横幅（v772：按本期清单一列全可报品牌）===')
        # 🔴 三态判据：范围只认本期清单 / 没规则的自动算可报 / 全被挡才说"暂无"。
        #   旧口径按全商品档案算，才需要「其它品牌均可报」和 free 布尔；
        #   本期清单只有几个品牌，直接列全即可，两段式白名单整套撤销。
        P5 = ['蒙牛低温', '蒙牛鲜奶', '友芝友', '新希望', '简爱']
        ok(banner_for({}, []) == '', 'F1 清单为空 → 空串（不把"没导入"说成"暂无可报"）')
        ok(banner_for({}, P5) ==
           '本期可报品牌：蒙牛低温、蒙牛鲜奶、友芝友、新希望、简爱',
           'F2 🔴 一条规则都没有 ⇒ 本期清单品牌全部可报、直接列全')
        b3 = banner_for({'新希望': {'orderable': True}, '简爱': {'orderable': False}}, P5)
        ok(b3 == '本期可报品牌：蒙牛低温、蒙牛鲜奶、友芝友、新希望',
           'F3 只剔除被挡品牌：' + b3)
        ok('简爱' not in b3, 'F4 🔴 绝不点名不可报品牌')
        ok('其它' not in b3, 'F5 🔴 不再有把白名单拆成两段的兜底句')
        b6 = banner_for({'简爱': {'orderable': False}}, ['简爱'])
        ok(b6 == '本期暂无可报品牌', 'F6 🔴 清单品牌全被挡 ⇒ 留一句')
        ok('简爱' not in b6, 'F7 全禁那句同样不点名品牌')
        ok(banner_for({'简爱': {'orderable': None}}, ['简爱']) == '本期可报品牌：简爱',
           'F8 🔴 orderable 缺失（老后端）按可报，不许真值判断')

        _fc = sqlite3.connect(db_main)
        pb = period_brands(_fc, 42, '', '2026-11-04')
        ok(pb == ['蒙牛低温', '蒙牛鲜奶', '简爱'],
           'F9 🔴 本期清单品牌（按清单项数降序）: %r' % (pb,))
        ok(len(pb) == 3 and '君乐宝' not in pb,
           'F10 🔴 只认本期清单，全档案里那个"君乐宝"不许混进来')
        _fc.close()

        print('=== L 拦截弹窗文案（v765d：本期不可报 + 哪天再来）===')
        from datetime import datetime as _dt
        ok(next_order_date([], _dt(2026, 11, 4)) == '', 'L1 无星期 → 空串（前端退到无日期句）')
        nd = next_order_date([1, 4], _dt(2026, 11, 4))   # 周三 → 下一个周一/周四 = 11-05
        ok(nd == '11月5日（周四）', 'L2 下一个可报日：' + nd)
        ok(next_order_date([3], _dt(2026, 11, 4)) == '11月11日（周三）',
           'L3 🔴 今天本身在星期里也要跳过（从明天起算）')
        # 🔴 v779：没有真实期次表上下文时**绝不给日历推算出来的假日期**。
        #    旧断言锁的是「11月5日（周四）」—— 那是日历上的下个周四，
        #    而期次是 2 天/期，那天未必有期次；生产 43 期之后干脆一期都没有。
        #    用户实测被弹窗指去「11月7日填报」却扑空，就是这条口径害的。
        jl = judge('简爱', '2026-11-04', R, True, _dt(2026, 11, 4))
        ok(jl['lock_msg'] == '简爱 只能在每周一、四报单，本期已无可报日',
           'L4 🔴 无真实期次 ⇒ 宁缺日期不给假的：' + jl['lock_msg'])
        ok(jl['next_date'] == '', 'L5 无真实期次 ⇒ next_date 空串')
        ok(lock_msg_for('简爱', [1, 4], '') == '简爱 只能在每周一、四报单，本期已无可报日',
           'L6 算不出日期 ⇒ 不带假日期')
        ok(judge('新希望', '2026-11-04', R, True, _dt(2026, 11, 4))['lock_msg'] == '',
           'L7 可报品牌不得带拦截句（否则会误弹）')

        print('=== G 生产真实 23 期（核心断言）===')
        got14 = {pid for pid, oe in PERIODS if judge('简爱', oe, R, True)['orderable']}
        ok(got14 == EXPECT_HIT_14,
           'G1 🔴 配「周一、周四」命中期次 = %s（期望 %s）'
           % (sorted(got14), sorted(EXPECT_HIT_14)))
        R2 = {'简爱': {'weekdays': [2, 5], 'rule_id': 9, 'lead_days': 4}}
        got25 = {pid for pid, oe in PERIODS if judge('简爱', oe, R2, True)['orderable']}
        ok(got25 == EXPECT_HIT_25,
           'G2 🔴 配「周二、周五」命中期次 = %s（期望 %s）'
           % (sorted(got25), sorted(EXPECT_HIT_25)))
        ok(not (got14 & got25), 'G3 两组无交集 ⇒ 判定真的依赖星期')
        ok(len(got14) == 6 and len(PERIODS) == 23,
           'G4 23 期里 6 期可报（每 2 天一期 × 7 期 = 两周走遍，周一/周四各一次/两周）')

        print('=== H 反向自证（防断言恒真）===')
        all_on = {pid for pid, oe in PERIODS if judge('简爱', oe, {'简爱': {'weekdays': [1, 2, 3, 4, 5, 6, 7]}}, True)['orderable']}
        ok(len(all_on) == 23, 'H1 配满 7 个星期 = 不限制（23/23）')
        none_on = {pid for pid, oe in PERIODS if judge('简爱', oe, {'简爱': {'weekdays': [7]}}, True)['orderable']}
        ok(len(none_on) < 23, 'H2 只配周日 ≠ 不限制（%d/23）' % len(none_on))
        ok(judge('简爱', '2026-10-23', R, True)['orderable'] is False, 'H3 周五 10-23 在 1,4 下不可报')
        ok(judge('简爱', '2026-10-23', R2, True)['orderable'] is True, 'H4 周五 10-23 在 2,5 下可报')

        print('=== I 生产现状安全（4 条规则星期全空）===')
        real = rules_from_rows([{'id': i, 'scope_key': b, 'order_weekdays': ''}
                                for i, b in enumerate(['简爱', '蒙牛酸奶', '蒙牛鲜奶（7579）', '蒙牛酸奶-恒滋'], 9)])
        ok(real == {}, 'I1 🔴 现状规则全空 → 空表 = 全放行，开开关也不影响任何人')
        ok(all(judge('蒙牛低温', oe, real, True)['orderable'] for _, oe in PERIODS),
           'I2 蒙牛低温 162 个商品完全不受影响')

        print('=== J 预览矩阵 ===')
        # PERIODS 按 id 升序，最近 8 期要反转为降序（与界面一致：最新在最上）
        last8 = list(reversed(PERIODS[-8:]))
        pv = preview(R, [{'id': p, 'order_end': o} for p, o in last8], limit=8)
        ok(len(pv) == 8, 'J1 8 期')
        ok(pv[0]['period_id'] == 42 and pv[0]['brands'][0]['orderable'] is False, 'J2 42 期不可报')
        ok(pv[1]['period_id'] == 41 and pv[1]['brands'][0]['orderable'] is True, 'J3 41 期可报')
        ok(pv[0]['weekday_cn'] == '周三', 'J4 星期中文')
        # v779：预览必须和判定层共用可提前窗口，否则「预览说不能报、小程序能报」。
        pv_e1 = preview({'简爱': {'weekdays': [3, 6], 'max_early': 1}},
                        [{'id': 43, 'order_end': '2026-11-06'}], limit=1)
        ok(pv_e1[0]['brands'][0]['orderable'] is True,
           'J5 🔴 E=1 预览与实际同口径（周五截止、周六下单 ⇒ 可报）')

        print('=== K 配置读写（临时库）===')
        import domain.brand_order_window as bw
        ok(bw.get_config() == {'enabled': False}, 'K1 默认关（全新库无配置）')
        ok(bw.set_config(True)['enabled'] is True, 'K2 开启后读回 True')
        ok(bw.is_enabled() is True, 'K3 is_enabled 跟随')
        bw.set_config(True)
        ok(bw.is_enabled() is True, 'K4 重复写入幂等')
        try:
            bw.set_config('yes')
            ok(False, 'K5 非布尔值必须抛 ValueError')
        except ValueError:
            ok(True, 'K5 非布尔值抛 ValueError')

        print('=== L 开关关着 → 不下发任何限制 ===')
        bw.set_config(False)
        ok(bw.period_brand_windows(42)['brands'] == {}, 'L1 关着时 brands 为空')
        ok(bw.period_brand_windows(41)['brands'] == {}, 'L2 41 期同样')

        print('=== M 开关打开但规则星期全空 → 仍然全放行 ===')
        bw.set_config(True)
        ctx = bw.period_brand_windows(42)
        ok(ctx['enabled'] is True, 'M1 enabled=True')
        ok(ctx['brands'] == {}, 'M2 🔴 无人配星期 ⇒ 无任何限制')
        ok(ctx['banner'] == '本期可报品牌：蒙牛低温、蒙牛鲜奶、简爱',
           'M3 🔴 无人配星期 ⇒ 本期清单品牌全部可报、直接列全：' + ctx['banner'])
        ok(ctx['order_end'] == '2026-11-04', 'M4 读到 order_end')
        ok(ctx['weekday_cn'] == '周三', 'M5 星期中文')

        print('=== N 配上「简爱 = 周一、周四」===')
        c = sqlite3.connect(db_main)
        c.execute("UPDATE rebate_target_rules SET order_weekdays='1,4' WHERE scope_key='简爱'")
        c.commit()
        c.close()
        ctx42 = bw.period_brand_windows(42)
        ok('简爱' in ctx42['brands'], 'N1 简爱进判定表')
        ok(ctx42['brands']['简爱']['orderable'] is False, 'N2 🔴 周三 42 不可报')
        ok(ctx42['brands']['简爱']['tip'] == '该商品可报单时间为每周一、四，本期不可提报', 'N3 提示文案')
        # v772：本期清单 3 个品牌，只有简爱被挡 ⇒ 横幅直接列另外两个，
        # 不再有 free 布尔，也不再有把白名单拆成两段的兜底句。
        ok(ctx42['banner'] == '本期可报品牌：蒙牛低温、蒙牛鲜奶',
           'N4 🔴 剔除被挡品牌后列全本期清单：' + ctx42['banner'])
        ok('其它' not in ctx42['banner'] and 'free' not in ctx42,
           'N4b 🔴 旧兜底句与 free 标记均已撤销')
        ok(bw.period_brand_windows(41)['brands']['简爱']['orderable'] is True, 'N5 🔴 周一 41 可报')
        ok(bw.period_brand_windows(41)['banner'] ==
           '本期可报品牌：蒙牛低温、蒙牛鲜奶、简爱',
           'N6 🔴 全可报也列全（本期清单口径，不再是空串）')

        print('=== U 缺 order_end_date 列的租户（tenant_10 / 新租户）===')
        # 🔴 这一段的成因：`period_brand_windows` 原来写
        #    `COALESCE(order_end, order_end_date)`，而 tenant_10 只有 12 列（无该列）
        #    ⇒ 整段抛错 → except 吞成「全放行」⇒ **开关打开也永远不生效**，
        #    现场只有一行 warning、界面一片正常。自检原来只造带该列的库，所以全绿。
        conn_old = sqlite3.connect(db_old)
        c_old = bw.period_brand_windows(42, conn=conn_old)
        ok(c_old['order_end'] == '2026-11-04', 'U1 缺列仍读到 order_end：' + repr(c_old['order_end']))
        ok(c_old['brands'].get('简爱', {}).get('orderable') is False,
           'U2 🔴 缺列不许把限制吞成全放行')
        # db_old 夹具的 4 条规则**全部**带 '1,4'（含归一后的「蒙牛鲜奶」），
        # 42 期周三 ⇒ 简爱与蒙牛鲜奶都被挡，本期清单里只剩「蒙牛低温」可报。
        ok(c_old['banner'] == '本期可报品牌：蒙牛低温',
           'U3 缺列仍能出横幅（被挡品牌照常剔除）：' + c_old['banner'])
        conn_old.close()

        print('=== O 边界 ===')
        ok(bw.period_brand_windows(None)['brands'] == {}, 'O1 period_id=None')
        ok(bw.period_brand_windows(99999)['brands'] == {}, 'O2 🔴 期次不存在 → 不下发限制')

        print('=== P 规则读取 / Q spec ===')
        rl = bw.load_rules()
        ok('简爱' in rl and rl['简爱']['weekdays'] == [1, 4], 'P1 读到简爱规则')
        ok(rl['简爱']['rule_id'] == 9, 'P2 带 rule_id')
        sp = bw.spec()
        ok(sp['enabled'] is True and '{wd}' in sp['tip_tmpl'], 'Q1 spec 带开关与文案模板')
        ok('banner_free_suffix' not in sp and 'banner_free_only_tmpl' not in sp,
           'Q2 🔴 spec 不再下发旧兜底话术模板')

        print('=== S weekdays_label（行内短标签，v765 小程序用）===')
        ctx42 = bw.period_brand_windows(42)
        ok(ctx42['brands']['简爱']['weekdays_label'] == '每周一、四',
           'S1 🔴 短标签 = 「每周一、四」（整句，前端不再拼「每周」）')
        ok(ctx42['brands']['简爱']['weekdays'] == [1, 4], 'S2 数字形态仍保留')
        ok(bw.period_brand_windows(41)['brands']['简爱']['weekdays_label'] == '每周一、四',
           'S3 可报那期同样给短标签（前端同一字段两处复用）')
        _rules_ja = [r for r in ctx42['rules'] if r['brand'] == '简爱']
        ok(bool(_rules_ja) and _rules_ja[0]['weekdays_cn'] == '周一、周四',
           'S4 🔴 rules.weekdays_cn 保持长形（周四）—— 与短标签刻意不同名')
        ok(bw.judge('简爱', '2026-11-04', {'简爱': {'weekdays': []}})['weekdays_label'] == '',
           'S5 无星期 ⇒ 短标签空串（前端退到通用句）')

        # ── v779：拦截判定读「最多可提前天数」，与编排层同一个窗口 ──────────
        print('=== V v779 可提前窗口（与 match_brands_to_periods 同构）===')
        # 编排层窗口 [C-E, C]：C=品牌方下单日（星期∈ws）、D=主序列下单日(=期次截止日)。
        # 反过来看同一关系 ⇒ 存在 C ∈ [D, D+E] 且 C 的星期 ∈ ws。
        ok(MAX_EARLY_LIMIT == 2, 'V0 上限复用编排层常量（不另写死一个数字）')
        ok(all(window_hit(oe, [3, 6], 0) == (weekday_of(oe) in [3, 6])
               for _, oe in PERIODS),
           'V1 🔴 E=0 逐期等价 v765 旧行为（23 期全覆盖，零误伤）')
        ok(window_hit('2026-11-06', [3, 6], 0) is False, 'V2 周五 E=0 → 拦')
        ok(window_hit('2026-11-06', [3, 6], 1) is True,
           'V3 🔴 周五 E=1 → 11-07 周六命中 ⇒ 提前一天可报（用户诉求）')
        ok(window_hit('2026-11-05', [3, 6], 2) is True, 'V4 周四 E=2 → 周六命中')
        ok(window_hit('2026-11-05', [3, 6], 1) is False, 'V5 周四 E=1 → 只到周五，不命中')
        ok(window_hit('2026-11-02', [3, 6], 1) is False,
           'V6 🔴 不许无限放宽：周一 E=1 只覆盖周一/周二')
        ok(window_hit('2026-11-06', [3, 6], 99)
           == window_hit('2026-11-06', [3, 6], MAX_EARLY_LIMIT),
           'V7 大值 clamp 到编排层上限')
        ok(window_hit('2026-11-06', [3, 6], 'abc') is False, 'V8 坏值回落 E=0')
        ok(window_hit('2026-11-06', [3, 6], -5) is False, 'V9 负值回落 E=0')
        ok(window_hit('bad', [3, 6], 1) is False and window_hit('2026-11-06', [], 1) is False,
           'V10 坏日期 / 空星期 → False')

        print('=== W 弹窗日期只认真实期次表 ===')
        FUTURE = [
            {'id': 44, 'order_start': '2026-11-07', 'order_end': '2026-11-08'},  # 周日
            {'id': 45, 'order_start': '2026-11-09', 'order_end': '2026-11-10'},  # 周二 → E=1 命中 11-11 周三
            {'id': 46, 'order_start': '2026-11-11', 'order_end': '2026-11-12'},  # 周四
            {'id': 47, 'order_start': '2026-11-13', 'order_end': '2026-11-14'},  # 周六
        ]
        _nd1 = next_period_date([3, 6], 1, FUTURE)
        ok(_nd1 == '11月9日（周一）', 'W1 🔴 取第一个真实可报期次的开放日：' + repr(_nd1))
        ok('11月7日' not in _nd1, 'W2 🔴 绝不返回没有期次的虚构日历日 11-07')
        ok(next_period_date([3, 6], 0, FUTURE) == '11月13日（周五）',
           'W3 E=0 时跳过不可报期次，取真的落在周六的 47 期')
        ok(next_period_date([3, 6], 1, []) == '', 'W4 无未来期次 ⇒ 空串')
        ok(next_period_date([3, 6], 1, FUTURE[:1]) == '', 'W5 未来期次全不可报 ⇒ 空串')
        ok(lock_msg_for('简爱', [3, 6], '') == '简爱 只能在每周三、六报单，本期已无可报日',
           'W6 空日期退到不带假日期的句子')
        ok(next_period_date([3, 6], 1, [{'order_end': '2026-11-14'}]) == '11月14日（周六）',
           'W7 缺 order_start ⇒ 退回 order_end（不返回空）')

        print('=== X rules_from_rows 读 order_max_early_days（缺列零误伤）===')
        ok(rules_from_rows([{'id': 9, 'scope_key': '简爱', 'order_weekdays': '3,6'}])
           ['简爱']['max_early'] == 0,
           'X1 🔴 缺键 / 缺列 ⇒ 0（老租户与 v765 逐像素同行为）')
        ok(rules_from_rows([{'id': 9, 'scope_key': '简爱', 'order_weekdays': '3,6',
                             'order_max_early_days': 1}])['简爱']['max_early'] == 1,
           'X2 读到生产简爱的值 1')
        ok(rules_from_rows([{'id': 9, 'scope_key': '简爱', 'order_weekdays': '3,6',
                             'order_max_early_days': 'abc'}])['简爱']['max_early'] == 0,
           'X3 坏值 ⇒ 0')
        ok(rules_from_rows([{'id': 9, 'scope_key': '简爱', 'order_weekdays': '3,6',
                             'order_max_early_days': 99}])['简爱']['max_early'] == MAX_EARLY_LIMIT,
           'X4 超上限 ⇒ clamp 到编排层上限')
        ok(rules_from_rows([{'id': 9, 'scope_key': '简爱', 'order_weekdays': '3,6',
                             'order_max_early_days': -3}])['简爱']['max_early'] == 0,
           'X5 负值 ⇒ 0')

        print('=== Y 生产 43 期复刻：简爱提前一天应当放行 ===')
        _cy = sqlite3.connect(db_main)
        # 夹具的 rebate_target_rules 故意没有后加列 ⇒ 同时验证「有列」租户能读到值
        _cy.execute("ALTER TABLE rebate_target_rules ADD COLUMN order_max_early_days INTEGER DEFAULT 0")
        _cy.execute("UPDATE rebate_target_rules SET order_weekdays='3,6', "
                    "order_max_early_days=1 WHERE scope_key='简爱'")
        _cy.execute("INSERT INTO forecast_periods VALUES(43,'2026-11-06','2026-11-06')")
        for _pid, _n in [(72, 3), (234, 2), (1, 1)]:
            for _ in range(_n):
                _cy.execute("INSERT INTO forecast_import_products VALUES(NULL,?,?,?,NULL)",
                            (43, '2026-11-06', _pid))
        _cy.commit()
        _cy.close()
        _y43 = bw.period_brand_windows(43)
        ok(_y43['order_end'] == '2026-11-06', 'Y1 读到 43 期截止日')
        ok(_y43['brands']['简爱']['orderable'] is True,
           'Y2 🔴🔴 简爱 43 期由「拦截」转「可报」（与编排层同款结论）')
        ok('简爱' in _y43['banner'], 'Y3 横幅把简爱列回本期可报品牌：' + _y43['banner'])
        ok(_y43['brands']['简爱']['lock_msg'] == '', 'Y4 可报品牌不得带拦截句')
        _cf = sqlite3.connect(db_main)
        _fp_empty = _future_periods(_cf, '2026-11-06')
        _cf.close()
        ok(_fp_empty == [], 'Y5 🔴 43 之后无未来期次 ⇒ 弹窗绝不给虚构日期')
        # 反证：把 E 改回 0（模拟「没读到 max_early」），43 期必须重新被拦
        _cz = sqlite3.connect(db_main)
        _cz.execute("UPDATE rebate_target_rules SET order_max_early_days=0 WHERE scope_key='简爱'")
        _cz.commit()
        _cz.close()
        _y43off = bw.period_brand_windows(43)
        ok(_y43off['brands']['简爱']['orderable'] is False,
           'Y6 🔴 反证：E=0 时 43 期仍被拦 ⇒ Y2 确系读到 E 才放行')
        ok('请在' not in _y43off['brands']['简爱']['lock_msg'],
           'Y7 被拦且无未来期次 ⇒ 不给「请在X日填报」：' + _y43off['brands']['简爱']['lock_msg'])

        print('=== Z 静态结构（AST 判调用节点，防 docstring 自撞空白支票）===')
        import ast as _ast
        _bws = open(os.path.join(REMOTE, 'domain', 'brand_order_window.py'),
                    encoding='utf-8').read()
        _tree = _ast.parse(_bws)

        def _fn(name):
            for _n in _tree.body:
                if isinstance(_n, _ast.FunctionDef) and _n.name == name:
                    return _n
            return None

        def _calls(fn):
            if fn is None:
                return set()
            return {_n.func.id for _n in _ast.walk(fn)
                    if isinstance(_n, _ast.Call) and isinstance(_n.func, _ast.Name)}

        def _str_consts(fn):
            if fn is None:
                return []
            return [_n.value for _n in _ast.walk(fn)
                    if isinstance(_n, _ast.Constant) and isinstance(_n.value, str)]

        _fjudge, _fwmap, _fprev = _fn('judge'), _fn('window_map'), _fn('preview')
        _fload, _ffp, _fpbw = _fn('load_rules'), _fn('_future_periods'), _fn('period_brand_windows')
        ok(all(x is not None for x in (_fjudge, _fwmap, _fprev, _fload, _ffp, _fpbw)),
           'Z0 AST 六个函数都定位得到（抽空集不算通过）')
        ok('window_hit' in _calls(_fjudge), 'Z1 🔴 judge 必须调用可提前窗口内核')
        ok('next_period_date' in _calls(_fjudge), 'Z2 🔴 judge 必须查真实期次')
        ok('next_order_date' not in _calls(_fjudge),
           'Z3 🔴 judge 禁止调用日历推算（会给不存在的期次日期）')
        ok('window_hit' in _calls(_fprev), 'Z4 preview 必须共用同一内核（防预览与实际分叉）')
        _jcalls = [_n for _n in _ast.walk(_fwmap)
                   if isinstance(_n, _ast.Call) and isinstance(_n.func, _ast.Name)
                   and _n.func.id == 'judge']
        ok(bool(_jcalls) and any(
            any(isinstance(_a, _ast.Name) and _a.id == 'future_periods' for _a in _c.args)
            for _c in _jcalls),
           'Z5 🔴 window_map 必须把 future_periods 作为实参传给 judge')
        ok(any('SELECT * FROM rebate_target_rules' in _s for _s in _str_consts(_fload)),
           'Z6 🔴 load_rules 用 SELECT * 按列名取（后加列缺列不炸整段）')
        ok(any('SELECT * FROM forecast_periods' in _s for _s in _str_consts(_ffp)),
           'Z7 🔴 未来期次查询同样不许硬写后加列')
        _fpsrc = _ast.get_source_segment(_bws, _ffp) or ''
        ok('oe > cur_end' in _fpsrc, 'Z8 只取当前期次之后的真实期次')
        _wmcalls = [_n for _n in _ast.walk(_fpbw)
                    if isinstance(_n, _ast.Call) and isinstance(_n.func, _ast.Name)
                    and _n.func.id == 'window_map']
        ok(bool(_wmcalls) and any(
            _c.args and isinstance(_c.args[-1], _ast.Name) and _c.args[-1].id == 'future'
            for _c in _wmcalls),
           'Z9 生产入口必须把真实期次传给 window_map')

        print('=== R 坏库 fail-safe ===')
        import importlib
        import db.connection
        os.environ['ERP_DB_PATH'] = db_bad
        importlib.reload(db.connection)
        importlib.reload(bw)
        ctxb = bw.period_brand_windows(1)
        ok(ctxb['brands'] == {}, 'R1 🔴 无 rebate_target_rules 表 ⇒ 回落全放行，不抛异常')

        os.environ['ERP_DB_PATH'] = db_norule
        importlib.reload(db.connection)
        importlib.reload(bw)
        ctxn = bw.period_brand_windows(1)
        ok(ctxn['brands'] == {}, 'R2 🔴 连期次表都没有 ⇒ 仍然全放行')

        print('=== T preview 返回体：规则行必须带 rule_id（v765e 前端「改报单日」的唯一定位依据）===')
        # 🔴 这条判据在**路由层**，domain 里没有 —— 而它一旦缺失，前端就只能拿品牌名去
        #    `rules.find()` 反查规则 id，那等于在前端重写一遍归一化（`蒙牛低温/鲜奶` vs
        #    `蒙牛低温` 不是一回事），错得毫无声响、只是点进去改错了别的品牌。
        #    所以直接读源码里那段构造式，**要求看到 `v.get("rule_id")` 这个取值**，
        #    不是只要求出现 "rule_id" 这个词（写个 `"rule_id": None` 也算"有这个词"）。
        _fp = os.path.join(REMOTE, 'routers', 'forecast.py')
        _src = open(_fp, encoding='utf-8').read() if os.path.exists(_fp) else ''
        # 🔴 锚点必须写成 `"rules": [ {` —— 本文件里还有另一处 `"rules": []}`（空列表，
        #    在另一个端点），先出现的那个会被 `search` 抓到，于是抽到空串、断言全红，
        #    看起来像"代码真错了"。加 `(?=\s*\{)` 要求后面紧跟一项。
        _m = re.search(r'"rules":\s*\[(?=\s*\{)(.*?)\]\s*,', _src, re.S)
        _body = _m.group(1) if _m else ''
        ok(bool(_body), 'T1 找得到 preview 的 rules 构造块（正则自检：抽空集不算通过）')
        ok('v.get("rule_id")' in _body,
           'T2 🔴 rules 每行带 rule_id —— 前端靠它深链到那一条，不许按品牌名反查')
        ok('products' in _body, 'T3 仍带 products（匹配 0 个商品的牌子要标红）')
        ok('weekdays_cn' in _body, 'T4 仍带 weekdays_cn（长形，与行内短标签刻意不同名）')

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print()
    if fails:
        print('\u274c 失败 %d / %d 项' % (len(fails), total))
        for f in fails:
            print('   - ' + f)
        return 1
    print('\u2713 品牌报单日判定契约全部通过（%d 项）' % total)
    return 0


# 坏样本：(说明, 相对文件, 原文, 替换成)
# 🔴 每个都必须让检查**变红**；只要有任意一个仍绿，说明对应的断言是空白支票。
SAMPLES = [
    ("提前窗口被去掉（退回只看当天星期，不读 max_early）", "domain/brand_order_window.py",
     "    if window_hit(order_end, ws, early):\n        return res",
     "    if wd in ws:\n        return res"),
    ("品牌归一化不去括号备注", "domain/brand_order_window.py",
     '    t = re.sub(r"[(（][^()（）]*[)）]", "", s)',
     '    t = s'),
    ("开关关着也照常判（总开关失效）", "domain/brand_order_window.py",
     "    if not enabled:\n        return res",
     "    if False:\n        return res"),
    ("星期偏移一位（0=周一 当成 1=周一）", "domain/brand_order_window.py",
     "return None if d is None else d.weekday() + 1",
     "return None if d is None else d.weekday()"),
    ("提示文案被改短（丢掉可报星期）", "domain/brand_order_window.py",
     'TIP_TMPL = "该商品可报单时间为每周{wd}，本期不可提报"',
     'TIP_TMPL = "该商品本期不可提报"'),
    ("期次不存在时照常下发限制（fail-safe 失效）", "domain/brand_order_window.py",
     "        if wd is None:\n            ctx[\"order_end\"] = oe",
     "        if False:\n            ctx[\"order_end\"] = oe"),
    ("横幅品牌范围退回「只列配了规则的品牌」", "domain/brand_order_window.py",
     "    all_brands = [b for b in (period_brands or []) if b]",
     "    all_brands = [b for b in (window or {}) if b]"),
    ("横幅改回按全商品档案取品牌（不认本期清单）", "domain/brand_order_window.py",
     "        rcols = {x[1] for x in conn.execute(",
     "        return [x[0] for x in conn.execute(\"SELECT DISTINCT brand FROM products WHERE is_active=1\").fetchall() if x[0]]\n        rcols = {x[1] for x in conn.execute("),
    ("空星期被当成规则（把没配的人全锁死）", "domain/brand_order_window.py",
     "        if not ws:\n            continue",
     "        if False:\n            continue"),
    ("行内短标签丢掉「每周」前缀（前端会拼成「一、四 才能报单」）", "domain/brand_order_window.py",
     '    res["weekdays_label"] = "每周" + weekdays_short(ws)',
     '    res["weekdays_label"] = weekdays_short(ws)'),
    ("preview 的规则行不带 rule_id（前端「改报单日」失去定位依据）", "routers/forecast.py",
     '"rule_id": v.get("rule_id")}',
     '"rule_id": None}'),
    # ── v779：可提前窗口 + 真实期次日期，逐条都要有牙齿 ──────────────────
    ("窗口方向写反（往前找 E 天，不是往后）", "domain/brand_order_window.py",
     "        if (d + timedelta(days=i)).isoweekday() in ws:",
     "        if (d - timedelta(days=i)).isoweekday() in ws:"),
    ("弹窗日期退回日历推算（给不存在的期次日期）", "domain/brand_order_window.py",
     "    nd = next_period_date(ws, early, future_periods)",
     "    nd = next_order_date(ws, today)"),
    ("window_map 漏传 future_periods（弹窗永远没日期）", "domain/brand_order_window.py",
     "        k: judge(k, order_end, rules, enabled, today, future_periods)",
     "        k: judge(k, order_end, rules, enabled, today)"),
    ("load_rules 硬写后加列（缺列租户整段抛错被吞成全放行）", "domain/brand_order_window.py",
     '        "SELECT * FROM rebate_target_rules "',
     '        "SELECT id, scope_key, scope_name, order_weekdays, order_max_early_days FROM rebate_target_rules "'),
    ("未来期次查询硬写后加列（弹窗静默没日期）", "domain/brand_order_window.py",
     '        cur = conn.execute("SELECT * FROM forecast_periods ORDER BY id")',
     '        cur = conn.execute("SELECT id, order_start, order_end FROM forecast_periods ORDER BY id")'),
    ("max_early 不 clamp（超出编排层上限）", "domain/brand_order_window.py",
     '            e = max(0, min(int(r.get("order_max_early_days") or 0), MAX_EARLY_LIMIT))',
     '            e = int(r.get("order_max_early_days") or 0)'),
    ("preview 不共用窗口内核（预览与实际分叉）", "domain/brand_order_window.py",
     '                "orderable": window_hit(oe, ws, r.get("max_early") or 0),',
     '                "orderable": bool(wd is not None and wd in ws),'),
    ("next_period_date 取截止日而非开放日", "domain/brand_order_window.py",
     '        d = _parse_iso(str(p.get("order_start") or "").strip() or oe)',
     '        d = _parse_iso(oe)'),
    ("_future_periods 不过滤当前期次（弹窗指回本期）", "domain/brand_order_window.py",
     "            if oe > cur_end:",
     "            if True:"),
]


def _run_check(remote):
    """用指定副本跑一次检查，返回 (rc, tail)。"""
    env = dict(os.environ)
    env['BW_REMOTE'] = remote
    p = subprocess.run([sys.executable, os.path.abspath(__file__)],
                       capture_output=True, text=True, env=env)
    tail = '\n'.join((p.stdout or '').strip().splitlines()[-3:])
    return p.returncode, tail


def self_test():
    """注入 7 种错误写法，逐一必须报红；另设一份**不改动**的对照必须全绿。"""
    print('=== 坏样本自证（注入错误 ⇒ 检查必须报红）===')
    base = tempfile.mkdtemp(prefix='bw-selftest-')
    fails = []
    try:
        pristine = os.path.join(base, 'pristine')
        shutil.copytree(REMOTE, pristine)

        rc, tail = _run_check(pristine)
        if rc != 0:
            print('  ❌ 对照组（原样）应当全绿，实际 rc=%d' % rc)
            print('     ' + tail.replace('\n', '\n     '))
            fails.append('对照组')
        else:
            print('  ✓ 对照组（原样不改）全绿')

        for i, (name, rel, old, new) in enumerate(SAMPLES, start=1):
            dst = os.path.join(base, 'bad%d' % i)
            shutil.copytree(REMOTE, dst)
            fp = os.path.join(dst, rel)
            src = open(fp, encoding='utf-8').read()
            if old not in src:
                print('  ❌ 样本%d 锚点未命中（源码可能已改，需更新样本）：%s' % (i, name))
                fails.append(name)
                continue
            open(fp, 'w', encoding='utf-8').write(src.replace(old, new, 1))
            rc2, tail2 = _run_check(dst)
            if rc2 == 0:
                print('  ❌ 样本%d 未被检出（空白支票）：%s' % (i, name))
                fails.append(name)
            else:
                print('  ✓ 样本%d 已检出：%s' % (i, name))
    finally:
        shutil.rmtree(base, ignore_errors=True)

    print()
    if fails:
        print('\u274c 自证失败 %d 项：%s' % (len(fails), '、'.join(fails)))
        return 1
    print('\u2713 坏样本自证全部生效（%d 个样本 + 1 组对照）' % len(SAMPLES))
    return 0


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        sys.exit(self_test())
    sys.exit(main())
