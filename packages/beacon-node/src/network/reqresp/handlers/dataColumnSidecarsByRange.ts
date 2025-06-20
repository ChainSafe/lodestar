import {GENESIS_SLOT, MAX_REQUEST_BLOCKS_DENEB, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {ColumnIndex, Slot, fulu} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getIndexOfSidecarInWrapper, parseWrappedColumnSidecars} from "../../../util/dataColumns.js";

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
    // Chain of columns won't change
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

  if (endSlot < finalizedSlot) {
    return;
  }

  // Non-finalized range of columns
  const headRoot = chain.forkChoice.getHeadRoot();
  // TODO DENEB: forkChoice should maintain an array of canonical blocks, and change only on reorg
  const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);

  // TODO(fulu): This may cause a lot of overhead in long periods of non-finality.  Need to tune this further
  // Iterate head chain with ascending block numbers
  for (let i = headChain.length - 1; i >= 0; i--) {
    const block = headChain[i];

    // Must include only blobs in the range requested
    if (block.slot >= startSlot && block.slot < endSlot) {
      // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
      // at the time of the start of the request. Spec is clear the chain of blobs must be consistent, but on
      // re-org there's no need to abort the request
      // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

      const blobSideCarsBytesWrapped = await unfinalized.getBinary(fromHex(block.blockRoot));
      if (!blobSideCarsBytesWrapped) {
        // console.log(`error onDataColumnSidecarsByRange No item for root ${block.blockRoot} slot ${block.slot}`);
        // Handle the same to onBeaconBlocksByRange
        throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
      }
      yield* iterateDataColumnBytesFromWrapper(chain, blobSideCarsBytesWrapped, block.slot, columns);
    }

    // If block is after endSlot, stop iterating
    else if (block.slot >= endSlot) {
      break;
    }
  }
}

export function* iterateDataColumnBytesFromWrapper(
  chain: IBeaconChain,
  dataColumnSidecarsBytesWrapped: Uint8Array,
  blockSlot: Slot,
  columns: ColumnIndex[]
): Iterable<ResponseOutgoing> {
  const {columnSizeInBytes, custodyIndex, serializedColumnSidecars} =
    parseWrappedColumnSidecars(dataColumnSidecarsBytesWrapped);

  // no columns possibly no blob
  if (serializedColumnSidecars.length === 0) {
    return;
  }

  const fork = chain.config.getForkName(blockSlot);

  for (const columnIndex of columns) {
    const dataIndex = getIndexOfSidecarInWrapper(custodyIndex, columnIndex);
    const dataColumnSidecarBytes = serializedColumnSidecars.slice(
      dataIndex * columnSizeInBytes,
      (dataIndex + 1) * columnSizeInBytes
    );
    if (dataColumnSidecarBytes.length !== columnSizeInBytes) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `Invalid dataColumnSidecar columnIndex=${columnIndex} dataIndex=${dataIndex} bytes length=${dataColumnSidecarBytes.length} expected=${columnSizeInBytes} for slot ${blockSlot}`
      );
    }
    yield {
      data: dataColumnSidecarBytes,
      fork,
    };
  }
}

export function validateDataColumnSidecarsByRangeRequest(
  request: fulu.DataColumnSidecarsByRangeRequest
): fulu.DataColumnSidecarsByRangeRequest {
  const {startSlot, columns} = request;

  if (!columns || columns.length === 0) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "columns array is empty");
  }

  if (columns.length > NUMBER_OF_COLUMNS) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "requested more than NUMBER_OF_COLUMNS");
  }

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
