import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {ForkSeq, GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ColumnIndex, Epoch, fulu} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.js";
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
  const {
    startSlot,
    count,
    columns: requestedColumns,
  } = validateDataColumnSidecarsByRangeRequest(chain.config, chain.clock.currentEpoch, request);
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
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;
  // Columns of the last finalized block live in different DBs depending on fork:
  // - Pre-gloas (fulu): migrated to dataColumnSidecarArchive in the same finalization run.
  // - Post-gloas: stay in the hot db (db.dataColumnSidecar) until the next finalization run,
  //   because the migration filter requires payloadStatus === FULL for gloas blocks.
  // archiveMaxSlot is the last slot whose columns are served by the archive loop below;
  // anything above it is served by the headChain loop.
  const isPostGloasFinalized = chain.config.getForkSeq(finalizedSlot) >= ForkSeq.gloas;
  const archiveMaxSlot = isPostGloasFinalized ? finalizedSlot - 1 : finalizedSlot;

  // Finalized range of columns
  if (startSlot <= archiveMaxSlot) {
    const archiveEnd = Math.min(endSlot, archiveMaxSlot + 1);
    for (let slot = startSlot; slot < archiveEnd; slot++) {
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
  if (endSlot > archiveMaxSlot) {
    const headBlock = chain.forkChoice.getHead();
    const headRoot = headBlock.blockRoot;
    // getAllAncestorBlocks includes the last finalized block as its final element.
    // Skip anything the archive loop above already served via the block.slot > archiveMaxSlot
    // filter below (pre-gloas this skips finalizedSlot, post-gloas it keeps it).
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot, headBlock.payloadStatus);

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only columns in the range requested
      if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // at the time of the start of the request. Spec is clear the chain of columns must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/ad36024441cf910d428d03f87f331fbbd2b3e5f1/specs/fulu/p2p-interface.md#L425-L429
        const dataColumnSidecars = await chain.getSerializedDataColumnSidecars(
          block.slot,
          block.blockRoot,
          availableColumns
        );

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
  currentEpoch: Epoch,
  request: fulu.DataColumnSidecarsByRangeRequest
): fulu.DataColumnSidecarsByRangeRequest {
  const {startSlot, columns} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // Spec: [max(current_epoch - MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS, FULU_FORK_EPOCH), current_epoch]
  const minimumRequestEpoch = Math.max(
    currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS,
    config.FULU_FORK_EPOCH
  );
  if (computeEpochAtSlot(startSlot) < minimumRequestEpoch) {
    throw new ResponseError(
      RespStatus.RESOURCE_UNAVAILABLE,
      "startSlot is before MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS"
    );
  }

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count, columns};
}
