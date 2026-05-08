from rest_framework import permissions


class IsMainTeacher(permissions.BasePermission):
    """Разрешает доступ только главному учителю"""
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and 
            request.user.role == 'teacher' and 
            request.user.is_main_teacher
        )
