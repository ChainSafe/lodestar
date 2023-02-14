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
  getProtoArrayNodes: {
    args: [],
    res: {
      data: [
        {
          executionPayloadBlockHash: rootHex,
          executionStatus: "Valid",
          slot: 1,
          blockRoot: rootHex,
          parentRoot: rootHex,
          stateRoot: rootHex,
          targetRoot: rootHex,
          justifiedEpoch: 1,
          justifiedRoot: rootHex,
          finalizedEpoch: 1,
          finalizedRoot: rootHex,
          unrealizedJustifiedEpoch: 1,
          unrealizedJustifiedRoot: rootHex,
          unrealizedFinalizedEpoch: 1,
          unrealizedFinalizedRoot: rootHex,
          parent: "1",
          weight: 1,
          bestChild: "1",
          bestDescendant: "1",
        },
      ],
    },
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
