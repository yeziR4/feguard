# GangLaunchpad: independent deployment check

Published router governance and handler ownership observations; not the entire launchpad or an audit

Block **135283992**, 2026-11-23T14:05:54.000Z
Block hash: `0x34d4228df4303c9a966dd0f5c4ffefe48935b92b7fa568829dd2585aebc73ed1`

Results: 32 meets · 0 mismatch · 0 unknown · 2 unsupported · 0 conflict. A matching observation is not a security certification.

## Review queue

- **UNSUPPORTED — Runtime equivalence and actual immutable proxy admin**: Add verified runtime/deployment evidence or a complete role-membership reconstruction. Do not infer a security verdict from this unsupported check.
- **UNSUPPORTED — Exclusive role membership beyond the sampled addresses**: Add verified runtime/deployment evidence or a complete role-membership reconstruction. Do not infer a security verdict from this unsupported check.

## Evidence

| Check | Result | Observed | Policy condition |
| --- | --- | --- | --- |
| router: deployed runtime exists | meets | Yes | Yes |
| proxyAdmin: deployed runtime exists | meets | Yes | Yes |
| timelock: deployed runtime exists | meets | Yes | Yes |
| safe: deployed runtime exists | meets | Yes | Yes |
| handler: deployed runtime exists | meets | Yes | Yes |
| handlerAdmin: deployed runtime exists | meets | Yes | Yes |
| proxyAdmin: reported owner is timelock | meets | 0x3911996e2f6c5636d6b1b32f75cf94d0af4604c5 | 0x3911996e2f6c5636d6b1b32f75cf94d0af4604c5 |
| handler: reported owner is handlerAdmin | meets | 0xf56af7a7a004b9bb3515480a1409bc1dad8fe985 | 0xf56af7a7a004b9bb3515480a1409bc1dad8fe985 |
| handler: no unfinished ownership handoff | meets | 0x0 | No pending recipient |
| handlerAdmin: reported owner is safe | meets | 0x2866369f7acefc9760bde7779362fae5cd68b41e | 0x2866369f7acefc9760bde7779362fae5cd68b41e |
| handlerAdmin: no unfinished ownership handoff | meets | 0x0 | No pending recipient |
| Timelock: minimum delay is at least the documented 48 hours | meets | 172800 seconds | ≥ 172800 seconds |
| Router: ERC-1967 admin slot matches published ProxyAdmin (storage only) | meets | 0xddeab7a254e42d96d5863daef4e89bd426017bda | 0xddeab7a254e42d96d5863daef4e89bd426017bda |
| Router: implementation slot is nonzero (identity not certified) | meets | 0x385bab8c3040c6b41251897ac1d6622e61601c58 | Nonzero address |
| Timelock: safe has proposer role | meets | Yes | Yes |
| Timelock: deployer does not have proposer role | meets | No | No |
| Timelock: zero does not have proposer role | meets | No | No |
| Timelock: proposer role is administered by DEFAULT_ADMIN_ROLE | meets | DEFAULT_ADMIN_ROLE (zero) | DEFAULT_ADMIN_ROLE (zero) |
| Timelock: safe has executor role | meets | Yes | Yes |
| Timelock: deployer does not have executor role | meets | No | No |
| Timelock: zero does not have executor role | meets | No | No |
| Timelock: executor role is administered by DEFAULT_ADMIN_ROLE | meets | DEFAULT_ADMIN_ROLE (zero) | DEFAULT_ADMIN_ROLE (zero) |
| Timelock: safe has canceller role | meets | Yes | Yes |
| Timelock: deployer does not have canceller role | meets | No | No |
| Timelock: zero does not have canceller role | meets | No | No |
| Timelock: canceller role is administered by DEFAULT_ADMIN_ROLE | meets | DEFAULT_ADMIN_ROLE (zero) | DEFAULT_ADMIN_ROLE (zero) |
| Timelock: timelock has admin role | meets | Yes | Yes |
| Timelock: safe does not have admin role | meets | No | No |
| Timelock: deployer does not have admin role | meets | No | No |
| Timelock: proxyAdmin does not have admin role | meets | No | No |
| Timelock: zero does not have admin role | meets | No | No |
| Safe: reported threshold is within the reported owner count | meets | 2 | Threshold 1–3 |
| Runtime equivalence and actual immutable proxy admin | unsupported | Unsupported | Verified evidence |
| Exclusive role membership beyond the sampled addresses | unsupported | Unsupported | Verified evidence |

## Limits

- ABI observations do not authenticate runtime behavior. Runtime equivalence to the pinned source is not verified.
- The ERC-1967 admin slot is checked as a storage observation. OpenZeppelin 5 uses an immutable actual admin; the active upgrade authority is not established by this slot.
- Known Safe, deployer, zero-address and ProxyAdmin role memberships are sampled. Other role holders are not enumerated; exclusivity is not established.
- A valid Safe threshold only establishes a numeric bound. Signer independence, modules, guards and recovery mechanisms are outside scope.
- The initially published implementation is not treated as immutable policy: legitimate upgrades may have occurred.
- Public RPC agreement is corroboration, not a verified state proof; provider independence is not established. No pending-operation or application-logic analysis.

## Sources

- https://github.com/gangfun/gang-launchpad/blob/4e3433076c0eac1cffa20b76e8e05bea6b17238d/docs/MAINNET-GANG-2026-10-27.md
- https://github.com/gangfun/gang-launchpad/blob/4e3433076c0eac1cffa20b76e8e05bea6b17238d/script/GangRouterDeployLib.sol
- https://github.com/gangfun/gang-launchpad/blob/4e3433076c0eac1cffa20b76e8e05bea6b17238d/README.md

Independent public-data assessment. No affiliation, customer relationship, team contact, transaction signing or submission.
