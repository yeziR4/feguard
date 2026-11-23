// Classify contracts using Etherscan's verified ABI (covers contracts Sourcify does not).
// Needs ETHERSCAN_KEY in the environment; never store the key in the repo.
//
//   set ETHERSCAN_KEY=...
//   node scripts/classify-etherscan.mjs --chain 137 0xADDR [...]
import { classifyNames } from './classify.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const KEY = process.env.ETHERSCAN_KEY;
const CHAIN = arg('chain', '137');
const BASE = 'https://api.etherscan.io/v2/api';
const addresses = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));

if (!KEY) {
  console.error('ETHERSCAN_KEY is not set');
  process.exit(1);
}

const rows = [];
for (const address of addresses) {
  const url = `${BASE}?chainid=${CHAIN}&module=contract&action=getabi&address=${address}&apikey=${KEY}`;
  let row = { address, chain: CHAIN };
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.status !== '1') {
      row = { ...row, cls: 'unverified', message: j.result || j.message };
    } else {
      const abi = JSON.parse(j.result);
      const names = abi.filter((x) => x.type === 'function').map((x) => x.name).filter(Boolean);
      row = { ...row, ...classifyNames(names), functions: names.length };
    }
  } catch (e) {
    row = { ...row, cls: 'error', error: String(e.message) };
  }
  rows.push(row);
  console.log(`${address}  ${row.cls}  (casino ${row.casinoScore ?? '-'} / market ${row.marketScore ?? '-'})  fn=${row.functions ?? '-'}${row.hits?.length ? '  [' + row.hits.slice(0, 6).join(', ') + ']' : ''}`);
  await new Promise((r) => setTimeout(r, 220)); // stay under 5 req/s
}
