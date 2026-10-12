# v479 前端生产真机探针（只读）：证明 v479 已上线 hergent.cn
# 判据 = 中文字面量计数（构建压缩只改标识符，字符串字面量保留）
import re, sys, urllib.request

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(url):
    with _OPENER.open(urllib.request.Request(url), timeout=30) as r:
        return r.read().decode("utf-8", "replace")


base = "https://hergent.cn"
idx = get(base + "/")
m = re.findall(r"index-([A-Za-z0-9_-]+)\.js", idx)
print("线上 index.html 引用:", sorted(set(m)))
assert "CY7aIf5Y" in m, "🔴 线上 index 未切到 v479 构建产物"

idx_js = get(base + "/assets/index-CY7aIf5Y.js")
settings_name = re.findall(r"Settings-([A-Za-z0-9_-]+)\.js", idx_js)
print("index chunk import 的 Settings chunk:", sorted(set(settings_name)))

st = get(base + "/assets/Settings-BDEUOdXW.js")

DISCRIMINATORS = [
    "还没有权限变更记录。在这页改权限、给员工换角色后，记录会出现在这里。",
    "没有符合筛选条件的记录。",
    "操作类型",
    "变更内容",
    "plog-f-type",
]
fails = 0
for s in DISCRIMINATORS:
    c_local = st.count(s)
    c = 1 if c_local else 0
    status = "PASS" if c else "FAIL"
    if not c:
        fails += 1
    print("%s Settings chunk 含判别串: %s" % (status, s[:40]))

# 弹窗宽度判别（plog 弹窗 class 会带 min(1040px...) 的压缩后形式不可靠，改用 class 名）
print("\nVERDICT %d/%d" % (len(DISCRIMINATORS) - fails, len(DISCRIMINATORS)))
sys.exit(1 if fails else 0)
