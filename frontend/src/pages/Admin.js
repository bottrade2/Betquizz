import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

export default function Admin({ user }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [tab, setTab]         = useState('users');
  const [stats, setStats]     = useState(null);
  const [users, setUsers]     = useState([]);
  const [rooms, setRooms]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [balanceEdit, setBalanceEdit] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage]     = useState(1);
  const USER_PAGE_SIZE = 15;

  useEffect(() => {
    if (user && !user.is_admin) navigate('/', { replace: true });
  }, [user, navigate]);

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, r] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/users'),
        api.get('/admin/rooms'),
      ]);
      setStats(s.data);
      setUsers(u.data);
      setRooms(r.data);
    } catch {
      showToast(t('admin_err_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (user?.is_admin) load(); }, [user, load]);

  const adjustBalance = async (userId) => {
    if (!balanceEdit || balanceEdit.id !== userId) return;
    const raw = parseFloat(balanceEdit.amount);
    if (isNaN(raw) || raw <= 0) return;
    const amount = balanceEdit.mode === 'remove' ? -raw : raw;
    setSaving(true);
    try {
      const { data } = await api.post(`/admin/users/${userId}/balance`, { amount });
      showToast(`${t('admin_balance_updated')} → ${data.balance.toFixed(2)}€`);
      setBalanceEdit(null);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, balance: data.balance } : u));
    } catch (err) {
      showToast(err.response?.data?.message || t('admin_err_balance'));
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (id, username) => {
    if (!window.confirm(`${t('admin_confirm_delete_user')} "${username}"?`)) return;
    try {
      await api.delete(`/admin/users/${id}`);
      setUsers(prev => prev.filter(u => u.id !== id));
      showToast(`"${username}" ${t('admin_deleted')}`);
    } catch (err) {
      showToast(err.response?.data?.message || t('admin_err_delete_user'));
    }
  };

  const deleteRoom = async (code) => {
    if (!window.confirm(`${t('admin_confirm_delete_room')} ${code}?`)) return;
    try {
      await api.delete(`/admin/rooms/${code}`);
      setRooms(prev => prev.filter(r => r.room_code !== code));
      showToast(`${t('admin_col_code')} ${code} ${t('admin_deleted')}`);
    } catch {
      showToast(t('admin_err_delete_room'));
    }
  };

  if (!user?.is_admin) return null;

  const realUsers = users.filter(u => !u.is_bot);
  const filteredUsers = userSearch.trim()
    ? realUsers.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()))
    : realUsers;
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
  const pagedUsers = filteredUsers.slice((userPage - 1) * USER_PAGE_SIZE, userPage * USER_PAGE_SIZE);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 1100 }}>

        <div className="admin-header">
          <div>
            <div className="home-eyebrow">BetQuizz</div>
            <h1 className="admin-title">{t('admin_title')}</h1>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load}>{t('admin_refresh')}</button>
        </div>

        {toast && <div className="admin-toast">{toast}</div>}

        {stats && (
          <div className="admin-stats">
            <div className="admin-stat-card">
              <div className="admin-stat-val">{stats.total_users}</div>
              <div className="admin-stat-lbl">{t('admin_real_users')}</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-val">{stats.total_games}</div>
              <div className="admin-stat-lbl">{t('admin_games_played')}</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-val" style={{ color: stats.active_games > 0 ? 'var(--pos)' : undefined }}>
                {stats.active_games}
              </div>
              <div className="admin-stat-lbl">{t('admin_active_now')}</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-val">{parseFloat(stats.total_balance || 0).toFixed(2)}€</div>
              <div className="admin-stat-lbl">{t('admin_total_balance')}</div>
            </div>
          </div>
        )}

        <div className="panel-tabs" style={{ marginBottom: 24 }}>
          <button className={`panel-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
            {t('admin_tab_users')} {!loading && `(${realUsers.length})`}
          </button>
          <button className={`panel-tab${tab === 'rooms' ? ' active' : ''}`} onClick={() => setTab('rooms')}>
            {t('admin_tab_rooms')} {!loading && `(${rooms.length})`}
          </button>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : tab === 'users' ? (
          <div className="admin-table-wrap">
            <div className="admin-search-row">
              <input
                className="field-input"
                style={{ maxWidth: 280 }}
                placeholder={t('admin_search_ph')}
                value={userSearch}
                onChange={e => { setUserSearch(e.target.value); setUserPage(1); }}
              />
              <span className="admin-td-muted" style={{ fontSize: 13 }}>
                {filteredUsers.length} {t('admin_col_id') && t('admin_real_users').toLowerCase()}
              </span>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin_col_id')}</th>
                  <th>{t('admin_col_username')}</th>
                  <th>{t('admin_col_email')}</th>
                  <th>{t('admin_col_balance')}</th>
                  <th>{t('admin_col_games')}</th>
                  <th>{t('admin_col_wins')}</th>
                  <th>{t('admin_col_role')}</th>
                  <th>{t('admin_col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map(u => (
                  <tr key={u.id} className={u.is_admin ? 'admin-row-highlight' : ''}>
                    <td className="admin-td-muted">{u.id}</td>
                    <td><strong>{u.username}</strong></td>
                    <td className="admin-td-muted">{u.email}</td>
                    <td className="admin-td-num">{parseFloat(u.balance).toFixed(2)}€</td>
                    <td className="admin-td-num">{u.games_played}</td>
                    <td className="admin-td-num">{u.games_won}</td>
                    <td>
                      {u.is_admin
                        ? <span className="badge badge-gold">{t('admin_role_admin')}</span>
                        : <span className="admin-td-muted">{t('admin_role_user')}</span>}
                    </td>
                    <td>
                      {balanceEdit?.id === u.id ? (
                        <div className="admin-bal-row">
                          <span style={{
                            fontSize: 13, fontWeight: 700, flexShrink: 0,
                            color: balanceEdit.mode === 'remove' ? 'var(--neg)' : 'var(--pos)',
                          }}>
                            {balanceEdit.mode === 'remove' ? '−' : '+'}
                          </span>
                          <input
                            className="field-input admin-bal-input"
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder={t('admin_bal_ph')}
                            value={balanceEdit.amount}
                            onChange={e => setBalanceEdit({ ...balanceEdit, amount: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') adjustBalance(u.id); if (e.key === 'Escape') setBalanceEdit(null); }}
                            autoFocus
                          />
                          <button className="btn btn-primary btn-xs" onClick={() => adjustBalance(u.id)} disabled={saving}>OK</button>
                          <button className="btn btn-ghost btn-xs" onClick={() => setBalanceEdit(null)}>✕</button>
                        </div>
                      ) : (
                        <div className="admin-actions-row">
                          <button
                            className="btn btn-ghost btn-xs"
                            style={{ color: 'var(--pos)' }}
                            onClick={() => setBalanceEdit({ id: u.id, amount: '', mode: 'add' })}
                          >
                            {t('admin_btn_add')}
                          </button>
                          <button
                            className="btn btn-ghost btn-xs"
                            style={{ color: 'var(--neg)' }}
                            onClick={() => setBalanceEdit({ id: u.id, amount: '', mode: 'remove' })}
                          >
                            {t('admin_btn_remove')}
                          </button>
                          {!u.is_admin && (
                            <button
                              className="btn btn-ghost btn-xs admin-btn-danger"
                              onClick={() => deleteUser(u.id, u.username)}
                            >
                              {t('admin_btn_delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {userTotalPages > 1 && (
              <div className="rooms-pagination" style={{ marginTop: 16 }}>
                {Array.from({ length: userTotalPages }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    className={`pagination-btn${userPage === n ? ' active' : ''}`}
                    onClick={() => setUserPage(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin_col_code')}</th>
                  <th>{t('admin_col_player1')}</th>
                  <th>{t('admin_col_player2')}</th>
                  <th>{t('admin_col_theme')}</th>
                  <th>{t('admin_col_diff')}</th>
                  <th>{t('admin_col_bet')}</th>
                  <th>{t('admin_col_status')}</th>
                  <th>{t('admin_col_created')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rooms.map(r => (
                  <tr key={r.room_code}>
                    <td><strong style={{ fontFamily: 'var(--mono)', letterSpacing: '0.1em' }}>{r.room_code}</strong></td>
                    <td>{r.player1_username || '—'}</td>
                    <td>{r.player2_username || '—'}</td>
                    <td>{r.theme}</td>
                    <td>{r.difficulty}</td>
                    <td className="admin-td-num">{r.bet}€</td>
                    <td>
                      <span className={`badge ${
                        r.status === 'waiting'  ? 'badge-accent' :
                        r.status === 'playing'  ? 'badge-pos'    : 'badge-neg'
                      } badge-dot`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="admin-td-muted">
                      {new Date(r.created_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-xs admin-btn-danger"
                        onClick={() => deleteRoom(r.room_code)}
                      >
                        {t('admin_btn_delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rooms.length === 0 && (
              <div className="empty-rooms" style={{ marginTop: 24 }}>
                <div className="empty-title">{t('admin_no_rooms')}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
