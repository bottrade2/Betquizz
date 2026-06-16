require('dotenv').config({ path: '../.env' });

// ── Validate required env vars before anything else ───────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[Startup] Missing required env var: ${key}`);
    process.exit(1);
  }
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[Startup] JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { Server } = require('socket.io');
const { initDatabase } = require('./database');

const authRoutes      = require('./routes/auth');
const gameRoutes      = require('./routes/game');
const paymentRoutes   = require('./routes/payment');
const adminRoutes     = require('./routes/admin');
const duelMathRoutes        = require('./routes/duelmath');
const bombRoutes             = require('./routes/bomb');
const createTournamentRouter = require('./routes/tournament');
const setupSocket            = require('./socket');

const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5000',
].filter(Boolean);

function originAllowed(origin, cb) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
  cb(null, true); // allow all — tighten in production if needed
}

const io = new Server(server, {
  cors: { origin: originAllowed, methods: ['GET', 'POST'] },
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));
app.use(cors({ origin: originAllowed, credentials: true }));
app.use(express.json());

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Strict limiter for auth routes — 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { message: 'Too many attempts. Please try again in 15 minutes.' },
});

// General API limiter — 120 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many requests. Please slow down.' },
});

// Admin limiter — 60 requests per minute
const adminLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many admin requests.' },
});

app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin',         adminLimiter);
app.use('/api',               apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/game',      gameRoutes);
app.use('/api/payment',   paymentRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/duelmath',    duelMathRoutes);
app.use('/api/bomb',       bombRoutes);
app.use('/api/tournament', createTournamentRouter(io));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── Serve React build ─────────────────────────────────────────────────────────
const path = require('path');
const frontendBuild = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuild));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return res.status(404).json({ message: 'Not found.' });
  }
  res.sendFile(path.join(frontendBuild, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Express error]', err);
  res.status(500).json({ message: 'Internal server error.' });
});

setupSocket(io);

// ── Global unhandled rejection / exception guards ─────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;

initDatabase()
  .then(async () => {
    console.log('MySQL connected');

    const { createPaymentTables } = require('./migrations/payment_tables');
    await createPaymentTables();

    const { addBotColumns } = require('./migrations/add_bot_columns');
    await addBotColumns();

    const { addBotUsers } = require('./migrations/add_bot_users');
    await addBotUsers();

    const { addAdmin } = require('./migrations/add_admin');
    await addAdmin();

    const { addSolanaDeposits } = require('./migrations/add_solana_deposits');
    await addSolanaDeposits();

    const { addDuelMathTables } = require('./migrations/add_duelmath_tables');
    await addDuelMathTables();

    const { addTournamentTables } = require('./migrations/add_tournament_tables');
    await addTournamentTables();

    const { addEmailVerification } = require('./migrations/add_email_verification');
    await addEmailVerification();

    const { addAvatar } = require('./migrations/add_avatar');
    await addAvatar();

    const { randomizeBotAvatars } = require('./migrations/randomize_bot_avatars');
    await randomizeBotAvatars();

    const { addBombTables } = require('./migrations/add_bomb_tables');
    await addBombTables();

    const { addReferral } = require('./migrations/add_referral');
    await addReferral();

    const { startDepositWatcher, setIo, startSweeper } = require('./utils/solana');
    setIo(io);
    startDepositWatcher(30_000);
    startSweeper(10 * 60 * 1000); // sweep every 10 minutes

    const { startBotRoomCreator } = require('./bot/botRoomCreator');
    startBotRoomCreator(20, 25, 8000);

    const { startDMBotCreator } = require('./duelmath/dmBotCreator');
    startDMBotCreator(8, 12, 8000);

    const { startBombBotCreator } = require('./bomb/bombBotCreator');
    startBombBotCreator(6, 10, 10000);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MySQL connection error:', err);
    process.exit(1);
  });
