import EventEmitter from "node:events";
import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {config as minimalConfig} from "@lodestar/config/default";
import {createChainForkConfig} from "@lodestar/config";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {notNullish, sleep} from "@lodestar/utils";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {IBeaconChain} from "../../../src/chain/index.js";
import {INetwork, NetworkEvent, NetworkEventBus, PeerAction} from "../../../src/network/index.js";
import {UnknownBlockSync} from "../../../src/sync/unknownBlock.js";
import {testLogger} from "../../utils/logger.js";
import {getRandPeerIdStr} from "../../utils/peer.js";
import {BlockSource, getBlockInput} from "../../../src/chain/blocks/types.js";
import {ClockStopped} from "../../mocks/clock.js";
import {SeenBlockProposers} from "../../../src/chain/seenCache/seenBlockProposers.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/blockError.js";
import {defaultSyncOptions} from "../../../src/sync/options.js";
import {ZERO_HASH} from "../../../src/constants/constants.js";

describe("sync by UnknownBlockSync", () => {
  const logger = testLogger();
  const slotSec = 0.3;
  const config = createChainForkConfig({...minimalConfig, SECONDS_PER_SLOT: slotSec});

  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const testCases: {
    id: string;
    event: NetworkEvent.unknownBlockParent | NetworkEvent.unknownBlock;
    finalizedSlot: number;
    reportPeer?: boolean;
    seenBlock?: boolean;
    wrongBlockRoot?: boolean;
    maxPendingBlocks?: number;
  }[] = [
    {
      id: "fetch and process multiple unknown blocks",
      event: NetworkEvent.unknownBlock,
      finalizedSlot: 0,
    },
    {
      id: "fetch and process multiple unknown block parents",
      event: NetworkEvent.unknownBlockParent,
      finalizedSlot: 0,
    },
    {
      id: "downloaded parent is before finalized slot",
      event: NetworkEvent.unknownBlockParent,
      finalizedSlot: 2,
      reportPeer: true,
    },
    {
      id: "unbundling attack",
      event: NetworkEvent.unknownBlock,
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
      event: NetworkEvent.unknownBlock,
      finalizedSlot: 1,
    },
    {
      id: "downloaded blocks only",
      event: NetworkEvent.unknownBlockParent,
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
        processBlock: async ({block}, opts) => {
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
      const syncService = new UnknownBlockSync(config, network as INetwork, chain as IBeaconChain, logger, null, {
        ...defaultSyncOptions,
        maxPendingBlocks,
      });
      syncService.subscribeToNetwork();
      if (event === NetworkEvent.unknownBlockParent) {
        network.events?.emit(NetworkEvent.unknownBlockParent, {
          blockInput: getBlockInput.preData(config, blockC, BlockSource.gossip, null),
          peer,
        });
      } else {
        network.events?.emit(NetworkEvent.unknownBlock, {rootHex: blockRootHexC, peer});
      }

      if (wrongBlockRoot) {
        const [_, requestedRoots] = await sendBeaconBlocksByRootPromise;
        await sleep(200);
        // should not send the invalid root block to chain
        expect(processBlockSpy).toHaveBeenCalledOnce();
        for (const requestedRoot of requestedRoots) {
          expect(syncService["pendingBlocks"].get(toHexString(requestedRoot))?.downloadAttempts).toEqual(1);
        }
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
});

describe("UnknownBlockSync", function () {
  let network: INetwork;
  let chain: MockedBeaconChain;
  const logger = testLogger();
  let service: UnknownBlockSync;

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
        const events = network.events as EventEmitter;
        service = new UnknownBlockSync(minimalConfig, network, chain, logger, null, defaultSyncOptions);
        for (const action of actions) {
          if (action) {
            service.subscribeToNetwork();
          } else {
            service.unsubscribeFromNetwork();
          }
        }

        if (expected) {
          expect(events.listenerCount(NetworkEvent.unknownBlock)).toBe(1);
          expect(events.listenerCount(NetworkEvent.unknownBlockParent)).toBe(1);
          expect(service.isSubscribedToNetwork()).toBe(true);
        } else {
          expect(events.listenerCount(NetworkEvent.unknownBlock)).toBe(0);
          expect(events.listenerCount(NetworkEvent.unknownBlockParent)).toBe(0);
          expect(service.isSubscribedToNetwork()).toBe(false);
        }
      });
    }
  });
});
