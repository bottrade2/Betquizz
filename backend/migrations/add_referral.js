'use strict';
const { pool } = require('../database');

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars, ex: A3KX9P
}

async function generateUniqueCode() {
  for (let i = 0; i < 20; i++) {
    const c = genCode();
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) as n FROM users WHERE referral_code = ?', [c]);
    if (n === 0) return c;
  }
  return null;
}

async function addReferral() {
  try { await pool.execute(`ALTER TABLE users ADD COLUMN referral_code VARCHAR(8) UNIQUE`); } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  try { await pool.execute(`ALTER TABLE users ADD COLUMN referred_by INT DEFAULT NULL`); } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  try { await pool.execute(`ALTER TABLE users ADD COLUMN referral_bonus_paid TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  try { await pool.execute(`ALTER TABLE deposits ADD COLUMN referral_code VARCHAR(8) DEFAULT NULL`); } catch (e) { if (!e.message.includes('Duplicate')) throw e; }

  // Generate codes for existing users without one
  const [users] = await pool.execute('SELECT id FROM users WHERE referral_code IS NULL');
  for (const u of users) {
    const code = await generateUniqueCode();
    if (code) await pool.execute('UPDATE users SET referral_code = ? WHERE id = ?', [code, u.id]);
  }

  console.log('[Migration] referral columns ready');
}

module.exports = { addReferral, generateUniqueCode };
