import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API_URL = 'http://localhost:8000/api';

const extractArray = (data, key) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.results)) return data.results;
  return [];
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const sanitizeFilename = (value) =>
  String(value || 'student-test')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);

const printPdfDocument = (html, filename) => {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    alert('Разрешите всплывающие окна, чтобы сохранить PDF.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html.replace('<head>', `<head><title>${escapeHtml(filename)}</title>`));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
};

const formatDateFilter = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('ru-RU');
};

const normalizeDateInput = (value) =>
  value
    .replace(/[^\d.]/g, '')
    .replace(/^(\d{2})(?=\d)/, '$1.')
    .replace(/^(\d{2}\.\d{2})(?=\d)/, '$1.')
    .slice(0, 10);

const TeacherDashboard = () => {
  const { user } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [tests, setTests] = useState([]);
  const [results, setResults] = useState([]);
  const [selectedResultDetail, setSelectedResultDetail] = useState(null);
  const [loadingResultDetail, setLoadingResultDetail] = useState(false);
  const [resultFilters, setResultFilters] = useState({
    date: ''
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('results');
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
  const [showTeacherList, setShowTeacherList] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const canManageTeachers =
    user?.is_staff ||
    user?.is_superuser ||
    user?.role === 'admin' ||
    (user?.role === 'teacher' && isMainTeacher);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [questionsRes, testsRes, resultsRes] = await Promise.all([
        axios.get(`${API_URL}/questions/`),
        axios.get(`${API_URL}/tests/`),
        axios.get(`${API_URL}/teacher/results/`)
      ]);

      console.log('user:', user);
      console.log('questions API response:', questionsRes.data);
      console.log('tests API response:', testsRes.data);
      console.log('results API response:', resultsRes.data);

      const loadedQuestions = extractArray(questionsRes.data, 'questions');
      const loadedTests = extractArray(testsRes.data, 'tests');
      const loadedResults = extractArray(resultsRes.data, 'results');

      console.log('tests:', loadedTests);
      
      setQuestions(loadedQuestions);
      setTests(loadedTests);
      setResults(loadedResults);
      
      // Проверяем, является ли пользователь главным учителем
      const savedUser = JSON.parse(localStorage.getItem('user') || '{}');
      setIsMainTeacher(user?.is_main_teacher || savedUser.is_main_teacher || false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setQuestions([]);
      setTests([]);
      setResults([]);
      setError(error.response?.data?.detail || error.response?.data?.error || error.message || 'Ошибка загрузки данных');
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
      fetchTeachers();
      alert('Учитель успешно создан');
    } catch (error) {
      console.error('Error creating teacher:', error);
      alert('Ошибка создания учителя');
    }
  };

  const fetchTeachers = async () => {
    setLoadingTeachers(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/teacher/list/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setTeachers(extractArray(response.data, 'teachers'));
    } catch (error) {
      console.error('Error loading teachers:', error);
      setTeachers([]);
      setError(error.response?.data?.detail || error.response?.data?.error || 'Ошибка загрузки списка учителей');
    } finally {
      setLoadingTeachers(false);
    }
  };

  const handleToggleTeacherList = () => {
    const nextVisible = !showTeacherList;
    setShowTeacherList(nextVisible);
    if (nextVisible && teachers.length === 0) {
      fetchTeachers();
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

  const handleOpenResultDetail = async (result) => {
    setLoadingResultDetail(true);
    setSelectedResultDetail(null);

    try {
      const response = await axios.get(`${API_URL}/teacher/attempts/${result.id}/result/`);
      setSelectedResultDetail(response.data);
    } catch (error) {
      console.error('Error loading attempt detail:', error);
      setError(error.response?.data?.detail || error.response?.data?.error || 'Ошибка загрузки деталей результата');
    } finally {
      setLoadingResultDetail(false);
    }
  };

  const closeResultDetail = () => {
    setSelectedResultDetail(null);
  };

  const getStudentName = (result) => {
    const fullName = result?.student_name?.trim();
    return fullName || result?.student_username || 'Без имени';
  };

  const buildStudentTestDocument = (detail) => {
    const answersByQuestionId = new Map(
      (detail?.attempt?.answers || []).map((answer) => [answer.question?.id, answer])
    );
    const questionsForExport = (detail?.questions || []).length
      ? detail.questions
      : (detail?.attempt?.answers || []).map((answer) => answer.question).filter(Boolean);
    const studentName = getStudentName({
      student_name: `${detail?.student?.first_name || ''} ${detail?.student?.last_name || ''}`,
      student_username: detail?.student?.username,
    });
    const testTitle = detail?.attempt?.test?.title || '-';
    const completedAt = detail?.attempt?.completed_at
      ? new Date(detail.attempt.completed_at).toLocaleString('ru-RU')
      : '-';
    const rows = questionsForExport.map((question, index) => {
      const answer = answersByQuestionId.get(question.id);
      const selectedKey = answer?.selected_option || '';
      const selectedText = selectedKey
        ? question[`option_${selectedKey.toLowerCase()}`] || ''
        : '';
      const statusText = answer
        ? (answer.is_correct ? 'Правильно' : 'Неправильно')
        : 'Нет ответа';
      const bg = answer
        ? (answer.is_correct ? '#dcfce7' : '#fee2e2')
        : '#f9fafb';

      return `
        <tr style="background:${bg}">
          <td>${index + 1}</td>
          <td>${escapeHtml(question.text || '')}</td>
          <td>A. ${escapeHtml(question.option_a || '')}<br />B. ${escapeHtml(question.option_b || '')}<br />C. ${escapeHtml(question.option_c || '')}</td>
          <td>${escapeHtml(selectedKey || '-')} ${selectedText ? `- ${escapeHtml(selectedText)}` : ''}</td>
          <td>${escapeHtml(question.correct_answer || '-')}</td>
          <td>${escapeHtml(statusText)}</td>
        </tr>
      `;
    }).join('');

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, sans-serif; color: #111827; }
            h1 { font-size: 22px; margin-bottom: 6px; }
            p { margin: 0 0 8px; color: #4b5563; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
            th { background: #f3f4f6; text-align: left; }
          </style>
        </head>
        <body>
          <h1>Тест студента</h1>
          <p><strong>Студент:</strong> ${escapeHtml(studentName)}</p>
          <p><strong>Логин:</strong> ${escapeHtml(detail?.student?.username || '-')}</p>
          <p><strong>Тест:</strong> ${escapeHtml(testTitle)}</p>
          <p><strong>Дата сдачи:</strong> ${escapeHtml(completedAt)}</p>
          <p><strong>Результат:</strong> ${escapeHtml(detail?.correct_count || 0)} / ${escapeHtml(detail?.total_questions || questionsForExport.length)}</p>
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Вопрос</th>
                <th>Варианты</th>
                <th>Ответ студента</th>
                <th>Правильный ответ</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `;
  };

  const handleDownloadStudentTest = () => {
    if (!selectedResultDetail) return;

    const studentName = getStudentName({
      student_name: `${selectedResultDetail.student?.first_name || ''} ${selectedResultDetail.student?.last_name || ''}`,
      student_username: selectedResultDetail.student?.username,
    });

    const filename = `${sanitizeFilename(studentName)}-test-${selectedResultDetail.attempt?.id || 'result'}.pdf`;

    printPdfDocument(buildStudentTestDocument(selectedResultDetail), filename);
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-modern"></div>
      </div>
    );
  }

  const filteredResults = (results || []).filter((result) => {
    const completedDate = result.completed_at
      ? formatDateFilter(result.completed_at)
      : '';

    return (
      !resultFilters.date || completedDate === resultFilters.date
    );
  });

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Панель учителя</h1>
        <p className="text-gray-500 mt-1">Управляйте тестами и просматривайте результаты учеников</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{error}</p>
        </div>
      )}
      
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
        <button
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'filter' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setActiveTab('filter')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 01.8 1.6L14 13.67V19a1 1 0 01-.45.83l-4 2.67A1 1 0 018 21.67v-8L3.2 4.6A1 1 0 013 4z" />
            </svg>
            Фильтр
          </span>
        </button>
        {canManageTeachers && (
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

      {activeTab === 'filter' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Дата сдачи</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-modern"
                  placeholder="дд.мм.гггг"
                  maxLength="10"
                  value={resultFilters.date}
                  onChange={(e) => setResultFilters({ ...resultFilters, date: normalizeDateInput(e.target.value) })}
                />
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h4 className="text-lg font-semibold text-gray-900">Сданные тесты</h4>
                <p className="text-sm text-gray-500">Найдено: {filteredResults.length}</p>
              </div>

              {(filteredResults || []).length === 0 ? (
                <div className="p-8 text-center text-gray-500">Нет сданных тестов</div>
              ) : (
                <div className="divide-y divide-gray-200 max-h-[620px] overflow-y-auto">
                  {filteredResults.map((result) => {
                    const percentage = result.total_questions > 0
                      ? Math.round((result.score / result.total_questions) * 100)
                      : 0;
                    const isSelected = selectedResultDetail?.attempt?.id === result.id;

                    return (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => handleOpenResultDetail(result)}
                        className={`w-full text-left p-4 transition-colors ${
                          isSelected ? 'bg-green-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-gray-900">{getStudentName(result)}</div>
                            <div className="text-sm text-gray-500">@{result.student_username}</div>
                            <div className="text-sm text-gray-700 mt-2">{result.test_title}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {result.completed_at ? new Date(result.completed_at).toLocaleString('ru-RU') : '-'}
                            </div>
                          </div>
                          <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                            percentage >= 70 ? 'bg-green-100 text-green-800' : percentage >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {result.score}/{result.total_questions}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">Действия студента</h4>
                  <p className="text-sm text-gray-500">Выбранные варианты ответов</p>
                </div>
                {selectedResultDetail && (
                  <button
                    type="button"
                    onClick={closeResultDetail}
                    className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
                  >
                    Закрыть
                  </button>
                )}
              </div>

              {loadingResultDetail ? (
                <div className="p-8 text-center text-gray-500">Загрузка...</div>
              ) : !selectedResultDetail ? (
                <div className="p-8 text-center text-gray-500">Выберите студента слева</div>
              ) : (
                <div className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-xl bg-green-50 border border-green-200 p-4">
                      <div className="text-2xl font-bold text-green-700">{selectedResultDetail.correct_count}</div>
                      <div className="text-sm text-gray-600">Правильных</div>
                    </div>
                    <div className="rounded-xl bg-red-50 border border-red-200 p-4">
                      <div className="text-2xl font-bold text-red-700">{selectedResultDetail.incorrect_count}</div>
                      <div className="text-sm text-gray-600">Неправильных</div>
                    </div>
                    <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                      <div className="text-2xl font-bold text-blue-700">{selectedResultDetail.total_questions}</div>
                      <div className="text-sm text-gray-600">Всего вопросов</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadStudentTest}
                      className="rounded-xl bg-gray-900 p-4 text-left text-white hover:bg-gray-800 transition-colors"
                    >
                      <div className="text-base font-semibold">Скачать PDF</div>
                      <div className="text-sm text-gray-300">PDF файл студента</div>
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {(selectedResultDetail.attempt?.answers || []).map((answer, index) => {
                      const fullQuestion = (selectedResultDetail.questions || []).find(
                        (question) => question.id === answer.question?.id
                      );
                      const selectedAnswer = (answer.question?.answers || []).find(
                        (item) => item.key === answer.selected_option
                      );
                      const correctKey = fullQuestion?.correct_answer;
                      const correctText = correctKey
                        ? fullQuestion?.[`option_${correctKey.toLowerCase()}`]
                        : '';

                      return (
                        <div
                          key={answer.id}
                          className={`rounded-xl border p-4 ${
                            answer.is_correct
                              ? 'bg-green-50 border-green-200'
                              : 'bg-red-50 border-red-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                #{index + 1} {answer.question?.text}
                              </div>
                              <div className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                answer.is_correct
                                  ? 'bg-green-600 text-white'
                                  : 'bg-red-600 text-white'
                              }`}>
                                Выбрал: {answer.selected_option}
                                {selectedAnswer?.text ? ` - ${selectedAnswer.text}` : ''}
                              </div>
                              {!answer.is_correct && correctKey && (
                                <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-600 text-white">
                                  Правильный ответ: {correctKey}
                                  {correctText ? ` - ${correctText}` : ''}
                                </div>
                              )}
                            </div>
                            <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${
                              answer.is_correct
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {answer.is_correct ? 'Правильно' : 'Неправильно'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                    {(questions || []).map(q => (
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

          {(tests || []).length === 0 ? (
            <div className="empty-state">
              <p>Нет созданных тестов</p>
            </div>
          ) : (
            (tests || []).map(test => (
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

          <h5>Все вопросы ({(questions || []).length})</h5>
          {(questions || []).length === 0 ? (
            <div className="empty-state">
              <p>Нет созданных вопросов</p>
            </div>
          ) : (
            (questions || []).map(q => (
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
          {(results || []).length === 0 ? (
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
                  {(results || []).map(result => {
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

      {activeTab === 'teachers' && canManageTeachers && (
        <div>
          <div className="mb-4 flex flex-wrap gap-3">
            <button 
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
              onClick={() => setShowCreateTeacher(!showCreateTeacher)}
            >
              {showCreateTeacher ? 'Отмена' : 'Создать учителя'}
            </button>
            <button
              type="button"
              className="px-6 py-3 bg-white text-gray-800 font-semibold rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 transition-all duration-200"
              onClick={handleToggleTeacherList}
            >
              {showTeacherList ? 'Скрыть список' : 'Список учителей'}
            </button>
          </div>

          {showTeacherList && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h4 className="text-xl font-semibold text-gray-900">Список учителей</h4>
                  <p className="text-sm text-gray-500">Найдено: {teachers.length}</p>
                </div>
                <button
                  type="button"
                  onClick={fetchTeachers}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Обновить
                </button>
              </div>

              {loadingTeachers ? (
                <div className="p-8 text-center text-gray-500">Загрузка...</div>
              ) : teachers.length === 0 ? (
                <div className="p-8 text-center text-gray-500">Учителя не найдены</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ФИО</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Логин</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {teachers.map((teacher) => {
                      const teacherName = `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim() || '-';

                      return (
                        <tr key={teacher.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">{teacherName}</td>
                          <td className="px-6 py-4 text-sm text-gray-500">@{teacher.username}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              teacher.is_main_teacher
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {teacher.is_main_teacher ? 'Главный учитель' : 'Учитель'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

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
