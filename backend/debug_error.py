#!/usr/bin/env python
import os
import sys

os.environ['DJANGO_SETTINGS_MODULE'] = 'video_test.settings'

import django
django.setup()

from django.test import Client
from core.models import User, Test, Attempt

client = Client()

print("=== ДИАГНОСТИКА ОШИБКИ ===\n")

# Проверяем student1
student = User.objects.filter(username='student1').first()
if not student:
    print("❌ Ученик student1 не найден!")
    sys.exit(1)
print(f"✓ Ученик: {student.username} (ID: {student.id})")

# Проверяем попытки
attempts = Attempt.objects.filter(student=student)
print(f"✓ Попыток у ученика: {attempts.count()}")
for a in attempts:
    print(f"   - Test {a.test.id}: {a.status}")

# Проверяем тесты
print(f"\n✓ Тестов: {Test.objects.count()}")
for t in Test.objects.all():
    q_count = t.questions.count()
    print(f"   - ID {t.id}: {t.title}")
    print(f"     is_active: {t.is_active}, questions: {q_count}")

# Пробуем логин
print("\n=== ПРОБУЕМ ЛОГИН ===")
response = client.post('/api/token/', {'username': 'student1', 'password': '123'})
print(f"Login status: {response.status_code}")

if response.status_code == 200:
    data = response.json()
    token = data.get('access')
    print(f"✓ Получен токен (первые 20 символов): {token[:20]}...")
    
    # Пробуем начать тест
    print("\n=== ПРОБУЕМ НАЧАТЬ ТЕСТ ===")
    test = Test.objects.first()
    if test:
        print(f"Test ID: {test.id}")
        response = client.post(
            f'/api/student/tests/{test.id}/start/',
            HTTP_AUTHORIZATION=f'Bearer {token}'
        )
        print(f"Status: {response.status_code}")
        content = response.content.decode()
        print(f"Response: {content[:500]}")
        
        if response.status_code != 201:
            print("\n❌ ОШИБКА ПРИ НАЧАЛЕ ТЕСТА!")
            print(f"Детали: {content}")
    else:
        print("❌ Нет тестов!")
else:
    print(f"❌ Ошибка логина: {response.content.decode()}")

print("\n=== КОНЕЦ ДИАГНОСТИКИ ===")
