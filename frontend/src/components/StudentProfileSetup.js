import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const StudentProfileSetup = () => {
  const { user, updateStudentProfile } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    military_rank: user?.military_rank || '',
    last_name: user?.last_name || '',
    first_name: user?.first_name || '',
    patronymic: user?.patronymic || '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user?.student_profile_completed) {
    return <Navigate to="/student/dashboard" replace />;
  }

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await updateStudentProfile(formData);

    if (result.success) {
      navigate('/student/dashboard', { replace: true });
      return;
    }

    setError(result.error);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xl animate-fade-in">
        <div className="glass-card rounded-2xl p-8">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Данные ученика</h2>
            <p className="text-gray-500 mt-2">Заполните поля перед началом теста</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Воинское звание</label>
              <input
                type="text"
                className="input-modern"
                name="military_rank"
                value={formData.military_rank}
                onChange={handleChange}
                required
                placeholder="Например: рядовой"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Фамилия</label>
                <input
                  type="text"
                  className="input-modern"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Имя</label>
                <input
                  type="text"
                  className="input-modern"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Отчество</label>
                <input
                  type="text"
                  className="input-modern"
                  name="patronymic"
                  value={formData.patronymic}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 px-6 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'Сохранение...' : 'Продолжить к тесту'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default StudentProfileSetup;
