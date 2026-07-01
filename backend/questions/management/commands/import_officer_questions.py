import json
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from questions.models import Question, QuestionTrigger
from testing.models import Test


OFFICER_CATEGORY = 'Контрольный срез знаний офицерского состава'
OFFICER_SLUG = 'officer'
DEFAULT_FIXTURE = 'questions_fixture.json'
DOCX_WORD_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
OPTION_LABELS = {'А': 'A', 'A': 'A', 'Б': 'B', 'B': 'B', 'В': 'C', 'V': 'C', 'C': 'C', 'Г': 'D', 'D': 'D'}
OPTION_ORDER = ['A', 'B', 'C', 'D']
OPTION_MARKER_RE = re.compile(r'^(?:Жооп:\s*)?([АAБBВVCГD])\)\s*(.*)$', re.IGNORECASE)
INLINE_OPTION_RE = re.compile(r'([АAБBВVCГD])\)\s*')


def clean_text(value):
    return str(value or '').strip()


def normalize_text(value):
    return ' '.join(unicodedata.normalize('NFC', str(value or '')).split()).casefold()


def normalize_option_label(value):
    return OPTION_LABELS.get(str(value or '').strip().upper(), '')


def is_correct_answer_line(text):
    normalized = normalize_text(text)
    return normalized.startswith('туура жо') and ':' in str(text)


def parse_correct_answer(text):
    tail = str(text).split(':', 1)[-1].strip()
    match = re.search(r'[АAБBВVCГD]', tail, re.IGNORECASE)
    if not match:
        return ''
    return normalize_option_label(match.group(0))


def docx_paragraph_text_and_bold(para):
    text_parts = []
    bold_ranges = []
    position = 0
    for run in para.iter(DOCX_WORD_NS + 'r'):
        run_text = ''.join(node.text or '' for node in run.iter(DOCX_WORD_NS + 't'))
        if not run_text:
            continue
        run_properties = run.find(DOCX_WORD_NS + 'rPr')
        is_bold = run_properties is not None and run_properties.find(DOCX_WORD_NS + 'b') is not None
        text_parts.append(run_text)
        if is_bold:
            bold_ranges.append((position, position + len(run_text)))
        position += len(run_text)

    text = ''.join(text_parts).strip()
    return text, bold_ranges


def has_bold_after_marker(text, bold_ranges, marker_end):
    for start, end in bold_ranges:
        if end <= marker_end:
            continue
        segment = text[max(start, marker_end):end]
        if segment.strip():
            return True
    return False


def read_docx_paragraphs(path):
    paragraphs = []
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))

    for para in root.iter(DOCX_WORD_NS + 'p'):
        text, bold_ranges = docx_paragraph_text_and_bold(para)
        if not text:
            continue
        marker = OPTION_MARKER_RE.match(text)
        label = normalize_option_label(marker.group(1)) if marker else ''
        marker_rest = marker.group(2).strip() if marker else ''
        marker_end = marker.end(1) + 1 if marker else 0
        is_standalone_marker = bool(marker and not marker_rest)
        is_top_option = bool(
            label and (
                is_standalone_marker
                or has_bold_after_marker(text, bold_ranges, marker_end)
                or len(INLINE_OPTION_RE.findall(text)) >= 3
            )
        )
        paragraphs.append({
            'text': text,
            'label': label,
            'is_top_option': is_top_option,
        })
    return paragraphs


def strip_option_marker(text):
    marker = OPTION_MARKER_RE.match(text)
    return marker.group(2).strip() if marker else text.strip()


def clean_question_lines(lines):
    cleaned = [
        line for line in lines
        if line.strip() and normalize_text(line) not in {'тест'}
    ]
    if not cleaned:
        return ''
    if len(cleaned) > 1:
        return cleaned[-1].strip()
    return cleaned[0].strip()


def split_inline_options(text):
    matches = list(INLINE_OPTION_RE.finditer(text))
    options = {}
    for index, match in enumerate(matches):
        label = normalize_option_label(match.group(1))
        if not label or label in options:
            continue
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        options[label] = text[start:end].strip()
    return options


def parse_docx_question_block(block, answer_line, question_number):
    joined_block_text = '\n'.join(item['text'] for item in block)
    joined_markers = list(INLINE_OPTION_RE.finditer(joined_block_text))
    option_indices = [
        index for index, item in enumerate(block)
        if item['is_top_option'] and item['label'] in OPTION_ORDER
    ]
    marker_indices = [
        index for index, item in enumerate(block)
        if item['label'] in OPTION_ORDER
    ]
    marker_labels = [block[index]['label'] for index in marker_indices]
    if (
        len(joined_markers) >= 3
        and not all(label in marker_labels for label in ['A', 'B', 'C'])
    ):
        question = clean_question_lines(joined_block_text[:joined_markers[0].start()].splitlines())
        options = split_inline_options(joined_block_text[joined_markers[0].start():])
        correct_answer = parse_correct_answer(answer_line)
        if correct_answer not in {'A', 'B', 'C', 'D'}:
            raise CommandError(f'Вопрос #{question_number}: некорректный правильный ответ "{answer_line}"')
        for label in ['A', 'B', 'C']:
            if not options.get(label):
                raise CommandError(f'Вопрос #{question_number}: не найден вариант {label}')
        return {
            'text': question,
            'option_a': options.get('A', ''),
            'option_b': options.get('B', ''),
            'option_c': options.get('C', ''),
            'option_d': options.get('D', ''),
            'correct_answer': correct_answer,
            'explanation': '',
        }

    if not option_indices:
        option_indices = marker_indices
    elif not all(label in [block[index]['label'] for index in option_indices] for label in ['A', 'B', 'C']):
        if all(marker_labels.count(label) == 1 for label in ['A', 'B', 'C']):
            option_indices = marker_indices
    if not option_indices:
        raise CommandError(f'Вопрос #{question_number}: не найдены варианты ответа')

    question = clean_question_lines([item['text'] for item in block[:option_indices[0]]])
    if not question:
        raise CommandError(f'Вопрос #{question_number}: пустой текст вопроса')

    options = {}
    option_text_lines = [item['text'] for item in block[option_indices[0]:]]
    if any(len(INLINE_OPTION_RE.findall(line)) >= 2 for line in option_text_lines):
        options = split_inline_options('\n'.join(option_text_lines))
    else:
        for position, start_index in enumerate(option_indices):
            label = block[start_index]['label']
            end_index = option_indices[position + 1] if position + 1 < len(option_indices) else len(block)
            lines = [strip_option_marker(block[start_index]['text'])]
            lines.extend(item['text'] for item in block[start_index + 1:end_index])
            options[label] = '\n'.join(line.strip() for line in lines if line.strip()).strip()

    correct_answer = parse_correct_answer(answer_line)
    if correct_answer not in {'A', 'B', 'C', 'D'}:
        raise CommandError(f'Вопрос #{question_number}: некорректный правильный ответ "{answer_line}"')

    for label in ['A', 'B', 'C']:
        if not options.get(label):
            raise CommandError(f'Вопрос #{question_number}: не найден вариант {label}')
    if correct_answer == 'D' and not options.get('D'):
        raise CommandError(f'Вопрос #{question_number}: правильный ответ D, но вариант D пустой')

    return {
        'text': question,
        'option_a': options.get('A', ''),
        'option_b': options.get('B', ''),
        'option_c': options.get('C', ''),
        'option_d': options.get('D', ''),
        'correct_answer': correct_answer,
        'explanation': '',
    }


def load_docx(path):
    paragraphs = read_docx_paragraphs(path)
    questions = []
    block = []
    for item in paragraphs:
        text = item['text']
        if is_correct_answer_line(text):
            if block:
                questions.append(parse_docx_question_block(block, text, len(questions) + 1))
                block = []
            continue
        block.append(item)

    if block and any(item['is_top_option'] for item in block):
        raise CommandError('В конце DOCX найден вопрос без строки "Туура жооп"')

    return questions


def load_fixture(path):
    if path.suffix.lower() == '.docx':
        return load_docx(path)

    with path.open('r', encoding='utf-8') as fixture:
        raw_items = json.load(fixture)

    questions = []
    for index, item in enumerate(raw_items, start=1):
        fields = item.get('fields', item)
        text_ky = clean_text(fields.get('text_ky') or fields.get('question_ky') or fields.get('question_kg'))
        text_ru = clean_text(fields.get('text_ru') or fields.get('question_ru'))
        text = clean_text(fields.get('text') or fields.get('question') or fields.get('question_kg') or text_ky or text_ru)
        options = {
            'A': clean_text(fields.get('option_a') or fields.get('A') or fields.get('option_a_ky') or fields.get('A_ky')),
            'B': clean_text(fields.get('option_b') or fields.get('B') or fields.get('option_b_ky') or fields.get('B_ky')),
            'C': clean_text(fields.get('option_c') or fields.get('C') or fields.get('option_c_ky') or fields.get('C_ky')),
            'D': clean_text(fields.get('option_d') or fields.get('D') or fields.get('option_d_ky') or fields.get('D_ky')),
        }
        option_ru = {
            'A': clean_text(fields.get('option_a_ru') or fields.get('A_ru')),
            'B': clean_text(fields.get('option_b_ru') or fields.get('B_ru')),
            'C': clean_text(fields.get('option_c_ru') or fields.get('C_ru')),
            'D': clean_text(fields.get('option_d_ru') or fields.get('D_ru')),
        }
        option_ky = {
            'A': clean_text(fields.get('option_a_ky') or fields.get('A_ky') or options['A']),
            'B': clean_text(fields.get('option_b_ky') or fields.get('B_ky') or options['B']),
            'C': clean_text(fields.get('option_c_ky') or fields.get('C_ky') or options['C']),
            'D': clean_text(fields.get('option_d_ky') or fields.get('D_ky') or options['D']),
        }
        correct_answer = str(fields.get('correct_answer') or fields.get('answer') or '').strip().upper()
        explanation = clean_text(fields.get('explanation') or fields.get('description'))

        if not text:
            raise CommandError(f'Вопрос #{index}: пустой текст вопроса')
        if correct_answer not in {'A', 'B', 'C', 'D'}:
            raise CommandError(f'Вопрос #{index}: некорректный правильный ответ "{correct_answer}"')
        if not options['A'] or not options['B'] or not options['C']:
            raise CommandError(f'Вопрос #{index}: должны быть заполнены варианты A, B и C')
        if correct_answer == 'D' and not options['D']:
            raise CommandError(f'Вопрос #{index}: правильный ответ D, но вариант D пустой')

        questions.append({
            'text': text,
            'text_ky': text_ky or text,
            'text_ru': text_ru,
            'option_a': options['A'],
            'option_a_ky': option_ky['A'],
            'option_a_ru': option_ru['A'],
            'option_b': options['B'],
            'option_b_ky': option_ky['B'],
            'option_b_ru': option_ru['B'],
            'option_c': options['C'],
            'option_c_ky': option_ky['C'],
            'option_c_ru': option_ru['C'],
            'option_d': options['D'],
            'option_d_ky': option_ky['D'],
            'option_d_ru': option_ru['D'],
            'correct_answer': correct_answer,
            'explanation': explanation,
        })

    return questions


class Command(BaseCommand):
    help = 'Imports officer knowledge-check questions into the officer testing category without duplicates.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--file',
            default=DEFAULT_FIXTURE,
            help='JSON fixture path relative to backend directory, or an absolute path.',
        )

    def handle(self, *args, **options):
        backend_dir = Path(__file__).resolve().parents[3]
        fixture_path = Path(options['file'])
        if not fixture_path.is_absolute():
            fixture_path = backend_dir / fixture_path
        if not fixture_path.exists():
            raise CommandError(f'Файл не найден: {fixture_path}')

        questions = load_fixture(fixture_path)
        seen_in_file = set()
        duplicates_in_file = 0
        deduplicated_questions = []
        for question in questions:
            normalized = normalize_text(question['text'])
            if normalized in seen_in_file:
                duplicates_in_file += 1
                continue
            seen_in_file.add(normalized)
            deduplicated_questions.append(question)

        User = get_user_model()
        teacher = (
            User.objects.filter(is_superuser=True).first()
            or User.objects.filter(is_staff=True).first()
            or User.objects.filter(role='teacher').first()
        )
        if not teacher:
            raise CommandError('Не найден пользователь для поля created_by')

        with transaction.atomic():
            trigger, _ = QuestionTrigger.objects.update_or_create(
                slug=OFFICER_SLUG,
                defaults={
                    'name': OFFICER_CATEGORY,
                    'description': '',
                    'is_active': True,
                },
            )

            existing_by_text = {}
            for question in Question.objects.all():
                for value in (question.text, question.text_ky, question.text_ru):
                    normalized = normalize_text(value)
                    if normalized:
                        existing_by_text.setdefault(normalized, question)

            created_questions = []
            skipped_existing = 0
            updated_existing = 0
            for question in deduplicated_questions:
                normalized = normalize_text(question['text'])
                existing_question = existing_by_text.get(normalized)
                if existing_question:
                    changed_fields = []
                    field_updates = {
                        'text': question['text'],
                        'text_ky': question.get('text_ky') or question['text'],
                        'text_ru': question.get('text_ru', ''),
                        'option_a': question['option_a'],
                        'option_a_ky': question.get('option_a_ky') or question['option_a'],
                        'option_a_ru': question.get('option_a_ru', ''),
                        'option_b': question['option_b'],
                        'option_b_ky': question.get('option_b_ky') or question['option_b'],
                        'option_b_ru': question.get('option_b_ru', ''),
                        'option_c': question['option_c'],
                        'option_c_ky': question.get('option_c_ky') or question['option_c'],
                        'option_c_ru': question.get('option_c_ru', ''),
                        'option_d': question['option_d'],
                        'option_d_ky': question.get('option_d_ky') or question['option_d'],
                        'option_d_ru': question.get('option_d_ru', ''),
                        'correct_answer': question['correct_answer'],
                        'explanation': question['explanation'],
                        'trigger': trigger,
                    }
                    for field, value in field_updates.items():
                        current_value = getattr(existing_question, field)
                        if current_value != value:
                            setattr(existing_question, field, value)
                            changed_fields.append('trigger_id' if field == 'trigger' else field)
                    if changed_fields:
                        existing_question.save(update_fields=sorted(set(changed_fields)))
                        updated_existing += 1
                    skipped_existing += 1
                    continue

                new_question = Question(
                    text=question['text'],
                    text_ky=question.get('text_ky') or question['text'],
                    text_ru=question.get('text_ru', ''),
                    option_a=question['option_a'],
                    option_a_ky=question.get('option_a_ky') or question['option_a'],
                    option_a_ru=question.get('option_a_ru', ''),
                    option_b=question['option_b'],
                    option_b_ky=question.get('option_b_ky') or question['option_b'],
                    option_b_ru=question.get('option_b_ru', ''),
                    option_c=question['option_c'],
                    option_c_ky=question.get('option_c_ky') or question['option_c'],
                    option_c_ru=question.get('option_c_ru', ''),
                    option_d=question['option_d'],
                    option_d_ky=question.get('option_d_ky') or question['option_d'],
                    option_d_ru=question.get('option_d_ru', ''),
                    correct_answer=question['correct_answer'],
                    explanation=question['explanation'],
                    trigger=trigger,
                    created_by=teacher,
                )
                created_questions.append(new_question)
                existing_by_text[normalized] = new_question

            if created_questions:
                Question.objects.bulk_create(created_questions)

            officer_questions = Question.objects.filter(trigger=trigger)
            active_test = Test.objects.filter(
                is_active=True,
                triggers=trigger,
            ).first()
            if not active_test:
                active_test = Test.objects.create(
                    title=OFFICER_CATEGORY,
                    teacher=teacher,
                    is_active=True,
                )
                active_test.triggers.set([trigger])
            elif active_test.teacher_id != teacher.id:
                teacher = active_test.teacher

            active_test.questions.set(officer_questions)

            missing_in_category_count = 0
            for question in deduplicated_questions:
                text = question['text']
                if not Question.objects.filter(text=text, trigger=trigger).exists():
                    missing_in_category_count += 1

        kyrgyz_sample = officer_questions.exclude(text_ky='').values_list('text_ky', flat=True).first() or ''
        kyrgyz_ok = any(char in kyrgyz_sample for char in 'ңөүҮӨҢ') or bool(kyrgyz_sample)

        self.stdout.write(self.style.SUCCESS(f'Успешно добавлено вопросов: {len(created_questions)}'))
        self.stdout.write(f'Записей в файле: {len(questions)}')
        self.stdout.write(f'Дубликатов внутри файла пропущено: {duplicates_in_file}')
        self.stdout.write(f'Уже существующих вопросов пропущено: {skipped_existing}')
        self.stdout.write(f'Существующих вопросов обновлено/привязано к категории: {updated_existing}')
        self.stdout.write(f'Всего вопросов в категории "{OFFICER_CATEGORY}": {officer_questions.count()}')
        self.stdout.write(f'Активный тест: #{active_test.id} "{active_test.title}", вопросов: {active_test.questions.count()}')
        self.stdout.write(f'Уникальных вопросов из файла без привязки к категории "{OFFICER_CATEGORY}": {missing_in_category_count}')
        self.stdout.write(f'Проверка кыргызской кодировки: {"OK" if kyrgyz_ok else "требует ручной проверки"}')
