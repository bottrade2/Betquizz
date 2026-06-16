'use strict';

const { pool } = require('../database');

// Maps old names → new English nicknames (migration runs on every startup, idempotent)
const BOT_RENAMES = [
  // Old placeholders
  { old: 'Bot Fácil',   newName: 'BrainStorm' },
  { old: 'Bot Médio',   newName: 'QuizMaster'  },
  { old: 'Bot Difícil', newName: 'FinalBoss'   },
  // Previous English names
  { old: 'xRafael99',   newName: 'BrainStorm'   },
  { old: 'KiritoLuz',   newName: 'FastThinker'  },
  { old: 'ProGamer_7',  newName: 'MegaIQ'       },
  { old: 'QuizMaster',  newName: 'FastThinker'  },
  { old: 'FinalBoss',   newName: 'MegaIQ'       },
  // Old Portuguese fake players
  { old: 'SofiaM99',   newName: 'ShadowIQ'     },
  { old: 'Goncalo97',  newName: 'InfernoX'     },
  { old: 'CarlosDias', newName: 'AlphaMind'    },
  { old: 'Ricardo_PT', newName: 'ToxicBrain'   },
  { old: 'MarianaSF',  newName: 'NovaStrike'   },
  { old: 'PedroAlves', newName: 'GhostPlayer'  },
  { old: 'TiagoK',     newName: 'VenomPlay'    },
  { old: 'BrunoLopes', newName: 'DarkPixel'    },
  { old: 'LaraSilva',  newName: 'FrostByte'    },
  { old: 'Filipe_XL',  newName: 'QuizHunter'  },
];

const BOT_ENTRIES = [
  { username: 'BrainStorm',  email: 'bot_facil@system'   },
  { username: 'FastThinker', email: 'bot_medio@system'   },
  { username: 'MegaIQ',      email: 'bot_dificil@system' },
];

// Fake players that populate the leaderboard with realistic win rates (71–90%)
const FAKE_PLAYERS = [
  { username: 'ShadowIQ',    email: 'shadowiq@fake',    games_played: 148, games_won: 133, balance: 520  }, // 89.9%
  { username: 'InfernoX',    email: 'infernox@fake',    games_played: 210, games_won: 178, balance: 890  }, // 84.8%
  { username: 'AlphaMind',   email: 'alphamind@fake',   games_played: 175, games_won: 143, balance: 740  }, // 81.7%
  { username: 'ToxicBrain',  email: 'toxicbrain@fake',  games_played: 130, games_won: 107, balance: 480  }, // 82.3%
  { username: 'NovaStrike',  email: 'novastrike@fake',  games_played: 95,  games_won: 77,  balance: 310  }, // 81.1%
  { username: 'GhostPlayer', email: 'ghostplayer@fake', games_played: 160, games_won: 129, balance: 560  }, // 80.6%
  { username: 'VenomPlay',   email: 'venomplay@fake',   games_played: 112, games_won: 87,  balance: 270  }, // 77.7%
  { username: 'DarkPixel',   email: 'darkpixel@fake',   games_played: 138, games_won: 105, balance: 195  }, // 76.1%
  { username: 'FrostByte',   email: 'frostbyte@fake',   games_played: 84,  games_won: 63,  balance: 140  }, // 75.0%
  { username: 'QuizHunter',  email: 'quizhunter@fake',  games_played: 72,  games_won: 51,  balance: 110  }, // 70.8%
];

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
      AND COLUMN_NAME  = ?
    LIMIT 1
  `, [table, column]);
  return rows.length > 0;
}

async function addBotUsers() {
  const connection = await pool.getConnection();
  try {
    if (!(await columnExists(connection, 'users', 'is_bot'))) {
      await connection.execute(`
        ALTER TABLE users
          ADD COLUMN is_bot TINYINT(1) NOT NULL DEFAULT 0
      `);
      console.log('Added column users.is_bot');
    }

    // Rename old placeholder names if they still exist (also mark as bot)
    for (const r of BOT_RENAMES) {
      await connection.execute(
        'UPDATE users SET username = ?, is_bot = 1 WHERE username = ?',
        [r.newName, r.old]
      );
    }

    for (const bot of BOT_ENTRIES) {
      const [existing] = await connection.execute(
        'SELECT id FROM users WHERE username = ? AND is_bot = 1 LIMIT 1',
        [bot.username]
      );
      if (existing.length === 0) {
        await connection.execute(
          `INSERT INTO users (username, email, password, balance, is_bot)
           VALUES (?, ?, 'SYSTEM_BOT', 0, 1)`,
          [bot.username, bot.email]
        );
        console.log(`[Migration] Created bot user: ${bot.username}`);
      }
    }

    for (const p of FAKE_PLAYERS) {
      const [existing] = await connection.execute(
        'SELECT id FROM users WHERE username = ? AND is_bot = 1 LIMIT 1',
        [p.username]
      );
      if (existing.length === 0) {
        await connection.execute(
          `INSERT INTO users (username, email, password, balance, games_played, games_won, is_bot)
           VALUES (?, ?, 'SYSTEM_BOT', ?, ?, ?, 1)`,
          [p.username, p.email, p.balance, p.games_played, p.games_won]
        );
        console.log(`[Migration] Created fake player: ${p.username} (${Math.round(p.games_won*100/p.games_played)}% wr)`);
      } else {
        // Sync stats to keep leaderboard realistic
        await connection.execute(
          'UPDATE users SET games_played = ?, games_won = ?, balance = ? WHERE username = ? AND is_bot = 1',
          [p.games_played, p.games_won, p.balance, p.username]
        );
      }
    }

    console.log('[Migration] addBotUsers complete');
  } catch (err) {
    console.error('[Migration] addBotUsers error:', err.message);
  } finally {
    connection.release();
  }
}

module.exports = { addBotUsers };
