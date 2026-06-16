const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const router   = express.Router();
const { pool } = require('../database');
const auth     = require('../middleware/auth');
const { sendVerificationEmail, SMTP_CONFIGURED } = require('../utils/mailer');
const { generateUniqueCode } = require('../migrations/add_referral');

function makeToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, referral_code } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ message: 'All fields are required.' });
    if (username.length < 3 || username.length > 20)
      return res.status(400).json({ message: 'Username must be between 3 and 20 characters.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
      [email, username]
    );
    if (existing.length > 0)
      return res.status(409).json({ message: 'Email or username already in use.' });

    const hash              = await bcrypt.hash(password, 12);
    const emailVerified     = SMTP_CONFIGURED ? 0 : 1;
    const verificationToken = SMTP_CONFIGURED ? crypto.randomBytes(32).toString('hex') : null;

    // Validate referral code if provided
    let referrerId = null;
    if (referral_code && referral_code.trim()) {
      const [[referrer]] = await pool.execute(
        'SELECT id FROM users WHERE referral_code = ? LIMIT 1',
        [referral_code.trim().toUpperCase()]
      );
      if (referrer) referrerId = referrer.id;
    }

    // Generate unique referral code for the new user
    const myReferralCode = await generateUniqueCode();

    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password, balance, email_verified, verification_token, referral_code, referred_by) VALUES (?, ?, ?, 0.00, ?, ?, ?, ?)',
      [username, email, hash, emailVerified, verificationToken, myReferralCode, referrerId]
    );

    if (SMTP_CONFIGURED) {
      sendVerificationEmail(email, username, verificationToken).catch(e =>
        console.error('[Mailer] Failed to send verification email:', e.message)
      );
      return res.status(201).json({ requiresVerification: true });
    }

    const user = { id: result.insertId, username, email, balance: 0 };
    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── GET /auth/verify-email ───────────────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ message: 'Token missing.' });

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, balance FROM users WHERE verification_token = ? LIMIT 1',
      [token]
    );
    if (rows.length === 0)
      return res.status(400).json({ message: 'Invalid or expired token.' });

    const user = rows[0];
    await pool.execute(
      'UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?',
      [user.id]
    );

    const safe = { id: user.id, username: user.username, email: user.email, balance: parseFloat(user.balance) };
    res.json({ token: makeToken(safe), user: safe });
  } catch (err) {
    console.error('verify-email error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? LIMIT 1', [email]
    );
    if (rows.length === 0)
      return res.status(401).json({ message: 'Invalid credentials.' });

    const user = rows[0];
    const ok   = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ message: 'Invalid credentials.' });

    if (SMTP_CONFIGURED && !user.email_verified)
      return res.status(403).json({ message: 'Please verify your email before logging in.' });

    const safe = { id: user.id, username: user.username, email: user.email, balance: user.balance, is_admin: user.is_admin === 1 };
    res.json({ token: makeToken(safe), user: safe });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, balance, games_played, games_won, is_admin, avatar_color, avatar_icon, referral_code FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    const u = rows[0];
    res.json({ ...u, is_admin: u.is_admin === 1 });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── GET /auth/profile ────────────────────────────────────────────────────────
router.get('/profile', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, balance, games_played, games_won, avatar_color, avatar_icon, referral_code FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    const u = rows[0];

    const [themeRows] = await pool.execute(
      'SELECT theme, COUNT(*) as count FROM game_history WHERE user_id = ? GROUP BY theme',
      [req.user.id]
    );
    const themeStats = {};
    themeRows.forEach(r => { themeStats[r.theme] = r.count; });

    const [wonRow]  = await pool.execute(
      "SELECT COALESCE(SUM(bet),0) as total FROM game_history WHERE user_id = ? AND result = 'win'",
      [req.user.id]
    );
    const [lostRow] = await pool.execute(
      "SELECT COALESCE(SUM(bet),0) as total FROM game_history WHERE user_id = ? AND result = 'loss'",
      [req.user.id]
    );
    const [drawRow] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM game_history WHERE user_id = ? AND result = 'draw'",
      [req.user.id]
    );

    res.json({
      ...u,
      wins:      u.games_won,
      losses:    u.games_played - u.games_won - (drawRow[0]?.cnt || 0),
      draws:     drawRow[0]?.cnt || 0,
      totalWon:  parseFloat(wonRow[0]?.total  || 0),
      totalLost: parseFloat(lostRow[0]?.total || 0),
      themeStats,
    });
  } catch (err) {
    console.error('profile error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── PATCH /auth/avatar ────────────────────────────────────────────────────────
router.patch('/avatar', auth, async (req, res) => {
  const icon = parseInt(req.body.avatar_icon);
  if (isNaN(icon) || icon < 0 || icon > 8) return res.status(400).json({ message: 'Invalid icon.' });
  try {
    await pool.execute('UPDATE users SET avatar_icon=? WHERE id=?', [icon, req.user.id]);
    res.json({ avatar_icon: icon });
  } catch (err) {
    res.status(500).json({ message: 'Error saving avatar.' });
  }
});

module.exports = router;
