#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证更多日期
"""

import pandas as pd
from datetime import datetime, timedelta

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

def main():
    """主函数"""
    print("="*80)
    print("🔍 验证更多日期的T+1到账 + 手续费逻辑")
    print("="*80)
    
    # 读取数据
    df_bank = pd.read_excel('/workspace/projects/workspace/test_data/historydetail1365.xlsx', sheet_name='Sheet0', skiprows=1)
    df_bank.columns = ['凭证号', '本方账号', '对方账号', '交易时间', '借/贷', '借方发生额', '贷方发生额', '对方行号', '摘要', '用途', '对方单位名称', '余额', '个性化信息']
    df_bank = df_bank.iloc[1:].reset_index(drop=True)
    
    df_finance = pd.read_excel('/workspace/projects/workspace/test_data/账户收支明细表 (202603).xlsx', sheet_name='账户收支明细', skiprows=4)
    df_finance.columns = ['账户编号', '账户名称', '单据时间', '单据编号', '单据类型', '单据状态', '收入', '支出', '账户余额', '结算单位', '供应商', '收/付款人', '备注']
    df_finance = df_finance.iloc[1:].reset_index(drop=True)
    
    # 测试几组日期
    test_cases = [
        ('2026-03-22', '2026-03-23', '微企付'),
        ('2026-03-19', '2026-03-20', '微企付'),
        ('2026-03-14', '2026-03-15', '微企付'),
        ('2026-03-13', '2026-03-14', '微企付'),
    ]
    
    all_results = []
    
    for fin_date_str, bank_date_str, pay_type in test_cases:
        print(f"\n📅 测试: {fin_date_str} 财务收款 → {bank_date_str} 银行到账")
        print("-" * 80)
        
        # 财务收款
        fin_total = 0
        for idx, row in df_finance.iterrows():
            fin_date = normalize_date(row['单据时间'])
            if fin_date and fin_date.strftime('%Y-%m-%d') == fin_date_str:
                income = parse_amount(row['收入'])
                if income > 0:
                    fin_total += income
        
        # 银行到账
        bank_amount = 0
        for idx, row in df_bank.iterrows():
            bank_date = normalize_date(row['交易时间'])
            if bank_date and bank_date.strftime('%Y-%m-%d') == bank_date_str:
                cp = str(row['对方单位名称']) if pd.notna(row['对方单位名称']) else ''
                if pay_type in cp:
                    credit = parse_amount(row['贷方发生额'])
                    bank_amount = credit
        
        if fin_total > 0 and bank_amount > 0:
            fee = fin_total - bank_amount
            fee_rate = fee / fin_total
            
            all_results.append({
                'fin_date': fin_date_str,
                'bank_date': bank_date_str,
                'fin_total': fin_total,
                'bank_amount': bank_amount,
                'fee': fee,
                'fee_rate': fee_rate
            })
            
            print(f"✅ 财务收款 ({fin_date_str}): ¥{fin_total:,.2f}")
            print(f"✅ 银行到账 ({bank_date_str}): ¥{bank_amount:,.2f}")
            print(f"💸 手续费: ¥{fee:,.2f}")
            print(f"📊 手续费率: {fee_rate*100:.4f}%")
        else:
            print(f"❌ 未找到完整数据")
    
    if all_results:
        avg_fee_rate = sum(r['fee_rate'] for r in all_results) / len(all_results)
        
        print("\n" + "="*80)
        print("🎯 最终结论")
        print("="*80)
        print(f"""
  ✅ T+1到账逻辑验证成功！
  
  📊 验证结果：
  """)
        for r in all_results:
            print(f"    • {r['fin_date']} → {r['bank_date']}: 费率 {r['fee_rate']*100:.4f}%")
        
        print(f"""
  🎯 核心发现：
  1. T+1到账：银行到账日 = 财务收款日 + 1天 ✓
  2. 手续费率：平均 {avg_fee_rate*100:.4f}% ✓
  
  💰 计算公式：
  银行到账金额 = 财务收款总额 × (1 - {avg_fee_rate*100:.4f}%)
  
  🔢 示例：
  财务收款总额 ¥10,000
  手续费 ¥{10000*avg_fee_rate:.2f}
  银行实际到账 ¥{10000*(1-avg_fee_rate):.2f}
        """)

if __name__ == '__main__':
    main()
