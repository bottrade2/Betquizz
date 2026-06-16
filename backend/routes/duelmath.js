'use strict';

const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const { pool } = require('../database');

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── GET /api/duelmath/rooms ───────────────────────────────────────────────────
router.get('/rooms', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT room_code, player1_username, bet, created_at
       FROM duel_math_rooms
       WHERE status = 'waiting' AND player1_id != ?
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── POST /api/duelmath/rooms ──────────────────────────────────────────────────
router.post('/rooms', auth, async (req, res) => {
  const bet = parseFloat(req.body.bet);
  if (isNaN(bet) || bet < 1) return res.status(400).json({ message: 'Invalid bet.' });

  try {
    // Check balance
    const [[user]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    if (parseFloat(user.balance) < bet)
      return res.status(400).json({ message: 'Insufficient balance.' });

    // Generate unique code
    let code = '';
    for (let i = 0; i < 10; i++) {
      const c = genCode();
      const [ex] = await pool.execute('SELECT id FROM duel_math_rooms WHERE room_code = ?', [c]);
      if (!ex.length) { code = c; break; }
    }
    if (!code) return res.status(500).json({ message: 'Could not generate code.' });

    await pool.execute(
      'INSERT INTO duel_math_rooms (room_code, player1_id, player1_username, bet) VALUES (?,?,?,?)',
      [code, req.user.id, req.user.username, bet]
    );

    res.status(201).json({ code });
  } catch (err) {
    console.error('duelmath create error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── POST /api/duelmath/rooms/:code/join ───────────────────────────────────────
router.post('/rooms/:code/join', auth, async (req, res) => {
  const code = req.params.code.toUpperCase();
  try {
    const [[room]] = await pool.execute('SELECT * FROM duel_math_rooms WHERE room_code = ?', [code]);
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.status !== 'waiting') return res.status(400).json({ message: 'Room not available.' });
    if (Number(room.player1_id) === Number(req.user.id))
      return res.status(400).json({ message: 'You created this room.' });

    const [[user]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    if (parseFloat(user.balance) < parseFloat(room.bet))
      return res.status(400).json({ message: 'Insufficient balance.' });

    await pool.execute(
      'UPDATE duel_math_rooms SET player2_id=?, player2_username=? WHERE room_code=?',
      [req.user.id, req.user.username, code]
    );
    res.json({ code });
  } catch (err) {
    console.error('duelmath join error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
