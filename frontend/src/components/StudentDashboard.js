import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const StudentDashboard = () => {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchQuestions();
  }, []);

  const fetchQuestions = async () => {
    try {
      const testsRes = await axios.get(`${API_URL}/student/tests/`);
      if (testsRes.data.length > 0) {
        const testId = testsRes.data[0].id;
        const questionsRes = await axios.get(`${API_URL}/tests/${testId}/questions/`);
        setQuestions(questionsRes.data);
      }
    } catch (error) {
      console.error('Error fetching questions:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectAnswer = (questionId, option) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: option
    }));
  };

  const completeTest = async () => {
    const unanswered = questions.filter(q => !answers[q.id]);
    if (unanswered.length > 0) {
      alert(`Пожалуйста, ответьте на все вопросы. Осталось: ${unanswered.length}`);
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const testsRes = await axios.get(`${API_URL}/student/tests/`);
      const testId = testsRes.data[0].id;

      // Создаем попытку
      const startRes = await axios.post(
        `${API_URL}/student/tests/${testId}/start/`,
        {},
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const attemptId = startRes.data.attempt.id;

      // Отправляем ответы
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

      // Завершаем тест
      await axios.post(
        `${API_URL}/student/attempts/${attemptId}/complete/`,
        {},
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      // Получаем результат
      const resultRes = await axios.get(
        `${API_URL}/student/attempts/${attemptId}/result/`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      setResult(resultRes.data);
      setShowResult(true);
    } catch (error) {
      console.error('Error completing test:', error);
      alert('Ошибка при завершении теста');
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

  if (showResult && result) {
    const correct = result.correct_count;
    const total = result.total_questions;
    const incorrect = total - correct;
    const percentage = Math.round((correct / total) * 100);

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Результат теста</h1>
          
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{correct}</div>
              <div className="text-sm text-gray-600">Правильных</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-red-600">{incorrect}</div>
              <div className="text-sm text-gray-600">Неправильных</div>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{percentage}%</div>
              <div className="text-sm text-gray-600">Результат</div>
            </div>
          </div>

          <div className="text-center mb-6">
            <p className="text-gray-700">
              Вы ответили правильно на <span className="font-semibold text-green-600">{correct}</span> из <span className="font-semibold">{total}</span> вопросов
            </p>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={() => {
                setShowResult(false);
                setAnswers({});
                setQuestions([]);
                fetchQuestions();
              }}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
            >
              Пройти заново
            </button>
            <button
              onClick={() => navigate('/student-dashboard')}
              className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-xl transition-colors"
            >
              На главную
            </button>
          </div>
        </div>
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
                      {['A', 'B', 'C'].map((option) => {
                        const optionText = option === 'A' ? q.option_a : option === 'B' ? q.option_b : q.option_c;
                        const isSelected = answers[q.id] === option;
                        return (
                          <div
                            key={option}
                            className={`p-3 rounded-xl cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-green-500 text-white border-2 border-green-500'
                                : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                            }`}
                            onClick={() => selectAnswer(q.id, option)}
                          >
                            <span className={isSelected ? 'text-white' : 'text-gray-700'}>
                              {option}) {optionText}
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
