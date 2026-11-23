export const STATES = ['known', 'unavailable', 'reverted', 'malformed', 'unsupported', 'conflict', 'no-code'];
export const STATUSES = ['meets', 'mismatch', 'unknown', 'unsupported', 'conflict'];
export const ACTIONS = [
  'No change indicated by this check.',
  'Review the owner against the documented governance policy. Confirm any approved migration before planning an ownership change.',
  'Review the configured minimum delay. If policy still requires the stated minimum, prepare a governance-approved delay update; check already scheduled operations separately.',
  'Review the missing documented role and its role administrator. Restore it only through the project’s authorized governance process if the policy remains current.',
  'Review the unexpected role holder. Confirm intended governance and a safe replacement path before considering revocation.',
  'The documented recipient is pending. Confirm the handoff is intended; the recipient must accept ownership to finish a two-step transfer.',
  'Review the unexpected pending ownership recipient before accepting or cancelling the handoff.',
  'Review the implementation slot and deployment history; a missing implementation or an unsupported proxy needs investigation.',
  'Verify the documented address, chain and block: no deployed runtime code was observed there.',
  'Inspect the Safe configuration: threshold must be at least one and no greater than its number of owners. This does not assess signer independence.',
  'Review the role administrator against the documented DEFAULT_ADMIN_ROLE policy.',
  'Reserved.',
  'Obtain the missing evidence or correct the adapter/address, then rerun. No contract change is justified by an unreadable check alone.',
  'Resolve provider or block disagreement before relying on this check. Do not change a contract based on conflicting reads.',
  'Add verified runtime/deployment evidence or a complete role-membership reconstruction. Do not infer a security verdict from this unsupported check.',
  'Review the changed ERC-1967 admin slot against deployment evidence. For OpenZeppelin 5, verify the immutable actual admin separately before drawing conclusions about upgrade control.',
];

function limbs(input) {
  const value = BigInt(input);
  if (value < 0n || value >= (1n << 256n)) throw new Error('Policy value must fit uint256.');
  return [0n, 64n, 128n, 192n].map(shift => (value >> shift) & ((1n << 64n) - 1n));
}

export function evaluate(engine, check) {
  const { kind, observation, expected } = check;
  if (!Number.isInteger(kind) || kind < 1 || kind > 10) throw new Error('Unsupported rule kind.');
  if (!Number.isInteger(observation.state) || observation.state < 0 || observation.state >= STATES.length) throw new Error('Invalid evidence state.');
  const packed = Number(engine.fg_assess(BigInt(kind), BigInt(observation.state), ...limbs(observation.value), ...limbs(expected)));
  const status = STATUSES[packed & 255];
  const actionCode = packed >> 8;
  if (!status || !ACTIONS[actionCode]) throw new Error('Invalid Fe assessment.');
  return { status, actionCode, nextStep: ACTIONS[actionCode] };
}

export function summarize(checks) {
  return Object.fromEntries(STATUSES.map(status => [status, checks.filter(c => c.assessment.status === status).length]));
}

export function formatValue(check, expected = false) {
  if (check.observation.state === 4) return expected ? 'Verified evidence' : 'Unsupported';
  if (!expected && check.observation.state !== 0) return STATES[check.observation.state];
  const n = BigInt(expected ? check.expected : check.observation.value);
  if (expected && check.kind === 5) return 'No pending recipient';
  if (expected && check.kind === 7) return 'Nonzero address';
  if (expected && check.kind === 9) return `Threshold 1–${n}`;
  if ([1, 5, 6, 7].includes(check.kind)) return n === 0n ? '0x0' : '0x' + n.toString(16).padStart(40, '0');
  if (check.kind === 2) return `${expected ? '≥ ' : ''}${n} seconds`;
  if ([3, 4, 8].includes(check.kind)) return n === 1n ? 'Yes' : 'No';
  if (check.kind === 10 && n === 0n) return 'DEFAULT_ADMIN_ROLE (zero)';
  return n.toString();
}

export function changesSince(current, previous) {
  if (previous.policySha256 !== current.policySha256 || previous.chainId !== current.chainId) throw new Error('Cannot compare snapshots with different policy or chain.');
  const old = new Map(previous.checks.map(c => [c.id, c]));
  return current.checks.flatMap(c => {
    const before = old.get(c.id);
    if (!before) return [{ id: c.id, change: 'new check' }];
    if (before.observation.state === c.observation.state && before.observation.value === c.observation.value && before.expected === c.expected) return [];
    return [{ id: c.id, before: before.observation, after: c.observation, status: c.assessment.status }];
  });
}
