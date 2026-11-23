import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Rpc, decode, reconcile, sha256 } from './inspection-lib.mjs';
import { triage, summarizeCohort } from '../inspection/cohort-policy.mjs';
export { triage, summarizeCohort } from '../inspection/cohort-policy.mjs';

export const SOURCE = 'https://sourcify.dev/server';
export const FIELDS = 'abi,deployment,compilation.name,compilation.fullyQualifiedName,compilation.language,runtimeBytecode.onchainBytecode,signatures.function';
const ADDRESS = /^0x[\da-f]{40}$/i;
const WORD = /^0x[\da-f]{64}$/i;
const HEX = /^0x(?:[\da-f]{2})*$/i;
const READS = [
  { name: 'owner', signature: 'owner()', selector: '0x8da5cb5b', type: 'address', kind: 4 },
  { name: 'pendingOwner', signature: 'pendingOwner()', selector: '0xe30c3978', type: 'address', kind: 1 },
  { name: 'initialized', signature: 'initialized()', selector: '0x158ef93e', type: 'bool', kind: 2 },
  { name: 'getMinDelay', signature: 'getMinDelay()', selector: '0xf27a0c92', type: 'uint256', kind: 3 },
];

export async function pool(items, count, fn) {
  let cursor = 0;
  const result = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; result[i] = await fn(items[i], i); }
  }));
  return result;
}

export async function getJson(url, transport = fetch) {
  const r = await transport(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Public source returned HTTP ${r.status}`);
  const body = await r.text();
  if (body.length > 1500000) throw new Error('Source response too large.');
  return JSON.parse(body);
}

export function validateListing(list, chainId, limit) {
  if (!list || !Array.isArray(list.results) || list.results.length > limit) throw new Error('Invalid discovery page.');
  const seen = new Set();
  for (const c of list.results) {
    if (!ADDRESS.test(c.address) || String(c.chainId) !== String(chainId) || !/^\d+$/.test(c.matchId) || !Number.isFinite(Date.parse(c.verifiedAt))) throw new Error('Invalid discovery item.');
    const key = c.address.toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate discovery address.');
    seen.add(key);
  }
  return list.results;
}

export function selectReads(metadata) {
  if (!Array.isArray(metadata.abi)) return [];
  return READS.flatMap(rule => {
    const abi = metadata.abi.filter(a => a.type === 'function' && a.name === rule.name && a.inputs?.length === 0 && a.outputs?.length === 1 && a.outputs[0].type === rule.type && ['view', 'pure'].includes(a.stateMutability));
    if (abi.length !== 1) return [];
    const signature = metadata.signatures?.function?.find(s => s.signature === rule.signature);
    const selector = rule.selector || signature?.signatureHash4;
    if (!/^0x[\da-f]{8}$/i.test(selector || '')) return [];
    if (rule.selector && signature && signature.signatureHash4.toLowerCase() !== rule.selector) return [];
    return [{ ...rule, selector }];
  });
}


export function qualifyMetadata(c, metadata) {
  const issues = [];
  if (!metadata || !ADDRESS.test(metadata.address || '') || metadata.address.toLowerCase() !== c.address.toLowerCase() || String(metadata.chainId) !== String(c.chainId)) issues.push('Metadata identity does not match discovery.');
  if (!['exact_match', 'match'].includes(metadata?.runtimeMatch)) issues.push('No accepted runtime verification match.');
  if (!HEX.test(metadata?.runtimeBytecode?.onchainBytecode || '') || metadata.runtimeBytecode.onchainBytecode === '0x') issues.push('Verified runtime bytes are unavailable.');
  return issues;
}

export async function discover({ chainId = 56, limit = 100, cache, cached = false, afterMatchId, progress = () => {} } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Discovery limit must be 1–200.');
  if (afterMatchId !== undefined && !/^\d+$/.test(afterMatchId)) throw new Error('Invalid discovery cursor.');
  const url = `${SOURCE}/v2/contracts/${chainId}?sort=desc&limit=${limit}${afterMatchId ? '&afterMatchId=' + afterMatchId : ''}`;
  await mkdir(join(cache, 'details'), { recursive: true });
  const listing = cached ? JSON.parse(await readFile(join(cache, 'list.json'), 'utf8')) : await getJson(url);
  const items = validateListing(listing, chainId, limit);
  if (!cached) await writeFile(join(cache, 'list.json'), JSON.stringify(listing, null, 2) + '\n');
  let done = 0;
  const candidates = await pool(items, 2, async c => {
    const detailsUrl = `${SOURCE}/v2/contract/${chainId}/${c.address}?fields=${FIELDS}`;
    const path = join(cache, 'details', c.address.toLowerCase() + '.json');
    try {
      let metadata;
      if (cached) { const saved = JSON.parse(await readFile(path, 'utf8')); metadata = saved.data; if (saved.httpStatus !== 200) throw new Error('Cached source request failed.'); }
      else { metadata = await getJson(detailsUrl); await writeFile(path, JSON.stringify({ url: detailsUrl, httpStatus: 200, data: metadata }, null, 2) + '\n'); }
      return { discovery: c, metadata, sourceUrl: detailsUrl, qualificationIssues: qualifyMetadata(c, metadata) };
    } catch { return { discovery: c, sourceUrl: detailsUrl, qualificationIssues: ['Public metadata unavailable or invalid.'] }; }
    finally { if (++done % 20 === 0) progress(`Metadata ${done}/${items.length}`); }
  });
  return { url, listing, candidates, cached };
}

function validBlock(block) { return block && /^0x[\da-f]+$/i.test(block.number) && WORD.test(block.hash || '') && /^0x[\da-f]+$/i.test(block.timestamp); }
export async function pin(rpcs, chainId) {
  if (rpcs.length !== 2 || rpcs[0].url === rpcs[1].url) throw new Error('Use two distinct public RPC origins.');
  const chains = await Promise.all(rpcs.map(r => r.read('eth_chainId', [])));
  if (chains.some(r => !/^0x[\da-f]+$/i.test(r.result || '') || BigInt(r.result) !== BigInt(chainId))) throw new Error('Chain mismatch/unavailable.');
  const finalized = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', ['finalized', false])));
  if (finalized.some(r => !validBlock(r.result))) throw new Error('Finalized block unavailable.');
  const height = finalized.map(r => BigInt(r.result.number)).reduce((a, b) => a < b ? a : b);
  const tag = '0x' + height.toString(16);
  const blocks = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', [tag, false])));
  if (blocks.some(r => !validBlock(r.result) || BigInt(r.result.number) !== height) || blocks[0].result.hash.toLowerCase() !== blocks[1].result.hash.toLowerCase()) throw new Error('Pinned block disagreement.');
  return { tag, number: String(height), hash: blocks[0].result.hash, timestamp: new Date(Number(BigInt(blocks[0].result.timestamp)) * 1000).toISOString() };
}

export async function screen(candidate, rpcs, block, engine, lookup = new Map()) {
  const c = candidate.discovery;
  const record = { address: c.address, chainId: Number(c.chainId), name: candidate.metadata?.compilation?.name || 'Unknown contract', verifiedAt: c.verifiedAt, deployment: candidate.metadata?.deployment || null, sourceUrl: candidate.sourceUrl, runtimeMatch: candidate.metadata?.runtimeMatch || null, qualificationIssues: [...candidate.qualificationIssues], observations: [], signals: [], confirmedFindings: [] };
  const code = await Promise.all(rpcs.map(r => r.read('eth_getCode', [c.address, block.tag])));
  const knownCode = code.every(r => typeof r.result === 'string' && HEX.test(r.result) && r.result !== '0x');
  const equalCode = knownCode && code[0].result.toLowerCase() === code[1].result.toLowerCase();
  const sourceCode = candidate.metadata?.runtimeBytecode?.onchainBytecode;
  record.runtimeCorroborated = Boolean(equalCode && sourceCode && code[0].result.toLowerCase() === sourceCode.toLowerCase() && !record.qualificationIssues.length);
  record.runtimeSha256 = equalCode ? sha256(Buffer.from(code[0].result.slice(2), 'hex')) : null;
  if (!record.runtimeCorroborated) {
    record.qualificationIssues.push('Deployed runtime is missing, conflicting, or not corroborated by the verification service.');
    record.coverage = 'not-qualified';
    return record;
  }
  let abiMetadata = candidate.metadata;
  if (['ERC1967Proxy', 'OrbitPlatformControlProxy', 'TransparentUpgradeableProxy'].includes(record.name)) {
    const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    const raw = await Promise.all(rpcs.map(r => r.read('eth_getStorageAt', [c.address, slot, block.tag])));
    const values = raw.map(r => { try { return { state: 0, value: decode(r.result, 'address') }; } catch { return { state: 1, value: '0' }; } });
    const implementation = reconcile(values);
    record.proxy = { state: implementation.state, implementation: implementation.state === 0 ? '0x' + BigInt(implementation.value).toString(16).padStart(40, '0') : null, interpretation: 'ERC-1967 implementation-slot observation; proxy behavior is not authenticated by the slot alone.' };
    const target = record.proxy.implementation ? lookup.get(record.proxy.implementation.toLowerCase()) : undefined;
    if (target && !target.qualificationIssues.length) {
      const codes = await Promise.all(rpcs.map(r => r.read('eth_getCode', [record.proxy.implementation, block.tag])));
      if (codes.every(r => r.result?.toLowerCase() === target.metadata.runtimeBytecode.onchainBytecode.toLowerCase())) {
        abiMetadata = target.metadata;
        record.proxy.abiSource = target.sourceUrl;
        record.proxy.implementationName = target.metadata.compilation?.name;
      }
    }
  }
  const reads = selectReads(abiMetadata);
  record.coverage = reads.length ? 'targeted-reads' : 'runtime-only';
  record.abiContext = abiMetadata === candidate.metadata ? 'direct verified ABI' : 'verified ABI from the observed implementation slot; delegation behavior remains unverified';
  for (const rule of reads) {
    const raw = await Promise.all(rpcs.map(r => r.read('eth_call', [{ to: c.address, data: rule.selector }, block.tag])));
    const values = raw.map(r => {
      if (r.error) return { state: r.error.code === 3 ? 2 : 1, value: '0' };
      try { return { state: 0, value: decode(r.result, rule.type === 'uint256' ? 'uint' : rule.type) }; }
      catch { return { state: 3, value: '0' }; }
    });
    const observation = reconcile(values);
    const result = triage(engine, rule.kind, observation);
    record.observations.push({ name: rule.name, selector: rule.selector, kind: rule.kind, ...observation, triage: result });
    if (result.code !== 0) record.signals.push({ fingerprint: `${c.chainId}:${c.address.toLowerCase()}:${rule.name}`, rule: rule.name, ...result });
  }
  return record;
}


export function incidents(current, previous) {
  const old = new Map((previous?.incidents || []).map(i => [i.fingerprint, i]));
  const active = current.candidates.flatMap(c => c.signals.filter(s => s.category === 'review').map(s => ({ ...s, address: c.address, name: c.name })));
  const result = active.map(signal => ({ ...signal, status: 'open-review', firstSeen: old.get(signal.fingerprint)?.firstSeen || current.collectedAt, lastSeen: current.collectedAt, seenRuns: (old.get(signal.fingerprint)?.seenRuns || 0) + 1 }));
  const fingerprints = new Set(active.map(s => s.fingerprint));
  for (const [fingerprint, incident] of old) {
    if (fingerprints.has(fingerprint)) continue;
    const candidate = current.candidates.find(c => c.address.toLowerCase() === incident.address.toLowerCase());
    const observation = candidate?.observations.find(o => o.name === incident.rule);
    const resolved = candidate?.runtimeCorroborated && observation?.state === 0 && observation.triage.code === 0;
    result.push({ ...incident, status: resolved ? 'signal-cleared' : 'unverified', lastChecked: current.collectedAt });
  }
  return result;
}

export async function runCohort(discovery, engine, engineHash, { chainId = 56, rpcUrls, progress = () => {}, previous, transports } = {}) {
  const rpcs = rpcUrls.map((url, i) => new Rpc(url, transports?.[i]));
  const block = await pin(rpcs, chainId);
  let done = 0;
  const lookup = new Map(discovery.candidates.map(c => [c.discovery.address.toLowerCase(), c]));
  const candidates = await pool(discovery.candidates, 3, async candidate => {
    const screened = await screen(candidate, rpcs, block, engine, lookup);
    if (++done % 10 === 0) progress(`Screened ${done}/${discovery.candidates.length}`);
    return screened;
  });
  const after = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', [block.tag, false])));
  if (after.some(r => r.result?.hash?.toLowerCase() !== block.hash.toLowerCase())) throw new Error('Block changed during batch; no report produced.');
  const report = { schemaVersion: 1, chainId, collectedAt: new Date().toISOString(), block, engineSha256: engineHash, providers: rpcUrls, discovery: { url: discovery.url, cached: discovery.cached, headMatchId: discovery.listing.results[0]?.matchId, tailMatchId: discovery.listing.results.at(-1)?.matchId }, summary: summarizeCohort(candidates), candidates, limitations: [
    'A bounded sample of recently verified contracts, not necessarily recently deployed contracts or independent projects.',
    'No full audits performed. ABI/runtime screening and targeted getter reads cannot establish application security.',
    'Runtime verification relies on Sourcify and matching code from two public RPC origins; provider independence and state proofs are not established.',
    'No documented project-specific policy is inferred from these generic screening rules. Review leads are not confirmed vulnerabilities.',
    'No outreach, signatures or transactions. Zero owner, pending recipient and false initialization require source/deployment context.',
    'Contracts outside the sample are not covered. An absent contract in a later sample cannot resolve an earlier incident.',
  ] };
  if (previous && previous.chainId !== chainId) throw new Error('Previous run is on a different chain.');
  report.incidents = incidents(report, previous);
  const evidence = { schemaVersion: 1, block, discovery: { url: discovery.url, pages: discovery.pages || [{ url: discovery.url, count: discovery.listing.results.length }], listing: discovery.listing }, metadata: discovery.candidates.map(c => ({ address: c.discovery.address, sourceUrl: c.sourceUrl, data: c.metadata, qualificationIssues: c.qualificationIssues })), rpc: rpcs.map(r => ({ provider: r.url, reads: r.evidence })) };
  return { report, evidence };
}

export function cohortMarkdown(report) {
  const s = report.summary;
  return [`# Public contract screening batch`, '', `BNB Chain block ${report.block.number} (${report.block.timestamp}).`, '', `Discovered: ${s.discoveredContracts} contracts. Runtime corroborated: ${s.runtimeCorroborated}. Targeted getter coverage: ${s.targetedContracts}. Review leads: ${s.reviewLeads}. Confirmed findings: ${s.confirmedFindings}. Full audits: 0.`, '', '## Review leads', '', ...report.incidents.filter(i => i.status === 'open-review').map(i => `- **${i.name} / ${i.label}** — ${i.address}: ${i.action}`), '', '## Coverage', '', '| Contract | Address | Coverage | Review leads |', '| --- | --- | --- | --- |', ...report.candidates.map(c => `| ${c.name.replaceAll('|', '')} | ${c.address} | ${c.coverage} | ${c.signals.filter(s => s.category === 'review').length} |`), '', '## Limits', '', ...report.limitations.map(x => '- ' + x), ''].join('\n');
}
