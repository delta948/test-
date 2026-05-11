import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

admin = User.objects.filter(username='admin').first()
if admin:
    admin.is_main_teacher = True
    admin.save()
    print(f"✅ {admin.username} теперь главный учитель")
else:
    print("❌ Пользователь admin не найден")
