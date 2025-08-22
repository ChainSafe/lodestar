import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fulu} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

export async function* onDataColumnSidecarsByRoot(
  requestBody: fulu.DataColumnSidecarsByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // SPEC: minimum_request_epoch = max(current_epoch - MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS, FULU_FORK_EPOCH)
  const currentEpoch = chain.clock.currentEpoch;
  const minimumRequestEpoch = Math.max(
    currentEpoch - chain.config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS,
    chain.config.FULU_FORK_EPOCH
  );

  for (const dataColumnsByRootIdentifier of requestBody) {
    const {blockRoot, columns} = dataColumnsByRootIdentifier;
    const blockRootHex = toRootHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);
    // If the block is not in fork choice, it may be finalized. Attempt to find its slot in block archive
    const slot = block ? block.slot : await db.blockArchive.getSlotByRoot(blockRoot);

    if (slot === null) {
      // We haven't seen the block
      continue;
    }

    const requestedEpoch = computeEpochAtSlot(slot);

    // SPEC: Clients MUST support requesting sidecars since minimum_request_epoch.
    // If any root in the request content references a block earlier than minimum_request_epoch, peers MAY respond with
    // error code 3: ResourceUnavailable or not include the data column sidecar in the response.
    // https://github.com/ethereum/consensus-specs/blob/1937aff86b41b5171a9bc3972515986f1bbbf303/specs/fulu/p2p-interface.md#datacolumnsidecarsbyroot-v1
    if (requestedEpoch < minimumRequestEpoch) {
      continue;
    }

    const dataColumns = block
      ? // Non-finalized sidecars are stored by block root
        await db.dataColumnSidecar.getManyBinary(blockRoot, columns)
      : // Finalized sidecars are archived and stored by slot
        await db.dataColumnSidecarArchive.getManyBinary(slot, columns);

    if (!dataColumns) {
      throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root=${blockRootHex}, slot=${slot}`);
    }

    for (const [index, dataColumnBytes] of dataColumns.entries()) {
      if (!dataColumnBytes) {
        throw new ResponseError(
          RespStatus.SERVER_ERROR,
          `dataColumnSidecar index=${columns[index]} not custodied for slot=${slot}`
        );
      }

      yield {
        data: dataColumnBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(requestedEpoch),
      };
    }
  }
}
