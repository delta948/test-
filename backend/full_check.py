#!/usr/bin/env python
import os
import sys

os.environ['DJANGO_SETTINGS_MODULE'] = 'video_test.settings'
sys.path.insert(0, 'c:/Users/Admin/Desktop/test/backend')

import django
django.setup()

from core.models import User, Test, Question, Attempt
from django.test import Client

print("=" * 60)
print("ПОЛНАЯ ДИАГНОСТИКА СИСТЕМЫ")
print("=" * 60)

# 1. Проверяем пользователей
print("\n1. ПОЛЬЗОВАТЕЛИ:")
for u in User.objects.all():
    print(f"   - {u.username} (role: {u.role}, staff: {u.is_staff})")

# 2. Проверяем тесты
print("\n2. ТЕСТЫ:")
for t in Test.objects.all():
    q_count = t.questions.count()
    status = "✅" if t.is_active and q_count > 0 else "❌"
    print(f"   {status} ID {t.id}: {t.title}")
    print(f"      is_active: {t.is_active}, questions: {q_count}")
    if q_count == 0:
        print(f"      ⚠️ НЕТ ВОПРОСОВ!")

# 3. Проверяем вопросы
print("\n3. ВОПРОСЫ:")
print(f"   Всего: {Question.objects.count()}")

# 4. Проверяем попытки
student = User.objects.filter(username='student1').first()
if student:
    print(f"\n4. ПОПЫТКИ student1:")
    attempts = Attempt.objects.filter(student=student)
    print(f"   Всего: {attempts.count()}")
    for a in attempts:
        print(f"   - Test {a.test.id}: {a.status} (created: {a.created_at})")

# 5. Тестируем API
print("\n5. API ТЕСТ:")
client = Client()

# Логин
resp = client.post('/api/token/', {'username': 'student1', 'password': '123'})
print(f"   Login: {resp.status_code}")

if resp.status_code == 200:
    data = resp.json()
    token = data.get('access')
    print(f"   Token received: {'✅' if token else '❌'}")
    
    # Пробуем начать тест
    test = Test.objects.first()
    if test:
        print(f"\n   Testing start for Test ID {test.id}...")
        resp = client.post(
            f'/api/student/tests/{test.id}/start/',
            HTTP_AUTHORIZATION=f'Bearer {token}'
        )
        print(f"   Response: {resp.status_code}")
        content = resp.content.decode()
        if resp.status_code == 201:
            print(f"   ✅ SUCCESS! Attempt created.")
            print(f"   Response: {content[:200]}")
        else:
            print(f"   ❌ ERROR!")
            print(f"   Details: {content}")
    else:
        print("   ❌ No tests found!")
else:
    print(f"   Login failed: {resp.content.decode()}")

print("\n" + "=" * 60)
print("ДИАГНОСТИКА ЗАВЕРШЕНА")
print("=" * 60)
