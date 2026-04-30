import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const StudentDashboard = () => {
  const [availableTests, setAvailableTests] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [testsRes, attemptsRes] = await Promise.all([
        axios.get(`${API_URL}/student/tests/`),
        axios.get(`${API_URL}/student/attempts/`)
      ]);
      
      setAvailableTests(testsRes.data);
      setAttempts(attemptsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const startTest = async (testId) => {
    try {
      const response = await axios.post(`${API_URL}/student/tests/${testId}/start/`);
      const attemptId = response.data.attempt.id;
      
      localStorage.setItem(`test_progress_${attemptId}`, '0');
      
      navigate(`/test/${attemptId}`);
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Ошибка при начале теста';
      alert(errorMsg);
    }
  };

  const continueTest = (attemptId) => {
    navigate(`/test/${attemptId}`);
  };

  const viewResult = (attemptId) => {
    navigate(`/result/${attemptId}`);
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Панель ученика</h1>
        <p className="text-gray-500 mt-1">Управляйте тестами и просматривайте результаты</p>
      </div>
      
      {attempts.filter(a => a.status === 'in_progress').length > 0 && (
        <div className="dashboard-card border-l-4 border-amber-500 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h5 className="text-lg font-semibold text-gray-900">Тесты в процессе</h5>
          </div>
          {attempts
            .filter(a => a.status === 'in_progress')
            .map(attempt => (
              <div key={attempt.id} className="test-list-item">
                <div>
                  <h6 className="font-medium text-gray-900">{attempt.test_title}</h6>
                  <p className="text-sm text-gray-500">
                    Отвечено: <span className="font-medium text-amber-600">{attempt.answered_count || 0}</span> / {attempt.total_questions || 100}
                  </p>
                </div>
                <button 
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5"
                  onClick={() => continueTest(attempt.id)}
                >
                  Продолжить
                </button>
              </div>
            ))}
        </div>
      )}

      <div className="dashboard-card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h5 className="text-lg font-semibold text-gray-900">Доступные тесты</h5>
        </div>
        {availableTests.length === 0 ? (
          <div className="empty-state py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-900 font-medium">Нет доступных тестов</p>
            <p className="text-sm text-gray-500 mt-1">
              Все тесты пройдены или пока не созданы
            </p>
          </div>
        ) : (
          availableTests.map(test => (
            <div key={test.id} className="test-list-item">
              <div>
                <h6 className="font-medium text-gray-900">{test.title}</h6>
                <p className="text-sm text-gray-500">
                  {test.question_count} вопросов · Учитель: {test.teacher_name}
                </p>
              </div>
              <button 
                className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5"
                onClick={() => startTest(test.id)}
              >
                Начать тест
              </button>
            </div>
          ))
        )}
      </div>

      <div className="dashboard-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h5 className="text-lg font-semibold text-gray-900">История попыток</h5>
        </div>
        {attempts.filter(a => a.status === 'completed').length === 0 ? (
          <div className="empty-state py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-900 font-medium">Вы еще не прошли ни одного теста</p>
          </div>
        ) : (
          attempts
            .filter(a => a.status === 'completed')
            .map(attempt => (
              <div key={attempt.id} className="test-list-item">
                <div>
                  <h6 className="font-medium text-gray-900">{attempt.test_title}</h6>
                  <p className="text-sm text-gray-500">
                    Результат: <span className={`font-medium ${attempt.score >= 80 ? 'text-green-600' : attempt.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{attempt.score}</span> / {attempt.total_questions || 100} · 
                    Завершен: {attempt.completed_at ? new Date(attempt.completed_at).toLocaleDateString('ru-RU') : '-'}
                  </p>
                </div>
                <button 
                  className="px-4 py-2 bg-white border-2 border-primary-200 text-primary-700 font-medium rounded-xl hover:bg-primary-50 hover:border-primary-300 transition-all duration-200"
                  onClick={() => viewResult(attempt.id)}
                >
                  Результат
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
};

export default StudentDashboard;
