from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, StudentProfile, Question, Test, Attempt, Answer


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ['username', 'email', 'role', 'is_main_teacher', 'first_name', 'last_name', 'is_staff']
    list_filter = ['role', 'is_main_teacher', 'is_staff', 'is_active']
    fieldsets = UserAdmin.fieldsets + (
        ('Роль', {'fields': ('role', 'is_main_teacher')}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Роль', {'fields': ('role', 'is_main_teacher')}),
    )


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at']
    search_fields = ['user__username', 'user__email']


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ['id', 'text_preview', 'correct_answer', 'created_by', 'created_at']
    list_filter = ['correct_answer', 'created_by']
    search_fields = ['text', 'option_a', 'option_b', 'option_c']
    
    def text_preview(self, obj):
        return obj.text[:50] + '...' if len(obj.text) > 50 else obj.text
    text_preview.short_description = 'Текст вопроса'


@admin.register(Test)
class TestAdmin(admin.ModelAdmin):
    list_display = ['title', 'teacher', 'question_count', 'is_active', 'created_at']
    list_filter = ['is_active', 'teacher']
    search_fields = ['title']
    filter_horizontal = ['questions']
    
    def question_count(self, obj):
        return obj.questions.count()
    question_count.short_description = 'Количество вопросов'


@admin.register(Attempt)
class AttemptAdmin(admin.ModelAdmin):
    list_display = ['student', 'test', 'status', 'score', 'started_at', 'completed_at']
    list_filter = ['status', 'test', 'started_at']
    search_fields = ['student__username', 'test__title']


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ['attempt', 'question', 'selected_option', 'is_correct', 'answered_at']
    list_filter = ['is_correct', 'selected_option']
