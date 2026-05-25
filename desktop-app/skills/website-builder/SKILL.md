---
name: website-builder
description: AI 建站 — 从描述/截图/图片生成完整网站，支持全栈开发与一键部署
tags: [web, design, fullstack, publishing]
---

# AI 网站生成指南

## 核心能力

你能根据用户描述、截图、参考图片生成完整的网站。从单页 landing page 到多页全栈应用，从设计到部署，一站式完成。

## 建站流程

### 1. 理解需求
- 网站类型: 作品集/摄影/博客/营销页/公司官网/工具应用
- 目标受众: 谁来看这个网站？
- 关键功能: 表单/搜索/用户系统/数据展示/支付
- 风格偏好: 极简/科技/温暖/专业/创意
- 参考网站或截图（用户可能上传）

### 2. 设计规划
- 先列出页面结构大纲（导航/hero/功能/定价/FAQ/footer）
- 确定配色方案（主色+辅色+中性色，3-5色即可）
- 确定字体搭配（标题+正文，用 Google Fonts 或系统字体）
- 规划响应式断点: 桌面(1024+)/平板(768-1024)/手机(<768)

### 3. 代码生成原则

**设计质量要求**:
- Hero 区域要有视觉冲击力，大标题+副标题+CTA按钮+背景图/渐变
- 使用现代设计语言: 圆角卡片/柔和阴影/留白充足/渐变点缀
- 加入微交互: hover效果/平滑过渡/滚动渐显动画
- 图标用 emoji 或 SVG inline，不依赖图标库
- 图片用 unsplash placeholder 或 SVG 占位图

**技术选型**:
- 纯静态: HTML + CSS + vanilla JS（最通用，零依赖）
- 需要后端逻辑: 用 Express/Python Flask 轻量方案
- 需要数据库: SQLite 或 JSON 文件存储
- 需要认证: JWT token + localStorage

**代码规范**:
- 所有 CSS/JS 内联在单个 HTML 文件中（便于分发）
- CSS 变量管理颜色和间距，方便一键换肤
- 语义化 HTML5 标签: header/nav/main/section/article/footer
- JS 用 ES6+ 但保持简洁，不引入框架
- 图片懒加载 (loading="lazy")
- 基础 SEO: title/description/og 标签

### 4. 多页面网站

生成完整的多页面项目结构:
```
project/
  index.html          # 首页
  about.html          # 关于
  contact.html        # 联系
  assets/
    style.css         # 共享样式
    main.js           # 共享逻辑
    images/           # 图片资源
```

### 5. 全栈能力

需要后端时:
- Express.js + SQLite 做轻量 API
- JWT 做用户认证（注册/登录/登出）
- 表单提交 → 存储 → 管理后台查看
- 文件上传处理（图片/文档）
- 基础 CRUD API: GET/POST/PUT/DELETE

### 6. 部署发布

- 生成的文件可以直接用浏览器打开（静态网站）
- 需要后端时提供启动命令: `node server.js` 或 `python app.py`
- 说明部署选项: GitHub Pages/Netlify/Vercel（静态），Railway/Render（全栈）
- 提供 Dockerfile 给需要容器化部署的场景

## 特殊场景

### 从截图复刻网站
- 仔细观察截图的布局结构/颜色/字体/间距
- 还原度高，但用干净代码重写
- 标注与原网站的差异和改进点

### Landing Page / 营销页
- Hero: 一句话价值主张 + CTA
- 信任信号: 客户logo墙/数据/证言
- 功能展示: 3-5个核心功能卡片
- 定价表: 2-4个套餐对比
- FAQ: 折叠式问答
- Footer: 链接+社交媒体+版权

### 作品集/摄影站
- 大图网格/瀑布流布局
- 灯箱效果查看大图
- 分类筛选功能
- 简约导航，让作品说话

### 内部工具/后台
- 侧边栏导航 + 主内容区
- 数据表格: 排序/搜索/分页
- 图表仪表盘: 折线图/柱状图/饼图
- 表单: 添加/编辑/删除

## 交互式微调

生成网站后，用户可以用自然语言迭代修改:
- "把 hero 背景换成深蓝色渐变"
- "按钮圆角再大一些"
- "加一个手机端汉堡菜单"
- "在 pricing 前面加一个 testimonials 区块"
- "字体换成衬线体"

每次修改保持代码整洁，不要引入冗余样式。
