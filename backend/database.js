const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:             process.env.DB_HOST     || 'localhost',
  port:             parseInt(process.env.DB_PORT || '3306'),
  user:             process.env.DB_USER     || 'root',
  password:         process.env.DB_PASSWORD || '',
  database:         process.env.DB_NAME     || 'betquizz',
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
});

async function initDatabase() {
  // Attempt to create the database — skipped silently on managed hosts (Railway)
  // where the DB already exists and the user lacks server-level CREATE privilege.
  try {
    const tempConn = await mysql.createConnection({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '3306'),
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
    });
    await tempConn.execute(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'betquizz'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await tempConn.end();
  } catch (e) {
    console.log('[DB] CREATE DATABASE skipped:', e.message);
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      username     VARCHAR(20)  NOT NULL UNIQUE,
      email        VARCHAR(255) NOT NULL UNIQUE,
      password     VARCHAR(255) NOT NULL,
      balance      DECIMAL(10,2) DEFAULT 100.00,
      games_played INT DEFAULT 0,
      games_won    INT DEFAULT 0,
      is_admin     TINYINT(1) DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS rooms (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      room_code           VARCHAR(6)  NOT NULL UNIQUE,
      player1_id          INT,
      player1_username    VARCHAR(20),
      player1_score       INT DEFAULT 0,
      player1_answers     JSON,
      player2_id          INT,
      player2_username    VARCHAR(20),
      player2_score       INT DEFAULT 0,
      player2_answers     JSON,
      theme               VARCHAR(30) NOT NULL,
      difficulty          VARCHAR(10) DEFAULT 'facil',
      bet                 DECIMAL(10,2) NOT NULL,
      status              ENUM('waiting','playing','finished') DEFAULT 'waiting',
      current_question    INT DEFAULT 0,
      questions           JSON,
      winner_id           INT,
      vs_bot              TINYINT(1) DEFAULT 0,
      bot_difficulty      VARCHAR(10) NULL,
      language            VARCHAR(5) DEFAULT 'pt',
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Idempotent migration: add language column to existing rooms tables
  try {
    await pool.execute(`ALTER TABLE rooms ADD COLUMN language VARCHAR(5) DEFAULT 'pt'`);
  } catch (e) {
    if (!e.message.includes('Duplicate column')) throw e;
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS game_history (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      user_id        INT NOT NULL,
      room_code      VARCHAR(6),
      opponent       VARCHAR(20),
      result         ENUM('win','loss','draw') NOT NULL,
      bet            DECIMAL(10,2) NOT NULL,
      score          INT DEFAULT 0,
      opponent_score INT DEFAULT 0,
      theme          VARCHAR(30),
      difficulty     VARCHAR(10),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      room_code  VARCHAR(6)   NOT NULL,
      username   VARCHAR(20)  NOT NULL,
      message    VARCHAR(200) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('MySQL tables initialised');
}

module.exports = { pool, initDatabase };
