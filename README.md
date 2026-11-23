# FeGuard

**A stateful counterexample generator and trace reducer written in Fe.**

[![Fe checks](https://github.com/yeziR4/feguard/actions/workflows/ci.yml/badge.svg)](https://github.com/yeziR4/feguard/actions/workflows/ci.yml)

FeGuard generates sequences of actions, checks a target's invariants, and reduces a failure into a reproducible regression test. Its first target is an agent's spending policy and bounded episodic memory: forgetting old actions must never restore spending allowance, and remembering an approval must never bypass revocation.

The reusable engine runs in Fe's EVM test environment and compiles to WebAssembly for the CLI and browser demo. JavaScript marshals inputs and presents results; generation, policy evaluation, replay, and reduction are implemented in Fe.

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
| `src/*tests.fe` | Unit, model, reduction, export, and EVM checks |
| `demo/` | Browser UI, Web Worker, WASM, and compiler manifest |
| `scripts/` | Dependency-free CLI and verification runner |
| `reports/` | Evidence for documented campaigns |

## Scope and limitations

This bounded testing prototype requires a Fe adapter with explicit invariants. It does not automatically attach to arbitrary deployed contracts, infer specifications, measure branch coverage, catch panics as shrinkable verdicts, or replace an audit. Targets must reset deterministically and return stable failure classes. Only the first violation in a replay is reported.

The harness and original demonstration contract authorize or record actions; they do not implement wallet transfers, signature verification, or a semantic LLM memory service. Notes are synthetic memory operations. Evidence hashes are caller-supplied references, not proof of external facts. On-chain fields are public.

The WASM ABI/UI expose the guard adapter; other adapters can use the generic Fe API. WASM state summaries are specialized to this model's small values. Native execution has not been verified. Local results are distinct from remote CI: an unrun workflow is not a passing check.

## Contest declaration

- **Build period:** initial policy/memory prototype begun 16 November 2026; testing engine, reduction, cross-backend demo, and evidence added from 23 November, within the contest window.
- **Reused work:** Fe, its standard library/test runner, documented SplitMix64 mixing constants, and language/test conventions from official documentation. No third-party application dependencies or copied fuzzing implementation.
- **AI assistance:** OpenAI Codex assisted with design, implementation, tests, UI, documentation, and registration. The human entrant must review, understand, and explain the submission.
- **License:** MIT.
- **Registration:** form received; acceptance and project ID still need confirmation by email. Keep private submission credentials outside this repository.

See [SUBMISSION.md](SUBMISSION.md). Final submission for judging has not been performed.
