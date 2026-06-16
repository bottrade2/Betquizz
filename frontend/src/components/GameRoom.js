import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../utils/socket';
import { playCorrect, playWrong, playWin, playLose, playDraw } from '../utils/sounds';
import Quiz from './Quiz';
import api from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

export default function GameRoom({ user, onGameEnd }) {
  const { code }   = useParams();
  const navigate   = useNavigate();
  const { t, lang } = useLanguage();
  const onGameEndRef = useRef(onGameEnd);
  useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);
  const [room, setRoom]              = useState(null);
  const [phase, setPhase]            = useState('waiting');
  const [question, setQuestion]      = useState(null);
  const [qIndex, setQIndex]          = useState(0);
  const [timeLeft, setTimeLeft]      = useState(15);
  const [scores, setScores]          = useState({ player1: { score: 0 }, player2: { score: 0 } });
  const [gameResult, setGameResult]  = useState(null);
  const [answerResult, setAnswerResult] = useState(null); // { correct, answerIndex, points }
  const [messages, setMessages]   = useState([]);
  const [chatText, setChatText]   = useState('');
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const pendingNavTo    = useRef(null);
  const bottomRef       = useRef(null);
  const timerRef        = useRef(null);
  const myPlayerKey     = useRef(null);

  useEffect(() => {
    api.get(`/game/rooms/${code}`)
      .then(({ data }) => setRoom(data))
      .catch(() => navigate('/'));

    const doJoin = () => socket.emit('joinRoom', { roomCode: code, lang });
    if (socket.connected) {
      doJoin();
    } else {
      socket.auth = { token: localStorage.getItem('token') };
      socket.connect();
      socket.once('connect', doJoin);
    }

    socket.on('roomJoined', ({ playerNumber, room: r }) => {
      myPlayerKey.current = playerNumber === 1 ? 'player1' : 'player2';
      setRoom(r);
    });

    socket.on('playerJoined', ({ room: r }) => setRoom(r));
    socket.on('playerLeft',   ({ room: r }) => setRoom(r));

    socket.on('gameStarted', ({ players }) => {
      if (!myPlayerKey.current)
        myPlayerKey.current = players?.player1 === user.username ? 'player1' : 'player2';
      setPhase('playing');
    });

    socket.on('question', ({ index, total, question: text, options, pt, es, timeLimit }) => {
      clearInterval(timerRef.current);
      setAnswerResult(null);
      const limit = timeLimit || 15;
      setQuestion({ text, options, pt, es, total });
      setQIndex(index);
      setTimeLeft(limit);
      let t = limit;
      timerRef.current = setInterval(() => {
        t -= 1;
        setTimeLeft(t);
        if (t <= 0) clearInterval(timerRef.current);
      }, 1000);
    });

    socket.on('timeUp', () => { clearInterval(timerRef.current); setTimeLeft(0); });
    socket.on('answerResult', ({ player, correct, answerIndex, pointsEarned, scores: s }) => {
      setScores(s);
      const myKey = myPlayerKey.current || (s?.player1?.username === user.username ? 'player1' : 'player2');
      if (player === myKey) {
        setAnswerResult({ correct, answerIndex, points: pointsEarned });
        if (correct) playCorrect(); else playWrong();
      }
    });

    socket.on('gameEnded', (data) => {
      clearInterval(timerRef.current);
      setGameResult(data);
      setScores(data.scores);
      setPhase('finished');
      if (onGameEndRef.current) onGameEndRef.current(data.balances);
      // Result sound
      const myU = user.username;
      if (!data.winner) playDraw();
      else if (data.winner === myU) playWin();
      else playLose();
    });

    socket.on('chatMessage', (msg) => setMessages(prev => [...prev, msg]));
    socket.on('roomCancelled', () => navigate('/'));
    socket.on('error', ({ message: msg }) => {
      if (msg === 'Room not found.' || msg === 'Game already started.') navigate('/');
    });

    return () => {
      clearInterval(timerRef.current);
      socket.off('connect', doJoin);
      socket.emit('leaveRoom', { roomCode: code, explicit: false });
      ['roomJoined','playerJoined','playerLeft','gameStarted','question','timeUp',
       'answerResult','gameEnded','chatMessage','roomCancelled','error']
        .forEach(e => socket.off(e));
    };
  }, [code]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const handler = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const handler = e => {
      const link = e.target.closest('a');
      if (!link) return;
      if (!link.closest('.nav') && !link.closest('.mobile-menu')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try { pendingNavTo.current = new URL(link.href).pathname; } catch { pendingNavTo.current = '/'; }
      setShowLeaveModal(true);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [phase]);

  const myKey  = myPlayerKey.current || (scores?.player1?.username === user.username ? 'player1' : 'player2');
  const oppKey = myKey === 'player1' ? 'player2' : 'player1';
  const myScore  = scores?.[myKey]?.score  ?? 0;
  const oppScore = scores?.[oppKey]?.score ?? 0;
  const oppName  = scores?.[oppKey]?.username || room?.player2?.username || t('room_opponent');

  const sendAnswer = (answerIndex) => socket.emit('answer', { roomCode: code, questionIndex: qIndex, answerIndex });

  const handleLeave = () => {
    socket.emit('leaveRoom', { roomCode: code, explicit: true });
    navigate('/');
  };

  const confirmLeaveGame = () => {
    setShowLeaveModal(false);
    socket.emit('leaveRoom', { roomCode: code, explicit: true });
    navigate(pendingNavTo.current || '/');
    pendingNavTo.current = null;
  };

  const cancelLeaveGame = () => {
    setShowLeaveModal(false);
    pendingNavTo.current = null;
  };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    socket.emit('chatMessage', { roomCode: code, message: chatText });
    setChatText('');
  };

  if (phase === 'finished' && gameResult) {
    const { winner, scores: finalScores, bet } = gameResult;
    const isWin  = winner === user.username;
    const isDraw = !winner;
    const cls    = isDraw ? 'draw' : isWin ? 'win' : 'lose';
    const myFinal  = finalScores?.[myKey]?.score  ?? myScore;
    const oppFinal = finalScores?.[oppKey]?.score ?? oppScore;
    return (
      <div className="page"><div className="container">
        <div className="result-wrap">
          <div className="result-status">{t('result_title')}</div>
          <h1 className={`result-heading ${cls}`}>
            {isDraw ? t('result_draw') : isWin ? t('result_win') : t('result_lose')}
          </h1>
          <p className="result-sub">
            {isDraw
              ? t('result_draw_desc')
              : isWin
              ? `${t('result_win_desc')} ${bet}€ ${t('result_win_desc2')}`
              : `${t('result_lose_desc')} ${bet}€ ${t('result_lose_desc2')}`}
          </p>
          <div className="result-score-strip">
            <div className={`result-score-side${isWin || isDraw ? ' winner' : ''}`}>
              <div className="result-score-name">{t('result_you')}</div>
              <div className="result-score-val">{myFinal}</div>
              <div className="result-score-lbl">{t('result_points')}</div>
            </div>
            <div className="result-vs">—</div>
            <div className={`result-score-side${!isWin && !isDraw ? ' winner' : ''}`}>
              <div className="result-score-name">{oppName}</div>
              <div className="result-score-val">{oppFinal}</div>
              <div className="result-score-lbl">{t('result_points')}</div>
            </div>
          </div>
          <div className={`result-delta ${cls}`}>{isDraw ? '±0€' : isWin ? `+${bet}€` : `−${bet}€`}</div>
          <div className="result-actions">
            <button className="btn btn-primary btn-lg" onClick={() => navigate('/')}>{t('result_home')}</button>
            <button className="btn btn-ghost btn-lg" onClick={() => navigate('/leaderboard')}>{t('result_ranking')}</button>
          </div>
        </div>
      </div></div>
    );
  }

  if (phase === 'playing' && question) {
    return (
      <div className="page">
        <Quiz question={question} questionIndex={qIndex} total={question.total || 10}
          timeLeft={timeLeft} onAnswer={sendAnswer} answerResult={answerResult}
          yourScore={myScore} opponentScore={oppScore} opponentName={oppName} />

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--neg)', fontSize: 12 }}
            onClick={() => { pendingNavTo.current = '/'; setShowLeaveModal(true); }}
          >
            {t('room_forfeit')}
          </button>
        </div>

        {showLeaveModal && (
          <div className="modal-overlay" onClick={cancelLeaveGame}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-icon">⚠</div>
              <h2 className="modal-title">{t('leave_title')}</h2>
              <p className="modal-body">
                {t('leave_body')} <span className="modal-bet">{room?.bet ?? '?'}€</span> {t('leave_body2')}
              </p>
              <div className="modal-actions">
                <button className="btn btn-primary btn-lg" onClick={cancelLeaveGame}>
                  {t('leave_keep')}
                </button>
                <button className="btn btn-ghost btn-sm modal-leave-btn" onClick={confirmLeaveGame}>
                  {t('leave_confirm')} {room?.bet ?? '?'}€
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page"><div className="container">
      <div className="room-layout">
        <div className="room-main">
          <div className="room-bar">
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-4)', marginBottom: 4 }}>{t('room_code_label')}</div>
              <div className="room-bar-code">{code}</div>
            </div>
            <div className="players-display">
              {room?.player1 && (
                <div className="player-chip">
                  <div className="player-chip-avatar">{room.player1.username[0].toUpperCase()}</div>
                  <div>
                    <div className="player-chip-name">{room.player1.username}</div>
                    {room.player1.username === user.username && <div className="player-chip-you">{t('lb_you')}</div>}
                  </div>
                </div>
              )}
              <span className="versus-mark">vs</span>
              {room?.player2 ? (
                <div className="player-chip">
                  <div className="player-chip-avatar">{room.player2.username[0].toUpperCase()}</div>
                  <div>
                    <div className="player-chip-name">{room.player2.username}</div>
                    {room.player2.username === user.username && <div className="player-chip-you">{t('lb_you')}</div>}
                  </div>
                </div>
              ) : (
                <div className="player-chip ghost">
                  <div className="player-chip-avatar">?</div>
                  <div className="player-chip-name" style={{ color: 'var(--text-3)' }}>{t('room_waiting_opp')}</div>
                </div>
              )}
            </div>
            <div className="room-bar-meta">
              {room && <span style={{ color: 'var(--accent)' }}>{room.bet}€</span>}
            </div>
          </div>

          <div className="waiting-area">
            {room?.player2 ? (
              <>
                <h2 className="waiting-title">{t('room_starting')}</h2>
                <p className="waiting-desc">{t('room_both_ready')}</p>
                <div className="pulse-row" style={{ margin: '24px 0' }}>
                  <div className="pulse-dot" /><div className="pulse-dot" /><div className="pulse-dot" />
                </div>
              </>
            ) : (
              <>
                <h2 className="waiting-title">{t('room_waiting_opp')}</h2>
                <p className="waiting-desc">{t('room_share')}</p>
                <div className="code-display">
                  <span className="code-display-value">{code}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(code)}>{t('room_copy')}</button>
                </div>
                <div className="pulse-row">
                  <div className="pulse-dot" /><div className="pulse-dot" /><div className="pulse-dot" />
                </div>
              </>
            )}
            {room && (
              <div className="waiting-meta">
                <div className="waiting-meta-item">
                  <div className="waiting-meta-val" style={{ color: 'var(--accent)' }}>{room.bet}€</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('room_bet')}</div>
                </div>
              </div>
            )}
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 24, color: 'var(--neg)' }}
              onClick={handleLeave}
            >
              {t('room_leave')}
            </button>
          </div>
        </div>

        <div className="chat">
          <div className="chat-head">
            <span className="chat-head-title">{t('room_chat')}</span>
            <span className="chat-status" />
          </div>
          <div className="chat-messages" style={{ flex: 1, minHeight: 0 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 12.5, padding: '20px 0' }}>{t('room_no_messages')}</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg${m.system ? ' sys' : m.username === user.username ? ' own' : ''}`}>
                {!m.system && (
                  <div className="chat-msg-meta">
                    <span className="chat-msg-user">{m.username}</span>
                    <span className="chat-msg-time">{new Date(m.timestamp || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}
                <div className="chat-msg-bubble">{m.message}</div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={sendChat} className="chat-input-row">
            <input className="chat-input" value={chatText} onChange={e => setChatText(e.target.value)} placeholder={t('room_msg_ph')} maxLength={200} />
            <button type="submit" className="chat-send" disabled={!chatText.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </form>
        </div>
      </div>
    </div></div>
  );
}
