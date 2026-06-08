from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, StudentProfile, QuestionTrigger, Question, Test, Attempt, Answer, SummaryReport, TestingPeriod


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = [
        'username', 'email', 'role', 'is_main_teacher', 'created_by_teacher',
        'first_name', 'last_name', 'is_active', 'is_staff'
    ]
    list_filter = ['role', 'is_main_teacher', 'created_by_teacher', 'is_active', 'is_staff']
    fieldsets = UserAdmin.fieldsets + (
        ('Role', {'fields': ('role', 'is_main_teacher', 'created_by_teacher')}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Role', {'fields': ('role', 'is_main_teacher', 'created_by_teacher')}),
    )


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'teacher', 'created_at']
    search_fields = ['user__username', 'user__email', 'user__created_by_teacher__username']

    def teacher(self, obj):
        return obj.user.created_by_teacher


@admin.register(QuestionTrigger)
class QuestionTriggerAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_active', 'question_count', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name', 'slug', 'description']
    prepopulated_fields = {'slug': ('name',)}

    def question_count(self, obj):
        return obj.questions.count()


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ['id', 'text_preview', 'trigger', 'correct_answer', 'created_by', 'created_at']
    list_filter = ['trigger', 'correct_answer', 'created_by']
    search_fields = ['text', 'option_a', 'option_b', 'option_c']

    def text_preview(self, obj):
        return obj.text[:50] + '...' if len(obj.text) > 50 else obj.text


@admin.register(Test)
class TestAdmin(admin.ModelAdmin):
    list_display = ['title', 'teacher', 'question_count', 'is_active', 'created_at']
    list_filter = ['is_active', 'teacher']
    search_fields = ['title']
    filter_horizontal = ['questions', 'triggers']

    def question_count(self, obj):
        return obj.questions.count()


@admin.register(Attempt)
class AttemptAdmin(admin.ModelAdmin):
    list_display = ['student', 'test', 'status', 'score', 'started_at', 'completed_at', 'archived_at']
    list_filter = ['status', 'test', 'started_at', 'archived_at']
    search_fields = ['student__username', 'test__title']


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ['attempt', 'question', 'selected_option', 'is_correct', 'answered_at']
    list_filter = ['is_correct', 'selected_option']


@admin.register(SummaryReport)
class SummaryReportAdmin(admin.ModelAdmin):
    list_display = ['title', 'teacher', 'testing_period', 'student_count', 'generated_at', 'expires_at']
    list_filter = ['teacher', 'generated_at', 'expires_at']
    search_fields = ['title', 'teacher__username', 'teacher__first_name', 'teacher__last_name']
    readonly_fields = ['generated_at']


@admin.register(TestingPeriod)
class TestingPeriodAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'teacher', 'started_at', 'ends_at', 'summary_delete_at',
        'processed_at', 'summary_created_at'
    ]
    list_filter = ['teacher', 'processed_at']
    search_fields = ['teacher__username', 'teacher__first_name', 'teacher__last_name']
    readonly_fields = ['created_at', 'processed_at', 'summary_created_at']
