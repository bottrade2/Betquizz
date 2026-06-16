'use strict';
const { pool } = require('../database');

async function randomizeBotAvatars() {
  try {
    await pool.execute(
      'UPDATE users SET avatar_icon = FLOOR(RAND() * 9) WHERE is_bot = 1'
    );
    console.log('[Migration] Bot avatars randomized');
  } catch (err) {
    console.error('[Migration] randomizeBotAvatars error:', err.message);
  }
}

module.exports = { randomizeBotAvatars };
