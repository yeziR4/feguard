import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../demo/client.mjs';
import { sha256 } from './inspection-lib.mjs';
import { runFocused, validateFocused } from './focused-lib.mjs';

const plan = JSON.parse(await readFile(new URL('../policies/focused-review.json', import.meta.url)));
const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
const engine = await loadEngine(bytes);
const rpcUrls = ['https://one.invalid', 'https://two.invalid'];
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
function transports(mutate = () => {}) {
  return rpcUrls.map((_, i) => async (_url, options) => {
    const q = JSON.parse(options.body);
    let result;
    if (q.method === 'eth_chainId') result = '0x38';
    else if (q.method === 'eth_getBlockByNumber') result = { number: '0x10', timestamp: '0x65000000', hash: word(42) };
    else if (q.method === 'eth_getCode') result = '0x6000';
    else {
      const row = plan.checks.find(c => c.address.toLowerCase() === q.params[0].to.toLowerCase() && (q.params[0].data.startsWith('0x8da5cb5b') ? c.recipe === 'owner' : q.params[0].data.startsWith('0xe30c3978') ? c.recipe === 'pendingOwner' : q.params[0].data.startsWith('0xf27a0c92') ? c.recipe === 'delay' : ['proposer','executor','canceller'].includes(c.recipe)));
      assert.ok(row, 'Unexpected call'); result = word(row.expected);
    }
    const response = { jsonrpc: '2.0', id: q.id, result }; mutate(response, q, i);
    return { ok: true, text: async () => JSON.stringify(response) };
  });
}
test('focused recipes evaluate documented owners, delay, pending recipients and sampled roles through Fe', async () => {
  const r = await runFocused(plan, engine, sha256(bytes), { rpcUrls, transports: transports() });
  assert.equal(r.summary.meets, plan.checks.length); assert.equal(r.confirmedImpactFindings, 0);
  assert.equal(r.evidence.length, 2);
  for (const p of r.evidence) for (const row of p.reads.filter(r => r.request.method === 'eth_call')) assert.equal(row.request.params[1], '0x10');
});
test('conflicting delay and malformed owner are evidence gaps, never success or critical findings', async () => {
  const r = await runFocused(plan, engine, sha256(bytes), { rpcUrls, transports: transports((r,q,i) => {
    if (q.method === 'eth_call' && q.params[0].data === '0xf27a0c92' && i === 1) r.result = word(0);
    if (q.method === 'eth_call' && q.params[0].data === '0x8da5cb5b') r.result = '0x';
  }) });
  assert.ok(r.summary.conflict > 0); assert.ok(r.summary.unknown > 0); assert.equal(r.summary.mismatch, 0);
});
test('a changed documented owner is a policy mismatch requiring review, not demonstrated loss', async () => {
  const r = await runFocused(plan, engine, sha256(bytes), { rpcUrls, transports: transports((r,q) => { if (q.method === 'eth_call' && q.params[0].data === '0x8da5cb5b') r.result = word(99); }) });
  assert.ok(r.summary.mismatch > 0); assert.equal(r.confirmedImpactFindings, 0);
  assert.match(r.checks.find(c => c.assessment.status === 'mismatch').assessment.nextStep, /approved migration/);
});
test('unreviewed calldata, duplicate IDs and unpinned project policies are rejected', () => {
  const p = structuredClone(plan); p.checks[0].recipe = 'arbitraryCall'; assert.throws(() => validateFocused(p), /Invalid/);
  p.checks[0] = { ...plan.checks[0], source: 'https://github.com/a/b/blob/main/README.md' }; assert.throws(() => validateFocused(p), /commit-pinned/);
  p.checks[0] = plan.checks[1]; assert.throws(() => validateFocused(p), /Invalid/);
});
