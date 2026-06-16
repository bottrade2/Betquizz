import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

const DIFF_CLASS = { facil: 'badge-pos', medio: 'badge-accent', dificil: 'badge-neg' };
const REFRESH_INTERVAL = 4;

export default function Home({ user }) {
  const { t, lang } = useLanguage();
  const [rooms, setRooms]         = useState([]);
  const [newCodes, setNewCodes]   = useState(new Set());
  const [form, setForm]           = useState({ bet: 10 });
  const [joinCode, setJoinCode]   = useState('');
  const [tab, setTab]             = useState('create');
  const [creating, setCreating]   = useState(false);
  const [joining, setJoining]     = useState(false);
  const [page, setPage]           = useState(1);
  const prevCodesRef              = useRef(new Set());
  const PAGE_SIZE = 10;
  const navigate = useNavigate();

  const fetchRooms = useCallback(async () => {
    try {
      const { data } = await api.get('/game/rooms');
      const list = Array.isArray(data) ? data : [];
      const incoming = new Set(list.map(r => r.code));
      const fresh = new Set([...incoming].filter(c => !prevCodesRef.current.has(c)));
      prevCodesRef.current = incoming;
      if (fresh.size > 0) {
        setNewCodes(fresh);
        setTimeout(() => setNewCodes(new Set()), 600);
      }
      setRooms(list);
      setPage(p => {
        const maxPage = Math.max(1, Math.ceil(list.length / 10));
        return p > maxPage ? 1 : p;
      });
    } catch (err) {
      console.error('fetchRooms error:', err?.response?.data || err?.message || err);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const timer = setInterval(fetchRooms, REFRESH_INTERVAL * 1000);
    return () => clearInterval(timer);
  }, [fetchRooms]);


  const createRoom = async () => {
    setCreating(true);
    try {
      const { data } = await api.post('/game/rooms', { ...form, language: lang });
      navigate(`/room/${data.code}`);
    } catch (err) {
      alert(err.response?.data?.message || t('home_room_error'));
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = async (code, isOwn = false) => {
    setJoining(true);
    try {
      const c = (code || joinCode).toUpperCase().trim();
      if (isOwn) { navigate(`/room/${c}`); return; }
      await api.post(`/game/rooms/${c}/join`);
      navigate(`/room/${c}`);
    } catch (err) {
      alert(err.response?.data?.message || t('home_join_error'));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="home-header">
          <div className="home-eyebrow">{t('home_eyebrow')}</div>
          <h1 className="home-title">
            {t('home_title_1')}<br /><em>{t('home_title_2')}</em>
          </h1>
          <p className="home-desc">{t('home_desc')}</p>
        </div>

        <div className="home-kpi-strip">
          <div className="kpi-item">
            <div className="kpi-value">{rooms.length}</div>
            <div className="kpi-label">{t('home_kpi_rooms')}</div>
          </div>
          <div className="kpi-sep" />
          <div className="kpi-item">
            <div className="kpi-value">{user?.balance ?? 0}</div>
            <div className="kpi-label">{t('home_kpi_balance')}</div>
          </div>
        </div>

        <div className="home-body">
          <div>
            <div className="section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="section-title">{t('home_available')}</span>
                <div className="live-dot" />
              </div>
              <button className="btn btn-ghost btn-xs" onClick={fetchRooms}>{t('home_refresh')}</button>
            </div>

            {rooms.length === 0 ? (
              <div className="empty-rooms">
                <div className="empty-title">{t('home_no_rooms_title')}</div>
                <div className="empty-desc">{t('home_no_rooms_desc')}</div>
              </div>
            ) : (() => {
              const totalPages = Math.max(1, Math.ceil(rooms.length / PAGE_SIZE));
              const pageRooms = rooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
              return (
                <>
                  <div className="rooms-list">
                    {pageRooms.map(room => (
                      <div
                        key={room.code}
                        className={`card card-row room-card card-interactive${newCodes.has(room.code) ? ' room-card-new' : ''}`}
                        style={{ padding: 0 }}
                        onClick={() => joinRoom(room.code, room.isOwn)}
                      >
                        <div className="room-card-inner" style={{ width: '100%' }}>
                          <span className="room-code">{room.code}</span>
                          <div className="room-meta">
                            <span style={{ color: 'var(--text-3)' }}>{room.players?.length || 1}/2</span>
                          </div>
                          <span className="room-bet-val">{room.bet}€</span>
                          {room.isOwn && (
                            <span className="badge badge-gold" style={{ flexShrink: 0 }}>{t('home_your_room')}</span>
                          )}
                          <span
                            className={`badge ${room.status === 'waiting' ? 'badge-accent badge-dot' : 'badge-pos badge-dot'}`}
                            style={{ flexShrink: 0 }}
                          >
                            {room.status === 'waiting' ? t('home_waiting') : t('home_in_game')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="rooms-pagination">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                        <button
                          key={n}
                          className={`pagination-btn${page === n ? ' active' : ''}`}
                          onClick={() => setPage(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <div className="create-panel">
            <div className="card" style={{ padding: '28px' }}>
              <div className="panel-tabs">
                <button
                  className={`panel-tab${tab === 'create' ? ' active' : ''}`}
                  onClick={() => setTab('create')}
                >
                  {t('home_tab_new')}
                </button>
                <button
                  className={`panel-tab${tab === 'join' ? ' active' : ''}`}
                  onClick={() => setTab('join')}
                >
                  {t('home_tab_join')}
                </button>
              </div>

              {tab === 'join' ? (
                <>
                  <div className="create-title">{t('home_join_title')}</div>
                  <div className="create-subtitle" style={{ marginBottom: 20 }}>{t('home_join_sub')}</div>
                  <div className="join-input-row" style={{ marginBottom: 16 }}>
                    <input
                      className="field-input"
                      placeholder={t('home_join_ph')}
                      value={joinCode}
                      onChange={e => setJoinCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 500, letterSpacing: '0.25em', textAlign: 'center', textTransform: 'uppercase' }}
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => joinRoom()}
                    disabled={joinCode.length < 6 || joining}
                  >
                    {joining ? t('home_joining') : t('home_join_btn')}
                  </button>
                </>
              ) : (
                <>
                  <div className="create-title">{t('home_create_title')}</div>
                  <div className="create-subtitle">{t('home_create_sub')}</div>

                  <div className="form-section">
                    <span className="form-section-label">{t('home_bet')}</span>
                    <input
                      className="field-input"
                      type="number"
                      min="1"
                      max={user?.balance ?? undefined}
                      step="1"
                      placeholder=""
                      value={form.bet}
                      onChange={e => {
                        const v = parseInt(e.target.value) || '';
                        setForm({ ...form, bet: v });
                      }}
                    />
                    {user && form.bet > user.balance && (
                      <div className="field-error" style={{ marginTop: 8 }}>{t('home_insufficient')}</div>
                    )}
                  </div>

                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={createRoom}
                    disabled={creating || (user && form.bet > user.balance)}
                  >
                    {creating ? t('home_creating') : t('home_create_btn')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
