export const TRIAGE = [
  { label: 'No signal under this rule', category: 'no-signal', action: 'No action indicated by this narrow read.' },
  { label: 'Ownership handoff is pending', category: 'review', action: 'Confirm the intended recipient and transfer status. The pending recipient must accept a two-step handoff; this observation alone does not prove a defect.' },
  { label: 'Initialization getter is false', category: 'review', action: 'Inspect constructor/initializer access and proxy context. A false getter alone does not establish an unauthorized initialization vulnerability.' },
  { label: 'Timelock reports zero delay', category: 'review', action: 'Confirm the intended governance policy and deployed implementation. Zero delay may be deliberate; no undocumented minimum is assumed.' },
  { label: 'Owner getter is zero', category: 'context', action: 'Distinguish intentional renunciation, a locked implementation and an uninitialized proxy. Do not assume zero ownership is a defect.' },
  { label: 'Runtime evidence does not corroborate', category: 'coverage-gap', action: 'Resolve missing or different runtime evidence before drawing source-based conclusions.' },
  { label: 'Observation is unreadable or conflicting', category: 'unknown', action: 'Obtain corroborated evidence; missing data does not become a zero-valued finding.' },
  { label: 'Rule is unsupported', category: 'coverage-gap', action: 'Use a supported adapter.' },
  { label: 'Exposed initializer reproduced in read-only simulation', category: 'validated-review', action: 'Establish whether this address is a live deployment, proxy or implementation. If it is an implementation, lock initialization in future releases. If live, review deployment and asset exposure before preparing an authorized remediation. No fund-loss impact has been established.' },
];

export function triage(engine, kind, observation) {
  const value = BigInt(observation.value);
  if (value < 0n || value >= (1n << 256n) || !Number.isInteger(observation.state) || observation.state < 0 || observation.state > 6) throw new Error('Invalid triage input.');
  const words = [0n, 64n, 128n, 192n].map(s => (value >> s) & ((1n << 64n) - 1n));
  const code = Number(engine.fg_triage(BigInt(kind), BigInt(observation.state), ...words));
  if (!TRIAGE[code]) throw new Error('Invalid Fe triage code.');
  return { code, ...TRIAGE[code] };
}

// Deployment-role resolution. Codes 9-13 mirror src/cohort.fe::role().
export const ROLE = {
  9: { label: 'Plain uninitialized implementation', category: 'implementation-hardening', action: 'Lock initialization in future releases; the implementation has no proxy and holds no value. This is hardening, not user-asset impact.' },
  10: { label: 'Proxy instance is uninitialized', category: 'review-critical', action: 'A deployed proxy has no recorded initialization. Establish whether an unprivileged caller can initialize it and what it holds before any remediation. This is the one role that can reach user assets.' },
  11: { label: 'Proxy instance is initialized', category: 'context', action: 'The proxy has consumed initialization. An exposed implementation initializer does not reach proxy storage; treat as context unless the authority fields are also empty.' },
  12: { label: 'Plain contract holding value', category: 'context', action: 'A non-proxy contract holds native or token value. Review its own authority and reachability directly; a proxy-role argument does not apply.' },
  13: { label: 'Deployment role unresolved', category: 'coverage-gap', action: 'Runtime or storage evidence was missing or providers disagreed. Resolve before drawing any role conclusion; missing evidence is not a role.' },
};

export function resolveRole(engine, bits) {
  const value = BigInt(bits);
  if (value < 0n || value >= (1n << 32n)) throw new Error('Invalid role evidence bits.');
  const code = Number(engine.fg_role(value));
  if (!ROLE[code]) throw new Error('Invalid Fe role code.');
  return { code, ...ROLE[code] };
}

export function summarizeCohort(candidates) {
  return {
    discoveredContracts: candidates.length,
    runtimeCorroborated: candidates.filter(c => c.runtimeCorroborated).length,
    targetedContracts: candidates.filter(c => c.coverage === 'targeted-reads').length,
    runtimeOnlyContracts: candidates.filter(c => c.coverage === 'runtime-only').length,
    notQualifiedContracts: candidates.filter(c => c.coverage === 'not-qualified').length,
    distinctContractNames: new Set(candidates.map(c => c.name)).size,
    observationsRead: candidates.reduce((n, c) => n + c.observations.length, 0),
    reviewLeads: candidates.reduce((n, c) => n + c.signals.filter(s => s.category === 'review').length, 0),
    contextObservations: candidates.reduce((n, c) => n + c.signals.filter(s => s.category === 'context').length, 0),
    unreadableObservations: candidates.reduce((n, c) => n + c.signals.filter(s => s.category === 'unknown').length, 0),
    confirmedFindings: candidates.reduce((n, c) => n + c.confirmedFindings.length, 0),
    fullAudits: 0,
  };
}
