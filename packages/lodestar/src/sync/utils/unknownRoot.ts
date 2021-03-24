import {Root, phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {INetwork} from "../../network";
import {shuffle} from "../../util/shuffle";

export async function fetchUnknownBlockRoot(
  unknownAncestorRoot: Root,
  network: INetwork
): Promise<phase0.SignedBeaconBlock> {
  const connectedPeers = shuffle(network.getConnectedPeers());

  for (const peer of connectedPeers) {
    const blocks = await network.reqResp.beaconBlocksByRoot(peer, [unknownAncestorRoot] as List<Root>);
    if (blocks && blocks[0]) {
      return blocks[0];
    }
  }

  throw Error("No peers left");
}
