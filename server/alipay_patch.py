# ===== 支付宝电脑网站支付集成 =====
import os
import json
import base64
from datetime import datetime

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# Env vars for production/sandbox switching
ALIPAY_APP_ID = os.environ.get("ALIPAY_APP_ID", "2021006159610416")
ALIPAY_MODE = os.environ.get("ALIPAY_MODE", "production")  # "sandbox" or "production"
ALIPAY_GATEWAY = (
    "https://openapi-sandbox.dl.alipaydev.com/gateway.do" if ALIPAY_MODE == "sandbox"
    else os.environ.get("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do")
)
ALIPAY_NOTIFY_URL = os.environ.get("ALIPAY_NOTIFY_URL", "https://api.hergent.cn/api/payment/alipay/notify")

_ALIPAY_PRIVATE_KEY_PATH = os.environ.get(
    "ALIPAY_PRIVATE_KEY_PATH",
    os.path.expanduser("~/.hermes/certs/alipay/merchant_private_key.txt")
)
_ALIPAY_PUBLIC_KEY_PATH = os.environ.get(
    "ALIPAY_PUBLIC_KEY_PATH",
    os.path.expanduser("~/.hermes/certs/alipay/alipay_public_key.txt")
)
ALIPAY_PRIVATE_KEY = open(_ALIPAY_PRIVATE_KEY_PATH).read().strip() if os.path.exists(_ALIPAY_PRIVATE_KEY_PATH) else ""
ALIPAY_PUBLIC_KEY = open(_ALIPAY_PUBLIC_KEY_PATH).read().strip() if os.path.exists(_ALIPAY_PUBLIC_KEY_PATH) else ""
ALIPAY_ENABLED = bool(ALIPAY_APP_ID and ALIPAY_PRIVATE_KEY and ALIPAY_PUBLIC_KEY)

if not ALIPAY_ENABLED:
    print("⚠️  支付宝密钥未配置，支付降级为 DEV 模式")


def alipay_sign(data: dict) -> str:
    sorted_items = sorted((k, v) for k, v in data.items() if v and k != "sign")
    sign_str = "&".join(f"{k}={v}" for k, v in sorted_items)
    private_key = serialization.load_pem_private_key(ALIPAY_PRIVATE_KEY.encode(), password=None)
    signature = private_key.sign(sign_str.encode(), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode()


def alipay_verify_sign(params: dict, signature: str) -> bool:
    sorted_items = sorted((k, v) for k, v in params.items() if v and k != "sign")
    sign_str = "&".join(f"{k}={v}" for k, v in sorted_items)
    try:
        public_key = serialization.load_pem_public_key(ALIPAY_PUBLIC_KEY.encode())
        public_key.verify(base64.b64decode(signature), sign_str.encode(), padding.PKCS1v15(), hashes.SHA256())
        return True
    except Exception as e:
        print('[ALIPAY-VERIFY] sign_str (first 300 chars):', sign_str[:300])
        print('[ALIPAY-VERIFY] error:', str(e)[:100])
        return False


print(f"[alipay] 模块已加载 · APP_ID={ALIPAY_APP_ID} · mode={ALIPAY_MODE} · enabled={ALIPAY_ENABLED}")

import urllib.parse as _urlparse
def alipay_page_pay(order_id, amount, subject, device_id):
    """电脑网站支付：生成付款页面 URL（支持中文 product_name 转义）"""
    from datetime import datetime
    import json
    params = {
        'app_id': ALIPAY_APP_ID,
        'method': 'alipay.trade.page.pay',
        'format': 'JSON',
        'charset': 'utf-8',
        'sign_type': 'RSA2',
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'version': '1.0',
        'return_url': 'https://hergent.cn',
        'notify_url': ALIPAY_NOTIFY_URL,
        'biz_content': json.dumps({
            'out_trade_no': order_id,
            'total_amount': str(amount),
            'subject': subject,
            'body': 'device:' + device_id[:24],
            'product_code': 'FAST_INSTANT_TRADE_PAY',
        }, ensure_ascii=False),
    }
    params['sign'] = alipay_sign(params)
    # Manual URL-encode to handle Chinese characters
    body = _urlparse.urlencode(params, quote_via=_urlparse.quote)
    import httpx
    resp = httpx.post(
        ALIPAY_GATEWAY,
        content=body.encode('utf-8'),
        headers={'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'},
        follow_redirects=False,
        timeout=15
    )
    if resp.status_code in (301, 302):
        return {'success': True, 'pay_url': resp.headers.get('Location', '')}
    return {'success': False, 'error': 'HTTP ' + str(resp.status_code)}
