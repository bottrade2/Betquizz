'use strict';

const { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const bs58  = require('bs58');
const crypto = require('crypto');
const https  = require('https');
const { pool } = require('../database');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

let _io = null;
function setIo(io) { _io = io; }

// ── Price cache (refresh every 60s) ──────────────────────────────────────────
let _solPrice    = null;
let _priceAt     = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getSolEurPrice() {
  if (_solPrice && Date.now() - _priceAt < 60_000) return _solPrice;
  try {
    const data = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur'
    );
    _solPrice = parseFloat(data.solana.eur);
    _priceAt  = Date.now();
    return _solPrice;
  } catch {
    return _solPrice; // return stale if network fails
  }
}

// ── Per-user keypair derived from master seed ─────────────────────────────────
function getUserKeypair(userId) {
  if (!process.env.SOLANA_MASTER_SEED) throw new Error('SOLANA_MASTER_SEED not set');
  const master = Buffer.from(process.env.SOLANA_MASTER_SEED, 'hex');
  const seed   = crypto.createHmac('sha256', master).update(`deposit:${userId}`).digest();
  return Keypair.fromSeed(seed);
}

async function getOrCreateDepositAddress(userId) {
  const [[row]] = await pool.execute('SELECT deposit_address FROM users WHERE id = ?', [userId]);
  if (row?.deposit_address) return row.deposit_address;

  const address = getUserKeypair(userId).publicKey.toBase58();
  await pool.execute('UPDATE users SET deposit_address = ? WHERE id = ?', [address, userId]);
  return address;
}

// ── Check blockchain for new incoming SOL ─────────────────────────────────────
async function checkUserDeposits(userId) {
  try {
    const address = await getOrCreateDepositAddress(userId);
    const pubkey  = new PublicKey(address);
    const sigs    = await connection.getSignaturesForAddress(pubkey, { limit: 20 });

    for (const sigInfo of sigs) {
      if (sigInfo.err) continue;

      const [existing] = await pool.execute(
        'SELECT id FROM deposits WHERE tx_signature = ?', [sigInfo.signature]
      );
      if (existing.length > 0) continue;

      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx?.meta) continue;

      const keys   = tx.transaction.message.accountKeys;
      const idx    = keys.findIndex(k => k.pubkey.toBase58() === address);
      if (idx === -1) continue;

      const received = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
      if (received <= 0) continue;

      const solAmount = received / LAMPORTS_PER_SOL;
      if (solAmount < 0.001) continue; // ignore dust

      const solPrice = await getSolEurPrice();
      if (!solPrice) continue;

      const eurAmount = Math.round(solAmount * solPrice * 100) / 100;

      await pool.execute(
        'UPDATE users SET balance = balance + ? WHERE id = ?', [eurAmount, userId]
      );
      await pool.execute(
        'INSERT INTO deposits (user_id, tx_signature, amount_sol, amount_eur, sol_price_eur) VALUES (?,?,?,?,?)',
        [userId, sigInfo.signature, solAmount, eurAmount, solPrice]
      );

      // ── Referral bonus: pay 10€ to both on first deposit ─────────────────
      const [[userRef]] = await pool.execute(
        'SELECT referred_by, referral_bonus_paid, referral_code FROM users WHERE id = ?', [userId]
      );
      if (userRef && userRef.referred_by && !userRef.referral_bonus_paid) {
        const BONUS = 10;
        // Give bonus to referred user (the depositor)
        await pool.execute('UPDATE users SET balance = balance + ?, referral_bonus_paid = 1 WHERE id = ?', [BONUS, userId]);
        // Give bonus to referrer
        await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [BONUS, userRef.referred_by]);
        // Update deposit row with referral code
        await pool.execute(
          'UPDATE deposits SET referral_code = ? WHERE user_id = ? AND tx_signature = ?',
          [userRef.referral_code, userId, sigInfo.signature]
        );
        // Notify referrer
        if (_io) {
          _io.to(`user_${userRef.referred_by}`).emit('referral:bonus', { amount: BONUS, username: (await pool.execute('SELECT username FROM users WHERE id = ?', [userId]))[0][0]?.username });
        }
        console.log(`[Referral] Bonus ${BONUS}€ paid to user ${userId} and referrer ${userRef.referred_by}`);
      }

      // Fetch updated balance and notify user via socket instantly
      const [[u]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);
      if (_io && u) {
        _io.to(`user_${userId}`).emit('deposit:credited', {
          amount_sol: solAmount,
          amount_eur: eurAmount,
          balance: parseFloat(u.balance),
        });
      }

      console.log(`[Solana] User ${userId}: +${solAmount} SOL = +${eurAmount}€ (tx: ${sigInfo.signature.slice(0,12)}...)`);
    }
  } catch (err) {
    console.error(`[Solana] checkUserDeposits(${userId}):`, err.message);
  }
}

// ── Background job: check all users with a deposit address ───────────────────
async function checkAllDeposits() {
  try {
    const [rows] = await pool.execute(
      `SELECT id FROM users WHERE deposit_address IS NOT NULL AND (is_bot = 0 OR is_bot IS NULL)`
    );
    for (const row of rows) {
      await checkUserDeposits(row.id);
      await new Promise(r => setTimeout(r, 400)); // avoid RPC rate-limit
    }
  } catch (err) {
    console.error('[Solana] checkAllDeposits:', err.message);
  }
}

function startDepositWatcher(intervalMs = 30_000) {
  setTimeout(checkAllDeposits, 5_000);
  setInterval(checkAllDeposits, intervalMs);
  console.log(`[Solana] Deposit watcher started (every ${intervalMs / 1000}s)`);
}

// ── Send SOL withdrawal ───────────────────────────────────────────────────────
function getWithdrawalKeypair() {
  if (!process.env.SOLANA_WITHDRAWAL_KEYPAIR) throw new Error('SOLANA_WITHDRAWAL_KEYPAIR not set');
  const decoded = bs58.decode(process.env.SOLANA_WITHDRAWAL_KEYPAIR);
  return Keypair.fromSecretKey(decoded);
}

async function sendWithdrawal(userId, toAddress, eurAmount) {
  const solPrice = await getSolEurPrice();
  if (!solPrice) throw new Error('Could not fetch SOL price');

  const solAmount = eurAmount / solPrice;
  const lamports  = Math.floor(solAmount * LAMPORTS_PER_SOL);
  if (lamports < 5000) throw new Error('Amount too small to cover transaction fees');

  const fromKeypair = getWithdrawalKeypair();
  const toPubkey    = new PublicKey(toAddress);

  // Check operator balance
  const operatorBalance = await connection.getBalance(fromKeypair.publicKey);
  if (operatorBalance < lamports + 5000) throw new Error('Operator wallet has insufficient SOL');

  // Deduct EUR from user balance first
  const [[row]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [userId]);
  if (parseFloat(row.balance) < eurAmount) throw new Error('Insufficient balance');
  await pool.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [eurAmount, userId]);

  // Record withdrawal as pending
  const [result] = await pool.execute(
    'INSERT INTO withdrawals (user_id, to_address, amount_eur, amount_sol, sol_price_eur, status) VALUES (?,?,?,?,?,?)',
    [userId, toAddress, eurAmount, solAmount, solPrice, 'pending']
  );
  const withdrawalId = result.insertId;

  try {
    const transaction = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: fromKeypair.publicKey, toPubkey, lamports })
    );
    const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);

    await pool.execute(
      'UPDATE withdrawals SET tx_signature = ?, status = ? WHERE id = ?',
      [signature, 'sent', withdrawalId]
    );

    console.log(`[Solana] Withdrawal user ${userId}: ${eurAmount}€ = ${solAmount.toFixed(6)} SOL → ${toAddress} (${signature.slice(0,12)}...)`);
    return { signature, solAmount, solPrice };
  } catch (err) {
    // Refund on failure
    await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [eurAmount, userId]);
    await pool.execute('UPDATE withdrawals SET status = ? WHERE id = ?', ['failed', withdrawalId]);
    throw err;
  }
}

// ── Sweep deposit wallets → operator wallet ───────────────────────────────────
const MIN_SWEEP_LAMPORTS = 10_000; // ~0.00001 SOL minimum to bother sweeping
const FEE_RESERVE        =  5_000; // lamports reserved for the tx fee

async function sweepUserDeposit(userId, depositAddress) {
  try {
    const pubkey  = new PublicKey(depositAddress);
    const balance = await connection.getBalance(pubkey);
    if (balance < MIN_SWEEP_LAMPORTS) return;

    const lamportsToSend = balance - FEE_RESERVE;
    if (lamportsToSend <= 0) return;

    const fromKeypair   = getUserKeypair(userId);
    const operatorKey   = getWithdrawalKeypair();
    const toPubkey      = operatorKey.publicKey;

    const transaction = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: pubkey, toPubkey, lamports: lamportsToSend })
    );
    const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
    const solSent   = lamportsToSend / LAMPORTS_PER_SOL;
    console.log(`[Solana] Swept ${solSent.toFixed(6)} SOL from user ${userId} → operator (${signature.slice(0, 12)}...)`);
  } catch (err) {
    console.error(`[Solana] sweepUserDeposit(${userId}):`, err.message);
  }
}

async function sweepAllDeposits() {
  if (!process.env.SOLANA_WITHDRAWAL_KEYPAIR) return; // silently skip if not configured
  try {
    const [rows] = await pool.execute(
      `SELECT id, deposit_address FROM users WHERE deposit_address IS NOT NULL AND (is_bot = 0 OR is_bot IS NULL)`
    );
    for (const row of rows) {
      await sweepUserDeposit(row.id, row.deposit_address);
      await new Promise(r => setTimeout(r, 500)); // avoid RPC rate-limit
    }
  } catch (err) {
    console.error('[Solana] sweepAllDeposits:', err.message);
  }
}

function startSweeper(intervalMs = 10 * 60 * 1000) {
  // First sweep 60s after startup (after deposit watcher has run)
  setTimeout(sweepAllDeposits, 60_000);
  setInterval(sweepAllDeposits, intervalMs);
  console.log(`[Solana] Sweep watcher started (every ${intervalMs / 60000} min)`);
}

function getOperatorAddress() {
  if (!process.env.SOLANA_WITHDRAWAL_KEYPAIR) throw new Error('SOLANA_WITHDRAWAL_KEYPAIR not set');
  return getWithdrawalKeypair().publicKey.toBase58();
}

module.exports = { getOrCreateDepositAddress, getOperatorAddress, checkUserDeposits, getSolEurPrice, startDepositWatcher, setIo, sendWithdrawal, startSweeper };
