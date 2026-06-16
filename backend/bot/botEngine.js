/**
 * backend/bot/botEngine.js
 *
 * Motor central dos bots.
 * Ficheiro novo — não toca em nada existente.
 */

'use strict';

// ── Perfis por dificuldade ───────────────────────────────────────────────────
//
//  accuracy    → probabilidade de responder correctamente (0–1)
//  minDelay    → tempo mínimo antes de responder (ms)
//  maxDelay    → tempo máximo antes de responder (ms)
//  skipChance  → probabilidade de deixar a pergunta expirar (timeout)
//
// QUESTION_TIME_LIMIT no socket.js é 15s.
// Os delays abaixo respeitam essa janela.
//
// Scoring formula: max(10, round(100 × (1 − t/15)))
//   1s → 93pts  |  3s → 80pts  |  5s → 67pts
//   7s → 53pts  |  9s → 40pts  | 11s → 27pts
//
// Profiles tuned so a focused human (3–5 s/answer, ~80–90% correct)
// can beat easy/medium but has to work hard against hard bots.
const PROFILES = {
  easy: {
    accuracy:   0.80,   // gets ~8/10 right
    minDelay:   2500,   // answers between 2.5–6 s
    maxDelay:   6000,
    skipChance: 0.02,
  },
  medium: {
    accuracy:   0.90,   // gets ~9/10 right
    minDelay:   1500,   // answers between 1.5–4 s
    maxDelay:   4000,
    skipChance: 0.01,
  },
  hard: {
    accuracy:   0.97,   // almost always correct
    minDelay:   800,    // answers between 0.8–2.5 s
    maxDelay:   2500,
    skipChance: 0.00,
  },
};

// Mapa de dificuldades do jogo → chave interna do perfil
const DIFFICULTY_MAP = {
  facil:   'easy',
  medio:   'medium',
  dificil: 'hard',
  easy:    'easy',
  medium:  'medium',
  hard:    'hard',
};

const BOT_NAMES = [
  'ShadowIQ', 'QuizHunter', 'VenomPlay', 'DarkPixel', 'FrostByte',
  'AlphaMind', 'NovaStrike', 'GhostPlayer', 'ToxicBrain', 'InfernoX',
  'BrainStorm', 'QuizMaster', 'IQLegend', 'MindCrusher', 'FastThinker',
  'GeniusMode', 'BrainX', 'TriviaKing', 'LogicHunter', 'MegaIQ',
  'Zyro', 'Nexor', 'Vynix', 'Kairo', 'Zynex',
  'Ravoq', 'Xevon', 'Nyrox', 'Veltox', 'Kryzo',
  'LunarEcho', 'NeonVibe', 'SilentWave', 'VelvetStorm', 'ArcticSoul',
  'NightFury', 'CyberNova', 'MysticFlow', 'DreamPulse', 'ZeroGravity',
  'Rank1', 'ClutchGod', 'NoMercy', 'EliteZone', 'VictoryRush',
  'TryHardX', 'TopFrag', 'ChampionMind', 'Unbeatable', 'FinalBoss',
  'GooglePlayer', 'BrainLag', 'AFKMaster', 'CtrlWin', 'Error404IQ',
  'LoadingSkill', 'NotABot', 'LaggedAgain', 'PotatoAim', 'SleepyGenius',
];

function randomBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

/**
 * Cria o objecto bot. Nunca é persistido na BD users —
 * apenas existe em memória durante a partida.
 *
 * @param {string} difficulty  'facil' | 'medio' | 'dificil'
 * @returns {object}
 */
function createBot(difficulty = 'medio') {
  const key     = DIFFICULTY_MAP[difficulty] || 'medium';
  const profile = PROFILES[key];
  const name    = randomBotName();

  return {
    id:           0,
    username:     name,
    isBot:        true,
    difficulty,
    profile,
    avatar_icon:  Math.floor(Math.random() * 9),
  };
}

/**
 * Calcula a decisão do bot para uma pergunta.
 *
 * @param {{ options: string[], answer: number }} question
 * @param {object} bot  criado por createBot()
 * @returns {{ answerIndex: number|null, delay: number }}
 *   answerIndex null → bot não responde (skip/timeout)
 */
function computeBotAnswer(question, bot) {
  const { accuracy, minDelay, maxDelay, skipChance } = bot.profile;

  // Delay realista dentro da janela de tempo do perfil
  const delay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));

  // Decide não responder (simula distracção / timeout)
  if (Math.random() < skipChance) {
    return { answerIndex: null, delay };
  }

  if (Math.random() < accuracy) {
    // Resposta correcta
    return { answerIndex: question.answer, delay };
  }

  // Resposta errada — escolhe aleatoriamente entre as opções incorrectas
  const wrong = question.options
    .map((_, i) => i)
    .filter(i => i !== question.answer);

  const answerIndex = wrong[Math.floor(Math.random() * wrong.length)] ?? 0;
  return { answerIndex, delay };
}

module.exports = { createBot, computeBotAnswer };
