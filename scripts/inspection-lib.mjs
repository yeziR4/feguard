import { createHash } from 'node:crypto';
import { evaluate, summarize, changesSince, formatValue } from '../inspection/policy.mjs';

export const ALLOWED_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call']);
// Canonical ABI selectors and role hashes, checked with Foundry `cast sig` and
// `cast keccak`. No hashing with SHA3-256 (which is not Ethereum Keccak).
const SIG = { owner: '0x8da5cb5b', pendingOwner: '0xe30c3978', delay: '0xf27a0c92', hasRole: '0x91d14854', roleAdmin: '0x248a9ca3', threshold: '0xe75235b8', owners: '0xa0e67e2b' };
const ROLES = {
  proposer: '0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1',
  executor: '0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63',
  canceller: '0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783',
  admin: '0x' + '0'.repeat(64),
};
const SLOTS = {
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
};
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const pad = value => BigInt(value).toString(16).padStart(64, '0');
const observation = (state, value = '0', detail) => ({ state, value: String(value), ...(detail ? { detail } : {}) });

export function validatePolicy(policy) {
  if (policy.schemaVersion !== 1 || policy.adapter !== 'oz5-governance-observations-v1') throw new Error('Unsupported policy adapter/schema.');
  if (!/^[a-z0-9-]+$/.test(policy.id) || !Number.isSafeInteger(policy.chainId) || policy.chainId < 1) throw new Error('Invalid policy identity or chain.');
  for (const key of ['router', 'proxyAdmin', 'timelock', 'safe', 'deployer', 'handler', 'handlerAdmin']) {
    if (!ADDRESS.test(policy.addresses?.[key]) || BigInt(policy.addresses[key]) === 0n) throw new Error(`Invalid ${key} address.`);
  }
  if (Object.values(policy.addresses).some(a => !ADDRESS.test(a))) throw new Error('Invalid contract address.');
  if (!Array.isArray(policy.ownership) || policy.ownership.length > 50) throw new Error('Invalid ownership policy.');
  for (const item of policy.ownership) {
    if (!ADDRESS.test(policy.addresses[item.contract]) || !ADDRESS.test(policy.addresses[item.owner]) || typeof item.twoStep !== 'boolean') throw new Error('Invalid ownership edge.');
  }
  if (!/^\d+$/.test(policy.minimumDelaySeconds) || BigInt(policy.minimumDelaySeconds) >= 1n << 256n) throw new Error('Invalid delay.');
  if (!Array.isArray(policy.sources) || !policy.sources.length || !policy.sources.every(x => new URL(x).protocol === 'https:')) throw new Error('Policy requires HTTPS evidence links.');
  return policy;
}

export function safeEndpoint(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Use a public HTTPS RPC origin without credentials, query or path.');
  return url.origin;
}

export class Rpc {
  constructor(url, transport = fetch) { this.url = safeEndpoint(url); this.transport = transport; this.evidence = []; this.id = 0; }
  async read(method, params) {
    if (!ALLOWED_METHODS.has(method)) throw new Error(`Read-only RPC rejected ${method}.`);
    const request = { jsonrpc: '2.0', id: ++this.id, method, params };
    let response;
    try {
      const http = await this.transport(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(12000) });
      if (!http.ok) throw new Error(`HTTP ${http.status}`);
      const body = await http.text();
      if (body.length > 250000) throw new Error('Oversized RPC response.');
      response = JSON.parse(body);
      if (response.jsonrpc !== '2.0' || response.id !== request.id || (('result' in response) === ('error' in response))) throw new Error('Malformed RPC envelope.');
    } catch (error) {
      // Never serialize arbitrary fetch errors, which can contain credentials.
      response = { error: { code: -1, message: error.name === 'TimeoutError' ? 'Read timed out' : 'RPC transport or response failure' } };
    }
    this.evidence.push({ request, response });
    return response;
  }
}

export function decode(value, type = 'uint') {
  if (type === 'code') {
    if (typeof value !== 'string' || !/^0x(?:[a-f0-9]{2})*$/i.test(value)) throw new Error('Malformed runtime code.');
    return value === '0x' ? '0' : '1';
  }
  if (type === 'owners') {
    if (typeof value !== 'string' || !/^0x(?:[a-f0-9]{64})+$/i.test(value)) throw new Error('Malformed address array.');
    const words = value.slice(2).match(/.{64}/g);
    if (words.length < 2 || BigInt('0x' + words[0]) !== 32n) throw new Error('Invalid array offset.');
    const count = BigInt('0x' + words[1]);
    if (count > 100n || words.length !== Number(count) + 2) throw new Error('Invalid owner count.');
    const owners = words.slice(2).map(w => { if (!/^0{24}[a-f0-9]{40}$/i.test(w) || BigInt('0x' + w) === 0n) throw new Error('Invalid owner.'); return w.toLowerCase(); });
    if (new Set(owners).size !== owners.length) throw new Error('Duplicate Safe owner.');
    return String(count);
  }
  if (typeof value !== 'string' || !WORD.test(value)) throw new Error('Expected one ABI word.');
  const n = BigInt(value);
  if (type === 'address' && n >= 1n << 160n) throw new Error('Invalid address padding.');
  if (type === 'bool' && n !== 0n && n !== 1n) throw new Error('Invalid boolean.');
  return String(n);
}

export function reconcile(results) {
  const known = results.filter(r => r.state === 0);
  if (known.length > 1 && new Set(known.map(r => r.value)).size > 1) return observation(5, '0', 'Providers returned different values at the pinned block.');
  if (results.every(r => r.state === 0)) return known[0];
  if (known.length) return observation(1, '0', 'Only some required providers returned a valid value.');
  const state = results.every(r => r.state === results[0].state) ? results[0].state : 1;
  return observation(state, '0', 'No corroborated observation available.');
}

export function specifications(policy) {
  const a = policy.addresses;
  const specs = [];
  const call = (id, label, kind, target, data, type, expected) => specs.push({ id, label, kind, target, method: 'eth_call', data, type, expected: String(BigInt(expected)) });
  for (const [key, target] of Object.entries(a)) {
    if (key !== 'deployer') specs.push({ id: `code.${key}`, label: `${key}: deployed runtime exists`, kind: 8, target, method: 'eth_getCode', type: 'code', expected: '1' });
  }
  for (const edge of policy.ownership) {
    call(`owner.${edge.contract}`, `${edge.contract}: reported owner is ${edge.owner}`, 1, a[edge.contract], SIG.owner, 'address', a[edge.owner]);
    if (edge.twoStep) call(`pending.${edge.contract}`, `${edge.contract}: no unfinished ownership handoff`, 5, a[edge.contract], SIG.pendingOwner, 'address', a[edge.owner]);
  }
  call('delay', 'Timelock: minimum delay is at least the documented 48 hours', 2, a.timelock, SIG.delay, 'uint', policy.minimumDelaySeconds);
  specs.push({ id: 'slot.admin', label: 'Router: ERC-1967 admin slot matches published ProxyAdmin (storage only)', kind: 6, target: a.router, method: 'eth_getStorageAt', slot: SLOTS.admin, type: 'address', expected: String(BigInt(a.proxyAdmin)) });
  specs.push({ id: 'slot.implementation', label: 'Router: implementation slot is nonzero (identity not certified)', kind: 7, target: a.router, method: 'eth_getStorageAt', slot: SLOTS.implementation, type: 'address', expected: '0' });
  for (const [name, role] of Object.entries(ROLES)) {
    const members = name === 'admin'
      ? [['timelock', 1], ['safe', 0], ['deployer', 0], ['proxyAdmin', 0], ['zero', 0]]
      : [['safe', 1], ['deployer', 0], ['zero', 0]];
    for (const [who, required] of members) {
      const account = who === 'zero' ? 0 : a[who];
      call(`role.${name}.${who}`, `Timelock: ${who} ${required ? 'has' : 'does not have'} ${name} role`, required ? 3 : 4, a.timelock, SIG.hasRole + role.slice(2) + pad(account), 'bool', required);
    }
    if (name !== 'admin') call(`roleAdmin.${name}`, `Timelock: ${name} role is administered by DEFAULT_ADMIN_ROLE`, 10, a.timelock, SIG.roleAdmin + role.slice(2), 'uint', 0);
  }
  call('safe.threshold', 'Safe: reported threshold is within the reported owner count', 9, a.safe, SIG.threshold, 'uint', 0);
  // Auxiliary acquisition, used as expected owner-count for the threshold rule.
  specs.push({ id: 'safe.owners', target: a.safe, method: 'eth_call', data: SIG.owners, type: 'owners', auxiliary: true });
  return specs;
}

function validBlock(block) {
  return block && QUANTITY.test(block.number) && /^0x[\da-f]{64}$/i.test(block.hash) && QUANTITY.test(block.timestamp);
}

export async function collect(policy, rpcs, engine, engineHash, policyHash, { block, previous } = {}) {
  validatePolicy(policy);
  if (rpcs.length < 2 || new Set(rpcs.map(r => r.url)).size !== rpcs.length) throw new Error('Use at least two distinct public RPC origins.');
  const chains = await Promise.all(rpcs.map(r => r.read('eth_chainId', [])));
  if (chains.some(r => typeof r.result !== 'string' || !QUANTITY.test(r.result) || BigInt(r.result) !== BigInt(policy.chainId))) throw new Error('Chain ID unavailable or different from policy; no assessments produced.');
  let tag;
  if (block !== undefined) {
    if (!/^\d+$/.test(String(block))) throw new Error('Block must be a nonnegative decimal integer.');
    tag = '0x' + BigInt(block).toString(16);
  } else {
    const finalized = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', ['finalized', false])));
    if (finalized.some(r => !validBlock(r.result))) throw new Error('Finalized block unavailable. Supply a reviewed --block explicitly; there is no silent latest fallback.');
    const lower = finalized.map(r => BigInt(r.result.number)).reduce((a, b) => a < b ? a : b);
    tag = '0x' + lower.toString(16);
  }
  const blocks = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', [tag, false])));
  if (blocks.some(r => !validBlock(r.result) || r.result.number !== tag) || new Set(blocks.map(r => r.result.hash.toLowerCase())).size !== 1) throw new Error('Pinned block is unavailable or providers disagree; no assessments produced.');
  const specs = specifications(policy);
  // Keep requests bounded, with at most one request per provider in flight.
  const all = await Promise.all(rpcs.map(async rpc => {
    const values = new Map();
    for (const spec of specs.filter(s => s.type === 'code')) {
      const raw = await rpc.read(spec.method, [spec.target, tag]);
      try { values.set(spec.id, raw.error ? observation(1) : observation(0, decode(raw.result, 'code'))); }
      catch { values.set(spec.id, observation(3)); }
    }
    for (const spec of specs.filter(s => s.type !== 'code')) {
      const codeSpec = specs.find(s => s.type === 'code' && s.target.toLowerCase() === spec.target.toLowerCase());
      const code = values.get(codeSpec.id);
      if (code.state !== 0 || code.value !== '1') { values.set(spec.id, observation(code.state || 6)); continue; }
      const params = spec.method === 'eth_call' ? [{ to: spec.target, data: spec.data }, tag] : [spec.target, spec.slot, tag];
      const raw = await rpc.read(spec.method, params);
      if (raw.error) { values.set(spec.id, observation(raw.error.code === 3 ? 2 : 1)); continue; }
      try { values.set(spec.id, observation(0, decode(raw.result, spec.type))); }
      catch { values.set(spec.id, observation(3)); }
    }
    return values;
  }));
  const checks = specs.filter(s => !s.auxiliary).map(spec => {
    let obs = reconcile(all.map(values => values.get(spec.id)));
    let expected = spec.expected;
    if (spec.id === 'safe.threshold') {
      const owners = reconcile(all.map(values => values.get('safe.owners')));
      if (owners.state !== 0) obs = owners;
      else expected = owners.value;
    }
    const check = { id: spec.id, label: spec.label, target: spec.target, kind: spec.kind, expected, observation: obs };
    return { ...check, assessment: evaluate(engine, check) };
  });
  for (const [id, label] of [
    ['coverage.runtime', 'Runtime equivalence and actual immutable proxy admin'],
    ['coverage.roles', 'Exclusive role membership beyond the sampled addresses'],
  ]) {
    const check = { id, label, kind: 1, expected: '0', observation: observation(4) };
    checks.push({ ...check, assessment: evaluate(engine, check) });
  }
  // Confirm the number still denotes the same block after all pinned reads.
  const after = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', [tag, false])));
  if (after.some(r => r.result?.hash?.toLowerCase() !== blocks[0].result.hash.toLowerCase())) throw new Error('Block changed during collection; discard observations and rerun.');
  const report = {
    schemaVersion: 1, project: policy.project, policyId: policy.id, scope: policy.scope,
    chainId: policy.chainId, collectedAt: new Date().toISOString(),
    block: { number: String(BigInt(tag)), hash: blocks[0].result.hash, timestamp: new Date(Number(BigInt(blocks[0].result.timestamp)) * 1000).toISOString(), selection: block === undefined ? 'lowest common finalized height' : 'explicit height; finality not asserted' },
    policySha256: policyHash, engineSha256: engineHash, sources: policy.sources,
    providers: rpcs.map(r => r.url), checks, summary: summarize(checks), limitations: policy.limitations,
    provenance: 'Independent public-data assessment. No affiliation, customer relationship, team contact, transaction signing or submission.',
    evidence: rpcs.map(r => ({ provider: r.url, reads: r.evidence })),
  };
  if (previous) report.changes = { previousBlock: previous.block, observations: changesSince(report, previous) };
  return report;
}

export function markdown(report) {
  const lines = [`# ${report.project}: independent deployment check`, '', report.scope, '', `Block **${report.block.number}**, ${report.block.timestamp}`, `Block hash: \`${report.block.hash}\``, '', `Results: ${Object.entries(report.summary).map(([k, v]) => `${v} ${k}`).join(' · ')}. A matching observation is not a security certification.`, '', '## Review queue', ''];
  const queue = report.checks.filter(c => c.assessment.status !== 'meets');
  if (!queue.length) lines.push('No action indicated by the covered observations.');
  for (const c of queue) lines.push(`- **${c.assessment.status.toUpperCase()} — ${c.label}**: ${c.assessment.nextStep}`);
  lines.push('', '## Evidence', '', '| Check | Result | Observed | Policy condition |', '| --- | --- | --- | --- |');
  for (const c of report.checks) lines.push(`| ${c.label} | ${c.assessment.status} | ${formatValue(c)} | ${formatValue(c, true)} |`);
  lines.push('', '## Limits', '', ...report.limitations.map(x => `- ${x}`), '', '## Sources', '', ...report.sources.map(x => `- ${x}`), '', report.provenance, '');
  return lines.join('\n');
}
