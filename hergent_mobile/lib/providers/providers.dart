import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../services/api_service.dart';

// ========== 认证 ==========
final authProvider = StateNotifierProvider<AuthNotifier, AsyncValue<User?>>((ref) {
  return AuthNotifier();
});

class AuthNotifier extends StateNotifier<AsyncValue<User?>> {
  final _api = ApiService();

  AuthNotifier() : super(const AsyncValue.data(null)) {
    _tryRestoreToken();
  }

  Future<void> _tryRestoreToken() async {
    final token = await _api.getToken();
    if (token != null) {
      state = const AsyncValue.loading();
      try {
        // 用 token 获取用户信息（如果后端不支持，就跳过）
        state = const AsyncValue.data(null); // 暂时，登录后再设置
      } catch (_) {
        await _api.clearToken();
        state = const AsyncValue.data(null);
      }
    }
  }

  Future<void> login(String phone, String code) async {
    state = const AsyncValue.loading();
    try {
      final data = await _api.verifyCode(phone, code);
      final user = User.fromJson(data, data['token'] ?? '');
      state = AsyncValue.data(user);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> logout() async {
    await _api.clearToken();
    state = const AsyncValue.data(null);
  }
}

// ========== 积分 ==========
final creditsProvider = StateNotifierProvider<CreditsNotifier, AsyncValue<int>>((ref) {
  return CreditsNotifier();
});

class CreditsNotifier extends StateNotifier<AsyncValue<int>> {
  final _api = ApiService();
  CreditsNotifier() : super(const AsyncValue.data(0));

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final data = await _api.getCredits();
      final credits = (data['credits'] ?? 0) as int;
      state = AsyncValue.data(credits);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }
}

// ========== 聊天 ==========
class ChatState {
  final List<ChatMessage> messages;
  final bool isStreaming;
  final String streamingContent;

  ChatState({
    this.messages = const [],
    this.isStreaming = false,
    this.streamingContent = '',
  });

  ChatState copyWith({
    List<ChatMessage>? messages,
    bool? isStreaming,
    String? streamingContent,
  }) {
    return ChatState(
      messages: messages ?? this.messages,
      isStreaming: isStreaming ?? this.isStreaming,
      streamingContent: streamingContent ?? this.streamingContent,
    );
  }
}

final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  return ChatNotifier();
});

class ChatNotifier extends StateNotifier<ChatState> {
  final _api = ApiService();

  ChatNotifier() : super(ChatState());

  void addUserMessage(String content) {
    state = state.copyWith(
      messages: [
        ...state.messages,
        ChatMessage(role: 'user', content: content),
      ],
    );
  }

  Future<void> sendMessage(String role, String content) async {
    addUserMessage(content);

    state = state.copyWith(isStreaming: true, streamingContent: '');
    final fullContent = StringBuffer();

    // 构建消息历史
    final apiMessages = <Map<String, String>>[
      {'role': 'system', 'content': '你是 Hergent 的专业 AI。请用中文回复。'},
    ];
    for (final m in state.messages) {
      apiMessages.add({'role': m.role == 'user' ? 'user' : 'assistant', 'content': m.content});
    }

    try {
      await for (final chunk in _api.chat(role: role, messages: apiMessages)) {
        fullContent.write(chunk);
        state = state.copyWith(streamingContent: fullContent.toString());
      }

      state = state.copyWith(
        isStreaming: false,
        streamingContent: '',
        messages: [
          ...state.messages,
          ChatMessage(role: 'assistant', content: fullContent.toString()),
        ],
      );
    } catch (e) {
      state = state.copyWith(isStreaming: false, streamingContent: '');
      state = state.copyWith(
        messages: [
          ...state.messages,
          ChatMessage(role: 'assistant', content: '抱歉，出错了：$e'),
        ],
      );
    }
  }
}

// ========== 当前角色 ==========
final currentRoleProvider = StateProvider<String>((ref) => 'dami');
