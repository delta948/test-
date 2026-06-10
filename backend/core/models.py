from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.conf import settings
from django.utils import timezone
from datetime import timedelta


class User(AbstractUser):
    ROLE_CHOICES = [
        ('teacher', 'Учитель'),
        ('student', 'Ученик'),
    ]
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='student')
    is_main_teacher = models.BooleanField(default=False, verbose_name='Главный учитель')
    created_by_teacher = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_students',
        limit_choices_to={'role': 'teacher'},
        verbose_name='Создавший учитель',
    )
    
    groups = models.ManyToManyField(
        'auth.Group',
        related_name='core_user_set',
        blank=True,
        help_text='The groups this user belongs to.',
        verbose_name='groups',
    )
    user_permissions = models.ManyToManyField(
        'auth.Permission',
        related_name='core_user_set',
        blank=True,
        help_text='Specific permissions for this user.',
        verbose_name='user permissions',
    )
    
    def is_teacher(self):
        return self.role == 'teacher'
    
    def is_student(self):
        return self.role == 'student'


@receiver(pre_delete, sender=User)
def deactivate_students_before_teacher_delete(sender, instance, **kwargs):
    if instance.role != 'teacher':
        return

    User.objects.filter(role='student', created_by_teacher=instance).update(
        created_by_teacher=None,
        is_active=False,
    )


class StudentProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='student_profile')
    military_rank = models.CharField(max_length=100, blank=True, verbose_name='Воинское звание')
    patronymic = models.CharField(max_length=150, blank=True, verbose_name='Отчество')
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_complete(self):
        return all([
            self.military_rank.strip(),
            self.user.last_name.strip(),
            self.user.first_name.strip(),
            self.patronymic.strip(),
        ])
    
    def __str__(self):
        return f"Профиль ученика: {self.user.username}"


class QuestionTrigger(models.Model):
    DEFAULT_TRIGGERS = [
        ('applicant', 'Абитуриент'),
        ('sergeant_warrant', 'Контрольный срез знаний сержантов и прапорщиков'),
        ('junior_officer', 'Контрольный срез знаний младшего офицерского состава'),
        ('senior_officer', 'Контрольный срез знаний старшего офицерского состава'),
    ]

    name = models.CharField(max_length=255, unique=True, verbose_name='Триггер')
    slug = models.SlugField(max_length=64, unique=True, verbose_name='Код')
    description = models.TextField(blank=True, verbose_name='Описание')
    is_active = models.BooleanField(default=True, db_index=True, verbose_name='Активен')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Question(models.Model):
    TRIGGER_APPLICANT = 'applicant'
    TRIGGER_SERGEANT = 'sergeant_warrant'
    TRIGGER_JUNIOR_OFFICER = 'junior_officer'
    TRIGGER_SENIOR_OFFICER = 'senior_officer'
    TRIGGER_CHOICES = [
        (TRIGGER_APPLICANT, 'Абитуриент'),
        (TRIGGER_SERGEANT, 'Контрольный срез знаний сержантов и прапорщиков'),
        (TRIGGER_JUNIOR_OFFICER, 'Контрольный срез знаний младшего офицерского состава'),
        (TRIGGER_SENIOR_OFFICER, 'Контрольный срез знаний старшего офицерского состава'),
    ]
    text = models.TextField(verbose_name='Текст вопроса')
    text_ru = models.TextField(blank=True, default='', verbose_name='Текст вопроса на русском')
    text_ky = models.TextField(blank=True, default='', verbose_name='Текст вопроса на кыргызском')
    option_a = models.CharField(max_length=255, verbose_name='Вариант A')
    option_a_ru = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант A на русском')
    option_a_ky = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант A на кыргызском')
    option_b = models.CharField(max_length=255, verbose_name='Вариант B')
    option_b_ru = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант B на русском')
    option_b_ky = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант B на кыргызском')
    option_c = models.CharField(max_length=255, verbose_name='Вариант C')
    option_c_ru = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант C на русском')
    option_c_ky = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант C на кыргызском')
    option_d = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант D')
    option_d_ru = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант D на русском')
    option_d_ky = models.CharField(max_length=255, blank=True, default='', verbose_name='Вариант D на кыргызском')
    
    CORRECT_CHOICES = [
        ('A', 'Вариант A'),
        ('B', 'Вариант B'),
        ('C', 'Вариант C'),
        ('D', 'Вариант D'),
    ]
    correct_answer = models.CharField(max_length=1, choices=CORRECT_CHOICES, verbose_name='Правильный ответ')
    trigger = models.ForeignKey(
        QuestionTrigger,
        on_delete=models.PROTECT,
        related_name='questions',
        db_index=True,
        verbose_name='Триггер',
    )
    
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_questions')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['id']
    
    def __str__(self):
        return f"Вопрос #{self.id}: {self.text[:50]}..."


class Test(models.Model):
    title = models.CharField(max_length=255, verbose_name='Название теста')
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_tests')
    questions = models.ManyToManyField(Question, related_name='tests', limit_choices_to={'created_by': models.F('teacher')})
    triggers = models.ManyToManyField(QuestionTrigger, related_name='tests', blank=True, verbose_name='Триггеры')
    created_at = models.DateTimeField(auto_now_add=True)
    testing_period = models.ForeignKey(
        'TestingPeriod',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tests',
    )
    is_active = models.BooleanField(default=True, verbose_name='Активен')
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return self.title
    
    def question_count(self):
        return self.questions.count()


class Attempt(models.Model):
    STATUS_CHOICES = [
        ('in_progress', 'В процессе'),
        ('completed', 'Завершен'),
    ]
    
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='attempts')
    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name='attempts')
    selected_trigger = models.ForeignKey(
        QuestionTrigger,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='attempts',
    )
    testing_period = models.ForeignKey(
        'TestingPeriod',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attempts',
    )
    questions = models.ManyToManyField(Question, related_name='attempts', blank=True)
    question_order = models.JSONField(default=list, blank=True)
    triggers_snapshot = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='in_progress')
    score = models.PositiveIntegerField(default=0, verbose_name='Результат')
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    current_question_index = models.PositiveIntegerField(default=0, verbose_name='Текущий вопрос')
    
    class Meta:
        ordering = ['-started_at']
    
    def __str__(self):
        return f"Попытка {self.student.username} - {self.test.title}"
    
    def total_questions(self):
        if self.questions.exists():
            return self.questions.count()
        return self.test.questions.count()
    
    def answered_count(self):
        return self.answers.count()
    
    @staticmethod
    def get_attempt_count(student, test):
        """Количество завершенных попыток за последние 10 минут"""
        ten_minutes_ago = timezone.now() - timedelta(minutes=10)
        return Attempt.objects.filter(
            student=student,
            test=test,
            status='completed',
            completed_at__gte=ten_minutes_ago
        ).count()
    
    @staticmethod
    def can_start_attempt(student, test):
        """Проверка, может ли ученик начать новую попытку"""
        completed_count = Attempt.get_attempt_count(student, test)
        return completed_count < 1


class Answer(models.Model):
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name='answers')
    question = models.ForeignKey(Question, on_delete=models.CASCADE)
    selected_option = models.CharField(max_length=1, choices=Question.CORRECT_CHOICES)
    is_correct = models.BooleanField(default=False)
    answered_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['attempt', 'question']
        ordering = ['answered_at']
    
    def __str__(self):
        return f"Ответ на вопрос {self.question.id} - {self.selected_option}"
    
    def save(self, *args, **kwargs):
        self.is_correct = (self.selected_option == self.question.correct_answer)
        super().save(*args, **kwargs)


class SummaryReport(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='summary_reports')
    testing_period = models.OneToOneField(
        'TestingPeriod',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='summary_report',
    )
    title = models.CharField(max_length=255, verbose_name='Название')
    file = models.FileField(upload_to='summary_reports/', verbose_name='PDF')
    rows = models.JSONField(default=list, blank=True)
    student_count = models.PositiveIntegerField(default=0)
    period_started_at = models.DateTimeField(null=True, blank=True, db_index=True)
    period_finished_at = models.DateTimeField(null=True, blank=True, db_index=True)
    generated_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ['-generated_at']

    def __str__(self):
        return self.title


class TestingPeriod(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='testing_periods')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    ends_at = models.DateTimeField(db_index=True)
    summary_delete_at = models.DateTimeField(db_index=True)
    processed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    summary_created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    @property
    def is_processed(self):
        return self.processed_at is not None

    def __str__(self):
        return f"Testing period #{self.id} for {self.teacher}"
