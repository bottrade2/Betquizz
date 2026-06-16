'use strict';

const { pool } = require('../database');

async function addAdmin() {
  try {
    await pool.execute(
      'UPDATE users SET is_admin = 1 WHERE email = ?',
      ['manellopes1973@gmail.com']
    );
    console.log('[Migration] Admin rights ensured for manellopes1973@gmail.com');
  } catch (err) {
    console.error('[Migration] addAdmin error:', err.message);
  }
}

module.exports = { addAdmin };
