import os
import django
import csv

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'video_test.settings')
django.setup()

from core.models import Question

bad = Question.objects.filter(text_ru='') | Question.objects.filter(text_ru__isnull=True)

with open('missing_ru_questions.csv', 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.writer(f)
    writer.writerow([
        'id',
        'text_ky',
        'text_ru',
        'option_a_ky',
        'option_a_ru',
        'option_b_ky',
        'option_b_ru',
        'option_c_ky',
        'option_c_ru',
        'option_d_ky',
        'option_d_ru',
    ])

    for q in bad:
        writer.writerow([
            q.id,
            q.text_ky or q.text,
            q.text_ru,
            q.option_a_ky or q.option_a,
            q.option_a_ru,
            q.option_b_ky or q.option_b,
            q.option_b_ru,
            q.option_c_ky or q.option_c,
            q.option_c_ru,
            q.option_d_ky or q.option_d,
            q.option_d_ru,
        ])

print("Готово. Файл создан: missing_ru_questions.csv")
print("Количество вопросов:", bad.count())