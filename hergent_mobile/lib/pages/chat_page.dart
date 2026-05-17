import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config.dart';
import '../providers/providers.dart';

class ChatPage extends ConsumerStatefulWidget {
  const ChatPage({super.key});

  @override
  ConsumerState<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends ConsumerState<ChatPage> {
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final _focusNode = FocusNode();

  void _send() {
    final text = _inputCtrl.text.trim();
    if (text.isEmpty) return;
    final role = ref.read(currentRoleProvider);
    _inputCtrl.clear();
    ref.read(chatProvider.notifier).sendMessage(role, text);
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(chatProvider);
    final currentRole = ref.watch(currentRoleProvider);
    final role = AppConfig.roles.firstWhere((r) => r['id'] == currentRole);

    // 自动滚动到底部
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: Text('${role['emoji']} ${role['name']}',
            style: const TextStyle(color: Colors.black87, fontWeight: FontWeight.w600)),
        centerTitle: true,
        // 角色切换
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(44),
          child: SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: AppConfig.roles.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (ctx, i) {
                final r = AppConfig.roles[i];
                final selected = r['id'] == currentRole;
                return GestureDetector(
                  onTap: () => ref.read(currentRoleProvider.notifier).state = r['id']!,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: selected ? const Color(0xFF06B6D4).withValues(alpha: 0.1) : Colors.transparent,
                      borderRadius: BorderRadius.circular(20),
                      border: selected
                          ? Border.all(color: const Color(0xFF06B6D4), width: 1.2)
                          : null,
                    ),
                    child: Text(
                      '${r['emoji']} ${r['name']}',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                        color: selected ? const Color(0xFF06B6D4) : Colors.grey.shade600,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          // 消息列表
          Expanded(
            child: chatState.messages.isEmpty && chatState.streamingContent.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.chat_bubble_outline, size: 48, color: Colors.grey),
                        SizedBox(height: 12),
                        Text('选择一个角色，开始对话', style: TextStyle(color: Colors.grey, fontSize: 15)),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollCtrl,
                    padding: const EdgeInsets.all(16),
                    itemCount: chatState.messages.length + (chatState.isStreaming ? 1 : 0),
                    itemBuilder: (ctx, i) {
                      // 最后一个是流式消息
                      if (chatState.isStreaming && i == chatState.messages.length) {
                        return _MessageBubble(
                          role: 'assistant',
                          content: chatState.streamingContent,
                          isStreaming: true,
                        );
                      }
                      final msg = chatState.messages[i];
                      return _MessageBubble(
                        role: msg.role,
                        content: msg.content,
                      );
                    },
                  ),
          ),
          // 输入框
          Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: Colors.grey.shade200)),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _inputCtrl,
                      focusNode: _focusNode,
                      maxLines: 3,
                      minLines: 1,
                      decoration: InputDecoration(
                        hintText: '跟 ${role['name']} 说点什么...',
                        hintStyle: TextStyle(color: Colors.grey.shade400, fontSize: 14),
                        filled: true,
                        fillColor: const Color(0xFFF5F5F7),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(20),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: chatState.isStreaming ? null : _send,
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: const Color(0xFF06B6D4),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Icon(Icons.send_rounded, color: Colors.white, size: 18),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final String role;
  final String content;
  final bool isStreaming;

  const _MessageBubble({
    required this.role,
    required this.content,
    this.isStreaming = false,
  });

  @override
  Widget build(BuildContext context) {
    final isUser = role == 'user';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser) ...[
            const CircleAvatar(
              radius: 16,
              backgroundColor: Color(0xFF06B6D4),
              child: Icon(Icons.bolt, color: Colors.white, size: 16),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser ? const Color(0xFF06B6D4) : Colors.white,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: isUser ? const Radius.circular(16) : const Radius.circular(4),
                  bottomRight: isUser ? const Radius.circular(4) : const Radius.circular(16),
                ),
                boxShadow: isUser
                    ? []
                    : [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 4, offset: const Offset(0, 2))],
              ),
              child: isStreaming && content.isEmpty
                  ? const SizedBox(
                      width: 20, height: 16,
                      child: Center(child: SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF06B6D4)))),
                    )
                  : Text(
                      content,
                      style: TextStyle(fontSize: 15, color: isUser ? Colors.white : Colors.black87, height: 1.5),
                    ),
            ),
          ),
          if (isUser) const SizedBox(width: 8),
        ],
      ),
    );
  }
}
