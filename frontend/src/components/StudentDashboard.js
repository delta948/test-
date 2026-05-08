import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const StudentDashboard = () => {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchQuestions();
  }, []);

  const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const fetchQuestions = async () => {
    try {
      const token = localStorage.getItem('token');
      const testsRes = await axios.get(`${API_URL}/student/tests/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!testsRes.data || !Array.isArray(testsRes.data) || testsRes.data.length === 0) {
        console.log('No tests from API, using mock data');
        setQuestions(generateMockQuestions());
      } else {
        const testId = testsRes.data[0]?.id;
        if (!testId) {
          console.log('No test ID, using mock data');
          setQuestions(generateMockQuestions());
        } else {
          const questionsRes = await axios.get(`${API_URL}/tests/${testId}/questions/`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!questionsRes.data || !Array.isArray(questionsRes.data) || questionsRes.data.length === 0) {
            console.log('No questions from API, using mock data');
            setQuestions(generateMockQuestions());
          } else {
            const shuffledQuestions = shuffleArray(questionsRes.data);
            setQuestions(shuffledQuestions);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching questions:', error);
      // Используем mock-данные при ошибке
      setQuestions(generateMockQuestions());
    } finally {
      setLoading(false);
    }
  };

  const generateMockQuestions = () => {
    const mockQuestions = [];
    for (let i = 1; i <= 100; i++) {
      mockQuestions.push({
        id: i,
        text: `Суроо ${i}: Аскердик устав боюнча суроо?`,
        option_a: 'Вариант А - туура жооп',
        option_b: 'Вариант B - ката жооп',
        option_c: 'Вариант C - ката жооп',
        correct_answer: 'A',
        shuffledOptions: shuffleArray([
          { key: 'A', text: 'Вариант А - туура жооп', correct: true },
          { key: 'B', text: 'Вариант B - ката жооп', correct: false },
          { key: 'C', text: 'Вариант C - ката жооп', correct: false }
        ])
      });
    }
    return mockQuestions;
  };

  const selectAnswer = (questionId, originalOption) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: originalOption
    }));
  };

  const completeTest = async () => {
    setError(null);
    const unanswered = questions.filter(q => !answers[q.id]);
    if (unanswered.length > 0) {
      setError(`Пожалуйста, ответьте на все вопросы. Осталось: ${unanswered.length}`);
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const testsRes = await axios.get(`${API_URL}/student/tests/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      let attemptId;
      
      if (!testsRes.data || testsRes.data.length === 0 || !testsRes.data[0]?.id) {
        // Нет тестов в API — используем mock-завершение
        console.log('No tests in API, using mock completion');
        attemptId = Date.now(); // Генерируем временный ID
        
        // Сохраняем mock-результат в localStorage
        const mockResult = {
          attemptId: attemptId,
          correct_count: Object.keys(answers).length,
          total_questions: questions.length,
          score: Math.round((Object.keys(answers).length / questions.length) * 100),
          completed_at: new Date().toISOString()
        };
        localStorage.setItem(`mock_result_${attemptId}`, JSON.stringify(mockResult));
        
        navigate(`/test-results/${attemptId}`);
        return;
      }
      
      const testId = testsRes.data[0].id;

      const startRes = await axios.post(
        `${API_URL}/student/tests/${testId}/start/`,
        {},
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      if (!startRes.data || !startRes.data.attempt || !startRes.data.attempt.id) {
        throw new Error('Не удалось создать попытку теста');
      }
      
      attemptId = startRes.data.attempt.id;

      for (const questionId in answers) {
        await axios.post(
          `${API_URL}/student/attempts/${attemptId}/answer/`,
          {
            question_id: parseInt(questionId),
            selected_option: answers[questionId]
          },
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );
      }

      await axios.post(
        `${API_URL}/student/attempts/${attemptId}/complete/`,
        {},
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const resultRes = await axios.get(
        `${API_URL}/student/attempts/${attemptId}/result/`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      navigate(`/test-results/${attemptId}`);
    } catch (error) {
      console.error('Error completing test:', error);
      let errorMsg = 'Ошибка при завершении теста';
      if (error.response) {
        errorMsg = error.response.data?.detail || error.response.data?.error || `Ошибка сервера: ${error.response.status}`;
      } else if (error.request) {
        errorMsg = 'Сервер не отвечает. Проверьте подключение.';
      } else {
        errorMsg = error.message;
      }
      setError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
      </div>
    );
  }

  const answeredCount = Object.keys(answers).length;
  const progress = Math.round((answeredCount / questions.length) * 100);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Аскердик даярдык</h1>
        <div className="text-sm text-gray-500">
          {answeredCount} / {questions.length} вопросов ({progress}%)
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {questions.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-900 font-medium text-lg">Нет вопросов</p>
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-8">
            {questions.map((q, index) => (
              <div key={q.id} className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-green-600 font-semibold text-sm">{index + 1}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-4">{q.text}</h3>
                    <div className="space-y-2">
                      {[
                        { key: 'A', text: q.option_a },
                        { key: 'B', text: q.option_b },
                        { key: 'C', text: q.option_c }
                      ].map((opt) => {
                        const isSelected = answers[q.id] === opt.key;
                        return (
                          <div
                            key={opt.key}
                            className={`p-3 rounded-xl cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-green-500 text-white border-2 border-green-500'
                                : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                            }`}
                            onClick={() => selectAnswer(q.id, opt.key)}
                          >
                            <span className={isSelected ? 'text-white' : 'text-gray-700'}>
                              {opt.key}) {opt.text}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-center">
            <button
              onClick={completeTest}
              disabled={submitting || answeredCount < questions.length}
              className={`px-8 py-3 rounded-xl font-medium transition-colors ${
                submitting || answeredCount < questions.length
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
            >
              {submitting ? 'Завершение...' : 'Завершить тест'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default StudentDashboard;
