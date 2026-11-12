import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {BeaconBlocksByRootRequest} from "../../../util/types.js";

export async function* onBeaconBlocksByRoot(
  requestBody: BeaconBlocksByRootRequest,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  // The phase0 req/resp spec uses MIN_EPOCHS_FOR_BLOCK_REQUESTS to define the minimum range peers MUST serve.
  // Archival nodes may still serve older retained blocks to allow genesis sync.

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
