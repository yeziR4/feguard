import { loadEngine } from '../demo/client.mjs';
import { evaluate, summarize, formatValue } from './policy.mjs';
const $ = id => document.getElementById(id);
const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
const badge = status => text('span', status.toUpperCase(), `tag ${status}`);
try {
  const responses = await Promise.all([fetch('../reports/gang-router.json'), fetch('../demo/engine/feguard.wasm'), fetch('../demo/engine/feguard.manifest.json')]);
  if (responses.some(r => !r.ok)) throw new Error('Could not load the saved report or Fe engine. Serve the repository over HTTP.');
  const [report, bytes, manifest] = await Promise.all([responses[0].json(), responses[1].arrayBuffer(), responses[2].json()]);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.module.sha256) throw new Error('Engine digest differs from its compiler manifest.');
  const engine = await loadEngine(bytes);
  for (const check of report.checks) {
    const result = evaluate(engine, check);
    if (result.status !== check.assessment.status || result.actionCode !== check.assessment.actionCode) throw new Error(`Saved assessment differs from Fe replay: ${check.id}`);
    check.assessment = result;
  }
  const summary = summarize(report.checks);
  $('project').textContent = report.project;
  $('block').textContent = `BNB Chain · block ${Number(report.block.number).toLocaleString()} · two RPC origins`;
  $('timestamp').textContent = new Date(report.block.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + ' (your local time)';
  $('engine').textContent = `${report.checks.length} assessments replayed in Fe ✓`;
  for (const [value, label] of [[summary.meets, 'MATCHED OBSERVATIONS'], [summary.mismatch, 'POLICY MISMATCHES'], [summary.unsupported + summary.unknown, 'COVERAGE GAPS'], [summary.conflict, 'PROVIDER CONFLICTS']]) {
    const card = text('div', '', 'metric'); card.append(text('strong', value), text('span', label)); $('metrics').append(card);
  }
  $('verdict-title').textContent = summary.mismatch ? 'Policy mismatches need review.' : 'No mismatch found in the covered observations.';
  for (const check of report.checks.filter(c => c.assessment.status !== 'meets')) {
    const card = text('article', '', 'task'); const body = text('div', '');
    body.append(text('h3', check.label), text('p', check.assessment.nextStep));
    if (['unknown', 'unsupported', 'conflict'].includes(check.assessment.status)) body.append(text('small', 'Verification work remains; this is not evidence that the project is misconfigured.'));
    card.append(badge(check.assessment.status), body); $('queue').append(card);
  }
  $('scope').textContent = report.scope;
  for (const check of report.checks) {
    const row = document.createElement('tr');
    row.append(text('td', check.label));
    for (const expected of [false, true]) { const cell = document.createElement('td'); cell.append(text('code', formatValue(check, expected))); row.append(cell); }
    const cell = document.createElement('td'); cell.append(badge(check.assessment.status)); row.append(cell); $('checks').append(row);
  }
  for (const limit of report.limitations) $('limits').append(text('li', limit));
  for (const source of report.sources) {
    const link = text('a', new URL(source).pathname.split('/').slice(-1)[0]); link.href = source;
    const li = document.createElement('li'); li.append(link); $('sources').append(li);
  }
  $('report').hidden = false;
} catch (error) {
  $('engine').textContent = 'No assessment displayed';
  $('error').hidden = false; $('error').textContent = error.message;
}
