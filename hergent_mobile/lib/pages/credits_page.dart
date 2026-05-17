import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';

class CreditsPage extends ConsumerStatefulWidget {
  const CreditsPage({super.key});

  @override
  ConsumerState<CreditsPage> createState() => _CreditsPageState();
}

class _CreditsPageState extends ConsumerState<CreditsPage> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(creditsProvider.notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final creditsState = ref.watch(creditsProvider);
    final credits = creditsState.value ?? 0;

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text('积分', style: TextStyle(color: Colors.black87, fontWeight: FontWeight.w600)),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 积分卡片
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF06B6D4), Color(0xFF0891B2)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                const Text('可用积分', style: TextStyle(color: Colors.white70, fontSize: 14)),
                const SizedBox(height: 8),
                creditsState.isLoading
                    ? const CircularProgressIndicator(color: Colors.white)
                    : Text(
                        '$credits',
                        style: const TextStyle(color: Colors.white, fontSize: 48, fontWeight: FontWeight.w700, letterSpacing: -2),
                      ),
                const SizedBox(height: 4),
                Text('约 ${credits ~/ 2} 次对话', style: const TextStyle(color: Colors.white54, fontSize: 13)),
              ],
            ),
          ),
          const SizedBox(height: 24),
          // 充值档位
          const Text('充值', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          const Text('按量充值，永不过期', style: TextStyle(fontSize: 13, color: Colors.grey)),
          const SizedBox(height: 16),
          _tierCard('10 元', '1,000 积分', '约 200 次对话', false),
          _tierCard('30 元', '3,000 积分', '约 600 次对话', false),
          _tierCard('50 元', '5,500 积分', '多送 500 积分', true),
          const SizedBox(height: 24),
          const Text('消费记录', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.grey.shade100),
            ),
            child: const Center(
              child: Text('暂无消费记录', style: TextStyle(color: Colors.grey, fontSize: 14)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tierCard(String price, String credits, String desc, bool recommended) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: recommended ? const Color(0xFF06B6D4) : Colors.grey.shade200,
          width: recommended ? 1.5 : 1,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(price, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                    if (recommended) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF06B6D4).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('推荐', style: TextStyle(fontSize: 11, color: Color(0xFF06B6D4), fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Text(credits, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                Text(desc, style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(
              backgroundColor: recommended ? const Color(0xFF06B6D4) : Colors.grey.shade100,
              foregroundColor: recommended ? Colors.white : Colors.black87,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('充值'),
          ),
        ],
      ),
    );
  }
}
