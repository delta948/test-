from django.urls import include, path
from django.http import JsonResponse

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
    path('', include('accounts.urls')),
    path('', include('questions.urls')),
    path('', include('testing.urls')),
    path('', include('reports.urls')),
]
