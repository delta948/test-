from django.db.models import Case, IntegerField, Q, When


SPECIAL_TRAINING_SLUG = 'special-training'
SPECIAL_TRAINING_SUBTRIGGER_SLUGS = (
    'communications-training',
    'engineering-training',
    'logistics-training',
    'armament-training',
    'air-defense-training',
)
PUBLIC_TRIGGER_SLUGS = (
    'applicant',
    'officer',
    'reserve_officer',
    SPECIAL_TRAINING_SLUG,
    *SPECIAL_TRAINING_SUBTRIGGER_SLUGS,
)
PUBLIC_TRIGGER_DEFAULTS = (
    ('applicant', 'Абитуриент'),
    ('officer', 'Контрольный срез знаний офицерского состава'),
    ('reserve_officer', 'Офицеры запаса'),
    (SPECIAL_TRAINING_SLUG, 'Специальная подготовка'),
    ('communications-training', 'Подготовка по связи', SPECIAL_TRAINING_SLUG),
    ('engineering-training', 'Инженерная подготовка', SPECIAL_TRAINING_SLUG),
    ('logistics-training', 'Подготовка по тыловому обеспечению', SPECIAL_TRAINING_SLUG),
    ('armament-training', 'Подготовка по вооружению', SPECIAL_TRAINING_SLUG),
    ('air-defense-training', 'Подготовка по противо-воздушной обороне', SPECIAL_TRAINING_SLUG),
)
OFFICER_SOURCE_TRIGGER_SLUGS = ('officer',)
HIDDEN_TRIGGER_SLUGS = ('sergeant_warrant', 'junior_officer', 'senior_officer')
NON_PUBLIC_TESTING_TRIGGER_SLUGS = ('sostav101', 'odim11')

PUBLIC_TRIGGER_NAMES = (
    'Абитуриент',
    'Контрольный срез знаний офицерского состава',
    'Офицеры запаса',
    'Специальная подготовка',
    'Подготовка по связи',
    'Инженерная подготовка',
    'Подготовка по тыловому обеспечению',
    'Подготовка по вооружению',
    'Подготовка по противо-воздушной обороне',
)
HIDDEN_TRIGGER_NAMES = (
    'Контрольный срез знаний младшего офицерского состава',
    'Контрольный срез знаний сержантов и прапорщиков',
    'Контрольный срез знаний старшего офицерского состава',
)
NON_PUBLIC_TESTING_TRIGGER_NAMES = ('состав', '1')


def public_trigger_ordering():
    return Case(
        When(slug='applicant', then=0),
        When(slug='officer', then=1),
        When(slug='reserve_officer', then=2),
        When(slug='special-training', then=3),
        When(slug='communications-training', then=4),
        When(slug='engineering-training', then=5),
        When(slug='logistics-training', then=6),
        When(slug='armament-training', then=7),
        When(slug='air-defense-training', then=8),
        default=99,
        output_field=IntegerField(),
    )


def ensure_public_triggers(model):
    for item in PUBLIC_TRIGGER_DEFAULTS:
        slug, name = item[:2]
        parent_slug = item[2] if len(item) > 2 else None
        trigger, _ = model.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'is_active': True,
            },
        )
        if parent_slug:
            parent = model.objects.filter(slug=parent_slug).first()
            if parent and trigger.parent_id != parent.id:
                trigger.parent = parent
                trigger.save(update_fields=['parent'])


def visible_triggers_queryset(model, active_only=True):
    queryset = model.objects.exclude(slug__in=HIDDEN_TRIGGER_SLUGS)
    if active_only:
        queryset = queryset.filter(is_active=True)
    return (
        queryset
        .annotate(public_order=public_trigger_ordering())
        .order_by('public_order', 'name')
    )


def public_triggers_queryset(model):
    return visible_triggers_queryset(model, active_only=True).exclude(
        Q(slug__in=NON_PUBLIC_TESTING_TRIGGER_SLUGS) |
        Q(name__in=NON_PUBLIC_TESTING_TRIGGER_NAMES) |
        Q(parent__is_active=False) |
        Q(parent__slug__in=NON_PUBLIC_TESTING_TRIGGER_SLUGS) |
        Q(parent__name__in=NON_PUBLIC_TESTING_TRIGGER_NAMES)
    )


def is_public_trigger(trigger):
    return bool(
        trigger
        and getattr(trigger, 'is_active', False)
        and trigger.slug not in HIDDEN_TRIGGER_SLUGS
        and trigger.slug not in NON_PUBLIC_TESTING_TRIGGER_SLUGS
        and trigger.name not in NON_PUBLIC_TESTING_TRIGGER_NAMES
        and not (
            getattr(trigger, 'parent_id', None) and (
                not getattr(trigger.parent, 'is_active', False) or
                trigger.parent.slug in NON_PUBLIC_TESTING_TRIGGER_SLUGS or
                trigger.parent.name in NON_PUBLIC_TESTING_TRIGGER_NAMES
            )
        )
    )


def get_officer_trigger(model):
    return model.objects.filter(
        slug='officer',
        is_active=True,
    ).first()


def get_public_trigger_for_source(trigger, model):
    if not trigger:
        return None
    if trigger.slug in ('junior_officer', 'senior_officer'):
        return get_officer_trigger(model)
    if is_public_trigger(trigger):
        return trigger
    return None


def get_question_filter_for_public_triggers(triggers):
    query = Q()
    for trigger in triggers:
        if not trigger:
            continue
        if trigger.slug == 'officer':
            query |= Q(trigger__slug__in=OFFICER_SOURCE_TRIGGER_SLUGS)
        elif trigger.slug == 'applicant':
            query |= Q(trigger__slug='applicant')
        elif trigger.slug == 'reserve_officer':
            query |= Q(trigger__slug='reserve_officer')
        elif trigger.slug == SPECIAL_TRAINING_SLUG:
            query |= Q(trigger__slug__in=(SPECIAL_TRAINING_SLUG, *SPECIAL_TRAINING_SUBTRIGGER_SLUGS))
        elif trigger.slug in SPECIAL_TRAINING_SUBTRIGGER_SLUGS:
            query |= Q(trigger__slug=trigger.slug)
        elif is_public_trigger(trigger):
            query |= Q(trigger__slug=trigger.slug)
    return query


def get_public_triggers_for_test(test, model):
    source_triggers = list(test.triggers.all())
    if not source_triggers:
        return list(public_triggers_queryset(model))

    source_slugs = {trigger.slug for trigger in source_triggers}
    public_slugs = {trigger.slug for trigger in source_triggers if is_public_trigger(trigger)}
    if source_slugs & {'junior_officer', 'senior_officer'}:
        public_slugs.add('officer')

    if not public_slugs:
        return []

    return list(
        model.objects.filter(is_active=True, slug__in=public_slugs)
        .exclude(slug__in=HIDDEN_TRIGGER_SLUGS)
        .annotate(public_order=public_trigger_ordering())
        .order_by('public_order', 'name')
    )


def test_allows_public_trigger(test, trigger):
    available_triggers = get_public_triggers_for_test(test, type(trigger))
    available_slugs = {available.slug for available in available_triggers}
    available_ids = {available.id for available in available_triggers}
    trigger_slug = getattr(trigger, 'slug', '')
    if trigger_slug in available_slugs:
        return True
    parent_id = getattr(trigger, 'parent_id', None)
    if parent_id and parent_id in available_ids:
        return True
    return (
        SPECIAL_TRAINING_SLUG in available_slugs and
        trigger_slug in SPECIAL_TRAINING_SUBTRIGGER_SLUGS
    )
