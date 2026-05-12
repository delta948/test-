import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import useTestContentProtection from '../hooks/useTestContentProtection';

const API_URL = 'http://localhost:8000/api';
const TEST_DURATION_SECONDS = 60 * 60;

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const normalizeAnswers = (question) => {
  if (Array.isArray(question?.answers)) {
    return question.answers;
  }

  return [
    { key: 'A', text: question?.option_a },
    { key: 'B', text: question?.option_b },
    { key: 'C', text: question?.option_c },
  ].filter((answer) => answer.text);
};

const normalizeQuestion = (question) => ({
  id: question?.id,
  text: question?.text || '',
  ...question,
  answers: normalizeAnswers(question),
});

const extractArray = (data, key) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.results)) return data.results;
  return [];
};

const formatTimeLeft = (seconds) => {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const StudentDashboard = () => {
  const { user, logout } = useAuth();
  useTestContentProtection();
  const [tests, setTests] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [savedAnswerIds, setSavedAnswerIds] = useState([]);
  const [attemptId, setAttemptId] = useState(null);
  const [deadlineMs, setDeadlineMs] = useState(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(TEST_DURATION_SECONDS);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const answersRef = useRef({});
  const submittedRef = useRef(false);

  const safeQuestions = useMemo(
    () => (Array.isArray(questions) ? questions : []),
    [questions]
  );
  const safeTests = useMemo(
    () => (Array.isArray(tests) ? tests : []),
    [tests]
  );

  useEffect(() => {
    answersRef.current = answers || {};
  }, [answers]);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const testsRes = await axios.get(`${API_URL}/student/tests/`, {
        headers: getAuthHeaders(),
      });

      console.log('user:', user);
      console.log('API response:', testsRes.data);

      const loadedTests = extractArray(testsRes.data, 'tests');
      console.log('tests:', loadedTests);

      setTests(loadedTests);

      const testId = loadedTests[0]?.id;

      if (!testId) {
        setQuestions([]);
        setError('Нет доступных тестов');
        return;
      }

      const startRes = await axios.post(
        `${API_URL}/student/tests/${testId}/start/`,
        {},
        { headers: getAuthHeaders() }
      );

      const newAttemptId = startRes.data?.attempt?.id;
      if (!newAttemptId) {
        throw new Error('Не удалось создать попытку теста');
      }

      const expiresAt = startRes.data?.expires_at;
      const startedAt = startRes.data?.attempt?.started_at;
      const nextDeadlineMs = expiresAt
        ? Date.parse(expiresAt)
        : Date.parse(startedAt) + TEST_DURATION_SECONDS * 1000;

      submittedRef.current = false;
      setAttemptId(newAttemptId);
      setDeadlineMs(nextDeadlineMs);
      setTimeLeftSeconds(Math.max(0, Math.ceil((nextDeadlineMs - Date.now()) / 1000)));

      const questionsRes = await axios.get(
        `${API_URL}/student/attempts/${newAttemptId}/questions/`,
        { headers: getAuthHeaders() }
      );

      const apiQuestions = Array.isArray(questionsRes.data?.questions)
        ? questionsRes.data.questions
        : [];
      const answeredIds = Array.isArray(questionsRes.data?.answered_question_ids)
        ? questionsRes.data.answered_question_ids
        : [];
      const selectedAnswers = questionsRes.data?.selected_answers || {};

      console.log('questions API response:', questionsRes.data);

      setSavedAnswerIds(answeredIds);
      setAnswers(selectedAnswers);
      setQuestions(apiQuestions.map(normalizeQuestion));
    } catch (err) {
      console.error('Error fetching questions:', err);
      setQuestions([]);
      setError(
        err.response?.data?.error ||
          err.response?.data?.detail ||
          err.message ||
          'Ошибка загрузки вопросов'
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const selectAnswer = async (questionId, selectedOption) => {
    if (!questionId || !selectedOption) return;
    if (!attemptId) return;

    setAnswers((prev) => ({
      ...(prev || {}),
      [questionId]: selectedOption,
    }));

    try {
      await axios.post(
        `${API_URL}/student/attempts/${attemptId}/answer/`,
        {
          question_id: Number(questionId),
          selected_option: selectedOption,
        },
        { headers: getAuthHeaders() }
      );
      setSavedAnswerIds((prev) => [...new Set([...(prev || []), Number(questionId)])]);
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'Ошибка при сохранении ответа';
      setError(errorMessage);

      if (errorMessage.includes('Время теста истекло')) {
        completeTest({ timedOut: true });
      }
    }
  };

  const completeTest = useCallback(async ({ timedOut = false } = {}) => {
    if (submittedRef.current) return;
    setError(null);

    const answeredEntries = Object.entries(answersRef.current || {});

    if (!timedOut && answeredEntries.length < 1) {
      setError('Ответьте хотя бы на один вопрос, чтобы завершить тест');
      return;
    }

    if (!attemptId) {
      setError('Не найдена активная попытка теста');
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);

    try {
      if (!timedOut) {
        for (const [questionId, selectedOption] of answeredEntries) {
          if (savedAnswerIds.includes(Number(questionId))) continue;
          await axios.post(
            `${API_URL}/student/attempts/${attemptId}/answer/`,
            {
              question_id: Number(questionId),
              selected_option: selectedOption,
            },
            { headers: getAuthHeaders() }
          );
        }
      }

      await axios.post(
        `${API_URL}/student/attempts/${attemptId}/complete/`,
        { timed_out: timedOut },
        { headers: getAuthHeaders() }
      );

      logout();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('Error completing test:', err);
      setError(
        err.response?.data?.detail ||
          err.response?.data?.error ||
          err.message ||
          'Ошибка при завершении теста'
      );
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, logout, navigate, savedAnswerIds]);

  useEffect(() => {
    if (!deadlineMs || loading || submitting) return undefined;

    const updateTimer = () => {
      const nextTimeLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setTimeLeftSeconds(nextTimeLeft);

      if (nextTimeLeft <= 0 && !submittedRef.current) {
        setError('Время вышло. Тест автоматически завершается с текущими ответами.');
        completeTest({ timedOut: true });
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, [completeTest, deadlineMs, loading, submitting]);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
        <p className="mt-4 text-gray-600 font-medium">Загрузка вопросов...</p>
      </div>
    );
  }

  const safeAnswers = answers || {};
  const answeredCount = Object.keys(safeAnswers).length;
  const progress = safeQuestions.length
    ? Math.round((answeredCount / safeQuestions.length) * 100)
    : 0;
  const timeLeftPercent = Math.max(
    0,
    Math.min(100, (timeLeftSeconds / TEST_DURATION_SECONDS) * 100)
  );

  return (
    <div className="protected-test-content max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Аскердик даярдык</h1>
          <div className="text-sm text-gray-500">
            {answeredCount} / {safeQuestions.length} вопросов ({progress}%)
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-red-700 animate-pulse">
              Обратный отсчет
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
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {safeQuestions.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-900 font-medium text-lg">
            {safeTests.length === 0 ? 'Нет доступных тестов' : 'Нет вопросов'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-8">
            {safeQuestions.map((question, index) => {
              const questionAnswers = Array.isArray(question?.answers)
                ? question.answers
                : [];

              return (
                <div
                  key={question.id || index}
                  className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-green-600 font-semibold text-sm">
                        {index + 1}
                      </span>
                    </div>

                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 mb-4">
                        {question.text}
                      </h3>

                      <div className="space-y-2">
                        {(questionAnswers || []).length === 0 ? (
                          <div className="p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-800">
                            Нет вариантов ответа
                          </div>
                        ) : (
                          (questionAnswers || []).map((answer) => {
                            const answerKey = answer.original_key || answer.key;
                            const isSelected = safeAnswers[question.id] === answerKey;

                            return (
                              <button
                                key={answer.key}
                                type="button"
                                className={`w-full text-left p-3 rounded-xl cursor-pointer transition-colors border-2 ${
                                  isSelected
                                    ? 'bg-green-500 text-white border-green-500'
                                    : 'bg-gray-50 hover:bg-gray-100 border-transparent'
                                }`}
                                onClick={() => selectAnswer(question.id, answerKey)}
                              >
                                <span className={isSelected ? 'text-white' : 'text-gray-700'}>
                                  {answer.key}) {answer.text}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => completeTest()}
              disabled={submitting || answeredCount < 1}
              className={`px-8 py-3 rounded-xl font-medium transition-colors ${
                submitting || answeredCount < 1
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
