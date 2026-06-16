import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

const REFRESH_INTERVAL = 6000;
const PAGE_SIZE = 10;

export default function Bomb({ user }) {
  const navigate = useNavigate();
  const { t }    = useLanguage();
  const [rooms,    setRooms]    = useState([]);
  const [bet,      setBet]      = useState(5);
  const [joinCode, setJoinCode] = useState('');
  const [tab,      setTab]      = useState('create');
  const [creating, setCreating] = useState(false);
  const [joining,  setJoining]  = useState(false);
  const [error,    setError]    = useState('');
  const [page,     setPage]     = useState(1);
  const timerRef = useRef(null);

  const fetchRooms = useCallback(async () => {
    try {
      const { data } = await api.get('/bomb/rooms');
      setRooms(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchRooms();
    timerRef.current = setInterval(fetchRooms, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchRooms]);

  const createRoom = async () => {
    setError('');
    setCreating(true);
    try {
      const { data } = await api.post('/bomb/rooms', { bet });
      navigate(`/bomb/room/${data.code}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Erro ao criar sala.');
      setCreating(false);
    }
  };

  const joinRoom = async (code) => {
    const c = (code || joinCode).toUpperCase().trim();
    if (!c) return;
    setError('');
    setJoining(true);
    try {
      await api.post(`/bomb/rooms/${c}/join`);
      navigate(`/bomb/room/${c}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Erro ao entrar na sala.');
      setJoining(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(rooms.length / PAGE_SIZE));
  const pagedRooms = rooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page">
      <div className="container">

        <div className="home-header">
          <div className="home-eyebrow bomb-eyebrow">Modo Bomba</div>
          <h1 className="home-title">
            {t('dm_title_1') ? 'Passa a' : 'Passa a'} <em>Bomba</em>
          </h1>
          <p className="home-desc">
            Uma pergunta passa de jogador em jogador. Cada passe certo encurta o tempo.
            Quem errar ou deixar o tempo acabar explode. Ate 6 jogadores.
          </p>
        </div>

        <div className="home-kpi-strip">
          <div className="kpi-item">
            <div className="kpi-value">{rooms.length}</div>
            <div className="kpi-label">Salas abertas</div>
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
                <span className="section-title">Salas disponíveis</span>
                <div className="live-dot" />
              </div>
              <button className="btn btn-ghost btn-xs" onClick={fetchRooms}>{t('home_refresh')}</button>
            </div>

            {rooms.length === 0 ? (
              <div className="empty-rooms">
                <div className="empty-title">Sem salas abertas</div>
                <div className="empty-desc">Cria uma sala ou aguarda que apareçam salas com bots.</div>
              </div>
            ) : (
              <>
                <div className="rooms-list">
                  {pagedRooms.map(r => (
                    <div
                      key={r.room_code}
                      className="card card-row room-card card-interactive"
                      style={{ padding: 0 }}
                      onClick={() => joinRoom(r.room_code)}
                    >
                      <div className="room-card-inner" style={{ width: '100%' }}>
                        <span className="room-code">{r.room_code}</span>
                        <div className="room-meta">
                          <span style={{ color: 'var(--text-3)' }}>
                            {r.bot_count > 0 ? `${r.bot_count} bots` : r.host}
                          </span>
                        </div>
                        <span className="dm-badge-mode bomb-badge">BOMBA</span>
                        <span className="room-bet-val">{r.bet}€</span>
                        <span className="badge badge-accent badge-dot">{t('home_waiting')}</span>
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
            <div className="card" style={{ padding: 28 }}>
              <div className="panel-tabs">
                <button className={`panel-tab${tab === 'create' ? ' active' : ''}`} onClick={() => setTab('create')}>{t('home_tab_new')}</button>
                <button className={`panel-tab${tab === 'join'   ? ' active' : ''}`} onClick={() => setTab('join')}>{t('home_tab_join')}</button>
              </div>

              {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}

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
                  <div className="create-title">Criar sala</div>
                  <div className="create-subtitle">Todos os jogadores apostam o mesmo valor. O último a sobreviver leva tudo.</div>
                  <div className="form-section">
                    <span className="form-section-label">{t('home_bet')}</span>
                    <input
                      className="field-input"
                      type="number" min="1" step="1"
                      value={bet}
                      onChange={e => setBet(parseInt(e.target.value) || '')}
                    />
                    {user && bet > user.balance && (
                      <div className="field-error" style={{ marginTop: 8 }}>{t('home_insufficient')}</div>
                    )}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={createRoom}
                    disabled={creating || !bet || (user && bet > user.balance)}
                  >
                    {creating ? t('home_creating') : 'Criar sala'}
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
