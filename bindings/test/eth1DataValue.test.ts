import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {expect, it} from "vitest";
import bindings from "../src/index.js";

const nativeConfig = new bindings.BeaconConfig(config, new Uint8Array(32));

it.each([
  {count: 0n, name: "zero"},
  {count: 1n, name: "small"},
  {count: (1n << 53n) + 1n, name: "above safe integer"},
  {count: (1n << 63n) - 1n, name: "maximum signed integer"},
  {count: 1n << 63n, name: "above signed integer"},
  {count: (1n << 64n) - 1n, name: "maximum unsigned integer"},
])("$name deposit counts stay bigint in state values and votes", ({count}) => {
  const value = ssz.phase0.BeaconState.defaultValue();
  value.eth1DataVotes = [ssz.phase0.Eth1Data.defaultValue()];
  value.eth1DepositIndex = 17;
  value.fork.epoch = Infinity;
  const bytes = ssz.phase0.BeaconState.serialize(value);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranges = ssz.phase0.BeaconState.getFieldRanges(data, 0, bytes.length);
  const fields = Object.keys(ssz.phase0.BeaconState.fields);
  const countOffset = ssz.phase0.Eth1Data.fields.depositRoot.fixedSize;

  // The pinned JS Eth1Data serializer takes number; write exact uint64 fixture bytes.
  data.setBigUint64(ranges[fields.indexOf("eth1Data")].start + countOffset, count, true);
  data.setBigUint64(ranges[fields.indexOf("eth1DataVotes")].start + countOffset, count, true);

  const state = bindings.BeaconStateView.createFromBytes(bytes, nativeConfig);
  try {
    const result = state.toValue();
    expect(result.eth1Data.depositCount).toBe(count);
    expect(result.eth1DataVotes.map((vote: {depositCount: bigint}) => vote.depositCount)).toEqual([count]);
    expect(result.eth1Data).toEqual(state.eth1Data);
    expect(result.eth1DepositIndex).toBe(17);
    expect(result.fork.epoch).toBe(Infinity);
    expect(Buffer.compare(state.serialize(), bytes)).toBe(0);
  } finally {
    state.release();
  }
});
