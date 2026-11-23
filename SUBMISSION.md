# FeGuard contest handoff

**Pitch:** FeGuard discovers and screens public contracts, then turns source-reviewed deployment evidence into reproducible review leads. Evidence gates and triage run in Fe. The UI distinguishes confirmed behavior from unproven impact; the companion lab exports stateful counterexamples as Fe regressions.

**Problem:** A documented ownership or timelock promise needs independent verification after deployment. Unsupported reads must remain unknown rather than becoming invented findings. Separately, stateful bugs need reproducible sequences rather than isolated examples.

**Contribution:** Evidence-state handling, full-width policy comparisons, public-cohort triage and source-gated initialization assessment are written in Fe, alongside generation/replay/reduction. Shared code runs under EVM tests and WASM. JavaScript performs bounded discovery, read-only RPC collection, strict decoding, provider comparison, incident history and presentation.

**Compiler:** Fe 26.7.0 (`e6e6342`).

**Public repository:** https://github.com/yeziR4/feguard

**CI:** https://github.com/yeziR4/feguard/actions/workflows/ci.yml

Use `git rev-parse HEAD` from the final reviewed checkout to obtain the complete judged commit SHA. The latest source, license, tests, demonstration, and disclosures are public.

**Demo:** Serve the repository with `python -m http.server 8766 --bind 127.0.0.1` and open `/inspection/cohort.html`. Offline replay: `node --test scripts/cohort.test.mjs`. Fresh batches: `node scripts/cohort.mjs --limit 100`. Source-reviewed follow-up: `node scripts/review-initializers.mjs`. The explicit-policy case study remains at `/inspection/` and the counterexample lab at `/demo/`.

**Evidence:** `reports/gang-router.json` retains raw public RPC responses at BNB block 135283992: 32 matching observations, zero measured mismatches, two explicit unsupported checks. No customer relationship or endorsement. Offline negative tests alter fixtures deliberately; they are not real findings. Model evidence remains in `reports/demonstration.json`, `reports/verification.json`, generated regressions and EVM storage replay.

**Resolved context case:** `reports/quickminey-proxy-context.json` independently captures a known proxy pointing to QuickMiney A, consumed initialization and the tested initializer's already-initialized revert. The named proxy held a measured ERC-20 balance despite zero native balance. The disposition is Low/informational implementation hardening, without a takeover claim. The reviewed custom base lacks the generic `_disableInitializers()` helper, so remediation must be version-compatible.

**Public cohort:** `reports/cohort.json` and compressed raw evidence cover 300 contract addresses, 153 with targeted getter coverage and 196 getter observations. Five source-reviewed initialization leads across two families are recorded separately in `reports/initialization-review.json`. Their initializer calls succeed in read-only simulation with zero initialized storage. Deployment roles and financial impact remain unverified. **Confirmed impact findings: zero; full audits: zero.** These are not customer or independent-project counts.

**Limitations:** Generic screening does not infer project-specific policy. Source-specific follow-up requires a reviewed plan; deployment roles/asset exposure remain unverified. Proxy slots do not authenticate delegation/admin behavior; exhaustive role membership is unverified. Public provider agreement is not a state proof. No hosted scheduler, outreach, wallet execution or automatic remediation. See README and the research/deployment guides for full scope and AI disclosure.

Registration: **Confirmed by the organizer's registration email**, located on 23 November. Project ID and private submission credentials remain outside public source. Final submission is still outstanding.

Final submission closes **24 November 2026, 23:59 UTC (25 November, 00:59 Lagos)**.

Before submission:

- Use the privately retained registration email and project ID.
- Review implementation and AI declaration with the human entrant.
- Review the published repository linked above.
- Run documented commands from a clean checkout and check remote CI.
- Record the actual public repository URL and full final commit SHA.
- Submit through the private link and check the automated acceptance email.

The repository is published. Final submission has not been performed.
