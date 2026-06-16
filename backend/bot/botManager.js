/**
 * backend/bot/botManager.js
 *
 * Gere o ciclo de vida de bots activos por sala.
 * É chamado pelo socket.js modificado quando uma sala vs bot inicia.
 * Ficheiro novo — não toca em nada existente.
 */

'use strict';

const { createBot, computeBotAnswer } = require('./botEngine');

// Mapa roomCode → { bot, pendingTimers[] }
const activeBots = new Map();

/**
 * Regista um bot para uma sala e devolve o objecto bot.
 * Chamado quando a sala é criada com vsBot: true.
 *
 * @param {string} roomCode
 * @param {string} difficulty
 * @returns {object} bot
 */
function registerBot(roomCode, difficulty) {
  const bot = createBot(difficulty);

  activeBots.set(roomCode, {
    bot,
    pendingTimers: [],
  });

  return bot;
}

/**
 * Remove o bot da sala e cancela todos os timers pendentes.
 * Chamado quando a partida termina ou a sala é destruída.
 *
 * @param {string} roomCode
 */
function unregisterBot(roomCode) {
  const entry = activeBots.get(roomCode);
  if (!entry) return;

  entry.pendingTimers.forEach(t => clearTimeout(t));
  activeBots.delete(roomCode);
}

/**
 * Devolve o bot registado para a sala, ou null.
 *
 * @param {string} roomCode
 * @returns {object|null}
 */
function getBot(roomCode) {
  return activeBots.get(roomCode)?.bot ?? null;
}

/**
 * Verifica se a sala tem bot activo.
 *
 * @param {string} roomCode
 * @returns {boolean}
 */
function hasBot(roomCode) {
  return activeBots.has(roomCode);
}

/**
 * Agenda a resposta do bot a uma pergunta.
 * Após o delay calculado pelo botEngine, invoca o callback onAnswer
 * — que é injectado pelo socket.js modificado e contém a lógica de scoring.
 *
 * @param {string}   roomCode
 * @param {object}   question     { options, answer, ... }
 * @param {number}   questionIndex
 * @param {number}   timeLimitMs   janela total da pergunta em ms
 * @param {Function} onAnswer      callback(answerIndex: number) → void
 */
function scheduleBotAnswer(roomCode, question, questionIndex, timeLimitMs, onAnswer) {
  const entry = activeBots.get(roomCode);
  if (!entry) return;

  const { bot } = entry;
  const { answerIndex, delay } = computeBotAnswer(question, bot);

  // Nunca envia depois do tempo limite da pergunta
  const safeDelay = Math.min(delay, timeLimitMs - 500);

  if (answerIndex === null || safeDelay <= 0) {
    // Bot não responde — o timer de expiração do socket.js trata do timeout
    return;
  }

  const timer = setTimeout(() => {
    // Remove este timer da lista antes de invocar
    if (entry.pendingTimers) {
      const idx = entry.pendingTimers.indexOf(timer);
      if (idx !== -1) entry.pendingTimers.splice(idx, 1);
    }
    onAnswer(answerIndex);
  }, safeDelay);

  entry.pendingTimers.push(timer);
}

module.exports = { registerBot, unregisterBot, getBot, hasBot, scheduleBotAnswer };
