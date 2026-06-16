'use strict';

const { pool } = require('../database');

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
      AND COLUMN_NAME  = ?
    LIMIT 1
  `, [table, column]);
  return rows.length > 0;
}

async function addBotColumns() {
  const connection = await pool.getConnection();
  try {
    if (!(await columnExists(connection, 'rooms', 'vs_bot'))) {
      await connection.execute(`
        ALTER TABLE rooms
          ADD COLUMN vs_bot TINYINT(1) NOT NULL DEFAULT 0
      `);
      console.log('Added column rooms.vs_bot');
    }

    if (!(await columnExists(connection, 'rooms', 'bot_difficulty'))) {
      await connection.execute(`
        ALTER TABLE rooms
          ADD COLUMN bot_difficulty VARCHAR(10) NULL DEFAULT NULL
      `);
      console.log('Added column rooms.bot_difficulty');
    }

    // Índice opcional — ignorar se já existir
    try {
      await connection.execute(`ALTER TABLE rooms ADD INDEX idx_vs_bot (vs_bot)`);
    } catch (_) {}

    // Remover FKs em player1_id / player2_id / winner_id caso existam
    // (bots usam player1_id=0 / player2_id=0, que viola FKs para a tabela users)
    for (const col of ['player1_id', 'player2_id', 'winner_id']) {
      try {
        const [fkRows] = await connection.execute(`
          SELECT CONSTRAINT_NAME
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA        = DATABASE()
            AND TABLE_NAME          = 'rooms'
            AND COLUMN_NAME         = ?
            AND REFERENCED_TABLE_NAME = 'users'
          LIMIT 1
        `, [col]);
        if (fkRows.length > 0) {
          const fkName = fkRows[0].CONSTRAINT_NAME;
          await connection.execute(`ALTER TABLE rooms DROP FOREIGN KEY \`${fkName}\``);
          console.log(`Dropped FK ${fkName} on rooms.${col}`);
        }
      } catch (_) {}
    }

    console.log('Bot columns migration complete');
  } finally {
    connection.release();
  }
}

module.exports = { addBotColumns };
