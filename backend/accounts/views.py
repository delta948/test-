from core.view_utils import *

class TeacherListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not can_manage_teachers(request.user):
            return Response(
                {'error': 'Нет доступа к списку экзаменаторов'},
                status=status.HTTP_403_FORBIDDEN
            )

        teachers = User.objects.filter(role='teacher').order_by('last_name', 'first_name', 'username')
        return Response({'teachers': UserSerializer(teachers, many=True).data})


class TeacherDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return User.objects.filter(role='teacher')

    def check_manage_permission(self):
        if not can_manage_teachers(self.request.user):
            raise PermissionDenied('Нет доступа к управлению экзаменаторами')

    def get_object(self):
        self.check_manage_permission()
        return super().get_object()

    def destroy(self, request, *args, **kwargs):
        teacher = self.get_object()
        if teacher.id == request.user.id:
            return Response(
                {'error': 'Нельзя удалить собственную учетную запись через этот API'},
                status=status.HTTP_400_BAD_REQUEST
            )

        student_action = request.data.get('student_action') or request.query_params.get('student_action') or 'deactivate'
        students = User.objects.filter(role='student', created_by_teacher=teacher)

        with transaction.atomic():
            if student_action == 'delete':
                affected_students = students.count()
                students.delete()
            elif student_action == 'transfer':
                target_teacher_id = request.data.get('target_teacher_id') or request.query_params.get('target_teacher_id')
                target_teacher = User.objects.filter(id=target_teacher_id, role='teacher').exclude(id=teacher.id).first()
                if not target_teacher:
                    return Response(
                        {'error': 'Для переноса укажите существующего другого экзаменатора'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                affected_students = students.update(created_by_teacher=target_teacher, is_active=True)
            elif student_action == 'deactivate':
                affected_students = students.update(created_by_teacher=None, is_active=False)
            else:
                return Response(
                    {'error': 'student_action должен быть deactivate, delete или transfer'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            teacher.delete()

        return Response({
            'message': 'Экзаменатор удален',
            'student_action': student_action,
            'affected_students': affected_students,
        }, status=status.HTTP_200_OK)


class TeacherStudentListCreateView(APIView):
    permission_classes = [IsTeacher]

    def get(self, request):
        if request.user.is_staff or request.user.is_superuser or getattr(request.user, 'role', None) == 'admin':
            students = User.objects.filter(role='student')
        else:
            students = User.objects.filter(role='student', created_by_teacher=request.user)

        students = students.order_by('last_name', 'first_name', 'username')
        return Response({'students': UserSerializer(students, many=True).data})

    def post(self, request):
        student_count = User.objects.filter(role='student').count()
        if student_count >= settings.MAX_STUDENTS:
            return Response(
                {'error': f'Достигнут лимит в {settings.MAX_STUDENTS} учеников. Создание невозможно.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = CreateStudentSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        student = serializer.save()
        return Response({
            'message': 'Ученик успешно создан',
            'user': UserSerializer(student).data
        }, status=status.HTTP_201_CREATED)


class TeacherStudentDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsTeacher]

    def get_serializer_class(self):
        if self.request.method in ['PUT', 'PATCH']:
            return UpdateStudentSerializer
        return UserSerializer

    def get_queryset(self):
        queryset = User.objects.filter(role='student').select_related(
            'created_by_teacher',
            'student_profile',
        )
        user = self.request.user
        if user.is_staff or user.is_superuser or getattr(user, 'role', None) == 'admin':
            return queryset
        return queryset.filter(created_by_teacher=user)

    def perform_destroy(self, instance):
        instance.delete()


class IsStudent(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_student()


def can_manage_teachers(user):
    return (
        user.is_authenticated and (
            user.is_staff or
            user.is_superuser or
            getattr(user, 'role', None) == 'admin' or
            (getattr(user, 'role', None) == 'teacher' and getattr(user, 'is_main_teacher', False))
        )
    )


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    
    def create(self, request, *args, **kwargs):
        role = request.data.get('role')
        
        if role == 'student':
            student_count = User.objects.filter(role='student').count()
            if student_count >= settings.MAX_STUDENTS:
                return Response(
                    {'error': f'Достигнут лимит в {settings.MAX_STUDENTS} учеников. Регистрация невозможна.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        
        return Response({
            'user': UserSerializer(user).data,
            'message': 'Регистрация успешна'
        }, status=status.HTTP_201_CREATED)


class UserProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class StudentProfileUpdateView(APIView):
    permission_classes = [IsStudent]

    def post(self, request):
        serializer = StudentProfileUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        profile, _ = StudentProfile.objects.get_or_create(user=user)
        user.last_name = serializer.validated_data['last_name']
        user.first_name = serializer.validated_data['first_name']
        profile.military_rank = serializer.validated_data['military_rank']
        profile.management_body = serializer.validated_data['management_body']
        profile.middle_name = serializer.validated_data['middle_name']

        with transaction.atomic():
            user.save(update_fields=['last_name', 'first_name'])
            profile.save(update_fields=['military_rank', 'management_body', 'middle_name'])

        return Response(UserSerializer(user).data)



class StudentCountView(APIView):
    permission_classes = [permissions.AllowAny]
    
    def get(self, request):
        count = User.objects.filter(role='student').count()
        return Response({
            'student_count': count,
            'max_students': settings.MAX_STUDENTS,
            'available_slots': max(0, settings.MAX_STUDENTS - count)
        })


class CreateTeacherView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        # Проверка: только главный экзаменатор может создавать экзаменаторов
        if not can_manage_teachers(request.user):
            return Response(
                {'error': 'Только администратор или главный экзаменатор может создавать аккаунты экзаменаторов'}, 
                status=status.HTTP_403_FORBIDDEN
            )
        
        serializer = CreateTeacherSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            serializer.save()
            return Response({
                'message': 'Экзаменатор успешно создан',
                'user': UserSerializer(serializer.instance).data
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {'error': f'Ошибка создания экзаменатора: {str(e)}'}, 
                status=status.HTTP_400_BAD_REQUEST
            )

