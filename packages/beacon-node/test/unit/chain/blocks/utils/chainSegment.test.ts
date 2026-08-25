import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, Slot, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {assertLinearChainSegment} from "../../../../../src/chain/blocks/utils/chainSegment.js";
import {BlockErrorCode} from "../../../../../src/chain/errors/index.js";
import {expectThrowsLodestarError} from "../../../../utils/errors.js";

describe("chain / blocks / utils / chainSegment / assertLinearChainSegment with parentBlock=null", () => {
  const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const seenTimestampSec = Date.now() / 1000;

  function gloasBlockInput(
    slot: Slot,
    parentRoot: Uint8Array,
    bidParentBlockHash: Uint8Array,
    bidBlockHash?: Uint8Array
  ): BlockInputNoData {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = bidParentBlockHash;
    // The bid commits to its own payload's block hash; PayloadEnvelopeInput.getBlockHashHex() reads it.
    if (bidBlockHash !== undefined) {
      block.message.body.signedExecutionPayloadBid.message.blockHash = bidBlockHash;
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

  function payloadInputFor(blockInput: BlockInputNoData, payloadBlockHash: Uint8Array): PayloadEnvelopeInput {
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
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message as gloas.BeaconBlock);
    envelope.message.payload.slotNumber = block.message.slot;
    envelope.message.payload.blockHash = payloadBlockHash;
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

  it("throws NON_LINEAR_PAYLOAD_ROOTS when a mid-segment block's bid parentBlockHash does not match the previous block's FULL payload hash", () => {
    const firstExecHash = Buffer.alloc(32, 0x11);
    const correctNextExecHash = Buffer.alloc(32, 0x22);
    const mismatchedNextExecHash = Buffer.alloc(32, 0x99);

    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), firstExecHash);
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, mismatchedNextExecHash);

    const pi1 = payloadInputFor(bi1, correctNextExecHash);
    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[10, pi1]]);

    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1, bi2], envelopes, null),
      BlockErrorCode.NON_LINEAR_PAYLOAD_ROOTS
    );
  });

  it("passes for an EMPTY→EMPTY segment (no envelopes) without a parent", () => {
    // currentExecHash seeds from bi1's bid; with no envelopes it never advances, so bi2 must
    // build on that same EL head (an EMPTY block does not advance the execution chain).
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb));
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, Buffer.alloc(32, 0xbb));

    const {warnings} = assertLinearChainSegment(config, [bi1, bi2], null, null);
    expect(warnings).toBe(null);
  });

  it("passes for a valid FULL→FULL segment", () => {
    const exec1 = Buffer.alloc(32, 0x11);
    const exec2 = Buffer.alloc(32, 0x22);

    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0x99));
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, exec1);

    const pi1 = payloadInputFor(bi1, exec1);
    const pi2 = payloadInputFor(bi2, exec2);
    const envelopes = new Map<Slot, PayloadEnvelopeInput>([
      [10, pi1],
      [11, pi2],
    ]);

    const {warnings} = assertLinearChainSegment(config, [bi1, bi2], envelopes, null);
    expect(warnings).toBe(null);
  });

  it("passes when the FIRST block's payload is orphaned by the next block (range batch boundary)", () => {
    // Regression for the range-sync wedge: a batch starts at the block whose payload is orphaned.
    // bi1 builds on grandparent G and reveals payload P; bi2 builds on G again (skipping P),
    // revealing bi1's payload as orphaned. Pre-fix this threw NON_LINEAR_PAYLOAD_ROOTS because
    // prevExecHash was seeded null; seeding from bi1's bid lets the fallback recover.
    const grandparentHash = Buffer.alloc(32, 0x4d); // G — the EL head bi1 (and bi2) build on
    const bi1PayloadHash = Buffer.alloc(32, 0x66); // P — bi1's revealed (but orphaned) payload

    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), grandparentHash);
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, grandparentHash);

    const pi1 = payloadInputFor(bi1, bi1PayloadHash);
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
    bidParentBlockHash: Uint8Array,
    bidBlockHash?: Uint8Array
  ): BlockInputNoData {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = bidParentBlockHash;
    // The bid commits to its own payload's block hash; PayloadEnvelopeInput.getBlockHashHex() reads it.
    if (bidBlockHash !== undefined) {
      block.message.body.signedExecutionPayloadBid.message.blockHash = bidBlockHash;
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

  function payloadInputFor(blockInput: BlockInputNoData, payloadBlockHash: Uint8Array): PayloadEnvelopeInput {
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
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message as gloas.BeaconBlock);
    envelope.message.payload.slotNumber = block.message.slot;
    envelope.message.payload.blockHash = payloadBlockHash;
    payloadInput.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec,
      peerIdStr: "peer",
    });
    return payloadInput;
  }

  it("throws PARENT_PAYLOAD_UNKNOWN when the first block's bid parentBlockHash mismatches the fork-choice parent (i === 0)", () => {
    const parentExecHash = Buffer.alloc(32, 0x11);
    const mismatchedBidHash = Buffer.alloc(32, 0x22);
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), mismatchedBidHash);
    const parentBlock = {slot: 9, executionPayloadBlockHash: toRootHex(parentExecHash)} as unknown as ProtoBlock;

    expectThrowsLodestarError(
      () => assertLinearChainSegment(config, [bi1], null, parentBlock),
      BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
    );
  });

  it("does not throw PARENT_PAYLOAD_UNKNOWN when the parent has no EL head (pre-merge parent)", () => {
    // parentExecHash is null → nothing to compare the first block's bid against.
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0x22));
    const parentBlock = {slot: 9, executionPayloadBlockHash: null} as unknown as ProtoBlock;

    const {warnings} = assertLinearChainSegment(config, [bi1], null, parentBlock);
    expect(warnings).toBe(null);
  });

  it("validates a checkpoint-sync anchor: first block builds on the anchor's own (advanced) payload", () => {
    // The anchor is stored PENDING with the inherited/grandparent hash; its own payload arrives in
    // this batch. The first block (slots 10-11 skipped) builds on the anchor's own payload. The
    // parent reference must advance from the envelope so the first-block check passes.
    const grandparentHash = Buffer.alloc(32, 0x11); // anchor's stored (inherited) hash
    const anchorPayloadHash = Buffer.alloc(32, 0x22); // anchor's own revealed payload
    const parentBlock = {slot: 9, executionPayloadBlockHash: toRootHex(grandparentHash)} as unknown as ProtoBlock;

    const anchorInput = gloasBlockInput(9, Buffer.alloc(32, 0xdd), Buffer.alloc(32, 0x00), anchorPayloadHash);
    const anchorPayload = payloadInputFor(anchorInput, anchorPayloadHash);
    const bi1 = gloasBlockInput(12, Buffer.alloc(32, 0xaa), anchorPayloadHash);

    const envelopes = new Map<Slot, PayloadEnvelopeInput>([[9, anchorPayload]]);
    const {warnings} = assertLinearChainSegment(config, [bi1], envelopes, parentBlock);
    expect(warnings).toBe(null);
  });
});
