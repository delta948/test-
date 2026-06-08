# Generated manually to add automatic testing period tracking.

from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_attempt_archived_at_question_trigger_test_triggers_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='TestingPeriod',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('started_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('ends_at', models.DateTimeField(db_index=True)),
                ('summary_delete_at', models.DateTimeField(db_index=True)),
                ('processed_at', models.DateTimeField(blank=True, null=True, db_index=True)),
                ('summary_created_at', models.DateTimeField(blank=True, null=True)),
                ('teacher', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='testing_periods', to='core.user')),
            ],
            options={
                'ordering': ['-started_at'],
            },
        ),
        migrations.AddField(
            model_name='test',
            name='testing_period',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tests', to='core.testingperiod'),
        ),
        migrations.AddField(
            model_name='attempt',
            name='testing_period',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='attempts', to='core.testingperiod'),
        ),
        migrations.AddField(
            model_name='summaryreport',
            name='period_started_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='summaryreport',
            name='period_finished_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='summaryreport',
            name='testing_period',
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='summary_report', to='core.testingperiod'),
        ),
    ]
