import {GENESIS_SLOT, MAX_REQUEST_BLOCKS} from "@lodestar/params";
import {eip4844, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {RespStatus} from "../../../constants/index.js";
import {ResponseError} from "../response/index.js";

/** This type helps response to beacon_block_by_range and beacon_block_by_root more efficiently */
export type ReqRespBlobsResponse = {
  /** Deserialized data of allForks.SignedBeaconBlock */
  bytes: Uint8Array;
  slot: Slot;
};

// TODO: Unit test

export async function* onBlobsSidecarsByRange(
  requestBody: eip4844.BlobsSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ReqRespBlobsResponse> {
  const {startSlot} = requestBody;
  let {count} = requestBody;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  if (count > MAX_REQUEST_BLOCKS) {
    count = MAX_REQUEST_BLOCKS;
  }

  const endSlot = startSlot + count;

  // SPEC: Clients MUST respond with blobs sidecars from their view of the current fork choice -- that is, blobs
  // sidecars as included by blocks from the single chain defined by the current head. Of note, blocks from slots
  // before the finalization MUST lead to the finalized block reported in the Status handshake.
  // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized tram of blobs
  // TODO EIP-4844: Should the finalized block be included here or below?

  if (endSlot <= finalizedSlot) {
    // Chain of blobs won't change
    for await (const {key, value} of db.blobsSidecarArchive.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
      yield {bytes: value, slot: db.blockArchive.decodeKey(key)};
    }
  }

  // Non-finalized tram of blobs

  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    // TODO EIP-4844: forkChoice should mantain an array of canonical blocks, and change only on reorg
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);

    for (const blockSummary of headChain) {
      // Must include only blocks with slot < endSlot
      if (blockSummary.slot >= endSlot) {
        break;
      }

      const blockBytes = await db.blobsSidecar.getBinary(fromHex(blockSummary.blockRoot));
      if (blockBytes) {
        yield {bytes: blockBytes, slot: blockSummary.slot};
      }
    }
  }
}
