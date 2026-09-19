#!/usr/bin/env python3
"""验证 Hergent 后端「路由被删除 / 新增」是否真的生效 —— 生产真机判据。

用法（在生产上跑，走 ssh 送脚本，避免引号嵌套被吞）：
    HG_EXPECT_ROUTES=1144 HG_GONE_PREFIX=/api/ai-learning \
    HG_USER=mptestsp HG_PASS='Mpsup@1' \
      ssh root@47.113.224.140 'python3 -' < .workbuddy/tools/backend-route-removal-verify.py

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴🔴 本工具存在的唯一理由：**HTTP 状态码不能用来判定 Hergent 的路由是否存在。**
    踩过两次，两次都被误读成"删除没生效"：

  ① `rbac_middleware`（server/server.py:617）在**路由匹配之前**跑，按**静态前缀表**
     `_PATH_MODULE_MAP`（server.py:311）解析模块 —— **完全不看 app.routes**。
        · 未带凭证        → 401（任何 /api/* 都是！包括从来不存在的路由）
        · 命中前缀但无权限 → 403（如 _PATH_MODULE_MAP 里 `"/api/ai": "chat"`，
                             supervisor 无 chat 权限 ⇒ /api/ai-learning/* 恒 403）
        · 未命中任何前缀   → 403 MODULE_NOT_CONFIGURED（同样与路由无关）
     ⇒ 匿名/supervisor 视角下**永远看不到 404**，401/403 与路由存在性**无关**。

  ② 但「中间件放行后，不存在的路由确实 404」这条链路是通的 —— 已实测：
        GET /api/forecast/periods              → 200
        GET /api/forecast/definitely-not-real-xyz → 404 {"detail":"接口不存在：…"}
     所以判据必须**成对**：同前缀、同 token，一个存在的子路径（200 正例）
     + 一个不存在的子路径（404 负例）。缺任一侧，结论都不可信。

  ⇒ 权威判据 = `/openapi.json` 路由表（FastAPI 从 app.routes 生成，路由删了就消失）。
     它不经过业务中间件，且是本工具唯一可信的"路由存在性"来源。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

还覆盖：服务健康（能返回 openapi 即 app 起来了）、邻近接口未被波及。
服务日志另行核对（务必做，import 失败会让整个后端起不来）：
    journalctl -u hergent-erp --since '10 minutes ago' | grep -iE 'Traceback|ImportError'
"""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get('HG_BASE', 'http://127.0.0.1:8700')
EXPECT_ROUTES = os.environ.get('HG_EXPECT_ROUTES', '').strip()
GONE_PREFIX = os.environ.get('HG_GONE_PREFIX', '').strip()
USER = os.environ.get('HG_USER', '').strip()
PASSWD = os.environ.get('HG_PASS', '').strip()

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 禁用代理（nginx 可能拦 127.0.0.1）
ok = True


def chk(cond, label, detail=''):
    global ok
    ok = ok and bool(cond)
    print(('PASS  ' if cond else 'FAIL  ') + label + (('  | ' + str(detail)) if detail else ''))


def call(path, method='GET', body=None, token=None, maxlen=400):
    r = urllib.request.Request(BASE + path, method=method)
    if body is not None:
        r.data = json.dumps(body).encode()
        r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with op.open(r, timeout=20) as resp:
            return resp.status, resp.read()[:maxlen].decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:maxlen].decode('utf-8', 'ignore')
    except Exception as e:
        return -1, repr(e)


def find_token(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k.lower() in ('token', 'access_token') and isinstance(v, str) and v:
                return v
        for v in o.values():
            t = find_token(v)
            if t:
                return t
    return ''


# ── 1) 权威：openapi 路由表 ─────────────────────────────────────────────
st, body = call('/openapi.json', maxlen=2_000_000)
if st != 200:
    print(f'FAIL  取 openapi.json 失败 → {st}（服务没起来？）body={body[:200]}')
    sys.exit(1)
paths = list(json.loads(body).get('paths', {}))
print(f'路由总数: {len(paths)}' + (f'（预期 {EXPECT_ROUTES}）' if EXPECT_ROUTES else ''))
if EXPECT_ROUTES:
    chk(str(len(paths)) == EXPECT_ROUTES, f'路由总数 == {EXPECT_ROUTES}', f'实际 {len(paths)}')

if GONE_PREFIX:
    left = [p for p in paths if p.startswith(GONE_PREFIX)]
    chk(len(left) == 0, f'{GONE_PREFIX}* 已从路由表消失', f'实际剩 {left}')

print()
# ── 2) 成对对照（需凭证；没有就跳过并说明）────────────────────────────────
if USER and PASSWD:
    st, b = call('/api/auth/login', 'POST', {'username': USER, 'password': PASSWD}, maxlen=4096)
    if st != 200:
        # 🔴 登录有 5 次失败锁 30 分钟：绝不重试
        print(f'⚠️  登录失败 {st}，跳过 HTTP 对照（不重试以免锁号）')
    else:
        tok = find_token(json.loads(b))
        print(f'登录成功（{USER}），token {len(tok)} 字符\n')

        # 正例：挑一个**该角色真有权限**的模块前缀，用它验证「可达路由层」
        st_ok, _ = call('/api/forecast/periods', token=tok)
        chk(st_ok == 200, f'[正例] GET /api/forecast/periods → {st_ok}（预期 200，证明可达路由层）')

        # 负例：同前缀 + 不存在的子路径 —— 这条**证明"路由不存在 ⇒ 404"的链路成立**
        st_404, b404 = call('/api/forecast/definitely-not-real-xyz', token=tok)
        chk(st_404 == 404, f'[负例] 同前缀不存在的子路径 → {st_404}（预期 404）', b404[:110])

        # 目标路径：若被中间件按前缀拦截会是 403 —— 那是预期的，不是失败
        if GONE_PREFIX:
            st_t, bt = call(GONE_PREFIX + '/probe', token=tok)
            print(f'\n[说明] {GONE_PREFIX}/probe → {st_t}')
            if st_t in (401, 403):
                print('       这是 rbac_middleware 按静态前缀先拦（与路由是否存在无关）；')
                print('       路由是否已删以本工具第 1 节的 openapi 为准。')
            elif st_t == 404:
                print('       404 —— 中间件放行且路由确已删除。')
else:
    print('（未提供 HG_USER/HG_PASS，跳过 HTTP 对照；路由存在性以上方 openapi 为准）')

print()
print('RESULT: ' + ('ALL PASS' if ok else 'HAS FAILURE'))
sys.exit(0 if ok else 1)
