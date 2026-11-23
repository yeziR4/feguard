import { triage, summarizeCohort } from './cohort-policy.mjs';
import { evaluate, summarize } from './policy.mjs';
const node = (tag, text = '', cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
const link = (text, url) => { const a = node('a', text); a.href = url; return a; };

export async function loadWorkflow(engine, engineHash) {
  const response = await fetch('../reports/workflow.json');
  if (!response.ok) throw new Error('Controller manifest unavailable.');
  const manifest = await response.json();
  if (manifest.status !== 'complete' || !/^runs\/[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.runDirectory) || !Array.isArray(manifest.stages) || manifest.stages.length !== 6) throw new Error('Incomplete controller manifest.');
  const outputs = {};
  await Promise.all(manifest.stages.map(async s => {
    if (s.status !== 'complete' || !/^[a-z0-9-]+\.json\.gz$/.test(s.file)) throw new Error('Invalid controller artifact.');
    const r = await fetch('../reports/' + manifest.runDirectory + '/' + s.file);
    if (!r.ok) throw new Error('Controller artifact unavailable.');
    const bytes = await r.arrayBuffer();
    if (await digest(bytes) !== s.sha256) throw new Error('Controller artifact digest differs.');
    outputs[s.id] = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }));
  for (const id of ['qualification', 'discovery', 'screen', 'initializers', 'focused', 'memory']) if (!outputs[id]) throw new Error('Missing controller stage.');
  let decisions = 0;
  for (const r of [outputs.screen.report, outputs.initializers, outputs.focused]) if (r.engineSha256 !== engineHash || r.chainId !== 56) throw new Error('Controller engine or chain differs.');
  for (const c of outputs.screen.report.candidates) for (const o of c.observations) { if (triage(engine, o.kind, o).code !== o.triage.code) throw new Error('Controller triage differs.'); decisions++; }
  for (const r of outputs.initializers.results) { if (triage(engine, r.rule, { state: r.state, value: r.flags }).code !== r.assessment.code) throw new Error('Controller source review differs.'); decisions++; }
  for (const c of outputs.focused.checks) { if (JSON.stringify(evaluate(engine, c)) !== JSON.stringify(c.assessment)) throw new Error('Controller policy decision differs.'); decisions++; }
  if (JSON.stringify(summarizeCohort(outputs.screen.report.candidates)) !== JSON.stringify(outputs.screen.report.summary) || JSON.stringify(summarize(outputs.focused.checks)) !== JSON.stringify(outputs.focused.summary)) throw new Error('Controller summary differs.');
  return { manifest, outputs, decisions };
}

export function renderWorkflow({ manifest, outputs, decisions }) {
  const root = document.getElementById('workflow-body'); root.replaceChildren();
  const status = node('div', '', 'workflow-status');
  status.append(node('strong', 'Completed · ' + manifest.id), node('span', `${manifest.stages.length} artifact hashes checked · ${decisions} Fe decisions replayed`), node('small', new Date(manifest.completedAt).toUTCString()));
  root.append(status);
  const stages = node('div', '', 'workflow-stages');
  const labels = { qualification: 'Project qualification', discovery: 'Bounded discovery', screen: 'Runtime + getter checks', initializers: 'Reviewed source probes', focused: 'Documented policy checks', memory: 'Case memory' };
  for (const [i, s] of manifest.stages.entries()) {
    const card = node('div'); card.append(node('small', `0${i + 1} / COMPLETE`), node('strong', labels[s.id]), node('p', s.attempts > 1 ? `${s.attempts} attempts; checkpoint saved` : 'Checkpoint saved'), link('Evidence ↓', '../reports/' + manifest.runDirectory + '/' + s.file)); stages.append(card);
  }
  root.append(stages);
  const focused = outputs.focused;
  root.append(node('p', `${focused.summary.meets} policy observations match · ${focused.summary.mismatch} mismatches · ${focused.summary.unknown + focused.summary.conflict} unreadable/conflicting. Focused block ${focused.block.number}. These checks do not establish application security.`, 'boundary'));
  for (const r of outputs.memory.records.filter(r => r.status === 'explained-change')) {
    const box = node('div', '', 'workflow-explanation'); box.append(node('strong', 'Flag → source review → documented migration'), node('p', r.interpretation.conclusion), link('Project’s rollout record ↗', r.interpretation.source), link('Original flag evidence ↓', '../reports/' + r.interpretation.initialEvidence)); root.append(box);
  }
  const details = node('details'); details.append(node('summary', `${outputs.memory.queue.length} open review tasks · severity remains unassigned`));
  for (const task of outputs.memory.queue) { const row = node('div', '', 'workflow-task'); row.append(node('strong', task.name), node('code', task.address), node('p', task.nextStep)); details.append(row); }
  root.append(details, node('p', 'Runs stop after the configured batch. Source-specific plans and context dispositions are reviewed explicitly. Each network stage uses its own pinned block; historical proxy context is labeled separately.', 'boundary'), link('Controller guide ↗', '../docs/CONTROLLER.md'));
  document.getElementById('workflow').hidden = false;
}
