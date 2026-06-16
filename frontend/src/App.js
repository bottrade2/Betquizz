import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import Login from './components/Login';
import Register from './components/Register';
import GameRoom from './components/GameRoom';
import Leaderboard from './components/Leaderboard';
import Home from './pages/Home';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import DuelMath from './pages/DuelMath';
import DuelMathRoom from './pages/DuelMathRoom';
import Bomb from './pages/Bomb';
import BombRoom from './pages/BombRoom';
import Tournament from './pages/Tournament';
import TournamentRoom from './pages/TournamentRoom';
import VerifyEmail from './pages/VerifyEmail';
import api from './utils/api';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import LanguageSelector from './components/LanguageSelector';
import SoundToggle from './components/SoundToggle';
import AvatarIcon from './components/AvatarIcon';
import './styles.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || undefined;

function Nav({ user, onLogout }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useLanguage();

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const isAuth = pathname === '/login' || pathname === '/register';
  if (isAuth) return null;

  const lnkCls  = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;
  const mlnkCls = ({ isActive }) => `mobile-menu-link${isActive ? ' active' : ''}`;

  return (
    <>
      <nav className="nav">
        <div className="container">
          <Link to="/" className="nav-wordmark">Bet<em>Quizz</em></Link>

          <div className="nav-links">
            <NavLink to="/" end className={lnkCls}>{t('nav_home')}</NavLink>
            <NavLink to="/duelmath" className={lnkCls}>{t('nav_duelmath')}</NavLink>
            <NavLink to="/bomb" className={lnkCls}>Bomba</NavLink>
            <NavLink to="/leaderboard" className={lnkCls}>{t('nav_ranking')}</NavLink>
            {user && <NavLink to="/profile" className={lnkCls}>{t('nav_profile')}</NavLink>}
            {user?.is_admin && <NavLink to="/admin" className={lnkCls}>Admin</NavLink>}
          </div>

          <div className="nav-end">
            <SoundToggle />
            <LanguageSelector />
            {user ? (
              <>
                <div className="nav-balance">
                  <span className="nav-balance-label">{t('nav_balance')}</span>
                  <span>{user.balance ?? 0}€</span>
                </div>
                <Link to="/profile" className="nav-user">
                  <AvatarIcon icon={user.avatar_icon ?? 0} size={30} />
                  <span className="nav-username">{user.username}</span>
                </Link>
                <button className="btn btn-ghost btn-sm nav-logout" onClick={onLogout}>{t('nav_logout')}</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">{t('nav_login')}</Link>
                <Link to="/register" className="btn btn-primary btn-sm">{t('nav_register')}</Link>
              </>
            )}
          </div>

          <button
            className={`nav-hamburger${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <span /><span /><span />
          </button>
        </div>
      </nav>

      {menuOpen && (
        <>
          <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />
          <nav className="mobile-drawer">

            {/* Cabeçalho */}
            <div className="mobile-drawer-header">
              <span className="mobile-drawer-brand">Bet<em>Quizz</em></span>
              <button className="mobile-drawer-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Info do utilizador */}
            {user ? (
              <div className="mobile-drawer-user">
                <Link to="/profile" onClick={() => setMenuOpen(false)}>
                  <AvatarIcon icon={user.avatar_icon ?? 0} size={42} />
                </Link>
                <div>
                  <div className="mobile-drawer-uname">{user.username}</div>
                  <div className="mobile-drawer-bal">{user.balance ?? 0}€</div>
                </div>
              </div>
            ) : (
              <div className="mobile-drawer-auth">
                <Link to="/login"    className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(false)}>{t('nav_login')}</Link>
                <Link to="/register" className="btn btn-primary btn-sm" onClick={() => setMenuOpen(false)}>{t('nav_register')}</Link>
              </div>
            )}

            <div className="mobile-drawer-sep" />

            {/* Links de navegação */}
            <NavLink to="/" end className={mlnkCls} onClick={() => setMenuOpen(false)}>
              <svg className="mlink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              {t('nav_home')}
            </NavLink>
            <NavLink to="/duelmath" className={mlnkCls} onClick={() => setMenuOpen(false)}>
              <svg className="mlink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              {t('nav_duelmath')}
            </NavLink>
            <NavLink to="/bomb" className={mlnkCls} onClick={() => setMenuOpen(false)}>
              <svg className="mlink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Bomba
            </NavLink>
            <NavLink to="/leaderboard" className={mlnkCls} onClick={() => setMenuOpen(false)}>
              <svg className="mlink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
              {t('nav_ranking')}
            </NavLink>
            {user && (
              <NavLink to="/profile" className={mlnkCls} onClick={() => setMenuOpen(false)}>
                <svg className="mlink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {t('nav_profile')}
              </NavLink>
            )}
            {user?.is_admin && (
              <NavLink to="/admin" className={mlnkCls} onClick={() => setMenuOpen(false)}>
                <svg className="mlink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Admin
              </NavLink>
            )}

            <div className="mobile-drawer-sep" />

            {/* Definições */}
            <div className="mobile-drawer-settings">
              <LanguageSelector />
              <SoundToggle />
            </div>

            {/* Logout */}
            {user && (
              <button className="mobile-drawer-logout" onClick={() => { onLogout(); setMenuOpen(false); }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                {t('nav_signout')}
              </button>
            )}
          </nav>
        </>
      )}
    </>
  );
}

function Guard({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppInner() {
  const [user, setUser]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [depositToast, setDepositToast] = useState(null);
  const notifSocket = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/auth/me')
        .then(({ data }) => setUser(data))
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!localStorage.getItem('token')) return;
      api.get('/auth/me')
        .then(({ data }) => setUser(prev => {
          if (!prev) return prev;
          const newBal = parseFloat(data.balance);
          return isNaN(newBal) || newBal === parseFloat(prev.balance) ? prev : { ...prev, balance: newBal };
        }))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Global notification socket — receives deposit credits instantly
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
    notifSocket.current = socket;
    socket.on('deposit:credited', ({ amount_eur, amount_sol, balance }) => {
      setUser(u => u ? { ...u, balance } : u);
      setDepositToast({ amount_eur, amount_sol });
      setTimeout(() => setDepositToast(null), 6000);
    });
    return () => socket.disconnect();
  }, [user?.id]); // eslint-disable-line

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 22, marginBottom: 24, color: 'var(--text-1)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Bet<em style={{ fontStyle: 'normal', color: 'var(--accent)' }}>Quizz</em>
        </div>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    </div>
  );

  return (
    <BrowserRouter>
      <div className="app">
        <Nav user={user} onLogout={() => { localStorage.removeItem('token'); setUser(null); }} />
        {depositToast && (
          <div className="deposit-toast">
            <div className="deposit-toast-icon" />
            <div>
              <div className="deposit-toast-title">Depósito recebido!</div>
              <div className="deposit-toast-sub">+{depositToast.amount_sol.toFixed(4)} SOL = +{depositToast.amount_eur.toFixed(2)}€</div>
            </div>
          </div>
        )}
        <Routes>
          <Route path="/login"        element={<Login setUser={setUser} />} />
          <Route path="/register"     element={<Register setUser={setUser} />} />
          <Route path="/verify-email" element={<VerifyEmail setUser={setUser} />} />
          <Route path="/" element={<Guard user={user}><Home user={user} /></Guard>} />
          <Route path="/room/:code" element={<Guard user={user}><GameRoom user={user} onGameEnd={() => {
            api.get('/auth/me').then(({ data }) => setUser(data)).catch(() => {});
          }} /></Guard>} />
          <Route path="/duelmath" element={<Guard user={user}><DuelMath user={user} /></Guard>} />
          <Route path="/duelmath/room/:code" element={<Guard user={user}><DuelMathRoom user={user} onGameEnd={() => {
            api.get('/auth/me').then(({ data }) => setUser(data)).catch(() => {});
          }} /></Guard>} />
          <Route path="/bomb" element={<Guard user={user}><Bomb user={user} /></Guard>} />
          <Route path="/bomb/room/:code" element={<Guard user={user}><BombRoom user={user} onGameEnd={() => {
            api.get('/auth/me').then(({ data }) => setUser(data)).catch(() => {});
          }} /></Guard>} />
          <Route path="/leaderboard" element={<Leaderboard user={user} />} />
          <Route path="/profile" element={<Guard user={user}><Profile user={user} onBalanceUpdate={(bal) => setUser(u => ({ ...u, balance: bal }))} onAvatarUpdate={(icon) => setUser(u => ({ ...u, avatar_icon: icon }))} /></Guard>} />
          <Route path="/admin" element={<Guard user={user}><Admin user={user} /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}
