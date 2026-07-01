import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PrivateRoute = ({ children, allowedRoles, requireStudentProfile = false }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Загрузка...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }

  if (requireStudentProfile && user.role === 'student') {
    const hasProfile =
      user.military_rank &&
      user.management_body &&
      user.last_name &&
      user.first_name &&
      (user.patronymic || user.middle_name);

    if (!hasProfile) {
      return <Navigate to="/student/profile" replace />;
    }
  }

  return children;
};

export default PrivateRoute;
