import { Rpc, sha256 } from './inspection-lib.mjs';
import { getJson, pin, pool } from './cohort-lib.mjs';
import { triage } from '../inspection/cohort-policy.mjs';

export function validatePlan(plan) {
  if (plan.schemaVersion !== 1 || plan.chainId !== 56 || !Array.isArray(plan.targets) || plan.targets.length > 20) throw new Error('Unsupported initialization plan.');
  const seen = new Set();
  for (const t of plan.targets) {
    if (!/^0x[\da-f]{40}$/i.test(t.address) || seen.has(t.address.toLowerCase())) throw new Error('Invalid/duplicate target.');
    seen.add(t.address.toLowerCase());
    if (!/^[\da-f]{64}$/i.test(t.runtimeSha256) || !/^[\da-f]{64}$/i.test(t.source.sha256)) throw new Error('Invalid artifact digest.');
    if (!/^0x[\da-f]+$/i.test(t.storage.slot) || !Number.isInteger(t.storage.offset) || t.storage.offset < 0 || t.storage.offset > 31 || t.storage.bytes !== 1 || t.storage.label !== '_initialized') throw new Error('Unsupported storage proof.');
    if (!/^0x[\da-f]{40}$/i.test(t.simulation.caller) || !/^0x[\da-f]{8}(?:[\da-f]{64})+$/i.test(t.simulation.data)) throw new Error('Invalid read-only simulation.');
    if (!t.semanticReview?.conclusion || !t.semanticReview?.deploymentRole) throw new Error('Source semantics must be reviewed explicitly.');
    const url = new URL(t.source.url);
    if (url.origin !== 'https://sourcify.dev' || url.pathname !== `/server/v2/contract/56/${t.address}`) throw new Error('Source URL identity mismatch.');
  }
  return plan;
}

export async function probeTarget(target, rpcs, block, engine, fetchSource = getJson) {
  let flags = 0; let state = 0;
  const evidence = {};
  const result = { address: target.address, name: target.name, source: target.source, semanticReview: target.semanticReview, storage: target.storage, block, rule: 6, flags: '0', state: 0, confirmedImpact: false };
  try {
    const source = await fetchSource(target.source.url);
    const content = source.sources?.[target.source.path]?.content;
    const layout = source.storageLayout?.storage?.find(x => x.label === target.storage.label && BigInt(x.slot) === BigInt(target.storage.slot) && x.offset === target.storage.offset);
    const layoutType = source.storageLayout?.types?.[layout?.type];
    if (typeof content !== 'string' || sha256(content) !== target.source.sha256 || !layout || Number(layoutType?.numberOfBytes) !== 1) throw new Error('Source/layout evidence differs from the reviewed plan.');
    flags |= 2;
    evidence.source = { url: target.source.url, path: target.source.path, sha256: sha256(content), layout, layoutType };
  } catch { result.coverageIssue = 'Source or storage-layout evidence unavailable/different; no simulation attempted.'; }
  const codes = await Promise.all(rpcs.map(r => r.read('eth_getCode', [target.address, block.tag])));
  if (codes.every(r => typeof r.result === 'string' && /^0x(?:[\da-f]{2})+$/i.test(r.result) && sha256(Buffer.from(r.result.slice(2), 'hex')) === target.runtimeSha256)) flags |= 1;
  else result.coverageIssue = 'Runtime evidence unavailable/different; no simulation attempted.';
  if ((flags & 3) === 3) {
    const slots = await Promise.all(rpcs.map(r => r.read('eth_getStorageAt', [target.address, target.storage.slot, block.tag])));
    evidence.storage = slots;
    if (slots.some(r => !/^0x[\da-f]{64}$/i.test(r.result || '')) || slots[0].result.toLowerCase() !== slots[1].result.toLowerCase()) state = 1;
    else {
      const initialized = (BigInt(slots[0].result) >> BigInt(target.storage.offset * 8)) & 255n;
      result.initializedField = String(initialized);
      if (initialized === 0n) {
        flags |= 4;
        const call = { from: target.simulation.caller, to: target.address, data: target.simulation.data, gas: target.simulation.gas };
        const simulations = await Promise.all(rpcs.map(r => r.read('eth_call', [call, block.tag])));
        evidence.simulations = simulations;
        evidence.request = call;
        if (simulations.every(r => r.result === '0x')) flags |= 8;
        else if (!simulations.every(r => r.error?.code === 3)) state = 1;
      }
    }
  }
  result.flags = String(flags); result.state = state;
  result.assessment = triage(engine, 6, { state, value: String(flags) });
  return { result, evidence };
}

export async function runInitializationReview(plan, engine, engineHash, { rpcUrls, sourceTransport, transports } = {}) {
  validatePlan(plan);
  const rpcs = rpcUrls.map((url, i) => new Rpc(url, transports?.[i]));
  const block = await pin(rpcs, plan.chainId);
  const rows = await pool(plan.targets, 2, t => probeTarget(t, rpcs, block, engine, sourceTransport));
  const after = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', [block.tag, false])));
  if (after.some(r => r.result?.hash?.toLowerCase() !== block.hash.toLowerCase())) throw new Error('Block changed; discard review.');
  const results = rows.map(r => r.result);
  return {
    schemaVersion: 1, chainId: plan.chainId, collectedAt: new Date().toISOString(), block, engineSha256: engineHash,
    planSha256: sha256(JSON.stringify(plan)), summary: { sourceReviewedTargets: results.length, validatedReviewLeads: results.filter(r => r.assessment.code === 8).length, unresolvedOrUnsupported: results.filter(r => [2, 6, 7].includes(r.assessment.code)).length, confirmedImpactFindings: 0 },
    results, evidence: { source: rows.map((r, i) => ({ address: plan.targets[i].address, ...r.evidence })), rpc: rpcs.map(r => ({ provider: r.url, reads: r.evidence })) },
    limitations: ['Read-only eth_call success and uninitialized storage confirm an exposed initialization surface at the named address; they do not prove user-asset or proxy impact.', 'A logic implementation can be separately initialized without changing proxy storage. Deployment roles and asset exposure remain unverified.', 'Source semantics and storage locations were reviewed for these five targets; arbitrary source-code inference is not implemented.', 'No transaction was sent and no team was contacted. Public RPC state may be pruned rapidly; reruns pin a fresh finalized block.'],
  };
}
