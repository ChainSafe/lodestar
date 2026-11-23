import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView, IBeaconStateViewGloas} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputColumns, BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadError, PayloadErrorCode, PayloadErrorType} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {DataColumnSidecarErrorCode} from "../../../../src/chain/errors/index.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {Batch} from "../../../../src/sync/range/batch.js";
import {SyncChain} from "../../../../src/sync/range/chain.js";
import {RangeSync} from "../../../../src/sync/range/range.js";
import {
  DownloadByRangeErrorCode,
  cacheByRangeResponses,
  downloadByRange,
} from "../../../../src/sync/utils/downloadByRange.js";
import {RangeSyncType} from "../../../../src/sync/utils/remoteSyncType.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
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

vi.mock("../../../../src/sync/utils/downloadByRange.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../../src/sync/utils/downloadByRange.js")>()),
  downloadByRange: vi.fn(),
  cacheByRangeResponses: vi.fn(),
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
      latestBlockHeader: ssz.phase0.BeaconBlockHeader.defaultValue(),
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
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.beaconBlockRoot = blockRoot;
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

describe.each([{disableProcessAsChainSegment: false}, {disableProcessAsChainSegment: true}])(
  "sync / range / invalid payload envelope, disableProcessAsChainSegment=$disableProcessAsChainSegment",
  (opts) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it.each<{errorType: PayloadErrorType; evicted: boolean}>([
      {
        errorType: {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: "parent_beacon_block_root mismatch"},
        evicted: true,
      },
      {
        errorType: {
          code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
          execStatus: ExecutionPayloadStatus.INVALID,
          errorMessage: "invalid payload",
        },
        evicted: true,
      },
      {
        errorType: {
          code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
          execStatus: ExecutionPayloadStatus.ELERROR,
          errorMessage: "execution engine offline",
        },
        evicted: false,
      },
    ])("payload error $errorType.code evicts the cached envelope: $evicted", async ({errorType, evicted}) => {
      const gloasConfig = createChainForkConfig({...config, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
      const chain = getMockedBeaconChain({config: gloasConfig});
      chain.getHeadState.mockReturnValue({
        forkName: ForkName.gloas,
        latestBlockHeader: ssz.phase0.BeaconBlockHeader.defaultValue(),
        latestExecutionPayloadBid: ssz.gloas.ExecutionPayloadBid.defaultValue(),
      } as IBeaconStateViewGloas);
      const rangeSync = new RangeSync(
        {chain, network: getMockedNetwork(), config: chain.config, logger: chain.logger, metrics: null},
        opts
      );
      const localStatus = ssz.fulu.Status.defaultValue();
      rangeSync.addPeer(validPeerIdStr, localStatus, {...localStatus, finalizedEpoch: 1});
      const {processChainSegment} = vi.mocked(SyncChain).mock.calls[0][3];

      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 1;
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
        sampledColumns: [],
        custodyColumns: [],
        daOutOfRange: false,
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: 0,
      });
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.beaconBlockRoot = blockRoot;
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 1});

      const error = new PayloadError(payloadInput, errorType);
      chain.processChainSegment = vi.fn().mockRejectedValue(error);
      chain.processExecutionPayload = vi.fn().mockRejectedValue(error);

      await expect(
        processChainSegment([blockInput], new Map([[block.message.slot, payloadInput]]), RangeSyncType.Head)
      ).rejects.toBe(error);

      if (evicted) {
        expect(chain.seenPayloadEnvelopeInputCache.removeInvalid).toHaveBeenCalledExactlyOnceWith(payloadInput);
      } else {
        expect(chain.seenPayloadEnvelopeInputCache.removeInvalid).not.toHaveBeenCalled();
      }
    });
  }
);

describe("sync / range / column header signature mismatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each<{
    verdict: string;
    mockVerify: (verify: MockedBeaconChain["bls"]["verifySignatureSets"]) => void;
    error: Record<string, unknown>;
    removed: ("poisoned" | "sibling")[];
  }>([
    {
      verdict: "valid",
      mockVerify: (verify) => verify.mockResolvedValue(true),
      error: {code: DataColumnSidecarErrorCode.INCORRECT_BLOCK},
      removed: [],
    },
    {
      verdict: "invalid",
      mockVerify: (verify) => verify.mockResolvedValue(false),
      error: {code: DownloadByRangeErrorCode.INVALID_CACHED_BLOCK, blockPeer: "attacker"},
      removed: ["poisoned", "sibling"],
    },
    {
      verdict: "unverifiable",
      mockVerify: (verify) => verify.mockRejectedValue(new Error("no pubkey")),
      error: {code: DownloadByRangeErrorCode.INVALID_CACHED_BLOCK, blockPeer: undefined},
      removed: ["poisoned"],
    },
  ])("cached block signature $verdict", async ({verdict, mockVerify, error, removed}) => {
    const forkConfig = createChainForkConfig({...config, FULU_FORK_EPOCH: 0});
    const beaconConfig = createBeaconConfig(forkConfig, ZERO_HASH);
    const chain = getMockedBeaconChain({config: beaconConfig});
    chain.getHeadState.mockReturnValue({forkName: ForkName.fulu} as IBeaconStateView);
    const rangeSync = new RangeSync({
      chain,
      network: getMockedNetwork(),
      config: beaconConfig,
      logger: chain.logger,
      metrics: null,
    });
    const localStatus = ssz.fulu.Status.defaultValue();
    rangeSync.addPeer(validPeerIdStr, localStatus, {...localStatus, finalizedEpoch: 1});
    const {downloadByRange: downloadBatch} = vi.mocked(SyncChain).mock.calls[0][3];

    function createBlockInput(slot: number, peerIdStr: string): BlockInputColumns {
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      return BlockInputColumns.createFromBlock({
        block,
        blockRootHex: toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message)),
        forkName: ForkName.fulu,
        daOutOfRange: false,
        source: BlockInputSource.byRange,
        seenTimestampSec: 0,
        peerIdStr,
        sampledColumns: [0],
        custodyColumns: [0],
      });
    }
    const poisoned = createBlockInput(1, "attacker");
    const sibling = createBlockInput(2, "attacker");
    const other = createBlockInput(3, "honest");
    const columnSidecar = ssz.fulu.DataColumnSidecar.defaultValue();
    columnSidecar.signedBlockHeader.signature = Buffer.alloc(96, 0xbb);

    vi.mocked(downloadByRange).mockResolvedValue({result: {responses: {}, payloadEnvelopes: null}, warnings: null});
    vi.mocked(cacheByRangeResponses).mockReturnValue({
      blocks: [poisoned, sibling, other],
      payloadEnvelopes: null,
      signatureMismatch: {blockInput: poisoned, columnSidecar},
    });
    chain.seenBlockInputCache.get.mockImplementation((root) =>
      [poisoned, sibling, other].find((b) => b.blockRootHex === root)
    );
    mockVerify(chain.bls.verifySignatureSets);

    const batch = {
      getBlocks: () => [],
      getRequestsForPeer: () => ({}),
      getPayloadEnvelopes: () => null,
    } as unknown as Batch;
    const peer = {peerId: "honest", client: "lodestar", custodyColumns: []};

    await expect(downloadBatch(peer, batch, RangeSyncType.Finalized)).rejects.toMatchObject({type: error});

    if (verdict === "valid") {
      expect(chain.seenBlockInputCache.markVerifiedProposerSignature).toHaveBeenCalledExactlyOnceWith(
        poisoned.slot,
        poisoned.blockRootHex,
        poisoned.getBlock().signature
      );
    }
    const removedRoots = {poisoned: poisoned.blockRootHex, sibling: sibling.blockRootHex};
    expect(chain.seenBlockInputCache.remove.mock.calls.map(([root]) => root)).toEqual(
      removed.map((name) => removedRoots[name])
    );
  });
});
