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
import logging
import os
import random
import re
from .models import QuestionTrigger, Question, Test, Attempt, Answer, StudentProfile, SummaryReport, TestingPeriod
from .serializers import (
    UserSerializer, RegisterSerializer, CreateTeacherSerializer, CreateStudentSerializer,
    UpdateStudentSerializer,
    QuestionTriggerSerializer, QuestionSerializer, QuestionListSerializer,
    TestSerializer, TestCreateSerializer, TestListSerializer, AttemptSerializer,
    AttemptListSerializer, SubmitAnswerSerializer, StudentResultSerializer, StudentProfileUpdateSerializer,
    SummaryReportSerializer, get_question_content_filter, get_strict_question_language_filter, localized_question_value
)
from .question_selection import build_officer_question_ids, is_officer_only_selection
from .trigger_visibility import (
    SPECIAL_TRAINING_SLUG,
    SPECIAL_TRAINING_SUBTRIGGER_SLUGS,
    get_public_triggers_for_test,
    get_question_filter_for_public_triggers,
    public_triggers_queryset,
    test_allows_public_trigger,
)

User = get_user_model()
MAX_TEST_ATTEMPTS = 1
QUESTIONS_PER_ATTEMPT = 100
VARIABLE_QUESTION_COUNT_TRIGGER_SLUGS = (SPECIAL_TRAINING_SLUG, *SPECIAL_TRAINING_SUBTRIGGER_SLUGS)
TEST_DURATION = timedelta(minutes=50)
COMPLETED_ATTEMPT_RETENTION = timedelta(days=45)
SUMMARY_SAVE_DELAY = timedelta(days=3)
SUMMARY_REPORT_RETENTION = timedelta(days=90)
logger = logging.getLogger(__name__)


def get_attempt_expires_at(attempt):
    return attempt.started_at + TEST_DURATION


def get_request_language(request):
    language = request.query_params.get('lang')
    if language == 'kg':
        language = 'ky'
    return language if language in ('ru', 'ky') else 'ru'


QUESTION_TRANSLATION_DICTIONARY = {
    'ru_to_ky': {
        'вопрос': 'суроо',
        'ответ': 'жооп',
        'правильный': 'туура',
        'правильный ответ': 'туура жооп',
        'тест': 'тест',
        'военный': 'аскердик',
        'аскердик': 'аскердик',
        'закон': 'мыйзам',
        'управление': 'башкаруу',
        'командир': 'командир',
        'приказ': 'буйрук',
        'устав': 'устав',
        'безопасность': 'коопсуздук',
    },
    'ky_to_ru': {
        'суроо': 'вопрос',
        'жооп': 'ответ',
        'туура': 'правильный',
        'туура жооп': 'правильный ответ',
        'тест': 'тест',
        'аскердик': 'военный',
        'аскер': 'военный',
        'мыйзам': 'закон',
        'башкаруу': 'управление',
        'командир': 'командир',
        'буйрук': 'приказ',
        'устав': 'устав',
        'коопсуздук': 'безопасность',
    },
}


def simple_translate_text(value, target_language):
    text = str(value or '').strip()
    if not text:
        return ''

    direction = 'ru_to_ky' if target_language == 'ky' else 'ky_to_ru'
    dictionary = QUESTION_TRANSLATION_DICTIONARY[direction]
    lower = text.lower()
    if lower in dictionary:
        return dictionary[lower]

    def replace_word(match):
        word = match.group(0)
        translated = dictionary.get(word.lower())
        if not translated:
            return word
        if word[:1].isupper():
            return translated[:1].upper() + translated[1:]
        return translated

    return re.sub(r'[A-Za-zА-Яа-яЁёӨөҮүҢң]+', replace_word, text)


def translate_question_payload(payload):
    translated = dict(payload or {})
    for field in ['text', 'option_a', 'option_b', 'option_c', 'option_d']:
        ru_key = f'{field}_ru'
        ky_key = f'{field}_ky'
        kg_key = f'{field}_kg'
        if field == 'text':
            ru_alias = 'question_ru'
            kg_alias = 'question_kg'
        else:
            ru_alias = None
            kg_alias = kg_key
        base_value = translated.get(field, '')
        ru_value = translated.get(ru_key, '') or (translated.get(ru_alias, '') if ru_alias else '') or base_value
        ky_value = translated.get(ky_key, '') or translated.get(kg_alias, '')

        if ru_value and not translated.get(ru_key):
            translated[ru_key] = ru_value
        if ru_value and not ky_value:
            translated[ky_key] = simple_translate_text(ru_value, 'ky')
        if ky_value and not ru_value:
            translated[ru_key] = simple_translate_text(ky_value, 'ru')
        translated[field] = translated.get(ru_key) or translated.get(ky_key) or base_value
        if field == 'text':
            translated['question_ru'] = translated.get(ru_key, '')
            translated['question_kg'] = translated.get(ky_key, '')
        else:
            translated[kg_key] = translated.get(ky_key, '')
    return translated


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
        for trigger in get_public_triggers_for_test(test, QuestionTrigger)
    ]


def serialize_trigger(trigger):
    if not trigger:
        return None
    return {'id': trigger.id, 'name': trigger.name, 'slug': trigger.slug}


def get_translated_question_filter(language):
    if language == 'ru':
        return get_strict_question_language_filter('ru')
    return get_question_content_filter(language)


def get_question_ids_queryset_for_triggers(triggers, language='ky'):
    question_filter = get_question_filter_for_public_triggers(triggers)
    queryset = Question.objects.filter(question_filter).distinct()
    return queryset


def should_use_all_available_questions(triggers):
    slugs = {getattr(trigger, 'slug', '') for trigger in triggers}
    return bool(slugs) and slugs.issubset(set(VARIABLE_QUESTION_COUNT_TRIGGER_SLUGS))


def get_min_questions_for_trigger(trigger):
    return 1 if getattr(trigger, 'slug', '') in VARIABLE_QUESTION_COUNT_TRIGGER_SLUGS else QUESTIONS_PER_ATTEMPT


def build_question_ids_for_triggers(triggers, language='ky'):
    triggers = list(triggers)
    question_ids = list(
        get_question_ids_queryset_for_triggers(triggers, language)
        .values_list('id', flat=True)
    )

    if len(question_ids) < QUESTIONS_PER_ATTEMPT:
        if (
            len(triggers) == 1 and
            getattr(triggers[0], 'slug', '') in SPECIAL_TRAINING_SUBTRIGGER_SLUGS
        ):
            return [], 'В выбранной подкатегории меньше 100 вопросов'
        return [], 'Для данной категории недостаточно вопросов'

    selected_ids = random.sample(question_ids, QUESTIONS_PER_ATTEMPT)
    random.shuffle(selected_ids)
    return selected_ids, None


def get_attempt_triggers(attempt):
    snapshot_ids = [
        item.get('id')
        for item in (attempt.triggers_snapshot or [])
        if isinstance(item, dict) and item.get('id')
    ]
    if snapshot_ids:
        triggers = list(public_triggers_queryset(QuestionTrigger).filter(id__in=snapshot_ids))
        triggers.sort(key=lambda trigger: snapshot_ids.index(trigger.id))
        return triggers
    if attempt.selected_trigger_id:
        return [attempt.selected_trigger]
    return list(get_public_triggers_for_test(attempt.test, QuestionTrigger))


def reset_unanswered_attempt_questions_for_language(attempt, language):
    if language != 'ru' or attempt.answers.exists():
        return None

    current_ids = list(attempt.question_order or attempt.questions.values_list('id', flat=True))
    if current_ids:
        translated_current_count = (
            Question.objects.filter(id__in=current_ids)
            .filter(get_translated_question_filter('ru'))
            .count()
        )
        if translated_current_count == len(current_ids):
            return None

    question_ids, question_error = build_question_ids_for_triggers(get_attempt_triggers(attempt), language='ru')
    if question_error:
        return question_error

    answer_order = build_answer_order_for_question_ids(question_ids)
    attempt.question_order = question_ids
    attempt.answer_order = answer_order
    attempt.save(update_fields=['question_order', 'answer_order'])
    attempt.questions.set(question_ids)
    return None


def randomize_attempt_questions(attempt):
    if attempt.question_order:
        question_ids = list(attempt.question_order)
        answer_order = attempt.answer_order or build_answer_order_for_question_ids(question_ids)
        if not attempt.answer_order:
            attempt.answer_order = answer_order
            attempt.save(update_fields=['answer_order'])
        return question_ids, answer_order, None

    source_ids = list(attempt.questions.values_list('id', flat=True).distinct())
    if not source_ids:
        source_ids = list(attempt.test.questions.values_list('id', flat=True).distinct())

    if len(source_ids) < QUESTIONS_PER_ATTEMPT:
        return [], {}, 'Недостаточно вопросов для теста'

    if len(source_ids) > QUESTIONS_PER_ATTEMPT:
        question_ids = random.sample(source_ids, QUESTIONS_PER_ATTEMPT)
    else:
        question_ids = source_ids[:]

    random.shuffle(question_ids)
    answer_order = build_answer_order_for_question_ids(question_ids)
    attempt.question_order = question_ids
    attempt.answer_order = answer_order
    attempt.save(update_fields=['question_order', 'answer_order'])
    return question_ids, answer_order, None


def get_trigger_question_queryset(trigger):
    return Question.objects.filter(
        get_question_filter_for_public_triggers([trigger])
    ).distinct()


def ensure_active_test_for_trigger(trigger):
    questions = get_trigger_question_queryset(trigger)
    question_count = questions.count()
    min_questions = get_min_questions_for_trigger(trigger)
    logger.info(
        'Checking test availability for category: id=%s slug=%s name=%s questions=%s',
        trigger.id,
        trigger.slug,
        trigger.name,
        question_count,
    )

    if question_count < min_questions:
        logger.warning(
            'Test availability blocked: category_id=%s slug=%s questions=%s reason=not_enough_questions',
            trigger.id,
            trigger.slug,
            question_count,
        )
        return None, question_count

    existing_test = (
        Test.objects.filter(is_active=True, triggers=trigger)
        .annotate(question_count_db=Count('questions', distinct=True))
        .filter(question_count_db__gte=min_questions)
        .order_by('id')
        .first()
    )
    if existing_test:
        return existing_test, question_count

    reusable_test = (
        Test.objects.filter(triggers=trigger)
        .annotate(question_count_db=Count('questions', distinct=True))
        .filter(question_count_db__gte=min_questions)
        .order_by('-created_at')
        .first()
    )
    if reusable_test:
        if not reusable_test.is_active:
            reusable_test.is_active = True
            reusable_test.save(update_fields=['is_active'])
        logger.info(
            'Activated existing test for category: test_id=%s category_id=%s questions=%s',
            reusable_test.id,
            trigger.id,
            question_count,
        )
        return reusable_test, question_count

    teacher = questions.select_related('created_by').order_by('id').first().created_by
    test = Test.objects.create(
        title=trigger.name,
        teacher=teacher,
        is_active=True,
    )
    test.triggers.set([trigger])
    test.questions.set(questions.values_list('id', flat=True))
    logger.info(
        'Created test for category: test_id=%s category_id=%s slug=%s questions=%s',
        test.id,
        trigger.id,
        trigger.slug,
        question_count,
    )
    return test, question_count


def ensure_available_public_tests():
    availability = []
    for trigger in public_triggers_queryset(QuestionTrigger):
        test, question_count = ensure_active_test_for_trigger(trigger)
        availability.append({
            'trigger_id': trigger.id,
            'slug': trigger.slug,
            'name': trigger.name,
            'question_count': question_count,
            'test_id': test.id if test else None,
            'available': bool(test),
        })
    logger.info('Available tests check response: %s', availability)
    return availability


def build_answer_order_for_question_ids(question_ids):
    questions = Question.objects.filter(id__in=question_ids).only('id', 'option_d')
    question_options = {}
    for question in questions:
        options = ['A', 'B', 'C']
        if str(question.option_d or '').strip():
            options.append('D')
        random.shuffle(options)
        question_options[str(question.id)] = options
    return question_options


def build_summary_rows(attempts):
    rows = []
    for attempt in attempts.select_related('student', 'test', 'test__teacher'):
        total_questions = attempt.total_questions()
        correct_count = attempt.score
        incorrect_count = max(0, total_questions - correct_count)
        percentage = round((correct_count / total_questions) * 100, 1) if total_questions else 0
        triggers = attempt.triggers_snapshot or ([serialize_trigger(attempt.selected_trigger)] if attempt.selected_trigger_id else serialize_attempt_triggers(attempt.test))
        category = ', '.join(trigger.get('name') or trigger.get('slug') or str(trigger) for trigger in triggers) or attempt.test.title
        
        # Use snapshot data if available, fallback to user profile
        student_name = f"{attempt.last_name} {attempt.first_name} {attempt.middle_name}".strip()
        if not student_name:
            student_name = get_full_name_or_username(attempt.student)
        
        rows.append({
            'student_name': student_name,
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
            'military_rank': attempt.military_rank or getattr(getattr(attempt.student, 'student_profile', None), 'military_rank', ''),
            'management_body': attempt.management_body or getattr(getattr(attempt.student, 'student_profile', None), 'management_body', ''),
        })
    return rows


SUMMARY_TRANSLATIONS = {
    'ru': {
        'Сводная ведомость': 'Сводная ведомость',
        'Дата формирования': 'Дата формирования',
        'Экзаменатор': 'Экзаменатор',
        'ФИО': 'ФИО',
        'Звание': 'Звание',
        'Орган упр.': 'Орган упр.',
        'Логин': 'Логин',
        'Тест / категория': 'Тест / категория',
        'Прав.': 'Прав.',
        'Неправ.': 'Неправ.',
        'Балл': 'Балл',
        '%': '%',
        'Дата и время': 'Дата и время',
        'экзаменатор': 'экзаменатор',
        'Все экзаменаторы': 'Все экзаменаторы',
    },
    'ky': {
        'Сводная ведомость': 'Жалпы ведомость',
        'Дата формирования': 'Түзүлгөн күнү',
        'Экзаменатор': 'Экзаменатор',
        'ФИО': 'Аты-жөнү',
        'Звание': 'Наамы',
        'Орган упр.': 'Башкаруу органы',
        'Логин': 'Логин',
        'Тест / категория': 'Тест / категория',
        'Прав.': 'Туура',
        'Неправ.': 'Туура эмес',
        'Балл': 'Упай',
        '%': '%',
        'Дата и время': 'Күнү жана убактысы',
        'экзаменатор': 'экзаменатор',
        'Все экзаменаторы': 'Бардык экзаменаторлор',
    },
}


def normalize_summary_language(language):
    if language == 'kg':
        language = 'ky'
    return language if language in SUMMARY_TRANSLATIONS else 'ru'


def summary_t(key, language='ru'):
    language = normalize_summary_language(language)
    return SUMMARY_TRANSLATIONS[language].get(key, SUMMARY_TRANSLATIONS['ru'].get(key, key))


def get_summary_title(title=None, language='ru'):
    if not title or title == SUMMARY_TRANSLATIONS['ru']['Сводная ведомость']:
        return summary_t('Сводная ведомость', language)
    return title


def build_summary_table(rows, language='ru'):
    headers = [
        'ФИО', 'Звание', 'Орган упр.', 'Логин', 'Экзаменатор', 'Тест / категория',
        'Прав.', 'Неправ.', 'Балл', '%', 'Дата и время',
    ]
    table_rows = [[summary_t(header, language) for header in headers]]
    for row in rows:
        table_rows.append([
            row.get('student_name') or '',
            row.get('military_rank') or '',
            row.get('management_body') or '',
            row.get('student_username') or '',
            row.get('teacher_name') or '',
            row.get('category') or '',
            str(row.get('correct_count', 0)),
            str(row.get('incorrect_count', 0)),
            f"{row.get('score', 0)} / {row.get('total_questions', 0)}",
            f"{row.get('percentage', 0)}%",
            row['completed_at'][:19].replace('T', ' ') if row.get('completed_at') else '-',
        ])
    return table_rows


def generate_summary_pdf(rows, title=None, teacher_name=None, language='ru'):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    title = get_summary_title(title, language)
    teacher_name = teacher_name or summary_t('Все экзаменаторы', language)
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

    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=6 * mm, rightMargin=6 * mm)
    styles = getSampleStyleSheet()
    styles['Title'].fontName = font_name
    styles['Normal'].fontName = font_name

    header_style = ParagraphStyle(
        'SummaryTableHeader',
        parent=styles['Normal'],
        fontName=font_name,
        fontSize=6.8,
        leading=7.4,
        alignment=TA_CENTER,
        wordWrap='CJK',
    )
    cell_style = ParagraphStyle(
        'SummaryTableCell',
        parent=styles['Normal'],
        fontName=font_name,
        fontSize=7.4,
        leading=8.2,
        wordWrap='CJK',
    )
    centered_cell_style = ParagraphStyle(
        'SummaryTableCenteredCell',
        parent=cell_style,
        alignment=TA_CENTER,
    )

    def paragraph(value, style=cell_style):
        return Paragraph(escape(str(value or '')), style)

    table_rows = build_summary_table(rows, language)
    table_rows[0] = [paragraph(header, header_style) for header in table_rows[0]]
    for row_index, row in enumerate(table_rows[1:], start=1):
        table_rows[row_index] = [
            paragraph(row[0]),
            paragraph(row[1]),
            paragraph(row[2]),
            paragraph(row[3], centered_cell_style),
            paragraph(row[4]),
            paragraph(row[5]),
            paragraph(row[6], centered_cell_style),
            paragraph(row[7], centered_cell_style),
            paragraph(row[8], centered_cell_style),
            paragraph(row[9], centered_cell_style),
            paragraph(row[10], centered_cell_style),
        ]

    table = Table(
        table_rows,
        repeatRows=1,
        colWidths=[42 * mm, 24 * mm, 35 * mm, 22 * mm, 32 * mm, 46 * mm, 14 * mm, 19 * mm, 16 * mm, 10 * mm, 25 * mm],
    )
    table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), font_name),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8f5ee')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#14532d')),
        ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#b7c5bd')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('ALIGN', (3, 1), (3, -1), 'CENTER'),
        ('ALIGN', (6, 1), (10, -1), 'CENTER'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2.2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2.2),
        ('TOPPADDING', (0, 0), (-1, 0), 4),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 4),
        ('TOPPADDING', (0, 1), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 2.5),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8faf9')]),
    ]))

    doc.build([
        Paragraph(title, styles['Title']),
        Spacer(1, 8),
        Paragraph(f"{summary_t('Дата формирования', language)}: {timezone.localtime().strftime('%d.%m.%Y %H:%M')}", styles['Normal']),
        Paragraph(f"{summary_t('Экзаменатор', language)}: {teacher_name}", styles['Normal']),
        Spacer(1, 12),
        table,
    ])
    return buffer.getvalue()


def create_summary_report(teacher, attempts, title='Сводная ведомость', testing_period=None, language='ru'):
    rows = build_summary_rows(attempts)
    if not rows:
        return None

    if testing_period:
        existing_report = getattr(testing_period, 'summary_report', None)
        if existing_report:
            return existing_report

    teacher_name = get_full_name_or_username(teacher) if teacher else summary_t('Все экзаменаторы', language)
    pdf = generate_summary_pdf(rows, title, teacher_name=teacher_name, language=language)
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


