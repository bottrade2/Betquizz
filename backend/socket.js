/**
 * backend/socket.js  — versão com suporte a bots
 *
 * ALTERAÇÕES vs original (marcadas com // [BOT]):
 *   1. Import botManager no topo
 *   2. joinRoom: detecta sala vsBot e chama startBotGame()
 *   3. processAnswer(): função extraída do handler 'answer' para reutilização
 *   4. sendQuestion(): chama scheduleBotAnswer() no final
 *   5. endGame(): chama unregisterBot() e ignora UPDATE de users para bots (id -1)
 *   6. startBotGame(): nova função que inicia partida vs bot
 *   7. leaveRoom: cancela bot se sala vsBot
 */

const jwt = require('jsonwebtoken');
const { pool } = require('./database');
const { getQuestions, questions: allQuestions } = require('./data/questions');

// [BOT] — importar gestor de bots
const botManager = require('./bot/botManager');
const { setupDuelMathSocket }    = require('./duelmath/duelMathSocket');
const { setupBombSocket }        = require('./bomb/bombSocket');
const { setupTournamentSocket }  = require('./tournament/tournamentSocket');

// Active game timers: roomCode -> timer
const gameTimers = {};
// Track when each question was sent: roomCode -> timestamp (ms)
const questionStartTimes = {};
// Time limit per question in seconds
const QUESTION_TIME_LIMIT = 15;
// Max points for instant answer, min points for last-second answer
const MAX_POINTS = 100;
const MIN_POINTS = 10;

// Helper: get room from DB
async function getRoom(roomCode) {
  const [rows] = await pool.execute('SELECT * FROM rooms WHERE room_code = ? LIMIT 1', [roomCode]);
  if (rows.length === 0) return null;
  const r = rows[0];
  r.player1_answers = JSON.parse(r.player1_answers || '[]');
  r.player2_answers = JSON.parse(r.player2_answers || '[]');
  r.questions = JSON.parse(r.questions || '[]');
  return r;
}

function setupSocket(io) {
  // Auth middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.username}`);
    // Personal room for direct notifications (balance updates, deposits)
    socket.join(`user_${socket.user.id}`);
    setupDuelMathSocket(io, socket);
    setupBombSocket(io, socket);
    setupTournamentSocket(io, socket);

    // ── Join a room ──────────────────────────────────────────────────────────
    socket.on('joinRoom', async ({ roomCode }) => {
      try {
        const room = await getRoom(roomCode.toUpperCase());
        if (!room) {
          return socket.emit('error', { message: 'Room not found.' });
        }

        const userId   = socket.user.id;
        const username = socket.user.username;

        // Check if user is player 1
        if (Number(room.player1_id) === Number(userId)) {
          socket.join(roomCode);
          socket.roomCode = roomCode;
          socket.emit('roomJoined', {
            roomCode,
            playerNumber: 1,
            room: sanitizeRoom(room),
          });
          return;
        }

        // Check if user is already player 2 (joined via REST before socket connected)
        if (room.player2_id && Number(room.player2_id) === Number(userId)) {
          socket.join(roomCode);
          socket.roomCode = roomCode;
          socket.emit('roomJoined', {
            roomCode,
            playerNumber: 2,
            room: sanitizeRoom(room),
          });
          io.to(roomCode).emit('playerJoined', {
            username,
            room: sanitizeRoom(room),
          });
          if (room.status === 'waiting') {
            setTimeout(() => startGame(io, roomCode), 2000);
          }
          return;
        }

        // Room full
        if (room.player2_id) {
          return socket.emit('error', { message: 'Room is full.' });
        }

        if (room.status !== 'waiting') {
          return socket.emit('error', { message: 'Game already started.' });
        }

        // Check balance
        const [userRows] = await pool.execute('SELECT id, balance FROM users WHERE id = ? LIMIT 1', [userId]);
        if (userRows.length === 0 || parseFloat(userRows[0].balance) < parseFloat(room.bet)) {
          return socket.emit('error', { message: 'Insufficient balance.' });
        }

        // Set player 2
        await pool.execute(
          `UPDATE rooms SET player2_id = ?, player2_username = ?, player2_score = 0, player2_answers = '[]' WHERE room_code = ?`,
          [userId, username, roomCode]
        );

        const updatedRoom = await getRoom(roomCode);

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit('roomJoined', {
          roomCode,
          playerNumber: 2,
          room: sanitizeRoom(updatedRoom),
        });

        io.to(roomCode).emit('playerJoined', {
          username,
          room: sanitizeRoom(updatedRoom),
        });

        // Auto start game after short delay
        setTimeout(() => startGame(io, roomCode), 2000);
      } catch (err) {
        console.error('joinRoom error:', err);
        socket.emit('error', { message: 'Failed to join room.' });
      }
    });

    // ── Answer a question ────────────────────────────────────────────────────
    socket.on('answer', async ({ roomCode, questionIndex, answerIndex }) => {
      try {
        await processAnswer(io, roomCode, socket.user.id, questionIndex, answerIndex);
      } catch (err) {
        console.error('answer error:', err);
      }
    });

    // ── Leave / cancel a room ────────────────────────────────────────────────
    // explicit=true → botão "Sair" clicado pelo user
    // explicit=false (default) → navegação, só liberta slot de player2
    socket.on('leaveRoom', async ({ roomCode, explicit = false }) => {
      try {
        const room = await getRoom(roomCode);
        if (!room) return;

        const userId = socket.user.id;

        // ── Forfeit: sair a meio de um jogo em curso ────────────────────────
        if (room.status === 'playing' && explicit) {
          await endGame(io, roomCode, userId);
          socket.leave(roomCode);
          return;
        }

        if (room.status !== 'waiting') return;

        if (Number(room.player1_id) === Number(userId) && explicit) {
          // Criador saiu explicitamente: apagar sala
          if (botManager.hasBot(roomCode)) botManager.unregisterBot(roomCode);
          await pool.execute("DELETE FROM rooms WHERE room_code = ? AND status = 'waiting'", [roomCode]);
          socket.leave(roomCode);
          io.to(roomCode).emit('roomCancelled', { message: 'A sala foi cancelada pelo criador.' });
        } else if (Number(room.player2_id) === Number(userId)) {
          // Player2 sai (navegação ou explícito): libertar slot
          await pool.execute(
            "UPDATE rooms SET player2_id = NULL, player2_username = NULL, player2_score = 0, player2_answers = '[]' WHERE room_code = ? AND status = 'waiting'",
            [roomCode]
          );
          socket.leave(roomCode);
          const updated = await getRoom(roomCode);
          io.to(roomCode).emit('playerLeft', { username: socket.user.username, room: sanitizeRoom(updated) });
        }
      } catch (err) {
        console.error('leaveRoom error:', err);
      }
    });

    // ── Chat message ─────────────────────────────────────────────────────────
    socket.on('chatMessage', async ({ roomCode, message }) => {
      try {
        if (!message || message.trim().length === 0) return;
        const sanitized = message.trim().substring(0, 200);

        const [roomRows] = await pool.execute('SELECT id FROM rooms WHERE room_code = ? LIMIT 1', [roomCode]);
        if (roomRows.length === 0) return;

        // [BOT] Bots não participam no chat (mas o utilizador pode escrever)
        await pool.execute(
          'INSERT INTO chat_messages (room_code, username, message) VALUES (?, ?, ?)',
          [roomCode, socket.user.username, sanitized]
        );

        io.to(roomCode).emit('chatMessage', {
          username: socket.user.username,
          message:  sanitized,
          timestamp: new Date(),
        });
      } catch (err) {
        console.error('chatMessage error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.username}`);
    });
  });
}

// ── processAnswer ────────────────────────────────────────────────────────────
//
// [BOT] Extraído do handler 'answer' para ser reutilizável pelo bot.
// Funciona para userId real E para userId = -1 (bot).
//
async function processAnswer(io, roomCode, userId, questionIndex, answerIndex) {
  const answerTime = Date.now();
  const room = await getRoom(roomCode);
  if (!room || room.status !== 'playing') return;

  const isPlayer1 = room.player1_id === userId;
  const isPlayer2 = room.player2_id === userId;

  if (!isPlayer1 && !isPlayer2) return;

  const answers  = isPlayer1 ? room.player1_answers : room.player2_answers;
  const question = room.questions[questionIndex];

  if (!question) return;
  if (answers.length > questionIndex) return; // Already answered

  const correct = answerIndex === question.answer;

  // Time-based scoring: faster = more points
  let scoreAdd = 0;
  if (correct) {
    const startTime  = questionStartTimes[roomCode] || answerTime;
    const elapsedMs  = answerTime - startTime;
    const elapsedSec = Math.min(elapsedMs / 1000, QUESTION_TIME_LIMIT);
    const timeRatio  = Math.max(0, 1 - (elapsedSec / QUESTION_TIME_LIMIT));
    scoreAdd = Math.max(MIN_POINTS, Math.round(MAX_POINTS * timeRatio));
  }

  // Store answer
  answers.push({ answerIndex, time: answerTime, points: scoreAdd });

  if (isPlayer1) {
    await pool.execute(
      'UPDATE rooms SET player1_answers = ?, player1_score = player1_score + ? WHERE room_code = ?',
      [JSON.stringify(answers), scoreAdd, roomCode]
    );
  } else {
    await pool.execute(
      'UPDATE rooms SET player2_answers = ?, player2_score = player2_score + ? WHERE room_code = ?',
      [JSON.stringify(answers), scoreAdd, roomCode]
    );
  }

  const freshRoom = await getRoom(roomCode);

  // Notify both players
  io.to(roomCode).emit('answerResult', {
    player:   isPlayer1 ? 'player1' : 'player2',
    username: isPlayer1 ? freshRoom.player1_username : freshRoom.player2_username,
    questionIndex,
    answerIndex,
    correct,
    pointsEarned: scoreAdd,
    scores: {
      player1: { username: freshRoom.player1_username, score: freshRoom.player1_score },
      player2: { username: freshRoom.player2_username, score: freshRoom.player2_score },
    },
  });

  // Check if both answered current question
  const p1Answered = freshRoom.player1_answers.length > questionIndex;
  const p2Answered = freshRoom.player2_answers.length > questionIndex;

  if (p1Answered && p2Answered) {
    const nextQ = questionIndex + 1;
    if (nextQ >= freshRoom.questions.length) {
      await endGame(io, roomCode);
    } else {
      await pool.execute('UPDATE rooms SET current_question = ? WHERE room_code = ?', [nextQ, roomCode]);
      clearTimeout(gameTimers[roomCode]);
      setTimeout(() => sendQuestion(io, roomCode, nextQ), 2000);
    }
  }
}

// ── startGame ────────────────────────────────────────────────────────────────
async function startGame(io, roomCode) {
  try {
    const room = await getRoom(roomCode);
    if (!room || room.status !== 'waiting') return;
    if (room.player1_id == null || !room.player2_id) return;

    // Se um dos jogadores é bot, garante que está registado
    if ((room.player1_id === 0 || room.player2_id === 0) && !botManager.hasBot(roomCode)) {
      const botDiff = room.difficulty;
      botManager.registerBot(roomCode, botDiff);
    }

    let theme = room.theme;
    if (theme === 'random') {
      const availableThemes = Object.keys(allQuestions);
      theme = availableThemes[Math.floor(Math.random() * availableThemes.length)];
      await pool.execute('UPDATE rooms SET theme = ? WHERE room_code = ?', [theme, roomCode]);
    }

    const questions = getQuestions(theme, room.difficulty, 10);
    if (questions.length === 0) {
      io.to(roomCode).emit('error', { message: 'No questions available for this theme.' });
      return;
    }

    await pool.execute(
      `UPDATE rooms SET questions = ?, status = 'playing', current_question = 0 WHERE room_code = ?`,
      [JSON.stringify(questions), roomCode]
    );

    io.to(roomCode).emit('gameStarted', {
      totalQuestions: questions.length,
      theme,
      difficulty: room.difficulty,
      bet:        room.bet,
      players: {
        player1: room.player1_username,
        player2: room.player2_username,
      },
    });

    setTimeout(() => sendQuestion(io, roomCode, 0), 3000);
  } catch (err) {
    console.error('startGame error:', err);
  }
}

// ── sendQuestion ─────────────────────────────────────────────────────────────
async function sendQuestion(io, roomCode, index) {
  try {
    const room = await getRoom(roomCode);
    if (!room || room.status !== 'playing') return;
    if (index >= room.questions.length) return;

    const q = room.questions[index];

    // Shuffle options — same order applied to all language versions
    const optionIndices = q.options.map((_, i) => i);
    for (let i = optionIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [optionIndices[i], optionIndices[j]] = [optionIndices[j], optionIndices[i]];
    }
    const shuffledOptions   = optionIndices.map(i => q.options[i]);
    const shuffledAnswer    = optionIndices.indexOf(q.answer);
    const shuffledPtOptions = q.pt?.o ? optionIndices.map(i => q.pt.o[i]) : null;
    const shuffledEsOptions = q.es?.o ? optionIndices.map(i => q.es.o[i]) : null;

    room.questions[index] = {
      ...q,
      options: shuffledOptions,
      answer:  shuffledAnswer,
      pt: q.pt ? { q: q.pt.q, o: shuffledPtOptions ?? shuffledOptions } : null,
      es: q.es ? { q: q.es.q, o: shuffledEsOptions ?? shuffledOptions } : null,
    };
    await pool.execute('UPDATE rooms SET questions = ? WHERE room_code = ?', [JSON.stringify(room.questions), roomCode]);

    questionStartTimes[roomCode] = Date.now();

    io.to(roomCode).emit('question', {
      index,
      total:     room.questions.length,
      question:  q.question,
      options:   shuffledOptions,
      pt: { q: q.pt?.q ?? q.question, o: shuffledPtOptions ?? shuffledOptions },
      es: { q: q.es?.q ?? q.question, o: shuffledEsOptions ?? shuffledOptions },
      timeLimit: QUESTION_TIME_LIMIT,
    });

    // [BOT] Agendar resposta do bot se a sala tiver bot
    if (botManager.hasBot(roomCode)) {
      const bot = botManager.getBot(roomCode);
      botManager.scheduleBotAnswer(
        roomCode,
        { ...room.questions[index], options: shuffledOptions, answer: shuffledAnswer },
        index,
        QUESTION_TIME_LIMIT * 1000,
        (answerIndex) => {
          // Invoca o mesmo processAnswer que o utilizador usa
          processAnswer(io, roomCode, bot.id, index, answerIndex).catch(err => {
            console.error('bot processAnswer error:', err);
          });
        }
      );
    }

    // Timer de expiração
    gameTimers[roomCode] = setTimeout(async () => {
      try {
        const freshRoom = await getRoom(roomCode);
        if (!freshRoom || freshRoom.status !== 'playing') return;

        let p1Answers = freshRoom.player1_answers;
        let p2Answers = freshRoom.player2_answers;
        let update    = false;

        if (p1Answers.length <= index) {
          p1Answers.push({ answerIndex: -1, time: Date.now(), points: 0 });
          update = true;
        }
        if (p2Answers.length <= index) {
          p2Answers.push({ answerIndex: -1, time: Date.now(), points: 0 });
          update = true;
        }

        if (update) {
          await pool.execute(
            'UPDATE rooms SET player1_answers = ?, player2_answers = ? WHERE room_code = ?',
            [JSON.stringify(p1Answers), JSON.stringify(p2Answers), roomCode]
          );
        }

        io.to(roomCode).emit('timeUp', { questionIndex: index });

        const nextQ = index + 1;
        if (nextQ >= freshRoom.questions.length) {
          await endGame(io, roomCode);
        } else {
          await pool.execute('UPDATE rooms SET current_question = ? WHERE room_code = ?', [nextQ, roomCode]);
          setTimeout(() => sendQuestion(io, roomCode, nextQ), 2000);
        }
      } catch (err) {
        console.error('timer error:', err);
      }
    }, (QUESTION_TIME_LIMIT + 2) * 1000);
  } catch (err) {
    console.error('sendQuestion error:', err);
  }
}

// ── endGame ──────────────────────────────────────────────────────────────────
async function endGame(io, roomCode, forfeitingUserId = null) {
  try {
    const room = await getRoom(roomCode);
    if (!room || room.status === 'finished') return;

    const p1Score  = room.player1_score;
    const p2Score  = room.player2_score;
    const isBotP1  = room.player1_id === 0;
    const isBotP2  = room.player2_id === 0;
    const isVsBot  = isBotP1 || isBotP2;

    // Carregar jogadores humanos da BD
    let p1Rows = [], p2Rows = [];
    if (!isBotP1) {
      [p1Rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [room.player1_id]);
      if (p1Rows.length === 0) return;
      // DECIMAL columns come back as strings from mysql2 — convert now
      p1Rows[0].balance = parseFloat(p1Rows[0].balance) || 0;
    }
    if (!isBotP2 && room.player2_id) {
      [p2Rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [room.player2_id]);
      if (p2Rows.length === 0) return;
      p2Rows[0].balance = parseFloat(p2Rows[0].balance) || 0;
    }

    // Determinar vencedor
    let result;
    let winnerId = null;

    const decide = (winner) => {
      result   = winner;
      winnerId = winner === 'player1'
        ? (isBotP1 ? null : room.player1_id)
        : (isBotP2 ? null : room.player2_id);
    };

    if (forfeitingUserId !== null) {
      // Forfeit: quem saiu perde automaticamente
      const forfeitIsP1 = Number(room.player1_id) === Number(forfeitingUserId);
      decide(forfeitIsP1 ? 'player2' : 'player1');
    } else if (p1Score > p2Score) {
      decide('player1');
    } else if (p2Score > p1Score) {
      decide('player2');
    } else {
      const p1Correct = room.player1_answers.filter((a, i) => a.answerIndex === room.questions[i]?.answer).length;
      const p2Correct = room.player2_answers.filter((a, i) => a.answerIndex === room.questions[i]?.answer).length;
      if (p1Correct !== p2Correct) {
        decide(p1Correct > p2Correct ? 'player1' : 'player2');
      } else {
        const p1Time = room.player1_answers.reduce((s, a) => s + (a.time || 0), 0);
        const p2Time = room.player2_answers.reduce((s, a) => s + (a.time || 0), 0);
        decide(p1Time <= p2Time ? 'player1' : 'player2');
      }
    }

    // Aplicar aposta (apenas jogadores humanos movem saldo)
    const bet = parseFloat(room.bet);
    if (!isBotP1 && p1Rows.length > 0) {
      if (result === 'player1') {
        p1Rows[0].balance  += bet;
        p1Rows[0].games_won = (p1Rows[0].games_won || 0) + 1;
        if (!isVsBot && p2Rows.length > 0) p2Rows[0].balance = Math.max(0, p2Rows[0].balance - bet);
      } else {
        p1Rows[0].balance = Math.max(0, p1Rows[0].balance - bet);
        if (!isVsBot && p2Rows.length > 0) {
          p2Rows[0].balance  += bet;
          p2Rows[0].games_won = (p2Rows[0].games_won || 0) + 1;
        }
      }
    } else if (!isBotP2 && p2Rows.length > 0) {
      // Bot é player1, humano é player2
      if (result === 'player2') {
        p2Rows[0].balance  += bet;
        p2Rows[0].games_won = (p2Rows[0].games_won || 0) + 1;
      } else {
        p2Rows[0].balance = Math.max(0, p2Rows[0].balance - bet);
      }
    }

    // ── Atomic DB writes ─────────────────────────────────────────────────────
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `DELETE FROM rooms WHERE room_code = ?`,
        [roomCode]
      );

      if (!isBotP1 && p1Rows.length > 0) {
        await conn.execute(
          'UPDATE users SET balance = ?, games_played = games_played + 1, games_won = ? WHERE id = ?',
          [p1Rows[0].balance, p1Rows[0].games_won, room.player1_id]
        );
      }
      if (!isBotP2 && p2Rows.length > 0) {
        await conn.execute(
          'UPDATE users SET balance = ?, games_played = games_played + 1, games_won = ? WHERE id = ?',
          [p2Rows[0].balance, p2Rows[0].games_won, room.player2_id]
        );
      }

      if (isVsBot) {
        const BOT_NAMES = { facil: 'BrainStorm', medio: 'FastThinker', dificil: 'MegaIQ' };
        const botName = BOT_NAMES[room.difficulty] || 'FastThinker';
        const botWon  = isBotP1 ? result === 'player1' : result === 'player2';
        await conn.execute(
          'UPDATE users SET games_played = games_played + 1, games_won = games_won + ? WHERE username = ? AND is_bot = 1',
          [botWon ? 1 : 0, botName]
        );
      }

      if (!isBotP1 && p1Rows.length > 0) {
        await conn.execute(
          'INSERT INTO game_history (user_id, room_code, opponent, result, bet, score, opponent_score, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [room.player1_id, roomCode, room.player2_username, result === 'player1' ? 'win' : 'loss', room.bet, p1Score, p2Score, room.theme]
        );
      }
      if (!isBotP2 && p2Rows.length > 0) {
        await conn.execute(
          'INSERT INTO game_history (user_id, room_code, opponent, result, bet, score, opponent_score, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [room.player2_id, roomCode, room.player1_username, result === 'player2' ? 'win' : 'loss', room.bet, p2Score, p1Score, room.theme]
        );
      }

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    clearTimeout(gameTimers[roomCode]);
    delete gameTimers[roomCode];
    delete questionStartTimes[roomCode];

    if (botManager.hasBot(roomCode)) {
      botManager.unregisterBot(roomCode);
    }

    const balancesPayload = {};
    if (!isBotP1 && p1Rows.length > 0) balancesPayload[room.player1_username] = p1Rows[0].balance;
    if (!isBotP2 && p2Rows.length > 0) balancesPayload[room.player2_username] = p2Rows[0].balance;

    io.to(roomCode).emit('gameEnded', {
      result,
      winner: result === 'player1' ? room.player1_username : room.player2_username,
      scores: {
        player1: { username: room.player1_username, score: p1Score },
        player2: { username: room.player2_username, score: p2Score },
      },
      bet:      room.bet,
      balances: balancesPayload,
    });
  } catch (err) {
    console.error('endGame error:', err);
  }
}

// ── sanitizeRoom ─────────────────────────────────────────────────────────────
function sanitizeRoom(room) {
  return {
    roomCode:        room.room_code,
    player1:         room.player1_id != null
      ? { username: room.player1_username, score: room.player1_score }
      : null,
    player2:         room.player2_id
      ? { username: room.player2_username, score: room.player2_score }
      : null,
    theme:           room.theme,
    difficulty:      room.difficulty,
    bet:             room.bet,
    status:          room.status,
    currentQuestion: room.current_question,
  };
}

module.exports = setupSocket;
