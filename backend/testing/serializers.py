from core.serializer_utils import *
from accounts.serializers import UserSerializer
from questions.serializers import QuestionListSerializer, QuestionSerializer, QuestionTriggerSerializer

class TestSerializer(serializers.ModelSerializer):
    teacher = UserSerializer(read_only=True)
    question_count = serializers.IntegerField(source='questions.count', read_only=True)
    questions = QuestionSerializer(many=True, read_only=True)
    triggers = serializers.SerializerMethodField()
    
    class Meta:
        model = Test
        fields = ['id', 'title', 'teacher', 'questions', 'question_count', 'triggers', 'created_at', 'is_active']

    def get_triggers(self, obj):
        triggers = get_public_triggers_for_test(obj, QuestionTrigger)
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

    def build_question_ids_for_triggers(self, triggers):
        trigger_ids = [trigger.id for trigger in triggers]
        questions_by_trigger = {}
        total_available = 0
        trigger_slugs = {trigger.slug for trigger in triggers}

        for trigger in triggers:
            question_ids = list(
                Question.objects.filter(get_question_filter_for_public_triggers([trigger]))
                .values_list('id', flat=True)
            )
            random.shuffle(question_ids)
            questions_by_trigger[trigger.id] = question_ids
            total_available += len(question_ids)

        if is_officer_only_selection(triggers):
            selected_ids, error = build_officer_question_ids(questions_by_trigger.get(trigger_ids[0], []))
            if error:
                raise serializers.ValidationError(error)
            return selected_ids

        if trigger_slugs and trigger_slugs.issubset(set(VARIABLE_QUESTION_COUNT_TRIGGER_SLUGS)):
            if total_available < 1:
                raise serializers.ValidationError("По выбранным триггерам не найдено вопросов.")
            selected_ids = []
            for trigger in triggers:
                selected_ids.extend(questions_by_trigger[trigger.id])
            random.shuffle(selected_ids)
            return selected_ids

        if total_available < 100:
            raise serializers.ValidationError(
                f"По выбранным триггерам найдено {total_available} вопросов. Нужно ровно 100."
            )

        base_quota = 100 // len(trigger_ids)
        remainder = 100 % len(trigger_ids)
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

        if len(selected_ids) < 100:
            random.shuffle(unused_ids)
            selected_ids.extend(unused_ids[:100 - len(selected_ids)])

        selected_ids = selected_ids[:100]
        random.shuffle(selected_ids)
        return selected_ids

    def validate(self, attrs):
        question_ids = attrs.get('question_ids')
        trigger_ids = attrs.get('trigger_ids')

        if not question_ids and not trigger_ids:
            raise serializers.ValidationError("Выберите 100 вопросов вручную или один/несколько триггеров")

        if question_ids and trigger_ids:
            raise serializers.ValidationError("Нельзя одновременно передавать question_ids и triggers")

        if trigger_ids:
            selected_triggers = list(public_triggers_queryset(QuestionTrigger).filter(id__in=trigger_ids))
            found_trigger_ids = {trigger.id for trigger in selected_triggers}
            missing = set(trigger_ids) - found_trigger_ids
            if missing:
                raise serializers.ValidationError({'trigger_ids': f'Триггеры с ID {missing} не найдены или неактивны.'})

            selected_triggers.sort(key=lambda trigger: trigger_ids.index(trigger.id))
            attrs['question_ids'] = self.build_question_ids_for_triggers(selected_triggers)

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
        triggers = get_public_triggers_for_test(obj, QuestionTrigger)
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
            'total_questions', 'answered_count', 'answers', 'triggers',
            'selected_trigger', 'military_rank', 'management_body',
            'last_name', 'first_name', 'middle_name'
        ]


class AttemptListSerializer(serializers.ModelSerializer):
    test_title = serializers.CharField(source='test.title', read_only=True)
    student_name = serializers.CharField(source='student.get_full_name', read_only=True)
    triggers = serializers.JSONField(source='triggers_snapshot', read_only=True)
    selected_trigger = QuestionTriggerSerializer(read_only=True)
    
    class Meta:
        model = Attempt
        fields = [
            'id', 'test_title', 'student_name', 'status', 'score',
            'started_at', 'completed_at', 'triggers', 'selected_trigger',
            'military_rank', 'management_body', 'last_name', 'first_name', 'middle_name'
        ]


class SubmitAnswerSerializer(serializers.Serializer):
    question_id = serializers.IntegerField()
    selected_option = serializers.ChoiceField(choices=[('A', 'A'), ('B', 'B'), ('C', 'C'), ('D', 'D')])
    
    def validate_question_id(self, value):
        try:
            Question.objects.get(id=value)
        except Question.DoesNotExist:
            raise serializers.ValidationError("Вопрос не найден")
        return value



