import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fulu} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getIndexOfSidecarInWrapper, parseWrappedColumnSidecars} from "../../../db/repositories/dataColumnSidecars.js";

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
    const blockRootHex = toRootHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting sidecars since minimum_request_epoch.
    // If any root in the request content references a block earlier than minimum_request_epoch, peers MAY respond with
    // error code 3: ResourceUnavailable or not include the data column sidecar in the response.
    // https://github.com/ethereum/consensus-specs/blob/1937aff86b41b5171a9bc3972515986f1bbbf303/specs/fulu/p2p-interface.md#datacolumnsidecarsbyroot-v1
    if (!block || computeEpochAtSlot(block.slot) < minimumRequestEpoch) {
      continue;
    }

    const dataColumnSidecarsBytesWrapped = await db.dataColumnSidecars.getBinary(blockRoot);
    if (!dataColumnSidecarsBytesWrapped) {
      // Handle the same to onBeaconBlocksByRange
      throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
    }

    const {columnSizeInBytes, custodyIndex, serializedColumnSidecars} =
      parseWrappedColumnSidecars(dataColumnSidecarsBytesWrapped);

    for (const columnIndex of columns) {
      const dataIndex = getIndexOfSidecarInWrapper(custodyIndex, columnIndex);

      const dataColumnSidecarBytes = serializedColumnSidecars.subarray(
        dataIndex * columnSizeInBytes,
        (dataIndex + 1) * columnSizeInBytes
      );
      if (dataColumnSidecarBytes.length !== columnSizeInBytes) {
        throw Error(
          `Inconsistent state, dataColumnSidecar blockRoot=${blockRootHex} columnIndex=${columnIndex} dataColumnSidecarBytes=${dataColumnSidecarBytes.length} expected=${columnSizeInBytes}`
        );
      }

      yield {
        data: dataColumnSidecarBytes,
        fork: chain.config.getForkName(block.slot),
      };
    }
  }
}
