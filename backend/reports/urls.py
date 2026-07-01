from django.urls import path

from .views import (
    TeacherAttemptResultView,
    TeacherResultsView,
    TeacherSummaryPdfView,
    TeacherSummaryReportListView,
    TeacherTestResultsView,
)

urlpatterns = [
    path('teacher/results/', TeacherResultsView.as_view(), name='teacher-results'),
    path('teacher/summary/pdf/', TeacherSummaryPdfView.as_view(), name='teacher-summary-pdf'),
    path('teacher/summary/reports/', TeacherSummaryReportListView.as_view(), name='teacher-summary-reports'),
    path('teacher/tests/<int:test_id>/results/', TeacherTestResultsView.as_view(), name='test-results'),
    path('teacher/attempts/<int:attempt_id>/result/', TeacherAttemptResultView.as_view(), name='teacher-attempt-result'),
]
