import random


OFFICER_QUESTION_BUCKETS = (
    (507, 581, 5),
    (632, 691, 32),
    (712, 761, 10),
    (892, 940, 10),
    (941, 1013, 43),
)


def is_officer_only_selection(triggers):
    slugs = {getattr(trigger, 'slug', '') for trigger in triggers}
    return slugs == {'officer'}


def build_officer_question_ids(question_ids):
    source_ids = sorted({int(question_id) for question_id in question_ids})
    selected_ids = []

    for start_id, end_id, quota in OFFICER_QUESTION_BUCKETS:
        bucket_ids = [question_id for question_id in source_ids if start_id <= question_id <= end_id]
        if len(bucket_ids) < quota:
            return [], (
                f'Недостаточно вопросов в диапазоне {start_id}-{end_id}: '
                f'нужно {quota}, найдено {len(bucket_ids)}'
            )
        selected_ids.extend(random.sample(bucket_ids, quota))

    return selected_ids, None
