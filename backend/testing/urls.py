from django.urls import path

from .views import (
    AvailableTestsView,
    CompleteTestView,
    GetTestQuestionsView,
    GetTestResultView,
    StartAttemptView,
    StudentAttemptsView,
    SubmitAnswerView,
    TestDetailView,
    TestListCreateView,
    TestQuestionsView,
)

urlpatterns = [
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
]

