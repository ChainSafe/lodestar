import {LogData} from "@lodestar/logger";
import {RespStatus, ResponseError} from "@lodestar/reqresp";
import {ColumnIndex, Slot} from "@lodestar/types";
import {prettyBytes, prettyPrintIndices} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/interface.js";
import {IBeaconDb} from "../../../db/interface.js";
import {getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";
import {Metrics} from "../../../metrics/metrics.js";

export async function handleColumnSidecarUnavailability({
  chain,
  db,
  metrics,
  unavailableColumnIndices,
  requestedColumns,
  availableColumns,
  slot,
  blockRoot,
}: {
  chain: IBeaconChain;
  db: IBeaconDb;
  metrics: Metrics | null;
  slot: Slot;
  blockRoot?: Uint8Array;
  unavailableColumnIndices: ColumnIndex[];
  requestedColumns: ColumnIndex[];
  availableColumns: ColumnIndex[];
}): Promise<void> {
  const logData: LogData = {
    unavailableColumnIndices: prettyPrintIndices(unavailableColumnIndices),
    requestedColumns: prettyPrintIndices(requestedColumns),
    availableColumns: prettyPrintIndices(availableColumns),
    slot,
  };
  if (blockRoot) {
    logData.blockRoot = prettyBytes(blockRoot);
  }

  chain.logger.debug("dataColumnSidecar requested unavailable", logData);

  const blockBytes = blockRoot ? await db.block.getBinary(blockRoot) : await db.blockArchive.getBinary(slot);
  if (!blockBytes) {
    chain.logger.error(
      `Expected ${blockRoot ? "unfinalized" : "finalized"} block not found while handling unavailable dataColumnSidecar`
    );
    return;
  }

  // Check for blob count in actual block
  const blobsCount = getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(chain.config, blockBytes);

  // There are zero blobs for that column index, so we can safely return without any error
  if (blobsCount > 0) return;

  // There are blobs for that column index so we should have synced for it
  // We need to inform to peers that we don't have that expected data
  metrics?.dataColumns.missingCustodyColumns.inc(unavailableColumnIndices.length);
  chain.logger.verbose("dataColumnSidecar requested and within custody but not available", {
    unavailableColumnIndices: prettyPrintIndices(unavailableColumnIndices),
    blockRoot: blockRoot ? prettyBytes(blockRoot) : "unknown blockRoot",
  });
}

export function validateRequestedDataColumns(chain: IBeaconChain, requestedColumns: ColumnIndex[]): ColumnIndex[] {
  if (requestedColumns.length === 0) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "dataColumnSidecar requested without column indices");
  }

  const custodyColumns = chain.custodyConfig.custodyColumns;
  const availableColumns = requestedColumns.filter((c) => custodyColumns.includes(c));
  const missingColumns = requestedColumns.filter((c) => !custodyColumns.includes(c));

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
