# Deployment checks: from evidence to a review task

FeGuard can inspect a prospect using public information, without contacting its team. It reads a reviewed policy file and public RPC responses, evaluates the supported rules in **Fe**, and produces a review queue plus the evidence behind it. It never signs or submits transactions.

This is an independent prototype, with no customer relationship or endorsement from GangLaunchpad. Their deploy scripts already perform extensive checks. The added workflow is repeatable independent observation, explicit coverage gaps, and snapshot comparison after deployment.

## First real snapshot

The [GangLaunchpad report](../reports/gang-router.md) records BNB Chain block **135283992**, **2026-11-23 14:05:54 UTC**. Two public RPC origins agreed on the pinned block and the measured values:

- **32 matching observations**, including a reported minimum delay of **172800 seconds (48 hours)**, ProxyAdmin's reported owner, the documented handler → handler-admin → Safe ownership chain, and sampled timelock roles.
- **0 policy mismatches**, **0 unreadable checks**, **0 provider conflicts**.
- **2 unsupported checks**: source/runtime equivalence including the actual immutable proxy admin, and exclusive role membership beyond sampled accounts.

This gives no evidence-backed reason to tell this team to change a contract. The unsupported items are verification work for the checker/reviewer, not discovered project defects. Matching getters and slots do not certify runtime behavior, application logic or economic safety.

The versioned [policy file](../policies/gang-router.json) links the exact public documentation and source commit used. It accounts for the documented October 28 handler-admin migration. It does not compare today's implementation with the initial implementation as if upgrades were forbidden.

## Run and refresh

Requirements: Node 20+ and HTTPS access to two public BNB RPC origins. The committed Fe WASM module removes any need to install Fe just to run the checker. No npm packages, wallet, paid API, team credentials or LLM service are used.

From the repository root:

```sh
node scripts/inspect.mjs
# Writes reports/gang-router.json and reports/gang-router.md

node scripts/inspect.mjs --replay reports/gang-router.json
# Offline: re-evaluates the saved observations in Fe

node scripts/inspect.mjs --previous reports/gang-router.json \
  --out reports/gang-router-next
# A new snapshot plus changed observations; preserves the earlier report

python -m http.server 8766 --bind 127.0.0.1
# Open http://127.0.0.1:8766/inspection/
```

The browser displays the committed snapshot, not a continuously live scan. It verifies the WASM manifest digest and replays all assessments in Fe before showing them. Refresh with the CLI. CLI snapshot comparison is local history; it neither schedules future runs nor stores sensitive agent conversations.

You can select a historical height with `--block 135283992`. Explicit heights are not automatically certified finalized. Without that option, the tool asks each provider for its finalized block, chooses the lower height, checks both providers' hashes there, pins every state read to it, and rechecks the hash after collection. It aborts on chain/block disagreement. There is no silent fallback to `latest`.

To replace the default endpoints, repeat `--rpc https://public-origin.example`. Endpoints must be distinct public HTTPS origins without paths, credentials or query parameters. The current adapter deliberately does not support credential-bearing RPC URLs. Endpoint origins and raw public requests/responses appear in reports.

Exit codes: `0` means collection completed without a measured mismatch/conflict; **unsupported or unreadable checks can still exist**. `2` means at least one measured mismatch/conflict. `1` means an error prevented a report. Use the per-check results and coverage gaps; do not interpret the process exit code as a security pass.

## How recommendations are made

The policy file is an explicit input, assembled from cited documentation; the prototype does not infer a trustworthy specification from arbitrary prose or automatically support every contract.

| Evidence | Fe assessment | Review task |
| --- | --- | --- |
| Measured delay below the policy minimum | Mismatch | Review whether policy is current; prepare an authorized governance update if appropriate |
| Old owner remains, documented recipient is pending | Mismatch | Confirm the handoff; recipient acceptance is needed to complete a two-step transfer |
| Unexpected recipient is pending | Mismatch | Review the recipient before accepting/cancelling |
| A documented required role is missing | Mismatch | Review the role and its administrator before a governance change |
| Providers disagree at the same block | Conflict | Resolve the evidence disagreement; no contract change recommended |
| Read reverts, is malformed, or lacks corroboration | Unknown | Obtain evidence or fix the adapter/address; do not treat missing data as zero |
| Actual immutable admin or exhaustive role inventory is unverified | Unsupported | Add the required verification capability |

Synthetic short-delay and unfinished-transfer fixtures are tested separately. **Those are not findings against GangLaunchpad.**

## Division of work

- `src/deployment_policy.fe`: full-width `u256` policy comparisons, evidence-state handling, assessment and action-code selection. Tested on both Fe backends. A scalar WASM export preserves all 256 bits.
- `scripts/inspection-lib.mjs`: bounded read-only RPC acquisition, strict ABI decoding, provider reconciliation, block pinning, evidence capture and report rendering.
- `inspection/policy.mjs`: ABI marshalling, human-readable explanations of Fe action codes, summaries and snapshot differences.
- `policies/gang-router.json`: documented expected addresses, ownership edges, minimum delay and limitations.
- `scripts/inspection.test.mjs`: offline replay from captured public responses plus synthetic negative/failure cases. CI makes no live RPC requests.

RPC methods are restricted to `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getStorageAt` and `eth_call`. No send/sign methods are accepted. ABI selectors/role IDs are canonical values checked with Foundry `cast sig`/`cast keccak`. Runtime bytes are retained in raw evidence; the local SHA256 digest is an artifact-integrity digest, not an Ethereum code hash or a state proof.

## Adding another prospect

First verify its official addresses and documented governance promise, then create a separate policy file with pinned source links. This adapter covers an OpenZeppelin-style timelock, known role samples, explicit Ownable/Ownable2Step edges and Safe getters. Review the actual interfaces before selecting it. Unsupported/custom authority paths require another adapter or must remain unsupported.

CoinGecko can supply discovery leads and official links. A new listing does not establish deployment freshness, governance policy or a defect. The current checker does not scrape CoinGecko or send outreach. A measured discrepancy, reproducible evidence and a specific project need are prerequisites to calling a prospect qualified; the project being listed alone is insufficient.

## Verification

```sh
fe fmt --check
fe check
fe test
fe build
fe test --backend wasm
fe build --backend wasm --out-dir demo/engine
node --test scripts/inspection.test.mjs
node scripts/inspect.mjs --replay reports/gang-router.json
```

Replay demonstrates deterministic assessment of the recorded inputs. It does not establish RPC authenticity, state-proof validity or current freshness. Both RPC origins are public; their operational independence has not been established. See the report for the complete coverage boundary.
