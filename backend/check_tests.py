import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from core.models import Test, Question

print(f'Questions count: {Question.objects.count()}')
print(f'Tests count: {Test.objects.count()}')

for test in Test.objects.all():
    print(f'Test: {test.title}, active: {test.is_active}, questions: {test.questions.count()}')
