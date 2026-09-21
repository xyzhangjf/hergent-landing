#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226 编号纠正：把**本轮术语统一**自己写的 `v224` 引用改成 `v226`。

为什么要改（本工作区特有风险）：
    `v224` 已被**并发会话**占用两处（后端 `feat(v224): 一店一期一单 + 原位替换`、
    前端仓库 `feat(v224): 小程序提交后反馈改造`），`v225` 也被占用（企微推送日志）。
    若我的术语改动继续自称 v224，同一个文件里就会出现**两个含义不同的 v224**
    （例如 `routers/forecast_submissions.py` 里既有「一店一期一单」的 v224、
    又有「两列合一」的 v224）⇒ 后人无法据编号追溯。

判据：**只改带「进价/厂价/两列」语境的那些行**，逐行按行号精确定位（行号取自
刚跑过的 Grep，单次读盘、单次写盘 ⇒ 不存在行漂移）。
"""
import io
import os

TARGETS = [
    # (绝对路径, [(行号, 期望片段)])  —— 期望片段用于自检，防行号错位改错行
    ("/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py", [
        (77, "界面与模板统一叫"),
        (99, "降级为**历史列**"),
        (145, "与 products 同一条口径"),
        (204, "对外叫「进价」"),
        (255, "本表是舟谱导出格式的适配器"),
        (285, "同时认「进价」与「厂价」两个列名"),
        (1569, "两列**合成一列"),
        (1790, "本列已改名"),
        (1864, "列名由「厂价」改为「进价」"),
    ]),
    ("/Users/zhangjunfeng/Documents/hergent-erp/server/db/queries/products.py", [
        (226, "v224 起界面统一叫"),
    ]),
    ("/Users/zhangjunfeng/Documents/hergent-erp/server/db/queries/prices.py", [
        (47, "v224 起界面只叫"),
    ]),
    ("/Users/zhangjunfeng/Documents/hergent-erp/server/routers/forecast.py", [
        (487, "v224 起界面统一叫"),
        (566, "v224 起界面统一叫"),
    ]),
    ("/Users/zhangjunfeng/Documents/hergent-erp/server/routers/forecast_submissions.py", [
        (260, "视为同一列"),
    ]),
    ("/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue", [
        (3008, "v224 界面只叫"),
        (3383, "v224 起两列合一"),
        (3500, "v224 起它已不单独成列"),
    ]),
    ("/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/ProductArchive.vue", [
        (81, "此处原有**两列**"),
        (92, "v165/v224"),
        (174, "原来这里有**两个**进价输入框"),
        (249, "只留一个「进价」输入框"),
        (433, "v224 起界面统一叫"),
        (434, "v224 起界面**只叫"),
        (1001, "此处原为 `purchase_price"),
        (1100, "原有两个中文键都叫"),
    ]),
]


def main():
    total = 0
    for path, rows in TARGETS:
        with io.open(path, encoding="utf-8") as f:
            lines = f.readlines()
        n = 0
        for ln, must in rows:
            idx = ln - 1
            if idx >= len(lines):
                print("  ✗ %s:%d 越界" % (os.path.basename(path), ln))
                continue
            raw = lines[idx]
            if must not in raw:
                print("  ✗ %s:%d 期望片段未命中（行漂移？）: %r" % (
                    os.path.basename(path), ln, must))
                continue
            if "v224" not in raw:
                print("  · %s:%d 已无 v224（幂等跳过）" % (os.path.basename(path), ln))
                continue
            lines[idx] = raw.replace("v224", "v226")
            n += raw.count("v224")
        if n:
            with io.open(path, "w", encoding="utf-8") as f:
                f.writelines(lines)
        total += n
        print("  %-26s 改 %d 处" % (os.path.basename(path), n))
    print("\n合计 %d 处 v224 → v226" % total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
