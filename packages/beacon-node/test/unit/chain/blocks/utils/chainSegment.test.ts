import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
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

  function gloasBlockInput(slot: Slot, parentRoot: Uint8Array, bidParentBlockHash: Uint8Array): BlockInputNoData {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = bidParentBlockHash;
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
      timeCreatedSec: seenTimestampSec,
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

  it("throws PARENT_PAYLOAD_UNKNOWN when FULL envelope's payload hash does not match next block's bid parentBlockHash", () => {
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
      BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
    );
  });

  it("passes for an EMPTY→EMPTY segment (no envelopes) without a parent", () => {
    // First block's bid check is skipped (currentExecHash starts null); from there no envelopes,
    // so chain stays "unseeded" — no further checks can fire.
    const bi1 = gloasBlockInput(10, Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb));
    const b1Root = ssz.gloas.BeaconBlock.hashTreeRoot(bi1.getBlock().message as gloas.BeaconBlock);
    const bi2 = gloasBlockInput(11, b1Root, Buffer.alloc(32, 0xcc));

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
});
