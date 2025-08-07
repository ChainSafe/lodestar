import {GENESIS_SLOT, MAX_REQUEST_BLOCKS_DENEB, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ColumnIndex, Slot, fulu, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {
  COLUMN_SIZE_IN_WRAPPER_INDEX,
  CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
  DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX,
  NUM_COLUMNS_IN_WRAPPER_INDEX,
} from "../../../db/repositories/dataColumnSidecars.js";

export async function* onDataColumnSidecarsByRange(
  request: fulu.DataColumnSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // Non-finalized range of columns
  const {startSlot, count, columns} = validateDataColumnSidecarsByRangeRequest(request);
  const endSlot = startSlot + count;

  const finalized = db.dataColumnSidecarsArchive;
  const unfinalized = db.dataColumnSidecars;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized range of columns
  if (startSlot <= finalizedSlot) {
    for await (const {key, value: dataColumnSideCarsBytesWrapped} of finalized.binaryEntriesStream({
      gte: startSlot,
      lt: endSlot,
    })) {
      yield* iterateDataColumnBytesFromWrapper(
        chain,
        dataColumnSideCarsBytesWrapped,
        finalized.decodeKey(key),
        columns
      );
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
        // Spec: https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#datacolumnsidecarsbyrange-v1

        const dataColumnSidecarsBytesWrapped = await unfinalized.getBinary(fromHex(block.blockRoot));
        if (!dataColumnSidecarsBytesWrapped) {
          // Handle the same to onBeaconBlocksByRange
          throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
        }
        yield* iterateDataColumnBytesFromWrapper(chain, dataColumnSidecarsBytesWrapped, block.slot, columns);
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}

export function* iterateDataColumnBytesFromWrapper(
  chain: IBeaconChain,
  dataColumnSidecarsBytesWrapped: Uint8Array,
  blockSlot: Slot,
  columns: ColumnIndex[]
): Iterable<ResponseOutgoing> {
  const retrivedColumnsLen = ssz.Uint8.deserialize(
    dataColumnSidecarsBytesWrapped.slice(NUM_COLUMNS_IN_WRAPPER_INDEX, COLUMN_SIZE_IN_WRAPPER_INDEX)
  );
  const retrievedColumnsSizeBytes = dataColumnSidecarsBytesWrapped.slice(
    COLUMN_SIZE_IN_WRAPPER_INDEX,
    CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX
  );
  const columnsSize = ssz.UintNum64.deserialize(retrievedColumnsSizeBytes);
  const dataColumnsIndex = dataColumnSidecarsBytesWrapped.slice(
    CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
    CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX + NUMBER_OF_COLUMNS
  );
  const allDataColumnSidecarsBytes = dataColumnSidecarsBytesWrapped.slice(
    DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX + 4 * retrivedColumnsLen
  );

  const columnsLen = allDataColumnSidecarsBytes.length / columnsSize;

  // no columns possibly no blobs
  if (columnsLen === 0) {
    return;
  }

  for (const index of columns) {
    // get the index at which the column is
    const dataIndex = (dataColumnsIndex[index] ?? 0) - 1;
    if (dataIndex < 0) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `dataColumnSidecar index=${index} dataIndex=${dataIndex} not custodied`
      );
    }
    const dataColumnSidecarBytes = allDataColumnSidecarsBytes.slice(
      dataIndex * columnsSize,
      (dataIndex + 1) * columnsSize
    );
    if (dataColumnSidecarBytes.length !== columnsSize) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `Invalid dataColumnSidecar index=${index} dataIndex=${dataIndex} bytes length=${dataColumnSidecarBytes.length} expected=${columnsSize} for slot ${blockSlot} blobsLen=${columnsLen}`
      );
    }
    yield {
      data: dataColumnSidecarBytes,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(blockSlot)),
    };
  }
}

export function validateDataColumnSidecarsByRangeRequest(
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

  if (count > MAX_REQUEST_BLOCKS_DENEB) {
    count = MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count, columns};
}
