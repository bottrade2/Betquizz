import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

const REFRESH_INTERVAL = 5;
const PAGE_SIZE = 10;

export default function DuelMath({ user }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [rooms, setRooms]       = useState([]);
  const [newCodes, setNewCodes] = useState(new Set());
  const [bet, setBet]           = useState(10);
  const [joinCode, setJoinCode] = useState('');
  const [tab, setTab]           = useState('create');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining]   = useState(false);
  const [page, setPage]         = useState(1);
  const prevCodesRef            = useRef(new Set());

  const fetchRooms = useCallback(async () => {
    try {
      const { data } = await api.get('/duelmath/rooms');
      const list = Array.isArray(data) ? data : [];
      const incoming = new Set(list.map(r => r.room_code));
      const fresh = new Set([...incoming].filter(c => !prevCodesRef.current.has(c)));
      prevCodesRef.current = incoming;
      if (fresh.size > 0) {
        setNewCodes(fresh);
        setTimeout(() => setNewCodes(new Set()), 600);
      }
      setRooms(list);
    } catch {}
  }, []);

  useEffect(() => {
    fetchRooms();
    const t = setInterval(fetchRooms, REFRESH_INTERVAL * 1000);
    return () => clearInterval(t);
  }, [fetchRooms]);

  const createRoom = async () => {
    setCreating(true);
    try {
      const { data } = await api.post('/duelmath/rooms', { bet });
      navigate(`/duelmath/room/${data.code}`);
    } catch (err) {
      alert(err.response?.data?.message || t('home_room_error'));
    } finally { setCreating(false); }
  };

  const joinRoom = async (code) => {
    setJoining(true);
    try {
      const c = (code || joinCode).toUpperCase().trim();
      await api.post(`/duelmath/rooms/${c}/join`);
      navigate(`/duelmath/room/${c}`);
    } catch (err) {
      alert(err.response?.data?.message || t('home_join_error'));
    } finally { setJoining(false); }
  };

  const totalPages = Math.max(1, Math.ceil(rooms.length / PAGE_SIZE));
  const pagedRooms = rooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page">
      <div className="container">

        <div className="home-header">
          <div className="home-eyebrow dm-eyebrow">Duel Math</div>
          <h1 className="home-title">
            {t('dm_title_1')}<br /><em>{t('dm_title_2')}</em>
          </h1>
          <p className="home-desc">{t('dm_desc')}</p>
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
            ) : (
              <>
                <div className="rooms-list">
                  {pagedRooms.map(room => (
                    <div
                      key={room.room_code}
                      className={`card card-row room-card card-interactive${newCodes.has(room.room_code) ? ' room-card-new' : ''}`}
                      style={{ padding: 0 }}
                      onClick={() => joinRoom(room.room_code)}
                    >
                      <div className="room-card-inner" style={{ width: '100%' }}>
                        <span className="room-code">{room.room_code}</span>
                        <div className="room-meta">
                          <span style={{ color: 'var(--text-3)' }}>1/2</span>
                        </div>
                        <span className="dm-badge-mode">MATH</span>
                        <span className="room-bet-val">{room.bet}€</span>
                        <span className="badge badge-accent badge-dot" style={{ flexShrink: 0 }}>
                          {t('home_waiting')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="rooms-pagination">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                      <button key={n} className={`pagination-btn${page === n ? ' active' : ''}`} onClick={() => setPage(n)}>{n}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="create-panel">
            <div className="card" style={{ padding: '28px' }}>
              <div className="panel-tabs">
                <button className={`panel-tab${tab === 'create' ? ' active' : ''}`} onClick={() => setTab('create')}>{t('home_tab_new')}</button>
                <button className={`panel-tab${tab === 'join' ? ' active' : ''}`} onClick={() => setTab('join')}>{t('home_tab_join')}</button>
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
                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => joinRoom()} disabled={joinCode.length < 6 || joining}>
                    {joining ? t('home_joining') : t('home_join_btn')}
                  </button>
                </>
              ) : (
                <>
                  <div className="create-title">{t('dm_create_title')}</div>
                  <div className="create-subtitle">{t('dm_create_sub')}</div>
                  <div className="form-section">
                    <span className="form-section-label">{t('home_bet')}</span>
                    <input
                      className="field-input"
                      type="number"
                      min="1"
                      max={user?.balance ?? undefined}
                      step="1"
                      placeholder=""
                      value={bet}
                      onChange={e => {
                        const v = parseInt(e.target.value) || '';
                        setBet(v);
                      }}
                    />
                    {user && bet > user.balance && (
                      <div className="field-error" style={{ marginTop: 8 }}>{t('home_insufficient')}</div>
                    )}
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={createRoom} disabled={creating || (user && bet > user.balance)}>
                    {creating ? t('home_creating') : t('dm_create_btn')}
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
