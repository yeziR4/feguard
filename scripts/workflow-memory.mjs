// Incident memory preserves analyst context. A successful implementation call
// cannot silently promote a previously scoped hardening case to critical.
export function buildMemory({ cohort, initialization, focused, dispositions, policyDispositions = { cases: [] }, baseline, previous, baselineReferences }) {
  const old = new Map((previous?.records || []).map(r => [r.key, r]));
  const records = [];
  function remember(key, values) {
    const before = old.get(key);
    records.push({ ...before, ...values, key, firstSeen: before?.firstSeen || values.observedAt, seenRuns: (before?.seenRuns || 0) + 1 });
    old.delete(key);
  }
  const cases = new Map(dispositions.cases.map(c => [c.address.toLowerCase(), c]));
  for (const t of initialization.results) {
    const d = cases.get(t.address.toLowerCase());
    remember('56:' + t.address.toLowerCase() + ':initialization', {
      address: t.address, name: t.name, observedAt: initialization.block.timestamp, observationBlock: initialization.block.number,
      status: t.assessment.code === 8 ? d ? 'context-recorded' : 'deployment-context-needed' : 'unverified',
      severity: d?.severity || 'Unassigned', confirmedImpact: false,
      nextStep: d ? 'Retain the recorded proxy-context assessment; recheck context before asserting current impact.' : 'Establish proxy/implementation role, initialized live storage and consequential authority before assigning impact.',
      contextEvidence: d ? { file: d.evidenceFile, sha256: d.evidenceSha256, status: 'Historical evidence; not refreshed by this stage', summary: d.summary } : undefined,
    });
  }
  for (const c of cohort.candidates) for (const s of c.signals.filter(s => s.category === 'review')) remember(s.fingerprint, { address: c.address, name: c.name, observedAt: cohort.block.timestamp, observationBlock: cohort.block.number, status: 'getter-review', severity: 'Unassigned', confirmedImpact: false, nextStep: s.action });
  const policyKey = c => '56:' + c.address.toLowerCase() + ':policy:' + focused.planSha256 + ':' + c.id;
  for (const c of focused.checks.filter(c => c.assessment.status !== 'meets')) remember(policyKey(c), { address: c.address, name: c.scope, observedAt: focused.block.timestamp, observationBlock: focused.block.number, status: c.assessment.status === 'mismatch' ? 'policy-review' : 'evidence-gap', severity: 'Unassigned', confirmedImpact: false, nextStep: c.assessment.nextStep, source: c.source });
  // Omission or unreadable evidence never clears an earlier case. Only the
  // exact supported rule with a known non-signal can clear its narrow signal.
  for (const before of old.values()) {
    const interpretation = policyDispositions.cases.find(d => d.key === before.key);
    const replacement = interpretation && focused.checks.find(c => c.id === interpretation.replacementCheckId && c.expected === interpretation.expected && c.source === interpretation.source && c.assessment.status === 'meets');
    const explained = replacement && interpretation.requiredChecks.length > 0 && interpretation.requiredChecks.every(id => focused.checks.some(c => c.id === id && c.assessment.status === 'meets'));
    const match = focused.checks.find(c => before.key === policyKey(c));
    const getter = cohort.candidates.flatMap(c => c.observations.map(o => ({ c, o }))).find(({ c, o }) => before.key === `56:${c.address.toLowerCase()}:${o.name}`);
    const cleared = match?.assessment.status === 'meets' || (getter?.c.runtimeCorroborated && getter.o.state === 0 && getter.o.triage.code === 0);
    records.push({ ...before, status: explained ? 'explained-change' : cleared ? 'signal-cleared' : 'unverified', lastChecked: cohort.collectedAt, ...(explained ? { interpretation } : {}) });
  }
  const addresses = new Set([...(previous?.addresses || []), ...[...baseline.candidates, ...cohort.candidates].map(c => c.address.toLowerCase())]);
  const queue = records.filter(r => !['signal-cleared', 'context-recorded', 'explained-change'].includes(r.status));
  return { schemaVersion: 1, addresses: [...addresses].sort(), records, queue, baselineReferences, summary: { uniqueSampledAddresses: addresses.size, baselineAddresses: baseline.candidates.length, currentBatchAddresses: cohort.candidates.length, contextRecorded: records.filter(r => r.status === 'context-recorded').length, explainedChanges: records.filter(r => r.status === 'explained-change').length, reviewTasks: queue.length, confirmedImpactFindings: 0 }, limitations: ['Address union covers saved baseline and linked controller runs, not an exhaustive chain index.', 'Review tasks are evidence gaps or policy/behavior leads, not severity findings.', 'Historical analyst context is retained with provenance and is not automatically refreshed.'] };
}
