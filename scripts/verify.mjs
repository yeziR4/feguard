import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEngine, campaign } from '../demo/client.mjs';

const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../demo/engine/feguard.manifest.json', import.meta.url)));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.module.sha256, 'WASM artifact must match its compiler manifest.');
const engine = await loadEngine(bytes);
const results = [];
for (const seed of ['0', '42', '2026']) {
  for (const target of [1, 2, 3]) {
    const report = campaign(engine, { target, seed, cases: 64, steps: 64 });
    assert.equal(report.found, true, `Target ${target}, seed ${seed} must be discovered within the documented bound.`);
    assert.equal(report.failureCode, target);
    assert.equal(report.deletionMinimal, true);
    assert.equal(report.correctedReplayPasses, true);
    assert.equal(report.reducedTrace.at(-1).state.failure, target);
    assert.equal(report.reducedTrace.at(-1).correctedState.failure, 0);
    results.push({ target, startSeed: seed, failingSeed: report.failingSeed,
      prefix: report.originalLength, reduced: report.reducedLength, replays: report.reductionReplays });
  }
}
const clean = campaign(engine, { target: 0, seed: '0', cases: 4096, steps: 64 });
assert.equal(clean.found, false);
assert.equal(clean.casesChecked, 4096);
const wrapped = campaign(engine, { target: 0, seed: '18446744073709551600', cases: 32, steps: 64 });
assert.equal(wrapped.found, false);
assert.deepEqual(campaign(engine, { target: 3 }), campaign(engine, { target: 3 }), 'Same inputs must reproduce the same report.');
assert.throws(() => campaign(engine, { seed: '-1' }), /Seed/);
assert.throws(() => campaign(engine, { seed: '18446744073709551616' }), /Seed/);
assert.throws(() => campaign(engine, { target: 4 }), /Target/);
assert.throws(() => campaign(engine, { cases: 0 }), /Cases/);
assert.throws(() => campaign(engine, { steps: 65 }), /Steps/);
const evidence = { compiler: manifest.compiler, wasmSha256: manifest.module.sha256,
  mutantCampaigns: results, correctCampaign: { traces: 4096, actionsPerTrace: 64, invariantViolations: 0 },
  wraparoundCampaign: { startSeed: wrapped.startSeed, traces: 32, invariantViolations: 0 },
  replayDeterminism: 'pass', abiInputValidation: 'pass',
  scope: 'Intentional model mutants; finite bounded campaigns; no claim of exhaustive security or globally shortest reduction.' };
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/verification.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
