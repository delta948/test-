from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

def api_root(request):
    return JsonResponse({
        'message': 'Video Test API',
        'version': '1.0',
        'endpoints': {
            'token': '/api/token/',
            'token_refresh': '/api/token/refresh/',
            'register': '/api/register/',
            'profile': '/api/profile/',
            'questions': '/api/questions/',
            'tests': '/api/tests/',
            'student_tests': '/api/student/tests/',
            'student_attempts': '/api/student/attempts/',
            'teacher_results': '/api/teacher/results/',
        },
        'docs': 'Use /api/<endpoint>/'
    })

def home(request):
    return JsonResponse({
        'message': 'Video Test Backend',
        'frontend': 'http://localhost:3000',
        'admin': 'http://localhost:8000/admin/',
        'api': 'http://localhost:8000/api/'
    })

urlpatterns = [
    path('', home),
    path('admin/', admin.site.urls),
    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/', include('core.urls')),
]
