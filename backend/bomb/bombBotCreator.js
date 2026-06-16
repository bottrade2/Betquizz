'use strict';

const { pool }         = require('../database');
const { createBot }    = require('../bot/botEngine');
const { createBotRoom, games } = require('./bombSocket');

const BETS         = [2, 3, 5, 10, 15, 20, 25, 50];
const DIFFICULTIES = ['facil', 'medio', 'dificil'];
const BOT_HOST_ID  = 0;
const CHURN_MIN    = 1;
const CHURN_MAX    = 3;

let botIdCounter = -1; // negative IDs for bots

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function nextBotId() { return botIdCounter--; }

async function ensureBombBotRooms(min = 6, max = 10) {
  try {
    // Remove stale bot rooms
    await pool.execute(
      `DELETE FROM bomb_rooms WHERE status = 'waiting' AND host_id = ${BOT_HOST_ID} AND created_at < NOW() - INTERVAL 5 MINUTE`
    );

    // Churn
    const churn = randomInt(CHURN_MIN, CHURN_MAX);
    await pool.execute(
      `DELETE FROM bomb_rooms WHERE status = 'waiting' AND host_id = ${BOT_HOST_ID} ORDER BY RAND() LIMIT ${churn}`
    );

    const target = randomInt(min, max);
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM bomb_rooms WHERE status = 'waiting' AND host_id = ${BOT_HOST_ID}`
    );
    const existing = parseInt(countRows[0].cnt, 10);
    const needed   = Math.max(0, target - existing);

    console.log(`[BombBots] churned=${churn} existing=${existing} target=${target} needed=${needed}`);

    for (let i = 0; i < needed; i++) {
      const bet       = randomItem(BETS);
      const botCount  = randomInt(2, 4); // 2-4 bots in room (1 slot open for human)
      const bots      = Array.from({ length: botCount }, () => {
        const diff = randomItem(DIFFICULTIES);
        const b    = createBot(diff);
        return { ...b, id: nextBotId() };
      });

      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        const [ex] = await pool.execute('SELECT id FROM bomb_rooms WHERE room_code = ?', [candidate]);
        if (!ex.length) { code = candidate; break; }
      }
      if (!code) continue;

      await pool.execute(
        'INSERT INTO bomb_rooms (room_code, host_id, bet, bot_count) VALUES (?,?,?,?)',
        [code, BOT_HOST_ID, bet, botCount]
      );

      // Pre-populate in-memory game state with bots
      createBotRoom(code, bet, bots);
    }

    // Clean up in-memory states for rooms that were deleted from DB
    for (const [code, game] of games.entries()) {
      if (game.isBot && game.status === 'waiting') {
        const [rows] = await pool.execute('SELECT id FROM bomb_rooms WHERE room_code = ?', [code]);
        if (!rows.length) games.delete(code);
      }
    }
  } catch (err) {
    console.error('[BombBots] Error:', err.message || err);
  }
}

function startBombBotCreator(min = 6, max = 10, intervalMs = 10000) {
  setTimeout(() => ensureBombBotRooms(min, max), 4000);
  setInterval(() => ensureBombBotRooms(min, max), intervalMs);
}

module.exports = { startBombBotCreator };
