#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from core.models import Test, User, Attempt

print("=== ПРОВЕРКА ДАННЫХ ===")

# Тесты
print(f"\nТестов: {Test.objects.count()}")
for t in Test.objects.all():
    print(f"  ID {t.id}: {t.title}")
    print(f"    is_active: {t.is_active}")
    print(f"    questions: {t.questions.count()}")

# Ученик
student = User.objects.filter(username='student1').first()
if student:
    print(f"\nУченик student1 (ID: {student.id})")
    
    # Попытки
    attempts = Attempt.objects.filter(student=student)
    print(f"Попыток: {attempts.count()}")
    for a in attempts:
        print(f"  ID {a.id}: test={a.test.id}, status={a.status}")
else:
    print("\nУченик student1 не найден!")
    
print("\n=== КОНЕЦ ===")
