import axios from 'axios';

export const clearLoginAndTestSession = (attemptId) => {
  ['token', 'refreshToken', 'user', 'student_profile', 'activeTestAttemptId', 'activeTestConfig'].forEach((key) => {
    localStorage.removeItem(key);
  });

  if (attemptId) {
    localStorage.removeItem(`test_progress_${attemptId}`);
  }

  sessionStorage.clear();
  delete axios.defaults.headers.common.Authorization;
};
