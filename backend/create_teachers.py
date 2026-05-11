import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

teachers = [
    {'username': 'teacher1', 'first_name': 'Учитель', 'last_name': '1', 'password': '123'},
    {'username': 'teacher2', 'first_name': 'Учитель', 'last_name': '2', 'password': '123'},
    {'username': 'teacher3', 'first_name': 'Учитель', 'last_name': '3', 'password': '123'},
]

for t in teachers:
    if User.objects.filter(username=t['username']).exists():
        print(f"❌ {t['username']} уже существует")
    else:
        user = User.objects.create_user(
            username=t['username'],
            first_name=t['first_name'],
            last_name=t['last_name'],
            password=t['password'],
            role='teacher'
        )
        print(f"✅ {t['username']} создан (пароль: {t['password']})")

print(f"\nВсего учителей: {User.objects.filter(role='teacher').count()}")
