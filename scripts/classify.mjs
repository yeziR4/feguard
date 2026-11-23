// Classify verified contracts by ABI shape, not by name. The point is to find newly
// verified casinos and prediction markets so they can be qualified before anyone deposits.
// Read-only; uses the Sourcify public API. No RPC, no keys.
//
//   node scripts/classify.mjs --chain 56 --limit 200
//   node scripts/classify.mjs --chain 56 0xADDR 0xADDR
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const CHAIN = Number(arg('chain', '56'));
const LIMIT = Number(arg('limit', '200'));
const API = 'https://sourcify.dev/server/v2';
const OUT = arg('json');

const j = async (url) => {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// Class scoring is intentionally about shape: a casino moves money on a random outcome,
// a market on a resolved outcome. Either can be named anything.
const CASINO = [
  [/^wager$/i, 2],
  [/^bet$|^placeBet$|^place_bet$/i, 1],
  [/fulfillRandomWords|rawFulfillRandomWords/i, 2],
  [/^roll$|^spin$|^flip$|^draw$|^coinToss$/i, 2],
  [/^cashOut$|^settleBet$|^resolveBet$/i, 1],
];
const MARKET = [
  [/^resolve$|^resolveMarket$|^settleMarket$/i, 2],
  [/^claim$|claimWinnings|redeemWinnings/i, 1],
  [/^market$|^markets$|^outcome$|^outcomes$|^question$|^questions$/i, 2],
  [/^splitPosition$|^mergePositions$|^redeemPositions$/i, 3],
  [/^buy$|^sell$|^buyShares$|^placeBet$|^stake$/i, 1],
];

function score(names, rules) {
  const hits = [];
  let total = 0;
  for (const [re, weight] of rules) {
    const m = names.filter((n) => re.test(n));
    if (m.length) {
      total += weight;
      hits.push(...m);
    }
  }
  return { total, hits: [...new Set(hits)] };
}

export function classifyNames(names) {
  const c = score(names, CASINO);
  const m = score(names, MARKET);
  const cls = c.total >= 3 && c.total > m.total ? 'casino' : m.total >= 3 && m.total > c.total ? 'prediction-market' : 'other';
  return {
    cls,
    casinoScore: c.total,
    marketScore: m.total,
    hits: cls === 'casino' ? c.hits : cls === 'prediction-market' ? m.hits : [],
  };
}

export function classifyAbi(abi) {
  const names = (abi || []).filter((x) => x.type === 'function').map((x) => x.name).filter(Boolean);
  return { ...classifyNames(names), functions: names.length };
}

// Guarded entry: importing this module (e.g. from selectors.mjs) must not run a scan.
const isEntry = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntry) {
const positional = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
let addresses = positional;
if (!addresses.length) {
  const list = await j(`${API}/contracts/${CHAIN}?limit=${LIMIT}`);
  addresses = (list.results || []).map((r) => r.address);
}
console.log(`classifying ${addresses.length} verified contracts on chain ${CHAIN}`);

const rows = [];
let i = 0;
async function worker() {
  while (i < addresses.length) {
    const address = addresses[i++];
    try {
      const r = await j(`${API}/contract/${CHAIN}/${address}?fields=abi`);
      rows.push({ address, ...classifyAbi(r.abi) });
    } catch (e) {
      rows.push({ address, cls: 'error', error: String(e.message) });
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

const counts = rows.reduce((acc, r) => ((acc[r.cls] = (acc[r.cls] || 0) + 1), acc), {});
console.log('\ncounts:', JSON.stringify(counts));

for (const cls of ['casino', 'prediction-market']) {
  const hits = rows.filter((r) => r.cls === cls);
  console.log(`\n${cls}: ${hits.length}`);
  for (const h of hits) {
    console.log(`  ${h.address}  casino=${h.casinoScore} market=${h.marketScore}  [${h.hits.slice(0, 8).join(', ')}]`);
  }
}

if (OUT) {
  await writeFile(OUT, JSON.stringify({ schemaVersion: 1, chainId: CHAIN, scanned: rows.length, counts, rows }, null, 2) + '\n');
  console.log(`\nwrote ${OUT}`);
}
}
