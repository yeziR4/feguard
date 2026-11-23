import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyWorkflow } from './controller-lib.mjs';
import { runFocused } from './focused-lib.mjs';
import { runCohort } from './cohort-lib.mjs';
import { loadEngine } from '../demo/client.mjs';
import { sha256 } from './inspection-lib.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = async p => JSON.parse(await readFile(new URL('../' + p, import.meta.url), 'utf8'));
const manifest = await read('reports/workflow.json');
const outputs = await verifyWorkflow(root, manifest);
const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url)), engine = await loadEngine(bytes);
function transports(providers) {
  return providers.map(p => {
    const rows = new Map(p.reads.map(r => [JSON.stringify([r.request.method, r.request.params]), r.response]));
    return async (_url, options) => {
      const request = JSON.parse(options.body), response = structuredClone(rows.get(JSON.stringify([request.method, request.params])));
      assert.ok(response, 'Request absent from captured evidence'); response.id = request.id;
      return { ok: true, text: async () => JSON.stringify(response) };
    };
  });
}
test('controller focused observations reproduce from captured RPC responses without a network', async () => {
  const r = outputs.focused;
  const actual = await runFocused(r.plan || await read('policies/focused-review.json'), engine, sha256(bytes), { rpcUrls: r.evidence.map(p => p.provider), transports: transports(r.evidence) });
  assert.deepEqual(actual.checks, r.checks); assert.deepEqual(actual.summary, r.summary);
});
test('controller discovery and screening reproduce from immutable metadata and captured RPC evidence', async () => {
  const { report, evidence } = outputs.screen;
  const actual = await runCohort(outputs.discovery, engine, sha256(bytes), { rpcUrls: report.providers, transports: transports(evidence.rpc) });
  assert.deepEqual(actual.report.candidates, report.candidates); assert.deepEqual(actual.report.summary, report.summary);
});
