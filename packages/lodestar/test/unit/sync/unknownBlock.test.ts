import {config} from "@chainsafe/lodestar-config/default";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";
import {notNullish, sleep} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {IBeaconChain} from "../../../src/chain";
import {INetwork, IReqResp, NetworkEvent, NetworkEventBus} from "../../../src/network";
import {UnknownBlockSync} from "../../../src/sync/unknownBlock";
import {testLogger} from "../../utils/logger";
import {getValidPeerId} from "../../utils/peer";

describe("sync / UnknownBlockSync", () => {
  const logger = testLogger();

  it("fetch and process multiple unknown block parents", async () => {
    const peer = getValidPeerId();
    const peerIdStr = peer.toB58String();
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

    const reqResp: Partial<IReqResp> = {
      beaconBlocksByRoot: async (_peer, roots) =>
        Array.from(roots)
          .map((root) => blocksByRoot.get(toHexString(root)))
          .filter(notNullish),
    };

    const network: Partial<INetwork> = {
      events: new NetworkEventBus(),
      getSyncedPeers: () => [peer],
      reqResp: reqResp as IReqResp,
    };

    const forkChoiceKnownRoots = new Set([blockRootHex0]);
    const forkChoice: Pick<IForkChoice, "hasBlock"> = {
      hasBlock: (root) => forkChoiceKnownRoots.has(toHexString(root)),
    };

    const chain: Partial<IBeaconChain> = {
      forkChoice: forkChoice as IForkChoice,
      processBlock: async (block) => {
        if (!forkChoice.hasBlock(block.message.parentRoot)) throw Error("Unknown parent");
        // Simluate adding the block to the forkchoice
        const blockRootHex = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
        forkChoiceKnownRoots.add(blockRootHex);
      },
    };

    new UnknownBlockSync(config, network as INetwork, chain as IBeaconChain, logger, null);
    network.events?.emit(NetworkEvent.unknownBlockParent, blockC, peerIdStr);

    // Wait for all blocks to be in ForkChoice store
    while (forkChoiceKnownRoots.size < 3) {
      await sleep(10);
    }

    // After completing the sync, all blocks should be in the ForkChoice
    expect(Array.from(forkChoiceKnownRoots.values())).to.deep.equal(
      [blockRootHex0, blockRootHexA, blockRootHexB, blockRootHexC],
      "Wrong blocks in mock ForkChoice"
    );
  });
});
