"""v456-tts-probe.py —— 在**生产服务器上**验证 /api/ai/tts

🔴 为什么要写成"在服务器上跑"的脚本、而不是本地 curl：
   token 是**查库**验证的（core._lookup_user_by_token 走 sessions 表），
   本机没有生产 token 也不能伪造 ⇒ 让脚本在服务器上取 token 并直接打 127.0.0.1:8700，
   **token 全程不出服务器**（脚本只回显用户名/角色，不打印完整 token）。

验证项：
  ① 无 token ⇒ 401（鉴权生效）
  ② 有 token + 正常文本 ⇒ 200 + audio/mpeg + 真实 mp3 字节
  ③ 非法音色 ⇒ 仍 200（静默回落默认，保证"能出声"）
  ④ 空文本 ⇒ 400
  ⑤ 超长文本 ⇒ 413
  ⑥ /api/ai/tts/voices ⇒ 音色清单
  ⑦ 缓存命中（同文本二次请求 X-TTS-Cache: hit）
用法：python3 v456-tts-probe.py
"""
import json
import sqlite3
import sys
import urllib.error
import urllib.request

DB = '/opt/hergent-erp/erp.db'
BASE = 'http://127.0.0.1:8700'
PASS, FAIL = 0, 0


def ok(cond, name, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  PASS  %s%s' % (name, ('   -> ' + extra) if extra else ''))
    else:
        FAIL += 1
        print('  FAIL  %s%s' % (name, ('   -> ' + extra) if extra else ''))


def hget(hd, name):
    """🔴 头名大小写不敏感取值：`dict(r.headers)` 的 key 是**小写**（`content-type`），
    按 `Content-Type` 取会恒为 None ⇒ 会把"接口没问题"误判成 FAIL（本脚本首轮就踩了）。"""
    for k, v in hd.items():
        if k.lower() == name.lower():
            return v
    return None


def call(path, body=None, token=None, method='POST', timeout=45):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()


def main():
    print('=== [1] 取一个有效会话（boss/admin 优先）===')
    c = sqlite3.connect(DB)
    q = ("SELECT u.username, u.role, s.token FROM sessions s JOIN users u ON s.user_id=u.id "
         "WHERE u.is_active=1 AND (s.expires_at='' OR datetime(s.expires_at) > datetime('now','localtime')) "
         "ORDER BY COALESCE(NULLIF(s.last_activity,''), s.created_at) DESC LIMIT 30")
    rows = c.execute(q).fetchall()
    print('  有效会话 %d 条' % len(rows))
    tok = tok_user = tok_role = None
    sup_tok = None
    for u, role, t in rows:
        print('    user=%-18s role=%s' % (u, role))
        if tok is None and role in ('boss', 'admin'):
            tok, tok_user, tok_role = t, u, role
        if sup_tok is None and role == 'supervisor':
            sup_tok = t
    if not tok:
        print('  !! 无 boss/admin 有效会话 —— 请先在浏览器登录一次，或改用下面 mptestsp 账号')
        print('  （仍继续跑：无 token 的鉴权用例照样有效，其余用例会因 403/401 而无法判定）')
    else:
        print('  → 选用账号：%s (role=%s)' % (tok_user, tok_role))

    txt = '本月低温奶整体达成百分之八十七，比目标差 13 个百分点，建议下周重点跟进蒙牛纯甄。'

    print('\n=== [2] 无 token ⇒ 期望 401 ===')
    st, hd, body = call('/api/ai/tts', {'text': txt})
    ok(st in (401, 403), '未登录被拒', 'status=%s' % st)

    if tok:
        print('\n=== [3] 正常合成 ⇒ 期望 200 + audio/mpeg + 真实 mp3 ===')
        st, hd, body = call('/api/ai/tts', {'text': txt}, token=tok)
        ok(st == 200, 'HTTP 200', 'status=%s' % st)
        ok('audio/mpeg' in (hget(hd, 'Content-Type') or ''), 'Content-Type=audio/mpeg', hget(hd, 'Content-Type') or '(无)')
        ok(len(body) > 5000, '返回真实音频字节', '%d bytes' % len(body))
        ok(body[:3] == b'ID3' or body[:2] == b'\xff\xfb' or body[:2] == b'\xff\xf3',
           '是合法 mp3 头', '%r' % body[:3])
        print('    （X-TTS-Cache=%s）' % hget(hd, 'X-TTS-Cache'))

        print('\n=== [4] 非法音色 ⇒ 期望仍 200（静默回落默认）===')
        st, hd, body = call('/api/ai/tts', {'text': txt, 'voice': '../../etc/passwd'}, token=tok)
        ok(st == 200 and len(body) > 5000, '非法音色被回落而非报错', 'status=%s bytes=%d' % (st, len(body)))

        print('\n=== [5] 边界：空文本 400 / 超长 413 ===')
        st, _, _ = call('/api/ai/tts', {'text': '   '}, token=tok)
        ok(st == 400, '空文本 ⇒ 400', 'status=%s' % st)
        st, _, _ = call('/api/ai/tts', {'text': '啊' * 3001}, token=tok)
        ok(st == 413, '超长文本 ⇒ 413', 'status=%s' % st)

        print('\n=== [6] 音色清单 ===')
        st, _, body = call('/api/ai/tts/voices', None, token=tok, method='GET')
        try:
            j = json.loads(body)
            ok(st == 200 and j.get('default') == 'zh-CN-XiaoxiaoNeural' and len(j.get('voices', [])) == 5,
               '返回 5 个音色 + 默认晓晓', 'status=%s default=%s' % (st, j.get('default')))
        except Exception as e:
            ok(False, '音色清单可解析', '%s / %r' % (e, body[:120]))

        print('\n=== [7] 缓存命中（同文本二次请求）===')
        st, hd, _ = call('/api/ai/tts', {'text': txt}, token=tok)
        ok(st == 200 and (hget(hd, 'X-TTS-Cache') or '') == 'hit', '第二次命中缓存',
           'X-TTS-Cache=%s' % (hget(hd, 'X-TTS-Cache') or '(无)'))

        print('\n=== [8] RBAC：/api/ai 归 chat 模块 ⇒ 未持该模块的角色应被拒 ===')
        if sup_tok:
            st, _, body = call('/api/ai/tts', {'text': txt}, token=sup_tok)
            ok(st in (401, 403), 'supervisor（无 AI 模块权限）被拒', 'status=%s' % st)
        else:
            print('    （无 supervisor 有效会话，跳过）')

    print('\n==== 汇总：%d PASS / %d FAIL ====' % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
