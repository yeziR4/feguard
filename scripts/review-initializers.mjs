import { readFile, writeFile } from 'node:fs/promises';
import { loadEngine } from '../demo/client.mjs';
import { sha256 } from './inspection-lib.mjs';
import { runInitializationReview } from './initialization-lib.mjs';
try {
  const plan = JSON.parse(await readFile(new URL('../policies/initialization-review.json', import.meta.url)));
  const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../demo/engine/feguard.manifest.json', import.meta.url)));
  if (sha256(bytes) !== manifest.module.sha256) throw new Error('Engine digest mismatch.');
  const engine = await loadEngine(bytes);
  const report = await runInitializationReview(plan, engine, sha256(bytes), { rpcUrls: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.defibit.io'] });
  await writeFile(new URL('../reports/initialization-review.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ block: report.block, summary: report.summary }, null, 2));
} catch (error) { console.error('Initialization review failed: ' + error.message); process.exitCode = 1; }
