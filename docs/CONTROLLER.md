# A bounded research workflow with memory

Run from the repository root with Node 20+:

```sh
node scripts/run.mjs --run first-pass --limit 20
# If interrupted, repeat the SAME arguments and add --resume:
node scripts/run.mjs --run first-pass --limit 20 --resume
node scripts/run.mjs --verify reports/workflow.json  # offline
```

Live collection uses Sourcify and two public BSC RPC origins. It needs no wallet, API key or model API. The discovery budget is 1–40 addresses per controller run. This is a CLI that stops when its configured work finishes, not a hosted scheduler. The lower-level discovery command remains available for larger bounded research batches.

The six stages load the reviewed prospect shortlist, discover a bounded verification sample, corroborate runtime/read supported getters, run an explicit source-reviewed initializer plan, compare explicit documented governance promises, and reconcile case memory. The initialization and governance plans are fixed inputs: the worker does not autonomously infer arbitrary source semantics or invent a security policy. Reviewed prospect selection and later interpretation remain human/analyst work.

Each network stage pins and rechecks its own finalized block across two public RPC origins. A run contains several labeled snapshots, not one atomic snapshot. Verification time is not deployment time, and provider agreement does not establish provider independence or a cryptographic state proof.

## Continue from a previous run

Use an immutable prior manifest, rather than the moving `reports/workflow.json` pointer:

```sh
node scripts/run.mjs --run next-pass --limit 20 \
  --previous reports/runs/first-pass/manifest.json
```

To refresh the same population and its captured verification metadata, add `--refresh`. Runtime and state observations are reacquired at fresh pinned blocks:

```sh
node scripts/run.mjs --run refreshed-pass --refresh \
  --previous reports/runs/first-pass/manifest.json
```

Every completed stage is saved as compressed JSON with a SHA256 in `reports/runs/ID/`. A checkpoint records its attempt count and completion time. `--resume` verifies completed artifact hashes and reuses them; a failed stage is retried. Changed code, policies, engine, baseline evidence, prior manifest or configuration require a new run ID. Resuming a completed run does not collect newer data. Start a new run for fresh observations.

The public latest pointer advances only after all stages succeed. An interrupted run can leave an orphan temporary artifact, but cannot replace that pointer with a partial run. Local concurrent execution is blocked by `out/controller.lock`. After a killed process, inspect the PID in that file and confirm it is no longer running before removing a stale lock. A corrupt completed checkpoint causes a stop; do not edit captured evidence to make it pass. Use a new run if integrity cannot be restored from a trustworthy copy.

The hashes establish integrity relative to the manifest. They do not authenticate the original publisher, timestamp or chain state.

## What memory preserves

- Stable address/rule keys suppress duplicate cases and retain first-seen time and run count.
- Initialization behavior stays distinct from deployment-context severity. QuickMiney A retains the historical Low/informational assessment and the independent proxy-evidence digest; that context is explicitly not refreshed by the generic source probe.
- Omitted cases become unverified. A narrow signal clears only after the same supported rule produces a corroborated non-signal.
- A changed policy does not silently clear its prior flag. An explicit documented-migration disposition must name replacement evidence and fresh matching checks for the authority chain.
- Address totals deduplicate the baseline and linked runs. They are neither audits nor client counts.

## Recorded investigation

The first controller snapshot (`focused-20261123`) screened 20 additional addresses and tested 35 documented governance observations across GangLaunchpad deployment surfaces and AWP's BSC deployment references. It recorded 34 matches and one ownership mismatch, at focused block **135303887**.

The handler at `0x99E882a21847012329351B598ceB93B135691b3B` had a contract owner instead of the Safe named in its initial deployment record. A later [module rollout record](https://github.com/gangfun/gang-launchpad/blob/4e3433076c0eac1cffa20b76e8e05bea6b17238d/docs/MAINNET-GANG-LAUNCHPAD-3-MODULES-2026-11-03.md) explicitly documents the transfer to `GangHandlerAdmin` at `0xC833CEC2B283759003945C0Bf8C048aB1949Af76`, with the Safe owning that admin. This is a documented migration, not demonstrated unauthorized ownership.

The `reviewed-20261123` run reused the 20-address population, refreshed its live observations, corrected the reviewed policy and checked the extra admin ownership/pending-owner edges. All **38 supported policy observations matched**. Both runs and the source-linked interpretation are retained. There are **zero demonstrated financial-impact findings** and **four unresolved initialization-context tasks**. None is assigned a high/critical severity.

Other apparent prospects were deferred because their documents describe planned deployments, or because a verification name alone did not establish an official policy source. See `reports/prospect-qualification.json`. Gang's intentionally immediate Safe ownership is not flagged as a missing timelock.

## Offline review and tests

```sh
node scripts/run.mjs --verify reports/workflow.json
node --test scripts/controller.test.mjs scripts/focused.test.mjs scripts/workflow-evidence.test.mjs
```

Offline verification checks all six compressed artifact hashes and replays the saved deterministic Fe decisions. Tests also reconstruct focused observations and the current batch from captured RPC responses without network access. Failure tests cover stage retry, immutable checkpoint reuse, changed inputs, corruption, concurrent writers, missing cases, policy changes and the evidence gate on documented-migration explanations.

The workbench combines the original 300-address snapshot with the latest controller batch, marks each contract's observation block, verifies controller artifact hashes, and replays the decisions through the included Fe WASM engine before rendering. Downloads retain the complete history.
