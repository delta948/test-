import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';
import API_URL from '../config/api';
import { clearLoginAndTestSession } from '../utils/authSession';

const AuthContext = createContext(null);

export const saveStudentProfileFallback = (profileData, errorMessage = 'Ошибка сохранения данных') => {
  localStorage.setItem('student_profile', JSON.stringify(profileData));
  return {
    success: true,
    local: true,
    error: errorMessage,
  };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Add axios interceptor for automatic token injection
  useEffect(() => {
    const interceptor = axios.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    return () => axios.interceptors.request.eject(interceptor);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
      } catch (error) {
        localStorage.removeItem('user');
      }
    }
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchProfile();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await axios.get(`${API_URL}/profile/`);
      setUser(response.data);
      localStorage.setItem('user', JSON.stringify(response.data));
    } catch (error) {
      console.error('Error fetching profile:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      const response = await axios.post(`${API_URL}/token/`, {
        username,
        password
      });
      
      const { access, refresh } = response.data;
      localStorage.setItem('token', access);
      localStorage.setItem('refreshToken', refresh);
      axios.defaults.headers.common['Authorization'] = `Bearer ${access}`;
      
      await fetchProfile();
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.detail || 'Ошибка входа' 
      };
    }
  };

  const register = async (userData) => {
    try {
      const response = await axios.post(`${API_URL}/register/`, userData);
      return { success: true, data: response.data };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || error.response?.data?.username?.[0] || 'Ошибка регистрации'
      };
    }
  };

  const updateStudentProfile = async (profileData) => {
    const token = localStorage.getItem('token');

    if (!token) {
      console.warn('Нет токена, сохранение в localStorage');
      return saveStudentProfileFallback(profileData, 'Токен отсутствует');
    }

    try {
      const response = await axios.post(`${API_URL}/student/profile/`, profileData, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setUser(response.data);
      localStorage.setItem('user', JSON.stringify(response.data));
      return { success: true, data: response.data };
    } catch (error) {
      if (error.response?.status === 401) {
        try {
          const refreshToken = localStorage.getItem('refreshToken');
          if (!refreshToken) {
            throw new Error('Токен обновления отсутствует');
          }

          const refreshResponse = await axios.post(`${API_URL}/token/refresh/`, {
            refresh: refreshToken,
          });

          const nextToken = refreshResponse.data?.access;
          if (!nextToken) {
            throw new Error('Сервер не вернул новый access token');
          }

          localStorage.setItem('token', nextToken);
          axios.defaults.headers.common['Authorization'] = `Bearer ${nextToken}`;

          return await updateStudentProfile(profileData);
        } catch (refreshError) {
          console.warn('Не удалось обновить токен, сохраняем локально', refreshError);
        }
      }

      console.error('Profile update error:', error.response?.data);
      let errorMessage = 'Ошибка сохранения данных';
      if (error.response?.data) {
        if (typeof error.response.data === 'object') {
          const fieldErrors = Object.entries(error.response.data)
            .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`)
            .join('; ');
          if (fieldErrors) errorMessage = fieldErrors;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        }
      }

      return saveStudentProfileFallback(profileData, errorMessage);
    }
  };

  const logout = (attemptId) => {
    clearLoginAndTestSession(attemptId);
    setUser(null);
  };

  const value = {
    user,
    login,
    register,
    updateStudentProfile,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
