from django.urls import path
from django.http import JsonResponse
from .views import (
    RegisterView, UserProfileView,
    QuestionTriggerListCreateView, QuestionTriggerDetailView, QuestionTriggerQuestionUploadView,
    QuestionListCreateView, QuestionDetailView, QuestionTranslateView,
    TestListCreateView, TestDetailView, TestQuestionsView,
    AvailableTestsView, StartAttemptView, GetTestQuestionsView,
    SubmitAnswerView, CompleteTestView, GetTestResultView,
    StudentAttemptsView, TeacherResultsView, TeacherTestResultsView,
    TeacherAttemptResultView, StudentCountView, CreateTeacherView, TeacherListView,
    TeacherDetailView, StudentProfileUpdateView, TeacherStudentListCreateView,
    TeacherStudentDetailView, TeacherSummaryPdfView, TeacherSummaryReportListView
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
            '/api/triggers/',
            '/api/tests/',
            '/api/student/tests/',
            '/api/student/attempts/',
            '/api/teacher/results/',
            '/api/teacher/students/',
            '/api/teacher/students/<id>/',
            '/api/teacher/summary/pdf/',
            '/api/teacher/summary/reports/',
            '/api/student-count/',
        ]
    })

urlpatterns = [
    path('', api_root),
    path('register/', RegisterView.as_view(), name='register'),
    path('profile/', UserProfileView.as_view(), name='profile'),
    path('student/profile/', StudentProfileUpdateView.as_view(), name='student-profile-update'),

    path('triggers/', QuestionTriggerListCreateView.as_view(), name='trigger-list'),
    path('triggers/<int:pk>/', QuestionTriggerDetailView.as_view(), name='trigger-detail'),
    path('triggers/<int:trigger_id>/questions/upload/', QuestionTriggerQuestionUploadView.as_view(), name='trigger-question-upload'),
    
    path('questions/', QuestionListCreateView.as_view(), name='question-list'),
    path('questions/translate/', QuestionTranslateView.as_view(), name='question-translate'),
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
    path('teacher/students/', TeacherStudentListCreateView.as_view(), name='teacher-students'),
    path('teacher/students/<int:pk>/', TeacherStudentDetailView.as_view(), name='teacher-student-detail'),
    path('teacher/summary/pdf/', TeacherSummaryPdfView.as_view(), name='teacher-summary-pdf'),
    path('teacher/summary/reports/', TeacherSummaryReportListView.as_view(), name='teacher-summary-reports'),
    path('teacher/tests/<int:test_id>/results/', TeacherTestResultsView.as_view(), name='test-results'),
    path('teacher/attempts/<int:attempt_id>/result/', TeacherAttemptResultView.as_view(), name='teacher-attempt-result'),
    path('teacher/create-teacher/', CreateTeacherView.as_view(), name='create-teacher'),
    path('teacher/list/', TeacherListView.as_view(), name='teacher-list'),
    path('teacher/<int:pk>/', TeacherDetailView.as_view(), name='teacher-detail'),
    
    path('student-count/', StudentCountView.as_view(), name='student-count'),
]
