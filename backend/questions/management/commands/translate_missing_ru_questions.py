from concurrent.futures import ThreadPoolExecutor, as_completed
from time import sleep

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from questions.models import Question


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
    ' шарттарда', ' кызмат', ' колдонулат', ' аскер', ' курал',
)


def clean(value):
    return str(value or '').strip()


def looks_kyrgyz(value):
    normalized = f' {clean(value).lower()} '
    return any(marker in normalized for marker in KYRGYZ_MARKERS)


def source_value(question, base_field, ky_field):
    return clean(getattr(question, ky_field, '')) or clean(getattr(question, base_field, ''))


def should_translate(question, base_field, ru_field, ky_field):
    source = source_value(question, base_field, ky_field)
    if not source:
        return False

    ru_value = clean(getattr(question, ru_field, ''))
    return not ru_value or (ru_value == source and looks_kyrgyz(source))


class Command(BaseCommand):
    help = 'Translate missing or Kyrgyz-copied question RU fields to Russian.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--trigger',
            action='append',
            dest='triggers',
            help='Limit translation to one trigger slug. Can be passed multiple times.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Count values that would be translated without saving changes.',
        )
        parser.add_argument(
            '--sleep',
            type=float,
            default=0.2,
            help='Delay between save batches in seconds.',
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

        queryset = Question.objects.select_related('trigger').filter(
            Q(text__gt='') | Q(text_ky__gt='') |
            Q(option_a__gt='') | Q(option_a_ky__gt='') |
            Q(option_b__gt='') | Q(option_b_ky__gt='') |
            Q(option_c__gt='') | Q(option_c_ky__gt='') |
            Q(option_d__gt='') | Q(option_d_ky__gt='')
        )

        triggers = options.get('triggers') or []
        if triggers:
            queryset = queryset.filter(trigger__slug__in=triggers)

        pending = []
        for question in queryset.order_by('trigger__slug', 'id'):
            fields = [
                (base_field, ru_field, ky_field)
                for base_field, ru_field, ky_field in TRANSLATABLE_FIELDS
                if should_translate(question, base_field, ru_field, ky_field)
            ]
            if fields:
                pending.append((question, fields))

        values = []
        for question, fields in pending:
            for base_field, ru_field, ky_field in fields:
                values.append((question, ru_field, source_value(question, base_field, ky_field)))

        if options['dry_run']:
            self.stdout.write(f'Questions needing updates: {len(pending)}')
            self.stdout.write(f'Values needing translation: {len(values)}')
            return

        def translate_value(value):
            translator = GoogleTranslator(source='ky', target='ru')
            return translator.translate(value)

        changed_questions = {}
        translated_values = 0
        updated_questions = 0
        completed = 0
        batch_size = max(1, options['batch_size'])
        workers = max(1, options['workers'])

        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_value = {
                executor.submit(translate_value, value): (question, ru_field, value)
                for question, ru_field, value in values
            }

            for future in as_completed(future_to_value):
                question, ru_field, value = future_to_value[future]
                try:
                    translated = clean(future.result())
                except Exception as exc:
                    self.stderr.write(
                        f'Failed to translate question #{question.id} {ru_field}: {value} ({exc})'
                    )
                    completed += 1
                    continue

                if translated:
                    setattr(question, ru_field, translated)
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
