import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fromHex, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {BlobSidecarsByRootRequest} from "../../../util/types.js";

export async function* onBlobSidecarsByRoot(
  requestBody: BlobSidecarsByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  for (const blobIdentifier of requestBody) {
    const {blockRoot, index} = blobIdentifier;
    const blockRootHex = toRootHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting blocks and sidecars since the latest finalized epoch.
    // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#beaconblockandblobssidecarbyroot-v1
    if (!block || block.slot <= finalizedSlot) {
      continue;
    }

    const blobSidecarBytes = await db.blobSidecar.getBinary(
      {
        blockRoot: fromHex(block.blockRoot),
        slot: block.slot,
      },
      index
    );

    if (!blobSidecarBytes) {
      // Handle the same to onBeaconBlocksByRange
      throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
    }

    yield {
      data: blobSidecarBytes,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
    };
  }
}
