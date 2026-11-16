import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, Slot, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {assertLinearChainSegment} from "../../../../../src/chain/blocks/utils/chainSegment.js";
import {BlockError, BlockErrorCode} from "../../../../../src/chain/errors/index.js";
import {expectThrowsLodestarError} from "../../../../utils/errors.js";

describe("chain / blocks / utils / chainSegment / assertLinearChainSegment with parentBlock=null", () => {
  const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const seenTimestampSec = Date.now() / 1000;

  function gloasBlockInput(
    slot: Slot,
    parentRoot: Uint8Array,
    bidParentPayloadRoot: Uint8Array,
    bidPayloadRoot?: Uint8Array
  ): BlockInputNoData {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentPayloadRoot = bidParentPayloadRoot;
    // The bid commits to its own payload's root; PayloadEnvelopeInput.getPayloadRootHex() reads it.
    if (bidPayloadRoot !== undefined) {
      block.message.body.signedExecutionPayloadBid.message.payloadRoot = bidPayloadRoot;
    }
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    return BlockInputNoData.createFromBlock({
      block: block as SignedBeaconBlock<typeof ForkName.gloas>,
      blockRootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      seenTimestampSec,
      source: BlockInputSource.byRange,
      peerIdStr: "peer",
    });
  }

  /** The segment is tracked by the payload root the bid commits to, the envelope only has to reference the block */
  function payloadInputFor(blockInput: BlockInputNoData): PayloadEnvelopeInput {
    const block = blockInput.getBlock();
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex: blockInput.blockRootHex,
      block: block as SignedBeaconBlock<typeof ForkName.gloas>,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec,
      source: PayloadEnvelopeInputSource.byRange,
      daOutOfRange: false,
    });
    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    envelope.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message as gloas.BeaconBlock);
    envelope.payload.slotNumber = block.message.slot;
    payloadInput.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec,
      peerIdStr: "peer",
    });
    return payloadInput;
  }

  it("returns no warnings for an empty segment", () => {
    const {warnings} = assertLinearChainSegment(config, [], null, null);
    expect(warnings).toBe(null);
  });

  it("passes for a single-block segment with parentBlock=null (no checks fire)", () => {
    const bi = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb));
    const {warnings} = assertLinearChainSegment(config, [bi], null, null);
    expect(warnings).toBe(null);
  });

  it("throws NON_LINEAR_PARENT_ROOTS when block[1].parentRoot does not match block[0].root", () => {
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb));
    const bi2 = gloasBlockInput(11, Buffer.alloc(32, 0xcc), Buffer.alloc(32, 0xbb));
    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1, bi2], null, null),
      BlockErrorCode.NON_LINEAR_PARENT_ROOTS
    );
  });

  it("throws NON_LINEAR_SLOTS when slots are not strictly increasing", () => {
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb));
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(10, b1Root, Buffer.alloc(32, 0xbb));
    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1, bi2], null, null),
      BlockErrorCode.NON_LINEAR_SLOTS
    );
  });

  it("throws NON_LINEAR_PAYLOAD_ROOTS when a mid-segment block's bid parentPayloadRoot matches neither the previous block's FULL payload root nor the root it built on", () => {
    const firstParentPayloadRoot = Buffer.alloc(32, 0x11);
    const firstPayloadRoot = Buffer.alloc(32, 0x22);
    const mismatchedParentPayloadRoot = Buffer.alloc(32, 0x99);

    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), firstParentPayloadRoot, firstPayloadRoot);
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, mismatchedParentPayloadRoot);

    const pi1 = payloadInputFor(bi1);
    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[10, pi1]]);

    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1, bi2], envelopes, null),
      new BlockError(bi2.getBlock(), {
        code: BlockErrorCode.NON_LINEAR_PAYLOAD_ROOTS,
        parentPayloadRoot: toRootHex(mismatchedParentPayloadRoot),
        expectedPayloadRoot: toRootHex(firstPayloadRoot),
      })
    );
  });

  it("passes for an EMPTY→EMPTY segment (no envelopes) without a parent", () => {
    // The tracked payload root seeds from bi1's bid; with no envelopes it never advances, so bi2 must
    // build on that same payload (an EMPTY block does not advance the execution chain).
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb));
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, Buffer.alloc(32, 0xbb));

    const {warnings} = assertLinearChainSegment(config, [bi1, bi2], null, null);
    expect(warnings).toBe(null);
  });

  it("passes for a valid FULL→FULL segment", () => {
    const payloadRoot1 = Buffer.alloc(32, 0x11);
    const payloadRoot2 = Buffer.alloc(32, 0x22);

    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0x99), payloadRoot1);
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, payloadRoot1, payloadRoot2);

    const pi1 = payloadInputFor(bi1);
    const pi2 = payloadInputFor(bi2);
    const envelopes = new Map<Slot, PayloadEnvelopeInput>([
      [10, pi1],
      [11, pi2],
    ]);

    const {warnings} = assertLinearChainSegment(config, [bi1, bi2], envelopes, null);
    expect(warnings).toBe(null);
  });

  it("passes when the FIRST block's payload is orphaned by the next block (range batch boundary)", () => {
    // Regression for the range-sync wedge: a batch starts at the block whose payload is orphaned.
    // bi1 builds on grandparent payload G and reveals payload P; bi2 builds on G again (skipping P),
    // revealing bi1's payload as orphaned. Seeding the tracked root from bi1's bid lets the fallback recover.
    const grandparentPayloadRoot = Buffer.alloc(32, 0x4d); // G: the payload bi1 (and bi2) build on
    const bi1PayloadRoot = Buffer.alloc(32, 0x66); // P: bi1's revealed (but orphaned) payload

    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), grandparentPayloadRoot, bi1PayloadRoot);
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, grandparentPayloadRoot);

    const pi1 = payloadInputFor(bi1);
    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[10, pi1]]);

    const {warnings} = assertLinearChainSegment(config, [bi1, bi2], envelopes, null);
    expect(warnings?.map((w) => w.slot)).toEqual([10]);
  });
});

describe("chain / blocks / utils / chainSegment / assertLinearChainSegment boundary (parentBlock provided)", () => {
  const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const seenTimestampSec = Date.now() / 1000;

  function gloasBlockInput(
    slot: Slot,
    parentRoot: Uint8Array,
    bidParentPayloadRoot: Uint8Array,
    bidPayloadRoot?: Uint8Array
  ): BlockInputNoData {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentPayloadRoot = bidParentPayloadRoot;
    // The bid commits to its own payload's root; PayloadEnvelopeInput.getPayloadRootHex() reads it.
    if (bidPayloadRoot !== undefined) {
      block.message.body.signedExecutionPayloadBid.message.payloadRoot = bidPayloadRoot;
    }
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    return BlockInputNoData.createFromBlock({
      block: block as SignedBeaconBlock<typeof ForkName.gloas>,
      blockRootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      seenTimestampSec,
      source: BlockInputSource.byRange,
      peerIdStr: "peer",
    });
  }

  /** The segment is tracked by the payload root the bid commits to, the envelope only has to reference the block */
  function payloadInputFor(blockInput: BlockInputNoData): PayloadEnvelopeInput {
    const block = blockInput.getBlock();
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex: blockInput.blockRootHex,
      block: block as SignedBeaconBlock<typeof ForkName.gloas>,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec,
      source: PayloadEnvelopeInputSource.byRange,
      daOutOfRange: false,
    });
    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    envelope.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message as gloas.BeaconBlock);
    envelope.payload.slotNumber = block.message.slot;
    payloadInput.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec,
      peerIdStr: "peer",
    });
    return payloadInput;
  }

  it("throws PARENT_PAYLOAD_UNKNOWN when the first block's bid parentPayloadRoot mismatches the fork-choice parent (i === 0)", () => {
    const parentLatestPayloadRoot = Buffer.alloc(32, 0x11);
    const mismatchedBidRoot = Buffer.alloc(32, 0x22);
    const parentRoot = Buffer.alloc(32, 0xaa);
    const bi1 = gloasBlockInput(10, parentRoot, mismatchedBidRoot);
    const parentBlock = {
      slot: 9,
      payloadStatus: PayloadStatus.EMPTY,
      parentPayloadRoot: toRootHex(parentLatestPayloadRoot),
      payloadRoot: toRootHex(Buffer.alloc(32, 0x33)),
    } as unknown as ProtoBlock;

    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1], null, parentBlock),
      new BlockError(bi1.getBlock(), {
        code: BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
        parentRoot: toRootHex(parentRoot),
        parentPayloadRoot: toRootHex(mismatchedBidRoot),
      })
    );
  });

  it("takes the parent's own payload root as its latest payload root only when the parent is FULL", () => {
    const grandparentPayloadRoot = Buffer.alloc(32, 0x11);
    const parentOwnPayloadRoot = Buffer.alloc(32, 0x22);
    const parentBlock = (payloadStatus: PayloadStatus): ProtoBlock =>
      ({
        slot: 9,
        payloadStatus,
        parentPayloadRoot: toRootHex(grandparentPayloadRoot),
        payloadRoot: toRootHex(parentOwnPayloadRoot),
      }) as unknown as ProtoBlock;
    const onFull = gloasBlockInput(10, Buffer.alloc(32, 0xaa), parentOwnPayloadRoot);
    const onEmpty = gloasBlockInput(10, Buffer.alloc(32, 0xaa), grandparentPayloadRoot);

    expect(assertLinearChainSegment(config, [onFull], null, parentBlock(PayloadStatus.FULL)).warnings).toBe(null);
    expect(assertLinearChainSegment(config, [onEmpty], null, parentBlock(PayloadStatus.EMPTY)).warnings).toBe(null);
    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [onEmpty], null, parentBlock(PayloadStatus.FULL)),
      BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
    );
    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [onFull], null, parentBlock(PayloadStatus.EMPTY)),
      BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
    );
  });

  it("does not throw PARENT_PAYLOAD_UNKNOWN when the parent has no payload roots (pre-gloas parent)", () => {
    // A pre-gloas ProtoBlock has null payload roots: nothing to compare the first block's bid against.
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0x22));
    const parentBlock = {
      slot: 9,
      payloadStatus: PayloadStatus.FULL,
      parentPayloadRoot: null,
      payloadRoot: null,
    } as unknown as ProtoBlock;

    const {warnings} = assertLinearChainSegment(config, [bi1], null, parentBlock);
    expect(warnings).toBe(null);
  });

  it("validates a checkpoint-sync anchor: first block builds on the anchor's own (advanced) payload", () => {
    // The anchor is stored PENDING, so its latest payload root is the inherited (grandparent) one; its own
    // payload arrives in this batch. The first block (slots 10-11 skipped) builds on the anchor's own payload.
    // The parent reference must advance from the envelope so the first-block check passes.
    const grandparentPayloadRoot = Buffer.alloc(32, 0x11); // the payload the anchor built on
    const anchorPayloadRoot = Buffer.alloc(32, 0x22); // anchor's own revealed payload
    const anchorInput = gloasBlockInput(9, Buffer.alloc(32, 0xdd), grandparentPayloadRoot, anchorPayloadRoot);
    const anchorPayload = payloadInputFor(anchorInput);
    const parentBlock = {
      slot: 9,
      blockRoot: anchorInput.blockRootHex,
      payloadStatus: PayloadStatus.PENDING,
      parentPayloadRoot: toRootHex(grandparentPayloadRoot),
      payloadRoot: toRootHex(anchorPayloadRoot),
    } as unknown as ProtoBlock;
    const bi1 = gloasBlockInput(12, Buffer.alloc(32, 0xaa), anchorPayloadRoot);

    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[9, anchorPayload]]);
    const {warnings} = assertLinearChainSegment(config, [bi1], envelopes, parentBlock);
    expect(warnings).toBe(null);
  });

  it("reports the parent's envelope as orphaned when the first block builds on the parent's EMPTY variant", () => {
    // Range sync batch starting at an already imported block whose late payload was orphaned, peers
    // still serve the envelope by range so it is in the batch but must not become the parent's latest payload
    const grandparentPayloadRoot = Buffer.alloc(32, 0x11); // the payload the parent built on (EMPTY variant)
    const orphanedPayloadRoot = Buffer.alloc(32, 0x22); // parent's own, orphaned payload
    const parentInput = gloasBlockInput(9, Buffer.alloc(32, 0xdd), grandparentPayloadRoot, orphanedPayloadRoot);
    const parentPayload = payloadInputFor(parentInput);
    const parentBlock = {
      slot: 9,
      blockRoot: parentInput.blockRootHex,
      payloadStatus: PayloadStatus.EMPTY,
      parentPayloadRoot: toRootHex(grandparentPayloadRoot),
      payloadRoot: toRootHex(orphanedPayloadRoot),
    } as unknown as ProtoBlock;
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), grandparentPayloadRoot);

    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[9, parentPayload]]);
    const {warnings} = assertLinearChainSegment(config, [bi1], envelopes, parentBlock);
    expect(warnings).toEqual([{slot: 9, payloadEnvelopeInput: parentPayload}]);
  });

  it("throws PARENT_PAYLOAD_UNKNOWN when the first block builds on neither the parent's latest payload nor its envelope", () => {
    const grandparentPayloadRoot = Buffer.alloc(32, 0x11);
    const parentPayloadRoot = Buffer.alloc(32, 0x22);
    const unknownPayloadRoot = Buffer.alloc(32, 0x33);
    const parentInput = gloasBlockInput(9, Buffer.alloc(32, 0xdd), grandparentPayloadRoot, parentPayloadRoot);
    const parentPayload = payloadInputFor(parentInput);
    const parentBlock = {
      slot: 9,
      blockRoot: parentInput.blockRootHex,
      payloadStatus: PayloadStatus.EMPTY,
      parentPayloadRoot: toRootHex(grandparentPayloadRoot),
      payloadRoot: toRootHex(parentPayloadRoot),
    } as unknown as ProtoBlock;
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), unknownPayloadRoot);

    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[9, parentPayload]]);
    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1], envelopes, parentBlock),
      BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
    );
  });

  it("throws ENVELOPE_BLOCK_ROOT_MISMATCH when the envelope at the parent's slot references another block", () => {
    const grandparentPayloadRoot = Buffer.alloc(32, 0x11);
    const siblingPayloadRoot = Buffer.alloc(32, 0x22);
    const parentInput = gloasBlockInput(9, Buffer.alloc(32, 0xdd), grandparentPayloadRoot);
    const parentBlock = {
      slot: 9,
      blockRoot: parentInput.blockRootHex,
      payloadStatus: PayloadStatus.EMPTY,
      parentPayloadRoot: toRootHex(grandparentPayloadRoot),
      payloadRoot: toRootHex(Buffer.alloc(32, 0x00)),
    } as unknown as ProtoBlock;
    // A different block at the parent's slot, peers serve its envelope for that slot
    const siblingInput = gloasBlockInput(9, Buffer.alloc(32, 0xee), grandparentPayloadRoot, siblingPayloadRoot);
    const siblingPayload = payloadInputFor(siblingInput);
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), grandparentPayloadRoot);

    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[9, siblingPayload]]);
    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1], envelopes, parentBlock),
      BlockErrorCode.ENVELOPE_BLOCK_ROOT_MISMATCH
    );
  });
});
