'use strict';

const { pool }                        = require('../database');
const { generateQuestion }            = require('../duelmath/mathGenerator');
const { createBot, computeBotAnswer } = require('../bot/botEngine');
const { onMatchComplete }             = require('./tournamentManager');

const QUESTIONS_PER_MATCH = 7;
const QUESTION_TIME       = 10000; // ms
const ANSWER_COOLDOWN     = 300;

// In-memory match states: matchId → state
const matchStates = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBot(userId) { return Number(userId) < 0; }

function makePlayer(id, username) {
  return { id, username, score: 0, streak: 0, correct: 0, wrong: 0, answeredRound: false, lastAnswerMs: 0 };
}

function buildScores(state) {
  return Object.values(state.players).map(p => ({
    id: p.id, username: p.username, score: p.score, streak: p.streak,
  }));
}

function calcPoints(elapsedMs) {
  return Math.max(50, Math.round(150 - (elapsedMs / 1000) * 14));
}

// ── Bot answer scheduling ─────────────────────────────────────────────────────

function scheduleBotMatchAnswer(io, matchId, question, round, botId, botProfile) {
  const { answerIndex, delay } = computeBotAnswer(
    { options: question.options, answer: question.correctIndex },
    { profile: botProfile }
  );

  setTimeout(() => {
    const s = matchStates.get(matchId);
    if (!s || s.status !== 'playing' || s.round !== round) return;
    const bot = s.players[botId];
    if (!bot || bot.answeredRound || answerIndex === null) return;

    bot.answeredRound = true;
    const elapsed = Date.now() - s.question.sentAt;
    const correct  = answerIndex === s.question.correctIndex;
    const points   = correct ? calcPoints(elapsed) : 0;
    if (correct) { bot.score += points; bot.streak += 1; bot.correct += 1; }
    else         { bot.streak = 0; bot.wrong += 1; }

    io.to(`tm_${matchId}`).emit('tm:scores_update', { scores: buildScores(s) });
    if (Object.values(s.players).every(p => p.answeredRound)) advanceMatchRound(io, matchId);
  }, delay);
}

// ── Round flow ────────────────────────────────────────────────────────────────

function startMatchRound(io, matchId) {
  const s = matchStates.get(matchId);
  if (!s || s.status !== 'playing') return;

  const q = generateQuestion(s.round);
  s.question = { ...q, sentAt: Date.now() };
  for (const p of Object.values(s.players)) p.answeredRound = false;

  io.to(`tm_${matchId}`).emit('tm:question', {
    round: s.round, totalRounds: QUESTIONS_PER_MATCH,
    expression: q.expression, options: q.options, timeMs: QUESTION_TIME,
  });

  s.timer = setTimeout(() => advanceMatchRound(io, matchId), QUESTION_TIME);

  // Schedule bot answers
  for (const [pId, player] of Object.entries(s.players)) {
    if (isBot(Number(pId)) && s.botProfiles[pId]) {
      scheduleBotMatchAnswer(io, matchId, q, s.round, Number(pId), s.botProfiles[pId]);
    }
  }
}

function advanceMatchRound(io, matchId) {
  const s = matchStates.get(matchId);
  if (!s || s.status !== 'playing') return;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }

  io.to(`tm_${matchId}`).emit('tm:round_end', {
    correctIndex: s.question.correctIndex,
    scores: buildScores(s),
  });

  if (s.round >= QUESTIONS_PER_MATCH) {
    setTimeout(() => endMatch(io, matchId), 2000);
  } else {
    s.round++;
    setTimeout(() => startMatchRound(io, matchId), 2000);
  }
}

// ── End match ─────────────────────────────────────────────────────────────────

async function endMatch(io, matchId, forfeitUserId = null) {
  const s = matchStates.get(matchId);
  if (!s || s.status === 'finished') return;
  s.status = 'finished';
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }

  const players = Object.values(s.players);
  if (players.length < 2) { matchStates.delete(matchId); return; }
  const [p1, p2] = players;

  let winnerId, winnerUsername;
  if (forfeitUserId !== null) {
    const winner = p1.id === Number(forfeitUserId) ? p2 : p1;
    winnerId = winner.id; winnerUsername = winner.username;
  } else if (p1.score > p2.score) {
    winnerId = p1.id; winnerUsername = p1.username;
  } else if (p2.score > p1.score) {
    winnerId = p2.id; winnerUsername = p2.username;
  } else if (p1.correct > p2.correct) {
    winnerId = p1.id; winnerUsername = p1.username;
  } else {
    const w = Math.random() < 0.5 ? p1 : p2;
    winnerId = w.id; winnerUsername = w.username;
  }

  try {
    await pool.execute(
      "UPDATE tournament_matches SET status='finished', winner_id=?, p1_score=?, p2_score=? WHERE id=?",
      [winnerId, p1.score, p2.score, matchId]
    );

    io.to(`tm_${matchId}`).emit('tm:match_over', {
      winnerId, winnerUsername, scores: buildScores(s), forfeited: forfeitUserId !== null,
    });

    await onMatchComplete(io, s.tournamentId, s.bracketRound, s.matchNum, winnerId, winnerUsername);
  } catch (err) {
    console.error('[TournamentSocket] endMatch error:', err.message);
  }

  matchStates.delete(matchId);
}

// ── Socket setup ──────────────────────────────────────────────────────────────

function setupTournamentSocket(io, socket) {
  const userId   = socket.user.id;
  const username = socket.user.username;

  // Join tournament broadcast room + send current state
  socket.on('t:join', async ({ tournamentId }) => {
    try {
      socket.join(`t_${tournamentId}`);
      socket.activeTournamentId = tournamentId;

      const [[t]]    = await pool.execute('SELECT * FROM tournaments WHERE id=?', [tournamentId]);
      const [players] = await pool.execute('SELECT * FROM tournament_players WHERE tournament_id=? ORDER BY seed', [tournamentId]);
      const [matches] = await pool.execute('SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round, match_num', [tournamentId]);

      socket.emit('t:state', { tournament: t, players, matches });

      // If tournament is active and player has a pending/playing match, re-notify
      if (t && t.status === 'playing') {
        const myMatch = matches.find(m =>
          (m.player1_id === userId || m.player2_id === userId) &&
          m.round === t.current_round &&
          m.status !== 'finished'
        );
        if (myMatch) socket.emit('t:match_ready', { match: myMatch, round: t.current_round });
      }
    } catch (err) {
      console.error('[TournamentSocket] t:join error:', err.message);
    }
  });

  // Join match room — start when both players connected
  socket.on('tm:join_match', async ({ tournamentId, matchId }) => {
    try {
      const [[match]] = await pool.execute('SELECT * FROM tournament_matches WHERE id=?', [matchId]);
      if (!match) return socket.emit('tm:error', { message: 'Match not found.' });
      if (match.player1_id !== userId && match.player2_id !== userId)
        return socket.emit('tm:error', { message: 'Not your match.' });
      if (match.status === 'finished') return socket.emit('tm:error', { message: 'Match already finished.' });

      socket.join(`tm_${matchId}`);
      socket.activeMatchId = matchId;

      // Initialise state if not present
      if (!matchStates.has(matchId)) {
        const botProfiles = {};
        for (const pid of [match.player1_id, match.player2_id]) {
          if (isBot(pid)) {
            const [[tp]] = await pool.execute(
              'SELECT bot_difficulty FROM tournament_players WHERE tournament_id=? AND user_id=?',
              [tournamentId, pid]
            ).catch(() => [[null]]);
            if (tp) botProfiles[pid] = createBot(tp.bot_difficulty || 'medio').profile;
          }
        }
        matchStates.set(matchId, {
          matchId, tournamentId: match.tournament_id,
          bracketRound: match.round, matchNum: match.match_num,
          round: 1, question: null, players: {}, timer: null,
          status: 'waiting', botProfiles, connected: new Set(),
        });
      }

      const s = matchStates.get(matchId);
      s.players[userId] = makePlayer(userId, username);
      s.connected.add(userId);

      // Pre-populate bot players
      for (const [pid, pun] of [[match.player1_id, match.player1_username], [match.player2_id, match.player2_username]]) {
        if (isBot(pid) && !s.players[pid]) s.players[pid] = makePlayer(pid, pun);
      }

      socket.emit('tm:joined', {
        matchId,
        opponentUsername: match.player1_id === userId ? match.player2_username : match.player1_username,
      });

      // Count how many human players need to connect
      const humanIds    = [match.player1_id, match.player2_id].filter(id => !isBot(id));
      const connReady   = humanIds.every(id => s.connected.has(id));

      if (connReady && s.status === 'waiting') {
        s.status = 'playing';
        await pool.execute("UPDATE tournament_matches SET status='playing' WHERE id=?", [matchId]);
        io.to(`tm_${matchId}`).emit('tm:start', {
          players: buildScores(s), totalRounds: QUESTIONS_PER_MATCH,
        });
        setTimeout(() => startMatchRound(io, matchId), 1500);
      }
    } catch (err) {
      console.error('[TournamentSocket] tm:join_match error:', err.message);
      socket.emit('tm:error', { message: 'Server error.' });
    }
  });

  // Answer
  socket.on('tm:answer', ({ matchId, answerIndex }) => {
    const s = matchStates.get(matchId);
    if (!s || s.status !== 'playing') return;
    const player = s.players[userId];
    if (!player) return;

    const now = Date.now();
    if (now - player.lastAnswerMs < ANSWER_COOLDOWN || player.answeredRound) return;
    player.lastAnswerMs = now;
    player.answeredRound = true;

    const { question } = s;
    if (!question) return;

    const correct = answerIndex === question.correctIndex;
    const elapsed = now - question.sentAt;
    const points  = correct ? calcPoints(elapsed) : 0;
    if (correct) { player.score += points; player.streak += 1; player.correct += 1; }
    else         { player.streak = 0; player.wrong += 1; }

    socket.emit('tm:answer_result', {
      correct, points, answerIndex, correctIndex: question.correctIndex, score: player.score,
    });
    io.to(`tm_${matchId}`).emit('tm:scores_update', { scores: buildScores(s) });
    if (Object.values(s.players).every(p => p.answeredRound)) advanceMatchRound(io, matchId);
  });

  socket.on('disconnect', () => {
    const matchId = socket.activeMatchId;
    if (!matchId) return;
    const s = matchStates.get(matchId);
    if (s && s.status === 'playing' && s.players[userId]) {
      endMatch(io, matchId, userId);
    }
  });
}

module.exports = { setupTournamentSocket };
