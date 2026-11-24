# FairDice — Base Sepolia Deployment & Live Verification (Task A)

> **Honesty / Status Notice:** This deployment exercises the commit–reveal reference implementation (`src/dice.fe`) live on Base Sepolia (`chainId 84532`). As documented in `reports/finding-fairdice-withholding.md`, the outcome is independently verifiable from the exact same Fe source (`src/outcome.fe` -> EVM + WASM), **but whether a bet settles at all is not yet enforced** in the commit–reveal variant — which is why Bet #2 below was deliberately left unrevealed to test `scripts/watch-abandoned-bets.mjs` live. Not audited; not production-ready.

## Network & Deployed Contract

| Field | Value |
| --- | --- |
| Network | Base Sepolia (`chainId 84532`) |
| RPC | `https://sepolia.base.org` |
| Compiler | `fe 26.7.0 (e6e6342)` (`--backend sonatina -O 1` / `--backend wasm`) |
| Deployer (burner) | `0x52Ed5E00bB32786D5c498e390B12DBd0172D0d15` |
| Contract (`FairDice`) | `0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b` |
| Deploy tx | `0xa09faa10d78d01bc1eae547e808a1ca93e3dc8970d4c5e583374be9313c3a4ac` (block `63018025` / `0x3c19429`) |
| Constructor args | `cap = 1000000000000000` wei (`0.001 ETH`), `initial_server_commitment = 0x14d8edf59db15309b09abfa2969f074885fcf5e05fd221b3cf4c910cccc34297` (`keccak256(uint256(0x1111222233334444))`) |
| Runtime code size | `11644` hex chars (`5821` bytes) |

## Live Transactions

| Step | Action | Tx Hash | Notes |
| --- | --- | --- | --- |
| 1 | Deploy `FairDice` | `0xa09faa10d78d01bc1eae547e808a1ca93e3dc8970d4c5e583374be9313c3a4ac` | `totalBets() == 0` confirmed |
| 2 | `fund()` (`0.005 ether`) | `0xa0d4c7842c272ba40b5f02a838474263a37473ee862f57e4aefbaba58a82e199` | Funded `0.005 ETH` (preserving balance on the `0.01175 ETH` burner for bets + Task B); `bankroll() == 5000000000000000` |
| 3 | `placeBet(26, c1Commit)` (`0.0001 ether`) | `0x09fbcf65ee65ec42859d29b761bcd347d07a88ce61cb541b74c8d47a1ba06e52` | Bet #1, `client_seed = 0x5555666677778888`, `c1Commit = 0x9ef60505bf0a8b206036c43400b5dc8b6c964d09e1d61b1a311a7954fd700568` |
| 4 | `placeBet(49, c2Commit)` (`0.0001 ether`) | `0x942530bae516b542e6212f321c7c793c3650ca459b21039f8646adb825c06af1` | Bet #2 (placed block `63018221`), `client_seed = 0x9999aaaabbbbcccc`, `c2Commit = 0x95a23e2fc01e9367ce534791107f468e8ee7a1a9bee8261459a6d0ebdc15d317` — **deliberately left unrevealed** |
| 5 | `reveal(1, serverSeed, c1Seed)` | `0x5c42a54fdead36ebb180727bc5e05a00aaf49d8732cc95b3ea490738844e2291` | Outcome `25 < 26` (WIN); paid `376923076923076` wei; `bankroll() == 4823076923076924` |

## Live Tooling Findings & Results

### 1. Live RPC bug caught & fixed in `verify.mjs`
The first live run of `verify.mjs` against `https://sepolia.base.org` failed with `RPC HTTP 413` (`eth_getLogs is limited to a 200 range`). Fixed `verify.mjs` to start log scanning from `bet.blockNumber` (already stored on-chain in `getBet(betId)`) and paginate in 200-block chunks up to head.

### 2. Reproducible live verification commands

```cmd
:: Verify Bet #1 against live Base Sepolia state + BetRevealed log using Fe-compiled WASM
node verify.mjs --rpc https://sepolia.base.org --contract 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b --bet-id 1
:: Output: Verdict: MATCH | Claimed outcome: 25 | Recomputed outcome: 25 (OK) | Claimed payout: 376923076923076 wei (OK) | Commitments valid: YES (exit 0)

:: Deliberately tamper with serverSeed (^ 1) against the same live bet
node verify.mjs --rpc https://sepolia.base.org --contract 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b --bet-id 1 --tamper
:: Output: Verdict: MISMATCH | Recomputed outcome: 26 (DIFFERS) | Claimed payout: 376923076923076 wei (DIFFERS) | Commitments valid: NO (exit 1)

:: Observer with default 256-block delay (immediately after placing Bet #2, age < 256)
node scripts/watch-abandoned-bets.mjs --contract 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b --rpc https://sepolia.base.org
:: Output: settled 1, pending (in time) 1 (exit 0)

:: Observer with --delay 2 to test flagging of deliberately unrevealed Bet #2 without waiting 256 blocks
node scripts/watch-abandoned-bets.mjs --contract 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b --rpc https://sepolia.base.org --delay 2
:: Output: ABANDONED BETS: 1 -> bet 2 placed block 63018221 age 142 (deadline 2) (exit 1)
```

> Note: The observer truthfully reports that Bet #2 passed the deadline without settling; from on-chain state alone it cannot distinguish which party withheld their preimage.

---

## Task B — Pyth Entropy V2 Deployment & Live Callback Verification

Replacing the secret server seed with Pyth Entropy V2 eliminates selective-abort withholding by either party: `placeBet` pays `getFeeV2()` and invokes `requestV2()`, and Pyth's keeper fulfills randomness via `_entropyCallback(uint64,address,bytes32)`. `src/outcome.fe` (`roll` / `compute_payout`) is **unchanged** and still compiles verbatim to both EVM and WASM.

### On-Chain Verification of Pyth Entropy V2 (Base Sepolia)

- **Proxy:** `0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c` (`code len = 1418` hex chars)
- **UUPS check:** `cast call 0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c "proxiableUUID()(bytes32)" --rpc-url https://sepolia.base.org` reverted with `"UUPSUpgradeable: must not be called through delegatecall"` (confirmed UUPS proxy).
- **EIP-1967 implementation:** `0x8dedb2608d758eed1321b629e3737c95ad3cb733`
- **Live bytecode selector check:** `_entropyCallback(uint64,address,bytes32)` (`0x52a5f1f8`) = **present**; `entropyCallback(uint64,address,bytes32)` (`0x24185135`) = absent; `requestV2()` (`0x7b43155d`) = **present**; `getFeeV2()` (`0x8204b67a`) = **present** (returned `15000000000001` wei).

### Deployed Contract & Live Transactions

| Field | Value |
| --- | --- |
| Contract (`FairDice` + Pyth Entropy V2) | `0xd48ed9b0ad9660dd1c21964aab5468081968c774` |
| Constructor args | `cap = 1000000000000000` wei (`0.001 ETH`), `entropy_addr = 0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c` |
| Deploy tx | `0xbe54098598a9d4dcdc4a56fd384479fa45c2218fe6100080a6245961fa5d2d2a` |
| `fund()` tx (`0.003 ETH`) | `0x896a2d71be71e7808dfd17d63e425b0abd682afdec43cec69346ed2b9635e3c1` |
| `placeBet(49, clientCommit)` tx | `0xeb1dbb0e178d31c46d7b487ac5eccc16a704d2c011e1347341067efa428ff130` (block `63021194`, `value = 115000000000001` wei = `100000000000000` wager + `15000000000001` Entropy fee, `sequence_number = 113865` / `0x1bcc9`) |
| Pyth keeper `_entropyCallback` fulfillment tx | `0xb5bab940a80e54e36f1a6823406d079e3f2457f381e6195a8e3230360a400ac7` (block `63021204`, 10 blocks later; `randomNumber = 0x1e3cf5c8e560adc6f7bd9f27357ffefadb4157e06f8b6f845f736e059daa8b3c`, `outcome = 74`, `payout = 0 wei`) |

### Reproducible Live Verification Commands (Task B)

```cmd
:: Verify Pyth-settled Bet #1 using Fe-compiled WASM (`out/feguard.wasm`)
node verify.mjs --rpc https://sepolia.base.org --contract 0xd48ed9b0ad9660dd1c21964aab5468081968c774 --bet-id 1
:: Output: Verdict: MATCH | Claimed outcome: 74 | Recomputed outcome: 74 (OK) | Claimed payout: 0 wei (OK) (exit 0)

:: Deliberately tamper with the on-chain entropy value (^ 1)
node verify.mjs --rpc https://sepolia.base.org --contract 0xd48ed9b0ad9660dd1c21964aab5468081968c774 --bet-id 1 --tamper
:: Output: Verdict: MISMATCH | Recomputed outcome: 99 (DIFFERS) (exit 1)

:: Confirm watcher reports 0 abandoned bets (Bet #1 settled automatically by Pyth keeper)
node scripts/watch-abandoned-bets.mjs --contract 0xd48ed9b0ad9660dd1c21964aab5468081968c774 --rpc https://sepolia.base.org
:: Output: settled 1, pending (in time) 0 (exit 0)
```

---

## Live evidence — Closing the remaining untested paths

### 1. Live WINNING payout inside `_entropyCallback` (`0xd48ed9b0ad9660dd1c21964aab5468081968c774`)

Exercises the `payout > 0` `call.send_value(...)` branch inside `_entropyCallback` on Base Sepolia:

- **Bet #2 `placeBet(95, clientCommit)` tx:** `0x469cc0fa884bc3743527b404d72c2dcb8dc7bbdecc9f739476195f2b060d4296` (block `63027591`, `value = 115000000000001` wei = `100000000000000` wager + `15000000000001` Entropy V2 fee; `clientSeed = 0x...cafe000000000002`, `clientCommit = 0x5833d3efef98dbf3b2d7f042391407718a2b9dc1a47375ded677d612736e604a`)
- **Pyth keeper `_entropyCallback` tx:** `0x67cf64e9758ff50875d897e6cf7f6def998647dba3838ee68da05e26a894ecdb` (block `63027602`, 11 blocks later)
- **Decoded `BetSettled` event:**
  - `bet_id` (`topic1`): `2`
  - `sequence_number` (`topic2`): `113880` (`0x1bcd8`)
  - `entropy_value`: `0xb08685992eae1986f717269a4987657b0ebd48df396685e1eebfba7d8be4fde5`
  - `client_commitment`: `0x5833d3efef98dbf3b2d7f042391407718a2b9dc1a47375ded677d612736e604a`
  - `outcome`: `89` (`0x59`, `< 95` -> WIN)
  - `payout`: `103157894736842` wei (`0x5dd251abebca` = `floor(100000000000000 * 98 / 95)`)
- **On-chain player balance proof (across callback block):**
  - Block `63027601` (before callback): `3675635570470357` wei
  - Block `63027602` (after callback):  `3778793465207199` wei
  - Exact delta: **`+103157894736842` wei == `payout`**
- **Reproducible verification commands:**
  ```cmd
  node verify.mjs --rpc https://sepolia.base.org --contract 0xd48ed9b0ad9660dd1c21964aab5468081968c774 --bet-id 2
  :: Verdict: MATCH | Claimed outcome: 89 | Recomputed outcome: 89 (OK) | Claimed payout: 103157894736842 wei (OK) (exit 0)

  node verify.mjs --rpc https://sepolia.base.org --contract 0xd48ed9b0ad9660dd1c21964aab5468081968c774 --bet-id 2 --tamper
  :: Verdict: MISMATCH | Recomputed outcome: 48 (DIFFERS) (exit 1)
  ```

### 2. Live POSITIVE `refundExpired` + NEGATIVE `NotExpired` revert (`0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b`)

Exercises the anti-stranding refund path on previously abandoned Bet #2 (placed at block `63018221`, refunded at block `63028018`, age `9797 >= 256` blocks):

- **`refundExpired(2)` tx:** `0xf09e098957422672858701649c1c3ace133d69a00473222b325ec62026e66240` (block `63028018`, `status = 0x1`)
- **Decoded `BetRefunded` event:**
  - `topic0`: `0xf22517a5eae9f54be712c3150eca5ba925d233687b223c2ebf89272f12ee0865`
  - `bet_id` (`topic1`): `2`
  - `player` (`topic2`): `0x52ed5e00bb32786d5c498e390b12dbd0172d0d15`
  - `wager`: `100000000000000` wei (`0x5af3107a4000`)
- **State & balance proof:**
  - Contract `bankroll()` decreased by exact `-100000000000000` wei (`4823076923076924 -> 4723076923076924`)
  - Player balance increased by `+99445917999246` wei net of `554082000754` wei gas (`3778793465207199 -> 3878239383206445`)
  - `getBet(2).settled == true`, `payout == 100000000000000`
- **Observer confirmation after refund:**
  ```cmd
  node scripts/watch-abandoned-bets.mjs --contract 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b --rpc https://sepolia.base.org
  :: settled 2, pending (in time) 0, empty slots 0 -> No abandoned bets (exit 0)
  ```
- **Negative pre-expiry guard confirmed live on fresh Bet #3:**
  - Bet #3 `placeBet(49, c3Commit)` tx: `0xaa826ab2988c4875c1ced81a96522dba9108d395b4bfb05bf8c4de44bcba9bc7` (block `63028072`, `10000000000000` wei)
  - Immediate `cast call 0xed5d38e135d7e63ebc6f7dc6ef8d9e2f21ce326b "refundExpired(uint256)" 3 --rpc-url https://sepolia.base.org` reverted with `0x7e61955c0000000000000000000000000000000000000000000000000000000000000003` (`NotExpired(3)`).


