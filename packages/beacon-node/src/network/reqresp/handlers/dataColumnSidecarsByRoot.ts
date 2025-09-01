import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fromHex, toHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {DataColumnSidecarsByRootRequest} from "../../../util/types.js";

export async function* onDataColumnSidecarsByRoot(
  requestBody: DataColumnSidecarsByRootRequest,
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

    const dataColumns = await db.dataColumnSidecar.getManyBinary(fromHex(block.blockRoot), columns);
    if (!dataColumns) {
      throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root=${block.blockRoot}, slot=${block.slot}`);
    }

    for (const [index, dataColumnBytes] of dataColumns.entries()) {
      if (!dataColumnBytes) {
        throw new ResponseError(RespStatus.SERVER_ERROR, `dataColumnSidecar index=${columns[index]} not custodied`);
      }

      yield {
        data: dataColumnBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
      };
    }
  }
}
