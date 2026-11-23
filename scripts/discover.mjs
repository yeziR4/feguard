// Discover newly deployed contracts and classify them by shape.
// Uses Etherscan V2 (free plan supports block-level proxy calls on Ethereum, Polygon and
// Arbitrum). For each contract created in the scanned range: classify from the verified ABI
// if available, otherwise report it as unverified with its bytecode selector count.
//
//   set ETHERSCAN_KEY=...
//   node scripts/discover.mjs --chain 137 --blocks 60 [--json reports/discover.json]
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classifyNames } from './classify.mjs';
import { dispatchSelectors } from './selectors.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const KEY = process.env.ETHERSCAN_KEY;
const CHAIN = arg('chain', '137');
const BLOCKS = Number(arg('blocks', '60'));
const OUT = arg('json');
const BASE = 'https://api.etherscan.io/v2/api';

let lastReq = 0;
async function api(params) {
  const wait = 210 - (Date.now() - lastReq);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  const r = await fetch(`${BASE}?chainid=${CHAIN}&${params}&apikey=${KEY}`);
  return r.json();
}

async function proxy(action, extra = '') {
  const j = await api(`module=proxy&action=${action}${extra}`);
  if (j.error) throw new Error(`${action}: ${j.error.message}`);
  if (j.result === undefined) throw new Error(`${action}: ${j.message || 'no result'}`);
  return j.result;
}

async function abiOf(address) {
  const j = await api(`module=contract&action=getabi&address=${address}`);
  if (j.status !== '1') return null;
  try {
    return JSON.parse(j.result);
  } catch {
    return null;
  }
}

export async function discover({ chain = 137, blocks = 60, key = KEY, log = () => {}, rpc = 'https://polygon-bor-rpc.publicnode.com' } = {}) {
  const base = 'https://api.etherscan.io/v2/api';
  const hex = (n) => '0x' + n.toString(16);
  let last2 = 0;
  const call = async (params) => {
    const wait = 210 - (Date.now() - last2);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last2 = Date.now();
    return (await fetch(`${base}?chainid=${chain}&${params}&apikey=${key}`)).json();
  };
  // Chain reads go to a real RPC: Etherscan's proxy truncates block transactions, which
  // undercounts deployments. Etherscan is used only for the verified ABI below.
  const px = async (method, params = []) => {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
    return j.result;
  };

  const latest = Number(BigInt(await px('eth_blockNumber')));
  const from = Math.max(0, latest - blocks + 1);
  log(`chain ${chain}: scanning blocks ${from}..${latest}`);

  const created = [];
  for (let b = from; b <= latest; b++) {
    const block = await px('eth_getBlockByNumber', [hex(b), true]);
    for (const tx of block?.transactions || []) {
      if (tx.to !== null) continue;
      const rec = await px('eth_getTransactionReceipt', [tx.hash]);
      if (rec?.contractAddress) created.push({ block: b, address: rec.contractAddress, deployer: tx.from });
    }
  }
  log(`created contracts in range: ${created.length}`);

  const rows = [];
  for (const c of created) {
    const abi = await abiOf(c.address);
    if (abi) {
      const names = abi.filter((x) => x.type === 'function').map((x) => x.name).filter(Boolean);
      rows.push({ ...c, verified: true, ...classifyNames(names), functions: names.length });
    } else {
      const code = await px('eth_getCode', [c.address, 'latest']);
      rows.push({ ...c, verified: false, cls: 'unverified', selectors: dispatchSelectors(code).length });
    }
  }
  return { chainId: chain, fromBlock: from, toBlock: latest, created: rows.length, rows };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!KEY) {
    console.error('ETHERSCAN_KEY is not set');
    process.exit(1);
  }
  const result = await discover({ chain: Number(CHAIN), blocks: BLOCKS, log: (m) => console.log(m) });
  const verified = result.rows.filter((r) => r.verified);
  console.log(`verified ${verified.length} / ${result.rows.length}`);
  for (const cls of ['casino', 'prediction-market']) {
    const hits = result.rows.filter((r) => r.cls === cls);
    console.log(`\n${cls}: ${hits.length}`);
    for (const h of hits) console.log(`  ${h.address}  deployer=${h.deployer}  [${(h.hits || []).slice(0, 6).join(', ')}]`);
  }
  const odd = verified.filter((r) => r.cls === 'prediction-market' || r.cls === 'casino');
  if (!odd.length) {
    console.log('\nno casino / prediction-market shape in this range (that is a coverage note, not a finding)');
  }
  if (OUT) {
    await writeFile(OUT, JSON.stringify({ schemaVersion: 1, ...result }, null, 2) + '\n');
    console.log(`wrote ${OUT}`);
  }
}
