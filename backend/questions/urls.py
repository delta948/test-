from django.urls import path

from .views import (
    QuestionDetailView,
    QuestionListCreateView,
    QuestionTranslateView,
    QuestionTriggerDetailView,
    QuestionTriggerListCreateView,
    QuestionTriggerQuestionDocxImportView,
    QuestionTriggerQuestionUploadView,
)

urlpatterns = [
    path('triggers/', QuestionTriggerListCreateView.as_view(), name='trigger-list'),
    path('triggers/<int:pk>/', QuestionTriggerDetailView.as_view(), name='trigger-detail'),
    path('triggers/<int:trigger_id>/questions/upload/', QuestionTriggerQuestionUploadView.as_view(), name='trigger-question-upload'),
    path('triggers/<int:trigger_id>/questions/import-docx/', QuestionTriggerQuestionDocxImportView.as_view(), name='trigger-question-import-docx'),
    path('questions/', QuestionListCreateView.as_view(), name='question-list'),
    path('questions/translate/', QuestionTranslateView.as_view(), name='question-translate'),
    path('questions/<int:pk>/', QuestionDetailView.as_view(), name='question-detail'),
]
