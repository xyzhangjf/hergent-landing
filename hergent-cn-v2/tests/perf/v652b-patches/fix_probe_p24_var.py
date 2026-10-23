import io
p = "/opt/hergent-erp/tools/v411-p24-colprefs/probe_p24.py"
s = io.open(p, encoding="utf-8").read()
old = '_ALLOWED = tuple(m.COL_PREF_PAGES) + tuple(getattr(m, "GENERIC_KV_PAGES", ()))'
new = '_ALLOWED = tuple(_ns["COL_PREF_PAGES"]) + tuple(_ns.get("GENERIC_KV_PAGES", ()))'
if s.count(old) != 1:
    raise SystemExit("锚点不唯一 count=%d" % s.count(old))
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
print("FIXED probe_p24 var name")
