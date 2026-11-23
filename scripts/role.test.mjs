import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../demo/client.mjs';
import { classify, roleBits, wordToAddress, isZeroWord, isInitialized } from './role-lib.mjs';

const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
const engine = await loadEngine(bytes);

const full = { runtimeCorroborated: true, isProxy: true, initialized: true, nativeValue: true, tokenValue: true };

test('an uninitialized proxy is the review-critical role', () => {
  const r = classify(engine, { ...full, initialized: false });
  assert.equal(r.code, 10);
  assert.equal(r.category, 'review-critical');
});

test('an initialized proxy is context, never a confirmed finding', () => {
  const r = classify(engine, full);
  assert.equal(r.code, 11);
  assert.equal(r.category, 'context');
});

test('a plain uninitialized implementation is hardening', () => {
  const r = classify(engine, { runtimeCorroborated: true, isProxy: false, initialized: false, nativeValue: false, tokenValue: false });
  assert.equal(r.code, 9);
  assert.equal(r.category, 'implementation-hardening');
});

test('a plain contract holding value is context', () => {
  assert.equal(classify(engine, { ...full, isProxy: false }).code, 12);
});

test('missing runtime evidence stays unresolved, never a zero-owner finding', () => {
  const r = classify(engine, { runtimeCorroborated: false, isProxy: false, initialized: false, nativeValue: false, tokenValue: false });
  assert.equal(r.code, 13);
  assert.equal(r.category, 'coverage-gap');
});

test('initialization requires slot or owner corroboration, never a bare guess', () => {
  assert.equal(isInitialized({ slotInitialized: true, ownerSet: false }), true); // OZ v4
  assert.equal(isInitialized({ slotInitialized: false, ownerSet: true }), true); // OZ v5 / custom
  assert.equal(isInitialized({ slotInitialized: false, ownerSet: false }), false);
});

test('roleBits packs the five evidence bits', () => {
  assert.equal(roleBits(full), 31);
  assert.equal(roleBits({ runtimeCorroborated: true, isProxy: true, initialized: false, nativeValue: false, tokenValue: false }), 3);
});

test('word helpers treat an all-zero word as the zero address', () => {
  assert.ok(isZeroWord('0x' + '0'.repeat(64)));
  assert.equal(wordToAddress('0x' + '0'.repeat(64)), '0x0000000000000000000000000000000000000000');
  assert.equal(wordToAddress('0x' + '0'.repeat(24) + '1fbd228d55d91e2a4cc1ddfeadf493d8646b8d72'), '0x1fbd228d55d91e2a4cc1ddfeadf493d8646b8d72');
});
