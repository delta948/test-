from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from django.core.files.base import ContentFile
from django.db.models.deletion import ProtectedError
from django.http import FileResponse
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.db import transaction
from django.db.models import Avg, Case, Count, IntegerField, Q, When
from django.utils import timezone
from django.conf import settings
from datetime import timedelta
from io import BytesIO
import os
import random
from .models import QuestionTrigger, Question, Test, Attempt, Answer, StudentProfile, SummaryReport, TestingPeriod
from .serializers import (
    UserSerializer, RegisterSerializer, CreateTeacherSerializer, CreateStudentSerializer,
    UpdateStudentSerializer,
    QuestionTriggerSerializer, QuestionSerializer, QuestionListSerializer,
    TestSerializer, TestCreateSerializer, TestListSerializer, AttemptSerializer,
    AttemptListSerializer, SubmitAnswerSerializer, StudentResultSerializer, StudentProfileUpdateSerializer,
    SummaryReportSerializer
)

User = get_user_model()
MAX_TEST_ATTEMPTS = 1
QUESTIONS_PER_ATTEMPT = 100
TEST_DURATION = timedelta(hours=1)
COMPLETED_ATTEMPT_RETENTION = timedelta(days=45)
SUMMARY_SAVE_DELAY = timedelta(days=3)
SUMMARY_REPORT_RETENTION = timedelta(days=90)


def get_attempt_expires_at(attempt):
    return attempt.started_at + TEST_DURATION


def get_or_create_current_testing_period(teacher):
    now = timezone.now()
    period = TestingPeriod.objects.filter(
        teacher=teacher,
        processed_at__isnull=True,
        ends_at__gt=now,
    ).order_by('started_at').first()

    if period:
        return period

    return TestingPeriod.objects.create(
        teacher=teacher,
        started_at=now,
        ends_at=now + SUMMARY_SAVE_DELAY,
        summary_delete_at=now + SUMMARY_SAVE_DELAY + SUMMARY_REPORT_RETENTION,
    )


def clear_student_sessions(student_ids):
    if not student_ids:
        return 0

    student_ids = {str(student_id) for student_id in student_ids}
    deleted_count = 0
    for session in Session.objects.all():
        data = session.get_decoded()
        if str(data.get('_auth_user_id')) in student_ids:
            session.delete()
            deleted_count += 1
    return deleted_count


def cleanup_old_completed_attempts():
    cutoff = timezone.now() - COMPLETED_ATTEMPT_RETENTION
    deleted_count, _ = Attempt.objects.filter(
        status='completed',
        completed_at__lt=cutoff
    ).delete()
    return deleted_count


def get_full_name_or_username(user):
    full_name = user.get_full_name().strip()
    return full_name or user.username


def is_admin_user(user):
    return (
        user.is_authenticated and (
            user.is_staff or
            user.is_superuser or
            getattr(user, 'role', None) == 'admin'
        )
    )


def serialize_attempt_triggers(test):
    return [
        {'id': trigger.id, 'name': trigger.name, 'slug': trigger.slug}
        for trigger in test.triggers.all()
    ]


def serialize_trigger(trigger):
    if not trigger:
        return None
    return {'id': trigger.id, 'name': trigger.name, 'slug': trigger.slug}


def build_question_ids_for_triggers(triggers):
    trigger_ids = [trigger.id for trigger in triggers]
    questions_by_trigger = {}
    total_available = 0

    for trigger in triggers:
        question_ids = list(
            Question.objects.filter(trigger=trigger)
            .values_list('id', flat=True)
        )
        random.shuffle(question_ids)
        questions_by_trigger[trigger.id] = question_ids
        total_available += len(question_ids)

    if total_available < QUESTIONS_PER_ATTEMPT:
        return [], 'Недостаточно вопросов для запуска теста'

    base_quota = QUESTIONS_PER_ATTEMPT // len(trigger_ids)
    remainder = QUESTIONS_PER_ATTEMPT % len(trigger_ids)
    quotas = {trigger_id: base_quota for trigger_id in trigger_ids}
    for trigger_id in random.sample(trigger_ids, remainder):
        quotas[trigger_id] += 1

    selected_ids = []
    unused_ids = []

    for trigger_id in trigger_ids:
        question_ids = questions_by_trigger[trigger_id]
        quota = quotas[trigger_id]
        selected_ids.extend(question_ids[:quota])
        unused_ids.extend(question_ids[quota:])

    if len(selected_ids) < QUESTIONS_PER_ATTEMPT:
        random.shuffle(unused_ids)
        selected_ids.extend(unused_ids[:QUESTIONS_PER_ATTEMPT - len(selected_ids)])

    selected_ids = selected_ids[:QUESTIONS_PER_ATTEMPT]
    random.shuffle(selected_ids)
    return selected_ids, None


def build_summary_rows(attempts):
    rows = []
    for attempt in attempts.select_related('student', 'test', 'test__teacher'):
        total_questions = attempt.total_questions()
        correct_count = attempt.score
        incorrect_count = max(0, total_questions - correct_count)
        percentage = round((correct_count / total_questions) * 100, 1) if total_questions else 0
        triggers = attempt.triggers_snapshot or ([serialize_trigger(attempt.selected_trigger)] if attempt.selected_trigger_id else serialize_attempt_triggers(attempt.test))
        category = ', '.join(trigger.get('name') or trigger.get('slug') or str(trigger) for trigger in triggers) or attempt.test.title
        rows.append({
            'student_name': get_full_name_or_username(attempt.student),
            'student_username': attempt.student.username,
            'teacher_name': get_full_name_or_username(attempt.test.teacher),
            'test_title': attempt.test.title,
            'category': category,
            'correct_count': correct_count,
            'incorrect_count': incorrect_count,
            'score': correct_count,
            'total_questions': total_questions,
            'percentage': percentage,
            'completed_at': attempt.completed_at.isoformat() if attempt.completed_at else '',
        })
    return rows


def generate_summary_pdf(rows, title='Сводная ведомость', teacher_name='Все учителя'):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    buffer = BytesIO()
    font_name = 'Helvetica'
    for font_path in [
        r'C:\Windows\Fonts\arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]:
        if os.path.exists(font_path):
            pdfmetrics.registerFont(TTFont('SummaryFont', font_path))
            font_name = 'SummaryFont'
            break

    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=8 * mm, rightMargin=8 * mm)
    styles = getSampleStyleSheet()
    styles['Title'].fontName = font_name
    styles['Normal'].fontName = font_name

    table_rows = [[
        'ФИО ученика', 'Логин', 'Учитель', 'Тест / категория',
        'Прав.', 'Неправ.', 'Балл', '%', 'Дата и время'
    ]]
    for row in rows:
        table_rows.append([
            row['student_name'],
            row['student_username'],
            row['teacher_name'],
            row['category'],
            str(row['correct_count']),
            str(row['incorrect_count']),
            f"{row['score']} / {row['total_questions']}",
            f"{row['percentage']}%",
            row['completed_at'][:19].replace('T', ' ') if row.get('completed_at') else '-',
        ])

    table = Table(
        table_rows,
        repeatRows=1,
        colWidths=[40 * mm, 25 * mm, 35 * mm, 55 * mm, 16 * mm, 18 * mm, 22 * mm, 16 * mm, 36 * mm],
    )
    table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), font_name),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8f5ee')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#14532d')),
        ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#b7c5bd')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('FONTSIZE', (0, 0), (-1, 0), 8.5),
        ('ALIGN', (4, 1), (7, -1), 'CENTER'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8faf9')]),
    ]))

    doc.build([
        Paragraph(title, styles['Title']),
        Spacer(1, 8),
        Paragraph(f"Дата формирования: {timezone.localtime().strftime('%d.%m.%Y %H:%M')}", styles['Normal']),
        Paragraph(f"Учитель: {teacher_name}", styles['Normal']),
        Spacer(1, 12),
        table,
    ])
    return buffer.getvalue()


def create_summary_report(teacher, attempts, title='Сводная ведомость', testing_period=None):
    rows = build_summary_rows(attempts)
    if not rows:
        return None

    if testing_period:
        existing_report = getattr(testing_period, 'summary_report', None)
        if existing_report:
            return existing_report

    teacher_name = get_full_name_or_username(teacher) if teacher else 'Все учителя'
    pdf = generate_summary_pdf(rows, title, teacher_name=teacher_name)
    expires_at = timezone.now() + SUMMARY_REPORT_RETENTION
    report = SummaryReport.objects.create(
        teacher=teacher,
        testing_period=testing_period,
        title=title,
        rows=rows,
        student_count=len({row['student_username'] for row in rows}),
        period_started_at=testing_period.started_at if testing_period else None,
        period_finished_at=testing_period.ends_at if testing_period else None,
        expires_at=expires_at,
    )
    report.file.save(f"summary-{report.id}.pdf", ContentFile(pdf), save=True)
    if testing_period:
        testing_period.summary_delete_at = report.expires_at
        testing_period.save(update_fields=['summary_delete_at'])
    return report


def process_expired_testing_data():
    now = timezone.now()
    expired_reports, _ = SummaryReport.objects.filter(expires_at__lt=now).delete()
    due_periods = TestingPeriod.objects.filter(
        ends_at__lte=now,
        processed_at__isnull=True,
    ).select_related('teacher')

    processed_periods = 0
    reset_students = 0
    deleted_sessions = 0

    for period in due_periods:
        with transaction.atomic():
            locked_period = TestingPeriod.objects.select_for_update().get(id=period.id)
            if locked_period.processed_at:
                continue

            attempts = Attempt.objects.filter(testing_period=locked_period).select_related(
                'student',
                'test',
                'test__teacher',
            ).prefetch_related('questions')
            completed_attempts = attempts.filter(status='completed')
            existing_report = getattr(locked_period, 'summary_report', None)
            report = create_summary_report(
                locked_period.teacher,
                completed_attempts,
                'Сводная ведомость после 3 дней тестирования',
                testing_period=locked_period,
            )
            if not report:
                report = existing_report

            student_ids = list(attempts.values_list('student_id', flat=True).distinct())
            attempt_count = attempts.count()
            if attempt_count:
                attempts.delete()

            Test.objects.filter(testing_period=locked_period).update(is_active=False)
            reset_students += len(student_ids)
            deleted_sessions += clear_student_sessions(student_ids)

            locked_period.processed_at = now
            locked_period.summary_created_at = report.generated_at if report else now
            locked_period.save(update_fields=['processed_at', 'summary_created_at'])
            processed_periods += 1

    return {
        'processed_periods': processed_periods,
        'reset_students': reset_students,
        'deleted_sessions': deleted_sessions,
        'deleted_reports': expired_reports,
    }


def get_attempt_questions(attempt):
    question_ids = attempt.question_order or list(
        attempt.questions.values_list('id', flat=True)
    )
    
    if len(question_ids) != QUESTIONS_PER_ATTEMPT:
        return Question.objects.none()

    preserved_order = Case(
        *[When(id=question_id, then=position) for position, question_id in enumerate(question_ids)],
        output_field=IntegerField()
    )
    return attempt.questions.filter(id__in=question_ids).order_by(preserved_order)


class IsTeacher(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and
            (
                request.user.is_teacher() or
                request.user.is_staff or
                request.user.is_superuser or
                getattr(request.user, 'role', None) == 'admin'
            )
        )


class IsAdminUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return is_admin_user(request.user)


class TeacherListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not can_manage_teachers(request.user):
            return Response(
                {'error': 'Нет доступа к списку учителей'},
                status=status.HTTP_403_FORBIDDEN
            )

        teachers = User.objects.filter(role='teacher').order_by('last_name', 'first_name', 'username')
        return Response({'teachers': UserSerializer(teachers, many=True).data})


class TeacherDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return User.objects.filter(role='teacher')

    def check_manage_permission(self):
        if not can_manage_teachers(self.request.user):
            raise PermissionDenied('Нет доступа к управлению учителями')

    def get_object(self):
        self.check_manage_permission()
        return super().get_object()

    def destroy(self, request, *args, **kwargs):
        teacher = self.get_object()
        if teacher.id == request.user.id:
            return Response(
                {'error': 'Нельзя удалить собственную учетную запись через этот API'},
                status=status.HTTP_400_BAD_REQUEST
            )

        student_action = request.data.get('student_action') or request.query_params.get('student_action') or 'deactivate'
        students = User.objects.filter(role='student', created_by_teacher=teacher)

        with transaction.atomic():
            if student_action == 'delete':
                affected_students = students.count()
                students.delete()
            elif student_action == 'transfer':
                target_teacher_id = request.data.get('target_teacher_id') or request.query_params.get('target_teacher_id')
                target_teacher = User.objects.filter(id=target_teacher_id, role='teacher').exclude(id=teacher.id).first()
                if not target_teacher:
                    return Response(
                        {'error': 'Для переноса укажите существующего другого учителя'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                affected_students = students.update(created_by_teacher=target_teacher, is_active=True)
            elif student_action == 'deactivate':
                affected_students = students.update(created_by_teacher=None, is_active=False)
            else:
                return Response(
                    {'error': 'student_action должен быть deactivate, delete или transfer'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            teacher.delete()

        return Response({
            'message': 'Учитель удален',
            'student_action': student_action,
            'affected_students': affected_students,
        }, status=status.HTTP_200_OK)


class TeacherStudentListCreateView(APIView):
    permission_classes = [IsTeacher]

    def get(self, request):
        if request.user.is_staff or request.user.is_superuser or getattr(request.user, 'role', None) == 'admin':
            students = User.objects.filter(role='student')
        else:
            students = User.objects.filter(role='student', created_by_teacher=request.user)

        students = students.order_by('last_name', 'first_name', 'username')
        return Response({'students': UserSerializer(students, many=True).data})

    def post(self, request):
        student_count = User.objects.filter(role='student').count()
        if student_count >= settings.MAX_STUDENTS:
            return Response(
                {'error': f'Достигнут лимит в {settings.MAX_STUDENTS} учеников. Создание невозможно.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = CreateStudentSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        student = serializer.save()
        return Response({
            'message': 'Ученик успешно создан',
            'user': UserSerializer(student).data
        }, status=status.HTTP_201_CREATED)


class TeacherStudentDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsTeacher]

    def get_serializer_class(self):
        if self.request.method in ['PUT', 'PATCH']:
            return UpdateStudentSerializer
        return UserSerializer

    def get_queryset(self):
        queryset = User.objects.filter(role='student').select_related(
            'created_by_teacher',
            'student_profile',
        )
        user = self.request.user
        if user.is_staff or user.is_superuser or getattr(user, 'role', None) == 'admin':
            return queryset
        return queryset.filter(created_by_teacher=user)

    def perform_destroy(self, instance):
        instance.delete()


class IsStudent(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_student()


def can_manage_teachers(user):
    return (
        user.is_authenticated and (
            user.is_staff or
            user.is_superuser or
            getattr(user, 'role', None) == 'admin' or
            (getattr(user, 'role', None) == 'teacher' and getattr(user, 'is_main_teacher', False))
        )
    )


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    
    def create(self, request, *args, **kwargs):
        role = request.data.get('role')
        
        if role == 'student':
            student_count = User.objects.filter(role='student').count()
            if student_count >= settings.MAX_STUDENTS:
                return Response(
                    {'error': f'Достигнут лимит в {settings.MAX_STUDENTS} учеников. Регистрация невозможна.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        
        return Response({
            'user': UserSerializer(user).data,
            'message': 'Регистрация успешна'
        }, status=status.HTTP_201_CREATED)


class UserProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class StudentProfileUpdateView(APIView):
    permission_classes = [IsStudent]

    def post(self, request):
        serializer = StudentProfileUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        profile, _ = StudentProfile.objects.get_or_create(user=user)
        user.last_name = serializer.validated_data['last_name']
        user.first_name = serializer.validated_data['first_name']
        profile.military_rank = serializer.validated_data['military_rank']
        profile.patronymic = serializer.validated_data['patronymic']

        with transaction.atomic():
            user.save(update_fields=['last_name', 'first_name'])
            profile.save(update_fields=['military_rank', 'patronymic'])

        return Response(UserSerializer(user).data)


class QuestionTriggerListCreateView(generics.ListCreateAPIView):
    serializer_class = QuestionTriggerSerializer

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.IsAuthenticated()]
        return [IsAdminUser()]

    def get_queryset(self):
        queryset = QuestionTrigger.objects.annotate(
            question_count=Count('questions', distinct=True),
            attempts_count=Count('tests__attempts', filter=Q(tests__attempts__status='completed'), distinct=True),
            average_score=Avg('tests__attempts__score', filter=Q(tests__attempts__status='completed')),
        )
        if self.request.method == 'GET' and not is_admin_user(self.request.user):
            queryset = queryset.filter(is_active=True)
        return queryset


class QuestionTriggerDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuestionTriggerSerializer
    permission_classes = [IsAdminUser]
    queryset = QuestionTrigger.objects.all()

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'error': 'Нельзя удалить триггер, пока к нему привязаны вопросы.'},
                status=status.HTTP_400_BAD_REQUEST
            )


class QuestionTriggerQuestionUploadView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request, trigger_id):
        trigger = QuestionTrigger.objects.filter(id=trigger_id).first()
        if not trigger:
            return Response({'error': 'Триггер не найден'}, status=status.HTTP_404_NOT_FOUND)

        if isinstance(request.data, list):
            items = request.data
        else:
            items = request.data.get('questions', [])
        if not isinstance(items, list) or not items:
            return Response({'error': 'Передайте массив questions'}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        with transaction.atomic():
            for item in items:
                payload = {
                    'text': item.get('text', ''),
                    'option_a': item.get('option_a', ''),
                    'option_b': item.get('option_b', ''),
                    'option_c': item.get('option_c', ''),
                    'option_d': item.get('option_d', ''),
                    'correct_answer': item.get('correct_answer', ''),
                    'trigger_id': trigger.id,
                }
                serializer = QuestionSerializer(data=payload)
                serializer.is_valid(raise_exception=True)
                created.append(serializer.save(created_by=request.user))

        return Response(
            {'created': QuestionSerializer(created, many=True).data},
            status=status.HTTP_201_CREATED
        )


class QuestionListCreateView(generics.ListCreateAPIView):
    serializer_class = QuestionSerializer
    
    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.IsAuthenticated()]
        return [IsAdminUser()]

    def get_queryset(self):
        queryset = Question.objects.select_related('trigger', 'created_by')
        trigger_id = self.request.query_params.get('trigger_id')
        if trigger_id:
            queryset = queryset.filter(trigger_id=trigger_id)
        if is_admin_user(self.request.user):
            return queryset
        return queryset.filter(trigger__is_active=True)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class QuestionDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuestionSerializer
    permission_classes = [IsAdminUser]
    
    def get_queryset(self):
        return Question.objects.select_related('trigger', 'created_by')


class TestListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def get_serializer_class(self):
        if self.request.method == 'POST':
            return TestCreateSerializer
        return TestListSerializer
    
    def get_queryset(self):
        user = self.request.user
        queryset = Test.objects.select_related('teacher').prefetch_related('questions', 'triggers')

        if user.is_staff or user.is_superuser or getattr(user, 'role', None) == 'admin':
            return queryset.annotate(question_count_db=Count('questions', distinct=True)).filter(
                question_count_db=QUESTIONS_PER_ATTEMPT
            )

        if user.is_teacher():
            return queryset.filter(teacher=user)

        return queryset.filter(is_active=True).annotate(
            question_count_db=Count('questions', distinct=True),
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=user, attempts__status='completed')
            )
        ).filter(question_count_db=QUESTIONS_PER_ATTEMPT)

    def create(self, request, *args, **kwargs):
        user = request.user
        if not (
            user.is_teacher() or user.is_staff or user.is_superuser or
            getattr(user, 'role', None) == 'admin'
        ):
            return Response(
                {'error': 'Только учитель или администратор может создавать тесты'},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().create(request, *args, **kwargs)
    
    def perform_create(self, serializer):
        period = get_or_create_current_testing_period(self.request.user)
        serializer.save(teacher=self.request.user, testing_period=period)


class TestDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TestSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        queryset = Test.objects.select_related('teacher').prefetch_related('questions', 'triggers')

        if user.is_staff or user.is_superuser or getattr(user, 'role', None) == 'admin':
            return queryset

        if user.is_teacher():
            return queryset.filter(teacher=user)

        return queryset.filter(is_active=True)

    def perform_update(self, serializer):
        user = self.request.user
        test = self.get_object()
        if not (
            test.teacher_id == user.id or user.is_staff or user.is_superuser or
            getattr(user, 'role', None) == 'admin'
        ):
            raise PermissionDenied('Недостаточно прав для изменения теста')
        serializer.save()

    def perform_destroy(self, instance):
        user = self.request.user
        if not (
            instance.teacher_id == user.id or user.is_staff or user.is_superuser or
            getattr(user, 'role', None) == 'admin'
        ):
            raise PermissionDenied('Недостаточно прав для удаления теста')
        instance.delete()


class TestQuestionsView(generics.ListAPIView):
    serializer_class = QuestionListSerializer
    permission_classes = [permissions.AllowAny]
    
    def get_queryset(self):
        test_id = self.kwargs['test_id']
        test = Test.objects.get(id=test_id)
        return test.questions.order_by('?')[:QUESTIONS_PER_ATTEMPT]


class AvailableTestsView(generics.ListAPIView):
    serializer_class = TestListSerializer
    permission_classes = [IsStudent]
    
    def get_queryset(self):
        process_expired_testing_data()
        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
        return Test.objects.filter(
            is_active=True
        ).annotate(
            question_count_db=Count('questions', distinct=True),
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=self.request.user, attempts__status='completed', attempts__completed_at__gte=ten_minutes_ago)
            )
        ).filter(
            question_count_db=QUESTIONS_PER_ATTEMPT
        ).select_related('teacher').prefetch_related('questions', 'triggers')

        trigger_id = request.data.get('trigger_id')
        if not trigger_id:
            return Response({'error': 'Выберите триггер для запуска теста'}, status=status.HTTP_400_BAD_REQUEST)

        selected_trigger = QuestionTrigger.objects.filter(id=trigger_id, is_active=True).first()
        if not selected_trigger:
            return Response({'error': 'Триггер не найден или неактивен'}, status=status.HTTP_404_NOT_FOUND)

        if test.triggers.exists() and not test.triggers.filter(id=selected_trigger.id).exists():
            return Response({'error': 'Выбранный триггер недоступен для этого теста'}, status=status.HTTP_400_BAD_REQUEST)

        raw_trigger_ids = request.data.get('trigger_ids')
        if raw_trigger_ids is None:
            raw_trigger_id = request.data.get('trigger_id')
            raw_trigger_ids = [raw_trigger_id] if raw_trigger_id else []

        try:
            trigger_ids = [int(trigger_id) for trigger_id in raw_trigger_ids]
        except (TypeError, ValueError):
            return Response({'error': 'Выберите один или несколько триггеров'}, status=status.HTTP_400_BAD_REQUEST)

        trigger_ids = list(dict.fromkeys(trigger_ids))
        if not trigger_ids:
            return Response({'error': 'Выберите один или несколько триггеров'}, status=status.HTTP_400_BAD_REQUEST)

        selected_triggers = list(QuestionTrigger.objects.filter(id__in=trigger_ids, is_active=True))
        found_trigger_ids = {trigger.id for trigger in selected_triggers}
        missing_trigger_ids = set(trigger_ids) - found_trigger_ids
        if missing_trigger_ids:
            return Response({'error': 'Триггер не найден или неактивен'}, status=status.HTTP_404_NOT_FOUND)

        selected_triggers.sort(key=lambda trigger: trigger_ids.index(trigger.id))
        selected_trigger = selected_triggers[0] if len(selected_triggers) == 1 else None
        selected_trigger_snapshot = [serialize_trigger(trigger) for trigger in selected_triggers]

        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
        return Test.objects.filter(
            is_active=True
        ).annotate(
            question_count_db=Count('questions', distinct=True),
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=self.request.user, attempts__status='completed', attempts__completed_at__gte=ten_minutes_ago)
            )
        ).filter(
            question_count_db=QUESTIONS_PER_ATTEMPT
        ).select_related('teacher').prefetch_related('questions', 'triggers')


class StartAttemptView(APIView):
    permission_classes = [IsStudent]
    
    def post(self, request, test_id):
        profile = getattr(request.user, 'student_profile', None)
        if not profile or not profile.is_complete:
            return Response({
                'error': 'Заполните воинское звание, фамилию, имя и отчество перед началом теста.'
            }, status=status.HTTP_400_BAD_REQUEST)

        process_expired_testing_data()
        try:
            test = Test.objects.prefetch_related('triggers').get(id=test_id, is_active=True)
        except Test.DoesNotExist:
            return Response({'error': 'Тест не найден или не активен'}, status=status.HTTP_404_NOT_FOUND)
        
        # Проверка количества завершенных попыток за последние 10 минут
        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
        raw_trigger_ids = request.data.get('trigger_ids')
        if raw_trigger_ids is None:
            raw_trigger_id = request.data.get('trigger_id')
            raw_trigger_ids = [raw_trigger_id] if raw_trigger_id else []

        try:
            trigger_ids = [int(trigger_id) for trigger_id in raw_trigger_ids]
        except (TypeError, ValueError):
            return Response({'error': 'Выберите один или несколько триггеров'}, status=status.HTTP_400_BAD_REQUEST)

        trigger_ids = list(dict.fromkeys(trigger_ids))
        if not trigger_ids:
            return Response({'error': 'Выберите один или несколько триггеров'}, status=status.HTTP_400_BAD_REQUEST)

        selected_triggers = list(QuestionTrigger.objects.filter(id__in=trigger_ids, is_active=True))
        found_trigger_ids = {trigger.id for trigger in selected_triggers}
        if set(trigger_ids) - found_trigger_ids:
            return Response({'error': 'Триггер не найден или неактивен'}, status=status.HTTP_404_NOT_FOUND)

        selected_triggers.sort(key=lambda trigger: trigger_ids.index(trigger.id))
        selected_trigger = selected_triggers[0] if len(selected_triggers) == 1 else None
        selected_trigger_snapshot = [serialize_trigger(trigger) for trigger in selected_triggers]

        completed_attempts = Attempt.objects.filter(
            student=request.user,
            test=test,
            status='completed',
            completed_at__gte=ten_minutes_ago
        ).count()
        
        if completed_attempts >= MAX_TEST_ATTEMPTS:
            return Response({
                'error': f'Вы исчерпали все попытки ({MAX_TEST_ATTEMPTS} из {MAX_TEST_ATTEMPTS}). Попробуйте через 10 минут.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Проверка на существующую активную попытку
        existing_attempt = Attempt.objects.filter(
            student=request.user,
            test=test,
            status='in_progress'
        ).first()
        
        if existing_attempt:
            serializer = AttemptSerializer(existing_attempt)
            return Response({
                'message': 'Продолжение существующей попытки',
                'attempt': serializer.data,
                'attempts_used': completed_attempts,
                'attempts_left': MAX_TEST_ATTEMPTS - completed_attempts,
                'expires_at': get_attempt_expires_at(existing_attempt),
                'duration_seconds': int(TEST_DURATION.total_seconds())
            })
        
        question_ids, question_error = build_question_ids_for_triggers(selected_triggers)
        if question_error:
            return Response({
                'error': 'Недостаточно вопросов в выбранных категориях для формирования теста из 100 вопросов.'
            }, status=status.HTTP_400_BAD_REQUEST)

        if False:
            return Response({'error': 'Тест должен содержать ровно 100 вопросов'}, status=status.HTTP_400_BAD_REQUEST)
        
        with transaction.atomic():
            period = test.testing_period
            if not period or period.processed_at:
                period = get_or_create_current_testing_period(test.teacher)
                test.testing_period = period
                test.save(update_fields=['testing_period'])

            attempt = Attempt.objects.create(
                student=request.user,
                test=test,
                selected_trigger=selected_trigger,
                testing_period=period,
                status='in_progress',
                current_question_index=0,
                triggers_snapshot=selected_trigger_snapshot,
            )
            attempt.question_order = question_ids
            attempt.save(update_fields=['question_order'])
            attempt.questions.set(question_ids)
        
        serializer = AttemptSerializer(attempt)
        return Response({
            'message': 'Попытка начата',
            'attempt': serializer.data,
            'attempt_number': completed_attempts + 1,
            'attempts_left': MAX_TEST_ATTEMPTS - completed_attempts - 1,
            'expires_at': get_attempt_expires_at(attempt),
            'duration_seconds': int(TEST_DURATION.total_seconds())
        }, status=status.HTTP_201_CREATED)


class GetTestQuestionsView(APIView):
    permission_classes = [IsStudent]
    
    def get(self, request, attempt_id):
        process_expired_testing_data()
        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='in_progress'
            )
        except Attempt.DoesNotExist:
            return Response({'error': 'Попытка не найдена или завершена'}, status=status.HTTP_404_NOT_FOUND)
        
        questions = get_attempt_questions(attempt)
        if questions.count() != QUESTIONS_PER_ATTEMPT:
            return Response({'error': 'Недостаточно вопросов для запуска теста'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = QuestionListSerializer(questions, many=True)
        
        saved_answers = Answer.objects.filter(attempt=attempt)
        answered_questions = saved_answers.values_list('question_id', flat=True)
        
        return Response({
            'attempt_id': attempt.id,
            'current_question_index': attempt.current_question_index,
            'total_questions': questions.count(),
            'questions': serializer.data,
            'answered_question_ids': list(answered_questions),
            'selected_answers': {
                str(answer.question_id): answer.selected_option
                for answer in saved_answers
            },
            'expires_at': get_attempt_expires_at(attempt),
            'duration_seconds': int(TEST_DURATION.total_seconds())
        })


class SubmitAnswerView(APIView):
    permission_classes = [IsStudent]
    
    def post(self, request, attempt_id):
        serializer = SubmitAnswerSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='in_progress'
            )
        except Attempt.DoesNotExist:
            return Response({'error': 'Попытка не найдена или завершена'}, status=status.HTTP_404_NOT_FOUND)

        if timezone.now() >= get_attempt_expires_at(attempt):
            correct_count = attempt.answers.filter(is_correct=True).count()
            attempt.status = 'completed'
            attempt.score = correct_count
            attempt.completed_at = timezone.now()
            attempt.save(update_fields=['status', 'score', 'completed_at'])
            return Response(
                {'error': 'Время теста истекло. Тест завершен с текущими ответами.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        question_id = serializer.validated_data['question_id']
        selected_option = serializer.validated_data['selected_option']
        
        try:
            question = attempt.questions.get(id=question_id)
        except Question.DoesNotExist:
            return Response({'error': 'Вопрос не найден в этом тесте'}, status=status.HTTP_404_NOT_FOUND)
        
        with transaction.atomic():
            answer, _ = Answer.objects.update_or_create(
                attempt=attempt,
                question=question,
                defaults={'selected_option': selected_option}
            )
            
            question_ids = attempt.question_order or list(attempt.questions.values_list('id', flat=True))
            
            try:
                current_index = question_ids.index(question_id)
                if current_index >= attempt.current_question_index:
                    attempt.current_question_index = current_index + 1
                    attempt.save()
            except ValueError:
                pass
        
        return Response({
            'message': 'Ответ сохранен',
            'is_correct': answer.is_correct,
            'current_question_index': attempt.current_question_index,
            'answered_count': attempt.answers.count()
        })


class CompleteTestView(APIView):
    permission_classes = [IsStudent]
    
    def post(self, request, attempt_id):
        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='in_progress'
            )
        except Attempt.DoesNotExist:
            return Response({'error': 'Попытка не найдена или уже завершена'}, status=status.HTTP_404_NOT_FOUND)
        
        timed_out = bool(request.data.get('timed_out')) or timezone.now() >= get_attempt_expires_at(attempt)
        answered_count = attempt.answers.count()
        if answered_count < 1 and not timed_out:
            return Response(
                {'error': 'Нужно ответить хотя бы на один вопрос, чтобы завершить тест'},
                status=status.HTTP_400_BAD_REQUEST
            )

        correct_count = attempt.answers.filter(is_correct=True).count()
        total_questions = attempt.total_questions()
        incorrect_count = total_questions - correct_count
        
        attempt.status = 'completed'
        attempt.score = correct_count
        attempt.completed_at = timezone.now()
        attempt.save()
        
        return Response({
            'message': 'Тест завершен',
            'score': correct_count,
            'total_questions': total_questions,
            'correct_answers': correct_count,
            'incorrect_answers': incorrect_count,
            'answered_count': answered_count,
            'unanswered_count': total_questions - answered_count,
            'timed_out': timed_out
        })


class GetTestResultView(APIView):
    permission_classes = [IsStudent]
    
    def get(self, request, attempt_id):
        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='completed'
            )
        except Attempt.DoesNotExist:
            return Response({'error': 'Результат не найден'}, status=status.HTTP_404_NOT_FOUND)
        
        serializer = AttemptSerializer(attempt)
        return Response({
            'attempt': serializer.data,
            'correct_count': attempt.score,
            'total_questions': attempt.total_questions()
        })


class StudentAttemptsView(generics.ListAPIView):
    serializer_class = AttemptListSerializer
    permission_classes = [IsStudent]
    
    def get_queryset(self):
        process_expired_testing_data()
        return Attempt.objects.filter(student=self.request.user)


class TeacherResultsView(APIView):
    permission_classes = [IsTeacher]
    
    def get(self, request):
        process_expired_testing_data()
        if (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        ):
            tests = Test.objects.all()
        else:
            tests = Test.objects.filter(teacher=request.user)
        test_id = request.query_params.get('test_id')
        
        attempts = Attempt.objects.filter(
            test__in=tests,
            status='completed'
        ).select_related('student', 'test').prefetch_related('test__triggers').order_by('-completed_at')

        if not (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        ):
            attempts = attempts.filter(student__created_by_teacher=request.user)
        
        if test_id:
            attempts = attempts.filter(test_id=test_id)
        
        serializer = StudentResultSerializer(attempts, many=True)
        return Response(serializer.data)


class TeacherSummaryPdfView(APIView):
    permission_classes = [IsTeacher]

    def get(self, request):
        process_expired_testing_data()
        is_admin = (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        )
        teacher_id = request.query_params.get('teacher_id')
        teacher_name = 'Все учителя'

        if is_admin:
            attempts = Attempt.objects.filter(status='completed')
            if teacher_id:
                teacher = User.objects.filter(id=teacher_id, role='teacher').first()
                if not teacher:
                    return Response({'error': 'Учитель не найден'}, status=status.HTTP_404_NOT_FOUND)
                attempts = attempts.filter(student__created_by_teacher=teacher)
                teacher_name = get_full_name_or_username(teacher)
        else:
            if teacher_id and str(request.user.id) != str(teacher_id):
                return Response({'error': 'Нет доступа к ведомости другого учителя'}, status=status.HTTP_403_FORBIDDEN)
            attempts = Attempt.objects.filter(
                student__created_by_teacher=request.user,
                status='completed'
            )
            teacher_name = get_full_name_or_username(request.user)

        attempts = attempts.select_related('student', 'test', 'test__teacher').prefetch_related('test__triggers').order_by(
            'student__last_name',
            'student__first_name',
            '-completed_at',
        )
        rows = build_summary_rows(attempts)
        if not rows:
            return Response({'error': 'Нет завершенных результатов для ведомости'}, status=status.HTTP_404_NOT_FOUND)

        pdf = generate_summary_pdf(rows, teacher_name=teacher_name)
        filename = f"summary-report-{teacher_id or 'all'}.pdf"
        return FileResponse(BytesIO(pdf), as_attachment=True, filename=filename, content_type='application/pdf')


class TeacherSummaryReportListView(generics.ListAPIView):
    serializer_class = SummaryReportSerializer
    permission_classes = [IsTeacher]

    def get_queryset(self):
        process_expired_testing_data()
        queryset = SummaryReport.objects.all()
        if not (
            self.request.user.is_staff or
            self.request.user.is_superuser or
            getattr(self.request.user, 'role', None) == 'admin'
        ):
            queryset = queryset.filter(teacher=self.request.user)
        return queryset


class TeacherTestResultsView(APIView):
    permission_classes = [IsTeacher]
    
    def get(self, request, test_id):
        process_expired_testing_data()
        tests = Test.objects.filter(id=test_id)
        is_admin = (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        )
        if not is_admin:
            tests = tests.filter(teacher=request.user)

        test = tests.first()
        if not test:
            return Response({'error': 'Тест не найден'}, status=status.HTTP_404_NOT_FOUND)
        
        attempts = Attempt.objects.filter(test=test, status='completed')
        if not is_admin:
            attempts = attempts.filter(student__created_by_teacher=request.user)
        serializer = StudentResultSerializer(attempts, many=True)
        return Response({
            'test': TestListSerializer(test).data,
            'results': serializer.data
        })


class TeacherAttemptResultView(APIView):
    permission_classes = [IsTeacher]

    def get(self, request, attempt_id):
        process_expired_testing_data()
        attempts = Attempt.objects.filter(id=attempt_id, status='completed')

        if not (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        ):
            attempts = attempts.filter(test__teacher=request.user, student__created_by_teacher=request.user)

        attempt = attempts.select_related('student', 'test').prefetch_related(
            'answers__question'
        ).first()

        if not attempt:
            return Response({'error': 'Результат не найден'}, status=status.HTTP_404_NOT_FOUND)

        question_ids = attempt.question_order or list(attempt.questions.values_list('id', flat=True))
        if question_ids:
            preserved_order = Case(
                *[When(id=question_id, then=position) for position, question_id in enumerate(question_ids)],
                output_field=IntegerField()
            )
            questions = attempt.questions.filter(id__in=question_ids).order_by(preserved_order)
        else:
            questions = attempt.test.questions.all()

        serializer = AttemptSerializer(attempt)
        return Response({
            'attempt': serializer.data,
            'student': UserSerializer(attempt.student).data,
            'questions': QuestionSerializer(questions, many=True).data,
            'correct_count': attempt.score,
            'total_questions': attempt.total_questions(),
            'answered_count': attempt.answers.count(),
            'incorrect_count': attempt.total_questions() - attempt.score,
        })


class StudentCountView(APIView):
    permission_classes = [permissions.AllowAny]
    
    def get(self, request):
        count = User.objects.filter(role='student').count()
        return Response({
            'student_count': count,
            'max_students': settings.MAX_STUDENTS,
            'available_slots': max(0, settings.MAX_STUDENTS - count)
        })


class CreateTeacherView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        # Проверка: только главный учитель может создавать учителей
        if not can_manage_teachers(request.user):
            return Response(
                {'error': 'Только администратор или главный учитель может создавать аккаунты учителей'}, 
                status=status.HTTP_403_FORBIDDEN
            )
        
        serializer = CreateTeacherSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            serializer.save()
            return Response({
                'message': 'Учитель успешно создан',
                'user': UserSerializer(serializer.instance).data
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {'error': f'Ошибка создания учителя: {str(e)}'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
