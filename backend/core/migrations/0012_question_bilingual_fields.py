from django.db import migrations, models


QUESTION_FIELDS = ['text', 'option_a', 'option_b', 'option_c', 'option_d']


def copy_existing_ru(apps, schema_editor):
    Question = apps.get_model('core', 'Question')
    for question in Question.objects.all().iterator():
        updates = {}
        for field in QUESTION_FIELDS:
            value = getattr(question, field, '') or ''
            ru_field = f'{field}_ru'
            if value and not getattr(question, ru_field, ''):
                updates[ru_field] = value
        if updates:
            Question.objects.filter(pk=question.pk).update(**updates)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0011_question_option_d'),
    ]

    operations = [
        migrations.AddField(
            model_name='question',
            name='text_ru',
            field=models.TextField(blank=True, default='', verbose_name='Текст вопроса на русском'),
        ),
        migrations.AddField(
            model_name='question',
            name='text_ky',
            field=models.TextField(blank=True, default='', verbose_name='Текст вопроса на кыргызском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_a_ru',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант A на русском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_a_ky',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант A на кыргызском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_b_ru',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант B на русском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_b_ky',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант B на кыргызском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_c_ru',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант C на русском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_c_ky',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант C на кыргызском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_d_ru',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант D на русском'),
        ),
        migrations.AddField(
            model_name='question',
            name='option_d_ky',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант D на кыргызском'),
        ),
        migrations.RunPython(copy_existing_ru, migrations.RunPython.noop),
    ]
