import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

const LANGS = [
  { code: 'pt', flag: '🇵🇹', label: 'Português' },
  { code: 'en', flag: '🇬🇧', label: 'English'   },
  { code: 'es', flag: '🇪🇸', label: 'Español'   },
];

export default function LanguageSelector() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen]   = useState(false);
  const ref               = useRef(null);

  const current = LANGS.find(l => l.code === lang) || LANGS[0];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (code) => { setLang(code); setOpen(false); };

  return (
    <div className="lang-selector" ref={ref}>
      <button
        className={`lang-selector-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Select language"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-flag">{current.flag}</span>
        <span className="lang-code">{current.code.toUpperCase()}</span>
        <svg className="lang-chevron" width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="lang-dropdown" role="listbox">
          {LANGS.map(l => (
            <button
              key={l.code}
              className={`lang-option${l.code === lang ? ' active' : ''}`}
              role="option"
              aria-selected={l.code === lang}
              onClick={() => select(l.code)}
            >
              <span className="lang-flag">{l.flag}</span>
              <span className="lang-option-label">{l.label}</span>
              {l.code === lang && (
                <svg className="lang-check" width="14" height="14" viewBox="0 0 14 14">
                  <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
