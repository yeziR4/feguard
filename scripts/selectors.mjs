// Classify contracts that have NO verified source: pull the 4-byte selectors straight out
// of the runtime bytecode's dispatch table (PUSH4 <sel> EQ), resolve them with 4byte.directory,
// and reuse the same shape rules as classify.mjs. This is the path for brand-new deployments
// that are not on Sourcify/Etherscan yet.
//
//   node scripts/selectors.mjs --chain 56 --rpc https://bsc-dataseed.bnbchain.org 0xADDR [...]
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classifyNames } from './classify.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const RPC = arg('rpc', 'https://bsc-dataseed.bnbchain.org');
const CACHE_PATH = new URL('../reports/selectors-cache.json', import.meta.url);
// Extract selectors from the Solidity dispatch table: PUSH4 <sel> EQ.
export function dispatchSelectors(code) {
  const hex = String(code || '').replace(/^0x/, '').toLowerCase();
  const out = new Set();
  for (const m of hex.matchAll(/63([0-9a-f]{8})14/g)) out.add(m[1]);
  return [...out];
}

// Guarded entry: importing this module for dispatchSelectors must not run a scan.
const isEntry = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntry) {
const addresses = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
if (!addresses.length) {
  console.error('usage: node scripts/selectors.mjs --rpc URL 0xADDR [...]');
  process.exit(1);
}

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

let cache = {};
try {
  cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
} catch {
  cache = {};
}

async function resolve(sel) {
  if (cache[sel] !== undefined) return cache[sel];
  try {
    const r = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=0x${sel}`);
    const j = await r.json();
    const name = j.results && j.results.length ? j.results[0].text_signature : null;
    cache[sel] = name;
    await new Promise((res) => setTimeout(res, 120));
    return name;
  } catch {
    cache[sel] = null;
    return null;
  }
}

const summaries = [];
for (const address of addresses) {
  const code = await rpc('eth_getCode', [address, 'latest']);
  const selectors = dispatchSelectors(code);
  const names = [];
  let cursor = 0;
  async function worker() {
    while (cursor < selectors.length) {
      const sel = selectors[cursor++];
      const sig = await resolve(sel);
      if (sig) names.push(sig.slice(0, sig.indexOf('(')));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const uniq = [...new Set(names)];
  const verdict = classifyNames(uniq);
  summaries.push({ address, selectors: selectors.length, resolved: uniq.length, ...verdict });
  console.log(
    `${address}  selectors=${selectors.length} resolved=${uniq.length}  class=${verdict.cls} (casino ${verdict.casinoScore} / market ${verdict.marketScore})`,
  );
  if (verdict.hits.length) console.log(`   hits: ${verdict.hits.slice(0, 8).join(', ')}`);
}

await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
await writeFile(
  new URL('../reports/selector-classification.json', import.meta.url),
  JSON.stringify({ schemaVersion: 1, source: 'bytecode-dispatch+4byte', rows: summaries }, null, 2) + '\n',
);
console.log('\nwrote reports/selector-classification.json');
}
