#!/usr/bin/env python3
"""
激活码生成器
用法: python3 gen_activation_code.py [数量] [--prefix HM]
生成 HM-XXXX-XXXX 格式激活码，与 server.py 使用相同密钥
"""
import hmac
import hashlib
import time
import uuid
import sys

SECRET_KEY = b'hermes-fmcg-2026-secret-key'

def generate_code(prefix: str = "HM") -> str:
    """生成一个激活码"""
    seed = f'{time.time_ns()}-{uuid.uuid4()}'
    sig = hmac.new(SECRET_KEY, seed.encode(), hashlib.sha256).hexdigest()[:8].upper()
    parts = [sig[i:i+4] for i in range(0, 8, 4)]
    return f'{prefix}-{parts[0]}-{parts[1]}'

if __name__ == '__main__':
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    prefix = "HM"
    for i in range(count):
        code = generate_code(prefix)
        print(f'{i+1}. {code}')
