import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import socket from '../utils/socket';
import { useLanguage } from '../context/LanguageContext';

export default function Login({ setUser }) {
  const { t } = useLanguage();
  const [form, setForm]     = useState({ email: '', password: '' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handle = e => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      localStorage.setItem('token', data.token);
      socket.auth = { token: data.token };
      if (!socket.connected) socket.connect();
      setUser(data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || t('login_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-deco">
        <div className="auth-deco-grid" />
        <div className="auth-deco-content">
          <div className="auth-deco-mark">Bet<em>Quizz</em></div>
          <p className="auth-deco-tagline">
            {t('login_tagline_1')}<br />
            {t('login_tagline_2')}
          </p>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-header">
            <h1 className="auth-title">{t('login_title')}</h1>
            <p className="auth-subtitle">{t('login_subtitle')}</p>
          </div>

          {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

          <form className="auth-form" onSubmit={submit}>
            <div className="field">
              <label className="field-label">{t('login_email')}</label>
              <input
                className="field-input"
                type="email"
                name="email"
                placeholder={t('login_email_ph')}
                value={form.email}
                onChange={handle}
                required
                autoFocus
              />
            </div>

            <div className="field">
              <label className="field-label">{t('login_password')}</label>
              <input
                className="field-input"
                type="password"
                name="password"
                placeholder="••••••••"
                value={form.password}
                onChange={handle}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg auth-submit"
              disabled={loading}
            >
              {loading
                ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: 'var(--ink)' }} /> {t('login_loading')}</>
                : t('login_submit')}
            </button>
          </form>

          <div className="auth-footer">
            {t('login_no_account')} <Link to="/register">{t('login_signup')}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
