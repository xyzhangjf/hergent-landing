#!/usr/bin/env python3
# 把商业计划书 .md 源转成合规命名 PDF（中文字体用系统 STHeiti/Hiragino，无需 Office）
import re, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                ListFlowable, ListItem)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER

pdfmetrics.registerFont(TTFont('HEI', '/System/Library/Fonts/STHeiti Medium.ttc', subfontIndex=0))
try:
    pdfmetrics.registerFont(TTFont('HEI-BOLD', '/System/Library/Fonts/Hiragino Sans GB.ttc', subfontIndex=1))
except Exception:
    pdfmetrics.registerFont(TTFont('HEI-BOLD', '/System/Library/Fonts/STHeiti Medium.ttc', subfontIndex=0))
pdfmetrics.registerFontFamily('HEI', normal='HEI', bold='HEI-BOLD', italic='HEI', boldItalic='HEI-BOLD')

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def inline(s):
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', esc(s))

S = {
 'title': ParagraphStyle('title', fontName='HEI-BOLD', fontSize=18, leading=24,
                         alignment=TA_CENTER, spaceAfter=10),
 'h1': ParagraphStyle('h1', fontName='HEI-BOLD', fontSize=14, leading=20,
                      spaceBefore=12, spaceAfter=6, textColor=HexColor('#0b3d59')),
 'h2': ParagraphStyle('h2', fontName='HEI-BOLD', fontSize=12, leading=17,
                      spaceBefore=8, spaceAfter=4, textColor=HexColor('#1a6ea8')),
 'body': ParagraphStyle('body', fontName='HEI', fontSize=10.5, leading=16,
                        spaceAfter=5, wordWrap='CJK'),
 'quote': ParagraphStyle('quote', fontName='HEI', fontSize=10, leading=15,
                         leftIndent=12, textColor=HexColor('#555555'),
                         spaceAfter=5, wordWrap='CJK'),
 'bullet': ParagraphStyle('bullet', fontName='HEI', fontSize=10.5, leading=15, wordWrap='CJK'),
}

src = open('商业计划书-Hergent-AI经营副驾.md', encoding='utf-8').read()
lines = src.split('\n')
flow, buf_b, buf_o = [], [], []

def flush():
    global buf_b, buf_o
    if buf_b:
        flow.append(ListFlowable(
            [ListItem(Paragraph(inline(b), S['bullet']), leftIndent=10) for b in buf_b],
            bulletType='bullet', start='•', leftIndent=14))
        buf_b = []
    if buf_o:
        flow.append(ListFlowable(
            [ListItem(Paragraph(inline(b), S['bullet']), leftIndent=10) for b in buf_o],
            bulletType='1', leftIndent=18))
        buf_o = []

for ln in lines:
    s = ln.rstrip()
    if not s.strip():
        flush(); continue
    if s.startswith('# '):
        flush(); flow.append(Paragraph(inline(s[2:]), S['title']))
    elif s.startswith('## '):
        flush(); flow.append(Paragraph(inline(s[3:]), S['h1']))
    elif s.startswith('### '):
        flush(); flow.append(Paragraph(inline(s[4:]), S['h2']))
    elif s.startswith('> '):
        flush(); flow.append(Paragraph(inline(s[2:]), S['quote']))
    elif re.match(r'^\s*[-*]\s+', s):
        buf_o or None; buf_b.append(re.sub(r'^\s*[-*]\s+', '', s))
    elif re.match(r'^\s*\d+\.\s+', s):
        buf_b or None; buf_o.append(re.sub(r'^\s*\d+\.\s+', '', s))
    else:
        flush(); flow.append(Paragraph(inline(s), S['body']))
flush()

out = '湖北省小赫智体数字科技有限公司-张俊峰-Hergent AI经营副驾-商业计划书.pdf'
doc = SimpleDocTemplate(out, pagesize=A4, topMargin=18*mm, bottomMargin=18*mm,
                        leftMargin=20*mm, rightMargin=20*mm,
                        title='Hergent AI 经营副驾 商业计划书')
doc.build(flow)
print('BUILD OK ->', out)
