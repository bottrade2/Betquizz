import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

const ENTRY_FEES = [5, 10, 25, 50, 100];

export default function Tournament({ user }) {
  const { t }      = useLanguage();
  const navigate   = useNavigate();
  const [rooms, setRooms]     = useState([]);
  const [tab, setTab]         = useState('create');
  const [size, setSize]       = useState(8);
  const [fee, setFee]         = useState(10);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining]   = useState(null);

  const fetchRooms = useCallback(async () => {
    try {
      const { data } = await api.get('/tournament');
      setRooms(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchRooms();
    const iv = setInterval(fetchRooms, 8000);
    return () => clearInterval(iv);
  }, [fetchRooms]);

  const createRoom = async () => {
    setCreating(true);
    try {
      const { data } = await api.post('/tournament', { size, entry_fee: fee });
      navigate(`/tournament/${data.id}`);
    } catch (err) {
      alert(err.response?.data?.message || t('trn_error_create'));
    } finally { setCreating(false); }
  };

  const joinRoom = async (tid) => {
    setJoining(tid);
    try {
      await api.post(`/tournament/${tid}/join`);
      navigate(`/tournament/${tid}`);
    } catch (err) {
      alert(err.response?.data?.message || t('trn_error_join'));
    } finally { setJoining(null); }
  };

  return (
    <div className="page">
      <div className="container">

        <div className="home-header">
          <div className="home-eyebrow trn-eyebrow">Tournament</div>
          <h1 className="home-title">{t('trn_title_1')}<br /><em>{t('trn_title_2')}</em></h1>
          <p className="home-desc">{t('trn_desc')}</p>
        </div>

        <div className="home-kpi-strip">
          <div className="kpi-item">
            <div className="kpi-value">{rooms.length}</div>
            <div className="kpi-label">{t('trn_open')}</div>
          </div>
          <div className="kpi-sep" />
          <div className="kpi-item">
            <div className="kpi-value">{user?.balance ?? 0}€</div>
            <div className="kpi-label">{t('home_kpi_balance')}</div>
          </div>
        </div>

        <div className="home-body">
          {/* Room list */}
          <div>
            <div className="section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="section-title">{t('trn_available')}</span>
                <div className="live-dot" />
              </div>
              <button className="btn btn-ghost btn-xs" onClick={fetchRooms}>{t('home_refresh')}</button>
            </div>

            {rooms.length === 0 ? (
              <div className="empty-rooms">
                <div className="empty-title">{t('trn_no_rooms_title')}</div>
                <div className="empty-desc">{t('trn_no_rooms_desc')}</div>
              </div>
            ) : (
              <div className="rooms-list">
                {rooms.map(r => (
                  <div
                    key={r.id}
                    className="card card-row room-card card-interactive"
                    style={{ padding: 0 }}
                    onClick={() => joinRoom(r.id)}
                  >
                    <div className="room-card-inner" style={{ width: '100%' }}>
                      <span className="room-code">{r.code}</span>
                      <div className="room-meta">
                        <span style={{ color: 'var(--text-3)' }}>{r.player_count}/{r.size}</span>
                      </div>
                      <span className="trn-badge">TORNEIO</span>
                      <span className="room-bet-val">{parseFloat(r.entry_fee).toFixed(0)}€</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                        <span className="badge badge-gold" style={{ fontSize: 11, marginBottom: 2 }}>
                          {t('trn_prize')}: {(parseFloat(r.entry_fee) * r.size * 0.9).toFixed(0)}€
                        </span>
                        <span className="badge badge-accent badge-dot">{t('home_waiting')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create panel */}
          <div className="create-panel">
            <div className="card" style={{ padding: '28px' }}>
              <div className="panel-tabs">
                <button className={`panel-tab${tab === 'create' ? ' active' : ''}`} onClick={() => setTab('create')}>{t('home_tab_new')}</button>
              </div>

              <div className="create-title">{t('trn_create_title')}</div>
              <div className="create-subtitle">{t('trn_create_sub')}</div>

              <div className="form-section">
                <span className="form-section-label">{t('trn_players')}</span>
                <div className="trn-size-row">
                  {[4, 8].map(s => (
                    <button
                      key={s}
                      className={`trn-size-btn${size === s ? ' active' : ''}`}
                      onClick={() => setSize(s)}
                    >
                      {s} {t('trn_players_unit')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-section">
                <span className="form-section-label">{t('trn_entry_fee')}</span>
                <div className="trn-fee-row">
                  {ENTRY_FEES.map(f => (
                    <button
                      key={f}
                      className={`trn-fee-btn${fee === f ? ' active' : ''}`}
                      onClick={() => setFee(f)}
                    >
                      {f}€
                    </button>
                  ))}
                </div>
                {user && fee > user.balance && (
                  <div className="field-error" style={{ marginTop: 8 }}>{t('home_insufficient')}</div>
                )}
              </div>

              <div className="trn-prize-preview">
                <span className="trn-prize-label">{t('trn_prize_pool')}</span>
                <span className="trn-prize-val">{(fee * size * 0.9).toFixed(0)}€</span>
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 4 }}
                onClick={createRoom}
                disabled={creating || (user && fee > user.balance)}
              >
                {creating ? t('home_creating') : t('trn_create_btn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
