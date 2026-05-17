import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'pages/login_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const ProviderScope(child: HergentApp()));
}

class HergentApp extends StatelessWidget {
  const HergentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hergent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF06B6D4),
        scaffoldBackgroundColor: const Color(0xFFF8F9FB),
        fontFamily: 'PingFang SC',
      ),
      home: const LoginPage(),
    );
  }
}
