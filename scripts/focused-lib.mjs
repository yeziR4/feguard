import { Rpc, decode, reconcile, sha256 } from './inspection-lib.mjs';
import { pin, pool } from './cohort-lib.mjs';
import { evaluate, summarize } from '../inspection/policy.mjs';

const roles = {
  proposer: 'b09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1',
  executor: 'd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63',
  canceller: 'fd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783',
};
const recipes = { code: [8, 'code'], owner: [1, 'address', '0x8da5cb5b'], pendingOwner: [5, 'address', '0xe30c3978'], delay: [2, 'uint', '0xf27a0c92'], proposer: [3, 'bool'], executor: [3, 'bool'], canceller: [3, 'bool'] };
export function validateFocused(plan) {
  if (plan.schemaVersion !== 1 || plan.chainId !== 56 || !/^0x[\da-f]{40}$/i.test(plan.safe || '') || !Array.isArray(plan.checks) || !plan.checks.length || plan.checks.length > 100) throw new Error('Invalid focused plan.');
  const ids = new Set();
  for (const c of plan.checks) {
    if (ids.has(c.id) || !/^[a-z0-9-]+$/.test(c.id) || !/^0x[\da-f]{40}$/i.test(c.address) || !recipes[c.recipe] || !/^\d+$/.test(c.expected) || BigInt(c.expected) >= 1n << 256n || !c.claim) throw new Error('Invalid focused check.');
    if (!/^https:\/\/github.com\/[^/]+\/[^/]+\/blob\/[\da-f]{40}\//.test(c.source)) throw new Error('Check requires a commit-pinned primary source.');
    ids.add(c.id);
  }
  return plan;
}

export async function runFocused(plan, engine, engineHash, { rpcUrls, transports } = {}) {
  validateFocused(plan);
  const rpcs = rpcUrls.map((url, i) => new Rpc(url, transports?.[i]));
  const block = await pin(rpcs, plan.chainId);
  const checks = await pool(plan.checks, 3, async c => {
    const [kind, type, selector] = recipes[c.recipe];
    const data = selector || '0x91d14854' + roles[c.recipe] + plan.safe.slice(2).toLowerCase().padStart(64, '0');
    const method = c.recipe === 'code' ? 'eth_getCode' : 'eth_call';
    const params = c.recipe === 'code' ? [c.address, block.tag] : [{ to: c.address, data }, block.tag];
    const raw = await Promise.all(rpcs.map(r => r.read(method, params)));
    const observation = reconcile(raw.map(r => {
      if (r.error) return { state: r.error.code === 3 ? 2 : 1, value: '0' };
      try { return { state: 0, value: decode(r.result, type) }; } catch { return { state: 3, value: '0' }; }
    }));
    const row = { ...c, kind, observation, request: { method, params } };
    return { ...row, assessment: evaluate(engine, row) };
  });
  const after = await Promise.all(rpcs.map(r => r.read('eth_getBlockByNumber', [block.tag, false])));
  if (after.some(r => r.result?.hash?.toLowerCase() !== block.hash.toLowerCase())) throw new Error('Focused block changed; discard observations.');
  return { schemaVersion: 1, chainId: plan.chainId, collectedAt: new Date().toISOString(), block, engineSha256: engineHash, plan, planSha256: sha256(JSON.stringify(plan)), summary: summarize(checks), confirmedImpactFindings: 0, checks, evidence: rpcs.map(r => ({ provider: r.url, reads: r.evidence })), limitations: plan.limitations };
}
