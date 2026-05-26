#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
深入分析1-2月和3月的数据，找规律
"""

import pandas as pd
from datetime import datetime, timedelta
from collections import defaultdict

def parse_amount(amount_val):
    """解析金额"""
    if pd.isna(amount_val):
        return 0.0
    try:
        if isinstance(amount_val, str):
            return float(amount_val.replace(',', '').replace(' ', ''))
        return float(amount_val)
    except:
        return 0.0

def normalize_date(date_str):
    """标准化日期"""
    if not date_str or date_str == 'nan' or date_str == 'NaT':
        return None
    try:
        for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%Y/%m/%d %H:%M:%S', '%Y/%m/%d']:
            try:
                return datetime.strptime(str(date_str).split('.')[0], fmt)
            except:
                continue
        return None
    except:
        return None

def load_finance_data(file_path):
    """加载财务系统数据"""
    df = pd.read_excel(file_path)
    
    # 找到数据起始行
    data_start = 0
    for i in range(min(10, len(df))):
        row_str = str(df.iloc[i].values)
        if '账户编号' in row_str or '单据时间' in row_str:
            data_start = i + 1
            break
    
    df = df.iloc[data_start:].reset_index(drop=True)
    
    # 重命名列
    df.columns = ['账户编号', '账户名称', '单据时间', '单据编号', '单据类型', '单据状态', '收入', '支出', '账户余额', '结算单位', '供应商', '收/付款人', '备注']
    
    # 跳过第一行（期初余额）
    df = df.iloc[1:].reset_index(drop=True)
    
    records = []
    for idx, row in df.iterrows():
        if pd.isna(row['单据时间']) or str(row['单据时间']).strip() == '':
            continue
        
        income = parse_amount(row['收入'])
        expense = parse_amount(row['支出'])
        
        amount = 0.0
        if income > 0:
            amount = income
        elif expense > 0:
            amount = -expense
        
        if amount != 0:
            counterparty = ''
            if pd.notna(row['收/付款人']):
                counterparty = str(row['收/付款人'])
            elif pd.notna(row['供应商']):
                counterparty = str(row['供应商'])
            
            date = normalize_date(row['单据时间'])
            
            records.append({
                'date': date,
                'date_str': str(row['单据时间']),
                'amount': amount,
                'counterparty': counterparty,
                'remark': str(row['备注']) if pd.notna(row['备注']) else '',
                'type': 'income' if amount > 0 else 'expense'
            })
    
    return records

def load_bank_data(file_path):
    """加载银行流水数据"""
    df = pd.read_excel(file_path, skiprows=1)
    df.columns = ['凭证号', '本方账号', '对方账号', '交易时间', '借/贷', '借方发生额', '贷方发生额', '对方行号', '摘要', '用途', '对方单位名称', '余额', '个性化信息']
    df = df.iloc[1:].reset_index(drop=True)
    
    records = []
    for idx, row in df.iterrows():
        debit = parse_amount(row['借方发生额'])
        credit = parse_amount(row['贷方发生额'])
        
        amount = 0.0
        if credit > 0:
            amount = credit
        elif debit > 0:
            amount = -debit
        
        if amount != 0:
            desc = str(row['摘要']) if pd.notna(row['摘要']) else ''
            cp = str(row['对方单位名称']) if pd.notna(row['对方单位名称']) else ''
            
            date = normalize_date(row['交易时间'])
            
            is_third_party = '微企' in desc or '随行' in desc or '微企' in cp or '随行' in cp
            
            records.append({
                'date': date,
                'date_str': str(row['交易时间']),
                'amount': amount,
                'counterparty': cp,
                'description': desc,
                'is_third_party': is_third_party,
                'type': 'income' if amount > 0 else 'expense'
            })
    
    return records

def analyze_counterparty_patterns(finance_records, bank_records, month_name):
    """分析对方单位规律"""
    print(f"\n{'='*80}")
    print(f"👥 分析对方单位规律: {month_name}")
    print('='*80)
    
    # 财务系统对方单位统计
    fin_cp = defaultdict(list)
    for r in finance_records:
        if r['counterparty']:
            fin_cp[r['counterparty']].append(r)
    
    print(f"\n📊 财务系统 - 对方单位 Top 15:")
    sorted_fin = sorted(fin_cp.items(), key=lambda x: len(x[1]), reverse=True)
    for cp, records in sorted_fin[:15]:
        total_amount = sum(r['amount'] for r in records)
        print(f"  {cp}: {len(records)} 笔 | ¥{total_amount:,.2f}")
    
    # 银行流水对方单位统计
    bank_cp = defaultdict(list)
    for r in bank_records:
        if r['counterparty']:
            bank_cp[r['counterparty']].append(r)
    
    print(f"\n🏦 银行流水 - 对方单位 Top 15:")
    sorted_bank = sorted(bank_cp.items(), key=lambda x: len(x[1]), reverse=True)
    for cp, records in sorted_bank[:15]:
        total_amount = sum(r['amount'] for r in records)
        print(f"  {cp}: {len(records)} 笔 | ¥{total_amount:,.2f}")

def analyze_time_patterns(finance_records, bank_records, month_name):
    """分析时间规律"""
    print(f"\n{'='*80}")
    print(f"⏰ 分析时间规律: {month_name}")
    print('='*80)
    
    # 按星期几统计
    fin_by_weekday = defaultdict(int)
    for r in finance_records:
        if r['date']:
            weekday = r['date'].weekday()
            fin_by_weekday[weekday] += 1
    
    weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    print(f"\n📊 财务系统 - 按星期统计:")
    for i in range(7):
        print(f"  {weekdays[i]}: {fin_by_weekday.get(i, 0)} 笔")
    
    # 银行按星期几统计
    bank_by_weekday = defaultdict(int)
    for r in bank_records:
        if r['date']:
            weekday = r['date'].weekday()
            bank_by_weekday[weekday] += 1
    
    print(f"\n🏦 银行流水 - 按星期统计:")
    for i in range(7):
        print(f"  {weekdays[i]}: {bank_by_weekday.get(i, 0)} 笔")
    
    # 按小时统计
    fin_by_hour = defaultdict(int)
    for r in finance_records:
        if r['date']:
            hour = r['date'].hour
            fin_by_hour[hour] += 1
    
    print(f"\n📊 财务系统 - 按小时统计 (Top 10):")
    sorted_hours = sorted(fin_by_hour.items(), key=lambda x: x[1], reverse=True)
    for hour, count in sorted_hours[:10]:
        print(f"  {hour:02d}:00: {count} 笔")

def analyze_third_party_patterns(finance_records, bank_records, month_name):
    """分析第三方支付规律"""
    print(f"\n{'='*80}")
    print(f"💳 分析第三方支付规律: {month_name}")
    print('='*80)
    
    # 找出银行第三方支付记录
    third_party_bank = [r for r in bank_records if r['is_third_party'] and r['amount'] > 0]
    
    print(f"\n🏦 银行第三方支付记录: {len(third_party_bank)} 条")
    
    if third_party_bank:
        print(f"\n📊 前5条:")
        for i, r in enumerate(third_party_bank[:5]):
            print(f"  {i+1}. {r['date_str']} | ¥{r['amount']:,.2f} | {r['counterparty']}")
        
        # 尝试找T+1规律
        print(f"\n🔍 检查T+1规律...")
        t1_matches = 0
        for bank_rec in third_party_bank:
            if bank_rec['date']:
                target_fin_date = bank_rec['date'] - timedelta(days=1)
                
                # 找出前一天的财务收款
                fin_on_target = [r for r in finance_records 
                                if r['type'] == 'income' and r['date'] 
                                and r['date'].date() == target_fin_date.date()]
                
                if fin_on_target:
                    total_fin = sum(r['amount'] for r in fin_on_target)
                    t1_matches += 1
        
        print(f"  可能的T+1匹配: {t1_matches}/{len(third_party_bank)} 条")

def main():
    """主函数"""
    print("="*80)
    print("🔍 深入分析1-2月和3月的数据，找规律")
    print("="*80)
    
    # 加载数据
    print("\n📥 步骤1: 加载数据")
    print("-" * 80)
    
    # 1-2月数据
    fin_1_2 = load_finance_data('/workspace/projects/workspace/test_data/1-2月/账户收支明细表 (1-2月).xlsx')
    bank_1 = load_bank_data('/workspace/projects/workspace/test_data/1-2月/工行2026年1月交易明细.xlsx')
    bank_2 = load_bank_data('/workspace/projects/workspace/test_data/1-2月/工行2026年2月货款交易明细_20260228.xlsx')
    bank_1_2 = bank_1 + bank_2
    
    # 3月数据
    fin_3 = load_finance_data('/workspace/projects/workspace/test_data/账户收支明细表 (202603).xlsx')
    bank_3 = load_bank_data('/workspace/projects/workspace/test_data/historydetail1365.xlsx')
    
    print(f"  ✓ 1-2月财务: {len(fin_1_2)} 条")
    print(f"  ✓ 1-2月银行: {len(bank_1_2)} 条")
    print(f"  ✓ 3月财务: {len(fin_3)} 条")
    print(f"  ✓ 3月银行: {len(bank_3)} 条")
    
    # 分析对方单位规律
    analyze_counterparty_patterns(fin_1_2, bank_1_2, "1-2月")
    analyze_counterparty_patterns(fin_3, bank_3, "3月")
    
    # 分析时间规律
    analyze_time_patterns(fin_1_2, bank_1_2, "1-2月")
    analyze_time_patterns(fin_3, bank_3, "3月")
    
    # 分析第三方支付规律
    analyze_third_party_patterns(fin_1_2, bank_1_2, "1-2月")
    analyze_third_party_patterns(fin_3, bank_3, "3月")
    
    print("\n" + "="*80)
    print("💡 初步观察")
    print("="*80)
    print("""
  接下来会继续深入分析：
  1. 账户之间的逻辑
  2. 客户付款的时间规律
  3. 金额之间的逻辑
  4. 综合总结规律
    """)

if __name__ == '__main__':
    main()
