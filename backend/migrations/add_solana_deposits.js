'use strict';

const { pool } = require('../database');

async function addSolanaDeposits() {
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN deposit_address VARCHAR(44) DEFAULT NULL`);
    console.log('[Migration] Added deposit_address column to users');
  } catch (e) {
    if (!e.message.includes('Duplicate column')) throw e;
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS deposits (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        tx_signature    VARCHAR(100) NOT NULL UNIQUE,
        amount_sol      DECIMAL(18, 9) NOT NULL,
        amount_eur      DECIMAL(10, 2) NOT NULL,
        sol_price_eur   DECIMAL(10, 2) NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('[Migration] deposits table ready');
  } catch (e) {
    console.error('[Migration] addSolanaDeposits:', e.message);
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        to_address      VARCHAR(44) NOT NULL,
        tx_signature    VARCHAR(100) DEFAULT NULL,
        amount_eur      DECIMAL(10, 2) NOT NULL,
        amount_sol      DECIMAL(18, 9) NOT NULL,
        sol_price_eur   DECIMAL(10, 2) NOT NULL,
        status          ENUM('pending','sent','failed') DEFAULT 'pending',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('[Migration] withdrawals table ready');
  } catch (e) {
    console.error('[Migration] addWithdrawals:', e.message);
  }
}

module.exports = { addSolanaDeposits };
