import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useLanguage } from '../context/LanguageContext';
import { playCorrect, playWrong, playWin, playLose, playDraw, playTick, playUrgentTick } from '../utils/sounds';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || undefined;

export default function DuelMathRoom({ user, onGameEnd }) {
  const { code } = useParams();
  const navigate  = useNavigate();
  const { t }     = useLanguage();

  const [phase, setPhase]             = useState('connecting'); // connecting|waiting|countdown|playing|round_end|game_over
  const [countdown, setCountdown]     = useState(3);
  const [round, setRound]             = useState(1);
  const [totalRounds, setTotalRounds] = useState(10);
  const [expression, setExpression]   = useState('');
  const [options, setOptions]         = useState([]);
  const [timeLeft, setTimeLeft]       = useState(12);
  const [timeMs, setTimeMs]           = useState(12000);
  const [scores, setScores]           = useState([]);
  const [bet, setBet]                 = useState(0);
  const [answered, setAnswered]       = useState(false);
  const [feedback, setFeedback]       = useState(null); // null | 'correct' | 'wrong'
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [correctIdx, setCorrectIdx]   = useState(null);
  const [streak, setStreak]           = useState(0);
  const [gameResult, setGameResult]   = useState(null);
  const [showLeave, setShowLeave]     = useState(false);

  const socketRef    = useRef(null);
  const timerRef     = useRef(null);
  const questionRef  = useRef(null);
  const pendingNavTo = useRef(null);
  const onGameEndRef = useRef(onGameEnd);

  useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);

  // Block browser close/refresh during game
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'round_end') return;
    const handler = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // Intercept navbar clicks during game — show leave confirmation instead
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'round_end') return;
    const handler = e => {
      const link = e.target.closest('a');
      if (!link) return;
      if (!link.closest('.nav') && !link.closest('.mobile-menu')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try { pendingNavTo.current = new URL(link.href).pathname; } catch { pendingNavTo.current = '/'; }
      setShowLeave(true);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [phase]);

  // Timer bar
  const prevTickRef = useRef(null);
  const startTimer = useCallback((ms) => {
    clearInterval(timerRef.current);
    prevTickRef.current = null;
    const end = Date.now() + ms;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      const secs = Math.ceil(left / 1000);
      setTimeLeft(secs);
      if (secs !== prevTickRef.current) {
        prevTickRef.current = secs;
        if (secs <= 3 && secs > 0) playUrgentTick();
        else if (secs <= 6 && secs > 0) playTick();
      }
      if (left <= 0) clearInterval(timerRef.current);
    }, 100);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('dm:join', { roomCode: code });
    });

    socket.on('dm:joined', ({ bet: b }) => {
      setBet(b);
    });

    socket.on('dm:waiting', () => {
      setPhase('waiting');
    });

    socket.on('dm:start', ({ players, bet: b, totalRounds: tr }) => {
      setScores(players);
      setBet(b);
      setTotalRounds(tr);
      setPhase('countdown');
      let c = 3;
      setCountdown(c);
      const iv = setInterval(() => {
        c--;
        setCountdown(c);
        if (c <= 0) { clearInterval(iv); }
      }, 1000);
    });

    socket.on('dm:question', ({ round: r, totalRounds: tr, expression: ex, options: opts, timeMs: ms }) => {
      clearInterval(timerRef.current);
      setRound(r);
      setTotalRounds(tr);
      setExpression(ex);
      setOptions(opts);
      setTimeMs(ms);
      setAnswered(false);
      setFeedback(null);
      setSelectedIdx(null);
      setCorrectIdx(null);
      setPhase('playing');
      questionRef.current = { expression: ex, options: opts };
      startTimer(ms);
    });

    socket.on('dm:answer_result', ({ correct, points, answerIndex, correctIndex: ci, streak: s }) => {
      clearInterval(timerRef.current);
      setFeedback(correct ? 'correct' : 'wrong');
      setCorrectIdx(ci);
      if (correct) playCorrect(); else playWrong();
      setStreak(s);
      setTimeout(() => setFeedback(null), 900);
    });

    socket.on('dm:scores_update', ({ scores: s }) => {
      setScores(s);
    });

    socket.on('dm:round_end', ({ correctIndex: ci, scores: s }) => {
      clearInterval(timerRef.current);
      setCorrectIdx(ci);
      setScores(s);
      setPhase('round_end');
    });

    socket.on('dm:game_over', (data) => {
      clearInterval(timerRef.current);
      setGameResult(data);
      setPhase('game_over');
      if (data.draw) playDraw();
      else if (data.winnerId === user?.id) playWin();
      else playLose();
      if (onGameEndRef.current) onGameEndRef.current();
    });

    socket.on('dm:opponent_left', () => {
      clearInterval(timerRef.current);
      setPhase('game_over');
      setGameResult({ opponentLeft: true });
    });

    socket.on('dm:error', ({ message }) => {
      alert(message);
      navigate('/duelmath');
    });

    socket.on('connect_error', () => {
      setPhase('waiting');
    });

    return () => {
      clearInterval(timerRef.current);
      socket.emit('dm:leave', { roomCode: code });
      socket.disconnect();
    };
  }, [code, navigate, startTimer]);

  const submitAnswer = useCallback((idx) => {
    if (answered || phase !== 'playing') return;
    setAnswered(true);
    setSelectedIdx(idx);
    socketRef.current?.emit('dm:answer', { roomCode: code, answerIndex: idx });
  }, [answered, phase, code]);

  const handleLeaveConfirm = () => {
    socketRef.current?.emit('dm:leave', { roomCode: code });
    socketRef.current?.disconnect();
    const dest = pendingNavTo.current || '/duelmath';
    pendingNavTo.current = null;
    navigate(dest);
  };

  const timerPct = timeMs > 0 ? (timeLeft / (timeMs / 1000)) * 100 : 0;
  const myId     = user?.id;
  const me       = scores.find(s => s.id === myId);
  const opp      = scores.find(s => s.id !== myId);

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'connecting' || phase === 'waiting') {
    return (
      <div className="page dm-page">
        <div className="dm-waiting-box">
          <div className="dm-waiting-icon" />
          <h2 className="dm-waiting-title">Duel Math</h2>
          <p className="dm-waiting-sub">{phase === 'connecting' ? t('dm_connecting') : t('dm_waiting_opp')}</p>
          <div className="dm-room-code-display">
            <span className="dm-code-label">{t('room_code_label')}</span>
            <span className="dm-code-val">{code}</span>
          </div>
          <div className="spinner" style={{ margin: '16px auto 0' }} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 24 }} onClick={() => navigate('/duelmath')}>
            {t('room_leave')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="page dm-page">
        <div className="dm-countdown-box">
          <div className="dm-countdown-label">{t('dm_get_ready')}</div>
          <div className={`dm-countdown-num${countdown <= 1 ? ' dm-countdown-go' : ''}`}>
            {countdown > 0 ? countdown : 'GO!'}
          </div>
          <div className="dm-countdown-sub">{bet}€ {t('dm_at_stake')}</div>
        </div>
      </div>
    );
  }

  if (phase === 'game_over') {
    const isWinner  = gameResult?.winnerId === myId;
    const isDraw    = gameResult?.draw;
    const oppLeft   = gameResult?.opponentLeft;
    const myScore   = me?.score ?? 0;
    const oppScore  = opp?.score ?? 0;
    const newBal    = gameResult?.balances?.[myId];

    return (
      <div className="page dm-page">
        <div className="dm-result-box">
          <div className={`dm-result-icon ${isDraw ? 'draw' : isWinner || oppLeft ? 'win' : 'lose'}`}>
            <div className={`dm-result-icon-shape ${isDraw ? 'draw' : isWinner || oppLeft ? 'win' : 'lose'}`} />
          </div>
          <div className={`dm-result-label ${isDraw ? '' : isWinner || oppLeft ? 'win' : 'lose'}`}>
            {oppLeft ? t('dm_opp_left') : isDraw ? t('result_draw') : isWinner ? t('result_win') : t('result_lose')}
          </div>
          {!oppLeft && !isDraw && (
            <div className="dm-result-delta">
              {isWinner ? `+${bet}€` : `−${bet}€`}
            </div>
          )}
          <div className="dm-result-scores">
            <div className="dm-result-score-col">
              <div className="dm-result-score-name">{me?.username ?? t('quiz_you')}</div>
              <div className="dm-result-score-val">{myScore}</div>
              <div className="dm-result-score-lbl">{t('result_points')}</div>
            </div>
            <div className="dm-result-score-sep">vs</div>
            <div className="dm-result-score-col">
              <div className="dm-result-score-name">{opp?.username ?? t('room_opponent')}</div>
              <div className="dm-result-score-val">{oppScore}</div>
              <div className="dm-result-score-lbl">{t('result_points')}</div>
            </div>
          </div>
          {newBal !== undefined && (
            <div className="dm-result-balance">{t('dm_new_balance')}: <strong>{newBal.toFixed(2)}€</strong></div>
          )}
          <div className="modal-actions" style={{ marginTop: 24 }}>
            <button className="btn btn-primary" onClick={() => navigate('/duelmath')}>{t('dm_play_again')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>{t('result_home')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page dm-page">
      <div className="dm-arena">

        {/* Header: scores */}
        <div className="dm-scoreboard">
          <div className={`dm-player-card${me && opp && me.score > opp.score ? ' dm-player-leading' : ''}`}>
            <div className="dm-player-name">{me?.username ?? t('quiz_you')} {me?.streak >= 3 && <span className="dm-streak-fire">×{me.streak}</span>}</div>
            <div className="dm-player-score">{me?.score ?? 0}</div>
          </div>
          <div className="dm-vs-badge">VS</div>
          <div className={`dm-player-card dm-player-card-right${opp && me && opp.score > me.score ? ' dm-player-leading' : ''}`}>
            <div className="dm-player-name">{opp?.username ?? t('room_opponent')} {opp?.streak >= 3 && <span className="dm-streak-fire">×{opp.streak}</span>}</div>
            <div className="dm-player-score">{opp?.score ?? 0}</div>
          </div>
        </div>

        {/* Progress bar (rounds) */}
        <div className="dm-progress-wrap">
          <div className="dm-progress-bar" style={{ width: `${((round - 1) / totalRounds) * 100}%` }} />
          <span className="dm-progress-label">{t('dm_round')} {round}/{totalRounds}</span>
        </div>

        {/* Timer bar */}
        <div className="dm-timer-track">
          <div
            className={`dm-timer-bar${timeLeft <= 3 ? ' dm-timer-urgent' : ''}`}
            style={{ width: `${timerPct}%`, transition: 'width 0.1s linear' }}
          />
        </div>
        <div className="dm-timer-label">{timeLeft}s</div>

        {/* Expression */}
        <div className={`dm-expression${feedback === 'correct' ? ' dm-flash-correct' : feedback === 'wrong' ? ' dm-flash-wrong' : ''}`}>
          {phase === 'round_end' && !expression ? '...' : expression}
        </div>

        {/* Options */}
        <div className="dm-options">
          {options.map((opt, i) => {
            let cls = 'dm-option';
            if (answered || phase === 'round_end') {
              if (i === correctIdx) cls += ' dm-option-correct';
              else if (i === selectedIdx && i !== correctIdx) cls += ' dm-option-wrong';
              else cls += ' dm-option-dim';
            }
            return (
              <button
                key={i}
                className={cls}
                onClick={() => submitAnswer(i)}
                disabled={answered || phase === 'round_end'}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {streak >= 3 && phase === 'playing' && !answered && (
          <div className="dm-streak-banner">{streak} {t('dm_streak')}</div>
        )}

        <button className="btn btn-ghost btn-xs dm-leave-btn" onClick={() => setShowLeave(true)}>
          {t('room_forfeit')}
        </button>
      </div>

      {/* Leave confirm modal */}
      {showLeave && (
        <div className="modal-overlay" onClick={() => setShowLeave(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">{t('leave_title')}</h2>
            <p style={{ color: 'var(--text-2)', marginBottom: 20 }}>
              {t('leave_body')} <strong>{bet}€</strong> {t('leave_body2')}
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowLeave(false)}>{t('leave_keep')}</button>
              <button className="btn btn-neg" onClick={handleLeaveConfirm}>{t('leave_confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
