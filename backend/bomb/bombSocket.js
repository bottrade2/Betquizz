'use strict';

const { pool }         = require('../database');
const { getQuestions } = require('../data/questions');

const THEMES      = ['geral', 'ciencia', 'historia', 'geografia', 'esportes'];
const DIFFS       = ['facil', 'facil', 'medio', 'medio', 'dificil'];
const BASE_TIME   = 12000;
const TIME_DEC    = 2000;
const MIN_TIME    = 4000;
const BOOM_PAUSE  = 2200;
const MAX_PLAYERS = 6;

// roomCode -> game state
const games = new Map();

// ── helpers ────────────────────────────────────────────────────────────────────

function pickQuestion() {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const diff  = DIFFS [Math.floor(Math.random() * DIFFS.length)];
  const qs    = getQuestions(theme, diff, 20);
  if (!qs.length) return pickQuestion();
  return qs[Math.floor(Math.random() * qs.length)];
}

function alivePlayers(game) {
  return game.order.filter(id => game.players[id]?.alive);
}

function nextAliveAfter(game, currentId) {
  const alive = alivePlayers(game);
  if (!alive.length) return null;
  const idx = alive.indexOf(currentId);
  return alive[(idx + 1) % alive.length];
}

function buildPlayerList(game) {
  return game.order.map(id => {
    const p = game.players[id];
    return { id: p.id, username: p.username, avatar_icon: p.avatar_icon, alive: p.alive, isBot: !!p.isBot };
  });
}

// ── bot answering ──────────────────────────────────────────────────────────────

function scheduleBotAnswer(io, roomCode) {
  const game = games.get(roomCode);
  if (!game || game.status !== 'playing') return;

  const bot = game.players[game.activeBombId];
  if (!bot || !bot.isBot || !bot.profile) return;

  const { accuracy, minDelay, maxDelay, skipChance } = bot.profile;

  // Bot skips (simulates timeout — handled by server timer)
  if (Math.random() < skipChance) return;

  const delay     = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));
  const safeDelay = Math.min(delay, game.currentTime - 600);
  if (safeDelay <= 0) return;

  game.botAnswerTimer = setTimeout(() => {
    const g = games.get(roomCode);
    if (!g || g.status !== 'playing') return;
    if (g.activeBombId !== bot.id) return;

    clearTimeout(g.timer);

    const correct   = Math.random() < accuracy;
    const wrongOpts = [0, 1, 2, 3].filter(i => i !== g.question.correctIndex);
    const answerIdx = correct
      ? g.question.correctIndex
      : wrongOpts[Math.floor(Math.random() * wrongOpts.length)];

    if (correct) {
      g.passCount++;
      g.currentTime = Math.max(MIN_TIME, BASE_TIME - g.passCount * TIME_DEC);
      const nextId  = nextAliveAfter(g, bot.id);
      g.activeBombId = nextId;

      io.to(roomCode).emit('bomb:pass', {
        fromId:      bot.id,
        fromName:    bot.username,
        activeId:    nextId,
        timeMs:      g.currentTime,
        correctIndex: g.question.correctIndex,
      });

      g.timer = setTimeout(() => {
        const g2 = games.get(roomCode);
        if (!g2 || g2.status !== 'playing') return;
        io.to(roomCode).emit('bomb:question', {
          question: g2.question.text,
          options:  g2.question.options,
          pt:       g2.question.pt || null,
          es:       g2.question.es || null,
          activeId: nextId,
          timeMs:   g2.currentTime,
          round:    g2.round,
          players:  buildPlayerList(g2),
        });
        g2.timer = setTimeout(() => handleTimeout(io, roomCode), g2.currentTime);
        if (g2.players[nextId]?.isBot) scheduleBotAnswer(io, roomCode);
      }, 600);

    } else {
      io.to(roomCode).emit('bomb:answer_wrong', {
        playerId:    bot.id,
        answerIndex: answerIdx,
        correctIndex: g.question.correctIndex,
      });
      setTimeout(() => eliminatePlayer(io, roomCode, bot.id, 'wrong'), 800);
    }
  }, safeDelay);
}

// ── round management ──────────────────────────────────────────────────────────

function startRound(io, roomCode) {
  const game = games.get(roomCode);
  if (!game || game.status !== 'playing') return;

  clearTimeout(game.timer);
  clearTimeout(game.botAnswerTimer);

  const q = pickQuestion();
  game.question    = { text: q.question, options: q.options, correctIndex: q.answer, pt: q.pt, es: q.es, sentAt: Date.now() };
  game.currentTime = BASE_TIME;
  game.passCount   = 0;
  game.round++;

  io.to(roomCode).emit('bomb:question', {
    question: q.question,
    options:  q.options,
    pt:       q.pt  || null,
    es:       q.es  || null,
    activeId: game.activeBombId,
    timeMs:   game.currentTime,
    round:    game.round,
    players:  buildPlayerList(game),
  });

  game.timer = setTimeout(() => handleTimeout(io, roomCode), game.currentTime);

  if (game.players[game.activeBombId]?.isBot) {
    scheduleBotAnswer(io, roomCode);
  }
}

function handleTimeout(io, roomCode) {
  const game = games.get(roomCode);
  if (!game || game.status !== 'playing') return;
  eliminatePlayer(io, roomCode, game.activeBombId, 'timeout');
}

async function eliminatePlayer(io, roomCode, userId, reason) {
  const game = games.get(roomCode);
  if (!game || !game.players[userId]) return;

  clearTimeout(game.timer);
  clearTimeout(game.botAnswerTimer);
  game.players[userId].alive = false;

  io.to(roomCode).emit('bomb:boom', {
    eliminatedId:   userId,
    eliminatedName: game.players[userId].username,
    reason,
    players:        buildPlayerList(game),
  });

  const alive = alivePlayers(game);

  if (alive.length <= 1) {
    await endGame(io, roomCode, alive[0] ?? null);
    return;
  }

  game.activeBombId = nextAliveAfter(game, userId);
  setTimeout(() => startRound(io, roomCode), BOOM_PAUSE);
}

async function endGame(io, roomCode, winnerId) {
  const game = games.get(roomCode);
  if (!game || game.status === 'finished') return;
  game.status = 'finished';
  clearTimeout(game.timer);
  clearTimeout(game.botAnswerTimer);

  const bet      = parseFloat(game.bet);
  const pot      = bet * game.order.length;
  const balances = {};

  try {
    await pool.execute("UPDATE bomb_rooms SET status='finished' WHERE room_code=?", [roomCode]);

    if (winnerId && !game.players[winnerId]?.isBot) {
      await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [pot, winnerId]);
      const [[row]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [winnerId]);
      balances[winnerId] = parseFloat(row.balance);
    }
  } catch (err) {
    console.error('[Bomb] endGame DB error:', err.message);
  }

  io.to(roomCode).emit('bomb:game_over', {
    winnerId,
    winnerName: winnerId ? game.players[winnerId]?.username : null,
    prize:      (winnerId && !game.players[winnerId]?.isBot) ? pot : 0,
    balances,
    players:    buildPlayerList(game),
  });

  games.delete(roomCode);
}

// ── pre-create bot room (called by bombBotCreator) ────────────────────────────

function createBotRoom(roomCode, bet, bots) {
  if (games.has(roomCode)) return;
  const players = {};
  const order   = [];
  for (const b of bots) {
    players[b.id] = {
      id: b.id, username: b.username, avatar_icon: b.avatar_icon,
      alive: true, socketId: null, isBot: true, profile: b.profile,
    };
    order.push(b.id);
  }
  games.set(roomCode, {
    roomCode, hostId: 0, bet, status: 'waiting', isBot: true,
    players, order,
    activeBombId: null, currentTime: BASE_TIME, passCount: 0,
    question: null, timer: null, botAnswerTimer: null, round: 0,
  });
}

// ── socket setup ───────────────────────────────────────────────────────────────

function setupBombSocket(io, socket) {
  const userId   = socket.user.id;
  const username = socket.user.username;

  socket.on('bomb:join', async ({ roomCode }) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const [[room]] = await pool.execute('SELECT * FROM bomb_rooms WHERE room_code = ?', [code]);
      if (!room) return socket.emit('bomb:error', { message: 'Sala não encontrada.' });
      if (room.status === 'finished') return socket.emit('bomb:error', { message: 'Jogo já terminou.' });

      const [[user]] = await pool.execute('SELECT balance, avatar_icon FROM users WHERE id = ?', [userId]);
      if (parseFloat(user.balance) < parseFloat(room.bet))
        return socket.emit('bomb:error', { message: 'Saldo insuficiente.' });

      socket.join(code);
      socket.bombRoomCode = code;

      // Init game state if not set (human-only room)
      if (!games.has(code)) {
        games.set(code, {
          roomCode: code, hostId: room.host_id, bet: room.bet,
          status: 'waiting', isBot: false,
          players: {}, order: [],
          activeBombId: null, currentTime: BASE_TIME, passCount: 0,
          question: null, timer: null, botAnswerTimer: null, round: 0,
        });
      }

      const game = games.get(code);
      if (game.status !== 'waiting') return socket.emit('bomb:error', { message: 'Jogo já em curso.' });
      if (alivePlayers(game).length >= MAX_PLAYERS) return socket.emit('bomb:error', { message: 'Sala cheia.' });

      if (!game.players[userId]) {
        game.players[userId] = { id: userId, username, avatar_icon: user.avatar_icon ?? 0, alive: true, socketId: socket.id, isBot: false };
        game.order.push(userId);
      } else {
        game.players[userId].socketId = socket.id;
      }

      socket.emit('bomb:room_state', {
        roomCode: code, bet: room.bet, hostId: room.host_id,
        status: game.status, players: buildPlayerList(game),
        isHost: room.host_id === userId, isBot: game.isBot,
      });

      io.to(code).emit('bomb:player_joined', { players: buildPlayerList(game) });

      // Bot room: auto-start as soon as human joins
      if (game.isBot && game.status === 'waiting') {
        const alive = alivePlayers(game);
        if (alive.length >= 2) {
          const bet = parseFloat(game.bet);
          // Deduct bet from human player(s)
          for (const pid of alive) {
            if (!game.players[pid].isBot) {
              await pool.execute('UPDATE users SET balance = GREATEST(0, balance - ?) WHERE id = ?', [bet, pid]);
            }
          }
          await pool.execute("UPDATE bomb_rooms SET status='playing' WHERE room_code=?", [code]);
          game.status = 'playing';
          game.activeBombId = alive[Math.floor(Math.random() * alive.length)];

          io.to(code).emit('bomb:countdown', { count: 3 });
          setTimeout(() => io.to(code).emit('bomb:countdown', { count: 2 }), 1000);
          setTimeout(() => io.to(code).emit('bomb:countdown', { count: 1 }), 2000);
          setTimeout(() => startRound(io, code), 3200);
        }
      }

    } catch (err) {
      console.error('[Bomb] bomb:join error:', err.message);
      socket.emit('bomb:error', { message: 'Erro no servidor.' });
    }
  });

  // Manual start (human-only rooms, host only)
  socket.on('bomb:start', async ({ roomCode }) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const game = games.get(code);
      if (!game) return socket.emit('bomb:error', { message: 'Sala não encontrada.' });
      if (game.hostId !== userId) return socket.emit('bomb:error', { message: 'Só o anfitrião pode iniciar.' });
      if (game.status !== 'waiting') return socket.emit('bomb:error', { message: 'Jogo já em curso.' });

      const alive = alivePlayers(game);
      if (alive.length < 2) return socket.emit('bomb:error', { message: 'Precisas de pelo menos 2 jogadores.' });

      const bet = parseFloat(game.bet);
      for (const pid of alive) {
        await pool.execute('UPDATE users SET balance = GREATEST(0, balance - ?) WHERE id = ?', [bet, pid]);
      }

      await pool.execute("UPDATE bomb_rooms SET status='playing' WHERE room_code=?", [code]);
      game.status = 'playing';
      game.activeBombId = alive[Math.floor(Math.random() * alive.length)];

      io.to(code).emit('bomb:countdown', { count: 3 });
      setTimeout(() => io.to(code).emit('bomb:countdown', { count: 2 }), 1000);
      setTimeout(() => io.to(code).emit('bomb:countdown', { count: 1 }), 2000);
      setTimeout(() => startRound(io, code), 3200);

    } catch (err) {
      console.error('[Bomb] bomb:start error:', err.message);
      socket.emit('bomb:error', { message: 'Erro ao iniciar.' });
    }
  });

  socket.on('bomb:answer', ({ roomCode, answerIndex }) => {
    try {
      const code = (roomCode || '').toUpperCase().trim();
      const game = games.get(code);
      if (!game || game.status !== 'playing') return;
      if (game.activeBombId !== userId) return;
      if (!game.players[userId]?.alive) return;

      clearTimeout(game.timer);
      clearTimeout(game.botAnswerTimer);

      const correct = answerIndex === game.question.correctIndex;

      if (correct) {
        game.passCount++;
        game.currentTime = Math.max(MIN_TIME, BASE_TIME - game.passCount * TIME_DEC);
        const nextId = nextAliveAfter(game, userId);
        game.activeBombId = nextId;

        io.to(code).emit('bomb:pass', {
          fromId: userId, fromName: username,
          activeId: nextId, timeMs: game.currentTime,
          correctIndex: game.question.correctIndex,
        });

        game.timer = setTimeout(() => {
          const g = games.get(code);
          if (!g || g.status !== 'playing') return;
          io.to(code).emit('bomb:question', {
            question: g.question.text, options: g.question.options,
            pt: g.question.pt || null, es: g.question.es || null,
            activeId: nextId, timeMs: g.currentTime,
            round: g.round, players: buildPlayerList(g),
          });
          g.timer = setTimeout(() => handleTimeout(io, code), g.currentTime);
          if (g.players[nextId]?.isBot) scheduleBotAnswer(io, code);
        }, 600);

      } else {
        io.to(code).emit('bomb:answer_wrong', {
          playerId: userId, answerIndex, correctIndex: game.question.correctIndex,
        });
        setTimeout(() => eliminatePlayer(io, code, userId, 'wrong'), 800);
      }
    } catch (err) {
      console.error('[Bomb] bomb:answer error:', err.message);
    }
  });

  socket.on('bomb:leave', ({ roomCode }) => {
    handleLeave(io, socket, (roomCode || '').toUpperCase().trim(), userId);
  });

  socket.on('disconnect', () => {
    if (socket.bombRoomCode) handleLeave(io, socket, socket.bombRoomCode, userId);
  });
}

function handleLeave(io, socket, roomCode, userId) {
  const game = games.get(roomCode);
  if (!game) return;
  socket.leave(roomCode);

  if (game.status === 'waiting') {
    delete game.players[userId];
    game.order = game.order.filter(id => id !== userId);
    if (game.order.filter(id => !game.players[id]?.isBot).length === 0) {
      games.delete(roomCode);
      pool.execute("DELETE FROM bomb_rooms WHERE room_code=? AND status='waiting'", [roomCode]).catch(() => {});
    } else {
      io.to(roomCode).emit('bomb:player_left', { players: buildPlayerList(game) });
    }
  } else if (game.status === 'playing' && game.players[userId]?.alive) {
    if (game.activeBombId === userId) {
      clearTimeout(game.timer);
      clearTimeout(game.botAnswerTimer);
      eliminatePlayer(io, roomCode, userId, 'disconnect');
    } else {
      game.players[userId].alive = false;
      io.to(roomCode).emit('bomb:player_left', { players: buildPlayerList(game) });
      if (alivePlayers(game).length <= 1) endGame(io, roomCode, alivePlayers(game)[0] ?? null);
    }
  }
}

module.exports = { setupBombSocket, createBotRoom, games };
