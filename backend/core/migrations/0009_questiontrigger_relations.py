from django.db import migrations, models
import django.db.models.deletion


DEFAULT_TRIGGERS = [
    ('applicant', 'Абитуриент'),
    ('sergeant_warrant', 'Контрольный срез знаний сержантов и прапорщиков'),
    ('junior_officer', 'Контрольный срез знаний младшего офицерского состава'),
    ('senior_officer', 'Контрольный срез знаний старшего офицерского состава'),
]


def migrate_trigger_data(apps, schema_editor):
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')
    Question = apps.get_model('core', 'Question')
    Test = apps.get_model('core', 'Test')

    triggers_by_slug = {}
    for slug, name in DEFAULT_TRIGGERS:
        trigger, _ = QuestionTrigger.objects.get_or_create(
            slug=slug,
            defaults={'name': name, 'is_active': True},
        )
        triggers_by_slug[slug] = trigger

    fallback = triggers_by_slug['applicant']

    for question in Question.objects.all():
        trigger = triggers_by_slug.get(getattr(question, 'legacy_trigger', ''), fallback)
        question.trigger_id = trigger.id
        question.save(update_fields=['trigger'])

    for test in Test.objects.all():
        trigger_ids = [
            triggers_by_slug[slug].id
            for slug in (getattr(test, 'legacy_triggers', None) or [])
            if slug in triggers_by_slug
        ]
        if trigger_ids:
            test.triggers.set(trigger_ids)


def reverse_trigger_data(apps, schema_editor):
    Question = apps.get_model('core', 'Question')
    Test = apps.get_model('core', 'Test')

    for question in Question.objects.select_related('trigger'):
        question.legacy_trigger = question.trigger.slug if question.trigger_id else 'applicant'
        question.save(update_fields=['legacy_trigger'])

    for test in Test.objects.prefetch_related('triggers'):
        test.legacy_triggers = list(test.triggers.values_list('slug', flat=True))
        test.save(update_fields=['legacy_triggers'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0008_testingperiod_test_testing_period_attempt_testing_period_and_summaryreport_testing_period'),
    ]

    operations = [
        migrations.CreateModel(
            name='QuestionTrigger',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255, unique=True, verbose_name='Триггер')),
                ('slug', models.SlugField(max_length=64, unique=True, verbose_name='Код')),
                ('description', models.TextField(blank=True, verbose_name='Описание')),
                ('is_active', models.BooleanField(db_index=True, default=True, verbose_name='Активен')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.RenameField(
            model_name='question',
            old_name='trigger',
            new_name='legacy_trigger',
        ),
        migrations.RenameField(
            model_name='test',
            old_name='triggers',
            new_name='legacy_triggers',
        ),
        migrations.AddField(
            model_name='question',
            name='trigger',
            field=models.ForeignKey(db_index=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='questions', to='core.questiontrigger', verbose_name='Триггер'),
        ),
        migrations.AddField(
            model_name='attempt',
            name='triggers_snapshot',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='test',
            name='triggers',
            field=models.ManyToManyField(blank=True, related_name='tests', to='core.questiontrigger', verbose_name='Триггеры'),
        ),
        migrations.RunPython(migrate_trigger_data, reverse_trigger_data),
        migrations.AlterField(
            model_name='question',
            name='trigger',
            field=models.ForeignKey(db_index=True, on_delete=django.db.models.deletion.PROTECT, related_name='questions', to='core.questiontrigger', verbose_name='Триггер'),
        ),
        migrations.RemoveField(
            model_name='question',
            name='legacy_trigger',
        ),
        migrations.RemoveField(
            model_name='test',
            name='legacy_triggers',
        ),
    ]
