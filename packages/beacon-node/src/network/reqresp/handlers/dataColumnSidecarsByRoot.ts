import {ResponseError, ResponseOutgoing, RespStatus} from "@lodestar/reqresp";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {peerdas, RootHex, ssz} from "@lodestar/types";
import {toHex, fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {
  DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX,
  CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
  COLUMN_SIZE_IN_WRAPPER_INDEX,
  NUM_COLUMNS_IN_WRAPPER_INDEX,
} from "../../../db/repositories/dataColumnSidecars.js";

export async function* onDataColumnSidecarsByRoot(
  requestBody: peerdas.DataColumnSidecarsByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // In sidecars by root request, it can be expected that sidecar requests will be come
  // clustured by blockroots, and this helps us save db lookups once we load sidecars
  // for a root
  let lastFetchedSideCars: {
    blockRoot: RootHex;
    bytes: Uint8Array;
    dataColumnsIndex: Uint8Array;
    columnsSize: number;
  } | null = null;

  for (const dataColumnIdentifier of requestBody) {
    const {blockRoot, index} = dataColumnIdentifier;
    const blockRootHex = toHex(blockRoot);
    const block = chain.forkChoice.getBlockHex(blockRootHex);

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting blocks and sidecars since the latest finalized epoch.
    // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#beaconblockandblobssidecarbyroot-v1
    if (!block || block.slot <= finalizedSlot) {
      continue;
    }

    // Check if we need to load sidecars for a new block root
    if (lastFetchedSideCars === null || lastFetchedSideCars.blockRoot !== blockRootHex) {
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
      const storedColumns = Array.from({length: NUMBER_OF_COLUMNS}, (_v, i) => i).filter(
        (i) => dataColumnsIndex[i] > 0
      );

      const columnsLen = dataColumnSidecarsBytes.length / columnsSize;

      console.log(
        `onDataColumnSidecarsByRoot: slot=${block.slot} columnsSize=${columnsSize} storedColumnsLen=${columnsLen} retrivedColumnsLen=${retrivedColumnsLen} dataColumnSidecarsBytesWrapped=${dataColumnSidecarsBytesWrapped.length} storedColumns=${storedColumns.join(" ")}`
      );

      lastFetchedSideCars = {blockRoot: blockRootHex, bytes: dataColumnSidecarsBytes, columnsSize, dataColumnsIndex};
    }

    const dataIndex = (lastFetchedSideCars.dataColumnsIndex[index] ?? 0) - 1;
    if (dataIndex < 0) {
      throw new ResponseError(RespStatus.SERVER_ERROR, `dataColumnSidecar index=${index} not custodied`);
    }
    const {columnsSize} = lastFetchedSideCars;

    const dataColumnSidecarBytes = lastFetchedSideCars.bytes.slice(
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
      fork: chain.config.getForkName(block.slot),
    };
  }
}
