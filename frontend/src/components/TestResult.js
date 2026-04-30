import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const TestResult = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchResult();
  }, [attemptId]);

  const fetchResult = async () => {
    try {
      const response = await axios.get(`${API_URL}/student/attempts/${attemptId}/result/`);
      setResult(response.data);
      setLoading(false);
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Ошибка загрузки результата';
      setError(errorMsg);
      setLoading(false);
    }
  };

  const getScoreColor = (score, total) => {
    const percentage = (score / total) * 100;
    if (percentage >= 80) return 'text-success';
    if (percentage >= 60) return 'text-warning';
    return 'text-danger';
  };

  const getScoreMessage = (score, total) => {
    const percentage = (score / total) * 100;
    if (percentage >= 80) return 'Отличный результат!';
    if (percentage >= 60) return 'Хороший результат!';
    if (percentage >= 40) return 'Удовлетворительно';
    return 'Попробуйте еще раз';
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Загрузка...</span>
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
        <button className="btn btn-primary" onClick={() => navigate('/student/dashboard')}>
          На главную
        </button>
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
            <h2 className="mb-4">Результаты теста</h2>
            
            <div className="mb-4">
              <h4>{attempt.test.title}</h4>
              <p className="text-muted">
                Завершен: {attempt.completed_at ? new Date(attempt.completed_at).toLocaleString() : '-'}
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
                  <p>Правильных ответов</p>
                </div>
              </div>
              <div className="col-md-4">
                <div className="stats-card" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
                  <h3>{total_questions - correct_count}</h3>
                  <p>Неправильных ответов</p>
                </div>
              </div>
              <div className="col-md-4">
                <div className="stats-card" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
                  <h3>{total_questions}</h3>
                  <p>Всего вопросов</p>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <button 
                className="btn btn-primary btn-lg me-3"
                onClick={() => navigate('/student/dashboard')}
              >
                Вернуться на главную
              </button>
            </div>
          </div>
        </div>
      </div>

      {attempt.answers && attempt.answers.length > 0 && (
        <div className="dashboard-card mt-4">
          <h5 className="mb-3">Детальный разбор</h5>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Вопрос</th>
                  <th>Ваш ответ</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {attempt.answers.map((answer, index) => (
                  <tr key={answer.id}>
                    <td>{index + 1}</td>
                    <td>{answer.question.text.substring(0, 50)}...</td>
                    <td>
                      <span className="badge bg-secondary">{answer.selected_option}</span>
                    </td>
                    <td>
                      {answer.is_correct ? (
                        <span className="badge bg-success">Правильно</span>
                      ) : (
                        <span className="badge bg-danger">Неправильно</span>
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
