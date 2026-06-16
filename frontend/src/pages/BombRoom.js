import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useLanguage } from '../context/LanguageContext';
import AvatarIcon from '../components/AvatarIcon';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || undefined;

export default function BombRoom({ user, onGameEnd }) {
  const { code }   = useParams();
  const navigate   = useNavigate();
  const { lang }   = useLanguage();

  const [phase,       setPhase]       = useState('connecting');
  const [players,     setPlayers]     = useState([]);
  const [hostId,      setHostId]      = useState(null);
  const [isBot,       setIsBot]       = useState(false);
  const [bet,         setBet]         = useState(0);
  const [countdown,   setCountdown]   = useState(3);
  const [questionObj, setQuestionObj] = useState(null);
  const [options,     setOptions]     = useState([]);
  const [activeId,    setActiveId]    = useState(null);
  const [timeMs,      setTimeMs]      = useState(12000);
  const [timeLeft,    setTimeLeft]    = useState(12);
  const [round,       setRound]       = useState(0);
  const [answered,    setAnswered]    = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [correctIdx,  setCorrectIdx]  = useState(null);
  const [boomPlayer,  setBoomPlayer]  = useState(null);
  const [gameResult,  setGameResult]  = useState(null);

  const socketRef = useRef(null);
  const timerRef  = useRef(null);
  const onEndRef  = useRef(onGameEnd);
  useEffect(() => { onEndRef.current = onGameEnd; }, [onGameEnd]);

  const getTranslated = useCallback((obj, field) => {
    if (!obj) return '';
    if (lang === 'pt' && obj.pt?.[field]) return obj.pt[field];
    if (lang === 'es' && obj.es?.[field]) return obj.es[field];
    return obj[field] || '';
  }, [lang]);

  const startTimer = useCallback((ms) => {
    clearInterval(timerRef.current);
    const end = Date.now() + ms;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      setTimeLeft(Math.ceil(left / 1000));
      if (left <= 0) clearInterval(timerRef.current);
    }, 100);
  }, []);

  const myId = user?.id;

  useEffect(() => {
    const token  = localStorage.getItem('token');
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('bomb:join', { roomCode: code }));

    socket.on('bomb:room_state', ({ bet: b, hostId: h, players: pl, isBot: ib }) => {
      setBet(b); setHostId(h); setPlayers(pl); setIsBot(ib);
      setPhase('waiting');
    });

    socket.on('bomb:player_joined', ({ players: pl }) => setPlayers(pl));
    socket.on('bomb:player_left',   ({ players: pl }) => setPlayers(pl));

    socket.on('bomb:countdown', ({ count }) => {
      setPhase('countdown');
      setCountdown(count);
    });

    socket.on('bomb:question', ({ question, options: opts, pt, es, activeId: aid, timeMs: ms, round: r, players: pl }) => {
      clearInterval(timerRef.current);
      const obj = { question, options: opts, pt, es };
      setQuestionObj(obj);
      setOptions(lang === 'pt' && pt?.o ? pt.o : lang === 'es' && es?.o ? es.o : opts);
      setActiveId(aid);
      setTimeMs(ms);
      setAnswered(false);
      setSelectedIdx(null);
      setCorrectIdx(null);
      setBoomPlayer(null);
      setRound(r);
      setPlayers(pl);
      setPhase('playing');
      startTimer(ms);
    });

    socket.on('bomb:pass', ({ activeId: aid, timeMs: ms, correctIndex: ci }) => {
      setCorrectIdx(ci);
      setActiveId(aid);
      setTimeMs(ms);
      clearInterval(timerRef.current);
    });

    socket.on('bomb:answer_wrong', ({ correctIndex: ci }) => {
      setCorrectIdx(ci);
      clearInterval(timerRef.current);
    });

    socket.on('bomb:boom', ({ eliminatedId, eliminatedName, players: pl }) => {
      setPlayers(pl);
      setBoomPlayer({ id: eliminatedId, name: eliminatedName });
      setPhase('boom_anim');
      clearInterval(timerRef.current);
    });

    socket.on('bomb:game_over', (data) => {
      clearInterval(timerRef.current);
      setGameResult(data);
      setPlayers(data.players || []);
      setPhase('game_over');
      if (onEndRef.current) onEndRef.current();
    });

    socket.on('bomb:error', ({ message }) => {
      alert(message);
      navigate('/bomb');
    });

    socket.on('connect_error', () => setPhase('waiting'));

    return () => {
      clearInterval(timerRef.current);
      socket.emit('bomb:leave', { roomCode: code });
      socket.disconnect();
    };
  // eslint-disable-next-line
  }, [code]);

  // Re-translate options on lang change
  useEffect(() => {
    if (!questionObj) return;
    const { options: opts, pt, es } = questionObj;
    setOptions(lang === 'pt' && pt?.o ? pt.o : lang === 'es' && es?.o ? es.o : opts || []);
  }, [lang, questionObj]);

  const submitAnswer = (idx) => {
    if (answered || activeId !== myId || phase !== 'playing') return;
    setAnswered(true);
    setSelectedIdx(idx);
    socketRef.current?.emit('bomb:answer', { roomCode: code, answerIndex: idx });
  };

  const timerPct   = timeMs > 0 ? (timeLeft / (timeMs / 1000)) * 100 : 0;
  const isMyTurn   = activeId === myId && phase === 'playing';
  const activeName = players.find(p => p.id === activeId)?.username || '...';
  const questionText = questionObj
    ? (lang === 'pt' && questionObj.pt?.q ? questionObj.pt.q : lang === 'es' && questionObj.es?.q ? questionObj.es.q : questionObj.question)
    : '';

  // ── CONNECTING ─────────────────────────────────────────────────────────────
  if (phase === 'connecting') {
    return (
      <div className="page dm-page">
        <div className="dm-waiting-box">
          <h2 className="dm-waiting-title">Modo Bomba</h2>
          <p className="dm-waiting-sub">A ligar...</p>
          <div className="spinner" style={{ margin: '16px auto 0' }} />
        </div>
      </div>
    );
  }

  // ── WAITING ────────────────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className="page dm-page">
        <div className="bomb-lobby">
          <div className="bomb-lobby-header">
            <h2 className="dm-waiting-title">Modo Bomba</h2>
            <div className="dm-room-code-display">
              <span className="dm-code-label">Código</span>
              <span className="dm-code-val">{code}</span>
            </div>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '4px 0 0' }}>
              Aposta: <strong style={{ color: 'var(--gold)' }}>{bet}€</strong> por jogador
            </p>
          </div>

          <div className="bomb-players-grid">
            {players.map(p => (
              <div key={p.id} className="bomb-player-slot">
                <AvatarIcon icon={p.avatar_icon ?? 0} size={48} />
                <span className="bomb-player-slot-name">{p.username}</span>
                {p.id === hostId && <span className="bomb-host-badge">Host</span>}
                {p.isBot && <span className="bomb-bot-badge">Bot</span>}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 6 - players.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="bomb-player-slot bomb-player-empty">
                <div className="bomb-empty-avatar" />
                <span className="bomb-player-slot-name" style={{ color: 'var(--text-4)' }}>Livre</span>
              </div>
            ))}
          </div>

          {hostId === myId && !isBot ? (
            <button
              className="btn btn-primary"
              style={{ minWidth: 180 }}
              onClick={() => socketRef.current?.emit('bomb:start', { roomCode: code })}
              disabled={players.length < 2}
            >
              {players.length < 2 ? 'Aguarda jogadores...' : `Iniciar com ${players.length} jogadores`}
            </button>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: 14 }}>
              {isBot ? 'A iniciar automaticamente...' : 'Aguarda que o anfitrião inicie...'}
            </p>
          )}

          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => navigate('/bomb')}>
            Sair
          </button>
        </div>
      </div>
    );
  }

  // ── COUNTDOWN ──────────────────────────────────────────────────────────────
  if (phase === 'countdown') {
    return (
      <div className="page dm-page">
        <div className="dm-countdown-box">
          <div className="dm-countdown-label">Prepara-te!</div>
          <div className={`dm-countdown-num${countdown <= 1 ? ' dm-countdown-go' : ''}`}>
            {countdown > 0 ? countdown : 'GO!'}
          </div>
          <div className="dm-countdown-sub">
            Pote: <strong>{(parseFloat(bet) * players.length).toFixed(0)}€</strong>
          </div>
        </div>
      </div>
    );
  }

  // ── BOOM ───────────────────────────────────────────────────────────────────
  if (phase === 'boom_anim') {
    return (
      <div className="page dm-page">
        <div className="bomb-boom-screen">
          <div className="bomb-boom-icon" />
          <div className="bomb-boom-name">{boomPlayer?.name}</div>
          <div className="bomb-boom-label">ELIMINADO</div>
        </div>
      </div>
    );
  }

  // ── GAME OVER ───────────────────────────────────────────────────────────────
  if (phase === 'game_over') {
    const iWon = gameResult?.winnerId === myId;
    return (
      <div className="page dm-page">
        <div className="dm-result-box">
          <div className={`dm-result-icon ${iWon ? 'win' : 'lose'}`}>
            <div className={`dm-result-icon-shape ${iWon ? 'win' : 'lose'}`} />
          </div>
          <div className={`dm-result-label ${iWon ? 'win' : 'lose'}`}>
            {gameResult?.winnerId
              ? (iWon ? 'Ganhaste!' : `${gameResult.winnerName} ganhou!`)
              : 'Empate!'}
          </div>
          {gameResult?.prize > 0 && (
            <div className="dm-result-delta">{iWon ? `+${gameResult.prize.toFixed(2)}€` : `-${parseFloat(bet).toFixed(2)}€`}</div>
          )}

          <div style={{ width: '100%', marginTop: 20, marginBottom: 8 }}>
            {players.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', opacity: p.alive ? 1 : 0.4 }}>
                <AvatarIcon icon={p.avatar_icon ?? 0} size={32} />
                <span style={{ flex: 1, fontSize: 14, color: 'var(--text-1)' }}>{p.username}</span>
                <span style={{ fontSize: 13, color: p.alive ? 'var(--pos)' : 'var(--neg)', fontWeight: 600 }}>
                  {p.alive ? 'Vencedor' : 'Eliminado'}
                </span>
              </div>
            ))}
          </div>

          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => navigate('/bomb')}>Jogar novamente</button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>Início</button>
          </div>
        </div>
      </div>
    );
  }

  // ── PLAYING ─────────────────────────────────────────────────────────────────
  return (
    <div className="page dm-page">
      <div className="bomb-arena">

        {/* Jogadores */}
        <div className="bomb-players-row">
          {players.map(p => (
            <div
              key={p.id}
              className={`bomb-player-chip${p.id === activeId ? ' bomb-active' : ''}${!p.alive ? ' bomb-elim' : ''}`}
            >
              <div className="bomb-chip-avatar">
                <AvatarIcon icon={p.avatar_icon ?? 0} size={38} />
                {p.id === activeId && <div className="bomb-chip-indicator" />}
              </div>
              <span className="bomb-chip-name">{p.username}</span>
            </div>
          ))}
        </div>

        {/* Timer */}
        <div className="bomb-timer-wrap">
          <div className={`bomb-timer-bar-track${timeLeft <= 3 ? ' bomb-urgent' : ''}`}>
            <div className="bomb-timer-bar-fill" style={{ width: `${timerPct}%`, transition: 'width 0.1s linear' }} />
          </div>
          <span className={`bomb-timer-label${timeLeft <= 3 ? ' bomb-urgent-text' : ''}`}>{timeLeft}s</span>
        </div>

        {/* Turno */}
        <div className={`bomb-turn-banner${isMyTurn ? ' bomb-my-turn' : ''}`}>
          {isMyTurn ? 'E A TUA VEZ!' : `Vez de ${activeName}`}
        </div>

        {/* Pergunta */}
        <div className="dm-expression bomb-question">{questionText}</div>

        {/* Opções */}
        <div className="dm-options">
          {options.map((opt, i) => {
            let cls = 'dm-option';
            if (answered || correctIdx !== null) {
              if (i === correctIdx) cls += ' dm-option-correct';
              else if (i === selectedIdx && i !== correctIdx) cls += ' dm-option-wrong';
              else cls += ' dm-option-dim';
            }
            return (
              <button key={i} className={cls} onClick={() => submitAnswer(i)} disabled={answered || !isMyTurn}>
                {opt}
              </button>
            );
          })}
        </div>

        <div style={{ color: 'var(--text-4)', fontSize: 12, marginTop: 8 }}>
          Ronda {round} · Pote: {(parseFloat(bet) * players.length).toFixed(0)}€
        </div>

        <button className="btn btn-ghost btn-xs" style={{ marginTop: 16 }} onClick={() => navigate('/bomb')}>
          Sair
        </button>
      </div>
    </div>
  );
}
