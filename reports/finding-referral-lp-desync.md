# Finding: LP-balance desynchronisation permanently locks a user's rewards and withdrawal

**Status:** source-verified (code paths read from the verified Sourcify bundle). Not yet
executed against a live deployment — the live proxy for this contract family has not been
located, see *Open items*.
**Class:** griefing / denial of service (no attacker profit).
**Severity:** Low–Medium (permanent for the victim; LP is still a standard ERC-20 that can
be exited on the DEX, so it is not absolute loss of funds).

## Target

`Referral` (Monkey King / `mking.fun`), source `default_workspace/Dapp/BBR/referral/Referral.sol`.

| address | role | note |
|---|---|---|
| `0x3C9a…` etc. | — | see `reports/role-resolution.json` for the live role table |
| `0xD38B1B9CE1BbC7caaA5435c1791b6E6d90fd81c9` | plain uninitialized implementation | deployed 2026-11-23 09:15 UTC by `0xe838da…a60e` |
| `0xDF6495294eB535C5679e4636a0cb350d16976663` | plain uninitialized implementation | |
| `0x3588af1ABa6A55a1cB52cc1BFb2DC4930a5cF480` | plain uninitialized implementation | |

## The defect

Two paths gate on a strict equality between the recorded LP amount and the live balance:

```solidity
// _pending
if (userLpAmount[user] != pair.balanceOf(user)) return 0;

// _removeLiquidity
if (userLpAmount[user] != pair.balanceOf(user) || userLpAmount[user] != lpAmount)
    revert LpAmountDifferent();
```

`userLpAmount[user]` is written in exactly two places:

```solidity
// buyPower — adds only the delta the router returned
userLpAmount[user] += lpReceived;      // lpReceived = pair.balanceOf(user) - lpBefore

// _removeLiquidity — the only reset, and it is unreachable once desynchronised
userLpAmount[user] = 0;
```

Nothing re-synchronises `userLpAmount` to the real balance. Therefore:

1. Attacker calls `pair.transfer(victim, 1)` (one wei of the LP token).
2. `pair.balanceOf(victim) == userLpAmount[victim] + 1`.
3. `pendingReward(victim)` returns `0` on every subsequent call.
4. `removeLiquidity()` reverts with `LpAmountDifferent` on every call.
5. `buyPower` does not heal it (delta add), and transferring LP away does not heal it
   (recorded value stays non-zero, live becomes 0 — still unequal).

Result: accrued rewards are lost and the protocol withdrawal path is permanently bricked
for that user. Cost to the attacker: 1 wei plus gas, repeatable against every participant.

## Why it is not higher severity

The LP token itself is a standard ERC-20 held in the victim's wallet; they can still remove
liquidity through the DEX directly or sell the LP. The damage is the lost reward stream and
the broken protocol path, not seizure of funds.

## Executable encoding

`src/findings.fe` models the predicate so the regression runs in Fe:

```
fe test --filter referral
```

`referral_pending(100, 100, 5, 42) == 42` but `referral_pending(100, 101, 5, 42) == 0`;
`referral_withdrawable(100, 101) == 0`.

## Demonstrated (state-override PoC)

`scripts/poc-referral-desync.mjs` executes the **deployed implementation bytecode** through
`eth_call` with a state override that injects a synthetic account's accounting and a stub
`pair` token. No transaction is sent and no live state is touched. Two independent providers
agree:

```
pair.balanceOf = 100 (recorded 100) -> pendingReward = 100
pair.balanceOf = 101 (recorded 100) -> pendingReward = 0   <-- one-wei desync
```

The only difference between the two calls is one wei of `pair.balanceOf`. That is the entire
griefing attack: an unsolicited `pair.transfer(victim, 1)` moves the victim from a claimable
balance to zero, and the mirrored equality in `_removeLiquidity` closes the withdrawal path
for the same reason.

```
node scripts/poc-referral-desync.mjs   # PASS on both providers
```

## Remediation

Replace the equality gate with a tolerance or a re-sync:

```solidity
function _syncLp(address user) internal {
    uint256 live = pair.balanceOf(user);
    if (live < userLpAmount[user]) userLpAmount[user] = live;   // never trust an external increase
    // or: gate claims on `userLpAmount[user] <= pair.balanceOf(user)`
}
```

or track eligible LP in an internal accounting unit that external transfers cannot move.

## Open items

- Locate the live proxy for this family (BscScan "proxy using this implementation", or the
  deployer `0xe838da…a60e`'s creations) and confirm `pair` / `token` are wired.
- PoC on an anvil fork: read `pendingReward(user)` for an account with `userPower > 0`, then
  move 1 wei of LP and read again. `eth_call` state overrides can also demonstrate it against
  the implementation without a live proxy, by overriding `userPower`, `userLpAmount`, `pair`
  and the pair's `balanceOf` mapping for one call.
