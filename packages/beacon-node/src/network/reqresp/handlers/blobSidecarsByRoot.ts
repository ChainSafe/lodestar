import {ResponseError, ResponseOutgoing, RespStatus} from "@lodestar/reqresp";
import {BLOBSIDECAR_FIXED_SIZE} from "@lodestar/params";
import {deneb, RootHex} from "@lodestar/types";
import {toHex, fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../../../db/repositories/blobSidecars.js";

export async function* onBlobSidecarsByRoot(
  requestBody: deneb.BlobSidecarsByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // In sidecars by root request, it can be expected that sidecar requests will be come
  // clustured by blockroots, and this helps us save db lookups once we load sidecars
  // for a root
  let lastFetchedSideCars: {blockRoot: RootHex; bytes: Uint8Array} | null = null;

  for (const blobIdentifier of requestBody) {
    const {blockRoot, index} = blobIdentifier;
    const blockRootHex = toHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting blocks and sidecars since the latest finalized epoch.
    // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#beaconblockandblobssidecarbyroot-v1
    if (!block || block.slot <= finalizedSlot) {
      continue;
    }

    // Check if we need to load sidecars for a new block root
    if (lastFetchedSideCars === null || lastFetchedSideCars.blockRoot !== blockRootHex) {
      const blobSideCarsBytesWrapped = await db.blobSidecars.getBinary(fromHex(block.blockRoot));
      if (!blobSideCarsBytesWrapped) {
        // Handle the same to onBeaconBlocksByRange
        throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
      }
      const blobSideCarsBytes = blobSideCarsBytesWrapped.slice(BLOB_SIDECARS_IN_WRAPPER_INDEX);

      lastFetchedSideCars = {blockRoot: blockRootHex, bytes: blobSideCarsBytes};
    }

    const blobSidecarBytes = lastFetchedSideCars.bytes.slice(
      index * BLOBSIDECAR_FIXED_SIZE,
      (index + 1) * BLOBSIDECAR_FIXED_SIZE
    );
    if (blobSidecarBytes.length !== BLOBSIDECAR_FIXED_SIZE) {
      throw Error(
        `Inconsistent state, blobSidecar blockRoot=${blockRootHex} index=${index} blobSidecarBytes=${blobSidecarBytes.length} expected=${BLOBSIDECAR_FIXED_SIZE}`
      );
    }

    yield {
      data: blobSidecarBytes,
      fork: chain.config.getForkName(block.slot),
    };
  }
}
