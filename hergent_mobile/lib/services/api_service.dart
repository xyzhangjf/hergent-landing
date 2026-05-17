import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config.dart';

class ApiService {
  static final ApiService _instance = ApiService._();
  factory ApiService() => _instance;
  ApiService._();

  final Dio _dio = Dio(BaseOptions(
    baseUrl: AppConfig.baseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 60),
  ));
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  String? _token;

  // ========== Token 管理 ==========
  Future<void> setToken(String token) async {
    _token = token;
    await _storage.write(key: 'jwt_token', value: token);
  }

  Future<String?> getToken() async {
    _token ??= await _storage.read(key: 'jwt_token');
    return _token;
  }

  Future<void> clearToken() async {
    _token = null;
    await _storage.delete(key: 'jwt_token');
  }

  Map<String, String> _headers() {
    final h = <String, String>{'Content-Type': 'application/json'};
    if (_token != null) h['Authorization'] = 'Bearer $_token';
    return h;
  }

  // ========== 认证 ==========
  Future<Map<String, dynamic>> sendCode(String phone) async {
    final r = await _dio.post('/api/auth/send-code', data: {'phone': phone});
    return r.data;
  }

  Future<Map<String, dynamic>> verifyCode(String phone, String code) async {
    final r = await _dio.post('/api/auth/verify-code', data: {
      'phone': phone,
      'code': code,
    });
    final data = r.data;
    if (data['token'] != null) {
      await setToken(data['token']);
    }
    return data;
  }

  // ========== 积分 ==========
  Future<Map<String, dynamic>> getCredits() async {
    final r = await _dio.get('/api/credits', options: Options(headers: _headers()));
    return r.data;
  }

  Future<Map<String, dynamic>> getRechargeTiers() async {
    final r = await _dio.get('/api/recharge/tiers');
    return r.data;
  }

  // ========== AI 对话 (SSE 流式) ==========
  Stream<String> chat({
    required String role,
    required List<Map<String, String>> messages,
  }) async* {
    final requestBody = {
      'model': 'deepseek-chat',
      'messages': messages,
      'stream': true,
      'max_tokens': 4096,
    };

    final response = await _dio.post(
      '/v1/chat/completions',
      data: requestBody,
      options: Options(
        headers: _headers(),
        responseType: ResponseType.stream,
      ),
    );

    final stream = response.data.stream as Stream<List<int>>;
    final buffer = StringBuffer();

    await for (final chunk in stream) {
      buffer.write(utf8.decode(chunk));
      final lines = buffer.toString().split('\n');
      buffer.clear();

      for (int i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (i == lines.length - 1 && !line.endsWith('\n')) {
          buffer.write(line);
          continue;
        }
        if (line.startsWith('data: ') && line.length > 6) {
          final data = line.substring(6).trim();
          if (data == '[DONE]') return;
          try {
            final json = jsonDecode(data);
            final content = json['choices']?[0]?['delta']?['content'];
            if (content != null && content is String) {
              yield content;
            }
          } catch (_) {}
        }
      }
    }
  }
}
