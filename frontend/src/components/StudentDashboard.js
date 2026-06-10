import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { localizeQuestion, useLanguage } from '../context/LanguageContext';
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
    { key: 'D', text: question?.option_d },
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
  const { language, t } = useLanguage();
  useTestContentProtection();
  const [tests, setTests] = useState([]);
  const [selectedTriggerIds, setSelectedTriggerIds] = useState([]);
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
    () => (Array.isArray(questions) ? questions.map((question) => normalizeQuestion(localizeQuestion(question, language))) : []),
    [questions, language]
  );
  const safeTests = useMemo(
    () => (Array.isArray(tests) ? tests : []),
    [tests]
  );
  const availableTriggers = useMemo(() => {
    const triggersById = new Map();

    safeTests.forEach((test) => {
      const testTriggers = Array.isArray(test?.triggers) ? test.triggers : [];
      testTriggers.forEach((trigger) => {
        if (!trigger?.id) return;
        const triggerId = String(trigger.id);
        if (!triggersById.has(triggerId)) {
          triggersById.set(triggerId, trigger);
        }
      });
    });

    return Array.from(triggersById.values());
  }, [safeTests]);

  const selectedTestForTriggers = useMemo(() => {
    if (!safeTests.length || selectedTriggerIds.length === 0) return null;

    return (
      safeTests.find((test) => {
        const triggerIds = new Set(
          (Array.isArray(test?.triggers) ? test.triggers : []).map((trigger) => String(trigger.id))
        );
        return selectedTriggerIds.every((triggerId) => triggerIds.has(String(triggerId)));
      }) ||
      safeTests[0] ||
      null
    );
  }, [safeTests, selectedTriggerIds]);

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

      if (!loadedTests.length) {
        setQuestions([]);
        setError(t('Нет доступных категорий тестирования'));
        return;
      }

      return;

      // eslint-disable-next-line no-unreachable
      const startRes = await axios.post(
        `${API_URL}/student/tests/${testId}/start/`,
        {},
        { headers: getAuthHeaders() }
      );

      const newAttemptId = startRes.data?.attempt?.id;
      if (!newAttemptId) {
        throw new Error(t('Не удалось создать попытку теста'));
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
      setQuestions(apiQuestions);
    } catch (err) {
      console.error('Error fetching questions:', err);
      setQuestions([]);
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        'Ошибка загрузки вопросов';
      setError(t(errorMessage));
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  const startSelectedTest = async () => {
    if (selectedTriggerIds.length === 0) {
      setError(t('Выберите хотя бы одну категорию тестирования'));
      return;
    }

    if (!selectedTestForTriggers?.id) {
      setError(t('Нет доступного теста для выбранных категорий'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const startRes = await axios.post(
        `${API_URL}/student/tests/${selectedTestForTriggers.id}/start/`,
        { trigger_ids: selectedTriggerIds.map(Number) },
        { headers: getAuthHeaders() }
      );

      const newAttemptId = startRes.data?.attempt?.id;
      if (!newAttemptId) {
        throw new Error(t('Не удалось создать попытку теста'));
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
        `${API_URL}/student/attempts/${newAttemptId}/questions/?lang=${language}`,
        { headers: getAuthHeaders() }
      );

      const apiQuestions = Array.isArray(questionsRes.data?.questions)
        ? questionsRes.data.questions
        : [];
      const answeredIds = Array.isArray(questionsRes.data?.answered_question_ids)
        ? questionsRes.data.answered_question_ids
        : [];
      const selectedAnswers = questionsRes.data?.selected_answers || {};

      setSavedAnswerIds(answeredIds);
      setAnswers(selectedAnswers);
      setQuestions(apiQuestions);
    } catch (err) {
      console.error('Error starting test:', err);
      setQuestions([]);
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        'Ошибка запуска теста';
      setError(t(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  useEffect(() => {
    const availableTriggerIds = new Set(availableTriggers.map((trigger) => String(trigger.id)));
    setSelectedTriggerIds((current) =>
      current.filter((triggerId) => availableTriggerIds.has(String(triggerId)))
    );
  }, [availableTriggers]);

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
      const errorMessage = err.response?.data?.error || err.message || t('Ошибка при сохранении ответа');
      setError(t(errorMessage));

      if (errorMessage.includes('Время теста истекло') || errorMessage.includes('Тесттин убактысы бүттү')) {
        completeTest({ timedOut: true });
      }
    }
  };

  const completeTest = useCallback(async ({ timedOut = false } = {}) => {
    if (submittedRef.current) return;
    setError(null);

    const answeredEntries = Object.entries(answersRef.current || {});

    if (!timedOut && answeredEntries.length < 1) {
      setError(t('Ответьте хотя бы на один вопрос, чтобы завершить тест'));
      return;
    }

    if (!attemptId) {
      setError(t('Не найдена активная попытка теста'));
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
      const errorMessage =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        err.message ||
        'Ошибка при завершении теста';
      setError(t(errorMessage));
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, logout, navigate, savedAnswerIds, t]);

  useEffect(() => {
    if (!deadlineMs || loading || submitting) return undefined;

    const updateTimer = () => {
      const nextTimeLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setTimeLeftSeconds(nextTimeLeft);

      if (nextTimeLeft <= 0 && !submittedRef.current) {
        setError(t('Время вышло. Тест автоматически завершается с текущими ответами.'));
        completeTest({ timedOut: true });
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, [completeTest, deadlineMs, loading, submitting, t]);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
        <p className="mt-4 text-gray-600 font-medium">{t('Загрузка вопросов...')}</p>
      </div>
    );
  }

  if (!attemptId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('Выбор тестирования')}</h1>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {availableTriggers.length === 0 ? (
            <p className="text-gray-600">{t('Нет доступных категорий тестирования')}</p>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  {t('Выберите категории тестирования')}
                </h2>
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  {availableTriggers.map((trigger) => {
                    const triggerId = String(trigger.id);
                    const isSelected = selectedTriggerIds.includes(triggerId);

                    return (
                      <label
                        key={trigger.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition hover:border-green-300 hover:shadow-sm ${
                          isSelected ? 'border-green-500 ring-2 ring-green-100' : 'border-gray-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedTriggerIds((current) =>
                              current.includes(triggerId)
                                ? current.filter((id) => id !== triggerId)
                                : [...current, triggerId]
                            );
                          }}
                        />
                        <span className="font-medium text-gray-900">{t(trigger.name)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-sm transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                onClick={startSelectedTest}
                disabled={selectedTriggerIds.length === 0}
              >
                {t('Начать тест')}
              </button>
            </div>
          )}
        </div>
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
          <h1 className="text-2xl font-bold text-gray-900">{t('Тестирование')}</h1>
          <div className="text-sm text-gray-500">
            {answeredCount} / {safeQuestions.length} {t('вопросов')} ({progress}%)
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
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
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {safeQuestions.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-900 font-medium text-lg">
            {safeTests.length === 0 ? t('Нет доступных тестов') : t('Нет вопросов')}
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
                            {t('Нет вариантов ответа')}
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
              {submitting ? t('Завершение...') : t('Завершить тест')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default StudentDashboard;
