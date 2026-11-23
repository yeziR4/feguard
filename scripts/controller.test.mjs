import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runController, verifyWorkflow, artifactPath } from './controller-lib.mjs';
import { buildMemory } from './workflow-memory.mjs';

const fingerprint = 'a'.repeat(64);
async function workspace(t) { const p = await mkdtemp(join(tmpdir(), 'feguard-controller-')); t.after(() => rm(p, { recursive: true, force: true })); return p; }

test('failed stage leaves latest untouched; resume reuses completed stages and retries only failure', async t => {
  const root = await workspace(t); let discovery = 0, screen = 0, fail = true;
  const stages = [{ id: 'discover', run: async () => ({ count: ++discovery }) }, { id: 'screen', run: async o => { screen++; if (fail) throw new Error('transport'); return { count: o.discover.count }; } }];
  await assert.rejects(runController({ root, id: 'retry', fingerprint, stages }), /transport/);
  await assert.rejects(readFile(join(root, 'reports/workflow.json')), /ENOENT/);
  fail = false;
  const result = await runController({ root, id: 'retry', fingerprint, stages, resume: true });
  assert.equal(discovery, 1); assert.equal(screen, 2);
  assert.equal(result.manifest.stages[1].attempts, 2);
  assert.deepEqual(await verifyWorkflow(root, result.manifest), result.outputs);
  await runController({ root, id: 'retry', fingerprint, stages, resume: true });
  assert.equal(discovery, 1); assert.equal(screen, 2);
});

test('changed configuration and corrupt checkpoints prevent downstream execution or publication', async t => {
  const root = await workspace(t); let calls = 0;
  const stages = [{ id: 'screen', run: async () => ({ count: ++calls }) }];
  await runController({ root, id: 'integrity', fingerprint, stages });
  const pointer = await readFile(join(root, 'reports/workflow.json'), 'utf8');
  await assert.rejects(runController({ root, id: 'integrity', fingerprint: 'b'.repeat(64), stages, resume: true }), /Inputs/);
  await writeFile(join(root, 'reports/runs/integrity/screen.json.gz'), 'corrupt');
  await assert.rejects(runController({ root, id: 'integrity', fingerprint, stages, resume: true }), /hash mismatch/);
  assert.equal(calls, 1); assert.equal(await readFile(join(root, 'reports/workflow.json'), 'utf8'), pointer);
});

test('run identity, traversal and concurrent writers are rejected', async t => {
  const root = await workspace(t);
  const stages = [{ id: 'screen', run: async () => ({}) }];
  await assert.rejects(runController({ root, id: '../escape', fingerprint, stages }), /identity/);
  assert.throws(() => artifactPath(root, '../escape'), /escapes/);
  let release, entered;
  const waiting = new Promise(r => { entered = r; });
  const first = runController({ root, id: 'first', fingerprint, stages: [{ id: 'screen', run: async () => { entered(); await new Promise(r => { release = r; }); return {}; } }] });
  await waiting;
  await assert.rejects(runController({ root, id: 'second', fingerprint, stages }), /lock exists/);
  release(); await first;
});

function memoryFixture() {
  const address = '0x' + '1'.repeat(40), block = { timestamp: '2026-11-23T16:00:00.000Z', number: '1' };
  return { cohort: { candidates: [], block, collectedAt: block.timestamp }, initialization: { results: [{ address, name: 'logic', assessment: { code: 8 } }], block }, focused: { planSha256: 'policy-a', checks: [], block }, dispositions: { cases: [{ address, severity: 'Low / informational', evidenceFile: 'context.json', evidenceSha256: 'd'.repeat(64) }] }, baseline: { candidates: [{ address }] }, baselineReferences: {} };
}
test('memory deduplicates across runs and preserves historical Low context instead of promoting initialization success', () => {
  const input = memoryFixture(), first = buildMemory(input), second = buildMemory({ ...input, previous: first });
  assert.equal(second.records.length, 1); assert.equal(second.records[0].seenRuns, 2);
  assert.equal(second.records[0].severity, 'Low / informational'); assert.equal(second.records[0].confirmedImpact, false);
  assert.match(second.records[0].contextEvidence.status, /Historical/); assert.equal(second.summary.confirmedImpactFindings, 0);
});
test('omitted cases are unverified; only a known same-policy observation clears a policy signal', () => {
  const input = memoryFixture(); input.initialization.results = [];
  const c = { id: 'delay', address: '0x' + '2'.repeat(40), scope: 'demo', assessment: { status: 'mismatch', nextStep: 'Review' } };
  input.focused.checks = [c];
  const first = buildMemory(input);
  const omitted = buildMemory({ ...input, focused: { ...input.focused, checks: [] }, previous: first });
  assert.equal(omitted.records[0].status, 'unverified');
  const fixed = { ...c, assessment: { status: 'meets' } };
  assert.equal(buildMemory({ ...input, focused: { ...input.focused, checks: [fixed] }, previous: first }).records[0].status, 'signal-cleared');
  assert.equal(buildMemory({ ...input, focused: { ...input.focused, planSha256: 'policy-b', checks: [fixed] }, previous: first }).records[0].status, 'unverified');
});

test('reviewed migration explanation requires fresh matching replacement and all authority-chain checks', () => {
  const input = memoryFixture(); input.initialization.results = [];
  const c = { id: 'owner', address: '0x' + '2'.repeat(40), scope: 'demo', expected: '9', source: 'primary-source', assessment: { status: 'mismatch', nextStep: 'Review' } };
  input.focused.checks = [c]; const first = buildMemory(input);
  const policyDispositions = { cases: [{ key: first.records[0].key, replacementCheckId: 'owner', expected: '10', source: 'new-primary-source', requiredChecks: ['owner', 'admin-owner'], conclusion: 'Documented migration' }] };
  const fresh = { ...c, expected: '10', source: 'new-primary-source', assessment: { status: 'meets' } };
  const options = { ...input, previous: first, policyDispositions, focused: { ...input.focused, planSha256: 'policy-b', checks: [fresh] } };
  assert.equal(buildMemory(options).records[0].status, 'unverified');
  options.focused.checks.push({ ...fresh, id: 'admin-owner' });
  const explained = buildMemory(options);
  assert.equal(explained.records[0].status, 'explained-change'); assert.equal(explained.queue.length, 0);
  assert.equal(explained.records[0].interpretation.conclusion, 'Documented migration');
});
