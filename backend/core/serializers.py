from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.db import transaction
import random
from .models import Question, Test, Attempt, Answer, StudentProfile

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role',
            'is_main_teacher', 'is_staff', 'is_superuser'
        ]
        read_only_fields = ['is_staff', 'is_superuser']


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    role = serializers.ChoiceField(choices=[('teacher', 'Учитель'), ('student', 'Ученик')])
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'role', 'first_name', 'last_name']
    
    def validate_role(self, value):
        if value not in ['teacher', 'student']:
            raise serializers.ValidationError("Роль должна быть 'teacher' или 'student'")
        return value
    
    def create(self, validated_data):
        with transaction.atomic():
            user = User.objects.create_user(
                username=validated_data['username'],
                email=validated_data.get('email', ''),
                password=validated_data['password'],
                role=validated_data['role'],
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', '')
            )
            
            if user.role == 'student':
                StudentProfile.objects.create(user=user)
            
            return user


class CreateTeacherSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name']
    
    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data['password'],
            role='teacher',
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        return user


class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = ['id', 'text', 'option_a', 'option_b', 'option_c', 'correct_answer', 'created_at']
        read_only_fields = ['created_at']


class QuestionListSerializer(serializers.ModelSerializer):
    answers = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = ['id', 'text', 'answers']

    def get_answers(self, obj):
        # Создаем варианты с оригинальными ключами
        options = [
            {'original_key': 'A', 'text': obj.option_a},
            {'original_key': 'B', 'text': obj.option_b},
            {'original_key': 'C', 'text': obj.option_c},
        ]
        # Перемешиваем варианты
        random.shuffle(options)
        
        # Возвращаем с фиксированными ключами для отображения (A, B, C)
        # но с оригинальными ключами для отправки на бэкенд
        return [
            {'key': 'A', 'text': options[0]['text'], 'original_key': options[0]['original_key']},
            {'key': 'B', 'text': options[1]['text'], 'original_key': options[1]['original_key']},
            {'key': 'C', 'text': options[2]['text'], 'original_key': options[2]['original_key']},
        ]


class TestSerializer(serializers.ModelSerializer):
    teacher = UserSerializer(read_only=True)
    question_count = serializers.IntegerField(source='questions.count', read_only=True)
    questions = QuestionSerializer(many=True, read_only=True)
    
    class Meta:
        model = Test
        fields = ['id', 'title', 'teacher', 'questions', 'question_count', 'created_at', 'is_active']


class TestCreateSerializer(serializers.ModelSerializer):
    question_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True
    )
    
    class Meta:
        model = Test
        fields = ['id', 'title', 'question_ids']
    
    def validate_question_ids(self, value):
        if len(value) < 1:
            raise serializers.ValidationError("Тест должен содержать хотя бы 1 вопрос")
        
        user = self.context['request'].user
        existing_questions = Question.objects.filter(
            id__in=value,
            created_by=user
        ).values_list('id', flat=True)
        
        missing = set(value) - set(existing_questions)
        if missing:
            raise serializers.ValidationError(f"Вопросы с ID {missing} не найдены или не принадлежат вам")
        
        return value
    
    def create(self, validated_data):
        question_ids = validated_data.pop('question_ids')
        test = Test.objects.create(**validated_data)
        test.questions.set(question_ids)
        return test


class TestListSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    question_count = serializers.IntegerField(source='questions.count', read_only=True)
    completed_attempts = serializers.IntegerField(read_only=True, default=0)
    attempts_left = serializers.SerializerMethodField()
    
    class Meta:
        model = Test
        fields = [
            'id', 'title', 'teacher_name', 'question_count', 'created_at',
            'is_active', 'completed_attempts', 'attempts_left'
        ]

    def get_attempts_left(self, obj):
        completed_attempts = getattr(obj, 'completed_attempts', 0) or 0
        return max(0, 1 - completed_attempts)


class AnswerSerializer(serializers.ModelSerializer):
    question = QuestionListSerializer(read_only=True)
    
    class Meta:
        model = Answer
        fields = ['id', 'question', 'selected_option', 'is_correct', 'answered_at']


class AttemptSerializer(serializers.ModelSerializer):
    test = TestListSerializer(read_only=True)
    answers = AnswerSerializer(many=True, read_only=True)
    total_questions = serializers.IntegerField(read_only=True)
    answered_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Attempt
        fields = [
            'id', 'test', 'status', 'score', 'started_at',
            'completed_at', 'current_question_index',
            'total_questions', 'answered_count', 'answers'
        ]


class AttemptListSerializer(serializers.ModelSerializer):
    test_title = serializers.CharField(source='test.title', read_only=True)
    student_name = serializers.CharField(source='student.get_full_name', read_only=True)
    
    class Meta:
        model = Attempt
        fields = ['id', 'test_title', 'student_name', 'status', 'score', 'started_at', 'completed_at']


class SubmitAnswerSerializer(serializers.Serializer):
    question_id = serializers.IntegerField()
    selected_option = serializers.ChoiceField(choices=[('A', 'A'), ('B', 'B'), ('C', 'C')])
    
    def validate_question_id(self, value):
        try:
            Question.objects.get(id=value)
        except Question.DoesNotExist:
            raise serializers.ValidationError("Вопрос не найден")
        return value


class StudentResultSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.get_full_name', read_only=True)
    student_username = serializers.CharField(source='student.username', read_only=True)
    test_title = serializers.CharField(source='test.title', read_only=True)
    total_questions = serializers.IntegerField(read_only=True)
    
    class Meta:
        model = Attempt
        fields = [
            'id', 'student_name', 'student_username', 'test_title',
            'score', 'total_questions', 'completed_at'
        ]
