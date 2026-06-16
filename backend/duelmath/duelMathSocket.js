'use strict';

const { pool }                            = require('../database');
const { generateQuestion }                = require('./mathGenerator');
const { createBot, computeBotAnswer }     = require('../bot/botEngine');

const TOTAL_ROUNDS    = 10;
const QUESTION_TIME   = 12000; // ms per question
const ANSWER_COOLDOWN = 300;   // ms anti-spam
const BOT_PLAYER_ID   = 0;

// In-memory game states: roomCode → gameState
const games = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayer(id, username, socketId, avatar_icon = 0) {
  return { id, username, socketId, avatar_icon, score: 0, streak: 0, correct: 0, wrong: 0, answeredRound: false, lastAnswerMs: 0 };
}

function getPlayerIds(game) {
  return Object.keys(game.players).map(Number);
}

function getOpponentId(game, userId) {
  return getPlayerIds(game).find(id => id !== Number(userId));
}

function calcPoints(elapsedMs) {
  const secs = elapsedMs / 1000;
  return Math.max(50, Math.round(150 - secs * 10));
}

function buildScores(game) {
  return Object.values(game.players).map(p => ({
    id: p.id, username: p.username, avatar_icon: p.avatar_icon ?? 0, score: p.score, streak: p.streak, correct: p.correct,
  }));
}

// ── Bot answer scheduling ──────────────────────────────────────────────────────

function scheduleBotDMAnswer(io, roomCode, question, round) {
  const game = games.get(roomCode);
  if (!game || !game.botProfile) return;

  // computeBotAnswer expects { options, answer } where answer = correct option index
  const { answerIndex, delay } = computeBotAnswer(
    { options: question.options, answer: question.correctIndex },
    { profile: game.botProfile }
  );

  setTimeout(() => {
    const g = games.get(roomCode);
    // Guard: game still active, still on the same round
    if (!g || g.status !== 'playing' || g.round !== round) return;

    const bot = g.players[BOT_PLAYER_ID];
    if (!bot || bot.answeredRound) return;
    if (answerIndex === null) return; // bot skips this round

    bot.answeredRound = true;
    const elapsed = Date.now() - g.question.sentAt;
    const correct  = answerIndex === g.question.correctIndex;
    const points   = correct ? calcPoints(elapsed) : 0;

    if (correct) {
      bot.score  += points;
      bot.streak += 1;
      bot.correct += 1;
    } else {
      bot.streak = 0;
      bot.wrong  += 1;
    }

    io.to(roomCode).emit('dm:scores_update', { scores: buildScores(g) });

    const allAnswered = Object.values(g.players).every(p => p.answeredRound);
    if (allAnswered) advanceRound(io, roomCode);
  }, delay);
}

// ── Round management ──────────────────────────────────────────────────────────

function startRound(io, roomCode) {
  const game = games.get(roomCode);
  if (!game || game.status !== 'playing') return;

  const q = generateQuestion(game.round);
  game.question = { ...q, sentAt: Date.now() };

  for (const p of Object.values(game.players)) p.answeredRound = false;

  // Send question WITHOUT correctIndex (anti-cheat)
  io.to(roomCode).emit('dm:question', {
    round:       game.round,
    totalRounds: TOTAL_ROUNDS,
    expression:  q.expression,
    options:     q.options,
    timeMs:      QUESTION_TIME,
  });

  game.timer = setTimeout(() => advanceRound(io, roomCode), QUESTION_TIME);

  // Schedule bot answer if this is a bot game
  if (game.isBot && game.botProfile) {
    scheduleBotDMAnswer(io, roomCode, q, game.round);
  }
}

function advanceRound(io, roomCode) {
  const game = games.get(roomCode);
  if (!game || game.status !== 'playing') return;
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }

  io.to(roomCode).emit('dm:round_end', {
    correctIndex:  game.question.correctIndex,
    correctAnswer: String(game.question.answer),
    scores:        buildScores(game),
  });

  if (game.round >= TOTAL_ROUNDS) {
    setTimeout(() => endGame(io, roomCode), 2200);
  } else {
    game.round++;
    setTimeout(() => startRound(io, roomCode), 2200);
  }
}

// ── End game ──────────────────────────────────────────────────────────────────

async function endGame(io, roomCode, forfeitId = null) {
  const game = games.get(roomCode);
  if (!game || game.status === 'finished') return;
  game.status = 'finished';
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }

  const [p1, p2] = Object.values(game.players);
  if (!p1 || !p2) { games.delete(roomCode); return; }

  let winnerId = null;
  if (forfeitId !== null) {
    winnerId = p1.id === Number(forfeitId) ? p2.id : p1.id;
  } else if (p1.score > p2.score) {
    winnerId = p1.id;
  } else if (p2.score > p1.score) {
    winnerId = p2.id;
  }
  // draw → winnerId stays null

  const bet = parseFloat(game.bet);

  try {
    // Update balances — skip rows where id = BOT_PLAYER_ID (no real user)
    if (winnerId !== null) {
      const loserId = p1.id === Number(winnerId) ? p2.id : p1.id;
      if (loserId !== BOT_PLAYER_ID) {
        await pool.execute(
          'UPDATE users SET balance = GREATEST(0, balance - ?) WHERE id = ?', [bet, loserId]
        );
      }
      if (winnerId !== BOT_PLAYER_ID) {
        await pool.execute(
          'UPDATE users SET balance = balance + ? WHERE id = ?', [bet, winnerId]
        );
      }
    }

    // Save history (player1_id may be 0 for bot — that is intentional)
    await pool.execute(
      `INSERT INTO duel_math_history
         (room_code,player1_id,player2_id,winner_id,bet,p1_score,p2_score,p1_correct,p2_correct,p1_wrong,p2_wrong)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [roomCode, p1.id, p2.id, winnerId, bet, p1.score, p2.score, p1.correct, p2.correct, p1.wrong, p2.wrong]
    );

    // Delete room — history is kept in duel_math_history
    await pool.execute(
      "DELETE FROM duel_math_rooms WHERE room_code=?",
      [roomCode]
    );

    // Fetch updated balances for human players only
    const humanIds = [p1.id, p2.id].filter(id => id !== BOT_PLAYER_ID);
    const balances = {};
    if (humanIds.length > 0) {
      const placeholders = humanIds.map(() => '?').join(',');
      const [rows] = await pool.execute(
        `SELECT id, balance FROM users WHERE id IN (${placeholders})`, humanIds
      );
      for (const r of rows) balances[r.id] = parseFloat(r.balance);
    }

    io.to(roomCode).emit('dm:game_over', {
      winnerId,
      draw: winnerId === null,
      scores: buildScores(game),
      bet,
      balances,
    });
  } catch (err) {
    console.error('[DuelMath] endGame error:', err.message);
  }

  games.delete(roomCode);
}

// ── Socket handlers ───────────────────────────────────────────────────────────

function setupDuelMathSocket(io, socket) {
  const userId   = socket.user.id;
  const username = socket.user.username;

  // ── dm:join ────────────────────────────────────────────────────────────────
  socket.on('dm:join', async ({ roomCode }) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const [[room]] = await pool.execute('SELECT * FROM duel_math_rooms WHERE room_code = ?', [code]);
      if (!room) return socket.emit('dm:error', { message: 'Room not found.' });
      if (room.status === 'finished') return socket.emit('dm:error', { message: 'Game already finished.' });

      const isP1 = Number(room.player1_id) === Number(userId);
      const isP2 = Number(room.player2_id) === Number(userId);
      if (!isP1 && !isP2) return socket.emit('dm:error', { message: 'You are not in this room.' });

      socket.join(code);
      socket.dmRoomCode = code;

      // Initialise game state if not already present
      if (!games.has(code)) {
        const gameState = {
          roomCode: code,
          bet:      parseFloat(room.bet),
          round:    1,
          question: null,
          players:  {},
          timer:    null,
          status:   'waiting',
          isBot:    false,
        };

        // Pre-populate bot player for bot rooms
        if (Number(room.player1_id) === BOT_PLAYER_ID) {
          const bot = createBot(room.difficulty || 'medio');
          gameState.isBot      = true;
          gameState.botProfile = bot.profile;
          gameState.players[BOT_PLAYER_ID] = makePlayer(BOT_PLAYER_ID, room.player1_username, 'bot', bot.avatar_icon);
        }

        games.set(code, gameState);
      }

      const game = games.get(code);
      const [[uRow]] = await pool.execute('SELECT avatar_icon FROM users WHERE id = ? LIMIT 1', [userId]);
      game.players[userId] = makePlayer(userId, username, socket.id, uRow?.avatar_icon ?? 0);

      socket.emit('dm:joined', { playerNumber: isP1 ? 1 : 2, roomCode: code, bet: room.bet });

      // Start game when both players are present
      // For bot rooms the bot is pre-populated, so joining human immediately makes 2 players
      const joined = Object.keys(game.players).length;
      if (joined < 2) {
        socket.emit('dm:waiting', { message: 'Waiting for opponent...' });
      } else if (game.status === 'waiting') {
        game.status = 'playing';
        await pool.execute("UPDATE duel_math_rooms SET status='playing' WHERE room_code=?", [code]);
        io.to(code).emit('dm:start', {
          players:     buildScores(game),
          bet:         room.bet,
          totalRounds: TOTAL_ROUNDS,
        });
        setTimeout(() => startRound(io, code), 1500);
      }
    } catch (err) {
      console.error('[DuelMath] dm:join error:', err.message);
      socket.emit('dm:error', { message: 'Server error.' });
    }
  });

  // ── dm:answer ─────────────────────────────────────────────────────────────
  socket.on('dm:answer', ({ roomCode, answerIndex }) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const game = games.get(code);
      if (!game || game.status !== 'playing') return;

      const player = game.players[userId];
      if (!player) return;

      // Anti-spam: cooldown
      const now = Date.now();
      if (now - player.lastAnswerMs < ANSWER_COOLDOWN) return;
      player.lastAnswerMs = now;

      // Already answered this round
      if (player.answeredRound) return;
      player.answeredRound = true;

      const { question } = game;
      if (!question) return;

      const correct = answerIndex === question.correctIndex;
      const elapsed = now - question.sentAt;
      const points  = correct ? calcPoints(elapsed) : 0;

      if (correct) {
        player.score  += points;
        player.streak += 1;
        player.correct += 1;
      } else {
        player.streak = 0;
        player.wrong  += 1;
      }

      // Send result only to this player
      socket.emit('dm:answer_result', {
        correct,
        points,
        answerIndex,
        correctIndex: question.correctIndex,
        score:  player.score,
        streak: player.streak,
      });

      // Broadcast updated scores to both
      io.to(code).emit('dm:scores_update', { scores: buildScores(game) });

      // Check if both answered → advance immediately
      const allAnswered = Object.values(game.players).every(p => p.answeredRound);
      if (allAnswered) advanceRound(io, code);

    } catch (err) {
      console.error('[DuelMath] dm:answer error:', err.message);
    }
  });

  // ── dm:leave ──────────────────────────────────────────────────────────────
  socket.on('dm:leave', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase().trim();
    handleLeave(io, socket, code, userId);
  });

  socket.on('disconnect', () => {
    if (socket.dmRoomCode) {
      handleLeave(io, socket, socket.dmRoomCode, userId);
    }
  });
}

function handleLeave(io, socket, roomCode, userId) {
  const game = games.get(roomCode);
  if (!game) return;
  if (game.status === 'playing') {
    // Only notify opponent in PvP games — bot has no socket to receive events
    if (!game.isBot) {
      io.to(roomCode).emit('dm:opponent_left', { username: game.players[userId]?.username });
    }
    endGame(io, roomCode, userId);
  } else if (game.status === 'waiting') {
    games.delete(roomCode);
    pool.execute("DELETE FROM duel_math_rooms WHERE room_code=? AND status='waiting'", [roomCode]).catch(() => {});
  }
  socket.leave(roomCode);
}

module.exports = { setupDuelMathSocket };
