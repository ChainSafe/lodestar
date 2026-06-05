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
  getDebugForkChoiceV2: {
    args: undefined,
    res: {
      data: {
        justifiedCheckpoint: {epoch: 2, root},
        finalizedCheckpoint: {epoch: 1, root},
        forkChoiceNodes: [
          {
            payloadStatus: "full",
            slot: 1,
            blockRoot: rootHex,
            parentRoot: rootHex,
            weight: 1,
            validity: "valid",
            executionBlockHash: rootHex,
            extraData: {
              executionOptimistic: false,
              timestamp: 12,
              target: rootHex,
              justifiedEpoch: 1,
              finalizedEpoch: 1,
              unrealizedJustifiedEpoch: 1,
              unrealizedFinalizedEpoch: 1,
              payloadAttesterCount: 3,
              payloadAvailabilityYesCount: 2,
              payloadDataAvailabilityYesCount: 2,
              gasLimit: 30_000_000,
            },
          },
          {
            payloadStatus: "pending",
            slot: 2,
            blockRoot: rootHex,
            parentRoot: rootHex,
            weight: 0,
            validity: "optimistic",
            executionBlockHash: rootHex,
            extraData: {
              executionOptimistic: true,
              timestamp: 24,
              target: rootHex,
              justifiedEpoch: 1,
              finalizedEpoch: 1,
              unrealizedJustifiedEpoch: 1,
              unrealizedFinalizedEpoch: 1,
              payloadAttesterCount: null,
              payloadAvailabilityYesCount: null,
              payloadDataAvailabilityYesCount: null,
              gasLimit: null,
            },
          },
        ],
        extraData: {
          unrealizedJustifiedCheckpoint: {epoch: 2, root},
          unrealizedFinalizedCheckpoint: {epoch: 1, root},
          proposerBoostRoot: rootHex,
          previousProposerBoostRoot: rootHex,
          headRoot: rootHex,
        },
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
      data: ssz.electra.BeaconState.defaultValue(),
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getDebugDataColumnSidecars: {
    args: {blockId: "head", indices: [0]},
    res: {
      data: [ssz.fulu.DataColumnSidecar.defaultValue()],
      meta: {executionOptimistic: true, finalized: false, version: ForkName.fulu},
    },
  },
};
