"""
auth.py — 用户认证模块
- 手机号 + 短信验证码登录
- 微信扫码登录
- JWT Session 管理
"""

import os
import time
import random
import hashlib
import hmac
import base64
from datetime import datetime, timedelta
from urllib.parse import urlencode

# ============================================================
# 配置
# ============================================================

BASE_URL = os.environ.get("HERMES_BASE_URL", "https://api.hergent.io")
JWT_SECRET = os.environ.get("HERMES_JWT_SECRET", "")
if not JWT_SECRET:
    import secrets
    JWT_SECRET = secrets.token_hex(32)
    print(f"⚠️  HERMES_JWT_SECRET 未设置，已生成随机密钥。服务重启后所有 session 将失效。")

# 短信配置
SMS_MODE = os.environ.get("HERMES_SMS_MODE", "")  # tencent | 空=未配置
SMS_PROVIDER = None  # 延迟初始化

# 微信配置（需要 微信开放平台 账号）
WECHAT_APP_ID = os.environ.get("WECHAT_APP_ID", "")
WECHAT_APP_SECRET = os.environ.get("WECHAT_APP_SECRET", "")

# 验证码有效期（秒）
CODE_TTL = 300  # 5分钟
CODE_LENGTH = 6

# ============================================================
# 短信发送
# ============================================================

def send_sms(phone: str, code: str) -> bool:
    """
    发送短信验证码。生产环境走腾讯云。
    """
    if not SMS_MODE:
        raise RuntimeError("SMS 未配置：请设置 HERMES_SMS_MODE=tencent 并配置腾讯云密钥")

    if SMS_MODE == "tencent":
        try:
            from tencentcloud.common import credential
            from tencentcloud.sms.v20210111 import sms_client, models

            cred = credential.Credential(
                os.environ["TENCENT_SECRET_ID"],
                os.environ["TENCENT_SECRET_KEY"])
            client = sms_client.SmsClient(cred, "ap-guangzhou")

            req = models.SendSmsRequest()
            req.SmsSdkAppId = os.environ["TENCENT_SMS_APP_ID"]
            req.SignName = os.environ.get("TENCENT_SMS_SIGN", "Hergent")
            req.TemplateId = os.environ["TENCENT_SMS_TEMPLATE_ID"]
            req.TemplateParamSet = [code, str(CODE_TTL // 60)]
            req.PhoneNumberSet = [f"+86{phone}"]

            resp = client.SendSms(req)
            return resp.SendStatusSet[0].Code == "Ok"
        except ImportError:
            print("⚠️ tencentcloud-sdk-python 未安装，请 pip install tencentcloud-sdk-python")
            return False
        except Exception as e:
            print(f"⚠️ 短信发送失败: {e}")
            return False

    raise RuntimeError(f"未知的 SMS_MODE: {SMS_MODE}，请设置为 tencent")

# ============================================================
# JWT
# ============================================================

def make_jwt(payload: dict, expires_in: int = 86400 * 30) -> str:
    """生成 JWT token（30天有效期）"""
    header = base64.urlsafe_b64encode(
        '{"alg":"HS256","typ":"JWT"}'.encode()).decode().rstrip("=")

    pay = dict(payload)
    pay["exp"] = int(time.time()) + expires_in
    pay["iat"] = int(time.time())
    body = base64.urlsafe_b64encode(
        __import__("json").dumps(pay).encode()).decode().rstrip("=")

    sig = hmac.new(
        JWT_SECRET.encode(),
        f"{header}.{body}".encode(),
        hashlib.sha256
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode().rstrip("=")

    return f"{header}.{body}.{sig_b64}"

def verify_jwt(token: str) -> dict | None:
    """验证 JWT token，返回 payload 或 None"""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header, body, sig = parts
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")

        if sig != expected_sig:
            return None

        # 补 padding 后解码
        body_padded = body + "=" * (4 - len(body) % 4)
        payload = __import__("json").loads(base64.urlsafe_b64decode(body_padded))

        if payload.get("exp", 0) < time.time():
            return None

        return payload
    except Exception:
        return None

# ============================================================
# 微信 OAuth
# ============================================================

def get_wechat_login_url() -> str:
    """生成微信扫码登录 URL"""
    if not WECHAT_APP_ID:
        return ""
    params = {
        "appid": WECHAT_APP_ID,
        "redirect_uri": f"{BASE_URL}/api/auth/wechat/callback",
        "response_type": "code",
        "scope": "snsapi_login",
        "state": hashlib.md5(str(time.time()).encode()).hexdigest()[:10],
    }
    return f"https://open.weixin.qq.com/connect/qrconnect?{urlencode(params)}#wechat_redirect"

def get_wechat_user_info(code: str) -> dict | None:
    """用 code 换取微信用户信息"""
    if not WECHAT_APP_ID or not WECHAT_APP_SECRET:
        return None
    import httpx
    try:
        # Step 1: code → access_token
        token_url = "https://api.weixin.qq.com/sns/oauth2/access_token"
        params = {
            "appid": WECHAT_APP_ID,
            "secret": WECHAT_APP_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        }
        resp = httpx.get(token_url, params=params)
        token_data = resp.json()
        if "errcode" in token_data:
            print(f"⚠️ 微信 token 获取失败: {token_data}")
            return None

        # Step 2: access_token → userinfo
        info_url = "https://api.weixin.qq.com/sns/userinfo"
        params = {
            "access_token": token_data["access_token"],
            "openid": token_data["openid"],
        }
        resp = httpx.get(info_url, params=params)
        user_data = resp.json()
        if "errcode" in user_data:
            return None

        return {
            "openid": user_data["openid"],
            "nickname": user_data.get("nickname", ""),
            "avatar": user_data.get("headimgurl", ""),
        }
    except Exception as e:
        print(f"⚠️ 微信登录异常: {e}")
        return None

# ============================================================
# 验证码管理（内存存储，重启丢失；VPS 上线后改 Redis）
# ============================================================

_codes = {}  # {phone: {"code": "123456", "expires_at": 1234567890}}

def store_code(phone: str) -> str:
    """生成并存储验证码"""
    code = str(random.randint(100000, 999999))
    _codes[phone] = {
        "code": code,
        "expires_at": time.time() + CODE_TTL,
    }
    return code

def verify_code(phone: str, code: str) -> bool:
    """验证短信码是否正确"""
    entry = _codes.get(phone)
    if not entry:
        return False
    if time.time() > entry["expires_at"]:
        del _codes[phone]
        return False
    if entry["code"] != code:
        return False
    # 验证成功，删除验证码
    del _codes[phone]
    return True
