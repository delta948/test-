from django.core.management.base import BaseCommand

from questions.models import Question


QUESTION_FIELDS = ('text', 'option_a', 'option_b', 'option_c', 'option_d')


class Command(BaseCommand):
    help = 'Audit question RU/KG localization fields and optionally backfill KG from legacy fields.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix-kg-from-legacy',
            action='store_true',
            help='Copy legacy text/option fields into *_ky when KG fields are empty.',
        )
        parser.add_argument(
            '--clear-ru-copies',
            action='store_true',
            help='Clear *_ru fields that are identical to *_ky/legacy values.',
        )

    def handle(self, *args, **options):
        total = Question.objects.count()
        missing_ru = 0
        missing_ky = 0
        copied_ky = 0
        ru_copies = 0
        cleared_ru = 0

        for question in Question.objects.all().iterator():
            updates = {}
            for field in QUESTION_FIELDS:
                legacy = getattr(question, field, '') or ''
                ru_value = getattr(question, f'{field}_ru', '') or ''
                ky_value = getattr(question, f'{field}_ky', '') or ''
                normalized_ru = ru_value.strip()
                normalized_ky = ky_value.strip()
                normalized_legacy = legacy.strip()

                if not ru_value and legacy:
                    missing_ru += 1
                if not ky_value and legacy:
                    missing_ky += 1
                    if options['fix_kg_from_legacy']:
                        updates[f'{field}_ky'] = legacy
                if normalized_ru and normalized_ru in {normalized_ky, normalized_legacy}:
                    ru_copies += 1
                    if options['clear_ru_copies']:
                        updates[f'{field}_ru'] = ''

            if updates:
                Question.objects.filter(pk=question.pk).update(**updates)
                if any(key.endswith('_ky') for key in updates):
                    copied_ky += 1
                if any(key.endswith('_ru') for key in updates):
                    cleared_ru += 1

        self.stdout.write(f'Total questions: {total}')
        self.stdout.write(f'Missing RU localized field values: {missing_ru}')
        self.stdout.write(f'Missing KG localized field values: {missing_ky}')
        self.stdout.write(f'RU fields identical to KG/legacy values: {ru_copies}')
        if options['fix_kg_from_legacy']:
            self.stdout.write(f'Questions updated with KG legacy values: {copied_ky}')
        if options['clear_ru_copies']:
            self.stdout.write(f'Questions updated with cleared RU copies: {cleared_ru}')
