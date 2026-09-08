import {BLOB_SIDECAR_FIXED_SIZE} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {ServingContext} from "../../../chain/serving/context.js";
import {BlobSidecarsByRootRequest} from "../../../util/types.js";

export async function* onBlobSidecarsByRoot(
  requestBody: BlobSidecarsByRootRequest,
  chain: IBeaconChain,
  context?: ServingContext
): AsyncIterable<ResponseOutgoing> {
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Spec: [max(current_epoch - MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS, DENEB_FORK_EPOCH), current_epoch]
  const currentEpoch = chain.clock.currentEpoch;
  const minimumRequestEpoch = Math.max(
    currentEpoch - chain.config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS,
    chain.config.DENEB_FORK_EPOCH
  );

  // In sidecars by root request, it can be expected that sidecar requests will be come
  // clustured by blockroots, and this helps us save db lookups once we load sidecars
  // for a root
  let lastFetchedSideCars: {blockRoot: RootHex; bytes: Uint8Array} | null = null;

  for (const blobIdentifier of requestBody) {
    const {blockRoot, index} = blobIdentifier;
    const blockRootHex = toRootHex(blockRoot);
    const blockSlot = chain.forkChoice.getBlockHexDefaultStatus(blockRootHex)?.slot;

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting blocks and sidecars since the latest finalized epoch.
    // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#beaconblockandblobssidecarbyroot-v1
    if (blockSlot === undefined || blockSlot <= finalizedSlot) {
      continue;
    }

    if (computeEpochAtSlot(blockSlot) < minimumRequestEpoch) {
      continue;
    }

    // Check if we need to load sidecars for a new block root
    if (lastFetchedSideCars === null || lastFetchedSideCars.blockRoot !== blockRootHex) {
      const blobSidecarsBytes = await chain.getSerializedBlobSidecars(blockSlot, blockRootHex, context);
      if (!blobSidecarsBytes) {
        // Handle the same to onBeaconBlocksByRange
        throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${blockRootHex} slot ${blockSlot}`);
      }

      lastFetchedSideCars = {blockRoot: blockRootHex, bytes: blobSidecarsBytes};
    }

    context?.checkBacking(lastFetchedSideCars.bytes);
    const blobSidecarBytes = lastFetchedSideCars.bytes.slice(
      index * BLOB_SIDECAR_FIXED_SIZE,
      (index + 1) * BLOB_SIDECAR_FIXED_SIZE
    );
    if (blobSidecarBytes.length !== BLOB_SIDECAR_FIXED_SIZE) {
      throw Error(
        `Inconsistent state, blobSidecar blockRoot=${blockRootHex} index=${index} blobSidecarBytes=${blobSidecarBytes.length} expected=${BLOB_SIDECAR_FIXED_SIZE}`
      );
    }

    yield {
      data: blobSidecarBytes,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(blockSlot)),
    };
  }
}
