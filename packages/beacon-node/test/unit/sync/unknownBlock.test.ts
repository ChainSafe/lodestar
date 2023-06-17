import {expect} from "chai";
import sinon from "sinon";
import {config as minimalConfig} from "@lodestar/config/default";
import {createChainForkConfig} from "@lodestar/config";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {notNullish, sleep} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../src/chain/index.js";
import {INetwork, NetworkEvent, NetworkEventBus, PeerAction} from "../../../src/network/index.js";
import {UnknownBlockSync} from "../../../src/sync/unknownBlock.js";
import {testLogger} from "../../utils/logger.js";
import {getRandPeerIdStr} from "../../utils/peer.js";
import {BlockSource, getBlockInput} from "../../../src/chain/blocks/types.js";
import {ClockStopped} from "../../utils/mocks/clock.js";
import {SeenBlockProposers} from "../../../src/chain/seenCache/seenBlockProposers.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/blockError.js";
import {defaultSyncOptions} from "../../../src/sync/options.js";

describe("sync / UnknownBlockSync", () => {
  const logger = testLogger();
  const sandbox = sinon.createSandbox();
  const slotSec = 0.3;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createChainForkConfig({...minimalConfig, SECONDS_PER_SLOT: slotSec});

  beforeEach(() => {
    sandbox.useFakeTimers({shouldAdvanceTime: true});
  });

  afterEach(() => {
    sandbox.restore();
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
    {
      id: "peer returns incorrect root block",
      event: NetworkEvent.unknownBlock,
      finalizedSlot: 0,
      wrongBlockRoot: true,
    },
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
      const reportPeerPromise = new Promise<Parameters<INetwork["reportPeer"]>>((r) => (reportPeerResolveFn = r));
      let sendBeaconBlocksByRootResolveFn: (value: Parameters<INetwork["sendBeaconBlocksByRoot"]>) => void;
      const sendBeaconBlocksByRootPromise = new Promise<Parameters<INetwork["sendBeaconBlocksByRoot"]>>(
        (r) => (sendBeaconBlocksByRootResolveFn = r)
      );

      const network: Partial<INetwork> = {
        events: new NetworkEventBus(),
        getConnectedPeers: () => [peer],
        sendBeaconBlocksByRoot: async (_peerId, roots) => {
          sendBeaconBlocksByRootResolveFn([_peerId, roots]);
          const correctBlocks = Array.from(roots)
            .map((root) => blocksByRoot.get(toHexString(root)))
            .filter(notNullish);
          return wrongBlockRoot ? [ssz.phase0.SignedBeaconBlock.defaultValue()] : correctBlocks;
        },

        reportPeer: async (peerId, action, actionName) => reportPeerResolveFn([peerId, action, actionName]),
      };

      const forkChoiceKnownRoots = new Set([blockRootHex0]);
      const forkChoice: Pick<IForkChoice, "hasBlock" | "getFinalizedBlock"> = {
        hasBlock: (root) => forkChoiceKnownRoots.has(toHexString(root)),
        getFinalizedBlock: () => ({slot: finalizedSlot} as ProtoBlock),
      };
      const seenBlockProposers: Pick<SeenBlockProposers, "isKnown"> = {
        // only return seenBlock for blockC
        isKnown: (blockSlot) => (blockSlot === blockC.message.slot ? seenBlock : false),
      };

      let blockAResolver: () => void;
      let blockCResolver: () => void;
      const blockAProcessed = new Promise<void>((resolve) => (blockAResolver = resolve));
      const blockCProcessed = new Promise<void>((resolve) => (blockCResolver = resolve));

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

      const setTimeoutSpy = sandbox.spy(global, "setTimeout");
      const processBlockSpy = sandbox.spy(chain, "processBlock");
      const syncService = new UnknownBlockSync(config, network as INetwork, chain as IBeaconChain, logger, null, {
        ...defaultSyncOptions,
        maxPendingBlocks,
      });
      syncService.subscribeToNetwork();
      if (event === NetworkEvent.unknownBlockParent) {
        network.events?.emit(NetworkEvent.unknownBlockParent, {
          blockInput: getBlockInput.preDeneb(config, blockC, BlockSource.gossip),
          peer,
        });
      } else {
        network.events?.emit(NetworkEvent.unknownBlock, {rootHex: blockRootHexC, peer});
      }

      if (wrongBlockRoot) {
        const [_, requestedRoots] = await sendBeaconBlocksByRootPromise;
        await sleep(200);
        // should not send the invalid root block to chain
        expect(processBlockSpy.called).to.be.false;
        for (const requestedRoot of requestedRoots) {
          expect(syncService["pendingBlocks"].get(toHexString(requestedRoot))?.downloadAttempts).to.be.deep.equal(1);
        }
      } else if (reportPeer) {
        const err = await reportPeerPromise;
        expect(err[0]).equal(peer);
        expect([err[1], err[2]]).to.be.deep.equal([PeerAction.LowToleranceError, "BadBlockByRoot"]);
      } else if (maxPendingBlocks === 1) {
        await blockAProcessed;
        // not able to process blockB and blockC because maxPendingBlocks is 1
        expect(Array.from(forkChoiceKnownRoots.values())).to.deep.equal(
          [blockRootHex0, blockRootHexA],
          "Wrong blocks in mock ForkChoice"
        );
      } else {
        // Wait for all blocks to be in ForkChoice store
        await blockCProcessed;
        if (seenBlock) {
          expect(setTimeoutSpy).to.have.been.calledWithMatch({}, (slotSec / 3) * 1000);
        } else {
          expect(setTimeoutSpy).to.be.not.called;
        }

        // After completing the sync, all blocks should be in the ForkChoice
        expect(Array.from(forkChoiceKnownRoots.values())).to.deep.equal(
          [blockRootHex0, blockRootHexA, blockRootHexB, blockRootHexC],
          "Wrong blocks in mock ForkChoice"
        );
      }

      syncService.close();
    });
  }
});
