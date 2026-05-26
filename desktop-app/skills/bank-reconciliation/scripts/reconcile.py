#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
舟谱系统银行流水对账脚本 - 问题清单模式（纯标准库版本）

核心输出三种差异：
  1. 银行有但舟谱没有 → 可能漏记
  2. 舟谱有但银行没有 → 钱没收到（重点关注）
  3. 金额不一致 → 差多少，为什么差

不依赖 pandas，使用 zipfile + xml.etree 直接解析 xlsx。
"""

import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, date
import os
import sys
import argparse
import re
import json

FEE_RATE = 0.002791  # 0.2791%


def parse_amount(amount_str):
    """解析金额字符串"""
    if not amount_str or amount_str == 'None':
        return 0.0
    try:
        s = str(amount_str).strip()
        # 去除货币符号和空格
        s = re.sub(r'[¥$,，￥\s]', '', s)
        return float(s)
    except:
        return 0.0


def col_to_num(col_str):
    """Excel列名转数字：A=0, B=1, ..., Z=25, AA=26..."""
    result = 0
    for c in col_str.upper():
        result = result * 26 + (ord(c) - ord('A') + 1)
    return result - 1


def parse_cell_ref(ref):
    """解析单元格引用，如 'A1' -> (0, 0)"""
    m = re.match(r'([A-Za-z]+)(\d+)', ref)
    if m:
        return int(m.group(2)) - 1, col_to_num(m.group(1))
    return 0, 0


def get_shared_strings(zf):
    """从 xlsx 中加载共享字符串表"""
    strings = []
    if 'xl/sharedStrings.xml' in zf.namelist():
        with zf.open('xl/sharedStrings.xml') as f:
            tree = ET.parse(f)
            root = tree.getroot()
            ns = root.tag.split('}')[0] + '}' if '}' in root.tag else ''
            for si in root.findall(f'{ns}si'):
                text = ''
                for t in si.iter(f'{ns}t'):
                    if t.text:
                        text += t.text
                strings.append(text)
    return strings


def load_xlsx(filepath):
    """加载 xlsx 文件，返回 (headers, rows)"""
    rows_data = []
    
    with zipfile.ZipFile(filepath, 'r') as zf:
        shared = get_shared_strings(zf)
        
        # 找第一个 sheet
        sheet_files = [n for n in zf.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
        if not sheet_files:
            return [], []
        
        sheet_path = sorted(sheet_files)[0]
        
        with zf.open(sheet_path) as f:
            tree = ET.parse(f)
            root = tree.getroot()
            ns = root.tag.split('}')[0] + '}' if '}' in root.tag else ''
            
            sheet_data = root.find(f'{ns}sheetData')
            if sheet_data is None:
                return [], []
            
            all_rows = []
            for row_el in sheet_data.findall(f'{ns}row'):
                row_idx = int(row_el.get('r', 0)) - 1
                cells = {}
                for cell in row_el.findall(f'{ns}c'):
                    ref = cell.get('r', '')
                    r, c = parse_cell_ref(ref)
                    t = cell.get('t', '')
                    
                    # inlineStr format: <c t="inlineStr"><is><t>text</t></is></c>
                    if t == 'inlineStr':
                        is_el = cell.find(f'{ns}is')
                        value = ''
                        if is_el is not None:
                            for t_el in is_el.iter(f'{ns}t'):
                                if t_el.text:
                                    value += t_el.text
                    else:
                        v_el = cell.find(f'{ns}v')
                        if v_el is None or v_el.text is None:
                            value = ''
                        elif t == 's':
                            # shared string
                            try:
                                value = shared[int(v_el.text)]
                            except:
                                value = v_el.text
                        elif t == 'b':
                            value = '1' if v_el.text == '1' else '0'
                        else:
                            value = v_el.text or ''
                    
                    cells[c] = value
                
                if cells:
                    all_rows.append((row_idx, cells))
            
            if not all_rows:
                return [], []
            
            # 按行号排序
            all_rows.sort(key=lambda x: x[0])
            
            # 自动检测列头行（找包含关键词的那一行）
            # 优先匹配更具体的关键词，排除筛选条件行
            header_row_idx = 0
            # 舟谱财务表头特征：账户编号、账户名称、单据时间、单据编号
            zhoupu_header_keywords = ['账户编号', '单据编号', '单据类型', '账户名称']
            # 银行表头特征：交易时间、借方发生额、贷方发生额
            bank_header_keywords = ['交易时间', '借方发生额', '贷方发生额', '对方单位名称']
            
            for idx, (_, cells) in enumerate(all_rows[:15]):
                row_text = ' '.join(cells.values())
                # 跳过标签行如 [HISTORYDETAIL]、筛选条件行如"收/付款人"
                if row_text.startswith('[') or len(cells) <= 1:
                    continue
                # 跳过筛选条件行（如包含"全部"、"开始日期"、"结束日期"但不是正式表头）
                if '开始日期' in row_text and '结束日期' in row_text and '账户编号' not in row_text:
                    continue
                
                # 优先找明确的表头
                if any(k in row_text for k in zhoupu_header_keywords):
                    header_row_idx = idx
                    break
                if any(k in row_text for k in bank_header_keywords):
                    header_row_idx = idx
                    break
                # 备选：旧的关键词匹配
                if any(k in row_text for k in ['时间', '日期', '金额', '收入', '支出', '余额',
                                                '借方', '贷方', '对方', '摘要', '单据']):
                    header_row_idx = idx
                    break
            
            headers = all_rows[header_row_idx][1]
            data_rows = [cells for _, cells in all_rows[header_row_idx + 1:] if cells]
            
            return headers, data_rows


def find_column(headers, keywords):
    """在列头中查找匹配的列索引，优先精确匹配"""
    # Phase 1: 精确匹配（列头==关键词）
    for kw in keywords:
        for idx, hdr in headers.items():
            if str(hdr).strip() == kw:
                return idx
    
    # Phase 2: 列头包含关键词（排除被更精确关键词命中的列）
    matched_idx = None
    best_len = 0
    for kw in keywords:
        for idx, hdr in headers.items():
            hdr_str = str(hdr).strip()
            if kw in hdr_str:
                # 优先选最长的关键词匹配，避免"对方"匹配到"对方账号"
                if len(kw) > best_len:
                    best_len = len(kw)
                    matched_idx = idx
                elif len(kw) == best_len and matched_idx is not None:
                    # 同长度关键词，保留第一个匹配
                    pass
    return matched_idx


def normalize_date(date_str):
    """标准化日期字符串"""
    if not date_str or date_str in ('None', ''):
        return None
    s = str(date_str).strip()
    if s.startswith('=') or s == '':
        return None
    
    # 尝试多种格式
    for fmt in ['%Y-%m-%d', '%Y/%m/%d', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S',
                '%Y%m%d', '%m/%d/%Y']:
        try:
            return datetime.strptime(s, fmt).date()
        except:
            continue
    
    # 可能是 Excel 序列号
    try:
        serial = float(s)
        if 40000 < serial < 60000:  # 合理范围内的时间序列
            d = datetime(1899, 12, 30) + __import__('datetime').timedelta(days=int(serial))
            return d.date()
    except:
        pass
    
    return None


def load_bank_file(filepath):
    """加载银行流水"""
    print(f"  加载银行流水: {os.path.basename(filepath)}")
    headers, rows = load_xlsx(filepath)
    
    if not headers:
        print(f"    ❌ 无法解析文件: {filepath}")
        return []
    
    # 找各字段
    date_col = find_column(headers, ['时间', '日期', 'date'])
    debit_col = find_column(headers, ['借方', '支出'])
    credit_col = find_column(headers, ['贷方', '收入'])
    amount_col = find_column(headers, ['金额'])
    cp_col = find_column(headers, ['对方单位', '对方名称', '收款人', '付款方', '对方'])
    desc_col = find_column(headers, ['摘要', '用途', '说明', '交易类型'])
    balance_col = find_column(headers, ['余额'])
    
    print(f"    列映射: date={date_col}, debit={debit_col}, credit={credit_col}, "
          f"amount={amount_col}, cp={cp_col}, desc={desc_col}")
    
    records = []
    for row in rows:
        # 获取金额
        amount = 0.0
        if credit_col is not None and credit_col in row:
            credit = parse_amount(row[credit_col])
            if credit > 0:
                amount = credit
        if amount == 0 and debit_col is not None and debit_col in row:
            debit = parse_amount(row[debit_col])
            if debit != 0:
                amount = -abs(debit)
        if amount == 0 and amount_col is not None and amount_col in row:
            amount = parse_amount(row[amount_col])
        
        if abs(amount) < 0.01:
            continue
        
        dt = normalize_date(row.get(date_col, '') if date_col is not None else '') if date_col is not None else None
        cp = row.get(cp_col, '') if cp_col is not None else ''
        desc = row.get(desc_col, '') if desc_col is not None else ''
        balance = parse_amount(row.get(balance_col, '')) if balance_col is not None else 0
        
        # 判断是否第三方支付
        is_third = any(k in (desc + cp) for k in ['微企付', '随行付', '微信支付', '支付宝', '云闪付', '富友', '、通联'])
        
        records.append({
            'date': dt,
            'amount': round(amount, 2),
            'cp': str(cp).strip(),
            'desc': str(desc).strip(),
            'balance': balance,
            'is_third': is_third,
            'matched': False,
            'match_type': None,
            'raw': row,
        })
    
    print(f"    共 {len(records)} 条有效记录")
    return records


def load_finance_file(filepath):
    """加载舟谱账户收支明细"""
    print(f"  加载舟谱流水: {os.path.basename(filepath)}")
    headers, rows = load_xlsx(filepath)
    
    if not headers:
        print(f"    ❌ 无法解析文件: {filepath}")
        return []
    
    # 找各字段
    date_col = find_column(headers, ['时间', '日期'])
    income_col = find_column(headers, ['收入'])
    expense_col = find_column(headers, ['支出'])
    balance_col = find_column(headers, ['余额'])
    cp_col = find_column(headers, ['结算单位', '收/付款人', '付款人', '收款人', '对方', '供应商'])
    account_col = find_column(headers, ['账户名称', '账户', '银行账户'])
    bill_type_col = find_column(headers, ['单据类型', '类型'])
    bill_no_col = find_column(headers, ['单据编号', '编号'])
    
    print(f"    列映射: date={date_col}, income={income_col}, expense={expense_col}, "
          f"cp={cp_col}, account={account_col}")
    
    records = []
    for row in rows:
        income = parse_amount(row.get(income_col, '')) if income_col is not None else 0
        expense = parse_amount(row.get(expense_col, '')) if expense_col is not None else 0
        amount = income if income > 0 else -abs(expense) if expense != 0 else 0
        
        if abs(amount) < 0.01:
            continue
        
        dt = normalize_date(row.get(date_col, '')) if date_col is not None else None
        cp = row.get(cp_col, '') if cp_col is not None else ''
        account = row.get(account_col, '') if account_col is not None else ''
        bill_type = row.get(bill_type_col, '') if bill_type_col is not None else ''
        bill_no = row.get(bill_no_col, '') if bill_no_col is not None else ''
        balance = parse_amount(row.get(balance_col, '')) if balance_col is not None else 0
        
        records.append({
            'date': dt,
            'amount': round(amount, 2),
            'cp': str(cp).strip(),
            'account': str(account).strip(),
            'bill_type': str(bill_type).strip(),
            'bill_no': str(bill_no).strip(),
            'balance': balance,
            'matched': False,
            'match_type': None,
            'raw': row,
        })
    
    print(f"    共 {len(records)} 条有效记录")
    return records


def find_match(bank_rec, finance_recs, date_window=3, amount_tolerance=0.5):
    """为银行记录找最佳舟谱匹配"""
    best = None
    best_score = -1
    
    for fin in finance_recs:
        if fin['matched']:
            continue
        
        # 方案1：金额完全一致
        amount_diff = abs(bank_rec['amount'] - fin['amount'])
        
        if amount_diff <= amount_tolerance:
            pass  # 符合条件
        # 方案2：T+1手续费（第三方）
        elif bank_rec['is_third'] and bank_rec['amount'] > 0 and fin['amount'] > 0:
            expected_bank = fin['amount'] * (1 - FEE_RATE)
            amount_diff = abs(bank_rec['amount'] - expected_bank)
            if amount_diff > amount_tolerance:
                continue
        else:
            continue
        
        # 日期匹配
        if bank_rec['date'] and fin['date']:
            days_diff = abs((bank_rec['date'] - fin['date']).days)
            if days_diff > date_window:
                continue
            score = (date_window - days_diff + 1) * 10 - amount_diff
        elif amount_diff <= 0.01:
            score = 20  # 同日无日期差异，高分
        else:
            score = 5 - amount_diff
        
        if score > best_score:
            best_score = score
            best = fin
    
    return best


def reconcile(bank_records, finance_records, date_window=3):
    """执行对账"""
    matched = []
    
    # 银行侧逐条找匹配
    for bk in bank_records:
        if bk['matched']:
            continue
        
        fin = find_match(bk, finance_records, date_window)
        if fin:
            bk['matched'] = True
            fin['matched'] = True
            
            # 判断匹配类型
            amount_diff = abs(bk['amount'] - fin['amount'])
            is_t1_fee = False
            
            if bk['is_third'] and bk['amount'] > 0:
                expected_bank = fin['amount'] * (1 - FEE_RATE)
                if abs(bk['amount'] - expected_bank) < 0.5:
                    is_t1_fee = True
            
            bk['match_type'] = 't1_fee' if is_t1_fee else 'direct'
            fin['match_type'] = 't1_fee' if is_t1_fee else 'direct'
            
            matched.append({
                'bank': bk,
                'finance': fin,
                'match_type': bk['match_type'],
                'is_t1_fee': is_t1_fee,
            })
    
    unmatched_bank = [r for r in bank_records if not r['matched']]
    unmatched_finance = [r for r in finance_records if not r['matched']]
    
    return matched, unmatched_bank, unmatched_finance


def write_xlsx_simple(filepath, sheets):
    """写 xlsx 文件（纯标准库，openpyxl fallback）"""
    try:
        import openpyxl
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        
        for sheet_name, data in sheets.items():
            ws = wb.create_sheet(sheet_name)
            for row in data:
                ws.append(row)
        
        wb.save(filepath)
        return True
    except ImportError:
        pass
    
    # Fallback: 写 CSV（Windows Excel 直接打开会乱码）
    import csv
    for sheet_name, data in sheets.items():
        csv_path = filepath.replace('.xlsx', f'_{sheet_name}.csv')
        with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            for row in data:
                writer.writerow(row)
        print(f"    (openpyxl未安装，改为输出CSV: {csv_path})")
    return False


def generate_report(matched, unmatched_bank, unmatched_finance, output_dir, month_label=''):
    """生成问题清单报告"""
    os.makedirs(output_dir, exist_ok=True)
    
    print("\n" + "="*70)
    print("🎯 对账完成 - 问题清单")
    print("="*70)
    
    total_bank = len(matched) + len(unmatched_bank)
    total_fin = len(matched) + len(unmatched_finance)
    total_matched = len(matched)
    t1_fee_count = sum(1 for m in matched if m['is_t1_fee'])
    direct_count = total_matched - t1_fee_count
    
    bank_only_total = sum(abs(r['amount']) for r in unmatched_bank if r['amount'] > 0)
    fin_only_total = sum(abs(r['amount']) for r in unmatched_finance if r['amount'] > 0)
    
    print(f"\n📊 总体统计（{month_label or '未指定月份'}）")
    print("-"*50)
    print(f"  银行流水总条数:     {total_bank} 条")
    print(f"  舟谱流水总条数:     {total_fin} 条")
    print(f"  匹配成功:           {total_matched} 条 ({total_matched/total_bank*100:.1f}%)" if total_bank > 0 else "  匹配成功: 0 条")
    print(f"    其中 T+1手续费:   {t1_fee_count} 条")
    print(f"    其中直接匹配:     {direct_count} 条")
    print(f"  银行多(可能漏记):   {len(unmatched_bank)} 条")
    print(f"  舟谱多(未收款):     {len(unmatched_finance)} 条")
    
    # ========== 问题1：银行有但舟谱没有 ==========
    print(f"\n❌ 银行有，舟谱没有 → 可能漏记（{len(unmatched_bank)} 条）")
    print("-"*50)
    if unmatched_bank:
        print(f"  合计金额: ¥{bank_only_total:,.2f}")
        print(f"  {'日期':<12} {'金额':<14} {'对方单位':<22} {'摘要':<30} {'第三方':<6}")
        for r in sorted(unmatched_bank, key=lambda x: x['date'] or date.min):
            dt = r['date'].strftime('%Y-%m-%d') if r['date'] else '-'
            amt = f"¥{r['amount']:,.2f}"
            cp = (r['cp'][:20] + '..') if len(r['cp']) > 20 else r['cp']
            desc = (r['desc'][:28] + '..') if len(r['desc']) > 28 else r['desc']
            third = '✓' if r['is_third'] else ''
            print(f"  {dt:<12} {amt:<14} {cp:<22} {desc:<30} {third:<6}")
    else:
        print("  ✅ 没有差异！")
    
    # ========== 问题2：舟谱有但银行没有 ==========
    print(f"\n❌ 舟谱有，银行没有 → 钱没收到（{len(unmatched_finance)} 条）⚠️重点关注")
    print("-"*50)
    if unmatched_finance:
        print(f"  合计金额: ¥{fin_only_total:,.2f}")
        print(f"  {'日期':<12} {'金额':<14} {'对方':<22} {'账户':<18} {'单据类型':<10}")
        for r in sorted(unmatched_finance, key=lambda x: x['date'] or date.min):
            dt = r['date'].strftime('%Y-%m-%d') if r['date'] else '-'
            amt = f"¥{r['amount']:,.2f}"
            cp = (r['cp'][:20] + '..') if len(r['cp']) > 20 else r['cp']
            acct = (r['account'][:16] + '..') if len(r['account']) > 16 else r['account']
            btype = (r['bill_type'][:8]) if r['bill_type'] else '-'
            print(f"  {dt:<12} {amt:<14} {cp:<22} {acct:<18} {btype:<10}")
    else:
        print("  ✅ 没有差异！")
    
    # ========== 生成Excel报告 ==========
    report_xlsx = os.path.join(output_dir, f'对账报告_{month_label or "通用"}.xlsx')
    
    sheets = {}
    
    # Sheet1: 统计汇总
    sheets['统计汇总'] = [
        ['项目', '数值'],
        ['月份', month_label or '未指定'],
        ['银行流水总条数', total_bank],
        ['舟谱流水总条数', total_fin],
        ['匹配成功', total_matched],
        ['匹配率', f"{total_matched/total_bank*100:.1f}%" if total_bank > 0 else "0%"],
        ['直接匹配', direct_count],
        ['T+1手续费匹配', t1_fee_count],
        ['手续费率', f"{FEE_RATE*100:.4f}%"],
        ['银行多(可能漏记)', len(unmatched_bank)],
        ['漏记金额合计', round(bank_only_total, 2)],
        ['舟谱多(未收款)', len(unmatched_finance)],
        ['未收款金额合计', round(fin_only_total, 2)],
    ]
    
    # Sheet2: 银行多-可能漏记
    if unmatched_bank:
        bank_sheet = [['日期', '金额', '对方单位', '摘要', '第三方支付', '风险等级', '建议操作']]
        for r in sorted(unmatched_bank, key=lambda x: x['date'] or date.min):
            bank_sheet.append([
                r['date'].strftime('%Y-%m-%d') if r['date'] else '-',
                r['amount'],
                r['cp'],
                r['desc'],
                '是' if r['is_third'] else '否',
                '高' if r['is_third'] else '中',
                '核查是否已在舟谱登记',
            ])
        sheets['银行多-可能漏记'] = bank_sheet
    
    # Sheet3: 舟谱多-未收款
    if unmatched_finance:
        fin_sheet = [['日期', '金额', '对方', '账户', '单据类型', '单据编号', '风险等级', '建议操作']]
        for r in sorted(unmatched_finance, key=lambda x: x['date'] or date.min):
            fin_sheet.append([
                r['date'].strftime('%Y-%m-%d') if r['date'] else '-',
                r['amount'],
                r['cp'],
                r['account'],
                r['bill_type'],
                r['bill_no'],
                '⚠️高',
                '立即联系对方确认付款',
            ])
        sheets['舟谱多-未收款'] = fin_sheet
    
    # Sheet4: 匹配明细
    if matched:
        matched_sheet = [['匹配类型', '银行日期', '银行金额', '银行对方', '舟谱日期', '舟谱金额', '舟谱对方', '金额差']]
        for m in matched:
            bk = m['bank']
            fin = m['finance']
            matched_sheet.append([
                'T+1手续费' if m['is_t1_fee'] else '直接匹配',
                bk['date'].strftime('%Y-%m-%d') if bk['date'] else '-',
                bk['amount'],
                bk['cp'],
                fin['date'].strftime('%Y-%m-%d') if fin['date'] else '-',
                fin['amount'],
                fin['cp'],
                round(bk['amount'] - fin['amount'], 2),
            ])
        sheets['匹配明细'] = matched_sheet
    
    write_xlsx_simple(report_xlsx, sheets)
    print(f"\n💾 Excel报告: {report_xlsx}")
    
    # JSON汇总
    summary_path = os.path.join(output_dir, f'对账汇总_{month_label or "通用"}.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump({
            'month': month_label,
            'bank_total': total_bank,
            'finance_total': total_fin,
            'matched': total_matched,
            'match_rate': f"{total_matched/total_bank*100:.1f}%" if total_bank > 0 else "0%",
            'direct_match': direct_count,
            't1_fee_match': t1_fee_count,
            'fee_rate': FEE_RATE,
            'bank_only_count': len(unmatched_bank),
            'bank_only_total': round(bank_only_total, 2),
            'finance_only_count': len(unmatched_finance),
            'finance_only_total': round(fin_only_total, 2),
            'report_file': report_xlsx,
        }, f, ensure_ascii=False, indent=2)
    print(f"💾 JSON汇总: {summary_path}")
    
    return {
        'total_bank': total_bank,
        'total_fin': total_fin,
        'matched': total_matched,
        'match_rate': f"{total_matched/total_bank*100:.1f}%" if total_bank > 0 else "0%",
        'bank_only_count': len(unmatched_bank),
        'bank_only_total': round(bank_only_total, 2),
        'finance_only_count': len(unmatched_finance),
        'finance_only_total': round(fin_only_total, 2),
        'report_path': report_xlsx,
    }


def main():
    parser = argparse.ArgumentParser(
        description='舟谱银行流水对账 - 问题清单模式（纯标准库）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  python scripts/reconcile.py \\
    --bank ~/Downloads/工行流水.xlsx \\
    --finance ~/Downloads/账户收支明细.xlsx \\
    --month "2026年4月"
'''
    )
    parser.add_argument('--bank', '-b', required=True, help='银行流水Excel文件')
    parser.add_argument('--finance', '-f', required=True, help='舟谱账户收支明细Excel文件')
    parser.add_argument('--month', '-m', default='', help='月份标签（用于报告命名）')
    parser.add_argument('--output', '-o', default='./reconcile_output', help='输出目录')
    parser.add_argument('--date-window', '-d', type=int, default=3, help='日期匹配窗口天数（默认3）')
    args = parser.parse_args()
    
    print("="*70)
    print("🏦 舟谱银行流水对账 - 问题清单模式")
    print("="*70)
    print(f"\n📂 输入文件:")
    print(f"  银行: {args.bank}")
    print(f"  舟谱: {args.finance}")
    print(f"  月份: {args.month or '未指定'}")
    print(f"  日期窗口: ±{args.date_window}天")
    
    bank_records = load_bank_file(args.bank)
    finance_records = load_finance_file(args.finance)
    
    if not bank_records:
        print("\n❌ 银行流水解析失败，请检查文件格式")
        sys.exit(1)
    if not finance_records:
        print("\n❌ 舟谱流水解析失败，请检查文件格式")
        sys.exit(1)
    
    print(f"\n🔍 执行对账...")
    matched, unmatched_bank, unmatched_finance = reconcile(
        bank_records, finance_records, date_window=args.date_window
    )
    
    generate_report(matched, unmatched_bank, unmatched_finance, args.output, args.month)
    print("\n" + "="*70)


if __name__ == '__main__':
    main()
