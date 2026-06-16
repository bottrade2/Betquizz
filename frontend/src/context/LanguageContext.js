import React, { createContext, useContext, useState } from 'react';
import { translations } from '../i18n';

const SUPPORTED = ['pt', 'en', 'es'];

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem('lang');
    return SUPPORTED.includes(saved) ? saved : 'pt';
  });

  const setLang = (code) => {
    if (!SUPPORTED.includes(code)) return;
    setLangState(code);
    localStorage.setItem('lang', code);
  };

  const toggle = () => setLang(lang === 'en' ? 'pt' : 'en');

  const t = (key) => translations[lang]?.[key] ?? translations.en?.[key] ?? key;

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggle, t, supported: SUPPORTED }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
