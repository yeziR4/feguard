# FeGuard research workbench: 90-second walkthrough

Serve the repository (`python -m http.server 8766 --bind 127.0.0.1`) and open `/inspection/cohort.html`.

## 0–20 seconds: show a flag that required context

“A deployed handler's owner differed from its initial deployment document. Our worker flagged the difference. Following the project's rollout record showed a documented migration to a Safe-owned admin. We kept the original evidence, checked the replacement authority chain, and recorded why this is not a demonstrated vulnerability.”

Show the controller's **Flag → source review → documented migration** panel, original flag evidence, project source link and 38 matching supported policy observations. The semantic interpretation required review; it was not autonomously inferred by the worker.

Show QuickMiney A's later **Low hardening** disposition and the independent proxy evidence. Its named proxy is initialized and rejects the tested initializer, while the implementation's own simulation succeeds. The proxy held a named token despite having no native balance. Explain that the useful result is a reproducible hardening classification, without a live-takeover claim.

## 20–45 seconds: contrast behavior with impact

Filter **Validated initialization leads**, search **QuickMiney**, and select a row. Show the reviewed source path, zero initialized field, arbitrary-caller read-only simulation and pinned follow-up block. The source function is spelled `initilize`.

“On QuickMiney A, the implementation accepts initialization, but the independently checked named proxy is already initialized and rejects that call. We classify this path as Low/informational hardening. Four other initialization cases still need their own context; we have not demonstrated a high or critical issue.”

## 45–65 seconds: explain the evidence gates

Show `src/cohort.fe`: its source-specific rule requires runtime corroboration, reviewed source semantics, uninitialized storage and successful simulation together. Unknown evidence does not become zero. Source or runtime disagreement prevents the simulation worker from proceeding. Zero owner alone is context.

The offline cohort tests reconstruct the 300-contract batch from compressed public RPC evidence and test missing data, disagreement, deduplication and source gates. Public source hashes/URLs and simulation requests/responses are preserved.

## 65–90 seconds: show the repeatable process

Show `node scripts/run.mjs --verify reports/workflow.json` for a quick offline replay. Then show the live command `node scripts/run.mjs --run my-pass --limit 20`. The controller connects six stages, saves verified checkpoints and supports resume with identical arguments plus `--resume`. Failure tests show that a failed stage does not publish a partial latest report.

The workbench combines 320 unique addresses from the baseline and current batch, with each observation's block retained. Address counts are not audits or independent-project counts. Memory retains the historical Low assessment, the documented migration explanation and four open context tasks. Omission from a later batch never silently resolves a case.

“Fe evaluates the deterministic policy/triage decisions on EVM and WASM. JavaScript acquires data and presents it. The worker performs bounded batches; we have not deployed a continuously running service or sent any on-chain transactions.”

## Optional counterexample-lab walkthrough

Serve the repository (`python -m http.server 8766 --bind 127.0.0.1`) and open `/demo/`.

## 0–15 seconds: the problem

“An agent can forget an old action without regaining permission to spend its money. FeGuard tests these rules across sequences of actions, then turns a failure into a small regression.”

## 15–40 seconds: memory-eviction failure

Choose **Fault 01 · Memory eviction refund**, seed `0`, 64 traces, 64 actions. Run the campaign. The first failing prefix contains 25 actions; reduction keeps nine. In the last row, the faulty allowance increases from 99 to 100 when an old spending record leaves memory. Correct accounting stays at 99.

Explain that this is an intentionally injected fixture, not a claimed discovery in a deployed wallet. Each remaining action is necessary for this failure class under single-action deletion.

## 40–55 seconds: the temporal failure

Choose **Fault 03 · Stale permission replay** and run. The reduced sequence is **spend(1), revoke, spend(1)**. The faulty implementation accepts the final request; the corrected replay keeps its allowance unchanged.

## 55–70 seconds: an artifact a developer can use

Click **Export Fe regression**. Show the downloaded file: it contains the concrete actions, expected failure class, minimality check, and corrected-target replay. Copy it into `src/` and run `fe test --filter exported_counterexample`.

## 70–90 seconds: why Fe

“The generator, oracle adapter, search, replay and reducer are Fe code. A generic Machine trait supports other targets. The same sources run in EVM tests and WebAssembly; JavaScript only presents the results. A deployed-storage replay test also checks the generated actions against the in-memory model.”

Show the corrected target and the recorded 4,096-trace campaign. State the bound: this is reproducible testing, not an exhaustive security proof.

## Technical questions the entrant should be able to answer

- Why can memory eviction violate budget accounting even before the next overspend?
- How does the reference oracle avoid calling the implementation being checked?
- Why does every replay reset the target?
- How does reduction preserve a failure class when another bug is also present?
- What does single-action-deletion minimality guarantee, and what does it not guarantee?
- Which code runs in Fe, and which code only presents results?
- What changes are needed to adapt the engine to another protocol?
- What are the limits of the model and the finite action budget?
