import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import socket from '../utils/socket';
import { useLanguage } from '../context/LanguageContext';

export default function Register({ setUser }) {
  const { t } = useLanguage();
  const [form, setForm]       = useState({ username: '', email: '', password: '', confirm: '', referral_code: '' });
  const [errors, setErrors]   = useState({});
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const navigate = useNavigate();

  const handle = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: '' });
  };

  const validate = () => {
    const e = {};
    if (!form.username || form.username.length < 3) e.username = t('register_err_username');
    if (!form.email || !/\S+@\S+\.\S+/.test(form.email)) e.email = t('register_err_email');
    if (!form.password || form.password.length < 6) e.password = t('register_err_password');
    if (form.password !== form.confirm) e.confirm = t('register_err_confirm');
    return e;
  };

  const submit = async e => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) return setErrors(errs);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        username: form.username,
        email: form.email,
        password: form.password,
        referral_code: form.referral_code.trim().toUpperCase() || undefined,
      });
      if (data.requiresVerification) {
        setEmailSent(true);
        return;
      }
      localStorage.setItem('token', data.token);
      socket.auth = { token: data.token };
      if (!socket.connected) socket.connect();
      setUser(data.user);
      navigate('/');
    } catch (err) {
      setErrors({ general: err.response?.data?.message || t('register_error') });
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) return (
    <div className="auth-layout">
      <div className="auth-deco"><div className="auth-deco-grid" /><div className="auth-deco-content"><div className="auth-deco-mark">Bet<em>Quizz</em></div></div></div>
      <div className="auth-panel">
        <div className="auth-form-wrap" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <h1 className="auth-title">{t('register_verify_title')}</h1>
          <p className="auth-subtitle" style={{ marginBottom: 24 }}>{t('register_verify_desc')} <strong>{form.email}</strong></p>
          <Link to="/login" className="btn btn-primary">{t('register_signin')}</Link>
        </div>
      </div>
    </div>
  );

  return (
    <div className="auth-layout">
      <div className="auth-deco">
        <div className="auth-deco-grid" />
        <div className="auth-deco-content">
          <div className="auth-deco-mark">Bet<em>Quizz</em></div>
          <p className="auth-deco-tagline">
            {t('register_tagline_1')}<br />
            {t('register_tagline_2')}
          </p>
          <div className="auth-deco-stat">
            <div className="auth-deco-stat-item">
              <div className="auth-deco-stat-value">30s</div>
              <div className="auth-deco-stat-label">{t('auth_per_question')}</div>
            </div>
            <div className="auth-deco-stat-item">
              <div className="auth-deco-stat-value">10</div>
              <div className="auth-deco-stat-label">{t('auth_questions_game')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-header">
            <h1 className="auth-title">{t('register_title')}</h1>
            <p className="auth-subtitle">{t('register_subtitle')}</p>
          </div>

          {errors.general && <div className="alert alert-error" style={{ marginBottom: 20 }}>{errors.general}</div>}

          <form className="auth-form" onSubmit={submit}>
            <div className="field">
              <label className="field-label">{t('register_username')}</label>
              <input
                className="field-input"
                name="username"
                placeholder={t('register_username_ph')}
                value={form.username}
                onChange={handle}
                autoFocus
              />
              {errors.username && <span className="field-error">{errors.username}</span>}
            </div>

            <div className="field">
              <label className="field-label">{t('register_email')}</label>
              <input
                className="field-input"
                type="email"
                name="email"
                placeholder="your@email.com"
                value={form.email}
                onChange={handle}
              />
              {errors.email && <span className="field-error">{errors.email}</span>}
            </div>

            <div className="field">
              <label className="field-label">{t('register_password')}</label>
              <input
                className="field-input"
                type="password"
                name="password"
                placeholder="••••••••"
                value={form.password}
                onChange={handle}
              />
              {errors.password && <span className="field-error">{errors.password}</span>}
            </div>

            <div className="field">
              <label className="field-label">{t('register_confirm')}</label>
              <input
                className="field-input"
                type="password"
                name="confirm"
                placeholder="••••••••"
                value={form.confirm}
                onChange={handle}
              />
              {errors.confirm && <span className="field-error">{errors.confirm}</span>}
            </div>

            <div className="field">
              <label className="field-label">{t('register_referral')} <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>({t('register_referral_opt')})</span></label>
              <input
                className="field-input"
                name="referral_code"
                placeholder={t('register_referral_ph')}
                value={form.referral_code}
                onChange={handle}
                maxLength={8}
                style={{ textTransform: 'uppercase', letterSpacing: '0.15em' }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg auth-submit"
              disabled={loading}
            >
              {loading
                ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: 'var(--ink)' }} /> {t('register_loading')}</>
                : t('register_submit')}
            </button>
          </form>

          <div className="auth-footer">
            {t('register_has_account')} <Link to="/login">{t('register_signin')}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
