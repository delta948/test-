import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import API_URL from '../config/api';
import useTestContentProtection from '../hooks/useTestContentProtection';

const TOTAL_TIME = 3000; // 50 минут

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;

  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return value;
  }
  return '';
};

const getText = (item, lang) => {
  if (!item) return '';
  if (typeof item === 'string') return item;

  if (lang === 'ru') return firstText(item.text_ru, item.question_ru, item.text);
  if (lang === 'ky') return firstText(item.text_ky, item.text_kg, item.question_ky, item.question_kg, item.text);
  return firstText(item.text);
};

const normalizeAnswers = (question) => {
  if (!question) return [];

  if (Array.isArray(question.answers) && question.answers.length) {
    return question.answers
      .map((answer, index) => ({
        ...answer,
        key: String.fromCharCode(65 + index),
        original_key: answer.original_key || answer.key || answer.letter || String.fromCharCode(65 + index),
        text: answer.text || '',
      }))
      .filter((answer) => getText(answer, 'ru') || getText(answer, 'ky'));
  }

  const localizedOptions =
    question.options ||
    question.options_ru ||
    question.options_ky ||
    question.options_kg ||
    question.answers_ru ||
    question.answers_ky ||
    question.answers_kg ||
    question.variants_ru ||
    question.variants_ky ||
    question.variants_kg;

  if (Array.isArray(localizedOptions) && localizedOptions.length) {
    return localizedOptions
      .map((option, index) => ({
        ...(typeof option === 'object' ? option : {}),
        key: String.fromCharCode(65 + index),
        original_key:
          typeof option === 'object'
            ? option.original_key || option.key || option.letter || String.fromCharCode(65 + index)
            : String.fromCharCode(65 + index),
        text: typeof option === 'object' ? option.text || '' : option,
      }))
      .filter((answer) => getText(answer, 'ru') || getText(answer, 'ky'));
  }

  return [
    {
      key: 'A',
      original_key: 'A',
      text: firstText(question.option_a, question.answer_a, question.a),
      text_ru: firstText(question.option_a_ru, question.answer_a_ru, question.a_ru),
      text_ky: firstText(question.option_a_ky, question.option_a_kg, question.answer_a_ky, question.answer_a_kg, question.a_ky, question.a_kg),
    },
    {
      key: 'B',
      original_key: 'B',
      text: firstText(question.option_b, question.answer_b, question.b),
      text_ru: firstText(question.option_b_ru, question.answer_b_ru, question.b_ru),
      text_ky: firstText(question.option_b_ky, question.option_b_kg, question.answer_b_ky, question.answer_b_kg, question.b_ky, question.b_kg),
    },
    {
      key: 'C',
      original_key: 'C',
      text: firstText(question.option_c, question.answer_c, question.c),
      text_ru: firstText(question.option_c_ru, question.answer_c_ru, question.c_ru),
      text_ky: firstText(question.option_c_ky, question.option_c_kg, question.answer_c_ky, question.answer_c_kg, question.c_ky, question.c_kg),
    },
    {
      key: 'D',
      original_key: 'D',
      text: firstText(question.option_d, question.answer_d, question.d),
      text_ru: firstText(question.option_d_ru, question.answer_d_ru, question.d_ru),
      text_ky: firstText(question.option_d_ky, question.option_d_kg, question.answer_d_ky, question.answer_d_kg, question.d_ky, question.d_kg),
    },
  ].filter((answer) => getText(answer, 'ru') || getText(answer, 'ky'));
};

const TimerPanel = ({ remainingSeconds, answeredCount, totalCount, t }) => {
  const timerPercent = Math.max(0, Math.min(100, (remainingSeconds / TOTAL_TIME) * 100));
  const answeredPercent = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;

  return (
    <div className="sticky top-4 z-20 mb-6 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm" data-no-translate>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-no-translate>
        <div>
          <p className="text-sm font-semibold text-red-700">{t('Обратный отсчет')}</p>
          <p className="text-xs text-gray-600">
            {t('Отвечено')}:{' '}
            <span className="font-semibold text-green-700">{answeredCount}</span> / {totalCount || 100} ({answeredPercent}%)
          </p>
        </div>

        <span className="font-mono text-2xl font-bold text-red-700" data-no-translate>
          {formatTime(remainingSeconds)}
        </span>
      </div>

      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-red-100" data-no-translate>
        <div
          className="h-full rounded-full bg-red-600 transition-all duration-1000 ease-linear"
          style={{ width: `${timerPercent}%` }}
          data-no-translate
        />
      </div>
    </div>
  );
};

const TestPage = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, t } = useLanguage();
  const selectedLanguage = language;

  useTestContentProtection();

  const [questions, setQuestions] = useState([]);
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingQuestionId, setSavingQuestionId] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(TOTAL_TIME);

  const submittedRef = useRef(false);

  const localizedQuestions = useMemo(() => {
    return questions.map((question) => ({
      ...question,
      answers: normalizeAnswers(question),
    }));
  }, [questions]);

  const answeredCount = answeredQuestions.length;

  const completeTest = useCallback(
    async ({ timedOut = false } = {}) => {
      if (submittedRef.current) return;

      submittedRef.current = true;
      setCompleting(true);
      setCompletionError('');

      try {
        await axios.post(`${API_URL}/student/attempts/${attemptId}/complete/`, {
          timed_out: timedOut,
        });

        logout(attemptId);
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
    },
    [attemptId, logout, navigate, t]
  );

  const fetchTestData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const response = await axios.get(
        `${API_URL}/student/attempts/${attemptId}/questions/?lang=${language}`
      );

      const apiQuestions = Array.isArray(response.data?.questions)
        ? response.data.questions
        : [];

      const answeredIds = Array.isArray(response.data?.answered_question_ids)
        ? response.data.answered_question_ids
        : [];

      const savedSelectedAnswers = response.data?.selected_answers || {};
      const expiresAt = response.data?.expires_at;

      setQuestions(apiQuestions);
      setAnsweredQuestions(answeredIds);
      setSelectedAnswers(savedSelectedAnswers);
      setShowCorrectAnswers(Boolean(response.data?.show_correct_answers));

      if (expiresAt) {
        setRemainingSeconds(
          Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000))
        );
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        t('Ошибка загрузки теста');

      setError(t(errorMsg));

      if (err.response?.status === 404) {
        setTimeout(() => {
          navigate('/student/dashboard', { replace: true });
        }, 2000);
      }
    } finally {
      setLoading(false);
    }
  }, [attemptId, language, navigate, t]);

  useEffect(() => {
    fetchTestData();
  }, [fetchTestData]);

  useEffect(() => {
    if (loading || completing) return undefined;

    const interval = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);

          if (!submittedRef.current) {
            setCompletionError(t('Время вышло. Тест автоматически завершается.'));
            completeTest({ timedOut: true });
          }

          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [completeTest, completing, loading, t]);

  const submitAnswer = useCallback(
    async (question, selectedOption) => {
      if (!question?.id || !selectedOption || savingQuestionId === question.id || completing) {
        return;
      }

      setSelectedAnswers((prev) => ({
        ...prev,
        [question.id]: selectedOption,
      }));

      setAnsweredQuestions((prev) => [...new Set([...prev, question.id])]);
      setSavingQuestionId(question.id);
      setError('');

      try {
        await axios.post(`${API_URL}/student/attempts/${attemptId}/answer/`, {
          question_id: question.id,
          selected_option: selectedOption,
        });
      } catch (err) {
        const errorMsg =
          err.response?.data?.error ||
          err.response?.data?.detail ||
          t('Ошибка при сохранении ответа');

        setError(t(errorMsg));

        if (
          errorMsg.includes('Время теста истекло') ||
          errorMsg.includes('Тесттин убактысы бүттү')
        ) {
          setTimeout(() => {
            navigate('/student/dashboard', { replace: true });
          }, 1200);
        }
      } finally {
        setSavingQuestionId(null);
      }
    },
    [attemptId, completing, navigate, savingQuestionId, t]
  );

  const handleCompleteClick = useCallback(() => {
    setCompletionError('');

    if (answeredCount < 1) {
      setCompletionError(t('Ответьте хотя бы на один вопрос, чтобы завершить тест'));
      return;
    }

    completeTest();
  }, [answeredCount, completeTest, t]);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
        <p className="mt-4 text-gray-600 font-medium">
          {t('Загрузка теста...')}
        </p>
      </div>
    );
  }

  if (error && questions.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-2xl">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="protected-test-content mx-auto max-w-4xl px-4 pb-10">
      <TimerPanel
        remainingSeconds={remainingSeconds}
        answeredCount={answeredCount}
        totalCount={localizedQuestions.length}
        t={t}
      />

      {completionError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-red-700">{completionError}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {showCorrectAnswers && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800" data-no-translate>
            Training mode: correct answers are highlighted.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {localizedQuestions.map((question, index) => {
          const answers = question.answers || [];
          const selectedAnswer = selectedAnswers[question.id];
          const isSavingThisQuestion = savingQuestionId === question.id;

          return (
            <div
              key={question.id || index}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                  <span className="text-sm font-semibold text-green-600">
                    {index + 1}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="mb-4 font-semibold leading-relaxed text-gray-900" data-no-translate>
                    {getText(question, selectedLanguage)}
                  </h3>

                  <div className="space-y-2">
                    {answers.map((answer) => {
                      const answerKey = answer.original_key || answer.key;
                      const isSelected = selectedAnswer === answerKey;
                      const isCorrectAnswer = showCorrectAnswers && question.correct_answer === answerKey;

                      return (
                        <button
                          key={`${question.id}-${answer.key}`}
                          type="button"
                          className={`flex w-full items-start gap-2 rounded-xl border-2 p-3 text-left whitespace-normal break-words transition-colors ${
                            isSelected
                              ? 'border-green-500 bg-green-500 text-white'
                              : isCorrectAnswer
                              ? 'border-gray-100 bg-gray-50 text-gray-500'
                              : 'border-transparent bg-gray-50 text-gray-700 hover:bg-gray-100'
                          }`}
                          onClick={() => submitAnswer(question, answerKey)}
                          disabled={isSavingThisQuestion || completing}
                        >
                          <span className={`flex-none ${isSelected ? 'text-white' : isCorrectAnswer ? 'text-gray-400' : 'text-gray-700'}`} data-no-translate>
                            {answer.key})
                          </span>
                          <span className={`min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] ${isSelected ? 'text-white' : isCorrectAnswer ? 'text-gray-500' : 'text-gray-700'}`} data-no-translate>
                            {getText(answer, selectedLanguage)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {answers.length === 0 && (
                    <p className="text-sm text-red-600">
                      {t('Нет вариантов ответа для этого вопроса')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          className={`rounded-xl px-8 py-3 font-medium transition-colors ${
            completing || answeredCount < 1
              ? 'cursor-not-allowed bg-gray-300 text-gray-500'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
          onClick={handleCompleteClick}
          disabled={completing || answeredCount < 1}
        >
          {completing ? t('Завершение...') : t('Завершить тест')}
        </button>
      </div>
    </div>
  );
};

export default TestPage;
