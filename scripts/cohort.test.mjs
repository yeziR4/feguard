import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadEngine } from '../demo/client.mjs';
import { discover, runCohort, validateListing, qualifyMetadata, selectReads, incidents } from './cohort-lib.mjs';
import { triage, summarizeCohort } from '../inspection/cohort-policy.mjs';
import { probeTarget, validatePlan } from './initialization-lib.mjs';
import { sha256 } from './inspection-lib.mjs';

const read = async path => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
const report = await read('reports/cohort.json');
const compressed = await readFile(new URL('../reports/cohort-evidence.json.gz', import.meta.url));
assert.equal(sha256(compressed), report.evidenceSha256);
const evidence = JSON.parse(gunzipSync(compressed));
const follow = await read('reports/initialization-review.json');
const plan = await read('policies/initialization-review.json');
const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
const engine = await loadEngine(bytes);
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const discovery = { url: evidence.discovery.url, listing: evidence.discovery.listing, cached: false, candidates: evidence.discovery.listing.results.map(c => { const m = evidence.metadata.find(m => m.address.toLowerCase() === c.address.toLowerCase()); return { discovery: c, metadata: m.data, sourceUrl: m.sourceUrl, qualificationIssues: qualifyMetadata(c, m.data) }; }) };

function fixtureTransports(mutate = () => {}) {
  return evidence.rpc.map((provider, i) => {
    const rows = new Map(provider.reads.map(r => [JSON.stringify([r.request.method, r.request.params]), r.response]));
    return async (_url, options) => {
      const request = JSON.parse(options.body);
      const captured = rows.get(JSON.stringify([request.method, request.params]));
      assert.ok(captured, `Missing captured RPC ${request.method}`);
      const response = structuredClone(captured); response.id = request.id;
      mutate(response, request, i);
      return { ok: true, text: async () => JSON.stringify(response) };
    };
  });
}
const replay = mutate => runCohort(discovery, engine, sha256(bytes), { rpcUrls: report.providers, transports: fixtureTransports(mutate) });

test('all saved cohort observations reproduce from compressed public RPC evidence offline', async () => {
  const actual = (await replay()).report;
  assert.deepEqual(actual.summary, report.summary);
  assert.deepEqual(actual.candidates, report.candidates);
});

test('runtime disagreement removes source-based getter qualification', async () => {
  const address = report.candidates.find(c => c.observations.length).address;
  const actual = (await replay((r, q, i) => { if (i === 0 && q.method === 'eth_getCode' && q.params[0] === address) r.result = '0x6000'; })).report;
  const target = actual.candidates.find(c => c.address === address);
  assert.equal(target.runtimeCorroborated, false);
  assert.equal(target.observations.length, 0);
  assert.equal(target.coverage, 'not-qualified');
});

test('a synthetic pending recipient becomes a review lead, never a confirmed vulnerability', async () => {
  const target = report.candidates.find(c => c.observations.some(o => o.name === 'pendingOwner'));
  const actual = (await replay((r, q) => { if (q.method === 'eth_call' && q.params[0].to === target.address && q.params[0].data === '0xe30c3978') r.result = word(42); })).report;
  assert.equal(actual.summary.reviewLeads, 1);
  assert.equal(actual.summary.confirmedFindings, 0);
  assert.equal(actual.incidents[0].status, 'open-review');
});

test('malformed getter data stays unknown rather than creating a zero-owner signal', async () => {
  const target = report.candidates.find(c => c.observations.some(o => o.name === 'owner'));
  const actual = (await replay((r, q) => { if (q.method === 'eth_call' && q.params[0].to === target.address && q.params[0].data === '0x8da5cb5b') r.result = '0x'; })).report;
  assert.equal(actual.candidates.find(c => c.address === target.address).observations.find(o => o.name === 'owner').triage.code, 6);
});

test('discovery identity, chain and duplicate checks reject invalid samples', () => {
  const c = evidence.discovery.listing.results[0];
  assert.throws(() => validateListing({ results: [c, c] }, 56, 2), /Duplicate/);
  assert.throws(() => validateListing({ results: [{ ...c, chainId: '1' }] }, 56, 1), /Invalid/);
  const m = discovery.candidates[0].metadata;
  assert.ok(qualifyMetadata(c, { ...m, address: '0x' + '0'.repeat(40) }).length);
});

test('ABI selection rejects non-view and incompatible owner lookalikes', () => {
  const base = { type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' };
  assert.equal(selectReads({ abi: [base] }).length, 1);
  assert.equal(selectReads({ abi: [{ ...base, stateMutability: 'nonpayable' }] }).length, 0);
  assert.equal(selectReads({ abi: [{ ...base, outputs: [{ type: 'uint256' }] }] }).length, 0);
});

test('incident memory deduplicates leads and never resolves a contract absent from the next sample', () => {
  const signal = { fingerprint: '56:example:pendingOwner', rule: 'pendingOwner', code: 1, category: 'review' };
  const candidate = { address: '0xabc', name: 'Example', runtimeCorroborated: true, signals: [signal], observations: [{ name: 'pendingOwner', state: 0, triage: { code: 1 } }] };
  const first = { collectedAt: 'one', candidates: [candidate] }; const old = incidents(first);
  const repeated = incidents({ collectedAt: 'two', candidates: [candidate] }, { incidents: old });
  assert.equal(repeated.length, 1); assert.equal(repeated[0].seenRuns, 2); assert.equal(repeated[0].firstSeen, 'one');
  assert.equal(incidents({ collectedAt: 'three', candidates: [] }, { incidents: old })[0].status, 'unverified');
  const cleared = { ...candidate, signals: [], observations: [{ name: 'pendingOwner', state: 0, triage: { code: 0 } }] };
  assert.equal(incidents({ collectedAt: 'four', candidates: [cleared] }, { incidents: old })[0].status, 'signal-cleared');
});

test('five recorded source-reviewed leads replay in Fe without claiming impact', () => {
  assert.equal(sha256(JSON.stringify(plan)), follow.planSha256);
  for (const result of follow.results) {
    assert.deepEqual(triage(engine, result.rule, { state: result.state, value: result.flags }), result.assessment);
    assert.equal(result.confirmedImpact, false);
    const raw = follow.evidence.source.find(e => e.address === result.address);
    assert.ok(raw.simulations.every(r => r.result === '0x'));
    assert.ok(raw.storage.every(r => BigInt(r.result) === 0n));
    assert.equal(raw.source.sha256, result.source.sha256);
  }
});

function initializationFixture({ sourceBad = false, codeBad = false, slotValue = 0, partial = false } = {}) {
  const content = 'synthetic reviewed initializer fixture';
  const target = structuredClone(plan.targets[0]); target.source.sha256 = sha256(content); target.runtimeSha256 = sha256(Buffer.from('6000', 'hex'));
  const calls = [];
  const rpcs = [0, 1].map(i => ({ read: async (method, params) => { calls.push(method); if (method === 'eth_getCode') return { result: codeBad && i === 0 ? '0x6001' : '0x6000' }; if (method === 'eth_getStorageAt') return { result: word(slotValue) }; return partial && i === 0 ? { error: { code: -32000 } } : { result: '0x' }; } }));
  const source = async () => ({ sources: { [target.source.path]: { content: sourceBad ? 'changed source' : content } }, storageLayout: { storage: [{ label: '_initialized', slot: '0', offset: 0, type: 'uint8' }], types: { uint8: { numberOfBytes: '1' } } } });
  return { target, rpcs, calls, source };
}
const probeFixture = f => probeTarget(f.target, f.rpcs, follow.block, engine, f.source);

test('source/runtime gates stop a simulation when evidence differs', async () => {
  for (const options of [{ sourceBad: true }, { codeBad: true }]) {
    const f = initializationFixture(options); const row = await probeFixture(f);
    assert.equal(row.result.assessment.code, 7); assert.ok(!f.calls.includes('eth_call'));
  }
});

test('initialized state is not reinitialized, and partial simulations stay unknown', async () => {
  const done = initializationFixture({ slotValue: 1 });
  assert.equal((await probeFixture(done)).result.assessment.code, 0); assert.ok(!done.calls.includes('eth_call'));
  assert.equal((await probeFixture(initializationFixture({ partial: true }))).result.assessment.code, 6);
});

test('all evidence gates are required for a validated initialization lead', async () => {
  const row = await probeFixture(initializationFixture());
  assert.equal(row.result.flags, '15'); assert.equal(row.result.assessment.code, 8); assert.equal(row.result.confirmedImpact, false);
});

test('review plan rejects source URL swaps and duplicate targets', () => {
  assert.equal(validatePlan(plan).targets.length, 5);
  const wrong = structuredClone(plan); wrong.targets[0].source.url = 'https://example.com'; assert.throws(() => validatePlan(wrong));
  const duplicate = structuredClone(plan); duplicate.targets.push(duplicate.targets[0]); assert.throws(() => validatePlan(duplicate));
});
