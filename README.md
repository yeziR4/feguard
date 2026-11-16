# FeGuard

**Spending policies and bounded episodic memory for automated wallets, written in Fe.**

FeGuard separates an agent's recollection of earlier actions from its present permission to act. An old record marked "allowed" cannot grant permission today, and evicting an old record cannot replenish a budget.

This is a Fe Builders Challenge prototype. The demonstration contract records authorizations; it does not hold or transfer funds and is not a complete wallet integration.

## Reproduce

Use **Fe 26.6.0**, verified locally as `fe 26.6.0 (5b3f96a)`. Install from the [official release](https://github.com/argotorg/fe/releases/tag/v26.6.0) or follow the [installation guide](https://fe-lang.org/getting-started/installation/).

From this directory:

```sh
fe --version
fe check
fe test
fe build
```

No API keys, model provider, blockchain account, remote RPC, real funds, or mainnet deployment are required. Tests run in Fe's local EVM sandbox. The compiled ABI and bytecode appear under `out/`.

## Reproducible demo

```sh
fe test --filter contract_remembers_both_allowed_and_rejected_delegate_requests
fe test --filter contract_eviction_does_not_restore_spending_budget
```

The first demonstration deploys a guard with a 150-wei session budget and a 100-wei transfer limit. It records an allowed 100-wei request, then a rejected 60-wei request. Recall returns the rejection and its evidence hash; the budget remains 50 wei.

The second makes ten 1-wei requests. Only the latest eight episodes remain available, while the spending budget is still reduced by all ten requests. Eviction is explicitly detectable.

## Architecture

- `SpendPolicy` specifies one delegate, one recipient, a per-transfer maximum, an exclusive expiry, and revocation.
- `Budget` tracks the remaining total session allowance. It does not automatically reset.
- `preview` reads the policy and budget without consuming allowance.
- `authorize` deducts allowance only after all checks pass.
- `AgentMemory` retains eight structured episodes in a ring. Each stores a monotonic sequence, caller, recipient, amount, observation time, decision code, and optional evidence hash.
- `recall` returns `None` for missing or overwritten sequences. The ABI adapter represents absence with `sequence == 0`.
- `GuardDemo` persists policy, budget, and memory in EVM storage. It derives caller and time from EVM context. Only the configured delegate's attempts enter memory, so outsiders cannot evict its episodes. The deploying owner can revoke the session.

The owner can differ from the spending delegate. Revocation is permanent for that instance. Rejected delegate attempts are remembered, including attempts after expiry or revocation, without consuming allowance. A preview writes no memory.

## Fe-specific contribution

The operation signatures declare the effects each function receives:

```fe
pub fn preview(_ request: SpendRequest) -> Decision
    uses (policy: SpendPolicy, budget: Budget)

pub fn authorize(_ request: SpendRequest) -> Decision
    uses (policy: SpendPolicy, budget: mut Budget)

pub fn recall(_ sequence: u256) -> Option<MemoryEntry>
    uses (memory: AgentMemory)
```

Policy evaluation has no memory effect, and recall has no budget effect. Fe's effect declarations expose these boundaries in the API. Typed `Wei` and `Timestamp` values keep money and time distinct. The same library functions are tested with application-owned effects and then used against persistent contract fields.

## Decision codes

Checks run in this order; the first rejection wins.

| Code | Meaning |
| --- | --- |
| 0 | Allowed |
| 1 | Session revoked |
| 2 | Wrong delegate |
| 3 | Expired (`now >= valid_before`) |
| 4 | Wrong recipient |
| 5 | Zero amount |
| 6 | Per-transfer limit exceeded |
| 7 | Remaining budget exceeded |

## Memory scope and limitations

This is structured episodic memory, not semantic search, embeddings, or an LLM-generated summary. An integrating agent can retrieve records and decide what to do next, while the policy independently evaluates each new request. There is no LLM or natural-language document store in this repository.

An evidence hash is an opaque, caller-supplied reference. The contract does not fetch, verify, encrypt, or assess the truth of the referenced material. A hash is not a permission, a signature, or proof that an external action happened. On-chain fields are public; do not store private text or assume hashes hide predictable content.

The ring contains at most eight entries. It is not a complete, immutable audit log. Sequence numbers never restart during ordinary operation; exhausting `u256` would make further writes fail under checked arithmetic.

The reusable library trusts its supplied caller and time. A production adapter must derive those from a trusted environment, as `GuardDemo` does. A real wallet must apply authorization, budget changes, and the actual transfer in one atomic operation, handle failed transfers and reentrancy, and prevent alternate paths from bypassing the policy. None of that wallet execution logic is implemented here. The code has automated tests but has not received an independent security audit.

## Contest declaration

- **Pre-existing project:** none. This project was started on 16 November 2026 during the contest build window.
- **Reused components:** Fe 26.6.0, its standard library, and its built-in test runner. Official documentation and the contest starter were consulted for language and test conventions. This project has no third-party application dependencies.
- **AI assistance:** OpenAI Codex assisted with project design, code, tests, documentation, and registration preparation. The responsible human must review, understand, and be able to explain the submitted code.
- **License:** MIT.
- **Registration:** form received, organizer validation pending. The final project ID and private submission code must remain outside this public repository.

See [SUBMISSION.md](SUBMISSION.md) for the remaining handoff requirements.
