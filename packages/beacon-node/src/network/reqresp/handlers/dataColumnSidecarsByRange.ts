import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkSeq, GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ColumnIndex, Epoch, RootHex, fulu} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconChainDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.js";
import {
  handleColumnSidecarUnavailability,
  validateRequestedDataColumns,
} from "../utils/dataColumnResponseValidation.js";

export async function* onDataColumnSidecarsByRange(
  request: fulu.DataColumnSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconChainDb,
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

  const finalizedSlot = chain.beaconEngine.getFinalizedBlock().slot;
  // At Gloas, finalizing the beacon block does not finalize its payload. Keep the boundary block in the
  // fork-choice-backed section until the following finalization, matching ExecutionPayloadEnvelopesByRange.
  const isPostGloasFinalized = chain.config.getForkSeq(finalizedSlot) >= ForkSeq.gloas;
  const archiveMaxSlot = isPostGloasFinalized ? finalizedSlot - 1 : finalizedSlot;
  const headBlock = chain.beaconEngine.getHead();
  const headChain = chain.beaconEngine.getAllAncestorBlocks(headBlock.blockRoot, headBlock.payloadStatus);

  for await (const block of resolveCanonicalDataColumnBlocks(
    chain,
    db,
    headChain,
    startSlot,
    endSlot,
    archiveMaxSlot,
    finalizedSlot
  )) {
    const dataColumnSidecars =
      block.blockRoot === null
        ? await db.dataColumnSidecarArchive.getManyBinary(block.slot, availableColumns)
        : await chain.getSerializedDataColumnSidecars(block.slot, block.blockRoot, availableColumns);
    if (block.blockRoot === null && dataColumnSidecars.every((sidecar) => sidecar === undefined)) continue;
    const unavailableColumnIndices: ColumnIndex[] = [];
    for (let i = 0; i < dataColumnSidecars.length; i++) {
      const dataColumnSidecarBytes = dataColumnSidecars[i];
      if (dataColumnSidecarBytes) {
        yield {
          data: dataColumnSidecarBytes,
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
        };
      } else {
        unavailableColumnIndices.push(availableColumns[i]);
      }
    }

    if (unavailableColumnIndices.length > 0) {
      await handleColumnSidecarUnavailability({
        chain,
        db,
        metrics: chain.metrics,
        unavailableColumnIndices,
        blockRoot: block.unavailabilityBlockRoot ? fromHex(block.unavailabilityBlockRoot) : undefined,
        finalized: block.finalized,
        slot: block.slot,
        requestedColumns,
        availableColumns,
      });
    }
  }
}

type CanonicalDataColumnBlock = {
  slot: number;
  blockRoot: RootHex | null;
  unavailabilityBlockRoot?: RootHex;
  finalized: boolean;
};

async function* resolveCanonicalDataColumnBlocks(
  chain: IBeaconChain,
  db: IBeaconChainDb,
  headChain: ReturnType<IBeaconChain["beaconEngine"]["getAllAncestorBlocks"]>,
  startSlot: number,
  endSlot: number,
  archiveMaxSlot: number,
  finalizedSlot: number
): AsyncIterable<CanonicalDataColumnBlock> {
  const canonicalBlocksBySlot = new Map(headChain.map((block) => [block.slot, block]));
  const oldestForkChoiceSlot = headChain.at(-1)?.slot ?? Number.POSITIVE_INFINITY;
  const archiveEnd = Math.min(endSlot, archiveMaxSlot + 1);
  const recentRoots = chain.beaconEngine.getRecentCanonicalRoots(startSlot, Math.min(archiveEnd, oldestForkChoiceSlot));

  for (let slot = startSlot; slot < archiveEnd; slot++) {
    if (slot >= oldestForkChoiceSlot) {
      const block = canonicalBlocksBySlot.get(slot);
      if (block?.payloadStatus === PayloadStatus.FULL) {
        yield {
          slot,
          blockRoot: block.blockRoot,
          unavailabilityBlockRoot: block.blockRoot,
          finalized: true,
        };
      }
      continue;
    }

    let blockRoot = recentRoots.get(slot);
    if (blockRoot === null) continue;
    if (blockRoot === undefined) {
      const root = await chain.beaconEngine.getFinalizedBlockRootBySlot(slot);
      blockRoot = root === null ? null : toRootHex(root);
    }
    if (blockRoot === null && (db.lastLegacyArchiveSlot === null || slot > db.lastLegacyArchiveSlot)) continue;
    if (
      chain.config.getForkSeq(slot) >= ForkSeq.gloas &&
      !(await hasExecutionPayloadEnvelope(chain, db, slot, blockRoot))
    ) {
      continue;
    }
    yield {
      slot,
      blockRoot,
      unavailabilityBlockRoot: chain.config.getForkSeq(slot) >= ForkSeq.gloas ? (blockRoot ?? undefined) : undefined,
      finalized: true,
    };
  }

  for (let i = headChain.length - 1; i >= 0; i--) {
    const block = headChain[i];
    if (block.slot >= endSlot) break;
    if (block.slot <= archiveMaxSlot || block.slot < startSlot || block.payloadStatus !== PayloadStatus.FULL) continue;
    yield {
      slot: block.slot,
      blockRoot: block.blockRoot,
      unavailabilityBlockRoot: block.blockRoot,
      finalized: block.slot <= finalizedSlot,
    };
  }
}

/** Copy roots synchronously so serving a request never retains a head-state reference across I/O. */

async function hasExecutionPayloadEnvelope(
  chain: IBeaconChain,
  db: IBeaconChainDb,
  slot: number,
  blockRoot: RootHex | null
): Promise<boolean> {
  if (blockRoot !== null) {
    if (chain.seenPayloadEnvelopeInputCache.hasPayload(blockRoot)) return true;
    if ((await db.executionPayloadEnvelope.getBinary(fromHex(blockRoot))) !== null) return true;
  }
  return (await db.executionPayloadEnvelopeArchive.getBinary(slot)) !== null;
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
