from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Avg, Q
import random
from .models import QuestionTrigger, Question, Test, Attempt, Answer, StudentProfile, SummaryReport
from .trigger_visibility import (
    SPECIAL_TRAINING_SLUG,
    SPECIAL_TRAINING_SUBTRIGGER_SLUGS,
    get_public_trigger_for_source,
    get_public_triggers_for_test,
    get_question_filter_for_public_triggers,
    public_triggers_queryset,
)
from .question_selection import build_officer_question_ids, is_officer_only_selection

User = get_user_model()
VARIABLE_QUESTION_COUNT_TRIGGER_SLUGS = (SPECIAL_TRAINING_SLUG, *SPECIAL_TRAINING_SUBTRIGGER_SLUGS)

QUESTION_BASE_FIELDS = ['text', 'option_a', 'option_b', 'option_c', 'option_d']
QUESTION_LANGUAGE_FIELDS = [
    'text_ru', 'text_ky',
    'option_a_ru', 'option_a_ky',
    'option_b_ru', 'option_b_ky',
    'option_c_ru', 'option_c_ky',
    'option_d_ru', 'option_d_ky',
]
QUESTION_ALIAS_FIELDS = [
    'question_ru', 'question_kg',
    'option_a_kg', 'option_b_kg', 'option_c_kg', 'option_d_kg',
]


def localized_question_value(obj, field, language=None):
    def clean(value):
        text = str(value or '').strip()
        if not text or all(char == '?' or char.isspace() for char in text):
            return ''
        return value

    language = language if language in ('ru', 'ky') else 'ru'
    preferred = clean(getattr(obj, f'{field}_{language}', '') or '')
    legacy = clean(getattr(obj, field, '') or '')
    fallback_language = 'ky' if language == 'ru' else 'ru'
    fallback = clean(getattr(obj, f'{field}_{fallback_language}', '') or '')
    return preferred or legacy or fallback


def get_question_content_filter(language=None):
    language = language if language in ('ru', 'ky') else 'ru'
    fallback_language = 'ky' if language == 'ru' else 'ru'

    def has_value(field):
        return (
            (Q(**{f'{field}_{language}__isnull': False}) & ~Q(**{f'{field}_{language}__exact': ''})) |
            (Q(**{f'{field}__isnull': False}) & ~Q(**{f'{field}__exact': ''})) |
            (Q(**{f'{field}_{fallback_language}__isnull': False}) & ~Q(**{f'{field}_{fallback_language}__exact': ''}))
        )

    return (
        has_value('text') &
        has_value('option_a') &
        has_value('option_b') &
        has_value('option_c')
    )


def get_strict_question_language_filter(language=None):
    language = language if language in ('ru', 'ky') else 'ru'
    return (
        Q(**{f'text_{language}__isnull': False}) & ~Q(**{f'text_{language}__exact': ''}) &
        Q(**{f'option_a_{language}__isnull': False}) & ~Q(**{f'option_a_{language}__exact': ''}) &
        Q(**{f'option_b_{language}__isnull': False}) & ~Q(**{f'option_b_{language}__exact': ''}) &
        Q(**{f'option_c_{language}__isnull': False}) & ~Q(**{f'option_c_{language}__exact': ''})
    )



