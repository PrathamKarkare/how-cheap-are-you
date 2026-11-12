const test = require('node:test');
const assert = require('node:assert');
const { scoreRound, validateRounds } = require('../server');

const pts = (r) => r.map((g) => [g.playerId, g.points, g.disqualified]);

test('highest guess under the ceiling gets 2, second highest gets 1', () => {
  const r = scoreRound({ a: { amount: 10, at: 1 }, b: { amount: 29, at: 2 }, c: { amount: 25, at: 3 }, d: { amount: 5, at: 4 } }, 30);
  assert.deepStrictEqual(pts(r), [['b', 2, false], ['c', 1, false], ['a', 0, false], ['d', 0, false]]);
});

test('guessing exactly the ceiling is allowed; over the ceiling is disqualified', () => {
  const r = scoreRound({ over: { amount: 31, at: 1 }, exact: { amount: 30, at: 2 }, low: { amount: 1, at: 3 } }, 30);
  assert.deepStrictEqual(pts(r), [['exact', 2, false], ['low', 1, false], ['over', 0, true]]);
});

test('if everyone goes over, nobody scores', () => {
  const r = scoreRound({ a: { amount: 40, at: 1 }, b: { amount: 50, at: 2 } }, 30);
  assert.ok(r.every((g) => g.points === 0 && g.disqualified));
});

test('earlier guess wins a tie', () => {
  const r = scoreRound({ late: { amount: 20, at: 5 }, early: { amount: 20, at: 1 } }, 30);
  assert.deepStrictEqual(pts(r), [['early', 2, false], ['late', 1, false]]);
});

test('bonus round has no ceiling: highest wins', () => {
  const r = scoreRound({ a: { amount: 1e9, at: 1 }, b: { amount: 50, at: 2 } }, null);
  assert.deepStrictEqual(pts(r), [['a', 2, false], ['b', 1, false]]);
});

test('round validation: rounds 1-6 need a ceiling, the bonus round does not', () => {
  const ok = Array.from({ length: 7 }, (_, i) => ({ image: 'x', ceiling: i < 6 ? 100 : '' }));
  assert.strictEqual(validateRounds(ok), null);
  assert.match(validateRounds(ok.slice(0, 6)), /exactly 7/);
  assert.match(validateRounds(ok.map((r, i) => (i === 2 ? { ...r, ceiling: '' } : r))), /Round 3 needs a ceiling/);
});
