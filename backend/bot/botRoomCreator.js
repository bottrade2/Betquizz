'use strict';

const { pool }      = require('../database');
const botManager    = require('./botManager');
const { createBot } = require('./botEngine');

const DIFFICULTIES = ['facil', 'medio', 'dificil'];
const THEMES       = ['geral', 'ciencia', 'historia', 'geografia', 'esportes'];
const BETS         = [2, 3, 5, 10, 15, 20, 25, 50, 75, 100];

const BOT_PLAYER_ID = 0;

// How many rooms to randomly remove each cycle to simulate activity
const CHURN_MIN = 2;
const CHURN_MAX = 5;

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function ensureBotRooms(min = 20, max = 25) {
  try {
    // 1. Clean up legacy bot rooms and stale rooms (safety net, 5 min hard limit)
    await pool.execute(
      `DELETE FROM rooms WHERE status = 'waiting' AND vs_bot = 1 AND player1_id != ${BOT_PLAYER_ID}`
    );
    await pool.execute(
      `DELETE FROM rooms WHERE status = 'waiting' AND player1_id = ${BOT_PLAYER_ID} AND created_at < NOW() - INTERVAL 5 MINUTE`
    );

    // 2. Simulate activity: randomly remove a few rooms so new ones appear in their place
    const churn = randomInt(CHURN_MIN, CHURN_MAX);
    await pool.execute(
      `DELETE FROM rooms WHERE status = 'waiting' AND player1_id = ${BOT_PLAYER_ID}
       ORDER BY RAND() LIMIT ${churn}`
    );

    // 3. Count what remains and fill back up to target
    const target = randomInt(min, max);
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM rooms WHERE status = 'waiting' AND player1_id = ${BOT_PLAYER_ID}`
    );
    const existing = parseInt(countRows[0].cnt, 10);
    const needed   = Math.max(0, target - existing);

    console.log(`[BotRooms] churned=${churn} existing=${existing} target=${target} needed=${needed}`);

    for (let i = 0; i < needed; i++) {
      const difficulty = randomItem(DIFFICULTIES);
      const theme      = randomItem(THEMES);
      const bet        = randomItem(BETS);
      const bot        = createBot(difficulty);

      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        const [ex] = await pool.execute('SELECT id FROM rooms WHERE room_code = ?', [candidate]);
        if (ex.length === 0) { code = candidate; break; }
      }
      if (!code) continue;

      await pool.execute(
        `INSERT INTO rooms
           (room_code, player1_id, player1_username, player1_score, player1_answers,
            theme, difficulty, bet, status, vs_bot)
         VALUES (?, ?, ?, 0, '[]', ?, ?, ?, 'waiting', 1)`,
        [code, BOT_PLAYER_ID, bot.username, theme, difficulty, bet]
      );

      botManager.registerBot(code, difficulty);
    }
  } catch (err) {
    console.error('[BotRooms] Error:', err.message || err);
  }
}

function startBotRoomCreator(min = 20, max = 25, intervalMs = 8000) {
  setTimeout(() => ensureBotRooms(min, max), 3000);
  setInterval(() => ensureBotRooms(min, max), intervalMs);
}

module.exports = { startBotRoomCreator, BOT_PLAYER_ID };
