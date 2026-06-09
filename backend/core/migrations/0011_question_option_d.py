from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_attempt_selected_trigger'),
    ]

    operations = [
        migrations.AddField(
            model_name='question',
            name='option_d',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Вариант D'),
        ),
        migrations.AlterField(
            model_name='answer',
            name='selected_option',
            field=models.CharField(
                choices=[
                    ('A', 'Вариант A'),
                    ('B', 'Вариант B'),
                    ('C', 'Вариант C'),
                    ('D', 'Вариант D'),
                ],
                max_length=1,
            ),
        ),
        migrations.AlterField(
            model_name='question',
            name='correct_answer',
            field=models.CharField(
                choices=[
                    ('A', 'Вариант A'),
                    ('B', 'Вариант B'),
                    ('C', 'Вариант C'),
                    ('D', 'Вариант D'),
                ],
                max_length=1,
                verbose_name='Правильный ответ',
            ),
        ),
    ]
