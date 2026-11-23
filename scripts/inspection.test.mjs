import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../demo/client.mjs';
import { evaluate, summarize, changesSince } from '../inspection/policy.mjs';
import { Rpc, collect, decode, reconcile, safeEndpoint, specifications, sha256 } from './inspection-lib.mjs';

const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
const engine = await loadEngine(bytes);
const policyBytes = await readFile(new URL('../policies/gang-router.json', import.meta.url));
const policy = JSON.parse(policyBytes);
const recorded = JSON.parse(await readFile(new URL('../reports/gang-router.json', import.meta.url)));
const specs = specifications(policy);
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const key = r => JSON.stringify([r.method, r.params]);

function fixtureRpcs(mutate = () => {}) {
  return recorded.evidence.map((provider, index) => {
    const rows = new Map(provider.reads.map(row => [key(row.request), row.response]));
    return new Rpc(provider.provider, async (_url, options) => {
      const request = JSON.parse(options.body);
      const captured = rows.get(key(request));
      assert.ok(captured, `Fixture missing ${key(request)}`);
      const response = structuredClone(captured);
      response.id = request.id;
      mutate(response, request, index);
      return { ok: true, text: async () => JSON.stringify(response) };
    });
  });
}
function isSpec(request, id) {
  const spec = specs.find(s => s.id === id);
  return request.method === spec.method && request.params[0]?.to?.toLowerCase() === spec.target.toLowerCase() && request.params[0].data === spec.data;
}
const run = (mutate, extra = {}) => collect(policy, fixtureRpcs(mutate), engine, sha256(bytes), sha256(policyBytes), { block: recorded.block.number, ...extra });
const byId = (report, id) => report.checks.find(c => c.id === id);

test('offline captured evidence reproduces the saved Fe assessments', async () => {
  const report = await run();
  assert.deepEqual(report.checks, recorded.checks);
  assert.deepEqual(summarize(report.checks), recorded.summary);
});

test('synthetic short delay produces a policy mismatch and governance review action', async () => {
  const report = await run((response, request) => { if (isSpec(request, 'delay')) response.result = word(3600); });
  const found = byId(report, 'delay');
  assert.equal(found.assessment.status, 'mismatch');
  assert.equal(found.assessment.actionCode, 2);
  assert.match(found.assessment.nextStep, /governance-approved/);
  assert.equal(changesSince(report, recorded).length, 1);
});

test('synthetic unfinished two-step transfer identifies acceptance as the missing step', async () => {
  const report = await run((response, request) => {
    if (isSpec(request, 'owner.handler')) response.result = word(policy.addresses.deployer);
    if (isSpec(request, 'pending.handler')) response.result = word(policy.addresses.handlerAdmin);
  });
  assert.equal(byId(report, 'owner.handler').assessment.status, 'mismatch');
  assert.equal(byId(report, 'pending.handler').assessment.actionCode, 5);
  assert.match(byId(report, 'pending.handler').assessment.nextStep, /accept ownership/);
});

test('a third-party pending recipient gets a different review action', async () => {
  const report = await run((response, request) => { if (isSpec(request, 'pending.handler')) response.result = word(policy.addresses.deployer); });
  assert.equal(byId(report, 'pending.handler').assessment.actionCode, 6);
});

test('disagreement cannot become a matching or a mismatching observation', async () => {
  const report = await run((response, request, i) => { if (i === 0 && isSpec(request, 'delay')) response.result = word(3600); });
  assert.equal(byId(report, 'delay').assessment.status, 'conflict');
  assert.equal(byId(report, 'delay').assessment.actionCode, 13);
});

test('malformed ABI and one missing provider remain unknown', async () => {
  const malformed = await run((response, request) => { if (isSpec(request, 'delay')) response.result = '0x'; });
  assert.equal(byId(malformed, 'delay').assessment.status, 'unknown');
  const unavailable = await run((response, request, i) => {
    if (i === 0 && isSpec(request, 'delay')) { delete response.result; response.error = { code: -32000, message: 'unavailable' }; }
  });
  assert.equal(byId(unavailable, 'delay').assessment.status, 'unknown');
});

test('no-code address never masquerades as a zero-valued owner()', async () => {
  const report = await run((response, request) => {
    if (request.method === 'eth_getCode' && request.params[0] === policy.addresses.handler) response.result = '0x';
  });
  assert.equal(byId(report, 'code.handler').assessment.status, 'mismatch');
  assert.equal(byId(report, 'owner.handler').observation.state, 6);
  assert.equal(byId(report, 'owner.handler').assessment.status, 'unknown');
});

test('wrong chain or different pinned block hashes abort without a report', async () => {
  await assert.rejects(run((r, q) => { if (q.method === 'eth_chainId') r.result = '0x1'; }), /Chain ID/);
  await assert.rejects(run((r, q, i) => { if (i === 0 && q.method === 'eth_getBlockByNumber') r.result.hash = '0x' + '0'.repeat(64); }), /providers disagree/);
});

test('read-only boundary rejects sends and credential-bearing endpoints', async () => {
  await assert.rejects(new Rpc('https://example.com', () => { throw new Error('transport should not run'); }).read('eth_sendRawTransaction', ['0x']), /Read-only/);
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/key', 'https://example.com?key=secret']) assert.throws(() => safeEndpoint(url));
});

test('ABI decoders reject noncanonical booleans, addresses and duplicate Safe owners', () => {
  assert.throws(() => decode(word(2), 'bool'));
  assert.throws(() => decode(word(1n << 160n), 'address'));
  assert.throws(() => decode(word(32) + word(2).slice(2) + word(1).slice(2).repeat(2), 'owners'));
  assert.deepEqual(reconcile([{ state: 0, value: '0' }, { state: 0, value: '0' }]), { state: 0, value: '0' });
});

test('Fe WASM ABI keeps uint256 precision and distinguishes unknown zero from measured zero', () => {
  const value = (1n << 255n) + (1n << 128n) + 172800n;
  const check = { kind: 2, expected: String(value), observation: { state: 0, value: String(value - 1n) } };
  assert.equal(evaluate(engine, check).status, 'mismatch');
  check.observation.value = String(value);
  assert.equal(evaluate(engine, check).status, 'meets');
  assert.equal(evaluate(engine, { kind: 4, expected: '0', observation: { state: 1, value: '0' } }).status, 'unknown');
  assert.throws(() => evaluate(engine, { kind: 1, expected: '-1', observation: { state: 0, value: '0' } }));
});

test('snapshot memory rejects comparisons across different policies', () => {
  assert.throws(() => changesSince(recorded, { ...recorded, policySha256: 'different' }), /different policy/);
});
