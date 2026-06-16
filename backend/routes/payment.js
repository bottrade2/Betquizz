const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const { pool } = require('../database');
const { getOperatorAddress, checkUserDeposits, getSolEurPrice, sendWithdrawal } = require('../utils/solana');

// Stripe é opcional — só inicializa se a chave existir
let stripe = null;
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_')) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch {}
}

const COIN_PACKAGES = [
  { id: 'coins_100',  coins: 100,  price: 99,   label: '100 moedas' },
  { id: 'coins_500',  coins: 500,  price: 399,  label: '500 moedas' },
  { id: 'coins_1000', coins: 1000, price: 699,  label: '1000 moedas' },
  { id: 'coins_2500', coins: 2500, price: 1499, label: '2500 moedas' },
];

// ── GET /payment/packages ────────────────────────────────────────────────────
router.get('/packages', auth, (req, res) => {
  res.json(COIN_PACKAGES);
});

// ── POST /payment/create-checkout ───────────────────────────────────────────
router.post('/create-checkout', auth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ message: 'Payments not configured.' });
  }

  const { packageId } = req.body;
  const pkg = COIN_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ message: 'Invalid package.' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `BetQuizz — ${pkg.label}` },
          unit_amount: pkg.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/profile?payment=success`,
      cancel_url:  `${process.env.CLIENT_URL}/profile?payment=cancelled`,
      metadata: {
        user_id:  String(req.user.id),
        coins:    String(pkg.coins),
        pkg_id:   pkg.id,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('checkout error:', err);
    res.status(500).json({ message: 'Error creating payment session.' });
  }
});

// ── POST /payment/webhook ────────────────────────────────────────────────────
// Note: needs express.raw() BEFORE express.json() — already set in server.js
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      const userId = parseInt(session.metadata.user_id, 10);
      const coins  = parseInt(session.metadata.coins, 10);

      try {
        await pool.execute(
          'UPDATE users SET balance = balance + ? WHERE id = ?',
          [coins, userId]
        );
        console.log(`Credited ${coins} coins to user ${userId}`);
      } catch (err) {
        console.error('Webhook DB error:', err);
      }
    }
  }

  res.sendStatus(200);
});

// ── GET /payment/deposit-address ────────────────────────────────────────────
router.get('/deposit-address', auth, async (req, res) => {
  try {
    const address  = getOperatorAddress();
    const solPrice = await getSolEurPrice();
    res.json({ address, solPrice });
  } catch (err) {
    console.error('deposit-address error:', err);
    res.status(500).json({ message: 'Error getting deposit address.' });
  }
});

// ── POST /payment/deposit-check ──────────────────────────────────────────────
router.post('/deposit-check', auth, async (req, res) => {
  try {
    const [[before]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    await checkUserDeposits(req.user.id);
    const [[after]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    const credited = parseFloat(after.balance) - parseFloat(before.balance);
    res.json({ balance: parseFloat(after.balance), credited: Math.round(credited * 100) / 100 });
  } catch (err) {
    console.error('deposit-check error:', err);
    res.status(500).json({ message: 'Error checking deposits.' });
  }
});

// ── GET /payment/deposit-history ─────────────────────────────────────────────
router.get('/deposit-history', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT amount_sol, amount_eur, sol_price_eur, created_at FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error loading history.' });
  }
});

// ── GET /payment/transactions ─────────────────────────────────────────────────
router.get('/transactions', auth, async (req, res) => {
  try {
    const [deposits] = await pool.execute(
      `SELECT 'deposit' AS type, amount_eur, amount_sol, tx_signature, NULL AS status, created_at
       FROM deposits WHERE user_id = ?`,
      [req.user.id]
    );
    const [withdrawals] = await pool.execute(
      `SELECT 'withdrawal' AS type, amount_eur, amount_sol, tx_signature, status, created_at
       FROM withdrawals WHERE user_id = ?`,
      [req.user.id]
    );
    const all = [...deposits, ...withdrawals]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
    res.json(all);
  } catch (err) {
    res.status(500).json({ message: 'Error loading transactions.' });
  }
});

// ── POST /payment/deposit ────────────────────────────────────────────────────
router.post('/deposit', auth, async (req, res) => {
  const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
  if (isNaN(amount) || amount < 10) {
    return res.status(400).json({ message: 'Minimum deposit of €10.' });
  }
  try {
    await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, req.user.id]);
    const [[row]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    res.json({ balance: parseFloat(row.balance) });
  } catch (err) {
    console.error('deposit error:', err);
    res.status(500).json({ message: 'Error processing deposit.' });
  }
});

// ── POST /payment/withdraw ───────────────────────────────────────────────────
router.post('/withdraw', auth, async (req, res) => {
  const amount    = Math.round(parseFloat(req.body.amount) * 100) / 100;
  const toAddress = (req.body.to_address || '').trim();

  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount.' });
  }
  if (amount < 50) {
    return res.status(400).json({ message: 'Minimum withdrawal is €50 per transaction.' });
  }
  if (!toAddress || toAddress.length < 32 || toAddress.length > 44) {
    return res.status(400).json({ message: 'Invalid Solana address.' });
  }

  try {
    const { signature, solAmount, solPrice } = await sendWithdrawal(req.user.id, toAddress, amount);
    const [[updated]] = await pool.execute('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    res.json({
      balance:   parseFloat(updated.balance),
      signature,
      sol_amount: solAmount,
      sol_price:  solPrice,
    });
  } catch (err) {
    console.error('withdraw error:', err);
    const msg = err.message || 'Error processing withdrawal.';
    res.status(400).json({ message: msg });
  }
});

module.exports = router;
