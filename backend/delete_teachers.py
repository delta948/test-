import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

teachers_to_delete = ['teacher1', 'teacher2', 'teacher3']

for username in teachers_to_delete:
    try:
        user = User.objects.get(username=username)
        user.delete()
        print(f"✅ {username} удален")
    except User.DoesNotExist:
        print(f"❌ {username} не найден")

print(f"\nОсталось учителей: {User.objects.filter(role='teacher').count()}")
