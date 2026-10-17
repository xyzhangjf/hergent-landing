#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Forecast.vue 拆分护栏探针（回归基线 + 零回归校验）

背景：Forecast.vue 是 13800 行的「上帝组件」（模板 2850 + script 9800 + style 1145，
600+ 顶层声明、82 个 API 方法、446KB 主 chunk）。拆分是高危操作，必须先立基线。

原理：拆分是「移动」代码，不是「删除」代码。所以用三类锚点锁定功能，
拆分后任何锚点在全库消失 = 拆坏了（删了功能/漏了接线）。

三类锚点：
  1) API 锚点（自动扫，~82 个）：forecastApi.X / auditApi.X / productsApi.X 等调用点，全库计数
  2) 核心函数白名单（手工精选 ~40 个跨功能域代表函数）：全库必须仍存在
  3) 构建通过（可选 --build）

用法：
  python3 forecast-split-guard.py baseline            # 拆分前跑一次，生成基线 JSON
  python3 forecast-split-guard.py verify              # 每次拆分后跑，对比基线（fail = 丢功能）
  python3 forecast-split-guard.py verify --build      # 额外跑 vite build 验证编译通过
"""

import json
import os
import re
import subprocess
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
# 脚本在 hergent-cn-v2/.workbuddy/tools/，src 在 ../../src
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'src'))
BASELINE_FILE = os.path.join(HERE, 'forecast-split-baseline.json')

# 1) API 锚点：这些接口的调用点一个都不能少
API_RE = re.compile(
    r'\b(forecastApi|auditApi|forecastApproveApi|importApi|productsApi|'
    r'forecastRecipeApi|columnSchemeApi|forecastColumnsApi|productTargetsApi)'
    r'\.([a-zA-Z_]\w*)'
)

# 2) 核心函数白名单：跨功能域代表函数（拆分后全库必须仍存在）
CORE_FUNCTIONS = [
    # 期次
    'loadPeriods', 'createPeriod', 'loadCross', 'seedFromPrev', 'copyPeriod',
    # 编辑网格
    'commitCell', 'saveEdits', 'loadEditGrid', 'enterEdit', 'leaveEdit',
    # 撤销/重做
    'undo', 'redo', 'snapshot', 'pushCellSnap', 'pushBatchSnap',
    # 导出
    'exportXlsx', 'exportAllXlsx', 'buildXlsx', 'zhoupuGen',
    # 审核/建议
    'openAudit', 'doAdopt', 'runAudit', 'genSuggestions', 'computeSuggestion',
    # 列设置
    'loadCols', 'toggleCol', 'startResize', 'addMasterCol', 'deleteMasterCol',
    # 筛选/排序
    'rowVisible', 'applySort', 'passColFilter', 'applyHdrFilter',
    # 价格口径（跨域铁律：金额唯一源）
    'factoryPrice', 'perCase', 'boxesOf', 'rowBoxes', 'displayPrice',
    # 最终下单唯一口径（v188 铁律）
    'rowFinalQty', 'rowExtraQty',
    # 草稿
    'saveDraftNow', 'loadDraft', 'clearDraft',
    # 校验
    'validateAll', 'pushErr', 'showCellErr', 'gotoErr',
    # 单元格导航/选区
    'onGridKey', 'selectCell', 'onCellDown', 'onCellOver', 'onCellUp',
    # 导入
    'doImport', 'onImportFile', 'downloadFcTemplate',
    # 右键菜单
    'openCtx', 'ctxCopy', 'ctxPaste', 'ctxInsertRow', 'ctxDeleteRow',
    'ctxInsertCol', 'ctxDeleteCol', 'ctxSelectAll',
    # 期次操作
    'confirmDelete', 'confirmClose', 'onHistoryReopen', 'onHistoryVoid',
    # 返利冲刺
    'loadRebatePush', 'rebateSprint',
    # 目标分配
    'openAlloc', 'applyAlloc', 'runAllocPreview',
    # 打印/推送
    'printGrid', 'pushForecast',
]


def _read_all_sources():
    """读全库源码（.vue/.js），返回 {文件路径: 文本}"""
    files = {}
    for ext in ('*.vue', '*.js'):
        for f in glob.glob(os.path.join(SRC, '**', ext), recursive=True):
            try:
                files[f] = open(f, encoding='utf-8').read()
            except Exception:
                pass
    return files


def scan_api_anchors(files):
    """API 锚点：{ 'forecastApi.periods': 全库出现次数 }
       ⚠️ v560 教训：这里**不剥注释** —— 注释里引用 `xxxApi.method` 同样计入。
          ⇒ 写子组件头注释时**不要写完整的 `xxxApi.method`**，只写方法名，
            否则会被当成多出来的一次调用，护栏误报「重复/遗漏调用」。
          （曾尝试剥 /* */ 块注释，但基线是旧口径录的，改口径会让基线失效 ⇒ 已回滚。）"""
    anchors = {}
    for f, txt in files.items():
        for m in API_RE.finditer(txt):
            key = f'{m.group(1)}.{m.group(2)}'
            anchors[key] = anchors.get(key, 0) + 1
    return anchors


def scan_core_functions(files):
    """核心函数白名单：{ 函数名: 全库出现的文件数 }"""
    present = {}
    for f, txt in files.items():
        for fn in CORE_FUNCTIONS:
            # 以标识符边界匹配（避免 rowBoxes 命中 rowBoxesOf 之类——精确词边界）
            if re.search(rf'(?<![A-Za-z0-9_]){re.escape(fn)}(?![A-Za-z0-9_])', txt):
                present[fn] = present.get(fn, 0) + 1
    return present


def make_baseline():
    files = _read_all_sources()
    api = scan_api_anchors(files)
    core = scan_core_functions(files)
    baseline = {
        'api_anchors': api,
        'core_functions': core,
        'total_files': len(files),
        'source_note': '全库 .vue/.js 扫描，拆分前 HEAD 基线',
    }
    with open(BASELINE_FILE, 'w', encoding='utf-8') as fp:
        json.dump(baseline, fp, ensure_ascii=False, indent=2)
    print(f'✅ 基线已生成：{BASELINE_FILE}')
    print(f'   源码文件数：{len(files)}')
    print(f'   API 锚点数：{len(api)}')
    print(f'   核心函数数：{len(core)}（白名单 {len(CORE_FUNCTIONS)} 个）')
    return baseline


def verify(build=False):
    if not os.path.exists(BASELINE_FILE):
        print('❌ 未找到基线文件，请先运行：python3 forecast-split-guard.py baseline')
        sys.exit(2)
    base = json.load(open(BASELINE_FILE, encoding='utf-8'))
    files = _read_all_sources()
    api = scan_api_anchors(files)
    core = scan_core_functions(files)

    # diff API 锚点
    api_lost = []
    api_changed = []
    for k, v in base['api_anchors'].items():
        now = api.get(k, 0)
        if now == 0:
            api_lost.append(k)
        elif now != v:
            api_changed.append((k, v, now))
    api_added = [k for k in api if k not in base['api_anchors']]

    # diff 核心函数
    core_lost = [fn for fn in CORE_FUNCTIONS if core.get(fn, 0) == 0]

    # 构建（可选）
    build_ok = None
    build_out = ''
    if build:
        r = subprocess.run(
            ['npx', 'vite', 'build', '--outDir', 'dist-guard-check'],
            cwd=os.path.normpath(os.path.join(HERE, '..', '..')),
            capture_output=True, text=True, timeout=180,
        )
        build_ok = (r.returncode == 0)
        build_out = (r.stdout + r.stderr)[-1500:]

    # 报告
    ok = True
    print('=' * 60)
    print('Forecast 拆分护栏校验结果')
    print('=' * 60)
    print(f'源码文件数：{len(files)}（基线 {base["total_files"]}）')
    print(f'API 锚点：当前 {len(api)} 个，基线 {len(base["api_anchors"])} 个')
    if api_lost:
        ok = False
        print(f'🔴 丢失 API 锚点 {len(api_lost)} 个（= 删了功能！）：')
        for k in api_lost:
            print(f'   - {k}')
    if api_changed:
        ok = False
        print(f'🔴 API 锚点计数变化 {len(api_changed)} 个（= 重复/遗漏调用！）：')
        for k, old, new in api_changed:
            print(f'   - {k}: 基线 {old} → 现在 {new}')
    if api_added:
        print(f'🟡 新增 API 锚点 {len(api_added)} 个（若为拆分新增，需确认是有意）:')
        for k in api_added:
            print(f'   + {k}')
    if not api_lost and not api_changed:
        print('✅ API 锚点零丢失、零变化')
    print()
    print(f'核心函数：白名单 {len(CORE_FUNCTIONS)} 个，缺失 {len(core_lost)} 个')
    if core_lost:
        ok = False
        print(f'🔴 丢失核心函数 {len(core_lost)} 个：')
        for fn in core_lost:
            print(f'   - {fn}')
    else:
        print('✅ 核心函数零丢失')
    if build:
        print()
        print(f'构建：{"✅ 通过" if build_ok else "🔴 失败"}')
        if not build_ok:
            ok = False
            print(build_out)

    print('=' * 60)
    if ok:
        print('✅ 护栏校验通过：无功能丢失证据')
        return 0
    else:
        print('🔴 护栏校验失败：发现功能丢失，禁止部署')
        return 1


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    do_build = '--build' in sys.argv
    if mode == 'baseline':
        make_baseline()
        sys.exit(0)
    elif mode == 'verify':
        sys.exit(verify(build=do_build))
    else:
        print('用法：python3 forecast-split-guard.py [baseline|verify] [--build]')
        sys.exit(2)
