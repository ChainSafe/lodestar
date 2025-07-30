import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fulu} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getIndexOfSidecarInWrapper, parseWrappedColumnSidecars} from "../../../util/dataColumns.js";
import {getColumnIndexFromDataColumnSidecarSerialized} from "../../../util/sszBytes.js";

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

  // TODO(fulu): Need CustodyConfig to be able to quick check if requested columns are in the DB
  // https://github.com/ChainSafe/lodestar/pull/7947#discussion_r2161364242
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

      const actualIndex = getColumnIndexFromDataColumnSidecarSerialized(dataColumnSidecarBytes);
      if (actualIndex !== columnIndex) {
        throw new Error(
          `Invalidly saved column for blockRoot=${blockRootHex} in database. Expected columnIndex=${columnIndex} and got actualIndex=${actualIndex}`
        );
      }
      if (dataColumnSidecarBytes.length !== columnSizeInBytes) {
        throw Error(
          `Invalid DataColumnSidecar length when sliced blockRoot=${blockRootHex} columnIndex=${columnIndex} dataColumnSidecarBytes=${dataColumnSidecarBytes.length} expected=${columnSizeInBytes}`
        );
      }

      yield {
        data: dataColumnSidecarBytes,
        fork: chain.config.getForkName(block.slot),
      };
    }
  }
}
