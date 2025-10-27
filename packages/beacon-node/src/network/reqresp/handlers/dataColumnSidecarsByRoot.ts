import {PeerId} from "@libp2p/interface";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ColumnIndex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {DataColumnSidecarsByRootRequest} from "../../../util/types.js";
import {prettyPrintPeerId} from "../../util.ts";
import {
  handleColumnSidecarUnavailability,
  validateRequestedDataColumns,
} from "../utils/dataColumnResponseValidation.js";

export async function* onDataColumnSidecarsByRoot(
  requestBody: DataColumnSidecarsByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  // SPEC: minimum_request_epoch = max(current_epoch - MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS, FULU_FORK_EPOCH)
  const currentEpoch = chain.clock.currentEpoch;
  const minimumRequestEpoch = Math.max(
    currentEpoch - chain.config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS,
    chain.config.FULU_FORK_EPOCH
  );

  for (const dataColumnsByRootIdentifier of requestBody) {
    const {blockRoot, columns: requestedColumns} = dataColumnsByRootIdentifier;
    const availableColumns = validateRequestedDataColumns(chain, requestedColumns);
    if (availableColumns.length === 0) {
      return;
    }

    const blockRootHex = toRootHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);
    // If the block is not in fork choice, it may be finalized. Attempt to find its slot in block archive
    const slot = block ? block.slot : await db.blockArchive.getSlotByRoot(blockRoot);

    if (slot === null) {
      // We haven't seen the block
      continue;
    }

    if (slot < chain.earliestAvailableSlot) {
      chain.logger.verbose("Peer did not respect earliestAvailableSlot for DataColumnSidecarsByRoot", {
        peer: prettyPrintPeerId(peerId),
        client: peerClient,
      });
      continue;
    }

    const requestedEpoch = computeEpochAtSlot(slot);

    // SPEC: Clients MUST support requesting sidecars since minimum_request_epoch.
    // If any root in the request content references a block earlier than minimum_request_epoch, peers MAY respond with
    // error code 3: ResourceUnavailable or not include the data column sidecar in the response.
    // https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.5/specs/fulu/p2p-interface.md#datacolumnsidecarsbyroot-v1
    if (requestedEpoch < minimumRequestEpoch) {
      continue;
    }

    const dataColumns = block
      ? // Non-finalized sidecars are stored by block root
        await db.dataColumnSidecar.getManyBinary(blockRoot, availableColumns)
      : // Finalized sidecars are archived and stored by slot
        await db.dataColumnSidecarArchive.getManyBinary(slot, availableColumns);

    const unavailableColumnIndices: ColumnIndex[] = [];
    for (let i = 0; i < dataColumns.length; i++) {
      const dataColumnBytes = dataColumns[i];
      if (dataColumnBytes) {
        yield {
          data: dataColumnBytes,
          boundary: chain.config.getForkBoundaryAtEpoch(requestedEpoch),
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
        slot,
        blockRoot,
        unavailableColumnIndices,
        requestedColumns,
        availableColumns,
      });
    }
  }
}
