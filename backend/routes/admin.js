'use strict';

const express  = require('express');
const router   = express.Router();
const { pool } = require('../database');
const auth     = require('../middleware/auth');

async function adminOnly(req, res, next) {
  const [rows] = await pool.execute('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (rows.length === 0 || !rows[0].is_admin)
    return res.status(403).json({ message: 'Access restricted.' });
  next();
}

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get('/stats', auth, adminOnly, async (req, res) => {
  try {
    const [[{ total_users }]]  = await pool.execute('SELECT COUNT(*) as total_users FROM users WHERE is_bot = 0 OR is_bot IS NULL');
    const [[{ total_rooms }]]  = await pool.execute('SELECT COUNT(*) as total_rooms FROM rooms');
    const [[{ total_games }]]  = await pool.execute("SELECT COUNT(*) as total_games FROM rooms WHERE status = 'finished'");
    const [[{ active_games }]] = await pool.execute("SELECT COUNT(*) as active_games FROM rooms WHERE status = 'playing'");
    const [[{ total_balance }]] = await pool.execute("SELECT COALESCE(SUM(balance),0) as total_balance FROM users WHERE is_bot = 0 OR is_bot IS NULL");

    res.json({ total_users, total_rooms, total_games, active_games, total_balance });
  } catch (err) {
    console.error('admin/stats error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, balance, games_played, games_won, is_admin, is_bot, created_at FROM users ORDER BY created_at DESC LIMIT 200'
    );
    res.json(rows.map(u => ({ ...u, is_admin: u.is_admin === 1, is_bot: u.is_bot === 1 })));
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── GET /admin/rooms ──────────────────────────────────────────────────────────
router.get('/rooms', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT room_code, player1_username, player2_username, theme, difficulty, bet, status, created_at FROM rooms WHERE status IN ('waiting','playing') ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── POST /admin/users/:id/balance ─────────────────────────────────────────────
router.post('/users/:id/balance', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ message: 'Invalid user ID.' });
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount)) return res.status(400).json({ message: 'Invalid amount.' });
    await pool.execute('UPDATE users SET balance = GREATEST(0, balance + ?) WHERE id = ?', [amount, id]);
    const [[user]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'Balance updated.', balance: parseFloat(user.balance) });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── POST /admin/users/:id/set-balance ─────────────────────────────────────────
router.post('/users/:id/set-balance', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ message: 'Invalid user ID.' });
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount < 0) return res.status(400).json({ message: 'Invalid amount.' });
    await pool.execute('UPDATE users SET balance = ? WHERE id = ?', [amount, id]);
    res.json({ message: 'Balance set.', balance: amount });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────
router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ message: 'Invalid user ID.' });
    if (id === req.user.id) return res.status(400).json({ message: 'Cannot delete your own account.' });
    const [rows] = await pool.execute('SELECT is_admin FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    if (rows[0].is_admin) return res.status(400).json({ message: 'Cannot delete an admin account.' });
    await pool.execute('DELETE FROM game_history WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── DELETE /admin/rooms/:code ─────────────────────────────────────────────────
router.delete('/rooms/:code', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM rooms WHERE room_code = ?', [req.params.code]);
    res.json({ message: 'Room deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
