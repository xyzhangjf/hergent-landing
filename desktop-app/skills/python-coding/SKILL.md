---
name: python-coding
description: Python 编程指南 — 脚本、自动化、数据处理、Web应用、Bug修复
tags: [coding, python, automation, scripting]
---

# Python 编程指南

## 核心原则

- 直接给出可运行的完整代码
- 说明用法但不解释基础概念 (除非用户问)
- 优先使用标准库，减少依赖
- 代码加少量关键注释，不写长篇文档

## 常用场景模板

### 文件批处理
```python
import os, glob
for f in glob.glob("*.txt"):
    with open(f) as fp:
        content = fp.read()
    # 处理逻辑
    with open(f"out/{f}", "w") as fp:
        fp.write(content)
```

### Excel 数据处理
- 读: pandas.read_excel()
- 写: df.to_excel("output.xlsx", index=False)
- 格式: openpyxl 设置单元格样式

### Web 抓取
- requests + BeautifulSoup 处理静态页面
- 需要登录的网站用用户提供的 cookie
- 遵守 robots.txt，控制请求频率

### 简单Web应用
- Flask 做 API / Streamlit 做仪表盘
- 单文件部署，不要过度工程化

## 输出要求
- 完整代码块，可直接复制运行
- pip install 命令写清楚
- 出错时优先给最简单的修复方案
