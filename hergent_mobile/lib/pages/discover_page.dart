import 'package:flutter/material.dart';
import '../config.dart';

class DiscoverPage extends StatelessWidget {
  const DiscoverPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text('发现', style: TextStyle(color: Colors.black87, fontWeight: FontWeight.w600)),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 角色卡片
          const Text('8 位数字员工', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          const Text('每个角色有专属技能，随时切换',
              style: TextStyle(fontSize: 13, color: Colors.grey)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: AppConfig.roles.map((r) {
              return Container(
                width: (MediaQuery.of(context).size.width - 54) / 2,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.grey.shade100),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r['emoji']!, style: const TextStyle(fontSize: 32)),
                    const SizedBox(height: 8),
                    Text(r['name']!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(r['desc']!, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                  ],
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 32),
          // 使用场景
          const Text('使用场景', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          _scenarioCard('📝', '写周报', '告诉大秘你做了什么，她帮你整理成漂亮的周报'),
          _scenarioCard('💰', '理财分析', '把账单发给会计，帮你分析消费习惯'),
          _scenarioCard('🐛', '调试代码', '程序员帮你找 bug、写脚本、优化代码'),
          _scenarioCard('📖', '学习辅导', '家教用通俗的方式讲解任何知识点'),
          _scenarioCard('🎨', '创意文案', '作家帮你写公众号、小红书、营销文案'),
          _scenarioCard('💊', '健康咨询', '输入症状或体检报告，健康顾问给你建议'),
        ],
      ),
    );
  }

  Widget _scenarioCard(String emoji, String title, String desc) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade100),
      ),
      child: Row(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 28)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(desc, style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: Colors.grey.shade400),
        ],
      ),
    );
  }
}
