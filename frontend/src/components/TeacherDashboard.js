import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const TeacherDashboard = () => {
  const [questions, setQuestions] = useState([]);
  const [tests, setTests] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('results');
  const navigate = useNavigate();
  const [isMainTeacher, setIsMainTeacher] = useState(false);
  
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
  
  const [newTeacher, setNewTeacher] = useState({
    username: '',
    first_name: '',
    last_name: '',
    password: ''
  });
  const [showCreateTeacher, setShowCreateTeacher] = useState(false);

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
      
      // Проверяем, является ли пользователь главным учителем
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      setIsMainTeacher(user.is_main_teacher || false);
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
    } catch (error) {
      console.error('Error creating question:', error);
    }
  };

  const handleDeleteQuestion = async (id) => {
    try {
      await axios.delete(`${API_URL}/questions/${id}/`);
      fetchData();
    } catch (error) {
      console.error('Error deleting question:', error);
    }
  };

  const handleCreateTest = async (e) => {
    e.preventDefault();
    
    if (selectedQuestions.length !== 100) {
      console.error(`Необходимо выбрать ровно 100 вопросов. Выбрано: ${selectedQuestions.length}`);
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
    } catch (error) {
      console.error('Error creating test:', error);
    }
  };

  const handleCreateTeacher = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/teacher/create-teacher/`, newTeacher, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      setNewTeacher({
        username: '',
        first_name: '',
        last_name: '',
        password: ''
      });
      setShowCreateTeacher(false);
      alert('Учитель успешно создан');
    } catch (error) {
      console.error('Error creating teacher:', error);
      alert('Ошибка создания учителя');
    }
  };

  const toggleQuestionSelection = (id) => {
    if (selectedQuestions.includes(id)) {
      setSelectedQuestions(selectedQuestions.filter(q => q !== id));
    } else {
      if (selectedQuestions.length < 100) {
        setSelectedQuestions([...selectedQuestions, id]);
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
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'results' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setActiveTab('results')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Результаты
          </span>
        </button>
        {isMainTeacher && (
          <button 
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'teachers' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setActiveTab('teachers')}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Учителя
            </span>
          </button>
        )}
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
          <h4 className="text-xl font-semibold text-gray-900 mb-4">Результаты учеников</h4>
          {results.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
              <p className="text-gray-900 font-medium text-lg">Нет результатов</p>
              <p className="text-sm text-gray-500 mt-2">Ученики ещё не прошли тесты</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ученик</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Тест</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Результат</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Процент</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Оценка</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Дата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {results.map(result => {
                    const percentage = result.total_questions > 0 
                      ? Math.round((result.score / result.total_questions) * 100) 
                      : 0;
                    let grade = 'Неудовлетворительно';
                    let gradeColor = 'text-red-600 bg-red-50';
                    if (percentage >= 90) {
                      grade = 'Отлично';
                      gradeColor = 'text-green-600 bg-green-50';
                    } else if (percentage >= 70) {
                      grade = 'Хорошо';
                      gradeColor = 'text-blue-600 bg-blue-50';
                    } else if (percentage >= 50) {
                      grade = 'Удовлетворительно';
                      gradeColor = 'text-yellow-600 bg-yellow-50';
                    }
                    return (
                      <tr key={result.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{result.student_name}</div>
                          <div className="text-sm text-gray-500">@{result.student_username}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {result.test_title}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            percentage >= 70 ? 'bg-green-100 text-green-800' : percentage >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {result.score} / {result.total_questions}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {percentage}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${gradeColor}`}>
                            {grade}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {result.completed_at ? new Date(result.completed_at).toLocaleString('ru-RU') : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'teachers' && isMainTeacher && (
        <div>
          <div className="mb-4">
            <button 
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
              onClick={() => setShowCreateTeacher(!showCreateTeacher)}
            >
              {showCreateTeacher ? 'Отмена' : 'Создать учителя'}
            </button>
          </div>
          
          {showCreateTeacher && (
            <div className="glass-card rounded-2xl p-6 mb-6">
              <h4 className="text-xl font-semibold text-gray-900 mb-4">Создать нового учителя</h4>
              <form onSubmit={handleCreateTeacher} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Логин</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newTeacher.username}
                    onChange={(e) => setNewTeacher({...newTeacher, username: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Имя</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newTeacher.first_name}
                    onChange={(e) => setNewTeacher({...newTeacher, first_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Фамилия</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newTeacher.last_name}
                    onChange={(e) => setNewTeacher({...newTeacher, last_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Пароль</label>
                  <input
                    type="password"
                    className="input-modern"
                    value={newTeacher.password}
                    onChange={(e) => setNewTeacher({...newTeacher, password: e.target.value})}
                    required
                    minLength="6"
                  />
                </div>
                <button 
                  type="submit"
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  Создать учителя
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
