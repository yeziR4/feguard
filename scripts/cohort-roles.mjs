// Resolve the deployment role of every contract in the saved cohort, in one pass.
// Read-only, two providers, pinned block; classification is Fe (fg_role).
//
//   node scripts/cohort-roles.mjs [--limit N] [--concurrency N]
import { readFile, writeFile } from 'node:fs/promises';
import { Rpc } from './inspection-lib.mjs';
import { pin } from './cohort-lib.mjs';
import { probeRole } from './role-lib.mjs';
import { loadEngine } from '../demo/client.mjs';

const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const RPCS = [
  process.env.RPC_A || 'https://bsc-dataseed.bnbchain.org',
  process.env.RPC_B || 'https://bsc-dataseed.defibit.io',
];
const LOAD = new URL('../reports/cohort.json', import.meta.url);
const cohort = JSON.parse(await readFile(LOAD, 'utf8'));
const limit = Number(arg('limit') || 0);
const concurrency = Number(arg('concurrency') || 6);

let addresses = [...new Set(cohort.candidates.map((c) => c.address.toLowerCase()))];
if (limit > 0) addresses = addresses.slice(0, limit);

const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
const engine = await loadEngine(bytes);
const rpcs = RPCS.map((u) => new Rpc(u));
const block = await pin(rpcs, cohort.chainId);

console.log(`cohort ${addresses.length} addresses | chain ${cohort.chainId} | block ${block.number}`);

const rows = [];
let cursor = 0;
async function worker() {
  while (cursor < addresses.length) {
    const address = addresses[cursor++];
    try {
      const r = await probeRole(address, rpcs, block, engine);
      rows.push({
        address,
        bits: r.bits,
        code: r.verdict.code,
        category: r.verdict.category,
        label: r.verdict.label,
        isProxy: r.evidence.isProxy,
        initialized: r.evidence.initialized,
        native: r.evidence.nativeValue,
        impl: r.impl,
      });
    } catch (e) {
      rows.push({ address, code: 13, category: 'coverage-gap', label: 'probe failed', error: String(e.message || e) });
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const counts = {};
for (const r of rows) counts[r.code] = (counts[r.code] || 0) + 1;
const order = [9, 10, 11, 12, 13];
console.log('\nrole distribution:');
for (const code of order) {
  if (counts[code]) console.log(`  ${code.toString().padStart(2)} ${rows.find((r) => r.code === code).label}: ${counts[code]}`);
}

const critical = rows.filter((r) => r.code === 10);
console.log(`\nproxy instances that are uninitialized (code 10): ${critical.length}`);
for (const r of critical) console.log(`  ${r.address}  impl=${r.impl}  native=${r.native}`);

const out = new URL('../reports/cohort-roles.json', import.meta.url);
await writeFile(
  out,
  JSON.stringify(
    {
      schemaVersion: 1,
      chainId: cohort.chainId,
      block,
      sourceCohort: 'reports/cohort.json',
      engineSha256: cohort.engineSha256,
      providers: RPCS,
      summary: { total: rows.length, ...Object.fromEntries(order.filter((c) => counts[c]).map((c) => [`code_${c}`, counts[c]])) },
      rows: rows.sort((a, b) => a.code - b.code || a.address.localeCompare(b.address)),
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nwrote reports/cohort-roles.json`);
