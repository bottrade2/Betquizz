'use strict';
const { pool } = require('../database');

async function addAvatar() {
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN avatar_color VARCHAR(7) NOT NULL DEFAULT '#6366f1'`);
  } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN avatar_icon TINYINT NOT NULL DEFAULT 0`);
  } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  console.log('[Migration] avatar columns ready');
}

module.exports = { addAvatar };
