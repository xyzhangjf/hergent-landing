#!/usr/bin/env python3
"""v335 校验探针：跨租户数据面（/tmp 收口）—— 证明「探测面变宽」+「自愈真生效」。

在【生产】上以 root 跑（只读；不改任何文件）：
    python3 /tmp/v335-permgate-probe.py            探测（自愈前）
    python3 /tmp/v335-permgate-probe.py --healed   复测（自愈后，期望全 0）

判据：三套口径互相印证
    A 旧口径（复刻改动前逻辑：/tmp 里名字含 tenant 的数据文件） —— 自愈前应 = 1
    B 新口径（待上线的 .new-llm_health_monitor 检查 6 的 /tmp 部分）
    C 独立口径（不依赖被测模块，直接 os.listdir + o 位）  —— 用来校正 B
"""
import importlib.util
import os
import sys

EXTS = (".db", ".sqlite", ".sqlite3", ".bak", ".csv", ".xlsx", ".xls", ".zip", ".tar.gz")
STAGED = "/opt/hergent-erp/scripts/llm_health_monitor.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def old_tmp_scan():
    """A 旧口径：只查名字含 tenant 的 /tmp 数据文件（复刻改动前逻辑）。"""
    bad = []
    for name in os.listdir("/tmp"):
        if "tenant" in name and name.endswith(EXTS):
            p = os.path.join("/tmp", name)
            if os.path.isfile(p) and (os.stat(p).st_mode & 0o004):
                bad.append(p)
    return bad


def independent_scan():
    """C 独立口径：/tmp 与其 hergent-* 子目录里，数据类且任何用户可读的文件。"""
    hits = []
    dirs = ["/tmp"]
    for name in os.listdir("/tmp"):
        p = os.path.join("/tmp", name)
        if name.startswith("hergent-") and os.path.isdir(p):
            dirs.append(p)
    for d in dirs:
        for name in os.listdir(d):
            if not name.endswith(EXTS):
                continue
            p = os.path.join(d, name)
            if os.path.isfile(p) and (os.stat(p).st_mode & 0o004):
                hits.append((os.stat(p).st_mode & 0o777, os.path.getsize(p), p))
    return hits


def main():
    healed = "--healed" in sys.argv

    print("== A 旧口径（改动前：名字含 tenant） ==")
    a = old_tmp_scan()
    print("   命中 %d 个" % len(a))
    for p in a[:5]:
        print("   - " + p)

    print("== B 新口径（待上线版本 检查6 的 /tmp 部分） ==")
    m = load(STAGED, "newmon")
    lvl, reason, detail = m.check_tenant_data_surface()
    print("   level=%s  reason=%s" % (lvl, reason))
    for s in (detail.get("samples") or [])[:5]:
        print("   - " + s)
    b_cnt = detail.get("count")

    print("== C 独立口径（不依赖被测模块） ==")
    c = independent_scan()
    print("   命中 %d 个" % len(c))
    for mode, size, p in c[:5]:
        print("   - %s %9d %s" % (oct(mode), size, p))

    print("== D 平台共享库（反向判据：不能被收得过头） ==")
    p = "/opt/hergent-erp/bid_radar.db"
    if os.path.isfile(p):
        st = os.stat(p)
        import grp
        try:
            gname = grp.getgrgid(st.st_gid).gr_name
        except KeyError:
            gname = str(st.st_gid)
        print("   %s mode=%s group=%s 组读位=%s"
              % (p, oct(st.st_mode & 0o777), gname, bool(st.st_mode & 0o040)))
    else:
        print("   (不存在，跳过)")

    print("== 结论 ==")
    print("   自愈前期望：A=1（告警那一条）；B/C 应显著大于 A（证明探测面变宽）")
    print("   自愈后期望：A=B=C=0 且反向判据仍为 True")
    if healed:
        ok = (len(a) == 0 and b_cnt == 0 and len(c) == 0)
        print("   本次复测：%s" % ("PASS ✅" if ok else "FAIL ❌"))
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
