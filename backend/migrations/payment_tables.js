const { pool } = require('../database');

async function createPaymentTables() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      INT NOT NULL,
        stripe_id    VARCHAR(255) UNIQUE,
        package_id   VARCHAR(50),
        coins        INT NOT NULL,
        amount_cents INT NOT NULL,
        status       ENUM('pending','completed','failed') DEFAULT 'pending',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    console.log('Payment tables ready');
  } catch (err) {
    console.error('Payment tables error:', err.message);
  }
}

module.exports = { createPaymentTables };
