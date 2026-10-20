import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { localizeQuestion, useLanguage } from '../context/LanguageContext';
import API_URL from '../config/api';
import useTestContentProtection from '../hooks/useTestContentProtection';

const TOTAL_TIME = 3000; // 50 minutes
const ACTIVE_TEST_CONFIG_STORAGE_KEY = 'activeTestConfig';
const HIDDEN_TEST_CATEGORY_SLUGS = new Set(['sergeant_warrant', 'junior_officer', 'senior_officer']);
const HIDDEN_TEST_CATEGORY_NAMES = new Set(['1', 'состав']);
const NON_PUBLIC_TEST_CATEGORY_SLUGS = new Set(['odim11', 'sostav101']);
const VARIABLE_QUESTION_COUNT_SLUGS = new Set([
  'special-training',
  'communications-training',
  'engineering-training',
  'logistics-training',
  'armament-training',
  'air-defense-training',
]);
const SPECIAL_TRAINING_SLUG = 'special-training';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const normalizeAnswers = (question) => {
  if (Array.isArray(question?.answers)) {
    return question.answers.map((answer, index) => ({
      ...answer,
      key: String.fromCharCode(65 + index),
      original_key: answer.original_key || answer.key || String.fromCharCode(65 + index),
    }));
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

const isVisibleTestingCategory = (trigger) => {
  const slug = String(trigger?.slug || '').trim();
  const name = String(trigger?.name || '').trim().toLowerCase();
  return (
    Boolean(trigger?.id) &&
    trigger?.is_active !== false &&
    !HIDDEN_TEST_CATEGORY_SLUGS.has(slug) &&
    !NON_PUBLIC_TEST_CATEGORY_SLUGS.has(slug) &&
    !HIDDEN_TEST_CATEGORY_NAMES.has(name)
  );
};

const getTriggerQuestionCount = (trigger) => {
  return Number(trigger?.question_count || 0);
};
const getRequiredQuestionCount = (categories = []) => {
  return categories.length > 0 ? 1 : 100;
};

const getSelectedCategoriesQuestionError = (categories) => {
  const selectedQuestionCount = categories.reduce(
    (sum, category) => sum + Number(category.question_count || 0),
    0
  );

  if (selectedQuestionCount <= 0) {
    return 'Нет вопросов';
  }

  const requiredQuestionCount = getRequiredQuestionCount(categories);

  if (selectedQuestionCount < requiredQuestionCount) {
    return 'Для данной категории недостаточно вопросов';
  }

  return null;
};


const getErrorMessage = (err, fallback) => (
  err.response?.data?.message ||
  err.response?.data?.error?.message ||
  err.response?.data?.error ||
  err.response?.data?.detail ||
  err.message ||
  fallback
);

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const StudentDashboard = () => {
  const { logout } = useAuth();
  const { language, t } = useLanguage();
  useTestContentProtection();
  const [tests, setTests] = useState([]);
  const [categoryTriggers, setCategoryTriggers] = useState([]);
  const [selectedTriggerIds, setSelectedTriggerIds] = useState([]);
  const [selectedMainTriggerId, setSelectedMainTriggerId] = useState('');
  const [selectedSubTriggerId, setSelectedSubTriggerId] = useState('');
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [savedAnswerIds, setSavedAnswerIds] = useState([]);
  const [attemptId] = useState(null);
  const [deadlineMs] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(TOTAL_TIME);
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

    categoryTriggers.forEach((trigger) => {
      if (!trigger?.id || !isVisibleTestingCategory(trigger)) return;
      const triggerId = String(trigger.id);
      if (!triggersById.has(triggerId)) {
        triggersById.set(triggerId, trigger);
      }
    });

    return Array.from(triggersById.values());
  }, [categoryTriggers]);
  const availableChildrenByParent = useMemo(() => {
    const childrenByParent = {};
    availableTriggers.forEach((trigger) => {
      if (!trigger.parent_id) return;
      const parentId = String(trigger.parent_id);
      childrenByParent[parentId] = [...(childrenByParent[parentId] || []), trigger];
    });
    Object.values(childrenByParent).forEach((children) => {
      children.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    });
    return childrenByParent;
  }, [availableTriggers]);
  const availableTriggerCards = useMemo(
    () => availableTriggers.filter((trigger) => !trigger.parent_id),
    [availableTriggers]
  );
  const selectedMainTrigger = useMemo(
    () => availableTriggerCards.find((trigger) => String(trigger.id) === String(selectedMainTriggerId)) || null,
    [availableTriggerCards, selectedMainTriggerId]
  );
  const selectedSubTriggers = useMemo(
    () => selectedMainTriggerId ? (availableChildrenByParent[String(selectedMainTriggerId)] || []) : [],
    [availableChildrenByParent, selectedMainTriggerId]
  );

  const selectedTestForTriggers = useMemo(() => {
    if (!safeTests.length || selectedTriggerIds.length === 0) return null;

    const selectedTriggers = availableTriggers.filter((trigger) =>
      selectedTriggerIds.includes(String(trigger.id))
    );
    const selectedSlugs = selectedTriggers.map((trigger) => trigger.slug);
    const selectedParentIds = selectedTriggers
      .map((trigger) => trigger.parent_id)
      .filter(Boolean)
      .map(String);
    const isSpecialTrainingSelection = selectedSlugs.length > 0 &&
      selectedSlugs.every((slug) => VARIABLE_QUESTION_COUNT_SLUGS.has(slug));

    if (isSpecialTrainingSelection) {
      const parentTest = safeTests.find((test) =>
        (Array.isArray(test?.triggers) ? test.triggers : []).some(
          (trigger) => trigger.slug === SPECIAL_TRAINING_SLUG
        )
      );
      if (parentTest) return parentTest;
    }

    if (selectedParentIds.length > 0) {
      const parentTest = safeTests.find((test) => {
        const triggerIds = new Set(
          (Array.isArray(test?.triggers) ? test.triggers : []).map((trigger) => String(trigger.id))
        );
        return selectedParentIds.every((triggerId) => triggerIds.has(triggerId));
      });
      if (parentTest) return parentTest;
    }

    return safeTests.find((test) => {
      const triggerIds = new Set(
        (Array.isArray(test?.triggers) ? test.triggers : []).map((trigger) => String(trigger.id))
      );
      return selectedTriggerIds.every((triggerId) => triggerIds.has(String(triggerId)));
    }) || null;
  }, [availableTriggers, safeTests, selectedTriggerIds]);

  useEffect(() => {
    answersRef.current = answers || {};
  }, [answers]);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [testsRes, triggersRes] = await Promise.all([
        axios.get(`${API_URL}/student/tests/`, {
          headers: getAuthHeaders(),
        }),
        axios.get(`${API_URL}/triggers/`, {
          headers: getAuthHeaders(),
        }),
      ]);

      const loadedTests = extractArray(testsRes.data, 'tests');
      const loadedTriggers = extractArray(triggersRes.data, 'triggers').filter(isVisibleTestingCategory);

      console.log('[testing] available tests API response', testsRes.data);
      console.log('[testing] triggers API response', triggersRes.data);
      console.log('[testing] visible categories', loadedTriggers.map((trigger) => ({
        id: trigger.id,
        slug: trigger.slug,
        name: trigger.name,
        question_count: getTriggerQuestionCount(trigger),
      })));

      setTests(loadedTests);
      setCategoryTriggers(loadedTriggers);

      if (!loadedTriggers.length) {
        setQuestions([]);
        setError(t('Нет доступных категорий тестирования'));
        return;
      }

    } catch (err) {
      setQuestions([]);
      const errorMessage = getErrorMessage(err, 'Ошибка загрузки вопросов');
      setError(t(errorMessage));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const startSelectedTest = async () => {
    const selectedCategories = availableTriggers
      .filter((trigger) => selectedTriggerIds.includes(String(trigger.id)))
      .map((trigger) => ({
        id: trigger.id,
        slug: trigger.slug,
        name: trigger.name,
        parent_id: trigger.parent_id,
        question_count: getTriggerQuestionCount(trigger),
      }));

    console.log('[testing] selected categories', selectedCategories);

    if (selectedTriggerIds.length === 0) {
      setError(t('Выберите хотя бы одну категорию тестирования'));
      return;
    }

    const questionError = getSelectedCategoriesQuestionError(selectedCategories);
    if (questionError) {
      setError(t(questionError));
      return;
    }

    if (!selectedTestForTriggers?.id) {
      setError(t('Нет доступного теста для выбранных категорий'));
      return;
    }

    const triggerIds = selectedTriggerIds.map(Number);

    setSubmitting(true);
    setError(null);

    try {
      localStorage.setItem(
        ACTIVE_TEST_CONFIG_STORAGE_KEY,
        JSON.stringify({ testId: selectedTestForTriggers.id, triggerIds })
      );

      const response = await axios.post(
        `${API_URL}/student/tests/${selectedTestForTriggers.id}/start/`,
        { trigger_ids: triggerIds, language },
        { headers: getAuthHeaders() }
      );

      const newAttemptId = response.data?.attempt?.id;
      if (!newAttemptId) {
        throw new Error('Attempt was not created');
      }

      localStorage.setItem('activeTestAttemptId', String(newAttemptId));
      navigate(`/test/${newAttemptId}`, { replace: true });
    } catch (err) {
      localStorage.removeItem(ACTIVE_TEST_CONFIG_STORAGE_KEY);
      const errorMessage = getErrorMessage(err, 'Не удалось начать тест');
      setError(t(errorMessage));
    } finally {
      setSubmitting(false);
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

      logout(attemptId);
      navigate('/login', { replace: true });
    } catch (err) {
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
      const nextRemaining = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0 && !submittedRef.current) {
        setError(t('Время вышло. Тест автоматически завершается с текущими ответами.'));
        completeTest({ timedOut: true });
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, [completeTest, deadlineMs, loading, submitting, t]);

  useEffect(() => {
    console.log("TIMER:", remainingSeconds, formatTime(remainingSeconds));
  }, [remainingSeconds]);

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
                <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">
                      {t('triggers.trigger')}
                    </label>
                    <select
                      className="input-modern bg-white"
                      value={selectedMainTriggerId}
                      onChange={(e) => {
                        const triggerId = e.target.value;
                        setSelectedMainTriggerId(triggerId);
                        setSelectedSubTriggerId('');
                        setSelectedTriggerIds(triggerId ? [triggerId] : []);
                      }}
                    >
                      <option value="">{t('triggers.select_trigger')}</option>
                      {availableTriggerCards.map((trigger) => (
                        <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>
                      ))}
                    </select>
                  </div>

                  {selectedMainTrigger && (
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">
                        {t('triggers.subtrigger')}
                      </label>
                      {selectedSubTriggers.length > 0 ? (
                        <select
                          className="input-modern bg-white"
                          value={selectedSubTriggerId}
                          onChange={(e) => {
                            const subTriggerId = e.target.value;
                            setSelectedSubTriggerId(subTriggerId);
                            setSelectedTriggerIds([subTriggerId || selectedMainTriggerId].filter(Boolean));
                          }}
                        >
                          <option value="">{t('triggers.select_subtrigger')}</option>
                          {selectedSubTriggers.map((trigger) => (
                            <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600">
                          {t('triggers.no_subtriggers')}
                        </div>
                      )}
                    </div>
                  )}
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
  const progressPercent = Math.max(
    0,
    Math.min(100, (remainingSeconds / TOTAL_TIME) * 100)
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

        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" data-no-translate>
          <div className="flex items-center justify-between" data-no-translate>
            <span className="text-sm font-semibold text-red-700">
              {t('Обратный отсчет')}
            </span>
            <span className="font-mono text-2xl font-bold text-red-700" data-no-translate>
              {formatTime(remainingSeconds)}
            </span>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-red-100" data-no-translate>
            <div
              className="h-full rounded-full bg-red-600 transition-all duration-1000 ease-linear"
              style={{ width: `${progressPercent}%` }}
              data-no-translate
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
                                className={`flex w-full cursor-pointer items-start gap-2 rounded-xl border-2 p-3 text-left whitespace-normal break-words transition-colors ${
                                  isSelected
                                    ? 'bg-green-500 text-white border-green-500'
                                    : 'bg-gray-50 hover:bg-gray-100 border-transparent'
                                }`}
                                onClick={() => selectAnswer(question.id, answerKey)}
                              >
                                <span className={`flex-none ${isSelected ? 'text-white' : 'text-gray-700'}`}>
                                  {answer.key})
                                </span>
                                <span className={`min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] ${isSelected ? 'text-white' : 'text-gray-700'}`}>
                                  {answer.text}
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

