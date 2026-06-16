'use strict';

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeOptions(correct) {
  const set = new Set([correct]);
  const deltas = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15, 20]);
  for (const d of deltas) {
    if (set.size >= 4) break;
    const candidates = [correct + d, correct - d].filter(v => v >= 0 && !set.has(v));
    if (candidates.length) set.add(candidates[rand(0, candidates.length - 1)]);
  }
  // fallback if still < 4
  let extra = 2;
  while (set.size < 4) { set.add(correct + extra * 7); extra++; }

  const opts = shuffle([...set]);
  return { options: opts.map(String), correctIndex: opts.indexOf(correct) };
}

function generateQuestion(round) {
  let expr, answer;

  if (round <= 3) {
    // Easy: single +/−
    const op = rand(0, 1);
    if (op === 0) {
      const a = rand(2, 30), b = rand(2, 30);
      expr = `${a} + ${b}`; answer = a + b;
    } else {
      const a = rand(10, 50), b = rand(1, a - 1);
      expr = `${a} − ${b}`; answer = a - b;
    }
  } else if (round <= 6) {
    // Medium: × or 3-term
    const type = rand(0, 2);
    if (type === 0) {
      const a = rand(3, 12), b = rand(3, 12);
      expr = `${a} × ${b}`; answer = a * b;
    } else if (type === 1) {
      const a = rand(10, 50), b = rand(5, 30), c = rand(2, 20);
      expr = `${a} + ${b} − ${c}`; answer = a + b - c;
    } else {
      const a = rand(4, 12), b = rand(3, 10), c = rand(1, 25);
      expr = `${a} × ${b} + ${c}`; answer = a * b + c;
    }
  } else {
    // Hard: complex expressions
    const type = rand(0, 2);
    if (type === 0) {
      const a = rand(7, 18), b = rand(7, 18), c = rand(5, 40);
      expr = `${a} × ${b} − ${c}`; answer = a * b - c;
    } else if (type === 1) {
      const a = rand(3, 9), b = rand(3, 9), c = rand(2, 7), d = rand(2, 7);
      expr = `${a} × ${b} + ${c} × ${d}`; answer = a * b + c * d;
    } else {
      const a = rand(20, 70), b = rand(10, 40), c = rand(5, 25), d = rand(1, 15);
      expr = `${a} + ${b} − ${c} + ${d}`; answer = a + b - c + d;
    }
  }

  if (answer < 0) return generateQuestion(round); // retry if negative

  const { options, correctIndex } = makeOptions(answer);
  return { expression: expr, answer, options, correctIndex };
}

module.exports = { generateQuestion };
