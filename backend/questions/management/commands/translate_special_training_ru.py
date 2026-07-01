from concurrent.futures import ThreadPoolExecutor, as_completed
from time import sleep

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from questions.models import Question
from core.trigger_visibility import SPECIAL_TRAINING_SUBTRIGGER_SLUGS


SPECIAL_TRAINING_RU_SLUGS = (
    'communications-training',
    'engineering-training',
    'logistics-training',
    'armament-training',
    'air-defense-training',
)

TRANSLATABLE_FIELDS = (
    ('text', 'text_ru', 'text_ky'),
    ('option_a', 'option_a_ru', 'option_a_ky'),
    ('option_b', 'option_b_ru', 'option_b_ky'),
    ('option_c', 'option_c_ru', 'option_c_ky'),
    ('option_d', 'option_d_ru', 'option_d_ky'),
)
KYRGYZ_MARKERS = (
    'ө', 'ү', 'ң',
    ' деген ', ' эмне', ' үчүн', ' жана ', ' менен ', ' кайсы', ' канча',
    ' болот', ' керек', ' эмес', ' туура', ' жооп', ' суроо', ' учурда',
    ' шарттарда', ' кызмат', ' колдонулат',
)


def clean(value):
    return str(value or '').strip()


def looks_kyrgyz(value):
    normalized = f' {clean(value).lower()} '
    return any(marker in normalized for marker in KYRGYZ_MARKERS)


def should_translate(question, ru_field, ky_field):
    ru_value = clean(getattr(question, ru_field, ''))
    ky_value = clean(getattr(question, ky_field, ''))
    return bool(ky_value) and (not ru_value or (ru_value == ky_value and looks_kyrgyz(ky_value)))


class Command(BaseCommand):
    help = 'Translate special training questions and answer options from Kyrgyz to Russian.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Count values that would be translated without saving changes.',
        )
        parser.add_argument(
            '--sleep',
            type=float,
            default=0.2,
            help='Delay between translation batches in seconds.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=40,
            help='Number of translated values to save between progress messages.',
        )
        parser.add_argument(
            '--workers',
            type=int,
            default=8,
            help='Number of parallel translation requests.',
        )

    def handle(self, *args, **options):
        try:
            from deep_translator import GoogleTranslator
        except ImportError as exc:
            raise CommandError(
                'deep-translator is not installed. Run: pip install -r requirements.txt'
            ) from exc

        invalid_slugs = set(SPECIAL_TRAINING_RU_SLUGS) - set(SPECIAL_TRAINING_SUBTRIGGER_SLUGS)
        if invalid_slugs:
            raise CommandError(f'Unknown special training slugs: {sorted(invalid_slugs)}')

        queryset = (
            Question.objects.select_related('trigger')
            .filter(trigger__slug__in=SPECIAL_TRAINING_RU_SLUGS)
            .filter(
                Q(text_ky__gt='') |
                Q(option_a_ky__gt='') |
                Q(option_b_ky__gt='') |
                Q(option_c_ky__gt='') |
                Q(option_d_ky__gt='')
            )
            .order_by('trigger__slug', 'id')
        )

        pending = []
        for question in queryset:
            fields = [
                (base_field, ru_field, ky_field)
                for base_field, ru_field, ky_field in TRANSLATABLE_FIELDS
                if should_translate(question, ru_field, ky_field)
            ]
            if fields:
                pending.append((question, fields))

        values_count = sum(len(fields) for _, fields in pending)
        if options['dry_run']:
            self.stdout.write(f'Questions needing updates: {len(pending)}')
            self.stdout.write(f'Values needing translation: {values_count}')
            return

        updated_questions = 0
        translated_values = 0
        batch_size = max(1, options['batch_size'])
        workers = max(1, options['workers'])

        values = []
        for question, fields in pending:
            for _base_field, ru_field, ky_field in fields:
                values.append((question, ru_field, clean(getattr(question, ky_field, ''))))

        def translate_value(source_value):
            translator = GoogleTranslator(source='ky', target='ru')
            return translator.translate(source_value)

        changed_questions = {}
        completed = 0
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_value = {
                executor.submit(translate_value, source_value): (question, ru_field, source_value)
                for question, ru_field, source_value in values
            }

            for future in as_completed(future_to_value):
                question, ru_field, source_value = future_to_value[future]
                try:
                    translated_value = future.result()
                except Exception as exc:
                    self.stderr.write(f'Failed to translate question #{question.id} {ru_field}: {source_value} ({exc})')
                    completed += 1
                    continue

                translated_value = clean(translated_value)
                if translated_value:
                    setattr(question, ru_field, translated_value)
                    changed_questions.setdefault(question, set()).add(ru_field)
                    translated_values += 1

                completed += 1
                if completed % batch_size == 0 or completed == len(values):
                    for changed_question, update_fields in changed_questions.items():
                        changed_question.save(update_fields=sorted(update_fields))
                        updated_questions += 1
                    changed_questions = {}
                    self.stdout.write(f'Translated {completed}/{len(values)} values...')

                    if options['sleep'] > 0 and completed < len(values):
                        sleep(options['sleep'])

        self.stdout.write(self.style.SUCCESS(
            f'Translated {translated_values} values for {updated_questions} questions.'
        ))
