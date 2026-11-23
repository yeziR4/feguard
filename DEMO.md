# A 90-second FeGuard walkthrough

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
