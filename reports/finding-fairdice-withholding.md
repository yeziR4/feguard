# Finding: FairDice commit–reveal is not incentive-compatible (selective abort)

**Status:** design-level defect in our own reference implementation (`src/dice.fe`).
Not a bug in third-party code. Reported against ourselves because the project's
thesis is evidence-gated, and this is what the evidence says.

**Severity:** High *for the fairness claim*. The contract does what it says
mechanically; the property it advertises ("provably fair") does not hold.

---

## The claim under test

`dice.fe` documents I5:

> Two-party commit–reveal: both `client_commitment` and `server_commitment` are
> locked at bet time, so neither player nor house knows or can grind the outcome
> after betting.

That is **true as written** — and it does not matter. The outcome cannot be
*changed*; it can be *declined*. The attack is not grinding, it is withholding.

## The mechanism

Settlement requires **both** preimages:

```fe
if commit_seed(client_seed) != bet.client_commitment { revert SeedMismatch }
if commit_seed(server_seed) != bet.server_commitment { revert SeedMismatch }
let outcome = roll(server_seed, client_seed, bet_id)
```

Only the house knows `server_seed`. Therefore **the house alone decides whether a
bet ever settles.** `refundExpired` (after `REFUND_DELAY_BLOCKS = 256`) returns the
wager, with no further consequence.

The house's optimal strategy is therefore:

| actual outcome | house action | house pays | player receives |
|---|---|---|---|
| player loses | `reveal` | nothing | nothing |
| player wins | do nothing | nothing | wager refunded, 256 blocks later |

The player's expected value is strictly negative, and the house is **never
exposed**. Payout escrow is irrelevant: withholding means the escrow is never
touched.

## Why a penalty does not fix it

Two candidate repairs, both broken because **either party can trigger expiry**
(`refundExpired` is permissionless, and either party can withhold the preimage
that settlement needs):

1. **Expiry pays `wager + penalty`** where `penalty < max_payout`.
   The house still prefers silence: paying a small penalty is cheaper than paying a
   win of up to `98 × wager`. No improvement.

2. **Expiry pays `max_payout(wager, target)`** (i.e. the maximum the player could
   have won). Now the **player** withholds their own `client_seed`, lets 256 blocks
   pass, calls `refundExpired`, and collects a guaranteed maximum payout. Strictly
   profitable, repeatable. Now the house can never win.

There is no value for the expiry payout that is correct for both withholding
parties, because the same deadline is reachable by either side and neither side's
omission is distinguishable from the other's.

**Conclusion: the flaw is structural, not a missing constant.**

## The fix: randomness that no party can withhold

Remove the secret server seed. Draw the house's contribution from a source that
is protocol-bound once requested, so that *either* the value arrives *or* the
provider is visibly at fault — not a party quietly choosing.

Concretely, on Base this is **Pyth Entropy** (`0x6e7d74fa7d5c90fef9f0512987605a6d546181bb`,
verified implementation `EntropyUpgradable`), which this project already analysed
in `reports/`:

- `placeBet` requests entropy; the returned value is published on-chain.
- `outcome = roll(entropy_value, bet_id, client_commitment)`.
- Neither the player nor the house can decline the value once revealed, and
  withholding is attributable to the *provider*, whose failure flow is explicit.

**`roll` stays in Fe and stays shared**, so the verifier is unchanged in kind: it
recomputes from the on-chain entropy value rather than from a house-supplied seed.
The single-source EVM+WASM property is preserved.

**Open question (must be verified before implementing):** whether Fe 26.7.0 can
make an external call that *returns* data (requesting entropy). `call.send_value`
is confirmed; a generic value-returning call/effect has not been probed. If it
cannot, the honest fallback is to keep the reference design and **narrow the
claim** — see below.

## What we must not claim until this is fixed

> ~~provably fair~~

Say instead:

> The outcome function is independently verifiable: the same Fe source that settled
> the bet recomputes it off-chain. Whether a bet *settles at all* is not yet
> enforced, which is exactly the gap the observer below exists to surface.

## The observer

`scripts/watch-abandoned-bets.mjs` flags bets where
`!settled && blockNumber + REFUND_DELAY_BLOCKS <= head`. Each such bet is direct
on-chain evidence that someone withheld a preimage to avoid an outcome — the
condition a verifier alone can never detect, because there is no outcome to check.

This is the project's own thesis applied to the project: **a verifier proves a
result is real; only an observer proves a result was ever produced.**
