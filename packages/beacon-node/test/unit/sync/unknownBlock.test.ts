import EventEmitter from "node:events";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as minimalConfig} from "@lodestar/config/default";
import {CheckpointWithHex, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {LogLevel, testLogger} from "@lodestar/logger/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {
  computeStartSlotAtEpoch,
  getBlockProposerSignatureSet,
  interopSecretKey,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, fulu, gloas, phase0, ssz} from "@lodestar/types";
import {defer, notNullish, sleep, toRootHex} from "@lodestar/utils";
import {
  BlockInputNoData,
  BlockInputPreData,
  isBlockInputColumns,
} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, DAType, IBlockInput} from "../../../src/chain/blocks/blockInput/types.js";
import {PayloadError, PayloadErrorCode, PayloadErrorType} from "../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {BlsSingleThreadVerifier} from "../../../src/chain/bls/singleThread.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/blockError.js";
import {DataColumnSidecarErrorCode} from "../../../src/chain/errors/dataColumnSidecarError.js";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
} from "../../../src/chain/errors/executionPayloadEnvelope.js";
import {GossipAction} from "../../../src/chain/errors/gossipValidation.js";
import {ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../src/chain/index.js";
import {SeenBlockProposers} from "../../../src/chain/seenCache/seenBlockProposers.js";
import {SeenBlockInput} from "../../../src/chain/seenCache/seenGossipBlockInput.js";
import {validateGloasBlockDataColumnSidecars} from "../../../src/chain/validation/dataColumnSidecar.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../src/chain/validation/executionPayloadEnvelope.js";
import {ExecutionPayloadStatus} from "../../../src/execution/index.js";
import {INetwork, NetworkEvent, NetworkEventBus, PeerAction} from "../../../src/network/index.js";
import {PeerSyncMeta} from "../../../src/network/peers/peersData.js";
import {defaultSyncOptions} from "../../../src/sync/options.js";
import {
  BlockInputSyncCacheItem,
  PayloadSyncCacheItem,
  PendingBlockInputStatus,
  PendingPayloadInputStatus,
  PendingPayloadRootHex,
} from "../../../src/sync/types.js";
import {BlockInputSync, PAYLOAD_POLL_INTERVAL_MS, UnknownBlockPeerBalancer} from "../../../src/sync/unknownBlock.js";
import {DownloadByRootErrorCode} from "../../../src/sync/utils/downloadByRoot.js";
import {ClockEvent} from "../../../src/util/clock.js";
import {CustodyConfig} from "../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../src/util/peerId.js";
import {SerializedCache} from "../../../src/util/serializedCache.js";
import {ClockStopped} from "../../mocks/clock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {config as blocksAndDataConfig, generateBlockWithColumnSidecars, slots} from "../../utils/blocksAndData.js";
import {getRandPeerIdStr, getRandPeerSyncMeta} from "../../utils/peer.js";

for (let i = 0; i < 2; i++) {
  pubkeyCache.append(i, interopSecretKey(i).toPublicKey().toBytes());
}

vi.mock("../../../src/chain/validation/executionPayloadEnvelope.js", () => ({
  validateGossipExecutionPayloadEnvelope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/chain/validation/dataColumnSidecar.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../src/chain/validation/dataColumnSidecar.js")>();
  return {
    ...mod,
    validateGloasBlockDataColumnSidecars: vi.fn().mockResolvedValue(undefined),
  };
});

function buildPayloadFixture({
  blobCount,
  blockHash,
  sampledColumns,
  slot,
}: {
  blobCount: number;
  blockHash?: Uint8Array;
  sampledColumns: number[];
  slot: number;
}): {
  block: gloas.SignedBeaconBlock;
  blockRootHex: string;
  blockRoot: Uint8Array;
  payloadInput: PayloadEnvelopeInput;
  envelope: gloas.SignedExecutionPayloadEnvelope;
  columnSidecars: gloas.DataColumnSidecar[];
} {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = Array.from({length: blobCount}, () =>
    Buffer.alloc(48, 0x11)
  );
  if (blockHash) {
    block.message.body.signedExecutionPayloadBid.message.blockHash = blockHash;
  }

  const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);
  const payloadInput = PayloadEnvelopeInput.createFromBlock({
    blockRootHex,
    block: block as SignedBeaconBlock<typeof ForkName.gloas>,
    forkName: ForkName.gloas,
    sampledColumns,
    custodyColumns: sampledColumns,
    seenTimestampSec: Date.now() / 1000,
    source: PayloadEnvelopeInputSource.byRange,
    daOutOfRange: false,
  });

  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  envelope.message.beaconBlockRoot = blockRoot;
  envelope.message.payload.slotNumber = slot;

  const columnSidecars = sampledColumns.map((index) => {
    const columnSidecar = ssz.gloas.DataColumnSidecar.defaultValue();
    columnSidecar.beaconBlockRoot = blockRoot;
    columnSidecar.slot = slot;
    columnSidecar.index = index;
    return columnSidecar;
  });

  return {block, blockRootHex, blockRoot, payloadInput, envelope, columnSidecars};
}

function createGloasBlockInput({
  block,
  blockRootHex,
  peerIdStr,
  seenTimestampSec,
  source,
}: {
  block: gloas.SignedBeaconBlock;
  blockRootHex: string;
  peerIdStr?: PeerIdStr;
  seenTimestampSec: number;
  source: BlockInputSource;
}): BlockInputNoData {
  return BlockInputNoData.createFromBlock({
    block,
    blockRootHex,
    forkName: ForkName.gloas,
    daOutOfRange: false,
    seenTimestampSec,
    source,
    peerIdStr,
  });
}

function getGloasBlockRoot(block: gloas.SignedBeaconBlock): Uint8Array {
  return ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
}

function getGloasBlockHashHex(block: gloas.SignedBeaconBlock): string {
  return toRootHex(block.message.body.signedExecutionPayloadBid.message.blockHash);
}

function buildIncompleteGloasBlockInput({
  parentRoot,
  parentBlockHash,
  slot,
}: {
  parentRoot: Uint8Array;
  parentBlockHash: Uint8Array;
  slot: number;
}): {
  block: gloas.SignedBeaconBlock;
  blockRootHex: string;
  parentBlockHashHex: string;
  parentRootHex: string;
  blockInput: IBlockInput<typeof ForkName.gloas, null>;
} {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  block.message.parentRoot = parentRoot;
  block.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentBlockHash;

  const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
  const parentRootHex = toRootHex(parentRoot);
  const parentBlockHashHex = toRootHex(parentBlockHash);

  let currentBlock: SignedBeaconBlock<typeof ForkName.gloas> | undefined;
  let timeCompleteSec = 0;
  let blockSource = {
    source: BlockInputSource.byRoot,
    seenTimestampSec: 0,
    peerIdStr: undefined as string | undefined,
  };

  const blockInput: IBlockInput<typeof ForkName.gloas, null> = {
    type: DAType.NoData,
    daOutOfRange: false,
    timeCreatedSec: 0,
    forkName: ForkName.gloas,
    slot,
    blockRootHex,
    parentRootHex,
    addBlock(props): void {
      currentBlock = props.block;
      timeCompleteSec = props.seenTimestampSec;
      blockSource = {
        source: props.source,
        seenTimestampSec: props.seenTimestampSec,
        peerIdStr: props.peerIdStr,
      };
    },
    hasBlock(): boolean {
      return currentBlock !== undefined;
    },
    getBlock(): SignedBeaconBlock<typeof ForkName.gloas> {
      if (!currentBlock) {
        throw new Error("Missing block");
      }
      return currentBlock;
    },
    getBlockSource() {
      if (!currentBlock) {
        throw new Error("Missing block source");
      }
      return blockSource;
    },
    hasAllData(): boolean {
      return true;
    },
    hasBlockAndAllData(): boolean {
      return currentBlock !== undefined;
    },
    getLogMeta() {
      return {slot, blockRoot: blockRootHex, timeCreatedSec: 0};
    },
    getTimeComplete(): number {
      if (!currentBlock) {
        throw new Error("Missing completion time");
      }
      return timeCompleteSec;
    },
    getSerializedCacheKeys(): object[] {
      return currentBlock ? [currentBlock] : [];
    },
    waitForBlock(): Promise<SignedBeaconBlock<typeof ForkName.gloas>> {
      return currentBlock ? Promise.resolve(currentBlock) : Promise.reject(new Error("Missing block"));
    },
    waitForAllData(): Promise<null> {
      return Promise.resolve(null);
    },
    waitForBlockAndAllData(): Promise<IBlockInput<typeof ForkName.gloas, null>> {
      return currentBlock ? Promise.resolve(blockInput) : Promise.reject(new Error("Missing block"));
    },
  };

  return {block, blockRootHex, parentBlockHashHex, parentRootHex, blockInput};
}

describe("sync by UnknownBlockSync", {timeout: 20_000}, () => {
  const logger = testLogger();
  const slotSec = 1;
  const config = createBeaconConfig(
    {
      ...minimalConfig,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
      SLOT_DURATION_MS: slotSec * 1000,
    },
    Buffer.alloc(32, 0)
  );

  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const testCases: {
    id: string;
    event: ChainEvent.blockUnknownParent | ChainEvent.unknownBlockRoot;
    finalizedSlot: number;
    reportPeer?: boolean;
    seenBlock?: boolean;
    wrongBlockRoot?: boolean;
    maxPendingBlocks?: number;
    rateLimitOnce?: boolean;
  }[] = [
    {
      id: "fetch and process multiple unknown blocks",
      event: ChainEvent.unknownBlockRoot,
      finalizedSlot: 0,
    },
    {
      id: "fetch and process multiple unknown blocks after peer rate limit",
      event: ChainEvent.unknownBlockRoot,
      finalizedSlot: 0,
      rateLimitOnce: true,
    },
    {
      id: "fetch and process multiple unknown block parents",
      event: ChainEvent.blockUnknownParent,
      finalizedSlot: 0,
    },
    {
      id: "downloaded parent is before finalized slot",
      event: ChainEvent.blockUnknownParent,
      finalizedSlot: 2,
      reportPeer: true,
    },
    {
      id: "unbundling attack",
      event: ChainEvent.unknownBlockRoot,
      finalizedSlot: 0,
      seenBlock: true,
    },
    // TODO: Investigate why this test failing after migration to vitest
    // {
    //   id: "peer returns incorrect root block",
    //   event: NetworkEvent.unknownBlock,
    //   finalizedSlot: 0,
    //   wrongBlockRoot: true,
    // },
    {
      id: "peer returns prefinalized block",
      event: ChainEvent.unknownBlockRoot,
      finalizedSlot: 1,
    },
    {
      id: "downloaded blocks only",
      event: ChainEvent.blockUnknownParent,
      finalizedSlot: 0,
      maxPendingBlocks: 1,
    },
  ];

  for (const {
    id,
    event,
    finalizedSlot,
    reportPeer = false,
    seenBlock = false,
    wrongBlockRoot = false,
    maxPendingBlocks,
    rateLimitOnce = false,
  } of testCases) {
    it(id, async () => {
      const peer = await getRandPeerIdStr();
      const blockA = ssz.gloas.SignedBeaconBlock.defaultValue();
      const blockB = ssz.gloas.SignedBeaconBlock.defaultValue();
      const blockC = ssz.gloas.SignedBeaconBlock.defaultValue();
      blockA.message.slot = 1;
      blockB.message.slot = 2;
      blockC.message.slot = 3;
      const blockRoot0 = Buffer.alloc(32, 0x00);
      const blockHash0 = Buffer.alloc(32, 0x00);
      const blockHashA = Buffer.alloc(32, 0xa1);
      const blockHashB = Buffer.alloc(32, 0xb2);
      const blockHashC = Buffer.alloc(32, 0xc3);
      blockA.message.parentRoot = blockRoot0;
      blockA.message.body.signedExecutionPayloadBid.message.parentBlockRoot = blockRoot0;
      blockA.message.body.signedExecutionPayloadBid.message.parentBlockHash = blockHash0;
      blockA.message.body.signedExecutionPayloadBid.message.blockHash = blockHashA;
      const blockRootA = getGloasBlockRoot(blockA);
      blockB.message.parentRoot = blockRootA;
      blockB.message.body.signedExecutionPayloadBid.message.parentBlockRoot = blockRootA;
      blockB.message.body.signedExecutionPayloadBid.message.parentBlockHash = blockHashA;
      blockB.message.body.signedExecutionPayloadBid.message.blockHash = blockHashB;
      const blockRootB = getGloasBlockRoot(blockB);
      blockC.message.parentRoot = blockRootB;
      blockC.message.body.signedExecutionPayloadBid.message.parentBlockRoot = blockRootB;
      blockC.message.body.signedExecutionPayloadBid.message.parentBlockHash = blockHashB;
      blockC.message.body.signedExecutionPayloadBid.message.blockHash = blockHashC;
      const blockRootC = getGloasBlockRoot(blockC);
      const blockRootHex0 = toRootHex(blockRoot0);
      const blockRootHexA = toRootHex(blockRootA);
      const blockRootHexB = toRootHex(blockRootB);
      const blockRootHexC = toRootHex(blockRootC);

      const blocksByRoot = new Map([
        [blockRootHexA, blockA],
        [blockRootHexB, blockB],
        [blockRootHexC, blockC],
      ]);

      let sendBeaconBlocksByRootResolveFn: (value: Parameters<INetwork["sendBeaconBlocksByRoot"]>) => void;
      const sendBeaconBlocksByRootPromise = new Promise<Parameters<INetwork["sendBeaconBlocksByRoot"]>>((r) => {
        sendBeaconBlocksByRootResolveFn = r;
      });
      let sendBeaconBlocksByRootCallCount = 0;

      const networkEvents = new NetworkEventBus();
      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendBeaconBlocksByRoot: async (_peerId, roots) => {
          sendBeaconBlocksByRootCallCount++;
          sendBeaconBlocksByRootResolveFn([_peerId, roots]);
          if (rateLimitOnce && sendBeaconBlocksByRootCallCount === 1) {
            throw new RequestError({
              code: RequestErrorCode.RESP_RATE_LIMITED,
              rateLimitedUntilMs: Date.now() + 100,
            });
          }

          const correctBlocks = Array.from(roots)
            .map((root) => blocksByRoot.get(toRootHex(root)))
            .filter(notNullish);
          return wrongBlockRoot ? [ssz.gloas.SignedBeaconBlock.defaultValue()] : correctBlocks;
        },
      };

      const forkChoiceKnownRoots = new Set([blockRootHex0]);
      const forkChoiceKnownPayloadHashes = new Map([[blockRootHex0, toRootHex(blockHash0)]]);
      const forkChoice: Pick<
        IForkChoice,
        | "getBlockHexAndBlockHash"
        | "getBlockHexDefaultStatus"
        | "getFinalizedBlock"
        | "hasBlock"
        | "hasBlockHex"
        | "hasPayloadHexUnsafe"
      > = {
        hasBlock: (root) => forkChoiceKnownRoots.has(toRootHex(root)),
        hasBlockHex: (rootHex) => forkChoiceKnownRoots.has(rootHex),
        getBlockHexDefaultStatus: (rootHex) => (forkChoiceKnownRoots.has(rootHex) ? ({slot: 0} as ProtoBlock) : null),
        hasPayloadHexUnsafe: (rootHex) => forkChoiceKnownPayloadHashes.has(rootHex),
        getBlockHexAndBlockHash: (rootHex, blockHashHex) =>
          forkChoiceKnownPayloadHashes.get(rootHex) === blockHashHex ? ({slot: 0} as ProtoBlock) : null,
        getFinalizedBlock: () =>
          ({
            slot: finalizedSlot,
          }) as ProtoBlock,
      };
      const seenBlockProposers: Pick<SeenBlockProposers, "isKnown"> = {
        // only return seenBlock for blockC
        isKnown: (blockSlot) => (blockSlot === blockC.message.slot ? seenBlock : false),
      };

      const blockAResolver: () => void = () => {};
      let blockCResolver: () => void;
      const blockCProcessed = new Promise<void>((resolve) => {
        blockCResolver = resolve;
      });

      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        forkChoice: forkChoice as IForkChoice,
        genesisTime: 0,
        pubkeyCache,
        custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
        processBlock: async (blockInput, opts) => {
          const block = blockInput.getBlock();
          const parentRootHex = toRootHex(block.message.parentRoot);
          if (!forkChoice.hasBlockHex(parentRootHex)) throw Error("Unknown parent");

          const parentBlockHash = toRootHex(
            (block as gloas.SignedBeaconBlock).message.body.signedExecutionPayloadBid.message.parentBlockHash
          );
          if (!forkChoice.getBlockHexAndBlockHash(parentRootHex, parentBlockHash)) {
            throw new BlockError(block, {
              code: BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
              parentRoot: parentRootHex,
              parentBlockHash,
            });
          }

          const blockSlot = block.message.slot;
          if (blockSlot <= finalizedSlot && !opts?.ignoreIfFinalized) {
            // same behavior to BeaconChain to reproduce https://github.com/ChainSafe/lodestar/issues/5650
            throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
          }
          // Simulate adding the block to the forkchoice
          const blockRootHex = toRootHex(getGloasBlockRoot(block as gloas.SignedBeaconBlock));
          forkChoiceKnownRoots.add(blockRootHex);
          forkChoiceKnownPayloadHashes.set(blockRootHex, getGloasBlockHashHex(block as gloas.SignedBeaconBlock));
          if (blockRootHex === blockRootHexC) blockCResolver();
          if (blockRootHex === blockRootHexA) blockAResolver();
        },
        seenBlockProposers: seenBlockProposers as SeenBlockProposers,
        seenBlockInputCache: {
          getByBlock: ({
            block,
            blockRootHex,
            seenTimestampSec,
            source,
          }: {
            block: gloas.SignedBeaconBlock;
            blockRootHex: string;
            seenTimestampSec: number;
            source: BlockInputSource;
          }) =>
            createGloasBlockInput({
              block,
              blockRootHex,
              seenTimestampSec,
              source,
            }),
          prune: () => {},
          remove: () => {},
          isVerifiedProposerSignature: () => true,
        } as unknown as SeenBlockInput,
        seenPayloadEnvelopeInputCache: {
          add: vi.fn(),
          get: vi.fn().mockReturnValue(undefined),
          getOrReload: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      };

      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      const processBlockSpy = vi.spyOn(chain, "processBlock");
      const syncService = new BlockInputSync(config, network as INetwork, chain as IBeaconChain, logger, null, {
        ...defaultSyncOptions,
        maxPendingBlocks,
      });
      syncService.subscribeToNetwork();

      // Register the peer in the peerBalancer via NetworkEvent.peerConnected
      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "test-client",
      });

      if (event === ChainEvent.blockUnknownParent) {
        emitter.emit(ChainEvent.blockUnknownParent, {
          blockInput: createGloasBlockInput({
            block: blockC,
            blockRootHex: blockRootHexC,
            seenTimestampSec: Math.floor(Date.now() / 1000),
            source: BlockInputSource.gossip,
          }),
          peer,
          source: BlockInputSource.gossip,
        });
      } else {
        emitter.emit(ChainEvent.unknownBlockRoot, {
          rootHex: blockRootHexC,
          peer,
          source: BlockInputSource.gossip,
        });
      }

      if (wrongBlockRoot) {
        await sendBeaconBlocksByRootPromise;
        await sleep(200);
        // should not send the invalid root block to chain
        expect(processBlockSpy).toHaveBeenCalledOnce();
      } else if (rateLimitOnce) {
        await sendBeaconBlocksByRootPromise;
        expect(processBlockSpy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        await blockCProcessed;
        expect(sendBeaconBlocksByRootCallCount).toBeGreaterThan(1);
      } else if (reportPeer) {
        // Wait for the network request to happen, then allow async processing to complete
        await sendBeaconBlocksByRootPromise;
        await sleep(200);
        // Downloaded block is before finalized slot, so blocks should be cleaned up
        expect(processBlockSpy).not.toHaveBeenCalled();
      } else if (maxPendingBlocks !== undefined) {
        // With maxPendingBlocks=1 and unknownParent event, the scheduler can re-queue one pruned
        // parent root at a time, so it partially recovers the chain. It still cannot retain enough
        // pending state to import the full descendant chain, so only the earliest ancestor lands in
        // fork choice.
        await sleep(500);
        expect(Array.from(forkChoiceKnownRoots.values())).toEqual([blockRootHex0, blockRootHexA]);
      } else {
        // Wait for all blocks to be in ForkChoice store
        await blockCProcessed;
        // the payload poll loop also schedules timers, so assert on the proposer boost delay only
        const proposerBoostWindowMs = config.getAttestationDueMs(config.getForkName(blockC.message.slot));
        if (seenBlock) {
          expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), proposerBoostWindowMs);
        } else {
          expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), proposerBoostWindowMs);
        }

        // After completing the sync, all blocks should be in the ForkChoice
        expect(Array.from(forkChoiceKnownRoots.values())).toEqual([
          blockRootHex0,
          blockRootHexA,
          blockRootHexB,
          blockRootHexC,
        ]);
      }

      syncService.close();
    });
  }
});

describe("UnknownBlockSync", () => {
  let network: INetwork;
  let chain: MockedBeaconChain;
  const logger = testLogger();
  let service: BlockInputSync;

  beforeEach(() => {
    network = {
      events: new NetworkEventBus(),
      getConnectedPeers: () => [],
    } as Partial<INetwork> as INetwork;
    chain = getMockedBeaconChain();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const testCases: {actions: boolean[]; expected: boolean}[] = [
    // true = subscribe, false = unsubscribe
    // expected = isSubscribed
    {actions: [false, true], expected: true},
    {actions: [false, true, true], expected: true},
    {actions: [true, false, true], expected: true},
    {actions: [true, true, true], expected: true},
    {actions: [true, false, false, true], expected: true},
    {actions: [true, false], expected: false},
    {actions: [true, false, false], expected: false},
  ];

  describe("subscribe and unsubscribe multiple times", () => {
    for (const {actions, expected} of testCases) {
      const testName = actions.map((action) => (action ? "subscribe" : "unsubscribe")).join(" - ");
      it(testName, () => {
        const events = chain.emitter as EventEmitter;
        service = new BlockInputSync(minimalConfig, network, chain, logger, null, defaultSyncOptions);
        for (const action of actions) {
          if (action) {
            service.subscribeToNetwork();
          } else {
            service.unsubscribeFromNetwork();
          }
        }

        if (expected) {
          expect(events.listenerCount(ChainEvent.unknownBlockRoot)).toBe(1);
          expect(events.listenerCount(ChainEvent.blockUnknownParent)).toBe(1);
          expect(events.listenerCount(ChainEvent.unknownEnvelopeBlockRoot)).toBe(1);
          expect(events.listenerCount(ChainEvent.incompletePayloadEnvelope)).toBe(1);
          expect(events.listenerCount(routes.events.EventType.block)).toBe(1);
          expect(events.listenerCount(routes.events.EventType.executionPayload)).toBe(1);
          expect(service.isSubscribedToNetwork()).toBe(true);
        } else {
          expect(events.listenerCount(ChainEvent.unknownBlockRoot)).toBe(0);
          expect(events.listenerCount(ChainEvent.blockUnknownParent)).toBe(0);
          expect(events.listenerCount(ChainEvent.unknownEnvelopeBlockRoot)).toBe(0);
          expect(events.listenerCount(ChainEvent.incompletePayloadEnvelope)).toBe(0);
          expect(events.listenerCount(routes.events.EventType.block)).toBe(0);
          expect(events.listenerCount(routes.events.EventType.executionPayload)).toBe(0);
          expect(service.isSubscribedToNetwork()).toBe(false);
        }
      });
    }
  });

  describe("block processing execution errors", () => {
    const executionErrorCases = [
      {
        code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
        error: (block: SignedBeaconBlock) =>
          new BlockError(block, {
            code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
            execStatus: ExecutionPayloadStatus.ELERROR,
            errorMessage: "execution engine offline",
          }),
        logsInvalidBranch: false,
      },
      {
        code: BlockErrorCode.EXECUTION_ENGINE_INVALID,
        error: (block: SignedBeaconBlock) =>
          new BlockError(block, {
            code: BlockErrorCode.EXECUTION_ENGINE_INVALID,
            execStatus: ExecutionPayloadStatus.INVALID,
            errorMessage: "invalid payload",
          }),
        logsInvalidBranch: true,
      },
    ];

    for (const {code, error, logsInvalidBranch} of executionErrorCases) {
      it(`handles ${code} without live unknown-block peer reporting`, async () => {
        const peer = await getRandPeerIdStr();
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = 1;
        block.message.parentRoot = Buffer.alloc(32, 0xaa);

        const blockRoot = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
        const blockRootHex = toRootHex(blockRoot);
        const parentRootHex = toRootHex(block.message.parentRoot);
        const networkEvents = new NetworkEventBus();
        const reportPeer = vi.fn();

        const networkForTest = {
          events: networkEvents,
          getConnectedPeers: () => [peer],
          getConnectedPeerSyncMeta: () => ({
            peerId: peer,
            client: "execution-error-test-client",
            custodyColumns: [],
            earliestAvailableSlot: 0,
          }),
          custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
          sendBeaconBlocksByRoot: vi.fn().mockResolvedValue([block]),
          reportPeer,
        } as unknown as INetwork;

        const processBlock = vi.fn().mockRejectedValue(error(block));
        const chainForTest = {
          emitter: new ChainEventEmitter(),
          clock: new ClockStopped(0),
          forkChoice: {
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? ({slot: 0} as ProtoBlock) : null)),
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
          genesisTime: 0,
          pubkeyCache,
          custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
          processBlock,
          seenBlockInputCache: {
            getByBlock: ({
              block,
              blockRootHex,
              seenTimestampSec,
              source,
              peerIdStr,
            }: {
              block: SignedBeaconBlock<ForkName.phase0>;
              blockRootHex: string;
              seenTimestampSec: number;
              source: BlockInputSource;
              peerIdStr?: PeerIdStr;
            }) =>
              BlockInputPreData.createFromBlock({
                block,
                blockRootHex,
                forkName: ForkName.phase0,
                daOutOfRange: false,
                seenTimestampSec,
                source,
                peerIdStr,
              }),
            prune: vi.fn(),
            isVerifiedProposerSignature: vi.fn().mockReturnValue(true),
          } as unknown as SeenBlockInput,
          seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockReturnValue(undefined),
            getOrReload: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        } as unknown as IBeaconChain;

        const debug = vi.fn();
        const loggerForTest = Object.assign(Object.create(logger), {debug}) as typeof logger;
        service = new BlockInputSync(
          minimalConfig,
          networkForTest,
          chainForTest,
          loggerForTest,
          null,
          defaultSyncOptions
        );
        service.subscribeToNetwork();

        networkEvents.emit(NetworkEvent.peerConnected, {
          peer,
          status: {} as never,
          custodyColumns: [],
          clientAgent: "execution-error-test-client",
        });
        chainForTest.emitter.emit(ChainEvent.unknownBlockRoot, {
          rootHex: blockRootHex,
          peer,
          source: BlockInputSource.gossip,
        });

        await sleep(20);

        expect(processBlock).toHaveBeenCalledOnce();
        expect(reportPeer).not.toHaveBeenCalled();
        expect(
          debug.mock.calls.some(([message]) => message === "Execution engine rejected block from unknown parent sync")
        ).toBe(logsInvalidBranch);

        service.close();
      });
    }
  });

  describe("download retention", () => {
    function setupBlockSyncTest({
      processBlock,
      sendBeaconBlocksByRoot,
      peer,
      config = minimalConfig,
    }: {
      processBlock: ReturnType<typeof vi.fn>;
      sendBeaconBlocksByRoot: ReturnType<typeof vi.fn>;
      peer: PeerIdStr;
      config?: ChainForkConfig;
    }): {
      service: BlockInputSync;
      reportPeer: ReturnType<typeof vi.fn>;
      chainEmitter: ChainEventEmitter;
      chain: IBeaconChain;
    } {
      const networkEvents = new NetworkEventBus();
      const reportPeer = vi.fn();

      const networkForTest = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "retention-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendBeaconBlocksByRoot,
        reportPeer,
      } as unknown as INetwork;

      const chainEmitter = new ChainEventEmitter();
      const chainForTest = {
        emitter: chainEmitter,
        clock: new ClockStopped(0),
        forkChoice: {
          hasBlockHex: vi.fn().mockImplementation((root: string) => root === toRootHex(Buffer.alloc(32, 0xaa))),
          getBlockHexDefaultStatus: vi
            .fn()
            .mockImplementation((root: string) =>
              root === toRootHex(Buffer.alloc(32, 0xaa)) ? ({slot: 0} as ProtoBlock) : null
            ),
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
        genesisTime: 0,
        custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
        processBlock,
        seenBlockInputCache: {
          getByBlock: ({
            block,
            blockRootHex,
            seenTimestampSec,
            source,
            peerIdStr,
          }: {
            block: SignedBeaconBlock<ForkName.phase0>;
            blockRootHex: string;
            seenTimestampSec: number;
            source: BlockInputSource;
            peerIdStr?: PeerIdStr;
          }) =>
            BlockInputPreData.createFromBlock({
              block,
              blockRootHex,
              forkName: ForkName.phase0,
              daOutOfRange: false,
              seenTimestampSec,
              source,
              peerIdStr,
            }),
          prune: vi.fn(),
          remove: vi.fn(),
        } as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        seenPayloadEnvelopeInputCache: {
          add: vi.fn(),
          get: vi.fn().mockReturnValue(undefined),
          getOrReload: vi.fn().mockResolvedValue(undefined),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      } as unknown as IBeaconChain;

      const svc = new BlockInputSync(config, networkForTest, chainForTest, logger, null, defaultSyncOptions);
      svc.subscribeToNetwork();
      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "retention-test-client",
      });

      return {service: svc, reportPeer, chainEmitter, chain: chainForTest};
    }

    it("retains the pending entry when the download fails and retries it after a backoff", async () => {
      const peerA = await getRandPeerIdStr();
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = 1;
      block.message.parentRoot = Buffer.alloc(32, 0xaa);
      const blockRootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));

      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
      const processBlock = vi.fn();
      const sendBeaconBlocksByRoot = vi.fn().mockRejectedValue(new Error("no block"));
      const {
        service: svc,
        reportPeer,
        chainEmitter,
      } = setupBlockSyncTest({processBlock, sendBeaconBlocksByRoot, peer: peerA});
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      try {
        chainEmitter.emit(ChainEvent.unknownBlockRoot, {
          rootHex: blockRootHex,
          peer: peerA,
          source: BlockInputSource.gossip,
        });
        await vi.advanceTimersByTimeAsync(0);

        // could-not-fetch is not evidence the block is bad (#10018): entry retained for retry
        const retained = pendingBlocks.get(blockRootHex);
        expect(retained?.status).toBe(PendingBlockInputStatus.pending);
        expect(reportPeer).not.toHaveBeenCalled();
        expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();

        // any new unknown root triggers a search, which must not retry the entry before its backoff expires
        (svc as unknown as {triggerUnknownBlockSearch: () => void}).triggerUnknownBlockSearch();
        await vi.advanceTimersByTimeAsync(0);
        expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(sendBeaconBlocksByRoot).toHaveBeenCalledTimes(2);
        expect(pendingBlocks.get(blockRootHex)?.status).toBe(PendingBlockInputStatus.pending);
      } finally {
        svc.close();
        vi.useRealTimers();
      }
    });

    it("backs off a download that fails after replacing the entry with a partial result", async () => {
      const peerA = await getRandPeerIdStr();
      const rootHex = toRootHex(Buffer.alloc(32, 0xcc));

      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
      const {service: svc, chainEmitter} = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn(),
        peer: peerA,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;
      // Like a Fulu download that got the block and some columns, the entry is replaced before the fetch throws
      const fetchBlockInput = vi
        .spyOn(svc as unknown as {fetchBlockInput: () => Promise<never>}, "fetchBlockInput")
        .mockImplementation(async () => {
          pendingBlocks.set(rootHex, {
            status: PendingBlockInputStatus.pending,
            rootHex,
            timeAddedSec: 0,
            peerIdStrings: new Set([peerA]),
          });
          throw Error("missing columns");
        });

      try {
        chainEmitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: peerA, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchBlockInput).toHaveBeenCalledOnce();

        (svc as unknown as {triggerUnknownBlockSearch: () => void}).triggerUnknownBlockSearch();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchBlockInput).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchBlockInput).toHaveBeenCalledTimes(2);

        // the backoff doubles even though every failure leaves a fresh entry behind
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchBlockInput).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchBlockInput).toHaveBeenCalledTimes(3);
      } finally {
        svc.close();
        vi.useRealTimers();
      }
    });

    it("does not keep unknown roots over a new one because a payload search shares them", async () => {
      const peerA = await getRandPeerIdStr();
      const {service: svc, chainEmitter} = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn().mockReturnValue(new Promise(() => {})),
        peer: peerA,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      // A gossip attestation with index 1 searches its unknown root as a block and as a payload before validation
      for (let i = 0; i < 100; i++) {
        const rootHex = toRootHex(Buffer.alloc(32, 0).fill(i + 1, 0, 4));
        chainEmitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: peerA, source: BlockInputSource.gossip});
        chainEmitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex, peer: peerA, source: BlockInputSource.gossip});
      }
      const newRootHex = toRootHex(Buffer.alloc(32, 0xdd));
      chainEmitter.emit(ChainEvent.unknownBlockRoot, {
        rootHex: newRootHex,
        peer: peerA,
        source: BlockInputSource.gossip,
      });

      expect(pendingBlocks.size).toBe(100);
      expect(pendingBlocks.has(newRootHex)).toBe(true);

      svc.close();
    });

    it("does not evict a new unknown root for pending blocks and the parents they wait on", async () => {
      const peerA = await getRandPeerIdStr();
      const {service: svc, chainEmitter} = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn().mockReturnValue(new Promise(() => {})),
        peer: peerA,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      // A block downloaded by root is only checked against the root, a peer can make us hold blocks it crafted
      for (let i = 0; i < 100; i++) {
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = i + 1;
        block.message.parentRoot = Buffer.alloc(32, 0).fill(i + 1, 0, 4);
        const blockRootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
        chainEmitter.emit(ChainEvent.blockUnknownParent, {
          blockInput: BlockInputPreData.createFromBlock({
            block,
            blockRootHex,
            forkName: ForkName.phase0,
            daOutOfRange: false,
            seenTimestampSec: 0,
            source: BlockInputSource.byRoot,
            peerIdStr: peerA,
          }),
          peer: peerA,
          source: BlockInputSource.byRoot,
        });
      }
      const newRootHex = toRootHex(Buffer.alloc(32, 0xdd));
      chainEmitter.emit(ChainEvent.unknownBlockRoot, {
        rootHex: newRootHex,
        peer: peerA,
        source: BlockInputSource.gossip,
      });

      expect(pendingBlocks.has(newRootHex)).toBe(true);

      svc.close();
    });

    it("evicts unknown roots nothing waits on before a pending block and its parent", async () => {
      const peerA = await getRandPeerIdStr();
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = 1;
      block.message.parentRoot = Buffer.alloc(32, 0xbb);
      const blockRootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
      const parentRootHex = toRootHex(block.message.parentRoot);

      const {service: svc, chainEmitter} = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn().mockReturnValue(new Promise(() => {})),
        peer: peerA,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      chainEmitter.emit(ChainEvent.blockUnknownParent, {
        blockInput: BlockInputPreData.createFromBlock({
          block,
          blockRootHex,
          forkName: ForkName.phase0,
          daOutOfRange: false,
          seenTimestampSec: 0,
          source: BlockInputSource.gossip,
          peerIdStr: peerA,
        }),
        peer: peerA,
        source: BlockInputSource.gossip,
      });
      // Any gossip message with an unknown root adds one of these before validation
      for (let i = 0; i < 200; i++) {
        const rootHex = toRootHex(Buffer.alloc(32, 0).fill(i + 1, 0, 4));
        chainEmitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: peerA, source: BlockInputSource.gossip});
      }

      expect(pendingBlocks.size).toBe(100);
      expect(pendingBlocks.has(blockRootHex)).toBe(true);
      expect(pendingBlocks.has(parentRootHex)).toBe(true);

      svc.close();
    });

    function unknownParentBlock(slot: number, parentByte: number): {blockInput: BlockInputPreData; rootHex: string} {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.parentRoot = Buffer.alloc(32, parentByte);
      const rootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
      const blockInput = BlockInputPreData.createFromBlock({
        block,
        blockRootHex: rootHex,
        forkName: ForkName.phase0,
        daOutOfRange: false,
        seenTimestampSec: 0,
        source: BlockInputSource.gossip,
      });
      return {blockInput, rootHex};
    }

    it("removes a peer's oldest retained block once its blocks exceed the byte budget", async () => {
      const peerA = await getRandPeerIdStr();
      const peerB = await getRandPeerIdStr();
      const blocks = [1, 2, 3].map((slot) => unknownParentBlock(slot, 0xb0 + slot));
      const otherPeerBlock = unknownParentBlock(4, 0xb4);
      const blockSize = ssz.phase0.SignedBeaconBlock.value_serializedSize(blocks[0].blockInput.getBlock());
      // Room for two blocks of a peer
      const config = createChainForkConfig({...minimalConfig, MAX_PAYLOAD_SIZE: Math.floor(2.5 * blockSize)});

      const {
        service: svc,
        chainEmitter,
        chain,
      } = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn().mockReturnValue(new Promise(() => {})),
        peer: peerA,
        config,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      chainEmitter.emit(ChainEvent.blockUnknownParent, {
        blockInput: otherPeerBlock.blockInput,
        peer: peerB,
        source: BlockInputSource.gossip,
      });
      for (const {blockInput} of blocks) {
        chainEmitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: peerA, source: BlockInputSource.gossip});
      }

      expect(pendingBlocks.has(blocks[0].rootHex)).toBe(false);
      expect(chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(blocks[0].rootHex);
      expect(pendingBlocks.has(blocks[1].rootHex)).toBe(true);
      expect(pendingBlocks.has(blocks[2].rootHex)).toBe(true);
      expect(pendingBlocks.has(otherPeerBlock.rootHex)).toBe(true);

      svc.close();
    });

    it("removes a retained block from the block input cache when capacity evicts it", async () => {
      const peerA = await getRandPeerIdStr();
      const blocks = Array.from({length: 60}, (_, i) => unknownParentBlock(i + 1, i + 1));

      const {
        service: svc,
        chainEmitter,
        chain,
      } = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn().mockReturnValue(new Promise(() => {})),
        peer: peerA,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      // Each block also adds its parent root, so small blocks fill the pending set before the byte budget
      for (const {blockInput} of blocks) {
        chainEmitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: peerA, source: BlockInputSource.gossip});
      }

      const evicted = blocks.filter(({rootHex}) => !pendingBlocks.has(rootHex));
      expect(evicted.length).toBeGreaterThan(0);
      for (const {rootHex} of evicted) {
        expect(chain.seenBlockInputCache.remove, `evicted block ${rootHex}`).toHaveBeenCalledWith(rootHex);
      }
      expect(chain.seenBlockInputCache.remove).toHaveBeenCalledTimes(evicted.length);

      svc.close();
    });

    it("removes a block still waiting on its parent after two epochs without finality", async () => {
      const peerA = await getRandPeerIdStr();
      const {blockInput, rootHex} = unknownParentBlock(1, 0xc1);

      vi.useFakeTimers({toFake: ["Date"]});
      const {
        service: svc,
        chainEmitter,
        chain,
      } = setupBlockSyncTest({
        processBlock: vi.fn(),
        sendBeaconBlocksByRoot: vi.fn().mockReturnValue(new Promise(() => {})),
        peer: peerA,
      });
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;
      const twoEpochsMs = 2 * SLOTS_PER_EPOCH * minimalConfig.SLOT_DURATION_MS;

      try {
        chainEmitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: peerA, source: BlockInputSource.gossip});

        vi.advanceTimersByTime(twoEpochsMs);
        (chain.clock as ClockStopped).emit(ClockEvent.slot, 2 * SLOTS_PER_EPOCH);
        expect(pendingBlocks.has(rootHex)).toBe(true);

        vi.advanceTimersByTime(1_000);
        (chain.clock as ClockStopped).emit(ClockEvent.slot, 2 * SLOTS_PER_EPOCH + 1);
        expect(pendingBlocks.has(rootHex)).toBe(false);
        expect(chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(rootHex);
      } finally {
        svc.close();
        vi.useRealTimers();
      }
    });

    it("retries a rate-limited download when the backoff expires around the retry timer", async () => {
      const peerA = await getRandPeerIdStr();
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = 1;
      block.message.parentRoot = Buffer.alloc(32, 0xaa);
      const blockRootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
      const peerB = await getRandPeerIdStr();
      const rateLimitedUntilMs = 1_000_000;

      // Once the retry timer is due, the clock stays 1ms before the backoff expiry for a number of reads and
      // then passes it. The retry must not depend on which read is the first to see the backoff expired,
      // nor on another peer still being in backoff
      for (const otherPeerInBackoff of [false, true]) {
        for (let readsBeforeExpiry = 0; readsBeforeExpiry <= 12; readsBeforeExpiry++) {
          vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
          let retryTimerDue = false;
          let reads = 0;
          const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
            if (!retryTimerDue) return rateLimitedUntilMs - 1000;
            return reads++ < readsBeforeExpiry ? rateLimitedUntilMs - 1 : rateLimitedUntilMs;
          });
          const sendBeaconBlocksByRoot = vi
            .fn()
            .mockRejectedValueOnce(new RequestError({code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs}))
            .mockRejectedValue(new Error("no block"));
          const {service: svc, chainEmitter} = setupBlockSyncTest({
            processBlock: vi.fn(),
            sendBeaconBlocksByRoot,
            peer: peerA,
          });

          try {
            chainEmitter.emit(ChainEvent.unknownBlockRoot, {
              rootHex: blockRootHex,
              peer: peerA,
              source: BlockInputSource.gossip,
            });
            await vi.advanceTimersByTimeAsync(0);
            expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();

            if (otherPeerInBackoff) {
              const peerBalancer = (svc as unknown as {peerBalancer: UnknownBlockPeerBalancer}).peerBalancer;
              peerBalancer.onPeerConnected(peerB, {
                peerId: peerB,
                client: "retention-test-client",
                custodyColumns: [],
                earliestAvailableSlot: 0,
              });
              peerBalancer.onRateLimited(peerB, rateLimitedUntilMs + 60_000);
            }

            retryTimerDue = true;
            await vi.advanceTimersByTimeAsync(1100);

            expect(
              sendBeaconBlocksByRoot.mock.calls.length,
              `otherPeerInBackoff=${otherPeerInBackoff} readsBeforeExpiry=${readsBeforeExpiry}`
            ).toBeGreaterThan(1);
          } finally {
            svc.close();
            dateNowSpy.mockRestore();
            vi.useRealTimers();
          }
        }
      }
    });
  });

  describe("downloaded block proposer signature", () => {
    const sigConfig = createBeaconConfig(minimalConfig, Buffer.alloc(32, 0x01));
    const parentRoot = Buffer.alloc(32, 0xaa);
    const parentRootHex = toRootHex(parentRoot);

    function signBlock(slot: number, proposerIndex: number, signerIndex = proposerIndex): phase0.SignedBeaconBlock {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.proposerIndex = proposerIndex;
      block.message.parentRoot = parentRoot;
      const {signingRoot} = getBlockProposerSignatureSet(sigConfig, block);
      block.signature = interopSecretKey(signerIndex).sign(signingRoot).toBytes();
      return block;
    }

    function resign(block: phase0.SignedBeaconBlock, signerIndex: number): phase0.SignedBeaconBlock {
      const resigned = ssz.phase0.SignedBeaconBlock.clone(block);
      const {signingRoot} = getBlockProposerSignatureSet(sigConfig, resigned);
      resigned.signature = interopSecretKey(signerIndex).sign(signingRoot).toBytes();
      return resigned;
    }

    function getRootHex(block: phase0.SignedBeaconBlock): string {
      return toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
    }

    function setupSignatureTest(servedBlocks: Map<PeerIdStr, phase0.SignedBeaconBlock[]>, finalizedSlot = 0) {
      const emitter = new ChainEventEmitter();
      const networkEvents = new NetworkEventBus();
      const clock = new ClockStopped(1);
      const custodyConfig = {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig;
      const seenBlockInputCache = new SeenBlockInput({
        config: sigConfig,
        custodyConfig,
        clock,
        chainEvents: emitter,
        signal: new AbortController().signal,
        serializedCache: new SerializedCache(),
        metrics: null,
      });
      const bls = new BlsSingleThreadVerifier({metrics: null});
      const processBlock = vi.fn<IBeaconChain["processBlock"]>().mockResolvedValue(undefined);
      const connectedPeers = new Set<PeerIdStr>();
      const reportPeer = vi.fn<INetwork["reportPeer"]>();
      const sendBeaconBlocksByRoot = vi.fn(async (peerId: PeerIdStr, roots: Uint8Array[]) => {
        const block = servedBlocks.get(peerId)?.find((b) => getRootHex(b) === toRootHex(roots[0]));
        return block ? [ssz.phase0.SignedBeaconBlock.deserialize(ssz.phase0.SignedBeaconBlock.serialize(block))] : [];
      });

      const network = {
        events: networkEvents,
        getConnectedPeers: () => Array.from(connectedPeers),
        getConnectedPeerSyncMeta: (peerId: PeerIdStr) => ({
          peerId,
          client: "signature-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendBeaconBlocksByRoot,
        reportPeer,
      } as unknown as INetwork;

      const chainForTest = {
        config: sigConfig,
        emitter,
        clock,
        genesisTime: 0,
        forkChoice: {
          hasBlockHex: (root: string) => root === parentRootHex,
          getBlockHexDefaultStatus: (root: string) => (root === parentRootHex ? ({slot: 0} as ProtoBlock) : null),
          hasPayloadHexUnsafe: () => false,
          getFinalizedBlock: () => ({slot: finalizedSlot}) as ProtoBlock,
        } as unknown as IForkChoice,
        custodyConfig,
        processBlock,
        pubkeyCache,
        bls,
        seenBlockInputCache,
        seenBlockProposers: {isKnown: () => false} as unknown as SeenBlockProposers,
        seenPayloadEnvelopeInputCache: {
          add: vi.fn(),
          get: vi.fn().mockReturnValue(undefined),
          getOrReload: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      } as unknown as IBeaconChain;

      const svc = new BlockInputSync(sigConfig, network, chainForTest, logger, null, defaultSyncOptions);
      svc.subscribeToNetwork();
      const connect = (peer: PeerIdStr): void => {
        connectedPeers.add(peer);
        networkEvents.emit(NetworkEvent.peerConnected, {
          peer,
          status: {} as never,
          custodyColumns: [],
          clientAgent: "signature-test-client",
        });
      };
      const pendingBlocks = (svc as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      return {
        svc,
        emitter,
        connect,
        pendingBlocks,
        processBlock,
        reportPeer,
        seenBlockInputCache,
        bls,
        sendBeaconBlocksByRoot,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("reports only the peer serving an invalid proposer signature and imports the root from another peer", async () => {
      const [attacker, honest, forwarder] = await Promise.all([
        getRandPeerIdStr(),
        getRandPeerIdStr(),
        getRandPeerIdStr(),
      ]);
      const block = signBlock(1, 0);
      const resigned = resign(block, 1);
      const rootHex = getRootHex(block);
      const {svc, emitter, connect, pendingBlocks, processBlock, reportPeer, seenBlockInputCache} = setupSignatureTest(
        new Map([
          [attacker, [resigned]],
          [honest, [block]],
        ])
      );

      try {
        connect(attacker);
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: forwarder, source: BlockInputSource.gossip});
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: attacker, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);

        expect(reportPeer).toHaveBeenCalledExactlyOnceWith(
          attacker,
          PeerAction.LowToleranceError,
          DownloadByRootErrorCode.PROPOSAL_SIGNATURE_INVALID
        );
        expect(processBlock).not.toHaveBeenCalled();
        expect(seenBlockInputCache.get(rootHex)).toBeUndefined();
        expect(pendingBlocks.get(rootHex)?.status).toBe(PendingBlockInputStatus.pending);

        connect(honest);
        await vi.advanceTimersByTimeAsync(1_000);

        expect(processBlock).toHaveBeenCalledOnce();
        expect(processBlock.mock.calls[0][0].getBlock().signature).toEqual(block.signature);
        expect(new Set(reportPeer.mock.calls.map(([peer]) => peer))).toEqual(new Set([attacker]));
        expect(pendingBlocks.has(rootHex)).toBe(false);
      } finally {
        svc.close();
      }
    });

    it("rejects a downloaded block whose proposer is outside the pubkey cache without verifying it", async () => {
      const attacker = await getRandPeerIdStr();
      const block = signBlock(1, pubkeyCache.size, 0);
      const rootHex = getRootHex(block);
      const {svc, emitter, connect, pendingBlocks, processBlock, reportPeer, seenBlockInputCache, bls} =
        setupSignatureTest(new Map([[attacker, [block]]]));
      const verifySignatureSets = vi.spyOn(bls, "verifySignatureSets");

      try {
        connect(attacker);
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: attacker, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);

        expect(reportPeer).toHaveBeenCalledExactlyOnceWith(
          attacker,
          PeerAction.LowToleranceError,
          DownloadByRootErrorCode.UNKNOWN_PROPOSER
        );
        expect(verifySignatureSets).not.toHaveBeenCalled();
        expect(processBlock).not.toHaveBeenCalled();
        expect(seenBlockInputCache.get(rootHex)).toBeUndefined();
        expect(pendingBlocks.get(rootHex)?.status).toBe(PendingBlockInputStatus.pending);
      } finally {
        svc.close();
      }
    });

    it("drops a block below the finalized slot, such as unsigned genesis, without reporting peers", async () => {
      const [honest, otherHonest] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const genesisBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      const rootHex = getRootHex(genesisBlock);
      const {
        svc,
        emitter,
        connect,
        pendingBlocks,
        processBlock,
        reportPeer,
        seenBlockInputCache,
        bls,
        sendBeaconBlocksByRoot,
      } = setupSignatureTest(
        new Map([
          [honest, [genesisBlock]],
          [otherHonest, [genesisBlock]],
        ]),
        1
      );
      const verifySignatureSets = vi.spyOn(bls, "verifySignatureSets");

      try {
        connect(honest);
        connect(otherHonest);
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: honest, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(1_000);

        expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();
        expect(reportPeer).not.toHaveBeenCalled();
        expect(verifySignatureSets).not.toHaveBeenCalled();
        expect(processBlock).not.toHaveBeenCalled();
        expect(seenBlockInputCache.get(rootHex)).toBeUndefined();
        expect(pendingBlocks.has(rootHex)).toBe(false);
      } finally {
        svc.close();
      }
    });
  });

  describe("downloaded column sidecars", () => {
    const fuluConfig = createBeaconConfig(blocksAndDataConfig, Buffer.alloc(32, 0x01));
    const sampledColumns = [0, 1];
    const parentRoot = Buffer.alloc(32, 0xbb);
    const parentRootHex = toRootHex(parentRoot);

    function generateFuluBlock(): {
      block: SignedBeaconBlock<ForkName.fulu>;
      rootHex: string;
      columns: fulu.DataColumnSidecar[];
    } {
      const generated = generateBlockWithColumnSidecars({forkName: ForkName.fulu, slot: slots.fulu, parentRoot});
      // A clone, the generated values cache their hash tree roots
      const block = ssz.fulu.SignedBeaconBlock.clone(generated.block);
      block.message.proposerIndex = 0;
      const signedBlockHeader = signedBlockToSignedHeader(fuluConfig, block);
      const rootHex = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      return {block, rootHex, columns: generated.columnSidecars.map((column) => ({...column, signedBlockHeader}))};
    }

    function setupColumnTest(
      block: SignedBeaconBlock<ForkName.fulu>,
      servedColumns: Map<PeerIdStr, fulu.DataColumnSidecar[]>
    ) {
      const emitter = new ChainEventEmitter();
      const networkEvents = new NetworkEventBus();
      const clock = new ClockStopped(block.message.slot + 1);
      const custodyConfig = {sampledColumns, custodyColumns: sampledColumns} as unknown as CustodyConfig;
      const seenBlockInputCache = new SeenBlockInput({
        config: fuluConfig,
        custodyConfig,
        clock,
        chainEvents: emitter,
        signal: new AbortController().signal,
        serializedCache: new SerializedCache(),
        metrics: null,
      });
      // Block and column headers carry the block signature, only a different header signature is verified
      const rootHex = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      seenBlockInputCache.markVerifiedProposerSignature(block.message.slot, rootHex, block.signature);
      const bls = new BlsSingleThreadVerifier({metrics: null});
      const verifySignatureSets = vi.spyOn(bls, "verifySignatureSets").mockResolvedValue(false);
      const processBlock = vi.fn<IBeaconChain["processBlock"]>().mockResolvedValue(undefined);
      const connectedPeers = new Set<PeerIdStr>();
      const reportPeer = vi.fn<INetwork["reportPeer"]>();

      const network = {
        events: networkEvents,
        getConnectedPeers: () => Array.from(connectedPeers),
        getConnectedPeerSyncMeta: (peerId: PeerIdStr) => ({
          peerId,
          client: "column-test-client",
          custodyColumns: sampledColumns,
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns, sampleGroups: sampledColumns.map((c) => [c])} as unknown as CustodyConfig,
        sendBeaconBlocksByRoot: vi.fn(async () => [block]),
        // Capped at the requested count like collectMaxResponseTyped
        sendDataColumnSidecarsByRoot: vi.fn<INetwork["sendDataColumnSidecarsByRoot"]>(async (peerId, request) =>
          (servedColumns.get(peerId) ?? []).slice(
            0,
            request.reduce((total, {columns}) => total + columns.length, 0)
          )
        ),
        reportPeer,
      } as unknown as INetwork;

      const chainForTest = {
        config: fuluConfig,
        emitter,
        clock,
        genesisTime: 0,
        forkChoice: {
          hasBlockHex: (root: string) => root === parentRootHex,
          getBlockHexDefaultStatus: (root: string) => (root === parentRootHex ? ({slot: 0} as ProtoBlock) : null),
          hasPayloadHexUnsafe: () => false,
          getFinalizedBlock: () => ({slot: 0}) as ProtoBlock,
        } as unknown as IForkChoice,
        custodyConfig,
        processBlock,
        pubkeyCache,
        bls,
        seenBlockInputCache,
        seenBlockProposers: {isKnown: () => false} as unknown as SeenBlockProposers,
        seenPayloadEnvelopeInputCache: {
          add: vi.fn(),
          get: vi.fn().mockReturnValue(undefined),
          getOrReload: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      } as unknown as IBeaconChain;

      const svc = new BlockInputSync(fuluConfig, network, chainForTest, logger, null, defaultSyncOptions);
      svc.subscribeToNetwork();
      const connect = (peer: PeerIdStr): void => {
        connectedPeers.add(peer);
        networkEvents.emit(NetworkEvent.peerConnected, {
          peer,
          status: {} as never,
          custodyColumns: sampledColumns,
          clientAgent: "column-test-client",
        });
      };

      return {svc, emitter, connect, processBlock, reportPeer, verifySignatureSets, seenBlockInputCache};
    }

    beforeEach(() => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("imports a pending block once gossip completes its data during a retry backoff", async () => {
      const peer = await getRandPeerIdStr();
      const {block, rootHex, columns} = generateFuluBlock();
      // No peer has the columns yet, so the download fails and is retried after a backoff
      const {svc, emitter, connect, processBlock, seenBlockInputCache} = setupColumnTest(block, new Map());

      try {
        connect(peer);
        const blockInput = seenBlockInputCache.getByBlock({
          blockRootHex: rootHex,
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
          peerIdStr: peer,
        });
        emitter.emit(ChainEvent.incompleteBlockInput, {blockInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);

        for (const columnSidecar of columns.filter((column) => sampledColumns.includes(column.index))) {
          seenBlockInputCache.getByColumn({
            blockRootHex: rootHex,
            columnSidecar,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
            peerIdStr: peer,
          });
        }
        expect(blockInput.hasBlockAndAllData()).toBe(true);
        expect(processBlock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(12_000);

        expect(processBlock).toHaveBeenCalledOnce();
        expect(processBlock.mock.calls[0][0]).toBe(blockInput);
      } finally {
        svc.close();
      }
    });

    it("reports a peer serving columns with an invalid KZG proof and imports the root from another peer", async () => {
      const [attacker, honest] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const {block, rootHex, columns} = generateFuluBlock();
      const [column0, column1] = columns;
      const badColumn0 = {...column0, kzgProofs: column1.kzgProofs};
      const {svc, emitter, connect, processBlock, reportPeer} = setupColumnTest(
        block,
        new Map([
          [attacker, [badColumn0, column1]],
          [honest, [column0, column1]],
        ])
      );

      try {
        connect(attacker);
        connect(honest);
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: attacker, source: BlockInputSource.gossip});
        // Column KZG proofs are verified off the event loop, fake timers alone do not wait for them
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(reportPeer).toHaveBeenCalledExactlyOnceWith(
          attacker,
          PeerAction.LowToleranceError,
          DataColumnSidecarErrorCode.INVALID_KZG_PROOF_BATCH
        );
      } finally {
        svc.close();
      }
    });

    it("reports and excludes a peer serving columns that were not requested", async () => {
      const [attacker, honest] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, connect, processBlock, reportPeer} = setupColumnTest(
        block,
        new Map([
          [attacker, [columns[0], columns[2]]],
          [honest, [columns[1]]],
        ])
      );

      try {
        connect(attacker);
        connect(honest);
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: attacker, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(reportPeer).toHaveBeenCalledExactlyOnceWith(
          attacker,
          PeerAction.LowToleranceError,
          DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED
        );
      } finally {
        svc.close();
      }
    });

    it("does not report a peer serving columns with an invalid header signature", async () => {
      const [peer, otherPeer] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const {block, rootHex, columns} = generateFuluBlock();
      const otherHeader = {...columns[0].signedBlockHeader, signature: new Uint8Array(96)};
      const {svc, emitter, connect, processBlock, reportPeer, verifySignatureSets} = setupColumnTest(
        block,
        new Map([
          [peer, columns.slice(0, 2).map((column) => ({...column, signedBlockHeader: otherHeader}))],
          [otherPeer, columns.slice(0, 2)],
        ])
      );

      try {
        connect(peer);
        connect(otherPeer);
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(verifySignatureSets).toHaveBeenCalledOnce();
        expect(reportPeer).not.toHaveBeenCalled();
      } finally {
        svc.close();
      }
    });
  });

  describe("column sync for a supernode", () => {
    const fuluConfig = createBeaconConfig(blocksAndDataConfig, Buffer.alloc(32, 0x01));
    const allColumns = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
    const firstHalf = allColumns.slice(0, NUMBER_OF_COLUMNS / 2);
    const secondHalf = allColumns.slice(NUMBER_OF_COLUMNS / 2);
    const parentRoot = Buffer.alloc(32, 0xcc);
    const parentRootHex = toRootHex(parentRoot);

    function generateFuluBlock(): {
      block: SignedBeaconBlock<ForkName.fulu>;
      rootHex: string;
      columns: fulu.DataColumnSidecar[];
    } {
      const generated = generateBlockWithColumnSidecars({forkName: ForkName.fulu, slot: slots.fulu, parentRoot});
      // A clone, the generated values cache their hash tree roots
      const block = ssz.fulu.SignedBeaconBlock.clone(generated.block);
      block.message.proposerIndex = 0;
      const signedBlockHeader = signedBlockToSignedHeader(fuluConfig, block);
      const rootHex = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      return {block, rootHex, columns: generated.columnSidecars.map((column) => ({...column, signedBlockHeader}))};
    }

    function setupSupernodeSyncTest(
      block: SignedBeaconBlock<ForkName.fulu>,
      columns: fulu.DataColumnSidecar[],
      peerCustody: Map<PeerIdStr, number[]>,
      {parentKnown = true}: {parentKnown?: boolean} = {}
    ) {
      const emitter = new ChainEventEmitter();
      const networkEvents = new NetworkEventBus();
      const clock = new ClockStopped(block.message.slot + 1);
      const custodyConfig = {sampledColumns: allColumns, custodyColumns: allColumns} as unknown as CustodyConfig;
      const seenBlockInputCache = new SeenBlockInput({
        config: fuluConfig,
        custodyConfig,
        clock,
        chainEvents: emitter,
        signal: new AbortController().signal,
        serializedCache: new SerializedCache(),
        metrics: null,
      });
      const rootHex = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      seenBlockInputCache.markVerifiedProposerSignature(block.message.slot, rootHex, block.signature);
      const processBlock = vi.fn<IBeaconChain["processBlock"]>().mockResolvedValue(undefined);
      const triggerColumnReconstruction = vi.fn();
      const connectedPeers = new Set<PeerIdStr>();
      const sendDataColumnSidecarsByRoot = vi.fn<INetwork["sendDataColumnSidecarsByRoot"]>(async (peerId, request) =>
        columns.filter(
          (column) =>
            (peerCustody.get(peerId) ?? []).includes(column.index) && request[0].columns.includes(column.index)
        )
      );

      const network = {
        events: networkEvents,
        getConnectedPeers: () => Array.from(connectedPeers),
        getConnectedPeerSyncMeta: (peerId: PeerIdStr) => ({
          peerId,
          client: "column-test-client",
          custodyColumns: peerCustody.get(peerId) ?? [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {
          sampledColumns: allColumns,
          sampleGroups: allColumns.map((c) => [c]),
        } as unknown as CustodyConfig,
        sendBeaconBlocksByRoot: vi.fn(async () => [block]),
        sendDataColumnSidecarsByRoot,
        reportPeer: vi.fn(),
      } as unknown as INetwork;

      const chainForTest = {
        config: fuluConfig,
        emitter,
        clock,
        genesisTime: 0,
        forkChoice: {
          hasBlockHex: (root: string) => parentKnown && root === parentRootHex,
          getBlockHexDefaultStatus: (root: string) =>
            parentKnown && root === parentRootHex ? ({slot: 0} as ProtoBlock) : null,
          hasPayloadHexUnsafe: () => false,
          getFinalizedBlock: () => ({slot: 0}) as ProtoBlock,
        } as unknown as IForkChoice,
        custodyConfig,
        processBlock,
        pubkeyCache,
        bls: new BlsSingleThreadVerifier({metrics: null}),
        columnReconstructionTracker: {triggerColumnReconstruction},
        seenBlockInputCache,
        seenBlockProposers: {isKnown: () => false} as unknown as SeenBlockProposers,
        seenPayloadEnvelopeInputCache: {
          add: vi.fn(),
          get: vi.fn().mockReturnValue(undefined),
          getOrReload: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      } as unknown as IBeaconChain;

      const svc = new BlockInputSync(fuluConfig, network, chainForTest, logger, null, defaultSyncOptions);
      svc.subscribeToNetwork();
      for (const [peer, custodyColumns] of peerCustody) {
        connectedPeers.add(peer);
        networkEvents.emit(NetworkEvent.peerConnected, {
          peer,
          status: {} as never,
          custodyColumns,
          clientAgent: "column-test-client",
        });
      }

      return {svc, emitter, processBlock, triggerColumnReconstruction, sendDataColumnSidecarsByRoot};
    }

    beforeEach(() => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("downloads the columns past half from another peer instead of reconstructing them", async () => {
      const [firstPeer, secondPeer] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, processBlock, triggerColumnReconstruction, sendDataColumnSidecarsByRoot} =
        setupSupernodeSyncTest(
          block,
          columns,
          new Map([
            [firstPeer, firstHalf],
            [secondPeer, secondHalf],
          ])
        );

      try {
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: firstPeer, source: BlockInputSource.gossip});
        // Column KZG proofs are verified off the event loop, fake timers alone do not wait for them
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(new Set(sendDataColumnSidecarsByRoot.mock.calls.map(([peer]) => peer))).toEqual(
          new Set([firstPeer, secondPeer])
        );
        const blockInput = processBlock.mock.calls[0][0];
        expect(isBlockInputColumns(blockInput) && blockInput.hasComputedAllData()).toBe(true);
        expect(triggerColumnReconstruction).not.toHaveBeenCalled();
      } finally {
        svc.close();
      }
    });

    it("reconstructs instead of waiting when the peer with the remaining columns is rate limited", async () => {
      const [firstPeer, secondPeer] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, processBlock, triggerColumnReconstruction, sendDataColumnSidecarsByRoot} =
        setupSupernodeSyncTest(
          block,
          columns,
          new Map([
            [firstPeer, firstHalf],
            [secondPeer, secondHalf],
          ])
        );
      const serveColumns = sendDataColumnSidecarsByRoot.getMockImplementation();
      sendDataColumnSidecarsByRoot.mockImplementation(async (peerId, request) => {
        if (peerId === secondPeer) {
          throw new RequestError({code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs: Date.now() + 10_000});
        }
        return serveColumns ? serveColumns(peerId, request) : [];
      });

      try {
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: firstPeer, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(sendDataColumnSidecarsByRoot.mock.calls.map(([peer]) => peer)).toEqual([firstPeer, secondPeer]);
        expect(triggerColumnReconstruction).toHaveBeenCalledExactlyOnceWith(processBlock.mock.calls[0][0]);
      } finally {
        svc.close();
      }
    });

    it("reconstructs a block promoted with half its columns while the request for the rest fails", async () => {
      const [firstPeer, secondPeer] = await Promise.all([getRandPeerIdStr(), getRandPeerIdStr()]);
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, triggerColumnReconstruction, sendDataColumnSidecarsByRoot} = setupSupernodeSyncTest(
        block,
        columns,
        new Map([
          [firstPeer, firstHalf],
          [secondPeer, secondHalf],
        ]),
        // Keeps the promoted block downloaded instead of importing it
        {parentKnown: false}
      );
      const serveColumns = sendDataColumnSidecarsByRoot.getMockImplementation();
      let failRequest: ((e: Error) => void) | undefined;
      sendDataColumnSidecarsByRoot.mockImplementation((peerId, request) => {
        if (peerId === secondPeer) {
          return new Promise((_resolve, reject) => {
            failRequest = reject;
          });
        }
        return serveColumns ? serveColumns(peerId, request) : Promise.resolve([]);
      });

      try {
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: firstPeer, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(failRequest).toBeDefined(), {timeout: 10_000});
        // A search pass while the request for the second half is in flight
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: firstPeer, source: BlockInputSource.gossip});
        failRequest?.(new Error("request failed"));
        await vi.advanceTimersByTimeAsync(0);

        expect(triggerColumnReconstruction).toHaveBeenCalled();
        expect(triggerColumnReconstruction.mock.calls[0][0].blockRootHex).toBe(rootHex);
      } finally {
        svc.close();
      }
    });

    it("does not ask a peer again after it returned only part of the requested columns", async () => {
      const peer = await getRandPeerIdStr();
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, processBlock, triggerColumnReconstruction, sendDataColumnSidecarsByRoot} =
        setupSupernodeSyncTest(block, columns, new Map([[peer, allColumns]]));
      // Claims to custody every column but serves half of them, then one per request
      let served = NUMBER_OF_COLUMNS / 2;
      sendDataColumnSidecarsByRoot.mockImplementation(async (_peerId, request) => {
        const response = columns.filter((column) => request[0].columns.includes(column.index)).slice(0, served);
        served = 1;
        return response;
      });

      try {
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledOnce();
        expect(triggerColumnReconstruction).toHaveBeenCalledExactlyOnceWith(processBlock.mock.calls[0][0]);
      } finally {
        svc.close();
      }
    });

    it("makes one more request once half the columns are present and then reconstructs", async () => {
      const [firstPeer, ...otherPeers] = await Promise.all([
        getRandPeerIdStr(),
        getRandPeerIdStr(),
        getRandPeerIdStr(),
        getRandPeerIdStr(),
      ]);
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, processBlock, triggerColumnReconstruction, sendDataColumnSidecarsByRoot} =
        setupSupernodeSyncTest(
          block,
          columns,
          new Map([[firstPeer, firstHalf], ...otherPeers.map((peer) => [peer, secondHalf] as [PeerIdStr, number[]])])
        );
      // The other peers claim the remaining columns but each serves a single one
      sendDataColumnSidecarsByRoot.mockImplementation(async (peerId, request) => {
        const requested = columns.filter((column) => request[0].columns.includes(column.index));
        return peerId === firstPeer ? requested : requested.slice(0, 1);
      });

      try {
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer: firstPeer, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledTimes(2);
        expect(triggerColumnReconstruction).toHaveBeenCalledExactlyOnceWith(processBlock.mock.calls[0][0]);
      } finally {
        svc.close();
      }
    });

    it("reconstructs the columns no peer can serve once half of them are downloaded", async () => {
      const peer = await getRandPeerIdStr();
      const {block, rootHex, columns} = generateFuluBlock();
      const {svc, emitter, processBlock, triggerColumnReconstruction} = setupSupernodeSyncTest(
        block,
        columns,
        new Map([[peer, firstHalf]])
      );

      try {
        emitter.emit(ChainEvent.unknownBlockRoot, {rootHex, peer, source: BlockInputSource.gossip});
        await vi.waitFor(() => expect(processBlock).toHaveBeenCalledOnce());

        const blockInput = processBlock.mock.calls[0][0];
        expect(blockInput.hasAllData()).toBe(true);
        expect(triggerColumnReconstruction).toHaveBeenCalledExactlyOnceWith(blockInput);
      } finally {
        svc.close();
      }
    });
  });

  describe("payload sync flows", () => {
    const gloasConfig = createBeaconConfig(
      {...minimalConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0},
      Buffer.alloc(32, 0)
    );
    type PayloadSyncTestPeer = {
      peerId: PeerIdStr;
      client?: string;
      custodyColumns?: number[];
      earliestAvailableSlot?: number;
    };

    function setupPayloadSyncTest({
      chainOverrides,
      custodyConfig = {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
      networkOverrides,
      peers = [],
    }: {
      chainOverrides?: Partial<IBeaconChain>;
      custodyConfig?: CustodyConfig;
      networkOverrides?: Partial<INetwork>;
      peers?: PayloadSyncTestPeer[];
    }): {
      chain: IBeaconChain;
      emitter: ChainEventEmitter;
      network: INetwork;
      networkEvents: NetworkEventBus;
    } {
      const emitter = new ChainEventEmitter();
      const networkEvents = new NetworkEventBus();
      const peersById = new Map(peers.map((peer) => [peer.peerId, peer]));

      // start of the slot by default, so the poll loop sleeps to PAYLOAD_DUE and does not tick
      // unless a test advances timers. Tests that exercise the poll set the clock themselves
      const clock = new ClockStopped(0);

      const chain = {
        emitter,
        clock,
        config: gloasConfig,
        custodyConfig,
        genesisTime: 0,
        metrics: null,
        pubkeyCache,
        serializedCache: {delete: vi.fn()} as unknown as IBeaconChain["serializedCache"],
        getBlockByRoot: vi.fn().mockResolvedValue(null),
        processExecutionPayload: vi.fn().mockResolvedValue(undefined),
        seenPayloadEnvelopeInputCache: {
          add: vi.fn(),
          get: vi.fn().mockReturnValue(undefined),
          getOrReload: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(false),
          getBlockHexDefaultStatus: vi.fn().mockReturnValue(null),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
        ...chainOverrides,
      } as IBeaconChain;

      const network = {
        events: networkEvents,
        getConnectedPeers: () => peers.map(({peerId}) => peerId),
        getConnectedPeerSyncMeta: (peerId: string) => {
          const peer = peersById.get(peerId);
          if (!peer) {
            throw new Error(`Unknown peer ${peerId}`);
          }

          return {
            peerId,
            client: peer.client ?? "payload-test-client",
            custodyColumns: peer.custodyColumns ?? [],
            earliestAvailableSlot: peer.earliestAvailableSlot ?? 0,
          };
        },
        custodyConfig,
        ...networkOverrides,
      } as INetwork;

      service = new BlockInputSync(gloasConfig, network, chain, logger, null, defaultSyncOptions);
      service.subscribeToNetwork();

      for (const peer of peers) {
        networkEvents.emit(NetworkEvent.peerConnected, {
          peer: peer.peerId,
          status: {} as never,
          custodyColumns: peer.custodyColumns ?? [],
          clientAgent: peer.client ?? "payload-test-client",
        });
      }

      return {chain, emitter, network, networkEvents};
    }

    beforeEach(() => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      vi.mocked(validateGossipExecutionPayloadEnvelope).mockReset().mockResolvedValue(undefined);
      vi.mocked(validateGloasBlockDataColumnSidecars).mockReset().mockResolvedValue(undefined);
    });

    it("fetches and processes unknown envelope by root when payload input exists", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
        blobCount: 1,
        sampledColumns: [0],
        slot: 1,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendDataColumnSidecarsByRoot = vi.fn().mockResolvedValue(columnSidecars);
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendDataColumnSidecarsByRoot,
        },
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledTimes(1);
      expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledWith(peer, [{blockRoot, columns: [0]}]);
      expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledOnce();
      expect(validateGloasBlockDataColumnSidecars).toHaveBeenCalledOnce();
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
      expect(payloadInput.hasPayloadEnvelope()).toBe(true);
      expect(payloadInput.hasAllData()).toBe(true);
    });

    it("downloads the envelope from another peer when the first peer serves an invalid one", async () => {
      const invalidPeer = await getRandPeerIdStr();
      const validPeer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      const invalidEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.clone(envelope);
      invalidEnvelope.signature = Buffer.alloc(96, 0xff);

      vi.mocked(validateGossipExecutionPayloadEnvelope).mockImplementation(async (_chain, signedEnvelope) => {
        if (signedEnvelope === invalidEnvelope) {
          throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
            code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
            slot: 1,
            root: blockRootHex,
          });
        }
      });

      const sendExecutionPayloadEnvelopesByRoot = vi
        .fn()
        .mockImplementation(async (peerId: PeerIdStr) => [peerId === invalidPeer ? invalidEnvelope : envelope]);
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        // enough sample groups to allow more than one download attempt per fetch
        custodyConfig: {
          sampledColumns: [],
          sampleGroups: Array.from({length: gloasConfig.SAMPLES_PER_SLOT}, () => []),
        } as unknown as CustodyConfig,
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: invalidPeer}, {peerId: validPeer}],
      });

      // the root is gossiped by the peer serving the invalid envelope, so it is asked first
      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer: invalidPeer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(2);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenNthCalledWith(1, invalidPeer, [blockRoot]);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenNthCalledWith(2, validPeer, [blockRoot]);
      expect(payloadInput.getPayloadEnvelope()).toBe(envelope);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
    });

    it("retries a rate-limited payload download when the backoff expires around the retry timer", async () => {
      const peer = await getRandPeerIdStr();
      const otherPeer = await getRandPeerIdStr();
      const rateLimitedUntilMs = 1_000_000;

      // Once the retry timer is due, the clock stays 1ms before the backoff expiry for a number of reads and
      // then passes it. The retry must not depend on which read is the first to see the backoff expired,
      // nor on another peer still being in backoff
      for (const otherPeerInBackoff of [false, true]) {
        for (let readsBeforeExpiry = 0; readsBeforeExpiry <= 12; readsBeforeExpiry++) {
          vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
          let retryTimerDue = false;
          let reads = 0;
          const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
            if (!retryTimerDue) return rateLimitedUntilMs - 1000;
            return reads++ < readsBeforeExpiry ? rateLimitedUntilMs - 1 : rateLimitedUntilMs;
          });
          const {payloadInput} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
          const sendExecutionPayloadEnvelopesByRoot = vi
            .fn()
            .mockRejectedValueOnce(new RequestError({code: RequestErrorCode.RESP_RATE_LIMITED, rateLimitedUntilMs}))
            .mockRejectedValue(new Error("no envelope"));
          const {emitter} = setupPayloadSyncTest({
            networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
            peers: [{peerId: peer}],
          });

          try {
            emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
            await vi.advanceTimersByTimeAsync(0);
            expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();

            if (otherPeerInBackoff) {
              const peerBalancer = (service as unknown as {peerBalancer: UnknownBlockPeerBalancer}).peerBalancer;
              peerBalancer.onPeerConnected(otherPeer, {
                peerId: otherPeer,
                client: "payload-test-client",
                custodyColumns: [],
                earliestAvailableSlot: 0,
              });
              peerBalancer.onRateLimited(otherPeer, rateLimitedUntilMs + 60_000);
            }

            retryTimerDue = true;
            await vi.advanceTimersByTimeAsync(1100);

            expect(
              sendExecutionPayloadEnvelopesByRoot.mock.calls.length,
              `otherPeerInBackoff=${otherPeerInBackoff} readsBeforeExpiry=${readsBeforeExpiry}`
            ).toBeGreaterThan(1);
          } finally {
            service.close();
            dateNowSpy.mockRestore();
            vi.useRealTimers();
          }
        }
      }
    });

    it("fetches immediately for a slot-less envelope search", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
        blobCount: 1,
        sampledColumns: [0],
        slot: 1,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendDataColumnSidecarsByRoot = vi.fn().mockResolvedValue(columnSidecars);
      const {chain, emitter} = setupPayloadSyncTest({
        chainOverrides: {
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            prune: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendDataColumnSidecarsByRoot,
        },
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      // early in the current slot, but a slot-less search is never deferred: its peer has the payload
      (chain.clock as ClockStopped).setMsIntoSlot(0);

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
    });

    it("retries a failed current-slot payload fetch on an interval within the slot", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex} = buildPayloadFixture({blobCount: 1, sampledColumns: [0], slot: 1});

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockRejectedValue(new Error("TEST_ERROR"));
      const {chain, emitter} = setupPayloadSyncTest({
        chainOverrides: {
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer, custodyColumns: [0]}],
      });
      // a slot-less search is added to pendingPayloads and fetched right away
      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);

      // the slot's poll loop retries every pending payload each tick. Put the clock at PAYLOAD_DUE
      // so a fresh loop ticks straight away, then once more an interval later
      (chain.clock as ClockStopped).setMsIntoSlot(gloasConfig.getPayloadDueMs(ForkName.gloas));
      (chain.clock as ClockStopped).emit(ClockEvent.slot, 0);
      await vi.advanceTimersByTimeAsync(PAYLOAD_POLL_INTERVAL_MS);
      await sleep(50);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(3);
    });

    it("defers an optimistic payload search until PAYLOAD_DUE, then searches", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, envelope} = buildPayloadFixture({blobCount: 1, sampledColumns: [0], slot: 1});

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const {chain, emitter} = setupPayloadSyncTest({
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      // early in the current slot: the payload is not due to exist yet
      (chain.clock as ClockStopped).setMsIntoSlot(0);
      (chain.clock as ClockStopped).emit(ClockEvent.slot, 0);

      emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {
        rootHex: blockRootHex,
        slot: 0,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);
      expect(sendExecutionPayloadEnvelopesByRoot).not.toHaveBeenCalled();

      // the slot's poll loop moves the deferred root into pendingPayloads and searches at PAYLOAD_DUE
      const payloadDueMs = gloasConfig.getPayloadDueMs(ForkName.gloas);
      (chain.clock as ClockStopped).setMsIntoSlot(payloadDueMs);
      await vi.advanceTimersByTimeAsync(payloadDueMs);
      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
    });

    it("drops a deferred payload search when gossip delivers before PAYLOAD_DUE", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, envelope} = buildPayloadFixture({blobCount: 1, sampledColumns: [0], slot: 1});

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      // gossip imports the payload while the search waits: fork choice knows it by PAYLOAD_DUE
      const {chain, emitter} = setupPayloadSyncTest({
        chainOverrides: {
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            hasBlockHex: vi.fn().mockReturnValue(false),
            getBlockHexDefaultStatus: vi.fn().mockReturnValue(null),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      (chain.clock as ClockStopped).setMsIntoSlot(0);
      (chain.clock as ClockStopped).emit(ClockEvent.slot, 0);

      emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {
        rootHex: blockRootHex,
        slot: 0,
        peer,
        source: BlockInputSource.gossip,
      });

      const payloadDueMs = gloasConfig.getPayloadDueMs(ForkName.gloas);
      (chain.clock as ClockStopped).setMsIntoSlot(payloadDueMs);
      await vi.advanceTimersByTimeAsync(payloadDueMs + PAYLOAD_POLL_INTERVAL_MS);

      // the deferral paid off: nothing was ever added to pendingPayloads, nothing fetched
      expect(sendExecutionPayloadEnvelopesByRoot).not.toHaveBeenCalled();
    });

    it("searches a root left over from the previous slot at the next slot", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, envelope} = buildPayloadFixture({blobCount: 1, sampledColumns: [0], slot: 1});

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const {chain, emitter} = setupPayloadSyncTest({
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      (chain.clock as ClockStopped).setMsIntoSlot(0);
      (chain.clock as ClockStopped).emit(ClockEvent.slot, 0);

      emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {
        rootHex: blockRootHex,
        slot: 0,
        peer,
        source: BlockInputSource.gossip,
      });

      // the slot ends before its loop ever ticks, so the root was never searched
      await sleep(50);
      expect(sendExecutionPayloadEnvelopesByRoot).not.toHaveBeenCalled();

      // the next slot flushes it into pendingPayloads instead of dropping it
      const payloadDueMs = gloasConfig.getPayloadDueMs(ForkName.gloas);
      (chain.clock as ClockStopped).setSlot(1);
      (chain.clock as ClockStopped).setMsIntoSlot(payloadDueMs);
      (chain.clock as ClockStopped).emit(ClockEvent.slot, 1);

      await vi.advanceTimersByTimeAsync(PAYLOAD_POLL_INTERVAL_MS);
      await sleep(50);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalled();
    });

    it("searches a root deferred after PAYLOAD_DUE on the poll loop's next tick", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, envelope} = buildPayloadFixture({blobCount: 1, sampledColumns: [0], slot: 1});

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const {chain, emitter} = setupPayloadSyncTest({
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      (chain.clock as ClockStopped).setMsIntoSlot(0);
      (chain.clock as ClockStopped).emit(ClockEvent.slot, 0);

      // no root is deferred yet: the loop keeps ticking on an empty map instead of returning
      const payloadDueMs = gloasConfig.getPayloadDueMs(ForkName.gloas);
      (chain.clock as ClockStopped).setMsIntoSlot(payloadDueMs);
      await vi.advanceTimersByTimeAsync(payloadDueMs);
      expect(sendExecutionPayloadEnvelopesByRoot).not.toHaveBeenCalled();

      emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {
        rootHex: blockRootHex,
        slot: 0,
        peer,
        source: BlockInputSource.gossip,
      });

      await vi.advanceTimersByTimeAsync(PAYLOAD_POLL_INTERVAL_MS);
      await sleep(50);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalled();
    });

    it("does not resurrect a payload entry pruned while its download was in flight", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
        blobCount: 1,
        sampledColumns: [0],
        slot: 1,
      });

      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);

      let pendingPayloads: Map<string, PayloadSyncCacheItem> | undefined;
      // Simulate pruneFinalized deleting the entry while the network fetch is in flight.
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockImplementation(async () => {
        pendingPayloads?.delete(blockRootHex);
        return [envelope];
      });
      const sendDataColumnSidecarsByRoot = vi.fn().mockResolvedValue(columnSidecars);

      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendDataColumnSidecarsByRoot,
        },
        peers: [{peerId: peer, custodyColumns: [0]}],
      });

      pendingPayloads = (service as unknown as {pendingPayloads: Map<string, PayloadSyncCacheItem>}).pendingPayloads;

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      // Entry deleted mid-fetch must not be resurrected by the post-await set...
      expect(pendingPayloads.has(blockRootHex)).toBe(false);
      // ...and the pruned payload must not be processed.
      expect(processExecutionPayload).not.toHaveBeenCalled();
    });

    it("continues fetching sampled columns across peers until payload input is complete", async () => {
      const peerA = await getRandPeerIdStr();
      const peerB = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
        blobCount: 1,
        sampledColumns: [0, 1],
        slot: 1,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendDataColumnSidecarsByRoot = vi
        .fn()
        .mockImplementation(async (peerId: string, requests: {blockRoot: Uint8Array; columns: number[]}[]) => {
          const [{blockRoot: requestedRoot, columns}] = requests;
          expect(requestedRoot).toEqual(blockRoot);
          expect(columns).toHaveLength(1);

          if (peerId === peerA) {
            expect(columns).toEqual([0]);
            return [columnSidecars[0]];
          }

          expect(peerId).toBe(peerB);
          expect(columns).toEqual([1]);
          return [columnSidecars[1]];
        });

      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        custodyConfig: {sampledColumns: [0, 1], sampleGroups: [[0], [1]]} as unknown as CustodyConfig,
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendDataColumnSidecarsByRoot,
        },
        peers: [
          {peerId: peerA, client: "payload-test-client-a", custodyColumns: [0]},
          {peerId: peerB, client: "payload-test-client-b", custodyColumns: [1]},
        ],
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer: peerA,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledTimes(2);
      expect(sendDataColumnSidecarsByRoot.mock.calls.map(([peerId]) => peerId)).toEqual(
        expect.arrayContaining([peerA, peerB])
      );
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
      expect(payloadInput.hasPayloadEnvelope()).toBe(true);
      expect(payloadInput.hasAllData()).toBe(true);
    });

    it("downloads the block immediately after fetching an envelope for an unknown root", async () => {
      const peer = await getRandPeerIdStr();
      const {block, blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      const parentRootHex = toRootHex(block.message.parentRoot);

      let cachedPayloadInput: PayloadEnvelopeInput | undefined;
      const knownRoots = new Set([parentRootHex]);

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([block]);
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const processBlock = vi.fn().mockImplementation(async () => {
        cachedPayloadInput = payloadInput;
        knownRoots.add(blockRootHex);
        emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});
      });
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processBlock,
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? cachedPayloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? cachedPayloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          seenBlockInputCache: {
            getByBlock: ({
              block,
              blockRootHex,
              seenTimestampSec,
              source,
            }: {
              block: gloas.SignedBeaconBlock;
              blockRootHex: string;
              seenTimestampSec: number;
              source: BlockInputSource;
            }) =>
              createGloasBlockInput({
                block,
                blockRootHex,
                seenTimestampSec,
                source,
              }),
            prune: vi.fn(),
            isVerifiedProposerSignature: vi.fn().mockReturnValue(true),
          } as unknown as SeenBlockInput,
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => knownRoots.has(root)),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (knownRoots.has(root) ? ({slot: 0} as ProtoBlock) : null)),
            getBlockHexAndBlockHash: vi
              .fn()
              .mockImplementation((root: string, hash: string) =>
                root === parentRootHex &&
                hash === toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
                  ? ({slot: 0} as ProtoBlock)
                  : null
              ),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendBeaconBlocksByRoot,
        },
        peers: [{peerId: peer}],
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(sendBeaconBlocksByRoot).toHaveBeenCalledTimes(1);
      expect(sendBeaconBlocksByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(processBlock).toHaveBeenCalledTimes(1);
      expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledOnce();
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
    });

    it("backs off the block download of an envelope waiting on its block", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
      const peer = await getRandPeerIdStr();
      const {blockRootHex, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn().mockRejectedValue(new Error("no block"));
      const {emitter} = setupPayloadSyncTest({
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot, sendBeaconBlocksByRoot},
        peers: [{peerId: peer}],
      });

      try {
        emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
          rootHex: blockRootHex,
          peer,
          source: BlockInputSource.gossip,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
        expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();

        // every search reconciles the envelope, which must not retry its block before the backoff expires
        (service as unknown as {triggerUnknownBlockSearch: () => void}).triggerUnknownBlockSearch();
        await vi.advanceTimersByTimeAsync(0);
        expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(sendBeaconBlocksByRoot).toHaveBeenCalledTimes(2);
      } finally {
        service.close();
        vi.useRealTimers();
      }
    });

    it("defers envelope validation until the block is in fork choice when payload input is seeded from the block body", async () => {
      const peer = await getRandPeerIdStr();
      const {block, blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      const parentRootHex = toRootHex(block.message.parentRoot);

      // payloadInput is seeded from the block body during download, so the cache returns it before the block
      // is imported into fork choice. Block becomes known only once processBlock imports it.
      let blockImported = false;
      const knownRoots = new Set([parentRootHex]);

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([block]);
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);

      let emitter!: ChainEventEmitter;
      const processBlock = vi.fn().mockImplementation(async () => {
        blockImported = true;
        knownRoots.add(blockRootHex);
        emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});
      });

      // Reproduce BLOCK_ROOT_UNKNOWN: validation rejects while the block is absent from fork choice. The fix must
      // not call it until the block is imported.
      vi.mocked(validateGossipExecutionPayloadEnvelope).mockImplementation(async () => {
        if (!blockImported) {
          throw new Error("EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_ROOT_UNKNOWN");
        }
      });

      ({emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processBlock,
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          seenBlockInputCache: {
            getByBlock: ({
              block,
              blockRootHex,
              seenTimestampSec,
              source,
            }: {
              block: gloas.SignedBeaconBlock;
              blockRootHex: string;
              seenTimestampSec: number;
              source: BlockInputSource;
            }) =>
              createGloasBlockInput({
                block,
                blockRootHex,
                seenTimestampSec,
                source,
              }),
            prune: vi.fn(),
            isVerifiedProposerSignature: vi.fn().mockReturnValue(true),
          } as unknown as SeenBlockInput,
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => knownRoots.has(root)),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (knownRoots.has(root) ? ({slot: 0} as ProtoBlock) : null)),
            getBlockHexAndBlockHash: vi
              .fn()
              .mockImplementation((root: string, hash: string) =>
                root === parentRootHex &&
                hash === toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
                  ? ({slot: 0} as ProtoBlock)
                  : null
              ),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendBeaconBlocksByRoot,
        },
        peers: [{peerId: peer}],
      }));

      // tsc overload-resolution miss when emit is reached through a closure that captures emitter
      // first; cast re-anchors the StrictEventEmitter overload for ChainEvent keys (see #9491).
      (emitter as ChainEventEmitter).emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(80);

      // Envelope downloaded, block pulled because validation was deferred, then envelope validated and processed
      // only after the block landed in fork choice.
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(sendBeaconBlocksByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(processBlock).toHaveBeenCalledTimes(1);
      // Validation runs exactly once: the first reconcile pass seeds the envelope into payloadInput, so any
      // racing scheduler pass sees hasPayloadEnvelope() and skips revalidation.
      expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledOnce();
      // Two racing scheduler passes may both reach processPayload, but every call carries the SAME payloadInput
      // object; chain.processExecutionPayload (via processPayloadEnvelopeJob's WeakMap) dedups them into one
      // real import. This mock bypasses that dedup, so assert on object identity rather than an exact count.
      expect(processExecutionPayload).toHaveBeenCalled();
      for (const [arg] of processExecutionPayload.mock.calls) {
        expect(arg).toBe(payloadInput);
      }
    });

    it("downloads the block and retries payload import when EL reports block not in fork choice", async () => {
      const peer = await getRandPeerIdStr();
      const {block, blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      const parentRootHex = toRootHex(block.message.parentRoot);
      const knownRoots = new Set([parentRootHex, blockRootHex]);

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([block]);
      const processExecutionPayload = vi
        .fn()
        .mockRejectedValueOnce(
          new PayloadError({slot: 1, blockRootHex: "0x1234"} as unknown as PayloadEnvelopeInput, {
            code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE,
            blockRootHex,
          })
        )
        .mockResolvedValueOnce(undefined);

      const processBlock = vi.fn();

      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processBlock,
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          seenBlockInputCache: {
            getByBlock: ({
              block,
              blockRootHex,
              seenTimestampSec,
              source,
            }: {
              block: gloas.SignedBeaconBlock;
              blockRootHex: string;
              seenTimestampSec: number;
              source: BlockInputSource;
            }) =>
              createGloasBlockInput({
                block,
                blockRootHex,
                seenTimestampSec,
                source,
              }),
            prune: vi.fn(),
            isVerifiedProposerSignature: vi.fn().mockReturnValue(true),
          } as unknown as SeenBlockInput,
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => knownRoots.has(root)),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (knownRoots.has(root) ? ({slot: 0} as ProtoBlock) : null)),
            getBlockHexAndBlockHash: vi
              .fn()
              .mockImplementation((root: string, hash: string) =>
                root === parentRootHex &&
                hash === toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
                  ? ({slot: 0} as ProtoBlock)
                  : null
              ),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendBeaconBlocksByRoot,
        },
        peers: [{peerId: peer}],
      });

      processBlock.mockImplementation(async () => {
        knownRoots.add(blockRootHex);
        emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});
      });

      // tsc overload-resolution miss when emit is reached through a closure that captures emitter
      // first; cast re-anchors the StrictEventEmitter overload for ChainEvent keys.
      (emitter as ChainEventEmitter).emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(80);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(sendBeaconBlocksByRoot).toHaveBeenCalledTimes(1);
      expect(sendBeaconBlocksByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(processBlock).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledTimes(2);
      expect(processExecutionPayload).toHaveBeenNthCalledWith(1, payloadInput);
      expect(processExecutionPayload).toHaveBeenNthCalledWith(2, payloadInput);
    });

    it("retries payload processing on a later scheduler pass after an execution engine error", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const processExecutionPayload = vi
        .fn()
        .mockRejectedValueOnce(
          new PayloadError({slot: 1, blockRootHex: "0x1234"} as unknown as PayloadEnvelopeInput, {
            code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
            execStatus: ExecutionPayloadStatus.ELERROR,
            errorMessage: "execution engine offline",
          })
        )
        .mockResolvedValueOnce(undefined);

      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);

      emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});

      await sleep(20);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledTimes(2);
      expect(processExecutionPayload).toHaveBeenNthCalledWith(1, payloadInput);
      expect(processExecutionPayload).toHaveBeenNthCalledWith(2, payloadInput);
    });

    it("ignores a fetched payload envelope whose block root does not match the requested root", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      const {envelope: mismatchedEnvelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 2,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([mismatchedEnvelope]);
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        },
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [blockRoot]);
      expect(validateGossipExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(processExecutionPayload).not.toHaveBeenCalled();
    });

    it.each([false, true])("upgrades an idle root on incomplete payload gossip, complete=%s", async (complete) => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([envelope]);
      const {chain, emitter} = setupPayloadSyncTest({
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });
      vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);

      try {
        emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
          rootHex: blockRootHex,
          peer,
          source: BlockInputSource.gossip,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
        expect(chain.processExecutionPayload).not.toHaveBeenCalled();

        if (complete) {
          payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0});
        }
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);

        expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(complete ? 1 : 2);
        expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
      } finally {
        service.close();
      }
    });

    it.each(["input", "root"])(
      "deduplicates incomplete payload events during a fetch started from %s",
      async (initial) => {
        const peer = await getRandPeerIdStr();
        const {blockRootHex, payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
        const firstFetch = defer<gloas.SignedExecutionPayloadEnvelope[]>();
        const sendExecutionPayloadEnvelopesByRoot = vi
          .fn()
          .mockReturnValueOnce(firstFetch.promise)
          .mockResolvedValue([envelope]);
        const {chain, emitter} = setupPayloadSyncTest({
          networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
          peers: [{peerId: peer}],
        });
        vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
        vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mockResolvedValue(payloadInput);
        vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);

        try {
          if (initial === "root") {
            emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
              rootHex: blockRootHex,
              peer,
              source: BlockInputSource.gossip,
            });
          } else {
            emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
          }
          await vi.advanceTimersByTimeAsync(0);

          for (let i = 0; i < 128; i++) {
            emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
          }
          await vi.advanceTimersByTimeAsync(0);

          expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
          expect(chain.processExecutionPayload).not.toHaveBeenCalled();

          firstFetch.resolve([]);
          await vi.advanceTimersByTimeAsync(0);
          expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
          expect(chain.processExecutionPayload).not.toHaveBeenCalled();

          emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
          await vi.advanceTimersByTimeAsync(0);

          expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(2);
          expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
        } finally {
          firstFetch.resolve([]);
          service.close();
        }
      }
    );

    it("deduplicates incomplete payload events during processing and retries after failure", async () => {
      const peer = await getRandPeerIdStr();
      const {payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0});
      const firstProcess = defer<void>();
      const processExecutionPayload = vi.fn().mockReturnValueOnce(firstProcess.promise).mockResolvedValue(undefined);
      const sendExecutionPayloadEnvelopesByRoot = vi.fn();
      const {chain, emitter} = setupPayloadSyncTest({
        chainOverrides: {processExecutionPayload},
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });
      vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);

      try {
        for (let i = 0; i < 128; i++) {
          emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);

        firstProcess.reject(
          new PayloadError(payloadInput, {
            code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
            execStatus: ExecutionPayloadStatus.SYNCING,
            errorMessage: "Execution engine unavailable",
          })
        );
        await vi.advanceTimersByTimeAsync(0);
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);

        expect(processExecutionPayload).toHaveBeenCalledTimes(2);
        expect(sendExecutionPayloadEnvelopesByRoot).not.toHaveBeenCalled();
      } finally {
        firstProcess.resolve();
        service.close();
      }
    });

    it.each(["reload", "validation success", "validation failure"])(
      "does not replace an active fetch when stale envelope reconciliation finishes %s",
      async (stage) => {
        const peer = await getRandPeerIdStr();
        const {blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
          blobCount: 1,
          sampledColumns: [0],
          slot: 1,
        });
        const reload = defer<PayloadEnvelopeInput | undefined>();
        const validation = defer<void>();
        const currentFetch = defer<gloas.DataColumnSidecar[]>();
        const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
        const sendDataColumnSidecarsByRoot = vi.fn().mockReturnValue(currentFetch.promise);
        const {chain, emitter} = setupPayloadSyncTest({
          custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
          networkOverrides: {
            sendExecutionPayloadEnvelopesByRoot,
            sendDataColumnSidecarsByRoot,
            sendBeaconBlocksByRoot: vi.fn().mockResolvedValue([]),
          },
          peers: [{peerId: peer, custodyColumns: [0]}],
        });

        try {
          emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
            rootHex: blockRootHex,
            peer,
            source: BlockInputSource.gossip,
          });
          await vi.advanceTimersByTimeAsync(0);
          expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
          expect(validateGossipExecutionPayloadEnvelope).not.toHaveBeenCalled();

          vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);
          vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
          vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mockResolvedValue(payloadInput);
          if (stage === "reload") {
            vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mockReturnValueOnce(reload.promise);
          } else {
            vi.mocked(validateGossipExecutionPayloadEnvelope).mockReturnValueOnce(validation.promise);
          }
          const reloadCount = vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mock.calls.length;
          emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});
          await vi.advanceTimersByTimeAsync(0);
          expect(chain.seenPayloadEnvelopeInputCache.getOrReload).toHaveBeenCalledTimes(reloadCount + 1);
          expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledTimes(stage === "reload" ? 0 : 1);

          emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});
          await vi.advanceTimersByTimeAsync(0);
          expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledOnce();

          if (stage === "validation failure") {
            validation.reject(new PayloadError(payloadInput, {code: PayloadErrorCode.INVALID_SIGNATURE}));
          } else validation.resolve();
          reload.resolve(payloadInput);
          await vi.advanceTimersByTimeAsync(0);
          expect(sendDataColumnSidecarsByRoot).toHaveBeenCalledOnce();
          expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
          expect(chain.processExecutionPayload).not.toHaveBeenCalled();

          currentFetch.resolve(columnSidecars);
          await vi.advanceTimersByTimeAsync(0);
          expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
        } finally {
          reload.resolve(undefined);
          validation.resolve();
          currentFetch.resolve([]);
          service.close();
        }
      }
    );

    it("validates an envelope-only entry before upgrading it on incomplete payload gossip", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      const validation = defer<void>();
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const {chain, emitter} = setupPayloadSyncTest({
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot, sendBeaconBlocksByRoot: vi.fn().mockResolvedValue([])},
        peers: [{peerId: peer}],
      });

      try {
        emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
          rootHex: blockRootHex,
          peer,
          source: BlockInputSource.gossip,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
        expect(validateGossipExecutionPayloadEnvelope).not.toHaveBeenCalled();

        vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);
        vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mockResolvedValue(payloadInput);
        vi.mocked(validateGossipExecutionPayloadEnvelope).mockReturnValueOnce(validation.promise);
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith(chain, envelope);
        expect(payloadInput.hasPayloadEnvelope()).toBe(false);
        expect(chain.processExecutionPayload).not.toHaveBeenCalled();

        validation.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
        expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledOnce();
      } finally {
        validation.resolve();
        service.close();
      }
    });

    it("does not replace a re-admitted payload when its pruned download finishes", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      const oldFetch = defer<gloas.SignedExecutionPayloadEnvelope[]>();
      const currentFetch = defer<gloas.SignedExecutionPayloadEnvelope[]>();
      const sendExecutionPayloadEnvelopesByRoot = vi
        .fn()
        .mockReturnValueOnce(oldFetch.promise)
        .mockReturnValue(currentFetch.promise);
      const {chain, emitter} = setupPayloadSyncTest({
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });
      vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);

      try {
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        vi.mocked(chain.forkChoice.getFinalizedBlock).mockReturnValue({slot: 2} as ProtoBlock);
        emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 0, root: blockRoot, rootHex: blockRootHex});

        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(2);

        oldFetch.resolve([envelope]);
        await vi.advanceTimersByTimeAsync(0);
        expect(chain.processExecutionPayload).not.toHaveBeenCalled();

        currentFetch.resolve([envelope]);
        await vi.advanceTimersByTimeAsync(0);
        expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
      } finally {
        oldFetch.resolve([]);
        currentFetch.resolve([]);
        service.close();
      }
    });

    it("does not remove a re-admitted payload when its pruned processing fails", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0});
      const oldProcess = defer<void>();
      const currentProcess = defer<void>();
      const processExecutionPayload = vi
        .fn()
        .mockReturnValueOnce(oldProcess.promise)
        .mockReturnValue(currentProcess.promise);
      const {chain, emitter} = setupPayloadSyncTest({chainOverrides: {processExecutionPayload}});
      vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);
      const removeInvalid = vi.fn();
      chain.seenPayloadEnvelopeInputCache.removeInvalid = removeInvalid;

      try {
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        vi.mocked(chain.forkChoice.getFinalizedBlock).mockReturnValue({slot: 2} as ProtoBlock);
        emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 0, root: blockRoot, rootHex: blockRootHex});

        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        expect(processExecutionPayload).toHaveBeenCalledTimes(2);

        oldProcess.reject(new PayloadError(payloadInput, {code: PayloadErrorCode.INVALID_SIGNATURE}));
        await vi.advanceTimersByTimeAsync(0);
        expect(removeInvalid).not.toHaveBeenCalled();
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);
        expect(processExecutionPayload).toHaveBeenCalledTimes(2);

        currentProcess.resolve();
        await vi.advanceTimersByTimeAsync(0);
      } finally {
        oldProcess.resolve();
        currentProcess.resolve();
        service.close();
      }
    });

    it("processes duplicate incomplete payload events once without network fetch", async () => {
      const peer = await getRandPeerIdStr();
      const {payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      payloadInput.addPayloadEnvelope({
        envelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockReturnValue(payloadInput),
            getOrReload: vi.fn().mockResolvedValue(payloadInput),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === payloadInput.blockRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) =>
                root === payloadInput.blockRootHex ? ({slot: 0} as ProtoBlock) : null
              ),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
      });

      emitter.emit(ChainEvent.incompletePayloadEnvelope, {
        payloadInput,
        peer,
        source: BlockInputSource.gossip,
      });
      emitter.emit(ChainEvent.incompletePayloadEnvelope, {
        payloadInput,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);

      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
    });

    it("completes processing when the payload imported event removes the entry first", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0});
      // importExecutionPayload emits the executionPayload event before processExecutionPayload resolves
      const processExecutionPayload = vi.fn().mockImplementation(async () => {
        emitter.emit(routes.events.EventType.executionPayload, {
          slot: payloadInput.slot,
          builderIndex: 0,
          blockHash: toRootHex(Buffer.alloc(32, 0x44)),
          blockRoot: blockRootHex,
          executionOptimistic: false,
        });
      });
      const debug = vi.spyOn(logger, LogLevel.debug);
      const {chain, emitter} = setupPayloadSyncTest({chainOverrides: {processExecutionPayload}});
      vi.mocked(chain.forkChoice.hasBlockHex).mockReturnValue(true);

      try {
        emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer, source: BlockInputSource.gossip});
        await vi.advanceTimersByTimeAsync(0);

        expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput);
        expect(debug.mock.calls.some(([message]) => message === "Processed payload from unknown sync")).toBe(true);
      } finally {
        debug.mockRestore();
        service.close();
      }
    });

    it("downloads parent payload for unknown parent block when parent block is already known", async () => {
      const peer = await getRandPeerIdStr();
      const parentPayloadHash = Buffer.alloc(32, 0x33);
      const {
        blockRoot: parentRoot,
        blockRootHex: parentRootHex,
        payloadInput,
        envelope,
      } = buildPayloadFixture({
        blobCount: 0,
        blockHash: parentPayloadHash,
        sampledColumns: [],
        slot: 1,
      });

      const childBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      childBlock.message.slot = 2;
      childBlock.message.parentRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentPayloadHash;
      const childBlockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(childBlock.message));
      const childBlockInput = createGloasBlockInput({
        block: childBlock,
        blockRootHex: childBlockRootHex,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.gossip,
      });

      let hasParentPayload = false;
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn();
      const processExecutionPayload = vi.fn().mockImplementation(async () => {
        hasParentPayload = true;
      });
      const processBlock = vi.fn().mockResolvedValue(undefined);
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          processBlock,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === parentRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? payloadInput : undefined)),
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi
              .fn()
              .mockImplementation((root: string) => root === parentRootHex && hasParentPayload),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? ({slot: 1} as ProtoBlock) : null)),
            getBlockHexAndBlockHash: vi
              .fn()
              .mockImplementation((root: string, hash: string) =>
                root === parentRootHex && hash === toRootHex(parentPayloadHash) && hasParentPayload
                  ? ({slot: 1} as ProtoBlock)
                  : null
              ),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {
          sendExecutionPayloadEnvelopesByRoot,
          sendBeaconBlocksByRoot,
        },
        peers: [{peerId: peer}],
      });

      emitter.emit(ChainEvent.blockUnknownParent, {
        blockInput: childBlockInput,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledWith(peer, [parentRoot]);
      expect(sendBeaconBlocksByRoot).not.toHaveBeenCalled();
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
      expect(processBlock).toHaveBeenCalledTimes(1);
      expect(processBlock).toHaveBeenCalledWith(
        childBlockInput,
        expect.objectContaining({ignoreIfKnown: true, ignoreIfFinalized: true, blsVerifyOnMainThread: true})
      );
    });

    it("resolvePayloadSlot prefers pending block (S2), then fork choice (S3), then seen cache (S4)", () => {
      const getBlockHexDefaultStatus = vi.fn().mockReturnValue(null);
      const seenGet = vi.fn().mockReturnValue(undefined);
      setupPayloadSyncTest({
        chainOverrides: {
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: seenGet,
            remove: vi.fn(),
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockReturnValue(false),
            getBlockHexDefaultStatus,
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
      });

      const svc = service as unknown as {
        resolvePayloadSlot: (rootHex: string) => number | undefined;
        pendingBlocks: Map<string, BlockInputSyncCacheItem>;
      };
      const rootHex = toRootHex(Buffer.alloc(32, 0xe1));

      // no trusted source -> undefined
      expect(svc.resolvePayloadSlot(rootHex)).toBeUndefined();

      // S4: seen payload envelope cache
      seenGet.mockReturnValue({slot: 50});
      expect(svc.resolvePayloadSlot(rootHex)).toBe(50);

      // S3: fork choice overrides S4
      getBlockHexDefaultStatus.mockReturnValue({slot: 40} as ProtoBlock);
      expect(svc.resolvePayloadSlot(rootHex)).toBe(40);

      // S2: a pending block of the same root overrides S3
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 30;
      svc.pendingBlocks.set(rootHex, {
        status: PendingBlockInputStatus.downloaded,
        blockInput: createGloasBlockInput({
          block,
          blockRootHex: rootHex,
          seenTimestampSec: 0,
          source: BlockInputSource.gossip,
        }),
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });
      expect(svc.resolvePayloadSlot(rootHex)).toBe(30);
    });

    it("prunes pending payloads and blocks below the finalized block slot on ChainEvent.forkChoiceFinalized", () => {
      const finalizedEpoch = 4;
      // Simulate a skipped epoch boundary: the finalized block sits below computeStartSlotAtEpoch(epoch).
      // The prune must use the actual finalized block slot, not the epoch boundary, otherwise it would
      // wrongly drop the finalized block's own payload and payloads in the (finalizedBlockSlot, boundary) gap.
      const epochBoundarySlot = computeStartSlotAtEpoch(finalizedEpoch);
      const finalizedBlockSlot = epochBoundarySlot - 2;

      // A slot-less payload whose block is in fork choice (S3) below finality -> resolved + pruned.
      const rootHexResolvable = toRootHex(Buffer.alloc(32, 0xa5));
      const resolvableSlot = finalizedBlockSlot - 4;

      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockReturnValue(false),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) =>
                root === rootHexResolvable ? ({slot: resolvableSlot} as ProtoBlock) : null
              ),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: finalizedBlockSlot} as ProtoBlock),
          } as unknown as IForkChoice,
        },
      });

      const pendingPayloads = (service as unknown as {pendingPayloads: Map<string, PayloadSyncCacheItem>})
        .pendingPayloads;
      const pendingBlocks = (service as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;

      // PendingPayloadRootHex just below the finalized block slot -> pruned
      const rootHexBelow = toRootHex(Buffer.alloc(32, 0xa1));
      pendingPayloads.set(rootHexBelow, {
        status: PendingPayloadInputStatus.pending,
        rootHex: rootHexBelow,
        slot: finalizedBlockSlot - 1,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // PendingPayloadRootHex at the finalized block slot -> retained (its payload may still be needed by a
      // not-yet-imported successor; prune is strict `<`)
      const rootHexAtFinalized = toRootHex(Buffer.alloc(32, 0xa2));
      pendingPayloads.set(rootHexAtFinalized, {
        status: PendingPayloadInputStatus.pending,
        rootHex: rootHexAtFinalized,
        slot: finalizedBlockSlot,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // PendingPayloadRootHex in the (finalizedBlockSlot, epochBoundarySlot) gap -> retained. Regression guard:
      // an epoch-boundary cutoff would wrongly prune this.
      const rootHexBetween = toRootHex(Buffer.alloc(32, 0xa3));
      pendingPayloads.set(rootHexBetween, {
        status: PendingPayloadInputStatus.pending,
        rootHex: rootHexBetween,
        slot: finalizedBlockSlot + 1,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // PendingPayloadInput below finality -> pruned (slot resolved from payloadInput.slot)
      const {blockRootHex: inputRootHex, payloadInput} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: finalizedBlockSlot - 2,
      });
      pendingPayloads.set(inputRootHex, {
        status: PendingPayloadInputStatus.pending,
        payloadInput,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // PendingPayloadEnvelope below finality -> pruned (slot resolved from envelope slotNumber)
      const {blockRootHex: envelopeRootHex, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: finalizedBlockSlot - 3,
      });
      pendingPayloads.set(envelopeRootHex, {
        status: PendingPayloadInputStatus.waitingForBlock,
        envelope,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // slot-less PendingPayloadRootHex, resolved from fork choice (S3) at prune time -> pruned
      pendingPayloads.set(rootHexResolvable, {
        status: PendingPayloadInputStatus.pending,
        rootHex: rootHexResolvable,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // slot-less PendingPayloadRootHex with no trusted source, recently added -> retained until aged out
      const rootHexUnresolvableRecent = toRootHex(Buffer.alloc(32, 0xa6));
      pendingPayloads.set(rootHexUnresolvableRecent, {
        status: PendingPayloadInputStatus.pending,
        rootHex: rootHexUnresolvableRecent,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      });

      // slot-less PendingPayloadRootHex with no trusted source, added long ago -> aged out and pruned
      const rootHexUnresolvableStale = toRootHex(Buffer.alloc(32, 0xa8));
      pendingPayloads.set(rootHexUnresolvableStale, {
        status: PendingPayloadInputStatus.pending,
        rootHex: rootHexUnresolvableStale,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      expect(pendingPayloads.size).toBe(8);

      // PendingBlockInput below finality -> pruned (slot resolved from blockInput.slot)
      const blockBelow = ssz.gloas.SignedBeaconBlock.defaultValue();
      blockBelow.message.slot = finalizedBlockSlot - 1;
      const blockBelowRootHex = toRootHex(getGloasBlockRoot(blockBelow));
      pendingBlocks.set(blockBelowRootHex, {
        status: PendingBlockInputStatus.downloaded,
        blockInput: createGloasBlockInput({
          block: blockBelow,
          blockRootHex: blockBelowRootHex,
          seenTimestampSec: 0,
          source: BlockInputSource.gossip,
        }),
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // PendingBlockInput at the finalized block slot -> retained
      const blockAtFinalized = ssz.gloas.SignedBeaconBlock.defaultValue();
      blockAtFinalized.message.slot = finalizedBlockSlot;
      const blockAtFinalizedRootHex = toRootHex(getGloasBlockRoot(blockAtFinalized));
      pendingBlocks.set(blockAtFinalizedRootHex, {
        status: PendingBlockInputStatus.downloaded,
        blockInput: createGloasBlockInput({
          block: blockAtFinalized,
          blockRootHex: blockAtFinalizedRootHex,
          seenTimestampSec: 0,
          source: BlockInputSource.gossip,
        }),
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // slot-less PendingRootHex added long ago -> aged out and pruned
      const rootOnlyStaleHex = toRootHex(Buffer.alloc(32, 0xb1));
      pendingBlocks.set(rootOnlyStaleHex, {
        status: PendingBlockInputStatus.pending,
        rootHex: rootOnlyStaleHex,
        timeAddedSec: 0,
        peerIdStrings: new Set(),
      });

      // slot-less PendingRootHex added recently -> retained for a later download attempt
      const rootOnlyRecentHex = toRootHex(Buffer.alloc(32, 0xb2));
      pendingBlocks.set(rootOnlyRecentHex, {
        status: PendingBlockInputStatus.pending,
        rootHex: rootOnlyRecentHex,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      });

      expect(pendingBlocks.size).toBe(4);

      const checkpoint: CheckpointWithHex = {
        epoch: finalizedEpoch,
        root: Buffer.alloc(32, 0xcc),
        rootHex: toRootHex(Buffer.alloc(32, 0xcc)),
      };
      emitter.emit(ChainEvent.forkChoiceFinalized, checkpoint);

      expect(pendingPayloads.has(rootHexBelow)).toBe(false);
      expect(pendingPayloads.has(inputRootHex)).toBe(false);
      expect(pendingPayloads.has(envelopeRootHex)).toBe(false);
      expect(pendingPayloads.has(rootHexResolvable)).toBe(false);
      expect(pendingPayloads.has(rootHexUnresolvableStale)).toBe(false);
      expect(pendingPayloads.has(rootHexAtFinalized)).toBe(true);
      expect(pendingPayloads.has(rootHexBetween)).toBe(true);
      expect(pendingPayloads.has(rootHexUnresolvableRecent)).toBe(true);
      expect(pendingPayloads.size).toBe(3);

      expect(pendingBlocks.has(blockBelowRootHex)).toBe(false);
      expect(pendingBlocks.has(rootOnlyStaleHex)).toBe(false);
      expect(pendingBlocks.has(blockAtFinalizedRootHex)).toBe(true);
      expect(pendingBlocks.has(rootOnlyRecentHex)).toBe(true);
      expect(pendingBlocks.size).toBe(2);
    });

    it("upgrades a slot-less pending payload once a trusted slot becomes available", async () => {
      const peerA = await getRandPeerIdStr();
      const peerB = await getRandPeerIdStr();
      setupPayloadSyncTest({});

      const svc = service as unknown as {
        addByPayloadRootHex: (rootHex: string, peerIdStr?: PeerIdStr, slot?: number) => boolean;
        pendingPayloads: Map<string, PayloadSyncCacheItem>;
      };
      const rootHex = toRootHex(Buffer.alloc(32, 0xc1));

      // first queued slot-less (e.g. via onUnknownEnvelopeBlockRoot when no trusted slot resolved yet)
      expect(svc.addByPayloadRootHex(rootHex, peerA)).toBe(true);
      expect((svc.pendingPayloads.get(rootHex) as PendingPayloadRootHex).slot).toBeUndefined();

      // re-queued with a trusted slot (e.g. via the parentPayload path) -> slot is filled in, peers merged
      expect(svc.addByPayloadRootHex(rootHex, peerB, 42)).toBe(false);
      const upgraded = svc.pendingPayloads.get(rootHex) as PendingPayloadRootHex;
      expect(upgraded.slot).toBe(42);
      expect(upgraded.peerIdStrings.has(peerA)).toBe(true);
      expect(upgraded.peerIdStrings.has(peerB)).toBe(true);

      // a later, different slot must NOT overwrite an already-defined slot
      svc.addByPayloadRootHex(rootHex, undefined, 99);
      expect((svc.pendingPayloads.get(rootHex) as PendingPayloadRootHex).slot).toBe(42);
    });

    it("drops a child block when its parent payload hash conflicts with the known parent block", async () => {
      const peer = await getRandPeerIdStr();

      const parentBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      parentBlock.message.slot = 1;
      parentBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0x11);
      parentBlock.message.body.signedExecutionPayloadBid.message.blockHash = Buffer.alloc(32, 0x22);
      const parentRoot = ssz.gloas.BeaconBlock.hashTreeRoot(parentBlock.message);
      const parentRootHex = toRootHex(parentRoot);
      const parentPayloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: parentRootHex,
        block: parentBlock as SignedBeaconBlock<typeof ForkName.gloas>,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        seenTimestampSec: Date.now() / 1000,
        source: PayloadEnvelopeInputSource.byRange,
        daOutOfRange: false,
      });

      const childBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      childBlock.message.slot = 2;
      childBlock.message.parentRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0x33);
      const childBlockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(childBlock.message));
      const childBlockInput = createGloasBlockInput({
        block: childBlock,
        blockRootHex: childBlockRootHex,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.gossip,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn();
      const processBlock = vi.fn();
      const seenBlockInputPrune = vi.fn();
      const seenPayloadPrune = vi.fn();
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processBlock,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? parentPayloadInput : undefined)),
            prune: seenPayloadPrune,
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          seenBlockInputCache: {prune: seenBlockInputPrune} as unknown as SeenBlockInput,
          forkChoice: {
            // Parent payload is revealed/imported (FULL) but no variant matches the child's parentBlockHash.
            // getMissingBlockDependency defers the drop until the payload lands; only then is the conflict real.
            hasPayloadHexUnsafe: vi.fn().mockImplementation((root: string) => root === parentRootHex),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? ({slot: 0} as ProtoBlock) : null)),
            getBlockHexAndBlockHash: vi.fn().mockReturnValue(null),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });

      emitter.emit(ChainEvent.blockUnknownParent, {
        blockInput: childBlockInput,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);

      expect(sendExecutionPayloadEnvelopesByRoot).not.toHaveBeenCalled();
      expect(processBlock).not.toHaveBeenCalled();
      expect(seenBlockInputPrune).toHaveBeenCalledWith(childBlockRootHex);
      expect(seenPayloadPrune).not.toHaveBeenCalled();
    });

    it.each<PayloadErrorType>([
      {code: PayloadErrorCode.INVALID_SIGNATURE},
      {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: "parent_beacon_block_root mismatch"},
      {
        code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
        execStatus: ExecutionPayloadStatus.INVALID,
        errorMessage: "invalid payload",
      },
    ])("removes pending descendants and evicts the envelope after invalid parent payload $code", async (errorType) => {
      const peer = await getRandPeerIdStr();
      const parentPayloadHash = Buffer.alloc(32, 0x33);
      const {
        blockRoot: parentRoot,
        blockRootHex: parentRootHex,
        payloadInput,
        envelope,
      } = buildPayloadFixture({
        blobCount: 0,
        blockHash: parentPayloadHash,
        sampledColumns: [],
        slot: 1,
      });

      const childBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      childBlock.message.slot = 2;
      childBlock.message.parentRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentPayloadHash;
      const childBlockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(childBlock.message));
      const childBlockInput = createGloasBlockInput({
        block: childBlock,
        blockRootHex: childBlockRootHex,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.gossip,
      });

      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const processExecutionPayload = vi.fn().mockRejectedValue(new PayloadError(payloadInput, errorType));
      const processBlock = vi.fn().mockResolvedValue(undefined);
      const seenPayloadPrune = vi.fn();
      const seenPayloadRemoveInvalid = vi.fn();
      const {emitter} = setupPayloadSyncTest({
        chainOverrides: {
          processExecutionPayload,
          processBlock,
          seenPayloadEnvelopeInputCache: {
            add: vi.fn(),
            get: vi.fn().mockImplementation((root: string) => (root === parentRootHex ? payloadInput : undefined)),
            getOrReload: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? payloadInput : undefined)),
            prune: seenPayloadPrune,
            removeInvalid: seenPayloadRemoveInvalid,
          } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
          forkChoice: {
            hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
            hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
            getBlockHexDefaultStatus: vi
              .fn()
              .mockImplementation((root: string) => (root === parentRootHex ? ({slot: 1} as ProtoBlock) : null)),
            getBlockHexAndBlockHash: vi.fn().mockReturnValue(null),
            getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
          } as unknown as IForkChoice,
        },
        networkOverrides: {sendExecutionPayloadEnvelopesByRoot},
        peers: [{peerId: peer}],
      });

      emitter.emit(ChainEvent.blockUnknownParent, {
        blockInput: childBlockInput,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processBlock).not.toHaveBeenCalled();
      expect(seenPayloadPrune).not.toHaveBeenCalled();
      expect(seenPayloadRemoveInvalid).toHaveBeenCalledExactlyOnceWith(payloadInput);

      emitter.emit(routes.events.EventType.executionPayload, {
        slot: 99,
        builderIndex: 0,
        blockHash: toRootHex(Buffer.alloc(32, 0x44)),
        blockRoot: toRootHex(Buffer.alloc(32, 0x55)),
        executionOptimistic: false,
      });

      await sleep(20);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processBlock).not.toHaveBeenCalled();
    });
  });

  it("re-queues downloaded gloas ancestors that are still missing the block body", async () => {
    const gloasConfig = createBeaconConfig(
      {...minimalConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0},
      Buffer.alloc(32, 0)
    );
    const peer = await getRandPeerIdStr();
    const parentRoot = Buffer.alloc(32, 0x11);
    const parentBlockHash = Buffer.alloc(32, 0x22);
    const {block, blockInput, blockRootHex, parentBlockHashHex, parentRootHex} = buildIncompleteGloasBlockInput({
      parentRoot,
      parentBlockHash,
      slot: 1,
    });

    const sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([block]);

    const processBlock = vi.fn().mockResolvedValue(undefined);
    const networkEvents = new NetworkEventBus();
    network = {
      events: networkEvents,
      getConnectedPeers: () => [peer],
      getConnectedPeerSyncMeta: () => ({
        peerId: peer,
        client: "gloas-test-client",
        custodyColumns: [],
        earliestAvailableSlot: 0,
      }),
      custodyConfig: {
        sampledColumns: [],
        sampleGroups: Array.from({length: gloasConfig.SAMPLES_PER_SLOT}, () => []),
      } as unknown as CustodyConfig,
      sendBeaconBlocksByRoot,
    } as Partial<INetwork> as INetwork;

    const chainForTest: Partial<IBeaconChain> = {
      emitter: new ChainEventEmitter(),
      config: gloasConfig,
      clock: new ClockStopped(0),
      custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
      genesisTime: 0,
      metrics: null,
      pubkeyCache,
      processBlock,
      forkChoice: {
        getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        hasBlockHex: vi.fn().mockImplementation((rootHex: string) => rootHex === parentRootHex),
        getBlockHexDefaultStatus: vi
          .fn()
          .mockImplementation((rootHex: string) => (rootHex === parentRootHex ? ({slot: 0} as ProtoBlock) : null)),
        getBlockHexAndBlockHash: vi
          .fn()
          .mockImplementation((rootHex: string, blockHashHex: string) =>
            rootHex === parentRootHex && blockHashHex === parentBlockHashHex ? ({} as ProtoBlock) : null
          ),
        hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
      } as unknown as IForkChoice,
      seenPayloadEnvelopeInputCache: {
        add: vi.fn(),
        get: vi.fn(),
        getOrReload: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn(),
      } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      seenBlockInputCache: {
        prune: vi.fn(),
        isVerifiedProposerSignature: vi.fn().mockReturnValue(true),
      } as unknown as SeenBlockInput,
      seenBlockProposers: {
        isKnown: vi.fn().mockReturnValue(false),
      } as unknown as SeenBlockProposers,
    };

    service = new BlockInputSync(gloasConfig, network, chainForTest as IBeaconChain, logger, null, defaultSyncOptions);
    service.subscribeToNetwork();

    const pendingBlocks = (service as unknown as {pendingBlocks: Map<string, BlockInputSyncCacheItem>}).pendingBlocks;
    pendingBlocks.set(blockRootHex, {
      status: PendingBlockInputStatus.downloaded,
      blockInput,
      timeAddedSec: 0,
      peerIdStrings: new Set([peer]),
    });

    networkEvents.emit(NetworkEvent.peerConnected, {
      peer,
      status: {} as never,
      custodyColumns: [],
      clientAgent: "gloas-test-client",
    });

    await sleep(20);

    expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();
    expect(processBlock).toHaveBeenCalledOnce();
    expect(pendingBlocks.has(blockRootHex)).toBe(false);

    service.close();
  });
});

describe("UnknownBlockPeerBalancer", async () => {
  const peer0 = await getRandPeerSyncMeta("peer-0");
  const peer1 = await getRandPeerSyncMeta("peer-1");
  const peer2 = await getRandPeerSyncMeta("peer-2");
  const peer3 = await getRandPeerSyncMeta("peer-3");
  const peers = [peer0, peer1, peer2, peer3];
  const peersMeta = new Map<string, PeerSyncMeta>(peers.map((p) => [p.peerId, p]));

  // column 0 and 1 are downloaded
  // column 2 and 3 are pending
  const testCases: {
    custodyGroups: number[][];
    excludedPeers: PeerIdStr[];
    activeRequests: number[];
    bestPeer: PeerSyncMeta | null;
  }[] = [
    {
      // test excludedPeers condition
      // peers[2] and peers[3] are eligible
      // peers[2] is excluded because it's requested
      custodyGroups: [[0], [1], [2], [3]],
      excludedPeers: [peers[2].peerId],
      activeRequests: [0, 0, 0, 0],
      bestPeer: peers[3],
    },
    {
      // test activeRequest condition
      // peers[2] and peers[3] have custody groups
      // peers[3] has 2 active requests so it's not eligible
      custodyGroups: [[0], [1], [2], [3]],
      excludedPeers: [],
      activeRequests: [0, 0, 0, 2],
      bestPeer: peers[2],
    },
    {
      // test all conditions
      // peers[0] and peers[1] does not have pending columns
      // peers[2] is excluded because it's requested
      // peers[3] has 2 active requests so it's not eligible
      custodyGroups: [[0], [1], [2], [3]],
      excludedPeers: [peers[2].peerId],
      activeRequests: [0, 0, 0, 2],
      bestPeer: null,
    },
  ];

  let peerBalancer: UnknownBlockPeerBalancer;
  beforeEach(() => {
    peerBalancer = new UnknownBlockPeerBalancer();
    for (const [peerId, peerMeta] of peersMeta.entries()) {
      peerBalancer.onPeerConnected(peerId, peerMeta);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const [testCaseIndex, {custodyGroups, excludedPeers, activeRequests, bestPeer}] of testCases.entries()) {
    for (const [i, groups] of custodyGroups.entries()) {
      peers[i].custodyColumns = groups;
    }

    it(`bestPeerForPendingColumns - test case ${testCaseIndex}`, () => {
      for (const [i, activeRequest] of activeRequests.entries()) {
        for (let j = 0; j < activeRequest; j++) {
          peerBalancer.onRequest(peers[i].peerId);
        }
      }
      const peer = peerBalancer.bestPeerForPendingColumns(new Set([2, 3]), new Set(excludedPeers));
      if (bestPeer) {
        expect(peer).toEqual(bestPeer);
      } else {
        expect(peer).toBeNull();
      }
    });
  } // end for testCases

  it("skips rate-limited peers until their backoff expires", () => {
    vi.useFakeTimers();
    const now = 10_000;
    vi.setSystemTime(now);

    peers[0].custodyColumns = [0];
    peers[1].custodyColumns = [1];
    peers[2].custodyColumns = [1];
    peers[3].custodyColumns = [1];

    peerBalancer.onRateLimited(peer0.peerId, now + 1_000);

    expect(peerBalancer.getNextRateLimitRetryAt(new Set([0]), new Set())).toBe(now + 1_000);
    expect(peerBalancer.bestPeerForPendingColumns(new Set([0]), new Set())).toBeNull();

    vi.setSystemTime(now + 1_000);
    const peer = peerBalancer.bestPeerForPendingColumns(new Set([0]), new Set());
    expect(peer?.peerId).toBe(peer0.peerId);
    expect(peerBalancer.getNextRateLimitRetryAt(new Set([0]), new Set())).toBeNull();
  });

  it("stops picking a peer before it exceeds the by-root quota peers enforce", () => {
    vi.useFakeTimers();
    const now = 10_000;
    vi.setSystemTime(now);

    peers[0].custodyColumns = [0];
    peers[1].custodyColumns = [1];
    peers[2].custodyColumns = [1];
    peers[3].custodyColumns = [1];

    for (let i = 0; i < 64; i++) {
      expect(peerBalancer.bestPeerForPendingColumns(new Set([0]), new Set())?.peerId).toBe(peer0.peerId);
      peerBalancer.onRequestCompleted(peer0.peerId);
    }
    expect(peerBalancer.bestPeerForPendingColumns(new Set([0]), new Set())).toBeNull();
    expect(peerBalancer.getNextRateLimitRetryAt(new Set([0]), new Set())).toBe(now + 10_000);

    vi.setSystemTime(now + 10_000);
    expect(peerBalancer.bestPeerForPendingColumns(new Set([0]), new Set())?.peerId).toBe(peer0.peerId);
  });

  it("reschedules around the earliest tracked rate limit", () => {
    vi.useFakeTimers();
    const now = 20_000;
    vi.setSystemTime(now);

    peerBalancer.onRateLimited(peer0.peerId, now + 1_000);
    peerBalancer.onRateLimited(peer1.peerId, now + 500);
    expect(peerBalancer.getNextRateLimitRetryAt()).toBe(now + 500);

    peerBalancer.onPeerDisconnected(peer1.peerId);
    expect(peerBalancer.getNextRateLimitRetryAt()).toBe(now + 1_000);

    peerBalancer.onRateLimited(peer2.peerId, now + 250);
    expect(peerBalancer.getNextRateLimitRetryAt()).toBe(now + 250);
  });
});
