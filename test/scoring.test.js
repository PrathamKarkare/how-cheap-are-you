const test = require('node:test');
const assert = require('node:assert');
const { scoreRound, validateRounds } = require('../server');

test('closest gets 2, second closest gets 1, the rest get 0', () => {
  const r = scoreRound({ a: { amount: 10, at: 1 }, b: { amount: 24, at: 2 }, c: { amount: 30, at: 3 }, d: { amount: 99, at: 4 } }, 25);
  assert.deepStrictEqual(r.map((g) => [g.playerId, g.points]), [['b', 2], ['c', 1], ['a', 0], ['d', 0]]);
});

test('guessing over or under counts the same distance; earlier guess wins a tie', () => {
  const r = scoreRound({ late: { amount: 30, at: 5 }, early: { amount: 20, at: 1 } }, 25);
  assert.deepStrictEqual(r.map((g) => [g.playerId, g.points]), [['early', 2], ['late', 1]]);
});

test('one guess still scores', () => {
  assert.strictEqual(scoreRound({ solo: { amount: 1, at: 1 } }, 500)[0].points, 2);
});

test('round validation', () => {
  const ok = Array.from({ length: 7 }, () => ({ image: 'data:x', ceiling: 100, answer: 20 }));
  assert.strictEqual(validateRounds(ok), null);
  assert.match(validateRounds(ok.slice(0, 6)), /exactly 7/);
  assert.match(validateRounds(ok.map((r, i) => (i === 2 ? { ...r, answer: 200 } : r))), /Round 3.*above the ceiling/);
});
