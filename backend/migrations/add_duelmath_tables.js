'use strict';
const { pool } = require('../database');

async function addDuelMathTables() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS duel_math_rooms (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        room_code        VARCHAR(10) UNIQUE NOT NULL,
        player1_id       INT,
        player1_username VARCHAR(50),
        difficulty       VARCHAR(10) DEFAULT 'medio',
        player2_id       INT DEFAULT NULL,
        player2_username VARCHAR(50) DEFAULT NULL,
        bet              DECIMAL(10,2) DEFAULT 10,
        status           ENUM('waiting','playing','finished') DEFAULT 'waiting',
        winner_id        INT DEFAULT NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_status (status)
      )
    `);
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS duel_math_history (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        room_code    VARCHAR(10),
        player1_id   INT,
        player2_id   INT,
        winner_id    INT DEFAULT NULL,
        bet          DECIMAL(10,2),
        p1_score     INT DEFAULT 0,
        p2_score     INT DEFAULT 0,
        p1_correct   INT DEFAULT 0,
        p2_correct   INT DEFAULT 0,
        p1_wrong     INT DEFAULT 0,
        p2_wrong     INT DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_p1 (player1_id),
        INDEX idx_p2 (player2_id)
      )
    `);
    // Add difficulty column if it doesn't exist yet (table may have been created without it)
    await pool.execute(`
      ALTER TABLE duel_math_rooms
        ADD COLUMN IF NOT EXISTS difficulty VARCHAR(10) DEFAULT 'medio'
    `).catch(() => {});

    console.log('[Migration] duel_math tables ready');
  } catch (err) {
    console.error('[Migration] addDuelMathTables:', err.message);
  }
}

module.exports = { addDuelMathTables };
