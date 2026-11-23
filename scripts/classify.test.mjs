import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNames } from './classify.mjs';
import { dispatchSelectors } from './selectors.mjs';

test('a casino shape is recognised without any name or source', () => {
  assert.equal(classifyNames(['wager', 'bet', 'fulfillRandomWords', 'roll']).cls, 'casino');
});

test('a prediction market shape is recognised', () => {
  assert.equal(classifyNames(['resolve', 'claim', 'market', 'outcome']).cls, 'prediction-market');
});

test('conditional-token position operations read as a market', () => {
  assert.equal(classifyNames(['splitPosition', 'mergePositions', 'redeemPositions']).cls, 'prediction-market');
});

test('an ordinary token is not forced into either class', () => {
  const r = classifyNames(['transfer', 'balanceOf', 'approve', 'totalSupply']);
  assert.equal(r.cls, 'other');
  assert.equal(r.casinoScore, 0);
});

test('a shared claim() alone does not make something a market', () => {
  // Real MLM/Referral contracts carry claim(); it must not flip the class on its own.
  assert.equal(classifyNames(['claim', 'deposit', 'register']).cls, 'other');
});

test('dispatch selectors are read from PUSH4 ... EQ pairs only', () => {
  const code = '0x63aabbccdd1463001122331463ffffffff14' + '63deadbeef00';
  assert.deepEqual(dispatchSelectors(code), ['aabbccdd', '00112233', 'ffffffff']);
});
