'use strict';
// Run once: node generate-seed.js
// Copy the output to your .env as SOLANA_MASTER_SEED=...
const crypto = require('crypto');
const seed = crypto.randomBytes(32).toString('hex');
console.log('\nAdd this to your .env file:\n');
console.log(`SOLANA_MASTER_SEED=${seed}\n`);
console.log('Keep this secret — it controls all deposit wallets.\n');
