import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../demo/client.mjs';
import { triage } from '../inspection/cohort-policy.mjs';
import { evaluate } from '../inspection/policy.mjs';
import { sha256 } from './inspection-lib.mjs';
import { discover, runCohort } from './cohort-lib.mjs';
import { runInitializationReview } from './initialization-lib.mjs';
import { runFocused } from './focused-lib.mjs';
import { runController, verifyWorkflow } from './controller-lib.mjs';
import { buildMemory } from './workflow-memory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async p => JSON.parse(await readFile(resolve(root, p), 'utf8'));
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--resume', '--refresh'].includes(key)) { options[key.slice(2)] = true; continue; }
    if (!['--run', '--limit', '--previous', '--verify'].includes(key) || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/run.mjs --run ID [--limit 1-40] [--resume] [--previous reports/runs/ID/manifest.json] | --verify reports/workflow.json');
    options[key] = args[++i];
  }
  const bytes = await readFile(resolve(root, 'demo/engine/feguard.wasm')), engineHash = sha256(bytes);
  if ((await read('demo/engine/feguard.manifest.json')).module.sha256 !== engineHash) throw new Error('Fe engine digest mismatch.');
  const engine = await loadEngine(bytes);
  if (options['--verify']) {
    if (Object.keys(options).length !== 1) throw new Error('--verify is an offline-only command.');
    const manifest = await read(options['--verify']);
    const out = await verifyWorkflow(root, manifest);
    let decisions = 0;
    for (const c of out.screen.report.candidates) for (const o of c.observations) { if (triage(engine, o.kind, o).code !== o.triage.code) throw new Error('Cohort decision differs.'); decisions++; }
    for (const r of out.initializers.results) { if (triage(engine, r.rule, { state: r.state, value: r.flags }).code !== r.assessment.code) throw new Error('Initializer decision differs.'); decisions++; }
    for (const c of out.focused.checks) { if (JSON.stringify(evaluate(engine, c)) !== JSON.stringify(c.assessment)) throw new Error('Policy decision differs.'); decisions++; }
    if ([out.screen.report, out.initializers, out.focused].some(r => r.engineSha256 !== engineHash)) throw new Error('Run uses another Fe engine.');
    console.log(`Verified ${manifest.stages.length} artifact hashes and replayed ${decisions} Fe decisions offline. Raw RPC evidence remains available for independent review.`);
  } else {
    const id = options['--run'], limit = Number(options['--limit'] || 20);
    if (!id || !Number.isInteger(limit) || limit < 1 || limit > 40) throw new Error('Choose --run ID and a bounded --limit 1–40.');
    const plan = await read('policies/initialization-review.json'), focused = await read('policies/focused-review.json');
    const baseline = await read('reports/cohort.json'), dispositions = await read('reports/case-dispositions.json');
    const policyDispositions = await read('reports/policy-dispositions.json');
    const previousManifest = options['--previous'] ? await read(options['--previous']) : null;
    const previous = previousManifest ? await verifyWorkflow(root, previousManifest) : null;
    if (options.refresh && !previous) throw new Error('--refresh requires --previous to reuse its captured discovery population.');
    const paths = [...(await readdir(resolve(root, 'scripts'))).filter(p => p.endsWith('.mjs')).map(p => 'scripts/' + p), 'demo/client.mjs', 'demo/engine/feguard.wasm', 'inspection/policy.mjs', 'inspection/cohort-policy.mjs', 'policies/initialization-review.json', 'policies/focused-review.json', 'reports/cohort.json', 'reports/case-dispositions.json', 'reports/quickminey-proxy-context.json', 'reports/prospect-qualification.json'];
    paths.push('reports/policy-dispositions.json');
    const digests = await Promise.all(paths.sort().map(async p => [p, sha256(await readFile(resolve(root, p)))]));
    for (const c of dispositions.cases) if (c.evidenceSha256 !== digests.find(([p]) => p === 'reports/' + c.evidenceFile)?.[1]) throw new Error('Disposition evidence digest differs.');
    const fingerprint = sha256(JSON.stringify({ limit, refresh: !!options.refresh, digests, previous: previousManifest ? sha256(JSON.stringify(previousManifest)) : null }));
    const rpcUrls = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.defibit.io'];
    const references = Object.fromEntries(digests.filter(([p]) => p.startsWith('reports/')));
    for (const c of dispositions.cases) if (references['reports/' + c.evidenceFile] !== c.evidenceSha256) throw new Error('Historical case evidence digest mismatch.');
    const result = await runController({ root, id, fingerprint, resume: options.resume, progress: console.log, stages: [
      { id: 'qualification', run: () => read('reports/prospect-qualification.json'), summary: r => ({ acceptedProjectRepositories: r.accepted.length, deferredEntries: r.deferred.length, note: r.note }) },
      { id: 'discovery', run: () => options.refresh ? Promise.resolve({ ...previous.discovery, cached: true }) : discover({ limit, cache: resolve(root, 'out/controller-cache', id), progress: console.log }), summary: r => ({ listed: r.candidates.length, source: r.url, note: options.refresh ? 'Reused captured metadata; runtime and state are refreshed.' : 'Recently verified, not necessarily recently deployed.' }) },
      { id: 'screen', run: o => runCohort(o.discovery, engine, engineHash, { rpcUrls, previous: previous?.screen.report || baseline, progress: console.log }), summary: r => ({ ...r.report.summary, block: r.report.block }) },
      { id: 'initializers', run: () => runInitializationReview(plan, engine, engineHash, { rpcUrls }), summary: r => ({ ...r.summary, block: r.block, note: 'Fixed reviewed plan; deployment impact requires context.' }) },
      { id: 'focused', run: () => runFocused(focused, engine, engineHash, { rpcUrls }), summary: r => ({ ...r.summary, block: r.block, scopes: [...new Set(r.checks.map(c => c.scope))], exceptions: r.checks.filter(c => c.assessment.status !== 'meets').map(c => ({ id: c.id, address: c.address, status: c.assessment.status, claim: c.claim, source: c.source })), confirmedImpactFindings: 0 }) },
      { id: 'memory', run: o => buildMemory({ cohort: o.screen.report, initialization: o.initializers, focused: o.focused, dispositions, policyDispositions, baseline, previous: previous?.memory, baselineReferences: references }), summary: r => ({ ...r.summary, queue: r.queue, explained: r.records.filter(r => r.status === 'explained-change'), note: 'Retains historical case context; never promotes a simulation into confirmed impact.' }) },
    ] });
    console.log(JSON.stringify({ run: id, status: result.manifest.status, memory: result.outputs.memory.summary, focused: result.outputs.focused.summary }, null, 2));
    console.log('Published reports/workflow.json. Resume the same ID after interruptions; use a new ID for changed inputs.');
  }
} catch (e) { console.error('Controller stopped: ' + e.message); process.exitCode = 1; }
