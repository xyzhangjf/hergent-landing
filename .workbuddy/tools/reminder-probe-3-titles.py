#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读：按标题归类统计 message_center 历史，对比「带时间窗」与「不带时间窗」任务的存活率。"""
import sqlite3

conn = sqlite3.connect('file:/opt/hergent-erp/tenant_1.db?mode=ro', uri=True)
conn.row_factory = sqlite3.Row


def show(sql, args=(), label=''):
    print('--- %s ---' % label)
    try:
        for r in conn.execute(sql, args).fetchall():
            print('   ', dict(r))
    except Exception as e:
        print('    ERR', e)


# 最近 30 天，按标题归类
show("""SELECT
      CASE
        WHEN title LIKE '%催单%' OR title LIKE '%报单%' OR title LIKE '%预报%' THEN '报单催单(带时间窗 9/16点)'
        WHEN title LIKE '%经营洞察%' THEN '今日经营洞察(带时间窗 7:30)'
        WHEN title LIKE '%定时任务%' THEN '用户定时任务(cron表驱动)'
        WHEN title LIKE '%库存%' THEN '库存预警(纯间隔 30min)'
        WHEN title LIKE '%应收%' OR title LIKE '%逾期%' THEN '应收逾期(纯间隔 60min)'
        WHEN title LIKE '%经营要务%' OR title LIKE '%经营日志%' THEN '经营要务/日志'
        WHEN title LIKE '%期次%' OR title LIKE '%清单%' OR title LIKE '%商品%' THEN '期次/清单类(v282等)'
        ELSE '其他: ' || substr(title,1,16)
      END AS 类别,
      COUNT(*) AS 条数,
      MIN(created_at) AS 最早,
      MAX(created_at) AS 最近
    FROM message_center
    WHERE created_at >= datetime('now','localtime','-30 days')
    GROUP BY 类别 ORDER BY 最近 DESC""", (), '近30天 通知标题分布')

# 近 14 天逐日：报单催单 vs 库存预警
show("""SELECT date(created_at) AS 日期,
         SUM(CASE WHEN title LIKE '%催单%' OR title LIKE '%报单%' THEN 1 ELSE 0 END) AS 催单,
         SUM(CASE WHEN title LIKE '%库存%' THEN 1 ELSE 0 END) AS 库存预警,
         SUM(CASE WHEN title LIKE '%应收%' OR title LIKE '%逾期%' THEN 1 ELSE 0 END) AS 应收,
         SUM(CASE WHEN title LIKE '%经营洞察%' THEN 1 ELSE 0 END) AS 洞察,
         COUNT(*) AS 当日总数
       FROM message_center
       WHERE created_at >= datetime('now','localtime','-14 days')
       GROUP BY 日期 ORDER BY 日期 DESC""", (), '近14天 逐日对比')

# 历史上有没有出现过报单催单
show("SELECT COUNT(*) AS 历史上催单类通知总数 FROM message_center WHERE title LIKE '%催单%'", (), '历史催单总数')

conn.close()
