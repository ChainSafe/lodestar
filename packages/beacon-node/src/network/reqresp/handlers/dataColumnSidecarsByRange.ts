import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkSeq, GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ColumnIndex, Epoch, fulu} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
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

  // endSlot is exclusive, so highest served slot is endSlot - 1.
  // Throw only when the entire requested range is below earliestAvailableSlot.
  if (endSlot - 1 < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer requested range before earliestAvailableSlot for DataColumnSidecarsByRange", {
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
      startSlot,
      count,
      earliestAvailableSlot: chain.earliestAvailableSlot,
    });
    throw new ResponseError(
      RespStatus.RESOURCE_UNAVAILABLE,
      `Requested range is before earliestAvailableSlot startSlot=${startSlot} count=${count} earliestAvailableSlot=${chain.earliestAvailableSlot}`
    );
  }

  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;
  // At Gloas, finalizing the beacon block does not finalize its payload. Keep the boundary block in the
  // fork-choice-backed section until the following finalization, matching ExecutionPayloadEnvelopesByRange.
  const isPostGloasFinalized = chain.config.getForkSeq(finalizedSlot) >= ForkSeq.gloas;
  const archiveMaxSlot = isPostGloasFinalized ? finalizedSlot - 1 : finalizedSlot;
  const headBlock = chain.forkChoice.getHead();
  // The canonical walk reaches back to the previous finalized boundary. Within that range fork choice is
  // authoritative: a missing block means the canonical chain skipped the slot, not that storage should choose a root.
  const headChain = chain.forkChoice.getAllAncestorBlocks(headBlock.blockRoot, headBlock.payloadStatus);
  const canonicalBlocksBySlot = new Map(headChain.map((block) => [block.slot, block]));
  const oldestForkChoiceSlot = headChain.at(-1)?.slot ?? Number.POSITIVE_INFINITY;

  // Finalized range of columns
  if (startSlot <= archiveMaxSlot) {
    const archiveEnd = Math.min(endSlot, archiveMaxSlot + 1);
    for (let slot = startSlot; slot < archiveEnd; slot++) {
      const canonicalBlock = slot >= oldestForkChoiceSlot ? canonicalBlocksBySlot.get(slot) : undefined;
      let unavailabilityBlockRoot: Uint8Array | undefined;
      let dataColumnSidecars: (Uint8Array | undefined)[];
      if (slot >= oldestForkChoiceSlot) {
        // Post-Gloas, only the FULL variant has columns. EMPTY and PENDING variants may share its block root.
        if (!canonicalBlock || canonicalBlock.payloadStatus !== PayloadStatus.FULL) continue;
        unavailabilityBlockRoot = fromHex(canonicalBlock.blockRoot);
        dataColumnSidecars = await chain.getSerializedDataColumnSidecars(
          slot,
          canonicalBlock.blockRoot,
          availableColumns
        );
      } else {
        const canonicalBlockResult = await chain.getCanonicalBlockAtSlot(slot);
        if (!canonicalBlockResult) continue;
        const blockRootHex = toRootHex(
          chain.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(canonicalBlockResult.block.message)
        );
        if (chain.config.getForkSeq(slot) >= ForkSeq.gloas) {
          const blockRoot = fromHex(blockRootHex);
          if (!chain.seenPayloadEnvelopeInputCache.hasPayload(blockRootHex)) {
            const hotEnvelopeBytes = await db.executionPayloadEnvelope.getBinary(blockRoot);
            const envelopeBytes = hotEnvelopeBytes ?? (await db.executionPayloadEnvelopeArchive.getBinary(slot));
            if (!envelopeBytes) continue;
          }
          unavailabilityBlockRoot = blockRoot;
        }
        dataColumnSidecars = await chain.getSerializedDataColumnSidecars(slot, blockRootHex, availableColumns);
      }

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
          blockRoot: unavailabilityBlockRoot,
          finalized: true,
          slot,
          requestedColumns,
          availableColumns,
        });
      }
    }
  }

  // Non-finalized range of columns
  if (endSlot > archiveMaxSlot) {
    // getAllAncestorBlocks includes the last finalized block as its final element.
    // Skip anything the archive loop above already served via the block.slot > archiveMaxSlot filter below.

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only columns in the range requested
      if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
        // Post-gloas, columns exist only for FULL blocks (pre-gloas blocks are always FULL)
        if (block.payloadStatus !== PayloadStatus.FULL) {
          continue;
        }

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
            // At Gloas the beacon-finalized boundary stays in this section until its payload finalizes.
            finalized: block.slot <= finalizedSlot,
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
