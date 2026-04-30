import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const TeacherDashboard = () => {
  const [questions, setQuestions] = useState([]);
  const [tests, setTests] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('tests');
  
  const [newQuestion, setNewQuestion] = useState({
    text: '',
    option_a: '',
    option_b: '',
    option_c: '',
    correct_answer: 'A'
  });
  
  const [newTest, setNewTest] = useState({
    title: ''
  });
  const [selectedQuestions, setSelectedQuestions] = useState([]);
  const [showCreateTest, setShowCreateTest] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [questionsRes, testsRes, resultsRes] = await Promise.all([
        axios.get(`${API_URL}/questions/`),
        axios.get(`${API_URL}/tests/`),
        axios.get(`${API_URL}/teacher/results/`)
      ]);
      
      setQuestions(questionsRes.data);
      setTests(testsRes.data);
      setResults(resultsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuestion = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/questions/`, newQuestion);
      setNewQuestion({
        text: '',
        option_a: '',
        option_b: '',
        option_c: '',
        correct_answer: 'A'
      });
      fetchData();
      alert('Вопрос создан успешно!');
    } catch (error) {
      alert('Ошибка при создании вопроса');
    }
  };

  const handleDeleteQuestion = async (id) => {
    if (!window.confirm('Удалить этот вопрос?')) return;
    
    try {
      await axios.delete(`${API_URL}/questions/${id}/`);
      fetchData();
      alert('Вопрос удален!');
    } catch (error) {
      alert('Ошибка при удалении вопроса');
    }
  };

  const handleCreateTest = async (e) => {
    e.preventDefault();
    
    if (selectedQuestions.length !== 100) {
      alert(`Необходимо выбрать ровно 100 вопросов. Выбрано: ${selectedQuestions.length}`);
      return;
    }
    
    try {
      await axios.post(`${API_URL}/tests/`, {
        title: newTest.title,
        question_ids: selectedQuestions
      });
      
      setNewTest({ title: '' });
      setSelectedQuestions([]);
      setShowCreateTest(false);
      fetchData();
      alert('Тест создан успешно с 100 вопросами!');
    } catch (error) {
      alert('Ошибка при создании теста: ' + (error.response?.data?.question_ids?.[0] || ''));
    }
  };

  const toggleQuestionSelection = (id) => {
    if (selectedQuestions.includes(id)) {
      setSelectedQuestions(selectedQuestions.filter(q => q !== id));
    } else {
      if (selectedQuestions.length < 100) {
        setSelectedQuestions([...selectedQuestions, id]);
      } else {
        alert('Можно выбрать максимум 100 вопросов');
      }
    }
  };

  const selectRandom100 = () => {
    const shuffled = [...questions].sort(() => 0.5 - Math.random());
    setSelectedQuestions(shuffled.slice(0, 100).map(q => q.id));
  };

  const selectAll = () => {
    if (questions.length >= 100) {
      setSelectedQuestions(questions.slice(0, 100).map(q => q.id));
    } else {
      alert(`Недостаточно вопросов. Есть только ${questions.length} вопросов.`);
    }
  };

  const clearSelection = () => {
    setSelectedQuestions([]);
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Панель учителя</h1>
        <p className="text-gray-500 mt-1">Управляйте тестами и просматривайте результаты учеников</p>
      </div>
      
      <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-xl">
        <button 
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'tests' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setActiveTab('tests')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Тесты
          </span>
        </button>
        <button 
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'questions' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setActiveTab('questions')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Вопросы ({questions.length})
          </span>
        </button>
        <button 
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'results' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setActiveTab('results')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Результаты
          </span>
        </button>
      </div>

      {activeTab === 'tests' && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h4>Список тестов</h4>
            <button 
              className="btn btn-success"
              onClick={() => setShowCreateTest(!showCreateTest)}
            >
              {showCreateTest ? 'Отмена' : 'Создать тест'}
            </button>
          </div>

          {showCreateTest && (
            <div className="dashboard-card mb-4">
              <h5>Создание теста (100 вопросов)</h5>
              <form onSubmit={handleCreateTest}>
                <div className="mb-3">
                  <label className="form-label">Название теста</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newTest.title}
                    onChange={(e) => setNewTest({...newTest, title: e.target.value})}
                    required
                    placeholder="Введите название теста"
                  />
                </div>
                
                <div className="mb-3">
                  <label className="form-label">
                    Выбрано вопросов: {selectedQuestions.length} / 100
                  </label>
                  <div className="mb-2">
                    <button type="button" className="btn btn-sm btn-outline-primary me-2" onClick={selectAll}>
                      Выбрать первые 100
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-secondary me-2" onClick={selectRandom100}>
                      Случайные 100
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={clearSelection}>
                      Очистить
                    </button>
                  </div>
                  <div className="border rounded p-3" style={{maxHeight: '300px', overflowY: 'auto'}}>
                    {questions.map(q => (
                      <div key={q.id} className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id={`q-${q.id}`}
                          checked={selectedQuestions.includes(q.id)}
                          onChange={() => toggleQuestionSelection(q.id)}
                        />
                        <label className="form-check-label" htmlFor={`q-${q.id}`}>
                          #{q.id} {q.text.substring(0, 60)}...
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={selectedQuestions.length !== 100 || !newTest.title}
                >
                  Создать тест
                </button>
              </form>
            </div>
          )}

          {tests.length === 0 ? (
            <div className="empty-state">
              <p>Нет созданных тестов</p>
            </div>
          ) : (
            tests.map(test => (
              <div key={test.id} className="dashboard-card">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h5>{test.title}</h5>
                    <small className="text-muted">
                      {test.question_count} вопросов | Создан: {new Date(test.created_at).toLocaleDateString()}
                    </small>
                  </div>
                  <span className={`badge ${test.is_active ? 'bg-success' : 'bg-secondary'}`}>
                    {test.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'questions' && (
        <div>
          <div className="dashboard-card mb-4">
            <h5>Создать новый вопрос</h5>
            <form onSubmit={handleCreateQuestion}>
              <div className="mb-3">
                <label className="form-label">Текст вопроса</label>
                <textarea
                  className="form-control"
                  rows="2"
                  value={newQuestion.text}
                  onChange={(e) => setNewQuestion({...newQuestion, text: e.target.value})}
                  required
                  placeholder="Введите текст вопроса"
                />
              </div>
              
              <div className="row">
                <div className="col-md-4 mb-3">
                  <label className="form-label">Вариант A</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newQuestion.option_a}
                    onChange={(e) => setNewQuestion({...newQuestion, option_a: e.target.value})}
                    required
                    placeholder="Вариант A"
                  />
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label">Вариант B</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newQuestion.option_b}
                    onChange={(e) => setNewQuestion({...newQuestion, option_b: e.target.value})}
                    required
                    placeholder="Вариант B"
                  />
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label">Вариант C</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newQuestion.option_c}
                    onChange={(e) => setNewQuestion({...newQuestion, option_c: e.target.value})}
                    required
                    placeholder="Вариант C"
                  />
                </div>
              </div>
              
              <div className="mb-3">
                <label className="form-label">Правильный ответ</label>
                <select
                  className="form-select"
                  value={newQuestion.correct_answer}
                  onChange={(e) => setNewQuestion({...newQuestion, correct_answer: e.target.value})}
                >
                  <option value="A">Вариант A</option>
                  <option value="B">Вариант B</option>
                  <option value="C">Вариант C</option>
                </select>
              </div>
              
              <button type="submit" className="btn btn-primary">
                Создать вопрос
              </button>
            </form>
          </div>

          <h5>Все вопросы ({questions.length})</h5>
          {questions.length === 0 ? (
            <div className="empty-state">
              <p>Нет созданных вопросов</p>
            </div>
          ) : (
            questions.map(q => (
              <div key={q.id} className="dashboard-card">
                <div className="d-flex justify-content-between">
                  <div>
                    <h6>#{q.id} {q.text}</h6>
                    <small className="text-muted">
                      A: {q.option_a} | B: {q.option_b} | C: {q.option_c} | 
                      Правильный: <strong>{q.correct_answer}</strong>
                    </small>
                  </div>
                  <button 
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteQuestion(q.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <div>
          <h4>Результаты учеников</h4>
          {results.length === 0 ? (
            <div className="empty-state">
              <p>Нет результатов</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Тест</th>
                    <th>Результат</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(result => (
                    <tr key={result.id}>
                      <td>{result.student_name} ({result.student_username})</td>
                      <td>{result.test_title}</td>
                      <td>
                        <span className={`badge ${result.score >= 70 ? 'bg-success' : result.score >= 50 ? 'bg-warning' : 'bg-danger'}`}>
                          {result.score} / 100
                        </span>
                      </td>
                      <td>{result.completed_at ? new Date(result.completed_at).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
