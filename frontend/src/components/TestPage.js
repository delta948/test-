import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { localizeQuestion, useLanguage } from '../context/LanguageContext';
import useTestContentProtection from '../hooks/useTestContentProtection';

const API_URL = 'http://localhost:8000/api';
const TEST_DURATION_SECONDS = 60 * 60;

const formatTimeLeft = (seconds) => {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const TestPage = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, t } = useLanguage();
  useTestContentProtection();

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const [deadlineMs, setDeadlineMs] = useState(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(TEST_DURATION_SECONDS);
  const submittedRef = useRef(false);
  const localizedQuestions = useMemo(
    () => questions.map((question) => localizeQuestion(question, language)),
    [questions, language]
  );

  const completeTest = async ({ timedOut = false } = {}) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setCompleting(true);
    setCompletionError('');

    try {
      await axios.post(`${API_URL}/student/attempts/${attemptId}/complete/`, {
        timed_out: timedOut,
      });

      localStorage.removeItem(`test_progress_${attemptId}`);
      logout();
      navigate('/login', { replace: true });
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        t('Ошибка при завершении теста');
      setCompletionError(t(errorMsg));
      submittedRef.current = false;
    } finally {
      setCompleting(false);
    }
  };

  const fetchTestData = async () => {
    try {
      const response = await axios.get(`${API_URL}/student/attempts/${attemptId}/questions/?lang=${language}`);
      const apiQuestions = Array.isArray(response.data?.questions) ? response.data.questions : [];
      const answeredIds = response.data?.answered_question_ids || [];
      const savedSelectedAnswers = response.data?.selected_answers || {};
      const expiresAt = response.data?.expires_at;
      const nextDeadlineMs = expiresAt
        ? Date.parse(expiresAt)
        : Date.now() + TEST_DURATION_SECONDS * 1000;

      setQuestions(apiQuestions);
      setAnsweredQuestions(answeredIds);
      setSelectedAnswers(savedSelectedAnswers);
      setDeadlineMs(nextDeadlineMs);
      setTimeLeftSeconds(Math.max(0, Math.ceil((nextDeadlineMs - Date.now()) / 1000)));

      const firstUnanswered = apiQuestions.findIndex((question) => !answeredIds.includes(question.id));
      if (firstUnanswered !== -1) {
        setCurrentIndex(firstUnanswered);
      } else {
        setCurrentIndex(response.data?.current_question_index || 0);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || t('Ошибка загрузки теста');
      setError(t(errorMsg));

      if (err.response?.status === 404) {
        setTimeout(() => navigate('/student/dashboard'), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTestData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  useEffect(() => {
    if (!deadlineMs || loading || completing) return undefined;

    const updateTimer = () => {
      const nextTimeLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setTimeLeftSeconds(nextTimeLeft);

      if (nextTimeLeft <= 0 && !submittedRef.current) {
        setCompletionError(t('Время вышло. Тест автоматически завершается с текущими ответами.'));
        completeTest({ timedOut: true });
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineMs, loading, completing]);

  const submitAnswer = async (selectedOption) => {
    if (saving || completing) return;

    const currentQuestion = localizedQuestions[currentIndex] || questions[currentIndex];
    if (!currentQuestion) return;

    setSaving(true);
    setError('');

    try {
      await axios.post(`${API_URL}/student/attempts/${attemptId}/answer/`, {
        question_id: currentQuestion.id,
        selected_option: selectedOption,
      });

      const nextAnsweredQuestions = [...new Set([...answeredQuestions, currentQuestion.id])];
      setAnsweredQuestions(nextAnsweredQuestions);
      setSelectedAnswers((prev) => ({
        ...prev,
        [currentQuestion.id]: selectedOption,
      }));
      localStorage.setItem(`test_progress_${attemptId}`, String(currentIndex + 1));

      if (currentIndex < localizedQuestions.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || t('Ошибка при сохранении ответа');
      setError(t(errorMsg));

      if (errorMsg.includes('Время теста истекло') || errorMsg.includes('Тесттин убактысы бүттү')) {
        setTimeout(() => {
          logout();
          navigate('/login', { replace: true });
        }, 1200);
      }
    } finally {
      setSaving(false);
    }
  };

  const goToNext = () => {
    if (currentIndex < localizedQuestions.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      localStorage.setItem(`test_progress_${attemptId}`, String(nextIndex));
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      const previousIndex = currentIndex - 1;
      setCurrentIndex(previousIndex);
      localStorage.setItem(`test_progress_${attemptId}`, String(previousIndex));
    }
  };

  const goToQuestion = (index) => {
    setCurrentIndex(index);
    localStorage.setItem(`test_progress_${attemptId}`, String(index));
  };

  const handleCompleteClick = () => {
    setCompletionError('');
    if (answeredQuestions.length < 1) {
      setCompletionError(t('Ответьте хотя бы на один вопрос, чтобы завершить тест'));
      return;
    }
    completeTest();
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
        <p className="mt-4 text-gray-600 font-medium">{t('Загрузка теста...')}</p>
      </div>
    );
  }

  if (error && questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center">
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const currentQuestion = localizedQuestions[currentIndex];
  const isCurrentAnswered = answeredQuestions.includes(currentQuestion?.id);
  const currentSelectedAnswer = selectedAnswers[currentQuestion?.id];
  const progress = localizedQuestions.length ? ((currentIndex + 1) / localizedQuestions.length) * 100 : 0;
  const timeLeftPercent = Math.max(0, Math.min(100, (timeLeftSeconds / TEST_DURATION_SECONDS) * 100));
  const currentAnswers = currentQuestion?.answers || [
    { key: 'A', text: currentQuestion?.option_a },
    { key: 'B', text: currentQuestion?.option_b },
    { key: 'C', text: currentQuestion?.option_c },
  ];

  return (
    <div className="test-container protected-test-content max-w-5xl mx-auto animate-fade-in pb-8">
      {completionError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{completionError}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <div className="progress-container">
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-red-700 animate-pulse">
              {t('Обратный отсчет')}
            </span>
            <span className="font-mono text-2xl font-bold text-red-700 animate-pulse">
              {formatTimeLeft(timeLeftSeconds)}
            </span>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-red-100">
            <div
              className="h-full rounded-full bg-red-600 transition-all duration-1000 ease-linear"
              style={{ width: `${timeLeftPercent}%` }}
            />
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className="text-lg font-semibold text-gray-800">
            {t('Вопрос')} <span className="text-primary-600">{currentIndex + 1}</span> / {localizedQuestions.length}
          </span>
          <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            {t('Отвечено')}: <span className="font-semibold text-primary-600">{answeredQuestions.length}</span> / {localizedQuestions.length}
          </span>
        </div>
        <div className="progress-bar-modern">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {currentQuestion && (
        <div className="question-card">
          <div className="question-text">{currentQuestion.text}</div>

          <div className="answer-buttons">
            {currentAnswers.map((answer, index) => {
              const answerKey = answer.original_key || answer.key;
              const isSelected = currentSelectedAnswer === answerKey;
              const colors = [
                'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700',
                'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700',
                'bg-gradient-to-r from-violet-500 to-violet-600 text-white hover:from-violet-600 hover:to-violet-700',
                'bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700',
              ];

              return (
                <button
                  key={answer.key}
                  className={`answer-btn ${isSelected ? 'bg-green-600 text-white ring-4 ring-green-200' : colors[index]}`}
                  onClick={() => submitAnswer(answerKey)}
                  disabled={saving || completing}
                >
                  {saving ? (
                    <div className="spinner-modern w-5 h-5 border-2 mx-auto"></div>
                  ) : (
                    <span className="flex flex-col items-center">
                      <span className="text-lg font-bold">{answer.key}</span>
                      <span className="text-sm font-normal opacity-90">{answer.text}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isCurrentAnswered && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-center">
              <span className="font-medium text-blue-700">{t('Ответ сохранен.')}</span>
            </div>
          )}

          <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-100">
            <button
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={goToPrevious}
              disabled={currentIndex === 0 || completing}
            >
              {t('Назад')}
            </button>

            <button
              className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50"
              onClick={currentIndex < questions.length - 1 ? goToNext : handleCompleteClick}
              disabled={completing}
            >
              {currentIndex < localizedQuestions.length - 1 ? t('Далее') : (completing ? t('Завершение...') : t('Завершить тест'))}
            </button>
          </div>
        </div>
      )}

      <div className="dashboard-card mt-6">
        <h6 className="font-semibold text-gray-700 mb-4">{t('Навигация по вопросам')}</h6>
        <div className="flex flex-wrap gap-2">
          {localizedQuestions.map((question, index) => (
            <button
              key={question.id}
              className={`w-10 h-10 rounded-lg font-medium text-sm transition-all duration-200 ${
                index === currentIndex
                  ? 'bg-primary-600 text-white shadow-lg scale-110'
                  : answeredQuestions.includes(question.id)
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => goToQuestion(index)}
              disabled={completing}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="text-center mt-6">
        <button
          className="px-6 py-3 bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleCompleteClick}
          disabled={completing}
        >
          {completing ? t('Завершение...') : t('Завершить тест досрочно')}
        </button>
      </div>
    </div>
  );
};

export default TestPage;
