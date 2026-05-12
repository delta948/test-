from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0005_attempt_question_order'),
    ]

    operations = [
        migrations.AddField(
            model_name='studentprofile',
            name='military_rank',
            field=models.CharField(blank=True, max_length=100, verbose_name='Воинское звание'),
        ),
        migrations.AddField(
            model_name='studentprofile',
            name='patronymic',
            field=models.CharField(blank=True, max_length=150, verbose_name='Отчество'),
        ),
    ]
