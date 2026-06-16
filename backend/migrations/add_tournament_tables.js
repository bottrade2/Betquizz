'use strict';
const { pool } = require('../database');

async function addTournamentTables() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        code            VARCHAR(10) UNIQUE NOT NULL,
        size            TINYINT DEFAULT 8,
        entry_fee       DECIMAL(10,2) NOT NULL,
        prize_pool      DECIMAL(10,2) DEFAULT 0,
        status          ENUM('waiting','playing','finished') DEFAULT 'waiting',
        current_round   TINYINT DEFAULT 0,
        total_rounds    TINYINT DEFAULT 3,
        winner_id       INT DEFAULT NULL,
        winner_username VARCHAR(50) DEFAULT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_status (status)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS tournament_players (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        tournament_id    INT NOT NULL,
        user_id          INT NOT NULL,
        username         VARCHAR(50) NOT NULL,
        seed             TINYINT DEFAULT NULL,
        is_bot           TINYINT(1) DEFAULT 0,
        bot_difficulty   VARCHAR(10) DEFAULT NULL,
        status           ENUM('active','eliminated','winner') DEFAULT 'active',
        eliminated_round TINYINT DEFAULT NULL,
        UNIQUE KEY uq_player (tournament_id, user_id),
        INDEX idx_tournament (tournament_id)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS tournament_matches (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        tournament_id    INT NOT NULL,
        round            TINYINT NOT NULL,
        match_num        TINYINT NOT NULL,
        player1_id       INT DEFAULT NULL,
        player1_username VARCHAR(50) DEFAULT NULL,
        player2_id       INT DEFAULT NULL,
        player2_username VARCHAR(50) DEFAULT NULL,
        winner_id        INT DEFAULT NULL,
        status           ENUM('pending','playing','finished') DEFAULT 'pending',
        p1_score         INT DEFAULT 0,
        p2_score         INT DEFAULT 0,
        INDEX idx_tid_round (tournament_id, round)
      )
    `);

    console.log('[Migration] tournament tables ready');
  } catch (err) {
    console.error('[Migration] addTournamentTables:', err.message);
  }
}

module.exports = { addTournamentTables };
