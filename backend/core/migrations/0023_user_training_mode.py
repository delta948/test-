from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0022_alter_user_role'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='training_mode',
            field=models.BooleanField(default=False, verbose_name='Training mode'),
        ),
    ]
