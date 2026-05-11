import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

admin = User.objects.filter(username='admin').first()
if admin:
    admin.set_password('123')
    admin.save()
    print(f"✅ Пароль admin сброшен на '123'")
    print(f"   is_active: {admin.is_active}")
    print(f"   is_main_teacher: {admin.is_main_teacher}")
    print(f"   role: {admin.role}")
else:
    print("❌ Пользователь admin не найден")
