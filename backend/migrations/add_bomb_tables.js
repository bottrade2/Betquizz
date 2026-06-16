'use strict';
const { pool } = require('../database');

async function addBombTables() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS bomb_rooms (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        room_code  VARCHAR(10) UNIQUE NOT NULL,
        host_id    INT NOT NULL DEFAULT 0,
        bet        DECIMAL(10,2) NOT NULL DEFAULT 5.00,
        bot_count  TINYINT NOT NULL DEFAULT 0,
        status     ENUM('waiting','playing','finished') DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Add bot_count column if migrating from older schema
    try {
      await pool.execute(`ALTER TABLE bomb_rooms ADD COLUMN bot_count TINYINT NOT NULL DEFAULT 0`);
    } catch (e) { if (!e.message.includes('Duplicate')) {} }
    console.log('[Migration] bomb_rooms table ready');
  } catch (err) {
    console.error('[Migration] addBombTables error:', err.message);
  }
}

module.exports = { addBombTables };
