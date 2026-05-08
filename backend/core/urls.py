from django.urls import path
from django.http import JsonResponse
from .views import (
    RegisterView, UserProfileView,
    QuestionListCreateView, QuestionDetailView,
    TestListCreateView, TestDetailView, TestQuestionsView,
    AvailableTestsView, StartAttemptView, GetTestQuestionsView,
    SubmitAnswerView, CompleteTestView, GetTestResultView,
    StudentAttemptsView, TeacherResultsView, TeacherTestResultsView,
    StudentCountView, CreateTeacherView
)

def api_root(request):
    return JsonResponse({
        'message': 'Video Test API',
        'version': '1.0',
        'endpoints': [
            '/api/token/',
            '/api/token/refresh/',
            '/api/register/',
            '/api/profile/',
            '/api/questions/',
            '/api/tests/',
            '/api/student/tests/',
            '/api/student/attempts/',
            '/api/teacher/results/',
            '/api/student-count/',
        ]
    })

urlpatterns = [
    path('', api_root),
    path('register/', RegisterView.as_view(), name='register'),
    path('profile/', UserProfileView.as_view(), name='profile'),
    
    path('questions/', QuestionListCreateView.as_view(), name='question-list'),
    path('questions/<int:pk>/', QuestionDetailView.as_view(), name='question-detail'),
    
    path('tests/', TestListCreateView.as_view(), name='test-list'),
    path('tests/<int:pk>/', TestDetailView.as_view(), name='test-detail'),
    path('tests/<int:test_id>/questions/', TestQuestionsView.as_view(), name='test-questions'),
    
    path('student/tests/', AvailableTestsView.as_view(), name='available-tests'),
    path('student/attempts/', StudentAttemptsView.as_view(), name='student-attempts'),
    path('student/tests/<int:test_id>/start/', StartAttemptView.as_view(), name='start-attempt'),
    path('student/attempts/<int:attempt_id>/questions/', GetTestQuestionsView.as_view(), name='test-questions'),
    path('student/attempts/<int:attempt_id>/answer/', SubmitAnswerView.as_view(), name='submit-answer'),
    path('student/attempts/<int:attempt_id>/complete/', CompleteTestView.as_view(), name='complete-test'),
    path('student/attempts/<int:attempt_id>/result/', GetTestResultView.as_view(), name='test-result'),
    
    path('teacher/results/', TeacherResultsView.as_view(), name='teacher-results'),
    path('teacher/tests/<int:test_id>/results/', TeacherTestResultsView.as_view(), name='test-results'),
    path('teacher/create-teacher/', CreateTeacherView.as_view(), name='create-teacher'),
    
    path('student-count/', StudentCountView.as_view(), name='student-count'),
]
