"""
天气代理接口：根据访问者真实 IP 定位城市，返回当前天气 + 未来几天预报。
数据源：ipinfo.io (IP→经纬度/城市，免 key) + Open-Meteo (免 key，接入 CMA 模型)。
天气属公开信息，已在 server.py 的 _PUBLIC_PATHS 放行 /api/weather，无需登录鉴权。
"""
import asyncio
import json
import time
import urllib.request

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api")

# 内存缓存：按 IP 缓存 30 分钟，避免频繁外呼
_CACHE = {}
_CACHE_TTL = 1800

# 降级默认城市（郑州，河南低温奶消费枢纽）
DEFAULT_LAT, DEFAULT_LON = 34.75, 113.62
DEFAULT_CITY = "郑州"

# WMO 天气代码 -> (中文描述, emoji)
WMO = {
    0: ("晴", "\u2600\ufe0f"),
    1: ("晴间多云", "\ud83c\udf24\ufe0f"),
    2: ("多云", "\u26c5"),
    3: ("阴", "\u2601\ufe0f"),
    45: ("雾", "\ud83c\udf32\ufe0f"),
    48: ("雾凇", "\ud83c\udf32\ufe0f"),
    51: ("毛毛雨", "\ud83c\udf27\ufe0f"),
    53: ("小雨", "\ud83c\udf27\ufe0f"),
    55: ("中雨", "\ud83c\udf27\ufe0f"),
    56: ("冻雨", "\ud83c\udf27\ufe0f"),
    57: ("冻雨", "\ud83c\udf27\ufe0f"),
    61: ("小雨", "\ud83c\udf27\ufe0f"),
    63: ("中雨", "\ud83c\udf27\ufe0f"),
    65: ("大雨", "\ud83c\udf27\ufe0f"),
    66: ("冻雨", "\ud83c\udf27\ufe0f"),
    67: ("冻雨", "\ud83c\udf27\ufe0f"),
    71: ("小雪", "\ud83c\udf28\ufe0f"),
    73: ("中雪", "\u2744\ufe0f"),
    75: ("大雪", "\u2744\ufe0f"),
    77: ("雪粒", "\u2744\ufe0f"),
    80: ("阵雨", "\ud83c\udf27\ufe0f"),
    81: ("阵雨", "\ud83c\udf27\ufe0f"),
    82: ("强阵雨", "\u26c8\ufe0f"),
    85: ("阵雪", "\ud83c\udf28\ufe0f"),
    86: ("强阵雪", "\u2744\ufe0f"),
    95: ("雷阵雨", "\u26c8\ufe0f"),
    96: ("雷阵雨伴冰雹", "\u26c8\ufe0f"),
    99: ("强雷暴", "\u26c8\ufe0f"),
}


def _http_get(url, timeout=5):
    req = urllib.request.Request(url, headers={"User-Agent": "Hergent/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _client_ip(request: Request):
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.headers.get("X-Real-IP", "")
    if xri:
        return xri.strip()
    if request.client and request.client.host:
        return request.client.host
    return ""


def _geo(ip):
    """IP -> {lat, lon, city}，失败返回 None"""
    if not ip or ip.startswith("127.") or ip in ("::1", ""):
        return None
    try:
        data = _http_get("https://ipinfo.io/%s/json" % ip, timeout=4)
        loc = data.get("loc", "")
        if "," in loc:
            lat, lon = loc.split(",", 1)
            return {
                "lat": float(lat),
                "lon": float(lon),
                "city": (data.get("city") or data.get("region") or "").strip(),
            }
    except Exception:
        return None
    return None


def _weather(lat, lon):
    url = (
        "https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
        "&current=temperature_2m,weather_code"
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code"
        "&timezone=auto&forecast_days=4" % (lat, lon)
    )
    d = _http_get(url, timeout=6)
    cur = d.get("current", {})
    daily = d.get("daily", {})
    times = daily.get("time", [])
    tmax = daily.get("temperature_2m_max", [])
    tmin = daily.get("temperature_2m_min", [])
    pop = daily.get("precipitation_probability_max", [])
    codes = daily.get("weather_code", [])
    days = []
    for i, t in enumerate(times):
        days.append({
            "date": t,
            "tmax": tmax[i] if i < len(tmax) else None,
            "tmin": tmin[i] if i < len(tmin) else None,
            "pop": pop[i] if i < len(pop) else None,
            "code": codes[i] if i < len(codes) else None,
        })
    return {"temp": cur.get("temperature_2m"), "code": cur.get("weather_code"), "days": days}


@router.get("/weather")
async def weather(request: Request):
    ip = _client_ip(request)
    cache_key = ip or "default"
    now = time.time()
    if cache_key in _CACHE and now - _CACHE[cache_key][0] < _CACHE_TTL:
        return _CACHE[cache_key][1]

    geo = await asyncio.to_thread(_geo, ip)
    lat, lon, city = DEFAULT_LAT, DEFAULT_LON, DEFAULT_CITY
    if geo:
        lat, lon = geo["lat"], geo["lon"]
        city = geo["city"] or DEFAULT_CITY

    try:
        w = await asyncio.to_thread(_weather, lat, lon)
    except Exception:
        w = {"temp": None, "code": None, "days": []}

    resp = {
        "success": True,
        "city": city,
        "temp": w["temp"],
        "code": w["code"],
        "days": w["days"],
        "loc_source": "ip" if geo else "default",
    }
    _CACHE[cache_key] = (now, resp)
    return resp
