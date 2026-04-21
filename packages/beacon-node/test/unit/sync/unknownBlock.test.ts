import EventEmitter from "node:events";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as minimalConfig} from "@lodestar/config/default";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, gloas, ssz} from "@lodestar/types";
import {notNullish, sleep, toRootHex} from "@lodestar/utils";
import {BlockInputPreData} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, DAType, IBlockInput} from "../../../src/chain/blocks/blockInput/types.js";
import {PayloadError, PayloadErrorCode} from "../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {
  CreateFromBlockProps,
  PayloadEnvelopeInputSource,
} from "../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/blockError.js";
import {ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../src/chain/index.js";
import {SeenBlockProposers} from "../../../src/chain/seenCache/seenBlockProposers.js";
import {SeenBlockInput} from "../../../src/chain/seenCache/seenGossipBlockInput.js";
import {validateGloasBlockDataColumnSidecars} from "../../../src/chain/validation/dataColumnSidecar.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../src/chain/validation/executionPayloadEnvelope.js";
import {INetwork, NetworkEvent, NetworkEventBus} from "../../../src/network/index.js";
import {PeerSyncMeta} from "../../../src/network/peers/peersData.js";
import {defaultSyncOptions} from "../../../src/sync/options.js";
import {BlockInputSync, UnknownBlockPeerBalancer} from "../../../src/sync/unknownBlock.js";
import {BlockInputSyncCacheItem, PendingBlockInputStatus} from "../../../src/sync/types.js";
import {CustodyConfig} from "../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../src/util/peerId.js";
import {ClockStopped} from "../../mocks/clock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getRandPeerIdStr, getRandPeerSyncMeta} from "../../utils/peer.js";

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
    timeCreatedSec: Date.now() / 1000,
  });

  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  envelope.message.beaconBlockRoot = blockRoot;
  envelope.message.slot = slot;

  const columnSidecars = sampledColumns.map((index) => {
    const columnSidecar = ssz.gloas.DataColumnSidecar.defaultValue();
    columnSidecar.beaconBlockRoot = blockRoot;
    columnSidecar.slot = slot;
    columnSidecar.index = index;
    return columnSidecar;
  });

  return {block, blockRootHex, blockRoot, payloadInput, envelope, columnSidecars};
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
  const slotSec = 0.3;
  const config = createChainForkConfig({
    ...minimalConfig,
    SLOT_DURATION_MS: slotSec * 1000,
  });

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
  }[] = [
    {
      id: "fetch and process multiple unknown blocks",
      event: ChainEvent.unknownBlockRoot,
      finalizedSlot: 0,
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
      // Peer reporting is currently disabled in source (commented out in removeAndDownScoreAllDescendants)
      // Test verifies blocks are cleaned up from pendingBlocks instead
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
  } of testCases) {
    it(id, async () => {
      const peer = await getRandPeerIdStr();
      const blockA = ssz.phase0.SignedBeaconBlock.defaultValue();
      const blockB = ssz.phase0.SignedBeaconBlock.defaultValue();
      const blockC = ssz.phase0.SignedBeaconBlock.defaultValue();
      blockA.message.slot = 1;
      blockB.message.slot = 2;
      blockC.message.slot = 3;
      const blockRoot0 = Buffer.alloc(32, 0x00);
      const blockRootA = ssz.phase0.BeaconBlock.hashTreeRoot(blockA.message);
      blockB.message.parentRoot = blockRootA;
      const blockRootB = ssz.phase0.BeaconBlock.hashTreeRoot(blockB.message);
      blockC.message.parentRoot = blockRootB;
      const blockRootC = ssz.phase0.BeaconBlock.hashTreeRoot(blockC.message);
      const blockRootHex0 = toHexString(blockRoot0);
      const blockRootHexA = toHexString(blockRootA);
      const blockRootHexB = toHexString(blockRootB);
      const blockRootHexC = toHexString(blockRootC);

      const blocksByRoot = new Map([
        [blockRootHexA, blockA],
        [blockRootHexB, blockB],
        [blockRootHexC, blockC],
      ]);

      let sendBeaconBlocksByRootResolveFn: (value: Parameters<INetwork["sendBeaconBlocksByRoot"]>) => void;
      const sendBeaconBlocksByRootPromise = new Promise<Parameters<INetwork["sendBeaconBlocksByRoot"]>>((r) => {
        sendBeaconBlocksByRootResolveFn = r;
      });

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
        custodyConfig: {sampledColumns: []} as unknown as CustodyConfig,
        sendBeaconBlocksByRoot: async (_peerId, roots) => {
          sendBeaconBlocksByRootResolveFn([_peerId, roots]);
          const correctBlocks = Array.from(roots)
            .map((root) => blocksByRoot.get(toHexString(root)))
            .filter(notNullish);
          return wrongBlockRoot ? [ssz.phase0.SignedBeaconBlock.defaultValue()] : correctBlocks;
        },
      };

      const forkChoiceKnownRoots = new Set([blockRootHex0]);
      const forkChoice: Pick<IForkChoice, "hasBlock" | "hasBlockHex" | "getFinalizedBlock"> = {
        hasBlock: (root) => forkChoiceKnownRoots.has(toHexString(root)),
        hasBlockHex: (rootHex) => forkChoiceKnownRoots.has(rootHex),
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
        processBlock: async (blockInput, opts) => {
          const block = blockInput.getBlock();
          if (!forkChoice.hasBlock(block.message.parentRoot)) throw Error("Unknown parent");
          const blockSlot = block.message.slot;
          if (blockSlot <= finalizedSlot && !opts?.ignoreIfFinalized) {
            // same behavior to BeaconChain to reproduce https://github.com/ChainSafe/lodestar/issues/5650
            throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
          }
          // Simulate adding the block to the forkchoice
          const blockRootHex = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
          forkChoiceKnownRoots.add(blockRootHex);
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
            block: any;
            blockRootHex: string;
            seenTimestampSec: number;
            source: BlockInputSource;
          }) =>
            BlockInputPreData.createFromBlock({
              block,
              blockRootHex,
              forkName: config.getForkName(block.message.slot),
              daOutOfRange: false,
              seenTimestampSec,
              source,
            }),
          prune: () => {},
        } as unknown as SeenBlockInput,
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
        status: {} as any,
        custodyColumns: [],
        clientAgent: "test-client",
      });

      if (event === ChainEvent.blockUnknownParent) {
        emitter.emit(ChainEvent.blockUnknownParent, {
          blockInput: BlockInputPreData.createFromBlock({
            block: blockC,
            blockRootHex: blockRootHexC,
            forkName: config.getForkName(blockC.message.slot),
            daOutOfRange: false,
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
      } else if (reportPeer) {
        // Wait for the network request to happen, then allow async processing to complete
        await sendBeaconBlocksByRootPromise;
        await sleep(200);
        // Downloaded block is before finalized slot, so blocks should be cleaned up
        // (peer reporting is currently disabled in removeAndDownScoreAllDescendants)
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
        if (seenBlock) {
          const proposerBoostWindowMs = config.getAttestationDueMs(config.getForkName(blockC.message.slot));
          expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), proposerBoostWindowMs);
        } else {
          expect(setTimeoutSpy).not.toHaveBeenCalled();
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
          expect(events.listenerCount(ChainEvent.envelopeUnknownBlock)).toBe(1);
          expect(events.listenerCount(ChainEvent.incompletePayloadEnvelope)).toBe(1);
          expect(events.listenerCount(routes.events.EventType.block)).toBe(1);
          expect(events.listenerCount(routes.events.EventType.executionPayload)).toBe(1);
          expect(service.isSubscribedToNetwork()).toBe(true);
        } else {
          expect(events.listenerCount(ChainEvent.unknownBlockRoot)).toBe(0);
          expect(events.listenerCount(ChainEvent.blockUnknownParent)).toBe(0);
          expect(events.listenerCount(ChainEvent.unknownEnvelopeBlockRoot)).toBe(0);
          expect(events.listenerCount(ChainEvent.envelopeUnknownBlock)).toBe(0);
          expect(events.listenerCount(ChainEvent.incompletePayloadEnvelope)).toBe(0);
          expect(events.listenerCount(routes.events.EventType.block)).toBe(0);
          expect(events.listenerCount(routes.events.EventType.executionPayload)).toBe(0);
          expect(service.isSubscribedToNetwork()).toBe(false);
        }
      });
    }
  });

  describe("payload sync flows", () => {
    const gloasConfig = createBeaconConfig(
      {...minimalConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0},
      Buffer.alloc(32, 0)
    );

    beforeEach(() => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      vi.mocked(validateGossipExecutionPayloadEnvelope).mockClear();
      vi.mocked(validateGloasBlockDataColumnSidecars).mockClear();
    });

    it("fetches and processes unknown envelope by root when payload input exists", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
        blobCount: 1,
        sampledColumns: [0],
        slot: 1,
      });

      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendDataColumnSidecarsByRoot = vi.fn().mockResolvedValue(columnSidecars);
      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [0],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [0], sampleGroups: [[0]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
        sendDataColumnSidecarsByRoot,
      };

      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(true),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [0],
        clientAgent: "payload-test-client",
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

    it("continues fetching sampled columns across peers until payload input is complete", async () => {
      const peerA = await getRandPeerIdStr();
      const peerB = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope, columnSidecars} = buildPayloadFixture({
        blobCount: 1,
        sampledColumns: [0, 1],
        slot: 1,
      });

      const networkEvents = new NetworkEventBus();
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
      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? payloadInput : undefined)),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(true),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peerA, peerB],
        getConnectedPeerSyncMeta: (peerId: string) => ({
          peerId,
          client: `payload-test-client-${peerId === peerA ? "a" : "b"}`,
          custodyColumns: peerId === peerA ? [0] : [1],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [0, 1], sampleGroups: [[0], [1]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
        sendDataColumnSidecarsByRoot,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      for (const peer of [peerA, peerB]) {
        networkEvents.emit(NetworkEvent.peerConnected, {
          peer,
          status: {} as never,
          custodyColumns: peer === peerA ? [0] : [1],
          clientAgent: `payload-test-client-${peer === peerA ? "a" : "b"}`,
        });
      }

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

      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([block]);
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const emitter = new ChainEventEmitter();
      const processBlock = vi.fn().mockImplementation(async () => {
        cachedPayloadInput = payloadInput;
        knownRoots.add(blockRootHex);
        emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});
      });

      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processBlock,
        processExecutionPayload,
        getBlockByRoot: vi.fn().mockResolvedValue(null),
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? cachedPayloadInput : undefined)),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {
          getByBlock: ({
            block,
            blockRootHex,
            seenTimestampSec,
            source,
          }: {
            block: SignedBeaconBlock;
            blockRootHex: string;
            seenTimestampSec: number;
            source: BlockInputSource;
          }) =>
            BlockInputPreData.createFromBlock({
              block,
              blockRootHex,
              forkName: gloasConfig.getForkName(block.message.slot),
              daOutOfRange: false,
              seenTimestampSec,
              source,
            }),
          prune: vi.fn(),
        } as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockImplementation((root: string) => knownRoots.has(root)),
          getBlockHexAndBlockHash: vi
            .fn()
            .mockImplementation((root: string, hash: string) =>
              root === parentRootHex &&
              hash === toHexString(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
                ? ({slot: 0} as ProtoBlock)
                : null
            ),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
        sendBeaconBlocksByRoot,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "payload-test-client",
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

    it("waits for block after envelopeUnknownBlock and processes payload on block import", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });

      let cachedPayloadInput: PayloadEnvelopeInput | undefined;
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        getBlockByRoot: vi.fn().mockResolvedValue(null),
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? cachedPayloadInput : undefined)),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(false),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      const network: Partial<INetwork> = {
        events: new NetworkEventBus(),
        getConnectedPeers: () => [],
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      emitter.emit(ChainEvent.envelopeUnknownBlock, {
        envelope,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);
      expect(processExecutionPayload).not.toHaveBeenCalled();

      cachedPayloadInput = payloadInput;
      emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});

      await sleep(50);

      expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledOnce();
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
      expect(payloadInput.hasPayloadEnvelope()).toBe(true);
    });

    it("refetches by root if a queued envelope fails validation after block import", async () => {
      const peer = await getRandPeerIdStr();
      const {blockRoot, blockRootHex, payloadInput, envelope} = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });

      const invalidEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      invalidEnvelope.message.beaconBlockRoot = blockRoot;
      invalidEnvelope.message.slot = 1;

      vi.mocked(validateGossipExecutionPayloadEnvelope).mockImplementationOnce(async (_chain, signedEnvelope) => {
        if (signedEnvelope === invalidEnvelope) {
          throw new Error("invalid queued envelope");
        }
      });

      let cachedPayloadInput: PayloadEnvelopeInput | undefined;
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        getBlockByRoot: vi.fn().mockResolvedValue(null),
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? cachedPayloadInput : undefined)),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(true),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi
        .fn()
        .mockResolvedValueOnce([invalidEnvelope])
        .mockResolvedValueOnce([envelope]);
      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "payload-test-client",
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).not.toHaveBeenCalled();

      cachedPayloadInput = payloadInput;
      emitter.emit(routes.events.EventType.block, {slot: 1, block: blockRootHex, executionOptimistic: false});

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(2);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenNthCalledWith(1, peer, [blockRoot]);
      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenNthCalledWith(2, peer, [blockRoot]);
      expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
      expect(payloadInput.hasPayloadEnvelope()).toBe(true);
    });

    it("refetches a replacement envelope after payload import rejects the cached one", async () => {
      const peer = await getRandPeerIdStr();
      const {
        block,
        blockRoot,
        blockRootHex,
        payloadInput,
        envelope: invalidEnvelope,
      } = buildPayloadFixture({
        blobCount: 0,
        sampledColumns: [],
        slot: 1,
      });

      const recoveryEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      recoveryEnvelope.message.beaconBlockRoot = blockRoot;
      recoveryEnvelope.message.slot = 1;

      const processExecutionPayload = vi
        .fn()
        .mockRejectedValueOnce(
          new PayloadError({
            code: PayloadErrorCode.STATE_TRANSITION_ERROR,
            message: "bad payload envelope",
          })
        )
        .mockResolvedValueOnce(undefined);
      let cachedPayloadInput: PayloadEnvelopeInput | undefined = payloadInput;
      const prunePayloadInput = vi.fn().mockImplementation((root: string) => {
        if (root === blockRootHex) {
          cachedPayloadInput = undefined;
        }
      });
      const addPayloadInput = vi.fn().mockImplementation((props: CreateFromBlockProps) => {
        cachedPayloadInput = PayloadEnvelopeInput.createFromBlock(props);
        return cachedPayloadInput;
      });
      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
        getBlockByRoot: vi.fn().mockResolvedValue({block, executionOptimistic: false, finalized: false}),
        seenPayloadEnvelopeInputCache: {
          add: addPayloadInput,
          get: vi.fn().mockImplementation((root: string) => (root === blockRootHex ? cachedPayloadInput : undefined)),
          prune: prunePayloadInput,
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(true),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi
        .fn()
        .mockResolvedValueOnce([invalidEnvelope])
        .mockResolvedValueOnce([recoveryEnvelope]);
      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "payload-test-client",
      });

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(prunePayloadInput).toHaveBeenCalledWith(blockRootHex);
      expect(cachedPayloadInput).toBeUndefined();

      emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
        rootHex: blockRootHex,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(50);

      expect(sendExecutionPayloadEnvelopesByRoot).toHaveBeenCalledTimes(2);
      expect(processExecutionPayload).toHaveBeenCalledTimes(2);
      expect(addPayloadInput).toHaveBeenCalledTimes(1);
      expect(cachedPayloadInput).toBeDefined();
      expect(processExecutionPayload).toHaveBeenNthCalledWith(2, cachedPayloadInput);
      expect(cachedPayloadInput?.hasPayloadEnvelope()).toBe(true);
      expect(cachedPayloadInput?.getPayloadEnvelope()).toBe(recoveryEnvelope);
    });

    it("processes incomplete payload envelope input without network fetch", async () => {
      const peer = await getRandPeerIdStr();
      const {payloadInput, envelope} = buildPayloadFixture({blobCount: 0, sampledColumns: [], slot: 1});
      payloadInput.addPayloadEnvelope({
        envelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const network: Partial<INetwork> = {
        events: new NetworkEventBus(),
        getConnectedPeers: () => [],
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
      };
      const processExecutionPayload = vi.fn().mockResolvedValue(undefined);
      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockReturnValue(payloadInput),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockReturnValue(true),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      emitter.emit(ChainEvent.incompletePayloadEnvelope, {
        payloadInput,
        peer,
        source: BlockInputSource.gossip,
      });

      await sleep(20);

      expect(processExecutionPayload).toHaveBeenCalledTimes(1);
      expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput);
    });

    it("recovers parent payload for unknown parent block when parent block is already known", async () => {
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
      const childBlockInput = BlockInputPreData.createFromBlock({
        block: childBlock,
        blockRootHex: childBlockRootHex,
        forkName: gloasConfig.getForkName(childBlock.message.slot),
        daOutOfRange: false,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.gossip,
      });

      let hasParentPayload = false;
      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const sendBeaconBlocksByRoot = vi.fn();
      const processExecutionPayload = vi.fn().mockImplementation(async () => {
        hasParentPayload = true;
      });
      const processBlock = vi.fn().mockResolvedValue(undefined);

      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
        sendBeaconBlocksByRoot,
      };

      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        processBlock,
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === parentRootHex ? payloadInput : undefined)),
          prune: vi.fn(),
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockImplementation((root: string) => root === parentRootHex && hasParentPayload),
          hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
          getBlockHexDefaultStatus: vi
            .fn()
            .mockImplementation((root: string) => (root === parentRootHex ? ({slot: 1} as ProtoBlock) : null)),
          getBlockHexAndBlockHash: vi
            .fn()
            .mockImplementation((root: string, hash: string) =>
              root === parentRootHex && hash === toHexString(parentPayloadHash) && hasParentPayload
                ? ({slot: 1} as ProtoBlock)
                : null
            ),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "payload-test-client",
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
        timeCreatedSec: Date.now() / 1000,
      });

      const childBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      childBlock.message.slot = 2;
      childBlock.message.parentRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockRoot = parentRoot;
      childBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0x33);
      const childBlockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(childBlock.message));
      const childBlockInput = BlockInputPreData.createFromBlock({
        block: childBlock,
        blockRootHex: childBlockRootHex,
        forkName: gloasConfig.getForkName(childBlock.message.slot),
        daOutOfRange: false,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.gossip,
      });

      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi.fn();
      const processBlock = vi.fn();
      const seenBlockInputPrune = vi.fn();
      const seenPayloadPrune = vi.fn();

      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
      };

      const emitter = new ChainEventEmitter();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processBlock,
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === parentRootHex ? parentPayloadInput : undefined)),
          prune: seenPayloadPrune,
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: seenBlockInputPrune} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
          getBlockHexAndBlockHash: vi.fn().mockReturnValue(null),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "payload-test-client",
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
      expect(seenPayloadPrune).toHaveBeenCalledWith(childBlockRootHex);
    });

    it("removes pending descendants after invalid parent payload", async () => {
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
      const childBlockInput = BlockInputPreData.createFromBlock({
        block: childBlock,
        blockRootHex: childBlockRootHex,
        forkName: gloasConfig.getForkName(childBlock.message.slot),
        daOutOfRange: false,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.gossip,
      });

      const networkEvents = new NetworkEventBus();
      const sendExecutionPayloadEnvelopesByRoot = vi.fn().mockResolvedValue([envelope]);
      const processExecutionPayload = vi
        .fn()
        .mockRejectedValue(new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE}));
      const processBlock = vi.fn().mockResolvedValue(undefined);

      const network: Partial<INetwork> = {
        events: networkEvents,
        getConnectedPeers: () => [peer],
        getConnectedPeerSyncMeta: () => ({
          peerId: peer,
          client: "payload-test-client",
          custodyColumns: [],
          earliestAvailableSlot: 0,
        }),
        custodyConfig: {sampledColumns: [], sampleGroups: [[]]} as unknown as CustodyConfig,
        sendExecutionPayloadEnvelopesByRoot,
      };

      const emitter = new ChainEventEmitter();
      const seenPayloadPrune = vi.fn();
      const chain: Partial<IBeaconChain> = {
        emitter,
        clock: new ClockStopped(0),
        config: gloasConfig,
        genesisTime: 0,
        metrics: null,
        processExecutionPayload,
        processBlock,
        seenPayloadEnvelopeInputCache: {
          get: vi.fn().mockImplementation((root: string) => (root === parentRootHex ? payloadInput : undefined)),
          prune: seenPayloadPrune,
        } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
        seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
        seenBlockProposers: {isKnown: vi.fn().mockReturnValue(false)} as unknown as SeenBlockProposers,
        forkChoice: {
          hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
          hasBlockHex: vi.fn().mockImplementation((root: string) => root === parentRootHex),
          getBlockHexDefaultStatus: vi
            .fn()
            .mockImplementation((root: string) => (root === parentRootHex ? ({slot: 1} as ProtoBlock) : null)),
          getBlockHexAndBlockHash: vi.fn().mockReturnValue(null),
          getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        } as unknown as IForkChoice,
      };

      service = new BlockInputSync(
        gloasConfig,
        network as INetwork,
        chain as IBeaconChain,
        logger,
        null,
        defaultSyncOptions
      );
      service.subscribeToNetwork();

      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as never,
        custodyColumns: [],
        clientAgent: "payload-test-client",
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
      expect(seenPayloadPrune).toHaveBeenCalledWith(parentRootHex);

      emitter.emit(routes.events.EventType.executionPayload, {
        slot: 99,
        builderIndex: 0,
        blockHash: toRootHex(Buffer.alloc(32, 0x44)),
        blockRoot: toRootHex(Buffer.alloc(32, 0x55)),
        stateRoot: toRootHex(Buffer.alloc(32, 0x66)),
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
      genesisTime: 0,
      metrics: null,
      processBlock,
      forkChoice: {
        getFinalizedBlock: vi.fn().mockReturnValue({slot: 0} as ProtoBlock),
        hasBlockHex: vi.fn().mockImplementation((rootHex: string) => rootHex === parentRootHex),
        getBlockHexAndBlockHash: vi.fn().mockImplementation((rootHex: string, blockHashHex: string) =>
          rootHex === parentRootHex && blockHashHex === parentBlockHashHex ? ({} as ProtoBlock) : null
        ),
        hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
      } as unknown as IForkChoice,
      seenPayloadEnvelopeInputCache: {
        get: vi.fn(),
        prune: vi.fn(),
      } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
      seenBlockInputCache: {prune: vi.fn()} as unknown as SeenBlockInput,
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
});
