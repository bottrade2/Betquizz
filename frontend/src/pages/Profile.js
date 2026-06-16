import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';
import AvatarIcon, { AVATAR_COUNT } from '../components/AvatarIcon';

export default function Profile({ user, onBalanceUpdate, onAvatarUpdate }) {
  const { t } = useLanguage();
  const [profile, setProfile]       = useState(null);
  const [history, setHistory]       = useState([]);
  const [transactions, setTxs]      = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('history');
  const [avatarIcon, setAvatarIcon] = useState(0);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);

  const [walletModal, setWalletModal]   = useState(null);
  const [walletAmount, setWalletAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletError, setWalletError]   = useState('');
  const [walletBusy, setWalletBusy]     = useState(false);
  const [withdrawDone, setWithdrawDone] = useState(null);
  const inputRef = useRef(null);

  // Solana deposit state
  const [solAddress, setSolAddress]   = useState('');
  const [solPrice, setSolPrice]       = useState(null);
  const [solChecking, setSolChecking] = useState(false);
  const [solCredited, setSolCredited] = useState(null);
  const [copied, setCopied]           = useState(false);
  const solPollRef = useRef(null);

  useEffect(() => {
    Promise.all([api.get('/auth/profile'), api.get('/game/history'), api.get('/payment/transactions')])
      .then(([{ data: p }, { data: h }, { data: tx }]) => {
        setProfile(p); setHistory(h); setTxs(tx); setLoading(false);
        setAvatarIcon(p.avatar_icon ?? 0);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (walletModal === 'withdraw') setTimeout(() => inputRef.current?.focus(), 60);
  }, [walletModal]);

  // Load Solana address when deposit modal opens
  useEffect(() => {
    if (walletModal !== 'deposit') {
      clearInterval(solPollRef.current);
      return;
    }
    setSolCredited(null);
    api.get('/payment/deposit-address')
      .then(({ data }) => { setSolAddress(data.address); setSolPrice(data.solPrice); })
      .catch(() => {});

  }, [walletModal]);

  const checkSolDeposit = useCallback(async (manual = true) => {
    if (manual) setSolChecking(true);
    try {
      const { data } = await api.post('/payment/deposit-check');
      if (data.credited > 0) {
        setSolCredited(data.credited);
        setProfile(prev => ({ ...prev, balance: data.balance }));
        if (onBalanceUpdate) onBalanceUpdate(data.balance);
      }
    } catch {}
    finally { if (manual) setSolChecking(false); }
  }, [onBalanceUpdate]);

  const copyAddress = () => {
    navigator.clipboard.writeText(solAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openWallet  = (type) => { setWalletModal(type); setWalletAmount(''); setWalletAddress(''); setWalletError(''); setWithdrawDone(null); };
  const closeWallet = () => { setWalletModal(null); setWalletAmount(''); setWalletAddress(''); setWalletError(''); setSolCredited(null); setWithdrawDone(null); };

  const submitWithdraw = async () => {
    const amount = parseFloat(walletAmount);
    if (isNaN(amount) || amount <= 0) { setWalletError(t('wallet_err_invalid')); return; }
    if (amount < WITHDRAW_MIN) { setWalletError(t('wallet_err_max_withdraw')); return; }
    if (amount > (p?.balance ?? 0)) { setWalletError(t('wallet_err_insufficient')); return; }
    if (!walletAddress || walletAddress.trim().length < 32) { setWalletError(t('wallet_err_address')); return; }
    setWalletBusy(true); setWalletError('');
    try {
      const { data } = await api.post('/payment/withdraw', { amount, to_address: walletAddress.trim() });
      setProfile(prev => ({ ...prev, balance: data.balance }));
      if (onBalanceUpdate) onBalanceUpdate(data.balance);
      setWithdrawDone({ amount, solAmount: data.sol_amount, signature: data.signature });
    } catch (err) {
      setWalletError(err.response?.data?.message || t('wallet_err_generic'));
    } finally {
      setWalletBusy(false);
    }
  };

  if (loading) return (
    <div className="page"><div className="container"><div className="loading"><div className="spinner" /><span>{t('profile_loading')}</span></div></div></div>
  );

  const p = profile || user;
  const wins   = p?.wins   || 0;
  const losses = p?.losses || 0;
  const draws  = p?.draws  || 0;
  const total  = wins + losses + draws;
  const wr     = total > 0 ? Math.round((wins / total) * 100) : 0;

  const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const outcomeClass = r => ({ win: 'w', lose: 'l', draw: 'd' }[r] || 'd');

  const DEPOSIT_PRESETS = [10, 25, 50, 100];
  const WITHDRAW_MIN = 50;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="profile-hero">
          <div style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }} onClick={() => setShowAvatarPicker(v => !v)}>
            <AvatarIcon icon={avatarIcon} size={64} />
            <div style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--accent)', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, border: '2px solid var(--ink)' }}>✏️</div>
          </div>
          <div className="profile-info">
            <h1 className="profile-name">{p?.username}</h1>
            <div className="profile-email">{p?.email}</div>
            <div className="profile-balance-chip">{p?.balance ?? 0}€</div>
          </div>
          <div className="profile-wr">
            <div className="profile-wr-val">{wr}%</div>
            <div className="profile-wr-lbl">{t('profile_win_rate')}</div>
          </div>
        </div>

        {showAvatarPicker && (
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 14 }}>Escolhe o teu avatar</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              {Array.from({ length: AVATAR_COUNT }, (_, i) => (
                <div
                  key={i}
                  onClick={() => setAvatarIcon(i)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: '50%',
                    outline: avatarIcon === i ? '3px solid var(--accent)' : '3px solid transparent',
                    outlineOffset: 3,
                    transition: 'outline 0.15s',
                  }}
                >
                  <AvatarIcon icon={i} size={52} />
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary btn-sm"
              disabled={avatarSaving}
              onClick={async () => {
                setAvatarSaving(true);
                try {
                  await api.patch('/auth/avatar', { avatar_icon: avatarIcon });
                  setShowAvatarPicker(false);
                  if (onAvatarUpdate) onAvatarUpdate(avatarIcon);
                } catch {}
                setAvatarSaving(false);
              }}
            >
              {avatarSaving ? '...' : 'Guardar'}
            </button>
          </div>
        )}

        <div className="wallet-bar">
          <div className="wallet-bar-info">
            <div className="wallet-bar-label">{t('profile_balance')}</div>
            <div className="wallet-bar-val">{p?.balance ?? 0}€</div>
          </div>
          <div className="wallet-bar-actions">
            <button className="btn btn-primary btn-sm" onClick={() => openWallet('deposit')}>{t('profile_deposit')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => openWallet('withdraw')}>{t('profile_withdraw')}</button>
          </div>
        </div>

        {p?.referral_code && (
          <div className="card" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{t('referral_label')}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--accent)' }}>{p.referral_code}</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>{t('referral_desc')}</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { navigator.clipboard.writeText(p.referral_code); }}
            >
              {t('referral_copy')}
            </button>
          </div>
        )}

        <div className="profile-kpis">
          <div className="profile-kpi">
            <div className="profile-kpi-val">{total}</div>
            <div className="profile-kpi-lbl">{t('profile_games')}</div>
          </div>
          <div className="profile-kpi pos">
            <div className="profile-kpi-val">{wins}</div>
            <div className="profile-kpi-lbl">{t('profile_wins')}</div>
          </div>
          <div className="profile-kpi neg">
            <div className="profile-kpi-val">{losses}</div>
            <div className="profile-kpi-lbl">{t('profile_losses')}</div>
          </div>
          <div className="profile-kpi neu">
            <div className="profile-kpi-val">{draws}</div>
            <div className="profile-kpi-lbl">{t('profile_draws')}</div>
          </div>
        </div>

        <div className="section-tabs">
          <button className={`section-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            {t('profile_history')}
          </button>
          <button className={`section-tab${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>
            {t('profile_stats')}
          </button>
          <button className={`section-tab${tab === 'transactions' ? ' active' : ''}`} onClick={() => setTab('transactions')}>
            {t('profile_transactions')}
          </button>
        </div>

        {tab === 'history' && (
          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty">
                <div className="empty-title">{t('profile_no_games_title')}</div>
                <div className="empty-desc">{t('profile_no_games_desc')}</div>
              </div>
            ) : history.map((g, i) => {
              const oc = outcomeClass(g.result);
              return (
                <div key={i} className="history-row">
                  <div className={`history-outcome ${oc}`} />
                  <div className="history-info">
                    <div className="history-opp">vs {g.opponent?.username || t('profile_unknown')}</div>
                    <div className="history-meta">{fmt(g.createdAt)}</div>
                  </div>
                  <div className="history-score">{g.yourScore} — {g.opponentScore}</div>
                  <div className={`history-delta ${oc}`}>
                    {oc === 'w' ? '+' : oc === 'l' ? '−' : '±'}{g.bet}€
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'stats' && (
          <div className="stats-grid">
            <div className="card stats-card" style={{ gridColumn: '1 / -1' }}>
              <div className="stats-card-title">{t('profile_perf_title')}</div>
              {[
                { l: t('profile_stat_wr'),      v: `${wr}%` },
                { l: t('profile_stat_total'),   v: total },
                { l: t('profile_stat_won'),     v: `${p?.totalWon  || 0}€` },
                { l: t('profile_stat_lost'),    v: `${p?.totalLost || 0}€` },
                { l: t('profile_stat_balance'), v: `${p?.balance ?? 0}€` },
              ].map(s => (
                <div key={s.l} className="stat-row">
                  <span className="stat-row-label">{s.l}</span>
                  <span className="stat-row-val">{s.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'transactions' && (
          <div className="history-list">
            {transactions.length === 0 ? (
              <div className="empty">
                <div className="empty-title">{t('profile_no_tx_title')}</div>
                <div className="empty-desc">{t('profile_no_tx_desc')}</div>
              </div>
            ) : transactions.map((tx, i) => {
              const isDeposit = tx.type === 'deposit';
              const failed = tx.status === 'failed';
              return (
                <div key={i} className="history-row">
                  <div className={`history-outcome ${isDeposit ? 'w' : failed ? 'l' : 'd'}`} />
                  <div className="history-info">
                    <div className="history-opp">
                      {isDeposit ? t('profile_tx_deposit') : t('profile_tx_withdrawal')}
                      {tx.status && !isDeposit && (
                        <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.6 }}>
                          {tx.status === 'sent' ? t('profile_tx_sent') : tx.status === 'failed' ? t('profile_tx_failed') : t('profile_tx_pending')}
                        </span>
                      )}
                    </div>
                    <div className="history-meta">
                      {new Date(tx.created_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {tx.tx_signature && (
                      <div style={{ fontSize: 10, color: 'var(--text-4)', fontFamily: 'monospace', marginTop: 2 }}>
                        {tx.tx_signature.slice(0, 20)}...
                      </div>
                    )}
                  </div>
                  <div className="history-score" style={{ fontSize: 13 }}>
                    {parseFloat(tx.amount_sol).toFixed(4)} SOL
                  </div>
                  <div className={`history-delta ${isDeposit ? 'w' : failed ? 'l' : 'd'}`}>
                    {isDeposit ? '+' : '−'}{parseFloat(tx.amount_eur).toFixed(2)}€
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {walletModal && (
        <div className="modal-overlay" onClick={closeWallet}>
          <div className="modal-box wallet-modal-box" onClick={e => e.stopPropagation()}>

            {walletModal === 'deposit' ? (
              <>
                <h2 className="modal-title">{t('wallet_deposit_title')}</h2>

                {solCredited ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pos)', marginBottom: 6 }}>
                      +{solCredited.toFixed(2)}€ {t('wallet_credited')}
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: 14, marginBottom: 20 }}>
                      {t('wallet_new_balance')}: {profile?.balance?.toFixed(2)}€
                    </div>
                    <button className="btn btn-primary" onClick={closeWallet}>{t('wallet_close')}</button>
                  </div>
                ) : (
                  <>
                    <p className="wallet-modal-sub">{t('wallet_sol_sub')} · {t('wallet_deposit_min')} 10€</p>

                    {solPrice && (
                      <div className="sol-price-badge">
                        1 SOL ≈ {solPrice.toFixed(2)}€
                      </div>
                    )}

                    <div className="sol-address-box">
                      <div className="sol-address-label">{t('wallet_sol_address')}</div>
                      <div className="sol-address-text">{solAddress || '...'}</div>
                      <button
                        className={`btn btn-ghost btn-xs sol-copy-btn${copied ? ' copied' : ''}`}
                        onClick={copyAddress}
                        disabled={!solAddress}
                      >
                        {copied ? t('wallet_copied') : t('wallet_copy')}
                      </button>
                    </div>

                    <div className="modal-actions" style={{ marginTop: 16 }}>
                      <button className="btn btn-ghost btn-sm" onClick={closeWallet}>
                        {t('wallet_cancel')}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h2 className="modal-title">{t('wallet_withdraw_title')}</h2>

                {withdrawDone ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pos)', marginBottom: 6 }}>
                      {withdrawDone.amount.toFixed(2)}€ {t('wallet_withdraw_sent')}
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: 14, marginBottom: 4 }}>
                      {withdrawDone.solAmount?.toFixed(6)} SOL {t('wallet_withdraw_sent_to')}
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11, wordBreak: 'break-all', marginBottom: 20, padding: '0 8px' }}>
                      tx: {withdrawDone.signature}
                    </div>
                    <button className="btn btn-primary" onClick={closeWallet}>{t('wallet_close')}</button>
                  </div>
                ) : (
                  <>
                    <p className="wallet-modal-sub">{t('wallet_withdraw_sub')} {p?.balance ?? 0}€</p>

                    <input
                      ref={inputRef}
                      className="wallet-input"
                      type="number"
                      min={WITHDRAW_MIN}
                      step="1"
                      placeholder={t('wallet_withdraw_ph')}
                      value={walletAmount}
                      onChange={e => { setWalletAmount(e.target.value); setWalletError(''); }}
                    />

                    <input
                      className="wallet-input"
                      style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 12 }}
                      type="text"
                      placeholder={t('wallet_sol_address_ph')}
                      value={walletAddress}
                      onChange={e => { setWalletAddress(e.target.value); setWalletError(''); }}
                      onKeyDown={e => e.key === 'Enter' && submitWithdraw()}
                    />

                    {walletError && <div className="wallet-error">{walletError}</div>}

                    <div className="modal-actions" style={{ marginTop: 20 }}>
                      <button
                        className="btn btn-primary btn-lg"
                        onClick={submitWithdraw}
                        disabled={walletBusy || !walletAmount || !walletAddress}
                      >
                        {walletBusy ? t('wallet_processing') : t('wallet_confirm_withdraw')}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={closeWallet} disabled={walletBusy}>
                        {t('wallet_cancel')}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
