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

**Public cohort:** `reports/cohort.json` and compressed raw evidence cover 300 contract addresses, 153 with targeted getter coverage and 196 getter observations. Five source-reviewed initialization leads across two families are recorded separately in `reports/initialization-review.json`. Their initializer calls succeed in read-only simulation with zero initialized storage. Deployment roles and financial impact remain unverified. **Demonstrated defects: two source-verified, one with a runnable PoC; full audits: zero.** The deployment-role resolver resolves the whole 300-contract cohort in one pass (`reports/cohort-roles.json`): 286 plain, 7 initialized proxies, 7 value-bearing plain contracts, and **0 uninitialized proxies**. A first pass raised 2 code-10 candidates; both were withdrawn after `owner()` corroborated that they were initialized (OZ v5 storage), before any report was made. These are not customer or independent-project counts.

**Defect 1 — griefing (Low–Medium, demonstrated).** `Referral.sol` (Monkey King, BNB Chain) gates `_pending` and `_removeLiquidity` on `userLpAmount[user] == pair.balanceOf(user)`. A one-wei external LP transfer desynchronises this permanently: `pendingReward` reads zero and `removeLiquidity` reverts with `LpAmountDifferent`. Demonstrated against the deployed implementation bytecode with `eth_call` state overrides on two providers (`node scripts/poc-referral-desync.mjs` → PASS both) and encoded as an Fe regression in `src/findings.fe`.

**Defect 2 — accounting (Medium, demonstrated).** `_removeLiquidity` sets `userPower[user] = 0` but never decrements `totalPower`. The release denominator is therefore monotonically inflated, so every removal dilutes remaining users and strands reward tokens. Demonstrated by executing the deployed `release()` on a BSC fork: with `dailyTotalReward = 1000e18`, `totalPower = 200` yields `accRewardPerShare = 5e36` while the true `100` yields `1e37` — a 100-power holder claims `500e18` instead of `1000e18`, stranding half. See `reports/finding-referral-totalpower.md`; also encoded in `src/findings.fe`.

**Limitations:** Generic screening does not infer project-specific policy. Source-specific follow-up requires a reviewed plan; deployment roles/asset exposure remain unverified. Proxy slots do not authenticate delegation/admin behavior; exhaustive role membership is unverified. Public provider agreement is not a state proof. No hosted scheduler, outreach, wallet execution or automatic remediation. See README and the research/deployment guides for full scope and AI disclosure.

**Autonomous bounded workflow:** `node scripts/run.mjs --run ID` connects reviewed qualification inputs, bounded discovery, runtime/getter screening, explicit source probes, focused policy checks and persistent case memory. Completed stages are hash checked and reused on resume; the latest report advances only on full completion. The browser verifies artifacts and replays Fe decisions. Source plans and impact interpretations remain explicit reviewed inputs.

**Focused investigation:** A saved 20-address batch expands the deduplicated research corpus to 320 addresses. The first policy pass flagged a handler owner differing from the initial deployment document. A later primary-source rollout record explains a migration to a Safe-owned admin. The original flag remains archived; a refreshed plan and extra admin checks produce 38 matching supported observations. Memory retains the documented explanation and QuickMiney's historical Low context. Four initializer cases still need deployment-context review; no high/critical finding is claimed. See `docs/CONTROLLER.md` and `reports/workflow.json`.

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
