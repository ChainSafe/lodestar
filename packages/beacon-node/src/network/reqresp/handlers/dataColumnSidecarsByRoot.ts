import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {
  COLUMN_SIZE_IN_WRAPPER_INDEX,
  CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
  DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX,
  NUM_COLUMNS_IN_WRAPPER_INDEX,
} from "../../../db/repositories/dataColumnSidecars.js";

export async function* onDataColumnSidecarsByRoot(
  requestBody: fulu.DataColumnSidecarsByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // SPEC: minimum_request_epoch = max(finalized_epoch, current_epoch - MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS, FULU_FORK_EPOCH)
  const finalizedEpoch = chain.forkChoice.getFinalizedCheckpoint().epoch;
  const currentEpoch = chain.clock.currentEpoch;
  const minimumRequestEpoch = Math.max(
    finalizedEpoch,
    currentEpoch - chain.config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS,
    chain.config.FULU_FORK_EPOCH
  );

  for (const dataColumnsByRootIdentifier of requestBody) {
    const {blockRoot, columns} = dataColumnsByRootIdentifier;
    const blockRootHex = toHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting sidecars since minimum_request_epoch.
    // If any root in the request content references a block earlier than minimum_request_epoch, peers MAY respond with
    // error code 3: ResourceUnavailable or not include the data column sidecar in the response.
    // https://github.com/ethereum/consensus-specs/blob/1937aff86b41b5171a9bc3972515986f1bbbf303/specs/fulu/p2p-interface.md#datacolumnsidecarsbyroot-v1
    if (!block || computeEpochAtSlot(block.slot) < minimumRequestEpoch) {
      continue;
    }

    const dataColumnSidecarsBytesWrapped = await db.dataColumnSidecars.getBinary(fromHex(block.blockRoot));
    if (!dataColumnSidecarsBytesWrapped) {
      // Handle the same to onBeaconBlocksByRange
      throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
    }

    const retrivedColumnsLen = ssz.Uint8.deserialize(
      dataColumnSidecarsBytesWrapped.slice(NUM_COLUMNS_IN_WRAPPER_INDEX, COLUMN_SIZE_IN_WRAPPER_INDEX)
    );
    const retrievedColumnsSizeBytes = dataColumnSidecarsBytesWrapped.slice(
      COLUMN_SIZE_IN_WRAPPER_INDEX,
      CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX
    );
    const columnsSize = ssz.UintNum64.deserialize(retrievedColumnsSizeBytes);
    const dataColumnSidecarsBytes = dataColumnSidecarsBytesWrapped.slice(
      DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX + 4 * retrivedColumnsLen
    );

    const dataColumnsIndex = dataColumnSidecarsBytesWrapped.slice(
      CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
      CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX + NUMBER_OF_COLUMNS
    );

    for (const index of columns) {
      const dataIndex = (dataColumnsIndex[index] ?? 0) - 1;
      if (dataIndex < 0) {
        throw new ResponseError(RespStatus.SERVER_ERROR, `dataColumnSidecar index=${index} not custodied`);
      }

      const dataColumnSidecarBytes = dataColumnSidecarsBytes.slice(
        dataIndex * columnsSize,
        (dataIndex + 1) * columnsSize
      );
      if (dataColumnSidecarBytes.length !== columnsSize) {
        throw Error(
          `Inconsistent state, dataColumnSidecar blockRoot=${blockRootHex} index=${index} dataColumnSidecarBytes=${dataColumnSidecarBytes.length} expected=${columnsSize}`
        );
      }

      yield {
        data: dataColumnSidecarBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
      };
    }
  }
}
