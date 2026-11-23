# Finding: `totalPower` is never decremented, permanently diluting rewards

**Status:** source-verified **and demonstrated** by executing the deployed `release()` on a BSC
fork.
**Class:** accounting / loss of funds (reward tokens stranded); no attacker profit directly,
but a buy→remove loop inflates the denominator without bound.
**Severity:** Medium.

## Target

`Referral` (Monkey King / `mking.fun`), source `default_workspace/Dapp/BBR/referral/Referral.sol`,
implementation `0xd38B1B9CE1BbC7caaA5435c1791b6E6d90fd81c9`.

## The defect

`totalPower` is the denominator of the per-share release:

```solidity
// _release
uint256 allocated = dailyTotalReward[yesterday] * ACC_PRECISION / totalPower;
accRewardPerShare[yesterday] = accRewardPerShare[lastReleaseDay] + allocated;
```

It is increased in two places and **never decreased**:

```solidity
// initReferrer
totalPower += 1;
// buyPower
totalPower += power;
// _removeLiquidity
userLpAmount[user] = 0;
userPower[user] = 0;      // totalPower is NOT reduced by the removed power
```

After any removal, `totalPower` overstates the power that can actually claim. Every subsequent
`_release` spreads `dailyTotalReward` across an inflated denominator, so the tokens that the
missing power would have claimed are never allocated to anyone. The imbalance is permanent and
compounds: a buy → remove loop keeps raising `totalPower` while real claimable power does not,
driving per-share allocation toward zero.

## Demonstrated

Executed against a BSC fork with the deployed implementation:

```
anvil --fork-url https://bsc-mainnet.public.blastapi.io --chain-id 56
# impersonate a caller, mark it authorized, then for each case set:
#   slot 121 totalPower, slot 122 lastReleaseDay = D-1,
#   keccak(D,119) dailyTotalReward[D] = 1000e18, keccak(D,120) acc[D] = 0
# and send release():
#   cast send 0xd38B... "release()" --from 0x...BEEF --unlocked
```

Measured, with `dailyTotalReward[D] = 1000e18`:

| totalPower | `accRewardPerShare[D]` | a 100-power holder claims | stranded |
|---|---|---|---|
| **200** (two holders, one removed) | `5e36` | `500e18` | **`500e18`** |
| **100** (true remaining power) | `1e37` | `1000e18` | 0 |

The only difference is the stale denominator. Half of the day's reward is permanently
unallocated in the buggy state, exactly as `src/findings.fe`
(`removal_inflates_total_power_and_strands_half_the_pool`) encodes.

## Remediation

Decrement on removal and keep the invariant `totalPower == Σ userPower`:

```solidity
function _removeLiquidity(address user, uint256 lpAmount) internal {
    ...
    uint256 power = userPower[user];
    if (power > 0) totalPower -= power;
    userLpAmount[user] = 0;
    userPower[user] = 0;
    ...
}
```

Add an invariant test asserting `totalPower` equals the sum of active `userPower` after every
action.

## Open items

- Confirm on the live proxy that removals have occurred and quantify stranded tokens.
- The same "recorded vs live" family of bugs appears in the LP-desync finding; both stem from
  state that is incremented but never reconciled.
