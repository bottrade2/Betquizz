import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

export default function VerifyEmail({ setUser }) {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setStatus('error'); return; }
    api.get(`/auth/verify-email?token=${token}`)
      .then(({ data }) => {
        localStorage.setItem('token', data.token);
        setUser(data.user);
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  }, []);

  if (status === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>{status === 'success' ? '✅' : '❌'}</div>
        <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 24, marginBottom: 12 }}>
          {status === 'success' ? t('verify_success_title') : t('verify_error_title')}
        </h1>
        <p style={{ color: 'var(--text-3)', marginBottom: 24 }}>
          {status === 'success' ? t('verify_success_desc') : t('verify_error_desc')}
        </p>
        <Link to={status === 'success' ? '/' : '/register'} className="btn btn-primary">
          {status === 'success' ? t('verify_go_home') : t('verify_try_again')}
        </Link>
      </div>
    </div>
  );
}
