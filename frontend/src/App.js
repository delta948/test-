import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './components/Login';
import Register from './components/Register';
import TeacherDashboard from './components/TeacherDashboard';
import StudentDashboard from './components/StudentDashboard';
import StudentProfileSetup from './components/StudentProfileSetup';
import TestPage from './components/TestPage';
import TestResult from './components/TestResult';
import TestResultsPage from './components/TestResultsPage';
import Navbar from './components/Navbar';
import { LanguageProvider } from './context/LanguageContext';
import './App.css';

const AppShell = () => {
  return (
    <Router>
      <div className="App min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/teacher/dashboard"
              element={
                <PrivateRoute allowedRoles={['teacher', 'admin']}>
                  <TeacherDashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/student/profile"
              element={
                <PrivateRoute allowedRoles={['student']}>
                  <StudentProfileSetup />
                </PrivateRoute>
              }
            />
            <Route
              path="/student/dashboard"
              element={
                <PrivateRoute allowedRoles={['student']} requireStudentProfile>
                  <StudentDashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/test/:attemptId"
              element={
                <PrivateRoute allowedRoles={['student']} requireStudentProfile>
                  <TestPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/result/:attemptId"
              element={
                <PrivateRoute allowedRoles={['student']} requireStudentProfile>
                  <TestResult />
                </PrivateRoute>
              }
            />
            <Route
              path="/test-results/:id"
              element={
                <PrivateRoute allowedRoles={['student']} requireStudentProfile>
                  <TestResultsPage />
                </PrivateRoute>
              }
            />
            <Route path="/" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
};

function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <AppShell />
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
