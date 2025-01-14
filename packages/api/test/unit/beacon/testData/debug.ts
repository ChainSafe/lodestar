import {toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints} from "../../../../src/beacon/routes/debug.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = new Uint8Array(32).fill(1);
const rootHex = toHexString(root);

export const testData: GenericServerTestCases<Endpoints> = {
  getDebugChainHeadsV2: {
    args: undefined,
    res: {data: [{slot: 1, root: rootHex, executionOptimistic: true}]},
  },
  getDebugForkChoice: {
    args: undefined,
    res: {
      data: {
        justifiedCheckpoint: {
          epoch: 2,
          root,
        },
        finalizedCheckpoint: {
          epoch: 1,
          root,
        },
        forkChoiceNodes: [
          {
            slot: 1,
            blockRoot: rootHex,
            parentRoot: rootHex,
            justifiedEpoch: 1,
            finalizedEpoch: 1,
            weight: 1,
            validity: "valid",
            executionBlockHash: rootHex,
          },
        ],
      },
    },
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
          timeliness: false,
        },
      ],
    },
  },
  getStateV2: {
    args: {stateId: "head"},
    res: {
      data: ssz.altair.BeaconState.defaultValue(),
      meta: {executionOptimistic: true, finalized: false, version: ForkName.altair},
    },
  },
};
