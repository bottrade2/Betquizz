'use strict';

const { pool } = require('../database');

async function addEmailVerification() {
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 1`);
    console.log('[Migration] email_verified column added');
  } catch (e) {
    if (!e.message.includes('Duplicate column')) throw e;
  }

  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN verification_token VARCHAR(64) DEFAULT NULL`);
    console.log('[Migration] verification_token column added');
  } catch (e) {
    if (!e.message.includes('Duplicate column')) throw e;
  }
}

module.exports = { addEmailVerification };
