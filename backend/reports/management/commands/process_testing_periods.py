from django.core.management.base import BaseCommand
from django.utils import timezone

from reports.models import SummaryReport
from reports.services import process_expired_testing_data
from testing.models import Attempt, TestingPeriod


class Command(BaseCommand):
    help = 'Process expired testing periods, generate summary PDFs, and clean up expired reports.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be processed without changing data.',
        )

    def handle(self, *args, **options):
        now = timezone.now()
        due_periods = TestingPeriod.objects.filter(
            ends_at__lte=now,
            processed_at__isnull=True,
        ).count()
        expired_reports = SummaryReport.objects.filter(expires_at__lt=now).count()
        due_attempts = Attempt.objects.filter(
            testing_period__ends_at__lte=now,
            testing_period__processed_at__isnull=True,
        ).count()

        if options['dry_run']:
            self.stdout.write(
                f'Dry run: {due_periods} testing periods, {due_attempts} attempts, '
                f'{expired_reports} expired reports would be processed.'
            )
            return

        result = process_expired_testing_data()
        self.stdout.write(self.style.SUCCESS(
            'Processed testing periods: '
            f"{result['processed_periods']}, "
            f"reset attempts: {result['reset_students']}, "
            f"deleted sessions: {result['deleted_sessions']}, "
            f"deleted expired reports: {result['deleted_reports']}"
        ))
