import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {BeaconBlocksByRootRequest} from "../../../util/types.js";

export async function* onBeaconBlocksByRoot(
  requestBody: BeaconBlocksByRootRequest,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  for (const blockRoot of requestBody) {
    const root = blockRoot;
    const block = await chain.getSerializedBlockByRoot(toRootHex(root));

    if (block) {
      yield {
        data: block.block,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
      };
    }
  }
}
