import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName, ForkSeq} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {VerifiedBlockBundle, importBlock} from "../../../../src/chain/beaconEngine/importBlock.js";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {
  BlockInputBlobs,
  BlockInputNoData,
  BlockInputPreData,
} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {writeBlockInputToDb} from "../../../../src/chain/blocks/writeBlockInputToDb.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedState, zeroProtoBlock} from "../../../utils/state.js";

describe("BeaconEngine block persistence", () => {
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
  const blockBytes = ssz.phase0.SignedBeaconBlock.serialize(block);
  const blockInput = BlockInputPreData.createFromBlock({
    block,
    blockRootHex: toRootHex(root),
    forkName: ForkName.phase0,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
  });
  let chain: ReturnType<typeof getMockedBeaconChain>;
  let bundle: VerifiedBlockBundle;
  const putBinary = vi.fn();
  const reachedForkChoice = new Error("reached fork choice");

  beforeEach(() => {
    chain = getMockedBeaconChain();
    putBinary.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(chain, "db", {value: {block: {putBinary}}});
    Object.defineProperty(chain.beaconEngine, "checkpointBalancesCache", {value: {processState: vi.fn()}});
    chain.forkChoice.getTime = vi.fn().mockReturnValue(0);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: Buffer.alloc(32),
      rootHex: toRootHex(Buffer.alloc(32)),
    });
    chain.forkChoice.onBlock = vi.fn(() => {
      throw reachedForkChoice;
    });
    chain.regen.processState = vi.fn();
    bundle = {
      blockInput,
      blockBytes,
      postState: new BeaconStateView(generateCachedState()),
      executionStatus: ExecutionStatus.PreMerge,
      indexedAttestations: [],
      proposerBalanceDelta: 0,
      parentBlockSlot: 0,
      seenTimestampSec: 0,
    };
  });

  afterEach(() => vi.restoreAllMocks());

  it("seeds Gloas bid metadata before notifying block consumers", async () => {
    const gloasBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    gloasBlock.message.slot = 1;
    const rootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(gloasBlock.message));
    vi.spyOn(chain.config, "getForkSeq").mockReturnValue(ForkSeq.gloas);
    vi.spyOn(chain.config, "getForkName").mockReturnValue(ForkName.gloas);
    vi.spyOn(chain.config, "getForkTypes").mockReturnValue(
      createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32)).getForkTypes(1)
    );
    const cache = new SeenEnginePayloadEnvelopeInput({
      config: chain.config,
      forkChoice: chain.forkChoice,
      db: {block: {get: vi.fn()}},
    });
    Object.defineProperty(chain.beaconEngine, "seenPayloadEnvelopeInputCache", {value: cache});
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    chain.forkChoice.onBlock = vi.fn().mockReturnValue({...zeroProtoBlock, blockRoot: rootHex, slot: 1});
    const afterCache = new Error("stop after cache insertion");
    chain.regen.processState.mockImplementation(() => {
      expect(cache.get(rootHex)?.getBid()).toEqual(gloasBlock.message.body.signedExecutionPayloadBid.message);
      throw afterCache;
    });
    const input = BlockInputNoData.createFromBlock({
      block: gloasBlock,
      blockRootHex: rootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.byRange,
      seenTimestampSec: 0,
    });
    await expect(
      importBlock.call(
        chain.beaconEngine,
        {...bundle, blockInput: input, blockBytes: ssz.gloas.SignedBeaconBlock.serialize(gloasBlock)},
        DataAvailabilityStatus.Available,
        {}
      )
    ).rejects.toBe(afterCache);
    expect(chain.regen.processState).toHaveBeenCalledOnce();
  });

  it("waits for the block write before exposing the block to fork choice", async () => {
    const write = defer<void>();
    putBinary.mockReturnValue(write.promise);
    const importing = importBlock.call(chain.beaconEngine, bundle, DataAvailabilityStatus.PreData, {});
    const result = expect(importing).rejects.toBe(reachedForkChoice);
    expect(putBinary).toHaveBeenCalledExactlyOnceWith(root, blockBytes);
    expect(chain.forkChoice.onBlock).not.toHaveBeenCalled();
    write.resolve();
    await result;
    expect(chain.forkChoice.onBlock).toHaveBeenCalledOnce();
  });

  it("does not import into fork choice when the block write fails", async () => {
    const error = new Error("DB write failed");
    putBinary.mockRejectedValue(error);
    await expect(importBlock.call(chain.beaconEngine, bundle, DataAvailabilityStatus.PreData, {})).rejects.toBe(error);
    expect(chain.forkChoice.onBlock).not.toHaveBeenCalled();
    expect(chain.regen.processState).not.toHaveBeenCalled();
  });

  it("persists blob data without writing a beacon block", async () => {
    const blobSidecars = {add: vi.fn().mockResolvedValue(undefined)};
    Object.assign(chain.beaconEngine.db, {blobSidecars});
    const blobBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
    const blobBlockRoot = ssz.deneb.BeaconBlock.hashTreeRoot(blobBlock.message);
    const input = BlockInputBlobs.createFromBlock({
      block: blobBlock,
      blockRootHex: toRootHex(blobBlockRoot),
      forkName: ForkName.deneb,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    await writeBlockInputToDb.call(chain, input);
    expect(blobSidecars.add).toHaveBeenCalledExactlyOnceWith({blockRoot: blobBlockRoot, slot: 0, blobSidecars: []});
    expect(putBinary).not.toHaveBeenCalled();
  });

  it("does not write a beacon block from the facade data queue", async () => {
    await writeBlockInputToDb.call(chain, blockInput);
    expect(putBinary).not.toHaveBeenCalled();
  });
});
