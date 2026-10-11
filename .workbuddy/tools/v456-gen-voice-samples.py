"""v456 试听样本生成（带超时 + 重试，避免单次网络波动卡死整批）"""
import asyncio, os, sys
import edge_tts

OUT = "/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v456-voice"
TXT = ("本月低温奶整体达成 87%，比目标差 13 个百分点。"
       "主要缺口在蒙牛纯甄和特仑苏两个单品，东津门店拖累了约 1.2 万元。"
       "建议下周重点跟进这两个单品的铺货。")

VOICES = [
    ("zh-CN-XiaoxiaoNeural", "1-晓晓-女-亲和"),
    ("zh-CN-XiaoyiNeural",   "2-晓伊-女-活泼"),
    ("zh-CN-YunxiNeural",    "3-云希-男-年轻"),
    ("zh-CN-YunjianNeural",  "4-云健-男-浑厚"),
    ("zh-CN-YunyangNeural",  "5-云扬-男-播报"),
]


async def one(voice, name):
    path = os.path.join(OUT, f"edge-{name}.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        print(f"SKIP {name}（已存在 {os.path.getsize(path)}）")
        return True
    for attempt in range(3):
        try:
            c = edge_tts.Communicate(TXT, voice)
            await asyncio.wait_for(c.save(path), timeout=40)
            if os.path.getsize(path) > 1000:
                print(f"OK   {name}  {os.path.getsize(path)} bytes")
                return True
        except Exception as e:
            print(f"     retry{attempt + 1} {name}: {type(e).__name__}: {e}")
            await asyncio.sleep(2)
    print(f"FAIL {name}")
    return False


async def main():
    os.makedirs(OUT, exist_ok=True)
    ok = 0
    for v, n in VOICES:
        if await one(v, n):
            ok += 1
    print(f"---- {ok}/{len(VOICES)} ----")
    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        print(f"  {f}  {os.path.getsize(p)}")


asyncio.run(main())
