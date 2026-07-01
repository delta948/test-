from core.view_utils import *
from pathlib import Path
from tempfile import NamedTemporaryFile

from django.core.management.base import CommandError
from rest_framework.parsers import FormParser, MultiPartParser

from questions.management.commands.import_officer_questions import load_fixture, normalize_text

class QuestionTriggerListCreateView(generics.ListCreateAPIView):
    serializer_class = QuestionTriggerSerializer

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.IsAuthenticated()]
        return [IsAdminUser()]

    def get_queryset(self):
        queryset = public_triggers_queryset(QuestionTrigger).annotate(
            question_count=Count('questions', distinct=True),
            attempts_count=Count('tests__attempts', filter=Q(tests__attempts__status='completed'), distinct=True),
            average_score=Avg('tests__attempts__score', filter=Q(tests__attempts__status='completed')),
        )
        return queryset


class QuestionTriggerDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuestionTriggerSerializer
    permission_classes = [IsAdminUser]
    queryset = public_triggers_queryset(QuestionTrigger)

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
        trigger = public_triggers_queryset(QuestionTrigger).filter(id=trigger_id).first()
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
                    'text_ru': item.get('text_ru') or item.get('question_ru', ''),
                    'text_ky': item.get('text_ky') or item.get('question_kg', ''),
                    'option_a': item.get('option_a', ''),
                    'option_a_ru': item.get('option_a_ru', ''),
                    'option_a_ky': item.get('option_a_ky') or item.get('option_a_kg', ''),
                    'option_b': item.get('option_b', ''),
                    'option_b_ru': item.get('option_b_ru', ''),
                    'option_b_ky': item.get('option_b_ky') or item.get('option_b_kg', ''),
                    'option_c': item.get('option_c', ''),
                    'option_c_ru': item.get('option_c_ru', ''),
                    'option_c_ky': item.get('option_c_ky') or item.get('option_c_kg', ''),
                    'option_d': item.get('option_d', ''),
                    'option_d_ru': item.get('option_d_ru', ''),
                    'option_d_ky': item.get('option_d_ky') or item.get('option_d_kg', ''),
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


class QuestionTriggerQuestionDocxImportView(APIView):
    permission_classes = [IsAdminUser]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, trigger_id):
        trigger = public_triggers_queryset(QuestionTrigger).filter(id=trigger_id).first()
        if not trigger:
            return Response({'error': 'Триггер не найден'}, status=status.HTTP_404_NOT_FOUND)

        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'Передайте DOCX файл в поле file'}, status=status.HTTP_400_BAD_REQUEST)
        if not str(upload.name or '').lower().endswith('.docx'):
            return Response({'error': 'Поддерживается только формат .docx'}, status=status.HTTP_400_BAD_REQUEST)

        tmp_path = None
        try:
            with NamedTemporaryFile(delete=False, suffix='.docx') as tmp_file:
                tmp_path = tmp_file.name
                for chunk in upload.chunks():
                    tmp_file.write(chunk)

            parsed_questions = load_fixture(Path(tmp_path))
        except CommandError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.exception('DOCX question import failed')
            return Response({'error': f'Не удалось прочитать DOCX файл: {exc}'}, status=status.HTTP_400_BAD_REQUEST)
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

        added = 0
        duplicates = 0
        errors = 0
        existing_keys = set()
        for existing in Question.objects.filter(trigger=trigger):
            for value in (existing.text, existing.text_ru, existing.text_ky):
                key = normalize_text(value)
                if key:
                    existing_keys.add(key)

        imported_keys = set()
        for item in parsed_questions:
            payload = {
                'text': item.get('text', ''),
                'text_ru': item.get('text_ru', ''),
                'text_ky': item.get('text_ky', item.get('text', '')),
                'option_a': item.get('option_a', ''),
                'option_a_ru': item.get('option_a_ru', ''),
                'option_a_ky': item.get('option_a_ky', item.get('option_a', '')),
                'option_b': item.get('option_b', ''),
                'option_b_ru': item.get('option_b_ru', ''),
                'option_b_ky': item.get('option_b_ky', item.get('option_b', '')),
                'option_c': item.get('option_c', ''),
                'option_c_ru': item.get('option_c_ru', ''),
                'option_c_ky': item.get('option_c_ky', item.get('option_c', '')),
                'option_d': item.get('option_d', ''),
                'option_d_ru': item.get('option_d_ru', ''),
                'option_d_ky': item.get('option_d_ky', item.get('option_d', '')),
                'correct_answer': item.get('correct_answer', ''),
                'explanation': item.get('explanation', ''),
                'trigger_id': trigger.id,
            }
            key = normalize_text(payload.get('text_ru') or payload.get('text_ky') or payload.get('text'))
            if not key or key in existing_keys or key in imported_keys:
                duplicates += 1
                continue

            serializer = QuestionSerializer(data=payload)
            if not serializer.is_valid():
                errors += 1
                continue

            serializer.save(created_by=request.user)
            imported_keys.add(key)
            added += 1

        return Response({
            'added': added,
            'duplicates': duplicates,
            'errors': errors,
            'total': len(parsed_questions),
        }, status=status.HTTP_201_CREATED)


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
            trigger = public_triggers_queryset(QuestionTrigger).filter(id=trigger_id).first()
            if not trigger:
                return queryset.none()
            queryset = queryset.filter(get_question_filter_for_public_triggers([trigger]))
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


class QuestionTranslateView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request):
        return Response(translate_question_payload(request.data))



