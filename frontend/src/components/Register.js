import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';
import API_URL from '../config/api';

const Register = () => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'student'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [studentCount, setStudentCount] = useState(0);
  const [maxStudents] = useState(50);
  const {
    login
  } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    fetchStudentCount();
  }, []);
  const fetchStudentCount = async () => {
    try {
      const response = await axios.get(`${API_URL}/student-count/`);
      setStudentCount(response.data.student_count);
    } catch (error) {
      console.error('Error fetching student count:', error);
    }
  };
  const handleChange = e => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };
  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (formData.role === 'student' && studentCount >= maxStudents) {
      setError(`${t('Достигнут лимит в')} ${maxStudents} ${t('учеников. Регистрация невозможна.')}`);
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/register/`, formData);
      if (response.data.user) {
        setSuccess(t('Регистрация успешна! Выполняется вход...'));
        const loginResult = await login(formData.username, formData.password);
        if (loginResult.success) {
          setTimeout(() => {
            if (formData.role === 'teacher') {
              navigate('/teacher/dashboard');
            } else {
              navigate('/student/profile');
            }
          }, 1000);
        } else {
          setSuccess(t('Регистрация успешна! Теперь вы можете войти.'));
          setTimeout(() => navigate('/login'), 2000);
        }
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.response?.data?.username?.[0] || error.response?.data?.email?.[0] || t('Ошибка регистрации');
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };
  const isStudentLimitReached = studentCount >= maxStudents;
  return <div className="register-container">
      <div className="card shadow">
        <div className="card-body p-4">
          <h2 className="text-center mb-4">{t('Регистрация')}</h2>
          
          {isStudentLimitReached && formData.role === 'student' && <div className="alert alert-warning" role="alert">
              {t('Достигнут лимит в')} {maxStudents} {t('учеников. Регистрация невозможна.')}
            </div>}
          
          {error && <div className="alert alert-danger" role="alert">
              {error}
            </div>}
          
          {success && <div className="alert alert-success" role="alert">
              {success}
            </div>}
          
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">{t('Роль')}</label>
              <select className="form-select" name="role" value={formData.role} onChange={handleChange} required>
                <option value="student">{t('Ученик')}</option>
                <option value="teacher">{t('Экзаменатор')}</option>
              </select>
              {formData.role === 'student' && <small className="text-muted">
                  {t('Учеников в системе')}: {studentCount} / {maxStudents}
                </small>}
            </div>
            
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">{t('Имя')}</label>
                <input type="text" className="form-control" name="first_name" value={formData.first_name} onChange={handleChange} placeholder={t('Введите имя')} />
              </div>
              
              <div className="col-md-6 mb-3">
                <label className="form-label">{t('Фамилия')}</label>
                <input type="text" className="form-control" name="last_name" value={formData.last_name} onChange={handleChange} placeholder={t('Введите фамилию')} />
              </div>
            </div>
            
            <div className="mb-3">
              <label className="form-label">{t('Имя пользователя *')}</label>
              <input type="text" className="form-control" name="username" value={formData.username} onChange={handleChange} required placeholder={t('Придумайте имя пользователя')} />
            </div>
            
            <div className="mb-3">
              <label className="form-label">{t('Email')}</label>
              <input type="email" className="form-control" name="email" value={formData.email} onChange={handleChange} placeholder={t('Введите email')} />
            </div>
            
            <div className="mb-3">
              <label className="form-label">{t('Пароль *')}</label>
              <input type="password" className="form-control" name="password" value={formData.password} onChange={handleChange} required minLength="6" placeholder={t('Придумайте пароль (мин. 6 символов)')} />
            </div>
            
            <button type="submit" className="btn btn-primary w-100" disabled={loading || (isStudentLimitReached && formData.role === 'student')}>
              {loading ? <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  {t('Регистрация...')}
                </> : t('Зарегистрироваться')}
            </button>
          </form>
          
          <div className="text-center mt-3">
            <p>{t("auto.f7c55f5866")}<Link to="/login">{t('Войти')}</Link></p>
          </div>
        </div>
      </div>
    </div>;
};
export default Register;
