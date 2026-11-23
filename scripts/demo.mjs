import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadEngine, campaign, feReproducer } from '../demo/client.mjs';

const flags = Object.create(null);
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--all' || key === '--verify') flags[key] = true;
  else if (['--target', '--seed', '--cases', '--steps', '--json', '--repro'].includes(key)) {
    if (i + 1 >= process.argv.length) throw new Error(`Missing value for ${key}`);
    flags[key] = process.argv[++i];
  } else throw new Error(`Unknown option ${key}`);
}
const engine = await loadEngine(await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url)));
const targets = flags['--all'] ? [1, 2, 3, 0] : [Number(flags['--target'] ?? 1)];
const reports = targets.map(target => campaign(engine, {
  target, seed: flags['--seed'] ?? '0', cases: Number(flags['--cases'] ?? 64), steps: Number(flags['--steps'] ?? 64),
}));
for (const r of reports) {
  if (!r.found) {
    console.log(`${r.targetName}: no failure found in ${r.casesChecked} traces of up to ${r.steps} actions.`);
    continue;
  }
  console.log(`${r.targetName}: ${r.failure}`);
  console.log(`  seed ${r.failingSeed}; failing prefix ${r.originalLength} -> ${r.reducedLength} actions; ${r.reductionReplays} reduction replays`);
  console.log(`  deletion-minimal: ${r.deletionMinimal}; corrected replay passes: ${r.correctedReplayPasses}`);
  for (const a of r.reducedTrace) console.log(`  ${a.index + 1}. ${a.action}(${a.value}) -> remaining=${a.state.remaining}, spent=${a.state.spent}, failure=${a.state.failure}`);
}
if (flags['--json']) {
  const destination = resolve(flags['--json']);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(flags['--all'] ? reports : reports[0], null, 2) + '\n');
}
if (flags['--repro']) {
  if (reports.length !== 1 || !reports[0].found) throw new Error('--repro needs one failing target.');
  const destination = resolve(flags['--repro']);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, feReproducer(reports[0]));
}
if (flags['--verify']) {
  for (const r of reports) {
    if (r.target === 0 ? r.found : (!r.found || r.failureCode !== r.target || !r.deletionMinimal || !r.correctedReplayPasses)) {
      throw new Error(`Expected demonstration outcome not met for target ${r.target}`);
    }
  }
  console.log('Verification passed: expected mutants detected; every reduced trace reproduces and passes on the corrected target.');
}
