import {GENESIS_SLOT, MAX_REQUEST_BLOCKS} from "@lodestar/params";
import {ResponseError, ResponseOutgoing, RespStatus} from "@lodestar/reqresp";
import {deneb, phase0} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

// TODO: Unit test

export function onBeaconBlocksByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  return onBlocksOrBlobSidecarsByRange(request, chain, {
    finalized: db.blockArchive,
    unfinalized: db.block,
  });
}

export async function* onBlocksOrBlobSidecarsByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: {
    finalized: Pick<IBeaconDb["blockArchive"], "binaryEntriesStream" | "decodeKey">;
    unfinalized: Pick<IBeaconDb["block"], "getBinary">;
  }
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateBeaconBlocksByRangeRequest(request);
  const endSlot = startSlot + count;

  // SPEC: Clients MUST respond with blobs sidecars from their view of the current fork choice -- that is, blobs
  // sidecars as included by blocks from the single chain defined by the current head. Of note, blocks from slots
  // before the finalization MUST lead to the finalized block reported in the Status handshake.
  // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized range of blobs
  // TODO DENEB: Should the finalized block be included here or below?

  if (startSlot <= finalizedSlot) {
    // Chain of blobs won't change
    for await (const {key, value} of db.finalized.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
      // It's a bis sus that deleting this line will still let the code compile..
      // This code MUST include tests to ensure ReqResp works with full or blinded blocks
      yield {
        data: await this.blindedBlockToFullBytes(value),
        fork: chain.config.getForkName(db.finalized.decodeKey(key)),
      };
    }
  }

  // Non-finalized range of blobs

  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    // TODO DENEB: forkChoice should mantain an array of canonical blocks, and change only on reorg
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);
    // getAllAncestorBlocks response includes the head node, so it's the full chain.

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only blocks in the range requested
      if (block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // at the time of the start of the request. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blockBytes = await db.unfinalized.getBinary(fromHex(block.blockRoot));
        if (!blockBytes) {
          // Handle the same to onBeaconBlocksByRange
          throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
        }

        // It's a bis sus that deleting this line will still let the code compile..
        // This code MUST include tests to ensure ReqResp works with full or blinded blocks
        yield {
          data: await chain.blindedBlockToFullBytes(blockBytes),
          fork: chain.config.getForkName(block.slot),
        };
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}

export function validateBeaconBlocksByRangeRequest(
  request: deneb.BlobSidecarsByRangeRequest
): deneb.BlobSidecarsByRangeRequest {
  const {startSlot} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // step > 1 is deprecated, see https://github.com/ethereum/consensus-specs/pull/2856

  if (count > MAX_REQUEST_BLOCKS) {
    count = MAX_REQUEST_BLOCKS;
  }

  return {startSlot, count};
}
