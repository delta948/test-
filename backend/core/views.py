from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.conf import settings
from .models import Question, Test, Attempt, Answer, StudentProfile
from .serializers import (
    UserSerializer, RegisterSerializer, QuestionSerializer, QuestionListSerializer,
    TestSerializer, TestCreateSerializer, TestListSerializer, AttemptSerializer,
    AttemptListSerializer, SubmitAnswerSerializer, StudentResultSerializer
)

User = get_user_model()


class IsTeacher(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_teacher()


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
    permission_classes = [IsTeacher]
    
    def get_serializer_class(self):
        if self.request.method == 'POST':
            return TestCreateSerializer
        return TestListSerializer
    
    def get_queryset(self):
        return Test.objects.filter(teacher=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(teacher=self.request.user)


class TestDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TestSerializer
    permission_classes = [IsTeacher]
    
    def get_queryset(self):
        return Test.objects.filter(teacher=self.request.user)


class TestQuestionsView(generics.ListAPIView):
    serializer_class = QuestionListSerializer
    permission_classes = [permissions.AllowAny]
    
    def get_queryset(self):
        test_id = self.kwargs['test_id']
        test = Test.objects.get(id=test_id)
        return test.questions.all()


class AvailableTestsView(generics.ListAPIView):
    serializer_class = TestListSerializer
    permission_classes = [IsStudent]
    
    def get_queryset(self):
        from django.db.models import Count, Q
        
        # Получаем тесты с количеством завершенных попыток ученика
        tests_with_attempts = Test.objects.filter(
            is_active=True
        ).annotate(
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=self.request.user, attempts__status='completed')
            )
        )
        
        # Возвращаем только тесты с менее чем 3 попытками
        return tests_with_attempts.filter(completed_attempts__lt=3)


class StartAttemptView(APIView):
    permission_classes = [IsStudent]
    
    def post(self, request, test_id):
        try:
            test = Test.objects.get(id=test_id, is_active=True)
        except Test.DoesNotExist:
            return Response({'error': 'Тест не найден или не активен'}, status=status.HTTP_404_NOT_FOUND)
        
        # Проверка количества завершенных попыток (максимум 3)
        completed_attempts = Attempt.objects.filter(
            student=request.user,
            test=test,
            status='completed'
        ).count()
        
        if completed_attempts >= 3:
            return Response({
                'error': 'Вы исчерпали все попытки (3 из 3). Тест больше недоступен.'
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
                'attempts_left': 3 - completed_attempts
            })
        
        if test.questions.count() < 1:
            return Response({'error': 'Тест должен содержать хотя бы 1 вопрос'}, status=status.HTTP_400_BAD_REQUEST)
        
        attempt = Attempt.objects.create(
            student=request.user,
            test=test,
            status='in_progress',
            current_question_index=0
        )
        
        serializer = AttemptSerializer(attempt)
        return Response({
            'message': 'Попытка начата',
            'attempt': serializer.data,
            'attempt_number': completed_attempts + 1,
            'attempts_left': 2 - completed_attempts
        }, status=status.HTTP_201_CREATED)


class GetTestQuestionsView(APIView):
    permission_classes = [IsStudent]
    
    def get(self, request, attempt_id):
        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='in_progress'
            )
        except Attempt.DoesNotExist:
            return Response({'error': 'Попытка не найдена или завершена'}, status=status.HTTP_404_NOT_FOUND)
        
        questions = attempt.test.questions.all().order_by('id')
        serializer = QuestionListSerializer(questions, many=True)
        
        answered_questions = Answer.objects.filter(attempt=attempt).values_list('question_id', flat=True)
        
        return Response({
            'attempt_id': attempt.id,
            'current_question_index': attempt.current_question_index,
            'total_questions': questions.count(),
            'questions': serializer.data,
            'answered_question_ids': list(answered_questions)
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
        
        question_id = serializer.validated_data['question_id']
        selected_option = serializer.validated_data['selected_option']
        
        try:
            question = attempt.test.questions.get(id=question_id)
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
            
            question_ids = list(attempt.test.questions.all().order_by('id').values_list('id', flat=True))
            
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
        
        correct_count = attempt.answers.filter(is_correct=True).count()
        
        attempt.status = 'completed'
        attempt.score = correct_count
        attempt.completed_at = timezone.now()
        attempt.save()
        
        return Response({
            'message': 'Тест завершен',
            'score': correct_count,
            'total_questions': attempt.test.questions.count(),
            'correct_answers': correct_count
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
            'total_questions': attempt.test.questions.count()
        })


class StudentAttemptsView(generics.ListAPIView):
    serializer_class = AttemptListSerializer
    permission_classes = [IsStudent]
    
    def get_queryset(self):
        return Attempt.objects.filter(student=self.request.user)


class TeacherResultsView(APIView):
    permission_classes = [IsTeacher]
    
    def get(self, request):
        tests = Test.objects.filter(teacher=request.user)
        test_id = request.query_params.get('test_id')
        
        attempts = Attempt.objects.filter(
            test__in=tests,
            status='completed'
        )
        
        if test_id:
            attempts = attempts.filter(test_id=test_id)
        
        serializer = StudentResultSerializer(attempts, many=True)
        return Response(serializer.data)


class TeacherTestResultsView(APIView):
    permission_classes = [IsTeacher]
    
    def get(self, request, test_id):
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


class StudentCountView(APIView):
    permission_classes = [permissions.AllowAny]
    
    def get(self, request):
        count = User.objects.filter(role='student').count()
        return Response({
            'student_count': count,
            'max_students': settings.MAX_STUDENTS,
            'available_slots': max(0, settings.MAX_STUDENTS - count)
        })
