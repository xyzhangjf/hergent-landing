"""迁移工具的共用底座：库路径解析 / 连接 / 结构快照。

🔴 本包**绝不 import erp_db**，这不是洁癖，是硬约束：
`erp_db` 在**模块导入期**就执行 359 条 `_safe_migrate`（会写库、会改结构）。
一个"体检"工具一旦 import 它，就从只读诊断变成了隐式迁移 —— 于是
「跑一下看看有没有漂移」本身就会改生产。所以本包全部直接用 `sqlite3`。

同理，枚举租户库也**不复用** `erp_db.list_tenant_db_ids()`（它有登记表三态逻辑、
还会顺带建库）；这里是按文件名 + 结构自证列举，并把「是否登记」作为**输出信息**
呈现给运维判断，而不是替运维过滤掉。
"""
import glob
import hashlib
import json
import os
import re
import sqlite3

_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_PKG_DIR)          # /opt/hergent-erp
PATCHES_DIR = os.path.join(_PKG_DIR, "patches")
PLATFORM_TABLES_FILE = os.path.join(_PKG_DIR, "platform_tables.txt")
LEGACY_COPIES_FILE = os.path.join(_PKG_DIR, "legacy_platform_copies.txt")

_TENANT_RE = re.compile(r"^tenant_(\d+)\.db$")


def db_dir():
    """库文件所在目录 —— 与 `db/connection.py` 同一条口径（ERP_DB_PATH 优先）。"""
    p = os.environ.get("ERP_DB_PATH")
    if p:
        return os.path.dirname(os.path.abspath(p))
    return _APP_DIR


def master_db_path():
    p = os.environ.get("ERP_DB_PATH")
    return os.path.abspath(p) if p else os.path.join(_APP_DIR, "erp.db")


def tenant_db_paths():
    """→ [(tenant_id, path)]，只含**结构上像真库**的 `tenant_<数字>.db`。

    判据只要两条：文件名严格匹配、里面有表。刻意不复制 `erp_db._tenant_db_is_real`
    那一整套校验（它还要看登记表与行数），因为体检工具的价值恰恰在于**把可疑的库也报出来**，
    而不是悄悄跳过它们（2026-09-19 的 `readonly database` 事故就是空壳库被当真租户）。
    """
    out = []
    for f in sorted(glob.glob(os.path.join(db_dir(), "tenant_*.db"))):
        m = _TENANT_RE.match(os.path.basename(f))
        if not m:
            continue
        tid = int(m.group(1))
        if tid <= 0 or not os.path.exists(f) or os.path.getsize(f) == 0:
            continue
        try:
            conn = connect_ro(f)
            try:
                if not table_names(conn):
                    continue
            finally:
                conn.close()
        except Exception:
            continue
        out.append((tid, f))
    return sorted(out)


def connect_ro(path):
    """只读连接。体检、状态查询一律走这里 —— 打不开就报错，不回落成可写。"""
    conn = sqlite3.connect("file:%s?mode=ro" % path.replace("?", "%3f"), uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def connect_rw(path):
    """可写连接，且 **isolation_level=None** —— 事务边界由调用方用显式
    BEGIN/COMMIT 控制。默认的隐式事务会在 `executescript()` 前后偷偷提交，
    迁移失败时就会留下"做了一半"的库。"""
    conn = sqlite3.connect(path, timeout=20.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=20000")
    return conn


# ---------------------------------------------------------------- 结构快照

def table_names(conn):
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def index_defs(conn):
    """→ {索引名: (表名, 建索引 SQL)}。sqlite_autoindex_* 是 UNIQUE 约束的副产物，
    没有可执行的 SQL，但**它们本身就是唯一性保证**，体检时必须算进「有没有」。"""
    d = {}
    for name, tbl, sql in conn.execute(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"):
        d[name] = (tbl, sql or "")
    return d


def columns(conn, table):
    """→ [(列名, 类型, notnull, 默认值, 是否主键)]，顺序按建表顺序。"""
    return [(r[1], (r[2] or "").upper(), int(r[3] or 0), r[4], int(r[5] or 0))
            for r in conn.execute('PRAGMA table_info("%s")' % table.replace('"', '""'))]


def snapshot(conn):
    """→ {"tables": {表: [列…]}, "indexes": {索引: (表, sql)}}。"""
    tables = {}
    for t in sorted(table_names(conn)):
        tables[t] = columns(conn, t)
    return {"tables": tables, "indexes": index_defs(conn)}


def fingerprint(snap):
    """结构指纹：**只取决于结构**，与行数、时间、顺序无关（先规范化再哈希）。

    用途：`--baseline` 时把它存进 `schema_patches`，之后 `doctor` 就能回答
    「这个库从被纳入管理的那天起，结构变过没有、变在哪」—— 这正是
    「租户库索引没下发」这类事故一直缺的那条线索。
    """
    norm = {
        "tables": sorted((t, sorted(cols)) for t, cols in snap["tables"].items()),
        "indexes": sorted((n, tbl, sql.strip()) for n, (tbl, sql) in snap["indexes"].items()),
    }
    blob = json.dumps(norm, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------- 平台表清单

def load_platform_tables():
    """主库独有的**平台级表**（租户库没有它们是设计如此，不是漂移）。

    清单是显式文件而不是代码里的集合：它是一份「业务判断」，必须能被 diff、
    被 review。缺文件时返回空集并把文件路径带进告警 —— 宁可报多余漂移，
    也不要偷偷把某些表当"正常缺失"（那会让体检从第一天起就不可信）。
    """
    return _load_list(PLATFORM_TABLES_FILE)


def load_legacy_copies():
    """本不该出现在租户库里、但历史上被 `backup()` 复制过去的平台表。

    与其把它们当"缺列/缺索引"报（每次刷 6 行噪音，真问题被淹掉），不如单独归一类：
    它们本身就是要清理的安全项，不需要比对结构。
    """
    return _load_list(LEGACY_COPIES_FILE)


def _load_list(path):
    if not os.path.exists(path):
        return set(), "缺少清单文件 %s（本次不排除任何表）" % path
    out = set()
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#"):
                out.add(s)
    return out, ""
