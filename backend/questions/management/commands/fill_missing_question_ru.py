from django.core.management.base import BaseCommand
from django.db.models import Q

from questions.models import Question


class Command(BaseCommand):
    help = 'Fill empty Question.text_ru values from Question.text.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show how many questions would be updated without saving changes.',
        )

    def handle(self, *args, **options):
        queryset = Question.objects.filter(Q(text_ru__isnull=True) | Q(text_ru__exact='')).exclude(text__exact='')
        total = queryset.count()

        if options['dry_run']:
            self.stdout.write(self.style.WARNING(f'Would update {total} questions.'))
            return

        updated = 0
        for question in queryset.iterator():
            question.text_ru = question.text
            question.save(update_fields=['text_ru'])
            updated += 1

        self.stdout.write(self.style.SUCCESS(f'Updated {updated} questions.'))
