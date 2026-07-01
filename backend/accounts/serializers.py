from core.serializer_utils import *

class UserSerializer(serializers.ModelSerializer):
    military_rank = serializers.SerializerMethodField()
    management_body = serializers.SerializerMethodField()
    middle_name = serializers.SerializerMethodField()
    student_profile_completed = serializers.SerializerMethodField()
    teacher_id = serializers.IntegerField(source='created_by_teacher_id', read_only=True)
    teacher_name = serializers.SerializerMethodField()
    teacher_username = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role',
            'is_main_teacher', 'training_mode', 'is_staff', 'is_superuser', 'military_rank',
            'management_body', 'middle_name', 'student_profile_completed',
            'teacher_id', 'teacher_name', 'teacher_username', 'is_active'
        ]
        read_only_fields = ['is_staff', 'is_superuser']

    def get_military_rank(self, obj):
        return getattr(getattr(obj, 'student_profile', None), 'military_rank', '')

    def get_management_body(self, obj):
        return getattr(getattr(obj, 'student_profile', None), 'management_body', '')

    def get_middle_name(self, obj):
        return getattr(getattr(obj, 'student_profile', None), 'middle_name', '')

    def get_student_profile_completed(self, obj):
        if obj.role != 'student':
            return True
        profile = getattr(obj, 'student_profile', None)
        return bool(profile and profile.is_complete)

    def get_teacher_name(self, obj):
        teacher = getattr(obj, 'created_by_teacher', None)
        if not teacher:
            return ''
        return teacher.get_full_name().strip() or teacher.username

    def get_teacher_username(self, obj):
        teacher = getattr(obj, 'created_by_teacher', None)
        return teacher.username if teacher else ''


class StudentProfileUpdateSerializer(serializers.Serializer):
    military_rank = serializers.CharField(max_length=100, trim_whitespace=True)
    management_body = serializers.CharField(max_length=255, trim_whitespace=True)
    last_name = serializers.CharField(max_length=150, trim_whitespace=True)
    first_name = serializers.CharField(max_length=150, trim_whitespace=True)
    middle_name = serializers.CharField(max_length=150, trim_whitespace=True)

    def validate(self, attrs):
        for field, value in attrs.items():
            if not value.strip():
                raise serializers.ValidationError({field: 'Это поле обязательно.'})
        return attrs


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    role = serializers.ChoiceField(choices=[('teacher', 'Экзаменатор'), ('student', 'Ученик')])
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'role', 'first_name', 'last_name']
    
    def validate_role(self, value):
        if value not in ['teacher', 'student']:
            raise serializers.ValidationError("Роль должна быть 'teacher' или 'student'")
        return value
    
    def create(self, validated_data):
        with transaction.atomic():
            user = User.objects.create_user(
                username=validated_data['username'],
                email=validated_data.get('email', ''),
                password=validated_data['password'],
                role=validated_data['role'],
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', '')
            )
            
            if user.role == 'student':
                StudentProfile.objects.create(user=user)
            
            return user


class CreateTeacherSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name']
    
    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data['password'],
            role='teacher',
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        return user


class CreateStudentSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    military_rank = serializers.CharField(max_length=100, required=False, allow_blank=True)
    management_body = serializers.CharField(max_length=255, required=False, allow_blank=True)
    middle_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    teacher_id = serializers.IntegerField(required=False, write_only=True)

    class Meta:
        model = User
        fields = [
            'username', 'email', 'password', 'first_name', 'last_name',
            'military_rank', 'management_body', 'middle_name', 'teacher_id',
            'training_mode'
        ]

    def validate_teacher_id(self, value):
        request_user = self.context['request'].user
        if not (
            request_user.is_staff or
            request_user.is_superuser or
            getattr(request_user, 'role', None) == 'admin'
        ):
            raise serializers.ValidationError('Только администратор может выбрать экзаменатора для ученика.')

        if not User.objects.filter(id=value, role='teacher').exists():
            raise serializers.ValidationError('Экзаменатор не найден.')
        return value

    def validate(self, attrs):
        request_user = self.context['request'].user
        is_admin = (
            request_user.is_staff or
            request_user.is_superuser or
            getattr(request_user, 'role', None) == 'admin'
        )
        if is_admin and not request_user.is_teacher() and not attrs.get('teacher_id'):
            raise serializers.ValidationError({'teacher_id': 'Выберите экзаменатора для ученика.'})
        return attrs

    def create(self, validated_data):
        military_rank = validated_data.pop('military_rank', '')
        management_body = validated_data.pop('management_body', '')
        middle_name = validated_data.pop('middle_name', '')
        teacher_id = validated_data.pop('teacher_id', None)
        request_user = self.context['request'].user
        teacher = User.objects.get(id=teacher_id) if teacher_id else request_user

        with transaction.atomic():
            user = User.objects.create_user(
                username=validated_data['username'],
                email=validated_data.get('email', ''),
                password=validated_data['password'],
                role='student',
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', ''),
                training_mode=validated_data.get('training_mode', False),
                created_by_teacher=teacher,
            )
            StudentProfile.objects.create(
                user=user, 
                military_rank=military_rank, 
                management_body=management_body,
                middle_name=middle_name
            )

        return user


class UpdateStudentSerializer(serializers.ModelSerializer):
    military_rank = serializers.CharField(max_length=100, required=False, allow_blank=True)
    management_body = serializers.CharField(max_length=255, required=False, allow_blank=True)
    middle_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)
    teacher_id = serializers.IntegerField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = User
        fields = [
            'username', 'email', 'first_name', 'last_name', 'military_rank',
            'management_body', 'middle_name', 'password', 'teacher_id',
            'is_active', 'training_mode'
        ]

    def validate_teacher_id(self, value):
        if value is None:
            return value

        request_user = self.context['request'].user
        if not (
            request_user.is_staff or
            request_user.is_superuser or
            getattr(request_user, 'role', None) == 'admin'
        ):
            raise serializers.ValidationError('Только администратор может переносить ученика другому экзаменатору.')

        if not User.objects.filter(id=value, role='teacher').exists():
            raise serializers.ValidationError('Экзаменатор не найден.')
        return value

    def update(self, instance, validated_data):
        military_rank = validated_data.pop('military_rank', None)
        management_body = validated_data.pop('management_body', None)
        middle_name = validated_data.pop('middle_name', None)
        password = validated_data.pop('password', '')
        teacher_id = validated_data.pop('teacher_id', serializers.empty)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        if password:
            instance.set_password(password)

        if teacher_id is not serializers.empty:
            instance.created_by_teacher_id = teacher_id

        with transaction.atomic():
            instance.save()
            profile, _ = StudentProfile.objects.get_or_create(user=instance)
            if military_rank is not None:
                profile.military_rank = military_rank
            if management_body is not None:
                profile.management_body = management_body
            if middle_name is not None:
                profile.middle_name = middle_name
            profile.save()

        return instance



