import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { localizeField, useLanguage } from '../context/LanguageContext';
import API_URL from '../config/api';

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

const printPdfDocument = (html, filename, popupMessage) => {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    alert(popupMessage);
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

const buildSlug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[а-яёөңү]/gi, (letter) => ({
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
      х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
      ө: 'o', ң: 'n', ү: 'u'
    }[letter] || ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const apiErrorFieldLabels = {
  name: 'Название',
  slug: 'Код',
  description: 'Описание',
  is_active: 'Активен',
  non_field_errors: 'Ошибка'
};

const flattenApiError = (data, fallback) => {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map((item) => flattenApiError(item, '')).filter(Boolean).join('; ') || fallback;
  if (typeof data !== 'object') return fallback;

  if (typeof data.detail === 'string') return data.detail;
  if (typeof data.error === 'string') return data.error;

  const messages = Object.entries(data)
    .map(([field, value]) => {
      const message = Array.isArray(value)
        ? value.map((item) => flattenApiError(item, '')).filter(Boolean).join(', ')
        : flattenApiError(value, '');
      if (!message) return '';
      return `${apiErrorFieldLabels[field] || field}: ${message}`;
    })
    .filter(Boolean);

  return messages.join('; ') || fallback;
};

const emptyStudentForm = {
  username: '',
  first_name: '',
  last_name: '',
  military_rank: '',
  patronymic: '',
  password: '',
  training_mode: false
};

const emptyQuestionForm = (triggerId = '') => ({
  text: '',
  text_ru: '',
  text_ky: '',
  option_a: '',
  option_a_ru: '',
  option_a_ky: '',
  option_b: '',
  option_b_ru: '',
  option_b_ky: '',
  option_c: '',
  option_c_ru: '',
  option_c_ky: '',
  option_d: '',
  option_d_ru: '',
  option_d_ky: '',
  correct_answer: 'A',
  trigger_id: triggerId
});

const bilingualFields = ['text', 'option_a', 'option_b', 'option_c', 'option_d'];

const translationDictionary = {
  ru: {
    'суроо': 'вопрос',
    'жооп': 'ответ',
    'туура': 'правильный',
    'туура жооп': 'правильный ответ',
    'тест': 'тест',
    'аскер': 'военный',
    'мыйзам': 'закон',
    'башкаруу': 'управление'
  },
  ky: {
    'вопрос': 'суроо',
    'ответ': 'жооп',
    'правильный': 'туура',
    'правильный ответ': 'туура жооп',
    'тест': 'тест',
    'военный': 'аскердик',
    'закон': 'мыйзам',
    'управление': 'башкаруу'
  }
};

const simpleTranslate = (value, targetLanguage) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const dictionary = translationDictionary[targetLanguage] || {};
  const lower = text.toLowerCase();
  if (dictionary[lower]) return dictionary[lower];

  return text.replace(/[А-Яа-яЁёӨөҮүҢң]+/g, (word) => {
    const translated = dictionary[word.toLowerCase()];
    if (!translated) return word;
    return word[0] === word[0]?.toUpperCase()
      ? translated.charAt(0).toUpperCase() + translated.slice(1)
      : translated;
  });
};

const normalizeQuestionPayload = (question) => {
  const payload = { ...question };
  bilingualFields.forEach((field) => {
    const ruValue = payload[`${field}_ru`] || '';
    const kyValue = payload[`${field}_ky`] || payload[`${field}_kg`] || '';
    payload[field] = payload[field] || ruValue || kyValue;
    if (!payload[`${field}_ru`] && payload[field]) {
      payload[`${field}_ru`] = payload[field];
    }
    if (kyValue) {
      payload[`${field}_ky`] = kyValue;
      payload[`${field}_kg`] = kyValue;
    }
  });
  payload.question_ru = payload.text_ru || payload.text || '';
  payload.question_kg = payload.text_ky || payload.text_kg || '';
  return payload;
};

const hasRequiredQuestionContent = (question) => (
  ['text', 'option_a', 'option_b', 'option_c'].every((field) => {
    const ruValue = String(question[`${field}_ru`] || question[field] || '').trim();
    const kyValue = String(question[`${field}_ky`] || '').trim();
    return ruValue || kyValue;
  })
);

const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const parseCsvLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
};

const parseQuestionImportLine = (line) => {
  const commaParts = parseCsvLine(line);
  if (commaParts.length > 1) return commaParts;
  return line.split(';').map((part) => part.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
};

const normalizeCsvHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '_');

const questionDuplicateKey = (question) =>
  String(question.text_ru || question.text_ky || question.text || question.question_ru || question.question_kg || '')
    .trim()
    .toLowerCase();

const mapQuestionCsvRow = (parts, headers = null) => {
  if (!headers) {
    return normalizeQuestionPayload({
      text: parts[0] || '',
      option_a: parts[1] || '',
      option_b: parts[2] || '',
      option_c: parts[3] || '',
      option_d: parts[4] || '',
      correct_answer: (parts[5] || 'A').toUpperCase()
    });
  }

  const row = headers.reduce((acc, header, index) => {
    acc[header] = parts[index] || '';
    return acc;
  }, {});
  const pick = (...keys) => keys.map((key) => row[key]).find((value) => String(value || '').trim()) || '';

  return normalizeQuestionPayload({
    text: pick('text', 'question', 'вопрос', 'question_ru', 'text_ru', 'question_kg', 'question_ky', 'text_kg', 'text_ky'),
    text_ru: pick('text_ru', 'question_ru', 'ru_question', 'question', 'вопрос_ru'),
    text_ky: pick('text_ky', 'text_kg', 'question_ky', 'question_kg', 'kg_question', 'ky_question'),
    option_a: pick('option_a', 'a', 'answer_a'),
    option_a_ru: pick('option_a_ru', 'a_ru', 'answer_a_ru'),
    option_a_ky: pick('option_a_ky', 'option_a_kg', 'a_ky', 'a_kg', 'answer_a_ky', 'answer_a_kg'),
    option_b: pick('option_b', 'b', 'answer_b'),
    option_b_ru: pick('option_b_ru', 'b_ru', 'answer_b_ru'),
    option_b_ky: pick('option_b_ky', 'option_b_kg', 'b_ky', 'b_kg', 'answer_b_ky', 'answer_b_kg'),
    option_c: pick('option_c', 'c', 'answer_c'),
    option_c_ru: pick('option_c_ru', 'c_ru', 'answer_c_ru'),
    option_c_ky: pick('option_c_ky', 'option_c_kg', 'c_ky', 'c_kg', 'answer_c_ky', 'answer_c_kg'),
    option_d: pick('option_d', 'd', 'answer_d'),
    option_d_ru: pick('option_d_ru', 'd_ru', 'answer_d_ru'),
    option_d_ky: pick('option_d_ky', 'option_d_kg', 'd_ky', 'd_kg', 'answer_d_ky', 'answer_d_kg'),
    correct_answer: (pick('correct_answer', 'correct', 'answer', 'right_answer', 'правильный_ответ') || 'A').toUpperCase()
  });
};

const autoTranslateQuestionLocally = (question) => {
  const next = { ...question };
  bilingualFields.forEach((field) => {
    const ruKey = `${field}_ru`;
    const kyKey = `${field}_ky`;
    if (!next[ruKey] && next[field]) {
      next[ruKey] = next[field];
    }
    if (next[ruKey] && !next[kyKey]) {
      next[kyKey] = simpleTranslate(next[ruKey], 'ky');
    }
    if (next[kyKey] && !next[ruKey]) {
      next[ruKey] = simpleTranslate(next[kyKey], 'ru');
    }
    next[field] = next[ruKey] || next[kyKey] || next[field] || '';
  });
  return next;
};

const autoTranslateQuestion = async (question) => {
  try {
    const response = await axios.post(`${API_URL}/questions/translate/`, normalizeQuestionPayload(question));
    return response.data;
  } catch (error) {
    console.error('Error translating question:', error);
    return autoTranslateQuestionLocally(question);
  }
};

const TeacherDashboard = () => {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const dateTimeLocale = language === 'ky' ? 'ky-KG' : 'ru-RU';
  const localizeDisplayText = (value) => {
    if (!value) return '';
    return t(String(value));
  };
  const formatLocalizedDateTime = (value) => (
    value ? new Date(value).toLocaleString(dateTimeLocale) : '-'
  );
  const formatLocalizedTriggers = (items) =>
    (items || [])
      .map((trigger) => localizeDisplayText(trigger?.name || trigger?.slug || trigger))
      .filter(Boolean)
      .join(', ');
  const [questions, setQuestions] = useState([]);
  const [triggers, setTriggers] = useState([]);
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
  const loadedResources = useRef(new Set());
  const loadingResources = useRef(new Map());
  
  const [newQuestion, setNewQuestion] = useState(emptyQuestionForm());
  const [questionManagerSearch, setQuestionManagerSearch] = useState('');
  const [questionManagerTriggerFilter, setQuestionManagerTriggerFilter] = useState('');
  const [questionManagerAnswerFilter, setQuestionManagerAnswerFilter] = useState('');
  const [questionManagerSort, setQuestionManagerSort] = useState('id_desc');
  const [questionManagerPageSize, setQuestionManagerPageSize] = useState(10);
  const [questionManagerPage, setQuestionManagerPage] = useState(1);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
  const [questionDrawer, setQuestionDrawer] = useState(null);
  const [questionPreview, setQuestionPreview] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [bulkMoveTriggerId, setBulkMoveTriggerId] = useState('');
  const [testSearch, setTestSearch] = useState('');
  const [testStatusFilter, setTestStatusFilter] = useState('all');
  const [testDateFilter, setTestDateFilter] = useState('');
  const [testTriggerFilter, setTestTriggerFilter] = useState('');
  const [testSort, setTestSort] = useState('created_desc');
  const [testPageSize, setTestPageSize] = useState(10);
  const [testPage, setTestPage] = useState(1);
  const [testDrawer, setTestDrawer] = useState(null);
  const [testPreview, setTestPreview] = useState(null);
  const [testSettings, setTestSettings] = useState({
    description: '',
    question_count: 100,
    is_active: true,
    duration_minutes: 50,
    attempts: 1
  });
  
  const [newTest, setNewTest] = useState({
    title: ''
  });
  const [selectedQuestions, setSelectedQuestions] = useState([]);
  const [selectedTriggerIds, setSelectedTriggerIds] = useState([]);
  const [expandedTriggerIds, setExpandedTriggerIds] = useState([]);
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [createTestStep, setCreateTestStep] = useState(1);
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionTriggerFilter, setQuestionTriggerFilter] = useState('');
  const [questionPage, setQuestionPage] = useState(1);
  const [newTrigger, setNewTrigger] = useState({ name: '', slug: '', description: '', is_active: true });
  const [newSubTrigger, setNewSubTrigger] = useState({
    parent: '',
    name: '',
    slug: '',
    description: '',
    is_active: true,
    slugEdited: false
  });
  const [editingTriggerId, setEditingTriggerId] = useState(null);
  const [editingTrigger, setEditingTrigger] = useState({ name: '', slug: '', description: '', is_active: true, parent: '' });
  const [triggerSearchName, setTriggerSearchName] = useState('');
  const [triggerSearchCode, setTriggerSearchCode] = useState('');
  const [triggerStatusFilter, setTriggerStatusFilter] = useState('all');
  const [triggerSort, setTriggerSort] = useState('created_desc');
  const [triggerNotice, setTriggerNotice] = useState('');
  const [triggerDrawer, setTriggerDrawer] = useState(null);
  const [triggerQuestionSearch, setTriggerQuestionSearch] = useState('');
  const [drawerQuestionForm, setDrawerQuestionForm] = useState(emptyQuestionForm());
  const [bulkQuestionsText, setBulkQuestionsText] = useState('');
  const [pendingQuestionSubmit, setPendingQuestionSubmit] = useState(null);
  const [questionTargetTriggerId, setQuestionTargetTriggerId] = useState('');
  const [pendingQuestionImportFile, setPendingQuestionImportFile] = useState(null);
  const [questionImportTargetTriggerId, setQuestionImportTargetTriggerId] = useState('');
  
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
  const [summaryTeacherId, setSummaryTeacherId] = useState('');
  const [summaryDownloading, setSummaryDownloading] = useState(false);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [showCreateStudent, setShowCreateStudent] = useState(false);
  const [newStudent, setNewStudent] = useState(emptyStudentForm);
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editingStudent, setEditingStudent] = useState(emptyStudentForm);

  useEffect(() => {
    fetchData(['results'], true);
  }, []);

  const canManageTeachers =
    user?.is_staff ||
    user?.is_superuser ||
    user?.role === 'admin' ||
    (user?.role === 'teacher' && isMainTeacher);

  const canDownloadAnyTeacherSummary =
    user?.is_staff ||
    user?.is_superuser ||
    user?.role === 'admin';

  const canManageTriggers = canDownloadAnyTeacherSummary;

  const resourcesForTab = (tab) => {
    if (tab === 'tests') return ['tests', 'triggers'];
    if (tab === 'questions' || tab === 'triggers') return ['questions', 'triggers'];
    return tab === 'results' || tab === 'filter' ? ['results'] : [];
  };

  const fetchResource = (resource) => {
    if (loadingResources.current.has(resource)) {
      return loadingResources.current.get(resource);
    }

    const request = {
      questions: () => axios.get(`${API_URL}/questions/`),
      tests: () => axios.get(`${API_URL}/tests/`),
      results: () => axios.get(`${API_URL}/teacher/results/`),
      triggers: () => axios.get(`${API_URL}/triggers/`)
    }[resource];

    if (!request) return Promise.resolve();

    const promise = request()
      .then((response) => {
        const setter = {
          questions: setQuestions,
          tests: setTests,
          results: setResults,
          triggers: setTriggers
        }[resource];
        setter(extractArray(response.data, resource));
        loadedResources.current.add(resource);
      })
      .finally(() => loadingResources.current.delete(resource));

    loadingResources.current.set(resource, promise);
    return promise;
  };

  const fetchData = async (requestedResources = resourcesForTab(activeTab), showPageLoader = false) => {
    if (showPageLoader) setLoading(true);
    setError(null);

    try {
      await Promise.all(requestedResources.map(fetchResource));
      
      // Проверяем, является ли пользователь главным учителем
      const savedUser = JSON.parse(localStorage.getItem('user') || '{}');
      setIsMainTeacher(user?.is_main_teacher || savedUser.is_main_teacher || false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error.response?.data?.detail || error.response?.data?.error || error.message || 'Ошибка загрузки данных');
    } finally {
      if (showPageLoader) setLoading(false);
    }
  };

  const openTab = (tab) => {
    setActiveTab(tab);
    const missingResources = resourcesForTab(tab).filter(
      (resource) => !loadedResources.current.has(resource)
    );
    if (missingResources.length) fetchData(missingResources);
  };

  const handleCreateQuestion = async (e) => {
    e.preventDefault();
    if (false && !newQuestion.trigger_id) {
      alert('Выберите триггер для вопроса');
      return;
    }
    if (!hasRequiredQuestionContent(newQuestion)) {
      alert('Заполните текст вопроса и варианты A, B, C хотя бы на одном языке');
      return;
    }
    setPendingQuestionSubmit({
      payload: normalizeQuestionPayload(newQuestion),
      editingId: editingQuestionId
    });
    setQuestionTargetTriggerId(newQuestion.trigger_id || '');
    if (pendingQuestionSubmit !== undefined) return;
    try {
      const payload = normalizeQuestionPayload(newQuestion);
      if (editingQuestionId) {
        await axios.patch(`${API_URL}/questions/${editingQuestionId}/`, payload);
      } else {
        await axios.post(`${API_URL}/questions/`, payload);
      }
      setNewQuestion(emptyQuestionForm(triggers[0]?.id || ''));
      setEditingQuestionId(null);
      localStorage.removeItem('questionDraft');
      fetchData();
    } catch (error) {
      console.error('Error creating question:', error);
    }
  };

  const confirmQuestionSubmit = async () => {
    if (!pendingQuestionSubmit) return;
    if (!questionTargetTriggerId) {
      alert('Выберите триггер/категорию, куда добавить вопрос');
      return;
    }

    try {
      const payload = {
        ...pendingQuestionSubmit.payload,
        trigger_id: questionTargetTriggerId
      };
      if (pendingQuestionSubmit.editingId) {
        await axios.patch(`${API_URL}/questions/${pendingQuestionSubmit.editingId}/`, payload);
      } else {
        await axios.post(`${API_URL}/questions/`, payload);
      }
      setNewQuestion(emptyQuestionForm());
      setEditingQuestionId(null);
      setPendingQuestionSubmit(null);
      setQuestionTargetTriggerId('');
      localStorage.removeItem('questionDraft');
      fetchData();
    } catch (error) {
      console.error('Error creating question:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || 'Ошибка сохранения вопроса');
    }
  };

  const handleDeleteQuestion = async (id) => {
    if (!window.confirm('Удалить вопрос?')) return;
    try {
      await axios.delete(`${API_URL}/questions/${id}/`);
      setSelectedQuestionIds((current) => current.filter((questionId) => questionId !== id));
      fetchData();
    } catch (error) {
      console.error('Error deleting question:', error);
    }
  };

  useEffect(() => {
    const savedDraft = localStorage.getItem('questionDraft');
    if (savedDraft) {
      try {
        setNewQuestion((current) => ({ ...current, ...JSON.parse(savedDraft) }));
      } catch (error) {
        console.error('Error loading question draft:', error);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('questionDraft', JSON.stringify(newQuestion));
  }, [newQuestion]);

  const clearQuestionForm = () => {
    setNewQuestion(emptyQuestionForm());
    setEditingQuestionId(null);
    setQuestionPreview(false);
    setPendingQuestionSubmit(null);
    setQuestionTargetTriggerId('');
    localStorage.removeItem('questionDraft');
  };

  const handleAutoTranslateNewQuestion = async () => {
    setNewQuestion(await autoTranslateQuestion(newQuestion));
  };

  const handleAutoTranslateDrawerQuestion = async () => {
    setDrawerQuestionForm(await autoTranslateQuestion(drawerQuestionForm));
  };

  const fillQuestionForm = (question) => {
    setNewQuestion({
      ...emptyQuestionForm(question.trigger?.id || question.trigger_id || ''),
      text: question.text || '',
      text_ru: question.text_ru || question.text || '',
      text_ky: question.text_ky || question.question_kg || '',
      option_a: question.option_a || '',
      option_a_ru: question.option_a_ru || question.option_a || '',
      option_a_ky: question.option_a_ky || question.option_a_kg || '',
      option_b: question.option_b || '',
      option_b_ru: question.option_b_ru || question.option_b || '',
      option_b_ky: question.option_b_ky || question.option_b_kg || '',
      option_c: question.option_c || '',
      option_c_ru: question.option_c_ru || question.option_c || '',
      option_c_ky: question.option_c_ky || question.option_c_kg || '',
      option_d: question.option_d || '',
      option_d_ru: question.option_d_ru || question.option_d || '',
      option_d_ky: question.option_d_ky || question.option_d_kg || '',
      correct_answer: question.correct_answer || 'A'
    });
  };

  const startEditQuestion = (question) => {
    fillQuestionForm(question);
    setEditingQuestionId(question.id);
    setActiveTab('questions');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const copyQuestion = (question) => {
    fillQuestionForm(question);
    setEditingQuestionId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const moveQuestionToTrigger = async (question, triggerId) => {
    if (!triggerId) return;
    try {
      await axios.patch(`${API_URL}/questions/${question.id}/`, normalizeQuestionPayload({
        ...question,
        trigger_id: triggerId
      }));
      fetchData();
    } catch (error) {
      console.error('Error moving question:', error);
      alert('Ошибка смены триггера');
    }
  };

  const bulkDeleteQuestions = async () => {
    if (!selectedQuestionIds.length || !window.confirm(`Удалить выбранные вопросы: ${selectedQuestionIds.length}?`)) return;
    try {
      await Promise.all(selectedQuestionIds.map((id) => axios.delete(`${API_URL}/questions/${id}/`)));
      setSelectedQuestionIds([]);
      fetchData();
    } catch (error) {
      console.error('Error bulk deleting questions:', error);
      alert('Ошибка массового удаления');
    }
  };

  const bulkMoveQuestions = async () => {
    if (!selectedQuestionIds.length || !bulkMoveTriggerId) return;
    const selected = (questions || []).filter((question) => selectedQuestionIds.includes(question.id));
    try {
      await Promise.all(selected.map((question) => moveQuestionToTrigger(question, bulkMoveTriggerId)));
      setSelectedQuestionIds([]);
      setBulkMoveTriggerId('');
      fetchData();
    } catch (error) {
      console.error('Error bulk moving questions:', error);
    }
  };

  const exportQuestions = (format) => {
    const rows = (questions || []).map((question) => ({
      id: question.id,
      text: question.text,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d || '',
      correct_answer: question.correct_answer,
      trigger: question.trigger?.name || '',
      created_at: question.created_at || ''
    }));
    const content = format === 'pdf'
      ? rows.map((row) => `${row.id}. ${row.text} [${row.correct_answer}]`).join('\n')
      : [
          'id,text,option_a,option_b,option_c,option_d,correct_answer,trigger,created_at',
          ...rows.map((row) => Object.values(row).map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');
    const blob = new Blob([content], { type: format === 'pdf' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = format === 'pdf' ? 'questions-export.txt' : `questions-export.${format === 'excel' ? 'csv' : 'csv'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleQuestionImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const existingTexts = new Set((questions || []).map((question) => String(question.text || '').trim().toLowerCase()));
    const rows = text.split('\n').map((row) => row.trim()).filter(Boolean);
    const imported = rows
      .slice(rows[0]?.toLowerCase().startsWith('text') || rows[0]?.toLowerCase().startsWith('id,') ? 1 : 0)
      .map((row) => row.split(',').map((part) => part.replace(/^"|"$/g, '').trim()))
      .filter((parts) => parts.length >= 6 && !existingTexts.has(parts[0].toLowerCase()));

    try {
      await Promise.all(imported.map((parts) => axios.post(`${API_URL}/questions/`, {
        text: parts[0],
        option_a: parts[1],
        option_b: parts[2],
        option_c: parts[3],
        option_d: parts[4] || '',
        correct_answer: (parts[5] || 'A').toUpperCase(),
        trigger_id: parts[6] || newQuestion.trigger_id || triggers[0]?.id
      })));
      fetchData();
      alert(`Импортировано вопросов: ${imported.length}`);
    } catch (error) {
      console.error('Error importing questions:', error);
      alert('Ошибка импорта. Проверьте CSV: text,A,B,C,D,correct,trigger_id');
    } finally {
      event.target.value = '';
    }
  };

  const exportTriggerQuestions = (trigger) => {
    const triggerQuestions = getTriggerQuestions(trigger);
    const headers = [
      'id',
      'text_ru',
      'text_ky',
      'option_a_ru',
      'option_a_ky',
      'option_b_ru',
      'option_b_ky',
      'option_c_ru',
      'option_c_ky',
      'option_d_ru',
      'option_d_ky',
      'correct_answer',
      'trigger_id',
      'trigger_name'
    ];
    const rows = triggerQuestions.map((question) => [
      question.id,
      question.text_ru || question.question_ru || question.text || '',
      question.text_ky || question.question_kg || '',
      question.option_a_ru || question.option_a || '',
      question.option_a_ky || question.option_a_kg || '',
      question.option_b_ru || question.option_b || '',
      question.option_b_ky || question.option_b_kg || '',
      question.option_c_ru || question.option_c || '',
      question.option_c_ky || question.option_c_kg || '',
      question.option_d_ru || question.option_d || '',
      question.option_d_ky || question.option_d_kg || '',
      question.correct_answer || '',
      trigger.id,
      trigger.name || ''
    ]);
    const content = [
      headers.join(','),
      ...rows.map((row) => row.map(csvEscape).join(','))
    ].join('\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(trigger.slug || trigger.name || 'trigger')}-questions.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleTriggerQuestionImport = async (file, trigger) => {
    if (!file || !trigger?.id) return;

    let added = 0;
    let duplicates = 0;
    let errors = 0;

    try {
      if (String(file.name || '').toLowerCase().endsWith('.docx')) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await axios.post(
          `${API_URL}/triggers/${trigger.id}/questions/import-docx/`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        added = response.data?.added || 0;
        duplicates = response.data?.duplicates || 0;
        errors = response.data?.errors || 0;
        await fetchData();
        alert(`Импорт завершён: добавлено ${added}, дубликатов ${duplicates}, ошибок ${errors}`);
        return;
      }

      const fileText = await file.text();
      const rawRows = fileText
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter(Boolean);

      if (rawRows.length === 0) {
        alert('Файл пустой');
        return;
      }

      const firstRow = parseQuestionImportLine(rawRows[0]).map(normalizeCsvHeader);
      const hasHeader = firstRow.some((header) => [
        'text', 'question', 'text_ru', 'question_ru', 'text_ky', 'text_kg',
        'option_a', 'option_a_ru', 'correct_answer', 'correct'
      ].includes(header));
      const headers = hasHeader ? firstRow : null;
      const rows = hasHeader ? rawRows.slice(1) : rawRows;
      const existingKeys = new Set(getTriggerQuestions(trigger).map(questionDuplicateKey).filter(Boolean));
      const importedKeys = new Set();

      for (const row of rows) {
        const payload = {
          ...mapQuestionCsvRow(parseQuestionImportLine(row), headers),
          trigger_id: trigger.id
        };
        const duplicateKey = questionDuplicateKey(payload);

        if (!hasRequiredQuestionContent(payload) || !['A', 'B', 'C', 'D'].includes(payload.correct_answer)) {
          errors += 1;
          continue;
        }
        if (!duplicateKey || existingKeys.has(duplicateKey) || importedKeys.has(duplicateKey)) {
          duplicates += 1;
          continue;
        }

        try {
          await axios.post(`${API_URL}/questions/`, payload);
          added += 1;
          importedKeys.add(duplicateKey);
        } catch (error) {
          console.error('Trigger question import row error:', error);
          errors += 1;
        }
      }

      await fetchData();
      alert(`Импорт завершён: добавлено ${added}, дубликатов ${duplicates}, ошибок ${errors}`);
    } catch (error) {
      console.error('Trigger question import error:', error);
      alert(error.response?.data?.error || `Ошибка импорта: добавлено ${added}, дубликатов ${duplicates}, ошибок ${errors}`);
    }
  };

  const openQuestionImportTargetDialog = (event, defaultTrigger = null) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPendingQuestionImportFile(file);
    setQuestionImportTargetTriggerId(defaultTrigger?.id ? String(defaultTrigger.id) : '');
  };

  const confirmQuestionImport = async () => {
    if (!pendingQuestionImportFile) return;
    if (!questionImportTargetTriggerId) {
      alert(t('questions.select_import_category'));
      return;
    }
    const selectedTrigger = (triggers || []).find((trigger) => String(trigger.id) === String(questionImportTargetTriggerId));
    if (!selectedTrigger) {
      alert(t('questions.category_not_found'));
      return;
    }
    await handleTriggerQuestionImport(pendingQuestionImportFile, selectedTrigger);
    setPendingQuestionImportFile(null);
    setQuestionImportTargetTriggerId('');
  };

  const handleCreateTest = async (e) => {
    e.preventDefault();

    if (!newTest.title.trim()) {
      alert(t('tests.enter_title'));
      setCreateTestStep(1);
      return;
    }

    if (selectedTriggerIds.length === 0 && selectedQuestions.length !== 100) {
      alert(t('tests.must_select_exactly_100', { count: selectedQuestions.length }));
      setCreateTestStep(3);
      return;
    }

    const confirmText = selectedTriggerIds.length > 0
      ? t('tests.confirm_create_auto', { title: newTest.title })
      : t('tests.confirm_create_manual', { title: newTest.title, count: selectedQuestions.length });

    if (!window.confirm(confirmText)) {
      return;
    }
    
    try {
      const payload = { title: newTest.title.trim() };
      if (selectedTriggerIds.length > 0) {
        payload.trigger_ids = selectedTriggerIds;
      } else {
        payload.question_ids = selectedQuestions;
      }
      await axios.post(`${API_URL}/tests/`, payload);
      
      setNewTest({ title: '' });
      setSelectedQuestions([]);
      setSelectedTriggerIds([]);
      setCreateTestStep(1);
      setQuestionSearch('');
      setQuestionTriggerFilter('');
      setQuestionPage(1);
      setShowCreateTest(false);
      localStorage.removeItem('teacherTestDraft');
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
      alert(t('Экзаменатор успешно создан'));
    } catch (error) {
      console.error('Error creating teacher:', error);
      alert(t('Ошибка создания экзаменатора'));
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

  const fetchStudents = async () => {
    setLoadingStudents(true);
    setError(null);

    try {
      const response = await axios.get(`${API_URL}/teacher/students/`);
      setStudents(extractArray(response.data, 'students'));
    } catch (error) {
      console.error('Error loading students:', error);
      setStudents([]);
      setError(error.response?.data?.detail || error.response?.data?.error || t('Ошибка загрузки списка учеников'));
    } finally {
      setLoadingStudents(false);
    }
  };

  const handleCreateStudent = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      await axios.post(`${API_URL}/teacher/students/`, newStudent);
      setNewStudent(emptyStudentForm);
      setShowCreateStudent(false);
      fetchStudents();
      alert(t('Ученик успешно создан'));
    } catch (error) {
      console.error('Error creating student:', error);
      setError(
        error.response?.data?.error ||
        error.response?.data?.username?.[0] ||
        error.response?.data?.detail ||
        t('Ошибка создания ученика')
      );
    }
  };

  const startEditStudent = (student) => {
    setEditingStudentId(student.id);
    setEditingStudent({
      username: student.username || '',
      first_name: student.first_name || '',
      last_name: student.last_name || '',
      military_rank: student.military_rank || '',
      patronymic: student.patronymic || '',
      password: '',
      training_mode: Boolean(student.training_mode)
    });
    setShowCreateStudent(false);
  };

  const cancelEditStudent = () => {
    setEditingStudentId(null);
    setEditingStudent(emptyStudentForm);
  };

  const handleUpdateStudent = async (e) => {
    e.preventDefault();
    setError(null);

    const payload = { ...editingStudent };
    if (!payload.password) {
      delete payload.password;
    }

    try {
      await axios.patch(`${API_URL}/teacher/students/${editingStudentId}/`, payload);
      cancelEditStudent();
      fetchStudents();
      alert(t('Данные ученика обновлены'));
    } catch (error) {
      console.error('Error updating student:', error);
      setError(
        error.response?.data?.error ||
        error.response?.data?.username?.[0] ||
        error.response?.data?.detail ||
        t('Ошибка обновления экзаменуемого')
      );
    }
  };

  const handleDeleteStudent = async (student) => {
    const studentName = `${student.last_name || ''} ${student.first_name || ''}`.trim() || student.username;
    if (!window.confirm(`${t('Удалить ученика')} "${studentName}"?`)) {
      return;
    }

    setError(null);
    try {
      await axios.delete(`${API_URL}/teacher/students/${student.id}/`);
      if (editingStudentId === student.id) {
        cancelEditStudent();
      }
      fetchStudents();
    } catch (error) {
      console.error('Error deleting student:', error);
      setError(error.response?.data?.detail || error.response?.data?.error || t('Ошибка удаления экзаменуемого'));
    }
  };

  const handleCreateTrigger = async (e) => {
    e.preventDefault();
    setTriggerNotice('');

    if (!newTrigger.name.trim() || !newTrigger.slug.trim()) {
      setTriggerNotice('triggers.notice_required');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/triggers/`, {
        ...newTrigger,
        name: newTrigger.name.trim(),
        slug: newTrigger.slug.trim(),
        description: newTrigger.description.trim()
      });
      const createdTrigger = response.data;
      if (createdTrigger?.id) {
        setTriggers((current) => [
          createdTrigger,
          ...(current || []).filter((trigger) => trigger.id !== createdTrigger.id)
        ]);
      }
      setNewTrigger({ name: '', slug: '', description: '', is_active: true });
      setTriggerNotice('triggers.notice_saved');
      await fetchData();
    } catch (error) {
      console.error('Error creating trigger:', error);
      setTriggerNotice(flattenApiError(error.response?.data, 'triggers.notice_create_error'));
    }
  };

  const handleCreateSubTrigger = async (e) => {
    e.preventDefault();
    setTriggerNotice('');

    if (!newSubTrigger.parent || !newSubTrigger.name.trim()) {
      setTriggerNotice('triggers.subtrigger_required');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/triggers/`, {
        parent: newSubTrigger.parent,
        name: newSubTrigger.name.trim(),
        slug: newSubTrigger.slug.trim(),
        description: newSubTrigger.description.trim(),
        is_active: newSubTrigger.is_active
      });
      const createdTrigger = response.data;
      if (createdTrigger?.id) {
        setTriggers((current) => [
          createdTrigger,
          ...(current || []).filter((trigger) => trigger.id !== createdTrigger.id)
        ]);
        setExpandedTriggerIds((current) =>
          current.includes(String(createdTrigger.parent_id))
            ? current
            : [...current, String(createdTrigger.parent_id)]
        );
      }
      setNewSubTrigger({
        parent: newSubTrigger.parent,
        name: '',
        slug: '',
        description: '',
        is_active: true,
        slugEdited: false
      });
      setTriggerNotice('triggers.subtrigger_saved');
      await fetchData();
    } catch (error) {
      console.error('Error creating subtrigger:', error);
      setTriggerNotice(flattenApiError(error.response?.data, 'triggers.subtrigger_create_error'));
    }
  };

  const handleDeleteTest = async (test) => {
    if (!window.confirm(t('tests.confirm_delete', { title: test.title }))) return;
    try {
      await axios.delete(`${API_URL}/tests/${test.id}/`);
      if (testDrawer?.id === test.id) setTestDrawer(null);
      if (testPreview?.id === test.id) setTestPreview(null);
      fetchData();
    } catch (error) {
      console.error('Error deleting test:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || t('tests.delete_error'));
    }
  };

  const toggleTestActive = async (test) => {
    try {
      await axios.patch(`${API_URL}/tests/${test.id}/`, { is_active: !test.is_active });
      fetchData();
    } catch (error) {
      console.error('Error updating test status:', error);
      alert(t('tests.status_change_error'));
    }
  };

  const duplicateTest = async (test) => {
    try {
      const triggerIds = (test.triggers || []).map((trigger) => trigger.id).filter(Boolean);
      const payload = { title: t('tests.copy_title', { title: test.title }) };
      if (triggerIds.length) {
        payload.trigger_ids = triggerIds;
      } else {
        payload.question_ids = (test.questions || []).slice(0, 100).map((question) => question.id);
      }
      await axios.post(`${API_URL}/tests/`, payload);
      fetchData();
    } catch (error) {
      console.error('Error duplicating test:', error);
      alert(t('tests.copy_error'));
    }
  };

  const exportTest = (test, format) => {
    const testQuestions = test.questions || [];
    const lines = [
      test.title,
      `${t('common.status')}: ${test.is_active ? t('common.active') : t('tests.draft')}`,
      `${t('questions.questions')}: ${test.question_count || testQuestions.length || 100}`,
      `${t('triggers.triggers')}: ${formatLocalizedTriggers(test.triggers) || '-'}`,
      '',
      ...testQuestions.map((question) =>
        `${question.id}. ${localizeField(question, 'text', language)}\nA. ${localizeField(question, 'option_a', language)}\nB. ${localizeField(question, 'option_b', language)}\nC. ${localizeField(question, 'option_c', language)}${localizeField(question, 'option_d', language) ? `\nD. ${localizeField(question, 'option_d', language)}` : ''}\n${t('answers.answer')}: ${question.correct_answer}`
      )
    ];
    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(test.title)}.${format === 'excel' ? 'csv' : 'txt'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const printTest = (test) => {
    const html = buildStudentTestDocument({
      student: { username: '-' },
      attempt: { test, completed_at: null, answers: [] },
      questions: test.questions || [],
      correct_count: 0,
      total_questions: test.question_count || 100
    });
    printPdfDocument(html, sanitizeFilename(test.title), t('export.allow_popups'));
  };

  const clearTriggerForm = () => {
    setNewTrigger({ name: '', slug: '', description: '', is_active: true });
    setNewSubTrigger({
      parent: '',
      name: '',
      slug: '',
      description: '',
      is_active: true,
      slugEdited: false
    });
    setTriggerNotice('');
  };

  const startEditTrigger = (trigger) => {
    setEditingTriggerId(trigger.id);
    setEditingTrigger({
      name: trigger.name || '',
      slug: trigger.slug || '',
      description: trigger.description || '',
      is_active: Boolean(trigger.is_active),
      parent: trigger.parent_id || ''
    });
  };

  const handleUpdateTrigger = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...editingTrigger,
        parent: editingTrigger.parent || null
      };
      await axios.patch(`${API_URL}/triggers/${editingTriggerId}/`, payload);
      setEditingTriggerId(null);
      setEditingTrigger({ name: '', slug: '', description: '', is_active: true, parent: '' });
      fetchData();
    } catch (error) {
      console.error('Error updating trigger:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || 'Ошибка изменения триггера');
    }
  };

  const handleDeleteTrigger = async (trigger) => {
    if (!window.confirm(`Удалить триггер "${trigger.name}"?`)) return;
    try {
      await axios.delete(`${API_URL}/triggers/${trigger.id}/`);
      if (triggerDrawer?.id === trigger.id) {
        setTriggerDrawer(null);
      }
      fetchData();
    } catch (error) {
      console.error('Error deleting trigger:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || 'Ошибка удаления триггера');
    }
  };

  const getTriggerQuestions = (trigger) =>
    (questions || []).filter((question) => String(question.trigger?.id || question.trigger_id) === String(trigger.id));

  const openTriggerQuestions = (trigger) => {
    setTriggerDrawer(trigger);
    setTriggerQuestionSearch('');
    setDrawerQuestionForm(emptyQuestionForm());
    setBulkQuestionsText('');
  };

  const handleCreateDrawerQuestion = async (e) => {
    e.preventDefault();
    if (!triggerDrawer) return;
    if (!hasRequiredQuestionContent(drawerQuestionForm)) {
      alert('Заполните текст вопроса и варианты A, B, C хотя бы на одном языке');
      return;
    }

    try {
      await axios.post(`${API_URL}/questions/`, {
        ...normalizeQuestionPayload(drawerQuestionForm),
        trigger_id: triggerDrawer.id
      });
      setDrawerQuestionForm(emptyQuestionForm());
      fetchData();
    } catch (error) {
      console.error('Error creating drawer question:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || 'Ошибка создания вопроса');
    }
  };

  const handleBulkCreateQuestions = async () => {
    if (!triggerDrawer || !bulkQuestionsText.trim()) return;

    const rows = bulkQuestionsText
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.split('|').map((part) => part.trim()))
      .filter((parts) => parts.length >= 4);

    if (rows.length === 0) {
      alert('Добавьте строки в формате: вопрос | вариант A | вариант B | вариант C | правильный ответ');
      return;
    }

    try {
      await Promise.all(rows.map((parts) => axios.post(`${API_URL}/questions/`, {
        text: parts[0],
        option_a: parts[1],
        option_b: parts[2],
        option_c: parts[3],
        option_d: parts[4] || '',
        correct_answer: (parts[5] || 'A').toUpperCase(),
        trigger_id: triggerDrawer.id
      })));
      setBulkQuestionsText('');
      fetchData();
    } catch (error) {
      console.error('Error bulk creating questions:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || 'Ошибка массового добавления вопросов');
    }
  };

  const handleDownloadSummaryPdf = async (pdfLanguage) => {
    setError(null);
    setSummaryDownloading(true);

    try {
      const params = { lang: pdfLanguage };
      if (canDownloadAnyTeacherSummary && summaryTeacherId) {
        params.teacher_id = summaryTeacherId;
      }

      const response = await axios.get(`${API_URL}/teacher/summary/pdf/`, {
        params,
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `summary-report-${pdfLanguage}-${summaryTeacherId || 'all'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading summary PDF:', error);
      setError(
        error.response?.data?.error ||
        error.response?.data?.detail ||
        'Ошибка скачивания сводной ведомости'
      );
    } finally {
      setSummaryDownloading(false);
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

  const getQuestionTriggerId = (question) =>
    String(question.trigger?.id || question.trigger_id || '');

  const getFilteredQuestions = () => {
    const search = questionSearch.trim().toLowerCase();
    return (questions || []).filter((question) => {
      const matchesSearch = !search || String(question.text || '').toLowerCase().includes(search);
      const matchesTrigger = !questionTriggerFilter || getQuestionTriggerId(question) === String(questionTriggerFilter);
      return matchesSearch && matchesTrigger;
    });
  };

  const selectRandom100 = (sourceQuestions = questions) => {
    const shuffled = [...(sourceQuestions || [])].sort(() => 0.5 - Math.random());
    setSelectedQuestions(shuffled.slice(0, 100).map(q => q.id));
  };

  const selectAll = (sourceQuestions = questions) => {
    setSelectedQuestions((sourceQuestions || []).slice(0, 100).map(q => q.id));
  };

  const clearSelection = () => {
    setSelectedQuestions([]);
  };

  const saveTestDraft = () => {
    localStorage.setItem('teacherTestDraft', JSON.stringify({
      title: newTest.title,
      selectedTriggerIds,
      selectedQuestions,
      savedAt: new Date().toISOString()
    }));
    alert(t('tests.draft_saved'));
  };

  const renderCreateTestForm = () => {
    const filteredQuestions = getFilteredQuestions();
    const questionsPerPage = 10;
    const totalPages = Math.max(1, Math.ceil(filteredQuestions.length / questionsPerPage));
    const safePage = Math.min(questionPage, totalPages);
    const pagedQuestions = filteredQuestions.slice((safePage - 1) * questionsPerPage, safePage * questionsPerPage);
    const selectedTriggers = (triggers || []).filter((trigger) => selectedTriggerIds.includes(trigger.id));
    const selectedTriggerQuestionTotal = selectedTriggers.reduce((sum, trigger) => sum + (trigger.question_count || 0), 0);
    const hasAutoQuestions = selectedTriggerIds.length > 0;
    const autoQuestionCount = hasAutoQuestions ? selectedTriggerQuestionTotal : selectedQuestions.length;
    const isReady = Boolean(newTest.title.trim()) && (
      hasAutoQuestions ? selectedTriggerQuestionTotal > 0 : selectedQuestions.length === 100
    );
    const readinessText = isReady
      ? t('tests.ready_to_create')
      : !newTest.title.trim()
        ? t('tests.enter_title')
        : hasAutoQuestions
          ? t('tests.not_enough_questions', { count: selectedTriggerQuestionTotal })
          : t('tests.choose_exactly_100');
    const stepItems = [
      { id: 1, title: t('tests.step_title') },
      { id: 2, title: t('tests.step_triggers') },
      { id: 3, title: t('tests.step_questions') },
      { id: 4, title: t('tests.step_done') }
    ];
    const baseQuota = selectedTriggers.length ? Math.floor(100 / selectedTriggers.length) : 0;
    const remainder = selectedTriggers.length ? 100 % selectedTriggers.length : 0;
    const triggerAllocation = selectedTriggers.map((trigger, index) => ({
      ...trigger,
      take: Math.min(trigger.question_count || 0, baseQuota + (index < remainder ? 1 : 0))
    }));
    const allocatedCount = triggerAllocation.reduce((sum, trigger) => sum + trigger.take, 0);
    if (allocatedCount < 100) {
      let shortage = 100 - allocatedCount;
      triggerAllocation.forEach((trigger) => {
        if (shortage <= 0) return;
        const availableExtra = Math.max(0, (trigger.question_count || 0) - trigger.take);
        const extra = Math.min(availableExtra, shortage);
        trigger.take += extra;
        shortage -= extra;
      });
    }
    const triggerIcons = [
      'M12 6v12m6-6H6',
      'M4 6h16M4 12h16M4 18h10',
      'M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      'M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
    ];

    return (
      <form onSubmit={handleCreateTest} className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm md:p-6">
        <div className="mb-6 overflow-x-auto">
          <div className="flex min-w-[680px] items-center gap-3">
            {stepItems.map((step, index) => (
              <React.Fragment key={step.id}>
                <button
                  type="button"
                  onClick={() => setCreateTestStep(step.id)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                    createTestStep === step.id
                      ? 'bg-green-600 text-white shadow-md'
                      : createTestStep > step.id
                        ? 'bg-green-50 text-green-700'
                        : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    createTestStep === step.id ? 'bg-white text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {step.id}
                  </span>
                  {step.title}
                </button>
                {index < stepItems.length - 1 && <div className="h-px flex-1 bg-gray-200" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {createTestStep === 1 && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h5 className="text-lg font-semibold text-gray-900">{t('tests.step1_title')}</h5>
                  <p className="text-sm text-gray-500">{t('tests.step1_hint')}</p>
                </div>
                <button type="button" className="text-sm font-semibold text-green-700" onClick={() => setCreateTestStep(2)}>
                  {t('common.next')}
                </button>
              </div>
              <input
                type="text"
                className="input-modern"
                value={newTest.title}
                onChange={(e) => setNewTest({...newTest, title: e.target.value})}
                required
                placeholder={t('tests.example_title_placeholder')}
              />
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                  onClick={() => setCreateTestStep(2)}
                >
                  {t('tests.go_to_triggers')}
                </button>
              </div>
            </section>
            )}

            {createTestStep === 2 && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h5 className="text-lg font-semibold text-gray-900">{t('tests.step2_title')}</h5>
                  <p className="text-sm text-gray-500">{t('tests.step2_hint')}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
                  {t('questions.total_with_count', { count: selectedTriggerQuestionTotal })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {selectableTriggerCards.map((trigger, index) => {
                  const selected = selectedTriggerIds.includes(trigger.id);
                  const childTriggers = triggerChildrenByParent[String(trigger.id)] || [];
                  const triggerId = String(trigger.id);
                  const isExpanded = expandedTriggerIds.includes(triggerId);
                  return (
                    <div
                      key={trigger.id}
                      className={`rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                        selected
                          ? 'border-green-500 bg-green-50 ring-2 ring-green-100'
                          : 'border-gray-200 bg-white hover:border-green-200'
                      }`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => {
                          if (childTriggers.length > 0) {
                            setExpandedTriggerIds((current) =>
                              current.includes(triggerId)
                                ? current.filter(id => id !== triggerId)
                                : [...current, triggerId]
                            );
                          } else {
                            setSelectedTriggerIds((current) =>
                              current.includes(trigger.id)
                                ? current.filter(id => id !== trigger.id)
                                : [...current, trigger.id]
                            );
                          }
                          setSelectedQuestions([]);
                          setCreateTestStep(2);
                        }}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                            selected ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
                          }`}>
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={triggerIcons[index % triggerIcons.length]} />
                            </svg>
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 shadow-sm">
                            {t('questions.count_label', { count: trigger.question_count || 0 })}
                          </span>
                        </div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <h6 className="text-base font-semibold text-gray-900">{trigger.name}</h6>
                          {childTriggers.length > 0 && (
                            <span className="text-lg font-semibold text-gray-400">{isExpanded ? '-' : '+'}</span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-sm text-gray-500">{trigger.description || trigger.slug || t('questions.category')}</p>
                      </button>
                      {childTriggers.length > 0 && isExpanded && (
                        <div className="mt-3 space-y-2 border-l-2 border-green-100 pl-4">
                          {childTriggers.map((child) => {
                            const childSelected = selectedTriggerIds.includes(child.id);
                            return (
                              <button
                                key={child.id}
                                type="button"
                                className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                                  childSelected
                                    ? 'border-green-500 bg-green-100 text-green-800'
                                    : 'border-gray-200 bg-gray-50 text-gray-800 hover:border-green-200 hover:bg-green-50'
                                }`}
                                onClick={() => {
                                  setSelectedTriggerIds((current) =>
                                    current.includes(child.id)
                                      ? current.filter(id => id !== child.id)
                                      : [...current, child.id]
                                  );
                                  setSelectedQuestions([]);
                                  setCreateTestStep(2);
                                }}
                              >
                                {child.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {hasAutoQuestions && (
                <div className="mt-4 rounded-xl border border-green-100 bg-green-50 p-4">
                  <p className="text-sm font-semibold text-green-800">{t('questions.auto_set')}</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {triggerAllocation.map((trigger) => (
                      <div key={trigger.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                        <span className="font-medium text-gray-700">{trigger.name}</span>
                        <span className="font-semibold text-green-700">{t('questions.from_count', { take: trigger.take, total: trigger.question_count || 0 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                  onClick={() => setCreateTestStep(1)}
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                  onClick={() => setCreateTestStep(3)}
                >
                  {t('tests.go_to_questions')}
                </button>
              </div>
            </section>
            )}

            {createTestStep === 3 && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h5 className="text-lg font-semibold text-gray-900">{t('tests.step3_title')}</h5>
                  <p className="text-sm text-gray-500">
                    {t('tests.step3_hint')}
                  </p>
                </div>
                <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  isReady ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
                }`}>
                  {readinessText}
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
                <input
                  type="text"
                  className="input-modern"
                  value={questionSearch}
                  onChange={(e) => {
                    setQuestionSearch(e.target.value);
                    setQuestionPage(1);
                  }}
                  placeholder={t('questions.search_by_text')}
                />
                <select
                  className="input-modern"
                  value={questionFilterMainTriggerId}
                  onChange={(e) => {
                    setQuestionTriggerFilter(e.target.value);
                    setQuestionPage(1);
                  }}
                >
                  <option value="">{t('triggers.all')}</option>
                  {selectableTriggerCards.map((trigger) => (
                    <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>
                  ))}
                </select>
                {questionFilterMainTriggerId && (
                  questionFilterSubTriggers.length > 0 ? (
                    <select
                      className="input-modern"
                      value={questionFilterSubTriggerId}
                      onChange={(e) => {
                        setQuestionTriggerFilter(e.target.value || questionFilterMainTriggerId);
                        setQuestionPage(1);
                      }}
                    >
                      <option value="">{t('triggers.select_subtrigger')}</option>
                      {questionFilterSubTriggers.map((trigger) => (
                        <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">{t('triggers.no_subtriggers')}</div>
                  )
                )}
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => {
                    setSelectedTriggerIds([]);
                    selectAll(filteredQuestions);
                  }}
                  disabled={hasAutoQuestions || filteredQuestions.length === 0}
                >
                  {t('common.choose_all')}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => {
                    setSelectedTriggerIds([]);
                    selectRandom100(filteredQuestions);
                  }}
                  disabled={hasAutoQuestions || filteredQuestions.length === 0}
                >
                  {t('questions.random_100')}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  onClick={clearSelection}
                >
                  {t('common.clear_selection')}
                </button>
              </div>

              <div className="space-y-2">
                {pagedQuestions.map((question, index) => {
                  const triggerName = question.trigger?.name || (triggers || []).find((trigger) => String(trigger.id) === getQuestionTriggerId(question))?.name || t('questions.no_category');
                  return (
                    <label
                      key={question.id}
                      className={`block rounded-xl border p-3 transition-colors ${
                        selectedQuestions.includes(question.id)
                          ? 'border-green-300 bg-green-50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      } ${hasAutoQuestions ? 'opacity-70' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600"
                          checked={selectedQuestions.includes(question.id)}
                          onChange={() => {
                            setSelectedTriggerIds([]);
                            toggleQuestionSelection(question.id);
                          }}
                          disabled={hasAutoQuestions}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                              ? {question.id}
                            </span>
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                              {triggerName}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-900">{question.text}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">{t('common.shown_from', { shown: pagedQuestions.length, total: filteredQuestions.length })}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
                    onClick={() => setQuestionPage((page) => Math.max(1, page - 1))}
                    disabled={safePage <= 1}
                  >
                    {t('common.back')}
                  </button>
                  <span className="text-sm font-semibold text-gray-700">{safePage} / {totalPages}</span>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
                    onClick={() => setQuestionPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safePage >= totalPages}
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                  onClick={() => setCreateTestStep(2)}
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                  onClick={() => setCreateTestStep(4)}
                >
                  {t('tests.review_and_create')}
                </button>
              </div>
            </section>
            )}

            {createTestStep === 4 && (
              <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-5">
                  <h5 className="text-lg font-semibold text-gray-900">{t('tests.step4_title')}</h5>
                  <p className="text-sm text-gray-500">{t('tests.step4_hint')}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">{t('tests.title')}</p>
                    <p className="mt-2 text-sm font-bold text-gray-900">{newTest.title || t('common.not_specified')}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">{t('questions.questions')}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">
                      {hasAutoQuestions ? autoQuestionCount : `${autoQuestionCount} / 100`}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">{t('triggers.triggers')}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">{selectedTriggerIds.length}</p>
                  </div>
                </div>
                {triggerAllocation.length > 0 && (
                  <div className="mt-4 rounded-xl border border-green-100 bg-green-50 p-4">
                    <p className="text-sm font-semibold text-green-800">{t('questions.distribution')}</p>
                    <div className="mt-2 space-y-2">
                      {triggerAllocation.map((trigger) => (
                        <div key={trigger.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                          <span className="font-medium text-gray-700">{trigger.name}</span>
                          <span className="font-semibold text-green-700">{trigger.take}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-5 flex flex-wrap justify-between gap-3">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                    onClick={() => setCreateTestStep(3)}
                  >
                    {t('common.back')}
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-green-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!isReady}
                  >
                    {t('tests.create')}
                  </button>
                </div>
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h5 className="text-lg font-semibold text-gray-900">{t('tests.preview_title')}</h5>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500">{t('tests.title')}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{newTest.title || t('common.not_specified')}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500">{t('triggers.selected')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedTriggers.length ? selectedTriggers.map((trigger) => (
                      <span key={trigger.id} className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                        {trigger.name}
                      </span>
                    )) : <span className="text-sm text-gray-500">{t('questions.manual_selection')}</span>}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-600">{t('questions.selected_count')}</span>
                    <span className="font-bold text-gray-900">
                      {hasAutoQuestions ? autoQuestionCount : `${autoQuestionCount} / 100`}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${isReady ? 'bg-green-600' : 'bg-yellow-500'}`}
                      style={{ width: `${hasAutoQuestions ? (autoQuestionCount > 0 ? 100 : 0) : Math.min(100, autoQuestionCount)}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">{t('triggers.count_label')}</p>
                    <p className="text-xl font-bold text-gray-900">{selectedTriggerIds.length}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">{t('common.status')}</p>
                    <p className={`text-sm font-bold ${isReady ? 'text-green-700' : 'text-yellow-700'}`}>
                      {isReady ? t('common.ready') : t('common.not_ready')}
                    </p>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-green-600 px-5 py-4 text-base font-bold text-white shadow-lg transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!isReady}
                >
                  {t('tests.create')}
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
                  onClick={saveTestDraft}
                >
                  {t('common.save_draft')}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </form>
    );
  };

  const handleOpenResultDetail = async (result) => {
    setLoadingResultDetail(true);
    setSelectedResultDetail(null);

    try {
      const response = await axios.get(`${API_URL}/teacher/attempts/${result.id}/result/`);
      setSelectedResultDetail(response.data);
    } catch (error) {
      console.error('Error loading attempt detail:', error);
      setError(error.response?.data?.detail || error.response?.data?.error || t('results.detail_load_error'));
    } finally {
      setLoadingResultDetail(false);
    }
  };

  const closeResultDetail = () => {
    setSelectedResultDetail(null);
  };

  const getStudentName = (result) => {
    const fullName = result?.student_name?.trim();
    return fullName || result?.student_username || t('common.no_name');
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
    const testTitle = localizeDisplayText(detail?.attempt?.test?.title) || '-';
    const completedAt = detail?.attempt?.completed_at
      ? formatLocalizedDateTime(detail.attempt.completed_at)
      : '-';
    const rows = questionsForExport.map((question, index) => {
      const answer = answersByQuestionId.get(question.id);
      const selectedKey = answer?.selected_option || '';
      const selectedText = selectedKey
        ? localizeField(question, `option_${selectedKey.toLowerCase()}`, language) || ''
        : '';
      const questionText = localizeField(question, 'text', language);
      const optionA = localizeField(question, 'option_a', language);
      const optionB = localizeField(question, 'option_b', language);
      const optionC = localizeField(question, 'option_c', language);
      const optionD = localizeField(question, 'option_d', language);
      const statusText = answer
        ? (answer.is_correct ? t('answers.correct') : t('answers.incorrect'))
        : t('answers.no_answer');
      const bg = answer
        ? (answer.is_correct ? '#dcfce7' : '#fee2e2')
        : '#f9fafb';

      return `
        <tr style="background:${bg}">
          <td>${question.id}</td>
          <td>${escapeHtml(questionText || '')}</td>
          <td>A. ${escapeHtml(optionA || '')}<br />B. ${escapeHtml(optionB || '')}<br />C. ${escapeHtml(optionC || '')}${optionD ? `<br />D. ${escapeHtml(optionD)}` : ''}</td>
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
          <h1>${escapeHtml(t('export.student_test'))}</h1>
          <p><strong>${escapeHtml(t('common.student'))}:</strong> ${escapeHtml(studentName)}</p>
          <p><strong>${escapeHtml(t('login.username'))}:</strong> ${escapeHtml(detail?.student?.username || '-')}</p>
          <p><strong>${escapeHtml(t('tests.test'))}:</strong> ${escapeHtml(testTitle)}</p>
          <p><strong>${escapeHtml(t('results.submit_date'))}:</strong> ${escapeHtml(completedAt)}</p>
          <p><strong>${escapeHtml(t('results.result'))}:</strong> ${escapeHtml(detail?.correct_count || 0)} / ${escapeHtml(detail?.total_questions || questionsForExport.length)}</p>
          <table>
            <thead>
              <tr>
                <th>?</th>
                <th>${escapeHtml(t('questions.question'))}</th>
                <th>${escapeHtml(t('answers.options'))}</th>
                <th>${escapeHtml(t('answers.student_answer'))}</th>
                <th>${escapeHtml(t('answers.correct_answer'))}</th>
                <th>${escapeHtml(t('common.status'))}</th>
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

    printPdfDocument(buildStudentTestDocument(selectedResultDetail), filename, t('export.allow_popups'));
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

  const triggerStats = {
    total: (triggers || []).length,
    active: (triggers || []).filter((trigger) => trigger.is_active).length,
    questions: (triggers || []).reduce((sum, trigger) => sum + (trigger.question_count || 0), 0),
    attempts: (triggers || []).reduce((sum, trigger) => sum + (trigger.attempts_count || 0), 0)
  };

  const visibleTriggers = (triggers || [])
    .filter((trigger) => {
      const matchesName = !triggerSearchName.trim() || String(trigger.name || '').toLowerCase().includes(triggerSearchName.trim().toLowerCase());
      const matchesCode = !triggerSearchCode.trim() || String(trigger.slug || '').toLowerCase().includes(triggerSearchCode.trim().toLowerCase());
      const matchesStatus =
        triggerStatusFilter === 'all' ||
        (triggerStatusFilter === 'active' && trigger.is_active) ||
        (triggerStatusFilter === 'inactive' && !trigger.is_active);
      return matchesName && matchesCode && matchesStatus;
    })
    .sort((a, b) => {
      if (triggerSort === 'questions_desc') return (b.question_count || 0) - (a.question_count || 0);
      if (triggerSort === 'questions_asc') return (a.question_count || 0) - (b.question_count || 0);
      if (triggerSort === 'created_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  const triggerChildrenByParent = (triggers || []).reduce((acc, trigger) => {
    if (!trigger.parent_id) return acc;
    const parentId = String(trigger.parent_id);
    acc[parentId] = [...(acc[parentId] || []), trigger];
    return acc;
  }, {});
  Object.values(triggerChildrenByParent).forEach((children) => {
    children.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  });
  const visibleTriggerCards = visibleTriggers.filter((trigger) => !trigger.parent_id);
  const selectableTriggerCards = (triggers || []).filter((trigger) => !trigger.parent_id);
  const getMainTriggerId = (triggerId) => {
    const selected = (triggers || []).find((trigger) => String(trigger.id) === String(triggerId));
    return selected?.parent_id ? String(selected.parent_id) : String(triggerId || '');
  };
  const getSubTriggerId = (triggerId) => {
    const selected = (triggers || []).find((trigger) => String(trigger.id) === String(triggerId));
    return selected?.parent_id ? String(selected.id) : '';
  };
  const questionMainTriggerId = getMainTriggerId(newQuestion.trigger_id);
  const questionSubTriggerId = getSubTriggerId(newQuestion.trigger_id);
  const questionSubTriggers = questionMainTriggerId ? (triggerChildrenByParent[String(questionMainTriggerId)] || []) : [];
  const questionFilterMainTriggerId = getMainTriggerId(questionTriggerFilter);
  const questionFilterSubTriggerId = getSubTriggerId(questionTriggerFilter);
  const questionFilterSubTriggers = questionFilterMainTriggerId ? (triggerChildrenByParent[String(questionFilterMainTriggerId)] || []) : [];
  const questionManagerMainTriggerId = getMainTriggerId(questionManagerTriggerFilter);
  const questionManagerSubTriggerId = getSubTriggerId(questionManagerTriggerFilter);
  const questionManagerSubTriggers = questionManagerMainTriggerId ? (triggerChildrenByParent[String(questionManagerMainTriggerId)] || []) : [];
  const testFilterMainTriggerId = getMainTriggerId(testTriggerFilter);
  const testFilterSubTriggerId = getSubTriggerId(testTriggerFilter);
  const testFilterSubTriggers = testFilterMainTriggerId ? (triggerChildrenByParent[String(testFilterMainTriggerId)] || []) : [];
  const bulkMoveMainTriggerId = getMainTriggerId(bulkMoveTriggerId);
  const bulkMoveSubTriggerId = getSubTriggerId(bulkMoveTriggerId);
  const bulkMoveSubTriggers = bulkMoveMainTriggerId ? (triggerChildrenByParent[String(bulkMoveMainTriggerId)] || []) : [];

  const drawerQuestions = triggerDrawer
    ? getTriggerQuestions(triggerDrawer).filter((question) =>
        !triggerQuestionSearch.trim() ||
        String(question.text || '').toLowerCase().includes(triggerQuestionSearch.trim().toLowerCase())
      )
    : [];

  const questionStats = {
    total: (questions || []).length,
    active: (questions || []).filter((question) => question.trigger?.is_active !== false).length,
    triggers: (triggers || []).length,
    latest: (questions || []).reduce((latest, question) => {
      const value = question.created_at ? new Date(question.created_at) : null;
      return value && (!latest || value > latest) ? value : latest;
    }, null)
  };

  const filteredManagedQuestions = (questions || [])
    .filter((question) => {
      const search = questionManagerSearch.trim().toLowerCase();
      const matchesText = !search || String(question.text || '').toLowerCase().includes(search);
      const triggerId = String(question.trigger?.id || question.trigger_id || '');
      const matchesTrigger = !questionManagerTriggerFilter || triggerId === String(questionManagerTriggerFilter);
      const matchesAnswer = !questionManagerAnswerFilter || question.correct_answer === questionManagerAnswerFilter;
      return matchesText && matchesTrigger && matchesAnswer;
    })
    .sort((a, b) => {
      if (questionManagerSort === 'id_asc') return a.id - b.id;
      if (questionManagerSort === 'created_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (questionManagerSort === 'created_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      return b.id - a.id;
    });
  const questionTotalPages = Math.max(1, Math.ceil(filteredManagedQuestions.length / questionManagerPageSize));
  const questionSafePage = Math.min(questionManagerPage, questionTotalPages);
  const pagedManagedQuestions = filteredManagedQuestions.slice(
    (questionSafePage - 1) * questionManagerPageSize,
    questionSafePage * questionManagerPageSize
  );

  const getTestResults = (test) =>
    (results || []).filter((result) => result.test_id === test.id || result.test_title === test.title);

  const getTestMetrics = (test) => {
    const testResults = getTestResults(test);
    const percentages = testResults.map((result) =>
      result.total_questions > 0 ? Math.round((result.score / result.total_questions) * 100) : 0
    );
    return {
      attempts: testResults.length,
      average: percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length) : 0,
      best: percentages.length ? Math.max(...percentages) : 0,
      worst: percentages.length ? Math.min(...percentages) : 0,
      success: percentages.length ? Math.round((percentages.filter((value) => value >= 50).length / percentages.length) * 100) : 0,
      distribution: [0, 50, 70, 90].map((min, index, ranges) => {
        const max = ranges[index + 1] ?? 101;
        return percentages.filter((value) => value >= min && value < max).length;
      })
    };
  };

  const testStats = {
    total: (tests || []).length,
    active: (tests || []).filter((test) => test.is_active).length,
    questions: (tests || []).reduce((sum, test) => sum + (test.question_count || 100), 0),
    attempts: (results || []).length
  };

  const filteredTests = (tests || [])
    .filter((test) => {
      const matchesSearch = !testSearch.trim() || String(test.title || '').toLowerCase().includes(testSearch.trim().toLowerCase());
      const matchesStatus =
        testStatusFilter === 'all' ||
        (testStatusFilter === 'active' && test.is_active) ||
        (testStatusFilter === 'draft' && !test.is_active);
      const matchesDate = !testDateFilter || (test.created_at && new Date(test.created_at).toISOString().slice(0, 10) === testDateFilter);
      const matchesTrigger = !testTriggerFilter || (test.triggers || []).some((trigger) => String(trigger.id) === String(testTriggerFilter));
      return matchesSearch && matchesStatus && matchesDate && matchesTrigger;
    })
    .sort((a, b) => {
      if (testSort === 'title_asc') return String(a.title || '').localeCompare(String(b.title || ''));
      if (testSort === 'questions_desc') return (b.question_count || 100) - (a.question_count || 100);
      if (testSort === 'attempts_desc') return getTestMetrics(b).attempts - getTestMetrics(a).attempts;
      if (testSort === 'created_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  const testTotalPages = Math.max(1, Math.ceil(filteredTests.length / testPageSize));
  const testSafePage = Math.min(testPage, testTotalPages);
  const pagedTests = filteredTests.slice((testSafePage - 1) * testPageSize, testSafePage * testPageSize);

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{t('teacher.dashboard.title')}</h1>
        <p className="text-gray-500 mt-1">{t('teacher.dashboard.subtitle')}</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-700">{error}</p>
        </div>
      )}
      
      <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-xl">
        <button 
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'results' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => openTab('results')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t('results.results')}
          </span>
        </button>
        <button
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'filter' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => openTab('filter')}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 01.8 1.6L14 13.67V19a1 1 0 01-.45.83l-4 2.67A1 1 0 018 21.67v-8L3.2 4.6A1 1 0 013 4z" />
            </svg>
            {t('filter.filter')}
          </span>
        </button>
        <button
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'tests' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => openTab('tests')}
        >
          {t('tests.tests')}
        </button>
        {canManageTriggers && (
          <>
            <button
              className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'questions' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              onClick={() => openTab('questions')}
            >
              {t('questions.section')}
            </button>
            <button
              className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'triggers' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              onClick={() => openTab('triggers')}
            >
              {t('triggers.triggers')}
            </button>
          </>
        )}
        <button
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'students' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => {
            openTab('students');
            if (students.length === 0) {
              fetchStudents();
            }
          }}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 18.72a8.38 8.38 0 00-12 0M12 12a4 4 0 100-8 4 4 0 000 8zm8 8a8 8 0 10-16 0" />
            </svg>
            {t('students.students')}
          </span>
        </button>
        {canManageTeachers && (
          <button 
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === 'teachers' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => openTab('teachers')}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              {t('teachers.teachers')}
            </span>
          </button>
        )}
      </div>

      {activeTab === 'filter' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('results.submit_date')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-modern"
                  placeholder={t('date.placeholder')}
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
                <h4 className="text-lg font-semibold text-gray-900">{t('results.completed_tests')}</h4>
                <p className="text-sm text-gray-500">{t('common.found')}: {filteredResults.length}</p>
              </div>

              {(filteredResults || []).length === 0 ? (
                <div className="p-8 text-center text-gray-500">{t('results.no_test_data')}</div>
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
                            <div className="text-sm text-gray-700 mt-2">{localizeDisplayText(result.test_title)}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {formatLocalizedDateTime(result.completed_at)}
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
                  <h4 className="text-lg font-semibold text-gray-900">{t('results.student_details')}</h4>
                  <p className="text-sm text-gray-500">{t('results.selected_answers')}</p>
                </div>
                {selectedResultDetail && (
                  <button
                    type="button"
                    onClick={closeResultDetail}
                    className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
                  >
                    {t('common.close')}
                  </button>
                )}
              </div>

              {loadingResultDetail ? (
                <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>
              ) : !selectedResultDetail ? (
                <div className="p-8 text-center text-gray-500">{t('results.select_student_left')}</div>
              ) : (
                <div className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-xl bg-green-50 border border-green-200 p-4">
                      <div className="text-2xl font-bold text-green-700">{selectedResultDetail.correct_count}</div>
                      <div className="text-sm text-gray-600">{t('results.correct_short')}</div>
                    </div>
                    <div className="rounded-xl bg-red-50 border border-red-200 p-4">
                      <div className="text-2xl font-bold text-red-700">{selectedResultDetail.incorrect_count}</div>
                      <div className="text-sm text-gray-600">{t('results.incorrect_short')}</div>
                    </div>
                    <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                      <div className="text-2xl font-bold text-blue-700">{selectedResultDetail.total_questions}</div>
                      <div className="text-sm text-gray-600">{t('questions.total')}</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadStudentTest}
                      className="rounded-xl bg-gray-900 p-4 text-left text-white hover:bg-gray-800 transition-colors"
                    >
                      <div className="text-base font-semibold">{t('export.download_pdf')}</div>
                      <div className="text-sm text-gray-300">{t('export.student_pdf_file')}</div>
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {(selectedResultDetail.attempt?.answers || []).map((answer, index) => {
                      const fullQuestion = (selectedResultDetail.questions || []).find(
                        (question) => question.id === answer.question?.id
                      );
                      const correctKey = fullQuestion?.correct_answer;
                      const selectedText = answer.selected_option && fullQuestion
                        ? localizeField(fullQuestion, `option_${answer.selected_option.toLowerCase()}`, language)
                        : '';
                      const correctText = correctKey
                        ? localizeField(fullQuestion, `option_${correctKey.toLowerCase()}`, language)
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
                                #{fullQuestion?.id || answer.question?.id} {localizeField(fullQuestion || answer.question, 'text', language)}
                              </div>
                              <div className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                answer.is_correct
                                  ? 'bg-green-600 text-white'
                                  : 'bg-red-600 text-white'
                              }`}>
                                {t('results.chosen')}: {answer.selected_option}
                                {selectedText ? ` - ${selectedText}` : ''}
                              </div>
                              {!answer.is_correct && correctKey && (
                                <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-600 text-white">
                                  {t('answers.correct_answer')}: {correctKey}
                                  {correctText ? ` - ${correctText}` : ''}
                                </div>
                              )}
                            </div>
                            <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${
                              answer.is_correct
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {answer.is_correct ? t('answers.correct') : t('answers.incorrect')}
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
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-3xl font-bold text-gray-900">{testStats.total}</p><p className="text-sm text-gray-500">{t('tests.total')}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-3xl font-bold text-green-700">{testStats.active}</p><p className="text-sm text-gray-500">{t('tests.active_total')}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-3xl font-bold text-blue-700">{testStats.questions}</p><p className="text-sm text-gray-500">{t('questions.total')}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-3xl font-bold text-amber-700">{testStats.attempts}</p><p className="text-sm text-gray-500">{t('tests.total_attempts')}</p></div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-xl font-semibold text-gray-900">{t('tests.management')}</h4>
                <p className="text-sm text-gray-500">{t('tests.panel_subtitle')}</p>
              </div>
              <button
                type="button"
                className="rounded-xl bg-green-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-green-700"
                onClick={() => setShowCreateTest(true)}
              >
                {t('tests.create')}
              </button>
            </div>

            {showCreateTest && (
              <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <input className="input-modern" value={newTest.title} onChange={(e) => setNewTest({...newTest, title: e.target.value})} placeholder={t('tests.title')} />
                  <input className="input-modern" value={testSettings.description} onChange={(e) => setTestSettings({...testSettings, description: e.target.value})} placeholder={t('common.description')} />
                  <input className="input-modern bg-gray-100" type="number" value={50} readOnly title="Единый лимит для всех тестов — 50 минут" placeholder={t('tests.duration_minutes')} />
                  <input className="input-modern" type="number" value={testSettings.attempts} onChange={(e) => setTestSettings({...testSettings, attempts: e.target.value})} placeholder={t('tests.attempts')} />
                </div>
                {renderCreateTestForm()}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_170px_180px_180px_180px]">
              <input className="input-modern" value={testSearch} onChange={(e) => { setTestSearch(e.target.value); setTestPage(1); }} placeholder={t('tests.search_by_title')} />
              <select className="input-modern" value={testStatusFilter} onChange={(e) => { setTestStatusFilter(e.target.value); setTestPage(1); }}>
                <option value="all">{t('tests.all_statuses')}</option>
                <option value="active">{t('common.active_plural')}</option>
                <option value="draft">{t('tests.drafts')}</option>
              </select>
              <input className="input-modern" type="date" value={testDateFilter} onChange={(e) => { setTestDateFilter(e.target.value); setTestPage(1); }} />
              <select className="input-modern" value={testFilterMainTriggerId} onChange={(e) => { setTestTriggerFilter(e.target.value); setTestPage(1); }}>
                <option value="">{t('triggers.all')}</option>
                {selectableTriggerCards.map((trigger) => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
              </select>
              {testFilterMainTriggerId && (
                testFilterSubTriggers.length > 0 ? (
                  <select className="input-modern" value={testFilterSubTriggerId} onChange={(e) => { setTestTriggerFilter(e.target.value || testFilterMainTriggerId); setTestPage(1); }}>
                    <option value="">{t('triggers.select_subtrigger')}</option>
                    {testFilterSubTriggers.map((trigger) => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
                  </select>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">{t('triggers.no_subtriggers')}</div>
                )
              )}
              <select className="input-modern" value={testSort} onChange={(e) => setTestSort(e.target.value)}>
                <option value="created_desc">{t('sort.new_first')}</option>
                <option value="created_asc">{t('sort.old_first')}</option>
                <option value="title_asc">{t('sort.by_title')}</option>
                <option value="questions_desc">{t('sort.more_questions')}</option>
                <option value="attempts_desc">{t('sort.more_attempts')}</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {pagedTests.map((test) => {
                const metrics = getTestMetrics(test);
                const statusText = test.is_active ? t('common.active') : t('tests.draft');
                const statusClass = test.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700';
                return (
                  <div key={test.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <h5 className="text-lg font-bold text-gray-900">{test.title}</h5>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{statusText}</span>
                        </div>
                        <p className="text-sm text-gray-500">{testSettings.description || t('tests.no_description')}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2 text-right">
                        <p className="text-xl font-bold text-gray-900">100</p>
                        <p className="text-xs text-gray-500">{t('questions.questions')}</p>
                      </div>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {(test.triggers || []).length ? (test.triggers || []).map((trigger) => (
                        <span key={trigger.id || trigger.slug || trigger.name} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{trigger.name || trigger.slug}</span>
                       )) : <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{t('triggers.none')}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                      <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('tests.attempts_done')}</p><p className="font-bold text-gray-900">{metrics.attempts}</p></div>
                      <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('stats.average_short')}</p><p className="font-bold text-gray-900">{metrics.average}%</p></div>
                      <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('stats.best')}</p><p className="font-bold text-gray-900">{metrics.best}%</p></div>
                      <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('stats.worst')}</p><p className="font-bold text-gray-900">{metrics.worst}%</p></div>
                      <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('stats.success_rate')}</p><p className="font-bold text-gray-900">{metrics.success}%</p></div>
                    </div>
                    <div className="mt-3 text-xs text-gray-500">{t('common.created_colon')} {test.created_at ? new Date(test.created_at).toLocaleString('ru-RU') : '-'}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setTestDrawer(test)}>{t('common.view')}</button>
                      <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => { setNewTest({ title: test.title }); setShowCreateTest(true); }}>{t('common.edit')}</button>
                      <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setTestDrawer(test)}>{t('stats.statistics')}</button>
                      <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => duplicateTest(test)}>{t('common.duplicate')}</button>
                      <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => toggleTestActive(test)}>{test.is_active ? t('common.deactivate') : t('common.activate')}</button>
                      <button type="button" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100" onClick={() => handleDeleteTest(test)}>{t('common.delete')}</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" value={testPageSize} onChange={(e) => { setTestPageSize(Number(e.target.value)); setTestPage(1); }}>
                {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{t('pagination.per_page', { count: size })}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50" disabled={testSafePage <= 1} onClick={() => setTestPage((page) => Math.max(1, page - 1))}>{t('common.back')}</button>
                <span className="text-sm font-semibold text-gray-700">{testSafePage} / {testTotalPages}</span>
                <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50" disabled={testSafePage >= testTotalPages} onClick={() => setTestPage((page) => Math.min(testTotalPages, page + 1))}>{t('common.next')}</button>
              </div>
            </div>
          </div>

          {testDrawer && (
            <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
              <button type="button" className="absolute inset-0 cursor-default" onClick={() => setTestDrawer(null)} aria-label={t('common.close')} />
              <div className="relative h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl">
                {(() => {
                  const metrics = getTestMetrics(testDrawer);
                  return (
                    <>
                      <div className="mb-5 flex items-start justify-between gap-3">
                        <div><h4 className="text-xl font-bold text-gray-900">{testDrawer.title}</h4><p className="text-sm text-gray-500">{t('tests.detail_subtitle')}</p></div>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setTestDrawer(null)}>{t('common.close')}</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                        <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs text-gray-500">{t('tests.attempts_done')}</p><p className="text-xl font-bold">{metrics.attempts}</p></div>
                        <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs text-gray-500">{t('stats.average_short')}</p><p className="text-xl font-bold">{metrics.average}%</p></div>
                        <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs text-gray-500">{t('stats.best')}</p><p className="text-xl font-bold">{metrics.best}%</p></div>
                        <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs text-gray-500">{t('stats.worst')}</p><p className="text-xl font-bold">{metrics.worst}%</p></div>
                        <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs text-gray-500">{t('stats.success_rate')}</p><p className="text-xl font-bold">{metrics.success}%</p></div>
                      </div>
                      <div className="mt-5 rounded-xl border border-gray-200 p-4">
                        <p className="mb-3 font-semibold text-gray-900">{t('tests.results_chart')}</p>
                        {['0-49%', '50-69%', '70-89%', '90-100%'].map((label, index) => (
                          <div key={label} className="mb-2">
                            <div className="mb-1 flex justify-between text-xs text-gray-500"><span>{label}</span><span>{metrics.distribution[index]}</span></div>
                            <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${metrics.attempts ? (metrics.distribution[index] / metrics.attempts) * 100 : 0}%` }} /></div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => duplicateTest(testDrawer)}>{t('common.create_copy')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => exportTest(testDrawer, 'pdf')}>{t('export.pdf')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => exportTest(testDrawer, 'excel')}>{t('export.excel')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => printTest(testDrawer)}>{t('tests.print')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => toggleTestActive(testDrawer)}>{t('tests.archive')}</button>
                        <button type="button" className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700" onClick={() => setTestPreview(testDrawer)}>{t('common.preview')}</button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {testPreview && (
            <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40 p-4">
              <div className="mx-auto max-w-3xl rounded-xl bg-white p-5 shadow-2xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><h4 className="text-xl font-bold text-gray-900">{t('common.preview_colon')} {testPreview.title}</h4><p className="text-sm text-gray-500">{t('tests.preview_subtitle')}</p></div>
                  <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setTestPreview(null)}>{t('common.close')}</button>
                </div>
                <div className="space-y-3">
                  {(testPreview.questions || []).slice(0, 100).map((question) => (
                    <div key={question.id} className="rounded-xl border border-gray-200 p-4">
                      <p className="font-semibold text-gray-900">{question.id}. {localizeField(question, 'text', language)}</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {['A', 'B', 'C', 'D'].map((key) => localizeField(question, `option_${key.toLowerCase()}`, language) && (
                          <div key={key} className={`rounded-lg px-3 py-2 text-sm ${question.correct_answer === key ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-700'}`}>{key}. {localizeField(question, `option_${key.toLowerCase()}`, language)}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'questions' && canManageTriggers && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-2xl font-bold text-gray-900">{questionStats.total}</p><p className="text-sm text-gray-500">{t('questions.total')}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-2xl font-bold text-green-700">{questionStats.active}</p><p className="text-sm text-gray-500">{t('common.active_many')}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-2xl font-bold text-blue-700">{questionStats.triggers}</p><p className="text-sm text-gray-500">{t('triggers.count_label')}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-lg font-bold text-gray-900">{questionStats.latest ? questionStats.latest.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'ky-KG') : '-'}</p><p className="text-sm text-gray-500">{t('questions.latest')}</p></div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-xl font-semibold text-gray-900">{editingQuestionId ? t('questions.edit') : t('questions.create')}</h4>
                <p className="text-sm text-gray-500">{t('questions.draft_autosave_hint')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100" onClick={handleAutoTranslateNewQuestion}>{t('questions.auto_translate')}</button>
                <button type="button" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setQuestionPreview(!questionPreview)}>{t('common.preview')}</button>
                <button type="button" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={clearQuestionForm}>{t('common.clear')}</button>
              </div>
            </div>
            <form onSubmit={handleCreateQuestion} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-gray-700">{t('questions.text')}</label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-bold uppercase text-gray-500">{t('language.ru_version')}</div>
                    <textarea className="input-modern min-h-[110px]" value={newQuestion.text_ru} onChange={(e) => setNewQuestion({...newQuestion, text: e.target.value, text_ru: e.target.value})} placeholder={t('questions.full_text_placeholder')} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-bold uppercase text-gray-500">{t('language.ky_version')}</div>
                    <textarea className="input-modern min-h-[110px]" value={newQuestion.text_ky} onChange={(e) => setNewQuestion({...newQuestion, text_ky: e.target.value})} placeholder={t('questions.text_ky_placeholder')} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">{t('questions.short_clear_hint')}</p>
              </div>
              {['a', 'b', 'c', 'd'].map((key) => (
                <div key={key}>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">{t('answers.option_label', { option: key.toUpperCase() })}</label>
                  <div className="grid grid-cols-1 gap-2">
                    <input className="input-modern" value={newQuestion[`option_${key}_ru`] || ''} onChange={(e) => setNewQuestion({...newQuestion, [`option_${key}`]: e.target.value, [`option_${key}_ru`]: e.target.value})} placeholder={t('answers.answer_ru_placeholder', { option: key.toUpperCase() })} />
                    <input className="input-modern" value={newQuestion[`option_${key}_ky`] || ''} onChange={(e) => setNewQuestion({...newQuestion, [`option_${key}_ky`]: e.target.value})} placeholder={t('answers.answer_ky_placeholder', { option: key.toUpperCase() })} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{key === 'd' ? t('answers.optional_hint') : t('answers.required_hint')}</p>
                </div>
              ))}
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">{t('triggers.trigger')}</label>
                <select
                  className="input-modern"
                  value={questionMainTriggerId}
                  onChange={(e) => setNewQuestion({...newQuestion, trigger_id: e.target.value})}
                >
                  <option value="">{t('triggers.select_trigger')}</option>
                  {selectableTriggerCards.map(trigger => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
                </select>
              </div>
              {questionMainTriggerId && (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">{t('triggers.subtrigger')}</label>
                  {questionSubTriggers.length > 0 ? (
                    <select
                      className="input-modern"
                      value={questionSubTriggerId}
                      onChange={(e) => setNewQuestion({...newQuestion, trigger_id: e.target.value || questionMainTriggerId})}
                    >
                      <option value="">{t('triggers.select_subtrigger')}</option>
                      {questionSubTriggers.map(trigger => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      {t('triggers.no_subtriggers')}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">{t('answers.correct_answer')}</label>
                <select className="input-modern" value={newQuestion.correct_answer} onChange={(e) => setNewQuestion({...newQuestion, correct_answer: e.target.value})}>
                  {['A', 'B', 'C', 'D'].map((option) => <option key={option} value={option}>{t('answers.option_label', { option })}</option>)}
                </select>
              </div>
              {questionPreview && (
                <div className="lg:col-span-2 rounded-xl border border-green-100 bg-green-50 p-4">
                  <p className="font-semibold text-gray-900">{localizeField(newQuestion, 'text', language) || t('questions.text')}</p>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {['A', 'B', 'C', 'D'].map((key) => localizeField(newQuestion, `option_${key.toLowerCase()}`, language) && (
                      <div key={key} className={`rounded-lg px-3 py-2 text-sm ${newQuestion.correct_answer === key ? 'bg-green-600 text-white' : 'bg-white text-gray-700'}`}>{key}. {localizeField(newQuestion, `option_${key.toLowerCase()}`, language)}</div>
                    ))}
                  </div>
                </div>
              )}
              <div className="lg:col-span-2 flex flex-wrap justify-end gap-2">
                <label className="cursor-pointer rounded-lg border border-gray-200 px-5 py-3 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50">
                  {t('questions.import')}
                  <input
                    type="file"
                    accept=".csv,.docx,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(event) => {
                      const selectedTrigger = (triggers || []).find((trigger) => String(trigger.id) === String(newQuestion.trigger_id));
                      if (!selectedTrigger) {
                        alert(t('questions.select_category_before_import'));
                        event.target.value = '';
                        return;
                      }
                      openQuestionImportTargetDialog(event, selectedTrigger);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-5 py-3 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
                  onClick={() => {
                    const selectedTrigger = (triggers || []).find((trigger) => String(trigger.id) === String(newQuestion.trigger_id));
                    if (!selectedTrigger) {
                      alert(t('questions.select_category_for_export'));
                      return;
                    }
                    exportTriggerQuestions(selectedTrigger);
                  }}
                >
                  {t('questions.export')}
                </button>
                <button type="submit" className="rounded-lg bg-green-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-green-700">{editingQuestionId ? t('questions.save') : t('questions.create')}</button>
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_200px_200px_180px_180px]">
              <input className="input-modern" value={questionManagerSearch} onChange={(e) => { setQuestionManagerSearch(e.target.value); setQuestionManagerPage(1); }} placeholder={t('questions.search_by_text')} />
              <select className="input-modern" value={questionManagerMainTriggerId} onChange={(e) => { setQuestionManagerTriggerFilter(e.target.value); setQuestionManagerPage(1); }}>
                <option value="">{t('triggers.all')}</option>
                {selectableTriggerCards.map(trigger => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
              </select>
              {questionManagerMainTriggerId && (
                questionManagerSubTriggers.length > 0 ? (
                  <select className="input-modern" value={questionManagerSubTriggerId} onChange={(e) => { setQuestionManagerTriggerFilter(e.target.value || questionManagerMainTriggerId); setQuestionManagerPage(1); }}>
                    <option value="">{t('triggers.select_subtrigger')}</option>
                    {questionManagerSubTriggers.map(trigger => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
                  </select>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">{t('triggers.no_subtriggers')}</div>
                )
              )}
              <select className="input-modern" value={questionManagerAnswerFilter} onChange={(e) => { setQuestionManagerAnswerFilter(e.target.value); setQuestionManagerPage(1); }}>
                <option value="">{t('answers.all')}</option>
                {['A', 'B', 'C', 'D'].map(answer => <option key={answer} value={answer}>{t('answers.answer_with_option', { option: answer })}</option>)}
              </select>
              <select className="input-modern" value={questionManagerSort} onChange={(e) => setQuestionManagerSort(e.target.value)}>
                <option value="id_desc">{t('sort.id_desc')}</option>
                <option value="id_asc">{t('sort.id_asc')}</option>
                <option value="created_desc">{t('sort.new_first')}</option>
                <option value="created_asc">{t('sort.old_first')}</option>
              </select>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setSelectedQuestionIds(pagedManagedQuestions.map((question) => question.id))}>{t('common.choose_all')}</button>
              <button type="button" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100" onClick={bulkDeleteQuestions}>{t('questions.bulk_delete')}</button>
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" value={bulkMoveMainTriggerId} onChange={(e) => setBulkMoveTriggerId(e.target.value)}>
                <option value="">{t('triggers.change')}</option>
                {selectableTriggerCards.map(trigger => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
              </select>
              {bulkMoveMainTriggerId && (
                bulkMoveSubTriggers.length > 0 ? (
                  <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" value={bulkMoveSubTriggerId} onChange={(e) => setBulkMoveTriggerId(e.target.value || bulkMoveMainTriggerId)}>
                    <option value="">{t('triggers.select_subtrigger')}</option>
                    {bulkMoveSubTriggers.map(trigger => <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>)}
                  </select>
                ) : (
                  <span className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600">{t('triggers.no_subtriggers')}</span>
                )
              )}
              <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={bulkMoveQuestions}>{t('common.apply')}</button>
              <label className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">{t('questions.import_csv')}<input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleQuestionImport} /></label>
              <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => exportQuestions('csv')}>{t('export.excel')}</button>
              <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => exportQuestions('pdf')}>{t('export.pdf')}</button>
              <span className="ml-auto text-sm text-gray-500">{t('common.selected', { count: selectedQuestionIds.length })}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {pagedManagedQuestions.map((q) => (
                <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <div className="mb-3 flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600" checked={selectedQuestionIds.includes(q.id)} onChange={() => setSelectedQuestionIds((current) => current.includes(q.id) ? current.filter(id => id !== q.id) : [...current, q.id])} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">#{q.id}</span>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{q.trigger?.name || '-'}</span>
                        <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">{t('answers.correct_option', { option: q.correct_answer })}</span>
                      </div>
                      <h5 className="text-base font-bold text-gray-900">{localizeField(q, 'text', language)}</h5>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {['A', 'B', 'C', 'D'].map((key) => localizeField(q, `option_${key.toLowerCase()}`, language) && (
                      <div key={key} className={`rounded-lg px-3 py-2 text-sm ${q.correct_answer === key ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-700'}`}>{key}. {localizeField(q, `option_${key.toLowerCase()}`, language)}</div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-gray-500">{t('common.created_colon')} {q.created_at ? new Date(q.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'ky-KG') : '-'}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => startEditQuestion(q)}>{t('common.edit')}</button>
                    <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setQuestionDrawer(q)}>{t('common.view')}</button>
                    <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => copyQuestion(q)}>{t('common.copy')}</button>
                    <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" onChange={(e) => moveQuestionToTrigger(q, e.target.value)} defaultValue="">
                      <option value="">{t('common.move')}</option>
                      {(triggers || []).map(trigger => <option key={trigger.id} value={trigger.id}>{trigger.name}</option>)}
                    </select>
                    <button type="button" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100" onClick={() => handleDeleteQuestion(q.id)}>{t('common.delete')}</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" value={questionManagerPageSize} onChange={(e) => { setQuestionManagerPageSize(Number(e.target.value)); setQuestionManagerPage(1); }}>
                {[10, 25, 50, 100].map(size => <option key={size} value={size}>{t('pagination.per_page', { count: size })}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50" disabled={questionSafePage <= 1} onClick={() => setQuestionManagerPage(page => Math.max(1, page - 1))}>{t('common.back')}</button>
                <span className="text-sm font-semibold text-gray-700">{questionSafePage} / {questionTotalPages}</span>
                <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50" disabled={questionSafePage >= questionTotalPages} onClick={() => setQuestionManagerPage(page => Math.min(questionTotalPages, page + 1))}>{t('common.next')}</button>
              </div>
            </div>
          </div>

          {questionDrawer && (
            <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
              <button type="button" className="absolute inset-0 cursor-default" onClick={() => setQuestionDrawer(null)} aria-label={t('common.close')} />
              <div className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div><h4 className="text-xl font-bold text-gray-900">{t('questions.question')} #{questionDrawer.id}</h4><p className="text-sm text-gray-500">{t('questions.history_created', { date: questionDrawer.created_at ? new Date(questionDrawer.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'ky-KG') : '-' })}</p></div>
                  <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setQuestionDrawer(null)}>{t('common.close')}</button>
                </div>
                <p className="rounded-xl bg-gray-50 p-4 text-base font-semibold text-gray-900">{localizeField(questionDrawer, 'text', language)}</p>
                <div className="mt-4 space-y-2">
                  {['A', 'B', 'C', 'D'].map((key) => localizeField(questionDrawer, `option_${key.toLowerCase()}`, language) && (
                    <div key={key} className={`rounded-xl px-4 py-3 ${questionDrawer.correct_answer === key ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-700'}`}>{key}. {localizeField(questionDrawer, `option_${key.toLowerCase()}`, language)}</div>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">{t('answers.correct_answer')}</p><p className="font-bold text-gray-900">{questionDrawer.correct_answer}</p></div>
                  <div className="rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">{t('triggers.trigger')}</p><p className="font-bold text-gray-900">{questionDrawer.trigger?.name || '-'}</p></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'triggers' && canManageTriggers && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: t('triggers.total_label'), value: triggerStats.total, tone: 'bg-green-50 text-green-700' },
              { label: t('common.active_many'), value: triggerStats.active, tone: 'bg-blue-50 text-blue-700' },
              { label: t('questions.section'), value: triggerStats.questions, tone: 'bg-purple-50 text-purple-700' },
              { label: t('triggers.tests_count'), value: triggerStats.attempts, tone: 'bg-amber-50 text-amber-700' }
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className={`mb-3 inline-flex rounded-lg px-3 py-2 ${item.tone}`}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
                  </svg>
                </div>
                <p className="text-3xl font-bold text-gray-900">{item.value}</p>
                <p className="mt-1 text-sm font-medium text-gray-500">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-xl font-semibold text-gray-900">{t('triggers.create')}</h4>
                <p className="text-sm text-gray-500">{t('triggers.create_hint')}</p>
              </div>
              {triggerNotice && (
                <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  triggerNotice === 'triggers.notice_saved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {t(triggerNotice)}
                </div>
              )}
            </div>

            <form onSubmit={handleCreateTrigger} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h8M7 17h6" />
                  </svg>
                  {t('triggers.name')}
                </label>
                <input
                  className="input-modern"
                  value={newTrigger.name}
                  onChange={(e) => setNewTrigger({...newTrigger, name: e.target.value})}
                  required
                  placeholder={t('triggers.name_placeholder')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('triggers.name_hint')}</p>
              </div>
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3" />
                  </svg>
                  {t('triggers.code')}
                </label>
                <input
                  className="input-modern"
                  value={newTrigger.slug}
                  onChange={(e) => setNewTrigger({...newTrigger, slug: e.target.value})}
                  required
                  placeholder="tactical-training"
                />
                <p className="mt-1 text-xs text-gray-500">{t('triggers.code_hint')}</p>
              </div>
              <div className="lg:col-span-2">
                <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  {t('common.description')}
                </label>
                <textarea
                  className="input-modern min-h-[96px]"
                  value={newTrigger.description}
                  onChange={(e) => setNewTrigger({...newTrigger, description: e.target.value})}
                  placeholder={t('triggers.description_placeholder')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('triggers.description_hint')}</p>
              </div>
              <div className="lg:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-green-600"
                    checked={newTrigger.is_active}
                    onChange={(e) => setNewTrigger({...newTrigger, is_active: e.target.checked})}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{newTrigger.is_active ? t('common.active') : t('common.inactive')}</span>
                    <span className="block text-xs text-gray-500">{t('triggers.inactive_hint')}</span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50" onClick={clearTriggerForm}>
                    {t('common.clear')}
                  </button>
                  <button type="submit" className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700">
                    {t('triggers.create')}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h4 className="text-xl font-semibold text-gray-900">{t('triggers.create_subtrigger')}</h4>
              <p className="text-sm text-gray-500">{t('triggers.create_subtrigger_hint')}</p>
            </div>
            <form onSubmit={handleCreateSubTrigger} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  {t('triggers.parent_trigger')}
                </label>
                <select
                  className="input-modern"
                  value={newSubTrigger.parent}
                  onChange={(e) => setNewSubTrigger({ ...newSubTrigger, parent: e.target.value })}
                  required
                >
                  <option value="">{t('triggers.select_parent_trigger')}</option>
                  {selectableTriggerCards.map((trigger) => (
                    <option key={trigger.id} value={trigger.id}>{t(trigger.name)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  {t('triggers.subtrigger_name')}
                </label>
                <input
                  className="input-modern"
                  value={newSubTrigger.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setNewSubTrigger({
                      ...newSubTrigger,
                      name,
                      slug: newSubTrigger.slugEdited ? newSubTrigger.slug : buildSlug(name)
                    });
                  }}
                  required
                  placeholder={t('triggers.subtrigger_name_placeholder')}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  {t('triggers.subtrigger_code')}
                </label>
                <input
                  className="input-modern"
                  value={newSubTrigger.slug}
                  onChange={(e) => setNewSubTrigger({ ...newSubTrigger, slug: buildSlug(e.target.value), slugEdited: true })}
                  placeholder={t('triggers.subtrigger_code_placeholder')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('triggers.subtrigger_code_hint')}</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  {t('common.description')}
                </label>
                <textarea
                  className="input-modern min-h-[96px]"
                  value={newSubTrigger.description}
                  onChange={(e) => setNewSubTrigger({ ...newSubTrigger, description: e.target.value })}
                  placeholder={t('triggers.description_placeholder')}
                />
              </div>
              <div className="lg:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-green-600"
                    checked={newSubTrigger.is_active}
                    onChange={(e) => setNewSubTrigger({ ...newSubTrigger, is_active: e.target.checked })}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{newSubTrigger.is_active ? t('common.active') : t('common.inactive')}</span>
                    <span className="block text-xs text-gray-500">{t('triggers.inactive_hint')}</span>
                  </span>
                </label>
                <button type="submit" className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700">
                  {t('triggers.create_subtrigger')}
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-xl font-semibold text-gray-900">{t('triggers.triggers')}</h4>
                <p className="text-sm text-gray-500">{t('triggers.found_from', { shown: visibleTriggerCards.length, total: (triggers || []).length })}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input className="input-modern" value={triggerSearchName} onChange={(e) => setTriggerSearchName(e.target.value)} placeholder={t('triggers.search_by_name')} />
                <input className="input-modern" value={triggerSearchCode} onChange={(e) => setTriggerSearchCode(e.target.value)} placeholder={t('triggers.search_by_code')} />
                <select className="input-modern" value={triggerStatusFilter} onChange={(e) => setTriggerStatusFilter(e.target.value)}>
                  <option value="all">{t('tests.all_statuses')}</option>
                  <option value="active">{t('common.active_plural')}</option>
                  <option value="inactive">{t('common.inactive_many')}</option>
                </select>
                <select className="input-modern" value={triggerSort} onChange={(e) => setTriggerSort(e.target.value)}>
                  <option value="created_desc">{t('sort.new_first')}</option>
                  <option value="created_asc">{t('sort.old_first')}</option>
                  <option value="questions_desc">{t('sort.more_questions')}</option>
                  <option value="questions_asc">{t('triggers.less_questions')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {visibleTriggerCards.map((trigger) => {
                const triggerId = String(trigger.id);
                const childTriggers = triggerChildrenByParent[triggerId] || [];
                const isExpanded = expandedTriggerIds.includes(triggerId);
                return (
                <div key={trigger.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                  {editingTriggerId === trigger.id ? (
                    <form onSubmit={handleUpdateTrigger} className="space-y-3">
                      <select
                        className="input-modern"
                        value={editingTrigger.parent}
                        onChange={(e) => setEditingTrigger({...editingTrigger, parent: e.target.value})}
                      >
                        <option value="">{t('triggers.main_trigger')}</option>
                        {selectableTriggerCards
                          .filter((parent) => parent.id !== trigger.id)
                          .map((parent) => (
                            <option key={parent.id} value={parent.id}>{t(parent.name)}</option>
                          ))}
                      </select>
                      <input className="input-modern" value={editingTrigger.name} onChange={(e) => setEditingTrigger({...editingTrigger, name: e.target.value})} required />
                      <input className="input-modern" value={editingTrigger.slug} onChange={(e) => setEditingTrigger({...editingTrigger, slug: e.target.value})} required />
                      <textarea className="input-modern min-h-[80px]" value={editingTrigger.description} onChange={(e) => setEditingTrigger({...editingTrigger, description: e.target.value})} />
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-green-600" checked={editingTrigger.is_active} onChange={(e) => setEditingTrigger({...editingTrigger, is_active: e.target.checked})} />
                        {t('common.active')}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">{t('common.save')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setEditingTriggerId(null)}>{t('common.cancel')}</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            {childTriggers.length > 0 ? (
                              <button
                                type="button"
                                className="flex items-center gap-2 text-left text-lg font-bold text-gray-900"
                                onClick={() => {
                                  setExpandedTriggerIds((current) =>
                                    current.includes(triggerId)
                                      ? current.filter((id) => id !== triggerId)
                                      : [...current, triggerId]
                                  );
                                }}
                              >
                                <span>{t(trigger.name)}</span>
                                <span className="text-gray-400">{isExpanded ? '-' : '+'}</span>
                              </button>
                            ) : (
                              <h5 className="text-lg font-bold text-gray-900">{t(trigger.name)}</h5>
                            )}
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${trigger.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {trigger.is_active ? t('common.active') : t('common.inactive')}
                            </span>
                          </div>
                          <p className="text-sm font-mono text-gray-500">{trigger.slug}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 text-right">
                          <p className="text-xl font-bold text-gray-900">{trigger.question_count || 0}</p>
                          <p className="text-xs text-gray-500">{t('questions.questions')}</p>
                        </div>
                      </div>
                      <p className="mb-4 min-h-[40px] text-sm text-gray-600">{trigger.description ? t(trigger.description) : t('triggers.no_description')}</p>
                      {childTriggers.length > 0 && isExpanded && (
                        <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                          <p className="mb-2 text-xs font-semibold uppercase text-emerald-700">{t('triggers.subblocks')}</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {childTriggers.map((child) => (
                              <div
                                key={child.id}
                                className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm text-gray-800"
                              >
                                <button
                                  type="button"
                                  className="block w-full text-left font-semibold hover:text-emerald-700"
                                  onClick={() => openTriggerQuestions(child)}
                                >
                                  <span className="block">{t(child.name)}</span>
                                  <span className="mt-1 block text-xs font-normal text-gray-500">{child.question_count || 0} {t('questions.questions')}</span>
                                </button>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <label className="cursor-pointer rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                                    {t('questions.import')}
                                    <input
                                      type="file"
                                      accept=".csv,.docx,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                      className="hidden"
                                      onChange={(event) => openQuestionImportTargetDialog(event, child)}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                    onClick={() => exportTriggerQuestions(child)}
                                  >
                                    {t('questions.export')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('tests.attempts_done')}</p><p className="font-bold text-gray-900">{trigger.attempts_count || 0}</p></div>
                        <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('stats.average_score')}</p><p className="font-bold text-gray-900">{trigger.average_score || 0}</p></div>
                        <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('stats.success_rate')}</p><p className="font-bold text-gray-900">{trigger.success_rate || 0}%</p></div>
                        <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{t('common.created')}</p><p className="font-bold text-gray-900">{trigger.created_at ? new Date(trigger.created_at).toLocaleDateString('ru-RU') : '-'}</p></div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => startEditTrigger(trigger)}>{t('common.edit')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => openTriggerQuestions(trigger)}>{t('common.view')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => openTriggerQuestions(trigger)}>{t('questions.section')}</button>
                        <label className="cursor-pointer rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                          {t('questions.import')}
                          <input
                            type="file"
                            accept=".csv,.docx,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            className="hidden"
                            onChange={(event) => openQuestionImportTargetDialog(event, trigger)}
                          />
                        </label>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => exportTriggerQuestions(trigger)}>{t('questions.export')}</button>
                        <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => openTriggerQuestions(trigger)}>{t('stats.statistics')}</button>
                        <button type="button" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100" onClick={() => handleDeleteTrigger(trigger)}>{t('common.delete')}</button>
                      </div>
                    </>
                  )}
                </div>
                );
              })}
            </div>
          </div>

          {triggerDrawer && (
            <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
              <button type="button" className="absolute inset-0 cursor-default" onClick={() => setTriggerDrawer(null)} aria-label={t('triggers.drawer_aria')} />
              <div className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-xl font-bold text-gray-900">{t(triggerDrawer.name)}</h4>
                    <p className="text-sm text-gray-500">{t('triggers.questions_count', { count: getTriggerQuestions(triggerDrawer).length })}</p>
                  </div>
                  <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setTriggerDrawer(null)}>
                    {t('common.close')}
                  </button>
                </div>

                <input className="input-modern mb-4" value={triggerQuestionSearch} onChange={(e) => setTriggerQuestionSearch(e.target.value)} placeholder={t('triggers.search_questions')} />

                <form onSubmit={handleCreateDrawerQuestion} className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <h5 className="mb-3 font-semibold text-gray-900">{t('questions.add')}</h5>
                  <div className="space-y-3">
                    <button type="button" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100" onClick={handleAutoTranslateDrawerQuestion}>{t('questions.auto_translate')}</button>
                    <textarea className="input-modern min-h-[80px]" value={drawerQuestionForm.text_ru} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, text: e.target.value, text_ru: e.target.value})} placeholder={t('questions.text_ru_placeholder')} />
                    <textarea className="input-modern min-h-[80px]" value={drawerQuestionForm.text_ky} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, text_ky: e.target.value})} placeholder={t('questions.drawer_text_ky_placeholder')} />
                    <input className="input-modern" value={drawerQuestionForm.option_a_ru} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_a: e.target.value, option_a_ru: e.target.value})} placeholder={t('answers.option_ru_placeholder', { option: 'A' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_a_ky} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_a_ky: e.target.value})} placeholder={t('answers.option_ky_placeholder', { option: 'A' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_b_ru} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_b: e.target.value, option_b_ru: e.target.value})} placeholder={t('answers.option_ru_placeholder', { option: 'B' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_b_ky} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_b_ky: e.target.value})} placeholder={t('answers.option_ky_placeholder', { option: 'B' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_c_ru} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_c: e.target.value, option_c_ru: e.target.value})} placeholder={t('answers.option_ru_placeholder', { option: 'C' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_c_ky} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_c_ky: e.target.value})} placeholder={t('answers.option_ky_placeholder', { option: 'C' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_d_ru} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_d: e.target.value, option_d_ru: e.target.value})} placeholder={t('answers.option_ru_placeholder', { option: 'D' })} />
                    <input className="input-modern" value={drawerQuestionForm.option_d_ky} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, option_d_ky: e.target.value})} placeholder={t('answers.option_ky_placeholder', { option: 'D' })} />
                    <select className="input-modern" value={drawerQuestionForm.correct_answer} onChange={(e) => setDrawerQuestionForm({...drawerQuestionForm, correct_answer: e.target.value})}>
                      <option value="A">{t('answers.correct_option', { option: 'A' })}</option>
                      <option value="B">{t('answers.correct_option', { option: 'B' })}</option>
                      <option value="C">{t('answers.correct_option', { option: 'C' })}</option>
                      <option value="D">{t('answers.correct_option', { option: 'D' })}</option>
                    </select>
                    <button type="submit" className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700">{t('questions.add')}</button>
                  </div>
                </form>

                <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
                  <h5 className="mb-2 font-semibold text-gray-900">{t('questions.bulk_add')}</h5>
                  <textarea className="input-modern min-h-[120px]" value={bulkQuestionsText} onChange={(e) => setBulkQuestionsText(e.target.value)} placeholder={t('questions.bulk_placeholder')} />
                  <p className="mt-1 text-xs text-gray-500">{t('questions.bulk_hint')}</p>
                  <button type="button" className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={handleBulkCreateQuestions}>
                    {t('questions.add_as_list')}
                  </button>
                </div>

                <div className="space-y-2">
                  {drawerQuestions.map((question) => (
                    <div key={question.id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">#{question.id} {localizeField(question, 'text', language)}</p>
                          <p className="mt-1 text-xs text-gray-500">A: {localizeField(question, 'option_a', language)} | B: {localizeField(question, 'option_b', language)} | C: {localizeField(question, 'option_c', language)}{localizeField(question, 'option_d', language) ? ` | D: ${localizeField(question, 'option_d', language)}` : ''}</p>
                        </div>
                        <button type="button" className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100" onClick={() => handleDeleteQuestion(question.id)}>
                          {t('common.delete')}
                        </button>
                      </div>
                    </div>
                  ))}
                  {drawerQuestions.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                      {t('questions.not_found')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h4 className="text-xl font-semibold text-gray-900">{t('Результаты учеников')}</h4>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {canDownloadAnyTeacherSummary && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Экзаменатор')}</label>
                  <select
                    className="input-modern min-w-[220px]"
                    value={summaryTeacherId}
                    onFocus={() => {
                      if (teachers.length === 0) {
                        fetchTeachers();
                      }
                    }}
                    onChange={(e) => setSummaryTeacherId(e.target.value)}
                  >
                    <option value="">{t('Все экзаменаторы')}</option>
                    {teachers.map((teacher) => {
                      const teacherName = `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim() || teacher.username;
                      return (
                        <option key={teacher.id} value={teacher.id}>
                          {teacherName} (@{teacher.username})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              <button
                type="button"
                className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                onClick={() => handleDownloadSummaryPdf('ru')}
                disabled={summaryDownloading}
              >
                {summaryDownloading ? t('common.generating') : t('export.download_pdf_ru')}
              </button>
              <button
                type="button"
                className="px-6 py-3 bg-white text-gray-800 font-semibold rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                onClick={() => handleDownloadSummaryPdf('kg')}
                disabled={summaryDownloading}
              >
                {summaryDownloading ? t('common.generating') : t('export.download_pdf_ky')}
              </button>
            </div>
          </div>
          {(results || []).length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
              <p className="text-gray-900 font-medium text-lg">{t('Нет результатов')}</p>
              <p className="text-sm text-gray-500 mt-2">{t('Ученики ещё не прошли тесты')}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div
                className="w-full max-w-full overflow-x-auto overscroll-x-contain"
                style={{ overflowX: 'auto', overflowY: 'visible' }}
              >
              <table
                className="shrink-0 table-fixed"
                style={{ width: '1460px', minWidth: '1460px', tableLayout: 'fixed' }}
              >
                <colgroup>
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '300px' }} />
                  <col style={{ width: '240px' }} />
                  <col style={{ width: '140px' }} />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '240px' }} />
                  <col style={{ width: '220px' }} />
                </colgroup>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-[200px] min-w-[200px] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Ученик')}</th>
                    <th className="w-[300px] min-w-[300px] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Тест')}</th>
                    <th className="w-[240px] min-w-[240px] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Триггеры')}</th>
                    <th className="w-[140px] min-w-[140px] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Результат')}</th>
                    <th className="w-[120px] min-w-[120px] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Процент')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '240px', minWidth: '240px', whiteSpace: 'nowrap', overflow: 'visible' }}>{t('Оценка')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '220px', minWidth: '220px', whiteSpace: 'nowrap', overflow: 'visible' }}>{t('Дата')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(results || []).map(result => {
                    const percentage = result.total_questions > 0 
                      ? Math.round((result.score / result.total_questions) * 100) 
                      : 0;
                    let grade = t('Неудовлетворительно');
                    let gradeColor = 'text-red-600 bg-red-50';
                    if (percentage >= 90) {
                      grade = t('Отлично');
                      gradeColor = 'text-green-600 bg-green-50';
                    } else if (percentage >= 70) {
                      grade = t('Хорошо');
                      gradeColor = 'text-blue-600 bg-blue-50';
                    } else if (percentage >= 50) {
                      grade = t('Удовлетворительно');
                      gradeColor = 'text-yellow-600 bg-yellow-50';
                    }
                    return (
                      <tr key={result.id} className="hover:bg-gray-50">
                        <td className="w-[200px] min-w-[200px] px-4 py-4 align-top">
                          <div className="text-sm font-medium text-gray-900 break-words">{getStudentName(result)}</div>
                          <div className="text-sm text-gray-500 break-all">@{result.student_username}</div>
                        </td>
                        <td className="w-[300px] min-w-[300px] px-4 py-4 align-top text-sm text-gray-900 break-words">
                          {localizeDisplayText(result.test_title)}
                        </td>
                        <td className="w-[240px] min-w-[240px] px-4 py-4 align-top text-sm text-gray-500 break-words">
                          {formatLocalizedTriggers(result.triggers) || '-'}
                        </td>
                        <td className="w-[140px] min-w-[140px] px-4 py-4 align-top">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            percentage >= 70 ? 'bg-green-100 text-green-800' : percentage >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {result.score} / {result.total_questions}
                          </span>
                        </td>
                        <td className="w-[120px] min-w-[120px] px-4 py-4 align-top text-sm text-gray-900">
                          {percentage}%
                        </td>
                        <td
                          className="px-4 py-4 align-top"
                          style={{ width: '240px', minWidth: '240px', overflow: 'visible', whiteSpace: 'nowrap' }}
                        >
                          <span
                            className={`rounded-full text-xs font-medium leading-none ${gradeColor}`}
                            style={{
                              display: 'inline-block',
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                              overflow: 'visible',
                              padding: '4px 12px',
                              lineHeight: 1
                            }}
                          >
                            {grade}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-gray-500" style={{ width: '220px', minWidth: '220px', whiteSpace: 'nowrap', overflow: 'visible' }}>
                          {formatLocalizedDateTime(result.completed_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'students' && (
        <div>
          <div className="mb-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
              onClick={() => setShowCreateStudent(!showCreateStudent)}
            >
              {showCreateStudent ? t('common.cancel') : t('students.create')}
            </button>
            <button
              type="button"
              className="px-6 py-3 bg-white text-gray-800 font-semibold rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 transition-all duration-200"
              onClick={fetchStudents}
            >
              {t('common.refresh')}
            </button>
          </div>

          {showCreateStudent && (
            <div className="glass-card rounded-2xl p-6 mb-6">
              <h4 className="text-xl font-semibold text-gray-900 mb-4">{t('students.create_account')}</h4>
              <form onSubmit={handleCreateStudent} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Логин')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newStudent.username}
                    onChange={(e) => setNewStudent({...newStudent, username: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Пароль')}</label>
                  <input
                    type="password"
                    className="input-modern"
                    value={newStudent.password}
                    onChange={(e) => setNewStudent({...newStudent, password: e.target.value})}
                    required
                    minLength="6"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Имя')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newStudent.first_name}
                    onChange={(e) => setNewStudent({...newStudent, first_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Фамилия')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newStudent.last_name}
                    onChange={(e) => setNewStudent({...newStudent, last_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Воинское звание')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newStudent.military_rank}
                    onChange={(e) => setNewStudent({...newStudent, military_rank: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Отчество')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newStudent.patronymic}
                    onChange={(e) => setNewStudent({...newStudent, patronymic: e.target.value})}
                  />
                </div>
                <label className="md:col-span-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    checked={Boolean(newStudent.training_mode)}
                    onChange={(e) => setNewStudent({...newStudent, training_mode: e.target.checked})}
                  />
                  <span data-no-translate>Training mode: highlight correct answers</span>
                </label>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    {t('students.create')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {editingStudentId && (
            <div className="glass-card rounded-2xl p-6 mb-6">
              <h4 className="text-xl font-semibold text-gray-900 mb-4">{t('students.edit')}</h4>
              <form onSubmit={handleUpdateStudent} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Логин')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={editingStudent.username}
                    onChange={(e) => setEditingStudent({...editingStudent, username: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Новый пароль')}</label>
                  <input
                    type="password"
                    className="input-modern"
                    value={editingStudent.password}
                    onChange={(e) => setEditingStudent({...editingStudent, password: e.target.value})}
                    minLength="6"
                    placeholder={t('Оставьте пустым, чтобы не менять')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Имя')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={editingStudent.first_name}
                    onChange={(e) => setEditingStudent({...editingStudent, first_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Фамилия')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={editingStudent.last_name}
                    onChange={(e) => setEditingStudent({...editingStudent, last_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Воинское звание')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={editingStudent.military_rank}
                    onChange={(e) => setEditingStudent({...editingStudent, military_rank: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('Отчество')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={editingStudent.patronymic}
                    onChange={(e) => setEditingStudent({...editingStudent, patronymic: e.target.value})}
                  />
                </div>
                <label className="md:col-span-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    checked={Boolean(editingStudent.training_mode)}
                    onChange={(e) => setEditingStudent({...editingStudent, training_mode: e.target.checked})}
                  />
                  <span data-no-translate>Training mode: highlight correct answers</span>
                </label>
                <div className="md:col-span-2 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    {t('Сохранить')}
                  </button>
                  <button
                    type="button"
                    className="px-6 py-3 bg-white text-gray-800 font-semibold rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 transition-all duration-200"
                    onClick={cancelEditStudent}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h4 className="text-xl font-semibold text-gray-900">{t('students.students')}</h4>
              <p className="text-sm text-gray-500">{t('students.found', { count: students.length })}</p>
            </div>

            {loadingStudents ? (
              <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>
            ) : students.length === 0 ? (
              <div className="p-8 text-center text-gray-500">{t('students.not_found')}</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('ФИО')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Логин')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('Звание')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" data-no-translate>Mode</th>
                    {canManageTeachers && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('teachers.teacher')}</th>
                    )}
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {students.map((student) => {
                    const studentName = `${student.last_name || ''} ${student.first_name || ''} ${student.patronymic || ''}`.trim() || '-';
                    return (
                      <tr key={student.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{studentName}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">@{student.username}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{student.military_rank || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {student.training_mode ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800" data-no-translate>
                              Training
                            </span>
                          ) : (
                            <span className="text-gray-400" data-no-translate>Exam</span>
                          )}
                        </td>
                        {canManageTeachers && (
                          <td className="px-6 py-4 text-sm text-gray-500">{student.teacher_name || '-'}</td>
                        )}
                        <td className="px-6 py-4 text-sm text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-white text-gray-700 font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                              onClick={() => startEditStudent(student)}
                            >
                              {t('common.edit')}
                            </button>
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-red-50 text-red-700 font-medium rounded-lg border border-red-100 hover:bg-red-100 transition-colors"
                              onClick={() => handleDeleteStudent(student)}
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'teachers' && canManageTeachers && (
        <div>
          <div className="mb-4 flex flex-wrap gap-3">
            <button 
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
              onClick={() => setShowCreateTeacher(!showCreateTeacher)}
            >
              {showCreateTeacher ? t('common.cancel') : t('teachers.create')}
            </button>
            <button
              type="button"
              className="px-6 py-3 bg-white text-gray-800 font-semibold rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 transition-all duration-200"
              onClick={handleToggleTeacherList}
            >
              {showTeacherList ? t('teachers.hide_list') : t('teachers.list')}
            </button>
            <button
              type="button"
              className="px-6 py-3 bg-white text-gray-800 font-semibold rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 transition-all duration-200"
              onClick={() => setShowCreateTest(!showCreateTest)}
            >
              {showCreateTest ? t('common.cancel') : t('teachers.add_test')}
            </button>
          </div>

          {showCreateTest && renderCreateTestForm()}

          {showTeacherList && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h4 className="text-xl font-semibold text-gray-900">{t('teachers.list')}</h4>
                  <p className="text-sm text-gray-500">{t('teachers.found', { count: teachers.length })}</p>
                </div>
                <button
                  type="button"
                  onClick={fetchTeachers}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  {t('common.refresh')}
                </button>
              </div>

              {loadingTeachers ? (
                <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>
              ) : teachers.length === 0 ? (
                <div className="p-8 text-center text-gray-500">{t('teachers.not_found')}</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('common.full_name')}</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('login.username')}</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('common.status')}</th>
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
                              {teacher.is_main_teacher ? t('teachers.main') : t('teachers.teacher')}
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
              <h4 className="text-xl font-semibold text-gray-900 mb-4">{t('teachers.create_new')}</h4>
              <form onSubmit={handleCreateTeacher} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('login.username')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newTeacher.username}
                    onChange={(e) => setNewTeacher({...newTeacher, username: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('common.first_name')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newTeacher.first_name}
                    onChange={(e) => setNewTeacher({...newTeacher, first_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('common.last_name')}</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newTeacher.last_name}
                    onChange={(e) => setNewTeacher({...newTeacher, last_name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('common.password')}</label>
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
                  {t('teachers.create')}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {pendingQuestionSubmit && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h4 className="text-xl font-bold text-gray-900">{t('questions.add_target_title')}</h4>
            <p className="mt-1 text-sm text-gray-500">
              {t('questions.add_target_hint')}
            </p>
            <select
              className="input-modern mt-4"
              value={questionTargetTriggerId}
              onChange={(e) => setQuestionTargetTriggerId(e.target.value)}
              autoFocus
            >
              <option value="">{t('questions.select_category')}</option>
              {(triggers || []).map((trigger) => (
                <option key={trigger.id} value={trigger.id}>
                  {trigger.name}
                </option>
              ))}
            </select>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setPendingQuestionSubmit(null);
                  setQuestionTargetTriggerId('');
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
                onClick={confirmQuestionSubmit}
              >
                {t('questions.add_to_selected_category')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingQuestionImportFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h4 className="text-xl font-bold text-gray-900">{t('questions.import_target_title')}</h4>
            <p className="mt-1 text-sm text-gray-500">
              {t('common.file_colon')} <span className="font-semibold text-gray-700">{pendingQuestionImportFile.name}</span>
            </p>
            <select
              className="input-modern mt-4"
              value={questionImportTargetTriggerId}
              onChange={(e) => setQuestionImportTargetTriggerId(e.target.value)}
              autoFocus
            >
              <option value="">{t('questions.select_category')}</option>
              {(triggers || []).map((trigger) => (
                <option key={trigger.id} value={trigger.id}>
                  {trigger.name}
                </option>
              ))}
            </select>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setPendingQuestionImportFile(null);
                  setQuestionImportTargetTriggerId('');
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
                onClick={confirmQuestionImport}
              >
                {t('questions.import_to_selected_category')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
