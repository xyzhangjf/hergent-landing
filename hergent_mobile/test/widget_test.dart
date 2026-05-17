import 'package:flutter_test/flutter_test.dart';
import 'package:hergent_mobile/main.dart';

void main() {
  testWidgets('App starts', (WidgetTester tester) async {
    await tester.pumpWidget(const HergentApp());
    expect(find.text('Hergent'), findsOneWidget);
  });
}
