import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "video_test.settings")
django.setup()

from django.db import transaction
from django.db.models import Count

from core.models import Question


OPTION_FIELDS = {
    "A": "option_a",
    "B": "option_b",
    "C": "option_c",
}
TARGET_SEQUENCE = ("A", "B", "C")


def get_distribution():
    return list(
        Question.objects.values("correct_answer")
        .annotate(count=Count("id"))
        .order_by("correct_answer")
    )


def main():
    questions = list(Question.objects.all().order_by("id"))
    before = get_distribution()
    changed = 0

    with transaction.atomic():
        for index, question in enumerate(questions):
            target_answer = TARGET_SEQUENCE[index % len(TARGET_SEQUENCE)]
            current_answer = question.correct_answer

            if current_answer == target_answer:
                continue

            current_field = OPTION_FIELDS[current_answer]
            target_field = OPTION_FIELDS[target_answer]

            current_text = getattr(question, current_field)
            target_text = getattr(question, target_field)

            setattr(question, target_field, current_text)
            setattr(question, current_field, target_text)
            question.correct_answer = target_answer
            question.save(
                update_fields=["option_a", "option_b", "option_c", "correct_answer"]
            )
            changed += 1

    after = get_distribution()
    print(f"Total questions: {len(questions)}")
    print(f"Changed questions: {changed}")
    print(f"Before: {before}")
    print(f"After: {after}")


if __name__ == "__main__":
    main()
