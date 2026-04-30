import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const VIDEO_URL = 'https://www.youtube.com/embed/dQw4w9WgXcQ';

const TestPage = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testInfo, setTestInfo] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTestData();
    
    const handleBeforeUnload = (e) => {
      if (questions.length > 0 && currentIndex < questions.length) {
        e.preventDefault();
        e.returnValue = 'У вас есть несохраненный прогресс. Вы уверены, что хотите уйти?';
        return e.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [attemptId, questions.length, currentIndex]);

  useEffect(() => {
    const savedProgress = localStorage.getItem(`test_progress_${attemptId}`);
    if (savedProgress && questions.length > 0) {
      const savedIndex = parseInt(savedProgress, 10);
      if (savedIndex > 0 && savedIndex < questions.length) {
        setCurrentIndex(savedIndex);
      }
    }
  }, [attemptId, questions.length]);

  const fetchTestData = async () => {
    try {
      const response = await axios.get(`${API_URL}/student/attempts/${attemptId}/questions/`);
      
      setQuestions(response.data.questions);
      setTestInfo({
        attemptId: response.data.attempt_id,
        totalQuestions: response.data.total_questions,
        currentIndex: response.data.current_question_index
      });
      
      const answeredIds = response.data.answered_question_ids || [];
      setAnsweredQuestions(answeredIds);
      
      const firstUnanswered = response.data.questions.findIndex(
        q => !answeredIds.includes(q.id)
      );
      
      if (firstUnanswered !== -1) {
        setCurrentIndex(firstUnanswered);
      } else if (answeredIds.length === response.data.questions.length) {
        completeTest();
      } else {
        setCurrentIndex(response.data.current_question_index || 0);
      }
      
      setLoading(false);
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Ошибка загрузки теста';
      setError(errorMsg);
      setLoading(false);
      
      if (error.response?.status === 404) {
        setTimeout(() => navigate('/student/dashboard'), 2000);
      }
    }
  };

  const submitAnswer = async (selectedOption) => {
    if (saving) return;
    
    const currentQuestion = questions[currentIndex];
    
    if (answeredQuestions.includes(currentQuestion.id)) {
      alert('Вы уже ответили на этот вопрос');
      return;
    }
    
    setSaving(true);
    
    try {
      const response = await axios.post(`${API_URL}/student/attempts/${attemptId}/answer/`, {
        question_id: currentQuestion.id,
        selected_option: selectedOption
      });
      
      setAnsweredQuestions([...answeredQuestions, currentQuestion.id]);
      
      localStorage.setItem(`test_progress_${attemptId}`, (currentIndex + 1).toString());
      
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        const allAnswered = answeredQuestions.length + 1 >= questions.length;
        if (allAnswered) {
          completeTest();
        }
      }
      
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Ошибка при сохранении ответа';
      alert(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const completeTest = async () => {
    try {
      const response = await axios.post(`${API_URL}/student/attempts/${attemptId}/complete/`);
      
      localStorage.removeItem(`test_progress_${attemptId}`);
      
      alert(`Тест завершен! Ваш результат: ${response.data.correct_answers} / ${response.data.total_questions}`);
      navigate(`/result/${attemptId}`);
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Ошибка при завершении теста';
      alert(errorMsg);
    }
  };

  const goToNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      localStorage.setItem(`test_progress_${attemptId}`, (currentIndex + 1).toString());
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      localStorage.setItem(`test_progress_${attemptId}`, (currentIndex - 1).toString());
    }
  };

  const goToQuestion = (index) => {
    setCurrentIndex(index);
    localStorage.setItem(`test_progress_${attemptId}`, index.toString());
  };

  const handleCompleteClick = () => {
    if (answeredQuestions.length < questions.length) {
      const unansweredCount = questions.length - answeredQuestions.length;
      if (!window.confirm(`Вы ответили не на все вопросы (${unansweredCount} без ответа). Завершить тест?`)) {
        return;
      }
    }
    completeTest();
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
        <p className="mt-4 text-gray-600 font-medium">Загрузка теста...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center">
          <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const isCurrentAnswered = answeredQuestions.includes(currentQuestion?.id);
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="test-container max-w-5xl mx-auto animate-fade-in pb-8">
      <div className="progress-container">
        <div className="flex justify-between items-center mb-3">
          <span className="text-lg font-semibold text-gray-800">
            Вопрос <span className="text-primary-600">{currentIndex + 1}</span> / {questions.length}
          </span>
          <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            Отвечено: <span className="font-semibold text-primary-600">{answeredQuestions.length}</span> / {questions.length}
          </span>
        </div>
        <div className="progress-bar-modern">
          <div 
            className="progress-bar-fill" 
            style={{width: `${progress}%`}}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-400">
          <span>Начало</span>
          <span>{Math.round(progress)}% завершено</span>
          <span>Конец</span>
        </div>
      </div>

      <div className="video-container">
        <div className="video-wrapper">
          <iframe
            src={`${VIDEO_URL}?autoplay=0&mute=1`}
            title="Test Video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      </div>

      {currentQuestion && (
        <div className="question-card">
          <div className="question-text">
            {currentQuestion.text}
          </div>

          <div className="answer-buttons">
            <button
              className={`answer-btn ${isCurrentAnswered ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700'}`}
              onClick={() => submitAnswer('A')}
              disabled={isCurrentAnswered || saving}
            >
              {saving ? (
                <div className="spinner-modern w-5 h-5 border-2 mx-auto"></div>
              ) : (
                <span className="flex flex-col items-center">
                  <span className="text-lg font-bold">A</span>
                  <span className="text-sm font-normal opacity-90">{currentQuestion.option_a}</span>
                </span>
              )}
            </button>
            
            <button
              className={`answer-btn ${isCurrentAnswered ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700'}`}
              onClick={() => submitAnswer('B')}
              disabled={isCurrentAnswered || saving}
            >
              {saving ? (
                <div className="spinner-modern w-5 h-5 border-2 mx-auto"></div>
              ) : (
                <span className="flex flex-col items-center">
                  <span className="text-lg font-bold">B</span>
                  <span className="text-sm font-normal opacity-90">{currentQuestion.option_b}</span>
                </span>
              )}
            </button>
            
            <button
              className={`answer-btn ${isCurrentAnswered ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-violet-500 to-violet-600 text-white hover:from-violet-600 hover:to-violet-700'}`}
              onClick={() => submitAnswer('C')}
              disabled={isCurrentAnswered || saving}
            >
              {saving ? (
                <div className="spinner-modern w-5 h-5 border-2 mx-auto"></div>
              ) : (
                <span className="flex flex-col items-center">
                  <span className="text-lg font-bold">C</span>
                  <span className="text-sm font-normal opacity-90">{currentQuestion.option_c}</span>
                </span>
              )}
            </button>
          </div>

          {isCurrentAnswered && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-center">
              <div className="flex items-center justify-center gap-2 text-blue-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">Ответ сохранен. Переходите к следующему вопросу.</span>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-100">
            <button
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={goToPrevious}
              disabled={currentIndex === 0}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Назад
            </button>

            <div className="flex gap-3">
              {currentIndex < questions.length - 1 ? (
                <button
                  className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2"
                  onClick={goToNext}
                >
                  Далее
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <button
                  className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
                  onClick={handleCompleteClick}
                >
                  Завершить тест
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-card mt-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <h6 className="font-semibold text-gray-700">Навигация по вопросам</h6>
        </div>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, index) => (
            <button
              key={q.id}
              className={`w-10 h-10 rounded-lg font-medium text-sm transition-all duration-200 ${
                index === currentIndex 
                  ? 'bg-primary-600 text-white shadow-lg scale-110' 
                  : answeredQuestions.includes(q.id) 
                    ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => goToQuestion(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="text-center mt-6">
        <button 
          className="px-6 py-3 bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium rounded-xl transition-all duration-200 flex items-center gap-2 mx-auto"
          onClick={handleCompleteClick}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Завершить тест досрочно
        </button>
      </div>
    </div>
  );
};

export default TestPage;
