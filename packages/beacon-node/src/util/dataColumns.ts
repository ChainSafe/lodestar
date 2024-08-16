import {digest} from "@chainsafe/as-sha256";
import {NUMBER_OF_COLUMNS, DATA_COLUMN_SIDECAR_SUBNET_COUNT} from "@lodestar/params";
import {ColumnIndex} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {NodeId} from "../network/subnets/index.js";

export type CustodyConfig = {custodyColumnsIndex: Uint8Array; custodyColumnsLen: number; custodyColumns: ColumnIndex[]};

export function getCustodyConfig(nodeId: NodeId, config: ChainForkConfig): CustodyConfig {
  const custodyColumns = getCustodyColumns(
    nodeId,
    Math.max(config.CUSTODY_REQUIREMENT, config.NODE_CUSTODY_REQUIREMENT)
  );
  const custodyMeta = getCustodyColumnsMeta(custodyColumns);
  return {...custodyMeta, custodyColumns};
}

export function getCustodyColumnsMeta(custodyColumns: ColumnIndex[]): {
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

// optimize by having a size limited index/map
export function getCustodyColumns(nodeId: NodeId, custodySubnetCount: number): ColumnIndex[] {
  const subnetIds = getCustodyColumnSubnets(nodeId, custodySubnetCount);
  const columnsPerSubnet = Number(NUMBER_OF_COLUMNS / DATA_COLUMN_SIDECAR_SUBNET_COUNT);

  const columnIndexes = [];
  for (const subnetId of subnetIds) {
    for (let i = 0; i < columnsPerSubnet; i++) {
      const columnIndex = DATA_COLUMN_SIDECAR_SUBNET_COUNT * i + subnetId;
      columnIndexes.push(columnIndex);
    }
  }

  columnIndexes.sort((a, b) => a - b);
  return columnIndexes;
}

export function getCustodyColumnSubnets(nodeId: NodeId, custodySubnetCount: number): number[] {
  const subnetIds: number[] = [];
  if (custodySubnetCount > DATA_COLUMN_SIDECAR_SUBNET_COUNT) {
    custodySubnetCount = DATA_COLUMN_SIDECAR_SUBNET_COUNT;
  }

  let currentId = ssz.UintBn256.deserialize(nodeId);
  while (subnetIds.length < custodySubnetCount) {
    // could be optimized
    const currentIdBytes = ssz.UintBn256.serialize(currentId);
    const subnetId = Number(
      ssz.UintBn64.deserialize(digest(currentIdBytes).slice(0, 8)) % BigInt(DATA_COLUMN_SIDECAR_SUBNET_COUNT)
    );
    if (!subnetIds.includes(subnetId)) {
      subnetIds.push(subnetId);
    }

    const willOverflow = currentIdBytes.reduce((acc, elem) => acc && elem === 0xff, true);
    if (willOverflow) {
      currentId = BigInt(0);
    } else {
      currentId++;
    }
  }

  return subnetIds;
}
