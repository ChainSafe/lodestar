import {digest} from "@chainsafe/as-sha256";
import {ChainForkConfig} from "@lodestar/config";
import {DATA_COLUMN_SIDECAR_SUBNET_COUNT, NUMBER_OF_COLUMNS, NUMBER_OF_CUSTODY_GROUPS} from "@lodestar/params";
import {ColumnIndex, CustodyIndex} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {bytesToBigInt} from "@lodestar/utils";
import {NodeId} from "../network/subnets/index.js";

export type CustodyConfig = {
  custodyColumnsIndex: Uint8Array;
  custodyColumnsLen: number;
  custodyColumns: ColumnIndex[];
  sampleGroups: CustodyIndex[];
  sampledColumns: ColumnIndex[];
  sampledSubnets: number[];
};

/**
 * Compute CustodyConfig, should be computed once after startup and when connected validators change.
 */
export function computeCustodyConfig(nodeId: NodeId, config: ChainForkConfig): CustodyConfig {
  const custodyColumns = getDataColumns(nodeId, Math.max(config.CUSTODY_REQUIREMENT, config.NODE_CUSTODY_REQUIREMENT));
  // the same to getDataColumns but here we compute step by step to also get custodyGroups
  // const sampledColumns = getDataColumns(
  //   nodeId,
  //   Math.max(config.CUSTODY_REQUIREMENT, config.NODE_CUSTODY_REQUIREMENT, config.SAMPLES_PER_SLOT)
  // );
  const custodyGroupCount = Math.max(config.CUSTODY_REQUIREMENT, config.NODE_CUSTODY_REQUIREMENT, config.SAMPLES_PER_SLOT);
  const sampleGroups = getCustodyGroups(nodeId, custodyGroupCount)
  const sampledColumns = sampleGroups.flatMap(computeColumnsForCustodyGroup)
    .sort((a, b) => a - b);
  const custodyMeta = getCustodyColumnsMeta(custodyColumns);
  const sampledSubnets = sampledColumns.map(computeSubnetForDataColumn);
  return {...custodyMeta, custodyColumns, sampleGroups, sampledColumns, sampledSubnets};
}

function computeSubnetForDataColumn(columnIndex: ColumnIndex): number {
  return columnIndex % DATA_COLUMN_SIDECAR_SUBNET_COUNT;
}

function getCustodyColumnsMeta(custodyColumns: ColumnIndex[]): {
  custodyColumnsIndex: Uint8Array;
  custodyColumnsLen: number;
} {
  // custody columns map which column maps to which index in the array of columns custodied
  // with zero representing it is not custodied
  const custodyColumnsIndex = new Uint8Array(NUMBER_OF_COLUMNS);
  let custodyAtIndex = 1;
  for (const columnIndex of custodyColumns) {
    custodyColumnsIndex[columnIndex] = custodyAtIndex;
    custodyAtIndex++;
  }
  return {custodyColumnsIndex, custodyColumnsLen: custodyColumns.length};
}

/**
 * Converts a custody group to an array of column indices.  Should be 1-1 as long there are 128
 * columns and 128 custody groups.
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/das-core.md#compute_columns_for_custody_group
 */
export function computeColumnsForCustodyGroup(custodyIndex: CustodyIndex): ColumnIndex[] {
  if (custodyIndex > NUMBER_OF_CUSTODY_GROUPS) {
    custodyIndex = NUMBER_OF_CUSTODY_GROUPS;
  }
  const columnsPerCustodyGroup = Number(NUMBER_OF_COLUMNS / NUMBER_OF_CUSTODY_GROUPS);
  const columnIndexes = [];
  for (let i = 0; i < columnsPerCustodyGroup; i++) {
    columnIndexes.push(NUMBER_OF_CUSTODY_GROUPS * i + custodyIndex);
  }
  columnIndexes.sort((a, b) => a - b);
  return columnIndexes;
}

/**
 * Converts nodeId and a the number of custody groups to an array of custody indices. Indexes must be
 * further converted to column indices
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/das-core.md#get_custody_groups
 */
export function getCustodyGroups(nodeId: NodeId, custodyGroupCount: number): CustodyIndex[] {
  if (custodyGroupCount > NUMBER_OF_CUSTODY_GROUPS) {
    custodyGroupCount = NUMBER_OF_CUSTODY_GROUPS;
  }

  const custodyGroups: CustodyIndex[] = [];
  // nodeId is in bigendian and all computes are in little endian
  let currentId = bytesToBigInt(nodeId, "be");
  while (custodyGroups.length < custodyGroupCount) {
    // could be optimized
    const currentIdBytes = ssz.UintBn256.serialize(currentId);
    const custodyGroup = Number(
      ssz.UintBn64.deserialize(digest(currentIdBytes).slice(0, 8)) % BigInt(NUMBER_OF_CUSTODY_GROUPS)
    );

    if (!custodyGroups.includes(custodyGroup)) {
      custodyGroups.push(custodyGroup);
    }

    const willOverflow = currentIdBytes.reduce((acc, elem) => acc && elem === 0xff, true);
    if (willOverflow) {
      currentId = BigInt(0);
    } else {
      currentId++;
    }
  }

  custodyGroups.sort((a, b) => a - b);
  return custodyGroups;
}

export function getDataColumns(nodeId: NodeId, custodyGroupCount: number): ColumnIndex[] {
  return getCustodyGroups(nodeId, custodyGroupCount)
    .flatMap(computeColumnsForCustodyGroup)
    .sort((a, b) => a - b);
}
