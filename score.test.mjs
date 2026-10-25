// Esegui con: node score.test.mjs
import assert from 'node:assert';
import { playerScores, teamScore } from './score.js';

const s = playerScores([
  { playerId: 'a', points: 5 },
  { playerId: 'a', points: -2 },
  { playerId: 'b', points: -4 },
]);
assert.deepStrictEqual(s, { a: 3, b: -4 });
// b è capitano: il suo malus raddoppia (-8); c, d, e senza eventi valgono 0
assert.strictEqual(teamScore({ members: ['a', 'b', 'c', 'd', 'e'], captain: 'b' }, s), -5);
assert.strictEqual(teamScore({ members: ['a', 'b', 'c', 'd', 'e'], captain: 'a' }, s), 2);
console.log('ok');
