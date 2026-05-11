from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Case, Count, IntegerField, Q, When
from django.utils import timezone
from django.conf import settings
from datetime import timedelta
from .models import Question, Test, Attempt, Answer, StudentProfile
from .serializers import (
    UserSerializer, RegisterSerializer, CreateTeacherSerializer, QuestionSerializer, QuestionListSerializer,
    TestSerializer, TestCreateSerializer, TestListSerializer, AttemptSerializer,
    AttemptListSerializer, SubmitAnswerSerializer, StudentResultSerializer
)

User = get_user_model()
MAX_TEST_ATTEMPTS = 1
QUESTIONS_PER_ATTEMPT = 100
TEST_DURATION = timedelta(hours=1)
COMPLETED_ATTEMPT_RETENTION = timedelta(days=45)


def get_attempt_expires_at(attempt):
    return attempt.started_at + TEST_DURATION


def cleanup_old_completed_attempts():
    cutoff = timezone.now() - COMPLETED_ATTEMPT_RETENTION
    deleted_count, _ = Attempt.objects.filter(
        status='completed',
        completed_at__lt=cutoff
    ).delete()
    return deleted_count


def get_attempt_questions(attempt):
    # Всегда возвращаем вопросы в случайном порядке
    question_ids = list(
        attempt.test.questions.order_by('?').values_list('id', flat=True)[:QUESTIONS_PER_ATTEMPT]
    )
    
    if not question_ids:
        question_ids = list(
            attempt.test.questions.values_list('id', flat=True)[:QUESTIONS_PER_ATTEMPT]
        )
        attempt.save(update_fields=['question_order'])
        attempt.questions.set(question_ids)

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


class IsStudent(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_student()


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


class QuestionListCreateView(generics.ListCreateAPIView):
    serializer_class = QuestionSerializer
    permission_classes = [IsTeacher]
    
    def get_queryset(self):
        return Question.objects.filter(created_by=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class QuestionDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuestionSerializer
    permission_classes = [IsTeacher]
    
    def get_queryset(self):
        return Question.objects.filter(created_by=self.request.user)


class TestListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def get_serializer_class(self):
        if self.request.method == 'POST':
            return TestCreateSerializer
        return TestListSerializer
    
    def get_queryset(self):
        user = self.request.user
        queryset = Test.objects.select_related('teacher').prefetch_related('questions')

        if user.is_staff or user.is_superuser or getattr(user, 'role', None) == 'admin':
            return queryset.annotate(question_count_db=Count('questions')).filter(
                question_count_db__gt=0
            )

        if user.is_teacher():
            return queryset.filter(teacher=user)

        return queryset.filter(is_active=True).annotate(
            question_count_db=Count('questions'),
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=user, attempts__status='completed')
            )
        ).filter(question_count_db__gt=0)

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
        serializer.save(teacher=self.request.user)


class TestDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TestSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        queryset = Test.objects.select_related('teacher').prefetch_related('questions')

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
        cleanup_old_completed_attempts()
        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
        return Test.objects.filter(
            is_active=True
        ).annotate(
            question_count_db=Count('questions'),
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=self.request.user, attempts__status='completed', attempts__completed_at__gte=ten_minutes_ago)
            )
        ).filter(
            question_count_db__gt=0
        ).select_related('teacher').prefetch_related('questions')


class StartAttemptView(APIView):
    permission_classes = [IsStudent]
    
    def post(self, request, test_id):
        cleanup_old_completed_attempts()
        try:
            test = Test.objects.get(id=test_id, is_active=True)
        except Test.DoesNotExist:
            return Response({'error': 'Тест не найден или не активен'}, status=status.HTTP_404_NOT_FOUND)
        
        # Проверка количества завершенных попыток за последние 10 минут
        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
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
        
        if test.questions.count() < 1:
            return Response({'error': 'Тест должен содержать хотя бы 1 вопрос'}, status=status.HTTP_400_BAD_REQUEST)
        
        with transaction.atomic():
            attempt = Attempt.objects.create(
                student=request.user,
                test=test,
                status='in_progress',
                current_question_index=0
            )
            question_ids = list(
                test.questions.order_by('?').values_list('id', flat=True)[:QUESTIONS_PER_ATTEMPT]
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
        cleanup_old_completed_attempts()
        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='in_progress'
            )
        except Attempt.DoesNotExist:
            return Response({'error': 'Попытка не найдена или завершена'}, status=status.HTTP_404_NOT_FOUND)
        
        questions = get_attempt_questions(attempt)
        serializer = QuestionListSerializer(questions, many=True)
        
        answered_questions = Answer.objects.filter(attempt=attempt).values_list('question_id', flat=True)
        
        return Response({
            'attempt_id': attempt.id,
            'current_question_index': attempt.current_question_index,
            'total_questions': questions.count(),
            'questions': serializer.data,
            'answered_question_ids': list(answered_questions),
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
        
        if Answer.objects.filter(attempt=attempt, question=question).exists():
            return Response({'error': 'Вы уже ответили на этот вопрос'}, status=status.HTTP_400_BAD_REQUEST)
        
        with transaction.atomic():
            answer = Answer.objects.create(
                attempt=attempt,
                question=question,
                selected_option=selected_option
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
        cleanup_old_completed_attempts()
        return Attempt.objects.filter(student=self.request.user)


class TeacherResultsView(APIView):
    permission_classes = [IsTeacher]
    
    def get(self, request):
        cleanup_old_completed_attempts()
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
        ).select_related('student', 'test').order_by('-completed_at')
        
        if test_id:
            attempts = attempts.filter(test_id=test_id)
        
        serializer = StudentResultSerializer(attempts, many=True)
        return Response(serializer.data)


class TeacherTestResultsView(APIView):
    permission_classes = [IsTeacher]
    
    def get(self, request, test_id):
        cleanup_old_completed_attempts()
        try:
            test = Test.objects.get(id=test_id, teacher=request.user)
        except Test.DoesNotExist:
            return Response({'error': 'Тест не найден'}, status=status.HTTP_404_NOT_FOUND)
        
        attempts = Attempt.objects.filter(test=test, status='completed')
        serializer = StudentResultSerializer(attempts, many=True)
        return Response({
            'test': TestListSerializer(test).data,
            'results': serializer.data
        })


class TeacherAttemptResultView(APIView):
    permission_classes = [IsTeacher]

    def get(self, request, attempt_id):
        cleanup_old_completed_attempts()
        attempts = Attempt.objects.filter(id=attempt_id, status='completed')

        if not (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        ):
            attempts = attempts.filter(test__teacher=request.user)

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
        if not (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin' or
            (request.user.role == 'teacher' and request.user.is_main_teacher)
        ):
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
