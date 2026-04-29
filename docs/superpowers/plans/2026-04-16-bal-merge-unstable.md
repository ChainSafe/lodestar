# BAL (EIP-7928) Refresh from bal-devnet-4 onto Unstable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port EIP-7928 (Block Access List) from the working `bal-devnet-4` branch onto `unstable`'s ePBS architecture. The BAL implementation already exists — we're adapting it to fit the new ePBS containers.

**Architecture:** `bal-devnet-4` has a complete BAL implementation but it's built on a pre-ePBS model (ExecutionPayload in blocks, ExecutionPayloadHeader in state). `unstable` has ePBS (EIP-7732) where ExecutionPayload lives inside ExecutionPayloadEnvelope and BeaconState no longer has ExecutionPayloadHeader. We cherry-pick the BAL pieces from `bal-devnet-4` and drop what ePBS makes obsolete.

**Source branch:** `origin/bal-devnet-4` — use `git show origin/bal-devnet-4:<path>` to reference existing code.

**Tech Stack:** TypeScript, SSZ (@chainsafe/ssz), Lodestar monorepo

**What to keep from bal-devnet-4:**
- `BlockAccessList` type definition (`ByteListType(MAX_BYTES_PER_TRANSACTION)`)
- `ExecutionPayload` extending base with `blockAccessList` field
- Engine API serialization/deserialization of `blockAccessList` in `types.ts`
- `ExecutionPayloadRpc.blockAccessList` field

**What to drop from bal-devnet-4 (obsoleted by ePBS or not in spec):**
- EIP-7843 `slotNumber` field (not in consensus specs)
- `ExecutionPayloadHeader` / `blockAccessListRoot` (ePBS removes headers from state)
- `BlindedBeaconBlock`, `BlindedBeaconBlockBody`, `BuilderBid` overrides (ePBS replaces builder flow)
- `BeaconBlockBody` with `executionPayload` (ePBS uses `signedExecutionPayloadBid`)
- `BeaconState.latestExecutionPayloadHeader` changes (replaced by `latestBlockHash`)
- `BlockContents`, `SignedBlockContents`, `PayloadAttributes`, `SSEPayloadAttributes` overrides
- `upgradeStateToGloas` header initialization
- `executionPayloadToPayloadHeader` gloas additions
- Engine API version bumps (`newPayloadV5`, `forkchoiceUpdatedV4`, `getPayloadV6`)
- `genesis.ts` header type union addition

---

## Task 1: Port BAL SSZ types from bal-devnet-4

**Files:**
- Modify: `packages/types/src/gloas/sszTypes.ts`
- Modify: `packages/types/src/gloas/types.ts`
- Modify: `packages/types/src/types.ts`

**Source reference:** `git show origin/bal-devnet-4:packages/types/src/gloas/sszTypes.ts`

From bal-devnet-4, copy:
- `BlockAccessList` type definition
- `ExecutionPayload` container (but extend `electraSsz.ExecutionPayload` instead of `denebSsz.ExecutionPayload`, and omit `slotNumber`)

Then update `ExecutionPayloadEnvelope` to use the new gloas `ExecutionPayload` instead of `electraSsz.ExecutionPayload`.

- [ ] **Step 1: Add BlockAccessList and ExecutionPayload to sszTypes.ts**

From bal-devnet-4, port these two definitions. Adapt `ExecutionPayload` to extend electra's (not deneb's as in bal-devnet-4) and drop `slotNumber`:

```typescript
// From bal-devnet-4 — keep as-is
export const BlockAccessList = new ByteListType(MAX_BYTES_PER_TRANSACTION);

// From bal-devnet-4 — change base from denebSsz to electraSsz, drop slotNumber
export const ExecutionPayload = new ContainerType(
  {
    ...electraSsz.ExecutionPayload.fields,
    blockAccessList: BlockAccessList, // New in GLOAS:EIP-7928
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);
```

Add `ByteListType` to the `@chainsafe/ssz` import and `MAX_BYTES_PER_TRANSACTION` to the `@lodestar/params` import.

Update `ExecutionPayloadEnvelope.payload` from `electraSsz.ExecutionPayload` to `ExecutionPayload`.

- [ ] **Step 2: Port type exports to types.ts**

From bal-devnet-4's `types.ts`, copy only the BAL-relevant exports:

```typescript
export type BlockAccessList = ValueOf<typeof ssz.BlockAccessList>;
export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
```

Drop all the other type exports that bal-devnet-4 added (ExecutionPayloadHeader, BlindedBeaconBlock, BuilderBid, etc.).

- [ ] **Step 3: Update TypesByFork in types.ts**

From bal-devnet-4's `types.ts`, port only the `ExecutionPayload` mapping change. In the gloas section, change:

```typescript
ExecutionPayload: deneb.ExecutionPayload,  // current unstable
```
to:
```typescript
ExecutionPayload: gloas.ExecutionPayload,  // from bal-devnet-4
```

Leave all other gloas TypesByFork mappings as unstable has them.

- [ ] **Step 4: Verify types build**

```bash
pnpm run -C packages/types check-types
```

- [ ] **Step 5: Commit**

```bash
git add packages/types/
git commit -m "feat: add EIP-7928 BlockAccessList to gloas ExecutionPayload"
```

---

## Task 2: Port engine API serialization from bal-devnet-4

**Files:**
- Modify: `packages/beacon-node/src/execution/engine/types.ts`

**Source reference:** `git show origin/bal-devnet-4:packages/beacon-node/src/execution/engine/types.ts`

From bal-devnet-4, copy the `blockAccessList` serialization/deserialization code. Drop `slotNumber` handling and engine API version bumps.

- [ ] **Step 1: Port blockAccessList to ExecutionPayloadRpc**

From bal-devnet-4, add to the `ExecutionPayloadRpc` type:

```typescript
blockAccessList?: DATA; // GLOAS:EIP-7928
```

- [ ] **Step 2: Port serialization from bal-devnet-4's serializeExecutionPayload**

Copy the gloas block from bal-devnet-4, dropping `slotNumber`:

```typescript
if (ForkSeq[fork] >= ForkSeq.gloas) {
  const {blockAccessList} = data as gloas.ExecutionPayload;
  payload.blockAccessList = bytesToData(blockAccessList);
}
```

Add `gloas` to the imports from `@lodestar/types`.

- [ ] **Step 3: Port deserialization from bal-devnet-4's parseExecutionPayload**

Copy the gloas block from bal-devnet-4, dropping `slotNumber`:

```typescript
if (ForkSeq[fork] >= ForkSeq.gloas) {
  const {blockAccessList} = data;
  if (blockAccessList == null) {
    throw Error(
      `blockAccessList missing for ${fork} >= gloas executionPayload number=${executionPayload.blockNumber} hash=${data.blockHash}`
    );
  }
  (executionPayload as gloas.ExecutionPayload).blockAccessList = dataToBytes(blockAccessList, null);
}
```

- [ ] **Step 4: Do NOT port these from bal-devnet-4** (not in spec / obsoleted by ePBS):
- `slotNumber` in `ExecutionPayloadRpc`, `serializeExecutionPayload`, `parseExecutionPayload`
- `slotNumber` in `PayloadAttributesRpc`, `serializePayloadAttributes`, `deserializePayloadAttributes`
- `engine_newPayloadV5`, `engine_forkchoiceUpdatedV4`, `engine_getPayloadV6` type entries

- [ ] **Step 5: Verify beacon-node builds**

```bash
pnpm run -C packages/beacon-node check-types
```

- [ ] **Step 6: Commit**

```bash
git add packages/beacon-node/src/execution/
git commit -m "feat: add EIP-7928 blockAccessList to engine API serialization"
```

---

## Task 3: Verify no state-transition changes needed

**Files to check (but likely no changes):**
- `packages/state-transition/src/util/execution.ts`
- `packages/state-transition/src/slot/upgradeStateToGloas.ts`
- `packages/state-transition/src/util/genesis.ts`

**Source reference:** `git show origin/bal-devnet-4:packages/state-transition/`

bal-devnet-4 had state-transition changes for:
- `upgradeStateToGloas`: initializing `blockAccessListRoot` on `latestExecutionPayloadHeader` — **drop** (ePBS removes header)
- `executionPayloadToPayloadHeader`: computing `blockAccessListRoot` — **drop** (ePBS removes header from state)
- `genesis.ts`: adding `ssz.gloas.ExecutionPayloadHeader` to union — **drop** (type doesn't exist in ePBS)

- [ ] **Step 1: Confirm no state-transition changes are needed**

Verify that `executionPayloadToPayloadHeader` is not called for gloas fork in unstable. If it is, we'd need to add `blockAccessListRoot` handling, but this is unlikely.

- [ ] **Step 2: Verify state-transition builds**

```bash
pnpm run -C packages/state-transition check-types
```

---

## Task 4: Full build and test

- [ ] **Step 1: Full build**

```bash
pnpm build
```

- [ ] **Step 2: Lint**

```bash
pnpm lint:fix
```

- [ ] **Step 3: Type check**

```bash
pnpm check-types
```

- [ ] **Step 4: Unit tests**

```bash
pnpm test:unit
```

- [ ] **Step 5: Fix any failures and commit**
