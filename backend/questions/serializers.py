from core.serializer_utils import *

class QuestionTriggerSerializer(serializers.ModelSerializer):
    question_count = serializers.SerializerMethodField()
    question_count_ru = serializers.SerializerMethodField()
    attempts_count = serializers.SerializerMethodField()
    average_score = serializers.SerializerMethodField()
    success_rate = serializers.SerializerMethodField()
    parent_id = serializers.IntegerField(source='parent.id', read_only=True)
    parent_slug = serializers.CharField(source='parent.slug', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True)

    class Meta:
        model = QuestionTrigger
        fields = [
            'id', 'name', 'slug', 'parent_id', 'parent_slug', 'parent_name', 'description', 'is_active',
            'question_count', 'question_count_ru', 'attempts_count', 'average_score',
            'success_rate', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_question_count(self, obj):
        if getattr(obj, 'slug', '') == 'officer':
            return Question.objects.filter(trigger__slug__in=['officer', 'junior_officer', 'senior_officer']).count()
        if getattr(obj, 'slug', '') == SPECIAL_TRAINING_SLUG:
            return Question.objects.filter(trigger__slug__in=(SPECIAL_TRAINING_SLUG, *SPECIAL_TRAINING_SUBTRIGGER_SLUGS)).count()
        return getattr(obj, 'question_count', None) or obj.questions.count()

    def get_question_count_ru(self, obj):
        if getattr(obj, 'slug', '') == 'officer':
            queryset = Question.objects.filter(trigger__slug__in=['officer', 'junior_officer', 'senior_officer'])
        elif getattr(obj, 'slug', '') == SPECIAL_TRAINING_SLUG:
            queryset = Question.objects.filter(trigger__slug__in=(SPECIAL_TRAINING_SLUG, *SPECIAL_TRAINING_SUBTRIGGER_SLUGS))
        else:
            queryset = obj.questions.all()
        return queryset.filter(get_strict_question_language_filter('ru')).count()

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
        queryset=public_triggers_queryset(QuestionTrigger),
        source='trigger',
        write_only=True,
        required=True
    )
    trigger = serializers.SerializerMethodField()
    question_ru = serializers.SerializerMethodField()
    question_kg = serializers.SerializerMethodField()
    option_a_kg = serializers.SerializerMethodField()
    option_b_kg = serializers.SerializerMethodField()
    option_c_kg = serializers.SerializerMethodField()
    option_d_kg = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = [
            'id', 'text', 'text_ru', 'text_ky',
            'option_a', 'option_a_ru', 'option_a_ky',
            'option_b', 'option_b_ru', 'option_b_ky',
            'option_c', 'option_c_ru', 'option_c_ky',
            'option_d', 'option_d_ru', 'option_d_ky',
            *QUESTION_ALIAS_FIELDS,
            'correct_answer', 'explanation', 'trigger', 'trigger_id', 'created_at'
        ]
        read_only_fields = ['created_at', *QUESTION_ALIAS_FIELDS]

    def to_internal_value(self, data):
        if hasattr(data, 'copy'):
            data = data.copy()
        alias_map = {
            'question_ru': 'text_ru',
            'question_kg': 'text_ky',
            'option_a_kg': 'option_a_ky',
            'option_b_kg': 'option_b_ky',
            'option_c_kg': 'option_c_ky',
            'option_d_kg': 'option_d_ky',
        }
        for alias, target in alias_map.items():
            if alias in data and target not in data:
                data[target] = data[alias]
        return super().to_internal_value(data)

    def get_question_ru(self, obj):
        return localized_question_value(obj, 'text', 'ru')

    def get_question_kg(self, obj):
        return localized_question_value(obj, 'text', 'ky')

    def get_option_a_kg(self, obj):
        return localized_question_value(obj, 'option_a', 'ky')

    def get_option_b_kg(self, obj):
        return localized_question_value(obj, 'option_b', 'ky')

    def get_option_c_kg(self, obj):
        return localized_question_value(obj, 'option_c', 'ky')

    def get_option_d_kg(self, obj):
        return localized_question_value(obj, 'option_d', 'ky')

    def get_trigger(self, obj):
        trigger = get_public_trigger_for_source(obj.trigger, QuestionTrigger)
        return QuestionTriggerSerializer(trigger).data if trigger else None

    def validate(self, attrs):
        for field in QUESTION_BASE_FIELDS:
            field_was_sent = (
                field in attrs or
                f'{field}_ru' in attrs or
                f'{field}_ky' in attrs
            )
            if not field_was_sent:
                continue

            current_value = attrs.get(field, getattr(self.instance, field, '') if self.instance else '')
            ru_value = attrs.get(f'{field}_ru', getattr(self.instance, f'{field}_ru', '') if self.instance else '')
            ky_value = attrs.get(f'{field}_ky', getattr(self.instance, f'{field}_ky', '') if self.instance else '')
            if not current_value:
                attrs[field] = ru_value or ky_value
        return attrs


class QuestionListSerializer(serializers.ModelSerializer):
    answers = serializers.SerializerMethodField()
    text = serializers.SerializerMethodField()
    question_ru = serializers.SerializerMethodField()
    question_kg = serializers.SerializerMethodField()
    option_a_kg = serializers.SerializerMethodField()
    option_b_kg = serializers.SerializerMethodField()
    option_c_kg = serializers.SerializerMethodField()
    option_d_kg = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = [
            'id', 'text', 'text_ru', 'text_ky',
            'option_a', 'option_a_ru', 'option_a_ky',
            'option_b', 'option_b_ru', 'option_b_ky',
            'option_c', 'option_c_ru', 'option_c_ky',
            'option_d', 'option_d_ru', 'option_d_ky',
            *QUESTION_ALIAS_FIELDS,
            'answers', 'explanation',
        ]

    def get_language(self):
        request = self.context.get('request')
        language = request.query_params.get('lang') if request else None

        if language == 'kg':
            language = 'ky'

        return language if language in ('ru', 'ky') else 'ru'
        

    def get_text(self, obj):
        return localized_question_value(obj, 'text', self.get_language())

    def get_question_ru(self, obj):
        return localized_question_value(obj, 'text', 'ru')

    def get_question_kg(self, obj):
        return localized_question_value(obj, 'text', 'ky')

    def get_option_a_kg(self, obj):
        return localized_question_value(obj, 'option_a', 'ky')

    def get_option_b_kg(self, obj):
        return localized_question_value(obj, 'option_b', 'ky')

    def get_option_c_kg(self, obj):
        return localized_question_value(obj, 'option_c', 'ky')

    def get_option_d_kg(self, obj):
        return localized_question_value(obj, 'option_d', 'ky')

    def get_answers(self, obj):
        language = self.get_language()
        options = [
            {
                'original_key': 'A',
                'text': localized_question_value(obj, 'option_a', language),
                'text_ru': localized_question_value(obj, 'option_a', 'ru'),
                'text_ky': localized_question_value(obj, 'option_a', 'ky'),
                'text_kg': localized_question_value(obj, 'option_a', 'ky'),
            },
            {
                'original_key': 'B',
                'text': localized_question_value(obj, 'option_b', language),
                'text_ru': localized_question_value(obj, 'option_b', 'ru'),
                'text_ky': localized_question_value(obj, 'option_b', 'ky'),
                'text_kg': localized_question_value(obj, 'option_b', 'ky'),
            },
            {
                'original_key': 'C',
                'text': localized_question_value(obj, 'option_c', language),
                'text_ru': localized_question_value(obj, 'option_c', 'ru'),
                'text_ky': localized_question_value(obj, 'option_c', 'ky'),
                'text_kg': localized_question_value(obj, 'option_c', 'ky'),
            },
        ]
        option_d = localized_question_value(obj, 'option_d', language)
        if option_d:
            options.append({
                'original_key': 'D',
                'text': option_d,
                'text_ru': localized_question_value(obj, 'option_d', 'ru'),
                'text_ky': localized_question_value(obj, 'option_d', 'ky'),
                'text_kg': localized_question_value(obj, 'option_d', 'ky'),
            })
        options_by_key = {option['original_key']: option for option in options}
        answer_order = self.context.get('answer_order') or {}
        ordered_keys = answer_order.get(str(obj.id)) or answer_order.get(obj.id)
        if ordered_keys:
            ordered_options = [
                options_by_key[key]
                for key in ordered_keys
                if key in options_by_key
            ]
            used_keys = {option['original_key'] for option in ordered_options}
            ordered_options.extend(
                option for option in options
                if option['original_key'] not in used_keys
            )
            options = ordered_options
        else:
            random.shuffle(options)
        
        return [
            {
                'key': chr(65 + index),
                'text': option['text'],
                'text_ru': option['text_ru'],
                'text_ky': option['text_ky'],
                'text_kg': option['text_kg'],
                'original_key': option['original_key'],
            }
            for index, option in enumerate(options)
        ]



