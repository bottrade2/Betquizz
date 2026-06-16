'use strict';

const { pool }      = require('../database');
const { createBot } = require('../bot/botEngine');

const DIFFICULTIES  = ['facil', 'medio', 'dificil'];
const BETS          = [2, 3, 5, 10, 15, 20, 25, 50, 75, 100];
const BOT_PLAYER_ID = 0;

const CHURN_MIN = 1;
const CHURN_MAX = 3;

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function ensureDMBotRooms(min = 8, max = 12) {
  try {
    // Remove stale bot rooms (5-minute hard limit)
    await pool.execute(
      `DELETE FROM duel_math_rooms
       WHERE status = 'waiting' AND player1_id = ${BOT_PLAYER_ID}
         AND created_at < NOW() - INTERVAL 5 MINUTE`
    );

    // Churn: randomly remove a few rooms so new ones appear in their place
    const churn = randomInt(CHURN_MIN, CHURN_MAX);
    await pool.execute(
      `DELETE FROM duel_math_rooms
       WHERE status = 'waiting' AND player1_id = ${BOT_PLAYER_ID}
       ORDER BY RAND() LIMIT ${churn}`
    );

    // Count remaining and fill to target
    const target = randomInt(min, max);
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM duel_math_rooms
       WHERE status = 'waiting' AND player1_id = ${BOT_PLAYER_ID}`
    );
    const existing = parseInt(countRows[0].cnt, 10);
    const needed   = Math.max(0, target - existing);

    console.log(`[DMBotRooms] churned=${churn} existing=${existing} target=${target} needed=${needed}`);

    for (let i = 0; i < needed; i++) {
      const difficulty = randomItem(DIFFICULTIES);
      const bet        = randomItem(BETS);
      const bot        = createBot(difficulty);

      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        const [ex] = await pool.execute('SELECT id FROM duel_math_rooms WHERE room_code = ?', [candidate]);
        if (ex.length === 0) { code = candidate; break; }
      }
      if (!code) continue;

      await pool.execute(
        `INSERT INTO duel_math_rooms
           (room_code, player1_id, player1_username, difficulty, bet, status)
         VALUES (?, ?, ?, ?, ?, 'waiting')`,
        [code, BOT_PLAYER_ID, bot.username, difficulty, bet]
      );
    }
  } catch (err) {
    console.error('[DMBotRooms] Error:', err.message || err);
  }
}

function startDMBotCreator(min = 8, max = 12, intervalMs = 8000) {
  setTimeout(() => ensureDMBotRooms(min, max), 3500);
  setInterval(() => ensureDMBotRooms(min, max), intervalMs);
}

module.exports = { startDMBotCreator };
