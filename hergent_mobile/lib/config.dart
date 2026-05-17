/// Hergent Mobile — 全局配置
class AppConfig {
  static const String appName = 'Hergent';
  static const String baseUrl = 'https://api.hergent.cn';

  // 8 位数字员工
  static const List<Map<String, String>> roles = [
    {'id': 'dami', 'name': '大秘', 'emoji': '📋', 'desc': '文书、搜索、提醒、安排'},
    {'id': 'programmer', 'name': '程序员', 'emoji': '💻', 'desc': '写代码、debug、脚本'},
    {'id': 'writer', 'name': '作家', 'emoji': '✍️', 'desc': '文章、文案、润色'},
    {'id': 'accountant', 'name': '会计', 'emoji': '📊', 'desc': '算账、报表、分析'},
    {'id': 'screenwriter', 'name': '编剧', 'emoji': '🎬', 'desc': '剧本、故事、创意'},
    {'id': 'tutor', 'name': '家教', 'emoji': '📚', 'desc': '教学、答疑、讲解'},
    {'id': 'health', 'name': '健康顾问', 'emoji': '💊', 'desc': '健康咨询、饮食建议'},
    {'id': 'investor', 'name': '投资人', 'emoji': '📈', 'desc': '投资分析、市场研究'},
  ];

  // 角色 System Prompt (精简版)
  static String systemPrompt(String roleId) {
    return '你是 Hergent 的$roleId角色。请用中文回复，简洁专业。';
  }
}
