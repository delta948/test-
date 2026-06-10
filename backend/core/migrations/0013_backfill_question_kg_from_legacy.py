from django.db import migrations


QUESTION_FIELDS = ['text', 'option_a', 'option_b', 'option_c', 'option_d']


def copy_existing_legacy_to_kg(apps, schema_editor):
    Question = apps.get_model('core', 'Question')
    for question in Question.objects.all().iterator():
        updates = {}
        for field in QUESTION_FIELDS:
            legacy_value = getattr(question, field, '') or ''
            kg_field = f'{field}_ky'
            if legacy_value and not getattr(question, kg_field, ''):
                updates[kg_field] = legacy_value
        if updates:
            Question.objects.filter(pk=question.pk).update(**updates)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_question_bilingual_fields'),
    ]

    operations = [
        migrations.RunPython(copy_existing_legacy_to_kg, migrations.RunPython.noop),
    ]
