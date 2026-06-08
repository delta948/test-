from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Avg
import random
from .models import QuestionTrigger, Question, Test, Attempt, Answer, StudentProfile, SummaryReport

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    military_rank = serializers.SerializerMethodField()
    patronymic = serializers.SerializerMethodField()
    student_profile_completed = serializers.SerializerMethodField()
    teacher_id = serializers.IntegerField(source='created_by_teacher_id', read_only=True)
    teacher_name = serializers.SerializerMethodField()
    teacher_username = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role',
            'is_main_teacher', 'is_staff', 'is_superuser', 'military_rank',
            'patronymic', 'student_profile_completed', 'teacher_id',
            'teacher_name', 'teacher_username', 'is_active'
        ]
        read_only_fields = ['is_staff', 'is_superuser']

    def get_military_rank(self, obj):
        return getattr(getattr(obj, 'student_profile', None), 'military_rank', '')

    def get_patronymic(self, obj):
        return getattr(getattr(obj, 'student_profile', None), 'patronymic', '')

    def get_student_profile_completed(self, obj):
        if obj.role != 'student':
            return True
        profile = getattr(obj, 'student_profile', None)
        return bool(profile and profile.is_complete)

    def get_teacher_name(self, obj):
        teacher = getattr(obj, 'created_by_teacher', None)
        if not teacher:
            return ''
        return teacher.get_full_name().strip() or teacher.username

    def get_teacher_username(self, obj):
        teacher = getattr(obj, 'created_by_teacher', None)
        return teacher.username if teacher else ''


class StudentProfileUpdateSerializer(serializers.Serializer):
    military_rank = serializers.CharField(max_length=100, trim_whitespace=True)
    last_name = serializers.CharField(max_length=150, trim_whitespace=True)
    first_name = serializers.CharField(max_length=150, trim_whitespace=True)
    patronymic = serializers.CharField(max_length=150, trim_whitespace=True)

    def validate(self, attrs):
        for field, value in attrs.items():
            if not value.strip():
                raise serializers.ValidationError({field: 'Это поле обязательно.'})
        return attrs


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


class CreateStudentSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    military_rank = serializers.CharField(max_length=100, required=False, allow_blank=True)
    patronymic = serializers.CharField(max_length=150, required=False, allow_blank=True)
    teacher_id = serializers.IntegerField(required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'military_rank', 'patronymic', 'teacher_id']

    def validate_teacher_id(self, value):
        request_user = self.context['request'].user
        if not (
            request_user.is_staff or
            request_user.is_superuser or
            getattr(request_user, 'role', None) == 'admin'
        ):
            raise serializers.ValidationError('Только администратор может выбрать учителя для ученика.')

        if not User.objects.filter(id=value, role='teacher').exists():
            raise serializers.ValidationError('Учитель не найден.')
        return value

    def validate(self, attrs):
        request_user = self.context['request'].user
        is_admin = (
            request_user.is_staff or
            request_user.is_superuser or
            getattr(request_user, 'role', None) == 'admin'
        )
        if is_admin and not request_user.is_teacher() and not attrs.get('teacher_id'):
            raise serializers.ValidationError({'teacher_id': 'Выберите учителя для ученика.'})
        return attrs

    def create(self, validated_data):
        military_rank = validated_data.pop('military_rank', '')
        patronymic = validated_data.pop('patronymic', '')
        teacher_id = validated_data.pop('teacher_id', None)
        request_user = self.context['request'].user
        teacher = User.objects.get(id=teacher_id) if teacher_id else request_user

        with transaction.atomic():
            user = User.objects.create_user(
                username=validated_data['username'],
                email=validated_data.get('email', ''),
                password=validated_data['password'],
                role='student',
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', ''),
                created_by_teacher=teacher,
            )
            StudentProfile.objects.create(user=user, military_rank=military_rank, patronymic=patronymic)

        return user


class UpdateStudentSerializer(serializers.ModelSerializer):
    military_rank = serializers.CharField(max_length=100, required=False, allow_blank=True)
    patronymic = serializers.CharField(max_length=150, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)
    teacher_id = serializers.IntegerField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = User
        fields = [
            'username', 'email', 'first_name', 'last_name', 'military_rank',
            'patronymic', 'password', 'teacher_id', 'is_active'
        ]

    def validate_teacher_id(self, value):
        if value is None:
            return value

        request_user = self.context['request'].user
        if not (
            request_user.is_staff or
            request_user.is_superuser or
            getattr(request_user, 'role', None) == 'admin'
        ):
            raise serializers.ValidationError('Только администратор может переносить ученика другому учителю.')

        if not User.objects.filter(id=value, role='teacher').exists():
            raise serializers.ValidationError('Учитель не найден.')
        return value

    def update(self, instance, validated_data):
        military_rank = validated_data.pop('military_rank', None)
        patronymic = validated_data.pop('patronymic', None)
        password = validated_data.pop('password', '')
        teacher_id = validated_data.pop('teacher_id', serializers.empty)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        if password:
            instance.set_password(password)

        if teacher_id is not serializers.empty:
            instance.created_by_teacher_id = teacher_id

        with transaction.atomic():
            instance.save()
            profile, _ = StudentProfile.objects.get_or_create(user=instance)
            if military_rank is not None:
                profile.military_rank = military_rank
            if patronymic is not None:
                profile.patronymic = patronymic
            profile.save()

        return instance


class QuestionTriggerSerializer(serializers.ModelSerializer):
    question_count = serializers.SerializerMethodField()
    attempts_count = serializers.SerializerMethodField()
    average_score = serializers.SerializerMethodField()
    success_rate = serializers.SerializerMethodField()

    class Meta:
        model = QuestionTrigger
        fields = [
            'id', 'name', 'slug', 'description', 'is_active',
            'question_count', 'attempts_count', 'average_score',
            'success_rate', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_question_count(self, obj):
        return getattr(obj, 'question_count', None) or obj.questions.count()

    def get_attempt_queryset(self, obj):
        return Attempt.objects.filter(test__triggers=obj, status='completed').distinct()

    def get_attempts_count(self, obj):
        return getattr(obj, 'attempts_count', None) or self.get_attempt_queryset(obj).count()

    def get_average_score(self, obj):
        value = getattr(obj, 'average_score', None)
        if value is None:
            value = self.get_attempt_queryset(obj).aggregate(value=Avg('score'))['value']
        return round(value or 0, 2)

    def get_success_rate(self, obj):
        attempts = self.get_attempt_queryset(obj)
        total = attempts.count()
        if not total:
            return 0
        successful = 0
        for attempt in attempts:
            total_questions = attempt.total_questions()
            if total_questions and (attempt.score / total_questions) >= 0.7:
                successful += 1
        return round((successful / total) * 100, 2)


class QuestionSerializer(serializers.ModelSerializer):
    trigger_id = serializers.PrimaryKeyRelatedField(
        queryset=QuestionTrigger.objects.filter(is_active=True),
        source='trigger',
        write_only=True,
        required=True
    )
    trigger = QuestionTriggerSerializer(read_only=True)

    class Meta:
        model = Question
        fields = [
            'id', 'text', 'option_a', 'option_b', 'option_c',
            'correct_answer', 'trigger', 'trigger_id', 'created_at'
        ]
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
    triggers = serializers.SerializerMethodField()
    
    class Meta:
        model = Test
        fields = ['id', 'title', 'teacher', 'questions', 'question_count', 'triggers', 'created_at', 'is_active']

    def get_triggers(self, obj):
        triggers = obj.triggers.all()
        if not triggers.exists():
            triggers = QuestionTrigger.objects.filter(is_active=True)
        return QuestionTriggerSerializer(triggers, many=True).data


class TestCreateSerializer(serializers.ModelSerializer):
    question_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False
    )
    trigger_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=False,
        write_only=True
    )
    
    class Meta:
        model = Test
        fields = ['id', 'title', 'question_ids', 'trigger_ids']
    
    def validate_question_ids(self, value):
        if len(value) != 100:
            raise serializers.ValidationError("Тест должен содержать ровно 100 вопросов")
        
        existing_questions = Question.objects.filter(
            id__in=value,
            trigger__is_active=True
        ).values_list('id', flat=True)
        
        missing = set(value) - set(existing_questions)
        if missing:
            raise serializers.ValidationError(f"Вопросы с ID {missing} не найдены или не принадлежат вам")
        
        return value

    def validate(self, attrs):
        question_ids = attrs.get('question_ids')
        trigger_ids = attrs.get('trigger_ids')

        if not question_ids and not trigger_ids:
            raise serializers.ValidationError("Выберите 100 вопросов вручную или один/несколько триггеров")

        if question_ids and trigger_ids:
            raise serializers.ValidationError("Нельзя одновременно передавать question_ids и triggers")

        if trigger_ids:
            existing_trigger_ids = set(
                QuestionTrigger.objects.filter(id__in=trigger_ids, is_active=True)
                .values_list('id', flat=True)
            )
            missing = set(trigger_ids) - existing_trigger_ids
            if missing:
                raise serializers.ValidationError({'trigger_ids': f'Триггеры с ID {missing} не найдены или неактивны.'})

            question_ids = list(
                Question.objects.filter(trigger_id__in=trigger_ids)
                .order_by('?')
                .values_list('id', flat=True)[:100]
            )
            if len(question_ids) != 100:
                raise serializers.ValidationError(
                    f"По выбранным триггерам найдено {len(question_ids)} вопросов. Нужно ровно 100."
                )
            attrs['question_ids'] = question_ids

        return attrs
    
    def create(self, validated_data):
        question_ids = validated_data.pop('question_ids')
        trigger_ids = validated_data.pop('trigger_ids', [])
        test = Test.objects.create(**validated_data)
        test.questions.set(question_ids)
        if trigger_ids:
            test.triggers.set(trigger_ids)
        return test


class TestListSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    question_count = serializers.IntegerField(source='questions.count', read_only=True)
    completed_attempts = serializers.IntegerField(read_only=True, default=0)
    attempts_left = serializers.SerializerMethodField()
    triggers = serializers.SerializerMethodField()
    
    class Meta:
        model = Test
        fields = [
            'id', 'title', 'teacher_name', 'question_count', 'created_at',
            'is_active', 'completed_attempts', 'attempts_left', 'triggers'
        ]

    def get_attempts_left(self, obj):
        completed_attempts = getattr(obj, 'completed_attempts', 0) or 0
        return max(0, 1 - completed_attempts)

    def get_triggers(self, obj):
        triggers = obj.triggers.all()
        if not triggers.exists():
            triggers = QuestionTrigger.objects.filter(is_active=True)
        return QuestionTriggerSerializer(triggers, many=True).data


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
    triggers = serializers.JSONField(source='triggers_snapshot', read_only=True)
    selected_trigger = QuestionTriggerSerializer(read_only=True)

    class Meta:
        model = Attempt
        fields = [
            'id', 'test', 'status', 'score', 'started_at',
            'completed_at', 'current_question_index',
            'total_questions', 'answered_count', 'answers', 'triggers', 'selected_trigger'
        ]


class AttemptListSerializer(serializers.ModelSerializer):
    test_title = serializers.CharField(source='test.title', read_only=True)
    student_name = serializers.CharField(source='student.get_full_name', read_only=True)
    triggers = serializers.JSONField(source='triggers_snapshot', read_only=True)
    selected_trigger = QuestionTriggerSerializer(read_only=True)
    
    class Meta:
        model = Attempt
        fields = ['id', 'test_title', 'student_name', 'status', 'score', 'started_at', 'completed_at', 'triggers', 'selected_trigger']


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
    teacher_name = serializers.CharField(source='test.teacher.get_full_name', read_only=True)
    test_title = serializers.CharField(source='test.title', read_only=True)
    total_questions = serializers.IntegerField(read_only=True)
    triggers = serializers.JSONField(source='triggers_snapshot', read_only=True)
    selected_trigger = QuestionTriggerSerializer(read_only=True)
    
    class Meta:
        model = Attempt
        fields = [
            'id', 'student_name', 'student_username', 'test_title',
            'teacher_name', 'score', 'total_questions', 'completed_at', 'triggers', 'selected_trigger'
        ]


class SummaryReportSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = SummaryReport
        fields = ['id', 'title', 'teacher_name', 'student_count', 'generated_at', 'expires_at', 'file_url']

    def get_file_url(self, obj):
        request = self.context.get('request')
        if not obj.file:
            return ''
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url
