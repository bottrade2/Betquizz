'use strict';

const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const { pool } = require('../database');

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// GET /api/bomb/rooms
router.get('/rooms', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.room_code, r.bet, r.bot_count, r.host_id, r.created_at,
              u.username AS host
       FROM bomb_rooms r
       LEFT JOIN users u ON u.id = r.host_id AND r.host_id != 0
       WHERE r.status = 'waiting' AND r.host_id != ?
       ORDER BY r.bot_count DESC, r.created_at DESC LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /bomb/rooms error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/bomb/rooms
router.post('/rooms', auth, async (req, res) => {
  const bet = parseFloat(req.body.bet);
  if (isNaN(bet) || bet < 1) return res.status(400).json({ message: 'Aposta inválida.' });

  try {
    const [[user]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    if (parseFloat(user.balance) < bet)
      return res.status(400).json({ message: 'Saldo insuficiente.' });

    let code = '';
    for (let i = 0; i < 10; i++) {
      const c = genCode();
      const [ex] = await pool.execute('SELECT id FROM bomb_rooms WHERE room_code = ?', [c]);
      if (!ex.length) { code = c; break; }
    }
    if (!code) return res.status(500).json({ message: 'Erro ao gerar código.' });

    await pool.execute(
      'INSERT INTO bomb_rooms (room_code, host_id, bet, bot_count) VALUES (?,?,?,0)',
      [code, req.user.id, bet]
    );

    res.status(201).json({ code });
  } catch (err) {
    console.error('POST /bomb/rooms error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/bomb/rooms/:code/join
router.post('/rooms/:code/join', auth, async (req, res) => {
  const code = req.params.code.toUpperCase();
  try {
    const [[room]] = await pool.execute('SELECT * FROM bomb_rooms WHERE room_code = ?', [code]);
    if (!room) return res.status(404).json({ message: 'Sala não encontrada.' });
    if (room.status !== 'waiting') return res.status(400).json({ message: 'Sala não disponível.' });

    const [[user]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    if (parseFloat(user.balance) < parseFloat(room.bet))
      return res.status(400).json({ message: 'Saldo insuficiente.' });

    res.json({ code, bet: room.bet, isBot: room.bot_count > 0 });
  } catch (err) {
    console.error('POST /bomb/rooms/:code/join error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
