from django.core.management.base import BaseCommand

from core.models import Question


QUESTION_FIELDS = ('text', 'option_a', 'option_b', 'option_c', 'option_d')


class Command(BaseCommand):
    help = 'Audit question RU/KG localization fields and optionally backfill KG from legacy fields.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix-kg-from-legacy',
            action='store_true',
            help='Copy legacy text/option fields into *_ky when KG fields are empty.',
        )

    def handle(self, *args, **options):
        total = Question.objects.count()
        missing_ru = 0
        missing_ky = 0
        copied_ky = 0

        for question in Question.objects.all().iterator():
            updates = {}
            for field in QUESTION_FIELDS:
                legacy = getattr(question, field, '') or ''
                ru_value = getattr(question, f'{field}_ru', '') or ''
                ky_value = getattr(question, f'{field}_ky', '') or ''

                if not ru_value and legacy:
                    missing_ru += 1
                if not ky_value and legacy:
                    missing_ky += 1
                    if options['fix_kg_from_legacy']:
                        updates[f'{field}_ky'] = legacy

            if updates:
                Question.objects.filter(pk=question.pk).update(**updates)
                copied_ky += 1

        self.stdout.write(f'Total questions: {total}')
        self.stdout.write(f'Missing RU localized field values: {missing_ru}')
        self.stdout.write(f'Missing KG localized field values: {missing_ky}')
        if options['fix_kg_from_legacy']:
            self.stdout.write(f'Questions updated with KG legacy values: {copied_ky}')
