# FeGuard contest handoff

**Pitch:** FeGuard generates stateful counterexamples and reduces them into replayable Fe regressions, demonstrated on agent memory and spending-policy failures.

**Problem:** Bugs may require a sequence of plausible actions: an old spend is evicted, a cached approval survives revocation, or a rejected request silently consumes allowance. A seed, trace, and reduced regression make the failure inspectable.

**Contribution:** Generation, replay, search, invariant adapters, and same-failure reduction are written in Fe. Shared code runs under EVM tests and WASM. The browser presents results from the compiled engine. Generic adapters, explicit effects, typed units, and deployed-storage replay demonstrate Fe-specific value.

**Compiler:** Fe 26.7.0 (`e6e6342`).

**Demo:** `node scripts/demo.mjs --all --verify`, or serve the repository with `python -m http.server 8766 --bind 127.0.0.1` and open `/demo/`.

**Evidence:** `reports/demonstration.json`, `reports/verification.json`, generated regressions, and the EVM storage replay test. Faults are intentional mutants, not discoveries in deployed software.

**Limitations:** Explicit adapter required; bounded, non-coverage-guided search; deterministic reset and stable failure classes required; deletion-minimal rather than globally shortest output; no shrinking of target panics or wallet execution. See README for full scope and AI disclosure.

Registration: **Received — validation pending.** Acceptance/project ID has not been confirmed in this chat. Keep the private link/code outside public source.

Final submission closes **24 November 2026, 23:59 UTC (25 November, 00:59 Lagos)**.

Before submission:

- Confirm acceptance email and project ID.
- Review implementation and AI declaration with the human entrant.
- Approve and publish the prepared public repository; explicit public-disclosure approval is still pending.
- Run documented commands from a clean checkout and check remote CI.
- Record the actual public repository URL and full final commit SHA.
- Submit through the private link and check the automated acceptance email.

The public URL and judged commit must come from the actual published result. Final submission has not been performed.
