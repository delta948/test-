from django.contrib.auth.models import AbstractUser
from django.db import models
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


class Question(models.Model):
    text = models.TextField(verbose_name='Текст вопроса')
    option_a = models.CharField(max_length=255, verbose_name='Вариант A')
    option_b = models.CharField(max_length=255, verbose_name='Вариант B')
    option_c = models.CharField(max_length=255, verbose_name='Вариант C')
    
    CORRECT_CHOICES = [
        ('A', 'Вариант A'),
        ('B', 'Вариант B'),
        ('C', 'Вариант C'),
    ]
    correct_answer = models.CharField(max_length=1, choices=CORRECT_CHOICES, verbose_name='Правильный ответ')
    
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
    created_at = models.DateTimeField(auto_now_add=True)
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
    questions = models.ManyToManyField(Question, related_name='attempts', blank=True)
    question_order = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='in_progress')
    score = models.PositiveIntegerField(default=0, verbose_name='Результат')
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
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
