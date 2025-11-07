import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ColumnIndex, fulu} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.ts";
import {
  handleColumnSidecarUnavailability,
  validateRequestedDataColumns,
} from "../utils/dataColumnResponseValidation.js";

export async function* onDataColumnSidecarsByRange(
  request: fulu.DataColumnSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  // Non-finalized range of columns
  const {startSlot, count, columns: requestedColumns} = validateDataColumnSidecarsByRangeRequest(chain.config, request);
  const availableColumns = validateRequestedDataColumns(chain, requestedColumns);
  const endSlot = startSlot + count;

  if (availableColumns.length === 0) {
    return;
  }

  if (startSlot < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer did not respect earliestAvailableSlot for DataColumnSidecarsByRange", {
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
    });
    return;
  }

  const finalized = db.dataColumnSidecarArchive;
  const unfinalized = db.dataColumnSidecar;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized range of columns
  if (startSlot <= finalizedSlot) {
    for (let slot = startSlot; slot < endSlot; slot++) {
      const dataColumnSidecars = await finalized.getManyBinary(slot, availableColumns);

      const unavailableColumnIndices: ColumnIndex[] = [];
      for (let i = 0; i < dataColumnSidecars.length; i++) {
        const dataColumnSidecarBytes = dataColumnSidecars[i];
        if (dataColumnSidecarBytes) {
          yield {
            data: dataColumnSidecarBytes,
            boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
          };
        }

        // TODO: Check blobs for that block and respond resource_unavailable
        // After we have consensus from other teams on the specs
        else {
          unavailableColumnIndices.push(availableColumns[i]);
        }
      }

      if (unavailableColumnIndices.length) {
        await handleColumnSidecarUnavailability({
          chain,
          db,
          metrics: chain.metrics,
          unavailableColumnIndices,
          slot,
          requestedColumns,
          availableColumns,
        });
      }
    }
  }

  // Non-finalized range of columns
  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only columns in the range requested
      if (block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // at the time of the start of the request. Spec is clear the chain of columns must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/ad36024441cf910d428d03f87f331fbbd2b3e5f1/specs/fulu/p2p-interface.md#L425-L429
        const dataColumnSidecars = await unfinalized.getManyBinary(fromHex(block.blockRoot), availableColumns);

        const unavailableColumnIndices: ColumnIndex[] = [];
        for (let i = 0; i < dataColumnSidecars.length; i++) {
          const dataColumnSidecarBytes = dataColumnSidecars[i];
          if (dataColumnSidecarBytes) {
            yield {
              data: dataColumnSidecarBytes,
              boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
            };
          }

          // TODO: Check blobs for that block and respond resource_unavailable
          // After we have consensus from other teams on the specs
          else {
            unavailableColumnIndices.push(availableColumns[i]);
          }
        }

        if (unavailableColumnIndices.length) {
          await handleColumnSidecarUnavailability({
            chain,
            db,
            metrics: chain.metrics,
            unavailableColumnIndices,
            blockRoot: fromHex(block.blockRoot),
            slot: block.slot,
            requestedColumns,
            availableColumns,
          });
        }
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}

export function validateDataColumnSidecarsByRangeRequest(
  config: ChainConfig,
  request: fulu.DataColumnSidecarsByRangeRequest
): fulu.DataColumnSidecarsByRangeRequest {
  const {startSlot, columns} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count, columns};
}
