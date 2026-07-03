import {LogData} from "@lodestar/logger";
import {ForkSeq} from "@lodestar/params";
import {ColumnIndex, Slot} from "@lodestar/types";
import {prettyBytes, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/interface.js";
import {Metrics} from "../../../metrics/metrics.js";
import {getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";

export async function handleColumnSidecarUnavailability({
  chain,
  metrics,
  unavailableColumnIndices,
  requestedColumns,
  availableColumns,
  slot,
  blockRoot,
}: {
  chain: IBeaconChain;
  metrics: Metrics | null;
  slot: Slot;
  blockRoot?: Uint8Array;
  unavailableColumnIndices: ColumnIndex[];
  requestedColumns: ColumnIndex[];
  availableColumns: ColumnIndex[];
}): Promise<void> {
  const logData: LogData = {
    slot,
    unavailableColumnIndices: prettyPrintIndices(unavailableColumnIndices),
    requestedColumns: prettyPrintIndices(requestedColumns),
    availableColumns: prettyPrintIndices(availableColumns),
  };
  if (blockRoot) {
    logData.blockRoot = prettyBytes(blockRoot);
  }

  chain.logger.debug("dataColumnSidecar requested unavailable", logData);

  // Post-gloas, columns exist only for FULL blocks; a finalized block is FULL if its envelope was
  // archived. Bid blobsCount is unreliable here since an EMPTY block's bid may still commit to blobs
  if (blockRoot === undefined && chain.config.getForkSeq(slot) >= ForkSeq.gloas) {
    // Envelope DB is engine-owned; read the finalized (cold-archive) envelope via the engine.
    const envelopeBytes = await chain.getSerializedFinalizedExecutionPayloadEnvelope(slot);
    if (!envelopeBytes) return;
  }

  // Block DB is engine-owned; read hot-by-root or finalized-by-slot via the engine.
  const blockBytes = blockRoot
    ? ((await chain.getSerializedBlockByRoot(blockRoot))?.block ?? null)
    : await chain.getSerializedFinalizedBlockBySlot(slot);
  if (!blockBytes) {
    chain.logger.verbose(
      `Expected ${blockRoot ? "unfinalized" : "finalized"} block not found while handling unavailable dataColumnSidecar`,
      {
        slot,
        blockRoot: blockRoot ? toRootHex(blockRoot) : "unknown",
        earliestAvailableSlot: chain.earliestAvailableSlot,
      }
    );
    return;
  }

  // Check for blob count in actual block
  const blobsCount = getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(chain.config, blockBytes);

  // There are zero blobs for that column index, so we can safely return without any error
  if (blobsCount === 0) return;

  // There are blobs for that column index so we should have synced for it
  // We need to inform to peers that we don't have that expected data
  metrics?.dataColumns.missingCustodyColumns.inc(unavailableColumnIndices.length);
  chain.logger.verbose("dataColumnSidecar requested and within custody but not available", {
    unavailableColumnIndices: prettyPrintIndices(unavailableColumnIndices),
    blockRoot: blockRoot ? prettyBytes(blockRoot) : "unknown",
  });
}

export function validateRequestedDataColumns(chain: IBeaconChain, requestedColumns: ColumnIndex[]): ColumnIndex[] {
  if (requestedColumns.length === 0) {
    return [];
  }

  const {custodyColumns, custodyColumnsIndex} = chain.custodyConfig;
  const availableColumns: ColumnIndex[] = [];
  const missingColumns: ColumnIndex[] = [];
  for (const c of requestedColumns) {
    // `c` is peer-controlled and SSZ-deserialized as `uint64`, so it may exceed
    // `NUMBER_OF_COLUMNS - 1`; `Uint8Array` returns `undefined` for OOB reads,
    // and `undefined !== 0` would silently classify OOB indices as custodied.
    if ((custodyColumnsIndex[c] ?? 0) !== 0) {
      availableColumns.push(c);
    } else {
      missingColumns.push(c);
    }
  }

  if (missingColumns.length > 0) {
    chain.logger.verbose("Requested dataColumnSidecar for non-custody columns", {
      requestedColumns: prettyPrintIndices(requestedColumns),
      custodyColumns: prettyPrintIndices(custodyColumns),
      availableColumns: prettyPrintIndices(availableColumns),
      missingColumns: prettyPrintIndices(missingColumns),
    });

    // TODO: We should throw error and only respond to valid requests
    // A peer must check what we announced in our custody and only ask for those columns
    // throw new ResponseError(RespStatus.INVALID_REQUEST, "dataColumnSidecar requested for non-custody columns");
  }

  if (availableColumns.length === 0) {
    chain.logger.verbose("Requested dataColumnSidecars not available", {
      requestedColumns: prettyPrintIndices(requestedColumns),
      custodyColumns: prettyPrintIndices(custodyColumns),
    });
  }

  return availableColumns;
}
