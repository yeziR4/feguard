# FeGuard contest handoff

**Pitch:** FeGuard turns explicit public deployment policies and pinned chain observations into evidence-backed review tasks, with policy decisions evaluated in Fe. Its companion lab reduces stateful failures into replayable Fe regressions.

**Problem:** A documented ownership or timelock promise needs independent verification after deployment. Unsupported reads must remain unknown rather than becoming invented findings. Separately, stateful bugs need reproducible sequences rather than isolated examples.

**Contribution:** Evidence-state handling, full-width policy comparisons and action selection are written in Fe, alongside generation, replay, invariant adapters and same-failure reduction. Shared code runs under EVM tests and WASM. JavaScript performs read-only RPC collection, strict ABI decoding, provider comparison and presentation.

**Compiler:** Fe 26.7.0 (`e6e6342`).

**Public repository:** https://github.com/yeziR4/feguard

**CI:** https://github.com/yeziR4/feguard/actions/workflows/ci.yml

Use `git rev-parse HEAD` from the final reviewed checkout to obtain the complete judged commit SHA. The latest source, license, tests, demonstration, and disclosures are public.

**Demo:** `node scripts/inspect.mjs --replay reports/gang-router.json`; live refresh with `node scripts/inspect.mjs`. Serve the repository with `python -m http.server 8766 --bind 127.0.0.1` and open `/inspection/`. The counterexample lab remains at `/demo/`.

**Evidence:** `reports/gang-router.json` retains raw public RPC responses at BNB block 135283992: 32 matching observations, zero measured mismatches, two explicit unsupported checks. No customer relationship or endorsement. Offline negative tests alter fixtures deliberately; they are not real findings. Model evidence remains in `reports/demonstration.json`, `reports/verification.json`, generated regressions and EVM storage replay.

**Limitations:** Explicit policy/adapter required; ABI observations do not authenticate runtime semantics; actual immutable proxy admin and exhaustive role membership remain unverified. Public provider agreement is not a state proof. Bounded model search requires deterministic reset and stable failure classes. No wallet execution or automatic remediation. See README and the deployment guide for full scope and AI disclosure.

Registration: **Received — validation pending.** Acceptance/project ID has not been confirmed in this chat. Keep the private link/code outside public source.

Final submission closes **24 November 2026, 23:59 UTC (25 November, 00:59 Lagos)**.

Before submission:

- Confirm acceptance email and project ID.
- Review implementation and AI declaration with the human entrant.
- Review the published repository linked above.
- Run documented commands from a clean checkout and check remote CI.
- Record the actual public repository URL and full final commit SHA.
- Submit through the private link and check the automated acceptance email.

The repository is published. Final submission has not been performed.
