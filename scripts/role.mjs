// Resolve the deployment role of one or more addresses (proxy / plain, initialized or
// not, value-bearing or not). Read-only, two providers, pinned block. Decision in Fe.
//
//   node scripts/role.mjs 0xADDR [0xADDR ...] [--token 0xERC20] [--chain 56]
//   node scripts/role.mjs 0xADDR --rpcs https://a,https://b --json out.json
import { readFile, writeFile } from 'node:fs/promises';
import { loadEngine } from '../demo/client.mjs';
import { resolveRoles } from './role-lib.mjs';

const DEFAULT_RPCS = 'https://bsc-dataseed.bnbchain.org,https://bsc-dataseed.defibit.io';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Positional arguments only; skip every `--flag value` pair so a --token address is not
// also resolved as a target.
const addresses = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { i++; continue; }
  if (/^0x[0-9a-fA-F]{40}$/.test(args[i])) addresses.push(args[i]);
}
if (addresses.length === 0) {
  console.error('usage: node scripts/role.mjs 0xADDRESS [...] [--token 0x...] [--chain 56] [--rpcs a,b] [--json path]');
  process.exitCode = 1;
} else {
  const chainId = Number(opt('chain', '56'));
  const rpcUrls = opt('rpcs', DEFAULT_RPCS).split(',').map((s) => s.trim()).filter(Boolean);
  const token = opt('token');
  const jsonPath = opt('json');

  const bytes = await readFile(new URL('../demo/engine/feguard.wasm', import.meta.url));
  const engine = await loadEngine(bytes);
  const out = await resolveRoles(chainId, addresses, { engine, rpcUrls, token });

  console.log(`chain ${out.chainId}  block ${out.block.number}  ${out.block.hash}`);
  for (const row of out.rows) {
    const e = row.evidence;
    console.log(`${row.address}  [${row.verdict.code}] ${row.verdict.label}  (${row.verdict.category})`);
    console.log(`  bits=${row.bits} proxy=${e.isProxy} initialized=${e.initialized} native=${e.nativeValue} token=${row.tokenBalance ?? 'n/a'} impl=${row.impl}`);
  }

  if (jsonPath) {
    await writeFile(jsonPath, JSON.stringify({ schemaVersion: 1, ...out }, null, 2) + '\n');
    console.log(`wrote ${jsonPath}`);
  }
}
