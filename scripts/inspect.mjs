import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadEngine } from '../demo/client.mjs';
import { evaluate, summarize } from '../inspection/policy.mjs';
import { Rpc, collect, sha256, markdown, validatePolicy } from './inspection-lib.mjs';

const args = process.argv.slice(2);
const options = { rpc: [] };
const allowed = new Set(['policy', 'rpc', 'out', 'block', 'previous', 'replay']);
try {
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/inspect.mjs [--policy policies/gang-router.json] [--rpc HTTPS_ORIGIN (repeat)] [--block DECIMAL] [--out reports/name] [--previous reports/old.json] | --replay reports/name.json');
    const value = args[++i];
    if (key === 'rpc') options.rpc.push(value);
    else if (options[key] !== undefined) throw new Error(`Duplicate --${key}.`);
    else options[key] = value;
  }
  const wasm = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../demo/engine/feguard.manifest.json', import.meta.url)));
  const engineHash = sha256(wasm);
  if (engineHash !== manifest.module.sha256) throw new Error('Fe WASM digest does not match its compiler manifest.');
  const engine = await loadEngine(wasm);
  if (options.replay) {
    if (Object.keys(options).some(k => k !== 'rpc' && k !== 'replay') || options.rpc.length) throw new Error('--replay cannot be mixed with live collection options.');
    const report = JSON.parse(await readFile(resolve(options.replay), 'utf8'));
    for (const c of report.checks) {
      const assessment = evaluate(engine, c);
      if (JSON.stringify(assessment) !== JSON.stringify(c.assessment)) throw new Error(`Replay differs for ${c.id}.`);
    }
    if (JSON.stringify(summarize(report.checks)) !== JSON.stringify(report.summary)) throw new Error('Summary differs from the checks.');
    console.log(`Replayed ${report.checks.length} assessments in Fe. All recorded assessments match. This verifies deterministic evaluation, not RPC authenticity or freshness.`);
  } else {
    const rawPolicy = await readFile(resolve(options.policy || 'policies/gang-router.json'));
    const policy = validatePolicy(JSON.parse(rawPolicy));
    const urls = options.rpc.length ? options.rpc : policy.rpc;
    const rpcs = urls.map(url => new Rpc(url));
    const previous = options.previous ? JSON.parse(await readFile(resolve(options.previous), 'utf8')) : undefined;
    const report = await collect(policy, rpcs, engine, engineHash, sha256(rawPolicy), { block: options.block, previous });
    const out = resolve(options.out || `reports/${policy.id}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out + '.json', JSON.stringify(report, null, 2) + '\n');
    await writeFile(out + '.md', markdown(report));
    console.log(`${policy.project} at block ${report.block.number}: ${JSON.stringify(report.summary)}`);
    console.log(`Evidence: ${out}.json\nReview queue: ${out}.md`);
    for (const c of report.checks.filter(c => c.assessment.status !== 'meets')) console.log(`${c.assessment.status.toUpperCase()} ${c.id}: ${c.assessment.nextStep}`);
    if (report.changes) console.log(`Changed observations: ${report.changes.observations.length}`);
    process.exitCode = report.summary.mismatch || report.summary.conflict ? 2 : 0;
  }
} catch (error) {
  console.error(`Inspection failed: ${error.message}`);
  process.exitCode = 1;
}
