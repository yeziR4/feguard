import { readFile, writeFile, mkdir, rename, open, rm } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sha256 } from './inspection-lib.mjs';

export async function atomicJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp-' + process.pid;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n');
  await rename(temp, path);
}
export function artifactPath(root, file) {
  const path = resolve(root, file), rel = relative(resolve(root), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact path escapes run directory.');
  return path;
}
export async function readArtifact(root, record) {
  if (!/^[\da-f]{64}$/.test(record.sha256 || '')) throw new Error('Invalid checkpoint digest.');
  const bytes = await readFile(artifactPath(root, record.file));
  if (sha256(bytes) !== record.sha256) throw new Error('Checkpoint artifact hash mismatch: ' + record.file);
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: 100 * 1024 * 1024 }));
}

// A completed stage is immutable. Failed stages may be retried; the latest
// public pointer is advanced only after every stage succeeds.
export async function runController({ root, id, fingerprint, stages, resume = false, progress = () => {} }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !/^[\da-f]{64}$/.test(fingerprint)) throw new Error('Invalid run identity.');
  if (!stages.length || new Set(stages.map(s => s.id)).size !== stages.length || stages.some(s => !/^[a-z0-9-]+$/.test(s.id))) throw new Error('Invalid stage graph.');
  await mkdir(join(root, 'out'), { recursive: true });
  const lockPath = join(root, 'out/controller.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch { throw new Error('Controller lock exists. Check its PID before removing a stale lock.'); }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, id, started: new Date().toISOString() }));
    const runRoot = join(root, 'reports/runs', id), statePath = join(runRoot, 'state.json');
    let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (state && !resume) throw new Error('Run already exists; use --resume with identical inputs or a new --run ID.');
    if (!state && resume) throw new Error('Cannot resume an absent run.');
    if (state && (state.fingerprint !== fingerprint || JSON.stringify(state.stageIds) !== JSON.stringify(stages.map(s => s.id)))) throw new Error('Inputs or stage graph changed; start a new run.');
    state ||= { schemaVersion: 1, id, fingerprint, startedAt: new Date().toISOString(), stageIds: stages.map(s => s.id), stages: [] };
    state.status = 'running';
    await atomicJson(statePath, state);
    const outputs = {};
    for (const stage of stages) {
      let checkpoint = state.stages.find(s => s.id === stage.id);
      if (checkpoint?.status === 'complete') {
        try { outputs[stage.id] = await readArtifact(runRoot, checkpoint); }
        catch (e) { state.status = 'failed'; await atomicJson(statePath, state); throw e; }
        progress('Reused verified checkpoint: ' + stage.id);
        continue;
      }
      checkpoint ||= { id: stage.id, attempts: 0 };
      if (!state.stages.includes(checkpoint)) state.stages.push(checkpoint);
      checkpoint.status = 'running'; checkpoint.attempts++; checkpoint.startedAt = new Date().toISOString(); delete checkpoint.error;
      await atomicJson(statePath, state);
      progress('Running stage: ' + stage.id);
      try {
        const result = await stage.run(outputs);
        const bytes = gzipSync(JSON.stringify(result) + '\n');
        const file = stage.id + '.json.gz', temp = join(runRoot, file + '.tmp');
        await writeFile(temp, bytes); await rename(temp, join(runRoot, file));
        Object.assign(checkpoint, { status: 'complete', file, sha256: sha256(bytes), completedAt: new Date().toISOString(), summary: stage.summary ? stage.summary(result) : result.summary || {} });
        outputs[stage.id] = result;
        await atomicJson(statePath, state);
      } catch (e) {
        checkpoint.status = 'failed'; checkpoint.error = 'Stage failed; inspect local command output and retry with --resume.';
        state.status = 'failed'; await atomicJson(statePath, state); throw e;
      }
    }
    state.status = 'complete'; state.completedAt ||= new Date().toISOString();
    await atomicJson(statePath, state);
    const manifest = { ...state, runDirectory: 'runs/' + id, limitations: ['Bounded CLI execution, not a continuously running hosted agent.', 'Source-specific follow-ups require an explicit human-reviewed plan.', 'Each network stage pins its own finalized block; stages are not a single atomic chain snapshot.', 'Hash checks establish artifact integrity relative to this manifest, not source truth or a trusted timestamp.'] };
    await atomicJson(join(runRoot, 'manifest.json'), manifest);
    await atomicJson(join(runRoot, 'manifest.json'), manifest);
    await atomicJson(join(root, 'reports/workflow.json'), manifest);
    return { manifest, outputs };
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

export async function verifyWorkflow(root, manifest) {
  if (manifest.schemaVersion !== 1 || manifest.status !== 'complete' || !/^runs\/[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.runDirectory || '') || !Array.isArray(manifest.stages) || manifest.stages.some(s => s.status !== 'complete')) throw new Error('Incomplete workflow manifest.');
  const runRoot = artifactPath(join(root, 'reports'), manifest.runDirectory);
  const outputs = {};
  for (const stage of manifest.stages) outputs[stage.id] = await readArtifact(runRoot, stage);
  return outputs;
}
