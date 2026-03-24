# EIP-8025: Migrate to SignedExecutionProof keyed by new_payload_request_root

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the devnet `ExecutionProof` (keyed by `blockRoot`) with the spec-aligned `SignedExecutionProof` (keyed by `new_payload_request_root`) across the entire beacon-node.

**Architecture:** The new `ExecutionProof` SSZ type already exists in `packages/types/src/eip8025/sszTypes.ts` with fields `{proofData, proofType, publicInput: {newPayloadRequestRoot}}`, wrapped by `SignedExecutionProof {message, validatorIndex, signature}`. This plan migrates the pool, gossip, req/resp, API, block verification, and chain logic from the old devnet fields (`proofId`, `slot`, `blockHash`, `blockRoot`) to the new spec-aligned structure. The pool is rekeyed from `blockRoot → proofType` to `newPayloadRequestRoot → proofType`. A reverse mapping `blockRoot → newPayloadRequestRoot` bridges the old lookup path in block verification.

**Tech Stack:** TypeScript, SSZ (@chainsafe/ssz), vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/types/src/eip8025/types.ts` | Modify | Add `SignedExecutionProof`, `PublicInput` type exports |
| `packages/types/src/eip8025/index.ts` | Modify | Add SSZ type re-exports |
| `packages/beacon-node/src/chain/opPools/executionProofPool.ts` | Rewrite | Rekey pool to `newPayloadRequestRoot → proofType`, store `SignedExecutionProof` |
| `packages/beacon-node/src/chain/validation/executionProofVerifier.ts` | Modify | Update verifier input to use new `ExecutionProof` fields |
| `packages/beacon-node/src/chain/interface.ts` | Modify | Update `maybeTransitionToValidOnProofArrival` signature |
| `packages/beacon-node/src/chain/chain.ts` | Modify | Update `maybeTransitionToValidOnProofArrival` implementation |
| `packages/beacon-node/src/chain/blocks/verifyBlocksExecutionPayloads.ts` | Modify | Look up proofs by `newPayloadRequestRoot` |
| `packages/beacon-node/src/network/gossip/interface.ts` | Modify | Change gossip type to `SignedExecutionProof` |
| `packages/beacon-node/src/network/gossip/topic.ts` | Modify | Deserialize as `SignedExecutionProof` |
| `packages/beacon-node/src/network/processor/gossipHandlers.ts` | Modify | Handle `SignedExecutionProof` in gossip |
| `packages/beacon-node/src/network/interface.ts` | Modify | `publishExecutionProof` takes `SignedExecutionProof` |
| `packages/beacon-node/src/network/network.ts` | Modify | Update publish to use `SignedExecutionProof` |
| `packages/beacon-node/src/network/reqresp/types.ts` | Modify | Response type → `SignedExecutionProof` |
| `packages/beacon-node/src/network/reqresp/handlers/index.ts` | Modify | Serve `SignedExecutionProof` from pool |
| `packages/beacon-node/src/api/impl/beacon/pool/index.ts` | Modify | API uses `SignedExecutionProof` |
| `packages/beacon-node/test/unit/chain/opPools/executionProofPool.test.ts` | Rewrite | Tests for new pool |
| `packages/beacon-node/test/unit/chain/validation/executionProofVerifier.test.ts` | Rewrite | Tests for new verifier |

---

### Task 1: Export new types from types package

**Files:**
- Modify: `packages/types/src/eip8025/types.ts`
- Modify: `packages/types/src/eip8025/index.ts`

- [ ] **Step 1: Add missing type exports to types.ts**

```typescript
// Add after existing exports in types.ts:
export type ProofType = ValueOf<typeof ssz.ProofType>;
export type PublicInput = ValueOf<typeof ssz.PublicInput>;
export type SignedExecutionProof = ValueOf<typeof ssz.SignedExecutionProof>;
```

- [ ] **Step 2: Add SSZ re-exports to index.ts**

```typescript
// Add to the export block in index.ts:
export {
  ExecutionProof as ExecutionProofType,
  ExecutionProofsByRangeRequest as ExecutionProofsByRangeRequestType,
  ExecutionProofsByRootRequest as ExecutionProofsByRootRequestType,
  PublicInput as PublicInputType,
  SignedExecutionProof as SignedExecutionProofType,
} from "./sszTypes.js";
export * from "./types.js";
```

- [ ] **Step 3: Verify build**

Run: `cd packages/types && npx tsgo --noEmit --project tsconfig.build.json`
Expected: No errors

- [ ] **Step 4: Commit**

```
jj describe -m "feat(eip8025): export SignedExecutionProof and PublicInput types"
jj new
```

---

### Task 2: Rewrite ExecutionProofPool keyed by newPayloadRequestRoot

**Files:**
- Rewrite: `packages/beacon-node/src/chain/opPools/executionProofPool.ts`
- Rewrite: `packages/beacon-node/test/unit/chain/opPools/executionProofPool.test.ts`

The pool changes from `slot → blockRoot → proofId → ExecutionProof` to `newPayloadRequestRoot → proofType → SignedExecutionProof`. Slot-based pruning is replaced by capacity-based pruning since `SignedExecutionProof` has no slot field.

- [ ] **Step 1: Write failing tests for the new pool**

Create the test file with new helpers using `SignedExecutionProof`:

```typescript
// test/unit/chain/opPools/executionProofPool.test.ts
import {describe, expect, it} from "vitest";
import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {SignedExecutionProof} from "@lodestar/types";
import {ExecutionProofPool} from "../../../../src/chain/opPools/executionProofPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";

const ROOT_A = Uint8Array.from({length: 32}, () => 0xaa);
const ROOT_B = Uint8Array.from({length: 32}, () => 0xbb);

function createSignedProof(overrides: {
  newPayloadRequestRoot?: Uint8Array;
  proofType?: number;
  validatorIndex?: number;
} = {}): SignedExecutionProof {
  return {
    message: {
      proofData: new Uint8Array(64),
      proofType: overrides.proofType ?? 0,
      publicInput: {
        newPayloadRequestRoot: overrides.newPayloadRequestRoot ?? ROOT_A,
      },
    },
    validatorIndex: overrides.validatorIndex ?? 0,
    signature: new Uint8Array(96),
  };
}

describe("ExecutionProofPool", () => {
  it("should add and retrieve a proof by request root", () => {
    const pool = new ExecutionProofPool();
    const proof = createSignedProof();
    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.size).toBe(1);
    const retrieved = pool.getByRequestRoot(ROOT_A);
    expect(retrieved).toHaveLength(1);
  });

  it("should deduplicate by (requestRoot, proofType)", () => {
    const pool = new ExecutionProofPool();
    const proof = createSignedProof();
    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.add(proof)).toBe(InsertOutcome.AlreadyKnown);
    expect(pool.size).toBe(1);
  });

  it("should store multiple proof types for the same request root", () => {
    const pool = new ExecutionProofPool();
    for (let proofType = 0; proofType < 3; proofType++) {
      expect(pool.add(createSignedProof({proofType}))).toBe(InsertOutcome.NewData);
    }
    expect(pool.size).toBe(3);
    expect(pool.getByRequestRoot(ROOT_A)).toHaveLength(3);
  });

  it("should store proofs for different request roots independently", () => {
    const pool = new ExecutionProofPool();
    pool.add(createSignedProof({newPayloadRequestRoot: ROOT_A}));
    pool.add(createSignedProof({newPayloadRequestRoot: ROOT_B}));
    expect(pool.size).toBe(2);
    expect(pool.getByRequestRoot(ROOT_A)).toHaveLength(1);
    expect(pool.getByRequestRoot(ROOT_B)).toHaveLength(1);
  });

  it("should reject invalid proofType >= EXECUTION_PROOF_TYPE_COUNT", () => {
    const pool = new ExecutionProofPool();
    expect(pool.add(createSignedProof({proofType: EXECUTION_PROOF_TYPE_COUNT}))).toBe(InsertOutcome.Old);
    expect(pool.size).toBe(0);
  });

  it("should return empty for unknown request root", () => {
    const pool = new ExecutionProofPool();
    expect(pool.getByRequestRoot(ROOT_A)).toEqual([]);
  });

  describe("hasEnoughProofs", () => {
    it("should return true when enough distinct proof types exist", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({proofType: 0}));
      pool.add(createSignedProof({proofType: 1}));
      expect(pool.hasEnoughProofs(ROOT_A, 2)).toBe(true);
      expect(pool.hasEnoughProofs(ROOT_A, 3)).toBe(false);
    });
  });

  describe("has", () => {
    it("should check for specific (requestRoot, proofType)", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({proofType: 0}));
      expect(pool.has(ROOT_A, 0)).toBe(true);
      expect(pool.has(ROOT_A, 1)).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all proofs across all request roots", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_A, proofType: 0}));
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_B, proofType: 0}));
      expect(pool.getAll()).toHaveLength(2);
    });
  });

  describe("prune", () => {
    it("should remove proofs for specified request roots", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_A}));
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_B}));
      pool.pruneByRequestRoots(new Set([ROOT_A]));
      expect(pool.getByRequestRoot(ROOT_A)).toEqual([]);
      expect(pool.getByRequestRoot(ROOT_B)).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project unit packages/beacon-node/test/unit/chain/opPools/executionProofPool.test.ts`
Expected: FAIL — methods don't exist yet

- [ ] **Step 3: Rewrite the pool implementation**

```typescript
// packages/beacon-node/src/chain/opPools/executionProofPool.ts
import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {SignedExecutionProof} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";

type RequestRootHex = string;
type ProofType = number;

/**
 * EIP-8025: In-memory pool for signed execution proofs,
 * indexed by newPayloadRequestRoot → proofType.
 */
export class ExecutionProofPool {
  private readonly proofsByRequestRoot = new MapDef<RequestRootHex, Map<ProofType, SignedExecutionProof>>(
    () => new Map()
  );

  get size(): number {
    let count = 0;
    for (const byProofType of this.proofsByRequestRoot.values()) {
      count += byProofType.size;
    }
    return count;
  }

  add(signedProof: SignedExecutionProof): InsertOutcome {
    const {proofType} = signedProof.message;
    if (proofType >= EXECUTION_PROOF_TYPE_COUNT) {
      return InsertOutcome.Old;
    }

    const requestRootHex = toRootHex(signedProof.message.publicInput.newPayloadRequestRoot);
    const byProofType = this.proofsByRequestRoot.getOrDefault(requestRootHex);

    if (byProofType.has(proofType)) {
      return InsertOutcome.AlreadyKnown;
    }

    byProofType.set(proofType, signedProof);
    return InsertOutcome.NewData;
  }

  getByRequestRoot(requestRoot: Uint8Array): SignedExecutionProof[] {
    const hex = toRootHex(requestRoot);
    const byProofType = this.proofsByRequestRoot.get(hex);
    return byProofType ? Array.from(byProofType.values()) : [];
  }

  getByRequestRootHex(requestRootHex: RequestRootHex): SignedExecutionProof[] {
    const byProofType = this.proofsByRequestRoot.get(requestRootHex);
    return byProofType ? Array.from(byProofType.values()) : [];
  }

  getAll(): SignedExecutionProof[] {
    const all: SignedExecutionProof[] = [];
    for (const byProofType of this.proofsByRequestRoot.values()) {
      for (const proof of byProofType.values()) {
        all.push(proof);
      }
    }
    return all;
  }

  hasEnoughProofs(requestRoot: Uint8Array, minRequired: number): boolean {
    const hex = toRootHex(requestRoot);
    const byProofType = this.proofsByRequestRoot.get(hex);
    return byProofType !== undefined && byProofType.size >= minRequired;
  }

  has(requestRoot: Uint8Array, proofType: ProofType): boolean {
    const hex = toRootHex(requestRoot);
    return this.proofsByRequestRoot.get(hex)?.has(proofType) ?? false;
  }

  pruneByRequestRoots(rootsToPrune: Set<Uint8Array>): void {
    for (const root of rootsToPrune) {
      this.proofsByRequestRoot.delete(toRootHex(root));
    }
  }

  /** Prune all roots not in the active set */
  pruneKeepOnly(activeRootHexes: Set<RequestRootHex>): void {
    for (const hex of this.proofsByRequestRoot.keys()) {
      if (!activeRootHexes.has(hex)) {
        this.proofsByRequestRoot.delete(hex);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run --project unit packages/beacon-node/test/unit/chain/opPools/executionProofPool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
jj describe -m "refactor(eip8025): rewrite ExecutionProofPool keyed by newPayloadRequestRoot"
jj new
```

---

### Task 3: Update verifier to use spec-aligned ExecutionProof

**Files:**
- Modify: `packages/beacon-node/src/chain/validation/executionProofVerifier.ts`
- Rewrite: `packages/beacon-node/test/unit/chain/validation/executionProofVerifier.test.ts`

The verifier no longer checks `blockRoot`/`blockHash` fields (those don't exist on the spec type). It checks `proofData` and counts distinct `proofType` values. The `newPayloadRequestRoot` binding is the structural guarantee.

- [ ] **Step 1: Rewrite the verifier**

```typescript
// packages/beacon-node/src/chain/validation/executionProofVerifier.ts
import {SignedExecutionProof} from "@lodestar/types";

export type VerifyExecutionProofsInput = {
  proofs: SignedExecutionProof[];
  minProofsRequired: number;
};

export type VerifyExecutionProofsResult = {ok: true; distinctProofTypes: number} | {ok: false; error: string};

export interface IZkvmExecutionProofVerifier {
  verifyProofs(input: VerifyExecutionProofsInput): VerifyExecutionProofsResult;
}

/**
 * Dummy zkEVM verifier for EIP-8025 proof-driven mode.
 * Checks: proofData non-empty, min distinct proof types.
 */
export class DummyZkvmExecutionProofVerifier implements IZkvmExecutionProofVerifier {
  verifyProofs(input: VerifyExecutionProofsInput): VerifyExecutionProofsResult {
    const {proofs, minProofsRequired} = input;
    const distinctProofTypes = new Set<number>();

    for (const signedProof of proofs) {
      const proof = signedProof.message;
      if (proof.proofData.length === 0) {
        return {ok: false, error: `empty proofData for proofType=${proof.proofType}`};
      }
      distinctProofTypes.add(proof.proofType);
    }

    if (distinctProofTypes.size < minProofsRequired) {
      return {
        ok: false,
        error: `insufficient distinct proof types: have=${distinctProofTypes.size} need=${minProofsRequired}`,
      };
    }

    return {ok: true, distinctProofTypes: distinctProofTypes.size};
  }
}

export const defaultZkvmExecutionProofVerifier: IZkvmExecutionProofVerifier = new DummyZkvmExecutionProofVerifier();
```

- [ ] **Step 2: Rewrite verifier tests**

Update `test/unit/chain/validation/executionProofVerifier.test.ts` to use `SignedExecutionProof` with `proofType`/`proofData` instead of the old devnet fields.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run --project unit packages/beacon-node/test/unit/chain/validation/executionProofVerifier.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```
jj describe -m "refactor(eip8025): update verifier for spec-aligned ExecutionProof"
jj new
```

---

### Task 4: Update chain interface and maybeTransitionToValidOnProofArrival

**Files:**
- Modify: `packages/beacon-node/src/chain/interface.ts:289`
- Modify: `packages/beacon-node/src/chain/chain.ts:1543-1584`

The method now takes `SignedExecutionProof` and looks up by `newPayloadRequestRoot`. Since the pool is keyed by request root, the block root lookup goes through fork choice's reverse mapping.

- [ ] **Step 1: Update interface signature**

In `interface.ts`, change line 289:

```typescript
// Old:
maybeTransitionToValidOnProofArrival(proof: {slot: number; blockRoot: Uint8Array; blockHash: Uint8Array}): void;
// New:
maybeTransitionToValidOnProofArrival(signedProof: SignedExecutionProof): void;
```

Add `SignedExecutionProof` to the imports from `@lodestar/types`.

- [ ] **Step 2: Update chain.ts implementation**

In `chain.ts`, update `maybeTransitionToValidOnProofArrival`. The key change: we use the `newPayloadRequestRoot` to check if we have enough proofs, and we need a way to map `newPayloadRequestRoot → blockRoot` for the fork choice update. For now, iterate fork choice blocks to find the match (or use a reverse index added to the pool).

```typescript
maybeTransitionToValidOnProofArrival(signedProof: SignedExecutionProof): void {
  if (!this.activateZkvm) return;

  const requestRoot = signedProof.message.publicInput.newPayloadRequestRoot;
  if (!this.executionProofPool.hasEnoughProofs(requestRoot, this.minProofsRequired)) return;

  // Find the block in fork choice that corresponds to this newPayloadRequestRoot.
  // TODO EIP-8025: Add a reverse index (newPayloadRequestRoot → blockRootHex) for O(1) lookup.
  // For now, this is acceptable since proof arrival is infrequent.
  const requestRootHex = toRootHex(requestRoot);
  const block = this.forkChoice.getBlockByExecutionRequestRoot?.(requestRootHex)
    ?? this.findBlockByRequestRoot(requestRootHex);
  if (block == null || block.executionPayloadBlockHash == null) {
    this.logger.debug("Cannot transition block to valid: request root not found in fork choice", {
      requestRoot: requestRootHex,
    });
    return;
  }

  if (block.executionStatus === ExecutionStatus.Valid) return;

  this.forkChoice.validateLatestHash({
    executionStatus: ExecutionStatus.Valid,
    latestValidExecHash: block.executionPayloadBlockHash,
  });
  this.recomputeForkChoiceHead(ForkchoiceCaller.onExecutionProof);
  this.logger.info("Execution proofs sufficient, marked block valid (zkvm)", {
    blockRoot: block.blockRoot,
    execBlockHash: block.executionPayloadBlockHash,
    proofsAvailable: this.executionProofPool.getByRequestRoot(requestRoot).length,
    minRequired: this.minProofsRequired,
  });
}
```

Note: The mapping from `newPayloadRequestRoot` to a block in fork choice requires either (a) a reverse index maintained by the chain or (b) scanning fork choice. Since the spec `NewPayloadRequestHeader` is computed from the execution payload header, the `newPayloadRequestRoot` is deterministic per block. A simple `Map<RequestRootHex, BlockRootHex>` maintained when blocks are imported is the cleanest approach. Add it to the chain as `requestRootToBlockRoot`.

- [ ] **Step 3: Verify build compiles**

Run: `cd packages/beacon-node && npx tsgo --noEmit --project tsconfig.build.json`

- [ ] **Step 4: Commit**

```
jj describe -m "refactor(eip8025): update maybeTransitionToValidOnProofArrival for SignedExecutionProof"
jj new
```

---

### Task 5: Update block verification to look up proofs by newPayloadRequestRoot

**Files:**
- Modify: `packages/beacon-node/src/chain/blocks/verifyBlocksExecutionPayloads.ts:273-321`

The `verifyBlockExecutionPayloadByProof` function currently calls `pool.getProofsByBlockRoot(blockRootHex)`. It needs to compute the `newPayloadRequestRoot` from the execution payload and look up by that instead.

- [ ] **Step 1: Compute newPayloadRequestRoot from execution payload**

The `newPayloadRequestRoot` is `ssz.eip8025.PublicInput.hashTreeRoot({newPayloadRequestRoot: <computed>})` — but actually, the `newPayloadRequestRoot` in `PublicInput` IS the hash tree root of the `NewPayloadRequestHeader`. So during block verification, we need to compute it from the execution payload header.

For the dummy verifier phase, we can use the block root as a temporary stand-in, OR compute the actual `NewPayloadRequestHeader` hash. The latter is the correct approach per spec.

```typescript
// In verifyBlockExecutionPayloadByProof:
// Compute the newPayloadRequestRoot from the execution payload
const newPayloadRequestRoot = computeNewPayloadRequestRoot(executionPayload, blockInput);
const proofs = chain.executionProofPool?.getByRequestRoot(newPayloadRequestRoot) ?? [];
const verification = verifier.verifyProofs({proofs, minProofsRequired: minRequired});
```

- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit**

---

### Task 6: Update gossip wire type to SignedExecutionProof

**Files:**
- Modify: `packages/beacon-node/src/network/gossip/interface.ts:8,116,148`
- Modify: `packages/beacon-node/src/network/gossip/topic.ts:129`
- Modify: `packages/beacon-node/src/network/processor/gossipHandlers.ts:919-947`

- [ ] **Step 1: Update gossip interface**

In `interface.ts`:
- Change import from `ExecutionProof` to `SignedExecutionProof`
- `GossipTypeMap`: `[GossipType.execution_proof]: SignedExecutionProof;`
- `GossipFnByType`: `[GossipType.execution_proof]: (proof: SignedExecutionProof) => Promise<void> | void;`

- [ ] **Step 2: Update topic.ts deserialization**

```typescript
case GossipType.execution_proof:
  return ssz.eip8025.SignedExecutionProof;
```

- [ ] **Step 3: Update gossip handler**

In `gossipHandlers.ts`, the handler now receives a `SignedExecutionProof`:

```typescript
[GossipType.execution_proof]: async ({gossipData, topic}) => {
  const {serializedData} = gossipData;
  const signedProof = sszDeserialize(topic, serializedData);
  const proof = signedProof.message;
  const requestRootHex = toRootHex(proof.publicInput.newPayloadRequestRoot);

  try {
    const insertOutcome = chain.executionProofPool.add(signedProof);
    logger.debug("Received execution proof via gossip", {
      proofType: proof.proofType,
      requestRoot: requestRootHex,
      validatorIndex: signedProof.validatorIndex,
      insertOutcome,
    });

    if (insertOutcome === InsertOutcome.NewData) {
      chain.maybeTransitionToValidOnProofArrival(signedProof);
    }
  } catch (e) {
    logger.error("Error adding execution proof to pool", {}, e as Error);
  }
},
```

- [ ] **Step 4: Verify build**
- [ ] **Step 5: Commit**

---

### Task 7: Update network publish and interface

**Files:**
- Modify: `packages/beacon-node/src/network/interface.ts:102`
- Modify: `packages/beacon-node/src/network/network.ts:511-520`

- [ ] **Step 1: Update interface**

```typescript
publishExecutionProof(signedProof: SignedExecutionProof): Promise<number>;
```

- [ ] **Step 2: Update network.ts**

The `SignedExecutionProof` has no `slot` field. The epoch for fork boundary must come from the caller or current clock:

```typescript
async publishExecutionProof(signedProof: SignedExecutionProof): Promise<number> {
  const epoch = computeEpochAtSlot(this.clock.currentSlot);
  const boundary = this.config.getForkBoundaryAtEpoch(epoch);
  return this.publishGossip<GossipType.execution_proof>(
    {type: GossipType.execution_proof, boundary},
    signedProof,
    {ignoreDuplicatePublishError: true}
  );
}
```

Note: `this.clock` must be accessible. Check if `BeaconNetwork` has clock access — if not, use `this.chain.clock` or pass slot as parameter.

- [ ] **Step 3: Commit**

---

### Task 8: Update req/resp types and handlers

**Files:**
- Modify: `packages/beacon-node/src/network/reqresp/types.ts:96-97,158-159`
- Modify: `packages/beacon-node/src/network/reqresp/handlers/index.ts:78-106`

- [ ] **Step 1: Update types.ts response types**

```typescript
// ResponseBodyByMethod:
[ReqRespMethod.ExecutionProofsByRoot]: SignedExecutionProof;
[ReqRespMethod.ExecutionProofsByRange]: SignedExecutionProof;

// responseSszTypeByMethod:
[ReqRespMethod.ExecutionProofsByRoot]: () => ssz.eip8025.SignedExecutionProof,
[ReqRespMethod.ExecutionProofsByRange]: () => ssz.eip8025.SignedExecutionProof,
```

- [ ] **Step 2: Update handlers**

The `ExecutionProofsByRoot` handler needs updating. The request type still uses `blockRoot` — this request type itself may need to change to use `requestRoot` per spec. For now, we can maintain backward compat by looking up block root → request root.

The `ExecutionProofsByRange` handler also needs updating since the pool no longer has slot-based retrieval. This could use `getAll()` filtered by slot from the caller, or the handler can return all known proofs.

```typescript
[ReqRespMethod.ExecutionProofsByRoot]: (req) => {
  const body = ssz.eip8025.ExecutionProofsByRootRequest.deserialize(req.data);
  // TODO EIP-8025: ExecutionProofsByRootRequest should use requestRoot per spec
  // For now, use blockRoot → requestRoot mapping
  const proofs = chain.executionProofPool.getByRequestRootHex(toRootHex(body.blockRoot));
  return (async function* () {
    for (const proof of proofs) {
      yield {
        data: ssz.eip8025.SignedExecutionProof.serialize(proof),
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(chain.clock.currentSlot)),
      };
    }
  })();
},
[ReqRespMethod.ExecutionProofsByRange]: (req) => {
  const body = ssz.eip8025.ExecutionProofsByRangeRequest.deserialize(req.data);
  // Pool no longer has slot-based indexing; return all proofs
  // TODO EIP-8025: Add slot-based filtering or update protocol
  const proofs = chain.executionProofPool.getAll();
  return (async function* () {
    for (const proof of proofs) {
      yield {
        data: ssz.eip8025.SignedExecutionProof.serialize(proof),
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(chain.clock.currentSlot)),
      };
    }
  })();
},
```

- [ ] **Step 3: Commit**

---

### Task 9: Update REST API

**Files:**
- Modify: `packages/beacon-node/src/api/impl/beacon/pool/index.ts:316-368`

- [ ] **Step 1: Update getPoolExecutionProofs**

```typescript
async getPoolExecutionProofs() {
  return {data: chain.executionProofPool.getAll()};
},
```

- [ ] **Step 2: Update submitPoolExecutionProofs**

The API now receives a `SignedExecutionProof`:

```typescript
async submitPoolExecutionProofs({signedExecutionProof}) {
  const proof = signedExecutionProof.message;
  const requestRootHex = toRootHex(proof.publicInput.newPayloadRequestRoot);

  if (chain.executionProofPool.has(proof.publicInput.newPayloadRequestRoot, proof.proofType)) {
    logger.debug("Ignoring known execution proof", {requestRoot: requestRootHex, proofType: proof.proofType});
    return {};
  }

  const insertOutcome = chain.executionProofPool.add(signedExecutionProof);
  logger.info("Execution proof submitted via API", {
    requestRoot: requestRootHex,
    proofType: proof.proofType,
    validatorIndex: signedExecutionProof.validatorIndex,
    insertOutcome,
  });

  if (insertOutcome === InsertOutcome.NewData) {
    try {
      await network.publishExecutionProof(signedExecutionProof);
    } catch (e) {
      logger.debug("Failed to publish execution proof", {proofType: proof.proofType}, e as Error);
    }
    chain.maybeTransitionToValidOnProofArrival(signedExecutionProof);
  }

  return {};
},
```

Note: The API route definition may also need updating to accept `SignedExecutionProof` in the request body. Check the route definitions in `packages/api/`.

- [ ] **Step 3: Commit**

---

### Task 10: Full build and integration test

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run lint**

Run: `pnpm lint:fix && pnpm lint`
Expected: No errors

- [ ] **Step 3: Run all execution proof tests**

Run: `pnpm vitest run --project unit packages/beacon-node/test/unit/chain/opPools/executionProofPool.test.ts packages/beacon-node/test/unit/chain/validation/executionProofVerifier.test.ts`
Expected: All tests pass

- [ ] **Step 4: Final commit**

```
jj describe -m "refactor(eip8025): migrate to SignedExecutionProof keyed by new_payload_request_root"
```
