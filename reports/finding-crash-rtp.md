# Finding: FairDice Crash mode does not return the advertised 2%

**Status:** found and fixed in `src/outcome.fe` / `src/dice.fe` (redeployed to Base Sepolia at `0x7a29401136d6675ec21c983b7b0e0b5f238ae7b4`; `node scripts/crash-rtp.mjs --check` now exits `0` with 98.000% RTP across all legal targets). Original finding preserved below.
**Type:** stated economics vs actual economics. Not a security vulnerability.
**Affects:** Crash mode only. Dice mode is exact (verified below).

---

## The claim under test

`src/outcome.fe:8` states the house edge, and the UI and README repeat it:

> House edge: explicit 2% (98% theoretical RTP, before integer wei truncation).

A provably-fair game must return the same fraction of every wager it accepts,
whatever the player chooses. If that fails for some choices, the advertised edge
is false — and the failure is invisible to the player, because it is a property of
the *curve*, not of any individual result. The outcome verifier cannot see it
either: every individual bet settles exactly as committed. This is the class of
defect that requires checking the payout function, not the settlement.

## Method

`node scripts/crash-rtp.mjs` enumerates **every** possible draw and computes the
exact expected payout, so the result is a proof over the whole space rather than a
sample. It mirrors the constants in `src/outcome.fe:17-18,65-80` and asserts the
advertised edge; `--check` exits non-zero when a curve deviates.

## Result — Crash mode

| target | fair win prob | actual win prob | actual RTP | real house edge |
|---|---|---|---|---|
| 1.05x | 93.333% | 93.000% | 97.650% | 2.350% |
| 2.00x | 49.000% | 49.000% | 98.000% | 2.000% |
| 3.00x | 32.667% | 32.000% | 96.000% | 4.000% |
| 5.00x | 19.600% | 19.000% | 95.000% | 5.000% |
| 7.00x | 14.000% | 14.000% | 98.000% | 2.000% |
| 10.00x | 9.800% | 9.000% | 90.000% | 10.000% |
| 20.00x | 4.900% | 4.000% | 80.000% | 20.000% |
| 35.00x | 2.800% | 2.000% | 70.000% | 30.000% |
| 49.00x | 2.000% | 2.000% | 98.000% | 2.000% |
| **50.00x** | 1.960% | 1.000% | **50.000%** | **50.000%** |
| 70.00x | 1.400% | 1.000% | 70.000% | 30.000% |
| 98.00x | 1.000% | 1.000% | 98.000% | 2.000% |

Worst case across the whole legal range: **50.950% RTP (49.05% edge) at 49.05x.**

The 2% edge holds only at multipliers that happen to divide evenly (2.00x, 7.00x,
49.00x, 98.00x, …). Everywhere else it is worse for the player, and at 50x it is
twenty-five times worse than advertised.

## Root cause — two compounding errors

The win condition is `mult_x100 <= crash_point(u)` with

```fe
crash_point(u) = (HOUSE_RTP_NUM * 100) / (u + 1)      // 9800 / (u + 1)
```

so the player wins iff `u + 1 <= 9800 / mult_x100`, giving

```
P(win) = floor(9800 / m) / 100        where m is the target in x100 units
```

A 98% RTP curve must instead satisfy `P(win) = 98 / m`. Two things break that:

1. **Wrong curve shape.** `1/(u+1)` decreases as `u` grows, so the entire high
   multiplier range is compressed into the first few draws. The correct
   inverse-CDF for `P(crash_point >= m) = 98/m` is proportional to `1/(N - u)`,
   which spreads large multipliers across the whole draw space. The current form
   inverts the tail, which is why the deviation grows with the target.
2. **Too few draws.** With 100 outcomes, probabilities can only be multiples of
   1%. A 50x target needs `98/50 = 1.96%`. It is simply not representable, so it
   rounds to 1% — and a 1% win chance at a 50x payout is exactly 50% RTP.

Neither fix alone is sufficient: the correct shape at 100 draws still rounds
1.96% down to 1%, and a wider draw space with the wrong shape makes the tail even
thinner. Both are required.

## The fix

Shape and resolution together:

```fe
pub const CRASH_DRAWS: u256 = 1_000_000

pub fn crash_draw(server_seed: u256, client_seed: u256, bet_id: u256) -> u256 {
    keccak_words([server_seed, client_seed, bet_id]) % CRASH_DRAWS
}

pub fn crash_point(u: u256) -> u256 {
    if u >= CRASH_DRAWS { return 0 }
    let c = (HOUSE_RTP_NUM * CRASH_DRAWS) / (CRASH_DRAWS - u)
    if c > MAX_CRASH_MULT_X100 { MAX_CRASH_MULT_X100 } else { c }
}
```

This is the curve that was shipped. `crash-rtp.mjs` checks the deployed curve by
exhaustive enumeration: **every legal target returns 98.000% RTP**, and the worst
case over the whole range 1.05x–98.00x is **97.991% at 96.80x** — a 2.009% edge,
the residue of integer flooring at the top of the range and conservative for the
house. Dice mode is untouched and returns 98.000% at all 95 legal targets.

The change is additive to `src/outcome.fe`; `roll`/`commit_seed`/`max_payout` keep
their meaning, and the verifier picks up the new curve automatically because it is
compiled from the same source.

## Severity and disclosure

- **Not exploitable.** The player chooses the target and the curve is public and
  reproducible; nothing is hidden and no funds are at risk beyond the stated wager.
- **Material to the fairness claim.** A player selecting 50x pays a 50% edge while
  being told the edge is 2%.

The fix is deployed, so the README and UI may state the 2% edge — with the measured
worst case (97.991% at 96.80x) available for anyone who asks. `scripts/crash-rtp.mjs
--check` is the standing gate: it exits 0 while both curves honour the advertised
edge and non-zero the moment one does not, so this cannot silently regress. The
numbers earlier in this document remain the record of what was wrong.
