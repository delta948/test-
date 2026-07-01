from core.serializer_utils import *
from questions.serializers import QuestionTriggerSerializer

class StudentResultSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.get_full_name', read_only=True)
    student_username = serializers.CharField(source='student.username', read_only=True)
    teacher_name = serializers.CharField(source='test.teacher.get_full_name', read_only=True)
    test_title = serializers.CharField(source='test.title', read_only=True)
    total_questions = serializers.IntegerField(read_only=True)
    triggers = serializers.JSONField(source='triggers_snapshot', read_only=True)
    selected_trigger = QuestionTriggerSerializer(read_only=True)
    
    class Meta:
        model = Attempt
        fields = [
            'id', 'student_name', 'student_username', 'test_title',
            'teacher_name', 'score', 'total_questions', 'completed_at', 'triggers', 'selected_trigger'
        ]


class SummaryReportSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = SummaryReport
        fields = ['id', 'title', 'teacher_name', 'student_count', 'generated_at', 'expires_at', 'file_url']

    def get_file_url(self, obj):
        request = self.context.get('request')
        if not obj.file:
            return ''
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url

