import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import ru from '../locales/ru.json';
import kg from '../locales/kg.json';

const STORAGE_KEY = 'appLanguage';
const SUPPORTED_LANGUAGES = ['ru', 'ky'];

const translations = { ru, ky: kg };

const getKeyByTranslatedValue = (sourceLanguage, value) => {
  const sourceTranslations = translations[sourceLanguage] || {};
  return Object.keys(sourceTranslations).find((key) => sourceTranslations[key] === value);
};

const browserDialogs = {
  alert: typeof window !== 'undefined' ? window.alert.bind(window) : null,
  confirm: typeof window !== 'undefined' ? window.confirm.bind(window) : null,
  prompt: typeof window !== 'undefined' ? window.prompt.bind(window) : null,
};

const phraseRegex = [
  [/^Найдено:\s*(.*)$/i, (_, value) => `Табылды: ${value}`],
  [/^Вопрос\s+(\d+)\s*\/\s*(\d+)$/i, (_, current, total) => `Суроо ${current} / ${total}`],
  [/^Отвечено:\s*(\d+)\s*\/\s*(\d+)$/i, (_, answered, total) => `Жооп берилди: ${answered} / ${total}`],
  [/^(\d+)\s*\/\s*(\d+)\s*вопросов\s*\((.*)\)$/i, (_, done, total, percent) => `${done} / ${total} суроо (${percent})`],
  [/^Правильный ответ:\s*([A-D])$/i, (_, value) => `Туура жооп: ${value}`],
  [/^Правильный:\s*([A-D])$/i, (_, value) => `Туура: ${value}`],
  [/^Создан:\s*(.*)$/i, (_, value) => `Түзүлдү: ${value}`],
  [/^Найдено\s*(\d+)$/i, (_, value) => `Табылды ${value}`],
  [/^Вопросы триггера:\s*(\d+)$/i, (_, value) => `Триггер суроолору: ${value}`],
  [/^Удалить ученика\s+"([^"]+)"\?$/i, (_, value) => `"${value}" окуучусун өчүрөсүзбү?`],
  [/^Удалить выбранные вопросы:\s*(\d+)\?$/i, (_, value) => `Тандалган суроолорду өчүрөсүзбү: ${value}?`],
  [/^Создать тест\s+"([^"]+)"\s+с автоматическим набором 100 вопросов по выбранным триггерам\?$/i, (_, value) => `"${value}" тестин тандалган триггерлер боюнча 100 суроо менен автоматтык түзөсүзбү?`],
  [/^Создать тест\s+"([^"]+)"\s+с\s+(\d+)\s+выбранными вопросами\?$/i, (_, title, count) => `"${title}" тестин ${count} тандалган суроо менен түзөсүзбү?`],
  [/^Необходимо выбрать ровно 100 вопросов\. Выбрано:\s*(\d+)$/i, (_, value) => `Так 100 суроо тандалышы керек. Тандалды: ${value}`],
  [/^Импортировано вопросов:\s*(\d+)$/i, (_, value) => `Импорттолгон суроолор: ${value}`],
  [/^Учеников в системе:\s*(\d+)\s*\/\s*(\d+)$/i, (_, count, max) => `Системадагы окуучулар: ${count} / ${max}`],
  [/^Достигнут лимит в\s*(\d+)\s*учеников\. Регистрация невозможна\.$/i, (_, max) => `${max} окуучу лимитине жетти. Катталуу мүмкүн эмес.`],
  [/^Достигнут лимит в\s*(\d+)\s*учеников\. Новые ученики не могут зарегистрироваться\.$/i, (_, max) => `${max} окуучу лимитине жетти. Жаңы окуучулар каттала албайт.`],
  [/^Вы ответили правильно на\s*(\d+)\s*из\s*(\d+)\s*вопросов$/i, (_, correct, total) => `Сиз ${total} суроонун ичинен ${correct} суроого туура жооп бердиңиз`],
  [/^Ответ\s+([A-D])\s+на русском$/i, (_, value) => `${value} жообу орусча`],
  [/^Жооп\s+([A-D])\s+кыргызча$/i, (_, value) => `${value} жообу кыргызча`],
];

const isCorruptedTranslation = (value) => {
  const text = String(value ?? '').trim();
  return !text || /^\?{2,}(\s+\?{2,})*$/.test(text) || text.includes('�');
};

const translatePhrase = (value, language) => {
  const text = String(value ?? '');
  const trimmed = text.trim();
  if (!trimmed) return value;
  const directTranslation = translations[language]?.[trimmed];
  if (directTranslation && !isCorruptedTranslation(directTranslation)) {
    return text.replace(trimmed, directTranslation);
  }
  if (directTranslation && isCorruptedTranslation(directTranslation)) {
    return text.replace(trimmed, translations.ru?.[trimmed] || trimmed);
  }
  if (language === 'ru') {
    const kyKey = getKeyByTranslatedValue('ky', trimmed);
    if (kyKey) {
      const ruValue = translations.ru?.[kyKey];
      return ruValue && !isCorruptedTranslation(ruValue)
        ? text.replace(trimmed, ruValue)
        : value;
    }
    const ruTranslation = translations.ru?.[trimmed];
    return ruTranslation && !isCorruptedTranslation(ruTranslation)
      ? text.replace(trimmed, ruTranslation)
      : value;
  }
  const translated = translations[language]?.[trimmed];
  if (translated && !isCorruptedTranslation(translated)) return text.replace(trimmed, translated);
  for (const [regex, replacer] of phraseRegex) {
    if (regex.test(trimmed)) {
      return text.replace(trimmed, trimmed.replace(regex, replacer));
    }
  }
  return value;
};

const interpolate = (value, params = {}) => (
  String(value ?? '').replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match
  ))
);

const getOriginalText = (node) => {
  if (!node.__i18nOriginalText) node.__i18nOriginalText = node.nodeValue;
  return node.__i18nOriginalText;
};

const getOriginalAttribute = (element, attribute) => {
  if (!element.__i18nOriginalAttributes) element.__i18nOriginalAttributes = {};
  if (!(attribute in element.__i18nOriginalAttributes)) {
    element.__i18nOriginalAttributes[attribute] = element.getAttribute(attribute);
  }
  return element.__i18nOriginalAttributes[attribute];
};

const translateDom = (root, language) => {
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('input, textarea, [data-no-translate]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    node.nodeValue = translatePhrase(getOriginalText(node), language);
  });

  root.querySelectorAll('input[placeholder], textarea[placeholder], [title], [aria-label]').forEach((element) => {
    ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      const original = getOriginalAttribute(element, attribute);
      if (original) element.setAttribute(attribute, translatePhrase(original, language));
    });
  });
};

const LanguageContext = createContext(null);

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(stored) ? stored : 'ru';
  });

  const setLanguage = useCallback((nextLanguage) => {
    const safeLanguage = SUPPORTED_LANGUAGES.includes(nextLanguage) ? nextLanguage : 'ru';
    localStorage.setItem(STORAGE_KEY, safeLanguage);
    setLanguageState(safeLanguage);
  }, []);

  const t = useCallback((value, params) => interpolate(translatePhrase(value, language), params), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    translateDom(document.body, language);
    if (browserDialogs.alert && browserDialogs.confirm && browserDialogs.prompt) {
      window.alert = (message) => browserDialogs.alert(translatePhrase(message, language));
      window.confirm = (message) => browserDialogs.confirm(translatePhrase(message, language));
      window.prompt = (message, defaultValue) => browserDialogs.prompt(translatePhrase(message, language), defaultValue);
    }

    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(() => translateDom(document.body, language));
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
    return () => {
      observer.disconnect();
      if (browserDialogs.alert && browserDialogs.confirm && browserDialogs.prompt) {
        window.alert = browserDialogs.alert;
        window.confirm = browserDialogs.confirm;
        window.prompt = browserDialogs.prompt;
      }
    };
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
};

export const localizeField = (item, field, language) => {
  if (!item) return '';
  const languageSuffixes = language === 'ru' ? ['ru'] : ['ky', 'kg'];
  const fallbackSuffixes = language === 'ru' ? ['ky', 'kg'] : ['ru'];
  const semanticField = field === 'text' ? 'question' : field;
  const cleanValue = (value) => {
    const text = String(value ?? '').trim();
    return text && !isCorruptedTranslation(text) ? value : '';
  };
  const getLocalizedValue = (suffixes) => {
    for (const suffix of suffixes) {
      const directValue = cleanValue(item[`${field}_${suffix}`]);
      if (directValue) return directValue;
      const semanticValue = cleanValue(item[`${semanticField}_${suffix}`]);
      if (semanticValue) return semanticValue;
    }
    return '';
  };

  return getLocalizedValue(languageSuffixes) || getLocalizedValue(fallbackSuffixes) || cleanValue(item[field]) || '';
};

export const localizeQuestion = (question, language) => {
  if (!question) return question;
  const answerFields = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' };
  const localized = {
    ...question,
    text: localizeField(question, 'text', language),
  };
  if (Array.isArray(question.answers)) {
    localized.answers = question.answers.map((answer) => {
      const field = answerFields[answer.original_key || answer.key];
      if (field) {
        return { ...answer, text: localizeField(question, field, language) || localizeField(answer, 'text', language) || answer.text };
      }
      return { ...answer, text: localizeField(answer, 'text', language) || answer.text };
    });
  }
  return localized;
};
