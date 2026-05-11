from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Attempt


class Command(BaseCommand):
    help = 'Delete completed test attempts older than the retention period.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days',
            type=int,
            default=45,
            help='Retention period in days. Default: 45 days.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show how many attempts would be deleted without deleting them.',
        )

    def handle(self, *args, **options):
        days = max(1, options['days'])
        cutoff = timezone.now() - timedelta(days=days)
        queryset = Attempt.objects.filter(
            status='completed',
            completed_at__lt=cutoff,
        )
        count = queryset.count()

        if options['dry_run']:
            self.stdout.write(
                f'{count} completed attempts older than {days} days would be deleted.'
            )
            return

        deleted_count, deleted_by_model = queryset.delete()
        self.stdout.write(self.style.SUCCESS(
            f'Deleted {deleted_count} objects for completed attempts older than {days} days: '
            f'{deleted_by_model}'
        ))
