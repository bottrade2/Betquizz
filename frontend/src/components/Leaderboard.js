import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';
import AvatarIcon from './AvatarIcon';

export default function Leaderboard({ user }) {
  const { t } = useLanguage();
  const [players, setPlayers] = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/game/leaderboard')
      .then(({ data }) => {
        setPlayers(data.players || data);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const rankLabel = i => ['01','02','03'][i] ?? String(i + 1).padStart(2, '0');
  const rankCls   = i => i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
  const fmtWr     = p => p.winRate != null ? `${p.winRate}%` : '—';

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="lb-header">
          <h1 className="lb-title">{t('lb_title')}</h1>
        </div>

        {!loading && players.length >= 3 && (
          <div className="lb-podium">
            <div className="podium-card">
              <div className="podium-rank">02</div>
              <AvatarIcon icon={players[1].avatar_icon ?? 0} size={52} />
              <div className="podium-name">{players[1].username}</div>
              <div className="podium-val">{fmtWr(players[1])}</div>
            </div>
            <div className="podium-card podium-card-1">
              <div className="podium-rank podium-rank-1">01</div>
              <AvatarIcon icon={players[0].avatar_icon ?? 0} size={64} />
              <div className="podium-name">{players[0].username}</div>
              <div className="podium-val">{fmtWr(players[0])}</div>
            </div>
            <div className="podium-card">
              <div className="podium-rank">03</div>
              <AvatarIcon icon={players[2].avatar_icon ?? 0} size={52} />
              <div className="podium-name">{players[2].username}</div>
              <div className="podium-val">{fmtWr(players[2])}</div>
            </div>
          </div>
        )}

        <div className="lb-filter">
          <span className="lb-filter-title">{t('lb_full')}</span>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" /><span>{t('lb_loading')}</span></div>
        ) : players.length === 0 ? (
          <div className="empty-rooms" style={{ marginTop: 24 }}>
            <div className="empty-title">{t('lb_empty_title')}</div>
            <div className="empty-desc">{t('lb_empty_desc')}</div>
          </div>
        ) : (
          <div className="lb-list">
            {players.map((p, i) => (
              <div key={p.username} className={`lb-item${p.username === user?.username ? ' self' : ''}`}>
                <span className={`lb-rank ${rankCls(i)}`}>{rankLabel(i)}</span>
                <AvatarIcon icon={p.avatar_icon ?? 0} size={36} />
                <div className="lb-name">
                  {p.username}
                  {p.username === user?.username && <span className="lb-self-tag">{t('lb_you')}</span>}
                </div>
                <div className="lb-stats">
                  <div className="lb-stat">
                    <div className="lb-stat-val" style={{ color: 'var(--accent)' }}>{fmtWr(p)}</div>
                    <div className="lb-stat-lbl">{t('lb_win_rate')}</div>
                  </div>
                  <div className="lb-stat">
                    <div className="lb-stat-val">{p.games || 0}</div>
                    <div className="lb-stat-lbl">{t('lb_games')}</div>
                  </div>
                  <div className="lb-stat">
                    <div className="lb-stat-val">{p.wins || 0}</div>
                    <div className="lb-stat-lbl">{t('lb_wins')}</div>
                  </div>
                  <div className="lb-stat">
                    <div className="lb-stat-val">{p.balance}€</div>
                    <div className="lb-stat-lbl">{t('lb_balance')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
