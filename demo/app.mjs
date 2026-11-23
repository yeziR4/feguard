import { DECISIONS, feReproducer } from './client.mjs';
const $ = id => document.getElementById(id);
let report, selected = 'reduced';
const descriptions = [
  'Correct target: lifetime spending remains independent of the memory window.',
  'Intentionally faulty: reconstructs allowance from a memory window that forgets old spending.',
  'Intentionally faulty: rejected requests still consume spending allowance.',
  'Intentionally faulty: remembers an approval and reuses it after revocation.',
];
const explanations = [
  '',
  'An old spending record leaves memory, and the faulty target restores allowance that was already consumed.',
  'An unauthorized request is rejected, but the faulty target still deducts its amount from the budget.',
  'The owner revokes the session. A cached approval lets a later request through anyway.',
];
const titles = ['', 'Forgetting history restored the budget.', 'A rejected request consumed allowance.', 'An old approval outlived revocation.'];

function text(tag, value, className) {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  return node;
}
function metric(label, value, unit = '', positive = false) {
  const node = text('div', '', 'metric'); node.append(text('span', label, 'metric-label'));
  const count = text('div', value, `metric-value${positive ? ' positive' : ''}`);
  if (unit) count.append(text('span', unit, 'unit'));
  node.append(count); return node;
}
function rows() {
  const trace = selected === 'reduced' ? report.reducedTrace : report.originalTrace;
  $('trace-rows').replaceChildren(...trace.map(a => {
    const row = document.createElement('tr');
    if (a.state.failure) row.className = 'failure-row';
    let result = a.state.failure ? 'Invariant failed' :
      [0, 1, 2, 6].includes(a.opcode) ? DECISIONS[a.state.decision] :
      ({ 3: 'Revoked', 4: 'Time advanced', 5: 'Read only', 7: 'Recorded' })[a.opcode];
    row.append(text('td', String(a.index + 1).padStart(2, '0')), text('td', a.action, 'action-name'),
      text('td', String(a.value), 'number'), text('td', String(a.state.remaining), 'number bad-number'),
      text('td', String(a.correctedState.remaining), 'number'), text('td', result, 'result-cell'));
    return row;
  }));
  $('reduced-tab').setAttribute('aria-pressed', String(selected === 'reduced'));
  $('original-tab').setAttribute('aria-pressed', String(selected === 'original'));
}
function render(value) {
  report = value; selected = 'reduced'; $('empty').hidden = true; $('results').hidden = false;
  $('failure-panel').hidden = !report.found; $('passing-panel').hidden = report.found;
  $('result-badge').textContent = report.found ? 'INVARIANT FAILED' : 'BOUNDED CAMPAIGN PASSED';
  $('result-badge').className = `result-badge${report.found ? '' : ' pass'}`;
  $('result-kicker').textContent = report.found ? 'COUNTEREXAMPLE FOUND' : 'NO FAILURE FOUND';
  $('result-kicker').style.color = report.found ? 'var(--red)' : 'var(--green)';
  $('result-title').textContent = report.found ? titles[report.target] : 'The invariants held for this campaign.';
  $('result-description').textContent = report.found ? explanations[report.target] :
    `Starting at seed ${report.startSeed}, tested ${report.casesChecked} traces of up to ${report.steps} actions.`;
  if (report.found) {
    $('metrics').replaceChildren(metric('Failing prefix', report.originalLength, 'actions'),
      metric('Reduced counterexample', report.reducedLength, 'actions'),
      metric('Reduction work', report.reductionReplays, 'replays'),
      metric('Corrected replay', report.correctedReplayPasses ? 'Pass' : 'Fail', '', report.correctedReplayPasses));
    $('failing-seed').textContent = report.failingSeed; $('failure-class').textContent = report.failure;
    $('minimal-status').textContent = report.deletionMinimal ? 'Single-action deletion checked ✓' : 'Not verified';
    $('fixed-status').textContent = report.correctedReplayPasses ? 'Same trace passes ✓' : 'Failure remains';
    $('reduced-tab').textContent = `Reduced trace (${report.reducedLength})`;
    $('original-tab').textContent = `Failing trace (${report.originalLength})`;
    rows();
  } else {
    $('metrics').replaceChildren(metric('Traces checked', report.casesChecked), metric('Actions / trace', report.steps),
      metric('Starting seed', report.startSeed), metric('Invariant violations', '0', '', true));
  }
}

const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    $('engine-status').textContent = 'Fe engine ready'; $('engine-dot').className = 'dot green'; $('run').disabled = false;
  } else {
    $('run').disabled = false; $('run').replaceChildren(document.createTextNode('Find a counterexample '), text('span', '↗'));
    if (data.type === 'error') { $('error').textContent = data.error; $('error').hidden = false; }
    else render(data.report);
  }
};
worker.onerror = event => { $('error').textContent = `Engine could not run: ${event.message}`; $('error').hidden = false; $('run').disabled = false; };
$('campaign-form').addEventListener('submit', event => {
  event.preventDefault(); $('error').hidden = true; $('run').disabled = true; $('run').textContent = 'Running Fe engine…';
  worker.postMessage({ target: $('target').value, seed: $('seed').value, cases: Number($('cases').value), steps: Number($('steps').value) });
});
$('target').addEventListener('change', () => { $('target-description').textContent = descriptions[Number($('target').value)]; });
$('reduced-tab').addEventListener('click', () => { selected = 'reduced'; rows(); });
$('original-tab').addEventListener('click', () => { selected = 'original'; rows(); });
function download(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-fe').addEventListener('click', () => download(feReproducer(report), 'text/plain', `feguard-target-${report.target}-seed-${report.failingSeed}.fe`));
$('export-json').addEventListener('click', () => download(JSON.stringify(report, null, 2), 'application/json', `feguard-target-${report.target}-seed-${report.failingSeed}.json`));
