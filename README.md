# FeGuard

**Public contract research, deployment-policy checks and replayable counterexamples, evaluated in Fe.**

[![Fe checks](https://github.com/yeziR4/feguard/actions/workflows/ci.yml/badge.svg)](https://github.com/yeziR4/feguard/actions/workflows/ci.yml)

FeGuard compares explicit documented governance policies with pinned public chain observations and turns supported discrepancies into review tasks. Its first independent deployment snapshot covers GangLaunchpad's router governance and handler ownership on BNB Chain: **32 matching observations, no measured mismatches, and 2 explicit verification gaps**. This is a prospect assessment, not an audit or a customer endorsement.

The public research workbench adds bounded discovery and qualification: **300 BNB Chain contracts screened**, **153 with targeted getter coverage**, and **five source-reviewed initialization behaviors across two contract families**. These addresses accepted read-only initializer simulations while their reviewed initialization fields were zero. The initial screen did not establish deployment roles or financial impact; later context is recorded per case. **Confirmed impact findings and full audits are both zero.** See the [research method and results](docs/COHORT-RESEARCH.md).

The user supplied a linked proxy for QuickMiney A. Independent two-provider checks confirmed that this proxy is initialized and rejects the tested initializer, supporting **Low/informational implementation hardening**. The UI links the [disposition](reports/case-dispositions.json) and [captured proxy evidence](reports/quickminey-proxy-context.json) separately from the original simulation. No takeover through this initializer was demonstrated; other addresses need their own context assessment.

The companion counterexample lab generates sequences, checks an adapter's invariants, and reduces failures into replayable Fe regressions. Its agent spending/memory examples demonstrate that forgetting a spend must never restore allowance and remembering an approval must never bypass revocation.

Both engines run in Fe's EVM tests and compile to WebAssembly for Node and the browser. JavaScript acquires and decodes public data and presents results; policy assessments, action-code selection, generation, replay and reduction are implemented in Fe.

## Open the research workbench

```sh
node --test scripts/cohort.test.mjs   # offline evidence replay and failure cases
python -m http.server 8766 --bind 127.0.0.1
# Open http://127.0.0.1:8766/inspection/cohort.html
```

Search the saved baseline and latest controller batch, filter coverage, inspect source/state/simulation evidence, and export visible rows. Each contract records its observation block. The browser verifies controller artifact hashes and replays recorded decisions in Fe before displaying them.

The [resumable controller](docs/CONTROLLER.md) now connects the reviewed shortlist, discovery, screening, explicit source probes, documented-policy checks and case memory in one bounded command. The recorded pass flagged an ownership difference, then source review identified a documented Safe → admin → handler migration. A refreshed policy and extra authority-chain checks yielded 38 matching supported observations. The original flag and explanation are preserved; no high/critical issue is claimed.

```sh
node scripts/run.mjs --verify reports/workflow.json  # offline evidence/Fe replay
node scripts/run.mjs --run my-pass --limit 20         # live bounded run
# Repeat identical arguments with --resume after an interruption.
```

The saved baseline plus latest batch covers 320 unique addresses; this is not an audit count. Four initialization cases still require deployment-context review. Source-specific policies and interpretations require explicit review. No continuously running hosted worker is implied.

```sh
node scripts/cohort.mjs --limit 100        # new bounded public sample
node scripts/review-initializers.mjs      # five explicitly reviewed targets
```

The batch's compressed raw evidence and the follow-up's source hashes/RPC responses are included. These are contract counts, not customer/project counts. The generic scanner does not infer trustworthy project policies or promote zero-owner observations into vulnerabilities.

## Resolve a deployment's role

Before an "owner is zero" observation means anything, resolve what the address **is**. This
classifies a target as proxy or plain, initialized or not, and value-bearing or not, using two
public RPC providers at a pinned block. The decision is Fe (`src/cohort.fe::role`, exported as
`fg_role`); Node only collects evidence.

```
node scripts/role.mjs 0xADDRESS [0xADDRESS ...] [--token 0xERC20] [--chain 56] [--json reports/role.json]
```

| code | role | meaning |
|---|---|---|
| 9 | plain uninitialized implementation | hardening only; no proxy, no value |
| 10 | **proxy instance uninitialized** | the one role that can reach user assets — investigate |
| 11 | proxy instance initialized | implementation initializer does not reach proxy storage |
| 12 | plain contract holding value | review its own authority directly |
| 13 | role unresolved | missing or conflicting evidence — never a finding |

Example: the QuickMiney proxy resolves to **11** (2,555 USDT held) while its implementation
resolves to **9** — which is exactly why that lead is Low and not critical. Tests:
`node --test scripts/role.test.mjs`.

## Check a public deployment

```sh
node scripts/inspect.mjs --replay reports/gang-router.json  # offline replay
node scripts/inspect.mjs                                # fresh public RPC reads
python -m http.server 8766 --bind 127.0.0.1
# Open http://127.0.0.1:8766/inspection/
```

See the [first report](reports/gang-router.md) and [operating guide](docs/DEPLOYMENT-CHECKS.md). This requires an explicit policy and supported interfaces. It does not infer arbitrary specifications, authenticate runtime code from ABI getters, or contact teams. Live collection uses two public HTTPS RPC origins; no wallet or API key is needed. Save snapshots and use `--previous` to track changes.

## Try it in one minute

Requirements: Node.js 20+ and Python 3 for the optional local preview. No npm packages, accounts, RPC endpoint, model API, or funds are needed.

```sh
node scripts/demo.mjs --all --verify
python -m http.server 8766 --bind 127.0.0.1
# Open http://127.0.0.1:8766/demo/
```

The included WASM artifact has a compiler-generated manifest and SHA256. `node scripts/verify.mjs` checks that digest and writes additional campaign evidence to `reports/verification.json`.

![Memory-eviction counterexample in the Fe-powered demo](demo/preview.png)

## Rebuild from source

Use **Fe 26.7.0**, verified as `fe 26.7.0 (e6e6342)`, from the [official release](https://github.com/argotorg/fe/releases/tag/v26.7.0).

```sh
fe --version
fe fmt --check
fe check
fe test
fe build
fe test --backend wasm
fe build --backend wasm --out-dir demo/engine
node scripts/demo.mjs --all --verify
node scripts/verify.mjs
node --test scripts/inspection.test.mjs
node --test scripts/cohort.test.mjs
node --test scripts/controller.test.mjs scripts/focused.test.mjs scripts/workflow-evidence.test.mjs
node scripts/run.mjs --verify reports/workflow.json
node scripts/inspect.mjs --replay reports/gang-router.json
```

EVM integration tests are gated to the EVM target. Shared engine, oracle, reduction, and library tests also run under WASM. `fe build` additionally produces the policy demonstration contract and storage replay harness. Both hold no funds.

## What the demonstration actually finds

These are **three intentional mutant fixtures**, not newly discovered vulnerabilities in deployed software. All use the same action generator as the corrected target.

With start seed `0`, 64 cases, and 64 actions per case:

| Target | First failing prefix | Reduced trace | Failure |
| --- | ---: | ---: | --- |
| Memory eviction refund | 25 actions | 9 actions | Forgetting a spend restores allowance |
| Rejected request debit | 9 actions | 1 action | A rejected request consumes allowance |
| Stale permission replay | 32 actions | 3 actions | Spend → revoke → spend is incorrectly authorized |

Every reduced trace reproduces its original failure class and passes on the corrected target. Removing any one remaining action stops reproducing that same failure class. This is **single-action-deletion minimality**, not globally shortest traces or globally minimal argument values.

`reports/demonstration.json` contains action-by-action evidence, including allowance in the faulty and corrected implementations. `reports/verification.json` records additional seeds, a 4,096-trace corrected campaign, seed wraparound, and input checks. Passing a finite campaign is not an exhaustive security proof.

## Export a regression

```sh
node scripts/demo.mjs --target 3 --seed 0 --cases 64 --steps 64 \
  --json reports/stale-permission.json --repro src/my_regression.fe
fe test --filter exported_counterexample
```

The browser's **Export Fe regression** button produces the same kind of test module. It contains reduced actions, the expected failure class, deletion-minimality verification, and corrected-target replay. Copy the downloaded `.fe` file into this ingot's `src/` directory and run the command above. Generated memory-eviction and stale-permission regressions are included in the suite.

Seed arithmetic wraps explicitly at 64 bits. The engine clamps campaigns to 4,096 traces and traces to 64 actions. The CLI rejects unsupported input ranges.

## Reuse the engine

The engine does not depend on wallets, the guard oracle, or demonstration failure codes:

```fe
pub trait Machine {
    fn reset(mut self)
    fn action(self, _ random: u64) -> Action
    fn step(mut self, _ action: Action) -> u64
}
```

Implement `Machine` for a target adapter. `action` maps a random word to an action. `step` executes it and returns zero when invariants hold, or a stable nonzero failure class. `reset` restores the same starting state before every replay. The engine exposes `generate`, `replay`, `search`, `reduce`, and `one_minimal` in `ingot::fuzz`.

The action carrier contains a target-defined `u64` opcode and `u64` value. Adapters assign their own meanings and generation distribution. Tests include an unrelated counter and a target with competing failure classes, demonstrating reuse and ensuring reduction does not switch to a different bug.

### Reduction

1. Replay from reset and retain the first failure class.
2. Remove the suffix after that failure.
3. Delete chunks, eventually testing individual actions.
4. Try argument anchors `0` and `1`, then clear high bits, retaining changes preserving the same class.
5. Perform another complete action-deletion pass and replay the final trace.

The SplitMix64 mixer supplies deterministic pseudo-random words, mixing each next word from the previous output. It is not a cryptographic generator or coverage-guided search.

## Agent-memory target

The initial session budget is 100 units, each request is limited to 60, and expiry is at modeled time 1000. Actions include spending, wrong recipients, previews, owner revocation, advancing time, memory recall, wrong callers, and adding a note. Memory retains eight structured episodes.

An independent scalar oracle computes expected decisions from lifetime authorized spending, policy state, caller, recipient, amount, and time. It does not call the implementation's `preview` or `authorize` or reconstruct allowance from the target's balance or memory. Checks include budget conservation, unchanged allowance after rejection, immediate revocation, and decision parity.

The corrected adapter calls the actual FeGuard policy and memory functions. The three faulty adapters each introduce a documented mutation. Memory references never grant permission.

## Fe-specific contribution

- **Traits and generics:** one generation/replay/reduction engine works with multiple adapters.
- **Explicit effects:** the policy library declares read-only preview, mutable budget authorization, and separate memory effects.
- **Typed units:** `Wei` and `Timestamp` keep amounts and time distinct.
- **Multiple backends:** the same Fe sources run in EVM tests and WASM; the browser uses the compiled engine.
- **Storage replay:** an integration test deploys `FuzzModelHarness`, executes generated actions through ABI calls, and compares every result and accounting state with the in-memory model for all four targets.

## Source map

| Path | Purpose |
| --- | --- |
| `src/fuzz.fe` | Reusable generation, replay, search, and reduction |
| `src/guard_machine.fe` | Correct adapter, independent oracle, three intentional mutants |
| `src/lib.fe` | Typed policy, budget, memory, and `GuardDemo` |
| `src/evm_harness.fe` | ABI/storage replay harness |
| `src/wasm_api.fe` | Thin scalar export ABI |
| `src/deployment_policy.fe` | Evidence-aware deployment policy and action evaluator |
| `src/cohort.fe` | Public-screening triage and evidence-gated initialization review |
| `policies/` and `inspection/` | Explicit public policy and recorded-snapshot viewer |
| `src/*tests.fe` | Unit, model, reduction, export, and EVM checks |
| `demo/` | Browser UI, Web Worker, WASM, and compiler manifest |
| `scripts/` | Dependency-free CLI and verification runner |
| `reports/` | Evidence for documented campaigns |

## Scope and limitations

This bounded testing prototype requires a Fe adapter with explicit invariants. It does not automatically attach to arbitrary deployed contracts, infer specifications, measure branch coverage, catch panics as shrinkable verdicts, or replace an audit. Targets must reset deterministically and return stable failure classes. Only the first violation in a replay is reported.

The harness and original demonstration contract authorize or record actions; they do not implement wallet transfers, signature verification, or a semantic LLM memory service. Notes are synthetic memory operations. Evidence hashes are caller-supplied references, not proof of external facts. On-chain fields are public.

The counterexample WASM ABI/UI expose the guard adapter; other adapters can use the generic Fe API. Its state summaries are specialized to that model's small values. The deployment-policy ABI separately preserves full `u256` inputs. Native execution has not been verified. Local results are distinct from remote CI: an unrun workflow is not a passing check.

## Findings

Two source-verified defects in `Referral.sol` (Monkey King / `mking.fun`, BNB Chain):

1. **LP-balance desynchronisation (griefing, Low–Medium, demonstrated).** `_pending` and
   `_removeLiquidity` both require `userLpAmount[user] == pair.balanceOf(user)`, and nothing
   re-synchronises the recorded value. A one-wei `pair.transfer(victim, 1)` makes
   `pendingReward` read zero and `removeLiquidity` revert permanently. Reproduce with
   `node scripts/poc-referral-desync.mjs` (state-override `eth_call` against the deployed
   implementation; no transaction). Details: `reports/finding-referral-lp-desync.md`.
2. **`totalPower` is never decremented (accounting, Medium, demonstrated).** `_removeLiquidity`
   zeroes `userPower` but not `totalPower`, so the release denominator only grows. Each
   removal dilutes remaining users and strands reward tokens; repeated buy/remove cycles
   drive per-share allocation toward zero. Executed `release()` on a fork: with
   `dailyTotalReward = 1000e18`, `totalPower = 200` allocates `5e36` per share versus `1e37`
   at the true `100` — a 100-power holder claims `500e18` instead of `1000e18`. Details:
   `reports/finding-referral-totalpower.md`.

Both are encoded as executable regressions in `src/findings.fe` (`fe test --filter referral`).

## Contest declaration

- **Build period:** initial policy/memory prototype begun 16 November 2026; testing engine, discovery/screening worker, source-gated initialization follow-up, deployment checker and evidence added from 23 November, within the contest window.
- **Reused work:** Fe, its standard library/test runner, documented SplitMix64 mixing constants, and language/test conventions from official documentation. Public input data comes from Sourcify and BNB RPC endpoints; source references are third-party work. No third-party application dependencies or copied fuzzing implementation.
- **AI assistance:** OpenAI Codex assisted with design, implementation, tests, UI, documentation, and registration. The human entrant must review, understand, and explain the submission.
- **License:** MIT.
- **Registration:** the organizer's registration confirmation email was located on 23 November. Keep the project ID/private submission credentials outside this repository. Final submission is still outstanding.

See [SUBMISSION.md](SUBMISSION.md). Final submission for judging has not been performed.
