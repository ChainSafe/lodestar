import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {IBeaconStateViewGloas} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {SyncChain} from "../../../../src/sync/range/chain.js";
import {RangeSync} from "../../../../src/sync/range/range.js";
import {RangeSyncType} from "../../../../src/sync/utils/remoteSyncType.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {getMockedNetwork} from "../../../mocks/mockedNetwork.js";
import {validPeerIdStr} from "../../../utils/peer.js";

vi.mock("../../../../src/sync/range/chain.js", () => ({
  SyncChain: vi.fn().mockImplementation(function MockedSyncChain(...args: ConstructorParameters<typeof SyncChain>) {
    return {
      firstBatchEpoch: args[0],
      target: args[1],
      syncType: args[2],
      peers: 1,
      addPeer: vi.fn(),
      startSyncing: vi.fn(),
    };
  }),
}));

describe("sync / range / per-block processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {hasEnvelope: false, blobCount: 0},
    {hasEnvelope: false, blobCount: 1},
    {hasEnvelope: true, blobCount: 0},
    {hasEnvelope: true, blobCount: 1},
  ])("hasEnvelope=$hasEnvelope, blobCount=$blobCount", async ({hasEnvelope, blobCount}) => {
    const gloasConfig = createChainForkConfig({...config, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
    const chain = getMockedBeaconChain({config: gloasConfig});
    chain.processExecutionPayload = vi.fn().mockResolvedValue(undefined);
    chain.getHeadState.mockReturnValue({
      forkName: ForkName.gloas,
      latestExecutionPayloadBid: ssz.gloas.ExecutionPayloadBid.defaultValue(),
    } as IBeaconStateViewGloas);
    const rangeSync = new RangeSync(
      {chain, network: getMockedNetwork(), config: chain.config, logger: chain.logger, metrics: null},
      {disableProcessAsChainSegment: true}
    );
    const localStatus = ssz.fulu.Status.defaultValue();
    rangeSync.addPeer(validPeerIdStr, localStatus, {...localStatus, finalizedEpoch: 1});
    expect(SyncChain).toHaveBeenCalledOnce();
    const {processChainSegment} = vi.mocked(SyncChain).mock.calls[0][3];

    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = Array.from({length: blobCount}, () =>
      Buffer.alloc(48, 0x77)
    );
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);
    const blockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.byRange,
      seenTimestampSec: 0,
    });
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      sampledColumns: [0],
      custodyColumns: [0],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec: 0,
    });
    if (hasEnvelope) {
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = blockRoot;
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 1});
    }

    await processChainSegment([blockInput], new Map([[block.message.slot, payloadInput]]), RangeSyncType.Finalized);

    expect(chain.processBlock).toHaveBeenCalledExactlyOnceWith(
      blockInput,
      expect.objectContaining({fromRangeSync: true})
    );
    if (hasEnvelope) {
      expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
      expect(chain.processBlock.mock.invocationCallOrder[0]).toBeLessThan(
        chain.processExecutionPayload.mock.invocationCallOrder[0]
      );
    } else {
      expect(chain.processExecutionPayload).not.toHaveBeenCalled();
    }
  });
});
