import EventEmitter from "node:events";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as minimalConfig} from "@lodestar/config/default";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {notNullish, sleep} from "@lodestar/utils";
import {BlockInputColumns, BlockInputPreData} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/blockError.js";
import {ChainEvent, IBeaconChain} from "../../../src/chain/index.js";
import {SeenBlockProposers} from "../../../src/chain/seenCache/seenBlockProposers.js";
import {ZERO_HASH} from "../../../src/constants/constants.js";
import {INetwork, NetworkEventBus, PeerAction} from "../../../src/network/index.js";
import {PeerSyncMeta} from "../../../src/network/peers/peersData.js";
import {defaultSyncOptions} from "../../../src/sync/options.js";
import {BlockInputSync, UnknownBlockPeerBalancer} from "../../../src/sync/unknownBlock.js";
import {CustodyConfig} from "../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../src/util/peerId.js";
import {ClockStopped} from "../../mocks/clock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {generateBlockWithColumnSidecars} from "../../utils/blocksAndData.js";
import {testLogger} from "../../utils/logger.js";
import {getRandPeerIdStr, getRandPeerSyncMeta} from "../../utils/peer.js";

describe.skip(
  "sync by UnknownBlockSync",
  () => {
    const logger = testLogger();
    const slotSec = 0.3;
    const config = createChainForkConfig({
      ...minimalConfig,
      SECONDS_PER_SLOT: slotSec,
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
      event: ChainEvent.unknownParent | ChainEvent.unknownBlockRoot;
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
        event: ChainEvent.unknownParent,
        finalizedSlot: 0,
      },
      {
        id: "downloaded parent is before finalized slot",
        event: ChainEvent.unknownParent,
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
        event: ChainEvent.unknownParent,
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

        let reportPeerResolveFn: (value: Parameters<INetwork["reportPeer"]>) => void;
        const reportPeerPromise = new Promise<Parameters<INetwork["reportPeer"]>>((r) => {
          reportPeerResolveFn = r;
        });
        let sendBeaconBlocksByRootResolveFn: (value: Parameters<INetwork["sendBeaconBlocksByRoot"]>) => void;
        const sendBeaconBlocksByRootPromise = new Promise<Parameters<INetwork["sendBeaconBlocksByRoot"]>>((r) => {
          sendBeaconBlocksByRootResolveFn = r;
        });

        const network: Partial<INetwork> = {
          events: new NetworkEventBus(),
          getConnectedPeers: () => [peer],
          sendBeaconBlocksByRoot: async (_peerId, roots) => {
            sendBeaconBlocksByRootResolveFn([_peerId, roots]);
            const correctBlocks = Array.from(roots)
              .map((root) => blocksByRoot.get(toHexString(root)))
              .filter(notNullish)
              .map((data) => ({data, bytes: ZERO_HASH}));
            return wrongBlockRoot
              ? [{data: ssz.phase0.SignedBeaconBlock.defaultValue(), bytes: ZERO_HASH}]
              : correctBlocks;
          },

          reportPeer: async (peerId, action, actionName) => reportPeerResolveFn([peerId, action, actionName]),
        };

        const forkChoiceKnownRoots = new Set([blockRootHex0]);
        const forkChoice: Pick<IForkChoice, "hasBlock" | "getFinalizedBlock"> = {
          hasBlock: (root) => forkChoiceKnownRoots.has(toHexString(root)),
          getFinalizedBlock: () =>
            ({
              slot: finalizedSlot,
            }) as ProtoBlock,
        };
        const seenBlockProposers: Pick<SeenBlockProposers, "isKnown"> = {
          // only return seenBlock for blockC
          isKnown: (blockSlot) => (blockSlot === blockC.message.slot ? seenBlock : false),
        };

        let blockAResolver: () => void;
        let blockCResolver: () => void;
        const blockAProcessed = new Promise<void>((resolve) => {
          blockAResolver = resolve;
        });
        const blockCProcessed = new Promise<void>((resolve) => {
          blockCResolver = resolve;
        });

        const chain: Partial<IBeaconChain> = {
          clock: new ClockStopped(0),
          forkChoice: forkChoice as IForkChoice,
          processBlock: async (blockInput, opts) => {
            const block = blockInput.getBlock();
            if (!forkChoice.hasBlock(block.message.parentRoot)) throw Error("Unknown parent");
            const blockSlot = block.message.slot;
            if (blockSlot <= finalizedSlot && !opts?.ignoreIfFinalized) {
              // same behavior to BeaconChain to reproduce https://github.com/ChainSafe/lodestar/issues/5650
              throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
            }
            // Simluate adding the block to the forkchoice
            const blockRootHex = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
            forkChoiceKnownRoots.add(blockRootHex);
            if (blockRootHex === blockRootHexC) blockCResolver();
            if (blockRootHex === blockRootHexA) blockAResolver();
          },
          seenBlockProposers: seenBlockProposers as SeenBlockProposers,
        };

        const setTimeoutSpy = vi.spyOn(global, "setTimeout");
        const processBlockSpy = vi.spyOn(chain, "processBlock");
        const syncService = new BlockInputSync(config, network as INetwork, chain as IBeaconChain, logger, null, {
          ...defaultSyncOptions,
          maxPendingBlocks,
        });
        syncService.subscribeToNetwork();
        if (event === ChainEvent.unknownParent) {
          chain.emitter?.emit(ChainEvent.unknownParent, {
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
          chain.emitter?.emit(ChainEvent.unknownBlockRoot, {
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
          const err = await reportPeerPromise;
          expect(err[0]).toBe(peer);
          expect([err[1], err[2]]).toEqual([PeerAction.LowToleranceError, "BadBlockByRoot"]);
        } else if (maxPendingBlocks === 1) {
          await blockAProcessed;
          // not able to process blockB and blockC because maxPendingBlocks is 1
          expect(Array.from(forkChoiceKnownRoots.values())).toEqual([blockRootHex0, blockRootHexA]);
        } else {
          // Wait for all blocks to be in ForkChoice store
          await blockCProcessed;
          if (seenBlock) {
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.objectContaining({}), (slotSec / 3) * 1000);
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
  },
  {timeout: 20_000}
);

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
          expect(events.listenerCount(ChainEvent.unknownParent)).toBe(1);
          expect(service.isSubscribedToNetwork()).toBe(true);
        } else {
          expect(events.listenerCount(ChainEvent.unknownBlockRoot)).toBe(0);
          expect(events.listenerCount(ChainEvent.unknownParent)).toBe(0);
          expect(service.isSubscribedToNetwork()).toBe(false);
        }
      });
    }
  });
});

describe("UnknownBlockPeerBalancer", async () => {
  const custodyConfig = {sampledColumns: [0, 1, 2, 3]} as CustodyConfig;
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

    const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    signedBlock.message.body.blobKzgCommitments = [ssz.fulu.KZGCommitment.defaultValue()];
    const {block, rootHex, columnSidecars} = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
    const blockInput = BlockInputColumns.createFromBlock({
      block: block,
      blockRootHex: rootHex,
      forkName: ForkName.fulu,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: Math.floor(Date.now() / 1000),
      custodyColumns: custodyConfig.custodyColumns,
      sampledColumns: custodyConfig.sampledColumns,
    });

    // test cases rely on first 2 columns being known, the rest unknown
    for (const sidecar of columnSidecars.slice(0, 2)) {
      blockInput.addColumn({
        columnSidecar: sidecar,
        blockRootHex: rootHex,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        source: BlockInputSource.gossip,
      });
    }

    it(`bestPeerForBlockInput - test case ${testCaseIndex}`, () => {
      for (const [i, activeRequest] of activeRequests.entries()) {
        for (let j = 0; j < activeRequest; j++) {
          peerBalancer.onRequest(peers[i].peerId);
        }
      }
      const peer = peerBalancer.bestPeerForBlockInput(blockInput, new Set(excludedPeers));
      if (bestPeer) {
        expect(peer).toEqual(bestPeer);
      } else {
        expect(peer).toBeNull();
      }
    });

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
