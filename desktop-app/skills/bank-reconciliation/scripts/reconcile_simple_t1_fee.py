#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化版比对脚本（含T+1和手续费逻辑）
"""

import pandas as pd
from datetime import datetime, timedelta
import json
import os

FEE_RATE = 0.002791  # 0.2791%

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
    print("🏦 银行流水与财务系统流水比对（简化版，含T+1+手续费）")
    print("="*80)
    
    # 读取数据
    print("\n📊 步骤1: 加载数据")
    print("-" * 80)
    
    df_bank = pd.read_excel('/workspace/projects/workspace/test_data/historydetail1365.xlsx', sheet_name='Sheet0', skiprows=1)
    df_bank.columns = ['凭证号', '本方账号', '对方账号', '交易时间', '借/贷', '借方发生额', '贷方发生额', '对方行号', '摘要', '用途', '对方单位名称', '余额', '个性化信息']
    df_bank = df_bank.iloc[1:].reset_index(drop=True)
    
    df_finance = pd.read_excel('/workspace/projects/workspace/test_data/账户收支明细表 (202603).xlsx', sheet_name='账户收支明细', skiprows=4)
    df_finance.columns = ['账户编号', '账户名称', '单据时间', '单据编号', '单据类型', '单据状态', '收入', '支出', '账户余额', '结算单位', '供应商', '收/付款人', '备注']
    df_finance = df_finance.iloc[1:].reset_index(drop=True)
    
    # 准备数据
    bank_records = []
    for idx, row in df_bank.iterrows():
        debit = parse_amount(row['借方发生额'])
        credit = parse_amount(row['贷方发生额'])
        amount = credit if credit > 0 else -debit if debit > 0 else 0
        
        if amount != 0:
            desc = str(row['摘要']) if pd.notna(row['摘要']) else ''
            cp = str(row['对方单位名称']) if pd.notna(row['对方单位名称']) else ''
            is_third = '微企' in desc or '随行' in desc or '微企' in cp or '随行' in cp
            
            bank_records.append({
                'date': str(row['交易时间']),
                'amount': amount,
                'desc': desc,
                'cp': cp,
                'is_third': is_third,
                'matched': False
            })
    
    finance_records = []
    for idx, row in df_finance.iterrows():
        if pd.isna(row['单据时间']) or str(row['单据时间']).strip() == '':
            continue
        
        income = parse_amount(row['收入'])
        expense = parse_amount(row['支出'])
        amount = income if income > 0 else -expense if expense > 0 else 0
        
        if amount != 0:
            cp = ''
            if pd.notna(row['收/付款人']):
                cp = str(row['收/付款人'])
            elif pd.notna(row['供应商']):
                cp = str(row['供应商'])
            
            finance_records.append({
                'date': str(row['单据时间']),
                'amount': amount,
                'cp': cp,
                'matched': False
            })
    
    print(f"  ✓ 银行流水: {len(bank_records)} 条")
    print(f"  ✓ 财务系统: {len(finance_records)} 条")
    
    # 按日期聚合财务收款记录（用于T+1匹配）
    finance_by_date = {}
    for fin_rec in finance_records:
        if fin_rec['amount'] > 0:
            fin_date = normalize_date(fin_rec['date'])
            if fin_date:
                date_key = fin_date.strftime('%Y-%m-%d')
                if date_key not in finance_by_date:
                    finance_by_date[date_key] = []
                finance_by_date[date_key].append(fin_rec)
    
    # 执行比对
    print("\n🔍 步骤2: 执行比对")
    print("-" * 80)
    
    matched = []
    
    # 阶段1: 基础匹配
    print("  阶段1: 基础匹配...")
    for bank_rec in bank_records:
        if bank_rec['matched']:
            continue
        
        for fin_rec in finance_records:
            if fin_rec['matched']:
                continue
            
            if abs(bank_rec['amount'] - fin_rec['amount']) < 0.01:
                bank_date = normalize_date(bank_rec['date'])
                fin_date = normalize_date(fin_rec['date'])
                
                if bank_date and fin_date:
                    days_diff = abs((bank_date - fin_date).days)
                    if days_diff <= 3:
                        matched.append({
                            'type': 'basic',
                            'bank': bank_rec,
                            'finance': fin_rec,
                            'days_diff': days_diff
                        })
                        bank_rec['matched'] = True
                        fin_rec['matched'] = True
                        break
    
    print(f"    基础匹配: {len(matched)} 条")
    
    # 阶段2: T+1+手续费匹配
    print("  阶段2: T+1+手续费匹配...")
    t1_fee_count = 0
    
    for bank_rec in bank_records:
        if bank_rec['matched']:
            continue
        
        if bank_rec['is_third'] and bank_rec['amount'] > 0:
            bank_date = normalize_date(bank_rec['date'])
            if bank_date:
                target_fin_date = bank_date - timedelta(days=1)
                target_date_key = target_fin_date.strftime('%Y-%m-%d')
                
                if target_date_key in finance_by_date:
                    fin_recs = finance_by_date[target_date_key]
                    # 只看未匹配的
                    unmatched_fin = [r for r in fin_recs if not r['matched']]
                    
                    if unmatched_fin:
                        total_fin = sum(r['amount'] for r in unmatched_fin)
                        expected_bank = total_fin * (1 - FEE_RATE)
                        
                        if abs(bank_rec['amount'] - expected_bank) < 1.0:
                            matched.append({
                                'type': 't1_fee',
                                'bank': bank_rec,
                                'finance_records': unmatched_fin,
                                'total_fin': total_fin,
                                'expected_bank': expected_bank,
                                'fee_rate': FEE_RATE
                            })
                            bank_rec['matched'] = True
                            for r in unmatched_fin:
                                r['matched'] = True
                            t1_fee_count += 1
    
    print(f"    T+1+手续费匹配: {t1_fee_count} 条")
    
    # 统计
    unmatched_bank = [r for r in bank_records if not r['matched']]
    unmatched_finance = [r for r in finance_records if not r['matched']]
    
    # 生成报告
    print("\n📋 步骤3: 生成报告")
    print("-" * 80)
    
    total_bank = len(bank_records)
    total_fin = len(finance_records)
    total_matched = len(matched)
    match_rate = f"{total_matched/total_bank*100:.1f}%" if total_bank > 0 else "0%"
    
    basic_count = len([m for m in matched if m['type'] == 'basic'])
    t1_fee_count = len([m for m in matched if m['type'] == 't1_fee'])
    
    print("\n" + "="*80)
    print("📈 最终比对结果")
    print("="*80)
    
    print(f"\n📊 记录统计:")
    print(f"  银行流水:              {total_bank} 条")
    print(f"  财务系统:              {total_fin} 条")
    print(f"  成功匹配:              {total_matched} 条")
    print(f"  匹配率:                {match_rate}")
    
    print(f"\n🔗 匹配类型:")
    print(f"  基础匹配:              {basic_count} 条")
    print(f"  T+1+手续费匹配:        {t1_fee_count} 条")
    print(f"  使用手续费率:          {FEE_RATE*100:.4f}%")
    
    print(f"\n⚠️  未匹配:")
    print(f"  银行流水未匹配:        {len(unmatched_bank)} 条")
    print(f"  财务系统未匹配:        {len(unmatched_finance)} 条")
    
    # 保存结果
    output_dir = '/workspace/projects/workspace/test_data/results_t1_fee_simple'
    os.makedirs(output_dir, exist_ok=True)
    
    summary = {
        'total_bank': total_bank,
        'total_finance': total_fin,
        'total_matched': total_matched,
        'match_rate': match_rate,
        'basic_match': basic_count,
        't1_fee_match': t1_fee_count,
        'fee_rate_used': FEE_RATE,
        'unmatched_bank': len(unmatched_bank),
        'unmatched_finance': len(unmatched_finance)
    }
    
    with open(f'{output_dir}/summary.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    # 保存匹配详情
    matched_list = []
    for m in matched:
        if m['type'] == 't1_fee':
            matched_list.append({
                'type': 'T+1+手续费',
                'bank_date': m['bank']['date'],
                'bank_amount': m['bank']['amount'],
                'finance_date': (normalize_date(m['bank']['date']) - timedelta(days=1)).strftime('%Y-%m-%d'),
                'finance_count': len(m['finance_records']),
                'finance_total': m['total_fin'],
                'expected_bank': m['expected_bank']
            })
        else:
            matched_list.append({
                'type': '基础匹配',
                'bank_date': m['bank']['date'],
                'bank_amount': m['bank']['amount'],
                'finance_date': m['finance']['date'],
                'finance_amount': m['finance']['amount'],
                'days_diff': m['days_diff']
            })
    
    if matched_list:
        pd.DataFrame(matched_list).to_excel(f'{output_dir}/matched.xlsx', index=False)
    
    print(f"\n💾 结果已保存到: {output_dir}")
    
    print("\n" + "="*80)
    print("🎯 总结")
    print("="*80)
    print(f"""
  ✅ 比对完成！
  
  📊 最终成果：
  • 总匹配: {total_matched} 条 ({match_rate})
  • 基础匹配: {basic_count} 条
  • T+1+手续费匹配: {t1_fee_count} 条
  
  🎉 相比之前提升: +{t1_fee_count} 条
  
  🔧 使用的逻辑：
  • 基础匹配：日期±3天 + 金额一致
  • T+1到账：银行到账日 = 财务收款日 + 1天
  • 手续费率：{FEE_RATE*100:.4f}%
  
  📁 结果文件：
  • {output_dir}/summary.json
  • {output_dir}/matched.xlsx
    """)

if __name__ == '__main__':
    main()
