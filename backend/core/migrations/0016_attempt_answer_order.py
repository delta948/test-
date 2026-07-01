from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0015_question_explanation_alter_question_option_a_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='attempt',
            name='answer_order',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
