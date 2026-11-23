// Discover contract addresses from a dapp's own frontend. The site is the canonical source
// of the addresses it talks to, so this beats block-scanning for finding new casinos and
// prediction markets. Read-only: fetch HTML, then a bounded number of JS chunks, regex
// addresses, optionally keep only ones that have code on-chain.
//
//   node scripts/frontend-addresses.mjs https://example.gg [--max-chunks 60] [--rpc URL]
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const url = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
const MAX = Number(arg('max-chunks', '60'));
const RPC = arg('rpc');
if (!url) {
  console.error('usage: node scripts/frontend-addresses.mjs https://site [--max-chunks N] [--rpc URL]');
  process.exit(1);
}

const ADDR = /0x[0-9a-fA-F]{40}/g;
const origin = new URL(url).origin;

const text = async (u) => {
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; feguard/1.0)' } });
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return r.text();
};

const html = await text(url);
const scripts = [...new Set([...html.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((m) => m[1]))]
  .map((s) => (s.startsWith('http') ? s : origin + (s.startsWith('/') ? s : '/' + s)))
  .slice(0, MAX);

console.log(`html ${html.length} bytes, js chunks ${scripts.length} (of ${MAX} cap)`);

const found = new Map();
const add = (src, body) => {
  for (const m of body.matchAll(ADDR)) {
    const a = m[0].toLowerCase();
    if (!found.has(a)) found.set(a, new Set());
    found.get(a).add(src);
  }
};
add('html', html);

let i = 0;
async function worker() {
  while (i < scripts.length) {
    const s = scripts[i++];
    try {
      add(s, await text(s));
    } catch {
      /* one broken chunk must not stop the sweep */
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

let addresses = [...found.keys()];
console.log(`distinct addresses: ${addresses.length}`);

if (RPC) {
  const code = async (a) => {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [a, 'latest'] }),
    });
    const j = await r.json();
    return j.result && j.result !== '0x';
  };
  const keep = [];
  let k = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (k < addresses.length) {
        const a = addresses[k++];
        if (await code(a)) keep.push(a);
      }
    }),
  );
  addresses = keep;
  console.log(`with code on-chain: ${addresses.length}`);
}

for (const a of addresses) console.log(`${a}  from=${[...found.get(a)].length} chunk(s)`);
