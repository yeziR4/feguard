# FeGuard + FairDice — Fe Builders Challenge handoff

**Pitch:** One Fe source, two execution environments. `src/outcome.fe` compiles
verbatim to EVM bytecode *and* to a WASM module, so the code that settles a bet can
be re-run by anyone off-chain from the same source. We demonstrate that property
twice: a provably-fair casino whose results a player can independently verify on a
live testnet, and a discovery/triage tool plus observer for contracts you did not write.

**Compiler:** Fe 26.7.0 (`e6e6342`) — an allowed 26.5.0+ release.

**Public repository:** https://github.com/yeziR4/feguard

**CI:** https://github.com/yeziR4/feguard/actions/workflows/ci.yml

**Manifest:** `fe.toml` (ingot `feguard`, v0.4.0). **License:** MIT (OSI-approved).

Run `git rev-parse HEAD` in the final reviewed checkout for the complete judged
commit SHA. The latest source, license, tests, demonstration and disclosures are public.

---

## 1. The Fe-specific idea

Fe compiles to both the EVM and WASM. That is not a convenience — it makes a class
of claim *checkable* that Solidity cannot express at all: the code that produced an
on-chain result can be re-executed off-chain by a third party, from the same source.

`src/outcome.fe` holds the pure outcome logic (`roll`, `commit_seed`,
`compute_payout`, `max_payout`). It has no storage and no `ctx`. It is compiled into
`out/FairDice.bin` for the chain and into `out/feguard.wasm` for the verifier. A
cross-target test vector and `verify.mjs` fail loudly if they ever diverge.

The same discipline runs through the triage engine: decision and triage code is
written in Fe, exercised under EVM tests, and replayed from the compiled WASM.

---

## 2. Flagship demonstration — FairDice (live on Base Sepolia, 84532)

A commit–reveal dice game with an explicit 2% house edge (98% RTP), settled by a
Pyth Entropy V2 randomness callback.

| | |
|---|---|
| Multi-mode Entropy V2 deployment (Dice + Crash, 98% RTP) | `0x7a29401136d6675ec21c983b7b0e0b5f238ae7b4` |
| Entropy V2 deployment (Dice v1) | `0xd48ed9b0ad9660dd1c21964aab5468081968c774` |
| commit–reveal deployment | `0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b` |
| Pyth Entropy V2 proxy | `0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c` |

**Live evidence, verified to the wei:**

- **Second game mode (Crash) with verified 98% RTP across all targets (`1.05x–98.00x`).**
  After our own RTP audit (`reports/finding-crash-rtp.md`) caught a curve-shape
  defect in the initial Crash draft, we replaced it with the inverse-CDF
  `crash_point(u) = min(9800, 98 * 1_000_000 / (1_000_000 - u))` over
  `CRASH_DRAWS = 1_000_000` in `src/outcome.fe` (`node scripts/crash-rtp.mjs --check`
  now exits `0`). On `0x7a294011…`: Bet #1 (`placeCrashBet(5000, commit)` at 50x,
  `0x0c7a0e22…`, block 63067336) settled via Pyth keeper 3 blocks later in
  `0x42e9fd6c…` (block 63067339, crash point `2.64x`, payout `0`, balance delta `0`,
  WASM `verify.mjs` -> `MATCH`, `--tamper` -> `MISMATCH` at `1.30x`); Bet #2 (Dice
  `< 49`, `0x4afb95cf…`, block 63067352) settled in `0xefe6cefa…` (block 63067359,
  outcome `15 < 49 → WIN`, exact balance delta `+20000000000000 wei`, WASM `MATCH`).

- **Winning payout inside the entropy callback.** Bet #2 placed in `0x469cc0fa…`
  (block 63027591); the Pyth keeper delivered `_entropyCallback` in `0x67cf64e9…`
  (block 63027602, 11 blocks later). Decoded `BetSettled`: `outcome 89 < 95 → WIN`,
  `payout 103157894736842 wei`. The contract balance moved by *exactly* that amount
  across the callback block (`3675635570470357 → 3778793465207199`). This exercises
  `call.send_value` inside the callback, on-chain, to the single wei.
- **Verifier (WASM, same source).**
  `node verify.mjs --rpc https://sepolia.base.org --contract 0xd48ed9b0… --bet-id 2`
  → `MATCH` (recomputed outcome 89, identical payout); with `--tamper` → `MISMATCH`
  (recomputed 48). The verifier rejects a rigged result rather than rubber-stamping it.
- **Anti-stranding path.** `refundExpired` exercised positively on the commit–reveal
  deployment (`0xf09e0989…`, block 63028018; bankroll `-100000000000000 wei` exactly,
  `BetRefunded` emitted) and negatively on a fresh bet (`NotExpired` revert,
  selector `0x7e61955c`, error id 3).
- **Observer transition.** `scripts/watch-abandoned-bets.mjs` flagged the
  deliberately-unrevealed bet, then reported clean once it was refunded.
- **Browser demo, live.** `index.html` served locally and pointed at Base Sepolia
  renders both real bets and recomputes each outcome from `out/feguard.wasm` **in
  the page** — no server call. Tamper off: `MATCH` (`wasm=89`, `wasm=74`). Tamper
  on: `MISMATCH` (`wasm=48`, `wasm=99`). A judge can reproduce this in a browser
  in under a minute after the build step in §8.

**Why this is not just a game.** Settlement requires a randomness value that
neither party can withhold — the property the first design lacked (§4).

**Trust assumption, disclosed.** Provable fairness here assumes Pyth Entropy V2
provider liveness and non-collusion between the provider and the house or player.
That is the standard assumption of VRF-based randomness and is stated in the README.

---

## 3. Companion demonstration — screening contracts you did not write

FeGuard discovers and screens public contracts and turns source-reviewed deployment
evidence into reproducible review leads. Evidence gates, triage and initialisation
assessment run in Fe; the UI distinguishes confirmed behaviour from unproven impact;
the lab exports stateful counterexamples as Fe regressions.

**Public cohort:** `reports/cohort.json` and compressed raw evidence cover 300
contract addresses, 153 with targeted getter coverage and 196 getter observations.
Five source-reviewed initialization leads across two families are in
`reports/initialization-review.json`; their initializer calls succeed in read-only
simulation with zero initialized storage, while deployment roles and financial
impact remain unverified. The deployment-role resolver resolves the whole cohort in
one pass (`reports/cohort-roles.json`): 286 plain, 7 initialized proxies, 7
value-bearing plain contracts, and **0 uninitialized proxies**. A first pass raised 2
candidates for the uninitialized-proxy role; **both were withdrawn** after `owner()`
corroborated that they were already initialized (OZ v5 stores `_initialized` outside
slot 0) — withdrawn *before any report was made*.

**Focused investigation:** a saved 20-address batch expands the deduplicated corpus
to 320 addresses. The first policy pass flagged a handler owner differing from the
initial deployment document; a later primary-source rollout record explains a
migration to a Safe-owned admin. The original flag remains archived; a refreshed
plan and extra admin checks produce 38 matching supported observations. Four
initializer cases still need deployment-context review; no high/critical finding is
claimed.

**Resolved context case:** `reports/quickminey-proxy-context.json` captures a known
proxy pointing to QuickMiney A, consumed initialization, and the tested initializer's
already-initialized revert. The named proxy held a measured ERC-20 balance despite
zero native balance. Disposition: Low/informational hardening, **without a takeover
claim**.

**Evidence discipline:** `reports/gang-router.json` retains raw public RPC responses
at BNB block 135283992 — 32 matching observations, zero measured mismatches, two
explicit unsupported checks. No customer relationship or endorsement. Offline
negative tests alter fixtures deliberately and are not real findings. The autonomous
bounded workflow is `node scripts/run.mjs --run ID`; completed stages are hash-checked
and reused on resume, and the report only advances on full completion.

---

## 4. What we found in our own design, and fixed

`reports/finding-fairdice-withholding.md`. The first FairDice design was
commit–reveal with a secret server seed. It is *not* fair, and we showed why:

- Settlement needs both preimages; only the house holds `server_seed`; so the house
  can decline any outcome by staying silent, while `refundExpired` returns only the
  wager. Player EV is strictly negative and the house is never exposed.
- **No penalty fixes it.** A penalty smaller than the max payout is still cheaper
  than paying a win; a max-payout penalty is farmable by the *player* withholding
  their own preimage, because both parties reach the same permissionless deadline.

The repair is oracle-supplied randomness that neither party can withhold — the
Entropy V2 design in §2. `roll` and the verifier are unchanged in kind; only the
source of the randomness changed. This is the project's own thesis applied to
itself: **a verifier proves a result is real; only an observer proves a result was
ever produced.** Hence `scripts/watch-abandoned-bets.mjs`.

---

## 5. Demonstrated defects

**Defect 1 — griefing (Low–Medium, demonstrated).** `Referral.sol` (Monkey King,
BNB Chain) gates `_pending` and `_removeLiquidity` on
`userLpAmount[user] == pair.balanceOf(user)`. A one-wei external LP transfer
desynchronises this permanently: `pendingReward` reads zero and `removeLiquidity`
reverts with `LpAmountDifferent`. Demonstrated against the deployed implementation
bytecode with `eth_call` state overrides on two providers
(`node scripts/poc-referral-desync.mjs` → PASS both), and encoded as an Fe regression
in `src/findings.fe`.

**Defect 2 — accounting (Medium, demonstrated).** `_removeLiquidity` sets
`userPower[user] = 0` but never decrements `totalPower`, so the `release()`
denominator is monotonically inflated and every removal dilutes remaining users and
strands rewards. Demonstrated by executing the deployed `release()` on a BSC fork:
with `dailyTotalReward = 1000e18`, `totalPower = 200` yields
`accRewardPerShare = 5e36` while the true `100` yields `1e37` — a 100-power holder
claims `500e18` instead of `1000e18`, stranding half. See
`reports/finding-referral-totalpower.md`; also in `src/findings.fe`.

**Counts, stated plainly: demonstrated defects — two source-verified, one with a
runnable PoC; full audits — zero.** These are not customer or independent-project counts.

---

## 6. Limitations

Generic screening does not infer project-specific policy. Source-specific follow-up
requires a reviewed plan; deployment roles and asset exposure remain unverified.
Proxy slots do not authenticate delegation or admin behaviour; exhaustive role
membership is unverified. Public provider agreement is not a state proof. No hosted
scheduler, outreach, wallet execution, or automatic remediation.

FairDice is a **reference implementation — not audited and not production-ready.**
Not yet exercised live: `refundExpired` on the Entropy deployment — the identical
handler is live-tested on the commit–reveal deployment, but Pyth's keeper fulfilled
both Entropy bets within ~11 blocks.

---

## 7. Declarations

**AI assistance (disclosed).** AI tools were used extensively: an AI coding
assistant for the triage/inspection pipeline, and a separate LLM to draft the
FairDice contract, tests, verifier and UI from a written specification. Every
AI-produced result submitted here was re-executed against the chain or re-run by the
checked-in test suite; nothing rests on an AI assertion alone. The live observations
in §2, §3 and §5 were each independently re-executed by us before being written down.
A fuller account is in the README.

**Pre-existing work / starting point.** Nothing is declared as pre-existing. The
history reachable from the judged commit begins at `edbe7e0` (23 Nov 2026); the
repository contains 13 commits and every one is dated 23–24 Nov 2026, so the entire
tree falls inside the build window (3–24 Nov 2026). If any material predates the
first commit, the entrant should add one line here before submitting.

**Build-window work (3–24 Nov 2026) — what the commits contain, oldest first:**

| commit | date | contribution |
|---|---|---|
| `edbe7e0` | 23 Nov | resumable research workflow, evidence-backed case memory |
| `e873f28` | 23 Nov | deployment-role resolver; two demonstrated `Referral.sol` defects |
| `98b7cda` | 23 Nov | 300-address cohort role resolution; initialization corroboration |
| `5e04580` | 23 Nov | casino/prediction-market classification without a verified source |
| `b476bf6` | 23 Nov | Etherscan-ABI classification path |
| `a5c62b4` | 23 Nov | deployment discovery pipeline |
| `b0e9637` | 23 Nov | frontend address extractor |
| `c1b3e72` | 23 Nov | casino heuristic for `wager`-style games |
| `617e887` | 24 Nov | `src/outcome.fe`, `src/dice.fe`, `src/dice_tests.fe`, WASM verifier, `verify.mjs`, `index.html`; the withholding finding; the abandoned-bet observer |
| `a87aaf1` | 24 Nov | live Base Sepolia deployment; `eth_getLogs` 200-block paging fix |
| `ba8b8d7` | 24 Nov | Pyth Entropy V2 swap; live keeper callback verification |
| `bf277e4` | 24 Nov | live winning-payout evidence; live positive and negative `refundExpired` |
| `dd0707a` | 24 Nov | this handoff document |

The `Referral.sol` contracts analysed in §5 are third-party code, not our work; they
are the subjects, not the contribution.

**Reused code.** OpenZeppelin-derived patterns appear only inside the third-party
`Referral.sol` we analysed, never in our own source. Our Fe and JavaScript are
written for this entry.

---

## 8. Build and reproduce

```
..\tools\fe.exe --version                                  # fe 26.7.0 (e6e6342)
..\tools\fe.exe fmt --check .
..\tools\fe.exe check .
..\tools\fe.exe test .                                     # 62 pass, 0 fail
..\tools\fe.exe build . --emit bytecode,runtime-bytecode,abi,metadata \
    --backend sonatina -O 1 --out-dir out
..\tools\fe.exe build . --backend wasm --emit wasm --out-dir out
node verify.mjs --rpc https://sepolia.base.org \
    --contract 0xd48ed9b0ad9660dd1c21964aab5468081968c774 --bet-id 2
node scripts/watch-abandoned-bets.mjs \
    --contract 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b \
    --rpc https://sepolia.base.org
node scripts/poc-referral-desync.mjs
node --test scripts/cohort.test.mjs                        # offline replay
python -m http.server 8766 --bind 127.0.0.1                # then open /inspection/cohort.html
```

All live addresses, transaction hashes, decoded events, balance proofs and exact
commands are recorded in `reports/fairdice-deployment.md`. The counterexample lab is
at `/demo/`; the explicit-policy case study at `/inspection/`.

---

## 9. Before submitting

- [x] §7 declarations completed (no pre-existing work declared; full commit table included).
- [ ] Read §7 and confirm the AI and provenance declarations are accurate before submitting.
- [ ] `git rev-parse HEAD` from the final reviewed checkout → record the exact SHA.
- [ ] Confirm the working tree is clean and everything is pushed.
- [ ] Confirm `DEPLOYER_KEY` is cleared from the local environment and appears nowhere
      in the repository or its history.
- [ ] Run the §8 commands from a clean checkout and check remote CI is green.
- [ ] Submit through the private registration link and keep the acceptance email.

**Deadline: 24 November 2026, 23:59 UTC (25 November, 00:59 Lagos).**

Registration was confirmed by the organiser's registration email on 23 November;
the project ID and private submission credentials remain outside public source.
