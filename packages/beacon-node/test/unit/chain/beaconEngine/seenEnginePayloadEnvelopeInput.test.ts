import {beforeEach, describe, expect, it, vi} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {IBeaconEngineDb} from "../../../../src/db/interface.js";
import {MAX_LOOK_AHEAD_EPOCHS} from "../../../../src/sync/constants.js";
import {zeroProtoBlock} from "../../../utils/state.js";

describe("SeenEnginePayloadEnvelopeInput", () => {
  const config = getConfig(ForkName.gloas);
  const getBlock = vi.fn<IBeaconEngineDb["block"]["get"]>();
  const forkChoice = {
    hasBlockHex: vi.fn().mockReturnValue(true),
    isDescendant: vi.fn().mockReturnValue(false),
    getFinalizedCheckpoint: vi
      .fn()
      .mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: zeroProtoBlock.blockRoot}),
  };
  let cache: SeenEnginePayloadEnvelopeInput;

  beforeEach(() => {
    getBlock.mockReset().mockResolvedValue(null);
    forkChoice.hasBlockHex.mockReset().mockReturnValue(true);
    forkChoice.isDescendant.mockReset().mockReturnValue(false);
    forkChoice.getFinalizedCheckpoint
      .mockReset()
      .mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: zeroProtoBlock.blockRoot});
    cache = new SeenEnginePayloadEnvelopeInput({config, forkChoice, db: {block: {get: getBlock}}});
  });

  function blockProps(slot: number) {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = 7;
    block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = [Buffer.alloc(48, 1)];
    return {
      block,
      blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.gloas,
    };
  }

  it("retains bid commitments and an envelope without data availability state", () => {
    const props = blockProps(1);
    const input = cache.add(props);
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = fromHex(props.blockRootHex);
    input.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 1});

    expect(input.proposerIndex).toBe(7);
    expect(input.getBlobKzgCommitments()).toEqual(
      props.block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments
    );
    expect(input.getPayloadEnvelope()).toBe(envelope);
    expect(input.getPayloadEnvelopeSource().source).toBe(PayloadEnvelopeInputSource.gossip);
    expect(input).not.toHaveProperty("hasAllData");
    expect(input).not.toHaveProperty("columnsCache");
    expect(cache.add(props)).toBe(input);
    expect(cache.size()).toBe(1);
  });

  it("reloads evicted block metadata once for concurrent consumers", async () => {
    const props = blockProps(1);
    const maximum = (MAX_LOOK_AHEAD_EPOCHS + 1) * SLOTS_PER_EPOCH;
    for (let slot = 1; slot <= maximum + 1; slot++) cache.add(blockProps(slot));
    expect(cache.size()).toBe(maximum);
    expect(cache.get(props.blockRootHex)).toBeUndefined();
    getBlock.mockResolvedValue(props.block);
    const [a, b] = await Promise.all([cache.getOrReload(props.blockRootHex), cache.getOrReload(props.blockRootHex)]);
    expect(a).toBeDefined();
    expect(b).toBe(a);
    expect(a?.hasPayloadEnvelope()).toBe(false);
    expect(getBlock).toHaveBeenCalledExactlyOnceWith(fromHex(props.blockRootHex));
    expect(cache.get(props.blockRootHex)).toBe(a);
    expect(cache.size()).toBe(maximum);
  });

  it("does not reload a block absent from fork choice", async () => {
    forkChoice.hasBlockHex.mockReturnValue(false);
    expect(await cache.getOrReload(blockProps(1).blockRootHex)).toBeUndefined();
    expect(getBlock).not.toHaveBeenCalled();
  });

  it("does not reinsert a block finalized during a DB reload", async () => {
    const props = blockProps(1);
    const read = defer<typeof props.block>();
    getBlock.mockReturnValue(read.promise);
    const reloading = cache.getOrReload(props.blockRootHex);
    const checkpoint = {epoch: 1, root: Buffer.alloc(32), rootHex: zeroProtoBlock.blockRoot};
    forkChoice.getFinalizedCheckpoint.mockReturnValue(checkpoint);
    cache.pruneFinalized(checkpoint);
    read.resolve(props.block);
    expect(await reloading).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("retains pending branches and prunes FULL ancestors below the parent", () => {
    const props = blockProps(1);
    cache.add(props);
    const parent = {...zeroProtoBlock, slot: 3, payloadStatus: PayloadStatus.FULL};
    cache.pruneBelowParent(parent);
    expect(cache.get(props.blockRootHex)).toBeDefined();
    forkChoice.isDescendant.mockReturnValue(true);
    cache.pruneBelowParent(parent);
    expect(cache.get(props.blockRootHex)).toBeUndefined();
    expect(forkChoice.isDescendant).toHaveBeenLastCalledWith(
      props.blockRootHex,
      PayloadStatus.FULL,
      parent.blockRoot,
      PayloadStatus.FULL
    );
  });

  it("prunes only entries below the finalized epoch boundary", () => {
    const old = blockProps(SLOTS_PER_EPOCH - 1);
    const current = blockProps(SLOTS_PER_EPOCH);
    cache.add(old);
    cache.add(current);
    cache.pruneFinalized({epoch: 1, root: Buffer.alloc(32), rootHex: zeroProtoBlock.blockRoot});
    expect(cache.get(old.blockRootHex)).toBeUndefined();
    expect(cache.get(current.blockRootHex)).toBeDefined();
  });

  it("removes the invalid envelope without evicting a different cached candidate", () => {
    const props = blockProps(1);
    const input = cache.add(props);
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = fromHex(props.blockRootHex);
    input.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 1});
    const other = ssz.gloas.SignedExecutionPayloadEnvelope.clone(envelope);
    other.signature = Buffer.alloc(96, 1);
    cache.removeInvalid(other);
    expect(cache.get(props.blockRootHex)).toBe(input);
    cache.removeInvalid(ssz.gloas.SignedExecutionPayloadEnvelope.clone(envelope));
    expect(cache.get(props.blockRootHex)).toBeUndefined();
  });
});
