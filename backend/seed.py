#!/usr/bin/env python
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

django.setup()

from django.contrib.auth import get_user_model
from core.models import Question, Test, Attempt, Answer, StudentProfile

User = get_user_model()


def create_teacher():
    """Создает учителя admin/admin"""
    teacher, created = User.objects.get_or_create(
        username='admin',
        defaults={
            'email': 'admin@test.com',
            'role': 'teacher',
            'first_name': 'Админ',
            'last_name': 'Учитель'
        }
    )
    if created:
        teacher.set_password('admin')
        teacher.save()
        print(f"Создан учитель: {teacher.username} / пароль: admin")
    else:
        print(f"Учитель {teacher.username} уже существует")
    return teacher


def create_students():
    """Создает 50 учеников student1..student50 с паролем 123"""
    students = []
    for i in range(1, 51):
        username = f'student{i}'
        student, created = User.objects.get_or_create(
            username=username,
            defaults={
                'email': f'{username}@test.com',
                'role': 'student',
                'first_name': f'Ученик',
                'last_name': f'{i}'
            }
        )
        if created:
            student.set_password('123')
            student.save()
            StudentProfile.objects.create(user=student)
            students.append(student)
            print(f"Создан ученик: {student.username} / пароль: 123")
        else:
            print(f"Ученик {student.username} уже существует")
            students.append(student)
    return students


def create_questions(teacher):
    """Создает 100 вопросов с вариантами A/B/C и правильным ответом A"""
    questions = []
    existing_count = Question.objects.filter(created_by=teacher).count()
    
    if existing_count >= 100:
        print(f"Вопросы уже созданы ({existing_count} шт.)")
        return list(Question.objects.filter(created_by=teacher)[:100])
    
    for i in range(1, 101):
        question, created = Question.objects.get_or_create(
            text=f'Вопрос {i}',
            created_by=teacher,
            defaults={
                'option_a': 'Вариант A',
                'option_b': 'Вариант B',
                'option_c': 'Вариант C',
                'correct_answer': 'A'
            }
        )
        questions.append(question)
        if created:
            print(f"Создан вопрос #{i}: {question.text}")
        else:
            print(f"Вопрос #{i} уже существует")
    
    return questions


def create_test(teacher, questions):
    """Создает тест со всеми 100 вопросами"""
    if len(questions) < 100:
        print(f"Ошибка: нужно 100 вопросов, есть {len(questions)}")
        return None
    
    test, created = Test.objects.get_or_create(
        title='Тест на 100 вопросов',
        teacher=teacher,
        defaults={'is_active': True}
    )
    
    if created:
        test.questions.set(questions[:100])
        print(f"Создан тест: {test.title} с {test.questions.count()} вопросами")
    else:
        if test.questions.count() < 100:
            test.questions.set(questions[:100])
            test.save()
            print(f"Обновлен тест: {test.title}, теперь {test.questions.count()} вопросов")
        else:
            print(f"Тест {test.title} уже существует с {test.questions.count()} вопросами")
    
    return test


def seed_all():
    """Запускает все функции создания демо-данных"""
    print("=" * 50)
    print("НАЧАЛО СОЗДАНИЯ ДЕМО-ДАННЫХ")
    print("=" * 50)
    
    teacher = create_teacher()
    students = create_students()
    questions = create_questions(teacher)
    test = create_test(teacher, questions)
    
    print("=" * 50)
    print("ИТОГО:")
    print(f"- Учителей: {User.objects.filter(role='teacher').count()}")
    print(f"- Учеников: {User.objects.filter(role='student').count()}")
    print(f"- Вопросов: {Question.objects.count()}")
    print(f"- Тестов: {Test.objects.count()}")
    print("=" * 50)
    print("ДЕМО-ДАННЫЕ СОЗДАНЫ УСПЕШНО!")
    print("=" * 50)


if __name__ == '__main__':
    seed_all()
