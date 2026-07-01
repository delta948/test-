import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import API_URL from '../config/api';

const TestResultsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, t } = useLanguage();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, language]);

  const fetchResult = async () => {
    try {
      // Проверяем mock-результат в localStorage
      const mockResult = localStorage.getItem(`mock_result_${id}`);
      if (mockResult) {
        const parsed = JSON.parse(mockResult);
        setResult({
          attempt: {
            test_title: t('Военная подготовка'),
            completed_at: parsed.completed_at
          },
          correct_count: parsed.correct_count,
          total_questions: parsed.total_questions
        });
        setLoading(false);
        return;
      }
      
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${API_URL}/student/attempts/${id}/result/?lang=${language}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      setResult(response.data);
    } catch (err) {
      console.error('Error fetching result:', err);
      setError(t('Не удалось загрузить результат'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!result || loading || error) return undefined;

    const timeoutId = window.setTimeout(() => {
      logout();
      navigate('/login', { replace: true });
    }, 15000);

    return () => window.clearTimeout(timeoutId);
  }, [error, loading, logout, navigate, result]);

  const getGrade = (percentage) => {
    if (percentage >= 90) return { label: t('Отлично'), color: 'green' };
    if (percentage >= 75) return { label: t('Хорошо'), color: 'blue' };
    if (percentage >= 50) return { label: t('Удовлетворительно'), color: 'yellow' };
    return { label: t('Неудовлетворительно'), color: 'red' };
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <p className="text-red-700">{error || t('Результат не найден')}</p>
        </div>
      </div>
    );
  }

  const correct = result.correct_count || 0;
  const total = result.total_questions || 100;
  const incorrect = total - correct;
  const percentage = Math.round((correct / total) * 100);
  const grade = getGrade(percentage);

  const gradeColors = {
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    red: 'bg-red-50 text-red-700 border-red-200'
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">{t('Результат теста')}</h1>
        <p className="text-gray-500 text-center mb-8">
          {result.attempt?.test_title ? t(result.attempt.test_title) : t('Военная подготовка')}
        </p>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">{t('Прогресс')}</span>
            <span className="text-sm font-medium text-gray-700">{percentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className={`h-4 rounded-full transition-all duration-500 ${
                percentage >= 90 ? 'bg-green-500' : percentage >= 75 ? 'bg-blue-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${percentage}%` }}
            ></div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-green-50 rounded-xl p-6 text-center border border-green-200">
            <div className="text-4xl font-bold text-green-600 mb-1">{correct}</div>
            <div className="text-sm text-gray-600">{t('results.correct_short')}</div>
          </div>
          <div className="bg-red-50 rounded-xl p-6 text-center border border-red-200">
            <div className="text-4xl font-bold text-red-600 mb-1">{incorrect}</div>
            <div className="text-sm text-gray-600">{t('results.incorrect_short')}</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-6 text-center border border-blue-200">
            <div className="text-4xl font-bold text-blue-600 mb-1">{total}</div>
            <div className="text-sm text-gray-600">{t('questions.total')}</div>
          </div>
        </div>

        {/* Grade */}
        <div className={`rounded-xl p-6 text-center mb-8 border ${gradeColors[grade.color]}`}>
          <div className="text-sm text-gray-600 mb-1">{t('results.your_grade')}</div>
          <div className="text-3xl font-bold">{grade.label}</div>
        </div>

        {/* Summary */}
        <div className="text-center mb-8">
          <p className="text-gray-700">
            {t('results.correct_summary_prefix')} <span className="font-semibold text-green-600">{correct}</span> {t('common.from')} <span className="font-semibold">{total}</span> {t('questions.questions')}
          </p>
        </div>

      </div>
    </div>
  );
};

export default TestResultsPage;
