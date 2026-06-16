import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useLanguage } from '../context/LanguageContext';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

function Bracket({ matches, players, myId, currentRound }) {
  const rounds = [...new Set(matches.map(m => m.round))].sort((a, b) => a - b);
  const totalRounds = Math.max(...rounds, 1);
  const labels = (r) => {
    if (r === totalRounds) return 'Final';
    if (r === totalRounds - 1) return 'Semi-Final';
    if (r === totalRounds - 2) return 'Quartos';
    return `Ronda ${r}`;
  };

  return (
    <div className="trn-bracket">
      {rounds.map(r => (
        <div key={r} className="trn-bracket-round">
          <div className="trn-bracket-round-label">{labels(r)}</div>
          {matches.filter(m => m.round === r).map(m => {
            const p1win = m.winner_id === m.player1_id && m.winner_id !== null;
            const p2win = m.winner_id === m.player2_id && m.winner_id !== null;
            return (
              <div key={m.id} className={`trn-match-card${m.round === currentRound ? ' trn-match-active' : ''}`}>
                <div className={`trn-match-player${p1win ? ' trn-match-winner' : p2win ? ' trn-match-loser' : ''}${m.player1_id === myId ? ' trn-match-me' : ''}`}>
                  <span>{m.player1_username || '?'}</span>
                  {m.status === 'finished' && <span className="trn-match-score">{m.p1_score}</span>}
                </div>
                <div className="trn-match-vs">vs</div>
                <div className={`trn-match-player${p2win ? ' trn-match-winner' : p1win ? ' trn-match-loser' : ''}${m.player2_id === myId ? ' trn-match-me' : ''}`}>
                  <span>{m.player2_username || '?'}</span>
                  {m.status === 'finished' && <span className="trn-match-score">{m.p2_score}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function TournamentRoom({ user, onGameEnd }) {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { t }     = useLanguage();

  // Tournament state
  const [tournament, setTournament] = useState(null);
  const [players, setPlayers]       = useState([]);
  const [matches, setMatches]       = useState([]);

  // Phase: lobby | starting | match_ready | in_match | between_rounds | eliminated | champion
  const [phase, setPhase]         = useState('lobby');
  const [countdown, setCountdown] = useState(5);
  const [myMatch, setMyMatch]     = useState(null);

  // In-match state (mirrors DuelMathRoom)
  const [matchPhase, setMatchPhase]   = useState('connecting'); // connecting|playing|round_end
  const [round, setRound]             = useState(1);
  const [totalRounds, setTotalRounds] = useState(7);
  const [expression, setExpression]   = useState('');
  const [options, setOptions]         = useState([]);
  const [timeLeft, setTimeLeft]       = useState(10);
  const [timeMs, setTimeMs]           = useState(10000);
  const [scores, setScores]           = useState([]);
  const [answered, setAnswered]       = useState(false);
  const [feedback, setFeedback]       = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [correctIdx, setCorrectIdx]   = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [finalResult, setFinalResult] = useState(null);

  const socketRef  = useRef(null);
  const timerRef   = useRef(null);
  const onEndRef   = useRef(onGameEnd);
  useEffect(() => { onEndRef.current = onGameEnd; }, [onGameEnd]);

  const startTimer = useCallback((ms) => {
    clearInterval(timerRef.current);
    const end = Date.now() + ms;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      setTimeLeft(Math.ceil(left / 1000));
      if (left <= 0) clearInterval(timerRef.current);
    }, 100);
  }, []);

  useEffect(() => {
    const token  = localStorage.getItem('token');
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('t:join', { tournamentId: parseInt(id) });
    });

    // ── Tournament events ──────────────────────────────────────────────────
    socket.on('t:state', ({ tournament: t, players: p, matches: m }) => {
      setTournament(t);
      setPlayers(p || []);
      setMatches(m || []);
      if (t.status === 'waiting') setPhase('lobby');
      else if (t.status === 'finished') setPhase('champion'); // handled by t:tournament_over
    });

    socket.on('t:player_joined', ({ username, count, size }) => {
      setPlayers(prev => {
        if (prev.find(p => p.username === username)) return prev;
        return [...prev, { username }];
      });
    });

    socket.on('t:starting', ({ countdown: c }) => {
      setPhase('starting');
      let n = c;
      setCountdown(n);
      const iv = setInterval(() => {
        n--;
        setCountdown(n);
        if (n <= 0) clearInterval(iv);
      }, 1000);
    });

    socket.on('t:round_start', ({ round: r, matches: m, players: p }) => {
      setMatches(m || []);
      if (p) setPlayers(p);
      const uid = user?.id;
      const mine = (m || []).find(mt =>
        (mt.player1_id === uid || mt.player2_id === uid) && mt.status !== 'finished'
      );
      if (mine) {
        setMyMatch(mine);
        setPhase('match_ready');
        // Auto-join after brief delay
        setTimeout(() => {
          socket.emit('tm:join_match', { tournamentId: parseInt(id), matchId: mine.id });
        }, 1500);
      } else {
        setPhase('between_rounds');
      }
    });

    socket.on('t:bracket_update', ({ matches: m, players: p }) => {
      setMatches(m || []);
      if (p) setPlayers(p);
    });

    socket.on('t:tournament_over', (data) => {
      setFinalResult(data);
      setPhase(data.winnerId === user?.id ? 'champion' : 'eliminated');
      if (onEndRef.current) onEndRef.current();
    });

    // ── Match events ───────────────────────────────────────────────────────
    socket.on('tm:joined', () => {
      setMatchPhase('connecting');
    });

    socket.on('tm:start', ({ players: p }) => {
      setScores(p);
      setMatchPhase('playing');
      setPhase('in_match');
    });

    socket.on('tm:question', ({ round: r, totalRounds: tr, expression: ex, options: opts, timeMs: ms }) => {
      clearInterval(timerRef.current);
      setRound(r); setTotalRounds(tr); setExpression(ex); setOptions(opts); setTimeMs(ms);
      setAnswered(false); setFeedback(null); setSelectedIdx(null); setCorrectIdx(null);
      setMatchPhase('playing');
      startTimer(ms);
    });

    socket.on('tm:answer_result', ({ correct, correctIndex: ci }) => {
      clearInterval(timerRef.current);
      setFeedback(correct ? 'correct' : 'wrong');
      setCorrectIdx(ci);
      setTimeout(() => setFeedback(null), 800);
    });

    socket.on('tm:scores_update', ({ scores: s }) => setScores(s));

    socket.on('tm:round_end', ({ correctIndex: ci, scores: s }) => {
      clearInterval(timerRef.current);
      setCorrectIdx(ci); setScores(s); setMatchPhase('round_end');
    });

    socket.on('tm:match_over', (data) => {
      clearInterval(timerRef.current);
      setMatchResult(data);
      setPhase('between_rounds');
      setMyMatch(null);
    });

    socket.on('tm:error', ({ message }) => alert(message));

    return () => {
      clearInterval(timerRef.current);
      socket.disconnect();
    };
  }, [id, startTimer, user?.id]);

  const submitAnswer = useCallback((idx) => {
    if (answered || matchPhase !== 'playing' || !myMatch) return;
    setAnswered(true); setSelectedIdx(idx);
    socketRef.current?.emit('tm:answer', { matchId: myMatch.id, answerIndex: idx });
  }, [answered, matchPhase, myMatch]);

  const myId    = user?.id;
  const me      = scores.find(s => s.id === myId);
  const opp     = scores.find(s => s.id !== myId);
  const timerPct = timeMs > 0 ? (timeLeft / (timeMs / 1000)) * 100 : 0;
  const curRound = tournament?.current_round ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────

  // Lobby: waiting for players
  if (phase === 'lobby') {
    const prize = tournament ? (parseFloat(tournament.entry_fee) * tournament.size * 0.9).toFixed(0) : '—';
    return (
      <div className="page dm-page">
        <div className="trn-lobby">
          <div className="trn-lobby-header">
            <div className="trn-lobby-eyebrow">Tournament</div>
            <h2 className="trn-lobby-title">{t('trn_lobby_title')}</h2>
            <div className="trn-lobby-prize">{t('trn_prize_pool')}: <strong>{prize}€</strong></div>
          </div>

          <div className="trn-player-grid">
            {Array.from({ length: tournament?.size ?? 8 }, (_, i) => {
              const p = players[i];
              return (
                <div key={i} className={`trn-player-slot${p ? ' filled' : ''}`}>
                  {p ? (
                    <>
                      <div className="trn-player-avatar">{p.username[0].toUpperCase()}</div>
                      <div className="trn-player-name">{p.username}</div>
                    </>
                  ) : (
                    <div className="trn-player-empty">{t('trn_waiting_player')}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="trn-lobby-sub">
            {players.length}/{tournament?.size ?? 8} {t('trn_players_unit')} — {t('trn_auto_fill')}
          </div>
          <div className="spinner" style={{ margin: '16px auto 0' }} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 20 }} onClick={() => navigate('/tournament')}>
            {t('room_leave')}
          </button>
        </div>
      </div>
    );
  }

  // Starting countdown
  if (phase === 'starting') {
    return (
      <div className="page dm-page">
        <div className="dm-countdown-box">
          <div className="dm-countdown-label">{t('trn_starting')}</div>
          <div className={`dm-countdown-num${countdown <= 1 ? ' dm-countdown-go' : ''}`}>
            {countdown > 0 ? countdown : 'GO!'}
          </div>
          <div className="dm-countdown-sub">{t('trn_gl')}</div>
        </div>
      </div>
    );
  }

  // Match ready (auto-joining)
  if (phase === 'match_ready') {
    const oName = myMatch ? (myMatch.player1_id === myId ? myMatch.player2_username : myMatch.player1_username) : '...';
    return (
      <div className="page dm-page">
        <div className="dm-waiting-box">
          <div className="dm-waiting-icon" />
          <h2 className="dm-waiting-title">{t('trn_match_ready')}</h2>
          <p className="dm-waiting-sub">vs <strong>{oName}</strong></p>
          <div className="spinner" style={{ margin: '16px auto 0' }} />
        </div>
      </div>
    );
  }

  // In match
  if (phase === 'in_match') {
    return (
      <div className="page dm-page">
        <div className="dm-arena">
          <div className="dm-scoreboard">
            <div className={`dm-player-card${me && opp && me.score > opp.score ? ' dm-player-leading' : ''}`}>
              <div className="dm-player-name">{me?.username ?? t('quiz_you')}</div>
              <div className="dm-player-score">{me?.score ?? 0}</div>
            </div>
            <div className="dm-vs-badge">VS</div>
            <div className={`dm-player-card dm-player-card-right${opp && me && opp.score > me.score ? ' dm-player-leading' : ''}`}>
              <div className="dm-player-name">{opp?.username ?? t('room_opponent')}</div>
              <div className="dm-player-score">{opp?.score ?? 0}</div>
            </div>
          </div>

          <div className="dm-progress-wrap">
            <div className="dm-progress-bar" style={{ width: `${((round - 1) / totalRounds) * 100}%` }} />
            <span className="dm-progress-label">{t('dm_round')} {round}/{totalRounds}</span>
          </div>

          <div className="dm-timer-track">
            <div
              className={`dm-timer-bar${timeLeft <= 3 ? ' dm-timer-urgent' : ''}`}
              style={{ width: `${timerPct}%`, transition: 'width 0.1s linear' }}
            />
          </div>
          <div className="dm-timer-label">{timeLeft}s</div>

          <div className={`dm-expression${feedback === 'correct' ? ' dm-flash-correct' : feedback === 'wrong' ? ' dm-flash-wrong' : ''}`}>
            {matchPhase === 'round_end' && !expression ? '...' : expression}
          </div>

          <div className="dm-options">
            {options.map((opt, i) => {
              let cls = 'dm-option';
              if (answered || matchPhase === 'round_end') {
                if (i === correctIdx) cls += ' dm-option-correct';
                else if (i === selectedIdx && i !== correctIdx) cls += ' dm-option-wrong';
                else cls += ' dm-option-dim';
              }
              return (
                <button key={i} className={cls} onClick={() => submitAnswer(i)} disabled={answered || matchPhase === 'round_end'}>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Between rounds / waiting for others
  if (phase === 'between_rounds') {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="trn-between-header">
            {matchResult ? (
              <div className={`trn-between-result ${matchResult.winnerId === myId ? 'win' : 'lose'}`}>
                {matchResult.winnerId === myId ? t('trn_match_won') : t('trn_match_lost')}
              </div>
            ) : (
              <div className="trn-between-result">{t('trn_waiting_others')}</div>
            )}
            <div className="trn-between-sub">{t('trn_next_round_soon')}</div>
            <div className="spinner" style={{ margin: '12px auto' }} />
          </div>
          <Bracket matches={matches} players={players} myId={myId} currentRound={curRound} />
        </div>
      </div>
    );
  }

  // Eliminated
  if (phase === 'eliminated') {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="dm-result-box" style={{ marginBottom: 32 }}>
            <div className="dm-result-icon lose"><div className="dm-result-icon-shape lose" /></div>
            <div className="dm-result-label lose">{t('trn_eliminated')}</div>
            {finalResult && (
              <div className="dm-result-delta" style={{ color: 'var(--text-2)', fontSize: 15 }}>
                {t('trn_winner_was')}: <strong>{finalResult.winnerUsername}</strong>
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => navigate('/tournament')}>{t('trn_play_again')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>{t('result_home')}</button>
            </div>
          </div>
          <Bracket matches={matches} players={players} myId={myId} currentRound={curRound} />
        </div>
      </div>
    );
  }

  // Champion
  if (phase === 'champion') {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="dm-result-box trn-champion-box" style={{ marginBottom: 32 }}>
            <div className="trn-trophy" />
            <div className="dm-result-label win" style={{ fontSize: 28 }}>{t('trn_champion')}</div>
            {finalResult && (
              <div className="dm-result-delta" style={{ color: 'var(--gold)', fontSize: 22 }}>
                +{finalResult.prize?.toFixed(2)}€
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-primary" onClick={() => navigate('/tournament')}>{t('trn_play_again')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>{t('result_home')}</button>
            </div>
          </div>
          <Bracket matches={matches} players={players} myId={myId} currentRound={curRound} />
        </div>
      </div>
    );
  }

  return null;
}
