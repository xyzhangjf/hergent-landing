// ===== config.js — 纯数据常量（无依赖，最先加载）=====

// ===== 任务模板定义 =====
const TASK_TEMPLATES = [
  { id: 'report', ico: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>', name: '每周总结', desc: '每周一生成工作总结', freq: 'weekly', time: '09:00', prompt: '生成本周工作总结，整理关键数据和进展，推送到飞书' },
  { id: 'morning', ico: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>', name: '早间简报', desc: '每天早上推送天气+新闻', freq: 'daily', time: '07:30', prompt: '查询今天天气和主要新闻，推送到飞书' },
  { id: 'reminder', ico: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', name: '定时提醒', desc: '每天提醒待办事项', freq: 'daily', time: '09:00', prompt: '检查并提醒今天的待办事项，推送到飞书' },
  { id: 'backup', ico: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>', name: '数据整理', desc: '每周整理文件', freq: 'weekly', time: '02:00', prompt: '整理最近一周的文件和文档，生成索引报告' },
];

// ===== 频率标签映射 =====
const FREQ_LABELS = {
  daily: '每天', altdaily: '隔天', weekly: '每周', altweekly: '隔周',
  biweekly: '每周两次', monthly: '每月', altmonthly: '隔月', quarterly: '每季', custom: '自定义'
};

// ===== 连接手机 卡片定义 =====
const CHANNEL_CARDS = [
  { key: 'feishu', label: '飞书', icon: 'feishu-icon', desc: '推荐 · 最常用', hl: '打开飞书开发者后台 → 创建应用 → 拿到 App ID 和 Secret 填进来就行', fields: [{id:'app_id', label:'App ID', placeholder:'cli_...'}, {id:'app_secret', label:'App Secret', placeholder:'粘贴密钥'}] },
  { key: 'wecom', label: '企业微信', icon: 'wecom-icon', desc: '适合公司内部用', hl: '企微管理后台 → 智能机器人 → 拿到 Bot ID 和 Secret', fields: [{id:'bot_id', label:'Bot ID', placeholder:'粘贴Bot ID'}, {id:'secret', label:'Secret', placeholder:'粘贴密钥'}] },
  { key: 'dingtalk', label: '钉钉', icon: 'dingtalk-icon', desc: '适合团队协作', hl: '钉钉开发者后台 → 创建机器人 → 拿到 Client ID 和 Secret', fields: [{id:'client_id', label:'Client ID', placeholder:'粘贴Client ID'}, {id:'client_secret', label:'Client Secret', placeholder:'粘贴密钥'}] },
  { key: 'qq', label: 'QQ', icon: 'qq-icon', desc: '适合个人使用', hl: 'QQ开放平台 → 创建机器人 → 拿到 AppID 和 Secret', fields: [{id:'app_id', label:'AppID', placeholder:'粘贴AppID'}, {id:'app_secret', label:'AppSecret', placeholder:'粘贴密钥'}] }
];

// ===== 问卷调查模板 =====
const questionnaires = {
  // ===== 通用功能：知识地图模式 =====
  write: {
    name: '帮我写',
    opening: '好的，跟我说说你想写什么？\n\n工作汇报、方案策划、合同协议、邮件回复——什么类型都行。\n\n你给方向，我来写。风格要正式还是口语、长度要精简还是详细——你定。\n\n要不试试——现在想写什么？简单说两句就行。',
    knowledge: [
      '想写什么类型的——汇报、方案、邮件、还是其他',
      '风格偏好——正式、口语、中性',
      '长度要求——精简还是详细'
    ],
    wrap_up: '聊清楚后小结确认：文档类型、风格、长度。然后说"记下了，下次要写什么直接说，我按这个调子来。"'
  },
  // ===== 聊天软件连接向导（拿到密钥→去连接手机页面填） =====
  channel_feishu: {
    name: '连接飞书',
    intro: '拿到飞书的 App ID 和 App Secret 后，直接去「📱 连接手机」页面找到飞书卡片，填进去点保存就行。没拿到的我带你一步步拿——',
    items: [
      '第1步：打开飞书开发者后台 https://open.feishu.cn/app ，登录后在页面最顶部有个很大的图标写着「创建飞书智能体应用」，点它。如果还没注册，点「立即注册」就行，个人用户也能注册，企业名填你自己名字都行。注册登录好了告诉我。',
      '创建好应用了吗？在应用详情页找到「凭证与基础信息」，把 App ID 复制下来，去「📱 连接手机」页面的飞书卡片里粘贴。App Secret 也在同一个位置，点「查看」复制，🔥 只显示一次！两个都贴好后点「💾 保存」。搞完告诉我。',
      '接下来开权限：左边菜单点「权限管理」，搜 im:message 并开通。需要开的权限：im:message、im:message.group_at_msg、im:message.p2p_msg、im:resource。搜一个开一个，开完告诉我。',
      '权限开完后，左边点「应用发布」→「创建版本」填个版本号比如 1.0.0 →「发布」。发布好了告诉我。',
      '在你的飞书里搜应用名，点进去拉到工作群里。搞完之后，回到「📱 连接手机」页面，点飞书卡片上的「🔌 测试连接」，收到测试消息就说明通啦！'
    ]
  },
  channel_wecom: {
    name: '连接企业微信',
    intro: '拿到企微智能机器人的 Bot ID 和 Secret 后，直接去「📱 连接手机」页面找到企业微信卡片，填进去点保存就行。没拿到的我带你拿——',
    items: [
      '第1步：打开企业微信 → 点底部「工作台」→ 找到「智能机器人」→ 点「创建智能机器人」。',
      '点左下角「手动创建」→ 往下拉到最底部，找到「API 模式创建」，点它。',
      '给机器人起个名字（随便填就行），「可见范围」必填，建议先选你自己。「连接方式」选择「使用长连接」。搞完告诉我。',
      '这时候 Bot ID 已经默认显示在页面上了，Secret 点「获取」就能看到。⚠️ 只显示一次！把 Bot ID 和 Secret 复制下来，去「📱 连接手机」页面的企业微信卡片里贴好，点「💾 保存」。搞完告诉我。',
      '继续往下，点击「使用权限」获取文档使用权限 → 再点「授权」→ 最后点「保存」，机器人就创建完成了。保存好了告诉我。',
      '搞定了！回到「📱 连接手机」页面，点企业微信卡片上的「🔌 测试连接」，收到测试消息就通了。'
    ]
  },
  channel_qq: {
    name: '连接QQ',
    intro: '拿到 QQ 机器人的 AppID 和 AppSecret 后，直接去「📱 连接手机」页面找到 QQ 卡片，填进去点保存就行。没拿到的我带你拿——',
    items: [
      '第1步：打开 QQ 开放平台 https://q.qq.com ，登录后点「应用管理」→「创建机器人」。起个名字、选个头像就行。创建好了告诉我。',
      '创建成功后，在应用详情页找到 AppID 和 AppSecret。⚠️ AppSecret 只显示一次！把两个都复制下来，去「📱 连接手机」页面的 QQ 卡片里贴好，点「💾 保存」。搞完告诉我。',
      '左侧菜单点「权限管理」，确认机器人有收发消息的权限（一般默认就有，看一眼就好）。确认完告诉我。',
      '回到「📱 连接手机」页面，点 QQ 卡片上的「🔌 测试连接」，收到测试消息就通了。'
    ]
  },
  channel_dingtalk: {
    name: '连接钉钉',
    intro: '拿到钉钉的 Client ID 和 Client Secret 后，直接去「📱 连接手机」页面找到钉钉卡片，填进去点保存就行。没拿到的我带你拿——',
    items: [
      '第1步：打开钉钉开发者后台 https://open-dev.dingtalk.com ，用管理员账号登录。没注册的话先注册，个人也能创建团队。登录好了告诉我。',
      '在「应用开发」下点「创建应用」→ 选「机器人」→ 填好名字和简介→「保存」。创建好了告诉我。',
      '应用详情页「凭证与基础信息」里，Client ID 和 Client Secret 都在。⚠️ Secret 只显示一次！把两个复制下来，去「📱 连接手机」页面的钉钉卡片里贴好，点「💾 保存」。搞完告诉我。',
      '接下来开权限：左侧菜单「权限管理」，搜索并开通这三个——Card.Streaming.Write、Card.Instance.Write、qyapi_robot_sendmsg。三个都开通了告诉我。',
      '点页面上方「版本详情」旁的编辑按钮，填个描述（随便写）→「确认发布」。不发布机器人在钉钉里搜不到。发布好了告诉我。',
      '等几分钟审核通过后，回到「📱 连接手机」页面，点钉钉卡片上的「🔌 测试连接」，收到测试消息就通了。'
    ]
  }
};

// ===== 角色定义 =====
let ROLES = {
  dami: { name: '我的大秘', systemPrompt: '你扮演"大秘"角色。你是用户的得力助手，擅长：写文档（合同/邮件/方案）、搜资料、设提醒、处理文件。风格：高效、靠谱、考虑周全。用户说什么你就帮忙做什么，主动帮用户省时间。', opening: '我是你的大秘，文书、搜索、提醒都归我。\n\n**我能做什么**\n写合同、回邮件、做方案、搜资料、设提醒——你不想动手的都交给我。\n\n**数据怎么来**\n- 直接告诉我需求，网上能查到的我帮你查\n- 也可以发文件给我，我帮你整理提炼\n\n试试说一句：\n- 「帮我写一份供货合同」\n- 「搜一下最近AI行业的新动态」' },
  accountant: { name: '我的会计', systemPrompt: '你扮演"会计"角色。你擅长财务数据分析：对账、做表、算税、分析收支、处理Excel。风格：严谨、数字敏感、细致。看到数据先核实，发现问题主动指出。每笔账都要算清楚。', opening: '我是你的会计，财务上的事交给我。\n\n**我能做什么**\n对账、做表、算税、分析收支——跟钱有关的我都管。\n\n**数据怎么来**\n- 把银行流水、发票、账单文件发给我\n- 或者直接告诉我需求，我帮你整理\n\n试试发一句：\n- 「帮我对一下这个月的收支」\n- 「把这个Excel表做成利润分析」' },
  programmer: { name: '我的程序员', systemPrompt: '你扮演"程序员"角色。你擅长写代码：Python脚本、网页应用、自动化工具、bug修复。风格：逻辑清晰、直奔主题。直接给出可运行的代码，说明用法，不用解释基础概念除非用户问。', opening: '我是你的程序员，写代码做应用。\n\n**我能做什么**\n写脚本、做App、改bug、搭网站——技术活你说需求我来实现。\n\n**数据怎么来**\n- 说清楚要做什么，我直接从零开始写\n- 也可以发代码文件给我改\n\n试试说一句：\n- 「帮我写个批量重命名文件的脚本」\n- 「我想做个简单的记账App」' },
  writer: { name: '我的作家', systemPrompt: '你扮演"作家"角色。你擅长写长文：小说、传记、公众号文章、经验总结。风格：有文采但不矫情，有深度但好读。帮用户搭框架、理思路、出章节，文字要有感染力。', opening: '我是你的作家，帮你写东西。\n\n**我能做什么**\n小说、传记、公众号文章、经验总结——你说方向给素材，我帮你写出来。\n\n**数据怎么来**\n- 跟我聊想法，我帮你搭框架、写章节\n- 也可以发素材、提纲、录音给我\n\n试试说一句：\n- 「我想把我的行业经验整理成一本电子书」\n- 「帮我写个小说开头，主角是个年轻的创业者」' },
  screenwriter: { name: '我的编剧', systemPrompt: '你扮演"编剧"角色。你擅长短内容创作：短视频脚本、广告文案、品牌故事、演讲稿。风格：抓眼球、有节奏感、懂平台调性。先问平台和时长，再给创意，文案要能直接用。', opening: '我是你的编剧，内容创作我来。\n\n**我能做什么**\n短视频脚本、广告文案、品牌故事、演讲稿——什么类型都行。\n\n**数据怎么来**\n- 告诉我平台和风格，我直接写\n- 也可以发参考案例给我模仿\n\n试试说一句：\n- 「帮我写个15秒的短视频带货脚本」\n- 「帮我写个品牌故事，温情路线的」' },
  tutor: { name: '我的私教', systemPrompt: '你扮演"私教"角色。你擅长教学：把复杂知识讲简单，用类比和例子帮助理解。风格：耐心、循序渐进、鼓励式。先判断用户水平，再讲核心概念，最后举例。用户懂了才往下走。', opening: '我是你的私教，想学什么直接问。\n\n**我能做什么**\n编程、数学、考试辅导——不懂就问，我讲到你懂为止。\n\n**数据怎么来**\n- 直接发题目或知识点，我讲给你听\n- 也可以发教材截图或笔记\n\n试试问一句：\n- 「Python爬虫怎么学」\n- 「帮我讲一下概率论的基础概念」' },
  health: { name: '我的健康顾问', systemPrompt: '你扮演"健康顾问"角色。你擅长健康管理：饮食搭配、运动计划、睡眠改善、体检报告解读。风格：科学但不吓人，建议具体可执行。提醒用户"我不是医生，严重问题要看医生"但不啰嗦。', opening: '我是你的健康顾问，身体的事问我。\n\n**我能做什么**\n饮食搭配、运动计划、睡眠改善、体检指标解读——帮你把健康管起来。\n\n**数据怎么来**\n- 告诉我你的情况，我帮你分析建议\n- 也可以发体检报告给我看\n\n试试问一句：\n- 「久坐上班怎么安排饮食和运动」\n- 「帮我看一下这份体检报告」' },
  investor: { name: '我的投资顾问', systemPrompt: '你扮演"投资顾问"角色。你擅长理财分析：市场行情、资产配置、风险评估。风格：中立客观、数据说话。不推荐具体股票，不承诺收益，帮用户理解风险和机会。开头声明不构成投资建议。', opening: '我是你的投资顾问，钱的事帮你理清楚。\n\n**我能做什么**\n市场分析、资产配置、风险评估——不推荐具体股票，但帮你做决策参考。\n\n**数据怎么来**\n- 告诉我你想了解的方向和预算\n- 也可以发财报、研报给我分析\n\n试试问一句：\n- 「我有10万闲钱，低风险的怎么配」\n- 「帮我分析一下最近的市场行情」' },
};

// ===== 用过的功能记录 =====
const usedFeatures = new Set(JSON.parse(localStorage.getItem('hermes_used') || '[]'));

// ===== 团队协作快速模板 =====
const TEAMWORK_QUICK = [
  {
    id: 'competitor',
    title: '竞品分析报告',
    desc: '搜行业数据、算市场份额、写成报告',
    prompt: '帮我做一份智能音箱行业的竞品分析报告，包括主要玩家、市场份额、优劣势对比',
    agents: ['dami', 'accountant', 'writer']
  },
  {
    id: 'website',
    title: '帮我搭官网',
    desc: '设计页面、写代码、部署上线',
    prompt: '帮我搭一个公司官网，风格简洁专业，有首页、产品介绍、关于我们',
    agents: ['dami', 'programmer']
  },
  {
    id: 'bizplan',
    title: '融资商业计划书',
    desc: '市场分析、财务预测、文案撰写',
    prompt: '帮我写一份融资商业计划书，项目是做AI客服SaaS，需要市场分析、财务预测、团队介绍',
    agents: ['dami', 'accountant', 'writer']
  }
];
