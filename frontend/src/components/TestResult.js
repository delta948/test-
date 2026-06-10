import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { localizeQuestion, useLanguage } from '../context/LanguageContext';

const API_URL = 'http://localhost:8000/api';

const TestResult = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, t } = useLanguage();
  
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, language]);

  const fetchResult = async () => {
    try {
      const response = await axios.get(`${API_URL}/student/attempts/${attemptId}/result/?lang=${language}`);
      setResult(response.data);
      setLoading(false);
    } catch (error) {
      const errorMsg = error.response?.data?.error || t('Не удалось загрузить результат');
      setError(t(errorMsg));
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

  const getScoreColor = (score, total) => {
    const percentage = (score / total) * 100;
    if (percentage >= 80) return 'text-success';
    if (percentage >= 60) return 'text-warning';
    return 'text-danger';
  };

  const getScoreMessage = (score, total) => {
    const percentage = (score / total) * 100;
    if (percentage >= 80) return t('Отличный результат!');
    if (percentage >= 60) return t('Хороший результат!');
    if (percentage >= 40) return t('Удовлетворительно');
    return t('Попробуйте еще раз');
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">{t('Загрузка...')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!result) return null;

  const { attempt, correct_count, total_questions } = result;
  const percentage = Math.round((correct_count / total_questions) * 100);

  return (
    <div className="container">
      <div className="result-display">
        <div className="card shadow">
          <div className="card-body p-5">
            <h2 className="mb-4">{t('Результаты теста')}</h2>
            
            <div className="mb-4">
              <h4>{t(attempt.test.title)}</h4>
              <p className="text-muted">
                {t('Завершен')}: {attempt.completed_at ? new Date(attempt.completed_at).toLocaleString() : '-'}
              </p>
            </div>

            <div className={`display-1 fw-bold mb-3 ${getScoreColor(correct_count, total_questions)}`}>
              {correct_count} / {total_questions}
            </div>

            <div className="progress mb-4" style={{ height: '30px' }}>
              <div 
                className={`progress-bar ${percentage >= 60 ? 'bg-success' : percentage >= 40 ? 'bg-warning' : 'bg-danger'}`}
                role="progressbar"
                style={{ width: `${percentage}%` }}
              >
                {percentage}%
              </div>
            </div>

            <h4 className={`mb-4 ${getScoreColor(correct_count, total_questions)}`}>
              {getScoreMessage(correct_count, total_questions)}
            </h4>

            <div className="row mt-4">
              <div className="col-md-4">
                <div className="stats-card">
                  <h3>{correct_count}</h3>
                  <p>{t('answers.correct_answers')}</p>
                </div>
              </div>
              <div className="col-md-4">
                <div className="stats-card" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
                  <h3>{total_questions - correct_count}</h3>
                  <p>{t('answers.incorrect_answers')}</p>
                </div>
              </div>
              <div className="col-md-4">
                <div className="stats-card" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
                  <h3>{total_questions}</h3>
                  <p>{t('Всего вопросов')}</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {attempt.answers && attempt.answers.length > 0 && (
        <div className="dashboard-card mt-4">
          <h5 className="mb-3">{t('Детальный разбор')}</h5>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Вопрос')}</th>
                  <th>{t('Ваш ответ')}</th>
                  <th>{t('Результат')}</th>
                </tr>
              </thead>
              <tbody>
                {attempt.answers.map((answer, index) => (
                  <tr key={answer.id}>
                    <td>{index + 1}</td>
                    <td>{localizeQuestion(answer.question, language).text.substring(0, 50)}...</td>
                    <td>
                      <span className="badge bg-secondary">{answer.selected_option}</span>
                    </td>
                    <td>
                      {answer.is_correct ? (
                        <span className="badge bg-success">{t('Правильно')}</span>
                      ) : (
                        <span className="badge bg-danger">{t('Неправильно')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestResult;
