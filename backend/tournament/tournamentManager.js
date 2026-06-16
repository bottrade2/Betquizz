'use strict';

const { pool }      = require('../database');
const { createBot } = require('../bot/botEngine');

const HOUSE_CUT = 0.10;

// Bracket advancement map: NEXT_MATCH[size][round][matchNum] → { nextRound, nextMatchNum, slot }
const NEXT_MATCH = {
  4: {
    1: {
      1: { nextRound: 2, nextMatchNum: 1, slot: 'p1' },
      2: { nextRound: 2, nextMatchNum: 1, slot: 'p2' },
    },
  },
  8: {
    1: {
      1: { nextRound: 2, nextMatchNum: 1, slot: 'p1' },
      2: { nextRound: 2, nextMatchNum: 2, slot: 'p1' },
      3: { nextRound: 2, nextMatchNum: 2, slot: 'p2' },
      4: { nextRound: 2, nextMatchNum: 1, slot: 'p2' },
    },
    2: {
      1: { nextRound: 3, nextMatchNum: 1, slot: 'p1' },
      2: { nextRound: 3, nextMatchNum: 1, slot: 'p2' },
    },
  },
};

const fillTimers = new Map(); // tournamentId → setTimeout handle

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Start tournament (seeds + R1 matches) ────────────────────────────────────

async function startTournament(io, tournamentId) {
  const [[t]] = await pool.execute('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
  if (!t || t.status !== 'waiting') return;

  const [players] = await pool.execute(
    'SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY id ASC',
    [tournamentId]
  );
  if (players.length < 2) return;

  // Assign seeds randomly
  const seeded = shuffle(players);
  for (let i = 0; i < seeded.length; i++) {
    await pool.execute(
      'UPDATE tournament_players SET seed = ? WHERE id = ?', [i + 1, seeded[i].id]
    );
    seeded[i].seed = i + 1;
  }

  // Create round 1 matches using seeded bracket
  const size = seeded.length;
  const matchCount = size / 2;
  for (let i = 0; i < matchCount; i++) {
    const p1 = seeded[i];
    const p2 = seeded[size - 1 - i];
    await pool.execute(
      `INSERT INTO tournament_matches
         (tournament_id, round, match_num, player1_id, player1_username, player2_id, player2_username)
       VALUES (?,?,?,?,?,?,?)`,
      [tournamentId, 1, i + 1, p1.user_id, p1.username, p2.user_id, p2.username]
    );
  }

  await pool.execute(
    "UPDATE tournaments SET status='playing', current_round=1 WHERE id=?", [tournamentId]
  );

  const [r1Matches] = await pool.execute(
    'SELECT * FROM tournament_matches WHERE tournament_id=? AND round=1 ORDER BY match_num',
    [tournamentId]
  );
  const [allPlayers] = await pool.execute(
    'SELECT * FROM tournament_players WHERE tournament_id=? ORDER BY seed', [tournamentId]
  );

  io.to(`t_${tournamentId}`).emit('t:starting', { countdown: 5 });

  setTimeout(() => {
    io.to(`t_${tournamentId}`).emit('t:round_start', {
      round: 1, matches: r1Matches, players: allPlayers,
    });
  }, 5000);
}

// ── Called when a match finishes — advance bracket ───────────────────────────

async function onMatchComplete(io, tournamentId, bracketRound, matchNum, winnerId, winnerUsername) {
  const [[t]] = await pool.execute('SELECT * FROM tournaments WHERE id=?', [tournamentId]);
  if (!t || t.status !== 'playing') return;

  // Mark loser as eliminated
  const [[match]] = await pool.execute(
    'SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND match_num=?',
    [tournamentId, bracketRound, matchNum]
  );
  if (!match) return;

  const loserId = match.player1_id === winnerId ? match.player2_id : match.player1_id;
  if (loserId > 0) {
    await pool.execute(
      "UPDATE tournament_players SET status='eliminated', eliminated_round=? WHERE tournament_id=? AND user_id=?",
      [bracketRound, tournamentId, loserId]
    );
  }

  // Broadcast updated bracket
  const [allMatches] = await pool.execute(
    'SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round, match_num', [tournamentId]
  );
  const [allPlayers] = await pool.execute(
    'SELECT * FROM tournament_players WHERE tournament_id=? ORDER BY seed', [tournamentId]
  );
  io.to(`t_${tournamentId}`).emit('t:bracket_update', { matches: allMatches, players: allPlayers });

  // Check if all matches in this round are done
  const roundMatches = allMatches.filter(m => m.round === bracketRound);
  const allDone = roundMatches.every(m => m.status === 'finished');
  if (!allDone) return;

  // Final round — end tournament
  if (bracketRound >= t.total_rounds) {
    await endTournament(io, tournamentId, winnerId, winnerUsername, t);
    return;
  }

  // Build next round matches from winners
  const nextRound   = bracketRound + 1;
  const nextMap     = NEXT_MATCH[t.size]?.[bracketRound] || {};
  const nextMatches = {}; // { matchNum: { p1, p2 } }

  for (const [mNumStr, info] of Object.entries(nextMap)) {
    const srcMatch = roundMatches.find(m => m.match_num === parseInt(mNumStr));
    if (!srcMatch) continue;
    const wId  = srcMatch.winner_id;
    const wUsr = wId === srcMatch.player1_id ? srcMatch.player1_username : srcMatch.player2_username;
    if (!nextMatches[info.nextMatchNum]) nextMatches[info.nextMatchNum] = {};
    nextMatches[info.nextMatchNum][info.slot] = { id: wId, username: wUsr };
  }

  for (const [nextMatchNum, slots] of Object.entries(nextMatches)) {
    const p1 = slots.p1 || {};
    const p2 = slots.p2 || {};
    await pool.execute(
      `INSERT INTO tournament_matches
         (tournament_id, round, match_num, player1_id, player1_username, player2_id, player2_username)
       VALUES (?,?,?,?,?,?,?)`,
      [tournamentId, nextRound, parseInt(nextMatchNum), p1.id ?? null, p1.username ?? null, p2.id ?? null, p2.username ?? null]
    );
  }

  await pool.execute('UPDATE tournaments SET current_round=? WHERE id=?', [nextRound, tournamentId]);

  const [newRoundMatches] = await pool.execute(
    'SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? ORDER BY match_num',
    [tournamentId, nextRound]
  );

  setTimeout(() => {
    io.to(`t_${tournamentId}`).emit('t:round_start', {
      round: nextRound, matches: newRoundMatches, players: allPlayers,
    });
  }, 4000);
}

// ── End tournament — credit winner ───────────────────────────────────────────

async function endTournament(io, tournamentId, winnerId, winnerUsername, t) {
  const gross = parseFloat(t.prize_pool);
  const prize = Math.floor(gross * (1 - HOUSE_CUT) * 100) / 100;

  if (winnerId > 0) {
    await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [prize, winnerId]);
    await pool.execute(
      "UPDATE tournament_players SET status='winner' WHERE tournament_id=? AND user_id=?",
      [tournamentId, winnerId]
    );
  }

  await pool.execute(
    "UPDATE tournaments SET status='finished', winner_id=?, winner_username=? WHERE id=?",
    [winnerId, winnerUsername, tournamentId]
  );

  io.to(`t_${tournamentId}`).emit('t:tournament_over', {
    winnerId, winnerUsername, prize, entryFee: parseFloat(t.entry_fee),
  });
}

// ── Bot auto-fill ────────────────────────────────────────────────────────────

async function tryBotFill(io, tournamentId) {
  const [[t]] = await pool.execute('SELECT * FROM tournaments WHERE id=?', [tournamentId]);
  if (!t || t.status !== 'waiting') return;

  const [players] = await pool.execute(
    'SELECT * FROM tournament_players WHERE tournament_id=?', [tournamentId]
  );
  if (players.length >= t.size) {
    await startTournament(io, tournamentId);
    return;
  }

  const diffs  = ['facil', 'medio', 'dificil'];
  const needed = t.size - players.length;

  for (let i = 0; i < needed; i++) {
    const diff      = diffs[Math.floor(Math.random() * diffs.length)];
    const bot       = createBot(diff);
    const botUserId = -(tournamentId * 100 + players.length + i + 1);
    await pool.execute(
      `INSERT IGNORE INTO tournament_players (tournament_id, user_id, username, is_bot, bot_difficulty)
       VALUES (?,?,?,1,?)`,
      [tournamentId, botUserId, bot.username, diff]
    ).catch(() => {});
  }

  await startTournament(io, tournamentId);
}

function scheduleBotFill(io, tournamentId, delayMs = 2 * 60 * 1000) {
  if (fillTimers.has(tournamentId)) clearTimeout(fillTimers.get(tournamentId));
  const timer = setTimeout(async () => {
    fillTimers.delete(tournamentId);
    await tryBotFill(io, tournamentId);
  }, delayMs);
  fillTimers.set(tournamentId, timer);
}

function cancelBotFill(tournamentId) {
  if (fillTimers.has(tournamentId)) {
    clearTimeout(fillTimers.get(tournamentId));
    fillTimers.delete(tournamentId);
  }
}

module.exports = { startTournament, onMatchComplete, scheduleBotFill, cancelBotFill };
