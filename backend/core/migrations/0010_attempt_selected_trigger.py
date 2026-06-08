from django.db import migrations, models
import django.db.models.deletion


def populate_selected_trigger(apps, schema_editor):
    Attempt = apps.get_model('core', 'Attempt')
    QuestionTrigger = apps.get_model('core', 'QuestionTrigger')

    triggers_by_slug = {
        trigger.slug: trigger
        for trigger in QuestionTrigger.objects.all()
    }

    for attempt in Attempt.objects.all():
        snapshot = attempt.triggers_snapshot or []
        trigger = None
        if len(snapshot) == 1:
            trigger = triggers_by_slug.get(snapshot[0].get('slug'))
        if not trigger:
            trigger = attempt.test.triggers.first()
        if trigger:
            attempt.selected_trigger_id = trigger.id
            attempt.save(update_fields=['selected_trigger'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_questiontrigger_relations'),
    ]

    operations = [
        migrations.AddField(
            model_name='attempt',
            name='selected_trigger',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='attempts', to='core.questiontrigger'),
        ),
        migrations.RunPython(populate_selected_trigger, migrations.RunPython.noop),
    ]
