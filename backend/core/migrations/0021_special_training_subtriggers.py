from django.db import migrations, models
import django.db.models.deletion


SUBTRIGGERS = (
    ('communications-training', 'Подготовка по связи'),
    ('engineering-training', 'Инженерная подготовка'),
    ('logistics-training', 'Подготовка по тыловому обеспечению'),
    ('armament-training', 'Подготовка по вооружению'),
    ('air-defense-training', 'Подготовка по противо-воздушной обороне'),
)


def add_special_training_subtriggers(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    parent, _ = QuestionTrigger.objects.update_or_create(
        slug='special-training',
        defaults={
            'name': 'Специальная подготовка',
            'description': '',
            'is_active': True,
        },
    )

    for slug, name in SUBTRIGGERS:
        trigger, _ = QuestionTrigger.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'description': '',
                'is_active': True,
            },
        )
        if trigger.parent_id != parent.id:
            trigger.parent = parent
            trigger.save(update_fields=['parent'])


def remove_special_training_subtriggers(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    QuestionTrigger.objects.filter(
        slug__in=[slug for slug, _name in SUBTRIGGERS],
        questions__isnull=True,
        tests__isnull=True,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_add_special_training_trigger'),
    ]

    operations = [
        migrations.AddField(
            model_name='questiontrigger',
            name='parent',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='children',
                to='core.questiontrigger',
                verbose_name='Родительский триггер',
            ),
        ),
        migrations.RunPython(add_special_training_subtriggers, remove_special_training_subtriggers),
    ]
