from django.db import migrations


def add_special_training_trigger(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    QuestionTrigger.objects.update_or_create(
        slug='special-training',
        defaults={
            'name': 'Специальная подготовка',
            'description': '',
            'is_active': True,
        },
    )


def remove_special_training_trigger(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    QuestionTrigger.objects.filter(
        slug='special-training',
        questions__isnull=True,
        tests__isnull=True,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0019_test_is_translation_from_ky_test_language'),
    ]

    operations = [
        migrations.RunPython(add_special_training_trigger, remove_special_training_trigger),
    ]
