'use strict';

const express  = require('express');
const auth     = require('../middleware/auth');
const { pool } = require('../database');
const { startTournament, scheduleBotFill, cancelBotFill } = require('../tournament/tournamentManager');

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

module.exports = function createTournamentRouter(io) {
  const router = express.Router();

  // GET /api/tournament — list open tournaments
  router.get('/', auth, async (req, res) => {
    try {
      const [rows] = await pool.execute(`
        SELECT t.*,
          (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS player_count
        FROM tournaments t
        WHERE t.status = 'waiting'
        ORDER BY t.created_at DESC LIMIT 30
      `);
      res.json(rows);
    } catch { res.status(500).json({ message: 'Server error.' }); }
  });

  // GET /api/tournament/:id — detail + bracket
  router.get('/:id', auth, async (req, res) => {
    try {
      const [[t]] = await pool.execute('SELECT * FROM tournaments WHERE id=?', [req.params.id]);
      if (!t) return res.status(404).json({ message: 'Not found.' });
      const [players] = await pool.execute('SELECT * FROM tournament_players WHERE tournament_id=? ORDER BY seed', [t.id]);
      const [matches] = await pool.execute('SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round, match_num', [t.id]);
      res.json({ ...t, players, matches });
    } catch { res.status(500).json({ message: 'Server error.' }); }
  });

  // POST /api/tournament — create
  router.post('/', auth, async (req, res) => {
    const size     = parseInt(req.body.size) === 8 ? 8 : 4;
    const entryFee = parseFloat(req.body.entry_fee);
    if (isNaN(entryFee) || entryFee < 1) return res.status(400).json({ message: 'Invalid entry fee.' });

    try {
      const [[user]] = await pool.execute('SELECT balance FROM users WHERE id=?', [req.user.id]);
      if (parseFloat(user.balance) < entryFee)
        return res.status(400).json({ message: 'Insufficient balance.' });

      let code = '';
      for (let i = 0; i < 10; i++) {
        const c = genCode();
        const [ex] = await pool.execute('SELECT id FROM tournaments WHERE code=?', [c]);
        if (!ex.length) { code = c; break; }
      }
      if (!code) return res.status(500).json({ message: 'Could not generate code.' });

      const totalRounds = size === 8 ? 3 : 2;
      const [result] = await pool.execute(
        'INSERT INTO tournaments (code, size, entry_fee, prize_pool, total_rounds) VALUES (?,?,?,?,?)',
        [code, size, entryFee, entryFee, totalRounds]
      );
      const tid = result.insertId;

      await pool.execute('UPDATE users SET balance = GREATEST(0, balance - ?) WHERE id=?', [entryFee, req.user.id]);
      await pool.execute(
        'INSERT INTO tournament_players (tournament_id, user_id, username) VALUES (?,?,?)',
        [tid, req.user.id, req.user.username]
      );

      scheduleBotFill(io, tid, 2 * 60 * 1000);
      res.status(201).json({ id: tid, code });
    } catch (err) {
      console.error('tournament create:', err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  // POST /api/tournament/:id/join
  router.post('/:id/join', auth, async (req, res) => {
    const tid = parseInt(req.params.id);
    try {
      const [[t]] = await pool.execute('SELECT * FROM tournaments WHERE id=?', [tid]);
      if (!t)                     return res.status(404).json({ message: 'Not found.' });
      if (t.status !== 'waiting') return res.status(400).json({ message: 'Already started.' });

      const [[existing]] = await pool.execute(
        'SELECT id FROM tournament_players WHERE tournament_id=? AND user_id=?', [tid, req.user.id]
      );
      if (existing) return res.status(400).json({ message: 'Already joined.' });

      const [[cnt]] = await pool.execute(
        'SELECT COUNT(*) AS c FROM tournament_players WHERE tournament_id=?', [tid]
      );
      if (cnt.c >= t.size) return res.status(400).json({ message: 'Tournament is full.' });

      const [[user]] = await pool.execute('SELECT balance FROM users WHERE id=?', [req.user.id]);
      if (parseFloat(user.balance) < parseFloat(t.entry_fee))
        return res.status(400).json({ message: 'Insufficient balance.' });

      await pool.execute('UPDATE users SET balance = GREATEST(0, balance - ?) WHERE id=?', [t.entry_fee, req.user.id]);
      await pool.execute(
        'INSERT INTO tournament_players (tournament_id, user_id, username) VALUES (?,?,?)',
        [tid, req.user.id, req.user.username]
      );
      await pool.execute('UPDATE tournaments SET prize_pool = prize_pool + ? WHERE id=?', [t.entry_fee, tid]);

      const newCount = cnt.c + 1;

      // Notify others via socket
      io.to(`t_${tid}`).emit('t:player_joined', {
        userId: req.user.id, username: req.user.username, count: newCount, size: t.size,
      });

      // If full, start
      if (newCount >= t.size) {
        cancelBotFill(tid);
        setTimeout(() => startTournament(io, tid), 5000);
      }

      res.json({ id: tid });
    } catch (err) {
      console.error('tournament join:', err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  return router;
};
