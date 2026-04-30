# Видеотестирование - Django + React

Полнофункциональное веб-приложение для видеотестирования. Учителя создают тесты по 100 вопросов, ученики проходят тестирование с просмотром видео.

## Функциональность

### Роли пользователей
- **Учитель**: создает вопросы, формирует тесты, просматривает результаты
- **Ученик**: проходит тесты, видит прогресс и результаты

### Особенности видеотестирования
- Видео отображается на каждом вопросе
- 3 варианта ответа (A, B, C) с кнопками
- Прогресс-бар (X/100)
- Автосохранение прогресса
- Возможность продолжить с места остановки

### Лимиты
- Максимум 50 учеников в системе
- Тест содержит ровно 100 вопросов

## Структура проекта

```
test/
├── backend/              # Django REST API
│   ├── core/            # Основное приложение
│   │   ├── models.py    # Модели данных
│   │   ├── views.py     # API эндпоинты
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── video_test/      # Настройки Django
│   ├── manage.py
│   ├── seed.py          # Скрипт демо-данных
│   └── requirements.txt
└── frontend/            # React приложение
    ├── src/
    │   ├── components/  # React компоненты
    │   ├── context/     # Auth контекст
    │   └── App.js
    └── package.json
```

## Установка и запуск

### Бэкенд (Django)

```bash
# 1. Перейти в папку backend
cd backend

# 2. Создать виртуальное окружение
python -m venv venv

# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 3. Установить зависимости
pip install -r requirements.txt

# 4. Выполнить миграции
python manage.py makemigrations
python manage.py migrate

# 5. Заполнить демо-данными
python seed.py

# 6. Запустить сервер
python manage.py runserver
```

Сервер запустится на `http://localhost:8000`

### Фронтенд (React)

```bash
# 1. Перейти в папку frontend
cd frontend

# 2. Установить зависимости
npm install

# 3. Запустить приложение
npm start
```

Приложение откроется на `http://localhost:3000`

## Демо-данные

После запуска `seed.py` создаются:

| Роль | Логин | Пароль |
|------|-------|--------|
| Учитель | admin | admin |
| Ученики | student1..student50 | 123 |

Также создается:
- 100 вопросов ("Вопрос 1".."Вопрос 100", правильный ответ всегда A)
- 1 тест со всеми 100 вопросами

## API Эндпоинты

### Аутентификация
- `POST /api/token/` - получить JWT токен
- `POST /api/token/refresh/` - обновить токен
- `POST /api/register/` - регистрация

### Учитель
- `GET/POST /api/questions/` - список/создание вопросов
- `GET/PUT/DELETE /api/questions/:id/` - детали вопроса
- `GET/POST /api/tests/` - список/создание тестов
- `GET /api/teacher/results/` - результаты всех учеников

### Ученик
- `GET /api/student/tests/` - доступные тесты
- `POST /api/student/tests/:id/start/` - начать тест
- `GET /api/student/attempts/:id/questions/` - получить вопросы
- `POST /api/student/attempts/:id/answer/` - отправить ответ
- `POST /api/student/attempts/:id/complete/` - завершить тест
- `GET /api/student/attempts/:id/result/` - получить результат

## Технологии

### Бэкенд
- Django 4.2
- Django REST Framework
- Django REST Framework SimpleJWT (аутентификация)
- django-cors-headers
- SQLite (база данных)

### Фронтенд
- React 18
- React Router 6
- Axios (HTTP клиент)
- Bootstrap 5 (стили)

## Страницы приложения

| URL | Описание |
|-----|----------|
| `/login` | Вход в систему |
| `/register` | Регистрация с выбором роли |
| `/teacher/dashboard` | Панель учителя |
| `/student/dashboard` | Панель ученика |
| `/test/:attemptId` | Страница видеотестирования |
| `/result/:attemptId` | Результаты теста |

## Модели данных

### User
- `username`, `email`, `password`
- `role`: teacher/student
- `first_name`, `last_name`

### Question
- `text` - текст вопроса
- `option_a`, `option_b`, `option_c` - варианты
- `correct_answer` - правильный ответ (A/B/C)
- `created_by` - учитель-создатель

### Test
- `title` - название
- `teacher` - создатель
- `questions` - ManyToMany (100 вопросов)
- `is_active` - активен ли

### Attempt
- `student` - ученик
- `test` - тест
- `status` - in_progress/completed
- `score` - количество правильных
- `current_question_index` - текущий вопрос

### Answer
- `attempt` - попытка
- `question` - вопрос
- `selected_option` - выбранный вариант
- `is_correct` - правильно ли

## Безопасность

- JWT аутентификация
- Проверка ролей на уровне API
- Защита от повторных ответов
- Защита от доступа к завершенным тестам
- Лимит учеников при регистрации
