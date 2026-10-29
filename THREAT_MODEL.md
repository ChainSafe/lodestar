# Lodestar-z threat model

This document defines the security assumptions that materially affect how findings in Lodestar-z
are classified.

This model is not an allowlist. Reviewers should first surface candidate violations, then use these
assumptions to determine reachability and severity. A finding may be downgraded only when the
applicable call path establishes the cited assumption. If the code contradicts this document, report
the code issue and the documentation gap.

## Scope

Lodestar-z is a Zig consensus library and Node.js native addon. Its host integration owns networking,
API exposure, checkpoint acquisition, execution-layer communication, and validator duties.

The supported Node.js integration loads one version of `@lodestar/native` per process. Passing
native class instances between addon versions is unsupported.

The assets protected here are:

- Ethereum consensus safety and liveness;
- state-transition, fork-choice, and BLS correctness;
- native memory safety and availability of the hosting process; and
- integrity of shared native state across calls and Node.js environments; and
- integrity of source dependencies and published native artifacts.

The relevant attackers are remote peers or API users whose values reach Lodestar-z, and
same-process JavaScript callers that can supply malformed values. Attackers may also target
dependencies, build workflows, release credentials, or the package registry. The operator and host
application are trusted to select configuration, verification policy, initial state, local files,
wall-clock time, and execution or data-availability status. Same-process Zig code is trusted to
honor native API preconditions. Host compromise and malicious replacement of trusted local storage
are out of scope.

## Security objectives

1. Given the correct preset and configuration, an eligible trusted pre-state, and accurate external
   statuses, consensus behavior agrees with the pinned Ethereum consensus specification.
2. BLS operations do not falsely accept invalid signatures or points when their API contract
   requires validation.
3. Externally influenced values cannot cause native-memory corruption or disclosure.
4. Attacker-controlled inputs fail without panics, deadlocks, cumulative leaks, or unbounded work or
   allocation.
5. Rejected candidates cannot publish branch-specific state or corrupt shared state.
6. Supported concurrent operations and environment teardown cannot race with borrowed native state.
7. Build and release preserve the integrity and provenance of reviewed source, dependency inputs,
   and published native artifacts.

## Trust boundaries

| Boundary                      | Contract                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote input through Lodestar | Values remain hostile until the validation required by the consuming operation has completed. Reports must trace the supported or planned path into Lodestar-z.                                                                                         |
| JavaScript to N-API           | Runtime types, lengths, indexes, encodings, and buffer ranges are untrusted. TypeScript declarations and debug assertions are not runtime validation.                                                                                                   |
| Serialized input to SSZ       | Decoders must enforce canonical encoding, bounds, offsets, and safe ownership. Beacon-state construction is the exception described below: its bytes have trusted provenance, but still require structural SSZ validation.                              |
| State transition              | The pre-state is an eligible trusted state. The signed block is hostile. Processing must not mutate the pre-state, and the result becomes trusted only after the required checks succeed.                                                               |
| Fork choice                   | Blocks have passed full state transition, attestations have passed their applicable validation, external statuses are accurate, and local time is trusted. Fork choice still owns its specified ancestry, timing, vote, invalidation, and bound checks. |
| Zig to native dependencies    | Lodestar-z owns representation, cardinality, validation flags, pointer lifetime, and ABI compatibility. Pinned dependencies are trusted only within their documented contracts.                                                                         |
| Shared native state           | Ownership, synchronization, bounds, worker visibility, and teardown must be defined for every shared pool or cache.                                                                                                                                     |
| Build and release             | Dependency resolution, automation credentials, and artifact publication must preserve provenance from reviewed source to the published native addon.                                                                                                    |

## BeaconState trust

Beacon states accepted by Lodestar-z are trusted inputs. SSZ deserialization establishes structural
validity only. It does not establish provenance, canonicality, finality, execution validity, or data
availability.

Trusted provenance begins at one of these anchors:

- genesis;
- a state matching a user-provided checkpoint root; or
- a checkpoint selected by a provider to which the user has delegated trust.

A successfully transitioned descendant inherits that provenance. A state loaded from trusted local
storage retains the status it had when written.

A **trusted state** is structurally valid SSZ and is either an anchor or the result of a successful
consensus-layer transition from an eligible trusted pre-state. It need not be canonical, finalized,
or persisted. An **eligible trusted pre-state** additionally belongs to a branch that remains
fork-choice eligible under its current execution and data-availability status.

A viable noncanonical branch can therefore contain trusted states. Finalization can make the branch
ineligible without changing its historical consensus validity. An execution-optimistic state is
conditionally trusted: it may remain in fork choice while execution is unresolved, but validators
must not perform duties from an optimistic node. An invalid execution result revokes eligibility for
the affected branch.

Raw checkpoint bytes are hostile to whichever component first decodes them before authentication.
Lodestar-z does not currently own that boundary. If it does in a supported integration, the new
entry point must treat those bytes as hostile.

## Block acceptance

- A full consensus-layer state transition is required before a block enters the live chain or fork
  choice, or establishes a trusted post-state. Gossip, ancestry, and hash-chain checks do not replace
  the transition.
- Signatures are checked by the transition or by an equivalent prior batch whose all-or-none result
  gates the same import.
- State transition, signature checks, execution verification, and data-availability verification may
  run concurrently, but all required results must gate live-chain and fork-choice admission.
- Within the data-availability window, availability must be satisfied before acceptance. Outside the
  window, the sync policy treats availability as satisfied.
- Verification flags are trusted host policy. Disabling a required check is safe only when equivalent
  prior verification gates the same operation.
- Historical archive backfill may omit the full transition only while its blocks cannot enter live
  consensus or establish trusted state. Later promotion must satisfy the normal acceptance contract.

Lodestar-z consumes execution and data-availability results rather than establishing them. A false
result from a trusted external component is outside this boundary; mishandling an accurate result is
in scope.

## Candidate and cache isolation

Candidate processing must isolate branch-specific mutations until acceptance. A rejected candidate
may leave only branch-independent facts or completed work that cannot affect later validity.

An append-only validator-pubkey cache may advance during a failed candidate when entries beyond the
current state's validator count are treated as absent, later valid processing must reproduce the
same pubkey at an index, and conflicting or sparse appends fail. This is permitted cache population,
not publication of the rejected state.

## Classifying findings

A report should identify the least-privileged attacker, the supported or planned call path, the
trusted precondition under review, the violated objective, and the concrete effect. Verify
integration status against the current or planned call path. State uncertain reachability explicitly.

| Classification            | Meaning                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Security vulnerability    | An in-scope attacker crosses a current supported boundary and violates a security objective.                             |
| Security-readiness issue  | An identified planned integration would expose the violation, but the path is not production-reachable.                  |
| Consensus correctness bug | Consensus behavior violates the pinned specification without established hostile reachability.                           |
| Reliability bug           | The implementation violates another contract without established hostile reachability.                                   |
| Boundary hardening        | Validation or failure handling is weak, but the caller already has equivalent impact or violates a trusted precondition. |
| Unsupported use           | The trigger is outside the documented caller, lifecycle, or provenance contract.                                         |

For denial-of-service findings, quantify the attacker-controlled input, amplification, repetition,
and applicable transport or peer-scoring limits. Peer scoring can limit sustained abuse but does not
excuse a crash, cumulative leak, or unbounded queue.

## Maintenance

Change this file only when a security objective, trust assumption, trust boundary, or supported
caller obligation changes. Keep enduring API preconditions beside the owning declaration or module.
Routine fixes, optimizations, and file moves that preserve these contracts require no
security-documentation update.
