from django.urls import path

from .views import (
    CreateTeacherView,
    RegisterView,
    StudentCountView,
    StudentProfileUpdateView,
    TeacherDetailView,
    TeacherListView,
    TeacherStudentDetailView,
    TeacherStudentListCreateView,
    UserProfileView,
)

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('profile/', UserProfileView.as_view(), name='profile'),
    path('student/profile/', StudentProfileUpdateView.as_view(), name='student-profile-update'),
    path('teacher/students/', TeacherStudentListCreateView.as_view(), name='teacher-students'),
    path('teacher/students/<int:pk>/', TeacherStudentDetailView.as_view(), name='teacher-student-detail'),
    path('teacher/create-teacher/', CreateTeacherView.as_view(), name='create-teacher'),
    path('teacher/list/', TeacherListView.as_view(), name='teacher-list'),
    path('teacher/<int:pk>/', TeacherDetailView.as_view(), name='teacher-detail'),
    path('student-count/', StudentCountView.as_view(), name='student-count'),
]

