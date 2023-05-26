import {expect} from "chai";
import {ssz} from "../../src/index.js";

describe("stack traces with proper names", () => {
  it("Should render stack traces with named properties", () => {
    const stateEip4844 = ssz.eip4844.BeaconState.defaultValue();
    const stateEip4844Bytes = ssz.eip4844.BeaconState.serialize(stateEip4844);

    // Force de-serialization failure with the incorrect state type
    const error = getError(() => ssz.capella.BeaconState.deserialize(stateEip4844Bytes));

    if (!error.stack) {
      throw Error("no stack trace");
    }

    // Error: First offset must equal to fixedEnd 376 != 344
    //   at readVariableOffsets (/home/lion/Code/eth2.0/lodestar/node_modules/@chainsafe/ssz/src/type/container.ts:448:15)
    //   at ExecutionPayloadHeaderCapellaType.getFieldRanges (/home/lion/Code/eth2.0/lodestar/node_modules/@chainsafe/ssz/src/type/container.ts:399:21)
    //   at ExecutionPayloadHeaderCapellaType.value_deserializeFromBytes (/home/lion/Code/eth2.0/lodestar/node_modules/@chainsafe/ssz/src/type/container.ts:201:30)
    //   at BeaconStateCapellaType.value_deserializeFromBytes (/home/lion/Code/eth2.0/lodestar/node_modules/@chainsafe/ssz/src/type/container.ts:208:36)
    //   at BeaconStateCapellaType.deserialize (/home/lion/Code/eth2.0/lodestar/node_modules/@chainsafe/ssz/src/type/abstract.ts:135:17)

    const stackRows = error.stack
      .split("\n")
      .slice(1, 6)
      .map((row) => row.trim().split(/\s+/)[1]);

    expect(stackRows).deep.equals([
      "readVariableOffsets",
      "ExecutionPayloadHeaderCapella.getFieldRanges",
      "ExecutionPayloadHeaderCapella.value_deserializeFromBytes",
      "BeaconStateCapella.value_deserializeFromBytes",
      "BeaconStateCapella.deserialize",
    ]);
  });
});

function getError(fn: () => void): Error {
  try {
    fn();
    throw Error("fn did not throw");
  } catch (e) {
    return e as Error;
  }
}
