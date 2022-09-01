import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "../../../../src/beacon/routes/debug.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const rootHex = toHexString(Buffer.alloc(32, 1));

export const testData: GenericServerTestCases<Api> = {
  getDebugChainHeads: {
    args: [],
    res: {data: [{slot: 1, root: rootHex}]},
  },
  getDebugChainHeadsV2: {
    args: [],
    res: {data: [{slot: 1, root: rootHex, executionOptimistic: true}]},
  },
  getState: {
    args: ["head", "json"],
    res: {executionOptimistic: true, data: ssz.phase0.BeaconState.defaultValue()},
  },
  getStateV2: {
    args: ["head", "json"],
    res: {executionOptimistic: true, data: ssz.altair.BeaconState.defaultValue(), version: ForkName.altair},
  },
};
