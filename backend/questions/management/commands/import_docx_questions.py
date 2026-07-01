from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count

from questions.management.commands.import_officer_questions import load_fixture, normalize_text
from questions.models import Question, QuestionTrigger
from testing.models import Test


class Command(BaseCommand):
    help = 'Import DOCX/JSON questions into a selected testing category without creating duplicates.'

    def add_arguments(self, parser):
        parser.add_argument('--file', required=True, help='DOCX/JSON path relative to backend directory, or absolute.')
        parser.add_argument('--category-name', required=True, help='Testing category name.')
        parser.add_argument('--slug', required=True, help='Testing category slug.')

    def handle(self, *args, **options):
        backend_dir = Path(__file__).resolve().parents[3]
        source_path = Path(options['file'])
        if not source_path.is_absolute():
            source_path = backend_dir / source_path
        if not source_path.exists():
            raise CommandError(f'File not found: {source_path}')

        category_name = str(options['category_name'] or '').strip()
        category_slug = str(options['slug'] or '').strip()
        if not category_name:
            raise CommandError('Category name cannot be empty')
        if not category_slug:
            raise CommandError('Category slug cannot be empty')

        questions = load_fixture(source_path)
        seen_in_file = set()
        duplicates_in_file = 0
        deduplicated_questions = []
        for index, question in enumerate(questions, start=1):
            normalized = normalize_text(question['text'])
            if not normalized:
                raise CommandError(f'Question #{index}: empty question text')
            if question['correct_answer'] not in {'A', 'B', 'C', 'D'}:
                raise CommandError(f'Question #{index}: missing or invalid correct answer')
            if normalized in seen_in_file:
                duplicates_in_file += 1
                continue
            seen_in_file.add(normalized)
            deduplicated_questions.append(question)

        User = get_user_model()
        teacher = (
            User.objects.filter(is_superuser=True).first()
            or User.objects.filter(is_staff=True).first()
            or User.objects.filter(role='teacher').first()
        )
        if not teacher:
            raise CommandError('No user found for the created_by field')

        with transaction.atomic():
            trigger, _ = QuestionTrigger.objects.update_or_create(
                slug=category_slug,
                defaults={
                    'name': category_name,
                    'description': '',
                    'is_active': True,
                },
            )

            existing_by_text = {}
            for existing in Question.objects.all().select_related('trigger'):
                for value in (existing.text, existing.text_ky, existing.text_ru):
                    normalized = normalize_text(value)
                    if normalized:
                        existing_by_text.setdefault(normalized, existing)

            created_questions = []
            existing_matches = 0
            updated_existing = 0
            for question in deduplicated_questions:
                normalized = normalize_text(question['text'])
                existing = existing_by_text.get(normalized)
                updates = {
                    'text': question['text'],
                    'text_ky': question['text'],
                    'option_a': question['option_a'],
                    'option_a_ky': question['option_a'],
                    'option_b': question['option_b'],
                    'option_b_ky': question['option_b'],
                    'option_c': question['option_c'],
                    'option_c_ky': question['option_c'],
                    'option_d': question['option_d'],
                    'option_d_ky': question['option_d'],
                    'correct_answer': question['correct_answer'],
                    'explanation': question.get('explanation', ''),
                    'trigger': trigger,
                }

                if existing:
                    changed_fields = []
                    for field, value in updates.items():
                        current = getattr(existing, field)
                        if current != value:
                            setattr(existing, field, value)
                            changed_fields.append('trigger_id' if field == 'trigger' else field)
                    if changed_fields:
                        existing.save(update_fields=sorted(set(changed_fields)))
                        updated_existing += 1
                    existing_matches += 1
                    continue

                created = Question(created_by=teacher, **updates)
                created_questions.append(created)
                existing_by_text[normalized] = created

            if created_questions:
                Question.objects.bulk_create(created_questions)

            category_questions = Question.objects.filter(trigger=trigger)
            active_test = (
                Test.objects.filter(is_active=True, triggers=trigger)
                .order_by('id')
                .first()
            )
            if not active_test:
                active_test = Test.objects.create(title=category_name, teacher=teacher, is_active=True)
                active_test.triggers.set([trigger])
            elif active_test.teacher_id != teacher.id:
                teacher = active_test.teacher

            active_test.title = category_name
            active_test.teacher = teacher
            active_test.is_active = True
            active_test.save(update_fields=['title', 'teacher', 'is_active'])
            active_test.questions.set(category_questions.values_list('id', flat=True))

            missing_in_category = sum(
                not Question.objects.filter(text=question['text'], trigger=trigger).exists()
                for question in deduplicated_questions
            )

        kyrgyz_sample = category_questions.exclude(text_ky='').values_list('text_ky', flat=True).first() or ''
        kyrgyz_ok = any(char in kyrgyz_sample for char in 'үңөҮҢӨ') or bool(kyrgyz_sample)
        no_correct_answer = category_questions.filter(correct_answer='').count()
        categories = (
            QuestionTrigger.objects.filter(questions__isnull=False)
            .annotate(question_count=Count('questions', distinct=True))
            .order_by('name')
        )

        self.stdout.write(self.style.SUCCESS('Import completed'))
        self.stdout.write(f'Total questions found: {len(questions)}')
        self.stdout.write(f'Successfully imported/updated: {len(created_questions) + updated_existing}')
        self.stdout.write(f'Created: {len(created_questions)}')
        self.stdout.write(f'Updated existing: {updated_existing}')
        self.stdout.write(f'Skipped duplicate records in file: {duplicates_in_file}')
        self.stdout.write(f'Existing matching questions: {existing_matches}')
        self.stdout.write(f'Questions in category "{category_name}": {category_questions.count()}')
        self.stdout.write(f'Active test: #{active_test.id} "{active_test.title}", questions: {active_test.questions.count()}')
        self.stdout.write(f'Unique file questions missing in category: {missing_in_category}')
        self.stdout.write(f'Questions without correct answer in category: {no_correct_answer}')
        self.stdout.write(f'Kyrgyz encoding check: {"OK" if kyrgyz_ok else "needs manual review"}')
        self.stdout.write('Question counts by category:')
        for category in categories:
            self.stdout.write(f'- {category.name}: {category.question_count}')
