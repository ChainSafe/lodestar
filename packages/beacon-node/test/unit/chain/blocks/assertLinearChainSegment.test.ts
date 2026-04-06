import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {assertLinearChainSegment} from "../../../../src/chain/blocks/utils/chainSegment.js";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {expectThrowsLodestarError} from "../../../utils/errors.js";

const GLOAS_FORK_EPOCH = 1;
const config = createChainForkConfig({
  ...defaultChainConfig,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH,
});
const GLOAS_SLOT = computeStartSlotAtEpoch(GLOAS_FORK_EPOCH);

const HASH_A = new Uint8Array(32).fill(0xaa);
const HASH_B = new Uint8Array(32).fill(0xbb);
const HASH_C = new Uint8Array(32).fill(0xcc);
const HASH_WRONG = new Uint8Array(32).fill(0xde);

/** Build a gloas block input with specific parentRoot and bid.parentBlockHash */
function makeBlockInput(slot: Slot, parentRoot: Uint8Array, parentBlockHash: Uint8Array): IBlockInput {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  block.message.parentRoot = parentRoot;
  block.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentBlockHash;
  const blockRootHex = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
  return BlockInputNoData.createFromBlock({
    block,
    blockRootHex,
    forkName: ForkName.gloas,
    daOutOfRange: false,
    source: BlockInputSource.byRange,
    seenTimestampSec: 0,
  });
}

/** Compute the hash tree root of a block input's block */
function blockRoot(blockInput: IBlockInput): Uint8Array {
  const block = blockInput.getBlock();
  return config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
}

/** Build a PayloadEnvelopeInput that references the given block and carries a given payload block hash */
function makePayloadEnvelopeInput(blockInput: IBlockInput, payloadBlockHash: Uint8Array): PayloadEnvelopeInput {
  const block = blockInput.getBlock() as gloas.SignedBeaconBlock;
  const input = PayloadEnvelopeInput.createFromBlock({
    block,
    forkName: ForkName.gloas,
    blockRootHex: toRootHex(blockRoot(blockInput)),
    sampledColumns: [],
    custodyColumns: [],
    timeCreatedSec: 0,
  });
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  envelope.message.beaconBlockRoot = blockRoot(blockInput);
  envelope.message.slot = blockInput.getBlock().message.slot;
  envelope.message.payload.blockHash = payloadBlockHash;
  input.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 0});
  return input;
}

/** Build a mock parent ProtoBlock seeded with the given execution payload block hash */
function makeParentBlock(execHash: Uint8Array): ProtoBlock {
  return {executionPayloadBlockHash: toRootHex(execHash)} as Partial<ProtoBlock> as ProtoBlock;
}

describe("chain / blocks / assertLinearChainSegment", () => {
  // parentBlock represents the forkchoice-known parent of the first block in all segments below.
  // Its execution hash is HASH_A, so all first blocks must have bid.parentBlockHash = HASH_A.
  const parentBlock = makeParentBlock(HASH_A);

  describe("block linearity", () => {
    it("ok - single block", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const {warnings} = assertLinearChainSegment(config, [block0], null, parentBlock);
      expect(warnings).toBeNull();
    });

    it("ok - two blocks with matching parent roots and increasing slots", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_A);
      const {warnings} = assertLinearChainSegment(config, [block0, block1], null, parentBlock);
      expect(warnings).toBeNull();
    });

    it("NON_LINEAR_PARENT_ROOTS - second block has wrong parentRoot", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const block1 = makeBlockInput(GLOAS_SLOT + 1, HASH_WRONG, HASH_A);
      expectThrowsLodestarError(
        () => assertLinearChainSegment(config, [block0, block1], null, parentBlock),
        BlockErrorCode.NON_LINEAR_PARENT_ROOTS
      );
    });

    it("NON_LINEAR_SLOTS - second block has same slot as first", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const block1 = makeBlockInput(GLOAS_SLOT, blockRoot(block0), HASH_A);
      expectThrowsLodestarError(
        () => assertLinearChainSegment(config, [block0, block1], null, parentBlock),
        BlockErrorCode.NON_LINEAR_SLOTS
      );
    });
  });

  describe("execution hash chain (bid.parentBlockHash)", () => {
    it("ok - single block with correct bid.parentBlockHash", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const {warnings} = assertLinearChainSegment(config, [block0], null, parentBlock);
      expect(warnings).toBeNull();
    });

    it("BID_PARENT_HASH_MISMATCH on first block - no lastFullSlot so no warning emitted", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_B); // parentBlock has HASH_A
      // No prior envelope to blame, so fallback happens silently (no warning)
      const {warnings} = assertLinearChainSegment(config, [block0], null, parentBlock);
      expect(warnings).toBeNull();
    });

    it("ok - EMPTY chain (no envelopes): execution hash propagates unchanged across segment", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // block1 expects HASH_A because block0 was EMPTY (no envelope → no payload hash change)
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_A);
      const {warnings} = assertLinearChainSegment(config, [block0, block1], null, parentBlock);
      expect(warnings).toBeNull();
    });

    it("ok - FULL slot (envelope present): execution hash advances to envelope payload hash", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // Envelope for block0 delivers HASH_B, so block1 must use HASH_B as parentBlockHash
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_B);
      const envelopes = new Map([[GLOAS_SLOT, makePayloadEnvelopeInput(block0, HASH_B)]]);
      const {warnings} = assertLinearChainSegment(config, [block0, block1], envelopes, parentBlock);
      expect(warnings).toBeNull();
    });

    it("orphaned envelope recovery - second block references FULL hash but no envelope existed", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // No envelope for block0 → EMPTY → next block uses HASH_B which mismatches
      // No lastFullSlot to blame, so fallback happens silently
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_B);
      const {warnings} = assertLinearChainSegment(config, [block0, block1], null, parentBlock);
      expect(warnings).toBeNull();
    });

    it("ok - FULL then EMPTY: third block reuses the envelope hash from the first slot", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // block0 FULL: delivers HASH_B
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_B);
      // block1 EMPTY: hash stays HASH_B
      const block2 = makeBlockInput(GLOAS_SLOT + 2, blockRoot(block1), HASH_B);
      const envelopes = new Map([[GLOAS_SLOT, makePayloadEnvelopeInput(block0, HASH_B)]]);
      const {warnings} = assertLinearChainSegment(config, [block0, block1, block2], envelopes, parentBlock);
      expect(warnings).toBeNull();
    });

    it("ok - FULL then FULL: each block advances the execution hash", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // block0 FULL: delivers HASH_B
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_B);
      // block1 FULL: delivers HASH_C
      const block2 = makeBlockInput(GLOAS_SLOT + 2, blockRoot(block1), HASH_C);
      const envelopes = new Map([
        [GLOAS_SLOT, makePayloadEnvelopeInput(block0, HASH_B)],
        [GLOAS_SLOT + 1, makePayloadEnvelopeInput(block1, HASH_C)],
      ]);
      const {warnings} = assertLinearChainSegment(config, [block0, block1, block2], envelopes, parentBlock);
      expect(warnings).toBeNull();
    });

    it("orphaned envelope - FULL then block references EMPTY hash, warns with orphaned envelope", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const envelope0 = makePayloadEnvelopeInput(block0, HASH_B);
      // block0 FULL: delivers HASH_B, but block1 references HASH_A (EMPTY variant)
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_A);
      const envelopes = new Map([[GLOAS_SLOT, envelope0]]);
      const {warnings} = assertLinearChainSegment(config, [block0, block1], envelopes, parentBlock);
      expect(warnings).toHaveLength(1);
      expect(warnings?.[0].slot).toBe(GLOAS_SLOT);
      expect(warnings?.[0].payloadEnvelopeInput).toBe(envelope0);
    });

    it("consecutive orphaned envelopes - two FULL slots, third block references original hash", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const envelope0 = makePayloadEnvelopeInput(block0, HASH_B);
      // block0 FULL → HASH_B, but block1 references HASH_A → orphan envelope0, fallback to HASH_A
      const block1 = makeBlockInput(GLOAS_SLOT + 1, blockRoot(block0), HASH_A);
      const envelope1 = makePayloadEnvelopeInput(block1, HASH_C);
      // block1 FULL → HASH_C, but block2 references HASH_A → orphan envelope1, fallback to HASH_A
      const block2 = makeBlockInput(GLOAS_SLOT + 2, blockRoot(block1), HASH_A);
      const envelopes = new Map([
        [GLOAS_SLOT, envelope0],
        [GLOAS_SLOT + 1, envelope1],
      ]);
      const {warnings} = assertLinearChainSegment(config, [block0, block1, block2], envelopes, parentBlock);
      expect(warnings).toHaveLength(2);
      expect(warnings?.[0].slot).toBe(GLOAS_SLOT);
      expect(warnings?.[0].payloadEnvelopeInput).toBe(envelope0);
      expect(warnings?.[1].slot).toBe(GLOAS_SLOT + 1);
      expect(warnings?.[1].payloadEnvelopeInput).toBe(envelope1);
    });
  });

  describe("envelope beacon_block_root validation", () => {
    it("ok - envelope beaconBlockRoot matches the block's hash tree root", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      const envelopes = new Map([[GLOAS_SLOT, makePayloadEnvelopeInput(block0, HASH_B)]]);
      const {warnings} = assertLinearChainSegment(config, [block0], envelopes, parentBlock);
      expect(warnings).toBeNull();
    });

    it("ENVELOPE_BEACON_BLOCK_ROOT_MISMATCH - envelope references a different block root", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // Build a PayloadEnvelopeInput for a *different* block (different parentRoot → different HTR)
      // so its stored beaconBlockRoot won't match block0's root
      const blockOther = makeBlockInput(GLOAS_SLOT, HASH_WRONG, HASH_A);
      const wrongInput = makePayloadEnvelopeInput(blockOther, HASH_B);
      const envelopes = new Map([[GLOAS_SLOT, wrongInput]]);
      expectThrowsLodestarError(
        () => assertLinearChainSegment(config, [block0], envelopes, parentBlock),
        BlockErrorCode.ENVELOPE_BEACON_BLOCK_ROOT_MISMATCH
      );
    });

    it("ok - envelope for a slot not in segment is silently ignored", () => {
      const block0 = makeBlockInput(GLOAS_SLOT, new Uint8Array(32), HASH_A);
      // Orphan PayloadEnvelopeInput for a slot outside the segment — no error expected
      const orphanBlock = makeBlockInput(GLOAS_SLOT + 99, new Uint8Array(32), HASH_A);
      const orphanInput = makePayloadEnvelopeInput(orphanBlock, HASH_B);
      const envelopes = new Map([[GLOAS_SLOT + 99, orphanInput]]);
      const {warnings} = assertLinearChainSegment(config, [block0], envelopes, parentBlock);
      expect(warnings).toBeNull();
    });
  });
});
