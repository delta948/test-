import { saveStudentProfileFallback } from './AuthContext';

describe('saveStudentProfileFallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists the student profile in localStorage and marks it as local fallback', () => {
    const profileData = { first_name: 'Иван', last_name: 'Иванов' };

    const result = saveStudentProfileFallback(profileData, 'Токен отсутствует');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      local: true,
      error: 'Токен отсутствует',
    }));
    expect(localStorage.getItem('student_profile')).toBe(JSON.stringify(profileData));
  });
});
