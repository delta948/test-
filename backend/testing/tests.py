from datetime import timedelta
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Attempt, Test, User
from core.view_utils import (
    TEST_DURATION,
    get_attempt_expires_at,
    get_attempt_remaining_seconds,
)


class AttemptTimerTests(SimpleTestCase):
    def test_every_attempt_has_exactly_fifty_minutes(self):
        started_at = timezone.now()
        attempt = SimpleNamespace(started_at=started_at)

        self.assertEqual(TEST_DURATION, timedelta(minutes=50))
        self.assertEqual(
            get_attempt_expires_at(attempt),
            started_at + timedelta(minutes=50),
        )
        self.assertEqual(
            get_attempt_remaining_seconds(attempt, now=started_at),
            3000,
        )

    def test_remaining_time_is_calculated_by_server_and_never_negative(self):
        started_at = timezone.now()
        attempt = SimpleNamespace(started_at=started_at)

        self.assertEqual(
            get_attempt_remaining_seconds(
                attempt,
                now=started_at + timedelta(minutes=15),
            ),
            2100,
        )
        self.assertEqual(
            get_attempt_remaining_seconds(
                attempt,
                now=started_at + timedelta(hours=2),
            ),
            0,
        )


class CompleteTestTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='completion-teacher',
            password='test-password',
            role='teacher',
        )
        self.student = User.objects.create_user(
            username='completion-student',
            password='test-password',
            role='student',
        )
        self.test = Test.objects.create(title='Completion test', teacher=self.teacher)
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def test_retrying_completion_of_completed_attempt_is_successful(self):
        attempt = Attempt.objects.create(
            student=self.student,
            test=self.test,
            status='completed',
            completed_at=timezone.now(),
        )

        response = self.client.post(
            f'/api/student/attempts/{attempt.id}/complete/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['already_completed'])

    def test_attempt_can_be_completed_with_no_answers(self):
        attempt = Attempt.objects.create(
            student=self.student,
            test=self.test,
            status='in_progress',
        )

        response = self.client.post(
            f'/api/student/attempts/{attempt.id}/complete/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['answered_count'], 0)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, 'completed')
