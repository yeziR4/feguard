# Public cohort research

FeGuard now has a bounded discovery → runtime corroboration → Fe triage → source-reviewed follow-up workflow. The workbench is at `/inspection/cohort.html`. It displays saved, reproducible research rather than implying a continuously running service.

## Observed results, 23 November 2026

The [batch report](../reports/cohort.json) covers **300 unique BNB Chain contract addresses**, across two consecutive newest-first Sourcify verification pages. There are **206 distinct contract names**; names and addresses are not independent project counts.

At finalized block **135288293** (14:38:09 UTC):

- Runtime bytes from both public RPC origins matched Sourcify's recorded runtime for **300/300** addresses.
- **153** addresses received supported getter checks, yielding **196 observations**. **147** received runtime-only coverage; their application logic was not assessed.
- Generic pending-owner/initialized-getter/delay checks produced **zero review leads**. **12 zero-owner observations** were retained as context, not defects.
- Source review of those context observations led to five targeted initialization follow-ups.

At a separate fresh finalized block **135288422** (14:39:08 UTC), **five addresses across two contract families** had a source-reviewed initialized field of zero and accepted read-only initializer simulations from an arbitrary caller. Both RPC providers returned success; runtime hashes and reviewed source/storage-layout evidence matched the explicit plan.

These are **validated initialization review leads**, not confirmed financial-impact vulnerabilities. A separately initializable logic implementation does not by itself compromise proxy storage. Live deployment roles, proxy relationships for these five addresses, and asset exposure remain unverified. **Confirmed impact findings: 0. Full audits performed: 0.**

See [follow-up evidence](../reports/initialization-review.json) and the explicit [review plan](../policies/initialization-review.json). Do not collapse the batch and follow-up block timestamps into one snapshot.

| Family | Addresses | Confirmed behavior | Still needed |
| --- | ---: | --- | --- |
| Referral | 3 | Public initializer accepts a simulated call; reviewed source assigns ownership from an argument; initialized storage is zero | Establish deployment role and impact; review whether implementation initialization should be locked |
| QuickMiney | 2 | `initilize` (spelled this way in the ABI) accepts a simulated call; reviewed source assigns caller/argument-based authority; initialized storage is zero | Establish deployment role and impact; review initialization hardening for future implementations |

The distinction mattered: MailChatRedPacket and OrbitV8PlatformControl also returned a zero owner at their implementation addresses, but reviewed constructors disable initialization. Their observed proxies returned nonzero owners. A zero-owner alarm would have overstated the evidence.

## Reproduce

Node 20+ suffices for the committed WASM module. No npm packages or wallet are required.

```sh
# Offline: replays the 300-contract raw evidence and tests failure cases
node --test scripts/cohort.test.mjs

# New bounded public feed sample and fresh pinned RPC reads
node scripts/cohort.mjs --limit 100

# Source-gated read-only follow-up for the five explicit targets
node scripts/review-initializers.mjs

# Serve the snapshot UI
python -m http.server 8766 --bind 127.0.0.1
# http://127.0.0.1:8766/inspection/cohort.html
```

`cohort.mjs` writes `reports/cohort.json`, `reports/cohort.md` and compressed raw evidence `reports/cohort-evidence.json.gz`. The report records the compressed evidence's SHA256; the test verifies the digest before replay. The UI replays Fe triage from saved inputs, while the offline test additionally reconstructs the batch from captured RPC responses.

The generic screening rules do not establish project-specific policy. The source follow-up requires an explicit reviewed source hash, storage location and simulation plan. It verifies those gates before attempting `eth_call`; no send/sign RPC method is accepted. `eth_call` can simulate a non-view initializer but never persists those changes.

## Extend or repeat a sample

```sh
# Preserve earlier files by choosing a different output prefix.
node scripts/cohort.mjs --limit 200 \
  --seed reports/cohort-evidence.json.gz \
  --previous reports/cohort.json \
  --cache out/older-page \
  --out reports/cohort-next
```

The seed's last match ID supplies the next newest-first pagination cursor. Seed metadata is reused and the combined set is reread at a new finalized block. `--refresh-seed` with `--seed` rereads only the saved population without fetching an older page. `--after MATCH_ID` selects an explicit cursor; `--cached` uses a previously saved discovery page and detail cache. The API request limit is 200 per page and the seed is capped at 1,000 entries. No unbounded scan is started.

Incident memory deduplicates generic review leads across runs, retaining first/last seen and occurrence count. A signal clears only when the same contract/rule is successfully reread without it. Missing the contract in a later sample, RPC failure, or failed runtime qualification cannot clear it. Source-specific follow-up reports are separate snapshots; their incident-history integration is not implemented.

No future scheduler, hosted worker, outreach or alert delivery has been configured. Running these commands executes a batch. A future service can invoke them on a schedule while retaining versioned artifacts and health checks.

## Data and trust boundary

Discovery uses [Sourcify's published API](https://github.com/argotorg/sourcify/blob/staging/services/server/src/apiv2.yaml): newest-first verification listing, then only requested ABI, deployment metadata, compilation identity, runtime and function signatures. Broad loops do not request all source files or compiler inputs. Source files/storage layouts are requested only for the small follow-up shortlist; full source responses stay outside the public package, with source hashes and URLs retained in the reviewed plan/evidence.

Verification time can be later than deployment time. Metadata dates can change when a match improves. Neither verification nor source availability establishes legitimacy, project affiliation, economic safety or demand for a service. Source text is treated as evidence, never as execution instructions.

The checker uses two public BNB RPC origins listed in [BNB's documentation](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/). It verifies chain IDs, selects a common finalized height, checks block hashes before/after collection, and pins every read to that height. Public RPC agreement is not a cryptographic state proof or proof of provider independence. Public nodes can prune state rapidly; a historical rerun may fail even while its saved evidence remains replayable. No silent unpinned `latest` fallback is used.

Proxy implementation-slot reads are labeled observations. Matching a slot and an implementation ABI does not authenticate arbitrary delegation behavior or the actual immutable OpenZeppelin transparent-proxy admin.

## Fe contribution

`src/cohort.fe` distinguishes review leads, owner context, unsupported rules and unknown evidence. The source-reviewed initialization rule requires runtime, reviewed source, storage-state and simulation evidence together; it never assigns confirmed impact. The same code is tested on EVM and WASM and runs in the Node worker and browser. JavaScript handles acquisition, strict decoding, evidence reconciliation, pagination, persistence and rendering.

All findings/review leads in this package are independent public-data research. No teams were contacted, no customer relationship is asserted, and no on-chain transaction was signed or sent.
