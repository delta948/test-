from django.db import migrations


def add_officer_trigger(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    QuestionTrigger.objects.update_or_create(
        slug='officer',
        defaults={
            'name': 'Контрольный срез знаний офицерского состава',
            'description': '',
            'is_active': True,
        },
    )


def remove_officer_trigger(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    QuestionTrigger.objects.filter(slug='officer', questions__isnull=True, tests__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0013_backfill_question_kg_from_legacy'),
    ]

    operations = [
        migrations.RunPython(add_officer_trigger, remove_officer_trigger),
    ]
