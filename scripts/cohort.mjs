import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { discover, runCohort, cohortMarkdown, qualifyMetadata, validateListing } from './cohort-lib.mjs';
import { loadEngine } from '../demo/client.mjs';
import { sha256 } from './inspection-lib.mjs';

try {
  const args = process.argv.slice(2); const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (args[i] === '--cached') { options.cached = true; continue; }
    if (args[i] === '--refresh-seed') { options.refreshSeed = true; continue; }
    if (!['limit', 'cache', 'out', 'previous', 'after', 'seed'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || options[key] !== undefined) throw new Error('Usage: node scripts/cohort.mjs [--limit 1-200] [--cache DIR] [--cached] [--after MATCH_ID] [--seed EVIDENCE] [--previous REPORT] [--out PREFIX]');
    options[key] = args[++i];
  }
  const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../demo/engine/feguard.manifest.json', import.meta.url)));
  if (sha256(bytes) !== manifest.module.sha256) throw new Error('Fe engine manifest mismatch.');
  const engine = await loadEngine(bytes);
  const previous = options.previous ? JSON.parse(await readFile(resolve(options.previous), 'utf8')) : undefined;
  const seedBytes = options.seed ? await readFile(resolve(options.seed)) : null;
  const seed = seedBytes ? JSON.parse((options.seed.endsWith('.gz') ? gunzipSync(seedBytes) : seedBytes).toString('utf8')) : undefined;
  if (seed && (!Array.isArray(seed.discovery?.listing?.results) || !Array.isArray(seed.metadata) || seed.metadata.length > 1000)) throw new Error('Invalid or oversized seed evidence.');
  if (options.refreshSeed && !seed) throw new Error('--refresh-seed requires --seed evidence.');
  if (seed) validateListing(seed.discovery.listing, 56, 1000);
  const afterMatchId = options.after || seed?.discovery.listing.results.at(-1)?.matchId;
  const discovery = options.refreshSeed ? { url: seed.discovery.url, candidates: [], listing: { results: [] }, cached: true, pages: [] } : await discover({ limit: Number(options.limit || 100), cache: resolve(options.cache || 'out/cohort-cache'), cached: options.cached, afterMatchId, progress: console.log });
  if (!options.refreshSeed) discovery.pages = [{ url: discovery.url, count: discovery.listing.results.length }];
  if (seed) {
    const seen = new Set(discovery.candidates.map(c => c.discovery.address.toLowerCase()));
    const old = new Map(seed.metadata.map(c => [c.address.toLowerCase(), c]));
    const retained = seed.discovery.listing.results.filter(c => !seen.has(c.address.toLowerCase())).map(c => ({ discovery: c, metadata: old.get(c.address.toLowerCase())?.data, sourceUrl: old.get(c.address.toLowerCase())?.sourceUrl, qualificationIssues: qualifyMetadata(c, old.get(c.address.toLowerCase())?.data) }));
    discovery.candidates = [...retained, ...discovery.candidates];
    discovery.listing = { results: discovery.candidates.map(c => c.discovery) };
    discovery.pages = [...(seed.discovery.pages || [{ url: seed.discovery.url, count: retained.length }]), ...discovery.pages];
  }
  const { report, evidence } = await runCohort(discovery, engine, sha256(bytes), { rpcUrls: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed.defibit.io'], previous, progress: console.log });
  const out = resolve(options.out || 'reports/cohort');
  const evidenceBytes = JSON.stringify(evidence, null, 2) + '\n';
  const compressedEvidence = gzipSync(evidenceBytes);
  report.evidenceFile = out.split(/[\\/]/).at(-1) + '-evidence.json.gz';
  report.evidenceSha256 = sha256(compressedEvidence);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out + '-evidence.json.gz', compressedEvidence);
  await writeFile(out + '.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile(out + '.md', cohortMarkdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Saved ${out}.json and .md; raw public evidence in ${out}-evidence.json.gz`);
} catch (error) { console.error('Batch failed: ' + error.message); process.exitCode = 1; }
