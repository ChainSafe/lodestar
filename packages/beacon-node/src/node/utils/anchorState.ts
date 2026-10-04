import {BeaconConfig} from "@lodestar/config";
import {Slot, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

export function getAnchorExecutionBlockHash(config: BeaconConfig, bytes: Uint8Array, slot: Slot): string | undefined {
  const type = ssz[config.getForkName(slot)].BeaconState;
  const fieldName = "latestBlockHash" in type.fields ? "latestBlockHash" : "latestExecutionPayloadHeader";
  const index = type.fieldsEntries.findIndex((field) => field.fieldName === fieldName);
  if (index === -1) return undefined;
  const range = type.getFieldRanges(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, bytes.length)[
    index
  ];
  const fieldBytes = bytes.subarray(range.start, range.end);
  if ("latestBlockHash" in type.fields) return toRootHex(ssz.Root.deserialize(fieldBytes));
  if ("latestExecutionPayloadHeader" in type.fields) {
    return toRootHex(type.fields.latestExecutionPayloadHeader.deserialize(fieldBytes).blockHash);
  }
  return undefined;
}
