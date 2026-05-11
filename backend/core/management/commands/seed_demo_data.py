from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Question, StudentProfile, Test


class Command(BaseCommand):
    help = 'Create demo teacher, student, questions, and an active test if they are missing.'

    def add_arguments(self, parser):
        parser.add_argument('--questions', type=int, default=10)

    @transaction.atomic
    def handle(self, *args, **options):
        User = get_user_model()
        question_count = max(1, options['questions'])

        teacher, teacher_created = User.objects.get_or_create(
            username='teacher_demo',
            defaults={
                'email': 'teacher@example.com',
                'first_name': 'Demo',
                'last_name': 'Teacher',
                'role': 'teacher',
                'is_main_teacher': True,
            },
        )
        if teacher_created:
            teacher.set_password('teacher123')
            teacher.save(update_fields=['password'])

        student, student_created = User.objects.get_or_create(
            username='student_demo',
            defaults={
                'email': 'student@example.com',
                'first_name': 'Demo',
                'last_name': 'Student',
                'role': 'student',
            },
        )
        if student_created:
            student.set_password('student123')
            student.save(update_fields=['password'])
            StudentProfile.objects.get_or_create(user=student)

        questions = list(Question.objects.filter(created_by=teacher).order_by('id')[:question_count])
        for number in range(len(questions) + 1, question_count + 1):
            questions.append(Question.objects.create(
                text=f'Demo question {number}',
                option_a='Answer A',
                option_b='Answer B',
                option_c='Answer C',
                correct_answer='A',
                created_by=teacher,
            ))

        test, _ = Test.objects.get_or_create(
            title='Demo active test',
            teacher=teacher,
            defaults={'is_active': True},
        )
        test.is_active = True
        test.save(update_fields=['is_active'])
        if test.questions.count() == 0:
            test.questions.set(questions)

        self.stdout.write(self.style.SUCCESS(
            f'Demo data ready: tests={Test.objects.count()}, '
            f'questions={Question.objects.count()}, teacher=teacher_demo/teacher123, '
            f'student=student_demo/student123'
        ))
