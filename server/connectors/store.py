# server/connectors/store.py — 加密凭据存储（fail-closed）
#
# 凭据绝不明文落盘：用 Fernet(AES) 加密后存为 JSON 文件。
# 密钥来源（优先级）：CONNECTOR_SECRET > ADMIN_SECRET > ERP_SECRET。
# 三者皆空则直接抛错（fail-closed），符合既有 ERP_SECRET 安全铁律。
import os
import json
import base64
import hashlib
import threading
from cryptography.fernet import Fernet

_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "connectors_store.json")
_lock = threading.Lock()
_cipher = None


def _get_cipher():
    global _cipher
    if _cipher is not None:
        return _cipher
    key = (
        os.environ.get("CONNECTOR_SECRET")
        or os.environ.get("ADMIN_SECRET")
        or os.environ.get("ERP_SECRET")
        or ""
    )
    if not key:
        raise RuntimeError(
            "凭据加密密钥未配置：请设置 CONNECTOR_SECRET / ADMIN_SECRET / ERP_SECRET 之一"
        )
    raw = hashlib.sha256(key.encode("utf-8")).digest()
    _cipher = Fernet(base64.urlsafe_b64encode(raw))
    return _cipher


def save_credentials(service_id: str, cfg: dict) -> None:
    """加密保存某连接器的凭据。"""
    c = _get_cipher()
    blob = c.encrypt(json.dumps(cfg, ensure_ascii=False).encode("utf-8")).decode("utf-8")
    with _lock:
        data = _read_store()
        data[service_id] = blob
        _write_store(data)


def load_credentials(service_id: str) -> dict:
    """读取并解密某连接器的凭据；不存在返回 None。"""
    with _lock:
        data = _read_store()
        blob = data.get(service_id)
    if not blob:
        return None
    c = _get_cipher()
    return json.loads(c.decrypt(blob.encode("utf-8")).decode("utf-8"))


def delete_credentials(service_id: str) -> None:
    with _lock:
        data = _read_store()
        data.pop(service_id, None)
        _write_store(data)


def _read_store() -> dict:
    try:
        with open(_STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_store(data: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(_STORE_PATH)), exist_ok=True)
    tmp = _STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _STORE_PATH)
