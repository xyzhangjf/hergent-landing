class User {
  final String id;
  final String phone;
  final String? nickname;
  final int credits;
  final String token;

  User({
    required this.id,
    required this.phone,
    this.nickname,
    required this.credits,
    required this.token,
  });

  factory User.fromJson(Map<String, dynamic> json, String token) {
    return User(
      id: json['id']?.toString() ?? json['user_id']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      nickname: json['nickname']?.toString(),
      credits: (json['credits'] ?? 0) as int,
      token: token,
    );
  }
}

class ChatMessage {
  final String role; // 'user' | 'assistant'
  final String content;
  final DateTime time;

  ChatMessage({
    required this.role,
    required this.content,
    DateTime? time,
  }) : time = time ?? DateTime.now();
}
