#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证微企付、随行付的T+1到账和手续费逻辑
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
    print("🔍 验证微企付、随行付 T+1到账 + 手续费逻辑")
    print("="*80)
    
    # 读取银行流水
    df_bank = pd.read_excel('/workspace/projects/workspace/test_data/historydetail1365.xlsx', sheet_name='Sheet0', skiprows=1)
    df_bank.columns = ['凭证号', '本方账号', '对方账号', '交易时间', '借/贷', '借方发生额', '贷方发生额', '对方行号', '摘要', '用途', '对方单位名称', '余额', '个性化信息']
    df_bank = df_bank.iloc[1:].reset_index(drop=True)
    
    # 读取财务系统
    df_finance = pd.read_excel('/workspace/projects/workspace/test_data/账户收支明细表 (202603).xlsx', sheet_name='账户收支明细', skiprows=4)
    df_finance.columns = ['账户编号', '账户名称', '单据时间', '单据编号', '单据类型', '单据状态', '收入', '支出', '账户余额', '结算单位', '供应商', '收/付款人', '备注']
    df_finance = df_finance.iloc[1:].reset_index(drop=True)
    
    # 提取财务系统所有收款记录
    finance_income_records = []
    for idx, row in df_finance.iterrows():
        if pd.isna(row['单据时间']) or str(row['单据时间']).strip() == '':
            continue
        
        income = parse_amount(row['收入'])
        if income > 0:
            counterparty = ''
            if pd.notna(row['收/付款人']):
                counterparty = str(row['收/付款人'])
            elif pd.notna(row['供应商']):
                counterparty = str(row['供应商'])
            
            finance_income_records.append({
                'date': str(row['单据时间']),
                'amount': income,
                'counterparty': counterparty,
                'remark': str(row['备注']) if pd.notna(row['备注']) else ''
            })
    
    print(f"\n📊 财务系统收款记录: {len(finance_income_records)} 条")
    
    # 找出银行流水中的微企付、随行付记录
    print("\n🏦 银行第三方支付记录分析:")
    print("-" * 80)
    
    results = []
    
    for idx, row in df_bank.iterrows():
        desc = str(row['摘要']) if pd.notna(row['摘要']) else ''
        cp = str(row['对方单位名称']) if pd.notna(row['对方单位名称']) else ''
        
        if '微企' in desc or '随行' in desc or '微企' in cp or '随行' in cp:
            # 解析银行记录
            bank_date = normalize_date(row['交易时间'])
            credit = parse_amount(row['贷方发生额'])
            
            if credit > 0 and bank_date:
                # T+1逻辑：银行到账日 = 财务收款日 + 1
                # 所以财务收款日应该是 bank_date - 1
                target_fin_date = bank_date - timedelta(days=1)
                target_fin_date_str = target_fin_date.strftime('%Y-%m-%d')
                
                # 找出目标日期的财务收款记录
                matching_fin_records = []
                for fin_rec in finance_income_records:
                    fin_date = normalize_date(fin_rec['date'])
                    if fin_date and fin_date.strftime('%Y-%m-%d') == target_fin_date_str:
                        matching_fin_records.append(fin_rec)
                
                if matching_fin_records:
                    total_fin_amount = sum(r['amount'] for r in matching_fin_records)
                    fee = total_fin_amount - credit
                    fee_rate = fee / total_fin_amount if total_fin_amount > 0 else 0
                    
                    results.append({
                        'bank_date': bank_date.strftime('%Y-%m-%d'),
                        'bank_amount': credit,
                        'target_fin_date': target_fin_date_str,
                        'fin_count': len(matching_fin_records),
                        'fin_total': total_fin_amount,
                        'fee': fee,
                        'fee_rate': fee_rate
                    })
                    
                    print(f"\n✅ 找到匹配:")
                    print(f"   银行到账: {bank_date.strftime('%Y-%m-%d')} | ¥{credit:,.2f} | {cp}")
                    print(f"   财务收款: {target_fin_date_str} | {len(matching_fin_records)} 笔 | 总额 ¥{total_fin_amount:,.2f}")
                    print(f"   手续费: ¥{fee:,.2f} | 费率: {fee_rate*100:.4f}%")
    
    # 统计
    if results:
        print("\n" + "="*80)
        print("📊 统计结果")
        print("="*80)
        
        avg_fee_rate = sum(r['fee_rate'] for r in results) / len(results)
        print(f"\n  成功匹配: {len(results)} 组")
        print(f"  平均手续费率: {avg_fee_rate*100:.4f}%")
        
        print(f"\n  所有匹配详情:")
        for i, r in enumerate(results):
            print(f"  {i+1}. {r['target_fin_date']} → {r['bank_date']}: "
                  f"¥{r['fin_total']:,.2f} → ¥{r['bank_amount']:,.2f}, "
                  f"费率 {r['fee_rate']*100:.4f}%")
    
    print("\n" + "="*80)
    print("💡 结论")
    print("="*80)
    print("""
  🔍 验证逻辑：
  1. 取银行第三方支付记录（微企付、随行付）
  2. 假设T+1到账，找前一天的财务收款记录
  3. 计算手续费率 = (财务总额 - 银行到账额) / 财务总额
  
  如果逻辑正确，应该能观察到：
  • 相对稳定的手续费率
  • 银行到账日 = 财务收款日 + 1
    """)

if __name__ == '__main__':
    main()
