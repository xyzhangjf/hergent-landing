#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
检查2月28日银行流水余额和舟谱系统余额是否一致
"""

import pandas as pd
from datetime import datetime

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

def get_bank_balance_feb_28(bank_file):
    """从银行流水中获取2月28日的余额"""
    df = pd.read_excel(bank_file, skiprows=1)
    df.columns = ['凭证号', '本方账号', '对方账号', '交易时间', '借/贷', '借方发生额', '贷方发生额', '对方行号', '摘要', '用途', '对方单位名称', '余额', '个性化信息']
    df = df.iloc[1:].reset_index(drop=True)
    
    feb_28_balance = None
    feb_28_records = []
    
    for idx, row in df.iterrows():
        date = normalize_date(row['交易时间'])
        if date:
            if date.year == 2026 and date.month == 2 and date.day == 28:
                balance = parse_amount(row['余额'])
                if balance > 0:
                    feb_28_records.append({
                        'idx': idx,
                        'date': date,
                        'balance': balance
                    })
                    print(f"  找到2月28日记录 #{idx}: 时间={date}, 余额 = ¥{balance:,.2f}")
    
    # 银行流水是倒序排列的，所以第一条记录是最新的（2月28日最后一笔）
    if feb_28_records:
        # 按时间排序，取最新的
        feb_28_records.sort(key=lambda x: x['date'], reverse=True)
        feb_28_balance = feb_28_records[0]['balance']
        print(f"  ✅ 取2月28日最新记录（第一条）余额: ¥{feb_28_balance:,.2f}")
    # 如果没有正好2月28日的，取第一条记录（最新的）
    elif len(df) > 0:
        first_row = df.iloc[0]
        balance = parse_amount(first_row['余额'])
        date = normalize_date(first_row['交易时间'])
        print(f"  没有找到正好2月28日的记录，取第一条（最新）记录: 日期={date}, 余额=¥{balance:,.2f}")
        feb_28_balance = balance
    
    return feb_28_balance

def get_finance_balance_feb_28(finance_file):
    """从财务系统中获取2月28日的余额"""
    df = pd.read_excel(finance_file)
    
    data_start = 0
    for i in range(min(10, len(df))):
        row_str = str(df.iloc[i].values)
        if '账户编号' in row_str or '单据时间' in row_str:
            data_start = i + 1
            break
    
    df = df.iloc[data_start:].reset_index(drop=True)
    df.columns = ['账户编号', '账户名称', '单据时间', '单据编号', '单据类型', '单据状态', '收入', '支出', '账户余额', '结算单位', '供应商', '收/付款人', '备注']
    df = df.iloc[1:].reset_index(drop=True)
    
    feb_28_balance = None
    last_feb_28_balance = None
    
    for idx, row in df.iterrows():
        if pd.isna(row['单据时间']) or str(row['单据时间']).strip() == '':
            continue
        
        date = normalize_date(row['单据时间'])
        if date:
            if date.year == 2026 and date.month == 2 and date.day == 28:
                balance = parse_amount(row['账户余额'])
                if balance > 0:
                    last_feb_28_balance = balance
                    print(f"  找到2月28日记录 #{idx}: 余额 = ¥{balance:,.2f}")
    
    # 取2月28日最后一条记录
    if last_feb_28_balance:
        feb_28_balance = last_feb_28_balance
        print(f"  ✅ 取2月28日最后一条记录余额: ¥{feb_28_balance:,.2f}")
    # 如果没有正好2月28日的，取最后一条2月的记录
    else:
        last_feb_balance = None
        for idx, row in df.iterrows():
            if pd.isna(row['单据时间']) or str(row['单据时间']).strip() == '':
                continue
            date = normalize_date(row['单据时间'])
            if date and date.year == 2026 and date.month == 2:
                balance = parse_amount(row['账户余额'])
                if balance > 0:
                    last_feb_balance = balance
        if last_feb_balance:
            print(f"  没有找到正好2月28日的记录，取最后一条2月记录: 余额=¥{last_feb_balance:,.2f}")
            feb_28_balance = last_feb_balance
    
    return feb_28_balance

def main():
    """主函数"""
    print("="*80)
    print("💰 检查2月28日银行流水余额和舟谱系统余额")
    print("="*80)
    
    bank_file = '/workspace/projects/workspace/test_data/1-2月/工行2026年2月货款交易明细_20260228.xlsx'
    finance_file = '/workspace/projects/workspace/test_data/1-2月/账户收支明细表 (1-2月).xlsx'
    
    print("\n📊 第一步：从银行流水中获取2月28日余额")
    print("-"*80)
    bank_balance = get_bank_balance_feb_28(bank_file)
    
    print("\n📊 第二步：从财务系统中获取2月28日余额")
    print("-"*80)
    finance_balance = get_finance_balance_feb_28(finance_file)
    
    print("\n" + "="*80)
    print("🎯 结果对比")
    print("="*80)
    
    if bank_balance and finance_balance:
        print(f"\n  银行流水余额: ¥{bank_balance:,.2f}")
        print(f"  财务系统余额: ¥{finance_balance:,.2f}")
        
        diff = abs(bank_balance - finance_balance)
        
        if diff < 0.01:
            print("\n  ✅ 完全一致！")
        else:
            print(f"\n  ⚠️  不一致！差额: ¥{diff:,.2f}")
            print(f"  差异比例: {diff/bank_balance*100:.4f}%")
    else:
        print("\n  ❌ 无法获取余额进行对比")
        if not bank_balance:
            print("  - 银行流水余额获取失败")
        if not finance_balance:
            print("  - 财务系统余额获取失败")
    
    print("\n" + "="*80)

if __name__ == '__main__':
    main()
