import {GENESIS_SLOT, MAX_REQUEST_BLOCKS} from "@lodestar/params";
import {eip4844, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ContextBytesType, EncodedPayload, EncodedPayloadType, ResponseError, RespStatus} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

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
): AsyncIterable<EncodedPayload<eip4844.BlobsSidecar>> {
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

  if (startSlot <= finalizedSlot) {
    // Chain of blobs won't change
    for await (const {key, value} of db.blobsSidecarArchive.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
      yield {
        type: EncodedPayloadType.bytes,
        bytes: value,
        contextBytes: {
          type: ContextBytesType.ForkDigest,
          forkSlot: db.blockArchive.decodeKey(key),
        },
      };
    }
  }

  // Non-finalized tram of blobs

  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    // TODO EIP-4844: forkChoice should mantain an array of canonical blocks, and change only on reorg
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);

    // Iterate head chain with ascending block numbers
    for (const block of headChain) {
      // Must include only blocks in the range requested
      if (block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the cannonical chain
        // at the time of the start of the request. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blockBytes = await db.blobsSidecar.getBinary(fromHex(block.blockRoot));
        if (blockBytes) {
          yield {
            type: EncodedPayloadType.bytes,
            bytes: blockBytes,
            contextBytes: {
              type: ContextBytesType.ForkDigest,
              forkSlot: block.slot,
            },
          };
        }
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}
