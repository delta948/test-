from core.view_utils import *

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

    def get_summary_payload(self, request):
        process_expired_testing_data()
        is_admin = (
            request.user.is_staff or
            request.user.is_superuser or
            getattr(request.user, 'role', None) == 'admin'
        )
        teacher_id = request.query_params.get('teacher_id')
        language = normalize_summary_language(request.query_params.get('lang') or request.query_params.get('language'))
        teacher_name = summary_t('Все экзаменаторы', language)

        if is_admin:
            attempts = Attempt.objects.filter(status='completed')
            if teacher_id:
                teacher = User.objects.filter(id=teacher_id, role='teacher').first()
                if not teacher:
                    return Response({'error': 'Экзаменатор не найден'}, status=status.HTTP_404_NOT_FOUND)
                attempts = attempts.filter(student__created_by_teacher=teacher)
                teacher_name = get_full_name_or_username(teacher)
        else:
            if teacher_id and str(request.user.id) != str(teacher_id):
                return Response({'error': 'Нет доступа к ведомости другого экзаменатора'}, status=status.HTTP_403_FORBIDDEN)
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

        return rows, teacher_name, teacher_id, language

    def get(self, request):
        payload = self.get_summary_payload(request)
        if isinstance(payload, Response):
            return payload
        rows, teacher_name, teacher_id, language = payload
        pdf = generate_summary_pdf(rows, teacher_name=teacher_name, language=language)
        filename = f"summary-report-{language}-{teacher_id or 'all'}.pdf"
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



