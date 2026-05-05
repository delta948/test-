#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from core.models import Test, User, Attempt, Question

print("=== ИСПРАВЛЕНИЕ ДАННЫХ ===")

# Находим учителя
teacher = User.objects.filter(role='teacher').first()
if not teacher:
    teacher = User.objects.filter(is_staff=True).first()
print(f"Учитель: {teacher.username} (ID: {teacher.id})")

# Удаляем все старые попытки ученика
student = User.objects.filter(username='student1').first()
if student:
    deleted = Attempt.objects.filter(student=student).delete()
    print(f"Удалено попыток ученика: {deleted[0]}")

# Проверяем тесты
print(f"\nТестов: {Test.objects.count()}")
for t in Test.objects.all():
    q_count = t.questions.count()
    print(f"  ID {t.id}: {t.title} - {q_count} вопросов")
    
    # Проверяем что вопросы привязаны
    if q_count == 0:
        print(f"    ⚠️ Нет вопросов! Привязываем...")
        # Привязываем вопросы учителя к тесту
        questions = Question.objects.filter(created_by=teacher)[:25]
        t.questions.set(questions)
        print(f"    ✅ Добавлено {questions.count()} вопросов")

# Проверяем что у ученика нет попыток
if student:
    print(f"\nПопыток у student1: {Attempt.objects.filter(student=student).count()}")

print("\n=== ГОТОВО ===")
print("Теперь можно начать тест!")
