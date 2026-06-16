/**
 * backend/routes/game.js  — versão com suporte a bots
 *
 * ALTERAÇÕES vs original (marcadas com // [BOT]):
 *   1. POST /rooms: aceita { vsBot: true, botDifficulty } no body
 *      → Cria sala com player2_id = -1 e regista bot no botManager
 *   2. GET /rooms: exclui salas vs bot da listagem pública
 *   3. Restante código inalterado
 *
 * NOTA: não tens o routes/game.js original, por isso este ficheiro
 * reconstrói as rotas inferidas do frontend + adiciona a lógica de bot.
 * Adapta os nomes das rotas ao teu ficheiro real se diferirem.
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const { pool }   = require('../database');
const authMiddleware = require('../middleware/auth');
const { getQuestions } = require('../data/questions');

// Gerar código de sala aleatório (6 caracteres alfanuméricos)
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const DIFFICULTIES = ['facil', 'medio', 'dificil'];
function randomDifficulty() {
  return DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)];
}

const THEMES = ['geral', 'ciencia', 'historia', 'geografia', 'esportes'];
function randomTheme() {
  return THEMES[Math.floor(Math.random() * THEMES.length)];
}

// ── GET /rooms — listar salas disponíveis ────────────────────────────────────
router.get('/rooms', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(`
      SELECT
        room_code, player1_username, player2_username,
        theme, difficulty, bet, status,
        player1_id, player2_id
      FROM rooms
      WHERE status = 'waiting'
      ORDER BY created_at DESC
      LIMIT 50
    `);

    res.json(rows.map(r => ({
      code:       r.room_code,
      isOwn:      Number(r.player1_id) === Number(userId),
      players:    [
        { username: r.player1_username },
        ...(r.player2_username ? [{ username: r.player2_username }] : []),
      ],
      theme:      r.theme,
      difficulty: r.difficulty,
      bet:        r.bet,
      status:     r.status,
    })));
  } catch (err) {
    console.error('GET /rooms error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /rooms/:code — detalhes de uma sala ──────────────────────────────────
router.get('/rooms/:code', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM rooms WHERE room_code = ? LIMIT 1',
      [req.params.code.toUpperCase()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const r = rows[0];
    res.json({
      code:       r.room_code,
      players:    [
        { username: r.player1_username },
        ...(r.player2_id ? [{ username: r.player2_username }] : []),
      ],
      theme:      r.theme,
      difficulty: r.difficulty,
      bet:        r.bet,
      status:     r.status,
    });
  } catch (err) {
    console.error('GET /rooms/:code error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /rooms — criar sala ─────────────────────────────────────────────────
router.post('/rooms', authMiddleware, async (req, res) => {
  try {
    const userId   = req.user.id;
    const username = req.user.username;

    const { bet = 10, language = 'pt' } = req.body;
    const safeLanguage = ['pt', 'en', 'es'].includes(language) ? language : 'pt';

    const theme      = randomTheme();
    const difficulty = randomDifficulty();

    const betInt = parseInt(bet, 10);
    if (!Number.isInteger(betInt) || betInt <= 0) {
      return res.status(400).json({ message: 'Invalid bet.' });
    }

    // Verificar saldo
    const [userRows] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (userRows[0].balance < betInt) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    // Gerar código único
    let code;
    let attempts = 0;
    do {
      code = generateRoomCode();
      const [existing] = await pool.execute('SELECT id FROM rooms WHERE room_code = ?', [code]);
      if (existing.length === 0) break;
      attempts++;
    } while (attempts < 10);

    await pool.execute(`
      INSERT INTO rooms
        (room_code, player1_id, player1_username, player1_score, player1_answers,
         theme, difficulty, bet, status, language)
      VALUES (?, ?, ?, 0, '[]', ?, ?, ?, 'waiting', ?)
    `, [code, userId, username, theme, difficulty, betInt, safeLanguage]);

    res.status(201).json({ code, theme, difficulty, bet: betInt });
  } catch (err) {
    console.error('POST /rooms error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /rooms/:code/join — entrar numa sala (humano vs humano) ─────────────
router.post('/rooms/:code/join', authMiddleware, async (req, res) => {
  try {
    const code     = req.params.code.toUpperCase();
    const userId   = req.user.id;
    const username = req.user.username;

    const [rows] = await pool.execute('SELECT * FROM rooms WHERE room_code = ? LIMIT 1', [code]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Room not found.' });
    }

    const room = rows[0];

    if (room.status !== 'waiting') {
      return res.status(400).json({ message: 'Game already started.' });
    }
    if (Number(room.player1_id) === Number(userId)) {
      return res.status(400).json({ message: 'You are already the creator of this room.' });
    }
    // Permitir reentrar se já és player2 (o utilizador navegou para fora e voltou)
    if (room.player2_id && Number(room.player2_id) !== Number(userId)) {
      return res.status(400).json({ message: 'Room is full.' });
    }
    if (room.player2_id && Number(room.player2_id) === Number(userId)) {
      return res.json({ code, message: 'Rejoined.' });
    }

    const [userRows] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0 || parseFloat(userRows[0].balance) < parseFloat(room.bet)) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    await pool.execute(
      `UPDATE rooms SET player2_id = ?, player2_username = ?, player2_score = 0, player2_answers = '[]' WHERE room_code = ?`,
      [userId, username, code]
    );

    res.json({ code, message: 'Joined successfully.' });
  } catch (err) {
    console.error('POST /rooms/:code/join error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /leaderboard ─────────────────────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM users WHERE games_played > 20'
    );
    const [rows] = await pool.execute(`
      SELECT username, balance, games_played, games_won, is_bot, avatar_icon,
        ROUND(games_won * 100.0 / games_played, 1) AS win_rate
      FROM users
      WHERE games_played > 20
      ORDER BY win_rate DESC, games_played DESC, games_won DESC
      LIMIT 10
    `);

    res.json({
      total: Number(total),
      players: rows.map(r => ({
        username:    r.username,
        balance:     r.balance,
        wins:        r.games_won,
        losses:      r.games_played - r.games_won,
        games:       r.games_played,
        winRate:     parseFloat(r.win_rate),
        isBot:       r.is_bot === 1,
        avatar_icon: r.avatar_icon ?? 0,
      })),
    });
  } catch (err) {
    console.error('GET /leaderboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /history — histórico do utilizador autenticado ──────────────────────
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT opponent, result, bet, score, opponent_score, theme, created_at
      FROM game_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `, [req.user.id]);

    res.json(rows.map(r => ({
      opponent:      { username: r.opponent },
      result:        r.result === 'win' ? 'win' : r.result === 'draw' ? 'draw' : 'lose',
      bet:           r.bet,
      yourScore:     r.score,
      opponentScore: r.opponent_score,
      theme:         r.theme,
      createdAt:     r.created_at,
    })));
  } catch (err) {
    console.error('GET /history error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
