import { loadEngine } from '../demo/client.mjs';
import { triage, summarizeCohort } from './cohort-policy.mjs';
const $ = id => document.getElementById(id);
const el = (tag, value = '', className) => { const n = document.createElement(tag); n.textContent = value; if (className) n.className = className; return n; };
const badge = (label, kind = '') => el('span', label, 'tag ' + kind);
const short = address => address.slice(0, 8) + '…' + address.slice(-6);
const utc = value => new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const fmt = observation => observation.state !== 0 ? 'Unreadable / conflicting' : ['owner', 'pendingOwner'].includes(observation.name) ? '0x' + BigInt(observation.value).toString(16).padStart(40, '0') : observation.value;
const link = (label, url) => { const a = el('a', label); const parsed = new URL(url, location.href); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported evidence link.'); a.href = parsed.href; return a; };
let report, followUp, visible = [], selected;
const reviewed = new Map();

function selectContract(candidate) {
  selected = candidate.address;
  const root = $('detail-body'); root.replaceChildren();
  root.append(el('h3', candidate.name), el('code', candidate.address));
  const follow = reviewed.get(candidate.address.toLowerCase());
  const dl = document.createElement('dl');
  const fields = [['Coverage', candidate.coverage === 'targeted-reads' ? `${candidate.observations.length} supported getter observations` : 'Runtime corroboration only; application logic unassessed'], ['Deployment block', candidate.deployment?.blockNumber || 'Unavailable'], ['Verification recorded', utc(candidate.verifiedAt)], ['ABI context', candidate.abiContext || 'No supported reads']];
  if (candidate.proxy) fields.push(['Observed implementation slot', candidate.proxy.implementation || 'Unreadable']);
  for (const [label, value] of fields) dl.append(el('dt', label), el('dd', value));
  root.append(dl, link('Verification record ↗', candidate.sourceUrl), link('Explorer ↗', `https://bscscan.com/address/${candidate.address}#code`));
  if (follow) {
    const box = el('div', '', 'callout');
    box.append(badge('Validated review lead', 'review'), el('p', follow.assessment.label), el('p', follow.assessment.action), el('p', `Follow-up block ${follow.block.number} · ${utc(follow.block.timestamp)}`));
    root.append(box, el('h4', 'Source and simulation'), el('p', follow.semanticReview.conclusion), el('p', follow.semanticReview.deploymentRole), el('p', `${follow.source.path}:${follow.source.initializerLine} · initialized field = ${follow.initializedField}`), link('Source record ↗', follow.source.url));
    root.append(el('pre', 'node scripts/review-initializers.mjs'));
  }
  if (candidate.observations.length) root.append(el('h4', 'Recorded getter observations'));
  for (const observation of candidate.observations) {
    const box = el('div', '', 'observation');
    box.append(el('strong', observation.name + '()'), el('p', fmt(observation)), badge(observation.triage.category, observation.triage.category === 'context' ? 'context' : observation.triage.category === 'review' ? 'review' : observation.triage.category === 'unknown' ? 'gap' : ''), el('p', observation.triage.action));
    root.append(box);
  }
  if (!candidate.observations.length) root.append(el('p', 'This ABI has no supported governance getters. Runtime corroboration is not a security result.'));
  for (const issue of candidate.qualificationIssues) root.append(el('p', issue));
  for (const row of $('rows').children) row.classList.toggle('selected', row.dataset.address === selected);
}

function renderRows() {
  const search = $('search').value.toLowerCase().trim(); const filter = $('filter').value;
  visible = report.candidates.filter(c => {
    if (search && !(c.name + ' ' + c.address).toLowerCase().includes(search)) return false;
    if (filter === 'leads') return reviewed.has(c.address.toLowerCase());
    if (filter === 'targeted') return c.coverage === 'targeted-reads';
    if (filter === 'runtime') return c.coverage === 'runtime-only';
    if (filter === 'context') return c.signals.some(s => s.category === 'context');
    if (filter === 'generic') return c.signals.some(s => s.category === 'review');
    if (filter === 'gap') return c.coverage === 'not-qualified';
    return true;
  });
  $('rows').replaceChildren();
  for (const c of visible) {
    const row = el('tr'); row.dataset.address = c.address; row.classList.toggle('selected', c.address === selected);
    const identity = el('td'); const button = el('button', c.name, 'contract-button'); button.type = 'button'; button.addEventListener('click', () => selectContract(c)); identity.append(button, el('code', short(c.address))); row.append(identity);
    row.append(el('td', c.coverage === 'targeted-reads' ? 'Targeted getters' : c.coverage === 'runtime-only' ? 'Runtime only' : 'Evidence gap'), el('td', c.observations.length));
    const status = el('td');
    status.append(reviewed.has(c.address.toLowerCase()) ? badge('Validated lead', 'review') : c.signals.some(s => s.category === 'review') ? badge('Getter review lead', 'review') : c.signals.some(s => s.category === 'unknown') ? badge('Unreadable', 'gap') : c.signals.some(s => s.category === 'context') ? badge('Context', 'context') : c.coverage === 'runtime-only' ? badge('Logic unassessed', 'gap') : badge('No narrow signal'));
    row.append(status); $('rows').append(row);
  }
  $('visible-count').textContent = `${visible.length} / ${report.candidates.length}`;
  $('no-results').hidden = visible.length !== 0;
}

function downloadCsv() {
  const cell = value => { const s = String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"'; };
  const rows = [['contract', 'address', 'chainId', 'coverage', 'getterObservations', 'validatedInitializationLead'], ...visible.map(c => [c.name, c.address, c.chainId, c.coverage, c.observations.length, reviewed.has(c.address.toLowerCase())])];
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = 'feguard-visible-contracts.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

try {
  const responses = await Promise.all([fetch('../reports/cohort.json'), fetch('../reports/initialization-review.json'), fetch('../demo/engine/feguard.wasm'), fetch('../demo/engine/feguard.manifest.json')]);
  if (responses.some(r => !r.ok)) throw new Error('Could not load research artifacts. Serve the repository over HTTP.');
  const data = await Promise.all([responses[0].json(), responses[1].json(), responses[2].arrayBuffer(), responses[3].json()]);
  [report, followUp] = data; const bytes = data[2]; const manifest = data[3];
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.module.sha256 || report.chainId !== 56 || followUp.chainId !== 56) throw new Error('Artifact identity mismatch.');
  if (new Set(report.candidates.map(c => c.address.toLowerCase())).size !== report.candidates.length) throw new Error('Duplicate cohort addresses.');
  const engine = await loadEngine(bytes); let replayed = 0;
  for (const c of report.candidates) for (const observation of c.observations) {
    if (triage(engine, observation.kind, observation).code !== observation.triage.code) throw new Error('Recorded Fe triage differs.');
    replayed++;
  }
  const cohortAddresses = new Set(report.candidates.map(c => c.address.toLowerCase()));
  for (const result of followUp.results) {
    if (triage(engine, result.rule, { state: result.state, value: result.flags }).code !== result.assessment.code) throw new Error('Follow-up Fe replay differs.');
    if (result.assessment.code === 8 && cohortAddresses.has(result.address.toLowerCase())) reviewed.set(result.address.toLowerCase(), result);
    replayed++;
  }
  const summary = summarizeCohort(report.candidates);
  if (JSON.stringify(summary) !== JSON.stringify(report.summary) || followUp.results.filter(r => r.assessment.code === 8).length !== followUp.summary.validatedReviewLeads) throw new Error('Report totals do not match their records.');
  $('batch-block').textContent = `Batch block ${report.block.number} · two RPC origins`;
  $('batch-time').textContent = utc(report.block.timestamp);
  $('engine').textContent = `${replayed} triage decisions replayed in Fe ✓`;
  const families = new Set([...reviewed.values()].map(r => r.name)).size;
  for (const [value, label, note, kind] of [[summary.discoveredContracts, 'CONTRACTS SCREENED', `${summary.distinctContractNames} distinct names · not project count`, ''], [summary.targetedContracts, 'TARGETED GETTER COVERAGE', `${summary.runtimeOnlyContracts} have runtime-only coverage`, ''], [reviewed.size, 'VALIDATED INITIALIZATION LEADS', `${families} contract families · impact unverified`, 'review'], [0, 'CONFIRMED IMPACT FINDINGS', 'No critical/high severity claim', '']]) {
    const card = el('div', '', 'metric ' + kind); card.append(el('strong', value), el('span', label), el('small', note)); $('metrics').append(card);
  }
  $('stage-discovery').textContent = `${summary.discoveredContracts} deployments`;
  $('stage-runtime').textContent = `${summary.runtimeCorroborated} corroborated`;
  $('stage-reads').textContent = `${summary.observationsRead} observations`;
  $('stage-review').textContent = `${reviewed.size} initialization leads`;
  $('lead-summary').textContent = reviewed.size ? `${reviewed.size} addresses accepted initializer simulations from an arbitrary caller while the reviewed initialized field was zero. These may be implementation contracts; live deployment roles and financial impact are unverified. Follow-up block ${followUp.block.number}.` : 'No validated initialization lead from the separate source-specific follow-up appears in this sample. This does not establish contract safety.';
  for (const result of reviewed.values()) {
    const card = el('button', '', 'lead-card'); card.type = 'button';
    card.append(el('h3', result.name), badge('Needs deployment context', 'review'), el('code', result.address), el('p', 'Uninitialized storage + source-reviewed authority assignment + successful read-only simulation.'), el('small', 'Inspect evidence and next step ↗'));
    card.addEventListener('click', () => { $('search').value = ''; $('filter').value = 'leads'; renderRows(); const c = report.candidates.find(c => c.address.toLowerCase() === result.address.toLowerCase()); selectContract(c); $('detail').scrollIntoView({ block: 'start' }); });
    $('leads').append(card);
  }
  for (const limit of [...report.limitations, ...followUp.limitations]) $('limits').append(el('li', limit));
  $('search').addEventListener('input', renderRows); $('filter').addEventListener('change', renderRows); $('csv').addEventListener('click', downloadCsv);
  renderRows();
  const first = report.candidates.find(c => reviewed.has(c.address.toLowerCase())) || report.candidates[0]; if (first) selectContract(first);
  $('workbench').hidden = false;
} catch (error) { $('engine').textContent = 'No research results displayed'; $('error').textContent = error.message; $('error').hidden = false; }
