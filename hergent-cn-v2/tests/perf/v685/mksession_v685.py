# -*- coding: utf-8 -*-
"""v685：为真机探针开一条 boss 临时会话（真实 tenant_1），跑完由 probe 侧删。

用法：python3 mksession_v685.py new | del <token>
"""
import datetime
import sqlite3
import sys

ERP = "/opt/hergent-erp/erp.db"


def main():
    act = sys.argv[1] if len(sys.argv) > 1 else "new"
    c = sqlite3.connect(ERP)
    if act == "del":
        c.execute("delete from sessions where token=?", (sys.argv[2],))
        c.commit()
        print("deleted", sys.argv[2])
        c.close()
        return
    u = c.execute("select id, username, role from users where role in ('boss','admin') "
                  "order by id limit 1").fetchone()
    tok = "v685probe-%d" % int(datetime.datetime.now().timestamp())
    now = datetime.datetime.now()
    c.execute("insert into sessions (token,user_id,created_at,expires_at) values (?,?,?,?)",
              (tok, u[0], now.strftime("%Y-%m-%d %H:%M:%S"),
               (now + datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")))
    c.commit()
    c.close()
    print(tok)


main()
