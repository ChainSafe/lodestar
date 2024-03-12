import {toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints} from "../../../../src/beacon/routes/debug.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const rootHex = toHexString(Buffer.alloc(32, 1));

export const testData: GenericServerTestCases<Endpoints> = {
  getDebugChainHeads: {
    args: undefined,
    res: {data: [{slot: 1, root: rootHex}]},
  },
  getDebugChainHeadsV2: {
    args: undefined,
    res: {data: [{slot: 1, root: rootHex, executionOptimistic: true}]},
  },
  getProtoArrayNodes: {
    args: undefined,
    res: {
      data: [
        {
          executionPayloadBlockHash: rootHex,
          executionPayloadNumber: 1,
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
    args: {stateId: "head"},
    res: {data: ssz.phase0.BeaconState.defaultValue(), meta: {executionOptimistic: true}},
  },
  getStateV2: {
    args: {stateId: "head"},
    res: {data: ssz.altair.BeaconState.defaultValue(), meta: {executionOptimistic: true, version: ForkName.altair}},
  },
};
