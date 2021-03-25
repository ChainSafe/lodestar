import {Root, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {List, toHexString} from "@chainsafe/ssz";
import {INetwork} from "../../network";
import {shuffle} from "../../util/shuffle";

export async function fetchUnknownBlockRoot(
  unknownAncestorRoot: Root,
  network: INetwork,
  logger: ILogger
): Promise<phase0.SignedBeaconBlock> {
  const connectedPeers = shuffle(network.getConnectedPeers());
  const parentRootHex = toHexString(unknownAncestorRoot);

  for (const [i, peer] of connectedPeers.entries()) {
    try {
      const blocks = await network.reqResp.beaconBlocksByRoot(peer, [unknownAncestorRoot] as List<Root>);
      if (blocks && blocks[0]) {
        return blocks[0];
      }
    } catch (e) {
      logger.debug("Error fetching UnknownBlockRoot", {i, parentRootHex}, e);
    }
  }

  throw Error("No peers left");
}
