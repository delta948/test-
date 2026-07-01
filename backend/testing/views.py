from core.view_utils import *

def error_response(message, status_code, **extra):
    return Response(
        {'message': message, 'error': message, **extra},
        status=status_code,
        content_type='application/json; charset=utf-8',
    )


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
                question_count_db__gte=QUESTIONS_PER_ATTEMPT
            )

        if user.is_teacher():
            return queryset.filter(teacher=user)

        return queryset.filter(is_active=True).annotate(
            question_count_db=Count('questions', distinct=True),
            completed_attempts=Count(
                'attempts',
                filter=Q(attempts__student=user, attempts__status='completed')
            )
        ).filter(question_count_db__gte=QUESTIONS_PER_ATTEMPT)

    def create(self, request, *args, **kwargs):
        user = request.user
        if not (
            user.is_teacher() or user.is_staff or user.is_superuser or
            getattr(user, 'role', None) == 'admin'
        ):
            return Response(
                {'error': 'Только экзаменатор или администратор может создавать тесты'},
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
        ensure_available_public_tests()
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
            question_count_db__gte=1
        ).select_related('teacher').prefetch_related('questions', 'triggers')


class StartAttemptView(APIView):
    permission_classes = [IsStudent]
    
    def post(self, request, test_id):
        profile = getattr(request.user, 'student_profile', None)
        language = request.data.get('language')
        if language == 'kg':
            language = 'ky'
        language = language if language in ('ru', 'ky') else 'ky'

        if not profile or not profile.is_complete:
            logger.warning(
                'Start test blocked: user=%s test_id=%s reason=incomplete_student_profile',
                request.user.id,
                test_id,
            )
            return error_response(
                'Заполните воинское звание, фамилию, имя и отчество перед началом теста.',
                status.HTTP_400_BAD_REQUEST,
            )

        process_expired_testing_data()
        ensure_available_public_tests()
        try:
            test = Test.objects.prefetch_related('triggers').get(id=test_id, is_active=True)
        except Test.DoesNotExist:
            logger.warning(
                'Start test blocked: user=%s test_id=%s reason=test_not_found_or_inactive',
                request.user.id,
                test_id,
            )
            return error_response('Тест не найден или не активен', status.HTTP_404_NOT_FOUND)
        
        # Проверка количества завершенных попыток за последние 10 минут
        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
        raw_trigger_ids = request.data.get('trigger_ids')
        if raw_trigger_ids is None:
            raw_trigger_id = request.data.get('trigger_id')
            raw_trigger_ids = [raw_trigger_id] if raw_trigger_id else []

        try:
            trigger_ids = [int(trigger_id) for trigger_id in raw_trigger_ids]
        except (TypeError, ValueError):
            logger.warning(
                'Start test blocked: user=%s test_id=%s raw_category_ids=%s reason=invalid_category_ids',
                request.user.id,
                test.id,
                raw_trigger_ids,
            )
            return error_response('Выберите одну или несколько категорий', status.HTTP_400_BAD_REQUEST)

        trigger_ids = list(dict.fromkeys(trigger_ids))
        if not trigger_ids:
            logger.warning(
                'Start test blocked: user=%s test_id=%s reason=no_categories_selected',
                request.user.id,
                test.id,
            )
            return error_response('Выберите одну или несколько категорий', status.HTTP_400_BAD_REQUEST)

        selected_triggers = list(public_triggers_queryset(QuestionTrigger).filter(id__in=trigger_ids))
        found_trigger_ids = {trigger.id for trigger in selected_triggers}
        if set(trigger_ids) - found_trigger_ids:
            logger.warning(
                'Start test blocked: user=%s test_id=%s category_ids=%s found_category_ids=%s reason=category_not_found_or_inactive',
                request.user.id,
                test.id,
                trigger_ids,
                list(found_trigger_ids),
            )
            return error_response('Категория не найдена или неактивна', status.HTTP_404_NOT_FOUND)

        selected_triggers.sort(key=lambda trigger: trigger_ids.index(trigger.id))
        disallowed_triggers = [
            {'id': trigger.id, 'slug': trigger.slug, 'name': trigger.name}
            for trigger in selected_triggers
            if not test_allows_public_trigger(test, trigger)
        ]
        if disallowed_triggers:
            logger.warning(
                'Start test blocked: user=%s test_id=%s category_ids=%s categories=%s reason=test_does_not_allow_categories',
                request.user.id,
                test.id,
                trigger_ids,
                disallowed_triggers,
            )
            return error_response('Тест недоступен для выбранных категорий', status.HTTP_400_BAD_REQUEST)

        trigger_question_counts = {
            trigger.id: Question.objects.filter(get_question_filter_for_public_triggers([trigger])).count()
            for trigger in selected_triggers
        }
        logger.info(
            'Start test requested: user=%s test_id=%s category_ids=%s categories=%s question_counts=%s',
            request.user.id,
            test.id,
            trigger_ids,
            [
                {'id': trigger.id, 'slug': trigger.slug, 'name': trigger.name}
                for trigger in selected_triggers
            ],
            trigger_question_counts,
        )
        selected_trigger = selected_triggers[0] if len(selected_triggers) == 1 else None
        selected_trigger_snapshot = [serialize_trigger(trigger) for trigger in selected_triggers]

        completed_attempts = Attempt.objects.filter(
            student=request.user,
            test=test,
            status='completed',
            completed_at__gte=ten_minutes_ago
        ).count()
        
        if completed_attempts >= MAX_TEST_ATTEMPTS:
            logger.warning(
                'Start test blocked: user=%s test_id=%s category_ids=%s reason=attempt_limit_reached completed_attempts=%s',
                request.user.id,
                test.id,
                trigger_ids,
                completed_attempts,
            )
            return error_response(
                f'Вы исчерпали все попытки ({MAX_TEST_ATTEMPTS} из {MAX_TEST_ATTEMPTS}). Попробуйте через 10 минут.',
                status.HTTP_400_BAD_REQUEST,
            )
        
        question_ids, question_error = build_question_ids_for_triggers(selected_triggers, language=language)
        if question_error:
            logger.warning(
                'Start test blocked: not enough questions. user=%s test_id=%s category_ids=%s question_counts=%s reason=%s',
                request.user.id,
                test.id,
                trigger_ids,
                trigger_question_counts,
                question_error,
            )
            return error_response(
                question_error or 'Для данной категории недостаточно вопросов',
                status.HTTP_400_BAD_REQUEST,
                question_counts=trigger_question_counts,
            )

        answer_order = build_answer_order_for_question_ids(question_ids)

        if False:
            return error_response('Тест должен содержать ровно 100 вопросов', status.HTTP_400_BAD_REQUEST)
        
        with transaction.atomic():
            Attempt.objects.filter(
                student=request.user,
                test=test,
                status='in_progress',
            ).delete()

            period = test.testing_period
            if not period or period.processed_at:
                period = get_or_create_current_testing_period(test.teacher)
                test.testing_period = period
                test.save(update_fields=['testing_period'])

            attempt = Attempt.objects.create(
                student=request.user,
                test=test,
                military_rank=profile.military_rank,
                management_body=profile.management_body,
                last_name=request.user.last_name,
                first_name=request.user.first_name,
                middle_name=profile.middle_name,
                selected_trigger=selected_trigger,
                testing_period=period,
                status='in_progress',
                current_question_index=0,
                triggers_snapshot=selected_trigger_snapshot,
            )
            attempt.question_order = question_ids
            attempt.answer_order = answer_order
            attempt.save(update_fields=['question_order', 'answer_order'])
            attempt.questions.set(question_ids)
        
        serializer = AttemptSerializer(attempt, context={'request': request})
        response_data = {
            'message': 'Попытка начата',
            'attempt': serializer.data,
            'attempt_number': completed_attempts + 1,
            'attempts_left': MAX_TEST_ATTEMPTS - completed_attempts - 1,
            'expires_at': get_attempt_expires_at(attempt),
            'duration_seconds': int(TEST_DURATION.total_seconds())
        }
        logger.info(
            'Start test API response: user=%s test_id=%s attempt_id=%s category_ids=%s question_count=%s response=%s',
            request.user.id,
            test.id,
            attempt.id,
            trigger_ids,
            len(question_ids),
            response_data,
        )
        return Response(response_data, status=status.HTTP_201_CREATED)


class GetTestQuestionsView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, attempt_id):
        process_expired_testing_data()
        language = get_request_language(request)

        try:
            attempt = Attempt.objects.get(
                id=attempt_id,
                student=request.user,
                status='in_progress'
            )
        except Attempt.DoesNotExist:
            return Response(
                {'error': 'Попытка не найдена или завершена'},
                status=status.HTTP_404_NOT_FOUND
            )

        language_question_error = reset_unanswered_attempt_questions_for_language(attempt, language)
        if language_question_error:
            return Response(
                {'error': 'Недостаточно переведенных вопросов для русского языка'},
                status=status.HTTP_400_BAD_REQUEST
            )

        question_ids, answer_order, question_error = randomize_attempt_questions(attempt)

        if question_error:
            logger.warning(
                'Question randomization blocked: user=%s attempt_id=%s test_id=%s reason=%s',
                request.user.id,
                attempt.id,
                attempt.test_id,
                question_error,
            )
            return Response(
                {'error': 'Недостаточно вопросов для теста'},
                status=status.HTTP_400_BAD_REQUEST
            )

        preserved_order = Case(
            *[When(id=question_id, then=position) for position, question_id in enumerate(question_ids)],
            output_field=IntegerField(),
        )

        questions = attempt.questions.filter(id__in=question_ids).order_by(preserved_order)

        questions_data = []
        show_correct_answers = bool(getattr(request.user, 'training_mode', False))

        for question in questions:
            order = answer_order.get(str(question.id), ['A', 'B', 'C', 'D'])

            option_map = {
                'A': {
                    'key': 'A',
                    'original_key': 'A',
                    'text': localized_question_value(question, 'option_a', language),
                    'text_ru': localized_question_value(question, 'option_a', 'ru'),
                    'text_ky': localized_question_value(question, 'option_a', 'ky'),
                    'text_kg': localized_question_value(question, 'option_a', 'ky'),
                },
                'B': {
                    'key': 'B',
                    'original_key': 'B',
                    'text': localized_question_value(question, 'option_b', language),
                    'text_ru': localized_question_value(question, 'option_b', 'ru'),
                    'text_ky': localized_question_value(question, 'option_b', 'ky'),
                    'text_kg': localized_question_value(question, 'option_b', 'ky'),
                },
                'C': {
                    'key': 'C',
                    'original_key': 'C',
                    'text': localized_question_value(question, 'option_c', language),
                    'text_ru': localized_question_value(question, 'option_c', 'ru'),
                    'text_ky': localized_question_value(question, 'option_c', 'ky'),
                    'text_kg': localized_question_value(question, 'option_c', 'ky'),
                },
                'D': {
                    'key': 'D',
                    'original_key': 'D',
                    'text': localized_question_value(question, 'option_d', language),
                    'text_ru': localized_question_value(question, 'option_d', 'ru'),
                    'text_ky': localized_question_value(question, 'option_d', 'ky'),
                    'text_kg': localized_question_value(question, 'option_d', 'ky'),
                },
            }

            answers = []
            for key in order:
                item = option_map.get(key)
                if item and (item.get('text') or item.get('text_ru') or item.get('text_ky')):
                    answers.append(item)
            for index, answer in enumerate(answers):
                answer['key'] = chr(65 + index)

            question_data = {
                'id': question.id,

                'text': localized_question_value(question, 'text', language),
                'text_ru': localized_question_value(question, 'text', 'ru'),
                'text_ky': localized_question_value(question, 'text', 'ky'),
                'text_kg': localized_question_value(question, 'text', 'ky'),

                'question_ru': localized_question_value(question, 'text', 'ru'),
                'question_ky': localized_question_value(question, 'text', 'ky'),
                'question_kg': localized_question_value(question, 'text', 'ky'),

                'option_a': question.option_a,
                'option_a_ru': localized_question_value(question, 'option_a', 'ru'),
                'option_a_ky': localized_question_value(question, 'option_a', 'ky'),
                'option_a_kg': localized_question_value(question, 'option_a', 'ky'),

                'option_b': question.option_b,
                'option_b_ru': localized_question_value(question, 'option_b', 'ru'),
                'option_b_ky': localized_question_value(question, 'option_b', 'ky'),
                'option_b_kg': localized_question_value(question, 'option_b', 'ky'),

                'option_c': question.option_c,
                'option_c_ru': localized_question_value(question, 'option_c', 'ru'),
                'option_c_ky': localized_question_value(question, 'option_c', 'ky'),
                'option_c_kg': localized_question_value(question, 'option_c', 'ky'),

                'option_d': question.option_d,
                'option_d_ru': localized_question_value(question, 'option_d', 'ru'),
                'option_d_ky': localized_question_value(question, 'option_d', 'ky'),
                'option_d_kg': localized_question_value(question, 'option_d', 'ky'),

                'answers': answers,
            }
            if show_correct_answers:
                question_data['correct_answer'] = question.correct_answer
            questions_data.append(question_data)

        logger.info(
            'Question response: user=%s attempt_id=%s test_id=%s question_count=%s first_question_ids=%s',
            request.user.id,
            attempt.id,
            attempt.test_id,
            len(question_ids),
            question_ids[:10],
        )

        saved_answers = Answer.objects.filter(attempt=attempt)
        answered_questions = saved_answers.values_list('question_id', flat=True)

        return Response({
            'attempt_id': attempt.id,
            'current_question_index': attempt.current_question_index,
            'total_questions': len(questions_data),
            'questions': questions_data,
            'answered_question_ids': list(answered_questions),
            'selected_answers': {
                str(answer.question_id): answer.selected_option
                for answer in saved_answers
            },
            'show_correct_answers': show_correct_answers,
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
        
        serializer = AttemptSerializer(attempt, context={'request': request})
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



