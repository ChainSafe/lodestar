import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {notNullish, sleep} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../src/chain/index.js";
import {INetwork, NetworkEvent, NetworkEventBus, PeerAction} from "../../../src/network/index.js";
import {UnknownBlockSync} from "../../../src/sync/unknownBlock.js";
import {testLogger} from "../../utils/logger.js";
import {getValidPeerId} from "../../utils/peer.js";
import {getBlockInput} from "../../../src/chain/blocks/types.js";

describe("sync / UnknownBlockSync", () => {
  const logger = testLogger();

  const testCases: {id: string; finalizedSlot: number; reportPeer: boolean}[] = [
    {id: "fetch and process multiple unknown block parents", finalizedSlot: 0, reportPeer: false},
    {id: "downloaded parent is before finalized slot", finalizedSlot: 2, reportPeer: true},
  ];

  for (const {id, finalizedSlot, reportPeer} of testCases) {
    it(id, async () => {
      const peer = getValidPeerId();
      const peerIdStr = peer.toString();
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
      ]);

      let reportPeerResolveFn: (value: Parameters<INetwork["reportPeer"]>) => void;
      const reportPeerPromise = new Promise<Parameters<INetwork["reportPeer"]>>((r) => (reportPeerResolveFn = r));

      const network: Partial<INetwork> = {
        events: new NetworkEventBus(),
        getConnectedPeers: () => [peer],
        beaconBlocksMaybeBlobsByRoot: async (_peerId, roots) =>
          Array.from(roots)
            .map((root) => blocksByRoot.get(toHexString(root)))
            .filter(notNullish)
            .map((block) => getBlockInput.preDeneb(config, block)),

        reportPeer: async (peerId, action, actionName) => reportPeerResolveFn([peerId, action, actionName]),
      };

      const forkChoiceKnownRoots = new Set([blockRootHex0]);
      const forkChoice: Pick<IForkChoice, "hasBlock" | "getFinalizedBlock"> = {
        hasBlock: (root) => forkChoiceKnownRoots.has(toHexString(root)),
        getFinalizedBlock: () => ({slot: finalizedSlot} as ProtoBlock),
      };

      const chain: Partial<IBeaconChain> = {
        forkChoice: forkChoice as IForkChoice,
        processBlock: async ({block}) => {
          if (!forkChoice.hasBlock(block.message.parentRoot)) throw Error("Unknown parent");
          // Simluate adding the block to the forkchoice
          const blockRootHex = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
          forkChoiceKnownRoots.add(blockRootHex);
        },
      };

      new UnknownBlockSync(config, network as INetwork, chain as IBeaconChain, logger, null);
      network.events?.emit(NetworkEvent.unknownBlockParent, getBlockInput.preDeneb(config, blockC), peerIdStr);

      if (reportPeer) {
        const err = await reportPeerPromise;
        expect(err[0].toString()).equal(peerIdStr);
        expect([err[1], err[2]]).to.be.deep.equal([PeerAction.LowToleranceError, "BadBlockByRoot"]);
      } else {
        // happy path
        // Wait for all blocks to be in ForkChoice store
        while (forkChoiceKnownRoots.size < 3) {
          await sleep(10);
        }

        // After completing the sync, all blocks should be in the ForkChoice
        expect(Array.from(forkChoiceKnownRoots.values())).to.deep.equal(
          [blockRootHex0, blockRootHexA, blockRootHexB, blockRootHexC],
          "Wrong blocks in mock ForkChoice"
        );
      }
    });
  }
});
